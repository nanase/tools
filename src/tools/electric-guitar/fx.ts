/**
 * ペダル 1 台ぶんの処理（DOM に依存しない）。左右の入力を受けて左右を出す。
 * 歪み・揺らし・コンプ・ワウは左右を足して 1 つにして処理し（実物のモノラルのペダルと同じ）、ディレイとリバーブは左右に広げる。
 * 歪みは前のフィルタ → 記憶のない非線形 → 音色のフィルタ（Yeh ほか 2007）。値はこのツールで決めた目安を含む
 */
import { clamp, Delay, dbToG, IIR, OnePole, rbj, Shaper, Svf, TAU } from './filters';
import type { Kind } from './pedals';

/** ペダルの設定（つまみは 0〜1、ディレイの時間は s） */
export type PedalVals = Record<string, number | string>;
const num = (v: PedalVals, k: string): number => Number(v[k]);

/** 歪みの増幅率。オーバードライブは帰還の抵抗 51 kΩ＋500 kΩ のポットと 4.7 kΩ の比（Yeh ほか 2007） */
export function driveGain(k: 'od' | 'ds' | 'fuzz', g: number): number {
  if (k === 'od') return 1 + (51e3 + 500e3 * g) / 4.7e3;
  if (k === 'ds') return 10 * 100 ** g;
  return 15 * 40 ** g;
}
/** 歪みの入出力（直流で見た形。図に使う）。x [V] */
export function driveCurve(k: 'od' | 'ds' | 'fuzz', g: number, x: number): number {
  const G = driveGain(k, g);
  if (k === 'od') return x + 0.6 * Math.tanh((G * x) / 0.6);
  if (k === 'ds') return 0.7 * clamp((G * x) / 0.7, -1, 1);
  return 0.8 * (Math.tanh((G * x) / 0.8 + 0.8) - Math.tanh(0.8));
}
/** コンプレッサーのしきい値 [dB] と比 */
export const compThr = (sus: number): number => -18 - 30 * sus;
export const COMP_RATIO = 6;
/** 揺らしの速さ [Hz] */
export const modHz = (rate: number): number => 0.08 * 60 ** rate;
/** ワウの山の周波数 [Hz] と Q（ペダルの位置 0〜1） */
export const wahHz = (pos: number): number => 380 * 6 ** pos;
export const WAH_Q = 5.5;
/** リバーブの残響時間の目安 [s] */
export const revT60 = (k: 'spring' | 'room', decay: number): number =>
  k === 'spring' ? 1.2 + 2.6 * decay : 0.8 + 3 * decay;

/** ペダル 1 台 */
export interface Fx {
  set(v: PedalVals): void;
  /** 左右の入力 l・r を受けて、o[0]・o[1] へ出す */
  run(l: number, r: number, o: Float64Array): void;
  /** 残った音を消す */
  clear(): void;
}
const mono = (o: Float64Array, y: number) => {
  o[0] = y;
  o[1] = y;
};

class Comp implements Fx {
  private env = 0;
  private T = -33;
  private mk = 1;
  private readonly at: number;
  private readonly rl: number;
  constructor(fs: number) {
    this.at = Math.exp(-1 / (0.002 * fs));
    this.rl = Math.exp(-1 / (0.18 * fs));
  }
  set(v: PedalVals) {
    this.T = compThr(num(v, 'sus'));
    this.mk = (num(v, 'level') - 0.5) * 18 - this.T * 0.45;
  }
  run(l: number, r: number, o: Float64Array) {
    /* フィードフォワード、dB の領域で平滑（Giannoulis ほか 2012） */
    const x = 0.5 * (l + r),
      W = 6,
      d = 20 * Math.log10(Math.abs(x) + 1e-9) - this.T,
      gc = d < -W / 2 ? 0 : d > W / 2 ? d / COMP_RATIO - d : ((1 / COMP_RATIO - 1) * (d + W / 2) ** 2) / (2 * W);
    this.env = gc < this.env ? this.at * this.env + (1 - this.at) * gc : this.rl * this.env + (1 - this.rl) * gc;
    mono(o, x * dbToG(this.env + this.mk));
  }
  clear() {
    this.env = 0;
  }
}

class Wah implements Fx {
  private readonly f = new Svf();
  private env = 0;
  private pos = 0.5;
  private auto = true;
  private pedal = 0.5;
  private sens = 0.6;
  constructor(private readonly fs: number) {}
  set(v: PedalVals) {
    this.auto = v.mode !== 'manual';
    this.pedal = num(v, 'pedal');
    this.sens = num(v, 'sens');
  }
  run(l: number, r: number, o: Float64Array) {
    const x = 0.5 * (l + r);
    let p = this.pedal;
    if (this.auto) {
      const a = Math.abs(x);
      this.env = a > this.env ? this.env + (a - this.env) * 0.01 : this.env * 0.9997;
      p = clamp(this.env * 6 * (0.3 + 2 * this.sens), 0, 1);
    }
    this.pos += (p - this.pos) * 0.002;
    this.f.run(x, wahHz(this.pos), WAH_Q, this.fs);
    mono(o, 0.3 * this.f.lp + 0.9 * this.f.bp);
  }
  clear() {
    this.env = 0;
  }
}

class Drive implements Fx {
  private readonly hp = new IIR();
  private readonly hp2 = new IIR();
  private readonly lp = new OnePole();
  private readonly lp2 = new OnePole();
  private readonly sh: Shaper;
  private G = 1;
  private out = 1;
  constructor(
    private readonly fs: number,
    private readonly k: 'od' | 'ds' | 'fuzz',
  ) {
    this.sh = new Shaper(k === 'od' ? 'soft' : k === 'ds' ? 'hard' : 'fuzz');
    this.hp2.set(rbj('hp', 20, 0.7, fs));
    this.lp2.lp(9000, fs);
  }
  set(v: PedalVals) {
    const { fs, k } = this,
      tone = num(v, 'tone'),
      level = num(v, 'level');
    this.G = driveGain(k, num(v, 'gain'));
    if (k === 'od') {
      this.hp.set(rbj('hp', 720, 0.6, fs));
      this.lp.lp(800 + 4200 * tone, fs);
    } else if (k === 'ds') {
      this.hp.set(rbj('hp', 160, 0.7, fs));
      this.lp.lp(1200 + 6000 * tone * tone, fs);
    } else {
      this.hp.set(rbj('hp', 60, 0.7, fs));
      this.lp.lp(1500 + 5000 * tone, fs);
    }
    this.out = 0.15 + 1.7 * level * level;
  }
  run(l: number, r: number, o: Float64Array) {
    const x = 0.5 * (l + r),
      h = this.G * this.hp.run(x);
    let y: number;
    if (this.k === 'od') y = x + 0.6 * this.sh.run(h / 0.6);
    else if (this.k === 'ds') y = 0.7 * this.sh.run(h / 0.7);
    else y = 0.8 * this.sh.run(h / 0.8);
    mono(o, this.hp2.run(this.lp2.run(this.lp.run(y))) * this.out);
  }
  clear() {
    this.hp.reset();
    this.hp2.reset();
  }
}

class Mod implements Fx {
  private readonly d: Delay;
  private ph = 0;
  private readonly ap = new Float64Array(4);
  private fbk = 0;
  private hz = 1;
  private depth = 0.5;
  private mix = 0.5;
  constructor(
    private readonly fs: number,
    private readonly k: 'chorus' | 'phaser' | 'flanger' | 'trem',
  ) {
    this.d = new Delay(fs * 0.03);
  }
  set(v: PedalVals) {
    this.hz = modHz(num(v, 'rate'));
    this.depth = num(v, 'depth');
    this.mix = this.k === 'trem' ? 1 : num(v, 'mix');
  }
  run(l: number, r: number, o: Float64Array) {
    const { fs, depth: dp, mix } = this;
    let x = 0.5 * (l + r);
    this.ph = (this.ph + this.hz / fs) % 1;
    const lfo = Math.sin(TAU * this.ph);
    if (this.k === 'chorus') {
      this.d.push(x);
      x = x * (1 - 0.5 * mix) + this.d.read((0.007 + 0.0035 * dp * lfo) * fs) * mix * 0.9;
    } else if (this.k === 'flanger') {
      const w = this.d.read((0.0004 + 0.0035 * (0.5 + 0.5 * lfo) * dp) * fs);
      this.d.push(x + 0.7 * w);
      x = x * (1 - 0.5 * mix) + w * mix;
    } else if (this.k === 'phaser') {
      const fc = 250 * 10 ** ((0.5 + 0.5 * lfo) * (0.6 + dp)),
        t = Math.tan((Math.PI * Math.min(fc, fs * 0.4)) / fs),
        c = (t - 1) / (t + 1),
        s = this.ap;
      let y = x + 0.55 * this.fbk;
      for (let k = 0; k < 4; k++) {
        const q = c * y + s[k];
        s[k] = y - c * q;
        y = q;
      }
      this.fbk = y;
      x = x * (1 - 0.5 * mix) + y * mix;
    } else x *= 1 - 0.9 * dp * (0.5 + 0.5 * lfo);
    mono(o, x);
  }
  clear() {
    this.d.clear();
    this.ap.fill(0);
    this.fbk = 0;
  }
}

class Dly implements Fx {
  private readonly d: Delay;
  private readonly lp = new OnePole();
  private ph = 0;
  private time = 0.38;
  private fb = 0.35;
  private mix = 0.3;
  constructor(private readonly fs: number) {
    this.d = new Delay(fs * 1.3);
    this.lp.lp(3500, fs);
  }
  set(v: PedalVals) {
    this.time = num(v, 'time');
    this.fb = num(v, 'fb');
    this.mix = num(v, 'mix');
  }
  run(l: number, r: number, o: Float64Array) {
    /* 帰還の中に低域通過を置き、ゆっくり揺らす（アナログのディレイの目安） */
    const fs = this.fs,
      x = 0.5 * (l + r);
    this.ph = (this.ph + 0.3 / fs) % 1;
    const dl = this.time * fs * (1 + 0.0015 * Math.sin(TAU * this.ph)),
      w = this.lp.run(this.d.read(dl));
    this.d.push(x + this.fb * w);
    o[0] = l + this.mix * w;
    o[1] = r + this.mix * (0.6 * this.d.read(dl * 0.5) + 0.5 * w);
  }
  clear() {
    this.d.clear();
  }
}

/** ばねの残響: 遅延と全域通過の列で、低い音ほど遅れて届く（Välimäki ほか 2010 の考え方） */
class Spring implements Fx {
  private readonly d: Delay[];
  private readonly ap = [new Float64Array(48), new Float64Array(48)];
  private readonly lp = [new OnePole(), new OnePole()];
  private fb = 0.75;
  private mix = 0.25;
  constructor(private readonly fs: number) {
    this.d = [new Delay(fs * 0.06), new Delay(fs * 0.06)];
    for (const l of this.lp) l.lp(4200, fs);
  }
  set(v: PedalVals) {
    this.fb = 0.6 + 0.3 * num(v, 'decay');
    this.mix = num(v, 'mix');
  }
  run(l: number, r: number, o: Float64Array) {
    const inp = 0.25 * (l + r),
      w = [0, 0];
    for (let ch = 0; ch < 2; ch++) {
      const D = this.d[ch],
        ap = this.ap[ch];
      let y = D.read((ch ? 0.043 : 0.037) * this.fs) * this.fb + inp;
      for (let k = 0; k < 48; k++) {
        const q = 0.62 * y + ap[k];
        ap[k] = y - 0.62 * q;
        y = q;
      }
      y = this.lp[ch].run(y);
      D.push(y);
      w[ch] = 1.3 * y;
    }
    o[0] = l * (1 - 0.4 * this.mix) + w[0] * this.mix * 1.4;
    o[1] = r * (1 - 0.4 * this.mix) + w[1] * this.mix * 1.4;
  }
  clear() {
    for (const d of this.d) d.clear();
    for (const a of this.ap) a.fill(0);
  }
}

/** ルームリバーブ: 8 本の遅延線をアダマール行列で混ぜる FDN（Jot・Chaigne 1991） */
const FDN_S = [0.0371, 0.0411, 0.0437, 0.0473, 0.0531, 0.0569, 0.0613, 0.0667];
class Room implements Fx {
  private readonly d: Delay[];
  private readonly len: number[];
  private readonly lp = Array.from({ length: 8 }, () => new OnePole());
  private readonly pre: Delay;
  private readonly x = new Float64Array(8);
  private readonly h = new Float64Array(8);
  private readonly g = new Float64Array(8);
  private mix = 0.25;
  constructor(private readonly fs: number) {
    this.d = FDN_S.map((s) => new Delay(fs * s + 4));
    this.len = FDN_S.map((s) => Math.round(fs * s));
    this.pre = new Delay(fs * 0.03);
    for (const l of this.lp) l.lp(6000, fs);
  }
  set(v: PedalVals) {
    const T60 = revT60('room', num(v, 'decay'));
    for (let i = 0; i < 8; i++) this.g[i] = 10 ** ((-3 * this.len[i]) / this.fs / T60);
    this.mix = num(v, 'mix');
  }
  run(l: number, r: number, o: Float64Array) {
    const { x, h, d } = this,
      pre = this.pre.read(this.fs * 0.02);
    this.pre.push(0.5 * (l + r));
    for (let i = 0; i < 8; i++) x[i] = d[i].read(this.len[i]);
    h.set(x);
    for (let s = 1; s < 8; s *= 2)
      for (let i = 0; i < 8; i += 2 * s)
        for (let j = i; j < i + s; j++) {
          const a = h[j],
            b = h[j + s];
          h[j] = a + b;
          h[j + s] = a - b;
        }
    for (let i = 0; i < 8; i++) d[i].push(this.lp[i].run((h[i] / Math.sqrt(8)) * this.g[i]) + pre * 0.35);
    const wl = 0.35 * (x[0] + x[2] + x[4] + x[6]),
      wr = 0.35 * (x[1] + x[3] + x[5] + x[7]);
    o[0] = l * (1 - 0.4 * this.mix) + wl * this.mix * 1.4;
    o[1] = r * (1 - 0.4 * this.mix) + wr * this.mix * 1.4;
  }
  clear() {
    for (const q of this.d) q.clear();
    this.pre.clear();
  }
}

/** 種類 k のペダルを 1 台作る */
export function makeFx(k: Kind, fs: number): Fx {
  if (k === 'comp') return new Comp(fs);
  if (k === 'wah') return new Wah(fs);
  if (k === 'od' || k === 'ds' || k === 'fuzz') return new Drive(fs, k);
  if (k === 'chorus' || k === 'phaser' || k === 'flanger' || k === 'trem') return new Mod(fs, k);
  if (k === 'dly') return new Dly(fs);
  if (k === 'spring') return new Spring(fs);
  return new Room(fs);
}

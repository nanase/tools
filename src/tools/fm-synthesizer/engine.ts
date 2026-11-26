/**
 * FM シンセサイザの音源（DOM に依存しない）。音の AudioWorklet（worklet.ts）と表示（client.ts）で同じ式を使う。
 * 4 オペレータで、つなぎ方と帰還量は FM音源のページ（fm-synth/synth.ts）と同じ OPN の 8 通り。
 * オペレータごとに ADSR を持ち、パート（MIDI のチャンネル）ごとに音色・LFO・音量・定位・ピッチベンド・ダンパーペダルを持つ
 */
import { ALGS, FB, WAVES, waveAt } from '../fm-synth/synth';

export { ALGS, FB, WAVES };

/** パートの数（MIDI のチャンネル 1〜16 を 0〜15 で持つ） */
export const PARTS = 16;
/** 打楽器のパート（10 チャンネル） */
export const DRUM_PART = 9;
/** 同時に鳴らす音の上限（全パートの合計） */
export const MAX_VOICES = 48;
/** エンベロープの時間（アタック以外）は、その時間で 60 dB 下がる（減衰の時定数 = 時間 ÷ 6.9） */
const LN60 = Math.log(1000);
/** 鳴り終わったとみなす大きさ（−80 dB） */
const SILENT = 1e-4;
/** 横取りした音を消す時間 [s] */
const KILL_S = 0.004;
/** 音量の行の既定値 [dB]。ユーザーの指定で −18 dB。同梱の最初の曲を既定のまま（コンプレッサーと残響あり）鳴らして −23.9 LUFS（scripts/loudness.ts） */
export const VOL0 = -18;
/** 直流を取り除く高域通過の折れ点 [Hz] */
const DC_HZ = 10;
/** 残響へ送る量の既定値（0〜1） */
export const REV0 = 0.25;
/** ピッチベンドの幅（半音） */
export const BEND_RANGE = 2;

/** オペレータ */
export interface Op {
  /** 周波数比（基本周波数に掛ける） */
  r: number;
  /** モジュレータのときの変調指数（rad） */
  i: number;
  /** キャリアのときの出力レベル（dB、0 がフルスケール） */
  l: number;
  /** アタック: 0 から最大まで上がる時間 [s] */
  ar: number;
  /** ディケイ: 最大からサステインへ下がる時間 [s]（差が 60 dB 縮む時間） */
  dr: number;
  /** サステイン: 押している間に落ち着く大きさ（0〜1、最大に対する比） */
  sl: number;
  /** リリース: 離してから 60 dB 下がる時間 [s] */
  rr: number;
  /** ベロシティの効き（0 は効かない、1 は最も効く） */
  vs: number;
  /** 波形（FM音源のページと同じ WAVES の番号。省けば正弦波） */
  w?: number;
  /** キースケール: 高い音ほどディケイとリリースを短くする量（1 オクターブ上で 2^−ks 倍） */
  ks: number;
  /** キースケール: 高い音ほどアタックを短くする量（1 オクターブ上で 2^−ka 倍。省けば 0） */
  ka?: number;
  /** ベロシティで時間を変える量（0〜1。弱いほどアタックを長く、ディケイを短くする。最も弱いとき 4^va 倍。省けば 0） */
  va?: number;
  /** デチューン [Hz]（周波数比で決めた周波数に足す。うなりの速さが音の高さによらない。省けば 0） */
  dt?: number;
}

/** LFO（パートごと） */
export interface Lfo {
  /** 速さ [Hz] */
  rate: number;
  /** ビブラートの深さ [セント] */
  vib: number;
  /** トレモロの深さ [dB] */
  trem: number;
  /** 鳴り始めてから揺れ始めるまでの時間 [s] */
  delay: number;
}

/** 音色 */
export interface Tone {
  /** アルゴリズム 0〜7 */
  alg: number;
  /** 帰還量 0〜7 */
  fb: number;
  /** 帰還量のベロシティの効き（0〜1。オペレータの vs と同じ曲線。省けば 0） */
  fbv?: number;
  /** 帰還量のキースケール（1 オクターブ上で 2^−fbk 倍。省けば 0） */
  fbk?: number;
  ops: readonly [Op, Op, Op, Op];
  lfo: Lfo;
  /** 音量の補正 [dB]（音色ごとの大きさをそろえる） */
  gain: number;
  /** 音の高さを決めるノート番号（打楽器。なければ押した鍵の高さ） */
  key?: number;
}

/** オペレータ k（0 始まり）がアルゴリズム alg でキャリアか */
export const isCarrier = (alg: number, k: number): boolean => ALGS[alg].c.includes(k);

/** ノート番号の周波数 [Hz]（A4 = 440 Hz の平均律） */
export const noteHz = (n: number): number => 440 * 2 ** ((n - 69) / 12);

/** キースケールで時間に掛ける値 */
export const keyScale = (op: Op, note: number): number => 2 ** ((-op.ks * (note - 60)) / 12);

/** ベロシティ v（0〜1）で大きさに掛ける値 */
export const velGain = (vs: number, v: number): number => 1 - vs * (1 - v * v);

/** ベロシティで時間を変える幅（最も弱いとき、アタックは 4 倍・ディケイは 1/4 倍） */
const VEL_T = 4;
/**
 * キースケールとベロシティを掛けた、アタック・ディケイ・リリースの時間 [s]。
 * ベロシティは 1 が音色のままで、弱いほどアタックが長く、ディケイが短い
 */
export function opTimes(op: Op, note: number, vel = 1): [number, number, number] {
  const k = keyScale(op, note),
    v = VEL_T ** ((op.va ?? 0) * (1 - Math.max(0, Math.min(1, vel))));
  return [op.ar * 2 ** ((-(op.ka ?? 0) * (note - 60)) / 12) * v, (op.dr * k) / v, op.rr * k];
}

/** 帰還の強さ（OP1 の 1 標本前と 2 標本前の和に掛ける値）。帰還量・ベロシティ・音の高さで決める */
export function fbBeta(tone: Tone, note: number, vel = 1): number {
  const b = (FB[tone.fb] / 2) * velGain(tone.fbv ?? 0, vel) * 2 ** ((-(tone.fbk ?? 0) * (note - 60)) / 12);
  return Math.min(FB[FB.length - 1] / 2, b);
}

/**
 * エンベロープの大きさ（0〜1）。t は鳴り始めからの時間 [s]、hold は離した時刻（押したままなら Infinity）。
 * アタックは直線で上がり、ディケイとリリースは指数で下がる（音源の計算と同じ式）。時間は opTimes で決める
 */
export function envAt(op: Op, t: number, hold = Number.POSITIVE_INFINITY, note = 60, vel = 1): number {
  const [ar, dr, rr] = opTimes(op, note, vel);
  const at = (x: number): number => {
    if (x < ar) return ar > 0 ? x / ar : 1;
    const td = Math.max(1e-4, dr);
    return op.sl + (1 - op.sl) * Math.exp((-LN60 * (x - ar)) / td);
  };
  if (t < hold) return Math.max(0, at(t));
  const tr = Math.max(1e-4, rr);
  return Math.max(0, at(hold) * Math.exp((-LN60 * (t - hold)) / tr));
}

/* ---------- 波形の表 ---------- */
const TAB_N = 4096;
/** 波形ごとの 1 周期の表（WAVES の順。正弦波のほか、三角波・のこぎり波・矩形波・半波整流・全波整流・四分波） */
const TABS: readonly Float32Array[] = WAVES.map((_, w) => {
  const t = new Float32Array(TAB_N + 1);
  for (let i = 0; i <= TAB_N; i++) t[i] = waveAt(w, (2 * Math.PI * (i % TAB_N)) / TAB_N);
  return t;
});
/** 波形の番号の表（範囲の外は正弦波） */
const tabOf = (w: number | undefined): Float32Array => TABS[w !== undefined && w >= 0 && w < TABS.length ? w | 0 : 0];
/** 位相 x（周期の単位）の波形の値。表を直線で補う（どの波形も同じ手間なので、正弦波より重くならない） */
function look(t: Float32Array, x: number): number {
  const u = (x - Math.floor(x)) * TAB_N,
    i = u | 0;
  return t[i] + (t[i + 1] - t[i]) * (u - i);
}
const TAU = 2 * Math.PI;

/* ---------- 1 音 ---------- */
const ATTACK = 0,
  DECAY = 1,
  RELEASE = 2,
  /** 表示用に大きさを止めておく */
  FROZEN = 3;

/** 鳴っている 1 音 */
export class Voice {
  readonly ph = new Float64Array(4);
  private readonly s = new Float64Array(4);
  /** エンベロープの大きさ・段・1 標本あたりの変化 */
  private readonly lv = new Float64Array(4);
  private readonly stage = new Uint8Array(4);
  private readonly up = new Float64Array(4);
  private readonly kd = new Float64Array(4);
  private readonly kr = new Float64Array(4);
  /** オペレータの出力の大きさ（モジュレータは変調指数 rad、キャリアは振幅） */
  private readonly amp = new Float64Array(4);
  /** デチューンで 1 標本ごとに進む位相（周期の単位） */
  readonly dInc = new Float64Array(4);
  private src: number[][] = [[], [], [], []];
  private car: readonly number[] = [];
  private h1 = 0;
  private h2 = 0;
  private beta = 0;
  private gain = 1;
  /** 横取りされて消している（1 標本あたりに掛ける値。0 は消していない） */
  private kill = 0;
  /** 鳴り始めからの時間 [s] */
  age = 0;
  /** 離したか（ダンパーペダルで延ばしている間も離したことにしない） */
  released = false;
  /** ダンパーペダルで延ばしているか */
  sustained = false;
  /** 鍵を離したか（ペダルで延ばしていても true） */
  keyUp = false;
  /** 鳴らす高さ（ノート番号。音色の固定の高さか、移調したノート） */
  readonly pitch: number;

  constructor(
    readonly part: number,
    readonly note: number,
    readonly vel: number,
    readonly tone: Tone,
    readonly src0: number,
    private readonly sr: number,
    shift = 0,
  ) {
    this.car = ALGS[tone.alg].c;
    for (const [j, k] of ALGS[tone.alg].e) this.src[k].push(j);
    const pitch = tone.key ?? Math.max(0, Math.min(127, note + shift));
    this.pitch = pitch;
    /* 音ごとの値は鳴り始めに 1 度だけ求める（標本ごとの計算は増やさない） */
    this.beta = fbBeta(tone, pitch, vel);
    this.gain = 10 ** (tone.gain / 20);
    for (let k = 0; k < 4; k++) {
      const op = tone.ops[k],
        [ar, dr, rr] = opTimes(op, pitch, vel),
        g = velGain(op.vs, vel);
      this.amp[k] = this.car.includes(k) ? 10 ** (op.l / 20) * g : op.i * g;
      this.dInc[k] = (op.dt ?? 0) / sr;
      this.up[k] = ar > 0 ? 1 / (ar * sr) : 1;
      this.kd[k] = Math.exp(-LN60 / (Math.max(1e-4, dr) * sr));
      this.kr[k] = Math.exp(-LN60 / (Math.max(1e-4, rr) * sr));
      this.lv[k] = ar > 0 ? 0 : 1;
      this.stage[k] = ar > 0 ? ATTACK : DECAY;
    }
  }

  /** 離す（リリースへ移る） */
  release(): void {
    this.released = true;
    this.stage.fill(RELEASE);
  }
  /** 横取りされて、すぐ消す */
  steal(): void {
    this.kill = Math.exp(-1 / (KILL_S * this.sr));
    this.released = true;
  }
  /** 横取りされて消しているか */
  get stolen(): boolean {
    return this.kill > 0;
  }
  /** 表示用に、エンベロープの大きさを決めて止める */
  freeze(k: number, v: number): void {
    this.lv[k] = v;
    this.stage[k] = FROZEN;
  }
  /** 鳴り終わったか */
  get done(): boolean {
    if (this.kill && this.gain < SILENT) return true;
    /* 離していない音も、サステインが 0 のキャリアがディケイで鳴り止んだら終える（打楽器は離さない） */
    for (const c of this.car)
      if (this.lv[c] > SILENT || (!this.released && (this.stage[c] !== DECAY || this.tone.ops[c].sl > 0))) return false;
    return true;
  }
  /** キャリアのエンベロープの大きさの最大 */
  get level(): number {
    let m = 0;
    for (const c of this.car) m = Math.max(m, this.lv[c]);
    return m;
  }

  /**
   * len 標本を L・R に足す。step は基本周波数 ÷ 標本化周波数。am は振幅に掛ける値（トレモロ）、
   * pl・pr は左右の大きさ（パートの音量・定位）
   */
  render(L: Float32Array, R: Float32Array, len: number, step: number, am: number, pl: number, pr: number): void {
    const { ph, s, lv, stage, up, kd, kr, amp, src, car } = this,
      sl = [this.tone.ops[0].sl, this.tone.ops[1].sl, this.tone.ops[2].sl, this.tone.ops[3].sl],
      r = this.tone.ops,
      d = this.dInc,
      inc = [r[0].r * step + d[0], r[1].r * step + d[1], r[2].r * step + d[2], r[3].r * step + d[3]],
      tab = [tabOf(r[0].w), tabOf(r[1].w), tabOf(r[2].w), tabOf(r[3].w)],
      beta = this.beta;
    let g = this.gain * am;
    const kill = this.kill;
    for (let i = 0; i < len; i++) {
      for (let k = 0; k < 4; k++) {
        const st = stage[k];
        if (st === ATTACK) {
          lv[k] += up[k];
          if (lv[k] >= 1) {
            lv[k] = 1;
            stage[k] = DECAY;
          }
        } else if (st === DECAY) lv[k] = sl[k] + (lv[k] - sl[k]) * kd[k];
        else if (st === RELEASE) lv[k] *= kr[k];
      }
      const x = look(tab[0], ph[0] + (beta * (this.h1 + this.h2)) / TAU);
      this.h2 = this.h1;
      this.h1 = x;
      s[0] = x;
      for (let k = 1; k < 4; k++) {
        let m = 0;
        for (const j of src[k]) m += amp[j] * lv[j] * s[j];
        s[k] = look(tab[k], ph[k] + m / TAU);
      }
      let y = 0;
      for (const c of car) y += amp[c] * lv[c] * s[c];
      if (kill) g *= kill;
      y *= g;
      L[i] += y * pl;
      R[i] += y * pr;
      for (let k = 0; k < 4; k++) {
        const q = ph[k] + inc[k];
        ph[k] = q - Math.floor(q);
      }
    }
    if (kill) this.gain = g / am;
    this.age += len / this.sr;
  }
}

/* ---------- パート ---------- */
/** パートの状態 */
export interface PartState {
  tone: Tone;
  /** 画面の音量 [dB] と定位（−1 左〜1 右） */
  vol: number;
  pan: number;
  /** MIDI のコントロールチェンジ: 7 音量・10 定位・11 エクスプレッション（0〜127） */
  cc7: number;
  cc10: number;
  cc11: number;
  /** ピッチベンド（−1〜1） */
  bend: number;
  /** ダンパーペダル */
  sus: boolean;
  /** ミュート */
  mute: boolean;
  /** 残響へ送る量（0〜1） */
  rev: number;
  /** LFO の位相（周期の単位） */
  lfo: number;
}

export const newPart = (tone: Tone): PartState => ({
  tone,
  vol: 0,
  pan: 0,
  cc7: 100,
  cc10: 64,
  cc11: 127,
  bend: 0,
  sus: false,
  mute: false,
  rev: REV0,
  lfo: 0,
});

/** パートの左右の大きさ（等電力の定位。MIDI の 7・11 は 2 乗） */
export function partGains(p: PartState): [number, number] {
  const midiPan = (p.cc10 - 64) / 63,
    pan = Math.max(-1, Math.min(1, p.pan + midiPan)),
    a = ((pan + 1) * Math.PI) / 4,
    g = p.mute ? 0 : 10 ** (p.vol / 20) * (p.cc7 / 127) ** 2 * (p.cc11 / 127) ** 2;
  return [g * Math.cos(a), g * Math.sin(a)];
}

/** ハイハットの閉じた音（42・44）は、開いた音（46）を止める */
const CHOKE: Record<number, readonly number[]> = { 42: [46], 44: [46] };

/** 音の出どころ: 曲（0）と MIDI 機器（1）。曲を止めたときは曲の音だけを離す */
export type Src = 0 | 1;

/** 16 パートの音源 */
export class Synth {
  readonly parts: PartState[];
  /** 打楽器の音（ノート番号ごと） */
  readonly drums = new Map<number, Tone>();
  voices: Voice[] = [];
  /** 移調 [半音]（打楽器のパートは移さない。鳴り始めに当てるので、鳴っている音の高さは変えない） */
  transpose = 0;
  /** 打楽器で音色のないノートに使う音 */
  private drum0: Tone;

  constructor(
    private readonly sr: number,
    tone0: Tone,
    drum0: Tone,
  ) {
    this.parts = Array.from({ length: PARTS }, () => newPart(tone0));
    this.drum0 = drum0;
    this.dcK = 1 - (2 * Math.PI * DC_HZ) / sr;
  }

  /** 打楽器の音色のないノートに使う音を変える */
  setDrum0(t: Tone): void {
    this.drum0 = t;
  }

  toneOf(part: number, note: number): Tone {
    return part === DRUM_PART ? (this.drums.get(note) ?? this.drum0) : this.parts[part].tone;
  }

  noteOn(part: number, note: number, vel: number, src: Src = 0): void {
    if (vel <= 0) {
      this.noteOff(part, note, src);
      return;
    }
    if (part === DRUM_PART)
      for (const n of CHOKE[note] ?? []) for (const v of this.voices) if (v.part === part && v.note === n) v.steal();
    this.voices.push(
      new Voice(
        part,
        note,
        Math.min(1, vel),
        this.toneOf(part, note),
        src,
        this.sr,
        part === DRUM_PART ? 0 : this.transpose,
      ),
    );
    this.limit();
  }

  noteOff(part: number, note: number, src: Src = 0): void {
    const p = this.parts[part];
    for (const v of this.voices) {
      if (v.part !== part || v.note !== note || v.src0 !== src || v.keyUp) continue;
      v.keyUp = true;
      if (part === DRUM_PART) continue;
      if (p.sus) v.sustained = true;
      else v.release();
    }
  }

  /** 上限を超えたら、離した音のうち最も古いもの、なければ最も古い音を横取りする */
  private limit(): void {
    const live = this.voices.filter((v) => !v.done && !v.stolen);
    if (live.length <= MAX_VOICES) return;
    const off = live.filter((v) => v.released);
    (off.length ? off[0] : live[0]).steal();
  }

  /** コントロールチェンジ */
  cc(part: number, num: number, v: number): void {
    const p = this.parts[part];
    if (num === 7) p.cc7 = v;
    else if (num === 10) p.cc10 = v;
    else if (num === 11) p.cc11 = v;
    else if (num === 64) {
      p.sus = v >= 64;
      if (!p.sus) for (const x of this.voices) if (x.part === part && x.sustained) x.release();
    } else if (num === 121) {
      p.cc7 = 100;
      p.cc10 = 64;
      p.cc11 = 127;
      p.bend = 0;
      p.sus = false;
    } else if (num === 120 || num === 123) this.allOff(part);
  }

  bend(part: number, v: number): void {
    this.parts[part].bend = Math.max(-1, Math.min(1, v));
  }

  /** パート part（省けば全パート）の音を離す。src を渡すと、その出どころの音だけ */
  allOff(part?: number, src?: Src): void {
    for (const v of this.voices) {
      if (part !== undefined && v.part !== part) continue;
      if (src !== undefined && v.src0 !== src) continue;
      v.keyUp = true;
      v.release();
    }
  }

  /** すべてのパートの音をすぐ消し、ダンパーペダルを戻す（曲の予約は消さない） */
  panic(): void {
    for (const v of this.voices) {
      v.keyUp = true;
      v.steal();
    }
    for (const p of this.parts) p.sus = false;
  }

  /** 直流を取り除く高域通過（10 Hz）の係数と、出力ごとの直前の入力と出力 */
  private readonly dcK: number;
  private readonly dcZ = new Float64Array(8);
  /** パートごとに音を集める作業用の左右の配列 */
  private pl = new Float32Array(128);
  private pr = new Float32Array(128);

  /**
   * len 標本を L・R（直接音）と SL・SR（残響へ送る音。パートごとの送る量を掛けたもの）に書く（上書き）
   */
  render(L: Float32Array, R: Float32Array, len: number, SL?: Float32Array, SR?: Float32Array): void {
    L.fill(0, 0, len);
    R.fill(0, 0, len);
    SL?.fill(0, 0, len);
    SR?.fill(0, 0, len);
    if (this.pl.length < len) {
      this.pl = new Float32Array(len);
      this.pr = new Float32Array(len);
    }
    const dt = len / this.sr,
      lfo = new Float64Array(PARTS),
      gains: [number, number][] = [];
    for (let k = 0; k < PARTS; k++) {
      const p = this.parts[k];
      p.lfo = (p.lfo + p.tone.lfo.rate * dt) % 1;
      lfo[k] = Math.sin(TAU * p.lfo);
      gains.push(partGains(p));
    }
    const { pl: TL, pr: TR } = this;
    for (let k = 0; k < PARTS; k++) {
      const p = this.parts[k];
      let any = false;
      for (const v of this.voices) {
        if (v.part !== k) continue;
        if (!any) {
          TL.fill(0, 0, len);
          TR.fill(0, 0, len);
          any = true;
        }
        const lf = v.tone.lfo,
          depth = lf.delay > 0 ? Math.min(1, v.age / lf.delay) : 1,
          /* 打楽器は音ごとに、鳴り始めから音色の速さで揺らす（パートの LFO は使わない） */
          w = (k === DRUM_PART ? Math.sin(TAU * lf.rate * v.age) : lfo[k]) * depth,
          cents = w * lf.vib + (k === DRUM_PART ? 0 : p.bend * BEND_RANGE * 100),
          f = noteHz(v.pitch) * 2 ** (cents / 1200),
          am = lf.trem > 0 ? 10 ** ((lf.trem * (w - depth)) / 2 / 20) : 1,
          [gl, gr] = gains[k];
        v.render(TL, TR, len, f / this.sr, am, gl, gr);
      }
      if (!any) continue;
      for (let i = 0; i < len; i++) {
        L[i] += TL[i];
        R[i] += TR[i];
      }
      if (SL && SR && p.rev > 0)
        for (let i = 0; i < len; i++) {
          SL[i] += TL[i] * p.rev;
          SR[i] += TR[i] * p.rev;
        }
    }
    this.voices = this.voices.filter((v) => !v.done);
    /* 直流を取り除く（整流波のキャリアは平均が 0 でない）。直接音と残響へ送る音のそれぞれに 1 次の高域通過 */
    const k = this.dcK,
      z = this.dcZ,
      bufs = [L, R, SL, SR];
    for (let c = 0; c < 4; c++) {
      const b = bufs[c];
      if (!b) continue;
      let x1 = z[2 * c],
        y1 = z[2 * c + 1];
      for (let i = 0; i < len; i++) {
        const x = b[i],
          y = x - x1 + k * y1;
        x1 = x;
        y1 = y;
        b[i] = y;
      }
      z[2 * c] = x1;
      z[2 * c + 1] = y1;
    }
  }
}

/* ---------- 表示 ---------- */
/**
 * 表示用の波形: 鳴り始めから t [s] の時点の大きさ（エンベロープ）で、periods 周期ぶんを 1 周期 pts 点で計算する。
 * 位相は 0 から始め、帰還も 0 から積み上げる。hold は離した時刻（押したままなら Infinity）
 */
export function snapshot(
  tone: Tone,
  t: number,
  hold: number,
  vel: number,
  note: number,
  periods = 2,
  pts = 256,
): Float32Array {
  const n = periods * pts,
    L = new Float32Array(n),
    R = new Float32Array(n),
    v = new Voice(0, note, vel, tone, 0, pts);
  for (let k = 0; k < 4; k++) {
    v.freeze(k, envAt(tone.ops[k], t, hold, tone.key ?? note, vel));
    /* デチューンは、時刻 t までにずれた位相から始めて、うなりの進み具合を見せる（描く 2 周期の間のずれは省く） */
    const dt = tone.ops[k].dt ?? 0;
    v.ph[k] = dt * t - Math.floor(dt * t);
    v.dInc[k] = 0;
  }
  v.render(L, R, n, 1 / pts, 1, 1, 0);
  return L;
}

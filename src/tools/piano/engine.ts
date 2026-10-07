/**
 * ピアノの音を作る部分（DOM に依存しない）。AudioWorklet（worklet.ts）と、表示用の計算（worker.ts）で同じものを使う。
 * 打鍵ごとの結合したモードを減衰する複素指数で回し、駒にかかる力を響板のモードと高い周波数の滑らかな特性へ入れて、
 * 1 m 先の音圧を出す。出力は 1 Pa を 1（フルスケール）とする。
 * ダンパーは鍵ごとに持ち、鍵を離していてペダルも踏んでいなければ、その鍵の弦のモードに減衰を足す。
 * ステレオ（再生だけ）では、鍵の位置で定位を変え（低音が左）、響板のモードごとにも少し散らす。
 * 定位は聞こえ方の目安で、模型には基づかない。モノラル（表示用の計算）は重みがすべて 1
 */

import { rng } from '../guitar/body';
import { panGains } from '../guitar/engine';
import type { StrikeMsg } from './model';
import { type Board, F_TOP, hfPressure } from './soundboard';
import { KEY_HI, KEY_LO, KEYS } from './strings';

/** 響板（AudioWorklet へ送れる形） */
export interface BoardDesc {
  /** モード: 極（実部・虚部）、速度 ÷ 力の留数（実部・虚部）、音圧の重み */
  st: number[];
  /** 高い周波数の滑らかな特性の大きさ（音圧 ÷ 力 [Pa/N]。HF_F0 から 1/HF_OCT オクターブごと） */
  hf: number[];
}
const ST = 5;
/** 高い周波数の滑らかな特性の表: 最初の周波数 [Hz]、1 オクターブあたりの点の数、点の数（25 Hz〜約 24 kHz） */
const HF_F0 = 25,
  HF_OCT = 12,
  HF_N = 120;

/** 響板の模型を、音を作る部分へ渡す形にする */
export function boardDesc(b: Board): BoardDesc {
  const st: number[] = [];
  for (const m of b.modes) {
    const wk = 2 * Math.PI * m.f,
      lr = (-m.eta * wk) / 2,
      li = wk * Math.sqrt(1 - (m.eta * m.eta) / 4),
      d = 2 * li * m.m;
    st.push(lr, li, li / d, -lr / d, m.G);
  }
  /* 高い周波数: 平均のアドミタンス × 放射の重み（周波数ごとの大きさ。位相は AudioWorklet で最小位相にする） */
  return { st, hf: Array.from({ length: HF_N }, (_, i) => hfPressure(b, HF_F0 * 2 ** (i / HF_OCT))) };
}

/** その場で変換する複素 FFT（基数 2。inv なら逆変換で 1/N を掛ける） */
function fft(re: Float64Array, im: Float64Array, inv = false): void {
  const n = re.length,
    cs = new Float64Array(n / 2),
    sn = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cs[k] = Math.cos((2 * Math.PI * k) / n);
    sn[k] = (inv ? 1 : -1) * Math.sin((2 * Math.PI * k) / n);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const h = len >> 1,
      step = n / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < h; k++) {
        const wr = cs[k * step],
          wi = sn[k * step],
          p = i + k,
          q = p + h,
          tr = re[q] * wr - im[q] * wi,
          ti = re[q] * wi + im[q] * wr;
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
      }
  }
  if (inv)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

/**
 * 大きさの表（BoardDesc.hf）から、長さ L の最小位相の FIR を作る（実ケプストラムを折り返す方法。
 * Oppenheim・Schafer）。響板のモードの経路と同じく、遅れの少ない因果的な応答になる
 */
export function minPhaseFir(tab: readonly number[], fs: number, L: number): Float64Array<ArrayBuffer> {
  const N = 4096,
    re = new Float64Array(N),
    im = new Float64Array(N),
    top = Math.max(...tab),
    floor = top * 1e-6,
    at = (f: number) => {
      const x = Math.min(HF_N - 1, Math.max(0, HF_OCT * Math.log2(Math.max(f, 1) / HF_F0))),
        i = Math.min(HF_N - 2, Math.floor(x)),
        u = x - i;
      return Math.log(Math.max(floor, tab[i])) * (1 - u) + Math.log(Math.max(floor, tab[i + 1])) * u;
    };
  for (let k = 0; k <= N / 2; k++) {
    re[k] = at((k * fs) / N);
    if (k > 0 && k < N / 2) re[N - k] = re[k];
  }
  fft(re, im, true);
  /* 実ケプストラムを正の時間へ折り返す */
  for (let k = 1; k < N / 2; k++) re[k] *= 2;
  for (let k = N / 2 + 1; k < N; k++) re[k] = 0;
  im.fill(0);
  fft(re, im);
  for (let k = 0; k < N; k++) {
    const e = Math.exp(re[k]);
    re[k] = e * Math.cos(im[k]);
    im[k] = e * Math.sin(im[k]);
  }
  fft(re, im, true);
  /* 末尾の 1/4 を半分のハン窓で 0 へ下ろす */
  const h = new Float64Array(L),
    t0 = Math.floor(L * 0.75);
  for (let i = 0; i < L; i++) h[i] = re[i] * (i < t0 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (i - t0)) / (L - t0)));
  return h;
}

/** 1 Pa を出力の 1 とする */
export const P_REF = 1;
/** 消すモードの大きさの下限 [N]（多すぎるときは引き上げる） */
const FLOOR = 2e-6;
/** 打った時点で、最も大きいモードに対してこれより小さいモードは回さない（−70 dB） */
const REL = 3e-4;
/** 同時に回すモードの数の目安（超えると小さいモードから消す） */
const MAX_MODES = 4000;

class Voice {
  n: number;
  zr: Float64Array;
  zi: Float64Array;
  mr: Float64Array;
  mi: Float64Array;
  own: Int16Array;
  /** ダンパーが触れているときに掛ける 1 標本あたりの値と、今触れているか */
  dm: Float64Array;
  on: Uint8Array;
  constructor(
    p: StrikeMsg,
    fs: number,
    readonly g: readonly number[],
    damped: (k: number) => boolean,
  ) {
    const N = p.N,
      T = 1 / fs;
    let top = 0;
    for (let i = 0; i < N; i++) top = Math.max(top, Math.hypot(p.fr[i], p.fi[i]));
    const lim = Math.max(FLOOR, REL * top);
    this.zr = new Float64Array(N);
    this.zi = new Float64Array(N);
    this.mr = new Float64Array(N);
    this.mi = new Float64Array(N);
    this.own = new Int16Array(N);
    this.dm = new Float64Array(N);
    this.on = new Uint8Array(N);
    let k = 0;
    for (let i = 0; i < N; i++) {
      if (p.w[i] * T > Math.PI * 0.95 || Math.hypot(p.fr[i], p.fi[i]) < lim) continue;
      const e = Math.exp(-p.s[i] * T);
      this.zr[k] = p.fr[i];
      this.zi[k] = p.fi[i];
      this.mr[k] = e * Math.cos(p.w[i] * T);
      this.mi[k] = e * Math.sin(p.w[i] * T);
      this.own[k] = p.own[i];
      this.dm[k] = Math.exp(-p.sd[i] * T);
      if (damped(p.own[i]) && this.dm[k] < 1) {
        this.on[k] = 1;
        this.mr[k] *= this.dm[k];
        this.mi[k] *= this.dm[k];
      }
      k++;
    }
    this.n = k;
  }
  /** 鍵 key のダンパーを当てる・離す */
  damp(key: number, on: boolean): void {
    for (let i = 0; i < this.n; i++) {
      if (this.own[i] !== key || this.on[i] === +on || this.dm[i] === 1) continue;
      const k = on ? this.dm[i] : 1 / this.dm[i];
      this.mr[i] *= k;
      this.mi[i] *= k;
      this.on[i] = +on;
    }
  }
  /** 小さくなったモードを外す */
  prune(floor: number): void {
    let k = 0;
    const { zr, zi, mr, mi, own, dm, on } = this,
      f2 = floor * floor;
    for (let i = 0; i < this.n; i++) {
      if (zr[i] * zr[i] + zi[i] * zi[i] < f2) continue;
      zr[k] = zr[i];
      zi[k] = zi[i];
      mr[k] = mr[i];
      mi[k] = mi[i];
      own[k] = own[i];
      dm[k] = dm[i];
      on[k] = on[i];
      k++;
    }
    this.n = k;
  }
}

/** 響板へ足す力（衝突の間の力など） */
interface Push {
  buf: Float32Array;
  pos: number;
  g: readonly number[];
}

/** 鍵の定位（低音が左、高音が右） */
export const keyPan = (key: number): number => -0.55 + (1.1 * (key - KEY_LO)) / (KEY_HI - KEY_LO);
/** 響板のモードの定位の広がり */
const panSpread = (f: number) => 0.2 + (0.4 * f) / (f + 800);

/** 2 次の IIR（転置直接形 II） */
class Biquad {
  z1 = 0;
  z2 = 0;
  constructor(readonly c: readonly number[]) {}
  step(x: number): number {
    const [b0, b1, b2, a1, a2] = this.c,
      y = b0 * x + this.z1;
    this.z1 = b1 * x - a1 * y + this.z2;
    this.z2 = b2 * x - a2 * y;
    return y;
  }
}
/** 2 次のバターワースの低域通過（双 1 次変換） */
function lp2(f: number, fs: number): number[] {
  const K = Math.tan((Math.PI * f) / fs),
    n = 1 / (1 + Math.SQRT2 * K + K * K);
  return [K * K * n, 2 * K * K * n, K * K * n, 2 * (K * K - 1) * n, (1 - Math.SQRT2 * K + K * K) * n];
}

/** 出力の 1 チャンネルぶんの、駒の力と響板の状態 */
class Chan {
  sQr = new Float64Array(0);
  sQi = new Float64Array(0);
  sW = new Float64Array(0);
  /** 高い周波数の経路の FIR へ入れた力（前の L − 1 標本と、今のブロック） */
  hx = new Float64Array(0);
  /** モードの経路の 4 次の Linkwitz–Riley の低域通過（2 次のバターワースを 2 段） */
  lp: Biquad[] = [];
  readonly f = new Float64Array(128);
}

/** 高い周波数の経路の FIR の長さ（48 kHz で） */
const HF_L = 128;

export class Engine {
  private voices: Voice[] = [];
  private pushes: Push[] = [];
  private nst = 0;
  private sEr = new Float64Array(0);
  private sEi = new Float64Array(0);
  private sBr = new Float64Array(0);
  private sBi = new Float64Array(0);
  private sRr = new Float64Array(0);
  private sRi = new Float64Array(0);
  private sG = new Float64Array(0);
  private hfH = new Float64Array(0);
  private readonly ch: Chan[];
  private readonly vf = new Float64Array(128);
  /** 鍵を押しているか・ペダル */
  private readonly held = new Uint8Array(KEYS);
  private pedal = false;
  private floor = FLOOR;
  /** すべて止めたときに響板の振動に掛ける 1 標本あたりの値と、残りの標本数 */
  private fadeK = 1;
  private fadeN = 0;

  constructor(
    readonly fs: number,
    readonly stereo = false,
  ) {
    this.ch = stereo ? [new Chan(), new Chan()] : [new Chan()];
  }

  private gains(pan: number): readonly number[] {
    return this.stereo ? panGains(pan) : [1];
  }

  /** ダンパーが弦に触れているか（鍵を離していて、ペダルを踏んでおらず、ダンパーのある鍵） */
  damped(key: number): boolean {
    return !this.held[key - KEY_LO] && !this.pedal;
  }

  setBoard(d: BoardDesc): void {
    const T = 1 / this.fs,
      m = d.st.length / ST;
    this.nst = m;
    for (const k of ['sEr', 'sEi', 'sBr', 'sBi', 'sRr', 'sRi', 'sG'] as const) this[k] = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const o = k * ST,
        lr = d.st[o],
        li = d.st[o + 1],
        e = Math.exp(lr * T),
        er = e * Math.cos(li * T),
        ei = e * Math.sin(li * T),
        nr = er - 1,
        dd = lr * lr + li * li;
      this.sEr[k] = er;
      this.sEi[k] = ei;
      this.sBr[k] = (nr * lr + ei * li) / dd;
      this.sBi[k] = (ei * lr - nr * li) / dd;
      this.sRr[k] = d.st[o + 2];
      this.sRi[k] = d.st[o + 3];
      this.sG[k] = d.st[o + 4];
    }
    const r = rng(23),
      pan = Array.from({ length: m }, (_, k) => panSpread(d.st[k * ST + 1] / (2 * Math.PI)) * (2 * r() - 1));
    const L = 8 * Math.round((HF_L * this.fs) / 48000 / 8);
    this.hfH = minPhaseFir(d.hf, this.fs, L);
    this.ch.forEach((c, n) => {
      c.sQr = new Float64Array(m);
      c.sQi = new Float64Array(m);
      c.sW = Float64Array.from(pan, (q) => (this.stereo ? panGains(q)[n] : 1));
      c.hx = new Float64Array(L - 1 + 128);
      c.lp = [new Biquad(lp2(F_TOP, this.fs)), new Biquad(lp2(F_TOP, this.fs))];
    });
  }

  /** 鍵を打つ（pan はステレオの定位） */
  strike(p: StrikeMsg, pan = keyPan(p.key)): void {
    this.held[p.key - KEY_LO] = 1;
    this.applyDamp(p.key);
    const g = this.gains(pan);
    this.voices.push(new Voice(p, this.fs, g, (k) => this.damped(k)));
    this.pushes.push({ buf: p.att, pos: 0, g });
  }

  /** 鍵を離す */
  release(key: number): void {
    this.held[key - KEY_LO] = 0;
    this.applyDamp(key);
  }

  /** ペダルを踏む・離す */
  setPedal(on: boolean): void {
    if (on === this.pedal) return;
    this.pedal = on;
    for (let k = KEY_LO; k <= KEY_HI; k++) this.applyDamp(k);
  }

  /** すべての鍵とペダルを離し、すべての音を止める（時定数 tau [s]） */
  stopAll(tau = 0.08): void {
    this.held.fill(0);
    this.pedal = false;
    const g = Math.exp(-1 / (tau * this.fs));
    for (const v of this.voices)
      for (let i = 0; i < v.n; i++) {
        v.mr[i] *= g;
        v.mi[i] *= g;
      }
    this.pushes = [];
    /* 響板の低いモードも同じ速さで止める（手で押さえるのと同じ） */
    this.fadeK = g;
    this.fadeN = Math.round(14 * tau * this.fs);
  }

  private applyDamp(key: number): void {
    const on = this.damped(key);
    for (const v of this.voices) v.damp(key, on);
  }

  /** 鳴っている鍵の集合 */
  active(): Set<number> {
    const s = new Set<number>();
    for (const v of this.voices) for (let i = 0; i < v.n; i++) s.add(v.own[i]);
    return s;
  }

  /** 回しているモードの数 */
  modeCount(): number {
    return this.voices.reduce((a, v) => a + v.n, 0);
  }

  /** out[off] から len 標本を書く（上書き）。len は 128 以下。ステレオなら左を out、右を outR に書く */
  render(out: Float32Array | Float64Array, off: number, len: number, outR?: Float32Array | Float64Array): void {
    const { ch, vf } = this;
    for (const c of ch) c.f.fill(0, 0, len);
    let total = 0;
    for (const v of this.voices) {
      const { zr, zi, mr, mi } = v;
      vf.fill(0, 0, len);
      let k = 0;
      /* 2 つずつ回す（依存のない計算を並べて速くする） */
      for (; k + 1 < v.n; k += 2) {
        let r0 = zr[k],
          i0 = zi[k],
          r1 = zr[k + 1],
          i1 = zi[k + 1];
        const a0 = mr[k],
          b0 = mi[k],
          a1 = mr[k + 1],
          b1 = mi[k + 1];
        for (let i = 0; i < len; i++) {
          vf[i] += r0 + r1;
          const t0 = r0 * a0 - i0 * b0;
          i0 = r0 * b0 + i0 * a0;
          r0 = t0;
          const t1 = r1 * a1 - i1 * b1;
          i1 = r1 * b1 + i1 * a1;
          r1 = t1;
        }
        zr[k] = r0;
        zi[k] = i0;
        zr[k + 1] = r1;
        zi[k + 1] = i1;
      }
      for (; k < v.n; k++) {
        let r = zr[k],
          im = zi[k];
        const a = mr[k],
          b = mi[k];
        for (let i = 0; i < len; i++) {
          vf[i] += r;
          const t = r * a - im * b;
          im = r * b + im * a;
          r = t;
        }
        zr[k] = r;
        zi[k] = im;
      }
      ch.forEach((c, n) => {
        const g = v.g[n];
        for (let i = 0; i < len; i++) c.f[i] += g * vf[i];
      });
      v.prune(this.floor);
      total += v.n;
    }
    this.voices = this.voices.filter((v) => v.n > 0);
    /* 多すぎれば消す下限を上げ、余裕があれば戻す */
    if (total > MAX_MODES) this.floor *= 1.25;
    else if (this.floor > FLOOR) this.floor = Math.max(FLOOR, this.floor * 0.98);
    for (const p of this.pushes) {
      const n = Math.min(len, p.buf.length - p.pos);
      ch.forEach((c, j) => {
        for (let i = 0; i < n; i++) c.f[i] += p.g[j] * p.buf[p.pos + i];
      });
      p.pos += n;
    }
    this.pushes = this.pushes.filter((p) => p.pos < p.buf.length);
    this.board(ch[0], out, off, len);
    if (ch[1]) this.board(ch[1], outR ?? out, off, len);
    if (this.fadeN > 0) {
      const k = this.fadeK ** len;
      for (const c of ch)
        for (let i = 0; i < this.nst; i++) {
          c.sQr[i] *= k;
          c.sQi[i] *= k;
        }
      this.fadeN -= len;
    }
  }

  /** 1 チャンネルの駒の力から響板を回して、音圧を out[off] から len 標本書く */
  private board(c: Chan, out: Float32Array | Float64Array, off: number, len: number): void {
    const { f } = c,
      { sEr, sEi, sBr, sBi, sRr, sRi, sG } = this,
      { sQr, sQi, sW } = c;
    /* 高い周波数の経路（FIR）。hx の先頭 L − 1 標本は前のブロックの終わり */
    const h = this.hfH,
      L = h.length,
      hx = c.hx;
    for (let i = 0; i < len; i++) hx[L - 1 + i] = f[i];
    for (let i = 0; i < len; i++) {
      let x = 0;
      for (let j = 0, k = L - 1 + i; j < L; j++, k--) x += h[j] * hx[k];
      out[off + i] = x;
    }
    hx.copyWithin(0, len, len + L - 1);
    const y = this.vf;
    y.fill(0, 0, len);
    let k = 0;
    /* 2 つずつ回す */
    for (; k + 1 < this.nst; k += 2) {
      let qr = sQr[k],
        qi = sQi[k],
        pr = sQr[k + 1],
        pi = sQi[k + 1];
      const er = sEr[k],
        ei = sEi[k],
        br = sBr[k],
        bi = sBi[k],
        gr = 2 * sG[k] * sRr[k] * sW[k],
        gi = 2 * sG[k] * sRi[k] * sW[k],
        fr = sEr[k + 1],
        fi = sEi[k + 1],
        cr = sBr[k + 1],
        ci = sBi[k + 1],
        hr = 2 * sG[k + 1] * sRr[k + 1] * sW[k + 1],
        hi = 2 * sG[k + 1] * sRi[k + 1] * sW[k + 1];
      for (let i = 0; i < len; i++) {
        const d = f[i],
          t = qr * er - qi * ei + br * d,
          u = pr * fr - pi * fi + cr * d;
        qi = qr * ei + qi * er + bi * d;
        qr = t;
        pi = pr * fi + pi * fr + ci * d;
        pr = u;
        y[i] += gr * qr - gi * qi + hr * pr - hi * pi;
      }
      sQr[k] = qr;
      sQi[k] = qi;
      sQr[k + 1] = pr;
      sQi[k + 1] = pi;
    }
    for (; k < this.nst; k++) {
      let qr = sQr[k],
        qi = sQi[k];
      const er = sEr[k],
        ei = sEi[k],
        br = sBr[k],
        bi = sBi[k],
        gr = 2 * sG[k] * sRr[k] * sW[k],
        gi = 2 * sG[k] * sRi[k] * sW[k];
      for (let i = 0; i < len; i++) {
        const d = f[i],
          t = qr * er - qi * ei + br * d;
        qi = qr * ei + qi * er + bi * d;
        qr = t;
        y[i] += gr * qr - gi * qi;
      }
      sQr[k] = qr;
      sQi[k] = qi;
    }
    const [l1, l2] = c.lp;
    for (let i = 0; i < len; i++) out[off + i] += l2.step(l1.step(y[i]));
    if (P_REF !== 1) for (let i = 0; i < len; i++) out[off + i] /= P_REF;
  }
}

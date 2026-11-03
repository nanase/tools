/**
 * 復号した音の評価（DOM に依存しない）。NMR の閾値は Johnston (1988) の式で、エンコーダの心理モデルとは別の式にする
 * （自分の答えを自分で採点しないため）。あわせて遅れの検出とスペクトログラムを置く
 */
import { fft } from '../pcm/pcm';
import { FS } from './encoder';
import { ath, FULL_SCALE_SPL } from './psy';

const PI = Math.PI,
  NF = 2048,
  NB = NF / 2 + 1,
  HOP = 1024;
const WIN = Float64Array.from({ length: NF }, (_, i) => 0.5 - 0.5 * Math.cos((2 * PI * (i + 0.5)) / NF)),
  NORM = (2 / (NF * 0.5)) ** 2 * 0.5;
const barkZ = (f: number) => 7 * Math.asinh(f / 650);
/** 1/2 バークの帯 */
const BAND = Int32Array.from({ length: NB }, (_, i) => Math.floor(barkZ((i * FS) / NF) * 2));
export const NBANDS = BAND[NB - 1] + 1;
/** 帯の上端 [Hz] */
export const BAND_HI = new Float64Array(NBANDS);
const QT = new Float64Array(NBANDS);
for (let i = 1; i < NB; i++) {
  const f = (i * FS) / NF,
    b = BAND[i];
  BAND_HI[b] = Math.max(BAND_HI[b], f + FS / NF / 2);
  QT[b] += 10 ** ((ath(f) - FULL_SCALE_SPL) / 10);
}
/** 周波数を含む帯 */
export const bandOf = (f: number): number => {
  let b = 0;
  while (b < NBANDS - 1 && BAND_HI[b] < f) b++;
  return b;
};
/** 帯の幅を 1/2 バークとした広がりの傾き [dB/Bark] */
const SLOPE_LOW = 27,
  SLOPE_UP = 24;

export interface Evaluation {
  /** 時間の枠の数（1024 サンプルごと） */
  T: number;
  /** [枠][帯] の 雑音 / 閾値 */
  ratio: Float32Array;
  /** 雑音 / 閾値 の平均 [dB] */
  nmr: number;
  /** 閾値を超えたマスの割合（ローパスより下、無音を除く） */
  over: number;
}

/** 原音と復号した音（遅れは合わせ済み）を比べる */
export function evaluate(orig: Float32Array, dec: Float32Array, cutHz: number): Evaluation {
  const n = Math.min(orig.length, dec.length),
    T = Math.max(1, Math.floor((n - NF) / HOP) + 1),
    ratio = new Float32Array(T * NBANDS),
    re = new Float64Array(NF),
    im = new Float64Array(NF),
    o = new Float64Array(NBANDS),
    e = new Float64Array(NBANDS),
    m = new Float64Array(NBANDS),
    ln = new Float64Array(NBANDS),
    cn = new Float64Array(NBANDS);
  let sum = 0,
    frames = 0,
    over = 0,
    cells = 0;
  for (let t = 0; t < T; t++) {
    const s = t * HOP;
    let en = 0;
    for (let i = 0; i < NF; i++) {
      const a = s + i < n ? orig[s + i] : 0,
        d = s + i < n ? dec[s + i] : 0;
      en += a * a;
      re[i] = a * WIN[i];
      im[i] = (a - d) * WIN[i];
    }
    fft(re, im);
    o.fill(0);
    e.fill(0);
    m.fill(0);
    ln.fill(0);
    cn.fill(0);
    /* 実数 2 本（原音と差）を 1 回の FFT で分ける */
    for (let i = 1; i < NF / 2; i++) {
      const a = re[i],
        b = im[i],
        c = re[NF - i],
        d = im[NF - i],
        px = (((a + c) / 2) ** 2 + ((b - d) / 2) ** 2) * NORM,
        k = BAND[i];
      o[k] += px;
      e[k] += (((b + d) / 2) ** 2 + ((c - a) / 2) ** 2) * NORM;
      ln[k] += Math.log(px + 1e-20);
      cn[k]++;
    }
    for (let j = 0; j < NBANDS; j++) {
      if (o[j] <= 0) continue;
      /* ±1 バークの平坦度から調性を見て、閾値のオフセットを決める */
      let sl = 0,
        sp = 0,
        sc = 0;
      for (let q = Math.max(0, j - 2); q <= Math.min(NBANDS - 1, j + 2); q++) {
        sl += ln[q];
        sp += o[q];
        sc += cn[q];
      }
      const sfm = sc > 1 && sp > 0 ? 10 * Math.log10(Math.exp(sl / sc) / (sp / sc) + 1e-12) : 0,
        al = Math.min(1, Math.max(0, sfm / -60)),
        z = j / 2,
        base = o[j] * 10 ** (-(al * (14.5 + z) + (1 - al) * 5.5) / 10);
      for (let k = Math.max(0, j - 4); k < NBANDS; k++) {
        const dz = (k - j) / 2,
          db = dz < 0 ? SLOPE_LOW * dz : -SLOPE_UP * dz;
        if (db < -60) break;
        m[k] += base * 10 ** (db / 10);
      }
    }
    const loud = en / NF > 1e-7;
    let fs = 0;
    for (let j = 0; j < NBANDS; j++) {
      const q = e[j] / Math.max(m[j], QT[j]);
      ratio[t * NBANDS + j] = q;
      fs += q;
      if (loud && (!cutHz || BAND_HI[j] <= cutHz)) {
        cells++;
        if (q > 1) over++;
      }
    }
    if (loud) {
      sum += fs / NBANDS;
      frames++;
    }
  }
  return { T, ratio, nmr: 10 * Math.log10(sum / Math.max(1, frames) + 1e-12), over: cells ? over / cells : 0 };
}

/** 最も音の大きい所で相関を取り、b が a より遅れているサンプル数を返す */
export function findDelay(a: Float32Array, b: Float32Array, min = -300, max = 3000): number {
  const LEN = 6000;
  let st = 0,
    be = -1;
  for (let s = 0; s + LEN < a.length; s += LEN / 2) {
    let e = 0;
    for (let i = s; i < s + LEN; i += 8) e += a[i] * a[i];
    if (e > be) {
      be = e;
      st = s;
    }
  }
  let best = 0,
    bs = Number.NEGATIVE_INFINITY;
  const end = Math.min(a.length, st + LEN);
  for (let d = min; d < max; d++) {
    let v = 0;
    for (let i = st; i < end; i++) {
      const j = i + d;
      if (j >= 0 && j < b.length) v += a[i] * b[j];
    }
    if (v > bs) {
      bs = v;
      best = d;
    }
  }
  return best;
}

/** d サンプル前へずらして長さ n にそろえる */
export function shifted(b: Float32Array, d: number, n: number): Float32Array {
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i + d;
    o[i] = j >= 0 && j < b.length ? b[j] : 0;
  }
  return o;
}

export interface Spectrogram {
  T: number;
  R: number;
  /** [時刻][周波数] の dB */
  d: Float32Array;
}
const SGN = 1024,
  SG_HOP = 512,
  SGR = 256;
const SG_WIN = Float64Array.from({ length: SGN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * PI * (i + 0.5)) / SGN));
/** 時間の 1 枠の長さ [s] */
export const SG_DT = SG_HOP / FS;

/** スペクトログラム（線形の周波数、256 段） */
export function spectrogram(x: Float32Array): Spectrogram {
  const T = Math.max(1, Math.floor((x.length - SGN) / SG_HOP) + 1),
    d = new Float32Array(T * SGR),
    re = new Float64Array(SGN),
    im = new Float64Array(SGN),
    g = (2 / (SGN * 0.5)) ** 2 * 0.5;
  for (let t = 0; t < T; t++) {
    const o = t * SG_HOP;
    for (let i = 0; i < SGN; i++) {
      re[i] = (o + i < x.length ? x[o + i] : 0) * SG_WIN[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let r = 0; r < SGR; r++) {
      const a = r * 2 + 1,
        p = (re[a] ** 2 + im[a] ** 2 + re[a + 1] ** 2 + im[a + 1] ** 2) * g * 0.5;
      d[t * SGR + r] = 10 * Math.log10(p + 1e-14);
    }
  }
  return { T, R: SGR, d };
}

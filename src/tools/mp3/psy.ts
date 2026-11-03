/**
 * 心理音響モデル（DOM に依存しない）。ISO/IEC 11172-3 の Model 2 の考え方を簡略にしたもの:
 * FFT → 1/3 バークの帯 → 位相の予測で調性を見る → 広がりを畳み込む → 帯ごとの信号対マスク比
 */
import { fft } from '../pcm/pcm';

const PI = Math.PI;
/** 周波数からバークへ（Zwicker と Terhardt） */
const bark = (f: number) => 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2);
/** 絶対閾値（Terhardt）[dB SPL]。フルスケールを 96 dB に置く */
export const ath = (f: number): number => {
  const k = Math.max(f, 20) / 1000;
  return 3.64 * k ** -0.8 - 6.5 * Math.exp(-0.6 * (k - 3.3) ** 2) + 1e-3 * k ** 4;
};
export const FULL_SCALE_SPL = 96;

/** 広がり関数（Schroeder）。dz は影響する先までのバーク */
const spread = (dz: number) => 10 ** ((15.81 + 7.5 * (dz + 0.474) - 17.5 * Math.sqrt(1 + (dz + 0.474) ** 2)) / 10);
/** 純音・雑音のマスカーの信号対マスク比 [dB] */
const TMN = 29,
  NMT = 6;

export interface PsyTable {
  N: number;
  nb: number;
  part: Int32Array;
  lo: Int32Array;
  hi: Int32Array;
  P: number;
  S: Float64Array;
  /** 帯 j が受ける広がりの範囲 */
  sLo: Int32Array;
  sHi: Int32Array;
  norm: Float64Array;
  qt: Float64Array;
  lim: Float64Array;
  win: Float64Array;
}

/** N 点の FFT の帯と、sfb（線番号の境界）の対応を作る */
export function psyTable(N: number, fs: number, sfb: readonly number[]): PsyTable {
  const nb = N / 2 + 1,
    z = Float64Array.from({ length: nb }, (_, i) => bark((i * fs) / N)),
    part = new Int32Array(nb),
    los: number[] = [],
    his: number[] = [],
    zs: number[] = [];
  let cur = -1,
    last = -9;
  for (let i = 1; i < nb; i++) {
    if (z[i] - last >= 1 / 3 || cur < 0) {
      cur++;
      last = z[i];
      los.push(i);
      his.push(i);
      zs.push(z[i]);
    }
    part[i] = cur;
    his[cur] = i;
  }
  const P = los.length,
    S = new Float64Array(P * P),
    sLo = new Int32Array(P).fill(P),
    sHi = new Int32Array(P).fill(-1),
    norm = new Float64Array(P);
  for (let i = 0; i < P; i++)
    for (let j = 0; j < P; j++) {
      const dz = zs[j] - zs[i];
      if (dz < -3 || dz > 8) continue;
      S[j * P + i] = spread(dz);
      sLo[j] = Math.min(sLo[j], i);
      sHi[j] = Math.max(sHi[j], i);
    }
  for (let j = 0; j < P; j++) {
    let s = 0;
    for (let i = 0; i < P; i++) s += S[j * P + i];
    norm[j] = 1 / s;
  }
  const end = sfb[sfb.length - 1];
  return {
    N,
    nb,
    part,
    lo: Int32Array.from(los),
    hi: Int32Array.from(his),
    P,
    S,
    sLo,
    sHi,
    norm,
    qt: Float64Array.from({ length: nb }, (_, i) => 10 ** ((ath((i * fs) / N) - FULL_SCALE_SPL) / 10)),
    lim: Float64Array.from(sfb, (v) => (v / end) * (N / 2)),
    win: Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * PI * (i + 0.5)) / N)),
  };
}

export interface PsyPrev {
  r1: Float64Array;
  r2: Float64Array;
  p1: Float64Array;
  p2: Float64Array;
}
export interface PsyOut {
  /** sfb ごとの 閾値 / エネルギー（1 以下） */
  ratio: Float64Array;
  r: Float64Array;
  ph: Float64Array;
}

/** 中心が center の窓で解析する。prev は前の 2 回の振幅と位相（なければ調性を中くらいとみなす） */
export function analyze(tab: PsyTable, x: ArrayLike<number>, center: number, prev: PsyPrev | null): PsyOut {
  const { N, nb, part, P, S, sLo, sHi, norm, qt, lim, win, lo, hi } = tab,
    re = new Float64Array(N),
    im = new Float64Array(N),
    start = center - N / 2;
  for (let i = 0; i < N; i++) {
    const j = start + i;
    re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
  }
  fft(re, im);
  /* 振幅 1 の正弦波の合計が約 1 になる正規化（ハン窓の利得は 0.5） */
  const g = (2 / (N * 0.5)) ** 2 * 0.5,
    r = new Float64Array(nb),
    ph = new Float64Array(nb),
    pw = new Float64Array(nb),
    eb = new Float64Array(P),
    cb0 = new Float64Array(P);
  for (let i = 0; i < nb; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    r[i] = Math.sqrt(p);
    ph[i] = Math.atan2(im[i], re[i]);
    pw[i] = p * g;
  }
  for (let i = 1; i < nb; i++) {
    let c = 0.4;
    if (prev) {
      const rp = 2 * prev.r1[i] - prev.r2[i],
        pp = 2 * prev.p1[i] - prev.p2[i],
        dx = r[i] * Math.cos(ph[i]) - rp * Math.cos(pp),
        dy = r[i] * Math.sin(ph[i]) - rp * Math.sin(pp),
        d = r[i] + Math.abs(rp);
      c = d > 1e-20 ? Math.min(1, Math.sqrt(dx * dx + dy * dy) / d) : 1;
    }
    const q = part[i];
    eb[q] += pw[i];
    cb0[q] += pw[i] * c;
  }
  const thrP = new Float64Array(P);
  for (let j = 0; j < P; j++) {
    let a = 0,
      b = 0;
    const o = j * P;
    for (let i = sLo[j]; i <= sHi[j]; i++) {
      const s = S[o + i];
      a += s * eb[i];
      b += s * cb0[i];
    }
    const cb = a > 0 ? b / a : 1,
      tb = Math.min(1, Math.max(0, -0.299 - 0.43 * Math.log(Math.max(cb, 1e-6))));
    thrP[j] = a * norm[j] * 10 ** (-(tb * TMN + (1 - tb) * NMT) / 10);
  }
  const n = lim.length - 1,
    ratio = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const a = Math.max(1, Math.floor(lim[s])),
      b = Math.min(nb - 1, Math.max(a, Math.floor(lim[s + 1]) - 1));
    let e = 0,
      t = 0;
    for (let i = a; i <= b; i++) {
      const q = part[i];
      e += pw[i];
      t += Math.max(thrP[q] / (hi[q] - lo[q] + 1), qt[i]);
    }
    ratio[s] = e > 0 ? Math.min(1, t / e) : 1;
  }
  return { ratio, r, ph };
}

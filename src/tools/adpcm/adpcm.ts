/**
 * ADPCM の計算（DOM に依存しない）: IMA の段階の間隔の表で符号化と再生を行う。予測と適応は別々に切れる。
 * 値は 16 ビットの整数で計算し、フルスケールを 32768 として −1〜1 に直して返す。
 * 2・3・5 bit の間隔の増減は Flash（SWF）の ADPCM の表と同じ
 */

/** 段階の間隔の表（IMA。16 ビットの値） */
export const STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
] as const;
/** 表の番号の増減（キーはビット数、添字は符号を除いた大きさ） */
export const INDEX: Readonly<Record<number, readonly number[]>> = {
  2: [-1, 2],
  3: [-1, -1, 2, 4],
  4: [-1, -1, -1, -1, 2, 4, 6, 8],
  5: [-1, -1, -1, -1, -1, -1, -1, -1, 1, 2, 4, 6, 8, 10, 13, 16],
};

export interface AdpSet {
  bits: number;
  /** 前の値から予測するか（false は 0 を予測） */
  pred: boolean;
  /** 段階の間隔を変えるか */
  adapt: boolean;
  /** 適応しないときの間隔（16 ビットの値） */
  fix: number;
}
export interface Adp {
  /** 再生した値 */
  y: Float64Array;
  /** 予測値 */
  p: Float64Array;
  /** 段階の間隔 */
  st: Float64Array;
  /** 記録するビット（上位が正負、残りが大きさ） */
  code: Uint8Array;
  /** 誤差（y − x） */
  e: Float64Array;
  /** SN 比 [dB]（誤差がなければ Infinity） */
  snr: number;
}

const FULL = 32768;
const clip16 = (v: number) => Math.max(-32768, Math.min(32767, v));
const clipIdx = (v: number) => Math.max(0, Math.min(STEP.length - 1, v));

/**
 * 大きさ mag の段階の、予測値からの距離（16 ビットの値）。IMA の整数の計算を N ビットへ広げたもので、
 * およそ (2 × mag + 1) × 間隔 ÷ 2^(N−1)
 */
export function delta(mag: number, step: number, N: number): number {
  let d = step >> (N - 1);
  for (let b = N - 2, s = 0; b >= 0; b--, s++) if ((mag >> b) & 1) d += step >> s;
  return d;
}

/** 予測値から見て最も近い段階を選ぶ。戻り値は [記録するビット, 距離] */
function nearest(diff: number, step: number, N: number): [number, number] {
  const neg = diff < 0,
    a = Math.abs(diff),
    M = (1 << (N - 1)) - 1;
  let mag = 0,
    best = Number.POSITIVE_INFINITY;
  for (let m = 0; m <= M; m++) {
    const r = Math.abs(delta(m, step, N) - a);
    if (r < best) {
      best = r;
      mag = m;
    }
  }
  return [(neg ? 1 << (N - 1) : 0) | mag, delta(mag, step, N)];
}

/** 符号化。戻す値も符号化の中で同じ計算で作る */
export function encode(x: ArrayLike<number>, o: AdpSet): Adp {
  const n = x.length,
    N = o.bits,
    y = new Float64Array(n),
    p = new Float64Array(n),
    st = new Float64Array(n),
    e = new Float64Array(n),
    code = new Uint8Array(n),
    tab = INDEX[N],
    sgn = 1 << (N - 1);
  let last = 0,
    idx = 0,
    ps = 0,
    pe = 0;
  for (let i = 0; i < n; i++) {
    const v = clip16(Math.round(x[i] * FULL)),
      pr = o.pred ? last : 0,
      step = o.adapt ? STEP[idx] : o.fix,
      [c, dq] = nearest(v - pr, step, N);
    last = clip16(c & sgn ? pr - dq : pr + dq);
    y[i] = last / FULL;
    p[i] = pr / FULL;
    st[i] = step / FULL;
    code[i] = c;
    e[i] = y[i] - x[i];
    ps += x[i] * x[i];
    pe += e[i] * e[i];
    if (o.adapt) idx = clipIdx(idx + tab[c & (sgn - 1)]);
  }
  return { y, p, st, code, e, snr: pe > 0 ? 10 * Math.log10(ps / pe) : Number.POSITIVE_INFINITY };
}

/** 記録したビットだけから戻す */
export function decode(code: ArrayLike<number>, o: AdpSet): Float64Array {
  const n = code.length,
    N = o.bits,
    y = new Float64Array(n),
    tab = INDEX[N],
    sgn = 1 << (N - 1);
  let last = 0,
    idx = 0;
  for (let i = 0; i < n; i++) {
    const c = code[i],
      mag = c & (sgn - 1),
      pr = o.pred ? last : 0,
      dq = delta(mag, o.adapt ? STEP[idx] : o.fix, N);
    last = clip16(c & sgn ? pr - dq : pr + dq);
    y[i] = last / FULL;
    if (o.adapt) idx = clipIdx(idx + tab[mag]);
  }
  return y;
}

/** 移動先の時刻 [s]: 音の立ち上がり・静かな所・誤差が最大の所（5 ms ごとの電力で探す） */
export interface Marks {
  up: number;
  low: number;
  big: number;
}
export function marks(s: ArrayLike<number>, e: ArrayLike<number>, fs: number): Marks {
  const hop = Math.max(1, Math.round(fs * 0.005)),
    K = Math.floor(s.length / hop);
  let prev = 0,
    upV = Number.NEGATIVE_INFINITY,
    lowV = Number.POSITIVE_INFINITY,
    bigV = -1,
    up = 0,
    low = 0,
    big = 0;
  for (let k = 0; k < K; k++) {
    let a = 0,
      b = 0;
    for (let i = k * hop; i < (k + 1) * hop; i++) {
      a += s[i] * s[i];
      b += e[i] * e[i];
    }
    if (k && a - prev > upV) {
      upV = a - prev;
      up = k;
    }
    /* 無音は静かな所に数えない */
    if (a / hop > 1e-7 && a < lowV) {
      lowV = a;
      low = k;
    }
    if (b > bigV) {
      bigV = b;
      big = k;
    }
    prev = a;
  }
  const t = (k: number) => (k * hop) / fs;
  return { up: t(up), low: t(low), big: t(big) };
}

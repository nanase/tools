/**
 * FFT と窓関数（DOM に依存しない）。CH1 と CH2 の 2 本の実数列を、1 回の複素 FFT
 * （z = x + j·y）でまとめて変換する
 */

export type Win = 'rect' | 'hann' | 'hamming' | 'blackman' | 'bh' | 'flat';
/** 窓関数: [値, 表示, 略称, 余弦の係数 a0, a1, …]（w[n] = Σ (−1)^k a_k cos(2πkn/N)、DFT 偶の形） */
export const WINS: readonly (readonly [Win, string, string, readonly number[]])[] = [
  ['rect', '矩形', 'RECT', [1]],
  ['hann', 'ハン', 'HANN', [0.5, 0.5]],
  ['hamming', 'ハミング', 'HAMMING', [0.54, 0.46]],
  ['blackman', 'ブラックマン', 'BLACKMAN', [0.42, 0.5, 0.08]],
  ['bh', 'ブラックマン-ハリス', 'B-HARRIS', [0.35875, 0.48829, 0.14128, 0.01168]],
  ['flat', 'フラットトップ', 'FLATTOP', [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368]],
];
export const winOf = (w: Win) => WINS.find((x) => x[0] === w) ?? WINS[1];

export interface WinData {
  w: Float64Array;
  /** Σ w[n] */
  sum: number;
  /** 等価雑音帯域幅（bin）: N Σw² / (Σw)² */
  enbw: number;
  /** コヒーレントゲイン Σw / N */
  cg: number;
}
const winCache = new Map<string, WinData>();
export function winData(name: Win, N: number): WinData {
  const key = `${name}${N}`,
    hit = winCache.get(key);
  if (hit) return hit;
  const c = winOf(name)[3],
    w = new Float64Array(N);
  let s = 0,
    s2 = 0;
  for (let n = 0; n < N; n++) {
    let v = 0;
    for (let k = 0; k < c.length; k++) v += (k % 2 ? -1 : 1) * c[k] * Math.cos((2 * Math.PI * k * n) / N);
    w[n] = v;
    s += v;
    s2 += v * v;
  }
  const r = { w, sum: s, enbw: (N * s2) / (s * s), cg: s / N };
  winCache.set(key, r);
  return r;
}

interface Plan {
  N: number;
  rev: Uint32Array;
  cs: Float64Array;
  sn: Float64Array;
  re: Float64Array;
  im: Float64Array;
}
const plans = new Map<number, Plan>();
function plan(N: number): Plan {
  const hit = plans.get(N);
  if (hit) return hit;
  const bits = Math.round(Math.log2(N));
  if (2 ** bits !== N) throw new Error(`N must be a power of 2: ${N}`);
  const rev = new Uint32Array(N),
    cs = new Float64Array(N / 2),
    sn = new Float64Array(N / 2);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  for (let i = 0; i < N / 2; i++) {
    cs[i] = Math.cos((2 * Math.PI * i) / N);
    sn[i] = -Math.sin((2 * Math.PI * i) / N);
  }
  const p = { N, rev, cs, sn, re: new Float64Array(N), im: new Float64Array(N) };
  plans.set(N, p);
  return p;
}
/** その場で変換する（基数 2、時間間引き） */
function fft(p: Plan): void {
  const { N, rev, cs, sn, re, im } = p;
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1,
      step = N / size;
    for (let i = 0; i < N; i += size)
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j,
          b = a + half,
          wr = cs[k],
          wi = sn[k],
          tr = re[b] * wr - im[b] * wi,
          ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
}

/**
 * x・y の末尾 N 点に窓を掛けて変換し、0〜N/2 の各 bin のパワー（振幅の 2 乗）を px・py に書く。
 * 振幅は 2|X[k]| / Σw（DC と N/2 は |X[k]| / Σw）で、フルスケールの正弦波が 1（0 dBFS）になる
 */
export function spectra(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  N: number,
  win: Win,
  px: Float32Array,
  py: Float32Array,
): void {
  const p = plan(N),
    w = winData(win, N),
    off = x.length - N,
    h = N / 2;
  for (let i = 0; i < N; i++) {
    p.re[i] = x[off + i] * w.w[i];
    p.im[i] = y[off + i] * w.w[i];
  }
  fft(p);
  const g = 1 / (w.sum * w.sum),
    { re, im } = p;
  for (let k = 0; k <= h; k++) {
    const j = (N - k) % N,
      /* X = (Z[k] + conj Z[N−k]) / 2、Y = (Z[k] − conj Z[N−k]) / 2j */
      xr = (re[k] + re[j]) / 2,
      xi = (im[k] - im[j]) / 2,
      yr = (im[k] + im[j]) / 2,
      yi = -(re[k] - re[j]) / 2,
      m = k === 0 || k === h ? g : 4 * g;
    px[k] = (xr * xr + xi * xi) * m;
    py[k] = (yr * yr + yi * yi) * m;
  }
}

/** パワーを dB にする（0 は −200 dB） */
export const toDb = (p: number): number => 10 * Math.log10(p + 1e-20);

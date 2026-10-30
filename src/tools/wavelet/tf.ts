/**
 * 時間と周波数の広がりと STFT（DOM に依存しない）。広がりはエネルギー密度 |g(t)|²・|ĝ(f)|² の標準偏差 σ_t・σ_f。
 * ガウスの窓（Gabor）と Morlet では σ_t σ_f = 1/(4π) で、不確定性の下限にちょうど届く
 */
import { fft, plan } from '../spectrum/fft';
import { fourierFactor, W0 } from './cwt';

/** 不確定性の下限 σ_t σ_f ≥ 1/(4π) */
export const HEISENBERG = 1 / (4 * Math.PI);

/** ガウスの窓 e^(−t²/(2σ²)) の STFT の箱: σ_t = σ/√2、σ_f = 1/(2π σ √2) */
export const gaborSpread = (sigma: number): [number, number] => [
  sigma / Math.SQRT2,
  1 / (2 * Math.PI * sigma * Math.SQRT2),
];
/**
 * Morlet（尺度 s）の箱: 包絡 e^(−η²/2) から σ_t = s/√2、σ_f = 1/(2π s √2)。
 * 中心の周波数は 1 / (フーリエ周期 1.033 s)
 */
export const morletSpread = (s: number, w0 = W0): { f: number; dt: number; df: number } => ({
  f: 1 / (fourierFactor(w0) * s),
  dt: s / Math.SQRT2,
  df: 1 / (2 * Math.PI * s * Math.SQRT2),
});

/** 窓の形 */
export type StftWin = 'gauss' | 'hann';
/** 窓の値: ガウスは ±4σ で打ち切り（σ = N/8）、ハンは DFT 偶の形 */
export function stftWindow(N: number, w: StftWin): Float64Array {
  return Float64Array.from({ length: N }, (_, n) =>
    w === 'hann' ? 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N) : Math.exp(-0.5 * ((n - N / 2) / (N / 8)) ** 2),
  );
}

/**
 * STFT の 1 列のパワー: x の位置 c を中心に長さ N の窓をかけ、0〜N/2 の |X[k]|² / (Σw)²·4 を out に書く
 * （正弦波の振幅² になる）。範囲の外は 0 とみなす
 */
export function stftColumn(x: ArrayLike<number>, c: number, win: Float64Array, out: Float32Array): void {
  const N = win.length,
    p = plan(N),
    L = x.length,
    o = c - N / 2;
  let sw = 0;
  for (let n = 0; n < N; n++) {
    const i = o + n;
    sw += win[n];
    p.re[n] = i >= 0 && i < L ? x[i] * win[n] : 0;
    p.im[n] = 0;
  }
  fft(p);
  const g = 4 / (sw * sw);
  for (let k = 0; k <= N / 2; k++) out[k] = (p.re[k] ** 2 + p.im[k] ** 2) * g;
}

/** STFT のパワー: 長さ N の窓を hop ずつずらした各列（列の中心は hop·m）。値は stftColumn */
export function stft(x: ArrayLike<number>, N: number, hop: number, w: StftWin = 'hann'): Float32Array[] {
  const win = stftWindow(N, w),
    cols: Float32Array[] = [];
  for (let c = 0; c * hop < x.length; c++) {
    const col = new Float32Array(N / 2 + 1);
    stftColumn(x, c * hop, win, col);
    cols.push(col);
  }
  return cols;
}

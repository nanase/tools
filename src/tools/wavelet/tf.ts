/**
 * 時間と周波数の平面の区切り方（DOM に依存しない）。
 * 箱の幅と高さは、エネルギー密度 |g(t)|²・|ĝ(f)|² の標準偏差 σ_t・σ_f の 2 倍で描く。
 * ガウスの窓（Gabor）と Morlet では σ_t σ_f = 1/(4π) で、不確定性の下限にちょうど届く
 */
import { fft, plan } from '../spectrum/fft';
import { fourierFactor, W0 } from './cwt';
import { type Wav, wavedec } from './dwt';

/** 不確定性の下限 σ_t σ_f ≥ 1/(4π) */
export const HEISENBERG = 1 / (4 * Math.PI);

/** 時間と周波数の箱: 中心 t・f、半幅 dt・df（σ の 1 倍） */
export interface Box {
  t: number;
  f: number;
  dt: number;
  df: number;
  /** 係数の大きさ（描くときの濃さ。区切りだけを描くなら 0） */
  v: number;
}

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

/** 区間 [0, T) と [0, fN) に STFT の箱を敷く（窓の σ、時間の刻み hop、周波数の刻み df） */
export function stftTiles(T: number, fN: number, hop: number, dfStep: number): Box[] {
  const out: Box[] = [];
  for (let t = hop / 2; t < T; t += hop)
    for (let f = dfStep / 2; f < fN; f += dfStep) out.push({ t, f, dt: hop / 2, df: dfStep / 2, v: 0 });
  return out;
}

/**
 * DWT の箱（2 進の区切り）: 長さ N・標本化周波数 fs で、段 j（1 から）の詳細は
 * 周波数 [fs/2^(j+1), fs/2^j)、時間の幅 2^j/fs の箱が N/2^j 個。最後に近似の箱を足す。
 * どの箱も面積 1/2（時間 × 周波数）
 */
export function dwtTiles(N: number, fs: number, J: number, x?: ArrayLike<number>, w: Wav = 'haar'): Box[] {
  const c = x ? wavedec(x, w, J) : null,
    out: Box[] = [];
  J = c ? c.d.length : J;
  for (let j = 1; j <= J; j++) {
    const n = N >> j,
      wd = 2 ** j / fs,
      fl = fs / 2 ** (j + 1),
      d = c?.d[j - 1];
    for (let k = 0; k < n; k++)
      out.push({ t: (k + 0.5) * wd, f: 1.5 * fl, dt: wd / 2, df: fl / 2, v: d ? Math.abs(d[k]) : 0 });
  }
  const n = N >> J,
    wd = 2 ** J / fs,
    fh = fs / 2 ** (J + 1);
  for (let k = 0; k < n; k++)
    out.push({ t: (k + 0.5) * wd, f: fh / 2, dt: wd / 2, df: fh / 2, v: c ? Math.abs(c.a[k]) : 0 });
  return out;
}

/** 窓の形 */
export type StftWin = 'gauss' | 'hann';
/** 窓の値: ガウスは ±4σ で打ち切り（σ = N/8）、ハンは DFT 偶の形 */
export function stftWindow(N: number, w: StftWin): Float64Array {
  return Float64Array.from({ length: N }, (_, n) =>
    w === 'hann' ? 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N) : Math.exp(-0.5 * ((n - N / 2) / (N / 8)) ** 2),
  );
}

/**
 * STFT のパワー: 長さ N の窓を hop ずつずらし、各列の 0〜N/2 の |X[k]|² / (Σw)²·4 を返す（正弦波の振幅² になる）。
 * 列の中心は hop·m（範囲の外は 0 とみなす）
 */
export function stft(x: ArrayLike<number>, N: number, hop: number, w: StftWin = 'hann'): Float32Array[] {
  const p = plan(N),
    win = stftWindow(N, w),
    sw = win.reduce((s, v) => s + v, 0),
    g = 4 / (sw * sw),
    L = x.length,
    cols: Float32Array[] = [];
  for (let c = 0; c * hop < L; c++) {
    const o = c * hop - N / 2;
    for (let n = 0; n < N; n++) {
      const i = o + n;
      p.re[n] = i >= 0 && i < L ? x[i] * win[n] : 0;
      p.im[n] = 0;
    }
    fft(p);
    const col = new Float32Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) col[k] = (p.re[k] ** 2 + p.im[k] ** 2) * g;
    cols.push(col);
  }
  return cols;
}

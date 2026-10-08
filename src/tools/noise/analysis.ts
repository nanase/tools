/**
 * 表示と測定の計算（DOM に依存しない）: 平均したパワースペクトル密度（Welch 法）、1/3 オクターブ帯での傾きの当てはめ、
 * 実効値・ピーク・尖度、振幅の分布。サンプルは長さが 2 の累乗の輪のバッファから読む
 */
import { spectra, winData } from '../spectrum/fft';

/** spectra() のパワー（正弦波の振幅²）を AES17 の dBFS/Hz にするために足す値: −10 log₁₀(ENBW·Δf) */
export const psdOffset = (N: number, fs: number): number => -10 * Math.log10((winData('hann', N).enbw * fs) / N);

/** 輪のバッファ（長さは 2 の累乗）の、通し番号 end の手前 N 点を並べて写す */
export function tail(ring: Float32Array, end: number, N: number, out: Float32Array): void {
  const m = ring.length - 1;
  for (let i = 0; i < N; i++) out[i] = ring[(end - N + i) & m];
}

/**
 * Welch 法の平均: ハン窓、半分ずつ重ねた区間のパワーを平均する。
 * 区間の数が len に届くまでは単純な平均、その後は重み 1/len の指数移動平均
 */
export class Welch {
  readonly P: Float64Array;
  count = 0;
  private readonly seg: Float32Array;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  constructor(
    readonly N: number,
    public len: number,
  ) {
    this.P = new Float64Array(N / 2 + 1);
    this.seg = new Float32Array(N);
    this.px = new Float32Array(N / 2 + 1);
    this.py = new Float32Array(N / 2 + 1);
  }
  reset(): void {
    this.P.fill(0);
    this.count = 0;
  }
  /** 輪のバッファの end の手前 N 点を 1 区間として足す */
  add(ring: Float32Array, end: number): void {
    tail(ring, end, this.N, this.seg);
    spectra(this.seg, this.seg, this.N, 'hann', this.px, this.py);
    this.count++;
    const w = 1 / Math.min(this.count, this.len),
      { P, px } = this;
    for (let k = 0; k < P.length; k++) P[k] += w * (px[k] - P[k]);
  }
}

/** 1 本の区間のパワー（spectra() のパワー）を out に。seg・tmp は作業用（長さ N と N/2 + 1） */
export function rawPower(
  ring: Float32Array,
  end: number,
  N: number,
  out: Float32Array,
  seg: Float32Array,
  tmp: Float32Array,
): void {
  tail(ring, end, N, seg);
  spectra(seg, seg, N, 'hann', out, tmp);
}

/* ---------- 傾きの当てはめ ---------- */
export interface Band {
  /** 中心周波数（Hz） */
  fc: number;
  k0: number;
  k1: number;
}
/** 傾きを当てはめる範囲（1/3 オクターブ帯の中心） */
export const FIT_LO = 25,
  FIT_HI = 20000;
/**
 * 1/3 オクターブ帯（中心 1000·10^(i/10) Hz、端は中心の 10^(±1/20) 倍）のうち、中心が lo〜hi で、
 * bin の中心が 1 つ以上入るもの
 */
export function bands(fs: number, N: number, lo = FIT_LO, hi = FIT_HI): Band[] {
  const df = fs / N,
    out: Band[] = [];
  for (let i = -20; i <= 15; i++) {
    const fc = 1000 * 10 ** (i / 10);
    if (fc < lo * 0.99 || fc > hi * 1.01 || fc * 10 ** 0.05 > fs / 2) continue;
    const k0 = Math.max(1, Math.ceil((fc * 10 ** -0.05) / df)),
      k1 = Math.min(N / 2 - 1, Math.floor((fc * 10 ** 0.05) / df));
    if (k1 >= k0) out.push({ fc, k0, k1 });
  }
  return out;
}

export interface Fit {
  /** 傾き（dB/oct） */
  slope: number;
  /** 当てはめた直線の 1 kHz での値（パワーの dB） */
  at1k: number;
  /** 使った帯の数 */
  n: number;
}
/** 帯ごとの平均パワーの dB を、log₂ f に対して最小 2 乗で直線に当てはめる */
export function fitSlope(P: ArrayLike<number>, B: readonly Band[]): Fit | null {
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    n = 0;
  for (const b of B) {
    let s = 0;
    for (let k = b.k0; k <= b.k1; k++) s += P[k];
    s /= b.k1 - b.k0 + 1;
    if (!(s > 0)) continue;
    const x = Math.log2(b.fc / 1000),
      y = 10 * Math.log10(s);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    n++;
  }
  if (n < 3) return null;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { slope, at1k: (sy - slope * sx) / n, n };
}

/* ---------- 振幅の統計 ---------- */
export interface Stats {
  mean: number;
  /** 実効値（直流を含む） */
  rms: number;
  /** 絶対値の最大 */
  peak: number;
  /** 尖度（4 次の中心モーメント ÷ 分散²。正規分布は 3） */
  kurt: number;
}
/** 輪のバッファの end の手前 cnt 点の統計 */
export function stats(ring: Float32Array, end: number, cnt: number): Stats {
  const m = ring.length - 1;
  let s1 = 0,
    s2 = 0,
    pk = 0;
  for (let j = end - cnt; j < end; j++) {
    const v = ring[j & m];
    s1 += v;
    s2 += v * v;
    const a = Math.abs(v);
    if (a > pk) pk = a;
  }
  const mean = s1 / cnt,
    vr = s2 / cnt - mean * mean;
  let s4 = 0;
  for (let j = end - cnt; j < end; j++) {
    const d = ring[j & m] - mean;
    s4 += d * d * d * d;
  }
  return { mean, rms: Math.sqrt(s2 / cnt), peak: pk, kurt: vr > 0 ? s4 / cnt / (vr * vr) : Number.NaN };
}

/** 振幅の分布: −lim〜+lim を nb 個の区間に分けた確率密度（範囲の外は数えない） */
export function hist(ring: Float32Array, end: number, cnt: number, lim: number, nb: number): Float64Array {
  const m = ring.length - 1,
    h = new Float64Array(nb),
    w = (2 * lim) / nb;
  for (let j = end - cnt; j < end; j++) {
    const i = Math.floor((ring[j & m] + lim) / w);
    if (i >= 0 && i < nb) h[i]++;
  }
  for (let i = 0; i < nb; i++) h[i] /= cnt * w;
  return h;
}

/** AES17 の dBFS（実効値は √2 倍してから）。0 は −∞ */
export const dbfs = (v: number): number => (v > 0 ? 20 * Math.log10(v) : Number.NEGATIVE_INFINITY);

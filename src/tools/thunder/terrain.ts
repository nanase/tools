/**
 * 雷鳴のページの地形の反響（DOM に依存しない）: 数 km 四方の丘・山・林で散った音が、何秒もかけて戻ってくる。
 * 戻るまでに地面と草木に高い音を吸われるので、残るのは低い音だけで、低いほど長く続く。
 * 低い音だけを扱うので、標本化周波数を 1/D に落として、帯ごとに減り方を変えた雑音の応答とたたみ込む。
 * 残響時間・帯の境・響きの大きさは仮の値
 */

import { type Coef, coef, fft } from '../biquad/filter';
import { mulberry, normal } from '../kalman/kf';

/** 地形の例: 最も低い帯の残響時間 [s]、立ち上がりの時定数 [s]、最も低い帯の響きの大きさ（直接の音に対するエネルギーの比の平方根） */
interface Terrain {
  t60: number;
  rise: number;
  wet: number;
}
const TABLE: Record<string, Terrain> = {
  plain: { t60: 2.5, rise: 0.2, wet: 0.7 },
  hills: { t60: 4.5, rise: 0.4, wet: 1.2 },
  valley: { t60: 8, rise: 0.8, wet: 1.8 },
};

export const TERRAINS = [
  ['0', 'なし', '低い音の響きを足さない'],
  ['plain', '平野', '遠くの林や家並み'],
  ['hills', '丘陵', 'まわりに丘'],
  ['valley', '山あい', '山に囲まれた谷'],
] as const;

/** 帯の上端 [Hz] と、最も低い帯に対する残響時間と響きのエネルギーの比 */
export const BANDS = [
  { f: 60, k: 1 },
  { f: 150, k: 0.6 },
  { f: 400, k: 0.3 },
] as const;
/** 落とした後の標本化周波数の目安 [Hz]（最も高い帯の上端の 7.5 倍） */
const FS_LOW = 3000;

/** 双 2 次フィルタを x にその場で掛ける */
function biquad(x: Float64Array, c: Coef): void {
  const [b0, b1, b2, , a1, a2] = c.map((v) => v / c[3]);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i],
      y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}
const lp = (fs: number, f: number): Coef => coef('lowpass', fs, f, Math.SQRT1_2, 0);
const hp = (fs: number, f: number): Coef => coef('highpass', fs, f, Math.SQRT1_2, 0);

/**
 * 応答（標本化周波数 fs）。帯ごとに雑音を帯域通過し、(1 − e^(−t/rise))·10^(−3t/T60) を掛けて足す。
 * 帯の中の周波数で、応答のエネルギーの大きさ |H|² が wet²·k になるようにそろえる
 * （帯の雑音のエネルギーを、帯の幅が全体（0〜fs/2）に占める割合の wet²·k 倍にする）
 */
export function terrainIR(v: string, fs: number, seed: number): Float64Array | null {
  const s = TABLE[v];
  if (!s) return null;
  const n = Math.ceil(s.t60 * fs),
    ir = new Float64Array(n),
    r = mulberry(seed);
  let lo = 0;
  for (const b of BANDS) {
    const x = Float64Array.from({ length: n }, () => normal(r)),
      t60 = s.t60 * b.k;
    biquad(x, lp(fs, b.f));
    biquad(x, lp(fs, b.f));
    if (lo) {
      biquad(x, hp(fs, lo));
      biquad(x, hp(fs, lo));
    }
    let e = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      x[i] *= (1 - Math.exp(-t / s.rise)) * 10 ** ((-3 * t) / t60);
      e += x[i] * x[i];
    }
    const g = Math.sqrt((s.wet * s.wet * b.k * ((b.f - lo) / (fs / 2))) / e);
    for (let i = 0; i < n; i++) ir[i] += g * x[i];
    lo = b.f;
  }
  return ir;
}

/**
 * y（標本化周波数 fs）の低い音に地形の反響を掛けた音を、左右で別の応答から作る。戻り値の長さは y と応答の長さの和。
 * 低域通過して 1/D に間引き、FFT でたたみ込み、直線で補間して戻し、もう一度低域通過する
 */
export function terrainTail(y: Float32Array, fs: number, v: string): [Float64Array, Float64Array] | null {
  const D = Math.max(1, Math.round(fs / FS_LOW)),
    fd = fs / D,
    irs = [terrainIR(v, fd, 101), terrainIR(v, fd, 202)];
  if (!irs[0] || !irs[1]) return null;
  const top = BANDS[BANDS.length - 1].f,
    x = Float64Array.from(y);
  biquad(x, lp(fs, top));
  biquad(x, lp(fs, top));
  const nd = Math.ceil(x.length / D),
    m = irs[0].length,
    N = 2 ** Math.ceil(Math.log2(nd + m)),
    xr = new Float64Array(N),
    xi = new Float64Array(N);
  for (let i = 0; i < nd; i++) xr[i] = x[i * D];
  fft(xr, xi);
  const n = y.length + m * D;
  return irs.map((h) => {
    const hr = new Float64Array(N),
      hi = new Float64Array(N);
    hr.set(h as Float64Array);
    fft(hr, hi);
    /* 積を共役にして FFT し、もう一度共役にすると逆変換（1/N を掛ける） */
    for (let k = 0; k < N; k++) {
      const a = xr[k] * hr[k] - xi[k] * hi[k],
        b = xr[k] * hi[k] + xi[k] * hr[k];
      hr[k] = a;
      hi[k] = -b;
    }
    fft(hr, hi);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / D,
        j = Math.floor(u),
        f = u - j,
        a = j < N ? hr[j] / N : 0,
        b = j + 1 < N ? hr[j + 1] / N : 0;
      out[i] = a + (b - a) * f;
    }
    biquad(out, lp(fs, top));
    biquad(out, lp(fs, top));
    return out;
  }) as [Float64Array, Float64Array];
}

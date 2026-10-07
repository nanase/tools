/** 画質と量の指標: PSNR（Y・RGB）、差の画像、ビット数の地図 */
import { rgbToYcc } from './color';

/** 2 つの RGBA の平均二乗誤差。y なら JFIF の Y で、rgb なら R・G・B の 3 チャンネルで比べる */
export function mse(a: ArrayLike<number>, b: ArrayLike<number>, kind: 'y' | 'rgb'): number {
  let s = 0,
    n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (kind === 'y') {
      const d = rgbToYcc(a[i], a[i + 1], a[i + 2])[0] - rgbToYcc(b[i], b[i + 1], b[i + 2])[0];
      s += d * d;
      n++;
    } else
      for (let c = 0; c < 3; c++) {
        const d = a[i + c] - b[i + c];
        s += d * d;
        n++;
      }
  }
  return n ? s / n : 0;
}

/** PSNR [dB] = 10 log10(255² / MSE)。一致すれば Infinity */
export function psnr(a: ArrayLike<number>, b: ArrayLike<number>, kind: 'y' | 'rgb'): number {
  const m = mse(a, b, kind);
  return m > 0 ? 10 * Math.log10((255 * 255) / m) : Infinity;
}

/** 差の画像: 128 を 0 として、差を gain 倍した RGB */
export function diffImage(a: ArrayLike<number>, b: ArrayLike<number>, gain: number): Uint8ClampedArray {
  const o = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i += 4) {
    o[i] = 128 + (b[i] - a[i]) * gain;
    o[i + 1] = 128 + (b[i + 1] - a[i + 1]) * gain;
    o[i + 2] = 128 + (b[i + 2] - a[i + 2]) * gain;
    o[i + 3] = 255;
  }
  return o;
}

/** 濃淡の段（暗い順の RGB）の間を線形に補間する。t は 0〜1 */
export function ramp(stops: readonly (readonly [number, number, number])[], t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1),
    i = Math.min(stops.length - 2, Math.floor(x)),
    f = x - i,
    a = stops[i],
    b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * ビット数の地図: 8×8 画素ごとのビット数（bw × bh のブロック）を w×h の RGBA にする。
 * 濃さは max ビットで頭打ち（平方根の目盛り）
 */
export function bitsImage(
  map: ArrayLike<number>,
  bw: number,
  w: number,
  h: number,
  max: number,
  stops: readonly (readonly [number, number, number])[],
): Uint8ClampedArray {
  const o = new Uint8ClampedArray(w * h * 4),
    lut: [number, number, number][] = [];
  const colOf = (b: number) => ramp(stops, Math.sqrt(Math.min(1, b / max)));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y >> 3) * bw + (x >> 3);
      lut[k] ??= colOf(map[k]);
      const c = lut[k],
        i = (y * w + x) * 4;
      o[i] = c[0];
      o[i + 1] = c[1];
      o[i + 2] = c[2];
      o[i + 3] = 255;
    }
  return o;
}

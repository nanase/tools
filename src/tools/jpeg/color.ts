/**
 * 色の変換（JFIF 1.02 の RGB ⇄ YCbCr）と、色差の間引き・補間。
 * 成分の面（plane）は 8 ビットの標本を行ごとに並べたもので、MCU の大きさまで端の画素を繰り返して広げる
 */

export type Sub = '444' | '422' | '420';

/** 輝度の標本化の倍率（H, V）。色差は常に 1×1 */
export const SAMPLING: Record<Sub, readonly [number, number]> = {
  '444': [1, 1],
  '422': [2, 1],
  '420': [2, 2],
};

/** RGB → Y・Cb・Cr（実数） */
export function rgbToYcc(r: number, g: number, b: number): [number, number, number] {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
    0.5 * r - 0.418688 * g - 0.081312 * b + 128,
  ];
}

/** Y・Cb・Cr → RGB（実数） */
export function yccToRgb(y: number, cb: number, cr: number): [number, number, number] {
  const b1 = cb - 128,
    r1 = cr - 128;
  return [y + 1.402 * r1, y - 0.344136 * b1 - 0.714136 * r1, y + 1.772 * b1];
}

const clamp8 = (x: number): number => (x <= 0 ? 0 : x >= 255 ? 255 : Math.round(x));

/** 1 つの成分の面 */
export interface Plane {
  w: number;
  h: number;
  d: Uint8Array;
}

/**
 * RGBA の画像を Y・Cb・Cr の 3 面にする。面は pw×ph（MCU の倍数）で、画像の外は右端の列・下端の行を繰り返す
 */
export function toYccPlanes(rgba: ArrayLike<number>, w: number, h: number, pw: number, ph: number): Plane[] {
  const P = [0, 1, 2].map(() => ({ w: pw, h: ph, d: new Uint8Array(pw * ph) }));
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(y, h - 1);
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(x, w - 1),
        i = (sy * w + sx) * 4,
        o = y * pw + x;
      const [Y, Cb, Cr] = rgbToYcc(rgba[i], rgba[i + 1], rgba[i + 2]);
      P[0].d[o] = clamp8(Y);
      P[1].d[o] = clamp8(Cb);
      P[2].d[o] = clamp8(Cr);
    }
  }
  return P;
}

/** 平均で 1/fx × 1/fy に間引く（四捨五入） */
export function downsample(p: Plane, fx: number, fy: number): Plane {
  if (fx === 1 && fy === 1) return p;
  const w = p.w / fx,
    h = p.h / fy,
    d = new Uint8Array(w * h),
    n = fx * fy;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) s += p.d[(y * fy + j) * p.w + x * fx + i];
      d[y * w + x] = Math.floor((s + (n >> 1)) / n);
    }
  return { w, h, d };
}

export type Up = 'near' | 'lin';

/**
 * 色差を fx × fy 倍に戻す（実数）。near は同じ値を繰り返し、lin は標本を受け持つ画素の中心に置いて線形に補間する
 * （2 倍では libjpeg の fancy upsampling と同じ 3:1 の重み）
 */
export function upsample(p: Plane, fx: number, fy: number, mode: Up): Float32Array {
  const W = p.w * fx,
    H = p.h * fy,
    o = new Float32Array(W * H);
  const at = (x: number, y: number) => p.d[Math.min(p.h - 1, Math.max(0, y)) * p.w + Math.min(p.w - 1, Math.max(0, x))];
  if (mode === 'near') {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) o[y * W + x] = p.d[Math.floor(y / fy) * p.w + Math.floor(x / fx)];
    return o;
  }
  /* 出力の画素 X の、元の標本の座標での位置は (X + 0.5)/f − 0.5 */
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) / fy - 0.5,
      y0 = Math.floor(sy),
      ty = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) / fx - 0.5,
        x0 = Math.floor(sx),
        tx = sx - x0;
      const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx,
        b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      o[y * W + x] = a * (1 - ty) + b * ty;
    }
  }
  return o;
}

/** 輝度の大きさにそろえた 3 面（行の長さ stride）を RGBA の w×h に */
export function planesToRgba(
  Y: ArrayLike<number>,
  Cb: ArrayLike<number>,
  Cr: ArrayLike<number>,
  stride: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y * stride + x,
        [r, g, b] = yccToRgb(Y[c], Cb[c], Cr[c]),
        i = (y * w + x) * 4;
      out[i] = clamp8(r);
      out[i + 1] = clamp8(g);
      out[i + 2] = clamp8(b);
      out[i + 3] = 255;
    }
  return out;
}

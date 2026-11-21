/**
 * 法線マップに重ねる画像（色とつや）。色は sRGB の 0〜255、つやは粗さ（0 がつるつる、1 がざらざら）で、
 * RGBA8 の A に入れる。模様ごとに高さの段で色と粗さを決め、ゆっくり変わるノイズでむらを付ける。
 * 画像の模様は、画像の明るさを高さに、画像の色をそのまま色にする
 */
import { fbm, HR, normalize, type PatId } from './heights';

type Rgb = readonly [number, number, number];
/** [高さ, 色, 粗さ] を高さの順に並べる */
type Stop = readonly [number, Rgb, number];
interface Mat {
  stops: readonly Stop[];
  /** むらの強さ（明るさの倍率の振れ幅） */
  vary: number;
}

export const MATS: Record<Exclude<PatId, 'image'>, Mat> = {
  brick: {
    stops: [
      [0, [150, 146, 138], 0.95],
      [0.35, [150, 146, 138], 0.95],
      [0.6, [150, 62, 44], 0.7],
      [1, [165, 72, 50], 0.6],
    ],
    vary: 0.3,
  },
  hex: {
    stops: [
      [0, [118, 122, 126], 0.95],
      [0.4, [118, 122, 126], 0.9],
      [0.75, [222, 228, 230], 0.25],
      [1, [236, 238, 240], 0.2],
    ],
    vary: 0.05,
  },
  cobble: {
    stops: [
      [0, [66, 58, 48], 1],
      [0.25, [90, 82, 72], 0.95],
      [0.5, [128, 124, 118], 0.7],
      [1, [162, 156, 146], 0.6],
    ],
    vary: 0.35,
  },
  scale: {
    stops: [
      [0, [28, 58, 68], 0.5],
      [0.3, [58, 108, 118], 0.4],
      [1, [152, 192, 190], 0.25],
    ],
    vary: 0.2,
  },
  wood: {
    stops: [
      [0, [48, 30, 18], 0.9],
      [0.75, [118, 76, 42], 0.5],
      [0.85, [150, 98, 56], 0.45],
      [1, [178, 122, 72], 0.4],
    ],
    vary: 0.25,
  },
  weave: {
    stops: [
      [0, [34, 36, 58], 0.95],
      [0.5, [58, 70, 112], 0.9],
      [1, [200, 190, 160], 0.85],
    ],
    vary: 0.1,
  },
  corrugated: {
    stops: [
      [0, [146, 152, 158], 0.5],
      [1, [200, 205, 210], 0.35],
    ],
    vary: 0.2,
  },
  checker: {
    stops: [
      [0, [140, 145, 150], 0.35],
      [1, [192, 196, 200], 0.25],
    ],
    vary: 0.12,
  },
  knurl: {
    stops: [
      [0, [88, 92, 98], 0.4],
      [1, [206, 210, 216], 0.2],
    ],
    vary: 0.05,
  },
  rivet: {
    stops: [
      [0, [58, 88, 68], 0.6],
      [0.3, [70, 100, 80], 0.55],
      [0.6, [150, 150, 140], 0.3],
      [1, [192, 186, 170], 0.25],
    ],
    vary: 0.12,
  },
  dimple: {
    stops: [
      [0, [218, 220, 224], 0.3],
      [1, [246, 246, 247], 0.25],
    ],
    vary: 0.02,
  },
  pcb: {
    stops: [
      [0, [16, 86, 44], 0.35],
      [0.4, [18, 90, 46], 0.35],
      [0.45, [56, 146, 78], 0.3],
      [0.48, [56, 146, 78], 0.3],
      [0.5, [206, 160, 80], 0.25],
      [0.56, [206, 160, 80], 0.25],
      [0.6, [30, 30, 32], 0.5],
      [1, [42, 42, 46], 0.45],
    ],
    vary: 0.05,
  },
  maze: {
    stops: [
      [0, [172, 150, 110], 0.9],
      [0.5, [62, 110, 52], 0.85],
      [1, [74, 132, 62], 0.8],
    ],
    vary: 0.2,
  },
  rock: {
    stops: [
      [0, [70, 64, 58], 1],
      [1, [152, 142, 128], 0.85],
    ],
    vary: 0.3,
  },
  crater: {
    stops: [
      [0, [88, 88, 90], 1],
      [1, [172, 172, 174], 0.95],
    ],
    vary: 0.25,
  },
  ripple: {
    stops: [
      [0, [30, 70, 100], 0.3],
      [1, [92, 152, 182], 0.25],
    ],
    vary: 0.05,
  },
  text: {
    stops: [
      [0, [118, 88, 40], 0.35],
      [1, [222, 182, 92], 0.2],
    ],
    vary: 0.08,
  },
};

/** 高さ h の所の色と粗さ（段の間は直線で混ぜる） */
export function matAt(m: Mat, h: number): [number, number, number, number] {
  const s = m.stops;
  if (h <= s[0][0]) return [...s[0][1], s[0][2]];
  for (let k = 1; k < s.length; k++) {
    const [h1, c1, r1] = s[k];
    if (h <= h1) {
      const [h0, c0, r0] = s[k - 1],
        t = (h - h0) / (h1 - h0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
        r0 + (r1 - r0) * t,
      ];
    }
  }
  const e = s[s.length - 1];
  return [...e[1], e[2]];
}

/** 色とつやの画像（RGBA8。A が粗さ） */
export function materialMap(id: Exclude<PatId, 'image'>, h: Float32Array, R = HR): Uint8Array {
  const m = MATS[id],
    out = new Uint8Array(R * R * 4);
  for (let j = 0; j < R; j++) {
    const z = -1 + (2 * (j + 0.5)) / R;
    for (let i = 0; i < R; i++) {
      const x = -1 + (2 * (i + 0.5)) / R,
        k = j * R + i,
        [r, g, b, rough] = matAt(m, h[k]),
        v = 1 + m.vary * (fbm(x * 3.1 + 7, z * 3.1 - 3, 3) - 0.5) * 2,
        o = k * 4;
      out[o] = Math.max(0, Math.min(255, Math.round(r * v)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(g * v)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(b * v)));
      out[o + 3] = Math.round(Math.max(0, Math.min(1, rough)) * 255);
    }
  }
  return out;
}

/** 箱のぼかしを 2 回（半径 r 画素。ガウスに近い） */
function blur(h: Float32Array, R: number, r: number): Float32Array {
  if (r < 1) return h;
  const t = new Float32Array(h.length);
  let a = h;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += a[j * R + Math.min(R - 1, Math.max(0, i + d))];
        t[j * R + i] = s / (2 * r + 1);
      }
    const u = new Float32Array(h.length);
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += t[Math.min(R - 1, Math.max(0, j + d)) * R + i];
        u[j * R + i] = s / (2 * r + 1);
      }
    a = u;
  }
  return a;
}

/**
 * 画像（RGBA、R × R）から高さと色を作る。明るい所ほど高い（invert で暗い所ほど高い）。
 * 細かな写りの粒が凹凸にならないよう、少しぼかしてから高さにする
 */
export function imagePattern(
  px: Uint8ClampedArray | Uint8Array,
  invert: boolean,
  R = HR,
): { h: Float32Array; col: Uint8Array } {
  const lum = new Float32Array(R * R),
    col = new Uint8Array(R * R * 4);
  for (let k = 0; k < R * R; k++) {
    const r = px[k * 4],
      g = px[k * 4 + 1],
      b = px[k * 4 + 2],
      y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lum[k] = invert ? 1 - y : y;
    col[k * 4] = r;
    col[k * 4 + 1] = g;
    col[k * 4 + 2] = b;
    col[k * 4 + 3] = 150;
  }
  return { h: normalize(blur(lum, R, Math.max(1, Math.round(R / 256)))), col };
}

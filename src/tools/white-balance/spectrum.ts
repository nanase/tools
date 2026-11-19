/**
 * ホワイトバランスのページの分光の計算。380〜730 nm を 5 nm ごとの 71 点で持つ。
 * 写真の色は「物の分光反射率 × 光の分光分布 × カメラの R・G・B の感度」の和で決まる（RAW）。
 * カメラの感度はガウスで近似した仮のもので、実在の機種の値ではない
 */

export type Spec = Float64Array;
export type Vec3 = [number, number, number];
export type M3 = [Vec3, Vec3, Vec3];

export const NL = 71,
  L0 = 380,
  DL = 5;
export const LAM: readonly number[] = Array.from({ length: NL }, (_, i) => L0 + DL * i);

/** 波長の関数から分光の配列を作る */
export function arr(f: (l: number, i: number) => number): Spec {
  const a = new Float64Array(NL);
  for (let i = 0; i < NL; i++) a[i] = f(LAM[i] as number, i);
  return a;
}
/** ガウス（幅は標準偏差） */
export const ga = (x: number, m: number, s: number): number => Math.exp(-0.5 * ((x - m) / s) ** 2);
/** 左右で幅の違うガウス */
export const gp = (x: number, m: number, s1: number, s2: number): number => {
  const t = (x - m) / (x < m ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};
/** シグモイド（m で 0.5、幅 w） */
export const sg = (x: number, m: number, w: number): number => 1 / (1 + Math.exp(-(x - m) / w));
export const flat = (v: number): Spec => arr(() => v);
export const ONE = flat(1);

/* CIE 1931 等色関数（Wyman・Sloan・Shirley 2013 の多峰の近似） */
export const XB = arr(
  (l) => 1.056 * gp(l, 599.8, 37.9, 31.0) + 0.362 * gp(l, 442.0, 16.0, 26.7) - 0.065 * gp(l, 501.1, 20.4, 26.2),
);
export const YB = arr((l) => 0.821 * gp(l, 568.8, 46.9, 40.5) + 0.286 * gp(l, 530.9, 16.3, 31.1));
export const ZB = arr((l) => 1.217 * gp(l, 437.0, 11.8, 36.0) + 0.681 * gp(l, 459.0, 26.0, 13.8));

/** 赤外を切るフィルタ（650 nm から落とす） */
const IRC = arr((l) => 1 / (1 + Math.exp((l - 655) / 8)));
/** カメラの R・G・B の感度（ガウスの近似） */
export const CAM: readonly [Spec, Spec, Spec] = [
  arr((l, i) => (ga(l, 600, 32) + 0.07 * ga(l, 450, 22)) * (IRC[i] as number)),
  arr((l, i) => ga(l, 535, 38) * (IRC[i] as number)),
  arr((l, i) => ga(l, 462, 26) * (IRC[i] as number)),
];

export function dot(a: Spec, b: Spec): number {
  let s = 0;
  for (let i = 0; i < NL; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}
export function dot3(a: Spec, b: Spec, c: Spec): number {
  let s = 0;
  for (let i = 0; i < NL; i++) s += (a[i] as number) * (b[i] as number) * (c[i] as number);
  return s;
}
/** 明るさ（Y）が 1 になるようにそろえる */
export function normY(E: Spec): Spec {
  const y = dot(E, YB);
  return arr((_, i) => (E[i] as number) / y);
}

/* ---------- 光 ---------- */

/** 黒体放射（プランクの式）。T [K] */
export function planck(T: number): Spec {
  return normY(
    arr((l) => {
      const m = l * 1e-9;
      return 1 / (m ** 5 * (Math.exp(1.4388e-2 / (m * T)) - 1));
    }),
  );
}
/* CIE の昼光の基底 S0・S1・S2（380〜730 nm、10 nm ごと） */
const S0T = [
  63.4, 65.8, 94.8, 104.8, 105.9, 96.8, 113.9, 125.6, 125.5, 121.3, 121.3, 113.5, 113.1, 110.8, 106.5, 108.8, 105.3,
  104.4, 100, 96, 95.1, 89.1, 90.5, 90.3, 88.4, 84, 85.1, 81.9, 82.6, 84.9, 81.3, 71.9, 74.3, 76.4, 63.3, 71.7,
];
const S1T = [
  38.5, 35, 43.4, 46.3, 43.9, 37.1, 36.7, 35.9, 32.6, 27.9, 24.3, 20.1, 16.2, 13.2, 8.6, 6.1, 4.2, 1.9, 0, -1.6, -3.5,
  -3.5, -5.8, -7.2, -8.6, -9.5, -10.9, -10.7, -12, -14, -13.6, -12, -13.3, -12.9, -10.6, -11.6,
];
const S2T = [
  3, 1.2, -1.1, -0.5, -0.7, -1.2, -2.6, -2.9, -2.8, -2.6, -2.6, -1.8, -1.5, -1.3, -1.2, -1, -0.5, -0.3, 0, 0.2, 0.5,
  2.1, 3.2, 4.1, 4.7, 5.1, 6.7, 7.3, 8.6, 9.8, 10.2, 8.3, 9.6, 8.5, 7, 7.6,
];
/** 10 nm の表を 5 nm へ（間は平均） */
const i10 = (t: readonly number[], i: number): number =>
  i % 2 === 0 ? (t[i / 2] as number) : ((t[(i - 1) / 2] as number) + (t[(i + 1) / 2] as number)) / 2;
/** CIE の昼光（4,000〜25,000 K） */
export function daylight(T: number): Spec {
  const x =
    T <= 7000
      ? -4.607e9 / T ** 3 + 2.9678e6 / T ** 2 + 99.11 / T + 0.244063
      : -2.0064e9 / T ** 3 + 1.9018e6 / T ** 2 + 247.48 / T + 0.23704;
  const y = -3 * x * x + 2.87 * x - 0.275,
    M = 0.0241 + 0.2562 * x - 0.7341 * y,
    m1 = (-1.3515 - 1.7703 * x + 5.9114 * y) / M,
    m2 = (0.03 - 31.4424 * x + 30.0717 * y) / M;
  return normY(arr((_, i) => i10(S0T, i) + m1 * i10(S1T, i) + m2 * i10(S2T, i)));
}
/** 色温度の光。4,000 K 未満は黒体、5,000 K 以上は昼光、その間は混ぜる */
export function cctSpec(T: number): Spec {
  if (T < 4000) return planck(T);
  if (T >= 5000) return daylight(T);
  const w = (T - 4000) / 1000,
    a = planck(T),
    b = daylight(T);
  return arr((_, i) => (a[i] as number) * (1 - w) + (b[i] as number) * w);
}
/** 3 波長の蛍光灯（水銀の線と蛍光体の山の近似） */
export const FLUOR = normY(
  arr(
    (l) =>
      0.03 +
      0.05 * ga(l, 455, 30) +
      0.04 * ga(l, 560, 90) +
      0.25 * ga(l, 405, 2.6) +
      1.0 * ga(l, 436, 2.6) +
      0.35 * ga(l, 488, 4) +
      1.45 * ga(l, 545, 3.5) +
      0.2 * ga(l, 586, 5) +
      0.72 * ga(l, 611, 3.5) +
      0.12 * ga(l, 630, 5) +
      0.06 * ga(l, 710, 5),
  ),
);
/** 白色 LED（青の LED と黄の蛍光体） */
export const LEDW = normY(arr((l) => 0.62 * ga(l, 452, 10.5) + 1.0 * gp(l, 560, 38, 62)));
/** 電球色の LED */
export const LEDWARM = normY(arr((l) => 0.22 * ga(l, 450, 10) + 1.0 * gp(l, 600, 45, 60)));
export const D65 = daylight(6504);

/* ---------- 色の変換 ---------- */

export const xyzOf = (R: Spec, E: Spec): Vec3 => [dot3(R, E, XB), dot3(R, E, YB), dot3(R, E, ZB)];
/** RAW（カメラの R・G・B の値） */
export const rawOf = (R: Spec, E: Spec): Vec3 => [dot3(R, E, CAM[0]), dot3(R, E, CAM[1]), dot3(R, E, CAM[2])];

export const XYZ_TO_SRGB: M3 = [
  [3.2406, -1.5372, -0.4986],
  [-0.9689, 1.8758, 0.0415],
  [0.0557, -0.204, 1.057],
];
export const SRGB_TO_XYZ: M3 = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505],
];
export const mv = (M: M3, v: readonly number[]): Vec3 => [
  M[0][0] * (v[0] as number) + M[0][1] * (v[1] as number) + M[0][2] * (v[2] as number),
  M[1][0] * (v[0] as number) + M[1][1] * (v[1] as number) + M[1][2] * (v[2] as number),
  M[2][0] * (v[0] as number) + M[2][1] * (v[1] as number) + M[2][2] * (v[2] as number),
];
export const mm = (A: M3, B: M3): M3 =>
  A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j as 0] + r[1] * B[1][j as 0] + r[2] * B[2][j as 0]) as Vec3) as M3;
/** 正方行列の逆行列（部分ピボットのガウス・ジョルダン） */
export function inv(A: readonly (readonly number[])[]): number[][] {
  const n = A.length,
    M = A.map((r) => r.slice()),
    I = A.map((r, i) => r.map((_, j): number => (i === j ? 1 : 0)));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]?.[c] as number) > Math.abs(M[p]?.[c] as number)) p = r;
    [M[c], M[p]] = [M[p] as number[], M[c] as number[]];
    [I[c], I[p]] = [I[p] as number[], I[c] as number[]];
    const mc = M[c] as number[],
      ic = I[c] as number[],
      d = mc[c] as number;
    for (let j = 0; j < n; j++) {
      mc[j] = (mc[j] as number) / d;
      ic[j] = (ic[j] as number) / d;
    }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const mr = M[r] as number[],
        ir = I[r] as number[],
        f = mr[c] as number;
      if (!f) continue;
      for (let j = 0; j < n; j++) {
        mr[j] = (mr[j] as number) - f * (mc[j] as number);
        ir[j] = (ir[j] as number) - f * (ic[j] as number);
      }
    }
  }
  return I;
}
const s2l = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/**
 * sRGB の色（昼光で見た色）から、滑らかな分光反射率を作る。
 * D65 の下で同じ XYZ になる反射率のうち、2 階差分の 2 乗和が最も小さいものを選ぶ（3 つの等式の制約つき最小二乗）
 */
export const smoothFit: (rgb: readonly [number, number, number]) => Spec = (() => {
  const A = [XB, YB, ZB].map((c) => Array.from(arr((_, i) => (c[i] as number) * (D65[i] as number))));
  const Q = Array.from({ length: NL }, () => new Array<number>(NL).fill(0));
  for (let i = 1; i < NL - 1; i++) {
    const d = [i - 1, i, i + 1],
      w = [1, -2, 1];
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const row = Q[d[a] as number] as number[];
        row[d[b] as number] = (row[d[b] as number] as number) + (w[a] as number) * (w[b] as number);
      }
  }
  /* 平らな反射率は 2 階差分が 0 なので、大きさの罰は解を崩さない程度に小さくする */
  for (let i = 0; i < NL; i++) (Q[i] as number[])[i] = ((Q[i] as number[])[i] as number) + 1e-7;
  const Qi = inv(Q);
  const P = Qi.map((r) =>
    [0, 1, 2].map((k) => {
      let s = 0;
      for (let j = 0; j < NL; j++) s += (r[j] as number) * ((A[k] as number[])[j] as number);
      return s;
    }),
  );
  const AP = [0, 1, 2].map((a) =>
    [0, 1, 2].map((b) => {
      let s = 0;
      for (let j = 0; j < NL; j++) s += ((A[a] as number[])[j] as number) * ((P[j] as number[])[b] as number);
      return s;
    }),
  );
  const K = inv(AP) as M3;
  return (rgb) => {
    const t = mv(
      SRGB_TO_XYZ,
      rgb.map((v) => s2l(v / 255)),
    );
    const w = mv(K, t);
    return arr((_, i) => {
      const p = P[i] as number[];
      return Math.min(
        0.98,
        Math.max(0.01, (p[0] as number) * w[0] + (p[1] as number) * w[1] + (p[2] as number) * w[2]),
      );
    });
  };
})();

/** 24 色の色見本（昼光で見た sRGB） */
export const CHART_RGB: readonly (readonly [number, number, number])[] = [
  [115, 82, 68],
  [194, 150, 130],
  [98, 122, 157],
  [87, 108, 67],
  [133, 128, 177],
  [103, 189, 170],
  [214, 126, 44],
  [80, 91, 166],
  [193, 90, 99],
  [94, 60, 108],
  [157, 188, 64],
  [224, 163, 46],
  [56, 61, 150],
  [70, 148, 73],
  [175, 54, 60],
  [231, 199, 31],
  [187, 86, 149],
  [8, 133, 161],
  [243, 243, 242],
  [200, 200, 200],
  [160, 160, 160],
  [122, 122, 121],
  [85, 85, 85],
  [52, 52, 52],
];
export const CHART: readonly Spec[] = CHART_RGB.map(smoothFit);

/** 昼光（D65）の白の RAW と XYZ */
export const WD65 = rawOf(ONE, D65);
const XYZW = xyzOf(ONE, D65);
/**
 * カメラの色の行列（白をそろえた RAW → XYZ）。色見本 24 色を D65 で写した値に最小二乗で合わせ、
 * 白（1, 1, 1）が D65 の白へ移るように行ごとに縮める
 */
export const CAMM: M3 = (() => {
  const R: Vec3[] = [],
    T: Vec3[] = [];
  for (const r of CHART) {
    const w = rawOf(r, D65);
    R.push([w[0] / WD65[0], w[1] / WD65[1], w[2] / WD65[2]]);
    const x = xyzOf(r, D65);
    T.push([x[0] / XYZW[1], x[1] / XYZW[1], x[2] / XYZW[1]]);
  }
  const RR = [0, 1, 2].map((a) => [0, 1, 2].map((b) => R.reduce((s, r) => s + (r[a] as number) * (r[b] as number), 0)));
  const TR = [0, 1, 2].map((a) =>
    [0, 1, 2].map((b) => R.reduce((s, r, n) => s + ((T[n] as Vec3)[a] as number) * (r[b] as number), 0)),
  ) as M3;
  const M = mm(TR, inv(RR) as M3);
  const w = [XYZW[0] / XYZW[1], 1, XYZW[2] / XYZW[1]];
  return M.map((r, i) => {
    const s = r[0] + r[1] + r[2];
    return r.map((v) => (v * (w[i] as number)) / s) as Vec3;
  }) as M3;
})();
/** 白をそろえた RAW → 線形 sRGB */
export const NM: M3 = (() => {
  /* 等色関数の近似で求めた D65 の白と sRGB の白はわずかに違うので、白が (1, 1, 1) に移るよう行ごとにそろえる */
  const M = mm(XYZ_TO_SRGB, CAMM);
  return M.map((r) => {
    const s = r[0] + r[1] + r[2];
    return [r[0] / s, r[1] / s, r[2] / s] as Vec3;
  }) as M3;
})();
/** 白い紙が飛ばないように露出を少し下げる */
export const KX = 0.82;

/** 線形 sRGB（0〜1）→ 8 ビットの表 */
const LUT = new Uint8ClampedArray(4097);
for (let i = 0; i <= 4096; i++) {
  const v = i / 4096;
  LUT[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}
export const enc = (v: number): number => LUT[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0] as number;

/* ---------- Lab・色温度 ---------- */

const WN: Vec3 = [0.95047, 1, 1.08883];
export function lab(X: Vec3): Vec3 {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f(X[0] / WN[0]),
    y = f(X[1] / WN[1]),
    z = f(X[2] / WN[2]);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** 線形 sRGB を 0〜1 に切ってから Lab へ */
export const labOfLin = (lin: Vec3): Vec3 =>
  lab(
    mv(
      SRGB_TO_XYZ,
      lin.map((v) => Math.max(0, Math.min(1, v))),
    ),
  );

const uv = (X: Vec3): [number, number] => {
  const d = X[0] + 15 * X[1] + 3 * X[2];
  return [(4 * X[0]) / d, (6 * X[1]) / d];
};
/**
 * 光の相関色温度（McCamy 1992 の近似）と、黒体の軌跡からの離れ Duv（+ は緑寄り）
 */
export function cctOf(E: Spec): { T: number; duv: number } {
  const X = xyzOf(ONE, E),
    s = X[0] + X[1] + X[2],
    x = X[0] / s,
    y = X[1] / s,
    n = (x - 0.332) / (0.1858 - y);
  const T = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
  const [u, v] = uv(X),
    [up, vp] = uv(xyzOf(ONE, planck(Math.max(1000, Math.min(25000, T)))));
  return { T, duv: Math.sign(v - vp) * Math.hypot(u - up, v - vp) };
}

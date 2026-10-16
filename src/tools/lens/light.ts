/**
 * 断面図の光: 光線を光として描く。波長ごとの色は CIE 1931 の等色関数から求め、どの波長も同じ強さの光
 * （等エネルギーの白）を足すと白になるようにそろえる。光束は隣り合う光線の間を光で埋め、その間の光の量を
 * 一定にする（エネルギーの保存）ので、光線が集まる所（ピント）ほど明るく、波長で分かれた所だけ色が見える。
 * 浮動小数の画素に足し合わせ、最後に露出をかけて表示する
 */

/** 描く光の集まり。座標は SVG の viewBox の単位 */
export interface Light {
  /** viewBox の大きさ */
  w: number;
  h: number;
  /** 切り抜きの枠 [x0, y0, x1, y1] */
  clips: [number, number, number, number][];
  fans: Fan[];
}
/** 光束 1 つ（1 つの波長）: 瞳の順に並べた光線。光線は左から右へ進む折れ線 [x0, y0, x1, y1, …] */
export interface Fan {
  rays: number[][];
  /** 色（線形 sRGB）。全部の波長を足して (1, 1, 1) が白 */
  rgb: readonly [number, number, number];
  /** 光が入る所での光線の間隔（viewBox の単位）。隣り合う光線の間の光の量を決める */
  sp: number;
  clip: number;
}

/** 断面図の連続スペクトル: 400〜700 nm を 20 nm ごと（描く時間との兼ね合い） */
export const SPEC_NM = Array.from({ length: 16 }, (_, i) => 400 + 20 * i);

/** CIE 1931 の等色関数の多峰ガウスの近似（Wyman・Sloan・Shirley, 2013） */
export function cmf(nm: number): [number, number, number] {
  const g = (m: number, s1: number, s2: number) => {
    const t = (nm - m) / (nm < m ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  };
  return [
    1.056 * g(599.8, 37.9, 31.0) + 0.362 * g(442.0, 16.0, 26.7) - 0.065 * g(501.1, 20.4, 26.2),
    0.821 * g(568.8, 46.9, 40.5) + 0.286 * g(530.9, 16.3, 31.1),
    1.217 * g(437.0, 11.8, 36.0) + 0.681 * g(459.0, 26.0, 13.8),
  ];
}
/** XYZ → 線形 sRGB */
export const toRgb = ([X, Y, Z]: [number, number, number]): [number, number, number] => [
  3.2406 * X - 1.5372 * Y - 0.4986 * Z,
  -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
  0.0557 * X - 0.204 * Y + 1.057 * Z,
];

/** SPEC_NM の波長ごとの色。全部を足すと (1, 1, 1)。単色の光は sRGB の外なので負の成分を含む */
export const SPEC_RGB: readonly (readonly [number, number, number])[] = (() => {
  const c = SPEC_NM.map((nm) => toRgb(cmf(nm))),
    sum = [0, 1, 2].map((k) => c.reduce((a, v) => a + v[k], 0));
  return c.map((v) => [v[0] / sum[0], v[1] / sum[1], v[2] / sum[2]] as const);
})();

/** 表示の色（#rrggbb）を線形 sRGB に */
export function hexRgb(hex: string): [number, number, number] {
  const v = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [v(1), v(3), v(5)];
}

/** 入ってくる一様な光束の明るさ（線形の値）。露出は 1 − e^(−x) で丸める */
const LEVEL = 0.4;

/** 光を canvas に描く。canvas の画素の数は、表示の大きさと画素の密度から決める */
export function drawLight(cv: HTMLCanvasElement, L: Light): void {
  /* 光はぼやけた面なので、画素の密度は 1 で足りる（描く時間を抑える。レンズの線と文字は SVG で細かく描く） */
  const dpr = 1,
    cw = cv.clientWidth;
  if (!cw) return;
  const W = Math.round(cw * dpr),
    H = Math.round((W * L.h) / L.w),
    k = W / L.w;
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const acc = new Float32Array(W * H * 3);
  for (const f of L.fans) {
    const [cx0, cy0, cx1, cy1] = L.clips[f.clip].map((v) => v * k),
      e = LEVEL * f.sp * k,
      rays = f.rays.map((r) => r.map((v) => v * k));
    for (let j = 0; j + 1 < rays.length; j++)
      between(acc, W, rays[j], rays[j + 1], cx0, cy0, cx1, cy1, e * f.rgb[0], e * f.rgb[1], e * f.rgb[2]);
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(W, H),
    d = img.data;
  for (let i = 0, j = 0; i < acc.length; i += 3, j += 4) {
    let r = acc[i],
      g = acc[i + 1],
      b = acc[i + 2];
    /* sRGB の外（負の成分）は、輝度を保って白へ寄せる */
    const m = Math.min(r, g, b);
    if (m < 0) {
      const y = Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b),
        t = y / (y - m);
      r = y + t * (r - y);
      g = y + t * (g - y);
      b = y + t * (b - y);
    }
    d[j] = enc(r);
    d[j + 1] = enc(g);
    d[j + 2] = enc(b);
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
/** 露出（1 − e^(−x)）と sRGB の階調 */
function enc(x: number): number {
  if (x <= 0) return 0;
  const v = 1 - Math.exp(-x);
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}

/**
 * 隣り合う 2 本の光線の間を光で埋める。画素の列ごとに 2 本の高さを求め、その間に列あたり一定の量
 * （c0〜c2）を広げる。間が 1 画素より狭いときは 1 画素の幅に広げる
 */
function between(
  acc: Float32Array,
  W: number,
  A: number[],
  B: number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c0: number,
  c1: number,
  c2: number,
): void {
  if (A.length < 4 || B.length < 4) return;
  const xs = Math.max(A[0], B[0], x0),
    xe = Math.min(A[A.length - 2], B[B.length - 2], x1);
  let ia = 0,
    ib = 0;
  const yAt = (P: number[], i: number, x: number) => {
    const xa = P[2 * i],
      xb = P[2 * i + 2];
    return xb === xa ? P[2 * i + 1] : P[2 * i + 1] + ((P[2 * i + 3] - P[2 * i + 1]) * (x - xa)) / (xb - xa);
  };
  const na = A.length / 2 - 1,
    nb = B.length / 2 - 1;
  for (let u = Math.ceil(xs - 0.5); u < Math.ceil(xe - 0.5); u++) {
    const x = u + 0.5;
    while (ia < na - 1 && A[2 * ia + 2] < x) ia++;
    while (ib < nb - 1 && B[2 * ib + 2] < x) ib++;
    let a = yAt(A, ia, x),
      b = yAt(B, ib, x);
    if (a > b) [a, b] = [b, a];
    if (b - a < 1) {
      const c = (a + b) / 2;
      a = c - 0.5;
      b = c + 0.5;
    }
    const q = 1 / (b - a),
      lo = Math.max(a, y0),
      hi = Math.min(b, y1);
    for (let j = Math.floor(lo); j < hi; j++) {
      const cov = (Math.min(j + 1, hi) - Math.max(j, lo)) * q;
      if (cov <= 0) continue;
      const i = 3 * (j * W + u);
      acc[i] += c0 * cov;
      acc[i + 1] += c1 * cov;
      acc[i + 2] += c2 * cov;
    }
  }
}

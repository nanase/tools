/**
 * トランペットの図の形（DOM に依存しない）。
 * 横から見た楽器は、図の座標（約 1.73 px/mm）で管の中心線と半径を決め、帯にして描く。各部の位置と大きさ（受け口・ピストン・
 * ケースの高さ・ベル）は写真「Trompette - corps.JPG」（Wikimedia Commons、Eusebius、CC BY 3.0）と比べて合わせた。
 * 管の重なり方と抜差しの形は一般的な形の仮定（写真の楽器は抜差しを外してある）。
 * マウスピースの外形は Bach 1½C の写真（Wikimedia Commons「Embouchure profil.jpg」、Eusebius、CC BY 3.0）の輪郭を
 * 全長 88 mm にそろえて測ったもの、内側は模型の寸法（7C 相当）。唇と前歯の形は一般的な口の縦の断面の仮定
 */

export type Pt = [number, number];
const f1 = (x: number) => String(Math.round(x * 10) / 10);
export const P = (x: number, y: number) => `${f1(x)} ${f1(y)}`;

/** 直線を ds ごとの点にする */
export function seg(x0: number, y0: number, x1: number, y1: number, ds = 5): Pt[] {
  const L = Math.hypot(x1 - x0, y1 - y0),
    m = Math.max(1, Math.ceil(L / ds)),
    out: Pt[] = [];
  for (let i = 0; i <= m; i++) out.push([x0 + ((x1 - x0) * i) / m, y0 + ((y1 - y0) * i) / m]);
  return out;
}
/** 円弧（角度は度、SVG の y は下向き） */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, ds = 5): Pt[] {
  const L = (Math.abs(a1 - a0) * Math.PI * r) / 180,
    m = Math.max(2, Math.ceil(L / ds)),
    out: Pt[] = [];
  for (let i = 0; i <= m; i++) {
    const a = ((a0 + ((a1 - a0) * i) / m) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}
export function join(...parts: Pt[][]): Pt[] {
  const out: Pt[] = [];
  for (const q of parts)
    for (const pt of q) {
      const l = out[out.length - 1];
      if (!l || Math.hypot(l[0] - pt[0], l[1] - pt[1]) > 0.01) out.push(pt);
    }
  return out;
}
function normals(pts: Pt[]): Pt[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(pts.length - 1, i + 1)],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
}
/** 中心線の両側に半幅 hw の帯（管の外形） */
export function ribbon(pts: Pt[], hw: number | ((p: Pt) => number)): string {
  const nm = normals(pts),
    L: string[] = [],
    R: string[] = [];
  pts.forEach((p, i) => {
    const w = typeof hw === 'function' ? hw(p) : hw;
    L.push(P(p[0] + nm[i][0] * w, p[1] + nm[i][1] * w));
    R.push(P(p[0] - nm[i][0] * w, p[1] - nm[i][1] * w));
  });
  return `M${L.join('L')}L${R.reverse().join('L')}Z`;
}
const rect = (x0: number, y0: number, x1: number, y1: number, r: number) =>
  `M${P(x0 + r, y0)}H${f1(x1 - r)}Q${P(x1, y0)} ${P(x1, y0 + r)}V${f1(y1 - r)}Q${P(x1, y1)} ${P(x1 - r, y1)}H${f1(x0 + r)}Q${P(x0, y1)} ${P(x0, y1 - r)}V${f1(y0 + r)}Q${P(x0, y0)} ${P(x0 + r, y0)}Z`;
const lerpT = (T: readonly (readonly [number, number])[], z: number) => {
  if (z <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++)
    if (z <= T[i][0]) {
      const [z0, r0] = T[i - 1],
        [z1, r1] = T[i];
      return z1 > z0 ? r0 + ((r1 - r0) * (z - z0)) / (z1 - z0) : r1;
    }
  return T[T.length - 1][1];
};

/* ---------- マウスピース（mm） ---------- */
/** 縁の面の形（深さ z、軸からの距離 r） */
export const RIM: readonly (readonly [number, number])[] = [
  [0.5, 8.1],
  [0.12, 8.7],
  [0, 9.5],
  [0.08, 10.3],
  [0.35, 11.2],
  [0.8, 11.9],
  [1.1, 12.4],
  [1.6, 13.0],
  [2.1, 13.37],
  [2.7, 13.57],
  [3.2, 13.68],
];
/** 外形（写真から。縁の帯 → カップの外側 → 柄の輪とくびれ → シャンク） */
export const OUT: readonly (readonly [number, number])[] = [
  [8.8, 13.68],
  [9.3, 13.4],
  [9.6, 13.0],
  [9.87, 11.3],
  [10.4, 11.2],
  [10.9, 10.8],
  [11.5, 10.5],
  [12.8, 9.93],
  [15.5, 9.87],
  [16.8, 9.73],
  [18.1, 9.43],
  [19.5, 9.0],
  [20.8, 8.33],
  [22.1, 7.47],
  [22.7, 7.0],
  [23.2, 6.43],
  [23.7, 5.83],
  [24.0, 5.43],
  [24.3, 5.17],
  [24.8, 5.13],
  [25.1, 4.7],
  [28.8, 4.67],
  [29.3, 4.87],
  [30.1, 5.17],
  [30.8, 5.53],
  [31.4, 5.87],
  [31.7, 5.93],
  [32.3, 5.75],
  [32.8, 5.47],
  [33.4, 5.2],
  [33.9, 5.03],
  [34.1, 4.73],
  [37.9, 4.67],
  [38.4, 4.87],
  [38.9, 5.03],
  [39.2, 5.33],
  [39.8, 5.4],
  [44.0, 5.5],
  [44.3, 5.6],
  [44.5, 5.83],
  [44.8, 5.9],
  [46.1, 5.9],
  [48.8, 5.83],
  [55.5, 5.63],
  [62.1, 5.47],
  [68.8, 5.2],
  [75.5, 5.0],
  [82.1, 4.83],
  [85.9, 4.77],
  [87.2, 4.65],
  [87.7, 4.5],
  [88, 4.35],
];
/** 内径（7C 相当）: カップ（深さ 8.4、肩を 2 次曲線で丸める）→ スロート（径 3.66、z 14.4 まで）→ バックボア（出口の径 8.5） */
export function mpIn(z: number): number {
  if (z < 7.84) return 1.83 + 6.27 * (1 - (Math.max(0, z - 0.5) / 7.9) ** 1.6) ** (1 / 1.6);
  if (z < 10.4) {
    let lo = 0,
      hi = 1;
    for (let k = 0; k < 30; k++) {
      const t = (lo + hi) / 2,
        zz = (1 - t) * (1 - t) * 7.84 + 2 * t * (1 - t) * 8.4 + t * t * 10.4;
      if (zz < z) lo = t;
      else hi = t;
    }
    return (1 - lo) * (1 - lo) * 3.43 + 2 * lo * (1 - lo) * 1.83 + lo * lo * 1.83;
  }
  if (z <= 14.4) return 1.83;
  return 1.83 + 2.42 * ((z - 14.4) / 73.6) ** 0.6;
}
const INN: Pt[] = (() => {
  const out: Pt[] = [];
  for (let z = 0.5; z < 10.4; z += 0.2) out.push([z, mpIn(z)]);
  out.push([10.4, 1.83], [14.4, 1.83]);
  for (let z = 16; z <= 88; z += 4) out.push([z, mpIn(z)]);
  out.push([88, 4.25]);
  return out;
})();

/** 唇とマウスピースの断面の図（縦は軸からの距離、横は縁の面からの深さ。1 mm = 5.4 px、縁の面 x 104、軸 y 150） */
export const MP_VIEW = { w: 620, h: 300, sc: 5.4, x0: 104, y0: 150 };
const XZ = (z: number) => MP_VIEW.x0 + MP_VIEW.sc * z,
  YR = (r: number) => MP_VIEW.y0 - MP_VIEW.sc * r,
  Q = (z: number, r: number) => P(XZ(z), YR(r));

/** なめらかな閉じた輪郭（Catmull-Rom）。3 番目の要素が真の点は角として直線でつなぐ */
function smooth(pts: readonly (readonly [number, number, boolean?])[]): string {
  let d = `M${Q(pts[0][0], pts[0][1])}`;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p1 = pts[i],
      p2 = pts[i + 1];
    if (p1[2] || p2[2]) {
      d += `L${Q(p2[0], p2[1])}`;
      continue;
    }
    const p0 = pts[Math.max(0, i - 1)],
      p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${Q(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)} ${Q(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)} ${Q(p2[0], p2[1])}`;
  }
  return `${d}Z`;
}

/** 断面の図の、動かない部分 */
export const MP_STATIC = (() => {
  const half = (sg: number) =>
    `M${RIM.concat(OUT)
      .map(([z, r]) => Q(z, sg * r))
      .join('L')}L${INN.slice()
      .reverse()
      .map(([z, r]) => Q(z, sg * r))
      .join('L')}Z`;
  const recv = (sg: number) =>
    `M${Q(64, sg * 5.47)}L${Q(64, sg * 7.2)}H${f1(XZ(96))}V${f1(YR(sg * 4.45))}H${f1(XZ(88.4))}L${OUT.filter(
      ([z]) => z >= 64,
    )
      .slice()
      .reverse()
      .map(([z, r]) => Q(Math.min(z, 88), sg * r))
      .join('L')}Z`;
  const lead = (z: number, r: number) => `M${Q(z, r)}V${f1(YR(-15.5))}`;
  return {
    metal: half(1) + half(-1),
    air: `M${INN.map(([z, r]) => Q(z, r)).join('L')}L${INN.slice()
      .reverse()
      .map(([z, r]) => Q(z, -r))
      .join('L')}Z`,
    lpAir: `M${Q(88, 4.25)}L${Q(88.4, 4.45)}H${f1(XZ(96))}V${f1(YR(-4.45))}H${f1(XZ(88.4))}L${Q(88, -4.25)}Z`,
    recv: recv(1) + recv(-1),
    mouth: `M${Q(-23, 9.5)}H${f1(XZ(3))}V${f1(YR(-9.5))}H${f1(XZ(-23))}Z`,
    teeth:
      smooth([
        [-10.0, 1.3],
        [-8.9, 5],
        [-8.75, 9],
        [-9.3, 13.4],
        [-11.5, 14.2],
        [-15.6, 13.0],
        [-14.6, 8],
        [-12.3, 3.2],
        [-11.0, 1.4],
      ]) +
      smooth([
        [-12.4, -1.5],
        [-11.2, -5.5],
        [-10.9, -9.5],
        [-11.4, -13.0],
        [-13.5, -13.8],
        [-16.6, -12.6],
        [-15.8, -8],
        [-14.0, -3.4],
        [-13.2, -1.6],
      ]),
    leads: lead(11.4, -1.83) + lead(40, -mpIn(40)) + lead(70, -5.15) + lead(92, -7.2),
  };
})();

/** 唇の形: 開き h [mm] と、外への振れ sw [mm]（開くときはカップの側へ） */
export function lipShapes(
  h: number,
  opening: boolean,
): { tissue: string; red: string; jet: string; arrow: string; dim: string } {
  const g = Math.max(0, h) / 2,
    sw = Math.max(-0.3, Math.min(1.2, (h - 0.3) * 1.2)),
    zt = 2.2 + sw;
  const cupSide: [number, number, boolean?][] = [
    [zt, g],
    [zt - 0.2, g + 0.7],
    [zt - 0.5, 2.0],
    [1.6 + 0.4 * sw, 3.6],
    [1.0, 5.5],
    [0.66, 7.4],
    [0.55, 8.1],
    [0.17, 8.7],
    [0.05, 9.5],
    [0.13, 10.3],
    [0.42, 11.3],
    [0.45, 12.3],
  ];
  const faceU = cupSide.concat([
    [0.0, 13.6],
    [-0.8, 15.5],
    [-2.0, 18],
    [-3.6, 21],
    [-5.5, 24],
    [-7.5, 27],
    [-9.2, 31, true],
    [-23, 31, true],
    [-23, 9, true],
    [-17, 9, true],
    [-15.8, 12.6],
    [-12.5, 13.2],
    [-9.2, 12.4],
    [-8.7, 9],
    [-8.6, 5],
    [-8.0, 2.6],
    [-6.3, 1.5],
    [-3.5, g + 0.7],
    [-0.6, g + 0.35],
  ]);
  const redU = cupSide.slice(0, 7).concat([
    [-1.4, 9.4],
    [-5, 8.3],
    [-7.6, 5.5],
    [-8.0, 2.6],
    [-6.3, 1.5],
    [-3.5, g + 0.7],
    [-0.6, g + 0.35],
  ]);
  const mir = (pts: [number, number, boolean?][], dz: number, zMin: number) =>
    pts.map(([z, r, c]) => [z < zMin && !c ? z + dz : z, -r, c] as [number, number, boolean?]);
  const x = XZ(zt + 0.6),
    y1 = YR(g + 1.2),
    y2 = YR(-g - 1.2),
    d = opening ? 1 : -1;
  return {
    tissue: smooth(faceU) + smooth(mir(faceU, -1.8, -8)),
    red: smooth(redU) + smooth(mir(redU, -1.2, -6)),
    jet: g > 0.05 ? `M${Q(zt - 1, 0)}H${f1(XZ(zt + 7))}` : 'M0 0',
    arrow: `M${P(x - 6 * d, y1 + 4 * d)}L${P(x + 3 * d, y1 - 3)}M${P(x - 6 * d, y2 - 4 * d)}L${P(x + 3 * d, y2 + 3)}`,
    dim: `M${Q(zt + 0.2, g)}H${f1(XZ(zt + 4))}M${Q(zt + 0.2, -g)}H${f1(XZ(zt + 4))}`,
  };
}

/* ---------- 横から見た楽器（図の座標、約 1.73 px/mm） ---------- */
export const SIDE_VIEW = '-10 -42 985 352';
/**
 * ベルの外の半径。広がり（x 830 から縁まで）は Wikimedia Commons の写真「Trompette - corps.JPG」（Eusebius、CC BY 3.0）の
 * 輪郭を列ごとに測り、縁の直径を 123 mm（図の 214 px）に合わせたもの。管の部分は、ほかの管と同じく実物より細く描く
 */
const BELL: readonly (readonly [number, number])[] = [
  [197, 6.5],
  [300, 6.8],
  [400, 7.5],
  [500, 8.5],
  [600, 10],
  [700, 13],
  [760, 16],
  [800, 19.5],
  [830, 23.5],
  [855, 30],
  [878, 38],
  [890, 44],
  [902, 51.5],
  [913, 59.5],
  [919, 65.5],
  [928, 76],
  [933, 86],
  [937, 97],
  [941, 103],
  [945, 106],
  [950, 107],
];
const bellR = (x: number) => lerpT(BELL, x);
const PXM = 1.73;
/** 弁の中心の x */
export const VX = [365, 405, 445] as const;

/** 動かない管と弁のケース */
export const SIDE_STATIC = (() => {
  const bellPts = join(seg(350, 243, 197, 243), arc(197, 175.5, 67.5, 90, 270, 4), seg(197, 108, 950, 108, 4));
  return {
    bell: ribbon(bellPts, (p) => (p[1] < 109 && p[0] >= 197 ? bellR(p[0]) : 6.5)),
    main: ribbon(join(seg(690, 138, 706, 138), arc(706, 192, 54, -90, 90, 4), seg(706, 246, 458, 246)), 7),
    third: ribbon(join(seg(458, 206, 690, 206), arc(690, 219.5, 13.5, -90, 90, 3), seg(690, 233, 458, 233)), 5.5),
    first: ribbon(join(seg(352, 221, 243, 221), arc(243, 235.5, 14.5, 270, 90, 3), seg(243, 250, 352, 250)), 5.5),
    knuck: ribbon(seg(378, 196, 392, 196), 5) + ribbon(seg(418, 196, 432, 196), 5),
    recv: ribbon(seg(98, 138.5, 186, 138), 10.5),
    lead: ribbon(seg(186, 138, 700, 138), (p) => 6 + (p[0] - 186) / 514),
    mouth: ribbon(seg(0, 139, 101, 139, 0.4), (p) => lerpT(RIM.slice(2).concat(OUT), p[0] / PXM) * PXM),
    bellRim: 'M950 1C957 1 960 50 960 108S957 215 950 215C946 215 944 160 944 108S946 1 950 1Z',
    bellLip: 'M951 6C955 30 956 70 956 108S955 186 951 210',
    hiBack: 'M300 104.5H800M712 141A51 51 0 0 1 757 192',
    hiFront: 'M190 135.4H690',
    casings: VX.map((c) => rect(c - 15, 98, c + 15, 292, 2)).join(''),
    caps: VX.map((c) => rect(c - 17, 90, c + 17, 103, 2) + rect(c - 17, 286, c + 17, 299, 3)).join(''),
    bands: VX.map((c) => `M${P(c - 15, 116)}H${f1(c + 15)}M${P(c - 15, 270)}H${f1(c + 15)}`).join(''),
    second: 'M385 203C391 203 393 210 393 216S391 229 385 229C379 229 377 222 377 216S379 203 385 203Z',
    saddle: 'M304 163C306 175 308 190 314 198C319 204 330 204 335 198C341 190 343 175 344 163M324 203V214',
    ring: 'M525 163A17 17 0 1 1 524.9 163M525 197V206',
  };
})();

/** 弁のボタン（押し具合 0〜1 で 13 px 下がる）: 軸・ボタン・真珠・押した印 */
export function keyShapes(press: readonly number[]): {
  stems: string;
  caps: string[];
  pearls: string[];
  marks: string[];
} {
  const caps: string[] = [],
    pearls: string[] = [],
    marks: string[] = [];
  let stems = '';
  VX.forEach((c, i) => {
    const y = 60 + 13 * press[i];
    stems += rect(c - 2.6, 74 + 13 * press[i], c + 2.6, 91, 1);
    caps.push(rect(c - 17, y, c + 17, y + 15, 4));
    pearls.push(rect(c - 13, y + 2.5, c + 13, y + 8.5, 3));
    marks.push(press[i] > 0.5 ? rect(c - 19, y - 2, c + 19, y + 17, 5) : 'M0 0');
  });
  return { stems, caps, pearls, marks };
}

/**
 * 気柱の区間: 中心線、内側の半幅、奥（b）か手前（f）か、管の模型の要素と位置（Bore.pressureAt の el と s の範囲）。
 * 弁の組ごとに通り道が変わる（押した弁は抜差しを回る）
 */
interface AirPiece {
  pts: Pt[];
  hw: (p: Pt) => number;
  layer: 'b' | 'f';
  el: number;
  s0: number;
  s1: number;
}
/** 気柱の 1 つの四角（帯の 1 区切り）: 形、層、要素と位置 */
export interface AirQuad {
  d: string;
  layer: 'b' | 'f';
  el: number;
  s: number;
}

/** 押した弁の組（第 1・第 2・第 3）の気柱の四角の列 */
export function airQuads(v: readonly boolean[]): AirQuad[] {
  const pieces: AirPiece[] = [];
  const add = (pts: Pt[], hw: number | ((p: Pt) => number), layer: 'b' | 'f', el: number, s0 = 0, s1 = 1) =>
    pieces.push({ pts, hw: typeof hw === 'number' ? () => hw : hw, layer, el, s0, s1 });
  /* マウスピース（88 mm）とリードパイプ: 要素 0 の 0〜0.261 と 0.261〜1 */
  add(seg(0.9, 139, 152, 138.7, 1.2), (p) => Math.max(0.8, mpIn(p[0] / PXM) * PXM - 0.6), 'f', 0, 0, 0.261);
  add(seg(152, 138.7, 700, 138, 5), (p) => 4.2 + (p[0] - 152) / 900, 'f', 0, 0.261, 1);
  add(join(seg(700, 138, 706, 138), arc(706, 192, 54, -90, 90, 4), seg(706, 246, 460, 246)), 4.2, 'b', 1);
  if (v[2]) {
    add(
      join(
        seg(460, 246, 466, 240),
        seg(466, 240, 470, 233),
        seg(470, 233, 690, 233),
        arc(690, 219.5, 13.5, 90, -90, 3),
        seg(690, 206, 460, 206),
      ),
      3.4,
      'b',
      2,
      0,
      0.95,
    );
    add(seg(460, 206, 445, 196), 3, 'f', 2, 0.95, 1);
  } else add(seg(460, 246, 445, 196), 3, 'f', 2);
  add(seg(445, 196, 405, 196), 3, 'f', 3);
  if (v[1]) add(arc(395, 216, 10, -60, 300, 3), 2.6, 'f', 4);
  else add(seg(405, 196, 404, 196, 1), 2.6, 'f', 4);
  add(seg(405, 196, 365, 196), 3, 'f', 5);
  if (v[0])
    add(
      join(
        seg(365, 196, 352, 221),
        seg(352, 221, 243, 221),
        arc(243, 235.5, 14.5, 270, 90, 3),
        seg(243, 250, 352, 250),
        seg(352, 250, 350, 243),
      ),
      3.4,
      'f',
      6,
    );
  else add(seg(365, 196, 350, 243), 3, 'f', 6);
  add(seg(350, 243, 197, 243), 3.8, 'b', 7);
  add(
    join(arc(197, 175.5, 67.5, 90, 270, 4), seg(197, 108, 950, 108, 4)),
    (p) => (p[1] < 109 && p[0] >= 197 ? Math.max(3.8, bellR(p[0]) * 0.9 - 1.5) : 3.8),
    'b',
    8,
  );
  const out: AirQuad[] = [];
  for (const pc of pieces) {
    const nm = normals(pc.pts),
      w = pc.pts.map((p) => pc.hw(p)),
      len: number[] = [0];
    for (let i = 1; i < pc.pts.length; i++)
      len.push(len[i - 1] + Math.hypot(pc.pts[i][0] - pc.pts[i - 1][0], pc.pts[i][1] - pc.pts[i - 1][1]));
    const L = len[len.length - 1] || 1;
    for (let i = 0; i + 1 < pc.pts.length; i++) {
      const a = pc.pts[i],
        b = pc.pts[i + 1],
        u = (len[i] + len[i + 1]) / 2 / L;
      out.push({
        d: `M${P(a[0] + nm[i][0] * w[i], a[1] + nm[i][1] * w[i])}L${P(b[0] + nm[i + 1][0] * w[i + 1], b[1] + nm[i + 1][1] * w[i + 1])}L${P(b[0] - nm[i + 1][0] * w[i + 1], b[1] - nm[i + 1][1] * w[i + 1])}L${P(a[0] - nm[i][0] * w[i], a[1] - nm[i][1] * w[i])}Z`,
        layer: pc.layer,
        el: pc.el,
        s: pc.s0 + (pc.s1 - pc.s0) * u,
      });
    }
  }
  return out;
}

/** 管の中の圧力を読む点（要素ごとの数）。図の四角は最も近い点の値を使う */
export const AIR_N = [80, 24, 12, 3, 8, 3, 12, 10, 80] as const;
/** 読む点の列（要素, 位置）の対 */
export function airPoints(): Float32Array {
  const out: number[] = [];
  AIR_N.forEach((n, el) => {
    for (let i = 0; i < n; i++) out.push(el, (i + 0.5) / n);
  });
  return Float32Array.from(out);
}
/** 要素 el の位置 s に最も近い読む点の番号 */
export function airIndex(el: number, s: number): number {
  let k = 0;
  for (let i = 0; i < el; i++) k += AIR_N[i];
  return k + Math.min(AIR_N[el] - 1, Math.max(0, Math.floor(s * AIR_N[el])));
}

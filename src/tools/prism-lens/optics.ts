/**
 * プリズムとレンズのページの光の計算。平面（上から見た断面）の幾何光学で、光線を部品の面ごとに屈折・反射させる。
 * 長さの単位は 0.1 mm（図の 1 単位）、波長は nm。DOM に依らない
 */
import { CATALOG, type Sellmeier, sellmeier } from '../lens/glass';

/* ---------- 材質 ---------- */
export type MatKey = 'bk7' | 'sf11' | 'acr' | 'water' | 'dia';
export interface Material {
  /** 選択肢の短い名前 */
  sh: string;
  /** 吹き出しの名前 */
  name: string;
  /** 屈折率（波長 nm） */
  n: (lnm: number) => number;
}
const sell = (g: Sellmeier) => (lnm: number) => sellmeier(g, lnm / 1000);
/** 重フリントガラス SF11（SCHOTT のカタログ） */
const SF11: Sellmeier = {
  name: 'SF11',
  nd: 1.78472,
  vd: 25.68,
  B: [1.73759695, 0.313747346, 1.89878101],
  C: [0.013188707, 0.0623068142, 155.23629],
};
/** 4 項の Sellmeier の式（λ は µm） */
function sell4(B: readonly number[], C: readonly number[], l: number): number {
  const l2 = l * l;
  let s = 1;
  for (let i = 0; i < B.length; i++) s += (B[i] * l2) / (l2 - C[i]);
  return Math.sqrt(s);
}
/** 蒸留水 20 ℃（Daimon・Masumura 2007） */
const WATER_B = [5.684027565e-1, 1.726177391e-1, 2.086189578e-2, 1.130748688e-1],
  WATER_C = [5.101829712e-3, 1.821153936e-2, 2.620722293e-2, 1.069792721e1];
/** アクリル PMMA（Sultanova ほか 2009） */
const PMMA_B = [1.1819],
  PMMA_C = [0.011313];
/** ダイヤモンド（Peter 1923） */
const DIA_B = [0.3306, 4.3356],
  DIA_C = [0.175 * 0.175, 0.106 * 0.106];

export const MATS: Record<MatKey, Material> = {
  bk7: { sh: 'BK7', name: 'クラウンガラス BK7', n: sell(CATALOG['N-BK7']) },
  sf11: { sh: 'SF11', name: '重フリントガラス SF11', n: sell(SF11) },
  acr: { sh: 'アクリル', name: 'アクリル（PMMA）', n: (l) => sell4(PMMA_B, PMMA_C, l / 1000) },
  water: { sh: '水', name: '水（20 ℃）', n: (l) => sell4(WATER_B, WATER_C, l / 1000) },
  dia: { sh: 'ダイヤモンド', name: 'ダイヤモンド', n: (l) => sell4(DIA_B, DIA_C, l / 1000) },
};
export const MAT_KEYS = Object.keys(MATS) as MatKey[];
/** d 線（ヘリウム 587.6 nm）。屈折率と焦点距離の表示に使う */
export const LAM_D = 587.56;

/* ---------- 部品 ---------- */
export type PartType =
  | 'beam'
  | 'laser'
  | 'lamp'
  | 'prism'
  | 'penta'
  | 'convex'
  | 'concave'
  | 'semi'
  | 'plate'
  | 'drop'
  | 'mirror'
  | 'cmirror'
  | 'half'
  | 'screen';

export interface Part {
  id: number;
  t: PartType;
  x: number;
  y: number;
  /** 回転 [°]。光源は光の向き（0 で右へ） */
  ang: number;
  /** 光源: 白色光か */
  white: boolean;
  /** 光源: 単色の波長 [nm] */
  lam: number;
  /** 平行光の幅・ガラス板の幅 */
  w: number;
  mat: MatKey;
  /** プリズムの頂角 [°] */
  apex: number;
  /** プリズムの斜辺の長さ */
  size: number;
  /** 曲率半径（レンズ・凹面鏡） */
  R: number;
  /** 直径（レンズ・凹面鏡） */
  D: number;
  /** ガラス板の厚さ */
  h: number;
  /** 水滴の半径 */
  r: number;
  /** 平面鏡・ハーフミラー・スクリーンの長さ */
  L: number;
}

export const NAMES: Record<PartType, string> = {
  beam: '平行光',
  laser: 'レーザー',
  lamp: '点光源',
  prism: 'プリズム',
  penta: 'ペンタプリズム',
  convex: '凸レンズ',
  concave: '凹レンズ',
  semi: '半円形レンズ',
  plate: 'ガラス板',
  drop: '水滴',
  mirror: '平面鏡',
  cmirror: '凹面鏡',
  half: 'ハーフミラー',
  screen: 'スクリーン',
};
/** 道具の並び（'|' は区切り） */
export const ORDER: (PartType | '|')[] = [
  'beam',
  'laser',
  'lamp',
  '|',
  'prism',
  'penta',
  'convex',
  'concave',
  'semi',
  'plate',
  'drop',
  '|',
  'mirror',
  'cmirror',
  'half',
  '|',
  'screen',
];
export const isSource = (t: PartType): boolean => t === 'beam' || t === 'laser' || t === 'lamp';

const BASE: Omit<Part, 'id' | 't' | 'x' | 'y' | 'ang'> = {
  white: true,
  lam: 532,
  w: 30,
  mat: 'bk7',
  apex: 60,
  size: 170,
  R: 220,
  D: 170,
  h: 60,
  r: 110,
  L: 170,
};
/** 部品ごとの既定値（BASE との違い） */
export const DEFAULTS: Record<PartType, Partial<Part>> = {
  beam: { w: 30 },
  laser: { white: false, lam: 532 },
  lamp: {},
  prism: { mat: 'sf11' },
  penta: { size: 160 },
  convex: {},
  concave: {},
  semi: { r: 120 },
  plate: { w: 240, h: 60 },
  drop: { mat: 'water' },
  mirror: {},
  cmirror: { R: 360, D: 200 },
  half: { L: 150 },
  screen: { L: 220 },
};

let uid = 1;
export function make(t: PartType, x = 0, y = 0, ang = 0, p: Partial<Part> = {}): Part {
  return { ...BASE, ...DEFAULTS[t], ...p, id: uid++, t, x, y, ang };
}
/** 保存した部品を読み直す（足りない項目は既定値、id は振り直す） */
export function revive(q: Partial<Part>): Part | null {
  if (!q || typeof q !== 'object' || !(q.t && q.t in NAMES)) return null;
  const o = make(q.t, 0, 0, 0);
  for (const k of Object.keys(BASE) as (keyof typeof BASE)[]) {
    const v = q[k];
    if (typeof v === typeof o[k]) (o as unknown as Record<string, unknown>)[k] = v;
  }
  if (!(o.mat in MATS)) o.mat = 'bk7';
  for (const k of ['x', 'y', 'ang'] as const) if (typeof q[k] === 'number' && Number.isFinite(q[k])) o[k] = q[k];
  return o;
}
export function clone(o: Part, dx = 0, dy = 0): Part {
  return { ...o, id: uid++, x: o.x + dx, y: o.y + dy };
}

/** 部品の形: 部品の座標の頂点と、辺ごとの円弧の中心（直線の辺は null） */
export interface Geom {
  P: [number, number][];
  Cn: ([number, number] | null)[];
  closed: boolean;
  kind: 'solid' | 'mirror' | 'split' | 'screen';
  /** 辺ごとの種類（ペンタプリズムの鏡の面）。省略時は kind */
  kinds?: Geom['kind'][];
}
/**
 * ペンタプリズムの頂点（入る面と出る面のなす角 90°、ほかの 4 つの角 112.5°）。入る面と出る面の長さ a、
 * 鏡の 2 面の長さ 1.082a。頂点の平均を原点にする
 */
export function pentaPts(a: number): [number, number][] {
  const c = 1.082 * a,
    e = (a + c * (Math.cos(67.5 * D2R) + Math.cos(202.5 * D2R))) / -Math.cos(135 * D2R),
    dirs = [0, 67.5, 135, 202.5],
    L = [a, c, e, c],
    P: [number, number][] = [[0, 0]];
  for (let i = 0; i < 4; i++) {
    const [x, y] = P[i];
    P.push([x + L[i] * Math.cos(dirs[i] * D2R), y + L[i] * Math.sin(dirs[i] * D2R)]);
  }
  const mx = P.reduce((s, p) => s + p[0], 0) / 5,
    my = P.reduce((s, p) => s + p[1], 0) / 5;
  return P.map(([x, y]) => [x - mx, y - my]);
}
/** レンズの中心の厚さ（凸は縁に 0.6 mm 残す） */
export function lensThick(o: Pick<Part, 't' | 'R' | 'D'>): number {
  const h = Math.min(o.D / 2, o.R * 0.97),
    sag = o.R - Math.sqrt(o.R * o.R - h * h);
  return o.t === 'convex' ? 2 * sag + 6 : 8;
}
export function geom(o: Part): Geom {
  const P: [number, number][] = [],
    Cn: ([number, number] | null)[] = [];
  const push = (x: number, y: number, c: [number, number] | null) => {
    P.push([x, y]);
    Cn.push(c);
  };
  switch (o.t) {
    case 'prism': {
      const a = o.apex * (Math.PI / 180),
        b = 2 * o.size * Math.sin(a / 2),
        h = o.size * Math.cos(a / 2);
      push(0, (-2 * h) / 3, null);
      push(b / 2, h / 3, null);
      push(-b / 2, h / 3, null);
      return { P, Cn, closed: true, kind: 'solid' };
    }
    case 'penta':
      for (const [x, y] of pentaPts(o.size)) push(x, y, null);
      /* 辺は 入る面・鏡・余りの面・鏡・出る面 の順 */
      return { P, Cn, closed: true, kind: 'solid', kinds: ['solid', 'mirror', 'solid', 'mirror', 'solid'] };
    case 'semi': {
      /* 平らな面の中心を原点に、半円の面を右に置く */
      const N = 60;
      for (let i = 0; i <= N; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / N;
        push(o.r * Math.cos(a), o.r * Math.sin(a), i < N ? [0, 0] : null);
      }
      return { P, Cn, closed: true, kind: 'solid' };
    }
    case 'convex':
    case 'concave': {
      const R = o.R,
        h = Math.min(o.D / 2, R * 0.97),
        N = 40,
        cv = o.t === 'convex',
        t = lensThick(o),
        sag = (y: number) => R - Math.sqrt(R * R - y * y),
        xr = (y: number) => (cv ? t / 2 - sag(y) : t / 2 + sag(y)),
        cr: [number, number] = cv ? [t / 2 - R, 0] : [t / 2 + R, 0],
        cl: [number, number] = [-cr[0], 0];
      for (let i = 0; i <= N; i++) {
        const y = -h + (2 * h * i) / N;
        push(xr(y), y, i < N ? cr : null);
      }
      for (let i = 0; i <= N; i++) {
        const y = h - (2 * h * i) / N;
        push(-xr(y), y, i < N ? cl : null);
      }
      return { P, Cn, closed: true, kind: 'solid' };
    }
    case 'plate':
      push(-o.w / 2, -o.h / 2, null);
      push(o.w / 2, -o.h / 2, null);
      push(o.w / 2, o.h / 2, null);
      push(-o.w / 2, o.h / 2, null);
      return { P, Cn, closed: true, kind: 'solid' };
    case 'drop':
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * 2 * Math.PI;
        push(o.r * Math.cos(a), o.r * Math.sin(a), [0, 0]);
      }
      return { P, Cn, closed: true, kind: 'solid' };
    case 'cmirror': {
      const R = o.R,
        h = Math.min(o.D / 2, R * 0.95),
        N = 30;
      for (let i = 0; i <= N; i++) {
        const y = -h + (2 * h * i) / N;
        push(-R + Math.sqrt(R * R - y * y), y, [-R, 0]);
      }
      return { P, Cn, closed: false, kind: 'mirror' };
    }
    default:
      push(0, -o.L / 2, null);
      push(0, o.L / 2, null);
      return { P, Cn, closed: false, kind: o.t === 'mirror' ? 'mirror' : o.t === 'half' ? 'split' : 'screen' };
  }
}

const D2R = Math.PI / 180;
export function toWorld(o: Part, x: number, y: number): [number, number] {
  const c = Math.cos(o.ang * D2R),
    s = Math.sin(o.ang * D2R);
  return [o.x + c * x - s * y, o.y + s * x + c * y];
}
export function toLocal(o: Part, x: number, y: number): [number, number] {
  const c = Math.cos(o.ang * D2R),
    s = Math.sin(o.ang * D2R),
    dx = x - o.x,
    dy = y - o.y;
  return [c * dx + s * dy, -s * dx + c * dy];
}
/** 部品を囲む円の半径（選んだ印の輪） */
export function radius(o: Part): number {
  if (o.t === 'beam') return Math.max(26, o.w / 2 + 8);
  if (o.t === 'laser' || o.t === 'lamp') return 24;
  let m = 0;
  for (const [x, y] of geom(o).P) m = Math.max(m, Math.hypot(x, y));
  return m;
}
/** 回すつまみの位置（輪の上、回転 0 で真上） */
export function knob(o: Part, gap: number): [number, number] {
  const r = radius(o) + gap,
    a = (o.ang - 90) * D2R;
  return [o.x + Math.cos(a) * r, o.y + Math.sin(a) * r];
}
/** 点 (x, y) が部品に当たるか。tol は細い部品の太さの半分 */
export function hits(o: Part, x: number, y: number, tol: number): boolean {
  const [lx, ly] = toLocal(o, x, y);
  if (o.t === 'beam') return lx > -20 && lx < 24 && Math.abs(ly) < o.w / 2 + 6;
  if (o.t === 'laser') return lx > -30 && lx < 24 && Math.abs(ly) < 11;
  if (o.t === 'lamp') return Math.hypot(lx, ly) < 15;
  const g = geom(o),
    P = g.P;
  if (g.closed) {
    let inside = false;
    for (let a = 0, b = P.length - 1; a < P.length; b = a++)
      if (P[a][1] > ly !== P[b][1] > ly && lx < ((P[b][0] - P[a][0]) * (ly - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0])
        inside = !inside;
    return inside;
  }
  for (let k = 0; k < P.length - 1; k++) {
    const [ax, ay] = P[k],
      [bx, by] = P[k + 1],
      ex = bx - ax,
      ey = by - ay;
    const u = Math.max(0, Math.min(1, ((lx - ax) * ex + (ly - ay) * ey) / (ex * ex + ey * ey)));
    if (Math.hypot(ax + ex * u - lx, ay + ey * u - ly) < tol) return true;
  }
  return false;
}

/** 焦点距離（d 線、レンズは厚肉レンズの式、凹面鏡は R/2）。凹は負 */
export function focal(o: Part): number {
  if (o.t === 'cmirror') return o.R / 2;
  const n = MATS[o.mat].n(LAM_D),
    t = lensThick(o),
    s = o.t === 'convex' ? 1 : -1;
  return 1 / ((n - 1) * ((2 * s) / o.R - ((n - 1) * t) / (n * o.R * o.R)));
}

/* ---------- 面 ---------- */
export interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** 外向きの法線（直線の辺） */
  nx: number;
  ny: number;
  /** 円弧の中心（NaN なら直線） */
  cx: number;
  cy: number;
  /** 円弧の法線の向き（中心から外へ +1） */
  sg: number;
  kind: Geom['kind'];
  mat: Material | null;
  obj: Part;
  /** スクリーン上の位置（0〜1） */
  s0: number;
  s1: number;
}
export function buildEdges(parts: readonly Part[]): Edge[] {
  const E: Edge[] = [];
  for (const o of parts) {
    if (isSource(o.t)) continue;
    const g = geom(o),
      W = g.P.map(([x, y]) => toWorld(o, x, y)),
      n = W.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = W[i],
        b = W[(i + 1) % n];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const fl = area < 0 ? -1 : 1,
      ne = g.closed ? n : n - 1,
      lens: number[] = [];
    let tot = 0;
    for (let i = 0; i < ne; i++) {
      const a = W[i],
        b = W[(i + 1) % n];
      lens.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
      tot += lens[i];
    }
    let cum = 0;
    for (let i = 0; i < ne; i++) {
      const a = W[i],
        b = W[(i + 1) % n],
        L = lens[i] || 1e-9,
        nx = (fl * (b[1] - a[1])) / L,
        ny = (fl * -(b[0] - a[0])) / L;
      const kind = g.kinds?.[i] ?? g.kind;
      const e: Edge = {
        ax: a[0],
        ay: a[1],
        bx: b[0],
        by: b[1],
        nx,
        ny,
        cx: Number.NaN,
        cy: Number.NaN,
        sg: 1,
        kind,
        mat: kind === 'solid' ? MATS[o.mat] : null,
        obj: o,
        s0: cum / tot,
        s1: (cum + L) / tot,
      };
      cum += L;
      const c = g.Cn[i];
      if (c) {
        const w = toWorld(o, c[0], c[1]),
          mx = (a[0] + b[0]) / 2 - w[0],
          my = (a[1] + b[1]) / 2 - w[1];
        e.cx = w[0];
        e.cy = w[1];
        e.sg = mx * nx + my * ny >= 0 ? 1 : -1;
      }
      E.push(e);
    }
  }
  return E;
}
export function hitEdge(E: readonly Edge[], ox: number, oy: number, dx: number, dy: number) {
  let best = Number.POSITIVE_INFINITY,
    be: Edge | null = null,
    bs = 0;
  for (const e of E) {
    const ex = e.bx - e.ax,
      ey = e.by - e.ay,
      den = dx * ey - dy * ex;
    if (den > -1e-12 && den < 1e-12) continue;
    const qx = e.ax - ox,
      qy = e.ay - oy,
      t = (qx * ey - qy * ex) / den;
    if (t <= 1e-4 || t >= best) continue;
    const s = (qx * dy - qy * dx) / den;
    if (s < 0 || s > 1) continue;
    best = t;
    be = e;
    bs = s;
  }
  return be ? { t: best, e: be, s: bs } : null;
}

/* ---------- 屈折と反射 ---------- */
/** フレネルの式の反射率（偏光していない光。s と p の平均） */
export function fresnel(n1: number, n2: number, cosi: number, cost: number): number {
  const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost),
    rp = (n2 * cosi - n1 * cost) / (n2 * cosi + n1 * cost);
  return (rs * rs + rp * rp) / 2;
}

export interface Ray {
  x: number;
  y: number;
  dx: number;
  dy: number;
  lam: number;
  /** 色の重み（線形 sRGB） */
  w: readonly number[];
  /** 強さ */
  I: number;
  depth: number;
}
const MAXD = 40;
/**
 * 光線を追う。部分反射は乱数でどちらか 1 本を選ぶ（平均すると強さはフレネルの式どおりに分かれる）。
 * partial が false なら、全反射でない面では屈折だけにする。seg は光線の区間ごと、screen はスクリーンに当たったとき
 */
export function trace(
  rays: Ray[],
  E: readonly Edge[],
  opt: {
    partial: boolean;
    rand: () => number;
    seg: (r: Ray, x1: number, y1: number) => void;
    screen?: (e: Edge, s: number, r: Ray) => void;
  },
): void {
  let guard = 0;
  while (rays.length && guard++ < 400000) {
    const r = rays.pop() as Ray,
      h = hitEdge(E, r.x, r.y, r.dx, r.dy),
      t = h ? h.t : 1e5,
      x1 = r.x + r.dx * t,
      y1 = r.y + r.dy * t;
    opt.seg(r, x1, y1);
    if (!h || r.depth >= MAXD) continue;
    const e = h.e;
    if (e.kind === 'screen') {
      opt.screen?.(e, e.s0 + h.s * (e.s1 - e.s0), r);
      continue;
    }
    let nx = e.nx,
      ny = e.ny;
    if (!Number.isNaN(e.cx)) {
      const ux = x1 - e.cx,
        uy = y1 - e.cy,
        l = Math.hypot(ux, uy);
      nx = (ux / l) * e.sg;
      ny = (uy / l) * e.sg;
    }
    let cosi = -(r.dx * nx + r.dy * ny);
    const ent = cosi > 0;
    if (!ent) {
      nx = -nx;
      ny = -ny;
      cosi = -cosi;
    }
    const next = (dx: number, dy: number, I: number): Ray => ({
      x: x1 + dx * 0.02,
      y: y1 + dy * 0.02,
      dx,
      dy,
      lam: r.lam,
      w: r.w,
      I,
      depth: r.depth + 1,
    });
    const refl = () => next(r.dx + 2 * cosi * nx, r.dy + 2 * cosi * ny, r.I);
    if (e.kind === 'mirror') {
      const q = refl();
      q.I *= 0.96;
      rays.push(q);
      continue;
    }
    if (e.kind === 'split') {
      rays.push(opt.rand() < 0.5 ? refl() : next(r.dx, r.dy, r.I));
      continue;
    }
    const nm = (e.mat as Material).n(r.lam),
      n1 = ent ? 1 : nm,
      n2 = ent ? nm : 1,
      eta = n1 / n2,
      k = 1 - eta * eta * (1 - cosi * cosi);
    if (k < 0) {
      rays.push(refl());
      continue;
    }
    const cost = Math.sqrt(k);
    if (opt.partial && opt.rand() < fresnel(n1, n2, cosi, cost)) {
      rays.push(refl());
      continue;
    }
    const a = eta * cosi - cost;
    rays.push(next(eta * r.dx + a * nx, eta * r.dy + a * ny, r.I));
  }
}

/**
 * 光源から出す光線。白色光は 400〜700 nm から一様に波長を選ぶ。
 * 強さは、図の上で光の帯の明るさが光線の数によらないように決める（幅 1 あたり k）
 */
export function emit(
  o: Part,
  N: number,
  k: number,
  rand: () => number,
  color: (l: number, white: boolean) => readonly number[],
): Ray[] {
  const a = o.ang * D2R,
    dx = Math.cos(a),
    dy = Math.sin(a),
    out: Ray[] = [];
  const add = (x: number, y: number, ddx: number, ddy: number, I: number) => {
    const l = o.white ? 400 + rand() * 300 : o.lam;
    out.push({ x, y, dx: ddx, dy: ddy, lam: l, w: color(l, o.white), I, depth: 0 });
  };
  if (o.t === 'beam') {
    const fx = o.x + dx * 20,
      fy = o.y + dy * 20;
    for (let i = 0; i < N; i++) {
      const u = (rand() - 0.5) * o.w;
      add(fx - dy * u, fy + dx * u, dx, dy, (o.w * k) / N);
    }
  } else if (o.t === 'laser') {
    const n = Math.max(1, Math.round(N / 40));
    for (let i = 0; i < n; i++) add(o.x + dx * 22, o.y + dy * 22, dx, dy, (2.4 * k) / n);
  } else
    for (let i = 0; i < N; i++) {
      const th = rand() * 2 * Math.PI;
      add(o.x + Math.cos(th) * 11, o.y + Math.sin(th) * 11, Math.cos(th), Math.sin(th), (2 * Math.PI * 120 * k) / N);
    }
  return out;
}

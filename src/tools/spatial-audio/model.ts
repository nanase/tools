/**
 * 立体音響の計算（DOM に依存しない）: 球の頭と耳介の反射のモデル（Brown・Duda 1998）、
 * 場所の種類と空間の値から決める反射面と残響、鏡像の音源、音源の一覧と場面。
 * 座標は上から見た世界の座標 [m]: x が右、y が前（画面の上）、z が上。聞き手の耳の高さを z = 0 とする
 */

export const TAU = 2 * Math.PI;
/** 頭の半径 [m]（Brown・Duda 1998 の平均） */
export const HEAD_A = 0.0875;
/** 音速 [m/s] */
export const CS = 343;
/** 耳介の反射 5 本: 強さ・遅れの係数 A・B・D（遅れは 44.1 kHz の標本数。Brown・Duda 1998 の表 I） */
export const PIN_R = [0.5, -1, 0.5, -0.25, 0.25] as const;
const PIN_A = [1, 5, 5, 5, 5],
  PIN_B = [2, 4, 7, 11, 13],
  PIN_D = [1, 0.5, 0.5, 0.5, 0.5];
/** 頭の陰の最も深い角度と、そのときの α（Brown・Duda 1998 の式 (5)） */
const TH_MIN = (150 * Math.PI) / 180,
  A_MIN = 0.1;

export type Vec3 = readonly [number, number, number];
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const len = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
export function unit(p: Vec3): Vec3 {
  const r = len(p) || 1;
  return [p[0] / r, p[1] / r, p[2] / r];
}

/** 片方の耳の手がかり: 遅れ [s]、頭の陰のフィルタの α、耳介の反射の遅れ [44.1 kHz の標本]（なければ null）、後ろの音を曇らせる量 */
export interface Ear {
  delay: number;
  alpha: number;
  taps: number[] | null;
  rear: number;
}
export interface Cues {
  itd: boolean;
  ild: boolean;
  pinna: boolean;
}
export const ALL_CUES: Cues = { itd: true, ild: true, pinna: true };

/**
 * 頭の座標の向き d（単位ベクトル。x 右・y 前・z 上）から来る音の、side の耳（−1 左・1 右）での手がかり。
 * 遅れは Woodworth の式（頭を回り込む道のり）、α は頭の陰の 1 次フィルタ（式 (5)）、耳介は 5 本の反射（式 (8)）
 */
export function earModel(d: Vec3, side: -1 | 1, cues: Cues = ALL_CUES): Ear {
  const cosT = clamp(side * d[0], -1, 1),
    th = Math.acos(cosT);
  const delay = cues.itd ? ((th < Math.PI / 2 ? 1 - cosT : 1 + th - Math.PI / 2) * HEAD_A) / CS : HEAD_A / CS;
  const alpha = cues.ild ? 1 + A_MIN / 2 + (1 - A_MIN / 2) * Math.cos((th / TH_MIN) * Math.PI) : 1;
  let taps: number[] | null = null,
    rear = 0;
  if (cues.pinna) {
    const az = Math.atan2(d[0], Math.abs(d[1])),
      el = Math.asin(clamp(d[2], -1, 1));
    taps = PIN_A.map((A, k) => Math.max(1, A * Math.cos(az / 2) * Math.sin(PIN_D[k] * (Math.PI / 2 - el)) + PIN_B[k]));
    /* 耳介は後ろからの高い音を遮る。モデルは前の半分だけなので、後ろは 1 次の低域通過を混ぜて近づける（このツールで決めた量） */
    rear = Math.max(0, -d[1]) * 0.75;
  }
  return { delay, alpha, taps, rear };
}

/** 頭の陰のフィルタの振幅（周波数 f [Hz]） */
export function shadowGain(alpha: number, f: number): number {
  const w = TAU * f,
    b = (2 * CS) / HEAD_A;
  return Math.hypot(alpha * w, b) / Math.hypot(w, b);
}

/* ---------- 場所 ---------- */

/** 反射する面: 軸（0 = x、1 = y、2 = z）の位置 v [m]、反射率 r（音圧）、高い音を落とす周波数 fc [Hz] */
export interface Plane {
  ax: 0 | 1 | 2;
  v: number;
  r: number;
  fc: number;
}
/** 残響: 残響時間 [s]、量（送る割合）、初めの遅れ [s]、高い音の減衰の周波数 [Hz]、遅延線の長さの倍率 */
export interface Late {
  t60: number;
  wet: number;
  pre: number;
  fc: number;
  size: number;
}
export type PlaceId = 'none' | 'field' | 'paddy' | 'forest' | 'alley' | 'room' | 'hall';
/** 空間の値: 幅・奥行き・天井の高さ [m]、地面と壁の反射率（音圧の比）、残響時間 [s]、残響の量（0〜1） */
export interface Space {
  w: number;
  d: number;
  h: number;
  refl: number;
  t60: number;
  wet: number;
}
/** 場所の種類: 屋内か、地面の高い音の減衰 [Hz]、描き方、既定の空間 */
export interface Kind {
  id: PlaceId;
  name: string;
  indoor: boolean;
  /** 反射も残響もない（無響） */
  free?: boolean;
  groundFc: number;
  walls?: 'box' | 'sides';
  trees?: boolean;
  /** 水面（田んぼ） */
  water?: boolean;
  def: Space;
}
/* 寸法・反射率・残響はこのツールで選んだ概数。路地は左右に通り、奥行きが両側の建物の間 */
export const KINDS: readonly Kind[] = [
  {
    id: 'none',
    name: '反射なし',
    indoor: false,
    free: true,
    groundFc: 0,
    def: { w: 60, d: 40, h: 3, refl: 0, t60: 0.5, wet: 0 },
  },
  {
    id: 'field',
    name: '草原',
    indoor: false,
    groundFc: 1500,
    def: { w: 60, d: 40, h: 3, refl: 0.45, t60: 0.6, wet: 0.03 },
  },
  {
    id: 'paddy',
    name: '田んぼ',
    indoor: false,
    groundFc: 8000,
    water: true,
    def: { w: 200, d: 130, h: 3, refl: 0.85, t60: 1.4, wet: 0.05 },
  },
  {
    id: 'forest',
    name: '林',
    indoor: false,
    groundFc: 1200,
    trees: true,
    def: { w: 60, d: 40, h: 3, refl: 0.4, t60: 1.0, wet: 0.1 },
  },
  {
    id: 'alley',
    name: '路地',
    indoor: false,
    groundFc: 6000,
    walls: 'sides',
    def: { w: 40, d: 6, h: 3, refl: 0.85, t60: 1.1, wet: 0.06 },
  },
  {
    id: 'room',
    name: '部屋',
    indoor: true,
    groundFc: 4000,
    walls: 'box',
    def: { w: 7, d: 6, h: 2.6, refl: 0.75, t60: 0.5, wet: 0.2 },
  },
  {
    id: 'hall',
    name: 'ホール',
    indoor: true,
    groundFc: 4000,
    walls: 'box',
    def: { w: 30, d: 22, h: 12, refl: 0.85, t60: 2, wet: 0.3 },
  },
];
export const kindOf = (id: string): Kind => KINDS.find((k) => k.id === id) ?? KINDS[0];

export interface Place {
  id: PlaceId;
  name: string;
  planes: readonly Plane[];
  /** 2 回反射を足す面の組（向かい合う壁） */
  pairs?: readonly (readonly [number, number])[];
  late: Late | null;
  /** 音源と聞き手を置ける範囲 [x0, x1, y0, y1]（壁の内側） */
  box: readonly [number, number, number, number];
  /** 図の範囲 [x0, x1, y0, y1] */
  view: readonly [number, number, number, number];
  walls?: 'box' | 'sides';
  trees?: boolean;
  water?: boolean;
  w: number;
  d: number;
  /** 床（地面）の高さ [m]（耳の高さを 0 とする） */
  floor: number;
}
/** 屋外の耳から地面までの高さ [m] */
export const EAR_H = 1.6;
/** 屋内の耳から床までの高さ [m]（座った高さ） */
export const EAR_IN = 1.2;
/** 聞き手から音源までの最も近い距離 [m] */
export const MIN_R = 1;

/** 種類と空間の値から、反射する面・残響・範囲を決める */
export function buildPlace(kind: Kind, s: Space): Place {
  const w = s.w,
    d = s.d,
    hw = w / 2,
    hd = d / 2,
    planes: Plane[] = [];
  let pairs: [number, number][] | undefined;
  if (!kind.free) {
    if (kind.indoor) {
      planes.push(
        { ax: 2, v: -EAR_IN, r: s.refl * 0.85, fc: kind.groundFc },
        { ax: 2, v: s.h - EAR_IN, r: s.refl, fc: 6000 },
        { ax: 0, v: -hw, r: s.refl, fc: 6000 },
        { ax: 0, v: hw, r: s.refl, fc: 6000 },
        { ax: 1, v: -hd, r: s.refl, fc: 6000 },
        { ax: 1, v: hd, r: s.refl, fc: 6000 },
      );
    } else {
      planes.push({ ax: 2, v: -EAR_H, r: s.refl, fc: kind.groundFc });
      if (kind.walls === 'sides') {
        /* 路地は左右に通り、前後に建物が並ぶ */
        planes.push({ ax: 1, v: -hd, r: s.refl, fc: 6000 }, { ax: 1, v: hd, r: s.refl, fc: 6000 });
        pairs = [[1, 2]];
      }
    }
  }
  /* 残響の遅延線の長さは空間の大きさ（体積の 3 乗根）に合わせる。初めの遅れは壁までの平均の行き帰り */
  const vol = w * d * (kind.indoor ? s.h : 8),
    late: Late | null =
      kind.free || s.wet <= 0 || s.t60 <= 0
        ? null
        : {
            t60: s.t60,
            wet: s.wet,
            pre: clamp(Math.sqrt(w * d) / CS / 2, 0.004, 0.08),
            fc: kind.indoor ? 5000 : 2500,
            size: clamp(Math.cbrt(vol) / 7, 0.4, 3),
          };
  const m = 0.3,
    box: [number, number, number, number] = [-hw + m, hw - m, -hd + m, hd - m],
    /* 路地は建物の側も見せる */
    ey = kind.walls === 'sides' ? Math.max(hd * 1.8, hw * 0.3) : hd * 1.02,
    view: [number, number, number, number] = [-hw * 1.04, hw * 1.04, -ey, ey];
  return {
    id: kind.id,
    name: kind.name,
    planes,
    pairs,
    late,
    box,
    view,
    walls: kind.walls,
    trees: kind.trees,
    water: kind.water,
    w,
    d,
    floor: kind.indoor ? -EAR_IN : -EAR_H,
  };
}

/** 林の木（図だけ）。位置は場所の幅・奥行きの半分に対する割合、半径 [m] */
export const TREES: readonly (readonly [number, number, number])[] = [
  [-0.43, 0.6, 0.9],
  [0.4, 0.72, 1.1],
  [-0.77, -0.15, 1],
  [0.73, -0.3, 0.8],
  [-0.32, -0.78, 0.9],
  [0.28, -0.82, 1],
  [0.05, 0.92, 0.8],
  [-0.9, 0.65, 0.7],
  [0.92, 0.48, 0.9],
  [-0.1, -0.97, 0.7],
  [0.87, -0.85, 0.8],
  [-0.93, -0.75, 0.8],
  [0.62, 0.12, 0.7],
  [-0.6, 0.25, 0.8],
  [0.15, 0.45, 0.6],
  [-0.2, 0.3, 0.5],
];

/** 鏡像の音源: 位置（世界の座標）・反射率の積・高い音を落とす周波数（0 は直接音）・反射した面 */
export interface Image {
  p: Vec3;
  g: number;
  fc: number;
  planes: number[];
}
/** 直接音と、1 回反射（pairs の面の組は 2 回反射も）の鏡像の音源 */
export function images(p: Vec3, place: Place): Image[] {
  const out: Image[] = [{ p, g: 1, fc: 0, planes: [] }];
  const mirror = (q: Vec3, pl: Plane): Vec3 => {
    const r: [number, number, number] = [q[0], q[1], q[2]];
    r[pl.ax] = 2 * pl.v - q[pl.ax];
    return r;
  };
  place.planes.forEach((pl, k) => {
    out.push({ p: mirror(p, pl), g: pl.r, fc: pl.fc, planes: [k] });
  });
  for (const [a, b] of place.pairs ?? [])
    for (const [i, j] of [
      [a, b],
      [b, a],
    ]) {
      const A = place.planes[i],
        B = place.planes[j];
      out.push({ p: mirror(mirror(p, A), B), g: A.r * B.r, fc: Math.min(A.fc, B.fc), planes: [i, j] });
    }
  return out;
}

/** 直接音から最初の反射までの遅れ [s]（反射がなければ null） */
export function firstReflection(src: Vec3, lis: Vec3, place: Place): number | null {
  const rel = (q: Vec3): number => Math.hypot(q[0] - lis[0], q[1] - lis[1], q[2] - lis[2]);
  const ims = images(src, place),
    r0 = rel(src);
  let best = Number.POSITIVE_INFINITY;
  for (let k = 1; k < ims.length; k++) best = Math.min(best, rel(ims[k].p) - r0);
  return Number.isFinite(best) ? best / CS : null;
}

/* ---------- 障害物 ---------- */

/** 障害物: 床に置いた箱。中心の位置 [m]、幅（x）・奥行き（y）・高さ [m]、名前 */
export interface Obstacle {
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
}
/** 追加するときの形（大きさはこのツールで選んだ概数） */
export const OBS_PRESETS: readonly Omit<Obstacle, 'x' | 'y'>[] = [
  { name: '本棚', w: 1.8, d: 0.4, h: 2 },
  { name: 'ソファ', w: 2, d: 0.9, h: 0.8 },
  { name: 'テーブル', w: 1.4, d: 0.8, h: 0.7 },
  { name: '仕切り', w: 3, d: 0.15, h: 2.4 },
  { name: '冷蔵庫', w: 0.7, d: 0.7, h: 1.8 },
  { name: '車', w: 4.5, d: 1.8, h: 1.5 },
];
/** 置ける障害物の数 */
export const MAX_OBS = 6;
/** 障害物の面の反射率と、高い音を落とす周波数 [Hz] */
const OBS_R = 0.6,
  OBS_FC = 4000;
/** 回り込んだ音の、高い音の残り（−20 dB） */
export const OCC_FLOOR = 0.1;

/** 箱の範囲 [x0, x1, y0, y1, z0, z1]（z は耳の高さを 0 とする） */
const boxOf = (o: Obstacle, floor: number): [number, number, number, number, number, number] => [
  o.x - o.w / 2,
  o.x + o.w / 2,
  o.y - o.d / 2,
  o.y + o.d / 2,
  floor,
  floor + o.h,
];

/** 線分 P→Q が箱を通るか（スラブ法） */
function hits(P: Vec3, Q: Vec3, b: readonly number[]): boolean {
  let t0 = 0,
    t1 = 1;
  for (let a = 0; a < 3; a++) {
    const d = Q[a] - P[a],
      lo = b[2 * a],
      hi = b[2 * a + 1];
    if (Math.abs(d) < 1e-9) {
      if (P[a] <= lo || P[a] >= hi) return false;
    } else {
      let ta = (lo - P[a]) / d,
        tb = (hi - P[a]) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 >= t1) return false;
    }
  }
  return true;
}

/**
 * 線分 P→Q を遮る箱を回り込む道のりの差 δ [m]: 上を越える道と、横の角を回る道の短い方。
 * 上を越える道は、線分が箱に入る所の真上（箱の上面の高さ）を通るとする
 */
function detour(P: Vec3, Q: Vec3, b: readonly number[]): number {
  const L = Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]),
    d2 = (A: readonly number[], B: readonly number[]) => Math.hypot(A[0] - B[0], A[1] - B[1]);
  /* 横: 4 つの角のどれかを通る（高さは無視） */
  let side = Number.POSITIVE_INFINITY;
  for (const cx of [b[0], b[1]])
    for (const cy of [b[2], b[3]]) side = Math.min(side, d2(P, [cx, cy]) + d2([cx, cy], Q));
  side -= Math.hypot(Q[0] - P[0], Q[1] - P[1]);
  /* 上: 箱の中心に最も近い線分の点の上を通る */
  const cx = (b[0] + b[1]) / 2,
    cy = (b[2] + b[3]) / 2,
    dx = Q[0] - P[0],
    dy = Q[1] - P[1],
    t = clamp(((cx - P[0]) * dx + (cy - P[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1),
    T: Vec3 = [P[0] + dx * t, P[1] + dy * t, b[5]],
    top = Math.hypot(T[0] - P[0], T[1] - P[1], T[2] - P[2]) + Math.hypot(Q[0] - T[0], Q[1] - T[1], Q[2] - T[2]) - L;
  return Math.max(0.005, Math.min(side, top));
}

/** 遮られた音: 全体の倍率と、高い音を落とす周波数 [Hz]（遮られていなければ g = 1・fc = 0） */
export interface Occ {
  g: number;
  fc: number;
}
/**
 * 線分の並び（道すじ）を遮る障害物の効き目。Maekawa の近似で、回り込む道のりの差 δ のとき
 * フレネル数 N = 2δf/c が 1 になる周波数 f = c/(2δ) より上を弱め、全体も約 4.8 dB（10 log 3）下げる。
 * skip の障害物（反射した面の持ち主）は数えない
 */
export function occlusion(
  segs: readonly (readonly [Vec3, Vec3])[],
  obs: readonly Obstacle[],
  floor: number,
  skip = -1,
): Occ {
  let g = 1,
    fc = 0;
  obs.forEach((o, i) => {
    if (i === skip) return;
    const b = boxOf(o, floor);
    for (const [P, Q] of segs)
      if (hits(P, Q, b)) {
        const f = CS / (2 * detour(P, Q, b));
        g *= 0.575;
        fc = fc ? Math.min(fc, f) : f;
        return;
      }
  });
  return { g, fc: fc ? clamp(fc, 80, 16000) : 0 };
}

/** 音の道: 鍵（道ごとの状態を引き継ぐ名前）・鏡像の位置・反射率の積・反射面の高い音の減衰 [Hz]・遮られ方 */
export interface Path {
  key: string;
  p: Vec3;
  g: number;
  fc: number;
  occ: Occ;
  /** 反射した点（図に描く。直接音と床・天井では空） */
  hit?: Vec3;
}
/** 鏡像 q を通る道で、面（軸 ax・位置 v）に当たる点 */
function hitPoint(lis: Vec3, q: Vec3, ax: number, v: number): Vec3 | null {
  const t = (v - lis[ax]) / (q[ax] - lis[ax]);
  if (!(t > 0 && t < 1)) return null;
  return [lis[0] + (q[0] - lis[0]) * t, lis[1] + (q[1] - lis[1]) * t, lis[2] + (q[2] - lis[2]) * t];
}

/**
 * 音源 src から聞き手 lis（どちらも世界の座標）への道をすべて求める: 直接音、場所の面での 1 回反射（と 2 回反射）、
 * 障害物の側面での 1 回反射。どの道も、通る線分を遮る障害物の効き目を付ける
 */
export function paths(src: Vec3, lis: Vec3, place: Place, obs: readonly Obstacle[] = []): Path[] {
  const out: Path[] = [{ key: 'd', p: src, g: 1, fc: 0, occ: occlusion([[src, lis]], obs, place.floor) }];
  images(src, place).forEach((im, k) => {
    if (k === 0) return;
    let segs: [Vec3, Vec3][] = [[im.p, lis]],
      hit: Vec3 | undefined;
    if (im.planes.length === 1) {
      const pl = place.planes[im.planes[0]],
        h = hitPoint(lis, im.p, pl.ax, pl.v);
      if (h) {
        segs = [
          [src, h],
          [h, lis],
        ];
        if (pl.ax !== 2) hit = h;
      }
    }
    out.push({
      key: `p${im.planes.join('-')}`,
      p: im.p,
      g: im.g,
      fc: im.fc,
      occ: occlusion(segs, obs, place.floor),
      hit,
    });
  });
  /* 障害物の側面: 音源と聞き手が同じ外側にあり、当たる点が面の中（耳の高さより上まである箱だけ） */
  obs.forEach((o, i) => {
    const b = boxOf(o, place.floor);
    if (b[5] <= 0) return;
    const faces: [number, number, number][] = [
      [0, b[0], -1],
      [0, b[1], 1],
      [1, b[2], -1],
      [1, b[3], 1],
    ];
    faces.forEach(([ax, v, s], f) => {
      if ((src[ax] - v) * s <= 0 || (lis[ax] - v) * s <= 0) return;
      const q: [number, number, number] = [src[0], src[1], src[2]];
      q[ax] = 2 * v - src[ax];
      const h = hitPoint(lis, q, ax, v);
      if (!h) return;
      const o2 = 1 - ax,
        lo = b[2 * o2],
        hi = b[2 * o2 + 1];
      if (h[o2] < lo || h[o2] > hi || h[2] < b[4] || h[2] > b[5]) return;
      out.push({
        key: `o${i}-${f}`,
        p: q,
        g: OBS_R,
        fc: OBS_FC,
        occ: occlusion(
          [
            [src, h],
            [h, lis],
          ],
          obs,
          place.floor,
          i,
        ),
        hit: h,
      });
    });
  });
  return out;
}

/** 聞き手: 位置 [m] と向き（時計回り [rad]、0 が前 = 画面の上） */
export interface Listener {
  x: number;
  y: number;
  yaw: number;
}
/** 世界の座標を聞き手の頭の座標へ（x 右・y 前・z 上） */
export function toHead(p: Vec3, l: Listener): Vec3 {
  const dx = p[0] - l.x,
    dy = p[1] - l.y,
    s = Math.sin(l.yaw),
    c = Math.cos(l.yaw);
  return [dx * c - dy * s, dx * s + dy * c, p[2]];
}

/* ---------- 音源と場面 ---------- */

export type SoundKind = 'nature' | 'voice';
export interface Sound {
  id: string;
  name: string;
  kind: SoundKind;
  /** 図に出す短い名前 */
  short: string;
  /** 1 m 先の大きさ [dB]（録音の大きさをそろえたうえでの相対の値。このツールで決めた概数） */
  db: number;
}
/** 音源の録音（public/spatial-audio/<id>.mp3。出どころは src/tools/spatial-audio/SOURCES.md） */
export const SOUNDS: readonly Sound[] = [
  { id: 'brook', name: '小川', short: '小川', kind: 'nature', db: 4 },
  { id: 'rain', name: '小雨', short: '小雨', kind: 'nature', db: 0 },
  { id: 'waves', name: '波打ち際', short: '波', kind: 'nature', db: 10 },
  { id: 'leaves', name: '木の葉', short: '木の葉', kind: 'nature', db: 0 },
  { id: 'fire', name: 'たき火', short: 'たき火', kind: 'nature', db: 0 },
  { id: 'bees', name: 'ミツバチ', short: 'ミツバチ', kind: 'nature', db: -6 },
  { id: 'blackbird', name: 'クロウタドリ', short: 'クロウタドリ', kind: 'nature', db: 10 },
  { id: 'uguisu', name: 'ウグイス', short: 'ウグイス', kind: 'nature', db: 12 },
  { id: 'frogs', name: 'カエル', short: 'カエル', kind: 'nature', db: 14 },
  { id: 'crickets', name: 'コオロギ', short: 'コオロギ', kind: 'nature', db: -4 },
  { id: 'chime', name: 'ウィンドチャイム', short: 'チャイム', kind: 'nature', db: 0 },
  { id: 'bell', name: '寺の鐘', short: '鐘', kind: 'nature', db: 18 },
  { id: 'voice-ja-f', name: '朗読（女性）', short: '朗読（女性）', kind: 'voice', db: 0 },
  { id: 'voice-ja-m', name: '朗読（男性）', short: '朗読（男性）', kind: 'voice', db: 0 },
  { id: 'voice-en-m', name: '朗読（英語）', short: '朗読（英語）', kind: 'voice', db: 0 },
];
export const soundOf = (id: string): Sound => SOUNDS.find((s) => s.id === id) ?? SOUNDS[0];
/** 声の録音の後に入れる無音 [s] */
export const VOICE_GAP = 1.5;
/** 置ける音源の数 */
export const MAX_SOURCES = 6;

/** 置いた音源: 音・位置 [m]・音源ごとの音量 [dB]（音の大きさ db に足す） */
export interface Placed {
  sound: string;
  x: number;
  y: number;
  db?: number;
}
export interface Scene {
  id: string;
  name: string;
  place: PlaceId;
  /** 種類の既定から変える空間の値 */
  space?: Partial<Space>;
  srcs: readonly Placed[];
  lis: Listener;
  obs?: readonly Obstacle[];
}
export const SCENES: readonly Scene[] = [
  {
    id: 'brook',
    name: '林の小川',
    place: 'forest',
    srcs: [
      { sound: 'brook', x: -27.26, y: 19.7 },
      { sound: 'blackbird', x: 13.9, y: 12.07 },
      { sound: 'uguisu', x: -23.13, y: -16.44, db: -10 },
      { sound: 'bees', x: 7.71, y: -11.15 },
    ],
    lis: { x: 0, y: 0, yaw: 0 },
  },
  {
    id: 'paddy',
    name: '田んぼのカエル',
    place: 'paddy',
    srcs: [
      { sound: 'frogs', x: -74.11, y: 48.89 },
      { sound: 'frogs', x: 71.13, y: 47.69 },
      { sound: 'frogs', x: 50.51, y: -52.42, db: -3 },
      { sound: 'frogs', x: -83.08, y: -59.29, db: -6 },
      { sound: 'crickets', x: 9.86, y: -9.68, db: -8 },
    ],
    lis: { x: 0, y: 0, yaw: 0 },
  },
  {
    id: 'fire',
    name: '焚き火を囲む',
    place: 'field',
    space: { w: 40, d: 30 },
    srcs: [
      { sound: 'fire', x: -1.55, y: 4.28, db: -10 },
      { sound: 'voice-ja-m', x: 2.33, y: 3.44 },
      { sound: 'crickets', x: -11.71, y: -7.73 },
      { sound: 'frogs', x: 16.08, y: -13.95, db: -8 },
    ],
    lis: { x: 0, y: -0.2, yaw: 0 },
  },
  {
    id: 'beach',
    name: '浜辺',
    place: 'field',
    space: { w: 80, d: 50, refl: 0.6 },
    srcs: [
      { sound: 'waves', x: -11.83, y: 15.73 },
      { sound: 'waves', x: 16.86, y: 22.07, db: -4 },
      { sound: 'leaves', x: -4.9, y: -14.15 },
      { sound: 'chime', x: 18.17, y: -2.32, db: -10 },
      { sound: 'waves', x: -29.29, y: -1.84 },
    ],
    lis: { x: 0, y: 0, yaw: 0 },
  },
  {
    id: 'alley',
    name: '雨の路地',
    place: 'alley',
    srcs: [
      { sound: 'rain', x: 18.41, y: 1.83 },
      { sound: 'rain', x: -19.7, y: -2.24, db: -2 },
      { sound: 'voice-ja-f', x: 7.59, y: -1.34 },
      { sound: 'frogs', x: -9.8, y: 2.01, db: -12 },
    ],
    lis: { x: 0.12, y: 0.06, yaw: Math.PI / 2 },
  },
  {
    id: 'living',
    name: '家具のある居間',
    place: 'room',
    srcs: [{ sound: 'voice-ja-f', x: -2.46, y: 2.02 }],
    lis: { x: 2.08, y: -1.69, yaw: 0 },
    obs: [
      { name: '本棚', x: -2.48, y: 2.7, w: 1.8, d: 0.4, h: 2 },
      { name: 'ソファ', x: 2.09, y: -2.3, w: 2, d: 0.9, h: 0.8 },
      { name: 'テーブル', x: 2.01, y: -0.22, w: 1.4, d: 0.8, h: 0.7 },
      { name: '冷蔵庫', x: -2.71, y: -2.27, w: 0.7, d: 0.7, h: 1.8 },
      { name: '仕切り', x: -0.97, y: 0.89, w: 0.1, d: 4, h: 2.6 },
      { name: '本棚', x: 2.18, y: 2.62, w: 1.8, d: 0.4, h: 2 },
    ],
  },
  {
    id: 'hall',
    name: 'ホールの鐘',
    place: 'hall',
    srcs: [
      { sound: 'bell', x: 0, y: 9.84, db: -15 },
      { sound: 'voice-en-m', x: -3.99, y: 5.5 },
    ],
    lis: { x: 11.61, y: -8.74, yaw: 0 },
    obs: [
      { name: 'テーブル', x: -3.99, y: 4.25, w: 1.4, d: 0.8, h: 0.7 },
      { name: '仕切り', x: -3.94, y: 1.16, w: 3, d: 0.15, h: 2.4 },
      { name: '仕切り', x: 4.08, y: 1.2, w: 3, d: 0.15, h: 2.4 },
      { name: '仕切り', x: -3.86, y: -4, w: 3, d: 0.15, h: 2.4 },
      { name: '仕切り', x: 4.17, y: -4.09, w: 3, d: 0.15, h: 2.4 },
    ],
  },
];
export const sceneOf = (id: string): Scene | undefined => SCENES.find((s) => s.id === id);
/** 場面の空間の値 */
export const sceneSpace = (sc: Pick<Scene, 'place' | 'space'>): Space => ({ ...kindOf(sc.place).def, ...sc.space });

/** 置ける範囲へ寄せる（聞き手から min [m] より近ければ押し出す） */
export function clampTo(
  place: Place,
  x: number,
  y: number,
  avoid?: { x: number; y: number },
  min = MIN_R,
): [number, number] {
  const [x0, x1, y0, y1] = place.box;
  let px = clamp(x, x0, x1),
    py = clamp(y, y0, y1);
  if (avoid) {
    const dx = px - avoid.x,
      dy = py - avoid.y,
      r = Math.hypot(dx, dy);
    if (r < min) {
      const k = r > 1e-6 ? min / r : 0;
      px = r > 1e-6 ? avoid.x + dx * k : avoid.x;
      py = r > 1e-6 ? avoid.y + dy * k : avoid.y + min;
      px = clamp(px, x0, x1);
      py = clamp(py, y0, y1);
    }
  }
  return [px, py];
}

/** 方位 [°]（頭の正面 0、右回りが正、−180〜180） */
export function azimuthDeg(p: Vec3): number {
  return (Math.atan2(p[0], p[1]) * 180) / Math.PI;
}

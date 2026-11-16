/**
 * 脱進機の形と、歯と爪の接触の計算。長さは mm、角は rad。がんぎ車の中心が原点、アンクルの支点は真上 (0, D)。
 * がんぎ車は正面から見て時計回りに回る。adv はがんぎ車の進んだ角（時計回りが正）、アンクルの角 th は反時計回りが正。
 * 振り子とアンクルは一体で振れる。
 * 左の爪（入爪）は外から支点へ向かってくる歯を、右の爪（出爪）は支点から離れていく歯を受ける。
 * アンクルが反時計回りに傾くと左の爪が歯の間へ深く入り右の爪が抜け、時計回りではその逆になる
 */
export const TAU = Math.PI * 2,
  DEG = Math.PI / 180;
/** がんぎ車の歯先の半径・歯数・歯の間の角・歯の高さ */
export const R = 12,
  NT = 30,
  PITCH = TAU / NT,
  TOOTH_H = 2.6;
/** アンクルの支点の高さ（7.5 歯をまたぎ、爪の位置で歯先の円に接する。支点から接点まで R） */
export const D = R / Math.cos(45 * DEG);

export type EscType = 'recoil' | 'graham' | 'brocot';
type Pt = [number, number];
interface TypeSpec {
  name: string;
  /** 爪の幅（がんぎ車の角、度） */
  w?: number;
  /** ブロコ式のピンの半径 [mm] */
  rp?: number;
  /**
   * 振れ角（度）。u は爪が歯を放し始める角（グラハム式はロックの終わり、ブロコ式はピンの頂点）、x は歯が爪から落ちる角。
   * L は左（入爪）、R は右（出爪）
   */
  uL?: number;
  xL: number;
  uR?: number;
  xR: number;
  /** ブロコ式: ピンの中心を、7.5 歯の接点（支点から R、真下から 45°）から支点の周りに外へ回す角（度） */
  dl?: number;
  /** ブロコ式: 歯 0 の位相のずれ（度） */
  ph?: number;
}
/** 型ごとの数値（Abbey の作図に合わせ、7.5 歯をまたぎ、ロックとドロップは 1°） */
export const TYPES: Record<EscType, TypeSpec> = {
  /* リコイル式の xL・xR は爪の先が歯先の円を出る振れ角（形から決まる。目安） */
  recoil: { name: 'リコイル式', xL: -1.66, xR: 1.66 },
  graham: { name: 'グラハム式', w: 5, uL: 0.75, xL: -1.25, uR: -0.75, xR: 1.25 },
  brocot: { name: 'ブロコ式', rp: 1.05, dl: 4.6, ph: 4, xL: -1.3, xR: 1.3 },
};
/** 先端から、内向きの半径と角 a（度、前へ倒すと正）をなす直線の面が、歯の根元の円に届く角（度、前が負） */
const flank = (a: number): number => {
  const c = Math.cos(a * DEG),
    rr = R - TOOTH_H,
    t = R * c - Math.sqrt(R * R * c * c - (R * R - rr * rr));
  return -Math.atan2(t * Math.sin(a * DEG), R - t * c) / DEG;
};
/**
 * ブロコ式の歯（Ken Kuo の 3D 図の正面に近いこまを測った形）。前の面は半径の向き、歯先は幅 0.85° の平ら。
 * 背は歯先から細いまま少し降りてから深くえぐれ、6.3° 後ろの角から歯底へ半径の向きに降りる。
 * 歯の高さに対する比 u と、先端から後ろへの角（度）で表す
 */
const BROCOT_BACK: Pt[] = [
  [0.1, 1.0],
  [0.2, 1.25],
  [0.3, 1.6],
  [0.4, 2.15],
  [0.5, 2.95],
  [0.6, 4.05],
  [0.66, 4.95],
  [0.72, 5.85],
  [0.755, 6.3],
];
const brocotTooth = (): Pt[] => [
  [R - TOOTH_H, 0],
  [R, 0],
  [R - 0.03, 0.85],
  ...BROCOT_BACK.map(([u, d]): Pt => [R - TOOTH_H * u, d]),
  [R - TOOTH_H, 6.3],
];
/**
 * 歯の形: [半径, 先端から後ろへの角（度）] を前の面の根元 → 先端 → 背 → 背の根元の順に。
 * リコイル式は Wikimedia の動画に合わせた後ろへ倒れたとげ: 前の面は半径から 26.3°、背は 5.5° 倒れ、根元はどちらも先端より前。
 * グラハム式とブロコ式は前へ傾ける。ブロコ式は背を深くえぐった細い歯
 */
export const TEETH: Record<EscType, Pt[]> = {
  recoil: [
    [R - TOOTH_H, flank(26.3)],
    [R, 0],
    [R - TOOTH_H, flank(5.5)],
  ],
  graham: [
    [R - TOOTH_H, 3.2],
    [R, 0],
    [R - 0.25, 0.9],
    [R - TOOTH_H, 7.5],
  ],
  brocot: brocotTooth(),
};

const rot = (x: number, y: number, a: number): Pt => [
  x * Math.cos(a) - y * Math.sin(a),
  x * Math.sin(a) + y * Math.cos(a),
];
const polar = (p: Pt): Pt => [Math.hypot(p[0], p[1]), Math.atan2(p[1], p[0])];
function arcPts(r: number, a0: number, a1: number, n = 12): Pt[] {
  const o: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    o.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return o;
}
/** 世界の点をアンクルの座標（支点が原点、th = 0 の向き）へ */
const toAnchor = (x: number, y: number, th: number): Pt => rot(x, y - D, -th);

export interface Poly {
  pts: Pt[];
  box: [number, number, number, number];
  /** 符号つきの面積（反時計回りが正） */
  area: number;
}
export interface Pin {
  c: Pt;
  rp: number;
}
export interface Esc {
  type: EscType;
  T: TypeSpec;
  /** 歯 0 の先端の角（adv = 0）。爪の幅の帯が接点 135° を挟むようにする */
  phi0: number;
  /** 接触を解く左・右の爪（アンクルの座標） */
  pal: [Poly, Poly];
  /** 見せる爪の形（グラハム式は円弧の板をアンクルの腕までのばす） */
  show: [Pt[], Pt[]];
  /** アンクル全体の外形（リコイル式の一枚板）。ないときは腕と爪を別に描く */
  body?: Pt[];
  /** ブロコ式のピン */
  pin?: [Pin, Pin];
}
function prep(pts: Pt[]): Poly {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    a = 0;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return { pts, box: [x0, y0, x1, y1], area: a / 2 };
}
/** 面の点列から、支点からの半径 r0 の円弧で閉じた多角形を作る（グラハム式の円弧の板） */
function band(face: Pt[], r0: number): Pt[] {
  const a0 = polar(face[0])[1],
    a1 = polar(face[face.length - 1])[1];
  return [...face, ...arcPts(r0, a1, a0, 10)];
}
/**
 * リコイル式のアンクル（Wikimedia Commons の Anchor_escapement_animation を画素で測った形。支点が原点、mm）。
 * 外形は支点の上の頂点から左右へ 41° で下がる「へ」の字の板。内側の縁は 31.5° で、支点の下の小さなボスで左右がつながる。
 * 入爪は左の端の下面（下へふくらむ半径 7.12 の円弧）で、先端から斜めに切り上がる背を持つ。
 * 出爪は右の端を下へ折った、ほぼ縦の面（下へ向かって 3.5° 外へ開く）。
 * 点は動画の振り子が真下のときの形。使うときは beat だけ反時計回りに回し、左右の爪が歯を放す振れ角をそろえる（片振りを直す）
 */
const RC = {
  /** 歯 0 の先端の角（度、adv = 0） */
  phi0: 132,
  /** 片振りを直す回転（度） */
  beat: 0.41,
  apex: [0.007, 3.037] as Pt,
  /** 入爪: 左の端の尖り・下面の円弧の中心と半径・爪の先・背の上端（内側の縁との角） */
  lTip: [-12.502, -7.925] as Pt,
  uC: [-9.853, -1.317] as Pt,
  uR: 7.119,
  eTip: [-7.729, -8.112] as Pt,
  notch: [-9.198, -6.58] as Pt,
  /** 支点の下のボス（半径）と、内側の縁がボスに当たる点 */
  bossR: 2.1,
  bossL: [-1.228, -1.704] as Pt,
  bossRt: [1.208, -1.718] as Pt,
  /** 出爪: 面の上端（内側の縁との角）・爪の先・背の上端（外側の縁との角） */
  xIn: [8.441, -6.17] as Pt,
  xTip: [8.634, -9.311] as Pt,
  xOut: [11.161, -6.971] as Pt,
};
const lerp = (a: Pt, b: Pt, u: number): Pt => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
/** 円弧（中心 c・半径 r）の a から b まで（短い向き）、n 等分 */
function arcAB(c: Pt, r: number, a: Pt, b: Pt, n: number): Pt[] {
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  if (a1 - a0 > Math.PI) a1 -= TAU;
  if (a0 - a1 > Math.PI) a1 += TAU;
  return arcPts(r, a0, a1, n).map(([x, y]): Pt => [c[0] + x, c[1] + y]);
}

/**
 * ブロコ式のアンクルの外形（アンクルの座標、支点が原点）。寸法は Kuo の図（歯先の直径 120 mm）を R へ縮めたもの:
 * 支点のボスの半径 7.9 mm、軸の幅 10.4 mm、ピンを囲むボスの半径 8.3 mm、腕の幅 8〜9 mm。
 * Kuo の図の腕はがんぎ車の後ろを通るが、この図はアンクルを車の手前に描くので、腕は歯先の外をまたぐ弓にし、
 * 振れ角 ±4° まで振っても歯先の円（＋0.1）に入らない所でボスと腕の内側を切る
 */
function brocotBody(cR: Pt, rp: number): Pt[] {
  const RB0 = 1.58,
    HS = 1.04,
    RBS = rp * (8.3 / 5.25),
    RI = 12.35,
    TH = 4 * DEG,
    M = 0.1,
    /* がんぎ車の中心から見た半径 rho・角 phi の点（振れ角 0）をアンクルの座標へ */
    at = (rho: number, phi: number): Pt => [rho * Math.cos(phi), rho * Math.sin(phi) - D],
    /* 振っても歯先の円の外に居る最小の半径 */
    clear = (phi: number): number => {
      let lo = R,
        hi = R + 3;
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2,
          [px, py] = at(mid, phi);
        let ok = true;
        for (let j = -6; j <= 6 && ok; j++) {
          const t = (TH * j) / 6;
          if (Math.hypot(px * Math.cos(t) - py * Math.sin(t), D + px * Math.sin(t) + py * Math.cos(t)) < R + M)
            ok = false;
        }
        if (ok) hi = mid;
        else lo = mid;
      }
      return hi;
    };
  /* 右のボス（がんぎ車の中心から見た半径と角） */
  const wc: Pt = [cR[0], cR[1] + D],
    rc = Math.hypot(wc[0], wc[1]),
    pc = Math.atan2(wc[1], wc[0]),
    half = Math.asin(Math.min(1, RBS / rc)),
    /* 角 phi でボスの円が占める半径の区間 */
    bossAt = (phi: number): [number, number] | null => {
      const d = phi - pc,
        s = rc * Math.sin(d),
        q = RBS * RBS - s * s;
      if (q < 0) return null;
      const m = rc * Math.cos(d);
      return [m - Math.sqrt(q), m + Math.sqrt(q)];
    },
    outerBand = (phi: number) => 13.9 + 0.5 * ((Math.PI / 2 - phi) / (Math.PI / 2 - pc)) ** 2;
  const outer: Pt[] = [],
    inner: Pt[] = [];
  const top = Math.atan2(Math.sqrt(13.9 ** 2 - HS * HS), HS);
  for (let i = 0; i <= 60; i++) {
    const phi = pc - half + ((top - (pc - half)) * i) / 60;
    let a = Infinity,
      z = -Infinity;
    if (phi >= pc) {
      a = RI;
      z = outerBand(phi);
    }
    const bo = bossAt(phi);
    if (bo) {
      a = Math.min(a, bo[0]);
      z = Math.max(z, bo[1]);
    }
    a = Math.max(a, clear(phi));
    if (z - a < 0.05) continue;
    outer.push(at(z, phi));
    inner.push(at(a, phi));
  }
  /* 真上（軸の下）の内側 */
  for (let i = 1; i <= 6; i++) {
    const phi = top + ((Math.PI / 2 - top) * i) / 6;
    inner.push(at(Math.max(RI, clear(phi)), phi));
  }
  /* 支点のボスと軸、軸と弓のつなぎを丸める（Kuo の図の丸み） */
  const F1 = 0.45,
    F2 = 0.6,
    c1: Pt = [HS + F1, -Math.sqrt((RB0 + F1) ** 2 - (HS + F1) ** 2)],
    a1 = Math.atan2(-c1[1], -c1[0]),
    rO = Math.hypot(outer[outer.length - 1][0], outer[outer.length - 1][1] + D),
    c2: Pt = [HS + F2, -D + Math.sqrt((rO + F2) ** 2 - (HS + F2) ** 2)],
    a2 = Math.atan2(-D - c2[1], -c2[0]),
    fil = (c: Pt, f: number, a0: number, a1_: number): Pt[] =>
      arcPts(f, a0, a1_, 8).map(([x, y]): Pt => [c[0] + x, c[1] + y]),
    boss = arcPts(RB0, Math.PI / 2, a1 - Math.PI, 16),
    out2 = outer.reverse().filter((q) => q[0] > c2[0] + F2 * Math.cos(a2) + 0.02),
    right: Pt[] = [
      ...boss,
      ...fil(c1, F1, a1, Math.PI).slice(1),
      ...fil(c2, F2, Math.PI, a2 + 2 * Math.PI).slice(1),
      ...out2,
      ...inner,
    ];
  /* 左は右を鏡に写して逆にたどる */
  const left = right
    .slice(1, -1)
    .reverse()
    .map(([x, y]): Pt => [-x, y]);
  return [...right, ...left];
}

const CACHE = new Map<EscType, Esc>();
/** 型の形を作る。爪の面は「アンクルが角 th のとき歯先が居るべき位置」をアンクルの座標へ写した点の列 */
export function makeEsc(type: EscType): Esc {
  const hit = CACHE.get(type);
  if (hit) return hit;
  const T = TYPES[type],
    wd = T.w ?? (T.rp ?? 0) / R / DEG,
    phi0 = (type === 'recoil' ? RC.phi0 : 135 + wd / 2 + (T.ph ?? 0)) * DEG;
  /** adv（度）での歯の先端。左は歯 0、右は 7 歯先 */
  const tip = (advDeg: number, k: number): Pt => {
    const a = phi0 + k * PITCH - advDeg * DEG;
    return [R * Math.cos(a), R * Math.sin(a)];
  };
  /** 振れ角 th0 から th1（度）まで、歯先が居るべき位置をアンクルの座標へ写す。点の列は落ちる先端から始める */
  const faceOf = (rel: (th: number) => number, k: number, th0: number, th1: number, n = 24): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const th = th0 + ((th1 - th0) * i) / n,
        [x, y] = tip(rel(th), k);
      pts.push(toAnchor(x, y, th * DEG));
    }
    return pts;
  };
  let pal: [Pt[], Pt[]], show: [Pt[], Pt[]], body: Pt[] | undefined, pin: [Pin, Pin] | undefined;
  if (type === 'graham') {
    /* 歯先はロックの円弧に落ち、振り子が真ん中あたりで斜めの面へ移り、先端から落ちる */
    const w = T.w ?? 5,
      uL = T.uL ?? 0,
      uR = T.uR ?? 0,
      lin = (a: number, b: number, v0: number, v1: number) => (th: number) => {
        const u = Math.min(1, Math.max(0, (th - a) / (b - a)));
        return v0 + (v1 - v0) * u;
      };
    const relL = lin(uL, T.xL, 0, w),
      relR = lin(uR, T.xR, 6, 6 + w);
    const fL = faceOf(relL, 0, T.xL, uL + 9),
      fR = faceOf(relR, -7, T.xR, uR - 9),
      rL = polar(fL[0])[0],
      rR = polar(fR[0])[0];
    /* 左は面の内側（支点寄り）、右は面の外側が爪 */
    pal = [band(fL, rL - 0.05), band(fR, rR + 0.05)];
    show = [band(faceOf(relL, 0, T.xL, uL + 22), rL - 0.05), band(faceOf(relR, -7, T.xR, uR - 22), rR + 0.05)];
  } else if (type === 'recoil') {
    /*
     * 爪は腕の端の鉤。入爪は下面の円弧に来る歯を受け、出爪は縦の面で離れていく歯を受ける。
     * 面の点列は落ちる先端から始め 25 点、最後に腕の中の点で閉じる
     */
    const under = arcAB(RC.uC, RC.uR, RC.eTip, RC.lTip, 24),
      xFace = Array.from({ length: 25 }, (_, i) => lerp(RC.xTip, RC.xIn, i / 24)),
      b = (pts: Pt[]): Pt[] => pts.map(([x, y]) => rot(x, y, RC.beat * DEG));
    pal = [b([...under, RC.notch]), b([...xFace, RC.xOut])];
    show = [pal[0], pal[1]];
    body = b([
      RC.apex,
      ...under.slice().reverse(),
      RC.notch,
      ...arcAB([0, 0], RC.bossR, RC.bossL, RC.bossRt, 16),
      ...xFace.slice().reverse(),
      RC.xOut,
    ]);
  } else {
    /*
     * ブロコ式: 半円のピン（Kuo の図の直径 10.5 mm → R の 0.0875）。中心は支点から R（7.5 歯の接点と同じ距離）で、
     * 真下から ±(45° + dl)。振り子が真ん中のとき、ピンの丸い面が歯先の円にほぼ接する（Kuo の図で 4.6°）。
     * 丸い側を来る歯へ（左は支点から外、右は支点の側）、平らな側を下流へ向ける
     */
    const rp = T.rp ?? 1.05,
      b = (45 + (T.dl ?? 4.6)) * DEG;
    const mk = (sx: number): { p: Pin; pts: Pt[] } => {
      const c: Pt = [sx * R * Math.sin(b), -R * Math.cos(b)],
        aa = Math.atan2(c[1], c[0]),
        out = sx < 0 ? aa : aa + Math.PI;
      return {
        p: { c, rp },
        pts: arcPts(rp, out - Math.PI / 2, out + Math.PI / 2, 32).map(([px, py]) => [c[0] + px, c[1] + py] as Pt),
      };
    };
    const l = mk(-1),
      r = mk(1);
    pal = [l.pts, r.pts];
    show = [l.pts, r.pts];
    pin = [l.p, r.p];
    body = brocotBody(r.p.c, rp);
  }
  const e: Esc = { type, T, phi0, pal: [prep(pal[0]), prep(pal[1])], show, body, pin };
  CACHE.set(type, e);
  return e;
}
/** 歯 k の外形（世界の座標、がんぎ車の中心が原点）。根元は歯の下の円で閉じる */
export function toothPts(type: EscType, phi0: number, k: number, adv: number): Pt[] {
  const a = phi0 + k * PITCH - adv;
  return TEETH[type].map(([r, d]): Pt => [r * Math.cos(a + d * DEG), r * Math.sin(a + d * DEG)]);
}

interface Hit {
  d: number;
  nx: number;
  ny: number;
}
/** 点が多角形の中にあれば、深さと外向きの法線 */
function inside(pts: Pt[], box: readonly number[], area: number, x: number, y: number): Hit | null {
  if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return null;
  const n = pts.length;
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  if (!c) return null;
  let best = Infinity,
    nx = 0,
    ny = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, ay] = pts[j],
      [bx, by] = pts[i],
      ex = bx - ax,
      ey = by - ay,
      L2 = ex * ex + ey * ey;
    if (L2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)),
      dd = Math.hypot(x - (ax + ex * t), y - (ay + ey * t));
    if (dd < best) {
      best = dd;
      const L = Math.sqrt(L2);
      nx = ey / L;
      ny = -ex / L;
    }
  }
  if (area < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { d: best, nx, ny };
}

/** 振り子: 単振り子の長さ L [m]・おもり m [kg]・Q・重力 g [m/s²] */
export const PEND = { L: 0.2482, m: 0.12, Q: 1500, g: 9.798 };
/** 振れすぎると竿が枠に当たる角 */
export const BANK = 8 * DEG;
/** がんぎ車の慣性 [kg·m²]・接触のばね [N/m]・減衰 [N·s/m]・摩擦係数 */
export const ESCJ = 5e-8,
  KC = 1.2e4,
  CC = 1.2,
  MU = 0.15;
/** 計算の刻み [s] */
export const ESC_DT = 8e-5;
/** 手でつかんだときのばね [1/s²] と減衰 [1/s] */
const GRAB_W = 2 * Math.PI * 8,
  GRAB_K = GRAB_W * GRAB_W,
  GRAB_C = 2 * 0.7 * GRAB_W;

export type EscEvent =
  | { k: 'tick'; t: number; side: 0 | 1; v: number }
  | { k: 'free'; t: number; side: 0 | 1; F: number; vt: number }
  | { k: 'bank'; t: number; v: number }
  /**
   * 音のための当たり（力学には使わない）。当たりの始まりから最大 HIT_WIN だけ力を積んだ力積 J [N·s]、
   * その長さ d [s]（t は d の終わり。始まりは t − d）、近づく速さ v [mm/s]、最も強く押した点 (x, y) [mm] と法線 (nx, ny)
   */
  | { k: 'hit'; t: number; side: 0 | 1; J: number; d: number; v: number; x: number; y: number; nx: number; ny: number };
/** 音のための当たりの力積を積む長さ [s] */
export const HIT_WIN = 0.002;

/** 振り子・アンクル・がんぎ車の計算 */
export class EscSim {
  readonly e: Esc;
  L: number;
  /** 振れ角 [rad]・角速度 */
  th: number;
  om = 0;
  /** がんぎ車の進んだ角 [rad]・その速さ（時計回りが正） */
  adv: number;
  w = 0;
  /** がんぎ車を回すトルク [N·m] */
  T: number;
  /** 台の加速度 [m/s²]（右が正） */
  ag = 0;
  /** 手でつかんでいるときの目標の振れ角 [rad]（つかんでいなければ null） */
  grab: number | null = null;
  t = 0;
  /** 左右の爪が歯から受けている力 [N] */
  Fn: [number, number] = [0, 0];
  readonly events: EscEvent[] = [];
  private touch = [false, false];
  private off = [-1, -1];
  private onAt = [0, 0];
  private bank = false;
  /* 力の足し込み（forces の中だけで使う） */
  private tw = 0;
  private ta = 0;
  private wp: Pt[][] = [];
  /* 音のための記録（力学には使わない）: 最後の push の滑る速さ、側ごとの最も強い点 [x, y, nx, ny, fn, vt]、当たりの力積 */
  private pvt = 0;
  readonly cp: [number, number, number, number, number, number][] = [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ];
  private hitJ = [0, 0];
  private hitV = [0, 0];
  private hitP: [number, number, number, number][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  private hitOpen = [false, false];
  private lastF = [0, 0];
  private lastVt = [0, 0];
  private wpOf(side: number, n: number): Pt[] {
    let w = this.wp[side];
    if (!w) {
      w = Array.from({ length: n }, (): Pt => [0, 0]);
      this.wp[side] = w;
    }
    return w;
  }
  constructor(type: EscType, opt: { L?: number; A?: number; adv?: number; T?: number } = {}) {
    this.e = makeEsc(type);
    this.L = opt.L ?? PEND.L;
    this.th = -(opt.A ?? 4) * DEG;
    this.adv = (opt.adv ?? -6) * DEG;
    this.T = opt.T ?? 1.3e-4;
  }
  /**
   * 世界の点 (x, y) で、法線 (nx, ny) に深さ d だけ食い込んだ接触の力を足す。onTooth は点が歯の上か（違えば爪の上）。
   * 戻り値は法線の力 [N] と近づく速さ [mm/s]
   */
  private push(x: number, y: number, d: number, nx: number, ny: number, onTooth: boolean): [number, number] {
    const { w, om } = this,
      /* 歯の点と爪の点の速さ [mm/s] */
      tvx = w * y,
      tvy = -w * x,
      avx = -om * (y - D),
      avy = om * x,
      s = onTooth ? 1 : -1,
      rvx = (tvx - avx) * s,
      rvy = (tvy - avy) * s,
      vn = rvx * nx + rvy * ny,
      vt = -rvx * ny + rvy * nx;
    let fn = KC * d * 1e-3 - CC * vn * 1e-3;
    if (fn < 0) fn = 0;
    this.pvt = vt;
    const ft = -MU * fn * Math.tanh(vt / 2),
      fx = (fn * nx - ft * ny) * s,
      fy = (fn * ny + ft * nx) * s;
    /* fx, fy は歯に掛かる力。爪にはその反対。トルク [N·m]: がんぎ車は時計回り、アンクルは反時計回りが正 */
    this.tw -= (x * fy - y * fx) * 1e-3;
    this.ta -= (x * fy - (y - D) * fx) * 1e-3;
    return [fn, -vn];
  }
  /** 最も強く押した点を覚える（音のため）。法線は歯を押す向き */
  private note(side: number, x: number, y: number, nx: number, ny: number, fn: number): void {
    const c = this.cp[side];
    if (fn <= c[4]) return;
    c[0] = x;
    c[1] = y;
    c[2] = nx;
    c[3] = ny;
    c[4] = fn;
    c[5] = this.pvt;
  }
  private forces(): { Fn: [number, number]; Vn: [number, number] } {
    const { th, adv } = this,
      e = this.e,
      Fn: [number, number] = [0, 0],
      Vn: [number, number] = [0, 0],
      c = Math.cos(th),
      sn = Math.sin(th),
      base = Math.round(adv / PITCH);
    this.tw = this.ta = 0;
    this.cp[0][4] = this.cp[1][4] = 0;
    for (let side = 0; side < 2; side++) {
      const poly = e.pal[side],
        /* 爪の点（世界の座標）と、それを囲む箱。配列は使い回す */
        wp = this.wpOf(side, poly.pts.length);
      let bx0 = Infinity,
        by0 = Infinity,
        bx1 = -Infinity,
        by1 = -Infinity;
      for (let i = 0; i < wp.length; i++) {
        const [px, py] = poly.pts[i],
          x = px * c - py * sn,
          y = D + px * sn + py * c;
        wp[i][0] = x;
        wp[i][1] = y;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
      for (let dk = -1; dk <= 1; dk++) {
        const k = (side === 0 ? 0 : -7) + base + dk,
          tp = toothPts(e.type, e.phi0, k, adv);
        /* 歯と爪の箱が重ならなければ調べない */
        let tx0 = Infinity,
          ty0 = Infinity,
          tx1 = -Infinity,
          ty1 = -Infinity;
        for (const [x, y] of tp) {
          tx0 = Math.min(tx0, x);
          ty0 = Math.min(ty0, y);
          tx1 = Math.max(tx1, x);
          ty1 = Math.max(ty1, y);
        }
        if (tx1 < bx0 - 0.1 || tx0 > bx1 + 0.1 || ty1 < by0 - 0.1 || ty0 > by1 + 0.1) continue;
        /* 歯の角が爪に食い込む */
        for (const [x, y] of tp) {
          const q = rot(x, y - D, -th),
            h = inside(poly.pts, poly.box, poly.area, q[0], q[1]);
          if (!h) continue;
          const [nx, ny] = rot(h.nx, h.ny, th),
            [fn, v] = this.push(x, y, h.d, nx, ny, true);
          this.note(side, x, y, nx, ny, fn);
          Fn[side] += fn;
          Vn[side] = Math.max(Vn[side], v);
        }
        /* 爪の角が歯に食い込む（歯の外形は根元の円で閉じた 4 点） */
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity,
          ar = 0;
        for (let i = 0, j = tp.length - 1; i < tp.length; j = i++) {
          x0 = Math.min(x0, tp[i][0]);
          y0 = Math.min(y0, tp[i][1]);
          x1 = Math.max(x1, tp[i][0]);
          y1 = Math.max(y1, tp[i][1]);
          ar += tp[j][0] * tp[i][1] - tp[i][0] * tp[j][1];
        }
        const box = [x0, y0, x1, y1];
        for (const [x, y] of wp) {
          const h = inside(tp, box, ar, x, y);
          if (!h) continue;
          /* 歯の外向きの法線で爪の点を押し出す */
          const [fn, v] = this.push(x, y, h.d, h.nx, h.ny, false);
          this.note(side, x, y, -h.nx, -h.ny, fn);
          Fn[side] += fn;
          Vn[side] = Math.max(Vn[side], v);
        }
      }
    }
    return { Fn, Vn };
  }
  step(dt: number): void {
    const { L } = this,
      { m, Q, g } = PEND,
      I = m * L * L,
      w0 = Math.sqrt(g / L),
      f = this.forces();
    /* 台の加速度は振り子に慣性力として掛かる */
    let al = -(g / L) * Math.sin(this.th) - (this.ag / L) * Math.cos(this.th) - (w0 / Q) * this.om + this.ta / I;
    /* 手でつかむ: 目標の角へ引く硬いばねと減衰（8 Hz・減衰比 0.7）。脱進機の当たりは計算のまま続く */
    if (this.grab !== null) al += -GRAB_K * (this.th - this.grab) - GRAB_C * this.om;
    const ex = Math.abs(this.th) - BANK;
    if (ex > 0) {
      const sg = Math.sign(this.th);
      al += -sg * ex * 4e4 - (sg * this.om > 0 ? 60 * this.om : 0);
      if (!this.bank) this.events.push({ k: 'bank', t: this.t, v: Math.abs(this.om) });
      this.bank = true;
    } else this.bank = false;
    this.om += al * dt;
    this.th += this.om * dt;
    this.w += ((this.T + this.tw) / ESCJ - 30 * this.w) * dt;
    this.adv += this.w * dt;
    this.t += dt;
    /*
     * 当たりの始まりを音にする。離れてから 4 ms 以内の当たり直し（爪の上の細かい跳ね）は数えない。
     * 20 ms 以上触れていた当たりが離れた所（爪が歯を放す）も出来事にする
     */
    for (let s = 0; s < 2; s++) {
      const on = f.Fn[s] > 1e-4,
        sd = s as 0 | 1;
      if (on && !this.touch[s]) {
        if (this.t - this.off[s] > 0.004) this.events.push({ k: 'tick', t: this.t, side: sd, v: f.Vn[s] });
        this.onAt[s] = this.t;
        /* 音のための当たり: 力積を積み始める */
        this.hitOpen[s] = true;
        this.hitJ[s] = 0;
        this.hitV[s] = f.Vn[s];
        this.hitP[s][3] = -1;
      }
      if (this.hitOpen[s]) {
        if (on) {
          this.hitJ[s] += f.Fn[s] * dt;
          const c = this.cp[s];
          if (c[4] > this.hitP[s][3]) this.hitP[s] = [c[0], c[1], Math.atan2(c[3], c[2]), c[4]];
        }
        const d = this.t - this.onAt[s];
        if (!on || d >= HIT_WIN - 1e-9) {
          this.hitOpen[s] = false;
          const [x, y, a] = this.hitP[s];
          this.events.push({
            k: 'hit',
            t: this.t,
            side: sd,
            J: this.hitJ[s],
            d,
            v: this.hitV[s],
            x,
            y,
            nx: Math.cos(a),
            ny: Math.sin(a),
          });
        }
      }
      if (!on && this.touch[s]) {
        this.off[s] = this.t;
        if (this.t - this.onAt[s] > 0.02)
          this.events.push({ k: 'free', t: this.t, side: sd, F: this.lastF[s], vt: Math.abs(this.lastVt[s]) });
      }
      if (on) {
        this.lastF[s] = f.Fn[s];
        this.lastVt[s] = this.cp[s][5];
      }
      this.touch[s] = on;
    }
    this.Fn = f.Fn;
  }
}

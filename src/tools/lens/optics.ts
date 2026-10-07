/**
 * レンズの光学計算（DOM に依存しない）: 処方の組み立てと相似拡大、近軸の追跡（焦点距離・主点・瞳・ピント）、
 * 実光線の追跡（球面での屈折）、ザイデルの収差係数。座標は光軸を z、最初の面の頂点を 0 とし、光は +z へ進む。
 * 長さは mm、波長は µm
 */
import { AIR, LC, LD, LF, type Medium, nAt } from './glass';
import type { Rx } from './lenses';

export interface Surf {
  /** 頂点の位置 */
  z: number;
  /** 曲率 1/R（平面は 0） */
  c: number;
  /** 有効半径（絞りは開放の半径） */
  sd: number;
  /** 面の後ろの媒質 */
  m: Medium;
  stop: boolean;
}

export interface Sys {
  rx: Rx;
  s: Surf[];
  /** 焦点距離（d 線、近軸） */
  f: number;
  /** 出典の値に掛けた倍率 */
  k: number;
  /** 絞りの面の番号 */
  si: number;
}

/** 35 mm 判のセンサー [mm] */
export const SENSOR = { w: 36, h: 24 } as const;
export const HALF_DIAG = Math.hypot(SENSOR.w, SENSOR.h) / 2;

/* ---------- 近軸の追跡（y と n·u の 2 行の行列） ---------- */
type M2 = [number, number, number, number];
const mul = (a: M2, b: M2): M2 => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
];
const I2: M2 = [1, 0, 0, 1];

/** 面 i の前の媒質 */
export const before = (s: readonly Surf[], i: number): Medium => (i > 0 ? s[i - 1].m : AIR);

/**
 * 面 i0 の頂点（屈折の前）から、面 i1 − 1 の屈折の後（その頂点）までの行列。
 * (y, n·u) に掛ける。屈折 n'u' = nu − y·c·(n' − n)、移動 y' = y + t·u
 */
export function mat(s: readonly Surf[], i0: number, i1: number, l = LD): M2 {
  let m = I2;
  for (let i = i0; i < i1; i++) {
    const n1 = nAt(before(s, i), l),
      n2 = nAt(s[i].m, l);
    m = mul([1, 0, -s[i].c * (n2 - n1), 1], m);
    if (i < i1 - 1) m = mul([1, (s[i + 1].z - s[i].z) / n2, 0, 1], m);
  }
  return m;
}

/** 絞りの前の群（最初の頂点 → 絞りの面）と後ろの群（絞りの面 → 最後の頂点）の行列 */
function groups(sys: Sys, l = LD): { fr: M2; re: M2 } {
  const { s, si } = sys;
  let fr = I2;
  if (si > 0) fr = mul([1, (s[si].z - s[si - 1].z) / nAt(s[si - 1].m, l), 0, 1], mat(s, 0, si, l));
  return { fr, re: mat(s, si, s.length, l) };
}

export interface Cardinal {
  f: number;
  /** 前側・後側の主点の位置 */
  zH: number;
  zH1: number;
  /** 後側の焦点の位置 */
  zF1: number;
}

/** 焦点距離と主点（物体側・像側とも空気） */
export function cardinal(s: readonly Surf[], l = LD): Cardinal {
  const [A, , C, D] = mat(s, 0, s.length, l),
    f = -1 / C,
    zk = s[s.length - 1].z;
  return { f, zH: f * (1 - D), zH1: zk + (A - 1) * f, zF1: zk + A * f };
}

/* ---------- 処方の組み立て ---------- */
/** 処方を焦点距離 fmm に相似拡大し、有効径を決める */
export function build(rx: Rx, fmm: number): Sys {
  const raw: Surf[] = [];
  let z = 0;
  for (const row of rx.rows) {
    const prev = raw.length ? raw[raw.length - 1].m : AIR;
    if (row[0] === 'stop') raw.push({ z, c: 0, sd: 0, m: prev, stop: true });
    else raw.push({ z, c: row[0] ? 1 / row[0] : 0, sd: 0, m: row[2] ?? AIR, stop: false });
    z += row[1];
  }
  const f0 = cardinal(raw).f,
    k = fmm / f0;
  const s = raw.map((x) => ({ ...x, z: x.z * k, c: x.c / k }));
  const sys: Sys = { rx, s, f: fmm, k, si: s.findIndex((x) => x.stop) };
  if (rx.dia)
    rx.dia.forEach((d, i) => {
      s[i].sd = (d / 2) * k;
    });
  else apertures(sys);
  return sys;
}

/** 開放の絞りの半径（入射瞳の径 f/F から） */
export function stopRadius(sys: Sys, N: number): number {
  return (sys.f / (2 * N)) * groups(sys).fr[0];
}

/**
 * 有効径: 設計の開放 F 値の軸上の光束と、設計の画角の軸外の光束（瞳の上下 v 倍の光線まで）が
 * 通る高さに 3 % の余裕を足す。貼り合わせた面と 1 枚のレンズの両面はそろえる
 */
function apertures(sys: Sys, v = 0.75): void {
  const { s } = sys,
    n = s.length;
  const rs = stopRadius(sys, sys.rx.fno);
  s[sys.si].sd = rs;
  for (const x of s) if (!x.stop) x.sd = 1e9;
  const st = focus(sys, Infinity, sys.rx.fno, 0);
  const need = new Float64Array(n);
  const th = (sys.rx.hfov * Math.PI) / 180;
  const yc = aimChief(st, Math.tan(th), LD);
  const rays: [number, number, number][] = [
    [0, 0, 1],
    [0, 0, -1],
    [Math.tan(th), yc, v],
    [Math.tan(th), yc, -v],
    [Math.tan(th), yc, 0],
  ];
  for (const [u, y0, p] of rays) {
    const r = objRay(st, u, 0, p * st.rep, y0);
    traceFwd(st, r, LD, (i, x, y) => {
      need[i] = Math.max(need[i], Math.hypot(x, y));
    });
  }
  for (let i = 0; i < n; i++) if (!s[i].stop) s[i].sd = need[i] * 1.03;
  /* 1 枚・貼り合わせのまとまり（ガラスでつながる面）は同じ径にする */
  let g0 = -1;
  for (let i = 0; i < n; i++) {
    if (s[i].stop) continue;
    const inGlass = s[i].m !== AIR;
    if (g0 < 0) g0 = i;
    if (!inGlass) {
      let mx = 0;
      for (let j = g0; j <= i; j++) mx = Math.max(mx, s[j].sd);
      for (let j = g0; j <= i; j++) s[j].sd = mx;
      g0 = -1;
    }
  }
  for (const x of s) if (!x.stop && x.c) x.sd = Math.min(x.sd, 0.97 / Math.abs(x.c));
}

/* ---------- ピントと瞳 ---------- */
export interface State {
  sys: Sys;
  /** ピントの距離（センサーから物体の面まで）。Infinity は無限遠 */
  D: number;
  /** センサーの位置 */
  zs: number;
  /** ピントの合う物体の面の位置（無限遠は −Infinity） */
  zo: number;
  /** 撮影倍率（倒立なので負） */
  m: number;
  /** 無限遠からの繰り出し量 */
  ext: number;
  /** F 値（無限遠の入射瞳で決める） */
  N: number;
  /** 絞りの半径（面積の等しい円）と、多角形の外接円の半径 */
  rs: number;
  rc: number;
  /** 絞り羽根の枚数（0 は円） */
  blades: number;
  /** 入射瞳・射出瞳の半径と位置（近軸） */
  rep: number;
  zep: number;
  rxp: number;
  zxp: number;
  /** 実効 F 値 */
  Nw: number;
  card: Cardinal;
}

/** 羽根 n 枚の正多角形で面積が半径 r の円と等しいときの外接円の半径 */
export const polyR = (r: number, n: number): number =>
  n >= 3 ? r * Math.sqrt((2 * Math.PI) / (n * Math.sin((2 * Math.PI) / n))) : r;

/** 最短撮影距離: 撮影倍率 1/2 まで（センサーから物体まで） */
export function minFocus(sys: Sys): number {
  const c = cardinal(sys.s);
  return 4.5 * c.f + (c.zH1 - c.zH);
}

/** ピントの距離 D・F 値 N・羽根の枚数のときの像面と瞳 */
export function focus(sys: Sys, D: number, N: number, blades: number): State {
  const card = cardinal(sys.s),
    { f, zH, zH1 } = card;
  let so = Infinity,
    si = f;
  if (Number.isFinite(D)) {
    const T = Math.max(D - (zH1 - zH), 4 * f);
    so = (T + Math.sqrt(T * T - 4 * T * f)) / 2;
    si = T - so;
  }
  const { fr, re } = groups(sys);
  const rs = (f / (2 * N)) * fr[0];
  const zs = zH1 + si,
    zo = Number.isFinite(so) ? zH - so : -Infinity;
  const zep = fr[1] / fr[0],
    rep = rs / fr[0];
  const zk = sys.s[sys.s.length - 1].z;
  const zxp = zk - re[1] / re[3],
    rxp = Math.abs(rs / re[3]);
  /* 実効 F 値: 軸上の物点から入射瞳の縁を通る近軸光線の、像側の傾き */
  const u0 = Number.isFinite(zo) ? rep / (zep - zo) : 0,
    y1 = Number.isFinite(zo) ? -u0 * zo : rep;
  const M = mat(sys.s, 0, sys.s.length);
  const uk = M[2] * y1 + M[3] * u0;
  return {
    sys,
    D,
    zs,
    zo,
    m: Number.isFinite(so) ? -si / so : 0,
    ext: si - f,
    N,
    rs,
    rc: polyR(rs, blades),
    blades,
    rep,
    zep,
    rxp,
    zxp,
    Nw: 1 / (2 * Math.abs(uk)),
    card,
  };
}

/**
 * 収差なしの薄いレンズ（比べる用）: ピントの距離 D（センサーから、Infinity は無限遠）での像距離 si・
 * 物体距離 so（無限遠は 0）と、F 値 N の開口の半径 a
 */
export function thinLens(f: number, D: number, N: number): { si: number; so: number; a: number } {
  let si = f,
    so = 0;
  if (Number.isFinite(D)) {
    const T = Math.max(D, 4 * f);
    so = (T + Math.sqrt(T * T - 4 * T * f)) / 2;
    si = T - so;
  }
  return { si, so, a: f / (2 * N) };
}

/* ---------- 実光線の追跡 ---------- */
export interface Ray {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

/**
 * 頂点 zv・曲率 c の球面との交点へ光線を進める（頂点に近い側の交点）。外れたら false。
 * いったん頂点の接平面まで進め、球面 c(x² + y² + z'²) − 2z' = 0 と直線の交点のうち、
 * c → 0 で平面に続く根をとる（Spencer・Murty の手順）
 */
export function hit(r: Ray, zv: number, c: number): boolean {
  if (Math.abs(r.dz) < 1e-12) return false;
  const t0 = (zv - r.z) / r.dz,
    x0 = r.x + t0 * r.dx,
    y0 = r.y + t0 * r.dy;
  const B = c * (x0 * r.dx + y0 * r.dy) - r.dz,
    C = c * (x0 * x0 + y0 * y0);
  const disc = B * B - c * C;
  if (disc < 0) return false;
  const den = B + (B >= 0 ? 1 : -1) * Math.sqrt(disc);
  if (den === 0) return false;
  const t = t0 - C / den;
  r.x += t * r.dx;
  r.y += t * r.dy;
  r.z += t * r.dz;
  return true;
}

/** 球面での屈折（スネルの法則のベクトル形）。全反射なら false */
export function snell(r: Ray, zv: number, c: number, n1: number, n2: number): boolean {
  if (n1 === n2) return true;
  let nx = -c * r.x,
    ny = -c * r.y,
    nz = 1 - c * (r.z - zv);
  const nl = Math.hypot(nx, ny, nz);
  nx /= nl;
  ny /= nl;
  nz /= nl;
  let ci = nx * r.dx + ny * r.dy + nz * r.dz;
  if (ci < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
    ci = -ci;
  }
  const eta = n1 / n2,
    k = 1 - eta * eta * (1 - ci * ci);
  if (k < 0) return false;
  const g = Math.sqrt(k) - eta * ci;
  r.dx = eta * r.dx + g * nx;
  r.dy = eta * r.dy + g * ny;
  r.dz = eta * r.dz + g * nz;
  return true;
}

/** 絞りの形（羽根 n 枚の正多角形、頂点の 1 つが +y。n < 3 は円）の内側か。rc は外接円の半径 */
export function inStop(x: number, y: number, rc: number, n: number): boolean {
  const rho = Math.hypot(x, y);
  if (n < 3) return rho <= rc;
  const w = (2 * Math.PI) / n;
  let a = Math.atan2(y, x) - Math.PI / 2;
  a = a - Math.floor(a / w) * w - w / 2;
  return rho * Math.cos(a) <= rc * Math.cos(Math.PI / n);
}

/** 面ごとの屈折率（面の後ろ） */
const nsAt = (s: readonly Surf[], l: number): number[] => s.map((x) => nAt(x.m, l));

/**
 * 物体側からセンサーまで追跡する。each(i, x, y, z) は各面の交点ごとに呼ぶ。
 * 通り抜けたら -1、止まったらその面の番号（ray はその面の交点まで進んでいる）。最後にセンサーの面へ進める
 */
export function traceFwd(
  st: State,
  r: Ray,
  l: number,
  each?: (i: number, x: number, y: number, z: number) => void,
  opt: { rc?: number; blades?: number; noClip?: boolean } = {},
): number {
  const { s } = st.sys,
    ns = nsAt(s, l),
    rc = opt.rc ?? st.rc,
    bl = opt.blades ?? st.blades;
  let n1 = 1;
  for (let i = 0; i < s.length; i++) {
    const x = s[i];
    if (!hit(r, x.z, x.c)) return i;
    each?.(i, r.x, r.y, r.z);
    if (!opt.noClip) {
      if (x.stop ? !inStop(r.x, r.y, rc, bl) : r.x * r.x + r.y * r.y > x.sd * x.sd) return i;
    }
    if (!snell(r, x.z, x.c, n1, ns[i])) return i;
    n1 = ns[i];
  }
  const t = (st.zs - r.z) / r.dz;
  r.x += t * r.dx;
  r.y += t * r.dy;
  r.z = st.zs;
  return -1;
}

/** センサーの側から物体側へ逆に追跡する（描画と同じ向き）。通り抜けたら true */
export function traceRev(st: State, r: Ray, l: number, rc = st.rc, bl = st.blades): boolean {
  const { s } = st.sys,
    ns = nsAt(s, l);
  for (let i = s.length - 1; i >= 0; i--) {
    const x = s[i];
    if (!hit(r, x.z, x.c)) return false;
    if (x.stop ? !inStop(r.x, r.y, rc, bl) : r.x * r.x + r.y * r.y > x.sd * x.sd) return false;
    if (!snell(r, x.z, x.c, ns[i], i > 0 ? ns[i - 1] : 1)) return false;
  }
  return true;
}

/**
 * 物体側の光線。物点は軸からの傾き u（無限遠）または高さ（有限の距離）で決め、入射瞳の面の点
 * (px, y0 + py) を通す。無限遠は傾き u = tan θ、有限は物体の面での高さ Y = u（像の高さ ÷ 倍率）
 */
export function objRay(st: State, u: number, px: number, py: number, y0: number): Ray {
  const tx = px,
    ty = y0 + py,
    tz = st.zep;
  if (Number.isFinite(st.zo)) {
    const ox = 0,
      oy = u,
      oz = st.zo;
    let dx = tx - ox,
      dy = ty - oy,
      dz = tz - oz;
    const L = Math.hypot(dx, dy, dz);
    dx /= L;
    dy /= L;
    dz /= L;
    return { x: ox, y: oy, z: oz, dx, dy, dz };
  }
  const L = Math.hypot(1, u),
    dy = u / L,
    dz = 1 / L;
  const back = tz - startZ(st);
  return { x: tx, y: ty - dy * (back / dz), z: tz - back, dx: 0, dy, dz };
}

/** 無限遠の光線を始める z（最初の面より前） */
const startZ = (st: State) => Math.min(st.zep, 0) - st.sys.f * 0.6;

/** 物点 u からの主光線（絞りの中心を通る実光線）の、入射瞳の面での高さ */
export function aimChief(st: State, u: number, l: number): number {
  const { s, si } = st.sys;
  const g = (y0: number): number => {
    const r = objRay(st, u, 0, 0, y0);
    const ns = nsAt(s, l);
    let n1 = 1;
    for (let i = 0; i <= si; i++) {
      if (!hit(r, s[i].z, s[i].c)) return Number.NaN;
      if (i === si) return r.y;
      if (!snell(r, s[i].z, s[i].c, n1, ns[i])) return Number.NaN;
      n1 = ns[i];
    }
    return Number.NaN;
  };
  let a = 0,
    fa = g(a);
  if (!Number.isFinite(fa)) return 0;
  let b = st.rep * 0.05 + 1e-6,
    fb = g(b);
  for (let k = 0; k < 40 && Number.isFinite(fb) && Math.abs(fb) > 1e-10; k++) {
    if (fb === fa) break;
    const c = b - (fb * (b - a)) / (fb - fa);
    a = b;
    fa = fb;
    b = c;
    fb = g(b);
  }
  return Number.isFinite(fb) ? b : 0;
}

/** 像の高さ h（近軸）に写る物点の u（objRay の u） */
export const fieldU = (st: State, h: number): number => (Number.isFinite(st.zo) ? h / st.m : h / st.sys.f);

/* ---------- ザイデルの収差係数 ---------- */
export interface Seidel {
  /** 球面収差・コマ・非点収差・像面湾曲（ペッツバール）・歪曲 [mm] */
  S: [number, number, number, number, number];
  /** 軸上色収差・倍率色収差 [mm] */
  C: [number, number];
  /** ラグランジュの不変量 */
  H: number;
}

/**
 * 近軸の周辺光線（軸上の物点から入射瞳の縁）と主光線（像の高さ h の物点から入射瞳の中心）の追跡から、
 * Welford の式でザイデルの和を求める。A = n(u + yc)、Δ は屈折の後 − 前、δn = n_F − n_C
 */
export function seidel(st: State, h: number): Seidel {
  const { s } = st.sys;
  const fin = Number.isFinite(st.zo);
  /* 物体側の傾きと最初の面での高さ */
  const ua = fin ? st.rep / (st.zep - st.zo) : 0,
    ya = fin ? -ua * st.zo : st.rep;
  /* 主光線は Welford にならい、光軸の上の物点から出す（像は光軸の下、高さ −h） */
  const Y = fieldU(st, h);
  const ub = fin ? Y / (st.zep - st.zo) : -Y,
    yb = -ub * st.zep;
  let y = ya,
    u = ua,
    yy = yb,
    uu = ub;
  const H = u * yy - uu * y;
  const S: Seidel['S'] = [0, 0, 0, 0, 0],
    C: Seidel['C'] = [0, 0];
  let n1 = 1,
    d1 = 0;
  for (let i = 0; i < s.length; i++) {
    const x = s[i],
      n2 = nAt(x.m, LD),
      d2 = nAt(x.m, LF) - nAt(x.m, LC);
    const A = n1 * (u + y * x.c),
      Ab = n1 * (uu + yy * x.c);
    const u2 = (n1 * u - y * x.c * (n2 - n1)) / n2,
      uu2 = (n1 * uu - yy * x.c * (n2 - n1)) / n2;
    const du = u2 / n2 - u / n1,
      dn = 1 / n2 - 1 / n1,
      dd = d2 / n2 - d1 / n1;
    const s1 = -A * A * y * du,
      s2 = -A * Ab * y * du,
      s3 = -Ab * Ab * y * du,
      s4 = -H * H * x.c * dn;
    S[0] += s1;
    S[1] += s2;
    S[2] += s3;
    S[3] += s4;
    if (Math.abs(A) > 1e-12) S[4] += (Ab / A) * (s3 + s4);
    C[0] += A * y * dd;
    C[1] += Ab * y * dd;
    if (i < s.length - 1) {
      const t = s[i + 1].z - x.z;
      y += t * u2;
      yy += t * uu2;
    }
    u = u2;
    uu = uu2;
    n1 = n2;
    d1 = d2;
  }
  return { S, C, H };
}

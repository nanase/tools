/**
 * 地上の観測地から見た月（DOM に依存しない）: 位置・秤動・満ち欠け・高度と方位・出没・月相・近地点・月食
 *
 * ベクトルはすべて地心の、真の赤道と分点 of date の直交座標（x が春分点、z が天の北極）で、単位は km。
 * 月と太陽は見かけの位置（光差・光行差・章動を含む）。月の向きは IAU WGCCRE の模型
 * （Archinal et al. 2011、係数は NAIF の pck00011.tpc）で、これは ICRF の値なので歳差と章動で of date へ回す。
 * 秤動は観測地への向きを月固定の座標で表したもので、光学的・物理的・日周の秤動をまとめて含む
 */
import { A_M, observerXYZ } from '../solar-eclipse/earth';
import { AU, type Ecl, eclToEqu, gast, moonEcl, type Nut, nutation, precNut, type Vec3 } from './meeus';
import { sunEcl } from './sun';
import { deltaT } from './time';

export type { Vec3 } from './meeus';

const D = Math.PI / 180;
/** 月の半径（IAU）と地球の赤道半径（WGS84）[km] */
export const R_MOON = 1737.4;
const R_EARTH = A_M / 1000;
/** 地平線での大気差と月の上縁で出没を決める（Meeus 15 章の −0.5667°） */
const H_REFR = 0.5667;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mul = (m: number[], v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const deg360 = (r: number) => (((r / D) % 360) + 360) % 360;
const angle = (a: Vec3, b: Vec3) => Math.atan2(len(cross(a, b)), dot(a, b));
const POLE: Vec3 = [0, 0, 1];

export interface Obs {
  /** 測地緯度・経度（東が正）[°]、標高 [m] */
  lat: number;
  lon: number;
  h: number;
}

interface Core {
  jd: number;
  jdTT: number;
  t: number;
  n: Nut;
  mEcl: Ecl;
  sEcl: Ecl;
  moon: Vec3;
  sun: Vec3;
}

function core(jd: number): Core {
  const jdTT = jd + deltaT(jd) / 86400;
  const t = (jdTT - 2451545) / 36525;
  const n = nutation(t);
  const mEcl = moonEcl(t);
  const sEcl = sunEcl(t);
  return { jd, jdTT, t, n, mEcl, sEcl, moon: eclToEqu(mEcl, n), sun: eclToEqu(sEcl, n) };
}

/** 観測地の地心の位置 [km] と天頂（測地の法線）の向き */
function site(c: Core, o: Obs): { obs: Vec3; zenith: Vec3 } {
  const th = gast(c.jd, c.n) + o.lon * D;
  const p = observerXYZ(o.lat * D, 0, o.h);
  const cl = Math.cos(o.lat * D);
  return {
    obs: [R_EARTH * p[0] * Math.cos(th), R_EARTH * p[0] * Math.sin(th), R_EARTH * p[2]],
    zenith: [cl * Math.cos(th), cl * Math.sin(th), Math.sin(o.lat * D)],
  };
}

/** 月の章動角 E1〜E13（pck00011.tpc の BODY3_NUT_PREC_ANGLES、定数 [°] と 1 世紀あたり [°]） */
// biome-ignore format: 表
const E_ANG = [
  125.045, -1935.5364525, 250.089, -3871.072905, 260.008, 475263.3328725, 176.625, 487269.629985,
  357.529, 35999.0509575, 311.589, 964468.49931, 134.963, 477198.869325, 276.617, 12006.300765,
  34.226, 63863.5132425, 15.134, -5806.6093575, 119.743, 131.84064, 239.961, 6003.1503825,
  25.053, 473327.79642,
];
// biome-ignore format: 表
const RA = [-3.8787, -0.1204, 0.07, -0.0172, 0, 0.0072, 0, 0, 0, -0.0052, 0, 0, 0.0043];
// biome-ignore format: 表
const DEC = [1.5419, 0.0239, -0.0278, 0.0068, 0, -0.0029, 0.0009, 0, 0, 0.0008, 0, 0, -0.0009];
// biome-ignore format: 表
const PM = [3.561, 0.1208, -0.0642, 0.0158, 0.0252, -0.0066, -0.0047, -0.0046, 0.0028, 0.0052, 0.004, 0.0019, -0.0044];

/** 月固定の座標（平均地球方向・自転軸）の軸を、真の赤道と分点 of date で表したもの */
function moonAxes(c: Core): [Vec3, Vec3, Vec3] {
  const d = c.jdTT - 2451545;
  const t = d / 36525;
  let a0 = 269.9949 + 0.0031 * t;
  let d0 = 66.5392 + 0.013 * t;
  let w = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d;
  for (let k = 0; k < 13; k++) {
    const e = (E_ANG[2 * k] + E_ANG[2 * k + 1] * t) * D;
    a0 += RA[k] * Math.sin(e);
    d0 += DEC[k] * Math.cos(e);
    w += PM[k] * Math.sin(e);
  }
  const ca = Math.cos(a0 * D);
  const sa = Math.sin(a0 * D);
  const cw = Math.cos((w % 360) * D);
  const sw = Math.sin((w % 360) * D);
  const z: Vec3 = [Math.cos(d0 * D) * ca, Math.cos(d0 * D) * sa, Math.sin(d0 * D)];
  // 月の赤道が ICRF の赤道を北へ横切る点 Q から、東へ W のところが本初子午線
  const q: Vec3 = [-sa, ca, 0];
  const r = cross(z, q);
  const x: Vec3 = [cw * q[0] + sw * r[0], cw * q[1] + sw * r[1], cw * q[2] + sw * r[2]];
  const m = precNut(c.t, c.n);
  const mz = mul(m, z);
  const mx = mul(m, x);
  return [mx, cross(mz, mx), mz];
}

/** 大気差 [°]（Saemundsson、Meeus 16.4 式）。h は大気差を含まない高度 [°]。−1° より下は −1° の値 */
export function refraction(h: number): number {
  const x = Math.max(h, -1);
  return 1.02 / Math.tan((x + 10.3 / (x + 5.11)) * D) / 60;
}

/** 視線 u（単位ベクトル）の向きに見た天球で、ベクトル v の位置角（天の北から東へ）[°] */
function posAngle(u: Vec3, v: Vec3): number {
  const k = dot(POLE, u);
  const n = unit([-k * u[0], -k * u[1], 1 - k * u[2]]);
  const e = cross(n, u);
  return deg360(Math.atan2(dot(v, e), dot(v, n)));
}

export interface MoonState {
  /** JD（UT と TT） */
  jd: number;
  jdTT: number;
  /** 地心の月・太陽・観測地 [km]（真の赤道と分点 of date） */
  moon: Vec3;
  sun: Vec3;
  obs: Vec3;
  /** 月固定の座標（平均地球方向・自転軸）の x・y・z 軸 */
  mx: Vec3;
  my: Vec3;
  mz: Vec3;
  /** 観測地から・地心からの距離 [km] */
  dist: number;
  distGeo: number;
  /** 観測地から見た視直径 [″] */
  diam: number;
  /** 観測地・太陽の直下点の月面緯度・経度（東が正）[°] */
  subObs: { lat: number; lon: number };
  subSun: { lat: number; lon: number };
  /** 太陽の余経度 [°] */
  colong: number;
  /** 位相角 [°]（観測地から）と輝面比 */
  phase: number;
  illum: number;
  /** 地心の黄経の差 月 − 太陽 [°]（0 新月、90 上弦、180 満月、270 下弦） */
  elong: number;
  /** 月の北極・輝面の中点・天頂の位置角（天の北から東へ）[°] */
  paAxis: number;
  paBright: number;
  q: number;
  /** 高度（大気差あり・なし）・方位（北から東へ）[°] */
  alt: number;
  altGeo: number;
  az: number;
  /** 観測地の天頂と天の北極の向き */
  zenith: Vec3;
  pole: Vec3;
}

const selen = (mx: Vec3, my: Vec3, mz: Vec3, v: Vec3) => {
  const u = unit(v);
  return { lat: Math.asin(dot(u, mz)) / D, lon: Math.atan2(dot(u, my), dot(u, mx)) / D };
};

/** 時刻 jd（UT）に観測地 o から見た月。o = null なら地心（高度・方位は NaN） */
export function moonState(jd: number, o: Obs | null): MoonState {
  const c = core(jd);
  const nan: Vec3 = [Number.NaN, Number.NaN, Number.NaN];
  const { obs, zenith } = o ? site(c, o) : { obs: [0, 0, 0] as Vec3, zenith: nan };
  const top = sub(c.moon, obs);
  const u = unit(top);
  const dist = len(top);
  const [mx, my, mz] = moonAxes(c);
  const toSun = sub(c.sun, c.moon);
  const subSun = selen(mx, my, mz, toSun);
  const phase = angle(toSun, sub(obs, c.moon));
  let alt = Number.NaN;
  let altGeo = Number.NaN;
  let az = Number.NaN;
  let q = Number.NaN;
  if (o) {
    altGeo = Math.asin(dot(u, zenith)) / D;
    alt = altGeo + refraction(altGeo);
    const east = unit(cross(POLE, zenith));
    az = deg360(Math.atan2(dot(u, east), dot(u, cross(zenith, east))));
    q = posAngle(u, zenith);
  }
  return {
    jd,
    jdTT: c.jdTT,
    moon: c.moon,
    sun: c.sun,
    obs,
    mx,
    my,
    mz,
    dist,
    distGeo: len(c.moon),
    diam: (2 * Math.asin(R_MOON / dist) * 3600) / D,
    subObs: selen(mx, my, mz, sub(obs, c.moon)),
    subSun,
    colong: (((90 - subSun.lon) % 360) + 360) % 360,
    phase: phase / D,
    illum: (1 + Math.cos(phase)) / 2,
    elong: deg360(c.mEcl.lon - c.sEcl.lon),
    paAxis: posAngle(u, mz),
    paBright: posAngle(u, toSun),
    q,
    alt,
    altGeo,
    az,
    zenith,
    pole: POLE,
  };
}

/** 地心の黄経の差 月 − 太陽 [°]（0〜360） */
function elongAt(jd: number): number {
  const t = (jd + deltaT(jd) / 86400 - 2451545) / 36525;
  return deg360(moonEcl(t).lon - sunEcl(t).lon);
}

const wrap180 = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;

/** f(lo) と f(hi) の符号が逆の区間を二分して根を出す */
function bisect(f: (t: number) => number, lo: number, hi: number, n = 24): number {
  const sl = Math.sign(f(lo));
  let a = lo;
  let b = hi;
  for (let k = 0; k < n; k++) {
    const m = (a + b) / 2;
    if (Math.sign(f(m)) === sl) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** 月齢: 直前の新月（黄経の差 0）からの日数 */
export function ageAt(jd: number): number {
  let t = jd - elongAt(jd) / 12.19;
  for (let k = 0; k < 6; k++) t -= wrap180(elongAt(t)) / 12.19;
  return jd - t;
}

/** [jd0, jd1) の朔・上弦・望・下弦（q = 0〜3）の時刻 */
export function phaseTimes(jd0: number, jd1: number): { jd: number; q: 0 | 1 | 2 | 3 }[] {
  const out: { jd: number; q: 0 | 1 | 2 | 3 }[] = [];
  let a = jd0;
  let qa = Math.floor(elongAt(a) / 90);
  while (a < jd1) {
    const b = Math.min(a + 1, jd1);
    const qb = Math.floor(elongAt(b) / 90);
    if (qb !== qa) {
      const q = ((qa + 1) % 4) as 0 | 1 | 2 | 3;
      const jd = bisect((t) => wrap180(elongAt(t) - 90 * q), a, b, 30);
      if (jd < jd1) out.push({ jd, q });
    }
    a = b;
    qa = qb;
  }
  return out;
}

const distAt = (jd: number) => {
  const t = (jd + deltaT(jd) / 86400 - 2451545) / 36525;
  return moonEcl(t).dist;
};

/** 黄金分割で f の極小を探す */
function golden(f: (t: number) => number, lo: number, hi: number, n = 50): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let k = 0; k < n; k++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/** [jd0, jd1) の近地点・遠地点（地心距離の極値）の時刻と距離 [km] */
export function apsides(jd0: number, jd1: number): { jd: number; km: number; kind: 'peri' | 'apo' }[] {
  const out: { jd: number; km: number; kind: 'peri' | 'apo' }[] = [];
  const h = 0.5;
  let t0 = jd0 - h;
  let d0 = distAt(t0);
  let d1 = distAt(jd0);
  for (let t1 = jd0; t1 < jd1 + h; t1 += h) {
    const d2 = distAt(t1 + h);
    if ((d1 - d0) * (d2 - d1) < 0) {
      const apo = d1 > d0;
      const jd = golden((t) => (apo ? -distAt(t) : distAt(t)), t1 - h, t1 + h);
      if (jd >= jd0 && jd < jd1) out.push({ jd, km: distAt(jd), kind: apo ? 'apo' : 'peri' });
    }
    t0 = t1;
    d0 = d1;
    d1 = d2;
  }
  return out;
}

/** 観測地での月の上縁の高度（出没の判定の値）[°] と、東西の成分（南中で + から − へ） */
function horizonAt(jd: number, o: Obs): [number, number] {
  const c = core(jd);
  const { obs, zenith } = site(c, o);
  const top = sub(c.moon, obs);
  const u = unit(top);
  const sd = Math.asin(R_MOON / len(top)) / D;
  return [Math.asin(dot(u, zenith)) / D + sd + H_REFR, dot(u, cross(POLE, zenith))];
}

/**
 * [jd0, jd0 + 1) の月の出・南中・月の入り（jd0 は地方時の 0 時の JD）。
 * 出没は大気差 34′ と視半径を見込んだ上縁、南中は観測地から見た時角 0。ない日は null・NaN。transitAlt は大気差込み
 */
export function riseSet(
  jd0: number,
  o: Obs,
): { rise: number | null; transit: number; transitAlt: number; set: number | null } {
  const n = 48;
  const s = Array.from({ length: n + 1 }, (_, i) => horizonAt(jd0 + i / n, o));
  let rise: number | null = null;
  let set: number | null = null;
  let transit = Number.NaN;
  for (let i = 0; i < n; i++) {
    const [a, b] = [s[i], s[i + 1]];
    const lo = jd0 + i / n;
    const hi = jd0 + (i + 1) / n;
    if (rise === null && a[0] < 0 && b[0] >= 0) rise = bisect((t) => horizonAt(t, o)[0], lo, hi, 20);
    if (set === null && a[0] >= 0 && b[0] < 0) set = bisect((t) => horizonAt(t, o)[0], lo, hi, 20);
    if (Number.isNaN(transit) && a[1] > 0 && b[1] <= 0) transit = bisect((t) => horizonAt(t, o)[1], lo, hi, 20);
  }
  return { rise, transit, transitAlt: Number.isNaN(transit) ? Number.NaN : moonState(transit, o).alt, set };
}

export interface Shadow {
  /** 地球から見た太陽と反対の向き（影の軸） */
  axis: Vec3;
  /** 月の距離での本影・半影の角半径 [°]（Danjon） */
  Ru: number;
  Rp: number;
  /** 月の地心の視半径 [°] */
  sdMoon: number;
  /** 影の軸から月の中心への角距離 [°]、x は東、y は北 */
  x: number;
  y: number;
}

/**
 * 月の位置での地球の影。Danjon の方法: Ru = 1.01 πm − s + πs、Rp = 1.01 πm + s + πs
 * （πm・πs は月・太陽の赤道地平視差、s は太陽の視半径 959.63″/R）
 */
export function shadowAt(jd: number): Shadow {
  const c = core(jd);
  const rm = len(c.moon);
  const rs = len(c.sun);
  const pm = Math.asin(R_EARTH / rm) / D;
  const ps = Math.asin(R_EARTH / rs) / D;
  const s = 959.63 / 3600 / (rs / AU);
  const axis = unit([-c.sun[0], -c.sun[1], -c.sun[2]]);
  const u = unit(c.moon);
  const k = dot(POLE, axis);
  const n = unit([-k * axis[0], -k * axis[1], 1 - k * axis[2]]);
  const e = cross(n, axis);
  const sep = angle(u, axis) / D;
  const ex = dot(u, e);
  const ny = dot(u, n);
  const h = Math.hypot(ex, ny) || 1;
  return {
    axis,
    Ru: 1.01 * pm - s + ps,
    Rp: 1.01 * pm + s + ps,
    sdMoon: Math.asin(R_MOON / rm) / D,
    x: (sep * ex) / h,
    y: (sep * ny) / h,
  };
}

/** 月食の接触（半影 P1・P4、本影 U1〜U4）と最大の時刻（UT の JD）、最大での本影・半影の食分。jdMax は最大の目安 */
export function eclipseContacts(jdMax: number): {
  p1: number | null;
  u1: number | null;
  u2: number | null;
  max: number;
  u3: number | null;
  u4: number | null;
  p4: number | null;
  umag: number;
  pmag: number;
} {
  const sepAt = (t: number) => {
    const s = shadowAt(t);
    return Math.hypot(s.x, s.y);
  };
  const max = golden(sepAt, jdMax - 0.1, jdMax + 0.1, 60);
  const sm = shadowAt(max);
  const sep = Math.hypot(sm.x, sm.y);
  const pair = (r: (s: Shadow) => number): [number | null, number | null] => {
    const f = (t: number) => {
      const s = shadowAt(t);
      return Math.hypot(s.x, s.y) - r(s);
    };
    if (f(max) >= 0) return [null, null];
    const w = 0.3;
    return [f(max - w) > 0 ? bisect(f, max - w, max, 30) : null, f(max + w) > 0 ? bisect(f, max, max + w, 30) : null];
  };
  const [p1, p4] = pair((s) => s.Rp + s.sdMoon);
  const [u1, u4] = pair((s) => s.Ru + s.sdMoon);
  const [u2, u3] = pair((s) => s.Ru - s.sdMoon);
  return {
    p1,
    u1,
    u2,
    max,
    u3,
    u4,
    p4,
    umag: (sm.Ru + sm.sdMoon - sep) / (2 * sm.sdMoon),
    pmag: (sm.Rp + sm.sdMoon - sep) / (2 * sm.sdMoon),
  };
}

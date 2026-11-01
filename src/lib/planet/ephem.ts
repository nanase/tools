/**
 * 地球から見た惑星と衛星（DOM に依存しない）: 見かけの位置・光行時間・自転軸と自転角・太陽の向き・衛星の位置
 *
 * 惑星と地球の日心位置は VSOP87D（日付の黄道と分点）で、Meeus『Astronomical Algorithms』33 章の手順に従う。
 * 惑星は光行時間だけ前の位置、地球は今の位置をとって差をとり、FK5 への補正（32.3 式）・年周光行差・章動を入れる。
 * 自転軸と本初子午線は IAU WGCCRE（ICRF の値）で、歳差と章動で日付の赤道へ回す。
 * 衛星は光行時間だけ前の惑星中心の位置に、惑星より遠い・近い分の光行時間の差を足す。
 * ベクトルは地心の、真の赤道と分点 of date の直交座標（lib/astro/frame.ts）で、単位は km
 */
import { AU, type Nut, nutation, POLE, posAngle, precNut } from '../astro/frame';
import { altAz, type Obs, site } from '../astro/observer';
import { earthHelio } from '../astro/sun';
import { deltaT } from '../astro/time';
import { angle, cross, dot, len, mul, sub, unit, type Vec3 } from '../astro/vec';
import { type VsopTable, vsop } from '../astro/vsop';

const D = Math.PI / 180;
const AS = D / 3600;
/** 光の速さ [km/日] */
export const C_KMD = 299792.458 * 86400;
/** 太陽の半径 [km]（IAU 2015） */
export const R_SUN = 695700;

/** 惑星と衛星の模型（惑星ごとに作る） */
export interface PlanetModel {
  /** VSOP87D の表 */
  vsop: VsopTable;
  /** 赤道半径・極半径 [km] */
  re: number;
  rp: number;
  /** 自転軸の赤経・赤緯（ICRF）[°]。T は J2000.0 からの TDB のユリウス世紀 */
  pole(T: number): [number, number];
  /** 本初子午線の角 W [°]（IAU の自転系）。d は J2000.0 からの TDB の日 */
  w(d: number): number;
  /** 衛星 k の惑星中心の位置（ICRF）[km]。jdTT は TT の JD */
  moon(k: number, jdTT: number): Vec3;
  /** 衛星の数 */
  nMoons: number;
  /** 地球から見た明るさ [等]。r・Δ [au]、位相角 α [°]、地球と太陽の直下点の惑星中心緯度 [°]（土星の環に使う） */
  mag(r: number, delta: number, alpha: number, latObs: number, latSun: number): number;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** VSOP87D の黄経・黄緯・動径を FK5 へ補正し（Meeus 32.3 式）、日付の黄道の直交座標 [au] にする */
function helioRect(lon: number, lat: number, r: number, t: number): Vec3 {
  const lp = lon - (1.397 * t + 0.00031 * t * t) * D;
  const l = lon + (-0.09033 + 0.03916 * (Math.cos(lp) + Math.sin(lp)) * Math.tan(lat)) * AS;
  const b = lat + 0.03916 * (Math.cos(lp) - Math.sin(lp)) * AS;
  return [r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b)];
}

const planetRect = (tab: VsopTable, t: number): Vec3 => {
  const tau = t / 10;
  return helioRect(vsop(tab, 'L', tau), vsop(tab, 'B', tau), vsop(tab, 'R', tau), t);
};
const earthRect = (t: number): Vec3 => {
  const e = earthHelio(t);
  return helioRect(e.lon, e.lat, e.r, t);
};

/** 日付の黄道の直交座標を、真の赤道と分点 of date へ（黄経に Δψ を足し、真の黄道傾斜で回す） */
function eclToEquRect(v: Vec3, n: Nut): Vec3 {
  const cp = Math.cos(n.dpsi),
    sp = Math.sin(n.dpsi);
  const x = cp * v[0] - sp * v[1],
    y = sp * v[0] + cp * v[1];
  const e = n.eps0 + n.deps;
  return [x, Math.cos(e) * y - Math.sin(e) * v[2], Math.sin(e) * y + Math.cos(e) * v[2]];
}

/** 速さ v の観測者から見た向き u（単位ベクトル）の光行差。b = v / c */
const aberrate = (u: Vec3, b: Vec3): Vec3 => unit(sub(add(u, b), scale(u, dot(u, b))));

/** ゆっくり変わる部分（惑星の向きと距離・太陽の向き・自転軸）。探索ではこれを補間して使う */
export interface Slow {
  jd: number;
  jdTT: number;
  /** J2000.0 からの TT のユリウス世紀 */
  t: number;
  n: Nut;
  /** J2000.0 の赤道から日付の赤道への回転 */
  M: number[];
  /** 光行時間 [日] */
  lt: number;
  /** 地心から惑星への見かけの位置 [km] */
  P: Vec3;
  /** 惑星から太陽への向き（惑星の公転による光行差を含む） */
  s: Vec3;
  /** 太陽からの距離・地心距離 [au] */
  r: number;
  delta: number;
  /** 自転軸の北の向き、ICRF の赤道との昇交点の向き（どちらも日付の赤道） */
  z: Vec3;
  q: Vec3;
  /** 地心の太陽の黄経から見た惑星の離角（日付の黄道）[°]。衝で 180 */
  elong: number;
}

/** ゆっくり変わる部分を求める（jd は UT） */
export function slowAt(m: PlanetModel, jd: number): Slow {
  const jdTT = jd + deltaT(jd) / 86400;
  const t = (jdTT - 2451545) / 36525;
  const n = nutation(t);
  const h = 0.05 / 36525;
  const e = earthRect(t);
  const ev = scale(sub(earthRect(t + h), earthRect(t - h)), AU / (2 * h * 36525) / C_KMD);
  let lt = 0;
  let p: Vec3 = [0, 0, 0];
  let g: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    p = planetRect(m.vsop, t - lt / 36525);
    g = sub(p, e);
    lt = (len(g) * AU) / C_KMD;
  }
  const tl = t - lt / 36525;
  const pv = scale(sub(planetRect(m.vsop, tl + h), planetRect(m.vsop, tl - h)), AU / (2 * h * 36525) / C_KMD);
  const P = scale(eclToEquRect(aberrate(unit(g), ev), n), len(g) * AU);
  const s = unit(eclToEquRect(aberrate(unit(scale(p, -1)), pv), n));
  const M = precNut(t, n);
  const [ra, dec] = m.pole(tl);
  const z0: Vec3 = [Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)];
  const q0: Vec3 = [-Math.sin(ra * D), Math.cos(ra * D), 0];
  const el = Math.atan2(g[1], g[0]) - Math.atan2(-e[1], -e[0]);
  return {
    jd,
    jdTT,
    t,
    n,
    M,
    lt,
    P,
    s,
    r: len(p),
    delta: len(g),
    z: mul(M, z0),
    q: mul(M, q0),
    elong: (((el / D) % 360) + 360) % 360,
  };
}

/** 2 つの Slow の間を線形に補間する（f = 0〜1）。単位ベクトルは長さを 1 に戻す */
function lerpSlow(a: Slow, b: Slow, jd: number): Slow {
  const f = (jd - a.jd) / (b.jd - a.jd);
  const lv = (u: Vec3, v: Vec3): Vec3 => [u[0] + (v[0] - u[0]) * f, u[1] + (v[1] - u[1]) * f, u[2] + (v[2] - u[2]) * f];
  const li = (u: number, v: number) => u + (v - u) * f;
  return {
    ...a,
    jd,
    jdTT: li(a.jdTT, b.jdTT),
    t: li(a.t, b.t),
    lt: li(a.lt, b.lt),
    P: lv(a.P, b.P),
    s: unit(lv(a.s, b.s)),
    r: li(a.r, b.r),
    delta: li(a.delta, b.delta),
    z: unit(lv(a.z, b.z)),
    q: unit(lv(a.q, b.q)),
    elong: li(a.elong, a.elong + ((((b.elong - a.elong + 540) % 360) + 360) % 360) - 180),
  };
}

/** ある時刻の幾何（地心）。ベクトルは日付の赤道で km、体の座標は惑星の赤道半径を 1 とする */
export interface Geo extends Slow {
  /** 惑星固定の座標の軸（x が本初子午線、z が北極） */
  x: Vec3;
  y: Vec3;
  /** 衛星の惑星中心の位置 [km] */
  moons: Vec3[];
}

/** ゆっくり変わる部分に、自転と衛星を足す */
export function fastAt(m: PlanetModel, s: Slow): Geo {
  const tl = s.jdTT - s.lt;
  const w = m.w(tl - 2451545) * D;
  const qe = cross(s.z, s.q);
  const x = add(scale(s.q, Math.cos(w)), scale(qe, Math.sin(w)));
  const y = cross(s.z, x);
  const u = unit(s.P);
  const moons: Vec3[] = [];
  for (let k = 0; k < m.nMoons; k++) {
    let v = mul(s.M, m.moon(k, tl));
    // 惑星より遠い衛星の光は早く出ている
    v = mul(s.M, m.moon(k, tl - dot(v, u) / C_KMD));
    moons.push(v);
  }
  return { ...s, x, y, moons };
}

/**
 * 探索用の幾何: ゆっくり変わる部分を 1/8 日ごとに求めて覚え、間を線形に補間する（補間の誤差は 0.02″ ほど）
 */
export class Ephem {
  private knots = new Map<number, Slow>();
  constructor(readonly model: PlanetModel) {}
  private knot(i: number): Slow {
    let k = this.knots.get(i);
    if (!k) {
      if (this.knots.size > 4000) this.knots.clear();
      k = slowAt(this.model, i / 8);
      this.knots.set(i, k);
    }
    return k;
  }
  slow(jd: number): Slow {
    const i = Math.floor(jd * 8);
    return lerpSlow(this.knot(i), this.knot(i + 1), jd);
  }
  at(jd: number): Geo {
    return fastAt(this.model, this.slow(jd));
  }
}

/** 惑星固定の座標へ（単位は変えない） */
export const toBody = (g: Geo, v: Vec3): Vec3 => [dot(v, g.x), dot(v, g.y), dot(v, g.z)];

/** 惑星中心から向き v を見たときの、惑星固定の座標の経度（西経）[°] と惑星中心緯度 [°] */
export function subPoint(g: Geo, v: Vec3): { lonW: number; lat: number } {
  const b = unit(toBody(g, v));
  return { lonW: (((-Math.atan2(b[1], b[0]) / D) % 360) + 360) % 360, lat: Math.asin(b[2]) / D };
}

/** 惑星中心緯度を惑星図緯度へ */
export const graphic = (m: PlanetModel, lat: number): number => Math.atan((m.re / m.rp) ** 2 * Math.tan(lat * D)) / D;

/**
 * 日付の赤道との昇交点から測った自転角 W（Meeus 43 章の System I・II）での中央子午線の経度（西経）[°]。
 * v は惑星から観測者への向き
 */
export function cmFromNodeOfDate(g: Geo, w: number, v: Vec3): number {
  const q = unit(cross(POLE, g.z));
  const qe = cross(g.z, q);
  const le = Math.atan2(dot(v, qe), dot(v, q)) / D;
  return (((w - le) % 360) + 360) % 360;
}

/** 観測地から見た惑星の状態 */
export interface PlanetState {
  geo: Geo;
  /** 観測地から惑星への見かけの位置 [km] と、観測地・天頂の向き */
  P: Vec3;
  obs: Vec3;
  zenith: Vec3;
  /** 距離 [au]・赤道の視直径 [″] */
  delta: number;
  diam: number;
  /** 位相角 [°]・照らされた割合・明るさ [等] */
  phase: number;
  illum: number;
  mag: number;
  /** 観測地・太陽の直下点（西経と惑星中心緯度）[°] */
  subObs: { lonW: number; lat: number };
  subSun: { lonW: number; lat: number };
  /** 北極の位置角（天の北から東へ）[°] */
  paAxis: number;
  /** 高度（大気差あり）・方位・天頂の位置角 [°]（地心なら NaN） */
  alt: number;
  az: number;
  q: number;
}

/** 時刻 jd（UT）に観測地 o から見た惑星。o = null なら地心 */
export function planetState(m: PlanetModel, jd: number, o: Obs | null): PlanetState {
  const g = fastAt(m, slowAt(m, jd));
  const nan: Vec3 = [Number.NaN, Number.NaN, Number.NaN];
  const st = o ? site(jd, g.n, o) : { obs: [0, 0, 0] as Vec3, zenith: nan };
  const P = sub(g.P, st.obs);
  const u = unit(P);
  const toObs = scale(u, -1);
  const ph = angle(g.s, toObs);
  const aa = o ? altAz(u, st.zenith) : { alt: Number.NaN, az: Number.NaN, q: Number.NaN };
  const dau = len(P) / AU;
  const subObs = subPoint(g, toObs);
  const subSun = subPoint(g, g.s);
  return {
    geo: g,
    P,
    obs: st.obs,
    zenith: st.zenith,
    delta: dau,
    diam: (2 * Math.asin(m.re / len(P))) / AS,
    phase: ph / D,
    illum: (1 + Math.cos(ph)) / 2,
    mag: m.mag(g.r, dau, ph / D, subObs.lat, subSun.lat),
    subObs,
    subSun,
    paAxis: posAngle(u, g.z),
    alt: aa.alt,
    az: aa.az,
    q: aa.q,
  };
}

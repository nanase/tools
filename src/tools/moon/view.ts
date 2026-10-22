/**
 * 見え方の計算（DOM に依存しない）: 画面の向き、月固定の座標への変換、明るさ（露出・地球照）、地名の位置
 */
import type { MoonState } from './ephem';
import { type MoonU, malV, type Vec3 } from './render';

export type Orient = 'zenith' | 'moon' | 'sky';
export type Bright = 'eye' | 'camera' | 'phys';

const D = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** 画面の右・上・奥（観測者から月へ）。上は天頂・月の北極・天の北極のどれか */
export function basis(st: MoonState, mode: Orient): { r: Vec3; u: Vec3; f: Vec3 } {
  const f = unit(sub(st.moon, st.obs));
  const up = mode === 'zenith' ? st.zenith : mode === 'moon' ? st.mz : st.pole;
  const r = unit(cross(f, up));
  return { r, u: cross(r, f), f };
}

/** 赤道座標の向きを月固定の座標へ */
export const toBody = (st: MoonState, v: Vec3): Vec3 => [dot(v, st.mx), dot(v, st.my), dot(v, st.mz)];

/** 画面での向き（右 = 0°、反時計回り）。天頂・天の北・月の北の矢印に使う */
export function screenAngle(st: MoonState, mode: Orient, v: Vec3): number {
  const b = basis(st, mode);
  return Math.atan2(dot(v, b.u), dot(v, b.r)) / D;
}

/** McEwen の lunar-Lambert の L（位相角 α [°]） */
export const lunarL = (a: number): number => 1 - 0.019 * a + 0.000242 * a * a - 0.00000146 * a ** 3;

/** 衝効果: 位相角 4° から 0° で約 4 割明るくなる（Buratti et al. 1996）のを、指数の山で表す（このツールで決めた形） */
export const surge = (a: number): number => 1 + 0.4 * Math.exp(-a / 2.5);

/** 地球照の直射に対する比: 満地球で 1/4000（推定）に、月から見た地球の輝面比を掛ける */
export const earthshine = (phase: number): number => ((1 - Math.cos(phase * D)) / 2) * (1 / 4000);

/** 明るさの見せ方ごとの地球照の強調（目とカメラでは見えるように持ち上げる。このツールで決めた値） */
const ES_GAIN: Record<Bright, number> = { eye: 30, camera: 30, phys: 1 };
/** 欠けていない月面を白の手前に置く基準の倍率 */
const BASE = 1.75;

/** 月食の影の幾何（ephem.shadowAt の値） */
export interface ShadowGeom {
  axis: Vec3;
  Ru: number;
  Rp: number;
  sdMoon: number;
  x: number;
  y: number;
}

/**
 * 月食中の露出: 円盤の中で最も明るい点（影の中心から最も遠い点）の減光を、目は 3/4 だけ、カメラは全部取り戻す。
 * 物理は取り戻さない
 */
export function eclipseGain(sh: ShadowGeom, mode: Bright): number {
  const th = Math.hypot(sh.x, sh.y) + sh.sdMoon;
  if (th >= sh.Rp) return 1;
  const k = 10 ** (0.4 * malV(th, sh.Ru, sh.Rp));
  return mode === 'camera' ? k : mode === 'eye' ? k ** 0.75 : 1;
}

/** 描画に渡す値をそろえる */
export function moonUniforms(st: MoonState, mode: Orient, bright: Bright, sh: ShadowGeom | null, sat = 0.55): MoonU {
  const b = basis(st, mode);
  const s = unit(sub(st.sun, st.moon)),
    o = unit(sub(st.obs, st.moon));
  const inShadow = !!sh && Math.hypot(sh.x, sh.y) - sh.sdMoon < sh.Rp;
  const m: MoonU = {
    r: toBody(st, b.r),
    u: toBody(st, b.u),
    f: toBody(st, b.f),
    s: toBody(st, s),
    o: toBody(st, o),
    L: lunarL(st.phase),
    gain: BASE * (bright === 'phys' ? surge(st.phase) : 1) * (inShadow && sh ? eclipseGain(sh, bright) : 1),
    es: earthshine(st.phase) * ES_GAIN[bright],
    sat,
  };
  if (inShadow && sh)
    m.ecl = {
      mc: st.moon,
      b2f: [...st.mx, ...st.my, ...st.mz],
      ax: sh.axis,
      Ru: sh.Ru,
      Rp: sh.Rp,
    };
  return m;
}

/** 月面の点（緯度・経度 [°]）の画面の位置（月の半径を 1、右・上が正）。裏側なら null */
export function project(st: MoonState, mode: Orient, lat: number, lon: number): [number, number] | null {
  const b = basis(st, mode);
  const p: Vec3 = [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
  const r = toBody(st, b.r),
    u = toBody(st, b.u),
    f = toBody(st, b.f);
  if (dot(p, f) > -0.02) return null;
  return [dot(p, r), dot(p, u)];
}

/** 画面の点（月の半径を 1）から月面の緯度・経度 [°]。円盤の外なら null */
export function unproject(st: MoonState, mode: Orient, x: number, y: number): [number, number] | null {
  const r2 = x * x + y * y;
  if (r2 >= 1) return null;
  const b = basis(st, mode);
  const z = Math.sqrt(1 - r2);
  const v: Vec3 = [
    x * b.r[0] + y * b.u[0] - z * b.f[0],
    x * b.r[1] + y * b.u[1] - z * b.f[1],
    x * b.r[2] + y * b.u[2] - z * b.f[2],
  ];
  const p = toBody(st, v);
  return [Math.asin(Math.max(-1, Math.min(1, p[2]))) / D, Math.atan2(p[1], p[0]) / D];
}

/** 月面の点での太陽の高度 [°]（球面に対して） */
export function sunAltAt(st: MoonState, lat: number, lon: number): number {
  const s = toBody(st, unit(sub(st.sun, st.moon)));
  const p: Vec3 = [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
  return Math.asin(Math.max(-1, Math.min(1, dot(p, s)))) / D;
}

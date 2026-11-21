/**
 * 板の見え方: 拡大・見る方位。ホイールで拡大（カーソルの所を止めたまま）、右ボタンのドラッグで回す。
 * 拡大は画角を狭めて写る範囲をずらす。範囲は拡大前の画面の外へ出さない
 */
import { AZ, type Camera } from './render';

export interface View {
  /** 拡大率（1〜ZOOM_MAX） */
  z: number;
  /** 画面の中心に来る点（拡大前の画面の座標。縦の端が ±1、横は縦横比を掛ける） */
  cx: number;
  cy: number;
  /** 見る方位 [°] */
  az: number;
}

export const ZOOM_MAX = 8;
export const HOME: Readonly<View> = { z: 1, cx: 0, cy: 0, az: AZ };

export const isHome = (v: View): boolean => v.z === 1 && v.az === AZ;

/** 中心を拡大前の画面の内側に収める */
function clampCenter(v: View, asp: number): View {
  const k = 1 - 1 / v.z,
    cl = (x: number, m: number) => Math.max(-m, Math.min(m, x));
  return { ...v, cx: cl(v.cx, asp * k), cy: cl(v.cy, k) };
}

/** 画面の点 (sx, sy)（縦の端が ±1、横は縦横比を掛けた座標）を止めたまま f 倍に拡大する */
export function zoomAt(v: View, sx: number, sy: number, f: number, asp: number): View {
  const z = Math.max(1, Math.min(ZOOM_MAX, v.z * f)),
    bx = sx / v.z + v.cx,
    by = sy / v.z + v.cy;
  return clampCenter({ ...v, z, cx: bx - sx / z, cy: by - sy / z }, asp);
}

/** 拡大前のカメラに拡大を当てる */
export function applyView(base: Camera, v: View): Camera {
  return { ...base, th: base.th / v.z, ox: v.z * (v.cx + base.ox), oy: v.z * (v.cy + base.oy) };
}

/** 方位を -180〜180° に収める */
export const wrapAz = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * 陸地のデータ（Natural Earth、パブリックドメイン）: 輪郭の描画と、正距円筒の陸地の網（画素ごとの判定に使う）
 *
 * 輪郭は [経度×100, 緯度×100, …] の整数の並びで持つ。±180° をまたぐ輪郭は Natural Earth の側で切ってある
 */
import { D2R, type Projection } from './geo';

export type Rings = number[][];

/** 輪郭を投影して Path2D にする。経度で続く地図は ±360° ずらした分も足す */
export function ringsPath(proj: Projection, rings: Rings): Path2D {
  const path = new Path2D();
  const raw = proj.raw;
  const shifts = raw ? [-360, 0, 360] : [0];
  for (const sh of shifts) {
    for (const r of rings) {
      let started = false;
      for (let n = 0; n < r.length; n += 2) {
        const lon = r[n] / 100;
        const lat = r[n + 1] / 100;
        // 正距円筒は中心から ±180° の外へも描く（ずらした分と合わせて画面を埋める）
        const q = raw ? raw(lat * D2R, (lon + sh) * D2R) : proj.fwd(lat * D2R, lon * D2R);
        if (!q) {
          started = false;
          continue;
        }
        if (started) path.lineTo(q[0], q[1]);
        else {
          path.moveTo(q[0], q[1]);
          started = true;
        }
      }
      if (started) path.closePath();
    }
  }
  return path;
}

/** 陸地の網: 正距円筒（経度 −180〜180°、緯度 90〜−90°）の w × h の 0/1 */
export interface LandMask {
  w: number;
  h: number;
  data: Uint8Array;
}

export function landMask(rings: Rings, w = 4096, h = 2048): LandMask {
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = '#fff';
  const p = new Path2D();
  for (const r of rings) {
    for (let n = 0; n < r.length; n += 2) {
      const x = ((r[n] / 100 + 180) / 360) * w;
      const y = ((90 - r[n + 1] / 100) / 180) * h;
      if (n === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    p.closePath();
  }
  ctx.fill(p);
  const img = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let k = 0; k < data.length; k++) data[k] = img[k * 4] > 127 ? 1 : 0;
  return { w, h, data };
}

export function isLand(m: LandMask, lat: number, lon: number): boolean {
  let x = Math.floor(((lon / D2R + 180) / 360) * m.w) % m.w;
  if (x < 0) x += m.w;
  const y = Math.min(m.h - 1, Math.max(0, Math.floor(((90 - lat / D2R) / 180) * m.h)));
  return m.data[y * m.w + x] === 1;
}

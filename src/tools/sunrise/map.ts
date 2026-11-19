/**
 * 昼と夜の世界地図（正距円筒、拡大・移動でき東西はつながる）。画素ごとに太陽の高度の段で塗り、海岸線・経緯線・太陽が真上の地点・選んだ地点を重ねる。
 * 色はテーマに依らない
 */
import type { Rings } from '../solar-eclipse/land';
import { type SunEq, subsolar, THR } from './sun';

const D = Math.PI / 180;
export type RGB = readonly [number, number, number];
/** 段（昼・市民薄明・航海薄明・天文薄明・夜）ごとの陸と海の色 */
export const LANDC: readonly RGB[] = [
  [228, 220, 188],
  [154, 152, 160],
  [104, 106, 132],
  [70, 76, 104],
  [42, 48, 72],
];
export const OCEAN: readonly RGB[] = [
  [150, 186, 204],
  [98, 124, 158],
  [66, 86, 124],
  [44, 58, 94],
  [26, 34, 60],
];
export const rgb = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const STHR = THR.map((h) => Math.sin(h * D));

/** 地図の見え方: 拡大率 z と、真ん中からのずれ (x, y) [CSS px]。lib/planet/zoom.ts の PanZoom と同じ数え方 */
export interface MapView {
  z: number;
  x: number;
  y: number;
}
export const FULL: MapView = { z: 1, x: 0, y: 0 };

/** 見え方 v で、世界 1 周の幅・高さと、手前の写しの左上（経度 −180°・緯度 90°）の位置 [CSS px] */
function frameOf(w: number, h: number, v: MapView): { wz: number; hz: number; L: number; T: number } {
  const wz = w * v.z;
  const hz = h * v.z;
  return { wz, hz, L: w / 2 + v.x - wz / 2, T: h / 2 + v.y - hz / 2 };
}

/** 画面の点 (px, py) [CSS px] の緯度・経度 [°]。東西はつながるので、経度は −180〜180° に巻く */
export function lonLatAt(
  px: number,
  py: number,
  w: number,
  h: number,
  v: MapView = FULL,
): { lat: number; lon: number } {
  const f = frameOf(w, h, v);
  const u = (px - f.L) / f.wz;
  return { lat: 90 - ((py - f.T) / f.hz) * 180, lon: -180 + (u - Math.floor(u)) * 360 };
}

/** 縦は地図の外を見せないよう抑え、横は 1 周の範囲に巻く（PanZoom の bound に渡す） */
export function boundView(z: number, x: number, y: number, w: number, h: number): { x: number; y: number } {
  const wz = w * z;
  const lim = (h * Math.max(0, z - 1)) / 2;
  return { x: x - Math.round(x / wz) * wz, y: Math.max(-lim, Math.min(lim, y)) };
}

/** 海岸線の輪郭（経度 + 180、90 − 緯度 の座標。描くときに拡大する） */
export function coastPath(rings: Rings): Path2D {
  const p = new Path2D();
  for (const r of rings) {
    for (let n = 0; n < r.length; n += 2) {
      const x = r[n] / 100 + 180;
      const y = 90 - r[n + 1] / 100;
      if (n === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    p.closePath();
  }
  return p;
}

/** 太陽の印（円と 8 本の光） */
export function drawSunMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ffd23a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    ctx.moveTo(Math.cos(a) * (r + 2), Math.sin(a) * (r + 2));
    ctx.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6));
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffd23a';
  ctx.fill();
  ctx.strokeStyle = '#3a2a00';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** 縁取りした文字（地図・空の上の札） */
export function haloText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = `600 ${size}px system-ui,"Hiragino Sans","Noto Sans JP",sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(10,14,24,.85)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(s, x, y);
}

/** canvas の大きさを親の幅と cssH に合わせる（装置の画素は 2 倍まで） */
export function fitCanvas(
  cv: HTMLCanvasElement,
  cssH: (w: number) => number,
): { dpr: number; w: number; h: number; W: number; H: number; ctx: CanvasRenderingContext2D } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || cv.parentElement?.clientWidth || 300;
  const h = cssH(w);
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  cv.style.height = `${h}px`;
  return { dpr, w, h, W, H, ctx: cv.getContext('2d') as CanvasRenderingContext2D };
}

export interface MapInput {
  sun: SunEq;
  /** 海岸線（読み込むまでは null で、陸を塗らない） */
  coast: Path2D | null;
  pin: { lat: number; lon: number; name: string };
  view: MapView;
}

const imgs = new WeakMap<HTMLCanvasElement, ImageData>();
const lands = new WeakMap<HTMLCanvasElement, { key: string; a: Uint8Array }>();

/** 写しの番号の範囲: 画面に掛かる世界の写し（手前が 0、東が +1） */
function copies(w: number, f: { wz: number; L: number }): number[] {
  const ks: number[] = [];
  for (let k = Math.floor(-f.L / f.wz); k <= Math.floor((w - f.L) / f.wz); k++) ks.push(k);
  return ks;
}

/** 経度・緯度 [°] を海岸線の座標（経度 + 180、90 − 緯度）から装置の画素へ移す変換 */
function coastTransform(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  f: ReturnType<typeof frameOf>,
  k: number,
  dpr: number,
): void {
  ctx.setTransform((f.wz * dpr) / 360, 0, 0, (f.hz * dpr) / 180, (f.L + k * f.wz) * dpr, f.T * dpr);
}

/** 装置の画素ごとの陸（1）と海（0）。海岸線をその見え方で塗って読み戻すので、拡大しても粗くならない */
function landOf(
  cv: HTMLCanvasElement,
  coast: Path2D,
  W: number,
  H: number,
  w: number,
  dpr: number,
  f: ReturnType<typeof frameOf>,
): Uint8Array {
  const key = `${W}|${H}|${f.wz.toFixed(2)}|${(((f.L % f.wz) + f.wz) % f.wz).toFixed(2)}|${f.T.toFixed(2)}`;
  const c = lands.get(cv);
  if (c && c.key === key) return c.a;
  const oc = new OffscreenCanvas(W, H);
  const x = oc.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  x.fillStyle = '#fff';
  for (const k of copies(w, f)) {
    coastTransform(x, f, k, dpr);
    x.fill(coast);
  }
  const d = x.getImageData(0, 0, W, H).data;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  lands.set(cv, { key, a });
  return a;
}

/** 地図を描く。高さは幅の半分 */
export function drawMap(cv: HTMLCanvasElement, o: MapInput): void {
  const { dpr, w, h, W, H, ctx } = fitCanvas(cv, (w) => Math.round(w / 2));
  let img = imgs.get(cv);
  if (!img || img.width !== W || img.height !== H) {
    img = ctx.createImageData(W, H);
    imgs.set(cv, img);
  }
  const { sun } = o;
  const f = frameOf(w, h, o.view);
  const land = o.coast ? landOf(cv, o.coast, W, H, w, dpr, f) : null;
  const sd = Math.sin(sun.dec);
  const cd = Math.cos(sun.dec);
  /* 列ごとの時角の余弦 */
  const cosH = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const u = ((x + 0.5) / dpr - f.L) / f.wz;
    const lon = -180 + (u - Math.floor(u)) * 360;
    cosH[x] = Math.cos(sun.gha + lon * D);
  }
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const lat = Math.max(-90, Math.min(90, 90 - (((y + 0.5) / dpr - f.T) / f.hz) * 180));
    const a = Math.sin(lat * D) * sd;
    const b = Math.cos(lat * D) * cd;
    for (let x = 0; x < W; x++) {
      const v = a + b * cosH[x];
      const k = v >= STHR[0] ? 0 : v >= STHR[1] ? 1 : v >= STHR[2] ? 2 : v >= STHR[3] ? 3 : 4;
      const c = land?.[y * W + x] ? LANDC[k] : OCEAN[k];
      const i = (y * W + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  const ks = copies(w, f);
  if (o.coast) {
    ctx.lineWidth = (360 / (f.wz * dpr)) * 1.1;
    ctx.strokeStyle = 'rgba(20,28,40,.5)';
    for (const k of ks) {
      coastTransform(ctx, f, k, dpr);
      ctx.stroke(o.coast);
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  /** 経度・緯度の画面の位置（写し k の分） */
  const X = (lon: number, k: number) => f.L + k * f.wz + ((lon + 180) / 360) * f.wz;
  const Y = (lat: number) => f.T + ((90 - lat) / 180) * f.hz;
  ctx.strokeStyle = 'rgba(255,255,255,.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const k of ks)
    for (let lo = -180; lo < 180; lo += 30) {
      const x = X(lo, k);
      if (x < 0.5 || x > w - 0.5) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
  for (let la = -60; la <= 60; la += 30) {
    const y = Y(la);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  const ss = subsolar(sun);
  for (const k of ks) {
    const x = X(ss.lon, k);
    if (x > -20 && x < w + 20) drawSunMark(ctx, x, Y(ss.lat), 6);
  }
  const py = Y(o.pin.lat);
  for (const k of ks) {
    const px = X(o.pin.lon, k);
    if (px < -200 || px > w + 200) continue;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, 2 * Math.PI);
    ctx.fillStyle = '#bf4308';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    const right = px > w - 140;
    haloText(ctx, o.pin.name, px + (right ? -12 : 12), py, 13, right ? 'right' : 'left');
  }
}

/**
 * 昼と夜の世界地図（正距円筒）。画素ごとに太陽の高度の段で塗り、海岸線・経緯線・太陽が真上の地点・選んだ地点を重ねる。
 * 色はテーマに依らない
 */
import type { LandMask, Rings } from '../solar-eclipse/land';
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

/** 地図の画素 (x, y)（左上が 0）の中心の緯度・経度 [°] */
export function lonLatAt(x: number, y: number, w: number, h: number): { lat: number; lon: number } {
  return { lat: 90 - ((y + 0.5) * 180) / h, lon: -180 + ((x + 0.5) * 360) / w };
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
  mask: LandMask | null;
  coast: Path2D | null;
  pin: { lat: number; lon: number; name: string };
}

const imgs = new WeakMap<HTMLCanvasElement, ImageData>();

/** 地図を描く。高さは幅の半分 */
export function drawMap(cv: HTMLCanvasElement, o: MapInput): void {
  const { dpr, w, h, W, H, ctx } = fitCanvas(cv, (w) => Math.round(w / 2));
  let img = imgs.get(cv);
  if (!img || img.width !== W || img.height !== H) {
    img = ctx.createImageData(W, H);
    imgs.set(cv, img);
  }
  const { sun, mask } = o;
  const sd = Math.sin(sun.dec);
  const cd = Math.cos(sun.dec);
  /* 列ごとの時角の余弦と、陸の網の列 */
  const cosH = new Float32Array(W);
  const mx = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const lon = -180 + ((x + 0.5) * 360) / W;
    cosH[x] = Math.cos(sun.gha + lon * D);
    if (mask) mx[x] = Math.min(mask.w - 1, Math.floor(((lon + 180) / 360) * mask.w));
  }
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / H;
    const a = Math.sin(lat * D) * sd;
    const b = Math.cos(lat * D) * cd;
    const row = mask ? Math.min(mask.h - 1, Math.floor(((90 - lat) / 180) * mask.h)) * mask.w : 0;
    for (let x = 0; x < W; x++) {
      const v = a + b * cosH[x];
      const k = v >= STHR[0] ? 0 : v >= STHR[1] ? 1 : v >= STHR[2] ? 2 : v >= STHR[3] ? 3 : 4;
      const c = mask?.data[row + mx[x]] ? LANDC[k] : OCEAN[k];
      const i = (y * W + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  if (o.coast) {
    ctx.setTransform(W / 360, 0, 0, H / 180, 0, 0);
    ctx.lineWidth = (360 / W) * 1.1;
    ctx.strokeStyle = 'rgba(20,28,40,.5)';
    ctx.stroke(o.coast);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lo = -150; lo < 180; lo += 30) {
    const x = ((lo + 180) / 360) * w;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let la = -60; la <= 60; la += 30) {
    const y = ((90 - la) / 180) * h;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  const ss = subsolar(sun);
  drawSunMark(ctx, ((ss.lon + 180) / 360) * w, ((90 - ss.lat) / 180) * h, 6);
  const px = ((o.pin.lon + 180) / 360) * w;
  const py = ((90 - o.pin.lat) / 180) * h;
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

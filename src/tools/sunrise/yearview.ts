/**
 * 地点の 1 年の図: 横は 1 月 1 日〜12 月 31 日、縦は現地の 0〜24 時（上が 0 時）。
 * 各点を地図と同じ段の色で塗り、今の日時に縦と横の線を引く
 */
import { fitCanvas, LANDC } from './map';
import { ROWS } from './year';

export interface YearGeom {
  /** 図の左上と幅・高さ [CSS px] */
  L: number;
  T: number;
  pw: number;
  ph: number;
  nd: number;
  year: number;
}

/** 図の上の点 (x, y) の日（0 が 1 月 1 日）と現地の分。図の外は null */
export function yearPick(x: number, y: number, g: YearGeom): { day: number; min: number } | null {
  const u = x - g.L;
  const v = y - g.T;
  if (u < 0 || u > g.pw || v < 0 || v > g.ph) return null;
  return { day: Math.min(g.nd - 1, Math.floor((u / g.pw) * g.nd)), min: Math.min(1439, Math.floor((v / g.ph) * 1440)) };
}

export interface YearInput {
  grid: { nd: number; cells: Uint8Array };
  year: number;
  /** 今の日（0 が 1 月 1 日）と現地の分 */
  cur: { day: number; min: number };
  /** 現地の分を、表示の時間帯の目盛りの文字にする */
  label: (localMin: number) => string;
}

const imgs = new WeakMap<object, HTMLCanvasElement>();
function gridImage(g: { nd: number; cells: Uint8Array }): HTMLCanvasElement {
  let c = imgs.get(g);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = g.nd;
  c.height = ROWS;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const img = x.createImageData(g.nd, ROWS);
  for (let i = 0; i < g.cells.length; i++) {
    const col = LANDC[g.cells[i]];
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  imgs.set(g, c);
  return c;
}

export function drawYear(cv: HTMLCanvasElement, o: YearInput): YearGeom {
  const f = fitCanvas(cv, (w) => (w < 560 ? 220 : 260));
  const { ctx, w, h } = f;
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const g: YearGeom = { L: 44, T: 6, pw: w - 44 - 8, ph: h - 6 - 22, nd: o.grid.nd, year: o.year };
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(gridImage(o.grid), g.L, g.T, g.pw, g.ph);
  const fg = getComputedStyle(cv).color;
  ctx.fillStyle = fg;
  ctx.font = '13px system-ui,"Hiragino Sans","Noto Sans JP",sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let m = 0; m <= 1440; m += 360) {
    const y = g.T + (m / 1440) * g.ph;
    ctx.fillText(o.label(m), g.L - 6, y);
    ctx.fillRect(g.L - 4, y - 0.5, 4, 1);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const y0 = Date.UTC(o.year, 0, 1);
  for (let mo = 0; mo < 12; mo++) {
    const d = (Date.UTC(o.year, mo, 1) - y0) / 864e5;
    const x = g.L + (d / g.nd) * g.pw;
    ctx.fillRect(x - 0.5, g.T + g.ph, 1, 4);
    if (w >= 560 || mo % 2 === 0) ctx.fillText(`${mo + 1}月`, x + (g.pw / g.nd) * 15, g.T + g.ph + 6);
  }
  const cx = g.L + ((o.cur.day + 0.5) / g.nd) * g.pw;
  const cy = g.T + (o.cur.min / 1440) * g.ph;
  ctx.strokeStyle = '#bf4308';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, g.T);
  ctx.lineTo(cx, g.T + g.ph);
  ctx.moveTo(g.L, cy);
  ctx.lineTo(g.L + g.pw, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
  ctx.fillStyle = '#bf4308';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  return g;
}

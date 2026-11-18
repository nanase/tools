/**
 * プリズムとレンズのページの描画。光線を浮動小数の画像に足し込み（線の太さの分だけ画素に配る）、
 * 1 − exp(−v) で明るさを丸めて黒地に出す。部品と選んだ印はその上に Canvas 2D で描く
 */
import { cssOf, enc, LUT } from './color';
import { type Edge, geom, isSource, knob, type Part, radius, toWorld } from './optics';

/** 図の座標（0.1 mm）と画面の対応 */
export interface View {
  /** 図の 1 単位が CSS の何 px か */
  S: number;
  cssW: number;
  cssH: number;
  dpr: number;
}
export const KNOB_GAP = 18;
/** 選んだ印・つまみの色（黒地に合わせた橙） */
export const ACC = '#ff8a4c';
const NB = 90;

export class Light {
  W = 0;
  H = 0;
  acc = new Float32Array(0);
  img: ImageData | null = null;
  /** 足し込んだ回数（1 回は光源ごとに N 本） */
  passes = 0;
  rays = 0;
  /** スクリーンに当たった光（部品の id ごとに 90 区間 × RGB） */
  bins = new Map<number, Float32Array>();

  resize(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    this.W = W;
    this.H = H;
    this.acc = new Float32Array(W * H * 3);
    this.img = ctx.createImageData(W, H);
    this.clear();
  }
  clear(): void {
    this.acc.fill(0);
    this.bins.clear();
    this.passes = 0;
    this.rays = 0;
  }
  /** 線分を足し込む（座標は画素、hw は太さの半分）。長さあたりの強さが I になるよう、列ごとに配る */
  line(x0: number, y0: number, x1: number, y1: number, w: readonly number[], I: number, hw: number): void {
    let dx = x1 - x0,
      dy = y1 - y0;
    const steep = Math.abs(dy) > Math.abs(dx);
    if (steep) {
      [x0, y0] = [y0, x0];
      [x1, y1] = [y1, x1];
    }
    if (x0 > x1) {
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
    }
    dx = x1 - x0;
    dy = y1 - y0;
    if (dx < 1e-6) return;
    const { W, H, acc } = this,
      sl = dy / dx,
      len = Math.sqrt(1 + sl * sl),
      hm = hw * len,
      XM = steep ? H : W,
      YM = steep ? W : H,
      xs = Math.max(0, Math.ceil(x0)),
      xe = Math.min(XM - 1, Math.floor(x1)),
      k = (I * len) / (2 * hm),
      wr = w[0] * k,
      wg = w[1] * k,
      wb = w[2] * k;
    for (let x = xs; x <= xe; x++) {
      const y = y0 + sl * (x - x0),
        a = y - hm,
        b = y + hm,
        p0 = Math.max(0, Math.floor(a)),
        p1 = Math.min(YM - 1, Math.floor(b));
      for (let p = p0; p <= p1; p++) {
        const cov = Math.min(b, p + 1) - Math.max(a, p);
        if (cov <= 0) continue;
        const i = (steep ? x * W + p : p * W + x) * 3;
        acc[i] += wr * cov;
        acc[i + 1] += wg * cov;
        acc[i + 2] += wb * cov;
      }
    }
  }
  /** スクリーンに当たった光を足す */
  screen(e: Edge, s: number, w: readonly number[], I: number): void {
    let b = this.bins.get(e.obj.id);
    if (!b) {
      b = new Float32Array(NB * 3);
      this.bins.set(e.obj.id, b);
    }
    const f = s * (NB - 1),
      i0 = Math.floor(f),
      fr = f - i0;
    for (const [i, t] of [
      [i0, 1 - fr],
      [i0 + 1, fr],
    ])
      if (i >= 0 && i < NB) for (let k = 0; k < 3; k++) b[i * 3 + k] += w[k] * I * t;
  }
  /** 画像に出す（scale は明るさの倍率） */
  present(ctx: CanvasRenderingContext2D, scale: number): void {
    const img = this.img;
    if (!img) return;
    const d = img.data,
      n = this.W * this.H,
      acc = this.acc,
      sc = scale * 256;
    for (let i = 0, j = 0, q = 0; i < n; i++, j += 3, q += 4) {
      let v = acc[j] * sc;
      d[q] = LUT[v > 2047 ? 2047 : v | 0];
      v = acc[j + 1] * sc;
      d[q + 1] = LUT[v > 2047 ? 2047 : v | 0];
      v = acc[j + 2] * sc;
      d[q + 2] = LUT[v > 2047 ? 2047 : v | 0];
      d[q + 3] = 255;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
  }
}

/** 部品・スクリーンに映った色・選んだ印を描く */
export function drawParts(
  ctx: CanvasRenderingContext2D,
  v: View,
  parts: readonly Part[],
  sel: Part | null,
  light: Light,
  rotating: boolean,
  ev: number,
): void {
  ctx.setTransform(v.dpr * v.S, 0, 0, v.dpr * v.S, (v.dpr * v.cssW) / 2, (v.dpr * v.cssH) / 2);
  const px = 1 / v.S;
  for (const o of parts) {
    ctx.save();
    if (isSource(o.t)) {
      ctx.translate(o.x, o.y);
      ctx.rotate((o.ang * Math.PI) / 180);
      const col = o.white ? '#f4f4f4' : cssOf(o.lam);
      ctx.lineWidth = 1.2 * px;
      if (o.t === 'lamp') {
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, 7);
        ctx.fillStyle = '#2a2f36';
        ctx.fill();
        ctx.strokeStyle = '#8d96a0';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, 7);
        ctx.fillStyle = col;
        ctx.fill();
      } else {
        const hh = o.t === 'beam' ? o.w / 2 + 3 : 7,
          x0 = o.t === 'beam' ? (o.w > 60 ? 6 : -16) : -26;
        ctx.fillStyle = '#2a2f36';
        ctx.strokeStyle = '#8d96a0';
        ctx.beginPath();
        ctx.rect(x0, -hh, 20 - x0, 2 * hh);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5 * px;
        ctx.beginPath();
        ctx.moveTo(20, -hh + 2);
        ctx.lineTo(20, hh - 2);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    const g = geom(o),
      W = g.P.map(([x, y]) => toWorld(o, x, y));
    ctx.beginPath();
    for (const [i, [x, y]] of W.entries()) {
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    if (g.closed) {
      ctx.closePath();
      ctx.fillStyle = o.mat === 'water' ? 'rgba(110,160,255,.10)' : 'rgba(150,185,230,.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(195,212,235,.55)';
      ctx.lineWidth = px;
      ctx.stroke();
      /* ガラスの中の鏡の面（ペンタプリズム） */
      if (g.kinds) {
        ctx.strokeStyle = '#c3ccd6';
        ctx.lineWidth = 3 * px;
        ctx.beginPath();
        g.kinds.forEach((k, i) => {
          if (k !== 'mirror') return;
          const p0 = W[i],
            p1 = W[(i + 1) % W.length];
          ctx.moveTo(p0[0], p0[1]);
          ctx.lineTo(p1[0], p1[1]);
        });
        ctx.stroke();
      }
    } else if (o.t === 'screen') {
      ctx.strokeStyle = '#4a5059';
      ctx.lineWidth = 7 * px;
      ctx.lineCap = 'butt';
      ctx.stroke();
      screenBand(ctx, o, W, light, ev, px);
    } else if (o.t === 'half') {
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeStyle = 'rgba(205,214,224,.85)';
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#c3ccd6';
      ctx.lineWidth = 3 * px;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (sel) drawSel(ctx, sel, px, rotating);
}

/** スクリーンに映った色の並び（いちばん明るい所に合わせて明るさを決める） */
function screenBand(
  ctx: CanvasRenderingContext2D,
  o: Part,
  W: [number, number][],
  light: Light,
  ev: number,
  px: number,
): void {
  const b = light.bins.get(o.id);
  if (!b) return;
  let mx = 1e-9;
  for (let i = 0; i < b.length; i++) mx = Math.max(mx, b[i]);
  const sc = (2.2 * 2 ** ev) / mx,
    a = W[0],
    c = W[W.length - 1];
  ctx.lineWidth = 5 * px;
  for (let i = 0; i < NB; i++) {
    const col = [0, 1, 2].map((k) => Math.round(enc(1 - Math.exp(-b[i * 3 + k] * sc)) * 255));
    if (col[0] + col[1] + col[2] < 6) continue;
    const s0 = i / NB,
      s1 = (i + 1) / NB;
    ctx.strokeStyle = `rgb(${col.join(',')})`;
    ctx.beginPath();
    ctx.moveTo(a[0] + (c[0] - a[0]) * s0, a[1] + (c[1] - a[1]) * s0);
    ctx.lineTo(a[0] + (c[0] - a[0]) * s1, a[1] + (c[1] - a[1]) * s1);
    ctx.stroke();
  }
}

/** 選んだ部品の輪と回すつまみ。回している間は角度を出す */
function drawSel(ctx: CanvasRenderingContext2D, o: Part, px: number, rotating: boolean): void {
  const r = radius(o) + KNOB_GAP,
    [kx, ky] = knob(o, KNOB_GAP);
  ctx.save();
  ctx.strokeStyle = ACC;
  ctx.fillStyle = ACC;
  ctx.lineWidth = 1.2 * px;
  ctx.setLineDash([4 * px, 4 * px]);
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(o.x, o.y, r, 0, 7);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(kx, ky);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(kx, ky, 7 * px, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(o.x, o.y, 3 * px, 0, 7);
  ctx.fill();
  if (rotating) {
    const t = `${Math.round(o.ang)}°`;
    ctx.font = `600 ${15 * px}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = '#000';
    ctx.strokeText(t, kx, ky - 11 * px);
    ctx.fillStyle = '#fff';
    ctx.fillText(t, kx, ky - 11 * px);
  }
  ctx.restore();
}

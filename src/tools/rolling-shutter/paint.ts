/**
 * 背景と部品の絵を Canvas 2D で描くための道具。単位は m で、y は上向き（mctx が変換を入れる）
 */

/** 種から決まる乱数（mulberry32） */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 左下 (x0, y0)・幅 w [m] の範囲を、キャンバス全体に y を上向きにして描く */
export function mctx(c: HTMLCanvasElement, x0: number, y0: number, w: number): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d');
  const s = c.width / w;
  const h = c.height / s;
  ctx.setTransform(s, 0, 0, -s, -x0 * s, (y0 + h) * s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return ctx;
}

export type Stop = readonly [number, string];
export function grad(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: readonly Stop[],
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
export function radial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stops: readonly Stop[],
): CanvasGradient {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export type Pt = readonly [number, number];
export function poly(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
export function fillPoly(ctx: CanvasRenderingContext2D, pts: readonly Pt[], fill: string | CanvasGradient): void {
  poly(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
}
export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
export function fillRr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
): void {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}
export function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  col: string,
): void {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}
/** 点を順につなぐ太い線（手足など） */
export function limb(ctx: CanvasRenderingContext2D, pts: readonly Pt[], w: number, col: string): void {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}
export function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string | CanvasGradient,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
export function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number,
  fill: string | CanvasGradient,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}
/** 上下を戻して文字を書く（size は m） */
export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  col: string,
  weight = 700,
  font = 'system-ui, "Segoe UI", sans-serif',
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.fillStyle = col;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, 0, 0);
  ctx.restore();
}
/** 小さな点をまく（砂利・アスファルト・草の地肌） */
export function speckle(
  ctx: CanvasRenderingContext2D,
  R: () => number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  n: number,
  cols: readonly string[],
  sz: number,
): void {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cols[(R() * cols.length) | 0];
    ctx.fillRect(x0 + R() * w, y0 + R() * h, sz * (0.6 + R()), sz * (0.5 + R() * 0.8));
  }
}
export function sky(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  top: string,
  bottom: string,
): void {
  ctx.fillStyle = grad(ctx, 0, y0 + h, 0, y0, [
    [0, top],
    [1, bottom],
  ]);
  ctx.fillRect(x0, y0, w, h);
}
export function cloud(ctx: CanvasRenderingContext2D, R: () => number, x: number, y: number, s: number): void {
  for (let i = 0; i < 9; i++) {
    const cx = x + (R() - 0.5) * s * 2.2;
    const cy = y + (R() - 0.3) * s * 0.5;
    const r = s * (0.35 + R() * 0.45);
    disc(
      ctx,
      cx,
      cy,
      r,
      radial(ctx, cx, cy, r, [
        [0, 'rgba(255,255,255,.75)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
    );
  }
}
/** 遠くの家並み */
export function houses(
  ctx: CanvasRenderingContext2D,
  R: () => number,
  x0: number,
  x1: number,
  base: number,
  hmin: number,
  hmax: number,
  pal: readonly string[],
): void {
  for (let x = x0; x < x1; ) {
    const w = 3 + R() * 4.5;
    const h = hmin + R() * (hmax - hmin);
    ctx.fillStyle = pal[(R() * pal.length) | 0];
    ctx.fillRect(x, base, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    ctx.fillRect(x + w * 0.82, base, w * 0.18, h);
    if (R() < 0.6)
      fillPoly(
        ctx,
        [
          [x - 0.25, base + h],
          [x + w / 2, base + h + 0.9 + R() * 0.6],
          [x + w + 0.25, base + h],
        ],
        R() < 0.5 ? '#6b5d55' : '#596470',
      );
    else {
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(x - 0.05, base + h - 0.12, w + 0.1, 0.12);
    }
    for (let wy = base + 0.6; wy < base + h - 0.6; wy += 1.25)
      for (let wx = x + 0.45; wx < x + w - 0.6; wx += 1.05)
        if (R() < 0.75) {
          ctx.fillStyle = R() < 0.2 ? '#c9d2d8' : '#7d8b96';
          ctx.fillRect(wx, wy, 0.55, 0.62);
        }
    x += w + 0.2 + R() * 1.2;
  }
}
/** 丸い葉の木 */
export function tree(
  ctx: CanvasRenderingContext2D,
  R: () => number,
  x: number,
  y: number,
  s: number,
  col: string,
): void {
  for (let i = 0; i < 6; i++) disc(ctx, x + (R() - 0.5) * s, y + R() * s * 0.8, s * (0.35 + R() * 0.25), col);
}
/** 遠くの山並み（y は x の関数） */
export function ridge(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  base: number,
  f: (x: number) => number,
  col: string,
  step = 0.25,
): void {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x0, base);
  for (let x = x0; x <= x1 + 1e-9; x += step) ctx.lineTo(x, f(x));
  ctx.lineTo(x1, base);
  ctx.fill();
}

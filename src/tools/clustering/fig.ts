/** クラスタリングの図（canvas）。計算の記録した部品を描き、右に樹形図・到達可能距離・決定グラフを添える */
import { ACC, bisectors, type Data, type Frame, INK, NOISE, type Rect, type Run, type Side, SMALL } from './core';
import { BOX } from './data';

interface Colors {
  screen: string;
  ink: string;
  text: string;
  text2: string;
  grid2: string;
  accent: string;
  pal: string[];
  rgb: [number, number, number][];
}
let C: Colors;

const hexRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** テーマの色を読み直す（テーマを変えたとき） */
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    g = (k: string) => s.getPropertyValue(k).trim(),
    pal = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => g(`--cl-${i}`));
  C = {
    screen: g('--screen'),
    ink: g('--screen-ink'),
    text: g('--ink'),
    text2: g('--ink-2'),
    grid2: g('--grid-2'),
    accent: g('--accent'),
    pal,
    rgb: pal.map(hexRgb),
  };
  regCache = new WeakMap();
}
const colOf = (c: number): string => (c === ACC ? C.accent : c >= 0 && c < 8 ? C.pal[c] : C.ink);
const rgbOf = (c: number): [number, number, number] =>
  c === ACC ? hexRgb(C.accent) : c >= 0 && c < 8 ? C.rgb[c] : hexRgb(C.ink);

/* ---------- 座標 ---------- */
interface Map2 {
  s: number;
  x: (v: number) => number;
  y: (v: number) => number;
}
/** 箱の座標を図の座標へ。縦横の比は保つ */
export function boxMap(W: number, H: number, pad: number): Map2 {
  const s = Math.min((W - 2 * pad) / BOX.w, (H - 2 * pad) / BOX.h),
    ox = (W - BOX.w * s) / 2,
    oy = (H - BOX.h * s) / 2;
  return { s, x: (v) => ox + v * s, y: (v) => oy + v * s };
}
/** 図の座標を箱の座標へ */
export function toBox(W: number, H: number, px: number, py: number): [number, number] {
  const m = boxMap(W, H, 14);
  return [(px - m.x(0)) / m.s, (py - m.y(0)) / m.s];
}

/* ---------- 点 ---------- */
/* クラスタごとに形も変える。色だけに頼らないため。0 は丸、ほかは多角形の [辺の数, 回転, 大きさ] */
const SHAPES: readonly ([number, number, number] | null)[] = [
  null,
  [4, Math.PI / 4, 1.28],
  [3, -Math.PI / 2, 1.42],
  [4, 0, 1.2],
  [3, Math.PI / 2, 1.42],
  [5, -Math.PI / 2, 1.2],
  [6, -Math.PI / 2, 1.2],
  [8, -Math.PI / 2, 1.2],
];
function mark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: number, thumb: boolean): void {
  const sh = thumb || c < 0 ? null : SHAPES[c % 8];
  if (!sh) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    return;
  }
  const [n, a0, sc] = sh,
    rr = r * sc;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i * 2 * Math.PI) / n,
      px = x + rr * Math.cos(a),
      py = y + rr * Math.sin(a);
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
}
/** 凡例と計算結果に出す、クラスタの印の SVG */
export function markerSvg(c: number, size = 12): string {
  const sh = SHAPES[c % 8],
    r = 4,
    m = 6;
  let d = `M${m + r} ${m}A${r} ${r} 0 1 1 ${m - r} ${m}A${r} ${r} 0 1 1 ${m + r} ${m}Z`;
  if (sh) {
    const [n, a0, sc] = sh;
    d = '';
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * 2 * Math.PI) / n;
      d += `${i ? 'L' : 'M'}${(m + r * sc * Math.cos(a)).toFixed(1)} ${(m + r * sc * Math.sin(a)).toFixed(1)}`;
    }
    d += 'Z';
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true"><path d="${d}" fill="var(--cl-${c % 8})"/></svg>`;
}

type Coord = ArrayLike<number>;
/** クラスタごとにまとめて塗る。label が −1 の点は色なし、−2 の点は描かない */
function points(
  ctx: CanvasRenderingContext2D,
  idx: readonly number[],
  xs: Coord,
  ys: Coord,
  m: Map2,
  label: (i: number) => number,
  r: number,
  thumb: boolean,
): void {
  const groups = new Map<number, number[]>();
  for (const i of idx) {
    const c = label(i),
      g = groups.get(c);
    if (g) g.push(i);
    else groups.set(c, [i]);
  }
  for (const [c, list] of groups) {
    if (c === -2) continue;
    ctx.beginPath();
    if (c < 0) {
      for (const i of list) mark(ctx, m.x(xs[i]), m.y(ys[i]), r * 0.82, -1, true);
      ctx.fillStyle = C.ink;
      ctx.globalAlpha = 0.72;
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    for (const i of list) mark(ctx, m.x(xs[i]), m.y(ys[i]), r, c, thumb);
    ctx.strokeStyle = C.screen;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = colOf(c);
    ctx.fill();
  }
}
const radius = (W: number, thumb: boolean): number =>
  thumb ? Math.max(1.4, Math.min(2.2, W / 90)) : Math.max(2.6, Math.min(3.6, W / 180));

/** 図の中の札。文字に画面の色の縁を付けて、点の上でも読めるようにする */
function tag(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: { a?: CanvasTextAlign; b?: boolean; c?: string; size?: number } = {},
): void {
  ctx.font = `${o.b ? 700 : 500} ${o.size ?? 13}px system-ui,"Segoe UI","Yu Gothic UI",Meiryo,sans-serif`;
  ctx.textAlign = o.a ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = C.screen;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = o.c ?? C.text;
  ctx.fillText(s, x, y);
}

/* ---------- 重心の領域 ---------- */
let regCache = new WeakMap<Frame, { key: string; cv: HTMLCanvasElement }>();
function regions(fr: Frame, W: number, H: number, m: Map2): HTMLCanvasElement {
  const key = `${W}x${H}`,
    got = regCache.get(fr);
  if (got?.key === key) return got.cv;
  const w = Math.ceil(W / 3),
    h = Math.ceil(H / 3),
    cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d') as CanvasRenderingContext2D,
    im = g.createImageData(w, h),
    cen = fr.cen ?? [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = (((x + 0.5) / w) * W - m.x(0)) / m.s,
        py = (((y + 0.5) / h) * H - m.y(0)) / m.s;
      let b = 0,
        v = Infinity;
      cen.forEach((q, c) => {
        const u = (px - q.x) ** 2 + (py - q.y) ** 2;
        if (u < v) {
          v = u;
          b = c;
        }
      });
      const rgb = rgbOf(cen[b]?.c ?? INK),
        o = (y * w + x) * 4;
      im.data[o] = rgb[0];
      im.data[o + 1] = rgb[1];
      im.data[o + 2] = rgb[2];
      im.data[o + 3] = 255;
    }
  g.putImageData(im, 0, 0);
  regCache.set(fr, { key, cv });
  return cv;
}

/** 領域の境界線の描き方: 薄い点線 */
function dotted(ctx: CanvasRenderingContext2D, draw: () => void): void {
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.text;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  draw();
  ctx.stroke();
  ctx.restore();
}
/** k-means の領域の境界 */
function regionLines(ctx: CanvasRenderingContext2D, fr: Frame, W: number, H: number, m: Map2): void {
  const s = bisectors(fr.cen ?? [], {
    x0: (0 - m.x(0)) / m.s,
    y0: (0 - m.y(0)) / m.s,
    x1: (W - m.x(0)) / m.s,
    y1: (H - m.y(0)) / m.s,
  });
  dotted(ctx, () => {
    for (let i = 0; i < s.length; i += 4) {
      ctx.moveTo(m.x(s[i]), m.y(s[i + 1]));
      ctx.lineTo(m.x(s[i + 2]), m.y(s[i + 3]));
    }
  });
}
/** 塗ったセルのまとまりの輪郭。隣が塗られていないか、別の色のセルとの間に引く */
function cellLines(ctx: CanvasRenderingContext2D, rect: readonly Rect[], m: Map2): void {
  const on = rect.filter((q) => q.a !== undefined && q.c !== INK);
  if (!on.length) return;
  const w = on[0].w,
    key = (x: number, y: number) => `${Math.round(x / w)},${Math.round(y / w)}`,
    at = new Map(on.map((q) => [key(q.x, q.y), q.c]));
  dotted(ctx, () => {
    for (const q of on) {
      const x0 = m.x(q.x),
        y0 = m.y(q.y),
        x1 = m.x(q.x + q.w),
        y1 = m.y(q.y + q.h),
        edge = (dx: number, dy: number, ax: number, ay: number, bx: number, by: number) => {
          /* 同じ辺を 2 度引かないよう、別の色の隣とは右と下の辺だけ引く */
          const c = at.get(key(q.x + dx * w, q.y + dy * w));
          if (c === undefined || (c !== q.c && dx + dy > 0)) {
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
        };
      edge(-1, 0, x0, y0, x0, y1);
      edge(1, 0, x1, y0, x1, y1);
      edge(0, -1, x0, y0, x1, y0);
      edge(0, 1, x0, y1, x1, y1);
    }
  });
}

/* ---------- 楕円 ---------- */
function ellipse(ctx: CanvasRenderingContext2D, m: Map2, x: number, y: number, s: readonly number[], k: number): void {
  const [a, b, e] = s,
    t = (a + e) / 2,
    q = Math.sqrt(Math.max(0, ((a - e) / 2) ** 2 + b * b)),
    l1 = Math.sqrt(Math.max(1e-9, t + q)),
    l2 = Math.sqrt(Math.max(1e-9, t - q));
  ctx.ellipse(m.x(x), m.y(y), k * l1 * m.s, k * l2 * m.s, 0.5 * Math.atan2(2 * b, a - e), 0, 2 * Math.PI);
}

/* ---------- 右の図 ---------- */
export interface SideBox {
  /** 散布図の幅 */
  sw: number;
  x0: number;
  x1: number;
  top: number;
  bot: number;
}
export const sideBox = (W: number, H: number): SideBox => {
  const sw = Math.round(W * 0.6);
  return { sw, x0: sw + 42, x1: W - 14, top: 26, bot: H - 20 };
};
/** 樹形図の高さの縮尺。低い結合が潰れないように 0.55 乗にする */
const HP = 0.55;
export const dendroY = (hMax: number, L: SideBox, h: number): number =>
  L.bot - Math.min(1, h / hMax) ** HP * (L.bot - L.top);
/** 図の y から、その切断で残るクラスタの数を求める */
export function dendroCut(side: Extract<Side, { type: 'dendro' }>, L: SideBox, py: number): number {
  const u = Math.min(1, Math.max(0, (L.bot - py) / (L.bot - L.top))),
    h = u ** (1 / HP) * side.hMax;
  let k = 1;
  for (const q of side.merges) if (q.h > h) k++;
  return k;
}
export function cutHeight(side: Extract<Side, { type: 'dendro' }>, n: number): number {
  const a = side.merges[n - side.k - 1]?.h ?? 0,
    b = side.merges[n - side.k]?.h ?? side.hMax;
  return (a + b) / 2;
}
function sideRule(ctx: CanvasRenderingContext2D, sw: number, H: number): void {
  ctx.strokeStyle = C.grid2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sw + 10, 8);
  ctx.lineTo(sw + 10, H - 8);
  ctx.stroke();
}
function drawDendro(
  ctx: CanvasRenderingContext2D,
  side: Extract<Side, { type: 'dendro' }>,
  fr: Frame,
  n: number,
  W: number,
  H: number,
): void {
  const L = sideBox(W, H),
    m = fr.m ?? 0,
    k = side.k,
    X = (v: number) => L.x0 + (v / (n - 1)) * (L.x1 - L.x0),
    Y = (nd: number) => (nd < n ? L.bot : dendroY(side.hMax, L, side.merges[nd - n].h));
  sideRule(ctx, L.sw, H);
  const byC = new Map<number, number[]>();
  for (let j = 0; j < m; j++) {
    const g = j < n - k ? side.nl[n + j] : INK,
      a = byC.get(g);
    if (a) a.push(j);
    else byC.set(g, [j]);
  }
  for (const [g, js] of byC) {
    ctx.beginPath();
    for (const j of js) {
      const q = side.merges[j],
        y = dendroY(side.hMax, L, q.h);
      ctx.moveTo(X(side.px[q.a]), Y(q.a));
      ctx.lineTo(X(side.px[q.a]), y);
      ctx.lineTo(X(side.px[q.b]), y);
      ctx.lineTo(X(side.px[q.b]), Y(q.b));
    }
    ctx.strokeStyle = colOf(g);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (m > 0 && !fr.done) {
    const q = side.merges[m - 1],
      y = dendroY(side.hMax, L, q.h);
    ctx.beginPath();
    ctx.moveTo(X(side.px[q.a]), y);
    ctx.lineTo(X(side.px[q.b]), y);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  /* 切断線。ドラッグで動かせる */
  const cy = dendroY(side.hMax, L, cutHeight(side, n));
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(L.x0 - 8, cy);
  ctx.lineTo(L.x1 + 4, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  tag(ctx, `切断　${k} 個`, L.x1 + 4, cy - 11, { a: 'right', b: true, c: C.accent });
  tag(ctx, '樹形図', L.x0 - 8, 13, { b: true });
  tag(ctx, '点', (L.x0 + L.x1) / 2, H - 9, { a: 'center', c: C.text2, size: 12 });
  ctx.save();
  ctx.translate(L.x0 - 17, (L.top + L.bot) / 2);
  ctx.rotate(-Math.PI / 2);
  tag(ctx, '結合の距離', 0, 0, { a: 'center', c: C.text2, size: 12 });
  ctx.restore();
}
function drawReach(
  ctx: CanvasRenderingContext2D,
  side: Extract<Side, { type: 'reach' }>,
  fr: Frame,
  labels: Int16Array,
  W: number,
  H: number,
): void {
  const L = sideBox(W, H),
    n = side.reach.length,
    mx = Math.max(...side.reach, side.cut) * 1.05,
    bw = (L.x1 - L.x0) / n,
    Y = (v: number) => L.bot - (v / mx) * (L.bot - L.top);
  sideRule(ctx, L.sw, H);
  for (let i = 0; i < (fr.pos ?? 0); i++) {
    const q = labels[side.order[i]];
    ctx.fillStyle = colOf(q < 0 ? INK : q);
    ctx.fillRect(L.x0 + i * bw, Y(side.reach[i]), Math.max(0.8, bw - 0.4), L.bot - Y(side.reach[i]));
  }
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(L.x0 - 8, Y(side.cut));
  ctx.lineTo(L.x1 + 4, Y(side.cut));
  ctx.stroke();
  ctx.setLineDash([]);
  tag(ctx, '到達可能距離', L.x0 - 8, 13, { b: true });
  tag(ctx, '閾値', L.x1 + 4, Y(side.cut) - 11, { a: 'right', b: true, c: C.accent });
  tag(ctx, '処理した順', (L.x0 + L.x1) / 2, H - 9, { a: 'center', c: C.text2, size: 12 });
}
function drawDecision(
  ctx: CanvasRenderingContext2D,
  side: Extract<Side, { type: 'decision' }>,
  fr: Frame,
  W: number,
  H: number,
): void {
  const L = sideBox(W, H),
    bot = H - 24,
    rmx = Math.max(...side.rho) * 1.05,
    dmx = Math.max(...side.delta) * 1.05,
    X = (v: number) => L.x0 + (v / rmx) * (L.x1 - L.x0),
    Y = (v: number) => bot - (v / dmx) * (bot - L.top);
  sideRule(ctx, L.sw, H);
  ctx.strokeStyle = C.grid2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L.x0, L.top);
  ctx.lineTo(L.x0, bot);
  ctx.lineTo(L.x1, bot);
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  for (let i = 0; i < side.rho.length; i++) {
    ctx.moveTo(X(side.rho[i]) + 2.2, Y(side.delta[i]));
    ctx.arc(X(side.rho[i]), Y(side.delta[i]), 2.2, 0, 2 * Math.PI);
  }
  ctx.fill();
  if (fr.pick)
    side.centers.forEach((c, q) => {
      ctx.beginPath();
      ctx.arc(X(side.rho[c]), Y(side.delta[c]), 6, 0, 2 * Math.PI);
      ctx.fillStyle = colOf(side.cc[q]);
      ctx.fill();
    });
  tag(ctx, '高密度の点までの距離', L.x0 - 8, 13, { b: true });
  tag(ctx, '密度', (L.x0 + L.x1) / 2, H - 9, { a: 'center', c: C.text2, size: 12 });
}

/* ---------- 図の全体 ---------- */
/** 描く準備: 大きさを合わせて消す */
export function prepare(cv: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const dpr = Math.min(2, devicePixelRatio || 1),
    W = cv.clientWidth,
    H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return [ctx, W, H];
}

export interface DrawOpt {
  thumb?: boolean;
  /** 領域の地の色と境界線。小さい図は true のときだけ描く（比較のマス。一覧としくみは描かない） */
  regions?: boolean;
}
/** 1 コマを描く */
export function drawRun(cv: HTMLCanvasElement, run: Run, fi: number, o: DrawOpt = {}): void {
  const [ctx, W, H] = prepare(cv);
  if (!W || !H) return;
  const fr = run.frames[fi],
    d = fr.all && run.full ? run.full : run.d,
    thumb = !!o.thumb,
    side = thumb ? undefined : run.side,
    sw = side ? sideBox(W, H).sw : W,
    m = boxMap(sw, H, thumb ? 4 : 14),
    r = radius(sw, thumb),
    all = Array.from({ length: d.n }, (_, i) => i);
  const showReg = thumb ? o.regions === true : o.regions !== false;
  if (fr.reg && showReg) {
    ctx.globalAlpha = C.rgb[0][0] > 60 ? 0.16 : 0.11;
    ctx.drawImage(regions(fr, W, H, m), 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  for (const q of fr.rect ?? []) {
    const x = m.x(q.x),
      y = m.y(q.y),
      w = q.w * m.s,
      h = q.h * m.s;
    if (q.a === undefined) {
      if (thumb) continue;
      ctx.strokeStyle = C.grid2;
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x, y, w, h);
    } else {
      const [a, b, e] = rgbOf(q.c);
      ctx.fillStyle = `rgba(${a},${b},${e},${q.a})`;
      ctx.fillRect(x, y, w + 0.5, h + 0.5);
    }
  }
  if (fr.rect && (!thumb || o.regions !== undefined)) cellLines(ctx, fr.rect, m);
  if (fr.reg && showReg) regionLines(ctx, fr, W, H, m);
  for (const q of fr.seg ?? []) {
    if (!q.d.length || (thumb && q.big)) continue;
    ctx.beginPath();
    for (let i = 0; i < q.d.length; i += 4) {
      ctx.moveTo(m.x(q.d[i]), m.y(q.d[i + 1]));
      ctx.lineTo(m.x(q.d[i + 2]), m.y(q.d[i + 3]));
    }
    ctx.strokeStyle = colOf(q.c);
    ctx.lineWidth = q.w * (thumb ? 0.6 : 1);
    ctx.globalAlpha = q.a ?? 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  /* 階層: 切断より下の結合の線 */
  if (run.side?.type === 'dendro') drawLinks(ctx, run, run.side, fr, m, thumb);
  const xs: Coord = fr.x ?? d.x,
    ys: Coord = fr.y ?? d.y;
  if (fr.x && !thumb) points(ctx, all, d.x, d.y, m, () => -1, r * 0.55, true);
  drawPoints(ctx, run, fr, d, all, xs, ys, m, r, thumb);
  for (const q of fr.ell ?? []) {
    ctx.strokeStyle = colOf(q.c);
    ctx.lineWidth = thumb ? 1.1 : 2.2;
    ctx.beginPath();
    ellipse(ctx, m, q.x, q.y, q.s, 1);
    ctx.stroke();
    ctx.setLineDash(thumb ? [2, 2] : [5, 4]);
    ctx.lineWidth = thumb ? 0.8 : 1.3;
    ctx.beginPath();
    ellipse(ctx, m, q.x, q.y, q.s, 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const q of fr.circ ?? []) {
    ctx.beginPath();
    ctx.arc(m.x(q.x), m.y(q.y), q.r * m.s, 0, 2 * Math.PI);
    ctx.strokeStyle = colOf(q.c);
    ctx.lineWidth = q.thin ? 0.8 : thumb ? 0.9 : 1.6;
    ctx.stroke();
  }
  for (const q of fr.cen ?? []) drawCen(ctx, q.x, q.y, q.c, q.t, m, thumb);
  if (thumb) return;
  for (const q of fr.tag ?? []) {
    const py = m.y(q.y) + (q.ry ?? 0) * m.s + (q.dy ?? 0);
    tag(ctx, q.s, m.x(q.x) + (q.dx ?? 0), py, { b: true, c: q.c === undefined ? C.text : colOf(q.c) });
  }
  if ((fr.ax ?? 0) > 0.4) {
    tag(ctx, '第 2 固有ベクトル →', sw / 2, H - 10, { a: 'center', c: C.text2, size: 12 });
    ctx.save();
    ctx.translate(11, H / 2);
    ctx.rotate(-Math.PI / 2);
    tag(ctx, '第 3 固有ベクトル →', 0, 0, { a: 'center', c: C.text2, size: 12 });
    ctx.restore();
  }
  if (side?.type === 'dendro') drawDendro(ctx, side, fr, d.n, W, H);
  if (side?.type === 'reach') drawReach(ctx, side, fr, run.subL ?? run.labels, W, H);
  if (side?.type === 'decision') drawDecision(ctx, side, fr, W, H);
}
function drawLinks(
  ctx: CanvasRenderingContext2D,
  run: Run,
  side: Extract<Side, { type: 'dendro' }>,
  fr: Frame,
  m: Map2,
  thumb: boolean,
): void {
  const d = run.d,
    n = d.n,
    groups = new Map<number, number[]>();
  if (fr.all) return;
  /* 切断より上の結合は図を濁すので散布図には描かない */
  for (let j = 0; j < Math.min(fr.m ?? 0, n - side.k); j++) {
    const g = side.nl[n + j],
      a = groups.get(g);
    if (a) a.push(j);
    else groups.set(g, [j]);
  }
  for (const [g, js] of groups) {
    ctx.beginPath();
    for (const j of js) {
      const q = side.merges[j];
      ctx.moveTo(m.x(d.x[q.pa]), m.y(d.y[q.pa]));
      ctx.lineTo(m.x(d.x[q.pb]), m.y(d.y[q.pb]));
    }
    ctx.strokeStyle = colOf(g);
    ctx.lineWidth = thumb ? 0.8 : 1.3;
    ctx.stroke();
  }
  if (!thumb && (fr.m ?? 0) > 0 && !fr.done) {
    const q = side.merges[(fr.m as number) - 1];
    ctx.beginPath();
    ctx.moveTo(m.x(d.x[q.pa]), m.y(d.y[q.pa]));
    ctx.lineTo(m.x(d.x[q.pb]), m.y(d.y[q.pb]));
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
function drawPoints(
  ctx: CanvasRenderingContext2D,
  run: Run,
  fr: Frame,
  d: Data,
  all: readonly number[],
  xs: Coord,
  ys: Coord,
  m: Map2,
  r: number,
  thumb: boolean,
): void {
  if (fr.soft) {
    const { r: S, k } = fr.soft,
      cols = (run.softC ?? []).map(rgbOf);
    for (let i = 0; i < d.n; i++) {
      let a = 0,
        b = 0,
        e = 0;
      for (let c = 0; c < k; c++) {
        const w = S[i * k + c],
          q = cols[c] ?? C.rgb[c % 8];
        a += w * q[0];
        b += w * q[1];
        e += w * q[2];
      }
      ctx.beginPath();
      ctx.arc(m.x(xs[i]), m.y(ys[i]), r, 0, 2 * Math.PI);
      ctx.fillStyle = `rgb(${a | 0},${b | 0},${e | 0})`;
      ctx.fill();
    }
    return;
  }
  /* 階層: 結合した点から色を付ける */
  const sd = run.side,
    lab =
      sd?.type === 'dendro' && !fr.all
        ? Int16Array.from(run.subL ?? run.labels, (v, i) => (sd.joinAt[i] < (fr.m ?? 0) || fr.done ? v : -1))
        : (fr.l ?? null),
    kind = fr.kind,
    un: number[] = [],
    small: number[] = [],
    big: number[] = [],
    nz: number[] = [];
  for (const i of all) {
    const v = lab ? lab[i] : -1;
    if (kind?.[i] === NOISE) nz.push(i);
    else if (v < 0) un.push(i);
    else if (kind?.[i] === SMALL) small.push(i);
    else big.push(i);
  }
  points(ctx, un, xs, ys, m, () => -1, r, true);
  const at = (i: number) => (lab as Int16Array)[i];
  points(ctx, small, xs, ys, m, at, r * 0.72, thumb);
  points(ctx, big, xs, ys, m, at, r, thumb);
  if (nz.length) {
    const s = thumb ? 1.6 : 3;
    ctx.beginPath();
    for (const i of nz) {
      const x = m.x(xs[i]),
        y = m.y(ys[i]);
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
    }
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = thumb ? 1 : 1.4;
    ctx.stroke();
  }
}
function drawCen(
  ctx: CanvasRenderingContext2D,
  qx: number,
  qy: number,
  c: number,
  t: 'ring' | 'small' | undefined,
  m: Map2,
  thumb: boolean,
): void {
  const x = m.x(qx),
    y = m.y(qy),
    col = c === INK ? C.text : colOf(c);
  if (t === 'small') {
    const s = thumb ? 1.5 : 3.4;
    ctx.fillStyle = col;
    ctx.strokeStyle = C.screen;
    ctx.lineWidth = thumb ? 0.6 : 1.4;
    ctx.fillRect(x - s, y - s, 2 * s, 2 * s);
    ctx.strokeRect(x - s, y - s, 2 * s, 2 * s);
  } else if (t === 'ring') {
    const s = thumb ? 3 : 7;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, 2 * Math.PI);
    ctx.strokeStyle = C.screen;
    ctx.lineWidth = thumb ? 2.4 : 5;
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = thumb ? 1.2 : 2.6;
    ctx.stroke();
  } else {
    const s = thumb ? 3.4 : 8;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, 2 * Math.PI);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = C.screen;
    ctx.lineWidth = thumb ? 1 : 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.55, y);
    ctx.lineTo(x + s * 0.55, y);
    ctx.moveTo(x, y - s * 0.55);
    ctx.lineTo(x, y + s * 0.55);
    ctx.stroke();
  }
}
/** 正解の色でデータを描く */
export function drawTruth(cv: HTMLCanvasElement, d: Data): void {
  const [ctx, W, H] = prepare(cv);
  if (!W || !H) return;
  const m = boxMap(W, H, 4);
  points(
    ctx,
    Array.from({ length: d.n }, (_, i) => i),
    d.x,
    d.y,
    m,
    (i) => (d.none || d.t[i] < 0 ? -1 : d.t[i]),
    radius(W, true),
    true,
  );
}
/** 描画中の図: 描ける範囲と描いた点 */
export function drawCanvas(
  cv: HTMLCanvasElement,
  x: readonly number[],
  y: readonly number[],
  t: readonly number[],
): void {
  const [ctx, W, H] = prepare(cv);
  if (!W || !H) return;
  const m = boxMap(W, H, 14);
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = C.grid2;
  ctx.lineWidth = 1;
  ctx.strokeRect(m.x(0), m.y(0), BOX.w * m.s, BOX.h * m.s);
  ctx.setLineDash([]);
  points(
    ctx,
    x.map((_, i) => i),
    x,
    y,
    m,
    (i) => t[i],
    3.4,
    false,
  );
  if (!x.length) tag(ctx, 'ドラッグで点を描画', W / 2, H / 2, { a: 'center', c: C.text2, size: 14 });
}

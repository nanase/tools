/** しくみの枠: 工程ごとの小さいアニメーション。文言は体言止めで句点を付けない */
import { RM } from '../../lib/motion';
import { type Img, methodOf, mkImg, type Px, resample } from './resample';

type G = CanvasRenderingContext2D;
interface Cols {
  a: string;
  b: string;
  k: string;
  o: string;
  ink: string;
  grid: string;
}
type Draw = (c: G, W: number, H: number, t: number, C: Cols) => void;

const PAT = [
  0.15, 0.3, 0.75, 0.9, 0.2, 0.5, 0.95, 0.65, 0.35, 0.8, 0.45, 0.1, 0.6, 0.25, 0.7, 0.4, 0.85, 0.55, 0.05, 0.3,
];
const gr = (v: number): string => {
  const n = Math.round(v * 255);
  return `rgb(${n},${n},${n})`;
};
function label(c: G, s: string, x: number, y: number, col: string, al: CanvasTextAlign = 'left'): void {
  c.font = '500 12px "Fira Mono",ui-monospace,Consolas,monospace';
  c.textAlign = al;
  c.fillStyle = col;
  c.fillText(s, x, y);
  c.textAlign = 'left';
}

const grid: Draw = (c, W, H, t, C) => {
  const u = 20,
    ox = (W - u * 7) / 2,
    oy = 2;
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 7; i++) {
      c.fillStyle = gr(PAT[(i * 3 + j * 7) % PAT.length]);
      c.fillRect(ox + i * u, oy + j * u, u, u);
    }
  const steps = [2, 1.5, 1, 0.75, 0.5],
    k = steps[Math.floor(t / 1.2) % steps.length],
    /* 倍率が大きいほど出力の格子は細かい */
    w = u / k;
  c.strokeStyle = C.a;
  c.lineWidth = 1;
  c.beginPath();
  for (let x = ox; x <= ox + u * 7 + 0.5; x += w) {
    c.moveTo(Math.round(x) + 0.5, oy);
    c.lineTo(Math.round(x) + 0.5, oy + u * 4);
  }
  for (let y = oy; y <= oy + u * 4 + 0.5; y += w) {
    c.moveTo(ox, Math.round(y) + 0.5);
    c.lineTo(ox + u * 7, Math.round(y) + 0.5);
  }
  c.stroke();
  label(c, `${k === 0.75 ? '3/4' : k === 0.5 ? '1/2' : k} 倍`, 4, H - 7, C.a);
};

const pick: Draw = (c, W, H, t, C) => {
  const u = 17,
    n = 8,
    m = 5,
    ox = (W - u * n) / 2,
    oy = 2,
    [size, name] = (
      [
        [1, '最近傍 1 個'],
        [2, 'バイリニア 4 個'],
        [4, 'キュービック 16 個'],
      ] as const
    )[Math.floor(t / 2) % 3],
    px = 3.1 + 1.2 * Math.sin(t * 0.9),
    py = 2.05 + 0.8 * Math.cos(t * 1.1),
    /* 出力の画素の中心に近い size × size 個 */
    i0 = Math.ceil(px - size / 2),
    j0 = Math.ceil(py - size / 2);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) {
      const on = i >= i0 && i < i0 + size && j >= j0 && j < j0 + size;
      c.fillStyle = on ? C.b : gr(PAT[(i * 5 + j * 3) % PAT.length] * 0.5 + 0.15);
      c.fillRect(ox + i * u + 0.5, oy + j * u + 0.5, u - 1, u - 1);
    }
  c.fillStyle = C.a;
  c.beginPath();
  c.arc(ox + (px + 0.5) * u, oy + (py + 0.5) * u, 4, 0, 6.283);
  c.fill();
  label(c, name, 4, H - 4, C.ink);
};

const kernel: Draw = (c, W, H, t, C) => {
  const k = methodOf('catrom').k,
    y0 = H - 26,
    ky = 58,
    u = 26,
    cx = W / 2 + 12 * Math.sin(t * 0.7);
  c.strokeStyle = C.grid;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, y0 + 0.5);
  c.lineTo(W, y0 + 0.5);
  c.stroke();
  c.strokeStyle = C.k;
  c.lineWidth = 2;
  c.beginPath();
  for (let x = -60; x <= 60; x++) {
    const X = cx + (x / 60) * 2.2 * u,
      Y = y0 - k((x / 60) * 2.2) * ky;
    if (x === -60) c.moveTo(X, Y);
    else c.lineTo(X, Y);
  }
  c.stroke();
  for (let i = -3; i <= 3; i++) {
    const X = W / 2 + i * u,
      Y = y0 - k((X - cx) / u) * ky;
    c.strokeStyle = C.b;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(X, y0);
    c.lineTo(X, Y);
    c.stroke();
    c.fillStyle = C.b;
    c.beginPath();
    c.arc(X, Y, 3, 0, 6.283);
    c.fill();
  }
  label(c, '重み', 4, 13, C.k);
  label(c, '元の画素', W - 4, H - 4, C.b, 'right');
};

const sum: Draw = (c, _W, H, t, C) => {
  const vals = [0.9, 0.15, 0.85, 0.1],
    wts = [-0.07, 0.57, 0.57, -0.07],
    u = 22,
    y0 = H - 24,
    h = 62,
    n = Math.floor(t / 0.8) % 7,
    total = vals.reduce((a, v, i) => a + (n > i ? v * wts[i] : 0), 0);
  for (let i = 0; i < 4; i++) {
    const hh = (n > i ? vals[i] * wts[i] : vals[i]) * h;
    c.fillStyle = n > i ? (wts[i] < 0 ? C.k : C.b) : C.grid;
    c.fillRect(6 + i * (u + 2), hh < 0 ? y0 : y0 - hh, u, Math.max(1, Math.abs(hh)));
  }
  c.strokeStyle = C.grid;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, y0 + 0.5);
  c.lineTo(172, y0 + 0.5);
  c.stroke();
  label(c, n ? '値 × 重み' : '値', 6, H - 5, C.ink);
  c.fillStyle = C.a;
  c.fillRect(118, y0 - total * h, 34, Math.max(1, total * h));
  label(c, total.toFixed(2), 118, H - 5, C.a);
};

const pass: Draw = (c, _W, H, t, C) => {
  const u = 14,
    n = 8,
    ox = 22,
    oy = (H - u * 5) / 2,
    ph = t % 4.8,
    hor = ph < 2.4,
    p = Math.floor(((hor ? ph : ph - 2.4) / 2.4) * (hor ? 5 : 8));
  for (let j = 0; j < 5; j++)
    for (let i = 0; i < n; i++) {
      const v = PAT[(i * 3 + j * 5) % PAT.length] * 0.5 + 0.1,
        on = hor ? j === p : i === p;
      c.fillStyle = on ? (hor ? C.b : C.a) : hor ? gr(v) : gr(v + 0.15);
      c.fillRect(ox + i * u + 0.5, oy + j * u + 0.5, u - 1, u - 1);
    }
  label(c, hor ? '横' : '縦', 4, 15, hor ? C.b : C.a);
  c.fillStyle = hor ? C.b : C.a;
  if (hor) c.fillRect(ox - 8, oy + p * u + 4, 5, u - 8);
  else c.fillRect(ox + p * u + 4, oy - 8, u - 8, 5);
};

const alias: Draw = (c, W, H, t, C) => {
  const on = Math.floor(t / 2.4) % 2 === 1,
    gw = W - 8,
    y1 = 30,
    y2 = 78,
    a1 = 15,
    step = 11,
    f = (x: number): number => Math.sin(x * 0.62);
  c.strokeStyle = C.b;
  c.lineWidth = 1.2;
  c.beginPath();
  for (let x = 0; x <= gw; x++) {
    if (x) c.lineTo(x + 4, y1 - a1 * f(x));
    else c.moveTo(x + 4, y1 - a1 * f(x));
  }
  c.stroke();
  c.strokeStyle = C.a;
  c.fillStyle = C.a;
  c.lineWidth = 2;
  c.beginPath();
  for (let x = 0; x <= gw; x += step) {
    const Y = y2 - a1 * (on ? 0.05 * f(x) : f(x));
    if (x) c.lineTo(x + 4, Y);
    else c.moveTo(x + 4, Y);
  }
  c.stroke();
  for (let x = 0; x <= gw; x += step) {
    c.beginPath();
    c.arc(x + 4, y2 - a1 * (on ? 0.05 * f(x) : f(x)), 2.2, 0, 6.283);
    c.fill();
    if (!on) {
      c.beginPath();
      c.arc(x + 4, y1 - a1 * f(x), 2, 0, 6.283);
      c.fill();
    }
  }
  label(c, on ? 'オン' : 'オフ　折り返し', 4, H - 3, C.a);
};

/* 弱点の絵は実際に計算する */
const TILES: { label: string; k: HTMLCanvasElement }[] = [];
function addTile(name: string, img: Img, s: number, id: string, w: number): void {
  const r = resample(img, s, methodOf(id), { x: 0, y: 0, w, h: w }),
    k = document.createElement('canvas');
  k.width = k.height = w;
  (k.getContext('2d') as G).putImageData(new ImageData(r, w, w), 0, 0);
  TILES.push({ label: name, k });
}
function gray(n: number, f: (x: number, y: number) => number): Img {
  const d: Px = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = f(x, y);
      d.set([v, v, v, 255], (y * n + x) * 4);
    }
  return mkImg(n, n, d);
}
const flaws: Draw = (c, W, H, t, C) => {
  if (!TILES.length) {
    const small = gray(14, (x, y) => (Math.hypot(x - 6.5, y - 6.5) < 4.8 ? 235 : 25));
    addTile('ジャギー', small, 3, 'nearest', 42);
    addTile('ぼけ', small, 3, 'bspline', 42);
    addTile('リンギング', small, 3, 'lanczos3', 42);
    addTile(
      'モアレ',
      gray(168, (x, y) => 128 + 120 * Math.cos(((x - 84) ** 2 + (y - 84) ** 2) * 0.07)),
      0.25,
      'nearest',
      42,
    );
  }
  const on = Math.floor(t / 1.2) % 4,
    sz = 38,
    gap = 4,
    ox = (W - (sz * 4 + gap * 3)) / 2;
  c.imageSmoothingEnabled = false;
  TILES.forEach((f, i) => {
    const x = ox + i * (sz + gap);
    c.drawImage(f.k, x, 22, sz, sz);
    if (i === on) {
      c.strokeStyle = C.o;
      c.lineWidth = 2;
      c.strokeRect(x - 1, 21, sz + 2, sz + 2);
    }
  });
  label(c, TILES[on].label, W / 2, H - 16, C.o, 'center');
};

/** しくみの工程の順（文言は steps.ts） */
const DRAWS: readonly Draw[] = [grid, pick, kernel, sum, pass, alias, flaws];

const CW = 172;
const CH = 104;
/** 見えている間だけ動かす。動きを減らす設定では止めた絵を出す */
export function mountMech(host: HTMLElement): void {
  const dpr = Math.min(2, devicePixelRatio || 1),
    cards = [...host.querySelectorAll<HTMLCanvasElement>('canvas')].map((cv, i) => {
      cv.width = CW * dpr;
      cv.height = CH * dpr;
      return { c: cv.getContext('2d') as G, d: DRAWS[i] };
    }),
    css = getComputedStyle(document.documentElement);
  const draw = (ms: number): void => {
    const v = (n: string): string => css.getPropertyValue(n).trim(),
      C = {
        a: v('--ch1'),
        b: v('--ch2'),
        k: v('--rz-k'),
        o: v('--accent'),
        ink: v('--screen-ink'),
        grid: v('--grid-2'),
      };
    for (const k of cards) {
      k.c.setTransform(dpr, 0, 0, dpr, 0, 0);
      k.c.clearRect(0, 0, CW, CH);
      k.d(k.c, CW, CH, RM.matches ? 2.3 : ms / 1000, C);
    }
  };
  let vis = false,
    last = 0,
    raf = 0;
  const tick = (ms: number): void => {
    raf = 0;
    if (!vis) return;
    /* コマ送りで足りるので 1 秒に 15 回 */
    if (ms - last > 66) {
      draw(ms);
      last = ms;
    }
    if (!RM.matches) raf = requestAnimationFrame(tick);
  };
  new IntersectionObserver(
    (e) => {
      vis = e[e.length - 1].isIntersecting;
      if (vis && !raf) raf = requestAnimationFrame(tick);
    },
    { threshold: 0.05 },
  ).observe(host);
  new MutationObserver(() => draw(performance.now())).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  draw(0);
}

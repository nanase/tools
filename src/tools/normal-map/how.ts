/**
 * しくみの枠の 5 つの図。題材は 2 × 2 の鋲。止まっているときは完成した絵で、工程のカードに指を乗せると
 * 初めから順に進む（lib/how-anim.ts）。図はテーマに依らず暗い地に描く
 */
import { type HowFig, mountHowAnim } from '../../lib/how-anim';

type G = CanvasRenderingContext2D;
type V3 = [number, number, number];
/** 図の大きさ（CSS の画素）と、画素ごとに計算する絵の画素数 */
const W = 160,
  N = 96;
const BG = '#08090a',
  INK = '#d9d4ca',
  ARROW = '#7fd3ff',
  FILL = '#3a3f44',
  LABEL = '#e6e8e4';
const FONT = '13px system-ui,"Hiragino Sans","Yu Gothic UI",sans-serif';

/** 鋲 4 つの高さ（x・y は −1〜1、y は上が正） */
export function rivetH(x: number, y: number): number {
  const fx = (((x + 1) % 1) + 1) % 1,
    fy = (((y + 1) % 1) + 1) % 1,
    r = Math.hypot(fx - 0.5, fy - 0.5) / 0.36,
    s = 1 - r * r;
  return s > 0 ? s ** 0.7 : 0;
}
/** 傾きの強さ（図で向きが見えるように強めにする） */
const K = 2.2;
/** 面の向き（x 右・y 上・z 手前） */
export function rivetN(x: number, y: number): V3 {
  const e = 1 / N,
    gx = (rivetH(x + e, y) - rivetH(x - e, y)) / (2 * e),
    gy = (rivetH(x, y + e) - rivetH(x, y - e)) / (2 * e),
    a = (-K * gx) / 8,
    b = (-K * gy) / 8,
    l = Math.hypot(a, b, 1);
  return [a / l, b / l, 1 / l];
}

/** 画素ごとの色の関数から絵を作る */
function image(f: (x: number, y: number) => V3): HTMLCanvasElement {
  const o = document.createElement('canvas');
  o.width = o.height = N;
  const g = o.getContext('2d') as G,
    im = g.createImageData(N, N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const c = f(((i + 0.5) / N) * 2 - 1, 1 - ((j + 0.5) / N) * 2);
      im.data.set([c[0], c[1], c[2], 255], (j * N + i) * 4);
    }
  g.putImageData(im, 0, 0);
  return o;
}
function arrow(g: G, x: number, y: number, ex: number, ey: number, w: number, col: string): void {
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(ex, ey);
  g.stroke();
  const a = Math.atan2(ey - y, ex - x),
    h = w * 4;
  g.beginPath();
  g.moveTo(ex + Math.cos(a) * w, ey + Math.sin(a) * w);
  g.lineTo(ex - h * Math.cos(a - 0.5), ey - h * Math.sin(a - 0.5));
  g.lineTo(ex - h * Math.cos(a + 0.5), ey - h * Math.sin(a + 0.5));
  g.closePath();
  g.fill();
}
const X = (x: number) => ((x + 1) / 2) * W;
/** 上から k の割合だけ絵を出す（走査） */
function reveal(g: G, im: HTMLCanvasElement, k: number): void {
  g.fillStyle = BG;
  g.fillRect(0, 0, W, W);
  const rows = Math.round(N * k);
  if (rows <= 0) return;
  g.imageSmoothingEnabled = true;
  g.drawImage(im, 0, 0, N, rows, 0, 0, W, (W * rows) / N);
}

/** 断面（y は鋲の中心を通る横の線）。real が偽なら平らな線に同じ向きの矢印を立てる */
function profile(g: G, base: number, amp: number, flat: number, xs: readonly number[], len: number, cy = -0.5): void {
  const yt = (x: number) => base - rivetH(x, cy) * amp * (1 - flat),
    yr = (x: number) => base - rivetH(x, cy) * amp;
  g.fillStyle = FILL;
  g.beginPath();
  g.moveTo(0, base + W * 0.2);
  for (let i = 0; i <= 200; i++) {
    const x = -1 + (2 * i) / 200;
    g.lineTo(X(x), yt(x));
  }
  g.lineTo(W, base + W * 0.2);
  g.closePath();
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 200; i++) {
    const x = -1 + (2 * i) / 200;
    if (i) g.lineTo(X(x), yt(x));
    else g.moveTo(X(x), yt(x));
  }
  g.stroke();
  /* 矢印の向きは本物の凹凸の傾きのまま */
  for (const x of xs) {
    const e = 0.01,
      sl = (yr(x + e) - yr(x - e)) / (X(x + e) - X(x - e)),
      l = Math.hypot(sl, 1);
    arrow(g, X(x), yt(x), X(x) + (sl / l) * len, yt(x) - (1 / l) * len, 1.5, ARROW);
  }
}
function label(g: G, s: string, x: number, y: number): void {
  g.font = FONT;
  g.textBaseline = 'top';
  g.fillStyle = LABEL;
  g.fillText(s, x, y);
}

const XS2 = [-0.92, -0.78, -0.66, -0.5, -0.34, -0.22, -0.08, 0.08, 0.22, 0.34, 0.5, 0.66, 0.78, 0.92];
const XS5 = [-0.78, -0.66, -0.5, -0.34, -0.22, 0.22, 0.34, 0.5, 0.66, 0.78];
/** 4 の光の向きの基準（左上から） */
const L0 = Math.atan2(0.55, -0.6);

function figs(): HowFig[] {
  const hImg = image((x, y) => {
    const v = rivetH(x, y) * 255;
    return [v, v, v];
  });
  const nImg = image((x, y) => rivetN(x, y).map((q) => (q * 0.5 + 0.5) * 255) as V3);
  return [
    /* 1 高さ: 上から走査して描く */
    { dur: 1.2, draw: (g, k) => reveal(g, hImg, k) },
    /* 2 断面と傾き: 左から矢印を足していく */
    {
      dur: 1.6,
      draw: (g, k) => {
        g.fillStyle = BG;
        g.fillRect(0, 0, W, W);
        const n = Math.round(XS2.length * k);
        profile(g, W * 0.72, W * 0.28, 0, XS2.slice(0, n), 26, -0.5);
      },
    },
    /* 3 色: 上から走査し、終わったら矢印を重ねる */
    {
      dur: 1.4,
      draw: (g, k) => {
        reveal(g, nImg, k);
        if (k < 1) return;
        for (const [x, y] of [
          [-0.72, 0.5],
          [-0.28, 0.5],
          [-0.5, 0.72],
          [-0.5, 0.28],
        ]) {
          const n = rivetN(x, y),
            px = X(x),
            py = ((1 - y) / 2) * W;
          arrow(g, px, py, px + n[0] * 60, py - n[1] * 60, 1.8, '#fff');
        }
      },
    },
    /* 4 光: 光が 1 周する */
    {
      dur: 2.4,
      draw: (g, k) => {
        const a = L0 + k * 2 * Math.PI,
          L: V3 = [Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0.6],
          im = image((x, y) => {
            const n = rivetN(x, y),
              d = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]),
              c = 0.05 + 0.95 * d;
            return [255 * (c * 0.8) ** 0.4545, 255 * (c * 0.76) ** 0.4545, 255 * (c * 0.7) ** 0.4545];
          });
        reveal(g, im, 1);
        const px = W / 2 + Math.cos(a) * W * 0.4,
          py = W / 2 - Math.sin(a) * W * 0.4;
        g.fillStyle = '#ffd98a';
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(px, py, 7, 0, 7);
        g.fill();
        g.stroke();
      },
    },
    /* 5 横から: 下の段の凹凸がつぶれて平らになり、矢印の向きだけが残る */
    {
      dur: 1.6,
      draw: (g, k) => {
        g.fillStyle = BG;
        g.fillRect(0, 0, W, W);
        profile(g, W * 0.36, W * 0.12, 0, XS5, 18);
        label(g, '本物の凹凸', 6, W * 0.38);
        profile(g, W * 0.8, W * 0.12, Math.min(1, k / 0.7), XS5, 18);
        label(g, '法線マップ', 6, W * 0.82);
      },
    },
  ];
}

export function mountHow(host: HTMLElement): void {
  mountHowAnim(host, figs(), { w: W, h: W });
}

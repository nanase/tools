/**
 * しくみの枠の 5 つの図。題材は 2 × 2 の鋲。止まっているときは完成した絵で、工程のカードに指を乗せると
 * 初めから順に進む（lib/how-anim.ts）。図はテーマに依らず暗い地に描く。
 * 1 の点線の行が 2 の断面で、2 の黄色の点は傾きを求める隣の画素
 */
import { type HowFig, mountHowAnim } from '../../lib/how-anim';

type G = CanvasRenderingContext2D;
type V3 = [number, number, number];
/** 図の大きさ（CSS の画素。表示は列の幅に合わせて伸び縮みする）と、画素ごとに計算する絵の画素数 */
const W = 300,
  N = 120;
/** 長さの倍率（160 画素の図で決めた長さを伸ばす） */
const S = W / 160;
const BG = '#08090a',
  INK = '#d9d4ca',
  ARROW = '#7fd3ff',
  MARK = '#ffd98a',
  FILL = '#3a3f44',
  LABEL = '#e6e8e4';
const FONT = '500 14px system-ui,"Hiragino Sans","Yu Gothic UI",sans-serif';
/** 2 の断面を取る行（1 の図の y） */
const CUT = -0.5;

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
/** 向きを法線マップの色にする */
const toRgb = (n: V3): V3 => n.map((q) => (q * 0.5 + 0.5) * 255) as V3;

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
const X = (x: number) => ((x + 1) / 2) * W,
  Y = (y: number) => ((1 - y) / 2) * W;
/** 上から k の割合だけ絵を出す（走査） */
function reveal(g: G, im: HTMLCanvasElement, k: number): void {
  g.fillStyle = BG;
  g.fillRect(0, 0, W, W);
  const rows = Math.round(N * k);
  if (rows <= 0) return;
  g.imageSmoothingEnabled = true;
  g.drawImage(im, 0, 0, N, rows, 0, 0, W, (W * rows) / N);
}
/** 暗い地に白い字の札 */
function tag(g: G, s: string, x: number, y: number, al: CanvasTextAlign = 'left'): void {
  g.font = FONT;
  g.textBaseline = 'middle';
  g.textAlign = al;
  const w = g.measureText(s).width,
    x0 = al === 'left' ? x : al === 'right' ? x - w : x - w / 2;
  g.fillStyle = 'rgba(0,0,0,.66)';
  g.fillRect(x0 - 5, y - 11, w + 10, 22);
  g.fillStyle = LABEL;
  g.fillText(s, x, y + 0.5);
}
/** 図の下の帯（凡例を置く） */
function band(g: G, h = 34): number {
  g.fillStyle = 'rgba(8,9,10,.85)';
  g.fillRect(0, W - h, W, h);
  return W - h / 2;
}

/** 断面の線を描き、xs の所に向きの矢印を立てる。flat が 1 なら平らな線に同じ向きの矢印 */
function profile(g: G, base: number, amp: number, flat: number, xs: readonly number[], len: number): void {
  const yt = (x: number) => base - rivetH(x, CUT) * amp * (1 - flat),
    yr = (x: number) => base - rivetH(x, CUT) * amp;
  g.fillStyle = FILL;
  g.beginPath();
  g.moveTo(0, base + W * 0.2);
  for (let i = 0; i <= 200; i++) g.lineTo(X(-1 + (2 * i) / 200), yt(-1 + (2 * i) / 200));
  g.lineTo(W, base + W * 0.2);
  g.closePath();
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 2 * S;
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
    arrow(g, X(x), yt(x), X(x) + (sl / l) * len, yt(x) - (1 / l) * len, 1.5 * S, ARROW);
  }
}

const XS2 = [-0.92, -0.78, -0.5, -0.34, -0.22, -0.08, 0.08, 0.22, 0.34, 0.5, 0.66, 0.78, 0.92];
const XS5 = [-0.78, -0.66, -0.5, -0.34, -0.22, 0.22, 0.34, 0.5, 0.66, 0.78];
/** 2 で傾きを求めてみせる点と、隣の画素までの距離 */
const PX = -0.66,
  PD = 0.1;
/** 4 の光の向きの基準（左上から） */
const L0 = Math.atan2(0.55, -0.6);

function figs(): HowFig[] {
  const hImg = image((x, y) => {
    const v = rivetH(x, y) * 255;
    return [v, v, v];
  });
  const nImg = image((x, y) => toRgb(rivetN(x, y)));
  return [
    /* 1 高さ: 上から走査して描く。点線の行が 2 の断面、下の帯が濃さの凡例 */
    {
      dur: 1.2,
      draw: (g, k) => {
        reveal(g, hImg, k);
        tag(g, '高さの画像', 8, 18);
        if (k < 1) return;
        g.strokeStyle = MARK;
        g.lineWidth = 1.5;
        g.setLineDash([5, 4]);
        g.beginPath();
        g.moveTo(0, Y(CUT));
        g.lineTo(W, Y(CUT));
        g.stroke();
        g.setLineDash([]);
        const cy = band(g),
          gr = g.createLinearGradient(W * 0.3, 0, W * 0.7, 0);
        gr.addColorStop(0, '#000');
        gr.addColorStop(1, '#fff');
        g.fillStyle = gr;
        g.fillRect(W * 0.3, cy - 7, W * 0.4, 14);
        g.strokeStyle = '#5a646d';
        g.lineWidth = 1;
        g.strokeRect(W * 0.3, cy - 7, W * 0.4, 14);
        g.font = FONT;
        g.textBaseline = 'middle';
        g.fillStyle = LABEL;
        g.textAlign = 'right';
        g.fillText('低い', W * 0.27, cy);
        g.textAlign = 'left';
        g.fillText('高い', W * 0.73, cy);
      },
    },
    /* 2 断面と傾き: 1 点で隣の画素の差から傾き（点線）と向き（白い矢印）を示し、左から矢印を足していく */
    {
      dur: 1.6,
      draw: (g, k) => {
        g.fillStyle = BG;
        g.fillRect(0, 0, W, W);
        const base = W * 0.74,
          amp = W * 0.3,
          y = (x: number) => base - rivetH(x, CUT) * amp;
        profile(g, base, amp, 0, XS2.slice(0, Math.round(XS2.length * k)), 26 * S);
        /* 隣の画素 2 つと、それを結ぶ傾き */
        const a = PX - PD,
          b = PX + PD,
          sl = (y(b) - y(a)) / (X(b) - X(a)),
          ext = W * 0.12;
        g.strokeStyle = MARK;
        g.lineWidth = 1.5 * S;
        g.setLineDash([5, 4]);
        g.beginPath();
        g.moveTo(X(a) - ext, y(a) - sl * ext);
        g.lineTo(X(b) + ext, y(b) + sl * ext);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = MARK;
        for (const x of [a, b]) {
          g.beginPath();
          g.arc(X(x), y(x), 4.5, 0, 7);
          g.fill();
        }
        const l = Math.hypot(sl, 1),
          len = 34 * S;
        arrow(g, X(PX), y(PX), X(PX) + (sl / l) * len, y(PX) - (1 / l) * len, 2 * S, '#fff');
        tag(g, '1 の点線の断面', 8, 18);
      },
    },
    /* 3 色: 上から走査し、終わったら矢印と色の凡例を重ねる */
    {
      dur: 1.4,
      draw: (g, k) => {
        reveal(g, nImg, k);
        if (k < 1) {
          tag(g, '法線マップ', 8, 18);
          return;
        }
        for (const [x, y] of [
          [-0.72, 0.5],
          [-0.28, 0.5],
          [-0.5, 0.72],
          [-0.5, 0.28],
        ]) {
          const n = rivetN(x, y);
          arrow(g, X(x), Y(y), X(x) + n[0] * 60 * S, Y(y) - n[1] * 60 * S, 1.8 * S, '#fff');
        }
        const cy = band(g),
          keys: [string, V3][] = [
            ['右', [1, 0, 0]],
            ['上', [0, 1, 0]],
            ['正面', [0, 0, 1]],
          ];
        g.font = FONT;
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        keys.forEach(([s, n], i) => {
          const x0 = W * 0.08 + i * W * 0.3;
          g.fillStyle = `rgb(${toRgb(n).join(',')})`;
          g.fillRect(x0, cy - 8, 16, 16);
          g.fillStyle = LABEL;
          g.fillText(s, x0 + 22, cy);
        });
        tag(g, '法線マップ', 8, 18);
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
        const px = W / 2 + Math.cos(a) * W * 0.42,
          py = W / 2 - Math.sin(a) * W * 0.42;
        g.fillStyle = MARK;
        g.strokeStyle = '#000';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(px, py, 7 * S, 0, 7);
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
        profile(g, W * 0.36, W * 0.12, 0, XS5, 18 * S);
        tag(g, '本物の凹凸', 8, W * 0.44);
        profile(g, W * 0.8, W * 0.12, Math.min(1, k / 0.7), XS5, 18 * S);
        tag(g, '法線マップ', 8, W * 0.88);
      },
    },
  ];
}

export function mountHow(host: HTMLElement): void {
  mountHowAnim(host, figs(), { w: W, h: W });
}

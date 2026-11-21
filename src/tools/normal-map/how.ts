/**
 * しくみの枠の 5 つの図（ほかのページと同じ 172 × 104）。題材は横に並んだ 2 つの鋲。
 * 止まっているときは完成した絵で、工程のカードに指を乗せると初めから順に進む（lib/how-anim.ts）。
 * 画像の図（1・3・4）はそのままの色、断面の図（2・5）はテーマの色で描く。
 * 1 の点線の行が 2 の断面で、2 の点は傾きを求める隣の画素
 */
import { type HowFig, mountHowAnim } from '../../lib/how-anim';

type G = CanvasRenderingContext2D;
type V3 = [number, number, number];
/** 図の大きさ（CSS の画素）。x は −1〜1 を横幅に、y は同じ縮尺で縦に取る */
const CW = 172,
  CH = 104,
  U = CW / 2,
  YM = CH / 2 / U;
/** 画素ごとに計算する絵の画素数 */
const NW = 172,
  NH = 104;
/** テーマの色（prepare で読む） */
const C = { a: '', b: '', ink: '', fill: '', scr: '' };
const FONT = '500 11px system-ui,"Hiragino Sans","Yu Gothic UI",sans-serif';

/** 鋲の高さ（中心は x = ±0.5、y = 0。y は上が正） */
export function rivetH(x: number, y: number): number {
  const fx = (((x + 1) % 1) + 1) % 1,
    r = Math.hypot(fx - 0.5, y) / 0.36,
    s = 1 - r * r;
  return s > 0 ? s ** 0.7 : 0;
}
/** 傾きの強さ（図で向きが見えるように強めにする） */
const K = 2.2;
/** 面の向き（x 右・y 上・z 手前） */
export function rivetN(x: number, y: number): V3 {
  const e = 0.01,
    gx = (rivetH(x + e, y) - rivetH(x - e, y)) / (2 * e),
    gy = (rivetH(x, y + e) - rivetH(x, y - e)) / (2 * e),
    a = (-K * gx) / 8,
    b = (-K * gy) / 8,
    l = Math.hypot(a, b, 1);
  return [a / l, b / l, 1 / l];
}
/** 向きを法線マップの色にする */
const toRgb = (n: V3): V3 => n.map((q) => (q * 0.5 + 0.5) * 255) as V3;

const X = (x: number) => (x + 1) * U,
  Y = (y: number) => CH / 2 - y * U;

/** 画素ごとの色の関数から絵を作る */
function image(f: (x: number, y: number) => V3): HTMLCanvasElement {
  const o = document.createElement('canvas');
  o.width = NW;
  o.height = NH;
  const g = o.getContext('2d') as G,
    im = g.createImageData(NW, NH);
  for (let j = 0; j < NH; j++)
    for (let i = 0; i < NW; i++) {
      const c = f(((i + 0.5) / NW) * 2 - 1, (0.5 - (j + 0.5) / NH) * 2 * YM);
      im.data.set([c[0], c[1], c[2], 255], (j * NW + i) * 4);
    }
  g.putImageData(im, 0, 0);
  return o;
}
/** 上から k の割合だけ絵を出す（走査） */
function reveal(g: G, im: HTMLCanvasElement, k: number): void {
  g.fillStyle = '#000';
  g.fillRect(0, 0, CW, CH);
  const rows = Math.round(NH * k);
  if (rows > 0) g.drawImage(im, 0, 0, NW, rows, 0, 0, CW, (CH * rows) / NH);
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
    h = w * 3.5;
  g.beginPath();
  g.moveTo(ex + Math.cos(a) * w, ey + Math.sin(a) * w);
  g.lineTo(ex - h * Math.cos(a - 0.5), ey - h * Math.sin(a - 0.5));
  g.lineTo(ex - h * Math.cos(a + 0.5), ey - h * Math.sin(a + 0.5));
  g.closePath();
  g.fill();
}
function text(g: G, s: string, x: number, y: number, col: string, al: CanvasTextAlign = 'left'): void {
  g.font = FONT;
  g.textBaseline = 'middle';
  g.textAlign = al;
  g.fillStyle = col;
  g.fillText(s, x, y);
}
/** 断面（y = 0 の行）。flat が 1 なら平らな線に、本物と同じ向きの矢印を立てる。depth は線の下を塗る深さ */
function profile(g: G, base: number, amp: number, flat: number, xs: readonly number[], len: number, depth = 40): void {
  const yt = (x: number) => base - rivetH(x, 0) * amp * (1 - flat),
    yr = (x: number) => base - rivetH(x, 0) * amp,
    line = () => {
      for (let i = 0; i <= 172; i++) {
        const x = -1 + (2 * i) / 172;
        if (i) g.lineTo(X(x), yt(x));
        else g.moveTo(X(x), yt(x));
      }
    };
  g.fillStyle = C.fill;
  g.beginPath();
  line();
  g.lineTo(CW, base + depth);
  g.lineTo(0, base + depth);
  g.closePath();
  g.fill();
  g.strokeStyle = C.ink;
  g.lineWidth = 1.5;
  g.beginPath();
  line();
  g.stroke();
  for (const x of xs) {
    const e = 0.01,
      sl = (yr(x + e) - yr(x - e)) / (X(x + e) - X(x - e)),
      l = Math.hypot(sl, 1);
    arrow(g, X(x), yt(x), X(x) + (sl / l) * len, yt(x) - (1 / l) * len, 1.2, C.b);
  }
}

const XS2 = [-0.92, -0.5, -0.34, -0.2, 0.2, 0.34, 0.5, 0.66, 0.8];
const XS5 = [-0.78, -0.64, -0.5, -0.36, -0.22, 0.22, 0.36, 0.5, 0.64, 0.78];
/** 2 で傾きを求めてみせる点と、隣の画素までの距離 */
const PX = -0.7,
  PD = 0.08;
/** 4 の光の向きの基準（左上から） */
const L0 = Math.atan2(0.55, -0.6);

function figs(): HowFig[] {
  const hImg = image((x, y) => {
    const v = rivetH(x, y) * 255;
    return [v, v, v];
  });
  const nImg = image((x, y) => toRgb(rivetN(x, y)));
  return [
    /* 1 高さ: 上から走査して描く。点線の行が 2 の断面。下に濃さの凡例 */
    {
      dur: 1.2,
      draw: (g, k) => {
        reveal(g, hImg, k);
        if (k < 1) return;
        g.strokeStyle = '#ffd98a';
        g.lineWidth = 1;
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(0, Y(0));
        g.lineTo(CW, Y(0));
        g.stroke();
        g.setLineDash([]);
        const gr = g.createLinearGradient(CW - 62, 0, CW - 26, 0);
        gr.addColorStop(0, '#000');
        gr.addColorStop(1, '#fff');
        g.fillStyle = 'rgba(0,0,0,.65)';
        g.fillRect(CW - 90, CH - 15, 88, 13);
        g.fillStyle = gr;
        g.fillRect(CW - 62, CH - 12, 36, 7);
        g.strokeStyle = '#5a646d';
        g.lineWidth = 1;
        g.strokeRect(CW - 62, CH - 12, 36, 7);
        text(g, '低い', CW - 65, CH - 8, '#e6e8e4', 'right');
        text(g, '高い', CW - 23, CH - 8, '#e6e8e4');
      },
    },
    /* 2 断面と傾き: 1 点で隣の画素の差から傾き（点線）と向き（太い矢印）を示し、左から矢印を足していく */
    {
      dur: 1.6,
      draw: (g, k) => {
        const base = CH - 18,
          amp = 52,
          y = (x: number) => base - rivetH(x, 0) * amp;
        profile(g, base, amp, 0, XS2.slice(0, Math.round(XS2.length * k)), 15);
        const a = PX - PD,
          b = PX + PD,
          sl = (y(b) - y(a)) / (X(b) - X(a)),
          ext = 14;
        g.strokeStyle = C.a;
        g.lineWidth = 1.2;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(X(a) - ext, y(a) - sl * ext);
        g.lineTo(X(b) + ext, y(b) + sl * ext);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = C.a;
        for (const x of [a, b]) {
          g.beginPath();
          g.arc(X(x), y(x), 2.6, 0, 7);
          g.fill();
        }
        const l = Math.hypot(sl, 1);
        arrow(g, X(PX), y(PX), X(PX) + (sl / l) * 22, y(PX) - (1 / l) * 22, 1.8, C.a);
      },
    },
    /* 3 色: 上から走査し、終わったら矢印と色の凡例を重ねる */
    {
      dur: 1.4,
      draw: (g, k) => {
        reveal(g, nImg, k);
        if (k < 1) return;
        for (const [x, y, s] of [
          [-0.68, 0, 1],
          [-0.32, 0, 1],
          [-0.5, 0.2, 1],
        ] as const) {
          const n = rivetN(x, y);
          arrow(g, X(x), Y(y), X(x) + n[0] * 34 * s, Y(y) - n[1] * 34 * s, 1.2, '#fff');
        }
        const keys: [string, V3][] = [
          ['右', [1, 0, 0]],
          ['上', [0, 1, 0]],
          ['正面', [0, 0, 1]],
        ];
        g.fillStyle = 'rgba(0,0,0,.65)';
        g.fillRect(CW - 104, CH - 15, 102, 13);
        keys.forEach(([s, n], i) => {
          const x0 = CW - 100 + i * 30;
          g.fillStyle = `rgb(${toRgb(n).join(',')})`;
          g.fillRect(x0, CH - 12, 7, 7);
          text(g, s, x0 + 10, CH - 8, '#e6e8e4');
        });
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
        g.fillStyle = '#ffd98a';
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(CW / 2 + Math.cos(a) * CW * 0.44, CH / 2 - Math.sin(a) * CH * 0.4, 5, 0, 7);
        g.fill();
        g.stroke();
      },
    },
    /* 5 横から: 下の段の凹凸がつぶれて平らになり、矢印の向きだけが残る */
    {
      dur: 1.6,
      draw: (g, k) => {
        profile(g, 40, 16, 0, XS5, 12, 13);
        profile(g, 89, 16, Math.min(1, k / 0.7), XS5, 12, 15);
        text(g, '本物の凹凸', CW - 3, 47, C.scr, 'right');
        text(g, '法線マップ', CW - 3, 97, C.scr, 'right');
      },
    },
  ];
}

export function mountHow(host: HTMLElement): void {
  mountHowAnim(host, figs(), {
    w: CW,
    h: CH,
    prepare() {
      const css = getComputedStyle(document.documentElement),
        v = (n: string): string => css.getPropertyValue(n).trim();
      Object.assign(C, {
        a: v('--ch1'),
        b: v('--ch2'),
        ink: v('--screen-ink'),
        fill: v('--grid-2'),
        scr: v('--screen'),
      });
    },
  });
}

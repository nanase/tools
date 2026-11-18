/**
 * しくみの枠の 5 つの図（止まった絵）。テーマが変わったら描き直す。
 * 3 は単精度を模した計算（演算ごとに Math.fround）と倍精度の計算を並べる
 */
import { BAIL, type Formula, nu } from './formula';
import { palOf } from './palette';

type G = CanvasRenderingContext2D;
interface Cols {
  a: string;
  b: string;
  ink: string;
  grid: string;
  scr: string;
}
const CW = 172,
  CH = 104;
const M2: Formula = { p: 2, pre: 0, post: 0, conj: false };

/** 複素数の点を図の座標へ（中心 cx, cy、高さの半分が h） */
const mapper = (cx: number, cy: number, h: number) => (x: number, y: number) =>
  [CW / 2 + ((x - cx) / h) * (CH / 2), CH / 2 + ((y - cy) / h) * (CH / 2)] as const;

function orbitPts(cr: number, ci: number, n: number): [number, number][] {
  const o: [number, number][] = [[0, 0]];
  let x = 0,
    y = 0;
  for (let k = 0; k < n; k++) {
    [x, y] = [x * x - y * y + cr, 2 * x * y + ci];
    o.push([x, y]);
    if (x * x + y * y > 16) break;
  }
  return o;
}
function poly(c: G, pts: readonly (readonly [number, number])[], col: string, dot = true): void {
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineWidth = 1.2;
  c.beginPath();
  for (const [i, [x, y]] of pts.entries()) {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  }
  c.stroke();
  if (dot)
    for (const [x, y] of pts) {
      c.beginPath();
      c.arc(x, y, 1.8, 0, 7);
      c.fill();
    }
}
function label(c: G, s: string, x: number, y: number, col: string, al: CanvasTextAlign = 'left'): void {
  c.font = '500 11px "Fira Mono",ui-monospace,Consolas,monospace';
  c.textAlign = al;
  c.fillStyle = col;
  c.fillText(s, x, y);
}

/** 色の帯の画像を画素ごとに作る（f32 なら単精度を模す）。putImageData は拡大されないので別の canvas に作る */
function field(cx: number, cy: number, h: number, N: number, f32: boolean, den = 0.55): HTMLCanvasElement {
  const W = CW,
    H = CH,
    cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d') as G,
    img = c.createImageData(W, H),
    st = palOf('sun').s,
    fr = Math.fround;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      let v: number;
      const re = cx + ((i - W / 2) / (H / 2)) * h,
        im = cy + ((j - H / 2) / (H / 2)) * h;
      if (f32) {
        /* 単精度: 座標も途中の値も 24 ビットに丸める */
        const cr = fr(re),
          ci = fr(im);
        let x = 0,
          y = 0,
          n = 0,
          r2 = 0;
        for (; n < N; n++) {
          const nx = fr(fr(fr(x * x) - fr(y * y)) + cr);
          y = fr(fr(2 * fr(x * y)) + ci);
          x = nx;
          r2 = x * x + y * y;
          if (r2 > BAIL * BAIL) break;
        }
        v = n >= N ? N + 1 : n + 2 - Math.log2(Math.log(r2) / 2 / Math.log(BAIL));
      } else v = nu(re, im, M2, N, BAIL);
      const k = (j * W + i) * 4;
      if (v > N) {
        img.data.set([0, 0, 0, 255], k);
        continue;
      }
      const t = (((Math.log(v + 1) * den) % 1) + 1) % 1,
        q = t * st.length,
        a = Math.floor(q),
        b = (a + 1) % st.length,
        w = q - a;
      img.data.set([0, 1, 2].map((ch) => st[a][ch] * (1 - w) + st[b][ch] * w).concat(255), k);
    }
  c.putImageData(img, 0, 0);
  return cv;
}

const DRAWS: ((c: G, C: Cols) => void)[] = [
  /* 1 くり返しと発散: 半径 2 の円、逃げる軌道と円の中に残る軌道 */
  (c, C) => {
    const P = mapper(-0.3, 0, 2.3);
    const [ox, oy] = P(0, 0),
      r = (2 / 2.3) * (CH / 2);
    c.strokeStyle = C.grid;
    c.setLineDash([3, 3]);
    c.beginPath();
    c.arc(ox, oy, r, 0, 7);
    c.stroke();
    c.setLineDash([]);
    poly(
      c,
      orbitPts(-0.3, 0.5, 40).map(([x, y]) => P(x, y)),
      C.b,
    );
    poly(
      c,
      orbitPts(0.38, 0.32, 40).map(([x, y]) => P(x, y)),
      C.a,
    );
    label(c, '|z| = 2', ox + r - 2, oy - r + 12, C.ink, 'right');
  },
  /* 2 逃げる速さで色 */
  (c) => c.drawImage(field(-0.6, 0, 1.25, 120, false), 0, 0, CW, CH),
  /* 3 単精度の限界: 左が単精度、右が倍精度。×10⁶ の二重の渦 */
  (c, C) => {
    const cx = -0.77568377,
      cy = 0.13646737,
      h = 5e-7;
    /* 同じ場所を左右に半分ずつ */
    c.drawImage(field(cx, cy, h, 1600, true, 3), 0, 0, CW / 2, CH, 0, 0, CW / 2, CH);
    c.drawImage(field(cx, cy, h, 1600, false, 3), CW / 2, 0, CW / 2, CH, CW / 2, 0, CW / 2, CH);
    c.fillStyle = C.scr;
    c.fillRect(CW / 2 - 1, 0, 2, CH);
    for (const [s, x] of [
      ['単精度', 4],
      ['倍精度', CW / 2 + 4],
    ] as const) {
      c.fillStyle = 'rgba(0,0,0,.6)';
      c.fillRect(x - 2, 3, 44, 16);
      label(c, s, x, 15, '#e6e8e4');
    }
  },
  /* 4 基準の点と差: 基準の軌道（青）と近くの点の軌道（黄）、差を細い線で */
  (c, C) => {
    const P = mapper(-0.2, 0.32, 0.5);
    const A = orbitPts(-0.2, 0.62, 14),
      B = orbitPts(-0.16, 0.66, 14);
    c.strokeStyle = C.grid;
    c.lineWidth = 1;
    for (let k = 1; k < Math.min(A.length, B.length); k++) {
      const [ax, ay] = P(...A[k]),
        [bx, by] = P(...B[k]);
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(bx, by);
      c.stroke();
    }
    poly(
      c,
      A.slice(1).map(([x, y]) => P(x, y)),
      C.b,
    );
    poly(
      c,
      B.slice(1).map(([x, y]) => P(x, y)),
      C.a,
    );
    label(c, 'Z（基準）', 4, CH - 6, C.b);
    label(c, 'z = Z + δ', CW - 4, CH - 6, C.a, 'right');
  },
  /* 5 基準の初めへ戻す: 使う基準の番号 m（縦）と反復の回数 n（横）。m が 0 へ落ちる所が戻した所 */
  (c, C) => {
    const ms = rebaseTrace(
      -0.743643887037158 + 2e-6,
      0.131825904205312 - 1e-6,
      -0.743643887037158,
      0.131825904205312,
      400,
    );
    const top = Math.max(...ms, 1);
    c.strokeStyle = C.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(4, CH - 14);
    c.lineTo(CW - 4, CH - 14);
    c.stroke();
    c.strokeStyle = C.a;
    c.lineWidth = 1.4;
    c.beginPath();
    ms.forEach((m, n) => {
      const x = 4 + (n / (ms.length - 1)) * (CW - 8),
        y = CH - 14 - (m / top) * (CH - 30);
      n ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.stroke();
    label(c, 'm', 4, 12, C.ink);
    label(c, 'n →', CW - 4, CH - 2, C.ink, 'right');
  },
];

/** 倍精度で摂動法とリベースをたどり、各回で使った基準の番号を返す（図 5 用） */
function rebaseTrace(cr: number, ci: number, Cr: number, Ci: number, N: number): number[] {
  const Z = orbitPts(Cr, Ci, N);
  const dcr = cr - Cr,
    dci = ci - Ci,
    out: number[] = [];
  let dr = 0,
    di = 0,
    m = 0;
  for (let n = 0; n < N; n++) {
    const [X, Y] = Z[m];
    [dr, di] = [2 * (X * dr - Y * di) + dr * dr - di * di + dcr, 2 * (X * di + Y * dr) + 2 * dr * di + dci];
    m++;
    const zr = Z[m][0] + dr,
      zi = Z[m][1] + di,
      r2 = zr * zr + zi * zi;
    out.push(m);
    if (r2 > 4) break;
    if (r2 < dr * dr + di * di || m >= Z.length - 1) {
      dr = zr;
      di = zi;
      m = 0;
    }
  }
  return out;
}

export function mountHow(host: HTMLElement): void {
  const dpr = Math.min(2, devicePixelRatio || 1),
    cards = [...host.querySelectorAll<HTMLCanvasElement>('canvas')].map((cv, i) => {
      cv.width = CW * dpr;
      cv.height = CH * dpr;
      return { c: cv.getContext('2d') as G, d: DRAWS[i] };
    });
  const draw = (): void => {
    const css = getComputedStyle(document.documentElement),
      v = (n: string): string => css.getPropertyValue(n).trim(),
      C = { a: v('--ch1'), b: v('--ch2'), ink: v('--screen-ink'), grid: v('--grid-2'), scr: v('--screen') };
    for (const k of cards) {
      if (!k.d) continue;
      k.c.setTransform(dpr, 0, 0, dpr, 0, 0);
      k.c.clearRect(0, 0, CW, CH);
      k.d(k.c, C);
    }
  };
  /* 見えてから 1 度だけ描く（画素ごとの計算が少し重い） */
  let shown = false;
  new IntersectionObserver((e) => {
    if (shown || !e[e.length - 1].isIntersecting) return;
    shown = true;
    draw();
  }).observe(host);
  new MutationObserver(() => shown && draw()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => shown && draw());
}

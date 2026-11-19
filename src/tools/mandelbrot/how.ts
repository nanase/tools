/**
 * しくみの枠の 5 つの図。止まっているときは完成した絵で、工程のカードに指を乗せると初めから順に進む（lib/how-anim.ts）。
 * 3 は単精度を模した計算（演算ごとに Math.fround）と倍精度の計算を並べ、拡大していくと左だけ四角く崩れる
 */
import { type HowFig, mountHowAnim } from '../../lib/how-anim';
import { BAIL, type Formula, maxIter, nu } from './formula';
import { palOf } from './palette';
import { fmtZoom } from './view';

type G = CanvasRenderingContext2D;
const CW = 172,
  CH = 104;
const M2: Formula = { p: 2, pre: 0, post: 0, conj: false };
const C = { a: '', b: '', ink: '', grid: '', scr: '' };

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
function poly(c: G, pts: readonly (readonly [number, number])[], col: string): void {
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineWidth = 1.2;
  c.beginPath();
  for (const [i, [x, y]] of pts.entries()) {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  }
  c.stroke();
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
/** 絵の上に重ねる札（暗い地に白い字） */
function tag(c: G, s: string, x: number, y: number): void {
  c.font = '500 11px "Fira Mono",ui-monospace,Consolas,monospace';
  const w = c.measureText(s).width;
  c.fillStyle = 'rgba(0,0,0,.65)';
  c.fillRect(x - 2, y - 12, w + 4, 16);
  label(c, s, x, y, '#e6e8e4');
}

/** 画素ごとの発散の速さ ν（f32 なら単精度を模す）。発散しなければ N + 1 */
function values(cx: number, cy: number, h: number, N: number, f32: boolean): Float32Array {
  const out = new Float32Array(CW * CH),
    fr = Math.fround;
  for (let j = 0; j < CH; j++)
    for (let i = 0; i < CW; i++) {
      const re = cx + ((i - CW / 2) / (CH / 2)) * h,
        im = cy + ((j - CH / 2) / (CH / 2)) * h;
      if (!f32) {
        out[j * CW + i] = nu(re, im, M2, N, BAIL);
        continue;
      }
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
      out[j * CW + i] = n >= N ? N + 1 : n + 2 - Math.log2(Math.log(r2) / 2 / Math.log(BAIL));
    }
  return out;
}

/** ν を配色の帯で塗った絵。lim より遅く発散する点（と内側）は黒。putImageData は拡大されないので別の canvas に作る */
function paint(v: Float32Array, lim: number, den: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = CW;
  cv.height = CH;
  const c = cv.getContext('2d') as G,
    img = c.createImageData(CW, CH),
    st = palOf('sun').s;
  for (let i = 0; i < v.length; i++) {
    const k = i * 4;
    if (v[i] > lim) {
      img.data.set([0, 0, 0, 255], k);
      continue;
    }
    const t = (((Math.log(v[i] + 1) * den) % 1) + 1) % 1,
      q = t * st.length,
      a = Math.floor(q),
      b = (a + 1) % st.length,
      w = q - a;
    img.data.set(
      [st[a][0] * (1 - w) + st[b][0] * w, st[a][1] * (1 - w) + st[b][1] * w, st[a][2] * (1 - w) + st[b][2] * w, 255],
      k,
    );
  }
  c.putImageData(img, 0, 0);
  return cv;
}

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

/* 1 くり返しと発散: 半径 2 の円。0 と −1 を行き来して円の中に残る軌道（青）と、11 歩さまよってから円をわずかに抜ける軌道（黄）を 1 点ずつ */
const O1 = { in: orbitPts(-1, 0, 24), out: escapePts(-0.89, 0.28) };
/** 円 |z| = 2 を最初に抜けた点までの軌道 */
function escapePts(cr: number, ci: number): [number, number][] {
  const o = orbitPts(cr, ci, 60),
    i = o.findIndex(([x, y]) => x * x + y * y > 4);
  return i < 0 ? o : o.slice(0, i + 1);
}
const F1: HowFig = {
  dur: 3,
  draw(c, k) {
    const P = mapper(0, 0, 2.2),
      [ox, oy] = P(0, 0),
      r = (2 / 2.2) * (CH / 2),
      n = 1 + Math.round(k * 23);
    c.strokeStyle = C.grid;
    c.setLineDash([3, 3]);
    c.beginPath();
    c.arc(ox, oy, r, 0, 7);
    c.stroke();
    c.setLineDash([]);
    poly(
      c,
      O1.in.slice(0, n + 1).map(([x, y]) => P(x, y)),
      C.b,
    );
    const out = O1.out.slice(0, n + 1);
    poly(
      c,
      out.map(([x, y]) => P(x, y)),
      C.a,
    );
    /* 円を抜けたら、その点に札 */
    if (out.length === O1.out.length) {
      const [ex, ey] = P(...out[out.length - 1]);
      label(c, '発散', ex + (ex < ox ? -5 : 5), ey + 4, C.a, ex < ox ? 'right' : 'left');
    }
    label(c, '|z| = 2', CW - 4, 12, C.ink, 'right');
    label(c, `n = ${n}`, 4, CH - 6, C.ink);
  },
};

/* 2 発散する速さで色: くり返しの回数を増やすと、外側から順に色が付き、残った黒が集合 */
let v2: Float32Array | null = null;
const F2: HowFig = {
  dur: 3,
  draw(c, k) {
    v2 ??= values(-0.6, 0, 1.25, 120, false);
    const lim = k >= 1 ? 120 : 1 + Math.round(k * 23);
    c.drawImage(paint(v2, lim, 0.55), 0, 0, CW, CH);
    tag(c, k >= 1 ? 'n ≤ 120' : `n ≤ ${lim}`, 4, CH - 5);
  },
};

/* 3 単精度の限界: 二重の渦へ拡大していく。左が単精度、右が倍精度。深くなると左だけ四角く崩れる */
const Z3 = { cx: -0.77568377, cy: 0.13646737, h0: 0.05, h1: 5e-7, steps: 8 };
const c3 = new Map<number, HTMLCanvasElement>();
function level3(i: number): HTMLCanvasElement {
  let cv = c3.get(i);
  if (cv) return cv;
  const h = Z3.h0 * (Z3.h1 / Z3.h0) ** (i / (Z3.steps - 1)),
    N = Math.min(1600, maxIter(1 / h)),
    a = paint(values(Z3.cx, Z3.cy, h, N, true), N, 3),
    b = paint(values(Z3.cx, Z3.cy, h, N, false), N, 3);
  cv = document.createElement('canvas');
  cv.width = CW;
  cv.height = CH;
  const g = cv.getContext('2d') as G;
  /* 同じ場所を左右に半分ずつ */
  g.drawImage(a, 0, 0, CW / 2, CH, 0, 0, CW / 2, CH);
  g.drawImage(b, CW / 2, 0, CW / 2, CH, CW / 2, 0, CW / 2, CH);
  c3.set(i, cv);
  return cv;
}
let warm3 = false;
const F3: HowFig = {
  dur: 4,
  draw(c, k) {
    /* 初めて描いたら、ほかの段を少しずつ裏で作っておく（乗せたときに止まらないように） */
    if (!warm3) {
      warm3 = true;
      let i = 0;
      const next = (): void => {
        if (i >= Z3.steps) return;
        level3(i++);
        setTimeout(next, 30);
      };
      setTimeout(next, 300);
    }
    const i = Math.min(Z3.steps - 1, Math.floor(k * Z3.steps)),
      h = Z3.h0 * (Z3.h1 / Z3.h0) ** (i / (Z3.steps - 1));
    c.drawImage(level3(i), 0, 0, CW, CH);
    c.fillStyle = C.scr;
    c.fillRect(CW / 2 - 1, 0, 2, CH);
    tag(c, '単精度', 4, 15);
    tag(c, '倍精度', CW / 2 + 4, 15);
    tag(c, fmtZoom(1 / h), 4, CH - 5);
  },
};

/* 4 基準の点と差: 基準の軌道（青）と近くの点の軌道（黄）を 1 歩ずつ。差を細い線で結ぶ */
const O4 = { A: orbitPts(-0.2, 0.62, 14), B: orbitPts(-0.16, 0.66, 14) };
const F4: HowFig = {
  dur: 3,
  draw(c, k) {
    const P = mapper(-0.2, 0.32, 0.5),
      n = 1 + Math.round(k * 13),
      A = O4.A.slice(1, n + 1),
      B = O4.B.slice(1, n + 1);
    c.strokeStyle = C.grid;
    c.lineWidth = 1;
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      const [ax, ay] = P(...A[i]),
        [bx, by] = P(...B[i]);
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(bx, by);
      c.stroke();
    }
    poly(
      c,
      A.map(([x, y]) => P(x, y)),
      C.b,
    );
    poly(
      c,
      B.map(([x, y]) => P(x, y)),
      C.a,
    );
    label(c, 'Z（基準）', 4, CH - 6, C.b);
    label(c, 'z = Z + δ', CW - 4, CH - 6, C.a, 'right');
  },
};

/* 5 基準の初めへ戻す: 使う基準の番号 m（縦）と回数 n（横）。m が 0 へ落ちる所が初めへ戻した所 */
const M5 = rebaseTrace(-0.743643887037158 + 2e-6, 0.131825904205312 - 1e-6, -0.743643887037158, 0.131825904205312, 400);
const F5: HowFig = {
  dur: 4,
  draw(c, k) {
    const top = Math.max(...M5, 1),
      n = Math.max(2, Math.round(k * M5.length)),
      X = (i: number) => 4 + (i / (M5.length - 1)) * (CW - 8),
      Y = (m: number) => CH - 14 - (m / top) * (CH - 30);
    c.strokeStyle = C.grid;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(4, CH - 14);
    c.lineTo(CW - 4, CH - 14);
    c.stroke();
    c.strokeStyle = C.a;
    c.lineWidth = 1.4;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      if (i) c.lineTo(X(i), Y(M5[i]));
      else c.moveTo(X(i), Y(M5[i]));
    }
    c.stroke();
    /* 戻した所に点 */
    c.fillStyle = C.b;
    for (let i = 1; i < n; i++)
      if (M5[i] < M5[i - 1]) {
        c.beginPath();
        c.arc(X(i), Y(M5[i]), 2.4, 0, 7);
        c.fill();
      }
    label(c, 'm', 4, 12, C.ink);
    label(c, 'n →', CW - 4, CH - 2, C.ink, 'right');
  },
};

export function mountHow(host: HTMLElement): void {
  mountHowAnim(host, [F1, F2, F3, F4, F5], {
    w: CW,
    h: CH,
    prepare() {
      const css = getComputedStyle(document.documentElement),
        v = (n: string): string => css.getPropertyValue(n).trim();
      Object.assign(C, {
        a: v('--ch1'),
        b: v('--ch2'),
        ink: v('--screen-ink'),
        grid: v('--grid-2'),
        scr: v('--screen'),
      });
    },
  });
}

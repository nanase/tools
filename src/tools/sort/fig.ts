/** ソートの棒グラフと補助配列の描画（canvas） */
import type { Run } from './run';

export interface Shown {
  pivot: boolean;
  range: boolean;
  fix: boolean;
  info: boolean;
  aux: boolean;
}

interface Colors {
  screen: string;
  fix: string;
  ink2: string;
  sink: string;
  grid: string;
  ch1: string;
  ch2: string;
  pv: string;
  ok: string;
  ac: string;
  mono: string;
}
let C: Colors;

/** テーマの色を読み直す（テーマを変えたとき） */
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    g = (k: string) => s.getPropertyValue(k).trim();
  C = {
    screen: g('--screen'),
    fix: g('--so-fix'),
    ink2: g('--ink-2'),
    sink: g('--screen-ink'),
    grid: g('--grid'),
    ch1: g('--ch1'),
    ch2: g('--ch2'),
    pv: g('--so-pv'),
    ok: g('--so-ok'),
    ac: g('--accent'),
    mono: g('--mono'),
  };
}

function fitCanvas(cv: HTMLCanvasElement): { c: CanvasRenderingContext2D; W: number; H: number } | null {
  const d = Math.min(2, devicePixelRatio || 1),
    W = cv.clientWidth,
    H = cv.clientHeight,
    c = cv.getContext('2d');
  if (!c || W < 2 || H < 2) return null;
  const w = Math.round(W * d),
    h = Math.round(H * d);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  c.setTransform(d, 0, 0, d, 0, 0);
  return { c, W, H };
}

/** バーの左端と幅（画素の境目にそろえ、幅が 4 px 以上なら間を 1 px 空ける） */
function columns(n: number, W: number): { x: (i: number) => number; w: (i: number) => number; bw: number } {
  const bw = W / n,
    gap = bw >= 4 ? 1 : 0;
  return {
    bw,
    x: (i) => Math.round(i * bw),
    w: (i) => Math.max(1, Math.round((i + 1) * bw) - Math.round(i * bw) - gap),
  };
}

export function drawBars(cv: HTMLCanvasElement, r: Run, s: Shown, small: boolean): void {
  const f = fitCanvas(cv);
  if (!f) return;
  const { c, W, H } = f,
    { n, a, vm } = { n: r.n, a: r.a, vm: r.vm },
    top = small ? 4 : 14,
    hh = H - top - 1,
    hOf = (v: number) => Math.max(1, (v / vm) * hh),
    { x, w, bw } = columns(n, W);
  c.fillStyle = C.screen;
  c.fillRect(0, 0, W, H);
  if (s.range && r.rlo >= 0 && !r.ok) {
    c.fillStyle = C.grid;
    c.fillRect(x(r.rlo), 0, x(r.rhi + 1) - x(r.rlo), H);
  }
  const done = r.ok ? n : r.sweep >= 0 ? r.sweep : 0;
  for (let i = 0; i < n; i++) {
    if (i < done) {
      c.globalAlpha = 1;
      c.fillStyle = C.ok;
    } else if (s.fix && r.fixd[i]) {
      c.globalAlpha = 1;
      c.fillStyle = C.fix;
    } else {
      c.globalAlpha = 0.62;
      c.fillStyle = C.sink;
    }
    const h = hOf(a[i]);
    c.fillRect(x(i), H - h, w(i), h);
  }
  c.globalAlpha = 1;
  if (r.ok || r.sweep >= 0) return;
  if (s.pivot) {
    c.fillStyle = C.pv;
    for (const p of [r.p1, r.p2])
      if (p >= 0) {
        const h = hOf(a[p]);
        c.fillRect(x(p), H - h, w(p), h);
      }
    /* ピボットの高さの水平線。範囲を出している間は範囲の幅だけ */
    const lv = r.pv >= 0 ? [r.pv] : [r.p1, r.p2].filter((p) => p >= 0).map((p) => a[p]),
      inRange = s.range && r.rlo >= 0,
      x0 = inRange ? x(r.rlo) : 0,
      x1 = inRange ? x(r.rhi + 1) : W;
    c.strokeStyle = C.pv;
    c.lineWidth = 1;
    c.setLineDash([4, 3]);
    for (const v of lv) {
      const y = Math.round(H - hOf(v)) + 0.5;
      c.beginPath();
      c.moveTo(x0, y);
      c.lineTo(x1, y);
      c.stroke();
    }
    c.setLineDash([]);
  }
  for (let k = 0; k < r.ti.length; k++) {
    const kd = r.tk[k];
    if (kd > 1) continue;
    const i = r.ti[k],
      h = hOf(a[i]);
    c.fillStyle = kd ? C.ch1 : C.ch2;
    c.fillRect(x(i), H - h, w(i), h);
    /* バーが細いと色が見えないので、足もとに印を付ける */
    if (bw < 3) {
      c.fillStyle = C.ac;
      c.fillRect(x(i) - 1, H - 4, w(i) + 2, 4);
    }
  }
  if (s.info && r.inf >= 0 && !small && r.alg.inf) {
    c.font = `500 12px ${C.mono}`;
    c.fillStyle = C.ink2;
    c.textBaseline = 'top';
    c.fillText(`${r.alg.inf} ${r.inf}`, 6, 2);
  }
}

export function drawAux(cv: HTMLCanvasElement, r: Run): void {
  const f = fitCanvas(cv);
  if (!f) return;
  const { c, W, H } = f;
  c.fillStyle = C.screen;
  c.fillRect(0, 0, W, H);
  const X = r.x;
  if (!X) return;
  const { x, w } = columns(X.length, W),
    hh = H - 4;
  c.globalAlpha = 0.62;
  c.fillStyle = C.sink;
  for (let i = 0; i < X.length; i++)
    if (X[i] > 0) {
      const h = Math.max(1, (X[i] / r.vm) * hh);
      c.fillRect(x(i), H - h, w(i), h);
    }
  c.globalAlpha = 1;
  for (let k = 0; k < r.ti.length; k++) {
    if (r.tk[k] < 2) continue;
    const i = r.ti[k],
      h = Math.max(2, (X[i] / r.vm) * hh);
    c.fillStyle = r.tk[k] === 3 ? C.ch1 : C.ch2;
    c.fillRect(x(i), H - h, w(i), h);
  }
}

/** PCM のページの図（canvas）: 波形とスペクトル。色はサイトの変数から読む */

import { g711Levels, type Law, levelValue, mod, stepOf } from './pcm';
import { kHzLabel } from './text';

export interface Col {
  screen: string;
  grid: string;
  grid2: string;
  ink: string;
  ink2: string;
  ink3: string;
  ch1: string;
  ch2: string;
  err: string;
  accent: string;
  mono: string;
  sans: string;
}
export const COL: Col = {
  screen: '',
  grid: '',
  grid2: '',
  ink: '',
  ink2: '',
  ink3: '',
  ch1: '',
  ch2: '',
  err: '',
  accent: '',
  mono: 'monospace',
  sans: 'sans-serif',
};
export function readCols(root: Element): void {
  const c = getComputedStyle(root),
    v = (k: string) => c.getPropertyValue(k).trim();
  COL.screen = v('--screen');
  COL.grid = v('--grid');
  COL.grid2 = v('--grid-2');
  COL.ink = v('--ink');
  COL.ink2 = v('--ink-2');
  COL.ink3 = v('--ink-3');
  COL.ch1 = v('--ch1');
  COL.ch2 = v('--ch2');
  COL.err = v('--pcm-e');
  COL.accent = v('--accent');
  COL.mono = v('--mono');
  COL.sans = v('--sans');
}

/** 描く面を用意する（CSS の大きさに合わせる）。隠れていれば null */
export function surface(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const r = c.getBoundingClientRect(),
    d = Math.min(2, devicePixelRatio || 1),
    W = Math.round(r.width * d),
    H = Math.round(r.height * d);
  if (!W || !H) return null;
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
}

/** 上向きに 0 を横切る時刻 [s]（周期の音で図が止まって見えるように合わせる） */
export function trigger(x: ArrayLike<number>, F: number, t: number): number {
  const n = x.length,
    i = Math.floor(t * F);
  for (let j = 0; j < F / 30; j++) {
    const a = x[(i + j) % n],
      b = x[(i + j + 1) % n];
    if (a <= 0 && b > 0) return ((i + j) % n) / F;
  }
  return i / F;
}
/** 列 x を時刻 t で読む（線形補間、端はくり返す） */
export const readAt = (x: ArrayLike<number>, F: number, t: number): number => {
  const q = t * F,
    j = Math.floor(q),
    f = q - j,
    n = x.length;
  return x[mod(j, n)] * (1 - f) + x[mod(j + 1, n)] * f;
};

export const yAxisLabel = (g: CanvasRenderingContext2D, x: number, y: number, t: string): void => {
  g.save();
  g.translate(x, y);
  g.rotate(-Math.PI / 2);
  g.font = `12px ${COL.sans}`;
  g.fillStyle = COL.ink2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(t, 0, 0);
  g.restore();
};
export const timeLabel = (g: CanvasRenderingContext2D, x: number, y: number, ms: number): void => {
  g.font = `12px ${COL.sans}`;
  g.fillStyle = COL.ink2;
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillText(`時間 → ${ms} ms`, x, y);
};
/** レベルの値の一覧 [順位, 値]（昇順）。多すぎるとき（線形の 8 bit より細かい）は null */
export function levelList(N: number, law: Law): [number, number][] | null {
  if (law !== 'lin') return Array.from(g711Levels(law), (v, i) => [i, v] as [number, number]);
  if (N > 8) return null;
  if (N === 1)
    return [
      [-1, -0.5],
      [0, 0.5],
    ];
  const L = 2 ** (N - 1),
    o: [number, number][] = [];
  for (let k = -L; k < L; k++) o.push([k, levelValue(k, N)]);
  return o;
}
/** 2 の補数のビット列（負の値も N 桁） */
export const bitStr = (c: number, N: number): string => ((c >>> 0) % 2 ** N).toString(2).padStart(N, '0');

export interface ScopeOpt {
  F: number;
  fs: number;
  /** 表示の始まり [s] と幅 [ms] */
  t: number;
  ms: number;
  /** 入力 */
  x: ArrayLike<number>;
  /** 標本（点と縦線） */
  s?: ArrayLike<number>;
  /** 線で描く出力: stair は階段（y を fs ごとに保持）、o は F の列 */
  stair?: ArrayLike<number>;
  o?: ArrayLike<number>;
  /** 量子化の線と誤差の帯 */
  bits?: number;
  law?: Law;
  e?: ArrayLike<number>;
}
export function drawScope(c: HTMLCanvasElement, o: ScopeOpt): void {
  const a = surface(c);
  if (!a) return;
  const { g, w: W, h: H } = a,
    L = Math.min(46, W * 0.11),
    Rm = 6,
    top = 8,
    errH = o.e ? Math.round(H * 0.18) : 0,
    gap = o.e ? 14 : 0,
    mainH = H - top - errH - gap - 18,
    PW = W - L - Rm,
    cy = top + mainH / 2,
    A = mainH / 2 / 1.08,
    yv = (v: number) => cy - v * A,
    win = o.ms / 1000,
    t0 = o.t,
    xt = (t: number) => L + ((t - t0) / win) * PW;
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  g.font = `10.5px ${COL.mono}`;
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  const N = o.bits;
  const lv = N != null ? levelList(N, o.law ?? 'lin') : null;
  if (lv) {
    g.lineWidth = 1;
    g.strokeStyle = COL.grid;
    let last = 1e9;
    for (const [, v] of lv) {
      const y = Math.round(yv(v)) + 0.5;
      if (Math.abs(y - last) < 2.4) continue;
      g.beginPath();
      g.moveTo(L, y);
      g.lineTo(W - Rm, y);
      g.stroke();
      last = y;
    }
    if (N != null && N <= 5 && (o.law ?? 'lin') === 'lin' && A * stepOf(N) >= 11) {
      g.fillStyle = COL.ink3;
      for (const [k, v] of lv) g.fillText(bitStr(k, N), L - 3, yv(v));
    }
  }
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(L, Math.round(cy) + 0.5);
  g.lineTo(W - Rm, Math.round(cy) + 0.5);
  g.stroke();
  yAxisLabel(g, 11, cy, '振幅');
  if (!(lv && N != null && N <= 5 && (o.law ?? 'lin') === 'lin' && A * stepOf(N) >= 11)) {
    g.font = `10.5px ${COL.mono}`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillStyle = COL.ink3;
    g.fillText('+1', L - 4, yv(1));
    g.fillText('0', L - 4, cy);
    g.fillText('−1', L - 4, yv(-1));
  }
  timeLabel(g, W - Rm, H - 2, o.ms);
  const fs = o.fs,
    n0 = Math.floor(t0 * fs),
    n1 = Math.ceil((t0 + win) * fs),
    dx = PW / (win * fs);
  /* 標本の縦線 */
  if (o.s && dx >= 3) {
    const s = o.s,
      Nf = s.length;
    g.strokeStyle = COL.grid2;
    g.beginPath();
    for (let n = n0; n <= n1; n++) {
      const x = Math.round(xt(n / fs)) + 0.5;
      if (x < L || x > W - Rm) continue;
      g.moveTo(x, cy);
      g.lineTo(x, yv(s[mod(n, Nf)]));
    }
    g.stroke();
  }
  /* 入力 */
  const curve = (arr: ArrayLike<number>) => {
    g.beginPath();
    for (let px = 0; px <= PW; px += 0.5) {
      const y = yv(readAt(arr, o.F, t0 + (px / PW) * win));
      if (px) g.lineTo(L + px, y);
      else g.moveTo(L + px, y);
    }
    g.stroke();
  };
  g.strokeStyle = COL.ch2;
  g.lineWidth = 1.2;
  curve(o.x);
  /* 出力 */
  g.strokeStyle = COL.ch1;
  g.lineWidth = 1.6;
  if (o.stair) {
    const y = o.stair,
      Nf = y.length;
    g.beginPath();
    let first = true;
    for (let n = n0; n <= n1; n++) {
      const X0 = Math.max(L, Math.min(W - Rm, xt(n / fs))),
        X1 = Math.max(L, Math.min(W - Rm, xt((n + 1) / fs))),
        Y = yv(y[mod(n, Nf)]);
      if (first) {
        g.moveTo(X0, Y);
        first = false;
      } else g.lineTo(X0, Y);
      g.lineTo(X1, Y);
    }
    g.stroke();
  } else if (o.o) curve(o.o);
  /* 標本の点 */
  if (o.s && dx >= 4) {
    const s = o.s,
      Nf = s.length,
      rr = Math.max(1.8, Math.min(3.6, dx * 0.22));
    g.fillStyle = COL.ch2;
    for (let n = n0; n <= n1; n++) {
      const X = xt(n / fs);
      if (X < L - 1 || X > W - Rm + 1) continue;
      g.beginPath();
      g.arc(X, yv(s[mod(n, Nf)]), rr, 0, Math.PI * 2);
      g.fill();
    }
  }
  /* 誤差の帯 */
  if (o.e && N != null) {
    const ey = top + mainH + gap + errH / 2,
      sc = (errH / 2 - 1) / stepOf(o.law && o.law !== 'lin' ? 6 : N),
      Nf = o.e.length;
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(L, Math.round(ey) + 0.5);
    g.lineTo(W - Rm, Math.round(ey) + 0.5);
    g.stroke();
    g.strokeStyle = COL.err;
    g.lineWidth = Math.max(1, Math.min(dx * 0.5, 2.4));
    g.beginPath();
    for (let n = n0; n <= n1; n++) {
      const X = xt(n / fs);
      if (X < L || X > W - Rm) continue;
      const v = Math.max(-errH / 2, Math.min(errH / 2, o.e[mod(n, Nf)] * sc));
      g.moveTo(X, ey);
      g.lineTo(X, ey - v);
    }
    g.stroke();
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillStyle = COL.err;
    g.font = `10.5px ${COL.sans}`;
    g.fillText('誤差', L - 4, ey);
  }
}

export interface Series {
  sp: Float64Array;
  /** 1 ビンの幅 [Hz] */
  bin: number;
  col: string;
  lw: number;
  fill?: boolean;
}
/** スペクトル。ny があれば、その周波数に破線を引いて上を薄く塗る（表せない範囲） */
export function drawSpec(c: HTMLCanvasElement, F: number, ny: number | null, series: Series[]): void {
  const a = surface(c);
  if (!a) return;
  const { g, w: W, h: H } = a,
    L = 34,
    Rm = 8,
    T = 18,
    B = 20,
    PW = W - L - Rm,
    PH = H - T - B,
    fMax = F / 2,
    dbMin = -120,
    X = (f: number) => L + (f / fMax) * PW,
    Y = (db: number) => T + (Math.max(dbMin, Math.min(0, db)) / dbMin) * PH;
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  g.font = `10.5px ${COL.mono}`;
  if (ny != null && ny < fMax) {
    g.fillStyle = COL.grid;
    g.globalAlpha = 0.45;
    g.fillRect(X(ny), T, X(fMax) - X(ny), PH);
    g.globalAlpha = 1;
  }
  g.lineWidth = 1;
  g.strokeStyle = COL.grid;
  g.fillStyle = COL.ink3;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let d = 0; d >= dbMin; d -= 20) {
    const y = Math.round(Y(d)) + 0.5;
    g.beginPath();
    g.moveTo(L, y);
    g.lineTo(W - Rm, y);
    g.stroke();
    g.fillText(`${d}`.replace('-', '−'), L - 4, y);
  }
  g.textAlign = 'left';
  g.textBaseline = 'bottom';
  g.fillText('dB', 4, T - 3);
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const kMax = fMax / 1000,
    stepK = PW < 420 ? 8 : 4;
  let endK: number | null = null;
  for (let k = 0; k <= kMax + 1e-9; k += stepK) {
    const x = Math.round(X(k * 1000)) + 0.5;
    g.beginPath();
    g.moveTo(x, T);
    g.lineTo(x, T + PH);
    g.stroke();
    /* 単位と重なる右端の数は、単位の文字に含める */
    if (X(k * 1000) < W - Rm - 34) g.fillText(`${k}`, x, T + PH + 5);
    else endK = k;
  }
  g.textAlign = 'right';
  g.fillText(endK == null ? 'kHz' : `${endK} kHz`, W - Rm, T + PH + 5);
  for (const q of series) {
    const cols = new Float64Array(Math.ceil(PW) + 2).fill(-999);
    for (let k = 0; k < q.sp.length; k++) {
      const f = k * q.bin;
      if (f > fMax) break;
      const px = Math.round(X(f) - L);
      if (q.sp[k] > cols[px]) cols[px] = q.sp[k];
    }
    const path = () => {
      g.beginPath();
      let st = false,
        xl = L;
      for (let px = 0; px < cols.length; px++) {
        if (cols[px] === -999) continue;
        const x = L + px,
          y = Y(cols[px]);
        if (st) g.lineTo(x, y);
        else {
          g.moveTo(x, y);
          st = true;
        }
        xl = x;
      }
      return xl;
    };
    if (q.fill) {
      const xl = path();
      g.save();
      g.globalAlpha = 0.16;
      g.fillStyle = q.col;
      g.lineTo(xl, T + PH);
      g.lineTo(L, T + PH);
      g.closePath();
      g.fill();
      g.restore();
    }
    path();
    g.strokeStyle = q.col;
    g.lineWidth = q.lw;
    g.stroke();
  }
  if (ny != null && ny < fMax) {
    const x = Math.round(X(ny)) + 0.5,
      right = x > W - 170;
    g.setLineDash([4, 3]);
    g.strokeStyle = COL.ink;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, T - 4);
    g.lineTo(x, T + PH);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = COL.ink;
    g.textBaseline = 'bottom';
    g.textAlign = right ? 'right' : 'left';
    g.font = `700 11.5px ${COL.sans}`;
    g.fillText(`ナイキスト周波数 ${kHzLabel(ny)} kHz`, x + (right ? -4 : 4), T - 3);
  }
}

/** 波形の全体（再生の位置の欄） */
export function drawOverview(c: HTMLCanvasElement, x: ArrayLike<number>, col: string): void {
  const a = surface(c);
  if (!a) return;
  const { g, w: W, h: H } = a,
    st = x.length / W,
    gain = 0.45 * H,
    hop = Math.max(1, Math.floor(st / 64));
  g.clearRect(0, 0, W, H);
  g.fillStyle = col;
  for (let px = 0; px < W; px++) {
    let lo = 0,
      hi = 0;
    const i1 = Math.floor((px + 1) * st);
    for (let i = Math.floor(px * st); i < i1; i += hop) {
      const v = x[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const y0 = H / 2 - Math.min(1, hi) * gain,
      y1 = H / 2 - Math.max(-1, lo) * gain;
    g.fillRect(px, y0, 1, Math.max(1, y1 - y0));
  }
}

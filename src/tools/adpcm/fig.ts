/** ADPCM のページの図（canvas）: 全体・拡大・段階の間隔。色と面の用意は PCM のページの部品を使う */
import { COL, readAt, surface, timeLabel, yAxisLabel } from '../pcm/fig';
import { mod } from '../pcm/pcm';
import { delta } from './adpcm';
import type { Out } from './worker';

type Ctx = CanvasRenderingContext2D;

const line = (g: Ctx, x0: number, y0: number, x1: number, y1: number, col: string, lw = 1): void => {
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
};
/** 拡大の図の左の余白 */
const left = (W: number) => Math.min(46, W * 0.11);
/** 全体の図の左の余白（押した位置から時刻を求めるときにも使う） */
export const WHOLE_L = 52;
export const WHOLE_R = 6;
/** 段階の間隔の対数の目盛りの下端（表の最小の 7） */
const LOG0 = Math.log10(7 / 32768);

export interface Win {
  /** 表示の始まり [s] と幅 [ms] */
  t: number;
  ms: number;
}

/** 拡大の図: 原音・選べる段階・ADPCM の出力・誤差 */
export function drawZoom(c: HTMLCanvasElement, r: Out, w: Win): void {
  const a = surface(c);
  if (!a) return;
  const { g, w: W, h: H } = a,
    L = left(W),
    Rm = 6,
    top = 8,
    errH = Math.round(H * 0.18),
    gap = 14,
    mainH = H - top - errH - gap - 18,
    PW = W - L - Rm,
    cy = top + mainH / 2,
    A = mainH / 2 / 1.08,
    yv = (v: number) => cy - v * A,
    win = w.ms / 1000,
    xt = (t: number) => L + ((t - w.t) / win) * PW,
    fs = r.fs,
    n0 = Math.floor(w.t * fs),
    n1 = Math.ceil((w.t + win) * fs),
    dx = PW / (win * fs),
    Nf = r.y.length,
    N = r.bits,
    M = (1 << (N - 1)) - 1;
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  yAxisLabel(g, 11, cy, '振幅');
  g.font = `10.5px ${COL.mono}`;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillStyle = COL.ink3;
  g.fillText('+1', L - 4, yv(1));
  g.fillText('0', L - 4, cy);
  g.fillText('−1', L - 4, yv(-1));
  timeLabel(g, W - Rm, H - 2, w.ms);
  g.save();
  g.beginPath();
  g.rect(L, top, PW, mainH);
  g.clip();
  line(g, L, Math.round(cy) + 0.5, W - Rm, Math.round(cy) + 0.5, COL.grid2);
  /* 選べる段階: 間が開いていれば横線、狭ければ塗る */
  const tick = Math.min(dx * 0.82, 12);
  if (dx >= 5) {
    g.strokeStyle = COL.ink3;
    g.lineWidth = 1;
    g.globalAlpha = 0.75;
    g.beginPath();
    for (let n = n0; n <= n1; n++) {
      const X = xt(n / fs),
        i = mod(n, Nf),
        p = r.p[i],
        st = Math.round(r.st[i] * 32768);
      for (let m = 0; m <= M; m++) {
        const v = delta(m, st, N) / 32768;
        for (const s of [v, -v]) {
          const Y = Math.round(yv(p + s)) + 0.5;
          g.moveTo(X - tick / 2, Y);
          g.lineTo(X + tick / 2, Y);
        }
      }
    }
    g.stroke();
  } else {
    g.fillStyle = COL.ink3;
    g.globalAlpha = 0.28;
    for (let n = n0; n <= n1; n++) {
      const X = xt(n / fs),
        i = mod(n, Nf),
        v = delta(M, Math.round(r.st[i] * 32768), N) / 32768,
        y0 = yv(r.p[i] + v);
      g.fillRect(X - dx / 2, y0, Math.max(1, dx), Math.max(1, yv(r.p[i] - v) - y0));
    }
  }
  g.globalAlpha = 1;
  /* 原音 */
  g.strokeStyle = COL.ch2;
  g.lineWidth = 1.2;
  g.beginPath();
  for (let px = 0; px <= PW; px += 0.5) {
    const Y = yv(readAt(r.so, r.F, w.t + (px / PW) * win));
    if (px) g.lineTo(L + px, Y);
    else g.moveTo(L + px, Y);
  }
  g.stroke();
  /* 出力 */
  g.strokeStyle = COL.ch1;
  g.lineWidth = 1.6;
  g.beginPath();
  for (let n = n0; n <= n1; n++) {
    const Y = yv(r.y[mod(n, Nf)]);
    if (n === n0) g.moveTo(xt(n / fs), Y);
    else g.lineTo(xt(n / fs), Y);
    g.lineTo(xt((n + 1) / fs), Y);
  }
  g.stroke();
  if (dx >= 4) {
    g.fillStyle = COL.ch1;
    const rr = Math.max(1.8, Math.min(3.2, dx * 0.22));
    for (let n = n0; n <= n1; n++) {
      g.beginPath();
      g.arc(xt(n / fs), yv(r.y[mod(n, Nf)]), rr, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  /* 誤差の帯: 同じビット数の PCM の誤差も含めた最大に合わせる */
  let eMax = 1e-4;
  for (let n = n0; n <= n1; n++) {
    const i = mod(n, Nf);
    eMax = Math.max(eMax, Math.abs(r.e[i]), Math.abs(r.qe[i]));
  }
  const ey = top + mainH + gap + errH / 2,
    sc = (errH / 2 - 1) / eMax;
  line(g, L, Math.round(ey) + 0.5, W - Rm, Math.round(ey) + 0.5, COL.grid);
  g.strokeStyle = COL.err;
  g.lineWidth = Math.max(1, Math.min(dx * 0.5, 2.4));
  g.beginPath();
  for (let n = n0; n <= n1; n++) {
    const X = xt(n / fs);
    if (X < L || X > W - Rm) continue;
    g.moveTo(X, ey);
    g.lineTo(X, ey - r.e[mod(n, Nf)] * sc);
  }
  g.stroke();
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillStyle = COL.err;
  g.font = `10.5px ${COL.sans}`;
  g.fillText('誤差', L - 4, ey);
}

/** 段階の間隔の変化（対数）と予測との差の大きさ */
export function drawGap(c: HTMLCanvasElement, r: Out, w: Win): void {
  const a = surface(c);
  if (!a) return;
  const { g, w: W, h: H } = a,
    L = left(W),
    Rm = 6,
    T = 6,
    B = 6,
    PW = W - L - Rm,
    PH = H - T - B,
    Y = (v: number) => T + (Math.log10(Math.max(1e-6, v)) / LOG0) * PH,
    win = w.ms / 1000,
    xt = (t: number) => L + ((t - w.t) / win) * PW,
    fs = r.fs,
    n0 = Math.floor(w.t * fs),
    n1 = Math.ceil((w.t + win) * fs),
    dx = PW / (win * fs),
    Nf = r.y.length;
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  g.font = `10.5px ${COL.mono}`;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const v of [1, 0.1, 0.01, 0.001]) {
    const y = Math.round(Y(v)) + 0.5;
    line(g, L, y, W - Rm, y, COL.grid);
    g.fillStyle = COL.ink3;
    g.fillText(`${v}`, L - 3, y);
  }
  g.save();
  g.beginPath();
  g.rect(L, 0, PW, H);
  g.clip();
  if (dx >= 3) {
    g.fillStyle = COL.err;
    for (let n = n0; n <= n1; n++) {
      const i = mod(n, Nf),
        v = Math.abs(r.ss[i] - r.p[i]);
      if (v <= 0) continue;
      g.beginPath();
      g.arc(xt(n / fs), Y(v), Math.min(2.4, dx * 0.2), 0, Math.PI * 2);
      g.fill();
    }
  }
  g.strokeStyle = COL.ch1;
  g.lineWidth = 1.8;
  g.beginPath();
  for (let n = n0; n <= n1; n++) {
    const y = Y(r.st[mod(n, Nf)]);
    if (n === n0) g.moveTo(xt(n / fs), y);
    else g.lineTo(xt(n / fs), y);
    g.lineTo(xt((n + 1) / fs), y);
  }
  g.stroke();
  g.restore();
}

/* 全体の図: 計算の結果が変わるまで同じ絵なので、別の面に描いておく */
let cache: { c: HTMLCanvasElement; r: Out; col: string } | null = null;
function paintWhole(o: HTMLCanvasElement, r: Out, W: number, H: number, d: number): void {
  const q = o.getContext('2d');
  if (!q) return;
  const PW = W - WHOLE_L - WHOLE_R,
    gapR = 6,
    Hb = H - gapR * 2 - 16,
    h1 = Math.round(Hb * 0.42),
    h2 = Math.round(Hb * 0.26),
    h3 = Hb - h1 - h2,
    y2 = h1 + gapR,
    y3 = h1 + h2 + gapR * 2,
    Nf = r.ss.length,
    cols = Math.max(1, Math.floor(PW)),
    per = Nf / cols,
    rows = Array.from({ length: cols }, () => ({ lo: 0, hi: 0, st: 0, e2: 0, q2: 0, n: 0 }));
  q.setTransform(d, 0, 0, d, 0, 0);
  q.fillStyle = COL.screen;
  q.fillRect(0, 0, W, H);
  q.font = `11.5px ${COL.sans}`;
  q.fillStyle = COL.ink2;
  q.textAlign = 'right';
  q.textBaseline = 'middle';
  q.fillText('波形', WHOLE_L - 5, h1 / 2);
  q.fillText('間隔', WHOLE_L - 5, y2 + h2 / 2);
  q.fillText('誤差', WHOLE_L - 5, y3 + h3 / 2);
  for (let i = 0; i < Nf; i++) {
    const b = rows[Math.min(cols - 1, Math.floor(i / per))],
      v = r.ss[i];
    if (v < b.lo) b.lo = v;
    if (v > b.hi) b.hi = v;
    if (r.st[i] > b.st) b.st = r.st[i];
    b.e2 += r.e[i] * r.e[i];
    b.q2 += r.qe[i] * r.qe[i];
    b.n++;
  }
  /* 波形 */
  const m1 = h1 / 2,
    A1 = h1 / 2 - 2;
  line(q, WHOLE_L, m1 + 0.5, W - WHOLE_R, m1 + 0.5, COL.grid);
  q.fillStyle = COL.ch2;
  rows.forEach((b, px) => {
    q.fillRect(WHOLE_L + px, m1 - b.hi * A1, 1, Math.max(1, (b.hi - b.lo) * A1));
  });
  const trace = (fn: (b: (typeof rows)[number]) => number) => {
    q.beginPath();
    rows.forEach((b, px) => {
      if (px) q.lineTo(WHOLE_L + px, fn(b));
      else q.moveTo(WHOLE_L + px, fn(b));
    });
    q.stroke();
  };
  /* 段階の間隔 */
  const Ys = (v: number) => y2 + 2 + (Math.log10(Math.max(1e-6, v)) / LOG0) * (h2 - 4);
  q.strokeStyle = COL.grid;
  q.lineWidth = 1;
  q.strokeRect(WHOLE_L + 0.5, y2 + 0.5, PW, h2);
  q.strokeStyle = COL.ch1;
  q.lineWidth = 1.2;
  trace((b) => Ys(b.st));
  /* 誤差の電力（0〜−80 dB） */
  const db = (v: number, n: number) => (n ? 10 * Math.log10(v / n + 1e-12) : -80),
    Ye = (v: number) => y3 + 2 + (Math.max(-80, Math.min(0, v)) / -80) * (h3 - 4);
  q.strokeStyle = COL.grid;
  q.lineWidth = 1;
  q.strokeRect(WHOLE_L + 0.5, y3 + 0.5, PW, h3);
  q.strokeStyle = COL.ink3;
  q.setLineDash([3, 3]);
  trace((b) => Ye(db(b.q2, b.n)));
  q.setLineDash([]);
  q.strokeStyle = COL.err;
  q.lineWidth = 1.2;
  trace((b) => Ye(db(b.e2, b.n)));
  /* 時間の目盛り */
  const dur = Nf / r.fs,
    tick = dur > 6 ? 2 : 1;
  q.font = `11px ${COL.mono}`;
  q.fillStyle = COL.ink3;
  q.textBaseline = 'bottom';
  for (let s = 0; s <= dur; s += tick) {
    const x = WHOLE_L + (s / dur) * PW;
    /* 右端は単位と重ならないよう、単位の文字に含める */
    const end = s + tick > dur;
    q.textAlign = s === 0 ? 'left' : end ? 'right' : 'center';
    q.fillText(end ? `${s} s` : `${s}`, end ? Math.min(x, W - WHOLE_R) : x, H);
  }
}
/** 全体の図: 波形・段階の間隔・誤差を同じ時間軸で並べ、拡大している範囲に枠を描く */
export function drawWhole(c: HTMLCanvasElement, r: Out, w: Win): void {
  const a = surface(c);
  if (!a) return;
  const { g, w: W, h: H } = a,
    d = c.width / W;
  if (
    !cache ||
    cache.r !== r ||
    cache.col !== COL.screen + COL.ch1 ||
    cache.c.width !== c.width ||
    cache.c.height !== c.height
  ) {
    const o = cache?.c ?? document.createElement('canvas');
    o.width = c.width;
    o.height = c.height;
    paintWhole(o, r, W, H, d);
    cache = { c: o, r, col: COL.screen + COL.ch1 };
  }
  g.drawImage(cache.c, 0, 0, W, H);
  const dur = r.ss.length / r.fs,
    PW = W - WHOLE_L - WHOLE_R,
    x0 = WHOLE_L + (w.t / dur) * PW,
    wPx = Math.max(6, (w.ms / 1000 / dur) * PW);
  g.fillStyle = COL.accent;
  g.globalAlpha = 0.12;
  g.fillRect(x0, 1, wPx, H - 18);
  g.globalAlpha = 1;
  g.strokeStyle = COL.accent;
  g.lineWidth = 1.6;
  g.strokeRect(x0, 1, wPx, H - 18);
}

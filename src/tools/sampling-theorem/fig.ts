/**
 * 標本化定理のページの図（canvas）: 波形とスペクトル。
 * 波形は入力の位相 0 から描き、幅は入力の周波数で決める（標本化周波数では変えない）。
 * スペクトルの横軸も入力で決め、標本化周波数を動かすと fs と複製だけが動く。fs の半分の線は描かない
 */
import { binHz, MUSIC_RATE, SPEC_N } from './music';
import { AMP, copyName, fold, isMusic, judge, reconAt, type Sig, SW0, SW1, samplesAt, source } from './signal';

export interface Col {
  screen: string;
  grid: string;
  grid2: string;
  sink: string;
  ink: string;
  ink2: string;
  ink3: string;
  ch1: string;
  ch2: string;
  warn: string;
  mono: string;
}
export const COL: Col = {
  screen: '',
  grid: '',
  grid2: '',
  sink: '',
  ink: '',
  ink2: '',
  ink3: '',
  ch1: '',
  ch2: '',
  warn: '',
  mono: 'monospace',
};
export function readCols(root: Element): void {
  const c = getComputedStyle(root),
    v = (k: string) => c.getPropertyValue(k).trim();
  Object.assign(COL, {
    screen: v('--screen'),
    grid: v('--grid'),
    grid2: v('--smp-cp'),
    sink: v('--screen-ink'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    ch1: v('--smp-r'),
    ch2: v('--smp-o'),
    warn: v('--smp-a'),
    mono: v('--mono') || 'monospace',
  });
}

type G = CanvasRenderingContext2D;
/** 描く面を用意する（CSS の大きさに合わせる）。隠れていれば null */
export function surface(c: HTMLCanvasElement): { g: G; w: number; h: number } | null {
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
  g.clearRect(0, 0, r.width, r.height);
  return { g, w: r.width, h: r.height };
}

/** 周波数の表記 */
export const hz = (f: number): string =>
  f >= 10000
    ? `${+(f / 1000).toFixed(1)} kHz`
    : f >= 1000
      ? `${Math.round(f).toLocaleString('en')} Hz`
      : `${f >= 100 ? Math.round(f) : +f.toFixed(1)} Hz`;
const kTick = (f: number): string => (f >= 1000 ? `${+(f / 1000).toPrecision(3)}k` : `${Math.round(f)}`);

function txt(
  g: G,
  s: string,
  x: number,
  y: number,
  col: string,
  px = 13,
  al: CanvasTextAlign = 'center',
  w = 500,
): void {
  g.font = `${w} ${px}px ${COL.mono}`;
  g.fillStyle = col;
  g.textAlign = al;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}
/** 地を塗った札。x は中心 */
function pill(g: G, s: string, x: number, y: number, fg: string, bg: string, px = 15): number {
  g.font = `700 ${px}px ${COL.mono}`;
  const w = g.measureText(s).width + 12;
  g.fillStyle = bg;
  g.fillRect(x - w / 2, y - px / 2 - 4, w, px + 8);
  txt(g, s, x, y + 0.5, fg, px, 'center', 700);
  return w;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ---------- 波形 ---------- */
export interface View {
  /** 図に描く入力（スイープは今の周波数の正弦波） */
  sig: Sig;
  fs: number;
  aa: boolean;
  /** 窓の始まりの時刻 [s]（音楽だけ今の時刻。ほかは 0 で、入力の位相 0 から描く） */
  t0?: number;
}
/** 窓の幅 [s]: 正弦波は 6 周期、ほかは 4 周期（スイープは 4 ms、音楽は 5 ms）。標本が 8 個未満なら 2 倍ずつ広げる */
export function waveSpan(v: View, sweep: boolean): number {
  let W = isMusic(v.sig.src) ? 0.005 : sweep ? 0.004 : (v.sig.src === 'sine' ? 6 : 4) / v.sig.f;
  while (W * v.fs < 8 && W < 0.2) W *= 2;
  return W;
}
export function drawWave(cv: HTMLCanvasElement, v: View, sweep: boolean): void {
  const s = surface(cv);
  if (!s) return;
  const { g, w, h } = s,
    narrow = w < 520,
    x0 = narrow ? 14 : 18,
    x1 = w - 12,
    yc = h / 2 + 2,
    A = (h - 78) / 2 / AMP,
    tB = waveSpan(v, sweep),
    T0 = v.t0 ?? 0,
    X = (t: number) => x0 + ((t - T0) / tB) * (x1 - x0),
    Y = (y: number) => yc - y * A,
    music = isMusic(v.sig.src),
    J = judge(v.sig, v.fs, v.aa);
  g.lineWidth = 1;
  g.strokeStyle = COL.grid;
  g.beginPath();
  g.moveTo(x0, yc);
  g.lineTo(x1, yc);
  g.stroke();
  /* 時間の目盛り [ms] */
  const span = tB * 1000,
    step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find((u) => span / u <= (narrow ? 5 : 8)) ?? 50;
  for (let m = 0; m <= span + 1e-9; m += step) {
    const x = X(T0 + m / 1000);
    g.strokeStyle = COL.grid;
    g.beginPath();
    g.moveTo(x, 34);
    g.lineTo(x, h - 26);
    g.stroke();
    txt(
      g,
      m === 0 ? '0 ms' : `${+m.toFixed(1)}`,
      x,
      h - 14,
      COL.ink3,
      13,
      m === 0 ? 'left' : x > x1 - 30 ? 'right' : 'center',
    );
  }
  /* 復元した波（太線）の上に原音（細線）。復元できると 2 本が重なって見える */
  const N = Math.round((x1 - x0) * 2),
    ts = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) ts[i] = T0 + (tB * i) / N;
  const y = reconAt(v.sig, v.fs, v.aa, ts),
    bad = J.over.length > 0;
  g.strokeStyle = COL.ch1;
  g.lineWidth = 2.8;
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const yy = Y(y[i]);
    i ? g.lineTo(X(ts[i]), yy) : g.moveTo(X(ts[i]), yy);
  }
  g.stroke();
  const v0 = source(v.sig),
    val = (t: number) => v0(t, Number.POSITIVE_INFINITY);
  g.strokeStyle = COL.ch2;
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const yy = Y(val(ts[i]));
    i ? g.lineTo(X(ts[i]), yy) : g.moveTo(X(ts[i]), yy);
  }
  g.stroke();
  /* 標本 */
  const n0 = Math.ceil(T0 * v.fs - 1e-9),
    n1 = Math.floor((T0 + tB) * v.fs + 1e-9),
    x = samplesAt(v.sig, v.fs, v.aa, n0, n1),
    r = n1 - n0 > 40 ? 2.6 : 3.6;
  for (let n = n0; n <= n1; n++) {
    const px = X(n / v.fs),
      py = Y(x[n - n0]);
    g.strokeStyle = COL.ink3;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px, yc);
    g.lineTo(px, py);
    g.stroke();
    g.fillStyle = COL.ink;
    g.beginPath();
    g.arc(px, py, r, 0, 2 * Math.PI);
    g.fill();
  }
  /* 札: 1 周期の標本の数、入力と復元される周波数（音楽は標本の数だけ） */
  if (music) {
    txt(g, `${+(tB * 1000).toFixed(1)} ms に ${n1 - n0 + 1} 個`, x0, 16, COL.ink2, 15, 'left', 700);
    return;
  }
  txt(g, `1 周期に ${J.spp.toFixed(1)} 個`, x0, 16, J.spp <= 2 ? COL.warn : COL.ink2, 15, 'left', 700);
  /* fs = 2f ちょうどの正弦波のように、標本がすべて 0 なら復元した波も 0（無音） */
  let peak = 0;
  for (const yy of y) peak = Math.max(peak, Math.abs(yy));
  const heard = (J.main.f * 2 >= v.fs && v.aa) || peak < 0.01 ? '無音' : hz(J.fa),
    col = bad && J.main.f * 2 >= v.fs ? COL.warn : COL.ch1;
  if (narrow) txt(g, `復元 ${heard}`, x1, 16, col, 15, 'right', 700);
  else {
    g.font = `700 15px ${COL.mono}`;
    const b = `復元 ${heard}`,
      wb = g.measureText(b).width;
    txt(g, b, x1, 16, col, 15, 'right', 700);
    txt(g, `入力 ${hz(J.main.f)} →`, x1 - wb - 8, 16, COL.ch2, 15, 'right', 700);
  }
}

/* ---------- スペクトル ---------- */
export interface Spec {
  /** 入力（スイープはそのまま） */
  sig: Sig;
  /** スイープの時刻 [s] */
  t: number;
  fs: number;
  aa: boolean;
  /** 音楽の今の振幅スペクトル（music.ts の musicSpec） */
  mspec?: Float64Array;
}
/** 横軸の上限 [Hz]: 入力の 10 倍（スイープは 20 kHz） */
export const specTop = (sig: Sig): number =>
  isMusic(sig.src) ? MUSIC_RATE / 2 : sig.src === 'sweep' ? 20000 : Math.min(96000, 10 * sig.f);
export const specGeom = (w: number, h: number) => ({ x0: 14, x1: w - 18, yb: h - 54, yt: 64 });

/** 寸法線（両端に短い縦線、真ん中に札）。向きのない長さなので矢じりは付けない */
function dim(g: G, xa: number, xb: number, y: number, lb: string, col: string): void {
  if (Math.abs(xb - xa) < 2) return;
  g.strokeStyle = col;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(xa, y);
  g.lineTo(xb, y);
  g.moveTo(xa, y - 5);
  g.lineTo(xa, y + 5);
  g.moveTo(xb, y - 5);
  g.lineTo(xb, y + 5);
  g.stroke();
  g.font = `700 13px ${COL.mono}`;
  const tw = g.measureText(lb).width + 8,
    xm = (xa + xb) / 2;
  if (Math.abs(xb - xa) < tw + 4) return;
  g.fillStyle = COL.screen;
  g.fillRect(xm - tw / 2, y - 9, tw, 18);
  txt(g, lb, xm, y + 0.5, col, 13, 'center', 700);
}
function arrowHead(g: G, x: number, y: number, ang: number, col: string, s = 7): void {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - s * Math.cos(ang - 0.45), y - s * Math.sin(ang - 0.45));
  g.lineTo(x - s * Math.cos(ang + 0.45), y - s * Math.sin(ang + 0.45));
  g.closePath();
  g.fill();
}

export function drawSpec(cv: HTMLCanvasElement, sp: Spec): void {
  if (isMusic(sp.sig.src)) {
    drawSpecMusic(cv, sp);
    return;
  }
  const s = surface(cv);
  if (!s) return;
  const { g, w, h } = s,
    { x0, x1, yb, yt } = specGeom(w, h),
    F = specTop(sp.sig),
    fs = sp.fs,
    X = (f: number) => x0 + (Math.min(f, F * 1.02) / F) * (x1 - x0),
    HH = (a: number) => Math.max(6, ((20 * Math.log10(a / AMP) + 42) / 42) * (yb - yt));
  g.strokeStyle = COL.sink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0, yb);
  g.lineTo(x1, yb);
  g.stroke();
  /* 周波数の目盛り */
  const stp = [100, 200, 500, 1000, 2000, 5000, 10000, 20000].find((v) => F / v <= (w < 520 ? 5 : 8)) ?? 20000;
  for (let f = 0; f <= F + 1e-6; f += stp) {
    const x = X(f);
    g.strokeStyle = COL.sink;
    g.beginPath();
    g.moveTo(x, yb);
    g.lineTo(x, yb + 4);
    g.stroke();
    txt(g, f ? kTick(f) : '0 Hz', x, yb + 15, COL.ink3, 13, f ? (x > x1 - 20 ? 'right' : 'center') : 'left');
  }
  /* fs の倍数（2fs から上は細い線と札だけ） */
  const kmax = Math.floor(F / fs);
  if (kmax <= 12)
    for (let k = 2; k <= kmax; k++) {
      const x = X(k * fs);
      g.strokeStyle = COL.grid2;
      g.beginPath();
      g.moveTo(x, 40);
      g.lineTo(x, yb);
      g.stroke();
      if (x < x1 - 24) txt(g, `${k}fs`, x + 3, 58, COL.ink3, 13, 'left');
    }
  const J = judge(sp.sig, fs, sp.aa, sp.t),
    list = J.c.filter((c) => c.a / AMP > 0.008),
    m = J.main,
    cut = (f: number) => sp.aa && 2 * f >= fs,
    line = (f: number, a: number, col: string, lw: number, dash = false) => {
      if (f < 0 || f > F) return;
      const x = X(f);
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.setLineDash(dash ? [3, 3] : []);
      g.beginPath();
      g.moveTo(x, yb);
      g.lineTo(x, yb - HH(a));
      g.stroke();
      g.setLineDash([]);
    };
  /* 複製: 標本化すると fs の倍数の両側に同じ成分が並ぶ */
  for (const c of list) {
    if (cut(c.f)) continue;
    for (let k = 1; k * fs - c.f <= F && k < 400; k++) {
      line(Math.abs(k * fs - c.f), c.a, COL.grid2, 1.6);
      line(k * fs + c.f, c.a, COL.grid2, 1.6);
    }
  }
  /* 復元される成分: 0 にいちばん近い複製 */
  for (const c of list) if (!cut(c.f)) line(fold(c.f, fs), c.a, 2 * c.f >= fs ? COL.warn : COL.ch1, 3.4);
  /* 原音の成分（ローパスで除くものは破線） */
  for (const c of list) if (c.f <= F) line(c.f, c.a, cut(c.f) ? COL.ink3 : COL.ch2, 1.4, cut(c.f));
  /* f と fs − f の対（同じ長さ） */
  if (!cut(m.f) && m.f < fs && fs <= F) {
    dim(g, X(0), X(m.f), yb - 12, 'f', COL.ch2);
    dim(g, X(fs), X(fs - m.f), yb - 32, 'f', COL.ink2);
  }
  /* スイープ: 範囲と今の位置 */
  if (sp.sig.src === 'sweep') {
    const y = 58,
      xa = X(SW0),
      xb = X(SW1);
    g.strokeStyle = COL.ch2;
    g.lineWidth = 1.4;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(xa, y);
    g.lineTo(xb - 6, y);
    g.stroke();
    g.setLineDash([]);
    arrowHead(g, xb, y, 0, COL.ch2);
    g.fillStyle = COL.ch2;
    g.beginPath();
    g.arc(X(m.f), y, 4.5, 0, 2 * Math.PI);
    g.fill();
  }
  /* 標本化周波数のつまみ */
  if (fs <= F) {
    const x = X(fs);
    g.strokeStyle = COL.ink;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, 40);
    g.lineTo(x, yb);
    g.stroke();
    g.fillStyle = COL.ink;
    g.beginPath();
    g.moveTo(x, yb + 1);
    g.lineTo(x - 7, yb + 11);
    g.lineTo(x + 7, yb + 11);
    g.closePath();
    g.fill();
    pill(g, `fs ${hz(fs)}`, clamp(x, x0 + 64, x1 - 64), yb + 38, COL.screen, COL.ink);
  } else txt(g, `fs ${hz(fs)} →`, x1, yb + 38, COL.ink, 15, 'right', 700);
  /* 範囲の外の成分 */
  const outs = list.filter((c) => c.f > F && !cut(c.f));
  if (outs.length && sp.sig.src !== 'sweep')
    txt(g, `${hz(outs[0].f)}${outs.length > 1 ? ` ほか ${outs.length - 1}` : ''} →`, x1, 39, COL.ch2, 13, 'right', 700);
  /* 札: 入力と、折り返したときは聞こえる複製 */
  const pf = pill(g, `f ${hz(m.f)}`, clamp(X(m.f), x0 + 60, x1 - 60), 15, COL.screen, COL.ch2);
  if (!cut(m.f) && 2 * m.f >= fs) {
    const xa = clamp(X(J.fa), x0 + 90, x1 - 90),
      xf = clamp(X(m.f), x0 + 60, x1 - 60),
      label = `${copyName(m.f, fs)} ${hz(J.fa)}`;
    g.font = `700 15px ${COL.mono}`;
    const overlap = Math.abs(xa - xf) < (pf + g.measureText(label).width + 12) / 2 + 4;
    pill(g, label, xa, overlap ? 39 : 15, COL.screen, COL.warn);
  }
}

/** 周波数の目盛りと fs の倍数・fs のつまみ（スペクトルの共通の部分） */
function specAxes(g: G, w: number, h: number, F: number, fs: number): (f: number) => number {
  const { x0, x1, yb } = specGeom(w, h),
    X = (f: number) => x0 + (Math.min(f, F * 1.02) / F) * (x1 - x0);
  g.strokeStyle = COL.sink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0, yb);
  g.lineTo(x1, yb);
  g.stroke();
  const stp = [100, 200, 500, 1000, 2000, 5000, 10000, 20000].find((v) => F / v <= (w < 520 ? 5 : 8)) ?? 20000;
  for (let f = 0; f <= F + 1e-6; f += stp) {
    const x = X(f);
    g.beginPath();
    g.moveTo(x, yb);
    g.lineTo(x, yb + 4);
    g.stroke();
    txt(g, f ? kTick(f) : '0 Hz', x, yb + 15, COL.ink3, 13, f ? (x > x1 - 20 ? 'right' : 'center') : 'left');
  }
  const kmax = Math.floor(F / fs);
  if (kmax <= 12)
    for (let k = 2; k <= kmax; k++) {
      const x = X(k * fs);
      g.strokeStyle = COL.grid2;
      g.beginPath();
      g.moveTo(x, 40);
      g.lineTo(x, yb);
      g.stroke();
      if (x < x1 - 24) txt(g, `${k}fs`, x + 3, 58, COL.ink3, 13, 'left');
    }
  return X;
}
function fsKnob(g: G, w: number, h: number, F: number, fs: number, X: (f: number) => number): void {
  const { x0, x1, yb } = specGeom(w, h);
  if (fs > F) {
    txt(g, `fs ${hz(fs)} →`, x1, yb + 38, COL.ink, 15, 'right', 700);
    return;
  }
  const x = X(fs);
  g.strokeStyle = COL.ink;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, 40);
  g.lineTo(x, yb);
  g.stroke();
  g.fillStyle = COL.ink;
  g.beginPath();
  g.moveTo(x, yb + 1);
  g.lineTo(x - 7, yb + 11);
  g.lineTo(x + 7, yb + 11);
  g.closePath();
  g.fill();
  pill(g, `fs ${hz(fs)}`, clamp(x, x0 + 64, x1 - 64), yb + 38, COL.screen, COL.ink);
}

/**
 * 音楽のスペクトル: 原音を曲線で描き、複製（fs の倍数の両側に鏡に映した形）を灰、
 * 復元される成分のうち元の成分を橙、ほかの複製から来た成分（折り返し）を濃い桃で描く。縦は最大の成分から 60 dB
 */
function drawSpecMusic(cv: HTMLCanvasElement, sp: Spec): void {
  const s = surface(cv);
  if (!s) return;
  const { g, w, h } = s,
    { x0, x1, yb, yt } = specGeom(w, h),
    F = specTop(sp.sig),
    fs = sp.fs,
    X = specAxes(g, w, h, F, fs),
    spec = sp.mspec;
  if (!spec) {
    txt(g, '音源を準備中…', (x0 + x1) / 2, (yt + yb) / 2, COL.ink3, 15, 'center', 700);
    fsKnob(g, w, h, F, fs, X);
    return;
  }
  const df = MUSIC_RATE / SPEC_N,
    ref = Math.max(...spec) || 1,
    /* 入力のローパスで除く成分は、複製と折り返しに入れない */
    amp = (f: number, forCopy: boolean): number => {
      const k = Math.round(Math.abs(f) / df);
      if (k > SPEC_N / 2) return 0;
      if (forCopy && sp.aa && 2 * binHz(k) >= fs) return 0;
      return spec[k];
    },
    Y = (a: number) => yb - Math.max(0, Math.min(1, (20 * Math.log10(a / ref + 1e-12) + 60) / 60)) * (yb - yt),
    curve = (vals: Float64Array, col: string, lw: number, from: number, to: number, dash = false) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.setLineDash(dash ? [4, 3] : []);
      g.beginPath();
      let on = false;
      for (let px = Math.floor(from); px <= Math.min(to, x1); px++) {
        const v = vals[px - Math.floor(x0)];
        if (v <= 0) {
          on = false;
          continue;
        }
        const y = Y(v);
        on ? g.lineTo(px, y) : g.moveTo(px, y);
        on = true;
      }
      g.stroke();
      g.setLineDash([]);
    };
  const n = Math.ceil(x1) - Math.floor(x0) + 1,
    orig = new Float64Array(n),
    copy = new Float64Array(n),
    ok = new Float64Array(n),
    over = new Float64Array(n),
    fOf = (px: number) => ((px - x0) / (x1 - x0)) * F,
    kTop = Math.ceil((F + MUSIC_RATE / 2) / fs);
  for (let i = 0; i < n; i++) {
    const u = fOf(Math.floor(x0) + i);
    if (u < 0) continue;
    /* 1 画素に入る bin の最大 */
    const b0 = Math.floor(u / df),
      b1 = Math.max(b0, Math.floor(fOf(Math.floor(x0) + i + 1) / df));
    let m = 0;
    for (let b = b0; b <= Math.min(b1, SPEC_N / 2); b++) m = Math.max(m, spec[b]);
    orig[i] = m;
    let c = 0,
      p = 0;
    for (let k = 1; k <= kTop; k++) {
      const a1 = amp(k * fs - u, true),
        a2 = amp(k * fs + u, true);
      c = Math.max(c, a1, a2);
      p += a1 * a1 + a2 * a2;
    }
    copy[i] = c;
    if (2 * u < fs) {
      ok[i] = sp.aa || 2 * u < fs ? m : 0;
      over[i] = Math.sqrt(p);
    }
  }
  const xh = Math.min(x1, X(fs / 2));
  curve(copy, COL.grid2, 1.4, x0, x1);
  curve(over, COL.warn, 2.4, x0, xh);
  curve(ok, COL.ch1, 3, x0, xh);
  curve(orig, sp.aa ? COL.ink3 : COL.ch2, 1.3, x0, x1);
  if (sp.aa) curve(orig, COL.ch2, 1.3, x0, xh);
  fsKnob(g, w, h, F, fs, X);
  txt(g, '0 dB = 最大の成分', x1, 15, COL.ink3, 13, 'right');
}

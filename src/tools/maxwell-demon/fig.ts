/**
 * マクスウェルの悪魔の図: 2 つの部屋と扉・温度の変化・エントロピーの収支・悪魔の記憶。
 * 色はページの CSS 変数から読む（readCols）。キャンバスの大きさは CSS に合わせる
 */
import { type Gas, K0, LN2, MS } from './gas';

const COL = {
  screen: '',
  grid: '',
  grid2: '',
  ink: '',
  ink2: '',
  ink3: '',
  sink: '',
  ch1: '',
  ch2: '',
  warn: '',
  dm: '',
  line: '',
  mono: '',
  sans: '',
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
  COL.sink = v('--screen-ink');
  COL.ch1 = v('--ch1');
  COL.ch2 = v('--ch2');
  COL.warn = v('--warn');
  COL.dm = v('--mxd-dm');
  COL.line = v('--line');
  COL.mono = v('--mono');
  COL.sans = v('--sans');
}

/** 描く面を用意する（CSS の大きさに合わせる）。隠れていれば null */
function surface(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = c.clientWidth,
    h = c.clientHeight,
    d = Math.min(2, devicePixelRatio || 1);
  if (!w || !h) return null;
  const W = Math.round(w * d),
    H = Math.round(h * d);
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
const font = (wt: number, px: number, mono = false) => `${wt} ${px}px ${mono ? COL.mono : COL.sans}`;
/** 温度 [K] の表記 */
export const kelvin = (T: number): number => Math.round(T * K0);

/* ---------- 2 つの部屋と扉 ---------- */
const BOX_TOP = 40;
/** 箱の高さを幅から決める（幅 : 高さ = 2 : 1、上に悪魔の欄） */
export function fitBox(c: HTMLCanvasElement, max: number): void {
  const want = Math.round(Math.min(max, (c.clientWidth - 20) / 2 + BOX_TOP + 12));
  if (want > 0 && Math.abs(c.clientHeight - want) > 1) c.style.height = `${want}px`;
}
/** 悪魔の顔。look は見ている向き（−1 左、0 正面、1 右） */
function demon(g: CanvasRenderingContext2D, x: number, y: number, look: number): void {
  g.save();
  g.translate(x, y);
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.strokeStyle = COL.dm;
  g.fillStyle = COL.screen;
  g.beginPath();
  g.moveTo(-7, -6);
  g.lineTo(-10, -15);
  g.lineTo(-3, -9);
  g.moveTo(7, -6);
  g.lineTo(10, -15);
  g.lineTo(3, -9);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 9.5, 0, 2 * Math.PI);
  g.fill();
  g.stroke();
  g.fillStyle = COL.dm;
  const e = look * 2.6;
  g.beginPath();
  g.arc(-3.4 + e, -1, 1.7, 0, 2 * Math.PI);
  g.arc(3.4 + e, -1, 1.7, 0, 2 * Math.PI);
  g.fill();
  g.beginPath();
  g.moveTo(-3.5, 4.2);
  g.quadraticCurveTo(0, 6.5, 3.5, 4.2);
  g.stroke();
  g.restore();
}
export function drawBox(c: HTMLCanvasElement, gas: Gas): void {
  const s0 = surface(c);
  if (!s0) return;
  const { g, w, h } = s0,
    pad = 10,
    bw = Math.min(w - 2 * pad, (h - BOX_TOP - pad) * 2),
    bh = bw / 2,
    x0 = (w - bw) / 2,
    y0 = BOX_TOP,
    s = bw / 2,
    X = (v: number) => x0 + v * s,
    Y = (v: number) => y0 + v * s;
  g.fillStyle = COL.screen;
  g.fillRect(x0, y0, bw, bh);
  /* 分子。数が少ないときは大きく描く */
  const rr = Math.max(2.2, gas.r * s) * (gas.n <= 4 ? 2.2 : gas.n <= 20 ? 1.4 : 1),
    rw = Math.max(gas.r, rr / s);
  for (let i = 0; i < gas.n; i++) {
    /* 大きく描いた丸が壁と仕切りに食い込まないよう、描く位置だけ内側へ寄せる */
    const sd = gas.side[i],
      px = gas.pass[i] ? gas.x[i] : Math.min(sd + 1 - rw, Math.max(sd + rw, gas.x[i])),
      py = Math.min(1 - rw, Math.max(rw, gas.y[i]));
    g.fillStyle = gas.speed(i) > gas.vth ? COL.ch1 : COL.ch2;
    g.beginPath();
    g.arc(X(px), Y(py), rr, 0, 2 * Math.PI);
    g.fill();
  }
  /* 壁と仕切り */
  g.strokeStyle = COL.sink;
  g.lineWidth = 2;
  g.strokeRect(x0, y0, bw, bh);
  const gt = 0.5 - gas.gap / 2,
    gb = 0.5 + gas.gap / 2,
    mx = X(1);
  g.lineWidth = 4;
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(mx, Y(0));
  g.lineTo(mx, Y(gt));
  g.moveTo(mx, Y(gb));
  g.lineTo(mx, Y(1));
  g.stroke();
  /* 扉は上の端を軸に、通る向きへ開く */
  const dl = (gb - gt) * s,
    L = gas.last,
    dir = gas.mode === 'temp' || gas.mode === 'press' ? (L?.s === 1 ? -1 : 1) : 1;
  g.strokeStyle = COL.ink3;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(mx, Y(gt));
  if (gas.open()) g.lineTo(mx + dir * dl * 0.3, Y(gt) - dl * 0.32);
  else g.lineTo(mx, Y(gb));
  g.stroke();
  g.lineCap = 'butt';
  /* 悪魔と今の判断 */
  const fresh = !!L && gas.t - L.t < 0.45 && (gas.mode === 'temp' || gas.mode === 'press') && L.i < gas.n;
  if (fresh && L) {
    g.strokeStyle = COL.ink;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(gas.x[L.i]), Y(gas.y[L.i]), rr + 4, 0, 2 * Math.PI);
    g.stroke();
  }
  demon(g, mx, 20, fresh && L ? (L.s === 0 ? -1 : 1) : 0);
  g.font = font(700, 14);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  if (gas.mode === 'none') {
    g.fillStyle = COL.ink3;
    g.fillText('扉は開いたまま', mx + 18, 20);
  } else if (gas.mode === 'hand') {
    g.fillStyle = gas.hand ? COL.ink : COL.ink3;
    g.fillText(gas.hand ? '開いている' : '閉じている', mx + 18, 20);
  } else if (fresh && L) {
    const v = Math.round(gas.speed(L.i) * MS),
      left = L.s === 0,
      say =
        gas.mode === 'temp' ? `${v} m/s → ${L.ok ? '通す' : '通さない'}` : L.ok ? '左から → 通す' : '右から → 通さない';
    g.fillStyle = COL.ink;
    g.textAlign = left ? 'right' : 'left';
    g.fillText(say, mx + (left ? -18 : 18), 20);
  }
  /* 部屋ごとの温度と分子の数 */
  const { N, T } = gas.stats();
  g.textAlign = 'left';
  g.textBaseline = 'top';
  for (const k of [0, 1] as const) {
    const tx = X(k) + 10,
      ty = y0 + 8,
      lab = `${k ? '右' : '左'} ${N[k] ? `${kelvin(T[k])} K` : '—'}`;
    g.font = font(700, 15, true);
    const tw = g.measureText(lab).width;
    g.fillStyle = COL.screen;
    g.globalAlpha = 0.82;
    g.fillRect(tx - 4, ty - 3, Math.max(tw, 52) + 8, 38);
    g.globalAlpha = 1;
    g.fillStyle = COL.ink;
    g.fillText(lab, tx, ty);
    g.font = font(500, 13);
    g.fillStyle = COL.ink2;
    g.fillText(`${N[k]} 個`, tx, ty + 19);
  }
}

/* ---------- 温度の変化 ---------- */
const SPAN = 60;
export function drawTemp(c: HTMLCanvasElement, gas: Gas): void {
  const s0 = surface(c);
  if (!s0) return;
  const { g, w, h } = s0,
    L = 56,
    R = 76,
    T = 10,
    B = 26,
    pw = w - L - R,
    ph = h - T - B,
    sm = gas.samples,
    t1 = Math.max(SPAN, gas.t),
    t0 = t1 - SPAN;
  let lo = 250,
    hi = 350;
  for (const p of sm)
    if (p.t >= t0)
      for (const k of [0, 1])
        if (p.N[k]) {
          lo = Math.min(lo, p.T[k] * K0);
          hi = Math.max(hi, p.T[k] * K0);
        }
  lo = Math.max(0, Math.floor((lo - 10) / 50) * 50);
  hi = Math.min(3000, Math.ceil((hi + 10) / 50) * 50);
  const st = hi - lo > 1200 ? 500 : hi - lo > 500 ? 100 : 50,
    X = (t: number) => L + ((t - t0) / SPAN) * pw,
    Y = (k: number) => T + (1 - (k - lo) / (hi - lo)) * ph;
  g.fillStyle = COL.screen;
  g.fillRect(L, T, pw, ph);
  g.font = font(500, 13, true);
  g.fillStyle = COL.ink3;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.lineWidth = 1;
  for (let k = Math.ceil(lo / st) * st; k <= hi; k += st) {
    g.strokeStyle = COL.grid;
    g.beginPath();
    g.moveTo(L, Y(k));
    g.lineTo(L + pw, Y(k));
    g.stroke();
    g.fillText(k + st > hi ? `${k} K` : `${k}`, L - 6, Y(k));
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const ts = pw < 420 ? 20 : 10;
  for (let s = Math.ceil(t0 / ts) * ts; s <= t1 + 1e-9; s += ts)
    g.fillText(s + ts > t1 ? `${s} 秒` : `${s}`, X(s), T + ph + 6);
  g.setLineDash([4, 4]);
  g.strokeStyle = COL.grid2;
  g.beginPath();
  g.moveTo(L, Y(K0));
  g.lineTo(L + pw, Y(K0));
  g.stroke();
  g.setLineDash([]);
  const last = sm[sm.length - 1];
  for (const [k, cl, nm] of [
    [0, COL.ch2, '左'],
    [1, COL.ch1, '右'],
  ] as const) {
    g.strokeStyle = cl;
    g.lineWidth = 2;
    g.beginPath();
    let pen = false,
      ly = Number.NaN;
    for (const p of sm) {
      if (p.t < t0) continue;
      if (!p.N[k]) {
        pen = false;
        continue;
      }
      const yy = Y(p.T[k] * K0);
      if (pen) g.lineTo(X(p.t), yy);
      else g.moveTo(X(p.t), yy);
      pen = true;
      ly = yy;
    }
    g.stroke();
    g.fillStyle = cl;
    g.font = font(700, 15, true);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const yy = Number.isNaN(ly) ? Y(K0) : ly,
      other = last.N[1 - k] ? Y(last.T[1 - k] * K0) : Number.NaN,
      nudge = Math.abs(yy - other) < 18 ? (yy <= other ? -9 : 9) : 0;
    g.fillText(`${nm} ${last.N[k] ? kelvin(last.T[k]) : '—'}`, L + pw + 6, yy + nudge);
  }
}

/* ---------- エントロピーの収支 ---------- */
export interface Ledger {
  /** 気体 */
  gas: number;
  /** 記憶にある記録（消すときに払う熱）。合計には入れない */
  mem: number;
  /** 消去で出した熱 */
  heat: number;
  /** 気体と消去の熱の合計。記録を消すまでの間は負になりうる */
  sum: number;
  /** 記録まで含めた合計。負にならない */
  all: number;
}
export const ledger = (gas: Gas): Ledger => {
  const a = gas.entropy(),
    m = gas.memory(),
    q = gas.heat();
  return { gas: a, mem: m, heat: q, sum: a + q, all: a + m + q };
};
const signed = (v: number): string =>
  `${v > 0.005 ? '+' : v < -0.005 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1)}`;
/**
 * 気体・消去の熱・その合計を棒で描く。記録は「消すときに払う熱」として、線を引いた下に点線の枠で描き、合計には入れない。
 * 最後に記録まで含めた合計を小さく添える
 */
export function drawLedger(c: HTMLCanvasElement, gas: Gas): void {
  const s0 = surface(c);
  if (!s0) return;
  const { g, w, h } = s0,
    v = ledger(gas),
    rows: [string, number, string, boolean][] = [
      ['気体', v.gas, COL.ch2, false],
      ['消去の熱', v.heat, COL.warn, false],
      ['合計', v.sum, COL.ink2, false],
      ['記録', v.mem, COL.ch1, true],
    ],
    L = 80,
    R = 12,
    foot = 22,
    sep = 10,
    pw = w - L - R,
    rh = (h - foot - sep - 4) / rows.length;
  let m = 5;
  for (const r of rows) m = Math.max(m, Math.abs(r[1]));
  const low = Math.abs(Math.min(0, v.gas, v.sum)),
    neg = Math.min(0.5, Math.max(0.14, low / m / 1.1 + 0.1)),
    z0 = L + pw * neg,
    sc = (pw * (1 - neg) - 4) / m,
    rowY = (i: number) => 2 + i * rh + (i === 3 ? sep : 0);
  g.strokeStyle = COL.sink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(z0, 2);
  g.lineTo(z0, rowY(3) + rh - 2);
  g.stroke();
  /* 合計と記録の間の線 */
  g.strokeStyle = COL.grid2;
  g.beginPath();
  g.moveTo(2, rowY(3) - sep / 2);
  g.lineTo(w - R, rowY(3) - sep / 2);
  g.stroke();
  rows.forEach(([nm, val, cl, dash], i) => {
    const bh = Math.min(22, rh - 12),
      y = rowY(i) + (rh - bh) / 2;
    g.font = font(700, 14);
    g.fillStyle = COL.ink;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    if (dash) {
      g.fillText(nm, 2, y + bh / 2 - 7);
      g.font = font(500, 12);
      g.fillStyle = COL.ink3;
      g.fillText('消すときの熱', 2, y + bh / 2 + 9);
    } else g.fillText(nm, 2, y + bh / 2);
    const len = val === 0 ? 0 : Math.max(1.5, Math.abs(val) * sc),
      xa = val < 0 ? z0 - len : z0;
    if (dash) {
      if (len > 0) {
        g.setLineDash([4, 3]);
        g.strokeStyle = cl;
        g.lineWidth = 2;
        g.strokeRect(xa + 1, y + 1, Math.max(0, len - 2), bh - 2);
        g.setLineDash([]);
      }
    } else {
      g.fillStyle = cl;
      g.fillRect(xa, y, len, bh);
    }
    /* 長い棒は数値を棒の中に書く。点線の枠は中が地の色なので文字は濃い色 */
    const inside = val > 0 && len > 80;
    g.font = font(700, 15, true);
    g.fillStyle = inside && !dash ? COL.screen : COL.ink;
    g.textAlign = inside ? 'right' : 'left';
    g.fillText(signed(val), val < 0 ? z0 + 6 : inside ? xa + len - 6 : xa + len + 6, y + bh / 2);
  });
  g.font = font(500, 13);
  g.fillStyle = COL.ink3;
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillText(`記録も含めた合計 ${signed(v.all)}`, w - R, h - 2);
}

/* ---------- 悪魔の記憶 ---------- */
/** 記憶の欄の高さの上限 [px]。マスの大きさはこの高さで決め、欄の高さはマスの段数に合わせて縮める */
const TAPE_H = 120;
/**
 * 記憶の容量ぶんのマスを並べ、書いたビットを埋める。1 は濃い塗り、0 は枠だけ、空きは薄い塗り。
 * 消した直後は熱の色で光る
 */
export function drawTape(c: HTMLCanvasElement, gas: Gas): void {
  const cap = gas.cap,
    w0 = c.clientWidth;
  if (!w0) return;
  /* 容量が小さいときもマスは 28 px まで */
  let cs = Math.min(28, Math.floor(Math.sqrt((w0 * TAPE_H) / cap)));
  let cols = 0;
  for (; cs > 2; cs--) {
    cols = Math.floor((w0 + 1) / cs);
    if (cols * Math.floor((TAPE_H + 1) / cs) >= cap) break;
  }
  cols = Math.max(1, Math.floor((w0 + 1) / cs));
  const want = Math.ceil(cap / cols) * cs;
  if (Math.abs(c.clientHeight - want) > 0.5) c.style.height = `${want}px`;
  const s0 = surface(c);
  if (!s0) return;
  const { g } = s0,
    gapPx = cs > 6 ? 2 : 1,
    tape = gas.tape,
    flash = Math.max(0, 1 - (gas.t - gas.erasedAt) / 0.5),
    line = cs > 6;
  for (let k = 0; k < cap; k++) {
    const x = (k % cols) * cs,
      y = Math.floor(k / cols) * cs,
      b = tape[k],
      a = cs - gapPx;
    if (b === 0 && line) {
      g.strokeStyle = COL.ink2;
      g.lineWidth = 1.5;
      g.strokeRect(x + 0.75, y + 0.75, a - 1.5, a - 1.5);
      continue;
    }
    g.fillStyle = b === undefined ? COL.line : b ? COL.ink : COL.ink3;
    g.fillRect(x, y, a, a);
  }
  if (flash > 0) {
    g.globalAlpha = 0.5 * flash;
    g.fillStyle = COL.warn;
    g.fillRect(0, 0, Math.min(cap, cols) * cs, Math.ceil(cap / cols) * cs);
    g.globalAlpha = 1;
  }
}
/** 1 ビットあたりの消去の熱 [J]（300 K） */
export const J_PER_BIT = 1.380649e-23 * K0 * LN2;

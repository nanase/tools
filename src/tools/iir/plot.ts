/**
 * 表示窓に描く SVG の組み立て（DOM に依存しない）:
 * 周波数特性（振幅・位相・群遅延と仕様の枠）、s 平面・z 平面の極と零点、時間応答
 */
import { minus, parts } from '../../lib/format';
import { DV, nice, SH, SW } from '../../lib/scope';
import type { C } from './complex';
import type { Mask } from './design';
import type { Curve } from './digital';

/** 有効数字 s 桁、負はマイナス記号。計算結果（keep）は末尾の 0 を残す */
export const sig = (v: number, s: number, keep = false): string => {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '—' : v < 0 ? '−∞' : '∞';
  const t = v.toPrecision(s);
  return minus(keep && !t.includes('e') ? t : String(Number(t)));
};

/** 固定小数点。−0.000 は 0.000 に、±∞ と NaN は記号にする */
export function fixed(v: number, d: number): string {
  if (Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v < 0 ? '−∞' : '∞';
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : minus(s);
}

/**
 * 点列を折れ線にする。0.5 px ごとの区画で最初・最小・最大・最後だけを残す（鋭い山を落とさない）。
 * brk なら 180 以上跳ぶところ（位相の折り返し）で線を切る。NaN の点は飛ばして線を切る
 */
export function line(
  n: number,
  xOf: (k: number) => number,
  vOf: (k: number) => number,
  yOf: (v: number) => number,
  brk: boolean,
): string {
  let d = '',
    bx: number | null = null,
    x0 = 0,
    f = 0,
    lo = 0,
    hi = 0,
    la = 0,
    c = 0,
    pv: number | null = null,
    mv = 'M';
  const flush = () => {
    if (bx === null) return;
    const X = x0.toFixed(1);
    d += `${mv}${X} ${f.toFixed(1)}`;
    if (c > 1) d += `L${X} ${lo.toFixed(1)}L${X} ${hi.toFixed(1)}L${X} ${la.toFixed(1)}`;
    mv = 'L';
    bx = null;
  };
  for (let k = 0; k < n; k++) {
    const v = vOf(k);
    if (Number.isNaN(v)) {
      flush();
      mv = 'M';
      pv = null;
      continue;
    }
    if (brk && pv !== null && Math.abs(v - pv) >= 180) {
      flush();
      mv = 'M';
    }
    pv = v;
    const x = xOf(k),
      y = yOf(v),
      b = Math.round(x * 2);
    if (b !== bx) {
      flush();
      bx = b;
      x0 = x;
      f = lo = hi = la = y;
      c = 1;
    } else {
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      la = y;
      c++;
    }
  }
  flush();
  return d;
}

/* ---------- 周波数軸 ---------- */
export interface FAxis {
  log: boolean;
  f0: number;
  f1: number;
  X: (f: number) => number;
  F: (x: number) => number;
  grid: string;
  labels: string;
}

/** 周波数の短い表記（1k・2.5k） */
const fShort = (f: number) => parts(f, '', 3).join('');

/** 横軸: 対数なら f0〜fs/2、線形なら 0〜fs/2 */
export function freqAxis(fs: number, log: boolean, f0: number): FAxis {
  const f1 = fs / 2;
  let g = '',
    a = '';
  if (log) {
    const l0 = Math.log10(f0),
      l1 = Math.log10(f1),
      X = (f: number) => ((Math.log10(Math.max(f, f0 * 1e-3)) - l0) / (l1 - l0)) * SW;
    for (let d = Math.floor(l0); d <= Math.ceil(l1); d++)
      for (let m = 1; m < 10; m++) {
        const f = m * 10 ** d;
        if (f <= f0 * 1.0001 || f >= f1 * 0.9999) continue;
        g += `<path class="${m === 1 ? 'gl' : 'gl2'}" d="M${X(f).toFixed(1)} 0V${SH}"/>`;
        if (m === 1 || (l1 - l0 < 1.6 && (m === 2 || m === 5)))
          a += `<text x="${X(f).toFixed(1)}" y="${SH + 17}" text-anchor="middle">${fShort(f)}</text>`;
      }
    return { log, f0, f1, X, F: (x) => 10 ** (l0 + (x / SW) * (l1 - l0)), grid: g, labels: a };
  }
  const X = (f: number) => (f / f1) * SW,
    st = nice(f1 / 6);
  for (let f = st; f < f1 * 0.9999; f += st) {
    g += `<path class="gl" d="M${X(f).toFixed(1)} 0V${SH}"/>`;
    a += `<text x="${X(f).toFixed(1)}" y="${SH + 17}" text-anchor="middle">${fShort(f)}</text>`;
  }
  a += `<text x="0" y="${SH + 17}" text-anchor="middle">0</text>`;
  return { log, f0: 0, f1, X, F: (x) => (x / SW) * f1, grid: g, labels: a };
}

/* ---------- 周波数特性 ---------- */
export type FView = 'mag' | 'ph' | 'gd';
/** 振幅の縦軸の 1 div あたり [dB] の候補 */
const DIVS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];

export interface FrIn {
  f: ArrayLike<number>;
  a: Curve;
  b: Curve | null;
  view: FView;
  ax: FAxis;
  /** 振幅の縦軸の下端 [dB] */
  bot: number;
  mask: Mask | null;
}

export interface FrPlot {
  t1: string;
  t2: string;
  mask: string;
  maskLine: string;
  axes: string;
  /** 縦軸の 1 div あたり */
  dv: number;
  /** 縦軸の下端 */
  y0: number;
}

const pick = (c: Curve, v: FView) => (v === 'mag' ? c.mag : v === 'ph' ? c.ph : c.gd);

export function frPlot({ f, a, b, view, ax, bot, mask }: FrIn): FrPlot {
  const ca = pick(a, view),
    cb = b ? pick(b, view) : null,
    n = f.length;
  let y0: number, dv: number;
  if (view === 'mag') {
    let mx = -Infinity;
    for (const v of ca) if (v > mx) mx = v;
    const need = Math.max(Number.isFinite(mx) ? mx : 0, 0) + 3;
    dv = DIVS.find((d) => bot + 6 * d >= need) ?? Math.ceil((need - bot) / 60) * 10;
    y0 = bot;
  } else if (view === 'ph') {
    dv = 60;
    y0 = -180;
  } else {
    let mx = 0,
      mn = 0;
    for (const v of ca)
      if (Number.isFinite(v)) {
        mx = Math.max(mx, v);
        mn = Math.min(mn, v);
      }
    if (cb) for (const v of cb) if (Number.isFinite(v) && v < mx * 4) mx = Math.max(mx, v);
    if (mn < -mx * 0.02 && mn < 0) {
      dv = nice(Math.max(mx / 4.6, -mn / 0.9, 1e-9));
      y0 = -dv;
    } else {
      dv = nice(Math.max(mx / 5.6, 1e-9));
      y0 = 0;
    }
  }
  const Y = (v: number) => {
    const y = SH - ((v - y0) / dv) * DV;
    return Number.isNaN(y) ? SH + DV : Math.max(-DV, Math.min(SH + DV, y));
  };
  const X = (k: number) => ax.X(f[k]);
  const t1 = line(n, X, (k) => ca[k], Y, view === 'ph'),
    t2 = cb ? line(n, X, (k) => cb[k], Y, view === 'ph') : '';
  /* 仕様の枠: 通過域は −Ap より下、阻止域は −As より上を塗る */
  let m = '',
    ml = '';
  if (view === 'mag' && mask) {
    const cx = (x: number) => Math.max(0, Math.min(SW, ax.X(x))).toFixed(1);
    if (mask.ap != null)
      for (const [p, q] of mask.pass) {
        const y = Math.max(0, Math.min(SH, Y(-mask.ap))).toFixed(1);
        m += `M${cx(p)} ${y}H${cx(q)}V${SH}H${cx(p)}Z`;
        ml += `M${cx(p)} ${y}H${cx(q)}`;
      }
    if (mask.as != null)
      for (const [p, q] of mask.stop) {
        const y = Math.max(0, Math.min(SH, Y(-mask.as))).toFixed(1);
        m += `M${cx(p)} 0H${cx(q)}V${y}H${cx(p)}Z`;
        ml += `M${cx(p)} 0V${y}H${cx(q)}V0`;
      }
  }
  let axes = ax.labels;
  for (let j = 0; j <= 6; j++) {
    const v = y0 + j * dv;
    axes += `<text x="-10" y="${SH - j * DV + 4}" text-anchor="end">${view === 'ph' ? minus(String(v)) : sig(v, 4)}</text>`;
  }
  const z0 = Y(0);
  if (view !== 'ph' && z0 >= 0 && z0 <= SH) axes += `<path class="mk0" d="M-8 ${z0 - 5}L-1 ${z0}L-8 ${z0 + 5}Z"/>`;
  return { t1, t2, mask: m, maskLine: ml, axes, dv, y0 };
}

/* ---------- 極と零点 ---------- */
/** 平面の表示窓の大きさ（6 × 6 div） */
export const PZ = 6 * DV;

export interface PzIn {
  z: readonly C[];
  p: readonly C[];
  z2?: readonly C[] | null;
  p2?: readonly C[] | null;
  /** 中心から端までの値 */
  R: number;
  /** z 平面なら単位円を描く。s 平面の原型なら半径 1 の円を破線で描く */
  plane: 'z' | 's';
  circle: boolean;
  /** 目盛りの表記 */
  lab: (v: number) => string;
}

/** 近い根（表示で 1 px 未満）を 1 つにまとめ、重なりの数を数える */
function cluster(rs: readonly C[], tol: number): [C, number][] {
  const o: [C, number][] = [];
  for (const r of rs) {
    const h = o.find(([c]) => Math.hypot(c.re - r.re, c.im - r.im) < tol);
    if (h) h[1]++;
    else o.push([r, 1]);
  }
  return o;
}

function marks(rs: readonly C[], kind: 'p' | 'z', cls: string, P: (r: C) => [number, number, boolean], tol: number) {
  let s = '';
  for (const [r, n] of cluster(rs, tol)) {
    const [x, y, out] = P(r),
      X = x.toFixed(1),
      Yy = y.toFixed(1),
      o = out ? ' oob' : '';
    s +=
      kind === 'p'
        ? `<path class="pm ${cls}${o}" d="M${(x - 4).toFixed(1)} ${(y - 4).toFixed(1)}l8 8m0 -8l-8 8"/>`
        : `<circle class="zm ${cls}${o}" cx="${X}" cy="${Yy}" r="4"/>`;
    if (n > 1) s += `<text class="mul ${cls}" x="${(x + 6).toFixed(1)}" y="${(y - 6).toFixed(1)}">${n}</text>`;
  }
  return s;
}

/** 平面の目盛りと極・零点。中心が原点、R が端（3 div） */
export function pzPlot({ z, p, z2, p2, R, plane, circle, lab }: PzIn): { grid: string; marks: string } {
  const c = PZ / 2,
    u = c / R,
    lim = R;
  const P = (r: C): [number, number, boolean] => {
    const out = Math.abs(r.re) > lim || Math.abs(r.im) > lim,
      re = Math.max(-lim, Math.min(lim, r.re)),
      im = Math.max(-lim, Math.min(lim, r.im));
    return [c + re * u, c - im * u, out];
  };
  let g = '';
  for (let i = 0; i <= 6; i++) {
    const v = i * DV;
    g += `<path class="gl" d="M${v} 0V${PZ}M0 ${v}H${PZ}"/>`;
  }
  g += `<path class="gb" d="M${c} 0V${PZ}M0 ${c}H${PZ}"/><rect class="gb" x="0" y="0" width="${PZ}" height="${PZ}"/>`;
  if (circle) g += `<circle class="${plane === 'z' ? 'uc' : 'uc d'}" cx="${c}" cy="${c}" r="${u.toFixed(2)}"/>`;
  for (const j of [-2, 0, 2]) {
    const v = (j * R) / 3,
      t = j ? lab(v) : '0';
    g += `<text x="${c + j * DV}" y="${PZ + 17}" text-anchor="middle">${t}</text>`;
    g += `<text x="-8" y="${c - j * DV + 4}" text-anchor="end">${t}</text>`;
  }
  g += `<text class="axl" x="${PZ + 4}" y="${c - 4}">${plane === 'z' ? 'Re' : 'σ'}</text><text class="axl" x="${c + 5}" y="-4">${plane === 'z' ? 'Im' : 'jΩ'}</text>`;
  const tol = R / c;
  let m = '';
  if (z2) m += marks(z2, 'z', 'c2x m2', P, tol);
  if (p2) m += marks(p2, 'p', 'c2x m2', P, tol);
  m += marks(z, 'z', 'm1', P, tol) + marks(p, 'p', 'm1', P, tol);
  return { grid: g, marks: m };
}

/** s 平面の端の値: 極（と近くの零点）が収まる 1-2-5 の値の 3 倍 */
export function sRange(z: readonly C[], p: readonly C[]): number {
  let m = 0;
  for (const r of p) m = Math.max(m, Math.abs(r.re), Math.abs(r.im));
  const mp = m || 1;
  for (const r of z) {
    const a = Math.max(Math.abs(r.re), Math.abs(r.im));
    if (a <= mp * 3) m = Math.max(m, a);
  }
  return 3 * nice((m || 1) / 2.9);
}

/* ---------- 時間応答 ---------- */
/** 時間応答の表示窓の縦の div の数と高さ */
export const TR = 6,
  TH = TR * DV;

export interface TimePlot {
  t1: string;
  /** インパルス応答の棒の太さ */
  width: number;
  dots: string;
  t2: string;
  zero: string;
  axes: string;
  vd: number;
  /** 横軸の 1 div あたりのサンプル数 */
  d: number;
  nEnd: number;
  X: (n: number) => number;
}

/**
 * n = 0 を 1 div 目に置き、表示長 len を 8 div に収める。縦軸は CH1 の符号の偏りで 0 の位置を決める。
 * stem ならインパルス応答（棒）、そうでなければステップ応答（折れ線）
 */
export function timePlot(a: Float64Array, b: Float64Array | null, len: number, stem: boolean): TimePlot {
  const d = len / 8,
    nEnd = Math.min(a.length, Math.floor(9 * d) + 1);
  let mx = 0,
    mn = 0;
  for (let n = 0; n < nEnd; n++) {
    if (a[n] > mx) mx = a[n];
    if (a[n] < mn) mn = a[n];
  }
  let zj = TR / 2,
    vd = nice(Math.max(mx, -mn) / (TR / 2 - 0.2));
  const vp = nice(mx / (TR - 1.4)),
    vn = nice(-mn / (TR - 1.4));
  if (mx > 0 && -mn <= vp * 0.95) {
    zj = 1;
    vd = vp;
  } else if (mn < 0 && mx <= vn * 0.95) {
    zj = TR - 1;
    vd = vn;
  }
  if (!(vd > 0) || !Number.isFinite(vd)) vd = 1;
  const y0 = TH - zj * DV,
    Y = (v: number) => Math.max(-DV, Math.min(TH + DV, y0 - (v / vd) * DV)),
    X = (n: number) => DV + (n / d) * DV,
    sp = DV / d;
  let p = '',
    dots = '';
  if (!stem) p = line(nEnd, X, (n) => a[n], Y, false);
  else if (sp >= 1) {
    for (let n = 0; n < nEnd; n++) p += `M${X(n).toFixed(2)} ${y0}V${Y(a[n]).toFixed(2)}`;
    if (sp >= 6)
      for (let n = 0; n < nEnd; n++)
        dots += `<circle class="dt1" cx="${X(n).toFixed(2)}" cy="${Y(a[n]).toFixed(2)}" r="2.3"/>`;
  } else {
    /* 1 px に複数の点が入るときは、px ごとに 0 を含む最小〜最大の縦線にする */
    let bx = -1,
      lo = 0,
      hi = 0;
    const out = () => {
      if (bx >= 0) p += `M${bx + 0.5} ${Y(lo).toFixed(1)}V${Y(hi).toFixed(1)}`;
    };
    for (let n = 0; n < nEnd; n++) {
      const x = Math.floor(X(n));
      if (x !== bx) {
        out();
        bx = x;
        lo = Math.min(0, a[n]);
        hi = Math.max(0, a[n]);
      } else {
        lo = Math.min(lo, a[n]);
        hi = Math.max(hi, a[n]);
      }
    }
    out();
  }
  const t2 = b ? line(Math.min(b.length, nEnd), X, (n) => (Number.isFinite(b[n]) ? b[n] : NaN), Y, false) : '';
  const lab = (v: number) => {
    const r = Number(v.toPrecision(3));
    return Math.abs(r) < vd * 1e-6 ? '0' : minus(String(r));
  };
  let ax = '';
  for (let j = 0; j <= TR; j++)
    ax += `<text x="-10" y="${TH - j * DV + 4}" text-anchor="end">${lab((j - zj) * vd)}</text>`;
  for (let i = 1; i <= 9; i += 2) ax += `<text x="${i * DV}" y="${TH + 17}" text-anchor="middle">${(i - 1) * d}</text>`;
  ax += `<path class="mk0" d="M-8 ${y0 - 5}L-1 ${y0}L-8 ${y0 + 5}Z"/><path class="mk0" d="M${DV - 5} -12L${DV + 5} -12L${DV} -5Z"/>`;
  return {
    t1: p,
    width: sp >= 4 ? 2 : sp >= 1.5 ? 1.3 : 1,
    dots,
    t2,
    zero: `M0 ${y0}H${SW}`,
    axes: ax,
    vd,
    d,
    nEnd,
    X,
  };
}

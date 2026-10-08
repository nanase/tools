/**
 * 表示窓に描く SVG の組み立て（DOM に依存しない）: 周波数特性（線形の周波数軸と仕様の枠）、
 * インパルス応答（係数の棒・理想の応答・窓）、z 平面の零点
 */
import { parts } from '../../lib/format';
import { DV, nice, SH, SW } from '../../lib/scope';
import { sig, trace } from '../biquad/plot';
import type { Freq, Zeros } from './analysis';
import type { Band } from './spec';

/** 振幅の縦軸: dB、線形、通過域の拡大（dB） */
export type YMode = 'db' | 'lin' | 'pass';
/** CH2: 位相、群遅延 */
export type Ch2 = 'ph' | 'gd';

const DB_DIVS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const ZOOM_DIVS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2];
/** 線形の縦軸の 1 div */
const LIN_DV = 0.2;

const dB = (m: number): number => 20 * Math.log10(m);
/** 表示窓の外へ出た点は窓のすぐ外に置く（クリップで消す） */
const clampY = (y: number, h: number): number => (Number.isNaN(y) ? h + DV : Math.max(-DV, Math.min(h + DV, y)));

export interface FrIn {
  fr: Freq;
  fs: number;
  bands: readonly Band[];
  /** 仕様の許容値 */
  dp: number;
  ds: number;
  ymode: YMode;
  ch2: Ch2;
  /** 群遅延 (N − 1)/2 [サンプル] */
  M: number;
  /** 縦軸に入れる阻止域の深さ [dB]（仕様と実際の深い方） */
  depth: number;
  /** 通過域の |H| の最大・最小 */
  pmax: number;
  pmin: number;
}

export interface FrPlot {
  mag: string;
  ch2: string;
  /** 仕様の枠 */
  mask: string;
  axes: string;
  /** CH1・CH2 の 1 div あたりの表記（単位つき） */
  dv1: string;
  dv2: string;
  /** 振幅 |H| → y */
  Ym: (m: number) => number;
  /** 周波数（fs で割った値）→ x、x → 周波数 */
  X: (f: number) => number;
  F: (x: number) => number;
}

/** 横軸は 0 … fs/2 の線形（10 div）。縦軸は 6 div */
export function frPlot(p: FrIn): FrPlot {
  const { fr, fs, ymode, ch2, M } = p,
    K = fr.mag.length,
    X = (f: number) => 2 * f * SW,
    xk = (k: number) => X(k / fr.L);
  let Ym: (m: number) => number, lab: (j: number) => string, dv1: string, zeroY: number;
  if (ymode === 'lin') {
    Ym = (m) => clampY(SH - (m / LIN_DV) * DV, SH);
    lab = (j) => sig((6 - j) * LIN_DV, 3);
    dv1 = String(LIN_DV);
    zeroY = SH - DV * 5;
  } else if (ymode === 'pass') {
    const r = 1.25 * Math.max(Math.abs(dB(p.pmax)), Math.abs(dB(p.pmin)), dB(1 + p.dp), -dB(1 - p.dp)),
      d = ZOOM_DIVS.find((x) => 3 * x >= r) ?? 5;
    Ym = (m) => clampY(SH / 2 - (dB(m) / d) * DV, SH);
    lab = (j) => sig((3 - j) * d, 4);
    dv1 = `${sig(d, 4)} dB`;
    zeroY = SH / 2;
  } else {
    const d = DB_DIVS.find((x) => 5 * x >= p.depth + 10) ?? Math.ceil((p.depth + 10) / 50) * 10;
    Ym = (m) => clampY(((d - dB(m)) / d) * DV, SH);
    lab = (j) => sig(d - j * d, 4);
    dv1 = `${d} dB`;
    zeroY = DV;
  }
  /* 位相（つないだ値。上端は 0° か最大の上の目盛り）か群遅延（0 から 6 div） */
  let pmx = 0,
    pmn = 0;
  for (const v of fr.ph)
    if (Number.isFinite(v)) {
      if (v > pmx) pmx = v;
      if (v < pmn) pmn = v;
    }
  let pdv = nice(Math.max(pmx - pmn, 1) / 5.6),
    top = Math.ceil(pmx / pdv) * pdv;
  while (top - 6 * pdv > pmn) {
    pdv = nice(pdv * 1.01);
    top = Math.ceil(pmx / pdv) * pdv;
  }
  const gdv = nice(Math.max(M, 0.5) / 3),
    Y2 =
      ch2 === 'ph' ? (v: number) => clampY(((top - v) / pdv) * DV, SH) : (v: number) => clampY(SH - (v / gdv) * DV, SH);
  /* k = 0 から描く（trace は k = 0 を飛ばすので 1 つずらす） */
  const tr = (v: (k: number) => number, y: (x: number) => number, brk: boolean) =>
    trace(
      K + 1,
      (k) => xk(k - 1),
      (k) => v(k - 1),
      y,
      brk,
    );

  /* 仕様の枠: 通過域は 1 ± δp、阻止域は δs。遷移帯域側の端は縦線で閉じる */
  let mask = '';
  const x = (f: number) => X(f).toFixed(1);
  for (const b of p.bands) {
    if (b.pass) {
      const u = Ym(1 + p.dp).toFixed(1),
        l = Ym(1 - p.dp).toFixed(1);
      mask += `M${x(b.lo)} ${u}H${x(b.hi)}M${x(b.lo)} ${l}H${x(b.hi)}`;
      if (b.lo > 0) mask += `M${x(b.lo)} ${l}V${SH + DV}`;
      if (b.hi < 0.5) mask += `M${x(b.hi)} ${l}V${SH + DV}`;
    } else {
      const s = Ym(p.ds).toFixed(1);
      mask += `M${x(b.lo)} ${s}H${x(b.hi)}`;
      if (b.lo > 0) mask += `M${x(b.lo)} ${s}V${-DV}`;
      if (b.hi < 0.5) mask += `M${x(b.hi)} ${s}V${-DV}`;
    }
  }

  let a = '<g class="c1x">';
  for (let j = 0; j <= 6; j++) a += `<text x="-10" y="${j * DV + 4}" text-anchor="end">${lab(j)}</text>`;
  a += `<path class="mk1" d="M-8 ${zeroY - 5}L-1 ${zeroY}L-8 ${zeroY + 5}Z"/></g><g class="c2x">`;
  for (let j = 0; j <= 6; j++)
    a += `<text class="p2" x="${SW + 11}" y="${SH - j * DV + 4}">${ch2 === 'ph' ? sig(top - (6 - j) * pdv, 4) : sig(j * gdv, 4)}</text>`;
  const m2 = ch2 === 'ph' ? Y2(0) : Y2(M);
  a += `<path class="mk2" d="M${SW + 1} ${m2.toFixed(1)}l7 -5v10Z"/></g>`;
  for (let i = 0; i <= 10; i += 2) {
    const f = (fs / 2) * (i / 10);
    a += `<text x="${i * DV}" y="${SH + 17}" text-anchor="middle">${f ? parts(f, '', 3).join('') : '0'}</text>`;
  }
  return {
    mag: tr((k) => fr.mag[k], Ym, false),
    ch2: tr((k) => (ch2 === 'ph' ? fr.ph[k] : fr.gd[k]), Y2, false),
    mask,
    axes: a,
    dv1,
    dv2: ch2 === 'ph' ? `${sig(pdv, 3)}°` : `${sig(gdv, 3)} S`,
    Ym,
    X,
    F: (px) => px / SW / 2,
  };
}

/* ---------- インパルス応答 ---------- */
/** 表示窓の縦の div の数と高さ */
export const IR = 4,
  IH = IR * DV;

/** 1 div あたりのサンプル数: 1・2・2.5・4・5・8 × 10ⁿ で x 以上の最小 */
export function stepDiv(x: number): number {
  if (x <= 1) return 1;
  const e = Math.floor(Math.log10(x));
  for (const m of [1, 2, 2.5, 4, 5, 8, 10]) {
    const v = Number((m * 10 ** e).toPrecision(3));
    if (v >= x * (1 - 1e-9)) return v;
  }
  return 10 ** (e + 1);
}

export interface IrPlot {
  stem: string;
  /** 軸の太さ（点の間隔で変える） */
  width: number;
  dots: string;
  zero: string;
  /** 理想の応答 h_d[n] と、窓 w[n]（理想の応答の最大に合わせた大きさ） */
  ideal: string;
  win: string;
  /** 対称の中心 n = (N − 1)/2 の縦線 */
  center: string;
  axes: string;
  /** 縦軸・横軸の 1 div あたり */
  vd: number;
  d: number;
  X: (n: number) => number;
  Y: (v: number) => number;
}

/** n = 0 を 1 div 目に置き、N 本を 8.5 div に収める。縦軸は値の符号の偏りで 0 の位置を決める */
export function irPlot(h: Float64Array, hd?: Float64Array, w?: Float64Array): IrPlot {
  const N = h.length,
    d = stepDiv((N - 1) / 8.5);
  let mx = 0,
    mn = 0;
  for (const a of [h, hd]) if (a) for (const v of a) [mx, mn] = [Math.max(mx, v), Math.min(mn, v)];
  /* ほぼ正だけなら 0 を下から 1 div、ほぼ負だけなら上から 1 div、それ以外は中央に置く */
  let zj = IR / 2,
    vd = nice(Math.max(mx, -mn) / (IR / 2 - 0.2));
  const vp = nice(mx / (IR - 1.4)),
    vn = nice(-mn / (IR - 1.4));
  if (mx > 0 && -mn <= vp * 0.95) {
    zj = 1;
    vd = vp;
  } else if (mn < 0 && mx <= vn * 0.95) {
    zj = IR - 1;
    vd = vn;
  }
  if (!(vd > 0) || !Number.isFinite(vd)) vd = 1;
  const y0 = IH - zj * DV,
    Y = (v: number) => y0 - (v / vd) * DV,
    X = (n: number) => DV + (n / d) * DV,
    sp = DV / d;
  let p = '',
    dots = '';
  if (sp >= 1) {
    for (let n = 0; n < N; n++) p += `M${X(n).toFixed(2)} ${y0}V${Y(h[n]).toFixed(2)}`;
    if (sp >= 6)
      for (let n = 0; n < N; n++)
        dots += `<circle class="dt1" cx="${X(n).toFixed(2)}" cy="${Y(h[n]).toFixed(2)}" r="2.3"/>`;
  } else {
    /* 1 px に複数の点が入るときは、px ごとに 0 を含む最小〜最大の縦線にする */
    let bx = -1,
      lo = 0,
      hi = 0;
    const out = () => {
      if (bx >= 0) p += `M${bx + 0.5} ${Y(lo).toFixed(1)}V${Y(hi).toFixed(1)}`;
    };
    for (let n = 0; n < N; n++) {
      const b = Math.floor(X(n));
      if (b !== bx) {
        out();
        bx = b;
        lo = Math.min(0, h[n]);
        hi = Math.max(0, h[n]);
      } else {
        lo = Math.min(lo, h[n]);
        hi = Math.max(hi, h[n]);
      }
    }
    out();
  }
  const line = (v: (n: number) => number) =>
    Array.from({ length: N }, (_, n) => `${n ? 'L' : 'M'}${X(n).toFixed(1)} ${Y(v(n)).toFixed(1)}`).join('');
  let A = 0;
  if (hd) for (const v of hd) A = Math.max(A, Math.abs(v));
  const lab = (v: number) => {
    const r = Number(v.toPrecision(3));
    return Math.abs(r) < vd * 1e-6 ? '0' : sig(r, 3);
  };
  let a = '';
  for (let j = 0; j <= IR; j++)
    a += `<text x="-10" y="${IH - j * DV + 4}" text-anchor="end">${lab((j - zj) * vd)}</text>`;
  for (let i = 1; i <= 9; i += 2) a += `<text x="${i * DV}" y="${IH + 17}" text-anchor="middle">${(i - 1) * d}</text>`;
  const xc = X((N - 1) / 2).toFixed(1);
  a += `<path class="mk1" d="M-8 ${y0 - 5}L-1 ${y0}L-8 ${y0 + 5}Z"/>`;
  a += `<text x="${xc}" y="-5" text-anchor="middle">(N−1)/2</text>`;
  return {
    stem: p,
    width: sp >= 4 ? 2 : sp >= 1.5 ? 1.3 : 1,
    dots,
    zero: `M0 ${y0}H${SW}`,
    ideal: hd ? line((n) => hd[n]) : '',
    win: w && A > 0 ? line((n) => w[n] * A) : '',
    center: `M${xc} 0V${IH}`,
    axes: a,
    vd,
    d,
    X,
    Y,
  };
}

/* ---------- z 平面 ---------- */
/** 表示の半径の候補（1 div = R/5。単位円が目盛りの線に乗る） */
const RADII = [1.25, 2.5, 5];
/** 単位円の上とみなす |z| のずれ */
export const ON_CIRCLE = 1e-4;

export interface ZPlot {
  dots: string;
  /** 単位円 */
  ring: string;
  pole: string;
  axes: string;
  R: number;
  /** 表示の外の零点、単位円の上の零点の数 */
  out: number;
  on: number;
  /** 複素数 → 表示窓の座標、表示窓の座標 → 複素数 */
  P: (re: number, im: number) => [number, number];
  Z: (x: number, y: number) => [number, number];
}

/** 10 × 10 div の表示窓。半径 R は零点がすべて入る候補の最小（入らなければ最大） */
export function zPlot(z: Zeros, poles: number): ZPlot {
  const n = z.re.length;
  let mr = 0,
    on = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(z.re[i], z.im[i]);
    if (Number.isFinite(r)) mr = Math.max(mr, r);
    if (Math.abs(r - 1) <= ON_CIRCLE) on++;
  }
  const R = RADII.find((x) => mr <= x * 0.98) ?? RADII[RADII.length - 1],
    c = SW / 2,
    s = c / R,
    P = (re: number, im: number): [number, number] => [c + re * s, c - im * s];
  let dots = '',
    out = 0;
  for (let i = 0; i < n; i++) {
    const re = z.re[i],
      im = z.im[i];
    if (Math.hypot(re, im) > R) {
      out++;
      continue;
    }
    const [x, y] = P(re, im);
    dots += `<circle class="zz" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6"/>`;
  }
  let a = '';
  for (let i = 1; i <= 9; i += 2) {
    const v = sig(((i - 5) * R) / 5, 3);
    a += `<text x="${i * DV}" y="${SW + 17}" text-anchor="middle">${v}</text>`;
    a += `<text x="-10" y="${SW - i * DV + 4}" text-anchor="end">${v}</text>`;
  }
  a += `<text x="${SW - 4}" y="${c + 16}" text-anchor="end">Re</text><text x="${c + 6}" y="14">Im</text>`;
  const pole =
    poles > 0
      ? `<path class="zp" d="M${c - 5} ${c - 5}l10 10m0 -10l-10 10"/><text class="zpt" x="${c + 8}" y="${c + 16}">${poles}</text>`
      : '';
  return {
    dots,
    ring: `<circle class="zu" cx="${c}" cy="${c}" r="${s.toFixed(2)}"/>`,
    pole,
    axes: a,
    R,
    out,
    on,
    P,
    Z: (x, y) => [(x - c) / s, (c - y) / s],
  };
}

/**
 * 表示窓（10 × 6 div）に描く SVG の組み立て（DOM に依存しない）:
 * 周波数特性（対数周波数軸）、インパルス応答、レベルメーター、ブロック図
 */
import { minus, parts } from '../../lib/format';
import { DV, nice, SH, SW } from '../../lib/scope';

/** 固定小数点。−0.000 は 0.000 に、±∞ と NaN は記号にする */
export function fixed(v: number, d: number): string {
  if (Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v < 0 ? '−∞' : '∞';
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : minus(s);
}

/** 有効数字 s 桁、負はマイナス記号 */
export const sig = (v: number, s: number): string => minus(String(Number(v.toPrecision(s))));

/**
 * 点列を折れ線にする。1 px あたり 2 区画に間引き、区画ごとに最初・最小・最大・最後を残す（鋭いピークを落とさない）。
 * brk なら 180 以上跳ぶところ（位相の折り返し）で線を切る。k = 0 は描かない
 */
export function trace(
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
  for (let k = 1; k < n; k++) {
    const v = vOf(k);
    if (Number.isNaN(v)) continue;
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

/* ---------- 周波数特性 ---------- */
/** 縦軸の 1 div あたり [dB] の候補 */
const DIVS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];

export interface FrIn {
  N: number;
  fs: number;
  fc: number;
  mag: Float64Array;
  ph: Float64Array;
  /** 最大振幅 [dB] */
  max: number;
  /** 縦軸の下端 [dB] */
  bot: number;
}

export interface FrPlot {
  grid: string;
  mag: string;
  phase: string;
  /** fc の縦線（範囲外なら空） */
  fcLine: string;
  axes: string;
  /** 縦軸の 1 div あたり [dB] */
  dv: number;
  f0: number;
  f1: number;
  /** 周波数 → x */
  X: (f: number) => number;
  /** x → 周波数 */
  F: (x: number) => number;
}

/** 横軸は fs/N から fs/2 の対数、縦軸は下端 bot から 6 div（最大振幅 + 3 dB が入る刻み）。位相は ±180° */
export function frPlot({ N, fs, fc, mag, ph, max, bot: B }: FrIn): FrPlot {
  const H = N / 2,
    f0 = fs / N,
    f1 = fs / 2;
  const l0 = Math.log10(f0),
    l1 = Math.log10(f1),
    X = (f: number) => ((Math.log10(f) - l0) / (l1 - l0)) * SW;
  let g = '';
  for (let d = Math.floor(l0); d <= Math.ceil(l1); d++)
    for (let m = 1; m < 10; m++) {
      const f = m * 10 ** d;
      if (f <= f0 * 1.0001 || f >= f1 * 0.9999) continue;
      g += `<path class="${m === 1 ? 'gl' : 'gl2'}" d="M${X(f).toFixed(1)} 0V${SH}"/>`;
    }
  for (let j = 1; j < 6; j++) g += `<path class="gl" d="M0 ${j * DV}H${SW}"/>`;
  for (let y = 8; y < SH; y += 8) g += `<path class="gb" d="M0 ${y}h4M${SW} ${y}h-4"/>`;
  g += `<rect class="gb" x="0" y="0" width="${SW}" height="${SH}"/>`;

  const need = Math.max(max, 0) + 3;
  const dv = DIVS.find((d) => B + 6 * d >= need) ?? Math.ceil((need - B) / 60) * 10;
  const Y = (a: number) => {
    const y = SH - ((a - B) / dv) * DV;
    return Number.isNaN(y) ? SH + DV : Math.max(-DV, Math.min(SH + DV, y));
  };
  const Yp = (p: number) => SH / 2 - (p / 60) * DV,
    xk = (k: number) => X((k * fs) / N);
  const inX = (f: number) => f >= f0 && f <= f1;

  let a = '<g class="c1x">';
  for (let j = 0; j <= 6; j++)
    a += `<text x="-10" y="${SH - j * DV + 4}" text-anchor="end">${sig(B + j * dv, 4)}</text>`;
  if (0 >= B && 0 <= B + 6 * dv) a += `<path class="mk1" d="M-8 ${Y(0) - 5}L-1 ${Y(0)}L-8 ${Y(0) + 5}Z"/>`;
  a += '</g><g class="c2x">';
  for (let j = 0; j <= 6; j++)
    a += `<text class="p2" x="${SW + 11}" y="${SH - j * DV + 4}">${minus(String(-180 + 60 * j))}</text>`;
  a += `<path class="mk2" d="M${SW + 1} ${SH / 2}l7 -5v10Z"/></g>`;
  for (let d = Math.ceil(l0); d <= Math.floor(l1); d++) {
    const f = 10 ** d;
    if (inX(f))
      a += `<text x="${X(f).toFixed(1)}" y="${SH + 17}" text-anchor="middle">${parts(f, '', 3).join('')}</text>`;
  }
  if (inX(fc))
    a += `<text x="${X(fc).toFixed(1)}" y="-5" text-anchor="middle">f<tspan dy="2" font-size="0.75em">c</tspan></text>`;

  return {
    grid: g,
    mag: trace(H, xk, (k) => mag[k], Y, false),
    phase: trace(H, xk, (k) => ph[k], Yp, true),
    fcLine: inX(fc) ? `M${X(fc).toFixed(1)} 0V${SH}` : '',
    axes: a,
    dv,
    f0,
    f1,
    X,
    F: (x) => 10 ** (l0 + (x / SW) * (l1 - l0)),
  };
}

/** 周波数特性のカーソルの位置 x にいちばん近い点の番号（1 … N/2 − 1） */
export const frIndex = (f: number, fs: number, N: number): number =>
  Math.max(1, Math.min(N / 2 - 1, Math.round((f / fs) * N)));

/* ---------- インパルス応答 ---------- */
export interface ImpPlot {
  stem: string;
  /** 軸の太さ（点の間隔で変える） */
  width: number;
  dots: string;
  zero: string;
  axes: string;
  /** 縦軸・横軸の 1 div あたり */
  vd: number;
  d: number;
  /** 描く点の数 */
  nEnd: number;
  /** n → x */
  X: (n: number) => number;
}

/** インパルス応答の表示窓の縦の div の数と高さ（周波数特性より低くする） */
export const IR = 4,
  IH = IR * DV;

/** n = 0 を 1 div 目に置き、表示長 L を 8 div に収める。縦軸は応答の符号の偏りで 0 の位置を決める */
export function impPlot(h: Float64Array, N: number, len: number): ImpPlot {
  const L = Math.min(len, N),
    d = L / 8;
  const nEnd = Math.min(N, Math.floor(9 * d) + 1);
  let mx = 0,
    mn = 0;
  for (let n = 0; n < nEnd; n++) {
    if (h[n] > mx) mx = h[n];
    if (h[n] < mn) mn = h[n];
  }
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
    for (let n = 0; n < nEnd; n++) p += `M${X(n).toFixed(2)} ${y0}V${Y(h[n]).toFixed(2)}`;
    if (sp >= 6)
      for (let n = 0; n < nEnd; n++)
        dots += `<circle class="dt1" cx="${X(n).toFixed(2)}" cy="${Y(h[n]).toFixed(2)}" r="2.3"/>`;
  } else {
    /* 1 px に複数の点が入るときは、px ごとに 0 を含む最小〜最大の縦線にする */
    let bx = -1,
      lo = 0,
      hi = 0;
    const out = () => {
      if (bx >= 0) p += `M${bx + 0.5} ${Y(lo).toFixed(1)}V${Y(hi).toFixed(1)}`;
    };
    for (let n = 0; n < nEnd; n++) {
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
  const lab = (v: number) => {
    const r = Number(v.toPrecision(3));
    return Math.abs(r) < vd * 1e-6 ? '0' : minus(String(r));
  };
  let a = '';
  for (let j = 0; j <= IR; j++)
    a += `<text x="-10" y="${IH - j * DV + 4}" text-anchor="end">${lab((j - zj) * vd)}</text>`;
  for (let i = 1; i <= 9; i += 2) a += `<text x="${i * DV}" y="${IH + 17}" text-anchor="middle">${(i - 1) * d}</text>`;
  a += `<path class="mk1" d="M-8 ${y0 - 5}L-1 ${y0}L-8 ${y0 + 5}Z"/><path class="mk1" d="M${DV - 5} -12L${DV + 5} -12L${DV} -5Z"/>`;
  return {
    stem: p,
    width: sp >= 4 ? 2 : sp >= 1.5 ? 1.3 : 1,
    dots,
    zero: `M0 ${y0}H${SW}`,
    axes: a,
    vd,
    d,
    nEnd,
    X,
  };
}

/* ---------- レベルメーター（−50 … 0 dBFS を横 10 div） ---------- */
export const LV0 = -50;
/** 赤く塗る始まり [dBFS] */
export const LV_HOT = -9;
export const lvX = (v: number): number => Math.max(0, Math.min(SW, ((v - LV0) / -LV0) * SW));

/** 目盛り（ビルド時に使う） */
export function lvGrid(): string {
  let g = '';
  for (let i = 0; i <= 10; i++) g += `<path class="gl" d="M${i * DV} 0V22"/>`;
  g += `<rect class="gb" x="0" y="0" width="${SW}" height="22"/>`;
  for (let i = 0; i <= 10; i += 2)
    g += `<text x="${i * DV}" y="35" text-anchor="middle">${i === 10 ? '0' : minus(String(LV0 + i * 5))}</text>`;
  return g;
}

/* ---------- ブロック図（直接形 I。ビルド時に使う） ---------- */
export function blockSvg(): string {
  const XJ = 52,
    XB = 112,
    XS = 180,
    XA = 248,
    XK = 308,
    XO = 344,
    Y = [34, 110, 186];
  let w = '',
    j = '',
    t = '';
  /* 遅延の段 */
  const dl = (x: number) => {
    for (const [a, b] of [
      [Y[0], Y[1]],
      [Y[1], Y[2]],
    ]) {
      const m = (a + b) / 2;
      w += `M${x} ${a}V${m - 11}M${x} ${m + 11}V${b}`;
      t += `<rect class="s-p" x="${x - 17}" y="${m - 11}" width="34" height="22"/><text class="s-l" x="${x}" y="${m + 5}" text-anchor="middle">z<tspan font-size="9" dy="-6">−1</tspan></text>`;
      j += `<path class="s-ah" d="M${x} ${m - 11}l-3.5 -7h7Z"/>`;
    }
  };
  dl(XJ);
  dl(XK);
  w += `M18 ${Y[0]}H${XJ}`;
  Y.forEach((y, i) => {
    w += `M${XJ} ${y}H${XB - 10}M${XB + 10} ${y}H${XS - 9}`;
    t += `<path class="s-p" d="M${XB - 10} ${y - 10}L${XB + 10} ${y}L${XB - 10} ${y + 10}Z"/>`;
    t += `<text class="s-v" id="bd-b${i}" x="${XB}" y="${y - 15}" text-anchor="middle"></text>`;
    t += `<text class="s-l" x="${XB}" y="${y + 26}" text-anchor="middle">b<tspan font-size="9" dy="3">${i}</tspan></text>`;
    t += `<circle class="s-p" cx="${XS}" cy="${y}" r="9"/><path class="s-w" d="M${XS - 4.5} ${y}H${XS + 4.5}M${XS} ${y - 4.5}V${y + 4.5}"/>`;
    j += `<path class="s-ah" d="M${XS - 9} ${y}l-7 -3.5v7Z"/>`;
    if (i) {
      w += `M${XK} ${y}H${XA + 10}M${XA - 10} ${y}H${XS + 9}M${XS} ${y - 9}V${Y[i - 1] + 9}`;
      t += `<path class="s-p" d="M${XA + 10} ${y - 10}L${XA - 10} ${y}L${XA + 10} ${y + 10}Z"/>`;
      t += `<text class="s-v" id="bd-a${i}" x="${XA}" y="${y - 15}" text-anchor="middle"></text>`;
      t += `<text class="s-l" x="${XA}" y="${y + 26}" text-anchor="middle">−a<tspan font-size="9" dy="3">${i}</tspan></text>`;
      j += `<path class="s-ah" d="M${XS + 9} ${y}l7 -3.5v7Z"/><path class="s-ah" d="M${XS} ${Y[i - 1] + 9}l-3.5 7h7Z"/>`;
      if (i === 1)
        j += `<circle class="s-j" cx="${XJ}" cy="${y}" r="2.6"/><circle class="s-j" cx="${XK}" cy="${y}" r="2.6"/>`;
    }
  });
  const o = `<path class="s-w n1" d="M${XS + 9} ${Y[0]}H${XO - 4}"/><path class="s-ah n1" d="M${XO - 4} ${Y[0]}l-7 -3.5v7Z"/>`;
  j += `<circle class="s-j" cx="${XJ}" cy="${Y[0]}" r="2.6"/><circle class="s-j" cx="${XK}" cy="${Y[0]}" r="2.6"/>`;
  return (
    `<path class="s-w" d="${w}"/>${o}${t}${j}` +
    `<circle class="s-o" cx="14" cy="${Y[0]}" r="3.5"/><circle class="s-o n1" cx="${XO}" cy="${Y[0]}" r="3.5"/>` +
    `<text class="s-l" x="14" y="${Y[0] - 11}" text-anchor="middle">x[n]</text><text class="s-l" x="${XO}" y="${Y[0] - 11}" text-anchor="middle">y[n]</text>`
  );
}

/**
 * 図の計算（DOM に依存しない）: 時間波形の表示窓（横 1 s/div で流れる、縦は値に合わせる）と、
 * s 平面の極の配置図。SVG のパスと文字を返す
 */
import { DV, nice, SW } from '../../lib/scope';
import type { C } from './linalg';

/* ---------- 時間波形 ---------- */
/** 表示窓の縦の div の数（0 を中央に置き、上下 3 div ずつ。components/Scope.astro と同じ） */
export const ROWS = 6;
export const WH = ROWS * DV;

/**
 * 縦軸の 1 div あたり。絶対値の最大が上下 3 div に収まる 1-2-5 の値で、lo より小さくしない。
 * 今の値 cur より小さくするのは、最大が新しい値の 3 div の 8 割を下回るときだけ（ちらつきを抑える）
 */
export function vdiv(maxAbs: number, lo: number, cur?: number): number {
  const half = ROWS / 2,
    want = nice(Math.max(maxAbs / (half - 0.1), lo));
  if (cur === undefined || want >= cur) return want;
  return maxAbs < want * half * 0.8 ? want : cur;
}

/** リングバッファの値の絶対値の最大。k は表示の単位への倍率 */
export function maxAbs(buf: ArrayLike<number>, start: number, len: number, k = 1): number {
  const n = buf.length;
  let m = 0;
  for (let j = 0; j < len; j++) {
    const v = Math.abs(buf[(start + j) % n] * k);
    if (v > m) m = v;
  }
  return m;
}

/**
 * リングバッファの折れ線（古い方から。最新を右端に置き、n 個で横幅いっぱい）。
 * wrap なら ±wrap を越えて飛ぶところで線を切る（角度の ±180°）
 */
export function rollPath(buf: ArrayLike<number>, start: number, len: number, k: number, vd: number, wrap = 0): string {
  const n = buf.length,
    dx = SW / n,
    y0 = WH / 2,
    lim = (ROWS / 2 + 0.3) * DV;
  let d = '',
    prev = Number.NaN;
  for (let j = 0; j < len; j++) {
    const v = buf[(start + j) % n] * k,
      x = SW - (len - 1 - j) * dx,
      y = y0 - Math.max(-lim, Math.min(lim, (v / vd) * DV));
    const cut = j === 0 || (wrap > 0 && Math.abs(v - prev) > wrap);
    d += `${cut ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    prev = v;
  }
  return d;
}

/* ---------- s 平面 ---------- */
/** 極の配置図: 縦 6 div、横 10 div。虚軸の位置は、右半面の極が収まる範囲で最も細かく描ける所にする */
export const PH = 6 * DV;

export interface SPlane {
  /** 1 div あたり [rad/s] */
  d: number;
  /** 虚軸の x 座標 */
  x0: number;
  /** 開ループ（×）と閉ループ（○）の印、軸の数値 */
  ol: string;
  cl: string;
  axes: string;
  /** 枠の外へはみ出した極の数 */
  out: number;
}

export function splane(ol: readonly C[], cl: readonly C[], fmtN: (v: number) => string): SPlane {
  let neg = 0,
    pos = 0,
    im = 0;
  for (const p of [...ol, ...cl]) {
    if (!Number.isFinite(p.re) || !Number.isFinite(p.im)) continue;
    if (p.re < 0) neg = Math.max(neg, -p.re);
    else pos = Math.max(pos, p.re);
    im = Math.max(im, Math.abs(p.im));
  }
  let d = Infinity,
    left = 8;
  for (let right = 1; right <= 5; right++) {
    const v = nice(Math.max(neg / (10 - right - 0.4), pos / (right - 0.4), im / 2.9, 1e-3));
    if (v < d * (1 - 1e-9)) {
      d = v;
      left = 10 - right;
    }
  }
  const x0 = left * DV,
    y0 = PH / 2,
    X = (re: number) => x0 + (re / d) * DV,
    Y = (v: number) => y0 - (v / d) * DV;
  let out = 0;
  const inside = (p: C) => {
    const ok = X(p.re) >= -2 && X(p.re) <= SW + 2 && Math.abs(Y(p.im) - y0) <= y0 + 2;
    if (!ok) out++;
    return ok;
  };
  const r = 5;
  let o = '';
  for (const p of ol)
    if (inside(p)) {
      const x = X(p.re),
        y = Y(p.im);
      o += `M${(x - r).toFixed(1)} ${(y - r).toFixed(1)}L${(x + r).toFixed(1)} ${(y + r).toFixed(1)}M${(x - r).toFixed(1)} ${(y + r).toFixed(1)}L${(x + r).toFixed(1)} ${(y - r).toFixed(1)}`;
    }
  let c = '';
  for (const p of cl)
    if (inside(p))
      c += `M${(X(p.re) - r).toFixed(1)} ${Y(p.im).toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  /* 軸: 実軸は 2 div ごと、虚軸は上下 2 div */
  let a = `<path class="sp-ax" d="M0 ${y0}H${SW}M${x0} 0V${PH}"/>`;
  for (let i = -left; i <= 10 - left; i++)
    if (i % 2 === 0)
      a += `<text x="${x0 + i * DV}" y="${PH + 17}" text-anchor="middle">${i ? fmtN(i * d) : '0'}</text>`;
  for (const j of [-2, 2]) a += `<text x="-8" y="${y0 - j * DV + 4}" text-anchor="end">${fmtN(j * d)}j</text>`;
  a += `<text x="-8" y="${y0 + 4}" text-anchor="end">0</text>`;
  return { d, x0, ol: o, cl: c, axes: a, out };
}

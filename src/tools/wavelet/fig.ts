/** 図の共通の部品: SVG の要素と折れ線、黒い地の表示窓の色、数の表記 */
import { $ } from '../../lib/dom';
import { minus } from '../../lib/format';

const NS = 'http://www.w3.org/2000/svg';
/** SVG の要素を作る */
export function el(tag: string, at: Record<string, string | number> = {}, txt?: string): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in at) e.setAttribute(k, String(at[k]));
  if (txt != null) e.textContent = txt;
  return e;
}

/** 幅 w に n 点を並べた折れ線（y は中心 yc から上へ k 倍）。step なら階段 */
export function trace(y: ArrayLike<number>, x0: number, w: number, yc: number, k: number, step = false): string {
  const n = y.length;
  let s = '';
  for (let i = 0; i < n; i++) {
    const yy = (yc - k * y[i]).toFixed(1);
    if (step)
      s += `${i ? 'L' : 'M'}${(x0 + (w * i) / n).toFixed(1)} ${yy}L${(x0 + (w * (i + 1)) / n).toFixed(1)} ${yy}`;
    else s += `${i ? 'L' : 'M'}${(x0 + (w * (i + 0.5)) / n).toFixed(1)} ${yy}`;
  }
  return s;
}

export function maxAbs(a: ArrayLike<number>): number {
  let m = 1e-12;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > m) m = Math.abs(a[i]);
  return m;
}

/** 有効 d 桁ではなく小数 d 桁で、負の符号は − */
export const fx = (v: number, d = 1): string => minus(v.toFixed(d));

/** 色: 強度の弱い順に並べた 6 色（CSS の --sg0〜--sg5）をつないだ 256 段 */
export function lutOf(sel: string): Uint8Array {
  const cs = getComputedStyle($(sel)),
    st = [0, 1, 2, 3, 4, 5].map((i) => {
      const h = cs.getPropertyValue(`--sg${i}`).trim().replace('#', '');
      return [0, 2, 4].map((o) => Number.parseInt(h.slice(o, o + 2), 16));
    }),
    L = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * 5,
      j = Math.min(4, Math.floor(t)),
      u = t - j;
    for (let c = 0; c < 3; c++) L[i * 3 + c] = Math.round(st[j][c] + (st[j + 1][c] - st[j][c]) * u);
  }
  return L;
}
/** 0〜1 の t の色を d[o..o+3] に書く（dim で暗くする） */
export function paint(L: Uint8Array, t: number, d: Uint8ClampedArray, o: number, dim = 1): void {
  const q = Math.round((t > 1 ? 1 : t > 0 ? t : 0) * 255) * 3;
  d[o] = L[q] * dim;
  d[o + 1] = L[q + 1] * dim;
  d[o + 2] = L[q + 2] * dim;
  d[o + 3] = 255;
}
export const rgb = (L: Uint8Array, t: number): string => {
  const q = Math.round((t > 1 ? 1 : t > 0 ? t : 0) * 255) * 3;
  return `rgb(${L[q]},${L[q + 1]},${L[q + 2]})`;
};

/** 画面の点を SVG の座標へ */
export function svgPt(svg: SVGSVGElement, e: PointerEvent): [number, number] | null {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [p.x, p.y];
}

export const txt = (id: string, s: string): void => {
  const e = $(id);
  if (e.textContent !== s) e.textContent = s;
};
export const html = (id: string, s: string): void => {
  const e = $(id);
  if (e.innerHTML !== s) e.innerHTML = s;
};

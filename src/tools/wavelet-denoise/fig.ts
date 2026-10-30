/** 図の共通の部品: SVG の要素、黒い地の表示窓の色、波形、数の表記（ウェーブレット変換のページの fig.ts から写した） */
import { $ } from '../../lib/dom';
import { minus } from '../../lib/format';

const NS = 'http://www.w3.org/2000/svg';
export function el(tag: string, at: Record<string, string | number> = {}, txt?: string): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in at) e.setAttribute(k, String(at[k]));
  if (txt != null) e.textContent = txt;
  return e;
}

/** 小数 d 桁で、負の符号は −。数でなければ — */
export const fx = (v: number, d = 1): string => (Number.isFinite(v) ? minus(v.toFixed(d)) : '—');

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

/** dBFS の [行 × 列] を canvas に塗る（行 0 が最も低い周波数で、下に置く） */
export function paintGrid(
  cv: HTMLCanvasElement,
  L: Uint8Array,
  d: Float32Array,
  rows: number,
  cols: number,
  lo: number,
): void {
  if (cv.width !== cols || cv.height !== rows) {
    cv.width = Math.max(1, cols);
    cv.height = rows;
  }
  const ctx = cv.getContext('2d');
  if (!ctx || !cols) return;
  const img = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const t = (d[r * cols + q] - lo) / -lo,
        k = Math.round((t > 1 ? 1 : t > 0 ? t : 0) * 255) * 3,
        o = ((rows - 1 - r) * cols + q) * 4;
      img.data[o] = L[k];
      img.data[o + 1] = L[k + 1];
      img.data[o + 2] = L[k + 2];
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

/** 波形: 画素の列ごとに最小と最大を縦の線で描く。xs は奥から順に重ねる */
export function wave(cv: HTMLCanvasElement, xs: { x: Float32Array; color: string }[]): void {
  const W = cv.clientWidth,
    H = cv.clientHeight,
    dpr = Math.min(2, devicePixelRatio || 1);
  if (!W || !H) return;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  /* 最も大きい振幅を高さの 9 割に */
  let m = 1e-6;
  for (const { x } of xs) for (let i = 0; i < x.length; i += 7) m = Math.max(m, Math.abs(x[i]));
  const k = (0.45 * H) / m;
  for (const { x, color } of xs) {
    ctx.fillStyle = color;
    const n = x.length;
    for (let p = 0; p < W; p++) {
      const a = Math.floor((p * n) / W),
        b = Math.max(a + 1, Math.floor(((p + 1) * n) / W));
      let lo = 0,
        hi = 0;
      for (let i = a; i < b; i++) {
        const v = x[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const y0 = H / 2 - hi * k,
        y1 = H / 2 - lo * k;
      ctx.fillRect(p, y0, 1, Math.max(1, y1 - y0));
    }
  }
}

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

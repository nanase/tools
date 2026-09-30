/**
 * 時刻の横で秒を刻む扇形（Fan.astro）。偶数の秒で 12 時の位置から時計回りに開き、
 * 奇数の秒で同じ向きに閉じる。JJY シミュレータと JJY デコーダで共有する
 */

/** 表示時刻 t（ms）の扇形の SVG パス（半径 9、中心 0,0） */
export function fanPath(t: number): string {
  const p = (((t % 2000) + 2000) % 2000) / 1000,
    a0 = p < 1 ? 0 : p - 1,
    a1 = p < 1 ? p : 1;
  if (a1 - a0 > 0.999) return 'M0 -9A9 9 0 1 1 0 9A9 9 0 1 1 0 -9Z';
  if (a1 - a0 < 0.001) return '';
  const pt = (a: number) =>
    `${(9 * Math.sin(2 * Math.PI * a)).toFixed(2)} ${(-9 * Math.cos(2 * Math.PI * a)).toFixed(2)}`;
  return `M0 0L${pt(a0)}A9 9 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${pt(a1)}Z`;
}

/** 扇形を表示時刻 t に合わせる。t が null なら隠す */
export function drawFan(el: SVGElement, t: number | null): void {
  el.toggleAttribute('hidden', t == null);
  const d = t == null ? '' : fanPath(t),
    path = el.querySelector('path');
  if (path && path.getAttribute('d') !== d) path.setAttribute('d', d);
}

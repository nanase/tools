/** 機器の図柄（24 × 24 の線画）。画面の選択肢（SVG）と配線図（canvas の Path2D）で同じ形を使う */
export const ICON = {
  /** マイコン（マスタ） */
  m: 'M7 7h10v10H7zM9.5 4v3M12 4v3M14.5 4v3M9.5 17v3M12 17v3M14.5 17v3M4 9.5h3M4 12h3M4 14.5h3M17 9.5h3M17 12h3M17 14.5h3',
  mem: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  acc: 'M6 18V4.5M6 18h13.5M6 18l8.5-8.5M3.8 6.8L6 4.5l2.2 2.3M17.2 15.8l2.3 2.2-2.3 2.2M10.8 9.5h3.7v3.7',
  adc: 'M3 12c1.4-5 3.2-5 4.6 0s3.2 5 4.6 0M13.5 19h2.3v-3.5h2.3V12h2.3V8.5h2',
  led: 'M5 7.5l8 4.5-8 4.5zM13 7.5v9M2.5 12H5M13 12h4.5M14.5 5l2.5-2.5M17.5 7.5L20 5',
} as const;
export type IconId = keyof typeof ICON;

/** 選択肢に入れる SVG */
export const iconSvg = (k: IconId, cls = 'sp-ic'): string =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;

const cache = new Map<IconId, Path2D>();
/** canvas に描く（x, y は左上、s は一辺） */
export function drawIcon(
  g: CanvasRenderingContext2D,
  k: IconId,
  x: number,
  y: number,
  s: number,
  col: string,
  lw = 1.8,
): void {
  let p = cache.get(k);
  if (!p) {
    p = new Path2D(ICON[k]);
    cache.set(k, p);
  }
  g.save();
  g.translate(x, y);
  g.scale(s / 24, s / 24);
  g.strokeStyle = col;
  g.lineWidth = (lw * 24) / s;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke(p);
  g.restore();
}

/** 機器と状態の図柄（24 × 24 の線画）。画面の選択肢（SVG）と配線図（canvas の Path2D）で同じ形を使う */
export const ICON = {
  /** マイコン（マスタ） */
  m: 'M7 7h10v10H7zM9.5 4v3M12 4v3M14.5 4v3M9.5 17v3M12 17v3M14.5 17v3M4 9.5h3M4 12h3M4 14.5h3M17 9.5h3M17 12h3M17 14.5h3',
  tmp: 'M10 4.5a2 2 0 0 1 4 0V14a4 4 0 1 1-4 0zM12 9v8',
  mem: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  rtc: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7v5l3.5 2',
  /** 持ち主のいないアドレス */
  unk: 'M8.5 8.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v1M12 19v.01',
  /** 宛先（照合が一致） */
  ok: 'M5 12.5l4.5 4.5L19 7.5',
  /** SCL を保持中（クロックストレッチ） */
  hold: 'M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9',
  /** 調停に負け */
  lost: 'M6 6l12 12M18 6L6 18',
} as const;
export type IconId = keyof typeof ICON;

/** 選択肢に入れる SVG */
export const iconSvg = (k: IconId, cls = 'i2-ic'): string =>
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

/**
 * コード進行のページのアイコン（16 × 16 の線画。色は currentColor、.cp-ic で大きさと線の太さを決める）。
 * 音色・伴奏・表示の切り替え・ブロックの操作・曲の保存に使い、文字を減らす
 */
const svg = (d: string, cls = ''): string =>
  `<svg class="cp-ic${cls ? ` ${cls}` : ''}" viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;

export const ICON = {
  /* 音色 */
  gtr: svg(
    '<path d="M9.6 6.4L14 2"/><path d="M12.6 1.6l1.8 1.8"/><path d="M8.2 5.2c-1-.7-2.4-.5-3 .4-.4.6-.4 1.2-.9 1.5-.8.4-2.1.2-2.8 1.2-1 1.5-.2 3.6 1.3 4.6s3.4 1.3 4.6.2c.9-.8.7-2 1.1-2.8.3-.5.9-.6 1.4-1 .9-.8.9-2.1.2-3"/><circle class="f" cx="6.3" cy="9.7" r="1"/>',
  ),
  ep: svg(
    '<rect x="1" y="4" width="14" height="9" rx="1"/><path d="M4.5 13V8.5M8 13V8.5M11.5 13V8.5"/><path class="f" d="M3.5 4h2v4.5h-2zM7 4h2v4.5H7zM10.5 4h2v4.5h-2z"/>',
  ),
  org: svg(
    '<path d="M2 14h12"/><path d="M3.5 14V9M6 14V5M8.5 14V2.5M11 14V5M13.5 14V8"/><path d="M2.6 9.5h1.8M5.1 5.5h1.8M7.6 3h1.8M10.1 5.5h1.8M12.6 8.5h1.8"/>',
  ),
  str: svg(
    '<path d="M7 2.5c-1.6 0-2.4 1-2.2 2.2.2 1-.8 1.4-.8 2.8 0 1.2 1 1.7.8 2.9-.2 1.4.8 2.6 2.2 2.6s2.4-1.2 2.2-2.6c-.2-1.2.8-1.7.8-2.9 0-1.4-1-1.8-.8-2.8C9.4 3.5 8.6 2.5 7 2.5z"/><path d="M7 1v12"/><path d="M1.5 12.5L14.5 8"/>',
  ),
  /* 伴奏 */
  bass: svg(
    '<path d="M3 6.2c0-2 1.6-3.4 3.6-3.4 2.4 0 3.8 1.6 3.8 3.8 0 3.6-3.2 6-7 7.2"/><circle class="f" cx="4.2" cy="6.4" r="1.4"/><circle class="f" cx="13" cy="4.6" r=".9"/><circle class="f" cx="13" cy="8" r=".9"/>',
  ),
  click: svg('<path d="M5.6 2h4.8L13 14H3z"/><path d="M8 11.5L11.8 3.8"/><path d="M4.5 10.5h7"/>'),
  /* 表示 */
  score: svg(
    '<rect x="1.5" y="2.5" width="5" height="4" rx=".6"/><rect x="9.5" y="2.5" width="5" height="4" rx=".6"/><rect x="1.5" y="9.5" width="5" height="4" rx=".6"/><path d="M6.8 4.5h2.2"/>',
  ),
  lanes: svg('<path d="M1 3.5h14M1 8h14M1 12.5h14"/><path class="w" d="M3 3.5h5M9 8h5M4 12.5h3M10 12.5h3"/>'),
  wheel: svg(
    '<circle cx="8" cy="8" r="6.3"/><circle cx="8" cy="8" r="3"/><path d="M8 1.7v3.3M14.3 8H11M8 14.3V11M1.7 8H5"/>',
  ),
  /* ブロックの操作 */
  aud: svg('<path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 5.5c1 .7 1 4.3 0 5M12.5 3.5c2 1.6 2 7.4 0 9"/>'),
  dup: svg(
    '<rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/>',
  ),
  del: svg('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4"/><path d="M6.8 6.5v5M9.2 6.5v5"/>'),
  /* 曲 */
  save: svg('<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5.5V2.5M5 13.5V9.5h6v4"/>'),
  new: svg('<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M8 7.5v5M5.5 10h5"/>'),
  export: svg('<path d="M8 10V1.5M5 4.5l3-3 3 3"/><path d="M2.5 9v4.5h11V9"/>'),
  import: svg('<path d="M8 1.5V10M5 7l3 3 3-3"/><path d="M2.5 9v4.5h11V9"/>'),
} as const;

/** 調号（長調は主音から、短調は平行長調から）の ♯・♭ の数と向き */
const SHARPS: Record<number, number> = {
  0: 0,
  7: 1,
  2: 2,
  9: 3,
  4: 4,
  11: 5,
  6: 6,
  5: -1,
  10: -2,
  3: -3,
  8: -4,
  1: -5,
};
export function keySig(t: number, m: 'maj' | 'min'): string {
  const n = SHARPS[m === 'min' ? (t + 3) % 12 : t] ?? 0;
  return n === 0 ? '' : (n > 0 ? '♯' : '♭').repeat(Math.abs(n));
}

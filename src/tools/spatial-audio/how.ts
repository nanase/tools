/** 「しくみ」の小さな図（ビルド時に SVG にする）。上から見た頭は左耳を青、右耳を黄で描く */
import type { HowStep } from '../../lib/how';

const svg = (body: string) => `<svg class="sa-mini" viewBox="0 0 200 110" aria-hidden="true">${body}</svg>`;
const r1 = (v: number) => Math.round(v * 10) / 10;
/** 上から見た頭（中心・半径） */
const head = (x: number, y: number, r: number) =>
  `<path class="hd" d="M${x - r * 0.3} ${y - r * 0.93}L${x} ${y - r * 1.35}L${x + r * 0.3} ${y - r * 0.93}Z"/>` +
  `<circle class="hd" cx="${x}" cy="${y}" r="${r}"/>` +
  `<ellipse class="le" cx="${x - r - 2}" cy="${y}" rx="3" ry="6"/><ellipse class="ri" cx="${x + r + 2}" cy="${y}" rx="3" ry="6"/>`;
const src = (x: number, y: number) =>
  `<circle class="src" cx="${x}" cy="${y}" r="7"/><path d="M${x - 3.5} ${y - 1.8}h2.3l2.8-2.4v8.4l-2.8-2.4h-2.3z" fill="var(--surface)"/>`;
const arrow = (x1: number, y1: number, x2: number, y2: number, cls: string) => {
  const a = Math.atan2(y2 - y1, x2 - x1),
    s = 6;
  return `<path class="${cls}" d="M${r1(x2)} ${r1(y2)}L${r1(x2 - s * Math.cos(a - 0.45))} ${r1(y2 - s * Math.sin(a - 0.45))}L${r1(x2 - s * Math.cos(a + 0.45))} ${r1(y2 - s * Math.sin(a + 0.45))}Z"/>`;
};

/* 1 両耳間時間差: 近い耳へはまっすぐ、遠い耳へは頭を回り込む */
const ITD = (() => {
  const cx = 130,
    cy = 62,
    r = 20,
    sx = 28,
    sy = 34,
    ar = r + 4,
    /* 音源から頭への接点（下側）から右耳まで弧をたどる */
    L = Math.hypot(sx - cx, sy - cy),
    ph = Math.atan2(sy - cy, sx - cx),
    tp = ph - Math.acos(ar / L);
  let d = `M${sx} ${sy}`;
  const end = Math.PI * 2;
  for (let i = 0; i <= 20; i++) {
    const a = tp + ((end - (tp + Math.PI * 2)) * i) / 20 + Math.PI * 2;
    d += `L${r1(cx + ar * Math.cos(a))} ${r1(cy + ar * Math.sin(a))}`;
  }
  return svg(
    `<path class="pl" d="M${sx} ${sy}L${cx - r - 6} ${cy}"/>${arrow(sx, sy, cx - r - 5, cy, 'ah-l')}` +
      `<path class="pr" d="${d}"/>${arrow(cx + ar * Math.cos(end - 0.3), cy + ar * Math.sin(end - 0.3), cx + ar, cy, 'ah-r')}` +
      head(cx, cy, r) +
      src(sx, sy),
  );
})();

/* 2 頭の陰: 音源と反対の側にできる陰 */
const ILD = svg(
  `<path class="sh" d="M130 40L200 30V94L130 84Z"/>` +
    [0, 1, 2].map((k) => `<path class="ln" d="M${44 + k * 18} 20Q${56 + k * 18} 62 ${44 + k * 18} 104"/>`).join('') +
    head(130, 62, 20) +
    src(22, 62) +
    '<text x="196" y="106" text-anchor="end">陰</text>',
);

/* 3 耳介: 横から見た頭と、耳介で跳ね返る道すじ */
const PINNA = svg(
  '<path class="hd" d="M86 104C60 90 58 40 92 26C120 16 150 24 156 50L164 62L156 66C156 82 148 90 132 92L130 104Z"/>' +
    '<path class="ln" d="M112 48C102 48 100 72 112 74" stroke-width="2"/><circle class="src" cx="116" cy="62" r="2.5"/>' +
    `<path class="pl" d="M182 14L120 58"/>${arrow(182, 14, 119, 59, 'ah-l')}` +
    `<path class="pr" d="M180 18L103 54L114 62" stroke-dasharray="5 3"/>${arrow(103, 54, 114, 62, 'ah-r')}` +
    src(184, 12) +
    '<text x="4" y="12">横から見た頭</text>',
);

/* 4 反射と残響: 部屋の壁で跳ね返る道すじ */
const ROOM = svg(
  '<rect class="wl" x="10" y="8" width="180" height="94"/>' +
    `<path class="pl" d="M50 40L128 66"/>${arrow(50, 40, 125, 65, 'ah-l')}` +
    '<path class="dl" d="M50 40L82 8L128 66M50 40L10 54L128 66M50 40L95 102L128 66M50 40L190 56L128 66"/>' +
    head(140, 70, 11) +
    src(50, 40),
);

export const HOW: readonly HowStep[] = [
  {
    h: '両耳間時間差',
    fig: ITD,
    p: '頭を回り込む分だけ遅れる、遠い側の耳の音（真横からの音で最大の約 0.66 ms）',
  },
  {
    h: '頭の陰',
    fig: ILD,
    p: '頭に遮られて弱まる、遠い側の耳の高い音（低い音は回り込むので小さな差）',
  },
  {
    h: '耳介',
    fig: PINNA,
    p: '耳介で跳ね返った音が重なってできる、高さで動く谷（ノッチ）による上下と前後の手がかり',
  },
  {
    h: '反射と残響',
    fig: ROOM,
    p: '壁・床・天井で跳ね返り、少し遅れて別の向きから届く音と、その後に続く残響による場所の広さと距離の手がかり',
  },
];

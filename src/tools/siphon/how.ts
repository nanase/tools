/** 「しくみ」の小さな図（ビルド時に SVG にする）。左に水槽、右へ管を渡す同じ形で、状態だけを変える */
const TANK = 'M8 34V82H62V34';
const TUBE = 'M44 78V14Q44 8 50 8H96Q102 8 103 14L112 88';
const svg = (body: string, vb = '0 0 150 96') =>
  `<svg class="sf-mini" viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const water = (y: number) =>
  `<path class="sf-hw-f" d="M9.5 ${y}H60.5V80.5H9.5Z"/><path class="sf-hw-s" d="M9.5 ${y}H60.5"/>`;
const tube = (fill: string) =>
  `<path class="sf-hw-t" d="${TUBE}"/><path class="sf-hw-i" d="${TUBE}"/>${fill}<path class="sf-hw-w" d="${TANK}"/>`;
const txt = (x: number, y: number, s: string, c = 'sf-hw-x', a = 'middle') =>
  `<text x="${x}" y="${y}" class="${c}" text-anchor="${a}">${s}</text>`;

const PRIME = svg(
  water(48) +
    tube(`<path class="sf-hw-a" d="M44 78V48"/><path class="sf-hw-a sf-hw-d" d="${TUBE}"/>`) +
    txt(118, 30, '空気', 'sf-hw-x', 'start'),
);
const HEAD = svg(
  water(48) +
    tube(`<path class="sf-hw-a" d="${TUBE}"/>`) +
    '<path class="sf-hw-l sf-hw-dl" d="M62 48H136M112 88H136"/><path class="sf-hw-l" d="M134 48V88"/>' +
    txt(130, 72, '落差', 'sf-hw-x sf-hw-c1', 'end'),
);
const NEG = svg(
  water(48) +
    tube(
      '<path class="sf-hw-a sf-hw-lo" d="M44 60V14Q44 8 50 8H96Q102 8 103 14L106 36"/><path class="sf-hw-a" d="M44 78V60M106 36L112 88"/>',
    ) +
    '<path class="sf-hw-l" d="M18 22V44M14 38L18 44L22 38M34 22V44M30 38L34 44L38 38"/>' +
    txt(26, 18, '大気圧') +
    txt(74, 24, '負圧', 'sf-hw-x sf-hw-lc'),
);
const LIMIT = svg(
  '<path class="sf-hw-f" d="M9.5 76H40.5V88.5H9.5Z"/><path class="sf-hw-w" d="M8 70V90H42V70M98 70V90H132V70"/><path class="sf-hw-f" d="M99.5 82H130.5V88.5H99.5Z"/>' +
    '<path class="sf-hw-t" d="M30 86V8H112V86"/><path class="sf-hw-i" d="M30 86V8H112V86"/><path class="sf-hw-a" d="M30 86V24M112 86V30"/>' +
    '<path class="sf-hw-l sf-hw-wn sf-hw-dl" d="M4 24H146"/>' +
    txt(71, 20, '水が沸騰', 'sf-hw-x sf-hw-wt') +
    txt(76, 40, '約 10 m', 'sf-hw-x sf-hw-wt'),
);
const AIR = svg(
  water(80) +
    tube('<path class="sf-hw-a sf-hw-d" d="M103 14L112 88"/>') +
    '<circle class="sf-hw-b" cx="44" cy="70" r="2.4"/><circle class="sf-hw-b" cx="44" cy="58" r="2"/><circle class="sf-hw-b" cx="44" cy="46" r="1.6"/>' +
    txt(70, 70, '空気', 'sf-hw-x', 'start'),
);
const AUTO = svg(
  '<path class="sf-hw-f" d="M9.5 6H60.5V80.5H9.5Z"/><path class="sf-hw-w" d="M8 4V82H62V4"/>' +
    '<path class="sf-hw-t" d="M30 80V30Q30 24 35 24Q40 24 40 30V92"/><path class="sf-hw-i" d="M30 80V30Q30 24 35 24Q40 24 40 30V92"/><path class="sf-hw-a" d="M30 80V30Q30 24 35 24Q40 24 40 30V92"/>' +
    '<path class="sf-hw-l sf-hw-dl" d="M62 24H96"/>' +
    txt(98, 28, '頂上', 'sf-hw-x', 'start') +
    '<path class="sf-hw-f" d="M37 94H43V96H37Z"/>',
);
const CYCLE = svg(
  '<path class="sf-hw-l sf-hw-dl" d="M6 16H146"/>' +
    '<path class="sf-hw-lv" d="M6 70L44 18L54 76L92 18L102 76L140 18"/>' +
    '<path class="sf-hw-q" d="M6 90H44L46 70L52 86L54 90H92L94 70L100 86L102 90H140L142 70"/>' +
    txt(148, 12, '頂上', 'sf-hw-x', 'end') +
    txt(20, 56, '水位', 'sf-hw-x sf-hw-c2', 'start') +
    txt(58, 84, '流量', 'sf-hw-x sf-hw-c1', 'start'),
);

/** [見出し, 図, 一言] */
export const HOW: readonly (readonly [string, string, string])[] = [
  ['呼び水', PRIME, '吸う・押す・沈めるで管を満たす最初の水'],
  ['落差', HEAD, '上の水面と出口の高さの差で決まる流れの速さ'],
  ['頂上の負圧', NEG, '大気圧が水面を押して支える、大気圧より低い頂上の圧力'],
  ['限界の高さ', LIMIT, '水面から約 10 m で頂上の水が沸騰し、水柱が 2 本に分かれる高さ'],
  ['入口からの空気', AIR, '水面が入口より下がったときに入り、流れを止める空気'],
  ['自然に始まる流れ', AUTO, '水面が頂上を越えると管が満ち、入口まで一気に抜ける流れ'],
  ['くり返す湧き出し', CYCLE, '流入が排水より少ないときに起こる、溜まっては抜ける水位の上下'],
];

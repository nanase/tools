/** 論理ゲートのしくみの札: [見出し, 小さな図（SVG）, 一言] */
import { miniGate } from './svg';

/** 小さな NOR（左端 40、高さ 16） */
const nor = (y: number): string =>
  `<path class="gb" d="M40 ${y - 8}Q52 ${y - 8} 60 ${y}Q52 ${y + 8} 40 ${y + 8}Q44 ${y} 40 ${y - 8}Z"/><circle class="gb" cx="62.5" cy="${y}" r="2.5"/>`;
const fig = (s: string): string => `<svg class="lg-mini" viewBox="0 0 120 64" aria-hidden="true">${s}</svg>`;

const RAW: readonly (readonly [string, string, string])[] = [
  [
    '0 と 1',
    fig(
      '<path class="hg" d="M18 14H112M18 50H112"/><path class="lg-hw on" d="M18 14H46V50H76V14H112"/><text class="ht" x="13" y="18" text-anchor="end">1</text><text class="ht" x="13" y="54" text-anchor="end">0</text>',
    ),
    '電圧の高い状態を 1（H）、低い状態を 0（L）として扱う',
  ],
  [
    '真理値表',
    fig(
      '<path class="hg" d="M14 8H106M14 22H106M14 36H106M14 50H106M70 8V58"/><text class="ht" x="30" y="19">0 0</text><text class="ht" x="30" y="33">0 1</text><text class="ht" x="30" y="47">1 0</text><text class="ht" x="84" y="19">0</text><text class="ht on" x="84" y="33">1</text><text class="ht on" x="84" y="47">1</text>',
    ),
    '入力のすべての組み合わせと、そのときの出力の表',
  ],
  [
    '2 種類の記号',
    fig(`${miniGate('or', 10, 32)}${miniGate('or', 70, 32, 'jis')}`),
    '形で表す MIL 記号と、四角に記号を書く JIS 記号',
  ],
  [
    '論理式',
    fig(
      '<text class="hb" x="60" y="40" text-anchor="middle">Y = A · <tspan text-decoration="overline">B</tspan></text>',
    ),
    '「·」は AND、「+」は OR、上の線は NOT、「⊕」は XOR',
  ],
  [
    '万能ゲート',
    fig(`${miniGate('nand', 8, 20)}${miniGate('nand', 8, 46)}${miniGate('nand', 66, 33)}`),
    'NAND だけ、または NOR だけで、どのゲートも作れる',
  ],
  [
    '組み合わせ回路と順序回路',
    fig(
      `<path class="lg-hw" d="M14 12H41M14 52H41M65 16H112M65 48H112M84 16V30H34V44H41M90 48V34H28V20H41"/>${nor(16)}${nor(48)}`,
    ),
    '今の入力だけで決まる回路と、前の状態も使う回路',
  ],
  [
    '伝搬遅延',
    fig(
      '<path class="hg" d="M34 8V58M58 8V58"/><path class="lg-hw" d="M8 44H34V16H112"/><path class="lg-hw on" d="M8 50H58V22H112"/>',
    ),
    '入力が変わってから出力が変わるまでのわずかな遅れ',
  ],
  [
    'ハザード',
    fig(
      '<path class="hg" d="M50 2V62M62 2V62"/><path class="lg-hw" d="M8 6H50V18H112M8 38H62V26H112"/><path class="lg-hw on" d="M8 46H50V58H62V46H112"/><rect class="hz" x="46" y="42" width="20" height="20" rx="3"/>',
    ),
    '遅れの差で、出力が一瞬だけ誤った値になる',
  ],
];

/** 図の地: paper は波形や表の白い紙、bench は回路の作業台（ライトテーマで白） */
const KIND: Record<string, 'paper' | 'bench'> = {
  '0 と 1': 'paper',
  真理値表: 'paper',
  '2 種類の記号': 'bench',
  万能ゲート: 'bench',
  組み合わせ回路と順序回路: 'bench',
  伝搬遅延: 'paper',
  ハザード: 'paper',
};
export const HOW: readonly (readonly [string, string, string])[] = RAW.map(([h, f, d]) => [
  h,
  KIND[h] ? f.replace('class="lg-mini"', `class="lg-mini lg-mini-${KIND[h]}"`) : f,
  d,
]);

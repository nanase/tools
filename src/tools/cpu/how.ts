/** 4 ビット CPU のしくみ: 1 命令の工程の小さな図と 1 句、命令 8 種の早見 */
import type { HowStep } from '../../lib/how';
import { OPS, USES_N, USES_R } from './model';

/** 矢じり付きの線（on は値の流れの色） */
function arrow(x1: number, y1: number, x2: number, y2: number, on = false): string {
  const a = Math.atan2(y2 - y1, x2 - x1),
    c = Math.cos(a),
    s = Math.sin(a);
  const q = (u: number, v: number) => `${(x2 + u * c - v * s).toFixed(1)} ${(y2 + u * s + v * c).toFixed(1)}`;
  const k = on ? ' on' : '';
  return `<path class="cp-hw${k}" d="M${x1} ${y1}L${(x2 - 6 * c).toFixed(1)} ${(y2 - 6 * s).toFixed(1)}"/><path class="cp-hah${k}" d="M${q(0, 0)}L${q(-8, -4.5)}L${q(-8, 4.5)}Z"/>`;
}
const fig = (s: string): string => `<svg class="cp-mini" viewBox="0 0 160 70" aria-hidden="true">${s}</svg>`;
const box = (x: number, y: number, w: number, h: number, t = '', tx = x + w / 2, ty = y + h / 2 + 4) =>
  `<rect class="cp-hb" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>${t ? `<text class="cp-ht" x="${tx}" y="${ty}" text-anchor="middle">${t}</text>` : ''}`;

const rows = [0, 1, 2, 3, 4]
  .map((i) => `<rect class="cp-hrow${i === 2 ? ' on' : ''}" x="62" y="${6 + i * 12}" width="40" height="10" rx="1.5"/>`)
  .join('');

export const HOW: readonly HowStep[] = [
  {
    h: 'フェッチ',
    fig: fig(
      `${box(4, 22, 40, 26, 'PC 2')}${arrow(44, 35, 60, 35)}${rows}${arrow(102, 35, 118, 35)}${box(118, 22, 38, 26, '命令')}`,
    ),
    p: 'PC の指す ROM の行を命令へ',
  },
  {
    h: 'デコード',
    fig: fig(
      `${[0, 1, 2].map((i) => `<rect class="cp-hbit${i === 2 ? ' on' : ''}" x="${6 + i * 13}" y="4" width="11" height="11" rx="1.5"/>`).join('')}${box(4, 22, 40, 44)}${Array.from({ length: 8 }, (_, i) => `<path class="cp-hw${i === 1 ? ' on' : ''}" d="M44 ${26 + i * 5.2}H${i === 1 ? 100 : 84}"/>`).join('')}<text class="cp-ht" x="106" y="35">加算</text>`,
    ),
    p: '種類の 3 ビットで命令 8 種から 1 つを選ぶ',
  },
  {
    h: '実行',
    fig: fig(
      `${box(8, 4, 44, 22, 'A+B')}<path class="cp-hbus" d="M4 40H156"/><path class="cp-hbus on" d="M30 40H122"/>${arrow(30, 26, 30, 40, true)}${arrow(122, 40, 122, 50, true)}${box(100, 50, 44, 18, 'A')}<rect class="cp-htag" x="58" y="31" width="34" height="18" rx="9"/><text class="cp-htt" x="75" y="44" text-anchor="middle">7</text>`,
    ),
    p: 'バスで値を 1 つ運ぶ',
  },
  {
    h: 'PC を進める',
    fig: fig(
      `${box(4, 8, 40, 22, 'PC 2')}${arrow(44, 19, 104, 19)}<text class="cp-ht" x="74" y="13" text-anchor="middle">+1</text>${box(106, 8, 44, 22, 'PC 3')}<path class="cp-hw dash" d="M24 30V52H120V38"/><path class="cp-hah" d="M120 32L115.5 40L124.5 40Z"/><text class="cp-ht" x="72" y="64" text-anchor="middle">ジャンプ</text>`,
    ),
    p: ['ふだんは次の行', 'ジャンプは数の行'],
  },
  {
    h: '桁上げ',
    fig: fig(
      '<text class="cp-hn" x="150" y="20" text-anchor="end">1111</text><text class="cp-hn" x="150" y="40" text-anchor="end">+ 0001</text><path class="cp-hg" d="M60 46H152"/><text class="cp-hn" x="150" y="64" text-anchor="end">0000</text><circle class="cp-hled on" cx="30" cy="58" r="7"/><text class="cp-ht" x="42" y="62">C</text>',
    ),
    p: '15 を超えると C が 1',
  },
];

/** 命令 8 種の早見の 1 枚: 種類のビット・A・B と数を使うか・名前・働き */
export const OP_CARDS = OPS.map((o, i) => ({
  bits: [2, 1, 0].map((j) => (i >> j) & 1),
  r: USES_R.includes(o.k),
  n: USES_N.includes(o.k),
  nm: o.nm,
  g: o.g,
}));

/** カルノー図のしくみの札: [見出し, 小さな図（SVG）, 一言] */
import { kmapSvg } from './kmap';
import { DC, minimize, type Val } from './logic';

const mk = (n: number, on: readonly number[], dc: readonly number[] = []): Val[] =>
  Array.from({ length: 1 << n }, (_, k) => (dc.includes(k) ? DC : on.includes(k) ? 1 : 0));
let hn = 0;
/** 小さな図の設定（切り抜きの id は札ごと） */
const o = (): { S: number; idx: boolean; id: string } => ({ S: 24, idx: false, id: `km-h${++hn}` });
const two = mk(3, [0, 1, 2, 5, 6, 7]);
const ov = (s: string) => `<span class="ov">${s}</span>`;

export const HOW: readonly (readonly [string, string, string])[] = [
  [
    '1 の行が最小項',
    kmapSvg(3, mk(3, [6]), [{ t: { v: 6, m: 0 }, c: 0, inset: 2 }], o()),
    `1 の行 1 つが AND 1 個（A · B · ${ov('C')}）`,
  ],
  [
    'となりは 1 変数だけ違う',
    kmapSvg(3, mk(3, []), [], {
      ...o(),
      extra: (g) => `<path class="km-arr" d="M${g.ox + 12} ${g.oy - 22}h${3 * g.S}"/>`,
    }),
    '並びは 00・01・11・10（グレイコード）',
  ],
  [
    'まとめると変数が減る',
    kmapSvg(3, mk(3, [6, 7]), [{ t: { v: 6, m: 1 }, c: 1, inset: 2 }], o()),
    `A · B · ${ov('C')} + A · B · C = A · B`,
  ],
  [
    '大きさは 1・2・4・8',
    kmapSvg(4, mk(4, [5, 7, 13, 15]), [{ t: { v: 5, m: 10 }, c: 2, inset: 2 }], o()),
    '4 マスで 2 変数、8 マスで 3 変数が消える',
  ],
  [
    '端は反対の端のとなり',
    kmapSvg(4, mk(4, [0, 2, 8, 10]), [{ t: { v: 0, m: 10 }, c: 3, inset: 2 }], o()),
    '四隅の 4 マスも 1 つのまとまり',
  ],
  [
    'X はまとめやすい方へ',
    kmapSvg(3, mk(3, [4, 6], [5, 7]), [{ t: { v: 4, m: 3 }, c: 4, inset: 2 }], o()),
    'X を 1 とみなすと A だけ',
  ],
  [
    '0 をまとめると和積形',
    kmapSvg(3, mk(3, [1, 2, 3, 5, 6, 7]), [{ t: { v: 0, m: 4 }, c: 5, inset: 2 }], o()),
    '0 のまとまりが OR、全体を AND で',
  ],
  [
    '解が 2 通りのことも',
    kmapSvg(
      3,
      two,
      minimize(two, 3, 'sop').sols[0].map((t, j) => ({ t, c: j, inset: 2 })),
      o(),
    ),
    'どの 1 も 2 つの主項で覆える形',
  ],
];

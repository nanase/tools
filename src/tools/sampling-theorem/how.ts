/**
 * 「標本化定理のしくみ」の段: 小さな図（SVG の文字列。ビルド時に描く）と見出し・説明の文。
 * 文はマクスウェルの悪魔のページにならい、です・ます調で段から段へつなげる。
 * fs の半分の線は引かず、2 倍は f と複製 fs − f が重なる所として見せる
 */
export interface Step {
  t: string;
  p: string[];
  svg: string;
}

const W = 150,
  H = 66,
  Y0 = 33;
const sinc = (d: number): number => (d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d));
const path = (f: (x: number) => number, x0 = 6, x1 = 144): string => {
  let d = '';
  for (let x = x0; x <= x1 + 1e-9; x += 1.5) d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${(Y0 - f(x)).toFixed(1)}`;
  return d;
};
const dot = (x: number, y: number) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" class="smp-fd"/>`;
const stems = (f: (x: number) => number, xs: number[]): string =>
  xs
    .map((x) => `<path class="smp-l0" d="M${x.toFixed(1)} ${Y0}V${(Y0 - f(x)).toFixed(1)}"/>${dot(x, Y0 - f(x))}`)
    .join('');
const svg = (s: string): string =>
  `<svg class="smp-mini" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><marker id="smp-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" class="smp-ah"/></marker></defs>${s}</svg>`;
const t = (x: number, y: number, s: string) => `<text x="${x}" y="${y}" class="smp-mt">${s}</text>`;
const axis = '<path class="smp-l0" d="M6 58H144"/>';
/** 寸法線（両端に短い縦線）。向きのない長さなので矢じりは付けない */
const dim = (xa: number, xb: number, y: number, cls: string) =>
  `<path class="${cls} smp-thin" d="M${xa} ${y}H${xb}M${xa} ${y - 4}V${y + 4}M${xb} ${y - 4}V${y + 4}"/>`;

const slow = (x: number) => 20 * Math.sin((x - 6) / 14);
const fast = (x: number) => 20 * Math.sin(((x - 6) * 2 * Math.PI) / 13.7);
const alias = (x: number) => 20 * Math.sin(-((x - 6) * 2 * Math.PI) / 109.6);
const PULSES = [
  [35, 12],
  [55, 20],
  [75, 8],
  [95, -10],
  [115, -16],
] as const;
const sum = (x: number) => PULSES.reduce((v, [c, a]) => v + a * sinc((x - c) / 20), 0);

export const HOW: readonly Step[] = [
  {
    t: '標本化',
    p: ['音の波を決まった間隔で測り、数の列にします。', '1 秒に測る回数を標本化周波数 fs と呼びます。'],
    svg: svg(
      `<path class="smp-l2" d="${path(slow)}"/>${stems(
        slow,
        Array.from({ length: 12 }, (_, k) => 9 + k * 12),
      )}`,
    ),
  },
  {
    t: '復元',
    p: [
      '標本ごとに sinc という山を置いて足し合わせると、点と点の間がなめらかにつながった波になります。',
      'この山はほかの標本の位置でちょうど 0 になるので、標本の値は変わりません。',
    ],
    svg: svg(
      `${PULSES.map(([c, a]) => `<path class="smp-lt" d="${path((x) => a * sinc((x - c) / 20))}"/>`).join('')}<path class="smp-l1" d="${path(sum)}"/>${PULSES.map(([c, a]) => dot(c, Y0 - a)).join('')}`,
    ),
  },
  {
    t: '同じ点を通る別の波',
    p: [
      'ところが、標本の点を通る波は 1 つではありません。',
      '周波数 f の波と fs − f の波は、どの標本の位置でも同じ値になります。',
    ],
    svg: svg(
      `<path class="smp-l2 smp-thin" d="${path(fast)}"/><path class="smp-lw" d="${path(alias)}"/>${stems(
        alias,
        Array.from({ length: 12 }, (_, k) => 6 + k * 11.6),
      )}`,
    ),
  },
  {
    t: '複製が並ぶ',
    p: [
      'そのため、標本化した列のスペクトルには f のほかに fs − f、fs + f、2fs − f … の複製が並びます。',
      '標本だけからは、どれが元の成分かを区別できません。',
    ],
    svg: svg(
      `${axis}<path class="smp-l2" d="M26 58V22"/><path class="smp-lgr" d="M70 58V22M130 58V22"/><path class="smp-l0 smp-dsh" d="M100 14V60"/>${t(26, 16, 'f')}${t(70, 16, 'fs−f')}${t(100, 10, 'fs')}${t(130, 16, 'fs+f')}`,
    ),
  },
  {
    t: 'いちばん低い成分を復元',
    p: ['そこで復元では、0 にいちばん近い成分を元の波とみなします。', 'f がいちばん低ければ、元どおりの波になります。'],
    svg: svg(
      `${axis}<path class="smp-l1" d="M26 58V22"/><path class="smp-lgr" d="M70 58V22M130 58V22"/><path class="smp-l0 smp-dsh" d="M100 14V60"/><path class="smp-l0" d="M48 8H32" marker-end="url(#smp-ah)"/>${t(26, 16, 'f')}${t(70, 16, 'fs−f')}${t(100, 10, 'fs')}${t(130, 16, 'fs+f')}`,
    ),
  },
  {
    t: '2 倍の理由',
    p: [
      'fs を下げると複製 fs − f が f に近づき、fs = 2f でちょうど重なります。',
      'つまり、元の波を復元できるのは fs が f の 2 倍より大きいときだけです。',
    ],
    svg: svg(
      `${axis}<path class="smp-l2" d="M40 58V22"/><path class="smp-lgr" d="M86 58V22"/><path class="smp-l0 smp-dsh" d="M120 14V60"/>${dim(6, 40, 48, 'smp-l2')}${dim(86, 120, 34, 'smp-l0')}${t(23, 44, 'f')}${t(103, 30, 'f')}${t(120, 10, 'fs')}`,
    ),
  },
  {
    t: '折り返し',
    p: [
      'fs が 2f より小さいと、複製 fs − f のほうが低くなります。',
      'すると、元と違う周波数の波が復元されます。これをエイリアシング（折り返し）と呼びます。',
    ],
    svg: svg(
      `${axis}<path class="smp-l2" d="M70 58V22"/><path class="smp-lw" d="M40 58V22"/><path class="smp-l0 smp-dsh" d="M110 14V60"/><path class="smp-l0" d="M108 18Q76 6 44 18" marker-end="url(#smp-ah)"/>${t(76, 30, 'f')}${t(26, 40, 'fs−f')}${t(118, 10, 'fs')}`,
    ),
  },
  {
    t: '入力のローパス',
    p: [
      '矩形波のように高い成分を限りなく含む音では、どれかの成分が必ず折り返します。',
      'したがって、標本化の前にローパスで fs の半分より高い成分を除いておきます。',
    ],
    svg: svg(
      `${axis}<path class="smp-l2" d="M24 58V24"/><path class="smp-l2 smp-dsh" d="M60 58V30M96 58V40"/><path class="smp-l0" d="M6 20H40Q46 20 48 58"/>`,
    ),
  },
];

/**
 * 「きっかけ」と「しくみ」の枠の段。絵は viewBox 0 0 60 54 の SVG の中身で、線の class は style.css の .mxd-st にある:
 * w 仕切り、dr 扉、ar 矢印、hd 悪魔、ht 熱、fa 速い分子、fb 遅い分子、c1・c0 記録のマス、bx 箱、tm 温度計
 */
export interface Step {
  t: string;
  p: string[];
  svg: string;
}

const DEMON =
  '<path class="hd" d="M24 5.5l-1.5-3.5 3.6 2.3M36 5.5l1.5-3.5-3.6 2.3"/><circle class="hd" cx="30" cy="8.5" r="5"/>';
const thermo = (x: number, h: number, cls: string) =>
  `<path class="tm" d="M${x - 3} 40V12a3 3 0 0 1 6 0V40"/><circle class="tm" cx="${x}" cy="44" r="5"/><circle class="${cls}" cx="${x}" cy="44" r="3"/><path class="${cls}" d="M${x - 1.4} 44V${44 - h}h2.8V44Z"/>`;
const cells = (bits: string, y: number) =>
  [...bits]
    .map((b, i) => `<rect class="${b === '1' ? 'c1' : 'c0'}" x="${4 + i * 9}" y="${y}" width="8" height="8"/>`)
    .join('');

export const STEPS_WHY: Step[] = [
  {
    t: '思考実験（1867 年）',
    p: [
      '同じ温度の気体を仕切りで 2 つの部屋に分け、仕切りの扉に小さな悪魔を置きます。',
      '悪魔は分子を見分け、速い分子だけを右へ、遅い分子だけを左へ通します。',
    ],
    svg: `<rect class="bx" x="3" y="16" width="54" height="34"/><path class="w" d="M30 16V27M30 39V50"/><path class="dr" d="M30 27V39"/>${DEMON}<circle class="fa" cx="12" cy="24" r="2.6"/><circle class="fb" cx="20" cy="42" r="2.6"/><circle class="fb" cx="44" cy="22" r="2.6"/><circle class="fa" cx="48" cy="42" r="2.6"/>`,
  },
  {
    t: '仕事なしの温度差',
    p: [
      '扉を開けて元の位置に閉じれば、扉の重さにかかわらず仕事は正確に 0 です。',
      'それでも右の部屋は熱く、左の部屋は冷たくなっていきます。',
    ],
    svg: `${thermo(10, 6, 'fb')}${thermo(50, 26, 'fa')}<path class="w" d="M30 6V20M30 34V48"/><path class="dr" d="M30 20L23 15"/><path class="ar" d="M33 27H42M39 24l3 3-3 3"/><circle class="fa" cx="26" cy="27" r="2.6"/>`,
  },
  {
    t: 'エントロピーの減少',
    p: [
      'お湯は放っておけば冷めますが、水は温めない限りお湯になりません。熱がひとりでに流れるのは、高温から低温への向きだけです。',
      'すなわち、仕事なしに温度差が大きくなることは、熱力学第二法則が禁じるエントロピーの減少を意味します。',
    ],
    svg: `${thermo(10, 6, 'fb')}${thermo(50, 26, 'fa')}<path class="ar" d="M40 22H20M23 19l-3 3 3 3"/><path class="no" d="M22 32L38 44M38 32L22 44"/>`,
  },
  {
    t: '第二種永久機関',
    p: [
      'つまり、この温度差で熱機関を回せば、周りの熱だけで仕事ができることになります。',
      'したがって、悪魔が実在すれば第二種永久機関も実在することになります。',
    ],
    svg: '<circle class="tm" cx="30" cy="27" r="13"/><path class="tm" d="M30 14V40M17 27H43M20.8 17.8L39.2 36.2M39.2 17.8L20.8 36.2"/><circle class="fa" cx="30" cy="27" r="3.4"/><path class="ht" d="M6 46c3-4-3-6 0-10M12 46c3-4-3-6 0-10"/><path class="ar" d="M46 44c6-2 9-8 8-14M51 32l3-3 2 4"/>',
  },
];

export const STEPS_HOW: Step[] = [
  {
    t: '測定',
    p: ['悪魔は扉に来た分子の速さを測り、しきい値より速いか遅いかを判断します。'],
    svg: `<path class="w" d="M30 16V26M30 40V52"/><path class="dr" d="M30 26V40"/><circle class="fa" cx="19" cy="33" r="3.2"/><path class="ar" d="M5 33H13"/>${DEMON}`,
  },
  {
    t: '記録',
    p: ['判断のたびに、通したか通さなかったかの 1 ビットを記憶に書きます。', 'しかし、記憶の容量には限りがあります。'],
    svg: `${cells('101101', 14)}${cells('0110', 28)}<rect class="ce" x="40" y="28" width="8" height="8"/><rect class="ce" x="49" y="28" width="8" height="8"/>`,
  },
  {
    t: '記録の消去',
    p: [
      '記憶が満杯になると、次の判断の前に記録を消す必要があります。',
      'このとき、1 ビット消すごとに kT ln 2 以上の熱が出ます（ランダウアーの原理）。',
    ],
    svg: `${cells('110101', 6)}<path class="ar" d="M30 18V28M27 25l3 3 3-3"/><path class="ht" d="M16 50c3-4-3-6 0-10M28 50c3-4-3-6 0-10M40 50c3-4-3-6 0-10"/>`,
  },
  {
    t: '悪魔の破綻',
    p: [
      'すると、消去で出る熱が気体のエントロピーの減少を上回り、収支として全体のエントロピーは減らなくなります。',
      'よって、熱力学第二法則とは矛盾せず、第二種永久機関は実現できません。',
    ],
    svg: '<path class="ax" d="M4 30H56"/><rect class="fb" x="8" y="30" width="10" height="9"/><rect class="fh" x="26" y="11" width="10" height="19"/><rect class="fs" x="44" y="22" width="10" height="8"/><path class="ar" d="M20 20h3M21.5 18.5v3"/><path class="ar" d="M39 25h2M39 27h2"/>',
  },
];

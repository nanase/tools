/** 発熱のしくみ: [見出し, 小さな図（SVG）, 1 行の説明] */
const s = (inner: string) => `<svg class="wh-mini" viewBox="0 0 150 66" aria-hidden="true">${inner}</svg>`;
const T = (x: number, y: number, t: string) => `<text x="${x}" y="${y}">${t}</text>`;

export const HOW: readonly (readonly [string, string, string])[] = [
  [
    'ジュール熱',
    s(
      `<rect class="fh" x="14" y="27" width="122" height="12" rx="2"/><path class="k" d="M4 33h10M136 33h10"/><path class="k t" d="M60 20l8-6 8 6M76 20l8-6 8 6"/>${T(75, 58, 'I² R')}`,
    ),
    '電流の 2 乗と抵抗に比例する熱',
  ],
  [
    '温度で増える抵抗',
    s(
      `<path class="k t" d="M14 56H140M14 56V8"/><path class="h" d="M18 48L136 18"/>${T(130, 50, 'T')}${T(24, 16, 'R')}`,
    ),
    '熱いほど抵抗が増え、発熱も増加',
  ],
  [
    '表皮効果',
    s(
      `<circle class="k" cx="42" cy="30" r="20"/><circle class="fh" cx="42" cy="30" r="18"/><circle class="k" cx="108" cy="30" r="20"/><circle class="fh" cx="108" cy="30" r="18"/><circle class="fs" cx="108" cy="30" r="11"/>${T(42, 64, '直流')}${T(108, 64, '交流')}`,
    ),
    '周波数が高いほど電流が表面へ集中',
  ],
  [
    '対流',
    s(
      `<path class="h" d="M14 50H136"/><path class="v" d="M40 42c-5-6 5-10 0-16s5-10 0-16M75 42c-5-6 5-10 0-16s5-10 0-16M110 42c-5-6 5-10 0-16s5-10 0-16"/>`,
    ),
    '温まった空気が昇って運ぶ熱',
  ],
  [
    '放射',
    s(
      `<path class="h" d="M14 33H136"/><path class="h t" d="M45 26l-6-14M75 26V10M105 26l6-14M45 40l-6 14M75 40v16M105 40l6 14"/>`,
    ),
    '赤外線で出る熱。高温ほど急に増加',
  ],
  [
    '端子への伝導',
    s(
      `<rect class="fk" x="4" y="22" width="14" height="22"/><rect class="fk" x="132" y="22" width="14" height="22"/><path class="h" d="M18 33H132"/><path class="k" d="M58 33H32M44 27l-12 6 12 6M92 33h26M106 27l12 6-12 6"/>`,
    ),
    '線を伝わり端子へ逃げる熱。短い線ほど効く',
  ],
  [
    '熱の釣り合い',
    s(
      `<path class="k t" d="M14 56H140M14 56V8"/><path class="h" d="M16 54C40 20 70 16 138 15"/><path class="k dd t" d="M14 15H140"/>${T(120, 28, '定常')}`,
    ),
    '発熱と放熱が等しい温度で一定',
  ],
  [
    '基板への広がり',
    s(
      `<rect class="k t" x="8" y="36" width="134" height="14"/><rect class="fh" x="50" y="31" width="50" height="5"/><path class="v t" d="M50 50l-16 10M100 50l16 10M75 50v12"/>`,
    ),
    '銅箔の熱が基板へ広がり両面から放熱',
  ],
  [
    '溶断',
    s(`<path class="h" d="M14 33H66M84 33H136"/><path class="fw" d="M70 26l6 7-6 7 10-7z"/>${T(75, 58, '融点')}`),
    '融点に届いた所で切断',
  ],
];

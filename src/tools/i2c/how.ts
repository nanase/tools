/** 「I2C のしくみ」の小さな図（ビルド時に SVG にする）。1 文字が 1 単位の時間で、'1' が High */
const U = 12,
  H = 16;
const steps = (s: string, y0: number): string => {
  let d = '';
  for (let k = 0; k < s.length; k++) {
    const x = 4 + k * U,
      y = y0 + (s[k] === '1' ? 0 : H);
    d += `${k ? 'L' : 'M'}${x} ${y}L${x + U} ${y}`;
  }
  return d;
};
/** 2 本の線の図。mark: [位置, 幅, 色の種類] の帯、txt: [位置, 文字] */
function mini(scl: string, sda: string, mark: [number, number, string][] = [], txt: [number, string][] = []): string {
  const w = scl.length * U + 8,
    h = 2 * H + 26;
  const mk = mark
    .map(([k, n, c]) => `<rect x="${4 + k * U}" y="2" width="${n * U}" height="${h - 4}" class="i2-mk ${c}"/>`)
    .join('');
  const tx = txt.map(([k, t]) => `<text x="${4 + (k + 0.5) * U}" y="${h - 2}" class="i2-mt">${t}</text>`).join('');
  return `<svg class="i2-mini" viewBox="0 0 ${w} ${h + 10}" aria-hidden="true">${mk}<path d="${steps(scl, 4)}" class="i2-l1"/><path d="${steps(sda, H + 14)}" class="i2-l2"/>${tx}</svg>`;
}
/** 抵抗・線・2 つのスイッチ（右は閉じて線を下げている） */
const OD =
  '<svg class="i2-mini" viewBox="0 0 150 68" aria-hidden="true"><path class="i2-l0" d="M8 6H142M20 6v6l5 3-10 5 10 5-10 5 5 3v6"/><path class="i2-l2" d="M20 39H142"/><path class="i2-l0" d="M60 39v8l9 8M54 59h12M57 63h6M100 59h12M103 63h6"/><path class="i2-ls" d="M100 39v20"/><circle cx="60" cy="39" r="3" class="i2-f2"/><circle cx="100" cy="39" r="3" class="i2-f2"/></svg>';
/** 立ち上がりの鈍り（点線は理想の形） */
const RC =
  '<svg class="i2-mini" viewBox="0 0 150 68" aria-hidden="true"><path class="i2-l0 i2-dash" d="M6 52H40V12H90V52H144"/><path class="i2-l1" d="M6 52H40C48 24 60 14 90 13V52H144"/><text x="56" y="64" class="i2-mt">tr</text></svg>';

/** [見出し, 図, 一言] */
export const HOW: readonly (readonly [string, string, string])[] = [
  ['オープンドレイン', OD, '1 台でも下げれば Low'],
  [
    '開始と終了',
    mini(
      '11111111111',
      '11100001111',
      [
        [3, 1, 'a'],
        [7, 1, 'a'],
      ],
      [
        [3, 'S'],
        [7, 'P'],
      ],
    ),
    'SCL が High の間の SDA の変化',
  ],
  [
    'ビット',
    mini(
      '00110011001',
      '00001111000',
      [
        [2, 2, 'b'],
        [6, 2, 'b'],
      ],
      [
        [2.5, '0'],
        [6.5, '1'],
      ],
    ),
    'SCL が High の間に読む',
  ],
  ['アドレス', mini('0101010101010101', '0011000000000011', [[14, 2, 'b']], [[14.5, 'R/W']]), '7 ビット＋読み書き'],
  ['ACK と NACK', mini('0010100', '1100011', [[2, 2, 's']], [[2.5, 'A']]), '9 ビット目は受け手の返事'],
  ['クロックストレッチ', mini('0010000000100', '1110000001111', [[3, 7, 's']]), 'スレーブが SCL を Low に保持'],
  ['調停', mini('0101010101', '1100111100', [[4, 2, 'w']]), '1 を送って Low なら負け'],
  ['プルアップ抵抗', RC, '大きいほど立ち上がりが遅い'],
];

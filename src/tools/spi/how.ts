/** 「SPI のしくみ」の小さな図（ビルド時に SVG にする）。1 文字が 1 単位の時間で、'1' が High */
const U = 12,
  H = 14;
const steps = (s: string, y0: number): string => {
  let d = '';
  for (let k = 0; k < s.length; k++) {
    const x = 4 + k * U,
      y = y0 + (s[k] === '1' ? 0 : H);
    d += `${k ? 'L' : 'M'}${x} ${y}L${x + U} ${y}`;
  }
  return d;
};
/** 線の図。rows: [列, class]、mark: 縦の点線を置く単位の位置、txt: [位置, 文字] */
function mini(rows: [string, string][], mark: number[] = [], txt: [number, string][] = []): string {
  const w = rows[0][0].length * U + 8,
    h = rows.length * (H + 8) + 14;
  const mk = mark.map((k) => `<path d="M${4 + k * U} 2V${h - 12}" class="sp-l0 sp-dash"/>`).join('');
  const tx = txt.map(([k, t]) => `<text x="${4 + k * U}" y="${h - 2}" class="sp-mt">${t}</text>`).join('');
  return `<svg class="sp-mini" viewBox="0 0 ${w} ${h}" aria-hidden="true">${mk}${rows.map(([s, c], i) => `<path d="${steps(s, 4 + i * (H + 8))}" class="${c}"/>`).join('')}${tx}</svg>`;
}
/** 2 段のレジスタ。上 8 個のうち左から top 個がスレーブの色、下 8 個のうち右から bot 個がマスタの色 */
function reg(top: number, bot: number, extra = ''): string {
  let s =
    '<svg class="sp-mini" viewBox="0 0 150 66" aria-hidden="true"><path class="sp-l0" d="M14 16H6V50H14M136 16H144V50H136"/>';
  for (let k = 0; k < 8; k++)
    s += `<rect x="${16 + k * 15}" y="8" width="13" height="16" class="${k < top ? 'sp-fs' : 'sp-fm'}"/><rect x="${16 + k * 15}" y="42" width="13" height="16" class="${k >= 8 - bot ? 'sp-fm' : 'sp-fs'}"/>`;
  return `${s}<path class="sp-l0" d="M3 30l3 4 3-4M141 36l3-4 3 4"/>${extra}</svg>`;
}
const WIRES =
  '<svg class="sp-mini" viewBox="0 0 150 66" aria-hidden="true"><rect x="6" y="6" width="32" height="54" class="sp-box"/><rect x="112" y="6" width="32" height="54" class="sp-box"/><path class="sp-l1" d="M38 14H112"/><path class="sp-lm" d="M38 27H112"/><path class="sp-ls" d="M112 40H38"/><path class="sp-l2" d="M38 53H112"/><text x="75" y="11" class="sp-mt">SCK</text><text x="75" y="24" class="sp-mt">MOSI</text><text x="75" y="37" class="sp-mt">MISO</text><text x="75" y="50" class="sp-mt">CS</text></svg>';
const CS =
  '<svg class="sp-mini" viewBox="0 0 150 66" aria-hidden="true"><rect x="6" y="8" width="30" height="50" class="sp-box"/><path class="sp-l2" d="M36 16H60V38M36 24H100V38M36 32H136V38"/><rect x="46" y="38" width="28" height="18" class="sp-box sp-on"/><rect x="86" y="38" width="28" height="18" class="sp-box"/><rect x="122" y="38" width="22" height="18" class="sp-box"/></svg>';
const CHAIN =
  '<svg class="sp-mini" viewBox="0 0 150 66" aria-hidden="true"><rect x="6" y="18" width="26" height="24" class="sp-box"/><rect x="44" y="18" width="26" height="24" class="sp-box"/><rect x="80" y="18" width="26" height="24" class="sp-box"/><rect x="116" y="18" width="26" height="24" class="sp-box"/><path class="sp-lm" d="M19 18V8H129V18"/><path class="sp-ls" d="M116 30H106M80 30H70M44 30H32"/><rect x="122" y="47" width="6" height="6" class="sp-fm"/><rect x="86" y="47" width="6" height="6" class="sp-fs"/><rect x="50" y="47" width="6" height="6" class="sp-fs"/></svg>';
const LATE =
  '<svg class="sp-mini" viewBox="0 0 150 66" aria-hidden="true"><path class="sp-l1" d="M4 30H40V8H76V30H112V8H146"/><path class="sp-ls" d="M4 40H62L66 52H146"/><path class="sp-l0 sp-dash" d="M40 4V60M76 4V60"/><path class="sp-l0" d="M42 58H60"/><circle cx="76" cy="52" r="3" class="sp-fw"/><text x="51" y="64" class="sp-mt">遅れ</text></svg>';

/** [見出し, 図, 一言] */
export const HOW: readonly (readonly [string, string, string])[] = [
  ['4 本の線', WIRES, 'クロック・2 本のデータ・選択'],
  ['CS で選ぶ', CS, 'Low にした 1 台だけが応答'],
  ['シフトレジスタの交換', reg(3, 3), '1 クロックで 1 ビットずつ入れ替え'],
  [
    '出すエッジと読むエッジ',
    mini(
      [
        ['00110011001', 'sp-l1'],
        ['11100001111', 'sp-lm'],
      ],
      [2, 6],
      [
        [2, '読む'],
        [6, '読む'],
      ],
    ),
    '出したエッジと反対のエッジで読み取り',
  ],
  [
    '4 つのモード',
    mini(
      [
        ['0011001100', 'sp-l1'],
        ['1100110011', 'sp-l1'],
      ],
      [2, 4],
      [
        [2, 'CPHA 0'],
        [4.6, '1'],
      ],
    ),
    'CPOL で待機の向き、CPHA で読むエッジ',
  ],
  [
    'ビットの順',
    reg(8, 0, '<text x="22" y="38" class="sp-mt">MSB</text><text x="128" y="38" class="sp-mt">LSB</text>'),
    '多くの機器は MSB から',
  ],
  ['デイジーチェーン', CHAIN, '押し出されたバイトが次の機器へ'],
  ['MISO の遅れ', LATE, '往復の遅れが半周期を超えると読み違い'],
];

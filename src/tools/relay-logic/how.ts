/** しくみの工程: [見出し, 小さな図（SVG）, 一言] */
import { miniRelay } from './svg';

const fig = (s: string, vb = '0 0 160 72'): string =>
  `<svg class="ry-mini" viewBox="${vb}" aria-hidden="true">${s}</svg>`;
/** 接点 1 個（左の端子 x、長さ 36）。closed なら刃を倒す */
const contact = (x: number, y: number, closed: boolean, lb: string): string =>
  `<circle cx="${x}" cy="${y}" r="2.6" class="dot"/><circle cx="${x + 36}" cy="${y}" r="2.6" class="dot"/><line x1="${x}" y1="${y}" x2="${x + 37}" y2="${y}" class="blade${closed ? ' on' : ''}" transform="rotate(${closed ? 0 : -24} ${x} ${y})"/>${lb ? `<text x="${x + 18}" y="${y - 13}" class="hl" text-anchor="middle">${lb}</text>` : ''}`;
const lampM = (x: number, y: number, on: boolean): string =>
  `<circle cx="${x}" cy="${y}" r="9" class="hlamp${on ? ' on' : ''}"/><path d="M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}" class="hlx"/>`;
const hw = (on: boolean, d: string): string => `<path d="${d}" class="hw${on ? ' on' : ''}"/>`;
/** 動作した小さなリレー */
const relayOn = (x: number, y: number): string =>
  miniRelay(x, y, '')
    .replace('class="mr"', 'class="mr on"')
    .replace(/rotate\(13 50 9\)/, 'rotate(0 50 9)');

export const HOW: readonly (readonly [string, string, string])[] = [
  [
    'リレー',
    fig(
      `${hw(true, 'M8 60H40V52M96 30V60H152')}${relayOn(40, 14)}<path d="M100 24L130 24" class="blade on"/><circle cx="100" cy="24" r="2.6" class="dot"/><circle cx="132" cy="24" r="2.6" class="dot"/><text x="64" y="12" class="hl" text-anchor="middle">コイル</text><text x="132" y="14" class="hl" text-anchor="middle">接点</text>`,
    ),
    'コイルに電流が流れると接極子が引き寄せられて接点が動く',
  ],
  [
    'a 接点と b 接点',
    fig(
      `${hw(false, 'M6 22H40M76 22H96')}${contact(40, 22, true, 'a')}${lampM(108, 22, true)}${hw(false, 'M6 56H40M76 56H96')}${contact(40, 56, false, 'b')}${lampM(108, 56, false)}<text x="150" y="26" class="hl" text-anchor="end">閉</text><text x="150" y="60" class="hl" text-anchor="end">開</text>`,
    ),
    '動作すると a 接点は閉じて b 接点は開く',
  ],
  [
    '直列',
    fig(
      `${hw(true, 'M8 40H10M46 40H70M106 40H128')}${contact(10, 40, true, 'A')}${contact(70, 40, true, 'B')}${lampM(140, 40, true)}`,
    ),
    '両方閉じたときだけ点灯（AND）',
  ],
  [
    '並列',
    fig(
      `${hw(true, 'M8 40H26V22H40M76 22H96V40H128')}${hw(false, 'M26 40V58H40M76 58H96V40')}${contact(40, 22, true, 'A')}${contact(40, 58, false, '')}<text x="58" y="70" class="hl" text-anchor="middle">B</text>${lampM(140, 40, true)}`,
    ),
    'どちらかが閉じれば点灯（OR）',
  ],
  [
    'c 接点',
    fig(
      `${hw(true, 'M8 38H40')}<circle cx="40" cy="38" r="3" class="dot"/><line x1="40" y1="38" x2="100" y2="22" class="blade on"/>${hw(true, 'M104 20H150')}${hw(false, 'M104 56H150')}<circle cx="104" cy="20" r="3" class="dot"/><circle cx="104" cy="56" r="3" class="dot"/><text x="112" y="14" class="hl">a</text><text x="112" y="70" class="hl">b</text>`,
    ),
    '動作すると電流の行き先が b から a へ',
  ],
  [
    '線の入れ替え',
    fig(
      `${hw(false, 'M10 20H50L90 54H150')}${hw(true, 'M10 54H50L90 20H150')}<text x="70" y="70" class="hl" text-anchor="middle">B</text>`,
    ),
    'c 接点 2 組で上下の線を入れ替え（XOR）',
  ],
  [
    '自己保持',
    fig(
      `${hw(true, 'M6 26H22M22 26H44M54 26H66M66 26H118M138 26H154')}${hw(true, 'M22 26V56H44M54 56H66V26')}<path d="M44 17V35M54 17V35M44 47V65M54 47V65" class="hw"/><rect x="44" y="48" width="10" height="16" class="hfill"/><text x="49" y="12" class="hl" text-anchor="middle">セット</text><text x="49" y="44" class="hl" text-anchor="middle">R1</text>${lampM(128, 26, true)}<text x="128" y="12" class="hl" text-anchor="middle">R1</text>`,
    ),
    'セットを離しても自分の a 接点で電流が続く',
  ],
  [
    'インターロック',
    fig(
      `${hw(true, 'M10 22H40M60 22H150')}${hw(false, 'M10 52H40M60 52H150')}<path d="M44 12V32M56 12V32M44 42V62M56 42V62M38 62L62 42" class="hw"/><text x="50" y="9" class="hl" text-anchor="middle">R2</text><text x="50" y="72" class="hl" text-anchor="middle">R1</text><text x="146" y="16" class="hl" text-anchor="end">R1</text><text x="146" y="46" class="hl" text-anchor="end">R2</text>`,
    ),
    '相手の b 接点で両方は同時に入らない',
  ],
  [
    'チャタリング',
    fig(
      `<path d="M22 20H152M22 56H152" class="hg"/><path d="M22 56H64V20H72V56H80V20H87V56H91V20H152" class="hw on"/><text x="6" y="24" class="hl">閉</text><text x="6" y="60" class="hl">開</text>`,
    ),
    '閉じた直後に接点が跳ねて数回の開閉',
  ],
];

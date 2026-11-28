/**
 * 回路図の SVG と電流の通り道。.astro（ビルド時）とブラウザの両方で使う。
 * 配線と極板は data-n（電圧の名前）で色を、部品の地は両端の電圧のグラデーションで塗る（client.ts）。
 * 地点の札（data-pr）には小さな波形を描き、押すと波形の枠の CH に入れる
 */
import type { Probe } from './model';

export type Pt = [number, number];
/** 電流の通り道の線分。i は各点の電流から線分の電流（a → b を正）を出す */
export interface Seg {
  a: Pt;
  b: Pt;
  i: (p: Probe) => number;
}

/** 波形を見る地点 */
export const PROBES = ['xin', 'xout', 'xr', 'out', 'ix'] as const;
export type ProbeId = (typeof PROBES)[number];
export const PROBE_NAME: Record<ProbeId, string> = {
  xin: 'XIN',
  xout: 'XOUT',
  xr: '水晶の右端',
  out: '出力',
  ix: '水晶の電流',
};
/** 札の左上 */
const BADGE: Record<ProbeId, Pt> = {
  xin: [22, 140],
  xout: [350, 50],
  xr: [362, 208],
  out: [440, 50],
  ix: [196, 144],
};
/** 札から地点への引き出し線 */
const LEAD: Record<ProbeId, string> = {
  xin: 'M80 152H107',
  xout: 'M366 74L344 97',
  xr: 'M362 220H343',
  out: 'M470 74L470 96',
  ix: 'M225 168V186',
};
export const BADGE_W = 58,
  BADGE_H = 24;

const wire = (n: string, d: string) => `<path class="xo-w" data-n="${n}" d="${d}"/>`;
const grad = (id: string, x1: number, y1: number, x2: number, y2: number, a: string, b: string) =>
  `<linearGradient id="xog-${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" data-n="${a}"/><stop offset="1" data-n="${b}"/></linearGradient>`;
const resH = (id: string, x1: number, x2: number, y: number, a: string, b: string) =>
  `${grad(id, x1, y, x2, y, a, b)}<rect class="xo-b" x="${x1}" y="${y - 6}" width="${x2 - x1}" height="12" fill="url(#xog-${id})"/>`;
const resV = (id: string, x: number, y1: number, y2: number, a: string, b: string) =>
  `${grad(id, x, y1, x, y2, a, b)}<rect class="xo-b" x="${x - 6}" y="${y1}" width="12" height="${y2 - y1}" fill="url(#xog-${id})"/>`;
/** コンデンサ（上の極板 y・下の極板 y + 8） */
const cap = (id: string, x: number, y: number, a: string, b: string) =>
  `${grad(id, x, y, x, y + 8, a, b)}<rect x="${x - 12}" y="${y}" width="24" height="8" fill="url(#xog-${id})" opacity=".55"/><path class="xo-w xo-pl" data-n="${a}" d="M${x - 13} ${y}H${x + 13}"/><path class="xo-w xo-pl" data-n="${b}" d="M${x - 13} ${y + 8}H${x + 13}"/>`;
const jn = (...p: Pt[]) => p.map(([x, y]) => `<circle class="xo-j" cx="${x}" cy="${y}" r="2.8"/>`).join('');
const sub = (s: string) => `<tspan font-size="9" dy="3">${s}</tspan>`;
/** 記号と値（値は client.ts が入れる） */
const lbl = (x: number, y: number, sym: string, id: string, anchor = 'end') =>
  `<text class="s-l" x="${x}" y="${y}" text-anchor="${anchor}">${sym}</text><text class="s-v" id="${id}" x="${x}" y="${y + 16}" text-anchor="${anchor}"></text>`;
const inv = (x: number, y: number, h: number) =>
  `<path class="xo-inv" d="M${x} ${y - h / 2}V${y + h / 2}L${x + h} ${y}Z"/><circle class="xo-inv" cx="${x + h + 5}" cy="${y}" r="4.5"/>`;

/** 回路図（地点の札を含む） */
export function drawSchematic(): string {
  let s = '<defs>';
  s += grad('xt', 203, 220, 247, 220, 'xin', 'xr');
  s += '</defs>';
  /* 配線 */
  s += wire('xin', 'M110 40H186M110 40V220M110 100H200M110 220H194M110 220V262');
  s += wire('xout', 'M254 40H340V130M255 100H384');
  s += wire('out', 'M429 100H466');
  s += wire('xr', 'M340 180V262M256 220H340');
  s += wire('gnd', 'M110 270V326H340V270M225 326V332');
  /* 部品 */
  s += resH('rf', 186, 254, 40, 'xin', 'xout');
  s += resV('rd', 340, 130, 180, 'xout', 'xr');
  s += cap('c1', 110, 262, 'xin', 'gnd');
  s += cap('c2', 340, 262, 'xr', 'gnd');
  s += inv(200, 100, 46) + inv(384, 100, 36);
  /* 水晶: 2 枚の電極と水晶片 */
  s += `<path class="xo-w xo-pl" data-n="xin" d="M196 204V236"/><path class="xo-w xo-pl" data-n="xr" d="M254 204V236"/>`;
  s += `<rect class="xo-xb" x="203" y="208" width="44" height="24" rx="2" fill="url(#xog-xt)"/>`;
  s += `<path class="xo-ln" d="M219 332H231M221.5 336H228.5M224 340H226"/>`;
  s += jn([110, 100], [110, 220], [340, 100], [340, 220], [225, 326]);
  s += '<circle class="xo-term" cx="470" cy="100" r="4"/>';
  /* 記号と値 */
  s += `<text class="s-l" x="214" y="27" text-anchor="end">R${sub('f')}</text><text class="s-v" id="s-rf" x="222" y="27"></text>`;
  s += lbl(352, 150, `R${sub('d')}`, 's-rd', 'start');
  s += lbl(94, 262, `C${sub('1')}`, 's-c1');
  s += lbl(356, 262, `C${sub('2')}`, 's-c2', 'start');
  s +=
    '<text class="s-t" x="224" y="72" text-anchor="middle">U1</text><text class="s-t" x="402" y="128" text-anchor="middle">U2</text>';
  s += '<text class="s-t" x="470" y="124" text-anchor="middle">出力</text>';
  s +=
    '<text class="s-t" x="104" y="94" text-anchor="end">XIN</text><text class="s-t" x="300" y="94" text-anchor="middle">XOUT</text>';
  /* 水晶の等価回路。点線で水晶とつなぐ */
  s += `<g class="xo-eq"><path class="xo-dash" d="M203 232L150 248M247 232L300 248"/><rect class="xo-eqb" x="150" y="248" width="150" height="66" rx="4"/>
<text class="s-n" x="156" y="260">等価回路</text>
<path class="xo-ln" d="M156 272H164M186 272H192M226 272H233M239 272H294V302H229M223 302H156V272"/>
<rect class="xo-ln" x="164" y="267" width="22" height="10"/>
<path class="xo-ln" d="M192 272a4.25 4.25 0 0 1 8.5 0a4.25 4.25 0 0 1 8.5 0a4.25 4.25 0 0 1 8.5 0a4.25 4.25 0 0 1 8.5 0"/>
<path class="xo-ln xo-bw" d="M233 265V279M239 265V279M223 295V309M229 295V309"/>
<text class="s-n xo-rm" id="s-rm" x="160" y="290"></text>
<text class="s-n" x="209" y="290" text-anchor="middle">L<tspan font-size="7" dy="2">m</tspan></text>
<text class="s-n" x="250" y="290">C<tspan font-size="7" dy="2">m</tspan></text>
<text class="s-n" x="236" y="311">C<tspan font-size="7" dy="2">0</tspan></text></g>`;
  s += '<text class="s-v" x="225" y="199" text-anchor="middle" id="s-xt"></text>';
  /* 地点の札 */
  for (const k of PROBES) {
    const [x, y] = BADGE[k];
    s += `<path class="xo-lead" d="${LEAD[k]}"/><g class="xo-pr" data-pr="${k}" transform="translate(${x} ${y})" tabindex="0" role="button" aria-label="${PROBE_NAME[k]} の波形を見る">
<rect class="xo-prb" width="${BADGE_W}" height="${BADGE_H}" rx="5"/><circle class="xo-prn" cx="11" cy="12" r="8"/><text class="xo-prt" x="11" y="12">${PROBES.indexOf(k) + 1}</text><path class="xo-spk" d=""/></g>`;
  }
  return s;
}

/** 電流の通り道（線分ごとに電流を決める） */
export const SEGS: Seg[] = [
  /* インバータの出力から XOUT へ（Rf と Rd に分かれる） */
  { a: [256, 100], b: [340, 100], i: (p) => p.irf + p.ird },
  { a: [340, 100], b: [340, 40], i: (p) => p.irf },
  { a: [340, 40], b: [110, 40], i: (p) => p.irf },
  { a: [110, 40], b: [110, 220], i: (p) => p.irf },
  { a: [340, 100], b: [340, 220], i: (p) => p.ird },
  /* 水晶（右端 → XIN を正） */
  { a: [340, 220], b: [110, 220], i: (p) => p.ix },
  { a: [110, 220], b: [110, 326], i: (p) => p.ic1 },
  { a: [340, 220], b: [340, 326], i: (p) => p.ic2 },
  { a: [110, 326], b: [225, 326], i: (p) => p.ic1 },
  { a: [340, 326], b: [225, 326], i: (p) => p.ic2 },
  { a: [225, 326], b: [225, 332], i: (p) => p.ic1 + p.ic2 },
];

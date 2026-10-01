/** 抵抗カラーコードの表示の部品（HTML・SVG の文字列。DOM に依存しない） */
import { BAND_GRADIENTS, COLORS, type ColorKey, cssOf, RESISTOR_BODY } from '../../lib/colorcode';
import { esc } from '../../lib/dom';
import { fmt, parts } from '../../lib/format';
import {
  type Code,
  devTxt,
  digitsOf,
  type ERow,
  keyOf,
  meaning,
  ohmsOf,
  pct,
  type Role,
  roleLong,
  roleName,
  rolesOf,
  tolOf,
  tolSig,
} from './model';

/** 色見本。帯なしは本体の色に破線の枠 */
export const sw = (k: ColorKey): string =>
  k === 'no'
    ? '<i class="csw no" aria-hidden="true"></i>'
    : `<i class="csw" style="--c:${cssOf(k)}" aria-hidden="true"></i>`;

/** 色を選ぶチップ（色見本・名前・意味）。dis なら押せない理由を title に出す */
export const ccChip = (r: Role, k: ColorKey, on: boolean, dis = ''): string =>
  `<button type="button" class="chip cc" data-k="${k}" aria-pressed="${on}"${dis ? ` disabled title="${esc(dis)}"` : ''} aria-label="${esc(`${COLORS[k].n}、${meaning(r, k, 2)}`)}">${sw(k)}<b>${COLORS[k].n}</b>${esc(meaning(r, k, 1))}</button>`;

/* ---------- 色帯の図 ---------- */
/* 帯の位置は回路図の部品（幅 44 の本体に幅 4 の帯）を 5 倍したもの。6 本帯は同じ作りで詰めた */
const BX: Record<4 | 5 | 6, number[]> = {
  4: [90, 120, 150, 215],
  5: [80, 105, 130, 155, 220],
  6: [75, 100, 125, 150, 190, 220],
};
const VW = 320,
  BY = 14,
  BH = 80,
  BW = 20,
  CY = BY + BH / 2;
/* 本体・帯・印・押せる範囲は上の座標で描き、左右の中央を軸に K 倍に縮める（S）。
   リード線と引き出し線は縮めずに図の幅いっぱいに引く */
const K = 0.72,
  S = `translate(${(VW / 2) * (1 - K)} 0) scale(${K})`,
  sx = (x: number) => VW / 2 + (x - VW / 2) * K,
  BB = (BY + BH) * K,
  VH = Math.round(BB) + 38;

/** 図の固定部分（リード線・本体・陰影）。帯は #r-bands、引き出し線・印・押せる範囲は #r-ov に入れる */
export const figFrame = (): string =>
  `<svg class="rsvg" id="rsvg" viewBox="0 0 ${VW} ${VH}" role="img"><defs>${BAND_GRADIENTS}` +
  `<clipPath id="rclip"><rect x="50" y="${BY}" width="220" height="${BH}" rx="30"/></clipPath></defs>` +
  `<path class="r-ld" d="M4 ${CY * K}H${sx(50)}M${sx(270)} ${CY * K}H316"/>` +
  `<g transform="${S}"><rect class="r-bd" x="50" y="${BY}" width="220" height="${BH}" rx="30" fill="${RESISTOR_BODY}" style="stroke:color-mix(in srgb,${RESISTOR_BODY},#000 45%)"/>` +
  '<g id="r-bands" clip-path="url(#rclip)"></g>' +
  `<rect class="s-sh" x="50" y="${BY}" width="220" height="${BH}" rx="30"/></g><g id="r-ov"></g></svg>`;

/** 図の読み上げ */
export function figLabel(c: Code): string {
  const names = rolesOf(c.n)
    .map((r) => keyOf(c, r))
    .filter((k) => k !== 'no')
    .map((k) => COLORS[k].n);
  return `${c.n === 4 && c.tol === 'no' ? 3 : c.n} 本の色帯の抵抗器: ${names.join('、')}（${fmt(ohmsOf(c), 'Ω', 6)} ${pct(tolOf(c))}）`;
}

/** 帯の矩形。帯なしは破線の枠 */
export function bandsSvg(c: Code): string {
  const xs = BX[c.n];
  return rolesOf(c.n)
    .map((r, i) => {
      const k = keyOf(c, r);
      return k === 'no'
        ? `<rect class="r-no" x="${xs[i] + 1}" y="${BY + 4}" width="${BW - 2}" height="${BH - 8}" rx="2"/>`
        : `<rect x="${xs[i]}" y="${BY + 2.5}" width="${BW}" height="${BH - 5}" fill="${COLORS[k].fill}"/>`;
    })
    .join('');
}

/** 帯から下の選択ボタンへの引き出し線、選んでいる帯の印、帯を押せる範囲 */
export function overlaySvg(c: Code, sel: Role): string {
  const roles = rolesOf(c.n),
    xs = BX[c.n],
    N = roles.length,
    si = roles.indexOf(sel);
  let s = '';
  xs.forEach((x, i) => {
    const bx = sx(x + BW / 2).toFixed(1),
      cx = (VW * (i + 0.5)) / N;
    s += `<path class="r-ln${i === si ? ' on' : ''}" d="M${bx} ${(BB + 3).toFixed(1)}V${(BB + 9).toFixed(1)}L${cx.toFixed(1)} ${VH - 8}V${VH}"/>`;
  });
  s += `<g transform="${S}">`;
  if (si >= 0) {
    const bx = xs[si] + BW / 2;
    s += `<path class="r-mk" d="M${bx - 7} 1H${bx + 7}L${bx} 10Z"/>`;
  }
  xs.forEach((x, i) => {
    s += `<rect class="r-hit" data-b="${i}" x="${x - 3}" y="0" width="${BW + 6}" height="${BY + BH + 10}"/>`;
  });
  return `${s}</g>`;
}

/** 帯ごとの選択ボタン */
export const bandButtons = (c: Code, sel: Role): string =>
  rolesOf(c.n)
    .map((r, i) => {
      const k = keyOf(c, r),
        x = COLORS[k];
      return `<button type="button" class="bt" data-r="${r}" aria-pressed="${r === sel}" aria-label="${esc(`${i + 1} 本目、${roleLong(r)}: ${x.n}、${meaning(r, k, 2)}`)}"><small>${roleName(r)}</small><b>${x.n}</b><span>${esc(meaning(r, k, 0))}</span></button>`;
    })
    .join('');

/* ---------- 計算結果 ---------- */
/** 色の並び（帯なしは出さない） */
export const colorSeq = (c: Code): string =>
  rolesOf(c.n)
    .map((r) => [r, keyOf(c, r)] as const)
    .filter(([, k]) => k !== 'no')
    .map(([r, k]) => `<span>${sw(k)}${COLORS[k].n}<small>${esc(meaning(r, k, 2))}</small></span>`)
    .join('');

/* ---------- E 系列 ---------- */
const CHECK = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7.5L5.5 11L12 3.5"/></svg>';

/** E 系列の一覧。載っていなければ前後の近い値を押せるチップで出す */
export const eRowsHtml = (rows: readonly ERow[], R: number): string =>
  rows
    .map(({ s, tol, hit, near }) => {
      const head = `<span class="en">E${s}<small>${pct(tol)}</small></span>`;
      if (hit)
        return `<div class="erow">${head}<span class="ev"><span class="ok">${CHECK}載っている</span></span></div>`;
      return (
        `<div class="erow">${head}<span class="ev"><span class="nx">載っていない · 近い値</span>` +
        near
          .map(
            (x) =>
              `<button type="button" class="chip nb" data-v="${x}" aria-label="${esc(`${fmt(x, 'Ω', 6)}（${devTxt(x, R)}）にする`)}"><b>${esc(fmt(x, 'Ω', 3))}</b><small>${devTxt(x, R)}</small></button>`,
          )
          .join('') +
        '</span></div>'
      );
    })
    .join('');

/* ---------- 代入した式 ---------- */
/** MathML の量。計算した値（keep）は末尾の 0 を残す */
const qty = (v: number, u: string, sig = 6, keep = false) => {
  const [n, x] = parts(v, u, sig, keep);
  return `<mn>${n}</mn><mspace width="0.17em"/><mi mathvariant="normal">${x}</mi>`;
};
const mexp = (x: number) => (x < 0 ? `<mrow><mo>&#x2212;</mo><mn>${-x}</mn></mrow>` : `<mn>${x}</mn>`);
const X = '<mo>&#xD7;</mo>',
  LP = '<mo stretchy="false">(</mo>',
  RP = '<mo stretchy="false">)</mo>';

/** いまの色帯の値を代入した式（MathML） */
export function substHtml(c: Code): string {
  const R = ohmsOf(c),
    t = tolOf(c),
    d = c.d,
    rs = digitsOf(c),
    ts = tolSig(t);
  const coef =
    d.length === 2
      ? `<mn>10</mn>${X}<mn>${d[0]}</mn><mo>+</mo><mn>${d[1]}</mn>`
      : `<mn>100</mn>${X}<mn>${d[0]}</mn><mo>+</mo><mn>10</mn>${X}<mn>${d[1]}</mn><mo>+</mo><mn>${d[2]}</mn>`;
  const tt = `<mn>${Number((t / 100).toPrecision(6))}</mn>`;
  const tc = COLORS[c.tc].tc ?? 0;
  return (
    `<math display="block"><mi>R</mi><mo>=</mo>${LP}${coef}${RP}${X}<msup><mn>10</mn>${mexp(c.m)}</msup><mspace width="0.17em"/><mi mathvariant="normal">Ω</mi><mo>=</mo>${qty(R, 'Ω', rs, true)}</math>` +
    `<math display="block"><msub><mi>R</mi><mi>min</mi></msub><mo>=</mo>${qty(R, 'Ω', rs, true)}${X}${LP}<mn>1</mn><mo>&#x2212;</mo>${tt}${RP}<mo>=</mo>${qty(R * (1 - t / 100), 'Ω', ts, true)}</math>` +
    `<math display="block"><msub><mi>R</mi><mi>max</mi></msub><mo>=</mo>${qty(R, 'Ω', rs, true)}${X}${LP}<mn>1</mn><mo>+</mo>${tt}${RP}<mo>=</mo>${qty(R * (1 + t / 100), 'Ω', ts, true)}</math>` +
    (c.n === 6
      ? `<math display="block"><mfrac><mrow><mi mathvariant="normal">&#x394;</mi><mi>R</mi></mrow><mrow><mi mathvariant="normal">&#x394;</mi><mi>T</mi></mrow></mfrac><mo>=</mo><mi>R</mi><mi>&#x3B1;</mi><mo>=</mo>${qty(R, 'Ω', rs, true)}${X}<mn>${tc}</mn>${X}<msup><mn>10</mn><mrow><mo>&#x2212;</mo><mn>6</mn></mrow></msup><mspace width="0.17em"/><mi mathvariant="normal">/K</mi><mo>=</mo>${qty(R * tc * 1e-6, 'Ω/K', rs, true)}</math>`
      : '')
  );
}

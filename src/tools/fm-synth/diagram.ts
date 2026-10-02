/**
 * アルゴリズムの結線図（SVG の中身。DOM に依存しない）。ビルド時の初期表示と client.ts の描き直しで使う。
 * 信号は左から右へ流れ、キャリアは右端の列に並べて、右の縦線でまとめて出力する
 */
import { ALGS, FB_LABEL } from './synth';

/** オペレータの位置 [列, 行]（列 3 がキャリア） */
const POS: readonly (readonly [number, number][])[] = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  [
    [1, 0],
    [1, 1],
    [2, 0.5],
    [3, 0.5],
  ],
  [
    [2, 0],
    [1, 1],
    [2, 1],
    [3, 0.5],
  ],
  [
    [1, 0],
    [2, 0],
    [2, 1],
    [3, 0.5],
  ],
  [
    [2, 0],
    [3, 0],
    [2, 1],
    [3, 1],
  ],
  [
    [2, 1],
    [3, 0],
    [3, 1],
    [3, 2],
  ],
  [
    [2, 0],
    [3, 0],
    [3, 1],
    [3, 2],
  ],
  [
    [3, 0],
    [3, 1],
    [3, 2],
    [3, 3],
  ],
];

/** 図の幅（viewBox）と、箱の大きさ・間隔 */
export const DW = 400;
const BW = 54,
  BH = 30,
  PX = 80,
  PY = 52,
  X0 = 22,
  /** 上端（帰還の輪の分を空ける） */
  Y0 = 26,
  BUS = X0 + 3 * PX + BW + 20;

/** 最も下の箱の行 */
const lastRow = (alg: number) => Math.max(...POS[alg].map(([, r]) => r));
/** 図の高さ（viewBox）。箱の行の数で変わる */
export const algH = (alg: number): number => Y0 + lastRow(alg) * PY + BH + 20;

/** 箱の下に添える値（「×1 · I 1.5」など）。省略すると添えない */
export function algSvg(alg: number, fb: number, notes?: readonly string[]): string {
  const P = POS[alg],
    { e, c } = ALGS[alg],
    top = Y0,
    bx = (k: number) => X0 + P[k][0] * PX,
    cy = (k: number) => top + P[k][1] * PY + BH / 2;
  const arrow = (x: number, y: number, n1 = false) => `<path class="d-ah${n1 ? ' n1' : ''}" d="M${x} ${y}l-7 -4v8Z"/>`;
  let s = '';
  /* 変調の結線: 同じ高さなら直線、違えば先の箱の手前で折る */
  for (const [j, k] of e) {
    const x1 = bx(j) + BW,
      y1 = cy(j),
      x2 = bx(k),
      y2 = cy(k);
    s +=
      y1 === y2
        ? `<path class="s-w" d="M${x1} ${y1}H${x2 - 6}"/>`
        : `<path class="s-w" d="M${x1} ${y1}H${x2 - 14}V${y2}H${x2 - 6}"/>`;
    s += arrow(x2, y2);
  }
  /* キャリアの出力をまとめる */
  const ys = c.map(cy),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys),
    ym = (y0 + y1) / 2;
  for (const k of c) s += `<path class="s-w n1" d="M${bx(k) + BW} ${cy(k)}H${BUS}"/>`;
  if (y1 > y0) s += `<path class="s-w n1" d="M${BUS} ${y0}V${y1}"/>`;
  s += `<path class="s-w n1" d="M${BUS} ${ym}H${BUS + 22}"/>${arrow(BUS + 28, ym, true)}`;
  s += `<text class="d-out" x="${BUS + 32}" y="${ym + 4}">OUT</text>`;
  /* OP1 の帰還 */
  const fx = bx(0),
    fy = cy(0),
    ft = fy - BH / 2 - 12;
  s += `<path class="s-w d-fb${fb ? '' : ' off'}" d="M${fx + BW} ${fy}H${fx + BW + 8}V${ft}H${fx - 10}V${fy}H${fx - 6}"/>${arrow(fx, fy)}`;
  s += `<text class="d-fbt" x="${fx + BW / 2}" y="${ft - 5}" text-anchor="middle">FB ${FB_LABEL[fb]}</text>`;
  /* 箱 */
  for (let k = 0; k < 4; k++) {
    const x = bx(k),
      y = cy(k) - BH / 2;
    s += `<rect class="s-ic${c.includes(k) ? ' d-car' : ''}" x="${x}" y="${y}" width="${BW}" height="${BH}" rx="2"/>`;
    s += `<text class="d-op" x="${x + BW / 2}" y="${y + BH / 2 + 5}" text-anchor="middle">OP${k + 1}</text>`;
    if (notes) s += `<text class="s-t" x="${x + BW / 2}" y="${y + BH + 14}" text-anchor="middle">${notes[k]}</text>`;
  }
  /* 使う列だけを左右の中央にそろえる（左端は帰還の輪、右端は OUT の文字） */
  const left = X0 + Math.min(...P.map(([col]) => col)) * PX - 12,
    right = BUS + 58,
    dx = Math.round((DW - (right - left)) / 2 - left);
  return dx ? `<g transform="translate(${dx} 0)">${s}</g>` : s;
}

/** 読み上げ用の結線の説明（「OP1 → OP2 → OP3 → OP4 → 出力」など） */
export function algText(alg: number): string {
  const { e, c } = ALGS[alg];
  const into = (k: number) =>
    e
      .filter(([, t]) => t === k)
      .map(([j]) => `OP${j + 1}`)
      .join('と');
  const parts: string[] = [];
  for (let k = 0; k < 4; k++) {
    const from = into(k);
    if (from) parts.push(`${from}が OP${k + 1} を変調`);
  }
  parts.push(`${c.map((k) => `OP${k + 1}`).join('・')}を出力`);
  return `アルゴリズム ${alg}: ${parts.join('、')}`;
}

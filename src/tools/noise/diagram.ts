/**
 * シフトレジスタの図（SVG の文字列。DOM に依存しない）: 左がビット n−1、右がビット 0。
 * フィボナッチ形は上の帰還線でタップを排他的論理和し、ガロア形は下の線から途中のビットへ足す。
 * 下に、出力（ビット 0）の直近の列を右を新しく描く
 */
import { type LfsrCfg, tapBits } from './lfsr';

export const DW = 480,
  DH = 152;
/** レジスタの段の位置と大きさ */
const X0 = 30,
  OUT_W = 64,
  CY = 46,
  CH = 26;
/** 出力の列の段 */
const HY = 120,
  HH = 18;
/** 出力の列に描く数 */
export const HIST = 64;

export const cellW = (n: number): number => Math.min(36, (DW - X0 - OUT_W) / n);
/** ビット i の左端 */
const cx = (n: number, i: number) => X0 + (n - 1 - i) * cellW(n);

/** ⊕（排他的論理和） */
const xor = (x: number, y: number, r = 5) =>
  `<circle class="d-x" cx="${x.toFixed(1)}" cy="${y}" r="${r}"/><path class="d-x" d="M${(x - r).toFixed(1)} ${y}h${2 * r}M${x.toFixed(1)} ${y - r}v${2 * r}"/>`;

/**
 * 図の静的な部分（枠・タップ・帰還線・ビットの番号）と、押せるビットの枠。ビットの値は id="lf-bits" に入れる。
 * 押せるビットは data-b に番号（ビット 0 はフィボナッチ形、ビット n−1 はガロア形で押せない）
 */
export function frameSvg(c: LfsrCfg): string {
  const n = c.n,
    w = cellW(n),
    taps = tapBits(c),
    fib = c.form === 'fib',
    xr = X0 + n * w,
    gate = c.xnor ? 'XNOR' : 'XOR';
  let s = '',
    hit = '',
    /* ガロア形の ⊕ はビットの間に置くので、ビットの値より後に描く */
    gx = '';
  /* 帰還線 */
  if (fib) {
    const by = 14;
    let first = true,
      d = '';
    for (let i = 0; i < n; i++) {
      if (!((taps >>> i) & 1)) continue;
      const x = cx(n, i) + w / 2;
      d += `M${x.toFixed(1)} ${CY}V${by}`;
      if (!first) s += xor(x, by);
      first = false;
    }
    const xs = cx(n, 0) + w / 2;
    d += `M${xs.toFixed(1)} ${by}H${X0 - 16}V${CY + CH / 2}H${X0 - 1}`;
    s = `<path class="d-fb" d="${d}"/>${s}<path class="d-ah" d="M${X0 - 1} ${CY + CH / 2}l-6 -4v8Z"/><text class="d-g" x="${X0 - 18}" y="${by - 5}">${gate}</text>`;
  } else {
    const by = CY + CH + 22;
    let d = `M${xr} ${CY + CH / 2}H${xr + 10}V${by}H${X0 - 16}V${CY + CH / 2}H${X0 - 1}`;
    for (let i = 0; i < n - 1; i++) {
      if (!((taps >>> i) & 1)) continue;
      const x = cx(n, i);
      d += `M${x.toFixed(1)} ${by}V${CY + CH / 2 + 5}`;
      gx += xor(x, CY + CH / 2);
    }
    s = `<path class="d-fb" d="${d}"/>${s}<path class="d-ah" d="M${X0 - 1} ${CY + CH / 2}l-6 -4v8Z"/><text class="d-g" x="${X0 - 18}" y="${by + 14}">${gate}</text>`;
  }
  /* ビットの枠と番号 */
  const every = w >= 18 ? 1 : w >= 10 ? 4 : 8;
  for (let i = 0; i < n; i++) {
    const x = cx(n, i),
      tap = (taps >>> i) & 1,
      can = fib ? i >= 1 : i <= n - 2;
    s += `<rect class="d-c${tap ? ' tap' : ''}" x="${x.toFixed(1)}" y="${CY}" width="${w.toFixed(1)}" height="${CH}"/>`;
    if (i % every === 0 || i === n - 1)
      s += `<text class="d-n" x="${(x + w / 2).toFixed(1)}" y="${CY + CH + 12}" text-anchor="middle">${i}</text>`;
    if (can)
      hit += `<rect class="d-hit" data-b="${i}" x="${x.toFixed(1)}" y="${CY - 4}" width="${w.toFixed(1)}" height="${CH + 8}" tabindex="0" role="button" aria-pressed="${tap ? 'true' : 'false'}" aria-label="ビット ${i} のタップ"/>`;
  }
  /* 出力 */
  s += `<path class="d-o" d="M${xr} ${CY + CH / 2}H${xr + 26}"/><path class="d-ah n1" d="M${xr + 32} ${CY + CH / 2}l-7 -4v8Z"/><text class="d-g" x="${xr + 36}" y="${CY + CH / 2 + 4}">OUT</text>`;
  s += `<text class="d-n" x="${X0 - 18}" y="${HY + HH / 2 + 4}">OUT</text><path class="d-gl" d="M${X0} ${HY + HH / 2}H${DW - 8}"/>`;
  return `${s}<g id="lf-bits"></g>${gx}<path class="d-h" id="lf-hist"/>${hit}`;
}

/** ビットの値（1 は塗る）。新しく入ったビット n−1 に印 */
export function bitsSvg(c: LfsrCfg, state: number, fresh: boolean): string {
  const n = c.n,
    w = cellW(n),
    big = w >= 14;
  let s = '';
  for (let i = 0; i < n; i++) {
    const b = (state >>> i) & 1,
      x = cx(n, i);
    if (b)
      s += `<rect class="d-1" x="${(x + 2).toFixed(1)}" y="${CY + 2}" width="${(w - 4).toFixed(1)}" height="${CH - 4}"/>`;
    if (big)
      s += `<text class="d-v${b ? ' on' : ''}" x="${(x + w / 2).toFixed(1)}" y="${CY + CH / 2 + 5}" text-anchor="middle" style="font-size:${Math.min(14, w * 0.6).toFixed(1)}px">${b}</text>`;
  }
  if (fresh)
    s += `<rect class="d-new" x="${(cx(n, n - 1) + 1).toFixed(1)}" y="${CY + 1}" width="${(w - 2).toFixed(1)}" height="${CH - 2}"/>`;
  return s;
}

/** 出力の列（ビット 0 が 0 を上、1 を下。右端が今の出力） */
export function histPath(outs: readonly number[]): string {
  const k = (DW - 8 - X0) / HIST,
    y = (b: number) => (b ? HY + HH : HY);
  let d = '';
  outs.forEach((b, j) => {
    const x0 = X0 + (HIST - outs.length + j) * k;
    d += `${d ? 'L' : 'M'}${x0.toFixed(1)} ${y(b)}H${(x0 + k).toFixed(1)}`;
  });
  return d;
}

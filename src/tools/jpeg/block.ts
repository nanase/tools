/** 選んだブロックの途中の値（表示用）: 標本・DCT 係数・量子化・ジグザグ順・記号とビット列・復号した画素 */
import { dequantIdct, fdct, toSample } from './dct';
import type { Encoded } from './encoder';
import { prevBlock } from './encoder';
import { blockSymbols, type Sym } from './entropy';
import { buildCodes } from './huffman';
import { ZIGZAG } from './tables';

export interface BlockInfo {
  /** 成分の番号（0: Y、1: Cb、2: Cr） */
  ci: number;
  /** 成分の中のブロックの位置 */
  bx: number;
  by: number;
  /** 標本（自然順） */
  px: Uint8Array;
  /** DCT 係数 F(u, v) */
  F: Float64Array;
  /** 量子化テーブル */
  Q: Uint8Array;
  /** 量子化した係数 */
  S: Int16Array;
  /** 逆量子化と逆 DCT で戻した画素（0〜255 に丸めたもの） */
  rec: Uint8Array;
  /** DC の予測値（走査の順で 1 つ前の同じ成分のブロックの DC。先頭なら 0） */
  pred: number;
  syms: Sym[];
  bits: number;
  /** 0 でない係数の数と、ジグザグ順で最後の 0 でない係数の位置（なければ -1） */
  nz: number;
  last: number;
}

/** Y のブロック (ybx, yby) を含む、成分 ci のブロックの位置 */
export function compBlock(e: Encoded, ci: number, ybx: number, yby: number): [number, number] {
  const c = e.comps[ci];
  return [Math.floor((ybx * c.h) / e.hmax), Math.floor((yby * c.v) / e.vmax)];
}

export function blockInfo(e: Encoded, ci: number, bx: number, by: number): BlockInfo {
  const c = e.comps[ci],
    b = by * c.bw + bx,
    px = new Uint8Array(64);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) px[y * 8 + x] = c.plane.d[(by * 8 + y) * c.plane.w + bx * 8 + x];
  const F = fdct(Array.from(px, (v) => v - 128)),
    Q = e.qt[c.t],
    S = c.coef.slice(b * 64, b * 64 + 64),
    r = dequantIdct(S, Q),
    rec = Uint8Array.from(r, toSample);
  const pb = prevBlock(c, e.mx, bx, by),
    pred = pb < 0 ? 0 : c.coef[pb * 64];
  const syms = blockSymbols(S, pred, buildCodes(e.dc[c.t]), buildCodes(e.ac[c.t]));
  let nz = 0,
    last = -1;
  for (let k = 0; k < 64; k++)
    if (S[ZIGZAG[k]] !== 0) {
      nz++;
      last = k;
    }
  return { ci, bx, by, px, F, Q, S, rec, pred, syms, bits: c.bits[b], nz, last };
}

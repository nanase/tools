/**
 * 量子化した係数のブロックを記号にする（T.81 F.1.2）: DC は前のブロックとの差分の大きさの区分 SSSS と付加ビット、
 * AC はジグザグ順で 0 の続く数（ラン）と次の値の SSSS をまとめた RRRRSSSS と付加ビット。
 * 16 個以上の 0 は ZRL（0xF0）、最後の 0 でない係数の後は EOB（0x00）
 */
import { bitStr, category, extraBits, type HuffCode } from './huffman';
import { ZIGZAG } from './tables';

/**
 * 記号ごとに呼ぶ関数。dc: DC の記号か、sym: ハフマン符号にする記号（DC は SSSS、AC は RRRRSSSS）、
 * amp: 付加ビットの値、size: 付加ビットの数、k: ジグザグ順の位置（EOB は最後の係数の次）
 */
export type SymFn = (dc: boolean, sym: number, amp: number, size: number, k: number) => void;

/** c[off .. off+63]（自然順）のブロックを記号にする。pred は DC の予測値（前のブロックの DC） */
export function scanBlock(c: ArrayLike<number>, off: number, pred: number, f: SymFn): void {
  const diff = c[off] - pred,
    ds = category(diff);
  f(true, ds, extraBits(diff, ds), ds, 0);
  let run = 0;
  for (let k = 1; k < 64; k++) {
    const v = c[off + ZIGZAG[k]];
    if (v === 0) {
      run++;
      continue;
    }
    while (run > 15) {
      f(false, 0xf0, 0, 0, k - run + 15);
      run -= 16;
    }
    const s = category(v);
    f(false, (run << 4) | s, extraBits(v, s), s, k);
    run = 0;
  }
  if (run > 0) f(false, 0x00, 0, 0, 64 - run);
}

export type SymKind = 'dc' | 'ac' | 'zrl' | 'eob';

/** 表示用の記号 */
export interface Sym {
  kind: SymKind;
  /** ジグザグ順の位置 */
  k: number;
  /** DC は差分、AC は係数の値（ZRL・EOB は 0） */
  val: number;
  run: number;
  size: number;
  sym: number;
  /** ハフマン符号と付加ビット（0 と 1 の文字列） */
  code: string;
  extra: string;
}

/** ブロックの記号とビット列（表示用）。dcT・acT はこの成分のハフマン符号 */
export function blockSymbols(c: ArrayLike<number>, pred: number, dcT: HuffCode, acT: HuffCode): Sym[] {
  const out: Sym[] = [];
  scanBlock(c, 0, pred, (dc, sym, amp, size, k) => {
    const T = dc ? dcT : acT,
      kind: SymKind = dc ? 'dc' : sym === 0xf0 ? 'zrl' : sym === 0 ? 'eob' : 'ac';
    out.push({
      kind,
      k,
      val: dc ? c[0] - pred : kind === 'ac' ? c[ZIGZAG[k]] : 0,
      run: dc ? 0 : sym >> 4,
      size: dc ? sym : sym & 15,
      sym,
      code: bitStr(T.code[sym], T.len[sym]),
      extra: bitStr(amp, size),
    });
  });
  return out;
}

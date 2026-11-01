/**
 * バイト列を壊す操作。元の列は変えず、新しい列を返す
 */

export type Op =
  /** 1 ビットを反転する */
  | { kind: 'flip'; pos: number; bit: number }
  /** 1 バイトを書き換える */
  | { kind: 'set'; pos: number; value: number }
  /** 1 バイトを消す */
  | { kind: 'del'; pos: number }
  /** 1 バイトを挟む */
  | { kind: 'ins'; pos: number; value: number }
  /** pos から後ろを切り捨てる */
  | { kind: 'cut'; pos: number };

/** 操作を順に当てる。位置は当てる時点の列の位置。範囲の外は無視する */
export function applyOps(src: Uint8Array, ops: readonly Op[]): Uint8Array {
  let b = src.slice();
  for (const o of ops) {
    if (o.pos < 0 || o.pos > b.length || (o.pos === b.length && o.kind !== 'ins')) continue;
    if (o.kind === 'cut') b = b.slice(0, o.pos);
    else if (o.kind === 'flip') b[o.pos] ^= 1 << (o.bit & 7);
    else if (o.kind === 'set') b[o.pos] = o.value;
    else if (o.kind === 'del') {
      const n = new Uint8Array(b.length - 1);
      n.set(b.subarray(0, o.pos));
      n.set(b.subarray(o.pos + 1), o.pos);
      b = n;
    } else {
      const n = new Uint8Array(b.length + 1);
      n.set(b.subarray(0, o.pos));
      n[o.pos] = o.value;
      n.set(b.subarray(o.pos), o.pos + 1);
      b = n;
    }
  }
  return b;
}

/** 種から決まる乱数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [start, end) の中を n か所、種から決まる位置で 1 ビットずつ反転する操作 */
export function randomFlips(start: number, end: number, n: number, seed: number): Op[] {
  const r = rng(seed),
    ops: Op[] = [];
  for (let i = 0; i < n; i++)
    ops.push({ kind: 'flip', pos: start + Math.floor(r() * (end - start)), bit: Math.floor(r() * 8) });
  return ops;
}

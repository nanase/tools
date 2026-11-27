/**
 * 4 ビット CPU の命令とプログラムと実行。1 語は 8 ビットで、上の 3 ビットが種類、次の 1 ビットが A か B、下の 4 ビットが数。
 * レジスタ・PC・入力・出力は 4 ビット。足し算は A+B の 1 通りで、桁上げ（C）を書き換えるのは加算だけ。
 * 条件ジャンプは C = 0 のときだけ飛ぶ。1 クロックで 1 命令を実行する
 */

export type OpKey = 'ldi' | 'add' | 'in' | 'out' | 'mov' | 'hlt' | 'jmp' | 'jnc';
/** 値の出どころと行き先: n は命令の数、alu は A+B */
export type Port = 'n' | 'alu' | 'in' | 'A' | 'B' | 'out' | 'pc';
export type Reg = 'A' | 'B';

/** 命令 8 種（並びが種類のビットの値）。g は働きの短い札 */
export const OPS: readonly { k: OpKey; nm: string; g: string }[] = [
  { k: 'ldi', nm: '転送', g: '数 → A・B' },
  { k: 'add', nm: '加算', g: 'A+B → A・B' },
  { k: 'in', nm: '入力', g: '入力 → A・B' },
  { k: 'out', nm: '出力', g: 'A・B → 出力' },
  { k: 'mov', nm: '転送', g: 'B → A・A → B' },
  { k: 'hlt', nm: '停止', g: 'PC はそのまま' },
  { k: 'jmp', nm: 'ジャンプ', g: '数 → PC' },
  { k: 'jnc', nm: '条件ジャンプ', g: 'C=0 で数 → PC' },
];
const RN: readonly Reg[] = ['A', 'B'];
const OPI = Object.fromEntries(OPS.map((o, i) => [o.k, i])) as Record<OpKey, number>;
/** A・B のビットを使う命令と、数を使う命令 */
export const USES_R: readonly OpKey[] = ['ldi', 'add', 'in', 'out', 'mov'];
export const USES_N: readonly OpKey[] = ['ldi', 'jmp', 'jnc'];

export interface Decoded {
  b: number;
  op: number;
  r: number;
  n: number;
  k: OpKey;
  nm: string;
  src: Port | null;
  dst: Port | null;
  R: Reg;
}

/** 命令の 1 語を読み解く */
export function dec(b: number): Decoded {
  const op = (b >> 5) & 7,
    r = (b >> 4) & 1,
    n = b & 15,
    R = RN[r],
    O = OPS[op];
  let src: Port | null = null,
    dst: Port | null = null;
  if (O.k === 'ldi') [src, dst] = ['n', R];
  else if (O.k === 'add') [src, dst] = ['alu', R];
  else if (O.k === 'in') [src, dst] = ['in', R];
  else if (O.k === 'out') [src, dst] = [R, 'out'];
  else if (O.k === 'mov') [src, dst] = [RN[1 - r], R];
  else if (O.k === 'jmp' || O.k === 'jnc') [src, dst] = ['n', 'pc'];
  return { b, op, r, n, k: O.k, nm: O.nm, src, dst, R };
}

const NM: Record<Port, string> = { n: '数', alu: 'A+B', in: '入力', A: 'A', B: 'B', out: '出力', pc: 'PC' };

/** 命令の札（どこから → どこへ）。停止は空 */
export function chip(d: Decoded): string {
  if (d.k === 'hlt' || !d.src || !d.dst) return '';
  const t = `${d.src === 'n' ? String(d.n) : NM[d.src]} → ${NM[d.dst]}`;
  return d.k === 'jnc' ? `C=0 で ${t}` : t;
}

/** 命令の 1 語を組む */
export const enc = (k: OpKey, r: Reg | 0 = 0, n = 0): number => (OPI[k] << 5) | ((r === 'B' ? 1 : 0) << 4) | (n & 15);
export const HLT = enc('hlt');

type Line = readonly [OpKey, (Reg | 0)?, number?];
export interface Prog {
  id: string;
  nm: string;
  /** 名前の後ろの小さな補足 */
  sub?: string;
  /** 入力の初めの値 */
  inp: number;
  code: readonly Line[];
}

/** プログラム 6 本。使わない行は停止で埋める */
export const PROGS: readonly Prog[] = [
  {
    id: 'flow',
    nm: 'LED を流す',
    inp: 0,
    code: [
      ['ldi', 'A', 1],
      ['out', 'A'],
      ['mov', 'B'],
      ['add', 'A'],
      ['jnc', 0, 1],
      ['jmp', 0, 0],
    ],
  },
  {
    id: 'count',
    nm: '数える',
    inp: 0,
    code: [
      ['ldi', 'B', 1],
      ['ldi', 'A', 0],
      ['out', 'A'],
      ['add', 'A'],
      ['jnc', 0, 2],
      ['jmp', 0, 1],
    ],
  },
  {
    id: 'timer',
    nm: 'タイマ',
    inp: 6,
    code: [
      ['ldi', 'B', 15],
      ['in', 'A'],
      ['out', 'A'],
      ['add', 'A'],
      ['jnc', 0, 6],
      ['jmp', 0, 2],
      ['ldi', 'A', 15],
      ['out', 'A'],
      ['hlt'],
    ],
  },
  {
    id: 'add',
    nm: '足し算',
    sub: '入力+3',
    inp: 5,
    code: [
      ['ldi', 'B', 3],
      ['in', 'A'],
      ['add', 'A'],
      ['out', 'A'],
      ['jmp', 0, 1],
    ],
  },
  {
    id: 'mul',
    nm: 'かけ算',
    sub: '入力×4',
    inp: 3,
    code: [
      ['ldi', 'A', 0],
      ['in', 'B'],
      ['add', 'A'],
      ['out', 'A'],
      ['add', 'A'],
      ['out', 'A'],
      ['add', 'A'],
      ['out', 'A'],
      ['add', 'A'],
      ['out', 'A'],
      ['hlt'],
    ],
  },
  {
    id: 'fib',
    nm: 'フィボナッチ数',
    inp: 0,
    code: [
      ['ldi', 'A', 0],
      ['ldi', 'B', 1],
      ['out', 'B'],
      ['add', 'A'],
      ['jnc', 0, 6],
      ['jmp', 0, 0],
      ['out', 'A'],
      ['add', 'B'],
      ['jnc', 0, 2],
      ['jmp', 0, 0],
    ],
  },
];
export const PROG: Record<string, Prog> = Object.fromEntries(PROGS.map((p) => [p.id, p]));
export const DEF_PROG = 'flow';

/** プログラムを ROM の 16 行にする */
export function romOf(p: Prog): number[] {
  const r = new Array<number>(16).fill(HLT);
  p.code.forEach(([k, reg, n], i) => {
    r[i] = enc(k, reg ?? 0, n ?? 0);
  });
  return r;
}

export interface Cpu {
  rom: number[];
  pc: number;
  A: number;
  B: number;
  C: number;
  out: number;
  inp: number;
  halt: boolean;
  /** 実行したクロックの数 */
  clk: number;
}
export const makeCpu = (rom: readonly number[], inp = 0): Cpu => ({
  rom: rom.slice(),
  pc: 0,
  A: 0,
  B: 0,
  C: 0,
  out: 0,
  inp,
  halt: false,
  clk: 0,
});

/** 表示する値（ある時点の写し）。ir は PC の指す行の命令 */
export interface Snap {
  pc: number;
  A: number;
  B: number;
  C: number;
  out: number;
  ir: number;
}
export const snap = (m: Cpu): Snap => ({ pc: m.pc, A: m.A, B: m.B, C: m.C, out: m.out, ir: m.rom[m.pc] });

/** 1 命令の実行の記録: 読んだ行・何がどこからどこへ動いたか・ジャンプしたか・加算の前の値 */
export interface Exec {
  pc: number;
  d: Decoded;
  src: Port | null;
  dst: Port | null;
  val: number;
  /** 条件ジャンプで飛んだか（C=1 で飛ばなかったら false） */
  taken: boolean;
  next: number;
  /** 加算の和（桁上げの前、0〜30） */
  sum: number;
  A0: number;
  B0: number;
}

/** 1 命令を実行する */
export function step(m: Cpu): Exec {
  const pc = m.pc,
    d = dec(m.rom[pc]);
  const e: Exec = {
    pc,
    d,
    src: d.src,
    dst: d.dst,
    val: 0,
    taken: true,
    next: (pc + 1) & 15,
    sum: m.A + m.B,
    A0: m.A,
    B0: m.B,
  };
  if (d.k === 'hlt') {
    e.next = pc;
    m.halt = true;
  } else if (d.k === 'jnc' && m.C) {
    e.taken = false;
    e.src = e.dst = null;
  } else {
    const s = d.src as Port;
    e.val = s === 'n' ? d.n : s === 'in' ? m.inp : s === 'alu' ? e.sum & 15 : m[s as Reg];
    if (d.k === 'add') m.C = e.sum > 15 ? 1 : 0;
    if (d.dst === 'pc') e.next = e.val;
    else if (d.dst === 'out') m.out = e.val;
    else m[d.dst as Reg] = e.val;
  }
  m.pc = e.next;
  m.clk++;
  return e;
}

/** 値を n ビットの 0・1 の並びに（上の桁から） */
export const bits = (v: number, n = 4): number[] => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1);
export const b4 = (v: number): string => bits(v).join('');

/** 試しに動かして、出力が書き換わった値を順に返す（テストと説明用）。停止したら止める */
export function outputs(rom: readonly number[], inp: number, clocks: number): number[] {
  const m = makeCpu(rom, inp),
    o: number[] = [];
  for (let i = 0; i < clocks && !m.halt; i++) {
    const e = step(m);
    if (e.dst === 'out') o.push(e.val);
  }
  return o;
}

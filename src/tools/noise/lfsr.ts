/**
 * 線形帰還シフトレジスタ（DOM に依存しない）: 1 クロックの動き、周期、多項式が原始多項式かの判定、
 * 最大周期のタップの表、実在の音源のプリセット。
 *
 * ビットは右（ビット 0）から数え、クロックごとに右へずらす。出力はビット 0。
 * 帰還の多項式 P(x) = xⁿ + Σ_{e∈E} xᵉ + 1 の中間の項の指数 E（1〜n−1）をビットの集合 exps で持つ（ビット e が xᵉ）。
 * - フィボナッチ形: ビット 0 と、E のビットの排他的論理和をビット n−1 に入れる
 * - ガロア形: ビット 0 をビット n−1 に入れ、E の各 e についてビット e−1 に排他的論理和で足す
 * どちらも P(x) が原始多項式なら、周期は 2ⁿ−1（XOR ではすべて 0、XNOR ではすべて 1 の状態を除く）
 */

export type Form = 'fib' | 'gal';

export interface LfsrCfg {
  /** ビット長（2〜32） */
  n: number;
  /** 多項式の中間の項（ビット e が xᵉ、1 ≤ e ≤ n−1） */
  exps: number;
  form: Form;
  /** 帰還を XNOR にする（XOR の否定） */
  xnor: boolean;
  /** 初期値 */
  init: number;
}

export const NMIN = 2,
  NMAX = 32;
/** n ビットの全ビット */
export const full = (n: number): number => (n >= 32 ? 0xffffffff : 2 ** n - 1);

/** 32 ビットの偶奇（1 の数が奇数なら 1） */
export function parity(v: number): number {
  let x = v >>> 0;
  x ^= x >>> 16;
  x ^= x >>> 8;
  x ^= x >>> 4;
  return (0x6996 >>> (x & 15)) & 1;
}

/** 1 クロックの状態の移り（s → s'） */
export function stepper(c: LfsrCfg): (s: number) => number {
  const n = c.n,
    ex = (c.exps >>> 0) & full(n) & ~1,
    top = n - 1;
  if (c.form === 'fib') {
    const tap = (ex | 1) >>> 0,
      x = c.xnor ? 1 : 0;
    return (s) => ((s >>> 1) | ((parity(s & tap) ^ x) << top)) >>> 0;
  }
  /* ガロア: 出力（ビット 0）が 1 ならマスクを足す。XNOR はマスクの中間のビットを反転する */
  const m = ((ex >>> 1) | (1 << top)) >>> 0,
    xm = c.xnor ? (ex >>> 1) >>> 0 : 0;
  return (s) => (((s >>> 1) ^ (s & 1 ? m : 0) ^ xm) >>> 0) >>> 0;
}

/** タップの位置（図の印）: フィボナッチは読み出すビット、ガロアは排他的論理和を足すビット */
export function tapBits(c: LfsrCfg): number {
  const ex = (c.exps >>> 0) & full(c.n) & ~1;
  return c.form === 'fib' ? (ex | 1) >>> 0 : ((ex >>> 1) | (1 << (c.n - 1))) >>> 0;
}
/** 図のビット i を押したときに入れ切りする項の指数（変えられないビットは 0） */
export function expOfBit(c: LfsrCfg, i: number): number {
  if (c.form === 'fib') return i >= 1 && i <= c.n - 1 ? i : 0;
  return i >= 0 && i <= c.n - 2 ? i + 1 : 0;
}

/** 止まったままの状態（XOR ではすべて 0、XNOR ではすべて 1） */
export const lockState = (c: LfsrCfg): number => (c.xnor ? full(c.n) : 0);

export interface Cycle {
  /** 周期（クロックの回数） */
  period: number;
  /** 1 周期のうちビット 0 が 1 だった回数 */
  ones: number;
}
/** 初期値から状態が戻るまで回す。cap 回で戻らなければ null */
export function cycle(c: LfsrCfg, cap: number): Cycle | null {
  const f = stepper(c),
    s0 = (c.init >>> 0) & full(c.n);
  let s = s0,
    ones = 0;
  for (let k = 1; k <= cap; k++) {
    ones += s & 1;
    s = f(s);
    if (s === s0) return { period: k, ones };
  }
  return null;
}

/* ---------- GF(2) の多項式（ビット i が xⁱ） ---------- */
const deg = (a: bigint): number => a.toString(2).length - 1;
function pmod(a: bigint, p: bigint): bigint {
  const dp = deg(p);
  let r = a;
  for (let d = deg(r); r !== 0n && d >= dp; d = deg(r)) r ^= p << BigInt(d - dp);
  return r;
}
function pmulmod(a: bigint, b: bigint, p: bigint): bigint {
  let r = 0n,
    x = a,
    y = b;
  while (y) {
    if (y & 1n) r ^= x;
    y >>= 1n;
    x <<= 1n;
  }
  return pmod(r, p);
}
function ppow(base: bigint, e: bigint, p: bigint): bigint {
  let r = 1n,
    b = pmod(base, p),
    k = e;
  while (k > 0n) {
    if (k & 1n) r = pmulmod(r, b, p);
    b = pmulmod(b, b, p);
    k >>= 1n;
  }
  return r;
}
function pgcd(a: bigint, b: bigint): bigint {
  let x = a,
    y = b;
  while (y) [x, y] = [y, pmod(x, y)];
  return x;
}
/** 素因数（重複なし） */
export function primes(v: number): number[] {
  const out: number[] = [];
  let m = v;
  for (let q = 2; q * q <= m; q++)
    if (m % q === 0) {
      out.push(q);
      while (m % q === 0) m /= q;
    }
  if (m > 1) out.push(m);
  return out;
}

/** 帰還の多項式 P(x) */
export const polyOf = (c: Pick<LfsrCfg, 'n' | 'exps'>): bigint =>
  (1n << BigInt(c.n)) | BigInt((c.exps >>> 0) & full(c.n) & ~1) | 1n;

/** P(x) が既約か（Rabin の判定） */
export function irreducible(p: bigint): boolean {
  const n = deg(p),
    x = 2n,
    xq = (k: number) => ppow(x, 1n << BigInt(k), p);
  if (xq(n) !== pmod(x, p)) return false;
  return primes(n).every((q) => pgcd(xq(n / q) ^ pmod(x, p), p) === 1n);
}

/** 既約な P(x) を法とする x の位数（どの 0 でない状態の周期もこれ）。既約でなければ null */
export function orderOfX(p: bigint): number | null {
  if (!irreducible(p)) return null;
  const n = deg(p),
    M = 2 ** n - 1;
  let ord = M;
  for (const q of primes(M)) while (ord % q === 0 && ppow(2n, BigInt(ord / q), p) === 1n) ord /= q;
  return ord;
}

/** 原始多項式か（周期が 2ⁿ−1 になるか） */
export const primitive = (p: bigint): boolean => orderOfX(p) === 2 ** deg(p) - 1;

/** 総当たりで周期を求めるビット長の上限と、既約でないときに回す上限 */
export const BRUTE_N = 20,
  CAP = 1 << 24;

export interface Period {
  /** 周期（クロックの回数）。求められなければ null */
  period: number | null;
  /** 1 周期の出力の平均（ビット 0 が 0 を +1、1 を −1 とする）。分からなければ 0 */
  mean: number;
  /** P(x) が原始多項式か */
  prim: boolean;
  /** 止まったままの状態から始めたか */
  locked: boolean;
}
/** 初期値から始めたときの周期 */
export function periodOf(c: LfsrCfg): Period {
  const p = polyOf(c),
    prim = primitive(p),
    init = (c.init >>> 0) & full(c.n),
    locked = init === lockState(c),
    fromCycle = (cy: Cycle | null): Period =>
      cy
        ? { period: cy.period, mean: (cy.period - 2 * cy.ones) / cy.period, prim, locked }
        : { period: null, mean: 0, prim, locked };
  if (c.n <= BRUTE_N) return fromCycle(cycle(c, 2 ** c.n));
  if (locked) return fromCycle(cycle(c, 1));
  const ord = orderOfX(p);
  /* 既約なら、止まった状態以外の周期は x の位数。出力の平均は周期が長いので 0 とみる */
  if (ord !== null) return { period: ord, mean: 0, prim, locked };
  return fromCycle(cycle(c, CAP));
}

/* ---------- 最大周期のタップの表 ---------- */
/**
 * ビット長ごとの原始多項式の中間の項の指数。3〜32 は Xilinx XAPP052（Alfke 1996）の表 3 のタップ
 * （n, a, b, c は P(x) = xⁿ + xᵃ + xᵇ + xᶜ + 1）。2 は x² + x + 1
 */
export const TAPS: Record<number, readonly number[]> = {
  2: [1],
  3: [2],
  4: [3],
  5: [3],
  6: [5],
  7: [6],
  8: [6, 5, 4],
  9: [5],
  10: [7],
  11: [9],
  12: [6, 4, 1],
  13: [4, 3, 1],
  14: [5, 3, 1],
  15: [14],
  16: [15, 13, 4],
  17: [14],
  18: [11],
  19: [6, 2, 1],
  20: [17],
  21: [19],
  22: [21],
  23: [18],
  24: [23, 22, 17],
  25: [22],
  26: [6, 2, 1],
  27: [5, 2, 1],
  28: [25],
  29: [27],
  30: [6, 4, 1],
  31: [28],
  32: [22, 2, 1],
};
export const expsOf = (L: readonly number[]): number => L.reduce((m, e) => (m | (1 << e)) >>> 0, 0);
/** 表の多項式の中間の項 */
export const tableExps = (n: number): number => expsOf(TAPS[n] ?? []);
/** 指数の並び（大きい順） */
export const expList = (exps: number): number[] => {
  const L: number[] = [];
  for (let e = 31; e >= 1; e--) if ((exps >>> e) & 1) L.push(e);
  return L;
};

/* ---------- 実在の音源 ---------- */
export interface Preset {
  v: string;
  /** ボタンの表示 */
  l: string;
  /** 補足（ボタンの title） */
  t: string;
  c: LfsrCfg;
  /** クロック周波数（Hz） */
  clk: number;
}
/** NES（NTSC）の CPU のクロックと、ノイズの周期の設定（CPU のサイクル数）の例 */
export const NES_CPU = 1789773,
  NES_DIV = 202;
/** ゲームボーイの 262144 Hz を割る数（r = 1、s = 5） */
export const GB_CLK = 262144 / 32;
/** SN76489 の入力クロック（3.579545 MHz）を 512 で割ったシフトの速さ */
export const SN_CLK = 3579545 / 512;

export const PRESETS: readonly Preset[] = [
  {
    v: 'nes',
    l: 'NES',
    t: 'ファミコン（NES）の APU のノイズ。15 ビット、ビット 0 と 1 の XOR、初期値 1。クロックは NTSC の CPU（1.789773 MHz）÷ 202',
    c: { n: 15, exps: expsOf([1]), form: 'fib', xnor: false, init: 1 },
    clk: NES_CPU / NES_DIV,
  },
  {
    v: 'nes93',
    l: 'NES 短周期',
    t: 'NES のノイズの短周期モード。帰還をビット 1 からビット 6 に変え、初期値 1 から 93 ステップで繰り返す（31 ステップの輪もある）',
    c: { n: 15, exps: expsOf([6]), form: 'fib', xnor: false, init: 1 },
    clk: NES_CPU / NES_DIV,
  },
  {
    v: 'gb15',
    l: 'GB 15 ビット',
    t: 'ゲームボーイのチャンネル 4。15 ビット、ビット 0 と 1 の XNOR、初期値 0。クロックは 262144 Hz ÷ (1 × 2⁵)',
    c: { n: 15, exps: expsOf([1]), form: 'fib', xnor: true, init: 0 },
    clk: GB_CLK,
  },
  {
    v: 'gb7',
    l: 'GB 7 ビット',
    t: 'ゲームボーイのチャンネル 4 の 7 ビットのモード。帰還をビット 7 にも入れるので、下位 7 ビットが 127 ステップで繰り返す',
    c: { n: 7, exps: expsOf([1]), form: 'fib', xnor: true, init: 0 },
    clk: GB_CLK,
  },
  {
    v: 'sn',
    l: 'SN76489',
    t: 'TI の SN76489 のホワイトノイズ。15 ビット、ビット 0 と 1 の XOR、初期値 0x4000。クロックは 3.579545 MHz ÷ 512',
    c: { n: 15, exps: expsOf([1]), form: 'fib', xnor: false, init: 0x4000 },
    clk: SN_CLK,
  },
  {
    v: 'sega',
    l: 'SN76489 セガ',
    t: 'セガ・マスターシステムなどの VDP に入った SN76489 互換の音源。16 ビット、ビット 0 と 3 の XOR、初期値 0x8000。原始多項式ではなく、周期は 57337',
    c: { n: 16, exps: expsOf([3]), form: 'fib', xnor: false, init: 0x8000 },
    clk: SN_CLK,
  },
  {
    v: 'snp',
    l: 'SN76489 周期',
    t: 'SN76489 の周期ノイズ。帰還はビット 0 だけで、1 つの 1 が 15 ビットを回り、15 ステップごとのパルスになる',
    c: { n: 15, exps: 0, form: 'fib', xnor: false, init: 0x4000 },
    clk: SN_CLK,
  },
];

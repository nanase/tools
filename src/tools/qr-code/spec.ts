/**
 * QR コード（モデル 2）の型番ごとの数と、機能パターンの置き方。
 * 表の数は公開の解説（Thonky の QR Code Tutorial の誤り訂正の表）と Nayuki の実装（MIT）で照合した
 */
export type Ecc = 'L' | 'M' | 'Q' | 'H';
export const ECCS: readonly Ecc[] = ['L', 'M', 'Q', 'H'];
/** 形式情報に書く 2 ビット */
export const ECC_BITS: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };
/** 直せる符号語のおよその割合（規格の目安） */
export const ECC_RATE: Record<Ecc, number> = { L: 7, M: 15, Q: 25, H: 30 };

/* 型番 1〜40 の、ブロックあたりの誤り訂正語の数とブロックの数（添字 0 は使わない） */
const EC_PER_BLOCK: Record<Ecc, number[]> = {
  L: [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};
const BLOCKS: Record<Ecc, number[]> = {
  L: [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19,
    19, 20, 21, 22, 24, 25,
  ],
  M: [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33,
    35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43,
    45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51,
    54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

export const size = (ver: number): number => 17 + 4 * ver;

/** 位置合わせの模様の中心の座標（行と列に共通）。最後は size − 7、間隔は偶数でそろえる（型番 32 だけ 26） */
export function alignPos(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2,
    last = size(ver) - 7,
    step = ver === 32 ? 26 : Math.ceil((last - 6) / (n - 1) / 2) * 2,
    out = [6];
  for (let i = n - 2; i >= 0; i--) out.push(last - i * step);
  return out;
}

/** 符号語と余りのビットを置けるモジュールの数（機能パターンと形式情報・型番情報を除く） */
export const rawModules = (ver: number): number => frame(ver).order.length;

export interface Blocks {
  /** 符号語の総数 */
  total: number;
  /** データの符号語の数 */
  data: number;
  /** ブロックあたりの誤り訂正語の数 */
  ec: number;
  /** ブロックごとのデータの符号語の数（短いブロックが先） */
  sizes: number[];
}

export function blocks(ver: number, ecc: Ecc): Blocks {
  const total = Math.floor(rawModules(ver) / 8),
    nb = BLOCKS[ecc][ver],
    ec = EC_PER_BLOCK[ecc][ver],
    short = Math.floor(total / nb),
    nLong = total % nb,
    sizes = Array.from({ length: nb }, (_, i) => short - ec + (i >= nb - nLong ? 1 : 0));
  return { total, data: total - nb * ec, ec, sizes };
}

/* ---------- 形式情報と型番情報（BCH 符号） ---------- */
/** BCH 符号の余り（data を bits ビット左へずらして gen で割る） */
function bchRem(data: number, gen: number, bits: number): number {
  const deg = 31 - Math.clz32(gen);
  let r = data << bits;
  for (let i = 31 - Math.clz32(r); i >= deg; i--) if (r & (1 << i)) r ^= gen << (i - deg);
  return r;
}
/** 形式情報の XOR の列（全部 0 の符号を作らないため） */
export const FORMAT_MASK = 0x5412;
export const FORMAT_GEN = 0x537;
export const VERSION_GEN = 0x1f25;
/** 形式情報の 15 ビット（誤り訂正のレベル 2 ビット・マスク 3 ビット・BCH 10 ビット、XOR の後） */
export const formatBits = (ecc: Ecc, mask: number): number => {
  const d = (ECC_BITS[ecc] << 3) | mask;
  return ((d << 10) | bchRem(d, FORMAT_GEN, 10)) ^ FORMAT_MASK;
};
/** 型番情報の 18 ビット（型番 6 ビット・BCH 12 ビット）。型番 7 以上だけ */
export const versionBits = (ver: number): number => (ver << 12) | bchRem(ver, VERSION_GEN, 12);
export const bchFormatRem = (d: number): number => bchRem(d, FORMAT_GEN, 10);

/* ---------- マスク ---------- */
export const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
/** マスクの条件の式（x は列、y は行。HTML） */
export const MASK_TEXT = [
  '(<i>x</i> + <i>y</i>) mod 2 = 0',
  '<i>y</i> mod 2 = 0',
  '<i>x</i> mod 3 = 0',
  '(<i>x</i> + <i>y</i>) mod 3 = 0',
  '(⌊<i>x</i>/3⌋ + ⌊<i>y</i>/2⌋) mod 2 = 0',
  '<i>xy</i> mod 2 + <i>xy</i> mod 3 = 0',
  '(<i>xy</i> mod 2 + <i>xy</i> mod 3) mod 2 = 0',
  '((<i>x</i> + <i>y</i>) mod 2 + <i>xy</i> mod 3) mod 2 = 0',
];

/* ---------- 機能パターンの枠 ---------- */
/** モジュールの役割 */
export const Role = {
  Data: 0,
  Finder: 1,
  Sep: 2,
  Timing: 3,
  Align: 4,
  Format: 5,
  Version: 6,
  Dark: 7,
  /** データの領域のうち、符号語を置いた後に余るビット */
  Rem: 8,
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLE_NAME = [
  'データ',
  'ファインダー',
  '分離帯',
  'タイミング',
  '位置合わせ',
  '形式情報',
  '型番情報',
  '暗いモジュール',
  '余りのビット',
];

export interface Frame {
  ver: number;
  n: number;
  /** 役割（n × n、行ごと） */
  role: Uint8Array;
  /** 機能パターンの色（1 が暗い）。形式情報・型番情報の所は 0 のまま */
  fn: Uint8Array;
  /** データの領域を置く順（ジグザグ）。モジュールの番号 y·n + x */
  order: Int32Array;
}

const frames = new Map<number, Frame>();

/** 型番の機能パターンの枠（データの値に依らない） */
export function frame(ver: number): Frame {
  const hit = frames.get(ver);
  if (hit) return hit;
  const n = size(ver),
    role = new Uint8Array(n * n),
    fn = new Uint8Array(n * n),
    put = (x: number, y: number, r: Role, dark: boolean) => {
      role[y * n + x] = r;
      fn[y * n + x] = dark ? 1 : 0;
    };
  for (let i = 0; i < n; i++) {
    put(6, i, Role.Timing, i % 2 === 0);
    put(i, 6, Role.Timing, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx,
          y = cy + dy,
          d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        put(x, y, d === 4 ? Role.Sep : Role.Finder, d !== 2 && d !== 4);
      }
  const ap = alignPos(ver),
    k = ap.length;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === k - 1) || (i === k - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          put(ap[i] + dx, ap[j] + dy, Role.Align, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  for (const [x, y] of formatCells(n).flat()) put(x, y, Role.Format, false);
  put(8, n - 8, Role.Dark, true);
  if (ver >= 7) for (const [x, y] of versionCells(n).flat()) put(x, y, Role.Version, false);
  /* ジグザグ: 右下から 2 列ずつ、上・下に折り返す。縦のタイミングの列（x = 6）は飛ばす */
  const order: number[] = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let v = 0; v < n; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          y = up ? n - 1 - v : v;
        if (role[y * n + x] === Role.Data) order.push(y * n + x);
      }
  }
  const f: Frame = { ver, n, role, fn, order: Int32Array.from(order) };
  frames.set(ver, f);
  return f;
}

/** 形式情報の 2 か所の座標 [x, y]。添字 i がビット i（最下位が 0） */
export function formatCells(n: number): [[number, number][], [number, number][]] {
  const a: [number, number][] = [],
    b: [number, number][] = [];
  for (let i = 0; i < 6; i++) a.push([8, i]);
  a.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) a.push([14 - i, 8]);
  for (let i = 0; i < 8; i++) b.push([n - 1 - i, 8]);
  for (let i = 8; i < 15; i++) b.push([8, n - 15 + i]);
  return [a, b];
}

/** 型番情報の 2 か所の座標 [x, y]。添字 i がビット i */
export function versionCells(n: number): [[number, number][], [number, number][]] {
  const a: [number, number][] = [],
    b: [number, number][] = [];
  for (let i = 0; i < 18; i++) {
    const p = n - 11 + (i % 3),
      q = Math.floor(i / 3);
    a.push([p, q]);
    b.push([q, p]);
  }
  return [a, b];
}

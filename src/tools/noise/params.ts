/** ノイズジェネレータの入力の定義: ベルベットの密度、LFSR、表示（時間軸・FFT・強度の範囲）と選択肢の並び */
import { pow2List } from '../../lib/eseries';
import { fmt, minus, plain } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import { full, NES_CPU, NES_DIV, NMAX, NMIN } from './lfsr';

export type Key = 'den' | 'n' | 'init' | 'clk' | 'hd' | 'fft' | 'top' | 'bot';

/** 1-2-5 の並び（lo 以上 hi 以下） */
const seq125 = (lo: number, hi: number): number[] => {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(3));
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
  return out;
};
/** 整数に丸めて範囲に収める（理由つき） */
const intFix =
  (min: () => number, max: () => number, show: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    const lo = min(),
      hi = max(),
      w = Math.min(hi, Math.max(lo, Math.round(v)));
    if (w === v) return [w, ''];
    if (v > hi) return [w, `${show(v)} は範囲外のため上限 ${show(w)} にしました`];
    if (v < lo) return [w, `${show(v)} は範囲外のため下限 ${show(w)} にしました`];
    return [w, `整数の ${show(w)} にしました`];
  };

/** 初期値の欄でドラッグ・‹ › が移る値: 0、2 の累乗とその 1 つ前（すべて 1）、上限 */
export function initList(n: number): number[] {
  const s = new Set<number>([0, full(n)]);
  for (let k = 0; k < n; k++) {
    s.add(2 ** k);
    if (k) s.add(2 ** k - 1);
  }
  return [...s].sort((a, b) => a - b);
}
export const hex = (v: number, n: number): string =>
  `0x${(v >>> 0)
    .toString(16)
    .toUpperCase()
    .padStart(Math.ceil(n / 4), '0')}`;

/** 初期値の欄の今のビット長（client が合わせる） */
export const cur = { n: 15 };

const HZ: ParamFormat = {
  step: (v) =>
    v >= 1e6 ? `${Number((v / 1e6).toPrecision(3))}M` : v >= 1000 ? `${Number((v / 1000).toPrecision(3))}k` : String(v),
};
const DBHZ: ParamFormat = {
  input: (v) => minus(String(v)),
  step: (v) => minus(String(v)),
  text: (v) => `${minus(String(v))} dBFS/Hz`,
};
const dbRange = (
  k: 'top' | 'bot',
  name: string,
  sub: string,
  v: number,
  min: number,
  max: number,
): ParamDef & { k: Key } => ({
  k,
  nm: name,
  sym: '',
  name,
  sub,
  unit: 'dB',
  min,
  max,
  v,
  lin: { step: 5, big: 20 },
  sign: 'any',
  ph: '例 −40',
  bad: '読めない値です（例 −40・−120）',
  pre: [],
  format: DBHZ,
});

export const PARAMS: (ParamDef & { k: Key })[] = [
  {
    k: 'den',
    nm: 'ρ',
    sym: '<i>ρ</i>',
    name: 'パルスの密度',
    sub: '1 秒あたりのパルスの数。下げるほど疎になり、1 つずつのパルスが聞こえるようになる',
    unit: '',
    min: 100,
    max: 24000,
    v: 2000,
    list: [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 24000],
    log: true,
    notation: 'plain',
    ph: '例 2000',
    bad: '読めない値です（例 2000・5k）',
    pre: [],
    format: { step: HZ.step, text: (v) => `${plain(v, 6)} 個/s` },
    fix: intFix(
      () => 100,
      () => 24000,
      (v) => `${plain(v, 6)} 個/s`,
    ),
  },
  {
    k: 'n',
    nm: 'n',
    sym: '<i>n</i>',
    name: 'ビット長',
    sub: 'シフトレジスタのビットの数',
    unit: '',
    min: NMIN,
    max: NMAX,
    v: 15,
    lin: { step: 1, big: 4 },
    notation: 'plain',
    ph: '例 15',
    bad: '読めない値です（例 15）',
    pre: [],
    format: { text: (v) => `${v} ビット` },
    fix: intFix(
      () => NMIN,
      () => NMAX,
      (v) => `${plain(v, 6)} ビット`,
    ),
  },
  {
    k: 'init',
    nm: 'S0',
    sym: '<i>S</i><sub>0</sub>',
    name: '初期値',
    sub: 'レジスタの最初の値（10 進。図の右端がビット 0）。XOR ではすべて 0、XNOR ではすべて 1 の状態から動かない',
    unit: '',
    min: 0,
    max: full(NMAX),
    v: 1,
    list: () => initList(cur.n),
    log: true,
    sign: 'nonneg',
    notation: 'plain',
    sig: 10,
    ph: '例 1',
    bad: '読めない値です（例 1・16384）',
    pre: [],
    format: {
      input: (v) => String(v),
      step: (v) => (v < 1e5 ? String(v) : hex(v, cur.n)),
      text: (v) => `${v}（${hex(v, cur.n)}）`,
    },
    fix: intFix(
      () => 0,
      () => full(cur.n),
      (v) => plain(v, 10),
    ),
  },
  {
    k: 'clk',
    nm: 'fc',
    sym: '<i>f</i><sub>c</sub>',
    name: 'クロック',
    sub: '1 秒あたりのシフトの回数。出力は次のクロックまで保持し、標本の間隔ごとに平均して鳴らす',
    unit: 'Hz',
    min: 10,
    max: 2e6,
    v: NES_CPU / NES_DIV,
    list: seq125(10, 2e6),
    log: true,
    sig: 5,
    ph: '例 8k',
    bad: '読めない値です（例 8k・447k）',
    pre: [
      [1e3, '1k'],
      [4e3, '4k'],
      [16e3, '16k'],
      [48e3, '48k'],
    ],
    format: { step: HZ.step },
  },
  {
    k: 'hd',
    nm: 'H',
    sym: 'H',
    name: '時間軸',
    sub: '横 1 目盛り（div）あたりの時間。表示窓の幅は 10 div',
    unit: 's',
    min: 10e-6,
    max: 0.2,
    v: 1e-3,
    list: seq125(10e-6, 0.2),
    log: true,
    snap: true,
    ph: '例 1m',
    bad: '読めない値です（例 200u・1m・5ms）',
    pre: [],
    format: { text: (v) => `${fmt(v, 's', 3)}/div` },
  },
  {
    k: 'fft',
    nm: 'N',
    sym: '<i>N</i>',
    name: 'FFT の長さ',
    sub: '1 回の FFT に使う点数。大きいほど周波数は細かく（LFSR の線が分かれる）、時間の変化には遅れる',
    unit: '',
    min: 1024,
    max: 32768,
    v: 8192,
    list: pow2List(10, 15),
    log: true,
    snap: true,
    notation: 'plain',
    ph: '例 8192',
    bad: '読めない値です（例 8192・16k）',
    pre: [],
    format: { input: String, step: (v) => `${v / 1024}k`, text: (v) => `${v} 点` },
  },
  dbRange('top', '最高強度', 'スペクトラムの上端と、スペクトログラムの最も明るい色（dBFS/Hz）', -30, -120, 0),
  dbRange('bot', '最低強度', 'スペクトラムの下端と、スペクトログラムの地の色（dBFS/Hz）', -130, -180, -40),
];
export const P = Object.fromEntries(PARAMS.map((d) => [d.k, d])) as Record<Key, ParamDef>;

/** 波形・分布の表示範囲（中心から端までの振幅） */
export const RANGES = [0.25, 0.5, 1] as const;
/** スペクトラムの平均の回数 */
export const AVGS = [8, 32, 128] as const;
/** スペクトログラムの時間の幅（秒） */
export const SPANS = [5, 10, 20, 60] as const;
/** レジスタの図の速さ（1 秒あたりのステップ。0 は止める） */
export const SPEEDS = [0, 1, 4, 16] as const;

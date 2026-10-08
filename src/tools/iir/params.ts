/** IIR フィルタの入力の定義（近似・応答・設計の方法の選択肢と、数値の行） */
import { linList, nextOf, pow2List, prevOf } from '../../lib/eseries';
import { fmt, minus, parts, plain } from '../../lib/format';
import type { ParamDef, ParamFormat, ParamPatch } from '../../lib/param-def';
import type { Kind, Resp } from './analog';
import type { Mode } from './design';

export interface KindDef {
  v: Kind;
  name: string;
  /** 表示窓・要約の帯の略号 */
  ab: string;
  t: string;
}
export const KINDS: readonly KindDef[] = [
  { v: 'butter', name: 'バターワース', ab: 'BUTTER', t: '通過域が最も平坦（最大平坦振幅）' },
  { v: 'cheby1', name: 'チェビシェフ I', ab: 'CHEBY1', t: '通過域に等リップル。同じ次数ならバターワースより急峻' },
  { v: 'cheby2', name: 'チェビシェフ II', ab: 'CHEBY2', t: '阻止域に等リップル。通過域は平坦' },
  { v: 'ellip', name: '楕円', ab: 'ELLIP', t: '通過域と阻止域の両方に等リップル。同じ仕様なら次数が最も低い' },
  { v: 'bessel', name: 'ベッセル', ab: 'BESSEL', t: 'アナログでは群遅延が最も平坦（最大平坦遅延）' },
];
export const kindOf = (v: string): KindDef => KINDS.find((k) => k.v === v) ?? KINDS[0];

export const RESPS: readonly { v: Resp; ab: string; t: string }[] = [
  { v: 'lp', ab: 'LPF', t: 'ローパスフィルタ' },
  { v: 'hp', ab: 'HPF', t: 'ハイパスフィルタ' },
  { v: 'bp', ab: 'BPF', t: 'バンドパスフィルタ' },
  { v: 'bs', ab: 'BSF', t: 'バンドストップフィルタ' },
];
export const respAb = (v: string): string => RESPS.find((r) => r.v === v)?.ab ?? 'LPF';

export const MODES: readonly [Mode, string, string][] = [
  ['order', '次数を指定', '次数と基準の周波数から設計する'],
  ['spec', '仕様から', '通過域・阻止域の端と減衰量を満たす最小の次数を求める'],
];

/** 比べるもの（周波数特性・極と零点・時間応答の CH2） */
export type Cmp = 'ana' | 'imp' | 'dq';
export const CMPS: readonly [Cmp, string, string][] = [
  ['ana', 'アナログ', 'プリワーピングしないアナログフィルタ（目標の周波数そのまま）'],
  ['imp', 'インパルス不変', '同じアナログフィルタからインパルス不変法で作ったデジタルフィルタ（LPF・BPF だけ）'],
  ['dq', '直接形の丸め', '直接形の係数を丸めたデジタルフィルタ'],
];
/** CH2 の略号 */
export const CMP_AB: Record<Cmp, string> = { ana: 'ANALOG', imp: 'IMP.INV', dq: 'DIRECT' };

export const QUANTS: readonly [string, string, string][] = [
  ['f32', 'float32', '単精度浮動小数点（仮数 24 bit、10 進でおよそ 7 桁）'],
  ['8', '8 桁', '有効数字 8 桁'],
  ['6', '6 桁', '有効数字 6 桁'],
  ['4', '4 桁', '有効数字 4 桁'],
];

/* ---------- 表記 ---------- */
/** 周波数: 入力欄 */
export const hzIn = (v: number): string => {
  const [n, x] = parts(v, '', 5);
  return x ? `${n} ${x}` : n;
};
/** 周波数: メッセージ・読み上げ */
export const hzT = (v: number): string => fmt(v, 'Hz', 5);
const HZ: ParamFormat = { input: hzIn, step: (v) => parts(v, '', 4).join(''), text: hzT };
/** dB: 小数 2 桁まで */
const dbIn = (v: number): string => minus(String(Number(v.toFixed(2))));
const dbT = (v: number): string => `${dbIn(v)} dB`;
const DB: ParamFormat = { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: dbT };
/** 減衰量 [dB]: 小さい値（0.001 dB）も出す */
const attIn = (v: number): string => plain(v, 4);
const attT = (v: number): string => `${attIn(v)} dB`;
const ATT: ParamFormat = { input: attIn, step: attIn, text: attT };

/** 範囲外を丸める（「… は範囲外のため上限 … にしました」） */
const clamp =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    const w = Math.min(max, Math.max(min, v));
    return [w, w === v ? '' : `${text(v)} は範囲外のため${w === max ? '上限' : '下限'} ${text(w)} にしました`];
  };

/* ---------- 値の並び ---------- */
/** ISO 266 の 1/3 オクターブ（R10）の 1 Hz〜100 kHz */
const R10 = [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8];
export const FREQS: readonly number[] = Array.from({ length: 6 }, (_, d) =>
  R10.map((b) => Number((b * 10 ** d).toPrecision(3))),
).flat();

/** 周波数の行の下限 [Hz] */
export const FMIN = 1;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-9;

/**
 * 端の周波数の行の範囲と並び: lo より高く hi より低い（lo・hi は隣の端、または 0 と fs/2）。
 * 並びは R10 のうち範囲に入るものと今の値。範囲の外は、隣を越えないように直す
 */
export function edgePatch(v: number, lo: number, hi: number, loName: string, hiName: string): ParamPatch {
  const L = FREQS.filter((x) => x > lo * (1 + 1e-9) && x < hi * (1 - 1e-9) && x >= FMIN);
  if (!L.some((x) => near(x, v)) && v > lo && v < hi) {
    L.push(v);
    L.sort((a, b) => a - b);
  }
  if (!L.length) L.push(v);
  return {
    min: L[0],
    max: L[L.length - 1],
    list: L,
    fix: (x) => {
      if (x < FMIN && lo < FMIN) return [L[0], `${hzT(x)} は範囲外のため下限 ${hzT(L[0])} にしました`];
      if (x <= lo * (1 + 1e-9)) {
        const w = nextOf(L, lo) ?? L[0];
        return [w, `${loName} より高くするため ${hzT(w)} にしました`];
      }
      if (x >= hi * (1 - 1e-9)) {
        const w = prevOf(L, hi) ?? L[L.length - 1];
        return [w, `${hiName} より低くするため ${hzT(w)} にしました`];
      }
      return [x, ''];
    },
  };
}

const APLIST = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 3, 5, 10];
const FSLIST = [1e3, 2e3, 5e3, 8e3, 11025, 16e3, 22050, 24e3, 32e3, 44100, 48e3, 88200, 96e3, 176400, 192e3];

export type Key = 'n' | 'f1' | 'f2' | 's1' | 's2' | 'ap' | 'as' | 'fs' | 'vol' | 'bot';
/** 端の周波数の行 */
export type EdgeKey = 'f1' | 'f2' | 's1' | 's2';
export const EDGES: readonly EdgeKey[] = ['f1', 'f2', 's1', 's2'];

/** 時間応答の表示長 L の選択肢（グラフの 8 div に入れるサンプル数） */
export const LENS = pow2List(3, 12);
export const L0 = 128;

export const FS0 = 48e3;
export const NMAX_UI = 20;
type Def = ParamDef & { k: Key };

/** 端の行の初めの範囲の上限（fs の上限の半分）。保存した値をすべて戻してから、隣の端と fs で狭める */
const FMAX0 = 96e3;
const freqDef = (k: EdgeKey, v: number): Def => ({
  k,
  nm: k,
  sym: '<i>f</i>',
  name: '',
  sub: '',
  unit: 'Hz',
  min: FMIN,
  max: FMAX0,
  v,
  ph: '例 1.5k',
  list: FREQS.filter((x) => x < FMAX0),
  log: true,
  jump: 10,
  sig: 5,
  format: HZ,
  pre: [],
  tk: [
    [1, '1'],
    [10, '10'],
    [100, '100'],
    [1e3, '1k'],
    [1e4, '10k'],
  ],
});

/* ---------- 項目名（近似・応答・設計の方法で変わる） ---------- */
export interface Label {
  sym: string;
  nm: string;
  name: string;
  sub: string;
}

/**
 * 端の周波数の行の記号と項目名。次数を指定するときは、近似ごとの基準の端
 * （バターワース・ベッセルは −3 dB、チェビシェフ I・楕円は通過域端、チェビシェフ II は阻止域端）
 */
export function edgeLabel(k: EdgeKey, kind: Kind, resp: Resp, mode: Mode): Label {
  const band = resp === 'bp' || resp === 'bs',
    lower = k === 'f1' || k === 's1',
    idx = band ? (lower ? '1' : '2') : '',
    pos = band ? (lower ? '（下）' : '（上）') : '';
  let s: string, name: string, sub: string;
  if (k === 's1' || k === 's2' || (mode === 'order' && kind === 'cheby2')) {
    s = 'st';
    name = '阻止域端';
    sub = '阻止域の端。ここから先の減衰を阻止域の減衰量以上にする';
  } else if (mode === 'order' && (kind === 'butter' || kind === 'bessel')) {
    s = 'c';
    name = 'カットオフ周波数';
    sub = '振幅が −3 dB（電力が半分）になる周波数';
  } else {
    s = 'p';
    name = '通過域端';
    sub =
      kind === 'cheby1' || kind === 'ellip'
        ? '通過域の端。ここまで振幅の変動を通過域のリップル以内に収める'
        : '通過域の端。ここまで減衰を通過域端の減衰以内に収める';
  }
  return { sym: `<i>f</i><sub>${s}${idx}</sub>`, nm: `f${s}${idx}`, name: name + pos, sub };
}

/** 通過域の減衰の行の項目名 */
export function apLabel(kind: Kind): Pick<Label, 'name' | 'sub'> {
  return kind === 'cheby1' || kind === 'ellip'
    ? { name: '通過域のリップル', sub: '通過域で許す振幅の変動（等リップルの山と谷の差）' }
    : { name: '通過域端の減衰', sub: '通過域の端での減衰。通過域の中はこれより小さい' };
}

const DEFS: Def[] = [
  {
    k: 'n',
    nm: 'N',
    sym: '<i>N</i>',
    name: '次数',
    sub: 'アナログ原型（LPF）の次数。BPF・BSF のフィルタの次数は 2N',
    unit: '',
    min: 1,
    max: NMAX_UI,
    v: 4,
    ph: '例 6',
    lin: { step: 1, big: 5, major: 5, minor: 1 },
    notation: 'plain',
    fix: (v) => {
      const r = Math.round(v),
        w = Math.min(NMAX_UI, Math.max(1, r));
      if (w !== r) return [w, `${plain(v)} は範囲外のため${w === NMAX_UI ? '上限' : '下限'} ${w} にしました`];
      return [w, r === v ? '' : `次数は整数のため ${w} にしました`];
    },
    pre: [
      [2, '2'],
      [4, '4'],
      [6, '6'],
      [8, '8'],
      [10, '10'],
    ],
    tk: [
      [1, '1'],
      [5, '5'],
      [10, '10'],
      [15, '15'],
      [20, '20'],
    ],
    inputmode: 'decimal',
  },
  freqDef('f1', 1000),
  freqDef('f2', 2000),
  freqDef('s1', 2000),
  freqDef('s2', 4000),
  {
    k: 'ap',
    nm: 'Ap',
    sym: '<i>A</i><sub>p</sub>',
    name: '通過域のリップル',
    sub: '',
    unit: 'dB',
    min: 0.001,
    max: 10,
    v: 1,
    ph: '例 0.5',
    list: APLIST,
    log: true,
    jump: 3,
    format: ATT,
    fix: clamp(0.001, 10, attT),
    pre: [
      [0.1, '0.1'],
      [0.5, '0.5'],
      [1, '1'],
      [3, '3'],
    ],
    tk: [
      [0.001, '0.001'],
      [0.01, '0.01'],
      [0.1, '0.1'],
      [1, '1'],
      [10, '10'],
    ],
  },
  {
    k: 'as',
    nm: 'As',
    sym: '<i>A</i><sub>s</sub>',
    name: '阻止域の減衰量',
    sub: '阻止域で少なくとも減らす量',
    unit: 'dB',
    min: 12,
    max: 150,
    v: 60,
    ph: '例 80',
    list: linList(12, 150, 1),
    jump: 10,
    format: ATT,
    fix: clamp(12, 150, attT),
    pre: [
      [20, '20'],
      [40, '40'],
      [60, '60'],
      [80, '80'],
      [100, '100'],
    ],
    tk: [
      [20, '20'],
      [50, '50'],
      [100, '100'],
      [150, '150'],
    ],
  },
  {
    k: 'fs',
    nm: 'fs',
    sym: '<i>f</i><sub>s</sub>',
    name: 'サンプリング周波数',
    sub: '係数を求める基準',
    unit: 'Hz',
    min: 1e3,
    max: 192e3,
    v: FS0,
    ph: '例 44.1k',
    list: FSLIST,
    log: true,
    jump: 3,
    sig: 5,
    format: HZ,
    fix: clamp(1e3, 192e3, hzT),
    pre: [
      [22050, '22.05k'],
      [44100, '44.1k'],
      [48e3, '48k'],
      [96e3, '96k'],
    ],
    tk: [
      [1e3, '1k'],
      [1e4, '10k'],
      [48e3, '48k'],
      [192e3, '192k'],
    ],
  },
  {
    k: 'vol',
    nm: '音量',
    sym: '',
    name: '音量',
    sub: 'ホワイトノイズの大きさ（0 dB = フルスケール）',
    unit: 'dB',
    min: -80,
    max: 30,
    v: -30,
    ph: '例 −30',
    list: linList(-80, 30, 1),
    jump: 10,
    sign: 'any',
    format: DB,
    fix: clamp(-80, 30, dbT),
    pre: [],
    tk: [
      [-80, '−80'],
      [-40, '−40'],
      [0, '0'],
      [30, '+30'],
    ],
  },
  {
    k: 'bot',
    nm: 'Amin',
    sym: '<i>A</i><sub>min</sub>',
    name: '最小振幅',
    sub: '振幅のグラフの縦軸の下端',
    unit: 'dB',
    min: -200,
    max: -10,
    v: -100,
    ph: '例 −120',
    list: linList(-200, -10, 10),
    jump: 3,
    sign: 'any',
    format: DB,
    fix: clamp(-200, -10, dbT),
    pre: [],
    tk: [
      [-200, '−200'],
      [-150, '−150'],
      [-100, '−100'],
      [-50, '−50'],
    ],
  },
];

/** ▲▼ の読み上げは「N を 1 つ上の …」（並びの行の既定に空白を足す） */
export const PARAMS: Def[] = DEFS.map((d) => ({ stepLabel: ' ', ...d }));

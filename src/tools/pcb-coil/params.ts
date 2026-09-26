/** PCB コイルの入力の定義（形の選択と数値の行）。外径・幅・間隔の依存は patch 関数で表し、client.ts が update する */
import { eList, linList, prevOf, same } from '../../lib/eseries';
import { fmt, minus, parts } from '../../lib/format';
import type { ParamDef, ParamFormat, ParamPatch } from '../../lib/param-def';
import { NMAX, nGeo, nMax, type Shape } from './coil';

/* ---------- 表記 ---------- */
/** 有効数字 s 桁、負はマイナス記号 */
export const sig = (v: number, s = 4): string => minus(String(Number(v.toPrecision(s))));
export const mmT = (v: number): string => `${sig(v)} mm`;
const umT = (v: number): string => `${sig(v)} µm`;
/** 周波数: 入力欄 */
const hzIn = (v: number): string => {
  const [n, x] = parts(v, '', 5);
  return x ? `${n} ${x}` : n;
};
export const hzT = (v: number): string => fmt(v, 'Hz', 5);
/** 容量の表記。共有の parts は p までなので、1 pF 未満は f（フェムト）で書く */
export function partsF(v: number, s = 4): [string, string] {
  if (v > 0 && v < 1e-12) {
    const m = Number((v / 1e-15).toPrecision(s));
    if (m < 1000) return [String(m), 'fF'];
  }
  return parts(v, 'F', s);
}
export const fmtF = (v: number, s?: number): string => partsF(v, s).join(' ');
export const roF = (v: number, s?: number): string => {
  const [n, x] = partsF(v, s);
  return `${n}<span class="u">${x}</span>`;
};
const MM: ParamFormat = { input: (v) => sig(v), step: (v) => sig(v), text: mmT };
const UM: ParamFormat = { input: (v) => sig(v), step: (v) => sig(v), text: umT };
const HZ: ParamFormat = { input: hzIn, step: (v) => parts(v, '', 4).join(''), text: hzT };
const TURNS: ParamFormat = { input: String, step: String, text: (v) => `${v} 巻` };

/** 範囲外を丸める（画面案の言い回し「… は範囲外のため上限 … にしました」） */
const clamp =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    if (v < min) return [min, `${text(v)} は範囲外のため下限 ${text(min)} にしました`];
    if (v > max) return [max, `${text(v)} は範囲外のため上限 ${text(max)} にしました`];
    return [v, ''];
  };

/* ---------- 値の並び ---------- */
/** 配線の幅・間隔 [mm] */
export const MMS = [
  0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10,
];
/** 外径 [mm] */
const DOS = [
  1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120, 150, 200,
];
/** 銅箔の厚さ [µm] */
const TSS = [5, 9, 12, 18, 35, 70, 105, 140, 175, 210];
const FPRE: [number, string, string][] = [
  [125e3, '125k', 'RFID（LF）'],
  [6.78e6, '6.78M', 'ISM・ワイヤレス給電'],
  [13.56e6, '13.56M', 'NFC・RFID（HF）'],
  [27.12e6, '27.12M', 'ISM'],
];
/** 周波数: 1 kHz〜82 MHz の E12、100 MHz、プリセットの値 */
const FSS = [...eList(12, 1e3, 1e8), ...FPRE.map(([v]) => v)]
  .filter((v, i, a) => a.findIndex((x) => same(x, v)) === i)
  .sort((a, b) => a - b);

/* ---------- 依存: 外径・幅・間隔 → 幅の上限・外径の下限・巻数の上限 ---------- */
const EPS = 1e-9;
/** 目盛りのラベルは並びの範囲の中だけ（範囲の端 min・max と並びの端は一致しないことがある） */
const tkIn = (tk: [number, string][], L: readonly number[]): [number, string][] =>
  tk.filter(([v]) => v >= L[0] * (1 - 1e-6) && v <= L[L.length - 1] * (1 + 1e-6));
const DOTK: [number, string][] = [
  [1, '1'],
  [10, '10'],
  [100, '100'],
];
const MMTK: [number, string][] = [
  [0.1, '0.1'],
  [1, '1'],
  [10, '10'],
];

/** 巻数: 上限は内径が正で残る巻数（60 まで） */
export function nPatch(dout: number, w: number, s: number): ParamPatch {
  const g = nGeo(dout, w, s),
    m = nMax(dout, w, s);
  return {
    max: m,
    sub: g > NMAX ? `1〜${NMAX}` : `内径が残るのは ${g} 巻まで`,
    fix: (v) => {
      const x = Math.round(v),
        why = x !== v ? `巻数は整数のため ${x} 巻にしました` : '';
      if (x < 1) return [1, '下限 1 にしました'];
      if (x > g) return [m, `内径が 0 以下になるため ${m} 巻にしました`];
      if (x > NMAX) return [NMAX, `上限 ${NMAX} にしました`];
      return [x, why];
    },
  };
}

/** 外径の並びの下限: 配線の幅の 2 倍より大きい */
const doutList = (w: number) => DOS.filter((x) => x > 2 * w * (1 + EPS));
export function doutPatch(w: number): ParamPatch & Pick<ParamDef, 'tk'> {
  const list = doutList(w);
  return {
    list,
    tk: tkIn(DOTK, list),
    fix: (v) => {
      if (v > 200) return [200, `${mmT(v)} は範囲外のため上限 200 mm にしました`];
      if (v <= 2 * w * (1 + EPS)) {
        const x = list[0];
        return [x, `配線の幅の 2 倍（${mmT(2 * w)}）より大きくするため ${mmT(x)} にしました`];
      }
      if (v < 1) return [1, `${mmT(v)} は範囲外のため下限 1 mm にしました`];
      return [v, ''];
    },
  };
}

/** 幅の上限: 外径の 1/2 未満 */
export const wLimit = (dout: number): number => prevOf(MMS, dout / 2) ?? MMS[0];
export function wPatch(dout: number): ParamPatch & Pick<ParamDef, 'tk'> {
  const h = dout / 2,
    c = clamp(0.05, 10, mmT),
    list = MMS.filter((x) => x < h * (1 - EPS));
  return {
    max: Math.min(10, h),
    list,
    tk: tkIn(MMTK, list),
    fix: (v) => {
      if (v >= h * (1 - EPS) && h <= 10) {
        const x = wLimit(dout);
        return [x, `外径の 1/2（${mmT(h)}）未満にするため ${mmT(x)} にしました`];
      }
      return c(v);
    },
  };
}

/** 外径の補足は形で変わる */
export const doutSub = (sh: Shape): string => (sh.k ? '向かい合う辺の外側の間' : '外側の直径');
/** 形の行の補足 */
export const shapeSub = (sh: Shape): string =>
  sh.k ? `${sh.k} 辺・径は向かい合う辺の間` : '修正 Wheeler 式と単項式近似は係数なし';

export type Key = 'n' | 'dout' | 'w' | 's' | 't' | 'f';
type Def = ParamDef & { k: Key };

const N0 = 5,
  D0 = 40,
  W0 = 0.5,
  S0 = 0.5;
const MMPRE: [number, string][] = [
  [0.15, '0.15'],
  [0.2, '0.2'],
  [0.3, '0.3'],
  [0.5, '0.5'],
  [1, '1'],
];

const DEFS: Def[] = [
  {
    k: 'n',
    nm: 'n',
    sym: '<i>n</i>',
    name: '巻数',
    sub: '',
    unit: '',
    min: 1,
    max: NMAX,
    v: N0,
    ph: '例 5',
    list: linList(1, NMAX, 1),
    jump: 5,
    format: TURNS,
    pre: [],
    tk: [1, 10, 20, 30, 40, 50, 60].map((v) => [v, String(v)]),
    ...nPatch(D0, W0, S0),
  },
  {
    k: 'dout',
    nm: 'dout',
    sym: '<i>d</i><sub>out</sub>',
    name: '外径',
    sub: '向かい合う辺の外側の間',
    unit: 'mm',
    min: 1,
    max: 200,
    v: D0,
    ph: '例 40',
    log: true,
    jump: 4,
    format: MM,
    pre: [
      [10, '10'],
      [20, '20'],
      [30, '30'],
      [40, '40'],
      [50, '50'],
    ],
    ...doutPatch(W0),
  },
  {
    k: 'w',
    nm: 'w',
    sym: '<i>w</i>',
    name: '配線の幅',
    sub: '銅箔の線の幅（8mil のように mil でも入力可）',
    unit: 'mm',
    min: 0.05,
    max: 10,
    v: W0,
    ph: '例 0.3',
    log: true,
    jump: 4,
    format: MM,
    pre: MMPRE,
    ...wPatch(D0),
  },
  {
    k: 's',
    nm: 's',
    sym: '<i>s</i>',
    name: '配線の間隔',
    sub: '隣り合う巻線の銅箔のすき間',
    unit: 'mm',
    min: 0.05,
    max: 10,
    v: S0,
    ph: '例 0.3',
    list: MMS,
    log: true,
    jump: 4,
    format: MM,
    fix: clamp(0.05, 10, mmT),
    pre: MMPRE,
    tk: MMTK,
  },
  {
    k: 't',
    nm: 't',
    sym: '<i>t</i>',
    name: '銅箔の厚さ',
    sub: '1 oz = 35 µm',
    unit: 'µm',
    min: 5,
    max: 210,
    v: 35,
    ph: '例 35',
    list: TSS,
    log: true,
    jump: 2,
    format: UM,
    fix: clamp(5, 210, umT),
    pre: [
      [12, '1/3 oz', '12 µm'],
      [18, '1/2 oz', '18 µm'],
      [35, '1 oz', '35 µm'],
      [70, '2 oz', '70 µm'],
      [105, '3 oz', '105 µm'],
    ],
    tk: [
      [5, '5'],
      [18, '18'],
      [35, '35'],
      [70, '70'],
      [210, '210'],
    ],
  },
  {
    k: 'f',
    nm: 'f',
    sym: '<i>f</i>',
    name: '周波数',
    sub: 'Q と共振を求める周波数',
    unit: 'Hz',
    min: 1e3,
    max: 1e8,
    v: 13.56e6,
    ph: '例 13.56M',
    list: FSS,
    log: true,
    jump: 12,
    format: HZ,
    fix: clamp(1e3, 1e8, hzT),
    pre: FPRE,
    tk: [
      [1e3, '1k'],
      [1e4, '10k'],
      [1e5, '100k'],
      [1e6, '1M'],
      [1e7, '10M'],
      [1e8, '100M'],
    ],
  },
];

/**
 * 入力欄は数字だけなので decimal（周波数は接頭辞を打つので text）。
 * ▲▼ の読み上げは「n を 1 つ上の …」（並びの行の既定「n を1 つ上の」に空白を足す）
 */
export const PARAMS: Def[] = DEFS.map((d) => ({
  stepLabel: ' ',
  inputmode: d.unit === 'Hz' ? 'text' : 'decimal',
  bad: `正の数を入れてください（${d.ph}）`,
  ...d,
}));

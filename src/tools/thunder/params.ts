/** 雷鳴のページの入力の定義（数値の行・選択肢）。.astro の描画とブラウザの動作の両方で使う */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';

const BAD = '数を入れてください（例 3・0.5）';
const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const plainF = (u: string, s = 3): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)} ${u}`,
});

/** 並びを与える行。min・max は並びの端 */
function listed(
  d: Omit<ParamDef, 'min' | 'max' | 'ph' | 'pre' | 'notation' | 'bad' | 'unit'> & {
    list: readonly number[];
    unit: Unit;
    pre?: ParamDef['pre'];
  },
): ParamDef {
  return {
    ...d,
    min: d.list[0],
    max: d.list[d.list.length - 1],
    ph: `例 ${d.v}`,
    pre: d.pre ?? [],
    notation: 'plain',
    sign: d.list[0] === 0 ? 'nonneg' : 'pos',
    inputmode: 'decimal',
    bad: BAD,
    format: d.format ?? plainF(d.unit),
  };
}

export type Key = 'dist' | 'hx' | 'hh' | 'lapse' | 'vol';

/** 聞き手の距離の範囲 [km]（対数で動かす） */
export const DIST_MIN = 0.2;
export const DIST_MAX = 20;

export const DIST: ParamDef = listed({
  k: 'dist',
  nm: 'd',
  sym: '<i>d</i>',
  name: '聞き手の距離',
  sub: '落雷点から聞き手までの水平の距離。図の地面を押してドラッグしても動かせる',
  unit: 'km',
  v: 3,
  list: [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20],
  log: true,
  jump: 3,
  pre: [
    [0.3, '0.3', 'すぐそば'],
    [1, '1'],
    [3, '3'],
    [10, '10'],
    [20, '20', '遠く'],
  ],
});

export const HILL: ParamDef[] = [
  listed({
    k: 'hx',
    nm: '山まで',
    sym: '',
    name: '聞き手から山まで',
    sub: '聞き手の後ろ（雷と反対の側）に立つ崖までの距離',
    unit: 'km',
    v: 1.5,
    list: [0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5],
    log: true,
  }),
  listed({
    k: 'hh',
    nm: '山の高さ',
    sym: '',
    name: '山の高さ',
    sub: '崖の高さ。反射する点がこれより低い音だけ返る',
    unit: 'm',
    v: 400,
    list: [50, 100, 200, 300, 400, 600, 800, 1000, 1500],
    log: true,
  }),
];

export const LAPSE: ParamDef = listed({
  k: 'lapse',
  nm: 'Γ',
  sym: '<i>Γ</i>',
  name: '気温の減り方（高さ 1 km ごと）',
  sub: '上ほど気温が低いと音は上へ曲がり、遠い聞き手に届かない（影の領域）。0 で曲がらない。標準大気は 6.5 K',
  unit: 'K',
  v: 6.5,
  list: linList(0, 10, 0.5),
});

const dbIn = (v: number): string => minus(String(Math.round(v)));
/** 音量 [dB]。雷ごとに、聞こえやすい帯域（100 Hz より上）の強さをそろえる */
export const VOL: ParamDef = {
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: 'スピーカーへ出す大きさ。雷ごとに 100 Hz より上の音の強さをそろえ、近い雷の鋭い山はリミッターで抑える',
  unit: 'dB',
  min: -40,
  max: 0,
  v: -6,
  ph: '例 −12',
  list: linList(-40, 0, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: (v) => `${dbIn(v)} dB` },
  fix: (v) => {
    const c = Math.min(0, Math.max(-40, v)),
      w = Math.round(c);
    return [w, c === v ? '' : `${dbIn(v)} dB は範囲外のため${w === 0 ? '上限' : '下限'} ${dbIn(w)} dB にしました`];
  },
  bad: '読めない値です（例 −6・−20）',
  pre: [],
};

export const PARAMS: ParamDef[] = [DIST, ...HILL, LAPSE, VOL];

/** 放電路の単位長さあたりのエネルギー [J/m]（Few 1969 は 10⁶。測定には 10³〜10⁵ もある） */
export const ENERGIES = [
  ['1e4', '10⁴', '弱い（Lacroix ほか 2019 の測定に近い）'],
  ['1e5', '10⁵'],
  ['1e6', '10⁶', 'Few 1969 の値'],
] as const;
export const GROUNDS = [
  ['1', '硬い', '音をすべて返す（岩・舗装・固い土）'],
  ['0', 'なし', '反射を除く（地面で返る音を聞かない）'],
] as const;
export const HILLS = [
  ['0', 'なし'],
  ['1', 'あり', '聞き手の後ろに崖を置く'],
] as const;
export const WAITS = [
  ['1', '待つ', '光ってから音が届くまで、実際の時間だけ待つ'],
  ['0', '待たない', '最初の音の直前から鳴らす'],
] as const;

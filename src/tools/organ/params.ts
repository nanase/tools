/** オルガン音響モデルの入力の定義（数値の行・選択肢・表示の設定） */
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** 有効数字 s 桁、負はマイナス記号 */
const sig = (v: number, s = 4): string => minus(String(Number(v.toPrecision(s))));
const fmtU = (u: string, s = 4): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)} ${u}`,
});
/** 範囲外を丸める */
const clamp =
  (min: number, max: number, text: (v: number) => string, step?: number) =>
  (v: number): readonly [number, string] => {
    const w = step ? Number((Math.round(v / step) * step).toFixed(6)) : v;
    if (w < min) return [min, `${text(v)} は範囲外のため下限 ${text(min)} にしました`];
    if (w > max) return [max, `${text(v)} は範囲外のため上限 ${text(max)} にしました`];
    return [w, ''];
  };
/** 一様な刻みの数値の行 */
function lin(
  d: Omit<ParamDef, 'list' | 'lin' | 'format' | 'fix' | 'pre'> & {
    step: number;
    big: number;
    s?: number;
    pre?: ParamDef['pre'];
  },
): ParamDef {
  const f = fmtU(d.unit, d.s);
  return {
    ...d,
    lin: { step: d.step, big: d.big },
    format: f,
    fix: clamp(d.min, d.max, f.text as (v: number) => string, d.step),
    pre: d.pre ?? [],
  };
}

/* ---------- 風 ---------- */
/** 手鍵盤の風箱の圧力 [Pa]（第 2 手鍵盤は 0.9 倍、ペダルは 1.15 倍にする） */
export const WIND: ParamDef = lin({
  k: 'wind',
  nm: 'P',
  sym: '<i>P</i>',
  name: '風圧',
  sub: '第 1 手鍵盤の風箱の圧力。第 2 手鍵盤はその 0.9 倍、ペダルは 1.15 倍。高いほどジェットが速く、音が大きく明るくなり、強すぎると上のモードへ跳ぶ（倍音で鳴る）',
  unit: 'Pa',
  min: 400,
  max: 1400,
  v: 800,
  ph: '例 800',
  step: 10,
  big: 50,
  pre: [
    [600, '600', '約 60 mm 水柱（バロック時代の楽器に多い）'],
    [800, '800'],
    [1000, '1000'],
  ],
});

/* ---------- 整音 ---------- */
/** 管の太さ: Töpfer の標準スケールからの偏差 [半音] */
export const SCALE: ParamDef = lin({
  k: 'scale',
  nm: 'S',
  sym: 'Δ<i>s</i>',
  name: 'スケール',
  sub: '管の内径を、Töpfer の標準スケール（8 フィートの C で 155.5 mm、16 半音で半分）から何半音ぶん太くするか。太いほど高い倍音が弱く、柔らかい音になる',
  unit: '',
  min: -10,
  max: 12,
  v: 0,
  ph: '例 0',
  step: 1,
  big: 2,
  sign: 'any',
  s: 3,
});
/** カットアップ ÷ 口の幅 */
export const CUT: ParamDef = lin({
  k: 'cut',
  nm: 'β',
  sym: '<i>β</i>',
  name: 'カットアップ',
  sub: '口の高さ（ジェットが渡る距離）÷ 口の幅。高いほどジェットの走る時間が長くなり、音が柔らかく遅く立ち上がる。低いと明るく速く、強すぎると上のモードへ跳ぶ',
  unit: '',
  min: 0.15,
  max: 0.5,
  v: 0.25,
  ph: '例 0.25',
  step: 0.01,
  big: 0.05,
  s: 3,
});

/* ---------- 部屋 ---------- */
export const DIST: ParamDef = lin({
  k: 'dist',
  nm: 'r',
  sym: '<i>r</i>',
  name: '聴く位置',
  sub: '楽器から聴く人までの距離。遠いほど、直接届く音に対して部屋の響きが大きくなる（直接音の大きさは 1 m 先にそろえる）',
  unit: 'm',
  min: 1,
  max: 30,
  v: 15,
  ph: '例 15',
  step: 0.5,
  big: 2,
});

/* ---------- 演奏と音 ---------- */
/** 音量の初期値 [dB]（0 dB で、1 m 先の音圧 1 Pa をフルスケールにする）。プレヌムの和音は 1 m 先で数 Pa になる */
export const VOL0 = -20;

/* ---------- 選択肢 ---------- */
/** A4 の周波数 [Hz] */
export const A4S = [415, 440, 465] as const;
/** 振幅の強調（実際の変位に掛ける倍率） */
export const EXAG = [0.5, 1, 2, 4] as const;
/** スローで見るときの速さ（実時間に対する割合の逆数） */
export const SLOW = [1, 5, 10, 50, 100] as const;
/** 出力の波形に出す長さ [s] */
export const SPANS = [0.02, 0.2, 2] as const;
/** スペクトラムの横軸の右端 [Hz] */
export const FMAX = [2000, 5000, 10000] as const;

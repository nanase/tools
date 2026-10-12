/** エンジン音響モデルの入力の定義（数値の行・選択肢・表示の設定） */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** 有効数字 s 桁、負はマイナス記号 */
const sig = (v: number, s = 4): string => minus(String(Number(v.toPrecision(s))));
/** 3 桁ごとのカンマ（rpm） */
const grp = (v: number): string => Math.round(v).toLocaleString('en-US');
const fmtU = (u: string, s = 4): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)} ${u}`,
});
/** 範囲外を丸め、刻みにそろえる */
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
    format?: ParamFormat;
  },
): ParamDef {
  const f = d.format ?? fmtU(d.unit, d.s);
  return {
    ...d,
    list: linList(d.min, d.max, d.step),
    jump: Math.max(1, Math.round(d.big / d.step)),
    notation: 'plain',
    format: f,
    fix: clamp(d.min, d.max, f.text as (v: number) => string, d.step),
    pre: d.pre ?? [],
  };
}
const rpmF: ParamFormat = { input: grp, step: grp, text: (v) => `${grp(v)} rpm` };

/* ---------- 運転 ---------- */
export type RunKey = 'n' | 'slope';
/** 回転数固定のときの回転数 [rpm] */
export const SPEED: ParamDef = lin({
  k: 'n',
  nm: 'N',
  sym: '<i>N</i>',
  name: '回転数',
  sub: '「回転数固定」で保つクランク軸の回転数。4 速で 40 km/h はおよそ 3,160 rpm、60 km/h は 4,740 rpm',
  unit: 'rpm',
  min: 1000,
  max: 9000,
  v: 4750,
  ph: '例 4750',
  step: 50,
  big: 500,
  format: rpmF,
  pre: [
    [1400, '1,400', 'アイドリング'],
    [3160, '3,160', '4 速で 40 km/h'],
    [4750, '4,750', '最大トルクの回転数（公表値）'],
    [6250, '6,250', '最高出力の回転数（公表値）'],
  ],
});

/** 走行の勾配 [%]（上りが正） */
export const SLOPE: ParamDef = lin({
  k: 'slope',
  nm: '勾配',
  sym: '',
  name: '勾配',
  sub: '道の傾き（100 m 進んで上がる高さ [m]）。上りが正、下りが負。上りでは低いギアが要り、下りではエンジンブレーキが効く',
  unit: '%',
  min: -15,
  max: 15,
  v: 0,
  ph: '例 5',
  step: 0.5,
  big: 2,
  sign: 'any',
  pre: [
    [-10, '−10'],
    [-5, '−5'],
    [0, '0'],
    [5, '5'],
    [10, '10'],
  ],
});
/** 積載重量（乗る人と荷物）[kg]（車両重量 118 kg に足す） */
export const MASS: ParamDef = lin({
  k: 'mass',
  nm: '積載重量',
  sym: '',
  name: '積載重量',
  sub: '乗る人と荷物の質量。車両重量（118 kg）に足す。重いほど加速が鈍く、上り坂で回転が落ちる',
  unit: 'kg',
  min: 40,
  max: 200,
  v: 65,
  ph: '例 70',
  step: 1,
  big: 10,
  pre: [
    [50, '50'],
    [65, '65'],
    [80, '80'],
    [130, '130', '2 人乗り'],
  ],
});

/* ---------- エンジン（その他） ---------- */
export type EngKey = 'idle' | 'cut' | 'mech';
export const IDLE: ParamDef = lin({
  k: 'idle',
  nm: 'アイドリング',
  sym: '',
  name: 'アイドリングの回転数',
  sub: 'スロットルを閉じたときに ECU が保つ回転数。取扱説明書の値は 1,400 ± 100 rpm（JA55）',
  unit: 'rpm',
  min: 1000,
  max: 2000,
  v: 1400,
  ph: '例 1400',
  step: 50,
  big: 200,
  format: rpmF,
});
export const CUT: ParamDef = lin({
  k: 'cut',
  nm: '回転の上限',
  sym: '',
  name: '回転の上限',
  sub: 'この回転数の 400 rpm 手前から点火を遅らせ、近くでは燃料も絞って、回転が頭打ちになるようにする（燃料を急に切らない）。公表されていないので、このツールで決めた値',
  unit: 'rpm',
  min: 6000,
  max: 10000,
  v: 8000,
  ph: '例 8000',
  step: 100,
  big: 500,
  format: rpmF,
});
const dbIn = (v: number) => minus(String(Math.round(v)));
export const MECH: ParamDef = lin({
  k: 'mech',
  nm: '機械音',
  sym: '',
  name: '機械音の大きさ',
  sub: '弁の打音と燃焼の圧力でエンジン本体が鳴る音の大きさ。0 dB は、録音（排気口の近く）に合わせた大きさから 4 dB 上げた値（乗っている位置ではエンジンが近いため）',
  unit: 'dB',
  min: -30,
  max: 10,
  v: 0,
  ph: '例 −6',
  step: 1,
  big: 6,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: (v) => `${dbIn(v)} dB` },
});

/** 音量 [dB]（0 dB で、排気口から 0.5 m の音圧 20 Pa をフルスケールにする。既定値は楽器のページと同じ −10 dB） */
export const VOL: ParamDef = lin({
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: 'スピーカーへ出す大きさ。0 dB で、排気口から 0.5 m の音圧 20 Pa（120 dB）をフルスケールにする。大きすぎるときは割れないように抑える',
  unit: 'dB',
  min: -60,
  max: 20,
  v: -10,
  ph: '例 −20',
  step: 1,
  big: 6,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: (v) => `${dbIn(v)} dB` },
});

/* ---------- 表示の設定 ---------- */
/** スローの速さ（何分の 1 か） */
export const SLOW = [10, 20, 50, 100, 200] as const;
/** 排気管の圧力の色の範囲 [kPa] */
export const PRANGE = [5, 20, 50, 100] as const;

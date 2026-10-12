/**
 * エンジンの諸元（公表値）と、公表されていない寸法の仮定。
 * 公表値: JA65 は Honda のニュースリリース（2023-11-09）の主要諸元、JA55 はモーターファンの JA55・JA65 の比較記事。
 * 弁・吸排気管・マフラーの寸法は公表されていないので、同じ排気量の空冷 2 弁の単気筒に多い値を仮定し、
 * 公表の最大トルク・最高出力と録音に合わせて直す
 */
import type { SegSpec } from './duct';

/** 弁（角度はサイクルの角度 φ [deg]。0 が吸気の上死点、360 が燃焼の上死点） */
export interface ValveSpec {
  /** 傘の径 [m]・最大リフト [m] */
  d: number;
  lift: number;
  /** リフト 0 から開き始める角度と、開いている長さ [deg] */
  open: number;
  dur: number;
  /**
   * リフトの形 L = Lmax sin^k(π s) の指数 k（省略時 1.5）。大きいほど開き始めと閉じ際が緩やかになる
   * （カムのランプに近づき、弁が重なる間の通り道が狭くなる）
   */
  shape?: number;
}

/** サイクルの角度 deg [°] での弁のリフト [m]（閉じていれば 0） */
export function liftAt(v: ValveSpec, deg: number): number {
  const s = ((((deg - v.open) % 720) + 720) % 720) / v.dur;
  return s < 1 ? v.lift * Math.sin(Math.PI * s) ** (v.shape ?? 1.5) : 0;
}

export interface EngineSpec {
  id: string;
  label: string;
  /** 内径・行程・連接棒の長さ [m]、圧縮比 */
  bore: number;
  stroke: number;
  rod: number;
  cr: number;
  inValve: ValveSpec;
  exValve: ValveSpec;
  /** スロットルの口径 [m] */
  throttleD: number;
  /** 吸気管（スロットル → 吸気弁）と排気管（排気弁 → 出口） */
  intake: SegSpec[];
  exhaust: SegSpec[];
  /** 燃焼: 燃焼期間 [deg]（Wiebe の 99 %）と燃焼の効率 */
  burn: number;
  eta: number;
  /** 摩擦の平均有効圧 fmep = f0 + f1·Sp + f2·Sp² [Pa]（Sp は平均ピストン速度 [m/s]）。発電機・油ポンプの負荷を含む */
  fmep: [number, number, number];
  /** クランク軸まわりの慣性モーメント [kg·m²]・往復運動する質量 [kg] */
  J: number;
  mRec: number;
  /** アイドリングの回転数・燃料を切る回転数 [rpm] */
  idle: number;
  cut: number;
  /** 公表値: 最高出力 [W] とその回転数、最大トルク [N·m] とその回転数 */
  rated: { power: number; powerRpm: number; torque: number; torqueRpm: number };
  /** 動力の伝達（公表値）: 1 次減速比・2 次減速比・1〜4 速の変速比 */
  drive: { primary: number; final: number; gears: readonly number[] };
  /** マフラーの音色の補正（なければ掛けない） */
  tone?: ToneSpec;
}

/**
 * 音色の補正: 排気の音に掛ける低い棚（RBJ の low shelf、傾き 1）の角の周波数 [Hz] と、低い側の増幅 [dB]。
 * スロットルを開けている間だけ掛ける（開き 15 % で全部。アイドリングとエンジンブレーキでは掛けない）
 */
export interface ToneSpec {
  f: number;
  gain: number;
}

/**
 * 純正の排気系: エキゾーストパイプ → 触媒 → マフラーの 2 室 → テールパイプ。内部の構造は公表されていないので、
 * 2 室の反射型を仮定し、寸法と穴の抵抗を録音（排気口の近く、アイドリング・4 速の定速・3 速の全開・エンジンブレーキ）に
 * 当てはめた。比べたのは爆発の周波数の倍音の並び（差の二乗平均で 5〜6 dB）、アイドリングの脈のとがり具合（300 Hz
 * 以下の波形の尖度。録音 4.7）と、社外品との音量の差（同じマイクの録音で、純正はアイドリングで約 3 dB、4 速の定速で
 * 約 4 dB 大きく、40〜125 Hz は 7〜20 dB 強い）。低音の差を重く見て当てはめ直したが、模型は定速の 40〜125 Hz がまだ
 * 約 6 dB 足りない。長さは管の中の音の通り道なので、折り返したパイプの分だけ実物の外形より長い
 */
/**
 * 純正の音色の補正: 寸法の当てはめでは、スロットルを開けているとき（4 速の定速・3 速の全開）の 40〜125 Hz が録音より
 * 約 6 dB 足りなかった。これを 94 Hz より下を 4.8 dB 強める低い棚で補う（録音に当てはめた。定速の不足は約 3 dB に
 * 縮む）。アイドリングとエンジンブレーキは録音との差がない（アイドリングはむしろ約 3 dB 多い）ので掛けない
 */
const STOCK_TONE: ToneSpec = { f: 94, gain: 4.8 };

const STOCK_EXHAUST: SegSpec[] = [
  { len: 0.736, d: 0.0196, heat: 0.8 },
  { len: 0.08, d: 0.045, heat: 0.75, resist: 3.3e5 },
  { len: 0.107, d: 0.029, heat: 0.65 },
  { len: 0.246, d: 0.072, heat: 0.6 },
  { len: 0.0483, d: 0.035, heat: 0.55 },
  { len: 0.158, d: 0.0412, heat: 0.5 },
  { len: 0.268, d: 0.0281, heat: 0.45 },
];

/**
 * 社外品の排気系（DELTA バレル4-S MINI、JA65 用を想定）: ステンレスのエキゾーストパイプ → グラスウールの吸音型の
 * サイレンサー（パンチングの芯）→ 出口。内部の寸法は公表されていないので、ストレートの吸音型を 3 区間で表し、純正と同じ
 * やり方で録音（アイドリング・4 速の定速・4 速の登坂・エンジンブレーキ）に当てはめた（倍音の差の二乗平均で 4〜6 dB。
 * 純正より粗い）。グラスウールは高い音を強く吸うので、吸音の減衰に下限（1 kHz で 15 dB/m）を置いた（下限がないと
 * 吸音が 0 になって鋭い共鳴が残り、笛のような音になった）。境目の抵抗はパンチングの穴と吸音材の流れの抵抗をまとめたもの
 */
const DELTA_EXHAUST: SegSpec[] = [
  { len: 1.25, d: 0.0287, heat: 0.8, resist: 3.9e5 },
  { len: 0.375, d: 0.036, heat: 0.6, absorb: 15, resist: 3.67e5 },
  { len: 0.14, d: 0.04, heat: 0.5 },
];

/** 選べるマフラー */
export const MUFFLERS: Record<'stock' | 'delta', { label: string; segs: readonly SegSpec[]; tone?: ToneSpec }> = {
  stock: { label: '純正', segs: STOCK_EXHAUST, tone: STOCK_TONE },
  delta: { label: '社外品', segs: DELTA_EXHAUST },
};

/** 吸気管（スロットルボディ → インシュレータ → 吸気ポート） */
const INTAKE: SegSpec[] = [{ len: 0.2, d: 0.024, heat: 0 }];

export const JA65: EngineSpec = {
  id: 'ja65',
  label: 'JA65E（2022 年 12 月〜）',
  bore: 0.05,
  stroke: 0.0631,
  rod: 0.1,
  cr: 10,
  inValve: { d: 0.025, lift: 0.007, open: -25, dur: 280, shape: 2.5 },
  exValve: { d: 0.021, lift: 0.0065, open: 470, dur: 280, shape: 2.5 },
  throttleD: 0.022,
  intake: INTAKE,
  exhaust: STOCK_EXHAUST,
  tone: STOCK_TONE,
  burn: 50,
  eta: 0.93,
  fmep: [90e3, 6e3, 400],
  J: 0.0035,
  mRec: 0.12,
  idle: 1400,
  cut: 8000,
  rated: { power: 6700, powerRpm: 6250, torque: 11, torqueRpm: 4750 },
  drive: { primary: 3.421, final: 2.714, gears: [2.5, 1.55, 1.15, 0.923] },
};

export const JA55: EngineSpec = {
  ...JA65,
  id: 'ja55',
  label: 'JA55E（2020〜2022 年）',
  bore: 0.0524,
  stroke: 0.0579,
  rod: 0.1,
  cr: 9.3,
  inValve: { d: 0.026, lift: 0.007, open: -25, dur: 280, shape: 2.5 },
  eta: 0.9,
  rated: { power: 6500, powerRpm: 7000, torque: 11, torqueRpm: 4500 },
  drive: { primary: 3.35, final: 2.785, gears: [2.5, 1.55, 1.15, 0.923] },
};

export type EngineId = 'ja65' | 'ja55';
export type MufflerId = keyof typeof MUFFLERS;

/** エンジンとマフラーの組み合わせから模型の諸元を作る */
export function specOf(eng: EngineId, muf: MufflerId): EngineSpec {
  return { ...(eng === 'ja55' ? JA55 : JA65), exhaust: [...MUFFLERS[muf].segs], tone: MUFFLERS[muf].tone };
}

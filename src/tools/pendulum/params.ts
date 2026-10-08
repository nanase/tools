/** 倒立振子のページの入力の定義（数値の行・選択肢・教材のプリセット） */
import type { ParamDef } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';

/** 入力欄の単位の一覧（lib/parse.ts の Unit）にない単位。読むときは数だけを読む */
const U = (s: string) => s as Unit;
const LOG_HINT = '↑↓: E24 の隣の値　PgUp/PgDn: 10 倍・1/10　Enter: 確定　Esc: 戻す';
const BAD = '数を入れてください（例 0.23・1e-3）';

/** E24 の対数の並びの行（接頭辞なしの表記）。min が 0 なら floor から */
function e24(
  d: Omit<ParamDef, 'series' | 'notation' | 'inputmode' | 'hint' | 'bad' | 'ph' | 'pre' | 'tk'> & {
    ph?: string;
    pre?: ParamDef['pre'];
    tk?: ParamDef['tk'];
    sig?: number;
  },
): ParamDef {
  return {
    ...d,
    series: 24,
    ends: true,
    sign: d.min === 0 ? 'nonneg' : 'pos',
    notation: 'plain',
    sig: d.sig ?? 4,
    inputmode: 'decimal',
    hint: LOG_HINT,
    bad: BAD,
    ph: d.ph ?? `例 ${d.v}`,
    pre: d.pre ?? [],
    tk: d.tk ?? [],
  };
}
/** 目盛り: 10 の累乗 */
const decades = (lo: number, hi: number): [number, string][] => {
  const o: [number, string][] = [];
  for (let e = Math.round(Math.log10(lo)); 10 ** e <= hi * 1.0001; e++)
    o.push([10 ** e, String(Number((10 ** e).toPrecision(1)))]);
  return o;
};

/* ---------- 振子と台車 ---------- */
export type PlantKey = 'm' | 'l' | 'J' | 'M' | 'rail' | 'bc' | 'fc' | 'bp';
export const PLANT: ParamDef[] = [
  e24({
    k: 'm',
    nm: 'm',
    sym: '<i>m</i>',
    name: '振子の質量',
    sub: '振り子の棒（と軸の金具）の質量',
    unit: U('kg'),
    min: 0.01,
    max: 10,
    v: 0.23,
    tk: decades(0.01, 10),
  }),
  e24({
    k: 'l',
    nm: 'l',
    sym: '<i>l</i>',
    name: '重心までの長さ',
    sub: '振子の軸から重心までの長さ。長いほど倒れるのが遅く、立てやすい',
    unit: 'mm',
    min: 10,
    max: 2000,
    v: 330.2,
    tk: decades(10, 1000),
  }),
  e24({
    k: 'J',
    nm: 'J',
    sym: '<i>J</i>',
    name: '慣性モーメント',
    sub: '振子の重心まわりの慣性モーメント（1 kg·cm² = 10⁻⁴ kg·m²）。長さ L の一様な棒なら mL²/12。0 なら重心に質量が集まった振子',
    unit: U('kg·cm²'),
    min: 0,
    floor: 0.01,
    max: 10000,
    v: 78.838,
    tk: [
      [0, '0'],
      [1, '1'],
      [100, '100'],
      [10000, '1e4'],
    ],
  }),
  e24({
    k: 'M',
    nm: 'M',
    sym: '<i>M</i>',
    name: '台車の質量',
    sub: '台車（載せたおもりを含む）の質量。モータの回転子の慣性は駆動の側で足す',
    unit: U('kg'),
    min: 0.05,
    max: 50,
    v: 0.94,
    tk: decades(0.1, 10),
  }),
  e24({
    k: 'rail',
    nm: 'L',
    sym: '<i>L</i><sub>r</sub>',
    name: 'レールの長さ',
    sub: '台車が動ける範囲。端では台車が止まり（反発係数 0.2）、その反動が振子にかかる',
    unit: 'm',
    min: 0.1,
    max: 10,
    v: 0.814,
    tk: decades(0.1, 10),
  }),
  e24({
    k: 'bc',
    nm: 'bc',
    sym: '<i>b</i><sub>c</sub>',
    name: '台車の粘性摩擦',
    sub: '台車の速さに比例する摩擦（モータの逆起電力の分は除く）',
    unit: U('N·s/m'),
    min: 0,
    floor: 0.01,
    max: 100,
    v: 5.4,
    tk: [
      [0, '0'],
      [0.1, '0.1'],
      [1, '1'],
      [10, '10'],
      [100, '100'],
    ],
  }),
  e24({
    k: 'fc',
    nm: 'fc',
    sym: '<i>F</i><sub>c</sub>',
    name: '台車のクーロン摩擦',
    sub: '速さによらない一定の大きさの摩擦。あると台車が止まりやすく、釣り合いの近くで小さく行き来する',
    unit: 'N',
    min: 0,
    floor: 0.01,
    max: 50,
    v: 0,
    pre: [
      [0, '0'],
      [0.2, '0.2'],
      [0.5, '0.5'],
      [1, '1'],
    ],
    tk: [
      [0, '0'],
      [0.1, '0.1'],
      [1, '1'],
      [10, '10'],
    ],
  }),
  e24({
    k: 'bp',
    nm: 'bp',
    sym: '<i>b</i><sub>p</sub>',
    name: '軸の粘性摩擦',
    sub: '振子の軸の、角速度に比例する摩擦トルク [N·m·s/rad]',
    unit: U('N·m·s'),
    min: 0,
    floor: 1e-5,
    max: 1,
    v: 0.0024,
    tk: [
      [0, '0'],
      [1e-4, '1e-4'],
      [1e-2, '0.01'],
      [1, '1'],
    ],
  }),
];

/* ---------- 駆動 ---------- */
export type DriveKey = 'vmax' | 'fmax' | 'kt' | 'rm' | 'kg' | 'rp' | 'jm';
export const DRIVE: ParamDef[] = [
  e24({
    k: 'vmax',
    nm: 'Vmax',
    sym: '<i>V</i><sub>max</sub>',
    name: '電圧の上限',
    sub: 'モータへ出せる電圧（アンプか D/A 変換器の上限）。制御の出力はここで切れる',
    unit: 'V',
    min: 0.5,
    max: 100,
    v: 10,
    pre: [
      [5, '5'],
      [10, '10'],
      [24, '24'],
    ],
    tk: decades(1, 100),
  }),
  e24({
    k: 'fmax',
    nm: 'Fmax',
    sym: '<i>F</i><sub>max</sub>',
    name: '力の上限',
    sub: '台車に出せる力。制御の出力はここで切れる',
    unit: 'N',
    min: 0.1,
    max: 1000,
    v: 10,
    pre: [
      [5, '5'],
      [10, '10'],
      [20, '20'],
    ],
    tk: decades(0.1, 1000),
  }),
  e24({
    k: 'kt',
    nm: 'kt',
    sym: '<i>k</i><sub>t</sub>',
    name: 'トルク定数',
    sub: '電流あたりのトルク。SI 単位では逆起電力定数 [V·s/rad] と同じ値（7.67 mN·m/A なら 7.67 mV·s/rad）',
    unit: U('mN·m/A'),
    min: 0.1,
    max: 1000,
    v: 7.67,
    tk: decades(0.1, 1000),
  }),
  e24({
    k: 'rm',
    nm: 'Rm',
    sym: '<i>R</i><sub>m</sub>',
    name: '巻線抵抗',
    sub: 'モータの巻線の抵抗。電圧から電流、電流からトルクを求める（巻線のインダクタンスは無視する）',
    unit: 'Ω',
    min: 0.01,
    max: 1000,
    v: 2.6,
    tk: decades(0.01, 1000),
  }),
  e24({
    k: 'kg',
    nm: 'Kg',
    sym: '<i>K</i><sub>g</sub>',
    name: '減速比',
    sub: 'モータとピニオンの間の歯車の比',
    unit: '',
    min: 1,
    max: 1000,
    v: 3.71,
    tk: decades(1, 1000),
  }),
  e24({
    k: 'rp',
    nm: 'r',
    sym: '<i>r</i>',
    name: 'ピニオンの半径',
    sub: '台車のラック（またはベルト）を動かす歯車の半径',
    unit: 'mm',
    min: 1,
    max: 100,
    v: 6.35,
    tk: decades(1, 100),
  }),
  e24({
    k: 'jm',
    nm: 'Jm',
    sym: '<i>J</i><sub>m</sub>',
    name: '回転子の慣性',
    sub: 'モータの回転子の慣性モーメント。台車から見ると Kg²Jm/r² の質量になる',
    unit: U('g·cm²'),
    min: 0,
    floor: 0.01,
    max: 10000,
    v: 3.9,
    tk: [
      [0, '0'],
      [0.1, '0.1'],
      [10, '10'],
      [1000, '1000'],
    ],
  }),
];

/* ---------- 計測 ---------- */
export type SenseKey = 'xres' | 'fv' | 'nth' | 'nx';
export const SENSE: ParamDef[] = [
  e24({
    k: 'xres',
    nm: 'Δx',
    sym: '<i>Δx</i>',
    name: '位置の分解能',
    sub: '位置のエンコーダの 1 カウントの長さ。位置はこの刻みでしか分からない',
    unit: 'µm',
    min: 0.1,
    max: 2000,
    v: 22.75,
    tk: decades(0.1, 1000),
  }),
  e24({
    k: 'fv',
    nm: 'fv',
    sym: '<i>f</i><sub>v</sub>',
    name: '速度のフィルタ',
    sub: '角度と位置の差分から速度を推定する 2 次の低域通過フィルタ（減衰比 0.9）の遮断周波数。高いほど遅れが小さく、量子化の雑音が増える',
    unit: 'Hz',
    min: 1,
    max: 500,
    v: 50,
    pre: [
      [10, '10'],
      [50, '50'],
      [200, '200'],
    ],
    tk: decades(1, 100),
  }),
  e24({
    k: 'nth',
    nm: 'σθ',
    sym: '<i>σ</i><sub>θ</sub>',
    name: '角度の雑音',
    sub: '角度の計測に足す正規分布の雑音の標準偏差（エンコーダなら 0、ポテンショメータなどで生じる）',
    unit: '°',
    min: 0,
    floor: 0.001,
    max: 5,
    v: 0,
    pre: [
      [0, '0'],
      [0.05, '0.05'],
      [0.5, '0.5'],
    ],
    tk: [
      [0, '0'],
      [0.01, '0.01'],
      [0.1, '0.1'],
      [1, '1'],
    ],
  }),
  e24({
    k: 'nx',
    nm: 'σx',
    sym: '<i>σ</i><sub>x</sub>',
    name: '位置の雑音',
    sub: '位置の計測に足す正規分布の雑音の標準偏差',
    unit: 'mm',
    min: 0,
    floor: 0.001,
    max: 10,
    v: 0,
    pre: [
      [0, '0'],
      [0.1, '0.1'],
      [1, '1'],
    ],
    tk: [
      [0, '0'],
      [0.01, '0.01'],
      [0.1, '0.1'],
      [1, '1'],
      [10, '10'],
    ],
  }),
];
/** 制御周期 [ms] と、角度のエンコーダの 1 回転のカウント数（4 逓倍の後）の選択肢 */
export const TS_MS = [1, 2, 5, 10, 20, 50, 100] as const;
export const CPRS = [400, 1000, 2000, 4096, 8192] as const;

/* ---------- 制御 ---------- */
export type LqrKey = 'qx' | 'qt' | 'qv' | 'qw' | 'r';
const q = (k: LqrKey, nm: string, sym: string, name: string, sub: string, v: number, min = 0): ParamDef =>
  e24({
    k,
    nm,
    sym,
    name,
    sub,
    unit: '',
    min,
    floor: min ? undefined : 1e-3,
    max: 1e5,
    v,
    tk: [...(min ? [] : ([[0, '0']] as [number, string][])), [0.01, '0.01'], [1, '1'], [100, '100'], [1e4, '1e4']],
  });
export const LQR: ParamDef[] = [
  q(
    'qx',
    'qx',
    '<i>q</i><sub><i>x</i></sub>',
    '位置の重み',
    'Q の対角の、台車の位置のずれ [m] の 2 乗に掛ける重み',
    35,
    1e-3,
  ),
  q(
    'qt',
    'qθ',
    '<i>q</i><sub><i>θ</i></sub>',
    '角度の重み',
    'Q の対角の、振子の角度 [rad] の 2 乗に掛ける重み',
    350,
    1e-3,
  ),
  q('qv', 'qẋ', '<i>q</i><sub><i>ẋ</i></sub>', '速度の重み', 'Q の対角の、台車の速度 [m/s] の 2 乗に掛ける重み', 0.1),
  q(
    'qw',
    'qθ̇',
    '<i>q</i><sub><i>θ̇</i></sub>',
    '角速度の重み',
    'Q の対角の、振子の角速度 [rad/s] の 2 乗に掛ける重み',
    0.1,
  ),
  e24({
    k: 'r',
    nm: 'R',
    sym: '<i>R</i>',
    name: '入力の重み',
    sub: '入力（電圧 [V] か力 [N]）の 2 乗に掛ける重み。大きいほど入力を控えめにし、応答が遅くなる',
    unit: '',
    min: 1e-5,
    max: 100,
    v: 0.02,
    tk: decades(1e-4, 100),
  }),
];

export type PlaceKey = 'w1' | 'z1' | 'w2' | 'z2';
const wn = (k: PlaceKey, n: string, v: number): ParamDef =>
  e24({
    k,
    nm: `ω${n}`,
    sym: `<i>ω</i><sub>${n}</sub>`,
    name: `${n} 組目の速さ`,
    sub: `${n} 組目の 2 つの極の固有角周波数。極の絶対値で、大きいほど速く戻すが入力が大きくなる`,
    unit: U('rad/s'),
    min: 0.1,
    max: 200,
    v,
    tk: decades(0.1, 100),
  });
const zeta = (k: PlaceKey, n: string, v: number): ParamDef => ({
  k,
  nm: `ζ${n}`,
  sym: `<i>ζ</i><sub>${n}</sub>`,
  name: `${n} 組目の減衰比`,
  sub: '1 未満なら共役な複素数の 2 つの極（振動しながら戻る）、1 以上なら実数の 2 つの極',
  unit: '',
  min: 0.05,
  max: 3,
  v,
  lin: { step: 0.05, big: 0.25, major: 1, minor: 0.25 },
  notation: 'plain',
  sig: 3,
  inputmode: 'decimal',
  bad: BAD,
  ph: `例 ${v}`,
  pre: [
    [0.5, '0.5'],
    [0.7, '0.7'],
    [1, '1'],
  ],
  tk: [
    [0.5, '0.5'],
    [1, '1'],
    [2, '2'],
    [3, '3'],
  ],
});
export const PLACE: ParamDef[] = [wn('w1', '1', 3), zeta('z1', '1', 0.7), wn('w2', '2', 15), zeta('z2', '2', 0.7)];

export type PidKey = 'kpa' | 'kda' | 'kia' | 'kpx' | 'kdx' | 'kix';
const gain = (
  k: PidKey,
  nm: string,
  sym: string,
  name: string,
  sub: string,
  unit: string,
  v: number,
  max: number,
): ParamDef =>
  e24({
    k,
    nm,
    sym,
    name,
    sub,
    unit: U(unit),
    min: 0,
    floor: max * 1e-5,
    max,
    v,
    tk: [[0, '0'], ...decades(max * 1e-4, max)],
  });
/** 単位は駆動（電圧か力）で変わる。{u} を V か N に置き換える */
export const PID_UNITS: Record<PidKey, string> = {
  kpa: '{u}/rad',
  kda: '{u}·s/rad',
  kia: '{u}/(rad·s)',
  kpx: 'rad/m',
  kdx: 'rad·s/m',
  kix: 'rad/(m·s)',
};
export const PID: ParamDef[] = [
  gain(
    'kpa',
    'KPθ',
    '<i>K</i><sub>P<i>θ</i></sub>',
    '角度の比例',
    '角度のループ: 目標からの角度のずれに掛ける。倒れる向きへ台車を動かす',
    'V/rad',
    180,
    1e4,
  ),
  gain(
    'kda',
    'KDθ',
    '<i>K</i><sub>D<i>θ</i></sub>',
    '角度の微分',
    '角度のループ: 角速度（推定値）に掛ける。振子の揺れを抑える',
    'V·s/rad',
    27,
    1e3,
  ),
  gain(
    'kpx',
    'KPx',
    '<i>K</i><sub>P<i>x</i></sub>',
    '位置の比例',
    '位置のループ: 位置のずれから角度の目標を作る。目標の方へ振子を傾けて台車を運ぶ',
    'rad/m',
    0.22,
    10,
  ),
  gain(
    'kdx',
    'KDx',
    '<i>K</i><sub>D<i>x</i></sub>',
    '位置の微分',
    '位置のループ: 台車の速度（推定値）に掛け、角度の目標から引く',
    'rad·s/m',
    0.27,
    10,
  ),
  gain(
    'kia',
    'KIθ',
    '<i>K</i><sub>I<i>θ</i></sub>',
    '角度の積分',
    '角度のループ: 角度のずれの積分に掛ける（飽和の向きには積まない）',
    'V/(rad·s)',
    0,
    1e4,
  ),
  gain(
    'kix',
    'KIx',
    '<i>K</i><sub>I<i>x</i></sub>',
    '位置の積分',
    '位置のループ: 位置のずれの積分に掛ける。摩擦で残る位置のずれを消す',
    'rad/(m·s)',
    0,
    10,
  ),
];

export type SwingKey = 'ke' | 'amax' | 'thsw' | 'th0';
export const SWING: ParamDef[] = [
  e24({
    k: 'ke',
    nm: 'k',
    sym: '<i>k</i>',
    name: 'エネルギーのゲイン',
    sub: '振子のエネルギーの不足（mgl を 1 とした値）に掛け、台車の加速度にする。大きいほど少ない往復で振り上げる',
    unit: '',
    min: 0.1,
    max: 100,
    v: 10,
    tk: decades(0.1, 100),
  }),
  e24({
    k: 'amax',
    nm: 'amax',
    sym: '<i>a</i><sub>max</sub>',
    name: '加速度の上限',
    sub: '振り上げで台車に出す加速度の上限。大きいほど速く振り上げるが、台車が大きく動く',
    unit: U('m/s²'),
    min: 0.5,
    max: 50,
    v: 6,
    tk: decades(1, 10),
  }),
  {
    k: 'thsw',
    nm: 'θsw',
    sym: '<i>θ</i><sub>sw</sub>',
    name: '切り替える角度',
    sub: '振子が真上からこの角度の内側に入ったら、振り上げから安定化の制御へ切り替える。外へ出たら（この角度 + 10° か 30° の大きい方）倒れたとみなす',
    unit: '°',
    min: 2,
    max: 60,
    v: 20,
    lin: { step: 1, big: 5, major: 10, minor: 5 },
    notation: 'plain',
    inputmode: 'decimal',
    bad: BAD,
    ph: '例 20',
    pre: [
      [10, '10'],
      [20, '20'],
      [30, '30'],
    ],
    tk: [
      [10, '10'],
      [30, '30'],
      [50, '50'],
    ],
  },
  {
    k: 'th0',
    nm: 'θ0',
    sym: '<i>θ</i><sub>0</sub>',
    name: '初めの傾き',
    sub: '振り上げないときに、手で立てて離す角度（真上から、右が正）',
    unit: '°',
    min: -30,
    max: 30,
    v: 3,
    lin: { step: 0.5, big: 5, major: 10, minor: 5 },
    sign: 'any',
    notation: 'plain',
    inputmode: 'decimal',
    bad: '読めない値です（例 −3・2.5）',
    ph: '例 3',
    pre: [
      [-5, '−5'],
      [0, '0'],
      [3, '3'],
      [10, '10'],
    ],
    tk: [
      [-30, '−30'],
      [0, '0'],
      [30, '30'],
    ],
  },
];

/* ---------- 図 ---------- */
export const PUSH: ParamDef = e24({
  k: 'push',
  nm: 'P',
  sym: '<i>P</i>',
  name: '押す強さ',
  sub: '図を押したり、押すボタンで加える力積（力 × 時間）。軽く指で弾くと 0.05 N·s ほど',
  unit: U('N·s'),
  min: 0.001,
  max: 2,
  v: 0.05,
  pre: [
    [0.02, '0.02'],
    [0.05, '0.05'],
    [0.1, '0.1'],
    [0.2, '0.2'],
  ],
  tk: decades(0.001, 1),
});
/** 再生の速さ */
export const SPEEDS = [1, 0.5, 0.2, 0.1] as const;

/* ---------- 教材のプリセット ---------- */
export interface Preset {
  v: string;
  name: string;
  title: string;
  drive: 'motor' | 'force';
  vals: Partial<Record<PlantKey | DriveKey, number>>;
}
/** Quanser IP02（台車・モータ）の値（config_ip02.m）。おもりなしは台車 0.57 kg・粘性摩擦 4.3 N·s/m */
const IP02 = { rail: 0.814, vmax: 10, kt: 7.67, rm: 2.6, kg: 3.71, rp: 6.35, jm: 3.9 };
/** Quanser SIP の振子（config_sp.m）。慣性モーメントは長さ Lp の一様な棒の近似 Mp·Lp²/12 */
const LONG = { m: 0.23, l: 330.2, J: 78.838, bp: 0.0024 },
  MEDIUM = { m: 0.127, l: 177.8, J: 11.987, bp: 0.0024 };
export const PRESETS: Preset[] = [
  {
    v: 'ip02w',
    name: 'IP02・長い振子・おもり',
    title: 'Quanser IP02 におもり（0.37 kg）を載せ、長い振子（全長 641 mm）を付けたもの',
    drive: 'motor',
    vals: { ...IP02, ...LONG, M: 0.94, bc: 5.4 },
  },
  {
    v: 'ip02',
    name: 'IP02・長い振子',
    title: 'Quanser IP02 に長い振子（全長 641 mm）を付けたもの',
    drive: 'motor',
    vals: { ...IP02, ...LONG, M: 0.57, bc: 4.3 },
  },
  {
    v: 'ip02m',
    name: 'IP02・中くらいの振子',
    title: 'Quanser IP02 に中くらいの振子（全長 337 mm）を付けたもの',
    drive: 'motor',
    vals: { ...IP02, ...MEDIUM, M: 0.57, bc: 4.3 },
  },
  {
    v: 'ctms',
    name: 'CTMS の例題',
    title: 'Control Tutorials for MATLAB & Simulink の倒立振子の例題（力で駆動、軸の摩擦なし）',
    drive: 'force',
    vals: { M: 0.5, m: 0.2, l: 300, J: 60, bc: 0.1, bp: 0 },
  },
];

/**
 * 車種ごとのモードの表と諸元。基本波の周波数ごとに、非同期（キャリアの周波数）か同期（基本波の倍率）かを決める。
 * 表の値は公開されている推定値（Theory.astro の出典）を手で写したもので、メーカーの値ではない。
 * m は変調率（基本波の大きさとキャリアの大きさの比）で、1 を超えると基本波の頭が平らになる
 */

/** 表の 1 行。基本波の周波数 f [Hz] から次の行の f までに使う */
export type Mode =
  | { f: number; sync: false; fc0: number; fc1: number; m0: number; m1: number }
  | { f: number; sync: true; n: number; m0: number; m1: number };

const asy = (f: number, fc0: number, fc1: number, m0: number, m1: number): Mode => ({
  f,
  sync: false,
  fc0,
  fc1,
  m0,
  m1,
});
const syn = (f: number, n: number, m0: number, m1: number): Mode => ({ f, sync: true, n, m0, m1 });
/** 1 パルス: 基本波 1 周期にオン・オフが 1 回 */
const one = (f: number): Mode => syn(f, 1, 2, 2);

export interface Car {
  id: CarId;
  name: string;
  /** 制御装置（ボタンの title に出す） */
  sub: string;
  /** 歯車比 */
  gear: number;
  /** 起動加速度・減速度 [km/h/s] */
  a0: number;
  b0: number;
  /** 電気ブレーキが切れる速度 [km/h]。0 なら止まるまで効く */
  vEnd: number;
  /** 車体の長さと台車の中心の間隔 [m] */
  len: number;
  bogie: number;
  /** 編成の両数 */
  cars: number;
  acc: readonly Mode[];
  brk: readonly Mode[];
}
export type CarId =
  | 'tokyu5000'
  | 'tokyu9000'
  | 'keikyu'
  | 'e233'
  | 'jrw207'
  | 'hankyu8300'
  | 'hanshin5500'
  | 'nagoya6000';

/**
 * 京急の発車直後: キャリアを段階的に上げる。音はキャリアの 2 倍が主なので、表の 1 オクターブ上で鳴る。
 * キャリアの値は推定値のまま。切り替える基本波の周波数は、自動運転で音が 0.14 秒ごとの等間隔に変わるよう
 * ユーザーの希望で決めた（基本波は 1.4 t + 0.792 t² Hz で上がるので、t = 0.14 i の値。推定値の 5.6 Hz より低い）。
 * 速度がほとんど出ていなくても、すべり周波数で上がる
 */
const K_NOTES: readonly (readonly [number, number])[] = [
  [0, 175],
  [0.212, 196],
  [0.454, 223],
  [0.728, 233],
  [1.032, 262],
  [1.368, 294],
  [1.735, 311],
  [2.133, 350],
  [2.561, 400],
];
const kM = (f: number): number => 0.1 + (f / 24) * (0.5639 - 0.1);

export const CARS: Record<CarId, Car> = {
  tokyu5000: {
    id: 'tokyu5000',
    name: '東急 5000系',
    sub: '日立 IGBT',
    gear: 87 / 14,
    a0: 3.3,
    b0: 3.5,
    vEnd: 0,
    len: 20,
    bogie: 13.8,
    cars: 10,
    acc: [
      asy(0, 740, 740, 0, 0.457),
      asy(22, 740, 700, 0.457, 0.952),
      asy(45.7, 700, 1800, 0.952, 1.45),
      syn(56, 3, 1, 1.6),
      one(59.5),
    ],
    brk: [
      asy(0, 200, 200, 0, 0.068),
      asy(4, 740, 740, 0.068, 0.39),
      asy(22.5, 740, 700, 0.39, 0.906),
      asy(52, 700, 1680, 0.906, 1.34),
      syn(65.5, 3, 1, 1.6),
      one(71.5),
    ],
  },
  tokyu9000: {
    id: 'tokyu9000',
    name: '東急 9000系',
    sub: '日立 GTO',
    gear: 85 / 14,
    a0: 3.1,
    b0: 3.5,
    vEnd: 4,
    len: 20,
    bogie: 13.8,
    cars: 8,
    acc: [
      asy(0, 200, 200, 0, 0.148),
      syn(6, 45, 0.148, 0.172),
      syn(7, 27, 0.174, 0.397),
      syn(16, 15, 0.397, 0.697),
      syn(28, 9, 0.664, 0.853),
      // biome-ignore lint/suspicious/noApproximativeNumericConstant: 表の値で、√2/2 の意味はない
      syn(36, 5, 0.707, 0.843),
      syn(43, 3, 0.851, 1.2),
      syn(48.5, 3, 1.2, 1.7),
      one(51),
    ],
    brk: [
      asy(0, 200, 200, 0.1, 0.121),
      syn(6, 45, 0.121, 0.162),
      syn(8, 27, 0.164, 0.327),
      syn(16, 15, 0.326, 0.552),
      syn(27, 9, 0.526, 0.819),
      syn(42, 5, 0.679, 0.839),
      syn(52, 3, 0.847, 1.2),
      syn(56.5, 3, 1.2, 1.7),
      one(62),
    ],
  },
  keikyu: {
    id: 'keikyu',
    name: '京急 新1000形',
    sub: 'シーメンス GTO',
    gear: 83 / 14,
    a0: 3.5,
    b0: 4,
    vEnd: 7,
    len: 18,
    bogie: 12,
    cars: 8,
    acc: [
      ...K_NOTES.map(([f, fc], i) => asy(f, fc, fc, kM(f), kM(K_NOTES[i + 1]?.[0] ?? 24))),
      syn(24, 15, 0.564, 0.622),
      syn(27, 13, 0.622, 0.68),
      syn(30, 11, 0.68, 0.809),
      syn(36.7, 9, 0.809, 0.941),
      syn(43.5, 7, 0.941, 1.19),
      syn(57, 5, 1.19, 1.24),
      syn(59, 3, 1.24, 1.7),
      one(80),
    ],
    brk: [
      asy(0, 400, 400, 0.154, 0.154),
      asy(4, 400, 400, 0.154, 0.403),
      syn(22.4, 15, 0.403, 0.436),
      syn(24.9, 13, 0.436, 0.49),
      syn(28.9, 11, 0.49, 0.566),
      syn(34.5, 9, 0.566, 0.654),
      syn(41, 7, 0.654, 1.07),
      syn(63.35, 5, 1.07, 1.21),
      syn(70.7, 3, 1.21, 1.7),
      one(79.5),
    ],
  },
  e233: {
    id: 'e233',
    name: 'E233系 1000番台',
    sub: 'JR東日本・三菱 IGBT',
    gear: 6.06,
    a0: 2.5,
    b0: 5,
    vEnd: 0,
    len: 20,
    bogie: 13.8,
    cars: 10,
    acc: [asy(0, 750, 750, 0, 1.29), syn(48.5, 3, 0.9, 0.98), one(54.5)],
    brk: [asy(0, 750, 750, 0, 1.1), syn(61.5, 3, 0.85, 0.98), one(70.5)],
  },
  jrw207: {
    id: 'jrw207',
    name: '207系 1000番台',
    sub: 'JR西日本・東芝 GTO',
    gear: 99 / 14,
    a0: 2.7,
    b0: 3.5,
    vEnd: 5.5,
    len: 20,
    bogie: 13.8,
    cars: 7,
    acc: [
      asy(0, 365, 365, 0, 0.295),
      syn(14, 15, 0.295, 0.655),
      syn(31, 9, 0.655, 0.931),
      syn(44, 5, 0.734, 0.883),
      syn(53, 3, 0.888, 1),
      one(60),
    ],
    brk: [
      syn(0, 27, 0.127, 0.127),
      syn(8, 27, 0.127, 0.222),
      syn(14, 15, 0.22, 0.475),
      syn(30, 9, 0.475, 0.793),
      syn(50, 5, 0.626, 0.813),
      syn(65, 3, 0.822, 1),
      one(80),
    ],
  },
  hankyu8300: {
    id: 'hankyu8300',
    name: '阪急 8300系',
    sub: '東洋電機製造 GTO',
    gear: 5.25,
    a0: 2.6,
    b0: 3.7,
    vEnd: 6.5,
    len: 18.9,
    bogie: 12.6,
    cars: 8,
    acc: [
      asy(0, 180, 180, 0, 0.271),
      syn(12, 21, 0.271, 0.413),
      syn(18, 15, 0.413, 0.6),
      syn(26, 9, 0.606, 0.907),
      syn(38.8, 5, 0.713, 0.85),
      syn(46.2, 3, 0.853, 0.99),
      one(53.7),
    ],
    brk: [
      syn(0, 21, 0.105, 0.105),
      syn(7, 21, 0.105, 0.261),
      syn(16.3, 15, 0.26, 0.366),
      syn(22.7, 9, 0.37, 0.658),
      syn(40, 5, 0.517, 0.793),
      syn(61, 3, 0.798, 0.99),
      one(76),
    ],
  },
  hanshin5500: {
    id: 'hanshin5500',
    name: '阪神 5500系',
    sub: '三菱 GTO',
    gear: 99 / 14,
    a0: 4,
    b0: 4.5,
    vEnd: 4,
    len: 19,
    bogie: 12.6,
    cars: 4,
    acc: [
      asy(0, 220, 220, 0, 0.044),
      asy(2, 220, 400, 0.044, 0.339),
      asy(15, 400, 400, 0.339, 0.828),
      syn(36.5, 9, 0.826, 0.905),
      syn(40, 5, 0.715, 0.839),
      syn(47, 3, 0.847, 1),
      one(56),
    ],
    brk: [
      asy(0, 275, 275, 0.123, 0.123),
      asy(6, 275, 400, 0.123, 0.311),
      asy(15, 400, 400, 0.311, 0.76),
      syn(36.5, 9, 0.758, 0.831),
      syn(40, 5, 0.657, 0.828),
      syn(50.5, 3, 0.837, 1),
      one(61),
    ],
  },
  nagoya6000: {
    id: 'nagoya6000',
    name: '名古屋市営 6000形',
    sub: 'GTO（更新前）',
    gear: 99 / 16,
    a0: 3,
    b0: 3.5,
    vEnd: 7.5,
    len: 20,
    bogie: 13.8,
    cars: 5,
    acc: [
      syn(0, 45, 0, 0.191),
      syn(8.5, 27, 0.191, 0.385),
      syn(17, 15, 0.384, 0.65),
      syn(33, 9, 0.645, 0.897),
      syn(42, 5, 0.7, 0.814),
      syn(48, 3, 0.82, 0.95),
      one(56),
    ],
    brk: [
      syn(0, 27, 0.144, 0.144),
      syn(9.4, 27, 0.144, 0.229),
      syn(14.87, 15, 0.229, 0.5),
      syn(28.5, 9, 0.5, 0.915),
      syn(48, 5, 0.72, 0.85),
      syn(63.5, 3, 0.857, 0.92),
      one(81),
    ],
  },
};

/** 車輪の直径 [m] と極対数（公表値を確かめていない仮定。Theory.astro の「このツールで決めたこと」） */
export const WHEEL = 0.86;
export const POLES = 2;
/** 手で運転するときの上限の速度 [km/h] */
export const V_MAX = 110;
/** 電気ブレーキのすべり周波数 [Hz]（仮定） */
const SLIP_BRAKE = 1.2;

/** 速度 1 km/h あたりの回転周波数 [Hz]（モーターの回転と電気の周波数の比） */
export const hzPerKmh = (c: Car): number => (POLES * c.gear) / (Math.PI * WHEEL) / 3.6;

/** 台車の車軸の間隔 [m]（仮定） */
const AXLES = 2.1;
/**
 * 編成の全車軸の位置 [m]。聞く車両の中央を 0、前を正として前から順に並べる。聞く車両は編成の真ん中あたりとする。
 * 継ぎ目は前の車軸から順に踏む
 */
export function axleOffsets(c: Car): number[] {
  const first = Math.ceil(c.cars / 2) - 1,
    out: number[] = [];
  for (let j = first; j > first - c.cars; j--)
    for (const b of [c.bogie / 2, -c.bogie / 2]) out.push(j * c.len + b + AXLES / 2, j * c.len + b - AXLES / 2);
  return out;
}

/** 聞く席の位置 [m]。連結部寄りは後ろの車端から 0.5 m で、録音の打音の大きさから推定した位置 */
export const seatAt = (c: Car, end: boolean): number => (end ? 0.5 - c.len / 2 : 0);

/** 今の運転の様子 */
export interface Run {
  /** 速度 [km/h] */
  v: number;
  /** 加速度 [km/h/s]。減速は負 */
  a: number;
  /** 加速中か・電気ブレーキ中か */
  power: boolean;
  brake: boolean;
  /** 加速のすべり周波数 [Hz]（トルクの指令に合わせて速く立ち上がる。Drive が決める） */
  slip?: number;
}

/** 基本波の周波数 [Hz]: 回転の周波数にすべりを足す（ブレーキでは引く） */
export const f1Of = (c: Car, r: Run, scale = 1): number => {
  const fr = hzPerKmh(c) * r.v * scale;
  return r.brake ? Math.max(0, fr + (r.a / c.b0) * SLIP_BRAKE) : fr + (r.power ? (r.slip ?? 0) : 0);
};

/** スイッチが動いているか。電気ブレーキは vEnd より遅いと切れる */
export const gateOn = (c: Car, r: Run): boolean => r.power || (r.brake && r.v >= c.vEnd);

/** 表から今の行とキャリア・変調率を引く */
export function pick(tab: readonly Mode[], f: number): { s: Mode; m: number; fc: number } {
  let i = 0;
  while (i + 1 < tab.length && tab[i + 1].f <= f) i++;
  const s = tab[i],
    next = tab[i + 1]?.f ?? s.f + 1,
    q = Math.min(1, Math.max(0, (f - s.f) / (next - s.f))),
    fc = s.sync ? s.n * f : s.fc0 + (s.fc1 - s.fc0) * q;
  return { s, m: s.m0 + (s.m1 - s.m0) * q, fc };
}

/** 図と数値に出す今のモード */
export interface ModeNow {
  f1: number;
  fc: number;
  m: number;
  sync: boolean;
  /** 同期の倍率（非同期は 0） */
  n: number;
  on: boolean;
  /** 1 パルスか */
  one: boolean;
}
export function modeOf(c: Car, r: Run): ModeNow {
  const f1 = f1Of(c, r),
    p = pick(r.brake ? c.brk : c.acc, f1),
    n = p.s.sync ? p.s.n : 0;
  return { f1, fc: p.fc, m: p.m, sync: p.s.sync, n, on: gateOn(c, r), one: n === 1 };
}

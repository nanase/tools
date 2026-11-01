/**
 * ローリングシャッターのページの題材の寸法と動き（シェーダと同じ式）、計算結果。DOM を使わない
 *
 * 時刻 t [s] は撮影の基準からの時刻で、行 s（0 が最初に読む行、1 が最後の行）の露光は t0 + s·Tr から t0 + s·Tr + Te まで
 */

export type Subject = 'prop' | 'train' | 'car' | 'golf' | 'moto' | 'heli';
export const SUBJECTS: readonly (readonly [Subject, string])[] = [
  ['prop', 'プロペラ'],
  ['train', '電車'],
  ['car', '自動車'],
  ['golf', 'ゴルフ'],
  ['moto', 'モトクロス'],
  ['heli', 'ヘリコプター'],
];

/** 画面の範囲 [m]: 左下 x・y、幅、高さ（16:9） */
export type View = readonly [number, number, number, number];
const view = (x0: number, y0: number, w: number): View => [x0, y0, w, (w * 9) / 16];

/* ---------- プロペラ（画面の高さを 2 とした単位） ---------- */
/** 羽の先の半径（画面の高さの半分を 1 とする） */
export const PROP_R = 0.9;

/* ---------- 電車・自動車・自転車: 一定の速さで横に動く ---------- */
export interface Mover {
  /** 車体の絵の範囲（車体の座標、m）: 左下 x・y、幅、高さ */
  body: readonly [number, number, number, number];
  /** くり返しの長さ（0 はくり返さない） */
  period: number;
  /** 車輪の中心の x（車体の座標）と、その高さ・半径 */
  wheels: readonly number[];
  wy: number;
  wr: number;
}
export const TRAIN_VIEW = view(-9.5, -1.8, 19);
/** 20 m の車両（連結面の間 20.5 m）をくり返す。台車の中心の間 13.8 m・軸距 2.1 m・車輪の直径 860 mm */
export const TRAIN: Mover = {
  body: [0, -0.6, 20.5, 6],
  period: 20.5,
  wheels: [2.3, 4.4, 16.1, 18.2],
  wy: 0.43,
  wr: 0.43,
};
export const CAR_VIEW = view(-3.5, -0.6, 7);
/** 全長 4.5 m・軸距 2.66 m・タイヤの直径 640 mm */
export const CAR: Mover = { body: [-2.6, -0.12, 5.2, 1.72], period: 0, wheels: [-1.33, 1.33], wy: 0.32, wr: 0.32 };
/** 車の手前の車線を走る自転車（路面 y = −0.35、車輪の直径 680 mm） */
export const BIKE: Mover = { body: [-1, -0.42, 2, 2.04], period: 0, wheels: [-0.52, 0.52], wy: -0.01, wr: 0.34 };
/** 走査の中ほどで車体の中心が来る位置 [m] */
export const TRAIN_MID = 0;
export const CAR_MID = 0.3;
export const BIKE_MID = -1.5;

/* ---------- ゴルフ: 正面から見たスイング（腕と手首の 2 つの角） ---------- */
export const GOLF_VIEW = view(-2, -0.25, 4);
export const GOLF = {
  /** 腕が回る中心（両肩の間）と両肩 */
  pivot: [0, 1.42] as const,
  shoulders: [
    [-0.19, 1.44],
    [0.19, 1.44],
  ] as const,
  /** 画面に写る腕とクラブの長さ（スイング面が傾いているので実際より短い） */
  la: 0.55,
  lc: 0.83,
  /** 実際の長さ（ヘッドスピードの換算に使う） */
  la3: 0.62,
  lc3: 1.14,
  /** 球の半径 */
  ball: 0.0214,
  /** 打ち出しの角度 [rad] とミート率（球の速さ / ヘッドスピード） */
  launch: 0.21,
  smash: 1.45,
};
const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
/**
 * スイングの角（基準の速さの時刻 τ、インパクトが 0）。腕の向き φa と、クラブの向き φc（x 軸から反時計回り、rad）。
 * 腕は tanh で加速と減速をし、手首の角（φc − φa）はインパクトの直前にほどける
 */
export function golfAngles(tau: number): [number, number] {
  const pa = -Math.PI / 2 + 2.4 * Math.tanh(tau / 0.2);
  const d = -1.7 * logistic(-(tau + 0.035) / 0.03) + 1.1 * logistic((tau - 0.06) / 0.05);
  return [pa, pa + d];
}
/** 手とヘッドの位置（画面の m）。base の時刻 τ で */
export function golfPoints(tau: number): { hand: [number, number]; head: [number, number] } {
  const [pa, pc] = golfAngles(tau);
  const hand: [number, number] = [GOLF.pivot[0] + GOLF.la * Math.cos(pa), GOLF.pivot[1] + GOLF.la * Math.sin(pa)];
  return { hand, head: [hand[0] + GOLF.lc * Math.cos(pc), hand[1] + GOLF.lc * Math.sin(pc)] };
}
/** 基準の時刻でのヘッドの速さ（実際の長さで換算、m/s） */
function golfHeadSpeedBase(tau: number): number {
  const h = 1e-4;
  const p = (t: number) => {
    const [pa, pc] = golfAngles(t);
    return [GOLF.la3 * Math.cos(pa) + GOLF.lc3 * Math.cos(pc), GOLF.la3 * Math.sin(pa) + GOLF.lc3 * Math.sin(pc)];
  };
  const a = p(tau - h);
  const b = p(tau + h);
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * h);
}
/** 基準の動きのインパクトでのヘッドスピード。入力のヘッドスピード V なら、時間を V / GOLF_V0 倍に縮める */
export const GOLF_V0 = golfHeadSpeedBase(0);
/** 球の位置（インパクトの前はティーの上） */
export const GOLF_BALL0: readonly [number, number] = (() => {
  const { head } = golfPoints(0);
  return [head[0], GOLF.ball + 0.012] as const;
})();

/* ---------- モトクロス: ジャンプ台から放物線を描き、空中で 1 回転（バックフリップ） ---------- */
export const MOTO_VIEW = view(-5.5, -0.2, 11);
export const G = 9.80665;
export const MOTO = {
  /** 踏み切りの位置（後輪と前輪の中点）と速さ */
  lip: [-10.9, 1.6] as const,
  vx: 14,
  vy: 7.5,
  /** 踏み切りの車体の傾き [rad] と、着地までの時間 */
  pitch0: 0.5,
  flight: 1.6,
  /** 着地のときの傾き（前下がり） */
  pitch1: -0.35 + Math.PI * 2,
  /** 車輪の中心（車体の座標）・半径・空中で回る角速度 */
  hubs: [-0.74, 0.74] as const,
  wr: 0.33,
  spin: 40,
  /** 車体の絵の範囲（車体の座標） */
  body: [-1.25, -0.42, 2.5, 2.25] as const,
};
/** 回転の角速度 [rad/s]（反時計回り、前輪が上がる向き） */
export const MOTO_W = (MOTO.pitch1 - MOTO.pitch0) / MOTO.flight;
export function motoPose(t: number): { x: number; y: number; a: number } {
  return { x: MOTO.lip[0] + MOTO.vx * t, y: MOTO.lip[1] + MOTO.vy * t - (G * t * t) / 2, a: MOTO.pitch0 + MOTO_W * t };
}

/* ---------- ヘリコプター: 少し見下ろした横から。主ローターは水平の円盤（縦につぶれる） ---------- */
export const HELI_VIEW = view(-8.3, -1.3, 14);
export const HELI = {
  /** 主ローターの中心・半径・羽の数・翼弦、円盤のつぶれ（見下ろす角の sin） */
  mast: [0.3, 3.15] as const,
  R: 5,
  blades: 4,
  chord: 0.3,
  squash: 0.32,
  /** テールローターの中心・半径・羽の数・主ローターとの回転の比 */
  tail: [-7.05, 2.55] as const,
  Rt: 0.8,
  tailBlades: 2,
  tailRatio: 5.2,
  /** 機体の絵の範囲 */
  body: [-7.9, 0.55, 12.2, 3.1] as const,
};

/* ---------- 計算結果 ---------- */
export interface Inputs {
  tr: number;
  te: number;
  /** 題材の時刻（ゴルフはインパクトからの実際の時間、モトクロスは踏み切りからの時間） */
  t: number;
  rps: number;
  nb: number;
  kmh: number;
  bike: number;
  /** ゴルフのヘッドスピード [m/s] */
  vs: number;
  /** ヘリコプターの主ローターの回転数 [回/s] */
  rotor: number;
  /** 走査の向き。1 は左から右（省略は上から下） */
  dir?: 0 | 1;
}
export type Metric = readonly [name: string, value: number | null, unit: string];

const deg = (r: number) => (r * 180) / Math.PI;
/** 上端と下端の時間差 Tr の間に動く量など、題材ごとに 4 つ（先頭が大きく出す値） */
export function metrics(s: Subject, p: Inputs): Metric[] {
  const { tr, te } = p;
  switch (s) {
    case 'prop': {
      const r = p.rps * tr;
      return [
        ['1 走査の回転', r, '回'],
        ['羽が通る回数', r * p.nb, '回'],
        ['露光中の回転', 360 * p.rps * te, '°'],
        ['羽の先の速さ', 2 * Math.PI * PROP_R * p.rps, 'm/s'],
      ];
    }
    case 'train':
    case 'car': {
      const v = p.kmh / 3.6;
      const V = s === 'train' ? TRAIN_VIEW : CAR_VIEW;
      const H = V[3];
      const d = v * tr;
      if (p.dir === 1) {
        /* 走査と同じ向きに動くので、傾かずに走査の速さ W / Tr との差の分だけ伸びる。追い越すと形にならない */
        const grow = (x: number): number | null => (x < V[2] ? 1 / (1 - x / V[2]) : null);
        return [
          ['1 走査の移動', d, 'm'],
          ['車体の伸び', grow(d), '倍'],
          s === 'car'
            ? ['自転車の伸び', grow((p.bike / 3.6) * tr), '倍']
            : ['1 走査の車輪の回転', d / (2 * Math.PI * TRAIN.wr), '回'],
          ['露光中の流れ', v * te * 1e3, 'mm'],
        ];
      }
      const lean = (x: number) => deg(Math.atan(x / H));
      if (s === 'car')
        return [
          ['上端と下端のずれ', d, 'm'],
          ['縦の線の傾き', lean(d), '°'],
          ['自転車の傾き', lean((p.bike / 3.6) * tr), '°'],
          ['露光中の流れ', v * te * 1e3, 'mm'],
        ];
      return [
        ['上端と下端のずれ', d, 'm'],
        ['縦の線の傾き', lean(d), '°'],
        ['1 走査の車輪の回転', d / (2 * Math.PI * TRAIN.wr), '回'],
        ['露光中の流れ', v * te * 1e3, 'mm'],
      ];
    }
    case 'golf': {
      const k = p.vs / GOLF_V0;
      const h = 1e-4;
      const w = ((golfAngles(p.t * k + h)[1] - golfAngles(p.t * k - h)[1]) / (2 * h)) * k;
      return [
        ['1 走査のクラブの回転', deg(w * tr), '°'],
        ['クラブの角速度', deg(w), '°/s'],
        ['ヘッドの速さ', golfHeadSpeedBase(p.t * k) * k, 'm/s'],
        ['露光中のヘッドの移動', golfHeadSpeedBase(p.t * k) * k * te * 1e3, 'mm'],
      ];
    }
    case 'moto': {
      const vy = MOTO.vy - G * p.t;
      return [
        ['1 走査の車体の回転', deg(MOTO_W * tr), '°'],
        ['1 走査の車輪の回転', (MOTO.spin * tr) / (2 * Math.PI), '回'],
        ['1 走査の移動', MOTO.vx * tr, 'm'],
        ['露光中の流れ', Math.hypot(MOTO.vx, vy) * te * 1e3, 'mm'],
      ];
    }
    case 'heli':
      return [
        ['1 走査のローターの回転', p.rotor * tr, '回'],
        ['テールローターの回転', p.rotor * HELI.tailRatio * tr, '回'],
        ['羽の先の速さ', 2 * Math.PI * HELI.R * p.rotor, 'm/s'],
        ['露光中の羽の先の移動', 2 * Math.PI * HELI.R * p.rotor * te, 'm'],
      ];
  }
}

/**
 * 露光の間に動く最も速い点の速さ [m/s] と画面の高さ [m]。平均する時刻の数（露光の間に動く画素の数）を決める
 */
export function fastest(s: Subject, p: Inputs): [number, number] {
  switch (s) {
    case 'prop':
      return [2 * Math.PI * PROP_R * p.rps, 2];
    case 'train':
      return [p.kmh / 3.6, TRAIN_VIEW[3]];
    case 'car':
      return [Math.max(p.kmh, p.bike) / 3.6, CAR_VIEW[3]];
    case 'golf':
      return [p.vs, GOLF_VIEW[3]];
    case 'moto':
      return [MOTO.spin * MOTO.wr + Math.hypot(MOTO.vx, MOTO.vy) + MOTO_W * 1.2, MOTO_VIEW[3]];
    case 'heli':
      return [2 * Math.PI * HELI.R * p.rotor, HELI_VIEW[3]];
  }
}

/**
 * 画面の同じ所の明るさが 1 秒に何回変わりうるか（羽が通る回数など）。走査のスロー再生で、
 * これが 1 秒に 2 回を超えないように走査 1 回に掛ける時間を延ばす（光の点滅で発作を起こさないため）
 */
export function flicker(s: Subject, p: Inputs): number {
  switch (s) {
    case 'prop':
      return p.rps * p.nb;
    case 'heli':
      return Math.max(p.rotor * HELI.blades, p.rotor * HELI.tailRatio * HELI.tailBlades);
    case 'moto':
      return (MOTO.spin / (2 * Math.PI)) * 6;
    default:
      return 0;
  }
}

/** 題材の時刻の範囲 [s]（ゴルフ・モトクロス） */
export const T_RANGE: Partial<Record<Subject, readonly [number, number]>> = {
  golf: [-0.3, 0.25],
  moto: [0, MOTO.flight],
};

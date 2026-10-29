/**
 * 空気中の音（DOM に依存しない）: 音速と、空気の吸収（ISO 9613-1:1993 の式 (3)〜(5) と水蒸気のモル濃度の式）。
 * 吸収を距離に応じて掛ける低域通過（1 次の低域通過の縦続）も置く。ドップラー効果と雷鳴のページで使う
 */

/** 基準の温度 [K]（20 °C）・三重点の温度 [K]・基準の気圧 [kPa] */
const T0 = 293.15,
  T01 = 273.16,
  PR = 101.325;

/** 気温・湿度・気圧。既定は 20 °C・50 %・101.325 kPa */
export interface Air {
  /** 気温 [°C] */
  t: number;
  /** 相対湿度 [%] */
  rh: number;
  /** 気圧 [kPa] */
  p?: number;
}
export const AIR0: Air = { t: 20, rh: 50 };

/** 音速 [m/s]: 20 °C の 343.2 m/s を、絶対温度の平方根に比例させて換算する（このツールで決めた式） */
export const soundSpeed = (t: number): number => 343.2 * Math.sqrt((t + 273.15) / T0);

/** 水蒸気のモル濃度 [%]（ISO 9613-1 の飽和水蒸気圧の式から） */
export function vapour(a: Air): number {
  const T = a.t + 273.15,
    C = -6.8346 * (T01 / T) ** 1.261 + 4.6151;
  return (a.rh * 10 ** C) / ((a.p ?? PR) / PR);
}

/** 酸素と窒素の緩和周波数 [Hz]（ISO 9613-1 の式 (3)・(4)） */
export function relax(a: Air): { fO: number; fN: number } {
  const T = a.t + 273.15,
    pa = (a.p ?? PR) / PR,
    h = vapour(a);
  return {
    fO: pa * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h)),
    fN: pa * (T / T0) ** -0.5 * (9 + 280 * h * Math.exp(-4.17 * ((T / T0) ** (-1 / 3) - 1))),
  };
}

/** 周波数 f [Hz] の純音の吸収の減衰係数 [dB/m]（ISO 9613-1 の式 (5)） */
export function absorption(f: number, a: Air = AIR0): number {
  const T = a.t + 273.15,
    pa = (a.p ?? PR) / PR,
    { fO, fN } = relax(a),
    f2 = f * f;
  const classical = (1.84e-11 / pa) * Math.sqrt(T / T0),
    vib =
      (T / T0) ** -2.5 *
      ((0.01275 * Math.exp(-2239.1 / T)) / (fO + f2 / fO) + (0.1068 * Math.exp(-3352 / T)) / (fN + f2 / fN));
  return 8.686 * f2 * (classical + vib);
}

/** 1/3 オクターブの中心周波数の正確な値 [Hz]（ISO 9613-1 の表は名目の周波数ではなくこの値で計算してある） */
export const exactMid = (nominal: number): number => 1000 * 10 ** (Math.round(10 * Math.log10(nominal / 1000)) / 10);

/* ---------- 距離に応じた吸収の低域通過 ---------- */

/** 縦続にする 1 次の低域通過の数 */
export const AIR_N = 4;
/** 合わせる減衰 [dB]: 吸収がこの大きさになる周波数で ISO 9613-1 の値にそろえる */
export const AIR_FIT_DB = 10;

/** 1 次の低域通過 y = (1 − a) x + a y₋₁ の 1 段の減衰 [dB]（w は 1 標本あたりの角周波数） */
const stageDb = (a: number, w: number) => 10 * Math.log10((1 - 2 * a * Math.cos(w) + a * a) / ((1 - a) * (1 - a)));

/**
 * 距離 r [m] の吸収を AIR_N 段の 1 次の低域通過で近似したときの係数 a（全段で同じ）。
 * 吸収が AIR_FIT_DB になる周波数（100 Hz〜0.45 fs）で、減衰を absorption()·r に合わせる（二分法）。
 * 低い周波数では減衰が f² に比例し、式 (5) と同じ形になる。減衰が AIR_FIT_DB より大きい所では式より浅い
 */
export function airPole(r: number, fs: number, a: Air = AIR0): number {
  if (r <= 0) return 0;
  const fMax = 0.45 * fs;
  let lo = Math.log(100),
    hi = Math.log(fMax);
  if (absorption(fMax, a) * r <= AIR_FIT_DB) lo = hi;
  else
    for (let i = 0; i < 40; i++) {
      const m = 0.5 * (lo + hi);
      if (absorption(Math.exp(m), a) * r < AIR_FIT_DB) lo = m;
      else hi = m;
    }
  const f = Math.exp(lo),
    w = (2 * Math.PI * f) / fs,
    target = (absorption(f, a) * r) / AIR_N;
  let p0 = 0,
    p1 = 0.9999;
  for (let i = 0; i < 50; i++) {
    const m = 0.5 * (p0 + p1);
    if (stageDb(m, w) < target) p0 = m;
    else p1 = m;
  }
  return p0;
}

/** airPole の係数 a の低域通過を AIR_N 段通したときの、周波数 f [Hz] での減衰 [dB] */
export const airPoleDb = (p: number, f: number, fs: number): number => AIR_N * stageDb(p, (2 * Math.PI * f) / fs);

/** AIR_N 段の 1 次の低域通過（係数は標本ごとに変えてよい） */
export class AirFilter {
  private z = new Float64Array(AIR_N);
  /** 係数 a */
  p = 0;
  step(x: number): number {
    const p = this.p,
      z = this.z;
    let y = x;
    for (let i = 0; i < AIR_N; i++) {
      y = (1 - p) * y + p * z[i];
      z[i] = y;
    }
    return y;
  }
  reset(): void {
    this.z.fill(0);
  }
}

/**
 * 部屋の残響（DOM に依存しない）。残響時間は Eyring の式に空気の吸収を足したもの、残響音は
 * 16 本の遅延線のフィードバック遅延網（FDN。Jot・Chaigne 1991）で作る。
 * 遅延線の出口の 1 次の低域通過で、中音域（500 Hz）と高音域（4 kHz）の残響時間を合わせる。
 * 残響音の大きさは拡散音場の式から決める: 1 m 先の直接音に対する残響音の音圧の比は 1/r_c（r_c は臨界距離）。
 * 直接音は 1 m 先の大きさのまま出し、聴く位置 r [m] の直接音と残響音の比になるように、残響音に r/r_c を掛ける
 */

/** 空気の音速 [m/s] */
const C_AIR = 343;
/** 空気の吸収（強さの減衰率） [1/m]: 4 kHz、20 °C・相対湿度 50 % で 32.8 dB/km（ISO 9613-1）。500 Hz は 1.9 dB/km */
const M_AIR = { mid: 1.9e-3 / 4.343, hi: 32.8e-3 / 4.343 };
/** 残響時間を合わせる周波数 [Hz] */
export const F_MID = 500,
  F_HI = 4000;

/** 部屋: 寸法 [m]、平均吸音率（500 Hz・4 kHz）、聴く位置の既定 [m]、初期反射までの時間 [s] */
export interface Room {
  v: string;
  name: string;
  /** 幅・奥行き・高さ [m] */
  dim: readonly [number, number, number];
  a: number;
  aHi: number;
  r: number;
}
/** 部屋の例（寸法と吸音率はこのツールで選んだ概数） */
export const ROOMS: readonly Room[] = [
  { v: 'off', name: 'なし', dim: [0, 0, 0], a: 1, aHi: 1, r: 1 },
  { v: 'studio', name: '練習室', dim: [5, 4, 3], a: 0.25, aHi: 0.3, r: 2 },
  { v: 'small', name: '小ホール', dim: [30, 18, 10], a: 0.25, aHi: 0.3, r: 8 },
  { v: 'hall', name: '大ホール', dim: [45, 28, 18], a: 0.3, aHi: 0.34, r: 12 },
  { v: 'church', name: '教会', dim: [60, 25, 18], a: 0.12, aHi: 0.18, r: 15 },
];
export const roomOf = (v: string): Room => ROOMS.find((x) => x.v === v) ?? ROOMS[0];

/** 部屋から求めた値 */
export interface RoomAcoustics {
  /** 容積 [m³]・表面積 [m²]・平均自由行程 [m] */
  V: number;
  S: number;
  mfp: number;
  /** 等価吸音面積 [m²]（500 Hz） */
  A: number;
  /** 残響時間 T60 [s]（500 Hz・4 kHz） */
  t60: number;
  t60Hi: number;
  /** 臨界距離 [m]（直接音と残響音が同じ大きさになる距離。無指向性の音源） */
  rc: number;
  /** 初期反射までの時間 [s]（直接音の後、平均自由行程の半分を進む時間） */
  pre: number;
}

/** Eyring の式: T60 = 0.161 V / (−S ln(1 − α) + 4 m V) */
const eyring = (V: number, S: number, a: number, m: number) => (0.161 * V) / (-S * Math.log(1 - a) + 4 * m * V);

export function acoustics(r: Room): RoomAcoustics {
  const [x, y, z] = r.dim,
    V = x * y * z,
    S = 2 * (x * y + y * z + z * x),
    A = -S * Math.log(1 - r.a),
    mfp = (4 * V) / S;
  return {
    V,
    S,
    mfp,
    A,
    t60: eyring(V, S, r.a, M_AIR.mid),
    t60Hi: eyring(V, S, r.aHi, M_AIR.hi),
    rc: Math.sqrt(A / (16 * Math.PI)),
    pre: mfp / 2 / C_AIR,
  };
}

/** 残響の設定（AudioWorklet へ送れる形）。off なら残響なし */
export interface ReverbSpec {
  off: boolean;
  t60: number;
  t60Hi: number;
  /** 残響音に掛ける大きさ（聴く位置 r ÷ 臨界距離 r_c） */
  wet: number;
  pre: number;
  /** 遅延線の長さの目安 [s]（平均自由行程を進む時間） */
  mfpT: number;
}

export function reverbSpec(r: Room, dist: number): ReverbSpec {
  if (r.v === 'off') return { off: true, t60: 1, t60Hi: 1, wet: 0, pre: 0, mfpT: 0.01 };
  const a = acoustics(r);
  return { off: false, t60: a.t60, t60Hi: a.t60Hi, wet: dist / a.rc, pre: a.pre, mfpT: a.mfp / C_AIR };
}

/** 遅延線の数（2 の累乗。アダマール行列で混ぜる） */
const N = 16;
/** 遅延線の長さの比（互いに素に近い比。最も短い線に対する比） */
const RATIOS = [1, 1.13, 1.27, 1.39, 1.51, 1.66, 1.79, 1.93, 2.07, 2.21, 2.37, 2.51, 2.66, 2.83, 2.97, 3.13];
/** 素数（遅延線の長さを互いに素にする） */
function nextPrime(n: number): number {
  const isP = (k: number) => {
    if (k < 2) return false;
    for (let d = 2; d * d <= k; d++) if (k % d === 0) return false;
    return true;
  };
  let k = Math.max(2, Math.round(n));
  while (!isP(k)) k++;
  return k;
}

/** 1 次の低域通過 b0 / (1 − a z⁻¹) の係数。角周波数 w1・w2 で大きさ g1・g2 になるもの */
export function shelf(g1: number, g2: number, w1: number, w2: number): [number, number] {
  const R = (g1 / g2) ** 2,
    c1 = Math.cos(w1),
    c2 = Math.cos(w2);
  let a = 0;
  if (Math.abs(1 - R) > 1e-12) {
    /* (1 − R) a² − 2 (cos w2 − R cos w1) a + (1 − R) = 0 の、|a| < 1 の根 */
    const p = (c2 - R * c1) / (1 - R),
      d = p * p - 1;
    a = d > 0 ? p - Math.sign(p) * Math.sqrt(d) : p;
  }
  return [g1 * Math.sqrt(1 - 2 * a * c1 + a * a), a];
}

/** ステレオの残響。process で、渡した左右の音（直接音）に残響音を足す */
export class Reverb {
  private bufs: Float64Array[] = [];
  private len = new Int32Array(N);
  private pos = new Int32Array(N);
  private b0 = new Float64Array(N);
  private a1 = new Float64Array(N);
  private z = new Float64Array(N);
  private x = new Float64Array(N);
  /** 初期反射までの遅延（左右の和） */
  private pre = new Float64Array(1);
  private pp = 0;
  private gIn = 0;
  private off = true;

  constructor(readonly fs: number) {}

  set(s: ReverbSpec): void {
    this.off = s.off;
    if (s.off) return;
    const fs = this.fs,
      /* 最も短い線は平均自由行程の 0.6 倍（10〜40 ms） */
      m0 = Math.min(0.04, Math.max(0.01, 0.6 * s.mfpT)) * fs;
    let total = 0;
    for (let i = 0; i < N; i++) {
      const m = nextPrime(m0 * RATIOS[i]);
      this.len[i] = m;
      total += m;
      if (this.bufs[i]?.length !== m) this.bufs[i] = new Float64Array(m);
      else this.bufs[i].fill(0);
      this.pos[i] = 0;
      /* 1 回通るごとの減衰: 残響時間で 60 dB */
      const g1 = 10 ** ((-3 * m) / (s.t60 * fs)),
        g2 = 10 ** ((-3 * m) / (s.t60Hi * fs)),
        [b0, a1] = shelf(g1, g2, (2 * Math.PI * F_MID) / fs, (2 * Math.PI * F_HI) / fs);
      this.b0[i] = b0;
      this.a1[i] = a1;
    }
    this.z.fill(0);
    /*
     * 入口の大きさ: 遅延線全体に入ったエネルギーは T60 で 60 dB 減り、出口へは保持する標本数 M のうち
     * 線の数 N の割合で出ていく。インパルス応答のエネルギーが wet² になるようにする
     */
    const decay = (s.t60 * fs) / (6 * Math.log(10));
    this.gIn = s.wet * Math.sqrt(total / (N * decay));
    const np = Math.max(1, Math.round(s.pre * fs));
    if (this.pre.length !== np) this.pre = new Float64Array(np);
    else this.pre.fill(0);
    this.pp = 0;
  }

  /** L・R の off から len 標本に残響音を足す */
  process(L: Float32Array | Float64Array, R: Float32Array | Float64Array, off: number, len: number): void {
    if (this.off) return;
    const { bufs, len: ln, pos, b0, a1, z, x, pre } = this,
      np = pre.length,
      g = this.gIn,
      k = 1 / Math.sqrt(N),
      /* 出口の大きさ: 片側 N/2 本の和のエネルギーが、遅延線 1 標本あたりのエネルギーになるように */
      w = Math.SQRT2 / Math.sqrt(N);
    for (let i = off; i < off + len; i++) {
      /* 初期反射までの遅延（左右の和を入れる） */
      const u = pre[this.pp];
      pre[this.pp] = 0.5 * (L[i] + R[i]);
      this.pp = this.pp + 1 === np ? 0 : this.pp + 1;
      /* 遅延線の出口に低域通過 */
      for (let j = 0; j < N; j++) {
        const y = b0[j] * bufs[j][pos[j]] + a1[j] * z[j];
        z[j] = y;
        x[j] = y;
      }
      /* 出口: 左は偶数番、右は奇数番の線（符号を交互に） */
      let l = 0,
        r = 0;
      for (let j = 0; j < N; j += 2) {
        l += (j & 2 ? -1 : 1) * x[j];
        r += (j & 2 ? -1 : 1) * x[j + 1];
      }
      /* アダマール行列で混ぜる（直交なのでエネルギーを保つ） */
      for (let h = 1; h < N; h *= 2)
        for (let j = 0; j < N; j += 2 * h)
          for (let q = j; q < j + h; q++) {
            const a = x[q],
              b = x[q + h];
            x[q] = a + b;
            x[q + h] = a - b;
          }
      for (let j = 0; j < N; j++) {
        bufs[j][pos[j]] = k * x[j] + (j & 1 ? -g : g) * u;
        pos[j] = pos[j] + 1 === ln[j] ? 0 : pos[j] + 1;
      }
      L[i] += w * l;
      R[i] += w * r;
    }
  }
}

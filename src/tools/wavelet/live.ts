/**
 * 音のスカログラム（DOM に依存しない）。周波数ごとに Morlet の核（ガウスの包絡 × 複素正弦）を持ち、
 * 輪のバッファの 1 時刻で内積をとって 1 列を作る。
 * 行の周波数は核の中心の周波数、包絡の σ は ω0/(2πf)（尺度 s = ω0/(2πf) の Morlet と同じ形）。
 * 大きさは包絡の和で割り、振幅 1 の正弦波がその周波数の行で 1（0 dBFS）になるようにそろえる
 * （スペクトラムアナライザの dBFS と比べられる）
 */
import { W0 } from './cwt';

/** 核の打ち切り（±σ の何倍まで持つか）。4 で包絡は e^(−8) ≈ −70 dB */
export const CUT = 4;

export interface Row {
  f: number;
  /** 包絡の σ（秒） */
  sig: number;
  /** 核の半分の長さ（標本） */
  K: number;
  /** 2 / Σ 包絡 を掛けた核（長さ 2K+1） */
  kr: Float32Array;
  ki: Float32Array;
  /** 何列ごとに計算するか（σ が列の間隔より十分長い低い行は、毎列は計算しない） */
  every: number;
}

/** 下の周波数から上へ、1 オクターブを voices 本で等比に並べる */
export function freqs(fLo: number, fHi: number, voices: number): Float64Array {
  const n = Math.max(1, Math.floor(Math.log2(fHi / fLo) * voices) + 1);
  return Float64Array.from({ length: n }, (_, i) => fLo * 2 ** (i / voices));
}

export class ScaloBank {
  readonly rows: Row[];
  /** 最も長い核の半分（列の時刻は、受け取った最新の標本からこれだけ前） */
  readonly delay: number;
  private n = 0;

  /** hop: 列の間隔（標本） */
  constructor(
    readonly fs: number,
    readonly f: Float64Array,
    readonly hop: number,
    readonly w0 = W0,
  ) {
    this.rows = Array.from(f, (fr) => {
      const sig = w0 / (2 * Math.PI * fr),
        K = Math.ceil(CUT * sig * fs),
        kr = new Float32Array(2 * K + 1),
        ki = new Float32Array(2 * K + 1);
      let s = 0;
      for (let n = -K; n <= K; n++) s += Math.exp(-0.5 * (n / (sig * fs)) ** 2);
      for (let n = -K; n <= K; n++) {
        const e = (2 / s) * Math.exp(-0.5 * (n / (sig * fs)) ** 2),
          ph = (2 * Math.PI * fr * n) / fs;
        kr[n + K] = e * Math.cos(ph);
        ki[n + K] = -e * Math.sin(ph);
      }
      return { f: fr, sig, K, kr, ki, every: Math.max(1, Math.floor((sig * fs) / (2 * hop))) };
    });
    this.delay = this.rows.reduce((m, r) => Math.max(m, r.K), 0);
  }

  /**
   * x の位置 c を中心とした 1 列の振幅を out に書く（行 i は f[i]）。
   * 範囲の外は 0。every を守るなら skip を真にし、計算しない行は前の値のままにする
   */
  column(x: ArrayLike<number>, c: number, out: Float32Array, skip = false): void {
    const L = x.length,
      tick = this.n++;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (skip && tick % r.every) continue;
      const lo = Math.max(0, r.K - c),
        hi = Math.min(2 * r.K, L - 1 - c + r.K);
      let sr = 0,
        si = 0;
      for (let k = lo, j = c - r.K + lo; k <= hi; k++, j++) {
        const v = x[j];
        sr += v * r.kr[k];
        si += v * r.ki[k];
      }
      out[i] = Math.hypot(sr, si);
    }
  }

  /** 1 列あたりの掛け算の回数（すべての行を計算したとき） */
  get cost(): number {
    return this.rows.reduce((s, r) => s + 2 * (2 * r.K + 1), 0);
  }
}

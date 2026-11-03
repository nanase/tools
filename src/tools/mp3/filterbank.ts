/** MP3 のエンコーダの前段（DOM に依存しない）: 入力のローパス、32 帯域の分析、MDCT、エイリアスの低減 */
import { SYNTH_D } from './tables';

const PI = Math.PI;

/* ---------- 窓と余弦の表 ---------- */
const C = Float64Array.from(SYNTH_D, (v) => v / 32);
const MATRIX = new Float64Array(32 * 64);
for (let sb = 0; sb < 32; sb++)
  for (let k = 0; k < 64; k++) MATRIX[sb * 64 + k] = Math.cos(((2 * sb + 1) * (k - 16) * PI) / 64);

/** ブロックの型ごとの窓（0: 通常、1: 開始、2: 短い 12 点、3: 終了） */
export const WINDOWS: readonly Float64Array[] = [
  Float64Array.from({ length: 36 }, (_, i) => Math.sin((PI / 36) * (i + 0.5))),
  Float64Array.from({ length: 36 }, (_, i) =>
    i < 18 ? Math.sin((PI / 36) * (i + 0.5)) : i < 24 ? 1 : i < 30 ? Math.sin((PI / 12) * (i + 0.5 - 18)) : 0,
  ),
  Float64Array.from({ length: 12 }, (_, i) => Math.sin((PI / 12) * (i + 0.5))),
  Float64Array.from({ length: 36 }, (_, i) =>
    i < 6 ? 0 : i < 12 ? Math.sin((PI / 12) * (i + 0.5 - 6)) : i < 18 ? 1 : Math.sin((PI / 36) * (i + 0.5)),
  ),
];
const COS36 = new Float64Array(18 * 36);
for (let k = 0; k < 18; k++)
  for (let i = 0; i < 36; i++) COS36[k * 36 + i] = Math.cos((PI / 72) * (2 * i + 1 + 18) * (2 * k + 1)) / 9;
const COS12 = new Float64Array(6 * 12);
for (let k = 0; k < 6; k++)
  for (let i = 0; i < 12; i++) COS12[k * 12 + i] = Math.cos((PI / 24) * (2 * i + 1 + 6) * (2 * k + 1)) / 3;

/** エイリアスの低減の係数（ISO/IEC 11172-3） */
const CI = [-0.6, -0.535, -0.33, -0.185, -0.095, -0.041, -0.0142, -0.0037];
export const ALIAS_CS = CI.map((c) => 1 / Math.sqrt(1 + c * c));
export const ALIAS_CA = CI.map((c) => c / Math.sqrt(1 + c * c));

export interface Subbands {
  /** [時刻 t][帯域 sb] を 1 次元に並べた列。t は 32 サンプルごと */
  sub: Float64Array;
  T: number;
}

/** 全サンプルを 32 帯域へ分ける */
export function polyphase(x: ArrayLike<number>): Subbands {
  const T = Math.ceil(x.length / 32) + 36,
    sub = new Float64Array(T * 32),
    X = new Float64Array(512),
    Y = new Float64Array(64);
  let p = 0;
  for (let t = 0; t < T; t++) {
    X.copyWithin(32, 0, 480);
    for (let i = 0; i < 32; i++) {
      X[31 - i] = p < x.length ? x[p] : 0;
      p++;
    }
    for (let k = 0; k < 64; k++) {
      let s = 0;
      for (let j = 0; j < 8; j++) s += C[k + 64 * j] * X[k + 64 * j];
      Y[k] = s;
    }
    for (let sb = 0; sb < 32; sb++) {
      let s = 0;
      const o = sb * 64;
      for (let k = 0; k < 64; k++) s += MATRIX[o + k] * Y[k];
      sub[t * 32 + sb] = s;
    }
  }
  return { sub, T };
}

const block = new Float64Array(36);
/** 1 グラニュールの MDCT。g 番目は前のグラニュールと今のグラニュールの 36 時刻を見る。短いブロックは sb * 18 + 3k + w の順に入れる */
export function mdctGranule({ sub, T }: Subbands, g: number, bt: number, xr: Float64Array): void {
  for (let sb = 0; sb < 32; sb++) {
    for (let i = 0; i < 36; i++) {
      const t = (g - 1) * 18 + i;
      const v = t >= 0 && t < T ? sub[t * 32 + sb] : 0;
      /* 周波数の反転: 奇数の帯域の奇数の時刻の符号を変える */
      block[i] = sb & 1 && i & 1 ? -v : v;
    }
    const o = sb * 18;
    if (bt === 2) {
      const w2 = WINDOWS[2];
      for (let w = 0; w < 3; w++)
        for (let k = 0; k < 6; k++) {
          let s = 0;
          for (let i = 0; i < 12; i++) s += w2[i] * block[6 + 6 * w + i] * COS12[k * 12 + i];
          xr[o + 3 * k + w] = s;
        }
    } else {
      const wn = WINDOWS[bt];
      for (let k = 0; k < 18; k++) {
        let s = 0;
        for (let i = 0; i < 36; i++) s += wn[i] * block[i] * COS36[k * 36 + i];
        xr[o + k] = s;
      }
    }
  }
  if (bt === 2) return;
  /* エイリアスの低減（デコーダの逆） */
  for (let sb = 1; sb < 32; sb++)
    for (let i = 0; i < 8; i++) {
      const a = sb * 18 - 1 - i,
        b = sb * 18 + i,
        u = xr[a],
        d = xr[b];
      xr[a] = u * ALIAS_CS[i] + d * ALIAS_CA[i];
      xr[b] = d * ALIAS_CS[i] - u * ALIAS_CA[i];
    }
}

/**
 * 入力のローパス（ハミング窓の sinc、線形位相で遅れを補正）。遷移の幅は fc の 8 %
 * @returns fc がナイキスト周波数以上なら入力のまま
 */
export function lowpass(x: Float32Array, fs: number, fc: number): Float32Array {
  if (!fc || fc >= fs / 2) return x;
  const width = Math.max(fc * 0.08, 50),
    taps = Math.min(4095, Math.max(63, Math.ceil((3.3 * fs) / width) | 1)),
    m = (taps - 1) / 2,
    c = (2 * fc) / fs,
    h = new Float64Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - m;
    h[i] = (t === 0 ? c : Math.sin(PI * c * t) / (PI * t)) * (0.54 + 0.46 * Math.cos((PI * t) / m));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const y = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let v = 0;
    const a = Math.max(0, n + m - x.length + 1),
      b = Math.min(taps - 1, n + m);
    for (let i = a; i <= b; i++) v += h[i] * x[n + m - i];
    y[n] = v;
  }
  return y;
}

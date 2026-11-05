/**
 * 反響のインパルス応答を作る（DOM に依存しない）。地上は短く薄い反射、トンネルは壁の間を往復する反射と長い残響。
 * スイッチの音（1〜3 kHz）も響くよう、高い音を残す。
 * 値は聞いて決めたもので、実測ではない
 */
export type EchoKind = 'off' | 'ground' | 'tunnel';

interface EchoSpec {
  /** 残響時間 [s]（60 dB 下がる時間） */
  t60: number;
  /** 初期反射の時刻 [ms] */
  early: readonly number[];
  /** 明るさ。時刻 0 の 1 次の低域通過の係数（小さいほど暗い） */
  bright: number;
  /** 明るさが時間で落ちる速さ [1/s] */
  fade: number;
  /** 乾いた音に足す大きさ */
  wet: number;
  /** 残響の立ち上がりの時間 [ms]。省略は 12 ms */
  rise?: number;
}
export const ECHO: Record<Exclude<EchoKind, 'off'>, EchoSpec> = {
  ground: { t60: 0.45, early: [18, 31, 52], bright: 0.6, fade: 2, wet: 0.3 },
  tunnel: { t60: 2.4, early: [23, 47, 71, 95, 142], bright: 0.55, fade: 0.8, wet: 0.85 },
};

/**
 * VVVF の音だけに付ける反響。地上・トンネルとは別で、直接音を弱めて反響を強くすると、
 * スイッチの音の出だしと消え際がなめらかに聞こえる
 */
export type MotorEcho = 'off' | 'soft' | 'strong';
const MOTOR_SPEC: EchoSpec = { t60: 0.5, early: [7, 13, 22, 34], bright: 0.75, fade: 2, wet: 1, rise: 25 };
/** 直接音と反響の大きさ */
export const MOTOR_MIX: Record<MotorEcho, { dry: number; wet: number }> = {
  off: { dry: 1, wet: 0 },
  soft: { dry: 0.85, wet: 0.5 },
  strong: { dry: 0.6, wet: 0.9 },
};

/** 繰り返しても同じになる乱数 */
const noiseFrom = (seed: number) => {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
};

/** 1 チャンネル分。全体のエネルギーを 1 にそろえる */
function channel(sp: EchoSpec, fs: number, seed: number): Float32Array {
  const n = Math.ceil(sp.t60 * 1.1 * fs),
    x = new Float32Array(n),
    rnd = noiseFrom(seed),
    decay = 6.91 / sp.t60;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs,
      /* 時間がたつほど高い音を減らす */
      k = sp.bright / (1 + sp.fade * t);
    lp += (rnd() - lp) * k;
    x[i] = lp * Math.exp(-decay * t);
  }
  /* 残響の立ち上がりをなめらかにし、初期反射を上に載せる */
  const rise = Math.floor(((sp.rise ?? 12) / 1000) * fs);
  for (let i = 0; i < rise; i++) x[i] *= i / rise;
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i] * x[i];
  const g0 = Math.sqrt(0.5 / Math.max(e, 1e-12));
  for (let i = 0; i < n; i++) x[i] *= g0;
  sp.early.forEach((ms, j) => {
    const at = Math.round((ms / 1000) * fs);
    if (at < n) x[at] += (rnd() < 0 ? -1 : 1) * 0.5 * 0.72 ** j * Math.sqrt(0.5 / sp.early.length);
  });
  let e2 = 0;
  for (let i = 0; i < n; i++) e2 += x[i] * x[i];
  const g = 1 / Math.sqrt(Math.max(e2, 1e-12));
  for (let i = 0; i < n; i++) x[i] *= g;
  return x;
}

/** 左右のインパルス応答。stereo が false なら左右を同じにする */
export function makeIr(kind: Exclude<EchoKind, 'off'>, fs: number, stereo: boolean): [Float32Array, Float32Array] {
  const sp = ECHO[kind],
    L = channel(sp, fs, 1234);
  return [L, stereo ? channel(sp, fs, 98765) : L];
}

/** VVVF の音だけに付ける反響の左右のインパルス応答 */
export function makeMotorIr(fs: number, stereo: boolean): [Float32Array, Float32Array] {
  const L = channel(MOTOR_SPEC, fs, 4321);
  return [L, stereo ? channel(MOTOR_SPEC, fs, 56789) : L];
}

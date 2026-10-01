/**
 * テスト信号（この端末の中で作る音）。表示（capture.ts）とモニターの AudioWorklet（worklet.ts）で同じ式を使う。
 * CH1 = L、CH2 = R。標本の番号 n から直接求めるので、どこから書き始めても波形はつながる
 */
export type Wave = 'sine' | 'square' | 'tri' | 'saw' | 'sweep' | 'melody' | 'noise';

export interface TestParams {
  wave: Wave;
  /** CH1 の周波数（Hz） */
  f: number;
  /** 周波数比 CH1 : CH2 */
  ra: readonly [number, number];
  /** CH1 に対する CH2 の位相（度） */
  ph: number;
}

export const WAVES: readonly (readonly [Wave, string])[] = [
  ['sine', '正弦波'],
  ['square', '方形波'],
  ['tri', '三角波'],
  ['saw', 'のこぎり波'],
  ['sweep', 'スイープ'],
  ['melody', '分散和音'],
  ['noise', 'ホワイトノイズ'],
];
/** 周波数・周波数比・位相差を使う波形 */
export const PERIODIC: ReadonlySet<Wave> = new Set(['sine', 'square', 'tri', 'saw']);

/** 周期的な波形の振幅（フルスケールを 1 とする。−3.1 dBFS） */
export const AMP = 0.7;
/** スイープ: 20 Hz から 20 kHz まで対数で 6 秒 */
export const SWEEP = { f0: 20, k: 1000, T: 6 } as const;
/** 分散和音の音（MIDI のノート番号）と 1 音の長さ（秒） */
const NOTES = [60, 64, 67, 72, 76, 72, 67, 64, 62, 65, 69, 74, 77, 74, 69, 65];
const NOTE_S = 0.28;
/** 雑音の床（±2e-5、およそ −100 dBFS） */
const FLOOR = 4e-5;

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
export const midiHz = (n: number): number => 440 * 2 ** ((n - 69) / 12);

/** 不連続点の折り返し雑音を抑える補正（PolyBLEP）。t は位相（周期を 1）、dt は 1 標本あたりの位相 */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** 周期的な波形の 1 点。p は位相（周期を 1）。p = 0 で 0 から上がり始める（のこぎり波は p = 0 で −1 から） */
export function periodic(w: Wave, p: number, dt: number): number {
  switch (w) {
    case 'square':
      return (p < 0.5 ? 1 : -1) + blep(p, dt) - blep(frac(p + 0.5), dt);
    case 'tri':
      return 1 - 4 * Math.abs(frac(p + 0.25) - 0.5);
    case 'saw':
      return 2 * p - 1 - blep(p, dt);
    default:
      return Math.sin(TAU * p);
  }
}

/**
 * 標本 n0 から cnt 個を L・R に書く。ring なら配列を輪として n を配列の長さで割った余りの位置へ、
 * そうでなければ先頭から書く
 */
export function genTest(
  p: TestParams,
  fs: number,
  n0: number,
  cnt: number,
  L: Float32Array,
  R: Float32Array,
  ring = false,
): void {
  const f2 = (p.f * p.ra[1]) / p.ra[0],
    ph = p.ph / 360,
    N = L.length;
  for (let i = 0; i < cnt; i++) {
    const n = n0 + i,
      t = n / fs;
    let l: number, r: number;
    if (p.wave === 'noise') {
      l = (Math.random() * 2 - 1) * 0.5;
      r = (Math.random() * 2 - 1) * 0.5;
    } else if (p.wave === 'sweep') {
      const { f0, k, T } = SWEEP,
        tau = t % T;
      l = r = AMP * Math.sin(TAU * frac(((f0 * T) / Math.log(k)) * (k ** (tau / T) - 1)));
    } else if (p.wave === 'melody') {
      const idx = Math.floor(t / NOTE_S),
        tau = t - idx * NOTE_S,
        f = midiHz(NOTES[idx % NOTES.length]),
        env = Math.min(1, tau / 0.004) * Math.exp(-tau * 7);
      let s = 0;
      for (let h = 1; h <= 6; h++) s += Math.sin(TAU * frac(f * h * t)) / h;
      /* 8 音ごとに C2 と F2 を入れ替える低音 */
      const bass = 0.16 * Math.sin(TAU * frac(midiHz(Math.floor(t / (NOTE_S * 8)) % 2 ? 41 : 36) * t));
      l = 0.42 * env * s + bass;
      r = 0.34 * env * s + bass;
    } else {
      l = AMP * periodic(p.wave, frac(p.f * t), p.f / fs);
      r = AMP * periodic(p.wave, frac(f2 * t + ph), f2 / fs);
    }
    const k = ring ? n % N : i;
    L[k] = l + (Math.random() - 0.5) * FLOOR;
    R[k] = r + (Math.random() - 0.5) * FLOOR;
  }
}

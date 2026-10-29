/**
 * 音で聞く: 音の列を DWT で分けて係数を捨て、戻した音を鳴らす。
 * 計算（processAudio・testClip）は DOM に依存しない。鳴らすのは play だけ
 */
import { compress, denoise, maxLevel, type Shrink, sigmaMad, universal, type Wav, wavedec, waverec } from './dwt';
import { gauss, rng } from './signals';

export type AudioTest = 'sweep' | 'mix';
export const AUDIO_TESTS: readonly (readonly [AudioTest, string])[] = [
  ['sweep', '掃引 50 Hz → 12 kHz'],
  ['mix', '低い音・打音・高い音'],
];

/** 試しの音（振幅は 0.5 まで）。雑音の σ を足せる */
export function testClip(kind: AudioTest, fs: number, dur: number, noise = 0, seed = 7): Float32Array {
  const n = Math.round(fs * dur),
    x = new Float32Array(n),
    r = rng(seed);
  if (kind === 'sweep') {
    /* 指数の掃引: 位相 2π f0 T/ln(f1/f0) (e^(t ln(f1/f0)/T) − 1) */
    const f0 = 50,
      f1 = 12000,
      k = Math.log(f1 / f0) / dur;
    for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin(((2 * Math.PI * f0) / k) * (Math.exp((k * i) / fs) - 1));
  } else {
    for (let i = 0; i < n; i++) {
      const t = i / fs,
        /* 0.25 秒ごとの打音（1 ms で減衰）、0.5 秒ごとに鳴る 3.5 kHz の短い音 */
        tc = t % 0.25,
        th = (t + 0.125) % 0.5;
      x[i] =
        0.2 * Math.sin(2 * Math.PI * 110 * t) +
        0.3 * Math.exp(-tc / 0.001) * (tc < 0.01 ? 1 : 0) * (i % 2 ? 1 : -1) +
        (th < 0.08 ? 0.15 * Math.sin(2 * Math.PI * 3500 * t) * Math.sin((Math.PI * th) / 0.08) : 0);
    }
  }
  if (noise > 0) for (let i = 0; i < n; i++) x[i] += noise * gauss(r);
  return x;
}

export type Proc = { kind: 'off' } | { kind: 'denoise'; m: Shrink; k: number } | { kind: 'compress'; keep: number };

/**
 * x を 2^J の倍数まで 0 で埋めて J 段に分け、係数を捨てて戻す（長さは元に戻す）。
 * denoise の k は普遍閾値に掛ける倍率、compress の keep は残す係数の割合（0〜1）
 */
export function processAudio(
  x: Float32Array,
  w: Wav,
  J: number,
  p: Proc,
): { y: Float32Array; kept: number; total: number; lam?: number } {
  const step = 2 ** J,
    N = Math.ceil(x.length / step) * step,
    buf = new Float64Array(N);
  buf.set(x);
  let c = wavedec(buf, w, Math.min(J, maxLevel(N, w)));
  let kept = N,
    lam: number | undefined;
  if (p.kind === 'denoise') {
    lam = p.k * universal(sigmaMad(c.d[0]), N);
    const r = denoise(c, lam, p.m);
    c = r.c;
    kept = r.kept;
  } else if (p.kind === 'compress') {
    kept = Math.round(p.keep * N);
    c = compress(c, kept).c;
  }
  const y = waverec(c);
  return { y: Float32Array.from(y.subarray(0, x.length)), kept, total: N, lam };
}

/** 鳴らす。止める関数を返す */
export function play(ac: AudioContext, x: Float32Array, fs: number, gain = 1, onEnd?: () => void): () => void {
  const b = ac.createBuffer(1, x.length, fs);
  b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
  const src = ac.createBufferSource(),
    g = ac.createGain();
  g.gain.value = gain;
  src.buffer = b;
  src.connect(g).connect(ac.destination);
  if (onEnd) src.onended = onEnd;
  src.start();
  return () => {
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* 既に止まっている */
    }
    src.disconnect();
  };
}

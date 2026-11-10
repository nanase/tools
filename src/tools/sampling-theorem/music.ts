/**
 * 標本化定理のページの音楽の入力: PCM・MP3 のページと同じサンプル音源を 44.1 kHz・4 秒・モノラルで持ち、
 * どの時刻の値も窓をかけた sinc で読む（元の「なめらかな波」とみなす）。入力のローパスは sinc の幅を広げて行う。
 * 音源は主スレッドとワークレットのそれぞれで setMusic して使う
 */
import type { MusicName } from '../pcm/music';
import { ker, L } from './kernel';

export const MUSIC_RATE = 44100,
  MUSIC_DUR = 4;
const N = MUSIC_RATE * MUSIC_DUR;

const BUF = new Map<MusicName, Float32Array>();
export const setMusic = (name: MusicName, x: Float32Array): void => {
  BUF.set(name, x);
};
export const hasMusic = (name: MusicName): boolean => BUF.has(name);

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** 時刻 t [s] の値。fc [Hz] より上は除く（Infinity・音源の帯域以上なら除かない）。音源がまだなければ 0 */
export function musicAt(name: MusicName, t: number, fc: number): number {
  const x = BUF.get(name);
  if (!x) return 0;
  const u = mod(t, MUSIC_DUR) * MUSIC_RATE,
    m = Math.floor(u),
    /* s: 遮断を音源の帯域で割った比（1 なら音源のまま） */
    s = Math.min(1, (2 * fc) / MUSIC_RATE),
    w = Math.ceil(L / s);
  let v = 0;
  for (let n = m - w + 1; n <= m + w; n++) v += x[mod(n, N)] * ker((u - n) * s);
  return v * s;
}

/* ---------- スペクトル ---------- */
export const SPEC_N = 4096;
let hann: Float64Array | null = null,
  hannSum = 0;
/** 振幅のスペクトル（0〜音源の帯域、SPEC_N / 2 + 1 点）。フルスケールの正弦波の振幅がそのまま出る。時刻 t を中心にハン窓 */
export function musicSpec(name: MusicName, t: number, fft: (re: Float64Array, im: Float64Array) => void): Float64Array {
  const x = BUF.get(name),
    out = new Float64Array(SPEC_N / 2 + 1);
  if (!x) return out;
  if (!hann) {
    hann = Float64Array.from({ length: SPEC_N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SPEC_N));
    hannSum = hann.reduce((a, b) => a + b, 0);
  }
  const re = new Float64Array(SPEC_N),
    im = new Float64Array(SPEC_N),
    c = Math.round(mod(t, MUSIC_DUR) * MUSIC_RATE) - SPEC_N / 2;
  for (let i = 0; i < SPEC_N; i++) re[i] = x[mod(c + i, N)] * hann[i];
  fft(re, im);
  for (let k = 0; k <= SPEC_N / 2; k++) out[k] = ((k && k < SPEC_N / 2 ? 2 : 1) * Math.hypot(re[k], im[k])) / hannSum;
  return out;
}
/** スペクトルの bin の周波数 [Hz] */
export const binHz = (k: number): number => (k * MUSIC_RATE) / SPEC_N;

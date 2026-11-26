/**
 * 試聴の入力の音（DOM に依存しない）: 一覧と、くり返し鳴らせる形に整える処理。
 * ノイズはノイズジェネレータの色のフィルタ、楽器は PCM のページの合成音、自然の音と声は立体音響のページの録音
 * （public/spatial-audio/<id>.mp3。出どころは src/tools/spatial-audio/SOURCES.md）を使う
 */
import { makeFilt } from '../noise/color';
import { Rng } from '../noise/rng';
import { MUSIC, type MusicName, makeMusic } from '../pcm/music';
import { SOUNDS } from '../spatial-audio/model';

export type Group = 'noise' | 'inst' | 'nature' | 'voice';
export type NoiseKind = 'white' | 'pink' | 'brown';

export interface Source {
  /** セレクトボックスの値 */
  v: string;
  /** 一覧の名前 */
  name: string;
  /** IN の欄に出す名前 */
  label: string;
  group: Group;
}

export const GROUPS: readonly (readonly [Group, string])[] = [
  ['noise', 'ノイズ'],
  ['inst', '楽器'],
  ['nature', '自然の音'],
  ['voice', '声'],
];

const NOISES: readonly (readonly [NoiseKind, string])[] = [
  ['white', 'ホワイトノイズ'],
  ['pink', 'ピンクノイズ'],
  ['brown', 'ブラウンノイズ'],
];

export const SOURCES: readonly Source[] = [
  ...NOISES.map(([v, name]) => ({ v, name, label: name, group: 'noise' as const })),
  ...MUSIC.map(([v, name]) => ({ v, name, label: name, group: 'inst' as const })),
  ...SOUNDS.map((s) => ({
    v: s.id,
    name: s.name,
    label: s.name,
    group: s.kind === 'voice' ? ('voice' as const) : ('nature' as const),
  })),
];
export const SRC0 = SOURCES[0];
export const sourceOf = (v: string): Source | undefined => SOURCES.find((s) => s.v === v);
/** 録音のファイルを読む音か */
export const isRecording = (s: Source): boolean => s.group === 'nature' || s.group === 'voice';

/** 大きさをそろえる実効値: 今までの入力（フルスケールの一様分布のホワイトノイズ）と同じ 1/√3 */
export const REF_RMS = 1 / Math.sqrt(3);
/** くり返しのつなぎ目を重ねる時間 [s] */
export const XFADE = 0.6;
/** 声の録音の後に入れる無音 [s] */
export const VOICE_GAP = 1.5;
/** ファイルから使う長さ [s] */
export const FILE_MAX = 30;
/** ノイズと楽器の長さ [s] */
export const GEN_DUR = 4;

/** くり返し鳴らす音: チャンネルごとの標本と、REF_RMS にそろえる倍率 */
export interface Loop {
  data: Float32Array<ArrayBuffer>[];
  gain: number;
}

/**
 * くり返しのつなぎ方: 重ねる（終わりと初めを XFADE 秒重ねる。ノイズ・自然の音・ファイル）、
 * 無音（声。終わりに VOICE_GAP 秒の無音を足す）、そのまま（楽器。4 秒が拍の切れ目で、PCM のページと同じくそのままくり返す）
 */
export type Join = 'xfade' | 'gap' | 'none';

/**
 * くり返せる形にする。
 * 倍率は 50 ms ごとの強さが最大から 30 dB 以内の区間の実効値（全チャンネル）で求める（声の間を数えない）
 */
export function toLoop(chs: readonly Float32Array[], fs: number, join: Join): Loop {
  const N = chs[0]?.length ?? 0,
    C = Math.min(Math.round(XFADE * fs), N >> 2);
  const data = chs.map((x): Float32Array<ArrayBuffer> => {
    if (join === 'none') return x.slice();
    if (join === 'gap') {
      const y = new Float32Array(N + Math.round(VOICE_GAP * fs));
      y.set(x);
      const f = Math.min(Math.round(0.03 * fs), N),
        g = Math.min(Math.round(0.01 * fs), N);
      for (let k = 0; k < f; k++) y[N - 1 - k] *= k / f;
      for (let k = 0; k < g; k++) y[k] *= k / g;
      return y;
    }
    const y = x.slice(0, N - C);
    for (let k = 0; k < C; k++) {
      const w = k / C;
      y[k] = x[k] * Math.sqrt(w) + x[N - C + k] * Math.sqrt(1 - w);
    }
    return y;
  });
  const L = data[0]?.length ?? 0,
    F = Math.max(1, Math.min(L, Math.round(0.05 * fs))),
    es: number[] = [];
  for (let s = 0; s + F <= L; s += F) {
    let e = 0;
    for (const y of data) for (let k = s; k < s + F; k++) e += y[k] * y[k];
    es.push(e / (F * data.length));
  }
  const peak = Math.max(0, ...es),
    act = es.filter((e) => e > peak * 1e-3),
    rms = act.length ? Math.sqrt(act.reduce((a, b) => a + b, 0) / act.length) : 0;
  return { data, gain: rms > 1e-6 ? REF_RMS / rms : 0 };
}

/** ノイズを作る（種が同じなら同じ音）。フィルタが落ち着くまでの 0.5 秒は捨てる */
export function makeNoise(kind: NoiseKind, fs: number, dur = GEN_DUR, seed = 1): Float32Array {
  const rng = new Rng(seed),
    skip = Math.round(0.5 * fs),
    n = Math.round(dur * fs),
    x = new Float32Array(n);
  if (kind === 'white') {
    for (let i = 0; i < n; i++) x[i] = rng.uni() * 2 - 1;
    return x;
  }
  const f = makeFilt(kind, fs);
  for (let i = 0; i < skip + n; i++) {
    const y = f.step(rng.uni() * 2 - 1);
    if (i >= skip) x[i - skip] = y;
  }
  return x;
}

/** ノイズと楽器の音を、くり返せる形で作る（録音は読み込んでから toLoop へ） */
export function makeLoop(s: Source, fs: number): Loop | null {
  if (s.group === 'noise') return toLoop([makeNoise(s.v as NoiseKind, fs)], fs, 'xfade');
  if (s.group === 'inst') return toLoop(makeMusic(s.v as MusicName, fs, GEN_DUR), fs, 'none');
  return null;
}

/** ファイルの音: 先頭 FILE_MAX 秒・2 チャンネルまで */
export function fileLoop(chs: readonly Float32Array[], fs: number): Loop {
  const n = Math.min(chs[0]?.length ?? 0, Math.round(FILE_MAX * fs));
  return toLoop(
    chs.slice(0, 2).map((x) => x.slice(0, n)),
    fs,
    'xfade',
  );
}

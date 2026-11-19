/**
 * 手持ちの MIDI ファイルを、ギターで弾く音符に直す（DOM に依存しない）。
 * 選んだパートをまとめて音域へ寄せ、弦とフレットは曲と同じ自動の運指（score.ts の finger）で決める
 */
import { type FilePart, fold } from '../../lib/midi-file';
import type { Note } from './score';

/** 弦は 6 本なので、同時に鳴らせるのは 6 音まで */
const MAX_VOICES = 6;

/** 音域: 最も低い開放弦から、最も高い開放弦にフレットの数を足した高さまで */
export function fileRange(open: readonly number[], frets: number): [number, number] {
  return [Math.min(...open), Math.max(...open) + frets];
}

/**
 * 選んだパートの音を 1 段目の幅 shift で移し、音域 lo〜hi へ寄せてまとめる。
 * 同じ拍の同じ高さの音は 1 つにし、同じ拍に 7 音以上あれば低い音から捨てる
 */
export function fileNotes(parts: readonly FilePart[], shift: number, lo: number, hi: number): Note[] {
  const by = new Map<number, Map<number, Note>>();
  for (const p of parts)
    for (const x of p.notes) {
      const n = fold(x.n + shift, lo, hi),
        k = Math.round(x.t * 960),
        g = by.get(k) ?? new Map<number, Note>();
      by.set(k, g);
      const y = g.get(n);
      if (y) y.d = Math.max(y.d, x.d);
      else g.set(n, { t: x.t, d: x.d, n });
    }
  return [...by.keys()]
    .sort((a, b) => a - b)
    .flatMap((k) => [...(by.get(k)?.values() ?? [])].sort((a, b) => a.n - b.n).slice(-MAX_VOICES));
}

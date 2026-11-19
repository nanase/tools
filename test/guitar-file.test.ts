import { describe, expect, it } from 'vitest';
import type { FilePart } from '../src/lib/midi-file';
import { fileNotes, fileRange } from '../src/tools/guitar/file';

const part = (id: string, ns: [number, number][]): FilePart => ({
  id,
  tr: 0,
  ch: 0,
  name: id,
  drum: false,
  notes: ns.map(([t, n]) => ({ t, d: 1, n, v: 80 })),
  lo: Math.min(...ns.map((x) => x[1])),
  hi: Math.max(...ns.map((x) => x[1])),
  mean: 0,
});

describe('ギターの MIDI ファイル', () => {
  it('音域は最も低い開放弦から、最も高い開放弦にフレットの数を足した高さまで', () => {
    expect(fileRange([64, 59, 55, 50, 45, 40], 19)).toEqual([40, 83]);
  });
  it('同じ拍に 7 音以上あれば、低い音から捨てて 6 音にする', () => {
    const ns = fileNotes(
      [
        part(
          'a',
          [48, 52, 55, 60, 64, 67, 72, 76].map((n) => [0, n] as [number, number]),
        ),
      ],
      0,
      40,
      83,
    );
    expect(ns.map((x) => x.n)).toEqual([55, 60, 64, 67, 72, 76]);
  });
  it('パートをまとめ、移す幅を足して音域へ寄せる', () => {
    const ns = fileNotes(
      [
        part('a', [
          [0, 88],
          [1, 60],
        ]),
        part('b', [[0, 30]]),
      ],
      0,
      40,
      83,
    );
    expect(ns.map((x) => [x.t, x.n])).toEqual([
      [0, 42],
      [0, 76],
      [1, 60],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { FilePart } from '../src/lib/midi-file';
import { parseSmf } from '../src/lib/smf';
import { fileDefaults, fileSong } from '../src/tools/organ/file';
import { smfBytes } from './smf-bytes';

const part = (id: string, ns: number[], drum = false): FilePart => ({
  id,
  tr: 0,
  ch: Number(id),
  name: id,
  drum,
  notes: ns.map((n, t) => ({ t, d: 1, n, v: 80 })),
  lo: Math.min(...ns),
  hi: Math.max(...ns),
  mean: ns.reduce((s, n) => s + n, 0) / ns.length,
});
const smf = parseSmf(
  smfBytes(0, 480, [
    [
      [0, 0x90, 60, 80],
      [480, 0x80, 60, 0],
    ],
  ]),
);

describe('オルガンの MIDI ファイル', () => {
  it('いちばん低いパートがペダルの音域に収まればペダル、ほかは第 1 手鍵盤にする', () => {
    const ps = [part('0', [67, 84]), part('1', [55, 76]), part('2', [36, 64]), part('9', [36, 38], true)];
    expect([...fileDefaults(ps)]).toEqual([
      ['0', 'I'],
      ['1', 'I'],
      ['2', 'P'],
    ]);
  });
  it('パートが 1 つならペダルにしない', () => {
    expect([...fileDefaults([part('0', [40, 50])])]).toEqual([['0', 'I']]);
  });
  it('鍵盤ごとに譜表を割り当て、ペダルの音はペダルの音域へ寄せる', () => {
    const ps = [part('0', [72]), part('1', [60]), part('2', [36, 72])],
      ch = new Map<string, 'I' | 'II' | 'P'>([
        ['0', 'I'],
        ['1', 'II'],
        ['2', 'P'],
      ]),
      { piece, data } = fileSong(smf, ps, ch, 0, 'b.mid');
    expect(data.notes.map((x) => [x.n, x.h])).toEqual([
      [36, 2],
      [60, 1],
      [72, 0],
      [60, 2],
    ]);
    expect(piece.hands).toEqual(['I', 'II', 'P']);
    expect(piece.v).toBe('file');
  });
  it('同じ鍵盤で同時に始まる同じ高さの音は 1 つにまとめる', () => {
    const ps = [part('0', [72]), part('1', [72])],
      ch = new Map<string, 'I' | 'II' | 'P'>([
        ['0', 'I'],
        ['1', 'I'],
      ]);
    expect(fileSong(smf, ps, ch, 0, 'b.mid').data.notes).toHaveLength(1);
  });
});

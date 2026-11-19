import { describe, expect, it } from 'vitest';
import type { FNote } from '../src/lib/midi-file';
import { dynOf, slurs, voicesOf } from '../src/tools/violin/file';

const nt = (t: number, d: number, n: number, v = 80): FNote => ({ t, d, n, v });

describe('ヴァイオリンの MIDI ファイル', () => {
  it('すき間なく続く音を 1 拍の中でだけスラーでつなぐ', () => {
    const [v] = voicesOf([nt(0, 0.5, 67), nt(0.5, 0.5, 69), nt(1, 0.5, 71), nt(1.5, 0.5, 72)]);
    slurs(v);
    expect(v.map((x) => [x.slurOn, x.slurOff])).toEqual([
      [true, false],
      [false, true],
      [true, false],
      [false, true],
    ]);
  });
  it('すき間のある音はつながない', () => {
    const [v] = voicesOf([nt(0, 0.25, 67), nt(0.5, 0.5, 69)]);
    slurs(v);
    expect(v.map((x) => [x.slurOn, x.slurOff])).toEqual([
      [false, false],
      [false, false],
    ]);
  });
  it('ベロシティを最も近い強弱記号にする', () => {
    expect(dynOf(80)).toBe('mf');
    expect(dynOf(30)).toBe('pp');
    expect(dynOf(127)).toBe('fff');
  });
  it('強弱の変わる音にだけ記号を付ける', () => {
    const [v] = voicesOf([nt(0, 1, 67, 80), nt(1, 1, 69, 82), nt(2, 1, 71, 112)]);
    expect(v.map((x) => x.dyn)).toEqual(['mf', undefined, 'ff']);
  });
  it('同時に始まる音は和音にし、伸ばした音の上で始まる音は 2 つ目の声部にする', () => {
    const vs = voicesOf([nt(0, 2, 55), nt(0, 2, 62), nt(1, 1, 71), nt(2, 1, 69)]);
    expect(vs.map((v) => v.map((x) => [x.t, x.n]))).toEqual([
      [
        [0, [55, 62]],
        [2, [69]],
      ],
      [[1, [71]]],
    ]);
  });
  it('3 つ目の重なりでは前の音を次の音の始まりで切る', () => {
    const vs = voicesOf([nt(0, 4, 55), nt(1, 3, 62), nt(2, 1, 71)]);
    expect(vs[0].map((x) => [x.t, x.d, x.n])).toEqual([
      [0, 2, [55]],
      [2, 1, [71]],
    ]);
  });
});

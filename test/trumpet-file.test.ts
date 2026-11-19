import { describe, expect, it } from 'vitest';
import type { FNote } from '../src/lib/midi-file';
import { monophonic, voiceOf } from '../src/tools/trumpet/file';
import { performPiece } from '../src/tools/trumpet/perform';
import type { Piece } from '../src/tools/trumpet/score';
import type { ScoreNote } from '../src/tools/trumpet/scores/types';

const nt = (t: number, d: number, n: number, v = 80): FNote => ({ t, d, n, v });

describe('トランペットの MIDI ファイル', () => {
  it('同時に始まる音はいちばん高い音だけを残す', () => {
    expect(monophonic([nt(0, 1, 72), nt(0, 1, 76), nt(0, 1, 79)]).map((x) => x.n)).toEqual([79]);
  });
  it('重なる音は、前の音を次の音の始まりで切る', () => {
    expect(monophonic([nt(0, 2, 72), nt(1, 1, 74)]).map((x) => [x.t, x.d, x.n])).toEqual([
      [0, 1, 72],
      [1, 1, 74],
    ]);
  });
  it('拍の中のすき間のない音をスラーにし、強弱の変わる音に記号を付ける', () => {
    const v = voiceOf([nt(0, 0.5, 72, 80), nt(0.5, 0.5, 74, 80), nt(1, 1, 76, 112)]);
    expect(v.map((x) => [x.n, x.slurOn, x.slurOff, x.dyn])).toEqual([
      [72, true, false, 'mf'],
      [74, false, true, undefined],
      [76, false, false, 'ff'],
    ]);
  });
});

describe('トランペットのテンポの変化', () => {
  it('qpmMap があれば、拍ごとにそのテンポで秒にする', () => {
    const blank = (t: number): ScoreNote => ({
      t,
      d: 1,
      n: 72,
      slurOn: false,
      slurOff: false,
      trill: false,
      fermata: false,
      stacc: false,
      accent: false,
      tenuto: false,
    });
    const pc: Piece = {
      v: 'x',
      file: '',
      name: '',
      by: '',
      qpm: 120,
      tempo: '',
      meter: 4,
      phraseBars: 4,
      flats: 0,
      license: 'pd',
      qpmMap: [[2, 60]],
    };
    const pf = performPiece(pc, { voices: [Array.from({ length: 8 }, (_, i) => blank(i))], bars: [] }, 1, 'plain');
    const d1 = pf.secAt(1) - pf.secAt(0),
      d3 = pf.secAt(3) - pf.secAt(2);
    expect(d1).toBeCloseTo(0.5, 2);
    expect(d3).toBeCloseTo(1, 2);
  });
});

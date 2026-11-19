import { describe, expect, it } from 'vitest';
import type { FNote } from '../src/lib/midi-file';
import type { Smf } from '../src/lib/smf';
import { fileSong, monophonic, voiceOf } from '../src/tools/trumpet/file';
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
  it('パートが途中から入るときは、最初の音より前の小節線を捨てる（小節の頭の表を単調に増やす）', () => {
    const smf: Smf = { ev: [], bpm: 120, tempo: [], starts: [0, 4, 8, 12, 16], end: 20, chans: [0], names: [''] };
    const { data } = fileSong(smf, [nt(8, 4, 72), nt(12, 4, 74), nt(16, 4, 76)], 0, 'c.mid');
    expect(data.bars).toEqual([12, 16]);
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
  it('テンポの変化が多くても、拍ごとに表を頭から探さない（600 拍・3000 点で 150 ms 未満）', () => {
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
      qpmMap: Array.from({ length: 3000 }, (_, i) => [i * 0.2, 100 + (i % 40)] as const),
    };
    const voice = Array.from(
      { length: 600 },
      (_, i): ScoreNote => ({
        t: i,
        d: 1,
        n: 72,
        slurOn: false,
        slurOff: false,
        trill: false,
        fermata: false,
        stacc: false,
        accent: false,
        tenuto: false,
      }),
    );
    performPiece(pc, { voices: [voice], bars: [] }, 1, 'plain');
    const t0 = performance.now();
    performPiece(pc, { voices: [voice], bars: [] }, 1, 'plain');
    expect(performance.now() - t0).toBeLessThan(150);
  });
});

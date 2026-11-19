import { describe, expect, it } from 'vitest';
import { partsOf } from '../src/lib/midi-file';
import { parseSmf } from '../src/lib/smf';
import { fileSong } from '../src/tools/piano/file';
import { smfBytes } from './smf-bytes';

const song = (pedal: boolean) =>
  parseSmf(
    smfBytes(0, 480, [
      [
        ...(pedal ? [[0, 0xb0, 64, 127]] : []),
        [0, 0x90, 48, 70],
        [0, 0x90, 72, 100],
        [960, 0x80, 48, 0],
        [0, 0x80, 72, 0],
        ...(pedal ? [[0, 0xb0, 64, 0]] : []),
      ],
    ]),
  );

describe('ピアノの MIDI ファイル', () => {
  it('1 パートなら C4 で右手と左手に分け、ベロシティを残す', () => {
    const smf = song(false),
      { piece, data } = fileSong(smf, partsOf(smf), 0, 'a.mid');
    expect(data.notes.map((x) => [x.n, x.h, x.v])).toEqual([
      [48, 1, 70],
      [72, 0, 100],
    ]);
    expect(piece.v).toBe('file');
    expect(piece.name).toBe('a.mid');
    expect(piece.bpm).toBe(120);
    expect(data.pedal).toBeUndefined();
  });
  it('CC 64 をペダルの記録にする', () => {
    const smf = song(true),
      { data } = fileSong(smf, partsOf(smf), 0, 'a.mid');
    expect(data.pedal).toEqual([
      [0, 1],
      [2, 0],
    ]);
  });
  it('移す幅を足し、外れた音は寄せる', () => {
    const smf = song(false),
      { data } = fileSong(smf, partsOf(smf), 48, 'a.mid');
    expect(data.notes.map((x) => x.n)).toEqual([96, 108]);
  });
});

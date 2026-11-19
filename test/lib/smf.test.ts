import { describe, expect, it } from 'vitest';
import { BEND, barStarts, CC, OFF, ON, PC, parseSmf, SmfError } from '../../src/lib/smf';
import { smfBytes } from '../smf-bytes';

describe('MIDI ファイル', () => {
  it('ノート・プログラムチェンジ・テンポ・拍子を拍で読む（ランニングステータスも）', () => {
    const s = parseSmf(
      smfBytes(1, 480, [
        [
          [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20],
          [0, 0xff, 0x58, 4, 3, 2, 24, 8],
          [960, 0xff, 0x51, 3, 0x03, 0xd0, 0x90],
        ],
        [
          [0, 0xc1, 40],
          [0, 0x91, 60, 100],
          [480, 60, 0],
          [0, 0xb1, 64, 127],
          [0, 0xe1, 0, 0x40],
        ],
      ]),
    );
    expect(s.bpm).toBeCloseTo(120, 6);
    expect(s.tempo).toEqual([
      [0, 1],
      [2, 2],
    ]);
    expect(s.chans).toEqual([1]);
    expect(s.end).toBe(1);
    expect(s.starts).toEqual([0]);
    expect(s.ev.map((e) => [e.b, e.k, e.a])).toEqual([
      [0, PC, 40],
      [0, ON, 60],
      [1, CC, 64],
      [1, BEND, 0],
      [1, OFF, 60],
    ]);
  });
  it('頭の無音は、最初の音を含む小節まで詰める', () => {
    /* 4/4 で最初の音は 9 拍目（3 小節目の頭から 1 拍あと） */
    const s = parseSmf(
      smfBytes(0, 480, [
        [
          [0, 0xc0, 5],
          [480 * 9, 0x90, 60, 100],
          [480, 0x80, 60, 0],
        ],
      ]),
    );
    expect(s.ev.map((e) => [e.b, e.k])).toEqual([
      [0, PC],
      [1, ON],
      [2, OFF],
    ]);
    expect(s.end).toBe(2);
  });
  it('対のない終わりの音は、曲の終わりに数えない', () => {
    const s = parseSmf(
      smfBytes(0, 480, [
        [
          [0, 0x90, 60, 100],
          [480, 0x80, 60, 0],
          [480 * 4000, 0x80, 61, 0],
        ],
      ]),
    );
    expect(s.end).toBe(1);
    expect(s.starts).toEqual([0]);
  });
  it('RMI（RIFF に入れた SMF）も読む', () => {
    const smf = smfBytes(0, 480, [
        [
          [0, 0x90, 60, 100],
          [480, 0x80, 60, 0],
        ],
      ]),
      le = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255],
      body = [...'RMID']
        .map((c) => c.charCodeAt(0))
        .concat(
          [...'data'].map((c) => c.charCodeAt(0)),
          le(smf.length),
          [...smf],
        ),
      rmi = new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le(body.length), ...body]);
    expect(parseSmf(rmi).ev.map((e) => e.k)).toEqual([ON, OFF]);
  });
  it('拍子が変わると小節の頭もずれる', () => {
    expect(
      barStarts(
        [
          { b: 0, len: 3 },
          { b: 6, len: 4 },
        ],
        14,
      ),
    ).toEqual([0, 3, 6, 10]);
  });
  it('MIDI ファイルでないものと、音のないものは読めない', () => {
    expect(() => parseSmf(new Uint8Array([1, 2, 3]))).toThrow(SmfError);
    expect(() => parseSmf(smfBytes(0, 480, [[[0, 0xff, 0x51, 3, 7, 0xa1, 0x20]]]))).toThrow('音がありません');
    expect(() => parseSmf(smfBytes(0, 480, [[[0, 0x90, 60]]]))).toThrow(SmfError);
  });
});

describe('トラック', () => {
  it('出来事にトラックの番号を付け、トラック名を読む', () => {
    const name = [...'Violin'].map((c) => c.charCodeAt(0));
    const s = parseSmf(
      smfBytes(1, 480, [
        [
          [0, 0xff, 0x03, name.length, ...name],
          [0, 0x90, 60, 100],
          [480, 0x80, 60, 0],
        ],
        [
          [0, 0x90, 48, 90],
          [480, 0x80, 48, 0],
        ],
      ]),
    );
    expect(s.ev.filter((e) => e.k === ON).map((e) => [e.tr, e.a])).toEqual([
      [0, 60],
      [1, 48],
    ]);
    expect(s.names).toEqual(['Violin', '']);
  });
});

import { describe, expect, it } from 'vitest';
import { type FilePart, fold, meterOf, octaveShift, partsOf, pickSingle, shiftLabel } from '../../src/lib/midi-file';
import { parseSmf } from '../../src/lib/smf';
import { smfBytes } from '../smf-bytes';

/** 拍 0 から 1 拍ずつ並べた音（lo から hi まで、全音階でなく半音で間引く） */
const run = (lo: number, hi: number) => {
  const ns = [];
  for (let n = lo, t = 0; n <= hi; n += 4, t++) ns.push({ t, d: 1, n, v: 80 });
  return ns;
};
const part = (id: string, lo: number, hi: number): FilePart => {
  const notes = run(lo, hi);
  return {
    id,
    tr: 0,
    ch: 0,
    name: id,
    drum: false,
    notes,
    lo,
    hi,
    mean: notes.reduce((s, x) => s + x.n, 0) / notes.length,
  };
};

describe('パート', () => {
  it('トラックとチャンネルの組でパートに分け、チャンネル 10 は打楽器にする', () => {
    const name = [...'Right'].map((c) => c.charCodeAt(0));
    const ps = partsOf(
      parseSmf(
        smfBytes(1, 480, [
          [
            [0, 0xff, 0x03, name.length, ...name],
            [0, 0x90, 72, 100],
            [480, 0x80, 72, 0],
          ],
          [
            [0, 0xc0, 40],
            [0, 0x90, 48, 90],
            [960, 0x80, 48, 0],
            [0, 0x99, 36, 100],
            [240, 0x89, 36, 0],
          ],
        ]),
      ),
    );
    expect(ps.map((p) => [p.id, p.name, p.drum])).toEqual([
      ['0:0', 'Right', false],
      ['1:0', 'ヴァイオリン', false],
      ['1:9', '打楽器', true],
    ]);
    expect(ps[1].notes).toEqual([{ t: 0, d: 2, n: 48, v: 90 }]);
  });
});

describe('音域', () => {
  it('オクターブ単位で、音域に最も多く収まる幅を選ぶ', () => {
    expect(octaveShift([{ notes: run(36, 48), lo: 52, hi: 86 }])).toBe(24);
    expect(octaveShift([{ notes: run(60, 72), lo: 52, hi: 86 }])).toBe(0);
  });
  it('外れた音を 1 オクターブずつ寄せる', () => {
    expect(fold(40, 52, 86)).toBe(52);
    expect(fold(90, 52, 86)).toBe(78);
    expect(fold(60, 52, 86)).toBe(60);
  });
  it('1 パートの楽器では、収まる割合が同じなら高いパートを選ぶ', () => {
    const q = [part('vn1', 67, 84), part('vn2', 55, 76), part('va', 48, 69), part('vc', 36, 64)];
    expect(pickSingle(q, 55, 100)).toBe('vn1');
    expect(pickSingle([{ ...q[0], drum: true }], 55, 100)).toBeNull();
  });
  it('移した幅を文にする', () => {
    expect(shiftLabel(0)).toBe('');
    expect(shiftLabel(-12)).toBe('1 オクターブ下げて演奏');
    expect(shiftLabel(24)).toBe('2 オクターブ上げて演奏');
  });
});

describe('拍子', () => {
  it('小節の頭の拍から、拍子の変化 [拍, 1 小節の拍の数] を作る', () => {
    expect(meterOf([0, 4, 8, 11, 14])).toEqual([
      [0, 4],
      [8, 3],
    ]);
    expect(meterOf([0])).toEqual([[0, 4]]);
  });
});

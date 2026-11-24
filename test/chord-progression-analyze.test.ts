import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FNote } from '../src/lib/midi-file';
import { partsOf } from '../src/lib/midi-file';
import { parseSmf } from '../src/lib/smf';
import { analyze, chordsOf, keysOf } from '../src/tools/chord-progression/analyze';
import { triadOf } from '../src/tools/chord-progression/song';
import { QUALS } from '../src/tools/chord-progression/theory';

const NM = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const song = (f: string) => {
  const smf = parseSmf(readFileSync(new URL(`../src/tools/fm-synthesizer/songs/${f}`, import.meta.url)));
  return { smf, notes: partsOf(smf).flatMap((p) => (p.drum ? [] : p.notes)) };
};
const name = (s: { r: number; q: keyof typeof QUALS }) => NM[s.r] + QUALS[s.q].s;
/** 和音を 1 小節ずつ全音符で鳴らす（根音を 1 オクターブ下にも） */
const bars = (chords: number[][], from = 0): FNote[] =>
  chords.flatMap((c, k) => [
    { t: (from + k) * 4, d: 4, n: c[0] - 12, v: 90 },
    ...c.map((n) => ({ t: (from + k) * 4, d: 4, n, v: 80 })),
  ]);
const starts = (n: number) => [...Array(n)].map((_, k) => k * 4);

describe('コード進行の推定', () => {
  it('全音符の三和音をそのまま当てる', () => {
    const segs = analyze(
      bars([
        [60, 64, 67],
        [65, 69, 72],
        [67, 71, 74],
        [60, 64, 67],
      ]),
      starts(4),
      16,
    );
    expect(segs.map(name)).toEqual(['C', 'F', 'G', 'C']);
    expect(segs.map((s) => [s.b, s.e])).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
      [12, 16],
    ]);
    expect(segs[0].key).toEqual({ t: 0, m: 'maj' });
  });

  it('続く同じ和音はまとめ、音のない小節は前の和音を伸ばす', () => {
    const notes = bars(
      [
        [57, 60, 64],
        [57, 60, 64],
      ],
      1,
    ).concat(bars([[62, 65, 69]], 4));
    const segs = analyze(notes, starts(5), 20);
    expect(segs.map(name)).toEqual(['Am', 'Dm']);
    /* 曲の頭の休みは最初の和音に含め、4 小節目（音なし）は Am を伸ばす */
    expect(segs.map((s) => [s.b, s.e])).toEqual([
      [0, 16],
      [16, 20],
    ]);
  });

  it('FM グルーヴの和音を小節ごとに当てる（作った曲なので正解が分かる）', () => {
    const { smf, notes } = song('fm-groove.mid'),
      segs = analyze(notes, smf.starts, smf.end),
      A = ['Dm7', 'B♭M7', 'C', 'Am7'],
      B = ['Gm7', 'C7', 'FM7', 'A7'];
    expect(segs.map(name)).toEqual([...A, ...A, ...A, ...B, ...B, ...A, ...A, 'Dm7']);
    expect(segs.every((s, k) => k === 0 || s.b === segs[k - 1].e)).toBe(true);
  });

  it('アイネ・クライネは G メジャーで始まり、転調は数回に収まる', () => {
    const { smf, notes } = song('kv525.mid'),
      keys = keysOf(notes, smf.starts, smf.end),
      changes = keys.filter((k, i) => i > 0 && (k.t !== keys[i - 1].t || k.m !== keys[i - 1].m)).length;
    expect(keys[0]).toEqual({ t: 7, m: 'maj' });
    expect(changes).toBeGreaterThan(0);
    expect(changes).toBeLessThan(12);
    const segs = analyze(notes, smf.starts, smf.end);
    expect(name(segs[0])).toBe('G');
  });

  it('行進曲 WoO 29 は B♭ メジャーで、B♭ → F → Cm と進む', () => {
    const { smf, notes } = song('woo29.mid'),
      segs = analyze(notes, smf.starts, smf.end);
    expect(segs[0].key).toEqual({ t: 10, m: 'maj' });
    expect(segs.slice(0, 3).map(name)).toEqual(['B♭', 'F', 'Cm']);
  });

  it('音のないファイルは空', () => {
    expect(analyze([], starts(4), 16)).toEqual([]);
  });
});

describe('推した和音を曲にする', () => {
  it('地図の三角形は和音の長短に合い、調が変わる和音に転調を付ける', () => {
    const { key, chords } = chordsOf([
      { b: 0, e: 4, r: 0, q: 'M', key: { t: 0, m: 'maj' } },
      { b: 4, e: 6, r: 9, q: 'm7', key: { t: 0, m: 'maj' } },
      { b: 6, e: 8, r: 7, q: 'm7', key: { t: 5, m: 'maj' } },
      { b: 8, e: 12, r: 0, q: '7', key: { t: 5, m: 'maj' } },
    ]);
    expect(key).toEqual({ t: 0, m: 'maj' });
    expect(chords.map((c) => c.b)).toEqual([4, 2, 2, 4]);
    expect(chords.map((c) => c.mod)).toEqual([null, null, { t: 5, m: 'maj' }, null]);
    for (const c of chords) {
      const t = triadOf(c.at);
      expect(t.r).toBe(c.r);
      expect(t.q === 'M').toBe(QUALS[c.q].b === 'M');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readMidi, tempoSteps } from '../scripts/score-midi';
import { TempoMap } from '../src/lib/tempo';

describe('MIDI のテンポの変化', () => {
  it('前と同じ比の項と、初めの比 1 の項は除き、同じ時刻の項は後ろのものを残す', () => {
    expect(
      tempoSteps(
        [
          [0, 1],
          [480, 0.5],
          [960, 0.5],
          [1440, 1],
        ],
        null,
      ),
    ).toEqual([
      [480, 0.5],
      [1440, 1],
    ]);
    expect(
      tempoSteps(
        [
          [0, 1],
          [0, 0.9],
          [480, 0.8],
          [480, 0.7],
        ],
        null,
      ),
    ).toEqual([
      [0, 0.9],
      [480, 0.7],
    ]);
  });
  it('反復を展開すると、範囲の始まりにその時刻の比を置き、範囲の中の変化を演奏順の時刻へ移す', () => {
    const steps: [number, number][] = [
        [0, 1],
        [1000, 0.5],
        [3000, 1],
      ],
      /* 0〜2000 を弾いてから 500 へ戻り、2500 まで弾く */
      out = tempoSteps(steps, [
        [0, 2000],
        [500, 2500],
      ]);
    expect(out).toEqual([
      [1000, 0.5],
      [2000, 1],
      [2500, 0.5],
    ]);
    /* 同じ範囲（500〜2000）は、1 回目も 2 回目も同じ時間で弾く */
    const tm = new TempoMap(out);
    expect(tm.tau(4000) - tm.tau(2000)).toBeCloseTo(500 + 1500 / 0.5, 9);
    expect(tm.tau(3500) - tm.tau(2000)).toBeCloseTo(tm.tau(2000) - tm.tau(500), 9);
  });
});

describe('SMF の読み込み', () => {
  it('音のベロシティと、テンポの変化を読む（ランニング・ステータスと、ベロシティ 0 のノートオンも）', () => {
    const track = [
        /* テンポ 500000 と 1000000（96 tick 後） */
        [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20],
        [0x60, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40],
        /* C4（ベロシティ 100）を 96 tick、続けて E4（ベロシティ 40）を 96 tick */
        [0x00, 0x90, 60, 100],
        [0x60, 60, 0],
        [0x00, 64, 40],
        [0x60, 0x80, 64, 0],
        [0x00, 0xff, 0x2f, 0x00],
      ].flat(),
      smf = Uint8Array.from([
        ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96],
        ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length],
        ...track,
      ]),
      m = readMidi(smf);
    expect(m.ppq).toBe(96);
    expect(m.tempo).toEqual([
      { t: 0, us: 500000 },
      { t: 96, us: 1000000 },
    ]);
    expect(m.notes).toEqual([
      { tr: 0, n: 60, t0: 96, t1: 192, v: 100 },
      { tr: 0, n: 64, t0: 192, t1: 288, v: 40 },
    ]);
  });
});

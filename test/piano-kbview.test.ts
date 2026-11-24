import { describe, expect, it } from 'vitest';
import { levelOf, pedalSpans, rollWindow } from '../src/tools/piano/kbview';
import { keyAtX, keyMid, velOf } from '../src/tools/piano/keys';
import { linTicks, logTicks } from '../src/tools/piano/strgraph';
import { KEY_HI, KEY_LO } from '../src/tools/piano/strings';

describe('弦の振動', () => {
  it('横位置から鍵（黒鍵の幅の中は黒鍵）', () => {
    for (let k = KEY_LO; k <= KEY_HI; k++) expect(keyAtX(keyMid(k))).toBe(k);
    expect(keyAtX(-1)).toBeNull();
  });
  it('濃さは 5 m/s で 1、40 dB より小さければ 0、大きいほど濃い', () => {
    expect(levelOf(5)).toBe(1);
    expect(levelOf(50)).toBe(1);
    expect(levelOf(0)).toBe(0);
    expect(levelOf(0.04)).toBe(0);
    expect(levelOf(0.5)).toBeGreaterThan(levelOf(0.2));
  });
  it('弦の振れは、モードの大きさ × 角周波数の和で、減衰とダンパーで小さくなる', () => {
    const v = {
      key: 60,
      L: 0.66,
      x0: 0.08,
      parts: [
        { n: 1, ar: [3e-3], ai: [4e-3], lr: [1000], li: [1], own: [60] },
        { n: 2, ar: [1e-3], ai: [0], lr: [-2000], li: [2], own: [61] },
      ],
    };
    expect(velOf(v, 0, () => 1)).toBeCloseTo(5e-3 * 1000 + 1e-3 * 2000, 12);
    expect(velOf(v, 1, () => 1)).toBeCloseTo(5 * Math.exp(-1) + 2 * Math.exp(-2), 12);
    expect(velOf(v, 0, (o) => (o === 61 ? 0 : 1))).toBeCloseTo(5, 12);
  });
});

describe('楽譜の図', () => {
  const notes = [
      { n: 60, t: 0, d: 4 },
      { n: 64, t: 1, d: 1 },
      { n: 67, t: 2, d: 1 },
      { n: 72, t: 9, d: 1 },
    ],
    starts = [0, 4, 8],
    sec = (beat: number) => (b: number) => (b - beat) * 0.5;
  it('先の 4 秒（8 拍）までと、鳴っている音を返す', () => {
    const v = rollWindow(notes, starts, 4, [], 2.5, sec(2.5));
    expect(v.notes.map((x) => x.key)).toEqual([60, 67, 72]);
    expect(v.notes[0].t0).toBeLessThan(0);
    expect(v.notes[0].t1).toBeGreaterThan(0);
  });
  it('終わった音は返さず、先の音は範囲に入ってから', () => {
    expect(rollWindow(notes, starts, 4, [], 4.5, sec(4.5)).notes.map((x) => x.key)).toEqual([72]);
    expect(rollWindow(notes, starts, 4, [], 0, sec(0)).notes.map((x) => x.key)).toEqual([60, 64, 67]);
  });
  it('小節の頭は番号付きで、今の小節の頭も含む', () => {
    expect(rollWindow(notes, starts, 4, [], 4.2, sec(4.2)).bars.map((b) => b.n)).toEqual([2, 3]);
  });
  it('ペダルの区間は範囲にかかるものだけ', () => {
    const v = rollWindow(
      notes,
      starts,
      4,
      [
        [0, 1],
        [3, 20],
      ],
      2,
      sec(2),
    );
    expect(v.ped).toEqual([[0.5, 9]]);
  });
  it('ペダルの出来事から踏んでいる区間（最後まで離さなければ終わりまで）', () => {
    expect(
      pedalSpans(
        [
          { b: 0.1, on: true },
          { b: 1.9, on: false },
          { b: 2.1, on: true },
        ],
        10,
      ),
    ).toEqual([
      [0.1, 1.9],
      [2.1, 10],
    ]);
  });
});

describe('弦のグラフの目盛り', () => {
  it('対数は 1・2・5 の倍数、多ければ 10 の累乗だけ', () => {
    expect(logTicks(0.04, 2.5)).toEqual([0.05, 0.1, 0.2, 0.5, 1, 2]);
    expect(logTicks(5e-5, 0.05)).toEqual([1e-4, 1e-3, 1e-2]);
  });
  it('線形は 3〜5 本のきりのよい間隔', () => {
    expect(linTicks(-5, 30)).toEqual([0, 10, 20, 30]);
    const t = linTicks(500, 1700);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(6);
  });
});

import { describe, expect, it } from 'vitest';
import { evenLine, tableLine } from '../../src/lib/transport';

describe('演奏の位置の小節', () => {
  it('拍子が一定の曲: 弱起の拍は 1 小節目に含める', () => {
    const l = evenLine({ bar: 4, pickup: 1, end: 33, sec: (b) => b / 2 });
    expect(l.bars).toBe(8);
    expect([1, 2, 3, 8].map((n) => l.start(n))).toEqual([0, 5, 9, 29]);
    expect([0, 0.5, 1, 4.99, 5, 32.9, 40].map((b) => l.barOf(b))).toEqual([1, 1, 1, 1, 2, 8, 8]);
  });

  it('小節の頭から始めると、その小節にいる', () => {
    const l = evenLine({ bar: 3, pickup: 0, end: 96, sec: (b) => b });
    for (let n = 1; n <= l.bars; n++) expect(l.barOf(l.start(n))).toBe(n);
  });

  it('小節線の表から作る: 最初の小節は曲の頭から', () => {
    const l = tableLine({ starts: [0.5, 4.5, 8.5, 11.5], end: 15.5, sec: (b) => b });
    expect(l.bars).toBe(4);
    expect([1, 2, 4].map((n) => l.start(n))).toEqual([0, 4.5, 11.5]);
    expect([0, 4.4, 4.5, 11, 12, 99].map((b) => l.barOf(b))).toEqual([1, 1, 2, 3, 4, 4]);
  });
});

import { describe, expect, it } from 'vitest';
import { eList, linList, nearIdx, nextOf, prevOf, same } from '../../src/lib/eseries';

describe('eList', () => {
  it('1 桁ぶんの E6', () => {
    expect(eList(6, 1, 10)).toEqual([1, 1.5, 2.2, 3.3, 4.7, 6.8, 10]);
  });

  it('範囲の両端を含み、桁をまたいでも丸め誤差を出さない', () => {
    const L = eList(12, 100, 1e6);
    expect(L).toHaveLength(4 * 12 + 1);
    expect(L[0]).toBe(100);
    expect(L.at(-1)).toBe(1e6);
    expect(L).toContain(4700);
    expect(L).toContain(820_000);
  });

  it('小さい値でも正確（C の 1 pF〜1 mF）', () => {
    const L = eList(24, 1e-12, 1e-3);
    expect(L[0]).toBe(1e-12);
    expect(L).toContain(4.7e-9);
    expect(L).toContain(1e-7);
    expect(L.at(-1)).toBe(1e-3);
    expect(L).toHaveLength(9 * 24 + 1);
  });
});

describe('linList', () => {
  it('0.1 刻みで 1〜18', () => {
    const L = linList(1, 18, 0.1);
    expect(L).toHaveLength(171);
    expect(L[1]).toBe(1.1);
    expect(L[23]).toBe(3.3);
    expect(L.at(-1)).toBe(18);
  });
});

describe('前後の値', () => {
  const L = eList(12, 100, 1e6);

  it('系列上の値からは隣の値', () => {
    expect(nextOf(L, 10_000)).toBe(12_000);
    expect(prevOf(L, 10_000)).toBe(8200);
  });

  it('系列にない値からは、その上下で最も近い系列の値', () => {
    expect(nextOf(L, 5000)).toBe(5600);
    expect(prevOf(L, 5000)).toBe(4700);
  });

  it('端では undefined', () => {
    expect(nextOf(L, 1e6)).toBeUndefined();
    expect(prevOf(L, 100)).toBeUndefined();
  });

  it('nearIdx は対数で最も近い値を選ぶ', () => {
    expect(L[nearIdx(L, 5100, true)]).toBe(4700);
    expect(L[nearIdx(L, 5200, true)]).toBe(5600);
  });

  it('same は相対誤差 1e-9 まで同じとみなす', () => {
    expect(same(0.1 + 0.2, 0.3)).toBe(true);
    expect(same(4700, 4701)).toBe(false);
  });
});

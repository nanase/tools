import { describe, expect, it, vi } from 'vitest';
import { ResetSet } from '../../src/lib/reset';

/** 既定値 def の項目。clamp で値の範囲を決める（ほかの項目で範囲が決まる行の代わり） */
function item(v: number, def: number, clamp: (x: number) => number = (x) => x) {
  const it = {
    v,
    reset: vi.fn(() => {
      it.v = clamp(def);
    }),
    isMod: () => it.v !== def,
  };
  return it;
}

describe('既定値に戻す（枠ごとの集まり）', () => {
  it('違う行を枠ごとに数える', () => {
    const s = new ResetSet<string>(),
      a = item(1, 1),
      b = item(2, 1),
      c = item(5, 3);
    s.add('in', a);
    s.add('in', b);
    s.add('view', c);
    expect(s.count('in')).toBe(1);
    expect(s.count('view')).toBe(1);
    expect(s.count('none')).toBe(0);
    expect(s.groups()).toEqual(['in', 'view']);
  });

  it('枠の行だけを戻し、戻した数を返す。既定値の行は触らない', () => {
    const s = new ResetSet<string>(),
      a = item(1, 1),
      b = item(2, 1),
      c = item(5, 3);
    s.add('in', a);
    s.add('in', b);
    s.add('view', c);
    expect(s.reset('in')).toBe(1);
    expect(a.reset).not.toHaveBeenCalled();
    expect(b.v).toBe(1);
    expect(c.v).toBe(5);
    expect(s.count('in')).toBe(0);
    expect(s.reset('in')).toBe(0);
  });

  it('範囲がほかの行で決まる行は、ほかの行を戻した後にもう一度戻す', () => {
    /* fc の上限は fs/2。fs = 2000 の間に fc の既定値 1000 へ戻すと 999 に丸められる */
    const s = new ResetSet<string>(),
      fs = item(2000, 48_000),
      fc = item(500, 1000, (x) => Math.min(x, fs.v / 2 - 1));
    s.add('in', fc);
    s.add('in', fs);
    expect(s.count('in')).toBe(2);
    expect(s.reset('in')).toBe(2);
    expect(fs.v).toBe(48_000);
    expect(fc.v).toBe(1000);
    expect(fc.reset).toHaveBeenCalledTimes(2);
  });

  it('戻らない行があっても 3 回で止める', () => {
    const s = new ResetSet<string>(),
      stuck = item(2, 1, () => 2);
    s.add('in', stuck);
    expect(s.reset('in')).toBe(1);
    expect(stuck.reset).toHaveBeenCalledTimes(3);
    expect(s.count('in')).toBe(1);
  });
});

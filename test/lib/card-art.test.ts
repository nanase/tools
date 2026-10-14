import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/data/tools';
import { ART, artAt } from '../../src/lib/card-art';

describe('カードの図柄', () => {
  it('どのツールにも図柄がある', () => {
    for (const t of TOOLS) expect(artAt(t.ic), t.id).not.toBe('');
  });

  it('動かしても数値が壊れない', () => {
    for (const [k, f] of Object.entries(ART))
      for (let t = 0; t < 120; t += 0.137) expect(f(t), `${k} t=${t}`).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('止まっているときの図柄は毎回同じ', () => {
    for (const k of Object.keys(ART)) expect(artAt(k)).toBe(ART[k](0));
  });
});

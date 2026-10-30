import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/data/tools';

describe('関連ツール', () => {
  const ids = new Set(TOOLS.map((t) => t.id));

  it('どのツールにも、ほかの公開中のツールが 4 件ある', () => {
    for (const t of TOOLS) {
      expect(t.r, t.id).toHaveLength(4);
      expect(new Set(t.r).size, t.id).toBe(t.r.length);
      for (const id of t.r) {
        expect(ids.has(id), `${t.id} → ${id}`).toBe(true);
        expect(id, t.id).not.toBe(t.id);
        expect(TOOLS.find((x) => x.id === id)?.s, `${t.id} → ${id}`).toBeUndefined();
      }
    }
  });
});

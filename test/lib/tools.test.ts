import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/data/tools';

describe('カードの説明', () => {
  /** 半角を 0.5 字に数える（カードでの幅に近づける） */
  const width = (s: string) => [...s].reduce((n, c) => n + (c.charCodeAt(0) < 0x100 ? 0.5 : 1), 0);

  it('どのツールも 34 字以内の 1 文である', () => {
    for (const t of TOOLS) {
      expect(width(t.d), `${t.id}: ${t.d}`).toBeLessThanOrEqual(34);
      expect(t.d.match(/。/g)?.length, `${t.id}: ${t.d}`).toBe(1);
      expect(t.d.endsWith('。'), `${t.id}: ${t.d}`).toBe(true);
    }
  });
});

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

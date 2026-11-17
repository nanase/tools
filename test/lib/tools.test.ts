import { describe, expect, it } from 'vitest';
import { CATS, keys, TOOLS } from '../../src/data/tools';
import { foldKey } from '../../src/lib/dom';

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

describe('絞り込み', () => {
  const hit = (id: string, q: string) => TOOLS.some((t) => t.id === id && keys(t).includes(foldKey(q)));

  it('語末の長音の有無で外れない', () => {
    expect(hit('vvvf', 'モーター音')).toBe(true);
    expect(hit('vvvf', 'モータ音')).toBe(true);
    expect(hit('biquad', 'フィルター')).toBe(true);
    expect(hit('guitar', 'ギタ')).toBe(true);
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

  it('ピアノのアクションの先頭はピアノ', () => {
    expect(TOOLS.find((t) => t.id === 'piano-action')?.r[0]).toBe('piano');
  });

  /** ほかのツールの r に入っている数 */
  const inbound = (id: string) => TOOLS.filter((t) => t.r.includes(id)).length;

  it('どのツールもほかの 2 件以上から関連される', () => {
    for (const t of TOOLS) expect(inbound(t.id), t.id).toBeGreaterThanOrEqual(2);
  });

  it('どのツールも関連される数は 8 件まで', () => {
    for (const t of TOOLS) expect(inbound(t.id), t.id).toBeLessThanOrEqual(8);
  });

  it('4 件のうち 1 件以上はほかのカテゴリ', () => {
    const cat = new Map(TOOLS.map((t) => [t.id, t.c]));
    for (const t of TOOLS)
      expect(
        t.r.some((id) => cat.get(id) !== t.c),
        t.id,
      ).toBe(true);
  });
});

describe('カテゴリ', () => {
  it('どのツールのカテゴリも CATS にある', () => {
    for (const t of TOOLS) expect(CATS, t.id).toContain(t.c);
  });

  it('カテゴリの名前は重ならない', () => {
    expect(new Set(CATS).size).toBe(CATS.length);
  });

  it('空のカテゴリはない', () => {
    for (const c of CATS)
      expect(
        TOOLS.some((t) => t.c === c),
        c,
      ).toBe(true);
  });
});

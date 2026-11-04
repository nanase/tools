import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/data/tools';
import { ART, artAt, LOOP } from '../../src/lib/card-art';

describe('カードの図柄', () => {
  it('どのツールにも図柄がある', () => {
    for (const t of TOOLS) expect(artAt(t.ic), t.id).not.toBe('');
  });

  it('動かしても数値が壊れない', () => {
    for (const [k, f] of Object.entries(ART))
      for (let t = 0; t < 120; t += 0.137) expect(f(t), `${k} t=${t}`).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('1 周進めると同じ絵に戻る', () => {
    /* JJY とノイズは 1 周を短く区切っている（lib/card-art.ts の LOOP） */
    const STEP = new Set(['jjy', 'nz']);
    /* 破線のずらしは、模様 1 つ分ずれても同じ絵 */
    const dash = (s: string): string =>
      s.replace(
        /stroke-dasharray="([\d.]+) ([\d.]+)" stroke-dashoffset="(-?[\d.]+)"/g,
        (_, a, b, o) => `${a} ${b} ${(((+o % (+a + +b)) + +a + +b) % (+a + +b)).toFixed(1)}`,
      );
    const nums = (s: string): number[] => (dash(s).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    for (const k of Object.keys(ART)) {
      const p = LOOP[k];
      expect(p, k).toBeGreaterThan(0);
      if (STEP.has(k)) continue;
      for (let t = 0.0123; t < 10; t += 0.731) {
        const a = nums(ART[k](t)),
          b = nums(ART[k](t + p * 3));
        expect(b.length, `${k} t=${t}`).toBe(a.length);
        /* 小数 1 桁に丸めるので、丸めの境目で 0.1 ずれることはある */
        for (const [i, v] of a.entries()) expect(Math.abs(b[i] - v), `${k} t=${t}`).toBeLessThan(0.15);
      }
    }
  });

  it('止まっているときの図柄は毎回同じ', () => {
    for (const k of Object.keys(ART)) expect(artAt(k)).toBe(ART[k](0));
  });

  it('PNG は全行を差にすると 0 でない値の横線が短くなる', () => {
    const bars = (s: string, cls: string): number[] =>
      [...(s.match(new RegExp(`<path class="${cls}" d="([^"]*)"`))?.[1] ?? '').matchAll(/M74 \d+H([\d.]+)/g)].map(
        (m) => Number(m[1]) - 74,
      );
    const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
    /* 始まりはすべて青、最後の行まで済むとすべて黄 */
    const raw = bars(ART.png(0.01), 'b');
    const dif = bars(ART.png(3), 'a');
    expect(raw.length).toBeGreaterThan(0);
    expect(dif.length).toBeGreaterThan(0);
    expect(bars(ART.png(3), 'b')).toEqual([]);
    expect(sum(dif)).toBeLessThan(sum(raw) / 2);
  });

  it('天体衝突の止まっている絵は衝突の前で、動かすと地表がへこむ', () => {
    const ground = (s: string): string => s.match(/<path class="a" d="([^"]*)"/)?.[1] ?? '';
    const still = ART.imp(0),
      after = ART.imp(2);
    expect(still).toContain('r="3.6"');
    expect(ground(still)).toContain('L60 28L');
    expect(after).not.toContain('r="3.6"');
    expect(ground(after)).toContain('L60 37L');
  });
});

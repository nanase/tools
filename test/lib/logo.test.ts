import { describe, expect, it } from 'vitest';
import { wavePath } from '../../src/lib/logo';

const edges = (d: string) => [...d.matchAll(/H([\d.]+)V/g)].map((m) => +m[1]);

describe('アイコンの矩形波', () => {
  it('倍率 1 で Rail.astro の元の波になる', () => {
    expect(wavePath(1)).toBe('M5 20H10V9H16V20H22V9H25');
  });
  it('どの倍率でも x = 16 の立ち下がりは動かない', () => {
    for (const s of [0.5, 0.7, 1.3, 2]) expect(wavePath(s)).toContain('H16V20');
  });
  it('縁の間隔は半周期の 6s', () => {
    for (const s of [0.5, 0.8, 1.5]) {
      const e = edges(wavePath(s));
      for (let i = 1; i < e.length; i++) expect(e[i] - e[i - 1]).toBeCloseTo(6 * s, 1);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { riseTransitSet } from '../../src/lib/astro/observer';
import { bisect, golden } from '../../src/lib/astro/solve';
import { earthHelio, sunEcl } from '../../src/lib/astro/sun';
import { dateOfJd, deltaT, jdOfDate } from '../../src/lib/astro/time';

const D = Math.PI / 180;

describe('astro', () => {
  it('地球の日心位置は Meeus の例 25.b（1992-10-13 0h TD）に合う', () => {
    const t = (2448908.5 - 2451545) / 36525;
    const e = earthHelio(t);
    expect(e.lon / D).toBeCloseTo(19.907372, 3);
    // 黄緯は打ち切った項の分だけずれる（0.1″ 未満）
    expect(Math.abs((e.lat / D) * 3600 + 0.644)).toBeLessThan(0.1);
    expect(e.r).toBeCloseTo(0.99760775, 5);
    // 太陽は地球の反対側。FK5 への補正 −0.09033″ と光行差 −20.4898″/R だけずれる
    const s = sunEcl(t);
    expect(((s.lon - e.lon) / D - 180) * 3600).toBeCloseTo(-0.09033 - 20.4898 / e.r, 6);
    expect(s.lat).toBe(-e.lat);
  });

  it('JD と Date は行き来でき、ΔT は 2026 年に 70 秒ほど', () => {
    const d = new Date(Date.UTC(2026, 9, 31, 12));
    expect(jdOfDate(d)).toBe(2461345);
    expect(dateOfJd(jdOfDate(d)).getTime()).toBe(d.getTime());
    expect(deltaT(2461345)).toBeGreaterThan(65);
    expect(deltaT(2461345)).toBeLessThan(80);
  });

  it('根と極小を探せる', () => {
    expect(bisect((x) => x * x - 2, 0, 2, 40)).toBeCloseTo(Math.SQRT2, 9);
    expect(golden((x) => (x - 0.3) ** 2, -1, 1)).toBeCloseTo(0.3, 6);
  });

  it('出・南中・入りを判定の値の符号の変わり目から求める', () => {
    // 6 時に出て 12 時に南中し 18 時に入る天体
    const f = (jd: number): [number, number] => {
      const h = (jd % 1) * 24;
      return [Math.sin(((h - 6) / 12) * Math.PI), Math.cos(((h - 6) / 12) * Math.PI)];
    };
    const r = riseTransitSet(0, f);
    expect((r.rise ?? Number.NaN) * 24).toBeCloseTo(6, 3);
    expect(r.transit * 24).toBeCloseTo(12, 3);
    expect((r.set ?? Number.NaN) * 24).toBeCloseTo(18, 3);
  });
});

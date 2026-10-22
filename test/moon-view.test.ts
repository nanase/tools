import { describe, expect, it } from 'vitest';
import type { MoonState } from '../src/tools/moon/ephem';
import { malV, POS_U } from '../src/tools/moon/render';
import { basis, earthshine, lunarL, moonUniforms, project, sunAltAt, unproject } from '../src/tools/moon/view';

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 月固定の軸を赤道座標の軸と同じにした、上弦の月（太陽は +x 側の遠く、観測者は −y 側） */
function fake(): MoonState {
  const moon: V = [0, 384400, 0];
  return {
    moon,
    sun: [1.496e8, 384400, 0],
    obs: [0, 0, 0],
    mx: [1, 0, 0],
    my: [0, 1, 0],
    mz: [0, 0, 1],
    zenith: [0, 0, 1],
    pole: [0, 0, 1],
    phase: 90,
  } as unknown as MoonState;
}

describe('見え方', () => {
  it('画面の基底は直交し、奥は観測者から月へ', () => {
    const st = fake();
    for (const m of ['zenith', 'moon', 'sky'] as const) {
      const { r, u, f } = basis(st, m);
      expect(dot(r, u)).toBeCloseTo(0, 12);
      expect(dot(r, f)).toBeCloseTo(0, 12);
      expect(f[1]).toBeCloseTo(1, 12);
      expect(u[2]).toBeCloseTo(1, 12);
    }
  });
  it('画面の点と月面の点を行き来できる', () => {
    const st = fake();
    for (const [x, y] of [
      [0.1, 0.2],
      [-0.6, 0.3],
      [0.7, -0.65],
    ]) {
      const ll = unproject(st, 'zenith', x, y);
      expect(ll).not.toBeNull();
      const p = project(st, 'zenith', ...(ll as [number, number]));
      expect(p?.[0]).toBeCloseTo(x, 10);
      expect(p?.[1]).toBeCloseTo(y, 10);
    }
    expect(unproject(st, 'zenith', 0.8, 0.8)).toBeNull();
  });
  it('上弦では、太陽は月面の経度 90° 側の真上', () => {
    const st = fake();
    // 観測者は −y（地球）側。月面の +x が太陽の向き
    expect(sunAltAt(st, 0, 0)).toBeCloseTo(90, 3);
    expect(sunAltAt(st, 0, 90)).toBeCloseTo(0, 3);
  });
  it('lunar-Lambert の L と地球照', () => {
    expect(lunarL(0)).toBe(1);
    expect(lunarL(90)).toBeCloseTo(1 - 1.71 + 1.9602 - 1.0643, 4);
    expect(earthshine(180)).toBeCloseTo(1 / 8000, 12);
    expect(earthshine(0)).toBe(0);
  });
  it('影の外では月食の値を渡さない', () => {
    const u = moonUniforms(fake(), 'zenith', 'eye', { axis: [1, 0, 0], Ru: 0.7, Rp: 1.25, sdMoon: 0.26, x: 3, y: 0 });
    expect(u.ecl).toBeUndefined();
  });
});

describe('本影の減光（Mallama 2022 表 B.1）', () => {
  it('半影の外縁で 0、中心で V 15.44 等、本影の縁で表の 0.429 の行', () => {
    expect(malV(1.25, 0.7, 1.25)).toBeCloseTo(0, 6);
    expect(malV(0, 0.7, 1.25)).toBeCloseTo(15.44, 6);
    expect(malV(0.7, 0.7, 1.25)).toBeCloseTo(6.76, 6);
    expect(POS_U).toBe(0.429);
  });
});

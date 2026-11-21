import { describe, expect, it } from 'vitest';
import {
  BIKE_RATIO,
  bend,
  CAM,
  engineAt,
  LANE_X,
  ROAD_L,
  ROAD_W,
  speedStep,
  TREE_FAR,
  TREE_NEAR,
  TREES,
  treesAhead,
  V_MAX,
} from '../src/tools/texture-filter/drive';
import { type Filter, maxReads, mipChain, mipMemory, NL, TS, usesMip } from '../src/tools/texture-filter/filter';
import { roadLevels, TREE_PX, treeLevels } from '../src/tools/texture-filter/textures';

const solid = (v: number) => new Uint8ClampedArray(TS * TS * 4).fill(v);
const F = (b: 0 | 1 | 2 | 3, m: 0 | 1 = 1, a = 16): Filter => ({ b, m, a });

describe('ミップマップ', () => {
  it('段は 256 から 1 までの 9 段', () => {
    const L = mipChain(solid(10));
    expect(L).toHaveLength(NL);
    L.forEach((d, l) => {
      expect(d.length).toBe((TS >> l) ** 2 * 4);
    });
  });
  it('各段は上の段の 2 × 2 画素の平均', () => {
    /* 市松（1 画素ごとに 0 と 200）は 1 段目で一様な 100 になる */
    const L0 = new Uint8ClampedArray(TS * TS * 4);
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) L0.fill((x + y) % 2 ? 200 : 0, (y * TS + x) * 4, (y * TS + x) * 4 + 4);
    const L = mipChain(L0);
    expect([...new Set(L[1])]).toEqual([100]);
    expect([...L[NL - 1]]).toEqual([100, 100, 100, 100]);
  });
  it('透明な所の色は混ぜない（木の絵）', () => {
    /* 2 × 2 の左上だけ不透明な赤、ほかは透明な黒 */
    const L0 = new Uint8ClampedArray(16);
    L0.set([255, 0, 0, 255]);
    const [, top] = mipChain(L0, 2, true);
    expect([...top]).toEqual([255, 0, 0, 64]);
  });
  it('大きさが違えば断る', () => {
    expect(() => mipChain(new Uint8ClampedArray(16))).toThrow();
    expect(() => mipChain(new Uint8ClampedArray(9 * 4), 3)).toThrow();
  });
  it('メモリは元の絵の約 4/3 倍', () => {
    expect(mipMemory()).toBeCloseTo(4 / 3, 4);
  });
});

describe('読む画素の数', () => {
  it('数の上限と、トライリニア・異方性はミップマップあり', () => {
    expect([F(0), F(1), F(2), F(3, 1, 4)].map(maxReads)).toEqual([1, 4, 8, 32]);
    expect(usesMip(F(2, 0))).toBe(true);
    expect(usesMip(F(1, 0))).toBe(false);
  });
});

describe('テクスチャ', () => {
  const px = (L: Uint8ClampedArray[], size: number, x: number, y: number) => [
    ...L[0].subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
  ];
  const col = (xm: number) => Math.floor(((xm + ROAD_W / 2) / ROAD_W) * TS);
  const row = (ym: number) => Math.floor((ym / ROAD_L) * TS);
  it('道路: 中央の破線は 8 m 引いて 12 m 空ける', () => {
    const L = roadLevels();
    expect(L).toHaveLength(NL);
    expect(px(L, TS, col(0), row(4))[0]).toBeGreaterThan(200);
    expect(px(L, TS, col(0), row(14))[0]).toBeLessThan(120);
  });
  it('道路: 左車線の中心はアスファルト、縁石は赤と白', () => {
    const L = roadLevels();
    expect(px(L, TS, col(LANE_X), row(5))[0]).toBeLessThan(120);
    const a = px(L, TS, col(-4), row(1)),
      b = px(L, TS, col(-4), row(3.5));
    expect(a[0] - a[1]).toBeGreaterThan(100);
    expect(b[1]).toBeGreaterThan(200);
  });
  it('木: 64 画素から 7 段、根元は不透明・四隅は透明', () => {
    for (const k of [0, 1] as const) {
      const L = treeLevels(k);
      expect(L).toHaveLength(7);
      expect(px(L, TREE_PX, 32, 60)[3]).toBe(255);
      expect(px(L, TREE_PX, 0, 0)[3]).toBe(0);
    }
  });
});

describe('走る', () => {
  it('アクセルで速くなり、最高は約 200 km/h', () => {
    let v = 0;
    for (let i = 0; i < 6000; i++) v = speedStep(v, true, false, 0.01);
    expect(v).toBeLessThanOrEqual(V_MAX);
    expect(v * 3.6).toBeGreaterThan(195);
  });
  it('ブレーキで止まり、負にはならない', () => {
    let v = 30;
    for (let i = 0; i < 500; i++) v = speedStep(v, false, true, 0.01);
    expect(v).toBe(0);
  });
  it('どちらも離すと速さを保つ', () => {
    expect(speedStep(30, false, false, 1)).toBe(30);
    expect(speedStep(0, false, false, 1)).toBe(0);
  });
  it('道は前方の距離の 2 乗で横へずれる', () => {
    expect(bend(0.002, 100)).toBeCloseTo(10);
    expect(bend(0.002, 50)).toBeCloseTo(2.5);
  });
  it('木は描く範囲の中だけを遠い順に、道の外に並べる', () => {
    const t = treesAhead(1234, 0);
    expect(t.length).toBeGreaterThan(10);
    for (let i = 1; i < t.length; i++) expect(t[i].d).toBeLessThanOrEqual(t[i - 1].d);
    for (const x of t) {
      expect(x.d).toBeGreaterThanOrEqual(TREE_NEAR);
      expect(x.d).toBeLessThanOrEqual(TREE_FAR);
      expect(Math.abs(x.x + LANE_X)).toBeGreaterThan(5);
    }
    for (const x of TREES) expect(Math.abs(x.x)).toBeGreaterThanOrEqual(6);
  });
  it('目の高さは 1.2 m', () => {
    expect(CAM.y).toBe(1.2);
  });
});

describe('エンジンの音', () => {
  it('止まっているときはアイドリング、速いほど高いギア', () => {
    expect(engineAt(0)).toEqual({ gear: 1, rpm: 1400 });
    expect(engineAt(V_MAX).gear).toBe(4);
    expect(engineAt(20).gear).toBeLessThan(engineAt(V_MAX).gear);
  });
  it('映像の 200 km/h はバイクの約 85 km/h で、燃料を切る回転数より下', () => {
    expect((V_MAX * 3.6) / BIKE_RATIO).toBeCloseTo(85.4, 0);
    expect(engineAt(V_MAX).rpm).toBeLessThan(7800);
    expect(engineAt(V_MAX).rpm).toBeGreaterThan(5500);
  });
});

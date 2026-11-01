import { describe, expect, it } from 'vitest';
import { lum, METALS, surfEval, type Vec3 } from '../src/lib/brdf';
import { polarSvg, scaleOf } from '../src/tools/shading/lobe';
import { hexToLinear, linearToHex, PRESETS } from '../src/tools/shading/material';
import {
  FLOOR_CAM,
  FLOOR_TOP,
  FLOOR_Y,
  floorAt,
  floorIncidence,
  floorMesh,
  floorMirror,
  floorScreen,
  lightForFloor,
  STRIDE,
  sphereMesh,
} from '../src/tools/shading/mesh';
import {
  blinnExp,
  brdf,
  buildLut,
  buildLuts,
  furnaceAvg,
  lobeIntegral,
  lutAt,
  MODELS,
  type ModelId,
  makeShade,
  reflectance,
  type Shade,
  type ShadeInput,
  specular,
} from '../src/tools/shading/models';

const luts = buildLuts(true, true);
const WHITE: Vec3 = [1, 1, 1];
const inp = (o: Partial<ShadeInput> = {}): ShadeInput => ({
  base: [0.5, 0.2, 0.1],
  metal: 0,
  f0: 0.04,
  rough: 0.35,
  norm: true,
  quarter: true,
  ms: false,
  ...o,
});
const shade = (o: Partial<ShadeInput> = {}): Shade => makeShade(inp(o), luts);
const dirOf = (mu: number): Vec3 => [Math.sqrt(1 - mu * mu), 0, mu];

/** 半球を細かい格子で積分する（重点的サンプリングの検算） */
function hemi(f: (w: Vec3) => number, nt = 720, np = 720): number {
  let sum = 0;
  for (let i = 0; i < nt; i++) {
    const t = ((i + 0.5) / nt) * (Math.PI / 2),
      st = Math.sin(t),
      ct = Math.cos(t);
    for (let j = 0; j < np; j++) {
      const p = ((j + 0.5) / np) * 2 * Math.PI;
      sum += f([st * Math.cos(p), st * Math.sin(p), ct]) * ct * st;
    }
  }
  return sum * (Math.PI / 2 / nt) * ((2 * Math.PI) / np);
}

describe('式', () => {
  it('GGX の鏡面と拡散は lib/brdf.ts の surfEval と同じ', () => {
    const s = shade({ metal: 0.3, rough: 0.5 }),
      V = dirOf(0.7),
      L: Vec3 = [-0.5, 0.3, Math.sqrt(1 - 0.34)];
    const a = brdf('ggx', s, V, L),
      b = surfEval({ base: s.base, metal: s.metal, a: s.a, spec: s.f0 / 0.08 }, V, L);
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 10);
  });

  it('Phong の指数は Blinn-Phong の 1/4 にそろえられる', () => {
    const q = shade({ rough: 0.3 }),
      e = shade({ rough: 0.3, quarter: false });
    expect(q.nP).toBeCloseTo(q.nB / 4, 10);
    expect(e.nP).toBeCloseTo(e.nB, 10);
    expect(blinnExp(1)).toBe(0);
  });

  it('同じ粗さのハイライトの幅は Phong と Blinn-Phong でそろう', () => {
    /* 垂直に入る光で、値が半分になる角度を比べる */
    const s = shade({ rough: 0.2, base: [0, 0, 0] }),
      half = (id: ModelId): number => {
        const L: Vec3 = [0, 0, 1],
          f0 = lum(specular(id, s, [0, 0, 1], L));
        for (let d = 0; d < 90; d += 0.01) {
          const q = (d * Math.PI) / 180;
          if (lum(specular(id, s, [Math.sin(q), 0, Math.cos(q)], L)) < f0 / 2) return d;
        }
        return 90;
      };
    expect(Math.abs(half('phong') / half('blinn') - 1)).toBeLessThan(0.02);
  });

  it('正規化した式は相反する', () => {
    const s = shade({ rough: 0.4 }),
      A: Vec3 = dirOf(0.8),
      B: Vec3 = [-0.4, 0.2, Math.sqrt(1 - 0.2)];
    for (const m of MODELS) {
      const a = brdf(m.id, s, A, B),
        b = brdf(m.id, s, B, A);
      for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 10);
    }
  });

  it('金属の Lambert は色を拡散に使い、ほかの式は拡散をなくす', () => {
    const s = shade({ metal: 1, base: METALS.gold, rough: 1 }),
      V: Vec3 = [0, 0, 1],
      L: Vec3 = dirOf(0.6);
    expect(brdf('lambert', s, V, L)[0]).toBeCloseTo(METALS.gold[0] / Math.PI, 10);
    expect(specular('lambert', s, V, L)).toEqual([0, 0, 0]);
    /* r = 1 の Phong は指数 0 の一様な鏡面だけになる */
    expect(brdf('phong', s, V, L)[1]).toBeCloseTo(METALS.gold[1] / Math.PI, 10);
  });
});

describe('半球の積分', () => {
  it.each([
    ['ggx', 0.3, 0.9],
    ['ggx', 0.7, 0.4],
    ['ggx', 1, 1],
    ['phong', 0.4, 0.9],
    ['phong', 0.8, 0.3],
    ['blinn', 0.4, 0.9],
    ['blinn', 0.8, 0.3],
  ] as const)('%s（粗さ %f・余弦 %f）は格子の積分と合う', (id, rough, mu) => {
    const s = shade({ rough, base: [0, 0, 0], metal: 1 }),
      white = makeShade({ ...inp({ rough, metal: 1, base: WHITE }) }, luts),
      V = dirOf(mu),
      grid = hemi((w) => lum(specular(id, white, V, w))),
      [A, B] = lobeIntegral(id, { a: s.a, nP: s.nP, nB: s.nB, norm: true }, mu, 4096);
    expect(A + B).toBeCloseTo(grid, 2);
  });

  it('r = 1 の Blinn-Phong は光を失わず、Phong は反射方向の裏側の分を失う', () => {
    const c = { a: 1, nP: 0, nB: 0, norm: true };
    expect(lobeIntegral('blinn', c, 0.8, 4096)[0]).toBeCloseTo(1, 2);
    expect(lobeIntegral('phong', c, 1, 4096)[0]).toBeCloseTo(1, 2);
    expect(lobeIntegral('phong', c, 0.8, 4096)[0]).toBeLessThan(0.95);
  });

  it('正規化しない式の反射率は格子の積分と合う', () => {
    const s = shade({ rough: 0.5, norm: false, base: [0, 0, 0], metal: 1 }),
      white = makeShade(inp({ rough: 0.5, norm: false, metal: 1, base: WHITE }), luts),
      mu = 0.6,
      L = dirOf(mu);
    for (const id of ['phong', 'blinn'] as const) {
      const grid = hemi((w) => lum(specular(id, white, w, L))),
        [A] = lobeIntegral(id, { a: s.a, nP: s.nP, nB: s.nB, norm: false }, mu, 4096, true);
      expect(A).toBeCloseTo(grid, 2);
    }
  });

  it('反射率は格子の積分と合う', () => {
    const s = shade({ rough: 0.4, base: [0.6, 0.3, 0.2] }),
      mu = 0.7,
      L = dirOf(mu);
    for (const m of MODELS) {
      const grid = hemi((w) => lum(brdf(m.id, s, w, L)));
      expect(reflectance(m.id, s, mu)).toBeCloseTo(grid, 2);
    }
  });

  it('表は直接の積分と合い、粗い GGX ほど光を失う', () => {
    const [A, B] = lobeIntegral('ggx', { a: 0.36, nP: 0, nB: 0, norm: true }, 0.5, 1024),
      c = lutAt(luts.ggx, 0.5, 0.6);
    expect(c[0] + c[1]).toBeCloseTo(A + B, 2);
    expect(furnaceAvg('ggx', luts, 1, false)).toBeLessThan(furnaceAvg('ggx', luts, 0.6, false));
    expect(furnaceAvg('ggx', luts, 0.6, false)).toBeLessThan(furnaceAvg('ggx', luts, 0.2, false));
    expect(furnaceAvg('ggx', luts, 0.2, false)).toBeGreaterThan(0.99);
    expect(furnaceAvg('ggx', luts, 1, false)).toBeLessThan(0.6);
    expect(furnaceAvg('lambert', luts, 1, false)).toBe(1);
  });
});

describe('多重散乱の補正', () => {
  it.each([0.4, 0.7, 1])('F0 = 1 の GGX は粗さ %f でも光を失わない', (rough) => {
    const s = makeShade(inp({ rough, metal: 1, base: WHITE, ms: true }), luts),
      V = dirOf(0.6);
    expect(hemi((w) => lum(brdf('ggx', s, V, w)))).toBeCloseTo(1, 1);
    expect(furnaceAvg('ggx', luts, rough, true)).toBe(1);
  });

  it('補正は明るくするだけで、Phong には効かない', () => {
    const on = shade({ rough: 0.8, metal: 1, base: WHITE, ms: true }),
      off = shade({ rough: 0.8, metal: 1, base: WHITE, ms: false }),
      V = dirOf(0.7),
      L = dirOf(0.5);
    expect(lum(brdf('ggx', on, V, L))).toBeGreaterThan(lum(brdf('ggx', off, V, L)));
    expect(brdf('phong', on, V, L)).toEqual(brdf('phong', off, V, L));
  });
});

describe('表の作り直し', () => {
  it('GGX の表は設定で変わらないので使い回す', () => {
    const next = buildLuts(false, false, luts);
    expect(next.ggx).toBe(luts.ggx);
    expect(next.phong).not.toBe(luts.phong);
  });

  it('正規化しない表は小さくなる', () => {
    const u = buildLut('blinn', true, false, 64);
    expect(lutAt(u, 0.8, 0.3)[0]).toBeLessThan(lutAt(luts.blinn, 0.8, 0.3)[0]);
  });
});

describe('ローブの図', () => {
  it('対数の目盛りは範囲の中に入る', () => {
    const sc = scaleOf(123, true);
    expect(sc.map(123)).toBeCloseTo(1, 10);
    expect(sc.map(0.0001)).toBe(0);
    for (const [k] of sc.rings) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
    }
    expect(sc.rings.map((r) => r[1])).toEqual([100, 10, 1]);
  });

  it('線形の目盛りは最大が 1', () => {
    const sc = scaleOf(8, false);
    expect(sc.map(8)).toBe(1);
    expect(sc.map(4)).toBe(0.5);
  });

  it.each([0, 0.4, 1.3])('入射角 %f rad でも数値が壊れない', (t) => {
    for (const log of [true, false]) {
      const o = polarSvg(
        MODELS.map((m) => m.id),
        shade({ rough: 0.05 }),
        t,
        log,
      );
      expect(o).not.toMatch(/NaN|Infinity/);
      expect(o.match(/sh-lobe/g)).toHaveLength(4);
    }
  });
});

describe('形', () => {
  it('球の頂点は半径 1 の上にあり、面の法線は外を向く', () => {
    const m = sphereMesh(6);
    expect(m.length).toBe(6 * 12 * 6 * STRIDE);
    for (let i = 0; i < m.length; i += STRIDE) {
      expect(Math.hypot(m[i], m[i + 1], m[i + 2])).toBeCloseTo(1, 5);
      const dot = m[i + 6] * m[i + 9] + m[i + 7] * m[i + 10] + m[i + 8] * m[i + 11];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('床の頂点は床の高さにあり、画面の下から地平線の手前までを覆う', () => {
    const m = floorMesh(4),
      { eye, t, k } = FLOOR_CAM;
    let lo = 9,
      hi = -9;
    for (let i = 0; i < m.length; i += STRIDE) {
      expect(m[i + 1]).toBe(FLOOR_Y);
      const w = eye[2] - m[i + 2],
        v = ((m[i + 1] - eye[1]) / w + k) / t;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeLessThan(-1);
    expect(hi).toBeGreaterThan(0.6);
    expect(hi).toBeLessThan(k / t);
  });
});

describe('床のハイライト', () => {
  it.each([
    [0, 0],
    [0.7, -0.8],
    [-0.9, 0.5],
    [0.3, 0.64],
  ])('平行光で、押した位置 (%f, %f) にハイライトの中心が来る', (u, v) => {
    const L = lightForFloor(floorAt(u, v), false, 3),
      P = floorMirror(L, false, 3);
    expect(P).not.toBeNull();
    const m = floorScreen(P as Vec3);
    expect(m[0]).toBeCloseTo(u, 6);
    expect(m[1]).toBeCloseTo(v, 6);
  });

  it.each([
    [0, -0.5],
    [0.5, -0.8],
  ])('点光源でも (%f, %f) にハイライトの中心が来る', (u, v) => {
    const L = lightForFloor(floorAt(u, v), true, 5),
      P = floorMirror(L, true, 5);
    expect(P).not.toBeNull();
    const m = floorScreen(P as Vec3);
    expect(m[0]).toBeCloseTo(u, 6);
    expect(m[1]).toBeCloseTo(v, 6);
  });

  it('届かない遠い点でも光は床より上に残る', () => {
    const L = lightForFloor(floorAt(0, FLOOR_TOP), true, 1.2);
    expect(L[1] * 1.2).toBeGreaterThan(FLOOR_Y);
  });

  it('地平線より上を押しても床の点になる', () => {
    expect(floorScreen(floorAt(0, 0.95))[1]).toBeCloseTo(FLOOR_TOP, 6);
  });

  it('床の正反射の点での入射角と光の高さが合う', () => {
    const L: Vec3 = [0, 0.5, -Math.sqrt(0.75)];
    expect(floorIncidence(L, false, 3)).toBeCloseTo(Math.PI / 3, 6);
    expect(floorMirror([0, 0.5, Math.sqrt(0.75)], false, 3)).toBeNull();
  });
});

describe('材質', () => {
  it('色の変換は 8 ビットの範囲で元に戻る', () => {
    for (const hex of ['#c4372e', '#000000', '#ffffff', '#0a6e8a']) expect(linearToHex(hexToLinear(hex))).toBe(hex);
  });

  it('金属のプリセットは lib/brdf.ts の F0 に近い', () => {
    const gold = PRESETS.find((p) => p.id === 'gold');
    const c = hexToLinear(gold?.hex ?? '#000000');
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(METALS.gold[i], 2);
    expect(gold?.metal).toBe(1);
  });
});

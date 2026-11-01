import { describe, expect, it } from 'vitest';
import {
  dGGX,
  f0FromNk,
  fDielectric,
  fSchlick,
  g1Smith,
  g2Smith,
  METALS,
  pdfVndfRefl,
  type Surf,
  sampleCos,
  sampleVndf,
  surfEval,
  surfPdf,
  surfPSpec,
  type Vec3,
} from '../src/lib/brdf';
import {
  kelvinRgb,
  LIGHT_KIND,
  MAX_MATS,
  MAX_QUADS,
  MAX_SPHERES,
  makeScene,
  orbit,
  packScene,
  SCENES,
} from '../src/tools/raytracing/scene';

/** 再現できる乱数 */
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('GGX', () => {
  it('法線の分布は余弦で重み付けて積分すると 1', () => {
    for (const a of [0.05, 0.2, 0.5, 1]) {
      /* 変数変換 z = cos θ の台形則。α が小さいと山が鋭いので細かく刻む */
      const N = 200000;
      let s = 0;
      for (let i = 0; i < N; i++) {
        const z = (i + 0.5) / N;
        s += dGGX(a, z) * z * ((2 * Math.PI) / N);
      }
      expect(s).toBeCloseTo(1, 3);
    }
  });
  it('遮蔽は 0〜1 で、視線が垂直なら 1', () => {
    expect(g1Smith(0.5, 1)).toBeCloseTo(1, 10);
    expect(g2Smith(0.5, 1, 1)).toBeCloseTo(1, 10);
    expect(g1Smith(0.5, 0.1)).toBeGreaterThan(0);
    expect(g1Smith(0.5, 0.1)).toBeLessThan(1);
    expect(g2Smith(0.5, 0.3, 0.3)).toBeLessThan(g1Smith(0.5, 0.3));
  });
  it('見える法線のサンプリングは pdf と合う（一様な積分と重点的サンプリングの値が一致する）', () => {
    const V: Vec3 = [Math.sin(1), 0, Math.cos(1)];
    for (const a of [0.1, 0.4, 0.8]) {
      const r = lcg(3),
        N = 100000;
      let imp = 0,
        inside = 0;
      for (let i = 0; i < N; i++) {
        const H = sampleVndf(V, a, r(), r()),
          VoH = V[0] * H[0] + V[1] * H[1] + V[2] * H[2],
          Lz = 2 * VoH * H[2] - V[2];
        if (Lz <= 0) continue;
        inside++;
        /* f cos / pdf = G2 / G1 */
        imp += g2Smith(a, V[2], Lz) / g1Smith(a, V[2]);
      }
      imp /= N;
      const M = 1000;
      let uni = 0,
        pdfSum = 0;
      for (let i = 0; i < M; i++) {
        const z = (i + 0.5) / M;
        for (let j = 0; j < M / 2; j++) {
          const ph = (2 * Math.PI * (j + 0.5)) / (M / 2),
            q = Math.sqrt(1 - z * z),
            L: Vec3 = [q * Math.cos(ph), q * Math.sin(ph), z],
            Hn = Math.hypot(V[0] + L[0], V[1] + L[1], V[2] + L[2]),
            H: Vec3 = [(V[0] + L[0]) / Hn, (V[1] + L[1]) / Hn, (V[2] + L[2]) / Hn],
            d = dGGX(a, H[2]) * ((2 * Math.PI) / (M * (M / 2)));
          uni += (d * g2Smith(a, V[2], z)) / (4 * V[2]);
          pdfSum += pdfVndfRefl(V, H, a) * ((2 * Math.PI) / (M * (M / 2)));
        }
      }
      expect(imp).toBeCloseTo(uni, 2);
      expect(inside / N).toBeCloseTo(pdfSum, 2);
    }
  });
});

describe('フレネル', () => {
  it('Schlick は垂直で F0、すれすれで 1', () => {
    expect(fSchlick([0.04, 0.5, 1], 1)).toEqual([0.04, 0.5, 1]);
    for (const v of fSchlick([0.04, 0.5, 1], 0)) expect(v).toBeCloseTo(1, 12);
  });
  it('誘電体は垂直で ((n−1)/(n+1))²、全反射で 1', () => {
    expect(fDielectric(1, 1 / 1.5)).toBeCloseTo(0.04, 10);
    expect(fDielectric(0.1, 1.5)).toBe(1);
  });
  it('複素屈折率からの F0', () => {
    expect(f0FromNk(1.5, 0)).toBeCloseTo(0.04, 10);
    expect(METALS.silver[0]).toBeGreaterThan(0.95);
    expect(METALS.gold[0]).toBeGreaterThan(METALS.gold[2]);
    expect(METALS.copper[0]).toBeGreaterThan(METALS.copper[1]);
  });
});

describe('表面の反射', () => {
  const lambert: Surf = { base: [0.5, 0.5, 0.5], metal: 0, a: 1, spec: 0 };
  const rough: Surf = { base: [1, 1, 1], metal: 1, a: 0.3, spec: 0 };
  it('拡散だけの面は鏡面を選ばず ρ/π', () => {
    expect(surfPSpec(lambert, 0.1)).toBe(0);
    const f = surfEval(lambert, [0, 0, 1], [0, 0, 1]);
    expect(f[0]).toBeCloseTo(0.5 / Math.PI, 10);
    expect(surfPdf(lambert, [0, 0, 1], [0, 0, 1])).toBeCloseTo(1 / Math.PI, 10);
  });
  it('余弦のサンプリングは半球の中で pdf = cos θ / π', () => {
    const r = lcg(7),
      N = 100000;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const L = sampleCos(r(), r());
      expect(L[2]).toBeGreaterThanOrEqual(0);
      s += L[2];
    }
    /* cos の平均は 2/3 */
    expect(s / N).toBeCloseTo(2 / 3, 2);
  });
  it('エネルギーを増やさない（白い炉）', () => {
    const r = lcg(5),
      N = 300000,
      V: Vec3 = [Math.sin(0.5), 0, Math.cos(0.5)];
    let s = 0;
    for (let i = 0; i < N; i++) {
      const z = r(),
        ph = 2 * Math.PI * r(),
        q = Math.sqrt(1 - z * z);
      const L: Vec3 = [q * Math.cos(ph), q * Math.sin(ph), z];
      s += surfEval(rough, V, L)[0] * L[2] * 2 * Math.PI;
    }
    s /= N;
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThan(0.8);
  });
});

describe('色温度', () => {
  it('輝度は 1 で、低いと赤く高いと青い', () => {
    for (const T of [1800, 3000, 4000, 6500, 12000]) {
      const c = kelvinRgb(T);
      expect(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toBeCloseTo(1, 10);
      for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
    }
    const lo = kelvinRgb(2000),
      hi = kelvinRgb(10000);
    expect(lo[0]).toBeGreaterThan(lo[2]);
    expect(hi[2]).toBeGreaterThan(hi[0]);
  });
  it('6500 K はほぼ白', () => {
    const c = kelvinRgb(6500);
    for (const v of c) expect(Math.abs(v - 1)).toBeLessThan(0.05);
  });
});

describe('場面', () => {
  const kinds = ['rect', 'sphere', 'point', 'sky'] as const;
  it('すべての場面と光源が配列に収まる', () => {
    for (const [id] of SCENES) {
      for (const kind of kinds) {
        const sc = makeScene(id, { kind, size: 0.5, power: 1, kelvin: 4000 });
        expect(sc.quads.length).toBeLessThanOrEqual(MAX_QUADS);
        expect(sc.spheres.length).toBeLessThanOrEqual(MAX_SPHERES);
        expect(sc.mats.length).toBeLessThanOrEqual(MAX_MATS);
        const p = packScene(sc);
        expect(p.litK).toBe(LIGHT_KIND[kind]);
        for (const q of sc.quads) expect(q.m).toBeLessThan(sc.mats.length);
        for (const s of sc.spheres) expect(s.m).toBeLessThan(sc.mats.length);
      }
    }
  });
  it('空では天井がなくなり、点と空は材質を持たない', () => {
    const roof = (k: (typeof kinds)[number]) =>
      makeScene('spheres', { kind: k, size: 0.5, power: 1, kelvin: 4000 }).quads.some((q) => q.p[1] === 2);
    expect(roof('sky')).toBe(false);
    expect(roof('point')).toBe(true);
    expect(makeScene('spheres', { kind: 'sky', size: 0.5, power: 1, kelvin: 4000 }).light.m).toBe(-1);
    expect(makeScene('spheres', { kind: 'point', size: 0.5, power: 1, kelvin: 4000 }).light.m).toBe(-1);
  });
  it('四角の光の総量は大きさに依らない', () => {
    const e = (s: number) => {
      const L = makeScene('spheres', { kind: 'rect', size: s, power: 1, kelvin: 6500 }).light;
      return L.e[1] * L.a;
    };
    expect(e(0.2)).toBeCloseTo(e(1), 8);
  });
  it('カメラを回しても注視点からの距離は同じ', () => {
    const c = makeScene('spheres').cam,
      o = orbit(c, 30, 15),
      r = (x: typeof c) => Math.hypot(x.eye[0] - x.at[0], x.eye[1] - x.at[1], x.eye[2] - x.at[2]);
    expect(r(o)).toBeCloseTo(r(c), 10);
    expect(orbit(c, 0, 0).eye[2]).toBeCloseTo(c.eye[2], 10);
  });
});

import { describe, expect, it } from 'vitest';
import { mapIndex, newMap, pixelSr, simulate, WL_RGB } from '../src/tools/halo/sky';
import {
  crystal,
  family,
  fresnel,
  nIce,
  orient,
  type Population,
  prism,
  Rng,
  sunRay,
  traceRay,
} from '../src/tools/halo/trace';

const D = Math.PI / 180;
/** 頂角 A のくさびの最小偏角 */
const minDev = (n: number, A: number) => (2 * Math.asin(n * Math.sin((A * D) / 2))) / D - A;
const pop = (o: Partial<Population>): Population => ({ orient: 'random', ca: 1, tilt: 0, rot: 0, w: 1, d: 0, ...o });

/** 結晶 1 種類に光線を通し、空の向き（光が来る向き）と光路を集める */
function shoot(p: Population, elev: number, rays: number, nm = 550, seed = 3) {
  const g = new Rng(seed),
    C = crystal(p.ca, p.pyr ?? 0),
    M = new Float64Array(9),
    n = nIce(nm),
    out: { x: number; y: number; z: number; path: number[] }[] = [];
  for (let i = 0; i < rays; i++) {
    orient(p, g, M);
    const [dx, dy, dz] = sunRay(elev, g),
      h = traceRay(C, M, dx, dy, dz, n, g);
    if (h) out.push({ x: -h.x, y: -h.y, z: -h.z, path: h.path });
  }
  return out;
}

describe('氷の光学定数', () => {
  it('屈折率は Warren & Brandt (2008) の表の値', () => {
    expect(nIce(400)).toBeCloseTo(1.3194, 3);
    expect(nIce(550)).toBeCloseTo(1.311, 3);
    expect(nIce(700)).toBeCloseTo(1.3069, 3);
  });
  it('Fresnel: 垂直入射は ((n−1)/(n+1))²、臨界角を超えると全反射', () => {
    const n = 1.31;
    expect(fresnel(1, 1 / n)).toBeCloseTo(((n - 1) / (n + 1)) ** 2, 6);
    expect(fresnel(Math.cos(60 * D), n)).toBe(1);
    expect(fresnel(Math.cos(40 * D), n)).toBeLessThan(1);
  });
});

describe('光路の種類', () => {
  it('反射・60°・90°・中での反射・素通りを分ける', () => {
    expect(family([4])).toBe(0);
    expect(family([3, 5])).toBe(1);
    expect(family([8, 4])).toBe(1);
    expect(family([1, 3])).toBe(2);
    expect(family([6, 2])).toBe(2);
    expect(family([1, 3, 8, 2])).toBe(3);
    expect(family([3, 6])).toBe(4);
    expect(family([1, 2])).toBe(4);
  });
});

describe('重み', () => {
  it('ランダムな向きでは、当たる割合が平均の投影面積 ÷ 円盤の面積（表面積 ÷ 4）になる', () => {
    const p = pop({ ca: 1 }),
      C = prism(1),
      g = new Rng(9),
      M = new Float64Array(9),
      N = 200000;
    let hit = 0;
    for (let i = 0; i < N; i++) {
      orient(p, g, M);
      /* 全反射でない限り必ず出ていくので、当たった数は戻り値の数と同じ（中で 16 回を超える分は小さい） */
      if (traceRay(C, M, 0, 0, -1, 1.31, g)) hit++;
    }
    const expected = C.area / 4 / (Math.PI * C.rb * C.rb);
    expect(Math.abs(hit / N - expected) / expected).toBeLessThan(0.02);
  });
  for (const [ca, pyr] of [
    [0.3, 0.5],
    [1.5, 1],
    [0.1, 0.2],
  ])
    it(`錐面のある結晶（c/a ${ca}、錐 ${pyr}）でも、当たる割合が表面積 ÷ 4 ÷ 円盤の面積（表面積と外接球の検算）`, () => {
      const C = crystal(ca, pyr),
        g = new Rng(5),
        M = new Float64Array(9),
        N = 200000;
      let hit = 0;
      for (let i = 0; i < N; i++) {
        orient(pop({}), g, M);
        if (traceRay(C, M, 0, 0, -1, 1.31, g)) hit++;
      }
      const expected = C.area / 4 / (Math.PI * C.rb * C.rb);
      expect(Math.abs(hit / N - expected) / expected).toBeLessThan(0.025);
    });
  it('板の傾きは球面の上の 2 次元のガウス分布（θ² の平均が 2σ²）', () => {
    const g = new Rng(4),
      M = new Float64Array(9),
      s = 2;
    let m2 = 0;
    const N = 50000;
    for (let i = 0; i < N; i++) {
      orient(pop({ orient: 'plate', tilt: s }), g, M);
      m2 += (Math.acos(M[8]) / D) ** 2;
    }
    expect(m2 / N / (2 * s * s)).toBeCloseTo(1, 1);
  });
  it('全天図は等立体角: 一様な向きを足すと画素ごとの数がそろう', () => {
    const N = 16,
      cnt = new Float64Array(2 * N * N),
      g = new Rng(2),
      K = 400000;
    for (let i = 0; i < K; i++) {
      const z = 2 * g.next() - 1,
        a = 2 * Math.PI * g.next(),
        r = Math.sqrt(1 - z * z);
      cnt[mapIndex(N, r * Math.cos(a), r * Math.sin(a), z)]++;
    }
    /* 円盤の内側の画素だけ（縁は欠ける） */
    const inner: number[] = [];
    for (let v = 0; v < N; v++)
      for (let u = 0; u < N; u++) {
        const x = ((u + 0.5) / N) * 2 - 1,
          y = ((v + 0.5) / N) * 2 - 1;
        if (x * x + y * y < 0.7) inner.push(cnt[v * 2 * N + u], cnt[v * 2 * N + u + N]);
      }
    const mean = inner.reduce((a, b) => a + b, 0) / inner.length,
      expected = (K / (4 * Math.PI)) * pixelSr(N);
    expect(mean / expected).toBeCloseTo(1, 1);
    for (const c of inner) expect(Math.abs(c - expected) / expected).toBeLessThan(0.1);
  });
});

describe('ハロの位置（解析の式と照らす）', () => {
  it('ランダムな向き: 内暈と外暈の内縁が 60°・90° のくさびの最小偏角', () => {
    const e = 30,
      s = [Math.cos(e * D), 0, Math.sin(e * D)],
      hist = new Float64Array(900);
    for (const o of shoot(pop({}), e, 600000)) {
      const a = Math.acos(Math.min(1, o.x * s[0] + o.y * s[1] + o.z * s[2])) / D;
      if (a < 90) hist[Math.floor(a * 10)] += 1 / Math.sin(Math.max(a, 0.05) * D);
    }
    const edge = (lo: number, hi: number) => {
      let best = 0,
        at = 0;
      for (let i = lo; i < hi; i++)
        if (hist[i + 2] - hist[i - 2] > best) {
          best = hist[i + 2] - hist[i - 2];
          at = i / 10;
        }
      return at;
    };
    const n = nIce(550);
    expect(Math.abs(edge(180, 260) - minDev(n, 60))).toBeLessThan(0.3);
    expect(Math.abs(edge(420, 500) - minDev(n, 90))).toBeLessThan(0.4);
  });
  it('錐面のある結晶（ランダム）: 9°・35° の暈の内縁が 28°・80.2° のくさびの最小偏角', () => {
    const e = 30,
      s = [Math.cos(e * D), 0, Math.sin(e * D)],
      hist = new Float64Array(600),
      n = nIce(550);
    for (const o of shoot(pop({ ca: 0.3, pyr: 0.6 }), e, 800000)) {
      if (family(o.path) !== 5 || o.path.length !== 2) continue;
      const a = Math.acos(Math.min(1, o.x * s[0] + o.y * s[1] + o.z * s[2])) / D;
      if (a < 60) hist[Math.floor(a * 10)] += 1 / Math.sin(Math.max(a, 0.05) * D);
    }
    const edge = (lo: number, hi: number) => {
      let best = 0,
        at = 0;
      for (let i = lo; i < hi; i++)
        if (hist[i + 2] - hist[i - 2] > best) {
          best = hist[i + 2] - hist[i - 2];
          at = i / 10;
        }
      return at;
    };
    expect(Math.abs(edge(60, 120) - minDev(n, 28))).toBeLessThan(0.4);
    expect(Math.abs(edge(320, 380) - minDev(n, 80.22))).toBeLessThan(0.5);
  });
  for (const e of [0, 20, 40])
    it(`水平な板: 幻日の内縁は Bravais の実効屈折率で決まる（太陽高度 ${e}°）`, () => {
      const n = nIce(550),
        ne = Math.sqrt(n * n - Math.sin(e * D) ** 2) / Math.cos(e * D),
        dAz = minDev(ne, 60);
      const az = shoot(pop({ orient: 'plate', ca: 0.3 }), e, 300000)
        .filter((o) => o.path.length === 2 && family(o.path) === 1 && Math.abs(Math.asin(o.z) / D - e) < 0.5)
        .map((o) => Math.abs(Math.atan2(o.y, o.x)) / D)
        .sort((a, b) => a - b);
      /* 太陽の円盤（半径 0.265°）のぶんだけ内側へ広がる */
      expect(Math.abs(az[Math.floor(az.length * 0.002)] - dAz)).toBeLessThan(0.45);
    });
  it('水平な板: 環天頂アークの高度と、太陽高度 32.2° を超えると消えること', () => {
    const n = nIce(550),
      e = 20,
      h = Math.asin(Math.sqrt(n * n - Math.cos(e * D) ** 2)) / D;
    const cza = shoot(pop({ orient: 'plate', ca: 0.3 }), e, 200000).filter(
      (o) => o.path.length === 2 && o.path[0] === 1 && family(o.path) === 2 && o.z > 0,
    );
    const alts = cza.map((o) => Math.asin(o.z) / D).sort((a, b) => a - b);
    expect(Math.abs(alts[Math.floor(alts.length / 2)] - h)).toBeLessThan(0.5);
    const high = shoot(pop({ orient: 'plate', ca: 0.3 }), 34, 200000).filter(
      (o) => o.path.length === 2 && o.path[0] === 1 && family(o.path) === 2 && o.z > 0,
    );
    expect(high.length).toBe(0);
  });
});

describe('全天図', () => {
  it('波長の色は一様に平均すると白', () => {
    const n = WL_RGB.length / 3,
      s = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) s[k] += WL_RGB[3 * i + k] / n;
    for (const v of s) expect(v).toBeCloseTo(1, 6);
  });
  it('母集団を混ぜて光線を足せる', () => {
    const m = newMap(32);
    simulate(m, [pop({ orient: 'plate', ca: 0.3, w: 0.5 }), pop({ w: 0.5 })], 20, 20000, 1);
    expect(m.rays).toBe(20000);
    expect(m.hits).toBeGreaterThan(5000);
  });
});

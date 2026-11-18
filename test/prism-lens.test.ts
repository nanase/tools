import { describe, expect, it } from 'vitest';
import { MEAN, spec, weight } from '../src/tools/prism-lens/color';
import {
  buildEdges,
  emit,
  focal,
  fresnel,
  geom,
  hits,
  LAM_D,
  MATS,
  make,
  type Part,
  pentaPts,
  type Ray,
  revive,
  trace,
} from '../src/tools/prism-lens/optics';
import { SCENE_KEYS, SCENES } from '../src/tools/prism-lens/scenes';

const D2R = Math.PI / 180;
/** 乱数の種を固定した一様乱数 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
/** 1 本の光線を部分反射なしで追い、区間を返す */
function path(parts: Part[], x: number, y: number, deg: number, lam: number): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  const r: Ray = { x, y, dx: Math.cos(deg * D2R), dy: Math.sin(deg * D2R), lam, w: [1, 1, 1], I: 1, depth: 0 };
  trace([r], buildEdges(parts), { partial: false, rand: () => 0.5, seg: (q, x1, y1) => segs.push([q.x, q.y, x1, y1]) });
  return segs;
}
const dirOf = (s: [number, number, number, number]) => Math.atan2(s[3] - s[1], s[2] - s[0]) / D2R;

describe('材質の屈折率（d 線 587.6 nm）', () => {
  it.each([
    ['bk7', 1.5168],
    ['sf11', 1.7847],
    ['acr', 1.4906],
    ['water', 1.333],
    ['dia', 2.4175],
  ] as const)('%s は %f', (k, nd) => {
    expect(MATS[k].n(LAM_D)).toBeCloseTo(nd, 3);
  });
  it('どの材質も短い波長ほど屈折率が大きい', () => {
    for (const m of Object.values(MATS)) expect(m.n(400)).toBeGreaterThan(m.n(700));
  });
});

describe('屈折と反射', () => {
  it('ガラス板に斜めに入るとスネルの法則で曲がり、出ると元の向きに戻る', () => {
    const plate = make('plate', 0, 0, 0, { w: 400, h: 100, mat: 'bk7' });
    const s = path([plate], -100, -200, 60, 589.3);
    const n = MATS.bk7.n(589.3);
    /* 入射角は面の法線（縦）から 30°、屈折角は sin⁻¹(sin30°/n) */
    const inside = 90 - dirOf(s[1]);
    expect(Math.sin(inside * D2R)).toBeCloseTo(Math.sin(30 * D2R) / n, 6);
    expect(dirOf(s[2])).toBeCloseTo(60, 6);
  });
  it('臨界角を超えると全反射する（ガラス板の中を進む）', () => {
    const plate = make('plate', 0, 0, 0, { w: 2000, h: 60, mat: 'acr' });
    const s = path([plate], -1100, -10, 20, 635);
    /* 端面から入り、上下の面で何度も跳ね返ってから出る */
    expect(s.length).toBeGreaterThan(6);
    for (let i = 1; i < s.length - 1; i++) {
      expect(Math.abs(s[i][1])).toBeLessThanOrEqual(30 + 1e-6);
      expect(Math.abs(s[i][3])).toBeLessThanOrEqual(30 + 1e-6);
    }
  });
  it('フレネルの式: 垂直入射の反射率は ((n−1)/(n+1))²、全体の和は 1 以下', () => {
    const n = 1.5;
    expect(fresnel(1, n, 1, 1)).toBeCloseTo(((n - 1) / (n + 1)) ** 2, 10);
    for (let a = 0; a < 89; a += 7) {
      const ci = Math.cos(a * D2R),
        ct = Math.sqrt(1 - (Math.sin(a * D2R) / n) ** 2),
        R = fresnel(1, n, ci, ct);
      expect(R).toBeGreaterThanOrEqual(0);
      expect(R).toBeLessThanOrEqual(1);
    }
  });
  it('平面鏡は入射角と同じ角で反射する', () => {
    const m = make('mirror', 0, 0, 0, { L: 400 });
    const s = path([m], -200, -100, 20, 532);
    expect(dirOf(s[1])).toBeCloseTo(160, 6);
  });
});

describe('プリズム', () => {
  it('頂角 60° の最小偏角が 2 sin⁻¹(n sin30°) − 60° に一致する', () => {
    const p = make('prism', 0, 0, 0, { apex: 60, size: 300, mat: 'bk7' });
    const lam = 589.3,
      n = MATS.bk7.n(lam),
      dmin = (2 * Math.asin(n * Math.sin(30 * D2R))) / D2R - 60;
    /* 左の面に入射角 i で当てる。最小偏角のとき i は (dmin + 60)/2 */
    const i = (dmin + 60) / 2,
      dir = 30 - i;
    const g = geom(p).P,
      fx = (g[0][0] + g[2][0]) / 2,
      fy = (g[0][1] + g[2][1]) / 2;
    const s = path([p], fx - Math.cos(dir * D2R) * 300, fy - Math.sin(dir * D2R) * 300, dir, lam);
    expect(s).toHaveLength(3);
    expect(dirOf(s[2]) - dir).toBeCloseTo(dmin, 4);
  });
  it('紫は赤より大きく曲がる', () => {
    const p = make('prism', 0, 0, 0, { mat: 'sf11' });
    const [a, b] = [700, 400].map((l) =>
      dirOf(path([p], -334, 139, -33, l).at(-1) as [number, number, number, number]),
    );
    expect(b).toBeGreaterThan(a);
  });
});

describe('ペンタプリズムと半円形レンズ', () => {
  it.each([0, 4, -4])('ペンタプリズムは傾き %f° でも光を 90° 曲げる', (th) => {
    const p = make('penta', 0, 0, th, { size: 300, mat: 'bk7' });
    const [v0, v1] = pentaPts(300),
      mid = [(v0[0] + v1[0]) / 2, (v0[1] + v1[1]) / 2],
      c = Math.cos(th * D2R),
      sn = Math.sin(th * D2R),
      wx = c * mid[0] - sn * mid[1],
      wy = sn * mid[0] + c * mid[1];
    /* 入る面の中ほどへ、傾ける前の面に垂直な向き（90°）で当てる */
    const s = path([p], wx, wy - 400, 90, 550);
    expect(s).toHaveLength(5);
    const d = dirOf(s[4]);
    expect(Math.cos((d - 180) * D2R)).toBeCloseTo(1, 9);
  });
  it('半円形レンズ: 弧から中心へ向かう光は平らな面でだけ曲がる', () => {
    const L = make('semi', 0, 0, 0, { r: 200, mat: 'bk7' }),
      n = MATS.bk7.n(589.3),
      phi = 20;
    const s = path([L], 400 * Math.cos(phi * D2R), 400 * Math.sin(phi * D2R), phi + 180, 589.3);
    /* 弧では曲がらない */
    expect(Math.cos((dirOf(s[1]) - (phi + 180)) * D2R)).toBeCloseTo(1, 6);
    const out = dirOf(s.at(-1) as [number, number, number, number]),
      tt = Math.asin(n * Math.sin(phi * D2R)) / D2R;
    expect(Math.cos((out - (180 + tt)) * D2R)).toBeCloseTo(1, 6);
  });
  it('半円形レンズ: 臨界角を超えると平らな面で全反射して戻る', () => {
    const L = make('semi', 0, 0, 0, { r: 200, mat: 'bk7' }),
      phi = 60;
    const s = path([L], 400 * Math.cos(phi * D2R), 400 * Math.sin(phi * D2R), phi + 180, 589.3);
    const out = dirOf(s.at(-1) as [number, number, number, number]);
    expect(Math.cos(out * D2R)).toBeGreaterThan(0);
  });
});

describe('レンズと鏡', () => {
  it('凸レンズは平行光をおよそ焦点距離の位置に集める', () => {
    const L = make('convex', 0, 0, 0, { R: 400, D: 80, mat: 'bk7' });
    const f = focal(L);
    const s = path([L], -300, 8, 0, LAM_D);
    const last = s.at(-1) as [number, number, number, number],
      t = -last[1] / (last[3] - last[1]),
      xc = last[0] + (last[2] - last[0]) * t;
    expect(xc / f).toBeGreaterThan(0.95);
    expect(xc / f).toBeLessThan(1.05);
  });
  it('凹レンズの焦点距離は負、凹面鏡は R/2', () => {
    expect(focal(make('concave', 0, 0, 0))).toBeLessThan(0);
    expect(focal(make('cmirror', 0, 0, 0, { R: 300 }))).toBe(150);
  });
  it('凹面鏡は軸に近い平行光を R/2 に集める', () => {
    const m = make('cmirror', 0, 0, 0, { R: 600, D: 100 });
    const s = path([m], -500, 10, 0, 532);
    const last = s.at(-1) as [number, number, number, number],
      t = -last[1] / (last[3] - last[1]),
      xc = last[0] + (last[2] - last[0]) * t;
    expect(xc).toBeCloseTo(-300, -1);
  });
});

describe('光源と色', () => {
  it('白色光の重みは平均すると各成分 1', () => {
    const r = rng(7),
      m = [0, 0, 0],
      N = 40000;
    for (let i = 0; i < N; i++) {
      const w = weight(400 + r() * 300, true);
      for (let k = 0; k < 3; k++) m[k] += w[k] / N;
    }
    for (const v of m) expect(v).toBeCloseTo(1, 1);
    expect(MEAN.every((v) => v > 0)).toBe(true);
  });
  it('赤い波長は赤、青い波長は青が強い', () => {
    const r = spec(650),
      b = spec(450);
    expect(r[0]).toBeGreaterThan(r[2]);
    expect(b[2]).toBeGreaterThan(b[0]);
  });
  it('平行光は幅の中から光の向きに出る', () => {
    const o = make('beam', 0, 0, 90, { w: 40 });
    const rays = emit(o, 200, 1, rng(3), weight);
    for (const q of rays) {
      expect(q.dx).toBeCloseTo(0, 10);
      expect(q.dy).toBeCloseTo(1, 10);
      expect(Math.abs(q.x)).toBeLessThanOrEqual(20 + 1e-9);
    }
  });
});

describe('部品と場面', () => {
  it('部品の内側を押すと当たる', () => {
    const p = make('prism', 100, 50, 30);
    expect(hits(p, 100, 50, 10)).toBe(true);
    expect(hits(p, 400, 50, 10)).toBe(false);
  });
  it('保存した部品を読み直せる（壊れた値は既定値）', () => {
    const o = revive({ t: 'convex', x: 10, y: 20, ang: 30, R: 300, mat: 'xx' as never });
    expect(o).not.toBeNull();
    expect(o?.R).toBe(300);
    expect(o?.mat).toBe('bk7');
    expect(revive({ t: 'nope' as never })).toBeNull();
  });
  it.each(SCENE_KEYS)('場面 %s の光は図の中の部品に当たる', (k) => {
    const parts = SCENES[k].make(),
      E = buildEdges(parts);
    let hit = 0;
    const rays: Ray[] = [];
    for (const o of parts) if (['beam', 'laser', 'lamp'].includes(o.t)) rays.push(...emit(o, 200, 1, rng(5), weight));
    const n0 = rays.length;
    trace(rays, E, {
      partial: true,
      rand: rng(9),
      seg: (r) => {
        if (r.depth > 0) hit++;
      },
    });
    /* 光線はどれも少なくとも 1 回は部品で曲がるか跳ね返る */
    expect(hit).toBeGreaterThanOrEqual(n0);
  });
});

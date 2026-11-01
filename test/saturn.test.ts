import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calToJd, jdOfDate } from '../src/lib/astro/time';
import { unit, type Vec3 } from '../src/lib/astro/vec';
import { Ephem, graphic, planetState, slowAt } from '../src/lib/planet/ephem';
import { findPhen } from '../src/lib/planet/events';
import { type MoonTable, tablePos } from '../src/lib/planet/moons';
import { logR, orbitSat, tiltChart } from '../src/tools/saturn/figs';
import { GM_SAT, INNER, innerPos, SATURN_MODEL as M, MOONS, moonMag, ringTilt } from '../src/tools/saturn/model';
import { PHOEBE } from '../src/tools/saturn/phoebe';
import { R0, R1, RING_N, ringLight, ringSurge, ringTau } from '../src/tools/saturn/rings';
import { crossings, findPasses, type TiltPoint, tiltAt, widest } from '../src/tools/saturn/season';

const D = Math.PI / 180;
const radec = (v: Vec3): [number, number] => {
  const u = unit(v);
  return [(Math.atan2(u[1], u[0]) / D + 360) % 360, Math.asin(u[2]) / D];
};
const TOKYO = { lat: 35.6895, lon: 139.6917, h: 0 };

/**
 * JPL Horizons（2026-11-01 取得）の地心の値: 日時（UT）、見かけの赤経・赤緯 [°]、等級、視直径 [″]、
 * 地球直下点の System III の経度・惑星図緯度 [°]、太陽直下点の惑星図緯度 [°]、北極の位置角 [°]、位相角 [°]
 */
// biome-ignore format: 表
const HZ: [string, number, number, number, number, number, number, number, number, number][] = [
  ['2015-02-06T12:00Z', 242.241301666, -18.951517044, 0.506, 16.30116, 27.751738, 29.716913, 28.649261, 2.5196, 5.4476],
  ['2020-07-14T08:00Z', 301.320559387, -20.548185609, 0.175, 18.46281, 63.626115, 25.883998, 26.111117, 6.7519, 0.6942],
  ['2025-09-21T06:00Z', 359.630734988, -2.895574656, 0.583, 19.44529, 276.782643, -2.236218, -2.523313, 4.2576, 0.2639],
  ['2026-12-04T10:00Z', 8.33505926, 0.797255748, 0.624, 18.57752, 300.131721, -7.468273, -10.530674, 3.5159, 5.4097],
  ['2032-05-12T04:00Z', 81.356036683, 22.101069578, 0.095, 16.82196, 334.712042, -31.985223, -31.750192, 355.5095, 3.215],
  ['2045-05-05T05:00Z', 248.888810151, -20.018371843, 0.15, 18.31298, 99.457686, 30.510812, 30.436431, 3.0718, 2.4637],
];

/** 同じ Horizons の 8 衛星の土星からの離れ X・Y [″]（ミマス〜イアペトゥス） */
// biome-ignore format: 表
const XY: [string, number[]][] = [
  ['2020-07-14T08:00Z', [-22.171, 7.871, 9.782, -14.031, -41.474, 9.928, 57.541, -5.903, -69.763, 21.61, -128.34, 61.946, -230.524, 38.485, 487.437, -57.627]],
  ['2026-12-04T10:00Z', [23.266, -0.341, -35.311, 3.211, 8.327, -4.629, -40.357, -2.002, 73.003, -1.091, 96.279, -22.178, 232.002, -4.471, -167.686, 62.801]],
  ['2032-05-12T04:00Z', [25.103, -0.379, -32.592, 0.278, -39.657, 2.955, 51.442, -1.724, -67.607, 8.72, 97.456, 70.603, 59.996, 96.274, 362.611, 158.921]],
  ['2045-05-05T05:00Z', [-15.284, -9.485, 32.223, -8.597, -35.682, -9.488, 3.938, 24.558, -76.966, -5.699, 178.009, -20.613, -195.816, 45.616, -481.566, 61.239]],
];

const wrap180 = (v: number) => ((v + 540) % 360) - 180;

describe('土星の位置と物理暦', () => {
  it('JPL Horizons と、位置 1″・中央子午線 0.2°・北極の位置角 0.01°・等級 0.002 等以内で合う', () => {
    for (const [ts, ra, dec, mag, diam, cm3, lat, slat, np, ph] of HZ) {
      const st = planetState(M, jdOfDate(new Date(ts)), null);
      const [a, d] = radec(st.P);
      expect(Math.abs((a - ra) * Math.cos(d * D) * 3600), ts).toBeLessThan(1);
      expect(Math.abs((d - dec) * 3600), ts).toBeLessThan(1);
      expect(Math.abs(st.mag - mag), ts).toBeLessThan(0.002);
      expect(Math.abs(st.diam - diam)).toBeLessThan(0.01);
      expect(Math.abs(wrap180(st.subObs.lonW - cm3)), ts).toBeLessThan(0.2);
      expect(Math.abs(graphic(M, st.subObs.lat) - lat)).toBeLessThan(0.01);
      expect(Math.abs(graphic(M, st.subSun.lat) - slat)).toBeLessThan(0.01);
      expect(Math.abs(wrap180(st.paAxis - np))).toBeLessThan(0.01);
      expect(Math.abs(st.phase - ph)).toBeLessThan(0.01);
    }
  });

  it('東京から見た高度と方位は Horizons と 0.02° 以内で合う（2026-12-04 19:00 JST）', () => {
    const st = planetState(M, jdOfDate(new Date('2026-12-04T10:00Z')), TOKYO);
    expect(Math.abs(st.alt - 54.747461)).toBeLessThan(0.02);
    expect(Math.abs(st.az - 170.607097)).toBeLessThan(0.02);
  });

  it('環の傾きは案 D の題材と PDS の表に合う', () => {
    const t = ringTilt(slowAt(M, jdOfDate(new Date('2026-12-04T10:00Z'))));
    expect(t.b).toBeCloseTo(-6.09, 1);
    expect(t.bs).toBeCloseTo(-8.6, 1);
    /* R. Victor の表（PDS の Saturn Ephemeris Generator）の 2032-05-12 04 時の値 */
    const w = ringTilt(slowAt(M, jdOfDate(new Date('2032-05-12T04:00Z'))));
    expect(w.b).toBeCloseTo(-26.94, 1);
    expect(w.bs).toBeCloseTo(-26.73, 1);
  });
});

describe('衛星', () => {
  it('8 衛星の土星からの離れは Horizons と、内側の 6 個で 0.3″、ヒペリオンで 3.5″、イアペトゥスで 1″ 以内で合う', () => {
    const lim = [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 3.5, 1];
    for (const [ts, xy] of XY) {
      const st = planetState(M, jdOfDate(new Date(ts)), null);
      const [ra, de] = radec(st.P);
      st.geo.moons.forEach((m, k) => {
        const [rs, ds] = radec([st.P[0] + m[0], st.P[1] + m[1], st.P[2] + m[2]]);
        const e = Math.hypot((rs - ra) * Math.cos(de * D) * 3600 - xy[2 * k], (ds - de) * 3600 - xy[2 * k + 1]);
        expect(e, `${ts} ${MOONS[k].name}`).toBeLessThan(lim[k]);
      });
    }
  });

  it('衛星の等級は Horizons の APmag に 0.02 等以内で合う（土星の衛星に位相の項はない）', () => {
    /* 2026-12-04 10:00 UT: 衛星ごとの r・Δ と APmag */
    // biome-ignore format: 表
    const REF: [number, number, number][] = [
      [9.414474, 8.945271, 12.927], [9.41456, 8.94557, 11.727], [9.41705, 8.947921, 10.228], [9.416767, 8.947815, 10.428],
      [9.413833, 8.944442, 9.727], [9.422173, 8.952769, 8.351], [9.413444, 8.943463, 14.256], [9.391483, 8.922784, 11.116],
    ];
    REF.forEach(([r, d, mag], k) => {
      expect(Math.abs(moonMag(k, r, d) - mag), MOONS[k].name).toBeLessThan(0.02);
    });
  });

  it('環のすぐ外の 15 個は PDS Saturn Viewer の空の位置に近い（2026-12-04 10:00 UT）', () => {
    /* Saturn Viewer の dRA・dDec [″] */
    // biome-ignore format: 表
    const REF: [string, number, number][] = [
      ['ヤヌス', 1.2618, -2.496], ['エピメテウス', 22.7722, -1.6358], ['ヘレネ', 24.3394, -7.1562], ['テレスト', 42.3522, -4.9051],
      ['カリプソ', -32.7015, -0.9135], ['アトラス', 12.4312, -2.5737],
    ];
    const st = planetState(M, jdOfDate(new Date('2026-12-04T10:00Z')), null);
    const g = st.geo;
    const [ra, de] = radec(st.P);
    for (const [name, x, y] of REF) {
      const k = INNER.findIndex((m) => m[0] === name);
      const v = innerPos(k, g.jdTT - g.lt);
      const m: Vec3 = [
        g.M[0] * v[0] + g.M[1] * v[1] + g.M[2] * v[2],
        g.M[3] * v[0] + g.M[4] * v[1] + g.M[5] * v[2],
        g.M[6] * v[0] + g.M[7] * v[1] + g.M[8] * v[2],
      ];
      const [rs, ds] = radec([st.P[0] + m[0], st.P[1] + m[1], st.P[2] + m[2]]);
      const e = Math.hypot((rs - ra) * Math.cos(de * D) * 3600 - x, (ds - de) * 3600 - y);
      /* 土星の距離で 5″ は 3.2 万 km */
      expect(e, name).toBeLessThan(5);
    }
  });

  const tab = JSON.parse(readFileSync(new URL('../public/saturn/moons.json', import.meta.url), 'utf8')) as MoonTable;

  it('すべての衛星は 8 衛星と環のすぐ外の 15 個を合わせて 292 個ある', () => {
    expect(tab.moons.length + MOONS.length + INNER.length).toBe(292);
    expect(new Set(tab.moons.map((m) => m.n)).size).toBe(tab.moons.length);
    expect(tab.moons.every((m) => m.s.length % 6 === 0 && m.s.length <= 6 * tab.n)).toBe(true);
  });

  it('表の範囲の外は出さない', () => {
    expect(tablePos(tab, 0, tab.t0 - 1, GM_SAT)).toBeNull();
    expect(tablePos(tab, 0, tab.t0 + tab.dt * (tab.n - 1) + 1, GM_SAT)).toBeNull();
    expect(tablePos(tab, 0, tab.t0 + tab.dt * 3.5, GM_SAT)).not.toBeNull();
  });

  it('フェーベの長い表は土星から 1100〜1500 万 km の所にある', () => {
    const table: MoonTable = {
      t0: PHOEBE.t0,
      dt: PHOEBE.dt,
      n: PHOEBE.n,
      groups: [],
      moons: [{ n: '', g: 0, d: 0, s: PHOEBE.s.map((v, i) => (i % 6 < 3 ? v * 10 : v / 10)) }],
    };
    for (const y of [1901, 1950, 2000, 2026, 2099]) {
      const p = tablePos(table, 0, calToJd(y, 7, 1), GM_SAT);
      expect(p).not.toBeNull();
      if (p) {
        const r = Math.hypot(...p);
        expect(r).toBeGreaterThan(10.5e6);
        expect(r).toBeLessThan(15.5e6);
      }
    }
  });
});

describe('現象', () => {
  const e = new Ephem(M);
  const hm = (d: number, h: number, mi: number) => calToJd(2026, 12, d) + (h + mi / 60) / 24;

  it('2026-12-04 の案 D の題材（UT）: テティスの食、ミマスの通過と影が 4 分以内で合う', () => {
    const ph = findPhen(e, calToJd(2026, 12, 4), calToJd(2026, 12, 5));
    const near = (k: number, kind: string, a: number, b: number) => {
      const p = ph.find((x) => x.k === k && x.kind === kind && Math.abs(x.t0 - a) < 0.1);
      expect(p, `${k} ${kind}`).toBeDefined();
      if (!p) return;
      expect(Math.abs(p.t0 - a) * 1440).toBeLessThan(4);
      expect(Math.abs(p.t1 - b) * 1440).toBeLessThan(5);
    };
    near(2, 'EC', hm(4, 8, 13), hm(4, 10, 18));
    near(0, 'TR', hm(4, 12, 23), hm(4, 14, 38));
    near(0, 'SH', hm(4, 12, 48), hm(4, 14, 53));
  });

  it('Horizons の印の通過の始めと終わりに 4 分以内で合う（2026-12）', () => {
    const ph = findPhen(e, calToJd(2026, 12, 1), calToJd(2026, 12, 6));
    /* 衛星, 日, 時, 分, 日, 時, 分 */
    // biome-ignore format: 表
    const REF: number[][] = [
      [0, 1, 16, 28, 1, 18, 46], [0, 4, 12, 19, 4, 14, 37], [1, 4, 1, 55, 4, 4, 22], [2, 3, 8, 37, 3, 11, 19], [2, 5, 5, 56, 5, 8, 37],
    ];
    for (const [k, d0, h0, m0, d1, h1, m1] of REF) {
      const a = hm(d0, h0, m0),
        b = hm(d1, h1, m1);
      const p = ph.find((x) => x.k === k && x.kind === 'TR' && Math.abs(x.t0 - a) < 0.1);
      expect(p).toBeDefined();
      if (!p) continue;
      expect(Math.abs(p.t0 - a) * 1440).toBeLessThan(4);
      expect(Math.abs(p.t1 - b) * 1440).toBeLessThan(4);
    }
  });

  it('タイタンの影の季節は 2024-11〜2025-10 で、観測の記録の日に影が土星の上にある', () => {
    const ps = findPasses(e, 5, calToJd(2024, 9, 1), calToJd(2026, 2, 1));
    const sh = ps.filter((p) => p.kind === 'SH');
    expect(sh[0].t0).toBeGreaterThan(calToJd(2024, 11, 1));
    expect(sh[sh.length - 1].t1).toBeLessThan(calToJd(2025, 10, 7));
    /* BAA の 2025 年の記録: 5/15 9:34〜15:42 UT の影。7/18・9/4 の観測、10/6 は影が北の縁にかかる */
    const may = sh.find((p) => p.t0 < calToJd(2025, 5, 15.6) && p.t1 > calToJd(2025, 5, 15.6));
    expect(may).toBeDefined();
    if (may) {
      expect(Math.abs(may.t0 - (calToJd(2025, 5, 15) + (9 + 34 / 60) / 24)) * 1440).toBeLessThan(10);
      expect(Math.abs(may.t1 - (calToJd(2025, 5, 15) + (15 + 42 / 60) / 24)) * 1440).toBeLessThan(10);
    }
    for (const t of [calToJd(2025, 7, 18) + 9 / 24, calToJd(2025, 9, 4) + 6.5 / 24, calToJd(2025, 10, 6) + 5.1 / 24])
      expect(sh.some((p) => p.t0 < t && p.t1 > t)).toBe(true);
    /* 10/21 はタイタンの通過だけ */
    const tr = ps.filter((p) => p.kind === 'TR');
    expect(tr.some((p) => Math.abs(p.t0 - calToJd(2025, 10, 22)) < 0.1)).toBe(true);
  });
});

describe('環の傾きの季節', () => {
  const pts: TiltPoint[] = [];
  for (let t = calToJd(2020, 1, 1); t < calToJd(2041, 1, 1); t += 15) pts.push(tiltAt(t));
  const cross = crossings(pts);

  it('環の面の通過は PDS の表と 4 時間以内で合う', () => {
    const REF: ['earth' | 'sun', number][] = [
      ['earth', calToJd(2025, 3, 23) + 17 / 24],
      ['sun', calToJd(2025, 5, 6) + 13 / 24],
      ['earth', calToJd(2038, 10, 15) + 15 / 24],
      ['sun', calToJd(2039, 1, 22) + 18 / 24],
      ['earth', calToJd(2039, 4, 1) + 20 / 24],
    ];
    for (const [who, t] of REF) {
      const c = cross.find((x) => x.who === who && Math.abs(x.t - t) < 2);
      expect(c, `${who} ${t}`).toBeDefined();
      if (c) expect(Math.abs(c.t - t) * 24).toBeLessThan(4);
    }
    expect(cross.some((c) => c.who === 'earth' && Math.abs(c.t - calToJd(2039, 7, 9)) < 1)).toBe(true);
  });

  it('環が最も開くのは 2032-05-12 で −26.9° になる', () => {
    const w = widest(pts, cross);
    const top = w.find((p) => p[0] > calToJd(2026, 1, 1));
    expect(top).toBeDefined();
    if (top) {
      expect(Math.abs(top[0] - calToJd(2032, 5, 12))).toBeLessThan(3);
      expect(top[1]).toBeCloseTo(-26.94, 1);
    }
  });
});

describe('環の表と明るさ', () => {
  const tab = new Uint8Array(readFileSync(new URL('../public/saturn/rings.bin', import.meta.url)));

  it('表の大きさと区分の透け具合', () => {
    expect(tab.length).toBe(RING_N * 4);
    /* PDS の表の光学的厚さの範囲: C 環 0.05〜0.35、B 環の中央 1 以上、カッシーニの間隙 0.2 以下、A 環 0.4〜1、エンケの間隙ほぼ 0 */
    expect(ringTau(tab, 80000)).toBeGreaterThan(0.03);
    expect(ringTau(tab, 80000)).toBeLessThan(0.4);
    expect(ringTau(tab, 105000)).toBeGreaterThan(1);
    expect(ringTau(tab, 119500)).toBeLessThan(0.3);
    expect(ringTau(tab, 125000)).toBeGreaterThan(0.3);
    expect(ringTau(tab, 125000)).toBeLessThan(1.2);
    expect(ringTau(tab, 133600)).toBeLessThan(0.1);
    expect(ringTau(tab, R0 - 1)).toBe(0);
    expect(ringTau(tab, R1 + 1)).toBe(0);
  });

  it('表から見ると厚い環が明るく、裏から見ると薄い環が明るい', () => {
    const lit = (t: number) => ringLight(t, 0.3, 0.3, true, 6);
    const back = (t: number) => ringLight(t, 0.3, 0.2, false, 6);
    expect(lit(2)).toBeGreaterThan(lit(0.1));
    expect(back(0.3)).toBeGreaterThan(back(4));
    /* 太陽が環の面に近いと暗い */
    expect(ringLight(1, 0.3, 0.02, true, 6)).toBeLessThan(lit(1) / 2);
  });

  it('衝の前後に増光する', () => {
    expect(ringSurge(0)).toBeGreaterThan(1.6);
    expect(ringSurge(6)).toBeCloseTo(1, 1);
    expect(ringSurge(0.2)).toBeLessThan(ringSurge(0));
  });
});

describe('図', () => {
  it('軌道の半径は対数で、土星とフェーベの軌道が図に収まる', () => {
    expect(logR(1)).toBe(10);
    expect(logR(215)).toBeCloseTo(116, 6);
    expect(logR(3) < logR(20)).toBe(true);
  });

  it('数値が壊れない', () => {
    const out = [
      orbitSat({
        moons: [
          [3, 1],
          [0, 4],
          [20, -2],
          [-200, 40],
        ],
        names: ['a', '', 'c', 'd'],
        orbits: [3.1, 4, 20, 214],
        dashed: [3],
        sun: [0.2, 0.98],
        ring: [1.23, 2.27],
      }),
      tiltChart({
        y0: 1900,
        y1: 2100,
        pts: [
          [1900, 10, 9],
          [2000, -20, -21],
          [2100, 0, 1],
        ],
        every: 50,
        marks: [1950],
      }),
    ].join('');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });
});

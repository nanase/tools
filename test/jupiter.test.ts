import { describe, expect, it } from 'vitest';
import { calToJd, jdOfDate } from '../src/lib/astro/time';
import { unit, type Vec3 } from '../src/lib/astro/vec';
import { cmFromNodeOfDate, Ephem, graphic, planetState } from '../src/lib/planet/ephem';
import { findMutual, findPhen, overlap, skyOffset } from '../src/lib/planet/events';
import { lightCurve, nightBand, orbitTop, season, wiggle } from '../src/lib/planet/figs';
import { grsL2, MAPS, nearestMap } from '../src/tools/jupiter/grs';
import { JUPITER_MODEL as M, MOONS, moonMag, w2 } from '../src/tools/jupiter/model';

const D = Math.PI / 180;
const radec = (v: Vec3): [number, number] => {
  const u = unit(v);
  return [(Math.atan2(u[1], u[0]) / D + 360) % 360, Math.asin(u[2]) / D];
};
const TOKYO = { lat: 35.6895, lon: 139.6917, h: 0 };

/**
 * JPL Horizons（2026-11-01 取得、jup365_merged）の地心の値: 日時（UT）、見かけの赤経・赤緯 [°]、等級、視直径 [″]、
 * 地球直下点の System III の経度・惑星図緯度 [°]、北極の位置角 [°]、位相角 [°]、
 * イオ〜カリストの木星からの離れ X・Y [″] と等級
 */
// biome-ignore format: 表
const HZ: [string, number, number, number, number, number, number, number, number, number[], number[]][] = [
  ['2015-02-06T12:00Z', 140.417088976, 16.45024863, -2.57, 45.36038, 350.619396, -0.216692, 19.9299, 0.1883,
    [-6.368, 1.776, 193.746, -71.388, 123.745, -45.228, 545.702, -195.022], [5.156, 5.422, 4.747, 5.787]],
  ['2020-07-14T08:00Z', 294.182896131, -21.908799826, -2.749, 47.62545, 65.916674, -1.442278, 349.0762, 0.065,
    [12.708, 5.682, -210.37, -40.764, 123.368, 15.544, -595.816, -116.202], [4.967, 5.237, 4.565, 5.605]],
  ['2026-12-04T19:40Z', 149.416765763, 13.309418241, -2.218, 39.62956, 261.470148, -0.437657, 22.202, 10.2605,
    [35.044, -13.566, 15.969, -3.57, -274.218, 112.455, 234.96, -98.787], [5.801, 5.891, 5.289, 6.587]],
  ['2027-02-11T15:00Z', 144.679993747, 15.186155844, -2.556, 45.20369, 47.234528, -0.495134, 21.0708, 0.2297,
    [97.698, -37.05, -138.965, 50.818, 209.276, -79.471, 546.157, -209.31], [5.168, 5.439, 4.752, 5.808]],
  ['2031-09-01T00:00Z', 258.633441397, -22.772718228, -2.245, 39.71145, 243.935816, -2.773309, 4.0624, 10.863,
    [-105.393, 9.555, -162.462, 14.902, 158.159, 0.155, -3.447, 19.867], [5.782, 5.861, 5.26, 6.546]],
  ['2045-05-05T05:00Z', 339.569817504, -9.555418127, -2.185, 36.97888, 232.983547, 0.967334, 335.8948, 10.6732,
    [-7.547, -1.561, 80.183, 38.52, 173.289, 74.028, -249.415, -116.936], [5.843, 5.927, 5.319, 6.606]],
];

describe('木星の位置と物理暦', () => {
  it('JPL Horizons と、位置 1.2″・中央子午線 0.25°・北極の位置角 0.01°・等級 0.01 等以内で合う', () => {
    for (const [ts, ra, dec, mag, diam, cm3, lat, np, ph] of HZ) {
      const st = planetState(M, jdOfDate(new Date(ts)), null);
      const [a, d] = radec(st.P);
      expect(Math.abs((a - ra) * Math.cos(d * D) * 3600), ts).toBeLessThan(1.2);
      expect(Math.abs((d - dec) * 3600), ts).toBeLessThan(1.2);
      expect(st.mag).toBeCloseTo(mag, 2);
      expect(Math.abs(st.diam - diam)).toBeLessThan(0.01);
      expect(Math.abs(((st.subObs.lonW - cm3 + 540) % 360) - 180), ts).toBeLessThan(0.25);
      expect(Math.abs(graphic(M, st.subObs.lat) - lat)).toBeLessThan(0.01);
      expect(Math.abs(st.paAxis - np)).toBeLessThan(0.01);
      expect(Math.abs(st.phase - ph)).toBeLessThan(0.01);
    }
  });

  it('ガリレオ衛星の木星からの離れは Horizons と 0.25″ 以内、等級は 0.02 等以内で合う', () => {
    for (const [ts, , , , , , , , ph, xy, mags] of HZ) {
      const st = planetState(M, jdOfDate(new Date(ts)), null);
      const [ra, de] = radec(st.P);
      for (let k = 0; k < 4; k++) {
        const m = st.geo.moons[k];
        const [rs, ds] = radec([st.P[0] + m[0], st.P[1] + m[1], st.P[2] + m[2]]);
        expect(Math.abs((rs - ra) * Math.cos(de * D) * 3600 - xy[2 * k]), `${ts} ${k}`).toBeLessThan(0.25);
        expect(Math.abs((ds - de) * 3600 - xy[2 * k + 1]), `${ts} ${k}`).toBeLessThan(0.25);
        expect(Math.abs(moonMag(k, st.geo.r, st.delta, ph) - mags[k]), `${ts} ${k}`).toBeLessThan(0.02);
      }
    }
  });

  it('東京から見た高度と方位は Horizons と 0.02° 以内で合う（2026-12-05 4:40 JST）', () => {
    const st = planetState(M, jdOfDate(new Date('2026-12-04T19:40Z')), TOKYO);
    expect(Math.abs(st.alt - 67.598157)).toBeLessThan(0.02);
    expect(Math.abs(st.az - 177.211653)).toBeLessThan(0.02);
  });

  it('System II の中央子午線は IMCCE の JGRS と 1° 以内で合う', () => {
    /* JGRS の「Sub-observer point longitude」（2026-11-01 取得） */
    for (const [ts, ref] of [
      ['2015-02-06T12:00Z', 81.781],
      ['2026-12-04T19:40Z', 283.545],
      ['2045-05-05T05:00Z', 265.74],
    ] as const) {
      const st = planetState(M, jdOfDate(new Date(ts)), null);
      const g = st.geo;
      const toObs = unit([-st.P[0], -st.P[1], -st.P[2]]);
      const cm2 = cmFromNodeOfDate(g, w2(g.jdTT - g.lt - 2451545), toObs);
      expect(Math.abs(((cm2 - ref + 540) % 360) - 180), ts).toBeLessThan(1);
    }
  });
});

describe('衛星の現象', () => {
  const e = new Ephem(M);
  it('IMCCE の 2026 年の予報と 3.5 分以内で合う', () => {
    /* IMCCE の phenjupiter（2026 年、UT）から: 月, 日, 時, 分, 衛星, 種類, 始め（true）か終わり */
    // biome-ignore format: 表
    const REF: [number, number, number, number, number, 'TR' | 'SH' | 'OC' | 'EC', boolean][] = [
      [12, 1, 3, 40, 1, 'SH', true], [12, 1, 6, 10, 1, 'TR', true], [12, 8, 11, 55, 0, 'TR', false],
      [12, 17, 4, 50, 0, 'SH', true], [12, 17, 4, 51, 2, 'SH', false], [12, 24, 12, 52, 2, 'TR', false],
    ];
    const ph = findPhen(e, calToJd(2026, 11, 30), calToJd(2026, 12, 26));
    for (const [mo, d, h, mi, k, kind, start] of REF) {
      const t = calToJd(2026, mo, d) + (h + mi / 60) / 24;
      const best = Math.min(
        ...ph.filter((p) => p.k === k && p.kind === kind).map((p) => Math.abs((start ? p.t0 : p.t1) - t)),
      );
      expect(best * 1440, `${mo}/${d} ${h}:${mi} ${k} ${kind}`).toBeLessThan(3.5);
    }
  });

  it('2026-12-05 4:33〜4:50 JST にイオとエウロパの影が同時に本体の上にある', () => {
    const ph = findPhen(e, calToJd(2026, 12, 4.75), calToJd(2026, 12, 4.85));
    const t = calToJd(2026, 12, 4) + (19 + 40 / 60) / 24;
    const on = ph.filter((p) => p.kind === 'SH' && p.t0 <= t && p.t1 >= t).map((p) => p.k);
    expect(on.sort()).toEqual([0, 1]);
  });

  it('相互食の始まりは BAA（MULTI-SAT）の予報と 6 分以内、掩蔽の減光は 2 ポイント以内で合う', () => {
    const radii = MOONS.map((m) => m.r);
    const flux = MOONS.map((m) => 10 ** (-0.4 * m.v10));
    const ev = findMutual(e, radii, flux, calToJd(2026, 12, 6), calToJd(2026, 12, 25));
    /* BAA Computing Section, 2026-06-06: 日, 時, 分（UT の始まり）, 隠す側, 隠される側, 合計の減光 [等] */
    // biome-ignore format: 表
    const REF: [number, number, number, number, number, number][] = [
      [7, 4, 56, 1, 2, 0.148], [10, 7, 43, 2, 0, 0.04], [12, 23, 14, 1, 2, 0.283], [20, 3, 47, 1, 2, 0.283], [24, 4, 7, 2, 0, 0.026],
    ];
    for (const [d, h, mi, a, b, drop] of REF) {
      const t = calToJd(2026, 12, d) + (h + mi / 60) / 24;
      const m = ev.find((x) => x.kind === 'occ' && x.a === a && x.b === b && Math.abs(x.t0 - t) < 0.1);
      expect(m, `${d} ${h}:${mi}`).toBeDefined();
      if (!m) continue;
      expect(Math.abs(m.t0 - t) * 1440).toBeLessThan(6);
      expect(Math.abs(m.depth - (1 - 10 ** (-0.4 * drop)))).toBeLessThan(0.02);
    }
  });

  it('円の重なりの面積', () => {
    expect(overlap(1, 1, 3)).toBe(0);
    expect(overlap(2, 1, 0)).toBeCloseTo(Math.PI, 9);
    expect(overlap(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 9);
  });
});

describe('大赤斑と地図', () => {
  it('大赤斑の経度は BAA の 2025-12-01 の値（79°）に 1.5° 以内で合い、2026-12 は 99° ほどへのびる', () => {
    expect(Math.abs(grsL2(calToJd(2025, 12, 1)) - 79)).toBeLessThan(1.5);
    const v = grsL2(calToJd(2026, 12, 5));
    expect(v).toBeGreaterThan(97);
    expect(v).toBeLessThan(101);
  });

  it('日付に最も近い年の地図を選ぶ', () => {
    expect(nearestMap(calToJd(2026, 12, 5)).file).toBe('j2025a');
    expect(nearestMap(calToJd(2018, 8, 1)).file).toBe('j2018a');
    expect(MAPS.every((m, i) => i === 0 || m.jd > MAPS[i - 1].jd)).toBe(true);
  });
});

describe('図', () => {
  it('数値が壊れない', () => {
    const e = new Ephem(M);
    const t0 = calToJd(2026, 12, 4.5);
    const ph = findPhen(e, t0, t0 + 0.5);
    const out = [
      nightBand({
        t0,
        t1: t0 + 0.4,
        rows: ['a', 'b', 'c', 'd'],
        phen: ph,
        grs: [t0 + 0.1],
        dark: [[t0, t0 + 0.05]],
        twi: [],
        ticks: [{ t: t0, label: '0:00' }],
      }),
      wiggle({
        t0,
        t1: t0 + 3,
        xMax: 28,
        series: [0, 1, 2, 3].map((k) =>
          [0, 1, 2].map((i) => {
            const g = e.at(t0 + i);
            return [t0 + i, skyOffset(g, g.moons[k], M.re)[0], false] as [number, number, boolean];
          }),
        ),
        days: [{ t: t0 + 1, label: '12/5' }],
        marks: [],
      }),
      orbitTop({
        moons: [
          [5, 1],
          [0, 9],
          [-14, 2],
          [20, -18],
        ],
        names: ['a', 'b', 'c', 'd'],
        orbits: [5.9, 9.4, 15, 26.3],
        sun: [0.2, 0.98],
      }),
      season({
        d0: t0,
        d1: t0 + 60,
        h0: 18,
        h1: 30,
        tz: 9,
        events: [{ t: t0 + 1.2, kind: 'occ', a: 1, depth: 0.2 }],
        vis: [{ d: t0, a: 20, b: 29 }],
        ticks: [],
        today: t0 + 1,
        sel: 0,
      }),
      lightCurve(
        [
          [0, 1],
          [1, 0.8],
          [2, 1],
        ],
        { t0: 'a', t1: 'b', lo: '' },
      ),
    ].join('');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });
});

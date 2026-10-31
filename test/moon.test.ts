import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gast, nutation, precNut } from '../src/lib/astro/frame';
import { deltaT } from '../src/lib/astro/time';
import { ageAt, apsides, eclipseContacts, moonState, phaseTimes, riseSet, shadowAt } from '../src/tools/moon/ephem';
import { moonEcl } from '../src/tools/moon/meeus';

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/moon/${f}`, import.meta.url), 'utf8'));
const D = Math.PI / 180;
const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
/** 暦（UT）を JD に */
const jdOf = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) / 86400000 + 2440587.5;
const TOKYO = { lat: 35.6895, lon: 139.6917, h: 0 };

/** 誤差の絶対値の最大を確かめる */
const maxAbs = (xs: number[]) => Math.max(...xs.map(Math.abs));

describe('Meeus の例題', () => {
  it('47.a: 1992-04-12 0h TD の月の黄経・黄緯・距離', () => {
    const p = moonEcl((2448724.5 - 2451545) / 36525);
    expect(p.lon / D).toBeCloseTo(133.162655, 5);
    expect(p.lat / D).toBeCloseTo(-3.229126, 5);
    expect(p.dist).toBeCloseTo(368409.7, 1);
  });
  it('12.a: 1987-04-10 0h UT の平均恒星時 13h10m46.3668s', () => {
    expect(gast(2446895.5, { dpsi: 0, deps: 0, eps0: 0 }) / D).toBeCloseTo(197.693195, 5);
  });
  it('48.a: 1992-04-12 0h TD の輝面比 0.6786 と輝面の位置角 285.0°', () => {
    const jd = 2448724.5 - deltaT(2448724.5) / 86400;
    const s = moonState(jd, null);
    expect(s.illum).toBeCloseTo(0.6786, 3);
    expect(Math.abs(wrap(s.paBright - 285.0))).toBeLessThan(0.1);
  });
});

/*
 * NASA SVS「Moon Phase and Libration, 2026」（DE421、地心）の 13 時間ごとの行。値の意味は比べて確かめた:
 * time は UT、phase は輝面比 [%]、diameter は視直径 [″]、distance は中心間の距離 [km]、
 * subearth・subsolar の経度は東が正（−180〜180）、posangle は月の北極の位置角を J2000 の天の北から測ったもの
 * （of date の北から測ると 2026 年で最大 0.17° ずれ、J2000 の北なら 0.003° で合う）
 */
describe('NASA SVS（地心）', () => {
  const svs = load('svs-2026.json') as { rows: number[][] };
  const st = svs.rows.map((r) => ({ r, s: moonState(2461041.5 + r[0] / 24, null) }));
  it('距離 45 km・視直径 2″・輝面比 0.5 % 以内', () => {
    // 距離は Meeus 47 章の級数を切り詰めた誤差で、最大 42 km
    expect(maxAbs(st.map(({ r, s }) => s.distGeo - r[3]))).toBeLessThan(45);
    expect(maxAbs(st.map(({ r, s }) => s.diam - r[2]))).toBeLessThan(2);
    expect(maxAbs(st.map(({ r, s }) => s.illum * 100 - r[1]))).toBeLessThan(0.5);
  });
  it('地球・太陽の直下点が 0.15° 以内', () => {
    expect(maxAbs(st.map(({ r, s }) => wrap(s.subObs.lon - r[6])))).toBeLessThan(0.15);
    expect(maxAbs(st.map(({ r, s }) => s.subObs.lat - r[7]))).toBeLessThan(0.15);
    expect(maxAbs(st.map(({ r, s }) => wrap(s.subSun.lon - r[4])))).toBeLessThan(0.15);
    expect(maxAbs(st.map(({ r, s }) => s.subSun.lat - r[5]))).toBeLessThan(0.15);
  });
  it('自転軸の位置角が 0.2° 以内（J2000 の北から測り直して比べる）', () => {
    const err = st.map(({ r, s }) => {
      const t = (s.jdTT - 2451545) / 36525;
      const m = precNut(t, nutation(t));
      const p = [m[2], m[5], m[8]];
      const l = Math.hypot(...s.moon);
      const u = s.moon.map((x) => x / l);
      const k = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
      const n = p.map((x, i) => x - k * u[i]);
      const e = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      const z = s.mz;
      const pa = Math.atan2(z[0] * e[0] + z[1] * e[1] + z[2] * e[2], z[0] * n[0] + z[1] * n[1] + z[2] * n[2]) / D;
      return wrap(pa - r[8]);
    });
    expect(maxAbs(err)).toBeLessThan(0.2);
  });
});

/** JPL Horizons（DE441）の東京（測地 139.6917E 35.6895N 0 m）から見た月。問い合わせは fixture の source に書いた */
describe('JPL Horizons（東京から）', () => {
  const hz = load('horizons-tokyo.json').rows as Record<string, number>[];
  const st = hz.map((r) => ({ r, s: moonState(r.jd, TOKYO) }));
  it('高度・方位が 0.05° 以内（大気差なし・あり）', () => {
    expect(maxAbs(st.map(({ r, s }) => s.altGeo - r.el))).toBeLessThan(0.05);
    expect(maxAbs(st.map(({ r, s }) => s.alt - r.elRefr))).toBeLessThan(0.05);
    expect(maxAbs(st.map(({ r, s }) => wrap(s.az - r.az)))).toBeLessThan(0.05);
  });
  it('距離 40 km・視直径 2″・位相角 0.05° 以内', () => {
    expect(maxAbs(st.map(({ r, s }) => s.dist - r.km))).toBeLessThan(40);
    expect(maxAbs(st.map(({ r, s }) => s.diam - r.diam))).toBeLessThan(2);
    expect(maxAbs(st.map(({ r, s }) => s.phase - r.sto))).toBeLessThan(0.05);
  });
  it('観測地・太陽の直下点と自転軸の位置角が 0.15° 以内', () => {
    expect(maxAbs(st.map(({ r, s }) => wrap(s.subObs.lon - r.obsLon)))).toBeLessThan(0.15);
    expect(maxAbs(st.map(({ r, s }) => s.subObs.lat - r.obsLat))).toBeLessThan(0.15);
    expect(maxAbs(st.map(({ r, s }) => wrap(s.subSun.lon - r.sunLon)))).toBeLessThan(0.15);
    expect(maxAbs(st.map(({ r, s }) => s.subSun.lat - r.sunLat))).toBeLessThan(0.15);
    expect(maxAbs(st.map(({ r, s }) => wrap(s.paAxis - r.np)))).toBeLessThan(0.15);
  });
  it('地心では観測地が原点で、高度・方位は NaN', () => {
    const s = moonState(hz[0].jd, null);
    expect(s.obs).toEqual([0, 0, 0]);
    expect(s.dist).toBe(s.distGeo);
    expect(Number.isNaN(s.alt) && Number.isNaN(s.az) && Number.isNaN(s.q)).toBe(true);
  });
});

const usno = load('usno.json');

describe('月相（USNO）', () => {
  const names = ['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'];
  const ph = phaseTimes(jdOf(2026, 1, 1), jdOf(2027, 1, 1));
  it('2026 年の 50 回の朔・弦・望が 2 分以内', () => {
    const rows = usno.phases.rows as string[];
    expect(ph.length).toBe(rows.length);
    rows.forEach((row, i) => {
      const [, y, mo, d, h, mi, name] = row.match(/^(\d+)-(\d+)-(\d+) (\d+):(\d+) (.+)$/) as string[];
      expect(names[ph[i].q]).toBe(name);
      expect(Math.abs(ph[i].jd - jdOf(+y, +mo, +d, +h, +mi)) * 1440).toBeLessThan(2);
    });
  });
  it('月齢は直前の新月（2026-10-10 15:50 UT）からの日数', () => {
    const jd = jdOf(2026, 10, 22, 11);
    expect(ageAt(jd)).toBeCloseTo(jd - jdOf(2026, 10, 10, 15, 50), 2);
    expect(moonState(jd, null).elong).toBeGreaterThan(90);
  });
});

describe('出没（USNO、東京）', () => {
  const days = usno.rstt.days as Record<string, Record<string, string>>;
  for (const [date, ev] of Object.entries(days)) {
    it(`${date} の月の出・南中・月の入りが 2 分以内`, () => {
      const [y, mo, d] = date.split('-').map(Number);
      const jd0 = jdOf(y, mo, d) - 9 / 24;
      const rs = riseSet(jd0, TOKYO);
      const at = (hm: string | undefined) => {
        if (!hm) return null;
        const [h, mi] = hm.split(':').map(Number);
        return jd0 + (h * 60 + mi) / 1440;
      };
      const near = (got: number | null, want: number | null) => {
        if (want === null) expect(got === null || Number.isNaN(got)).toBe(true);
        else expect(Math.abs((got ?? Number.NaN) - want) * 1440).toBeLessThan(2);
      };
      near(rs.rise, at(ev.Rise));
      near(rs.set, at(ev.Set));
      near(rs.transit, at(ev['Upper Transit']));
    });
  }
  it('南中の高度は大気差込みの高度', () => {
    const rs = riseSet(jdOf(2026, 10, 22) - 9 / 24, TOKYO);
    expect(rs.transitAlt).toBeCloseTo(moonState(rs.transit, TOKYO).alt, 6);
    expect(rs.transitAlt).toBeGreaterThan(40);
  });
});

describe('近地点・遠地点', () => {
  it('前後 1 日より近い・遠い', () => {
    const a = apsides(jdOf(2026, 1, 1), jdOf(2026, 4, 1));
    expect(a.length).toBeGreaterThanOrEqual(6);
    for (const p of a) {
      const d0 = moonState(p.jd - 1, null).distGeo;
      const d1 = moonState(p.jd + 1, null).distGeo;
      if (p.kind === 'peri') expect(p.km).toBeLessThan(Math.min(d0, d1));
      else expect(p.km).toBeGreaterThan(Math.max(d0, d1));
    }
    expect(a.map((p) => p.kind).join()).toMatch(/^(peri,apo,)+|^(apo,peri,)+/);
  });
});

/** 時刻（時・分の小数）を UT の JD に。tz は時差 [h] */
const hm = (y: number, mo: number, d: number, h: number, m: number, tz = 0) =>
  jdOf(y, mo, d) + (h * 60 + m - tz * 60) / 1440;

describe('月食', () => {
  it('2026-03-03: 国立天文台の接触時刻と 60 秒以内、NASA の本影食分 1.1507', () => {
    const e = eclipseContacts(hm(2026, 3, 3, 20, 34, 9));
    const near = (t: number | null, want: number) =>
      expect(Math.abs((t ?? Number.NaN) - want) * 86400).toBeLessThan(60);
    near(e.u1, hm(2026, 3, 3, 18, 49.8, 9));
    near(e.u2, hm(2026, 3, 3, 20, 4.0, 9));
    near(e.max, hm(2026, 3, 3, 20, 33.7, 9));
    near(e.u3, hm(2026, 3, 3, 21, 3.4, 9));
    near(e.u4, hm(2026, 3, 3, 22, 17.8, 9));
    // NASA の最大 11:34:52 TD、ΔT 75 s
    near(e.max, hm(2026, 3, 3, 11, 34 + 52 / 60) - 75 / 86400);
    expect(e.umag).toBeCloseTo(1.1507, 2);
    expect(e.pmag).toBeCloseTo(2.1838, 2);
  });
  // NASA の五千年正典: 最大の TD・ΔT・本影食分・半影食分・半影食・部分食・皆既の継続時間 [分]
  const nasa: [string, number, number, number, number, number, number, number, number, number][] = [
    ['2025-09-07', 2025, 9, 7, 18 + 12 / 60 + 58 / 3600, 75, 1.3619, 2.344, 326.7, 209.4],
    ['2028-12-31', 2028, 12, 31, 16 + 53 / 60 + 15 / 3600, 77, 1.2463, 2.2742, 336.2, 208.8],
  ];
  const tot: Record<string, number> = { '2025-09-07': 82.1, '2028-12-31': 71.3 };
  for (const [name, y, mo, d, td, dt, umag, pmag, pen, par] of nasa) {
    it(`${name}: NASA の最大・食分・継続時間と合う`, () => {
      const max = jdOf(y, mo, d) + td / 24 - dt / 86400;
      const e = eclipseContacts(max + 0.02);
      expect(Math.abs(e.max - max) * 86400).toBeLessThan(60);
      expect(e.umag).toBeCloseTo(umag, 2);
      expect(e.pmag).toBeCloseTo(pmag, 2);
      const min = (a: number | null, b: number | null) => ((b ?? Number.NaN) - (a ?? Number.NaN)) * 1440;
      expect(Math.abs(min(e.p1, e.p4) - pen)).toBeLessThan(1);
      expect(Math.abs(min(e.u1, e.u4) - par)).toBeLessThan(1);
      expect(Math.abs(min(e.u2, e.u3) - tot[name])).toBeLessThan(1);
    });
  }
  it('影の座標: 月は影に対して東へ進み、γ が負の 2026-03-03 は軸の南、正の 2028-12-31 は北を通る', () => {
    const e = eclipseContacts(hm(2026, 3, 3, 11, 34));
    const a = shadowAt(e.max - 0.01);
    const b = shadowAt(e.max + 0.01);
    expect(b.x).toBeGreaterThan(a.x);
    expect(shadowAt(e.max).y).toBeLessThan(0);
    expect(shadowAt(eclipseContacts(hm(2028, 12, 31, 16, 52)).max).y).toBeGreaterThan(0);
  });
  it('食のないときは接触が null', () => {
    const e = eclipseContacts(hm(2026, 10, 26, 4, 12));
    expect(e.u1).toBeNull();
    expect(e.umag).toBeLessThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { parseRow, sarosNumber, splitCsv } from '../src/tools/solar-eclipse/catalog';
import { observerXYZ } from '../src/tools/solar-eclipse/earth';
import { geomAt, localCircumstances, overlapFraction } from '../src/tools/solar-eclipse/local';
import { centralPoint, limitPoint, outerCurves } from '../src/tools/solar-eclipse/path';
import { residualFlux } from '../src/tools/solar-eclipse/shade';
import { calToJd, deltaTEM, deltaTSigma, jdToCal } from '../src/tools/solar-eclipse/time';

/** NASA の五千年正典の CSV（eclipse_besselian_from_mysqldump2.csv）から 3 行 */
const CSV = `"year","month","day","td_ge","dt","luna_num","saros","eclipse_type","gamma","magnitude","lat_ge","lng_ge","lat_dd_ge","lng_dd_ge","sun_alt","sun_azm","path_width","central_duration","duration_secs","cat_no","canon_plate","julian_date","t0","x0","x1","x2","x3","y0","y1","y2","y3","d0","d1","d2","mu0","mu1","mu2","l10","l11","l12","l20","l21","l22","tan_f1","tan_f2","tmin","tmax","etype","PNS","UNS","NCN","nSer","nSeq","nJLE"
2009,7,22,"02:36:25",66.50000000,118,136,"T",.06977000,1.07991000,"24.2N","144.1E",24.21987000,144.11816000,85.90000000,197.60000000,258.50000000,"06m39s",398.90000000,9528.00000000,477.00000000,2455034.60900000,3.00000000,.23996100,.55639550,-.00005760,-.00000942,-.00327600,-.17745790,-.00013440,.00000318,20.26424000,-.00787400,-.00000500,223.38821000,15.00100000,.00000000,.53042700,.00000630,-.00001280,-.01563300,.00000630,-.00001270,.00460140,.00457840,-3.00000000,3.00000000,1,0,0,0,71,37,44
2012,5,20,"23:53:54",67.70000000,153,128,"A",.48279000,.94389000,"49.1N","176.3E",49.09429000,176.27753000,60.90000000,171.00000000,236.90000000,"05m46s",346.30000000,9535.00000000,477.00000000,2456068.49600000,.00000000,-.00226600,.50318280,.00001830,-.00000566,.48552400,.05605380,-.00014110,-.00000056,20.22056000,.00827100,-.00000500,180.85658000,15.00058000,.00000000,.56648700,-.00003120,-.00000970,.02024800,-.00003110,-.00000970,.00462050,.00459740,-3.00000000,3.00000000,2,1,0,0,73,58,2
2024,4,8,"18:18:29",74.00000000,300,139,"T",.34314000,1.05655000,"25.3N","104.1W",25.28945000,-104.12775000,69.80000000,149.40000000,197.50000000,"04m28s",268.10000000,9561.00000000,479.00000000,2460409.26300000,18.00000000,-.31824400,.51171160,.00003260,-.00000842,.21976400,.27095890,-.00005950,-.00000466,7.58620000,.01484400,-.00000200,89.59122000,15.00408000,.00000000,.53581400,.00006180,-.00001280,-.01027200,.00006150,-.00001270,.00466830,.00464500,-3.00000000,3.00000000,1,0,0,0,71,30,40`;

const rows = splitCsv(CSV);
const ecl = rows.slice(1).map((r) => parseRow(rows[0], r));
const [e2009, e2012, e2024] = ecl;
const D = Math.PI / 180;
/** 度と分（NASA の表の 25 27.7N の形）を度に */
const dm = (d: number, m: number, sgn = 1) => sgn * (d + m / 60);
/** UT の時刻と ΔT から、要素の t（t0 からの時間）へ */
const tOf = (el: (typeof ecl)[number]['el'], ut: number, dt: number) => {
  const t0 = Math.round(((el.jd0 + 0.5) % 1) * 24);
  let t = ut + dt / 3600 - t0;
  if (t > 12) t -= 24;
  if (t < -12) t += 24;
  return t;
};

describe('目録', () => {
  it('CSV の行を目録と要素に分ける', () => {
    expect(e2024.entry).toMatchObject({ year: 2024, saros: 139, type: 'T', sarosPos: 30, sarosLen: 71 });
    // t0 = 18 TD の JD
    expect(e2024.el.jd0).toBeCloseTo(2460409.25, 3);
  });
  it('サロス番号を朔望月の通し番号から出す', () => {
    for (const { entry } of ecl) expect(sarosNumber(entry.luna)).toBe(entry.saros);
    expect(sarosNumber(-49456)).toBe(5); // −1999-06-12
    expect(sarosNumber(441)).toBe(145); // 2035-09-02
  });
});

describe('経路', () => {
  // NASA の経路表（SE2024Apr08Tpath、ΔT = 70.6 s）の 17:40 UT: 北限・南限・中心線
  it('2024-04-08 の中心線と限界が NASA の表と 1′ 以内で合う', () => {
    const t = tOf(e2024.el, 17 + 40 / 60, 70.6);
    const c = centralPoint(e2024.el, t, 70.6);
    const n = limitPoint(e2024.el, t, true, 1, 70.6);
    const s = limitPoint(e2024.el, t, true, -1, 70.6);
    const near = (p: { lat: number; lon: number } | null, lat: number, lon: number) => {
      expect(p).not.toBeNull();
      expect(Math.abs((p as { lat: number }).lat / D - lat) * 60).toBeLessThan(1);
      expect(Math.abs((p as { lon: number }).lon / D - lon) * 60).toBeLessThan(1);
    };
    near(c, dm(14, 27.3), dm(114, 12.5, -1));
    near(n, dm(14, 59.9), dm(114, 58.5, -1));
    near(s, dm(13, 54.6), dm(113, 26.8, -1));
  });
  // SE2012May20Apath（ΔT = 66.7 s）の 23:30 UT
  it('2012-05-20 の金環帯が NASA の表と 0.3′ 以内で合う', () => {
    const t = tOf(e2012.el, 23.5, 66.7);
    const c = centralPoint(e2012.el, t, 66.7);
    const n = limitPoint(e2012.el, t, true, 1, 66.7);
    const s = limitPoint(e2012.el, t, true, -1, 66.7);
    expect(Math.abs((c?.lat ?? 0) / D - dm(46, 45.0)) * 60).toBeLessThan(0.3);
    expect(Math.abs((c?.lon ?? 0) / D - dm(165, 46.4)) * 60).toBeLessThan(0.3);
    expect(Math.abs((n?.lat ?? 0) / D - dm(47, 43.6)) * 60).toBeLessThan(0.3);
    expect(Math.abs((s?.lat ?? 0) / D - dm(45, 47.2)) * 60).toBeLessThan(0.3);
  });
  it('最大食の地点が目録と 0.1° 以内で合う', () => {
    for (const { entry, el } of ecl) {
      const t = (entry.jd - el.jd0) * 24;
      const c = centralPoint(el, t);
      expect(Math.abs((c?.lat ?? 0) / D - entry.lat)).toBeLessThan(0.1);
      expect(Math.abs((c?.lon ?? 0) / D - entry.lon)).toBeLessThan(0.1);
    }
  });
  it('食が見える範囲の外縁（半影の限界と日の出・日の入りの曲線）が描ける', () => {
    const lines = outerCurves(e2009.el);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) for (const p of l) expect(Number.isFinite(p.lat) && Number.isFinite(p.lon)).toBe(true);
  });
});

describe('地方食', () => {
  it('中心線の上の地点では、その時刻に影の軸が真上を通る', () => {
    const t = 0.3;
    const c = centralPoint(e2024.el, t);
    const site = { lat: c?.lat ?? 0, lon: c?.lon ?? 0, h: 0 };
    const g = geomAt(e2024.el, observerXYZ(site.lat, site.lon, 0), site, t, e2024.el.dt);
    expect(Math.hypot(g.u, g.v)).toBeLessThan(1e-9);
  });
  it('接触の時刻が、影の円と観測地の距離を細かく刻んで探した時刻と 0.1 秒以内で合う', () => {
    // 東京、2012-05-21 の金環日食
    const site = { lat: 35.6581 * D, lon: 139.7414 * D, h: 0 };
    const L = localCircumstances(e2012.el, site, 66.7);
    expect(L.kind).toBe('annular');
    const p = observerXYZ(site.lat, site.lon, 0);
    const cross = (umbra: boolean, from: number, to: number) => {
      let prev = Number.NaN;
      for (let t = from; t <= to; t += 0.05 / 3600) {
        const g = geomAt(e2012.el, p, site, t, 66.7);
        const f = Math.hypot(g.u, g.v) - (umbra ? Math.abs(g.L2) : g.L1);
        if (!Number.isNaN(prev) && Math.sign(prev) !== Math.sign(f)) return t;
        prev = f;
      }
      return Number.NaN;
    };
    const s = 1 / 3600;
    expect(Math.abs((L.c1?.t ?? 0) - cross(false, (L.c1?.t ?? 0) - 5 * s, (L.c1?.t ?? 0) + 5 * s)) * 3600).toBeLessThan(
      0.1,
    );
    expect(Math.abs((L.c2?.t ?? 0) - cross(true, (L.c2?.t ?? 0) - 5 * s, (L.c2?.t ?? 0) + 5 * s)) * 3600).toBeLessThan(
      0.1,
    );
    expect(Math.abs((L.c4?.t ?? 0) - cross(false, (L.c4?.t ?? 0) - 5 * s, (L.c4?.t ?? 0) + 5 * s)) * 3600).toBeLessThan(
      0.1,
    );
    // 金環の継続時間は約 5 分
    expect(L.duration).toBeGreaterThan(290);
    expect(L.duration).toBeLessThan(320);
  });
  it('皆既帯の外では部分食。地球の裏側（夜）では見えない', () => {
    const tokyo = localCircumstances(e2009.el, { lat: 35.68 * D, lon: 139.77 * D, h: 0 });
    expect(tokyo.kind).toBe('partial');
    expect(tokyo.visible).toBe(true);
    expect(localCircumstances(e2009.el, { lat: -40 * D, lon: -60 * D, h: 0 }).visible).toBe(false);
    expect(localCircumstances(e2009.el, { lat: -60 * D, lon: 144 * D, h: 0 }).kind).toBe('none');
  });
});

describe('残光', () => {
  it('周辺減光なし（α = 0）なら面積比と 0.5 % 以内で合う', () => {
    for (const sep of [0.3, 0.7, 1.2])
      expect(residualFlux(1, 0.5, sep, 0)).toBeCloseTo(1 - overlapFraction(1, 0.5, sep), 2);
  });
  it('皆既で 0、離れれば 1、細い三日月でも 0 にならない', () => {
    expect(residualFlux(1, 1.03, 0)).toBe(0);
    expect(residualFlux(1, 1.03, 2.1)).toBe(1);
    expect(residualFlux(1, 1.03, 0.031)).toBeGreaterThan(0);
    // 周辺減光のため、縁の細い光は面積比より暗い
    expect(residualFlux(1, 1.03, 0.035)).toBeLessThan(1 - overlapFraction(1, 1.03, 0.035));
  });
});

describe('暦と ΔT', () => {
  it('Espenak & Meeus の ΔT が正典の値と合う', () => {
    expect(deltaTEM(2024 + 3.5 / 12)).toBeCloseTo(74.0, 0);
    expect(Math.abs(deltaTEM(-1999 + 5.5 / 12) - 46438.2)).toBeLessThan(2);
  });
  it('ΔT の標準誤差が NASA の表と合う', () => {
    expect(deltaTSigma(-2000)).toBeCloseTo(3732, -1);
    expect(deltaTSigma(0)).toBeCloseTo(265, 0);
    expect(deltaTSigma(2500)).toBeCloseTo(612, -1);
    expect(deltaTSigma(3000)).toBeCloseTo(1885, -1);
  });
  it('JD と暦の行き来（1582 年より前はユリウス暦）', () => {
    expect(calToJd(2000, 1, 1)).toBe(2451544.5);
    expect(calToJd(1582, 10, 15) - calToJd(1582, 10, 4)).toBe(1);
    expect(jdToCal(calToJd(-584, 5, 28))).toMatchObject({ year: -584, month: 5, day: 28 });
    expect(jdToCal(e2024.entry.jd)).toMatchObject({ year: 2024, month: 4, day: 8 });
  });
});

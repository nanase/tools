import { describe, expect, it } from 'vitest';
import { dayOf } from '../src/tools/sunrise/day';
import { lonLatAt } from '../src/tools/sunrise/map';
import { factsOf, skyCenter, skyX } from '../src/tools/sunrise/sky';
import { band, geoAltAz, siteSun, subsolar, sunEq, sunEqLow } from '../src/tools/sunrise/sun';
import { approx, localDay, lookupZone, offText, zoneOffset } from '../src/tools/sunrise/tz';
import { yearGrid } from '../src/tools/sunrise/year';
import { yearPick } from '../src/tools/sunrise/yearview';

const D = Math.PI / 180;
const TOKYO = [35.6895, 139.6917] as const;

describe('太陽の位置', () => {
  it('夏至の赤緯は +23.44° 付近', () => {
    expect(sunEq(Date.UTC(2026, 5, 21, 3)).dec / D).toBeCloseTo(23.44, 1);
  });

  it('低精度の式は VSOP87 と 0.02° 以内', () => {
    for (const ms of [Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1, 6), Date.UTC(2026, 9, 15, 18)]) {
      const a = geoAltAz(sunEq(ms), ...TOKYO);
      const b = geoAltAz(sunEqLow(ms), ...TOKYO);
      expect(Math.abs(a.h - b.h)).toBeLessThan(0.02);
    }
  });

  it('太陽が真上の地点では高度 90°', () => {
    const s = sunEq(Date.UTC(2026, 2, 20, 12));
    const p = subsolar(s);
    expect(geoAltAz(s, p.lat, p.lon).h).toBeCloseTo(90, 3);
    expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
  });

  it('東京の南中では方位 180°', () => {
    // 2026-11-18 の東京の南中は 11:26 JST ごろ
    const a = geoAltAz(sunEq(Date.UTC(2026, 10, 18, 2, 26)), ...TOKYO);
    expect(Math.abs(a.az - 180)).toBeLessThan(1);
  });

  it('段の境', () => {
    expect([1, -0.833, -1, -6.1, -12.1, -18.1].map(band)).toEqual([0, 0, 1, 2, 3, 4]);
  });
});

const JST = 9 * 36e5;
const jstDay = (y: number, m: number, d: number) =>
  [Date.UTC(y, m - 1, d) - JST, Date.UTC(y, m - 1, d + 1) - JST] as const;
/** 時刻 ms の JST の時・分を 0 時からの分にする（秒は切り捨て。暦計算室の表と同じ） */
const hm = (ms: number | null) => {
  const t = new Date((ms ?? Number.NaN) + JST);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};

describe('その日の出来事', () => {
  // 基準は国立天文台 暦計算室の東京。都庁の座標とのずれを見込んで ±1 分
  it('東京の夏至の日の出 4:25・日の入り 19:00', () => {
    const d = dayOf(...TOKYO, ...jstDay(2026, 6, 21));
    expect(Math.abs(hm(d.rise) - (4 * 60 + 25))).toBeLessThanOrEqual(1);
    expect(Math.abs(hm(d.set) - 19 * 60)).toBeLessThanOrEqual(1);
    expect(d.polar).toBeNull();
  });

  it('東京の冬至の日の出 6:47・日の入り 16:32', () => {
    const d = dayOf(...TOKYO, ...jstDay(2026, 12, 22));
    expect(Math.abs(hm(d.rise) - (6 * 60 + 47))).toBeLessThanOrEqual(1);
    expect(Math.abs(hm(d.set) - (16 * 60 + 32))).toBeLessThanOrEqual(1);
    expect(d.len / 36e5).toBeCloseTo((16 * 60 + 32 - (6 * 60 + 47)) / 60, 1);
  });

  it('5 分おきの高度と方位を 1 日分持つ', () => {
    const d = dayOf(...TOKYO, ...jstDay(2026, 6, 21));
    expect(d.N).toBe(288);
    expect(d.hs.length).toBe(289);
    expect(d.azs.length).toBe(289);
    expect(d.riseAz).toBeGreaterThan(55);
    expect(d.riseAz).toBeLessThan(65);
  });

  it('ロングイェールビーンの夏至は白夜、冬至は極夜', () => {
    const lyr = [78.2232, 15.6267] as const;
    const s = dayOf(...lyr, Date.UTC(2026, 5, 21) - 2 * 36e5, Date.UTC(2026, 5, 22) - 2 * 36e5);
    expect([s.polar, s.rise, s.set, s.len]).toEqual(['day', null, null, 864e5]);
    const w = dayOf(...lyr, Date.UTC(2026, 11, 21) - 36e5, Date.UTC(2026, 11, 22) - 36e5);
    expect([w.polar, w.rise, w.set, w.len]).toEqual(['night', null, null, 0]);
  });
});

describe('1 年の格子', () => {
  it('365 列 × 144 行で、正午は昼・真夜中は夜', () => {
    const g = yearGrid(...TOKYO, 2026, () => JST);
    expect(g.nd).toBe(365);
    expect(g.cells.length).toBe(365 * 144);
    expect(g.cells[72 * g.nd + 100]).toBe(0);
    expect(g.cells[0 * g.nd + 100]).toBe(4);
  });

  it('閏年は 366 列', () => {
    expect(yearGrid(...TOKYO, 2028, () => JST).nd).toBe(366);
  });
});

describe('時間帯', () => {
  it('座標から時間帯', async () => {
    expect(await lookupZone(40.7128, -74.006)).toBe('America/New_York');
    expect(await lookupZone(35.6895, 139.6917)).toBe('Asia/Tokyo');
  });

  it('夏時間と 30 分・45 分の差', () => {
    expect(zoneOffset('America/New_York', -74, Date.UTC(2026, 6, 1))).toBe(-4 * 36e5);
    expect(zoneOffset('America/New_York', -74, Date.UTC(2026, 0, 1))).toBe(-5 * 36e5);
    expect(offText(zoneOffset('Asia/Kolkata', 72.9, Date.UTC(2026, 0, 1)))).toBe('UTC+5:30');
    expect(offText(zoneOffset('Asia/Kathmandu', 85.3, Date.UTC(2026, 0, 1)))).toBe('UTC+5:45');
    expect(offText(-5 * 36e5)).toBe('UTC−5');
    expect(offText(9 * 36e5)).toBe('UTC+9');
  });

  it('時間帯がないときは経度から', () => {
    expect(zoneOffset(null, 139.7, 0)).toBe(9 * 36e5);
    expect(zoneOffset(null, -74, 0)).toBe(-5 * 36e5);
    expect([approx(null), approx('Etc/GMT+2'), approx('Asia/Tokyo')]).toEqual([true, true, false]);
  });

  it('知らない時間帯の名前は経度から', () => {
    expect(zoneOffset('Nowhere/Nothing', 139.7, 0)).toBe(9 * 36e5);
  });

  it('夏時間の始まる日は 23 時間、終わる日は 25 時間', () => {
    const off = (ms: number) => zoneOffset('America/New_York', -74, ms);
    const [a, b] = localDay(Date.UTC(2026, 2, 8, 17), off);
    expect(a).toBe(Date.UTC(2026, 2, 8, 5));
    expect(b - a).toBe(23 * 36e5);
    const [c, d] = localDay(Date.UTC(2026, 10, 1, 17), off);
    expect(d - c).toBe(25 * 36e5);
  });

  it('夏時間の日でも 1 日分の出来事が出る', () => {
    const off = (ms: number) => zoneOffset('America/New_York', -74, ms);
    const d = dayOf(40.7128, -74.006, ...localDay(Date.UTC(2026, 2, 8, 17), off));
    expect(d.N).toBe(276);
    expect(d.rise).not.toBeNull();
    expect(d.set).not.toBeNull();
  });
});

describe('地図の座標', () => {
  it('左上は北西の端、真ん中は経度 0°・緯度 0°', () => {
    const a = lonLatAt(0, 0, 720, 360);
    expect(a.lat).toBeCloseTo(89.75, 2);
    expect(a.lon).toBeCloseTo(-179.75, 2);
    const c = lonLatAt(359.5, 179.5, 720, 360);
    expect(c.lat).toBeCloseTo(0, 6);
    expect(c.lon).toBeCloseTo(0, 6);
  });
});

describe('地点の数値と空の図', () => {
  it('地点の今の太陽は球面の式と 0.05° 以内（大気差を除く）', () => {
    const ms = Date.UTC(2026, 10, 18, 2);
    const a = siteSun(ms, ...TOKYO);
    const b = geoAltAz(sunEq(ms), ...TOKYO);
    expect(Math.abs(a.hGeo - b.h)).toBeLessThan(0.05);
    expect(Math.abs(a.az - b.az)).toBeLessThan(0.05);
    expect(a.h).toBeGreaterThan(a.hGeo);
  });

  it('空の図の真ん中は北半球で南、南半球で北', () => {
    expect([skyCenter(35), skyCenter(-33)]).toEqual([180, 0]);
    expect(skyX(180, 180, 0, 360)).toBe(180);
    expect(skyX(0, 0, 0, 360)).toBe(180);
    expect(skyX(90, 180, 0, 360)).toBe(90);
  });

  it('数値の 6 つ', () => {
    const d = dayOf(...TOKYO, ...jstDay(2026, 12, 22));
    const f = factsOf(d, { h: -12.34, az: 316 }, () => 'x');
    expect(f.map((r) => r[0])).toEqual(['高度', '方位', '日の出', '南中', '日の入り', '昼の長さ']);
    expect(f[0][1]).toBe('−12.3°');
    expect(f[1][1]).toBe('316°（北西）');
    expect(f[5][1]).toMatch(/^9時間4\d分$/);
  });

  it('極夜の数値', () => {
    const d = dayOf(78.2232, 15.6267, Date.UTC(2026, 11, 21) - 36e5, Date.UTC(2026, 11, 22) - 36e5);
    const f = Object.fromEntries(factsOf(d, { h: -30, az: 0 }, () => 'x'));
    expect([f['日の出'], f['日の入り'], f['昼の長さ']]).toEqual(['—', '—', '0時間00分（極夜）']);
  });

  it('白夜の数値', () => {
    const d = dayOf(78.2232, 15.6267, Date.UTC(2026, 5, 21) - 2 * 36e5, Date.UTC(2026, 5, 22) - 2 * 36e5);
    expect(Object.fromEntries(factsOf(d, { h: 10, az: 0 }, () => 'x'))['昼の長さ']).toBe('24時間00分（白夜）');
  });
});

describe('1 年の図', () => {
  const g = { L: 40, T: 0, pw: 365, ph: 144, nd: 365, year: 2026 };
  it('押した所の日と分', () => {
    expect(yearPick(40, 0, g)).toEqual({ day: 0, min: 0 });
    expect(yearPick(40 + 171.5, 72, g)).toEqual({ day: 171, min: 720 });
    expect(yearPick(40 + 365, 144, g)).toEqual({ day: 364, min: 1439 });
  });
  it('図の外は null', () => {
    expect(yearPick(10, 10, g)).toBeNull();
    expect(yearPick(60, 150, g)).toBeNull();
  });
});

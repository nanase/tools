import { describe, expect, it } from 'vitest';
import { dayOf } from '../src/tools/sunrise/day';
import { boundView, lonLatAt } from '../src/tools/sunrise/map';
import { factsOf, num, skyCenter, skyX, solsticeNames } from '../src/tools/sunrise/sky';
import { apparent, band, geoAltAz, siteSun, subsolar, sunEq, sunEqLow } from '../src/tools/sunrise/sun';
import {
  approx,
  fromWall,
  hasDst,
  localDay,
  lookupZone,
  offText,
  shiftTime,
  stdOffset,
  wallMs,
  zoneOffset,
} from '../src/tools/sunrise/tz';
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
    const a = lonLatAt(0.5, 0.5, 720, 360);
    expect(a.lat).toBeCloseTo(89.75, 2);
    expect(a.lon).toBeCloseTo(-179.75, 2);
    const c = lonLatAt(360, 180, 720, 360);
    expect(c.lat).toBeCloseTo(0, 6);
    expect(c.lon).toBeCloseTo(0, 6);
  });

  it('2 倍に拡大すると左上は西経 90°・北緯 45°', () => {
    const a = lonLatAt(0, 0, 720, 360, { z: 2, x: 0, y: 0 });
    expect(a.lat).toBeCloseTo(45, 6);
    expect(a.lon).toBeCloseTo(-90, 6);
  });

  it('東西はつながる（半周ずらすと左端が経度 0°）', () => {
    const a = lonLatAt(0, 180, 720, 360, { z: 1, x: 360, y: 0 });
    expect(a.lon).toBeCloseTo(0, 6);
    const b = lonLatAt(719.9, 180, 720, 360, { z: 1, x: -360, y: 0 });
    expect(b.lon).toBeGreaterThanOrEqual(-180);
    expect(b.lon).toBeLessThan(180);
  });

  it('縦は地図の外を見せず、横は 1 周に巻く', () => {
    expect(boundView(1, 0, 50, 720, 360).y).toBe(0);
    expect(boundView(2, 0, 500, 720, 360).y).toBe(180);
    expect(boundView(2, 0, -500, 720, 360).y).toBe(-180);
    expect(boundView(1, 1000, 0, 720, 360).x).toBeCloseTo(280, 6);
  });
});

describe('夏時間を使わない', () => {
  it('ニューヨークの標準時は夏も UTC−5', () => {
    const jul = Date.UTC(2026, 6, 1, 12);
    expect(zoneOffset('America/New_York', -74, jul)).toBe(-4 * 36e5);
    expect(stdOffset('America/New_York', -74, jul)).toBe(-5 * 36e5);
    expect(hasDst('America/New_York', -74, jul)).toBe(true);
  });

  it('南半球（シドニー）の標準時は 1 月も UTC+10', () => {
    const jan = Date.UTC(2026, 0, 15, 12);
    expect(zoneOffset('Australia/Sydney', 151, jan)).toBe(11 * 36e5);
    expect(stdOffset('Australia/Sydney', 151, jan)).toBe(10 * 36e5);
  });

  it('東京・時間帯のない地点は夏時間なし', () => {
    const t = Date.UTC(2026, 6, 1);
    expect(hasDst('Asia/Tokyo', 139.7, t)).toBe(false);
    expect(stdOffset('Asia/Tokyo', 139.7, t)).toBe(9 * 36e5);
    expect(hasDst(null, -74, t)).toBe(false);
  });

  it('標準時で数えると 1 年の格子に夏時間の段差が出ない', () => {
    const std = (ms: number) => stdOffset('America/New_York', -74, ms);
    const g = yearGrid(40.7128, -74.006, 2026, std);
    /* 3 月 7 日と 3 月 9 日（夏時間の始まりをまたぐ）の日の出の行の差は 1 行以内 */
    const riseRow = (d: number) => {
      for (let k = 0; k < 144; k++) if (g.cells[k * g.nd + d] === 0) return k;
      return -1;
    };
    expect(Math.abs(riseRow(65) - riseRow(67))).toBeLessThanOrEqual(1);
    const dst = yearGrid(40.7128, -74.006, 2026, (ms) => zoneOffset('America/New_York', -74, ms));
    const riseDst = (d: number) => {
      for (let k = 0; k < 144; k++) if (dst.cells[k * dst.nd + d] === 0) return k;
      return -1;
    };
    expect(riseDst(67) - riseDst(65)).toBeGreaterThanOrEqual(5);
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

describe('見直しで見つかった点', () => {
  const ny = (ms: number) => zoneOffset('America/New_York', -74, ms);

  it('夏時間の向こう側の日時を選んでも、その日の時差で瞬間にする', () => {
    expect(fromWall(Date.UTC(2026, 0, 15, 12), ny)).toBe(Date.UTC(2026, 0, 15, 17));
    expect(fromWall(Date.UTC(2026, 6, 1, 12), ny)).toBe(Date.UTC(2026, 6, 1, 16));
  });

  it('暦の日時はミリ秒ちょうどに直る（1 分ずれない）', () => {
    expect(wallMs({ year: 2026, month: 3, day: 8, hour: 5, minute: 0, second: 0 })).toBe(Date.UTC(2026, 2, 8, 5));
    expect(new Date(wallMs({ year: 50, month: 1, day: 1, hour: 0, minute: 0, second: 0 })).getUTCFullYear()).toBe(50);
  });

  it('地平線の下では大気差を足さない', () => {
    expect(apparent(-6.3)).toBe(-6.3);
    expect(apparent(-30)).toBe(-30);
    expect(apparent(0)).toBeGreaterThan(0.4);
    expect(Math.abs(apparent(-1) - apparent(-1.0001))).toBeLessThan(0.01);
  });

  it('−0 を出さない', () => {
    expect(num(-0.04, 1)).toBe('0.0');
    expect(num(-0.4, 0)).toBe('0');
    expect(num(-12.34, 1)).toBe('−12.3');
  });

  it('南中の高度も見かけの値', () => {
    const d = dayOf(...TOKYO, ...jstDay(2026, 12, 22));
    expect(factsOf(d, { h: 10, az: 180 }, () => 'x')[3][1]).toBe(`x（${num(apparent(d.maxH), 0)}°）`);
  });

  it('夏至・冬至の札は南半球で入れ替える（6 月の道すじ, 12 月の道すじ）', () => {
    expect(solsticeNames(35)).toEqual(['夏至', '冬至']);
    expect(solsticeNames(-33)).toEqual(['冬至', '夏至']);
  });
});

describe('時刻の操作', () => {
  const ny = (ms: number) => zoneOffset('America/New_York', -74, ms);

  it('分・時間の幅はそのまま足す', () => {
    const t = Date.UTC(2026, 2, 8, 6, 30);
    expect(shiftTime(t, 600, ny)).toBe(t + 600e3);
    expect(shiftTime(t, -3600, ny)).toBe(t - 3600e3);
  });

  it('日の幅は現地の時刻を保つ（夏時間をまたいでも 12:00 のまま）', () => {
    const noon7 = Date.UTC(2026, 2, 7, 17); // 3 月 7 日 12:00 EST
    expect(shiftTime(noon7, 86400, ny)).toBe(Date.UTC(2026, 2, 8, 16)); // 3 月 8 日 12:00 EDT
    expect(shiftTime(noon7, 3 * 86400, ny)).toBe(Date.UTC(2026, 2, 10, 16));
    expect(shiftTime(Date.UTC(2026, 2, 8, 16), -86400, ny)).toBe(noon7);
  });
});

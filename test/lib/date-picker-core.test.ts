import { describe, expect, it } from 'vitest';
import { jdToCal } from '../../src/lib/astro/time';
import {
  addMonths,
  type DateTime,
  dateTimeToJd,
  lastDay,
  monthCells,
  setField,
  stepField,
  toDateTime,
} from '../../src/lib/date-picker-core';

const dt = (year: number, month: number, day: number, hour = 12, minute = 30, second = 15): DateTime => ({
  year,
  month,
  day,
  hour,
  minute,
  second,
});

describe('lastDay', () => {
  it('グレゴリオ暦の閏年に従う', () => {
    expect(lastDay(2024, 2)).toBe(29);
    expect(lastDay(2026, 2)).toBe(28);
    expect(lastDay(1900, 2)).toBe(28);
    expect(lastDay(2026, 12)).toBe(31);
  });
  it('1582 年より前はユリウス暦の閏年に従う', () => {
    expect(lastDay(1500, 2)).toBe(29);
  });
  it('暦の変わる月も 31 日まで', () => {
    expect(lastDay(1582, 10)).toBe(31);
  });
});

describe('addMonths', () => {
  it('年をまたぐ', () => {
    expect(addMonths(dt(2026, 12, 5), 1)).toEqual(dt(2027, 1, 5));
    expect(addMonths(dt(2026, 1, 5), -1)).toEqual(dt(2025, 12, 5));
  });
  it('日を移った月の末日に収める', () => {
    expect(addMonths(dt(2026, 1, 31), 1)).toEqual(dt(2026, 2, 28));
  });
  it('暦の変わる月の抜けた日を避ける', () => {
    expect(addMonths(dt(1582, 9, 10), 1)).toEqual(dt(1582, 10, 15));
  });
});

describe('setField', () => {
  it('範囲の外は端に収める', () => {
    expect(setField(dt(2026, 11, 5), 'month', 13).month).toBe(12);
    expect(setField(dt(2026, 11, 5), 'hour', 99).hour).toBe(23);
    expect(setField(dt(2026, 11, 5), 'minute', 99).minute).toBe(59);
    expect(setField(dt(2026, 11, 5), 'year', 0).year).toBe(1);
  });
  it('日はその月の末日に収める', () => {
    expect(setField(dt(2026, 2, 5), 'day', 31).day).toBe(28);
    expect(setField(dt(2026, 1, 31), 'month', 2).day).toBe(28);
    expect(setField(dt(2024, 2, 29), 'year', 2026).day).toBe(28);
  });
  it('時刻を入れると秒を 0 にし、日付を入れても秒は変えない', () => {
    expect(setField(dt(2026, 11, 5), 'hour', 7).second).toBe(0);
    expect(setField(dt(2026, 11, 5), 'minute', 7).second).toBe(0);
    expect(setField(dt(2026, 11, 5), 'day', 7).second).toBe(15);
  });
});

describe('stepField', () => {
  it('日は月をまたぐ', () => {
    expect(stepField(dt(2026, 11, 30), 'day', 1)).toEqual(dt(2026, 12, 1));
    expect(stepField(dt(2026, 3, 1), 'day', -1)).toEqual(dt(2026, 2, 28));
  });
  it('時と分は日付へ繰り上がる', () => {
    expect(stepField(dt(2026, 12, 31, 23, 30), 'hour', 1)).toEqual(dt(2027, 1, 1, 0, 30, 0));
    expect(stepField(dt(2026, 11, 5, 0, 0), 'minute', -1)).toEqual(dt(2026, 11, 4, 23, 59, 0));
  });
  it('暦の変わる日をまたぐ', () => {
    expect(stepField(dt(1582, 10, 4), 'day', 1)).toEqual(dt(1582, 10, 15));
    expect(stepField(dt(1582, 10, 15), 'day', -1)).toEqual(dt(1582, 10, 4));
  });
  it('月と年は addMonths と同じ', () => {
    expect(stepField(dt(2026, 11, 5), 'month', 2)).toEqual(dt(2027, 1, 5));
    expect(stepField(dt(2024, 2, 29), 'year', 1)).toEqual(dt(2025, 2, 28));
  });
});

describe('monthCells', () => {
  it('いつも 6 段 42 マスで、日曜から始まる', () => {
    const cells = monthCells(2026, 11);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ year: 2026, month: 11, day: 1, inMonth: true });
    const feb = monthCells(2026, 2);
    expect(feb).toHaveLength(42);
    expect(feb[0]).toMatchObject({ year: 2026, month: 2, day: 1 });
    const oct = monthCells(2026, 10);
    expect(oct[0]).toMatchObject({ year: 2026, month: 9, day: 27, inMonth: false });
    expect(oct[4]).toMatchObject({ year: 2026, month: 10, day: 1, inMonth: true });
  });
  it('暦の変わる月は 4 日の次が 15 日になる', () => {
    const days = monthCells(1582, 10)
      .filter((c) => c.inMonth)
      .map((c) => c.day);
    expect(days).toHaveLength(21);
    expect(days.slice(3, 5)).toEqual([4, 15]);
    /* 1582-10-15 は金曜日 */
    expect(monthCells(1582, 10).findIndex((c) => c.day === 15 && c.inMonth) % 7).toBe(5);
  });
});

describe('JD との変換', () => {
  it('時刻帯を入れて往復しても 1 秒もずれない', () => {
    for (const tz of [0, 9]) {
      for (let minute = 0; minute < 60; minute++) {
        const v = dt(2035, 3, 9, 7, minute, 0);
        const c = jdToCal(dateTimeToJd(v, tz) + tz / 24);
        expect(toDateTime(c)).toEqual(v);
      }
    }
  });
  it('日の終わりの端数で 24 時にならない', () => {
    expect(toDateTime({ year: 2026, month: 11, day: 5, hour: 23.99999999 })).toEqual(dt(2026, 11, 5, 23, 59, 59));
  });
});

/**
 * 日時の選択の計算（DOM に依存しない）。暦は astro/time.ts と同じで、1582-10-15 より前はユリウス暦
 */
import { type Cal, calToJd, jdToCal } from './astro/time';

export interface DateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}
export type DateField = 'year' | 'month' | 'day' | 'hour' | 'minute';

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 暦の変わり目で存在しない 1582-10-05〜14 を 15 日へ送り、末日を超えた日を収める */
function validDay(year: number, month: number, day: number): number {
  const d = clamp(day, 1, lastDay(year, month));
  return year === 1582 && month === 10 && d > 4 && d < 15 ? 15 : d;
}

export function lastDay(year: number, month: number): number {
  const next = month === 12 ? calToJd(year + 1, 1, 1) : calToJd(year, month + 1, 1);
  return jdToCal(next - 1).day;
}

export function addMonths(v: DateTime, n: number): DateTime {
  const t = clamp(v.year * 12 + v.month - 1 + n, MIN_YEAR * 12, MAX_YEAR * 12 + 11);
  const year = Math.floor(t / 12);
  const month = t - year * 12 + 1;
  return { ...v, year, month, day: validDay(year, month, v.day) };
}

/** 入力した値を入れる。時刻を入れたときは秒を 0 にする */
export function setField(v: DateTime, k: DateField, x: number): DateTime {
  if (k === 'hour') return { ...v, hour: clamp(x, 0, 23), second: 0 };
  if (k === 'minute') return { ...v, minute: clamp(x, 0, 59), second: 0 };
  if (k === 'day') return { ...v, day: validDay(v.year, v.month, x) };
  const year = k === 'year' ? clamp(x, MIN_YEAR, MAX_YEAR) : v.year;
  const month = k === 'month' ? clamp(x, 1, 12) : v.month;
  return { ...v, year, month, day: validDay(year, month, v.day) };
}

/** 値を n だけ増減する。上の桁へ繰り上がる */
export function stepField(v: DateTime, k: DateField, n: number): DateTime {
  if (k === 'year') return addMonths(v, n * 12);
  if (k === 'month') return addMonths(v, n);
  const jd0 = calToJd(v.year, v.month, v.day);
  if (k === 'day') {
    const c = jdToCal(jd0 + n);
    return { ...v, year: c.year, month: c.month, day: c.day };
  }
  const total = v.hour * 60 + v.minute + (k === 'hour' ? n * 60 : n);
  const days = Math.floor(total / 1440);
  const rest = total - days * 1440;
  const c = jdToCal(jd0 + days);
  return {
    year: c.year,
    month: c.month,
    day: c.day,
    hour: Math.floor(rest / 60),
    minute: rest % 60,
    second: 0,
  };
}

export interface DayCell {
  year: number;
  month: number;
  day: number;
  inMonth: boolean;
}

/** 月の格子。段の数が月で変わると ‹ › の位置が動くので、前後の月の日で 6 段 42 マスに埋める */
export function monthCells(year: number, month: number): DayCell[] {
  const first = calToJd(year, month, 1);
  /* 0 時の JD は .5 で終わるので、1.5 を足すと日曜 = 0 の曜日になる */
  const weekday = ((Math.floor(first + 1.5) % 7) + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const c = jdToCal(first - weekday + i);
    return { year: c.year, month: c.month, day: c.day, inMonth: c.year === year && c.month === month };
  });
}

/**
 * 暦の時刻を時・分・秒に分ける。JD の丸めで 07:05:00 が 07:04:59 にならないよう 1 ms の余裕を見る
 */
export function secOfDay(hour: number): number {
  return Math.min(86399, Math.floor(hour * 3600 + 1e-3));
}

export function toDateTime(c: Cal): DateTime {
  const s = secOfDay(c.hour);
  return {
    year: c.year,
    month: c.month,
    day: c.day,
    hour: Math.floor(s / 3600),
    minute: Math.floor((s % 3600) / 60),
    second: s % 60,
  };
}

/** tz は時刻帯の時差 [h] */
export function dateTimeToJd(v: DateTime, tz: number): number {
  return calToJd(v.year, v.month, v.day) + (v.hour + v.minute / 60 + v.second / 3600 - tz) / 24;
}

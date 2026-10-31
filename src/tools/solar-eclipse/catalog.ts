/**
 * 日食の目録（DOM に依存しない）: NASA の五千年正典の CSV の 1 行を、目録の項目とベッセル要素に分ける
 *
 * 出典: eclipse.gsfc.nasa.gov/eclipse_besselian_from_mysqldump2.csv
 * "Eclipse Predictions by Fred Espenak (NASA's GSFC)"
 */

import { calToJd } from '../../lib/astro/time';
import type { Elements } from './elements';

/** NASA の型: P 部分、A 金環、T 皆既、H 混成。後ろの文字は中心・非中心などの区別 */
export type EclipseType = 'P' | 'A' | 'T' | 'H';

export interface Entry {
  /** 最大食の暦（天文学的な年の数え方で、1582-10-15 より前はユリウス暦） */
  year: number;
  month: number;
  day: number;
  /** 最大食の JD（TD） */
  jd: number;
  /** NASA が使った ΔT [s] */
  dt: number;
  luna: number;
  saros: number;
  /** サロス系列の中の番号と系列の件数 */
  sarosPos: number;
  sarosLen: number;
  type: EclipseType;
  /** NASA の型の文字列（Am・T+・Pb など） */
  code: string;
  gamma: number;
  mag: number;
  /** 最大食の地点 [°]（東経が正）、太陽の高度 [°]、経路幅 [km]、中心の継続時間 [s] */
  lat: number;
  lon: number;
  sunAlt: number;
  width: number;
  duration: number;
}

const unq = (s: string) => s.replace(/^"|"$/g, '');

export function parseRow(header: string[], row: string[]): { entry: Entry; el: Elements; tdSec: number } {
  const c: Record<string, string> = {};
  header.forEach((h, k) => {
    c[unq(h)] = unq(row[k] ?? '');
  });
  const n = (k: string) => Number(c[k]);
  const code = c.eclipse_type;
  const [hh, mm, ss] = c.td_ge.split(':').map(Number);
  // CSV の julian_date は小数 3 桁（±43 秒）なので、暦の日付と最大食の時刻から出し直す
  const jd = calToJd(n('year'), n('month'), n('day')) + (hh * 3600 + mm * 60 + ss) / 86400;
  const t0 = n('t0');
  // t0 は最大食に最も近い正時なので、日付をまたぐ（23:53 の食で t0 = 0）ときは ±24 時間を寄せる
  let dh = hh + mm / 60 + ss / 3600 - t0;
  if (dh > 12) dh -= 24;
  if (dh < -12) dh += 24;
  const jd0 = jd - dh / 24;
  const entry: Entry = {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    jd,
    dt: n('dt'),
    luna: n('luna_num'),
    saros: n('saros'),
    sarosPos: n('nSeq'),
    sarosLen: n('nSer'),
    type: code[0] as EclipseType,
    code,
    gamma: n('gamma'),
    mag: n('magnitude'),
    lat: n('lat_dd_ge'),
    lon: n('lng_dd_ge'),
    sunAlt: n('sun_alt'),
    width: n('path_width'),
    duration: n('duration_secs'),
  };
  const el: Elements = {
    jd0,
    dt: n('dt'),
    x: [n('x0'), n('x1'), n('x2'), n('x3')],
    y: [n('y0'), n('y1'), n('y2'), n('y3')],
    d: [n('d0'), n('d1'), n('d2')],
    mu: [n('mu0'), n('mu1'), n('mu2')],
    l1: [n('l10'), n('l11'), n('l12')],
    l2: [n('l20'), n('l21'), n('l22')],
    tf1: n('tan_f1'),
    tf2: n('tan_f2'),
    tmin: n('tmin'),
    tmax: n('tmax'),
  };
  return { entry, el, tdSec: hh * 3600 + mm * 60 + ss };
}

/** 引用符の中のカンマを気にしなくてよい NASA の CSV を、行と列に分ける */
export function splitCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.split(','));
}

/**
 * 朔望月の通し番号（NASA の Luna Num、2000-01-06 の新月が 0）からサロス番号を出す。
 * 1 朔望月ごとに番号は 38 ずつ（mod 223）進む。剰余を −13〜209 に寄せると正典の全件と一致する（このツールで確かめた式）
 */
export function sarosNumber(luna: number): number {
  let s = (((112 + 38 * luna) % 223) + 223) % 223;
  if (s > 209) s -= 223;
  return s;
}

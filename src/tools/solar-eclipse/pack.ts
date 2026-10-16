/**
 * 日食の目録と要素を、ブラウザへ送る数の並びに詰める・戻す（DOM に依存しない）
 *
 * 1 件は [年, 月, 日, 最大食の TD の秒, ΔT, Luna Num, サロス, 系列の番号, 系列の件数, 型, γ, 食分, 緯度, 経度,
 * 太陽の高度, 経路幅, 中心の継続時間, t0, x0〜x3, y0〜y3, d0〜d2, μ0・μ1, l1₀〜l1₂, l2₀〜l2₂, tan f1, tan f2]。
 * μ2 は正典のすべてで 0、tmin・tmax はすべて ∓3 なので送らない
 */
import type { EclipseType, Entry } from './catalog';
import type { Elements } from './elements';
import { calToJd } from './time';

export type Packed = (number | string)[];

export function pack(e: Entry, el: Elements, tdSec: number): Packed {
  const t0 = Math.round(((el.jd0 + 0.5) % 1) * 24) % 24;
  return [
    e.year,
    e.month,
    e.day,
    tdSec,
    e.dt,
    e.luna,
    e.saros,
    e.sarosPos,
    e.sarosLen,
    e.code,
    e.gamma,
    e.mag,
    e.lat,
    e.lon,
    e.sunAlt,
    e.width,
    e.duration,
    t0,
    ...el.x,
    ...el.y,
    ...el.d,
    el.mu[0],
    el.mu[1],
    ...el.l1,
    ...el.l2,
    el.tf1,
    el.tf2,
  ];
}

export function unpack(p: Packed): { entry: Entry; el: Elements } {
  const n = (k: number) => p[k] as number;
  const code = p[9] as string;
  const tdSec = n(3);
  const t0 = n(17);
  // 最大食の日の 0 時（TD）の JD。t0 は最大食に最も近い正時なので、日付をまたぐときは ±24 時間を寄せる
  const day0 = calToJd(n(0), n(1), n(2));
  let dh = tdSec / 3600 - t0;
  if (dh > 12) dh -= 24;
  if (dh < -12) dh += 24;
  const jd = day0 + tdSec / 86400;
  const entry: Entry = {
    year: n(0),
    month: n(1),
    day: n(2),
    jd,
    dt: n(4),
    luna: n(5),
    saros: n(6),
    sarosPos: n(7),
    sarosLen: n(8),
    type: code[0] as EclipseType,
    code,
    gamma: n(10),
    mag: n(11),
    lat: n(12),
    lon: n(13),
    sunAlt: n(14),
    width: n(15),
    duration: n(16),
  };
  const el: Elements = {
    jd0: jd - dh / 24,
    dt: n(4),
    x: [n(18), n(19), n(20), n(21)],
    y: [n(22), n(23), n(24), n(25)],
    d: [n(26), n(27), n(28)],
    mu: [n(29), n(30), 0],
    l1: [n(31), n(32), n(33)],
    l2: [n(34), n(35), n(36)],
    tf1: n(37),
    tf2: n(38),
    tmin: -3,
    tmax: 3,
  };
  return { entry, el };
}

/** 100 年ごとのファイルの番号（−1999〜−1901 年は −20、2000〜2099 年は 20） */
export const centuryOf = (year: number) => Math.floor(year / 100);

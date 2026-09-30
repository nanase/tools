/**
 * 条件から探す（DOM に依存しない）: 基板に取れる大きさ・配線の最小の幅と間隔・帯域・抵抗の範囲を満たし、
 * 同じ電圧で駆動したときの磁界が強いコイルを、形・巻数・配線の幅を変えて探す。外径は取れる大きさいっぱいにする
 */
import { C0, calc, fRes, nearE24, nMax, SHAPES, type Shape } from './coil';
import { type Conn, eqR, layerDist, loopL, loopM, type Stack, type Stacked, stacked } from './layers';
import { MMS } from './params';

export interface Cond {
  /** 共振させる周波数 [Hz] */
  f: number;
  st: Stack;
  conn: Conn;
  /** 銅箔の厚さ [µm] */
  t: number;
  /** 基板に取れる大きさ（外形の一辺）・配線の最小の幅・最小の間隔 [mm] */
  dmax: number;
  wmin: number;
  smin: number;
  /** カバーする帯域 ±% （0 なら条件にしない）。両端で −3 dB 以内になる Q に抑える */
  band: number;
  /** 共振時の直列抵抗の範囲 [Ω]（駆動回路に合う抵抗。rmax が 0 なら上限なし） */
  rmin: number;
  rmax: number;
}

export interface Cand {
  sh: Shape;
  /** 画面の値 [mm] */
  dout: number;
  n: number;
  w: number;
  s: number;
  g: Stacked;
  /** 共振時の直列抵抗（コイル + 足す抵抗）と、足す抵抗 [Ω] */
  rTot: number;
  rAdd: number;
  /** 足した抵抗を含めた Q */
  q: number;
  /** 1 V で駆動したときの 1 m 先（軸上）の磁界 [A/m] */
  h1: number;
  /** 共振コンデンサの E24 の値と、そのときの共振周波数 */
  ce: number;
  fe: number;
  /** 帯域の両端での落ち込み [dB]（帯域の条件がなければ NaN） */
  edge: number;
}

/** 帯域 ±band % の両端で −3 dB 以内になる Q の上限（0 なら Infinity） */
export function qMax(band: number): number {
  if (!(band > 0)) return Infinity;
  const q = (a: number) => 1 / Math.abs(a - 1 / a);
  return Math.min(q(1 + band / 100), q(1 - band / 100));
}
/** 共振の Q で、中心から比 a の周波数での落ち込み [dB] */
export const dropDb = (q: number, a: number): number => -10 * Math.log10(1 + (q * (a - 1 / a)) ** 2);

/** 形の外接する大きさ（外径に対する比）。六角形は角が外径より外へ出る */
export const extentOf = (sh: Shape): number => (sh.k === 6 ? 1 / Math.cos(Math.PI / 6) : 1);

/** 探す配線の幅: 最小の幅と、並びの中でそれより大きい値（多くとも 8 つ、外径の 1/8 まで） */
export function widths(wmin: number, dout: number): number[] {
  const L = [wmin, ...MMS.filter((x) => x > wmin * (1 + 1e-9))].filter((x) => x <= dout / 8);
  return L.slice(0, 8);
}

/**
 * 形・外径・幅・間隔を固定して、巻数 1〜上限の全部を計算する。層の結合は巻きを 1 つ足すごとに
 * 自己と相互の和を積み増して求める（巻数ごとに求め直すより速い）
 */
function sweepN(sh: Shape, dout: number, w: number, s: number, c: Cond, out: Cand[]): void {
  const nm = nMax(dout, w, s),
    d = dout * 1e-3,
    wm = w * 1e-3,
    sm = s * 1e-3,
    tm = c.t * 1e-6,
    st = c.st;
  const R = Array.from({ length: nm }, (_, i) => eqR(sh.k, d / 2 - wm / 2 - i * (wm + sm)));
  const hs: number[] = [];
  for (let i = 0; i < st.n; i++)
    for (let j = i + 1; j < st.n; j++) {
      const h = layerDist(st, i, j, tm);
      if (!hs.some((x) => Math.abs(x - h) < 1e-12)) hs.push(h);
    }
  const mut = hs.map(() => 0),
    om = 2 * Math.PI * c.f,
    qm = qMax(c.band),
    lambda10 = C0 / c.f / 10;
  let self = 0;
  for (let n = 1; n <= nm; n++) {
    const x = n - 1;
    self += loopL(R[x], wm, tm);
    for (let u = 0; u < x; u++) self += 2 * loopM(R[u], R[x], 0);
    hs.forEach((h, i) => {
      let m = loopM(R[x], R[x], h);
      for (let u = 0; u < x; u++) m += 2 * loopM(R[u], R[x], h);
      mut[i] += m;
    });
    const kh = (h: number) => {
      const i = hs.findIndex((y) => Math.abs(y - h) < 1e-12);
      return i < 0 ? 0 : Math.min(1, mut[i] / self);
    };
    const g = stacked(calc(sh, { n, dout, w, s, t: c.t }, c.f), st, c.conn, kh, R.slice(0, n));
    if (g.len > lambda10 || g.srf < 3 * c.f) continue;
    const rTot = Math.max(g.rac, c.rmin, Number.isFinite(qm) ? (om * g.L) / qm : 0);
    if (c.rmax > 0 && rTot > c.rmax * (1 + 1e-9)) continue;
    const q = (om * g.L) / rTot,
      ce = nearE24(g.c);
    out.push({
      sh,
      dout,
      n,
      w,
      s,
      g,
      rTot,
      rAdd: rTot - g.rac,
      q,
      h1: g.na / rTot / (2 * Math.PI),
      ce,
      fe: fRes(g.L, ce),
      edge: c.band > 0 ? Math.min(dropDb(q, 1 + c.band / 100), dropDb(q, 1 - c.band / 100)) : Number.NaN,
    });
  }
}

/**
 * 条件を満たす候補を、1 m 先の磁界の強い順に返す。形ごとの最良を必ず含め、残りを強い順に足して max 件まで。
 * 外径は基板に取れる大きさいっぱい（六角形は角が収まる大きさ、0.1 mm 単位で切り下げ）にする
 */
export function search(c: Cond, max = 8): Cand[] {
  const all: Cand[] = [];
  for (const sh of SHAPES) {
    const dout = Math.floor((c.dmax / extentOf(sh)) * 10 + 1e-9) / 10;
    for (const w of widths(c.wmin, dout)) sweepN(sh, dout, w, c.smin, c, all);
  }
  all.sort((a, b) => b.h1 - a.h1);
  const pick: Cand[] = [];
  for (const sh of SHAPES) {
    const b = all.find((x) => x.sh === sh);
    if (b) pick.push(b);
  }
  for (const x of all) {
    if (pick.length >= max) break;
    if (!pick.includes(x)) pick.push(x);
  }
  return pick.sort((a, b) => b.h1 - a.h1);
}

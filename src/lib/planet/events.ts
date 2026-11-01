/**
 * 衛星の現象（DOM に依存しない）: 本体の前の通過・本体の裏（掩蔽）・影の通過・本体の影の中（食）と、衛星どうしの相互食
 *
 * 判定は衛星の中心で行う（IMCCE の現象の表と同じ）。惑星は自転楕円体で、惑星固定の座標の z を
 * 赤道半径 / 極半径 倍に伸ばすと半径 1 の球になるので、視線（または太陽の光）の向きの直線と球の距離で判定する。
 * 時刻は粗い刻みで状態の変わり目を探し、二分法で 1 秒ほどまで詰める
 */
import { AU } from '../astro/frame';
import { bisect, golden } from '../astro/solve';
import { dot, len, sub, unit, type Vec3 } from '../astro/vec';
import { type Ephem, type Geo, R_SUN, toBody } from './ephem';

export type Kind = 'TR' | 'OC' | 'SH' | 'EC';

/** 現象の期間（UT の JD）。探した範囲の外で始まる・終わるものは、端の時刻が範囲の外になる */
export interface Phen {
  /** 衛星の番号 */
  k: number;
  kind: Kind;
  t0: number;
  t1: number;
}

/**
 * 惑星中心の位置 p [km] の点から向き dir（単位ベクトル）へのびる直線と惑星の関係。
 * [直線と球の距離² − 1（負なら直線が惑星を通る）, 点が惑星より dir の側にあるか]
 */
export function limb(g: Geo, re: number, rp: number, p: Vec3, dir: Vec3): [number, boolean] {
  const k = re / rp;
  const a = toBody(g, p);
  const q: Vec3 = [a[0] / re, a[1] / re, (a[2] / re) * k];
  const b = toBody(g, dir);
  const d = unit([b[0], b[1], b[2] * k]);
  const t = dot(q, d);
  return [dot(q, q) - t * t - 1, t > 0];
}

/** 地球（地心）への向き */
export const toEarth = (g: Geo): Vec3 => {
  const u = unit(g.P);
  return [-u[0], -u[1], -u[2]];
};

/** 衛星 k のその時刻の状態（TR・OC・SH・EC のどれにあるか） */
function state(g: Geo, re: number, rp: number, k: number): Record<Kind, boolean> & { o: number; s: number } {
  const m = g.moons[k];
  const [o, fo] = limb(g, re, rp, m, toEarth(g));
  const [s, fs] = limb(g, re, rp, m, g.s);
  return { TR: o < 0 && fo, OC: o < 0 && !fo, SH: s < 0 && fs, EC: s < 0 && !fs, o, s };
}

const KINDS: Kind[] = ['TR', 'OC', 'SH', 'EC'];

/** [jd0, jd1] の現象を探す。step は刻み [日]（短い現象を見落とさないよう 10 分以下にする） */
export function findPhen(e: Ephem, jd0: number, jd1: number, step = 5 / 1440): Phen[] {
  const { re, rp, nMoons } = e.model;
  const out: Phen[] = [];
  const open: (number | null)[][] = Array.from({ length: nMoons }, () => [null, null, null, null]);
  const edge = (k: number, kind: Kind, a: number, b: number) => {
    const f = (t: number) => state(e.at(t), re, rp, k)[kind === 'TR' || kind === 'OC' ? 'o' : 's'];
    return bisect(f, a, b, 22);
  };
  let prev = Array.from({ length: nMoons }, (_, k) => state(e.at(jd0), re, rp, k));
  prev.forEach((s, k) => {
    KINDS.forEach((kind, i) => {
      if (s[kind]) open[k][i] = Number.NEGATIVE_INFINITY;
    });
  });
  const n = Math.ceil((jd1 - jd0) / step);
  for (let i = 1; i <= n; i++) {
    const a = jd0 + (i - 1) * step,
      b = Math.min(jd1, jd0 + i * step);
    const g = e.at(b);
    const cur = Array.from({ length: nMoons }, (_, k) => state(g, re, rp, k));
    for (let k = 0; k < nMoons; k++)
      KINDS.forEach((kind, j) => {
        if (cur[k][kind] === prev[k][kind]) return;
        const t = edge(k, kind, a, b);
        if (cur[k][kind]) open[k][j] = t;
        else {
          out.push({ k, kind, t0: open[k][j] ?? Number.NEGATIVE_INFINITY, t1: t });
          open[k][j] = null;
        }
      });
    prev = cur;
  }
  for (let k = 0; k < nMoons; k++)
    KINDS.forEach((kind, j) => {
      const t0 = open[k][j];
      if (t0 !== null) out.push({ k, kind, t0, t1: Number.POSITIVE_INFINITY });
    });
  return out.sort((x, y) => x.t0 - y.t0);
}

/** 半径 r1・r2 の円の中心が d 離れているときの重なりの面積 */
export function overlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = Math.acos(Math.min(1, Math.max(-1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const a2 = Math.acos(Math.min(1, Math.max(-1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
}

/** 太陽の視半径 θs の円盤が、視半径 θb の天体に角距離 θ だけ離れて隠されるとき、隠れる割合 */
export const sunHidden = (ts: number, tb: number, th: number): number => overlap(ts, tb, th) / (Math.PI * ts * ts);

/**
 * 衛星 k の中心から見た太陽のうち、惑星に隠れる割合（0〜1。本体の影の中の明るさに使う）。
 * 惑星は伸ばした座標で半径 1 の球として扱う
 */
export function planetShadow(g: Geo, re: number, rp: number, k: number): number {
  const m = g.moons[k];
  const [s2, front] = limb(g, re, rp, m, g.s);
  if (front) return 0;
  const L = Math.max(1, len(m) / re);
  const th = Math.sqrt(Math.max(0, s2 + 1)) / L;
  return sunHidden(R_SUN / (g.r * AU), 1 / L, th);
}

/** 衛星どうしの相互食（occ: 地球から見て手前の衛星が隠す、ecl: 太陽から見て手前の衛星の影に入る） */
export interface Mutual {
  kind: 'occ' | 'ecl';
  /** 隠す側（手前）と隠される側の衛星の番号 */
  a: number;
  b: number;
  t0: number;
  t1: number;
  /** 最も深いときの時刻と、2 つの衛星の合計の光が減る割合 */
  tm: number;
  depth: number;
}

/** 2 つの衛星の、隠す向きに垂直な面での離れ [km] と、重なりの限界 [km]、手前の衛星 */
function pairGeom(g: Geo, radii: number[], kind: 'occ' | 'ecl', i: number, j: number) {
  const u = kind === 'occ' ? toEarth(g) : g.s;
  const mi = g.moons[i],
    mj = g.moons[j];
  const near = dot(mi, u) > dot(mj, u) ? i : j;
  const far = near === i ? j : i;
  const d = sub(g.moons[far], g.moons[near]);
  const along = -dot(d, u);
  const sep = len(sub(d, [-along * u[0], -along * u[1], -along * u[2]]));
  const ts = R_SUN / (g.r * AU);
  const lim = radii[near] + radii[far] + (kind === 'ecl' ? along * ts : 0);
  return { sep, lim, near, far, along, u };
}

/** 衛星 k が本体の裏か本体の影の中にあるか（相互食が見えない） */
function hiddenByPlanet(g: Geo, re: number, rp: number, k: number): boolean {
  const s = state(g, re, rp, k);
  return s.OC || s.EC;
}

/** 合計の光の、相互食がないときに対する割合（0〜1）。flux は衛星ごとの明るさ（任意の単位） */
export function pairFlux(g: Geo, radii: number[], flux: number[], kind: 'occ' | 'ecl', i: number, j: number): number {
  const p = pairGeom(g, radii, kind, i, j);
  const rn = radii[p.near],
    rf = radii[p.far];
  const tot = flux[i] + flux[j];
  if (p.sep >= p.lim) return 1;
  if (kind === 'occ') return 1 - (flux[p.far] * overlap(rf, rn, p.sep)) / (Math.PI * rf * rf) / tot;
  /* 食: 隠される衛星の円盤（太陽から見たもの）の上で、太陽の円盤が隠れる割合を平均する */
  const u = p.u;
  const e1 = unit(Math.abs(u[2]) < 0.9 ? [u[1], -u[0], 0] : [0, u[2], -u[1]]);
  const e2: Vec3 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const c = sub(g.moons[p.far], g.moons[p.near]);
  const L = p.along;
  if (L <= 0) return 1;
  const ts = R_SUN / (g.r * AU);
  const N = 9;
  let sum = 0,
    cnt = 0;
  for (let a = 0; a < N; a++)
    for (let b = 0; b < N; b++) {
      const x = ((a + 0.5) / N) * 2 - 1,
        y = ((b + 0.5) / N) * 2 - 1;
      if (x * x + y * y > 1) continue;
      const q: Vec3 = [
        c[0] + rf * (x * e1[0] + y * e2[0]),
        c[1] + rf * (x * e1[1] + y * e2[1]),
        c[2] + rf * (x * e1[2] + y * e2[2]),
      ];
      const w = dot(q, u);
      const dq = len([q[0] - w * u[0], q[1] - w * u[1], q[2] - w * u[2]]);
      sum += sunHidden(ts, rn / L, dq / L);
      cnt++;
    }
  return 1 - (flux[p.far] * (sum / cnt)) / tot;
}

/** [jd0, jd1] の相互食を探す。radii は衛星の半径 [km]、flux は明るさ */
export function findMutual(e: Ephem, radii: number[], flux: number[], jd0: number, jd1: number): Mutual[] {
  const { re, rp } = e.model;
  const nm = radii.length;
  const out: Mutual[] = [];
  const step = 15 / 1440;
  const n = Math.ceil((jd1 - jd0) / step) + 2;
  const geos: Geo[] = Array.from({ length: n + 1 }, (_, i) => e.at(jd0 - step + i * step));
  for (const kind of ['occ', 'ecl'] as const)
    for (let i = 0; i < nm; i++)
      for (let j = i + 1; j < nm; j++) {
        const f = (t: number) => {
          const p = pairGeom(e.at(t), radii, kind, i, j);
          return p.sep - p.lim;
        };
        const v = geos.map((g) => {
          const p = pairGeom(g, radii, kind, i, j);
          return p.sep - p.lim;
        });
        for (let s = 1; s < n; s++) {
          if (!(v[s] <= v[s - 1] && v[s] < v[s + 1])) continue;
          const ta = jd0 - step + (s - 1) * step;
          const tm = golden(f, ta, ta + 2 * step, 40);
          if (f(tm) >= 0) continue;
          let a = tm;
          while (f(a - step) < 0 && tm - a < 0.5) a -= step;
          let b = tm;
          while (f(b + step) < 0 && b - tm < 0.5) b += step;
          const t0 = bisect(f, a - step, a, 22);
          const t1 = bisect(f, b, b + step, 22);
          if (tm < jd0 || tm >= jd1) continue;
          const gm = e.at(tm);
          const p = pairGeom(gm, radii, kind, i, j);
          if (hiddenByPlanet(gm, re, rp, p.far) || (kind === 'occ' && hiddenByPlanet(gm, re, rp, p.near))) continue;
          /* 最も深いとき（光の最小）を、中心が最も近いときのまわりで探す */
          const fl = (t: number) => pairFlux(e.at(t), radii, flux, kind, i, j);
          const tb = golden(fl, t0, t1, 30);
          out.push({ kind, a: p.near, b: p.far, t0, t1, tm: tb, depth: 1 - fl(tb) });
        }
      }
  return out.sort((x, y) => x.tm - y.tm);
}

/** 惑星の中心から見た、地球からの見かけの東西・南北の離れ（惑星の赤道半径が単位。東が正、北が正） */
export function skyOffset(g: Geo, v: Vec3, re: number): [number, number] {
  const u = unit(g.P);
  const n0: Vec3 = [-u[2] * u[0], -u[2] * u[1], 1 - u[2] * u[2]];
  const nn = unit(n0);
  const east: Vec3 = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
  return [dot(v, east) / re, dot(v, nn) / re];
}

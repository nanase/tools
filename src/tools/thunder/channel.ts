/**
 * 雷鳴のページの放電路（DOM に依存しない）: 乱数で曲がりくねった折れ線を作る。
 * 地面の落雷点から雲の底まで上がり、雲の中を横に進む本流と、本流から下へ伸びる枝。
 * 1 回の雷で同じ放電路に何回も電流が流れる（多重雷）。2 回目からは枝を通らず、雲の中で分かれて新しい所まで伸びる。
 * 座標は落雷点を原点、z を上、聞き手は +x の向き
 */
import { mulberry, normal } from '../kalman/kf';

export type V3 = [number, number, number];

/** 折れ線 1 本 */
export interface Branch {
  /** 頂点 x, y, z [m] を 3 つずつ */
  p: Float64Array;
  /** 単位長さあたりのエネルギー [J/m] */
  e: number;
  /** 本流は 0、枝は 1 */
  k: 0 | 1;
  /** 電流が流れる時刻 [s]（最初の放電が 0） */
  t: number;
}

export interface ChannelSet {
  /** 乱数の種 */
  seed: number;
  /** 雲の底の高さ [m]。本流はここまで上へ進む */
  base: number;
  /** 雲の中を横へ進む長さ [m] */
  cloud: number;
  /** 雲の中を進む向き [度]（+x から反時計回り。聞き手は 0°） */
  az: number;
  /** 区間の長さの下限と上限 [m]（この間で一様） */
  lmin: number;
  lmax: number;
  /** 隣り合う区間の向きの変化の平均 [度] */
  turn: number;
  /** 枝の数 */
  branches: number;
  /** 本流の単位長さあたりのエネルギー [J/m] */
  e: number;
  /** 枝のエネルギーの本流に対する比 */
  eBranch: number;
  /** 放電の回数（多重雷） */
  strokes: number;
  /** 放電の間隔の幾何平均 [s]（対数正規分布） */
  gap: number;
  /** 2 回目からの放電のエネルギーの、最初の放電に対する比 */
  eSub: number;
  /** 2 回目から 1 回ごとに、雲の中で新しく分かれて伸びる長さ [m] */
  grow: number;
}

/** 放電の回数の上限 */
export const STROKES_MAX = 8;
/** 放電の間隔の対数の標準偏差と、間隔の下限・上限 [s] */
const GAP_SD = 0.8,
  GAP_MIN = 0.01,
  GAP_MAX = 0.5;

/**
 * 既定: 区間の平均 8 m（LeVine・Gilson 1984、Lacroix ほか 2019）・向きの変化の平均 16°（Hill 1968）・
 * E = 10⁶ J/m（Few 1969）・放電の間隔の幾何平均 61 ms（Saba ほか 2006）・放電の回数 4（多くは 3〜5 回）。
 * 雲の高さ・雲の中の長さと向き・枝の数とエネルギー・長さの幅・2 回目からのエネルギーと伸びは仮。
 * 雲の中は聞き手から斜めに遠ざかる向きに 5 km 進め、3 km 先で雷鳴が 10 秒あまり続くようにした。
 * 2 回目からは雲の中の電荷を、ほぼ同じ高さで最初より遠い所から引く（Krehbiel ほか 1979 は最大 8 km）ので、雲の中で分かれて 3 km 伸ばす
 */
export const CH0: ChannelSet = {
  seed: 1,
  base: 2000,
  cloud: 5000,
  az: 150,
  lmin: 4,
  lmax: 12,
  turn: 16,
  branches: 4,
  e: 1e6,
  eBranch: 0.3,
  strokes: 4,
  gap: 0.061,
  eSub: 0.3,
  grow: 3000,
};

/** 向きがこれより目標から離れたら、曲がる向きを目標の側へ折り返す [度] */
const WANDER = 35;
/**
 * 雲の中の放電路は、水平の向きがこれより目標から離れたら折り返す [度]（高さの向きは WANDER のまま）。
 * 大きく蛇行させて、聞き手に横を向く所を増やす（仮。WANDER のままだと雲の中の音が端の向きでなまり、雷鳴がすぐ消える）
 */
const CLOUD_WANDER = 80;
/** 雲の中の放電路の仰角の上限 [度]（ほぼ同じ高さを進む）と、雲の底から入る深さ [m] */
const CLOUD_ELEV = 10,
  CLOUD_IN = 300;

const norm = (v: V3): V3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a: V3, b: V3) => Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
/** 水平の向きの間の角 [度] と、向きの仰角の大きさ [度] */
const hAngle = (a: V3, b: V3) =>
  (Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) * 180) / Math.PI;
const elev = (a: V3) => (Math.abs(Math.asin(Math.min(1, Math.max(-1, a[2])))) * 180) / Math.PI;

/** d を、d に垂直な向き（方位 φ）へ θ だけ傾ける */
function tilt(d: V3, th: number, ph: number): V3 {
  const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0],
    u = norm(cross(d, ref)),
    w = cross(d, u),
    s = Math.sin(th),
    c = Math.cos(th),
    cp = Math.cos(ph),
    sp = Math.sin(ph);
  return norm([
    c * d[0] + s * (cp * u[0] + sp * w[0]),
    c * d[1] + s * (cp * u[1] + sp * w[1]),
    c * d[2] + s * (cp * u[2] + sp * w[2]),
  ]);
}

/**
 * 乱歩で折れ線を作る。区間ごとに向きを、平均 turn の半正規分布の角度だけ乱数の方位へ傾ける。
 * 目標の向き g から WANDER より離れていて、さらに離れる向きなら方位を反対にする（角度の分布は変えない）。
 * flat を与えると雲の中の歩き方: 水平の向きは g から flat 度まで、仰角は CLOUD_ELEV 度まで離れてよく、雲の底の近くより下へは潜っていかない。
 * done(点, 進んだ長さ) が真になったら止める
 */
function walk(
  r: () => number,
  s: ChannelSet,
  from: V3,
  d0: V3,
  g: V3,
  done: (p: V3, len: number) => boolean,
  flat?: number,
): number[] {
  /* 半正規分布の平均は σ√(2/π) */
  const sig = ((s.turn * Math.PI) / 180) * Math.sqrt(Math.PI / 2),
    out = [...from];
  let p = from,
    d = norm(d0),
    len = 0;
  for (let n = 0; n < 100000 && !done(p, len); n++) {
    const th = Math.abs(normal(r)) * sig;
    let ph = 2 * Math.PI * r(),
      nd = tilt(d, th, ph);
    const away = (a: V3, b: V3) =>
      flat == null
        ? angle(a, g) * (180 / Math.PI) > WANDER && angle(b, g) > angle(a, g)
        : (hAngle(a, g) > flat && hAngle(b, g) > hAngle(a, g)) ||
          (elev(a) > CLOUD_ELEV && elev(b) > elev(a)) ||
          /* 雲の底から CLOUD_IN より下では下へ向かわない */
          (p[2] < s.base + CLOUD_IN && a[2] < 0 && b[2] < a[2]);
    if (away(d, nd)) {
      ph += Math.PI;
      nd = tilt(d, th, ph);
    }
    d = nd;
    const l = s.lmin + (s.lmax - s.lmin) * r();
    p = [p[0] + l * d[0], p[1] + l * d[1], p[2] + l * d[2]];
    /* 地面より下へは行かない */
    if (p[2] < 0) p[2] = 0;
    out.push(...p);
    len += l;
  }
  return out;
}

/**
 * 放電路を作る。同じ設定と種なら同じ形。
 * 並びは最初の放電の本流・枝、2 回目からの放電の本流。
 * 2 回目からの本流は、前の放電の雲の中の放電路の途中から分かれ、外へ向かう新しい向きに grow だけ進む
 */
export function makeChannel(s: ChannelSet): Branch[] {
  const r = mulberry(s.seed * 7919 + 13),
    up: V3 = [0, 0, 1],
    a = (s.az * Math.PI) / 180,
    side: V3 = [Math.cos(a), Math.sin(a), 0];
  const trunk = walk(r, s, [0, 0, 0], up, up, (p) => p[2] >= s.base);
  const top = trunk.slice(-3) as V3,
    cloud = walk(r, s, top, norm([side[0], side[1], 0.3]), side, (_, len) => len >= s.cloud, CLOUD_WANDER).slice(3);
  const main = [...trunk, ...cloud],
    mk = (q: number[], e: number, k: 0 | 1, t: number): Branch => ({ p: Float64Array.from(q), e, k, t }),
    out: Branch[] = [mk(main, s.e, 0, 0)],
    nv = main.length / 3,
    nt = trunk.length / 3;
  for (let b = 0; b < s.branches; b++) {
    /* 枝は本流の雲の底の近くから、下へ斜めに伸びる */
    const i = Math.min(nv - 1, Math.floor(nt * (0.45 + 0.5 * r()) + (nv - nt) * 0.2 * r())),
      o: V3 = [main[3 * i], main[3 * i + 1], main[3 * i + 2]],
      b2 = 2 * Math.PI * r(),
      g = norm([Math.cos(b2), Math.sin(b2), -0.7]),
      want = 300 + 900 * r();
    const p = walk(r, s, o, g, g, (q, len) => len >= want || q[2] <= 50);
    out.push(mk(p, s.e * s.eBranch, 1, 0));
  }
  /* 2 回目からの放電: 形と間隔は回ごとの乱数で決め、回数を変えても前の回の形と時刻が変わらない */
  let prev = main,
    t = 0;
  for (let k = 1; k < Math.min(s.strokes, STROKES_MAX); k++) {
    const rk = mulberry(s.seed * 104729 + k * 31 + 7);
    t += Math.min(GAP_MAX, Math.max(GAP_MIN, s.gap * Math.exp(GAP_SD * normal(rk))));
    /* 前の回の雲の中（雲の底から先）の、後ろ 7 割のどこかで分かれる */
    const n = prev.length / 3,
      i = Math.min(n - 1, Math.floor(nt + (n - nt) * (0.3 + 0.7 * rk()))),
      o: V3 = [prev[3 * i], prev[3 * i + 1], prev[3 * i + 2]],
      /* 落雷点から見て外へ、±80° の向き */
      th = Math.atan2(o[1], o[0]) + ((rk() - 0.5) * 160 * Math.PI) / 180,
      g: V3 = [Math.cos(th), Math.sin(th), 0],
      q = walk(rk, s, o, g, g, (_, len) => len >= s.grow, CLOUD_WANDER).slice(3),
      p = [...prev.slice(0, 3 * (i + 1)), ...q];
    out.push(mk(p, s.e * s.eSub, 0, t));
    prev = p;
  }
  return out;
}

/** 放電の時刻 [s] の一覧（最初が 0） */
export const strokeTimes = (bs: readonly Branch[]): number[] => [
  ...new Set(bs.filter((b) => b.k === 0).map((b) => b.t)),
];

/** 折れ線の長さ [m] */
export function branchLength(p: Float64Array): number {
  let L = 0;
  for (let i = 3; i < p.length; i += 3) L += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
  return L;
}

/** 隣り合う区間の向きの変化 [度] の一覧 */
export function turnAngles(p: Float64Array): number[] {
  const out: number[] = [];
  for (let i = 6; i < p.length; i += 3) {
    const a = norm([p[i - 3] - p[i - 6], p[i - 2] - p[i - 5], p[i - 1] - p[i - 4]]),
      b = norm([p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]]);
    if (Number.isFinite(a[0]) && Number.isFinite(b[0])) out.push((angle(a, b) * 180) / Math.PI);
  }
  return out;
}

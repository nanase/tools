/**
 * 雷鳴のページの放電路（DOM に依存しない）: 乱数で曲がりくねった折れ線を作る。
 * 地面の落雷点から雲の底まで上がり、雲の中を横に進む本流と、本流から下へ伸びる枝。
 * 座標は落雷点を原点、z を上、聞き手は +x の向き
 */
import { mulberry, normal } from '../kalman/kf';

export type V3 = [number, number, number];

/** 折れ線 1 本 */
export interface Branch {
  /** 大きな曲がり（区間）の頂点 x, y, z [m] を 3 つずつ */
  p: Float64Array;
  /** 区間の中の細かい曲がりまで入れた頂点（f の fi[k] 番目の頂点が p の k 番目の頂点） */
  f: Float64Array;
  fi: Uint32Array;
  /** 単位長さあたりのエネルギー [J/m] */
  e: number;
  /** 本流は 0、枝は 1 */
  k: 0 | 1;
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
  /** 区間の長さの下限と上限 [m]（この間で対数一様） */
  lmin: number;
  lmax: number;
  /** 隣り合う区間の向きの変化の平均 [度] */
  turn: number;
  /** 区間の中の細かい曲がり: 小区間の長さの下限と上限 [m]、区間の向きからのずれの平均 [度]（0 で入れない） */
  mmin: number;
  mmax: number;
  mturn: number;
  /** 枝の数 */
  branches: number;
  /** 本流の単位長さあたりのエネルギー [J/m] */
  e: number;
  /** 枝のエネルギーの本流に対する比 */
  eBranch: number;
}

/** 既定（仮）: 区間 5〜70 m・向きの変化の平均 16°（Hill 1968） */
export const CH0: ChannelSet = {
  seed: 1,
  base: 2000,
  cloud: 3000,
  az: 90,
  lmin: 5,
  lmax: 70,
  turn: 16,
  mmin: 0.5,
  mmax: 5,
  mturn: 0,
  branches: 4,
  e: 5e5,
  eBranch: 0.3,
};

/** 向きがこれより目標から離れたら、曲がる向きを目標の側へ折り返す [度] */
const WANDER = 35;

const norm = (v: V3): V3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a: V3, b: V3) => Math.acos(Math.min(1, Math.max(-1, dot(a, b))));

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
 * done(点, 進んだ長さ) が真になったら止める
 */
function walk(
  r: () => number,
  s: ChannelSet,
  from: V3,
  d0: V3,
  g: V3,
  done: (p: V3, len: number) => boolean,
): number[] {
  /* 半正規分布の平均は σ√(2/π) */
  const sig = ((s.turn * Math.PI) / 180) * Math.sqrt(Math.PI / 2),
    lr = Math.log(s.lmax / s.lmin),
    out = [...from];
  let p = from,
    d = norm(d0),
    len = 0;
  for (let n = 0; n < 100000 && !done(p, len); n++) {
    const th = Math.abs(normal(r)) * sig;
    let ph = 2 * Math.PI * r(),
      nd = tilt(d, th, ph);
    if (angle(d, g) * (180 / Math.PI) > WANDER && angle(nd, g) > angle(d, g)) {
      ph += Math.PI;
      nd = tilt(d, th, ph);
    }
    d = nd;
    const l = s.lmin * Math.exp(lr * r());
    p = [p[0] + l * d[0], p[1] + l * d[1], p[2] + l * d[2]];
    /* 地面より下へは行かない */
    if (p[2] < 0) p[2] = 0;
    out.push(...p);
    len += l;
  }
  return out;
}

/**
 * 区間の中に細かい曲がりを入れる。小区間の向きは区間の向きから平均 mturn の角度だけずらし（前の小区間には依らない）、
 * たどり着く点のずれを長さに比例して配り直して、区間の終わりの頂点に戻す
 */
function meso(r: () => number, s: ChannelSet, p: Float64Array): { f: Float64Array; fi: Uint32Array } {
  const nv = p.length / 3,
    fi = new Uint32Array(nv);
  if (s.mturn <= 0) return { f: p.slice(), fi: fi.map((_, i) => i) };
  const sig = ((s.mturn * Math.PI) / 180) * Math.sqrt(Math.PI / 2),
    lr = Math.log(s.mmax / s.mmin),
    out: number[] = [p[0], p[1], p[2]];
  for (let k = 1; k < nv; k++) {
    const a: V3 = [p[3 * k - 3], p[3 * k - 2], p[3 * k - 1]],
      b: V3 = [p[3 * k], p[3 * k + 1], p[3 * k + 2]],
      L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]),
      pts: V3[] = [],
      acc: number[] = [];
    let q = a,
      along = 0,
      len = 0;
    /* 区間の向きに沿って L だけ進むまで */
    while (along < L - 1e-9) {
      const l = Math.min(s.mmin * Math.exp(lr * r()), L - along),
        e = tilt(d, Math.abs(normal(r)) * sig, 2 * Math.PI * r());
      q = [q[0] + l * e[0], q[1] + l * e[1], q[2] + l * e[2]];
      along += l * dot(e, d);
      len += l;
      pts.push(q);
      acc.push(len);
    }
    const ex = [b[0] - q[0], b[1] - q[1], b[2] - q[2]];
    pts.forEach((v, i) => {
      const w = acc[i] / len;
      out.push(v[0] + w * ex[0], v[1] + w * ex[1], Math.max(0, v[2] + w * ex[2]));
    });
    fi[k] = out.length / 3 - 1;
  }
  return { f: Float64Array.from(out), fi };
}

/** 放電路を作る。同じ設定と種なら同じ形 */
export function makeChannel(s: ChannelSet): Branch[] {
  const r = mulberry(s.seed * 7919 + 13),
    up: V3 = [0, 0, 1],
    a = (s.az * Math.PI) / 180,
    side: V3 = [Math.cos(a), Math.sin(a), 0];
  const trunk = walk(r, s, [0, 0, 0], up, up, (p) => p[2] >= s.base);
  const top = trunk.slice(-3) as V3,
    cloud = walk(r, s, top, norm([side[0], side[1], 0.3]), side, (_, len) => len >= s.cloud).slice(3);
  const main = [...trunk, ...cloud],
    rm = mulberry(s.seed * 104729 + 7),
    mk = (q: number[], e: number, k: 0 | 1): Branch => {
      const p = Float64Array.from(q);
      return { p, ...meso(rm, s, p), e, k };
    },
    out: Branch[] = [mk(main, s.e, 0)],
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
    out.push(mk(p, s.e * s.eBranch, 1));
  }
  return out;
}

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

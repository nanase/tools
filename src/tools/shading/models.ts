/**
 * 反射モデル: Lambert・Phong・Blinn-Phong・GGX。シェーダ（shader.ts）と同じ式を CPU でも持ち、ローブと反射率に使う。
 * GGX の部品は lib/brdf.ts を使う。ベクトルは局所座標（z が法線、V・L は面から外向き）
 */
import { dGGX, dot3, fSchlick, g1Smith, g2Smith, lum, norm3, sampleVndf, type Vec3 } from '../../lib/brdf';

export const MODELS = [
  { id: 'lambert', name: 'Lambert', color: '--sh-l' },
  { id: 'phong', name: 'Phong', color: '--sh-p' },
  { id: 'blinn', name: 'Blinn-Phong', color: '--sh-b' },
  { id: 'ggx', name: 'GGX', color: '--sh-g' },
] as const;
export type ModelId = (typeof MODELS)[number]['id'];
/** シェーダの uModel の番号 */
export const MODEL_NO: Record<ModelId, number> = { lambert: 0, phong: 1, blinn: 2, ggx: 3 };

/** 粗さの下限（ローブが鋭すぎて画素に入らなくなる手前） */
export const MIN_ROUGH = 0.05;
/** 正規化しない Phong・Blinn-Phong の非金属の鏡面反射の係数 */
export const CLASSIC_KS = 0.5;
/** 正規化しない式の N·L の下限（割り算が発散しないように） */
export const MIN_NOL = 0.02;

/** 入力で決まる材質と式の設定 */
export interface ShadeInput {
  /** 拡散の色、金属なら F0（線形） */
  base: Vec3;
  /** メタリック */
  metal: number;
  /** 非金属の垂直入射の反射率 */
  f0: number;
  /** 粗さ（α = r²） */
  rough: number;
  /** Phong・Blinn-Phong を正規化する */
  norm: boolean;
  /** Phong の指数を Blinn-Phong の 1/4 にそろえる */
  quarter: boolean;
  /** GGX の多重散乱を補う */
  ms: boolean;
}

export interface Shade extends ShadeInput {
  a: number;
  nP: number;
  nB: number;
  F0: Vec3;
  /** Phong・Blinn-Phong の鏡面の係数 */
  ks: Vec3;
  /** GGX の E と平均（多重散乱の補正用） */
  lut: LutSet;
}

const mix3 = (a: number, b: Vec3, t: number): Vec3 => [a + (b[0] - a) * t, a + (b[1] - a) * t, a + (b[2] - a) * t];

export function blinnExp(a: number): number {
  return Math.max(2 / (a * a) - 2, 0);
}

export function makeShade(s: ShadeInput, lut: LutSet): Shade {
  const a = Math.max(s.rough, MIN_ROUGH) ** 2,
    nB = blinnExp(a);
  return {
    ...s,
    a,
    nB,
    nP: s.quarter ? nB / 4 : nB,
    F0: mix3(s.f0, s.base, s.metal),
    ks: s.norm ? mix3(s.f0, s.base, s.metal) : mix3(CLASSIC_KS, s.base, s.metal),
    lut,
  };
}

/** 拡散の BRDF × π（Lambert だけは金属でも色をそのまま拡散に使う） */
export function diffuseAlbedo(id: ModelId, s: Pick<ShadeInput, 'base' | 'metal'>): Vec3 {
  const k = id === 'lambert' ? 1 : 1 - s.metal;
  return [s.base[0] * k, s.base[1] * k, s.base[2] * k];
}

export function phongSpec(s: Pick<Shade, 'nP' | 'norm'>, rov: number, nol: number): number {
  const p = rov > 0 ? rov ** s.nP : 0;
  return s.norm ? ((s.nP + 2) / (2 * Math.PI)) * p : p / (Math.PI * Math.max(nol, MIN_NOL));
}

export function blinnSpec(s: Pick<Shade, 'nB' | 'norm'>, noh: number, nol: number): number {
  const p = Math.max(noh, 0) ** s.nB;
  return s.norm ? ((s.nB + 8) / (8 * Math.PI)) * p : p / (Math.PI * Math.max(nol, MIN_NOL));
}

/* ---------- 多重散乱（Kulla & Conty 2017） ---------- */

/** F0 のフレネルの半球平均（Schlick の式を積分した値） */
export function fresnelAvg(f0: number): number {
  return f0 + (1 - f0) / 21;
}

/** 多重散乱の色の係数 */
export function fresnelMs(f0: number, eAvg: number): number {
  const f = fresnelAvg(f0);
  return (f * f * eAvg) / (1 - f * (1 - eAvg));
}

/** 多重散乱の BRDF の角度の部分（色の係数を除く） */
export function fmsAngular(eo: number, ei: number, eAvg: number): number {
  return ((1 - eo) * (1 - ei)) / (Math.PI * Math.max(1 - eAvg, 1e-4));
}

/** 鏡面の BRDF */
export function specular(id: ModelId, s: Shade, V: Vec3, L: Vec3): Vec3 {
  if (L[2] <= 0 || V[2] <= 0 || id === 'lambert') return [0, 0, 0];
  const H = norm3([V[0] + L[0], V[1] + L[1], V[2] + L[2]]),
    nol = L[2],
    nov = V[2];
  if (id === 'ggx') {
    const g = (dGGX(s.a, H[2]) * g2Smith(s.a, nov, nol)) / (4 * nov * nol),
      F = fSchlick(s.F0, dot3(V, H)),
      out: [number, number, number] = [F[0] * g, F[1] * g, F[2] * g];
    if (s.ms) {
      const c = lutAt(s.lut.ggx, nov, s.rough),
        d = lutAt(s.lut.ggx, nol, s.rough),
        k = fmsAngular(c[0] + c[1], d[0] + d[1], c[2]);
      for (let i = 0; i < 3; i++) out[i] += fresnelMs(s.F0[i], c[2]) * k;
    }
    return out;
  }
  const rov = 2 * nol * nov - dot3(L, V),
    v = id === 'phong' ? phongSpec(s, rov, nol) : blinnSpec(s, H[2], nol);
  return [s.ks[0] * v, s.ks[1] * v, s.ks[2] * v];
}

/** BRDF 全体 */
export function brdf(id: ModelId, s: Shade, V: Vec3, L: Vec3): Vec3 {
  if (L[2] <= 0 || V[2] <= 0) return [0, 0, 0];
  const d = diffuseAlbedo(id, s),
    f = specular(id, s, V, L);
  return [d[0] / Math.PI + f[0], d[1] / Math.PI + f[1], d[2] / Math.PI + f[2]];
}

/* ---------- 半球の積分 ---------- */

/** Hammersley の点列の 2 つ目の座標（0〜1） */
function radical(i: number): number {
  let b = i,
    r = 0,
    f = 0.5;
  while (b > 0) {
    r += f * (b & 1);
    b >>= 1;
    f *= 0.5;
  }
  return r;
}

const reflectAbout = (W: Vec3, H: Vec3): Vec3 => {
  const d = 2 * dot3(W, H);
  return [d * H[0] - W[0], d * H[1] - W[1], d * H[2] - W[2]];
};

/** 軸のまわりの cos^n の方向（軸は単位ベクトル） */
function samplePower(axis: Vec3, n: number, u1: number, u2: number): Vec3 {
  const z = u1 ** (1 / (n + 1)),
    s = Math.sqrt(Math.max(0, 1 - z * z)),
    p = 2 * Math.PI * u2,
    t: Vec3 = Math.abs(axis[2]) < 0.999 ? [0, 0, 1] : [1, 0, 0],
    x = norm3([t[1] * axis[2] - t[2] * axis[1], t[2] * axis[0] - t[0] * axis[2], t[0] * axis[1] - t[1] * axis[0]]),
    y: Vec3 = [axis[1] * x[2] - axis[2] * x[1], axis[2] * x[0] - axis[0] * x[2], axis[0] * x[1] - axis[1] * x[0]];
  const a = s * Math.cos(p),
    b = s * Math.sin(p);
  return [a * x[0] + b * y[0] + z * axis[0], a * x[1] + b * y[1] + z * axis[1], a * x[2] + b * y[2] + z * axis[2]];
}

export interface LobeCfg {
  a: number;
  nP: number;
  nB: number;
  norm: boolean;
}

/**
 * 鏡面のローブの半球積分。W は固定した方向の余弦で、もう一方の方向で積分する。戻り値は [A, B]（F0·A + B が F0 の色の分）。
 * Phong・Blinn-Phong はフレネルがないので B = 0、係数 ks を掛ける前の値。
 * 正規化しない式は相反しないので、光を固定する（fixedLight）か視線を固定するかで値が変わる
 */
export function lobeIntegral(
  id: 'phong' | 'blinn' | 'ggx',
  c: LobeCfg,
  mu: number,
  n = 256,
  fixedLight = false,
): [number, number] {
  const m = Math.max(mu, 1e-3),
    W: Vec3 = [Math.sqrt(Math.max(0, 1 - m * m)), 0, m];
  let A = 0,
    B = 0;
  for (let i = 0; i < n; i++) {
    const u1 = (i + 0.5) / n,
      u2 = radical(i);
    if (id === 'ggx') {
      const H = sampleVndf(W, c.a, u1, u2),
        O = reflectAbout(W, H);
      if (O[2] <= 0) continue;
      const w = g2Smith(c.a, m, O[2]) / g1Smith(c.a, m),
        q = Math.min(1, Math.max(0, 1 - dot3(W, H))),
        k = q * q * q * q * q;
      A += (1 - k) * w;
      B += k * w;
    } else if (id === 'phong') {
      const O = samplePower([-W[0], 0, W[2]], c.nP, u1, u2);
      if (O[2] <= 0) continue;
      A += c.norm
        ? ((c.nP + 2) / (c.nP + 1)) * O[2]
        : (2 / (c.nP + 1)) * (fixedLight ? O[2] / Math.max(m, MIN_NOL) : 1);
    } else {
      const H = samplePower([0, 0, 1], c.nB, u1, u2),
        O = reflectAbout(W, H);
      if (O[2] <= 0) continue;
      const voh = Math.max(dot3(W, H), 0);
      A += c.norm
        ? ((c.nB + 8) / (c.nB + 1)) * O[2] * voh
        : ((8 * voh) / (c.nB + 1)) * (fixedLight ? O[2] / Math.max(m, MIN_NOL) : 1);
    }
  }
  return [A / n, B / n];
}

/* ---------- 表（μ・粗さ） ---------- */

/** 表の 1 辺の数 */
export const LUT_N = 32;

/** RGBA の表。R = A、G = B、B = 同じ粗さの E の平均（F0 = 1） */
export type Lut = Float32Array;
export interface LutSet {
  phong: Lut;
  blinn: Lut;
  ggx: Lut;
}

export const lutRough = (j: number): number => MIN_ROUGH + ((j + 0.5) / LUT_N) * (1 - MIN_ROUGH);

export function buildLut(id: 'phong' | 'blinn' | 'ggx', quarter: boolean, norm: boolean, n = 128): Lut {
  const t = new Float32Array(LUT_N * LUT_N * 4);
  for (let j = 0; j < LUT_N; j++) {
    const a = lutRough(j) ** 2,
      nB = blinnExp(a),
      c: LobeCfg = { a, nB, nP: quarter ? nB / 4 : nB, norm };
    let avg = 0;
    for (let i = 0; i < LUT_N; i++) {
      const mu = (i + 0.5) / LUT_N,
        [A, B] = lobeIntegral(id, c, mu, n),
        p = (j * LUT_N + i) * 4;
      t[p] = A;
      t[p + 1] = B;
      avg += (A + B) * mu;
    }
    avg *= 2 / LUT_N;
    for (let i = 0; i < LUT_N; i++) t[(j * LUT_N + i) * 4 + 2] = avg;
  }
  return t;
}

export function buildLuts(quarter: boolean, norm: boolean, prev?: LutSet): LutSet {
  return {
    phong: buildLut('phong', quarter, norm),
    blinn: buildLut('blinn', quarter, norm),
    ggx: prev?.ggx ?? buildLut('ggx', quarter, norm),
  };
}

/** 表を双線形で読む（シェーダのテクスチャと同じ読み方）。戻り値は [A, B, E の平均] */
export function lutAt(t: Lut, mu: number, rough: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, mu)) * LUT_N - 0.5,
    v = Math.min(1, Math.max(0, (rough - MIN_ROUGH) / (1 - MIN_ROUGH))) * LUT_N - 0.5,
    i0 = Math.max(0, Math.floor(u)),
    j0 = Math.max(0, Math.floor(v)),
    i1 = Math.min(LUT_N - 1, i0 + 1),
    j1 = Math.min(LUT_N - 1, j0 + 1),
    fu = Math.min(1, Math.max(0, u - i0)),
    fv = Math.min(1, Math.max(0, v - j0));
  const at = (c: number): number => {
    const q = (i: number, j: number): number => t[(j * LUT_N + i) * 4 + c];
    return (q(i0, j0) * (1 - fu) + q(i1, j0) * fu) * (1 - fv) + (q(i0, j1) * (1 - fu) + q(i1, j1) * fu) * fv;
  };
  return [at(0), at(1), at(2)];
}

/** 反射率: 光が余弦 mu で入るときに、面が返す光の割合（輝度） */
export function reflectance(id: ModelId, s: Shade, mu: number): number {
  const d = lum(diffuseAlbedo(id, s));
  if (id === 'lambert') return d;
  const [A, B] = lobeIntegral(id, { a: s.a, nP: s.nP, nB: s.nB, norm: s.norm }, mu, 1024, true);
  if (id !== 'ggx') return d + lum(s.ks) * A;
  const f: [number, number, number] = [s.F0[0] * A + B, s.F0[1] * A + B, s.F0[2] * A + B];
  if (s.ms) {
    const c = lutAt(s.lut.ggx, mu, s.rough),
      e = c[0] + c[1];
    for (let i = 0; i < 3; i++) f[i] += fresnelMs(s.F0[i], c[2]) * (1 - e);
  }
  return d + lum(f);
}

/** ファーネステストでの半球平均（F0 = 1 で拡散なし、Lambert は ρ = 1）。1 なら光を失わない */
export function furnaceAvg(id: ModelId, lut: LutSet, rough: number, ms: boolean): number {
  if (id === 'lambert') return 1;
  const c = lutAt(lut[id], 1, rough);
  if (id === 'ggx' && ms) return 1;
  return c[2];
}

/** 入射面での BRDF の輝度（ローブ）。psi は法線からの角度（光と同じ側が負） */
export function lobeValue(id: ModelId, s: Shade, thetaI: number, psi: number): number {
  const L: Vec3 = [-Math.sin(thetaI), 0, Math.cos(thetaI)],
    V: Vec3 = [Math.sin(psi), 0, Math.cos(psi)];
  return lum(brdf(id, s, V, L));
}

/** 3 次元のローブなどに使う、任意の向きの BRDF の輝度 */
export function lobeValueAt(id: ModelId, s: Shade, L: Vec3, V: Vec3): number {
  return lum(brdf(id, s, V, L));
}

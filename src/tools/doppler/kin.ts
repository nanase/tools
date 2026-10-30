/**
 * 直線を等速で動く音源と聞き手の運動学（DOM に依存しない）。グラフと図の計算に使う。
 * 聞き手が時刻 t に聞く音は、音源が時刻 τ に出した音で、|L(t) − S(τ)| = c (t − τ) を満たす（放射時刻）。
 * 音源が音速より遅ければ τ は 1 つ、速ければ 0 か 2 つ（マッハコーンの内側で 2 つ）
 */

export interface Vec {
  x: number;
  y: number;
  z: number;
}
export const vec = (x: number, y: number, z = 0): Vec => ({ x, y, z });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;

/** 放射時刻の 1 つ */
export interface Emission {
  /** 遅れ t − τ [s]（音が進む時間） */
  delay: number;
  /** 放射した位置から聞き手までの距離 [m] */
  r: number;
  /** 聞き手の向きの音源のマッハ数 M_r = n·V/c（n は放射した位置から聞き手への向き） */
  mr: number;
  /** 聞こえる周波数の比 f/f₀ = dτ/dt = (c − n·U)/(c − n·V)。負は時間が逆に進む（音源が音速より速いとき） */
  ratio: number;
}

/**
 * 時刻 t の音源の位置 S・速度 V、聞き手の位置 L・速度 U から、いま聞こえる音の放射時刻をすべて求める（遅れの小さい順）。
 * B = L − S(t) として、遅れ δ は (c² − V²) δ² − 2 (B·V) δ − B² = 0 の正の解
 */
export function emissions(S: Vec, V: Vec, L: Vec, U: Vec, c: number): Emission[] {
  const B = vec(L.x - S.x, L.y - S.y, L.z - S.z),
    a = c * c - dot(V, V),
    b = dot(B, V),
    bb = dot(B, B),
    out: Emission[] = [],
    add = (d: number) => {
      if (!(d > 0)) return;
      /* 放射した位置 S − V δ から聞き手への向き */
      const nx = B.x + V.x * d,
        ny = B.y + V.y * d,
        nz = B.z + V.z * d,
        r = Math.hypot(nx, ny, nz),
        nV = (nx * V.x + ny * V.y + nz * V.z) / r,
        nU = (nx * U.x + ny * U.y + nz * U.z) / r;
      out.push({ delay: d, r, mr: nV / c, ratio: (c - nU) / (c - nV) });
    };
  if (Math.abs(a) < 1e-9 * c * c) {
    /* 音速ちょうど: −2 b δ − B² = 0 */
    if (b < 0) add(-bb / (2 * b));
    return out;
  }
  const disc = b * b + a * bb;
  if (disc < 0) return out;
  const q = Math.sqrt(disc);
  if (a > 0) add((b + q) / a);
  else {
    add((b + q) / a);
    add((b - q) / a);
  }
  return out.sort((p, q) => p.delay - q.delay);
}

/** マッハコーンの半頂角 [rad]: sin μ = 1/M（M ≤ 1 ではコーンにならないので NaN） */
export const machAngle = (m: number): number => (m > 1 ? Math.asin(1 / m) : Number.NaN);

/** 止まった聞き手で、近づくとき・遠ざかるときの周波数の比 1/(1 ∓ M)（音源が真っすぐ向かってくるとき） */
export const ratioHeadOn = (m: number): { toward: number; away: number } => ({
  toward: 1 / (1 - m),
  away: 1 / (1 + m),
});

/**
 * 動く単極音源の音圧の振幅の倍率: 止まっているときの r₀/r に、1/(1 − M_r)² を掛ける（単極音源の遠方の音場）。
 * 1 − M_r が 0 に近い所（マッハコーンの上）は無限大になるので、|1 − M_r| を eps で下から抑える
 */
export const DOPPLER_EPS = 0.1;
export function ampFactor(r: number, mr: number, r0 = 1, rMin = 1, eps = DOPPLER_EPS): number {
  const k = 1 - mr,
    m = Math.max(eps, Math.abs(k));
  return ((Math.sign(k) || 1) * r0) / (Math.max(rMin, r) * m * m);
}

/** すれ違い: 道路（x 軸）を速さ v で進む音源が、時刻 0 に x = 0 を通る。聞き手は (0, d) に止まっている */
export interface Pass {
  /** 音源の速さ [m/s] */
  v: number;
  /** 道路から聞き手までの距離 [m] */
  d: number;
  /** 音速 [m/s] */
  c: number;
  /** 音源と聞き手の高さ [m] */
  hs?: number;
  hl?: number;
  /** 聞き手の速さ [m/s]（x の向き） */
  u?: number;
}

/** すれ違いで、聞き手の時刻 t [s] に聞こえる音（直接音）の放射時刻 */
export function passAt(p: Pass, t: number): Emission[] {
  const u = p.u ?? 0;
  return emissions(vec(p.v * t, 0, p.hs ?? 0), vec(p.v, 0, 0), vec(u * t, p.d, p.hl ?? 0), vec(u, 0, 0), p.c);
}

/** 止まった聞き手が聞く周波数の比の、遠くから近づくときと遠ざかるときの極限（すれ違いの曲線の両端） */
export const passLimits = (p: Pass): { before: number; after: number } => ({
  before: 1 / (1 - p.v / p.c),
  after: 1 / (1 + p.v / p.c),
});

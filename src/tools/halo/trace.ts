/**
 * 氷晶のハロの光線追跡（CPU の参照の実装）。太陽から出た光線を、向きを分布から引いた六角柱の氷晶に通し、
 * 出ていく向きを空の全天図（等立体角の円盤 2 枚）に足す。GPU 版はこれと同じ手順で、bun test で照らし合わせる
 *
 * 座標: 世界は z が天頂、太陽は方位 0（+x）。結晶は c 軸が z、側面の法線が 0°・60°・…・300°
 */

/** 姿勢の種類: ランダム・板（c 軸が鉛直）・柱（c 軸が水平）・Parry（柱で、側面 2 枚が水平）・Lowitz（板が長い対角線のまわりに傾く） */
export type Orient = 'random' | 'plate' | 'column' | 'parry' | 'lowitz';

/** 結晶の母集団 */
export interface Population {
  orient: Orient;
  /** c/a: 柱の長さ ÷ 六角形の頂点間の径 */
  ca: number;
  /** 傾きの標準偏差 [°]（板・Lowitz は c 軸と鉛直、柱・Parry は c 軸と水平のなす角） */
  tilt: number;
  /** c 軸まわりの回転の標準偏差 [°]（Parry）、長い対角線のまわりの回転の標準偏差 [°]（Lowitz） */
  rot: number;
  /** 割合（表面積をそろえた結晶の数の比） */
  w: number;
  /** 結晶の径 [µm]（回折の広がり）。0 は回折を入れない */
  d: number;
}

/** 屈折率: Warren & Brandt (2008) の表に当てはめた 3 項の Cauchy の式（λ は nm） */
export function nIce(nm: number): number {
  const l2 = (nm / 1000) ** 2;
  return 1.299589 + 0.0037589 / l2 - 0.00009708 / (l2 * l2);
}

/** 偏光を平均した Fresnel の反射率。cosI は入射角の余弦、eta は入射側 ÷ 透過側の屈折率。全反射は 1 */
export function fresnel(cosI: number, eta: number): number {
  const s2 = eta * eta * (1 - cosI * cosI);
  if (s2 >= 1) return 1;
  const cosT = Math.sqrt(1 - s2),
    rs = (eta * cosI - cosT) / (eta * cosI + cosT),
    rp = (eta * cosT - cosI) / (eta * cosT + cosI);
  return 0.5 * (rs * rs + rp * rp);
}

/** 乱数（xorshift128+ の 32 bit 版。再現できるように種を与える） */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  constructor(seed = 1) {
    this.a = seed | 0 || 1;
    this.b = 0x9e3779b9;
    this.c = 0x243f6a88;
    this.d = 0xb7e15162;
    for (let i = 0; i < 16; i++) this.next();
  }
  /** [0, 1) */
  next(): number {
    let t = this.d;
    const s = this.a;
    this.d = this.c;
    this.c = this.b;
    this.b = s;
    t ^= t << 11;
    t ^= t >>> 8;
    this.a = t ^ s ^ (s >>> 19);
    return (this.a >>> 0) / 4294967296;
  }
  /** 標準正規分布 */
  gauss(): number {
    const u = 1 - this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
}

/** 結晶の形: 凸多面体を平面（外向きの単位法線と原点からの距離）の集まりで表す。面番号は atoptics の流儀 */
export interface Crystal {
  /** 法線 [nx, ny, nz] × 面の数 */
  n: Float64Array;
  /** 原点からの距離 */
  h: Float64Array;
  /** 面番号（1・2 が底面、3〜8 が側面） */
  id: Int8Array;
  /** 外接球の半径 */
  rb: number;
  /** 表面積 */
  area: number;
}

/** 六角柱。頂点の半径を 1 にとり、長さを 2 × c/a、表面積を 1 にそろえる */
export function prism(ca: number): Crystal {
  const r = 1,
    a = (r * Math.sqrt(3)) / 2,
    hz = ca * r * 2 * 0.5,
    area = 2 * ((3 * Math.sqrt(3)) / 2) * r * r + 6 * r * 2 * hz,
    s = 1 / Math.sqrt(area),
    n = new Float64Array(24),
    h = new Float64Array(8),
    id = new Int8Array(8);
  n.set([0, 0, 1, 0, 0, -1], 0);
  h[0] = h[1] = hz * s;
  id[0] = 1;
  id[1] = 2;
  for (let k = 0; k < 6; k++) {
    const t = (k * Math.PI) / 3;
    n.set([Math.cos(t), Math.sin(t), 0], 6 + 3 * k);
    h[2 + k] = a * s;
    id[2 + k] = 3 + k;
  }
  return { n, h, id, rb: Math.hypot(r, hz) * s, area: 1 };
}

/** 3×3 の回転行列（行優先）。結晶の座標 → 世界の座標 */
export type Mat = Float64Array;

function rz(t: number): number[] {
  const c = Math.cos(t),
    s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function ry(t: number): number[] {
  const c = Math.cos(t),
    s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function rx(t: number): number[] {
  const c = Math.cos(t),
    s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function mul(A: ArrayLike<number>, B: ArrayLike<number>): number[] {
  const C = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  return C;
}

const D2R = Math.PI / 180;

/**
 * 姿勢を引く。傾きは球面の上の 2 次元のガウス分布（天頂角の密度に sinθ を含む）、柱の高さ角は 1 次元のガウス分布
 */
export function orient(p: Population, g: Rng, out: Mat): void {
  const tw = 2 * Math.PI;
  let M: number[];
  switch (p.orient) {
    case 'random': {
      /* 一様な回転（Shoemake の四元数） */
      const u1 = g.next(),
        u2 = tw * g.next(),
        u3 = tw * g.next(),
        a = Math.sqrt(1 - u1),
        b = Math.sqrt(u1),
        x = a * Math.sin(u2),
        y = a * Math.cos(u2),
        z = b * Math.sin(u3),
        w = b * Math.cos(u3);
      M = [
        1 - 2 * (y * y + z * z),
        2 * (x * y - z * w),
        2 * (x * z + y * w),
        2 * (x * y + z * w),
        1 - 2 * (x * x + z * z),
        2 * (y * z - x * w),
        2 * (x * z - y * w),
        2 * (y * z + x * w),
        1 - 2 * (x * x + y * y),
      ];
      break;
    }
    case 'plate': {
      const th = p.tilt * D2R * Math.sqrt(-2 * Math.log(1 - g.next()));
      M = mul(mul(rz(tw * g.next()), rx(Math.min(th, Math.PI / 2))), rz(tw * g.next()));
      break;
    }
    case 'column':
    case 'parry': {
      const el = p.tilt * D2R * g.gauss(),
        psi = p.orient === 'parry' ? p.rot * D2R * g.gauss() : tw * g.next();
      M = mul(mul(mul(rz(tw * g.next()), ry(-el)), ry(Math.PI / 2)), rz(psi));
      break;
    }
    case 'lowitz': {
      /* 長い対角線（頂点を結ぶ線、結晶の y 軸）のまわりに回し、c 軸の向きを少し揺らす */
      const al = p.rot >= 90 ? tw * g.next() : p.rot * D2R * g.gauss(),
        th = p.tilt * D2R * Math.sqrt(-2 * Math.log(1 - g.next())),
        ph = tw * g.next();
      M = mul(mul(rz(tw * g.next()), mul(rz(ph), mul(rx(th), rz(-ph)))), ry(al));
      break;
    }
  }
  out.set(M);
}

/** 1 本の光線の結果 */
export interface Hit {
  /** 出ていく向き（世界の座標） */
  x: number;
  y: number;
  z: number;
  /** 通った面の番号（入った面から順に。外での反射は 1 つだけ） */
  path: number[];
}

/** 結晶の中で反射してよい回数の上限 */
export const MAX_BOUNCE = 16;

/**
 * 光線 1 本を追う。d は入ってくる光の進む向き（世界の座標、単位ベクトル）。結晶に当たらなければ null。
 * 反射と屈折は Fresnel の確率で 1 つを選ぶ（ロシアンルーレット）
 */
export function traceRay(
  C: Crystal,
  M: Mat,
  dx: number,
  dy: number,
  dz: number,
  n: number,
  g: Rng,
  /** 与えると、通った点（結晶の座標）を入れる */
  pts?: number[],
): Hit | null {
  /* 結晶の座標へ（M の転置） */
  let x = M[0] * dx + M[3] * dy + M[6] * dz,
    y = M[1] * dx + M[4] * dy + M[7] * dz,
    z = M[2] * dx + M[5] * dy + M[8] * dz;
  /* 光線に垂直な円盤の上の一様な点から入れる（当たる確率が投影の面積に比例する） */
  const ax = Math.abs(x) < 0.9 ? 1 : 0,
    ay = 1 - ax;
  let ux = ay * z - 0 * y,
    uy = 0 * x - ax * z,
    uz = ax * y - ay * x;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = y * uz - z * uy,
    vy = z * ux - x * uz,
    vz = x * uy - y * ux,
    rr = C.rb * Math.sqrt(g.next()),
    ph = 2 * Math.PI * g.next(),
    cu = rr * Math.cos(ph),
    cv = rr * Math.sin(ph);
  let px = cu * ux + cv * vx - 2 * C.rb * x,
    py = cu * uy + cv * vy - 2 * C.rb * y,
    pz = cu * uz + cv * vz - 2 * C.rb * z;
  const N = C.n,
    H = C.h,
    nf = H.length;
  let t0 = -1e30,
    t1 = 1e30,
    f0 = -1;
  for (let i = 0; i < nf; i++) {
    const dn = N[3 * i] * x + N[3 * i + 1] * y + N[3 * i + 2] * z,
      num = H[i] - (N[3 * i] * px + N[3 * i + 1] * py + N[3 * i + 2] * pz);
    if (dn < 0) {
      const t = num / dn;
      if (t > t0) {
        t0 = t;
        f0 = i;
      }
    } else if (dn > 0) {
      const t = num / dn;
      if (t < t1) t1 = t;
    } else if (num < 0) return null;
  }
  if (f0 < 0 || t0 >= t1) return null;
  px += t0 * x;
  py += t0 * y;
  pz += t0 * z;
  pts?.push(px, py, pz);
  const path = [C.id[f0]];
  /* 入るところ: 外での反射か屈折 */
  {
    const nx = N[3 * f0],
      ny = N[3 * f0 + 1],
      nz = N[3 * f0 + 2],
      ci = -(nx * x + ny * y + nz * z),
      eta = 1 / n;
    if (g.next() < fresnel(ci, eta)) {
      x += 2 * ci * nx;
      y += 2 * ci * ny;
      z += 2 * ci * nz;
      return out(M, x, y, z, path);
    }
    const ct = Math.sqrt(1 - eta * eta * (1 - ci * ci)),
      k = eta * ci - ct;
    x = eta * x + k * nx;
    y = eta * y + k * ny;
    z = eta * z + k * nz;
  }
  let cur = f0;
  for (let b = 0; b <= MAX_BOUNCE; b++) {
    /* 出る面: 進む向きと法線の内積が正の面のうち、いちばん近いもの */
    let tm = 1e30,
      fm = -1;
    for (let i = 0; i < nf; i++) {
      if (i === cur) continue;
      const dn = N[3 * i] * x + N[3 * i + 1] * y + N[3 * i + 2] * z;
      if (dn <= 0) continue;
      const t = (H[i] - (N[3 * i] * px + N[3 * i + 1] * py + N[3 * i + 2] * pz)) / dn;
      if (t < tm) {
        tm = t;
        fm = i;
      }
    }
    if (fm < 0) return null;
    px += tm * x;
    py += tm * y;
    pz += tm * z;
    pts?.push(px, py, pz);
    cur = fm;
    path.push(C.id[fm]);
    const nx = N[3 * fm],
      ny = N[3 * fm + 1],
      nz = N[3 * fm + 2],
      ci = nx * x + ny * y + nz * z;
    if (g.next() >= fresnel(ci, n)) {
      const ct = Math.sqrt(1 - n * n * (1 - ci * ci)),
        k = ct - n * ci;
      return out(M, n * x + k * nx, n * y + k * ny, n * z + k * nz, path);
    }
    x -= 2 * ci * nx;
    y -= 2 * ci * ny;
    z -= 2 * ci * nz;
  }
  return null;
}

function out(M: Mat, x: number, y: number, z: number, path: number[]): Hit {
  return {
    x: M[0] * x + M[1] * y + M[2] * z,
    y: M[3] * x + M[4] * y + M[5] * z,
    z: M[6] * x + M[7] * y + M[8] * z,
    path,
  };
}

/** 光路の種類: 0 外での反射、1 60° のくさび（側面 → 1 つ置いた側面）、2 90° のくさび（底面と側面）、
 * 3 中で反射してから出た光、4 平行な面を素通り */
export function family(path: readonly number[]): number {
  if (path.length === 1) return 0;
  if (path.length > 2) return 3;
  const a = path[0],
    b = path[1],
    sa = a >= 3,
    sb = b >= 3;
  if (sa !== sb) return 2;
  if (!sa) return 4;
  const d = (b - a + 6) % 6;
  return d === 3 ? 4 : 1;
}

/** 太陽の視直径 [°] */
export const SUN_DIAM = 0.53;

/** 太陽の円盤の中の一様な点から来る光の進む向き（太陽の高度 elev [°]、方位 0） */
export function sunRay(elev: number, g: Rng): [number, number, number] {
  const e = elev * D2R,
    r = 0.5 * SUN_DIAM * D2R * Math.sqrt(g.next()),
    ph = 2 * Math.PI * g.next(),
    a = r * Math.cos(ph),
    b = r * Math.sin(ph),
    /* 太陽の向き s と、それに垂直な 2 本 */
    sx = Math.cos(e),
    sz = Math.sin(e),
    tx = -Math.sin(e),
    tz = Math.cos(e);
  const x = sx + a * tx,
    y = b,
    z = sz + a * tz,
    l = Math.hypot(x, y, z);
  return [-x / l, -y / l, -z / l];
}

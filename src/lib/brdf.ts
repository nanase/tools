/**
 * 表面の反射の共有部品: GGX の法線分布・Smith の遮蔽・Schlick のフレネル・GGX の重点的サンプリング・材質の表。
 * シェーダ用の GLSL と CPU 用の TS を同じ式で持つ。ベクトルは局所座標（z が法線、V・L は面から外向き）で渡す
 */

export type Vec3 = readonly [number, number, number];

/** 材質の種類（シェーダの kind と同じ番号） */
export const KIND = { SURFACE: 0, GLASS: 1, LIGHT: 2 } as const;

export interface Material {
  kind: number;
  /** 拡散の色、金属なら F0（線形） */
  base: Vec3;
  /** 0 非金属・1 金属 */
  metal: number;
  /** 知覚的な粗さ（α = rough²）。0 は鏡面 */
  rough: number;
  /** 非金属の鏡面反射の強さ。F0 = 0.08 × spec */
  spec: number;
  /** ガラスの屈折率 */
  ior: number;
  /** 光源の放射輝度 */
  emit: Vec3;
}

export function surface(base: Vec3, o: Partial<Material> = {}): Material {
  return { kind: KIND.SURFACE, base, metal: 0, rough: 1, spec: 0, ior: 1.5, emit: [0, 0, 0], ...o };
}

export function metal(f0: Vec3, rough: number): Material {
  return surface(f0, { metal: 1, rough });
}

export function glass(ior = 1.5, tint: Vec3 = [1, 1, 1]): Material {
  return { kind: KIND.GLASS, base: tint, metal: 0, rough: 0, spec: 0, ior, emit: [0, 0, 0] };
}

export function light(emit: Vec3): Material {
  return { kind: KIND.LIGHT, base: [0, 0, 0], metal: 0, rough: 1, spec: 0, ior: 1, emit };
}

/** 複素屈折率からの垂直入射の反射率 */
export function f0FromNk(n: number, k: number): number {
  return ((n - 1) ** 2 + k * k) / ((n + 1) ** 2 + k * k);
}

/** 金属の複素屈折率 [n, k]（波長 617・521・451 nm。Johnson & Christy 1972、refractiveindex.info の値） */
export const METAL_NK = {
  gold: [
    [0.21, 3.272],
    [0.62, 2.081],
    [1.38, 1.914],
  ],
  silver: [
    [0.06, 4.152],
    [0.05, 3.324],
    [0.04, 2.657],
  ],
  copper: [
    [0.3, 3.205],
    [1.18, 2.608],
    [1.24, 2.397],
  ],
} as const;

const metalF0 = (nk: readonly (readonly [number, number])[]): Vec3 => [
  f0FromNk(...nk[0]),
  f0FromNk(...nk[1]),
  f0FromNk(...nk[2]),
];

/** 金属の F0（線形の RGB） */
export const METALS = {
  gold: metalF0(METAL_NK.gold),
  silver: metalF0(METAL_NK.silver),
  copper: metalF0(METAL_NK.copper),
} as const satisfies Record<string, Vec3>;

/** α がこれより小さければ鏡面として扱う */
export const DELTA_ALPHA = 1e-3;

export const BRDF_GLSL = `
const float PI = 3.14159265358979;
const float DELTA_ALPHA = ${DELTA_ALPHA};

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 fSchlick(vec3 f0, float c) {
  float m = clamp(1.0 - c, 0.0, 1.0), m2 = m * m;
  return f0 + (1.0 - f0) * m2 * m2 * m;
}

/* 誘電体の厳密なフレネル（eta = 入射側 / 透過側、c = 入射角の余弦）。全反射は 1 */
float fDielectric(float c, float eta) {
  float s2 = eta * eta * (1.0 - c * c);
  if (s2 >= 1.0) return 1.0;
  float t = sqrt(1.0 - s2);
  float rs = (eta * c - t) / (eta * c + t), rp = (c - eta * t) / (c + eta * t);
  return 0.5 * (rs * rs + rp * rp);
}

float dGGX(float a, float noh) {
  float a2 = a * a, d = noh * noh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

float lambdaSmith(float a, float c) {
  float c2 = c * c;
  return 0.5 * (sqrt(1.0 + a * a * (1.0 - c2) / max(c2, 1e-8)) - 1.0);
}

float g1Smith(float a, float c) { return 1.0 / (1.0 + lambdaSmith(a, c)); }

float g2Smith(float a, float nov, float nol) {
  return 1.0 / (1.0 + lambdaSmith(a, nov) + lambdaSmith(a, nol));
}

/* 見える法線の分布からのサンプリング（球冠の形。V は局所座標） */
vec3 sampleVndf(vec3 V, float a, vec2 u) {
  vec3 Vh = normalize(vec3(a * V.x, a * V.y, V.z));
  float phi = 2.0 * PI * u.x, z = (1.0 - u.y) * (1.0 + Vh.z) - Vh.z;
  float s = sqrt(clamp(1.0 - z * z, 0.0, 1.0));
  vec3 H = vec3(s * cos(phi), s * sin(phi), z) + Vh;
  return normalize(vec3(a * H.x, a * H.y, max(H.z, 0.0)));
}

float pdfVndfRefl(vec3 V, vec3 H, float a) {
  return g1Smith(a, V.z) * dGGX(a, H.z) / (4.0 * max(V.z, 1e-6));
}

vec3 sampleCos(vec2 u) {
  float r = sqrt(u.x), phi = 2.0 * PI * u.y;
  return vec3(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
}

/* 表面の材質（a は α = rough²） */
struct Surf { vec3 base; float metal; float a; float spec; };

vec3 surfF0(Surf s) { return mix(vec3(0.08 * s.spec), s.base, s.metal); }

/* 鏡面の方を選ぶ確率 */
float surfPSpec(Surf s, float nov) {
  if (s.metal == 0.0 && s.spec == 0.0) return 0.0;
  float fr = lum(fSchlick(surfF0(s), nov));
  float di = (1.0 - s.metal) * lum(s.base);
  float t = fr + di;
  return t > 0.0 ? fr / t : 0.0;
}

/* BRDF の値。鏡面（α が小さい）の分は入れない */
vec3 surfEval(Surf s, vec3 V, vec3 L) {
  if (L.z <= 0.0 || V.z <= 0.0) return vec3(0.0);
  vec3 f = (1.0 - s.metal) * s.base / PI;
  if (s.a >= DELTA_ALPHA) {
    vec3 F0 = surfF0(s);
    if (dot(F0, F0) > 0.0) {
      vec3 H = normalize(V + L);
      f += fSchlick(F0, dot(V, H)) * dGGX(s.a, H.z) * g2Smith(s.a, V.z, L.z) / (4.0 * V.z * L.z);
    }
  }
  return f;
}

float surfPdf(Surf s, vec3 V, vec3 L) {
  if (L.z <= 0.0 || V.z <= 0.0) return 0.0;
  float ps = surfPSpec(s, V.z);
  float p = (1.0 - ps) * L.z / PI;
  if (s.a >= DELTA_ALPHA && ps > 0.0) p += ps * pdfVndfRefl(V, normalize(V + L), s.a);
  return p;
}
`;

/* ---------- CPU 用（GLSL と同じ式） ---------- */

const PI = Math.PI;

export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function lum(c: Vec3): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function fSchlick(f0: Vec3, c: number): Vec3 {
  const m = Math.min(1, Math.max(0, 1 - c)),
    k = m * m * m * m * m;
  return [f0[0] + (1 - f0[0]) * k, f0[1] + (1 - f0[1]) * k, f0[2] + (1 - f0[2]) * k];
}

export function fDielectric(c: number, eta: number): number {
  const s2 = eta * eta * (1 - c * c);
  if (s2 >= 1) return 1;
  const t = Math.sqrt(1 - s2),
    rs = (eta * c - t) / (eta * c + t),
    rp = (c - eta * t) / (c + eta * t);
  return 0.5 * (rs * rs + rp * rp);
}

export function dGGX(a: number, noh: number): number {
  const a2 = a * a,
    d = noh * noh * (a2 - 1) + 1;
  return a2 / (PI * d * d);
}

export function lambdaSmith(a: number, c: number): number {
  const c2 = c * c;
  return 0.5 * (Math.sqrt(1 + (a * a * (1 - c2)) / Math.max(c2, 1e-8)) - 1);
}

export function g1Smith(a: number, c: number): number {
  return 1 / (1 + lambdaSmith(a, c));
}

export function g2Smith(a: number, nov: number, nol: number): number {
  return 1 / (1 + lambdaSmith(a, nov) + lambdaSmith(a, nol));
}

export function sampleVndf(V: Vec3, a: number, ux: number, uy: number): Vec3 {
  const Vh = norm3([a * V[0], a * V[1], V[2]]),
    phi = 2 * PI * ux,
    z = (1 - uy) * (1 + Vh[2]) - Vh[2],
    s = Math.sqrt(Math.min(1, Math.max(0, 1 - z * z)));
  const H: Vec3 = [s * Math.cos(phi) + Vh[0], s * Math.sin(phi) + Vh[1], z + Vh[2]];
  return norm3([a * H[0], a * H[1], Math.max(H[2], 0)]);
}

export function pdfVndfRefl(V: Vec3, H: Vec3, a: number): number {
  return (g1Smith(a, V[2]) * dGGX(a, H[2])) / (4 * Math.max(V[2], 1e-6));
}

export function sampleCos(ux: number, uy: number): Vec3 {
  const r = Math.sqrt(ux),
    phi = 2 * PI * uy;
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - ux))];
}

export interface Surf {
  base: Vec3;
  metal: number;
  /** α = rough² */
  a: number;
  spec: number;
}

export function surfF0(s: Surf): Vec3 {
  const d = 0.08 * s.spec,
    t = s.metal;
  return [d + (s.base[0] - d) * t, d + (s.base[1] - d) * t, d + (s.base[2] - d) * t];
}

export function surfPSpec(s: Surf, nov: number): number {
  if (s.metal === 0 && s.spec === 0) return 0;
  const fr = lum(fSchlick(surfF0(s), nov)),
    di = (1 - s.metal) * lum(s.base),
    t = fr + di;
  return t > 0 ? fr / t : 0;
}

export function surfEval(s: Surf, V: Vec3, L: Vec3): Vec3 {
  if (L[2] <= 0 || V[2] <= 0) return [0, 0, 0];
  const k = (1 - s.metal) / PI;
  const f: [number, number, number] = [s.base[0] * k, s.base[1] * k, s.base[2] * k];
  if (s.a >= DELTA_ALPHA) {
    const F0 = surfF0(s);
    if (dot3(F0, F0) > 0) {
      const H = norm3([V[0] + L[0], V[1] + L[1], V[2] + L[2]]),
        F = fSchlick(F0, dot3(V, H)),
        g = (dGGX(s.a, H[2]) * g2Smith(s.a, V[2], L[2])) / (4 * V[2] * L[2]);
      f[0] += F[0] * g;
      f[1] += F[1] * g;
      f[2] += F[2] * g;
    }
  }
  return f;
}

export function surfPdf(s: Surf, V: Vec3, L: Vec3): number {
  if (L[2] <= 0 || V[2] <= 0) return 0;
  const ps = surfPSpec(s, V[2]);
  let p = ((1 - ps) * L[2]) / PI;
  if (s.a >= DELTA_ALPHA && ps > 0) p += ps * pdfVndfRefl(V, norm3([V[0] + L[0], V[1] + L[1], V[2] + L[2]]), s.a);
  return p;
}

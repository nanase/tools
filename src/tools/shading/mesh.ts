/**
 * 描く形: 半径 1 の球と床。頂点ごとに 位置・滑らかな法線・面の中心・面の法線 の 12 個の数を持つ（面ごとに頂点を分ける）。
 * 面の値はフラットシェーディングで使う。カメラは球と床で別々に持つ
 */
import { norm3, type Vec3 } from '../../lib/brdf';

export const STRIDE = 12;

export interface Camera {
  eye: Vec3;
  /** 画面の端までの傾き */
  t: number;
  /** 視線の下向きの傾き（床を見下ろすため、画面の中心をずらす） */
  k: number;
}

export const SPHERE_CAM: Camera = { eye: [0, 0, 4.2], t: 0.26, k: 0 };
export const FLOOR_CAM: Camera = { eye: [0, 1.2, 4.6], t: 0.62, k: 0.42 };
/** 床の高さ */
export const FLOOR_Y = -1;
/** 床の網の上端（画面の縦の位置）。地平線の少し手前 */
export const FLOOR_TOP = 0.66;

function pushQuad(o: number[], a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal: (p: Vec3) => Vec3, fn: Vec3): void {
  const fc: Vec3 = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
  for (const p of [a, b, c, a, c, d]) o.push(...p, ...normal(p), ...fc, ...fn);
}

/** 緯度の分割 div・経度の分割 2 × div の球 */
export function sphereMesh(div: number): Float32Array {
  const o: number[] = [],
    at = (i: number, j: number): Vec3 => {
      const t = (i / div) * Math.PI,
        p = (j / (2 * div)) * 2 * Math.PI;
      return [Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)];
    };
  for (let i = 0; i < div; i++)
    for (let j = 0; j < 2 * div; j++) {
      const a = at(i, j),
        b = at(i + 1, j),
        c = at(i + 1, j + 1),
        d = at(i, j + 1);
      const fn = norm3([a[0] + b[0] + c[0] + d[0], a[1] + b[1] + c[1] + d[1], a[2] + b[2] + c[2] + d[2]]);
      pushQuad(o, a, b, c, d, norm3, fn);
    }
  return new Float32Array(o);
}

/** 床。画面の上で等間隔の網にする（奥まで同じ細かさで見える） */
export function floorMesh(div: number): Float32Array {
  const { eye, t, k } = FLOOR_CAM,
    o: number[] = [],
    up: Vec3 = [0, 1, 0];
  const at = (i: number, j: number): Vec3 => {
    const u = -1.02 + (i / div) * 2.04,
      v = -1.02 + (j / div) * (FLOOR_TOP + 1.02),
      dy = v * t - k,
      s = (FLOOR_Y - eye[1]) / dy;
    return [eye[0] + s * u * t, FLOOR_Y, eye[2] - s];
  };
  for (let j = 0; j < div; j++)
    for (let i = 0; i < div; i++) pushQuad(o, at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), () => up, up);
  return new Float32Array(o);
}

/* ---------- 床のハイライトと光の向き ---------- */

/** 画面の位置（-1〜1）の下にある床の点。地平線より上は網の上端へ寄せる */
export function floorAt(u: number, v: number): Vec3 {
  const { eye, t, k } = FLOOR_CAM,
    dy = Math.min(v, FLOOR_TOP) * t - k,
    s = (FLOOR_Y - eye[1]) / dy;
  return [eye[0] + s * u * t, FLOOR_Y, eye[2] - s];
}

/**
 * 床の点 P にハイライトの中心が来る光の向き（原点から見た単位ベクトル）。
 * 点光源は原点からの距離 dist の球面の上に置く。届かなければ最も近い向きにする
 */
export function lightForFloor(P: Vec3, point: boolean, dist: number): Vec3 {
  const { eye } = FLOOR_CAM,
    V = norm3([eye[0] - P[0], eye[1] - P[1], eye[2] - P[2]]),
    M: Vec3 = [-V[0], V[1], -V[2]];
  if (!point) return M;
  const b = P[0] * M[0] + P[1] * M[1] + P[2] * M[2],
    c = P[0] * P[0] + P[1] * P[1] + P[2] * P[2] - dist * dist,
    disc = b * b - c,
    t = disc >= 0 ? -b + Math.sqrt(disc) : -b;
  const s = Math.max(t, 0.1);
  return norm3([P[0] + s * M[0], P[1] + s * M[1], P[2] + s * M[2]]);
}

/** ハイライトの中心の床の点（光を正反射する点）。カメラより手前なら null */
export function floorMirror(L: Vec3, point: boolean, dist: number): Vec3 | null {
  const { eye } = FLOOR_CAM;
  let P: Vec3;
  if (point) {
    const Lp: Vec3 = [L[0] * dist, L[1] * dist, L[2] * dist];
    if (Lp[1] <= FLOOR_Y) return null;
    /* カメラを床で折り返した点と光を結ぶ */
    const my = 2 * FLOOR_Y - eye[1],
      a = (FLOOR_Y - my) / (Lp[1] - my);
    P = [eye[0] + a * (Lp[0] - eye[0]), FLOOR_Y, eye[2] + a * (Lp[2] - eye[2])];
  } else {
    if (L[1] <= 0) return null;
    const s = (eye[1] - FLOOR_Y) / L[1];
    P = [eye[0] + s * L[0], FLOOR_Y, eye[2] + s * L[2]];
  }
  return eye[2] - P[2] > 1e-3 ? P : null;
}

/** 床の点の画面の位置（-1〜1） */
export function floorScreen(P: Vec3): [number, number] {
  const { eye, t, k } = FLOOR_CAM,
    w = eye[2] - P[2];
  return [(P[0] - eye[0]) / w / t, ((P[1] - eye[1]) / w + k) / t];
}

/** 床の上の入射角 [rad]。点光源はハイライトの中心で測る */
export function floorIncidence(L: Vec3, point: boolean, dist: number): number {
  let c = L[1];
  if (point) {
    const P = floorMirror(L, true, dist),
      Lp: Vec3 = [L[0] * dist, L[1] * dist, L[2] * dist];
    if (P) c = (Lp[1] - P[1]) / Math.hypot(Lp[0] - P[0], Lp[1] - P[1], Lp[2] - P[2]);
  }
  return Math.acos(Math.min(1, Math.max(c, Math.cos((89 * Math.PI) / 180))));
}

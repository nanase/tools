/** 3 次元のベクトルと 3×3 行列（行ごとに 9 個並べる）の演算 */
export type Vec3 = [number, number, number];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** 行列 m とベクトル v の積 */
export const mul = (m: number[], v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** 2 つのベクトルのなす角 [rad] */
export const angle = (a: Vec3, b: Vec3): number => Math.atan2(len(cross(a, b)), dot(a, b));

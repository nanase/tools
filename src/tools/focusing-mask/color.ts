/**
 * 星の光の色（DOM に依存しない）。黒体放射（プランクの式）に CIE 1931 の等色関数を掛けて
 * 波長ごとの線形 sRGB の重みにし、全部の和の輝度 Y を 1 にそろえる
 */
import type { Band } from './optics';

/** CIE 1931 の等色関数の多峰ガウスの近似（Wyman・Sloan・Shirley, 2013） */
export function cmf(nm: number): [number, number, number] {
  const g = (m: number, s1: number, s2: number) => {
    const t = (nm - m) / (nm < m ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  };
  return [
    1.056 * g(599.8, 37.9, 31.0) + 0.362 * g(442.0, 16.0, 26.7) - 0.065 * g(501.1, 20.4, 26.2),
    0.821 * g(568.8, 46.9, 40.5) + 0.286 * g(530.9, 16.3, 31.1),
    1.217 * g(437.0, 11.8, 36.0) + 0.681 * g(459.0, 26.0, 13.8),
  ];
}
/** XYZ → 線形 sRGB */
const toRgb = ([X, Y, Z]: [number, number, number]): [number, number, number] => [
  3.2406 * X - 1.5372 * Y - 0.4986 * Z,
  -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
  0.0557 * X - 0.204 * Y + 1.057 * Z,
];

/** 黒体の分光放射輝度（相対値）。λ は nm、T は K */
export function planck(nm: number, T: number): number {
  const l = nm * 1e-9,
    c2 = 1.438777e-2;
  return 1 / (l ** 5 * (Math.exp(c2 / (l * T)) - 1));
}

/**
 * 色温度 T の星を、n 個の波長（nm0〜nm1 を等分）の帯に分ける。
 * 同じ温度の星を白（D65）と見なすよう、輝度で割ったあと 6500 K の色で割る
 */
export function starBands(T: number, n: number, nm0 = 400, nm1 = 700): Band[] {
  const nms = Array.from({ length: n }, (_, i) => (n === 1 ? (nm0 + nm1) / 2 : nm0 + ((nm1 - nm0) * i) / (n - 1)));
  const xyz = (t: number) => nms.map((nm) => cmf(nm).map((v) => v * planck(nm, t)) as [number, number, number]);
  const sum = (a: [number, number, number][]) => [0, 1, 2].map((k) => a.reduce((s, v) => s + v[k], 0));
  /* 6500 K の和の sRGB を (1, 1, 1) にする係数 */
  const wp = toRgb(sum(xyz(6500)) as [number, number, number]);
  const c = xyz(T),
    Y = sum(c)[1],
    wY = sum(xyz(6500))[1];
  return nms.map((nm, i) => {
    const v = toRgb(c[i]);
    return { nm, rgb: [(v[0] / Y) * (wY / wp[0]), (v[1] / Y) * (wY / wp[1]), (v[2] / Y) * (wY / wp[2])] as const };
  });
}

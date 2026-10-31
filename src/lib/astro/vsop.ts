/**
 * VSOP87 の級数を足し合わせる（DOM に依存しない）
 *
 * 表は変数（L・B・R など）と次数 p を並べた名前（'L0'〜'L5'）ごとに、1 項ずつ振幅 A・位相 B [rad]・
 * 周波数 C [rad/千年] を並べたもの。値は Σ_p τ^p Σ A cos(B + C τ)（τ は J2000.0 からの TT のユリウス千年）
 */
export type VsopTable = Record<string, number[]>;

const sum = (s: number[] | undefined, tau: number) => {
  if (!s) return 0;
  let v = 0;
  for (let i = 0; i < s.length; i += 3) v += s[i] * Math.cos(s[i + 1] + s[i + 2] * tau);
  return v;
};

/** 表 table の変数 c（'L'・'B'・'R' など）の値 */
export function vsop(table: VsopTable, c: string, tau: number): number {
  let v = 0;
  for (let p = 5; p >= 0; p--) v = v * tau + sum(table[c + p], tau);
  return v;
}

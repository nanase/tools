/**
 * 式 z ← |Re (x′ + i y′)ᵖ| + c。x′・y′ はかける前に |x|・|y| を pre だけ混ぜた値、
 * |Re| はかけた後の実部の絶対値を post だけ混ぜる。conj で虚部の符号を反転する（トリコーン）
 */
export interface Formula {
  /** べき（実数。整数のときだけ摂動法で深く拡大できる） */
  p: number;
  /** かける前の |x|・|y| を混ぜる量（0〜1、1/1024 刻み） */
  pre: number;
  /** かけた後の |Re| を混ぜる量（0〜1、1/1024 刻み） */
  post: number;
  conj: boolean;
}

export type FamId = 'm' | 'bs' | 'tc' | 'ce' | 'bu';

/** 種類。home は全体の絵の中心（実部・虚部）と倍率 */
export const FAMS: readonly {
  id: FamId;
  n: string;
  pre: 0 | 1;
  post: 0 | 1;
  conj: boolean;
  home: readonly [string, string, number];
}[] = [
  { id: 'm', n: 'マンデルブロ', pre: 0, post: 0, conj: false, home: ['-0.6', '0', 1] },
  { id: 'bs', n: 'バーニングシップ', pre: 1, post: 0, conj: false, home: ['-0.45', '-0.5', 0.85] },
  { id: 'tc', n: 'トリコーン', pre: 0, post: 0, conj: true, home: ['-0.3', '0', 0.9] },
  { id: 'ce', n: 'セルティック', pre: 0, post: 1, conj: false, home: ['-0.6', '0', 0.9] },
  { id: 'bu', n: 'バッファロー', pre: 1, post: 1, conj: false, home: ['-0.5', '-0.35', 0.8] },
];

/** 混ぜる量と共役が一致する種類（べきは問わない）。どれにも当たらなければ null */
export function famOf(f: Formula): FamId | null {
  return FAMS.find((m) => m.pre === f.pre && m.post === f.post && m.conj === f.conj)?.id ?? null;
}

/** 混ぜる量を 1/1024 刻みに。基準の軌道（BigInt）とシェーダで同じ値を使うため */
export const q1024 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 1024) / 1024;

export const isInt = (p: number): boolean => Math.abs(p - Math.round(p)) < 1e-9;

/** 倍率から決める反復の上限 */
export function maxIter(zoom: number): number {
  const L = Math.max(0, Math.log10(zoom));
  return Math.round(Math.min(60000, 200 + 60 * L + 30 * L * L));
}

/** 発散の判定の半径。大きいほど色の境目が滑らか */
export const BAIL = 1000;

/**
 * 発散の速さ ν = n + 1 − logₚ(log|z_n| / log R)（倍精度で直接くり返す。しくみの図とカードで使う）。
 * J を渡すとジュリア集合（z₀ が点、c = J）。発散しなければ N + 1
 */
export function nu(cr: number, ci: number, f: Formula, N: number, R: number, J?: readonly [number, number]): number {
  let x = J ? cr : 0,
    y = J ? ci : 0;
  const kr = J ? J[0] : cr,
    ki = J ? J[1] : ci,
    cj = f.conj ? -1 : 1,
    lr = Math.log(R),
    lp = Math.log(f.p);
  for (let n = 0; n < N; n++) {
    const r2 = x * x + y * y;
    if (r2 > R * R) return n + 1 - Math.log(Math.log(r2) / 2 / lr) / lp;
    const a = x + f.pre * (Math.abs(x) - x),
      b = (y + f.pre * (Math.abs(y) - y)) * cj;
    let wr: number, wi: number;
    if (isInt(f.p)) {
      wr = a;
      wi = b;
      for (let k = 1; k < f.p; k++) [wr, wi] = [wr * a - wi * b, wr * b + wi * a];
    } else {
      const r = Math.hypot(a, b),
        t = Math.atan2(b, a),
        m = r > 0 ? r ** f.p : 0;
      wr = m * Math.cos(f.p * t);
      wi = m * Math.sin(f.p * t);
    }
    wr += f.post * (Math.abs(wr) - wr);
    x = wr + kr;
    y = wi + ki;
  }
  return N + 1;
}

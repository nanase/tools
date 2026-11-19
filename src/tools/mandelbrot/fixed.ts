/**
 * 中心の座標を持つ固定小数点数（BigInt）。値 × 2^FB を整数で持つ。
 * 倍率の上限 ×10³⁰ では 1 画素が約 10⁻³³ なので、2⁻¹⁹² ≈ 1.6×10⁻⁵⁸ まであれば足りる
 */
export const FB = 192n;
const SCALE = 2 ** 192;

/** 倍精度の値を固定小数点へ（仮数の 53 ビットをそのまま移す） */
export function toFix(v: number): bigint {
  if (!v || !Number.isFinite(v)) return 0n;
  const neg = v < 0,
    a = Math.abs(v),
    e = Math.floor(Math.log2(a));
  const m = BigInt(Math.round(a * 2 ** (52 - e))),
    sh = FB + BigInt(e) - 52n;
  const r = sh >= 0n ? m << sh : m >> -sh;
  return neg ? -r : r;
}

/** 固定小数点を倍精度へ（差のような小さい値も指数の範囲で正しく出る） */
export const fromFix = (b: bigint): number => Number(b) / SCALE;

/** 10 進の文字列（例 "-0.7436438870371587"）を固定小数点へ。桁を落とさずに読む */
export function fromDec(s: string): bigint {
  let t = s.trim(),
    neg = false;
  if (t[0] === '-' || t[0] === '−') {
    neg = true;
    t = t.slice(1);
  }
  const [i, f = ''] = t.split('.');
  const v = (BigInt((i || '0') + f) << FB) / 10n ** BigInt(f.length);
  return neg ? -v : v;
}

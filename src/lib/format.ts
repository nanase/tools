/** 数値の整形: SI 接頭辞つき（parts・fmt・ro・mqty）と接頭辞なし（plain） */
const PFX: Record<number, string> = { [-12]: 'p', [-9]: 'n', [-6]: 'μ', [-3]: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' };

/** 先頭の ASCII のハイフンをマイナス記号（U+2212）にする */
export const minus = (s: string): string => s.replace(/^-/, '−');

export function parts(v: number, unit: string, sig = 4): [string, string] {
  if (!Number.isFinite(v)) return ['—', ''];
  if (v === 0) return ['0', unit];
  const a = Math.abs(v);
  let e = Math.max(-12, Math.min(9, Math.floor(Math.log10(a) / 3) * 3));
  let m = Number((a / 10 ** e).toPrecision(sig));
  if (m >= 1000 && e < 9) {
    e += 3;
    m = Number((a / 10 ** e).toPrecision(sig));
  }
  return [(v < 0 ? '−' : '') + m, PFX[e] + unit];
}

/** 「4.7 kΩ」 */
export const fmt = (v: number, u: string, sig?: number): string => {
  const [n, x] = parts(v, u, sig);
  return x ? `${n} ${x}` : n;
};

/**
 * 接頭辞を付けない表記（ゲイン・位置など）。有効数字 sig 桁で、末尾の 0 は付けない。
 * 絶対値が 1e-4 未満は指数表記（「1e-5」）にする。負の値はマイナス記号
 */
export function plain(v: number, sig = 6): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s =
    a >= 1e-4 || a === 0
      ? String(Number(a.toPrecision(sig)))
      : a.toExponential(Math.min(sig, 3) - 1).replace(/\.?0+e/, 'e');
  return (v < 0 ? '−' : '') + s;
}

/** 計算結果の読み取り窓用。単位を小さく出す HTML */
export const ro = (v: number, u: string, sig?: number): string => {
  const [n, x] = parts(v, u, sig);
  return `${n}<span class="u">${x}</span>`;
};

/** MathML の量（数値 + 単位） */
export const mqty = (v: number, u: string): string => {
  const [n, x] = parts(v, u, 4);
  return `<mn>${n}</mn><mspace width="0.17em"/><mi mathvariant="normal">${x}</mi>`;
};

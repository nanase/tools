/** 数値を SI 接頭辞つきで整形する */
const PFX: Record<number, string> = { [-12]: 'p', [-9]: 'n', [-6]: 'μ', [-3]: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' };

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

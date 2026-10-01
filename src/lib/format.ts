/**
 * 数値の整形: SI 接頭辞つき（parts・fmt・ro・fmtR・mqty）と接頭辞なし（plain）。
 * 入力欄・目盛り・メッセージは末尾の 0 を落とし（4.7 kΩ）、計算結果・測定値（ro・fmtR、keep）は
 * 有効数字の桁をそろえて末尾の 0 も残す（4.700 kΩ・440.30 Hz）
 */
const PFX: Record<number, string> = { [-12]: 'p', [-9]: 'n', [-6]: 'μ', [-3]: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' };

/** 先頭の ASCII のハイフンをマイナス記号（U+2212）にする */
export const minus = (s: string): string => s.replace(/^-/, '−');

/** 有効数字 sig 桁に丸めた数の表記。keep なら末尾の 0 を残す（桁が整数部より少ないときは丸めた整数） */
const sigStr = (x: number, sig: number, keep: boolean): string => {
  const s = x.toPrecision(sig);
  return keep && !s.includes('e') ? s : String(Number(s));
};

export function parts(v: number, unit: string, sig = 4, keep = false): [string, string] {
  if (!Number.isFinite(v)) return ['—', ''];
  if (v === 0) return ['0', unit];
  const a = Math.abs(v);
  let e = Math.max(-12, Math.min(9, Math.floor(Math.log10(a) / 3) * 3));
  let m = Number((a / 10 ** e).toPrecision(sig));
  if (m >= 1000 && e < 9) {
    e += 3;
    m = Number((a / 10 ** e).toPrecision(sig));
  }
  return [(v < 0 ? '−' : '') + sigStr(m, sig, keep), PFX[e] + unit];
}

/** 「4.7 kΩ」 */
export const fmt = (v: number, u: string, sig?: number): string => {
  const [n, x] = parts(v, u, sig);
  return x ? `${n} ${x}` : n;
};

/**
 * 接頭辞を付けない表記（ゲイン・位置など）。有効数字 sig 桁で、末尾の 0 は付けない（keep なら残す）。
 * 絶対値が 1e-4 未満は指数表記（「1e-5」）にする。負の値はマイナス記号
 */
export function plain(v: number, sig = 6, keep = false): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s =
    a >= 1e-4 || a === 0
      ? sigStr(a, sig, keep && a !== 0)
      : a.toExponential(Math.min(sig, 3) - 1).replace(/\.?0+e/, 'e');
  return (v < 0 ? '−' : '') + s;
}

/** 計算結果・測定値（要約の帯・カーソルの読み値など）。末尾の 0 を残す（1.000 kHz） */
export const fmtR = (v: number, u: string, sig?: number): string => {
  const [n, x] = parts(v, u, sig, true);
  return x ? `${n} ${x}` : n;
};

/** 計算結果の読み取り窓用。単位を小さく出す HTML。末尾の 0 を残す */
export const ro = (v: number, u: string, sig?: number): string => {
  const [n, x] = parts(v, u, sig, true);
  return `${n}<span class="u">${x}</span>`;
};

/** MathML の量（数値 + 単位）。計算結果は keep で末尾の 0 を残す */
export const mqty = (v: number, u: string, keep = false): string => {
  const [n, x] = parts(v, u, 4, keep);
  return `<mn>${n}</mn><mspace width="0.17em"/><mi mathvariant="normal">${x}</mi>`;
};

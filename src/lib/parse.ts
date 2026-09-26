/** 数値の解釈: 4.7k 4k7 4R7 0.1u 100n 1e3 4.7 kΩ 3V3 1meg 全角 */
const MUL: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  R: 1,
  r: 1,
};

export type Unit = 'Ω' | 'F' | 'V' | 'H' | 'Hz' | 'A' | 's';

export function parse(raw: string, unit: Unit): number {
  let s = String(raw)
    .normalize('NFKC')
    .replace(/[\s_,]/g, '')
    .replace(/µ/g, 'μ');
  if (!s) return NaN;
  if (unit === 'Ω') s = s.replace(/(Ω|ω|ohms?)$/i, '');
  else if (unit === 'F') s = s.replace(/(farads?|F|f)$/, '');
  else if (unit === 'V') {
    const v = s.match(/^(\d+)[vV](\d+)$/);
    if (v) return Number(`${v[1]}.${v[2]}`);
    s = s.replace(/(volts?|[vV])$/, '');
  }
  s = s.replace(/meg$/i, 'M');
  let m = s.match(/^(\d+)([pnuμmkKMGRr])(\d+)$/);
  if (m) return Number((Number(`${m[1]}.${m[3]}`) * MUL[m[2]]).toPrecision(12));
  m = s.match(/^((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([pnuμmkKMGRr])?$/);
  if (!m) return NaN;
  return Number((Number(m[1]) * (m[2] ? MUL[m[2]] : 1)).toPrecision(12));
}

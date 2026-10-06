/** 数値の解釈: 4.7k 4k7 4R7 0.1u 100n 1e3 4.7 kΩ 3V3 1meg 1.5kHz −6dB 50% 0.5mm 8mil 35µm 全角 */
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

/** 入力欄の単位。'' は単位なし */
export type Unit =
  | ''
  | 'Ω'
  | 'F'
  | 'H'
  | 'V'
  | 'A'
  | 'W'
  | 'Hz'
  | 's'
  | 'dB'
  | '%'
  | 'm'
  | 'm/s'
  | 'Pa'
  | 'mm'
  | 'µm'
  | 'FS'
  | 'N'
  | 'L'
  | '°';

/** 末尾に書かれた単位を外す。接頭辞と紛らわしいものは数字の直後だけ外す */
const STRIP: Partial<Record<Unit, [RegExp, string]>> = {
  Ω: [/(Ω|ω|ohms?)$/i, ''],
  F: [/(farads?|F|f)$/, ''],
  H: [/(henry|henries|H|h)$/, ''],
  V: [/(volts?|[vV])$/, ''],
  A: [/(amps?|A|a)$/, ''],
  W: [/(watts?|W|w)$/, ''],
  Hz: [/hz$/i, ''],
  s: [/(sec|s)$/, ''],
  dB: [/db$/i, ''],
  /* フルスケールを 1 とする振幅 */
  FS: [/fs$/i, ''],
  '%': [/%$/, ''],
  /* 4.7m は 4.7 メートル（ミリではない） */
  m: [/([\d.])m$/, '$1'],
  'm/s': [/m\/s$/i, ''],
  /* 圧力（パスカル）。k などの接頭辞を読む */
  Pa: [/pa$/i, ''],
  mm: [/mm$/i, ''],
  µm: [/[uμ]m$/i, ''],
  /* 張力（ニュートン）。小文字の n はナノなので外さない */
  N: [/N$/, ''],
  /* 容積（リットル） */
  L: [/(l|L|ℓ)$/, ''],
  '°': [/(°|度|deg)$/i, ''],
};

/** 接頭辞を読まない単位（0.5m を 0.5 mm と取り違えないように） */
const NO_PREFIX = new Set<Unit>(['mm', 'µm', 'N', 'L', '°']);

/**
 * 文字列を数値に読む。読めなければ NaN。
 * signed なら先頭の符号（- + − –）を読む。既定では負の値を読まない
 */
export function parse(raw: string, unit: Unit, signed = false): number {
  let s = String(raw)
    .normalize('NFKC')
    .replace(/[\s_,]/g, '')
    .replace(/µ/g, 'μ');
  let sg = 1;
  if (signed) {
    s = s.replace(/^[−‒–]/, '-');
    if (s[0] === '-' || s[0] === '+') {
      if (s[0] === '-') sg = -1;
      s = s.slice(1);
    }
  }
  if (!s) return NaN;
  if (unit === 'V') {
    const v = s.match(/^(\d+)[vV](\d+)$/);
    if (v) return sg * Number(`${v[1]}.${v[2]}`);
  }
  /* mm の欄は mil（1/1000 インチ）でも読む */
  let k = 1;
  if (unit === 'mm' && /mils?$/i.test(s)) {
    k = 0.0254;
    s = s.replace(/mils?$/i, '');
  }
  const st = STRIP[unit];
  if (st) s = s.replace(st[0], st[1]);
  if (NO_PREFIX.has(unit)) {
    const p = s.match(/^((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/);
    return p ? sg * Number((Number(p[1]) * k).toPrecision(12)) : NaN;
  }
  s = s.replace(/meg$/i, 'M');
  let m = s.match(/^(\d+)([pnuμmkKMGRr])(\d+)$/);
  if (m) return sg * Number((Number(`${m[1]}.${m[3]}`) * MUL[m[2]]).toPrecision(12));
  m = s.match(/^((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([pnuμmkKMGRr])?$/);
  if (!m) return NaN;
  return sg * Number((Number(m[1]) * (m[2] ? MUL[m[2]] : 1)).toPrecision(12));
}

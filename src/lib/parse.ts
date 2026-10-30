/** 数値の解釈: 4.7k 4k7 4R7 0.1u 100n 1e3 4.7 kΩ 3V3 1meg 1.5kHz −6dB 50% 0.5mm 8mil 35µm 0.23kg 5.4 N·s/m 全角 */
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
  | 'kPa'
  | 'mm'
  | 'µm'
  | 'FS'
  | 'N'
  | 'L'
  | '°'
  | '°C'
  | 'セント'
  | '× L'
  | 'km'
  | 'EV'
  | '日'
  | 'K'
  | '″'
  | 'λ'
  | '画素'
  | (typeof COMPOUND)[number];

/**
 * 質量・組立単位・回転の単位。末尾に書かれていれば外す。表記ゆれを受け付ける: 積の · は ⋅ ∙ ・ * でも、
 * 省いてもよい（空白は先に除く）。² は ^2 と 2、括弧は省いてもよい。大文字と小文字は区別する（N と n）
 */
const COMPOUND = [
  'kg',
  'g',
  'kg·cm²',
  'g·cm²',
  'N·s',
  'N·m',
  'N·s/m',
  'N·m·s',
  'N·m/A',
  'mN·m/A',
  'm/s²',
  'rad/s',
  'rad/m',
  'rad·s/m',
  'rad/(m·s)',
  'V/rad',
  'V·s/rad',
  'V/(rad·s)',
  'N/rad',
  'N·s/rad',
  'N/(rad·s)',
  'rpm',
  'rev',
  'P/R',
] as const;
const unitRe = (u: string) =>
  new RegExp(
    `${u
      .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
      .replace(/·/g, '[·⋅∙・*]?')
      .replace(/²/g, '\\^?2')
      .replace(/\\([()])/g, '\\$1?')}$`,
  );
const COMPOUND_RE = new Map<Unit, RegExp>(COMPOUND.map((u) => [u, unitRe(u)]));

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
  /* 圧力（キロパスカル）。接頭辞は読まない */
  kPa: [/kpa$/i, ''],
  mm: [/mm$/i, ''],
  µm: [/[uμ]m$/i, ''],
  /* 張力（ニュートン）。小文字の n はナノなので外さない */
  N: [/N$/, ''],
  /* 容積（リットル） */
  L: [/(l|L|ℓ)$/, ''],
  '°': [/(°|度|deg)$/i, ''],
  /* 温度（セルシウス度） */
  '°C': [/(°C|℃|度|C)$/i, ''],
  /* 音程（1 オクターブ = 1200 セント） */
  セント: [/(セント|cents?|¢)$/i, ''],
  /* 弦の長さに対する割合（ヴァイオリンの弓の位置 β） */
  '× L': [/[×x*]?L$/i, ''],
  /* 雲の高さ（ハロ） */
  km: [/km$/i, ''],
  /* 露出の補正（ハロ） */
  EV: [/ev$/i, ''],
  /* 月齢（ハロ） */
  日: [/日$/, ''],
  /* 温度（ケルビン）。数字の直後だけ外す（5.8k は 5800） */
  K: [/([\d.])K$/, '$1'],
  /* 角度の秒 */
  '″': [/(″|′′|"|”|arcsec|秒)$/i, ''],
  /* 波長を単位にした長さ（波面のずれ） */
  λ: [/(λ|waves?)$/i, ''],
  /* 画像の長さ（画像の畳み込み） */
  画素: [/(画素|px|pixels?)$/i, ''],
};

/**
 * 接頭辞を読まない単位（0.5m を 0.5 mm と取り違えないように）。接頭辞を含む単位（kg・mN·m/A など）も、
 * 1m を 1 g と読まないように読まない
 */
const NO_PREFIX = new Set<Unit>([
  'kPa',
  'mm',
  'µm',
  'N',
  'L',
  '°',
  '°C',
  'セント',
  '× L',
  'km',
  'EV',
  '日',
  '″',
  'λ',
  '画素',
  'kg',
  'kg·cm²',
  'g·cm²',
  'mN·m/A',
]);

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
  const st = STRIP[unit],
    cu = COMPOUND_RE.get(unit);
  if (st) s = s.replace(st[0], st[1]);
  else if (cu) s = s.replace(cu, '');
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

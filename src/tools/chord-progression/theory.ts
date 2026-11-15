/**
 * コード進行のページの音楽の決まり（DOM に依存しない）: 音名・度数・コードの種類・機能・つながりの強さ・名前のある進行・
 * 和音の並べ方（ボイシング）・奏法。コードは調の主音からの半音の数（度数）と種類で持つ
 */

/** 調。t は主音の音名（C = 0 の半音の数）、m は長調か短調 */
export interface Key {
  t: number;
  m: 'maj' | 'min';
}
export type Qual =
  | 'M'
  | 'm'
  | '7'
  | 'M7'
  | 'm7'
  | '6'
  | 'm6'
  | 'sus4'
  | 'sus2'
  | '7sus4'
  | 'add9'
  | '9'
  | 'M9'
  | 'm9'
  | 'mM7'
  | 'dim'
  | 'dim7'
  | 'm7b5'
  | 'aug';
/** コード。d は主音からの半音の数（0〜11）、inv は転回（0 は基本形） */
export interface Chord {
  d: number;
  q: Qual;
  inv: number;
}
/** つながりの強さ。3 定番・2 よく使う・1 ときどき・0 まれ。-1 は転調をまたぐ */
export type Lv = -1 | 0 | 1 | 2 | 3;

export const md = (x: number): number => ((x % 12) + 12) % 12;

const SH = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FL = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
/** 調の主音の選択肢の綴り */
export const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** 調号に ♭ を使う調か（長調は F・B♭・E♭・A♭・D♭・G♭、短調はその平行調） */
export const flatKey = (k: Key): boolean => [5, 10, 3, 8, 1, 6].includes(k.m === 'min' ? md(k.t + 3) : k.t);
export const keyTonic = (k: Key): string => (flatKey(k) ? FL : SH)[md(k.t)];
export const modeName = (k: Key): string => (k.m === 'min' ? 'マイナー' : 'メジャー');
export const keyName = (k: Key): string => `${keyTonic(k)} ${modeName(k)}`;
export const sameKey = (a: Key, b: Key): boolean => a.t === b.t && a.m === b.m;

export const QUALS: Record<Qual, { iv: readonly number[]; s: string; b: 'M' | 'm' | 'd'; name: string }> = {
  M: { iv: [0, 4, 7], s: '', b: 'M', name: 'メジャー' },
  m: { iv: [0, 3, 7], s: 'm', b: 'm', name: 'マイナー' },
  7: { iv: [0, 4, 7, 10], s: '7', b: 'M', name: '7' },
  M7: { iv: [0, 4, 7, 11], s: 'M7', b: 'M', name: 'M7' },
  m7: { iv: [0, 3, 7, 10], s: 'm7', b: 'm', name: 'm7' },
  dim: { iv: [0, 3, 6], s: 'dim', b: 'd', name: 'dim' },
  m7b5: { iv: [0, 3, 6, 10], s: 'm7(♭5)', b: 'd', name: 'm7(♭5)' },
  6: { iv: [0, 4, 7, 9], s: '6', b: 'M', name: '6' },
  m6: { iv: [0, 3, 7, 9], s: 'm6', b: 'm', name: 'm6' },
  sus4: { iv: [0, 5, 7], s: 'sus4', b: 'M', name: 'sus4' },
  sus2: { iv: [0, 2, 7], s: 'sus2', b: 'M', name: 'sus2' },
  '7sus4': { iv: [0, 5, 7, 10], s: '7sus4', b: 'M', name: '7sus4' },
  add9: { iv: [0, 4, 7, 14], s: 'add9', b: 'M', name: 'add9' },
  9: { iv: [0, 4, 7, 10, 14], s: '9', b: 'M', name: '9' },
  M9: { iv: [0, 4, 7, 11, 14], s: 'M9', b: 'M', name: 'M9' },
  m9: { iv: [0, 3, 7, 10, 14], s: 'm9', b: 'm', name: 'm9' },
  mM7: { iv: [0, 3, 7, 11], s: 'mM7', b: 'm', name: 'mM7' },
  dim7: { iv: [0, 3, 6, 9], s: 'dim7', b: 'd', name: 'dim7' },
  aug: { iv: [0, 4, 8], s: 'aug', b: 'M', name: 'aug' },
};
export const QUAL_ORDER: readonly Qual[] = [
  'M',
  'm',
  '7',
  'M7',
  'm7',
  '6',
  'm6',
  'sus4',
  'sus2',
  '7sus4',
  'add9',
  '9',
  'M9',
  'm9',
  'mM7',
  'dim',
  'dim7',
  'm7b5',
  'aug',
];

const R_MAJ = ['Ⅰ', '♭Ⅱ', 'Ⅱ', '♭Ⅲ', 'Ⅲ', 'Ⅳ', '♯Ⅳ', 'Ⅴ', '♭Ⅵ', 'Ⅵ', '♭Ⅶ', 'Ⅶ'];
const R_MIN = ['Ⅰ', '♭Ⅱ', 'Ⅱ', 'Ⅲ', '♯Ⅲ', 'Ⅳ', '♯Ⅳ', 'Ⅴ', 'Ⅵ', '♯Ⅵ', 'Ⅶ', '♯Ⅶ'];
/** 根音の度数の記号（Ⅰ・♭Ⅶ など）。短調は自然的短音階の度数を基準にする */
export const romanBase = (d: number, k: Key): string => (k.m === 'min' ? R_MIN : R_MAJ)[md(d)];
export const roman = (c: Chord, k: Key): string => romanBase(c.d, k) + QUALS[c.q].s;

/** 度数の 1〜7（♭・♯ の付いた根音は文字の度数） */
const STEP = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];
export const stepOf = (d: number): number => STEP[md(d)];

/** 根音の綴り。度数に ♭・♯ が付けばその向き、付かなければ調号の向き */
export function rootName(d: number, k: Key): string {
  const r = romanBase(d, k);
  return (r[0] === '♭' ? FL : r[0] === '♯' ? SH : flatKey(k) ? FL : SH)[md(k.t + d)];
}
export function chordName(c: Chord, k: Key): string {
  const iv = QUALS[c.q].iv;
  let s = rootName(c.d, k) + QUALS[c.q].s;
  if (c.inv > 0 && c.inv < iv.length) s += `/${rootName(c.d + iv[c.inv], k)}`;
  return s;
}

/** ダイアトニックコード（3 和音・4 和音）。短調は和声的短音階の Ⅴ と Ⅶ を使う */
export const DIATONIC: Record<Key['m'], Record<3 | 4, readonly (readonly [number, Qual])[]>> = {
  maj: {
    3: [
      [0, 'M'],
      [2, 'm'],
      [4, 'm'],
      [5, 'M'],
      [7, 'M'],
      [9, 'm'],
      [11, 'dim'],
    ],
    4: [
      [0, 'M7'],
      [2, 'm7'],
      [4, 'm7'],
      [5, 'M7'],
      [7, '7'],
      [9, 'm7'],
      [11, 'm7b5'],
    ],
  },
  min: {
    3: [
      [0, 'm'],
      [2, 'dim'],
      [3, 'M'],
      [5, 'm'],
      [7, 'M'],
      [8, 'M'],
      [10, 'M'],
    ],
    4: [
      [0, 'm7'],
      [2, 'm7b5'],
      [3, 'M7'],
      [5, 'm7'],
      [7, '7'],
      [8, 'M7'],
      [10, '7'],
    ],
  },
};
/** パレットの「その他」: よく借りるコードとセカンダリードミナント */
export const OTHER: Record<Key['m'], readonly (readonly [number, Qual])[]> = {
  maj: [
    [10, 'M'],
    [8, 'M'],
    [5, 'm'],
    [0, '7'],
    [2, '7'],
    [4, '7'],
    [9, '7'],
  ],
  min: [
    [0, 'M'],
    [5, 'M'],
    [7, 'm'],
    [1, 'M'],
    [11, 'dim'],
    [0, '7'],
    [2, '7'],
  ],
};
/** 調の中の和音とみなす根音と種類の系統（短調は自然的・和声的短音階の両方） */
const IN_KEY: Record<Key['m'], readonly string[]> = {
  maj: ['0M', '2m', '4m', '5M', '7M', '9m', '11d'],
  min: ['0m', '2d', '3M', '5m', '7M', '7m', '8M', '10M', '11d'],
};
export const inKey = (c: Chord, k: Key): boolean => IN_KEY[k.m].includes(`${md(c.d)}${QUALS[c.q].b}`);

/** 根音 d のダイアトニックの種類（n 和音）。調の外の根音は undefined */
export const diatonicQ = (d: number, k: Key, n: 3 | 4 = 3): Qual | undefined =>
  DIATONIC[k.m][n].find((x) => x[0] === md(d))?.[1];

/** 長 3 度と短 7 度を持つ（属七の形の）コード */
const isDom7 = (c: Chord): boolean => QUALS[c.q].iv.includes(4) && QUALS[c.q].iv.includes(10);
/** ドミナントの働きをするか（Ⅴ の長三和音・属七の形・Ⅶ の減三和音） */
const isDominant = (c: Chord): boolean =>
  isDom7(c) || (md(c.d) === 7 && QUALS[c.q].b === 'M') || (md(c.d) === 11 && QUALS[c.q].b === 'd');

/** 機能: T トニック・S サブドミナント・D ドミナント */
export type Fn = 'T' | 'S' | 'D';
export function func(c: Chord, k: Key): Fn {
  if (isDominant(c)) return 'D';
  const s = stepOf(c.d);
  if (s === 5 || (s === 7 && QUALS[c.q].b === 'd')) return 'D';
  if ((s === 1 || s === 3 || s === 6) && inKey(c, k)) return 'T';
  return s === 1 ? 'T' : 'S';
}

/**
 * 度数どうしの進み方（Piston の表）。3 は usually、2 は sometimes、1 は less often。
 * 長調・短調とも同じ表を使う
 */
const PISTON: Record<number, Record<number, Lv>> = {
  1: { 4: 3, 5: 3, 6: 2, 2: 1, 3: 1 },
  2: { 5: 3, 4: 2, 6: 2, 1: 1, 3: 1 },
  3: { 6: 3, 4: 2, 1: 1, 2: 1, 5: 1 },
  4: { 5: 3, 1: 2, 2: 2, 3: 1, 6: 1 },
  5: { 1: 3, 4: 2, 6: 2, 2: 1, 3: 1 },
  6: { 2: 3, 5: 3, 3: 2, 4: 2, 1: 1 },
  7: { 3: 3, 1: 2 },
};
const LV_NAME: readonly string[] = ['まれ', 'ときどき', 'よく使う', '定番'];
/** 強さの名前（転調をまたぐ -1 は「まれ」と同じに出す） */
export const lvName = (lv: Lv): string => LV_NAME[Math.max(0, lv)] ?? '';

/** a（調 ka）から b（調 kb）へのつながりの強さと、終止などの名前 */
export function trans(a: Chord, ka: Key, b: Chord, kb: Key): { lv: Lv; name: string } {
  if (!sameKey(ka, kb)) return { lv: -1, name: '' };
  const k = ka,
    ad = md(a.d),
    bd = md(b.d);
  if (ad === bd && a.q === b.q) return { lv: 0, name: '' };
  const down5 = md(bd - ad) === 5,
    bTonic = bd === 0 && QUALS[b.q].b === (k.m === 'min' ? 'm' : 'M');
  let lv: Lv;
  if (isDom7(a) && down5) lv = 3;
  else if (ad === 11 && QUALS[a.q].b === 'd' && bd === 0) lv = 3;
  else if (ad === 5 && bd === 5) lv = k.m === 'maj' && QUALS[a.q].b === 'M' && QUALS[b.q].b === 'm' ? 2 : 0;
  else {
    lv = PISTON[stepOf(ad)]?.[stepOf(bd)] ?? 0;
    if ((!inKey(a, k) || !inKey(b, k)) && lv > 0) lv = (lv - 1) as Lv;
    if (k.m === 'maj' && ad === 5 && QUALS[a.q].b === 'm' && bd === 0) lv = 3;
    if (isDom7(a) && ad !== 7) lv = Math.min(lv, 1) as Lv;
  }
  let name = '';
  const aV = ad === 7 && QUALS[a.q].b === 'M';
  if (aV && bTonic) name = '完全終止';
  else if (isDom7(a) && down5) name = 'ドミナント進行';
  else if (
    aV &&
    ((k.m === 'maj' && bd === 9 && QUALS[b.q].b === 'm') || (k.m === 'min' && bd === 8 && QUALS[b.q].b === 'M'))
  )
    name = '偽終止';
  else if (ad === 5 && bTonic) name = '変格終止';
  else if (ad === 2 && bd === 7 && QUALS[a.q].b !== 'M' && QUALS[b.q].b === 'M') name = 'ツーファイブ';
  return { lv, name };
}

/** 名前のある進行。度数は長調の度数（短調は平行長調へ寄せて比べる）と和音の系統 */
export const NAMED: readonly { n: string; p: readonly (readonly [number, 'M' | 'm' | 'd'])[] }[] = [
  {
    n: '12 小節のブルース',
    p: [
      [0, 'M'],
      [5, 'M'],
      [0, 'M'],
      [0, 'M'],
      [5, 'M'],
      [5, 'M'],
      [0, 'M'],
      [0, 'M'],
      [7, 'M'],
      [5, 'M'],
      [0, 'M'],
      [7, 'M'],
    ],
  },
  {
    n: 'カノン進行',
    p: [
      [0, 'M'],
      [7, 'M'],
      [9, 'm'],
      [4, 'm'],
      [5, 'M'],
      [0, 'M'],
      [5, 'M'],
      [7, 'M'],
    ],
  },
  {
    n: '王道進行',
    p: [
      [5, 'M'],
      [7, 'M'],
      [4, 'm'],
      [9, 'm'],
    ],
  },
  {
    n: '小室進行',
    p: [
      [9, 'm'],
      [5, 'M'],
      [7, 'M'],
      [0, 'M'],
    ],
  },
  {
    n: '丸サ進行',
    p: [
      [5, 'M'],
      [4, 'M'],
      [9, 'm'],
      [0, 'M'],
    ],
  },
  {
    n: '循環進行',
    p: [
      [0, 'M'],
      [9, 'm'],
      [2, 'm'],
      [7, 'M'],
    ],
  },
  {
    n: 'ツーファイブワン',
    p: [
      [2, 'm'],
      [7, 'M'],
      [0, 'M'],
    ],
  },
];
/** 進行の名前を比べるための形: 長調の度数と和音の系統 */
export const sigOf = (c: Chord, k: Key): readonly [number, 'M' | 'm' | 'd'] => [
  k.m === 'min' ? md(c.d + 9) : md(c.d),
  QUALS[c.q].b,
];

/** 並んだコード（i はブロックの並びの位置）。続いた位置で同じ調のものだけを 1 つの進行とみなす */
export interface Seq {
  c: Chord;
  key: Key;
  i: number;
}
export interface Group {
  n: string;
  first: boolean;
  last: boolean;
}
const match = (s: readonly Seq[], at: number, p: (typeof NAMED)[number]['p'], len: number): boolean => {
  if (at + len > s.length) return false;
  for (let j = 0; j < len; j++) {
    const e = s[at + j],
      g = sigOf(e.c, e.key);
    if (g[0] !== p[j][0] || g[1] !== p[j][1] || !sameKey(e.key, s[at].key)) return false;
    if (j && s[at + j - 1].i !== e.i - 1) return false;
  }
  return true;
};
/** 名前のある進行を左から探す（長いものを先に） */
export function findNamed(s: readonly Seq[]): (Group | null)[] {
  const out: (Group | null)[] = s.map(() => null);
  for (let i = 0; i < s.length; ) {
    const hit = NAMED.find((P) => match(s, i, P.p, P.p.length));
    if (!hit) {
      i++;
      continue;
    }
    const L = hit.p.length;
    for (let j = 0; j < L; j++) out[i + j] = { n: hit.n, first: j === 0, last: j === L - 1 };
    i += L;
  }
  return out;
}
/** 最後のコードまでが名前のある進行の途中（2 つ以上）なら、次のコードの形とその名前 */
export function namedNext(s: readonly Seq[]): { n: string; s: readonly [number, 'M' | 'm' | 'd'] }[] {
  const out: { n: string; s: readonly [number, 'M' | 'm' | 'd'] }[] = [];
  for (const P of NAMED)
    for (let k = Math.min(P.p.length - 1, s.length); k >= 2; k--)
      if (match(s, s.length - k, P.p, k)) {
        out.push({ n: P.n, s: P.p[k] });
        break;
      }
  return out;
}

/** 音の高さ（MIDI のノート番号）。0 番目はベース、続いて上の声部を低い順に */
export function voicing(c: Chord, k: Key): number[] {
  const root = md(k.t + c.d),
    iv = QUALS[c.q].iv,
    inv = c.inv > 0 && c.inv < iv.length ? c.inv : 0;
  const up = iv.slice(inv).concat(iv.slice(0, inv).map((x) => x + 12));
  if (iv.length === 3) up.push(up[0] + 12);
  let r0 = 48 + root;
  if (r0 + up[0] < 52) r0 += 12;
  if (r0 + up[0] > 63) r0 -= 12;
  let bass = 36 + md(root + iv[inv]);
  if (bass < 40) bass += 12;
  return [bass, ...up.map((x) => r0 + x)];
}

/* ---------- 奏法 ---------- */
/**
 * 奏法の 1 音: s は 8 分音符の何歩目（16 分は 0.5 刻み）、i は和音の何番目の音（0 はベース、all は全部、up はベースを除く上の声部）、
 * l は長さ（歩）、st はかき鳴らし
 */
export interface PatNote {
  s: number;
  i: number | 'all' | 'up';
  l: number;
  st?: boolean;
}
export type BuiltinPat =
  | 'whole'
  | 'strum'
  | 'beat8'
  | 'eighth'
  | 'oom'
  | 'offbeat'
  | 'bossa'
  | 'up'
  | 'down'
  | 'updown'
  | 'updown16'
  | 'alberti'
  | 'three';
const rng = (n: number): number[] => Array.from({ length: Math.max(0, n) }, (_, i) => i);
/** 奏法。g(n, S, bs, bar) は n 音の和音を S 歩で弾く音の並び。bs は 1 拍の歩数（4 分の拍子で 2、8 分の拍子で 1）、bar は 1 小節の歩数 */
export const PATS: Record<
  BuiltinPat,
  { name: string; g: (n: number, S: number, bs?: number, bar?: number) => PatNote[] }
> = {
  whole: { name: '全音符', g: (_n, S) => [{ s: 0, i: 'all', l: S }] },
  strum: {
    name: '4 分のストローク',
    g: (_n, S) => rng(Math.ceil(S / 2)).map((k) => ({ s: k * 2, i: 'all', l: 2, st: true })),
  },
  beat8: {
    name: '8 ビート',
    g: (_n, S) =>
      rng(S)
        .filter((s) => [0, 2, 3, 5, 6, 7].includes(s % 8))
        .map((s) => ({ s, i: 'all', l: 1, st: true })),
  },
  eighth: {
    name: '8 分の刻み',
    g: (_n, S, _bs = 2, bar = 8) => [
      ...rng(Math.ceil(S / bar)).map((k) => ({ s: k * bar, i: 0, l: Math.min(bar, S - k * bar) })),
      ...rng(S).map((s) => ({ s, i: 'up' as const, l: 1 })),
    ],
  },
  oom: {
    name: 'ベースと和音',
    g: (n, S, bs = 2, bar = 8) => {
      /* 3 拍子と 8 分の拍子は小節の頭（6/8 は 1・4 拍目）にベース、2 拍子系は 1・3 拍目にベース（2 回目は 5 度） */
      const nb = bar / bs,
        out: PatNote[] = [];
      for (let s = 0; s < S; s += bs) {
        const b = Math.round((s % bar) / bs),
          bass = bs === 1 ? b % 3 === 0 : nb % 2 === 1 ? b === 0 : b % 2 === 0;
        out.push(bass ? { s, i: b === 0 ? 0 : Math.min(3, n - 1), l: bs } : { s, i: 'up', l: bs });
      }
      return out;
    },
  },
  offbeat: {
    name: '裏拍',
    g: (_n, S, _bs = 2, bar = 8) => [
      ...rng(Math.ceil(S / bar)).map((k) => ({ s: k * bar, i: 0, l: Math.min(bar, S - k * bar) })),
      ...rng(S)
        .filter((s) => s % 2 === 1)
        .map((s) => ({ s, i: 'up' as const, l: 1 })),
    ],
  },
  bossa: {
    name: 'ボサノバ',
    g: (n, S) =>
      rng(S).flatMap((s): PatNote[] => {
        const k = s % 8,
          out: PatNote[] = [];
        if (k === 0) out.push({ s, i: 0, l: 3 });
        if (k === 3 || k === 4) out.push({ s, i: Math.min(3, n - 1), l: k === 3 ? 1 : 4 });
        if (k === 0 || k === 3 || k === 6) out.push({ s, i: 'up', l: 1 });
        return out;
      }),
  },
  up: { name: '上行', g: (n, S) => rng(S).map((s) => ({ s, i: s % n, l: 1 })) },
  down: { name: '下行', g: (n, S) => rng(S).map((s) => ({ s, i: s % n === 0 ? 0 : n - (s % n), l: 1 })) },
  updown: {
    name: '上下',
    g: (n, S) => {
      const c = [...rng(n), ...rng(n - 2).map((k) => n - 2 - k)];
      return rng(S).map((s) => ({ s, i: c[s % c.length], l: 1 }));
    },
  },
  updown16: {
    name: '16 分の上下',
    g: (n, S) => {
      const c = [...rng(n), ...rng(n - 2).map((k) => n - 2 - k)];
      return rng(S * 2).map((h) => ({ s: h / 2, i: c[h % c.length], l: 0.5 }));
    },
  },
  alberti: {
    name: 'アルベルティ・バス',
    g: (n, S) => {
      const a = [1, n - 1, Math.min(2, n - 1), n - 1];
      return [{ s: 0, i: 0, l: S }, ...rng(S).map((s) => ({ s, i: a[s % 4], l: 1 }))];
    },
  },
  three: {
    name: 'スリーフィンガー',
    g: (n, S) =>
      rng(S).map((s) =>
        s % 2 === 0
          ? { s, i: (s >> 1) % 2 ? Math.min(3, n - 1) : 0, l: 2 }
          : { s, i: (s >> 1) % 2 ? n - 2 : n - 1, l: 1 },
      ),
  },
};
export const PAT_ORDER: readonly BuiltinPat[] = [
  'whole',
  'strum',
  'beat8',
  'eighth',
  'oom',
  'offbeat',
  'bossa',
  'up',
  'down',
  'updown',
  'updown16',
  'alberti',
  'three',
];

/** 奏法の id: 組み込み（PAT_ORDER）か、自分で作った奏法（u1・u2 …） */
export type PatId = string;
/**
 * 自分で作った奏法。1 周 len 歩（res は 1 歩の長さで、1 は 8 分音符・0.5 は 16 分音符）の格子に、
 * 弾く所 [歩, 段] を並べる。段 0 はベース、1 から上は和音の上の声部を低い順に。和音の音が足りない段は弾かない
 */
export interface CustomPat {
  id: string;
  name: string;
  res: 1 | 0.5;
  len: number;
  cells: [number, number][];
}
/** 作った奏法の段の数（ベースと上の 5 声） */
export const PAT_ROWS = 6;
const CUSTOM = new Map<string, CustomPat>();
/** 曲の作った奏法を登録する（読み込み・編集のたび） */
export function setCustomPats(list: readonly CustomPat[]): void {
  CUSTOM.clear();
  for (const p of list) CUSTOM.set(p.id, p);
}
export const customPats = (): CustomPat[] => [...CUSTOM.values()];
export const isBuiltin = (id: string): id is BuiltinPat => (PAT_ORDER as readonly string[]).includes(id);
/** 作った奏法を音の並びに: 1 周を S 歩までくり返す */
function customG(p: CustomPat): (n: number, S: number) => PatNote[] {
  return (n, S) => {
    const out: PatNote[] = [],
      cyc = p.len * p.res;
    if (cyc <= 0) return out;
    for (let base = 0; base < S; base += cyc)
      for (const [k, r] of p.cells) {
        const s = base + k * p.res;
        if (s < S && r < n) out.push({ s, i: r, l: p.res });
      }
    return out.sort((a, b) => a.s - b.s);
  };
}
/** 奏法を id から引く。見つからなければ上下 */
export function patOf(id: PatId): { name: string; g: (n: number, S: number, bs?: number, bar?: number) => PatNote[] } {
  if (isBuiltin(id)) return PATS[id];
  const c = CUSTOM.get(id);
  return c ? { name: c.name, g: customG(c) } : PATS.updown;
}
/**
 * 奏法を格子へ写す（作った奏法の下書き）。1 小節 bar 歩を res の刻みで、ベースを除く上の声部は段 1 から。
 * 和音全部は全段、上の声部すべては段 1 から上
 */
export function toGrid(id: PatId, res: 1 | 0.5, bar: number, bs = 2, n = 5): [number, number][] {
  const cells = new Set<string>(),
    S = bar,
    all = Array.from({ length: n }, (_, r) => r);
  for (const x of patOf(id).g(n, S, bs, bar)) {
    const k = Math.round(x.s / res);
    if (k * res >= S) continue;
    const rows = x.i === 'all' ? all : x.i === 'up' ? all.slice(1) : [x.i];
    for (const r of rows) cells.add(`${k},${r}`);
  }
  return [...cells].map((c) => c.split(',').map(Number) as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * 鳴らす音の高さ。作った奏法では格子の段（ベースと上の 5 声）に合わせ、足りない分は上の声部をオクターブ上へ重ねて 6 音にする
 */
export function tonesOf(c: Chord, k: Key, pat: PatId): number[] {
  const t = voicing(c, k);
  if (isBuiltin(pat)) return t;
  /* 上の声部をオクターブ上げた音のうち、今の一番上より高いものを順に足す */
  for (let j = 1; t.length < PAT_ROWS && j < 20; j++) {
    const c = t[j] + 12;
    if (c > (t.at(-1) as number)) t.push(c);
  }
  return t;
}

export type VoiceId = 'gtr' | 'cgt' | 'harp' | 'pf' | 'ep' | 'org' | 'str' | 'pad' | 'brs' | 'mar' | 'vib' | 'bell';
export const VOICES: Record<VoiceId, string> = {
  gtr: 'アコースティックギター',
  cgt: 'クラシックギター',
  harp: 'ハープ',
  pf: 'ピアノ',
  ep: 'エレピ',
  org: 'オルガン',
  str: 'ストリングス',
  pad: 'シンセパッド',
  brs: 'ブラス',
  mar: 'マリンバ',
  vib: 'ビブラフォン',
  bell: 'ベル',
};
export const VOICE_ORDER: readonly VoiceId[] = [
  'gtr',
  'cgt',
  'harp',
  'pf',
  'ep',
  'org',
  'str',
  'pad',
  'brs',
  'mar',
  'vib',
  'bell',
];

/** 奏法の小さな図（1 小節 8 歩・5 音） */
export function patGlyph(p: PatId, cls = ''): string {
  let s = `<svg class="${cls}" viewBox="0 0 42 16" aria-hidden="true">`;
  for (const v of patOf(p).g(5, 8, 2, 8)) {
    const x = 3 + v.s * 5.1;
    if (v.i === 'up') s += `<path class="cp-gs" d="M${x} 2V9"/>`;
    else if (v.i === 'all')
      s +=
        `<path class="cp-gs" d="M${x} 2V14"/>` +
        (v.l > 2 ? `<path class="cp-gt" d="M${x} 8H${(x + v.l * 4.6).toFixed(1)}"/>` : '');
    else s += `<circle class="cp-gd" cx="${x.toFixed(1)}" cy="${14 - v.i * 3}" r="1.7"/>`;
  }
  return `${s}</svg>`;
}

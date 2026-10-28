/**
 * 音律とうなり（DOM に依存しない）: 音律の 12 音の高さ、和音の音と部分音、音の組ごとの一致する部分音とうなり、
 * 調ごとの主和音の音程。音律は 5 度の連鎖 E♭–B♭–…–G♯ のどの 5 度を何コンマ狭めるかで決め
 * （J. M. Barbour, Tuning and Temperament, 1951）、純正律だけは比で与える
 */
import { inharm, KEY_HI, KEY_LO, keyString, noteHz, type PianoType, pianoTypeOf, tuning } from '../piano/strings';

const L2 = Math.log2;
/** ピタゴラス・コンマ、シントニック・コンマ、スキスマ [セント] */
export const PC = 1200 * L2(531441 / 524288),
  SC = 1200 * L2(81 / 80),
  SCH = PC - SC;
/** 純正の 5 度・長 3 度・短 3 度 [セント] */
export const P5 = 1200 * L2(3 / 2),
  M3 = 1200 * L2(5 / 4),
  m3 = 1200 * L2(6 / 5);

/** 5 度の連鎖のピッチクラス E♭ B♭ F C G D A E B F♯ C♯ G♯。5 度の番号 i は CHAIN[i]–CHAIN[i + 1]（G♯–E♭ は残り） */
const CHAIN = [3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1, 8];
const fill = (v: number): number[] => Array(11).fill(v);
/** 5 度の番号 idx を v [セント] ずつ狭める（0 E♭–B♭ 1 B♭–F 2 F–C 3 C–G 4 G–D 5 D–A 6 A–E 7 E–B 8 B–F♯ 9 F♯–C♯ 10 C♯–G♯） */
const narrowAt = (idx: readonly number[], v: number, more: Record<number, number> = {}): number[] => {
  const a = fill(0);
  for (const i of idx) a[i] = v;
  for (const [i, x] of Object.entries(more)) a[Number(i)] = x;
  return a;
};

export interface Temperament {
  v: string;
  name: string;
  /** 5 度ごとに狭める量 [セント]（11 個） */
  narrow?: readonly number[];
  /** 純正律: C からの比（12 音） */
  ratio?: readonly number[];
}

export const TEMPERAMENTS: readonly Temperament[] = [
  { v: 'et', name: '平均律', narrow: fill(PC / 12) },
  /* C 長調の 5 限界（Malcolm。D = 9/8、B♭ = 16/9） */
  {
    v: 'just',
    name: '純正律',
    ratio: [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 16 / 9, 15 / 8],
  },
  /* 純正の 5 度だけ。ウルフは G♯–E♭ */
  { v: 'pyth', name: 'ピタゴラス', narrow: fill(0) },
  { v: 'mt4', name: '1/4 コンマ・ミーントーン', narrow: fill(SC / 4) },
  { v: 'mt6', name: '1/6 コンマ・ミーントーン', narrow: fill(SC / 6) },
  /* C–G・G–D・D–A・B–F♯ をピタゴラス・コンマの 1/4 */
  { v: 'wm3', name: 'ヴェルクマイスター III', narrow: narrowAt([3, 4, 5, 8], PC / 4) },
  /* C–G・G–D・D–A・A–E をシントニック・コンマの 1/4、F♯–C♯ をスキスマ */
  { v: 'kb3', name: 'キルンベルガー III', narrow: narrowAt([3, 4, 5, 6], SC / 4, { 9: SCH }) },
  /* F–C から E–B までをピタゴラス・コンマの 1/6（今ヴァロッティと呼ばれている版） */
  { v: 'val', name: 'ヴァロッティ', narrow: narrowAt([2, 3, 4, 5, 6, 7], PC / 6) },
  /* C–G から B–F♯ までをピタゴラス・コンマの 1/6（T. Young, 1800 の第 2） */
  { v: 'yg2', name: 'ヤング 第 2', narrow: narrowAt([3, 4, 5, 6, 7, 8], PC / 6) },
];
export const temperamentOf = (v: string): Temperament => TEMPERAMENTS.find((t) => t.v === v) ?? TEMPERAMENTS[0];

/** C を 0 とした 12 音の高さ [セント]（0〜1200） */
export function cents(t: Temperament): number[] {
  if (t.ratio) return t.ratio.map((r) => 1200 * L2(r));
  const c = Array(12).fill(0) as number[];
  let x = 0;
  for (let i = 0; i < 11; i++) {
    x += P5 - (t.narrow?.[i] ?? 0);
    c[CHAIN[i + 1]] = x;
  }
  const c0 = c[0];
  return c.map((v) => (((v - c0) % 1200) + 1200) % 1200);
}

export const pcOf = (m: number): number => ((m % 12) + 12) % 12;

/** ピッチクラスごとの平均律からのずれ [セント]。音律の C を主音 ton へ移し、A を 0 にそろえる（A4 は基準ピッチのまま） */
export function deviations(tem: string, ton: number): number[] {
  const d = cents(temperamentOf(tem)).map((v, p) => {
      const x = v - 100 * p;
      return x > 600 ? x - 1200 : x;
    }),
    r = Array.from({ length: 12 }, (_, p) => d[pcOf(p - ton)]),
    a = r[9];
  return r.map((v) => v - a);
}

/* ---------- 和音と音程 ---------- */
export interface Chord {
  v: string;
  name: string;
  /** 根音からの半音数 */
  iv: readonly number[];
}
/** 和音（3 和音と、ピアノの調律で聴く開いた形） */
export const CHORDS: readonly Chord[] = [
  { v: 'maj', name: '長三和音', iv: [0, 4, 7] },
  { v: 'min', name: '短三和音', iv: [0, 3, 7] },
  { v: 'dom7', name: '属七の和音', iv: [0, 4, 7, 10] },
  { v: 'open', name: '開いた長三和音', iv: [-12, 0, 7, 16] },
];
/** 2 音の音程 */
export const INTERVALS: readonly Chord[] = [
  { v: 'M3', name: '長 3 度', iv: [0, 4] },
  { v: 'm3', name: '短 3 度', iv: [0, 3] },
  { v: 'P4', name: '完全 4 度', iv: [0, 5] },
  { v: 'P5', name: '完全 5 度', iv: [0, 7] },
  { v: 'M6', name: '長 6 度', iv: [0, 9] },
  { v: 'M10', name: '長 10 度', iv: [0, 16] },
  { v: 'M17', name: '長 17 度', iv: [0, 28] },
  { v: 'P8', name: 'オクターブ', iv: [0, 12] },
];
export const chordOf = (v: string): Chord => [...CHORDS, ...INTERVALS].find((c) => c.v === v) ?? CHORDS[0];
/** 短調の主和音として扱うか（調ごとの比較で短 3 度を見る） */
export const isMinor = (v: string): boolean => v === 'min' || v === 'm3';

const IV_NAME: Record<number, string> = {
  0: 'ユニゾン',
  1: '短 2 度',
  2: '長 2 度',
  3: '短 3 度',
  4: '長 3 度',
  5: '完全 4 度',
  6: '増 4 度',
  7: '完全 5 度',
  8: '短 6 度',
  9: '長 6 度',
  10: '短 7 度',
  11: '長 7 度',
  12: 'オクターブ',
  15: '短 10 度',
  16: '長 10 度',
  19: '完全 12 度',
  22: '短 14 度',
  24: '2 オクターブ',
  28: '長 17 度',
};
export const intervalName = (d: number): string => IV_NAME[d] ?? `${d} 半音`;

/** 純正の比 上 / 下 = num / den（下の第 num 部分音と上の第 den 部分音が一致する）。協和しない音程は null */
const RATIO: Record<number, readonly [number, number]> = {
  0: [1, 1],
  3: [6, 5],
  4: [5, 4],
  5: [4, 3],
  7: [3, 2],
  8: [8, 5],
  9: [5, 3],
};
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** 半音数 d の音程で一致する部分音 [下の番号, 上の番号]。10 番より上の部分音で一致するものは扱わない */
export function coincidence(d: number): [number, number] | null {
  const r = RATIO[d % 12];
  if (!r) return null;
  const num = r[0] * 2 ** Math.floor(d / 12),
    g = gcd(num, r[1]);
  return num / g > 10 ? null : [num / g, r[1] / g];
}

/* ---------- 音色と部分音 ---------- */
export type Timbre = 'sine' | 'organ' | 'piano';
export const TIMBRES: readonly (readonly [Timbre, string])[] = [
  ['sine', '正弦波'],
  ['organ', 'オルガン'],
  ['piano', 'ピアノ'],
];
/** 部分音の数 */
export const PARTIALS = 10;
/**
 * 第 n 部分音の振幅（第 1 部分音を 1）。オルガンは第 8 部分音まで 1/n。ピアノは打弦点を弦の 1/8 とした
 * |sin(πn/8)| / n（第 8 部分音が抜ける）を第 1 部分音で 1 にそろえる
 */
export function amp(tb: Timbre, n: number): number {
  if (tb === 'sine') return n === 1 ? 1 : 0;
  if (tb === 'organ') return n <= 8 ? 1 / n : 0;
  return n <= PARTIALS ? Math.abs(Math.sin((Math.PI * n) / 8)) / n / Math.sin(Math.PI / 8) : 0;
}

/** 音を決める設定 */
export interface Setup {
  tem: string;
  /** 音律の主音（ピッチクラス） */
  ton: number;
  a4: number;
  tb: Timbre;
  /** ピアノの大きさ・ストレッチ調律 */
  pt: string;
  st: boolean;
}

/** ピアノの鍵ごとの非調和性係数 B とストレッチのずれ [セント]（ピアノ音響モデルの弦から求める。機種・A4 ごとに覚える） */
const pianoCache = new Map<string, { B: number[]; st: number[] }>();
function piano(t: PianoType, a4: number): { B: number[]; st: number[] } {
  const key = `${t.v}:${a4}`;
  let p = pianoCache.get(key);
  if (!p) {
    const f = tuning(t, a4, true),
      B: number[] = [],
      st: number[] = [];
    for (let k = KEY_LO; k <= KEY_HI; k++) {
      B.push(inharm(keyString(k, t, noteHz(k, a4))));
      st.push(1200 * L2(f[k - KEY_LO] / noteHz(k, a4)));
    }
    p = { B, st };
    pianoCache.set(key, p);
  }
  return p;
}
const keyIdx = (m: number): number => Math.max(KEY_LO, Math.min(KEY_HI, m)) - KEY_LO;

/** 音 m の非調和性係数（ピアノ以外は 0） */
export const bOf = (s: Setup, m: number): number =>
  s.tb === 'piano' ? piano(pianoTypeOf(s.pt), s.a4).B[keyIdx(m)] : 0;
/** 音 m の第 1 部分音 [Hz]。dev は deviations の結果 */
export function f1Of(s: Setup, dev: readonly number[], m: number): number {
  const st = s.tb === 'piano' && s.st ? piano(pianoTypeOf(s.pt), s.a4).st[keyIdx(m)] : 0;
  return s.a4 * 2 ** ((m - 69) / 12 + (dev[pcOf(m)] + st) / 1200);
}
/** 音 m の第 n 部分音 [Hz]。硬い弦は f_n = n f₁ √((1 + B n²) / (1 + B))（H. Fletcher, JASA 36, 1964） */
export function partialOf(s: Setup, dev: readonly number[], m: number, n: number): number {
  const B = bOf(s, m);
  return n * f1Of(s, dev, m) * Math.sqrt((1 + B * n * n) / (1 + B));
}

export interface Partial {
  n: number;
  f: number;
  a: number;
}
export interface Note {
  /** MIDI のノート番号（C4 = 60） */
  m: number;
  f: number;
  /** 平均律からのずれ [セント] */
  dev: number;
  B: number;
  parts: Partial[];
}
export interface Pair {
  lo: Note;
  hi: Note;
  /** 半音数 */
  d: number;
  /** 一致する部分音 [下, 上]（協和しない音程は null） */
  c: [number, number] | null;
  /** 一致する部分音の周波数 [Hz]（下・上） */
  fl: number;
  fh: number;
  /** うなり [回/秒]（下 − 上。正なら音程が純正より狭い） */
  b: number;
  /** 一致する部分音どうしのずれ [セント]（正なら純正より広い） */
  ct: number;
  /** 一致する部分音の振幅（下・上） */
  al: number;
  ah: number;
}

/** 和音の音（根音 root の MIDI 番号と、根音からの半音数）と、音の組ごとのうなり */
export function analyze(
  s: Setup,
  root: number,
  iv: readonly number[],
): { dev: number[]; notes: Note[]; pairs: Pair[] } {
  const dev = deviations(s.tem, s.ton);
  const notes = iv.map((k): Note => {
    const m = root + k,
      parts: Partial[] = [];
    for (let n = 1; n <= PARTIALS; n++) {
      const a = amp(s.tb, n);
      if (a > 0) parts.push({ n, f: partialOf(s, dev, m, n), a });
    }
    return { m, f: f1Of(s, dev, m), dev: dev[pcOf(m)], B: bOf(s, m), parts };
  });
  const pairs: Pair[] = [];
  for (let i = 0; i < notes.length; i++)
    for (let j = i + 1; j < notes.length; j++) {
      const lo = notes[i],
        hi = notes[j],
        d = hi.m - lo.m,
        c = coincidence(d);
      const p: Pair = { lo, hi, d, c, fl: 0, fh: 0, b: 0, ct: 0, al: 0, ah: 0 };
      if (c) {
        p.fl = partialOf(s, dev, lo.m, c[0]);
        p.fh = partialOf(s, dev, hi.m, c[1]);
        p.b = p.fl - p.fh;
        p.ct = 1200 * L2(p.fh / p.fl);
        p.al = amp(s.tb, c[0]);
        p.ah = amp(s.tb, c[1]);
      }
      pairs.push(p);
    }
  return { dev, notes, pairs };
}

/** うなりの速さと、一致する部分音のずれ・振幅（Pair と Coin に共通） */
export interface Beat {
  b: number;
  ct: number;
  al: number;
  ah: number;
}
/**
 * 一致する部分音が両方鳴っているか（部分音どうしのうなり）。片方でも欠けると、同じ速さの 2 次のうなりになる
 * （2 つの音の比が整数比から少しずれると、純音どうしでも波形の移り変わりがうなりとして聞こえる。R. Plomp, JASA 42, 1967）
 */
export const firstOrder = (x: Beat): boolean => x.al > 0 && x.ah > 0;
/** うならない（一致する部分音の高さがそろっている） */
export const pure = (x: Beat): boolean => Math.abs(x.ct) < 0.05;

/** 図の目盛りに使う一致: 音の組 i の、下の第 nl 部分音と上の第 nh 部分音（組の一致する部分音の j 倍） */
export interface Coin extends Beat {
  /** 音の組の番号と、下・上の音（MIDI のノート番号） */
  i: number;
  lo: number;
  hi: number;
  j: number;
  nl: number;
  nh: number;
  fl: number;
  fh: number;
}
/**
 * 音の組ごとの一致する部分音を、1 倍・2 倍…と鳴っている部分音の範囲で並べる。一致する部分音のどちらかがない音色
 * （正弦波など）では、1 倍の組だけを 2 次のうなりとして並べる
 */
export function coins(r: { notes: readonly Note[]; pairs: readonly Pair[] }): Coin[] {
  const out: Coin[] = [];
  const part = (nt: Note, n: number) => nt.parts.find((p) => p.n === n);
  r.pairs.forEach((p, i) => {
    if (!p.c) return;
    if (!firstOrder(p)) {
      out.push({
        i,
        lo: p.lo.m,
        hi: p.hi.m,
        j: 1,
        nl: p.c[0],
        nh: p.c[1],
        fl: p.fl,
        fh: p.fh,
        b: p.b,
        ct: p.ct,
        al: p.al,
        ah: p.ah,
      });
      return;
    }
    for (let j = 1; p.c[0] * j <= PARTIALS && p.c[1] * j <= PARTIALS; j++) {
      const a = part(p.lo, p.c[0] * j),
        b = part(p.hi, p.c[1] * j);
      if (a && b)
        out.push({
          i,
          lo: p.lo.m,
          hi: p.hi.m,
          j,
          nl: a.n,
          nh: b.n,
          fl: a.f,
          fh: b.f,
          b: a.f - b.f,
          ct: 1200 * L2(b.f / a.f),
          al: a.a,
          ah: b.a,
        });
    }
  });
  return out;
}

/**
 * 和音を純正にしたときの、各音の周波数の比（互いに素な整数）。一致する部分音を持つ組をたどって決める。
 * 長三和音は 4 : 5 : 6、属七の和音は 20 : 25 : 30 : 36（B♭ は G の短 3 度上）。たどれない音は平均律の比で近似する
 */
export function justRatios(iv: readonly number[]): number[] {
  /* 分数 [分子, 分母] */
  const q: ([number, number] | null)[] = iv.map((_, i) => (i ? null : [1, 1]));
  for (let pass = 0; pass < iv.length; pass++)
    for (let a = 0; a < iv.length; a++)
      for (let b = 0; b < iv.length; b++) {
        const qa = q[a];
        if (a === b || !qa || q[b] || iv[b] <= iv[a]) continue;
        const c = coincidence(iv[b] - iv[a]);
        /* 上 / 下 = c[0] / c[1] */
        if (c) q[b] = [qa[0] * c[0], qa[1] * c[1]];
      }
  /* 根音より下の音（開いた長三和音の C3 など）は、上の音から下へたどる */
  for (let pass = 0; pass < iv.length; pass++)
    for (let a = 0; a < iv.length; a++) {
      const qa = q[a];
      if (!qa) continue;
      for (let b = 0; b < iv.length; b++) {
        if (q[b] || iv[b] >= iv[a]) continue;
        const c = coincidence(iv[a] - iv[b]);
        if (c) q[b] = [qa[0] * c[1], qa[1] * c[0]];
      }
    }
  const fr = q.map((x, i): [number, number] => x ?? [Math.round(1000 * 2 ** ((iv[i] - iv[0]) / 12)), 1000]);
  const den = fr.reduce((m, [, d]) => (m * d) / gcd(m, d), 1),
    v = fr.map(([n, d]) => (n * den) / d),
    g = v.reduce((a, b) => gcd(a, b));
  return v.map((x) => x / g);
}

/** うなりの包絡（2 つの部分音の和の振幅を、振幅の和で割った 0〜1） */
export function envelope(p: Beat, t: number): number {
  const a = p.al,
    b = p.ah;
  if (!(a + b)) return 1;
  return Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(2 * Math.PI * p.b * t))) / (a + b);
}

/** 5 度の順（C G D A E B F♯ C♯ G♯ E♭ B♭ F） */
export const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5] as const;

export interface KeyStat {
  /** 主音（ピッチクラス） */
  p: number;
  /** 主和音の 5 度・3 度（短調は短 3 度）の、純正からのずれ [セント] */
  p5: number;
  t3: number;
  /** 主音を octave に置いたときの 3 度・5 度のうなり [回/秒]（下 − 上） */
  b3: number;
  b5: number;
}
/** 12 の調の主和音の音程 */
export function keyStats(s: Setup, octave: number, minor: boolean): KeyStat[] {
  const dev = deviations(s.tem, s.ton);
  return Array.from({ length: 12 }, (_, p) => {
    const r = 12 * (octave + 1) + p,
      t = minor ? 3 : 4,
      size = (k: number) => 100 * k + dev[(p + k) % 12] - dev[p];
    return {
      p,
      p5: size(7) - P5,
      t3: size(t) - (minor ? m3 : M3),
      b3: minor
        ? partialOf(s, dev, r, 6) - partialOf(s, dev, r + 3, 5)
        : partialOf(s, dev, r, 5) - partialOf(s, dev, r + 4, 4),
      b5: partialOf(s, dev, r, 3) - partialOf(s, dev, r + 7, 2),
    };
  });
}

/** 音名（C4 = 60） */
export const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;
export const noteName = (m: number): string => `${NAMES[pcOf(m)]}${Math.floor(m / 12) - 1}`;

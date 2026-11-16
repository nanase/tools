/**
 * コード進行のページの曲（DOM に依存しない）: 和音の地図（トネッツ）の格子、和音の並び、調・拍子・小節の計算、
 * 緊張の高さ、保存の形式（JSON）、サンプルを書くための短い記法。
 * 和音は根音の音名（C = 0）と種類で持ち、地図のどの三角形に置いたかも覚えておく（同じ和音が地図に何か所もあるため）
 */
import {
  type Chord,
  type Fn,
  findNamed,
  func,
  type Group,
  type Key,
  type Lv,
  md,
  QUAL_ORDER,
  QUALS,
  type Qual,
  trans,
  VOICE_ORDER,
  type VoiceId,
} from './theory';

/* ---------- 地図の格子 ---------- */
/** 地図の三角形。格子の点 (i, j) と、上向き（長三和音）か下向き（短三和音）か */
export interface Place {
  i: number;
  j: number;
  up: boolean;
}
/** 地図に描く格子の範囲。どの長三和音・短三和音も少なくとも 2 か所に出る */
export const LAT = { i0: -3, i1: 4, j0: -2, j1: 2 } as const;
/** 格子の点の音名: 右へ 1 つで完全 5 度、右上へ 1 つで長 3 度 */
export const pcAt = (i: number, j: number): number => md(7 * i + 4 * j);
/** 三角形の三和音（上向きは左下の点が根音の長三和音、下向きは長 3 度上が根音の短三和音） */
export function triadOf(p: Place): { r: number; q: 'M' | 'm' } {
  const a = pcAt(p.i, p.j);
  return p.up ? { r: a, q: 'M' } : { r: md(a + 4), q: 'm' };
}
/** 格子の点の位置（横 1 が隣の点。上の段は半分右へずれる） */
export const pointAt = (i: number, j: number): [number, number] => [i + j / 2, (j * Math.sqrt(3)) / 2];
/** 三角形の頂点 */
export function cornersOf(p: Place): [number, number][] {
  return p.up
    ? [pointAt(p.i, p.j), pointAt(p.i + 1, p.j), pointAt(p.i, p.j + 1)]
    : [pointAt(p.i + 1, p.j), pointAt(p.i + 1, p.j + 1), pointAt(p.i, p.j + 1)];
}
export function centroidOf(p: Place): [number, number] {
  const c = cornersOf(p);
  return [(c[0][0] + c[1][0] + c[2][0]) / 3, (c[0][1] + c[1][1] + c[2][1]) / 3];
}
const dist = (a: Place, b: Place): number => {
  const p = centroidOf(a),
    q = centroidOf(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
};
/** 辺を共有する隣の三角形か（2 音を共有する） */
export const adjacent = (a: Place, b: Place): boolean => {
  const d = dist(a, b);
  return d > 0.01 && d < 0.6;
};
export const inLattice = (p: Place): boolean => p.i >= LAT.i0 && p.i <= LAT.i1 && p.j >= LAT.j0 && p.j <= LAT.j1;
export const ALL_PLACES: readonly Place[] = (() => {
  const out: Place[] = [];
  for (let j = LAT.j0; j <= LAT.j1; j++)
    for (let i = LAT.i0; i <= LAT.i1; i++) for (const up of [true, false]) out.push({ i, j, up });
  return out;
})();
export const samePlace = (a: Place, b: Place): boolean => a.i === b.i && a.j === b.j && a.up === b.up;
/** 和音を置く三角形の向き: 長三和音の系統は上向き、短三和音と減三和音の系統は下向き */
const upFor = (q: Qual): boolean => QUALS[q].b === 'M';
/** 根音 r・種類 q の和音を置く三角形のうち、from に最も近いもの（なければ地図の真ん中に近いもの） */
export function nearestPlace(r: number, q: Qual, from: Place | null): Place {
  const up = upFor(q),
    cands = ALL_PLACES.filter((p) => p.up === up && triadOf(p).r === md(r)),
    o = from ? centroidOf(from) : pointAt((LAT.i0 + LAT.i1) / 2 - 0.5, (LAT.j0 + LAT.j1) / 2);
  let best = cands[0],
    bd = Number.POSITIVE_INFINITY;
  for (const p of cands) {
    const c = centroidOf(p),
      d = Math.hypot(c[0] - o[0], c[1] - o[1]);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/* ---------- 曲 ---------- */
export type StyleId = 'pop' | 'rock' | 'ballad' | 'funk' | 'disco' | 'reggae' | 'shuffle' | 'jazz' | 'bossa' | 'samba';
export const STYLE_ORDER: readonly StyleId[] = [
  'pop',
  'rock',
  'ballad',
  'funk',
  'disco',
  'reggae',
  'shuffle',
  'jazz',
  'bossa',
  'samba',
];
export const STYLE_NAMES: Record<StyleId, string> = {
  pop: 'ポップ',
  rock: 'ロック',
  ballad: 'バラード',
  funk: 'ファンク',
  disco: 'ディスコ',
  reggae: 'レゲエ',
  shuffle: 'シャッフル',
  jazz: 'ジャズ',
  bossa: 'ボサノバ',
  samba: 'サンバ',
};
export type GtrId = 'gtr' | 'cgt';
export type KeysId = Exclude<VoiceId, GtrId>;
export const KEYS_ORDER = VOICE_ORDER.filter((v): v is KeysId => v !== 'gtr' && v !== 'cgt');
export const GTR_ORDER: readonly GtrId[] = ['gtr', 'cgt'];
export type Meter = 3 | 4;

/** 和音 1 つ。b は拍の数（0 は 1 小節）、at は地図の三角形、mod はここからの調（転調。なければ null） */
export interface SChord {
  id: number;
  r: number;
  q: Qual;
  b: number;
  at: Place;
  mod: Key | null;
}
export interface Song {
  name: string;
  key: Key;
  meter: Meter;
  bpm: number;
  style: StyleId;
  keys: KeysId;
  gtr: GtrId;
  chords: SChord[];
}
let uid = 1;
export const newId = (): number => uid++;

/** 1 つの和音の計算結果 */
export interface Entry {
  c: SChord;
  k: number;
  /** この和音での調 */
  key: Key;
  /** 調からの度数で表した和音（theory.ts の関数に渡す形） */
  ch: Chord;
  beats: number;
  /** 曲の頭からの拍 */
  start: number;
  /** 始まる小節（1 から） */
  bar: number;
  fn: Fn;
  /** 前の和音からのつながり（転調をまたぐと lv −1） */
  tr: { lv: Lv; name: string } | null;
  grp: Group | null;
  /** 緊張の高さ（0〜1） */
  tension: number;
}
export const degreeChord = (c: Pick<SChord, 'r' | 'q'>, key: Key): Chord => ({ d: md(c.r - key.t), q: c.q, inv: 0 });
/** 緊張の高さ: トニック 0.18・サブドミナント 0.5・ドミナント 0.86 に、短三和音・減三和音・属七の形を少し加減 */
export function tensionOf(ch: Chord, key: Key): number {
  const f = func(ch, key),
    q = QUALS[ch.q];
  let t = f === 'T' ? 0.18 : f === 'S' ? 0.5 : 0.86;
  if (q.b === 'm') t -= 0.04;
  if (q.b === 'd') t += 0.06;
  if (q.iv.includes(4) && q.iv.includes(10) && ch.d !== 7) t += 0.04;
  return Math.max(0.05, Math.min(1, t));
}
export function compute(song: Song): { entries: Entry[]; beats: number; bars: number } {
  let key = song.key,
    start = 0;
  const entries: Entry[] = song.chords.map((c, k) => {
    if (c.mod) key = c.mod;
    const ch = degreeChord(c, key),
      beats = c.b > 0 ? c.b : song.meter,
      e: Entry = {
        c,
        k,
        key,
        ch,
        beats,
        start,
        bar: Math.floor(start / song.meter) + 1,
        fn: func(ch, key),
        tr: null,
        grp: null,
        tension: tensionOf(ch, key),
      };
    start += beats;
    return e;
  });
  entries.forEach((e, k) => {
    const p = entries[k - 1];
    if (p) e.tr = trans(p.ch, p.key, e.ch, e.key);
  });
  findNamed(entries.map((e) => ({ c: e.ch, key: e.key, i: e.k }))).forEach((g, k) => {
    entries[k].grp = g;
  });
  return { entries, beats: start, bars: Math.ceil(start / song.meter) };
}
/** k 番目の和音での調 */
export function keyAt(song: Song, k: number): Key {
  let key = song.key;
  for (let j = 0; j <= Math.min(k, song.chords.length - 1); j++)
    if (song.chords[j].mod) key = song.chords[j].mod as Key;
  return key;
}

/* ---------- 保存の形式 ---------- */
export interface SongFile {
  v: 2;
  name: string;
  key: Key;
  meter: Meter;
  bpm: number;
  style: StyleId;
  keys: KeysId;
  gtr: GtrId;
  chords: { r: number; q: Qual; b: number; i: number; j: number; up: boolean; mod?: Key }[];
}
export const toFile = (s: Song): SongFile => ({
  v: 2,
  name: s.name,
  key: { ...s.key },
  meter: s.meter,
  bpm: s.bpm,
  style: s.style,
  keys: s.keys,
  gtr: s.gtr,
  chords: s.chords.map((c) => ({
    r: c.r,
    q: c.q,
    b: c.b,
    i: c.at.i,
    j: c.at.j,
    up: c.at.up,
    ...(c.mod ? { mod: { ...c.mod } } : {}),
  })),
});
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
const oneOf = <T extends string | number>(v: unknown, list: readonly T[]): T | null =>
  (list as readonly unknown[]).includes(v) ? (v as T) : null;
function readKey(o: unknown): Key | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as Record<string, unknown>,
    t = int(x.t, 0, 11),
    m = oneOf<Key['m']>(x.m, ['maj', 'min']);
  return t === null || !m ? null : { t, m };
}
export const LENGTHS = [0, 1, 2, 3, 4, 6, 8] as const;
export const BPM_MIN = 40,
  BPM_MAX = 220;
/** 保存した曲を読む。形が違えば null */
export function fromFile(o: unknown): Song | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as Record<string, unknown>,
    key = readKey(x.key),
    meter = oneOf<Meter>(x.meter, [3, 4]),
    bpm = int(x.bpm, BPM_MIN, BPM_MAX),
    style = oneOf<StyleId>(x.style, STYLE_ORDER),
    /* ベルは外した音色。近いビブラフォンで開く */
    keys = x.keys === 'bell' ? 'vib' : oneOf<KeysId>(x.keys, KEYS_ORDER),
    gtr = oneOf<GtrId>(x.gtr, GTR_ORDER);
  if (x.v !== 2 || !key || !meter || bpm === null || !style || !keys || !gtr) return null;
  if (!Array.isArray(x.chords) || x.chords.length > 500) return null;
  const chords: SChord[] = [];
  for (const r of x.chords) {
    if (!r || typeof r !== 'object') return null;
    const c = r as Record<string, unknown>,
      root = int(c.r, 0, 11),
      q = oneOf<Qual>(c.q, QUAL_ORDER),
      b = int(c.b, 0, 16),
      i = int(c.i, LAT.i0, LAT.i1),
      j = int(c.j, LAT.j0, LAT.j1),
      mod = c.mod === undefined ? null : readKey(c.mod);
    if (root === null || !q || b === null || i === null || j === null || typeof c.up !== 'boolean') return null;
    if (c.mod !== undefined && !mod) return null;
    chords.push({ id: newId(), r: root, q, b, at: { i, j, up: c.up }, mod });
  }
  return { name: typeof x.name === 'string' ? x.name.slice(0, 60) : '', key, meter, bpm, style, keys, gtr, chords };
}

/* ---------- サンプルの記法 ---------- */
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 音名（C・F#・Bb）を音名の数に */
const pcOf = (s: string): number => md(NOTE[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0));
/** 調の記法（C・Am・F#m） */
export function parseKey(s: string): Key {
  const m = /^([A-G][#b]?)(m?)$/.exec(s);
  if (!m) throw new Error(`bad key: ${s}`);
  return { t: pcOf(m[1]), m: m[2] ? 'min' : 'maj' };
}
/**
 * 和音を空白で区切って並べる: 「C G Am Em」。後ろに :n で拍の数。「>D」「>Bm」で次の和音から転調。
 * 種類は theory.ts の QUALS の記号（なしは長三和音）
 */
export function parseChords(src: string, start: Place | null = null): SChord[] {
  const out: SChord[] = [];
  let prev = start,
    mod: Key | null = null;
  for (const tk of src.trim().split(/\s+/)) {
    if (tk.startsWith('>')) {
      mod = parseKey(tk.slice(1));
      continue;
    }
    const m = /^([A-G][#b]?)([^:]*)(?::(\d+))?$/.exec(tk);
    if (!m) throw new Error(`bad chord: ${tk}`);
    const q = (m[2] === '' ? 'M' : m[2]) as Qual;
    if (!(q in QUALS)) throw new Error(`bad quality: ${tk}`);
    const r = pcOf(m[1]),
      at = nearestPlace(r, q, prev);
    out.push({ id: newId(), r, q, b: Number(m[3] ?? 0), at, mod });
    mod = null;
    prev = at;
  }
  return out;
}

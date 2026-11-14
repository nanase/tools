/**
 * コード進行のページの曲（ブロックの列。DOM に依存しない）: ブロックの種類、並びから各ブロックの調・拍子・テンポ・奏法・音色と
 * 小節を決める計算、くり返しを展開した演奏の順、保存の形式（JSON）、サンプルを書くための短い記法
 */
import {
  type Chord,
  findNamed,
  type Group,
  type Key,
  type Lv,
  md,
  PAT_ORDER,
  type PatId,
  QUAL_ORDER,
  type Qual,
  trans,
  VOICE_ORDER,
  type VoiceId,
} from './theory';

/** ブロック。コードの b は拍の数（0 は拍子どおりの 1 小節）、p はこのコードだけの奏法（null は奏法ブロックに従う） */
export type Item =
  | ({ k: 'ch'; id: number; b: number; p: PatId | null } & Chord)
  | { k: 'key'; id: number; t: number; m: Key['m'] }
  | { k: 'met'; id: number; n: number; dn: number }
  | { k: 'tmp'; id: number; v: number }
  | { k: 'pat'; id: number; v: PatId }
  | { k: 'vce'; id: number; v: VoiceId }
  /** くり返しの始め */
  | { k: 'rs'; id: number }
  /** くり返しの終わり。n は演奏する回数（0 は無制限） */
  | { k: 're'; id: number; n: number };
export type Kind = Item['k'];
export type ChordItem = Extract<Item, { k: 'ch' }>;
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type ItemSpec = NoId<Item>;

let uid = 1;
export const withId = (s: ItemSpec): Item => ({ ...s, id: uid++ }) as Item;
export const copyItem = (it: Item): Item => ({ ...it, id: uid++ });

export interface State {
  key: Key;
  n: number;
  dn: number;
  bpm: number;
  pat: PatId;
  vce: VoiceId;
}
/** 何も置いていないときの状態 */
export const INIT: Readonly<State> = { key: { t: 0, m: 'maj' }, n: 4, dn: 4, bpm: 96, pat: 'updown', vce: 'gtr' };

export interface MarkEntry extends State {
  it: Exclude<Item, ChordItem>;
  i: number;
  /** 曲の頭からの位置（4 分音符の数） */
  q: number;
  /** このブロックの前の調 */
  prevKey: Key;
  /** 最初のコードより前にある、その種類で最初のブロック（「転調」ではなく「調」と出す） */
  first: boolean;
}
export interface ChordEntry extends State {
  it: ChordItem;
  i: number;
  /** コードの並びの何番目か */
  ci: number;
  q: number;
  /** 拍の数（拍子どおりなら拍子の分子） */
  beats: number;
  /** 長さ（4 分音符の数） */
  durQ: number;
  /** 長さ [s] */
  dur: number;
  /** 奏法ブロックの奏法 */
  defPat: PatId;
  /** このコードだけの奏法か */
  patOwn: boolean;
  /** 小節の頭: o はコードの頭からの拍、no は小節の番号 */
  bars: { o: number; no: number }[];
  prev: ChordEntry | null;
  /** 前のコードとの間にほかのブロックがない */
  adj: boolean;
  tr: { lv: Lv; name: string } | null;
  grp: Group | null;
}
export type Entry = MarkEntry | ChordEntry;
export const isChord = (e: Entry): e is ChordEntry => e.it.k === 'ch';

export interface Timeline {
  all: Entry[];
  chords: ChordEntry[];
  /** 曲の長さ（4 分音符の数。くり返しは展開しない） */
  totalQ: number;
  end: State;
}

export function compute(items: readonly Item[]): Timeline {
  const st: State = { ...INIT, key: { ...INIT.key } };
  let q = 0,
    pos = 0,
    bar = 1;
  const all: Entry[] = [],
    chords: ChordEntry[] = [],
    seen = new Set<Kind>();
  const newBar = () => {
    if (pos > 0) {
      pos = 0;
      bar++;
    }
  };
  items.forEach((it, i) => {
    if (it.k !== 'ch') {
      const prevKey = { ...st.key };
      if (it.k === 'key') st.key = { t: it.t, m: it.m };
      else if (it.k === 'met') {
        st.n = it.n;
        st.dn = it.dn;
        newBar();
      } else if (it.k === 'tmp') st.bpm = it.v;
      else if (it.k === 'pat') st.pat = it.v;
      else if (it.k === 'vce') st.vce = it.v;
      else newBar();
      all.push({ ...st, key: { ...st.key }, it, i, q, prevKey, first: !seen.has(it.k) && !chords.length });
      seen.add(it.k);
      return;
    }
    const beats = it.b > 0 ? it.b : st.n,
      durQ = beats * (4 / st.dn),
      bars: { o: number; no: number }[] = [];
    for (let k = 0; k < beats; k++) {
      if (pos === 0) bars.push({ o: k, no: bar });
      if (++pos >= st.n) {
        pos = 0;
        bar++;
      }
    }
    const e: ChordEntry = {
      ...st,
      key: { ...st.key },
      it,
      i,
      ci: chords.length,
      q,
      beats,
      durQ,
      dur: (durQ * 60) / st.bpm,
      pat: it.p ?? st.pat,
      defPat: st.pat,
      patOwn: it.p !== null,
      bars,
      prev: null,
      adj: false,
      tr: null,
      grp: null,
    };
    q += durQ;
    all.push(e);
    chords.push(e);
  });
  chords.forEach((e, j) => {
    const p = j ? chords[j - 1] : null;
    e.prev = p;
    e.adj = !!p && p.i === e.i - 1;
    e.tr = p ? trans(p.it, p.key, e.it, e.key) : null;
  });
  findNamed(chords.map((e) => ({ c: e.it, key: e.key, i: e.i }))).forEach((g, j) => {
    chords[j].grp = g;
  });
  return { all, chords, totalQ: q, end: { ...st, key: { ...st.key } } };
}

/* ---------- くり返しを展開した演奏の順 ---------- */
/** くり返しの始めの位置（i は終わりの位置）。手前の終わりか曲の頭まで戻る */
export function repeatStart(items: readonly Item[], i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    if (items[j].k === 'rs') return j + 1;
    if (items[j].k === 're') return j + 1;
  }
  return 0;
}
/** 演奏するコードの位置と、そのコードを含むくり返しの何回目か */
export interface Step {
  i: number;
  /** くり返しの終わりの id と回目（くり返しの中でなければ null） */
  rep: { id: number; pass: number } | null;
}
/** 区間の中のくり返しの終わり（i を含む最初の終わり） */
function enclosing(items: readonly Item[], i: number): number {
  for (let j = i + 1; j < items.length; j++) {
    const it = items[j];
    if (it.k === 'rs') return -1;
    if (it.k === 're') return repeatStart(items, j) <= i ? j : -1;
  }
  return -1;
}
/**
 * 位置 from から演奏する順にコードを出す。くり返しの終わりで回数が残っていれば始めへ戻る（回数 0 は無制限）。
 * 戻った先にコードがなければくり返さない。passes はくり返しの終わりの id ごとの今の回目（並べ直しても数え直さないよう外から渡せる）
 */
export function* playOrder(items: readonly Item[], from = 0, passes = new Map<number, number>()): Generator<Step> {
  let i = from;
  while (i < items.length) {
    const it = items[i];
    if (it.k === 'ch') {
      const at = enclosing(items, i);
      yield { i, rep: at < 0 ? null : { id: items[at].id, pass: passes.get(items[at].id) ?? 1 } };
      i++;
      continue;
    }
    if (it.k === 're') {
      const s = repeatStart(items, i),
        done = passes.get(it.id) ?? 1,
        hasChord = items.slice(s, i).some((x) => x.k === 'ch');
      if (hasChord && (it.n === 0 || done < it.n)) {
        passes.set(it.id, done + 1);
        i = s;
        continue;
      }
      passes.delete(it.id);
    }
    i++;
  }
}
/** 無制限のくり返しを含むか（演奏の長さを決められない） */
export const endless = (items: readonly Item[]): boolean =>
  items.some((it, i) => it.k === 're' && it.n === 0 && items.slice(repeatStart(items, i), i).some((x) => x.k === 'ch'));

/* ---------- 保存の形式 ---------- */
export interface SongFile {
  v: 1;
  name: string;
  items: ItemSpec[];
}
export const toFile = (name: string, items: readonly Item[]): SongFile => ({
  v: 1,
  name,
  items: items.map(({ id: _id, ...rest }) => rest as ItemSpec),
});
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
export const METERS: readonly (readonly [number, number])[] = [
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 8],
  [12, 8],
];
export const LENGTHS = [0, 1, 2, 3, 4, 6, 8] as const;
export const REPEATS = [2, 3, 4, 0] as const;
/** 1 つのブロックを読む。読めなければ null */
function readItem(o: unknown): ItemSpec | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as Record<string, unknown>;
  switch (x.k) {
    case 'ch': {
      const d = int(x.d, 0, 11),
        q = oneOf<Qual>(x.q, QUAL_ORDER),
        inv = int(x.inv ?? 0, 0, 3),
        b = int(x.b, 0, 16),
        p = x.p === null || x.p === undefined ? null : oneOf<PatId>(x.p, PAT_ORDER);
      if (d === null || !q || inv === null || b === null || p === undefined) return null;
      if (x.p != null && !p) return null;
      return { k: 'ch', d, q, inv, b, p };
    }
    case 'key': {
      const t = int(x.t, 0, 11),
        m = oneOf<Key['m']>(x.m, ['maj', 'min']);
      return t === null || !m ? null : { k: 'key', t, m };
    }
    case 'met': {
      const n = int(x.n, 1, 16),
        dn = int(x.dn, 2, 16);
      return n === null || dn === null || ![2, 4, 8, 16].includes(dn) ? null : { k: 'met', n, dn };
    }
    case 'tmp': {
      const v = int(x.v, 30, 240);
      return v === null ? null : { k: 'tmp', v };
    }
    case 'pat': {
      const v = oneOf<PatId>(x.v, PAT_ORDER);
      return v ? { k: 'pat', v } : null;
    }
    case 'vce': {
      const v = oneOf<VoiceId>(x.v, VOICE_ORDER);
      return v ? { k: 'vce', v } : null;
    }
    case 'rs':
      return { k: 'rs' };
    case 're': {
      const n = int(x.n, 0, 99);
      return n === null || n === 1 ? null : { k: 're', n };
    }
    default:
      return null;
  }
}
/** 保存した曲を読む。形が違えば null */
export function fromFile(o: unknown): { name: string; items: Item[] } | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as Record<string, unknown>;
  if (x.v !== 1 || !Array.isArray(x.items) || x.items.length > 2000) return null;
  const items: Item[] = [];
  for (const r of x.items) {
    const s = readItem(r);
    if (!s) return null;
    items.push(withId(s));
  }
  const name = typeof x.name === 'string' ? x.name.slice(0, 60) : '';
  return { name, items };
}

/* ---------- サンプルの記法 ---------- */
const NUM = ['VII', 'VI', 'V', 'IV', 'III', 'II', 'I'] as const;
const NUM_STEP: Record<string, number> = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
const SCALE: Record<Key['m'], readonly number[]> = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10] };
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SUFFIX: Record<string, { M: Qual; m: Qual }> = {
  '': { M: 'M', m: 'm' },
  7: { M: '7', m: 'm7' },
  M7: { M: 'M7', m: 'M7' },
  o: { M: 'dim', m: 'dim' },
  ø: { M: 'm7b5', m: 'm7b5' },
  sus4: { M: 'sus4', m: 'sus4' },
  '+': { M: 'aug', m: 'aug' },
};
/**
 * 短い記法をブロックに: 「I V vi IV」のように度数を空白で区切る。大文字は長三和音、小文字は短三和音。
 * 前に b・#、後ろに 7・M7・o（dim）・ø（m7(♭5)）・sus4・+（aug）、:n で拍の数、/n で転回。
 * [key Eb min]・[met 3/4]・[tmp 120]・[pat up]・[vce ep]・|:・:|n（n 回、* は無制限）
 */
export function parseSong(src: string): Item[] {
  const out: ItemSpec[] = [];
  let mode: Key['m'] = 'maj';
  const toks = src.match(/\[[^\]]*\]|\S+/g) ?? [];
  for (const tk of toks) {
    if (tk.startsWith('[')) {
      const [cmd, a = '', b = ''] = tk.slice(1, -1).trim().split(/\s+/);
      if (cmd === 'key') {
        const t = md(NOTE[a[0]] + (a.includes('b') ? -1 : 0) + (a.includes('#') ? 1 : 0));
        mode = b === 'min' ? 'min' : 'maj';
        out.push({ k: 'key', t, m: mode });
      } else if (cmd === 'met') {
        const [n, dn] = a.split('/').map(Number);
        out.push({ k: 'met', n, dn });
      } else if (cmd === 'tmp') out.push({ k: 'tmp', v: Number(a) });
      else if (cmd === 'pat') out.push({ k: 'pat', v: a as PatId });
      else if (cmd === 'vce') out.push({ k: 'vce', v: a as VoiceId });
      else throw new Error(`unknown block: ${tk}`);
      continue;
    }
    if (tk === '|:') {
      out.push({ k: 'rs' });
      continue;
    }
    if (tk.startsWith(':|')) {
      const n = tk.slice(2);
      out.push({ k: 're', n: n === '*' ? 0 : Number(n || 2) });
      continue;
    }
    const m = /^([b#]?)([IViv]+)(M7|7|o|ø|sus4|\+)?(?::(\d+))?(?:\/(\d))?(?:@(\w+))?$/.exec(tk);
    if (!m) throw new Error(`bad chord: ${tk}`);
    const [, acc, num, suf = '', len, inv, pat] = m,
      up = num.toUpperCase();
    if (!NUM.includes(up as (typeof NUM)[number])) throw new Error(`bad numeral: ${tk}`);
    const d = md(SCALE[mode][NUM_STEP[up]] + (acc === 'b' ? -1 : acc === '#' ? 1 : 0)),
      q = SUFFIX[suf][num === up ? 'M' : 'm'];
    out.push({ k: 'ch', d, q, inv: Number(inv ?? 0), b: Number(len ?? 0), p: (pat as PatId) ?? null });
  }
  return out.map(withId);
}

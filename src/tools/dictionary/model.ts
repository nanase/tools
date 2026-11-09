/**
 * ディクショナリのページの模型。操作の列を実行して、1 手ごとのコマを記録する。図と音は記録を再生する。
 * 調べた回数は読んだ場所（空きの場所・列のノード・項目）の数、移動はキーを書き直した数である。回数は工程ごとに 0 から数える。
 * 表の大きさは 2 のべき乗で、番号はハッシュの下位のビットで決める
 */
import { rng } from '../list-queue-stack/model';

export type Kind = 'chain' | 'open' | 'robin' | 'cuckoo' | 'compact' | 'list';
/** 探す順番: 隣へ・三角数・2 つ目のハッシュの歩幅・CPython の dict の式 */
export type Seq = 'lin' | 'quad' | 'dbl' | 'py';
/** 工程の番号: 追加・検索・削除 */
export type Stage = 0 | 1 | 2;
export type OpKey = 'add' | 'find' | 'del';
export type KeySet = 'word' | 'seq';
export type HashKey = 'fnv' | 'sum';

export interface Def {
  id: string;
  name: string;
  kind: Kind;
  seq: Seq;
  /** 負荷率の上限（拡張するとき） */
  load: number;
  ex: string;
}
export const DEFS: readonly Def[] = [
  {
    id: 'chain',
    name: 'チェイン法',
    kind: 'chain',
    seq: 'lin',
    load: 0.75,
    ex: 'Java の HashMap・C++ の unordered_map',
  },
  { id: 'lin', name: '線形探査法', kind: 'open', seq: 'lin', load: 0.75, ex: 'Java の IdentityHashMap' },
  { id: 'quad', name: '二次探査法', kind: 'open', seq: 'quad', load: 0.75, ex: 'LLVM の DenseMap' },
  { id: 'dbl', name: 'ダブルハッシュ法', kind: 'open', seq: 'dbl', load: 0.75, ex: '.NET の Hashtable' },
  {
    id: 'robin',
    name: 'ロビンフッド・ハッシュ法',
    kind: 'robin',
    seq: 'lin',
    load: 0.875,
    ex: 'Rust の HashMap（1.35 まで）',
  },
  {
    id: 'cuckoo',
    name: 'カッコウ・ハッシュ法',
    kind: 'cuckoo',
    seq: 'lin',
    load: 0.5,
    ex: 'MemC3（memcached の改良）',
  },
  {
    id: 'compact',
    name: '入れた順を保つ辞書',
    kind: 'compact',
    seq: 'py',
    load: 2 / 3,
    ex: 'Python の dict（3.6 から）',
  },
  { id: 'list', name: '配列を順に探す（参考）', kind: 'list', seq: 'lin', load: 0, ex: 'Lisp の連想リスト' },
];
export const defOf = (id: string): Def | undefined => DEFS.find((d) => d.id === id);
/** 負荷率の上限の表記 */
export const loadText = (d: Def): string => (d.kind === 'list' ? '–' : d.load === 2 / 3 ? '2/3' : String(d.load));

export const STAGES: readonly (readonly [OpKey, string, string])[] = [
  ['add', '追加', '全部を入れる'],
  ['find', '検索', '8 個を探す'],
  ['del', '削除', '3 分の 1 を消す'],
];

/** 計算量。[平均, 最悪] */
export interface BigO {
  add: readonly [string, string];
  find: readonly [string, string];
  del: readonly [string, string];
  /** 入れた順に取り出せるか */
  ord: string;
}
const O1 = 'O(1)',
  ON = 'O(n)';
const OPEN: BigO = { add: [O1, ON], find: [O1, ON], del: [O1, ON], ord: 'なし' };
export const BIG_O: Record<Kind, BigO> = {
  chain: OPEN,
  open: OPEN,
  robin: OPEN,
  cuckoo: { add: ['O(1)*', ON], find: [O1, O1], del: [O1, O1], ord: 'なし' },
  compact: { ...OPEN, ord: 'あり' },
  list: { add: [O1, O1], find: [ON, ON], del: [ON, ON], ord: 'あり' },
};
const HOW: Record<string, Record<OpKey, string>> = {
  chain: { add: '番号の列の最後へつなぐ', find: '番号の列を前から比べる', del: '列から外す' },
  lin: { add: '埋まっていれば隣へ', find: '空きまで隣へ進む', del: '削除済みの印を置く' },
  quad: { add: '1・2・3 … と間を広げて進む', find: '空きまで同じ順に進む', del: '削除済みの印を置く' },
  dbl: { add: '2 つ目のハッシュの歩幅で進む', find: '空きまで同じ歩幅で進む', del: '削除済みの印を置く' },
  robin: { add: '距離の短いキーと入れ替えて進む', find: '距離が逆転したら打ち切り', del: '後ろのキーを詰める' },
  cuckoo: { add: '埋まっていれば前のキーを追い出す', find: '2 か所だけ見る', del: '2 か所のどちらかを消す' },
  compact: { add: '項目は最後へ、番号を表へ', find: '番号の表から項目へ', del: '番号に印、項目を空ける' },
  list: { add: '最後へつなぐ', find: '前から全部比べる', del: '消して後ろを詰める' },
};
export const howOf = (d: Def, k: OpKey): string => HOW[d.kind === 'open' ? d.seq : d.kind][k];

/* ---------- 単語とキー ---------- */
export const WORDS: readonly (readonly [string, string])[] = [
  ['cat', 'ねこ'],
  ['dog', 'いぬ'],
  ['sun', '太陽'],
  ['moon', '月'],
  ['sky', '空'],
  ['sea', '海'],
  ['rain', '雨'],
  ['snow', '雪'],
  ['tree', '木'],
  ['leaf', '葉'],
  ['fish', '魚'],
  ['bird', '鳥'],
  ['book', '本'],
  ['pen', 'ペン'],
  ['cup', 'カップ'],
  ['key', '鍵'],
  ['door', '扉'],
  ['map', '地図'],
  ['rice', '米'],
  ['tea', '茶'],
  ['egg', '卵'],
  ['milk', '牛乳'],
  ['salt', '塩'],
  ['star', '星'],
  ['wind', '風'],
  ['fire', '火'],
  ['ice', '氷'],
  ['gold', '金'],
  ['ring', '指輪'],
  ['ship', '船'],
  ['car', '車'],
  ['road', '道'],
  ['town', '町'],
  ['home', '家'],
  ['bed', 'ベッド'],
  ['hat', '帽子'],
  ['shoe', '靴'],
  ['hand', '手'],
  ['eye', '目'],
  ['ear', '耳'],
  ['nose', '鼻'],
  ['bell', '鈴'],
  ['drum', '太鼓'],
  ['song', '歌'],
  ['ink', 'インク'],
  ['box', '箱'],
  ['bag', 'かばん'],
  ['coin', '硬貨'],
  ['lamp', '明かり'],
  ['rose', 'ばら'],
  ['lily', 'ゆり'],
  ['frog', 'かえる'],
  ['bear', 'くま'],
  ['wolf', 'おおかみ'],
  ['owl', 'ふくろう'],
  ['bee', 'はち'],
  ['ant', 'あり'],
  ['cow', 'うし'],
  ['pig', 'ぶた'],
  ['fox', 'きつね'],
  ['duck', 'あひる'],
  ['deer', 'しか'],
  ['lion', 'ライオン'],
  ['crab', 'かに'],
  ['bean', '豆'],
  ['corn', 'とうもろこし'],
  ['bread', 'パン'],
  ['soup', 'スープ'],
  ['hill', '丘'],
  ['lake', '湖'],
  ['rock', '岩'],
  ['sand', '砂'],
];
const VAL: Readonly<Record<string, string>> = Object.fromEntries(WORDS);
/** 単語の和訳、連番は番号 */
export const meaningOf = (k: string): string => VAL[k] ?? (/^k\d+$/.test(k) ? String(Number(k.slice(1))) : '');
export const SETS: readonly (readonly [KeySet, string])[] = [
  ['word', '英単語'],
  ['seq', '連番'],
];
export const HASHES: readonly (readonly [HashKey, string])[] = [
  ['fnv', 'FNV-1a'],
  ['sum', '文字コードの和'],
];
/** キーに使える文字（手で入れるキー） */
export const keyOk = (k: string): boolean => /^[a-z0-9]{1,8}$/.test(k);

function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const seqKey = (i: number): string => `k${String(i).padStart(2, '0')}`;
export function makeKeys(set: KeySet, n: number, seed: number): string[] {
  if (set === 'seq') return Array.from({ length: n }, (_, i) => seqKey(i + 1));
  return shuffle(
    WORDS.map((w) => w[0]),
    rng(seed * 7919 + n),
  ).slice(0, n);
}
export interface Op {
  t: OpKey;
  k: string;
  /** 手で入れた値 */
  v?: string;
}
export type StageOps = readonly [Op[], Op[], Op[]];
/** 3 工程の操作の列。検索はある 6 個とない 2 個、削除は 3 分の 1 */
export function makeOps(keys: readonly string[], set: KeySet, seed: number): StageOps {
  const r = rng(seed * 104729 + 3),
    n = keys.length,
    mix = shuffle([...keys], r),
    absent =
      set === 'seq'
        ? [seqKey(n + 3), seqKey(n + 11)]
        : shuffle(
            WORDS.map((w) => w[0]).filter((w) => !keys.includes(w)),
            r,
          ).slice(0, 2);
  const find = shuffle([...mix.slice(0, 6), ...absent], r).map((k): Op => ({ t: 'find', k }));
  const del = shuffle([...keys], r)
    .slice(0, Math.floor(n / 3))
    .map((k): Op => ({ t: 'del', k }));
  return [keys.map((k): Op => ({ t: 'add', k })), find, del];
}
/** 手で追加するときの新しいキー */
export function freshKey(set: KeySet, have: readonly string[], seed: number): string | null {
  if (set === 'seq') {
    let i = 1;
    while (have.includes(seqKey(i))) i++;
    return seqKey(i);
  }
  const left = WORDS.map((w) => w[0]).filter((w) => !have.includes(w));
  return left.length ? left[Math.floor(rng(seed)() * left.length)] : null;
}

/* ---------- ハッシュ関数 ---------- */
/** FNV-1a（32 ビット） */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export const codeSum = (s: string): number => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
/** 2 つ目のハッシュ。FNV-1a を MurmurHash3 の最後の混ぜ方でかき混ぜる */
function fmix(h: number): number {
  let x = h;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
export const hashOf = (k: string, hk: HashKey): number => (hk === 'sum' ? codeSum(k) : fnv(k));
export const hash2 = (k: string): number => fmix(fnv(k) ^ 0x9e3779b9);
const log2 = (m: number): number => Math.round(Math.log2(m));

/** 探す順番。i 番目に調べる場所を返す関数を作る */
export function probeSeq(seq: Seq, h: number, k: string, m: number): (i: number) => number {
  const mask = m - 1;
  if (seq === 'quad') return (i) => (h + (i * (i + 1)) / 2) & mask;
  if (seq === 'dbl') {
    const st = (hash2(k) & mask) | 1;
    return (i) => (h + i * st) & mask;
  }
  if (seq === 'py') {
    const L = [h & mask];
    let p = h;
    return (i) => {
      while (L.length <= i) {
        p >>>= 5;
        L.push((5 * L[L.length - 1] + p + 1) & mask);
      }
      return L[i];
    };
  }
  return (i) => (h + i) & mask;
}

/* ---------- コマ ---------- */
/** 削除済みの印（開番地法の表） */
export const TOMB = '#';
/** 場所の番地。[表, 番号] か [表, 番号, 列の何番目]。表 'E' は項目の列 */
export type Addr = readonly (number | 'E')[];
/** 表の中身: 開番地法とカッコウはキーか null か TOMB、チェイン法はキーの列、入れた順の辞書は項目の番号（-1 空き、-2 削除済み） */
export type Cellv = string | null | string[] | number;
export interface Counts {
  /** 調べた回数 */
  p: number;
  /** 移動 */
  mv: number;
}
export interface Calc {
  h: number;
  /** 番号（カッコウは表 1 と表 2） */
  s: number[];
  /** 番号に使う下位のビットの数 */
  bits: number;
}
export interface Frame {
  T: readonly (readonly Cellv[])[];
  E: readonly (string | null)[];
  /** 場所の数 */
  M: number;
  say: string;
  /** 入れる・探すキー */
  cur: string | null;
  /** 入れるキーか（追加）、探すキーか */
  q: boolean;
  calc: Calc | null;
  look: readonly Addr[];
  path: readonly Addr[];
  put: readonly Addr[];
  got: readonly Addr[];
  miss: boolean;
  /** 拡張のコマ */
  rs: boolean;
  /** 追い出し・入れ替えで手に持っているキー */
  kick: string | null;
  cnt: Counts;
  s: Stage;
  /** 工程の中の操作の番号（-1 は操作の外） */
  tok: number;
  /** 追加した個数（待機中のキーを出すため） */
  next: number;
}
export interface Opt {
  /** キーの数（拡張しないときの表の大きさを決める） */
  n: number;
  hash: HashKey;
  grow: boolean;
}
export interface Trace {
  def: Def;
  opt: Opt;
  frames: Frame[];
  starts: [number, number, number];
  totals: [Counts, Counts, Counts];
  /** 追加の工程で入れるキーの順 */
  keys: readonly string[];
  /** 手で入れた値 */
  vals: ReadonlyMap<string, string>;
  /** 記録の中の最大: チェイン法の列の長さ・場所の数・項目の数 */
  maxChain: number;
  maxM: number;
  maxE: number;
}
type Snap = Partial<Pick<Frame, 'cur' | 'calc' | 'look' | 'path' | 'put' | 'got' | 'miss' | 'rs' | 'kick'>>;

class Run {
  frames: Frame[] = [];
  stage: Stage = 0;
  tok = -1;
  next = 0;
  q = false;
  cnt: Counts = { p: 0, mv: 0 };
  M: number;
  T: Cellv[][] = [];
  E: (string | null)[] = [];
  vals = new Map<string, string>();
  constructor(
    readonly def: Def,
    readonly o: Opt,
  ) {
    const fixed = 2 ** Math.ceil(Math.log2(o.n / 0.75 - 1e-9));
    this.M = o.grow ? 8 : Math.max(8, def.kind === 'cuckoo' ? 2 * fixed : fixed);
    this.clear();
  }
  clear(): void {
    const k = this.def.kind,
      M = this.M;
    if (k === 'chain') this.T = [Array.from({ length: M }, () => [] as string[])];
    else if (k === 'cuckoo') this.T = [Array(M / 2).fill(null), Array(M / 2).fill(null)];
    else if (k === 'compact') this.T = [Array(M).fill(-1)];
    else if (k === 'list') this.T = [];
    else this.T = [Array(M).fill(null)];
    this.E = [];
  }
  keys(): string[] {
    const k = this.def.kind;
    if (k === 'chain') return (this.T[0] as string[][]).flat();
    if (k === 'compact' || k === 'list') return this.E.filter((x): x is string => x !== null);
    return (this.T.flat() as (string | null)[]).filter((x): x is string => x !== null && x !== TOMB);
  }
  used(): number {
    const k = this.def.kind;
    if (k === 'chain') return (this.T[0] as string[][]).reduce((a, b) => a + b.length, 0);
    if (k === 'compact' || k === 'list') return this.E.length;
    return this.T.flat().filter((x) => x !== null).length;
  }
  snap(say: string, o: Snap = {}): undefined {
    this.frames.push({
      T: this.def.kind === 'chain' ? this.T.map((t) => t.map((b) => [...(b as string[])])) : this.T.map((t) => [...t]),
      E: [...this.E],
      M: this.M,
      say,
      cur: o.cur ?? null,
      q: this.q,
      calc: o.calc ?? null,
      look: o.look ?? [],
      path: o.path ? [...o.path] : [],
      put: o.put ?? [],
      got: o.got ?? [],
      miss: !!o.miss,
      rs: !!o.rs,
      kick: o.kick ?? null,
      cnt: { ...this.cnt },
      s: this.stage,
      tok: this.tok,
      next: this.next,
    });
  }
  val(k: string): string {
    return this.vals.get(k) ?? meaningOf(k);
  }
  found(k: string): string {
    const v = this.val(k);
    return v ? ` ${k} → ${v}` : ` ${k}`;
  }
  home(k: string, t = 0): number {
    const h = t === 1 ? hash2(k) : hashOf(k, this.o.hash),
      size = this.def.kind === 'cuckoo' ? this.M / 2 : this.M;
    return h & (size - 1);
  }
  calc(k: string): Calc | null {
    const kind = this.def.kind,
      h = hashOf(k, this.o.hash);
    if (kind === 'list') return null;
    if (kind === 'cuckoo') return { h, s: [this.home(k, 0), this.home(k, 1)], bits: log2(this.M / 2) };
    return { h, s: [h & (this.M - 1)], bits: log2(this.M) };
  }

  /* 拡張: 古い表のまま 1 コマ、入れ直したあと 1 コマ */
  needGrow(): string | null {
    const d = this.def;
    if (d.kind === 'list') return null;
    const u = this.used() + 1,
      cap = d.kind === 'chain' ? Infinity : this.M - 1;
    if (this.o.grow && u > d.load * this.M) return `負荷率 ${(u / this.M).toFixed(2)} > ${loadText(d)} → 表を 2 倍に`;
    if (u > cap) return '空きが残らない → 表を 2 倍に';
    return null;
  }
  grow(say: string, extra: string[] = []): void {
    this.snap(say, { rs: true });
    const ks = [...this.keys(), ...extra];
    for (;;) {
      this.M *= 2;
      this.clear();
      if (ks.every((k) => this.quiet(k))) break;
    }
    this.cnt.mv += ks.length;
    this.snap(`${ks.length} 個を ${this.M} 個の場所へ入れ直し`, { rs: true });
  }
  /** 拡張のときの入れ直し。コマを残さない */
  quiet(k: string): boolean {
    const d = this.def,
      T = this.T[0];
    if (d.kind === 'chain') {
      (T[this.home(k)] as string[]).push(k);
      return true;
    }
    if (d.kind === 'compact') {
      const nx = probeSeq('py', hashOf(k, this.o.hash), k, this.M);
      for (let i = 0; ; i++) {
        const s = nx(i);
        if (T[s] === -1) {
          this.E.push(k);
          T[s] = this.E.length - 1;
          return true;
        }
      }
    }
    if (d.kind === 'cuckoo') {
      let x = k,
        t = 0;
      for (let n = 0; n < 4 * log2(this.M) + 4; n++) {
        const s = this.home(x, t),
          y = this.T[t][s] as string | null;
        this.T[t][s] = x;
        if (y === null) return true;
        x = y;
        t = 1 - t;
      }
      return false;
    }
    if (d.kind === 'robin') {
      let x = k,
        s = this.home(k),
        dist = 0;
      for (;;) {
        const y = T[s] as string | null;
        if (y === null) {
          T[s] = x;
          return true;
        }
        const dy = (s - this.home(y) + this.M) & (this.M - 1);
        if (dy < dist) {
          T[s] = x;
          x = y;
          dist = dy;
        }
        s = (s + 1) & (this.M - 1);
        dist++;
      }
    }
    const nx = probeSeq(d.seq, hashOf(k, this.o.hash), k, this.M);
    for (let i = 0; ; i++) {
      const s = nx(i);
      if (T[s] === null) {
        T[s] = k;
        return true;
      }
    }
  }

  /* ---------- 操作 ---------- */
  exec(o: Op): void {
    this.q = o.t !== 'add';
    if (o.t === 'add') {
      if (o.v) this.vals.set(o.k, o.v);
      const g = this.needGrow();
      if (g) this.grow(g);
    }
    const kind = this.def.kind;
    if (kind === 'chain') this.chainOp(o.t, o.k);
    else if (kind === 'open') this.openOp(o.t, o.k);
    else if (kind === 'robin') this.robinOp(o.t, o.k);
    else if (kind === 'cuckoo') this.cuckooOp(o.t, o.k);
    else if (kind === 'compact') this.compactOp(o.t, o.k);
    else this.listOp(o.t, o.k);
    if (o.t === 'add') this.next++;
  }
  chainOp(t: OpKey, k: string): undefined {
    const s = this.home(k),
      B = this.T[0][s] as string[],
      calc = this.calc(k),
      path: Addr[] = [];
    this.snap(`${k} → ${s} 番`, { cur: k, calc, look: [[0, s]] });
    if (!B.length) {
      this.cnt.p++;
      if (t === 'add') {
        B.push(k);
        this.snap(`${s} 番の列へ追加`, { cur: k, calc, put: [[0, s, 0]] });
      } else this.snap(`${s} 番の列は空 → 該当なし`, { cur: k, calc, look: [[0, s]], miss: true });
      return;
    }
    for (let j = 0; j < B.length; j++) {
      this.cnt.p++;
      if (B[j] === k) {
        if (t === 'find')
          return this.snap(`${s} 番の列の ${j + 1} 個目で発見${this.found(k)}`, {
            cur: k,
            calc,
            got: [[0, s, j]],
            path,
          });
        B.splice(j, 1);
        return this.snap(`${s} 番の列から削除`, { cur: k, calc, path });
      }
      this.snap(`${B[j]} ≠ ${k}`, { cur: k, calc, look: [[0, s, j]], path });
      path.push([0, s, j]);
    }
    if (t === 'add') {
      B.push(k);
      this.snap(`${s} 番の列の最後へ追加`, { cur: k, calc, put: [[0, s, B.length - 1]], path });
    } else this.snap('列の終わり → 該当なし', { cur: k, calc, miss: true, path });
  }
  openOp(t: OpKey, k: string): undefined {
    const T = this.T[0],
      calc = this.calc(k) as Calc,
      nx = probeSeq(this.def.seq, calc.h, k, this.M),
      path: Addr[] = [];
    this.snap(`${k} → ${nx(0)} 番`, { cur: k, calc, look: [[0, nx(0)]] });
    for (let i = 0; i < this.M; i++) {
      const s = nx(i),
        c = T[s];
      this.cnt.p++;
      if (c === null || (c === TOMB && t === 'add')) {
        if (t === 'add') {
          T[s] = k;
          return this.snap(`${s} 番へ追加`, { cur: k, calc, put: [[0, s]], path });
        }
        return this.snap(`${s} 番は空き → 該当なし`, { cur: k, calc, look: [[0, s]], path, miss: true });
      }
      if (c === k) {
        if (t === 'find') return this.snap(`${s} 番で発見${this.found(k)}`, { cur: k, calc, got: [[0, s]], path });
        T[s] = TOMB;
        return this.snap(`${s} 番を削除済みに`, { cur: k, calc, put: [[0, s]], path });
      }
      path.push([0, s]);
      const nxt = nx(i + 1);
      this.snap(`${s} 番は${c === TOMB ? '削除済み' : ` ${c}`} → ${nxt} 番`, { cur: k, calc, look: [[0, nxt]], path });
    }
    this.snap('全部の場所を見た → 該当なし', { cur: k, calc, path, miss: true });
  }
  robinOp(t: OpKey, k: string): undefined {
    const T = this.T[0],
      m = this.M,
      mask = m - 1,
      calc = this.calc(k),
      path: Addr[] = [],
      dist = (y: string, s: number) => (s - this.home(y) + m) & mask;
    let s = this.home(k),
      d = 0,
      x = k;
    this.snap(`${k} → ${s} 番`, { cur: k, calc, look: [[0, s]] });
    for (let guard = 0; guard <= m; guard++) {
      const y = T[s] as string | null;
      this.cnt.p++;
      if (y === null) {
        if (t === 'add') {
          T[s] = x;
          return this.snap(`${s} 番へ追加`, { cur: x, calc, put: [[0, s]], path });
        }
        return this.snap(`${s} 番は空き → 該当なし`, { cur: k, calc, look: [[0, s]], path, miss: true });
      }
      if (t !== 'add' && y === k) {
        if (t === 'find') return this.snap(`${s} 番で発見${this.found(k)}`, { cur: k, calc, got: [[0, s]], path });
        T[s] = null;
        this.snap(`${s} 番から削除`, { cur: k, calc, put: [[0, s]], path });
        for (;;) {
          const n2 = (s + 1) & mask,
            z = T[n2] as string | null;
          if (z === null || dist(z, n2) === 0) return;
          T[s] = z;
          T[n2] = null;
          this.cnt.mv++;
          this.snap(`${n2} 番の ${z} を ${s} 番へ詰める`, { cur: k, calc, put: [[0, s]] });
          s = n2;
        }
      }
      const dy = dist(y, s),
        n2 = (s + 1) & mask;
      if (t !== 'add' && dy < d)
        return this.snap(`${s} 番の ${y} は距離 ${dy} < ${d} → 該当なし`, {
          cur: k,
          calc,
          look: [[0, s]],
          path,
          miss: true,
        });
      if (t === 'add' && dy < d) {
        T[s] = x;
        this.cnt.mv++;
        this.snap(`${y}（距離 ${dy}）< ${x}（距離 ${d}）→ 入れ替え、${y} は ${n2} 番へ`, {
          cur: y,
          calc,
          put: [[0, s]],
          look: [[0, n2]],
          path,
          kick: x,
        });
        x = y;
        d = dy;
      } else {
        path.push([0, s]);
        this.snap(`${s} 番は ${y}（距離 ${dy}）→ ${n2} 番`, { cur: x, calc, look: [[0, n2]], path });
      }
      s = n2;
      d++;
    }
  }
  cuckooOp(t: OpKey, k: string): undefined {
    const calc = this.calc(k) as Calc,
      [a, b] = calc.s,
      both: Addr[] = [
        [0, a],
        [1, b],
      ];
    this.snap(`${k} → 表 1 の ${a} 番・表 2 の ${b} 番`, { cur: k, calc, look: both });
    if (t !== 'add') {
      for (const [tt, s] of [
        [0, a],
        [1, b],
      ]) {
        this.cnt.p++;
        if (this.T[tt][s] === k) {
          if (t === 'find')
            return this.snap(`表 ${tt + 1} の ${s} 番で発見${this.found(k)}`, { cur: k, calc, got: [[tt, s]] });
          this.T[tt][s] = null;
          return this.snap(`表 ${tt + 1} の ${s} 番から削除`, { cur: k, calc, put: [[tt, s]] });
        }
      }
      return this.snap('どちらにもない → 該当なし', { cur: k, calc, miss: true, path: both });
    }
    for (const [tt, s] of [
      [0, a],
      [1, b],
    ]) {
      this.cnt.p++;
      if (this.T[tt][s] === null) {
        this.T[tt][s] = k;
        return this.snap(`表 ${tt + 1} の ${s} 番へ追加`, { cur: k, calc, put: [[tt, s]] });
      }
    }
    let x = k,
      tt = 0;
    const MAX = 2 * log2(this.M) + 2;
    for (let n = 0; n < MAX; n++) {
      const s = this.home(x, tt),
        y = this.T[tt][s] as string | null;
      this.T[tt][s] = x;
      this.cnt.mv++;
      if (y === null)
        return this.snap(`表 ${tt + 1} の ${s} 番へ ${x}`, { cur: x, calc: this.calc(x), put: [[tt, s]] });
      const s2 = this.home(y, 1 - tt);
      this.snap(`表 ${tt + 1} の ${s} 番の ${y} を追い出す → 表 ${2 - tt} の ${s2} 番へ`, {
        cur: y,
        calc: this.calc(y),
        put: [[tt, s]],
        look: [[1 - tt, s2]],
        kick: y,
      });
      this.cnt.p++;
      x = y;
      tt = 1 - tt;
    }
    this.grow(`追い出しが ${MAX} 回続いた → 表を 2 倍に`, [x]);
  }
  compactOp(t: OpKey, k: string): undefined {
    const T = this.T[0] as number[],
      calc = this.calc(k) as Calc,
      nx = probeSeq('py', calc.h, k, this.M),
      path: Addr[] = [];
    this.snap(`${k} → ${nx(0)} 番`, { cur: k, calc, look: [[0, nx(0)]] });
    for (let i = 0; i < 4 * this.M; i++) {
      const s = nx(i),
        ix = T[s];
      this.cnt.p++;
      if (ix === -1) {
        if (t === 'add') {
          this.E.push(k);
          T[s] = this.E.length - 1;
          return this.snap(`項目 ${T[s]} へ追加、${s} 番に番号 ${T[s]}`, {
            cur: k,
            calc,
            put: [
              [0, s],
              ['E', T[s]],
            ],
            path,
          });
        }
        return this.snap(`${s} 番は空き → 該当なし`, { cur: k, calc, look: [[0, s]], path, miss: true });
      }
      if (ix >= 0 && this.E[ix] === k && t !== 'add') {
        if (t === 'find')
          return this.snap(`${s} 番 → 項目 ${ix} で発見${this.found(k)}`, {
            cur: k,
            calc,
            got: [
              [0, s],
              ['E', ix],
            ],
            path,
          });
        T[s] = -2;
        this.E[ix] = null;
        return this.snap(`${s} 番を削除済みに・項目 ${ix} を空ける`, {
          cur: k,
          calc,
          put: [
            [0, s],
            ['E', ix],
          ],
          path,
        });
      }
      path.push([0, s]);
      const nxt = nx(i + 1);
      this.snap(ix === -2 ? `${s} 番は削除済み → ${nxt} 番` : `${s} 番 → 項目 ${ix} は ${this.E[ix]} → ${nxt} 番`, {
        cur: k,
        calc,
        look: [[0, nxt], ...(ix >= 0 ? [['E', ix] as Addr] : [])],
        path,
      });
    }
  }
  listOp(t: OpKey, k: string): undefined {
    const E = this.E,
      path: Addr[] = [];
    if (t === 'add') {
      E.push(k);
      this.cnt.p++;
      return this.snap(`${E.length - 1} 番へ追加`, { cur: k, put: [['E', E.length - 1]] });
    }
    this.snap(`${k} を前から順に比較`, { cur: k });
    for (let i = 0; i < E.length; i++) {
      this.cnt.p++;
      if (E[i] === k) {
        if (t === 'find') return this.snap(`${i} 番で発見${this.found(k)}`, { cur: k, got: [['E', i]], path });
        E.splice(i, 1);
        this.cnt.mv += E.length - i;
        return this.snap(`${i} 番を削除して後ろの ${E.length - i} 個を詰める`, {
          cur: k,
          put: E.slice(i).map((_, j): Addr => ['E', i + j]),
          path,
        });
      }
      this.snap(`${E[i]} ≠ ${k}`, { cur: k, look: [['E', i]], path });
      path.push(['E', i]);
    }
    this.snap('最後まで → 該当なし', { cur: k, miss: true, path });
  }
}

export function runTrace(def: Def, ops: StageOps, opt: Opt): Trace {
  const R = new Run(def, opt),
    starts: number[] = [],
    totals: Counts[] = [];
  for (let s = 0; s < 3; s++) {
    R.stage = s as Stage;
    R.cnt = { p: 0, mv: 0 };
    R.tok = -1;
    R.q = s > 0;
    starts.push(R.frames.length);
    R.snap('', {});
    ops[s].forEach((o, i) => {
      R.tok = i;
      R.exec(o);
    });
    R.tok = -1;
    if (ops[s].length) R.snap('', {});
    totals.push({ ...R.cnt });
  }
  const t: Trace = {
    def,
    opt,
    frames: R.frames,
    starts: starts as [number, number, number],
    totals: totals as [Counts, Counts, Counts],
    keys: ops[0].filter((o) => o.t === 'add').map((o) => o.k),
    vals: R.vals,
    maxChain: 1,
    maxM: 8,
    maxE: 1,
  };
  for (const f of t.frames) {
    t.maxM = Math.max(t.maxM, f.M);
    t.maxE = Math.max(t.maxE, f.E.length);
    if (def.kind === 'chain') for (const B of f.T[0] as string[][]) t.maxChain = Math.max(t.maxChain, B.length);
  }
  return t;
}

/* ---------- 形を読む ---------- */
export interface Shape {
  /** キーの数 */
  n: number;
  /** 削除済みの印の数 */
  tomb: number;
  /** キーごとの見つけるまでに調べる回数 */
  cost: ReadonlyMap<string, number>;
  /** キーの場所 */
  at: ReadonlyMap<string, Addr>;
  max: number;
  mean: number;
  /** 負荷率（キー / 場所） */
  load: number;
}
/** キーごとの調べる回数と表の様子 */
export function inspect(f: Pick<Frame, 'T' | 'E' | 'M'>, def: Def, hk: HashKey): Shape {
  const kind = def.kind,
    m = f.M,
    cost = new Map<string, number>(),
    at = new Map<string, Addr>();
  let tomb = 0;
  if (kind === 'chain')
    (f.T[0] as string[][]).forEach((B, s) => {
      B.forEach((k, j) => {
        cost.set(k, j + 1);
        at.set(k, [0, s, j]);
      });
    });
  else if (kind === 'list')
    f.E.forEach((k, i) => {
      if (k === null) return;
      cost.set(k, i + 1);
      at.set(k, ['E', i]);
    });
  else if (kind === 'cuckoo')
    f.T.forEach((T, t) => {
      T.forEach((k, s) => {
        if (typeof k !== 'string') return;
        cost.set(k, t + 1);
        at.set(k, [t, s]);
      });
    });
  else
    f.T[0].forEach((c, s) => {
      if (c === null || c === -1) return;
      if (c === TOMB || c === -2) {
        tomb++;
        return;
      }
      const k = kind === 'compact' ? (f.E[c as number] as string) : (c as string),
        nx = probeSeq(def.seq, hashOf(k, hk), k, m);
      let i = 0;
      while (nx(i) !== s && i < 4 * m) i++;
      cost.set(k, i + 1);
      at.set(k, kind === 'compact' ? ['E', c as number] : [0, s]);
    });
  let max = 0,
    sum = 0;
  for (const v of cost.values()) {
    max = Math.max(max, v);
    sum += v;
  }
  const n = cost.size;
  return { n, tomb, cost, at, max, mean: n ? sum / n : 0, load: kind === 'list' ? 1 : n / m };
}

/** 1 回の操作の平均（英単語 24 個で 8 通り）。工程ごとの調べた回数と移動 */
export type Avg = Record<OpKey, Counts>;
export function average(d: Def, hash: HashKey, grow: boolean, n = 24, tries = 8): Avg {
  const a: Avg = { add: { p: 0, mv: 0 }, find: { p: 0, mv: 0 }, del: { p: 0, mv: 0 } };
  for (let s = 1; s <= tries; s++) {
    const ops = makeOps(makeKeys('word', n, s), 'word', s),
      t = runTrace(d, ops, { n, hash, grow });
    STAGES.forEach(([k], i) => {
      a[k].p += t.totals[i].p / ops[i].length / tries;
      a[k].mv += t.totals[i].mv / ops[i].length / tries;
    });
  }
  return a;
}

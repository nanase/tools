/**
 * B木のページの模型。操作の列を実行して、1 手ごとのコマを記録する。図と音は記録を再生する。
 * 読み込みはノードを読んだ数、書き込みはノードを書き換えた数、比較はキーを比べた数である。
 * 回数は工程ごとに 0 から数える
 */
import { type BarShape, rng } from '../list-queue-stack/model';

export type Kind = 'b' | 'bp' | 'bs' | 'td' | 'cow' | 'be' | 'bst';
export type Method = 'add' | 'bulk';
export type DelMode = 'half' | 'empty';
/** 工程の番号: 追加・検索・範囲・削除 */
export type Stage = 0 | 1 | 2 | 3;
export type OpKey = 'add' | 'find' | 'range' | 'del';

export interface Def {
  id: string;
  name: string;
  kind: Kind;
  ex: string;
}
export const DEFS: readonly Def[] = [
  { id: 'b', name: 'B木', kind: 'b', ex: 'SQLite の索引' },
  { id: 'bp', name: 'B+木', kind: 'bp', ex: 'SQLite の表・MySQL の InnoDB・PostgreSQL の索引' },
  { id: 'bs', name: 'B*木', kind: 'bs', ex: 'ページの空きを減らしたいとき' },
  { id: 'td', name: 'トップダウン分割', kind: 'td', ex: '親へ戻らずに追加したいとき' },
  { id: 'cow', name: 'コピーオンライト', kind: 'cow', ex: 'LMDB・Btrfs' },
  { id: 'be', name: 'Bε木', kind: 'be', ex: 'TokuDB・BetrFS' },
  { id: 'bst', name: '二分探索木（参考）', kind: 'bst', ex: '要素が少なくメモリの上だけで使うとき' },
];
export const defOf = (id: string): Def | undefined => DEFS.find((d) => d.id === id);

export const STAGES: readonly (readonly [OpKey, string, string])[] = [
  ['add', '追加', '全部を木に入れる'],
  ['find', '検索', '根から葉へ下る'],
  ['range', '範囲', '続いたキーを読む'],
  ['del', '削除', '半分を消す'],
];
const LOG = 'O(log<sub>m</sub> n)';
const RANGE = 'O(log<sub>m</sub> n + k/m)';
const SAME: Record<OpKey, string> = { find: LOG, add: LOG, range: RANGE, del: LOG };
/** 計算量はノードを読み書きする回数。* は償却。m は次数、k は読むキーの数である */
export const BIG_O: Record<string, Record<OpKey, string>> = {
  b: SAME,
  bp: SAME,
  bs: SAME,
  td: SAME,
  cow: SAME,
  be: { find: LOG, add: 'O(log<sub>m</sub> n / m)*', range: RANGE, del: 'O(log<sub>m</sub> n / m)*' },
  bst: { find: 'O(n)', add: 'O(n)', range: 'O(n)', del: 'O(n)' },
};
const HOW: Record<OpKey, string> = {
  add: '根から葉へ下り、あふれたら分割',
  find: '根から葉へ下る',
  range: '始まりのキーを探し、順に読む',
  del: '消して、足りなければ併合',
};
const HOW_BY: Partial<Record<Kind, Partial<Record<OpKey, string>>>> = {
  bp: { range: '始まりの葉を探し、葉を横へ読む' },
  bs: {
    add: 'あふれたら隣へ分け、隣も満杯なら 2 つを 3 つへ',
    del: '足りなければ借り、借りられなければ 3 つを 2 つへ',
  },
  td: { add: '下りながら満杯のノードを分割' },
  cow: { add: '葉から根までを別のページへコピー', del: '葉から根までを別のページへコピー' },
  be: {
    add: '根のバッファへ入れ、満杯ならまとめて下へ',
    del: '消す印を根のバッファへ',
    find: 'バッファも見ながら下る',
  },
  bst: { add: '根から下り、空いた枝につなぐ', del: '消して、右の最小を上げる', find: '根から下る' },
};
export const howOf = (d: Def, k: OpKey): string => HOW_BY[d.kind]?.[k] ?? HOW[k];

/** キーの最大値 */
export const vmOf = (n: number): number => (n <= 63 ? 99 : 999);

/** 重複しないキーを作り、形のとおりに並べる */
export function makeKeys(shape: BarShape, n: number, seed: number): number[] {
  const r = rng(seed * 7919 + n),
    vm = vmOf(n),
    pool = Array.from({ length: vm }, (_, i) => i + 1);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(r() * (vm - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sorted = pool.slice(0, n).sort((a, b) => a - b);
  if (shape === 'ramp') return sorted;
  if (shape === 'down') return sorted.reverse();
  if (shape === 'saw') {
    /* 右上がりの山を 3 つ並べる */
    const part: number[][] = [[], [], []];
    sorted.forEach((v, i) => {
      part[i % 3].push(v);
    });
    return part.flat();
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  }
  return sorted;
}

export type Op =
  | { t: 'add'; k: number }
  | { t: 'find'; k: number }
  | { t: 'range'; lo: number; hi: number }
  | { t: 'del'; k: number }
  | { t: 'bulk'; keys: readonly number[] };
export type StageOps = readonly [Op[], Op[], Op[], Op[]];

/** 4 工程の操作の列を作る */
export function makeOps(keys: readonly number[], seed: number, method: Method): StageOps {
  const r = rng(seed * 104729 + 3),
    n = keys.length,
    sorted = [...keys].sort((a, b) => a - b),
    mix = [...keys];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [mix[i], mix[j]] = [mix[j], mix[i]];
  }
  /* 検索はある 4 個とない 1 個 */
  let miss = sorted[n >> 1] + 1;
  while (keys.includes(miss)) miss++;
  const find: Op[] = [...mix.slice(0, 4).map((k): Op => ({ t: 'find', k })), { t: 'find', k: miss }],
    a = Math.floor(n * 0.3),
    b = Math.min(n - 1, a + Math.max(3, Math.floor(n * 0.35)));
  mix.reverse();
  return [
    method === 'bulk' ? [{ t: 'bulk', keys: sorted }] : keys.map((k): Op => ({ t: 'add', k })),
    find,
    [{ t: 'range', lo: sorted[a], hi: sorted[b] }],
    mix.slice(0, n >> 1).map((k): Op => ({ t: 'del', k })),
  ];
}

export interface Msg {
  k: number;
  del?: boolean;
}
export interface Node {
  id: number;
  k: number[];
  c: number[];
  leaf: boolean;
  /** B+木の右隣の葉 */
  next: number;
  /** Bε木のバッファ */
  buf: Msg[];
  /** ディスクのページの番号 */
  pg: number;
  /** 最後に書き換えたコマ（コマどうしで変更しない部品を共有する） */
  f: number;
}
export interface Counts {
  r: number;
  w: number;
  c: number;
  s: number;
  m: number;
}
export interface Frame {
  N: readonly (Node | null)[];
  root: number;
  say: string;
  /** 読んでいる・書いているノード */
  r: readonly number[];
  w: readonly number[];
  /** あふれ・不足のノード */
  bad: number;
  /** 比べているキーの場所 [ノード, 添字] */
  cell: readonly [number, number] | null;
  /** 動かしたキー */
  hot: readonly number[];
  /** 読み出したキー */
  got: readonly number[];
  /** 下る枝 [ノード, 枝の添字] */
  edge: readonly [number, number] | null;
  /** 今のノードの上に出す札。q は探している札（検索・削除・範囲）、hi は範囲の終わり */
  cur: { k: number; at: number; q: boolean; hi?: number } | null;
  cnt: Counts;
  /** 追加した個数 */
  next: number;
  /** 工程 */
  s: Stage;
  /** 工程の中の操作の番号 */
  tok: number;
  /** 範囲で読んだキー */
  out: readonly number[];
  /** コピーオンライトの古いページ */
  stale: readonly number[];
}
export interface Trace {
  def: Def;
  m: number;
  maxK: number;
  minK: number;
  /** 根のキーの上限。B*木だけ他のノードより多い */
  rootK: number;
  frames: Frame[];
  starts: [number, number, number, number];
  totals: [Counts, Counts, Counts, Counts];
  /** 待機中のキーの順 */
  keys: readonly number[];
  vm: number;
  bufCap: number;
  leafCopy: boolean;
  /** 記録の中で最も深い段数 */
  maxDepth: number;
}
export interface RunOpt {
  /** 空で解放（B+木だけ） */
  free?: boolean;
  /** キーの最大値。省くとキーの数で決める */
  vm?: number;
}
const ZERO: Counts = { r: 0, w: 0, c: 0, s: 0, m: 0 };
interface Hl {
  r?: readonly number[];
  w?: readonly number[];
  bad?: number;
  cell?: readonly [number, number];
  hot?: readonly number[];
  got?: readonly number[];
  edge?: readonly [number, number];
}

class Run {
  readonly kind: Kind;
  readonly m: number;
  readonly maxK: number;
  readonly minK: number;
  readonly rootK: number;
  readonly leafCopy: boolean;
  readonly freeEmpty: boolean;
  readonly bufCap: number;
  N: (Node | null)[] = [];
  root = -1;
  F: Frame[] = [];
  fno = 0;
  step: Stage = 0;
  tok = 0;
  nextI = 0;
  cnt: Counts = { ...ZERO };
  pgNext = 0;
  free: number[] = [];
  stale: number[] = [];
  out: number[] = [];
  cur: Frame['cur'] = null;
  maxDepth = 1;

  constructor(
    readonly def: Def,
    m: number,
    opt: RunOpt,
  ) {
    this.kind = def.kind;
    /* トップダウン分割は分けたあとの両方に下限を残すので、次数は偶数にする */
    this.m = this.kind === 'td' && m % 2 ? m + 1 : m;
    this.maxK = this.kind === 'bst' ? 1 : this.m - 1;
    /* B*木は枠の 2/3 以上、ほかは半分以上 */
    this.minK = this.kind === 'bs' ? Math.ceil((2 * this.m - 1) / 3) - 1 : Math.ceil(this.m / 2) - 1;
    /* B*木の根は分けたときに下限を満たす数まで持つ */
    this.rootK = this.kind === 'bs' ? 2 * Math.floor((2 * this.m - 2) / 3) : this.maxK;
    this.leafCopy = this.kind === 'bp' || this.kind === 'be';
    this.freeEmpty = !!opt.free && this.kind === 'bp';
    this.bufCap = Math.max(3, this.m);
    if (this.kind !== 'bst') this.root = this.node(true);
  }
  n(id: number): Node {
    return this.N[id] as Node;
  }
  capOf(id: number): number {
    return id === this.root ? this.rootK : this.maxK;
  }
  alloc(): number {
    return this.free.length ? (this.free.shift() as number) : this.pgNext++;
  }
  node(leaf: boolean): number {
    const id = this.N.length;
    this.N.push({ id, k: [], c: [], leaf, next: -1, buf: [], pg: this.alloc(), f: this.fno });
    return id;
  }
  /** 書き換える前に複製する。前のコマの部品は変えない */
  mut(id: number): Node {
    let v = this.n(id);
    if (v.f !== this.fno) {
      v = { ...v, k: v.k.slice(), c: v.c.slice(), buf: v.buf.slice(), f: this.fno };
      this.N[id] = v;
    }
    return v;
  }
  drop(id: number): void {
    const pg = this.n(id).pg;
    this.N[id] = null;
    this.free.push(pg);
  }
  depth(): number {
    let d = 0;
    const walk = (id: number, l: number): void => {
      if (id < 0) return;
      const v = this.N[id];
      if (!v) return;
      d = Math.max(d, l);
      for (const c of v.c) walk(c, l + 1);
    };
    walk(this.root, 1);
    return d;
  }
  fr(say: string, h: Hl = {}): void {
    this.F.push({
      N: this.N.slice(),
      root: this.root,
      say,
      r: h.r ?? [],
      w: h.w ?? [],
      bad: h.bad ?? -1,
      cell: h.cell ?? null,
      hot: h.hot ?? [],
      got: h.got ?? [],
      edge: h.edge ?? null,
      cur: this.cur,
      cnt: { ...this.cnt },
      next: this.nextI,
      s: this.step,
      tok: this.tok,
      out: this.out.slice(),
      stale: this.stale.slice(),
    });
    this.maxDepth = Math.max(this.maxDepth, this.depth());
    this.fno++;
  }
  /** ノードを読む */
  rd(id: number, say = ''): void {
    this.cnt.r++;
    if (this.cur) this.cur = { ...this.cur, at: id };
    this.fr(say, { r: [id] });
  }
  /** 下る枝を直前のコマに載せる */
  markEdge(id: number, i: number): void {
    const z = this.F[this.F.length - 1];
    if (z?.r.includes(id)) z.edge = [id, i];
  }
  /** ノードの中を二分探索する。eq なら等しいキーで止まる */
  scan(id: number, k: number, eq: boolean): { i: number; found: boolean } {
    const v = this.n(id);
    let lo = 0,
      hi = v.k.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1,
        x = v.k[mid];
      this.cnt.c++;
      if (k === x && eq) {
        this.fr(`${k} = ${x}`, { r: [id], cell: [id, mid] });
        return { i: mid, found: true };
      }
      this.fr(`${k} ${k < x ? '<' : k === x ? '=' : '>'} ${x}`, { r: [id], cell: [id, mid] });
      if (k < x) hi = mid;
      else lo = mid + 1;
    }
    return { i: lo, found: false };
  }
  parentOf(id: number): number {
    const st = [this.root];
    while (st.length) {
      const p = st.pop() as number,
        v = this.N[p];
      if (!v) continue;
      for (const c of v.c) {
        if (c === id) return p;
        if (c >= 0) st.push(c);
      }
    }
    return -1;
  }
  /** 根から葉へ下る */
  walk(k: number, eq: boolean): { path: number[]; id: number; i: number; found: boolean } {
    const path: number[] = [];
    let id = this.root;
    for (;;) {
      this.rd(id);
      const { i, found } = this.scan(id, k, eq);
      if (found) return { path, id, i, found };
      const v = this.n(id);
      if (v.leaf) {
        const j = this.leafCopy ? v.k.indexOf(k) : -1;
        return j >= 0 ? { path, id, i: j, found: true } : { path, id, i, found: false };
      }
      path.push(id);
      this.markEdge(id, i);
      id = v.c[i];
    }
  }
  insertSorted(id: number, k: number): void {
    const L = this.mut(id),
      j = L.k.findIndex((v) => v > k);
    L.k.splice(j < 0 ? L.k.length : j, 0, k);
  }

  /* ---------- 分割 ---------- */
  /** 2 つに分け、中央のキーを親へ。親を返す */
  split(id: number): number {
    const r = this.node(this.n(id).leaf),
      v = this.mut(id),
      R = this.mut(r),
      copy = this.leafCopy && v.leaf,
      mid = Math.floor((v.k.length - (copy ? 0 : 1)) / 2),
      sep = v.k[mid],
      par = this.parentOf(id);
    if (copy) {
      R.k = v.k.slice(mid);
      v.k = v.k.slice(0, mid);
      R.next = v.next;
      v.next = r;
    } else {
      R.k = v.k.slice(mid + 1);
      R.c = v.c.slice(mid + 1);
      v.k = v.k.slice(0, mid);
      v.c = v.c.slice(0, mid + 1);
    }
    if (v.buf.length) {
      R.buf = v.buf.filter((b) => b.k >= sep);
      v.buf = v.buf.filter((b) => b.k < sep);
    }
    let p = par;
    if (p < 0) {
      p = this.node(false);
      const P = this.mut(p);
      P.k = [sep];
      P.c = [id, r];
      this.root = p;
    } else {
      const P = this.mut(p),
        i = P.c.indexOf(id);
      P.k.splice(i, 0, sep);
      P.c.splice(i + 1, 0, r);
    }
    this.cnt.s++;
    this.cnt.w += this.kind === 'cow' ? 1 : 3;
    this.fr(`分割: ${sep} を親へ`, { w: [id, r, p], hot: [sep] });
    return p;
  }
  /** 2 つのノードのキーを親のキーごと均等に分け直す */
  share(Lid: number, Rid: number, p: number, sepI: number): void {
    const L = this.mut(Lid),
      R = this.mut(Rid),
      P = this.mut(p),
      all = [...L.k, P.k[sepI], ...R.k],
      kids = [...L.c, ...R.c],
      h = all.length >> 1;
    L.k = all.slice(0, h);
    P.k[sepI] = all[h];
    R.k = all.slice(h + 1);
    if (kids.length) {
      L.c = kids.slice(0, h + 1);
      R.c = kids.slice(h + 1);
    }
    this.cnt.w += 3;
    this.fr(`隣へ分ける: 親に ${all[h]}`, { w: [Lid, Rid, p], hot: [all[h]] });
  }
  /** B*木のあふれ: 隣へ分ける。隣も満杯なら 2 つを 3 つへ。親のあふれの確認が要るときは親を返す */
  starOverflow(id: number): number {
    const p = this.parentOf(id);
    if (p < 0) return this.split(id);
    const P0 = this.n(p),
      i = P0.c.indexOf(id),
      right = i + 1 < P0.c.length ? P0.c[i + 1] : -1,
      left = i > 0 ? P0.c[i - 1] : -1;
    if (right >= 0) {
      this.rd(right, '右隣を読み込み');
      if (this.n(right).k.length < this.maxK) {
        this.share(id, right, p, i);
        return -1;
      }
    }
    if (left >= 0) {
      this.rd(left, '左隣を読み込み');
      if (this.n(left).k.length < this.maxK) {
        this.share(left, id, p, i - 1);
        return -1;
      }
    }
    const Lid = right >= 0 ? id : left,
      Rid = right >= 0 ? right : id,
      sepI = right >= 0 ? i : i - 1,
      L = this.mut(Lid),
      R = this.mut(Rid),
      P = this.mut(p),
      all = [...L.k, P.k[sepI], ...R.k],
      kids = [...L.c, ...R.c],
      Mid = this.node(L.leaf),
      M = this.mut(Mid),
      a = Math.floor((all.length - 2) / 3),
      b = Math.floor((all.length - 2 - a) / 2),
      s1 = all[a],
      s2 = all[a + 1 + b];
    L.k = all.slice(0, a);
    M.k = all.slice(a + 1, a + 1 + b);
    R.k = all.slice(a + 2 + b);
    if (kids.length) {
      L.c = kids.slice(0, a + 1);
      M.c = kids.slice(a + 1, a + 2 + b);
      R.c = kids.slice(a + 2 + b);
    }
    P.k.splice(sepI, 1, s1, s2);
    P.c.splice(sepI + 1, 0, Mid);
    this.cnt.s++;
    this.cnt.w += 4;
    this.fr(`2 つを 3 つへ: ${s1} と ${s2} を親に`, { w: [Lid, Mid, Rid, p], hot: [s1, s2] });
    return p;
  }
  /** あふれを親へ送りながら直す */
  repair(start: number): void {
    let id = start;
    while (id >= 0 && this.n(id).k.length > this.capOf(id)) {
      this.fr('あふれ', { bad: id });
      id = this.kind === 'bs' ? this.starOverflow(id) : this.split(id);
    }
  }
  /** コピーオンライト: 葉から根までを別のページへ書く */
  rewrite(ids: readonly number[]): void {
    for (const id of ids) {
      if (!this.N[id]) continue;
      const v = this.mut(id);
      this.stale.push(v.pg);
      v.pg = this.pgNext++;
      this.cnt.w++;
      this.fr('別のページへコピー', { w: [id] });
    }
    this.fr('根の切り替え', { w: [this.root] });
    this.free.push(...this.stale);
    this.stale = [];
  }

  /* ---------- 追加 ---------- */
  add(k: number): void {
    this.cur = { k, at: -1, q: false };
    this.fr(`${k} を追加`);
    if (this.kind === 'bst') {
      this.bstAdd(k);
      return;
    }
    if (this.kind === 'be') {
      this.beSend({ k });
      return;
    }
    if (this.kind === 'td') {
      this.tdAdd(k);
      return;
    }
    const w = this.walk(k, !this.leafCopy),
      ids = [...w.path, w.id].reverse();
    if (w.found) {
      this.cur = null;
      this.fr(`${k} は登録済み`, { r: [w.id] });
      return;
    }
    this.insertSorted(w.id, k);
    this.cur = null;
    if (this.kind !== 'cow') this.cnt.w++;
    this.fr(`${k} を葉へ`, { w: [w.id], hot: [k] });
    this.repair(w.id);
    if (this.kind === 'cow') this.rewrite(ids);
  }
  tdAdd(k: number): void {
    const full = (id: number) => this.n(id).k.length >= this.maxK;
    if (full(this.root)) {
      this.fr('根が満杯: 先に分割', { bad: this.root });
      this.split(this.root);
    }
    let id = this.root;
    for (;;) {
      this.rd(id);
      if (this.n(id).leaf) break;
      const { i } = this.scan(id, k, false),
        c = this.n(id).c[i];
      this.markEdge(id, i);
      if (full(c)) {
        this.rd(c);
        this.fr('満杯: 下りる前に分割', { bad: c });
        const P = this.n(this.split(c)),
          ci = P.c.indexOf(c);
        id = k > P.k[ci] ? P.c[ci + 1] : c;
      } else id = c;
    }
    this.insertSorted(id, k);
    this.cur = null;
    this.cnt.w++;
    this.fr(`${k} を葉へ`, { w: [id], hot: [k] });
  }

  /* ---------- Bε木 ---------- */
  /** 根のバッファはメモリの上にあるものとし、入れるだけなら読み書きに数えない */
  beSend(msg: Msg): void {
    if (this.n(this.root).leaf) {
      this.rd(this.root);
      const L = this.mut(this.root);
      if (msg.del) L.k = L.k.filter((v) => v !== msg.k);
      else if (!L.k.includes(msg.k)) this.insertSorted(this.root, msg.k);
      this.cur = null;
      this.cnt.w++;
      this.fr(`${msg.k} を${msg.del ? '削除' : '葉へ'}`, { w: [this.root], hot: msg.del ? [] : [msg.k] });
      this.repair(this.root);
      return;
    }
    if (this.cur) this.cur = { ...this.cur, at: this.root };
    this.fr('', { r: [this.root] });
    const R = this.mut(this.root);
    R.buf = R.buf.filter((b) => b.k !== msg.k);
    R.buf.push(msg);
    R.buf.sort((a, b) => a.k - b.k);
    this.cur = null;
    this.fr(`${msg.k} を根のバッファへ`, { w: [this.root], hot: [msg.k] });
    this.beFlush(this.root);
  }
  route(v: Node, k: number): number {
    let i = 0;
    while (i < v.k.length && k >= v.k[i]) i++;
    return i;
  }
  overfull(): number {
    const st = [this.root];
    while (st.length) {
      const id = st.pop() as number,
        v = this.n(id);
      if (v.k.length > this.maxK) return id;
      st.push(...v.c);
    }
    return -1;
  }
  beFlush(id: number): void {
    while (this.N[id] && this.n(id).buf.length > this.bufCap) {
      const v = this.n(id),
        groups = new Map<number, number>();
      for (const b of v.buf) {
        const i = this.route(v, b.k);
        groups.set(i, (groups.get(i) ?? 0) + 1);
      }
      let best = 0,
        bc = -1;
      for (const [i, c] of groups)
        if (c > bc) {
          best = i;
          bc = c;
        }
      const c = v.c[best],
        moved = v.buf.filter((b) => this.route(v, b.k) === best);
      this.rd(c, `${moved.length} 個まとめて下へ`);
      const V2 = this.mut(id);
      V2.buf = V2.buf.filter((b) => this.route(V2, b.k) !== best);
      const C = this.mut(c);
      this.cnt.w += 2;
      if (C.leaf) {
        for (const b of moved) {
          if (b.del) C.k = C.k.filter((x) => x !== b.k);
          else if (!C.k.includes(b.k)) C.k.push(b.k);
        }
        C.k.sort((a, b) => a - b);
        this.fr(`${moved.length} 個を葉へ`, { w: [id, c], hot: moved.map((b) => b.k) });
      } else {
        const keys = new Set(moved.map((b) => b.k));
        C.buf = C.buf.filter((b) => !keys.has(b.k));
        C.buf.push(...moved);
        C.buf.sort((a, b) => a.k - b.k);
        this.fr(`${moved.length} 個を下のバッファへ`, { w: [id, c], hot: moved.map((b) => b.k) });
        this.beFlush(c);
      }
      for (let x = this.overfull(); x >= 0; x = this.overfull()) {
        this.fr('あふれ', { bad: x });
        this.split(x);
      }
    }
  }
  beFind(k: number): void {
    let id = this.root;
    for (;;) {
      this.rd(id);
      const v = this.n(id),
        b = v.buf.find((m) => m.k === k);
      if (v.buf.length) this.cnt.c += Math.ceil(Math.log2(v.buf.length + 1));
      if (b) {
        this.cur = null;
        this.fr(b.del ? `バッファに消す印: ${k} なし` : `バッファで ${k} を発見`, { r: [id], got: b.del ? [] : [k] });
        return;
      }
      const { i } = this.scan(id, k, false);
      if (v.leaf) {
        const f = v.k.includes(k);
        this.cur = null;
        this.fr(f ? `${k} を発見` : `${k} なし`, { r: [id], got: f ? [k] : [] });
        return;
      }
      this.markEdge(id, i);
      id = v.c[i];
    }
  }

  /* ---------- 二分探索木 ---------- */
  bstAdd(k: number): void {
    if (this.root < 0) {
      const r = this.node(true),
        R = this.mut(r);
      R.k = [k];
      R.c = [-1, -1];
      this.root = r;
      this.cur = null;
      this.cnt.w++;
      this.fr(`${k} を根へ`, { w: [r], hot: [k] });
      return;
    }
    let id = this.root;
    for (;;) {
      this.rd(id);
      const x = this.n(id).k[0];
      if (k === x) {
        this.cnt.c++;
        this.cur = null;
        this.fr(`${k} は登録済み`, { r: [id], cell: [id, 0] });
        return;
      }
      this.cnt.c++;
      this.fr(`${k} ${k < x ? '<' : '>'} ${x}`, { r: [id], cell: [id, 0] });
      const i = k < x ? 0 : 1,
        c = this.n(id).c[i];
      if (c < 0) {
        const nw = this.node(true),
          M = this.mut(nw);
        M.k = [k];
        M.c = [-1, -1];
        const P = this.mut(id);
        P.c[i] = nw;
        P.leaf = false;
        this.cur = null;
        this.cnt.w += 2;
        this.fr(`${k} をつなぐ`, { w: [id, nw], hot: [k] });
        return;
      }
      this.markEdge(id, i);
      id = c;
    }
  }
  bstFind(k: number): number {
    let id = this.root;
    while (id >= 0) {
      this.rd(id);
      const x = this.n(id).k[0];
      this.cnt.c++;
      if (k === x) {
        this.cur = null;
        this.fr(`${k} を発見`, { r: [id], got: [k] });
        return id;
      }
      this.fr(`${k} ${k < x ? '<' : '>'} ${x}`, { r: [id], cell: [id, 0] });
      const i = k < x ? 0 : 1;
      if (this.n(id).c[i] >= 0) this.markEdge(id, i);
      id = this.n(id).c[i];
    }
    this.cur = null;
    this.fr(`${k} なし`);
    return -1;
  }
  bstDel(k: number): void {
    this.cur = { k, at: -1, q: true };
    this.fr(`${k} を削除`);
    const id = this.bstFind(k);
    if (id < 0) return;
    let target = id;
    const V = this.n(id);
    if (V.c[0] >= 0 && V.c[1] >= 0) {
      let s = V.c[1];
      while (this.n(s).c[0] >= 0) {
        this.rd(s, '右の最小を探索');
        s = this.n(s).c[0];
      }
      this.rd(s, '右の最小を探索');
      const sv = this.n(s).k[0];
      this.mut(id).k = [sv];
      this.cnt.w++;
      this.fr(`${sv} を上へ`, { w: [id], hot: [sv] });
      target = s;
    }
    const T = this.n(target),
      child = T.c[0] >= 0 ? T.c[0] : T.c[1],
      p = this.parentOf(target);
    if (p < 0) this.root = child;
    else {
      const P = this.mut(p);
      P.c[P.c.indexOf(target)] = child;
      if (P.c[0] < 0 && P.c[1] < 0) P.leaf = true;
      this.cnt.w++;
    }
    this.drop(target);
    this.fr(`${k} を削除`, { w: p >= 0 ? [p] : [] });
  }

  /* ---------- 検索・範囲 ---------- */
  find(k: number): void {
    this.cur = { k, at: -1, q: true };
    this.fr(`${k} を検索`);
    if (this.kind === 'bst') {
      this.bstFind(k);
      return;
    }
    if (this.kind === 'be') {
      this.beFind(k);
      return;
    }
    const w = this.walk(k, !this.leafCopy);
    this.cur = null;
    if (w.found) this.fr(`${k} を発見`, { r: [w.id], got: [k] });
    else this.fr(`${k} なし`, { r: [w.id] });
  }
  range(lo: number, hi: number): void {
    this.cur = { k: lo, hi, at: -1, q: true };
    this.fr(`${lo}〜${hi} を読み出し`);
    const emit = (k: number, id: number): void => {
      if (this.out.includes(k)) return;
      this.out.push(k);
      this.fr(`${this.out.length} 個目: ${k}`, { r: [id], got: [k] });
    };
    if (this.kind === 'bp') {
      let id = this.root;
      while (!this.n(id).leaf) {
        this.rd(id);
        const { i } = this.scan(id, lo, false);
        this.markEdge(id, i);
        id = this.n(id).c[i];
      }
      this.rd(id);
      for (;;) {
        let more = true;
        for (const v of this.n(id).k) {
          if (v > hi) {
            more = false;
            break;
          }
          if (v >= lo) emit(v, id);
        }
        const nx = this.n(id).next;
        if (!more || nx < 0) break;
        id = nx;
        this.rd(id, '隣の葉へ');
      }
      return;
    }
    const visit = (id: number): void => {
      if (id < 0) return;
      const v = this.n(id);
      this.rd(id);
      for (const b of v.buf) if (!b.del && b.k >= lo && b.k <= hi) emit(b.k, id);
      if (v.leaf && this.kind !== 'bst') {
        for (const x of v.k) if (x >= lo && x <= hi) emit(x, id);
        return;
      }
      v.k.forEach((x, i) => {
        if (lo < x || (this.leafCopy && lo <= x)) visit(v.c[i]);
        if (!this.leafCopy && x >= lo && x <= hi) {
          if (this.cur) this.cur = { ...this.cur, at: id };
          this.fr('親へ', { r: [id] });
          emit(x, id);
        }
      });
      if (hi >= v.k[v.k.length - 1]) visit(v.c[v.k.length]);
    };
    visit(this.root);
  }

  /* ---------- 削除 ---------- */
  del(k: number): void {
    if (this.kind === 'bst') {
      this.bstDel(k);
      return;
    }
    this.cur = { k, at: -1, q: true };
    this.fr(`${k} を削除`);
    if (this.kind === 'be') {
      this.beSend({ k, del: true });
      return;
    }
    const w = this.walk(k, !this.leafCopy),
      ids = [...w.path, w.id].reverse();
    this.cur = null;
    if (!w.found) {
      this.fr(`${k} なし`, { r: [w.id] });
      return;
    }
    let leaf = w.id;
    if (!this.n(w.id).leaf) {
      /* 途中のノードのキーは、左の最大と入れ替えてから葉で消す */
      let s = this.n(w.id).c[w.i];
      this.markEdge(w.id, w.i);
      while (!this.n(s).leaf) {
        this.rd(s, '左の最大を探索');
        ids.unshift(s);
        s = this.n(s).c[this.n(s).k.length];
      }
      this.rd(s, '左の最大を探索');
      ids.unshift(s);
      const L = this.mut(s),
        up = L.k[L.k.length - 1];
      this.mut(w.id).k[w.i] = up;
      L.k.pop();
      if (this.kind !== 'cow') this.cnt.w += 2;
      this.fr(`${up} を上へ`, { w: [s, w.id], hot: [up] });
      leaf = s;
    } else {
      this.mut(leaf).k.splice(w.i, 1);
      if (this.kind !== 'cow') this.cnt.w++;
      this.fr(`${k} を削除`, { w: [leaf] });
    }
    this.rebalance(leaf);
    if (this.kind === 'cow') this.rewrite(ids);
  }
  unlinkLeaf(id: number): void {
    const leaves: number[] = [],
      walk = (x: number): void => {
        const v = this.n(x);
        if (v.leaf) leaves.push(x);
        else v.c.forEach(walk);
      };
    walk(this.root);
    const i = leaves.indexOf(id);
    if (i > 0) this.mut(leaves[i - 1]).next = this.n(id).next;
  }
  /** 隣の 1 個を親を通して移す。from が左なら右へ、右なら左へ */
  rotate(from: number, to: number, p: number, sepI: number, fromLeft: boolean): void {
    const F = this.mut(from),
      T = this.mut(to),
      P = this.mut(p);
    if (this.leafCopy && T.leaf) {
      if (fromLeft) {
        const v = F.k.pop() as number;
        T.k.unshift(v);
        P.k[sepI] = v;
      } else {
        T.k.push(F.k.shift() as number);
        P.k[sepI] = F.k[0];
      }
    } else if (fromLeft) {
      T.k.unshift(P.k[sepI]);
      P.k[sepI] = F.k.pop() as number;
      if (F.c.length) T.c.unshift(F.c.pop() as number);
    } else {
      T.k.push(P.k[sepI]);
      P.k[sepI] = F.k.shift() as number;
      if (F.c.length) T.c.push(F.c.shift() as number);
    }
    this.cnt.w += 3;
    this.fr(`${fromLeft ? '左' : '右'}隣から借りる`, { w: [from, to, p], hot: [P.k[sepI]] });
  }
  /** 2 つを 1 つへ。親のキーを 1 個下ろす */
  merge2(a: number, b: number, p: number, si: number): void {
    const A = this.mut(a),
      B = this.n(b),
      P = this.mut(p),
      sep = P.k[si];
    if (this.leafCopy && A.leaf) {
      A.k = [...A.k, ...B.k];
      A.next = B.next;
    } else {
      A.k = [...A.k, sep, ...B.k];
      A.c = [...A.c, ...B.c];
    }
    P.k.splice(si, 1);
    P.c.splice(si + 1, 1);
    this.drop(b);
    this.cnt.m++;
    this.cnt.w += 2;
    this.fr(`併合: ${sep} を下へ`, { w: [a, p], hot: [sep] });
  }
  /** B*木: 並んだ 3 つを見て、足りれば 3 つで分け直し、足りなければ 2 つへ。親の確認が要るときは true */
  star3(p: number, first: number): boolean {
    const P = this.mut(p),
      [a, b, c] = [P.c[first], P.c[first + 1], P.c[first + 2]],
      A = this.mut(a),
      B = this.mut(b),
      C = this.mut(c),
      all = [...A.k, P.k[first], ...B.k, P.k[first + 1], ...C.k],
      kids = [...A.c, ...B.c, ...C.c];
    if (all.length - 2 >= 3 * this.minK) {
      const x = Math.floor((all.length - 2) / 3),
        y = Math.floor((all.length - 2 - x) / 2);
      A.k = all.slice(0, x);
      B.k = all.slice(x + 1, x + 1 + y);
      C.k = all.slice(x + 2 + y);
      P.k[first] = all[x];
      P.k[first + 1] = all[x + 1 + y];
      if (kids.length) {
        A.c = kids.slice(0, x + 1);
        B.c = kids.slice(x + 1, x + 2 + y);
        C.c = kids.slice(x + 2 + y);
      }
      this.cnt.w += 4;
      this.fr('3 つで分け直す', { w: [a, b, c, p], hot: [P.k[first], P.k[first + 1]] });
      return false;
    }
    const x = (all.length - 1) >> 1;
    A.k = all.slice(0, x);
    B.k = all.slice(x + 1);
    if (kids.length) {
      A.c = kids.slice(0, x + 1);
      B.c = kids.slice(x + 1);
    }
    P.k.splice(first, 2, all[x]);
    P.c.splice(first + 2, 1);
    this.drop(c);
    this.cnt.m++;
    this.cnt.w += 3;
    this.fr(`3 つを 2 つへ: ${all[x]} を親に`, { w: [a, b, p], hot: [all[x]] });
    return true;
  }
  rebalance(start: number): void {
    let id = start;
    if (this.freeEmpty) {
      while (id !== this.root && this.n(id).k.length === 0 && (this.n(id).leaf || this.n(id).c.length === 0)) {
        const p = this.parentOf(id),
          P = this.mut(p),
          i = P.c.indexOf(id);
        if (this.n(id).leaf) this.unlinkLeaf(id);
        P.c.splice(i, 1);
        P.k.splice(Math.max(0, i - 1), 1);
        this.cnt.w++;
        this.cnt.m++;
        this.drop(id);
        this.fr('空の葉を解放', { w: [p] });
        id = p;
      }
      this.fixRoot();
      return;
    }
    while (id !== this.root && this.n(id).k.length < this.minK) {
      const p = this.parentOf(id),
        kids = this.n(p).c,
        i = kids.indexOf(id),
        lid = i > 0 ? kids[i - 1] : -1,
        rid = i + 1 < kids.length ? kids[i + 1] : -1;
      this.fr('キーの不足', { bad: id });
      if (lid >= 0) this.rd(lid, '左隣を読み込み');
      if (lid >= 0 && this.n(lid).k.length > this.minK) {
        this.rotate(lid, id, p, i - 1, true);
        return;
      }
      if (rid >= 0) this.rd(rid, '右隣を読み込み');
      if (rid >= 0 && this.n(rid).k.length > this.minK) {
        this.rotate(rid, id, p, i, false);
        return;
      }
      if (this.kind === 'bs' && kids.length >= 3) {
        /* 自分を含む並んだ 3 つ。端なら 2 つ隣も読む */
        const first = Math.max(0, Math.min(kids.length - 3, i - 1));
        if (first + 2 !== i + 1 && first !== i - 1) this.rd(kids[first === i ? i + 2 : i - 2], '2 つ隣を読み込み');
        if (!this.star3(p, first)) return;
      } else {
        this.merge2(lid >= 0 ? lid : id, lid >= 0 ? id : rid, p, lid >= 0 ? i - 1 : i);
      }
      id = p;
    }
    this.fixRoot();
  }
  fixRoot(): void {
    const R = this.N[this.root];
    if (R && !R.leaf && R.k.length === 0 && R.c.length === 1) {
      const c = R.c[0],
        old = this.root;
      this.root = c;
      this.drop(old);
      this.fr('根を外す: 1 段減る', { w: [c] });
    }
  }

  /* ---------- まとめて構築 ---------- */
  bulk(keys: readonly number[]): void {
    const levels = [this.root],
      bp = this.leafCopy;
    this.fr('整列して左から詰め込み');
    const put = (k: number, lv: number): void => {
      const id = levels[lv];
      if (this.n(id).k.length < this.maxK) {
        this.mut(id).k.push(k);
        return;
      }
      this.cnt.w++;
      const r = this.node(lv === 0);
      if (lv === 0 && bp) {
        this.mut(r).k = [k];
        this.mut(id).next = r;
      }
      levels[lv] = r;
      if (lv + 1 === levels.length) {
        const t = this.node(false);
        this.mut(t).c = [id];
        levels.push(t);
        this.root = t;
      }
      put(k, lv + 1);
      this.mut(levels[lv + 1]).c.push(r);
    };
    keys.forEach((k, i) => {
      this.nextI = i + 1;
      put(k, 0);
      this.fr(`${k} を詰め込み`, { w: [levels[0]], hot: [k] });
    });
    /* 右端のノードの不足は左隣から借りる。下の段が借りる相手を持てるよう上の段から直す */
    for (let lv = levels.length - 2; lv >= 0; lv--) {
      const id = levels[lv],
        p = levels[lv + 1];
      while (this.n(id).k.length < this.minK) {
        const i = this.n(p).c.indexOf(id);
        this.rotate(this.n(p).c[i - 1], id, p, i - 1, true);
      }
    }
    this.cnt.w += levels.length;
  }
}

/** 全部の操作を実行してコマの列を作る */
export function runTrace(def: Def, m: number, ops: StageOps, opt: RunOpt = {}): Trace {
  const keys = ops[0].flatMap((o) => (o.t === 'add' ? [o.k] : o.t === 'bulk' ? [...o.keys] : [])),
    R = new Run(def, m, opt),
    starts: Trace['starts'] = [0, 0, 0, 0],
    totals: Trace['totals'] = [{ ...ZERO }, { ...ZERO }, { ...ZERO }, { ...ZERO }];
  for (const s of [0, 1, 2, 3] as const) {
    R.step = s;
    R.cnt = { ...ZERO };
    R.out = [];
    R.cur = null;
    R.tok = 0;
    starts[s] = R.F.length;
    R.fr('');
    ops[s].forEach((op, i) => {
      R.tok = i;
      if (op.t === 'add') {
        R.nextI++;
        R.add(op.k);
      } else if (op.t === 'bulk') R.bulk(op.keys);
      else if (op.t === 'find') R.find(op.k);
      else if (op.t === 'range') R.range(op.lo, op.hi);
      else R.del(op.k);
      R.cur = null;
      R.fr('');
    });
    R.tok = ops[s].length;
    R.fr(`${STAGES[s][1]} 完了`);
    totals[s] = { ...R.cnt };
  }
  return {
    def,
    m: R.m,
    maxK: R.maxK,
    minK: R.minK,
    rootK: R.rootK,
    frames: R.F,
    starts,
    totals,
    keys,
    vm: opt.vm ?? vmOf(keys.length),
    bufCap: R.bufCap,
    leafCopy: R.leafCopy,
    maxDepth: R.maxDepth,
  };
}

export interface Shape {
  /** 中順のキー（B+木とBε木は葉のキーとバッファの追加） */
  keys: number[];
  depth: number;
  /** 全部の葉が同じ段か */
  uniform: boolean;
  nodes: number;
  /** 条件を破ったノードの数 */
  bad: number;
  /** キーの下限を割ったノードの数（根を除く） */
  low: number;
  fill: number;
}
/** コマの木の形を調べる */
export function inspect(t: Trace, f: Frame): Shape {
  const keys: number[] = [],
    leafD = new Set<number>(),
    bst = t.def.kind === 'bst';
  let nodes = 0,
    bad = 0,
    low = 0,
    slots = 0,
    used = 0;
  const walk = (id: number, d: number): void => {
    if (id < 0) return;
    const v = f.N[id];
    if (!v) {
      bad++;
      return;
    }
    const isRoot = id === f.root,
      cap = isRoot ? t.rootK : t.maxK;
    nodes++;
    slots += cap;
    used += v.k.length;
    if (bst) {
      walk(v.c[0], d + 1);
      keys.push(v.k[0]);
      walk(v.c[1], d + 1);
      leafD.add(d);
      return;
    }
    if (v.k.length > cap) bad++;
    if (!isRoot && v.k.length < t.minK) low++;
    for (let i = 1; i < v.k.length; i++) if (v.k[i] <= v.k[i - 1]) bad++;
    if (v.leaf) {
      leafD.add(d);
      keys.push(...v.k);
      return;
    }
    if (v.c.length !== v.k.length + 1) bad++;
    v.c.forEach((c, i) => {
      walk(c, d + 1);
      if (!t.leafCopy && i < v.k.length) keys.push(v.k[i]);
    });
    for (const b of v.buf) if (!b.del) keys.push(b.k);
  };
  if (f.root >= 0) walk(f.root, 1);
  return {
    keys,
    depth: leafD.size ? Math.max(...leafD) : 0,
    uniform: leafD.size <= 1,
    nodes,
    bad,
    low,
    fill: slots ? used / slots : 0,
  };
}

/** 段数の目安。bin は形を整えた二分探索木、bt は B+木、fan は B+木の次数 */
export interface Levels {
  bin: number;
  fan: number;
  bt: number;
}
/** キーとポインタの大きさ [バイト] と、ランダムな追加での充填率 */
export const ENTRY = 16;
export const FILL = 0.69;
export function levelsFor(rows: number, page: number): Levels {
  const fan = Math.floor(page / ENTRY);
  return {
    bin: Math.ceil(Math.log2(rows + 1)),
    fan,
    bt: Math.max(1, Math.ceil(Math.log(rows) / Math.log(fan * FILL))),
  };
}

export interface Avg {
  add: number;
  find: number;
  range: number;
  del: number;
  /** 追加 1 回で書くページ */
  wr: number;
  fill: number;
  depth: number;
}
/** n 個で何通りかのデータを試した 1 回あたりの読み書き */
export function average(d: Def, m: number, n = 31, tries = 8): Avg {
  const a: Avg = { add: 0, find: 0, range: 0, del: 0, wr: 0, fill: 0, depth: 0 };
  for (let s = 1; s <= tries; s++) {
    const keys = makeKeys('rand', n, s),
      ops = makeOps(keys, s, 'add'),
      t = runTrace(d, m, ops),
      i = inspect(t, t.frames[t.starts[1]]),
      [A, F, R, D] = t.totals;
    a.add += (A.r + A.w) / n;
    a.wr += A.w / n;
    a.find += (F.r + F.w) / ops[1].length;
    a.range += R.r + R.w;
    a.del += (D.r + D.w) / ops[3].length;
    a.fill += i.fill;
    a.depth += i.depth;
  }
  for (const k of Object.keys(a) as (keyof Avg)[]) a[k] /= tries;
  return a;
}

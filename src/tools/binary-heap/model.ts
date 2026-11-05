/**
 * 二分ヒープのページの模型。操作の列を実行して、1 手ごとのコマを記録する。図と音は記録を再生する。
 * 格納とソートは別の工程で、回数もそれぞれ 0 から数える。
 * 比較は値を比べた数、移動は要素かポインタを書き込んだ数（交換は 1 回）である
 */
import { type BarShape, rng, shapeAt } from '../list-queue-stack/model';

export type OpKey = 'add' | 'peek' | 'pop' | 'change' | 'build';
export type Method = 'add' | 'build';
/** implicit は木を配列に入れるヒープ。leftist〜fib はポインタでつなぐヒープ */
export type Kind = 'implicit' | 'leftist' | 'skew' | 'binomial' | 'pairing' | 'fib' | 'array';

export interface Def {
  id: string;
  name: string;
  kind: Kind;
  /** 配列に入れるヒープの子の数。それ以外は 0 */
  d: number;
  mem: string;
  ex: string;
}
const MEM_PTR = '値と子へのポインタ';
export const DEFS: readonly Def[] = [
  {
    id: 'bin',
    name: '二分ヒープ',
    kind: 'implicit',
    d: 2,
    mem: '値のみ（配列）',
    ex: 'タイマーの待ち行列・ダイクストラ法・ヒープソート',
  },
  {
    id: 'h4',
    name: '4 分ヒープ',
    kind: 'implicit',
    d: 4,
    mem: '値のみ（配列）',
    ex: '追加が多い待ち行列・ダイクストラ法',
  },
  { id: 'lt', name: '左傾ヒープ', kind: 'leftist', d: 0, mem: MEM_PTR, ex: 'ヒープどうしのマージが多いとき' },
  { id: 'sk', name: 'スキューヒープ', kind: 'skew', d: 0, mem: MEM_PTR, ex: 'ヒープどうしのマージが多いとき' },
  { id: 'bn', name: '二項ヒープ', kind: 'binomial', d: 0, mem: MEM_PTR, ex: 'ヒープどうしのマージが多いとき' },
  { id: 'pr', name: 'ペアリングヒープ', kind: 'pairing', d: 0, mem: MEM_PTR, ex: '実装が簡単で速い優先度付きキュー' },
  { id: 'fb', name: 'フィボナッチヒープ', kind: 'fib', d: 0, mem: MEM_PTR, ex: '値の変更が多いグラフのアルゴリズム' },
  { id: 'ar', name: '配列（参考）', kind: 'array', d: 0, mem: '値のみ（配列）', ex: '要素が少ないときの待ち行列' },
];
export const defOf = (id: string): Def | undefined => DEFS.find((d) => d.id === id);
/** ポインタでつなぐヒープか */
export const isPointer = (d: Def): boolean => d.kind !== 'implicit' && d.kind !== 'array';

export const KEYS: readonly (readonly [OpKey, string])[] = [
  ['add', '追加'],
  ['peek', '確認'],
  ['pop', '取り出し'],
  ['change', '値の変更'],
  ['build', 'まとめて構築'],
];
const HEAP_O: Record<OpKey, string> = {
  add: 'O(log n)',
  peek: 'O(1)',
  pop: 'O(log n)',
  change: 'O(log n)',
  build: 'O(n)',
};
/** 計算量。* は償却。値の変更は変える場所がわかっていて、根に近づく向きに変えるときの回数である */
export const BIG_O: Record<string, Record<OpKey, string>> = {
  bin: HEAP_O,
  h4: HEAP_O,
  lt: HEAP_O,
  sk: { add: 'O(log n)*', peek: 'O(1)', pop: 'O(log n)*', change: 'O(log n)*', build: 'O(n)*' },
  bn: { add: 'O(1)*', peek: 'O(log n)', pop: 'O(log n)', change: 'O(log n)', build: 'O(n)' },
  pr: { add: 'O(1)', peek: 'O(1)', pop: 'O(log n)*', change: 'o(log n)*', build: 'O(n)' },
  fb: { add: 'O(1)', peek: 'O(1)', pop: 'O(log n)*', change: 'O(1)*', build: 'O(n)' },
  ar: { add: 'O(1)', peek: 'O(n)', pop: 'O(n)', change: 'O(1)', build: 'O(n)' },
};
const HOW_MELD: Record<OpKey, string> = {
  add: '1 個の木としてマージ',
  peek: '根を見るだけ',
  pop: '根を出し、左右の子をマージ',
  change: '切り離して根とマージ',
  build: '2 個ずつ順にマージ',
};
const HOW: Record<Kind, Record<OpKey, string>> = {
  implicit: {
    add: '末尾に入れ、親と比べて上へ',
    peek: '根を見るだけ',
    pop: '根を出し、末尾を根へ移して下へ',
    change: '変えた場所から上へ',
    build: '全部入れて下の段から直す',
  },
  leftist: HOW_MELD,
  skew: HOW_MELD,
  binomial: {
    add: '同じ大きさの木をつなぐ',
    peek: '木の根を全部見る',
    pop: '最良の根を出し、木をつなぎ直す',
    change: '変えた場所から上へ',
    build: '1 個ずつ順に追加',
  },
  pairing: {
    add: '根と比べ、負けたほうを子にする',
    peek: '根を見るだけ',
    pop: '根を出し、子を 2 個ずつつなぐ',
    change: '切り離して根とつなぐ',
    build: '1 個ずつ順に追加',
  },
  fib: {
    add: '根の列に足すだけ',
    peek: '最良の根を見るだけ',
    pop: '最良の根を出し、同じ大きさの木をつなぐ',
    change: '切り離して根の列へ',
    build: '1 個ずつ順に追加',
  },
  array: {
    add: '末尾に入れるだけ',
    peek: '全部見て探す',
    pop: '全部見て探す',
    change: '書き換えるだけ',
    build: 'そのまま入れるだけ',
  },
};
export const howOf = (d: Def, k: OpKey): string => HOW[d.kind][k];
export const opName = (k: OpKey, max: boolean): string => {
  const top = max ? '最大値' : '最小値';
  if (k === 'peek') return `${top}の確認`;
  if (k === 'pop') return `${top}の取り出し`;
  return (KEYS.find((x) => x[0] === k) as readonly [OpKey, string])[1];
};

/** バーの値の上限（1〜VM）。語りの文に出すので 2 桁に収める */
export const VM = 99;
/** 操作の表で追加できる要素の上限 */
export const ADD_MAX = 127;

/** バーの値。id の順に格納する。配列の左から id の順に並ぶので、選んだ形がそのまま見える */
export function barVals(k: BarShape, n: number, seed: number): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, id) => Math.max(1, Math.round(shapeAt(k, n > 1 ? id / (n - 1) : 0, r) * VM)));
}

/** 添字 i の段と、段の中の位置 */
export function levelOf(i: number, d: number): { l: number; j: number } {
  let l = 0,
    s = 0,
    c = 1;
  while (i >= s + c) {
    s += c;
    c *= d;
    l++;
  }
  return { l, j: i - s };
}
/** 要素数 n の木の段数 */
export const levelsOf = (n: number, d: number): number => (n < 1 ? 0 : levelOf(n - 1, d).l + 1);
export const parentOf = (i: number, d: number): number => Math.floor((i - 1) / d);

export interface Frame {
  /** 格納済みの要素（id）。配列に入れるヒープと配列では添字の順で、添字 0 が根 */
  h: number[];
  /** ポインタでつなぐヒープの形: h の順は行きがけ順で、par は親の h 上の位置（根は -1） */
  par?: number[];
  /** 次に格納する id */
  next: number;
  /** 取り出した順の id */
  out: number[];
  /** 比べている要素 */
  r: number[];
  /** 動かした要素 */
  w: number[];
  say: string;
  cmp: number;
  mov: number;
  /** 何番目の操作か（0 は始める前） */
  tok: number;
  /** 親の条件を破っている枝の数 */
  bad: number;
  /** 木の段数 */
  depth: number;
}
export interface Trace {
  def: Def;
  /** id ごとの値。値を変えるたびに増える */
  vals: number[];
  /** 待機中と格納済みの id の範囲（0〜n） */
  n: number;
  max: boolean;
  frames: Frame[];
  /** 図の木の大きさ */
  cap: number;
}
export interface RunOpt {
  vals: readonly number[];
  tokens: readonly OpKey[];
  /** 始める前に実行する操作。回数は数えない */
  pre?: readonly OpKey[];
  max?: boolean;
  seed?: number;
  startSay?: string;
  endSay?: string;
}

class Sim {
  readonly d: number;
  readonly kind: Kind;
  readonly vals: number[];
  n: number;
  readonly max: boolean;
  private readonly r: () => number;
  /** 配列に入れるヒープと配列の中身 */
  h: number[] = [];
  /** ポインタでつなぐヒープの木: 根の列・子の列・親・左傾ヒープの右の高さ・フィボナッチヒープの印 */
  private roots: number[] = [];
  private readonly kids = new Map<number, number[]>();
  private readonly up = new Map<number, number>();
  private readonly rank = new Map<number, number>();
  private readonly marked = new Set<number>();
  /** フィボナッチヒープの最良の根 */
  private best = -1;
  private readonly pointer: boolean;
  next = 0;
  out: number[] = [];
  cmp = 0;
  mov = 0;
  tok = 0;
  frames: Frame[] = [];
  quiet = false;
  private readonly big: string;
  private readonly ge: string;
  private readonly top: string;

  constructor(
    readonly def: Def,
    vals: readonly number[],
    max: boolean,
    seed: number,
  ) {
    this.d = def.d;
    this.kind = def.kind;
    this.pointer = isPointer(def);
    this.vals = [...vals];
    this.n = vals.length;
    this.max = max;
    this.r = rng(seed + 41);
    this.big = max ? '>' : '<';
    this.ge = max ? '≥' : '≤';
    this.top = max ? '最大値' : '最小値';
  }
  private V(id: number): number {
    return this.vals[id];
  }
  private better(a: number, b: number): boolean {
    return this.max ? this.V(a) > this.V(b) : this.V(a) < this.V(b);
  }
  /** ポインタでつなぐヒープの要素を行きがけ順にたどる */
  private walk(fn: (id: number, parentAt: number, level: number) => void): void {
    let at = 0;
    const go = (id: number, p: number, l: number): void => {
      const me = at++;
      fn(id, p, l);
      for (const c of this.kids.get(id) ?? []) go(c, me, l + 1);
    };
    for (const r of this.roots) go(r, -1, 1);
  }
  /** 格納済みの要素の数 */
  get size(): number {
    if (!this.pointer) return this.h.length;
    let k = 0;
    this.walk(() => {
      k++;
    });
    return k;
  }
  emit(say = '', r: number[] = [], w: number[] = []): void {
    if (this.quiet) return;
    const f: Frame = {
      h: [],
      next: this.next,
      out: [...this.out],
      r,
      w,
      say,
      cmp: this.cmp,
      mov: this.mov,
      tok: this.tok,
      bad: 0,
      depth: 0,
    };
    if (this.pointer) {
      const par: number[] = [],
        { h } = f;
      this.walk((id, p, l) => {
        h.push(id);
        par.push(p);
        f.depth = Math.max(f.depth, l);
        if (p >= 0 && this.better(id, h[p])) f.bad++;
      });
      f.par = par;
    } else {
      f.h = [...this.h];
      if (this.d) {
        f.depth = levelsOf(f.h.length, this.d);
        for (let i = 1; i < f.h.length; i++) if (this.better(f.h[i], f.h[parentOf(i, this.d)])) f.bad++;
      }
    }
    this.frames.push(f);
  }
  private take(): number {
    if (this.next < this.n) return this.next++;
    this.vals.push(1 + Math.floor(this.r() * VM));
    this.n = this.vals.length;
    this.next = this.n;
    return this.n - 1;
  }
  /** 根に近づく向きの新しい値 */
  private raised(old: number): number {
    const span = this.max ? VM - old : old - 1,
      k = Math.floor(this.r() * (span + 1));
    return this.max ? old + k : old - k;
  }

  /* ---------- 配列に入れるヒープ ---------- */
  private swap(i: number, j: number): void {
    const a = this.h[i];
    this.h[i] = this.h[j];
    this.h[j] = a;
    this.mov++;
  }
  private sayUp(a: number, b: number, go: boolean): string {
    return go ? `${this.V(a)} ${this.big} 親 ${this.V(b)} → 交換` : `親 ${this.V(b)} ${this.ge} ${this.V(a)} → 止める`;
  }
  private siftUp(start: number): void {
    let i = start;
    while (i > 0) {
      const p = parentOf(i, this.d),
        a = this.h[i],
        b = this.h[p],
        go = this.better(a, b);
      this.cmp++;
      this.emit(this.sayUp(a, b, go), [a, b]);
      if (!go) return;
      this.swap(i, p);
      this.emit(`${this.V(a)} が 1 段上へ`, [], [a, b]);
      i = p;
    }
    this.emit(`${this.V(this.h[0])} が根へ`, [this.h[0]]);
  }
  private siftDown(start: number): void {
    let i = start;
    for (;;) {
      const a = this.h[i],
        kids: number[] = [];
      for (let k = 1; k <= this.d; k++) {
        const c = this.d * i + k;
        if (c < this.h.length) kids.push(c);
      }
      if (!kids.length) {
        this.emit(`${this.V(a)} 子なし → 止める`, [a]);
        return;
      }
      let best = kids[0];
      for (const c of kids) if (this.better(this.h[c], this.h[best])) best = c;
      /* 子どうしで kids - 1 回、選んだ子と親で 1 回 */
      this.cmp += kids.length;
      const b = this.h[best],
        go = this.better(b, a);
      this.emit(
        go ? `子 ${this.V(b)} ${this.big} ${this.V(a)} → 交換` : `${this.V(a)} ${this.ge} 子 ${this.V(b)} → 止める`,
        [a, ...kids.map((c) => this.h[c])],
      );
      if (!go) return;
      this.swap(i, best);
      this.emit(`${this.V(a)} が 1 段下へ`, [], [a, b]);
      i = best;
    }
  }
  private scan(): number {
    let b = 0;
    for (let i = 1; i < this.h.length; i++) {
      this.cmp++;
      if (this.better(this.h[i], this.h[b])) b = i;
      this.emit(`${this.top}の候補 ${this.V(this.h[b])}`, [this.h[b], this.h[i]]);
    }
    return b;
  }

  /* ---------- ポインタでつなぐヒープの部品 ---------- */
  private kidsOf(id: number): number[] {
    let k = this.kids.get(id);
    if (!k) {
      k = [];
      this.kids.set(id, k);
    }
    return k;
  }
  private dropRoot(id: number): void {
    const i = this.roots.indexOf(id);
    if (i >= 0) this.roots.splice(i, 1);
  }
  /** c を根の列から外して p の子にする */
  private attach(p: number, c: number, first = false): void {
    this.dropRoot(c);
    const k = this.kidsOf(p);
    if (first) k.unshift(c);
    else k.push(c);
    this.up.set(c, p);
    this.mov++;
  }
  /** c を親から切り離して根の列へ移す */
  private cut(c: number): void {
    const p = this.up.get(c);
    if (p === undefined) return;
    const k = this.kidsOf(p);
    k.splice(k.indexOf(c), 1);
    this.up.delete(c);
    this.roots.push(c);
    this.mov++;
  }
  /** 根を取り除き、子を根の列へ移す */
  private dissolve(root: number): void {
    const i = this.roots.indexOf(root),
      k = this.kids.get(root) ?? [];
    this.roots.splice(i, 1, ...k);
    for (const c of k) this.up.delete(c);
    this.kids.delete(root);
  }
  /** 2 つの根を比べて、負けたほうを勝ったほうの子にする。勝ったほうを返す */
  private link(a: number, b: number, first = false): number {
    this.cmp++;
    const win = this.better(b, a) ? b : a,
      lose = win === a ? b : a;
    this.emit(`根 ${this.V(a)} と根 ${this.V(b)} を比較`, [a, b]);
    this.attach(win, lose, first);
    this.emit(`${this.V(lose)} を ${this.V(win)} の子へ`, [], [win, lose]);
    return win;
  }
  /** 根の列から最良の根を探す */
  private scanRoots(): number {
    let b = this.roots[0];
    for (const r of this.roots.slice(1)) {
      this.cmp++;
      this.emit(`${this.top}の候補 ${this.V(this.better(r, b) ? r : b)}`, [b, r]);
      if (this.better(r, b)) b = r;
    }
    return b;
  }
  /** 子の数が同じ木をつなぎ、子の数を 1 通りずつにする */
  private consolidate(): void {
    const byDeg = new Map<number, number>();
    for (const start of [...this.roots]) {
      let x = start;
      for (;;) {
        const deg = this.kidsOf(x).length,
          y = byDeg.get(deg);
        if (y === undefined) {
          byDeg.set(deg, x);
          break;
        }
        byDeg.delete(deg);
        x = this.link(y, x);
        this.marked.delete(this.kidsOf(x).at(-1) as number);
      }
    }
    /* 子の少ない木を左に置く */
    this.roots.sort((a, b) => this.kidsOf(a).length - this.kidsOf(b).length);
  }
  /** 左傾ヒープとスキューヒープのマージ: 勝ったほうの右の子と、負けたほうをマージしていく */
  private meld(a: number, b: number): number {
    this.cmp++;
    this.emit(`根 ${this.V(a)} と根 ${this.V(b)} を比較`, [a, b]);
    const w = this.better(b, a) ? b : a,
      l = w === a ? b : a,
      k = this.kidsOf(w),
      x = k.length === 2 ? k[1] : undefined;
    if (x !== undefined) this.cut(x);
    const r = x === undefined ? l : this.meld(x, l);
    this.attach(w, r);
    this.emit(`${this.V(r)} を ${this.V(w)} の右の子へ`, [], [w, r]);
    if (this.kind === 'skew') this.flip(w);
    else this.fixRank(w);
    return w;
  }
  private rankOf(id: number | undefined): number {
    return id === undefined ? 0 : (this.rank.get(id) ?? 1);
  }
  /** 左右の子を入れ替える。子が 1 つなら左の子のままにする */
  private flip(id: number): void {
    const k = this.kidsOf(id);
    if (k.length < 2) return;
    k.reverse();
    this.mov++;
    this.emit(`${this.V(id)} の左右の子を交換`, [], [id]);
  }
  /** 左傾ヒープの条件: 左の子の高さは右の子以上 */
  private fixRank(id: number): void {
    const k = this.kidsOf(id);
    if (k.length === 2 && this.rankOf(k[0]) < this.rankOf(k[1])) this.flip(id);
    this.rank.set(id, this.rankOf(k[1]) + 1);
  }
  /** 切り離したあとの左傾ヒープの高さを、親へたどって直す */
  private fixUp(start: number): void {
    let id: number | undefined = start;
    while (id !== undefined) {
      const before = this.rankOf(id);
      this.fixRank(id);
      if (this.rankOf(id) === before) return;
      id = this.up.get(id);
    }
  }
  /** 二項ヒープの繰り上がり: 先頭の 2 本が同じ大きさの間つなぐ */
  private carry(): void {
    while (this.roots.length > 1 && this.kidsOf(this.roots[0]).length === this.kidsOf(this.roots[1]).length) {
      const win = this.link(this.roots[0], this.roots[1]);
      this.dropRoot(win);
      this.roots.unshift(win);
    }
  }

  /* ---------- 操作 ---------- */
  private add(): void {
    const id = this.take();
    this.mov++;
    if (!this.pointer) {
      this.h.push(id);
      this.emit(`追加 ${this.V(id)}`, [], [id]);
      if (this.d) this.siftUp(this.h.length - 1);
      return;
    }
    const old = this.roots[0];
    if (this.kind === 'binomial') this.roots.unshift(id);
    else this.roots.push(id);
    this.emit(`追加 ${this.V(id)}`, [], [id]);
    if (this.roots.length === 1) {
      this.best = id;
      return;
    }
    if (this.kind === 'leftist' || this.kind === 'skew') this.meld(old, id);
    else if (this.kind === 'pairing') this.link(old, id, true);
    else if (this.kind === 'binomial') this.carry();
    else this.compareBest(id);
  }
  /** フィボナッチヒープ: 最良の根だけ更新する */
  private compareBest(id: number): void {
    this.cmp++;
    this.emit(`最良の根 ${this.V(this.best)} と比較`, [this.best, id]);
    if (this.better(id, this.best)) this.best = id;
  }
  private pop(): void {
    if (!this.size) {
      this.emit('空');
      return;
    }
    if (this.pointer) {
      this.popTree();
      return;
    }
    const { h } = this;
    if (this.d) {
      const root = h[0];
      this.emit(`根 ${this.V(root)} = ${this.top}`, [root]);
      const last = h.pop() as number;
      this.out.push(root);
      this.mov++;
      if (last === root) {
        this.emit(`取り出し ${this.V(root)}`, [], [root]);
        return;
      }
      h[0] = last;
      this.emit(`取り出し ${this.V(root)}、末尾 ${this.V(last)} を根へ`, [], [last]);
      this.siftDown(0);
      return;
    }
    const b = this.scan(),
      id = h[b];
    h[b] = h[h.length - 1];
    h.pop();
    this.out.push(id);
    this.mov++;
    this.emit(`取り出し ${this.V(id)}、末尾を空きへ`, [], [id]);
  }
  private popTree(): void {
    const root = this.kind === 'fib' ? this.best : this.kind === 'binomial' ? this.scanRoots() : this.roots[0];
    this.emit(`根 ${this.V(root)} = ${this.top}`, [root]);
    this.mov += 1 + this.kidsOf(root).length;
    this.dissolve(root);
    this.out.push(root);
    this.emit(`取り出し ${this.V(root)}`);
    if (!this.roots.length) return;
    if (this.kind === 'leftist' || this.kind === 'skew') {
      if (this.roots.length === 2) this.meld(this.roots[0], this.roots[1]);
    } else if (this.kind === 'pairing') {
      /* 左から 2 本ずつつなぎ、右からまとめる */
      const first = [...this.roots],
        pass: number[] = [];
      for (let i = 0; i < first.length; i += 2)
        pass.push(i + 1 < first.length ? this.link(first[i], first[i + 1], true) : first[i]);
      let w = pass[pass.length - 1];
      for (let i = pass.length - 2; i >= 0; i--) w = this.link(pass[i], w, true);
    } else {
      this.consolidate();
      if (this.kind === 'fib') this.best = this.scanRoots();
    }
  }
  private peek(): void {
    if (!this.size) {
      this.emit('空');
      return;
    }
    if (this.kind === 'array' || this.kind === 'binomial') {
      const id = this.kind === 'array' ? this.h[this.scan()] : this.scanRoots();
      this.emit(`${this.top} ${this.V(id)}`, [id]);
      return;
    }
    const id = this.d ? this.h[0] : this.kind === 'fib' ? this.best : this.roots[0];
    this.cmp++;
    this.emit(`根 ${this.V(id)} = ${this.top}`, [id]);
  }
  /** 要素を根に近づく向きの値へ変える。新しい値は新しい id として持つ */
  private change(): void {
    const size = this.size;
    if (!size) {
      this.emit('空');
      return;
    }
    const i = Math.floor(this.r() * size);
    if (!this.pointer) {
      const old = this.V(this.h[i]),
        v = this.raised(old);
      this.vals.push(v);
      const id = this.vals.length - 1;
      this.h[i] = id;
      this.mov++;
      this.emit(`変更 ${old} → ${v}`, [], [id]);
      if (this.d) this.siftUp(i);
      return;
    }
    let oldId = -1,
      at = 0;
    this.walk((x) => {
      if (at++ === i) oldId = x;
    });
    const old = this.V(oldId),
      v = this.raised(old);
    this.vals.push(v);
    const id = this.vals.length - 1;
    this.replace(oldId, id);
    this.mov++;
    this.emit(`変更 ${old} → ${v}`, [], [id]);
    const p = this.up.get(id);
    if (this.kind === 'binomial') {
      this.bubble(id);
      return;
    }
    if (p === undefined) {
      if (this.kind === 'fib' && this.better(id, this.best)) this.best = id;
      return;
    }
    const go = this.better(id, p);
    this.cmp++;
    this.emit(
      go
        ? `${this.V(id)} ${this.big} 親 ${this.V(p)} → 切り離し`
        : `親 ${this.V(p)} ${this.ge} ${this.V(id)} → そのまま`,
      [id, p],
    );
    if (!go) return;
    this.cut(id);
    this.emit(`切り離し ${this.V(id)}`, [], [id]);
    if (this.kind === 'fib') {
      this.cascade(p);
      this.compareBest(id);
      return;
    }
    if (this.kind === 'leftist') this.fixUp(p);
    const root = this.roots[0];
    if (this.kind === 'pairing') this.link(root, id, true);
    else this.meld(root, id);
  }
  /** 新しい id を古い id の場所へ置く */
  private replace(oldId: number, id: number): void {
    const p = this.up.get(oldId);
    if (p === undefined) this.roots[this.roots.indexOf(oldId)] = id;
    else {
      const k = this.kidsOf(p);
      k[k.indexOf(oldId)] = id;
      this.up.delete(oldId);
      this.up.set(id, p);
    }
    const k = this.kids.get(oldId) ?? [];
    this.kids.set(id, k);
    this.kids.delete(oldId);
    for (const c of k) this.up.set(c, id);
    this.rank.set(id, this.rankOf(oldId));
    if (this.marked.delete(oldId)) this.marked.add(id);
    if (this.best === oldId) this.best = id;
  }
  /** 親と場所を入れ替えながら上がる（二項ヒープ） */
  private bubble(id: number): void {
    for (;;) {
      const p = this.up.get(id);
      if (p === undefined) return;
      const go = this.better(id, p);
      this.cmp++;
      this.emit(this.sayUp(id, p, go), [id, p]);
      if (!go) return;
      this.swapNodes(id, p);
      this.mov++;
      this.emit(`${this.V(id)} が 1 段上へ`, [], [id, p]);
    }
  }
  /** 親 p と子 c の場所を入れ替える */
  private swapNodes(c: number, p: number): void {
    const g = this.up.get(p),
      ck = this.kidsOf(c),
      pk = this.kidsOf(p);
    pk[pk.indexOf(c)] = p;
    if (g === undefined) {
      this.roots[this.roots.indexOf(p)] = c;
      this.up.delete(c);
    } else {
      const gk = this.kidsOf(g);
      gk[gk.indexOf(p)] = c;
      this.up.set(c, g);
    }
    this.kids.set(c, pk);
    this.kids.set(p, ck);
    for (const x of pk) this.up.set(x, c);
    for (const x of ck) this.up.set(x, p);
  }
  /** フィボナッチヒープの連鎖的な切り離し: 2 個目の子を失った親も切り離す */
  private cascade(start: number): void {
    let p = start;
    for (;;) {
      const g = this.up.get(p);
      if (g === undefined) return;
      if (!this.marked.has(p)) {
        this.marked.add(p);
        return;
      }
      this.marked.delete(p);
      this.cut(p);
      this.emit(`切り離し ${this.V(p)}`, [], [p]);
      p = g;
    }
  }
  private build(): void {
    if (this.kind === 'binomial' || this.kind === 'pairing' || this.kind === 'fib') {
      while (this.next < this.n) this.add();
      return;
    }
    if (this.pointer) {
      const fresh: number[] = [];
      while (this.next < this.n) {
        fresh.push(this.next);
        this.roots.push(this.next++);
        this.mov++;
      }
      this.emit('残りを全部 1 個ずつの木へ', [], fresh);
      const q = [...this.roots];
      while (q.length > 1) q.push(this.meld(q.shift() as number, q.shift() as number));
      return;
    }
    const before = this.h.length;
    while (this.next < this.n) {
      this.h.push(this.next++);
      this.mov++;
    }
    this.emit('残りを全部配列へ', [], this.h.slice(before));
    if (!this.d || this.h.length < 2) return;
    for (let i = parentOf(this.h.length - 1, this.d); i >= 0; i--) this.siftDown(i);
  }
  run(k: OpKey): void {
    this[k]();
  }
}

/** 操作を実行してコマを記録する */
export function runTrace(def: Def, o: RunOpt): Trace {
  const s = new Sim(def, o.vals, o.max ?? true, o.seed ?? 1);
  if (o.pre?.length) {
    s.quiet = true;
    for (const t of o.pre) s.run(t);
    s.quiet = false;
    s.cmp = 0;
    s.mov = 0;
  }
  s.emit(o.startSay ?? '');
  o.tokens.forEach((t, i) => {
    s.tok = i + 1;
    s.run(t);
  });
  if (o.endSay) s.emit(o.endSay);
  let cap = o.vals.length;
  for (const f of s.frames) cap = Math.max(cap, f.h.length);
  return { def, vals: s.vals, n: s.n, max: s.max, frames: s.frames, cap };
}

/** コマを作らずに回数だけ数える */
function runQuiet(def: Def, o: RunOpt): Sim {
  const s = new Sim(def, o.vals, o.max ?? true, o.seed ?? 1);
  s.quiet = true;
  for (const t of o.pre ?? []) s.run(t);
  s.cmp = 0;
  s.mov = 0;
  for (const t of o.tokens) s.run(t);
  return s;
}

/** 格納の工程の操作の列 */
export const storeTokens = (m: Method, n: number): OpKey[] => (m === 'build' ? ['build'] : Array(n).fill('add'));
/** ソートの工程の操作の列: 格納したものを全部取り出す */
export function sortTokens(def: Def, o: Pick<RunOpt, 'vals' | 'max' | 'seed'>, store: readonly OpKey[]): OpKey[] {
  return Array(runQuiet(def, { ...o, tokens: store }).size).fill('pop');
}
/** 操作の列の回数の合計 */
export function totalOf(def: Def, o: RunOpt): number {
  const s = runQuiet(def, o);
  return s.cmp + s.mov;
}

/** 償却の操作か */
export const isAmortized = (def: Def, key: OpKey): boolean => BIG_O[def.id][key].endsWith('*');
/**
 * 操作の表の回数: n 要素の状態から実行したときの比較と移動を、24 通りのデータの平均で数える。
 * 償却の操作とフィボナッチヒープの取り出しは n 回続けた 1 回あたりにする。1 回だけでは後払いの分が見えないため
 */
export function countOp(def: Def, key: OpKey, n: number, max = true): number {
  const TRY = 24,
    again = isAmortized(def, key) && key !== 'build' ? n : 1;
  let t = 0;
  for (let k = 0; k < TRY; k++) {
    const vals = barVals('rand', n, 100 + k * 13);
    /* 追加は n - 1 要素に足して n 要素にする。n 回続けるときは空から。まとめて構築は空から */
    const size = key === 'build' ? 0 : key === 'add' ? (again > 1 ? 0 : n - 1) : n,
      pre: OpKey[] = Array(size).fill('add');
    t += totalOf(def, { vals, pre, tokens: Array(again).fill(key), max, seed: 7 + k }) / again;
  }
  return t / TRY;
}

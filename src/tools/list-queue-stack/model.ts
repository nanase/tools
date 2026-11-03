/**
 * データ構造の模型。バーの追加と取り出しを 1 手ずつ記録する。
 * 新しいデータ構造は DEFS に足す。図の入れ物は shape で選ぶ（fig.ts）
 */

/** バーの高さの上限。値は 1〜VM の整数 */
export const VM = 1000;

export type Shape = 'pile' | 'tube' | 'tube2' | 'slots' | 'chain' | 'chain2' | 'ring';
export type OpKey = 'front+' | 'back+' | 'front-' | 'back-' | 'mid+' | 'mid-' | 'get' | 'find';
/** 再生する操作。in・out は入れる場所と出す場所の決まりに従い、OpKey はその操作を 1 回行う */
export type Token = 'in' | 'out' | OpKey;
export type RuleIn = 'left' | 'right' | 'sort' | 'rand';
export type RuleOut = 'left' | 'right';
export interface Rule {
  in: RuleIn;
  out: RuleOut;
}

/** 1 手ごとの様子 */
export interface Frame {
  /** 実行した操作の数（Token の位置） */
  tok: number;
  /** 入れ物の中のバー。左から順。配列でバーをずらしている間は null の場所がある */
  items: (number | null)[];
  /** 出たバーの数（Trace.outs の先頭から） */
  outN: number;
  /** 入れ物に入ったバーの数。場所を探している間のバーは、まだ入れる前に残す */
  next: number;
  /** 書き込んだバー */
  w: number[];
  /** 読んだバー */
  r: number[];
  /** つなぎ替えたノード（そのノードから出る矢印） */
  lk: number[];
  /** たどっているバー */
  wk: number | null;
  reads: number;
  writes: number;
  /** 最大の長さ */
  max: number;
  /** 待ちの回数の合計・出た数・最長 */
  wS: number;
  wN: number;
  wM: number;
  /** 出た順が入れた順のままだった組の数 */
  ord: number;
  /** リングバッファの先頭の場所 */
  hd: number;
  /** 配列の今の大きさ */
  size: number;
  say: string;
}

export interface Op {
  key: OpKey;
  label: string;
  /** 計算量の表記（表と操作の枠に出す） */
  o: string;
  /** 追加か（満杯なら実行できない）。false はバーが 1 個以上あれば実行できる */
  add: boolean;
  /** 何度も行うと平均が一定になる操作。回数の線は n 回の平均で出す */
  amort?: boolean;
  run(s: Sim): void;
}

export interface Def {
  id: string;
  name: string;
  shape: Shape;
  order: string;
  ex: string;
  mem: string;
  /** 入れる場所と出す場所を選べるときの既定値 */
  rule?: Rule;
  /** 選べない入れる場所 */
  noIn?: RuleIn[];
  ops: Op[];
  flow: { in(s: Sim): void; out(s: Sim): void };
}

export const rng = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const nextPow2 = (v: number): number => 2 ** Math.ceil(Math.log2(Math.max(4, v)));
/** 配列の大きさの初期値 */
const SIZE0 = 4;

export class Sim {
  readonly n: number;
  /** 入れ物に入るバーの上限 */
  readonly cap: number;
  readonly rule: Rule;
  readonly vals: number[];
  readonly frames: Frame[] = [];
  readonly outs: number[] = [];
  readonly rr: () => number;
  private readonly extra: () => number;
  private readonly t0 = new Map<number, number>();
  items: (number | null)[] = [];
  next = 0;
  reads = 0;
  writes = 0;
  tok = 0;
  ops = 0;
  max = 0;
  wS = 0;
  wN = 0;
  wM = 0;
  ord = 0;
  hd = 0;
  size = SIZE0;
  say = '';
  /** 取り出して、まだ入れ物に置いていないバー */
  holding: number | null = null;

  constructor(n: number, vals: readonly number[], rule: Rule, seed: number) {
    this.n = n;
    this.cap = n + 4;
    this.rule = rule;
    this.vals = [...vals];
    this.rr = rng(seed + 5);
    this.extra = rng(seed + 31);
  }

  get len(): number {
    return this.items.reduce((c: number, v) => (v == null ? c : c + 1), 0);
  }

  /** 次に入れるバー。入力のバーを使い切ったら新しいバーを作る */
  take(): number {
    let id: number;
    if (this.next < this.n) id = this.next++;
    else {
      id = this.vals.length;
      this.vals.push(1 + Math.floor(this.extra() * VM));
    }
    this.t0.set(id, this.ops);
    this.holding = id;
    return id;
  }

  /** 下準備で入れたバーとして数える */
  prefilled(id: number): void {
    this.t0.set(id, 0);
  }

  toOut(id: number): void {
    const last = this.outs[this.outs.length - 1];
    if (this.outs.length && id > last) this.ord++;
    this.outs.push(id);
    const w = this.ops - (this.t0.get(id) ?? 0);
    this.wS += w;
    this.wN++;
    this.wM = Math.max(this.wM, w);
  }

  emit(x: { w?: number[]; r?: number[]; lk?: number[]; wk?: number } = {}): void {
    this.max = Math.max(this.max, this.len);
    this.frames.push({
      tok: this.tok,
      items: [...this.items],
      outN: this.outs.length,
      next: this.holding != null && this.holding < this.n ? this.next - 1 : this.next,
      w: x.w ?? [],
      r: x.r ?? [],
      lk: x.lk ?? [],
      wk: x.wk ?? null,
      reads: this.reads,
      writes: this.writes,
      max: this.max,
      wS: this.wS,
      wN: this.wN,
      wM: this.wM,
      ord: this.ord,
      hd: this.hd,
      size: this.size,
      say: this.say,
    });
  }
}

/** 場所を指定して足す・抜く・読む部品 */
interface Seq {
  ins(s: Sim, i: number, id: number): void;
  del(s: Sim, i: number): void;
  get(s: Sim, i: number): void;
  find(s: Sim, i: number): void;
}

const at = (s: Sim, i: number): number => s.items[i] as number;

/** 配列: 大きさが足りなければ倍の領域へ写す。足す・抜くは後ろのバーを 1 つずつずらす */
const ARR: Seq = {
  ins(s, i, id) {
    if (s.items.length >= s.size) {
      const was = s.say;
      s.say = '領域の再確保';
      s.size *= 2;
      for (const v of s.items) {
        s.reads++;
        s.writes++;
        s.emit({ w: [v as number] });
      }
      s.say = was;
    }
    s.items.push(null);
    for (let j = s.items.length - 1; j > i; j--) {
      s.items[j] = s.items[j - 1];
      s.items[j - 1] = null;
      s.reads++;
      s.writes++;
      s.emit({ w: [at(s, j)] });
    }
    s.items[i] = id;
    s.holding = null;
    s.writes++;
    s.emit({ w: [id] });
  },
  del(s, i) {
    const id = at(s, i);
    s.reads++;
    s.emit({ r: [id] });
    s.items[i] = null;
    s.toOut(id);
    for (let j = i + 1; j < s.items.length; j++) {
      s.items[j - 1] = s.items[j];
      s.items[j] = null;
      s.reads++;
      s.writes++;
      s.emit({ w: [at(s, j - 1)] });
    }
    s.items.pop();
    s.emit();
  },
  get(s, i) {
    s.reads++;
    s.emit({ r: [at(s, i)] });
  },
  find(s, i) {
    for (let k = 0; k <= i; k++) {
      s.reads++;
      s.emit({ r: [at(s, k)] });
    }
  },
};

/** リスト: 先頭からたどり、矢印だけをつなぎ替える。先頭と末尾の場所は覚えている */
const chain = (dll: boolean): Seq => {
  const walk = (s: Sim, k: number): void => {
    for (let j = 0; j <= k; j++) {
      s.reads++;
      s.emit({ r: [at(s, j)], wk: at(s, j) });
    }
  };
  return {
    ins(s, i, id) {
      if (i > 0 && i < s.items.length) walk(s, i - 1);
      s.items.splice(i, 0, id);
      s.holding = null;
      s.writes += dll ? 4 : 2;
      s.emit({ w: [id], lk: i > 0 ? [id, at(s, i - 1)] : [id] });
    },
    del(s, i) {
      const last = i === s.items.length - 1;
      /* 片方向は 1 つ前をたどって探す。双方向の末尾は prev で 1 回 */
      if (i > 0 && (!last || !dll)) walk(s, i - 1);
      const id = at(s, i);
      s.reads++;
      s.emit({ r: [id] });
      s.items.splice(i, 1);
      s.toOut(id);
      s.writes += dll ? 2 : 1;
      s.emit({ lk: i > 0 ? [at(s, i - 1)] : [] });
    },
    get: walk,
    find: walk,
  };
};
const SLL = chain(false),
  DLL = chain(true);

const midOf = (s: Sim): number => Math.floor(s.items.length / 2);

/** 場所を選べるデータ構造の操作。o は KEYS の順の計算量 */
function seqOps(m: Seq, o: readonly string[], amortBack = false): Op[] {
  return [
    { key: 'front+', label: '先頭に追加', o: o[0], add: true, run: (s) => m.ins(s, 0, s.take()) },
    {
      key: 'back+',
      label: '末尾に追加',
      o: o[1],
      add: true,
      amort: amortBack,
      run: (s) => m.ins(s, s.items.length, s.take()),
    },
    { key: 'front-', label: '先頭を削除', o: o[2], add: false, run: (s) => m.del(s, 0) },
    { key: 'back-', label: '末尾を削除', o: o[3], add: false, run: (s) => m.del(s, s.items.length - 1) },
    { key: 'mid+', label: '途中に追加', o: o[4], add: true, run: (s) => m.ins(s, midOf(s), s.take()) },
    { key: 'mid-', label: '途中を削除', o: o[5], add: false, run: (s) => m.del(s, midOf(s)) },
    { key: 'get', label: 'n 番目の読み取り', o: o[6], add: false, run: (s) => m.get(s, midOf(s)) },
    { key: 'find', label: '値の探索', o: o[7], add: false, run: (s) => m.find(s, s.items.length - 1) },
  ];
}
function seqFlow(m: Seq): Def['flow'] {
  return {
    in(s) {
      const id = s.take(),
        len = s.items.length,
        ru = s.rule.in;
      let i = 0;
      if (ru === 'right') i = len;
      else if (ru === 'rand') i = Math.floor(s.rr() * (len + 1));
      else if (ru === 'sort') {
        i = s.items.findIndex((x) => s.vals[x as number] > s.vals[id]);
        if (i < 0) i = len;
        /* 配列も入れる場所を前から探す（リストはたどる回数に含まれる） */
        if (m === ARR && i > 0) m.find(s, i - 1);
      }
      m.ins(s, i, id);
    },
    out(s) {
      if (s.items.length) m.del(s, s.rule.out === 'right' ? s.items.length - 1 : 0);
    },
  };
}

const addTo =
  (left: boolean) =>
  (s: Sim): void => {
    const id = s.take();
    if (left) s.items.unshift(id);
    else s.items.push(id);
    s.holding = null;
    s.writes++;
    s.emit({ w: [id] });
  };
const takeFrom =
  (left: boolean) =>
  (s: Sim): void => {
    const id = (left ? s.items.shift() : s.items.pop()) as number;
    s.reads++;
    s.toOut(id);
    s.emit({ r: [id] });
  };
const readEnd = (s: Sim): void => {
  s.reads++;
  s.emit({ r: [at(s, s.items.length - 1)] });
};
const flowOf = (ops: Op[]): Def['flow'] => ({
  in: (s) => ops[0].run(s),
  out: (s) => {
    if (s.items.length) ops[1].run(s);
  },
});

const O1 = 'O(1)',
  ON = 'O(n)',
  AM = '償却 O(1)';
const STACK: Op[] = [
  { key: 'back+', label: 'push', o: O1, add: true, run: addTo(false) },
  { key: 'back-', label: 'pop', o: O1, add: false, run: takeFrom(false) },
  { key: 'get', label: '最上段の読み取り', o: O1, add: false, run: readEnd },
];
/* キューのバーは左が新しく、右が先頭 */
const QUEUE: Op[] = [
  { key: 'back+', label: 'enqueue', o: O1, add: true, run: addTo(true) },
  { key: 'front-', label: 'dequeue', o: O1, add: false, run: takeFrom(false) },
  { key: 'get', label: '先頭の読み取り', o: O1, add: false, run: readEnd },
];
const RING: Op[] = [
  { key: 'back+', label: '末尾に追加', o: O1, add: true, run: addTo(false) },
  {
    key: 'front-',
    label: '先頭を削除',
    o: O1,
    add: false,
    run: (s) => {
      const id = s.items.shift() as number;
      s.hd = (s.hd + 1) % s.cap;
      s.reads++;
      s.toOut(id);
      s.emit({ r: [id] });
    },
  },
  {
    key: 'front+',
    label: '先頭に追加',
    o: O1,
    add: true,
    run: (s) => {
      const id = s.take();
      s.hd = (s.hd - 1 + s.cap) % s.cap;
      s.items.unshift(id);
      s.holding = null;
      s.writes++;
      s.emit({ w: [id] });
    },
  },
  {
    key: 'get',
    label: 'n 番目の読み取り',
    o: O1,
    add: false,
    run: (s) => {
      s.reads++;
      s.emit({ r: [at(s, midOf(s))] });
    },
  },
];

export const DEFS: readonly Def[] = [
  {
    id: 'stack',
    name: 'スタック',
    shape: 'pile',
    order: '後入れ先出し（LIFO）',
    ex: '操作の取り消し（Undo）・関数呼び出し・括弧の対応チェック',
    mem: '値のみ',
    ops: STACK,
    flow: flowOf(STACK),
  },
  {
    id: 'queue',
    name: 'キュー',
    shape: 'tube',
    order: '先入れ先出し（FIFO）',
    ex: '印刷キュー・幅優先探索・通信バッファ',
    mem: '値のみ',
    ops: QUEUE,
    flow: flowOf(QUEUE),
  },
  {
    id: 'deque',
    name: '両端キュー',
    shape: 'tube2',
    order: '両端から選択',
    ex: 'ワークスティーリング・スライディングウィンドウ',
    mem: '値のみ',
    rule: { in: 'left', out: 'right' },
    noIn: ['sort'],
    ops: [
      { key: 'front+', label: '左に追加', o: O1, add: true, run: addTo(true) },
      { key: 'back+', label: '右に追加', o: O1, add: true, run: addTo(false) },
      { key: 'front-', label: '左から取り出し', o: O1, add: false, run: takeFrom(true) },
      { key: 'back-', label: '右から取り出し', o: O1, add: false, run: takeFrom(false) },
    ],
    flow: {
      in(s) {
        const right = s.rule.in === 'right' || (s.rule.in === 'rand' && s.rr() < 0.5);
        addTo(!right)(s);
      },
      out(s) {
        if (s.items.length) takeFrom(s.rule.out === 'left')(s);
      },
    },
  },
  {
    id: 'array',
    name: '配列',
    shape: 'slots',
    order: '位置を選択',
    ex: '表・画像・音声のデータ',
    mem: '値のみ（予備領域あり）',
    rule: { in: 'sort', out: 'left' },
    ops: seqOps(ARR, [ON, AM, ON, O1, ON, ON, O1, ON], true),
    flow: seqFlow(ARR),
  },
  {
    id: 'sll',
    name: '片方向リスト',
    shape: 'chain',
    order: '位置を選択',
    ex: 'ハッシュ表のチェイン法・空き領域の管理',
    mem: '値＋ポインタ 1 個',
    rule: { in: 'sort', out: 'left' },
    ops: seqOps(SLL, [O1, O1, O1, ON, ON, ON, ON, ON]),
    flow: seqFlow(SLL),
  },
  {
    id: 'dll',
    name: '双方向リスト',
    shape: 'chain2',
    order: '位置を選択',
    ex: 'LRU キャッシュ・テキストエディタ',
    mem: '値＋ポインタ 2 個',
    rule: { in: 'sort', out: 'left' },
    ops: seqOps(DLL, [O1, O1, O1, O1, ON, ON, ON, ON]),
    flow: seqFlow(DLL),
  },
  {
    id: 'ring',
    name: 'リングバッファ',
    shape: 'ring',
    order: '先入れ先出し（FIFO）',
    ex: '音声の入出力・シリアル通信・ログの保持',
    mem: '値のみ（容量は固定）',
    ops: RING,
    flow: flowOf(RING),
  },
];
export const defOf = (id: string): Def | undefined => DEFS.find((d) => d.id === id);
/** 一覧の表の操作の列 */
export const KEYS: readonly (readonly [OpKey, string])[] = [
  ['front+', '先頭に追加'],
  ['back+', '末尾に追加'],
  ['front-', '先頭を削除'],
  ['back-', '末尾を削除'],
  ['mid+', '途中に追加'],
  ['mid-', '途中を削除'],
  ['get', 'n 番目の読み取り'],
  ['find', '値の探索'],
];

/* ---------- バーの並び ---------- */
export const SHAPES = [
  ['ramp', '右上がり'],
  ['down', '右下がり'],
  ['saw', 'のこぎり'],
  ['rand', 'ランダム'],
] as const;
export type BarShape = (typeof SHAPES)[number][0];

/** 表示の位置 x（0〜1）のバーの高さ（0〜1）。ランダムは r で決める */
export function shapeAt(k: BarShape, x: number, r: () => number): number {
  if (k === 'ramp') return 0.08 + x * 0.92;
  if (k === 'down') return 1 - x * 0.92;
  if (k === 'saw') return 0.1 + ((x * 3) % 1) * 0.9;
  return 0.1 + r() * 0.9;
}

/**
 * バーの値。id の小さいバーから順に入る。入力のバーは右端から順に入るので、
 * id 0 を右端に置く。表示の形がそのまま「バーの並び」になる
 */
export function barVals(k: BarShape, n: number, seed: number): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, id) => {
    const x = n > 1 ? (n - 1 - id) / (n - 1) : 0;
    return Math.max(1, Math.round(shapeAt(k, x, r) * VM));
  });
}

/** まとめて・交互の操作の列 */
export function baseTokens(pat: 'bulk' | 'mix', n: number, seed: number): Token[] {
  const t: Token[] = [];
  if (pat === 'bulk') {
    for (let i = 0; i < n; i++) t.push('in');
    for (let i = 0; i < n; i++) t.push('out');
    return t;
  }
  const r = rng(seed + 9);
  let left = n,
    inside = 0;
  while (left > 0 || inside > 0) {
    if (left > 0 && (inside === 0 || r() < 0.62)) {
      t.push('in');
      left--;
      inside++;
    } else {
      t.push('out');
      inside--;
    }
  }
  return t;
}

/* ---------- 実行 ---------- */
/**
 * 取り出した順 r のバーの出力での位置（0 が右端）。出力に並ぶのは要素数 n までで、
 * それより多く取り出すと古いバーから右端の外へ流れる。外へ出たバーは負の値
 */
export const outSlot = (r: number, outN: number, n: number): number => r - Math.max(0, outN - n);

export interface Trace {
  def: Def;
  frames: Frame[];
  /** 出たバーの順 */
  outs: number[];
  /** バーの値。新しく作ったバーを含む */
  vals: number[];
  /** 入れ物に入るバーの上限 */
  cap: number;
  /** 配列の大きさの最大（図の場所の数） */
  slots: number;
}

function prefill(s: Sim, d: Def, k: number): void {
  for (let i = 0; i < k; i++) {
    const id = s.next++;
    s.prefilled(id);
    if (d.shape === 'tube') s.items.unshift(id);
    else s.items.push(id);
  }
  s.size = nextPow2(k + 1);
}

/** 満杯・空のときなど、実行できる操作か */
export const canRun = (op: Op, len: number, cap: number): boolean => (op.add ? len < cap : len > 0);

export interface RunOpt {
  n: number;
  vals: readonly number[];
  tokens: readonly Token[];
  /** 始める前に入れておくバーの数 */
  pre?: number;
  rule?: Rule;
  seed?: number;
}

export function runTrace(d: Def, o: RunOpt): Trace {
  const s = new Sim(o.n, o.vals, o.rule ?? d.rule ?? { in: 'right', out: 'left' }, o.seed ?? 1);
  prefill(s, d, o.pre ?? 0);
  s.emit();
  o.tokens.forEach((t, i) => {
    s.tok = i + 1;
    s.ops++;
    const from = s.frames.length;
    if (t === 'in') {
      s.say = '追加';
      if (s.next < s.n) d.flow.in(s);
    } else if (t === 'out') {
      s.say = '取り出し';
      d.flow.out(s);
    } else {
      const op = d.ops.find((x) => x.key === t);
      if (op && canRun(op, s.len, s.cap)) {
        s.say = op.label;
        op.run(s);
      }
    }
    /* 何も起きなくても手順を 1 つ進め、比較の行をそろえる */
    if (s.frames.length === from) s.emit();
  });
  return { def: d, frames: s.frames, outs: s.outs, vals: s.vals, cap: s.cap, slots: nextPow2(o.n + 4) };
}

/* ---------- 計算量の確かめ ---------- */
/** 回数の線のバーの数 */
export const SIZES: readonly number[] = [4, 8, 16, 32, 64];

/** 操作 1 回の読み書きの回数を、バーの数ごとに数える。amort の操作は n 回の平均 */
export function opCurve(d: Def, op: Op, sizes: readonly number[] = SIZES): number[] {
  return sizes.map((k) => {
    const vals = Array.from({ length: k + 8 }, (_, i) => i + 1),
      s = new Sim(k + 2, vals, d.rule ?? { in: 'right', out: 'left' }, 1);
    if (op.amort) {
      for (let i = 0; i < k; i++) op.run(s);
      return (s.reads + s.writes) / k;
    }
    prefill(s, d, k);
    op.run(s);
    return s.reads + s.writes;
  });
}

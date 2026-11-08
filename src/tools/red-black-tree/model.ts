/**
 * 赤黒木のページの模型。操作の列を実行して、1 手ごとのコマを記録する。図と音は記録を再生する。
 * 比較はキーを比べた数、回転は回転の数、色の変更は色が変わったノードの数である。回数は工程ごとに 0 から数える。
 * 木は親へのポインタを持つノードをその場で書き換え、コマには木の写しを残す
 */
import { type BarShape, rng } from '../list-queue-stack/model';

export type Kind = 'rb' | 'llrb' | 'aa' | 'avl' | 'bst';
/** 工程の番号: 追加・検索・削除 */
export type Stage = 0 | 1 | 2;
export type OpKey = 'add' | 'find' | 'del';

export interface Def {
  id: string;
  name: string;
  kind: Kind;
  /** 赤黒木の仲間（色で形を保つ） */
  fam: boolean;
  ex: string;
}
export const DEFS: readonly Def[] = [
  {
    id: 'rb',
    name: '赤黒木',
    kind: 'rb',
    fam: true,
    ex: 'Linux の rbtree・Java の TreeMap・C++ の std::map の主な実装',
  },
  { id: 'llrb', name: '左傾赤黒木', kind: 'llrb', fam: true, ex: '実装を短くしたいとき' },
  { id: 'aa', name: 'AA木', kind: 'aa', fam: true, ex: '実装を短くしたいとき' },
  { id: 'avl', name: 'AVL木', kind: 'avl', fam: false, ex: '検索が多いとき' },
  { id: 'bst', name: '二分探索木（参考）', kind: 'bst', fam: false, ex: '要素が少なく、順番がばらばらのとき' },
];
export const defOf = (id: string): Def | undefined => DEFS.find((d) => d.id === id);

export const STAGES: readonly (readonly [OpKey, string, string])[] = [
  ['add', '追加', '全部を木に入れる'],
  ['find', '検索', '根から下る'],
  ['del', '削除', '半分を消す'],
];

/** 直し方の規則。[記号, 条件, 直し方] */
export type Rule = readonly [string, string, string];
export const RULES: Record<Kind, readonly Rule[]> = {
  rb: [
    ['i1', 'おじが赤', '色の変更'],
    ['i2', 'おじが黒・内側', '親で回転'],
    ['i3', 'おじが黒・外側', '祖父で回転'],
    ['d1', '兄弟が赤', '親で回転'],
    ['d2', '兄弟の子が両方黒', '兄弟を赤に'],
    ['d3', '兄弟の遠い子が黒', '兄弟で回転'],
    ['d4', '兄弟の遠い子が赤', '親で回転'],
  ],
  llrb: [
    ['l1', '右だけが赤', '左回転'],
    ['l2', '左と左の左が赤', '右回転'],
    ['l3', '左右が赤', '色の反転'],
    ['l4', '左へ赤を借りる', '色の反転と回転'],
    ['l5', '右へ赤を借りる', '色の反転と回転'],
  ],
  aa: [
    ['a1', '左が同じ段', '右回転'],
    ['a2', '右の右が同じ段', '左回転と段の繰り上げ'],
    ['a3', '子が 2 段下', '段の繰り下げ'],
  ],
  avl: [
    ['v1', '高さの差 2・外側', '1 回の回転'],
    ['v2', '高さの差 2・内側', '2 回の回転'],
  ],
  bst: [],
};

/** 計算量。h は高さの上限、rot は 1 回の追加・削除の回転の数 */
export interface BigO {
  add: string;
  find: string;
  del: string;
  h: string;
  rot: string;
}
const LOG = 'O(log n)';
export const BIG_O: Record<string, BigO> = {
  rb: { add: LOG, find: LOG, del: LOG, h: '2 log<sub>2</sub>(n+1)', rot: '2・3' },
  llrb: { add: LOG, find: LOG, del: LOG, h: '2 log<sub>2</sub>(n+1)', rot: LOG },
  aa: { add: LOG, find: LOG, del: LOG, h: '2 log<sub>2</sub>(n+1)', rot: LOG },
  avl: { add: LOG, find: LOG, del: LOG, h: '1.44 log<sub>2</sub>(n+2)', rot: `2・${LOG}` },
  bst: { add: 'O(n)', find: 'O(n)', del: 'O(n)', h: 'n', rot: '0' },
};
/** 高さの上限の値 */
export function boundOf(k: Kind, n: number): number {
  if (k === 'bst') return n;
  if (k === 'avl') return 1.44 * Math.log2(n + 2);
  return 2 * Math.log2(n + 1);
}
const HOW: Record<Kind, Record<OpKey, string>> = {
  rb: {
    add: '葉に赤でつなぎ、赤が続けば色の変更か回転',
    find: '根から下る',
    del: '消して、黒が足りなければ回転と色の変更',
  },
  llrb: { add: '葉に赤でつなぎ、戻りながら 3 つの規則', find: '根から下る', del: '下りながら赤を借り、戻りながら直す' },
  aa: { add: '葉につなぎ、戻りながら右回転と左回転', find: '根から下る', del: '消して、戻りながら段を下げる' },
  avl: { add: '葉につなぎ、高さの差が 2 なら回転', find: '根から下る', del: '消して、高さの差が 2 なら回転' },
  bst: { add: '根から下り、空いた枝につなぐ', find: '根から下る', del: '消して、右の最小を上げる' },
};
export const howOf = (d: Def, k: OpKey): string => HOW[d.kind][k];

/* ---------- キーと操作 ---------- */
/** キーの最大値 */
export const vmOf = (n: number): number => (n <= 63 ? 99 : 999);
/** 重複しないキーを作り、形のとおりに並べる（B木と同じ） */
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

export interface Op {
  t: OpKey;
  k: number;
}
export type StageOps = readonly [Op[], Op[], Op[]];
/** 3 工程の操作の列。検索はある 4 個とない 1 個、削除は半分 */
export function makeOps(keys: readonly number[], seed: number): StageOps {
  const r = rng(seed * 104729 + 3),
    n = keys.length,
    sorted = [...keys].sort((a, b) => a - b),
    mix = [...keys];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [mix[i], mix[j]] = [mix[j], mix[i]];
  }
  let miss = sorted[n >> 1] + 1;
  while (keys.includes(miss)) miss++;
  const find: Op[] = [...mix.slice(0, 4).map((k): Op => ({ t: 'find', k })), { t: 'find', k: miss }];
  mix.reverse();
  return [keys.map((k): Op => ({ t: 'add', k })), find, mix.slice(0, n >> 1).map((k): Op => ({ t: 'del', k }))];
}

/* ---------- コマ ---------- */
/** 色: 0 黒、1 赤、2 色なし（AVL木と二分探索木） */
export type Color = 0 | 1 | 2;
export interface NodeS {
  c: Color;
  l: number | null;
  r: number | null;
  /** AVL木は左右の高さの差、AA木は段 */
  i: number;
}
export interface Counts {
  /** 比較 */
  c: number;
  /** 回転 */
  rot: number;
  /** 色の変更 */
  pt: number;
}
/** 札: 探している・入れるキーと、今いるノード。q は探している札（検索・削除） */
export interface Badge {
  k: number;
  at: number | null;
  q: boolean;
}
export interface Frame {
  N: Readonly<Record<number, NodeS>>;
  root: number | null;
  say: string;
  /** 比べているノード */
  cmp: readonly number[];
  /** 回転や色の変更をしたノード */
  mov: readonly number[];
  /** 赤の連続・黒の不足・高さの差 2 のノード */
  bad: readonly number[];
  /** 見つけたノード */
  got: readonly number[];
  /** 使った規則 */
  rule: string | null;
  cur: Badge | null;
  cnt: Counts;
  /** 工程 */
  s: Stage;
  /** 工程の中の操作の番号（-1 は操作の外） */
  tok: number;
  /** 追加した個数（待機中のキーを出すため） */
  next: number;
}
export interface Trace {
  def: Def;
  frames: Frame[];
  starts: [number, number, number];
  totals: [Counts, Counts, Counts];
  /** 追加の工程で入れるキーの順 */
  keys: readonly number[];
  /** 記録の中の最大の高さ */
  maxH: number;
  vm: number;
}

/* ---------- 木 ---------- */
interface Nd {
  k: number;
  l: Nd | null;
  r: Nd | null;
  p: Nd | null;
  red: boolean;
  /** AA木の段 */
  lv: number;
  /** AVL木の高さ */
  h: number;
}
interface Hl {
  cmp?: number[];
  mov?: number[];
  bad?: number[];
  got?: number[];
  rule?: string;
  cur?: Badge | null;
}
const isRed = (x: Nd | null): boolean => !!x && x.red;
const hOf = (x: Nd | null): number => (x ? x.h : 0);
const lvOf = (x: Nd | null): number => (x ? x.lv : 0);
const upd = (x: Nd): void => {
  x.h = 1 + Math.max(hOf(x.l), hOf(x.r));
};
const minOf = (x: Nd): Nd => {
  let y = x;
  while (y.l) y = y.l;
  return y;
};
const maxOf = (x: Nd): Nd => {
  let y = x;
  while (y.r) y = y.r;
  return y;
};
const flip = (h: Nd): void => {
  h.red = !h.red;
  if (h.l) h.l.red = !h.l.red;
  if (h.r) h.r.red = !h.r.red;
};

class Run {
  root: Nd | null = null;
  frames: Frame[] = [];
  stage: Stage = 0;
  tok = -1;
  next = 0;
  cnt: Counts = { c: 0, rot: 0, pt: 0 };
  private prev = new Map<number, Color>();
  constructor(readonly kind: Kind) {}

  /** AA木は親と同じ段の右の子を赤とみなす */
  colorOf(x: Nd): Color {
    if (this.kind === 'aa') return x.p && x.p.lv === x.lv ? 1 : 0;
    if (this.kind === 'avl' || this.kind === 'bst') return 2;
    return x.red ? 1 : 0;
  }
  snap(say: string, hl: Hl = {}): void {
    const N: Record<number, NodeS> = {},
      now = new Map<number, Color>();
    const walk = (x: Nd | null): void => {
      if (!x) return;
      const c = this.colorOf(x);
      N[x.k] = {
        c,
        l: x.l ? x.l.k : null,
        r: x.r ? x.r.k : null,
        i: this.kind === 'avl' ? hOf(x.l) - hOf(x.r) : this.kind === 'aa' ? x.lv : 0,
      };
      now.set(x.k, c);
      walk(x.l);
      walk(x.r);
    };
    walk(this.root);
    for (const [k, c] of now) {
      const o = this.prev.get(k);
      if (o !== undefined && o !== c && c !== 2) this.cnt.pt++;
    }
    this.prev = now;
    this.frames.push({
      N,
      root: this.root ? this.root.k : null,
      say,
      cmp: hl.cmp ?? [],
      mov: hl.mov ?? [],
      bad: hl.bad ?? [],
      got: hl.got ?? [],
      rule: hl.rule ?? null,
      cur: hl.cur ?? null,
      cnt: { ...this.cnt },
      s: this.stage,
      tok: this.tok,
      next: this.next,
    });
  }
  setChild(p: Nd | null, old: Nd, x: Nd | null): void {
    if (!p) this.root = x;
    else if (p.l === old) p.l = x;
    else p.r = x;
    if (x) x.p = p;
  }
  rotL(x: Nd): Nd {
    const y = x.r as Nd;
    x.r = y.l;
    if (y.l) y.l.p = x;
    this.setChild(x.p, x, y);
    y.l = x;
    x.p = y;
    this.cnt.rot++;
    if (this.kind === 'avl') {
      upd(x);
      upd(y);
    }
    return y;
  }
  rotR(x: Nd): Nd {
    const y = x.l as Nd;
    x.l = y.r;
    if (y.r) y.r.p = x;
    this.setChild(x.p, x, y);
    y.r = x;
    x.p = y;
    this.cnt.rot++;
    if (this.kind === 'avl') {
      upd(x);
      upd(y);
    }
    return y;
  }
  /** 根から下る。見つけたノードか、つなぐ親を返す */
  descend(k: number, t: OpKey): { x: Nd | null; p: Nd | null } {
    let x = this.root,
      p: Nd | null = null;
    const q = t !== 'add';
    while (x) {
      this.cnt.c++;
      if (k === x.k) {
        this.snap(`${k} = ${x.k} → ${t === 'find' ? '発見' : '削除'}`, {
          cmp: [x.k],
          got: t === 'find' ? [x.k] : [],
          cur: { k, at: x.k, q },
        });
        return { x, p: x.p };
      }
      const left = k < x.k;
      this.snap(`${k} ${left ? '<' : '>'} ${x.k} → ${left ? '左' : '右'}`, { cmp: [x.k], cur: { k, at: x.k, q } });
      p = x;
      x = left ? x.l : x.r;
    }
    return { x: null, p };
  }
}

/* ---------- 追加 ---------- */
function add(R: Run, k: number): void {
  const { x, p } = R.descend(k, 'add');
  if (x) return;
  const z: Nd = { k, l: null, r: null, p, red: R.kind === 'rb' || R.kind === 'llrb', lv: 1, h: 1 };
  if (!p) R.root = z;
  else if (k < p.k) p.l = z;
  else p.r = z;
  R.next++;
  const tag = z.red ? '（赤）' : '';
  R.snap(p ? `${k} を ${p.k} の${k < p.k ? '左' : '右'}へ${tag}` : `${k} を根に${tag}`, { mov: [k] });
  if (R.kind === 'rb') rbAddFix(R, z);
  else if (R.kind === 'llrb') llrbAddFix(R, z);
  else if (R.kind === 'aa') aaAddFix(R, z);
  else if (R.kind === 'avl') avlFix(R, z);
}
function blackRoot(R: Run): void {
  if (R.root?.red) {
    R.root.red = false;
    R.snap(`根 ${R.root.k} を黒に`, { mov: [R.root.k] });
  }
}
/** 赤黒木の追加の直し方（Guibas・Sedgewick、Cormen らの形） */
function rbAddFix(R: Run, z0: Nd): void {
  let z = z0;
  while (isRed(z.p)) {
    const p = z.p as Nd,
      g = p.p as Nd,
      left = p === g.l,
      u = left ? g.r : g.l;
    R.snap(`${z.k} と親 ${p.k} が赤`, { bad: [z.k, p.k] });
    if (u && isRed(u)) {
      p.red = false;
      u.red = false;
      g.red = true;
      R.snap(`おじ ${u.k} も赤 → 色の変更`, { mov: [p.k, u.k, g.k], rule: 'i1' });
      z = g;
      continue;
    }
    const uk = u ? String(u.k) : 'NIL';
    if (left ? z === p.r : z === p.l) {
      if (left) R.rotL(p);
      else R.rotR(p);
      R.snap(`おじ ${uk} が黒・内側 → ${p.k} で回転`, { mov: [z.k, p.k], rule: 'i2' });
      z = p;
    }
    const q = z.p as Nd;
    q.red = false;
    g.red = true;
    if (left) R.rotR(g);
    else R.rotL(g);
    R.snap(`おじ ${uk} が黒・外側 → ${g.k} で回転`, { mov: [q.k, g.k], rule: 'i3' });
    break;
  }
  blackRoot(R);
}
/* 左傾赤黒木（Sedgewick 2008）。回転で色も入れ替える */
function llRotL(R: Run, h: Nd): Nd {
  const x = R.rotL(h);
  x.red = h.red;
  h.red = true;
  return x;
}
function llRotR(R: Run, h: Nd): Nd {
  const x = R.rotR(h);
  x.red = h.red;
  h.red = true;
  return x;
}
/** 3 つの規則を下から順に当てる */
function llrbBalance(R: Run, h0: Nd): Nd {
  let h = h0;
  if (isRed(h.r) && !isRed(h.l)) {
    const a = h.k;
    h = llRotL(R, h);
    R.snap(`${a} の右だけが赤 → 左回転`, { mov: [h.k, a], rule: 'l1' });
  }
  if (isRed(h.l) && isRed((h.l as Nd).l)) {
    const a = h.k,
      l = h.l as Nd;
    R.snap(`${l.k} と ${(l.l as Nd).k} が赤`, { bad: [l.k, (l.l as Nd).k] });
    h = llRotR(R, h);
    R.snap(`左と左の左が赤 → ${a} で右回転`, { mov: [h.k, a], rule: 'l2' });
  }
  if (isRed(h.l) && isRed(h.r)) {
    flip(h);
    R.snap(`${h.k} の左右が赤 → 色の反転`, { mov: [h.k, (h.l as Nd).k, (h.r as Nd).k], rule: 'l3' });
  }
  return h;
}
function llrbAddFix(R: Run, z: Nd): void {
  for (let h = z.p; h; h = llrbBalance(R, h).p);
  blackRoot(R);
}
/* AA木（Andersson 1993） */
function skew(R: Run, t: Nd | null): Nd | null {
  if (t?.l && t.l.lv === t.lv) {
    const a = t.k,
      x = R.rotR(t);
    R.snap(`${a} の左が同じ段 → 右回転`, { mov: [x.k, a], rule: 'a1' });
    return x;
  }
  return t;
}
function split(R: Run, t: Nd | null): Nd | null {
  if (t?.r?.r && t.r.r.lv === t.lv) {
    const a = t.k,
      x = R.rotL(t);
    x.lv++;
    R.snap(`${a} の右の右が同じ段 → 左回転し ${x.k} を 1 段上へ`, { mov: [x.k, a], rule: 'a2' });
    return x;
  }
  return t;
}
function aaAddFix(R: Run, z: Nd): void {
  for (let h = z.p; h; ) {
    h = skew(R, h) as Nd;
    h = split(R, h) as Nd;
    h = h.p;
  }
}
/* AVL木（Adelson-Velsky・Landis 1962）。下から高さを直し、差が 2 なら回転 */
function avlFix(R: Run, z: Nd): void {
  for (let x: Nd | null = z; x; x = x.p) {
    upd(x);
    const b: number = hOf(x.l) - hOf(x.r);
    if (b < 2 && b > -2) continue;
    const a = x.k,
      L: boolean = b > 1,
      c = (L ? x.l : x.r) as Nd,
      cb = hOf(c.l) - hOf(c.r),
      inner = L ? cb < 0 : cb > 0;
    R.snap(`${a} の左右の高さの差が 2`, { bad: [a] });
    if (inner) {
      if (L) R.rotL(c);
      else R.rotR(c);
    }
    x = L ? R.rotR(x) : R.rotL(x);
    R.snap(inner ? '内側 → 2 回の回転' : `外側 → ${a} で回転`, { mov: [x.k, a], rule: inner ? 'v2' : 'v1' });
  }
}

/* ---------- 削除 ---------- */
const findIn = (q: Nd | null, k: number): Nd | null => {
  let x = q;
  while (x && x.k !== k) x = k < x.k ? x.l : x.r;
  return x;
};
function del(R: Run, k: number): void {
  if (R.kind === 'llrb') {
    llrbDel(R, k);
    return;
  }
  const { x: z } = R.descend(k, 'del');
  if (!z) {
    R.snap(`${k} はない`, {});
    return;
  }
  if (R.kind === 'rb') rbDel(R, z);
  else if (R.kind === 'aa') aaDel(R, z);
  else bstDel(R, z);
}
/** 二分探索木と AVL木。子が 2 つなら右の最小を上げる */
function bstDel(R: Run, z: Nd): void {
  let from: Nd | null;
  if (!z.l || !z.r) {
    from = z.p;
    R.setChild(z.p, z, z.l ?? z.r);
    R.snap(`${z.k} を削除`, {});
  } else {
    const y = minOf(z.r);
    from = y.p === z ? y : y.p;
    if (y.p !== z) {
      R.setChild(y.p, y, y.r);
      y.r = z.r;
      y.r.p = y;
    }
    R.setChild(z.p, z, y);
    y.l = z.l;
    y.l.p = y;
    y.h = z.h;
    R.snap(`${z.k} を削除 → 右の最小 ${y.k} を上へ`, { mov: [y.k] });
  }
  if (R.kind === 'avl' && from) avlFix(R, from);
}
/** 赤黒木の削除（Cormen らの形）。x は黒が 1 つ足りない位置、xp はその親 */
function rbDel(R: Run, z: Nd): void {
  let yRed = z.red,
    x: Nd | null,
    xp: Nd | null;
  if (!z.l || !z.r) {
    x = z.l ?? z.r;
    xp = z.p;
    R.setChild(z.p, z, x);
    R.snap(`${z.k} を削除`, {});
  } else {
    const y = minOf(z.r);
    yRed = y.red;
    x = y.r;
    if (y.p === z) xp = y;
    else {
      xp = y.p;
      R.setChild(y.p, y, y.r);
      y.r = z.r;
      y.r.p = y;
    }
    R.setChild(z.p, z, y);
    y.l = z.l;
    y.l.p = y;
    y.red = z.red;
    R.snap(`${z.k} を削除 → 右の最小 ${y.k} を上へ`, { mov: [y.k] });
  }
  if (yRed) return;
  while (x !== R.root && !isRed(x) && xp) {
    const p: Nd = xp,
      left = x === p.l,
      side = left ? '左' : '右';
    let w = (left ? p.r : p.l) as Nd;
    R.snap(`${p.k} の${side}の黒が 1 つ不足`, { bad: [p.k] });
    if (isRed(w)) {
      w.red = false;
      p.red = true;
      if (left) R.rotL(p);
      else R.rotR(p);
      R.snap(`兄弟 ${w.k} が赤 → ${p.k} で回転`, { mov: [w.k, p.k], rule: 'd1' });
      w = (left ? p.r : p.l) as Nd;
    }
    const near = left ? w.l : w.r,
      far = left ? w.r : w.l;
    if (!isRed(near) && !isRed(far)) {
      w.red = true;
      R.snap(`兄弟 ${w.k} の子が両方黒 → ${w.k} を赤に`, { mov: [w.k], rule: 'd2' });
      x = p;
      xp = p.p;
      continue;
    }
    if (!isRed(far)) {
      const nr = near as Nd;
      nr.red = false;
      w.red = true;
      if (left) R.rotR(w);
      else R.rotL(w);
      R.snap(`兄弟の遠い子が黒 → ${w.k} で回転`, { mov: [nr.k, w.k], rule: 'd3' });
      w = (left ? p.r : p.l) as Nd;
    }
    const f = (left ? w.r : w.l) as Nd;
    w.red = p.red;
    p.red = false;
    f.red = false;
    if (left) R.rotL(p);
    else R.rotR(p);
    R.snap(`兄弟の遠い子が赤 → ${p.k} で回転`, { mov: [w.k, p.k, f.k], rule: 'd4' });
    x = R.root;
    break;
  }
  if (x?.red) {
    x.red = false;
    R.snap(`${x.k} を黒に`, { mov: [x.k] });
  }
}
/** AA木の削除。葉になるまで隣のキーを上へずらして葉を消し、戻りながら直す */
function aaDel(R: Run, z: Nd): void {
  const chain = [z],
    gone = z.k;
  for (let n = z; n.l || n.r; ) {
    n = n.l ? maxOf(n.l) : minOf(n.r as Nd);
    chain.push(n);
  }
  const leaf = chain[chain.length - 1],
    from = leaf.p,
    up = chain.slice(1).map((n) => n.k);
  for (let i = 0; i < chain.length - 1; i++) chain[i].k = chain[i + 1].k;
  R.setChild(leaf.p, leaf, null);
  R.snap(up.length ? `${gone} を削除 → ${up.join('・')} を上へ` : `${gone} を削除`, { mov: up });
  for (let h = from; h; ) {
    const want = Math.min(lvOf(h.l), lvOf(h.r)) + 1;
    if (want < h.lv) {
      h.lv = want;
      if (h.r && want < h.r.lv) h.r.lv = want;
      R.snap(`${h.k} の子が 2 段下 → 1 段下へ`, { mov: [h.k], rule: 'a3' });
    }
    h = skew(R, h) as Nd;
    if (h.r) skew(R, h.r);
    if (h.r?.r) skew(R, h.r.r);
    h = split(R, h) as Nd;
    if (h.r) split(R, h.r);
    h = h.p;
  }
}
/* 左傾赤黒木の削除（Sedgewick 2008）。下りながら赤を借り、戻りながら直す */
function moveRedLeft(R: Run, h0: Nd): Nd {
  let h = h0;
  flip(h);
  R.snap(`${h.k} の左へ赤を借りる → 色の反転`, { mov: [h.k, (h.l as Nd).k, (h.r as Nd).k], rule: 'l4' });
  if (isRed((h.r as Nd).l)) {
    llRotR(R, h.r as Nd);
    h = llRotL(R, h);
    flip(h);
    R.snap('右の左が赤 → 2 回の回転と色の反転', { mov: [h.k], rule: 'l4' });
  }
  return h;
}
function moveRedRight(R: Run, h0: Nd): Nd {
  let h = h0;
  flip(h);
  R.snap(`${h.k} の右へ赤を借りる → 色の反転`, { mov: [h.k, (h.l as Nd).k, (h.r as Nd).k], rule: 'l5' });
  if (isRed((h.l as Nd).l)) {
    h = llRotR(R, h);
    flip(h);
    R.snap('左の左が赤 → 右回転と色の反転', { mov: [h.k], rule: 'l5' });
  }
  return h;
}
function llrbDel(R: Run, k: number): void {
  if (!R.root || !findIn(R.root, k)) {
    R.descend(k, 'del');
    R.snap(`${k} はない`, {});
    return;
  }
  const root = R.root;
  if (!isRed(root.l) && !isRed(root.r)) {
    root.red = true;
    R.snap(`根 ${root.k} を赤に`, { mov: [root.k] });
  }
  const cur = (at: number): Badge => ({ k, at, q: true });
  let h = R.root as Nd,
    from: Nd | null = null;
  for (;;) {
    R.cnt.c++;
    if (k < h.k) {
      R.snap(`${k} < ${h.k} → 左`, { cmp: [h.k], cur: cur(h.k) });
      if (!isRed(h.l) && !isRed((h.l as Nd).l)) h = moveRedLeft(R, h);
      h = h.l as Nd;
      continue;
    }
    if (isRed(h.l)) {
      const a = h.k;
      h = llRotR(R, h);
      R.snap(`左が赤 → ${a} で右回転`, { mov: [h.k, a] });
      h = h.r as Nd;
      R.cnt.c--;
      continue;
    }
    if (k === h.k && !h.r) {
      from = h.p;
      R.setChild(h.p, h, null);
      R.snap(`${k} = ${h.k} → 削除`, {});
      break;
    }
    if (!isRed(h.r) && !isRed((h.r as Nd).l)) h = moveRedRight(R, h);
    if (k === h.k) {
      R.snap(`${k} = ${h.k} → 削除`, { cmp: [h.k], cur: cur(h.k) });
      /* 右の最小を上げ、右の部分木から最小を消す */
      const top = h;
      let m = h.r as Nd;
      for (;;) {
        if (!m.l) {
          from = m.p;
          R.setChild(m.p, m, null);
          top.k = m.k;
          R.snap(`右の最小 ${m.k} を上へ`, { mov: [top.k] });
          break;
        }
        if (!isRed(m.l) && !isRed(m.l.l)) m = moveRedLeft(R, m);
        m = m.l as Nd;
      }
      break;
    }
    R.snap(`${k} > ${h.k} → 右`, { cmp: [h.k], cur: cur(h.k) });
    h = h.r as Nd;
  }
  for (let q = from; q; q = llrbBalance(R, q).p);
  blackRoot(R);
}
function find(R: Run, k: number): void {
  const { x } = R.descend(k, 'find');
  if (!x) R.snap(`${k} はない`, {});
}

/* ---------- 実行 ---------- */
/** 操作の列を実行して記録する */
export function runTrace(def: Def, ops: StageOps): Trace {
  const R = new Run(def.kind),
    starts: number[] = [],
    totals: Counts[] = [];
  for (let s = 0; s < 3; s++) {
    R.stage = s as Stage;
    R.cnt = { c: 0, rot: 0, pt: 0 };
    R.tok = -1;
    starts.push(R.frames.length);
    R.snap('', {});
    ops[s].forEach((o, i) => {
      R.tok = i;
      if (o.t === 'add') add(R, o.k);
      else if (o.t === 'find') find(R, o.k);
      else del(R, o.k);
    });
    R.tok = -1;
    if (ops[s].length) R.snap('', {});
    totals.push({ ...R.cnt });
  }
  const t: Trace = {
    def,
    frames: R.frames,
    starts: starts as [number, number, number],
    totals: totals as [Counts, Counts, Counts],
    keys: ops[0].map((o) => o.k),
    maxH: 1,
    vm: vmOf(ops[0].length),
  };
  for (const f of t.frames) t.maxH = Math.max(t.maxH, inspect(f).h);
  return t;
}

export interface Shape {
  n: number;
  /** 高さ（段の数） */
  h: number;
  /** 黒の高さ（根から NIL までの黒の数） */
  bh: number;
  /** どの道も黒の数が同じか */
  even: boolean;
  /** キーごとの深さ（根が 0） */
  depth: Readonly<Record<number, number>>;
  /** 中順のキー */
  order: number[];
  /** キーごとの親 */
  parent: Readonly<Record<number, number>>;
}
/** コマの木の形を調べる */
export function inspect(f: Pick<Frame, 'N' | 'root'>): Shape {
  const depth: Record<number, number> = {},
    parent: Record<number, number> = {},
    order: number[] = [];
  let h = 0,
    bh = -1,
    even = true;
  const walk = (k: number | null, d: number, b: number, p: number | null): void => {
    if (k === null) {
      if (bh < 0) bh = b;
      else if (bh !== b) even = false;
      return;
    }
    const n = f.N[k],
      nb = b + (n.c === 0 ? 1 : 0);
    depth[k] = d;
    if (p !== null) parent[k] = p;
    h = Math.max(h, d + 1);
    walk(n.l, d + 1, nb, k);
    order.push(k);
    walk(n.r, d + 1, nb, k);
  };
  if (f.root !== null) walk(f.root, 0, 0, null);
  return { n: order.length, h, bh: f.root === null ? 0 : bh + 1, even, depth, order, parent };
}

/** 1 回の操作の平均（キー 31 個で 8 通り）。工程ごとの比較と回転、全部を入れたあとの高さ */
export type Avg = Record<OpKey, { c: number; rot: number }> & { h: number };
export function average(d: Def, n = 31, tries = 8): Avg {
  const a: Avg = { add: { c: 0, rot: 0 }, find: { c: 0, rot: 0 }, del: { c: 0, rot: 0 }, h: 0 };
  for (let s = 1; s <= tries; s++) {
    const ops = makeOps(makeKeys('rand', n, s), s),
      t = runTrace(d, ops);
    STAGES.forEach(([k], i) => {
      a[k].c += t.totals[i].c / ops[i].length / tries;
      a[k].rot += t.totals[i].rot / ops[i].length / tries;
    });
    a.h += inspect(t.frames[t.starts[1]]).h / tries;
  }
  return a;
}

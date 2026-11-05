/**
 * 式の構文解析のページの模型。字句解析・構文解析・計算を 1 手ずつ記録する。図と音は記録を再生する。
 * 手法が違っても、同じ決まりなら同じ木になる
 */

/** 二項演算子と符号。· は省略した × */
export type Op = '+' | '-' | '*' | '/' | '^' | '·' | 'neg';
const BIN_OPS: readonly Op[] = ['+', '-', '*', '/', '^', '·'];

export const SYM: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', '·': '×', neg: '−' };

export const SAMPLES: readonly (readonly [string, string])[] = [
  ['2 + 3 * (4 - 1) ^ 2', '括弧とべき乗'],
  ['1 + 2 * 3', '和と積'],
  ['(1 + 2) * 3', '括弧'],
  ['8 - 3 - 2', '左結合'],
  ['2 ^ 3 ^ 2', '右結合'],
  ['-2 ^ 2', '符号とべき乗'],
  ['6 / 2(1 + 2)', '省略した ×'],
  ['((((1 + 2))))', '深い括弧'],
  ['1 + * 2', 'エラー: 数の不足'],
  ['2 * (3 + 4', 'エラー: 閉じ括弧の不足'],
];

/** 順位の決まり。rank は先に計算するものから順に並べる */
export interface RuleDef {
  id: string;
  name: string;
  rank: Op[][];
  /** 右結合の演算子 */
  right: Op[];
  /** 省略した × を書けない */
  noImp?: boolean;
}
export const RULES: readonly RuleDef[] = [
  { id: 'std', name: '数学の慣習', rank: [['^'], ['neg'], ['*', '/', '·'], ['+', '-']], right: ['^', 'neg'] },
  { id: 'imp', name: '省略した × を優先', rank: [['^'], ['neg'], ['·'], ['*', '/'], ['+', '-']], right: ['^', 'neg'] },
  { id: 'xl', name: 'Excel', rank: [['neg'], ['^'], ['*', '/'], ['+', '-']], right: [], noImp: true },
  { id: 'calc', name: '標準の電卓', rank: [['neg'], ['+', '-', '*', '/', '^', '·']], right: [] },
  {
    id: 'apl',
    name: 'APL',
    rank: [['+', '-', '*', '/', '^', '·', 'neg']],
    right: ['+', '-', '*', '/', '^', '·', 'neg'],
  },
  { id: 'add', name: '+ − を先に', rank: [['^'], ['neg'], ['+', '-'], ['*', '/', '·']], right: ['^', 'neg'] },
];

export type MethodId = 'sy' | 'sr' | 'rd' | 'pr' | 'bt' | 'pk';
export interface MethodDef {
  id: MethodId;
  name: string;
  stack: string;
  ex: string;
}
export const METHODS: readonly MethodDef[] = [
  { id: 'sy', name: '操車場', stack: 'スタック', ex: '2 本のスタックで順位を比べる' },
  { id: 'sr', name: 'シフト還元', stack: 'スタック', ex: '数も記号も 1 本に積む' },
  { id: 'rd', name: '再帰下降', stack: '呼び出しのスタック', ex: '順位ごとの処理を順に呼ぶ' },
  { id: 'pr', name: 'Pratt', stack: '呼び出しのスタック', ex: '必要な順位だけ呼ぶ' },
  { id: 'bt', name: 'バックトラック', stack: '呼び出しのスタック', ex: '失敗すると戻って読み直す' },
  { id: 'pk', name: 'パックラット', stack: '呼び出しのスタック', ex: '読んだ結果を覚えて再利用する' },
];
export const ruleOf = (id: string): RuleDef | undefined => RULES.find((r) => r.id === id);
export const methodOf = (id: string): MethodDef | undefined => METHODS.find((m) => m.id === id);

/** 再生のために残すコマの上限 */
export const CAP = 2500;
/** 数える手順の上限（バックトラックは括弧が深いと指数的に増える） */
export const STEP_LIMIT = 300000;
/** 入力できる式の長さ */
export const MAX_LEN = 60;

/* ---------- 字句解析 ---------- */
export type TokKind = 'num' | 'op' | 'neg' | '(' | ')';
export interface Tok {
  t: TokKind;
  txt: string;
  v?: number;
  op?: Op;
  /** 省略した × を補った字句 */
  imp?: boolean;
}
export interface LexFrame {
  /** 読んでいる文字の範囲 */
  ci: number;
  cj: number;
  /** ここまでにできた字句の数 */
  n: number;
  say: string;
  /** 今できた字句 */
  hot: number;
  bad: boolean;
}
export function lexIt(src: string): { s: string; toks: Tok[]; F: LexFrame[]; err: string | null } {
  const s = src.normalize('NFKC').replace(/\*\*/g, '^').replace(/[×✕]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  const toks: Tok[] = [],
    F: LexFrame[] = [];
  let err: string | null = null;
  const snap = (ci: number, cj: number, say: string, hot = -1, bad = false) => {
    F.push({ ci, cj, n: toks.length, say, hot, bad });
  };
  const prevVal = (): boolean => {
    const p = toks[toks.length - 1];
    return !!p && (p.t === 'num' || p.t === ')');
  };
  const add = (t: Tok): number => toks.push(t) - 1;
  const implied = (): number => add({ t: 'op', op: '·', imp: true, txt: '×' });
  snap(-1, -1, '左から 1 文字ずつ読み取り');
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === ' ') {
      snap(i, i, '空白を読み飛ばし');
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j + 1 < s.length && /[0-9.]/.test(s[j + 1])) {
        snap(i, j, `${s.slice(i, j + 1)} → まだ数の途中`);
        j++;
      }
      const txt = s.slice(i, j + 1),
        v = Number(txt);
      if (Number.isNaN(v)) {
        err = `${txt} は読めない数`;
        snap(i, j, `エラー: ${err}`, -1, true);
        break;
      }
      if (toks[toks.length - 1]?.t === ')') snap(i, i, ') の後の × を補う', implied());
      snap(i, j, `${txt} で 1 つの数`, add({ t: 'num', v, txt }));
      i = j + 1;
    } else if ('+-*/^'.includes(c)) {
      if (c === '-' && !prevVal()) snap(i, i, '− は符号', add({ t: 'neg', op: 'neg', txt: '−' }));
      else {
        const op = c as Op;
        snap(i, i, `${SYM[op]} は演算子`, add({ t: 'op', op, txt: SYM[op] }));
      }
      i++;
    } else if (c === '(' || c === ')') {
      if (c === '(' && prevVal()) snap(i, i, '( の前の × を補う', implied());
      snap(i, i, `${c} は括弧`, add({ t: c, txt: c }));
      i++;
    } else {
      err = `${c} は読めない文字`;
      snap(i, i, `エラー: ${err}`, -1, true);
      break;
    }
  }
  if (!err) snap(s.length, s.length, `字句 ${toks.length} 個`);
  return { s, toks, F, err };
}

/* ---------- 規則 ---------- */
interface Level {
  ops: Op[];
  p: number;
  right: boolean;
  name: string;
}
export interface Rule {
  def: RuleDef;
  prec: Record<string, number>;
  right: Record<string, boolean>;
  /** 二項演算子の段（後で計算するものが先頭） */
  levels: Level[];
  /** 符号の後ろで読む順位の下限 */
  negMin: number;
  noImp: boolean;
}
export function compileRule(def: RuleDef): Rule {
  const prec: Record<string, number> = {},
    right: Record<string, boolean> = {},
    rows = def.rank;
  rows.forEach((row, i) => {
    for (const op of row) {
      prec[op] = rows.length - i;
      right[op] = def.right.includes(op);
    }
  });
  const levels = rows
    .map((row, i) => ({ ops: row.filter((o) => o !== 'neg'), p: rows.length - i }))
    .filter((l) => l.ops.length)
    .reverse()
    .map((l) => ({
      ...l,
      right: l.ops.some((o) => right[o]),
      name: [...new Set(l.ops.map((o) => SYM[o]))].join(' '),
    }));
  return { def, prec, right, levels, negMin: prec.neg + (right.neg ? 0 : 1), noImp: !!def.noImp };
}

/* ---------- 記録 ---------- */
export interface Node {
  id: number;
  kind: 'num' | 'bin' | 'neg';
  tok: number;
  kids: number[];
  v?: number;
  op?: Op;
  txt: string;
}
export interface StackItem {
  t: string;
  k: 'op' | 'neg' | 'par' | 'num' | 'E' | 'cl' | 'call';
  tok?: number;
  node?: number;
}
export interface Frame {
  /** 次に読む字句 */
  pos: number;
  /** 組んでいる途中の木の根 */
  roots: number[];
  stk: StackItem[];
  say: string;
  /** 比べている字句 */
  r: number[];
  /** 木に足した字句（計算では計算している字句） */
  w: number[];
  cmp: number;
  back: number;
  maxS: number;
  step: number;
  /** 今足した木の丸 */
  mk?: number;
  /** エラーの字句 */
  bad?: number;
  /** 読む位置を戻した */
  backed?: boolean;
  /** 計算した丸の値（計算の工程） */
  vals?: Map<number, number>;
  /** 計算した丸（計算の工程） */
  hot?: number;
}
class Fail extends Error {}
class Rec {
  nodes: Node[] = [];
  roots: number[] = [];
  stk: StackItem[] = [];
  pos = 0;
  F: Frame[] = [];
  cmp = 0;
  back = 0;
  maxS = 0;
  steps = 0;
  err: string | null = null;
  errTok = -1;
  far = 0;
  trunc = false;
  aborted = false;
  constructor(
    readonly toks: Tok[],
    readonly rule: Rule,
  ) {}
  snap(say: string, r: number[] = [], w: number[] = [], ex: Partial<Frame> = {}): void {
    this.steps++;
    if (this.steps > STEP_LIMIT) {
      this.steps = STEP_LIMIT;
      this.aborted = true;
      throw new Fail('打ち切り');
    }
    this.maxS = Math.max(this.maxS, this.stk.length);
    this.far = Math.max(this.far, this.pos);
    if (this.F.length >= CAP) {
      this.trunc = true;
      return;
    }
    this.F.push(this.frame(say, r, w, ex));
  }
  frame(say: string, r: number[] = [], w: number[] = [], ex: Partial<Frame> = {}): Frame {
    return {
      pos: this.pos,
      roots: this.roots.slice(),
      stk: this.stk.slice(),
      say,
      r,
      w,
      cmp: this.cmp,
      back: this.back,
      maxS: this.maxS,
      step: this.steps,
      ...ex,
    };
  }
  leaf(tok: number): number {
    const id = this.nodes.length,
      t = this.toks[tok];
    this.nodes.push({ id, kind: 'num', tok, kids: [], v: t.v, txt: t.txt });
    this.roots.push(id);
    return id;
  }
  bin(tok: number, l: number, r: number): number {
    const id = this.nodes.length,
      o = this.toks[tok];
    this.nodes.push({ id, kind: 'bin', tok, kids: [l, r], op: o.op, txt: o.txt });
    const i = this.roots.indexOf(l);
    this.roots.splice(this.roots.indexOf(r), 1);
    this.roots[i] = id;
    return id;
  }
  neg(tok: number, k: number): number {
    const id = this.nodes.length;
    this.nodes.push({ id, kind: 'neg', tok, kids: [k], op: 'neg', txt: '−' });
    this.roots[this.roots.indexOf(k)] = id;
    return id;
  }
  fail(msg: string, tok: number): never {
    this.err = msg;
    this.errTok = tok;
    this.snap(`エラー: ${msg}`, [], [], { bad: tok });
    throw new Fail(msg);
  }
  usable(i: number): boolean {
    const t = this.toks[i];
    return !!t && t.t === 'op' && !(t.op === '·' && this.rule.noImp);
  }
  /** 読み終わらなかった字句のエラー */
  leftover(): never {
    const t = this.toks[this.pos];
    this.fail(
      t.t === ')' ? '対応する ( なし' : t.t === 'op' ? '省略した × は使用不可' : `${t.txt} の前に演算子なし`,
      this.pos,
    );
  }
}
const opOf = (t: Tok): Op => t.op as Op;

/** 操車場: 値は木の列、演算子はスタック */
function parseSY(R: Rec): void {
  const T = R.toks,
    Q = R.rule;
  let want = true;
  const reduce = () => {
    const a = R.stk.pop() as StackItem,
      tok = a.tok as number;
    if (a.k === 'neg') {
      const n = R.neg(tok, R.roots[R.roots.length - 1]);
      R.snap('− を木に', [], [tok], { mk: n });
    } else {
      const r = R.roots[R.roots.length - 1],
        l = R.roots[R.roots.length - 2],
        n = R.bin(tok, l, r);
      R.snap(`${a.t} を木に`, [], [tok], { mk: n });
    }
  };
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    R.pos = i;
    if (want) {
      if (t.t === 'num') {
        R.pos = i + 1;
        R.leaf(i);
        R.snap(`${t.txt} を読み取り`, [], [i]);
        want = false;
      } else if (t.t === 'neg' || t.t === '(') {
        R.pos = i + 1;
        R.stk.push({ t: t.txt, k: t.t === 'neg' ? 'neg' : 'par', tok: i });
        R.snap(`${t.txt} をスタックへ`, [], [i]);
      } else R.fail(`${t.txt} の前に数なし`, i);
    } else if (t.t === 'op') {
      if (!R.usable(i)) R.fail('省略した × は使用不可', i);
      R.pos = i + 1;
      for (;;) {
        const top = R.stk[R.stk.length - 1];
        if (!top || top.k === 'par') {
          R.stk.push({ t: t.txt, k: 'op', tok: i });
          R.snap(`${t.txt} をスタックへ`, [], [i]);
          break;
        }
        R.cmp++;
        const tk = top.tok as number,
          pa = Q.prec[opOf(T[tk])],
          pb = Q.prec[opOf(t)];
        if (pa > pb || (pa === pb && !Q.right[opOf(t)])) {
          R.snap(
            pa > pb ? `${top.t} は ${t.txt} より先 → ${top.t} を木に` : `同じ順位の左結合 → 先の ${top.t} を木に`,
            [tk, i],
          );
          reduce();
        } else {
          R.snap(pa < pb ? `${t.txt} は ${top.t} より先 → スタックへ` : '同じ順位の右結合 → スタックへ', [tk, i]);
          R.stk.push({ t: t.txt, k: 'op', tok: i });
          R.snap(`${t.txt} をスタックへ`, [], [i]);
          break;
        }
      }
      want = true;
    } else if (t.t === ')') {
      R.pos = i + 1;
      R.snap(') → ( まで順に木に', [], [i]);
      for (;;) {
        const top = R.stk[R.stk.length - 1];
        if (!top) R.fail('対応する ( なし', i);
        if (top.k === 'par') {
          R.stk.pop();
          R.snap('( と ) を外す', [], [top.tok as number, i]);
          break;
        }
        reduce();
      }
    } else R.fail(`${t.txt} の前に演算子なし`, i);
  }
  R.pos = T.length;
  if (want) R.fail('式の途中で終わり', T.length - 1);
  R.snap('式の終わり → 残りを順に木に');
  while (R.stk.length) {
    const top = R.stk[R.stk.length - 1];
    if (top.k === 'par') R.fail(') の不足', top.tok as number);
    reduce();
  }
}

/** シフト還元: 数も演算子も 1 本のスタックに積む */
function parseSR(R: Rec): void {
  const T = R.toks,
    Q = R.rule;
  let want = true;
  const topOp = (): StackItem | null => {
    for (let k = R.stk.length - 1; k >= 0; k--) if (R.stk[k].k !== 'E') return R.stk[k];
    return null;
  };
  const reduce = () => {
    const a = R.stk.pop() as StackItem,
      o = R.stk.pop() as StackItem,
      tok = o.tok as number;
    if (o.k === 'neg') {
      const n = R.neg(tok, a.node as number);
      R.stk.push({ t: 'E', k: 'E', node: n, tok });
      R.snap('− E を還元', [], [tok], { mk: n });
    } else {
      const l = R.stk.pop() as StackItem,
        n = R.bin(tok, l.node as number, a.node as number);
      R.stk.push({ t: 'E', k: 'E', node: n, tok });
      R.snap(`E ${o.t} E を還元`, [], [tok], { mk: n });
    }
  };
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    R.pos = i;
    if (want) {
      if (t.t === 'num') {
        R.pos = i + 1;
        const n = R.leaf(i);
        R.stk.push({ t: t.txt, k: 'num', tok: i });
        R.snap(`${t.txt} をシフト`, [], [i]);
        R.stk[R.stk.length - 1] = { t: 'E', k: 'E', node: n, tok: i };
        R.snap(`${t.txt} → E に還元`, [], [i]);
        want = false;
      } else if (t.t === 'neg' || t.t === '(') {
        R.pos = i + 1;
        R.stk.push({ t: t.txt, k: t.t === 'neg' ? 'neg' : 'par', tok: i });
        R.snap(`${t.txt} をシフト`, [], [i]);
      } else R.fail(`${t.txt} の前に数なし`, i);
    } else if (t.t === 'op') {
      if (!R.usable(i)) R.fail('省略した × は使用不可', i);
      R.pos = i + 1;
      for (;;) {
        const top = topOp();
        if (!top || top.k === 'par') break;
        R.cmp++;
        const tk = top.tok as number,
          pa = Q.prec[opOf(T[tk])],
          pb = Q.prec[opOf(t)];
        if (pa > pb || (pa === pb && !Q.right[opOf(t)])) {
          R.snap(`${top.t} は ${t.txt} より先 → 還元`, [tk, i]);
          reduce();
        } else {
          R.snap(`${t.txt} は ${top.t} より先 → シフト`, [tk, i]);
          break;
        }
      }
      R.stk.push({ t: t.txt, k: 'op', tok: i });
      R.snap(`${t.txt} をシフト`, [], [i]);
      want = true;
    } else if (t.t === ')') {
      R.pos = i + 1;
      R.stk.push({ t: ')', k: 'cl', tok: i });
      R.snap(') をシフト', [], [i]);
      R.stk.pop();
      for (;;) {
        const top = topOp();
        if (!top) R.fail('対応する ( なし', i);
        if (top.k === 'par') break;
        R.snap(') の前 → 還元', [top.tok as number, i]);
        reduce();
      }
      const e = R.stk.pop() as StackItem,
        par = R.stk.pop() as StackItem;
      R.stk.push(e);
      R.snap('( E ) を還元', [], [par.tok as number, i]);
    } else R.fail(`${t.txt} の前に演算子なし`, i);
  }
  R.pos = T.length;
  if (want) R.fail('式の途中で終わり', T.length - 1);
  R.snap('式の終わり → 順に還元');
  for (;;) {
    const top = topOp();
    if (!top) break;
    if (top.k === 'par') R.fail(') の不足', top.tok as number);
    reduce();
  }
}

const negStart = (Q: Rule): number => {
  const k = Q.levels.findIndex((l) => l.p >= Q.negMin);
  return k < 0 ? Q.levels.length : k;
};

/** 再帰下降: 順位の弱い処理から順に呼ぶ */
function parseRD(R: Rec): void {
  const T = R.toks,
    Q = R.rule,
    L = Q.levels;
  const lvl = (l: number): number => {
    if (l === L.length) return atom();
    const v = L[l];
    R.stk.push({ t: `${v.name} の処理`, k: 'call' });
    R.snap(`${v.name} の処理へ`);
    let x = lvl(l + 1);
    for (;;) {
      const i = R.pos,
        t = T[i];
      R.cmp++;
      if (!(t && t.t === 'op' && v.ops.includes(opOf(t)) && R.usable(i))) {
        R.stk.pop();
        R.snap(t ? `${t.txt} は ${v.name} でない → 戻る` : `式の終わり → ${v.name} の処理を終了`, t ? [i] : []);
        return x;
      }
      R.pos = i + 1;
      R.snap(`${t.txt} を読み取り`, [], [i]);
      const y = lvl(v.right ? l : l + 1);
      x = R.bin(i, x, y);
      R.snap(`${t.txt} を木に`, [], [i], { mk: x });
      if (v.right) {
        R.stk.pop();
        R.snap(`${v.name} の処理を終了`);
        return x;
      }
    }
  };
  const atom = (): number => {
    const i = R.pos,
      t = T[i];
    R.stk.push({ t: '数・括弧の処理', k: 'call' });
    R.snap('数・括弧の処理へ');
    if (!t) R.fail('式の途中で終わり', T.length - 1);
    let n: number;
    if (t.t === 'num') {
      R.pos = i + 1;
      n = R.leaf(i);
      R.snap(`${t.txt} を読み取り`, [], [i]);
    } else if (t.t === 'neg') {
      R.pos = i + 1;
      R.snap('− を読み取り', [], [i]);
      const k = lvl(negStart(Q));
      n = R.neg(i, k);
      R.snap('− を木に', [], [i], { mk: n });
    } else if (t.t === '(') {
      R.pos = i + 1;
      R.snap('( → 最初の処理へ', [], [i]);
      n = lvl(0);
      const c = T[R.pos];
      if (c?.t !== ')') R.fail(') の不足', i);
      R.pos++;
      R.snap(') を読み取り', [], [R.pos - 1]);
    } else R.fail(`${t.txt} の前に数なし`, i);
    R.stk.pop();
    return n;
  };
  lvl(0);
  if (R.pos < T.length) R.leftover();
  R.snap('式の終わり');
}

/** Pratt: 必要な順位の下限を渡して呼ぶ */
function parsePR(R: Rec): void {
  const T = R.toks,
    Q = R.rule;
  const expr = (min: number): number => {
    R.stk.push({ t: `順位 ${min} 以上`, k: 'call' });
    R.snap(`順位 ${min} 以上を読み取り`);
    const i = R.pos,
      t = T[i];
    if (!t) R.fail('式の途中で終わり', T.length - 1);
    let x: number;
    if (t.t === 'num') {
      R.pos = i + 1;
      x = R.leaf(i);
      R.snap(`${t.txt} を読み取り`, [], [i]);
    } else if (t.t === 'neg') {
      R.pos = i + 1;
      R.snap('− を読み取り', [], [i]);
      const k = expr(Q.negMin);
      x = R.neg(i, k);
      R.snap('− を木に', [], [i], { mk: x });
    } else if (t.t === '(') {
      R.pos = i + 1;
      R.snap('( → 順位の下限を 1 へ', [], [i]);
      x = expr(1);
      const c = T[R.pos];
      if (c?.t !== ')') R.fail(') の不足', i);
      R.pos++;
      R.snap(') を読み取り', [], [R.pos - 1]);
    } else R.fail(`${t.txt} の前に数なし`, i);
    for (;;) {
      const j = R.pos,
        o = T[j];
      if (o?.t !== 'op' || !R.usable(j)) break;
      const p = Q.prec[opOf(o)];
      R.cmp++;
      if (p < min) {
        R.snap(`${o.txt} の順位 ${p} < ${min} → 戻る`, [j]);
        break;
      }
      R.pos = j + 1;
      R.snap(`${o.txt} の順位 ${p} ≥ ${min} → 続行`, [j]);
      const y = expr(Q.right[opOf(o)] ? p : p + 1);
      x = R.bin(j, x, y);
      R.snap(`${o.txt} を木に`, [], [j], { mk: x });
    }
    R.stk.pop();
    R.snap('1 段戻る');
    return x;
  };
  expr(1);
  if (R.pos < T.length) R.leftover();
  R.snap('式の終わり');
}

/** バックトラックとパックラット: 「A op A」を先に試し、だめなら戻って「A」を読み直す */
function parsePeg(R: Rec, useMemo: boolean): void {
  const T = R.toks,
    Q = R.rule,
    L = Q.levels,
    memo = new Map<string, { id: number; end: number } | null>();
  interface Chain {
    vals: number[];
    ops: number[];
  }
  const mark = () => ({ pos: R.pos, roots: R.roots.slice(), stk: R.stk.slice() });
  const rew = (m: ReturnType<typeof mark>, msg: string) => {
    R.back += R.pos - m.pos;
    R.pos = m.pos;
    R.roots = m.roots.slice();
    R.stk = m.stk.slice();
    R.snap(msg, [], [], { backed: true });
  };
  const outer = (l: number): number | null => {
    if (l === L.length) return atom();
    const key = `${l}:${R.pos}`,
      h = useMemo ? memo.get(key) : undefined;
    if (h !== undefined) {
      R.stk.push({ t: `${L[l].name} の結果`, k: 'call' });
      R.snap(`${L[l].name} の結果を再利用`);
      R.stk.pop();
      if (!h) return null;
      R.roots.push(h.id);
      R.pos = h.end;
      R.snap(`字句 ${T[h.end - 1]?.txt ?? ''} まで読み飛ばし`);
      return h.id;
    }
    R.stk.push({ t: `${L[l].name} の処理`, k: 'call' });
    R.snap(`${L[l].name} を試行`);
    const c = inner(l);
    let x: number | null = null;
    if (c) {
      const say = (k: number, n: number) => R.snap(`${R.toks[c.ops[k]].txt} を木に`, [], [c.ops[k]], { mk: n });
      if (L[l].right) {
        x = c.vals[c.vals.length - 1];
        for (let k = c.ops.length - 1; k >= 0; k--) {
          x = R.bin(c.ops[k], c.vals[k], x);
          say(k, x);
        }
      } else {
        x = c.vals[0];
        for (let k = 0; k < c.ops.length; k++) {
          x = R.bin(c.ops[k], x, c.vals[k + 1]);
          say(k, x);
        }
      }
    }
    R.stk.pop();
    if (useMemo) memo.set(key, x == null ? null : { id: x, end: R.pos });
    return x;
  };
  const inner = (l: number): Chain | null => {
    const m = mark(),
      b = outer(l + 1);
    if (b == null) return null;
    const i = R.pos,
      t = T[i];
    R.cmp++;
    if (t && t.t === 'op' && L[l].ops.includes(opOf(t)) && R.usable(i)) {
      R.pos = i + 1;
      R.snap(`${t.txt} を読み取り`, [], [i]);
      const rest = inner(l);
      if (rest) return { vals: [b, ...rest.vals], ops: [i, ...rest.ops] };
    }
    rew(m, `${L[l].name} なし → 戻って読み直し`);
    const b2 = outer(l + 1);
    return b2 == null ? null : { vals: [b2], ops: [] };
  };
  const atom = (): number | null => {
    const i = R.pos,
      t = T[i];
    if (!t) return null;
    if (t.t === 'num') {
      R.pos = i + 1;
      const n = R.leaf(i);
      R.snap(`${t.txt} を読み取り`, [], [i]);
      return n;
    }
    if (t.t === 'neg') {
      R.pos = i + 1;
      R.snap('− を読み取り', [], [i]);
      const k = outer(negStart(Q));
      if (k == null) return null;
      const n = R.neg(i, k);
      R.snap('− を木に', [], [i], { mk: n });
      return n;
    }
    if (t.t === '(') {
      R.pos = i + 1;
      R.snap('( を読み取り', [], [i]);
      const x = outer(0);
      if (x == null) return null;
      const c = T[R.pos];
      if (c?.t !== ')') return null;
      R.pos++;
      R.snap(') を読み取り', [], [R.pos - 1]);
      return x;
    }
    return null;
  };
  /* 戻りながら読むので、いちばん遠くまで読んだ位置でエラーを出す */
  const pegFail = (): never => {
    const k = R.far,
      t = T[k];
    if (!t) {
      const st: number[] = [];
      T.forEach((q, i) => {
        if (q.t === '(') st.push(i);
        if (q.t === ')') st.pop();
      });
      if (st.length) R.fail(') の不足', st[st.length - 1]);
      R.fail('式の途中で終わり', T.length - 1);
    }
    if (t.t === ')') {
      let d = 0;
      for (let i = 0; i < k; i++) d += T[i].t === '(' ? 1 : T[i].t === ')' ? -1 : 0;
      R.fail(d <= 0 ? '対応する ( なし' : ') の前に数なし', k);
    }
    if (t.op === '·' && Q.noImp) R.fail('省略した × は使用不可', k);
    const prev = T[k - 1],
      afterVal = !!prev && (prev.t === 'num' || prev.t === ')');
    if ((t.t === 'num' || t.t === '(') && afterVal) R.fail(`${t.txt} の前に演算子なし`, k);
    R.fail(`${t.txt} の前に数なし`, k);
  };
  const x = outer(0);
  if (x == null || R.pos < T.length) pegFail();
  R.snap('式の終わり');
}

/* ---------- 計算 ---------- */
/** 値の表示。割り切れない値は 6 桁、負の値は − を付ける */
export function fmt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return 'エラー';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const a = Math.abs(v),
    s =
      Number.isInteger(v) && a < 1e12
        ? String(a)
        : a >= 1e12 || a < 1e-4
          ? a.toExponential(3)
          : String(Number(a.toPrecision(6)));
  return (v < 0 ? '−' : '') + s;
}
function applyOp(op: Op, a: number, b: number): number {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*' || op === '·') return a * b;
  if (op === '/') return b === 0 ? Number.NaN : a / b;
  return a ** b;
}

export interface Trace {
  src: string;
  /** 正規化した式 */
  s: string;
  toks: Tok[];
  lex: LexFrame[];
  parse: Frame[];
  calc: Frame[];
  rule: Rule;
  method: MethodDef;
  nodes: Node[];
  /** 数の字句 → 左から何番目の葉か */
  leafIdx: Map<number, number>;
  /** 計算した順の丸 */
  order: number[];
  depth: number;
  root: number | null;
  ans: number | null;
  err: string | null;
  errTok: number;
  steps: number;
  aborted: boolean;
  trunc: boolean;
  maxS: number;
  cmp: number;
  back: number;
}

function finish(tr: Trace, R: Rec): void {
  const N = R.nodes,
    T = tr.toks;
  tr.nodes = N;
  T.forEach((t, i) => {
    if (t.t === 'num') tr.leafIdx.set(i, tr.leafIdx.size);
  });
  const last = tr.parse[tr.parse.length - 1],
    root = R.err || R.aborted ? null : last.roots[0];
  const depth = (id: number, d = 1): number => Math.max(d, ...N[id].kids.map((k) => depth(k, d + 1)));
  tr.root = root;
  tr.depth = root == null ? Math.max(1, ...last.roots.map((r) => depth(r))) : depth(root);
  if (root == null) return;
  const vals = new Map<number, number>(),
    base = { pos: T.length, roots: [root], stk: [], cmp: R.cmp, back: R.back, maxS: R.maxS, step: R.steps },
    leaves = new Set<number>();
  const collect = (id: number): void => {
    if (N[id].kind === 'num') leaves.add(id);
    N[id].kids.forEach(collect);
  };
  collect(root);
  for (const id of leaves) vals.set(id, N[id].v as number);
  tr.calc.push({ ...base, say: '葉の数はそのまま値', r: [], w: [], vals: new Map(vals) });
  let evalErr = false;
  const walk = (id: number): number => {
    const n = N[id];
    if (n.kind === 'num') return n.v as number;
    const xs = n.kids.map(walk),
      v = n.kind === 'neg' ? -xs[0] : applyOp(n.op as Op, xs[0], xs[1]);
    if (Number.isNaN(v)) evalErr = true;
    vals.set(id, v);
    tr.order.push(id);
    tr.calc.push({
      ...base,
      say: n.kind === 'neg' ? `−(${fmt(xs[0])}) = ${fmt(v)}` : `${fmt(xs[0])} ${n.txt} ${fmt(xs[1])} = ${fmt(v)}`,
      r: n.kids.map((k) => N[k].tok),
      w: [n.tok],
      hot: id,
      vals: new Map(vals),
    });
    return v;
  };
  const v = walk(root);
  tr.ans = evalErr ? Number.NaN : v;
}

/** 式を字句解析・構文解析・計算まで通して記録する */
export function build(src: string, ruleDef: RuleDef, methodId: MethodId): Trace {
  const lx = lexIt(src),
    rule = compileRule(ruleDef),
    R = new Rec(lx.toks, rule);
  const tr: Trace = {
    src,
    s: lx.s,
    toks: lx.toks,
    lex: lx.F,
    parse: [],
    calc: [],
    rule,
    method: methodOf(methodId) as MethodDef,
    nodes: [],
    leafIdx: new Map(),
    order: [],
    depth: 1,
    root: null,
    ans: null,
    err: lx.err,
    errTok: -1,
    steps: 0,
    aborted: false,
    trunc: false,
    maxS: 0,
    cmp: 0,
    back: 0,
  };
  if (lx.err) {
    tr.parse = [R.frame(`エラー: ${lx.err}`)];
    return tr;
  }
  try {
    /* 最初のコマは読み始める前の状態なので、手順に数えない */
    R.F.push(R.frame('字句を左から読み取り'));
    if (!lx.toks.length) R.fail('式がない', -1);
    if (methodId === 'sy') parseSY(R);
    else if (methodId === 'sr') parseSR(R);
    else if (methodId === 'rd') parseRD(R);
    else if (methodId === 'pr') parsePR(R);
    else parsePeg(R, methodId === 'pk');
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
  }
  /* 残せなかった手順の結果も、最後のコマで見せる */
  if (R.aborted) R.F.push(R.frame('打ち切り'));
  else if (R.trunc)
    R.F.push(
      R.frame(R.err ? `エラー: ${R.err}` : '式の終わり', [], [], {
        bad: R.errTok >= 0 ? R.errTok : undefined,
      }),
    );
  Object.assign(tr, {
    parse: R.F,
    err: R.err,
    errTok: R.errTok,
    steps: R.steps,
    aborted: R.aborted,
    trunc: R.trunc,
    maxS: R.maxS,
    cmp: R.cmp,
    back: R.back,
  });
  finish(tr, R);
  return tr;
}

/** 木を括弧の文字列にする（試験と比較用） */
export function sexpr(tr: Trace, id = tr.root as number): string {
  const n = tr.nodes[id];
  return n.kind === 'num' ? n.txt : `(${n.op} ${n.kids.map((k) => sexpr(tr, k)).join(' ')})`;
}

/* ---------- 順位の編集 ---------- */
/** 保存した決まりが使えるか調べ、使えなければ null を返す */
export function checkRule(v: unknown): RuleDef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<RuleDef>;
  if (!Array.isArray(o.rank) || !Array.isArray(o.right)) return null;
  const all = o.rank.flat();
  if (all.length !== BIN_OPS.length + 1 || new Set(all).size !== all.length) return null;
  if (![...BIN_OPS, 'neg'].every((p) => all.includes(p as Op))) return null;
  if (!o.right.every((p) => all.includes(p))) return null;
  return { id: 'custom', name: '編集中', rank: o.rank, right: o.right, noImp: !!o.noImp };
}
/** 順位を入れ替えた決まりを作る。i と j は rank の行 */
export function swapRows(d: RuleDef, i: number, j: number): RuleDef {
  const rank = d.rank.map((r) => r.slice());
  [rank[i], rank[j]] = [rank[j], rank[i]];
  return { id: 'custom', name: '編集中', rank, right: d.right.slice(), noImp: d.noImp };
}
/** 行の結合を変えた決まりを作る */
export function setAssoc(d: RuleDef, i: number, right: boolean): RuleDef {
  const row = d.rank[i],
    keep = d.right.filter((o) => !row.includes(o));
  return {
    id: 'custom',
    name: '編集中',
    rank: d.rank.map((r) => r.slice()),
    right: right ? [...keep, ...row] : keep,
    noImp: d.noImp,
  };
}

/* ---------- 音 ---------- */
/** 音の高さの段: ペンタトニックの音階の番号 → 半音の数 */
const PENTA = [0, 2, 4, 7, 9];
export const semiOf = (deg: number): number => {
  const d = Math.max(0, Math.min(20, deg));
  return 12 * Math.floor(d / 5) + PENTA[d % 5];
};
/** 音の値の上限（lib の freqOf で 1 刻みが半音になる） */
export const TONE_VM = 49;
const toneOf = (deg: number): number => semiOf(deg) + 1;

/** 木の中の深さ（根が 0） */
function depthIn(tr: Trace, id: number): number {
  const up = new Map<number, number>();
  for (const n of tr.nodes) for (const k of n.kids) up.set(k, n.id);
  let d = 0,
    q = id;
  while (up.has(q)) {
    q = up.get(q) as number;
    d++;
  }
  return d;
}
/** 構文解析の 1 コマの音: スタックが深いほど高い。比較は 2 音、木に足すと下がる 2 音、戻ると低い音 */
export function parseTones(f: Frame): number[] {
  if (f.bad != null) return [toneOf(0), toneOf(0)];
  if (f.backed) return [toneOf(0)];
  const d = f.stk.length;
  if (f.r.length === 2) return [toneOf(d), toneOf(d + 1)];
  if (f.mk != null) return [toneOf(d + 2), toneOf(d)];
  return [toneOf(d)];
}
/** 字句解析の 1 コマの音: 右へ読むほど高い。できた字句の位置で鳴らす */
export const lexTones = (f: LexFrame, len: number): number[] => {
  if (f.bad) return [toneOf(0), toneOf(0)];
  if (f.hot < 0 || len < 1) return [];
  return [toneOf(Math.round((f.cj / len) * 10) + 4)];
};
/** 計算の 1 コマの音: 木の深い所ほど高い。根に近づくほど下がる */
export function calcTones(tr: Trace, f: Frame): number[] {
  if (f.hot == null) return [];
  const d = depthIn(tr, f.hot);
  return [toneOf(d * 2 + 4), toneOf(d * 2 + 6)];
}

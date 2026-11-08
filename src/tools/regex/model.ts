/**
 * 正規表現のエンジン。パターンを構文木と命令列にし、5 つの方式で照合して、図で再生できるコマとして記録する。
 * 記法は JavaScript の正規表現の一部（先読み・後読み・名前付きグループ・Unicode の性質はない）。
 * 数えるのは「文字の比較」で、文字・^ $ \b の判定・後方参照の 1 文字・NFA の 1 状態の判定を 1 回とする。
 * DFA は表を引く 1 回も 1 回と数える
 */

/** 手順の打ち切り（破滅的バックトラックで止まらないため） */
export const STEP_MAX = 120_000;
/** 記録するコマの上限 */
const FRAME_MAX = 60_000;
/** 先に全部作る DFA の状態の上限 */
export const DFA_MAX = 3000;
/** パターンと文章の長さの上限 */
export const PAT_MAX = 60;
export const TEXT_MAX = 400;
/** 回数の指定の上限（命令列が伸びすぎないため） */
const REP_MAX = 30;

/** DFA の作成で、文章に出ない文字をまとめて表す代表 */
export const OTHER = '￿';
const isW = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);
type Test = (c: string | undefined) => boolean;

export type NodeT = 'ch' | 'bol' | 'eol' | 'wb' | 'nwb' | 'ref' | 'cat' | 'alt' | 'rep' | 'grp';
/** 構文木の節。s・e はパターンの中の位置 */
export interface RNode {
  id: number;
  t: NodeT;
  s: number;
  e: number;
  test?: Test;
  xs?: RNode[];
  x?: RNode;
  min?: number;
  max?: number;
  lazy?: boolean;
  /** グループ・後方参照の番号 */
  n?: number;
}
type AsKind = 'bol' | 'eol' | 'wb' | 'nwb';
export interface Inst {
  op: 'ch' | 'as' | 'ref' | 'split' | 'jmp' | 'save' | 'mark' | 'chk' | 'match';
  test?: Test;
  as?: AsKind;
  k?: number;
  n?: number;
  x?: number;
  y?: number;
  node?: RNode;
}
export interface Regex {
  src: string;
  ast: RNode;
  ng: number;
  hasRef: boolean;
  hasAs: boolean;
  ml: boolean;
  ic: boolean;
  P: Inst[];
  ncap: number;
  /** 図の行: パターンの中の文字・記号を書いた順に。最後の行は一致 */
  atoms: RNode[];
  /** 命令ごとの図の行（行のない命令は -1） */
  rowOf: number[];
}
export interface ParseErr {
  err: string;
  at: number;
}

/* ---------- 構文解析 ---------- */
function walk(n: RNode, f: (n: RNode) => void): void {
  f(n);
  for (const x of n.xs ?? []) walk(x, f);
  if (n.x) walk(n.x, f);
}
function nullable(n: RNode): boolean {
  switch (n.t) {
    case 'ch':
      return false;
    case 'cat':
      return (n.xs ?? []).every(nullable);
    case 'alt':
      return (n.xs ?? []).some(nullable);
    case 'rep':
      return n.min === 0 || nullable(n.x as RNode);
    case 'grp':
      return nullable(n.x as RNode);
    default:
      return true;
  }
}

class Fail {
  constructor(
    readonly msg: string,
    readonly at: number,
  ) {}
}

/** パターンを構文木にする。flags は 'i'（大文字と小文字を区別しない）と 'm'（^ $ を行ごと） */
export function parseRe(src: string, flags = ''): Regex | ParseErr {
  let i = 0,
    ng = 0,
    id = 0,
    hasRef = false,
    hasAs = false;
  const ic = flags.includes('i');
  const err = (msg: string): never => {
    throw new Fail(msg, i);
  };
  const mk = (o: Omit<RNode, 'id'>): RNode => ({ id: id++, ...o });
  const eqc = (a: string | undefined, b: string): boolean =>
    a === b || (ic && a !== undefined && a.toLowerCase() === b.toLowerCase());
  const cls = (d: string): ((c: string) => boolean) => {
    const l = d.toLowerCase(),
      f = l === 'd' ? (c: string) => /[0-9]/.test(c) : l === 'w' ? isW : (c: string) => /\s/.test(c);
    return d === l ? f : (c: string) => !f(c);
  };
  const lit = (ch: string, s: number): RNode => mk({ t: 'ch', test: (c) => eqc(c, ch), s, e: i });
  function alt(): RNode {
    const s = i,
      xs = [cat()];
    while (src[i] === '|') {
      i++;
      xs.push(cat());
    }
    return xs.length === 1 ? xs[0] : mk({ t: 'alt', xs, s, e: i });
  }
  function cat(): RNode {
    const s = i,
      xs: RNode[] = [];
    while (i < src.length && src[i] !== '|' && src[i] !== ')') xs.push(rep());
    return xs.length === 1 ? xs[0] : mk({ t: 'cat', xs, s, e: i });
  }
  function rep(): RNode {
    const s = i;
    let x = atom();
    for (;;) {
      let min: number, max: number;
      const c = src[i],
        m = src.slice(i).match(/^\{(\d+)(,(\d*))?\}/);
      if (c === '*') [min, max] = [0, Infinity];
      else if (c === '+') [min, max] = [1, Infinity];
      else if (c === '?') [min, max] = [0, 1];
      else if (m) {
        min = Number(m[1]);
        max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min;
        if (max < min) err('{m,n} の m が n より大きくなっています。');
        if (min > REP_MAX || (max !== Infinity && max > REP_MAX)) err(`回数は ${REP_MAX} までにしてください。`);
      } else break;
      i += m && c === '{' ? m[0].length : 1;
      if (x.t !== 'ch' && x.t !== 'grp' && x.t !== 'ref') err('この記号は繰り返せません。');
      let lazy = false;
      if (src[i] === '?') {
        lazy = true;
        i++;
      }
      x = mk({ t: 'rep', x, min, max, lazy, s, e: i });
    }
    return x;
  }
  function atom(): RNode {
    const s = i,
      c = src[i];
    if (c === '(') {
      i++;
      let cap = true;
      if (src.startsWith('?:', i)) {
        cap = false;
        i += 2;
      } else if (src[i] === '?') err('この記法には対応していません。');
      const n = cap ? ++ng : 0,
        x = alt();
      if (src[i] !== ')') err('「)」がありません。');
      i++;
      return mk({ t: 'grp', x, n, s, e: i });
    }
    if (c === '*' || c === '+' || c === '?') err('繰り返す対象がありません。');
    if (c === '.') {
      i++;
      return mk({ t: 'ch', test: (ch) => ch !== undefined && ch !== '\n' && ch !== '\r', s, e: i });
    }
    if (c === '^' || c === '$') {
      i++;
      hasAs = true;
      return mk({ t: c === '^' ? 'bol' : 'eol', s, e: i });
    }
    if (c === '[') return klass();
    if (c === '\\') {
      i++;
      const d = src[i];
      if (d === undefined) err('「\\」で終わっています。');
      i++;
      if ('dDwWsS'.includes(d)) {
        const f = cls(d);
        return mk({ t: 'ch', test: (ch) => ch !== undefined && f(ch), s, e: i });
      }
      if (d === 'b' || d === 'B') {
        hasAs = true;
        return mk({ t: d === 'b' ? 'wb' : 'nwb', s, e: i });
      }
      if (/[1-9]/.test(d)) {
        hasRef = true;
        return mk({ t: 'ref', n: Number(d), s, e: i });
      }
      return lit(({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[d] ?? d, s);
    }
    i++;
    return lit(c, s);
  }
  function klass(): RNode {
    const s = i;
    i++;
    const neg = src[i] === '^';
    if (neg) i++;
    const fs: ((c: string) => boolean)[] = [];
    const one = (): { ch?: string; f?: (c: string) => boolean } => {
      if (src[i] === '\\') {
        i++;
        const d = src[i++];
        if (d === undefined) err('「]」がありません。');
        if ('dDwWsS'.includes(d)) return { f: cls(d) };
        return { ch: ({ n: '\n', t: '\t' } as Record<string, string>)[d] ?? d };
      }
      return { ch: src[i++] };
    };
    while (src[i] !== ']') {
      if (i >= src.length) err('「]」がありません。');
      const a = one();
      if (a.ch !== undefined && src[i] === '-' && src[i + 1] !== ']' && src[i + 1] !== undefined) {
        i++;
        const b = one();
        if (b.ch === undefined) err('範囲の指定が正しくありません。');
        const lo = a.ch.charCodeAt(0),
          hi = (b.ch as string).charCodeAt(0);
        if (hi < lo) err('範囲の順序が逆です。');
        fs.push((c) => {
          const k = c.charCodeAt(0);
          if (k >= lo && k <= hi) return true;
          if (!ic) return false;
          const u = c.toUpperCase().charCodeAt(0),
            l = c.toLowerCase().charCodeAt(0);
          return (u >= lo && u <= hi) || (l >= lo && l <= hi);
        });
      } else if (a.f) fs.push(a.f);
      else {
        const ch = a.ch as string;
        fs.push((c) => eqc(c, ch));
      }
    }
    i++;
    return mk({ t: 'ch', test: (c) => c !== undefined && fs.some((f) => f(c)) !== neg, s, e: i });
  }
  try {
    if (src.length > PAT_MAX) err(`パターンは ${PAT_MAX} 文字までにしてください。`);
    const ast = alt();
    if (i < src.length) err(src[i] === ')' ? '「(」がありません。' : '読めない記号があります。');
    let bad: RNode | null = null;
    walk(ast, (n) => {
      if (n.t === 'ref' && (n.n ?? 0) > ng && !bad) bad = n;
    });
    if (bad) {
      const b = bad as RNode;
      i = b.s;
      err(`グループ ${b.n} がありません。`);
    }
    return compile({ src, ast, ng, hasRef, hasAs, ml: flags.includes('m'), ic });
  } catch (e) {
    if (e instanceof Fail) return { err: e.msg, at: e.at };
    throw e;
  }
}
export const isErr = <T extends object>(r: T | ParseErr): r is ParseErr => 'err' in r;

/* ---------- 命令列 ---------- */
function compile(re: Omit<Regex, 'P' | 'ncap' | 'atoms' | 'rowOf'>): Regex {
  const P: Inst[] = [];
  let loops = 0;
  const emit = (o: Inst): number => P.push(o) - 1;
  function c(n: RNode): void {
    switch (n.t) {
      case 'ch':
        emit({ op: 'ch', test: n.test, node: n });
        break;
      case 'bol':
      case 'eol':
      case 'wb':
      case 'nwb':
        emit({ op: 'as', as: n.t, node: n });
        break;
      case 'ref':
        emit({ op: 'ref', n: n.n, node: n });
        break;
      case 'cat':
        for (const x of n.xs ?? []) c(x);
        break;
      case 'grp':
        if (n.n) emit({ op: 'save', k: 2 * n.n });
        c(n.x as RNode);
        if (n.n) emit({ op: 'save', k: 2 * n.n + 1 });
        break;
      case 'alt': {
        const js: number[] = [],
          xs = n.xs ?? [];
        xs.forEach((x, k) => {
          if (k < xs.length - 1) {
            const sp = emit({ op: 'split', node: n });
            P[sp].x = P.length;
            c(x);
            js.push(emit({ op: 'jmp' }));
            P[sp].y = P.length;
          } else c(x);
        });
        for (const j of js) P[j].x = P.length;
        break;
      }
      case 'rep': {
        const x = n.x as RNode,
          min = n.min ?? 0,
          max = n.max ?? Infinity;
        for (let k = 0; k < min; k++) c(x);
        if (max === Infinity) {
          /* 空に一致しうる繰り返しは、1 回分の一致が空なら打ち切る（JavaScript と同じ） */
          const nul = nullable(x),
            slot = nul ? loops++ : -1,
            L = emit({ op: 'split', node: n }),
            body = P.length;
          if (nul) emit({ op: 'mark', k: slot });
          c(x);
          if (nul) emit({ op: 'chk', k: slot });
          emit({ op: 'jmp', x: L });
          const out = P.length;
          [P[L].x, P[L].y] = n.lazy ? [out, body] : [body, out];
        } else {
          const sps: [number, number][] = [];
          for (let k = min; k < max; k++) {
            const sp = emit({ op: 'split', node: n });
            sps.push([sp, P.length]);
            c(x);
          }
          const out = P.length;
          for (const [sp, b] of sps) [P[sp].x, P[sp].y] = n.lazy ? [out, b] : [b, out];
        }
        break;
      }
    }
  }
  emit({ op: 'save', k: 0 });
  c(re.ast);
  emit({ op: 'save', k: 1 });
  emit({ op: 'match' });
  const atoms: RNode[] = [];
  walk(re.ast, (n) => {
    if (['ch', 'bol', 'eol', 'wb', 'nwb', 'ref'].includes(n.t)) atoms.push(n);
  });
  atoms.sort((a, b) => a.s - b.s);
  const rowOfNode = new Map(atoms.map((n, k) => [n.id, k]));
  const rowOf = P.map((I) =>
    I.op === 'match' ? atoms.length : I.node && I.op !== 'split' ? (rowOfNode.get(I.node.id) ?? -1) : -1,
  );
  return { ...re, P, ncap: 2 * (re.ng + 1), atoms, rowOf };
}
function assertOk(re: Regex, k: AsKind, text: string, p: number): boolean {
  if (k === 'bol') return p === 0 || (re.ml && text[p - 1] === '\n');
  if (k === 'eol') return p === text.length || (re.ml && text[p] === '\n');
  const b = isW(text[p - 1]) !== isW(text[p]);
  return k === 'wb' ? b : !b;
}

/* ---------- 記録 ---------- */
/** コマの種類: 開始・一致・不一致・判定の成立・失敗済み・後戻り・この開始位置で見つからず・一致の確定・NFA の 1 文字・DFA の作成・一致（NFA） */
export type FK = 'start' | 'ok' | 'ng' | 'aok' | 'memo' | 'back' | 'fail' | 'match' | 'nfa' | 'build' | 'found';
export interface Thread {
  pc: number;
  st: number;
}
export interface Frame {
  k: FK;
  /** 文章の位置 */
  pos: number;
  /** 照合を始めた位置 */
  st: number;
  /** 命令（ないとき -1） */
  pc: number;
  /** バックトラックのスタックの深さ */
  d: number;
  steps: number;
  back: number;
  /** ここまでに見つかった一致の数 */
  mc: number;
  /** 後方参照で比べた長さ */
  len?: number;
  /** NFA・DFA の今の状態（優先の高い順） */
  th?: Thread[];
  /** 状態ごとの結果: 0 不一致・1 一致・2 一致の確定 */
  hits?: number[];
  /** 遅延 DFA で新しく作った状態か */
  isNew?: boolean;
  /** DFA の表を引いたか */
  cached?: boolean;
  /** ここまでに作った DFA の状態の数 */
  states?: number;
  /** DFA の作成: 試している文字（Run の alpha の番号）・今の状態・行き先の状態（なければ -1） */
  ci?: number;
  ds?: number;
  to?: number;
}
export interface Match {
  s: number;
  e: number;
  caps: number[];
}
export interface Run {
  fr: Frame[];
  steps: number;
  back: number;
  matches: Match[];
  aborted: boolean;
  maxDepth: number;
  maxTh: number;
  /** DFA の状態の数（DFA の方式だけ） */
  states?: number;
  /** この方式で扱えないときの理由 */
  unsup?: string;
  /** DFA の作成で試す文字（最後は文章に出ない文字の代表 OTHER） */
  alpha?: string[];
  /** DFA の状態ごとの NFA の状態（作った順） */
  dsets?: number[][];
}

/** バックトラック。memo なら (命令, 位置) の失敗を覚えて同じ所へは進まない */
export function runBT(re: Regex, text: string, memo = false): Run {
  const { P } = re,
    n = text.length,
    fr: Frame[] = [],
    matches: Match[] = [];
  let steps = 0,
    back = 0,
    aborted = false,
    maxDepth = 0,
    start = 0,
    seen = memo ? new Set<number>() : null;
  const push = (f: Omit<Frame, 'steps' | 'back' | 'mc'>): void => {
    if (fr.length < FRAME_MAX) fr.push({ ...f, steps, back, mc: matches.length });
  };
  interface Th {
    pc: number;
    pos: number;
    caps: number[];
    regs: number[];
  }
  outer: while (start <= n) {
    const stack: Th[] = [];
    let th: Th = { pc: 0, pos: start, caps: new Array(re.ncap).fill(-1), regs: [] },
      found: Th | null = null;
    push({ k: 'start', st: start, pos: start, pc: -1, d: 0 });
    for (;;) {
      run: for (;;) {
        if (steps >= STEP_MAX) {
          aborted = true;
          break outer;
        }
        const I = P[th.pc];
        switch (I.op) {
          case 'ch': {
            steps++;
            const hit = th.pos < n && (I.test as Test)(text[th.pos]);
            push({ k: hit ? 'ok' : 'ng', st: start, pos: th.pos, pc: th.pc, d: stack.length });
            if (!hit) break run;
            th = { ...th, pc: th.pc + 1, pos: th.pos + 1 };
            break;
          }
          case 'as': {
            steps++;
            const hit = assertOk(re, I.as as AsKind, text, th.pos);
            push({ k: hit ? 'aok' : 'ng', st: start, pos: th.pos, pc: th.pc, d: stack.length });
            if (!hit) break run;
            th = { ...th, pc: th.pc + 1 };
            break;
          }
          case 'ref': {
            const g = I.n ?? 0,
              a = th.caps[2 * g],
              b = th.caps[2 * g + 1];
            let len = 0,
              hit = true;
            if (a >= 0 && b >= 0) {
              len = b - a;
              for (let q = 0; q < len; q++) {
                steps++;
                const x = text[a + q],
                  y = text[th.pos + q];
                if (y === undefined || !(x === y || (re.ic && x.toLowerCase() === y.toLowerCase()))) {
                  hit = false;
                  break;
                }
              }
            }
            push({ k: hit ? 'ok' : 'ng', st: start, pos: th.pos, pc: th.pc, d: stack.length, len });
            if (!hit) break run;
            th = { ...th, pc: th.pc + 1, pos: th.pos + len };
            break;
          }
          case 'split': {
            if (seen) {
              const key = th.pc * (n + 1) + th.pos;
              if (seen.has(key)) {
                push({ k: 'memo', st: start, pos: th.pos, pc: th.pc, d: stack.length });
                break run;
              }
              seen.add(key);
            }
            stack.push({ ...th, pc: I.y as number });
            if (stack.length > maxDepth) maxDepth = stack.length;
            th = { ...th, pc: I.x as number };
            break;
          }
          case 'jmp':
            th = { ...th, pc: I.x as number };
            break;
          case 'save': {
            const caps = th.caps.slice();
            caps[I.k as number] = th.pos;
            th = { ...th, caps, pc: th.pc + 1 };
            break;
          }
          case 'mark': {
            const regs = th.regs.slice();
            regs[I.k as number] = th.pos;
            th = { ...th, regs, pc: th.pc + 1 };
            break;
          }
          case 'chk':
            if (th.regs[I.k as number] === th.pos) break run;
            th = { ...th, pc: th.pc + 1 };
            break;
          case 'match':
            found = th;
            break run;
        }
      }
      const next = found ? undefined : stack.pop();
      if (!next) break;
      back++;
      th = next;
      push({ k: 'back', st: start, pos: th.pos, pc: th.pc, d: stack.length });
    }
    if (found) {
      const [s, e] = found.caps;
      matches.push({ s, e, caps: found.caps });
      push({ k: 'match', st: start, pos: e, pc: P.length - 1, d: 0 });
      start = e > s ? e : e + 1;
      /* 一致した道すじの (命令, 位置) は失敗ではないので覚え直す */
      if (seen) seen = new Set();
    } else {
      push({ k: 'fail', st: start, pos: start, pc: -1, d: 0 });
      start++;
    }
  }
  return { fr, steps, back, matches, aborted, maxDepth, maxTh: 1 };
}

interface Th2 {
  pc: number;
  st: number;
  caps: number[];
}
/** ε 遷移をたどって、文字を読む命令と一致の命令を優先の高い順に足す */
function closure(
  re: Regex,
  text: string,
  list: Th2[],
  seen: Set<number>,
  pc: number,
  st: number,
  caps: number[],
  p: number,
  cnt: { n: number },
): void {
  if (seen.has(pc)) return;
  seen.add(pc);
  const I = re.P[pc];
  switch (I.op) {
    case 'jmp':
      closure(re, text, list, seen, I.x as number, st, caps, p, cnt);
      break;
    case 'split':
      closure(re, text, list, seen, I.x as number, st, caps, p, cnt);
      closure(re, text, list, seen, I.y as number, st, caps, p, cnt);
      break;
    case 'save': {
      const c2 = caps.slice();
      c2[I.k as number] = p;
      closure(re, text, list, seen, pc + 1, st, c2, p, cnt);
      break;
    }
    case 'mark':
    case 'chk':
      closure(re, text, list, seen, pc + 1, st, caps, p, cnt);
      break;
    case 'as':
      cnt.n++;
      if (assertOk(re, I.as as AsKind, text, p)) closure(re, text, list, seen, pc + 1, st, caps, p, cnt);
      break;
    default:
      list.push({ pc, st, caps });
  }
}

export type NfaKind = 'nfa' | 'ldfa' | 'dfa';
/**
 * NFA シミュレーション（Pike VM）・遅延 DFA・DFA。どれも同じ状態の列をたどり、一致の位置は同じになる。
 * 違うのは数え方で、DFA は同じ (状態, 文字) の 2 回目から表を引く 1 回になる。dfa は先に全部の状態を作る
 */
export function runNFA(re: Regex, text: string, kind: NfaKind = 'nfa'): Run {
  const empty = { fr: [], steps: 0, back: 0, matches: [], aborted: false, maxDepth: 0, maxTh: 0 };
  if (re.hasRef) return { ...empty, unsup: '後方参照には対応していません。' };
  if (kind === 'dfa' && re.hasAs) return { ...empty, unsup: '^ $ \\b には対応していません。' };
  const { P } = re,
    n = text.length,
    fr: Frame[] = [],
    matches: Match[] = [];
  let steps = 0,
    maxTh = 0,
    aborted = false,
    from = 0,
    states = 0;
  const cache = new Set<string>(),
    known = new Set<string>();
  const ctx = (p: number): string =>
    re.hasAs
      ? `${p === 0 ? '^' : ''}${p === n ? '$' : ''}${+isW(text[p - 1])}${+isW(text[p])}${text[p - 1] === '\n' ? 'n' : ''}${text[p] === '\n' ? 'N' : ''}`
      : '';
  const keyOf = (list: Th2[], m: boolean, p: number): string =>
    `${list.map((t) => t.pc).join(',')}|${m ? 1 : 0}|${ctx(p)}`;
  const push = (f: Omit<Frame, 'steps' | 'back' | 'mc' | 'states' | 'd'>): void => {
    if (fr.length < FRAME_MAX) fr.push({ ...f, d: 0, steps, back: 0, mc: matches.length, states });
  };
  let alpha: string[] | undefined, dsets: number[][] | undefined;
  if (kind === 'dfa') {
    /*
     * 先に全部作る（部分集合構成）。文章に出る文字とそれ以外の 1 文字（OTHER）で、たどり着ける状態をすべて作る。
     * 状態 1 つと文字 1 つの組ごとに 1 コマ記録し、比べた NFA の状態の数だけ比較を数える
     */
    const al = [...new Set(text), OTHER],
      ds: number[][] = [];
    alpha = al;
    dsets = ds;
    const start = (list: Th2[], m: boolean): Th2[] => {
      if (!m) closure(re, '', list, new Set(list.map((t) => t.pc)), 0, 0, [], 0, { n: 0 });
      return list;
    };
    const s0 = start([], false),
      q: [Th2[], boolean][] = [[s0, false]],
      index = new Map([[keyOf(s0, false, 0), 0]]);
    ds.push(s0.map((t) => t.pc));
    states = 1;
    for (let h = 0; h < q.length && !aborted; h++) {
      const [list, m] = q[h];
      for (let ci = 0; ci < al.length; ci++) {
        let nm = m;
        const nl: Th2[] = [],
          ns = new Set<number>(),
          hits: number[] = [];
        for (const t of list) {
          const I = P[t.pc];
          if (I.op === 'match') {
            nm = true;
            hits.push(2);
            break;
          }
          steps++;
          const hit = (I.test as Test)(al[ci]);
          hits.push(hit ? 1 : 0);
          if (hit) closure(re, '', nl, ns, t.pc + 1, 0, [], 0, { n: 0 });
        }
        start(nl, nm);
        const k = keyOf(nl, nm, 0);
        let to = nl.length ? (index.get(k) ?? -1) : -1,
          isNew = false;
        if (nl.length && to < 0) {
          to = index.size;
          index.set(k, to);
          q.push([nl, nm]);
          ds.push(nl.map((t) => t.pc));
          states = index.size;
          isNew = true;
        }
        push({
          k: 'build',
          pos: -1,
          st: 0,
          pc: -1,
          th: list.slice(0, hits.length).map((t) => ({ pc: t.pc, st: 0 })),
          hits,
          ci,
          ds: h,
          to,
          isNew,
        });
        if (states > DFA_MAX) {
          aborted = true;
          break;
        }
      }
    }
    if (aborted)
      return { ...empty, steps, states, aborted, unsup: `状態が ${DFA_MAX.toLocaleString('en-US')} 個を超えました。` };
  }
  while (from <= n && !aborted) {
    let clist: Th2[] = [],
      matched: Th2 | null = null;
    for (let pos = from; pos <= n; pos++) {
      if (steps >= STEP_MAX) {
        aborted = true;
        break;
      }
      const cnt = { n: 0 };
      if (!matched)
        closure(re, text, clist, new Set(clist.map((t) => t.pc)), 0, pos, new Array(re.ncap).fill(-1), pos, cnt);
      if (!clist.length) {
        if (matched) break;
        continue;
      }
      const key = keyOf(clist, !!matched, pos);
      let isNew = false;
      if (kind === 'ldfa' && !known.has(key)) {
        known.add(key);
        states++;
        isNew = true;
      }
      const tk = `${key}\u0000${text[pos] ?? ''}`,
        cached = kind === 'dfa' || (kind === 'ldfa' && cache.has(tk));
      const nlist: Th2[] = [],
        nseen = new Set<number>(),
        hits: number[] = [];
      let cut = clist.length;
      for (let k = 0; k < clist.length; k++) {
        const t = clist[k],
          I = P[t.pc];
        if (I.op === 'match') {
          /* 優先の低い状態は捨てる（左から先に書いた選択肢を選ぶ） */
          matched = t;
          cut = k + 1;
          hits.push(2);
          break;
        }
        if (!cached) steps++;
        const hit = pos < n && (I.test as Test)(text[pos]);
        hits.push(hit ? 1 : 0);
        if (hit) closure(re, text, nlist, nseen, t.pc + 1, t.st, t.caps, pos + 1, cnt);
      }
      if (cached) steps++;
      if (kind === 'ldfa' && !cached) cache.add(tk);
      if (kind === 'nfa') steps += cnt.n;
      if (clist.length > maxTh) maxTh = clist.length;
      push({
        k: hits.at(-1) === 2 ? 'match' : 'nfa',
        pos,
        st: from,
        pc: -1,
        th: clist.slice(0, cut).map((t) => ({ pc: t.pc, st: t.st })),
        hits,
        isNew,
        cached,
      });
      if (pos === n) break;
      clist = nlist;
      if (!clist.length && matched) break;
    }
    if (!matched) break;
    const m = matched as Th2,
      s = m.caps[0],
      e = m.caps[1] >= 0 ? m.caps[1] : s;
    matches.push({ s, e, caps: m.caps });
    push({ k: 'found', pos: e, st: s, pc: -1, th: [] });
    from = e > s ? e : e + 1;
  }
  return {
    fr,
    steps,
    back: 0,
    matches,
    aborted,
    maxTh,
    states: kind === 'nfa' ? undefined : states,
    maxDepth: 0,
    alpha,
    dsets,
  };
}

export type EngineId = 'bt' | 'memo' | 'nfa' | 'ldfa' | 'dfa';
export interface Engine {
  id: EngineId;
  name: string;
  /** 使われている所 */
  who: string;
  run: (re: Regex, text: string) => Run;
}
export const ENGINES: readonly Engine[] = [
  {
    id: 'bt',
    name: 'バックトラック',
    who: 'JavaScript・Python・Perl・Java・PCRE',
    run: (re, t) => runBT(re, t, false),
  },
  /* Ruby と同じく後方参照があればメモ化しない */
  { id: 'memo', name: 'バックトラック＋メモ化', who: 'Ruby 3.2 以降', run: (re, t) => runBT(re, t, !re.hasRef) },
  {
    id: 'nfa',
    name: 'NFA シミュレーション',
    who: 'Thompson 1968・Pike VM（RE2・Go）',
    run: (re, t) => runNFA(re, t, 'nfa'),
  },
  { id: 'ldfa', name: '遅延 DFA', who: 'RE2・Rust の regex・GNU grep', run: (re, t) => runNFA(re, t, 'ldfa') },
  { id: 'dfa', name: 'DFA', who: 'lex・flex', run: (re, t) => runNFA(re, t, 'dfa') },
];
export const engineOf = (id: string): Engine | undefined => ENGINES.find((e) => e.id === id);

export interface Preset {
  name: string;
  pat: string;
  text: string;
  rep: string;
}
export const PRESETS: readonly Preset[] = [
  { name: '郵便番号', pat: '\\d{3}-\\d{4}', text: '〒100-0001 千代田区\n〒530-0001 大阪市北区', rep: '[$&]' },
  { name: '日付', pat: '(\\d{4})/(\\d{1,2})/(\\d{1,2})', text: '提出 2026/11/8 締切 2026/12/25', rep: '$1年$2月$3日' },
  { name: '最長一致', pat: '<.+>', text: '<b>太字</b>と<i>斜体</i>', rep: '' },
  { name: '最短一致', pat: '<.+?>', text: '<b>太字</b>と<i>斜体</i>', rep: '' },
  { name: '選択', pat: 'gr(a|e)y', text: 'gray grey groy', rep: 'gr$1i' },
  {
    name: 'メールアドレス',
    pat: '[\\w.]+@\\w+\\.\\w+',
    text: '連絡は info@example.com か sales@example.jp へ',
    rep: '***',
  },
  { name: '単語の重複', pat: '\\b(\\w+) \\1\\b', text: 'this is is a pen pen', rep: '$1' },
  { name: '破滅的バックトラック', pat: '(a+)+b', text: 'aaaaaaaaaaaa', rep: '' },
  { name: '状態の増加', pat: '(a|b)*a(a|b){4}', text: 'abbabaababba', rep: '' },
];

export interface Analysis {
  re: Regex;
  runs: Record<EngineId, Run>;
  matches: Match[];
}
/** パターンを読み、5 つの方式で照合する。一致はバックトラック（JavaScript と同じ規則）のもの */
export function analyze(pat: string, text: string, flags = ''): Analysis | ParseErr {
  const re = parseRe(pat, flags);
  if (isErr(re)) return re;
  const runs = {} as Record<EngineId, Run>;
  for (const e of ENGINES) runs[e.id] = e.run(re, text);
  return { re, runs, matches: runs.bt.matches };
}

/** 置換。$1〜$9 と $& を使える。parts は置き換えた部分の範囲（結果の中の位置） */
export function replaceAll(
  text: string,
  ms: readonly Match[],
  rep: string,
): { out: string; parts: [number, number][] } {
  let out = '',
    last = 0;
  const parts: [number, number][] = [];
  for (const m of ms) {
    out += text.slice(last, m.s);
    const a = out.length;
    out += rep.replace(/\$(\d|&)/g, (_, d: string) => {
      if (d === '&') return text.slice(m.s, m.e);
      const g = Number(d),
        x = m.caps[2 * g],
        y = m.caps[2 * g + 1];
      return x >= 0 && y >= 0 ? text.slice(x, y) : '';
    });
    parts.push([a, out.length]);
    last = m.e;
  }
  return { out: out + text.slice(last), parts };
}

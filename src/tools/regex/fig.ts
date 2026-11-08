/**
 * 正規表現のページの図。同じコマを 3 つの描き方で描く。
 * 状態図: パターンを丸と矢印にし、今の状態を光らせる。対応の線: パターンの部品と文章の文字を線で結ぶ。
 * 表: 横に文章の位置、縦にパターンの部品を並べ、バックトラックの道すじと NFA の状態を描く。
 * 図の下（表では上）にいつも文章の帯を置く。長い文章は今の位置のまわりだけを見せる
 */
import { type Frame, OTHER, type Regex, type RNode, type Run } from './model';

export type View = 'state' | 'line' | 'table';
export interface FigData {
  re: Regex;
  text: string;
  run: Run;
  /** コマの番号 */
  i: number;
  /** 比較の枠・しくみの小さな図 */
  mini: boolean;
  /** 状態図の配置（描き方を変えたら捨てる） */
  lay?: Lay;
}

const C = {
  ink: '',
  ink2: '',
  ink3: '',
  bad: '',
  grid: '',
  line2: '',
  sans: '',
  mono: '',
  surface: '',
  cmp: '',
  mov: '',
  done: '',
  node: '',
  line: '',
  past: '',
  onMov: '',
  onCmp: '',
  onDone: '',
};
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    v = (k: string) => s.getPropertyValue(k).trim();
  Object.assign(C, {
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    bad: v('--warn'),
    grid: v('--grid'),
    line2: v('--line-2'),
    sans: v('--sans'),
    mono: v('--mono'),
    surface: v('--surface'),
    cmp: v('--rx-cmp'),
    mov: v('--rx-mov'),
    done: v('--rx-done'),
    node: v('--rx-node'),
    line: v('--rx-line'),
    past: v('--rx-past'),
    onMov: v('--rx-on-mov'),
    onCmp: v('--rx-on-cmp'),
    onDone: v('--rx-on-done'),
  });
}

type G = CanvasRenderingContext2D;
function txt(
  g: G,
  t: string,
  x: number,
  y: number,
  color: string,
  size = 13,
  weight = 700,
  al: CanvasTextAlign = 'center',
  font = C.sans,
): void {
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = al;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(t, x, y);
}
const tw = (g: G, t: string, size: number): number => {
  g.font = `700 ${size}px ${C.mono}`;
  return g.measureText(t).width;
};
const rr = (g: G, x: number, y: number, w: number, h: number, r = 4): void => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};
/** 改行と空白は記号で見せる */
const shown = (ch: string): string => (ch === '\n' ? '↵' : ch === ' ' ? '␣' : ch);
const labOf = (re: Regex, n: RNode): string => re.src.slice(n.s, n.e);

/* ---------- コマから読む値 ---------- */
const frameAt = (run: Run, i: number): Frame => run.fr[Math.max(0, Math.min(i, run.fr.length - 1))];
/** 今の照合を始めたコマ（NFA は一致を確定したコマの手前から） */
function attemptStart(run: Run, i: number): number {
  for (let k = run.fr[i]?.k === 'found' ? i - 1 : i; k >= 0; k--) {
    const f = run.fr[k];
    if (f.k === 'start' || f.k === 'build' || f.k === 'found') return k;
  }
  return 0;
}
/** バックトラックの今の対応: 開始位置からのコマを追い、後戻りした所から先を外す */
function alignOf(run: Run, i: number): { pc: number; pos: number; len: number; k: number }[] {
  const al: { pc: number; pos: number; len: number; k: number }[] = [];
  for (let k = attemptStart(run, i); k <= i; k++) {
    const f = run.fr[k];
    if (f.k === 'ok' || f.k === 'aok') al.push({ pc: f.pc, pos: f.pos, len: f.len ?? (f.k === 'aok' ? 0 : 1), k });
    else if (f.k === 'back')
      while (al.length) {
        const a = al[al.length - 1];
        if (a.pos > f.pos || (a.pos === f.pos && a.len === 0)) al.pop();
        else break;
      }
  }
  return al;
}
/** 後戻りした先で次に比べる命令 */
function nextAtom(re: Regex, pc: number): number {
  for (let k = 0, p = pc; k < 200 && p >= 0 && p < re.P.length; k++) {
    const I = re.P[p];
    if (I.op === 'split' || I.op === 'jmp') p = I.x ?? -1;
    else if (I.op === 'ch' || I.op === 'as' || I.op === 'ref' || I.op === 'match') return p;
    else p++;
  }
  return -1;
}
/** 図の左上の一言 */
export function narrate(re: Regex, text: string, f: Frame, alpha?: readonly string[]): string {
  const lab = (pc: number) => {
      const I = re.P[pc];
      return I?.op === 'match' ? '一致' : I?.node ? labOf(re, I.node) : '';
    },
    ch = (p: number) => (p < text.length ? `「${shown(text[p])}」` : '終わり');
  switch (f.k) {
    case 'start':
      return `開始位置 ${f.pos}`;
    case 'ok':
      return `${lab(f.pc)} と ${ch(f.pos)} 一致`;
    case 'aok':
      return `${lab(f.pc)} 成立`;
    case 'ng':
      return re.P[f.pc].op === 'as' ? `${lab(f.pc)} 不成立` : `${lab(f.pc)} と ${ch(f.pos)} 不一致`;
    case 'memo':
      return `位置 ${f.pos} は失敗済み`;
    case 'back':
      return `後戻り → 位置 ${f.pos}`;
    case 'fail':
      return `開始位置 ${f.pos} で見つからず`;
    case 'build': {
      const c = alpha?.[f.ci ?? 0],
        to = f.to ?? -1,
        cs = c === OTHER || c === undefined ? 'ほかの文字' : `「${shown(c)}」`;
      return `DFA の作成 S${f.ds} に${cs} → ${to >= 0 ? `S${to}` : 'なし'}${f.isNew ? '（新しい状態）' : ''}`;
    }
    case 'match':
      if (!f.th) return `一致 ${f.st}〜${f.pos}`;
      break;
    case 'found':
      return `一致 ${f.st}〜${f.pos}`;
  }
  const tag = f.isNew ? '（新しい状態）' : f.cached ? '（表を参照）' : '';
  return `位置 ${f.pos} ${ch(f.pos)} 状態 ${f.th?.length ?? 0} 個${tag}`;
}

/* ---------- 文章の帯 ---------- */
interface Cols {
  a: number;
  b: number;
  cw: number;
  x: (p: number) => number;
  vis: (p: number) => boolean;
}
/** 文章の帯の列。入り切らなければ今の位置のまわりだけ。最後の 1 列は文章の終わり */
function stripCols(text: string, x0: number, w: number, pos: number, mini: boolean): Cols {
  return slotCols(text.length + 1, x0, w, pos, mini);
}
/** n 列。入り切らなければ pos のまわりだけ */
function slotCols(slots: number, x0: number, w: number, pos: number, mini: boolean): Cols {
  const minW = mini ? 13 : 19,
    maxW = mini ? 24 : 34;
  let a = 0,
    k = slots;
  if (slots * minW > w) {
    k = Math.max(4, Math.floor(w / minW));
    a = Math.max(0, Math.min(slots - k, pos - Math.floor(k / 2)));
  }
  const cw = Math.min(maxW, w / k),
    ox = x0 + (w - cw * k) / 2;
  return { a, b: a + k, cw, x: (p) => ox + (p - a) * cw, vis: (p) => p >= a && p < a + k };
}
/** 文章の帯の列。DFA の作成中は試す文字の列 */
function colsFor(d: FigData, f: Frame, x0: number, w: number): Cols {
  const al = d.run.alpha;
  return f.k === 'build' && al
    ? slotCols(al.length, x0, w, f.ci ?? 0, d.mini)
    : stripCols(d.text, x0, w, f.pos, d.mini);
}
/** DFA の作成中の帯: 試す文字を並べ、今の文字を塗る。最後は文章に出ない文字をまとめた「他」 */
function drawAlpha(g: G, d: FigData, f: Frame, y: number, h: number, cols: Cols): void {
  const al = d.run.alpha ?? [],
    fs = d.mini ? 13 : 15;
  for (let p = cols.a; p < Math.min(cols.b, al.length); p++) {
    const x = cols.x(p),
      w = cols.cw - (d.mini ? 1.5 : 2.5),
      cur = p === f.ci,
      c = al[p],
      lab = c === OTHER ? '他' : shown(c);
    rr(g, x, y, w, h, 3);
    if (cur) {
      g.fillStyle = C.cmp;
      g.fill();
    } else {
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.stroke();
    }
    const big = lab.charCodeAt(0) > 255 ? fs - 2 : fs;
    txt(g, lab, x + w / 2, y + h / 2 + 0.5, cur ? C.onCmp : C.ink2, big, 700, 'center', c === OTHER ? C.sans : C.mono);
  }
  if (!d.mini && cols.x(cols.a) > 90) txt(g, '試す文字', cols.x(cols.a) - 10, y + h / 2, C.ink3, 12, 500, 'right');
}
function drawStrip(g: G, d: FigData, f: Frame, y: number, h: number, cols: Cols, idx = true): void {
  if (f.k === 'build') {
    drawAlpha(g, d, f, y, h, cols);
    return;
  }
  const { text, run, mini } = d,
    ms = run.matches.slice(0, f.mc),
    fs = mini ? 13 : 15,
    nfa = !!f.th,
    span = !nfa && f.k !== 'fail' && f.k !== 'match' ? [f.st, f.pos] : null;
  for (let p = cols.a; p < cols.b; p++) {
    const x = cols.x(p),
      w = cols.cw - (mini ? 1.5 : 2.5);
    if (p === text.length) {
      g.fillStyle = C.line2;
      g.fillRect(x + w / 2 - 1, y + 3, 2, h - 6);
      if (p === f.pos) {
        g.fillStyle = f.k === 'ng' ? C.bad : C.cmp;
        g.fillRect(x + w / 2 - 2, y, 4, h);
      }
      continue;
    }
    const inM = ms.some((m) => p >= m.s && p < m.e),
      isCur = p === f.pos && (f.k === 'ok' || f.k === 'ng' || f.k === 'nfa' || (f.k === 'match' && nfa));
    rr(g, x, y, w, h, 3);
    let fg = C.ink;
    if (isCur && f.k === 'ng') {
      g.fillStyle = C.bad;
      g.fill();
      fg = C.surface;
    } else if (isCur) {
      g.fillStyle = C.cmp;
      g.fill();
      fg = C.onCmp;
    } else if (inM) {
      g.fillStyle = C.done;
      g.fill();
      fg = C.onDone;
    } else if (span && p >= span[0] && p < span[1]) {
      g.fillStyle = C.node;
      g.fill();
    } else {
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.stroke();
      fg = C.ink2;
    }
    const ch = text[p],
      blank = ch === ' ' || ch === '\n';
    txt(
      g,
      shown(ch),
      x + w / 2,
      y + h / 2 + 0.5,
      blank && !isCur && !inM ? C.ink3 : fg,
      ch.charCodeAt(0) > 255 ? fs - 2 : fs,
      700,
      'center',
      C.mono,
    );
  }
  if (!mini && idx)
    for (let p = cols.a; p <= Math.min(cols.b - 1, text.length); p++)
      if (p % 5 === 0) txt(g, String(p), cols.x(p) + 1, y + h + 9, C.ink3, 11, 500, 'left', C.mono);
  if (cols.a > 0) txt(g, '…', cols.x(cols.a) - 6, y + h / 2, C.ink3, 13);
  if (cols.b < text.length + 1) txt(g, '…', cols.x(cols.b) + 4, y + h / 2, C.ink3, 13);
}
function narr(g: G, d: FigData, f: Frame): void {
  const bad = f.k === 'ng' || f.k === 'back' || f.k === 'memo',
    good = f.k === 'match' || f.k === 'found';
  txt(
    g,
    narrate(d.re, d.text, f, d.run.alpha),
    10,
    d.mini ? 11 : 15,
    bad ? C.bad : good ? C.done : C.ink,
    d.mini ? 12 : 13.5,
    700,
    'left',
  );
}

/** 今のコマで光らせる部品: 節の id（一致は 'END'）→ 色の種類 */
type Hot = 'cmp' | 'bad' | 'mov' | 'thx' | 'done';
function hotNodes(re: Regex, f: Frame): Map<number | 'END', Hot> {
  const hot = new Map<number | 'END', Hot>(),
    idOf = (pc: number): number | 'END' | undefined =>
      pc < 0 ? undefined : re.P[pc].op === 'match' ? 'END' : re.P[pc].node?.id;
  const set = (pc: number, v: Hot) => {
    const id = idOf(pc);
    if (id !== undefined) hot.set(id, v);
  };
  if (f.th?.length)
    f.th.forEach((t, k) => {
      const id = idOf(t.pc);
      if (id === undefined) return;
      const h = f.hits?.[k],
        v: Hot = h === 2 ? 'done' : h === 1 ? 'cmp' : h === 0 ? 'thx' : 'mov',
        was = hot.get(id);
      if (was !== 'cmp' && was !== 'done') hot.set(id, v);
    });
  else if (f.k === 'ok' || f.k === 'aok') set(f.pc, 'cmp');
  else if (f.k === 'ng') set(f.pc, 'bad');
  else if (f.k === 'memo') set(nextAtom(re, f.pc), 'bad');
  else if (f.k === 'back') set(nextAtom(re, f.pc), 'mov');
  else if (f.k === 'match' || f.k === 'found') hot.set('END', 'done');
  return hot;
}
const fillOf = (h: Hot | undefined): string | null =>
  h === 'cmp' ? C.cmp : h === 'bad' ? C.bad : h === 'mov' || h === 'thx' ? C.mov : h === 'done' ? C.done : null;
const inkOf = (h: Hot | undefined): string =>
  h === 'cmp'
    ? C.onCmp
    : h === 'bad'
      ? C.surface
      : h === 'mov' || h === 'thx'
        ? C.onMov
        : h === 'done'
          ? C.onDone
          : C.ink;

/* ---------- 状態図の配置 ---------- */
interface LNode {
  id: number | 'S' | 'END';
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lab: string;
}
interface Wire {
  pts: [number, number][];
  arrow: boolean;
  mid?: boolean;
}
export interface Lay {
  nodes: LNode[];
  wires: Wire[];
  boxes: { x: number; y: number; w: number; h: number; n: number }[];
  labs: { t: string; x: number; y: number }[];
  w: number;
  h: number;
}
interface Size {
  w: number;
  h: number;
  cy: number;
  ms?: Size[];
  b?: Size;
  B?: number;
  px?: number;
  top?: number;
  lt?: number;
  skip?: boolean;
  loop?: boolean;
  lab?: string;
}
type LN = RNode | { t: 'START' | 'END'; id: 'S' | 'END'; s: 0; e: 0 };
const ATOM = new Set(['ch', 'bol', 'eol', 'wb', 'nwb', 'ref']);
/** 構文木から丸と矢印の配置を決める（連結は横、選択は縦、繰り返しは下の回り道、0 回もよければ上の抜け道） */
function layout(g: G, re: Regex): Lay {
  const A = 34,
    G0 = 24;
  const memo = new Map<LN, Size>();
  const m = (n: LN): Size => {
    let s = memo.get(n);
    if (!s) {
      s = size(n);
      memo.set(n, s);
    }
    return s;
  };
  function size(n: LN): Size {
    if (n.t === 'START') return { w: 12, h: A, cy: A / 2 };
    if (n.t === 'END') return { w: 34, h: A, cy: A / 2 };
    const r = n as RNode;
    if (ATOM.has(r.t)) return { w: Math.max(A, tw(g, labOf(re, r), 15) + 16), h: A, cy: A / 2 };
    if (r.t === 'cat') {
      const xs = r.xs ?? [];
      if (!xs.length) return { w: 18, h: A, cy: A / 2 };
      const ms = xs.map(m),
        cy = Math.max(...ms.map((q) => q.cy)),
        bl = Math.max(...ms.map((q) => q.h - q.cy));
      return { w: ms.reduce((s, q) => s + q.w, 0) + G0 * (ms.length - 1), h: cy + bl, cy, ms };
    }
    if (r.t === 'alt') {
      const ms = (r.xs ?? []).map(m),
        B = 24,
        h = ms.reduce((s, q) => s + q.h, 0) + 10 * (ms.length - 1);
      return { w: Math.max(...ms.map((q) => q.w)) + 2 * B, h, cy: h / 2, ms, B };
    }
    if (r.t === 'rep') {
      const b = m(r.x as RNode),
        min = r.min ?? 0,
        max = r.max ?? Infinity,
        px = 16,
        skip = min === 0,
        loop = max > 1,
        std = (min <= 1 && max === Infinity) || (min === 0 && max === 1),
        lab = `${std ? '' : max === Infinity ? `${min} 回以上` : min === max ? `${min} 回` : `${min}〜${max} 回`}${r.lazy ? `${std ? '' : ' '}最短` : ''}`,
        top = skip ? 16 : 4,
        bot = (loop ? 16 : 4) + (lab ? 14 : 0);
      return { w: b.w + 2 * px, h: top + b.h + bot, cy: top + b.cy, b, px, top, skip, loop, lab };
    }
    if (r.t === 'grp') {
      const b = m(r.x as RNode),
        lt = r.n ? 17 : 7;
      return { w: b.w + 16, h: b.h + lt + 7, cy: lt + b.cy, b, lt };
    }
    return { w: 10, h: A, cy: A / 2 };
  }
  const root: RNode = {
    id: -1,
    t: 'cat',
    s: 0,
    e: 0,
    xs: [
      { t: 'START', id: 'S', s: 0, e: 0 } as unknown as RNode,
      re.ast,
      { t: 'END', id: 'END', s: 0, e: 0 } as unknown as RNode,
    ],
  };
  const out: Lay = { nodes: [], wires: [], boxes: [], labs: [], w: 0, h: 0 };
  const wire = (pts: [number, number][], arrow = true) => out.wires.push({ pts, arrow });
  function place(n: LN, x: number, y: number): void {
    const s = m(n),
      ey = y + s.cy,
      r = n as RNode;
    if (r.t === 'cat' && r.xs?.length) {
      let cx = x;
      r.xs.forEach((c, k) => {
        const cs = (s.ms as Size[])[k];
        if (k)
          wire([
            [cx - G0, ey],
            [cx, ey],
          ]);
        place(c, cx, ey - cs.cy);
        cx += cs.w + G0;
      });
    } else if (r.t === 'cat')
      wire(
        [
          [x, ey],
          [x + s.w, ey],
        ],
        false,
      );
    else if (r.t === 'alt') {
      let cy = y;
      const B = s.B as number,
        xm = x + B / 2,
        xr = x + s.w - B / 2;
      (r.xs ?? []).forEach((c, k) => {
        const cs = (s.ms as Size[])[k],
          yy = cy + cs.cy;
        wire([
          [x, ey],
          [xm, ey],
          [xm, yy],
          [x + B, yy],
        ]);
        place(c, x + B, cy);
        wire(
          [
            [x + B + cs.w, yy],
            [xr, yy],
            [xr, ey],
            [x + s.w, ey],
          ],
          false,
        );
        cy += cs.h + 10;
      });
    } else if (r.t === 'rep') {
      const px = s.px as number,
        b = s.b as Size,
        bx = x + px,
        by = y + (s.top as number),
        yb = by + b.h + 7;
      wire([
        [x, ey],
        [bx, ey],
      ]);
      place(r.x as RNode, bx, by);
      wire(
        [
          [bx + b.w, ey],
          [x + s.w, ey],
        ],
        false,
      );
      const xl = x + px * 0.45,
        xr = bx + b.w + px * 0.55;
      if (s.loop)
        out.wires.push({
          pts: [
            [bx + b.w, ey],
            [xr, ey],
            [xr, yb],
            [xl, yb],
            [xl, ey],
            [bx, ey],
          ],
          arrow: true,
          mid: true,
        });
      if (s.skip)
        out.wires.push({
          pts: [
            [xl, ey],
            [xl, y + 5],
            [xr, y + 5],
            [xr, ey],
          ],
          arrow: true,
          mid: true,
        });
      if (s.lab) out.labs.push({ t: s.lab, x: x + s.w / 2, y: yb + (s.loop ? 11 : 4) });
    } else if (r.t === 'grp') {
      const b = s.b as Size,
        lt = s.lt as number;
      out.boxes.push({ x: x + 2, y: y + 2, w: s.w - 4, h: s.h - 4, n: r.n ?? 0 });
      wire(
        [
          [x, ey],
          [x + 8, ey],
        ],
        false,
      );
      place(r.x as RNode, x + 8, y + lt);
      wire(
        [
          [x + 8 + b.w, ey],
          [x + s.w, ey],
        ],
        false,
      );
    } else {
      const k = (n as { t: string }).t;
      out.nodes.push({
        id: (n as { id: number | 'S' | 'END' }).id,
        kind: k,
        x,
        y,
        w: s.w,
        h: s.h,
        lab: k === 'START' || k === 'END' ? '' : labOf(re, r),
      });
    }
  }
  place(root, 0, 0);
  const r = m(root);
  out.w = r.w;
  out.h = r.h;
  return out;
}
function drawWire(g: G, w: Wire, color: string): void {
  const p = w.pts;
  g.beginPath();
  g.moveTo(p[0][0], p[0][1]);
  for (let k = 1; k < p.length; k++) {
    if (k < p.length - 1) {
      const r = Math.min(
        6,
        Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]) / 2,
        Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]) / 2,
      );
      g.arcTo(p[k][0], p[k][1], p[k + 1][0], p[k + 1][1], r || 0.01);
    } else g.lineTo(p[k][0], p[k][1]);
  }
  g.strokeStyle = color;
  g.lineWidth = 1.4;
  g.stroke();
  if (!w.arrow) return;
  /* 矢じり: 回り道と抜け道は真ん中の区間、ほかは終点 */
  let a: [number, number], b: [number, number];
  if (w.mid) {
    const k = Math.floor((p.length - 1) / 2);
    a = [(p[k][0] + p[k + 1][0]) / 2, (p[k][1] + p[k + 1][1]) / 2];
    b = [a[0] + (p[k + 1][0] - p[k][0]) * 0.01, a[1] + (p[k + 1][1] - p[k][1]) * 0.01];
  } else {
    a = p[p.length - 2];
    b = p[p.length - 1];
  }
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]),
    L = 7;
  g.beginPath();
  g.moveTo(b[0], b[1]);
  g.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
  g.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
  g.closePath();
  g.fillStyle = color;
  g.fill();
}
const graphBox = (mini: boolean) => ({ stripH: mini ? 22 : 34, top: mini ? 26 : 40, bot: mini ? 20 : 48 });
const graphScale = (W: number, lay: Lay, mini: boolean) => Math.min(mini ? 0.9 : 1.7, (W - 24) / lay.w);

/* ---------- 状態図 ---------- */
function drawState(g: G, W: number, H: number, d: FigData): void {
  const { re, run, mini } = d,
    f = frameAt(run, d.i);
  d.lay ??= layout(g, re);
  const lay = d.lay,
    { stripH, top, bot } = graphBox(mini),
    avail = H - top - stripH - bot,
    sc = Math.min(graphScale(W, lay, mini), avail / lay.h),
    hot = hotNodes(re, f);
  g.save();
  g.translate((W - lay.w * sc) / 2, top + (avail - lay.h * sc) / 2);
  g.scale(sc, sc);
  for (const b of lay.boxes) {
    g.setLineDash([4, 3]);
    rr(g, b.x, b.y, b.w, b.h, 6);
    g.strokeStyle = C.line;
    g.lineWidth = 1.2;
    g.stroke();
    g.setLineDash([]);
    if (b.n) txt(g, `グループ ${b.n}`, b.x + 6, b.y + 8, C.ink3, 11, 700, 'left');
  }
  for (const w of lay.wires) drawWire(g, w, C.ink3);
  for (const l of lay.labs) txt(g, l.t, l.x, l.y, C.ink3, 11);
  for (const nd of lay.nodes) {
    const h = nd.id === 'S' ? undefined : hot.get(nd.id),
      cx = nd.x + nd.w / 2,
      cy = nd.y + nd.h / 2,
      fill = fillOf(h),
      fg = inkOf(h);
    if (nd.kind === 'START') {
      g.beginPath();
      g.arc(cx, cy, 5, 0, 7);
      g.fillStyle = C.ink2;
      g.fill();
      continue;
    }
    if (nd.kind === 'END') {
      g.beginPath();
      g.arc(cx, cy, 15, 0, 7);
      g.fillStyle = fill ?? C.surface;
      g.fill();
      g.strokeStyle = fill ?? C.ink2;
      g.lineWidth = 1.6;
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, 11, 0, 7);
      g.strokeStyle = fill ? fg : C.ink2;
      g.stroke();
      continue;
    }
    const isAs = nd.kind !== 'ch' && nd.kind !== 'ref';
    g.beginPath();
    if (nd.w <= 34.5) g.arc(cx, cy, 17, 0, 7);
    else g.roundRect(nd.x, nd.y, nd.w, nd.h, 17);
    g.fillStyle = fill ?? C.surface;
    g.fill();
    if (isAs && !fill) g.setLineDash([3, 2.5]);
    g.strokeStyle = h === 'thx' ? C.bad : (fill ?? C.line);
    g.lineWidth = h === 'thx' ? 2.4 : 1.4;
    g.stroke();
    g.setLineDash([]);
    txt(g, nd.lab, cx, cy + 0.5, fg, 15, 700, 'center', C.mono);
  }
  g.restore();
  const cols = colsFor(d, f, 10, W - 20);
  drawStrip(g, d, f, H - stripH - (mini ? 6 : 22), stripH, cols);
  if (f.k === 'build' && !mini) txt(g, `DFA の状態 ${f.states ?? 0} 個`, W - 10, top - 14, C.ink3, 12, 500, 'right');
  else if (f.th && !mini) txt(g, `${f.th.length} 個の状態を同時に追跡`, W - 10, top - 14, C.ink3, 12, 500, 'right');
  narr(g, d, f);
}

/* ---------- 表 ---------- */
function drawTable(g: G, W: number, H: number, d: FigData): void {
  const { re, run, mini } = d,
    f = frameAt(run, d.i),
    rows = re.atoms.length + 1,
    lw = mini ? 40 : 62,
    top = mini ? 22 : 30,
    hh = mini ? 20 : 30,
    foot = run.states !== undefined && !mini ? 18 : 4,
    rh = Math.min(mini ? 18 : 26, (H - top - hh - foot - 8) / rows),
    build = f.k === 'build' && !!run.dsets,
    nS = f.states ?? 1,
    cols = build ? slotCols(nS, lw, W - lw - 6, f.ds ?? 0, mini) : stripCols(d.text, lw, W - lw - 6, f.pos, mini),
    y0 = top + hh + 6,
    ry = (r: number) => y0 + r * rh + rh / 2,
    cx = (p: number) => cols.x(p) + cols.cw / 2,
    rowPc = (pc: number) => re.rowOf[pc] ?? -1;
  if (build) {
    /* DFA の作成中は列が DFA の状態。見出しは状態の番号 */
    for (let c = cols.a; c < Math.min(cols.b, nS); c++) {
      const color = c === f.ds ? C.cmp : c === f.to ? C.ink : C.ink3;
      txt(g, `S${c}`, cx(c), top + (hh - 4) / 2, color, mini ? 11 : 12.5, 700, 'center', C.mono);
    }
  } else drawStrip(g, d, f, top, hh - 4, cols, false);
  for (let r = 0; r < rows; r++) {
    const end = r === rows - 1;
    txt(
      g,
      end ? '一致' : labOf(re, re.atoms[r]),
      lw - 8,
      ry(r),
      end ? C.done : C.ink,
      end ? 12 : mini ? 13 : 14,
      700,
      'right',
      end ? C.sans : C.mono,
    );
    g.fillStyle = C.grid;
    g.fillRect(cols.x(cols.a), y0 + r * rh, cols.cw * (cols.b - cols.a), 1);
  }
  g.fillRect(cols.x(cols.a), y0 + rows * rh, cols.cw * (cols.b - cols.a), 1);
  for (let p = cols.a; p <= cols.b; p++) g.fillRect(cols.x(p), y0, 1, rows * rh);
  const cell = (p: number, r: number, color: string, inset = 1.5) => {
    if (!cols.vis(p) || r < 0) return;
    g.fillStyle = color;
    g.fillRect(cols.x(p) + inset, y0 + r * rh + inset, cols.cw - 2 * inset, rh - 2 * inset);
  };
  if (build) {
    /* 部分集合構成: DFA の状態ごとに、含む NFA の状態を塗る。今の状態は文字を試した結果、行き先は枠で囲む */
    const sets = run.dsets ?? [];
    for (let c = cols.a; c < Math.min(cols.b, nS); c++) {
      if (c === f.ds) continue;
      for (const pc of sets[c] ?? []) cell(c, rowPc(pc), C.past, 3);
    }
    (f.th ?? []).forEach((t, j) => {
      const h = f.hits?.[j];
      cell(f.ds ?? 0, rowPc(t.pc), h === 2 ? C.done : h === 1 ? C.cmp : C.bad);
    });
    const to = f.to ?? -1;
    if (to >= 0 && cols.vis(to)) {
      g.strokeStyle = C.cmp;
      g.lineWidth = 2;
      g.strokeRect(cols.x(to) + 1, y0 + 1, cols.cw - 2, rows * rh - 2);
      if (!mini) txt(g, f.isNew ? '新規' : '既存', cx(to), y0 + rows * rh + 10, f.isNew ? C.bad : C.ink3, 11);
    }
  } else if (f.th) {
    /* NFA・DFA: 位置ごとに今の状態をまとめて塗る */
    for (let k = attemptStart(run, d.i); k <= d.i; k++) {
      const q = run.fr[k];
      if (!q.th) continue;
      q.th.forEach((t, j) => {
        const r = rowPc(t.pc),
          h = q.hits?.[j];
        if (k === d.i) cell(q.pos, r, h === 2 ? C.done : h === 1 ? C.cmp : h === 0 ? C.bad : C.mov);
        else cell(q.pos, r, h === 2 ? C.done : C.past, 3);
      });
      if (run.states !== undefined && !mini && q.k !== 'build' && (q.isNew || k === d.i) && cols.vis(q.pos))
        txt(g, q.isNew ? '新規' : '参照', cx(q.pos), y0 + rows * rh + 10, q.isNew ? C.bad : C.ink3, 11);
    }
  } else {
    /* バックトラック: 今の開始位置からの道すじ。後戻りは破線 */
    const from = Math.max(attemptStart(run, d.i), d.i - 4000);
    let prev: [number, number] | null = null,
      broke = false;
    g.lineWidth = mini ? 1.3 : 1.8;
    for (let k = from; k <= d.i; k++) {
      const q = run.fr[k];
      if (q.k === 'back' || q.k === 'memo') {
        broke = true;
        if (q.k === 'memo') cell(q.pos, rowPc(nextAtom(re, q.pc)), C.bad, 4);
        continue;
      }
      if (q.k !== 'ok' && q.k !== 'ng' && q.k !== 'aok' && q.k !== 'match') continue;
      const pt: [number, number] = [cx(q.pos), ry(rowPc(q.pc))];
      if (prev) {
        g.beginPath();
        g.moveTo(prev[0], prev[1]);
        g.lineTo(pt[0], pt[1]);
        g.strokeStyle = broke ? C.bad : C.ink2;
        g.setLineDash(broke ? [3, 3] : []);
        g.stroke();
        g.setLineDash([]);
      }
      if (q.k === 'ng') {
        const s = Math.min(cols.cw, rh) * 0.22;
        g.strokeStyle = C.bad;
        g.beginPath();
        g.moveTo(pt[0] - s, pt[1] - s);
        g.lineTo(pt[0] + s, pt[1] + s);
        g.moveTo(pt[0] + s, pt[1] - s);
        g.lineTo(pt[0] - s, pt[1] + s);
        g.stroke();
        prev ??= pt;
      } else {
        g.beginPath();
        g.arc(pt[0], pt[1], mini ? 2 : 2.6, 0, 7);
        g.fillStyle = C.ink2;
        g.fill();
        prev = pt;
      }
      broke = false;
    }
    if (f.k === 'ok' || f.k === 'ng' || f.k === 'aok') cell(f.pos, rowPc(f.pc), f.k === 'ng' ? C.bad : C.cmp);
    if (f.k === 'back' || f.k === 'memo') cell(f.pos, rowPc(nextAtom(re, f.pc)), f.k === 'memo' ? C.bad : C.mov);
    if (f.k === 'match') cell(f.pos, rows - 1, C.done);
  }
  narr(g, d, f);
}

/* ---------- 対応の線 ---------- */
function drawLine(g: G, W: number, H: number, d: FigData): void {
  const { re, run, mini } = d,
    f = frameAt(run, d.i),
    src = re.src,
    py = mini ? 24 : 44,
    ph = mini ? 24 : 34,
    sh = mini ? 22 : 34,
    sy = H - sh - (mini ? 6 : 22),
    pcw = Math.min(mini ? 18 : 28, (W - 20) / Math.max(src.length, 1)),
    pox = (W - pcw * src.length) / 2,
    px = (k: number) => pox + k * pcw,
    atomOf = new Map(re.atoms.map((n) => [n.id, n])),
    hot = hotNodes(re, f),
    cols = colsFor(d, f, 10, W - 20),
    at = f.k === 'build' ? (f.ci ?? 0) : f.pos;
  /* パターンの文字: 部品ごとに 1 つの箱、括弧や繰り返しの記号は灰色の字 */
  const covered = new Array<boolean>(src.length).fill(false);
  for (const n of re.atoms) for (let k = n.s; k < n.e; k++) covered[k] = true;
  for (let k = 0; k < src.length; k++)
    if (!covered[k]) txt(g, src[k], px(k) + pcw / 2, py + ph / 2, C.ink3, mini ? 14 : 17, 700, 'center', C.mono);
  for (const n of re.atoms) {
    const h = hot.get(n.id),
      x = px(n.s) + 1,
      w = (n.e - n.s) * pcw - 2,
      fill = fillOf(h);
    rr(g, x, py, w, ph, 4);
    g.fillStyle = fill ?? C.node;
    g.fill();
    if (h === 'thx') {
      g.strokeStyle = C.bad;
      g.lineWidth = 2;
      g.stroke();
    }
    txt(g, src.slice(n.s, n.e), x + w / 2, py + ph / 2 + 0.5, inkOf(h), mini ? 13 : 15, 700, 'center', C.mono);
  }
  const ax = (pc: number) => {
    const id = re.P[pc]?.node?.id,
      n = id === undefined ? undefined : atomOf.get(id);
    return n ? px(n.s) + ((n.e - n.s) * pcw) / 2 : px(src.length) + 8;
  };
  const tx = (p: number) => cols.x(p) + (cols.cw - 2) / 2;
  const line = (x1: number, x2: number, color: string, dash: boolean, wd: number) => {
    const ym = py + ph + (sy - py - ph) * 0.5;
    g.beginPath();
    g.moveTo(x1, py + ph + 2);
    g.bezierCurveTo(x1, ym, x2, ym, x2, sy - 2);
    g.strokeStyle = color;
    g.lineWidth = wd;
    g.setLineDash(dash ? [4, 3] : []);
    g.stroke();
    g.setLineDash([]);
  };
  if (f.th) {
    f.th.forEach((t, k) => {
      if (re.P[t.pc].op === 'match' || !cols.vis(at)) return;
      const h = f.hits?.[k];
      line(ax(t.pc), tx(at), h === 1 ? C.cmp : h === 0 ? C.bad : C.mov, h === 0, h === 1 ? 2.2 : 1.4);
    });
  } else {
    for (const a of alignOf(run, d.i)) {
      const last = a.k === d.i;
      for (let q = 0; q < Math.max(1, a.len); q++)
        if (cols.vis(a.pos + q))
          line(
            ax(a.pc),
            tx(a.pos + q) - (a.len === 0 ? cols.cw / 2 : 0),
            last ? C.cmp : C.ink3,
            a.len === 0,
            last ? 2.4 : 1.4,
          );
    }
    if (f.k === 'ng' && cols.vis(f.pos)) line(ax(f.pc), tx(f.pos), C.bad, true, 2.2);
  }
  drawStrip(g, d, f, sy, sh, cols);
  if (!mini) {
    if (pox > 70) txt(g, 'パターン', 10, py + ph / 2, C.ink3, 12, 500, 'left');
    if (cols.x(cols.a) > 50) txt(g, '文章', 10, sy + sh / 2, C.ink3, 12, 500, 'left');
  }
  narr(g, d, f);
}

/** 図の高さ。状態図はパターンの形から決める */
function heightOf(g: G, view: View, d: FigData, W: number): number {
  const { re, mini } = d;
  if (view === 'table') return (mini ? 48 : 88) + (re.atoms.length + 1) * (mini ? 16 : 24);
  if (view === 'line') return mini ? 150 : 250;
  d.lay ??= layout(g, re);
  const b = graphBox(mini),
    h = b.top + d.lay.h * graphScale(W, d.lay, mini) + b.stripH + b.bot;
  return Math.round(Math.max(mini ? 130 : 230, Math.min(mini ? 230 : 480, h)));
}
const DRAW: Record<View, (g: G, W: number, H: number, d: FigData) => void> = {
  state: drawState,
  line: drawLine,
  table: drawTable,
};
/** キャンバスの大きさを合わせて描く */
export function paint(cv: HTMLCanvasElement, view: View, d: FigData): void {
  const dpr = window.devicePixelRatio || 1,
    W = cv.clientWidth || (cv.parentElement?.clientWidth ?? 300),
    g = cv.getContext('2d');
  if (!g) return;
  const H = d.run.unsup ? (d.mini ? 120 : 160) : heightOf(g, view, d, W);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = `${H}px`;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (d.run.unsup) {
    txt(g, d.run.unsup.replace(/。$/, ''), W / 2, H / 2, C.ink3, 14);
    return;
  }
  DRAW[view](g, W, H, d);
}

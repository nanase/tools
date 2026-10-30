/**
 * FFT のページの図（SVG と式の HTML を組み立てる）: バタフライ図・今のバタフライの拡大（複素平面）・
 * 図の下の式・入力の棒・演算の数のグラフ。値は文字列にして innerHTML で入れる（入る文字は数と固定の語だけ）
 */
import { plan } from '../spectrum/fft';
import { ops, twKind } from './count';
import { type Bf, type Flow, group, type Kind, tw } from './radix2';

/* ---------- 表記 ---------- */
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const sup = (n: number): string => [...String(n)].map((d) => SUP[+d]).join('');
export const big = (n: number): string => n.toLocaleString('ja-JP');
const bin = (i: number, m: number) => i.toString(2).padStart(m, '0');
/** 小数 2 桁（−0 は 0） */
const f2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Math.abs(r) < 0.005 ? '0' : String(r).replace('-', '−');
};
/** 複素数 a ± bi */
export function cf(re: number, im: number): string {
  const a = Math.abs(re) < 0.005 ? 0 : re,
    b = Math.abs(im) < 0.005 ? 0 : im;
  if (!b) return f2(a);
  const iu = (v: number) => (f2(v) === '1' ? 'i' : `${f2(v)}i`);
  if (!a) return `${b < 0 ? '−' : ''}${iu(Math.abs(b))}`;
  return `${f2(a)} ${b < 0 ? '−' : '+'} ${iu(Math.abs(b))}`;
}
/** 足す・引く相手は、負や複素数なら括弧に入れる */
const pc = (re: number, im: number) => {
  const s = cf(re, im);
  return s !== '0' && /^−|[+−] /.test(s) ? `(${s})` : s;
};
/** 回転因子 W_N^p（SVG は tspan、HTML は sub・sup。等幅の書体に上付きの数字がないため） */
const Ws = (N: number, p: number) =>
  `W<tspan dy="3" font-size="75%">${N}</tspan><tspan dy="-8" font-size="75%">${p}</tspan>`;
const Wh = (N: number, p: number) => `<i>W</i><sub>${N}</sub><sup>${p}</sup>`;
/** ビットの色: 上位から順に。並べ替えの後は逆の順 */
const BITC = ['var(--ch1)', 'var(--focus)', 'var(--ch2)', 'var(--accent)'];
const bits = (v: number, m: number, rev = false) =>
  [...bin(v, m)].map((d, p) => `<tspan fill="${BITC[rev ? m - 1 - p : p]}">${d}</tspan>`).join('');
const bitsH = (v: number, m: number) =>
  `<span class="ff-bits">${[...bin(v, m)].map((d, p) => `<span style="color:${BITC[p]}">${d}</span>`).join('')}</span>`;

/* ---------- 計算の記録 ---------- */
/** 列 c から次の列への操作 1 つ（並べ替えか、バタフライ 1 つ） */
export type Op = { t: 'rev'; c: number } | { t: 'bf'; c: number; s: number; b: Bf };
export interface Run {
  N: number;
  kind: Kind;
  f: Flow;
  /** 定義どおりの DFT（出力との差を見る） */
  ref: [Float64Array, Float64Array];
  ops: Op[];
  /** when[c][r]: 列 c の行 r の値を作る操作の番号（入力の列は −1） */
  when: Int32Array[];
}
export function record(f: Flow, ref: [Float64Array, Float64Array]): Run {
  const ops: Op[] = [],
    when = f.re.map(() => new Int32Array(f.N).fill(-1));
  f.steps.forEach((st, c) => {
    if (st.t === 'rev') {
      when[c + 1].fill(ops.length);
      ops.push({ t: 'rev', c });
    } else
      for (const b of st.bf) {
        when[c + 1][b.a] = when[c + 1][b.b] = ops.length;
        ops.push({ t: 'bf', c, s: st.s, b });
      }
  });
  return { N: f.N, kind: f.kind, f, ref, ops, when };
}
/** 図の今: 進み具合 pos（操作の数で、小数は線の上の途中）と、押した節点 */
export interface View {
  pos: number;
  sel: { c: number; r: number } | null;
}
const done = (R: Run, c: number, r: number, pos: number) => R.when[c][r] < Math.floor(pos);
const colMax = (f: Flow, c: number) => {
  let mx = 1e-9;
  for (let r = 0; r < f.N; r++) mx = Math.max(mx, Math.hypot(f.re[c][r], f.im[c][r]));
  return mx;
};

/* ---------- バタフライ図 ---------- */
interface Geo {
  W: number;
  /** 枠の幅（図がこれより広いと横にスクロールする） */
  W0: number;
  H: number;
  narrow: boolean;
  rh: number;
  rad: number;
  L: number;
  cols: number;
  x: (c: number) => number;
  y: (r: number) => number;
}
function geo(N: number, m: number, W0: number): Geo {
  const narrow = W0 < 620,
    W = narrow && N > 8 ? Math.max(W0, 460) : W0,
    rh = N > 8 ? (narrow ? 26 : 30) : N > 4 ? 42 : 56,
    rad = N > 8 ? (narrow ? 8 : 10) : narrow ? 10 : 13,
    L = narrow ? 40 : 92,
    R = narrow ? 56 : 132,
    T = 44,
    cols = m + 2;
  return {
    W,
    W0,
    H: T + rh * N + 10,
    narrow,
    rh,
    rad,
    L,
    cols,
    x: (c) => L + rad + (c * (W - L - R - 2 * rad)) / (cols - 1),
    y: (r) => T + rh * (r + 0.5),
  };
}
/** 列の見出し [名前, 中身] */
function colHead(R: Run, c: number): [string, string] {
  const { N, m, steps } = R.f,
    st = steps[c - 1];
  if (c === 0) return ['入力', `${N} 点`];
  if (st.t === 'rev') return ['並べ替え', R.kind === 'dit' ? `1 点 × ${N}` : `${N} 点`];
  const { size } = group(R.f, c, 0);
  return [
    `段 ${st.s}`,
    R.kind === 'dit' ? `${size} 点 × ${N / size}` : c === m ? '1 点ずつ' : `残り ${size} 点 × ${N / size}`,
  ];
}
/** 描いた図の要素（毎フレーム書き換えるもの） */
export interface BfFig {
  g: Geo;
  nd: SVGGElement[];
  ln: SVGPathElement[];
  ob: SVGRectElement[];
  dots: SVGGElement;
}
/** 図の骨組みを作る（点の数・間引き・入力・幅が変わったとき）。W0 は枠の幅 */
export function buildBf(svg: SVGSVGElement, R: Run, W0: number): BfFig {
  const { N, m } = R.f,
    g = geo(N, m, W0),
    { rev } = plan(N);
  svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
  svg.style.width = g.W > g.W0 ? `${g.W}px` : '';
  svg.classList.toggle('nw', g.narrow);
  let h = '';
  /* 同じ部分 DFT に入る行の帯（1 つおき） */
  for (let c = 0; c < g.cols; c++) {
    const seen = new Set<number>();
    for (let r = 0; r < N; r++) {
      const { lo, size } = group(R.f, c, r);
      if (seen.has(lo) || size === 1 || size === N) continue;
      seen.add(lo);
      if ((lo / size) % 2 === 0)
        h += `<rect class="ff-band" x="${g.x(c) - g.rad - 5}" y="${g.y(lo) - g.rh / 2 + 2}" width="${2 * g.rad + 10}" height="${g.rh * size - 4}" rx="5"/>`;
    }
    const [a, b] = colHead(R, c);
    h += `<text class="hd" x="${g.x(c)}" y="17" text-anchor="middle">${a}</text><text class="hs" x="${g.x(c)}" y="32" text-anchor="middle">${b}</text>`;
  }
  h += `<text class="hd" x="${g.W - 8}" y="17" text-anchor="end">出力</text>`;
  /* 線（後から描くものが上） */
  R.ops.forEach((o, i) => {
    const x0 = g.x(o.c) + g.rad,
      x1 = g.x(o.c + 1) - g.rad;
    if (o.t === 'rev') {
      for (let r = 0; r < N; r++) h += `<path class="ff-ln" data-op="${i}" d="M${x0} ${g.y(rev[r])}L${x1} ${g.y(r)}"/>`;
      return;
    }
    const { a, b, p } = o.b;
    for (const [u, v] of [
      [a, a],
      [a, b],
      [b, b],
      [b, a],
    ])
      h += `<path class="ff-ln" data-op="${i}" data-s="${u === a ? 'a' : 'b'}" d="M${x0} ${g.y(u)}C${x0 + (x1 - x0) * 0.35} ${g.y(u)} ${x0 + (x1 - x0) * 0.65} ${g.y(v)} ${x1} ${g.y(v)}"/>`;
    const tri = twKind(N, p) === 'one' ? ' triv' : '',
      ty = g.y(b) + (g.narrow ? 11 : 13);
    h +=
      R.kind === 'dit'
        ? `<text class="tw${tri}" x="${x0 + 3}" y="${ty}">${Ws(N, p)}</text>`
        : `<text class="tw${tri}" x="${x1 - 3}" y="${ty}" text-anchor="end">${Ws(N, p)}</text>`;
    h += `<text class="ng" x="${x1 - 4}" y="${g.y(b) - 5}" text-anchor="end">−</text>`;
  });
  /* 番号（2 進数のビットに色）。並べ替えの前は上位から、後は逆の順の色 */
  const cb = R.kind === 'dit' ? 0 : m,
    ca = cb + 1,
    last = g.cols - 1;
  for (let r = 0; r < N; r++) {
    if (!g.narrow) h += `<text class="xl" x="6" y="${g.y(r) + 4}">x[${r}]</text>`;
    if (cb === 0) h += `<text x="${g.L - 6}" y="${g.y(r) + 4}" text-anchor="end">${bits(r, m)}</text>`;
    else if (!g.narrow)
      h += `<text x="${g.x(cb) - g.rad - 3}" y="${g.y(r) - g.rad + 1}" text-anchor="end" font-size="10">${bits(r, m)}</text>`;
    if (!(g.narrow && cb > 0))
      h += `<text x="${g.x(ca) + g.rad + 3}" y="${g.y(r) - g.rad + 1}" font-size="10">${bits(r, m, true)}</text>`;
    h += `<text class="xl" x="${g.x(last) + g.rad + 6}" y="${g.y(r) + 4}">${g.narrow ? r : `X[${r}]`}</text>`;
    if (!g.narrow)
      h += `<rect class="ff-ob" x="${g.x(last) + g.rad + 50}" y="${g.y(r) - 4}" width="0" height="8" rx="1"/>`;
  }
  /* 節点（円と、値の矢印） */
  for (let c = 0; c < g.cols; c++)
    for (let r = 0; r < N; r++)
      h += `<g class="ff-nd" data-c="${c}" data-r="${r}"><circle cx="${g.x(c)}" cy="${g.y(r)}" r="${g.rad}"/><line x1="${g.x(c)}" y1="${g.y(r)}" x2="${g.x(c)}" y2="${g.y(r)}"/></g>`;
  h += '<g class="ff-dots"></g>';
  svg.innerHTML = h;
  return {
    g,
    nd: [...svg.querySelectorAll<SVGGElement>('.ff-nd')],
    ln: [...svg.querySelectorAll<SVGPathElement>('.ff-ln')],
    ob: [...svg.querySelectorAll<SVGRectElement>('.ff-ob')],
    dots: svg.querySelector('.ff-dots') as SVGGElement,
  };
}
const cls = (el: Element, c: string) => {
  if (el.getAttribute('class') !== c) el.setAttribute('class', c);
};
/** 今の進み具合で、節点・線・出力の棒・線をたどる点を描く */
export function drawBf(B: BfFig, R: Run, V: View): void {
  const { g } = B,
    { f, ops } = R,
    n = ops.length,
    i0 = Math.floor(V.pos),
    fr = V.pos - i0,
    act = V.pos < n ? ops[i0] : null,
    mx = f.re.map((_, c) => colMax(f, c)),
    hl = V.sel ? R.when[V.sel.c][V.sel.r] : -2;
  for (const el of B.nd) {
    const c = +(el.dataset.c ?? 0),
      r = +(el.dataset.r ?? 0),
      on = c === 0 || done(R, c, r, V.pos),
      isAct = act && R.when[c][r] === i0,
      isSel = V.sel && V.sel.c === c && V.sel.r === r;
    cls(el, `ff-nd${on ? '' : ' off'}${isAct ? ' act' : ''}${isSel ? ' sel' : ''}`);
    const v = el.lastChild as SVGLineElement,
      k = on ? (g.rad - 2.5) / mx[c] : 0;
    v.setAttribute('x2', String(g.x(c) + k * f.re[c][r]));
    v.setAttribute('y2', String(g.y(r) - k * f.im[c][r]));
  }
  for (const el of B.ln) {
    const i = +(el.dataset.op ?? 0);
    cls(
      el,
      `ff-ln${i < i0 ? ' on' : ''}${act && i === i0 ? ` act${el.dataset.s === 'b' ? ' lb' : ''}` : ''}${i === hl ? ' hl' : ''}`,
    );
  }
  /* 出力の大きさ |X[k]|: 最後の列を通った行から */
  const cl = g.cols - 1,
    om = colMax(f, cl),
    bw = g.W - (g.x(cl) + g.rad + 50) - 10;
  B.ob.forEach((el, r) => {
    el.setAttribute(
      'width',
      String(done(R, cl, r, V.pos) ? Math.max(0.5, (bw * Math.hypot(f.re[cl][r], f.im[cl][r])) / om) : 0),
    );
  });
  /* 線をたどる点 */
  let d = '';
  if (act) {
    const x0 = g.x(act.c) + g.rad,
      x1 = g.x(act.c + 1) - g.rad,
      e = fr < 0.5 ? 2 * fr * fr : 1 - 2 * (1 - fr) * (1 - fr),
      X = x0 + (x1 - x0) * e;
    if (act.t === 'rev') {
      const { rev } = plan(R.N);
      for (let r = 0; r < R.N; r++)
        d += `<circle class="ff-dot" cx="${X}" cy="${g.y(rev[r]) + (g.y(r) - g.y(rev[r])) * e}" r="2.6"/>`;
    } else {
      /* 線は 3 次のベジエ（制御点は端と同じ高さ）なので、高さは 3e² − 2e³ */
      const { a, b } = act.b,
        s = 3 * e * e - 2 * e * e * e,
        rd = g.rad > 10 ? 4 : 3.2;
      for (const [u, v] of [
        [a, a],
        [a, b],
        [b, b],
        [b, a],
      ])
        d += `<circle class="ff-dot${u === b ? ' b' : ''}" cx="${X}" cy="${g.y(u) + (g.y(v) - g.y(u)) * s}" r="${rd}"/>`;
    }
  }
  B.dots.innerHTML = d;
}
/** 節点の要素から列と行 */
export function nodeAt(t: EventTarget | null): { c: number; r: number } | null {
  const n = (t as Element | null)?.closest?.<SVGGElement>('.ff-nd');
  return n ? { c: +(n.dataset.c ?? 0), r: +(n.dataset.r ?? 0) } : null;
}

/* ---------- 式（図の下） ---------- */
function explain(R: Run, i: number, row = -1): string {
  const o = R.ops[i],
    { N, m, re, im } = R.f;
  if (o.t === 'rev') {
    const { rev } = plan(N),
      rows = [...Array(N).keys()].filter((r) => rev[r] > r);
    return (
      '<div class="fx-h">並べ替え<small>行の番号を 2 進数で逆から読む。掛け算なし</small></div>' +
      `<div class="fx-r"><span class="t">入れ替え</span><span class="n w">${rows.map((r) => `${bitsH(rev[r], m)} ↔ ${bitsH(r, m)}`).join('　')}</span></div>` +
      `<div class="fx-r"><span class="t"></span><span class="n w q">${N - 2 * rows.length} 行は逆から読んでも同じ</span></div>`
    );
  }
  const { a, b, p } = o.b,
    [wr, wi] = tw(N, p),
    A: [number, number] = [re[o.c][a], im[o.c][a]],
    B: [number, number] = [re[o.c][b], im[o.c][b]],
    k = twKind(N, p),
    tk =
      k === 'one'
        ? '掛けなくてよい'
        : k === 'mi'
          ? '実部と虚部を入れ替えるだけ'
          : k === 'eighth'
            ? '実数の掛け算 2 回で済む'
            : '',
    W = `<span class="ew">${Wh(N, p)}</span>`,
    ea = '<span class="ea">a</span>',
    eb = '<span class="eb">b</span>',
    out = (r: number) => `<span class="er">${cf(re[o.c + 1][r], im[o.c + 1][r])}</span>`,
    lab = (r: number) => `<span class="t${row === r ? ' me' : ''}">行 ${r} ←</span>`;
  let h = `<div class="fx-h">段 ${o.s}・行 ${a} と ${b}<small>${ea} = ${cf(...A)}　${eb} = ${cf(...B)}　${W} = ${cf(wr, wi)}${tk ? `（${tk}）` : ''}</small></div>`;
  if (R.kind === 'dit') {
    const t: [number, number] = [B[0] * wr - B[1] * wi, B[0] * wi + B[1] * wr];
    h += `<div class="fx-r">${lab(a)}<span>${ea} + ${W}·${eb}</span><span class="n">= ${cf(...A)} + ${pc(...t)} = ${out(a)}</span></div>`;
    h += `<div class="fx-r">${lab(b)}<span>${ea} − ${W}·${eb}</span><span class="n">= ${cf(...A)} − ${pc(...t)} = ${out(b)}</span></div>`;
  } else {
    h += `<div class="fx-r">${lab(a)}<span>${ea} + ${eb}</span><span class="n">= ${cf(...A)} + ${pc(...B)} = ${out(a)}</span></div>`;
    h += `<div class="fx-r">${lab(b)}<span>(${ea} − ${eb})·${W}</span><span class="n">= (${cf(A[0] - B[0], A[1] - B[1])})·${pc(wr, wi)} = ${out(b)}</span></div>`;
  }
  return h;
}
/** 図の下の式: 押した節点 → その値を作った操作、なければ今の操作、終わったら定義どおりの DFT との差 */
export function fxHtml(R: Run, V: View): string {
  const { N, m, re, im } = R.f,
    n = R.ops.length;
  if (V.sel && V.sel.c > 0) return explain(R, R.when[V.sel.c][V.sel.r], V.sel.r);
  if (V.sel)
    return `<div class="fx-h">入力 x[${V.sel.r}]<small>${bitsH(V.sel.r, m)}</small></div><div class="fx-r"><span class="t">値</span><span class="n w"><span class="er">${cf(re[0][V.sel.r], im[0][V.sel.r])}</span></span></div>`;
  if (V.pos < n) return explain(R, Math.floor(V.pos));
  const cl = re.length - 1;
  let e = 0;
  for (let k = 0; k < N; k++) e = Math.max(e, Math.hypot(re[cl][k] - R.ref[0][k], im[cl][k] - R.ref[1][k]));
  return (
    `<div class="fx-h">完了<small>${m} 段 × ${N / 2} 個のバタフライ</small></div>` +
    `<div class="fx-r"><span class="t">掛け算</span><span class="n w"><span class="er">${(N / 2) * m} 回</span>　定義どおりなら ${N * N} 回</span></div>` +
    `<div class="fx-r"><span class="t">出力</span><span class="n w">定義どおりの DFT との差 ${e === 0 ? '0' : e.toExponential(1).replace(/e-(\d+)/, ' × 10<sup>−$1</sup>')}</span></div>`
  );
}

/* ---------- 拡大（今のバタフライを複素平面で） ---------- */
type Z = [number, number];
/** [始点, 終点, 色, 名前, 点線] */
type Vec = [Z, Z, string, string, string?];
/** 図の中身と、見出しに添える「段 s・行 a と b」 */
export function zoomSvg(R: Run, V: View): [string, string] {
  const { N, re, im } = R.f,
    n = R.ops.length,
    sel = V.sel && V.sel.c > 0 ? R.when[V.sel.c][V.sel.r] : -1,
    i0 = sel >= 0 ? sel : Math.min(Math.floor(V.pos), n - 1),
    fr = sel >= 0 || V.pos >= n ? 1 : V.pos - Math.floor(V.pos),
    o = R.ops[i0],
    cx = 150,
    cy = 150;
  let h = `<line class="ax" x1="8" x2="292" y1="${cy}" y2="${cy}"/><line class="ax" x1="${cx}" x2="${cx}" y1="8" y2="292"/><text x="288" y="${cy - 6}" text-anchor="end">実</text><text x="${cx + 6}" y="18">虚</text>`;
  if (o.t === 'rev')
    return [
      `${h}<text class="zh" x="${cx}" y="${cy - 30}" text-anchor="middle">並べ替え</text><text x="${cx}" y="${cy - 12}" text-anchor="middle">掛け算なし</text>`,
      '',
    ];
  const { a, b, p } = o.b,
    [wr, wi] = tw(N, p),
    A: Z = [re[o.c][a], im[o.c][a]],
    B: Z = [re[o.c][b], im[o.c][b]],
    mul = (z: Z): Z => [z[0] * wr - z[1] * wi, z[0] * wi + z[1] * wr],
    /* 3 つの動き: DIT は b を回す → 足す → 引く、DIF は足す → 引く → 差を回す */
    ph = Math.min(1, fr * 3),
    ph2 = Math.max(0, Math.min(1, fr * 3 - 1)),
    ph3 = Math.max(0, Math.min(1, fr * 3 - 2)),
    rot = (z: Z, k: number): Z => {
      const t = Math.atan2(wi, wr) * k,
        c = Math.cos(t),
        s = Math.sin(t);
      return [z[0] * c - z[1] * s, z[0] * s + z[1] * c];
    },
    O: Z = [0, 0];
  let vecs: Vec[], pts: Z[];
  if (R.kind === 'dit') {
    const t = mul(B),
      tb = rot(B, ph);
    vecs = [
      [O, A, 'var(--ink)', 'a'],
      [O, B, 'var(--ink-3)', 'b', '4 3'],
      [O, tb, 'var(--ch2)', ph >= 1 ? 'W·b' : ''],
    ];
    if (ph2 > 0) vecs.push([A, [A[0] + tb[0] * ph2, A[1] + tb[1] * ph2], 'var(--ch1)', ph2 >= 1 ? `行 ${a}` : '']);
    if (ph3 > 0)
      vecs.push([A, [A[0] - tb[0] * ph3, A[1] - tb[1] * ph3], 'var(--ch1)', ph3 >= 1 ? `行 ${b}` : '', '5 3']);
    pts = [A, B, t, [A[0] + t[0], A[1] + t[1]], [A[0] - t[0], A[1] - t[1]]];
  } else {
    const d: Z = [A[0] - B[0], A[1] - B[1]];
    vecs = [
      [O, A, 'var(--ink)', 'a'],
      [O, B, 'var(--ink-3)', 'b', '4 3'],
      [A, [A[0] + B[0] * ph, A[1] + B[1] * ph], 'var(--ch1)', ph >= 1 ? `行 ${a}` : ''],
    ];
    if (ph2 > 0)
      vecs.push([
        A,
        [A[0] - B[0] * ph2, A[1] - B[1] * ph2],
        'var(--ch1)',
        ph3 > 0 ? '' : ph2 >= 1 ? 'a − b' : '',
        '5 3',
      ]);
    if (ph3 > 0) vecs.push([O, rot(d, ph3), 'var(--ch2)', ph3 >= 1 ? `行 ${b}` : '']);
    pts = [A, B, [A[0] + B[0], A[1] + B[1]], d, mul(d)];
  }
  /* 縮尺: 全部の点が半径 125 に入り、大きさ 1 の円が見える */
  const k = 125 / Math.max(1, ...pts.map((z) => Math.hypot(z[0], z[1])));
  h += `<circle class="unit" cx="${cx}" cy="${cy}" r="${k}"/>`;
  for (let q = 0; q < N; q++) {
    const [xr, xi] = tw(N, q);
    h += `<circle class="twd${q === p ? ' on' : ''}" cx="${cx + k * xr}" cy="${cy - k * xi}" r="${q === p ? 4.5 : 2}"/>`;
  }
  h += `<text class="twl" x="${cx + k * wr + (wr >= 0 ? 7 : -7)}" y="${cy - k * wi + (wi > 0 ? -6 : 14)}" text-anchor="${wr >= 0 ? 'start' : 'end'}">${Ws(N, p)}</text>`;
  for (const [s, e, col, lab, dash] of vecs) {
    const x1 = cx + k * s[0],
      y1 = cy - k * s[1],
      x2 = cx + k * e[0],
      y2 = cy - k * e[1],
      an = Math.atan2(y2 - y1, x2 - x1),
      hx = (u: number) => 8 * Math.cos(an + u),
      hy = (u: number) => 8 * Math.sin(an + u);
    h += `<line class="vec" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    if (Math.hypot(x2 - x1, y2 - y1) > 6)
      h += `<path d="M${x2} ${y2}l${-hx(-0.4)} ${-hy(-0.4)}l${hx(-0.4) - hx(0.4)} ${hy(-0.4) - hy(0.4)}z" fill="${col}"/>`;
    if (lab) h += `<text class="vl" x="${x2 + 6}" y="${y2 - 6}" style="fill:${col}">${lab}</text>`;
  }
  h += '<text x="10" y="290" class="note">点線の円は大きさ 1</text>';
  return [h, `段 ${o.s}・行 ${a} と ${b}`];
}

/* ---------- 入力（棒をドラッグ） ---------- */
export const IN = { W: 420, H: 150, y0: 72, A: 56, L: 24 } as const;
export function inputSvg(re: ArrayLike<number>, im: ArrayLike<number>): string {
  const N = re.length,
    { W, H, y0, A, L } = IN,
    dx = (W - L - 10) / N;
  let h = `<line class="gr" x1="${L}" x2="${W - 6}" y1="${y0 - A}" y2="${y0 - A}"/><line class="gr" x1="${L}" x2="${W - 6}" y1="${y0 + A}" y2="${y0 + A}"/><line class="ax" x1="${L}" x2="${W - 6}" y1="${y0}" y2="${y0}"/><text x="4" y="${y0 - A + 4}">1</text><text x="0" y="${y0 + A + 4}">−1</text>`;
  for (let n = 0; n < N; n++) {
    const x = L + dx * (n + 0.5),
      yr = y0 - A * re[n],
      yi = y0 - A * im[n];
    if (im[n])
      h += `<line class="im-s" x1="${x + 4}" x2="${x + 4}" y1="${y0}" y2="${yi}"/><circle class="im-d" cx="${x + 4}" cy="${yi}" r="3"/>`;
    h += `<line class="re-s" x1="${x}" x2="${x}" y1="${y0}" y2="${yr}"/><circle class="re-d" cx="${x}" cy="${yr}" r="4.5"/><text x="${x}" y="${H - 4}" text-anchor="middle">${n}</text>`;
  }
  return h;
}
/** 入力の図の上の位置 → [行, 値]。行の外なら null */
export function inputAt(svg: SVGSVGElement, N: number, e: PointerEvent): [number, number] | null {
  const r = svg.getBoundingClientRect(),
    { W, H, y0, A, L } = IN,
    x = ((e.clientX - r.left) / r.width) * W,
    y = ((e.clientY - r.top) / r.height) * H,
    n = Math.floor((x - L) / ((W - L - 10) / N));
  if (n < 0 || n >= N) return null;
  return [n, Math.max(-1, Math.min(1, Math.round(((y0 - y) / A) * 20) / 20))];
}

/* ---------- 演算の数 ---------- */
export function countSvg(N: number, real: boolean): string {
  const W = 420,
    H = 230,
    L = 40,
    R = 12,
    T = 12,
    B = 28,
    ymax = 42,
    X = (k: number) => L + ((k - 1) / 19) * (W - L - R),
    Y = (v: number) => T + (1 - Math.log2(Math.max(1, v)) / ymax) * (H - T - B),
    cn = Math.log2(N),
    [a, b] = ops(N, real);
  let h = '';
  for (let e = 0; e <= ymax; e += 6)
    h += `<line class="gr" x1="${L}" x2="${W - R}" y1="${Y(2 ** e)}" y2="${Y(2 ** e)}"/><text class="tk" x="${L - 4}" y="${Y(2 ** e) + 3}" text-anchor="end">${e ? `2${sup(e)}` : '1'}</text>`;
  for (const k of [1, 4, 8, 12, 16, 20])
    h += `<line class="gr" x1="${X(k)}" x2="${X(k)}" y1="${T}" y2="${H - B}"/><text class="tk" x="${X(k)}" y="${H - B + 13}" text-anchor="middle">2${sup(k)}</text>`;
  h += `<text class="tk" x="${(W + L) / 2}" y="${H - 2}" text-anchor="middle">N</text>`;
  const path = (i: 0 | 1) => {
    let d = '';
    for (let k = 1; k <= 20; k += 0.25) d += `${d ? 'L' : 'M'}${X(k).toFixed(1)} ${Y(ops(2 ** k, real)[i]).toFixed(1)}`;
    return d;
  };
  h += `<path class="c-d" d="${path(0)}"/><path class="c-f" d="${path(1)}"/>`;
  h += `<text class="cl-d" x="${X(14)}" y="${Y(ops(2 ** 14, real)[0]) - 7}">${real ? '定義どおり' : 'N²'}</text><text class="cl-f" x="${X(15)}" y="${Y(ops(2 ** 15, real)[1]) + 15}">${real ? 'FFT' : '(N/2) log₂N'}</text>`;
  h += `<line class="cur" x1="${X(cn)}" x2="${X(cn)}" y1="${Y(a)}" y2="${Y(b)}"/><circle class="pd" cx="${X(cn)}" cy="${Y(a)}" r="4"/><circle class="pf" cx="${X(cn)}" cy="${Y(b)}" r="4"/>`;
  return h;
}

/**
 * カルノー図のページの描画: 真理値表・式・状態から作る HTML。ページの最初の描画（Astro）とスクリプトの両方で使う
 */
import { esc, type SymStyle } from '../logic-gates/svg';
import { buildCircuit, type Circuit, kindOf } from './circuit';
import { fmtV, kmapSvg, type Loop, type Notation } from './kmap';
import {
  bitOf,
  covers,
  DC,
  type Form,
  hazardTerms,
  type Lit,
  type Minimal,
  minimize,
  type Term,
  termLits,
  type Val,
  VN,
} from './logic';
import { DEF_ID, type Out, SAMPLE } from './samples';

export interface St {
  /** サンプルの id（自分で作った表は ''） */
  sid: string;
  n: number;
  outs: Out[];
  /** 選んだ出力 */
  o: number;
  form: Form;
  /** 最小の解のうち何番目か */
  sol: number;
  hz: boolean;
  sym: SymStyle;
  nt: Notation;
  /** 今の入力の行 */
  cur: number;
  edited: boolean;
}
export const initState = (): St => {
  const s = SAMPLE[DEF_ID];
  return {
    sid: s.id,
    n: s.n,
    outs: s.outs.map((o) => ({ name: o.name, f: [...o.f] })),
    o: 0,
    form: 'sop',
    sol: 0,
    hz: false,
    sym: 'mil',
    nt: '01',
    cur: 0,
    edited: false,
  };
};

/** 選んだ出力の解 */
export interface Res {
  min: Minimal;
  /** 解の項（ハザード対策の項は後ろ） */
  terms: Term[];
  /** ハザード対策の項の数 */
  nHz: number;
  lits: Lit[][];
  ckt: Circuit;
  /** 出力ごとの式の文字（選んだ出力はハザード対策の項を含む） */
  all: Lit[][][];
}
export function solve(st: St): Res {
  const f = st.outs[st.o].f;
  const min = minimize(f, st.n, st.form);
  if (st.sol >= min.sols.length) st.sol = 0;
  const base = min.sols[st.sol];
  const fT = f.map((v) => (v === DC ? DC : st.form === 'sop' ? v : 1 - v)) as Val[];
  const add = st.hz && base.length > 1 ? hazardTerms(st.n, fT, base, min.P) : [];
  const terms = [...base, ...add];
  const lits = termLits(terms, st.n, st.form);
  const ckt = buildCircuit(st.n, lits, kindOf(st.form), st.sym, { name: st.outs[st.o].name });
  const all = st.outs.map((o, i) =>
    i === st.o ? lits : termLits(minimize(o.f, st.n, st.form).sols[0], st.n, st.form),
  );
  return { min, terms, nHz: add.length, lits, ckt, all };
}

/** 出力の名前（HTML）。後ろの数字は下付き */
export const outName = (nm: string): string => {
  const m = /^([A-Za-z]+)(\d+)$/.exec(nm);
  return m ? `${esc(m[1])}<sub>${m[2]}</sub>` : esc(nm);
};
const L = (l: Lit): string => (l.neg ? `<span class="ov">${VN[l.i]}</span>` : VN[l.i]);
/** 式の右辺。link なら項ごとに色と data-t を付ける。nb 番目からはハザード対策の項 */
export function exprHtml(terms: readonly (readonly Lit[])[], form: Form, link: boolean, nb = Infinity): string {
  const sop = form === 'sop';
  if (!terms.length) return sop ? '0' : '1';
  if (terms.some((t) => !t.length)) return sop ? '1' : '0';
  const many = terms.length > 1;
  return terms
    .map((t, j) => {
      const body = sop
        ? t.map(L).join(' · ')
        : `${many && t.length > 1 ? '(' : ''}${t.map(L).join(' + ')}${many && t.length > 1 ? ')' : ''}`;
      return link ? `<span class="km-tm k${j % 8}${j >= nb ? ' hz' : ''}" data-t="${j}">${body}</span>` : body;
    })
    .join(`<span class="km-op"> ${sop ? '+' : '·'} </span>`);
}
/** 出力ごとの式の行。選んだ出力は色付き */
export function exprList(st: St, r: Res): string {
  return st.outs
    .map((o, i) => {
      const on = i === st.o;
      return `<button type="button" class="km-exr${on ? ' on' : ''}" data-o="${i}"${st.outs.length > 1 ? ` aria-pressed="${on}"` : ' disabled'}><span class="km-yq">${outName(o.name)} =</span> <span class="km-ex">${exprHtml(r.all[i], st.form, on, on ? r.terms.length - r.nHz : Infinity)}</span></button>`;
    })
    .join('');
}
export const statHtml = (r: Res): string =>
  `<span>項 <b>${r.lits.length}</b></span><span>ゲート <b>${r.ckt.gates}</b></span><span>入力 <b>${r.ckt.ins}</b> 本</span><span><b>${r.ckt.levels}</b> 段</span>`;

/** 真理値表 */
export function ttHtml(st: St, r: Res): string {
  const n = st.n,
    N = 1 << n,
    tv = st.form === 'sop' ? 1 : 0;
  const many = st.outs.length > 1;
  let s = `<table class="km-tt"><thead><tr><th scope="col" class="km-tn">番号</th>${VN.slice(0, n)
    .map((v) => `<th scope="col" class="km-ti">${v}</th>`)
    .join('')}${st.outs
    .map(
      (o, i) =>
        `<th scope="col" class="km-to${i === st.o && many ? ' sel' : ''}"${many ? ` data-o="${i}"` : ''}>${outName(o.name)}</th>`,
    )
    .join('')}<th scope="col" class="km-td">項</th></tr></thead><tbody>`;
  const f = st.outs[st.o].f;
  for (let k = 0; k < N; k++) {
    s += `<tr data-row="${k}"${st.cur === k ? ' class="now"' : ''}><td class="km-tn">${k}</td>`;
    for (let i = 0; i < n; i++) s += `<td class="km-ti">${fmtV(bitOf(k, i, n), st.nt)}</td>`;
    st.outs.forEach((o, i) => {
      const v = o.f[k];
      s += `<td class="km-to${i === st.o && many ? ' sel' : ''}"><button type="button" class="km-yv v${v}" data-y="${k}" data-o="${i}" aria-label="${k} 行目の ${esc(o.name)}">${fmtV(v, st.nt)}</button></td>`;
    });
    let ds = '';
    if (f[k] !== 1 - tv)
      r.terms.forEach((t, j) => {
        if (covers(t, k))
          ds += `<i class="km-dt k${j % 8}${j >= r.terms.length - r.nHz ? ' hz' : ''}" data-t="${j}"></i>`;
      });
    s += `<td class="km-td">${ds}</td></tr>`;
  }
  return `${s}</tbody></table>`;
}
/** カルノー図 */
export function mapHtml(st: St, r: Res): string {
  const nb = r.terms.length - r.nHz;
  const loops: Loop[] = r.terms.map((t, j) => ({ t, c: j, cls: j >= nb ? 'hz' : undefined }));
  return kmapSvg(st.n, st.outs[st.o].f, loops, {
    nt: st.nt,
    label: `${st.outs[st.o].name} のカルノー図`,
    id: 'km-mc',
  });
}
/** 解の数と切り替え */
export function solHtml(st: St, r: Res): string {
  const k = r.min.sols.length;
  if (k < 2) return '<span class="ax">最小の解 1 通り</span>';
  return `<span class="ax">最小の解</span><button type="button" class="km-pv sm" data-sol="-1" title="前の解" aria-label="前の解"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5"/></svg></button><b class="km-soln">${st.sol + 1} / ${k}</b><button type="button" class="km-pv sm" data-sol="1" title="次の解" aria-label="次の解"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg></button>`;
}
/** 式の下の一言 */
export const capText = (st: St): string =>
  st.form === 'sop'
    ? '1 のまとまり 1 つが AND 1 個、それを OR でまとめる形'
    : '0 のまとまり 1 つが OR 1 個、それを AND でまとめる形';
/** 出力の切り替え */
export const outTabs = (st: St): string =>
  st.outs
    .map((o, i) => `<button type="button" data-o="${i}" aria-pressed="${i === st.o}">${outName(o.name)}</button>`)
    .join('');

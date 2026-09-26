/**
 * 数値入力の行の計算部分（DOM に依存しない）: 値の並び、目盛り、表記、確定する値、▲▼ の行き先。
 * 動作は lib/param.ts が受け持つ
 */
import { eList, linList, nextOf, prevOf, type Series, same } from './eseries';
import { fmt, minus, parts, plain } from './format';
import type { ParamDef } from './param-def';

export type Kind = 'lin' | 'list' | 'e';
export const kindOf = (d: ParamDef): Kind => (d.lin ? 'lin' : d.list ? 'list' : 'e');

/** グループの E 系列の切替に従う行か */
export const followsGroup = (d: ParamDef): boolean => kindOf(d) === 'e' && !d.series;

/** 近さ・スライダー位置を対数で見るか */
export const isLog = (d: ParamDef): boolean => kindOf(d) === 'e' || (kindOf(d) === 'list' && !!d.log);

/** 値の並び（小さい順）。g はグループの E 系列 */
export function valueList(d: ParamDef, g: Series): number[] {
  if (d.lin) return linList(d.min, d.max, d.lin.step);
  if (d.list) {
    const L = typeof d.list === 'function' ? d.list() : d.list;
    return L.filter((x) => !lt(x, d.min) && !lt(d.max, x));
  }
  const s = d.series ?? g;
  let L: number[];
  if (d.min > 0) L = eList(s, d.min, d.max);
  else if (d.floor && d.floor > 0) L = [0, ...eList(s, d.floor, d.max)];
  else throw new Error(`${d.k}: E 系列の行で min が 0 以下なら floor が要る`);
  if (d.ends) {
    if (!L.length || !same(L[0], d.min)) L.unshift(d.min);
    if (!same(L[L.length - 1], d.max)) L.push(d.max);
  }
  return L;
}

/** 並びの上での位置を測る関数。対数なら 0 は正の最小値より少し左に置く */
export function keyOf(d: ParamDef, L: readonly number[]): (x: number) => number {
  if (!isLog(d)) return (x) => x;
  const lo = Math.log(L.find((x) => x > 0) ?? 1) - 1.5;
  return (x) => (x > 0 ? Math.log(x) : lo);
}

/** v に最も近い並びの値の番号 */
export function nearest(L: readonly number[], key: (x: number) => number, v: number): number {
  const kv = key(v);
  let bi = 0,
    bd = Infinity;
  L.forEach((x, i) => {
    const dd = Math.abs(key(x) - kv);
    if (dd < bd) {
      bd = dd;
      bi = i;
    }
  });
  return bi;
}

/* ---------- 表記 ---------- */
export interface Fmt {
  /** 入力欄 */
  input: (v: number) => string;
  /** ▲▼ の下 */
  step: (v: number) => string;
  /** メッセージ・読み上げ（単位つき） */
  text: (v: number) => string;
  /** 入力中の「→ 値」（単位つき、桁を多めに） */
  preview: (v: number) => string;
}

export function formatter(d: ParamDef): Fmt {
  const f = d.format ?? {},
    u = d.unit ? ` ${d.unit}` : '';
  let base: Fmt;
  if (d.notation === 'plain') {
    const text = (v: number) => plain(v, d.sig ?? 6) + u;
    base = { input: (v) => plain(v, d.sig ?? 6), step: (v) => plain(v, 3), text, preview: text };
  } else if (isLog(d)) {
    base = {
      input: (v) => {
        const [n, x] = parts(v, '', d.sig ?? 4);
        return x ? `${n} ${x}` : n;
      },
      step: (v) => parts(v, '', 3).join(''),
      text: (v) => fmt(v, d.unit),
      preview: (v) => fmt(v, d.unit, Math.max(5, d.sig ?? 4)),
    };
  } else
    base = {
      input: (v) => minus(String(Number(v.toPrecision(d.sig ?? 4)))),
      step: (v) => minus(String(v)),
      text: (v) => fmt(v, d.unit),
      preview: (v) => fmt(v, d.unit, Math.max(5, d.sig ?? 4)),
    };
  return {
    input: f.input ?? base.input,
    step: f.step ?? base.step,
    text: f.text ?? base.text,
    preview: f.text ?? base.preview,
  };
}

/* ---------- 目盛り ---------- */
/** スライダーの目盛りの HTML（.tk の中身） */
export function ticksHtml(d: ParamDef, L: readonly number[]): string {
  const n = Math.max(1, L.length - 1),
    key = keyOf(d, L),
    pos = (v: number) => `${((nearest(L, key, v) / n) * 100).toFixed(3)}%`,
    at = (i: number) => `${((i / n) * 100).toFixed(3)}%`;
  let h = '';
  if (d.lin) {
    const mi = d.lin.minor ?? d.lin.big,
      per = Math.round(d.lin.major / mi);
    for (let i = Math.ceil(d.min / mi); i * mi <= d.max + 1e-9; i++)
      h += `<i class="${i % per ? '' : 'M'}" style="left:${pos(i * mi)}"></i>`;
  } else if (d.list) {
    if (L.length <= 60) h += L.map((_, i) => `<i style="left:${at(i)}"></i>`).join('');
    h += inRange(d)
      .map(([v]) => `<i class="M" style="left:${pos(v)}"></i>`)
      .join('');
  } else {
    const zero = L[0] === 0,
      lo = L.find((x) => x > 0) ?? d.max;
    if (n <= 55) h += L.map((_, i) => `<i style="left:${at(i)}"></i>`).join('');
    if (zero) h += `<i class="M" style="left:${at(0)}"></i>`;
    /* 範囲内の 10 の累乗に大目盛り。0 を置く行では正の最小値の桁を飛ばす */
    const e0 = zero ? Math.floor(Math.log10(lo) + 1e-9) + 1 : Math.ceil(Math.log10(lo) - 1e-9);
    for (let e = e0; e <= Math.floor(Math.log10(d.max) + 1e-9); e++)
      h += `<i class="M" style="left:${pos(10 ** e)}"></i>`;
  }
  h += inRange(d)
    .map(([v, l]) => `<span style="left:${pos(v)}">${l}</span>`)
    .join('');
  return h;
}

const lt = (a: number, b: number) => a < b - Math.abs(b) * 1e-9;
const inRange = (d: ParamDef) => d.tk.filter(([v]) => !lt(v, d.min) && !lt(d.max, v));

/* ---------- 入力の説明 ---------- */
/** 入力欄の title: 範囲と操作 */
export function titleText(d: ParamDef, g: Series, f: Fmt): string {
  return `${f.text(d.min)} – ${f.text(d.max)}　${d.hint ?? hintText(d, g)}`;
}

function hintText(d: ParamDef, g: Series): string {
  const u = d.unit ? ` ${d.unit}` : '';
  if (d.lin) return `↑↓: ±${d.lin.step}${u}（Shift で ±${d.lin.big}${u}）　Enter: 確定　Esc: 戻す`;
  if (d.list)
    return (d.jump ?? 1) > 1
      ? '↑↓: 隣の値　PgUp/PgDn・Shift: 大きく動かす　Enter: 確定　Esc: 戻す'
      : '↑↓: 隣の値　Enter: 確定　Esc: 戻す';
  return `↑↓: E${d.series ?? g} の隣の値　PgUp/PgDn: 10 倍・1/10　Enter: 確定　Esc: 戻す`;
}

/** ▲▼ の読み上げの「{ラベル}1 つ上の」 */
export function stepLabel(d: ParamDef, g: Series): string {
  if (d.stepLabel != null) return d.stepLabel;
  if (d.lin) return `${d.lin.step}${d.unit ? ` ${d.unit}` : ''}`;
  if (d.list) return '';
  return `E${d.series ?? g} で`;
}

/* ---------- 確定する値 ---------- */
/** 受け付ける値か（符号の条件） */
export function accept(d: ParamDef, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  const s = d.sign ?? 'pos';
  return s === 'any' || (s === 'nonneg' ? v >= 0 : v > 0);
}

/** 読めないときのメッセージ */
export const badText = (d: ParamDef): string => d.bad ?? '読めない値です（例 4.7k・4k7・100n・1e3）';

export interface Resolved {
  /** 確定する値 */
  w: number;
  /** 変えた理由（「〜にしました」）。変えなければ '' */
  why: string;
  /** 範囲に丸めたなら、どちらの端か */
  bound?: 'min' | 'max';
}

/** 入力された値 v から確定する値を決める: fix → snap → 範囲への丸め */
export function resolve(d: ParamDef, L: readonly number[], f: Fmt, v: number): Resolved {
  const r = d.fix?.(v);
  if (r) return { w: r[0], why: r[1] };
  const c = Math.min(d.max, Math.max(d.min, v));
  if (d.snap && L.length) {
    const w = L[nearest(L, keyOf(d, L), c)];
    return { w, why: same(w, v) ? '' : `${f.text(v)} は選べないため ${f.text(w)} にしました` };
  }
  if (same(c, v)) return { w: v, why: '' };
  const bound = c === d.max ? 'max' : 'min';
  return {
    w: c,
    why: `${f.text(v)} は範囲外のため${bound === 'max' ? '上限' : '下限'} ${f.text(c)} にしました`,
    bound,
  };
}

/** 入力中のメッセージ */
export function previewText(r: Resolved, v: number, f: Fmt): string {
  if (r.bound) return `→ ${f.text(v)}（${r.bound === 'max' ? '上限' : '下限'} ${f.text(r.w)} に丸めます）`;
  if (r.why) return `→ ${f.text(r.w)}（${r.why.replace(/にしました$/, 'にします')}）`;
  return `→ ${f.preview(v)}`;
}

/* ---------- ▲▼ ---------- */
/** Shift で大きく動かす行か（E 系列の行は PgUp/PgDn だけ） */
export const shiftIsBig = (d: ParamDef): boolean => kindOf(d) !== 'e';

/** ▲▼・キーで動かした先。動けなければ undefined */
export function stepValue(d: ParamDef, L: readonly number[], v: number, dir: 1 | -1, big: boolean): number | undefined {
  const clamp = (x: number) => Math.min(d.max, Math.max(d.min, x));
  const near = () => (dir > 0 ? nextOf(L, v) : prevOf(L, v));
  if (d.lin) return big ? clamp(Number((v + dir * d.lin.big).toPrecision(12))) : near();
  if (d.list) {
    const x = near(),
      j = d.jump ?? 1;
    if (x == null || !big || j <= 1) return x;
    return L[Math.max(0, Math.min(L.length - 1, L.indexOf(x) + dir * (j - 1)))];
  }
  if (!big) return near();
  const lo = L.find((x) => x > 0);
  if (v === 0) return dir > 0 ? lo : undefined;
  let w = clamp(Number((v * 10 ** dir).toPrecision(12)));
  if (L[0] === 0 && dir < 0 && lo != null && w < lo * (1 - 1e-9)) w = 0;
  return w;
}

/**
 * 論理ゲートのページの絵: ゲートの記号（MIL 記号と JIS 記号）・回路図・タイミングチャート。
 * 回路図は文字列で作って一度だけ置き、値は paint でクラスを替えて塗り直す
 */
import {
  BACK,
  type Bit,
  type GateType,
  GNAME,
  gh,
  gw,
  hazards,
  isGate,
  NEG,
  ORT,
  type Prepared,
  prep,
  type Sample,
  XT,
} from './circuits';

export type SymStyle = 'mil' | 'jis';
/** 値の表し方 */
export type Notation = '01' | 'LH';
/** タイミングチャートの波形 */
export type Wave = 'sq' | 'tr' | 'fill' | 'num';

const JIS_LB: Record<GateType, string> = {
  and: '&amp;',
  nand: '&amp;',
  or: '≥1',
  nor: '≥1',
  xor: '=1',
  xnor: '=1',
  not: '1',
};
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const fmtBit = (v: Bit, nt: Notation): string => (nt === 'LH' ? (v ? 'H' : 'L') : String(v));
const rd = (v: number): number => Math.round(v * 10) / 10;

/** ラベルの ¬X を上線つきの X にし、「S 和」の 2 語目を小さくする（SVG の text） */
export function svgLabel(s: string, x: number, y: number, anchor = 'start', cls = 'lb'): string {
  const m = /^¬(.+)$/.exec(s);
  const t = m
    ? `<tspan text-decoration="overline">${esc(m[1])}</tspan>`
    : esc(s).replace(/ (.+)$/, ' <tspan class="lb-s">$1</tspan>');
  return `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${t}</text>`;
}
/** HTML の中のラベル（¬X を上線に） */
export const htmlLabel = (s: string): string => {
  const m = /^¬(.+)$/.exec(s);
  return m ? `<span class="ov">${esc(m[1])}</span>` : esc(s);
};

/** ゲート 1 個の記号（原点は左端・中央）。n は入力の数 */
export function gateShape(t: GateType, n: number, style: SymStyle): string {
  const h = gh(n),
    h2 = h / 2,
    W = gw(t);
  let s = '';
  if (style === 'jis') {
    s += `<rect class="gb" x="0" y="${-h2}" width="${W}" height="${h}"/><text class="lg-gl" x="${W / 2}" y="5" text-anchor="middle">${JIS_LB[t]}</text>`;
  } else if (t === 'and' || t === 'nand') {
    s += `<path class="gb" d="M0 ${-h2}H${W - h2}A${h2} ${h2} 0 0 1 ${W - h2} ${h2}H0Z"/>`;
  } else if (ORT[t]) {
    const ox = XT[t] ? 6 : 0,
      w = 44;
    s += `<path class="gb" d="M${ox} ${-h2}Q${rd(ox + w * 0.58)} ${-h2} ${ox + w} 0Q${rd(ox + w * 0.58)} ${h2} ${ox} ${h2}Q${ox + BACK} 0 ${ox} ${-h2}Z"/>`;
    if (XT[t]) s += `<path class="gb2" d="M0 ${-h2}Q${BACK} 0 0 ${h2}"/>`;
  } else s += `<path class="gb" d="M0 -14L${W} 0L0 14Z"/>`;
  if (NEG[t]) s += `<circle class="gb" cx="${W + 3.5}" cy="0" r="3.5"/>`;
  return s;
}

/** 回路図の SVG。入力の箱は data-in、出力のランプは data-out、線は data-s（値を運ぶ部品の id） */
export function circuitSvg(c: Sample, style: SymStyle): string {
  const p = prep(c);
  const box = p.box;
  let s = `<svg class="lg-ckt" viewBox="${box.join(' ')}" width="${Math.round(box[2] * 1.35)}" height="${Math.round(box[3] * 1.35)}" role="img" aria-label="${esc(c.name)}の回路図">`;
  s += '<g class="lg-w">';
  for (const g of p.segs) s += `<path class="w" data-s="${g.s}" d="${g.d}"/>`;
  s += '</g>';
  for (const d of p.dots) s += `<circle class="dot" data-s="${d.s}" cx="${d.x}" cy="${d.y}" r="3"/>`;
  for (const n of c.nodes) {
    if (isGate(n.t))
      s += `<g class="gate" data-g="${n.id}" role="img" aria-label="${GNAME[n.t]}" transform="translate(${n.x} ${n.y})"><rect class="lg-ghit" x="-4" y="${-gh(n.ins.length) / 2 - 4}" width="${gw(n.t) + 15}" height="${gh(n.ins.length) + 8}"/>${gateShape(n.t, n.ins.length, style)}</g>`;
    else if (n.t === 'in')
      s += `<g class="lg-sw" data-in="${n.id}" tabindex="0" role="switch" aria-checked="false" aria-label="入力 ${esc(n.lb.replace('¬', 'NOT '))}"><rect class="swb" x="${n.x}" y="${n.y - 12}" width="34" height="24" rx="5"/><text class="swv" x="${n.x + 17}" y="${n.y + 5.5}" text-anchor="middle">0</text><path class="w" data-s="${n.id}" d="M${n.x + 34} ${n.y}H${n.x + 40}"/>${svgLabel(n.lb, n.x - 8, n.y + 5, 'end')}</g>`;
    else if (n.t === 'out')
      s += `<g class="lg-led" data-out="${n.id}"><path class="w" data-s="${n.ins[0].s}" d="M${n.x} ${n.y}H${n.x + 4}"/><circle class="hzr" cx="${n.x + 14}" cy="${n.y}" r="13.5"/><circle class="ledc" cx="${n.x + 14}" cy="${n.y}" r="10"/>${svgLabel(n.lb, n.x + 30, n.y + 5)}</g>`;
  }
  return `${s}</svg>`;
}

/** 回路図の状態。ゲートの出力・入力・値を引く関数 */
export interface View {
  inp: Record<string, Bit>;
  val: (id: string) => Bit;
}
/** 値を回路図へ反映する */
export function paint(svg: SVGSVGElement, m: View, nt: Notation, hz: readonly string[]): void {
  for (const e of svg.querySelectorAll<SVGElement>('[data-s]')) e.classList.toggle('on', !!m.val(e.dataset.s ?? ''));
  for (const g of svg.querySelectorAll<SVGGElement>('[data-in]')) {
    const on = !!m.inp[g.dataset.in ?? ''];
    g.classList.toggle('on', on);
    g.setAttribute('aria-checked', String(on));
    const t = g.querySelector('.swv');
    if (t) t.textContent = fmtBit(on ? 1 : 0, nt);
  }
  for (const g of svg.querySelectorAll<SVGGElement>('[data-out]')) {
    const id = g.dataset.out ?? '';
    g.classList.toggle('on', !!m.val(id));
    g.classList.toggle('hz', hz.includes(id));
  }
}

/* ---------- タイミングチャート ---------- */
export interface ChartRow {
  id: string;
  lb: string;
  k: 'in' | 'mid' | 'out';
}
/** 行: 入力・（途中の信号）・出力 */
export function chartRows(c: Sample, mid: boolean): ChartRow[] {
  const p: Prepared = prep(c);
  const r: ChartRow[] = p.inputs.map((n) => ({ id: n.id, lb: n.lb, k: 'in' }));
  if (mid) for (const g of p.gates) if (g.nm) r.push({ id: g.id, lb: g.nm, k: 'mid' });
  for (const n of p.outputs) r.push({ id: n.id, lb: n.lb.split(' ')[0], k: 'out' });
  return r;
}
/** 押した位置を引くための並び */
export interface ChartGeo {
  lw: number;
  dx: number;
  n: number;
}
export interface ChartOpt {
  w: number;
  nt: Notation;
  wave: Wave;
  /** 選んだ列・指している列の添字 */
  sel: number | null;
  hov: number | null;
}
const lbl = (s: string): string => {
  const m = /^¬(.+)$/.exec(s);
  return m ? `<tspan text-decoration="overline">${esc(m[1])}</tspan>` : esc(s);
};
/** 1 行の波形 */
function wave(vs: readonly Bit[], k: string, lw: number, dx: number, yh: number, yl: number, o: ChartOpt): string {
  const X = (i: number) => rd(lw + i * dx),
    Y = (v: Bit) => (v ? yh : yl),
    e = Math.min(dx * 0.4, 5);
  const runs: { v: Bit; a: number; b: number }[] = [];
  vs.forEach((v, i) => {
    const r = runs[runs.length - 1];
    if (r && r.v === v) r.b = i + 1;
    else runs.push({ v, a: i, b: i + 1 });
  });
  if (o.wave === 'num') {
    const ym = (yh + yl) / 2;
    return runs
      .map(({ v, a, b }) => {
        const xa = X(a),
          xb = X(b),
          ee = Math.min(e, (xb - xa) / 2);
        let s = `<path class="bus ${k}${v ? ' hi' : ''}" d="M${xa} ${ym}L${rd(xa + ee)} ${yh - 1}H${rd(xb - ee)}L${xb} ${ym}L${rd(xb - ee)} ${yl + 1}H${rd(xa + ee)}Z"/>`;
        if (xb - xa >= 11)
          s += `<text class="bv ${k}${v ? ' hi' : ''}" x="${rd((xa + xb) / 2)}" y="${rd(ym + 4)}" text-anchor="middle">${fmtBit(v, o.nt)}</text>`;
        return s;
      })
      .join('');
  }
  let d = '',
    s = '';
  if (o.wave === 'tr')
    vs.forEach((v, i) => {
      if (!i) d += `M${X(0)} ${Y(v)}`;
      else if (v !== vs[i - 1]) d += `L${rd(X(i) + e)} ${Y(v)}`;
      d += `H${X(i + 1)}`;
    });
  else {
    vs.forEach((v, i) => {
      d += !i ? `M${X(0)} ${Y(v)}` : v !== vs[i - 1] ? `V${Y(v)}` : '';
      d += `H${X(i + 1)}`;
    });
    if (o.wave === 'fill')
      for (const r of runs)
        if (r.v)
          s += `<rect class="cf ${k}" x="${X(r.a)}" y="${yh}" width="${rd(X(r.b) - X(r.a))}" height="${yl - yh}"/>`;
  }
  return `${s}<path class="cw ${k}" d="${d}"/>`;
}
/** タイミングチャートの SVG。hs は古い順の記録（右端が今）。右端の列に今の値を出す */
export function chartSvg(
  rows: readonly ChartRow[],
  hs: readonly Record<string, Bit>[],
  o: ChartOpt,
): { svg: string; geo: ChartGeo } {
  const RV = 30,
    n = hs.length,
    lw = 56,
    rh = 22,
    H0 = rows.length * rh + 6,
    H = H0 + 18;
  const W = Math.max(240, o.w),
    dx = (W - lw - RV - 6) / n,
    xe = rd(lw + n * dx),
    now = hs[n - 1];
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`;
  const col = (i: number | null, cls: string) =>
    i == null ? '' : `<rect class="${cls}" x="${rd(lw + i * dx)}" y="0" width="${rd(dx)}" height="${H0}"/>`;
  if (o.hov !== o.sel) s += col(o.hov, 'hov');
  s += col(o.sel, 'sel');
  for (let i = 0; i <= n; i++) {
    const k = n - i;
    if (k % 5) continue;
    const x = rd(lw + i * dx);
    s += `<path class="cg" d="M${x} 0V${H0}"/><text class="ca" x="${x}" y="${H - 4}" text-anchor="middle">${k ? `−${k}` : '今'}</text>`;
  }
  s += `<path class="cs" d="M${xe} 0V${H0}"/>`;
  const hz = hazards(
    hs,
    rows.filter((r) => r.k === 'out').map((r) => r.id),
  );
  rows.forEach((r, j) => {
    const y0 = j * rh + 4,
      yh = y0 + 3,
      yl = y0 + rh - 5;
    s += `<text class="cl ${r.k}" x="${lw - 7}" y="${y0 + rh / 2 + 4}" text-anchor="end">${lbl(r.lb)}</text>`;
    s += wave(
      hs.map((h) => h[r.id]),
      r.k,
      lw,
      dx,
      yh,
      yl,
      o,
    );
    for (const [id, i, len] of hz)
      if (id === r.id)
        s += `<rect class="hz" x="${rd(lw + i * dx - 2)}" y="${y0 - 1}" width="${rd(len * dx + 4)}" height="${rh - 2}" rx="3"/>`;
    s += `<text class="cv ${r.k}" x="${rd(xe + 3 + RV / 2)}" y="${y0 + rh / 2 + 4}" text-anchor="middle">${fmtBit(now[r.id], o.nt)}</text>`;
  });
  return { svg: `${s}</svg>`, geo: { lw, dx, n } };
}

/** しくみの札の小さな記号（ゲート 1 個） */
export const miniGate = (t: GateType, x: number, y: number, style: SymStyle = 'mil', n = 2): string =>
  `<g transform="translate(${x} ${y})">${gateShape(t, n, style)}</g>`;

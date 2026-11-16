/**
 * カルノー図のページの回路図: 式から 2 段の回路を自動で並べる。
 * 入力は上に並べ、縦の線（そのままと反転）から 1 段目のゲートへ横の線で取る。1 段目の出力は折れ線で 2 段目へ集める。
 * ゲートの記号は論理ゲートのページと同じ（MIL 記号・JIS 記号）
 */
import { BACK, type GateType, gh, gw, NEG, ORT, PITCH } from '../logic-gates/circuits';
import { esc, gateShape, type SymStyle } from '../logic-gates/svg';
import { type Form, flip, type Lit, VN } from './logic';

/** and-or: 積和形、or-and: 和積形、nand: NAND だけ、nor: NOR だけ */
export type Kind = 'and-or' | 'or-and' | 'nand' | 'nor';
export const kindOf = (form: Form): Kind => (form === 'sop' ? 'and-or' : 'or-and');

export interface Circuit {
  svg: string;
  /** ゲートの数（反転を含む）・入力の本数の合計・段数 */
  gates: number;
  ins: number;
  levels: number;
  /** 入力の行 k のときの線の値（data-s の名前ごと） */
  ev: (k: number) => Record<string, 0 | 1>;
  /** 出力のランプにつながる線の名前 */
  outS: string;
}

const GF: Record<string, (a: (0 | 1)[]) => 0 | 1> = {
  and: (a) => (a.every(Boolean) ? 1 : 0),
  or: (a) => (a.some(Boolean) ? 1 : 0),
  nand: (a) => (a.every(Boolean) ? 0 : 1),
  nor: (a) => (a.some(Boolean) ? 0 : 1),
};
const gOut = (t: GateType): number => gw(t) + (NEG[t] ? 7 : 0);
/** 入力の線の終点（MIL 記号の OR の形は背の曲線まで） */
const pinX = (t: GateType, k: number, dy: number, style: SymStyle): number =>
  style === 'mil' && ORT[t] ? Math.round((BACK / 2) * (1 - (dy / (gh(k) / 2)) ** 2) * 10) / 10 : 0;
const ovl = (s: string): string => `<tspan text-decoration="overline">${esc(s)}</tspan>`;

/**
 * 回路図。terms は文字の並び（積和形は積の項、和積形は和の項）。
 * col(j) は項 j の色の番号（data-t）。name は出力の名前
 */
export function buildCircuit(
  n: number,
  terms: readonly (readonly Lit[])[],
  kind: Kind,
  style: SymStyle,
  opt: { col?: (j: number) => number; name?: string } = {},
): Circuit {
  const sop = kind === 'and-or' || kind === 'nand';
  const g1t: GateType = kind === 'and-or' ? 'and' : kind === 'or-and' ? 'or' : kind;
  const g2t: GateType = kind === 'and-or' ? 'or' : kind === 'or-and' ? 'and' : kind;
  const tied = kind === 'nand' || kind === 'nor';
  const invt: GateType = tied ? g1t : 'not';
  const col = opt.col ?? ((j: number) => j);
  const m = terms.length;
  /* 定数（項がない、または変数のない項がある） */
  const constV: 0 | 1 | null = !m ? (sop ? 0 : 1) : terms.some((t) => !t.length) ? (sop ? 1 : 0) : null;
  /* 1 文字の項は 1 段目を通らない。NAND・NOR では反転した文字を 2 段目へ */
  const T = terms.map((t, j) => {
    const single = t.length === 1;
    return { j, single, lits: single && tied && m > 1 ? flip(t) : [...t], c: col(j) };
  });
  const needT = Array<boolean>(n).fill(false),
    needC = Array<boolean>(n).fill(false);
  if (constV == null) for (const t of T) for (const l of t.lits) (l.neg ? needC : needT)[l.i] = true;
  const COLW = tied ? 104 : 92,
    XOFF = tied ? 76 : 62;
  const x0 = (i: number) => 44 + i * COLW,
    xc = (i: number) => x0(i) + XOFF;
  const busX = (l: Lit) => (l.neg ? xc(l.i) : x0(l.i));
  const net = (l: Lit) => (l.neg ? `n${l.i}` : `x${l.i}`);
  const busR = xc(n - 1);
  const segs: string[] = [],
    dots: string[] = [],
    gates: string[] = [],
    tags: string[] = [];
  const seg = (s: string, d: string) => segs.push(`<path class="w" data-s="${s}" d="${d}"/>`);
  const dot = (s: string, x: number, y: number) =>
    dots.push(`<circle class="dot" data-s="${s}" cx="${x}" cy="${y}" r="3"/>`);
  let nGate = 0,
    nIn = 0,
    lv1 = 0,
    lv2 = 0,
    s = '';
  const YI = 66,
    Y1 = 118;
  let y = Y1;
  const slot = (constV == null ? T : []).map((t) => {
    const h = t.single ? 22 : gh(t.lits.length);
    const r = { c: y + h / 2 };
    y += h + (t.single ? 10 : 14);
    return r;
  });
  const yEnd = Math.max(y - 10, Y1 + 30);
  const gx = busR + 34;
  /* 1 段目 */
  const outs: { y: number; x: number; s: string; direct?: boolean }[] = [];
  if (constV == null)
    T.forEach((t, j) => {
      const yc = slot[j].c;
      if (t.single) {
        const l = t.lits[0];
        dot(net(l), busX(l), yc);
        outs.push({ y: yc, x: busX(l), s: net(l), direct: true });
        if (m > 1)
          tags.push(
            `<g class="km-tg k${t.c % 8}" data-t="${t.c}"><rect class="km-tgb" x="${gx + 8}" y="${yc - 10}" width="26" height="20" rx="4"/><text class="km-tgt" x="${gx + 21}" y="${yc + 5}" text-anchor="middle">${l.neg ? ovl(VN[l.i]) : VN[l.i]}</text></g>`,
          );
        return;
      }
      const k = t.lits.length;
      nGate++;
      nIn += k;
      lv1 = 1;
      t.lits.forEach((l, p) => {
        const dy = (p - (k - 1) / 2) * PITCH,
          py = yc + dy;
        dot(net(l), busX(l), py);
        seg(net(l), `M${busX(l)} ${py}H${gx + pinX(g1t, k, dy, style)}`);
      });
      gates.push(
        `<g class="gate km-tc k${t.c % 8}" data-t="${t.c}" transform="translate(${gx} ${yc})">${gateShape(g1t, k, style)}</g>`,
      );
      outs.push({ y: yc, x: gx + gOut(g1t), s: `g${j}` });
    });
  const g1R = gx + gOut(g1t);
  /* 2 段目 */
  let outX: number, outY: number, outS: string;
  const yc = constV != null ? (Y1 + yEnd) / 2 : (outs[0].y + outs[outs.length - 1].y) / 2;
  if (constV != null) {
    outX = gx + 20;
    outY = yc;
    outS = 'k';
    s += `<text class="km-cst" x="${outX - 6}" y="${outY + 5}" text-anchor="end">${constV} 固定</text>`;
  } else if (m === 1) {
    const o = outs[0];
    if (tied && !T[0].single) {
      /* 1 段目の後ろに反転（入力をつないだ NAND・NOR） */
      const ix = g1R + 30;
      seg(
        o.s,
        `M${o.x} ${o.y}H${ix - 8}M${ix - 8} ${o.y - 8}V${o.y + 8}M${ix - 8} ${o.y - 8}H${ix + pinX(invt, 2, -8, style)}M${ix - 8} ${o.y + 8}H${ix + pinX(invt, 2, 8, style)}`,
      );
      gates.push(`<g class="gate" transform="translate(${ix} ${o.y})">${gateShape(invt, 2, style)}</g>`);
      nGate++;
      nIn += 2;
      lv2 = 1;
      outX = ix + gOut(invt);
      outY = o.y;
      outS = 'y';
    } else {
      outX = o.direct ? g1R : o.x;
      outY = o.y;
      outS = o.s;
      if (o.direct) seg(o.s, `M${o.x} ${o.y}H${g1R}`);
    }
  } else {
    const pins = outs.map((_, p) => yc + (p - (m - 1) / 2) * PITCH);
    const dn = pins.map((_, p) => p).filter((p) => outs[p].y < pins[p] - 0.5);
    const up = pins.map((_, p) => p).filter((p) => outs[p].y > pins[p] + 0.5);
    const K = Math.max(dn.length, up.length, 1);
    const g2x = g1R + K * 9 + 30;
    outs.forEach((o, p) => {
      const py = pins[p],
        dy = py - yc;
      /* 下へ折れる線は上の線ほど右、上へ折れる線は下の線ほど右で折る（交差しない） */
      const a = dn.indexOf(p),
        b = up.indexOf(p);
      const jx = a >= 0 ? g1R + 10 + (dn.length - 1 - a) * 9 : b >= 0 ? g1R + 10 + b * 9 : null;
      const ex = g2x + pinX(g2t, m, dy, style);
      seg(o.s, jx == null ? `M${o.x} ${o.y}H${ex}` : `M${o.x} ${o.y}H${jx}V${py}H${ex}`);
    });
    gates.push(`<g class="gate" transform="translate(${g2x} ${yc})">${gateShape(g2t, m, style)}</g>`);
    nGate++;
    nIn += m;
    lv2 = 1;
    outX = g2x + gOut(g2t);
    outY = yc;
    outS = 'y';
  }
  /* 入力のスイッチと反転 */
  let nInv = 0;
  for (let i = 0; i < n; i++) {
    const x = x0(i);
    s += `<text class="km-lb" x="${x}" y="14" text-anchor="middle">${VN[i]}</text>`;
    s += `<g class="km-sw" data-in="${i}" tabindex="0" role="switch" aria-checked="false" aria-label="入力 ${VN[i]}"><rect class="km-swb" x="${x - 17}" y="20" width="34" height="24" rx="5"/><text class="km-swv" x="${x}" y="37.5" text-anchor="middle">0</text></g>`;
    seg(`x${i}`, `M${x} 44V${needT[i] ? yEnd : needC[i] ? YI : 52}`);
    if (!needC[i]) continue;
    nInv++;
    const ix = x + 12;
    if (needT[i]) dot(`x${i}`, x, YI);
    if (tied)
      seg(
        `x${i}`,
        `M${x} ${YI}H${ix - 6}M${ix - 6} ${YI - 8}V${YI + 8}M${ix - 6} ${YI - 8}H${ix + pinX(invt, 2, -8, style)}M${ix - 6} ${YI + 8}H${ix + pinX(invt, 2, 8, style)}`,
      );
    else seg(`x${i}`, `M${x} ${YI}H${ix}`);
    gates.push(`<g class="gate" transform="translate(${ix} ${YI})">${gateShape(invt, tied ? 2 : 1, style)}</g>`);
    seg(`n${i}`, `M${ix + gOut(invt)} ${YI}H${xc(i)}V${yEnd}`);
    s += `<text class="km-lbn" x="${xc(i) + 5}" y="${YI + 30}">${ovl(VN[i])}</text>`;
  }
  nGate += nInv;
  nIn += nInv * (tied ? 2 : 1);
  /* 出力 */
  const lx = outX + 22;
  if (constV == null) seg(outS, `M${outX} ${outY}H${lx}`);
  s += `<g class="km-led" data-out="${outS}"><circle class="km-ledc" cx="${lx + 12}" cy="${outY}" r="10"/>${labelSvg(opt.name ?? 'Y', lx + 28, outY + 5)}</g>`;
  const W = lx + 40 + (opt.name ?? 'Y').length * 9,
    H = Math.max(yEnd, outY + 20) + 12;
  const svg = `<svg class="km-ckt" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="回路図"><g>${segs.join('')}</g>${dots.join('')}${gates.join('')}${tags.join('')}${s}</svg>`;
  const ev = (k: number): Record<string, 0 | 1> => {
    const v: Record<string, 0 | 1> = { k: constV ?? 0 };
    for (let i = 0; i < n; i++) {
      const b = ((k >> (n - 1 - i)) & 1) as 0 | 1;
      v[`x${i}`] = b;
      v[`n${i}`] = (1 - b) as 0 | 1;
    }
    T.forEach((t, j) => {
      if (!t.single) v[`g${j}`] = GF[g1t](t.lits.map((l) => v[net(l)]));
    });
    if (constV == null) {
      if (m === 1) v.y = tied && !T[0].single ? ((1 - v.g0) as 0 | 1) : v[outs[0].s];
      else v.y = GF[g2t](outs.map((o) => v[o.s]));
    }
    if (!(outS in v)) v[outS] = v.y;
    return v;
  };
  return { svg, gates: nGate, ins: nIn, levels: (nInv ? 1 : 0) + lv1 + lv2, ev, outS };
}

/** 出力の名前（SVG）。2 文字目からの数字は小さく下げる（Y1 など） */
function labelSvg(nm: string, x: number, y: number): string {
  const m = /^([A-Za-z]+)(\d+)$/.exec(nm);
  const t = m ? `${esc(m[1])}<tspan class="km-lbs" dy="3">${m[2]}</tspan>` : esc(nm);
  return `<text class="km-lb" x="${x}" y="${y}">${t}</text>`;
}

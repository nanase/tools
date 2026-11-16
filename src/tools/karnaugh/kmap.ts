/**
 * カルノー図の SVG。行と列はグレイコードの順（00・01・11・10）で、隣のマスは 1 変数だけ違う。
 * 5・6 入力は 4×4 の図を並べる（5 は A で左右に 2 枚、6 は A で上下・B で左右に 4 枚）。並べた図の同じ位置のマスも隣どうし
 */
import { esc } from '../logic-gates/svg';
import { covers, DC, type Term, type Val, VN } from './logic';

export type Notation = '01' | 'LH';
export const fmtV = (v: Val, nt: Notation): string => (v === DC ? 'X' : nt === 'LH' ? (v ? 'H' : 'L') : String(v));

const GRAY: Record<number, readonly number[]> = { 1: [0, 1], 2: [0, 1, 3, 2] };
const rd = (v: number): number => Math.round(v * 10) / 10;

export interface Geo {
  n: number;
  S: number;
  /** 文字の倍率（小さな図で詰める） */
  z: number;
  rb: number;
  cb: number;
  rows: readonly number[];
  cols: readonly number[];
  nr: number;
  nc: number;
  /** 並べる図の段と列（1 か 2） */
  tr: number;
  tc: number;
  ox: number;
  oy: number;
  gap: number;
  /** 図 (a, b) の左上 */
  org: (a: number, b: number) => [number, number];
  /** 図 (a, b) の r 行 c 列の行番号 */
  at: (a: number, b: number, r: number, c: number) => number;
  W: number;
  H: number;
}
export function kgeo(n: number, S = n <= 4 ? 52 : n === 5 ? 44 : 40): Geo {
  const low = Math.min(n, 4),
    rb = low >> 1,
    cb = low - rb;
  const rows = GRAY[rb],
    cols = GRAY[cb];
  const nr = rows.length,
    nc = cols.length;
  const tr = n === 6 ? 2 : 1,
    tc = n >= 5 ? 2 : 1;
  const z = S >= 40 ? 1 : 0.55;
  const gap = 30;
  const ox = (S >= 40 ? 62 : 36) + (tr > 1 ? 50 : 0),
    oy = (S >= 40 ? 58 : 34) + (tc > 1 ? 24 : 0);
  const org = (a: number, b: number): [number, number] => [ox + b * (nc * S + gap), oy + a * (nr * S + gap)];
  const at = (a: number, b: number, r: number, c: number) =>
    (((a << 1) | b) << low) * (n > 4 ? 1 : 0) + ((rows[r] << cb) | cols[c]);
  const at5 = (_a: number, b: number, r: number, c: number) => (b << 4) | (rows[r] << cb) | cols[c];
  const W = ox + tc * nc * S + (tc - 1) * gap + 14,
    H = oy + tr * nr * S + (tr - 1) * gap + 14;
  return { n, S, z, rb, cb, rows, cols, nr, nc, tr, tc, ox, oy, gap, org, at: n === 5 ? at5 : at, W, H };
}

/** 位置の集合を区間に。端をまたぐと 2 つに分かれ、外側が開く */
function spans(pos: number[], N: number): [number, number, boolean, boolean][] {
  const p = [...new Set(pos)].sort((a, b) => a - b);
  if (p.length === N) return [[0, N - 1, false, false]];
  if (p.every((x, i) => !i || x === p[i - 1] + 1)) return [[p[0], p[p.length - 1], false, false]];
  const k = p.findIndex((x, i) => i && x !== p[i - 1] + 1);
  return [
    [0, p[k - 1], true, false],
    [p[k], N - 1, false, true],
  ];
}
/** 図 (a, b) の中での囲みの四角（開いた側は枠の外まで伸ばし、切り抜きで隠す） */
function loopRects(t: Term, g: Geo, a: number, b: number, inset: number): [number, number, number, number][] {
  const R: number[] = [],
    C: number[] = [];
  for (let r = 0; r < g.nr; r++)
    for (let c = 0; c < g.nc; c++)
      if (covers(t, g.at(a, b, r, c))) {
        R.push(r);
        C.push(c);
      }
  if (!R.length) return [];
  const [X, Y] = g.org(a, b),
    S = g.S,
    out: [number, number, number, number][] = [];
  for (const [r0, r1, ot, ob] of spans(R, g.nr))
    for (const [c0, c1, ol, or] of spans(C, g.nc)) {
      const x1 = ol ? X - 14 : X + c0 * S + inset,
        x2 = or ? X + g.nc * S + 14 : X + (c1 + 1) * S - inset;
      const y1 = ot ? Y - 14 : Y + r0 * S + inset,
        y2 = ob ? Y + g.nr * S + 14 : Y + (r1 + 1) * S - inset;
      out.push([x1, y1, x2 - x1, y2 - y1]);
    }
  return out;
}

export interface Loop {
  t: Term;
  /** 色の番号（data-t） */
  c: number;
  cls?: string;
  inset?: number;
}
export interface MapOpt {
  nt?: Notation;
  S?: number;
  /** マスの隅に行番号 */
  idx?: boolean;
  /** 図の上に重ねる絵 */
  extra?: (g: Geo) => string;
  label?: string;
  /** 切り抜きの id の頭（ページの中で重ならない名前） */
  id?: string;
}
let clipN = 0;
/** カルノー図の SVG。マスは data-k（行番号）を持つ */
export function kmapSvg(n: number, f: readonly Val[], loops: readonly Loop[], opt: MapOpt = {}): string {
  const g = kgeo(n, opt.S);
  const { S, z, nr, nc, rb, cb, tr, tc } = g;
  const nt = opt.nt ?? '01';
  const id = opt.id ?? `kmc${++clipN}`;
  const low = Math.min(n, 4),
    vOff = n - low;
  const code = (c: number, bits: number) => {
    let s = '';
    for (let b = bits - 1; b >= 0; b--) s += fmtV(((c >> b) & 1) as Val, nt);
    return s;
  };
  let s = `<svg class="km-map" viewBox="0 0 ${g.W} ${g.H}" width="${g.W}" height="${g.H}" role="img" aria-label="${esc(opt.label ?? 'カルノー図')}"><defs>`;
  for (let a = 0; a < tr; a++)
    for (let b = 0; b < tc; b++) {
      const [X, Y] = g.org(a, b);
      s += `<clipPath id="${id}-${a}${b}"><rect x="${X - 3}" y="${Y - 3}" width="${nc * S + 6}" height="${nr * S + 6}"/></clipPath>`;
    }
  s += '</defs>';
  /* 変数の名前と行・列の符号 */
  const [X0, Y0] = g.org(0, 0);
  s += `<path class="km-dg" d="M${rd(X0 - 46 * z)} ${rd(Y0 - 46 * z)}L${X0} ${Y0}"/>`;
  s += `<text class="km-vn" x="${rd(X0 - 30 * z)}" y="${rd(Y0 - 6 * z)}" text-anchor="middle">${VN.slice(vOff, vOff + rb).join('')}</text>`;
  s += `<text class="km-vn" x="${rd(X0 - 8 * z)}" y="${rd(Y0 - 34 * z)}">${VN.slice(vOff + rb, n).join('')}</text>`;
  for (let b = 0; b < tc; b++) {
    const [X] = g.org(0, b);
    for (let c = 0; c < nc; c++)
      s += `<text class="km-hd" x="${X + c * S + S / 2}" y="${rd(Y0 - 10 * z)}" text-anchor="middle">${code(g.cols[c], cb)}</text>`;
    if (tc > 1)
      s += `<text class="km-tl" x="${X + (nc * S) / 2}" y="16" text-anchor="middle">${VN[n === 6 ? 1 : 0]} = ${fmtV(b as Val, nt)}</text>`;
  }
  for (let a = 0; a < tr; a++) {
    const [, Y] = g.org(a, 0);
    for (let r = 0; r < nr; r++)
      s += `<text class="km-hd" x="${rd(X0 - 10 * z)}" y="${rd(Y + r * S + S / 2 + 5 * z)}" text-anchor="end">${code(g.rows[r], rb)}</text>`;
    if (tr > 1) s += `<text class="km-tl" x="8" y="${Y + (nr * S) / 2 + 5}">${VN[0]} = ${fmtV(a as Val, nt)}</text>`;
  }
  /* マス */
  for (let a = 0; a < tr; a++)
    for (let b = 0; b < tc; b++) {
      const [X, Y] = g.org(a, b);
      for (let r = 0; r < nr; r++)
        for (let c = 0; c < nc; c++) {
          const k = g.at(a, b, r, c),
            v = f[k];
          s += `<g class="km-c v${v}" data-k="${k}"><rect x="${X + c * S}" y="${Y + r * S}" width="${S}" height="${S}"/>`;
          s += `<text class="km-cv" x="${X + c * S + S / 2}" y="${rd(Y + r * S + S / 2 + 6 * z)}" text-anchor="middle">${fmtV(v, nt)}</text>`;
          if (opt.idx !== false && S >= 40)
            s += `<text class="km-ci" x="${X + c * S + 4}" y="${Y + r * S + 13}">${k}</text>`;
          s += '</g>';
        }
      s += `<rect class="km-fr" x="${X}" y="${Y}" width="${nc * S}" height="${nr * S}"/>`;
    }
  /* 囲み */
  for (let a = 0; a < tr; a++)
    for (let b = 0; b < tc; b++) {
      let p = '';
      loops.forEach((lp, x) => {
        const inset = lp.inset ?? (S >= 40 ? 4 + (x % 4) * 3 : 2);
        for (const [rx, ry, rw, rh] of loopRects(lp.t, g, a, b, inset))
          p += `<rect class="km-lp k${lp.c % 8}${lp.cls ? ` ${lp.cls}` : ''}" data-t="${lp.c}" x="${rd(rx)}" y="${rd(ry)}" width="${rd(rw)}" height="${rd(rh)}" rx="${rd(Math.min(14, S / 3))}"/>`;
      });
      if (p) s += `<g clip-path="url(#${id}-${a}${b})">${p}</g>`;
    }
  if (opt.extra) s += opt.extra(g);
  return `${s}</svg>`;
}

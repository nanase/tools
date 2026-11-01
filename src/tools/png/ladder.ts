/**
 * 行の符号化: 選んだ行の N バイトを、画素 → 上の行・この行 → フィルタ 5 種の差 → バイト → 記号 → ビット数の順に、
 * バイトの位置をそろえて縦に積む。バイトに指を乗せると、予測に使う a・b・c と、そのバイトを含む記号の符号を下に出す
 */
import { bitStr } from '../../lib/imgfmt/bits';
import { paeth } from './filter';
import {
  bytePixels,
  channelOf,
  filterName,
  type Model,
  rawRowPos,
  rowPass,
  rowPixelXY,
  rowStartPos,
  sgn,
} from './model';
import { TK_END, TK_LIT, TK_MATCH, TK_STORED, tokenAtPos } from './trace';

const FC = ['var(--f0)', 'var(--f1)', 'var(--f2)', 'var(--f3)', 'var(--f4)'];
const h2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');
const ms = (v: number): string => (v < 0 ? `−${-v}` : String(v));
const cnt = (v: number): string => v.toLocaleString('en');

/** 行の符号化で見ている所 */
export interface LadderSel {
  row: number;
  /** 窓の最初のバイト（行の中の番号） */
  x0: number;
  /** 窓のバイト数 */
  n: number;
  /** 指を乗せたバイト（窓の中の番号） */
  hb: number;
}

/** 窓の中の記号 [番号, 窓の中の始まり, 終わり] */
type Span = [number, number, number];

/** 一致の距離を、行と画素で言い換える */
export function distLabel(m: Model, row: number, dist: number): string {
  const [p] = rowPass(m.layout, row),
    stride = p.rowBytes + 1,
    bpp = m.layout.bitsPerPixel / 8;
  if (dist % stride === 0) return `↑ ${dist / stride} 行上`;
  if (bpp >= 1 && dist < p.rowBytes && dist % bpp === 0) return `← ${dist / bpp} 画素`;
  return `距離 ${dist}`;
}

/** 5 種の予測（9.2・9.4） */
function preds(a: number, b: number, c: number): number[] {
  return [0, a, b, (a + b) >> 1, paeth(a, b, c)];
}

export class Ladder {
  private m: Model | null = null;
  private s: LadderSel = { row: 0, x0: 0, n: 32, hb: 0 };
  private spans: Span[] = [];

  constructor(
    private readonly el: HTMLElement,
    private readonly det: HTMLElement,
    private readonly tags: { row: HTMLElement; x: HTMLElement; f: HTMLElement; bits: HTMLElement },
    /** 指を乗せた記号が変わった（ハフマン表に印を付ける） */
    private readonly onToken: (i: number) => void,
  ) {
    el.addEventListener('pointerover', (e) => {
      const c = (e.target as Element).closest<HTMLElement>('[data-j]');
      if (c) this.hover(Number(c.dataset.j));
    });
  }

  /** 行の上と今のバイト（上の行がなければ 0） */
  private bytes(): { cur: Uint8Array; up: Uint8Array | null } {
    const m = this.m as Model,
      L = m.layout,
      [p, py] = rowPass(L, this.s.row),
      o = rawRowPos(L, this.s.row);
    return {
      cur: m.raw.subarray(o, o + p.rowBytes),
      up: py > 0 ? m.raw.subarray(o - p.rowBytes, o) : null,
    };
  }

  render(m: Model, s: LadderSel): void {
    this.m = m;
    this.s = s;
    const L = m.layout,
      [p] = rowPass(L, s.row),
      n = Math.min(s.n, p.rowBytes - s.x0),
      bpp = L.bpp,
      ft = m.types[s.row],
      base = rowStartPos(L, s.row) + 1 + s.x0,
      { cur, up } = this.bytes(),
      j0 = s.x0;
    this.el.style.setProperty('--n', String(n));
    const span = (k: number): string => (k > 1 ? ` style="grid-column:span ${k}"` : '');
    let h = '<span class="ln">画素</span>';
    /* 画素: 深度 8 以上は画素ごとにまとめ、8 未満は 1 バイトに入る画素を並べる */
    const px = (q: number): string => {
      const [x, y] = rowPixelXY(L, s.row, q),
        o = (y * L.width + x) * 4,
        c = m.rgba;
      return `rgba(${c[o]},${c[o + 1]},${c[o + 2]},${(c[o + 3] / 255).toFixed(3)})`;
    };
    for (let j = 0; j < n; ) {
      const [a, b] = bytePixels(L, s.row, j0 + j);
      if (L.bitDepth >= 8) {
        let k = 1;
        while (j + k < n && bytePixels(L, s.row, j0 + j + k)[0] === a) k++;
        h += `<span class="c px"${span(k)}><span style="background:${px(a)}"></span></span>`;
        j += k;
      } else {
        let sw = '';
        for (let q = a; q <= b; q++) sw += `<span style="background:${px(q)}"></span>`;
        h += `<span class="c px">${sw}</span>`;
        j++;
      }
    }
    h += '<span></span><span></span>';
    for (let j = 0; j < n; j++) {
      const c = channelOf(L, j0 + j),
        [a, b] = bytePixels(L, s.row, j0 + j);
      h += `<span class="c ch">${c ?? (a === b || j % 2 === 0 ? a : '')}</span>`;
    }
    h += '<span></span>';
    /* フィルタ */
    h += '<div class="hd">フィルタ<span>予測との差</span></div><span class="ln">上の行</span>';
    for (let j = 0; j < n; j++)
      h += `<span class="c${up ? '' : ' z'}" data-j="${j}" data-r="u">${up ? up[j0 + j] : 0}</span>`;
    h += '<span class="sum"></span><span class="ln">この行</span>';
    for (let j = 0; j < n; j++) h += `<span class="c" data-j="${j}" data-r="x">${cur[j0 + j]}</span>`;
    h += '<span class="sum">行全体の Σ|差|</span>';
    const sums = [0, 1, 2, 3, 4].map((f) => m.sums[s.row * 5 + f]),
      smx = Math.max(1, ...sums);
    for (let f = 0; f < 5; f++) {
      const on = f === ft;
      h += `<span class="ln${on ? ' on' : ''}"><i style="background:${FC[f]}"></i>${filterName(f)}</span>`;
      for (let j = 0; j < n; j++) {
        const i = j0 + j,
          a = i >= bpp ? cur[i - bpp] : 0,
          b = up ? up[i] : 0,
          c = up && i >= bpp ? up[i - bpp] : 0,
          v = sgn((cur[i] - preds(a, b, c)[f]) & 255),
          k = Math.min(1, Math.abs(v) / 48);
        h += `<span class="c${v === 0 ? ' z' : ''}${on ? ' on' : ''}" data-j="${j}"${v ? ` style="background:color-mix(in srgb,${FC[f]} ${Math.round(12 + k * 50)}%,var(--surface))"` : ''}>${ms(v)}</span>`;
      }
      h += `<span class="sum${on ? ' on' : ''}"><u style="width:${(Math.sqrt(sums[f] / smx) * 3).toFixed(2)}em"></u>${cnt(sums[f])}${on ? ' ✓' : ''}</span>`;
    }
    /* 記号 */
    h += `<div class="hd">LZ77<span>${filterName(ft)} の差の並び → 文字と一致</span></div><span class="ln">バイト</span>`;
    for (let j = 0; j < n; j++) h += `<span class="c" data-j="${j}">${h2(m.filtered[base + j])}</span>`;
    h += '<span></span><span class="ln">記号</span>';
    const T = m.trace.tokens;
    this.spans = [];
    for (let i = Math.max(0, tokenAtPos(T, base)); i < T.count && T.pos[i] < base + n; i++) {
      const k = T.kind[i];
      if (k === TK_END) continue;
      const len = k === TK_LIT ? 1 : T.len[i],
        a = Math.max(0, T.pos[i] - base),
        b = Math.min(n, T.pos[i] + len - base);
      if (b > a) this.spans.push([i, a, b]);
    }
    let tot = 0;
    for (const [i, a, b] of this.spans) {
      const k = T.kind[i],
        len = k === TK_LIT ? 1 : T.len[i],
        cl = T.pos[i] < base ? ' cl' : '',
        cr = T.pos[i] + len > base + n ? ' cr' : '',
        lab =
          k === TK_LIT
            ? h2(T.sym[i])
            : k === TK_MATCH
              ? `${cl ? '…' : ''}一致 ${len} · ${distLabel(m, s.row, T.dist[i])}`
              : `${cl ? '…' : ''}そのまま ${len}`;
      h += `<span class="tk ${k === TK_LIT ? 'l' : k === TK_MATCH ? 'm' : 's'}${cl}${cr}"${span(b - a)} data-t="${i}" data-j="${a}" title="${k === TK_MATCH ? `長さ ${len} · 距離 ${T.dist[i]}` : ''}">${lab}</span>`;
      tot += (T.nbits[i] * (b - a)) / len;
    }
    h += '<span></span><span class="ln">ビット</span>';
    for (const [i, a, b] of this.spans) {
      const k = T.kind[i];
      h += `<span class="c bt ${k === TK_LIT ? 'l' : k === TK_MATCH ? 'm' : ''}"${span(b - a)} data-j="${a}">${T.nbits[i]}</span>`;
    }
    h += `<span class="sum on">${Math.round(tot)} / ${n * 8}</span>`;
    this.el.innerHTML = h;
    this.tags.row.textContent = String(s.row);
    const [pa] = bytePixels(L, s.row, j0),
      [, pb] = bytePixels(L, s.row, j0 + n - 1);
    this.tags.x.textContent = `${pa}–${pb}`;
    this.tags.f.textContent = filterName(ft);
    this.tags.bits.textContent = `${Math.round(tot)} / ${n * 8}`;
    this.hover(Math.min(s.hb, n - 1));
  }

  hover(j: number): void {
    const m = this.m;
    if (!m) return;
    this.s.hb = j;
    const L = m.layout,
      el = this.el,
      s = this.s;
    for (const c of el.querySelectorAll<HTMLElement>('.hv,.nb')) {
      c.classList.remove('hv', 'nb');
      delete c.dataset.nb;
    }
    const mark = (r: string, jj: number, nb?: string): void => {
      const c = el.querySelector<HTMLElement>(`[data-r="${r}"][data-j="${jj}"]`);
      if (!c) return;
      if (nb) {
        c.classList.add('nb');
        c.dataset.nb = nb;
      } else c.classList.add('hv');
    };
    const bpp = L.bpp,
      i = s.x0 + j;
    for (const c of el.querySelectorAll(`.c[data-j="${j}"]:not([data-r]):not(.bt)`)) c.classList.add('hv');
    mark('x', j);
    if (i >= bpp) mark('x', j - bpp, 'a');
    mark('u', j, 'b');
    if (i >= bpp) mark('u', j - bpp, 'c');
    const { cur, up } = this.bytes(),
      x = cur[i],
      a = i >= bpp ? cur[i - bpp] : 0,
      b = up ? up[i] : 0,
      c = up && i >= bpp ? up[i - bpp] : 0,
      P = preds(a, b, c),
      ft = m.types[s.row],
      [pa, pb] = bytePixels(L, s.row, i),
      ch = channelOf(L, i);
    const pp = a + b - c,
      pr = P[4],
      fr = [
        '0',
        `a = ${a}`,
        `b = ${b}`,
        `⌊(a + b) / 2⌋ = ${P[3]}`,
        `p = a + b − c = ${pp} → ${pr === a ? 'a' : pr === b ? 'b' : 'c'} = ${pr}`,
      ];
    let d = `<div><h3>フィルタ · 画素 ${pa === pb ? pa : `${pa}–${pb}`}${ch ? ` の ${ch}` : ''}</h3><p class="eq">x = <b>${x}</b> · a 左 = ${a} · b 上 = ${b} · c 左上 = ${c}</p><dl class="kv">`;
    for (let f = 0; f < 5; f++) {
      const on = f === ft ? ' class="on"' : '';
      d += `<dt${on}>${filterName(f)}</dt><dd${on}>予測 ${fr[f]}</dd><dd class="r${f === ft ? ' on' : ''}">${ms(sgn((x - P[f]) & 255))}</dd>`;
    }
    d += '</dl></div>';
    /* 記号 */
    const T = m.trace.tokens,
      sp = this.spans.find(([, a0, b0]) => j >= a0 && j < b0);
    if (sp) {
      const ti = sp[0],
        k = T.kind[ti],
        len = k === TK_LIT ? 1 : T.len[ti];
      for (const e of el.querySelectorAll(`.tk[data-t="${ti}"]`)) e.classList.add('hv');
      const blk = m.trace.blocks[T.block[ti]];
      let freq = 0;
      if (blk)
        for (let q = blk.tokenStart; q < blk.tokenEnd; q++)
          if (T.kind[q] === k && (k === TK_LIT ? T.sym[q] === T.sym[ti] : k === TK_MATCH && T.sym[q] === T.sym[ti]))
            freq++;
      const code = k === TK_STORED ? '' : bitStr(T.code[ti], T.codeLen[ti]),
        ex =
          k === TK_MATCH
            ? [
                bitStr(T.lenExtra[ti], T.lenExtraBits[ti]),
                bitStr(T.dcode[ti], T.dcodeLen[ti]),
                bitStr(T.distExtra[ti], T.distExtraBits[ti]),
              ]
            : [];
      d += `<div><h3>記号とハフマン符号 · ブロック ${T.block[ti] + 1}</h3><dl class="kv">`;
      if (k === TK_LIT)
        d += `<dt>記号</dt><dd>文字 ${h2(T.sym[ti])}</dd><dd></dd><dt>出た数</dt><dd>このブロックで ${cnt(freq)} 回</dd><dd></dd>`;
      else if (k === TK_MATCH)
        d += `<dt>記号</dt><dd>一致 長さ ${len} · 距離 ${T.dist[ti]}</dd><dd></dd><dt>距離</dt><dd>${distLabel(m, s.row, T.dist[ti])}</dd><dd></dd>`;
      else d += `<dt>記号</dt><dd>stored のブロックのバイト ${len} 個</dd><dd></dd><dt></dt><dd></dd><dd></dd>`;
      d += `<dt>符号</dt><dd><b>${code || '—'}</b>${ex.filter(Boolean).length ? ` + ${ex.filter(Boolean).join(' ')}` : ''}</dd><dd class="r">${T.nbits[ti]} ビット</dd>`;
      d += `<dt>1 バイトあたり</dt><dd>${(T.nbits[ti] / len).toFixed(2)} ビット</dd><dd class="r">元は 8</dd></dl></div>`;
      this.onToken(ti);
    }
    this.det.innerHTML = d;
  }
}

/**
 * ハフマン表: ブロックごとの記号の符号の長さ。縦軸は符号の長さ [ビット]、横軸は記号
 * （文字 0〜255・終わり 256・一致の長さ 257〜285、または距離の符号 0〜29）。棒に指を乗せると、出た回数と符号を出す
 */
import { bitStr } from '../../lib/imgfmt/bits';
import { canonicalCodes } from './huffman';
import type { Model } from './model';
import { LEN_BASE, LEN_EXTRA } from './tables';
import { TK_END, TK_LIT, TK_MATCH } from './trace';

const X0 = 56,
  X1 = 990,
  Y0 = 210,
  Y1 = 14;
const cnt = (v: number): string => v.toLocaleString('en');
const h2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');

export class Huff {
  private m: Model | null = null;
  /** 見ているブロックと表（l: 文字・長さ、d: 距離） */
  blk = 0;
  tab: 'l' | 'd' = 'l';
  /** 印を付ける記号（−1 はなし） */
  private mark = -1;
  private counts = new Uint32Array(0);
  private lens: Uint8Array | null = null;
  private codes: Uint16Array = new Uint16Array(0);

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly el: {
      blk: HTMLElement;
      type: HTMLElement;
      lg: HTMLElement;
      rd: HTMLElement;
      prev: HTMLButtonElement;
      next: HTMLButtonElement;
    },
  ) {
    svg.addEventListener('pointerover', (e) => {
      const r = (e.target as Element).closest<SVGRectElement>('rect[data-i]');
      if (r) this.read(Number(r.dataset.i));
    });
    el.prev.addEventListener('click', () => this.go(this.blk - 1));
    el.next.addEventListener('click', () => this.go(this.blk + 1));
  }

  set(m: Model): void {
    this.m = m;
    this.blk = Math.min(this.blk, m.trace.blocks.length - 1);
    this.draw();
  }

  go(b: number): void {
    if (!this.m) return;
    const n = this.m.trace.blocks.length;
    if (b < 0 || b >= n || b === this.blk) return;
    this.blk = b;
    this.mark = -1;
    this.draw();
  }

  /** 記号 i の印（文字・長さの記号の番号。ブロックが違えばそのブロックへ） */
  point(tok: number): void {
    const m = this.m;
    if (!m) return;
    const T = m.trace.tokens,
      b = T.block[tok],
      k = T.kind[tok];
    if (k !== TK_LIT && k !== TK_MATCH) return;
    const sym = this.tab === 'd' ? (k === TK_MATCH ? T.dsym[tok] : -1) : T.sym[tok];
    if (b !== this.blk) {
      this.blk = b;
      this.mark = sym;
      this.draw();
    } else this.setMark(sym);
    if (sym >= 0) this.read(sym);
  }

  private setMark(sym: number): void {
    this.mark = sym;
    for (const r of this.svg.querySelectorAll('rect.hv')) r.classList.remove('hv');
    if (sym >= 0) this.svg.querySelector(`rect[data-i="${sym}"]`)?.classList.add('hv');
  }

  /** 棒の読み値 */
  private read(i: number): void {
    const L = this.lens;
    if (!L?.[i]) {
      this.el.rd.textContent = '';
      return;
    }
    let nm: string;
    if (this.tab === 'd') nm = `距離の符号 ${i}`;
    else if (i < 256) nm = `文字 ${h2(i)}`;
    else if (i === 256) nm = '終わり 256';
    else {
      const a = LEN_BASE[i - 257],
        b = a + (1 << LEN_EXTRA[i - 257]) - 1;
      nm = `長さの符号 ${i}（${a === b ? a : `${a}〜${b}`}）`;
    }
    this.el.rd.textContent = `${nm} · ${cnt(this.counts[i])} 回 · ${L[i]} ビット ${bitStr(this.codes[i], L[i])}`;
    this.setMark(i);
  }

  private draw(): void {
    const m = this.m;
    if (!m) return;
    const B = m.trace.blocks,
      blk = B[this.blk],
      T = m.trace.tokens,
      d = this.tab === 'd';
    this.el.blk.textContent = `${this.blk + 1} / ${B.length}`;
    this.el.prev.disabled = this.blk <= 0;
    this.el.next.disabled = this.blk >= B.length - 1;
    this.el.type.textContent = blk ? `${blk.type} · ${cnt(blk.end - blk.start)} ビット` : '—';
    this.el.rd.textContent = '';
    const L = blk ? (d ? blk.distLens : blk.litLens) : null;
    this.lens = L;
    let s = '';
    if (!blk || !L) {
      s = `<text class="msg" x="500" y="120" text-anchor="middle">stored のブロック · ハフマン符号なし</text>`;
      this.svg.innerHTML = s;
      this.el.lg.innerHTML = '';
      return;
    }
    const n = d ? 30 : 286,
      w = (X1 - X0) / n,
      y = (b: number): number => Y0 - ((Y0 - Y1) * b) / 15;
    this.codes = canonicalCodes(L);
    this.counts = new Uint32Array(n);
    for (let i = blk.tokenStart; i < blk.tokenEnd; i++) {
      const k = T.kind[i];
      if (d) {
        if (k === TK_MATCH) this.counts[T.dsym[i]]++;
      } else if (k === TK_LIT || k === TK_MATCH || k === TK_END) this.counts[T.sym[i]]++;
    }
    for (const b of [1, 3, 5, 7, 9, 11, 13, 15])
      s += `<line class="gl" x1="${X0}" x2="${X1}" y1="${y(b)}" y2="${y(b)}"/><text class="tl" x="${X0 - 8}" y="${y(b) + 5}" text-anchor="end">${b}</text>`;
    s += `<text class="tl" x="16" y="${(Y0 + Y1) / 2}" transform="rotate(-90 16 ${(Y0 + Y1) / 2})" text-anchor="middle">符号の長さ [ビット]</text>`;
    for (let i = 0; i < n; i++) {
      const c = d ? 'var(--mat)' : i < 256 ? 'var(--lit)' : i === 256 ? 'var(--ink)' : 'var(--mat)',
        x = (X0 + i * w).toFixed(2),
        bw = Math.max(1, w * 0.86).toFixed(2);
      if (L[i])
        s += `<rect data-i="${i}" x="${x}" y="${y(L[i]).toFixed(1)}" width="${bw}" height="${(Y0 - y(L[i])).toFixed(1)}" fill="${c}"/>`;
      else s += `<rect class="no" x="${x}" y="${Y0 - 2}" width="${bw}" height="2"/>`;
    }
    s += `<line class="ax" x1="${X0}" x2="${X1}" y1="${Y0}" y2="${Y0}"/>`;
    const tick = (i: number, t: string, a = 'middle'): string => {
      const x = (X0 + (i + 0.43) * w).toFixed(1);
      return `<line class="ax" x1="${x}" x2="${x}" y1="${Y0}" y2="${Y0 + 5}"/><text class="tl" x="${x}" y="${Y0 + 22}" text-anchor="${a}">${t}</text>`;
    };
    if (d) {
      for (const i of [0, 4, 8, 12, 16, 20, 24, 29]) s += tick(i, String(i));
      s += `<text class="tl b" x="${(X0 + X1) / 2}" y="${Y0 + 46}" text-anchor="middle">距離の符号 0〜29（距離 1〜32768）</text>`;
    } else {
      for (const i of [0, 64, 128, 192]) s += tick(i, String(i));
      s += tick(256, '終', 'start') + tick(285, '285', 'end');
      s += `<text class="tl b" x="${X0 + 128 * w}" y="${Y0 + 46}" text-anchor="middle">文字 0〜255（バイトの値）</text><text class="tl b" x="${X0 + 271 * w}" y="${Y0 + 46}" text-anchor="middle">長さ 257〜285</text>`;
    }
    this.svg.innerHTML = s;
    this.el.lg.innerHTML = d
      ? '<span class="leg"><i style="background:var(--mat)"></i>距離 · 多く出る記号ほど短い符号</span>'
      : '<span class="leg"><i style="background:var(--lit)"></i>文字<i style="background:var(--ink)"></i>終わり<i style="background:var(--mat)"></i>一致の長さ · 多く出る記号ほど短い符号</span>';
    if (this.mark >= 0) this.setMark(this.mark);
  }

  /** 表を切り替える */
  setTab(t: 'l' | 'd'): void {
    this.tab = t;
    this.mark = -1;
    this.draw();
  }
}

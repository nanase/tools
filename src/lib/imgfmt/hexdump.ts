/**
 * 範囲に色を付けた 16 進ダンプ。見える行だけを描くので、数 MB のファイルでも重くならない。
 * 範囲の色はページの CSS で .hx-<cls> に付ける（共通の形は hexdump.css）。
 * PNG・GIF・画像の破損のページで使う
 */

/** 色を付ける範囲 [start, end) */
export interface HexRange {
  start: number;
  end: number;
  /** 付けるクラス（hx- を前に付けて使う） */
  cls: string;
}

export interface HexOpts {
  /** 1 行のバイト数 */
  cols?: number;
  /** 1 行の高さ [px]（CSS の .hx-row の高さと合わせる） */
  rowH?: number;
  /** 見える高さ [行] */
  rows?: number;
  /** バイトに指を乗せた・離した（null） */
  onHover?: (off: number | null) => void;
  /** バイトを押した */
  onPick?: (off: number) => void;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).toUpperCase().padStart(2, '0'));
/** 表示できる ASCII（0x20〜0x7E）はその字、ほかは「.」 */
const ASC = Array.from({ length: 256 }, (_, i) =>
  i >= 0x20 && i < 0x7f
    ? String.fromCharCode(i).replace(/[&<>]/, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
    : '.',
);

/** end が off より大きい最初の範囲の番号（範囲は start の昇順で重ならない。ないなら R.length） */
export function firstAfter(R: readonly HexRange[], off: number): number {
  let lo = 0,
    hi = R.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (R[m].end <= off) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** 1 行の HTML（範囲の色・印を付けた範囲 [ms, me)） */
export function rowHtml(
  b: Uint8Array,
  R: readonly HexRange[],
  row: number,
  cols: number,
  ms: number,
  me: number,
): string {
  const s = row * cols,
    e = Math.min(b.length, s + cols);
  let hx = '',
    as = '',
    ri = firstAfter(R, s);
  for (let i = s; i < e; i++) {
    while (ri < R.length && R[ri].end <= i) ri++;
    const r = ri < R.length && R[ri].start <= i ? R[ri] : null;
    const c = `${r ? `hx-${r.cls}` : ''}${i >= ms && i < me ? ' hx-on' : ''}`;
    hx += `<span data-o="${i}"${c ? ` class="${c}"` : ''}>${HEX[b[i]]}</span>`;
    as += `<span data-o="${i}"${c ? ` class="${c}"` : ''}>${ASC[b[i]]}</span>`;
  }
  return `<span class="hx-off">${s.toString(16).toUpperCase().padStart(6, '0')}</span><span class="hx-b">${hx}</span><span class="hx-a">${as}</span>`;
}

/** 16 進ダンプの表示。root の中身は作り直す */
export class HexView {
  private b = new Uint8Array(0);
  private R: readonly HexRange[] = [];
  private ms = 0;
  private me = 0;
  private readonly cols: number;
  private readonly rowH: number;
  private readonly box: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private drawn = '';
  private raf = 0;

  constructor(
    root: HTMLElement,
    private readonly o: HexOpts = {},
  ) {
    this.cols = o.cols ?? 16;
    this.rowH = o.rowH ?? 20;
    root.classList.add('hx');
    root.style.setProperty('--hx-cols', String(this.cols));
    root.style.setProperty('--hx-row', `${this.rowH}px`);
    root.style.setProperty('--hx-rows', String(o.rows ?? 16));
    this.box = document.createElement('div');
    this.box.className = 'hx-box';
    this.box.tabIndex = 0;
    this.body = document.createElement('div');
    this.body.className = 'hx-body';
    this.box.append(this.body);
    root.replaceChildren(this.box);
    this.box.addEventListener('scroll', () => this.later());
    const at = (e: Event): number | null => {
      const t = (e.target as Element).closest?.('[data-o]');
      return t ? Number((t as HTMLElement).dataset.o) : null;
    };
    this.box.addEventListener('pointermove', (e) => o.onHover?.(at(e)));
    this.box.addEventListener('pointerleave', () => o.onHover?.(null));
    this.box.addEventListener('click', (e) => {
      const v = at(e);
      if (v !== null) o.onPick?.(v);
    });
  }

  /** 中身を入れ替える（範囲は start の昇順で重ならないこと） */
  set(b: Uint8Array, R: readonly HexRange[]): void {
    this.b = b;
    this.R = R;
    this.body.style.height = `${Math.ceil(b.length / this.cols) * this.rowH}px`;
    this.drawn = '';
    this.draw();
  }

  /** 印を付ける範囲 [s, e)。見えていなければ、そこまで送る */
  mark(s: number, e: number, scroll = true): void {
    this.ms = s;
    this.me = e;
    if (scroll && e > s) this.show(s);
    this.drawn = '';
    this.draw();
  }

  /** 位置 off の行が見えるように送る */
  show(off: number): void {
    const y = Math.floor(off / this.cols) * this.rowH,
      t = this.box.scrollTop,
      h = this.box.clientHeight;
    if (y < t || y + this.rowH > t + h) this.box.scrollTop = Math.max(0, y - h / 3);
  }

  private later(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private draw(): void {
    const n = Math.ceil(this.b.length / this.cols),
      t = this.box.scrollTop,
      h = this.box.clientHeight || this.rowH * 16,
      r0 = Math.max(0, Math.floor(t / this.rowH) - 4),
      r1 = Math.min(n, Math.ceil((t + h) / this.rowH) + 4),
      key = `${r0}:${r1}`;
    if (key === this.drawn) return;
    this.drawn = key;
    let s = '';
    for (let r = r0; r < r1; r++)
      s += `<div class="hx-row" style="top:${r * this.rowH}px">${rowHtml(this.b, this.R, r, this.cols, this.ms, this.me)}</div>`;
    this.body.innerHTML = s;
  }
}

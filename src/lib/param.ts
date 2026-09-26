/**
 * 数値入力の行（▼ 前の値 | 入力欄 | ▲ 次の値、スライダー、プリセット）の動作。
 * 入力中は値を動かさず、Enter か欄の外で確定する。
 */
import { $, $$ } from './dom';
import { eList, linList, nearIdx, nextOf, prevOf, type Series, same } from './eseries';
import { fmt, parts } from './format';
import type { ParamDef } from './param-def';
import { parse } from './parse';

class Param {
  v: number;
  dirty = false;
  list: number[] = [];
  private readonly row: HTMLElement;
  private readonly inp: HTMLInputElement;
  private readonly rng: HTMLInputElement;
  private readonly tkEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly chips: HTMLButtonElement[];
  private readonly dnB: HTMLButtonElement;
  private readonly upB: HTMLButtonElement;

  constructor(
    readonly d: ParamDef,
    private readonly g: ParamGroup,
  ) {
    const r = $(`#p-${d.k}`);
    this.row = r;
    this.inp = $('.fld input', r);
    this.rng = $('.sl input', r);
    this.tkEl = $('.tk', r);
    this.msgEl = $('.msg', r);
    this.chips = $$('.chip', r);
    this.dnB = $('.stp[data-d="-1"]', r);
    this.upB = $('.stp[data-d="1"]', r);
    this.v = d.v;
    this.bind();
  }

  /** E 系列に吸着する項目か */
  get e(): boolean {
    return !this.d.lin;
  }

  private shortV(v: number): string {
    if (!this.e) return String(v);
    const [n, x] = parts(v, '', 3);
    return n + x;
  }
  private inText(v: number): string {
    if (!this.e) return String(Number(v.toPrecision(4)));
    const [n, x] = parts(v, '', 4);
    return x ? `${n} ${x}` : n;
  }
  private msg(cls: '' | 'pv' | 'er', text: string): void {
    this.msgEl.className = `msg${cls ? ` ${cls}` : ''}`;
    this.msgEl.textContent = text;
  }
  private idle(): void {
    this.msg('', this.e && !this.list.some((x) => same(x, this.v)) ? `E${this.g.series} にない値` : '');
  }

  buildList(): void {
    const { d } = this,
      s = this.g.series;
    this.list = d.lin ? linList(d.min, d.max, d.lin.step) : eList(s, d.min, d.max);
    const n = this.list.length - 1,
      pos = (v: number) => `${((nearIdx(this.list, v, this.e) / n) * 100).toFixed(3)}%`;
    this.rng.max = String(n);
    let h = '';
    if (d.lin) {
      const per = Math.round(d.lin.major / d.lin.big);
      for (let i = Math.ceil(d.min / d.lin.big); i * d.lin.big <= d.max + 1e-9; i++)
        h += `<i class="${i % per ? '' : 'M'}" style="left:${pos(i * d.lin.big)}"></i>`;
    } else {
      if (n <= 55) h += this.list.map((_, i) => `<i style="left:${((i / n) * 100).toFixed(3)}%"></i>`).join('');
      for (let e = Math.round(Math.log10(d.min)); e <= Math.round(Math.log10(d.max)); e++)
        h += `<i class="M" style="left:${pos(10 ** e)}"></i>`;
    }
    h += d.tk.map(([v, l]) => `<span style="left:${pos(v)}">${l}</span>`).join('');
    this.tkEl.innerHTML = h;
    this.inp.title =
      `${fmt(d.min, d.unit)} – ${fmt(d.max, d.unit)}　` +
      (d.lin
        ? `↑↓: ±${d.lin.step} ${d.unit}（Shift で ±${d.lin.big} ${d.unit}）　Enter: 確定　Esc: 戻す`
        : `↑↓: E${s} の隣の値　PgUp/PgDn: 10 倍・1/10　Enter: 確定　Esc: 戻す`);
  }

  private syncSlider(): void {
    const i = nearIdx(this.list, this.v, this.e),
      n = this.list.length - 1;
    this.rng.value = String(i);
    this.rng.style.setProperty('--p', (i / n).toFixed(4));
    this.rng.setAttribute('aria-valuetext', fmt(this.v, this.d.unit));
  }

  private syncSteps(): void {
    const { d } = this,
      dn = prevOf(this.list, this.v),
      up = nextOf(this.list, this.v);
    const lab = d.lin ? `${d.lin.step} ${d.unit}` : `E${this.g.series} で`;
    (
      [
        [this.dnB, dn, '下'],
        [this.upB, up, '上'],
      ] as const
    ).forEach(([b, v, w]) => {
      $('small', b).textContent = v == null ? '—' : this.shortV(v);
      b.setAttribute('aria-disabled', String(v == null));
      b.setAttribute(
        'aria-label',
        v == null ? `${d.nm}: これ以上${w}げられません` : `${d.nm} を${lab}1 つ${w}の ${fmt(v, d.unit)} へ`,
      );
    });
  }

  /** E 系列が変わったとき */
  reseries(): void {
    this.buildList();
    this.syncSlider();
    this.syncSteps();
    if (!this.dirty && !this.row.classList.contains('bad')) this.idle();
  }

  set(v: number, src?: 'slider' | 'step', silent = false): void {
    const { d } = this;
    this.v = v;
    this.dirty = false;
    this.row.classList.remove('dirty', 'bad');
    this.inp.removeAttribute('aria-invalid');
    this.inp.value = this.inText(v);
    if (src !== 'slider') this.syncSlider();
    else {
      this.rng.style.setProperty('--p', (+this.rng.value / (this.list.length - 1)).toFixed(4));
      this.rng.setAttribute('aria-valuetext', fmt(v, d.unit));
    }
    for (const b of this.chips) b.setAttribute('aria-pressed', String(same(Number(b.dataset.v), v)));
    this.syncSteps();
    this.idle();
    if (!silent) this.g.changed();
  }

  private commit(onBlur: boolean): boolean {
    const { d } = this,
      raw = this.inp.value.trim();
    if (!this.dirty) return true;
    const v = parse(raw, d.unit);
    if (!(v > 0)) {
      if (onBlur || !raw) {
        this.set(this.v);
        if (raw) this.msg('er', `「${raw}」を読めないため元に戻しました`);
        return false;
      }
      this.row.classList.add('bad');
      this.row.classList.remove('dirty');
      this.inp.setAttribute('aria-invalid', 'true');
      this.msg('er', '読めない値です（例 4.7k・4k7・100n・1e3）');
      return false;
    }
    const w = Math.min(d.max, Math.max(d.min, v));
    this.set(w);
    if (!same(w, v))
      this.msg('er', `${fmt(v, d.unit)} は範囲外のため${w === d.max ? '上限' : '下限'} ${fmt(w, d.unit)} にしました`);
    return true;
  }

  private step(dir: 1 | -1, big: boolean): void {
    const { d } = this;
    if (this.dirty && !this.commit(false)) return;
    const clamp = (x: number) => Math.min(d.max, Math.max(d.min, x));
    let v: number | undefined;
    if (big && d.lin) v = clamp(Number((this.v + dir * d.lin.big).toPrecision(12)));
    else if (big) v = clamp(Number((this.v * 10 ** dir).toPrecision(12)));
    else v = dir > 0 ? nextOf(this.list, this.v) : prevOf(this.list, this.v);
    if (v != null && !same(v, this.v)) this.set(v, 'step');
  }

  private bind(): void {
    const { d, inp, row: r } = this;
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('input', () => {
      this.dirty = true;
      r.classList.add('dirty');
      r.classList.remove('bad');
      inp.removeAttribute('aria-invalid');
      const t = inp.value.trim(),
        v = parse(t, d.unit);
      if (!t) this.msg('', '');
      else if (!(v > 0)) this.msg('', '…');
      else if (v < d.min * (1 - 1e-9) || v > d.max * (1 + 1e-9))
        this.msg(
          'pv',
          `→ ${fmt(v, d.unit)}（${v > d.max ? '上限' : '下限'} ${fmt(v > d.max ? d.max : d.min, d.unit)} に丸めます）`,
        );
      else this.msg('pv', `→ ${fmt(v, d.unit, 5)}`);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.commit(false)) inp.select();
      } else if (e.key === 'Escape') {
        if (this.dirty || r.classList.contains('bad')) {
          e.preventDefault();
          this.set(this.v);
          inp.select();
        }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey && !this.e);
        inp.select();
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        this.step(e.key === 'PageUp' ? 1 : -1, true);
        inp.select();
      }
    });
    inp.addEventListener('blur', () => {
      if (this.dirty) this.commit(true);
    });
    bindRepeat(this.dnB, (big) => this.step(-1, big && !this.e));
    bindRepeat(this.upB, (big) => this.step(1, big && !this.e));
    this.rng.addEventListener('input', () => this.set(this.list[+this.rng.value], 'slider'));
    for (const b of this.chips) b.addEventListener('click', () => this.set(Number(b.dataset.v)));
  }
}

/** 押し続けると繰り返す（420 ms 後から 90 ms ごと） */
function bindRepeat(btn: HTMLElement, fn: (big: boolean) => void): void {
  let t1: ReturnType<typeof setTimeout> | undefined, t2: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearTimeout(t1);
    clearInterval(t2);
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stop();
    fn(e.shiftKey);
    t1 = setTimeout(() => {
      t2 = setInterval(() => fn(false), 90);
    }, 420);
  });
  for (const n of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(n, stop);
  addEventListener('pointerup', stop);
  btn.addEventListener('click', (e) => {
    if (e.detail === 0) fn(e.shiftKey);
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** 入力の行のまとまり。E 系列の切替を共有し、値が確定するたびに onChange を呼ぶ */
export class ParamGroup<K extends string = string> {
  series: Series = 12;
  private readonly ps: Param[];

  constructor(
    defs: readonly ParamDef[],
    private readonly onChange: (v: Record<K, number>) => void,
    seriesEl?: HTMLElement | null,
  ) {
    const on = seriesEl?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (on) this.series = Number(on.dataset.s) as Series;
    this.ps = defs.map((d) => new Param(d, this));
    for (const p of this.ps) {
      p.buildList();
      p.set(p.v, undefined, true);
    }
    seriesEl?.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-s]');
      if (!b) return;
      this.series = Number(b.dataset.s) as Series;
      for (const x of $$('button', seriesEl)) x.setAttribute('aria-pressed', String(x === b));
      for (const p of this.ps) if (p.e) p.reseries();
    });
    this.changed();
  }

  values(): Record<K, number> {
    return Object.fromEntries(this.ps.map((p) => [p.d.k, p.v])) as Record<K, number>;
  }

  changed(): void {
    this.onChange(this.values());
  }
}

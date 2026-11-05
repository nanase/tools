/**
 * 日時の選択（components/DatePicker.astro の動作）。選ぶとすぐ反映するので、確定の操作はない。
 * 開閉は popover 属性に任せる（枠の外を押す・Esc で閉じる）
 */
import type { Cal } from './astro/time';
import { addMonths, type DateField, type DateTime, monthCells, setField, stepField } from './date-picker-core';
import { $, $$ } from './dom';

const p2 = (n: number) => String(n).padStart(2, '0');
const show = (k: DateField, v: DateTime) => (k === 'year' ? String(v.year) : p2(v[k]));

/** 枠の高さの初期値 [px]。開く前は測れないので、開いた後に測り直す */
const POP_H = 440;
const MARGIN = 8;
const WHEEL_MONTH_MS = 180;
const WHEEL_FIELD_MS = 60;

export interface DatePickerOptions {
  /** 表示の時刻帯での今の値 */
  get: () => DateTime;
  set: (v: DateTime) => void;
  /** 表示の時刻帯での今日 */
  today: () => Cal;
}

/** ホイールの 1 回を間引く。トラックパッドは 1 回の動きで何十回も発火する */
function onWheelStep(el: HTMLElement, ms: number, fn: (dir: 1 | -1) => void): void {
  let last = 0;
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.timeStamp - last < ms) return;
      last = e.timeStamp;
      fn(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
}

export class DatePicker {
  private readonly pop: HTMLElement;
  private readonly btn: HTMLElement;
  private readonly title: HTMLElement;
  private readonly days: HTMLElement;
  private readonly fields: { k: DateField; el: HTMLInputElement }[];
  private readonly opt: DatePickerOptions;
  private open = false;
  private height = POP_H;
  private shown = '';

  constructor(root: HTMLElement, opt: DatePickerOptions) {
    this.opt = opt;
    this.pop = $('.dp-pop', root);
    this.btn = $('.dp-open', root);
    this.title = $('.dp-title', root);
    this.days = $('.dp-days', root);
    this.fields = $$<HTMLInputElement>('.dp-f input', root).map((el) => ({ k: el.dataset.k as DateField, el }));

    this.pop.addEventListener('beforetoggle', (e) => {
      this.open = (e as ToggleEvent).newState === 'open';
      if (!this.open) return;
      this.place();
      this.shown = '';
      this.sync();
    });
    this.pop.addEventListener('toggle', () => {
      if (!this.open) return;
      this.height = this.pop.offsetHeight;
      this.place();
    });
    addEventListener('resize', () => {
      if (this.open) this.place();
    });

    for (const b of $$<HTMLButtonElement>('.dp-nav button', root)) {
      b.addEventListener('click', () => this.apply(addMonths(this.opt.get(), Number(b.dataset.step))));
    }
    this.days.addEventListener('click', (e) => {
      const d = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset;
      if (d) this.apply({ ...this.opt.get(), year: Number(d.y), month: Number(d.m), day: Number(d.d) });
    });
    onWheelStep(this.days, WHEEL_MONTH_MS, (dir) => this.apply(addMonths(this.opt.get(), -dir)));
    for (const f of this.fields) this.bindField(f.k, f.el);
  }

  /** 値が変わっていれば表示を更新する。ページの毎回の描画から呼ぶ */
  sync(): void {
    if (!this.open) return;
    const v = this.opt.get();
    const key = `${v.year}-${v.month}-${v.day}-${v.hour}-${v.minute}`;
    if (key === this.shown) return;
    this.render(v);
  }

  private apply(v: DateTime): void {
    this.opt.set(v);
    this.render(v);
  }

  private render(v: DateTime): void {
    this.shown = `${v.year}-${v.month}-${v.day}-${v.hour}-${v.minute}`;
    this.title.textContent = `${v.year} 年 ${v.month} 月`;
    for (const { k, el } of this.fields) {
      /* 入力の途中の欄は書き換えない */
      if (el.dataset.typing) continue;
      const s = show(k, v);
      if (el.value === s) continue;
      el.value = s;
      if (document.activeElement === el) el.select();
    }
    const t = this.opt.today();
    const cells = monthCells(v.year, v.month).map((c) => {
      const on = c.year === v.year && c.month === v.month && c.day === v.day;
      const today = c.year === t.year && c.month === t.month && c.day === t.day;
      const cls = `${c.inMonth ? '' : 'dp-out'}${on ? ' dp-on' : ''}`;
      const attrs = `${on ? ' aria-pressed="true"' : ''}${today ? ' aria-current="date"' : ''}`;
      return `<button type="button" class="${cls}" data-y="${c.year}" data-m="${c.month}" data-d="${c.day}" aria-label="${c.year} 年 ${c.month} 月 ${c.day} 日"${attrs}>${c.day}</button>`;
    });
    /* 作り直すとフォーカスが外れ、キーボードで続けられなくなる */
    const refocus = this.days.contains(document.activeElement);
    this.days.innerHTML = cells.join('');
    if (refocus) $('.dp-on', this.days).focus();
  }

  /** 桁がそろうか欄を離れた時点で反映し、桁がそろったら次の欄へ移る */
  private bindField(k: DateField, el: HTMLInputElement): void {
    const commit = () => {
      const x = Number.parseInt(el.value, 10);
      delete el.dataset.typing;
      this.apply(Number.isNaN(x) ? this.opt.get() : setField(this.opt.get(), k, x));
      el.value = show(k, this.opt.get());
    };
    el.addEventListener('focus', () => el.select());
    el.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '');
      el.dataset.typing = '1';
      if (el.value.length < el.maxLength) return;
      commit();
      const next = this.fields[this.fields.findIndex((f) => f.el === el) + 1];
      if (next) next.el.focus();
      else el.select();
    });
    el.addEventListener('blur', () => {
      if (el.dataset.typing) commit();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (el.dataset.typing) commit();
        el.select();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        delete el.dataset.typing;
        this.apply(stepField(this.opt.get(), k, e.key === 'ArrowUp' ? 1 : -1));
      }
    });
    onWheelStep(el, WHEEL_FIELD_MS, (dir) => {
      delete el.dataset.typing;
      this.apply(stepField(this.opt.get(), k, dir));
    });
  }

  /** ボタンの下へ開く。下に入らず上に入るなら上へ。ページと一緒にスクロールする */
  private place(): void {
    const r = this.btn.getBoundingClientRect();
    const width = this.pop.offsetWidth || 336;
    const left = Math.max(MARGIN, Math.min(r.left, document.documentElement.clientWidth - width - MARGIN));
    const below = r.bottom + 6 + this.height <= innerHeight;
    const above = r.top - 6 - this.height >= 0;
    const top = !below && above ? r.top - 6 - this.height : r.bottom + 6;
    this.pop.style.left = `${left + scrollX}px`;
    this.pop.style.top = `${top + scrollY}px`;
  }
}

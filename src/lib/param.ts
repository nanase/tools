/**
 * 数値入力の行（▼ 前の値 | 入力欄 | ▲ 次の値、スライダー、プリセット）の動作。
 * 入力中は値を動かさず、Enter か欄の外で確定する。描画は components/ParamRow.astro
 */
import { $, $$, esc } from './dom';
import { type Series, same } from './eseries';
import {
  accept,
  badText,
  type Fmt,
  followsGroup,
  formatter,
  keyOf,
  nearest,
  previewText,
  resolve,
  shiftIsBig,
  stepLabel,
  stepValue,
  ticksHtml,
  titleText,
  valueList,
} from './param-core';
import type { ParamDef, ParamPatch } from './param-def';
import { parse } from './parse';
import { store, stored } from './store';

export type MsgKind = '' | 'pv' | 'er';

/** 行から見たグループ */
interface Host {
  readonly series: Series;
  changed(k: string): void;
}

class Param {
  v: number;
  dirty = false;
  off = false;
  list: number[] = [];
  d: ParamDef;
  f: Fmt;
  /** off のときに出す注記 */
  offNote = '';
  private key: (x: number) => number = (x) => x;
  private readonly row: HTMLElement;
  private readonly inp: HTMLInputElement;
  private readonly rng: HTMLInputElement | null;
  private readonly tkEl: HTMLElement | null;
  private readonly msgEl: HTMLElement;
  private readonly chips: HTMLButtonElement[];
  private readonly dnB: HTMLButtonElement;
  private readonly upB: HTMLButtonElement;

  constructor(
    d: ParamDef,
    private readonly g: Host,
  ) {
    const r = $(`#p-${d.k}`);
    this.d = d;
    this.f = formatter(d);
    this.row = r;
    this.inp = $('.fld input', r);
    this.rng = r.querySelector('.sl input');
    this.tkEl = r.querySelector('.tk');
    this.msgEl = $('.msg', r);
    this.chips = $$('.chip', r);
    this.dnB = $('.stp[data-d="-1"]', r);
    this.upB = $('.stp[data-d="1"]', r);
    this.v = d.v;
    this.bind();
  }

  msg(cls: MsgKind, text: string): void {
    this.msgEl.className = `msg${cls ? ` ${cls}` : ''}`;
    this.msgEl.textContent = text;
  }
  private idle(): void {
    if (this.off) this.msg('', this.offNote);
    else
      this.msg('', followsGroup(this.d) && !this.list.some((x) => same(x, this.v)) ? `E${this.g.series} にない値` : '');
  }

  /** 並び・目盛り・title を作り直す（範囲や E 系列が変わったとき） */
  buildList(): void {
    const { d } = this,
      s = this.g.series;
    this.list = valueList(d, s);
    this.key = keyOf(d, this.list);
    if (this.rng && this.tkEl) {
      this.rng.max = String(Math.max(1, this.list.length - 1));
      this.tkEl.innerHTML = ticksHtml(d, this.list);
    }
    this.inp.title = titleText(d, s, this.f);
  }

  /** 記号・項目名・単位・placeholder を定義に合わせる */
  relabel(): void {
    const { d, row: r } = this;
    $('.c-sym', r).innerHTML = d.sym;
    $('.c-name .pn', r).innerHTML = `<span class="sr">${esc(d.nm)} </span>${esc(d.name)}`;
    $('.c-name .tip', r).textContent = d.sub;
    $('.c-unit', r).textContent = d.unit;
    this.inp.placeholder = d.ph;
    this.rng?.setAttribute('aria-label', `${d.nm} ${d.name}`);
    r.querySelector('.chips')?.setAttribute('aria-label', `${d.nm} のよく使う値`);
  }

  private syncSlider(): void {
    if (!this.rng) return;
    const i = nearest(this.list, this.key, this.v),
      n = Math.max(1, this.list.length - 1);
    this.rng.value = String(i);
    this.rng.style.setProperty('--p', (i / n).toFixed(4));
    this.rng.setAttribute('aria-valuetext', this.f.text(this.v));
  }

  private syncSteps(): void {
    const { d } = this,
      dn = stepValue(d, this.list, this.v, -1, false),
      up = stepValue(d, this.list, this.v, 1, false);
    const lab = stepLabel(d, this.g.series);
    (
      [
        [this.dnB, dn, '下'],
        [this.upB, up, '上'],
      ] as const
    ).forEach(([b, v, w]) => {
      const no = v == null || this.off;
      $('small', b).textContent = v == null ? '—' : this.f.step(v);
      b.setAttribute('aria-disabled', String(no));
      b.setAttribute(
        'aria-label',
        no ? `${d.nm}: これ以上${w}げられません` : `${d.nm} を${lab}1 つ${w}の ${this.f.text(v)} へ`,
      );
    });
  }

  /** プリセットの押下状態と、今の範囲で選べないものの無効化 */
  private syncChips(): void {
    for (const b of this.chips) {
      const cv = Number(b.dataset.v);
      b.setAttribute('aria-pressed', String(same(cv, this.v)));
      b.disabled = this.off || !same(resolve(this.d, this.list, this.f, cv).w, cv);
    }
  }

  /** 範囲・並び・表記が変わったあとに、表示だけを合わせる（値は変えない） */
  refresh(): void {
    this.buildList();
    if (!this.dirty && !this.row.classList.contains('bad')) this.inp.value = this.f.input(this.v);
    this.syncSlider();
    this.syncSteps();
    this.syncChips();
    if (!this.dirty && !this.row.classList.contains('bad')) this.idle();
  }

  update(p: ParamPatch): void {
    this.d = { ...this.d, ...p };
    this.f = formatter(this.d);
    if (['sym', 'nm', 'name', 'sub', 'unit', 'ph'].some((k) => k in p)) this.relabel();
    this.refresh();
  }

  setOff(off: boolean, note = ''): void {
    this.off = off;
    this.offNote = note;
    this.row.classList.toggle('off', off);
    this.inp.disabled = off;
    if (this.rng) this.rng.disabled = off;
    this.syncSteps();
    this.syncChips();
    if (!this.dirty) this.idle();
  }

  set(v: number, src?: 'slider' | 'step', silent = false): void {
    this.v = v;
    this.dirty = false;
    this.row.classList.remove('dirty', 'bad');
    this.inp.removeAttribute('aria-invalid');
    this.inp.value = this.f.input(v);
    if (src !== 'slider') this.syncSlider();
    else if (this.rng) {
      this.rng.style.setProperty('--p', (+this.rng.value / Math.max(1, this.list.length - 1)).toFixed(4));
      this.rng.setAttribute('aria-valuetext', this.f.text(v));
    }
    this.syncChips();
    this.syncSteps();
    this.idle();
    if (!silent) this.g.changed(this.d.k);
  }

  private commit(onBlur: boolean): boolean {
    const { d } = this,
      raw = this.inp.value.trim();
    if (!this.dirty) return true;
    const v = parse(raw, d.unit, d.sign === 'any');
    if (!accept(d, v)) {
      if (onBlur || !raw) {
        this.set(this.v, undefined, true);
        if (raw) this.msg('er', `「${raw}」を読めないため元に戻しました`);
        return false;
      }
      this.row.classList.add('bad');
      this.row.classList.remove('dirty');
      this.inp.setAttribute('aria-invalid', 'true');
      this.msg('er', badText(d));
      return false;
    }
    const r = resolve(d, this.list, this.f, v);
    this.set(r.w);
    if (r.why) this.msg('er', r.why);
    return true;
  }

  private step(dir: 1 | -1, big: boolean): void {
    if (this.off) return;
    if (this.dirty && !this.commit(false)) return;
    const v = stepValue(this.d, this.list, this.v, dir, big);
    if (v != null && !same(v, this.v)) this.set(v, 'step');
  }

  private bind(): void {
    const { inp, row: r } = this;
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('input', () => {
      const { d } = this;
      this.dirty = true;
      r.classList.add('dirty');
      r.classList.remove('bad');
      inp.removeAttribute('aria-invalid');
      const t = inp.value.trim(),
        v = parse(t, d.unit, d.sign === 'any');
      if (!t) this.msg('', '');
      else if (!accept(d, v)) this.msg('', '…');
      else this.msg('pv', previewText(resolve(d, this.list, this.f, v), v, this.f));
    });
    inp.addEventListener('keydown', (e) => {
      const big = shiftIsBig(this.d);
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.commit(false)) inp.select();
      } else if (e.key === 'Escape') {
        if (this.dirty || r.classList.contains('bad')) {
          e.preventDefault();
          this.set(this.v, undefined, true);
          inp.select();
        }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey && big);
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
    bindRepeat(this.dnB, (big) => this.step(-1, big && shiftIsBig(this.d)));
    bindRepeat(this.upB, (big) => this.step(1, big && shiftIsBig(this.d)));
    this.rng?.addEventListener('input', () => {
      if (this.rng && !this.off) this.set(this.list[+this.rng.value], 'slider');
    });
    for (const b of this.chips)
      b.addEventListener('click', () => {
        if (!this.off && !b.disabled) this.set(Number(b.dataset.v));
      });
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

/**
 * 入力の行のまとまり。E 系列の切替を共有し、値が確定するたびに onChange を呼ぶ。
 * 行は id="p-{k}" で探すので、複数の .ptab・枠に分かれていてよい。
 * 確定した値と E 系列はブラウザに保存し（lib/store.ts）、開き直したときに戻す
 */
export class ParamGroup<K extends string = string> {
  series: Series = 12;
  private readonly ps: Map<K, Param>;
  /** 値と E 系列をブラウザに保存するか */
  private readonly save: boolean;
  private readonly subs = new Map<K, Set<(v: number) => void>>();

  /**
   * @param onChange 確定のたびに全項目の値で呼ぶ。k は確定した項目（生成時の 1 回目は undefined）
   * @param seriesEl E 系列の切替（SeriesSwitch）
   * @param opt save: false なら保存しない（値をほかの状態から決めるページ）
   *
   * 保存した値は生成時の 1 回目の onChange に含め、さらにその直後（マイクロタスク）に項目ごとの確定として
   * 購読（on）と onChange を呼ぶ（項目の確定で連動するページでも戻るように）
   */
  constructor(
    defs: readonly ParamDef[],
    private readonly onChange: (v: Record<K, number>, k?: K) => void,
    seriesEl?: HTMLElement | null,
    opt: { save?: boolean } = {},
  ) {
    this.save = opt.save !== false;
    const on = seriesEl?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (on) this.series = Number(on.dataset.s) as Series;
    const ss = this.save ? stored('series') : undefined,
      sb = seriesEl?.querySelector<HTMLElement>(`[data-s="${ss}"]`);
    if (sb && seriesEl) {
      this.series = Number(ss) as Series;
      for (const x of $$('button', seriesEl)) x.setAttribute('aria-pressed', String(x === sb));
    }
    this.ps = new Map(defs.map((d) => [d.k as K, new Param(d, this)]));
    /* 保存した値: 範囲に入るものは今戻す。入らないもの（範囲がほかの項目で決まる fc など）は、
       ほかの項目を戻して範囲が変わった後に、もう一度確かめて戻す */
    const back: K[] = [],
      late: [K, number][] = [];
    for (const [k, p] of this.ps) {
      const sv = this.save ? stored(`p:${k}`) : undefined;
      if (typeof sv === 'number' && Number.isFinite(sv) && !same(sv, p.v)) {
        if (sv >= p.d.min && sv <= p.d.max) {
          p.v = sv;
          back.push(k);
        } else late.push([k, sv]);
      }
      p.buildList();
      p.set(p.v, undefined, true);
    }
    seriesEl?.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-s]');
      if (!b) return;
      this.series = Number(b.dataset.s) as Series;
      if (this.save) store('series', this.series);
      for (const x of $$('button', seriesEl)) x.setAttribute('aria-pressed', String(x === b));
      for (const p of this.ps.values()) if (followsGroup(p.d)) p.refresh();
    });
    this.onChange(this.values());
    if (back.length || late.length)
      queueMicrotask(() => {
        for (const k of back) this.changed(k);
        for (const [k, v] of late) {
          const { d } = this.p(k);
          if (v >= d.min && v <= d.max) this.set(k, v);
        }
      });
  }

  private p(k: K): Param {
    const p = this.ps.get(k);
    if (!p) throw new Error(`unknown param: ${k}`);
    return p;
  }

  /** 全項目の確定した値 */
  values(): Record<K, number> {
    return Object.fromEntries([...this.ps].map(([k, p]) => [k, p.v])) as Record<K, number>;
  }

  /** 1 項目の確定した値 */
  get(k: K): number {
    return this.p(k).v;
  }

  /** 今の定義（update を反映したもの） */
  def(k: K): ParamDef {
    return this.p(k).d;
  }

  /** 今の値の並び（スライダー・▲▼ の行き先） */
  list(k: K): readonly number[] {
    return this.p(k).list;
  }

  /**
   * 値を外から設定する。範囲への丸めはしない。
   * silent なら購読（on）と onChange を呼ばない（連動の中で別の項目を合わせるとき）
   */
  set(k: K, v: number, opt: { silent?: boolean } = {}): void {
    this.p(k).set(v, undefined, opt.silent);
    if (opt.silent && this.save) store(`p:${k}`, v);
  }

  /** 行の下にメッセージを出す（次に値が動くか入力されるまで残る）。kind: er は警告色、pv は強調 */
  note(k: K, text: string, kind: MsgKind = ''): void {
    this.p(k).msg(kind, text);
  }

  /**
   * 定義の一部を変える: 範囲（min・max）、並び（list・lin・series）、目盛り（tk）、表記、
   * 記号・項目名・補足・単位（sym・nm・name・sub・unit・ph）など。値は変えないので、
   * 範囲の外になったら呼び出し側で set と note をする
   */
  update(k: K, patch: ParamPatch): void {
    this.p(k).update(patch);
  }

  /** 並びを作り直す（list を関数で与えていて、その元が変わったとき） */
  refresh(k: K): void {
    this.p(k).refresh();
  }

  /** 無効にする・戻す。無効の間は note を行の下に出す（例「LPF では使いません」） */
  setOff(k: K, off: boolean, note = ''): void {
    this.p(k).setOff(off, note);
  }

  /** 1 項目の確定を購読する。onChange より先に呼ぶ。戻り値で解除 */
  on(k: K, fn: (v: number) => void): () => void {
    const s = this.subs.get(k) ?? new Set();
    this.subs.set(k, s);
    s.add(fn);
    return () => s.delete(fn);
  }

  /** @internal 行から呼ぶ */
  changed(k: string): void {
    const kk = k as K;
    const v = this.p(kk).v;
    if (this.save) store(`p:${kk}`, v);
    for (const fn of this.subs.get(kk) ?? []) fn(v);
    this.onChange(this.values(), kk);
  }
}

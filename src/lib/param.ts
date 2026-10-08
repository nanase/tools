/**
 * 数値入力の行の動作。数値欄そのものがスライダーで、左右にドラッグすると値の並び（E 系列・list・lin）を移り、
 * ‹ › と矢印キーで 1 つずつ動く。動かさずに離すか Enter で入力欄に変わり、下に吹き出し（範囲・プリセット・既定値）を出す。
 * 入力中は値を動かさず、Enter か欄の外で確定する。既定値と違う行は印を付け、行末の ↺ で戻す（lib/reset.ts）。
 * 描画は components/ParamRow.astro
 */
import { $, $$, esc } from './dom';
import { type Series, same } from './eseries';
import { fx, POP_IN } from './motion';
import {
  accept,
  badText,
  DRAG_START,
  dragIndex,
  type Fmt,
  fillOf,
  followsGroup,
  formatter,
  keyOf,
  nearest,
  presetPos,
  previewText,
  resolve,
  shiftIsBig,
  stepLabel,
  stepValue,
  titleText,
  valueList,
} from './param-core';
import type { ParamDef, ParamPatch } from './param-def';
import { parse } from './parse';
import { addRow, mark } from './reset';
import { forget, store, stored } from './store';

export type MsgKind = '' | 'pv' | 'er';

/** 行から見たグループ */
interface Host {
  readonly series: Series;
  changed(k: string): void;
}

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
/** 入力欄を開く文字（数値欄にフォーカスしたまま打ち始めたとき） */
const TYPING = /^[\d.+\-−]$/;

class Param {
  v: number;
  dirty = false;
  off = false;
  /** 入力欄を開いているか */
  editing = false;
  list: number[] = [];
  d: ParamDef;
  f: Fmt;
  /** off のときに欄に出す理由 */
  offNote = '';
  private key: (x: number) => number = (x) => x;
  private readonly row: HTMLElement;
  private readonly sc: HTMLElement;
  private readonly valEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly curEl: HTMLElement;
  private readonly preEl: HTMLElement;
  private readonly cval: HTMLElement;
  private readonly inp: HTMLInputElement;
  private readonly pop: HTMLElement;
  private readonly rgEl: HTMLElement;
  private readonly popMsg: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly chips: HTMLButtonElement[];
  private readonly dnB: HTMLButtonElement;
  private readonly upB: HTMLButtonElement;
  private readonly dfB: HTMLButtonElement;
  private drag: { id: number; x: number; i0: number; last: number; moved: boolean } | null = null;

  constructor(
    d: ParamDef,
    private readonly g: Host,
  ) {
    const r = $(`#p-${d.k}`);
    this.d = d;
    this.f = formatter(d);
    this.row = r;
    this.sc = $('.sc', r);
    this.valEl = $('.sc-v', r);
    this.fillEl = $('.sc-f', r);
    this.curEl = $('.sc-c', r);
    this.preEl = $('.sc-p', r);
    this.cval = $('.c-val', r);
    this.inp = $('.sc-in', r);
    this.pop = $('.sc-pop', r);
    this.rgEl = $('.sc-rg', r);
    this.popMsg = $('.sc-m', r);
    this.msgEl = $(':scope > .c-sub > .msg', r);
    this.chips = $$('.sc-pop .chip', r);
    this.dnB = $('.sc-a[data-d="-1"]', r);
    this.upB = $('.sc-a[data-d="1"]', r);
    this.dfB = $('.sc-df', r);
    this.v = d.v;
    this.relabelReset();
    this.bind();
    addRow(r, { isMod: () => this.isMod(), reset: () => this.resetDefault() });
  }

  /** メッセージ。入力中は吹き出しに、ほかは行の下に出す */
  msg(cls: MsgKind, text: string): void {
    const el = this.editing ? this.popMsg : this.msgEl;
    el.className = `msg${cls ? ` ${cls}` : ''}${this.editing ? ' sc-m' : ''}`;
    el.textContent = text;
  }
  private idle(): void {
    this.msg(
      '',
      !this.off && followsGroup(this.d) && !this.list.some((x) => same(x, this.v)) ? `E${this.g.series} にない値` : '',
    );
  }

  /** 既定値と違うか（使わない行は数えない） */
  isMod(): boolean {
    return !this.off && !same(this.v, this.d.v);
  }

  /** 既定値に戻す（範囲がほかの行で決まっていれば、範囲に丸める） */
  resetDefault(): void {
    this.endEdit();
    const r = resolve(this.d, this.list, this.f, this.d.v);
    if (!same(r.w, this.v)) this.set(r.w);
    if (r.why) this.msg('er', r.why);
  }

  /** 並び・プリセットの刻み・title を作り直す（範囲や E 系列が変わったとき） */
  buildList(): void {
    const { d } = this,
      s = this.g.series;
    this.list = valueList(d, s);
    this.key = keyOf(d, this.list);
    this.inp.title = titleText(d, s, this.f);
    this.sc.title = `${this.f.text(d.min)} – ${this.f.text(d.max)}　ドラッグ・← →: 値を変える　押す・Enter: 入力`;
    this.preEl.innerHTML = presetPos(d, this.list)
      .map((x) => `<i style="left:${pct(x)}"></i>`)
      .join('');
  }

  /** 記号・項目名・単位・placeholder を定義に合わせる */
  relabel(): void {
    const { d, row: r } = this;
    $('.c-sym', r).innerHTML = d.sym;
    $('.c-name .pn', r).innerHTML = `<span class="sr">${esc(d.nm)} </span>${esc(d.name)}`;
    $('.c-name .tip', r).textContent = d.sub;
    $('.c-unit', r).textContent = d.unit;
    r.dataset.nm = d.nm;
    this.inp.placeholder = d.ph;
    r.querySelector('.sc-pop .chips')?.setAttribute('aria-label', `${d.nm} のよく使う値`);
    this.relabelReset();
  }
  private relabelReset(): void {
    const b = $('.c-rst button', this.row),
      t = `既定値 ${this.f.text(this.d.v)}`;
    b.title = `${t} に戻す`;
    b.setAttribute('aria-label', `${this.d.nm} を${t} に戻す`);
    $('span', this.dfB).textContent = t;
  }

  /** 欄の値・地の位置・読み上げ */
  private syncView(): void {
    const { d, f, sc } = this;
    if (this.off) {
      this.valEl.textContent = this.offNote || '使いません';
      sc.setAttribute('aria-disabled', 'true');
      sc.setAttribute('aria-valuetext', this.offNote || '使いません');
      sc.tabIndex = -1;
      return;
    }
    sc.removeAttribute('aria-disabled');
    sc.tabIndex = 0;
    this.valEl.textContent = f.view(this.v);
    const p = fillOf(d, this.list, this.v);
    this.fillEl.style.left = pct(p.from);
    this.fillEl.style.width = pct(p.to - p.from);
    this.curEl.style.left = pct(p.at);
    sc.setAttribute('aria-valuemin', String(d.min));
    sc.setAttribute('aria-valuemax', String(d.max));
    sc.setAttribute('aria-valuenow', String(this.v));
    sc.setAttribute('aria-valuetext', f.text(this.v));
  }

  /** ‹ › の行き先（title と読み上げ） */
  private syncSteps(): void {
    const { d, f } = this,
      lab = stepLabel(d, this.g.series);
    (
      [
        [this.dnB, stepValue(d, this.list, this.v, -1, false), '下', '前'],
        [this.upB, stepValue(d, this.list, this.v, 1, false), '上', '次'],
      ] as const
    ).forEach(([b, v, w, pn]) => {
      const no = v == null || this.off;
      b.setAttribute('aria-disabled', String(no));
      b.title = v == null ? `これ以上${w}げられません` : `${pn}の値 ${f.text(v)}`;
      b.setAttribute(
        'aria-label',
        no ? `${d.nm}: これ以上${w}げられません` : `${d.nm} を${lab}1 つ${w}の ${f.text(v)} へ`,
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
    const typing = this.dirty || this.row.classList.contains('bad');
    if (!typing) this.inp.value = this.f.input(this.v);
    this.syncView();
    this.syncSteps();
    this.syncChips();
    if (!typing) this.idle();
  }

  update(p: ParamPatch): void {
    this.d = { ...this.d, ...p };
    this.f = formatter(this.d);
    if (['sym', 'nm', 'name', 'sub', 'unit', 'ph'].some((k) => k in p)) this.relabel();
    else if ('v' in p || 'format' in p) this.relabelReset();
    this.refresh();
    mark();
  }

  setOff(off: boolean, note = ''): void {
    this.off = off;
    this.offNote = note;
    this.row.classList.toggle('off', off);
    if (off && this.editing) {
      this.endEdit();
      this.set(this.v, true);
    }
    this.syncView();
    this.syncSteps();
    this.syncChips();
    if (!this.dirty) this.idle();
    mark();
  }

  set(v: number, silent = false): void {
    this.v = v;
    this.dirty = false;
    this.row.classList.remove('dirty', 'bad');
    this.inp.removeAttribute('aria-invalid');
    this.inp.value = this.f.input(v);
    this.syncView();
    this.syncChips();
    this.syncSteps();
    this.idle();
    mark();
    if (!silent) this.g.changed(this.d.k);
  }

  /** 並びの値を選ぶ（ドラッグ・プリセット・Home/End） */
  private pick(v: number | undefined): void {
    if (v != null && !this.off && !same(v, this.v)) this.set(v);
  }

  /* ---------- 入力欄 ---------- */
  /** 入力欄を開く（欄を押したとき、Enter、数字を打ち始めたとき） */
  private open(): void {
    if (this.off || this.editing) return;
    const { d, f } = this;
    this.editing = true;
    this.row.classList.add('ed');
    this.inp.value = f.input(this.v);
    this.rgEl.textContent = `範囲 ${f.text(d.min)} 〜 ${f.text(d.max)}`;
    this.popMsg.textContent = '';
    this.syncChips();
    this.inp.focus({ preventScroll: true });
    this.inp.select();
    fx(this.pop, POP_IN, 140);
  }

  /** 入力欄を閉じる（値は変えない）。focus なら数値欄へフォーカスを戻す */
  private endEdit(focus = false): void {
    if (this.editing) {
      this.editing = false;
      this.row.classList.remove('ed');
      this.popMsg.textContent = '';
    }
    if (focus) this.sc.focus({ preventScroll: true });
  }

  /**
   * 入力欄の値を確定する。読めなければ false（欄の外へ出たときは元に戻して true）。
   * close なら確定した後に入力欄を閉じる（メッセージは行の下に出る）
   */
  private commit(onBlur: boolean, close = true): boolean {
    const { d } = this,
      raw = this.inp.value.trim();
    if (!this.dirty) {
      if (close) this.endEdit();
      return true;
    }
    const v = parse(raw, d.unit, d.sign === 'any');
    if (!accept(d, v)) {
      if (onBlur || !raw) {
        if (close) this.endEdit();
        this.set(this.v, true);
        if (raw) this.msg('er', `「${raw}」を読めないため元に戻しました`);
        return true;
      }
      this.row.classList.add('bad');
      this.row.classList.remove('dirty');
      this.inp.setAttribute('aria-invalid', 'true');
      this.msg('er', badText(d));
      return false;
    }
    if (close) this.endEdit();
    const r = resolve(d, this.list, this.f, v);
    this.set(r.w);
    if (r.why) this.msg('er', r.why);
    return true;
  }

  private step(dir: 1 | -1, big: boolean): void {
    if (this.off) return;
    if (this.dirty && !this.commit(false, false)) return;
    const v = stepValue(this.d, this.list, this.v, dir, big);
    if (v != null && !same(v, this.v)) this.set(v);
  }

  private bind(): void {
    const { inp, row: r, sc } = this;
    /* 数値欄: ドラッグで並びを移る。DRAG_START px 動くまではドラッグとみなさず、動かさずに離したら入力欄を開く */
    sc.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.off || this.editing || (e.target as Element).closest('.sc-a')) return;
      try {
        sc.setPointerCapture(e.pointerId);
      } catch {
        /* 取れなくても動く */
      }
      const i = nearest(this.list, this.key, this.v);
      this.drag = { id: e.pointerId, x: e.clientX, i0: i, last: i, moved: false };
    });
    sc.addEventListener('pointermove', (e) => {
      const g = this.drag;
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.x;
      if (!g.moved) {
        if (Math.abs(dx) <= DRAG_START) return;
        g.moved = true;
        r.classList.add('drag');
      }
      const j = dragIndex(g.i0, dx, this.list.length);
      if (j !== g.last) {
        g.last = j;
        this.pick(this.list[j]);
      }
    });
    const end = (e: PointerEvent, ok: boolean) => {
      const g = this.drag;
      if (!g || g.id !== e.pointerId) return;
      this.drag = null;
      r.classList.remove('drag');
      if (ok && !g.moved) this.open();
    };
    sc.addEventListener('pointerup', (e) => end(e, true));
    sc.addEventListener('pointercancel', (e) => end(e, false));
    sc.addEventListener('lostpointercapture', (e) => end(e, false));
    sc.addEventListener('keydown', (e) => {
      if (this.off || e.altKey || e.ctrlKey || e.metaKey) return;
      const big = e.shiftKey && shiftIsBig(this.d),
        L = this.list;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          this.step(1, big);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          this.step(-1, big);
          break;
        case 'PageUp':
          this.step(1, true);
          break;
        case 'PageDown':
          this.step(-1, true);
          break;
        case 'Home':
          this.pick(L[0]);
          break;
        case 'End':
          this.pick(L[L.length - 1]);
          break;
        case 'Enter':
        case 'F2':
          this.open();
          break;
        default:
          /* 数字を打ち始めたら入力欄を開く（打った文字は入力欄の選択を置き換える） */
          if (TYPING.test(e.key)) this.open();
          return;
      }
      e.preventDefault();
    });
    /* ‹ ›: 押し続けると繰り返す。フォーカスは数値欄に置く（矢印キーで続けられる） */
    for (const [b, dir] of [
      [this.dnB, -1],
      [this.upB, 1],
    ] as const) {
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!this.off) sc.focus({ preventScroll: true });
      });
      bindRepeat(b, (big) => this.step(dir, big && shiftIsBig(this.d)));
    }

    /* 入力欄 */
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
        if (this.commit(false)) this.endEdit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.endEdit(true);
        this.set(this.v, true);
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
    /* 欄の外（吹き出しの外）へフォーカスが出たら確定して閉じる */
    this.cval.addEventListener('focusout', (e) => {
      if (!this.editing) return;
      const t = e.relatedTarget as Node | null;
      if (t && this.cval.contains(t)) return;
      this.commit(true);
    });
    /* 吹き出し: 押してもフォーカスを入力欄に残す（欄の外とみなさない） */
    this.pop.addEventListener('mousedown', (e) => e.preventDefault());
    for (const b of this.chips)
      b.addEventListener('click', () => {
        if (this.off || b.disabled) return;
        this.endEdit(true);
        this.set(this.v, true);
        this.pick(Number(b.dataset.v));
      });
    this.dfB.addEventListener('click', () => {
      this.endEdit(true);
      this.set(this.v, true);
      this.resetDefault();
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
 * 確定した値と E 系列はブラウザに保存し（lib/store.ts）、開き直したときに戻す。既定値（定義の v）に戻した項目は保存から消す
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
      p.set(p.v, true);
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

  /** 保存する（既定値なら保存から消す） */
  private keep(k: K): void {
    const p = this.p(k);
    if (same(p.v, p.d.v)) forget(`p:${k}`);
    else store(`p:${k}`, p.v);
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

  /** 今の値の並び（ドラッグ・‹ › の行き先） */
  list(k: K): readonly number[] {
    return this.p(k).list;
  }

  /**
   * 値を外から設定する。範囲への丸めはしない。
   * silent なら購読（on）と onChange を呼ばない（連動の中で別の項目を合わせるとき）
   */
  set(k: K, v: number, opt: { silent?: boolean } = {}): void {
    this.p(k).set(v, opt.silent);
    if (opt.silent && this.save) this.keep(k);
  }

  /** 行の下にメッセージを出す（次に値が動くか入力されるまで残る）。kind: er は警告色、pv は強調 */
  note(k: K, text: string, kind: MsgKind = ''): void {
    this.p(k).msg(kind, text);
  }

  /**
   * 定義の一部を変える: 範囲（min・max）、並び（list・lin・series）、表記、既定値（v）、
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

  /** 無効にする・戻す。無効の間は欄を破線にして note を出す（例「LPF では使いません」） */
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
    if (this.save) this.keep(kk);
    for (const fn of this.subs.get(kk) ?? []) fn(v);
    this.onChange(this.values(), kk);
  }
}

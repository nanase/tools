/**
 * 選択肢の群: button[data-v] のうち 1 つを aria-pressed で選ぶ。
 * 選択肢だけの行（components/ChoiceRow.astro）にも、枠の右上に載せる .seg にも使える。
 * 押して選んだ値はブラウザに保存し（lib/store.ts、群の要素の id ごと）、開き直したときに戻す。
 * 動作の状態（動作・停止など）のように保存しない群は、要素に data-nosave を付ける。
 * 行（.prow）なら、初めに選んでいる値を既定値とし、違う間は印と行末の ↺ を出す（lib/reset.ts）。
 * 保存しない行（ほかの状態で決まる行）と data-noreset の行は数えない
 */
import { $$ } from './dom';
import type { MsgKind } from './param';
import { addRow, mark } from './reset';
import { forget, store, stored } from './store';

export class Choice<V extends string = string> {
  readonly root: HTMLElement;
  private readonly btns: HTMLButtonElement[];
  private readonly msgEl: HTMLElement | null;
  private cur: V;
  /** 既定値（初めに選んでいる値。setDefault で変えられる） */
  private def: V;
  private readonly key: string;

  /**
   * @param root 群か行の要素（ChoiceRow なら id="p-{k}" の要素）
   * @param onChange 押して値が変わったとき・既定値に戻したときに呼ぶ（set では呼ばない）。保存した値に戻したときは、
   *   生成の直後（マイクロタスク）にも呼ぶ
   */
  constructor(
    root: HTMLElement,
    private readonly onChange?: (v: V) => void,
  ) {
    this.root = root;
    this.btns = $$<HTMLButtonElement>('button[data-v]', root);
    this.msgEl = root.querySelector('.msg');
    this.cur = (this.btns.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.v ?? '') as V;
    this.def = this.cur;
    const save = !!root.id && !root.hasAttribute('data-nosave');
    this.key = save ? `c:${root.id}` : '';
    const sv = this.key ? stored(this.key) : undefined;
    if (typeof sv === 'string' && sv !== this.cur && this.btns.some((b) => b.dataset.v === sv)) {
      this.set(sv as V);
      queueMicrotask(() => this.onChange?.(sv as V));
    }
    root.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
      if (!b || !root.contains(b) || b.disabled || this.off) return;
      const v = b.dataset.v as V;
      if (v === this.cur) return;
      this.pick(v);
    });
    if (save && root.classList.contains('prow') && !root.hasAttribute('data-noreset'))
      addRow(root, { isMod: () => this.isMod(), reset: () => this.reset() });
  }

  get value(): V {
    return this.cur;
  }

  get off(): boolean {
    return this.root.classList.contains('off');
  }

  /** 選んで保存し、onChange を呼ぶ */
  private pick(v: V): void {
    this.set(v);
    if (this.key) {
      if (v === this.def) forget(this.key);
      else store(this.key, v);
    }
    this.onChange?.(v);
  }

  /** 既定値と違うか（無効の行と、既定値の選択肢を選べない間は数えない） */
  isMod(): boolean {
    return !this.off && this.cur !== this.def && !this.btns.find((b) => b.dataset.v === this.def)?.disabled;
  }

  /** 既定値に戻す（onChange を呼ぶ） */
  reset(): void {
    if (this.isMod()) this.pick(this.def);
  }

  /** 既定値を変える（ほかの選択で既定が決まる行） */
  setDefault(v: V): void {
    this.def = v;
    mark();
  }

  /** 選択を外から変える（onChange は呼ばない） */
  set(v: V): void {
    this.cur = v;
    for (const b of this.btns) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    mark();
  }

  /** 行を無効にする・戻す。note を行の下に出す（msg を置いた行だけ。戻すときは消す） */
  setOff(off: boolean, note = ''): void {
    this.root.classList.toggle('off', off);
    for (const b of this.btns) b.disabled = off || b.dataset.dis === '1';
    this.note(off ? note : '');
    mark();
  }

  /** 選択肢を 1 つだけ無効にする・戻す */
  disable(v: V, dis = true): void {
    for (const b of this.btns)
      if (b.dataset.v === v) {
        b.dataset.dis = dis ? '1' : '';
        b.disabled = dis || this.off;
      }
  }

  /** 行の下にメッセージを出す（ChoiceRow の msg を置いた行だけ） */
  note(text: string, kind: MsgKind = ''): void {
    if (!this.msgEl) return;
    this.msgEl.className = `msg${kind ? ` ${kind}` : ''}`;
    if (this.msgEl.textContent !== text) this.msgEl.textContent = text;
  }

  /** 項目名の吹き出しの補足を変える */
  setSub(text: string): void {
    const s = this.root.querySelector('.c-name .tip');
    if (s) s.textContent = text;
  }
}

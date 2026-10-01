/**
 * 選択肢の群: button[data-v] のうち 1 つを aria-pressed で選ぶ。
 * 選択肢だけの行（components/ChoiceRow.astro）にも、枠の右上に載せる .seg にも使える。
 * 押して選んだ値はブラウザに保存し（lib/store.ts、群の要素の id ごと）、開き直したときに戻す。
 * 動作の状態（動作・停止など）のように保存しない群は、要素に data-nosave を付ける
 */
import { $$ } from './dom';
import type { MsgKind } from './param';
import { store, stored } from './store';

export class Choice<V extends string = string> {
  readonly root: HTMLElement;
  private readonly btns: HTMLButtonElement[];
  private readonly msgEl: HTMLElement | null;
  private cur: V;

  /**
   * @param root 群か行の要素（ChoiceRow なら id="p-{k}" の要素）
   * @param onChange 押して値が変わったときに呼ぶ（set では呼ばない）。保存した値に戻したときは、
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
    const key = root.id && !root.hasAttribute('data-nosave') ? `c:${root.id}` : '',
      sv = key ? stored(key) : undefined;
    if (typeof sv === 'string' && sv !== this.cur && this.btns.some((b) => b.dataset.v === sv)) {
      this.set(sv as V);
      queueMicrotask(() => this.onChange?.(sv as V));
    }
    root.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
      if (!b || !root.contains(b) || b.disabled || this.off) return;
      const v = b.dataset.v as V;
      if (v === this.cur) return;
      this.set(v);
      if (key) store(key, v);
      this.onChange?.(v);
    });
  }

  get value(): V {
    return this.cur;
  }

  get off(): boolean {
    return this.root.classList.contains('off');
  }

  /** 選択を外から変える（onChange は呼ばない） */
  set(v: V): void {
    this.cur = v;
    for (const b of this.btns) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  }

  /** 行を無効にする・戻す。note を行の下に出す（msg を置いた行だけ。戻すときは消す） */
  setOff(off: boolean, note = ''): void {
    this.root.classList.toggle('off', off);
    for (const b of this.btns) b.disabled = off || b.dataset.dis === '1';
    this.note(off ? note : '');
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

/**
 * 図の全画面表示。ボタン（components/FsButton.astro）で root を画面いっぱいにし、ブラウザの全画面も頼む。
 * ブラウザの全画面を使えない環境（iPhone など）でも、root を fixed で画面に重ねるので同じ見た目になる。
 * 開いている間は root に .fs-on、html に data-fs を付ける。各ページは :root[data-fs] で図の高さなどを上書きする。
 * - move: 開いている間だけ移す要素と行き先。閉じると元の場所へ戻す（カメラレンズ・ハロの右の列）
 * - pop: 図の隅に浮かべる操作の枠へ移す要素。見出しで畳め、畳んだかどうかはページごとに保存する
 * root が hidden の要素なら、開いている間だけ出す（全画面専用の枠）
 */
import { hide as hideBubble } from './bubble';
import { store, stored } from './store';

export interface FsOptions {
  root: HTMLElement;
  btn: HTMLButtonElement;
  move?: () => [el: HTMLElement, to: HTMLElement][];
  pop?: () => HTMLElement[];
  /** 浮かべる枠の見出し */
  popTitle?: string;
  /** 開いたときにフォーカスする要素（既定はボタン） */
  focus?: HTMLElement;
  /** Esc で閉じてよいか（ページが先に Esc を使うとき false を返す） */
  esc?: (e: KeyboardEvent) => boolean;
  /** 開閉の直後（要素を移し終えてから） */
  change?: (on: boolean) => void;
}

export interface Fs {
  on(): boolean;
  open(): void;
  close(): void;
}

const LABEL_OPEN = '全画面で表示',
  LABEL_CLOSE = '全画面を閉じる',
  POP_KEY = 'fs-pop';

function popBox(title: string): { box: HTMLElement; body: HTMLElement } {
  const box = document.createElement('div'),
    head = document.createElement('button'),
    body = document.createElement('div');
  box.className = 'fs-pop';
  head.type = 'button';
  head.className = 'fs-pop-h';
  head.innerHTML = '<span></span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';
  (head.firstChild as HTMLElement).textContent = title;
  body.className = 'fs-pop-b';
  const fold = (shut: boolean) => {
    box.classList.toggle('shut', shut);
    head.setAttribute('aria-expanded', shut ? 'false' : 'true');
  };
  fold(stored(POP_KEY) === false);
  head.addEventListener('click', () => {
    const shut = !box.classList.contains('shut');
    fold(shut);
    store(POP_KEY, shut ? false : undefined);
  });
  box.append(head, body);
  return { box, body };
}

export function initFullscreen(o: FsOptions): Fs {
  const { root, btn } = o,
    dialog = root.hidden;
  let back: [Comment, HTMLElement][] = [],
    pop: { box: HTMLElement; body: HTMLElement } | null = null,
    sy = 0;
  const on = () => root.classList.contains('fs-on');
  const move = (el: HTMLElement, to: HTMLElement) => {
    const ph = document.createComment('fs');
    el.before(ph);
    back.push([ph, el]);
    to.append(el);
  };
  const label = (t: string) => {
    btn.setAttribute('aria-label', t);
    btn.title = t;
  };
  const open = () => {
    if (on()) return;
    sy = scrollY;
    hideBubble();
    for (const [el, to] of o.move?.() ?? []) move(el, to);
    const els = o.pop?.() ?? [];
    if (els.length) {
      pop ??= popBox(o.popTitle ?? '操作');
      root.append(pop.box);
      for (const el of els) move(el, pop.body);
    }
    if (dialog) root.hidden = false;
    root.classList.add('fs-on');
    document.documentElement.dataset.fs = '';
    btn.dataset.on = '';
    label(LABEL_CLOSE);
    root.requestFullscreen?.().catch(() => {});
    (o.focus ?? btn).focus({ preventScroll: true });
    o.change?.(true);
  };
  const close = () => {
    if (!on()) return;
    hideBubble();
    for (const [ph, el] of back) ph.replaceWith(el);
    back = [];
    pop?.box.remove();
    root.classList.remove('fs-on');
    if (dialog) root.hidden = true;
    delete document.documentElement.dataset.fs;
    delete btn.dataset.on;
    label(LABEL_OPEN);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    scrollTo(0, sy);
    btn.focus({ preventScroll: true });
    o.change?.(false);
  };
  btn.addEventListener('click', () => (on() ? close() : open()));
  /* ブラウザの全画面を Esc などで抜けたら、こちらも閉じる */
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) close();
  });
  /* ブラウザの全画面を使えないときの Esc（使えるときはブラウザが抜けて fullscreenchange が来る） */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !on() || document.fullscreenElement || e.defaultPrevented) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (o.esc && !o.esc(e)) return;
    close();
  });
  return { on, open, close };
}

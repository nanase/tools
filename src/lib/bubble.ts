/**
 * 場所を取らない吹き出し（ページに重ねて出す。開いても閉じても下の行は動かない）。2 つの使い方がある。
 * - 行のメッセージ（rowNote）: 印（.nt。値の欄の角に重ねるか、チップの行は項目名の横）を出し、操作に応じて出たときは 3 秒だけ開く。
 *   開いた直後や演奏中に出たものは開かない。印を押すか指すと開く
 * - 省いた文字（initClip）: 1 行に収めて … で省く要素（CLIP）を指すか押すと、省いているときだけ全文を出す
 * 揺れの決まりは design/page.md の「動いても場所を変えない」
 */
import type { MsgKind } from './param';

/** 1 行に収めて … で省く要素。指すか押すと全文を出す */
const CLIP = '.clip, .prow.off .sc, .prow.off .c-off, .m dd, .m-sub, .m-note, .sbar > *, .tp-tm > *';
/** 出たときに開いておく長さ [ms] */
const AUTO = 3000;
/** マウスで指してから開くまで [ms] */
const HOVER = 200;
/** 操作から何 ms 以内に出たメッセージを、操作に応じたものとして開くか */
const AFTER_INPUT = 1500;
let lastInput = -Infinity;

let el: HTMLElement | null = null;
let anchor: Element | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function bubble(): HTMLElement {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'desc fl';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.append(el);
  document.addEventListener('click', (e) => {
    const n = e.target as Node;
    if (anchor && !anchor.contains(n) && !el?.contains(n)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  addEventListener('resize', () => {
    if (anchor) place(anchor);
  });
  return el;
}

/** a の下に text を出す。ms を渡すとその時間で閉じる。印（.nt）なら行の下に出し、矢印を印に向ける */
export function show(a: Element, text: string, kind: MsgKind = '', ms = 0): void {
  const b = bubble();
  clearTimeout(timer);
  anchor = a;
  b.textContent = text;
  b.classList.toggle('er', kind === 'er');
  b.hidden = false;
  place(a);
  if (ms) timer = setTimeout(hide, ms);
}

/** 吹き出しを a（印なら行）の下に合わせる（矢印は a の中央、画面の端から 16 px は空ける） */
function place(a: Element): void {
  const b = bubble(),
    r = a.getBoundingClientRect(),
    under = (a.matches('.nt') && a.closest('.prow')) || a,
    w = b.offsetWidth,
    cx = r.left + r.width / 2 + scrollX;
  const left = Math.max(scrollX + 16, Math.min(cx - 24, scrollX + document.documentElement.clientWidth - 16 - w));
  b.style.left = `${left}px`;
  b.style.top = `${under.getBoundingClientRect().bottom + scrollY + 8}px`;
  b.style.setProperty('--ax', `${cx - left}px`);
}

export function hide(): void {
  clearTimeout(timer);
  anchor = null;
  if (el) el.hidden = true;
}

/** 行（.prow）のメッセージを印と吹き出しに出す。text が空なら印を消す。新しい文のときだけ吹き出しを開く */
export function rowNote(row: HTMLElement, text: string, kind: MsgKind = ''): void {
  const nt = row.querySelector<HTMLElement>(':scope > .c-val > .nt, :scope > .c-name > .nt');
  if (!nt) return;
  const was = nt.dataset.t ?? '';
  nt.dataset.t = text;
  nt.classList.toggle('on', !!text);
  nt.classList.toggle('er', kind === 'er');
  nt.title = text;
  if (!text) {
    if (anchor === nt) hide();
    return;
  }
  if (text !== was && performance.now() - lastInput < AFTER_INPUT && row.getClientRects().length)
    show(nt, text, kind, AUTO);
}

/** 省いた要素の全文（省いていなければ空） */
function clipped(t: Element): string {
  const v = t.matches('.sc') ? t.querySelector('.sc-v') : t;
  if (!v || v.scrollWidth <= v.clientWidth + 1) return '';
  return (v.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** 印（.nt）と、省いた文字の吹き出しを有効にする。initToolPage から 1 度だけ呼ぶ */
export function initClip(): void {
  let touch = false;
  let hov: ReturnType<typeof setTimeout> | undefined;
  const target = (e: Event) => {
    const t = e.target as Element;
    const nt = t.closest?.('.nt.on');
    if (nt) return nt;
    if (t.closest?.('button, a, input, select, textarea, label')) return null;
    return t.closest?.(CLIP) ?? null;
  };
  const open = (t: Element) => {
    if (t.matches('.nt')) show(t, (t as HTMLElement).dataset.t ?? '', t.classList.contains('er') ? 'er' : '');
    else {
      const s = clipped(t);
      if (s) show(t, s);
    }
  };
  document.addEventListener(
    'pointerdown',
    (e) => {
      touch = e.pointerType !== 'mouse';
      lastInput = performance.now();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    () => {
      lastInput = performance.now();
    },
    true,
  );
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = target(e);
    clearTimeout(hov);
    if (t && t !== anchor) hov = setTimeout(() => open(t), HOVER);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = target(e);
    if (!t || t.contains(e.relatedTarget as Node)) return;
    clearTimeout(hov);
    if (t === anchor) hide();
  });
  document.addEventListener('click', (e) => {
    const t = target(e);
    if (!t || (!touch && !t.matches('.nt'))) return;
    if (t === anchor) hide();
    else open(t);
  });
}

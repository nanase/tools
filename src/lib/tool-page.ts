/**
 * ツールのページに共通の動き: 「?」の吹き出し、開閉できる枠、関連ツールの件数。
 * 各ツールの入口スクリプトから initToolPage() を 1 度だけ呼ぶ。見出し以外の「?」は addTip で足す
 */
import { $, $$ } from './dom';
import { fx, POP_IN, POP_OUT, RM } from './motion';
import { initSite } from './site';

/* ---------- 「?」の吹き出し ---------- */
interface Tip {
  btn: HTMLElement;
  el: HTMLElement;
  box: HTMLElement;
  below: boolean;
}
const tips: Tip[] = [];
const tipOpen = (t: Tip) => t.btn.getAttribute('aria-expanded') === 'true';
function placeTip(t: Tip): void {
  const r = t.box.getBoundingClientRect(),
    b = t.btn.getBoundingClientRect();
  const cx = b.left + b.width / 2 - r.left,
    w = t.el.offsetWidth;
  const bx = Math.max(0, Math.min(cx - 24, r.width - w));
  t.el.style.setProperty('--bx', `${bx}px`);
  t.el.style.setProperty('--ax', `${cx - bx}px`);
  if (t.below) t.el.style.top = `${b.bottom - r.top + 10}px`;
}
function setTip(t: Tip, open: boolean): void {
  if (open === tipOpen(t)) return;
  if (open) for (const o of tips) if (o !== t) setTip(o, false);
  t.btn.setAttribute('aria-expanded', String(open));
  if (open) {
    t.box.style.zIndex = '24';
    t.el.hidden = false;
    placeTip(t);
    fx(t.el, POP_IN, 160);
  } else
    fx(t.el, POP_OUT, 120, () => {
      if (tipOpen(t)) return;
      t.el.hidden = true;
      t.box.style.zIndex = '';
    });
}
let tipsBound = false;
function bindTips(): void {
  if (tipsBound) return;
  tipsBound = true;
  document.addEventListener('click', (e) => {
    const n = e.target as Node;
    for (const t of tips) if (tipOpen(t) && !t.btn.contains(n) && !t.el.contains(n)) setTip(t, false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const t of tips)
      if (tipOpen(t)) {
        setTip(t, false);
        t.btn.focus();
      }
  });
  addEventListener('resize', () => {
    for (const t of tips) if (tipOpen(t)) placeTip(t);
  });
}

/**
 * 「?」ボタン btn で吹き出し el（class="desc" role="tooltip" hidden）を開閉する。
 * el は box（position:relative の祖先）の中に置き、ボタンの位置に合わせて矢印を出す。
 * below なら el の上端をボタンの下に合わせる（見出し以外の「?」）。ほかの吹き出しは閉じる
 */
export function addTip(btn: HTMLElement, el: HTMLElement, box: HTMLElement, below = false): void {
  const t = { btn, el, box, below };
  tips.push(t);
  bindTips();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    setTip(t, !tipOpen(t));
  });
}

/* 開閉できる枠（Collapsible.astro） */
function initCollapsible(): void {
  for (const box of $$<HTMLDetailsElement>('details.a-thy')) {
    const body = $('.thy-body', box);
    $('summary', box).addEventListener('click', (e) => {
      if (RM.matches || !body.animate) return;
      e.preventDefault();
      if (box.dataset.busy) return;
      box.dataset.busy = '1';
      const opening = !box.open;
      if (opening) box.open = true;
      const h = `${body.offsetHeight}px`;
      body.classList.add('anim');
      const frames = [
        { height: '0px', opacity: 0 },
        { height: h, opacity: 1 },
      ];
      fx(body, opening ? frames : frames.reverse(), opening ? 260 : 200, () => {
        body.classList.remove('anim');
        if (!opening) box.open = false;
        delete box.dataset.busy;
      });
    });
  }
}

/* 関連ツール（RelatedTools.astro）。スマホで 3 件、それ以外は 1 行に収まる件数だけ */
function initRelated(): void {
  const box = document.getElementById('related');
  if (!box) return;
  const fit = () => {
    const w = box.clientWidth;
    if (!w) return;
    const n = w < 480 ? 3 : Math.max(1, Math.floor((w + 12) / (240 + 12)));
    [...box.children].forEach((c, i) => {
      (c as HTMLElement).hidden = i >= n;
    });
  };
  new ResizeObserver(fit).observe(box);
}

export function initToolPage(): void {
  initSite();
  addTip($('#descBtn'), $('#desc'), $('.ttl'));
  initCollapsible();
  initRelated();
}

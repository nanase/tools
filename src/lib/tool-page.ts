/**
 * ツールのページに共通の動き: 「?」の吹き出し、項目名の吹き出し、「その他」のまとまり、開閉できる枠、関連ツールの件数。
 * 各ツールの入口スクリプトから initToolPage() を 1 度だけ呼ぶ。見出し以外の「?」は addTip で足す
 */
import { $, $$ } from './dom';
import { FADE_IN, fx, POP_IN, POP_OUT, RM } from './motion';
import { initSite } from './site';
import { forget, resetAll, store, stored } from './store';

/* ---------- 吹き出し（「?」ボタンと項目名） ---------- */
interface Tip {
  btn: HTMLElement;
  el: HTMLElement;
  box: HTMLElement;
  below: boolean;
  /** ボタンなら aria-expanded を合わせる（項目名は合わせない） */
  isBtn: boolean;
  open: boolean;
}
const tips: Tip[] = [];
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
  if (open === t.open) return;
  if (open) for (const o of tips) if (o !== t) setTip(o, false);
  t.open = open;
  if (t.isBtn) t.btn.setAttribute('aria-expanded', String(open));
  if (open) {
    t.box.style.zIndex = '24';
    t.el.hidden = false;
    placeTip(t);
    fx(t.el, POP_IN, 160);
  } else
    fx(t.el, POP_OUT, 120, () => {
      if (t.open) return;
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
    for (const t of tips) if (t.open && !t.btn.contains(n) && !t.el.contains(n)) setTip(t, false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const t of tips)
      if (t.open) {
        setTip(t, false);
        if (t.isBtn) t.btn.focus();
      }
  });
  addEventListener('resize', () => {
    for (const t of tips) if (t.open) placeTip(t);
  });
}

/**
 * 「?」ボタン btn で吹き出し el（class="desc" role="tooltip" hidden）を開閉する。
 * el は box（position:relative の祖先）の中に置き、ボタンの位置に合わせて矢印を出す。
 * below なら el の上端をボタンの下に合わせる（見出し以外の「?」）。ほかの吹き出しは閉じる
 */
export function addTip(btn: HTMLElement, el: HTMLElement, box: HTMLElement, below = false): void {
  const t: Tip = { btn, el, box, below, isBtn: true, open: false };
  tips.push(t);
  bindTips();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    setTip(t, !t.open);
  });
}

/**
 * 項目名（.pn）の吹き出し（.tip）: マウスは指している間、タッチは押すたびに開閉する。
 * マウスで押したときはラベルの既定の動き（選択肢へ移る）を残す。補足が空の行では開かない
 */
function initHints(): void {
  let touch = false;
  for (const pn of $$('.c-name .pn')) {
    const el = pn.parentElement?.querySelector<HTMLElement>('.tip'),
      box = pn.closest<HTMLElement>('.prow');
    if (!el || !box) continue;
    const t: Tip = { btn: pn, el, box, below: true, isBtn: false, open: false };
    tips.push(t);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const can = () => !!el.textContent?.trim();
    pn.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !can()) return;
      clearTimeout(timer);
      timer = setTimeout(() => setTip(t, true), 200);
    });
    pn.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(timer);
      setTip(t, false);
    });
    pn.addEventListener('pointerdown', (e) => {
      touch = e.pointerType !== 'mouse';
    });
    pn.addEventListener('click', (e) => {
      if (!touch) return;
      e.preventDefault();
      if (can()) setTip(t, !t.open);
    });
  }
  bindTips();
}

/* ---------- 「その他」のまとまり（More.astro） ---------- */
/** 数値に SI 接頭辞が付いていれば単位と詰める（10 k + Ω → 10 kΩ、5 + V → 5 V） */
const withUnit = (v: string, u: string) => (!u ? v : /[a-zµμ]$/i.test(v) ? `${v}${u}` : `${v} ${u}`);
/** 行の今の値（要約に使う。行の data-sum があればそれを使う）。出していない行は null */
function rowSummary(row: HTMLElement, body: HTMLElement): string | null {
  if (row.hidden || getComputedStyle(row).display === 'none') return null;
  for (let e = row.parentElement; e && e !== body; e = e.parentElement) if (e.hidden) return null;
  const nm = row.dataset.nm ?? row.querySelector('.c-name .pn')?.textContent?.trim() ?? '';
  let v: string;
  const sc = row.querySelector('.sc-v');
  if (row.dataset.sum != null) v = row.dataset.sum;
  else if (sc)
    v = row.classList.contains('off')
      ? (sc.textContent ?? '')
      : withUnit(sc.textContent?.trim() || '—', row.querySelector('.c-unit')?.textContent?.trim() ?? '');
  else if (row.classList.contains('off')) v = '使いません';
  else {
    const on = row.querySelector('[aria-pressed="true"]');
    if (on) v = on.textContent?.trim() ?? '';
    else {
      const n = row.querySelectorAll('.c-sub .chips .chip').length;
      v = n ? `${n} 個` : 'なし';
    }
  }
  return `${nm} ${v}`.trim();
}
function setMore(box: HTMLElement, open: boolean, anim: boolean): void {
  const h = $('.more-h', box),
    body = $('.more-b', box);
  h.setAttribute('aria-expanded', String(open));
  if (open) {
    body.hidden = false;
    if (anim) fx(body, FADE_IN, 200);
  } else body.hidden = true;
}
function initMore(): void {
  for (const box of $$('.more')) {
    const h = $('.more-h', box),
      sum = $('.more-s', box),
      body = $('.more-b', box),
      key = `m:${box.id}`;
    let queued = false;
    const upd = () => {
      queued = false;
      const s = $$('.prow', body)
        .map((r) => rowSummary(r, body))
        .filter((x): x is string => !!x)
        .join(' · ');
      if (sum.textContent !== s) sum.textContent = s;
    };
    const later = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(upd);
    };
    if (stored(key) === true) setMore(box, true, false);
    h.addEventListener('click', () => {
      const open = !!body.hidden;
      setMore(box, open, true);
      if (open) store(key, true);
      else forget(key);
    });
    /* 値は入口スクリプトが入れる。入れた後と、中が変わるたびに要約を作り直す */
    new MutationObserver(later).observe(body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    /* 枠の表示の切り替え（.sg-only など、外のクラスで隠す行）にも合わせる */
    const pnl = box.closest('.pnl');
    if (pnl) new MutationObserver(later).observe(pnl, { attributes: true, attributeFilter: ['class'] });
    setTimeout(upd);
  }
}

/* 開閉できる枠（Collapsible.astro） */
function initCollapsible(): void {
  for (const box of $$<HTMLDetailsElement>('details.clps')) {
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

/* 計算結果の要約（.mini）。PC では画面の下に留め、計算結果の大きい値が画面にない間だけ出す */
function initMini(): void {
  const mini = document.querySelector('.mini'),
    out = document.querySelector('.a-out .m-main') ?? document.querySelector('.a-out');
  if (!mini || !out) return;
  new IntersectionObserver(([e]) => {
    mini.classList.toggle('show', !e.isIntersecting);
    document.documentElement.classList.toggle('mini-on', !e.isIntersecting);
  }).observe(out);
}

export function initToolPage(): void {
  initSite();
  document.getElementById('resetBtn')?.addEventListener('click', resetAll);
  addTip($('#descBtn'), $('#desc'), $('.ttl'));
  initHints();
  initMore();
  initCollapsible();
  initRelated();
  initMini();
}

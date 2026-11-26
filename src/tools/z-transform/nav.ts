/*
 * 問いのナビゲーション: 下に貼り付くバー（前へ・一覧・次へ）と、1 問ずつ・すべての切り替え。
 * 1 問ずつのときは今の章のほかを hidden="until-found" で隠す。ページ内検索で当たった章へは beforematch で切り替える。
 * 対応しないブラウザでは普通の hidden にする。今の章は URL の #q1〜#q8 に残し、読み上げには「問い 4 / 8」と知らせる
 */
import { $, $$ } from '../../lib/dom';
import { AU } from './fig';

const KEY = 'zt:view';

interface GoOpts {
  /** 読み上げで知らせる（既定は知らせる） */
  announce?: boolean;
  /** 章の頭までスクロールする（既定はする） */
  scroll?: boolean;
  /** 章の見出しへフォーカスを移す */
  focus?: boolean;
}

export function initNav(root: HTMLElement): void {
  const chs = $$('.ch', root);
  const ids = chs.map((c) => c.id);
  const nav = $('.qnav', root);
  const list = $('#qn-list', root);
  const menu = $('.qn-menu', root);
  const prev = $<HTMLButtonElement>('.qn-prev', root);
  const next = $<HTMLButtonElement>('.qn-next', root);
  const live = $('#qn-live', root);
  const untilFound = 'onbeforematch' in document.body;
  const heading = (i: number): HTMLElement | null => chs[i]?.querySelector<HTMLElement>('h2 > span:last-child') ?? null;
  let cur = Math.max(0, ids.indexOf(location.hash.slice(1)));
  let view = 'one';
  try {
    if (localStorage.getItem(KEY) === 'all') view = 'all';
  } catch {
    /* 保存できない環境 */
  }

  const railH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-h')) || 52;
  const toTop = (el: HTMLElement, smooth: boolean) => {
    const y = el.getBoundingClientRect().top + scrollY - railH() - 12;
    if (view === 'all' || el.getBoundingClientRect().top < railH())
      scrollTo({
        top: y,
        behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto',
      });
  };

  function paint(announce: boolean): void {
    root.dataset.view = view;
    chs.forEach((c, i) => {
      if (view === 'all' || i === cur) c.removeAttribute('hidden');
      else if (untilFound) c.setAttribute('hidden', 'until-found');
      else c.hidden = true;
    });
    prev.disabled = cur === 0;
    next.disabled = cur === chs.length - 1;
    $('.qn-no', nav).textContent = `${cur + 1} / ${chs.length}`;
    $('.qn-t', nav).innerHTML = heading(cur)?.innerHTML ?? '';
    for (const a of $$('a[data-q]', list)) a.setAttribute('aria-current', String(a.dataset.q === ids[cur]));
    for (const b of $$('.qn-view button', list)) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    if (announce) live.textContent = `問い ${cur + 1} / ${chs.length}　${heading(cur)?.textContent ?? ''}`;
  }

  function go(i: number, o: GoOpts = {}): void {
    const ch = chs[i];
    if (!ch) return;
    const moved = i !== cur;
    cur = i;
    if (moved && view === 'one') AU.stop();
    paint(o.announce ?? true);
    try {
      history.replaceState(null, '', `#${ids[cur]}`);
    } catch {
      /* file: など */
    }
    if (o.scroll !== false) toTop(ch, view === 'all');
    if (o.focus) ch.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  function setView(v: string): void {
    view = v;
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* 保存できない環境 */
    }
    paint(false);
    const ch = chs[cur];
    if (ch) toTop(ch, false);
  }

  const open = (on: boolean) => {
    list.hidden = !on;
    menu.setAttribute('aria-expanded', String(on));
    if (on) list.querySelector<HTMLElement>('a[aria-current="true"]')?.focus();
  };
  menu.addEventListener('click', () => open(Boolean(list.hidden)));
  prev.addEventListener('click', () => go(cur - 1));
  next.addEventListener('click', () => go(cur + 1));
  list.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const a = e.target.closest<HTMLElement>('a[data-q]');
    if (a) {
      e.preventDefault();
      open(false);
      go(ids.indexOf(a.dataset.q ?? ''), { focus: true });
      return;
    }
    const b = e.target.closest<HTMLElement>('.qn-view button');
    if (b) setView(b.dataset.view ?? '');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!list.hidden && !(e.target instanceof Node && nav.contains(e.target))) open(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      open(false);
      menu.focus();
      return;
    }
    // ← → で前後へ。入力欄・スライダー・修飾キーのときは使わない
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (!(t instanceof Element) || t.closest('input,textarea,select,[contenteditable],svg') || !list.hidden) return;
    e.preventDefault();
    go(cur + (e.key === 'ArrowRight' ? 1 : -1));
  });
  // ページ内検索で隠れた章に当たったら、その章に切り替える
  chs.forEach((c, i) => {
    c.addEventListener('beforematch', () => go(i, { scroll: false }));
  });
  // リンク（#q4 など）と戻る操作
  addEventListener('hashchange', () => {
    const i = ids.indexOf(location.hash.slice(1));
    if (i >= 0 && i !== cur) go(i);
  });
  // すべて表示のときは、読んでいる章をバーに出す
  const io = new IntersectionObserver(
    () => {
      if (view !== 'all') return;
      const y = innerHeight * 0.4;
      let k = 0;
      chs.forEach((c, i) => {
        if (c.getBoundingClientRect().top < y) k = i;
      });
      if (k !== cur) {
        cur = k;
        paint(false);
      }
    },
    { rootMargin: '-40% 0px -55% 0px' },
  );
  for (const c of chs) io.observe(c);

  paint(false);
  root.classList.add('ready');
  const ch = chs[cur];
  if (ch && location.hash && ids.includes(location.hash.slice(1))) toTop(ch, false);
}

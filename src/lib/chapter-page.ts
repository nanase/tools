/**
 * 章立てて解説するページ（z 変換・ラプラス変換）の動き。HTML は lib/chapter-html.ts、見た目は styles/chapters.css。
 *
 * 問いのナビゲーション: 下に貼り付くバー（前へ・一覧・次へ）と、1 問ずつ・すべての切り替え。
 * 1 問ずつのときは今の章のほかを hidden="until-found" で隠す。ページ内検索で当たった章へは beforematch で切り替える。
 * 対応しないブラウザでは普通の hidden にする。今の章は URL の #q1〜 に残し、読み上げには「問い 4 / 8」と知らせる
 */
import { $, $$ } from './dom';

export interface ChapterNavOpts {
  /** 1 問ずつ・すべての選択を保存するキー（localStorage） */
  key: string;
  /** 1 問ずつのときに別の章へ移る直前に呼ぶ（鳴っている音を止めるなど） */
  onLeave?: () => void;
}

interface GoOpts {
  /** 読み上げで知らせる（既定は知らせる） */
  announce?: boolean;
  /** 章の頭までスクロールする（既定はする） */
  scroll?: boolean;
  /** 章の見出しへフォーカスを移す */
  focus?: boolean;
}

export function initChapterNav(root: HTMLElement, o: ChapterNavOpts): void {
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
    if (localStorage.getItem(o.key) === 'all') view = 'all';
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

  function go(i: number, g: GoOpts = {}): void {
    const ch = chs[i];
    if (!ch) return;
    const moved = i !== cur;
    cur = i;
    if (moved && view === 'one') o.onLeave?.();
    paint(g.announce ?? true);
    try {
      history.replaceState(null, '', `#${ids[cur]}`);
    } catch {
      /* file: など */
    }
    if (g.scroll !== false) toTop(ch, view === 'all');
    if (g.focus) ch.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  function setView(v: string): void {
    view = v;
    try {
      localStorage.setItem(o.key, v);
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
    // ← → で前後へ。入力欄・スライダー・図・修飾キーのときは使わない（図では点を動かす）
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (!(t instanceof Element) || t.closest('input,textarea,select,[contenteditable],svg,canvas') || !list.hidden)
      return;
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

  // 本文の出典番号 [n] を押したとき、出典の枠が閉じていれば先に開く（開閉は lib/tool-page.ts の見出しのボタン）
  const refs = root.querySelector<HTMLElement>('.crefs');
  root.addEventListener('click', (e) => {
    if (!refs?.classList.contains('shut') || !(e.target instanceof Element) || !e.target.closest('a.rf')) return;
    refs.querySelector<HTMLElement>('.fold')?.click();
  });

  paint(false);
  root.classList.add('ready');
  const ch = chs[cur];
  if (ch && location.hash && ids.includes(location.hash.slice(1))) toTop(ch, false);
}

/**
 * 式の項（MathML の data-k）と、それを含む章（.ch）の data-hl を結ぶ。
 * マウスでは載せている間、タッチとキーでは押すたびに入れ替える。図はページが data-hl を見て光らせる
 */
export function bindEq(root: ParentNode): void {
  for (const el of $$<MathMLElement>('.eq [data-k]', root)) {
    const ch = el.closest<HTMLElement>('.ch');
    if (!ch) continue;
    const on = () => {
      ch.dataset.hl = el.dataset.k;
      for (const e of $$(`.eq [data-k="${el.dataset.k}"]`, ch)) e.classList.add('on');
    };
    const off = () => {
      delete ch.dataset.hl;
      for (const e of $$('.eq [data-k].on', ch)) e.classList.remove('on');
    };
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') on();
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') off();
    });
    el.addEventListener('click', () => {
      if (ch.dataset.hl === el.dataset.k) off();
      else {
        off();
        on();
      }
    });
  }
}

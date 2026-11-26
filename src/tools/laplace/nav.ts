/**
 * 章の移動。画面の下端の帯に今の章の題・前後のボタン・全章の切り替えを置く。
 * 1 章ずつ（既定）では今の章のほかを hidden で隠し、章を変えたら章の枠へフォーカスを移して読み上げる。
 * 全章ではすべて出し、帯はスクロールに合わせて今の章を示す。章は URL の #c1〜#c6 に残し、戻るで前の章へ戻れる
 */
export function initChapterNav(): void {
  const secs = [...document.querySelectorAll<HTMLElement>('#lap [data-ch]')].map(
    (el) => el.closest('.pnl') as HTMLElement,
  );
  const N = secs.length;
  const titles = secs.map((s) => s.querySelector('h2')?.textContent?.trim() ?? '');
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const prev = el('lap-prev') as HTMLButtonElement,
    next = el('lap-next') as HTMLButtonElement,
    cur = el('lap-cur') as HTMLButtonElement,
    tt = el('lap-tt'),
    pg = el('lap-pg'),
    allBtn = el('lap-all'),
    toc = el('lap-toc'),
    live = el('lap-live');
  const items = [...toc.querySelectorAll<HTMLButtonElement>('[data-go]')];
  let at = 0,
    all = false;
  for (const s of secs) s.tabIndex = -1;

  const railH = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-h')) || 52;
  const scrollTo = (i: number) => {
    const y = secs[i].getBoundingClientRect().top + window.scrollY - railH() - 14;
    window.scrollTo({ top: Math.max(0, y) });
  };
  /** 帯と章の出し入れを今の状態に合わせる */
  const render = () => {
    secs.forEach((s, i) => {
      s.hidden = !all && i !== at;
    });
    prev.disabled = at === 0;
    next.disabled = at === N - 1;
    tt.textContent = titles[at];
    pg.textContent = `${at + 1} / ${N}`;
    allBtn.setAttribute('aria-pressed', String(all));
    items.forEach((b, i) => {
      if (i === at) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  };
  const go = (i: number, push = true) => {
    at = Math.max(0, Math.min(N - 1, i));
    render();
    scrollTo(at);
    secs[at].focus({ preventScroll: true });
    live.textContent = `${at + 1} / ${N} ${titles[at]}`;
    if (push && location.hash !== `#c${at + 1}`) history.pushState(null, '', `#c${at + 1}`);
  };
  const fromHash = (): number | null => {
    const m = /^#c(\d+)$/.exec(location.hash);
    return m ? Math.max(0, Math.min(N - 1, Number(m[1]) - 1)) : null;
  };

  /* 章の一覧 */
  const openToc = (v: boolean) => {
    toc.hidden = !v;
    cur.setAttribute('aria-expanded', String(v));
  };
  cur.addEventListener('click', () => {
    openToc(toc.hidden !== false);
    if (!toc.hidden) items[at].focus();
  });
  for (const [i, b] of items.entries())
    b.addEventListener('click', () => {
      openToc(false);
      go(i);
    });
  document.addEventListener('pointerdown', (e) => {
    if (!toc.hidden && !(e.target as Element).closest('.lap-nt')) openToc(false);
  });

  prev.addEventListener('click', () => go(at - 1));
  next.addEventListener('click', () => go(at + 1));
  allBtn.addEventListener('click', () => {
    all = !all;
    go(at, false);
  });
  // #c なしの URL まで戻ったら 1 章
  window.addEventListener('popstate', () => go(fromHash() ?? 0, false));

  /* ← → で前後の章。入力・図・一覧の中では使わない（図では点を動かす） */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !toc.hidden) {
      openToc(false);
      cur.focus();
      return;
    }
    if (all || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('input,textarea,select,canvas,[contenteditable],.lap-toc,.menu')) return;
    e.preventDefault();
    go(at + (e.key === 'ArrowRight' ? 1 : -1));
  });

  /* 全章では、画面の上から 3 分の 1 を越えた最後の章を今の章にする */
  let pend = false;
  window.addEventListener(
    'scroll',
    () => {
      if (!all || pend) return;
      pend = true;
      requestAnimationFrame(() => {
        pend = false;
        const line = innerHeight / 3;
        let i = 0;
        secs.forEach((s, k) => {
          if (s.getBoundingClientRect().top < line) i = k;
        });
        if (i !== at) {
          at = i;
          render();
        }
      });
    },
    { passive: true },
  );

  at = fromHash() ?? 0;
  render();
  if (fromHash() != null) requestAnimationFrame(() => scrollTo(at));
}

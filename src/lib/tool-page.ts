/**
 * ツールのページに共通の動き: 「?」の吹き出し、開閉できる枠、関連ツールの件数。
 * 各ツールの入口スクリプトから 1 度だけ呼ぶ
 */
import { $, $$ } from './dom';
import { fx, POP_IN, POP_OUT, RM } from './motion';
import { initSite } from './site';

/* 「?」の吹き出し（PageTitle.astro） */
function initHelp(): void {
  const btn = $('#descBtn'),
    desc = $('#desc'),
    box = $('.ttl');
  const place = () => {
    const r = box.getBoundingClientRect(),
      b = btn.getBoundingClientRect();
    const cx = b.left + b.width / 2 - r.left,
      w = desc.offsetWidth;
    const bx = Math.max(0, Math.min(cx - 24, r.width - w));
    desc.style.setProperty('--bx', `${bx}px`);
    desc.style.setProperty('--ax', `${cx - bx}px`);
  };
  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
  const set = (open: boolean) => {
    if (open === isOpen()) return;
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      desc.hidden = false;
      place();
      fx(desc, POP_IN, 160);
    } else
      fx(desc, POP_OUT, 120, () => {
        if (!isOpen()) desc.hidden = true;
      });
  };
  btn.addEventListener('click', () => set(!isOpen()));
  document.addEventListener('click', (e) => {
    if (isOpen() && !(e.target as Element).closest('#descBtn, #desc')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      set(false);
      btn.focus();
    }
  });
  addEventListener('resize', () => {
    if (isOpen()) place();
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
  initHelp();
  initCollapsible();
  initRelated();
}

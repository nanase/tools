/**
 * 全ページ共通の動き: 配色、ツールメニュー、上部バーのページ名。
 * 各ページの入口スクリプトから initSite() を 1 度だけ呼ぶ
 */
import { $, $$, norm } from './dom';
import { wavePath } from './logo';
import { FADE_IN, FADE_OUT, fx, POP_IN, POP_OUT, RM } from './motion';

const root = document.documentElement;

/* ---------- 配色 ---------- */
type Theme = 'system' | 'light' | 'dark';
const TH: Theme[] = ['system', 'light', 'dark'];
const TL: Record<Theme, string> = { system: '自動', light: 'ライト', dark: 'ダーク' };
/** 選択は localStorage に保存し、描画前に head のインラインスクリプト（SiteLayout.astro）が data-theme を当てる */
const KEY = 'theme';
const save = (v: Theme) => {
  try {
    if (v === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* 保存できない環境では、このページの中だけ切り替える */
  }
};

function initTheme(): void {
  const btn = $('#themeBtn');
  const set = (v: Theme) => {
    if (v === 'system') delete root.dataset.theme;
    else root.dataset.theme = v;
    const nx = TH[(TH.indexOf(v) + 1) % 3];
    btn.dataset.s = v;
    btn.setAttribute('aria-label', `配色: ${TL[v]}`);
    btn.title = `配色: ${TL[v]}（押すと${TL[nx]}）`;
  };
  /* 押したときだけ色を 0.3 秒かけて切り替える（読み込み時には動かさない） */
  let t: ReturnType<typeof setTimeout> | undefined;
  btn.addEventListener('click', () => {
    root.classList.add('theming');
    clearTimeout(t);
    t = setTimeout(() => root.classList.remove('theming'), 360);
    const v = TH[(TH.indexOf(btn.dataset.s as Theme) + 1) % 3];
    set(v);
    save(v);
  });
  const cur = root.dataset.theme;
  set(cur === 'light' || cur === 'dark' ? cur : 'system');
}

/* ---------- メニュー（ツール一覧はビルド時に HTML で出し、ここでは絞り込みだけ） ---------- */
function initMenu(): void {
  const menu = $('#menu'),
    btn = $('#menuBtn'),
    scrim = $('#scrim'),
    mq = $<HTMLInputElement>('#mq'),
    list = $('#menuList');
  const groups = $$('.mg', list),
    none = $('.none', list);
  const filter = () => {
    const ws = norm(mq.value.trim()).split(/\s+/).filter(Boolean);
    let any = false;
    for (const g of groups) {
      let n = 0;
      for (const li of $$('li', g)) {
        const hit = ws.every((w) => li.dataset.k?.includes(w));
        li.hidden = !hit;
        if (hit) n++;
      }
      g.hidden = !n;
      any ||= n > 0;
    }
    none.hidden = any;
  };
  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
  const open = (focusQ: boolean) => {
    filter();
    menu.hidden = scrim.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    fx(menu, POP_IN, 180);
    fx(scrim, FADE_IN, 180);
    (focusQ ? mq : menu).focus();
  };
  const close = (ret: boolean) => {
    if (!isOpen()) return;
    btn.setAttribute('aria-expanded', 'false');
    fx(scrim, FADE_OUT, 140);
    fx(menu, POP_OUT, 140, () => {
      if (!isOpen()) menu.hidden = scrim.hidden = true;
    });
    if (ret) btn.focus();
  };
  btn.addEventListener('click', () => (isOpen() ? close(false) : open(false)));
  scrim.addEventListener('click', () => close(false));
  mq.addEventListener('input', filter);
  mq.addEventListener('keydown', (e) => {
    const a = list.querySelector<HTMLElement>('li:not([hidden]) a.mi');
    if (e.key === 'Enter') {
      e.preventDefault();
      a?.click();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      a?.focus();
    }
  });
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) close(false);
  });
  menu.addEventListener('focusout', (e) => {
    const t = e.relatedTarget as Node | null;
    if (t && !menu.contains(t) && t !== btn) close(false);
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement,
      ed = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      isOpen() ? close(true) : open(true);
    } else if (e.key === '/' && !ed && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const q = document.getElementById('q');
      if (q) q.focus();
      else open(true);
    } else if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      close(true);
    }
  });
}

/* ---------- 上部バー: ページ見出しが隠れたらページ名を出す ---------- */
function initBrand(): void {
  const brand = $('.brand'),
    h = $('main h1');
  const page = brand.dataset.page;
  if (!page || !h) return;
  const site = $('#brandT').textContent ?? '',
    sub = $('#brandS').textContent ?? '';
  const show = (on: boolean) => {
    if (brand.classList.contains('page') === on) return;
    brand.classList.toggle('page', on);
    $('#brandT').textContent = on ? page : site;
    $('#brandS').textContent = on ? site : sub;
    brand.classList.remove('swap');
    void brand.offsetWidth;
    brand.classList.add('swap');
  };
  let raf = 0;
  addEventListener(
    'scroll',
    () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          show(h.getBoundingClientRect().bottom < $('.rail').offsetHeight);
        });
    },
    { passive: true },
  );
  brand.addEventListener('click', (e) => {
    if (brand.classList.contains('page')) {
      e.preventDefault();
      scrollTo({ top: 0, behavior: RM.matches ? 'auto' : 'smooth' });
    }
  });
}

/* ---------- 上部バーのアイコン: マウスを乗せている間、矩形波の周期を伸び縮みさせる ---------- */
/** 周期の倍率は exp(-A sin θ)（1/2 〜 2 倍）。θ は W [rad/s] で進む。離すと時定数 TAU [s] で 1 倍へ戻る */
const A = Math.LN2,
  W = (2 * Math.PI) / 2.4,
  TAU = 0.12;

function initLogo(): void {
  const brand = $('.brand'),
    wave = $<SVGPathElement>('.brand path');
  /* u は倍率の対数 */
  let on = false,
    th = 0,
    u = 0,
    raf = 0,
    last = 0;
  const step = (t: number) => {
    const dt = Math.min((t - last) / 1000, 0.1);
    last = t;
    if (on) {
      th += W * dt;
      u = -A * Math.sin(th);
    } else {
      u *= Math.exp(-dt / TAU);
      if (Math.abs(u) < 1e-3) u = 0;
    }
    wave.setAttribute('d', wavePath(Math.exp(u)));
    raf = on || u ? requestAnimationFrame(step) : 0;
  };
  const hover = (v: boolean) => (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || RM.matches) return;
    on = v;
    /* 戻る途中で乗せ直したら、その倍率から続ける */
    if (on) th = Math.asin(-u / A);
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(step);
    }
  };
  brand.addEventListener('pointerenter', hover(true));
  brand.addEventListener('pointerleave', hover(false));
}

export function initSite(): void {
  initTheme();
  initMenu();
  initBrand();
  initLogo();
}

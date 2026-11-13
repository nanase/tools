/**
 * トップの入口: 共通の動き、ツール一覧の絞り込み、一覧とカードの切り替え（一覧はビルド時に HTML で出している）。
 * 一覧では行にマウスを乗せると、その行のカードを横に浮かべて図柄を動かす
 */
import { $, $$, norm } from '../lib/dom';
import { FADE_IN, fx } from '../lib/motion';
import { initSite } from '../lib/site';
import { forget, store } from '../lib/store';
import { drop, play } from './card-motion';

initSite();

const q = $<HTMLInputElement>('#q'),
  box = $('#shelves'),
  shelves = $$('#shelves section'),
  rows = $$<HTMLElement>('#shelves .unit'),
  views = $$<HTMLButtonElement>('#views [data-v]'),
  peek = $('#peek');

/* ---------- 絞り込み ---------- */
function render(): void {
  const ws = norm(q.value.trim()).split(/\s+/).filter(Boolean);
  let n = 0;
  for (const s of shelves) {
    let k = 0;
    for (const u of $$('.unit', s)) {
      const hit = ws.every((w) => u.dataset.k?.includes(w));
      u.hidden = !hit;
      if (hit) k++;
    }
    s.hidden = !k;
    $('.shelf-h .n', s).textContent = String(k);
    n += k;
  }
  $('#shelves .empty').hidden = n > 0;
  $('#count').textContent = `${n} / ${rows.length}`;
  hidePeek();
}
q.addEventListener('input', render);

/* ---------- 一覧とカードの切り替え（既定は一覧。カードにしたときだけ保存し、描く前に index.astro が戻す） ---------- */
for (const b of views)
  b.addEventListener('click', () => {
    const v = b.dataset.v ?? 'list';
    if (v === box.dataset.view) return;
    box.dataset.view = v;
    for (const x of views) x.setAttribute('aria-pressed', String(x === b));
    if (v === 'list') forget('c:view');
    else store('c:view', v);
    hidePeek();
  });

/* ---------- 一覧の行に浮かべるカード（マウスで指せる端末と、キーボードで行へ移ったとき） ---------- */
const FINE = matchMedia('(hover: hover) and (pointer: fine)');
let shown: { row: HTMLElement; svg: SVGSVGElement | null } | undefined;

function showPeek(row: HTMLElement): void {
  if (box.dataset.view !== 'list') return;
  hidePeek();
  /* 複製はリンクにしない（読み上げとキーボードは元の行で足りる） */
  const card = row.cloneNode(true) as HTMLElement;
  card.removeAttribute('href');
  card.removeAttribute('data-k');
  peek.replaceChildren(card);
  peek.hidden = false;
  place(row);
  const svg = card.querySelector<SVGSVGElement>('svg[data-art]');
  if (svg) play(svg);
  shown = { row, svg };
  fx(peek, FADE_IN, 120);
}

function hidePeek(): void {
  if (!shown) return;
  if (shown.svg) drop(shown.svg);
  shown = undefined;
  peek.hidden = true;
  peek.replaceChildren();
}

/** 行の右に置く。右がはみ出すときは左に置き、上下は上部バーと画面の下端の間に収める */
function place(row: HTMLElement): void {
  const r = row.getBoundingClientRect(),
    o = (peek.offsetParent ?? document.body).getBoundingClientRect(),
    top = $('.rail').getBoundingClientRect().bottom + 8,
    w = peek.offsetWidth,
    h = peek.offsetHeight,
    gap = 12;
  let x = r.right + gap;
  if (x + w > innerWidth - 8) x = r.left - gap - w;
  const y = Math.max(top, Math.min(r.top + (r.height - h) / 2, innerHeight - h - 8));
  peek.style.left = `${x - o.left}px`;
  peek.style.top = `${y - o.top}px`;
}

for (const row of rows) {
  row.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse' && FINE.matches) showPeek(row);
  });
  row.addEventListener('pointerleave', () => {
    if (shown?.row === row) hidePeek();
  });
  row.addEventListener('focus', () => {
    if (row.matches(':focus-visible')) showPeek(row);
  });
  row.addEventListener('blur', () => {
    if (shown?.row === row) hidePeek();
  });
}

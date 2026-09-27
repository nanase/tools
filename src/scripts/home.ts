/** トップの入口: 共通の動きと、ツール一覧の絞り込み（一覧はビルド時に HTML で出している） */
import { $, $$, norm } from '../lib/dom';
import { initSite } from '../lib/site';

initSite();

const q = $<HTMLInputElement>('#q'),
  cats = $('#cats'),
  shelves = $$('#shelves section'),
  total = $$('#shelves .unit').length;
let cat = 'all';

function render(): void {
  const ws = norm(q.value.trim()).split(/\s+/).filter(Boolean);
  let n = 0;
  for (const s of shelves) {
    let k = 0;
    if (cat === 'all' || cat === s.dataset.c)
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
  $('#count').textContent = `${n} / ${total}`;
  for (const b of $$('.cat', cats)) b.setAttribute('aria-pressed', String(b.dataset.c === cat));
}

cats.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-c]');
  if (b) {
    cat = b.dataset.c ?? 'all';
    render();
  }
});
q.addEventListener('input', render);

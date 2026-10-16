/**
 * 写真と比べる: 写真を 1 枚選ぶと、撮影したときの光源の高度・画角・向きと、写真から見積もった結晶の組み合わせで
 * 空を計算し、写真の隣に並べる。描画は本体とは別の WebGL2 の画面で、枠を開いている間だけ動かす
 */
import { $, esc } from '../../lib/dom';
import { store, stored } from '../../lib/store';
import { PHOTOS, type Photo } from './photos';
import { HaloRenderer } from './render';

const BASE = import.meta.env.BASE_URL;

export function initCompare(): void {
  const box = $('#phs'),
    det = box.closest('details');
  if (!det || !PHOTOS.length) return;
  let cur = PHOTOS.find((p) => p.id === stored('photo')) ?? PHOTOS[0];
  box.innerHTML =
    `<div class="chips ph-pick" role="group" aria-label="写真">${PHOTOS.map(
      (p) => `<button type="button" class="chip" data-id="${p.id}" aria-pressed="${p === cur}">${esc(p.name)}</button>`,
    ).join('')}</div>` +
    '<div class="ph-pair"><figure><img id="ph-img" alt="" decoding="async"><figcaption id="ph-cap"></figcaption></figure>' +
    '<figure><div class="ph-sim"><canvas id="ph-sim" aria-label="同じ条件で計算した空"></canvas></div><figcaption id="ph-scap"></figcaption></figure></div>' +
    '<p class="ph-meta" id="ph-meta"></p><p class="ph-meta" id="ph-attr"></p>';
  const cv = $<HTMLCanvasElement>('#ph-sim'),
    img = $<HTMLImageElement>('#ph-img');
  let R: HaloRenderer | null = null,
    raf = 0,
    target = 0;
  const show = (p: Photo) => {
    cur = p;
    store('photo', p.id);
    for (const b of box.querySelectorAll<HTMLButtonElement>('.ph-pick button'))
      b.setAttribute('aria-pressed', String(b.dataset.id === p.id));
    img.src = `${BASE}photos/halo/${p.id}.jpg`;
    img.width = p.w;
    img.height = p.h;
    img.alt = `写真: ${p.halos.join('・')}`;
    $('#ph-cap').textContent = '写真';
    $('#ph-scap').textContent = `計算（${p.moon ? '月' : '太陽'}の高度 ${p.elev}°、結晶は写真から見積もった例）`;
    $('#ph-meta').textContent = `${p.date}、${p.place}。${p.lens}。写っているハロ: ${p.halos.join('・')}`;
    $('#ph-attr').innerHTML =
      `写真: ${esc(p.author)}「${esc(p.title)}」<a href="${esc(p.page)}" rel="noopener">Wikimedia Commons</a>、` +
      (p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" rel="noopener">${esc(p.license)}</a>` : esc(p.license)) +
      '。縮めて載せています。';
    cv.style.aspectRatio = `${p.w} / ${p.h}`;
    if (R) {
      R.setSource({ elev: p.elev, moon: p.moon, age: 14.8 });
      R.setCrystals(p.pops, 0);
      R.setCloud({ tau: p.tau, rough: 0.63, hc: p.hc });
      target = 1.5e8;
      kick();
    }
  };
  const frame = () => {
    raf = 0;
    if (!R || !det.open || document.hidden) return;
    const w = cv.clientWidth,
      h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    if (R.rays < target) {
      R.traceRays(1 << 21);
      R.finish();
    }
    R.draw({ proj: cur.proj, fov: cur.fov, az: cur.az, alt: cur.alt, ev: cur.ev, only: false });
    if (R.rays < target) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  box.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.ph-pick button');
    const p = b && PHOTOS.find((x) => x.id === b.dataset.id);
    if (p) show(p);
  });
  det.addEventListener('toggle', () => {
    if (!det.open) return;
    if (!R)
      try {
        R = new HaloRenderer(cv, 512);
      } catch {
        $('#ph-scap').textContent = 'このブラウザでは WebGL2 が使えないため、計算した空を出せません。';
      }
    show(cur);
  });
  new ResizeObserver(() => kick()).observe(cv);
  show(cur);
}

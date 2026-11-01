/**
 * 画像の破損のページの入口: 見本かファイル → 3 形式に符号化（Worker）→
 * 同じ操作で壊して自前の復号器で描く。ブラウザの表示は img で切り替える
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { bindFileInput, loadImage } from '../../lib/imgfmt/file';
import { initToolPage } from '../../lib/tool-page';
import { drawSample, SAMPLE_H, SAMPLE_W } from '../jpeg/sample';
import type { FilterMode } from '../png/filter';
import {
  CHART_H,
  CHART_W,
  chart,
  ILLUST_H,
  ILLUST_W,
  illust,
  PHOTO_H,
  PHOTO_W,
  photo,
  SCREEN_H,
  SCREEN_W,
  screen,
} from '../png/samples';
import { ENCODE_DEFAULTS, type EncodeOpts, type Fmt, type Source } from './codec';
import type { OpKind, Outcome, Place, Plan } from './model';
import { MAX_SIDE } from './params';
import { type Job, type Reply, Runner } from './worker';

initToolPage();

const cnt = (v: number): string => v.toLocaleString('en');
const hex6 = (v: number): string => v.toString(16).toUpperCase().padStart(6, '0');
const pct = (r: number): string => (r === 0 ? '0' : r < 0.01 ? '<1' : String(Math.round(r * 100)));
const MIME: Record<Fmt, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };

/* ---------- 見本 ---------- */
function jpegSample(): Source {
  const c = document.createElement('canvas');
  c.width = SAMPLE_W;
  c.height = SAMPLE_H;
  const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  drawSample(x);
  return { w: SAMPLE_W, h: SAMPLE_H, rgba: x.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data };
}
const DRAW: Record<string, () => Source> = {
  photo: () => ({ w: PHOTO_W, h: PHOTO_H, rgba: photo() }),
  illust: () => ({ w: ILLUST_W, h: ILLUST_H, rgba: illust() }),
  screen: () => ({ w: SCREEN_W, h: SCREEN_H, rgba: screen() }),
  chart: () => ({ w: CHART_W, h: CHART_H, rgba: chart() }),
  jpeg: jpegSample,
};
const smpCache: Record<string, Source> = {};

/* ---------- 入力 ---------- */
let src: Source | null = null,
  imgId = 0,
  seed = 1,
  posV = 300,
  widthV = 0,
  heightV = 0;

const smp$ = new Choice($('#p-smp'), () => setSample());
const place$ = new Choice<Place>($('#p-place'), () => {
  syncRows();
  request();
});
const op$ = new Choice<OpKind>($('#p-op'), () => {
  syncRows();
  request();
});
const n$ = new Choice($('#p-n'), () => request());
const view$ = new Choice($('#p-view'), () => request());
const level$ = new Choice($('#p-level'), () => request());
const filter$ = new Choice($('#p-filter'), () => request());
const dri$ = new Choice($('#p-dri'), () => request());
const il$ = new Choice($('#p-il'), () => request());

const range = $<HTMLInputElement>('#pos');
const browser = (): boolean => view$.value === '1';

function encOpts(): EncodeOpts {
  const f = filter$.value;
  return {
    ...ENCODE_DEFAULTS,
    level: Number(level$.value),
    filter: (f === 'adaptive' ? 'adaptive' : Number(f)) as FilterMode,
    dri: Number(dri$.value),
    interlace: il$.value === '1',
  };
}
function plan(): Plan {
  return {
    place: place$.value,
    op: op$.value,
    n: Number(n$.value),
    seed,
    pos: posV / 1000,
    width: widthV,
    height: heightV,
  };
}

/** つまみと選択肢を場所に合わせる */
function syncRows(): void {
  const p = place$.value,
    dim = p === 'width' || p === 'height';
  op$.setOff(dim);
  n$.setOff(dim || op$.value === 'cut');
  $<HTMLButtonElement>('#again').disabled = dim || op$.value === 'cut';
  const s = src;
  if (dim && s) {
    const whole = p === 'width' ? s.w : s.h;
    range.min = '1';
    range.max = String(whole * 2);
    range.value = String(p === 'width' ? widthV : heightV);
    $('#pos-l').textContent = p === 'width' ? '幅' : '高さ';
  } else {
    range.min = '0';
    range.max = '999';
    range.value = String(posV);
    $('#pos-l').textContent = '位置';
  }
  syncRange();
}
function syncRange(): void {
  const lo = Number(range.min),
    hi = Number(range.max),
    v = Number(range.value);
  range.style.setProperty('--p', String((v - lo) / (hi - lo)));
  const p = place$.value;
  $('#pos-v').textContent = p === 'width' || p === 'height' ? `${cnt(v)} px` : `${(v / 10).toFixed(1)} %`;
}
range.addEventListener('input', () => {
  const v = Number(range.value),
    p = place$.value;
  if (p === 'width') widthV = v;
  else if (p === 'height') heightV = v;
  else posV = v;
  syncRange();
  request();
});
$('#again').addEventListener('click', () => {
  seed++;
  request();
});

/* ---------- 計算（Web Worker） ---------- */
const local = new Runner();
let worker: Worker | null = null,
  noWorker = false,
  busy = false,
  pending = false,
  jobId = 0;
function mkWorker(): Worker | null {
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Reply>) => done(e.data);
    w.onerror = (e) => {
      e.preventDefault();
      worker = null;
      noWorker = true;
      busy = false;
      if (src) local.setImage(imgId, src);
      request();
    };
    return w;
  } catch {
    noWorker = true;
    return null;
  }
}
function sendImg(s: Source): void {
  local.setImage(imgId, s);
  if (!worker) return;
  const c = s.rgba.slice();
  worker.postMessage({ kind: 'img', img: imgId, src: { w: s.w, h: s.h, rgba: c } } satisfies Job, [c.buffer]);
}
function request(): void {
  if (!src) return;
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  if (!worker && !noWorker) {
    worker = mkWorker();
    if (worker) sendImg(src);
  }
  const j: Job = { kind: 'run', id: ++jobId, img: imgId, enc: encOpts(), plan: plan(), bytes: browser() };
  if (worker) worker.postMessage(j);
  else
    setTimeout(() => {
      const r = local.run(j);
      if (r) done(r);
      else busy = false;
    }, 16);
}
function done(r: Reply): void {
  busy = false;
  if (r.img === imgId) draw(r);
  if (pending) {
    pending = false;
    request();
  }
}
/* ---------- 描く ---------- */
/** 大きさが変わっても元と同じ縮尺で描き、枠に入らない分だけ縮める。枠の幅に対する幅 */
function fitWidth(dw: number, dh: number, W: number, H: number): string {
  return `${((dw * Math.min(1, W / dw, H / dh)) / W) * 100}%`;
}

const blobs: Partial<Record<Fmt, string>> = {};
function drawOne(o: Outcome, W: number, H: number): void {
  const f = o.fmt,
    d = o.d,
    box = $(`#fr-${f}`),
    cv = $<HTMLCanvasElement>(`#cv-${f}`),
    im = $<HTMLImageElement>(`#im-${f}`),
    no = $(`#no-${f}`);
  box.style.aspectRatio = `${W} / ${H}`;
  cv.width = Math.max(1, d.w);
  cv.height = Math.max(1, d.h);
  cv.style.width = fitWidth(d.w || W, d.h || H, W, H);
  if (d.w && d.h)
    (cv.getContext('2d') as CanvasRenderingContext2D).putImageData(
      new ImageData(d.rgba as Uint8ClampedArray<ArrayBuffer>, d.w, d.h),
      0,
      0,
    );
  const on = browser();
  cv.hidden = on;
  no.hidden = true;
  im.hidden = !on;
  if (on && o.bytes) {
    const old = blobs[f];
    if (old) URL.revokeObjectURL(old);
    const u = URL.createObjectURL(new Blob([o.bytes as Uint8Array<ArrayBuffer>], { type: MIME[f] }));
    blobs[f] = u;
    im.onload = () => {
      im.style.width = fitWidth(im.naturalWidth, im.naturalHeight, W, H);
    };
    im.onerror = () => {
      im.hidden = true;
      no.hidden = false;
    };
    im.src = u;
  }
  $(`#rd-${f}`).textContent = on ? '—' : `${pct(o.ratio)} %`;
  $(`#hit-${f}`).textContent = `${o.part} · 位置 ${hex6(o.hit)}`;
  const iss = $(`#iss-${f}`);
  iss.textContent = iss.title = d.issues.join(' · ');
  /* ファイルの帯 */
  const head = $(`#sh-${f}`),
    data = $(`#sd-${f}`),
    tail = $(`#st-${f}`),
    mark = $(`#sm-${f}`);
  head.textContent = `${cnt(o.dataStart)} B`;
  data.textContent = `データ ${cnt(o.dataEnd - o.dataStart)} B`;
  tail.hidden = o.size === o.dataEnd;
  /* 印を置く区画と、その中の割合 */
  const inHead = o.hit < o.dataStart,
    frac = inHead ? o.hit / Math.max(1, o.dataStart) : (o.hit - o.dataStart) / Math.max(1, o.dataEnd - o.dataStart);
  (inHead ? head : data).append(mark);
  mark.style.left = `${Math.min(100, frac * 100)}%`;
}
function draw(r: Reply): void {
  for (const o of r.r) drawOne(o, r.w, r.h);
}

/* ---------- 画像を変える ---------- */
function setSource(s: Source): void {
  src = s;
  imgId++;
  widthV = s.w + 8;
  heightV = Math.round(s.h * 0.75);
  sendImg(s);
  syncRows();
  request();
}
function setSample(): void {
  $('#fileBtn').setAttribute('aria-pressed', 'false');
  $('#m-file').textContent = '';
  const id = smp$.value;
  smpCache[id] ??= DRAW[id]();
  setSource(smpCache[id]);
}
const fileBtn = $('#fileBtn');
bindFileInput(fileBtn, $<HTMLInputElement>('#fileIn'), [$('#ic-root')], (f) => {
  $('#m-file').textContent = '';
  loadImage(f, { maxSide: MAX_SIDE, bg: '#ffffff' })
    .then((im) => {
      fileBtn.setAttribute('aria-pressed', 'true');
      /* 見本の選択を外す（どの見本を押しても戻れるように） */
      smp$.set('');
      $('#m-file').textContent = `${f.name} · ${im.w}×${im.h}`;
      setSource({ w: im.w, h: im.h, rgba: im.rgba });
    })
    .catch(() => {
      $('#m-file').textContent = 'この画像は読めません。';
    });
});

setSample();

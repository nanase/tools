/**
 * GIF のページの入口: 見本かファイル → 減色と符号化、または読み取り →
 * 工程の帯で選んだ項目（パレット・インターレース・LZW・ファイル）の図を 1 つだけ描く
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { bindFileInput, loadImage, saveBytes } from '../../lib/imgfmt/file';
import { initToolPage } from '../../lib/tool-page';
import { drawFile } from './file-view';
import { decodeLzw } from './lzw';
import { type Dir, drawLzw } from './lzw-view';
import {
  type Fail,
  type FrameView,
  frameView,
  fromBytes,
  fromImage,
  interlacePair,
  MAX_PIXELS,
  type Model,
  progressive,
} from './model';
import { CHAPTERS, MAX_SIDE } from './params';
import { toRgba } from './quant';
import { SOFT_H, SOFT_W, SPRITE_H, SPRITE_W, STRIPE_H, STRIPE_W, soft, sprite, stripes } from './samples';
import { Track } from './track';

initToolPage();

/** 始めの符号（Clear の直後は辞書が空なので、少し育った所から見せる） */
const START_STEP = 24;
const cnt = (v: number): string => v.toLocaleString('en');
const size = (n: number): string =>
  n < 10240 ? `${cnt(n)} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

interface Img {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  name: string;
}
const DRAW: Record<string, () => Img> = {
  sprite: () => ({ w: SPRITE_W, h: SPRITE_H, rgba: sprite(), name: 'sprite' }),
  stripes: () => ({ w: STRIPE_W, h: STRIPE_H, rgba: stripes(), name: 'stripes' }),
  soft: () => ({ w: SOFT_W, h: SOFT_H, rgba: soft(), name: 'soft' }),
};
const smpCache: Record<string, Img> = {};

/** 今の画像（GIF ファイルなら null） */
let img: Img | null = null,
  M: Model | null = null,
  fi = 0,
  step = 0,
  hover = -1,
  pinned = -1,
  fileGif: Model | null = null;

const ch$ = new Choice($('#bar'), () => showCh());
const smp$ = new Choice($('#p-smp'), () => setSample());
const cl$ = new Choice($('#p-cl'), () => rebuild());
const di$ = new Choice($('#p-di'), () => rebuild());
const dir$ = new Choice<Dir>($('#p-dir'), () => drawCh());

const cur = (): FrameView => frameView(M as Model, fi);

/* ---------- 計算 ---------- */
function rebuild(): void {
  M = img
    ? fromImage(img.rgba, img.w, img.h, { colors: Number(cl$.value), dither: di$.value === '1' }, img.name)
    : fileGif;
  if (step === 0) step = START_STEP;
  fi = 0;
  drawBar();
  syncRows();
  dirty();
  drawCh();
}
function setSample(): void {
  $('#fileBtn').setAttribute('aria-pressed', 'false');
  const id = smp$.value;
  smpCache[id] ??= DRAW[id]();
  img = smpCache[id];
  $('#m-file').textContent = '';
  step = 0;
  rebuild();
}
function syncRows(): void {
  const m = M as Model,
    asIs = m.asIs;
  cl$.setOff(asIs, '元のファイルのまま');
  di$.setOff(asIs || (m.exact && m.used !== null), asIs ? '元のファイルのまま' : '色が上限以下');
  const multi = m.n > 1;
  $('#lz-fr').hidden = !multi;
  $('#save').toggleAttribute('disabled', asIs);
}
function drawBar(): void {
  const m = M as Model,
    v = frameView(m, 0),
    p = interlacePair(v);
  $('#bv-pal').textContent = `${v.colors} 色`;
  $('#bv-il').textContent = `${size(p.plain.length)} → ${size(p.il.length)}`;
  $('#bv-lzw').textContent = size(v.f.data.length);
  $('#bv-file').textContent = size(m.bytes.length);
}

/* ---------- 項目の切り替え ---------- */
let drawn = '';
const dirty = (): void => {
  drawn = '';
};
function showCh(): void {
  const c = ch$.value;
  for (const el of $$<HTMLElement>('.gf-ch')) el.classList.toggle('on', el.classList.contains(`gc-${c}`));
  /* 帯が狭いときは、選んだ項目が見えるように送る */
  const bar = $('#bar'),
    on = bar.querySelector<HTMLElement>('button[aria-pressed="true"]');
  if (on && bar.scrollWidth > bar.clientWidth)
    bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2 - bar.offsetLeft;
  drawStepNav();
  setPlay(false);
  dirty();
  drawCh();
}
/** 前後の工程のボタンの名前と、押せるか */
function drawStepNav(): void {
  const i = CHAPTERS.findIndex(([v]) => v === ch$.value),
    set = (id: string, c: readonly [string, string] | undefined): void => {
      const b = $<HTMLButtonElement>(id);
      b.disabled = !c;
      (b.querySelector('b') as HTMLElement).textContent = c ? c[1] : '';
      b.dataset.v = c ? c[0] : '';
    };
  set('#ch-prev', CHAPTERS[i - 1]);
  set('#ch-next', CHAPTERS[i + 1]);
}
/** 前後の工程へ移る。下のボタンから移るので、帯が見える所まで戻す */
function stepCh(id: string): void {
  const v = $<HTMLButtonElement>(id).dataset.v;
  if (!v) return;
  ch$.choose(v);
  showCh();
  const bar = $('#bar'),
    rail = $('.rail').getBoundingClientRect().bottom,
    top = bar.getBoundingClientRect().top;
  if (top < rail) window.scrollBy(0, top - rail - 8);
}
$('#ch-prev').addEventListener('click', () => stepCh('#ch-prev'));
$('#ch-next').addEventListener('click', () => stepCh('#ch-next'));

function drawCh(): void {
  if (!M) return;
  const c = ch$.value,
    key = `${c}:${fi}`;
  if (c === 'lzw') {
    const v = cur(),
      n = (dir$.value === 'e' ? v.enc : v.tr).n;
    step = Math.min(step, n - 1);
    drawLzw(v, step, dir$.value);
    stTrack.set(step, n - 1);
    $('#fr-cur').textContent = `${fi} / ${(M as Model).n - 1}`;
  } else if (c === 'pal') {
    if (drawn !== key) drawPal();
  } else if (c === 'il') {
    drawIl();
  } else if (c === 'file') drawFile(M);
  drawn = key;
}

function paint(cv: HTMLCanvasElement, rgba: Uint8ClampedArray, w: number, h: number): void {
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  (cv.getContext('2d') as CanvasRenderingContext2D).putImageData(
    new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h),
    0,
    0,
  );
}

/* ---------- パレット ---------- */
function drawPalImg(): void {
  const v = cur(),
    o = toRgba(v.idx, v.pal, v.f.transparent),
    s = hover >= 0 ? hover : pinned;
  /* 選んだ色の画素だけを残す */
  if (s >= 0) for (let i = 0; i < v.idx.length; i++) if (v.idx[i] !== s && o[i * 4 + 3]) o[i * 4 + 3] = 40;
  paint($<HTMLCanvasElement>('#cv-pal'), o, v.f.w, v.f.h);
}
function palRead(i: number): void {
  const v = cur();
  if (i < 0) {
    $('#sw-rd').textContent = `${v.colors} 色`;
    return;
  }
  let n = 0;
  for (const p of v.idx) if (p === i) n++;
  const hex = [0, 1, 2]
    .map((k) => (v.pal[i * 3 + k] ?? 0).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  $('#sw-rd').textContent = `番号 ${i} · ${i === v.f.transparent ? '透過色' : `#${hex}`} · ${cnt(n)} 画素`;
}
function drawPal(): void {
  const v = cur(),
    sw = $('#sw');
  pinned = -1;
  hover = -1;
  let h = '';
  for (let i = 0; i < v.colors; i++)
    h +=
      i === v.f.transparent
        ? `<i data-i="${i}" class="t"></i>`
        : `<i data-i="${i}" style="background:rgb(${v.pal[i * 3]},${v.pal[i * 3 + 1]},${v.pal[i * 3 + 2]})"></i>`;
  sw.innerHTML = h;
  palRead(-1);
  drawPalImg();
}
const swatchOf = (e: Event): number => {
  const a = (e.target as HTMLElement).dataset?.i;
  return a === undefined ? -1 : Number(a);
};
$('#sw').addEventListener('pointermove', (e) => {
  if ((e as PointerEvent).pointerType === 'touch') return;
  const i = swatchOf(e);
  if (i < 0 || i === hover) return;
  hover = i;
  palRead(i);
  drawPalImg();
});
$('#sw').addEventListener('pointerleave', () => {
  hover = -1;
  palRead(pinned);
  drawPalImg();
});
/* 指では押した色を選んだままにする。もう一度押すと外す */
$('#sw').addEventListener('click', (e) => {
  const i = swatchOf(e);
  if (i < 0) return;
  pinned = pinned === i ? -1 : i;
  for (const el of $$<HTMLElement>('#sw i')) el.classList.toggle('on', Number(el.dataset.i) === pinned);
  palRead(pinned >= 0 ? pinned : hover);
  drawPalImg();
});

/* ---------- インターレース ---------- */
const PASS_C = ['#d6604d', '#e0a030', '#5aae61', '#4393c3'];
function drawIl(): void {
  const v = cur(),
    { w, h } = v.f,
    r = $<HTMLInputElement>('#il-r'),
    p = Number(r.value) / 100,
    pair = interlacePair(v),
    a = new Uint8ClampedArray(w * h * 4),
    b = new Uint8ClampedArray(w * h * 4),
    set = (o: Uint8ClampedArray, q: number, c: number): void => {
      if (c === v.f.transparent) return;
      o[q * 4] = v.pal[c * 3];
      o[q * 4 + 1] = v.pal[c * 3 + 1];
      o[q * 4 + 2] = v.pal[c * 3 + 2];
      o[q * 4 + 3] = 255;
    },
    pl = pair.plain.subarray(0, Math.ceil(pair.plain.length * p)),
    il = pair.il.subarray(0, Math.ceil(pair.il.length * p));
  const d0 = decodeLzw(pl, v.m, w * h);
  for (let q = 0; q < d0.n; q++) set(a, q, d0.out[q]);
  const d1 = progressive(il, v.m, w, h);
  for (let q = 0; q < w * h; q++) if (d1.px[q] >= 0) set(b, q, d1.px[q]);
  paint($<HTMLCanvasElement>('#cv-il0'), a, w, h);
  paint($<HTMLCanvasElement>('#cv-il1'), b, w, h);
  const band = $<HTMLCanvasElement>('#cv-ilb');
  if (band.height !== h) band.height = h;
  const x = band.getContext('2d') as CanvasRenderingContext2D;
  for (let y = 0; y < h; y++) {
    x.fillStyle = PASS_C[y % 8 === 0 ? 0 : y % 8 === 4 ? 1 : y % 4 === 2 ? 2 : 3];
    x.fillRect(0, y, 1, 1);
  }
  r.style.setProperty('--p', String(p));
  $('#il-p').textContent = `${Math.round(p * 100)} %`;
  $('#il-s0').textContent = `${Math.floor(d0.n / w)} / ${h} 行 · ${size(pair.plain.length)}`;
  $('#il-s1').textContent = `${d1.rows} / ${h} 行 · ${size(pair.il.length)}`;
}
$('#il-r').addEventListener('input', () => drawCh());

/* ---------- LZW の操作 ---------- */
let playT: ReturnType<typeof setInterval> | undefined;
function setPlay(on: boolean): void {
  clearInterval(playT);
  playT = undefined;
  const b = $('#nav-play');
  b.classList.toggle('on', on);
  b.setAttribute('aria-label', on ? '一時停止' : '再生');
  b.title = on ? '一時停止' : '再生';
  if (on) {
    const v = cur(),
      t = dir$.value === 'e' ? v.enc : v.tr;
    /* 終わりにいるなら頭から */
    if (step >= t.n - 1) step = 0;
    playT = setInterval(() => {
      const u = cur(),
        n = (dir$.value === 'e' ? u.enc : u.tr).n;
      if (step >= n - 1) {
        setPlay(false);
        return;
      }
      step++;
      drawCh();
    }, 420);
  }
}
$('#nav-first').addEventListener('click', () => {
  setPlay(false);
  step = 0;
  drawCh();
});
const go = (d: number): void => {
  setPlay(false);
  step = Math.max(0, step + d);
  drawCh();
};
$('#nav-prev').addEventListener('click', () => go(-1));
$('#nav-next').addEventListener('click', () => go(1));
$('#nav-play').addEventListener('click', () => setPlay(!playT));
const stTrack = new Track($('#st-trk'), (v) => {
  setPlay(false);
  step = v;
  drawCh();
});
const goFrame = (d: number): void => {
  if (!M) return;
  fi = Math.max(0, Math.min(M.n - 1, fi + d));
  step = START_STEP;
  dirty();
  drawCh();
};
$('#fr-prev').addEventListener('click', () => goFrame(-1));
$('#fr-next').addEventListener('click', () => goFrame(1));

/* 配色が変わったら、格子の印の色を描き直す */
new MutationObserver(() => {
  if (ch$.value === 'lzw') drawCh();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ---------- ファイル ---------- */
const FAIL: Record<Fail, string> = {
  'not-gif': 'GIF として読めませんでした',
  'too-big': `画面が大きすぎます（${cnt(MAX_PIXELS)} 画素まで）`,
  'no-frame': 'フレームがありません',
};
const isGif = (b: Uint8Array): boolean => b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
async function loadFile(f: File): Promise<void> {
  const ms = $('#m-file');
  ms.className = 'msg';
  ms.textContent = '読み込み中…';
  const name = f.name.replace(/\.[^.]*$/, '') || 'image';
  const open = (): void => {
    setPlay(false);
    smp$.set('' as never);
    $('#fileBtn').setAttribute('aria-pressed', 'true');
    step = 0;
    rebuild();
  };
  try {
    const head = new Uint8Array(await f.slice(0, 6).arrayBuffer());
    if (isGif(head)) {
      const r = fromBytes(new Uint8Array(await f.arrayBuffer()), name);
      if (typeof r === 'string') throw new Error(FAIL[r]);
      fileGif = r;
      img = null;
      const broken = r.file.brokenAt >= 0 ? ' · 途中で壊れています' : '';
      ms.textContent = `${f.name} · ${r.file.w}×${r.file.h} · ${r.file.frames.length} 枚${broken}`;
    } else {
      const r = await loadImage(f, { maxSide: MAX_SIDE });
      img = { w: r.w, h: r.h, rgba: r.rgba, name };
      ms.textContent = `${f.name} · ${r.W}×${r.H}${r.w < r.W ? ` を ${r.w}×${r.h} に縮小` : ''}`;
    }
    open();
  } catch (e) {
    ms.className = 'msg er';
    const m = e instanceof Error && Object.values(FAIL).includes(e.message) ? e.message : '画像として読めませんでした';
    ms.textContent = `${f.name}: ${m}`;
  }
}
bindFileInput($('#fileBtn'), $<HTMLInputElement>('#fileIn'), [$('#gf-root')], (f) => void loadFile(f));

$('#save').addEventListener('click', () => {
  if (!M || M.asIs) return;
  saveBytes(M.bytes, 'image/gif', `${M.name}-${cur().colors}${di$.value === '1' ? '-dither' : ''}.gif`);
});

/* ---------- 始める ---------- */
smpCache[smp$.value] ??= DRAW[smp$.value]();
img = smpCache[smp$.value];
step = START_STEP;
rebuild();
showCh();

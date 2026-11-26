/**
 * マンデルブロ集合のページの入口。図の上の操作（拡大・移動・2 本指・ジュリア集合の c）、浮かぶ枠、
 * 描画の段取り（動く間は粗い絵、止まったら帯に分けた細かい絵）、設定の保存をつなぐ
 */
import { $, $$ } from '../../lib/dom';
import { initFullscreen } from '../../lib/fullscreen';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { fromDec, fromFix, toFix } from './fixed';
import { FAMS, type FamId, type Formula, famOf, isInt, maxIter, q1024 } from './formula';
import { mountHow } from './how';
import { MORPH_MS, type Morph, morphAt, REAL_P_MAX, snapMix, snapPower } from './morph';
import { CORNERS, drawPad, padHit } from './pad';
import { PALS } from './palette';
import { PLACES } from './places';
import { pickRef, type Ref, RefSource } from './ref';
import { type ColorParams, type IterParams, Renderer } from './render';
import { fmtPower, fmtZoom, parseView, View, ZOOM_MAX } from './view';

initToolPage();

/** 描く画素の上限 */
const PIX_MAX = 2.4e6;
/** 細かい絵の帯 1 本の目安 [ms] */
const STRIP_MS = 25;
/** 最後の操作からこれだけ経つまでは粗い絵 [ms] */
const SETTLE_MS = 140;
/** 押したとみなす動きと時間 */
const TAP_PX = 4,
  TAP_MS = 400,
  DBL_MS = 250;
const CYC_RATE = 0.08;
/** 粗い絵 1 回の描画の重さの上限（画素数 × 反復の上限） */
const FRAME_WORK = 3e9;

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const dpr = (): number => Math.min(2, devicePixelRatio || 1);
const num = (v: unknown, a: number, b: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d;

/* ---------- 状態（保存したものを読む） ---------- */
const sf = stored('mb:f') as Partial<Formula> | undefined;
let f: Formula = {
  p: snapPower(num(sf?.p, 1.5, 8, 2), false),
  pre: q1024(num(sf?.pre, 0, 1, 0)),
  post: q1024(num(sf?.post, 0, 1, 0)),
  conj: sf?.conj === true,
};
const sc = stored('mb:c') as Partial<ColorParams> | undefined;
const col: ColorParams = {
  pal: PALS.some((p) => p.id === sc?.pal) ? (sc?.pal as string) : 'sun',
  den: num(sc?.den, 0.1, 3, 0.55),
  ofs: num(sc?.ofs, 0, 1, 0),
  shade: num(sc?.shade, 0, 1, 0.5),
};
const so = stored('mb:o') as Partial<Record<string, boolean>> | undefined;
const open: Record<'fm' | 'ju' | 'pl' | 'co', boolean> = {
  fm: so?.fm === true,
  ju: so?.ju === true,
  pl: so?.pl === true,
  co: so?.co === true,
};
const sv = parseView(stored('mb:v'));
const view = sv ? new View(sv.cx, sv.cy, sv.zoom) : new View(fromDec('-0.6'), 0n, 1);
view.setMax(isInt(f.p) ? ZOOM_MAX : REAL_P_MAX);
let cyc = false;
let morph: Morph | null = null;

/* ---------- 部品 ---------- */
const cv = $<HTMLCanvasElement>('#mb-cv');
const stage = $('#mb-stage');
const famSel = $<HTMLSelectElement>('#mb-fam');
const pIn = $<HTMLInputElement>('#mb-p');
const pad = $<HTMLCanvasElement>('#mb-pad');
const jcv = $<HTMLCanvasElement>('#mb-jcv');
const mark = $('#mb-mark');
const prog = $('#mb-prog');
const deep = (): boolean => view.zoom > REAL_P_MAX;

/* ---------- 描画 ---------- */
let R: Renderer | null = null;
const refs = new RefSource();
let shownRef: Ref | null = null;
let dirty = true,
  cdirty = false,
  lastMove = 0,
  lowS = 0.6,
  lastS = 1,
  lastT = 0,
  savedView = '';
let job: { y: number; P: IterParams } | null = null,
  stripH = 64;
refs.onReady = () => {
  dirty = true;
};

/** 今の範囲と式で描く値。基準の軌道がまだ届いていなければ null */
function params(): IterParams | null {
  if (!R) return null;
  const span = view.span(),
    max = maxIter(view.zoom),
    cen = [fromFix(view.cx), fromFix(view.cy)] as const;
  if (!isInt(f.p)) return { max, f, span, mode: 1, off: [0, 0], cen, jc: [0, 0] };
  const ref = refs.get(view.cx, view.cy, span, f, max);
  if (!ref) return null;
  if (ref !== shownRef) {
    R.setRef(ref.orbit);
    shownRef = ref;
  }
  return { max, f, span, mode: 0, off: [fromFix(view.cx - ref.x), fromFix(view.cy - ref.y)], cen, jc: [0, 0] };
}

function resize(): void {
  if (!R) return;
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  let W = Math.round(r.width * dpr()),
    H = Math.round(r.height * dpr());
  const k = Math.min(1, Math.sqrt(PIX_MAX / (W * H)));
  W = Math.round(W * k);
  H = Math.round(H * k);
  if (W === R.W && H === R.H) return;
  R.size(W, H);
  job = null;
  /* 大きさを変えるとキャンバスが消えるので、まず粗い絵を出す */
  moved();
}

function moved(): void {
  dirty = true;
  jdirty = true;
  lastMove = performance.now();
}

function jobStep(): void {
  if (!R || !job) return;
  const t0 = performance.now(),
    y1 = Math.min(R.H, job.y + stripH);
  R.strip(job.P, job.y, y1);
  R.finish();
  const el = performance.now() - t0;
  job.y = y1;
  stripH = clamp(Math.round(stripH * clamp(STRIP_MS / Math.max(1, el), 0.5, 2)), 8, R.H);
  if (job.y >= R.H) {
    R.swap();
    R.color(col);
    job = null;
    prog.style.width = '0';
    $('#mb-busy').hidden = true;
  } else prog.style.width = `${((job.y / R.H) * 100).toFixed(1)}%`;
}

function step(now: number): void {
  const dt = Math.min(0.1, (now - (lastT || now)) / 1000),
    fi = now - lastT;
  lastT = now;
  if (view.step(dt)) moved();
  if (morph) {
    const r = morphAt(morph, now);
    setF(r.f, r.done);
    if (r.done) morph = null;
  }
  if (cyc) {
    col.ofs = (col.ofs + dt * CYC_RATE) % 1;
    cdirty = true;
    jdirty = true;
  }
  const moving = now - lastMove < SETTLE_MS;
  if (moving && fi > 34) lowS = Math.max(0.25, lowS * 0.85);
  else if (moving && fi < 20) lowS = Math.min(1, lowS * 1.06);
  if (R) {
    if (dirty && moving) {
      const P = params();
      /* 基準を待つ間も、前の範囲の細かい絵は作り続けない */
      job = null;
      if (P) {
        /* 1 回の描画の重さ（画素数 × 反復の上限）を抑え、GPU の監視に止められないようにする */
        const s = Math.min(lowS, clamp(Math.sqrt(FRAME_WORK / (R.W * R.H * P.max)), 0.1, 1));
        R.frame(P, s);
        R.color(col);
        lastS = s;
        dirty = false;
        cdirty = false;
      }
    } else if (dirty || (!moving && lastS < 1 && !job)) {
      const P = params();
      job = P ? { y: 0, P } : null;
      if (P) {
        lastS = 1;
        dirty = false;
      }
    }
    if (job) jobStep();
    else prog.style.width = '0';
    if (cdirty) {
      R.color(col);
      cdirty = false;
    }
  }
  info();
  juliaStep();
  if (!moving && !view.moving) saveView();
  requestAnimationFrame(step);
}

function info(): void {
  $('#mb-zv').textContent = fmtZoom(view.zoom);
  $('#mb-cap').hidden = !(!isInt(f.p) && view.zoom >= REAL_P_MAX * 0.999);
  if (open.ju && jpin) {
    const r = cv.getBoundingClientRect(),
      s = view.span(),
      u = fromFix(toFix(jc[0]) - view.cx) / s,
      v = fromFix(toFix(jc[1]) - view.cy) / s;
    mark.hidden = false;
    mark.style.left = `${r.width / 2 + u * half(r)}px`;
    mark.style.top = `${r.height / 2 + v * half(r)}px`;
  } else mark.hidden = true;
}

function saveView(): void {
  const s = view.save(),
    k = `${s.cx},${s.cy},${s.z}`;
  if (k === savedView) return;
  savedView = k;
  store('mb:v', s);
}

/* ---------- 式 ---------- */
function formulaHtml(): string {
  const q = (s: string, a: number) => `<span class="q" style="--a:${(0.2 + 0.8 * a).toFixed(2)}">${s}</span>`;
  const bar = q('|', f.pre),
    pw = isInt(f.p) ? fmtPower(f.p).slice(1) : `<sup>${f.p.toFixed(2)}</sup>`;
  return `<i>z</i> ← ${q('|Re', f.post)} (${bar}<i>x</i>${bar} ${f.conj ? '−' : '+'} <i>i</i>${bar}<i>y</i>${bar})${pw} ${q('|', f.post)} + <i>c</i>`;
}

/** 式を変える。save なら保存する（変形の途中は保存しない） */
function setF(nf: Formula, save = true): void {
  f = nf;
  view.setMax(isInt(f.p) ? ZOOM_MAX : REAL_P_MAX);
  famSel.value = famOf(f) ?? '';
  pIn.value = String(f.p);
  $('#mb-pv').textContent = isInt(f.p) ? fmtPower(f.p) : f.p.toFixed(2);
  $('#mb-conj').setAttribute('aria-pressed', String(f.conj));
  $('#mb-deep .led').classList.toggle('on', isInt(f.p));
  $('#mb-fm').innerHTML = formulaHtml();
  if (open.fm) drawPad(pad, f, padThumbs);
  if (save) store('mb:f', f);
  moved();
}

function morphTo(to: Partial<Formula>, dur = MORPH_MS): void {
  const base = morph ? morphAt(morph, performance.now()).f : f;
  morph = { from: base, to: { ...f, ...(morph?.to ?? {}), ...to }, t0: performance.now(), dur, deep: deep() };
}

famSel.addEventListener('change', () => {
  const m = FAMS.find((q) => q.id === famSel.value);
  if (m) morphTo({ pre: m.pre, post: m.post, conj: m.conj });
});
pIn.addEventListener('input', () => {
  morph = null;
  setF({ ...f, p: snapPower(+pIn.value, deep()) });
});
$('#mb-conj').addEventListener('click', () => morphTo({ conj: !f.conj }, 300));

/* 式の板 */
const padThumbs: Partial<Record<FamId, HTMLCanvasElement>> = {};
let padDrag = false;
const padSet = (e: PointerEvent): void => {
  const [a, b] = padHit(pad, e.clientX, e.clientY);
  morph = null;
  setF({ ...f, pre: snapMix(a), post: snapMix(b) });
};
pad.addEventListener('pointerdown', (e) => {
  try {
    pad.setPointerCapture(e.pointerId);
  } catch {
    /* 合成のイベントなど、捕まえられない指 */
  }
  padDrag = true;
  padSet(e);
});
pad.addEventListener('pointermove', (e) => padDrag && padSet(e));
pad.addEventListener('pointerup', () => {
  padDrag = false;
});

/* ---------- 小さな絵（板の四隅・名所） ---------- */
let T: Renderer | null = null;
const thumbCv = document.createElement('canvas');
async function thumb(dst: HTMLCanvasElement, fam: FamId, x: string, y: string, z: number): Promise<void> {
  T ??= await Renderer.create(thumbCv);
  if (!T) return;
  const m = FAMS.find((q) => q.id === fam);
  if (!m) return;
  const tf: Formula = { p: 2, pre: m.pre, post: m.post, conj: m.conj },
    cx = fromDec(x),
    cy = fromDec(y),
    span = 1.5 / z,
    max = maxIter(z),
    ref = pickRef(cx, cy, span, tf, max);
  T.size(dst.width, dst.height);
  T.setRef(ref.orbit);
  T.frame({ max, f: tf, span, mode: 0, off: [fromFix(cx - ref.x), fromFix(cy - ref.y)], cen: [0, 0], jc: [0, 0] }, 1);
  T.color(col);
  dst.getContext('2d')?.drawImage(thumbCv, 0, 0, dst.width, dst.height);
}
let thumbTimer = 0;
/** 開いている枠の小さな絵を描き直す（配色を変えたときは少し待ってまとめて） */
function thumbs(later = false): void {
  clearTimeout(thumbTimer);
  if (later) {
    thumbTimer = window.setTimeout(() => thumbs(), 300);
    return;
  }
  void (async () => {
    if (open.fm) {
      for (const [k] of CORNERS) {
        const m = FAMS.find((q) => q.id === k);
        if (!m) continue;
        padThumbs[k] ??= Object.assign(document.createElement('canvas'), { width: 228, height: 144 });
        await thumb(padThumbs[k] as HTMLCanvasElement, k, m.home[0], m.home[1], m.home[2] * 0.9);
      }
      drawPad(pad, f, padThumbs);
    }
    if (open.pl)
      for (const b of $$<HTMLButtonElement>('.mb-place')) {
        const p = PLACES[+(b.dataset.pl ?? 0)];
        const c = b.querySelector('canvas');
        if (c) await thumb(c, p.fam, p.x, p.y, p.z);
        await new Promise((r) => setTimeout(r, 0));
      }
  })();
}

/* ---------- 浮かぶ枠 ---------- */
function setPanel(k: keyof typeof open, on: boolean): void {
  open[k] = on;
  $('#mb-p-fm').hidden = !open.fm;
  $('#mb-p-co').hidden = !open.co;
  $('#mb-p-ju').hidden = !open.ju;
  $('#mb-p-pl').hidden = !open.pl;
  stage.classList.toggle('mb-plo', open.pl);
  for (const b of $$<HTMLButtonElement>('[data-pan]'))
    b.setAttribute('aria-pressed', String(open[b.dataset.pan as keyof typeof open]));
  store('mb:o', open);
  jdirty = true;
}
for (const b of $$<HTMLButtonElement>('[data-pan]'))
  b.addEventListener('click', () => {
    const k = b.dataset.pan as keyof typeof open;
    setPanel(k, !open[k]);
    if (open[k] && (k === 'fm' || k === 'pl')) thumbs();
    if (k === 'fm' && open.fm) drawPad(pad, f, padThumbs);
  });

/* 配色 */
function syncColor(): void {
  for (const b of $$<HTMLButtonElement>('[data-pal]'))
    b.setAttribute('aria-pressed', String(b.dataset.pal === col.pal));
  for (const k of ['den', 'ofs', 'shade'] as const) {
    $<HTMLInputElement>(`#mb-${k}`).value = String(col[k]);
    $(`#mb-${k}-v`).textContent = col[k].toFixed(2);
  }
  $('#mb-cyc').setAttribute('aria-pressed', String(cyc));
}
for (const b of $$<HTMLButtonElement>('[data-pal]'))
  b.addEventListener('click', () => {
    col.pal = b.dataset.pal ?? 'sun';
    cdirty = jdirty = true;
    syncColor();
    store('mb:c', col);
    thumbs(true);
  });
for (const k of ['den', 'ofs', 'shade'] as const)
  $<HTMLInputElement>(`#mb-${k}`).addEventListener('input', (e) => {
    col[k] = +(e.target as HTMLInputElement).value;
    $(`#mb-${k}-v`).textContent = col[k].toFixed(2);
    cdirty = jdirty = true;
    store('mb:c', col);
    thumbs(true);
  });
$('#mb-cyc').addEventListener('click', () => {
  cyc = !cyc;
  syncColor();
  if (!cyc) store('mb:c', col);
});

/* 名所・拡大のボタン */
for (const b of $$<HTMLButtonElement>('.mb-place'))
  b.addEventListener('click', () => {
    const p = PLACES[+(b.dataset.pl ?? 0)],
      m = FAMS.find((q) => q.id === p.fam);
    if (!m) return;
    morph = null;
    setF({ p: 2, pre: m.pre, post: m.post, conj: m.conj });
    view.jump(fromDec(p.x), fromDec(p.y), p.z);
    moved();
  });
for (const b of $$<HTMLButtonElement>('[data-z]')) b.addEventListener('click', () => view.zoomBy(+(b.dataset.z ?? 1)));
$('#mb-home').addEventListener('click', () => {
  /* 変形の途中なら行き先の種類の全体へ */
  const m = FAMS.find((q) => q.id === (famOf(morph?.to ?? f) ?? 'm')) ?? FAMS[0];
  view.jump(fromDec(m.home[0]), fromDec(m.home[1]), m.home[2]);
  moved();
});

/* ---------- 図の上の操作 ---------- */
/** 画面の座標の 1 に当たる画素数（短い辺の半分。全画面の縦長の画面でも全体が収まるように） */
function half(r: DOMRect): number {
  return Math.min(r.width, r.height) / 2;
}
function uvOf(x: number, y: number): [number, number] {
  const r = cv.getBoundingClientRect();
  return [(x - r.left - r.width / 2) / half(r), (y - r.top - r.height / 2) / half(r)];
}
cv.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [u, v] = uvOf(e.clientX, e.clientY);
    view.zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)), u, v);
  },
  { passive: false },
);
let pinTimer = 0;
cv.addEventListener('dblclick', (e) => {
  clearTimeout(pinTimer);
  const [u, v] = uvOf(e.clientX, e.clientY);
  view.zoomBy(e.shiftKey ? 0.25 : 4, u, v);
});
const ptrs = new Map<number, [number, number]>();
let pinch: { mid: [number, number]; dist: number } | null = null,
  down: { x: number; y: number; t: number; far: boolean; touch: boolean } | null = null;
cv.addEventListener('pointerdown', (e) => {
  try {
    cv.setPointerCapture(e.pointerId);
  } catch {
    /* 合成のイベントなど、捕まえられない指 */
  }
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  cv.classList.add('drag');
  pinch = null;
  down =
    ptrs.size === 1
      ? { x: e.clientX, y: e.clientY, t: performance.now(), far: false, touch: e.pointerType === 'touch' }
      : null;
});
cv.addEventListener('pointermove', (e) => {
  const prev = ptrs.get(e.pointerId);
  if (!prev) {
    hover(e);
    return;
  }
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_PX) down.far = true;
  const r = cv.getBoundingClientRect();
  if (ptrs.size === 1) {
    if (down && !down.far) return;
    view.pan((e.clientX - prev[0]) / half(r), (e.clientY - prev[1]) / half(r));
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()],
      mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch && pinch.dist > 0) {
      const [u0, v0] = uvOf(...pinch.mid),
        [u1, v1] = uvOf(...mid);
      view.pinch(u0, v0, u1, v1, dist / pinch.dist);
    }
    pinch = { mid, dist };
  }
  moved();
});
const up = (e: PointerEvent): void => {
  if (down && !down.far && performance.now() - down.t < TAP_MS && open.ju) {
    const { x, y, touch } = down;
    clearTimeout(pinTimer);
    /* ダブルクリックの 1 回目なら固定を変えない */
    pinTimer = window.setTimeout(() => pinAt(x, y, touch), touch ? 0 : DBL_MS);
  }
  ptrs.delete(e.pointerId);
  pinch = null;
  down = null;
  if (!ptrs.size) cv.classList.remove('drag');
};
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);
cv.addEventListener('keydown', (e) => {
  const k = e.key,
    PAN = 0.2;
  if (k === '+' || k === '=') view.zoomBy(2);
  else if (k === '-') view.zoomBy(0.5);
  else if (k === 'ArrowLeft') view.pan(PAN, 0);
  else if (k === 'ArrowRight') view.pan(-PAN, 0);
  else if (k === 'ArrowUp') view.pan(0, PAN);
  else if (k === 'ArrowDown') view.pan(0, -PAN);
  else return;
  e.preventDefault();
  moved();
});

/* ---------- ジュリア集合 ---------- */
let J: Renderer | null = null,
  jWait = false,
  jdirty = true,
  jpin = false;
let jc: [number, number] = [-0.7453, 0.1127];
function hover(e: PointerEvent): void {
  if (!open.ju || jpin || e.pointerType === 'touch') return;
  const [x, y] = view.pointAt(...uvOf(e.clientX, e.clientY));
  jc = [fromFix(x), fromFix(y)];
  jdirty = true;
}
function pinAt(x: number, y: number, touch: boolean): void {
  if (jpin && !touch) jpin = false;
  else {
    const [px, py] = view.pointAt(...uvOf(x, y));
    jc = [fromFix(px), fromFix(py)];
    jpin = true;
  }
  jdirty = true;
}
function juliaStep(): void {
  if (!open.ju || !jdirty) return;
  if (!J) {
    if (!jWait) {
      jWait = true;
      void Renderer.create(jcv).then((r) => {
        J = r;
        jdirty = true;
      });
    }
    return;
  }
  const r = jcv.getBoundingClientRect();
  if (!r.width) return;
  const W = Math.round(r.width * dpr());
  J.size(W, W);
  J.frame({ max: 400, f, span: 1.6, mode: 2, off: [0, 0], cen: [0, 0], jc }, 1);
  J.color(col);
  jdirty = false;
  const sgn = jc[1] < 0 ? '−' : '+',
    re = jc[0] < 0 ? `−${(-jc[0]).toFixed(5)}` : jc[0].toFixed(5);
  $('#mb-jcap').textContent = `c = ${re} ${sgn} ${Math.abs(jc[1]).toFixed(5)}i${jpin ? '　固定' : ''}`;
}

/* ---------- 始める ---------- */
syncColor();
setF(f, false);
setPanel('fm', open.fm);
if (open.fm || open.pl) thumbs();
mountHow($('#mb-how'));
/* GPU が止めた・取り上げたときは、戻ったら作り直す */
cv.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  R = null;
  job = null;
});
cv.addEventListener('webglcontextrestored', () => {
  void Renderer.create(cv).then((r) => {
    R = r;
    shownRef = null;
    resize();
    moved();
  });
});
void Renderer.create(cv).then((r) => {
  if (!r) {
    $('#mb-busy').hidden = true;
    const m = $('#mb-msg');
    m.textContent = 'この図は WebGL2 で描きます。WebGL2 に対応したブラウザで開いてください';
    m.hidden = false;
    return;
  }
  R = r;
  new ResizeObserver(() => {
    resize();
    if (open.fm) drawPad(pad, f, padThumbs);
    jdirty = true;
  }).observe(cv);
  resize();
});
initFullscreen({ root: $('#mb-stage'), btn: $<HTMLButtonElement>('#mb-fs'), focus: cv });
requestAnimationFrame(step);

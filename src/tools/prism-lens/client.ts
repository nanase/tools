/**
 * プリズムとレンズのページの入口。部品を黒地に置き、光線を毎フレーム少しずつ足し込んで描く。
 * 部品を動かすと足し込みをやり直す。部品の並びはブラウザに保存する
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { weight } from './color';
import { CtxBar } from './ctxbar';
import {
  buildEdges,
  clone,
  type Edge,
  emit,
  hits,
  isSource,
  knob,
  make,
  type Part,
  type PartType,
  revive,
  trace,
} from './optics';
import { EV } from './params';
import { drawParts, KNOB_GAP, Light, type View } from './render';
import { SCENES, type SceneKey } from './scenes';

initToolPage();

const cv = $<HTMLCanvasElement>('#pl-cv'),
  ctx = cv.getContext('2d') as CanvasRenderingContext2D,
  stage = $('#pl-stage'),
  wrap = $('#pl-wrap');
const light = new Light();
const view: View = { S: 1, cssW: 0, cssH: 0, dpr: 1 };

let parts: Part[] = [],
  sel: Part | null = null,
  edges: Edge[] = [],
  dirty = true,
  redraw = true,
  rotating = false,
  ev = 0,
  partial = true,
  visible = true;

/* ---------- 保存 ---------- */
const KEYS: (keyof Part)[] = [
  't',
  'x',
  'y',
  'ang',
  'white',
  'lam',
  'w',
  'mat',
  'apex',
  'size',
  'R',
  'D',
  'h',
  'r',
  'L',
];
function save(): void {
  store(
    'parts',
    parts.map((o) =>
      Object.fromEntries(
        KEYS.map((k) => [k, typeof o[k] === 'number' ? Math.round((o[k] as number) * 100) / 100 : o[k]]),
      ),
    ),
  );
}
function load(): Part[] | null {
  const v = stored('parts');
  if (!Array.isArray(v)) return null;
  return v.map((q) => revive(q)).filter((o): o is Part => !!o);
}
/** 部品が変わった（描き直して保存する） */
function changed(keepScene = false): void {
  dirty = true;
  redraw = true;
  if (!keepScene) setScene(null);
  save();
}

/* ---------- 大きさ ---------- */
const NARROW = 700;
const isFull = () => wrap.classList.contains('full');
function resize(): void {
  const w = stage.clientWidth;
  if (!w) return;
  const narrow = w < NARROW,
    full = isFull();
  const h = full ? stage.clientHeight : Math.round(narrow ? w * 1.08 : w * 0.6);
  view.cssW = w;
  view.cssH = h;
  view.S = full ? Math.min(w / (narrow ? 720 : 1000), h / 620) : narrow ? w / 720 : w / 1000;
  /* 画素が多すぎると足し込みが遅くなるので、細かさを 200 万画素までに抑える */
  let dpr = Math.min(2, devicePixelRatio || 1);
  if (w * h * dpr * dpr > 2e6) dpr = Math.sqrt(2e6 / (w * h));
  view.dpr = dpr;
  cv.style.height = full ? '100%' : `${h}px`;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  light.resize(ctx, cv.width, cv.height);
  dirty = true;
  redraw = true;
}
/* 大きさを変えると図の高さも変わるので、測り直しは次のフレームで行う（同じ通知の中で変えると ResizeObserver が警告を出す） */
let fitQueued = false;
new ResizeObserver(() => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    if (stage.clientWidth !== view.cssW || (isFull() && stage.clientHeight !== view.cssH)) resize();
  });
}).observe(stage);

/* ---------- 光の足し込み ---------- */
const N = 1200;
function pass(budget: number): void {
  if (dirty) {
    light.clear();
    edges = buildEdges(parts);
    dirty = false;
  }
  const srcs = parts.filter((o) => isSource(o.t));
  if (!srcs.length || light.passes >= 600) return;
  const t0 = performance.now(),
    k = view.S * view.dpr,
    hw = 0.6 * view.dpr,
    X = (x: number) => (x * view.S + view.cssW / 2) * view.dpr,
    Y = (y: number) => (y * view.S + view.cssH / 2) * view.dpr;
  do {
    const rays = srcs.flatMap((o) => emit(o, N, k, Math.random, weight));
    trace(rays, edges, {
      partial,
      rand: Math.random,
      seg: (r, x1, y1) => light.line(X(r.x), Y(r.y), X(x1), Y(y1), r.w, r.I, hw),
      screen: (e, s, r) => light.screen(e, s, r.w, r.I),
    });
    light.passes++;
    light.rays += N * srcs.length;
    redraw = true;
  } while (performance.now() - t0 < budget && light.passes < 600);
}

const nEl = $('#pl-n');
let nShown = '';
function status(): void {
  const t = parts.some((o) => isSource(o.t)) ? `光線 ${(light.rays / 1e4).toFixed(1)} 万本` : '光源なし';
  if (t !== nShown) nEl.textContent = nShown = t;
}

let dragging: Drag | null = null;
function frame(): void {
  if (visible && view.cssW) {
    pass(dragging ? 6 : 10);
    if (redraw) {
      redraw = false;
      light.present(ctx, (1.1 * 2 ** ev) / Math.max(1, light.passes));
      drawParts(ctx, view, parts, sel, light, rotating, ev);
      status();
    }
  }
  requestAnimationFrame(frame);
}
new IntersectionObserver((es) => {
  visible = es.some((e) => e.isIntersecting);
}).observe(stage);

/* ---------- 選んだ部品の設定（トレイと入れ替わる帯） ---------- */
const norm = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const tray = $('#pl-tray');
const bar = new CtxBar($('#pl-ctx'), {
  change: () => changed(),
  back: () => {
    select(null);
    cv.focus({ preventScroll: true });
  },
  dup: () => {
    if (!sel) return;
    const c = clone(sel, 30, 30);
    parts.push(c);
    select(c);
    changed();
  },
  del: () => {
    if (sel) remove(sel);
  },
});
function select(o: Part | null): void {
  sel = o;
  tray.hidden = !!o;
  if (o) bar.show(o);
  else bar.hide();
  redraw = true;
}
/** 図の上で回した角度を帯へ（回している間は毎フレーム） */
function syncAng(): void {
  bar.sync();
}
function remove(o: Part): void {
  parts = parts.filter((q) => q !== o);
  select(null);
  changed();
}

/* ---------- 操作 ---------- */
interface Drag {
  kind: 'move' | 'rot' | 'twist' | 'tray';
  ox?: number;
  oy?: number;
  a0?: number;
  ang0?: number;
}
const ptrs = new Map<number, [number, number]>();
function wpos(e: { clientX: number; clientY: number }): [number, number] {
  const r = cv.getBoundingClientRect();
  return [(e.clientX - r.left - view.cssW / 2) / view.S, (e.clientY - r.top - view.cssH / 2) / view.S];
}
function hitAt(x: number, y: number): Part | null {
  for (let i = parts.length - 1; i >= 0; i--) if (hits(parts[i], x, y, 10 / view.S)) return parts[i];
  return null;
}
function nearKnob(x: number, y: number): boolean {
  if (!sel) return false;
  const [kx, ky] = knob(sel, KNOB_GAP);
  return Math.hypot(x - kx, y - ky) < 16 / view.S;
}
cv.addEventListener('pointerdown', (e) => {
  const [x, y] = wpos(e);
  ptrs.set(e.pointerId, [x, y]);
  cv.setPointerCapture(e.pointerId);
  if (ptrs.size === 2 && sel) {
    const [a, b] = [...ptrs.values()];
    dragging = { kind: 'twist', a0: Math.atan2(b[1] - a[1], b[0] - a[0]), ang0: sel.ang };
    rotating = true;
    return;
  }
  if (nearKnob(x, y)) {
    dragging = { kind: 'rot' };
    rotating = true;
    redraw = true;
    return;
  }
  const o = hitAt(x, y);
  if (o) {
    if (o !== sel) select(o);
    dragging = { kind: 'move', ox: o.x - x, oy: o.y - y };
    cv.style.cursor = 'grabbing';
    return;
  }
  select(null);
});
cv.addEventListener('pointermove', (e) => {
  const [x, y] = wpos(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [x, y]);
  if (!dragging || !sel) {
    cv.style.cursor = nearKnob(x, y) || hitAt(x, y) ? 'grab' : '';
    return;
  }
  if (dragging.kind === 'move') {
    sel.x = x + (dragging.ox ?? 0);
    sel.y = y + (dragging.oy ?? 0);
  } else if (dragging.kind === 'rot') {
    const a = (Math.atan2(y - sel.y, x - sel.x) * 180) / Math.PI + 90;
    sel.ang = norm(e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a));
    syncAng();
  } else if (dragging.kind === 'twist' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    sel.ang = norm(
      Math.round((dragging.ang0 ?? 0) + ((Math.atan2(b[1] - a[1], b[0] - a[0]) - (dragging.a0 ?? 0)) * 180) / Math.PI),
    );
    syncAng();
  }
  changed();
});
function endDrag(e: PointerEvent): void {
  ptrs.delete(e.pointerId);
  if (ptrs.size) return;
  dragging = null;
  rotating = false;
  cv.style.cursor = '';
  redraw = true;
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener(
  'wheel',
  (e) => {
    const [x, y] = wpos(e),
      o = hitAt(x, y) ?? (nearKnob(x, y) ? sel : null);
    if (!o) return;
    e.preventDefault();
    if (o !== sel) select(o);
    o.ang = norm(o.ang + Math.sign(e.deltaY) * (e.shiftKey ? 1 : 5));
    syncAng();
    changed();
  },
  { passive: false },
);
cv.addEventListener('keydown', (e) => {
  if (!sel) return;
  const d = e.shiftKey ? 50 : 10,
    mv: Record<string, [number, number]> = {
      ArrowLeft: [-d, 0],
      ArrowRight: [d, 0],
      ArrowUp: [0, -d],
      ArrowDown: [0, d],
    };
  if (e.key === 'Delete' || e.key === 'Backspace') remove(sel);
  else if (e.key in mv) {
    sel.x += mv[e.key][0];
    sel.y += mv[e.key][1];
    changed();
  } else if (e.key === 'Escape') select(null);
  else return;
  e.preventDefault();
});

/* 道具: 押すと図の中ほどに、図へ引き出すとその位置に置く */
let spread = 0;
function add(t: PartType, x: number, y: number): Part {
  const o = make(t, x, y, t === 'mirror' || t === 'half' ? 45 : 0);
  parts.push(o);
  select(o);
  changed();
  return o;
}
$('#pl-tray').addEventListener('pointerdown', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.pl-tool');
  if (!b) return;
  e.preventDefault();
  const t = b.dataset.t as PartType,
    tray = $('#pl-tray').getBoundingClientRect();
  let o: Part | null = null;
  const mv = (ev: PointerEvent) => {
    const r = cv.getBoundingClientRect(),
      inCv = ev.clientY < tray.top - 4 && ev.clientY > r.top && ev.clientX > r.left && ev.clientX < r.right;
    if (!o && inCv) {
      o = add(t, 0, 0);
      dragging = { kind: 'tray' };
    }
    if (o) {
      [o.x, o.y] = wpos(ev);
      changed();
    }
  };
  const up = () => {
    removeEventListener('pointermove', mv);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    dragging = null;
    if (!o) {
      spread = (spread + 1) % 6;
      add(t, -60 + spread * 24, -60 + spread * 16);
    }
    cv.focus({ preventScroll: true });
  };
  addEventListener('pointermove', mv);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
});
/* キーボードでは Enter・Space で追加 */
$('#pl-tray').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.pl-tool');
  if (!b || (e as PointerEvent).detail) return;
  spread = (spread + 1) % 6;
  add(b.dataset.t as PartType, -60 + spread * 24, -60 + spread * 16);
});

/* ---------- 場面 ---------- */
const capEl = $('#pl-cap');
const evGroup = new ParamGroup<'ev'>([EV], (v) => {
  ev = v.ev;
  redraw = true;
});
function setScene(k: SceneKey | null): void {
  for (const b of $$<HTMLElement>('#pl-scenes [data-s]')) b.setAttribute('aria-pressed', String(b.dataset.s === k));
  const t = k ? SCENES[k].cap : '';
  if (capEl.textContent !== t) capEl.textContent = t;
}
function loadScene(k: SceneKey): void {
  parts = SCENES[k].make();
  select(null);
  changed(true);
  setScene(k);
  evGroup.set('ev', SCENES[k].ev);
}
$('#pl-scenes').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-s]');
  if (b) loadScene(b.dataset.s as SceneKey);
});
$('#pl-clear').addEventListener('click', () => {
  parts = [];
  select(null);
  changed();
});
new Choice<'1' | '0'>($('#p-partial'), (v) => {
  partial = v === '1';
  dirty = true;
});
partial = $('#p-partial [aria-pressed="true"]').getAttribute('data-v') !== '0';

/* ---------- 全画面 ---------- */
const fsBtn = $<HTMLButtonElement>('#pl-fs');
function setFull(on: boolean): void {
  if (on === isFull()) return;
  wrap.classList.toggle('full', on);
  document.documentElement.style.overflow = on ? 'hidden' : '';
  const t = on ? '全画面を閉じる' : '全画面で表示';
  fsBtn.setAttribute('aria-label', t);
  fsBtn.title = t;
  if (on) wrap.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  resize();
}
fsBtn.addEventListener('click', () => setFull(!isFull()));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) setFull(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isFull() && !document.fullscreenElement && !sel) setFull(false);
});

/* ---------- 開始 ---------- */
parts = load() ?? SCENES.rainbow.make();
if (!stored('parts')) setScene('rainbow');
resize();
requestAnimationFrame(frame);

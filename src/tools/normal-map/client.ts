/**
 * 法線マップのページの入口: 入力 → 模様の用意（Worker）→ 板を描く（WebGL2）。
 * 光は図に触れている間は指やカーソルに付いてくる。離すとその位置から回り続ける（「光を回す」は切らない）
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { HR, normalize, normalMap, type PatId } from './heights';
import { mountHow } from './how';
import { type Key, PARAMS } from './params';
import { type Camera, fitCamera, LIGHT_Y, PlateRenderer, pickLight, type Vec3 } from './render';
import { MODE } from './shader';

initToolPage();

/** 光が回る速さ [rad/s]、初めの半径と角度（左奥） */
const SPEED = 0.6,
  RAD0 = 1.05,
  ANG0 = -2.3;
/** 画素数の倍率の上限（光線をたどる計算が重いため） */
const MAX_SCALE = 1.5;
/** 背景（画面の値） */
const BG: Vec3 = [0.03, 0.034, 0.038];

/* ---------- 図 ---------- */
const one = $('#nm-one'),
  two = $('#nm-two'),
  c0 = $<HTMLCanvasElement>('#nm-c0'),
  c1 = $<HTMLCanvasElement>('#nm-c1'),
  c2 = $<HTMLCanvasElement>('#nm-c2'),
  busy = $('#nm-busy'),
  msg = $('#nm-msg'),
  rotBtn = $<HTMLButtonElement>('#nm-rot'),
  rotLed = $('#nm-rotL');

interface View {
  cv: HTMLCanvasElement;
  r: PlateRenderer | null;
  ready: boolean;
}
const views: View[] = [];
let noGl = false;
function makeView(cv: HTMLCanvasElement): View {
  const v: View = { cv, r: null, ready: false };
  try {
    v.r = new PlateRenderer(cv);
    v.r.ready.then(
      () => {
        v.ready = true;
        kick();
      },
      () => fail(),
    );
  } catch {
    fail();
  }
  views.push(v);
  return v;
}
function fail(): void {
  noGl = true;
  busy.hidden = true;
  msg.hidden = false;
}
const v0 = makeView(c0);
/* 比較の 2 枚は初めて比較にしたときに作る */
let v1: View | null = null,
  v2: View | null = null;

/* ---------- 状態 ---------- */
let V = {} as Record<Key, number>;
let ready = false;
const st = {
  cmp: false,
  pat: 'brick' as PatId,
  nm: true,
  rot: !RM.matches,
  /** 回る角度と半径 */
  ang: ANG0,
  rad: RAD0,
  /** 指やカーソルが図に触れている */
  hold: false,
  light: [RAD0 * Math.cos(ANG0), LIGHT_Y, RAD0 * Math.sin(ANG0)] as Vec3,
};

/* ---------- 模様（高さと法線マップ） ---------- */
interface PatData {
  h: Float32Array;
  nm: Uint8Array;
}
const cache = new Map<string, PatData>();
let worker: Worker | null = null;
let want = '';
function textPattern(): PatData {
  const c = document.createElement('canvas');
  c.width = c.height = HR;
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.fillStyle = '#000';
  g.fillRect(0, 0, HR, HR);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${HR * 0.37}px "Yu Gothic UI","Hiragino Sans","Noto Sans JP",sans-serif`;
  g.fillText('法線', HR / 2, HR * 0.4);
  g.font = `bold ${HR * 0.11}px system-ui,"Segoe UI",sans-serif`;
  g.fillText('NORMAL MAP', HR / 2, HR * 0.76);
  g.lineWidth = HR * 0.027;
  g.strokeStyle = '#fff';
  g.strokeRect(HR * 0.043, HR * 0.043, HR * 0.914, HR * 0.914);
  /* ぼかして縁を斜面にする */
  const b = document.createElement('canvas');
  b.width = b.height = HR;
  const gb = b.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  gb.filter = `blur(${HR / 128}px)`;
  gb.drawImage(c, 0, 0);
  const d = gb.getImageData(0, 0, HR, HR).data,
    h = new Float32Array(HR * HR);
  for (let i = 0; i < HR * HR; i++) h[i] = d[i * 4] / 255;
  normalize(h);
  return { h, nm: normalMap(h) };
}
/** 模様を用意して送る。届くまでは前の模様のまま描く */
function loadPattern(id: PatId): void {
  want = id;
  const have = cache.get(id);
  if (have) {
    use(id, have);
    return;
  }
  if (id === 'text') {
    const p = textPattern();
    cache.set(id, p);
    use(id, p);
    return;
  }
  busy.hidden = false;
  if (!worker) {
    worker = new Worker(new URL('./pattern-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: PatId; h: Float32Array; nm: Uint8Array }>) => {
      const { id: got, h, nm } = e.data;
      cache.set(got, { h, nm });
      if (got === want) use(got, { h, nm });
    };
  }
  worker.postMessage({ id });
}
function use(id: string, p: PatData): void {
  for (const v of views) if (v.r && v.r.pat !== id) v.r.setPattern(id, p.h, p.nm);
  busy.hidden = true;
  dirty = true;
  kick();
}

/* ---------- 描画 ---------- */
let dirty = true;
let raf = 0;
let last = 0;
let visible = true;
const shown = (): View[] => (st.cmp ? [v1, v2].filter((v): v is View => !!v) : [v0]);
const cams = new WeakMap<HTMLCanvasElement, { key: string; cam: Camera }>();
function camOf(cv: HTMLCanvasElement): Camera {
  const asp = cv.clientWidth / Math.max(1, cv.clientHeight),
    key = `${V.el}:${asp.toFixed(3)}`,
    c = cams.get(cv);
  if (c && c.key === key) return c.cam;
  const cam = fitCamera(V.el, asp);
  cams.set(cv, { key, cam });
  return cam;
}
const moving = (): boolean => st.rot && !st.hold && !RM.matches;
function kick(): void {
  if (!raf && visible) raf = requestAnimationFrame(frame);
}
function frame(ms: number): void {
  raf = 0;
  const dt = last ? Math.min(0.1, (ms - last) / 1000) : 0;
  last = ms;
  if (moving()) {
    st.ang += dt * SPEED;
    st.light = [Math.cos(st.ang) * st.rad, LIGHT_Y, Math.sin(st.ang) * st.rad];
    dirty = true;
  }
  if (dirty && ready) {
    const vs = shown();
    if (vs.every((v) => v.ready && v.r?.pat)) {
      dirty = false;
      const scale = Math.min(MAX_SCALE, devicePixelRatio || 1);
      for (const v of vs) {
        const r = v.r as PlateRenderer;
        r.resize(scale);
        const mode = st.cmp ? (v === v1 ? MODE.REAL : MODE.NMAP) : st.nm ? MODE.NMAP : MODE.FLAT;
        r.draw({ cam: camOf(v.cv), light: st.light, mode, hs: V.hs, bg: BG });
      }
    }
  }
  if (moving() && visible) raf = requestAnimationFrame(frame);
  else last = 0;
}

/* ---------- 光を指やカーソルに付ける ---------- */
function follow(cv: HTMLCanvasElement, e: PointerEvent): void {
  const b = cv.getBoundingClientRect(),
    x = ((e.clientX - b.left) / b.width) * 2 - 1,
    y = 1 - ((e.clientY - b.top) / b.height) * 2,
    p = pickLight(camOf(cv), x, y, b.width / b.height);
  if (p) st.light = p;
  st.hold = true;
  dirty = true;
  kick();
}
/** 離れたら、その位置から回し続ける */
function release(): void {
  if (!st.hold) return;
  st.hold = false;
  resume();
}
function resume(): void {
  st.rad = Math.max(0.3, Math.hypot(st.light[0], st.light[2]));
  st.ang = Math.atan2(st.light[2], st.light[0]);
  last = 0;
  dirty = true;
  kick();
}
for (const cv of [c0, c1, c2]) {
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.buttons) follow(cv, e);
  });
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    follow(cv, e);
  });
  cv.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') release();
  });
  cv.addEventListener('pointerleave', release);
  cv.addEventListener('pointercancel', release);
  /* 矢印キーで光を動かす */
  cv.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.3 : 0.1,
      mv: Record<string, [number, number]> = {
        ArrowLeft: [-d, 0],
        ArrowRight: [d, 0],
        ArrowUp: [0, -d],
        ArrowDown: [0, d],
      },
      m = mv[e.key];
    if (!m) return;
    e.preventDefault();
    const cl = (v: number) => Math.max(-1.6, Math.min(1.6, v));
    st.light = [cl(st.light[0] + m[0]), LIGHT_Y, cl(st.light[2] + m[1])];
    resume();
  });
}

/* ---------- 入力 ---------- */
function setRot(on: boolean): void {
  st.rot = on;
  rotBtn.setAttribute('aria-pressed', String(on));
  rotLed.classList.toggle('on', on);
  if (on) resume();
}
rotBtn.addEventListener('click', () => setRot(!st.rot));
setRot(st.rot);

const nm$ = new Choice<string>($('#p-nm'), (v) => {
  st.nm = v === '1';
  dirty = true;
  kick();
});
const mode$ = new Choice<string>($('#nm-mode'), (v) => setMode(v === 'cmp'));
function setMode(cmp: boolean): void {
  st.cmp = cmp;
  one.hidden = cmp;
  two.hidden = !cmp;
  if (cmp && !v1) {
    v1 = makeView(c1);
    v2 = makeView(c2);
    const p = cache.get(want);
    if (p) for (const v of [v1, v2]) v.r?.setPattern(want, p.h, p.nm);
  }
  nm$.setOff(cmp, '比較では使いません');
  dirty = true;
  kick();
}
const pat$ = new Choice<PatId>($('#p-pat'), (v) => {
  st.pat = v;
  loadPattern(v);
});
const G = new ParamGroup<Key>(PARAMS, (v) => {
  V = v;
  dirty = true;
  kick();
});
V = G.values();
st.nm = nm$.value === '1';
st.pat = pat$.value;
ready = true;
setMode(mode$.value === 'cmp');
loadPattern(st.pat);

/* 見えない間は止める */
new IntersectionObserver((e) => {
  visible = e[e.length - 1].isIntersecting;
  if (visible) {
    dirty = true;
    kick();
  }
}).observe($('#nm-fig'));
new ResizeObserver(() => {
  dirty = true;
  kick();
}).observe($('#nm-fig'));
document.addEventListener('visibilitychange', () => {
  last = 0;
  if (!document.hidden) kick();
});
RM.addEventListener('change', () => {
  dirty = true;
  kick();
});

if (noGl) fail();
mountHow($('#nm-how'));

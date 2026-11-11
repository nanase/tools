/**
 * シェーディングのページの入口: 入力 → 球を WebGL2 で描く → ローブ・反射率・項の内訳・補間・ファーネステスト。
 * 動かない絵なので、入力が変わったときだけ描き直す
 */
import type { Vec3 } from '../../lib/brdf';
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { reserveHeight } from '../../lib/reserve';
import { addRow, mark } from '../../lib/reset';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { kelvinRgb } from '../raytracing/scene';
import { polarSvg } from './lobe';
import { DEFAULT_HEX, hexToLinear, PRESETS } from './material';
import {
  type Camera,
  FLOOR_CAM,
  floorAt,
  floorIncidence,
  floorMesh,
  floorMirror,
  floorScreen,
  lightForFloor,
  SPHERE_CAM,
  sphereMesh,
} from './mesh';
import {
  buildLuts,
  diffuseAlbedo,
  furnaceAvg,
  type LutSet,
  MODEL_NO,
  MODELS,
  type ModelId,
  makeShade,
  reflectance,
  type Shade,
} from './models';
import { type Key, PARAMS } from './params';
import { type Draw, type Mesh, ShadeRenderer, type Tile } from './render';
import { INTERP, MODE } from './shader';

initToolPage();

const MAX_TILE = 512;
const SPHERE_DIV = 64;
/** 床へ切り替えたときの光（ハイライトが画面に入る向き） */
const FLOOR_LIGHT = { inc: 150, az: 90 };
const SPHERE_LIGHT = { inc: 50, az: 50 };

/** 項の並び。文字列は記号、組は [描き方, 名前] */
type Term = string | readonly [number, string];
const SUM: readonly Term[] = [
  [MODE.SPEC, '鏡面'],
  '+',
  [MODE.DIFF, '拡散'],
  '+',
  [MODE.AMB, '環境光'],
  '=',
  [MODE.FULL, '全体'],
];
const TERMS: Record<ModelId, readonly Term[]> = {
  lambert: [[MODE.NL, 'N·L'], '→', [MODE.DIFF, '拡散'], '+', [MODE.AMB, '環境光'], '=', [MODE.FULL, '全体']],
  phong: [[MODE.RV, '(R·V)ⁿ'], '→', ...SUM],
  blinn: [[MODE.NH, '(N·H)ⁿ'], '→', ...SUM],
  ggx: [[MODE.D, 'D'], '×', [MODE.F, 'F'], '×', [MODE.G, 'G'], '→', ...SUM],
};

/* ---------- 入力 ---------- */
let ready = false;
let V = {} as Record<Key, number>;
let meshDirty = true;
const shape$ = new Choice<string>($('#p-shape'), (v) => {
  if (ready) {
    const to = v === 'floor' ? FLOOR_LIGHT : SPHERE_LIGHT,
      from = v === 'floor' ? SPHERE_LIGHT : FLOOR_LIGHT;
    /* 動かしていなければ、形に合う光の向きへ移す */
    if (V.inc === from.inc && V.az === from.az) {
      G.set('inc', to.inc);
      G.set('az', to.az);
    }
  }
  meshDirty = true;
  dirty();
});
const kind$ = new Choice<string>($('#p-kind'), () => change());
const expo$ = new Choice<string>($('#p-expo'), () => lutChange());
const norm$ = new Choice<string>($('#p-norm'), () => lutChange());
const scale$ = new Choice<string>($('#p-scale'), () => dirty());
const termM$ = new Choice<ModelId>($('#p-tm'), () => {
  buildTerms();
  relayout();
});
const intM$ = new Choice<ModelId>($('#p-im'), () => dirty());
const furM$ = new Choice<ModelId>($('#p-fm'), () => dirty());
const ms$ = new Choice<string>($('#p-ms'), () => dirty());
const G = new ParamGroup<Key>(PARAMS, (v, k) => {
  V = v;
  if (k === 'div') meshDirty = true;
  change();
});
V = G.values();

/* 色 */
const colorIn = $<HTMLInputElement>('#in-color');
const savedHex = stored('hex');
if (typeof savedHex === 'string' && /^#[0-9a-f]{6}$/.test(savedHex)) colorIn.value = savedHex;
function setHex(h: string): void {
  colorIn.value = h;
  if (h === DEFAULT_HEX) forget('hex');
  else store('hex', h);
  mark();
  change();
}
colorIn.addEventListener('input', () => setHex(colorIn.value));
addRow($('#p-color'), { isMod: () => colorIn.value !== DEFAULT_HEX, reset: () => setHex(DEFAULT_HEX) });

/* 材質のプリセット */
const presetBtns = $$<HTMLButtonElement>('#p-mat button');
presetBtns.forEach((b) => {
  b.addEventListener('click', () => {
    const m = PRESETS.find((x) => x.id === b.dataset.v);
    if (!m) return;
    G.set('metal', m.metal);
    G.set('f0', m.f0);
    G.set('rough', m.rough);
    setHex(m.hex);
  });
});

/* ローブに出す式 */
const SHOW_KEY = 'lobes';
const savedShow = stored(SHOW_KEY);
const show = new Set<string>(
  Array.isArray(savedShow) && savedShow.length ? savedShow.map(String) : MODELS.map((m) => m.id),
);
const showBtns = $$<HTMLButtonElement>('#p-show button');
showBtns.forEach((b) => {
  b.addEventListener('click', () => {
    const id = b.dataset.v ?? '';
    if (show.has(id)) {
      if (show.size > 1) show.delete(id);
    } else show.add(id);
    if (show.size === MODELS.length) forget(SHOW_KEY);
    else store(SHOW_KEY, [...show]);
    syncShow();
    dirty();
  });
});
function syncShow(): void {
  showBtns.forEach((b) => {
    b.setAttribute('aria-pressed', String(show.has(b.dataset.v ?? '')));
  });
}

/* ---------- 描画の用意 ---------- */
const glCanvas = document.createElement('canvas');
const msg = $('#st-msg');
let R: ShadeRenderer | null = null;
try {
  R = new ShadeRenderer(glCanvas);
} catch {
  msg.textContent = 'このブラウザでは WebGL2 が使えないため、球を描けません。';
  msg.hidden = false;
}
let luts: LutSet = buildLuts(true, true);
R?.setLuts(luts);
function lutChange(): void {
  luts = buildLuts(expo$.value === 'q', norm$.value === '1', luts);
  R?.setLuts(luts);
  dirty();
}

let hiSphere: Mesh | null = null;
let hiFloor: Mesh | null = null;
let intMesh: Mesh | null = null;
if (R) {
  hiSphere = R.mesh(sphereMesh(SPHERE_DIV));
  hiFloor = R.mesh(floorMesh(1));
}
function syncMeshes(): void {
  if (!R || !meshDirty) return;
  meshDirty = false;
  intMesh = R.mesh(shape$.value === 'floor' ? floorMesh(V.div) : sphereMesh(V.div), intMesh ?? undefined);
}

/** 描く先 */
interface Target {
  cv: HTMLCanvasElement;
  c: CanvasRenderingContext2D | null;
  tile: Tile | null;
  draw(t: Tile, s: Shade): void;
  after?(c: CanvasRenderingContext2D, size: number): void;
}
const fixedTargets: Target[] = [];
let termTargets: Target[] = [];

const lightDir = (): Vec3 => {
  const t = (V.inc * Math.PI) / 180,
    p = (V.az * Math.PI) / 180;
  return [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)];
};

function base(id: ModelId, s: Shade): Omit<Draw, 'mesh' | 'cam' | 'mode' | 'interp' | 'tone' | 'clear'> {
  const L = lightDir(),
    point = kind$.value === 'point',
    K = kelvinRgb(V.kv);
  return {
    model: MODEL_NO[id],
    kind: point ? 1 : 0,
    light: point ? [L[0] * V.dist, L[1] * V.dist, L[2] * V.dist] : L,
    li: [K[0] * V.pw, K[1] * V.pw, K[2] * V.pw],
    amb: V.amb,
    diff: diffuseAlbedo(id, s),
    f0: s.F0,
    ks: s.ks,
    a: s.a,
    rough: s.rough,
    nP: s.nP,
    nB: s.nB,
    norm: s.norm,
    ms: s.ms,
  };
}

const floorOn = (): boolean => shape$.value === 'floor';
const hiMesh = (): Mesh | null => (floorOn() ? hiFloor : hiSphere);
const camOf = (): Camera => (floorOn() ? FLOOR_CAM : SPHERE_CAM);

/** 印の位置（画面の -1〜1）。球は法線が光を向く点、床はハイライトの中心 */
function markAt(): [number, number] | null {
  const L = lightDir();
  if (floorOn()) {
    const P = floorMirror(L, kind$.value === 'point', V.dist);
    if (!P) return null;
    const m = floorScreen(P);
    return m[1] <= 1 && m[1] >= -1 ? m : null;
  }
  if (L[2] <= 0) return null;
  const { eye, t } = SPHERE_CAM,
    k = 1 / (eye[2] - L[2]) / t;
  return [L[0] * k, L[1] * k];
}

function lightMark(c: CanvasRenderingContext2D, size: number): void {
  const m = markAt();
  if (!m) return;
  const x = ((m[0] + 1) * size) / 2,
    y = ((1 - m[1]) * size) / 2,
    r = Math.max(3.5, size * 0.021);
  c.beginPath();
  c.arc(x, y, r, 0, 7);
  c.lineWidth = Math.max(2, size * 0.011);
  c.strokeStyle = '#000';
  c.stroke();
  c.lineWidth = Math.max(1, size * 0.0055);
  c.strokeStyle = '#fff';
  c.stroke();
}

function addTarget(cv: HTMLCanvasElement, t: Omit<Target, 'cv' | 'c' | 'tile'>): Target {
  return { cv, c: cv.getContext('2d'), tile: null, ...t };
}

/* 4 つの球 */
$$<HTMLCanvasElement>('[data-sph]').forEach((cv) => {
  const id = cv.dataset.sph as ModelId;
  fixedTargets.push(
    addTarget(cv, {
      draw(t, s) {
        const mesh = hiMesh();
        if (!mesh) return;
        R?.draw(t, {
          ...base(id, s),
          mesh,
          cam: camOf(),
          mode: MODE.FULL,
          interp: INTERP.PIXEL,
          tone: true,
          clear: 0,
        });
      },
      after: lightMark,
    }),
  );
});

/* 補間 */
$$<HTMLCanvasElement>('[data-int]').forEach((cv) => {
  const mode = Number(cv.dataset.int);
  fixedTargets.push(
    addTarget(cv, {
      draw(t, s) {
        if (!intMesh) return;
        R?.draw(t, {
          ...base(intM$.value, s),
          mesh: intMesh,
          cam: camOf(),
          mode: MODE.FULL,
          interp: mode,
          tone: true,
          clear: 0,
        });
      },
    }),
  );
});

/* ファーネステスト */
$$<HTMLCanvasElement>('[data-fur]').forEach((cv) => {
  const rough = Number(cv.dataset.fur);
  fixedTargets.push(
    addTarget(cv, {
      draw(t) {
        if (!hiSphere) return;
        const id = furM$.value,
          white: Vec3 = [1, 1, 1],
          s = makeShade(
            {
              base: white,
              metal: 1,
              f0: 1,
              rough,
              norm: norm$.value === '1',
              quarter: expo$.value === 'q',
              ms: ms$.value === '1',
            },
            luts,
          );
        R?.draw(t, {
          model: MODEL_NO[id],
          kind: 0,
          light: [0, 0, 1],
          li: [0, 0, 0],
          amb: 1,
          diff: diffuseAlbedo(id, s),
          f0: white,
          ks: white,
          a: s.a,
          rough: s.rough,
          nP: s.nP,
          nB: s.nB,
          norm: s.norm,
          ms: s.ms,
          mesh: hiSphere,
          cam: SPHERE_CAM,
          mode: MODE.FULL,
          interp: INTERP.PIXEL,
          tone: false,
          clear: 1,
        });
      },
    }),
  );
});

/* 項 */
const termsEl = $('#terms');
/* 反射モデルで項の数が違い、折り返しの段数が変わる。いちばん段の多いモデルの高さを取っておく */
reserveHeight(
  termsEl,
  Object.values(TERMS).map((list) =>
    list
      .map((x) =>
        typeof x === 'string'
          ? `<span class="sh-op">${x}</span>`
          : `<figure class="sh-tm"><div class="sh-st"><div style="aspect-ratio:1"></div></div><figcaption>${x[1]}</figcaption></figure>`,
      )
      .join(''),
  ),
  { html: true },
);
function buildTerms(): void {
  const list = TERMS[termM$.value];
  termsEl.replaceChildren(
    ...list.map((x) => {
      if (typeof x === 'string') {
        const s = document.createElement('span');
        s.className = 'sh-op';
        s.textContent = x;
        s.setAttribute('aria-hidden', 'true');
        return s;
      }
      const f = document.createElement('figure');
      f.className = 'sh-tm';
      const box = document.createElement('div');
      box.className = 'sh-st sh-still';
      const cv = document.createElement('canvas');
      cv.dataset.mode = String(x[0]);
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', x[1]);
      box.append(cv);
      const cap = document.createElement('figcaption');
      cap.textContent = x[1];
      f.append(box, cap);
      return f;
    }),
  );
  termTargets = $$<HTMLCanvasElement>('canvas', termsEl).map((cv) => {
    const mode = Number(cv.dataset.mode),
      valued = mode >= MODE.NL;
    return addTarget(cv, {
      draw(t, s) {
        const mesh = hiMesh();
        if (!mesh) return;
        R?.draw(t, {
          ...base(termM$.value, s),
          mesh,
          cam: camOf(),
          mode,
          interp: INTERP.PIXEL,
          tone: !valued,
          clear: 0,
        });
      },
    });
  });
}

/* ---------- 区画の割り付けと描画 ---------- */
const dpr = (): number => Math.min(2, devicePixelRatio || 1);
const allTargets = (): Target[] => [...fixedTargets, ...termTargets];

function layout(): void {
  if (!R) return;
  const ts = allTargets();
  let x = 0,
    y = 0,
    rowH = 0,
    maxW = 0;
  const W = 2048;
  for (const t of ts) {
    const cw = t.cv.clientWidth;
    if (cw <= 0) {
      t.tile = null;
      continue;
    }
    const s = Math.max(32, Math.min(MAX_TILE, Math.round(cw * dpr())));
    if (x + s > W) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    t.tile = { x, y, s };
    if (t.cv.width !== s) {
      t.cv.width = s;
      t.cv.height = s;
    }
    x += s;
    rowH = Math.max(rowH, s);
    maxW = Math.max(maxW, x);
  }
  R.resize(Math.max(1, maxW), Math.max(1, y + rowH));
}

let queued = 0;
let needLayout = true;
function dirty(): void {
  if (!queued) queued = requestAnimationFrame(frame);
}
function relayout(): void {
  needLayout = true;
  dirty();
}
function change(): void {
  if (!ready) return;
  syncRows();
  dirty();
}

function shade(): Shade {
  return makeShade(
    {
      base: hexToLinear(colorIn.value),
      metal: V.metal,
      f0: V.f0,
      rough: V.rough,
      norm: norm$.value === '1',
      quarter: expo$.value === 'q',
      ms: ms$.value === '1',
    },
    luts,
  );
}

function frame(): void {
  queued = 0;
  const s = shade();
  if (R) {
    syncMeshes();
    if (needLayout) {
      layout();
      needLayout = false;
    }
    const ts = allTargets();
    for (const t of ts) if (t.tile) t.draw(t.tile, s);
    for (const t of ts) {
      if (!t.tile || !t.c) continue;
      R.blit(t.c, t.tile);
      t.after?.(t.c, t.tile.s);
    }
  }
  showOut(s);
}

function fmtExp(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n >= 10 ? n.toFixed(0) : n.toFixed(1);
}

function showOut(s: Shade): void {
  $('#o-xp-phong').textContent = `n = ${fmtExp(s.nP)}`;
  $('#o-xp-blinn').textContent = `n = ${fmtExp(s.nB)}`;
  $('#o-xp-ggx').textContent = `α = ${s.a.toFixed(3)}`;
  const thetaI = floorOn()
      ? floorIncidence(lightDir(), kind$.value === 'point', V.dist)
      : (V.inc / 2) * (Math.PI / 180),
    mu = Math.cos(thetaI);
  $('#o-ti').textContent = `入射角 ${((thetaI * 180) / Math.PI).toFixed(0)}°`;
  for (const m of MODELS) {
    const r = reflectance(m.id, s, mu);
    $(`#o-r-${m.id}`).textContent = r.toFixed(3);
    $<HTMLElement>(`#b-r-${m.id}`).style.width = `${(Math.min(r, 1.2) / 1.2) * 100}%`;
  }
  $('#polar').innerHTML = polarSvg(
    MODELS.map((m) => m.id).filter((id) => show.has(id)),
    s,
    thetaI,
    scale$.value === 'log',
  );
  const fm = furM$.value,
    ms = ms$.value === '1';
  $$('[data-furv]').forEach((el) => {
    el.textContent = furnaceAvg(fm, luts, Number(el.dataset.furv), ms).toFixed(2);
  });
  const hex = colorIn.value;
  presetBtns.forEach((b) => {
    const m = PRESETS.find((x) => x.id === b.dataset.v);
    const on = !!m && m.hex === hex && m.metal === V.metal && m.f0 === V.f0 && m.rough === V.rough;
    b.setAttribute('aria-pressed', String(on));
  });
}

function syncRows(): void {
  G.setOff('dist', kind$.value !== 'point', '平行光では使いません');
  G.setOff('f0', V.metal >= 1, '金属では使いません');
}

/* ---------- 光のドラッグ ---------- */
const { eye, t: camT } = SPHERE_CAM;
const RS = Math.tan(Math.asin(1 / eye[2])) / camT;
function setLightAt(e: PointerEvent, el: HTMLElement): void {
  const b = el.getBoundingClientRect(),
    sx = ((e.clientX - b.left) / b.width) * 2 - 1,
    sy = 1 - ((e.clientY - b.top) / b.height) * 2;
  if (floorOn()) {
    /* ハイライトの中心がマウスの下に来る向きへ */
    const L = lightForFloor(floorAt(sx, sy), kind$.value === 'point', V.dist);
    G.set('az', Math.round((Math.atan2(L[1], L[0]) * 1800) / Math.PI) / 10);
    G.set('inc', Math.min(179, Math.round((Math.acos(L[2]) * 1800) / Math.PI) / 10));
    return;
  }
  const u = sx / RS,
    v = sy / RS,
    r = Math.hypot(u, v);
  G.set('az', Math.round((Math.atan2(v, u) * 180) / Math.PI));
  G.set('inc', r <= 1 ? Math.round((Math.asin(r) * 180) / Math.PI) : Math.round(Math.min(170, 90 + (r - 1) * 160)));
}
$$('[data-light]').forEach((el) => {
  let on = false;
  el.addEventListener('pointerdown', (e) => {
    on = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    /* タッチはスクロールかもしれないので、動くか離すまで待つ */
    if (e.pointerType === 'mouse') setLightAt(e, el);
  });
  el.addEventListener('pointermove', (e) => {
    if (on) setLightAt(e, el);
  });
  el.addEventListener('pointerup', (e) => {
    if (on && e.pointerType !== 'mouse') setLightAt(e, el);
    on = false;
    el.classList.remove('drag');
  });
  el.addEventListener('pointercancel', () => {
    on = false;
    el.classList.remove('drag');
  });
});

/* 枠の開閉と幅の変化で区画を割り直す */
const ro = new ResizeObserver(() => relayout());
for (const el of $$('.sh-four,.sh-int,.sh-fur,#terms')) ro.observe(el);

buildTerms();
syncShow();
queueMicrotask(() => {
  ready = true;
  syncRows();
  relayout();
  requestAnimationFrame(() => {
    $('#sh-busy').hidden = true;
  });
});

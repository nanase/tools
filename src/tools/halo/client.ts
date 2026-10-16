/**
 * ハロのページの入口: 入力 → 光線の追跡（WebGL2、少しずつためる）→ 空の映像・名前・光路の図・計算結果
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { minus } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { addRow, mark } from '../../lib/reset';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { initCompare } from './compare';
import { caption, FIG, type FigHalo, type FigRay, figOf, figureSvg, findRay } from './figure';
import {
  CHA_MIN,
  CZA_MAX,
  chaAlt,
  czaAlt,
  labelsFor,
  minDev,
  N550,
  PAR_MAX,
  type Proj,
  parAz,
  parDist,
  project,
  R22,
  R46,
  toApparent,
  type V3,
} from './labels';
import { fix, type Key, PARAMS, POP_PARAMS, type PopKey, sig } from './params';
import { HaloRenderer } from './render';
import { apparent, groundT, MAX_POP, presetOf } from './scene';
import { nIce, type Orient, type Population } from './trace';

initToolPage();

const txt = (sel: string, s: string) => {
  const e = $(sel);
  if (e.textContent !== s) e.textContent = s;
};
const rv = (s: string, u: string) => `${esc(s)}<span class="u">${u}</span>`;
const html = (sel: string, s: string) => {
  const e = $(sel);
  if (e.innerHTML !== s) e.innerHTML = s;
};
const ORI_NAME: Record<Orient, string> = {
  random: 'ランダム',
  plate: '板',
  column: '柱',
  parry: 'Parry',
  lowitz: 'Lowitz',
};
const D = Math.PI / 180;

/* ---------- 入力 ---------- */
let raf = 0;
/** 何を描き直すか: scene 追跡からやり直す、cloud 空の表から、view 表示だけ、fig 光路の図、lab 名前 */
const dirty = { scene: true, cloud: true, view: true, fig: true, lab: true };
function later(...ks: (keyof typeof dirty)[]): void {
  for (const k of ks) dirty[k] = true;
  if (!raf) raf = requestAnimationFrame(frame);
}

const G = new ParamGroup<Key>(PARAMS, (_v, k) => {
  if (!k) return;
  if (k === 'el' || k === 'age' || k === 'p2') later('scene', 'cloud', 'view', 'fig', 'lab');
  else if (k === 'tau' || k === 'rough' || k === 'hc') later('cloud', 'view');
  else later('view', 'lab');
});

const src$ = new Choice<'sun' | 'moon'>($('#p-src'), () => {
  showAge();
  later('scene', 'cloud', 'view', 'fig', 'lab');
});
const mode$ = new Choice<'photo' | 'only'>($('#p-mode'), (v) => {
  mode2$.set(v);
  later('view');
});
for (const id of ['#p-mode2', '#p-ori']) {
  $(id).setAttribute('data-nosave', '');
  $(id).setAttribute('data-noreset', '');
}
const mode2$ = new Choice<'photo' | 'only'>($('#p-mode2'), (v) => {
  mode$.set(v);
  store(`c:p-mode`, v);
  later('view');
});
mode2$.set(mode$.value);
const proj$ = new Choice<'fish' | 'sky' | 'rect'>($('#p-proj'), () => {
  off = { az: 0, alt: 0 };
  later('view', 'lab');
});
const names$ = new Choice<'on' | 'off'>($('#p-names'), () => later('lab'));
const hsel$ = new Choice<string>($('#p-hsel'), () => later('fig', 'lab'));

function showAge(): void {
  $('#p-age').hidden = src$.value !== 'moon';
  mark();
}
showAge();

/* ---------- 結晶の母集団 ---------- */
const clone = (ps: Population[]): Population[] => ps.map((p) => ({ ...p }));
const valid = (x: unknown): x is Population[] =>
  Array.isArray(x) &&
  x.length > 0 &&
  x.length <= MAX_POP &&
  x.every(
    (p) =>
      p &&
      typeof p === 'object' &&
      ['random', 'plate', 'column', 'parry', 'lowitz'].includes(p.orient) &&
      ['ca', 'tilt', 'rot', 'w', 'd'].every((k) => typeof p[k] === 'number' && Number.isFinite(p[k])),
  );
let presetKey = 'cirrus';
const pre$ = new Choice<string>($('#p-pre'), (v) => {
  presetKey = v;
  if (!ready) return;
  pops = clone(presetOf(v).pops);
  sel = 0;
  forget('pops');
  G.set('el', presetOf(v).e);
  popChanged();
});
presetKey = pre$.value;
let pops: Population[] = (() => {
  const sv = stored('pops');
  return valid(sv) ? clone(sv) : clone(presetOf(presetKey).pops);
})();
let sel = 0;
let ready = false;

const popRow = $('#p-pop'),
  popBtns = $$<HTMLButtonElement>('button[data-i]', popRow),
  addBtn = $<HTMLButtonElement>('#pop-add');
const savePops = () => {
  if (JSON.stringify(pops) === JSON.stringify(presetOf(presetKey).pops)) forget('pops');
  else store('pops', pops);
};
addRow(popRow, {
  isMod: () => JSON.stringify(pops) !== JSON.stringify(presetOf(presetKey).pops),
  reset: () => {
    pops = clone(presetOf(presetKey).pops);
    sel = 0;
    forget('pops');
    popChanged();
  },
});

const ori$ = new Choice<Orient>($('#p-ori'), (v) => {
  pops[sel].orient = v;
  savePops();
  loadRows();
  popChanged(false);
});
const GP = new ParamGroup<PopKey>(
  POP_PARAMS,
  (_v, k) => {
    if (!k || !ready) return;
    const v = GP.get(k);
    if (k === 'pyr') pops[sel].pyr = v / 100;
    else pops[sel][k] = v;
    savePops();
    popChanged(false);
  },
  null,
  { save: false },
);

/** 選んでいる母集団の値を行に出す（既定値はプリセットの同じ番号の母集団） */
function loadRows(): void {
  const p = pops[sel],
    q = presetOf(presetKey).pops[sel] ?? p;
  ori$.set(p.orient);
  const val: Record<PopKey, [number, number]> = {
    w: [p.w, q.w],
    tilt: [p.tilt, q.tilt],
    rot: [p.rot, q.rot],
    ca: [p.ca, q.ca],
    pyr: [(p.pyr ?? 0) * 100, (q.pyr ?? 0) * 100],
    d: [p.d, q.d],
  };
  for (const k of Object.keys(val) as PopKey[]) {
    GP.update(k, { v: val[k][1] });
    GP.set(k, val[k][0], { silent: true });
  }
  GP.setOff('tilt', p.orient === 'random', 'ランダムでは使いません');
  GP.setOff('rot', p.orient !== 'parry' && p.orient !== 'lowitz', 'Parry と Lowitz だけで使います');
}

/** 母集団のボタン（「板 50 %」）と、母集団が変わったときの描き直し */
function popChanged(rows = true): void {
  popBtns.forEach((b, i) => {
    const p = pops[i];
    b.hidden = !p;
    if (!p) return;
    b.textContent = `${ORI_NAME[p.orient]} ${sig(p.w, 3)} %`;
    b.setAttribute('aria-pressed', String(i === sel));
    b.title = `母集団 ${i + 1}`;
  });
  addBtn.hidden = pops.length >= MAX_POP;
  if (rows) loadRows();
  mark();
  later('scene', 'view', 'fig', 'lab');
}
popRow.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-i]');
  if (!b) return;
  sel = Number(b.dataset.i);
  popChanged();
});
addBtn.addEventListener('click', () => {
  if (pops.length >= MAX_POP) return;
  pops.push({ orient: 'random', ca: 1, tilt: 0, rot: 0, w: 10, d: 60, pyr: 0 });
  sel = pops.length - 1;
  savePops();
  popChanged();
});
popChanged();
queueMicrotask(() => {
  ready = true;
});

/* ---------- 映像 ---------- */
const canvas = $<HTMLCanvasElement>('#hvc'),
  hv = $('#hv'),
  msg = $('#hv-msg');
let R: HaloRenderer | null = null;
try {
  R = new HaloRenderer(canvas, 1024);
} catch (e) {
  msg.hidden = false;
  msg.textContent =
    String(e).includes('float') || String(e).includes('webgl2')
      ? 'このブラウザでは WebGL2（浮動小数点の描画）が使えないため、空を描けません。光路の図と計算結果は使えます。'
      : `空のシェーダを用意できませんでした（${String(e).slice(0, 120)}）`;
  hv.classList.add('nogl');
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  msg.hidden = false;
  msg.textContent = 'GPU の描画が止まりました。ページを読み込み直してください。';
});

/** 視線のずらし（ドラッグ）[°] */
let off = { az: 0, alt: 0 };
const elev = () => G.get('el');
const moon = () => src$.value === 'moon';
/** 今の投影 */
function view(): Proj {
  const p = proj$.value === 'fish' ? 0 : proj$.value === 'sky' ? 1 : 2,
    fov = p === 2 ? Math.min(G.get('fov'), 130) : G.get('fov'),
    e = elev();
  return {
    proj: p,
    fov,
    az: off.az,
    alt: p === 1 ? 90 : Math.max(-5, Math.min(90, Math.min(60, Math.max(22, apparent(e) + 16)) + off.alt)),
    W: canvas.clientWidth,
    H: canvas.clientHeight,
  };
}
{
  let drag: { x: number; y: number; az: number; alt: number; id: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, az: off.az, alt: off.alt, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const v = view(),
      k = v.fov / Math.max(1, canvas.clientWidth);
    off = { az: drag.az - (e.clientX - drag.x) * k, alt: drag.alt + (e.clientY - drag.y) * k };
    off.az = ((((off.az + 180) % 360) + 360) % 360) - 180;
    off.alt = Math.max(-60, Math.min(70, off.alt));
    later('view', 'lab');
  });
  const end = () => {
    drag = null;
    canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', () => {
    off = { az: 0, alt: 0 };
    later('view', 'lab');
  });
  canvas.addEventListener('keydown', (e) => {
    const mv: Record<string, [number, number]> = {
      ArrowLeft: [-5, 0],
      ArrowRight: [5, 0],
      ArrowUp: [0, 5],
      ArrowDown: [0, -5],
    };
    if (!mv[e.key]) return;
    e.preventDefault();
    off = { az: off.az + mv[e.key][0], alt: Math.max(-60, Math.min(70, off.alt + mv[e.key][1])) };
    later('view', 'lab');
  });
}

/* 画面の大きさ: 表示の大きさ × 画素の密度（上限 2）、ただし 250 万画素まで */
function fitCanvas(): boolean {
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (!w || !h) return false;
  let dpr = Math.min(2, devicePixelRatio || 1);
  if (w * h * dpr * dpr > 2.5e6) dpr = Math.sqrt(2.5e6 / (w * h));
  const W = Math.round(w * dpr),
    H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
    return true;
  }
  return false;
}
new ResizeObserver(() => later('view', 'lab')).observe(canvas);
let visible = true;
new IntersectionObserver(([e]) => {
  visible = e.isIntersecting;
  if (visible) later();
}).observe(hv);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) later();
});

/* ---------- 追跡と描画 ---------- */
let batch = 1 << 17,
  rate = 0,
  lastSceneKey = '';
const sceneKey = () => JSON.stringify([pops, elev(), moon(), G.get('age'), G.get('p2')]);

function frame(): void {
  raf = 0;
  const e = elev();
  if (dirty.scene) {
    dirty.scene = false;
    const k = sceneKey();
    if (R && k !== lastSceneKey) {
      lastSceneKey = k;
      R.setSource({ elev: e, moon: moon(), age: G.get('age') });
      R.setCrystals(pops, G.get('p2') / 100);
    }
    updateResults();
  }
  if (dirty.cloud) {
    dirty.cloud = false;
    R?.setCloud({ tau: G.get('tau'), rough: G.get('rough') / 100, hc: G.get('hc') });
    updateResults();
  }
  if (dirty.fig) {
    dirty.fig = false;
    drawFigure();
  }
  const resized = fitCanvas();
  if (R && visible && !document.hidden) {
    if (R.rays < R.maxRays) {
      const t0 = performance.now();
      R.traceRays(batch);
      R.finish();
      const dt = performance.now() - t0;
      if (dt > 0.5) {
        const r = batch / dt;
        rate = rate ? 0.85 * rate + 0.15 * r : r;
        /* 1 回を約 14 ms に保つ（画面の更新を止めない） */
        batch = Math.max(1 << 14, Math.min(1 << 23, Math.round(batch * Math.min(2, Math.max(0.5, 14 / dt)))));
      }
      dirty.view = true;
    }
    if (dirty.view || resized) {
      dirty.view = false;
      const v = view();
      R.draw({ proj: v.proj, fov: v.fov, az: v.az, alt: v.alt, ev: G.get('ev'), only: mode$.value === 'only' });
    }
    stats();
    if (R.rays < R.maxRays) raf = requestAnimationFrame(frame);
  }
  if (dirty.lab || resized) {
    dirty.lab = false;
    drawLabels();
  }
}

const fmtN = (n: number): [string, string] =>
  n >= 1e9
    ? [sig(n / 1e9, 3, true), 'G 本']
    : n >= 1e6
      ? [sig(n / 1e6, 3, true), 'M 本']
      : [String(Math.round(n / 1e3)), 'k 本'];
function stats(): void {
  if (!R) return;
  const [a, u] = fmtN(R.rays);
  txt('#v-rays', `${a} ${u.replace(' 本', '')}`);
  txt('#mR', `${a} ${u}`);
  html('#o-r', rv(a, u));
  txt('#o-rs', R.rays >= R.maxRays ? 'ためる上限に達した' : 'ためながら描き直している');
  if (rate) html('#o-sp', rv(sig(rate / 1000, 3, true), 'M 本/s'));
  txt('#o-sps', R.float32 ? 'この端末の GPU（WebGL2）' : 'この端末の GPU（WebGL2、16 bit でためる）');
}

/* ---------- 名前 ---------- */
/** 探して見つけた名前の位置（パリーアーク・ローウィッツアーク） */
let extra: Record<string, V3> = {},
  extraKey = '';
const LOWITZ: FigHalo = {
  k: 'lowitz',
  name: 'ローウィッツアーク',
  cry: '',
  pop: { orient: 'lowitz', ca: 0.25, tilt: 0.5, rot: 20, w: 1, d: 0, pyr: 0 },
  ok: (p, d, e) => {
    const a = (Math.acos(Math.max(-1, Math.min(1, d[0] * Math.cos(e * D) + d[2] * Math.sin(e * D)))) * 180) / Math.PI;
    const alt = Math.asin(d[2]) / D;
    return p.length === 2 && a > 20 && a < 26 && d[1] > 0 && alt > e + 2.5 && alt < e + 6;
  },
};
function findExtra(): void {
  const e = elev(),
    act = pops.filter((p) => p.w > 0),
    key = JSON.stringify([e, act.map((p) => p.orient)]);
  if (key === extraKey) return;
  extraKey = key;
  extra = {};
  const tasks: FigHalo[] = [];
  if (act.some((p) => p.orient === 'parry')) tasks.push(figOf('parry'));
  if (act.some((p) => p.orient === 'lowitz')) tasks.push(LOWITZ);
  for (const h of tasks) {
    const r = findRay(h, e, 150000, 11);
    if (r) extra[h.k] = [-r.outDir[0], -r.outDir[1], -r.outDir[2]];
  }
}
const labels = $('#hls'),
  lsvg = $('#hls-g');
function drawLabels(): void {
  for (const b of $$('.hl', labels)) b.remove();
  if (!R || names$.value === 'off') {
    lsvg.innerHTML = '';
    return;
  }
  findExtra();
  const v = view(),
    L = labelsFor(elev(), pops, moon(), extra),
    figs = new Set(FIG.map((f) => f.k));
  let dots = '',
    lines = '';
  const f1 = (x: number) => String(Math.round(x * 10) / 10);
  for (const l of L) {
    const p = project(v, toApparent(l.d));
    if (!p) continue;
    const isSel = l.k === hsel$.value,
      hasFig = figs.has(l.k),
      b = document.createElement('button');
    b.type = 'button';
    b.className = `hl a-${l.a}${isSel ? ' sel' : ''}${hasFig ? '' : ' nofig'}`;
    b.textContent = l.name;
    const lx = Math.min(v.W - 6, Math.max(6, p[0] + l.dx)),
      ly = Math.min(v.H - 8, Math.max(8, p[1] + l.dy));
    b.style.left = `${lx}px`;
    b.style.top = `${ly}px`;
    if (hasFig) {
      b.title = 'この光の通り道を光路の図に出す';
      b.addEventListener('click', () => {
        hsel$.set(l.k);
        store('c:p-hsel', l.k);
        later('fig', 'lab');
      });
    } else b.tabIndex = -1;
    labels.append(b);
    const r = isSel ? 6 : 4;
    dots += `<circle class="ld${isSel ? ' sel' : ''}" cx="${f1(p[0])}" cy="${f1(p[1])}" r="${r}"/>`;
    const dx = lx - p[0],
      dy = ly - p[1],
      dl = Math.hypot(dx, dy);
    if (dl > 12)
      lines += `M${f1(p[0] + (dx * r) / dl)} ${f1(p[1] + (dy * r) / dl)}L${f1(lx - (dx * 6) / dl)} ${f1(ly - (dy * 6) / dl)}`;
  }
  lsvg.setAttribute('viewBox', `0 0 ${v.W} ${v.H}`);
  lsvg.innerHTML = `<path class="ln" d="${lines}"/>${dots}`;
}

/* ---------- 光路の図 ---------- */
const figCache = new Map<string, FigRay | null>();
function drawFigure(): void {
  const h = figOf(hsel$.value),
    e = elev(),
    none = h.none?.(e) ?? null,
    key = `${h.k}|${e}`,
    sp = moon() ? '月' : '太陽';
  let R2: FigRay | null = null;
  if (!none) {
    if (!figCache.has(key)) figCache.set(key, findRay(h, e, 400000, 7));
    R2 = figCache.get(key) ?? null;
  }
  const name =
    h.k === 'uta' && e >= 32 ? '外接ハロ' : moon() ? h.name.replace('日', '月').replace('太陽', '月') : h.name;
  txt('#ray-aux', `${moon() ? '月' : '太陽'}の高度 ${minus(String(e))}° の 1 本`);
  const xs = $('#xs'),
    xn = $('#xnone');
  if (!R2) {
    xs.innerHTML = '';
    xs.style.display = 'none';
    xn.hidden = false;
    xn.textContent = none ?? `この高度では、${name}へ向かう光線を見つけられなかった。`;
    txt('#ray-path', '');
    txt('#xcap', '');
    txt('#fs-cap', name);
    for (const id of ['#r-a', '#r-d', '#r-dev']) txt(id, '—');
  } else {
    xs.style.display = '';
    xn.hidden = true;
    xs.innerHTML = figureSvg(R2, document.body.contains($('#fs')) && !$('#fs').hidden);
    xs.setAttribute('aria-label', `${name}の光の通り道`);
    const c = caption(h, R2, moon());
    txt('#ray-path', c.path);
    txt('#xcap', c.text.replaceAll('太陽', sp));
    txt('#fs-cap', `${name} · ${c.path}`);
    txt('#r-a', c.wedge);
    txt('#r-d', c.minDev);
    txt('#r-dev', c.dev);
  }
  txt('#r-n', fix(N550, 4));
}

/* ---------- 計算結果 ---------- */
function updateResults(): void {
  const e = elev(),
    m = moon(),
    sp = m ? '月' : '日',
    deg = (v: number, n = 2) => rv(fix(v, n), '°');
  txt('#v-src', m ? 'MOON' : 'SUN');
  txt('#v-e', `${minus(String(e))}°`);
  txt('#mE', `${minus(String(e))}°`);
  const p = parDist(e);
  txt('#o-pt', `幻${sp}の離角`);
  if (Number.isNaN(p)) {
    html('#o-p', '出ない');
    txt('#o-ps', `高度 ${fix(PAR_MAX, 1)}° 以上では出ない（次の側面で全反射する）`);
    txt('#mP', '—');
  } else {
    html('#o-p', deg(p));
    txt(
      '#o-ps',
      `方位の差 ${fix(parAz(e))}°（Bravais の実効屈折率 ${fix(Math.sqrt(N550 ** 2 - Math.sin(e * D) ** 2) / Math.cos(e * D), 4)}）`,
    );
    txt('#mP', `${fix(p)}°`);
  }
  const cz = czaAlt(e),
    ch = chaAlt(e);
  if (Number.isNaN(cz)) {
    html('#o-cz', '出ない');
    txt('#o-czs', e < 0 ? '光源が地平線の下' : `高度 ${fix(CZA_MAX, 1)}° 以上`);
  } else {
    html('#o-cz', deg(cz));
    txt('#o-czs', `光源の上 ${fix(cz - e)}°`);
  }
  if (Number.isNaN(ch)) {
    html('#o-ch', '出ない');
    txt('#o-chs', `高度 ${fix(CHA_MIN, 1)}° 以下`);
  } else {
    html('#o-ch', deg(ch));
    txt('#o-chs', `光源の下 ${fix(e - ch)}°`);
  }
  html('#o-22', deg(R22));
  txt('#o-22s', `赤（700 nm）${fix(minDev(nIce(700), 60))}° 〜 紫（400 nm）${fix(minDev(nIce(400), 60))}°`);
  html('#o-46', deg(R46));
  txt('#o-46s', `赤 ${fix(minDev(nIce(700), 90))}° 〜 紫 ${fix(minDev(nIce(400), 90))}°`);
  const ap = apparent(e);
  html('#o-ap', deg(ap));
  txt('#o-aps', `大気差 ${fix((ap - e) * 60, 1)}′（真の高度 ${minus(String(e))}°）`);
  /* 雲の層（真上）に届く光の割合: 真上は光源の高度と同じ道筋を通る（地上と同じ近似） */
  const t = groundT(Math.max(e, -1.5));
  const y = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  if (e < 0) {
    const shadow = Math.sqrt((2 * G.get('hc')) / 6371) / D;
    html('#o-il', e < -shadow ? '地球の影' : rv('薄明', ''));
    txt(
      '#o-ils',
      `高さ ${sig(G.get('hc'), 3)} km の雲の真上が影に入るのは光源が約 −${fix(shadow, 1)}° より下（大気差を除く）`,
    );
  } else {
    html('#o-il', rv(sig(y * 100, 3, true), '%'));
    txt(
      '#o-ils',
      `地上での直達光の透過率（赤 ${sig(t[0] * 100, 2)}・緑 ${sig(t[1] * 100, 2)}・青 ${sig(t[2] * 100, 2)} %）`,
    );
  }
  txt('#v-cry', presetKey && !stored('pops') ? presetOf(presetKey).name : 'カスタム');
  const v = proj$.value;
  txt(
    '#v-view',
    v === 'fish' ? `魚眼 ${G.get('fov')}°` : v === 'sky' ? '全天' : `カメラ ${Math.min(G.get('fov'), 130)}°`,
  );
}
G.on('fov', () => updateResults());
proj$.root.addEventListener('click', () => queueMicrotask(updateResults));

/* ---------- 全画面 ---------- */
{
  const fs = $('#fs'),
    btn = $<HTMLButtonElement>('#hv-fs');
  /** 全画面へ移す行: 太陽と氷晶、雲、表示 */
  const T1 = ['#p-el', '#p-pre', '#p-pop', '#p-ori', '#p-w', '#p-tilt', '#p-ca'],
    T2 = ['#p-tau', '#p-rough'],
    T3 = ['#p-proj', '#p-names', '#p-ev'];
  let back: [Comment, HTMLElement][] = [],
    sy = 0;
  const move = (el: HTMLElement, to: HTMLElement, before?: HTMLElement) => {
    const ph = document.createComment('fs');
    el.before(ph);
    back.push([ph, el]);
    if (before) to.insertBefore(el, before);
    else to.append(el);
  };
  const open = () => {
    if (!fs.hidden) return;
    sy = scrollY;
    move(hv, $('#fs-v'));
    for (const id of T1) move($(id), $('#fs-t1'));
    for (const id of T2) move($(id), $('#fs-t2'));
    for (const id of T3) move($(id), $('#fs-t3'));
    move($('#xsw'), $('#fs-map'), $('#fs-cap'));
    fs.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    btn.setAttribute('aria-label', '全画面を閉じる');
    btn.title = '全画面を閉じる';
    fs.requestFullscreen?.().catch(() => {});
    canvas.focus();
    later('view', 'lab', 'fig');
  };
  const close = () => {
    if (fs.hidden) return;
    for (const [ph, el] of back) ph.replaceWith(el);
    back = [];
    fs.hidden = true;
    document.documentElement.style.overflow = '';
    btn.setAttribute('aria-label', '全画面で表示');
    btn.title = '全画面で表示';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    scrollTo(0, sy);
    btn.focus();
    later('view', 'lab', 'fig');
  };
  btn.addEventListener('click', () => (fs.hidden ? open() : close()));
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !fs.hidden && !document.fullscreenElement && !(e.target instanceof HTMLInputElement))
      close();
  });
}

initCompare();
later('scene', 'cloud', 'view', 'fig', 'lab');

/**
 * ホワイトバランスのページの入口。場面を画素の表にし（重いので少しずつ）、光を当てて RAW を作り、
 * 選んだホワイトバランスのゲインで現像して描く。光を変えたときだけ RAW を作り直し、設定を変えたときは現像だけする
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { mountHow } from './how';
import { LP, TINT } from './params';
import {
  brightest,
  develop,
  gainsFrom,
  meanRaw,
  rawAt,
  type Scene,
  type SceneData,
  type Shot,
  sceneRows,
  shoot,
  tintGain,
  whAt,
} from './scene';
import { SCENES } from './scenes';
import { cctSpec, enc, KX, mv, NM, ONE, rawOf, type Spec, type Vec3 } from './spectrum';
import {
  type AutoKey,
  castName,
  fmtK,
  type LightKey,
  lightName,
  lightSpec,
  nearestT,
  PRESET,
  posOf,
  tempAt,
  type WbKey,
  wbName,
} from './wb';

initToolPage();

const W = 800,
  H = 500;
const cv = $<HTMLCanvasElement>('#wb-cv'),
  ctx = cv.getContext('2d') as CanvasRenderingContext2D,
  img = ctx.createImageData(W, H),
  busy = $('#wb-busy'),
  ring = $('#wb-ring'),
  strip = $<HTMLCanvasElement>('#wb-strip'),
  locBtn = $<HTMLButtonElement>('#wb-local');

/* ---------- 状態 ---------- */
const S = {
  scene: SCENES[0] as Scene,
  data: null as SceneData | null,
  l0: 'bulb' as LightKey | '',
  E0: lightSpec('bulb'),
  l0T: 2700,
  l1: 'bulb' as LightKey | '',
  E1: lightSpec('bulb'),
  lp: 1,
  wb: 'sun' as WbKey,
  am: 'gray' as AutoKey,
  sT: 5200,
  tint: 0,
  pt: null as [number, number] | null,
  local: false,
};
let shot: Shot | null = null,
  shotKey = '';

const tOf = (E: Spec): number => nearestT(rawOf(ONE, E));
const two = (): boolean => !!S.scene.w;

/* ---------- 入力 ---------- */
/** 光が 1 つの場面で選んだ光。光が 2 つの場面から戻ったときに戻す */
let ownL0: LightKey = 'bulb';
const l0c = new Choice<LightKey>($('#p-l0'), (v) => {
  if (!two()) ownL0 = v;
  S.l0 = v;
  S.E0 = lightSpec(v);
  S.l0T = tOf(S.E0);
  draw();
});
const l1c = new Choice<LightKey>($('#p-l1'), (v) => {
  S.l1 = v;
  S.E1 = lightSpec(v);
  draw();
});
const amc = new Choice<AutoKey>($('#p-am'), (v) => {
  S.am = v;
  draw();
});
const pg = new ParamGroup<'lp' | 'tint'>([LP, TINT], (v) => {
  S.lp = v.lp / 100;
  S.tint = v.tint;
  draw();
});
S.l0 = l0c.value;
ownL0 = l0c.value;
S.E0 = lightSpec(S.l0 as LightKey);
S.l0T = tOf(S.E0);
S.l1 = l1c.value;
S.E1 = lightSpec(S.l1 as LightKey);
S.am = amc.value;

/* ホワイトバランスのボタン */
const bar = $('#wb-bar');
function setWb(k: WbKey): void {
  S.wb = k;
  S.local = false;
  const p = PRESET[k];
  if (p) S.sT = p[0];
  if (k === 'pick' && !S.pt) S.pt = [...S.scene.pick];
  if (k === 'sun') forget('wb:mode');
  else store('wb:mode', k);
  draw();
}
bar.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-wb]');
  if (b) setWb(b.dataset.wb as WbKey);
});
locBtn.addEventListener('click', () => {
  if (!two()) return;
  S.local = !S.local;
  store('wb:local', S.local);
  draw();
});

/* 写真を押すとスポイト */
const toImg = (e: PointerEvent): [number, number] => {
  const r = cv.getBoundingClientRect();
  return [
    Math.max(0, Math.min(W - 1, ((e.clientX - r.left) / r.width) * W)),
    Math.max(0, Math.min(H - 1, ((e.clientY - r.top) / r.height) * H)),
  ];
};
let picking = false;
cv.addEventListener('pointerdown', (e) => {
  picking = true;
  cv.setPointerCapture(e.pointerId);
  S.pt = toImg(e);
  S.wb = 'pick';
  S.local = false;
  store('wb:mode', 'pick');
  draw();
});
cv.addEventListener('pointermove', (e) => {
  if (!picking) return;
  S.pt = toImg(e);
  draw();
});
const endPick = (): void => {
  picking = false;
};
cv.addEventListener('pointerup', endPick);
cv.addEventListener('pointercancel', endPick);

/* 色温度の帯: 上半分で ▼（光）、下半分で △（設定） */
const PAD = 14;
let dragging: 'l0' | 'l1' | 's' | null = null;
const stripAt = (e: PointerEvent): { T: number; top: boolean } => {
  const r = strip.getBoundingClientRect();
  return {
    T: tempAt(Math.max(0, Math.min(1, (e.clientX - r.left - PAD) / (r.width - 2 * PAD)))),
    top: e.clientY - r.top < 29,
  };
};
function stripTo(which: 'l0' | 'l1' | 's', T: number): void {
  if (which === 'l0') {
    S.l0 = '';
    S.l0T = T;
    S.E0 = cctSpec(T);
    l0c.set('' as LightKey);
  } else if (which === 'l1') {
    S.l1 = '';
    S.E1 = cctSpec(T);
    l1c.set('' as LightKey);
  } else {
    S.wb = 'temp';
    S.sT = T;
    S.local = false;
    store('wb:mode', 'temp');
    store('wb:sT', Math.round(T));
  }
  draw();
}
strip.addEventListener('pointerdown', (e) => {
  strip.setPointerCapture(e.pointerId);
  const q = stripAt(e);
  if (q.top)
    dragging = two() && Math.abs(posOf(q.T) - posOf(tOf(S.E1))) < Math.abs(posOf(q.T) - posOf(S.l0T)) ? 'l1' : 'l0';
  else dragging = 's';
  stripTo(dragging, q.T);
});
strip.addEventListener('pointermove', (e) => {
  if (dragging) stripTo(dragging, stripAt(e).T);
});
const endStrip = (): void => {
  dragging = null;
};
strip.addEventListener('pointerup', endStrip);
strip.addEventListener('pointercancel', endStrip);

/* ---------- 場面 ---------- */
const sel = $<HTMLSelectElement>('#wb-scene');
const cache = new Map<string, SceneData>();
let job = 0;
/** 場面を画素の表にする。1 フレームに 12 ms ずつ進め、終わったら描く */
function setScene(id: string, save = true): void {
  const sc = SCENES.find((s) => s.id === id) ?? (SCENES[0] as Scene);
  const wasTwo = !!S.scene.w;
  S.scene = sc;
  sel.value = sc.id;
  if (save) {
    if (sc === SCENES[0]) forget('wb:scene');
    else store('wb:scene', sc.id);
  }
  S.pt = S.wb === 'pick' ? [...sc.pick] : null;
  if (sc.w) {
    const [a, b] = (sc.lights ?? ['cloud', 'bulb']) as [LightKey, LightKey];
    S.l0 = a;
    S.E0 = lightSpec(a);
    S.l0T = tOf(S.E0);
    l0c.setDefault(a);
    l0c.set(a);
    S.l1 = b;
    S.E1 = lightSpec(b);
    l1c.setDefault(b);
    l1c.set(b);
  } else {
    S.local = false;
    l0c.setDefault('bulb');
    if (wasTwo) {
      S.l0 = ownL0;
      S.E0 = lightSpec(ownL0);
      S.l0T = tOf(S.E0);
      l0c.set(ownL0);
    }
  }
  const off = '光が 1 つの場面では使いません';
  l1c.setOff(!sc.w, off);
  pg.setOff('lp', !sc.w, off);
  locBtn.disabled = !sc.w;
  locBtn.title = sc.w ? '画素ごとに、混ざった光の白に合わせる' : '光が 2 つの場面で使えます';
  const hit = cache.get(sc.id);
  if (hit) {
    S.data = hit;
    shotKey = '';
    draw();
    return;
  }
  const my = ++job,
    g = sceneRows(sc, W, H, 4);
  busy.hidden = false;
  const step = (): void => {
    if (my !== job) return;
    const t0 = performance.now();
    for (;;) {
      const r = g.next();
      if (r.done) {
        cache.set(sc.id, r.value);
        S.data = r.value;
        shotKey = '';
        busy.hidden = true;
        draw();
        return;
      }
      if (performance.now() - t0 > 12) break;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
sel.addEventListener('change', () => setScene(sel.value));

/* ---------- 描く ---------- */
const swatch = (lin: Vec3): string => {
  const m = Math.max(lin[0], lin[1], lin[2], 1e-9),
    c = lin.map((v) => enc((Math.max(0, v) / m) * 0.9)).join(',');
  return `<i class="wb-sw" style="background:rgb(${c})" aria-hidden="true"></i>${castName(lin)}`;
};
const gainBars = (g: Vec3): string =>
  `<span class="wb-gb" aria-hidden="true">${g
    .map(
      (v, i) =>
        `<i style="height:${Math.max(8, Math.min(100, (v / 3) * 100))}%;background:${['#d0342c', '#2f9e44', '#2f6fd0'][i]}"></i>`,
    )
    .join('')}</span>`;
const setText = (id: string, s: string, html = false): void => {
  const el = $(id);
  if (html) {
    if (el.innerHTML !== s) el.innerHTML = s;
  } else if (el.textContent !== s) el.textContent = s;
};

function draw(): void {
  const d = S.data;
  if (!d) return;
  const isTwo = d.two,
    l1T = isTwo ? tOf(S.E1) : 0;
  const key = [S.scene.id, S.l0, S.l0T, isTwo ? `${S.l1}${l1T}${S.lp}` : ''].join('|');
  if (key !== shotKey || !shot) {
    shot = shoot(d, S.E0, isTwo ? S.E1 : null, S.lp);
    shotKey = key;
  }
  const sh = shot,
    local = S.local && isTwo;
  let Sw: Vec3 | null = null,
    at: [number, number] | null = null,
    tint = S.tint,
    mode = '';
  if (local) mode = '<b>場所ごと</b>　画素ごとに、混ざった光の白に合わせる';
  else if (S.wb === 'auto') {
    if (S.am === 'gray') {
      Sw = meanRaw(sh);
      mode = '<b>オート</b>　写真全体の平均を灰色に';
    } else {
      const b = brightest(sh, W);
      Sw = b.S;
      at = b.at;
      mode = '<b>オート</b>　最も明るい 0.5 % を白に';
    }
  } else if (S.wb === 'pick') {
    const p = S.pt ?? [...S.scene.pick];
    Sw = rawAt(sh, W, H, p[0], p[1]);
    at = p as [number, number];
    mode = '<b>スポイト</b>　押した所を白に';
  } else {
    Sw = rawOf(ONE, cctSpec(S.sT));
    const p = PRESET[S.wb];
    if (p) tint += p[1];
    mode = `<b>${wbName(S.wb)}</b>　${fmtK(S.sT)}${p?.[1] ? '・緑を弱める' : ''} の光と見なす`;
  }
  const g = Sw ? gainsFrom(Sw) : null;
  develop(img.data, sh, g, tint);
  ctx.putImageData(img, 0, 0);
  const sT = Sw ? (S.wb === 'auto' || S.wb === 'pick' ? nearestT(Sw) : S.sT) : null;
  if (sT && (S.wb === 'auto' || S.wb === 'pick')) mode += `　→ ${fmtK(sT)} 相当`;
  setText('#wb-mode', mode, true);
  if (at && !local) {
    ring.hidden = false;
    ring.style.left = `${(at[0] / W) * 100}%`;
    ring.style.top = `${(at[1] / H) * 100}%`;
  } else ring.hidden = true;

  for (const b of $$('button[data-wb]', bar)) b.setAttribute('aria-pressed', String(!local && b.dataset.wb === S.wb));
  locBtn.setAttribute('aria-pressed', String(local));
  amc.setOff(S.wb !== 'auto' || local, 'オートのときだけ使います');
  setText('#wb-ro', `WB ${local ? '場所ごと' : `${wbName(S.wb)}${sT ? ` ${fmtK(sT)}` : ''}`}`);
  setText('#n-l0', isTwo ? '光 1' : '光');

  /* 帯 */
  const marks: Mark[] = [{ T: S.l0T, label: isTwo ? '光 1' : '光' }];
  if (isTwo) marks.push({ T: l1T, label: '光 2' });
  if (sT) marks.push({ T: sT, up: true });
  drawStrip(marks);
  const nm = (k: string) => (k ? `（${lightName(k)}）` : '');
  setText(
    '#wb-sbar',
    `▼ ${isTwo ? '光 1' : '光'} <b>${fmtK(S.l0T)}</b>${nm(S.l0)}${isTwo ? `　▼ 光 2 <b>${fmtK(l1T)}</b>${nm(S.l1)}` : ''}　△ 設定 <b>${sT ? fmtK(sT) : '場所ごと'}</b>`,
    true,
  );

  /* 結果 */
  const t = tintGain(tint),
    ex = sh.expo * KX,
    col = (p: readonly [number, number, string]): Vec3 => {
      const raw = rawAt(sh, W, H, p[0], p[1], 2);
      let gg: readonly number[] | null = g;
      if (!gg) {
        const w = whAt(sh, W, p[0], p[1]);
        gg = gainsFrom(w);
      }
      return mv(NM, [raw[0] * (gg[0] as number) * ex, raw[1] * ex * t, raw[2] * (gg[2] as number) * ex]);
    };
  const refs = S.scene.refs ?? [[S.scene.pick[0], S.scene.pick[1], '白い所'] as const];
  const r0 = refs[0] as readonly [number, number, string];
  setText('#o-r1k', r0[2]);
  setText('#o-r1', swatch(col(r0)), true);
  setText('#o-r1s', local ? '画素ごとに光に合わせた色' : 'カメラが補正したあとの色');
  if (g) {
    setText('#o-g', `${gainBars(g)}R ×${g[0].toFixed(2)}・B ×${g[2].toFixed(2)}`, true);
    setText('#o-gs', tint ? `色かぶり補正で G ×${t.toFixed(2)}` : '');
  } else {
    setText('#o-g', '画素ごと');
    setText('#o-gs', '混ざった光の割合で変わる');
  }
  const r1 = refs[1];
  if (isTwo && r1) {
    setText('#o-r3k', r1[2]);
    setText('#o-r3', swatch(col(r1)), true);
    setText('#o-r3s', '');
  } else {
    setText('#o-r3k', '光と設定の差');
    const dT = sT ? Math.round((sT - S.l0T) / 50) * 50 : 0;
    setText(
      '#o-r3',
      !sT
        ? '—'
        : Math.abs(dT) < 100
          ? 'ほぼ同じ'
          : `設定が ${Math.abs(dT).toLocaleString('en')} K ${dT > 0 ? '高い' : '低い'}`,
    );
    setText(
      '#o-r3s',
      !sT || Math.abs(dT) < 100 ? '' : dT > 0 ? '光より青い光と見なし、赤を強める' : '光より赤い光と見なし、青を強める',
    );
  }
}

/* ---------- 色温度の帯 ---------- */
interface Mark {
  T: number;
  label?: string;
  up?: boolean;
}
let grad: string[] | null = null;
/** 帯の色: 太陽光の設定で写した、その色温度の光の白 */
function gradCols(): string[] {
  if (grad) return grad;
  const g = gainsFrom(rawOf(ONE, cctSpec(5200)));
  grad = Array.from({ length: 161 }, (_, k) => {
    const w = rawOf(ONE, cctSpec(tempAt(k / 160))),
      c = mv(NM, [(w[0] * (g[0] as number)) / w[1], 1, (w[2] * (g[2] as number)) / w[1]]),
      m = Math.max(...c);
    return `rgb(${c.map((v) => enc((Math.max(0, v) / m) * 0.95)).join(',')})`;
  });
  return grad;
}
let lastMarks: Mark[] = [];
function drawStrip(marks: Mark[]): void {
  lastMarks = marks;
  const dpr = Math.min(2, devicePixelRatio || 1),
    w = strip.clientWidth,
    h = 78;
  if (!w) return;
  if (strip.width !== Math.round(w * dpr)) {
    strip.width = Math.round(w * dpr);
    strip.height = h * dpr;
  }
  const x = strip.getContext('2d') as CanvasRenderingContext2D,
    css = getComputedStyle(strip),
    v = (n: string) => css.getPropertyValue(n).trim();
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  const bw = w - 2 * PAD,
    y0 = 18,
    y1 = 40,
    G = gradCols();
  G.forEach((c, k) => {
    x.fillStyle = c;
    x.fillRect(PAD + (bw * k) / 160, y0, bw / 160 + 1, y1 - y0);
  });
  x.strokeStyle = v('--line-2');
  x.lineWidth = 1;
  x.strokeRect(PAD + 0.5, y0 + 0.5, bw - 1, y1 - y0 - 1);
  const ink = v('--ink'),
    mut = v('--ink-3');
  x.font = '13px "Fira Mono",ui-monospace,Consolas,monospace';
  x.textAlign = 'center';
  x.fillStyle = mut;
  for (const T of w < 520 ? [2000, 3000, 5000, 10000] : [2000, 3000, 4000, 5000, 6500, 10000]) {
    const px = PAD + bw * posOf(T);
    x.fillRect(px - 0.5, y1, 1, 4);
    x.fillText(T.toLocaleString('en') + (T === 10000 ? ' K' : ''), px, y1 + 30);
  }
  for (const m of marks) {
    const px = PAD + bw * Math.max(0, Math.min(1, posOf(m.T)));
    x.lineWidth = 1.5;
    x.strokeStyle = ink;
    x.beginPath();
    if (m.up) {
      x.moveTo(px, y1 - 1);
      x.lineTo(px - 7, y1 + 11);
      x.lineTo(px + 7, y1 + 11);
      x.closePath();
      x.fillStyle = v('--surface');
      x.fill();
      x.stroke();
    } else {
      x.moveTo(px, y0 + 1);
      x.lineTo(px - 7, y0 - 11);
      x.lineTo(px + 7, y0 - 11);
      x.closePath();
      x.fillStyle = ink;
      x.fill();
      const right = px > w - 70;
      x.textAlign = right ? 'right' : 'left';
      x.font = '600 13px system-ui,sans-serif';
      x.fillText(m.label ?? '', px + (right ? -10 : 10), y0 - 3);
    }
  }
}
new ResizeObserver(() => drawStrip(lastMarks)).observe(strip);
new MutationObserver(() => drawStrip(lastMarks)).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawStrip(lastMarks));

/* ---------- 開始 ---------- */
const sm = stored('wb:mode');
if (typeof sm === 'string' && sm in { auto: 1, sun: 1, shadow: 1, cloud: 1, bulb: 1, fl: 1, temp: 1, pick: 1 }) {
  S.wb = sm as WbKey;
  const p = PRESET[S.wb];
  if (p) S.sT = p[0];
}
const st = stored('wb:sT');
if (S.wb === 'temp' && typeof st === 'number' && st >= 1800 && st <= 12000) S.sT = st;
S.local = stored('wb:local') === true;
const ss = stored('wb:scene');
setScene(typeof ss === 'string' ? ss : (SCENES[0] as Scene).id, false);
mountHow($('#wb-how'));

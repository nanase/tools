/**
 * 太陽系のページの動作: 地球から見た 7 惑星の姿・日時・大きさの年表・上から見た位置
 */
import { jdOfDate, jdToCal } from '../../lib/astro/time';
import type { Vec3 } from '../../lib/astro/vec';
import { Choice } from '../../lib/choice';
import { DatePicker } from '../../lib/date-picker';
import { addMonths, dateTimeToJd, toDateTime } from '../../lib/date-picker-core';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { cmFromNodeOfDate, subPoint } from '../../lib/planet/ephem';
import { PlanetRenderer, type PlanetU } from '../../lib/planet/render';
import { planetUniforms } from '../../lib/planet/view';
import { initToolPage } from '../../lib/tool-page';
import { grsL2, MAPS } from '../jupiter/grs';
import { w2 } from '../jupiter/model';
import { R0, R1, RING_N, ringSurge } from '../saturn/rings';
import {
  diamAt,
  distance,
  helio,
  IDS,
  type Id,
  type Look,
  look,
  MAX_DIAM,
  MAX_WIDTH,
  MODELS,
  NAME,
  nextClosest,
  ORBIT,
  PERIOD,
  RING_OUT,
} from './model';

const BASE = import.meta.env.BASE_URL;
const D = Math.PI / 180;
/** 計算する範囲（表を間引いた VSOP87D の精度を確かめた範囲） */
const JD_MIN = 2415020.5;
const JD_MAX = 2488069.5;
/** 表示の時刻帯（日本時間） */
const TZ = 9;

/* ---------- 見え方の調整（Minnaert の k・明るさ・地図のない惑星の色） ---------- */
const LOOKS: Record<Id, { minn: Vec3; gain: number; rgb: [number, number, number] }> = {
  me: { minn: [0.72, 0.72, 0.72], gain: 1.15, rgb: [163, 155, 146] },
  ve: { minn: [0.55, 0.55, 0.55], gain: 1, rgb: [242, 232, 207] },
  ma: { minn: [0.9, 0.85, 0.8], gain: 1.55, rgb: [190, 120, 90] },
  ju: { minn: [0.999, 0.95, 0.85], gain: 1.25, rgb: [214, 196, 170] },
  sa: { minn: [0.8, 0.72, 0.62], gain: 1.2, rgb: [222, 205, 160] },
  ur: { minn: [0.7, 0.7, 0.7], gain: 1, rgb: [185, 224, 230] },
  ne: { minn: [0.7, 0.7, 0.7], gain: 1, rgb: [159, 189, 230] },
};
const JUP_MAP = MAPS[MAPS.length - 1];

initToolPage();

/* ---------- 状態 ---------- */
let jd = jdOfDate(new Date());
let play = !RM.matches;
let dirty = true;
let looks: Look[] = [];

const grid = $('.ss-grid');
const busy = $('#ss-busy');
const cells = $$<HTMLButtonElement>('.ss-cell');
const sizeCv = $<HTMLCanvasElement>('#ss-size');
const topCv = $<HTMLCanvasElement>('#ss-top');
const playBtn = $('#play');

const sel$ = new Choice<Id>($('#p-pl'), (v) => select(v));
const sp$ = new Choice<'5' | '10' | '30'>($('#p-sp'));
const RANGE = { mars: 1.75, saturn: 10.3, neptune: 31.5 } as const;
const rg$ = new Choice<keyof typeof RANGE>($('#p-rg'), () => (dirty = true));

/* ---------- 色 ---------- */
const C: Record<string, string> = {};
function readColors(): void {
  const cs = getComputedStyle(grid);
  for (const k of ['ink', 'ink-2', 'ink-3', 'line', 'line-2', 'inset', 'bg', 'sans', 'mono'])
    C[k] = cs.getPropertyValue(`--${k}`).trim();
  for (const k of ['sun', 'me', 've', 'ea', 'ma', 'ju', 'sa', 'ur', 'ne'])
    C[k] = cs.getPropertyValue(`--ss-${k}`).trim();
}
const F = (w: number, px: number) => `${w} ${px}px ${C.sans}`;
const FM = (w: number, px: number) => `${w} ${px}px ${C.mono}`;

/* ---------- 惑星の姿（WebGL2。使えないときは 2D で円盤と欠けだけ） ---------- */
let gl: PlanetRenderer | null = null;
const tex: Partial<Record<Id, WebGLTexture>> = {};
try {
  gl = new PlanetRenderer(document.createElement('canvas'), { rings: true });
  for (const id of IDS) tex[id] = gl.solid(LOOKS[id].rgb);
} catch {
  gl = null;
}
async function loadMaps(r: PlanetRenderer): Promise<void> {
  const [ma, ju, sa, ring] = await Promise.all([
    r.texture(`${BASE}solar/mars.webp`),
    r.texture(`${BASE}jupiter/${JUP_MAP.file}.webp`),
    r.texture(`${BASE}saturn/s2025a.webp`),
    fetch(`${BASE}saturn/rings.bin`).then((x) => x.arrayBuffer()),
  ]);
  Object.assign(tex, { ma, ju, sa });
  r.loadRings(new Uint8Array(ring), RING_N);
}
if (gl)
  loadMaps(gl)
    .catch(() => {})
    .finally(() => {
      busy.hidden = true;
      dirty = true;
    });
else busy.hidden = true;

/** 木星の地図の経度のずれ（大赤斑の System II の経度に合わせる。木星のページと同じ） */
function jupiterShift(L: Look): number {
  const g = L.st.geo;
  const to: Vec3 = [-L.st.P[0], -L.st.P[1], -L.st.P[2]];
  const iii = subPoint(g, to).lonW;
  const ii = cmFromNodeOfDate(g, w2(g.jdTT - g.lt - 2451545), to);
  const d = grsL2(jd) + iii - ii - JUP_MAP.grsL3;
  return ((((d + 180) % 360) + 360) % 360) * D - Math.PI;
}

function uniforms(L: Look, radPx: number): PlanetU {
  const k = LOOKS[L.id];
  const shift = L.id === 'ma' ? Math.PI : L.id === 'ju' ? jupiterShift(L) : 0;
  const u = planetUniforms(MODELS[L.id], L.st, 'sky', [], { shift, minn: k.minn, gain: k.gain, shadows: false });
  if (L.id === 'sa')
    u.ring = {
      r0: R0 / MODELS.sa.re,
      r1: R1 / MODELS.sa.re,
      gain: 1.25,
      surge: ringSurge(L.st.phase),
      muMin: 1.1 / (RING_OUT * Math.max(1, radPx)),
    };
  return u;
}

/** WebGL2 が使えないときの円盤（太陽の向きだけ照らす） */
function disk2d(cv: HTMLCanvasElement, L: Look, rad: number): void {
  const c = cv.getContext('2d');
  if (!c) return;
  c.fillStyle = '#08090a';
  c.fillRect(0, 0, cv.width, cv.height);
  const u = uniforms(L, rad);
  const sx = u.s[0] * u.r[0] + u.s[1] * u.r[1] + u.s[2] * u.r[2];
  const sy = u.s[0] * u.u[0] + u.s[1] * u.u[1] + u.s[2] * u.u[2];
  const r = Math.max(0.8, rad);
  const kx = Math.abs(2 * L.illum - 1) * r;
  c.save();
  c.translate(cv.width / 2, cv.height / 2);
  c.rotate(Math.atan2(-sy, sx));
  c.fillStyle = `rgb(${LOOKS[L.id].rgb.join(',')})`;
  c.beginPath();
  c.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  if (L.illum > 0.5) c.ellipse(0, 0, kx, r, 0, Math.PI / 2, (3 * Math.PI) / 2);
  else c.ellipse(0, 0, kx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  c.fill();
  c.restore();
}

const oku = (au: number): string => {
  const v = (au * 149597870.7) / 1e8;
  return `${v < 10 ? v.toFixed(2) : v.toFixed(1)} 億 km`;
};
const SKY = { no: '見えない', ev: '夕方', al: '一晩中', mo: '明け方' } as const;

function drawCells(): void {
  const cw = cells[0].querySelector('canvas')?.clientWidth ?? 0;
  if (!cw) return;
  const d = Math.min(2, devicePixelRatio || 1);
  const px = Math.round(cw * d);
  const sc = (cw * 0.94) / MAX_WIDTH;
  looks.forEach((L, i) => {
    const b = cells[i];
    const cv = $<HTMLCanvasElement>('canvas', b);
    if (cv.width !== px) {
      cv.width = px;
      cv.height = px;
    }
    const rad = ((L.diam * sc) / 2) * d;
    if (gl) {
      gl.useMap(tex[L.id] ?? null);
      gl.icon(uniforms(L, rad), cv, Math.max(0.6, rad));
    } else disk2d(cv, L, rad);
    $('.ss-v1', b).textContent = `${L.diam.toFixed(1)}″`;
    $('.ss-v2', b).textContent = oku(L.delta);
    const s = $('.ss-sky', b);
    s.dataset.k = L.sky;
    $('span', s).textContent = SKY[L.sky];
  });
}

/* ---------- 大きさの年表 ---------- */
const STEP = 2;
const cache = new Map<Id, Map<number, number>>();
function diamDay(id: Id, k: number): number {
  let m = cache.get(id);
  if (!m) {
    m = new Map();
    cache.set(id, m);
  }
  if (m.size > 40000) m.clear();
  let v = m.get(k);
  if (v === undefined) {
    v = diamAt(id, distance(id, k * STEP));
    m.set(k, v);
  }
  return v;
}
const side = () => window.matchMedia('(min-width:900px)').matches;
const spanDays = () => (window.innerWidth < 640 ? 5 : side() ? 6 : 8) * 365.25;
const yearOf = (j: number) => jdToCal(j + TZ / 24).year;
const jdOfYear = (y: number) => dateTimeToJd({ year: y, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, TZ);

let sizeGeo = { yT: 4, rh: 34 };
function sizeTo(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const d = Math.min(2, devicePixelRatio || 1);
  const W = Math.max(10, Math.floor(w));
  const H = Math.max(10, Math.floor(h));
  if (cv.width !== W * d || cv.height !== H * d) {
    cv.width = W * d;
    cv.height = H * d;
    cv.style.height = `${H}px`;
  }
  const c = cv.getContext('2d');
  if (!c) return null;
  c.setTransform(d, 0, 0, d, 0, 0);
  c.clearRect(0, 0, W, H);
  return c;
}
function text(
  c: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  col: string,
  font: string,
  align: CanvasTextAlign = 'left',
  halo = false,
): void {
  c.font = font;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if (halo) {
    c.lineWidth = 3.5;
    c.strokeStyle = C.bg;
    c.lineJoin = 'round';
    c.strokeText(s, x, y);
  }
  c.fillStyle = col;
  c.fillText(s, x, y);
}

function drawSize(): void {
  const W = sizeCv.clientWidth;
  if (!W) return;
  const rh = side() ? Math.max(34, Math.floor((topCv.clientHeight + 10 - 28) / 7)) : window.innerWidth < 640 ? 30 : 34;
  const yT = 4;
  const H = yT + rh * 7 + 24;
  sizeGeo = { yT, rh };
  const c = sizeTo(sizeCv, W, H);
  if (!c) return;
  const span = spanDays();
  const x0 = 64;
  const x1 = W - 4;
  const tA = jd - span / 2;
  const tB = jd + span / 2;
  const yB = yT + rh * 7;
  const X = (t: number) => x0 + ((t - tA) / (tB - tA)) * (x1 - x0);
  // 年の縦線と札
  const every = (x1 - x0) / (span / 365.25) < 46 ? 2 : 1;
  for (let y = yearOf(tA); y <= yearOf(tB) + 1; y++) {
    const x = X(jdOfYear(y));
    if (x < x0 || x > x1) continue;
    c.strokeStyle = C.line;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, yT);
    c.lineTo(x, yB);
    c.stroke();
    if (y % every === 0 && x + 40 < x1) text(c, String(y), x + 3, H - 10, C['ink-3'], FM(500, 13));
  }
  const k0 = Math.floor(tA / STEP);
  const k1 = Math.ceil(tB / STEP);
  IDS.forEach((id, i) => {
    const on = id === sel$.value;
    const b = yT + rh * (i + 1) - 3;
    const h = rh - 8;
    const Y = (v: number) => b - (v / MAX_DIAM[id]) * h;
    if (on) {
      c.fillStyle = C.inset;
      c.fillRect(0, yT + rh * i, W, rh);
    }
    c.strokeStyle = C.line;
    c.beginPath();
    c.moveTo(x0, b + 0.5);
    c.lineTo(x1, b + 0.5);
    c.stroke();
    text(c, NAME[id], 4, b - h / 2, on ? C.ink : C['ink-2'], F(on ? 700 : 500, 13));
    c.save();
    c.beginPath();
    c.rect(x0, yT, x1 - x0, H);
    c.clip();
    c.beginPath();
    c.moveTo(X(k0 * STEP), b);
    for (let k = k0; k <= k1; k++) c.lineTo(X(k * STEP), Y(diamDay(id, k)));
    c.lineTo(X(k1 * STEP), b);
    c.closePath();
    c.fillStyle = C[id];
    c.globalAlpha = on ? 0.55 : 0.3;
    c.fill();
    c.globalAlpha = 1;
    c.restore();
  });
  const xc = X(jd);
  c.strokeStyle = C.ink;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(xc, yT);
  c.lineTo(xc, yB);
  c.stroke();
}

/* 年表: 横に引くと日付が動き、動かさずに離すとその段の惑星を選ぶ */
{
  let x0: number | null = null;
  let j0 = 0;
  let moved = false;
  sizeCv.addEventListener('pointerdown', (e) => {
    x0 = e.clientX;
    j0 = jd;
    moved = false;
    sizeCv.setPointerCapture(e.pointerId);
  });
  sizeCv.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 4) moved = true;
    if (moved) {
      pause();
      setJd(j0 - (dx / (sizeCv.clientWidth - 68)) * spanDays());
    }
  });
  sizeCv.addEventListener('pointerup', (e) => {
    if (x0 !== null && !moved) {
      const i = Math.floor((e.clientY - sizeCv.getBoundingClientRect().top - sizeGeo.yT) / sizeGeo.rh);
      if (i >= 0 && i < IDS.length) {
        sel$.choose(IDS[i]);
        select(IDS[i]);
      }
    }
    x0 = null;
  });
  sizeCv.addEventListener('pointercancel', () => {
    x0 = null;
  });
}

/* ---------- 上から見た位置 ---------- */
const DOT: Record<Id | 'ea', number> = { me: 3, ve: 4.5, ea: 4.5, ma: 4, ju: 7, sa: 6.5, ur: 5, ne: 5 };
const orbits = new Map<Id | 'ea', Vec3[]>();
function orbit(id: Id | 'ea'): Vec3[] {
  let o = orbits.get(id);
  if (!o) {
    o = [];
    const j = jdOfDate(new Date());
    for (let i = 0; i <= 240; i++) o.push(helio(id, j + (PERIOD[id] * i) / 240));
    orbits.set(id, o);
  }
  return o;
}
type Box = [number, number, number, number];
function drawTop(): void {
  const W = Math.min(topCv.parentElement?.clientWidth ?? 0, 640);
  if (!W) return;
  const H = Math.min(W, 440);
  topCv.style.width = `${W}px`;
  const c = sizeTo(topCv, W, H);
  if (!c) return;
  const range = RANGE[rg$.value];
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) / 2 - 12;
  const s = R / range;
  const X = (p: Vec3): [number, number] => [cx + s * p[0], cy - s * p[1]];
  for (const id of ['me', 've', 'ea', 'ma', 'ju', 'sa', 'ur', 'ne'] as const) {
    const a = id === 'ea' ? 1 : ORBIT[id][0];
    if (a > range * 1.06) continue;
    c.beginPath();
    orbit(id).forEach((p, i) => {
      const [x, y] = X(p);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.strokeStyle = id === 'ea' ? C['ink-3'] : C['line-2'];
    c.lineWidth = id === 'ea' ? 1.3 : 1;
    c.stroke();
  }
  // 太陽
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, 18);
  g.addColorStop(0, C.sun);
  g.addColorStop(0.38, C.sun);
  g.addColorStop(0.4, `${C.sun}55`);
  g.addColorStop(1, `${C.sun}00`);
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, 18, 0, 7);
  c.fill();
  const boxes: Box[] = [[cx - 12, cy - 12, 24, 24]];
  const labels: [[number, number, number], string, string, string][] = [];
  const edges: typeof labels = [];
  const dotAt = (id: Id | 'ea', p: Vec3): [number, number, number] => {
    const [x, y] = X(p);
    const r = DOT[id];
    c.fillStyle = C[id];
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fill();
    if (id === 'sa') {
      c.strokeStyle = C.sa;
      c.lineWidth = 1.2;
      c.beginPath();
      c.ellipse(x, y, r * 1.9, r * 0.6, -0.4, 0, 7);
      c.stroke();
    }
    boxes.push([x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2]);
    return [x, y, r];
  };
  const sel = sel$.value;
  const e = helio('ea', jd);
  const E = X(e);
  const inR = (p: Vec3) => Math.hypot(p[0], p[1]) <= range * 1.02;
  const ps = helio(sel, jd);
  if (inR(ps)) {
    const Q = X(ps);
    c.strokeStyle = C.ink;
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(E[0], E[1]);
    c.lineTo(Q[0], Q[1]);
    c.stroke();
    const an = Math.atan2(Q[1] - E[1], Q[0] - E[0]);
    const nx = -Math.sin(an) * 5;
    const ny = Math.cos(an) * 5;
    for (const [x, y] of [E, Q]) {
      c.beginPath();
      c.moveTo(x - nx, y - ny);
      c.lineTo(x + nx, y + ny);
      c.stroke();
    }
  }
  labels.push([dotAt('ea', e), NAME.ea, C.ea, F(700, 13)]);
  for (const L of looks) {
    const p = helio(L.id, jd);
    if (!inR(p)) {
      const a = Math.atan2(p[1], p[0]);
      const rr = R - 4;
      const x = cx + rr * Math.cos(a);
      const y = cy - rr * Math.sin(a);
      // 範囲の外の惑星は縁に向きの矢じりを出す
      c.save();
      c.translate(x, y);
      c.rotate(-a);
      c.fillStyle = C[L.id];
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-9, -5);
      c.lineTo(-6.5, 0);
      c.lineTo(-9, 5);
      c.closePath();
      c.fill();
      c.restore();
      boxes.push([x - 6, y - 6, 12, 12]);
      edges.push([[cx + (rr - 14) * Math.cos(a), cy - (rr - 14) * Math.sin(a), 0], NAME[L.id], C['ink-2'], F(600, 13)]);
      continue;
    }
    const d = dotAt(L.id, p);
    if (L.id === sel) labels.unshift([d, `${NAME[L.id]} ${oku(L.delta)}`, C.ink, F(700, 15)]);
    else if (Math.hypot(d[0] - cx, d[1] - cy) > 26) labels.push([d, NAME[L.id], C['ink-2'], F(600, 13)]);
  }
  const hit = (b: Box) =>
    boxes.some((q) => b[0] < q[0] + q[2] && b[0] + b[2] > q[0] && b[1] < q[1] + q[3] && b[1] + b[3] > q[1]);
  for (const [[x, y, r], s0, col, font] of [...edges, ...labels]) {
    c.font = font;
    const w = c.measureText(s0).width;
    const h = 16;
    const cand: [number, number][] =
      r === 0
        ? [
            [x - w / 2, y - h / 2],
            [x - w / 2, y - h - 6],
            [x - w / 2, y + 6],
          ]
        : [
            [x + r + 4, y - r - h],
            [x + r + 4, y + r],
            [x - r - 4 - w, y - r - h],
            [x - r - 4 - w, y + r],
            [x - w / 2, y - r - h - 2],
            [x - w / 2, y + r + 2],
          ];
    let best = cand[0];
    for (const [bx, by] of cand) {
      if (bx < 2 || bx + w > W - 2 || by < 2 || by + h > H - 2) continue;
      if (!hit([bx, by, w, h])) {
        best = [bx, by];
        break;
      }
    }
    boxes.push([best[0], best[1], w, h]);
    text(c, s0, best[0], best[1] + h / 2, col, font, 'left', true);
  }
}

/* ---------- 日時 ---------- */
const local = (j: number) => jdToCal(j + TZ / 24);
const p2 = (n: number) => String(n).padStart(2, '0');
function setJd(j: number): void {
  jd = Math.max(JD_MIN, Math.min(JD_MAX, j));
  dirty = true;
}
function pause(): void {
  play = false;
  syncPlay();
}
function syncPlay(): void {
  playBtn.setAttribute('aria-pressed', String(play));
}
playBtn.addEventListener('click', () => {
  play = !play;
  if (play && jd >= JD_MAX) jd = jdOfDate(new Date());
  syncPlay();
});
const datePicker = new DatePicker($('#dp'), {
  get: () => toDateTime(local(jd)),
  set: (v) => setJd(dateTimeToJd(v, TZ)),
  today: () => local(jdOfDate(new Date())),
});
for (const [id, n] of [
  ['#mprev', -1],
  ['#mnext', 1],
] as const)
  $(id).addEventListener('click', () => setJd(dateTimeToJd(addMonths(toDateTime(local(jd)), n), TZ)));
$('#today').addEventListener('click', () => setJd(jdOfDate(new Date())));
$('#near').addEventListener('click', () => {
  pause();
  setJd(nextClosest(sel$.value, jd + 0.5));
});

function nearText(id: Id): void {
  $('#near-t').textContent = `${NAME[id]}の次の最接近`;
}
/** 惑星を選ぶ: 次の最接近のボタンと、上から見た図の範囲（その惑星が入る最も狭い範囲）を合わせる */
function select(id: Id): void {
  nearText(id);
  const need = ORBIT[id][0] * (1 + ORBIT[id][1]);
  const r = (Object.keys(RANGE) as (keyof typeof RANGE)[]).find((k) => RANGE[k] >= need) ?? 'neptune';
  rg$.set(r);
  dirty = true;
}

/* ---------- 描画のループ ---------- */
function render(): void {
  looks = IDS.map((id) => look(id, jd));
  const c = local(jd);
  $('#o-date').textContent = `${c.year}/${p2(c.month)}/${p2(c.day)}`;
  datePicker.sync();
  drawCells();
  drawTop();
  drawSize();
}
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (play) {
    jd += dt * Number(sp$.value);
    if (jd >= JD_MAX) {
      jd = JD_MAX;
      pause();
    }
    dirty = true;
  }
  if (dirty) {
    dirty = false;
    render();
  }
  requestAnimationFrame(frame);
}

readColors();
const recolor = () => {
  readColors();
  dirty = true;
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => (dirty = true)).observe(grid);
nearText(sel$.value);
syncPlay();
requestAnimationFrame(frame);

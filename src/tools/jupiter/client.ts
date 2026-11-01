/**
 * 木星のページ: 日時と観測地から木星とガリレオ衛星の状態を計算し、望遠の図・衛星の並び・今夜の帯・現象の一覧・
 * 軌道・衛星の動き・大赤斑の南中・相互食を描く
 */
import { calToJd, jdToCal } from '../../lib/astro/time';
import { dot, len, sub, unit, type Vec3 } from '../../lib/astro/vec';
import { Choice } from '../../lib/choice';
import { $, esc } from '../../lib/dom';
import { cmFromNodeOfDate, Ephem, type Geo, type PlanetState, planetState } from '../../lib/planet/ephem';
import {
  findMutual,
  findPhen,
  limb,
  type Mutual,
  type Phen,
  pairFlux,
  planetShadow,
  skyOffset,
  sunHidden,
  toEarth,
} from '../../lib/planet/events';
import {
  BAND_W,
  bandAxisY,
  lightCurve,
  nightBand,
  orbitTop,
  season,
  WIG,
  wiggle,
  wiggleTime,
} from '../../lib/planet/figs';
import { PlanetRenderer } from '../../lib/planet/render';
import { SitePicker } from '../../lib/planet/site';
import { altFast, crossings, SUN_DARK, SUN_SET, sunAlt, transits } from '../../lib/planet/sky';
import { facing, type MoonLook, type Orient, planetUniforms, screenOf, shadowPoint } from '../../lib/planet/view';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { GRS_LAST, GRS_LAST_JD, GRS_RATE, grsL2, MAPS, type MapInfo, nearestMap } from './grs';
import { JUPITER_MODEL as M, MOONS, w1, w2 } from './model';

const BASE = import.meta.env.BASE_URL;
const D = Math.PI / 180;
const E = new Ephem(M);
const NAMES = MOONS.map((m) => m.name);
const RADII = MOONS.map((m) => m.r);
const FLUX = MOONS.map((m) => 10 ** (-0.4 * m.v10));
/** 軌道の半径（赤道半径が単位。JPL の平均軌道要素の a） */
const ORBITS = [421800, 671100, 1070400, 1882700].map((a) => a / M.re);
/** OPAL の Minnaert の k（F631N・F502N・F395N） */
const MINN: Vec3 = [0.999, 0.95, 0.85];
const GAIN = 1.25;

const p2 = (n: number) => String(n).padStart(2, '0');
const txt = (id: string, s: string) => {
  const e = document.querySelector(id);
  if (e && e.textContent !== s) e.textContent = s;
};
const minus = (s: string) => s.replace(/-/g, '−');
const nowJd = () => Date.now() / 86400000 + 2440587.5;
const wrap = (v: number) => ((v % 360) + 360) % 360;
const wrap180 = (v: number) => wrap(v + 180) - 180;

/* ---------- 表示の設定 ---------- */
const or$ = new Choice<Orient>($('#p-or'), () => later(true));
const nm$ = new Choice<'on' | 'off'>($('#p-nm'), () => later());
const sh$ = new Choice<'on' | 'off'>($('#p-sh'), () => later());
const map$ = new Choice<'near' | 'latest'>($('#p-map'), () => later(true));
const tz$ = new Choice<'jst' | 'ut'>($('#p-tz'), () => {
  resetNight();
  later(true);
});
const sp$ = new Choice($('#p-sp'));
const wr$ = new Choice<'1' | '3' | '8'>($('#p-wr'), () => {
  wigKey = '';
  later(true);
});
const mk$ = new Choice<'all' | 'occ' | 'ecl'>($('#p-mk'), () => {
  seaKey = '';
  later(true);
});
initToolPage();

const tzh = () => (tz$.value === 'ut' ? 0 : 9);
const tzName = () => (tz$.value === 'ut' ? 'UT' : 'JST');
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const local = (jd: number) => jdToCal(jd + tzh() / 24);
const hm = (jd: number) => {
  const c = local(jd);
  const m = Math.round(c.hour * 60) % 1440;
  return `${Math.floor(m / 60)}:${p2(m % 60)}`;
};
const md = (jd: number) => {
  const c = local(jd);
  return `${c.month}/${c.day}`;
};
const dateStr = (jd: number) => {
  const c = local(jd);
  return `${c.year}-${p2(c.month)}-${p2(c.day)}（${WD[((Math.floor(jd + 1.5 + tzh() / 24) % 7) + 7) % 7]}）`;
};
/** 表示の時刻帯の、その日の 0 時の JD */
const dayStart = (jd: number) => Math.floor(jd + 0.5 + tzh() / 24) - 0.5 - tzh() / 24;
/** jd を含む夜の始まり（表示の時刻帯の正午） */
const nightStart = (jd: number) => {
  const d = dayStart(jd);
  return jd - d < 0.5 ? d - 0.5 : d + 0.5;
};
const dms = (as: number) => {
  const m = Math.floor(as / 60);
  const s = Math.round(as - m * 60);
  return s === 60 ? `${m + 1}′00″` : `${m}′${p2(s)}″`;
};

/* ---------- 観測地 ---------- */
const picker = new SitePicker(
  BASE,
  () => {
    resetNight();
    later(true);
  },
  (o) => `高度 ${minus(planetState(M, jd, o).alt.toFixed(0))}°`,
);
const obs = () => picker.obs;

/* ---------- 状態 ---------- */
let jd = nowJd();
let st: PlanetState = planetState(M, jd, obs());
let raf = 0;
let full = true;
function later(all = false): void {
  if (all) full = true;
  if (!raf) raf = requestAnimationFrame(frame);
}
let live = true;
function setJd(v: number, keepLive = false): void {
  jd = v;
  if (!keepLive) setLive(false);
  later(true);
}
function setLive(on: boolean): void {
  live = on;
  $('#nowbtn').setAttribute('aria-pressed', String(on));
  $('#nowLed').classList.toggle('on', on);
}
setInterval(() => {
  if (document.hidden) return;
  if (live && !playing) setJd(nowJd(), true);
}, 1000);

/* ---------- 大赤斑 ---------- */
let grsOff = typeof stored('grsOff') === 'number' ? (stored('grsOff') as number) : 0;
const grsAt = (t: number) => wrap(grsL2(t) + grsOff);

/** 中央子午線 I・II・III [°]（観測地から見た円盤の中心） */
function cmOf(g: Geo, toObs: Vec3): [number, number, number, number] {
  const d = g.jdTT - g.lt - 2451545;
  const b = [dot(toObs, g.x), dot(toObs, g.y)];
  const iii = wrap(-Math.atan2(b[1], b[0]) / D);
  return [cmFromNodeOfDate(g, w1(d), toObs), cmFromNodeOfDate(g, w2(d), toObs), iii, d];
}
const cmNow = () => cmOf(st.geo, unit(sub([0, 0, 0], st.P)));

/** 時刻 t の System II の中央子午線と大赤斑の経度の差 [°]（−180〜180、南中で 0 を − から + へ） */
function grsDelta(t: number): number {
  const g = E.at(t);
  const [, ii] = cmOf(g, toEarth(g));
  return wrap180(ii - grsAt(t));
}
/** [t0, t1] の大赤斑の南中 */
function grsTransits(t0: number, t1: number): number[] {
  const out: number[] = [];
  const step = 1 / 48;
  let a = t0,
    fa = grsDelta(a);
  while (a < t1) {
    const b = Math.min(t1, a + step),
      fb = grsDelta(b);
    if (fa < 0 && fb >= 0 && fb - fa < 90) {
      let lo = a,
        hi = b;
      for (let k = 0; k < 22; k++) {
        const m = (lo + hi) / 2;
        if (grsDelta(m) < 0) lo = m;
        else hi = m;
      }
      out.push((lo + hi) / 2);
    }
    a = b;
    fa = fb;
  }
  return out;
}

/* ---------- 模様の地図 ---------- */
let renderer: PlanetRenderer | null = null;
let mapOn: MapInfo | null = null;
let mapWant = '';
function wantMap(): MapInfo {
  return map$.value === 'latest' ? MAPS[MAPS.length - 1] : nearestMap(jd);
}
function loadMap(m: MapInfo): void {
  if (!renderer || mapWant === m.file) return;
  mapWant = m.file;
  renderer
    .load(`${BASE}jupiter/${m.file}.webp`)
    .then(() => {
      if (mapWant === m.file) mapOn = m;
      later(true);
    })
    .catch(() => {
      mapWant = '';
      const v = $('#v-msg');
      v.hidden = false;
      v.textContent = '模様の地図を読み込めませんでした';
    });
}

/* ---------- 望遠の図 ---------- */
const view = $('#pview');
const canvas = $<HTMLCanvasElement>('#pc');
let vz = 1,
  vx = 0,
  vy = 0;
const VZ_MIN = 0.4,
  VZ_MAX = 12;
interface Lay {
  W: number;
  H: number;
  rad: number;
  cx: number;
  cy: number;
}
const baseRad = (W: number, H: number) => 0.4 * Math.min(H, W / 1.6);
function layout(): Lay {
  const W = view.clientWidth,
    H = view.clientHeight;
  return { W, H, rad: baseRad(W, H) * vz, cx: W / 2 + vx, cy: H / 2 + vy };
}
function clampPan(): void {
  const W = view.clientWidth,
    H = view.clientHeight;
  vx = Math.max(-W, Math.min(W, vx));
  vy = Math.max(-H, Math.min(H, vy));
}
function zoomAbout(px: number, py: number, f: number): void {
  const L = layout();
  const nz = Math.min(VZ_MAX, Math.max(VZ_MIN, vz * f)),
    k = nz / vz;
  vz = nz;
  vx = px - (px - L.cx) * k - L.W / 2;
  vy = py - (py - L.cy) * k - L.H / 2;
  clampPan();
  viewChanged();
}
function viewChanged(): void {
  const moved = Math.abs(vz - 1) > 1e-3 || Math.abs(vx) > 0.5 || Math.abs(vy) > 0.5;
  $('#vreset').hidden = !moved;
  txt('#vzoom', `×${vz.toFixed(vz < 2 ? 2 : 1)}`);
  canvas.style.touchAction = vz > 1.01 ? 'none' : 'pan-y';
  later();
}
const ptrs = new Map<number, { x: number; y: number }>();
let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
let pinch: { d: number; z: number } | null = null;
const localXY = (e: PointerEvent | WheelEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = localXY(e);
  ptrs.set(e.pointerId, p);
  if (ptrs.size === 1) drag = { ...p, vx, vy, moved: false };
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: vz };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return;
  const p = localXY(e);
  ptrs.set(e.pointerId, p);
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    zoomAbout((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d / vz);
    return;
  }
  if (!drag) return;
  const dx = p.x - drag.x,
    dy = p.y - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  canvas.classList.add('drag');
  vx = drag.vx + dx;
  vy = drag.vy + dy;
  clampPan();
  viewChanged();
});
const ptrEnd = (e: PointerEvent) => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 0) {
    drag = null;
    canvas.classList.remove('drag');
  }
};
canvas.addEventListener('pointerup', ptrEnd);
canvas.addEventListener('pointercancel', ptrEnd);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = localXY(e);
    zoomAbout(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  },
  { passive: false },
);
const zoomCenter = (f: number) => {
  const L = layout();
  zoomAbout(L.W / 2, L.H / 2, f);
};
$('#vin').addEventListener('click', () => zoomCenter(1.5));
$('#vout').addEventListener('click', () => zoomCenter(1 / 1.5));
$('#vreset').addEventListener('click', () => {
  vz = 1;
  vx = vy = 0;
  viewChanged();
});

/** 衛星の状態（本体の前・本体の裏・影が本体に・本体の影の中） */
function moonState(g: Geo, k: number) {
  const m = g.moons[k];
  const [o, fo] = limb(g, M.re, M.rp, m, toEarth(g));
  const [s, fs] = limb(g, M.re, M.rp, m, g.s);
  return { tr: o < 0 && fo, oc: o < 0 && !fo, sh: s < 0 && fs, ec: s < 0 && !fs };
}

/** 衛星の明るさ: 本体の影と、ほかの衛星の影（中心で見積もる） */
function moonLooks(g: Geo): MoonLook[] {
  const ts = 695700 / (g.r * 149597870.7);
  return MOONS.map((m, k) => {
    let lit = 1 - planetShadow(g, M.re, M.rp, k);
    for (let i = 0; i < MOONS.length; i++) {
      if (i === k) continue;
      const d = sub(g.moons[i], g.moons[k]);
      const L = dot(d, g.s);
      if (L <= 0) continue;
      const perp = len(sub(d, [L * g.s[0], L * g.s[1], L * g.s[2]]));
      lit *= 1 - sunHidden(ts, RADII[i] / L, perp / L);
    }
    return { r: m.r, rgb: m.rgb, lit };
  });
}

/** 地図を回す角 [rad]: 大赤斑が予報の System II の経度に来るようにする */
function mapShift(): number {
  if (!mapOn) return 0;
  const [, ii, iii] = cmNow();
  const l3 = grsAt(jd) + (iii - ii);
  return wrap180(l3 - mapOn.grsL3) * D;
}

const ORIENT_T: Record<Orient, string> = { zenith: '天頂が上', planet: '木星の北が上', sky: '天の北が上' };

function drawMain(): void {
  if (!renderer) return;
  renderer.fit();
  const L = layout();
  const dpr = canvas.width / Math.max(1, L.W);
  const mode = or$.value;
  const g = st.geo;
  const looks = moonLooks(g);
  const u = planetUniforms(M, st, mode, looks, {
    shift: mapShift(),
    minn: MINN,
    gain: GAIN,
    shadows: sh$.value === 'on',
  });
  renderer.clear();
  renderer.draw(u, {
    x: 0,
    y: 0,
    w: canvas.width,
    h: canvas.height,
    cx: L.cx * dpr,
    cy: (L.H - L.cy) * dpr,
    rad: L.rad * dpr,
  });
  /* 名前と影 */
  const h: string[] = [];
  const rs = st.diam / 2;
  if (nm$.value === 'on') {
    MOONS.forEach((m, k) => {
      const [sx, sy, sz] = screenOf(M, st, mode, g.moons[k]);
      const px = L.cx + sx * L.rad,
        py = L.cy - sy * L.rad;
      const ms = moonState(g, k);
      const inBody = Math.hypot(sx, sy * (M.re / M.rp)) < 1;
      const note = ms.tr ? '本体の前' : ms.oc ? '本体の裏' : ms.ec ? '木星の影の中' : '';
      if (px >= 0 && px <= L.W && py >= 0 && py <= L.H) {
        const r = (m.r / M.re) * L.rad;
        const up = inBody && sz < 0;
        h.push(
          `<span class="pn-sl${up ? ' pn-up' : ''}" style="left:${px.toFixed(1)}px;top:${(up ? py - r - 4 : py + r + 4).toFixed(1)}px">${esc(m.name)}${note ? `<small>${note}</small>` : ''}</span>`,
        );
      } else if (Math.abs(py - L.cy) < L.H) {
        const [e] = skyOffset(g, g.moons[k], M.re);
        const sep = Math.hypot(...skyOffset(g, g.moons[k], M.re)) * rs;
        const left = px < 0;
        h.push(
          `<span class="pn-edge ${left ? 'pn-l' : 'pn-r'}" style="top:${Math.max(44, Math.min(L.H - 72, py - 10)).toFixed(0)}px">${left ? '← ' : ''}${esc(m.name)}${left ? '' : ' →'}<br>${e > 0 ? '東' : '西'} ${dms(sep)}</span>`,
        );
      }
    });
    if (sh$.value === 'on')
      MOONS.forEach((m, k) => {
        const p = shadowPoint(M, st, k);
        if (!p || !facing(st, p)) return;
        const [sx, sy] = screenOf(M, st, mode, p);
        const px = L.cx + sx * L.rad,
          py = L.cy - sy * L.rad;
        if (px < 0 || px > L.W || py < 0 || py > L.H) return;
        h.push(
          `<span class="pn-sl pn-sh" style="left:${px.toFixed(1)}px;top:${(py + (m.r / M.re) * L.rad + 4).toFixed(1)}px">${esc(m.name)}の影</span>`,
        );
      });
  }
  $('#labs').innerHTML = h.join('');
  const fov = (L.W / L.rad) * rs;
  txt('#v-lab', `${ORIENT_T[mode]} · 視野 ${(fov / 60).toFixed(1)}′`);
  txt('#v-lab2', bottomNote());
}

/** 窓の下の注記: 地平線の下、大赤斑の向き、模様の地図 */
function bottomNote(): string {
  const parts: string[] = [];
  if (st.alt < 0) parts.push(`地平線の下（高度 ${minus(st.alt.toFixed(1))}°）`);
  const [, ii] = cmNow();
  const dl = wrap180(grsAt(jd) - ii);
  if (Math.abs(dl) < 80) parts.push(`大赤斑は中央から${dl > 0 ? '西' : '東'}へ ${Math.abs(dl).toFixed(0)}°`);
  else {
    const tr = grsTransits(jd - 0.42, jd + 0.42).sort((a, b) => Math.abs(a - jd) - Math.abs(b - jd))[0];
    parts.push(tr ? `大赤斑は裏側（${hm(tr)} に南中${tr < jd ? 'した' : 'する'}）` : '大赤斑は裏側');
  }
  if (mapOn) parts.push(`模様は ${mapOn.label} の地図を大赤斑に合わせて回したもの · ほかの模様は目安`);
  return parts.join(' · ');
}

/* ---------- 衛星の並び ---------- */
const sview = $('#sview');
const scv = $<HTMLCanvasElement>('#sc');
const icon = document.createElement('canvas');
/** 並びの片側の広さ（赤道半径）。夜ごとに衛星の離れの最大から決める */
let stripR = 20;
function drawStrip(): void {
  const W = sview.clientWidth,
    H = sview.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (scv.width !== Math.round(W * dpr) || scv.height !== Math.round(H * dpr)) {
    scv.width = Math.round(W * dpr);
    scv.height = Math.round(H * dpr);
  }
  const c = scv.getContext('2d');
  if (!c) return;
  c.fillStyle = '#000';
  c.fillRect(0, 0, scv.width, scv.height);
  const mode = or$.value;
  const g = st.geo;
  const k = W / 2 / stripR;
  const rad = k;
  if (renderer) {
    const n = Math.max(8, Math.round(rad * 2.4 * dpr));
    if (icon.width !== n) icon.width = icon.height = n;
    const u = planetUniforms(M, st, mode, moonLooks(g), {
      shift: mapShift(),
      minn: MINN,
      gain: GAIN,
      shadows: sh$.value === 'on',
    });
    u.moons = [];
    renderer.icon(u, icon, rad * dpr);
    c.drawImage(icon, scv.width / 2 - n / 2, scv.height / 2 - n / 2);
  }
  const rs = st.diam / 2;
  const h: string[] = [];
  MOONS.forEach((m, i) => {
    const [sx, sy] = screenOf(M, st, mode, g.moons[i]);
    const px = W / 2 + sx * k,
      py = H / 2 - sy * k;
    const ms = moonState(g, i);
    const inBody = Math.hypot(sx, sy) < 1.05;
    if (!inBody)
      h.push(
        `<span class="pn-sd${ms.oc ? ' pn-hid' : ms.ec ? ' pn-dim' : ''}" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px"></span>`,
      );
    if (nm$.value === 'on') {
      const sep = Math.hypot(...skyOffset(g, g.moons[i], M.re)) * rs;
      h.push(
        inBody
          ? `<span class="pn-sl pn-up" style="left:${px.toFixed(1)}px;top:${(H / 2 - rad - 6).toFixed(1)}px">${esc(m.name)}</span>`
          : `<span class="pn-sl" style="left:${px.toFixed(1)}px;top:${(py + 8).toFixed(1)}px">${esc(m.name)}<small>${(sep / 60).toFixed(1)}′</small></span>`,
      );
    }
  });
  $('#slabs').innerHTML = h.join('');
  const fov = 2 * stripR * rs;
  const east = Math.cos(screenAngleEast() * D) < -0.7;
  txt('#s-lab', `衛星の並び · 視野 ${Math.round(fov / 60)}′${east ? ' · 東が左' : ''}`);
  const minPx = (60 / rs) * k;
  $('#s-scale').style.display = minPx < W * 0.3 ? '' : 'none';
  ($('#s-scale i') as HTMLElement).style.width = `${minPx.toFixed(1)}px`;
}
/** 画面での東の向き [°]（右 = 0） */
function screenAngleEast(): number {
  const u = unit(st.P);
  const n0 = unit([-u[2] * u[0], -u[2] * u[1], 1 - u[2] * u[2]]);
  const e: Vec3 = [n0[1] * u[2] - n0[2] * u[1], n0[2] * u[0] - n0[0] * u[2], n0[0] * u[1] - n0[1] * u[0]];
  const [x, y] = screenOf(M, st, or$.value, [e[0] * M.re, e[1] * M.re, e[2] * M.re]);
  return Math.atan2(y, x) / D;
}

/* ---------- 数値 ---------- */
function drawNumbers(): void {
  const c = local(jd);
  const s = Math.floor(c.hour * 3600 + 1e-6);
  txt('#clk', `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`);
  txt('#clkz', tzName());
  txt('#o-date', dateStr(jd));
  txt('#o-diam', `${st.diam.toFixed(1)}″`);
  txt('#o-mag', minus(st.mag.toFixed(2)));
  const [i, ii, iii] = cmNow();
  txt('#o-cm', `${i.toFixed(1)} · ${ii.toFixed(1)} · ${iii.toFixed(1)}°`);
  txt('#o-altaz', `${minus(st.alt.toFixed(1))}° · ${st.az.toFixed(1)}°`);
  ($('#dt') as HTMLInputElement).value =
    `${c.year}-${p2(c.month)}-${p2(c.day)}T${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}`;
}
$('#dtbtn').addEventListener('click', () => {
  const i = $<HTMLInputElement>('#dt');
  try {
    i.showPicker();
  } catch {
    i.focus();
  }
});
$('#dt').addEventListener('change', (e) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec((e.target as HTMLInputElement).value);
  if (m) setJd(calToJd(+m[1], +m[2], +m[3]) + (+m[4] + +m[5] / 60 - tzh()) / 24);
});

/* ---------- 今夜 ---------- */
interface Item {
  t: number;
  t1?: number;
  text: string;
  dot: string;
}
interface Night {
  key: string;
  n0: number;
  t0: number;
  t1: number;
  phen: Phen[];
  grs: number[];
  dark: [number, number][];
  twi: [number, number][];
  items: Item[];
  mutual: Mutual[];
  /** 見える時間（太陽が沈み木星が昇っている） */
  vis: [number, number][];
}
let night: Night | null = null;
function resetNight(): void {
  night = null;
  wigKey = '';
  seaKey = '';
  grsKey = '';
  keyKey = '';
  topKey = '';
  mutCache.clear();
}

/** 0〜1 の判定の値の列から、真の区間をつなぐ */
function runs(ts: number[], ok: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let a: number | null = null;
  ok.forEach((v, i) => {
    if (v && a === null) a = ts[i];
    if (!v && a !== null) {
      out.push([a, ts[i]]);
      a = null;
    }
  });
  if (a !== null) out.push([a, ts[ts.length - 1]]);
  return out;
}

const PHEN_T: Record<Phen['kind'], (n: string) => string> = {
  TR: (n) => `${n}が本体の前に`,
  SH: (n) => `${n}の影が本体に`,
  OC: (n) => `${n}が本体の裏に`,
  EC: (n) => `${n}が木星の影に入る`,
};

function visibleAt(t: number, o = obs()): boolean {
  return sunAlt(t, o) < SUN_SET && altFast(E, t, o) > 5;
}

function buildNight(n0: number): Night {
  const o = obs();
  const step = 5 / 1440;
  const ts: number[] = [];
  const sun: number[] = [];
  const alt: number[] = [];
  for (let t = n0; t <= n0 + 1 + 1e-9; t += step) {
    ts.push(t);
    sun.push(sunAlt(t, o));
    alt.push(altFast(E, t, o));
  }
  const vis = runs(
    ts,
    ts.map((_, i) => sun[i] < SUN_SET && alt[i] > 0),
  );
  const fSun = (t: number) => sunAlt(t, o);
  const sunC = crossings(fSun, SUN_SET, n0, n0 + 1, 1 / 48);
  const darkC = crossings(fSun, SUN_DARK, n0, n0 + 1, 1 / 48);
  const jupC = crossings((t) => altFast(E, t, o), 0, n0, n0 + 1, 1 / 48);
  const sunset = sunC.find((c) => !c.up)?.t ?? n0 + 0.25;
  const sunrise = sunC.find((c) => c.up)?.t ?? n0 + 0.8;
  const hour = 1 / 24;
  const floorH = (t: number) => Math.floor((t + tzh() / 24) * 24) / 24 - tzh() / 24;
  const ceilH = (t: number) => Math.ceil((t + tzh() / 24) * 24) / 24 - tzh() / 24;
  let t0: number, t1: number;
  if (vis.length) {
    t0 = Math.max(floorH(sunset), floorH(vis[0][0]) - hour);
    t1 = Math.min(ceilH(sunrise), ceilH(vis[vis.length - 1][1] + hour));
    if (t1 - t0 < 6 * hour) {
      const c = (t0 + t1) / 2;
      t0 = floorH(c - 3 * hour);
      t1 = t0 + 6 * hour;
    }
  } else {
    t0 = floorH(sunset);
    t1 = ceilH(sunrise);
  }
  const inW = ts.map((t) => t >= t0 - step && t <= t1 + step);
  const dark = runs(
    ts.filter((_, i) => inW[i]),
    ts.map((_, i) => alt[i] <= 0 || sun[i] >= SUN_SET).filter((_, i) => inW[i]),
  );
  const twi = runs(
    ts.filter((_, i) => inW[i]),
    ts.map((_, i) => sun[i] < SUN_SET && sun[i] >= SUN_DARK).filter((_, i) => inW[i]),
  );
  const phen = findPhen(E, t0 - 0.25, t1 + 0.25, 5 / 1440);
  const grs = grsTransits(t0 - 0.1, t1 + 0.1);
  const mutual = findMutual(E, RADII, FLUX, t0, t1);
  /* 一覧 */
  const items: Item[] = [];
  const add = (t: number, text: string, dot = 'pn-ig', t1x?: number) => {
    if (t >= t0 && t <= t1) items.push({ t, text, dot, t1: t1x });
  };
  for (const c of jupC) add(c.t, c.up ? '木星が昇る' : '木星が沈む');
  for (const c of sunC) add(c.t, c.up ? '日の出' : '日の入り');
  for (const c of darkC) add(c.t, c.up ? '空が明るくなり始める' : '空が暗くなる');
  for (const tr of transits(M, t0, t1, o)) add(tr.t, `木星が南中（${tr.alt.toFixed(1)}°）`);
  for (const t of grs) add(t, '大赤斑が中央に来る', 'pn-igrs');
  for (const p of phen) {
    const t = Math.max(p.t0, t0);
    if (p.t1 < t0 || p.t0 > t1) continue;
    items.push({ t, t1: p.t1, text: PHEN_T[p.kind](NAMES[p.k]), dot: `pn-k${p.k + 1}` });
  }
  /* 影が 2 つ以上: 影の区間が重なり始める所 */
  const sh = phen.filter((p) => p.kind === 'SH');
  for (const a of sh)
    for (const b of sh) {
      if (a === b || b.t0 < a.t0 || b.t0 > a.t1) continue;
      add(b.t0, `${NAMES[b.k]}の影も入り、影が 2 つ`, `pn-k${b.k + 1}`, Math.min(a.t1, b.t1));
    }
  for (const m of mutual)
    add(
      m.t0,
      m.kind === 'occ'
        ? `${NAMES[m.a]}が${NAMES[m.b]}を隠す（相互食）`
        : `${NAMES[m.a]}の影が${NAMES[m.b]}に（相互食）`,
      `pn-k${m.a + 1}`,
      m.t1,
    );
  items.sort((a, b) => a.t - b.t);
  return { key: '', n0, t0, t1, phen, grs, dark, twi, items, mutual, vis };
}

function ensureNight(): Night {
  const n0 = nightStart(jd);
  const key = `${n0}|${picker.place.lat}|${picker.place.lon}|${tz$.value}|${grsOff}`;
  if (!night || night.key !== key) {
    night = buildNight(n0);
    night.key = key;
    bandKey = '';
    listKey = '';
    stripR = stripRange(night);
  }
  return night;
}

/** 衛星の並びの片側の広さ: 夜の間の衛星の離れの最大の 1.15 倍（赤道半径） */
function stripRange(n: Night): number {
  let mx = 6;
  for (let t = n.t0; t <= n.t1; t += 1 / 24) {
    const g = E.at(t);
    for (const m of g.moons) mx = Math.max(mx, Math.abs(skyOffset(g, m, M.re)[0]));
  }
  return mx * 1.15;
}

/* ---------- 今夜の帯 ---------- */
const band = $<SVGSVGElement>('#band');
let bandKey = '';
function drawBand(): void {
  const n = ensureNight();
  const rows = NAMES.length + 1;
  const ay = bandAxisY(rows);
  if (bandKey !== n.key) {
    bandKey = n.key;
    const ticks: { t: number; label: string }[] = [];
    const span = (n.t1 - n.t0) * 24;
    const every = span > 11 || band.clientWidth < 600 ? 2 : 1;
    for (let t = Math.ceil((n.t0 + tzh() / 24) * 24 - 1e-6) / 24 - tzh() / 24; t <= n.t1 + 1e-6; t += 1 / 24) {
      const h = Math.round(local(t).hour) % 24;
      if (h % every === 0) ticks.push({ t, label: `${h}:00` });
    }
    band.setAttribute('viewBox', `0 -24 ${BAND_W} ${ay + 48}`);
    band.innerHTML =
      nightBand({
        t0: n.t0,
        t1: n.t1,
        rows: NAMES,
        phen: n.phen,
        grs: n.grs,
        dark: n.dark,
        twi: n.twi,
        ticks,
      }) +
      `<path class="pn-cur" id="bcur" d=""></path><rect class="pn-tag" id="btag" y="-22" height="19" rx="3"></rect><text class="pn-tagt" id="btagt" y="-8"></text>`;
  }
  const x = ((jd - n.t0) / (n.t1 - n.t0)) * BAND_W;
  const inside = x >= 0 && x <= BAND_W;
  $('#bcur').setAttribute('d', inside ? `M${x.toFixed(1)} 2V${ay}` : '');
  const t = live ? `現在 ${hm(jd)}` : hm(jd);
  const tw = [...t].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 11.5 : 6.7), 14);
  const tx = Math.min(BAND_W - tw / 2, Math.max(tw / 2, x));
  const tag = $('#btag');
  tag.setAttribute('x', (tx - tw / 2).toFixed(1));
  tag.setAttribute('width', tw.toFixed(1));
  tag.style.display = inside ? '' : 'none';
  $('#btagt').setAttribute('x', tx.toFixed(1));
  $('#btagt').textContent = inside ? t : '';
  tag.classList.toggle('pn-on', live);
  $('#bcur').classList.toggle('pn-on', live);
  band.setAttribute('aria-valuenow', String(Math.round(x)));
  band.setAttribute('aria-valuetext', `${dateStr(jd)} ${hm(jd)}`);
}
function bandPick(e: PointerEvent): void {
  const n = ensureNight();
  const r = band.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  setJd(n.t0 + x * (n.t1 - n.t0));
}
band.addEventListener('pointerdown', (e) => {
  band.setPointerCapture(e.pointerId);
  bandPick(e);
  const mv = (ev: PointerEvent) => bandPick(ev);
  band.addEventListener('pointermove', mv);
  band.addEventListener('pointerup', () => band.removeEventListener('pointermove', mv), { once: true });
});
band.addEventListener('keydown', (e) => {
  const k = e.key;
  const d =
    k === 'ArrowRight'
      ? 1 / 144
      : k === 'ArrowLeft'
        ? -1 / 144
        : k === 'PageUp'
          ? 1 / 24
          : k === 'PageDown'
            ? -1 / 24
            : 0;
  if (!d) return;
  e.preventDefault();
  setJd(jd + d);
});

/* ---------- 主な日時 ---------- */
let keyKey = '';
let nextTwo: number | null | undefined;
let nextMut: number | null | undefined;
let nextOpp: number | undefined;
let keyJob = 0;
function nightLabel(n0: number): string {
  return `${md(n0 + 0.01)}〜${local(n0 + 1).day} の夜`;
}
function drawKeys(): void {
  const n = ensureNight();
  const key = `${n.key}`;
  if (keyKey !== key) {
    keyKey = key;
    nextTwo = undefined;
    nextMut = undefined;
    const job = ++keyJob;
    void searchKeys(n, job);
  }
  const ch: string[] = [
    `<button type="button" class="chip" data-d="-1">‹ 前の夜</button>`,
    `<span class="pn-night">${nightLabel(n.n0)}</span>`,
    `<button type="button" class="chip" data-d="1">次の夜 ›</button>`,
  ];
  const chip = (t: number | null | undefined, label: string, long = false) => {
    if (t === null) return;
    ch.push(
      t === undefined
        ? `<button type="button" class="chip" disabled>${label} <small>探しています…</small></button>`
        : `<button type="button" class="chip" data-j="${t}">${label} <small>${long ? `${local(t).year}/` : ''}${md(t)} ${hm(t)}</small></button>`,
    );
  };
  chip(nextTwo, '次の「影が 2 つ」');
  chip(nextMut, '次の相互食');
  if (nextOpp)
    ch.push(
      `<button type="button" class="chip" data-j="${nextOpp}">衝 <small>${local(nextOpp).year}/${md(nextOpp)}</small></button>`,
    );
  const html = ch.join('');
  const el = $('#keys');
  if (el.dataset.h !== html) {
    el.innerHTML = html;
    el.dataset.h = html;
  }
}
const idle = () => new Promise<void>((r) => setTimeout(r, 0));
/** 次の「影が 2 つ」（見える時間）と次の相互食（見える時間）、次の衝を、少しずつ探す */
async function searchKeys(n: Night, job: number): Promise<void> {
  const from = jd;
  const o = obs();
  if (!nextOpp || nextOpp < from || nextOpp - from > 410) nextOpp = opposition(from);
  /* 影が 2 つ: 夜ごとに影の区間を探し、重なりの始まりが見える時間にあるもの */
  let found: number | null = null;
  for (let k = 0; k < 120 && found === null; k++) {
    if (job !== keyJob) return;
    const a = n.n0 + k,
      b = a + 1;
    const ph = findPhen(E, a, b, 6 / 1440).filter((p) => p.kind === 'SH');
    for (const x of ph)
      for (const y of ph) {
        if (x === y || y.t0 < x.t0 || y.t0 > x.t1 || y.t0 <= from) continue;
        const s = y.t0;
        const e2 = Math.min(x.t1, y.t1);
        for (let t = s; t <= e2; t += 1 / 288)
          if (t > from && visibleAt(t, o) && (found === null || t < found)) {
            found = t;
            break;
          }
      }
    if (k % 4 === 3) await idle();
  }
  if (job !== keyJob) return;
  nextTwo = found;
  later();
  /* 相互食: 月ごとに探す（相互食の季節の図と同じ結果を使う） */
  let mf: number | null = null;
  for (let k = 0; k < 4 && mf === null; k++) {
    const ev = await mutualMonth(monthStart(from, k));
    if (job !== keyJob) return;
    const v = ev.find((x) => x.tm > from && visibleAt(x.tm, o));
    if (v) mf = v.tm;
  }
  nextMut = mf;
  later();
}
/** jd より後の衝（地心の離角が 180°） */
function opposition(from: number): number {
  const f = (t: number) => wrap180(E.slow(t).elong - 180);
  let a = from,
    fa = f(a);
  for (let k = 0; k < 420; k += 2) {
    const b = from + k + 2,
      fb = f(b);
    if (fa < 0 !== fb < 0 && Math.abs(fb - fa) < 30) {
      let lo = a,
        hi = b;
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (f(m) < 0 === fa < 0) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    }
    a = b;
    fa = fb;
  }
  return from + 400;
}
$('#nowbtn').addEventListener('click', () => {
  if (playing) stop();
  setJd(nowJd(), true);
  setLive(true);
});
$('#keys').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.chip');
  if (!b) return;
  if (b.dataset.d) setJd(jd + Number(b.dataset.d));
  else if (b.dataset.j) setJd(Number(b.dataset.j));
});
$('#tstep').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-s]');
  if (b) setJd(jd + Number(b.dataset.s) / 86400);
});

/* ---------- 再生 ---------- */
let playing = false;
let last = 0;
function stop(): void {
  playing = false;
  $('#play').setAttribute('aria-pressed', 'false');
  $('#playLed').classList.remove('on');
  txt('#playT', '再生');
}
$('#play').addEventListener('click', () => {
  if (playing) return stop();
  setLive(false);
  playing = true;
  last = performance.now();
  $('#play').setAttribute('aria-pressed', 'true');
  $('#playLed').classList.add('on');
  txt('#playT', '停止');
  later();
});

/* ---------- 今夜の現象 ---------- */
let listKey = '';
function drawList(): void {
  const n = ensureNight();
  const key = `${n.key}|${Math.floor(jd * 1440)}`;
  if (key === listKey) return;
  listKey = key;
  txt('#ev-aux', `${picker.place.name}で見える時刻`);
  if (!n.vis.length) {
    $('#evlist').innerHTML = '<li class="pn-none">この夜は木星が見えません。</li>';
    return;
  }
  $('#evlist').innerHTML = n.items
    .map((it, i) => {
      const end = it.t1 ?? it.t;
      const on = it.t1 !== undefined && jd >= it.t && jd <= end;
      const past = end < jd && !on;
      const sub =
        it.t1 !== undefined
          ? `<small>${Number.isFinite(it.t1) ? `${hm(it.t1)} まで` : ''}${on ? ` · いま ${hm(jd)}` : ''}</small>`
          : '';
      return `<li class="${on ? 'pn-on' : past ? 'pn-past' : ''}"><button type="button" data-i="${i}"><b>${hm(it.t)}</b><i class="${it.dot}"></i><span>${esc(it.text)}${sub}</span></button></li>`;
    })
    .join('');
}
$('#evlist').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-i]');
  const n = night;
  if (b && n) setJd(n.items[Number(b.dataset.i)].t + 1 / 1440);
});

/* ---------- 北から見た軌道 ---------- */
let topKey = '';
function drawTop(): void {
  const g = st.geo;
  const key = `${Math.round(jd * 1440)}`;
  if (key === topKey) return;
  topKey = key;
  const z = g.z;
  const te = toEarth(g);
  const ee = unit(sub(te, [dot(te, z) * z[0], dot(te, z) * z[1], dot(te, z) * z[2]]));
  const ex: Vec3 = [z[1] * ee[2] - z[2] * ee[1], z[2] * ee[0] - z[0] * ee[2], z[0] * ee[1] - z[1] * ee[0]];
  const p2d = (v: Vec3): [number, number] => [dot(v, ex), dot(v, ee)];
  const s = p2d(g.s);
  const sl = Math.hypot(...s);
  $('#top').innerHTML = orbitTop({
    moons: g.moons.map((m) => {
      const [x, y] = p2d(m);
      return [x / M.re, y / M.re];
    }),
    names: NAMES,
    orbits: ORBITS,
    sun: [s[0] / sl, s[1] / sl],
  });
}

/* ---------- 衛星の動き ---------- */
let wigKey = '';
let wigWin = { t0: 0, t1: 1 };
const wig = $<SVGSVGElement>('#wig');
function drawWiggle(): void {
  const days = Number(wr$.value);
  const n = ensureNight();
  const c0 = n.n0 + 0.5;
  const key = `${c0}|${days}|${tz$.value}|${n.key}`;
  if (key !== wigKey) {
    wigKey = key;
    const t0 = c0 - days,
      t1 = c0 + days;
    wigWin = { t0, t1 };
    const step = days === 1 ? 1 / 144 : days === 3 ? 1 / 72 : 1 / 36;
    const series: [number, number, boolean][][] = MOONS.map(() => []);
    for (let t = t0; t <= t1 + 1e-9; t += step) {
      const g = E.at(t);
      g.moons.forEach((m, k) => {
        const s = moonState(g, k);
        series[k].push([t, skyOffset(g, m, M.re)[0], s.oc || s.ec]);
      });
    }
    const dticks: { t: number; label: string }[] = [];
    for (let d = dayStart(t0) + 1; d < t1; d += 1) {
      if (days === 8 && Math.round(local(d + 0.01).day) % 2) continue;
      dticks.push({ t: d, label: md(d + 0.01) });
    }
    const o = obs();
    const marks: { t: number; x: number; label: string }[] = [];
    void mutualRange(t0, t1).then((ev) => {
      if (wigKey !== key) return;
      for (const m of ev) {
        if (!visibleAt(m.tm, o)) continue;
        const g = E.at(m.tm);
        marks.push({ t: m.tm, x: skyOffset(g, g.moons[m.b], M.re)[0], label: `相互食 ${md(m.tm)} ${hm(m.tm)}` });
      }
      wig.innerHTML = wiggle({ t0, t1, xMax: 28, series, days: dticks, marks });
      placeWigNow();
    });
    wig.innerHTML = wiggle({ t0, t1, xMax: 28, series, days: dticks, marks: [] });
    $('#wkey').innerHTML = NAMES.map(
      (nm, k) => `<span class="pn-k${k + 1}"><i class="pn-iln"></i>${esc(nm)}</span>`,
    ).join('');
  }
  placeWigNow();
}
function placeWigNow(): void {
  const { t0, t1 } = wigWin;
  const p = document.getElementById('wnow');
  const tt = document.getElementById('wnowt');
  if (!p || !tt) return;
  const y = WIG.top + ((jd - t0) / (t1 - t0)) * WIG.h;
  const inside = jd >= t0 && jd <= t1;
  p.setAttribute('d', inside ? `M0 ${y.toFixed(1)}H${WIG.w}` : '');
  tt.setAttribute('y', (y + 4).toFixed(1));
  tt.textContent = inside ? hm(jd) : '';
}
wig.addEventListener('click', (e) => {
  const pt = wig.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const m = wig.getScreenCTM();
  if (!m) return;
  const q = pt.matrixTransform(m.inverse());
  if (q.y < WIG.top || q.y > WIG.top + WIG.h) return;
  setJd(wiggleTime(wigWin, q.y));
});

/* ---------- 大赤斑が中央に来る時刻 ---------- */
let grsKey = '';
function drawGrs(): void {
  const n = ensureNight();
  const key = `${n.key}|${Math.floor(jd * 96)}`;
  if (key !== grsKey) {
    grsKey = key;
    const o = obs();
    txt('#grs-aux', `${picker.place.name}で見える夜だけ`);
    const rows: string[] = [];
    const ts = grsTransits(n.n0, n.n0 + 10);
    for (const t of ts) {
      const s = sunAlt(t, o);
      const a = altFast(E, t, o);
      if (s >= SUN_SET || a < 8) continue;
      const tags: string[] = [];
      if (a < 25) tags.push('低い');
      if (s > SUN_DARK) tags.push('薄明');
      else {
        const sa = sunAlt(t + 1 / 24, o);
        const sb = sunAlt(t - 1 / 24, o);
        if (sa > SUN_DARK && sa > s) tags.push('薄明の直前');
        else if (sb > SUN_DARK && sb > s) tags.push('暗くなった直後');
      }
      rows.push(
        `<tr class="${t < jd ? 'pn-past' : ''}"><td class="pn-t"><button type="button" data-j="${t}">${md(t)} ${hm(t)}</button></td><td><button type="button" data-j="${t}">${a.toFixed(0)}°</button></td><td><button type="button" data-j="${t}">${tags.map((x) => `<span class="pn-tag2">${x}</span>`).join(' ')}</button></td></tr>`,
      );
      if (rows.length >= 7) break;
    }
    $('#grs-rows').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3">見える夜がありません。</td></tr>';
  }
  const inp = $<HTMLInputElement>('#grs-l');
  if (document.activeElement !== inp) inp.value = `${grsAt(jd).toFixed(1)}°`;
  $('#grs-rst').hidden = grsOff === 0;
  txt(
    '#grs-note',
    grsOff
      ? `表の値から ${grsOff > 0 ? '+' : '−'}${Math.abs(grsOff).toFixed(1)}° 直した値`
      : jd > GRS_LAST_JD
        ? `${GRS_LAST.slice(0, 7)} の実測から外挿（月 ${GRS_RATE.toFixed(1)}°）· 自分の観測で直せる`
        : 'OPAL の地図と JUPOS の実測から補間 · 自分の観測で直せる',
  );
}
$('#grs-rows').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-j]');
  if (b) setJd(Number(b.dataset.j));
});
function setGrsOff(v: number): void {
  grsOff = Math.round(v * 10) / 10;
  if (grsOff) store('grsOff', grsOff);
  else store('grsOff', 0);
  resetNight();
  later(true);
}
$('#grs-l').addEventListener('change', (e) => {
  const v = Number.parseFloat((e.target as HTMLInputElement).value.replace(/[°\s]/g, '').replace('−', '-'));
  if (Number.isFinite(v)) setGrsOff(wrap180(v - grsL2(jd)));
});
$('#grs-rst').addEventListener('click', () => setGrsOff(0));

/* ---------- 相互食の季節 ---------- */
const mutCache = new Map<string, Promise<Mutual[]>>();
/** jd の月から k か月後の、表示の時刻帯の 1 日 0 時 */
function monthStart(t: number, k: number): number {
  const c = local(t);
  const m0 = c.month - 1 + k;
  const y = c.year + Math.floor(m0 / 12);
  return calToJd(y, (((m0 % 12) + 12) % 12) + 1, 1) - tzh() / 24;
}
/** 月ごとの相互食（地心。見えるかどうかは使う側で判定する） */
function mutualMonth(m0: number): Promise<Mutual[]> {
  const key = m0.toFixed(4);
  let p = mutCache.get(key);
  if (!p) {
    const m1 = monthStart(m0 + 1, 1);
    /* 1 週ずつ探し、間で描画を止めない */
    p = (async () => {
      const out: Mutual[] = [];
      for (let a = m0; a < m1; a += 7) {
        await idle();
        out.push(...findMutual(E, RADII, FLUX, a, Math.min(m1, a + 7)));
      }
      return out;
    })();
    mutCache.set(key, p);
  }
  return p;
}
async function mutualRange(t0: number, t1: number): Promise<Mutual[]> {
  const out: Mutual[] = [];
  for (let m = monthStart(t0, 0); m < t1; m = monthStart(m + 1, 1))
    out.push(...(await mutualMonth(m)).filter((x) => x.tm >= t0 && x.tm <= t1));
  return out;
}
let seaKey = '';
let seaShift = 0;
let seaEv: Mutual[] = [];
let seaSel = -1;
let seaWin = { d0: 0, d1: 1 };
function drawSeason(): void {
  const d0 = monthStart(jd, -1 + seaShift);
  const d1 = monthStart(jd, 1 + seaShift);
  const key = `${d0}|${mk$.value}|${picker.place.lat}|${picker.place.lon}|${tz$.value}`;
  if (key === seaKey) return;
  seaKey = key;
  seaWin = { d0, d1 };
  txt('#mut-range', `${local(d0 + 0.01).year}/${md(d0 + 0.01)}〜${md(d1 - 0.5)}`);
  const o = obs();
  void mutualRange(d0, d1).then((all) => {
    if (seaKey !== key) return;
    seaEv = all.filter((m) => (mk$.value === 'all' || m.kind === mk$.value) && visibleAt(m.tm, o));
    const next = seaEv.findIndex((m) => m.tm > jd - 0.02);
    seaSel = next >= 0 ? next : seaEv.length - 1;
    renderSeason();
    renderMutual();
  });
}
let seaVis: { d: number; a: number; b: number }[] = [];
let seaVisKey = '';
function renderSeason(): void {
  const { d0, d1 } = seaWin;
  const o = obs();
  const vk = `${d0}|${o.lat}|${o.lon}|${tz$.value}`;
  if (vk !== seaVisKey) {
    seaVisKey = vk;
    seaVis = [];
    for (let d = d0; d <= d1; d += 1) {
      const a0 = d + (18 - 0) / 24,
        step = 1 / 48;
      let a = 30,
        b = 18;
      for (let t = a0; t <= a0 + 0.5; t += step) {
        if (sunAlt(t, o) < SUN_SET && altFast(E, t, o) > 5) {
          const hr = 18 + (t - a0) * 24;
          a = Math.min(a, hr);
          b = Math.max(b, hr);
        }
      }
      seaVis.push({ d, a, b: a > b ? 18 : b });
    }
  }
  const ticks: { d: number; label: string }[] = [];
  for (let d = d0; d <= d1 + 0.5; d += 1) {
    const day = local(d + 0.01).day;
    if (day === 1 || day === 15) ticks.push({ d, label: md(d + 0.01) });
  }
  $('#sea').innerHTML = season({
    d0,
    d1,
    h0: 18,
    h1: 30,
    tz: tzh(),
    events: seaEv.map((m) => ({ t: m.tm, kind: m.kind, a: m.a, depth: m.depth })),
    vis: seaVis,
    ticks,
    today: nightStart(jd) - 0.5,
    sel: seaSel,
  });
}
function renderMutual(): void {
  const m = seaEv[seaSel];
  if (!m) {
    txt('#mut-h', 'この期間に見える相互食はありません');
    $('#mut-p').textContent = '相互食は、木星の春分・秋分の前後に地球と太陽が木星の赤道の面を通る季節に起きます。';
    $('#mut-curve').innerHTML = '';
    return;
  }
  const what = m.kind === 'occ' ? `${NAMES[m.a]}が${NAMES[m.b]}を隠す` : `${NAMES[m.a]}の影が${NAMES[m.b]}にかかる`;
  txt('#mut-h', `${md(m.t0)} ${hm(m.t0)}〜${hm(m.t1)} · ${what}`);
  $('#mut-p').innerHTML = `最大 ${hm(m.tm)} · 2 つの合計の光が <b>${Math.round(m.depth * 100)} %</b> 減る（概算）`;
  const dur = m.t1 - m.t0;
  const a = m.t0 - dur / 2,
    b = m.t1 + dur / 2;
  const pts: [number, number][] = [];
  for (let k = 0; k <= 80; k++) {
    const t = a + ((b - a) * k) / 80;
    const i = Math.min(m.a, m.b),
      j = Math.max(m.a, m.b);
    pts.push([t, pairFlux(E.at(t), RADII, FLUX, m.kind, i, j)]);
  }
  $('#mut-curve').innerHTML = lightCurve(pts, { t0: hm(m.t0), t1: hm(m.t1), lo: '' });
}
$('#sea').addEventListener('click', (e) => {
  const g = (e.target as Element).closest<SVGGElement>('.pn-ev');
  if (!g) return;
  seaSel = Number(g.dataset.i);
  const m = seaEv[seaSel];
  if (m) setJd(m.tm);
  renderSeason();
  renderMutual();
});
$('#sea').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const g = (e.target as Element).closest<SVGGElement>('.pn-ev');
  if (!g) return;
  e.preventDefault();
  (g as unknown as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
$('#mut-prev').addEventListener('click', () => {
  seaShift--;
  later(true);
});
$('#mut-next').addEventListener('click', () => {
  seaShift++;
  later(true);
});

/* ---------- 描く ---------- */
let lastNight = 0;
function frame(now: number): void {
  raf = 0;
  if (playing) {
    jd += ((now - last) / 86400000) * Number(sp$.value);
    last = now;
    raf = requestAnimationFrame(frame);
  }
  st = planetState(M, jd, obs());
  const want = wantMap();
  if (renderer && want.file !== mapWant) loadMap(want);
  const n = ensureNight();
  if (n.n0 !== lastNight) {
    lastNight = n.n0;
    seaShift = 0;
  }
  drawMain();
  drawStrip();
  drawNumbers();
  drawBand();
  drawKeys();
  drawList();
  drawTop();
  drawWiggle();
  if (full || !playing) {
    drawGrs();
    drawSeason();
  }
  full = false;
}
new ResizeObserver(() => later()).observe(view);

/* ---------- 始める ---------- */
try {
  renderer = new PlanetRenderer(canvas);
  /* 最新の地図を先に読み、日付に近い年の地図は後から読む */
  loadMap(MAPS[MAPS.length - 1]);
} catch {
  renderer = null;
  const m = $('#v-msg');
  m.hidden = false;
  m.textContent = 'このブラウザでは WebGL2 を使えないため、木星を描けません';
}
later(true);

/**
 * 木星のページ: 日時と観測地から木星と衛星の状態を計算し、望遠の図・衛星の並び・時刻の帯・すべての衛星・
 * 軌道・衛星の動き・相互食を描く
 */
import { calToJd, jdToCal } from '../../lib/astro/time';
import { dot, len, mul, sub, unit, type Vec3 } from '../../lib/astro/vec';
import { Choice } from '../../lib/choice';
import { $, esc } from '../../lib/dom';
import { cmFromNodeOfDate, Ephem, type Geo, type PlanetState, planetState } from '../../lib/planet/ephem';
import {
  findMutual,
  findPhen,
  limb,
  type Mutual,
  pairFlux,
  planetShadow,
  skyOffset,
  sunHidden,
  toEarth,
} from '../../lib/planet/events';
import {
  BAND_W,
  bandAxisY,
  bandRows,
  lightCurve,
  orbitTop,
  season,
  timeBand,
  WIG,
  wiggle,
  wiggleTime,
} from '../../lib/planet/figs';
import { type MoonTable, tablePos } from '../../lib/planet/moons';
import { PlanetRenderer } from '../../lib/planet/render';
import { SitePicker } from '../../lib/planet/site';
import { altFast, SUN_DARK, SUN_SET, sunAlt } from '../../lib/planet/sky';
import {
  edgeDir,
  facing,
  type MoonLook,
  type Orient,
  planetUniforms,
  screenOf,
  shadowPoint,
} from '../../lib/planet/view';
import { PanZoom } from '../../lib/planet/zoom';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { GRS_LAST, GRS_LAST_JD, grsL2, MAPS, type MapInfo, nearestMap } from './grs';
import { GM_JUP, INNER, innerPos, JUPITER_MODEL as M, MOONS, w1, w2 } from './model';

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
    txt('#hd-jup', `${picker.place.name}から見た木星`);
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
/** System II の自転の速さ [°/日] */
const RATE_II = 870.27;
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

/** 南中 t の前後で、大赤斑が中央子午線から 90° 離れる時刻（見え始めと見え終わり） */
function grsPass(t: number): { a: number; t: number; b: number } {
  const edge = (sign: number) => {
    const e = t + (sign * 90) / RATE_II;
    return e - (grsDelta(e) - sign * 90) / RATE_II;
  };
  return { a: edge(-1), t, b: edge(1) };
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
      v.textContent = '模様の地図を読み込めませんでした。';
    });
}

/* ---------- 望遠の図 ---------- */
const view = $('#pview');
const canvas = $<HTMLCanvasElement>('#pc');
interface Lay {
  W: number;
  H: number;
  rad: number;
  cx: number;
  cy: number;
}
const baseRad = (W: number, H: number) => 0.4 * Math.min(H, W / 1.6);
const pz = new PanZoom(canvas, {
  min: 0.4,
  max: 12,
  onChange: () => {
    $('#vreset').hidden = !pz.moved;
    txt('#vzoom', `×${pz.z.toFixed(pz.z < 2 ? 2 : 1)}`);
    later();
  },
});
function layout(): Lay {
  const W = view.clientWidth,
    H = view.clientHeight;
  return { W, H, rad: baseRad(W, H) * pz.z, cx: W / 2 + pz.x, cy: H / 2 + pz.y };
}
$('#vin').addEventListener('click', () => pz.zoomCenter(1.5));
$('#vout').addEventListener('click', () => pz.zoomCenter(1 / 1.5));
$('#vreset').addEventListener('click', () => pz.reset());

/** 衛星の状態（木星の前・木星の裏・影が木星に・木星の影の中） */
function moonState(g: Geo, k: number) {
  const m = g.moons[k];
  const [o, fo] = limb(g, M.re, M.rp, m, toEarth(g));
  const [s, fs] = limb(g, M.re, M.rp, m, g.s);
  return { tr: o < 0 && fo, oc: o < 0 && !fo, sh: s < 0 && fs, ec: s < 0 && !fs };
}

/** 衛星の明るさ: 木星の影と、ほかの衛星の影（中心で見積もる） */
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
  const edgeL: number[] = [];
  const edgeR: number[] = [];
  if (nm$.value === 'on') {
    MOONS.forEach((m, k) => {
      const [sx, sy, sz] = screenOf(M, st, mode, g.moons[k]);
      const px = L.cx + sx * L.rad,
        py = L.cy - sy * L.rad;
      const ms = moonState(g, k);
      const inBody = Math.hypot(sx, sy * (M.re / M.rp)) < 1;
      const note = ms.tr ? '木星の前' : ms.oc ? '木星の裏' : ms.ec ? '木星の影の中' : '';
      if (px >= 0 && px <= L.W && py >= 0 && py <= L.H) {
        const r = (m.r / M.re) * L.rad;
        const up = inBody && sz < 0;
        h.push(
          `<span class="pn-sl${up ? ' pn-up' : ''}" style="left:${px.toFixed(1)}px;top:${(up ? py - r - 4 : py + r + 4).toFixed(1)}px">${esc(m.name)}${note ? `<small>${note}</small>` : ''}</span>`,
        );
      } else if (Math.abs(py - L.cy) < L.H) {
        const sep = Math.hypot(...skyOffset(g, g.moons[k], M.re)) * rs;
        const { left, arrow } = edgeDir(px, py, L.W);
        /* 同じ側の札は重ならないよう、空いている上か下へずらす */
        const used = left ? edgeL : edgeR;
        const lo = 44,
          hi = L.H - 72;
        const base = Math.max(lo, Math.min(hi, py - 10));
        const top =
          Array.from({ length: L.H }, (_, i) => base + (i % 2 ? 2 : -2) * ((i + 1) >> 1)).find(
            (y) => y >= lo && y <= hi && !used.some((u) => Math.abs(u - y) < 34),
          ) ?? base;
        used.push(top);
        h.push(
          `<span class="pn-edge ${left ? 'pn-l' : 'pn-r'}" style="top:${top.toFixed(0)}px">${left ? `${arrow} ` : ''}${esc(m.name)}${left ? '' : ` ${arrow}`}<br>${dms(sep)}</span>`,
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
  h.push(...innerMarks(or$.value, L.cx, L.cy, L.rad, L.W, L.H, nm$.value === 'on' && L.W >= 640));
  $('#labs').innerHTML = h.join('');
  const fov = (L.W / L.rad) * rs;
  txt('#v-lab', `視野 ${(fov / 60).toFixed(1)}′`);
  txt('#v-lab2', bottomNote());
}

/** 内側の 4 個の丸と名前。木星の裏のものは出さない。名前は互いに重なるなら出さない */
function innerMarks(mode: Orient, cx: number, cy: number, rad: number, W: number, H: number, names: boolean): string[] {
  const g = st.geo;
  const out: string[] = [];
  const used: [number, number][] = [];
  /* 大きなものから名前を置く */
  for (const k of [2, 3, 0, 1]) {
    const [nm] = INNER[k];
    const v = mul(g.M, innerPos(k, g.jdTT - g.lt));
    const [sx, sy, sz] = screenOf(M, st, mode, v);
    if (sz > 0 && Math.hypot(sx, sy * (M.re / M.rp)) < 1) continue;
    const px = cx + sx * rad,
      py = cy - sy * rad;
    if (px < 0 || px > W || py < 0 || py > H) continue;
    out.push(`<span class="pn-sd pn-sm" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px"></span>`);
    /* 窓の端の札と重なる所には名前を出さない */
    if (!names || px < 130 || px > W - 130 || used.some(([a, b]) => Math.abs(a - px) < 56 && Math.abs(b - py) < 14))
      continue;
    used.push([px, py]);
    out.push(
      `<span class="pn-sl pn-si" style="left:${px.toFixed(1)}px;top:${(py + 4).toFixed(1)}px">${esc(nm)}</span>`,
    );
  }
  return out;
}

/** 窓の下の注記: 地平線の下、大赤斑の向き、模様の地図の年 */
function bottomNote(): string {
  const parts: string[] = [];
  if (st.alt < 0) parts.push(`地平線の下 ${minus(st.alt.toFixed(1))}°`);
  const [, ii] = cmNow();
  const dl = wrap180(grsAt(jd) - ii);
  parts.push(Math.abs(dl) < 90 ? `大赤斑 ${dl > 0 ? '西' : '東'} ${Math.abs(dl).toFixed(0)}°` : '大赤斑 裏側');
  if (mapOn) parts.push(`模様 ${mapOn.label}`);
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
  /* 細い帯に収めるため、向きの選択に依らず赤道を横にする */
  const mode: Orient = 'planet';
  const g = st.geo;
  /* 近くに衛星が集まる夜も、木星とその上の名前が帯に収まる広さにする */
  const R = Math.max(stripR, W / 2 / Math.max(10, H / 2 - 26));
  const k = W / 2 / R;
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
  /* 高さが足りないので、名前が横に重なる衛星は名前を上に出す */
  const below: number[] = [];
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
      const lx = Math.max(26, Math.min(W - 26, px)).toFixed(1);
      const up = !inBody && below.some((x) => Math.abs(x - px) < 50);
      if (!inBody && !up) below.push(px);
      h.push(
        inBody
          ? `<span class="pn-sl pn-up" style="left:${lx}px;top:${(H / 2 - rad - 6).toFixed(1)}px">${esc(m.name)}</span>`
          : `<span class="pn-sl${up ? ' pn-up' : ''}" style="left:${lx}px;top:${(up ? py - 8 : py + 8).toFixed(1)}px">${esc(m.name)}<small>${(sep / 60).toFixed(1)}′</small></span>`,
      );
    }
  });
  h.push(...innerMarks(mode, W / 2, H / 2, k, W, H, false));
  $('#slabs').innerHTML = h.join('');
  const fov = 2 * R * rs;
  txt('#s-lab', `視野 ${Math.round(fov / 60)}′ · 東が左`);
  const minPx = (60 / rs) * k;
  $('#s-scale').style.display = minPx < W * 0.3 ? '' : 'none';
  ($('#s-scale i') as HTMLElement).style.width = `${minPx.toFixed(1)}px`;
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

/* ---------- 夜 ---------- */
interface Night {
  key: string;
  n0: number;
}
let night: Night | null = null;
function resetNight(): void {
  night = null;
  span = null;
  wigKey = '';
  seaKey = '';
  keyKey = '';
  topKey = '';
  mutCache.clear();
}

function visibleAt(t: number, o = obs()): boolean {
  return sunAlt(t, o) < SUN_SET && altFast(E, t, o) > 5;
}

function ensureNight(): Night {
  const n0 = nightStart(jd);
  const key = `${n0}|${picker.place.lat}|${picker.place.lon}|${tz$.value}|${grsOff}`;
  if (!night || night.key !== key) {
    night = { key, n0 };
    stripR = stripRange(n0);
  }
  return night;
}

/** 衛星の並びの片側の広さ: その夜の 12 時間の衛星の離れの最大の 1.15 倍（赤道半径） */
function stripRange(n0: number): number {
  let mx = 6;
  for (let t = n0 + 0.2; t <= n0 + 0.8; t += 1 / 24) {
    const g = E.at(t);
    for (const m of g.moons) mx = Math.max(mx, Math.abs(skyOffset(g, m, M.re)[0]));
  }
  return mx * 1.15;
}

/* ---------- 時刻の帯 ---------- */
const band = $<SVGSVGElement>('#band');
/** 帯の中身は今の時刻の前後 1.6 日を先に作り、横に動かす。今の時刻が 0.9 日離れたら作り直す */
interface Span {
  key: string;
  anchor: number;
}
let span: Span | null = null;
const HALF = 1.6;
/** 帯の座標の幅（24 時間）。スマホでは実際の幅にして、文字を読める大きさに保つ */
let bandW = BAND_W;

/** 真の区間をつなぐ */
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

function buildBand(anchor: number): void {
  const o = obs();
  const t0 = anchor - HALF,
    t1 = anchor + HALF;
  const ts: number[] = [];
  const sun: number[] = [];
  const alt: number[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 144) {
    ts.push(t);
    sun.push(sunAlt(t, o));
    alt.push(altFast(E, t, o));
  }
  const ticks: { t: number; label: string }[] = [];
  const every = bandW < 600 ? 4 : 2;
  const first = Math.ceil((t0 + tzh() / 24) * 24) / 24 - tzh() / 24;
  for (let t = first; t <= t1; t += 1 / 24) {
    const hr = Math.round(local(t).hour) % 24;
    if (hr % every === 0) ticks.push({ t, label: hr === 0 ? md(t + 0.01) : `${hr}:00` });
  }
  const rows = NAMES.length + 1;
  const ay = bandAxisY(rows);
  band.setAttribute('viewBox', `0 -24 ${bandW} ${ay + 48}`);
  band.innerHTML =
    `<defs><clipPath id="bclip"><rect x="0" y="-24" width="${bandW}" height="${ay + 48}"></rect></clipPath></defs>` +
    `<g clip-path="url(#bclip)"><g id="bscroll">${timeBand({
      anchor,
      t0,
      t1,
      rows: NAMES,
      phen: findPhen(E, t0, t1, 5 / 1440),
      grs: grsTransits(t0 - 0.11, t1 + 0.11).map(grsPass),
      dark: runs(
        ts,
        ts.map((_, i) => alt[i] <= 0 || sun[i] >= SUN_SET),
      ),
      twi: runs(
        ts,
        ts.map((_, i) => sun[i] < SUN_SET && sun[i] >= SUN_DARK),
      ),
      ticks,
      w: bandW,
    })}</g></g>` +
    bandRows(NAMES, true) +
    `<path class="pn-cur" id="bcur" d="M${bandW / 2} 2V${ay}"></path><rect class="pn-tag" id="btag" y="-22" height="19" rx="3"></rect><text class="pn-tagt" id="btagt" x="${bandW / 2}" y="-8"></text>`;
}

function drawBand(): void {
  const cw = Math.round(band.clientWidth);
  bandW = cw > 0 && cw < 600 ? cw : BAND_W;
  const key = `${picker.place.lat}|${picker.place.lon}|${tz$.value}|${grsOff}|${bandW}`;
  if (!span || span.key !== key || Math.abs(jd - span.anchor) > 0.9) {
    span = { key, anchor: Math.round(jd * 4) / 4 };
    buildBand(span.anchor);
  }
  $('#bscroll').setAttribute('transform', `translate(${(bandW / 2 - (jd - span.anchor) * bandW).toFixed(2)} 0)`);
  const t = live ? `現在 ${md(jd)} ${hm(jd)}` : `${md(jd)} ${hm(jd)}`;
  const tw = [...t].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 11.5 : 6.7), 14);
  const tag = $('#btag');
  tag.setAttribute('x', (bandW / 2 - tw / 2).toFixed(1));
  tag.setAttribute('width', tw.toFixed(1));
  $('#btagt').textContent = t;
  tag.classList.toggle('pn-on', live);
  $('#bcur').classList.toggle('pn-on', live);
  band.setAttribute('aria-valuetext', `${dateStr(jd)} ${hm(jd)}`);
}
/* つかんで流す: 左へ動かすと時刻が進む。動かさずに離すと、押した所の時刻へ移る */
let bandDrag: { x: number; jd: number; moved: boolean } | null = null;
const bandX = (e: PointerEvent) => {
  const r = band.getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * bandW;
};
band.addEventListener('pointerdown', (e) => {
  band.setPointerCapture(e.pointerId);
  bandDrag = { x: bandX(e), jd, moved: false };
  if (playing) stop();
});
band.addEventListener('pointermove', (e) => {
  if (!bandDrag) return;
  const dx = bandX(e) - bandDrag.x;
  if (!bandDrag.moved && Math.abs(dx) < 4) return;
  bandDrag.moved = true;
  band.classList.add('drag');
  setJd(bandDrag.jd - dx / bandW);
});
const bandEnd = (e: PointerEvent) => {
  if (bandDrag && !bandDrag.moved && e.type === 'pointerup') setJd(jd + (bandX(e) - bandW / 2) / bandW);
  bandDrag = null;
  band.classList.remove('drag');
};
band.addEventListener('pointerup', bandEnd);
band.addEventListener('pointercancel', bandEnd);
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
function drawKeys(): void {
  const n = ensureNight();
  const key = `${n.key}`;
  /* 再生中は探さず、止めたときに探す */
  if (keyKey !== key && !playing) {
    keyKey = key;
    nextTwo = undefined;
    nextMut = undefined;
    const job = ++keyJob;
    void searchKeys(n, job);
  }
  const ch: string[] = [];
  const chip = (t: number | null | undefined, label: string, long = false) => {
    if (t === null) return;
    ch.push(
      t === undefined
        ? `<button type="button" class="chip" disabled>${label} <small>…</small></button>`
        : `<button type="button" class="chip" data-j="${t}">${label} <small>${long ? `${local(t).year}/` : ''}${md(t)} ${hm(t)}</small></button>`,
    );
  };
  chip(nextTwo, '影 2 つ');
  chip(nextMut, '相互食');
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
  if (b.dataset.j) setJd(Number(b.dataset.j));
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
  later(true);
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

/* ---------- すべての衛星 ---------- */
const aview = $('#aview');
const acv = $<HTMLCanvasElement>('#ac');
/** 群の色（黒い地の上で見分けられる明るさ） */
const GC = ['#ee8458', '#e8b52e', '#6cc37d', '#a9b6c0', '#5fb3e0', '#b394e0', '#e07aa8'];
let table: MoonTable | null = null;
let tableLoading = false;
let aVisible = false;
/** 押した・乗せた衛星の名前 */
let aSel = '';
interface Dot {
  name: string;
  g: number;
  d: number;
  x: number;
  y: number;
  sep: number;
}
let aDots: Dot[] = [];
const az = new PanZoom(acv, {
  min: 0.6,
  max: 120,
  onChange: () => {
    $('#areset').hidden = !az.moved;
    txt('#azoom', `×${az.z.toFixed(az.z < 10 ? 2 : 0)}`);
    drawAll();
  },
  onTap: (x, y) => pickDot(x, y),
});
$('#ain').addEventListener('click', () => az.zoomCenter(1.6));
$('#aout').addEventListener('click', () => az.zoomCenter(1 / 1.6));
$('#areset').addEventListener('click', () => az.reset());
function pickDot(x: number, y: number): void {
  let best = 16;
  let hit = '';
  for (const d of aDots) {
    const v = Math.hypot(d.x - x, d.y - y);
    if (v < best) {
      best = v;
      hit = d.name;
    }
  }
  aSel = hit;
  drawAll();
}
acv.addEventListener('pointermove', (e) => {
  if (e.buttons || e.pointerType !== 'mouse') return;
  const r = acv.getBoundingClientRect();
  pickDot(e.clientX - r.left, e.clientY - r.top);
});
new IntersectionObserver(
  (es) => {
    aVisible = es.some((x) => x.isIntersecting);
    if (aVisible) {
      void loadTable();
      drawAll();
    }
  },
  { rootMargin: '300px' },
).observe(aview);
async function loadTable(): Promise<void> {
  if (table || tableLoading) return;
  tableLoading = true;
  try {
    table = (await (await fetch(`${BASE}jupiter/moons.json`)).json()) as MoonTable;
    drawKey();
    drawAll();
  } catch {
    tableLoading = false;
  }
}
function drawKey(): void {
  if (!table) return;
  $('#akey').innerHTML = table.groups
    .map((nm, g) => `<span><i class="pn-gd" style="background:${GC[g]}"></i>${esc(nm)}</span>`)
    .join('');
  txt('#all-aux', `${table.moons.length + INNER.length + MOONS.length} 個`);
}
/** 目盛りの環の間隔 [″] の候補 */
const RINGS = [3600, 1800, 600, 300, 120, 60, 30, 10];
function ringLabel(as: number): string {
  return as >= 3600 ? `${as / 3600}°` : as >= 60 ? `${as / 60}′` : `${as}″`;
}
function drawAll(): void {
  if (!aVisible) return;
  const W = aview.clientWidth,
    H = aview.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (acv.width !== Math.round(W * dpr) || acv.height !== Math.round(H * dpr)) {
    acv.width = Math.round(W * dpr);
    acv.height = Math.round(H * dpr);
  }
  const c = acv.getContext('2d');
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  const g = st.geo;
  const mode = or$.value;
  /* 既定は木星から 3300 万 km までが窓の高さに入る大きさ */
  const pxRe = ((H / 2 / 33e6) * M.re * az.z) as number;
  const cx = W / 2 + az.x,
    cy = H / 2 + az.y;
  const rs = st.diam / 2;
  /* 目盛りの環 */
  const ppa = pxRe / rs;
  const step = RINGS.filter((a) => a * ppa >= 70).pop() ?? RINGS[0];
  c.strokeStyle = '#2b3237';
  c.fillStyle = '#6d777e';
  c.lineWidth = 1;
  c.font = '500 10.5px "Fira Mono", monospace';
  c.textAlign = 'left';
  const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  for (let k = 1; k * step * ppa < far && k < 60; k++) {
    const r = k * step * ppa;
    c.beginPath();
    c.arc(cx, cy, r, 0, 2 * Math.PI);
    c.stroke();
    c.fillText(ringLabel(k * step), cx + 4, cy - r - 3);
  }
  /* 衛星の位置 */
  const dots: Dot[] = [];
  const put = (name: string, gr: number, d: number, v: Vec3) => {
    const [sx, sy, sz] = screenOf(M, st, mode, v);
    if (sz > 0 && Math.hypot(sx, sy * (M.re / M.rp)) < 1) return;
    dots.push({ name, g: gr, d, x: cx + sx * pxRe, y: cy - sy * pxRe, sep: Math.hypot(sx, sy) * rs });
  };
  MOONS.forEach((m, k) => {
    put(m.name, 1, 2 * m.r, g.moons[k]);
  });
  const tl = g.jdTT - g.lt;
  INNER.forEach(([nm, d], k) => {
    put(nm, 0, d, mul(g.M, innerPos(k, tl)));
  });
  let outside = false;
  if (table) {
    table.moons.forEach((m, k) => {
      const p = table && tablePos(table, k, tl, GM_JUP);
      if (p) put(m.n, m.g, m.d, mul(g.M, p));
      else outside = true;
    });
  }
  aDots = dots;
  const m = $('#a-msg');
  m.hidden = !outside;
  if (outside) m.textContent = '外側の衛星は 2015〜2036 年だけ表示します。';
  /* 木星 */
  c.fillStyle = '#c9a77c';
  c.beginPath();
  c.arc(cx, cy, Math.max(3, pxRe), 0, 2 * Math.PI);
  c.fill();
  /* 大きな衛星が上に来るよう、小さなものから描く */
  const order = [...dots].sort((a, b) => a.d - b.d);
  for (const d of order) {
    if (d.x < -6 || d.x > W + 6 || d.y < -6 || d.y > H + 6) continue;
    c.fillStyle = GC[d.g];
    c.beginPath();
    c.arc(d.x, d.y, d.d > 1000 ? 3.4 : d.d > 20 ? 2.6 : 1.9, 0, 2 * Math.PI);
    c.fill();
  }
  /* 名前: 大きな衛星から置き、重なるものは出さない（拡大すると出る）。仮符号は拡大したときだけ。選んだ衛星はいつも出す */
  const sel = dots.find((d) => d.name === aSel);
  const boxes: [number, number, number, number][] = [
    [cx - Math.max(3, pxRe), cy - Math.max(3, pxRe), cx + Math.max(3, pxRe), cy + Math.max(3, pxRe)],
  ];
  c.font = '500 11px system-ui, sans-serif';
  c.textBaseline = 'middle';
  const pad = W < 640 ? 6 : 0;
  const label = (d: Dot, force: boolean) => {
    const w = c.measureText(d.name).width;
    const x0 = d.x + 6,
      x1 = x0 + w,
      y0 = d.y - 7,
      y1 = d.y + 7;
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) return;
    if (!force && boxes.some((b) => x0 - pad < b[2] && x1 + pad > b[0] && y0 - pad < b[3] && y1 + pad > b[1])) return;
    boxes.push([x0, y0, x1, y1]);
    c.fillStyle = force ? '#fff' : GC[d.g];
    c.fillText(d.name, x0, d.y);
  };
  if (sel) {
    c.strokeStyle = '#fff';
    c.beginPath();
    c.arc(sel.x, sel.y, 6, 0, 2 * Math.PI);
    c.stroke();
    label(sel, true);
  }
  if (nm$.value === 'on')
    for (const d of [...dots].sort((a, b) => b.d - a.d))
      if (d !== sel && (az.z >= 3 || !d.name.startsWith('S/'))) label(d, false);
  c.textBaseline = 'alphabetic';
  txt(
    '#a-info',
    sel
      ? `${sel.name} · ${table?.groups[sel.g] ?? ''} · ${sel.sep >= 3600 ? `${(sel.sep / 3600).toFixed(2)}°` : dms(sel.sep)}`
      : '',
  );
}

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
let wigBase = '';
let wigWin = { t0: 0, t1: 1 };
const wig = $<SVGSVGElement>('#wig');
function drawWiggle(): void {
  const days = Number(wr$.value);
  const n = ensureNight();
  const c0 = n.n0 + 0.5;
  const base = `${days}|${tz$.value}|${picker.place.lat}|${picker.place.lon}`;
  const key = `${c0}|${base}`;
  /* 再生中は、今の時刻が窓の中央から離れるまで作り直さない */
  const keep = playing && base === wigBase && Math.abs(jd - (wigWin.t0 + wigWin.t1) / 2) < days * 0.6;
  if (key !== wigKey && !keep) {
    wigKey = key;
    wigBase = base;
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
    const marks: { t: number; x: number }[] = [];
    void mutualRange(t0, t1).then((ev) => {
      if (wigKey !== key) return;
      for (const m of ev) {
        if (!visibleAt(m.tm, o)) continue;
        const g = E.at(m.tm);
        marks.push({ t: m.tm, x: skyOffset(g, g.moons[m.b], M.re)[0] });
      }
      wig.innerHTML = wiggle({ t0, t1, xMax: 28, series, days: dticks, marks });
      placeWigNow();
    });
    wig.innerHTML = wiggle({ t0, t1, xMax: 28, series, days: dticks, marks: [] });
    $('#wkey').innerHTML =
      NAMES.map((nm, k) => `<span class="pn-k${k + 1}"><i class="pn-iln"></i>${esc(nm)}</span>`).join('') +
      '<span><i class="pn-ibody"></i>木星</span><span><i class="pn-imk"></i>相互食</span>';
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

/* ---------- 大赤斑の経度 ---------- */
function drawGrs(): void {
  const inp = $<HTMLInputElement>('#grs-l');
  if (document.activeElement !== inp) inp.value = `${grsAt(jd).toFixed(1)}°`;
  $('#grs-rst').hidden = grsOff === 0;
  txt(
    '#grs-note',
    grsOff
      ? `補正 ${grsOff > 0 ? '+' : '−'}${Math.abs(grsOff).toFixed(1)}°`
      : jd > GRS_LAST_JD
        ? `${GRS_LAST.slice(0, 7)} から外挿`
        : '',
  );
}
function setGrsOff(v: number): void {
  grsOff = Math.round(v * 10) / 10;
  store('grsOff', grsOff);
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
    txt('#mut-h', 'この期間に見える相互食はありません。');
    $('#mut-p').textContent = '';
    $('#mut-curve').innerHTML = '';
    return;
  }
  const what = `${NAMES[m.a]}による${NAMES[m.b]}の${m.kind === 'occ' ? '掩蔽' : '食'}`;
  txt('#mut-h', what);
  $('#mut-p').innerHTML = `${md(m.t0)} ${hm(m.t0)}〜${hm(m.t1)} · 減光 <b>${Math.round(m.depth * 100)} %</b>（概算）`;
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
  drawAll();
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
txt('#hd-jup', `${picker.place.name}から見た木星`);
try {
  renderer = new PlanetRenderer(canvas);
  /* 最新の地図を先に読み、日付に近い年の地図は後から読む */
  loadMap(MAPS[MAPS.length - 1]);
} catch {
  renderer = null;
  const m = $('#v-msg');
  m.hidden = false;
  m.textContent = 'このブラウザでは木星を描けません。WebGL2 が必要です。';
}
later(true);

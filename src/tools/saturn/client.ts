/**
 * 土星のページ: 日時と観測地から土星と環と衛星の状態を計算し、望遠の図・衛星の並び・時刻の帯・すべての衛星・
 * 軌道・衛星の動き・タイタンの影の季節・環の傾きを描く
 */
import { calToJd, jdToCal } from '../../lib/astro/time';
import { dot, len, mul, sub, unit, type Vec3 } from '../../lib/astro/vec';
import { Choice } from '../../lib/choice';
import { DatePicker } from '../../lib/date-picker';
import { dateTimeToJd, secOfDay, toDateTime } from '../../lib/date-picker-core';
import { $, esc } from '../../lib/dom';
import { Ephem, type Geo, type PlanetState, planetState, toBody } from '../../lib/planet/ephem';
import { findPhen, limb, planetShadow, skyOffset, sunHidden, toEarth } from '../../lib/planet/events';
import { BAND_W, bandAxisY, bandRows, season, timeBand, WIG, wiggle, wiggleTime } from '../../lib/planet/figs';
import { type MoonTable, tablePos } from '../../lib/planet/moons';
import { PlanetRenderer } from '../../lib/planet/render';
import { SitePicker } from '../../lib/planet/site';
import { altFast, SUN_DARK, SUN_SET, sunAlt } from '../../lib/planet/sky';
import {
  basis,
  edgeDir,
  facing,
  type MoonLook,
  type Orient,
  planetUniforms,
  screenOf,
  shadowPoint,
} from '../../lib/planet/view';
import { PanZoom } from '../../lib/planet/zoom';
import { initToolPage } from '../../lib/tool-page';
import { orbitSat, TILT, tiltChart, tiltYear } from './figs';
import { GM_SAT, INNER, innerPos, SATURN_MODEL as M, MOONS, RE, RP, ringTilt } from './model';
import { PHOEBE } from './phoebe';
import { R0, R1, RING_N, ringSurge, ringTau } from './rings';
import { type Crossing, crossings, findPasses, type MoonPass, type TiltPoint, tiltAt, widest } from './season';

const BASE = import.meta.env.BASE_URL;
const E = new Ephem(M);
const NAMES = MOONS.map((m) => m.name);
const RADII = MOONS.map((m) => m.r);
/** 軌道の半径（赤道半径が単位。JPL の平均軌道要素の a）。ミマス〜イアペトゥスとフェーベ */
const ORBITS = [186000, 238400, 295000, 377700, 527200, 1221900, 1481500, 3561700, 12929400].map((a) => a / RE);
/** Minnaert の k（OPAL は 0.80・0.65・0.40。青は 395 nm の値なので、色を黄土色へ寄せた絵に合わせて弱める） */
const MINN: Vec3 = [0.8, 0.72, 0.62];
const GAIN = 1.2;
/** 環の明るさの倍率（環の表の色に掛ける） */
const RING_GAIN = 1.25;

const p2 = (n: number) => String(n).padStart(2, '0');
const txt = (id: string, s: string) => {
  const e = document.querySelector(id);
  if (e && e.textContent !== s) e.textContent = s;
};
const minus = (s: string) => s.replace(/-/g, '−');
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const nowJd = () => Date.now() / 86400000 + 2440587.5;
const wrap = (v: number) => ((v % 360) + 360) % 360;
const wrap180 = (v: number) => wrap(v + 180) - 180;

/* ---------- 表示の設定 ---------- */
const or$ = new Choice<Orient>($('#p-or'), () => later(true));
const nm$ = new Choice<'on' | 'off'>($('#p-nm'), () => later());
const sh$ = new Choice<'on' | 'off'>($('#p-sh'), () => later());
const tz$ = new Choice<'jst' | 'ut'>($('#p-tz'), () => {
  resetNight();
  later(true);
});
const sp$ = new Choice($('#p-sp'));
const wr$ = new Choice<'1' | '3' | '8'>($('#p-wr'), () => {
  wigKey = '';
  later(true);
});
const ts$ = new Choice<'2025' | '2038'>($('#p-ts'), () => {
  seaKey = '';
  later(true);
});
const tr$ = new Choice<'near' | 'all'>($('#p-tr'), () => {
  tiltKey = '';
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
const ymd = (jd: number) => {
  const c = local(jd);
  return `${c.year}-${p2(c.month)}-${p2(c.day)}`;
};
const dateStr = (jd: number) => `${ymd(jd)}（${WD[((Math.floor(jd + 1.5 + tzh() / 24) % 7) + 7) % 7]}）`;
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
const idle = () => new Promise<void>((r) => setTimeout(r, 0));

/* ---------- 観測地 ---------- */
const picker = new SitePicker(
  BASE,
  () => {
    txt('#hd-sat', `${picker.place.name}から見た土星`);
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

/* ---------- 環の表 ---------- */
let ringTab: Uint8Array | null = null;
/** 環の外縁までの半径（赤道半径） */
const RING_OUT = 136770 / RE;

/** 点 v（土星中心 [km]）から観測者へ向かう光が環を抜ける割合 */
function ringVeil(v: Vec3): number {
  if (!ringTab) return 1;
  const g = st.geo;
  const p = toBody(g, v);
  const f = toBody(g, unit(st.P));
  if (Math.abs(f[2]) < 1e-5) return 1;
  const t = -p[2] / f[2];
  if (t >= 0) return 1;
  const tau = ringTau(ringTab, Math.hypot(p[0] + t * f[0], p[1] + t * f[1]));
  return Math.exp(-tau / Math.abs(f[2]));
}

const ringU = (radPx: number) => ({
  r0: R0 / RE,
  r1: R1 / RE,
  gain: RING_GAIN,
  surge: ringSurge(st.phase),
  muMin: 1.1 / (RING_OUT * Math.max(1, radPx)),
});

/* ---------- 望遠の図 ---------- */
let renderer: PlanetRenderer | null = null;
const view = $('#pview');
const canvas = $<HTMLCanvasElement>('#pc');
interface Lay {
  W: number;
  H: number;
  rad: number;
  cx: number;
  cy: number;
}
/** 環の外縁まで窓に入る大きさ（視野は 1.5′ が目安） */
const baseRad = (W: number, H: number) => Math.min(W / 9.7, H * 0.42);
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

/** 衛星の状態（土星の前・土星の裏・影が土星に・土星の影の中） */
function moonState(g: Geo, k: number) {
  const m = g.moons[k];
  const [o, fo] = limb(g, RE, RP, m, toEarth(g));
  const [s, fs] = limb(g, RE, RP, m, g.s);
  return { tr: o < 0 && fo, oc: o < 0 && !fo, sh: s < 0 && fs, ec: s < 0 && !fs };
}

/** 衛星の明るさ: 土星の影と、ほかの衛星の影（中心で見積もる） */
function moonLooks(g: Geo): MoonLook[] {
  const ts = 695700 / (g.r * 149597870.7);
  return MOONS.map((m, k) => {
    let lit = 1 - planetShadow(g, RE, RP, k);
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

function drawMain(): void {
  if (!renderer) return;
  renderer.fit();
  const L = layout();
  const dpr = canvas.width / Math.max(1, L.W);
  const mode = or$.value;
  const g = st.geo;
  const u = planetUniforms(M, st, mode, moonLooks(g), {
    shift: 0,
    minn: MINN,
    gain: GAIN,
    shadows: sh$.value === 'on',
  });
  u.ring = ringU(L.rad * dpr);
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
  /* 丸と名前と影 */
  const h: string[] = [];
  const rs = st.diam / 2;
  const edgeL: number[] = [];
  const edgeR: number[] = [];
  /* 名前を置いた所（内側の小さな衛星の名前を重ねない） */
  const used: [number, number][] = [];
  /* 窓の中の衛星を先に置き、端の札はその名前を避ける */
  const inWindow = (k: number) => {
    const [sx, sy] = screenOf(M, st, mode, g.moons[k]);
    const px = L.cx + sx * L.rad,
      py = L.cy - sy * L.rad;
    return px >= 0 && px <= L.W && py >= 0 && py <= L.H;
  };
  const moonOrder = MOONS.map((_, k) => k).sort((a, b) => Number(inWindow(b)) - Number(inWindow(a)));
  moonOrder.forEach((k) => {
    const m = MOONS[k];
    const [sx, sy, sz] = screenOf(M, st, mode, g.moons[k]);
    const px = L.cx + sx * L.rad,
      py = L.cy - sy * L.rad;
    const ms = moonState(g, k);
    const r = (m.r / RE) * L.rad;
    const inside = px >= 0 && px <= L.W && py >= 0 && py <= L.H;
    const veil = ringVeil(g.moons[k]);
    /* 小さな衛星は円盤が 1 画素に満たないので、丸を重ねる */
    if (inside && r < 2.2 && !ms.oc && veil > 0.05)
      h.push(
        `<span class="pn-sd${ms.ec ? ' pn-dim' : ''}" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px;opacity:${veil.toFixed(2)}"></span>`,
      );
    if (nm$.value !== 'on') return;
    const inBody = Math.hypot(sx, sy * (RE / RP)) < 1;
    const note = ms.tr ? '土星の前' : ms.oc ? '土星の裏' : ms.ec ? '土星の影の中' : veil < 0.5 ? '環の裏' : '';
    if (inside) {
      const up = inBody && sz < 0;
      const ly = up ? py - r - 4 : py + Math.max(r, 2) + 4;
      used.push([px, ly]);
      h.push(
        `<span class="pn-sl${up ? ' pn-up' : ''}" style="left:${px.toFixed(1)}px;top:${ly.toFixed(1)}px">${esc(m.name)}${note ? `<small>${note}</small>` : ''}</span>`,
      );
    } else if (Math.abs(py - L.cy) < L.H) {
      const sep = Math.hypot(...skyOffset(g, g.moons[k], RE)) * rs;
      const { left, arrow } = edgeDir(px, py, L.W);
      /* 同じ側の札は重ならないよう、空いている上か下へずらす */
      const list = left ? edgeL : edgeR;
      const lo = 44,
        hi = L.H - 72;
      const base = Math.max(lo, Math.min(hi, py - 10));
      const top =
        Array.from({ length: L.H }, (_, i) => base + (i % 2 ? 2 : -2) * ((i + 1) >> 1)).find(
          (y) =>
            y >= lo &&
            y <= hi &&
            !list.some((v) => Math.abs(v - y) < 36) &&
            !used.some(([a, b]) => (left ? a < 110 : a > L.W - 110) && Math.abs(b - y - 14) < 28),
        ) ?? base;
      list.push(top);
      h.push(
        `<span class="pn-edge ${left ? 'pn-l' : 'pn-r'}" style="top:${top.toFixed(0)}px">${left ? `${arrow} ` : ''}${esc(m.name)}${left ? '' : ` ${arrow}`}<br>${dms(sep)}</span>`,
      );
    }
  });
  if (nm$.value === 'on' && sh$.value === 'on')
    MOONS.forEach((m, k) => {
      const p = shadowPoint(M, st, k);
      if (!p || !facing(st, p)) return;
      const [sx, sy] = screenOf(M, st, mode, p);
      const px = L.cx + sx * L.rad,
        py = L.cy - sy * L.rad;
      if (px < 0 || px > L.W || py < 0 || py > L.H) return;
      h.push(
        `<span class="pn-sl pn-sh" style="left:${px.toFixed(1)}px;top:${(py + (m.r / RE) * L.rad + 4).toFixed(1)}px">${esc(m.name)}の影</span>`,
      );
    });
  h.push(...innerMarks(mode, L.cx, L.cy, L.rad, L.W, L.H, nm$.value === 'on' && L.W >= 640 && pz.z >= 1, used));
  $('#labs').innerHTML = h.join('');
  const fov = (L.W / L.rad) * rs;
  txt('#v-lab', `視野 ${(fov / 60).toFixed(1)}′`);
  txt('#v-lab2', bottomNote());
}

/** 環のすぐ外の 15 個の丸と名前。土星の裏のものは出さない。名前は互いに重なるなら出さない */
function innerMarks(
  mode: Orient,
  cx: number,
  cy: number,
  rad: number,
  W: number,
  H: number,
  names: boolean,
  used: [number, number][],
): string[] {
  const g = st.geo;
  const out: string[] = [];
  /* 大きなものから名前を置く */
  const order = INNER.map((_, k) => k).sort((a, b) => INNER[b][1] - INNER[a][1]);
  for (const k of order) {
    const [nm] = INNER[k];
    const v = mul(g.M, innerPos(k, g.jdTT - g.lt));
    const [sx, sy, sz] = screenOf(M, st, mode, v);
    if (sz > 0 && Math.hypot(sx, sy * (RE / RP)) < 1) continue;
    const px = cx + sx * rad,
      py = cy - sy * rad;
    if (px < 0 || px > W || py < 0 || py > H) continue;
    const veil = ringVeil(v);
    out.push(
      `<span class="pn-sd pn-sm" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px;opacity:${veil.toFixed(2)}"></span>`,
    );
    /* 環の縁に沿う衛星は拡大するまで名前を出さない。土星の上と、窓の端の札と重なる所にも出さない */
    const hug = INNER[k][2] < 145000 && pz.z < 2.5;
    if (
      !names ||
      hug ||
      Math.hypot(sx, sy * (RE / RP)) < 1.1 ||
      px < 130 ||
      px > W - 130 ||
      used.some(([a, b]) => Math.abs(a - px) < 64 && Math.abs(b - py) < 16)
    )
      continue;
    used.push([px, py]);
    out.push(
      `<span class="pn-sl pn-si" style="left:${px.toFixed(1)}px;top:${(py + 4).toFixed(1)}px">${esc(nm)}</span>`,
    );
  }
  return out;
}

/** 窓の下の注記: 地平線の下、見えている環の面 */
function bottomNote(): string {
  const parts: string[] = [];
  if (st.alt < 0) parts.push(`地平線の下 ${minus(st.alt.toFixed(1))}°`);
  const { b, bs } = ringTilt(st.geo);
  const side = b >= 0 ? '北面' : '南面';
  parts.push(b * bs < 0 ? `環の${side} · 影の側` : `環の${side}`);
  return parts.join(' · ');
}

/* ---------- 衛星の並び ---------- */
const sview = $('#sview');
const scv = $<HTMLCanvasElement>('#sc');
const icon = document.createElement('canvas');
/** 並びの片側の広さ（赤道半径）。夜ごとに衛星の離れの最大から決める */
let stripR = 30;
/** その夜のレアまでの衛星の上下の離れの最大（赤道半径）。外の衛星は帯の端で止める */
let stripY = 3;
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
  /* 近くに衛星が集まる夜も、土星とその上の名前が帯に収まる広さにする */
  const R = Math.max(stripR, W / 2 / Math.max(10, H / 2 - 26), (stripY * W) / 2 / Math.max(10, H / 2 - 14));
  const k = W / 2 / R;
  const rad = k;
  if (renderer) {
    const n = Math.max(8, Math.round(rad * 2 * (RING_OUT + 0.2) * dpr));
    if (icon.width !== n) icon.width = icon.height = n;
    const u = planetUniforms(M, st, mode, moonLooks(g), {
      shift: 0,
      minn: MINN,
      gain: GAIN,
      shadows: sh$.value === 'on',
    });
    u.moons = [];
    u.ring = ringU(rad * dpr);
    renderer.icon(u, icon, rad * dpr);
    c.drawImage(icon, scv.width / 2 - n / 2, scv.height / 2 - n / 2);
  }
  const rs = st.diam / 2;
  const h: string[] = [];
  /* 高さが足りないので、名前が横に重なる衛星は名前を上に出す。上も重なるなら出さない */
  const below: [number, number][] = [];
  const above: [number, number][] = [];
  const hits = (list: [number, number][], x: number, w: number) =>
    list.some(([a, b]) => Math.abs(a - x) < (b + w) / 2 + 4);
  MOONS.forEach((m, i) => {
    const [sx, sy] = screenOf(M, st, mode, g.moons[i]);
    const px = W / 2 + sx * k;
    const pyTrue = H / 2 - sy * k;
    const py = Math.max(5, Math.min(H - 5, pyTrue));
    const clip = pyTrue < 5 ? ' pn-clipu' : pyTrue > H - 5 ? ' pn-clipd' : '';
    const ms = moonState(g, i);
    const inBody = Math.hypot(sx, sy) < 1.05;
    const inRing = Math.hypot(sx, sy) < RING_OUT && ringVeil(g.moons[i]) < 0.5;
    if (!inBody)
      h.push(
        `<span class="pn-sd${clip}${ms.oc || inRing ? ' pn-hid' : ms.ec ? ' pn-dim' : ''}" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px"></span>`,
      );
    if (nm$.value === 'on') {
      const sep = Math.hypot(...skyOffset(g, g.moons[i], RE)) * rs;
      const lx = Math.max(26, Math.min(W - 26, px)).toFixed(1);
      const w = m.name.length * 11.5;
      const up = py > H - 24 || (!inBody && hits(below, px, w) && py > 24);
      if (!inBody && hits(up ? above : below, px, w)) return;
      if (!inBody) (up ? above : below).push([px, w]);
      h.push(
        inBody
          ? `<span class="pn-sl pn-up" style="left:${lx}px;top:${(H / 2 - rad - 6).toFixed(1)}px">${esc(m.name)}</span>`
          : `<span class="pn-sl${up ? ' pn-up' : ''}" style="left:${lx}px;top:${(up ? py - 8 : py + 8).toFixed(1)}px">${esc(m.name)}<small>${(sep / 60).toFixed(1)}′</small></span>`,
      );
    }
  });
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
  const s = secOfDay(c.hour);
  txt('#clk', `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`);
  txt('#clkz', tzName());
  txt('#o-date', dateStr(jd));
  txt('#o-diam', `${st.diam.toFixed(1)}″ · ${(st.diam * RING_OUT).toFixed(1)}″`);
  txt('#o-mag', minus(st.mag.toFixed(2)));
  const { b, bs } = ringTilt(st.geo);
  txt('#o-tilt', `${signed(b)}° · ${signed(bs)}°`);
  txt('#o-altaz', `${minus(st.alt.toFixed(1))}° · ${st.az.toFixed(1)}°`);
  datePicker.sync();
}
const datePicker = new DatePicker($('#dp'), {
  get: () => toDateTime(local(jd)),
  set: (v) => setJd(dateTimeToJd(v, tzh())),
  today: () => local(nowJd()),
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
}

function visibleAt(t: number, o = obs()): boolean {
  return sunAlt(t, o) < SUN_SET && altFast(E, t, o) > 5;
}

function ensureNight(): Night {
  const n0 = nightStart(jd);
  const key = `${n0}|${picker.place.lat}|${picker.place.lon}|${tz$.value}`;
  if (!night || night.key !== key) {
    night = { key, n0 };
    stripRange(n0);
  }
  return night;
}

/** 衛星の並びの広さ: その夜の 12 時間の衛星の離れの最大の 1.15 倍（赤道半径） */
function stripRange(n0: number): void {
  let mx = 6,
    my = 2;
  for (let t = n0 + 0.2; t <= n0 + 0.8; t += 1 / 24) {
    const g = E.at(t);
    g.moons.forEach((m, k) => {
      const [x, y] = toPlanetXY(g, m);
      mx = Math.max(mx, Math.abs(x));
      if (k < 5) my = Math.max(my, Math.abs(y));
    });
  }
  stripR = mx * 1.15;
  stripY = my * 1.1;
}
/** 土星の北を上にした画面の位置（赤道半径） */
function toPlanetXY(g: Geo, v: Vec3): [number, number] {
  const b = basis({ ...st, geo: g, P: g.P }, 'planet');
  return [dot(v, b.r) / RE, dot(v, b.u) / RE];
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
  const ay = bandAxisY(NAMES.length);
  band.setAttribute('viewBox', `0 -24 ${bandW} ${ay + 48}`);
  band.innerHTML =
    `<defs><clipPath id="bclip"><rect x="0" y="-24" width="${bandW}" height="${ay + 48}"></rect></clipPath></defs>` +
    `<g clip-path="url(#bclip)"><g id="bscroll">${timeBand({
      anchor,
      t0,
      t1,
      rows: NAMES,
      phen: findPhen(E, t0, t1, 5 / 1440),
      grs: null,
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
    bandRows(NAMES, false) +
    `<path class="pn-cur" id="bcur" d="M${bandW / 2} 2V${ay}"></path><rect class="pn-tag" id="btag" y="-22" height="19" rx="3"></rect><text class="pn-tagt" id="btagt" x="${bandW / 2}" y="-8"></text>`;
}

function drawBand(): void {
  const cw = Math.round(band.clientWidth);
  bandW = cw > 0 && cw < 600 ? cw : BAND_W;
  const key = `${picker.place.lat}|${picker.place.lon}|${tz$.value}|${bandW}`;
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

/* ---------- 環の傾きの列 ---------- */
const TILT_J0 = calToJd(1900, 1, 1);
const TILT_J1 = calToJd(2101, 1, 1);
let tiltPts: TiltPoint[] = [];
let tiltCross: Crossing[] = [];
let tiltWide: TiltPoint[] = [];
let tiltReady = false;
let tiltStarted = false;
/** 1900〜2100 年の傾きを 15 日おきに、描画を止めないよう少しずつ求める */
async function loadTilt(): Promise<void> {
  if (tiltStarted) return;
  tiltStarted = true;
  const pts: TiltPoint[] = [];
  let t = TILT_J0;
  while (t <= TILT_J1) {
    const stop1 = performance.now() + 8;
    while (t <= TILT_J1 && performance.now() < stop1) {
      pts.push(tiltAt(t));
      t += 15;
    }
    await idle();
  }
  tiltPts = pts;
  tiltCross = crossings(pts);
  await idle();
  tiltWide = widest(pts, tiltCross);
  tiltReady = true;
  keyKey = '';
  tiltKey = '';
  later(true);
}

/* ---------- 主な日時 ---------- */
let keyKey = '';
let nextOpp: number | undefined;
let nextTitan: number | null | undefined;
let keyJob = 0;
function drawKeys(): void {
  const n = ensureNight();
  const key = `${n.key}|${tiltReady}`;
  /* 再生中は探さず、止めたときに探す */
  if (keyKey !== key && !playing) {
    keyKey = key;
    nextTitan = undefined;
    void searchKeys(++keyJob);
  }
  const ch: string[] = [];
  const chip = (t: number | null | undefined, label: string) => {
    if (t === null) return;
    ch.push(
      t === undefined
        ? `<button type="button" class="chip" disabled>${label} <small>…</small></button>`
        : `<button type="button" class="chip" data-j="${t}">${label} <small>${local(t).year}/${md(t)}</small></button>`,
    );
  };
  chip(nextOpp, '衝');
  chip(tiltReady ? (tiltWide.find((p) => p[0] > jd)?.[0] ?? null) : undefined, '環の開きが最大');
  chip(tiltReady ? (tiltCross.find((c) => c.who === 'earth' && c.t > jd)?.t ?? null) : undefined, '次に環が真横');
  chip(nextTitan, 'タイタンの影');
  const html = ch.join('');
  const el = $('#keys');
  if (el.dataset.h !== html) {
    el.innerHTML = html;
    el.dataset.h = html;
  }
}
/** 次の衝と、次のタイタンの影を探す */
async function searchKeys(job: number): Promise<void> {
  const from = jd;
  if (!nextOpp || nextOpp < from || nextOpp - from > 400) nextOpp = opposition(from);
  later();
  void loadTilt();
  if (!tiltReady) return;
  /* タイタンの影は環が真横に近い年だけなので、太陽が次に環の面を横切る時の前後を探す。見えるかどうかは問わない */
  const edge = tiltCross.find((c) => c.who === 'sun' && c.t > from - 500);
  if (!edge) {
    nextTitan = null;
    later();
    return;
  }
  let found: number | null = null;
  for (let a = Math.max(from, edge.t - 700); a < edge.t + 700 && found === null; a += 30) {
    if (job !== keyJob) return;
    for (const p of findPasses(E, 5, a, a + 30)) {
      if (p.kind === 'SH' && p.t0 > from) {
        found = (p.t0 + p.t1) / 2;
        break;
      }
    }
    await idle();
  }
  if (job !== keyJob) return;
  nextTitan = found;
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
const GC = ['#ee8458', '#e8b52e', '#6cc37d', '#b394e0', '#5fb3e0'];
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
    table = (await (await fetch(`${BASE}saturn/moons.json`)).json()) as MoonTable;
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
  /* 既定は土星から 2700 万 km までが窓の高さに入る大きさ */
  const pxRe = ((H / 2 / 27e6) * RE * az.z) as number;
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
    if (sz > 0 && Math.hypot(sx, sy * (RE / RP)) < 1) return;
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
      const p = table && tablePos(table, k, tl, GM_SAT);
      if (p) put(m.n, m.g, m.d, mul(g.M, p));
      else outside = true;
    });
  }
  aDots = dots;
  const m = $('#a-msg');
  m.hidden = !outside;
  if (outside) m.textContent = '外側の衛星は 2015〜2036 年だけ表示します。';
  /* 土星 */
  c.fillStyle = '#d8c79c';
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
/** 表の範囲で切らないフェーベの位置 */
const phoebeTable: MoonTable = {
  t0: PHOEBE.t0,
  dt: PHOEBE.dt,
  n: PHOEBE.n,
  groups: [],
  moons: [{ n: '', g: 0, d: 0, s: PHOEBE.s.map((v, i) => (i % 6 < 3 ? v * 10 : v / 10)) }],
};
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
  const ph = tablePos(phoebeTable, 0, g.jdTT - g.lt, GM_SAT);
  const vs: Vec3[] = [...g.moons, ph ? mul(g.M, ph) : [ORBITS[8] * RE, 0, 0]];
  /* 外の 4 個と、土星の影の帯の中にいる衛星に名前を付ける */
  const names = vs.map((_, k) => {
    if (k === 8) return 'フェーベ';
    if (k >= 5) return NAMES[k];
    return moonState(g, k).ec ? NAMES[k] : '';
  });
  $('#top').innerHTML = orbitSat({
    moons: vs.map((m) => {
      const [x, y] = p2d(m);
      return [x / RE, y / RE];
    }),
    names,
    orbits: ORBITS,
    dashed: [7, 8],
    sun: [s[0] / sl, s[1] / sl],
    ring: [R0 / RE, RING_OUT],
  });
}
$('#tkey').innerHTML = [
  ...NAMES.map((nm, k) => `<span class="pn-k${k + 1}"><i class="pn-idot2"></i>${esc(nm)}</span>`),
  '<span class="pn-kx"><i class="pn-idot2"></i>フェーベ</span>',
].join('');

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
        series[k].push([t, skyOffset(g, m, RE)[0], s.oc || s.ec]);
      });
    }
    const dticks: { t: number; label: string }[] = [];
    for (let d = dayStart(t0) + 1; d < t1; d += 1) {
      if (days === 8 && Math.round(local(d + 0.01).day) % 2) continue;
      dticks.push({ t: d, label: md(d + 0.01) });
    }
    wig.innerHTML = wiggle({ t0, t1, xMax: 30, series, days: dticks, marks: [], ring: RING_OUT });
    $('#wkey').innerHTML =
      NAMES.map((nm, k) => `<span class="pn-k${k + 1}"><i class="pn-iln"></i>${esc(nm)}</span>`).join('') +
      '<span><i class="pn-ibody"></i>土星と環</span>';
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

/* ---------- タイタンの影の季節 ---------- */
/** 見える間の始まりと終わり（見えなければ null） */
function visibleSpan(p: MoonPass, o = obs()): [number, number] | null {
  let a: number | null = null,
    b: number | null = null;
  for (let t = p.t0; t <= p.t1; t += 1 / 96) {
    if (visibleAt(t, o)) {
      if (a === null) a = t;
      b = t;
    }
  }
  return a === null || b === null ? null : [a, b];
}
const SEASONS = {
  '2025': { d0: calToJd(2024, 6, 1), d1: calToJd(2026, 2, 15) },
  '2038': { d0: calToJd(2038, 6, 1), d1: calToJd(2039, 9, 15) },
};
/** 図の縦の範囲（表示の時刻帯の 0 時からの時間。正午から次の正午まで） */
const SEA_H0 = 12;
const SEA_H1 = 36;
const passCache = new Map<string, Promise<MoonPass[]>>();
function seasonPasses(id: '2025' | '2038'): Promise<MoonPass[]> {
  let p = passCache.get(id);
  if (!p) {
    const { d0, d1 } = SEASONS[id];
    p = (async () => {
      const out: MoonPass[] = [];
      for (let a = d0; a < d1; a += 30) {
        await idle();
        out.push(...findPasses(E, 5, a, Math.min(d1, a + 30)));
      }
      /* 月の境をまたいだ通過をつなぐ */
      const joined: MoonPass[] = [];
      for (const x of out.sort((u, v) => u.t0 - v.t0)) {
        const y = joined.find((z) => z.kind === x.kind && Math.abs(z.t1 - x.t0) < 1e-6);
        if (y) y.t1 = x.t1;
        else joined.push({ ...x });
      }
      return joined;
    })();
    passCache.set(id, p);
  }
  return p;
}
let seaKey = '';
/** tm は見える間の中央（見えなければ通過の中央）、vis は見える時間 [時] */
let seaEv: (MoonPass & { tm: number; vis: number })[] = [];
let seaSel = -1;
let seaVis: { d: number; a: number; b: number }[] = [];
function drawSeason(): void {
  const id = ts$.value;
  const key = `${id}|${picker.place.lat}|${picker.place.lon}|${tz$.value}`;
  if (key === seaKey) return;
  seaKey = key;
  const o = obs();
  const { d0, d1 } = SEASONS[id];
  void seasonPasses(id).then((all) => {
    if (seaKey !== key) return;
    seaEv = all.map((p) => {
      const v = visibleSpan(p, o);
      return { ...p, tm: v ? (v[0] + v[1]) / 2 : (p.t0 + p.t1) / 2, vis: v ? (v[1] - v[0]) * 24 : 0 };
    });
    const isShadow = (e: { kind: string }) => e.kind === 'SH';
    const firstVisible = seaEv.findIndex((e) => isShadow(e) && e.vis > 0);
    seaSel = firstVisible >= 0 ? firstVisible : seaEv.findIndex(isShadow);
    /* 見える時間（3 日おき） */
    seaVis = [];
    for (let d = d0; d <= d1; d += 3) {
      const a0 = dayStart(d) + SEA_H0 / 24;
      let a = SEA_H1,
        b = SEA_H0;
      for (let t = a0; t <= a0 + 1; t += 1 / 48) {
        if (sunAlt(t, o) < SUN_SET && altFast(E, t, o) > 5) {
          const hr = SEA_H0 + (t - a0) * 24;
          a = Math.min(a, hr);
          b = Math.max(b, hr);
        }
      }
      seaVis.push({ d: dayStart(d), a, b: a > b ? SEA_H0 : b });
    }
    renderSeason();
    renderTitan();
  });
}
function renderSeason(): void {
  const { d0, d1 } = SEASONS[ts$.value];
  const ticks: { d: number; label: string }[] = [];
  const c0 = local(d0);
  const months = Math.ceil((d1 - d0) / 30.4);
  const stepM = months > 16 ? 4 : 2;
  for (let k = 0; k <= months; k += stepM) {
    const m0 = c0.month - 1 + k;
    const y = c0.year + Math.floor(m0 / 12);
    const mo = ((m0 % 12) + 12) % 12;
    const d = calToJd(y, mo + 1, 1) - tzh() / 24;
    if (d <= d1) ticks.push({ d, label: mo === 0 || k === 0 ? `${y}/${mo + 1}` : `${mo + 1}月` });
  }
  $('#sea').innerHTML = season({
    d0,
    d1,
    h0: SEA_H0,
    h1: SEA_H1,
    tz: tzh(),
    events: seaEv.map((e) => ({
      t: e.tm,
      kind: e.kind === 'SH' ? ('occ' as const) : ('ecl' as const),
      a: 5,
      depth: e.vis > 0 ? 0.25 : 0,
    })),
    vis: seaVis,
    ticks,
    today: nightStart(jd) - 0.5,
    sel: seaSel,
  });
}
function renderTitan(): void {
  const e = seaEv[seaSel];
  const count = (kind: string) => {
    const v = seaEv.filter((x) => x.kind === kind);
    return `<b>${v.filter((x) => x.vis > 0).length}</b> / ${v.length} 回`;
  };
  $('#tit-c').innerHTML = `${esc(picker.place.name)}で見える<br>影 ${count('SH')} · 通過 ${count('TR')}`;
  if (!e) {
    txt('#tit-h', '');
    txt('#tit-p', '');
    return;
  }
  txt('#tit-h', `${e.kind === 'SH' ? 'タイタンの影' : 'タイタンの通過'} ${ymd(e.t0)}`);
  txt('#tit-p', `${hm(e.t0)}〜${hm(e.t1)} · ${e.vis > 0 ? `見える ${e.vis.toFixed(1)} 時間` : '見えない'}`);
}
$('#sea').addEventListener('click', (e) => {
  const g = (e.target as Element).closest<SVGGElement>('.pn-ev');
  if (!g) return;
  seaSel = Number(g.dataset.i);
  const m = seaEv[seaSel];
  if (m) setJd(m.tm);
  renderSeason();
  renderTitan();
});
$('#sea').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const g = (e.target as Element).closest<SVGGElement>('.pn-ev');
  if (!g) return;
  e.preventDefault();
  (g as unknown as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

/* ---------- 環の傾き ---------- */
let tiltKey = '';
let tiltWin = { y0: 1900, y1: 2101 };
const yearOf = (t: number) => 2000 + (t - 2451544.5) / 365.25;
const tilt = $<SVGSVGElement>('#tilt');
let tiltVisible = false;
new IntersectionObserver(
  (es) => {
    tiltVisible = es.some((x) => x.isIntersecting);
    if (tiltVisible) {
      void loadTilt();
      later(true);
    }
  },
  { rootMargin: '300px' },
).observe(tilt);
function drawTilt(): void {
  if (!tiltReady || !tiltVisible) return;
  const key = `${tr$.value}|${tz$.value}`;
  if (key !== tiltKey) {
    tiltKey = key;
    tiltWin = tr$.value === 'near' ? { y0: 2020, y1: 2045 } : { y0: 1900, y1: 2101 };
    tilt.innerHTML = tiltChart({
      ...tiltWin,
      pts: tiltPts.map((p) => [yearOf(p[0]), p[1], p[2]]),
      every: tr$.value === 'near' ? 5 : 50,
      marks: tiltCross.filter((c) => c.who === 'earth').map((c) => yearOf(c.t)),
    });
    renderCross();
  }
  const y = yearOf(jd);
  const inside = y >= tiltWin.y0 && y <= tiltWin.y1;
  const x = ((y - tiltWin.y0) / (tiltWin.y1 - tiltWin.y0)) * TILT.w;
  document.getElementById('tnow')?.setAttribute('d', inside ? `M${x.toFixed(1)} 0V${TILT.h}` : '');
  const tt = document.getElementById('tnowt');
  if (tt) {
    tt.setAttribute('x', Math.max(30, Math.min(TILT.w - 30, x)).toFixed(1));
    tt.textContent = inside ? `${signed(ringTilt(st.geo).b)}°` : '';
  }
}
/** 今の前後の環の面の通過の一覧（前の季節と次の季節） */
function renderCross(): void {
  const i = tiltCross.findIndex((c) => c.t > jd);
  const list = tiltCross.slice(Math.max(0, i - 2), i + 5);
  $('#tilt-list').innerHTML = `<h3>環の面の通過</h3>${list
    .map(
      (c) =>
        `<button type="button" class="pn-crow" data-j="${c.t}"><b>${ymd(c.t)}</b><span class="${c.who === 'earth' ? 'pn-kte' : 'pn-kts'}">${c.who === 'earth' ? '地球' : '太陽'}</span></button>`,
    )
    .join('')}`;
}
$('#tilt-list').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.pn-crow');
  if (b?.dataset.j) setJd(Number(b.dataset.j));
});
tilt.addEventListener('click', (e) => {
  const pt = tilt.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const m = tilt.getScreenCTM();
  if (!m) return;
  const q = pt.matrixTransform(m.inverse());
  if (q.x < 0 || q.x > TILT.w) return;
  setJd(2451544.5 + (tiltYear(tiltWin, q.x) - 2000) * 365.25);
});

/* ---------- 描く ---------- */
function frame(now: number): void {
  raf = 0;
  if (playing) {
    jd += ((now - last) / 86400000) * Number(sp$.value);
    last = now;
    raf = requestAnimationFrame(frame);
  }
  st = planetState(M, jd, obs());
  ensureNight();
  drawMain();
  drawStrip();
  drawNumbers();
  drawBand();
  drawKeys();
  drawAll();
  drawTop();
  drawWiggle();
  drawTilt();
  if (full || !playing) drawSeason();
  full = false;
}
new ResizeObserver(() => later()).observe(view);

/* ---------- 始める ---------- */
txt('#hd-sat', `${picker.place.name}から見た土星`);
const busy = $('#v-busy');
/** 読み終えていないもの（模様と環の表） */
let loading = 2;
const loaded = () => {
  busy.hidden = --loading === 0;
};
try {
  renderer = new PlanetRenderer(canvas, { rings: true });
  const r = renderer;
  r.load(`${BASE}saturn/s2025a.webp`)
    .then(() => later(true))
    .catch(() => {
      const v = $('#v-msg');
      v.hidden = false;
      v.textContent = '模様を読み込めませんでした。';
    })
    .finally(loaded);
  fetch(`${BASE}saturn/rings.bin`)
    .then((x) => x.arrayBuffer())
    .then((b) => {
      ringTab = new Uint8Array(b);
      r.loadRings(ringTab, RING_N);
      later(true);
    })
    .catch(() => {
      const v = $('#v-msg');
      v.hidden = false;
      v.textContent = '環の表を読み込めませんでした。';
    })
    .finally(loaded);
} catch {
  renderer = null;
  busy.hidden = true;
  const m = $('#v-msg');
  m.hidden = false;
  m.textContent = 'このブラウザでは土星を描けません。WebGL2 が必要です。';
}
later(true);

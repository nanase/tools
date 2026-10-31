/**
 * 日食のページの入口: 日食（NASA のベッセル要素）と観測地 → 地方食 → 空・太陽・地図・地球・予報・一覧・サロス系列
 */

import { observerXYZ } from '../../lib/astro/earth';
import { deltaTSigma, jdToCal } from '../../lib/astro/time';
import { Choice } from '../../lib/choice';
import { $, esc, norm } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import type { Entry } from './catalog';
import * as data from './data';
import { drawGlobe, viewDir } from './draw-globe';
import { drawMap, type LatLon, MAP_STYLE } from './draw-map';
import { drawSky, makeCorona, SunPainter } from './draw-sky';
import { D2R, equalEarth, equirect, orthographic, type Projection } from './geo';
import { type LandMask, landMask, type Rings } from './land';
import {
  disksOf,
  type Geom,
  geomAt,
  HORIZON,
  type Local,
  localCircumstances,
  overlapFraction,
  type Site,
} from './local';
import { type Key, PARAMS } from './params';
import { centralPoint, limitPoint, trace } from './path';
import { fluxLUT, residualFlux, snapAt } from './shade';
import { activityOf, sunAxisPA } from './solar';

const R2D = 180 / Math.PI;
const txt = (id: string, s: string) => {
  const e = $(id);
  if (e.textContent !== s) e.textContent = s;
};
const p2 = (n: number) => String(n).padStart(2, '0');

initToolPage();

/* ---------- 観測地 ---------- */
interface Place {
  name: string;
  sub: string;
  lat: number;
  lon: number;
  h: number;
}
const TOKYO: Place = { name: '東京', sub: '東京都庁', lat: 35.6895, lon: 139.6917, h: 0 };
const okPlace = (v: unknown): v is Place => {
  const p = v as Place;
  return (
    !!p &&
    typeof p.name === 'string' &&
    [p.lat, p.lon, p.h].every((x) => typeof x === 'number' && Number.isFinite(x)) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
};
let site: Place = okPlace(stored('site')) ? (stored('site') as Place) : TOKYO;
const siteRad = (): Site => ({ lat: site.lat * D2R, lon: site.lon * D2R, h: site.h });

/* ---------- 選択肢 ---------- */
const tz$ = new Choice<'jst' | 'ut'>($('#p-tz'), () => {
  dirty.curve = dirty.out = dirty.list = true;
  later();
});
const zm$ = new Choice($('#p-zm'), () => {
  dirty.sky = true;
  later();
});
const sp$ = new Choice($('#p-sp'));
const view$ = new Choice<'l1' | 'geo' | 'moon'>($('#p-view'), () => {
  gOff = [0, 0];
  dirty.globe = true;
  later();
});
const sm$ = new Choice<'all' | 'one'>($('#p-sm'), () => drawSarosPaths());
const fk$ = new Choice<'y' | 's'>($('#p-fk'), () => runFind());

/* 緯度・経度・標高: 行で変えたら「指定した地点」にする。値は観測地として保存するので、行では保存しない */
const G = new ParamGroup<Key>(
  PARAMS.map((d) => ({ ...d, v: d.k === 'lat' ? TOKYO.lat : d.k === 'lon' ? TOKYO.lon : 0 })),
  (v, k) => {
    if (!k) return;
    // 既定値（東京）に戻したときは東京にする
    const tokyo = v.lat === TOKYO.lat && v.lon === TOKYO.lon;
    setSite(tokyo ? { ...TOKYO, h: v.h } : { name: '指定した地点', sub: '', lat: v.lat, lon: v.lon, h: v.h }, false);
  },
  null,
  { save: false },
);

/* ---------- 状態 ---------- */
let ecl: data.Eclipse | null = null;
let L: Local | null = null;
/** 表示の時刻: 要素の t（t0 からの TD の時間） */
let t = 0;
let span: [number, number] = [-3, 3];
let paths: { central: LatLon[][]; limits: [LatLon[][], LatLon[][]] } | null = null;
let corona = makeCorona(1, 0, 0.5);
const painter = new SunPainter();
let rings110: Rings | null = null;
let rings50: Rings | null = null;
let mask: LandMask | null = null;

const dirty = { sky: true, curve: true, reg: true, globe: true, out: true, list: true };
let raf = 0;
let lastMap = 0;
function later(): void {
  if (!raf) raf = requestAnimationFrame(update);
}

/* ---------- 時刻の表記 ---------- */
const tzh = () => (tz$.value === 'ut' ? 0 : 9);
const tzName = () => (tz$.value === 'ut' ? 'UT' : 'JST');
/** t を、選んだ表記の暦（UT1 = TD − ΔT） */
function calOf(tt: number, e = ecl as data.Eclipse) {
  const jd = e.el.jd0 + tt / 24 - e.el.dt / 86400 + tzh() / 24;
  // 秒に丸めてから暦にする（23:59:59.6 が 24:00:00 にならないように）
  const jr = (Math.round((jd + 0.5) * 86400) + 0.25) / 86400 - 0.5;
  return jdToCal(jr);
}
function hms(tt: number, sec = true, e = ecl as data.Eclipse): string {
  const c = calOf(tt, e);
  const s = Math.floor(c.hour * 3600);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor(s / 60) % 60;
  return sec ? `${hh}:${p2(mm)}:${p2(s % 60)}` : `${hh}:${p2(mm)}`;
}
const yearStr = (y: number) => (y < 0 ? `−${-y}` : String(y));
const dateStr = (e: Entry) => `${yearStr(e.year)}-${p2(e.month)}-${p2(e.day)}`;
const TYPE: Record<string, string> = { T: '皆既日食', A: '金環日食', H: '金環皆既日食', P: '部分日食' };
const TYPE_S: Record<string, string> = { T: '皆既', A: '金環', H: '金環皆既', P: '部分' };
const durStr = (s: number) => `${Math.floor(s / 60)}分${(s % 60).toFixed(1).padStart(4, '0')}秒`;
const durShort = (s: number) => (s > 0 ? `${Math.floor(s / 60)}分${p2(Math.round(s % 60))}秒` : '—');
const DIRS = [
  '北',
  '北北東',
  '北東',
  '東北東',
  '東',
  '東南東',
  '南東',
  '南南東',
  '南',
  '南南西',
  '南西',
  '西南西',
  '西',
  '西北西',
  '北西',
  '北北西',
];
const dirOf = (az: number) => DIRS[Math.round(((az * R2D) % 360) / 22.5) % 16];
const llStr = (lat: number, lon: number, d = 3) =>
  `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(d)}°${lon >= 0 ? 'E' : 'W'}`;
const SUP: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};
/** 小さい値を 5.7×10⁻⁵ の形に */
const sci = (v: number) => {
  const [m, e] = v.toExponential(1).split('e');
  return `${m.replace(/\.0$/, '')}×10${[...String(Number(e))].map((c) => SUP[c] ?? c).join('')}`;
};
const pct = (v: number) => (v >= 0.9999 && v < 1 ? '99.99' : (v * 100).toFixed(v > 0.995 ? 2 : 1));
const fluxStr = (f: number) => (f >= 0.01 ? f.toFixed(3) : f > 0 ? sci(f) : '0');

/* ---------- 日食を選ぶ ---------- */
async function selectEclipse(id: string, keepT = false): Promise<void> {
  const e = await data.find(id);
  if (!e) return;
  ecl = e;
  store('ecl', id);
  const el = e.el;
  // 経路: 中心線と本影（金環）の限界
  const step = 1 / 120;
  const ll = (q: { lat: number; lon: number }) => ({ lat: q.lat, lon: q.lon });
  paths = {
    central: trace(el, (tt) => centralPoint(el, tt), step).map((s) => s.map(ll)),
    limits: [
      trace(el, (tt) => limitPoint(el, tt, true, 1), step).map((s) => s.map(ll)),
      trace(el, (tt) => limitPoint(el, tt, true, -1), step).map((s) => s.map(ll)),
    ],
  };
  const yr = e.entry.year + (e.entry.month - 0.5) / 12;
  corona = makeCorona(e.entry.year * 400 + e.entry.month * 31 + e.entry.day + 7, sunAxisPA(e.entry.jd), activityOf(yr));
  local(keepT);
  dirty.list = true;
  loadSaros();
  later();
}

/** 観測地か日食が変わったとき: 地方食と、時刻の帯の範囲 */
function local(keepT = false): void {
  if (!ecl) return;
  L = localCircumstances(ecl.el, siteRad());
  const tGE = (ecl.entry.jd - ecl.el.jd0) * 24;
  if (L.kind !== 'none' && L.visible && L.c1 && L.c4) span = [L.c1.t - 0.25, L.c4.t + 0.25];
  else span = [tGE - 1.5, tGE + 1.5];
  span = [Math.max(span[0], ecl.el.tmin - 1), Math.min(span[1], ecl.el.tmax + 1)];
  if (!keepT || t < span[0] || t > span[1]) t = L.kind !== 'none' && L.visible ? L.max.t : tGE;
  Object.assign(dirty, { sky: true, curve: true, reg: true, globe: true, out: true });
  markSaros();
}

function setSite(p: Place, syncRows = true): void {
  site = p;
  regCenter = null;
  store('site', p);
  if (syncRows) {
    G.set('lat', p.lat, { silent: true });
    G.set('lon', p.lon, { silent: true });
    G.set('h', p.h, { silent: true });
  }
  txt('#loc-name', p.sub && p.name !== p.sub ? `${p.name}（${p.sub}）` : p.name);
  txt('#loc-coord', llStr(p.lat, p.lon));
  dirty.list = true;
  local(true);
  later();
}

/* ---------- 毎回の描画 ---------- */
function update(): void {
  raf = 0;
  if (!ecl || !L) return;
  const el = ecl.el;
  const S = siteRad();
  const P = observerXYZ(S.lat, S.lon, S.h);
  const g = geomAt(el, P, S, t, el.dt);
  const dk = disksOf(g);
  const flux = dk.sep >= dk.sun + dk.moon ? 1 : residualFlux(dk.sun, dk.moon, dk.sep);
  const obs = overlapFraction(dk.sun, dk.moon, dk.sep);
  const phase = phaseOf(g);
  const title = `${site.name}の空 · ${dateStr(ecl.entry)} ${TYPE[ecl.entry.type]}`;
  txt('#hd-sky', title);
  txt('#clk', hms(t));
  txt('#clkz', tzName());
  txt('#o-ph', phase);
  txt('#o-ob', `${pct(obs)} %`);
  txt('#o-f', fluxStr(flux));
  const day = Math.max(0, Math.min(1, (Math.sin(g.alt) + 0.105) / 0.157));
  const total = Math.hypot(g.u, g.v) < -g.L2;
  txt('#o-sb', fluxStr(total ? 1e-4 : Math.max(flux * day, day > 0 ? 1e-4 : 0)));
  txt('#o-sun', `高度 ${(g.alt * R2D).toFixed(1)}° · 方位 ${(g.az * R2D).toFixed(1)}°`);
  txt('#mT', `${hms(t)} ${tzName()}`);
  txt('#mO', `${pct(obs)} %`);
  txt('#mP', phase);
  drawSkyAndSun(g, dk, flux, total);
  if (dirty.curve) drawCurve();
  moveCursor();
  if (dirty.out) drawOut();
  if (dirty.list) void drawList();
  // 地図と地球儀は重いので、再生中は 0.12 秒に 1 度にする
  const now = performance.now();
  if (!playing || now - lastMap > 120) {
    lastMap = now;
    drawRegion();
    drawSpace();
  }
  dirty.sky = dirty.curve = dirty.out = dirty.list = dirty.reg = dirty.globe = false;
}

function phaseOf(g: Geom): string {
  if (!L || L.kind === 'none') return '欠けない';
  if (g.alt < HORIZON) return '太陽は地平線の下';
  const m = Math.hypot(g.u, g.v);
  if (m >= g.L1) return t < L.max.t ? '食の前' : '食の後';
  if (m < Math.abs(g.L2)) return g.L2 < 0 ? '皆既' : '金環';
  const near = (c: { t: number } | null) => !!c && Math.abs(t - c.t) * 3600 < 15;
  if (near(L.c2) || near(L.c3)) return L.kind === 'total' ? 'ダイヤモンドリング' : '金環の直前・直後';
  if (L.kind === 'partial' && Math.abs(t - L.max.t) * 3600 < 30) return '食の最大';
  return '部分食';
}

/* 空（広角）と望遠の太陽 */
const skyC = $<HTMLCanvasElement>('#sky');
const sunC = $<HTMLCanvasElement>('#sun');
function drawSkyAndSun(g: Geom, dk: ReturnType<typeof disksOf>, flux: number, total: boolean): void {
  if (!L) return;
  // 空の向きは、食の最大のときの太陽の方位を中心に固定する（時刻を動かしても景色が回らないように）
  const azC = L.kind !== 'none' && L.visible ? L.max.az : g.az;
  const half = 62.5 * D2R;
  const alt1 = Math.min(90, Math.max(70, (L.max.alt * R2D + 18) | 0)) * D2R;
  let sunAz = g.az;
  while (sunAz - azC > Math.PI) sunAz -= 2 * Math.PI;
  while (sunAz - azC < -Math.PI) sunAz += 2 * Math.PI;
  const ang = dk.pa - g.zen;
  drawSky(skyC.getContext('2d') as CanvasRenderingContext2D, {
    w: skyC.width,
    h: skyC.height,
    az0: azC - half,
    az1: azC + half,
    alt0: -4 * D2R,
    alt1,
    sunAlt: g.alt,
    sunAz,
    sunR: dk.sun * dk.scale,
    moonR: dk.moon * dk.scale,
    moonDx: -Math.sin(ang) * dk.sep * dk.scale,
    moonDy: Math.cos(ang) * dk.sep * dk.scale,
    flux,
    total,
    seed: 7,
  });
  const a0 = Math.round((((azC - half) * R2D) % 360) + 360) % 360;
  const a1 = Math.round((((azC + half) * R2D) % 360) + 360) % 360;
  txt('#sky-lab', `空全体 · 方位 ${a0}〜${a1}° · 高度 −4〜${Math.round(alt1 * R2D)}°`);
  const sctx = sunC.getContext('2d') as CanvasRenderingContext2D;
  const zoom = Number(zm$.value);
  if (g.alt < HORIZON) {
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, sunC.width, sunC.height);
    txt('#sun-lab', `望遠 ${zoom * 2}° · 太陽は地平線の下`);
    return;
  }
  const r = painter.draw(sctx, {
    w: sunC.width,
    h: sunC.height,
    half: zoom * D2R,
    disks: dk,
    zen: g.zen,
    flux,
    corona,
  });
  txt('#sun-lab', `望遠 ${zoom * 2}° · ${r.filtered ? '減光フィルター越し' : '肉眼'}`);
}

/* 光の量の曲線と時刻の帯 */
const X = (tt: number) => ((tt - span[0]) / (span[1] - span[0])) * 1000;
/** 曲線の縦: F = 1 が 60、F = 0 が 170 */
const FY = (f: number) => 170 - f * 110;
/** 時刻の帯の出来事: 名前と時刻 */
interface Ev {
  name: string;
  t: number;
}
function drawCurve(): void {
  if (!ecl || !L) return;
  const el = ecl.el;
  const S = siteRad();
  const P = observerXYZ(S.lat, S.lon, S.h);
  let lin = '';
  let lg = '';
  const N = 240;
  const sunEv: Ev[] = [];
  let prevAlt = Number.NaN;
  let prevT = 0;
  for (let k = 0; k <= N; k++) {
    const tt = span[0] + ((span[1] - span[0]) * k) / N;
    const gg = geomAt(el, P, S, tt, el.dt);
    const d = disksOf(gg);
    const f = d.sep >= d.sun + d.moon ? 1 : residualFlux(d.sun, d.moon, d.sep);
    const x = X(tt).toFixed(1);
    lin += `${k ? 'L' : 'M'}${x} ${FY(f).toFixed(1)}`;
    const l = Math.max(-4.5, Math.log10(Math.max(f, 1e-6)));
    lg += `${k ? 'L' : 'M'}${x} ${FY((l + 4.5) / 4.5).toFixed(1)}`;
    // 日の出・日の入り（太陽の中心が −0.30° を通る時刻）
    const a = gg.alt - HORIZON;
    if (k && Math.sign(a) !== Math.sign(prevAlt)) {
      const tc = prevT + ((tt - prevT) * prevAlt) / (prevAlt - a);
      sunEv.push({ name: a > 0 ? '日の出' : '日の入り', t: tc });
    }
    prevAlt = a;
    prevT = tt;
  }
  $('#c-lin').setAttribute('d', lin);
  $('#c-lg').setAttribute('d', lg);
  const vis = L.kind !== 'none' && L.visible;
  $('#c-par').setAttribute('d', vis && L.c1 && L.c4 ? `M${X(L.c1.t)} 190H${X(L.c4.t)}` : '');
  $('#c-tot').setAttribute('d', vis && L.c2 && L.c3 ? `M${X(L.c2.t)} 190H${X(L.c3.t)}` : '');
  // 時刻の目盛り: 15 分ごと、数字は 30 分ごと
  const c0 = calOf(span[0]);
  const m0 = c0.hour * 60;
  let tk = '';
  let lab = '';
  for (let m = Math.ceil(m0 / 15) * 15; ; m += 15) {
    const tt = span[0] + (m - m0) / 60;
    if (tt > span[1]) break;
    const x = X(tt).toFixed(1);
    tk += `M${x} 184V196`;
    if (m % 30 === 0) {
      const hm = (((m / 60) % 24) + 24) % 24;
      lab += `<text x="${x}" y="214" text-anchor="middle">${Math.floor(hm)}:${p2(Math.round((hm % 1) * 60))}</text>`;
    }
  }
  $('#c-tk').innerHTML = `<path class="tk" d="${tk}"></path>${lab}`;
  // 出来事: 縦の破線と名前。名前は重ならないよう 3 段に分ける
  const events: Ev[] = [];
  if (vis && L.c1 && L.c4) {
    events.push({ name: '第一接触', t: L.c1.t });
    if (L.c2 && L.c3) events.push({ name: '第二接触', t: L.c2.t });
    events.push({ name: '食の最大', t: L.max.t });
    if (L.c2 && L.c3) events.push({ name: '第三接触', t: L.c3.t });
    events.push({ name: '第四接触', t: L.c4.t });
  } else events.push({ name: '最大食（地球全体）', t: (ecl.entry.jd - ecl.el.jd0) * 24 });
  events.push(...sunEv);
  events.sort((a, b) => a.t - b.t);
  const ends: number[] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let ev = '';
  for (const e of events) {
    const x = X(e.t);
    const w = e.name.length * 11 + 8;
    let row = ends.findIndex((end) => end < x - w / 2);
    if (row < 0) row = ends.indexOf(Math.min(...ends));
    const anchor = x - w / 2 < 0 ? 'start' : x + w / 2 > 1000 ? 'end' : 'middle';
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    ends[row] = left + w;
    const y = 14 + row * 15;
    ev += `<path class="ev" d="M${x.toFixed(1)} ${y + 4}V182"></path><text class="evt" x="${x.toFixed(1)}" y="${y}" text-anchor="${anchor}">${e.name}</text>`;
  }
  $('#c-ev').innerHTML = ev;
  txt(
    '#lg-band',
    !vis
      ? 'この地点では欠けない'
      : L.c2
        ? `${L.kind === 'total' ? '皆既' : '金環'} ${durStr(L.duration)}`
        : `部分食 ${hms((L.c1 as { t: number }).t, false)}〜${hms((L.c4 as { t: number }).t, false)}`,
  );
  txt('#lg-tz', `横軸の時刻は${tz$.value === 'ut' ? '世界時（UT）' : '日本時間（JST）'}`);
  // 主な時刻のチップ: 出来事の名前と時刻
  const keys: Ev[] = [];
  if (vis && L.c1 && L.c4) {
    keys.push({ name: '第一接触', t: L.c1.t });
    if (L.c2 && L.c3) {
      keys.push(
        { name: L.kind === 'total' ? 'ダイヤモンドリング' : '第二接触の 5 秒前', t: L.c2.t - 5 / 3600 },
        { name: '第二接触', t: L.c2.t },
        { name: '食の最大', t: L.max.t },
        { name: '第三接触', t: L.c3.t },
      );
    } else keys.push({ name: '食の最大', t: L.max.t });
    keys.push({ name: '第四接触', t: L.c4.t });
  } else keys.push({ name: '最大食（地球全体）', t: (ecl.entry.jd - ecl.el.jd0) * 24 });
  $('#keys').innerHTML = keys
    .map((k) => `<button type="button" class="chip" data-t="${k.t}"><small>${esc(k.name)}</small>${hms(k.t)}</button>`)
    .join('');
}
function moveCursor(): void {
  const x = X(t).toFixed(1);
  $('#c-cur').setAttribute('d', `M${x} 52V198`);
  const c = $('#curve');
  c.setAttribute('aria-valuenow', x);
  c.setAttribute('aria-valuetext', `${hms(t)} ${tzName()}`);
  for (const b of $('#keys').querySelectorAll<HTMLButtonElement>('button'))
    b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.t) - t) < 1e-6));
}
$('#keys').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-t]');
  if (!b) return;
  stop();
  setT(Number(b.dataset.t));
});
$('#tstep').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-s]');
  if (!b) return;
  stop();
  setT(t + Number(b.dataset.s) / 3600);
});
function setT(tt: number): void {
  t = Math.max(span[0], Math.min(span[1], tt));
  later();
}
{
  const svg = $<SVGSVGElement>('#curve');
  const at = (ev: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    setT(span[0] + ((ev.clientX - r.left) / r.width) * (span[1] - span[0]));
  };
  svg.addEventListener('pointerdown', (ev) => {
    svg.setPointerCapture(ev.pointerId);
    stop();
    at(ev);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (svg.hasPointerCapture(ev.pointerId)) at(ev);
  });
  svg.addEventListener('keydown', (ev) => {
    // ← → は 10 秒（Shift で 1 秒）、PageUp・PageDown は 1 分
    const d = { ArrowLeft: -10, ArrowRight: 10, PageDown: -60, PageUp: 60 }[ev.key];
    if (d === undefined) return;
    ev.preventDefault();
    setT(t + (ev.shiftKey && Math.abs(d) === 10 ? d / 10 : d) / 3600);
  });
}

/* 再生 */
let playing = false;
let last = 0;
function stop(): void {
  playing = false;
  $('#play').setAttribute('aria-pressed', 'false');
  $('#playLed').classList.remove('on');
  txt('#playT', '再生');
}
function tick(now: number): void {
  if (!playing) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  t += (dt * Number(sp$.value)) / 3600;
  if (t >= span[1]) {
    t = span[1];
    stop();
  }
  update();
  if (playing) requestAnimationFrame(tick);
}
$('#play').addEventListener('click', () => {
  if (playing) return stop();
  if (t >= span[1] - 1e-6) t = span[0];
  playing = true;
  $('#play').setAttribute('aria-pressed', 'true');
  $('#playLed').classList.add('on');
  txt('#playT', '停止');
  last = performance.now();
  requestAnimationFrame(tick);
});

/** キャンバスのドラッグ: 4 px 動くまではドラッグとみなさず、動かさずに離したら押したことにする */
function dragOn(
  c: HTMLCanvasElement,
  move: (dx: number, dy: number) => void,
  start: () => void,
  click?: (ev: PointerEvent) => void,
): void {
  let x0 = 0;
  let y0 = 0;
  let moved = false;
  let id: number | null = null;
  c.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    id = ev.pointerId;
    try {
      c.setPointerCapture(ev.pointerId);
    } catch {
      /* 捕まえられなくても、キャンバスの上の動きは追える */
    }
    x0 = ev.clientX;
    y0 = ev.clientY;
    moved = false;
    start();
  });
  c.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== id) return;
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    c.classList.add('drag');
    // CSS の大きさから、キャンバスの画素へ
    const k = c.width / c.getBoundingClientRect().width;
    move(dx * k, dy * k);
  });
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    id = null;
    c.classList.remove('drag');
    if (ev.type === 'pointerup' && !moved) click?.(ev);
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}

/* 観測地のまわりの地図 */
const regC = $<HTMLCanvasElement>('#reg');
let regProj: Projection | null = null;
const regCache = {};
/** 地図の中心 [°]。null なら観測地 */
let regCenter: [number, number] | null = null;
let regRaf = 0;
function drawRegion(): void {
  if (!ecl || !paths || !rings110) return;
  const k = (9.3 / regC.width) * D2R;
  const [clat, clon] = regCenter ?? [site.lat, site.lon];
  regProj = equirect(regC.width, regC.height, clat * D2R, clon * D2R, k);
  const lut = fluxLUT(snapAt(ecl.el, t, ecl.el.dt));
  drawMap(regC.getContext('2d') as CanvasRenderingContext2D, {
    proj: regProj,
    rings: rings50 ?? rings110,
    lut,
    central: paths.central,
    limits: paths.limits,
    observer: { lat: site.lat * D2R, lon: site.lon * D2R, label: site.name },
    grat: 0,
    cache: regCache,
  });
  const band = ecl.entry.type === 'P' ? '皆既帯なし（部分日食）' : `${ecl.entry.type === 'A' ? '金環帯' : '皆既帯'}`;
  txt('#reg-lab', `${hms(t)} ${tzName()} の月の影`);
  txt('#lg-reg', band);
  $('#reg-home').hidden = !regCenter;
}
{
  let c0: [number, number] = [0, 0];
  dragOn(
    regC,
    (dx, dy) => {
      const k = 9.3 / regC.width;
      const lat = Math.max(-80, Math.min(80, c0[0] + dy * k));
      let lon = c0[1] - dx * k;
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
      regCenter = [lat, lon];
      if (!regRaf)
        regRaf = requestAnimationFrame(() => {
          regRaf = 0;
          drawRegion();
        });
    },
    () => {
      c0 = regCenter ?? [site.lat, site.lon];
    },
    async (ev) => {
      if (!regProj) return;
      const r = regC.getBoundingClientRect();
      const ll = regProj.inv(
        ((ev.clientX - r.left) / r.width) * regC.width,
        ((ev.clientY - r.top) / r.height) * regC.height,
      );
      if (!ll) return;
      const lat = ll[0] * R2D;
      let lon = ll[1] * R2D;
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
      const near = await nearestPlace(lat, lon, 15);
      // 地図で選んだときは、地図の位置を動かさない
      const keep = regCenter ?? [site.lat, site.lon];
      setSite(near ?? { name: '地図で選んだ地点', sub: '', lat: +lat.toFixed(4), lon: +lon.toFixed(4), h: 0 });
      regCenter = keep;
      drawRegion();
    },
  );
}
$('#reg-home').addEventListener('click', () => {
  regCenter = null;
  drawRegion();
});

/* 宇宙から */
const glC = $<HTMLCanvasElement>('#globe');
/** ドラッグで回した分 [rad]（視点の向きの緯度・経度に足す） */
let gOff: [number, number] = [0, 0];
let glRaf = 0;
function drawSpace(): void {
  if (!ecl || !paths || !mask) return;
  const v = view$.value;
  const s = snapAt(ecl.el, t, ecl.el.dt);
  const d = viewDir(s, v);
  const lat = Math.max(-1.55, Math.min(1.55, Math.asin(d[2]) + gOff[0]));
  const lon = Math.atan2(d[1], d[0]) + gOff[1];
  drawGlobe(glC.getContext('2d') as CanvasRenderingContext2D, {
    w: glC.width,
    h: glC.height,
    el: ecl.el,
    dt: ecl.el.dt,
    t,
    mask,
    dir: [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)],
    dist: v === 'geo' ? 6.62 : v === 'l1' ? 235 : 60,
    fill: 0.88,
    central: paths.central,
    observer: { lat: site.lat * D2R, lon: site.lon * D2R },
  });
  const turned = gOff[0] !== 0 || gOff[1] !== 0;
  const where =
    v === 'l1'
      ? '太陽と地球の間の L1 から見た地球。DSCOVR の位置に合わせ、太陽の向きから 8° ずらして見ている（月が地球に重ならないように）'
      : v === 'geo'
        ? '静止軌道の東経 140.7°（ひまわりの位置）から見た地球'
        : '月から見た地球';
  $('#globe-cap').innerHTML =
    `${esc(`${hms(t)} ${tzName()}`)}、${turned ? 'ドラッグで回した向きから見た地球（同じ距離から）' : where}。濃い点が<b>本影</b>、周りの暗がりが<b>半影</b>。黄色の線は中心線、白い丸は観測地。`;
  $('#globe-home').hidden = !turned;
}
{
  let o0: [number, number] = [0, 0];
  dragOn(
    glC,
    (dx, dy) => {
      // 画面の端から端で約 180° 回す
      const k = Math.PI / glC.width;
      gOff = [Math.max(-Math.PI, Math.min(Math.PI, o0[0] + dy * k)), o0[1] - dx * k];
      if (!glRaf)
        glRaf = requestAnimationFrame(() => {
          glRaf = 0;
          drawSpace();
        });
    },
    () => {
      o0 = gOff;
    },
  );
}
$('#globe-home').addEventListener('click', () => {
  gOff = [0, 0];
  drawSpace();
});

/* 予報 */
function contactStr(c: Local['c1']): string {
  if (!c) return '—';
  return c.visible ? hms(c.t) : `${hms(c.t)}（太陽は地平線の下）`;
}
function drawOut(): void {
  if (!ecl || !L) return;
  txt('#hd-out', `${site.name}での予報`);
  const vis = L.kind !== 'none' && L.visible;
  const mx = L.max;
  const altDir = `太陽の高度 ${Math.round(mx.alt * R2D)}° · ${dirOf(mx.az)}`;
  if (!vis) {
    txt('#o-mt', L.kind === 'none' ? '欠けない' : '見えない');
    txt('#o-mv', L.kind === 'none' ? '食なし' : '地平線の下');
    txt('#o-ms', L.kind === 'none' ? '半影がこの地点を通らない' : '食の間、太陽は地平線の下にある');
  } else if (L.c2 && L.c3) {
    txt('#o-mt', L.kind === 'total' ? '皆既' : '金環');
    txt('#o-mv', `${hms(L.c2.t)} → ${hms(L.c3.t)}`);
    txt('#o-ms', `${durStr(L.duration)} · ${altDir}`);
  } else {
    txt('#o-mt', '部分食');
    txt('#o-mv', `食分 ${mx.mag.toFixed(3)}`);
    txt(
      '#o-ms',
      `面積比 ${pct(mx.obs)} % · 最大 ${hms(mx.t)} · ${altDir}${mx.visible ? '' : '（最大のとき太陽は地平線の下）'}`,
    );
  }
  txt('#o-c1', vis ? contactStr(L.c1) : '—');
  txt('#o-mx', vis ? (mx.visible ? hms(mx.t) : `${hms(mx.t)}（地平線の下）`) : '—');
  txt('#o-c4', vis ? contactStr(L.c4) : '—');
  txt('#o-mg', L.kind === 'none' ? '—' : mx.mag.toFixed(3));
  $('#o-oc').innerHTML = L.kind === 'none' ? '—' : `${pct(mx.obs)}<span class="u">%</span>`;
  txt('#o-bdt', ecl.entry.type === 'A' ? '金環帯から' : '皆既帯から');
  txt('#o-bd', bandDistance());
  txt('#loc-note', bandDistance(true));
}

/** 観測地から皆既（金環）帯までの距離と向き */
function bandDistance(short = false): string {
  if (!ecl || !paths || !L) return '—';
  if (ecl.entry.type === 'P') return short ? '' : '皆既帯なし（部分日食）';
  const lat0 = site.lat * D2R;
  const kx = Math.cos(lat0) * 6371;
  const near = (lines: LatLon[][]) => {
    let best = { d: Number.POSITIVE_INFINITY, side: 0 };
    for (const seg of lines)
      for (let k = 1; k < seg.length; k++) {
        const a = seg[k - 1];
        const b = seg[k];
        let dl = a.lon - site.lon * D2R;
        dl = Math.atan2(Math.sin(dl), Math.cos(dl));
        let dl2 = b.lon - site.lon * D2R;
        dl2 = Math.atan2(Math.sin(dl2), Math.cos(dl2));
        const ax = dl * kx;
        const ay = (a.lat - lat0) * 6371;
        const bx = dl2 * kx;
        const by = (b.lat - lat0) * 6371;
        const vx = bx - ax;
        const vy = by - ay;
        const len = vx * vx + vy * vy || 1;
        const u = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len));
        const px = ax + u * vx;
        const py = ay + u * vy;
        const d = Math.hypot(px, py);
        // 線が東へ進むとして、観測地が線の左（北）なら +1
        if (d < best.d) best = { d, side: Math.sign(vx * -ay - vy * -ax) * Math.sign(vx || 1) };
      }
    return best;
  };
  const c = near(paths.central);
  if (!Number.isFinite(c.d)) return '—';
  const ns = (s: number) => (s > 0 ? '北' : '南');
  const inside = L.kind === 'total' || L.kind === 'annular';
  if (inside)
    return short
      ? `${ecl.entry.type === 'A' ? '金環' : '皆既'}帯の中（中心線の ${Math.round(c.d)} km ${ns(c.side)}）`
      : `中（中心線の ${Math.round(c.d)} km ${ns(c.side)}）`;
  const lim = c.side > 0 ? near(paths.limits[0]) : near(paths.limits[1]);
  if (!Number.isFinite(lim.d) || lim.d > 3000) return short ? '' : '遠い';
  const name = c.side > 0 ? '北限' : '南限';
  return short
    ? `${ecl.entry.type === 'A' ? '金環' : '皆既'}帯の外（${name}の ${Math.round(lim.d)} km ${ns(c.side)}）`
    : `外（${name}の ${Math.round(lim.d)} km ${ns(c.side)}）`;
}

/* 観測地で見える日食の一覧 */
let listToken = 0;
async function drawList(): Promise<void> {
  if (!ecl) return;
  const my = ++listToken;
  const y0 = ecl.entry.year - 10;
  const y1 = ecl.entry.year + 30;
  txt('#hd-list', `${site.name}で見える日食`);
  txt('#list-span', `${yearStr(y0)}〜${yearStr(y1)} 年`);
  txt('#list-here', `${site.name}で`);
  const all = await data.range(y0, y1);
  if (my !== listToken) return;
  const S = siteRad();
  const rows: string[] = [];
  for (const e of all) {
    const Lx = localCircumstances(e.el, S);
    if (Lx.kind === 'none' || !Lx.visible) continue;
    const here =
      Lx.kind === 'total'
        ? `皆既 ${durShort(Lx.duration)}`
        : Lx.kind === 'annular'
          ? `金環 ${durShort(Lx.duration)}`
          : '部分';
    const tm = hms(Lx.max.t, false, e);
    rows.push(
      `<tr data-id="${e.id}"${e.id === ecl?.id ? ' class="on"' : ''}><td>${dateStr(e.entry)}</td><td class="t">${TYPE_S[e.entry.type]}</td><td>${here}</td><td>${Lx.max.mag.toFixed(3)}</td><td>${tm}</td><td>${Math.round(Lx.max.alt * R2D)}°</td></tr>`,
    );
  }
  $('#list').innerHTML = rows.join('') || '<tr><td class="none" colspan="6">この期間に欠けて見える日食はない</td></tr>';
}
$('#list').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-id]');
  if (tr?.dataset.id) void selectEclipse(tr.dataset.id);
});

/* ほかの日食を探す */
const fq = $<HTMLInputElement>('#fq');
let findToken = 0;
async function runFind(): Promise<void> {
  const my = ++findToken;
  const v = Math.round(Number(fq.value));
  const byS = fk$.value === 's';
  txt('#f-note', byS ? '−13〜190' : '−1999〜3000 年');
  fq.placeholder = byS ? '例 145' : '例 2035';
  if (!fq.value.trim() || !Number.isFinite(v)) {
    $('#find').innerHTML = '';
    return;
  }
  let list: data.Eclipse[] = [];
  try {
    list = byS ? await data.saros(v) : await data.range(v - 5, v + 5);
  } catch {
    list = [];
  }
  if (my !== findToken) return;
  $('#find').innerHTML =
    list
      .map(
        (e) =>
          `<tr data-id="${e.id}"${e.id === ecl?.id ? ' class="on"' : ''}><td>${dateStr(e.entry)}</td><td class="t">${TYPE_S[e.entry.type]}</td><td>${e.entry.saros}</td><td>${e.entry.gamma.toFixed(4)}</td><td>${durShort(e.entry.duration)}</td><td>${llStr(e.entry.lat, e.entry.lon, 1)}</td></tr>`,
      )
      .join('') || '<tr><td class="none" colspan="6">見つからない</td></tr>';
}
fq.addEventListener('input', () => void runFind());
$('#find').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-id]');
  if (tr?.dataset.id) void selectEclipse(tr.dataset.id);
});

/* ---------- サロス系列 ---------- */
interface Member {
  e: data.Eclipse;
  c: string;
  band: string;
  gx: number | null;
  gy: number | null;
  here: Local | null;
}
let members: Member[] = [];
let sIdx = 0;
let sProj: Projection | null = null;
let sarosN = Number.NaN;
const sBase = $<HTMLCanvasElement>('#sbase');
const sRng = $<HTMLInputElement>('#s-rng');
const tileCache = new Map<string, HTMLCanvasElement>();

async function loadSaros(): Promise<void> {
  if (!ecl) return;
  const n = ecl.entry.saros;
  if (n !== sarosN) {
    sarosN = n;
    const list = await data.saros(n);
    if (sarosN !== n) return;
    const lon0 = Math.round((ecl.entry.lon || 0) / 30) * 30;
    sProj = equalEarth(sBase.width, lon0 * D2R);
    drawSarosBase();
    const pr = sProj;
    const fmt = (q: [number, number]) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
    const toD = (seg: LatLon[]) => {
      let d = '';
      let prev: [number, number] | null = null;
      for (const p of seg) {
        const q = pr.fwd(p.lat, p.lon);
        if (!q) {
          prev = null;
          continue;
        }
        d += (prev && Math.abs(q[0] - prev[0]) < pr.w / 4 ? 'L' : 'M') + fmt(q);
        prev = q;
      }
      return d;
    };
    members = list.map((e) => {
      const el = e.el;
      const ll = (q: { lat: number; lon: number }) => ({ lat: q.lat, lon: q.lon });
      const c = trace(el, (tt) => centralPoint(el, tt), 1 / 30).map((s) => s.map(ll));
      const nn = trace(el, (tt) => limitPoint(el, tt, true, 1), 1 / 30).map((s) => s.map(ll));
      const ss = trace(el, (tt) => limitPoint(el, tt, true, -1), 1 / 30).map((s) => s.map(ll));
      const ge = pr.fwd(e.entry.lat * D2R, e.entry.lon * D2R);
      return {
        e,
        c: c.map(toD).join(''),
        band:
          nn.length && ss.length
            ? nn.map((seg, k) => (ss[k] ? `${toD([...seg, ...[...ss[k]].reverse()])}Z` : '')).join('')
            : '',
        gx: ge ? ge[0] : null,
        gy: ge ? ge[1] : null,
        here: null,
      };
    });
    sRng.max = String(members.length);
    const first = members[0]?.e.entry;
    const lastE = members[members.length - 1]?.e.entry;
    const total = first?.sarosLen ?? members.length;
    txt(
      '#hd-saros',
      `サロス ${n} · ${first ? yearStr(first.year) : ''}〜${lastE ? yearStr(lastE.year) : ''} 年の ${members.length} 回${members.length < total ? `（系列は全 ${total} 回）` : ''}`,
    );
  }
  sIdx = Math.max(
    0,
    members.findIndex((m) => m.e.id === ecl?.id),
  );
  markSaros();
}

function drawSarosBase(): void {
  if (!sProj || !rings110) return;
  drawMap(sBase.getContext('2d') as CanvasRenderingContext2D, {
    proj: sProj,
    rings: rings110,
    mask: mask ?? undefined,
    grat: 30,
    space: [12, 14, 18],
  });
}

/** 観測地が変わったとき: 系列の各回が観測地で見えるか */
function markSaros(): void {
  if (!members.length) return;
  const S = siteRad();
  for (const m of members) {
    const Lx = localCircumstances(m.e.el, S);
    m.here = Lx.kind !== 'none' && Lx.visible ? Lx : null;
  }
  txt('#s-here', `${site.name}で欠けて見える回`);
  txt('#s-hn', site.name);
  drawSarosPaths();
}

function drawSarosPaths(): void {
  if (!members.length) return;
  const one = sm$.value === 'one';
  let old = '';
  let fut = '';
  const labs: string[] = [];
  members.forEach((m, k) => {
    if (k < sIdx && !one) old += m.c;
    else if (k > sIdx && !one) fut += m.c;
    if (m.gx === null || m.gy === null || !sProj) return;
    const show = k === sIdx || (!one && (!!m.here || m.e.entry.sarosPos % 3 === 2));
    if (!show) return;
    const cls = `slab${m.here ? ' vis' : ''}${k === sIdx ? ' on' : ''}`;
    labs.push(
      `<span class="${cls}" style="left:${((m.gx / sProj.w) * 100).toFixed(2)}%;top:${((m.gy / sProj.h) * 100).toFixed(2)}%">${yearStr(m.e.entry.year)}</span>`,
    );
  });
  const sel = members[sIdx];
  $('#s-old').setAttribute('d', old);
  $('#s-fut').setAttribute('d', fut);
  $('#s-band').setAttribute('d', sel.band);
  $('#s-sel').setAttribute('d', sel.c);
  $('#s-sel2').setAttribute('d', sel.c);
  $('#slabs').innerHTML = labs.join('');
  sRng.value = String(sIdx + 1);
  const e = sel.e.entry;
  txt('#s-date', dateStr(e));
  txt('#s-type', `${TYPE[e.type]}（${e.code}）`);
  txt('#s-pos', `${e.sarosPos} / ${e.sarosLen}`);
  txt('#s-gm', `${e.gamma.toFixed(4)} · ${e.mag.toFixed(4)}`);
  txt('#s-dur', durShort(e.duration));
  const sg = deltaTSigma(e.year + (e.month - 0.5) / 12);
  txt(
    '#s-sig',
    `±${sg < 10 ? sg.toFixed(1) : Math.round(sg)} s（経度 ±${(sg * 0.004178).toFixed(sg > 100 ? 1 : 3)}°）`,
  );
  const h = sel.here;
  txt(
    '#s-hv',
    !h
      ? '欠けて見えない'
      : h.kind === 'total'
        ? `皆既 ${durShort(h.duration)}`
        : h.kind === 'annular'
          ? `金環 ${durShort(h.duration)}`
          : h.max.visible
            ? `部分食 食分 ${h.max.mag.toFixed(3)}`
            : `日の出・日の入りに欠けている（食分 ${h.max.mag.toFixed(3)}）`,
  );
  ($('#s-go') as HTMLButtonElement).disabled = sel.e.id === ecl?.id;
  drawTiles();
  txt(
    '#s-cap',
    '1 回ごとに経度で約 120° 西へずれ、3 回（54 年 34 日）でほぼ同じ経度に戻る。系列は一方の極の近くの部分食で始まり、中心食を経て、反対の極の近くの部分食で終わる。ΔT の不確かさが大きい時代は、経路は東西にその幅だけずれうる。',
  );
}

function drawTiles(): void {
  if (!mask || !rings110) return;
  const lo = Math.max(0, Math.min(members.length - 12, sIdx - 5));
  const box = $('#tiles');
  box.innerHTML = '';
  for (let k = lo; k < Math.min(members.length, lo + 12); k++) {
    const m = members[k];
    let cv = tileCache.get(m.e.id);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = cv.height = 120;
      const el = m.e.el;
      const tge = (m.e.entry.jd - el.jd0) * 24;
      drawMap(cv.getContext('2d') as CanvasRenderingContext2D, {
        proj: orthographic(120, 120, m.e.entry.lat * D2R, m.e.entry.lon * D2R, 58),
        rings: rings110,
        mask,
        lut: fluxLUT(snapAt(el, tge, el.dt)),
        style: { ...MAP_STYLE, night: 0.22 },
        space: null,
      });
      tileCache.set(m.e.id, cv);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.dataset.k = String(k);
    b.setAttribute('aria-pressed', String(k === sIdx));
    b.setAttribute('aria-label', `${dateStr(m.e.entry)} ${TYPE[m.e.entry.type]}`);
    b.append(cv);
    const y = document.createElement('span');
    y.textContent = yearStr(m.e.entry.year);
    const s = document.createElement('small');
    s.textContent = m.here ? `${site.name}で見える` : TYPE_S[m.e.entry.type];
    b.append(y, s);
    box.append(b);
  }
}
$('#tiles').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-k]');
  if (!b) return;
  sIdx = Number(b.dataset.k);
  drawSarosPaths();
});
sRng.addEventListener('input', () => {
  sIdx = Math.max(0, Math.min(members.length - 1, Number(sRng.value) - 1));
  drawSarosPaths();
});
$('#s-go').addEventListener('click', () => {
  const m = members[sIdx];
  if (m) void selectEclipse(m.e.id);
});

/* ---------- 地名の検索 ---------- */
type Row = [string, string, string, number, number, string];
let places: Row[] | null = null;
async function loadPlaces(): Promise<Row[]> {
  if (!places) places = (await import('./places.json')).default as Row[];
  return places;
}
const kata2hira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
async function nearestPlace(lat: number, lon: number, km: number): Promise<Place | null> {
  const list = await loadPlaces();
  let best: Row | null = null;
  let bd = km;
  for (const r of list) {
    const d = 6371 * Math.hypot((r[3] - lat) * D2R, (r[4] - lon) * D2R * Math.cos(lat * D2R));
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best && { name: best[0], sub: best[2], lat: best[3], lon: best[4], h: 0 };
}
const q = $<HTMLInputElement>('#q');
const sugg = $('#sugg');
let hits: Row[] = [];
let active = -1;
async function showSugg(): Promise<void> {
  const list = await loadPlaces();
  const s = kata2hira(norm(q.value.trim()));
  hits = (
    s
      ? list.filter((r) => norm(r[0]).includes(s) || r[1].startsWith(s) || (r[5] && norm(r[5]).startsWith(s)))
      : list.slice(0, 0)
  ).slice(0, 10);
  active = -1;
  if (!hits.length) {
    sugg.hidden = true;
    q.setAttribute('aria-expanded', 'false');
    return;
  }
  const head = ecl ? `<li class="sgh">候補と、${dateStr(ecl.entry)} の日食での見え方</li>` : '';
  sugg.innerHTML =
    head +
    hits
      .map((r, k) => {
        let s2 = '';
        if (ecl) {
          const Lx = localCircumstances(ecl.el, { lat: r[3] * D2R, lon: r[4] * D2R, h: 0 });
          s2 =
            Lx.kind === 'none' || !Lx.visible
              ? '見えない'
              : Lx.kind === 'total'
                ? `皆既 ${durShort(Lx.duration)}`
                : Lx.kind === 'annular'
                  ? `金環 ${durShort(Lx.duration)}`
                  : `部分 ${Lx.max.mag.toFixed(3)}`;
        }
        return `<li><button type="button" class="sg" data-k="${k}" role="option" aria-selected="false"><b>${esc(r[0])}</b><small>${esc(r[2])}</small><span>${s2}</span></button></li>`;
      })
      .join('');
  sugg.hidden = false;
  q.setAttribute('aria-expanded', 'true');
}
function pickPlace(k: number): void {
  const r = hits[k];
  if (!r) return;
  setSite({ name: r[0], sub: r[2], lat: r[3], lon: r[4], h: 0 });
  q.value = '';
  sugg.hidden = true;
  q.setAttribute('aria-expanded', 'false');
}
q.addEventListener('input', () => void showSugg());
q.addEventListener('focus', () => void loadPlaces());
q.addEventListener('keydown', (ev) => {
  if (sugg.hidden) return;
  const n = hits.length;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    active = (active + (ev.key === 'ArrowDown' ? 1 : n - 1) + n) % n;
    sugg.querySelectorAll('.sg').forEach((b, k) => {
      b.setAttribute('aria-selected', String(k === active));
    });
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    pickPlace(active < 0 ? 0 : active);
  } else if (ev.key === 'Escape') {
    sugg.hidden = true;
    q.setAttribute('aria-expanded', 'false');
  }
});
sugg.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.sg');
  if (b) pickPlace(Number(b.dataset.k));
});
document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('.lsearch')) sugg.hidden = true;
});
$('#here').addEventListener('click', () => {
  if (!navigator.geolocation) return txt('#loc-msg', 'このブラウザでは現在地を使えません');
  txt('#loc-msg', '現在地を調べています…');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      txt('#loc-msg', '');
      const near = await nearestPlace(lat, lon, 10);
      setSite({
        name: '現在地',
        sub: near ? `${near.name}付近` : '',
        lat: +lat.toFixed(4),
        lon: +lon.toFixed(4),
        h: Math.max(0, Math.round(pos.coords.altitude ?? 0)),
      });
    },
    () => txt('#loc-msg', '現在地を使えませんでした（位置情報の許可を確かめてください）'),
    { maximumAge: 600000, timeout: 15000 },
  );
});

/* ---------- 始める ---------- */
setSite(site);
void (async () => {
  rings110 = await data.land('110');
  mask = landMask(rings110, 2048, 1024);
  drawSarosBase();
  if (members.length) drawSarosPaths();
  dirty.reg = dirty.globe = true;
  later();
  rings50 = await data.land('50');
  later();
})();
const sv = stored('ecl');
void selectEclipse(typeof sv === 'string' ? sv : '2035-9-2').then(async () => {
  if (!ecl) await selectEclipse('2035-9-2');
});

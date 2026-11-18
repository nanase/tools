/**
 * 日の出と日の入りのページ: 時刻（UTC の瞬間）と地点から、昼と夜の世界地図を描く。
 * 1 日の区切りはいつも地点の現地。時刻の表示だけを現地・日本時間・世界時で切り替える
 */
import { jdToCal } from '../../lib/astro/time';
import { Choice } from '../../lib/choice';
import { DatePicker } from '../../lib/date-picker';
import { dateTimeToJd, toDateTime } from '../../lib/date-picker-core';
import { $ } from '../../lib/dom';
import { type Place, SitePicker } from '../../lib/planet/site';
import { initToolPage } from '../../lib/tool-page';
import { type LandMask, landMask, type Rings } from '../solar-eclipse/land';
import { type Day, dayOf } from './day';
import { coastPath, drawMap, lonLatAt } from './map';
import type { Disp, Speed } from './params';
import { drawSky, factsOf } from './sky';
import { apparent, geoAltAz, siteSun, sunEq } from './sun';
import { approx, localDay, lookupZone, offText, zoneOffset } from './tz';

const BASE = import.meta.env.BASE_URL;
const p2 = (n: number) => String(n).padStart(2, '0');
const txt = (id: string, s: string) => {
  const e = document.querySelector(id);
  if (e && e.textContent !== s) e.textContent = s;
};
const minus = (s: string) => s.replace(/-/g, '−');
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const jdOf = (ms: number) => ms / 864e5 + 2440587.5;
const msOf = (jd: number) => (jd - 2440587.5) * 864e5;

/* ---------- 表示の設定 ---------- */
const tz$ = new Choice<Disp>($('#p-tz'), () => later());
const sp$ = new Choice<Speed>($('#p-sp'));
initToolPage();

/* ---------- 地点と時間帯 ---------- */
let zone: string | null = null;
let zoneKey = '';
const picker = new SitePicker(
  BASE,
  () => {
    findZone();
    later();
  },
  (o) => `高度 ${minus(apparent(geoAltAz(sunEq(T), o.lat, o.lon).h).toFixed(0))}°`,
);
/** 地点の時間帯を引き直す。引けるまでは経度から割り出した差で描く */
function findZone(): void {
  const { lat, lon } = picker.place;
  const key = `${lat},${lon}`;
  if (key === zoneKey) return;
  zoneKey = key;
  zone = null;
  lookupZone(lat, lon).then((z) => {
    if (zoneKey !== key) return;
    zone = z;
    later();
  });
}
/** 地点の現地の UTC との差 [ms] */
const offLocal = (ms: number): number => zoneOffset(zone, picker.place.lon, ms);
/** 表示の時間帯の UTC との差 [ms] */
const offDisp = (ms: number): number => (tz$.value === 'jst' ? 9 * 36e5 : tz$.value === 'ut' ? 0 : offLocal(ms));
/** 表示の時間帯の時刻 h:mm */
function fmt(ms: number): string {
  const d = new Date(ms + offDisp(ms));
  return `${d.getUTCHours()}:${p2(d.getUTCMinutes())}`;
}
function zoneLabel(): string {
  if (tz$.value === 'jst') return 'JST';
  if (tz$.value === 'ut') return 'UT';
  return `${offText(offLocal(T))}${approx(zone) ? '（経度から概算）' : ''}`;
}

/* ---------- 時刻 ---------- */
let T = Date.now();
let live = true;
let raf = 0;
function later(): void {
  if (!raf) raf = requestAnimationFrame(frame);
}
function setT(v: number, keepLive = false): void {
  T = v;
  if (!keepLive) setLive(false);
  later();
}
function setLive(on: boolean): void {
  live = on;
  $('#nowbtn').setAttribute('aria-pressed', String(on));
  $('#nowLed').classList.toggle('on', on);
}
setInterval(() => {
  if (document.hidden) return;
  if (live && !playing) setT(Date.now(), true);
}, 1000);
$('#nowbtn').addEventListener('click', () => {
  if (playing) stop();
  setT(Date.now(), true);
  setLive(true);
});
const datePicker = new DatePicker($('#dp'), {
  get: () => toDateTime(jdToCal(jdOf(T + offDisp(T)))),
  set: (v) => setT(msOf(dateTimeToJd(v, offDisp(T) / 36e5))),
  today: () => jdToCal(jdOf(Date.now() + offDisp(Date.now()))),
});

/* ---------- 再生 ---------- */
let playing = false;
let last = 0;
let acc = 0;
function stop(): void {
  playing = false;
  $('#play').setAttribute('aria-pressed', 'false');
  $('#playLed').classList.remove('on');
  txt('#playT', '再生');
  later();
}
$('#play').addEventListener('click', () => {
  if (playing) return stop();
  setLive(false);
  playing = true;
  last = performance.now();
  acc = 0;
  $('#play').setAttribute('aria-pressed', 'true');
  $('#playLed').classList.add('on');
  txt('#playT', '停止');
  later();
});
/** 再生で時刻を進める。10 日/秒は 1 秒に 10 コマ、1 コマで 1 日進めて現地の時刻を保つ */
function advance(now: number): void {
  const dt = Math.min(200, now - last);
  last = now;
  const sp = sp$.value;
  if (sp === 'real') T += dt;
  else if (sp === 'hour') T += dt * 3600;
  else {
    acc += dt / 100;
    const k = Math.floor(acc);
    if (k) {
      acc -= k;
      const o = offLocal(T);
      T += k * 864e5;
      T += o - offLocal(T);
    }
  }
}

/* ---------- 地図 ---------- */
const mcv = $<HTMLCanvasElement>('#mc');
const kcv = $<HTMLCanvasElement>('#kc');
let mask: LandMask | null = null;
let coast: Path2D | null = null;
fetch(`${BASE}solar-eclipse/land110.json`)
  .then((r) => r.json() as Promise<Rings>)
  .then((rings) => {
    mask = landMask(rings, 1440, 720);
    coast = coastPath(rings);
  })
  .catch(() => {})
  .finally(() => {
    $('#m-busy').hidden = true;
    later();
  });
const latTxt = (v: number) => `${v >= 0 ? '北緯' : '南緯'} ${Math.abs(v).toFixed(1)}°`;
const lonTxt = (v: number) => `${v >= 0 ? '東経' : '西経'} ${Math.abs(v).toFixed(1)}°`;
let down: { x: number; y: number } | null = null;
mcv.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
});
mcv.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  down = null;
  const r = mcv.getBoundingClientRect();
  const p = lonLatAt(e.clientX - r.left - 0.5, e.clientY - r.top - 0.5, r.width, r.height);
  const lat = Math.max(-89.9, Math.min(89.9, p.lat));
  const place: Place = {
    name: `${latTxt(lat)} ${lonTxt(p.lon)}`,
    sub: '',
    lat: +lat.toFixed(4),
    lon: +p.lon.toFixed(4),
    h: 0,
  };
  picker.set(place);
});

/* ---------- その日と夏至・冬至 ---------- */
let dayKey = '';
let day: Day | null = null;
/** 今の時刻を含む現地の 1 日 */
function today(): Day {
  const { lat, lon } = picker.place;
  const [d0, d1] = localDay(T, offLocal);
  const key = `${d0}|${d1}|${lat}|${lon}`;
  if (!day || key !== dayKey) {
    dayKey = key;
    day = dayOf(lat, lon, d0, d1);
  }
  return day;
}
let solKey = '';
let sol: [Day, Day] | null = null;
/** 今の現地の年の夏至（6 月 21 日）と冬至（12 月 21 日） */
function solstice(): [Day, Day] {
  const { lat, lon } = picker.place;
  const y = new Date(T + offLocal(T)).getUTCFullYear();
  const key = `${y}|${lat}|${lon}|${zone}`;
  if (!sol || key !== solKey) {
    solKey = key;
    const at = (m: number) =>
      dayOf(lat, lon, ...localDay(Date.UTC(y, m, 21, 12) - offLocal(Date.UTC(y, m, 21, 12)), offLocal));
    sol = [at(5), at(11)];
  }
  return sol;
}

/* ---------- 描く ---------- */
function drawClock(): void {
  const d = new Date(T + offDisp(T));
  txt('#clk', `${d.getUTCHours()}:${p2(d.getUTCMinutes())}`);
  txt('#clkz', zoneLabel());
  txt('#o-date', `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}（${WD[d.getUTCDay()]}）`);
  datePicker.sync();
}
function frame(now: number): void {
  raf = 0;
  if (playing) {
    advance(now);
    raf = requestAnimationFrame(frame);
  }
  drawClock();
  drawMap(mcv, { sun: sunEq(T), mask, coast, pin: picker.place });
  const d = today();
  const here = siteSun(T, picker.place.lat, picker.place.lon);
  for (const [i, [, v]] of factsOf(d, here, fmt).entries()) txt(`#f${i}`, v);
  drawSky(kcv, { day: d, solstice: solstice(), now: here, lat: picker.place.lat, fmt });
}
new ResizeObserver(() => later()).observe($('#mview'));

findZone();
later();

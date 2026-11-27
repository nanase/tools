/**
 * 日の出と日の入りのページ: 時刻（UTC の瞬間）と地点から、昼と夜の世界地図を描く。
 * 1 日の区切りはいつも地点の現地。時刻の表示だけを現地・日本時間・世界時で切り替える。
 * 夏時間を使わないときは、現地をその年の標準時で数える
 */
import { Choice } from '../../lib/choice';
import { DatePicker } from '../../lib/date-picker';
import { $ } from '../../lib/dom';
import { type Place, SitePicker, TOKYO } from '../../lib/planet/site';
import { PanZoom } from '../../lib/planet/zoom';
import { bindRepeat } from '../../lib/repeat';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import type { Rings } from '../solar-eclipse/land';
import { type Day, dayOf } from './day';
import { boundView, coastPath, drawMap, lonLatAt } from './map';
import type { Disp, Dst, Speed } from './params';
import { drawSky, factsOf, num } from './sky';
import { apparent, BANDS, band, geoAltAz, siteSun, sunEq } from './sun';
import {
  approx,
  fromWall,
  hasDst,
  localDay,
  lookupZone,
  offText,
  shiftTime,
  stdOffset,
  wallMs,
  zoneOffset,
} from './tz';
import { yearGrid } from './year';
import { drawYear, type YearGeom, yearPick } from './yearview';

const BASE = import.meta.env.BASE_URL;
const p2 = (n: number) => String(n).padStart(2, '0');
const txt = (id: string, s: string) => {
  const e = document.querySelector(id);
  if (e && e.textContent !== s) e.textContent = s;
};
const WD = ['日', '月', '火', '水', '木', '金', '土'];

/* ---------- 表示の設定 ---------- */
const tz$ = new Choice<Disp>($('#p-tz'), () => later());
const dst$ = new Choice<Dst>($('#p-dst'), () => later());
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
  (o) => `高度 ${num(apparent(geoAltAz(sunEq(T), o.lat, o.lon).h), 0)}°`,
);
/** 時間帯を引いている間（「経度から概算」の札を出さない） */
let zonePending = false;
/**
 * 地点の時間帯を引き直す。引けるまでは経度から割り出した差で描く。
 * 引けた時間帯は地点と一緒に覚え、開き直したときは表を読まずに使う。既定の東京は表を読まない
 */
function findZone(): void {
  const { lat, lon } = picker.place;
  const key = `${lat},${lon}`;
  if (key === zoneKey) return;
  zoneKey = key;
  const memo = stored('zone') as { key?: string; zone?: string } | undefined;
  if (memo?.key === key && typeof memo.zone === 'string') {
    zone = memo.zone;
    zonePending = false;
    return;
  }
  if (lat === TOKYO.lat && lon === TOKYO.lon) {
    zone = 'Asia/Tokyo';
    zonePending = false;
    return;
  }
  zone = null;
  zonePending = true;
  lookupZone(lat, lon).then((z) => {
    if (zoneKey !== key) return;
    zone = z;
    zonePending = false;
    if (z) store('zone', { key, zone: z });
    later();
  });
}
/** 地点の現地の UTC との差 [ms]。夏時間を使わないときは標準時 */
const offLocal = (ms: number): number =>
  dst$.value === 'off' ? stdOffset(zone, picker.place.lon, ms) : zoneOffset(zone, picker.place.lon, ms);
/** 夏時間のない地点では切り替えを押せなくする（引いている間は前のまま） */
let noDst: boolean | null = null;
function syncDst(): void {
  if (zonePending) return;
  const v = !hasDst(zone, picker.place.lon, T);
  if (v === noDst) return;
  noDst = v;
  dst$.setOff(v, '夏時間のない地点');
}
/** 表示の時間帯の UTC との差 [ms] */
const offDisp = (ms: number): number => (tz$.value === 'jst' ? 9 * 36e5 : tz$.value === 'ut' ? 0 : offLocal(ms));
/** 表示の時間帯の時刻 h:mm */
function fmt(ms: number): string {
  const d = new Date(ms + offDisp(ms));
  return `${d.getUTCHours()}:${p2(d.getUTCMinutes())}`;
}
/** 表示の時間帯の暦の日時（カレンダーに渡す） */
function wallOf(ms: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const d = new Date(ms + offDisp(ms));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}
function zoneLabel(): string {
  if (tz$.value === 'jst') return 'JST';
  if (tz$.value === 'ut') return 'UT';
  const std = dst$.value === 'off' && noDst === false ? '（標準時）' : '';
  return `${offText(offLocal(T))}${approx(zone) && !zonePending ? '（経度から概算）' : std}`;
}

/* ---------- 時刻 ---------- */
let T = Date.now();
let live = true;
let raf = 0;
/** 操作や地点・表示の変化で描き直しが要る */
let dirty = true;
function later(): void {
  dirty = true;
  if (!raf) raf = requestAnimationFrame(frame);
}
function setT(v: number, keepLive = false): void {
  T = v;
  if (!keepLive) setLive(false);
  later();
}
function setLive(on: boolean): void {
  live = on;
  for (const b of [$('#nowbtn'), $('#sr-fl-now')]) {
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.led')?.classList.toggle('on', on);
  }
}
setInterval(() => {
  if (document.hidden) return;
  if (live && !playing) setT(Date.now(), true);
}, 1000);
function goNow(): void {
  if (playing) stop();
  setT(Date.now(), true);
  setLive(true);
}
$('#nowbtn').addEventListener('click', goNow);
$('#sr-fl-now').addEventListener('click', goNow);
const datePicker = new DatePicker($('#dp'), {
  get: () => wallOf(T),
  set: (v) => setT(fromWall(wallMs(v), offDisp)),
  today: () => wallOf(Date.now()),
});

/* ---------- 再生 ---------- */
let playing = false;
let last = 0;
let acc = 0;
/** 見出しの再生と、時刻の操作の枠の再生は同じ状態 */
function showPlay(on: boolean): void {
  for (const b of [$('#play'), $('#sr-fl-play')]) b.setAttribute('aria-pressed', String(on));
}
function stop(): void {
  playing = false;
  showPlay(false);
  later();
}
function togglePlay(): void {
  if (playing) {
    stop();
    return;
  }
  setLive(false);
  playing = true;
  last = performance.now();
  acc = 0;
  showPlay(true);
  later();
}
$('#play').addEventListener('click', togglePlay);
$('#sr-fl-play').addEventListener('click', togglePlay);

/* ---------- 時刻の操作（右下に浮かべる枠） ---------- */
const fl = $('#sr-fl');
const flBtn = $('#sr-flb');
/** 開閉は保存する（初めは広い画面で開く） */
function setFloat(on: boolean, save = true): void {
  fl.hidden = !on;
  flBtn.setAttribute('aria-pressed', String(on));
  if (save) store('sr-float', on);
}
{
  const sv = stored('sr-float');
  setFloat(typeof sv === 'boolean' ? sv : matchMedia('(min-width: 1000px)').matches, false);
}
flBtn.addEventListener('click', () => setFloat(fl.hasAttribute('hidden')));
$('#sr-fl-x').addEventListener('click', () => setFloat(false));
/* 押し続けると繰り返す。速すぎないよう 450 ms 後から 1 秒に 5 回 */
for (const b of fl.querySelectorAll<HTMLElement>('button[data-step]')) {
  const sec = Number(b.dataset.step);
  bindRepeat(b, () => setT(shiftTime(T, sec, offLocal)), { delay: 450, every: 200 });
}
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
let coast: Path2D | null = null;
fetch(`${BASE}solar-eclipse/land110.json`)
  .then((r) => r.json() as Promise<Rings>)
  .then((rings) => {
    coast = coastPath(rings);
  })
  .catch(() => {})
  .finally(() => {
    $('#m-busy').hidden = true;
    later();
  });
const latTxt = (v: number) => `${v >= 0 ? '北緯' : '南緯'} ${Math.abs(v).toFixed(1)}°`;
const lonTxt = (v: number) => `${v >= 0 ? '東経' : '西経'} ${Math.abs(v).toFixed(1)}°`;
/* 拡大・縮小と移動。動かさずに離すとその地点を選ぶ */
const pz = new PanZoom(mcv, {
  min: 1,
  max: 10,
  bound: boundView,
  onChange: () => {
    $('#mreset').hidden = !pz.moved;
    txt('#mzoom', `×${pz.z.toFixed(pz.z < 2 ? 2 : 1)}`);
    later();
  },
  onTap: (x, y) => {
    const p = lonLatAt(x, y, mcv.clientWidth, mcv.clientHeight, pz);
    const lat = Math.max(-89.9, Math.min(89.9, p.lat));
    const place: Place = {
      name: `${latTxt(lat)} ${lonTxt(p.lon)}`,
      sub: '',
      lat: +lat.toFixed(4),
      lon: +p.lon.toFixed(4),
      h: 0,
    };
    picker.set(place);
  },
});
$('#min').addEventListener('click', () => pz.zoomCenter(1.5));
$('#mout').addEventListener('click', () => pz.zoomCenter(1 / 1.5));
$('#mreset').addEventListener('click', () => pz.reset());

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
  const key = `${y}|${lat}|${lon}|${zone}|${dst$.value}`;
  if (!sol || key !== solKey) {
    solKey = key;
    const at = (m: number) =>
      dayOf(lat, lon, ...localDay(Date.UTC(y, m, 21, 12) - offLocal(Date.UTC(y, m, 21, 12)), offLocal));
    sol = [at(5), at(11)];
  }
  return sol;
}

/* ---------- 1 年の図 ---------- */
const ycv = $<HTMLCanvasElement>('#yc');
let gridKey = '';
let grid: { nd: number; cells: Uint8Array } | null = null;
let ygeom: YearGeom | null = null;
/** 現地の年 */
const yearOf = (ms: number) => new Date(ms + offLocal(ms)).getUTCFullYear();
/** year 年の day 日目（0 が 1 月 1 日）の現地の 0 時。格子と同じく、その日の正午の差で決める */
function dayStartOf(year: number, day: number): number {
  const u = Date.UTC(year, 0, 1 + day);
  return u - offLocal(u + 12 * 36e5);
}
function yearGridNow(year: number): { nd: number; cells: Uint8Array } {
  const { lat, lon } = picker.place;
  const key = `${year}|${lat}|${lon}|${zone}|${dst$.value}`;
  if (!grid || key !== gridKey) {
    gridKey = key;
    grid = yearGrid(lat, lon, year, offLocal);
  }
  return grid;
}
/** 現地の分を表示の時間帯の目盛りにする（日本時間で見たニューヨークなら 0 時が 14時） */
function yearLabel(m: number): string {
  const s = (((m + (offDisp(T) - offLocal(T)) / 6e4) % 1440) + 1440) % 1440;
  const hh = Math.floor(s / 60);
  const mm = Math.round(s % 60);
  return mm ? `${hh}:${p2(mm)}` : `${hh}時`;
}
function drawYearNow(): void {
  const y = yearOf(T);
  const d = today();
  const u = Date.UTC(y, 0, 1);
  const day = Math.round((d.d0 + offLocal(d.d0 + 12 * 36e5) - u) / 864e5);
  ygeom = drawYear(ycv, { grid: yearGridNow(y), year: y, cur: { day, min: (T - d.d0) / 6e4 }, label: yearLabel });
}
function yearAt(e: PointerEvent): number | null {
  if (!ygeom) return null;
  const r = ycv.getBoundingClientRect();
  const p = yearPick(e.clientX - r.left, e.clientY - r.top, ygeom);
  return p ? dayStartOf(ygeom.year, p.day) + p.min * 6e4 : null;
}
let ydown = false;
ycv.addEventListener('pointerdown', (e) => {
  const t = yearAt(e);
  if (t === null) return;
  ydown = true;
  ycv.setPointerCapture(e.pointerId);
  if (playing) stop();
  setT(t);
});
ycv.addEventListener('pointermove', (e) => {
  const t = yearAt(e);
  if (t === null) return;
  const { lat, lon } = picker.place;
  const h = geoAltAz(sunEq(t), lat, lon).h;
  const c = new Date(t + offLocal(t));
  txt(
    '#y-read',
    `${c.getUTCMonth() + 1}月${c.getUTCDate()}日 ${fmt(t)} ${BANDS[band(h)]}（高度 ${num(apparent(h), 1)}°）`,
  );
  if (ydown) setT(t);
});
ycv.addEventListener('pointerup', () => {
  ydown = false;
});

/* ---------- 描く ---------- */
function drawClock(): void {
  const d = new Date(T + offDisp(T));
  txt('#clk', `${d.getUTCHours()}:${p2(d.getUTCMinutes())}`);
  txt('#clkz', zoneLabel());
  txt('#o-date', `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}（${WD[d.getUTCDay()]}）`);
  txt('#sr-fl-time', `${d.getUTCHours()}:${p2(d.getUTCMinutes())}`);
  txt('#sr-fl-date', `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}（${WD[d.getUTCDay()]}）`);
  datePicker.sync();
}
/** 前に描いた時刻と時計 */
let drawnT = Number.NaN;
let drawnAt = 0;
/**
 * 再生中に描くか: 操作のあとはいつも描く。実時間は 1 秒に 1 回、10 日/秒は日が進んだときだけ、
 * 1 時間/秒は 1 秒に 30 回まで（地図は画素ごとに計算するので毎フレームは重い）
 */
function due(now: number): boolean {
  if (dirty) return true;
  const sp = sp$.value;
  if (sp === 'real') return Math.floor(T / 1000) !== Math.floor(drawnT / 1000);
  if (sp === 'day') return T !== drawnT;
  return now - drawnAt >= 33;
}
function frame(now: number): void {
  raf = 0;
  if (playing) {
    advance(now);
    raf = requestAnimationFrame(frame);
  }
  if (!due(now)) return;
  dirty = false;
  drawnT = T;
  drawnAt = now;
  syncDst();
  drawClock();
  drawMap(mcv, { sun: sunEq(T), coast, pin: picker.place, view: pz });
  const d = today();
  const here = siteSun(T, picker.place.lat, picker.place.lon);
  for (const [i, [, v]] of factsOf(d, here, fmt).entries()) txt(`#f${i}`, v);
  drawSky(kcv, { day: d, solstice: solstice(), now: here, lat: picker.place.lat, fmt });
  drawYearNow();
}
new ResizeObserver(() => later()).observe($('#mview'));

findZone();
later();

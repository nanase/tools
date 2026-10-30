/**
 * 月のページ: 日時と観測地から月の状態を計算し、望遠の月・1 か月の帯・暦・月食・図を描く
 */
import { Choice } from '../../lib/choice';
import { $, esc, norm } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { calToJd, jdToCal } from '../solar-eclipse/time';
import {
  ageAt,
  apsides,
  eclipseContacts,
  type MoonState,
  moonState,
  type Obs,
  phaseTimes,
  riseSet,
  type Shadow,
  shadowAt,
} from './ephem';
import { type Key, PARAMS } from './params';
import { type Place as GlPlace, MoonRenderer, type MoonU, type Vec3 } from './render';
import { type Bright, moonUniforms, type Orient, project, screenAngle, sunAltAt, unproject } from './view';

const BASE = import.meta.env.BASE_URL;
const D = Math.PI / 180;
const p2 = (n: number) => String(n).padStart(2, '0');
const txt = (id: string, s: string) => {
  const e = document.querySelector(id);
  if (e) e.textContent = s;
};
const minus = (s: string) => s.replace(/-/g, '−');
const nowJd = () => Date.now() / 86400000 + 2440587.5;
/** 拡大の倍率 */
const ZOOM = 2.8;

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
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
};
let site: Place = okPlace(stored('site')) ? (stored('site') as Place) : TOKYO;
const obs = (): Obs => ({ lat: site.lat, lon: site.lon, h: site.h || 0 });

/* ---------- 表示の設定 ---------- */
const or$ = new Choice<Orient>($('#p-or'), () => {
  bandIcons = '';
  calKey = '';
  later(true);
});
const lab$ = new Choice<'near' | 'all' | 'off'>($('#p-lab'), () => later());
const br$ = new Choice<Bright>($('#p-br'), () => later());
const es$ = new Choice<'on' | 'off'>($('#p-es'), () => {
  bandIcons = '';
  calKey = '';
  later(true);
});
const tz$ = new Choice<'jst' | 'ut'>($('#p-tz'), () => {
  bandKey = '';
  calKey = '';
  later(true);
});
const sp$ = new Choice($('#p-sp'));
const G = new ParamGroup<Key>(
  PARAMS,
  (v, k) => {
    if (!k) return;
    // 既定値（東京）に戻したときは東京にする
    const tokyo = v.lat === TOKYO.lat && v.lon === TOKYO.lon;
    setSite(tokyo ? { ...TOKYO, h: v.h } : { name: '指定した地点', sub: '', lat: v.lat, lon: v.lon, h: v.h }, false);
  },
  null,
  { save: false },
);
initToolPage();

const tzh = () => (tz$.value === 'ut' ? 0 : 9);
const tzName = () => (tz$.value === 'ut' ? 'UT' : 'JST');
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const local = (jd: number) => jdToCal(jd + tzh() / 24);
const dateStr = (jd: number) => {
  const c = local(jd);
  return `${c.year}-${p2(c.month)}-${p2(c.day)}（${WD[((Math.floor(jd + 1.5 + tzh() / 24) % 7) + 7) % 7]}）`;
};
const hm = (jd: number) => {
  const c = local(jd);
  const m = Math.round(c.hour * 60) % 1440;
  return `${Math.floor(m / 60)}:${p2(m % 60)}`;
};
const md = (jd: number) => {
  const c = local(jd);
  return `${c.month}/${c.day}`;
};
/** その日（表示の時刻帯）の 0 時の JD */
const dayStart = (jd: number) => Math.floor(jd + 0.5 + tzh() / 24) - 0.5 - tzh() / 24;
const kmStr = (km: number) => `${Math.round(km).toLocaleString('en-US')} km`;
const dms = (as: number) => {
  const m = Math.floor(as / 60);
  return `${m}′${p2(Math.round(as - m * 60))}″`;
};
const sgn = (v: number, d = 2) => minus(v.toFixed(d));

/* ---------- 状態 ---------- */
let jd = nowJd();
let st: MoonState = moonState(jd, obs());
let sh: Shadow | null = null;
let zoomAt: [number, number] | null = null;
let renderer: MoonRenderer | null = null;
let raf = 0;
let full = true;
function later(all = false): void {
  if (all) full = true;
  if (!raf) raf = requestAnimationFrame(frame);
}

/** 月が影に近いときだけ影を計算に入れる */
function shadowNow(): Shadow | null {
  const s = shadowAt(jd);
  return Math.hypot(s.x, s.y) - s.sdMoon < s.Rp + 0.05 ? s : null;
}

/** 現在の日時に合わせて進む状態（開いたときと「現在」を押したとき）。日時を動かすと止まる */
let live = true;
function setJd(v: number, all = true, keepLive = false): void {
  jd = v;
  if (!keepLive) setLive(false);
  later(all);
}
function setLive(on: boolean): void {
  live = on;
  $('#nowbtn').setAttribute('aria-pressed', String(on));
  $('#nowLed').classList.toggle('on', on);
}
setInterval(() => {
  if (document.hidden) return;
  if (live && !playing) setJd(nowJd(), false, true);
  else if (!live && W0) placeNow();
}, 1000);

/* ---------- 望遠の月 ---------- */
const view = $('#mview');
const canvas = $<HTMLCanvasElement>('#mc');
const labs = $('#labs');
const zlabs = $('#zlabs');
const loupe = $('#loupe');
const zbox = $('#zbox');
const zframe = $('#zframe');
const lead = $<SVGSVGElement>('#lead');
interface Lay {
  W: number;
  H: number;
  rad: number;
  cx: number;
  cy: number;
}
/** 表示の拡大率と、円盤の中心のずれ [CSS px]（ドラッグとホイールで変える。保存しない） */
let vz = 1,
  vx = 0,
  vy = 0;
const VZ_MIN = 0.6,
  VZ_MAX = 8;
function baseLayout(): Lay {
  const W = view.clientWidth,
    H = view.clientHeight,
    rad = W / H > 1.2 ? 0.46 * H : 0.44 * Math.min(W, H);
  return { W, H, rad, cx: W / 2, cy: H / 2 };
}
/**
 * 拡大の窓を開いている間、広い画面では窓の場所を空けるため月を右へ寄せる（lt は寄せ具合 0〜1）。
 * 開いている間に手で動かしたら、寄せた分をずれに取り込み、閉じても戻さない
 */
let lt = 0;
let ltRaf = 0;
const shiftOf = (b: Lay): number => (b.W / b.H > 1.2 ? Math.max(0, b.W - 0.04 * b.W - b.rad * vz - (b.cx + vx)) : 0);
function layout(): Lay {
  const b = baseLayout();
  return { ...b, rad: b.rad * vz, cx: b.cx + vx + lt * shiftOf(b), cy: b.cy + vy };
}
function slideTo(target: 0 | 1): void {
  cancelAnimationFrame(ltRaf);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    lt = target;
    later();
    return;
  }
  const t0 = performance.now(),
    from = lt;
  const step = (now: number) => {
    const u = Math.min(1, (now - t0) / 260);
    lt = from + (target - from) * (1 - (1 - u) ** 3);
    later();
    if (u < 1) ltRaf = requestAnimationFrame(step);
  };
  ltRaf = requestAnimationFrame(step);
}
/** 手で動かす前に、寄せた分をずれに取り込む */
function foldShift(): void {
  if (!lt) return;
  cancelAnimationFrame(ltRaf);
  vx += lt * shiftOf(baseLayout());
  lt = 0;
}
/** 円盤が画面から出ていかないよう、中心のずれを抑える */
function clampPan(): void {
  const b = baseLayout(),
    r = b.rad * vz;
  vx = Math.min(b.W - b.cx + r * 0.8, Math.max(-b.cx - r * 0.8, vx));
  vy = Math.min(b.H - b.cy + r * 0.8, Math.max(-b.cy - r * 0.8, vy));
}
/** 画面の点 (px, py) を動かさずに拡大率を f 倍にする */
function zoomAbout(px: number, py: number, f: number): void {
  foldShift();
  const L = layout();
  const nz = Math.min(VZ_MAX, Math.max(VZ_MIN, vz * f)),
    k = nz / vz;
  const b = baseLayout();
  vz = nz;
  vx = px - (px - L.cx) * k - b.cx;
  vy = py - (py - L.cy) * k - b.cy;
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

type Feat = [string | null, string, number, number, number, string];
let feats: Feat[] = [];
void import('./features.json')
  .then((m) => {
    feats = m.default as Feat[];
    later();
  })
  .catch(() => {});
const fname = (f: Feat) => f[0] ?? f[1];

/** 地名を選ぶ: 海は大きなものをいつも、クレーターは欠け際から 20° 以内（太陽の高度 −3°〜20°）の大きなものから */
function pickLabels(mode: 'near' | 'all' | 'off', inBox?: (x: number, y: number) => boolean, limit = 12, minD = 25) {
  if (mode === 'off' || !feats.length) return [];
  const out: { f: Feat; x: number; y: number }[] = [];
  /* 太陽直下点からの経度差。欠け際は ±90°、その 20° 内側までを「欠け際の近く」とする */
  const nearTerm = (lon: number) => {
    const h = Math.abs(((lon - st.subSun.lon + 540) % 360) - 180);
    return h > 70 && h < 90;
  };
  const cands = feats
    .filter((f) => {
      /* 夜の側（中心で太陽が地平線の下）にあるものは出さない */
      if (sunAltAt(st, f[2], f[3]) <= 0) return false;
      if (f[5] === 'mare') return !inBox && /^(Mare|Oceanus) /.test(f[1]);
      if (f[5] !== 'crater' || f[4] < minD) return false;
      if (inBox) return true;
      if (Math.abs(f[2]) > 70) return false;
      return mode === 'all' ? f[4] >= 90 : nearTerm(f[3]);
    })
    .sort((a, b) => b[4] - a[4]);
  for (const f of cands) {
    const p = project(st, or$.value, f[2], f[3]);
    if (!p || (inBox && !inBox(p[0], p[1]))) continue;
    out.push({ f, x: p[0], y: p[1] });
    if (out.filter((o) => o.f[5] !== 'mare').length >= limit) break;
  }
  return out;
}

function placeLabels(
  el: HTMLElement,
  list: { f: Feat; x: number; y: number }[],
  cx: number,
  cy: number,
  R: number,
  w: number,
  h: number,
): void {
  const used: [number, number][] = [];
  const html: string[] = [];
  for (const { f, x, y } of list) {
    const px = cx + x * R,
      py = cy - y * R;
    if (px < 0 || py < 0 || px > w || py > h) continue;
    if (f[5] !== 'mare' && used.some(([a, b]) => Math.abs(a - px) < 70 && Math.abs(b - py) < 14)) continue;
    used.push([px, py]);
    const cls = f[5] === 'mare' ? 'mlab sea' : px < cx ? 'mlab l' : 'mlab';
    html.push(`<span class="${cls}" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px">${esc(fname(f))}</span>`);
  }
  el.innerHTML = html.join('');
}

function drawOrient(): void {
  const svg = $('#orient');
  const mode = or$.value;
  /* 矢印は円の中心から。名前は重ならないよう下に並べる */
  const arrow = (v: Vec3, cls: string) => {
    const a = screenAngle(st, mode, v) * D,
      x = 48 + 30 * Math.cos(a),
      y = 40 - 30 * Math.sin(a);
    return `<line class="${cls}" x1="48" y1="40" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"></line><circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8"></circle>`;
  };
  svg.innerHTML = `${arrow(st.zenith, '')}${arrow(st.pole, 'n')}${arrow(st.mz, 'p')}<text x="4" y="88">天頂</text><text class="tn" x="30" y="88">天の北</text><text class="tp" x="64" y="88">月の北</text>`;
}

function drawMoon(): void {
  if (!renderer) return;
  renderer.fit();
  const L = layout();
  const d = canvas.width / Math.max(1, L.W);
  const mode = or$.value;
  const u = moonUniforms(st, mode, br$.value, sh);
  if (es$.value === 'off') u.es = 0;
  renderer.clear();
  const main: GlPlace = {
    x: 0,
    y: 0,
    w: canvas.width,
    h: canvas.height,
    cx: L.cx * d,
    cy: (L.H - L.cy) * d,
    rad: L.rad * d,
  };
  renderer.draw(u, main);
  placeLabels(labs, pickLabels(lab$.value), L.cx, L.cy, L.rad, L.W, L.H);
  /* 拡大 */
  const zp = zoomAt && project(st, mode, zoomAt[0], zoomAt[1]);
  loupe.hidden = zframe.hidden = !zp;
  lead.style.display = zp ? '' : 'none';
  view.classList.toggle('zoomed', !!zp);
  if (zp) {
    const wide = L.W / L.H > 1.2;
    /* 広い画面では月の左の空に、狭い画面では押した点と反対の隅に出す */
    const lw = wide ? 0.3 * L.W : 0.52 * L.W;
    const right = !wide && zp[0] < 0,
      low = wide || zp[1] > 0;
    loupe.style.width = `${lw}px`;
    loupe.style.left = `${right ? L.W - lw - 0.03 * L.W : 0.03 * L.W}px`;
    loupe.style.top = wide ? `${0.3 * L.H}px` : low ? '' : `${0.03 * L.H}px`;
    loupe.style.bottom = !wide && low ? `${0.03 * L.H}px` : '';
    const vr = view.getBoundingClientRect(),
      zr = zbox.getBoundingClientRect();
    const zx = zr.left - vr.left,
      zy = zr.top - vr.top,
      zw = zr.width,
      zh = zr.height;
    const Rz = L.rad * ZOOM;
    const dcx = zx + zw / 2 - zp[0] * Rz,
      dcy = zy + zh / 2 + zp[1] * Rz;
    renderer.draw(u, {
      x: Math.round(zx * d),
      y: Math.round((L.H - zy - zh) * d),
      w: Math.round(zw * d),
      h: Math.round(zh * d),
      cx: (dcx - zx) * d,
      cy: (L.H - dcy - (L.H - zy - zh)) * d,
      rad: Rz * d,
    });
    const fx = L.cx + zp[0] * L.rad - zw / ZOOM / 2,
      fy = L.cy - zp[1] * L.rad - zh / ZOOM / 2;
    Object.assign(zframe.style, { left: `${fx}px`, top: `${fy}px`, width: `${zw / ZOOM}px`, height: `${zh / ZOOM}px` });
    lead.setAttribute('viewBox', `0 0 ${L.W} ${L.H}`);
    const side = fx > zx + zw ? [zx + zw, fx] : [zx, fx + zw / ZOOM];
    $('#leadP').setAttribute(
      'd',
      `M${side[0]} ${zy}L${side[1]} ${fy}M${side[0]} ${zy + zh}L${side[1]} ${fy + zh / ZOOM}`,
    );
    const inBox = (x: number, y: number) =>
      Math.abs((x - zp[0]) * Rz) < zw / 2 - 4 && Math.abs((y - zp[1]) * Rz) < zh / 2 - 4;
    placeLabels(zlabs, pickLabels('near', inBox, 8, 8), zw / 2 - zp[0] * Rz, zh / 2 + zp[1] * Rz, Rz, zw, zh);
    const c = pickLabels('near', (x, y) => Math.hypot((x - zp[0]) * Rz, (y - zp[1]) * Rz) < 40, 1, 5)[0];
    $('#zcap').innerHTML = `<b>押した所の拡大</b> ×${ZOOM}${
      c ? ` · ${esc(fname(c.f))}の太陽の高度 ${sgn(sunAltAt(st, c.f[2], c.f[3]), 1)}°` : ''
    }`;
  }
  drawOrient();
  const term = (((st.subSun.lon - 90 + 540) % 360) - 180) as number;
  txt(
    '#v-lab',
    `${mode === 'zenith' ? '天頂が上' : mode === 'moon' ? '月の北が上' : '天の北が上'} · 視野 ${(st.diam / 3600 / 0.92).toFixed(2)}°`,
  );
  txt(
    '#v-lab2',
    st.alt < 0
      ? `地平線の下（高度 ${sgn(st.alt, 1)}°）`
      : `欠け際 ${term < 0 ? '西経' : '東経'} ${Math.abs(term).toFixed(1)}°`,
  );
}

/* 押す: その場所を拡大の窓に出す。ドラッグ: 位置を動かす。ホイール・2 本指: 拡大・縮小 */
function pickAt(cx: number, cy: number): void {
  const L = layout();
  const ll = unproject(st, or$.value, (cx - L.cx) / L.rad, -(cy - L.cy) / L.rad);
  if (!ll) return;
  if (!zoomAt) slideTo(1);
  zoomAt = ll;
  later();
}
const ptrs = new Map<number, { x: number; y: number }>();
let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
let pinch: { d: number; z: number } | null = null;
const local2 = (e: PointerEvent | WheelEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = local2(e);
  ptrs.set(e.pointerId, p);
  if (ptrs.size === 1) drag = { ...p, vx, vy, moved: false };
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: vz };
    if (drag) drag.moved = true;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return;
  const p = local2(e);
  ptrs.set(e.pointerId, p);
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAbout((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.z * d) / pinch.d / vz);
    return;
  }
  if (!drag) return;
  const dx = p.x - drag.x,
    dy = p.y - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) {
    foldShift();
    drag.vx = vx;
  }
  drag.moved = true;
  canvas.classList.add('drag');
  vx = drag.vx + dx;
  vy = drag.vy + dy;
  clampPan();
  viewChanged();
});
const ptrEnd = (e: PointerEvent) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 0) {
    if (drag && !drag.moved && e.type === 'pointerup') {
      const p = local2(e);
      pickAt(p.x, p.y);
    }
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
    const p = local2(e);
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
  cancelAnimationFrame(ltRaf);
  lt = zoomAt ? 1 : 0;
  viewChanged();
});
$('#zclose').addEventListener('click', () => {
  zoomAt = null;
  if (lt) slideTo(0);
  later();
});

/* ---------- 数値 ---------- */
const PH = ['新月と上弦の間', '上弦と満月の間', '満月と下弦の間', '下弦と新月の間'];
let dayKey = '';
let rst: ReturnType<typeof riseSet> | null = null;
let nextFull = 0;
function drawNumbers(): void {
  const c = local(jd);
  const s = Math.floor(c.hour * 3600 + 1e-6);
  txt('#clk', `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`);
  txt('#clkz', tzName());
  const age = ageAt(jd);
  txt('#o-date', dateStr(jd));
  txt('#o-age', age.toFixed(1));
  txt('#o-k', `${(st.illum * 100).toFixed(1)} %`);
  txt('#o-dist', kmStr(st.dist));
  txt('#o-diam', dms(st.diam));
  txt('#o-altaz', `${sgn(st.alt, 1)}° · ${st.az.toFixed(1)}°`);
  txt('#mT', `${dateStr(jd).slice(5, 10)} ${hm(jd)} ${tzName()}`);
  txt('#mA', age.toFixed(1));
  txt('#mK', `${(st.illum * 100).toFixed(1)} %`);
  const dk = `${dayStart(jd)}|${site.lat}|${site.lon}|${tz$.value}`;
  if (dk !== dayKey) {
    dayKey = dk;
    rst = riseSet(dayStart(jd), obs());
    nextFull = phaseTimes(jd, jd + 31).find((p) => p.q === 2)?.jd ?? 0;
  }
  txt('#o-mage', age.toFixed(1));
  const ph = PH[Math.floor((((st.elong % 360) + 360) % 360) / 90)];
  txt(
    '#o-msub',
    `輝面比 ${(st.illum * 100).toFixed(1)} % · ${ph}${nextFull > jd ? ` · 満月まで ${(nextFull - jd).toFixed(1)} 日` : ''}`,
  );
  if (rst) {
    txt('#o-rise', rst.rise == null ? 'なし' : hm(rst.rise));
    txt('#o-trt', `南中（${rst.transitAlt.toFixed(1)}°）`);
    txt('#o-tr', hm(rst.transit));
    txt('#o-set', rst.set == null ? 'なし' : hm(rst.set));
  }
  txt('#o-llon', `${sgn(st.subObs.lon)}°`);
  txt('#o-llat', `${sgn(st.subObs.lat)}°`);
  txt('#o-pa', `${st.paBright.toFixed(1)}°`);
  ($('#dt') as HTMLInputElement).value =
    `${c.year}-${p2(c.month)}-${p2(c.day)}T${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}`;
}
/* 日時を選ぶ: 隠した入力欄の日時の選択を、日付の右のボタンから開く */
$('#dtbtn').addEventListener('click', () => {
  const i = $<HTMLInputElement>('#dt');
  try {
    i.showPicker();
  } catch {
    i.focus();
  }
});
$('#dt').addEventListener('change', (e) => {
  const v = (e.target as HTMLInputElement).value;
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(v);
  if (!m) return;
  setJd(calToJd(+m[1], +m[2], +m[3]) + (+m[4] + +m[5] / 60 - tzh()) / 24);
});

/* ---------- 1 か月の帯 ---------- */
let W0 = 0;
let bandKey = '';
let bandIcons = '';
let bandPh: { jd: number; q: number }[] = [];
let bandAp: ReturnType<typeof apsides> = [];
const band = $<SVGSVGElement>('#band');
const BX = (t: number) => ((t - W0) / 32) * 1000;
const QN = ['新月', '上弦', '満月', '下弦'];
/** 帯の 30 日の 20:00（表示の時刻帯） */
const bandDays = () => {
  const d0 = dayStart(W0) + 1;
  return Array.from({ length: 30 }, (_, k) => d0 + k + 20 / 24);
};
function drawBand(): void {
  if (jd < W0 || jd > W0 + 32 || !bandKey) {
    W0 = jd - ageAt(jd) - 1;
    bandKey = '';
  }
  const key = `${W0}|${tz$.value}`;
  if (key !== bandKey) {
    bandKey = key;
    bandIcons = '';
    bandPh = phaseTimes(W0, W0 + 32);
    bandAp = apsides(W0, W0 + 32);
    const h: string[] = ['<path class="gl" d="M0 96H1000"></path>'];
    for (const p of bandPh) {
      const x = BX(p.jd);
      h.push(`<path class="ev" d="M${x.toFixed(1)} 22V96"></path>`);
      const anchor = x > 900 ? 'end' : 'start';
      h.push(
        `<text class="q" x="${(x + (anchor === 'end' ? -4 : 4)).toFixed(1)}" y="34" text-anchor="${anchor}">${QN[p.q]} ${md(p.jd)} ${hm(p.jd)}</text>`,
      );
    }
    for (const a of bandAp) {
      const x = BX(a.jd);
      h.push(
        `<circle class="ap" cx="${x.toFixed(1)}" cy="72" r="4"></circle><text class="apt" x="${(x + 7).toFixed(1)}" y="76">${a.kind === 'peri' ? '近地点' : '遠地点'} ${kmStr(a.km)}</text>`,
      );
    }
    for (let t = dayStart(W0) + 1; t < W0 + 32; t += 1) {
      const x = BX(t),
        c = local(t + 0.01);
      h.push(`<path class="tk" d="M${x.toFixed(1)} 96V${c.day % 2 ? 99 : 102}"></path>`);
      if (c.day % 2 === 0 && x > 12 && x < 988)
        h.push(`<text x="${x.toFixed(1)}" y="116" text-anchor="middle">${c.month}/${c.day}</text>`);
    }
    h.push(
      '<path class="tri" id="bnow" d=""></path><text class="nowt" id="bnowt">現在</text>',
      '<path class="cur" id="bcur" d="M0 -4V102"></path><rect class="tagr" id="btagr" y="-22" height="19" rx="3"></rect><text class="tagt" id="btagt" y="-8"></text>',
    );
    band.innerHTML = h.join('');
    const row = $('#phrow');
    row.innerHTML = bandDays()
      .map(
        (t) =>
          `<button type="button" style="left:${(BX(t) / 10).toFixed(2)}%" title="${md(t)} ${hm(t)} へ" aria-label="${md(t)} ${hm(t)} へ"><canvas width="52" height="52"></canvas></button>`,
      )
      .join('');
    drawKeys();
  }
  const x = BX(jd);
  $('#bcur').setAttribute('d', `M${x.toFixed(1)} -4V102`);
  /* 日時の札。幅は字数から見積もり、帯からはみ出さないよう寄せる */
  const t = whenStr();
  const tw = [...t].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 11.5 : 6.7), 14);
  const tx = Math.min(1000 - tw / 2, Math.max(tw / 2, x));
  $('#btagr').setAttribute('x', (tx - tw / 2).toFixed(1));
  $('#btagr').setAttribute('width', tw.toFixed(1));
  $('#btagt').setAttribute('x', tx.toFixed(1));
  $('#btagt').textContent = t;
  for (const id of ['#bcur', '#btagr']) $(id).classList.toggle('now', live);
  placeNow();
  band.setAttribute('aria-valuenow', String(Math.round(x)));
  band.setAttribute('aria-valuetext', `${dateStr(jd)} ${hm(jd)}`);
  const ds = bandDays();
  const cur = ds.findIndex((t) => Math.abs(t - jd) < 0.5);
  document.querySelectorAll('#phrow button').forEach((c, k) => {
    c.classList.toggle('on', k === cur);
  });
  if (renderer?.ready && bandIcons !== `${bandKey}|${site.lat}|${site.lon}`) {
    bandIcons = `${bandKey}|${site.lat}|${site.lon}`;
    const cs = document.querySelectorAll<HTMLCanvasElement>('#phrow canvas');
    ds.forEach((t, k) => {
      renderer?.icon(iconU(moonState(t, obs())), cs[k]);
    });
  }
}
/** 帯の現在の印（三角）。現在に合わせて進んでいる間と、日時の札に重なるときは出さない */
function placeNow(): void {
  const x = BX(nowJd());
  const off = live || x < 0 || x > 1000 || Math.abs(x - BX(jd)) < 56;
  $('#bnow').setAttribute('d', off ? '' : `M${(x - 7).toFixed(1)} -8H${(x + 7).toFixed(1)}L${x.toFixed(1)} 2Z`);
  $('#bnowt').setAttribute('x', x.toFixed(1));
  $('#bnowt').setAttribute('y', '-12');
  $('#bnowt').style.display = off ? 'none' : '';
}
function iconU(s: MoonState, shd: Shadow | null = null, bright: Bright = 'eye'): MoonU {
  const u = moonUniforms(s, or$.value, bright, shd);
  if (es$.value === 'off') u.es = 0;
  return u;
}
function bandPick(e: PointerEvent): void {
  const r = band.getBoundingClientRect();
  const x = Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000));
  setJd(W0 + (x / 1000) * 32);
}
/* 帯の小さな月を押すと、その日の 20:00 へ */
$('#phrow').addEventListener('click', (e) => {
  const c = (e.target as Element).closest('button');
  if (!c) return;
  const k = [...document.querySelectorAll('#phrow button')].indexOf(c);
  if (k >= 0) setJd(bandDays()[k]);
});
band.addEventListener('pointerdown', (e) => {
  band.setPointerCapture(e.pointerId);
  bandPick(e);
  const mv = (ev: PointerEvent) => bandPick(ev);
  band.addEventListener('pointermove', mv);
  band.addEventListener('pointerup', () => band.removeEventListener('pointermove', mv), { once: true });
});
band.addEventListener('keydown', (e) => {
  const k = e.key;
  const d = k === 'ArrowRight' ? 1 / 24 : k === 'ArrowLeft' ? -1 / 24 : k === 'PageUp' ? 1 : k === 'PageDown' ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  setJd(jd + d);
});

/* ---------- 主な日時 ---------- */
let superJd = 0;
function supermoon(from: number): number {
  for (let y = local(from).year; y < local(from).year + 3; y++) {
    const j0 = calToJd(y, 1, 1);
    const fulls = phaseTimes(j0, j0 + 366)
      .filter((p) => p.q === 2)
      .map((p) => ({ jd: p.jd, km: moonState(p.jd, null).distGeo }))
      .sort((a, b) => a.km - b.km);
    if (fulls[0] && fulls[0].jd > from - 0.5) return fulls[0].jd;
  }
  return 0;
}
function drawKeys(): void {
  const n = nowJd();
  const next = phaseTimes(n, n + 32).slice(0, 3);
  superJd = supermoon(n);
  const ch: string[] = [];
  for (const p of next)
    ch.push(`<button type="button" class="chip" data-j="${p.jd}">${QN[p.q]} <small>${md(p.jd)}</small></button>`);
  if (superJd)
    ch.push(
      `<button type="button" class="chip" data-j="${superJd}">スーパームーン <small>${local(superJd).year}/${md(superJd)}</small></button>`,
    );
  $('#keys').innerHTML = ch.join('');
}
$('#nowbtn').addEventListener('click', () => {
  if (playing) stop();
  setJd(nowJd(), true, true);
  setLive(true);
});
$('#keys').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.chip');
  if (b) setJd(b.dataset.j === undefined ? jd : Number(b.dataset.j));
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

/* ---------- 月のカレンダー ---------- */
let calKey = '';
let calY = 0;
let calM = 0;
/** 秋分（太陽の視黄経 180°）を含む朔望月を 8 月とし、その 15 日が中秋、次の月の 13 日が十三夜（旧暦の定め方を簡単にしたもの） */
function moonFestivals(y: number): { jd: number; t: string }[] {
  const lam = (j: number) => {
    const s = moonState(j, null).sun;
    const e = 23.4393 * D;
    return (Math.atan2(s[1] * Math.cos(e) + s[2] * Math.sin(e), s[0]) / D + 360) % 360;
  };
  let a = calToJd(y, 9, 15),
    b = calToJd(y, 9, 30);
  for (let k = 0; k < 40; k++) {
    const m = (a + b) / 2;
    if (lam(m) < 180) a = m;
    else b = m;
  }
  /* 旧暦の日付は日本時間の日で数える。秋分の日に秋分より後の新月があっても、その日から 8 月とする */
  const jstDay = (j: number) => Math.floor(j + 0.5 + 9 / 24) - 0.5 - 9 / 24;
  const eq = a;
  const after = phaseTimes(eq, eq + 1.5).find((p) => p.q === 0)?.jd;
  const n8 = after != null && jstDay(after) <= jstDay(eq) ? after : eq - ageAt(eq);
  const n9 = phaseTimes(n8 + 1, n8 + 40).find((p) => p.q === 0)?.jd ?? n8 + 29.53;
  return [
    { jd: jstDay(n8) + 14, t: '中秋の名月' },
    { jd: jstDay(n9) + 12, t: '十三夜' },
  ];
}
function drawCal(): void {
  const c = local(jd);
  const key = `${c.year}-${c.month}|${tz$.value}|${site.lat}|${site.lon}|${or$.value}|${es$.value}|${renderer?.ready}`;
  const sel = `${c.year}-${c.month}-${c.day}`;
  if (key !== calKey) {
    calKey = key;
    calY = c.year;
    calM = c.month;
    txt('#cal-t', `${calY} 年 ${calM} 月`);
    txt('#cal-pm', `${calM === 1 ? 12 : calM - 1} 月`);
    txt('#cal-nm', `${calM === 12 ? 1 : calM + 1} 月`);
    const j0 = calToJd(calY, calM, 1) - tzh() / 24;
    const n = jdToCal(calToJd(calM === 12 ? calY + 1 : calY, calM === 12 ? 1 : calM + 1, 1) - 1).day;
    const first = ((Math.floor(j0 + 1.5 + tzh() / 24) % 7) + 7) % 7;
    const marks = new Map<number, string>();
    for (const p of phaseTimes(j0, j0 + n)) marks.set(local(p.jd).day, QN[p.q]);
    for (const a of apsides(j0, j0 + n))
      if (!marks.has(local(a.jd).day)) marks.set(local(a.jd).day, a.kind === 'peri' ? '近地点' : '遠地点');
    if (calM >= 9 && calM <= 11)
      for (const f of moonFestivals(calY)) {
        const lc = local(f.jd + 0.5);
        if (lc.month === calM) marks.set(lc.day, f.t);
      }
    const h = ['日', '月', '火', '水', '木', '金', '土'].map((w) => `<span class="dh">${w}</span>`);
    for (let k = 0; k < first; k++) h.push('<span class="x" aria-hidden="true"></span>');
    for (let d = 1; d <= n; d++) {
      const noon = j0 + d - 1 + 0.5;
      h.push(
        `<button type="button" class="d" data-d="${d}"><span>${d}</span><canvas width="68" height="68"></canvas><small>${marks.get(d) ?? ''}</small><span class="ag">${ageAt(noon).toFixed(1)}</span></button>`,
      );
    }
    $('#cal').innerHTML = h.join('');
    if (renderer?.ready) {
      const cs = document.querySelectorAll<HTMLCanvasElement>('#cal canvas');
      cs.forEach((cv, k) => {
        renderer?.icon(iconU(moonState(j0 + k + 20 / 24, obs())), cv);
      });
    }
  }
  document.querySelectorAll<HTMLElement>('#cal .d').forEach((b) => {
    if (`${calY}-${calM}-${b.dataset.d}` === sel) b.setAttribute('aria-current', 'date');
    else b.removeAttribute('aria-current');
  });
}
$('#cal').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.d');
  if (b) setJd(calToJd(calY, calM, Number(b.dataset.d)) + (20 - tzh()) / 24);
});
const shiftMonth = (k: number) => {
  let y = calY,
    m = calM + k;
  if (m < 1) {
    m = 12;
    y--;
  } else if (m > 12) {
    m = 1;
    y++;
  }
  const c = local(jd);
  setJd(calToJd(y, m, Math.min(c.day, 28)) + (c.hour - tzh()) / 24);
};
$('#cal-prev').addEventListener('click', () => shiftMonth(-1));
$('#cal-next').addEventListener('click', () => shiftMonth(1));

/* ---------- 図: 軌道・秤動・距離 ---------- */
/** 図の印にする小さな月。輝面比と、満ちていくか欠けていくかで明るい側の形を変える（右が西の空の向き） */
function moonIcon(x: number, y: number, r: number, s: MoonState, w = 1): string {
  const f = (v: number) => v.toFixed(1),
    wax = s.elong < 180,
    rx = r * Math.abs(2 * s.illum - 1),
    c = `cx="${f(x)}" cy="${f(y)}" r="${r}"`;
  return `<circle class="mhalo" style="stroke-width:${w * 5}" ${c}></circle><circle class="drk" ${c}></circle><path class="lit" d="M${f(x)} ${f(y - r)}A${r} ${r} 0 0 ${wax ? 1 : 0} ${f(x)} ${f(y + r)}A${f(rx)} ${r} 0 0 ${s.illum > 0.5 === wax ? 1 : 0} ${f(x)} ${f(y - r)}Z"></path><circle class="rim" style="stroke-width:${w}" ${c}></circle>`;
}
/** 帯の 32 日の地心の状態（6 時間おき）。帯が変わったときだけ作り直す */
let serW0 = Number.NaN;
let ser: MoonState[] = [];
let tserKey = '';
let tser: { lat: number; lon: number }[] = [];
function drawFigs(): void {
  const g = (j: number) => moonState(j, null);
  if (serW0 !== W0) {
    serW0 = W0;
    ser = Array.from({ length: 129 }, (_, k) => g(W0 + k / 4));
  }
  /* 軌道（北から、太陽は右）。月の向きは太陽からの離角 */
  const pos = (j: number, s = g(j)) => {
    const r = (s.distGeo / 384400) * 110,
      a = s.elong * D;
    return [150 + r * Math.cos(a), 150 - r * Math.sin(a)];
  };
  const [mx, my] = pos(jd, st);
  /* 帯の新月から次の新月までの道すじ。近地点が太陽に対して回るので、1 周しても閉じない */
  const nm = bandPh.find((p) => p.q === 0)?.jd ?? W0 + 1;
  const orbD = ser
    .filter((s) => s.jd >= nm && s.jd <= nm + 29.53)
    .map((s) =>
      pos(s.jd, s)
        .map((v) => v.toFixed(1))
        .join(' '),
    )
    .join('L');
  const o: string[] = [
    '<circle class="orb" cx="150" cy="150" r="110"></circle>',
    `<path class="orb2" d="M${orbD}"></path>`,
    '<path class="ax" d="M150 30V270M30 150H270"></path>',
    '<text class="ts" x="268" y="144" text-anchor="end">新月</text><text class="ts" x="156" y="34">上弦</text><text class="ts" x="34" y="144">満月</text><text class="ts" x="156" y="276">下弦</text>',
    '<path class="sunar" d="M276 150H296M290 145L296 150L290 155"></path><text class="ts" x="294" y="168" text-anchor="end">太陽へ</text>',
    '<circle class="earth" cx="150" cy="150" r="11"></circle><path d="M150 139A11 11 0 0 0 150 161Z" style="fill:rgb(0 0 0 / .45)"></path>',
  ];
  for (const a of bandAp) {
    const [x, y] = pos(a.jd);
    o.push(
      `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"></circle><text class="ts" x="${(x + (x > 150 ? 6 : -6)).toFixed(1)}" y="${(y + (y > 150 ? 14 : -4)).toFixed(1)}" text-anchor="${x > 150 ? 'start' : 'end'}">${a.kind === 'peri' ? '近地点' : '遠地点'} ${md(a.jd)}</text>`,
    );
  }
  o.push(
    `<path class="ln2" d="M150 150L${mx.toFixed(1)} ${my.toFixed(1)}"></path><circle class="drk" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="9"></circle><path class="lit" d="M${mx.toFixed(1)} ${(my - 9).toFixed(1)}A9 9 0 0 1 ${mx.toFixed(1)} ${(my + 9).toFixed(1)}Z"></path><circle class="rim" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="9"></circle><text class="mt" x="${(mx + 13).toFixed(1)}" y="${(my - 4).toFixed(1)}">月</text>`,
  );
  $('#orb').innerHTML = o.join('');

  /* 秤動: 地心の地球直下点の 1 か月（6 時間おき）と、今の観測地からの点 */
  /* 観測地から見た地球直下点（1 時間おき）。日周秤動で、地心の線のまわりを 1 日に 1 回まわる */
  const tk = `${W0}|${site.lat}|${site.lon}|${site.h}`;
  if (tserKey !== tk) {
    tserKey = tk;
    const o = obs();
    tser = Array.from({ length: 32 * 24 + 1 }, (_, k) => moonState(W0 + k / 24, o).subObs);
  }
  const sx = (lo: number) => 120 + (lo / 8) * 110,
    sy = (la: number) => 120 - (la / 8) * 110;
  const path = (f: (s: MoonState) => [number, number]) =>
    `M${ser
      .map((s) =>
        f(s)
          .map((v) => v.toFixed(1))
          .join(' '),
      )
      .join('L')}`;
  const full = bandPh.find((p) => p.q === 2);
  const fs = full && g(full.jd);
  $('#lib').innerHTML = [
    '<path class="gr" d="M10 120H230M120 10V230M10 10H230V230H10Z"></path><path class="gr" d="M65 10V230M175 10V230M10 65H230M10 175H230"></path>',
    '<text x="122" y="20">北 8°</text><text x="122" y="226">南 8°</text><text x="14" y="116">西 8°</text><text x="226" y="116" text-anchor="end">東 8°</text>',
    `<path class="ln3" d="M${tser.map((p) => `${sx(p.lon).toFixed(1)} ${sy(p.lat).toFixed(1)}`).join('L')}"></path>`,
    `<path class="ln" d="${path((s) => [sx(s.subObs.lon), sy(s.subObs.lat)])}"></path>`,
    `<circle class="dot" cx="${sx(ser[0].subObs.lon).toFixed(1)}" cy="${sy(ser[0].subObs.lat).toFixed(1)}" r="2.5"></circle><text x="${(sx(ser[0].subObs.lon) + 5).toFixed(1)}" y="${(sy(ser[0].subObs.lat) + 4).toFixed(1)}">${md(W0)}</text>`,
    fs
      ? `<circle class="dot" cx="${sx(fs.subObs.lon).toFixed(1)}" cy="${sy(fs.subObs.lat).toFixed(1)}" r="2.5"></circle><text x="${(sx(fs.subObs.lon) + 5).toFixed(1)}" y="${(sy(fs.subObs.lat) + 12).toFixed(1)}">満月 ${md(fs.jd)}</text>`
      : '',
    moonIcon(sx(st.subObs.lon), sy(st.subObs.lat), 8, st),
  ].join('');
  txt('#lib-aux', `地球直下点 · ${md(W0)}〜${md(W0 + 32)}`);
  txt('#lib-site', `${site.name}から（1 時間おき）`);

  /* 距離（地心） */
  const dx = (j: number) => ((j - W0) / 32) * 1000,
    dy = (km: number) => 30 + ((410000 - km) / 55000) * 240;
  const d: string[] = [
    '<path class="gr" d="M0 73.6H1000M0 160.9H1000M0 248.2H1000"></path><text x="4" y="66">400,000 km</text><text x="4" y="153">380,000</text><text x="4" y="240">360,000</text>',
    `<path class="ln" style="stroke-width:3" d="M${ser.map((s, k) => `${(k * 7.8125).toFixed(1)} ${dy(s.distGeo).toFixed(1)}`).join('L')}"></path>`,
  ];
  for (const a of bandAp)
    d.push(
      `<circle class="dot" cx="${dx(a.jd).toFixed(1)}" cy="${dy(a.km).toFixed(1)}" r="6"></circle><text class="ts" x="${dx(a.jd).toFixed(1)}" y="${(dy(a.km) + (a.kind === 'peri' ? 50 : -18)).toFixed(1)}" text-anchor="middle">${a.kind === 'peri' ? '近地点' : '遠地点'}</text>`,
    );
  /* 月の絵の右上（右端の近くでは左上、上端の近くでは下）に距離を書く */
  const cx = dx(jd),
    cy = dy(st.distGeo),
    left = cx > 760;
  d.push(
    moonIcon(cx, cy, 26, st, 3),
    `<text class="vl${left ? ' e' : ''}" x="${(cx + (left ? -36 : 36)).toFixed(1)}" y="${(cy < 100 ? cy + 54 : cy - 32).toFixed(1)}">${kmStr(st.distGeo)}</text>`,
  );
  $('#dist').innerHTML = d.join('');
  txt('#size-aux', `地心 · ${md(W0)}〜${md(W0 + 32)}`);
}

/** 帯の日時の札と、見かけの大きさの中央の札。現在に合わせて進んでいる間は「現在」 */
const whenStr = () => (live ? `現在 ${hm(jd)}` : `${md(jd)} ${hm(jd)}`);

/* 見かけの大きさ: その年で最も遠い・近いときと今（地心）。小さな月は満月として描く。
   最も近いときの影を左へ、最も遠いときの影を右へ伸ばし、月を押す・乗せるとその月の影を濃くする（中央の月は乗せたときだけ影を出す） */
let sizeKey = '';
function drawSizes(): void {
  const y = local(jd).year;
  const when = whenStr();
  const key = `${y}|${Math.round(st.diam)}|${renderer?.ready}|${or$.value}|${when}`;
  if (key === sizeKey) return;
  sizeKey = key;
  const j0 = calToJd(y, 1, 1);
  const ap = apsides(j0, j0 + 366);
  const far = Math.max(...ap.map((a) => a.km)),
    near = Math.min(...ap.map((a) => a.km));
  const diam = (km: number) => 2 * Math.asin(1737.4 / km) * (180 / Math.PI) * 3600;
  const items: [string, number, string][] = [
    ['最も遠いとき', diam(far), 'f'],
    [when, st.diam, 'c'],
    ['最も近いとき', diam(near), 'n'],
  ];
  const max = diam(near);
  const px = (a: number) => Math.round((80 * a) / max);
  $('#sizes').innerHTML = [
    ...items.map(([, a, k]) => `<i class="shd ${k}" style="height:${px(a)}px"></i>`),
    ...items.map(
      ([t, a, k]) =>
        `<figure class="${k}" tabindex="0"><span class="mbox"><canvas width="${px(a) * 2}" height="${px(a) * 2}" style="width:${px(a)}px;height:${px(a)}px"></canvas></span><span>${t}<br><b>${dms(a)}</b></span></figure>`,
    ),
  ].join('');
  if (renderer?.ready) {
    /* 満月は太陽を観測地の真後ろに置いて描く（太陽の向きだけ替えると、位相角で決まる明るさと測光の極が今のままになる） */
    const fullSt: MoonState = { ...st, phase: 0, sun: st.moon.map((v, i) => v + (st.obs[i] - v) * 400) as Vec3 };
    const cs = document.querySelectorAll<HTMLCanvasElement>('#sizes canvas');
    cs.forEach((cv, k) => {
      renderer?.icon(iconU(k === 1 ? st : fullSt), cv);
    });
  }
  const sj = superJd || supermoon(nowJd());
  $('#size-note').innerHTML = sj ? `次回<b>スーパームーン</b>: ${local(sj).year}/${md(sj)} ${hm(sj)}` : '';
}

/* ---------- 月食 ---------- */
type ERow = [
  number,
  number,
  number,
  number,
  number,
  number,
  string,
  number,
  number,
  number,
  number | null,
  number | null,
  number | null,
];
interface Ecl {
  row: ERow;
  max: number;
  c: ReturnType<typeof eclipseContacts>;
  alt: number;
}
let ecls: Ecl[] = [];
let eIdx = 0;
let eKey = '';
let eclRows: ERow[] | null = null;
const ETYPE: Record<string, string> = { T: '皆既月食', P: '部分月食', N: '半影月食' };
async function loadEcl(): Promise<void> {
  if (eclRows) return;
  try {
    const r = await fetch(`${BASE}moon/eclipses.json`);
    eclRows = (await r.json()) as ERow[];
  } catch {
    eclRows = [];
  }
}
function visibleEcl(): void {
  const key = `${site.lat}|${site.lon}`;
  if (!eclRows || key === eKey) return;
  eKey = key;
  const o = obs();
  ecls = [];
  for (const row of eclRows) {
    const max = calToJd(row[0], row[1], row[2]) + (row[3] - row[4]) / 86400;
    const c = eclipseContacts(max);
    const ts = [c.p1, c.u1, c.u2, c.max, c.u3, c.u4, c.p4].filter((t): t is number => t != null);
    const alts = ts.map((t) => moonState(t, o).alt);
    if (Math.max(...alts) <= 0) continue;
    ecls.push({ row, max, c, alt: moonState(max, o).alt });
  }
  /* 初めは、これから起きる月食のうち、最大のときに月が地平線の上にある最初の回 */
  const n = nowJd();
  const k = ecls.findIndex((e) => e.max > n - 0.5 && e.alt > 0);
  eIdx = k >= 0 ? k : Math.max(0, ecls.length - 1);
}
let eImgKey = '';
function drawEcl(): void {
  txt('#hd-ecl', `${site.name}で見える月食`);
  if (!ecls.length) {
    txt('#e-title', eclRows ? '見える月食がありません' : '読み込み中…');
    return;
  }
  const e = ecls[eIdx];
  const kind = ETYPE[e.row[6][0]] ?? '月食';
  txt('#e-pos', `${eIdx + 1} / ${ecls.length}`);
  txt('#e-title', `${dateStr(e.max).slice(0, 10)} ${kind}`);
  txt('#e-sub', e.alt > 0 ? `（最大のとき高度 ${sgn(e.alt, 0)}°）` : '（一部だけ見える。最大のときは地平線の下）');
  const rows: [string, string][] = [];
  const c = e.c;
  if (c.u1 != null) rows.push(['欠け始め', hm(c.u1)]);
  else if (c.p1 != null) rows.push(['半影食の始め', hm(c.p1)]);
  if (c.u2 != null && c.u3 != null) rows.push(['皆既', `${hm(c.u2)} 〜 ${hm(c.u3)}`]);
  rows.push([
    '最大',
    `${hm(c.max)} · ${c.umag > 0 ? `本影食分 ${c.umag.toFixed(3)}` : `半影食分 ${c.pmag.toFixed(3)}`}`,
  ]);
  if (c.u4 != null) rows.push(['欠け終わり', hm(c.u4)]);
  else if (c.p4 != null) rows.push(['半影食の終わり', hm(c.p4)]);
  $('#e-dl').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
  const ik = `${c.max}|${site.lat}|${site.lon}|${or$.value}`;
  if (renderer?.ready && ik !== eImgKey) {
    eImgKey = ik;
    const s = moonState(c.max, obs());
    renderer.icon(iconU(s, shadowAt(c.max), 'camera'), $<HTMLCanvasElement>('#e-img'));
  }
}
$('#e-prev').addEventListener('click', () => {
  eIdx = Math.max(0, eIdx - 1);
  drawEcl();
});
$('#e-next').addEventListener('click', () => {
  eIdx = Math.min(ecls.length - 1, eIdx + 1);
  drawEcl();
});
$('#ecard').addEventListener('click', () => {
  const e = ecls[eIdx];
  if (e) setJd(e.c.max);
});

/* ---------- 描く ---------- */
function frame(now: number): void {
  raf = 0;
  if (playing) {
    jd += ((now - last) / 86400000) * Number(sp$.value);
    last = now;
    raf = requestAnimationFrame(frame);
  }
  st = moonState(jd, obs());
  sh = shadowNow();
  drawMoon();
  drawNumbers();
  drawBand();
  drawFigs();
  if (full || !playing) {
    drawCal();
    drawSizes();
  }
  if (full) drawEcl();
  full = false;
}
new ResizeObserver(() => later()).observe(view);

/* ---------- 観測地 ---------- */
function setSite(p: Place, syncRows = true): void {
  site = p;
  store('site', p);
  txt('#hd-moon', `${p.name}から見た月`);
  txt('#loc-name', p.sub ? `${p.name}（${p.sub}）` : p.name);
  txt(
    '#loc-coord',
    `${Math.abs(p.lat).toFixed(3)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(3)}°${p.lon >= 0 ? 'E' : 'W'}`,
  );
  if (syncRows) {
    G.set('lat', p.lat, { silent: true });
    G.set('lon', p.lon, { silent: true });
    G.set('h', p.h || 0, { silent: true });
  }
  dayKey = '';
  void loadEcl().then(() => {
    visibleEcl();
    later(true);
  });
  later(true);
}

type Row = [string, string, string, number, number, string];
let places: Row[] | null = null;
async function loadPlaces(): Promise<Row[]> {
  if (!places) places = (await import('../solar-eclipse/places.json')).default as Row[];
  return places;
}
const kata2hira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
async function nearestPlace(lat: number, lon: number, km: number): Promise<Place | null> {
  const list = await loadPlaces();
  let best: Row | null = null;
  let bd = km;
  for (const r of list) {
    const d = 6371 * Math.hypot((r[3] - lat) * D, (r[4] - lon) * D * Math.cos(lat * D));
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
    s ? list.filter((r) => norm(r[0]).includes(s) || r[1].startsWith(s) || (r[5] && norm(r[5]).startsWith(s))) : []
  ).slice(0, 10);
  active = -1;
  if (!hits.length) {
    sugg.hidden = true;
    q.setAttribute('aria-expanded', 'false');
    return;
  }
  sugg.innerHTML = hits
    .map((r, k) => {
      const s2 = moonState(jd, { lat: r[3], lon: r[4], h: 0 });
      return `<li><button type="button" class="sg" data-k="${k}" role="option" aria-selected="false"><b>${esc(r[0])}</b><small>${esc(r[2])}</small><span>高度 ${sgn(s2.alt, 0)}°</span></button></li>`;
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

/* 地図から選ぶ: 正距円筒の世界地図（Natural Earth の陸地、日食のページと同じデータ） */
const mapC = $<HTMLCanvasElement>('#map');
let land: number[][] | null = null;
async function drawMap(): Promise<void> {
  if (!land) land = (await (await fetch(`${BASE}solar-eclipse/land110.json`)).json()) as number[][];
  const c = mapC.getContext('2d');
  if (!c) return;
  const W = mapC.width,
    H = mapC.height;
  c.fillStyle = '#0d1b2a';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#3b4a3f';
  c.beginPath();
  for (const r of land) {
    for (let n = 0; n < r.length; n += 2) {
      const x = ((r[n] / 100 + 180) / 360) * W,
        y = ((90 - r[n + 1] / 100) / 180) * H;
      if (n) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.closePath();
  }
  c.fill('evenodd');
  const x = ((site.lon + 180) / 360) * W,
    y = ((90 - site.lat) / 180) * H;
  c.strokeStyle = '#f2c230';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(x, y, 6, 0, 2 * Math.PI);
  c.stroke();
}
$('#mapbtn').addEventListener('click', () => {
  const box = $('#mapbox');
  box.hidden = !box.hidden;
  $('#mapbtn').setAttribute('aria-expanded', String(!box.hidden));
  if (!box.hidden) void drawMap();
});
mapC.addEventListener('click', async (e) => {
  const r = mapC.getBoundingClientRect();
  const lon = ((e.clientX - r.left) / r.width) * 360 - 180,
    lat = 90 - ((e.clientY - r.top) / r.height) * 180;
  const near = await nearestPlace(lat, lon, 60);
  setSite(near ?? { name: '地図で選んだ地点', sub: '', lat: +lat.toFixed(2), lon: +lon.toFixed(2), h: 0 });
  void drawMap();
});

/* ---------- 始める ---------- */
setSite(site);
try {
  renderer = new MoonRenderer(canvas);
  renderer
    .load(`${BASE}moon/color8.jpg`, `${BASE}moon/height8.png`)
    .then(() => {
      calKey = '';
      bandIcons = '';
      sizeKey = '';
      later(true);
    })
    .catch(() => {
      const m = $('#v-msg');
      m.hidden = false;
      m.textContent = '月面のデータを読み込めませんでした';
    });
} catch {
  renderer = null;
  const m = $('#v-msg');
  m.hidden = false;
  m.textContent = 'このブラウザでは WebGL2 を使えないため、月を描けません';
}
later(true);

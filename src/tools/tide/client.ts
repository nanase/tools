/**
 * 潮の満ち引きのページの入口。開いたときは今の日時で止め、海は毎フレーム計算して描き直す。
 * 早送りは港の潮位のグラフの期間（1 日・1 週間・1 か月）に合わせた速さで日時を進める。グラフを押すとその時刻へ移る
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { initToolPage } from '../../lib/tool-page';
import { drawGraph, drawSky, drawToday, type GraphFig, loadTex, readCols, type SkyGeo, type Span } from './fig';
import {
  ageNoon,
  angles,
  DAY,
  extrema,
  HOUR,
  jstMidnight,
  K_MOON,
  K_SUN,
  makeRing,
  nextShio,
  portTide,
  pullRatio,
  quarters,
  shioAt,
  sky,
  stepRing,
} from './model';

initToolPage();

const SYN = 29.530589;
/** 期間ごとの早送りの速さ [時間/秒] */
const SPEED: Record<Span, number> = { day: 2, week: 12, month: 48 };
/** 海の計算の力の大きさ（月を地球の半径の 4 倍に置いたとき）と、太陽の分の比 */
const F0 = 0.3,
  SUN_K = K_SUN / K_MOON;

const S = {
  run: false,
  sun: true,
  arrows: 'diff' as 'pull' | 'diff',
  span: 'day' as Span,
  t: Date.now(),
  /** 月の距離（地球の半径の倍数）。太陽ありでは 4 に固定 */
  moonD: 4,
  /** 矢印の切り替えの途中（0 月の引力 → 1 中心との差） */
  sE: 1,
};
const ring = makeRing();
const root = $('#td'),
  cvSky = $<HTMLCanvasElement>('#td-sky'),
  cvG = $<HTMLCanvasElement>('#td-graph');

const WD = '日月火水木金土';
const jst = (ms: number): Date => new Date(ms + 9 * HOUR);
const fmtD = (ms: number): string => {
  const d = jst(ms);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WD[d.getUTCDay()]}）`;
};
const fmtMD = (ms: number): string => {
  const d = jst(ms);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
};
const fmtHM = (ms: number): string => {
  const d = jst(ms);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const txt = (id: string, s: string): void => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};

/* ---------- 今日の潮 ---------- */
function today(): void {
  const now = Date.now(),
    age = ageNoon(now),
    nm = shioAt(now);
  txt('#td-tdate', fmtD(now));
  txt('#td-tname', nm);
  $('#td-tname').dataset.k = nm === '大潮' ? 'hi' : nm === '小潮' ? 'lo' : '';
  txt('#td-tage', age.toFixed(1));
  txt('#td-tsp', fmtMD(nextShio('大潮', now)));
  txt('#td-tnp', fmtMD(nextShio('小潮', now)));
  drawToday($<HTMLCanvasElement>('#td-tmoon'), (age / SYN) * 360);
}

/* ---------- 選択 ---------- */
const cSun = new Choice<'moon' | 'sun'>($('#p-sun'), (v) => {
  S.sun = v === 'sun';
  if (S.sun) S.moonD = 4;
  syncArrows();
});
const cSpan = new Choice<Span>($('#p-span'), (v) => {
  S.span = v;
  gDirty = true;
});
const cAr = new Choice<'pull' | 'diff'>($('#p-ar'), (v) => {
  S.arrows = v;
});
S.sun = cSun.value === 'sun';
S.span = cSpan.value;
S.arrows = cAr.value;
/** 矢印の切り替えは月だけのときに使う。太陽ありでは場所を残して隠す */
function syncArrows(): void {
  $('#p-ar').style.visibility = S.sun ? 'hidden' : '';
}
syncArrows();

/* ---------- 早送り ---------- */
const playBtn = $<HTMLButtonElement>('#td-play');
function syncPlay(): void {
  playBtn.setAttribute('aria-pressed', String(S.run));
  $('#td-playLed').classList.toggle('on', S.run);
  txt('#td-playT', S.run ? '一時停止' : '早送り');
}
playBtn.addEventListener('click', () => {
  S.run = !S.run;
  syncPlay();
});
$('#td-now').addEventListener('click', () => {
  S.t = Date.now();
  gDirty = true;
});
syncPlay();

/* ---------- 港の潮位のグラフ ---------- */
let gc: Omit<GraphFig, 't' | 'now' | 'v'> | null = null,
  gDirty = true;
function spanRange(t: number): [number, number] {
  const d0 = jstMidnight(t);
  if (S.span === 'day') return [d0, d0 + DAY];
  if (S.span === 'week') {
    const x0 = d0 - ((jst(t).getUTCDay() + 6) % 7) * DAY; /* 月曜から */
    return [x0, x0 + 7 * DAY];
  }
  if (gc && gc.span === 'month' && t >= gc.x0 && t < gc.x1) return [gc.x0, gc.x1];
  const x0 = jstMidnight(t - 3 * DAY);
  return [x0, x0 + 30 * DAY];
}
function graphData(t: number): Omit<GraphFig, 't' | 'now' | 'v'> {
  const [x0, x1] = spanRange(t);
  if (gc && gc.span === S.span && gc.x0 === x0) return gc;
  const step = (S.span === 'day' ? 5 : S.span === 'week' ? 15 : 30) * 60000,
    curve: [number, number][] = [];
  for (let u = x0; u <= x1; u += step) curve.push([u, portTide(u)]);
  /* 満潮・干潮は計算した点の上で探す（範囲の外は端の値） */
  const at = (u: number): number => curve[Math.min(curve.length - 1, Math.max(0, Math.round((u - x0) / step)))][1];
  const ex = S.span === 'month' ? [] : extrema(at, x0 + step, x1 - step, step);
  const marks = S.span === 'day' ? [] : quarters(x0, x1);
  gc = { span: S.span, x0, x1, curve, ex, marks };
  return gc;
}

/** 次の満潮・干潮（再生位置から 26 時間先まで）。10 分以上進むか、次の満潮・干潮を過ぎたら探し直す */
let nx: { t: number; hi?: number; lo?: number } = { t: Number.NaN };
function nextHiLo(t: number): { hi?: number; lo?: number } {
  const stale =
    !(Math.abs(t - nx.t) < 10 * 60000) || (nx.hi !== undefined && t > nx.hi) || (nx.lo !== undefined && t > nx.lo);
  if (stale) {
    const ex = extrema(portTide, t, t + 26 * HOUR, 15 * 60000);
    nx = { t, hi: ex.find((p) => p.hi)?.ms, lo: ex.find((p) => !p.hi)?.ms };
  }
  return nx;
}

/** 港の札: 25 分前後の潮位と比べる */
function portTag(t: number, v: number): string {
  const a = portTide(t - 25 * 60000),
    b = portTide(t + 25 * 60000);
  if (v >= a && v >= b) return '満潮';
  if (v <= a && v <= b) return '干潮';
  return b > v ? '満ち潮' : '引き潮';
}

/** 指やマウスを図の外へ動かしても追う（取れない環境では諦める） */
function capture(el: Element, e: PointerEvent): void {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* 取れなくても押した位置へは動かす */
  }
}

/* ---------- グラフを押して時刻へ ---------- */
let gx: { left: number; right: number } | null = null,
  gDrag = false;
function onGraph(e: PointerEvent): void {
  if (!gx || !gc) return;
  const rc = cvG.getBoundingClientRect(),
    u = (e.clientX - rc.left - gx.left) / (gx.right - gx.left);
  S.t = gc.x0 + Math.min(1, Math.max(0, u)) * (gc.x1 - gc.x0);
  gDirty = true;
}
cvG.addEventListener('pointerdown', (e) => {
  gDrag = true;
  if (e.pointerType === 'mouse') capture(cvG, e);
  onGraph(e);
});
cvG.addEventListener('pointermove', (e) => {
  if (gDrag && e.pointerType === 'mouse') onGraph(e);
});
const endG = () => {
  gDrag = false;
};
cvG.addEventListener('pointerup', endG);
cvG.addEventListener('pointercancel', endG);

/* ---------- 月のドラッグ ---------- */
let geo: SkyGeo | null = null,
  drag = false;
/** 月の向き θ [rad] に合う日時へ（太陽から測った赤経の差で合わせる） */
function moveTo(th: number): void {
  for (let i = 0; i < 3; i++) {
    const cur = angles(sky(S.t)).moon,
      d = ((((th - cur) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    S.t += (d / (2 * Math.PI)) * SYN * DAY;
  }
  gDirty = true;
}
/** 月だけの図で、月と札が図に収まる距離まで */
function fitMoon(th: number): void {
  if (!geo) return;
  const { cx, cy, R, w, h } = geo,
    mR = Math.max(10, R * 0.22),
    ux = Math.cos(th),
    uy = -Math.sin(th);
  const lim = Math.min(
    ux > 0 ? (w - cx - mR - 8) / ux : ux < 0 ? (cx - mR - 8) / -ux : 1e9,
    uy < 0 ? (cy - mR - 34) / -uy : uy > 0 ? (h - cy - mR - 30) / uy : 1e9,
  );
  S.moonD = Math.max(2.4, Math.min(S.moonD, lim / R));
}
function onDrag(e: PointerEvent): void {
  if (!geo) return;
  const rc = cvSky.getBoundingClientRect(),
    x = e.clientX - rc.left - geo.cx,
    y = -(e.clientY - rc.top - geo.cy);
  moveTo(Math.atan2(y, x));
  if (!S.sun) S.moonD = Math.min(7, Math.max(2.4, Math.hypot(x, y) / geo.R));
}
cvSky.addEventListener('pointerdown', (e) => {
  drag = true;
  capture(cvSky, e);
  onDrag(e);
});
cvSky.addEventListener('pointermove', (e) => {
  if (drag) onDrag(e);
});
const endDrag = () => {
  drag = false;
};
cvSky.addEventListener('pointerup', endDrag);
cvSky.addEventListener('pointercancel', endDrag);

/* ---------- 海と描画 ---------- */
function stepSea(): void {
  const s = sky(S.t),
    p = pullRatio(s),
    a = angles(s),
    F: [number, number][] = [[F0 * (4 / S.moonD) ** 3 * p.moon, a.moon]];
  if (S.sun) F.push([F0 * SUN_K * p.sun, Math.PI]);
  for (let i = 0; i < 8; i++) stepRing(ring, 0.012, F, 0.25);
}

let lastT = Number.NaN;
function draw(): void {
  const t = S.t,
    s = sky(t),
    a = angles(s),
    v = portTide(t);
  if (!S.sun) fitMoon(a.moon);
  geo = drawSky(cvSky, {
    sun: S.sun,
    arrows: S.sun ? 'diff' : S.arrows,
    sE: S.sE,
    moonTh: a.moon,
    portTh: a.port,
    moonD: S.sun ? 4 : S.moonD,
    sunK: SUN_K,
    ring,
    shio: shioAt(t),
    portTag: portTag(t, v),
    drops: !RM.matches,
  });
  if (gDirty || t !== lastT) {
    gDirty = false;
    lastT = t;
    gx = drawGraph(cvG, { ...graphData(t), t, now: Date.now(), v });
    const n = nextHiLo(t);
    txt('#td-when', `${fmtD(t)} ${fmtHM(t)}`);
    txt('#s-shio', shioAt(t));
    txt('#s-hi', n.hi === undefined ? '—' : fmtHM(n.hi));
    txt('#s-lo', n.lo === undefined ? '—' : fmtHM(n.lo));
    txt('#s-now', `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)} cm`);
  }
}

let last = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.run && !drag && !gDrag) S.t += dt * SPEED[S.span] * HOUR;
  S.sE += ((S.sun || S.arrows === 'diff' ? 1 : 0) - S.sE) * Math.min(1, dt * 4);
  stepSea();
  draw();
  requestAnimationFrame(tick);
}

/* ---------- テーマと大きさ ---------- */
const recolor = (): void => {
  readCols(root);
  gDirty = true;
  today();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  gDirty = true;
  today();
}).observe(cvG);

readCols(root);
today();
/* 写真は届いたら次のフレームから使う */
loadTex('earth', `${import.meta.env.BASE_URL}tide/earth.jpg`, () => undefined);
loadTex('moon', `${import.meta.env.BASE_URL}moon/color8.jpg`, () => undefined);
/* 開いたときに海が膨らんだ所から始める */
for (let i = 0; i < 60; i++) stepSea();
requestAnimationFrame(tick);

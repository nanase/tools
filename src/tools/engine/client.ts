/**
 * エンジン音響モデルのページ。音は AudioWorklet（worklet.ts）の EngineSim、図は主スレッドのもう 1 つの EngineSim
 * （音と同じ回転数とスロットルで回転数を保ち、スローのときはゆっくり進める）で描く。全開のトルクの曲線は Worker で求める
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { DV, SW } from '../../lib/scope';
import { initToolPage } from '../../lib/tool-page';
import { EngineAudio } from './audio';
import { EngineSim } from './engine';
import { EngineFigure, PIPE_N } from './figure';
import { CUT, type EngKey, IDLE, MASS, MECH, type RunKey, SLOPE, SPEED, VOL } from './params';
import { type EngineId, liftAt, type MufflerId, specOf } from './spec';
import { WAVE_DEG, WAVE_NB } from './wave';
import type { CurveJob, CurveReply } from './worker';
import type { StatMsg, WaveMsg } from './worklet';

initToolPage();

const grp = (v: number) => Math.round(v).toLocaleString('en-US');
const fx = (v: number, d: number) => v.toFixed(d);
const NS = 'http://www.w3.org/2000/svg';
const el = (tag: string, a: Record<string, string | number>, text?: string): SVGElement => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
};
const u = (v: string, unit: string) => `${v}<span class="u">${unit}</span>`;

/* ---------- 状態 ---------- */
const audio = new EngineAudio();
let eng: EngineId = 'ja65',
  muf: MufflerId = 'stock',
  spec = specOf(eng, muf),
  running = false,
  mode: 'drive' | 'hold' = 'drive',
  /** 保つ回転数・アイドリング・回転の上限 [rpm]・機械音 [dB]・勾配 [%]・積載重量 [kg] */
  rpmSet = 4750,
  slope = 0,
  rider = 65,
  idle = 1400,
  cut = 8000,
  mechDb = 0,
  /** パッドで決めた今のスロットル [%] */
  thCur = 0,
  /** ブレーキ（0〜1） */
  brCur = 0,
  stat: StatMsg | null = null;
const VEHICLE = 118;
const runSet = () => ({
  throttle: thCur / 100,
  mode,
  rpm: rpmSet,
  idle,
  cut,
  mech: 10 ** (mechDb / 20),
  slope,
  brake: brCur,
  mass: VEHICLE + rider,
});

/* ---------- 図のための模型（音と同じ回転数・スロットルで回転数を保つ） ---------- */
const VIS_FS = 48000;
function makeVis(): EngineSim {
  const e = new EngineSim(spec, VIS_FS, running && stat ? stat.rpm : idle);
  e.mode = 'hold';
  e.idleRpm = idle;
  e.cutRpm = cut;
  e.throttle = thCur / 100;
  /* 管の波が落ち着くまで少し回す */
  for (let i = 0; i < VIS_FS * 0.3; i++) e.step();
  return e;
}
let vis = makeVis();
function timingOf() {
  return {
    in: [spec.inValve.open, spec.inValve.dur] as [number, number],
    ex: [spec.exValve.open, spec.exValve.dur] as [number, number],
    lift: (deg: number, ex: boolean) => liftAt(ex ? spec.exValve : spec.inValve, deg),
  };
}
/* 図の並べ方: 枠の幅が 760 px より狭ければ縦長（管を下へ折る） */
const engW = $<HTMLElement>('.engw'),
  isNarrow = () => engW.clientWidth < 760,
  fig = new EngineFigure($<SVGSVGElement>('#eng'), spec.exhaust, timingOf(), isNarrow());
new ResizeObserver(() => fig.setLayout(isNarrow())).observe(engW);

/* ---------- 入力 ---------- */
new ParamGroup<RunKey>([SPEED, SLOPE], (v, k) => {
  rpmSet = v.n;
  slope = v.slope;
  if (k === 'n') audio.set({ rpm: rpmSet });
  if (k === 'slope') audio.set({ slope });
});
new ParamGroup<'mass'>([MASS], (v) => {
  rider = v.mass;
  audio.set({ mass: VEHICLE + rider });
});
new ParamGroup<'vol'>([VOL], (v) => audio.vol(v.vol));
new ParamGroup<EngKey>([IDLE, CUT, MECH], (v, k) => {
  idle = v.idle;
  cut = v.cut;
  mechDb = v.mech;
  audio.set({ idle, cut, mech: 10 ** (mechDb / 20) });
  vis.idleRpm = idle;
  vis.cutRpm = cut;
  if (k === 'cut') requestCurve();
});
const setLoad = (v: 'drive' | 'hold') => {
  mode = v;
  /* 使わない項目は隠す: 回転数は回転数固定だけ、勾配・ギアと速度・ブレーキ・積載重量・変速のキーは走行だけ */
  $('#p-n').hidden = v !== 'hold';
  for (const id of ['#p-slope', '#drv', '#brk', '#g-run', '#h-drv']) $(id).hidden = v !== 'drive';
  audio.set({ mode, rpm: rpmSet });
};
const loadC = new Choice<'drive' | 'hold'>($('#p-load'), setLoad);
setLoad(loadC.value);
const engC = new Choice<EngineId>($('#p-eng'), (v) => {
  eng = v;
  rebuild();
});
const mufC = new Choice<MufflerId>($('#p-muf'), (v) => {
  muf = v;
  rebuild();
});
let slow = 50,
  real = false,
  prange = 50,
  pvMode: 'pv' | 'pt' = 'pv';
const slC = new Choice<string>($('#p-sl'), (v) => {
  slow = Number(v);
});
const prC = new Choice<string>($('#p-pr'), (v) => {
  prange = Number(v);
  fig.setRange(prange);
  $('#e-pr').textContent = `±${prange} kPa`;
});
const evC = new Choice<string>($('#p-ev'), (v) => {
  real = v === 'real';
});
const pvC = new Choice<'pv' | 'pt'>($('#p-pv'), (v) => {
  pvMode = v;
  pvAxes();
});
const ovC = new Choice<string>($('#p-ov'), (v) => {
  $('#v-yt').hidden = v !== 'yt';
  $('#v-sp').hidden = v !== 'sp';
});
slow = Number(slC.value);
prange = Number(prC.value);
real = evC.value === 'real';
pvMode = pvC.value;
$('#v-yt').hidden = ovC.value !== 'yt';
$('#v-sp').hidden = ovC.value !== 'sp';
fig.setRange(prange);
$('#e-pr').textContent = `±${prange} kPa`;
/* 保存したエンジンとマフラーは、Choice が生成の直後（マイクロタスク）に onChange で戻す */
void engC;
void mufC;

/** p–V の点（容積 [cm³]、圧力 [bar]、角度 [°]）: 直前の 1 サイクルと、いまのサイクル */
let pvLast: [number, number, number][] = [],
  pvCur: [number, number, number][] = [],
  pvDeg = -10;

/* ---------- 諸元 ---------- */
function showSpec(): void {
  const vd = (Math.PI / 4) * spec.bore ** 2 * spec.stroke * 1e6;
  $('#c-vd').innerHTML = u(fx(vd, 1), 'cm³');
  $('#c-bs').innerHTML = u(`${fx(spec.bore * 1000, 1)} × ${fx(spec.stroke * 1000, 1)}`, 'mm');
  $('#c-cr').textContent = fx(spec.cr, 1);
  $('#c-tq').innerHTML =
    `${u(String(spec.rated.torque), 'N·m')} <span class="m-sub">${grp(spec.rated.torqueRpm)} rpm</span>`;
  $('#c-pw').innerHTML =
    `${u(String(spec.rated.power / 1000), 'kW')} <span class="m-sub">${grp(spec.rated.powerRpm)} rpm</span>`;
  $('#c-ex').innerHTML = u(
    fx(
      spec.exhaust.reduce((s, g) => s + g.len, 0),
      2,
    ),
    'm',
  );
}
showSpec();

/** エンジン・マフラーを替えたとき: 音の模型を替え（回っていれば回転と車体の状態を引き継ぐ）、図・曲線・諸元を作り直す */
function rebuild(): void {
  spec = specOf(eng, muf);
  if (running) audio.start(eng, muf, runSet(), true);
  vis = makeVis();
  fig.setPipe(spec.exhaust);
  waveMarks();
  showSpec();
  pvLast = [];
  pvCur = [];
  requestCurve();
}

/* ---------- 運転 ---------- */
const runBtn = $('#runBtn'),
  runLed = $('#runLed'),
  runT = $('#runT'),
  sndMsg = $('#snd-msg');
function setRun(on: boolean): void {
  running = on;
  runBtn.setAttribute('aria-pressed', String(on));
  runLed.classList.toggle('on', on);
  runT.textContent = on ? '運転中' : '運転';
}
runBtn.addEventListener('click', async () => {
  if (running) {
    audio.stop();
    setRun(false);
    stat = null;
    return;
  }
  sndMsg.textContent = '';
  if (!(await audio.ready())) {
    sndMsg.textContent = 'このブラウザでは音を鳴らせません';
    return;
  }
  audio.start(eng, muf, runSet());
  setRun(true);
});
audio.onStat = (m) => {
  if (running) stat = m;
};

/* ---------- スロットルのパッド ---------- */
/* 押している間だけ、押した位置（右ほど大きく）まで開く。離すと「離したときの開き」へ戻る。
   実物のグリップのように、全閉から全開まで 0.15 s、全開から全閉まで 0.1 s かけて動かす（毎フレームの frame で） */
const thr = $('#thr'),
  thrF = $('#thr-f'),
  thrC = $('#thr-c'),
  thrT = $('#thr-t'),
  HINT = thrT.textContent ?? '';
let target = 0,
  held = false,
  /** 固定（離しても開きを保つ）と、その開き [%] */
  locked = false,
  lockVal = 0;
const lockBtn = $('#lockBtn'),
  lockLed = $('#lockLed');
lockBtn.addEventListener('click', () => {
  locked = !locked;
  lockVal = locked ? thCur : 0;
  lockBtn.setAttribute('aria-pressed', String(locked));
  lockLed.classList.toggle('on', locked);
});
const press = (v: number) => {
  held = true;
  target = v;
  thr.classList.add('on');
  thrC.hidden = false;
  thrC.style.left = `${v}%`;
};
const release = () => {
  if (held && locked) lockVal = target;
  held = false;
  thr.classList.remove('on');
  thrC.hidden = true;
};
const at = (e: PointerEvent) => {
  const r = thr.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100;
};
thr.addEventListener('pointerdown', (e) => {
  thr.setPointerCapture(e.pointerId);
  press(at(e));
});
thr.addEventListener('pointermove', (e) => {
  if (held && thr.hasPointerCapture(e.pointerId)) press(at(e));
});
thr.addEventListener('pointerup', release);
thr.addEventListener('pointercancel', release);
/* ブレーキのパッド: 押している間だけ、押した位置（右ほど強く）でかける */
const brk = $('#brk'),
  brkF = $('#brk-f'),
  brkT = $('#brk-t'),
  BHINT = brkT.textContent ?? '';
let brTarget = 0,
  brHeld = false;
const brAt = (e: PointerEvent) => {
  const r = brk.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
};
brk.addEventListener('pointerdown', (e) => {
  brk.setPointerCapture(e.pointerId);
  brHeld = true;
  brTarget = brAt(e);
  brk.classList.add('on');
});
brk.addEventListener('pointermove', (e) => {
  if (brHeld && brk.hasPointerCapture(e.pointerId)) brTarget = brAt(e);
});
const brRelease = () => {
  brHeld = false;
  brk.classList.remove('on');
};
brk.addEventListener('pointerup', brRelease);
brk.addEventListener('pointercancel', brRelease);
/* 変速 */
const shift = (dir: 1 | -1) => {
  if (running && mode === 'drive') audio.shift(dir);
};
$('#upBtn').addEventListener('click', () => shift(1));
$('#dnBtn').addEventListener('click', () => shift(-1));
/* キーボード: Space で全開、1〜9 で 10〜90 %、0 で 100 %（押している間）。入力欄・ボタン・ほかのスライダーにいるときは使わない */
let key = '';
const keyVal = (e: KeyboardEvent): number | null =>
  e.code === 'Space' ? 100 : /^Digit[0-9]$/.test(e.code) ? Number(e.code.slice(5)) * 10 || 100 : null;
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (
    e.repeat ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    (t instanceof Element && t.closest('input,select,textarea,button,summary,[role="slider"]:not(#thr):not(#brk)'))
  )
    return;
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    e.preventDefault();
    shift(e.code === 'ArrowUp' ? 1 : -1);
    return;
  }
  if (e.code === 'KeyB') {
    e.preventDefault();
    brHeld = true;
    brTarget = 1;
    brk.classList.add('on');
    return;
  }
  const v = keyVal(e);
  if (v == null) return;
  e.preventDefault();
  key = e.code;
  press(v);
});
document.addEventListener('keyup', (e) => {
  if (e.code === key) {
    key = '';
    release();
  }
  if (e.code === 'KeyB') brRelease();
});
window.addEventListener('blur', () => {
  release();
  brRelease();
});

/* ---------- トルクと出力 ---------- */
const H8 = 8 * DV,
  Xr = (r: number) => (r / 10000) * SW,
  Yt = (t: number) => H8 - (t / 16) * H8,
  Yp = (p: number) => H8 - (p / 8) * H8;
let curve: CurveReply | null = null,
  curveId = 0;
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (e: MessageEvent<CurveReply>) => {
  if (e.data.id !== curveId) return;
  curve = e.data;
  drawCurve();
};
const tqG = $<SVGGElement>('#tq-g'),
  tqCurve = el('g', {}),
  tqOp = el('g', {});
tqG.append(tqCurve, tqOp);
for (let k = 0; k <= 10; k += 2)
  tqG.append(el('text', { x: Xr(k * 1000), y: H8 + 14, 'text-anchor': 'middle' }, k ? `${k}k` : '0'));
for (let k = 0; k <= 8; k += 2) {
  tqG.append(el('text', { x: -6, y: Yt(k * 2) + 4, 'text-anchor': 'end' }, String(k * 2)));
  tqG.append(el('text', { x: SW + 6, y: Yp(k) + 4 }, String(k)));
}
function drawCurve(): void {
  tqCurve.replaceChildren();
  const r = spec.rated;
  tqCurve.append(
    el('circle', { class: 'pub', cx: Xr(r.torqueRpm), cy: Yt(r.torque), r: 4.5 }),
    el('circle', { class: 'pub', cx: Xr(r.powerRpm), cy: Yp(r.power / 1000), r: 4.5 }),
    el('text', { x: Xr(r.torqueRpm) + 8, y: Yt(r.torque) + 18 }, `${r.torque} N·m`),
    el('text', { x: Xr(r.powerRpm) + 8, y: Yp(r.power / 1000) - 8 }, `${r.power / 1000} kW`),
  );
  if (!curve) {
    tqCurve.append(el('text', { x: SW / 2, y: H8 / 2, 'text-anchor': 'middle' }, '計算しています'));
    return;
  }
  let dt = '',
    dp = '';
  curve.rpm.forEach((n, i) => {
    const t = curve?.torque[i] ?? 0,
      p = (t * n * Math.PI) / 30 / 1000;
    dt += `${i ? 'L' : 'M'}${fx(Xr(n), 1)} ${fx(Yt(t), 1)}`;
    dp += `${i ? 'L' : 'M'}${fx(Xr(n), 1)} ${fx(Yp(p), 1)}`;
  });
  tqCurve.prepend(el('path', { class: 't1', d: dt }), el('path', { class: 't2', d: dp }));
}
function requestCurve(): void {
  curve = null;
  drawCurve();
  worker.postMessage({ id: ++curveId, eng, muf, cut } satisfies CurveJob);
}
requestCurve();

/* ---------- 筒内の圧力 ---------- */
const pvG = $<SVGGElement>('#pv-g'),
  pvAx = el('g', {}),
  pvOld = el('path', { class: 't1 dim' }),
  pvNow = el('path', { class: 't1' }),
  pvDot = el('circle', { class: 'opn', r: 3.5 }),
  H6 = 6 * DV;
pvG.append(pvAx, pvOld, pvNow, pvDot);
const lv0 = 1,
  lv1 = 2.3,
  lp0 = -0.7,
  lp1 = 2;
let ptMax = 60;
const PX = (v: number, deg: number) =>
    pvMode === 'pv' ? ((Math.log10(v) - lv0) / (lv1 - lv0)) * SW : (deg / 720) * SW,
  PY = (p: number) =>
    pvMode === 'pv'
      ? H6 - ((Math.log10(Math.max(0.2, p)) - lp0) / (lp1 - lp0)) * H6
      : H6 - (Math.min(p, ptMax * 1.05) / ptMax) * H6;
function pvAxes(): void {
  pvAx.replaceChildren();
  $('#pv-x').textContent = pvMode === 'pv' ? '容積' : 'クランク角';
  $('#pv-xs').textContent = pvMode === 'pv' ? 'LOG' : '72°/div';
  $('#pv-ys').textContent = pvMode === 'pv' ? 'LOG' : `${fx(ptMax / 6, ptMax < 12 ? 1 : 0)} bar/div`;
  if (pvMode === 'pv') {
    for (const v of [10, 20, 50, 100, 200])
      pvAx.append(el('text', { x: PX(v, 0), y: H6 + 14, 'text-anchor': v === 200 ? 'end' : 'middle' }, String(v)));
    for (const p of [0.2, 1, 10, 50]) pvAx.append(el('text', { x: -6, y: PY(p) + 4, 'text-anchor': 'end' }, String(p)));
    pvAx.append(el('path', { class: 'opl', d: `M0 ${fx(PY(1.013), 1)}H${SW}`, opacity: 0.5 }));
  } else {
    for (const [d, lb] of [
      [0, '吸気 TDC'],
      [180, 'BDC'],
      [360, '燃焼 TDC'],
      [540, 'BDC'],
    ] as const)
      pvAx.append(el('text', { x: PX(0, d), y: H6 + 14, 'text-anchor': d === 0 ? 'start' : 'middle' }, lb));
    for (let k = 0; k <= 6; k += 2)
      pvAx.append(el('text', { x: -6, y: PY((ptMax * k) / 6) + 4, 'text-anchor': 'end' }, fx((ptMax * k) / 6, 0)));
  }
}
const pathOf = (pts: readonly [number, number, number][]) => {
  let d = '',
    prev = -1;
  for (const [v, p, deg] of pts) {
    const x = PX(v, deg);
    d += `${!d || (pvMode === 'pt' && x < prev) ? 'M' : 'L'}${fx(x, 1)} ${fx(PY(p), 1)}`;
    prev = x;
  }
  return d;
};
function drawPV(): void {
  pvOld.setAttribute('d', pathOf(pvLast));
  pvNow.setAttribute('d', real ? '' : pathOf(pvCur));
  const c = pvCur[pvCur.length - 1];
  if (c && !real && running) {
    pvDot.setAttribute('cx', fx(PX(c[0], c[2]), 1));
    pvDot.setAttribute('cy', fx(PY(c[1]), 1));
    pvDot.removeAttribute('visibility');
  } else pvDot.setAttribute('visibility', 'hidden');
}
pvAxes();

/* ---------- 音の波形とスペクトラム ---------- */
const waveBox = $<HTMLDetailsElement>('details.a-wave'),
  wT1 = $('#w-t1'),
  sT1 = $('#s-t1'),
  H4 = 4 * DV;
{
  const ax = $<SVGGElement>('#s-axes');
  for (let k = 0; k <= 2000; k += 400)
    ax.append(el('text', { x: (k / 2000) * SW, y: H4 + 14, 'text-anchor': 'middle' }, String(k)));
  for (let db = 20; db <= 100; db += 20)
    ax.append(el('text', { x: -6, y: H4 - ((db - 20) / 80) * H4 + 4, 'text-anchor': 'end' }, String(db)));
}
let fdBuf = new Float32Array(8192),
  /** 音の模型から届いた、燃焼の上死点でトリガを掛けた 2 サイクルの波形（クランク角の区間ごとの最小と最大） */
  wave: WaveMsg | null = null,
  waveDrawn: WaveMsg | null = null,
  scopeOn = false;
audio.onWave = (m) => {
  wave = m;
};
/* 横軸（クランク角）の目盛りの名前と、排気弁が開く角度の印（エンジンを替えたときも描き直す） */
{
  const ax = $<SVGGElement>('#w-axes'),
    X = (deg: number) => (deg / WAVE_DEG) * SW;
  for (const [d, lb] of [
    [0, '燃焼 上死点'],
    [360, '吸気 上死点'],
    [720, '燃焼 上死点'],
    [1080, '吸気 上死点'],
  ] as const)
    ax.append(el('text', { x: fx(X(d) + 3, 1), y: H4 + 14 }, lb));
}
function waveMarks(): void {
  const evo = spec.exValve.open - 360,
    X = (deg: number) => fx((deg / WAVE_DEG) * SW, 1);
  $('#w-trg').setAttribute('d', `M${X(evo)} 0V${H4}M${X(evo + 720)} 0V${H4}`);
  const t = $('#w-evo');
  t.setAttribute('x', X(evo + 3));
  t.textContent = '排気弁開放';
}
waveMarks();
function drawWave(): void {
  const an = audio.analyser,
    yt = !$('#v-yt').hidden,
    want = waveBox.open && running && yt;
  if (want !== scopeOn) {
    scopeOn = want;
    audio.scope(want);
    if (!want) wave = null;
  }
  if (!waveBox.open || !an || !running) return;
  if (fdBuf.length !== an.frequencyBinCount) fdBuf = new Float32Array(an.frequencyBinCount);
  if (yt) {
    const w = wave;
    if (!w || w === waveDrawn) return;
    waveDrawn = w;
    const mm = w.mm,
      nb = WAVE_NB;
    let pk = 0;
    for (const v of mm) pk = Math.max(pk, Math.abs(v));
    const vd = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find((v) => v * 2 >= pk) ?? 50;
    let d = '';
    for (let px = 0; px < SW; px++) {
      let lo = Number.POSITIVE_INFINITY,
        hi = Number.NEGATIVE_INFINITY;
      for (
        let b = Math.floor((px * nb) / SW);
        b < Math.max(Math.floor(((px + 1) * nb) / SW), Math.floor((px * nb) / SW) + 1);
        b++
      ) {
        lo = Math.min(lo, mm[2 * b]);
        hi = Math.max(hi, mm[2 * b + 1]);
      }
      if (hi >= lo) d += `M${px} ${fx(H4 / 2 - (hi / vd) * DV, 1)}V${fx(H4 / 2 - (lo / vd) * DV + 0.5, 1)}`;
    }
    wT1.setAttribute('d', d);
    $('#w-vd').textContent = `${vd} Pa`;
    $('#w-hd').textContent = `${WAVE_DEG / 10}°`;
  } else {
    an.getFloatFrequencyData(fdBuf);
    const df = audio.fs / an.fftSize;
    let d = '';
    for (let k = 1; k * df <= 2000; k++) {
      const db = Math.min(100, Math.max(20, fdBuf[k] + 94));
      d += `${k > 1 ? 'L' : 'M'}${fx(((k * df) / 2000) * SW, 1)} ${fx(H4 - ((db - 20) / 80) * H4, 1)}`;
    }
    sT1.setAttribute('d', d);
  }
}

/* ---------- 計算結果と上の帯 ---------- */
const vdM3 = () => (Math.PI / 4) * spec.bore ** 2 * spec.stroke;
/** ガソリンの密度 [kg/L] */
const FUEL_RHO = 0.74;
function showStat(): void {
  const m = running ? stat : null,
    s = m?.s;
  const set = (id: string, h: string) => {
    $(`#${id}`).innerHTML = h;
  };
  if (!m || !s) {
    for (const id of ['mN', 'mT', 'mP', 'mV']) $(`#${id}`).textContent = '—';
    $('#d-g').textContent = 'N';
    $('#d-v').textContent = '0.0';
    $('#d-fu').textContent = '0.000';
    $('#d-fe').textContent = '—';
    for (const id of [
      'o-n',
      'o-t',
      'o-p',
      'o-imep',
      'o-bmep',
      'o-ve',
      'o-pm',
      'o-tx',
      'o-xr',
      'o-map',
      'o-fu',
      'o-fr',
      'o-bsfc',
      'o-spl',
    ])
      set(id, '—');
    set('o-ns', running ? '' : '停止');
    set('o-pms', '');
    $('#tq-rd').textContent = '';
    tqOp.replaceChildren();
    return;
  }
  const n = m.rpm,
    T = s.torque,
    P = (T * n * Math.PI) / 30 / 1000;
  $('#mN').textContent = `${grp(n)} rpm`;
  $('#mT').textContent = `${fx(T, 2)} N·m`;
  $('#mP').textContent = `${fx(P, 2)} kW`;
  const kmh = m.v * 3.6,
    gearT = m.shifting ? '–' : m.gear === 0 ? 'N' : String(m.gear);
  $('#mV').textContent = mode === 'drive' ? `${fx(kmh, 1)} km/h ${gearT === 'N' ? 'N' : `${gearT} 速`}` : '–';
  $('#d-g').textContent = gearT;
  $('#d-v').textContent = fx(kmh, 1);
  $('#d-d').textContent = fx(m.dist / 1000, 2);
  /* 使った燃料 [L]（ガソリンの密度 0.74 kg/L）と燃費（走行距離 ÷ 使った燃料。少ないうちは出さない） */
  const fuelL = m.fuel / FUEL_RHO;
  $('#d-fu').textContent = fx(fuelL, 3);
  $('#d-fe').textContent = fuelL >= 0.001 && m.dist >= 50 ? fx(m.dist / 1000 / fuelL, 2) : '—';
  set('o-n', u(grp(n), 'rpm'));
  set('o-ns', mode === 'hold' ? '回転数固定' : m.gear === 0 ? 'N' : `${m.gear} 速`);
  set('o-t', u(fx(T, 2), 'N·m'));
  set('o-p', u(fx(P, 2), 'kW'));
  set('o-imep', u(fx(s.imep / 1e5, 2), 'bar'));
  set('o-bmep', u(fx((4 * Math.PI * T) / vdM3() / 1e5, 2), 'bar'));
  set('o-ve', fx(s.ve, 3));
  set('o-pm', u(fx(s.pmax / 1e5, 1), 'bar'));
  set('o-pms', s.pmax > 1.5e5 ? `上死点の後 ${Math.round(s.aPmax)}°` : '');
  set('o-tx', u(grp(s.tExh), 'K'));
  set('o-xr', fx(s.xr, 3));
  set('o-map', u(fx(s.map / 1000, 1), 'kPa'));
  set(
    'o-fu',
    !s.fuel
      ? '<span class="cut-tag">カット（減速）</span>'
      : s.limit > 0
        ? `噴射（上限で ${Math.round(s.limit * 100)} % 抑える）`
        : '噴射',
  );
  set('o-spl', u(fx(20 * Math.log10(Math.max(1e-6, s.prms) / 2e-5), 1), 'dB'));
  /* 燃料の消費 [L/h] と燃料消費率（正味の出力あたり）[g/kWh] */
  const fuelKgS = (s.mFuel * s.rpm) / 120;
  set('o-fr', u(fx((fuelKgS / FUEL_RHO) * 3600, 2), 'L/h'));
  set('o-bsfc', P > 0.05 && fuelKgS > 0 ? u(grp((fuelKgS * 3.6e9) / (P * 1000)), 'g/kWh') : '—');
  $('#tq-rd').textContent = `● ${grp(n)} rpm　${fx(T, 2)} N·m　${fx(P, 2)} kW`;
  tqOp.replaceChildren(
    el('path', { class: 'opl', d: `M${fx(Xr(n), 1)} 0V${H8}` }),
    el('circle', { class: 'opn', cx: fx(Xr(n), 1), cy: fx(Yt(Math.max(0, T)), 1), r: 4 }),
    el('circle', { class: 'opn', cx: fx(Xr(n), 1), cy: fx(Yp(Math.max(0, P)), 1), r: 4 }),
  );
}
showStat();

/* ---------- 毎フレーム ---------- */
const STROKES = ['吸気行程', '圧縮行程', '膨張行程', '排気行程'];
let lastT = 0,
  lastUi = 0;
function frame(t: number): void {
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
  lastT = t;
  /* スロットル: パッドを押している間はその位置、離したら「離したときの開き」へ */
  const goal = held ? target : locked ? lockVal : 0,
    prev = thCur;
  thCur = goal > thCur ? Math.min(goal, thCur + (100 / 0.15) * dt) : Math.max(goal, thCur - (100 / 0.1) * dt);
  thrF.style.width = `${thCur}%`;
  thr.setAttribute('aria-valuenow', String(Math.round(thCur)));
  thr.setAttribute('aria-valuetext', thCur < 0.5 ? '閉じている' : `${Math.round(thCur)} %`);
  thrT.textContent = locked
    ? `固定 ${Math.round(held ? target : lockVal)} %`
    : held || thCur >= 0.5
      ? `スロットル ${Math.round(thCur)} %`
      : running
        ? HINT
        : '「運転」を押すとエンジンが掛かります';
  if (thCur !== prev && running) audio.set({ throttle: thCur / 100 });
  /* ブレーキ: かけるのは 0.1 s、離すのは 0.05 s で全域 */
  const bGoal = brHeld ? brTarget : 0,
    bPrev = brCur;
  brCur = bGoal > brCur ? Math.min(bGoal, brCur + dt / 0.1) : Math.max(bGoal, brCur - dt / 0.05);
  brkF.style.width = `${brCur * 100}%`;
  brk.setAttribute('aria-valuenow', String(Math.round(brCur * 100)));
  brk.setAttribute('aria-valuetext', brCur < 0.005 ? 'かけていない' : `${Math.round(brCur * 100)} %`);
  brkT.textContent = brHeld || brCur >= 0.005 ? `ブレーキ ${Math.round(brCur * 100)} %` : BHINT;
  if (brCur !== bPrev && running) audio.set({ brake: brCur });
  /* 図の模型: 音の回転数に合わせ、スローなら 1/slow の速さで進める */
  if (running) {
    const nTarget = stat ? stat.rpm : idle;
    vis.rpm = vis.rpm + (nTarget - vis.rpm) * Math.min(1, dt * 8);
    vis.throttle = thCur / 100;
    const steps = Math.min(8000, Math.round((dt * VIS_FS) / (real ? 1 : slow)));
    for (let i = 0; i < steps; i++) {
      const p0 = vis.phi;
      vis.step();
      const deg = (vis.phi * 180) / Math.PI;
      if (vis.phi < p0) {
        pvLast = pvCur;
        pvCur = [];
        pvDeg = -10;
      }
      if (deg - pvDeg >= 2) {
        pvCur.push([vis.vol(vis.phi) * 1e6, vis.pCyl / 1e5, deg]);
        pvDeg = deg;
      }
    }
  }
  const deg = (vis.phi * 180) / Math.PI,
    pipe: number[][] = [];
  for (let i = 0; i < vis.ex.n; i++) {
    const row: number[] = [];
    for (let k = 0; k <= PIPE_N; k++) row.push(vis.ex.pressureAt(i, k / PIPE_N) / 1000);
    pipe.push(row);
  }
  fig.update({
    phi: deg,
    liftIn: liftAt(spec.inValve, deg) * 1000,
    liftEx: liftAt(spec.exValve, deg) * 1000,
    peakIn: spec.inValve.open + spec.inValve.dur / 2,
    peakEx: spec.exValve.open + spec.exValve.dur / 2,
    pCyl: vis.pCyl,
    throttle: vis.throttle,
    spark: running && vis.firing,
    pipe,
  });
  $('#e-st').textContent = STROKES[Math.floor(deg / 180) % 4];
  $('#ignLed').classList.toggle('on', running && vis.firing);
  $('#e-sl').textContent = real ? '実際の速さ' : `1/${slow} の速さ`;
  /* p–θ の縦軸は、直前のサイクルの最高圧力に合わせる */
  let pm = 0,
    pmAt = 0;
  for (const q of pvLast)
    if (q[1] > pm) {
      pm = q[1];
      pmAt = q[2];
    }
  const want = [6, 12, 30, 60, 120].find((v) => v >= pm * 1.05) ?? 120;
  if (pvMode === 'pt' && want !== ptMax) {
    ptMax = want;
    pvAxes();
  }
  drawPV();
  $('#pv-st').textContent = running ? `${grp(vis.rpm)} rpm、スロットル ${Math.round(vis.throttle * 100)} %` : '停止';
  $('#pv-rd').textContent = pvLast.length
    ? `最高圧力 ${fx(pm, 1)} bar（燃焼の上死点の後 ${Math.round(pmAt - 360)}°）　大きい輪が燃焼の仕事、小さい輪が吸排気のポンプの損失`
    : '';
  /* 文字の表示は 1 秒に 8 回まで */
  if (t - lastUi > 125) {
    lastUi = t;
    showStat();
    drawWave();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

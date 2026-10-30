/**
 * 雷鳴のページの入口: 入力 → 放電路・届く時刻・波形を Worker で計算 → 断面・届く量・波形・スペクトルを描く。
 * 光らせると、光った瞬間から AudioContext の時計で波面を広げ、今届いている所を断面と波形に重ねる
 */
import { AIR0, soundSpeed } from '../../lib/air';
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { ThunderAudio } from './audio';
import { CH0 } from './channel';
import {
  directPts,
  drawHist,
  drawSection,
  drawSpectrum,
  drawWave,
  fmtKm,
  type Pal,
  type Pts,
  palette,
  sectionView,
  spectrumPeak,
  type View,
} from './fig';
import { DIST_MAX, DIST_MIN, type Key, PARAMS } from './params';
import { audibleRange, bendRadius, SCENE0 } from './path';
import { fewPeak } from './shock';
import type { Job, Reply } from './worker';

initToolPage();

/** 計算の標本化周波数 [Hz]（鳴らすときは AudioContext が合わせる） */
const FS = 48000;
/** 届く量の箱の幅 [s] */
const DT = 0.05;
/** 待たないときに、最初の音の何秒前から鳴らすか */
const PRE = 0.3;
const C = soundSpeed(AIR0.t);
const DASH = '—';

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};
const unit = (v: string, u: string) => `${v}<span class="u">${u}</span>`;

/* ---------- 入力 ---------- */
let V = {} as Record<Key, number>;
const P = new ParamGroup<Key>(PARAMS, (v, k) => {
  V = v;
  if (k && k !== 'vol') request();
});
V = P.values();
const eCh = new Choice<string>($('#p-e'), () => request());
const gCh = new Choice<string>($('#p-gnd'), () => request());
const hCh = new Choice<string>($('#p-hill'), () => {
  hillOff();
  request();
});
const wCh = new Choice<string>($('#p-wait'));
let seed = CH0.seed;
const hillOn = () => hCh.value === '1';
function hillOff(): void {
  const off = !hillOn();
  P.setOff('hx', off, off ? '後ろの山が「なし」なので使いません' : '');
  P.setOff('hh', off, off ? '後ろの山が「なし」なので使いません' : '');
}
hillOff();

const job = (id: number): Job => ({
  id,
  fs: FS,
  dt: DT,
  ch: { ...CH0, seed, e: Number(eCh.value) },
  scene: {
    ...SCENE0,
    dist: V.dist * 1000,
    ground: Number(gCh.value),
    hillBack: V.hx * 1000,
    hillH: hillOn() ? V.hh : 0,
    lapse: V.lapse,
  },
});

/* ---------- 計算（Worker）: 計算中に変わったら、終わってから最新の値でもう一度 ---------- */
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let jobId = 0,
  busy = false,
  again = false;
let cur: Reply | null = null,
  pts: Pts | null = null,
  tEnd = 1,
  xmin = 0,
  xmax = 0,
  peakHz = 0;
function request(): void {
  stop();
  if (busy) again = true;
  else post();
}
function post(): void {
  busy = true;
  again = false;
  txt('#th-st', '計算しています');
  worker.postMessage(job(++jobId));
}
worker.onmessage = (e: MessageEvent<Reply>) => {
  busy = false;
  cur = e.data;
  pts = directPts(cur);
  tEnd = cur.t0 + cur.y.length / cur.fs;
  xmin = 0;
  xmax = 0;
  for (const b of cur.branches)
    for (let i = 0; i < b.p.length; i += 3) {
      xmin = Math.min(xmin, b.p[i]);
      xmax = Math.max(xmax, b.p[i]);
    }
  peakHz = spectrumPeak(cur);
  if (again) post();
  else txt('#th-st', '');
  outputs();
  draw();
  drawSpec();
};

/* ---------- 描く ---------- */
const sec = $<HTMLCanvasElement>('#th-sec'),
  hist = $<HTMLCanvasElement>('#th-hist'),
  wave = $<HTMLCanvasElement>('#th-wave'),
  spec = $<HTMLCanvasElement>('#th-spec');
let pal: Pal = palette(sec),
  theme = 0;
/** ドラッグの間は窓を止める（指の下から聞き手が逃げないように） */
let dragView: View | null = null;
const secH = () => (sec.clientWidth < 560 ? 240 : 320);

function draw(tau: number | null = playTau()): void {
  if (!cur || !pts) return;
  const d = V.dist * 1000,
    on = hillOn(),
    w = sec.clientWidth,
    view = dragView ?? sectionView(w, secH(), d, on ? V.hx * 1000 + 200 : 0, xmin, xmax),
    key = `${cur.id}|${theme}`;
  drawSection(
    sec,
    { r: cur, pts, view, base: CH0.base, dist: d, hill: on ? { x: d + V.hx * 1000, h: V.hh } : null, pal, c: C },
    { tau, drag: !!dragView },
    `${key}|${view.x0}|${view.x1}`,
  );
  const tr = { r: cur, pal, t1: tEnd };
  drawHist(hist, 64, tr, tau, key);
  drawWave(wave, 110, tr, tau, key);
  timeline(tau);
}
function drawSpec(): void {
  if (cur) drawSpectrum(spec, 150, cur, pal, peakHz);
}
function timeline(tau: number | null): void {
  if (!cur) return;
  $('#th-waitbar').style.width = `${(Math.min(cur.first, tEnd) / tEnd) * 100}%`;
  $('#th-fill').style.width = `${(Math.min(Math.max(tau ?? 0, 0), tEnd) / tEnd) * 100}%`;
  txt('#th-tau', (tau ?? 0).toFixed(1));
  txt('#th-end', `音まで ${cur.first.toFixed(1)} s・終わり ${tEnd.toFixed(1)} s`);
}

function outputs(): void {
  if (!cur) return;
  const r = cur,
    d = V.dist * 1000,
    len = r.d1 - r.d0;
  let last = 0;
  for (let i = 0; i < r.et.length; i++) if (r.et[i] > last) last = r.et[i];
  html('#o-wait', unit(r.first.toFixed(1), 's'));
  txt('#o-waits', `÷ 3 で ${(r.first / 3).toFixed(1)} km（聞き手まで ${fmtKm(d)} km）`);
  html('#o-len', unit(len.toFixed(1), 's'));
  txt('#o-lens', last - r.d1 > 0.05 ? `山の反射を含めて ${(last - r.d0).toFixed(1)} s` : '最初の音から最後の音まで');
  html('#o-pk', peakHz ? unit(peakHz.toFixed(0), 'Hz') : DASH);
  txt('#o-pks', `放電路のそばの N 波は ${fewPeak(Number(eCh.value), C).toFixed(0)} Hz`);
  const rel = 20 * Math.log10(Math.max(r.peak, 1e-12) / Math.max(r.ref, 1e-12));
  html('#o-db', unit(`${rel >= 0.5 ? '+' : rel <= -0.5 ? '−' : '±'}${Math.abs(rel).toFixed(0)}`, 'dB'));
  const R = bendRadius(AIR0.t, V.lapse);
  if (Number.isFinite(R)) {
    const rng = audibleRange(CH0.base, SCENE0.ear, R);
    html('#o-rng', unit((rng / 1000).toFixed(1), 'km'));
    txt('#o-rngs', d > rng ? '聞き手は影の領域の中（雲の中からの音はほとんど届かない）' : '聞き手は届く範囲の中');
  } else {
    html('#o-rng', '制限なし');
    txt('#o-rngs', '気温が高さで変わらないので、音は曲がらない');
  }
  txt('#m-wait', `${r.first.toFixed(1)} s`);
  txt('#m-dist', `${fmtKm(d)} km`);
  txt('#m-len', `${len.toFixed(1)} s`);
  sec.setAttribute(
    'aria-label',
    `横から見た放電路と聞き手。聞き手は落雷点から ${fmtKm(d)} km、光ってから ${r.first.toFixed(1)} 秒で音が届き、${len.toFixed(1)} 秒鳴り続ける`,
  );
}

/* ---------- 光らせる ---------- */
const audio = new ThunderAudio(),
  pp = $<HTMLButtonElement>('#th-pp');
let play: { flash: number; skip: number; r: Reply } | null = null,
  raf = 0;
function playTau(): number | null {
  return play ? Math.max(0, audio.now() - play.flash + play.skip) : null;
}
function start(): void {
  if (!cur) return;
  audio.open();
  const skip = wCh.value === '1' ? 0 : Math.max(0, cur.first - PRE),
    flash = audio.play(cur.y, cur.fs, cur.t0 - skip, cur.peak, { kind: 'peak' }, V.vol);
  play = { flash, skip, r: cur };
  pp.classList.add('on');
  pp.setAttribute('aria-label', '止める');
  pp.title = '止める';
  txt('#th-live', '光りました');
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}
function frame(): void {
  const tau = playTau();
  if (tau == null) return;
  if (tau > tEnd + 0.2) {
    stop();
    txt('#th-live', '鳴り終わりました');
    return;
  }
  draw(tau);
  raf = requestAnimationFrame(frame);
}
function stop(): void {
  if (!play) return;
  play = null;
  cancelAnimationFrame(raf);
  audio.stop();
  pp.classList.remove('on');
  pp.setAttribute('aria-label', '光らせる');
  pp.title = '光らせる';
  draw(null);
}
pp.addEventListener('click', () => (play ? stop() : start()));
$('#th-seed').addEventListener('click', () => {
  seed++;
  request();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld()) {
    stop();
    audio.suspend();
  }
});

/* ---------- 聞き手をドラッグ ---------- */
function dragTo(e: PointerEvent): void {
  if (!dragView) return;
  const r = sec.getBoundingClientRect(),
    x = dragView.ix(e.clientX - r.left),
    km = Math.round(Math.min(DIST_MAX, Math.max(DIST_MIN, x / 1000)) * 100) / 100;
  if (km !== V.dist) P.set('dist', km);
  else draw();
}
sec.addEventListener('pointerdown', (e) => {
  if (!cur || e.button !== 0) return;
  const d = V.dist * 1000;
  dragView = sectionView(sec.clientWidth, secH(), d, hillOn() ? V.hx * 1000 + 200 : 0, xmin, xmax);
  sec.setPointerCapture(e.pointerId);
  sec.classList.add('drag');
  dragTo(e);
});
sec.addEventListener('pointermove', (e) => {
  if (dragView) dragTo(e);
});
const endDrag = () => {
  if (!dragView) return;
  dragView = null;
  sec.classList.remove('drag');
  draw();
};
sec.addEventListener('pointerup', endDrag);
sec.addEventListener('pointercancel', endDrag);

/* ---------- 大きさ・テーマ ---------- */
new ResizeObserver(() =>
  requestAnimationFrame(() => {
    draw();
    drawSpec();
  }),
).observe($('.a-fig'));
new ResizeObserver(() => requestAnimationFrame(drawSpec)).observe($('.a-out'));
const repaint = () => {
  pal = palette(sec);
  theme++;
  draw();
  drawSpec();
};
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);

request();

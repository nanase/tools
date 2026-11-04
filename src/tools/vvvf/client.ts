/**
 * VVVF のページの入口。上は運転しながら波形・モード図・スペクトログラムと音を確かめる。
 * 下は「VVVF のしくみ」（固定の値で 8 つの工程を順に動かす）。音と運転はワークレットで計算し、図は送られた値で描く
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { readCols } from '../pcm/fig';
import { VvvfAudio } from './audio';
import { CARS, type CarId, modeOf } from './cars';
import type { DriveKind } from './drive';
import type { EchoKind } from './echo';
import { drawCycle, drawMap, LiveSpec, modeName, ratioText } from './fig';
import { PARAMS, type PKey } from './params';
import { CAPTIONS, drawStory, drawThumb, STEPS } from './story';

initToolPage();

const root = $('#vvvf'),
  audio = new VvvfAudio();

const S = {
  car: CARS.tokyu5000,
  v: 0,
  a: 0,
  power: false,
  brake: false,
  slip: 0,
  kind: 'stop' as DriveKind,
  lever: 0,
  drift: 0,
};
let dirtyMap = true;

const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};

/* ---------- 運転 ---------- */
const autoBtn = $<HTMLButtonElement>('#vv-auto'),
  stopBtn = $<HTMLButtonElement>('#vv-stop'),
  levBtns = $$<HTMLButtonElement>('#vv-lev button');
function syncUi(): void {
  autoBtn.setAttribute('aria-pressed', String(S.kind === 'auto'));
  $('#vv-autoLed').classList.toggle('on', S.kind === 'auto');
  for (const b of levBtns) b.setAttribute('aria-pressed', String(S.kind === 'hand' && Number(b.dataset.l) === S.lever));
  $('#vv-led').classList.toggle('on', S.kind !== 'stop');
  txt('#vv-st', S.kind === 'auto' ? '自動運転中' : S.kind === 'hand' ? '手動運転中' : '停止');
}
audio.onRun = (m) => {
  const change = m.kind !== S.kind || m.lever !== S.lever || m.brake !== S.brake;
  S.v = m.v;
  S.a = m.a;
  S.power = m.power;
  S.brake = m.brake;
  S.slip = m.slip;
  S.kind = m.kind;
  S.lever = m.lever;
  dirtyMap = true;
  if (change) syncUi();
};
autoBtn.addEventListener('click', () => {
  void audio.ready();
  if (S.kind === 'auto') audio.post({ type: 'hand', lever: 0 });
  else audio.post({ type: 'auto' });
});
stopBtn.addEventListener('click', () => audio.halt());
$('#vv-lev').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-l]');
  if (!b) return;
  void audio.ready();
  audio.post({ type: 'hand', lever: Number(b.dataset.l) });
});
/* 車種を変えても速度と運転の状態は保つ（同じ速度で音を比べられる） */
new Choice<CarId>($('#vv-car'), (v) => {
  S.car = CARS[v];
  audio.car(v);
  dirtyMap = true;
});

/* ---------- 音 ---------- */
new Choice<string>($('#p-src'), (v) => audio.post({ type: 'force', on: v === 'f' }));
const snd = $('#vv-snd');
new Choice<string>($('#p-road'), (v) => {
  audio.post({ type: 'road', on: v === '1' });
  /* 走行音がなしの間は音量の行を隠す */
  snd.dataset.road = v;
});
new ParamGroup<PKey>(PARAMS, (v) => {
  audio.vol(v.vol);
  audio.post({ type: 'roadDb', db: v.roadDb });
});
const Snd = { echo: 'ground' as EchoKind, stereo: true };
new Choice<EchoKind>($('#p-echo'), (v) => {
  Snd.echo = v;
  audio.echo(v, Snd.stereo);
  audio.post({ type: 'tunnel', on: v === 'tunnel' });
});
new Choice<string>($('#p-rail'), (v) => {
  audio.post({ type: 'rail', len: Number(v) });
  /* レールの音がなしの間は席の行を隠す */
  snd.dataset.rail = v;
});
new Choice<string>($('#p-seat'), (v) => audio.post({ type: 'seat', end: v === 'end' }));
new Choice<string>($('#p-st'), (v) => {
  Snd.stereo = v === '1';
  audio.post({ type: 'stereo', on: Snd.stereo });
  audio.echo(Snd.echo, Snd.stereo);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld()) audio.sleep();
});

/* ---------- VVVF のしくみ ---------- */
/** 1 工程の時間 [s] */
const DURA = 7;
const St = { i: 0, t: 0, run: !RM.matches, seen: false, thumbs: true };
const cvH = $<HTMLCanvasElement>('#how-cv'),
  cards = $$<HTMLButtonElement>('#how-steps .pcm-st'),
  thumbs = cards.map((b) => $<HTMLCanvasElement>('canvas', b)),
  hpp = $<HTMLButtonElement>('#how-pp'),
  trk = $('#how-trk');
function syncStep(): void {
  cards.forEach((b, i) => {
    const on = i === St.i;
    b.setAttribute('aria-pressed', String(on));
    if (on) {
      const w = b.parentElement;
      if (w) w.scrollLeft = b.offsetLeft - w.offsetLeft - (w.clientWidth - b.offsetWidth) / 2;
    }
  });
  txt('#how-cap', CAPTIONS[St.i]);
  txt('#how-name', STEPS[St.i][0]);
  hpp.classList.toggle('on', St.run);
  const t = St.run ? '一時停止' : '再生';
  hpp.setAttribute('aria-label', t);
  hpp.title = t;
}
function goStep(i: number, t = 0): void {
  St.i = (i + STEPS.length) % STEPS.length;
  St.t = t;
  syncStep();
}
$('#how-steps').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.pcm-st');
  if (b) goStep(Number(b.dataset.i));
});
$('#how-prev').addEventListener('click', () => goStep(St.i - 1));
hpp.addEventListener('click', () => {
  St.run = !St.run;
  syncStep();
});
const trkAt = (e: PointerEvent) => {
  const r = trk.getBoundingClientRect(),
    v = Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)) * STEPS.length,
    i = Math.floor(v);
  goStep(i, (v - i) * DURA);
};
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  trkAt(e);
});
trk.addEventListener('pointermove', (e) => {
  if (trk.hasPointerCapture(e.pointerId)) trkAt(e);
});
trk.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (!d) return;
  goStep(St.i + d);
  e.preventDefault();
});
/* 枠を閉じたときと画面の外にあるときは止める */
new IntersectionObserver(([e]) => {
  St.seen = e.isIntersecting;
}).observe($('.a-how'));
function drawHow(dt: number): void {
  if (!St.seen) return;
  if (St.run) {
    St.t += dt;
    if (St.t >= DURA) goStep(St.i + 1);
  }
  drawStory(cvH, St.i, St.t);
  if (St.thumbs) {
    St.thumbs = false;
    thumbs.forEach((c, i) => {
      drawThumb(c, i);
    });
  }
  const p = ((St.i + Math.min(1, St.t / DURA)) / STEPS.length) * 100;
  $('#how-fill').style.width = `${p}%`;
  $('#how-th').style.left = `${p}%`;
  trk.setAttribute('aria-valuenow', String(St.i + 1));
}

/* ---------- 毎フレーム ---------- */
const cvC = $<HTMLCanvasElement>('#vv-cy'),
  cvM = $<HTMLCanvasElement>('#vv-map'),
  spec = new LiveSpec($<HTMLCanvasElement>('#vv-sp'));
let dirtyCycle = true;
const recolor = () => {
  readCols(root);
  dirtyMap = true;
  dirtyCycle = true;
  St.thumbs = true;
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  dirtyMap = true;
  dirtyCycle = true;
  St.thumbs = true;
}).observe(root);

let last = 0,
  lastV = -1;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  drawHow(dt);
  const M = modeOf(S.car, S),
    moving = S.kind !== 'stop' || S.v > 0;
  /* 非同期のパルスはキャリアが基本波と無関係なのでずれていく。図で追えるようゆっくり動かす */
  if (moving && M.on && !M.sync && !RM.matches) S.drift = (S.drift + dt * 0.35) % 1;
  if (moving || dirtyCycle || S.v !== lastV) {
    dirtyCycle = false;
    lastV = S.v;
    drawCycle(cvC, M, S, S.car, S.drift);
    txt('#vv-ratio', ratioText(M, S));
    txt('#m-v', S.v.toFixed(0));
    txt('#m-f', `${M.f1.toFixed(1)} Hz`);
    txt('#m-c', !M.on ? '—' : M.one ? 'なし' : `${M.fc >= 100 ? M.fc.toFixed(0) : M.fc.toFixed(1)} Hz`);
    txt('#m-m', modeName(M, S));
  }
  if (dirtyMap) {
    dirtyMap = false;
    drawMap(cvM, S, M.on, S.car);
  }
  spec.draw(audio.analyser, moving, dt);
  requestAnimationFrame(loop);
}
readCols(root);
syncUi();
syncStep();
requestAnimationFrame(loop);

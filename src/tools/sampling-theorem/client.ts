/**
 * 標本化定理のページの入口。音はワークレットで作り、図は止めた波形と動かさない軸のスペクトルで描く。
 * スペクトルを横に動かすと標本化周波数が変わる。スイープ・音楽・「自動」は再生中だけ時刻が進む。
 * 音楽の音源はワーカーで作り、主スレッドとワークレットの両方に置く
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { fft, plan } from '../spectrum/fft';
import { SmpAudio } from './audio';
import { drawSpec, drawWave, hz, readCols, specGeom, specTop } from './fig';
import { hasMusic, MUSIC_DUR, musicSpec, SPEC_N, setMusic } from './music';
import type { MusicOut } from './music-worker';
import { FS_MAX, FS_MIN, fsMarks, nice3, PARAMS, type PKey } from './params';
import { autoFs, CYC, hasF, isMusic, judge, type Sig, type SrcId, SWD, swF } from './signal';
import type { Hear } from './stream';

initToolPage();

const root = $('#smp'),
  audio = new SmpAudio(),
  cvW = $<HTMLCanvasElement>('#smp-w'),
  cvS = $<HTMLCanvasElement>('#smp-s');

const S = {
  src: 'sine' as SrcId,
  f: 1000,
  /** 設定の標本化周波数 */
  fs: 8000,
  /** 図に使う今の標本化周波数（自動で下げる間は動く） */
  fsNow: 8000,
  aa: false,
  hear: 'rec' as Hear,
  auto: false,
  playing: false,
  /** 時刻 [s]（スイープと自動で下げるの位置） */
  t: 0,
  /** ワークレットから届いた時刻・標本化周波数と、届いた時点 [ms] */
  posT: 0,
  posFs: 8000,
  posAt: 0,
};
let dirty = true;

const sigOf = (): Sig => ({ src: S.src, f: S.f });
const send = (): void =>
  audio.set({ type: 'set', set: { sig: sigOf(), fs: S.fs, aa: S.aa, hear: S.hear, auto: S.auto } });
const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};

/* ---------- 音楽の音源（ワーカーで作る） ---------- */
let mworker: Worker | null = null;
const asked = new Set<string>();
function needMusic(src: SrcId): void {
  if (!isMusic(src) || hasMusic(src) || asked.has(src)) return;
  asked.add(src);
  mworker ??= new Worker(new URL('./music-worker.ts', import.meta.url), { type: 'module' });
  mworker.onmessage = (e: MessageEvent<MusicOut>) => {
    const { name, x } = e.data;
    setMusic(name, x);
    audio.music({ type: 'music', name, x: x.slice() });
    dirty = true;
  };
  mworker.postMessage(src);
}
const P4 = plan(SPEC_N);
function fftIn(re: Float64Array, im: Float64Array): void {
  P4.re.set(re);
  P4.im.set(im);
  fft(P4);
  re.set(P4.re);
  im.set(P4.im);
}

/* ---------- 入力 ---------- */
/** 標本化周波数の並びに、入力の周波数とその 2 倍を足す（ちょうど 2 倍に合わせられるように） */
function markFs(): void {
  fsMarks.length = 0;
  if (hasF(S.src)) fsMarks.push(S.f, 2 * S.f);
  params.refresh('fs');
}
const params = new ParamGroup<PKey>(PARAMS, (v, k) => {
  if (v.f !== S.f) {
    S.f = v.f;
    queueMicrotask(markFs);
  }
  if (k === 'fs' && S.auto) setAuto(false);
  S.fs = v.fs;
  if (!S.auto) S.fsNow = v.fs;
  audio.vol(v.vol);
  send();
  dirty = true;
});
new Choice<SrcId>($('#p-src'), (v) => {
  S.src = v;
  params.setOff('f', !hasF(v), v === 'sweep' ? 'スイープでは使いません' : '音楽では使いません');
  needMusic(v);
  markFs();
  send();
  syncPos();
  dirty = true;
});
new Choice<string>($('#p-aa'), (v) => {
  S.aa = v === '1';
  send();
  dirty = true;
});

/* ---------- 試聴 ---------- */
const keys = $('#smp-keys'),
  pp = $<HTMLButtonElement>('#smp-pp'),
  autoBtn = $<HTMLButtonElement>('#smp-auto');
keys.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-v]');
  if (!b) return;
  S.hear = b.dataset.v === 'orig' ? 'orig' : 'rec';
  for (const x of keys.querySelectorAll('[data-v]')) x.setAttribute('aria-pressed', String(x === b));
  send();
});
function syncPlay(): void {
  pp.classList.toggle('on', S.playing);
  pp.title = pp.ariaLabel = S.playing ? '停止' : '再生';
  $('#smp-led').classList.toggle('on', S.playing);
  txt('#smp-st', S.playing ? '再生中' : '停止中');
}
function start(): void {
  S.playing = true;
  syncPlay();
  send();
  void audio.ready().then((ok) => {
    if (!ok || !S.playing) {
      S.playing = false;
      syncPlay();
      return;
    }
    audio.play(true, S.t);
    S.posT = S.t;
    S.posAt = performance.now();
  });
}
function stop(): void {
  if (!S.playing) return;
  S.playing = false;
  audio.play(false, S.t);
  syncPlay();
}
pp.addEventListener('click', () => (S.playing ? stop() : start()));
audio.onPos = (m) => {
  S.posT = m.t;
  S.posFs = m.fs;
  S.posAt = performance.now();
};
/** 時刻を移す（鳴っていれば、そこから鳴らし直す） */
function seek(t: number): void {
  S.t = t;
  S.posT = t;
  S.posAt = performance.now();
  if (S.playing) audio.play(true, t);
  dirty = true;
}
function setAuto(on: boolean): void {
  S.auto = on;
  autoBtn.setAttribute('aria-pressed', String(on));
  $('.led', autoBtn).classList.toggle('on', on);
  send();
  /* 自動は 1 周の頭から */
  if (on) seek(Math.ceil(S.t / CYC) * CYC);
  else S.fsNow = S.fs;
  syncPos();
  dirty = true;
}
autoBtn.addEventListener('click', () => setAuto(!S.auto));

/* 再生位置（自動・スイープ・音楽の 1 周） */
const pos = $('#smp-pos'),
  trk = $('#smp-trk');
const cycLen = (): number => (S.auto ? CYC : S.src === 'sweep' ? SWD : MUSIC_DUR);
function syncPos(): void {
  pos.hidden = !(S.auto || S.src === 'sweep' || isMusic(S.src));
  trk.setAttribute('aria-valuemax', String(cycLen()));
}
function seekAt(clientX: number): void {
  const r = trk.getBoundingClientRect(),
    D = cycLen(),
    u = Math.max(0, Math.min(0.999, (clientX - r.left) / r.width));
  seek(Math.floor(S.t / D) * D + u * D);
}
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  seekAt(e.clientX);
  const move = (ev: PointerEvent) => seekAt(ev.clientX),
    up = () => {
      trk.removeEventListener('pointermove', move);
      trk.removeEventListener('pointerup', up);
    };
  trk.addEventListener('pointermove', move);
  trk.addEventListener('pointerup', up);
});
trk.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  seek(Math.max(0, S.t + (e.key === 'ArrowRight' ? 0.25 : -0.25)));
});

/* ---------- スペクトルを横に動かすと標本化周波数 ---------- */
function fsAt(clientX: number): number {
  const r = cvS.getBoundingClientRect(),
    { x0, x1 } = specGeom(r.width, r.height),
    F = specTop(sigOf()),
    f = ((clientX - r.left - x0) / (x1 - x0)) * F,
    /* 入力の周波数とその 2 倍の近く（6 px 以内）では、その値に合わせる */
    near = fsMarks.find((m) => Math.abs(m - f) < (6 * F) / (x1 - x0));
  return Math.max(FS_MIN, Math.min(FS_MAX, near ?? nice3(Math.max(1, f))));
}
cvS.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  cvS.setPointerCapture(e.pointerId);
  const set = (x: number) => {
    const v = fsAt(x);
    if (v !== params.get('fs')) params.set('fs', v);
  };
  set(e.clientX);
  const move = (ev: PointerEvent) => set(ev.clientX),
    up = () => {
      cvS.removeEventListener('pointermove', move);
      cvS.removeEventListener('pointerup', up);
    };
  cvS.addEventListener('pointermove', move);
  cvS.addEventListener('pointerup', up);
});
cvS.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const L = params.list('fs'),
    cur = params.get('fs'),
    i = L.reduce((b, x, j) => (Math.abs(Math.log(x / cur)) < Math.abs(Math.log(L[b] / cur)) ? j : b), 0),
    n = Math.max(0, Math.min(L.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
  params.set('fs', L[n]);
});

/* ---------- 毎フレーム ---------- */
const recolor = () => {
  readCols(root);
  dirty = true;
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  dirty = true;
}).observe(cvW);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld()) {
    stop();
    audio.sleep();
  }
});

let lastKey = '';
function loop(now: number): void {
  if (S.playing && S.posAt) S.t = S.posT + Math.min(0.1, (now - S.posAt) / 1000);
  if (S.auto) S.fsNow = S.playing && S.posAt ? S.posFs : autoFs(S.t);
  const music = isMusic(S.src),
    moving = S.auto || S.src === 'sweep' || music,
    fs = Math.round(S.fsNow),
    tKey = S.src === 'sweep' ? swF(S.t).toFixed(0) : music ? `${S.t.toFixed(3)}/${hasMusic(S.src as never)}` : '',
    key = `${S.src}/${S.f}/${fs}/${S.aa}/${tKey}`;
  if (dirty || key !== lastKey) {
    dirty = false;
    lastKey = key;
    const sig = sigOf(),
      J = judge(sig, fs, S.aa, S.t),
      view: Sig = S.src === 'sweep' ? { src: 'sine', f: J.main.f } : sig,
      ready = music && hasMusic(S.src as never),
      mspec = ready ? musicSpec(S.src as never, S.t, fftIn) : undefined;
    drawWave(cvW, { sig: view, fs, aa: S.aa, t0: music ? S.t : 0 }, S.src === 'sweep');
    drawSpec(cvS, { sig, t: S.t, fs, aa: S.aa, mspec });
    cvS.setAttribute('aria-valuenow', String(fs));
    cvS.setAttribute('aria-valuetext', hz(fs));
  }
  if (moving) {
    const D = cycLen(),
      u = (((S.t % D) + D) % D) / D;
    $('#smp-fill').style.width = `${u * 100}%`;
    $('#smp-th').style.left = `${u * 100}%`;
    trk.setAttribute('aria-valuenow', (u * D).toFixed(1));
    txt('#smp-tm', `${(u * D).toFixed(1)} / ${D} 秒`);
  }
  requestAnimationFrame(loop);
}
recolor();
syncPlay();
syncPos();
requestAnimationFrame(loop);

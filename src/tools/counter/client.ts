/**
 * カウンタと分周のページの入口。開いた時刻から時計を進め、こまごとにランプ・7 セグメント・6 段の波形を塗り直す。
 * 速さを変えると、点滅を目で追える最も速い段から下の 6 段へ波形を移す。ランプの列の段を押すと、その段が 6 段に入る速さにする。
 * スピーカーのボタンで段ごとの音を鳴らす
 */
import { $ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { autoPause, handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { StageAudio } from './audio';
import { AUDIBLE_HZ, audible, FigView } from './fig';
import { beforeMidnight, F32, fromDate, ROWS, SEE_HZ, STAGES, stF, winTop, wrapDay } from './model';
import { type Key, SPEED, VOL } from './params';

initToolPage();

const host = $('#ct-fig'),
  mute = $<HTMLButtonElement>('#ct-mute');
const view = new FigView(host),
  snd = new StageAudio();
const st = { t: fromDate(new Date()), sp: 1, W: 0 };

/* ---------- 図 ---------- */
function build(): void {
  const W = Math.max(300, Math.floor(host.clientWidth));
  st.W = W;
  view.build(W, st.sp, snd.on);
  view.paint(st.t, performance.now());
}
function sndChanged(): void {
  view.setSnd(snd.on);
  mute.disabled = snd.on.size === 0;
  snd.sync(st.t, st.t, st.sp);
}

/* ---------- 入力 ---------- */
let booted = false;
const pg = new ParamGroup<Key>([SPEED, VOL], (v, k) => {
  if (!k || k === 'vol') snd.setVol(v.vol);
  if (!k || k === 'sp') {
    st.sp = v.sp;
    /* 6 段から外れた段と、速さを上げて鳴らせなくなった段は止める */
    const top = winTop(st.sp);
    if (snd.drop((s) => audible(s, st.sp) && s >= top && s < top + ROWS)) mute.disabled = snd.on.size === 0;
    if (booted) build();
    snd.sync(st.t, st.t, st.sp);
  }
});

$('#ct-jump').addEventListener('click', () => {
  st.t = beforeMidnight(st.sp);
  view.paint(st.t, performance.now());
});
$('#ct-now').addEventListener('click', () => {
  st.t = fromDate(new Date());
  view.paint(st.t, performance.now());
});
mute.addEventListener('click', () => {
  snd.stop();
  sndChanged();
});

/**
 * ランプの列の段を押したとき: その段が 6 段に入っていなければ、その段が先頭（11 段目より遅い段は 10 段目が先頭）に
 * なる速さにする。点滅が 1 秒に 16 回になる速さ。入っていれば速さは変えない。どちらもその段を少しの間だけ囲む
 */
function pickStage(k: number): void {
  const top = winTop(st.sp);
  if (k < top || k >= top + ROWS) pg.set('sp', SEE_HZ / stF(Math.min(k, STAGES + 1 - ROWS)));
  view.flash(k);
}

/* スピーカーのボタンとランプの列の段（図の中） */
function press(ev: Event): void {
  const l = (ev.target as Element).closest<SVGGElement>('[data-st]');
  if (l) {
    pickStage(Number(l.dataset.st));
    return;
  }
  const b = (ev.target as Element).closest<SVGGElement>('[data-snd]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const k = Number(b.dataset.snd);
  if (stF(k) * st.sp > AUDIBLE_HZ) return;
  snd.toggle(k);
  sndChanged();
}
host.addEventListener('click', press);
host.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  if (!(ev.target as Element).closest('[data-snd],[data-st]')) return;
  ev.preventDefault();
  press(ev);
});

/* スマートフォンで画面が隠れたら音を止める。PC では鳴らし続ける */
autoPause(
  {
    onLost: null,
    suspend: () => snd.suspend(),
  },
  {
    pause: () => {
      if (!handheld()) return;
      snd.stop();
      sndChanged();
    },
    hidden: () => {},
  },
);

/* ---------- 時計を進める ---------- */
let last = performance.now();
function tick(now: number): void {
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  const t0 = st.t;
  st.t = wrapDay(st.t + dt * F32 * st.sp);
  /* 隠れていた間の音は鳴らさない */
  if (snd.on.size) snd.sync(dt < 0.25 ? t0 : st.t, st.t, st.sp);
  view.paint(st.t, now);
  requestAnimationFrame(tick);
}

new ResizeObserver(() => {
  if (booted && Math.floor(host.clientWidth) !== st.W) build();
}).observe(host);
/* 保存した値を戻したあと（マイクロタスク）に組み立てる */
queueMicrotask(() => {
  booted = true;
  build();
  requestAnimationFrame(tick);
});

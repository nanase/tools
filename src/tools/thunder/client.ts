/**
 * 雷鳴のページの入口: 入力 → 放電路・届く時刻・波形を Worker で計算 → 断面・届く量・波形・スペクトルを描く。
 * 光らせると、光った瞬間から AudioContext の時計で波面を広げ、今届いている所を断面と波形に重ねる。
 * 時間の帯を押すかドラッグすると、その時刻の様子を描き、そこから鳴らす（鳴らしている間はすぐ、止まっている間は次に光らせたとき）。
 * 一時停止すると今の時刻で止まり、次はそこから鳴らす。最初からのボタンで光る前へ戻す。
 * 放電路の形はメインスレッドでもすぐ作り、計算が届く前に灰で描く（図の大きさと地面・家・聞き手を先に出す）
 */
import { AIR0, soundSpeed } from '../../lib/air';
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { ThunderAudio } from './audio';
import { type Branch, CH0, type ChannelSet, makeChannel, type Shape, shape } from './channel';
import {
  arrivalPts,
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
import { DIST_MAX, DIST_MIN, HILL_MAX, HILL_MIN, type Key, PARAMS } from './params';
import { audibleRange, bendRadius, SCENE0, Via } from './path';
import { fewPeak } from './shock';
import type { Job, Reply } from './worker';

initToolPage();

/** 計算の標本化周波数 [Hz]（鳴らすときは AudioContext が合わせる） */
const FS = 48000;
/** 届く量の箱の幅 [s] */
const DT = 0.05;
/** 待たないときに、最初の音の何秒前から鳴らすか */
const PRE = 0.3;
/** 音量 0 dB での、0.4 s ごとの実効値の最大（0 dBFS が 1）。100 Hz より上と全帯域の、大きくなりすぎない方に合わせる */
const LOUD_HP = 0.14,
  LOUD_FULL = 0.35;
/** 時間の帯をキーで動かす幅 [s] */
const KEY_STEP = 0.5;
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
  /* 聞き手・山をドラッグしている間は計算せず、離したときに計算する */
  if ((k === 'dist' || k === 'hx') && dragView) {
    stop();
    moved = true;
    txt('#th-st', '離すと計算します');
    draw();
  } else if (k === 'vol') {
    if (play) audio.gain(gainOf(play.r));
  } else if (k) request();
});
V = P.values();
const eCh = new Choice<string>($('#p-e'), () => request());
const nCh = new Choice<string>($('#p-n'), () => request());
const gCh = new Choice<string>($('#p-gnd'), () => request());
const hCh = new Choice<string>($('#p-hill'), () => {
  hillOff();
  request();
});
const wCh = new Choice<string>($('#p-wait'));
const sideCh = new Choice<string>($('#p-side'), () => request());
const hsCh = new Choice<string>($('#p-hside'), () => request());
const sCh = new Choice<string>($('#p-env'), () => request());
const tCh = new Choice<string>($('#p-ter'), () => request());
let seed = CH0.seed;
const hillOn = () => hCh.value === '1';
function hillOff(): void {
  const off = !hillOn();
  const note = off ? '山が「なし」なので使いません' : '';
  P.setOff('hx', off, note);
  P.setOff('hh', off, note);
  hsCh.setOff(off, note);
}
hillOff();
/** 聞き手の x [m] と山の崖の x [m]（どちらも負なら落雷点の左） */
const lisX = () => Number(sideCh.value) * V.dist * 1000;
const hillX = () => Number(hsCh.value) * V.hx * 1000;

const chSet = (): ChannelSet => ({ ...CH0, seed, e: Number(eCh.value), strokes: Number(nCh.value) });
const job = (id: number): Job => ({
  id,
  fs: FS,
  dt: DT,
  env: sCh.value,
  terrain: tCh.value,
  ch: chSet(),
  scene: {
    ...SCENE0,
    dist: lisX(),
    ground: Number(gCh.value),
    hillX: hillX(),
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
  echo: Pts | null = null,
  tEnd = 1,
  peakHz = 0;
/** 今の設定の放電路（計算を待たずに作る）。鍵は放電路の設定 */
let shown: {
    key: string;
    /** 描き直しの鍵に使う通し番号 */
    sid: number;
    branches: Branch[];
    sh: Shape;
    xmin: number;
    xmax: number;
    src: [number, number];
  } | null = null,
  sid = 0;
/** 届いた計算の放電路の鍵と、送った計算の鍵 */
let curKey = '';
const sent = new Map<number, string>();
function reshape(): void {
  const ch = chSet(),
    key = JSON.stringify(ch);
  if (shown?.key === key) return;
  const branches = makeChannel(ch);
  let xmin = 0,
    xmax = 0;
  for (const b of branches)
    for (let i = 0; i < b.p.length; i += 3) {
      xmin = Math.min(xmin, b.p[i]);
      xmax = Math.max(xmax, b.p[i]);
    }
  shown = { key, sid: ++sid, branches, sh: shape(ch), xmin, xmax, src: cloudBase(branches) };
}
/** 届いた計算が今の放電路のものか（違えば放電路を灰で描き、波形は枠だけ） */
const ready = (): Reply | null => (cur && curKey === shown?.key ? cur : null);
function request(): void {
  stop();
  cue = null;
  ppState();
  reshape();
  idleSt();
  draw();
  drawSpec();
  if (busy) again = true;
  else post();
}
/** 図の右上: 放電路の形（雲の中の向きの数・落雷点の数・同じ落雷点への本数） */
function shapeText(sh: Shape): string {
  const n = sh.legs.length,
    a = [n ? `雲の中 ${n} 方向` : '雲の中なし'];
  if (sh.forks.length) a.push(`落雷 ${sh.forks.length + 1} か所`);
  if (sh.twins) a.push(`落雷点に ${sh.twins + 1} 本`);
  return a.join('・');
}
const idleSt = () => txt('#th-st', shown ? shapeText(shown.sh) : '');
const fig = $('.a-fig');
/** 計算中は、古い雷を鳴らさないよう再生の操作を止める */
function busyState(on: boolean): void {
  fig.classList.toggle('busy', on);
  if (on) fig.setAttribute('aria-busy', 'true');
  else fig.removeAttribute('aria-busy');
  for (const b of [pp, home]) b.disabled = on;
  trk.setAttribute('aria-disabled', String(on));
}
function post(): void {
  busy = true;
  again = false;
  busyState(true);
  const j = job(++jobId);
  sent.set(j.id, JSON.stringify(j.ch));
  worker.postMessage(j);
}
worker.onmessage = (e: MessageEvent<Reply>) => {
  busy = false;
  /* 前の雷を鳴らしたままにしない */
  stop();
  cur = e.data;
  curKey = sent.get(cur.id) ?? '';
  sent.delete(cur.id);
  pts = arrivalPts(cur, [Via.Direct]);
  echo = arrivalPts(cur, [Via.Hill, Via.Both]);
  tEnd = cur.t0 + cur.y.length / cur.fs;
  peakHz = spectrumPeak(cur);
  if (again) post();
  else busyState(false);
  outputs();
  draw();
  drawSpec();
};

/** 本流が雲の底に着いた点 [m]（止まっているときの道すじの始まり） */
function cloudBase(bs: readonly Branch[]): [number, number] {
  const p = bs[0].p;
  for (let i = 0; i < p.length; i += 3) if (p[i + 2] >= CH0.base) return [p[i], p[i + 2]];
  return [0, CH0.base];
}

/* ---------- 描く ---------- */
const sec = $<HTMLCanvasElement>('#th-sec'),
  hist = $<HTMLCanvasElement>('#th-hist'),
  wave = $<HTMLCanvasElement>('#th-wave'),
  spec = $<HTMLCanvasElement>('#th-spec');
/** 断面はいつも夜の色（.th-dk）、ほかの図はテーマの色 */
let secPal: Pal = palette(sec),
  pal: Pal = palette(hist),
  theme = 0;
/** ドラッグの間は窓を止める（指の下から聞き手が逃げないように）。dragging は動かすもの、moved はドラッグで動いたか */
let dragView: View | null = null,
  dragging: 'lis' | 'hill' = 'lis',
  moved = false;
const secH = () => (sec.clientWidth < 560 ? 240 : 320);

/** 断面の窓（聞き手の側の端は、聞き手と山の少し先まで） */
const viewNow = (): View =>
  sectionView(sec.clientWidth, secH(), lisX(), hillOn() ? hillX() : null, shown?.xmin ?? 0, shown?.xmax ?? 0);
/** 計算が届く前の見積もり: 放電路の頂点のうち聞き手にいちばん近い所と遠い所まで、音が進む時間 [s] */
function guess(): [number, number] {
  const d = lisX();
  let lo = Number.POSITIVE_INFINITY,
    hi = 0;
  for (const b of shown?.branches ?? [])
    for (let i = 0; i < b.p.length; i += 3) {
      const r = Math.hypot(b.p[i] - d, b.p[i + 1], b.p[i + 2]) / C + b.t;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
  return Number.isFinite(lo) ? [lo, hi] : [Math.abs(d) / C, Math.abs(d) / C + 10];
}
function draw(tau: number | null = playTau() ?? cue): void {
  if (!shown) return;
  const r = ready(),
    d = lisX(),
    view = dragView ?? viewNow(),
    key = r ? `${r.id}|${theme}` : `p${shown.sid}|${theme}`;
  if (!r) tau = null;
  drawSection(
    sec,
    {
      branches: shown.branches,
      pts: r && pts,
      echo: r && echo,
      view,
      base: CH0.base,
      dist: d,
      ground: gCh.value !== '0',
      hill: hillOn() ? { x: hillX(), h: V.hh } : null,
      src: shown.src,
      strokes: r?.strokes ?? [],
      pal: secPal,
      c: C,
    },
    { tau, drag: dragView ? dragging : null },
    `${key}|${view.x0}|${view.x1}`,
  );
  const [f, l] = r ? [r.first, tEnd] : guess(),
    tr = { r, pal, t1: r ? tEnd : l + 2, first: f };
  drawWave(wave, 96, tr, tau, key);
  drawHist(hist, 78, tr, tau, key);
  timeline(tau);
}
function drawSpec(): void {
  drawSpectrum(spec, 150, ready(), pal, peakHz);
}
function timeline(tau: number | null): void {
  if (!ready() || !cur) {
    /* 前の雷の時刻を残さない */
    for (const id of ['#th-waitbar', '#th-fill']) $(id).style.width = '0';
    $('#th-th').style.left = '0';
    txt('#th-end', '');
    return;
  }
  const f = `${(Math.min(Math.max(tau ?? 0, 0), tEnd) / tEnd) * 100}%`;
  $('#th-waitbar').style.width = `${(Math.min(cur.first, tEnd) / tEnd) * 100}%`;
  $('#th-fill').style.width = f;
  $('#th-th').style.left = f;
  trk.setAttribute('aria-valuemax', tEnd.toFixed(1));
  trk.setAttribute('aria-valuenow', (tau ?? 0).toFixed(1));
  trk.setAttribute('aria-valuetext', `光ってから ${(tau ?? 0).toFixed(1)} 秒`);
  txt('#th-tau', (tau ?? 0).toFixed(1));
  txt('#th-end', `音まで ${cur.first.toFixed(1)} s・終わり ${tEnd.toFixed(1)} s`);
}

function outputs(): void {
  if (!cur) return;
  const r = cur,
    d = V.dist * 1000,
    side = sideCh.value === '-1' ? '左' : '右',
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
  txt('#m-dist', `${side} ${fmtKm(d)} km`);
  txt('#m-len', `${len.toFixed(1)} s`);
  sec.setAttribute(
    'aria-label',
    `横から見た放電路と聞き手。${shown ? `${shapeText(shown.sh)}。` : ''}聞き手は落雷点の${side} ${fmtKm(d)} km、光ってから ${r.first.toFixed(1)} 秒で音が届き、${len.toFixed(1)} 秒鳴り続ける`,
  );
}

/* ---------- 光らせる ---------- */
const audio = new ThunderAudio(),
  pp = $<HTMLButtonElement>('#th-pp'),
  home = $<HTMLButtonElement>('#th-home'),
  trk = $('#th-trk');
let play: { flash: number; skip: number; r: Reply } | null = null,
  raf = 0,
  /** 止まっている間に時間の帯で選んだ時刻 [s]（次に光らせるとそこから） */
  cue: number | null = null;
/** 鳴らす大きさ: 雷ごとに 100 Hz より上（と全帯域）の強さをそろえ、音量を掛ける */
const gainOf = (r: Reply): number =>
  Math.min(LOUD_HP / Math.max(r.loud, 1e-12), LOUD_FULL / Math.max(r.full, 1e-12)) * 10 ** (V.vol / 20);
function playTau(): number | null {
  return play ? Math.max(0, audio.now() - play.flash + play.skip) : null;
}
/** 光らせる。from は鳴らし始める時刻 [s]（省くと、待つなら 0、待たないなら最初の音の直前） */
function start(from?: number): void {
  if (!cur || busy) return;
  audio.open();
  const skip = from ?? (wCh.value === '1' ? 0 : Math.max(0, cur.first - PRE)),
    flash = audio.play(cur.y, cur.yr, cur.fs, cur.t0 - skip, gainOf(cur));
  play = { flash, skip, r: cur };
  cue = null;
  ppState();
  txt('#th-live', from ? '続きから鳴らします' : '光りました');
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
/** 再生・一時停止の印と名前: 鳴らしている間は一時停止、止まっているときは光らせる（途中なら続きから） */
function ppState(): void {
  const s = play ? '一時停止' : cue ? '続きから鳴らす' : '光らせる';
  pp.classList.toggle('on', !!play);
  pp.setAttribute('aria-label', s);
  pp.title = s;
}
/** 音を止める（時刻は呼んだ側で決める） */
function halt(): void {
  play = null;
  cancelAnimationFrame(raf);
  audio.stop();
}
/** 止めて最初へ戻す（計算し直すとき・鳴り終わったとき） */
function stop(): void {
  if (!play) return;
  halt();
  ppState();
  draw(null);
}
/** 一時停止: 今の時刻で止め、次はそこから鳴らす */
function pause(): void {
  const tau = playTau();
  if (tau == null) return;
  halt();
  cue = Math.min(tEnd, tau);
  ppState();
  draw(cue);
  txt('#th-live', '一時停止しました');
}
pp.addEventListener('click', () => {
  if (play) pause();
  else start(cue != null && cue < tEnd ? cue : undefined);
});
/* 最初から: 鳴らしているなら光る所からやり直し、止まっているなら光る前へ戻す */
home.addEventListener('click', () => {
  cue = null;
  if (play) start();
  else {
    ppState();
    draw(null);
  }
});

/* ---------- 時間の帯: 押す・ドラッグで時刻を選ぶ ---------- */
let seek: { resume: boolean } | null = null;
function seekTo(tau: number): void {
  cue = Math.min(tEnd, Math.max(0, tau));
  draw(cue);
}
const tauAt = (e: PointerEvent) => {
  const r = trk.getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * tEnd;
};
trk.addEventListener('pointerdown', (e) => {
  if (!cur || busy || e.button !== 0) return;
  trk.setPointerCapture(e.pointerId);
  /* ドラッグの間は音を止め、離したら鳴らしていたならそこから鳴らす */
  seek = { resume: !!play };
  if (play) halt();
  seekTo(tauAt(e));
});
trk.addEventListener('pointermove', (e) => {
  if (seek) seekTo(tauAt(e));
});
const endSeek = () => {
  if (!seek) return;
  const { resume } = seek;
  seek = null;
  if (resume && cue != null) start(cue);
  else ppState();
};
trk.addEventListener('pointerup', endSeek);
trk.addEventListener('pointercancel', endSeek);
trk.addEventListener('keydown', (e) => {
  const now = playTau() ?? cue ?? 0,
    to =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? now + KEY_STEP
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? now - KEY_STEP
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tEnd
              : null;
  if (to == null || !cur || busy) return;
  e.preventDefault();
  if (play) start(Math.min(tEnd, Math.max(0, to)));
  else {
    seekTo(to);
    ppState();
  }
});
$('#th-seed').addEventListener('click', () => {
  seed++;
  request();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld()) {
    pause();
    audio.suspend();
  }
});

/* ---------- 聞き手・山をドラッグ ---------- */
/** 押した所へ聞き手（か山）を動かす。落雷点をまたげば左右も変える */
function dragTo(e: PointerEvent): void {
  if (!dragView) return;
  const r = sec.getBoundingClientRect(),
    x = dragView.ix(e.clientX - r.left),
    hill = dragging === 'hill',
    [ch, k, lo, hi] = hill ? [hsCh, 'hx' as const, HILL_MIN, HILL_MAX] : [sideCh, 'dist' as const, DIST_MIN, DIST_MAX],
    side = x < 0 ? '-1' : '1',
    km = Math.round(Math.min(hi, Math.max(lo, Math.abs(x) / 1000)) * 100) / 100;
  if (side !== ch.value) {
    ch.choose(side);
    stop();
    moved = true;
    txt('#th-st', '離すと計算します');
  }
  if (km !== V[k]) P.set(k, km);
  else draw();
}
/** 押した所が山の絵の上か（崖から斜面の端まで、左右に 8 px の余裕） */
function onHill(e: PointerEvent, v: View): boolean {
  if (!hillOn()) return false;
  const r = sec.getBoundingClientRect(),
    px = e.clientX - r.left,
    hx = v.sx(hillX()),
    w = Math.max(10, (v.sz(0) - v.sz(V.hh)) * 1.5),
    dir = hillX() < lisX() ? -1 : 1,
    [a, b] = dir > 0 ? [hx, hx + w] : [hx - w, hx];
  return px >= a - 8 && px <= b + 8 && e.clientY - r.top >= v.sz(V.hh) - 12;
}
sec.addEventListener('pointerdown', (e) => {
  if (!shown || e.button !== 0) return;
  dragView = viewNow();
  dragging = onHill(e, dragView) ? 'hill' : 'lis';
  moved = false;
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
  if (moved) request();
  else {
    idleSt();
    draw();
  }
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
  secPal = palette(sec);
  pal = palette(hist);
  theme++;
  draw();
  drawSpec();
};
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);

request();

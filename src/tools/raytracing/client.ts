/**
 * レイトレーシングのページの入口: 入力 → サンプルをためて画像を描く（WebGL2）→ 計算結果。
 * 区画は大きな画像 1 つと反射の回数ごとの小さな画像 6 つ。入力を動かしている間は大きな画像だけ粗く描く
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { GOALS, type Key, PARAMS } from './params';
import { PathRenderer, type Tile } from './render';
import { DEFAULT_LIGHT, type LightKind, makeScene, orbit, packScene } from './scene';
import { INTEG } from './shader';

initToolPage();

/** 入力を動かしてから全解像度に戻すまで [ms]・粗く描く倍率・粗く描く間のサンプルの上限 */
const IDLE_MS = 240;
const LOW = 0.5;
const LOW_GOAL = 64;
/** サンプル数が 2 倍になるのに掛ける最短の時間 [s]（速い GPU でも収束の様子が見えるように） */
const DOUBLE_S = 0.4;
/** 大きな画像の最大の解像度と、遅いときに下げる解像度の下限の倍率 */
const MAX_RES = 768;
const MIN_Q = 0.35;
/** 明るさの内訳を読み直す間隔 [ms] */
const SHARE_MS = 500;
/** 小さな画像の反射の回数（最後の区画は上限まで） */
const MINI_B = [0, 1, 2, 3, 4, 5];

/* ---------- 描画の用意 ---------- */
const glCanvas = document.createElement('canvas');
const stage = $('#st');
const cv = $<HTMLCanvasElement>('#cv');
const ctx = cv.getContext('2d');
const minis = $$<HTMLButtonElement>('.rt-mini');
const miniCtx = minis.map((b) => $<HTMLCanvasElement>('canvas', b).getContext('2d'));
const msg = $('#st-msg');
const wait = $('#st-busy');
let R: PathRenderer | null = null;
/** 描けないことの案内を、ほかの案内で消さない */
let noWebGl = false;
function noGl(): void {
  noWebGl = true;
  wait.hidden = true;
  msg.textContent = 'このブラウザでは WebGL2 の浮動小数点テクスチャが使えないため、画像を描けません。';
  msg.hidden = false;
}
try {
  const r = new PathRenderer(glCanvas);
  r.ready.then(() => {
    R = r;
    begin();
  }, noGl);
} catch {
  noGl();
}

/* ---------- 状態 ---------- */
let main: Tile = { x: 0, y: 0, w: 1, h: 1, minB: 0, maxB: 8, seed: 1, samples: 0 };
let small: Tile[] = [];
let M = 0;
let mq = 1;
let goal = 4096;
let pick = -1;
let playing = true;
let raf = 0;
let visible = true;
let lastT = 0;
let n = 1;
let slow = 0;
let touched = -1e9;
let busy = false;
let t0 = 0;
let elapsed = 0;
let rmse = Number.NaN;
let nextErr = 2;
let rate = 0;
let rateT = 0;
let rateS = 0;
let shareT = 0;

/* ---------- 入力 ---------- */
let V = {} as Record<Key, number>;
/** 入力の群の生成中の知らせを無視する */
let ready = false;
const scene$ = new Choice<string>($('#p-sc'), () => change());
const integ$ = new Choice<string>($('#p-integ'), () => change());
const rr$ = new Choice<string>($('#p-rr'), () => change());
const kind$ = new Choice<string>($('#p-kind'), () => change());
const G = new ParamGroup<Key>(PARAMS, (v) => {
  V = v;
  change(true);
});
V = G.values();

const kick = (): void => {
  if (!raf && R) raf = requestAnimationFrame(tick);
};

/** 表の値から場面を組んで渡す */
function pushScene(): void {
  if (!R) return;
  const kind = kind$.value as LightKind;
  const sc = makeScene(scene$.value, { ...DEFAULT_LIGHT, kind, size: V.ls, power: V.pw, kelvin: V.kv });
  R.setScene(packScene(sc), orbit(sc.cam, V.yaw, V.pit));
  R.integ = Number(integ$.value);
  R.rr = rr$.value === '1';
}

function mainRange(): [number, number] {
  if (pick < 0) return [0, V.mb];
  return [MINI_B[pick], pick === MINI_B.length - 1 ? V.mb : MINI_B[pick]];
}

/** 大きな画像の解像度 */
const dpr = (): number => Math.min(2, devicePixelRatio || 1);
const targetM = (): number => Math.max(128, Math.min(MAX_RES, Math.round(cv.clientWidth * dpr() * mq))) & ~1;

/** キャンバスの大きさに合わせて区画を決める */
function layout(): void {
  if (!R) return;
  M = targetM();
  const m = Math.max(48, Math.min(Math.floor(M / 3), Math.round((minis[0]?.clientWidth || 200) * dpr() * mq)));
  R.resize(M + 2 * m, M);
  cv.width = M;
  cv.height = M;
  main = { x: 0, y: 0, w: M, h: M, minB: 0, maxB: V.mb, seed: 1, samples: 0 };
  small = MINI_B.map((b, i) => ({
    x: M + (i % 2) * m,
    y: Math.floor(i / 2) * m,
    w: m,
    h: m,
    minB: b,
    maxB: i === MINI_B.length - 1 ? V.mb : b,
    seed: i + 2,
    samples: 0,
  }));
  minis.forEach((b) => {
    const c = $<HTMLCanvasElement>('canvas', b);
    if (c.width !== m) {
      c.width = m;
      c.height = m;
    }
  });
  restartMain();
  shareT = 0;
}

function restartMain(): void {
  const [a, b] = mainRange();
  main.minB = a;
  main.maxB = b;
  main.w = M;
  main.h = M;
  main.samples = 0;
  t0 = performance.now();
  elapsed = 0;
  rmse = Number.NaN;
  nextErr = 2;
  rate = 0;
  rateS = 0;
  rateT = 0;
  n = 1;
}

/** 入力が変わった。drag なら、しばらく大きな画像だけ粗く描く */
function change(drag = false): void {
  if (!ready) return;
  pushScene();
  syncRows();
  if (!M) return;
  if (drag) {
    touched = performance.now();
    if (!busy) {
      busy = true;
      main.w = main.h = Math.max(64, Math.round(M * LOW));
    }
    main.samples = 0;
  } else {
    busy = false;
    touched = -1e9;
    layout();
  }
  if (!playing) setPlaying(true);
  kick();
}

/** 光源と手法で使わない行を畳む */
function syncRows(): void {
  const kind = kind$.value,
    integ = Number(integ$.value);
  G.setOff('ls', kind === 'point' || kind === 'sky', kind === 'point' ? '点では使いません' : '空では使いません');
  rr$.setOff(integ === INTEG.WHITTED, 'ウィッテッド式では使いません');
  minis.forEach((b, i) => {
    b.disabled = MINI_B[i] > V.mb;
  });
  if (pick >= 0 && MINI_B[pick] > V.mb) setPick(-1);
  if (noWebGl) return;
  const dark = integ === INTEG.BRDF && kind === 'point';
  msg.textContent = dark ? 'BRDF だけでは点の光源に当たりません' : '';
  msg.hidden = !dark;
}

/* ---------- 毎フレーム ---------- */
function tick(ts: number): void {
  raf = 0;
  if (!R || !visible || document.hidden) return;
  const now = performance.now(),
    dt = ts - lastT;
  lastT = ts;
  if (busy && now - touched > IDLE_MS) {
    busy = false;
    layout();
  }
  if (busy) {
    if (main.samples < LOW_GOAL) {
      R.step([[main, main.samples === 0 ? 2 : 4]]);
      R.show();
      blitMain();
      wait.hidden = true;
    }
    raf = requestAnimationFrame(tick);
    return;
  }
  const done = main.samples >= goal && small.every((t) => t.samples >= goal);
  if (!playing || done) {
    wait.hidden = true;
    if (done && playing) finish();
    return;
  }
  /* 前の回からの間隔で 1 回の本数を決める（16〜28 ms に収める） */
  if (main.samples > 0 && dt > 0 && lastT > 0) {
    /* タブから戻ったときの長い間は数えない */
    if (dt < 5000) elapsed += dt;
    if (dt < 20) n = Math.min(64, Math.ceil(n * 1.25));
    else if (dt > 28) n = Math.max(1, Math.floor(n * 0.75));
    /* 1 本でも遅いなら解像度を下げる */
    slow = n === 1 && dt > 90 ? slow + 1 : 0;
    if (slow >= 6 && mq > MIN_Q) {
      mq = Math.max(MIN_Q, mq * 0.75);
      slow = 0;
      layout();
    }
  }
  const allowed = Math.ceil(2 ** ((now - t0) / 1000 / DOUBLE_S));
  const room = main.samples >= goal ? n : Math.max(1, Math.min(n, allowed - main.samples));
  const part = (t: Tile, k: number): number => Math.max(0, Math.min(k, goal - t.samples));
  R.step([[main, part(main, room)], ...small.map((t): [Tile, number] => [t, part(t, Math.max(room, 1))])]);
  R.show();
  blitAll();
  if (main.samples >= nextErr) {
    rmse = R.measure(main).rmse;
    nextErr = Math.ceil(nextErr * Math.SQRT2);
    /* 初めての読み出しは GPU の処理を待つので長くかかる。終わるまで輪を残す */
    wait.hidden = true;
  }
  if (now - shareT > SHARE_MS) {
    shareT = now;
    showShare();
  }
  if (now - rateT > 400) {
    /* 2 倍になる時間で抑えている間は GPU の速さが分からない */
    rate = rateT > 0 && room >= n ? ((main.samples - rateS) / (now - rateT)) * 1000 : 0;
    rateT = now;
    rateS = main.samples;
  }
  showOut();
  raf = requestAnimationFrame(tick);
}

function finish(): void {
  if (!R) return;
  if (main.samples >= 2) rmse = R.measure(main).rmse;
  showShare();
  setPlaying(false);
  showOut();
}

/** キャンバスの区画の上下は WebGL と逆 */
function blit(c: CanvasRenderingContext2D | null, t: Tile, W: number): void {
  if (!c) return;
  c.drawImage(glCanvas, t.x, glCanvas.height - t.y - t.h, t.w, t.h, 0, 0, W, W);
}
function blitMain(): void {
  blit(ctx, main, M);
}
function blitAll(): void {
  blitMain();
  small.forEach((t, i) => {
    blit(miniCtx[i], t, t.w);
  });
}

/* ---------- 表示 ---------- */
const fmtSpp = (v: number): string => (v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

function showShare(): void {
  if (!R) return;
  const vals = small.map((t, i) => (MINI_B[i] <= V.mb && t.samples > 0 ? (R?.measure(t).mean ?? 0) : 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  minis.forEach((b, i) => {
    $('.rt-p', b).textContent =
      sum > 0 && !b.disabled ? `${((vals[i] / sum) * 100).toFixed(vals[i] / sum < 0.1 ? 1 : 0)}%` : '';
  });
}

function showOut(): void {
  $('#o-rmse').textContent = Number.isFinite(rmse) ? rmse.toFixed(rmse < 0.1 ? 4 : 3) : '—';
  $('#o-spp').textContent = fmtSpp(main.samples);
  $('#o-rate').textContent = rate > 0 ? fmtSpp(rate) : '—';
  $('#o-time').textContent = (elapsed / 1000).toFixed(1);
  const frac = (x: number) => (Math.log2(Math.max(1, x)) / Math.log2(GOALS[GOALS.length - 1])) * 100;
  $('#trk-f').style.width = `${frac(Math.min(main.samples, goal))}%`;
  $('#trk-t').style.left = `${frac(goal)}%`;
  $('#o-n').textContent = fmtSpp(main.samples);
  $('#o-goal').textContent = fmtSpp(goal);
  const trk = $('#trk');
  trk.setAttribute('aria-valuenow', String(Math.log2(goal)));
  trk.setAttribute('aria-valuetext', `${goal} サンプル`);
}

/* ---------- 操作 ---------- */
const pp = $('#pp');
function setPlaying(on: boolean): void {
  playing = on;
  pp.classList.toggle('on', on);
  pp.setAttribute('aria-label', on ? '一時停止' : '再開');
  pp.title = on ? '一時停止' : '再開';
  $('#o-state').hidden = !on;
}
pp.addEventListener('click', () => {
  if (main.samples >= goal && small.every((t) => t.samples >= goal)) {
    layout();
    setPlaying(true);
  } else setPlaying(!playing);
  lastT = 0;
  kick();
});
$('#rs').addEventListener('click', () => {
  layout();
  setPlaying(true);
  kick();
});

/* 目標のサンプル数: 2 の累乗の目盛りへ */
const trk = $('#trk');
function setGoal(x: number): void {
  const i = Math.round(Math.min(1, Math.max(0, x)) * (GOALS.length - 1));
  const g = GOALS[i];
  if (g === goal) return;
  goal = g;
  if (main.samples > goal || small.some((t) => t.samples > goal)) layout();
  setPlaying(true);
  showOut();
  kick();
}
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  const r = trk.getBoundingClientRect();
  setGoal((e.clientX - r.left) / r.width);
});
trk.addEventListener('pointermove', (e) => {
  if (!trk.hasPointerCapture(e.pointerId)) return;
  const r = trk.getBoundingClientRect();
  setGoal((e.clientX - r.left) / r.width);
});
trk.addEventListener('keydown', (e) => {
  const i = GOALS.indexOf(goal),
    d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
  if (!d) return;
  setGoal((i + d) / (GOALS.length - 1));
  e.preventDefault();
});

/* 小さな画像を押すと大きな画像に出す。もう一度押すと合計に戻す */
function setPick(i: number): void {
  pick = i;
  minis.forEach((b, k) => {
    b.setAttribute('aria-pressed', k === i ? 'true' : 'false');
  });
  const tag = $('#o-tag');
  tag.textContent = i < 0 ? '' : `反射 ${MINI_B[i]} 回${i === MINI_B.length - 1 ? '以上' : ''}`;
  tag.hidden = i < 0;
  $('#b-sum').hidden = i < 0;
}
minis.forEach((b, i) => {
  b.addEventListener('click', () => {
    setPick(pick === i ? -1 : i);
    restartMain();
    if (!playing) setPlaying(true);
    kick();
  });
});
$('#b-sum').addEventListener('click', () => {
  setPick(-1);
  restartMain();
  if (!playing) setPlaying(true);
  kick();
});

/* 画像をドラッグしてカメラを回す。タッチでは縦のスクロールを妨げないよう横だけ受ける */
let drag: { x: number; y: number; yaw: number; pit: number } | null = null;
stage.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, yaw: V.yaw, pit: V.pit };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('drag');
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || !stage.hasPointerCapture(e.pointerId)) return;
  const k = 90 / Math.max(160, stage.clientWidth);
  G.set('yaw', Math.round(drag.yaw - (e.clientX - drag.x) * k));
  if (e.pointerType === 'mouse') G.set('pit', Math.round(drag.pit + (e.clientY - drag.y) * k));
});
const endDrag = (): void => {
  drag = null;
  stage.classList.remove('drag');
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

new ResizeObserver(() => {
  if (R && M && Math.abs(targetM() - M) > 8) {
    layout();
    kick();
  }
}).observe(cv);
new IntersectionObserver(([e]) => {
  visible = e.isIntersecting;
  if (visible) kick();
}).observe(stage);
document.addEventListener('visibilitychange', () => {
  lastT = 0;
  kick();
});

ready = true;
syncRows();
setPlaying(true);
setPick(-1);

/** シェーダーの準備ができたら始める。最初の絵は枠を描いてから */
function begin(): void {
  pushScene();
  requestAnimationFrame(() => {
    layout();
    showOut();
    kick();
  });
}

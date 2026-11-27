/**
 * テクスチャのフィルタのページの入口。バイクで道路を走る映像（乗っている人の目から前を見た眺め）を WebGL2 で描き、
 * アクセルとブレーキで速さを変える。離すとその速さを保つ。
 * 工程ごとに同じ映像へ載せるもの（段の絵・段の色・左右の比較）を変える。音はエンジンのページのバイクの音を、
 * 速さから決めた回転数で鳴らす。全画面では設定を図の隅の浮かぶ枠へ移す
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { initFullscreen } from '../../lib/fullscreen';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { EngineAudio } from '../engine/audio';
import { curv, engineAt, speedStep } from './drive';
import { type Filter, type FilterKind, LEVEL_COLORS, maxReads, NL, TS, usesMip } from './filter';
import { PITCH, VOL } from './params';
import { type DriveState, DriveView } from './render';
import { STEPS } from './steps';

initToolPage();

/** 縮めた絵の段を自動で移る間隔 [s] */
const HI_SEC = 1.1;

const page = $('#tf'),
  view = $('#tf-view'),
  cv = $<HTMLCanvasElement>('#tf-cv'),
  cap = $('#tf-cap'),
  busy = $('#tf-busy'),
  msg = $('#tf-msg'),
  tagL = $('#tf-tl'),
  tagR = $('#tf-tr'),
  spd = $('#tf-spd'),
  pyr = $('#tf-pyr'),
  chips = $('#tf-chips'),
  stepBtns = $$<HTMLButtonElement>('#tf-steps .how-c'),
  outR = $('#o-r'),
  outRs = $('#o-rs'),
  outMem = $('#o-mem');

/* ---------- 状態 ---------- */
const S = {
  step: 0,
  cmp: false,
  /** 比較の境目（図の幅に対する割合） */
  sp: 0.5,
  pitch: PITCH.v,
  trees: true,
  /** 映像の 1 画素を画面の何画素分で描くか */
  px: 3,
  f: [
    { b: 0, m: 0, a: 16 },
    { b: 3, m: 1, a: 16 },
  ] as Filter[],
  /** 縮めた絵で光らせる段と、自動で移るか */
  hi: 0,
  auto: true,
  at: 0,
  /** 速さ [m/s]・進んだ距離 [m]・道の向きの変化 [rad]・アクセルとブレーキ */
  v: 0,
  z: 0,
  head: 0,
  acc: false,
  brk: false,
  snd: false,
};
/** シェーダに渡すフィルタ（トライリニアと異方性はミップマップあり） */
const eff = (k: number): Filter => {
  const f = S.f[k];
  return { b: f.b, m: usesMip(f) ? 1 : 0, a: f.a };
};
const split = (): boolean => (S.step === 0 && S.cmp) || S.step === 3;

/* ---------- 描画の用意 ---------- */
let R: DriveView | null = null,
  roadLevels: Uint8ClampedArray[] = [];
function noGl(): void {
  busy.hidden = true;
  msg.textContent = 'このブラウザでは WebGL2 が使えないため表示できません';
  msg.hidden = false;
}
try {
  const r = new DriveView(cv);
  roadLevels = r.roadLevels;
  r.ready.then(() => {
    R = r;
    busy.hidden = true;
    dirty = true;
  }, noGl);
} catch {
  noGl();
}

/** キャンバスの画素数を表示の大きさの 1/k にする。CSS の画素を単位にして、粗さを端末の画素密度に依らせない */
function fitTo(c: HTMLCanvasElement, k: number): void {
  const r = c.getBoundingClientRect(),
    w = Math.max(2, Math.round(r.width / k)),
    h = Math.max(2, Math.round(r.height / k));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

/* ---------- 描画のループ ---------- */
let dirty = true,
  visible = true,
  last = performance.now();
new IntersectionObserver(([e]) => {
  visible = e.isIntersecting;
}).observe(view);
new ResizeObserver(() => {
  dirty = true;
}).observe(view);

function frame(t: number): void {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  const v0 = S.v;
  S.v = speedStep(S.v, S.acc, S.brk, dt);
  const moving = S.v > 0 || v0 > 0;
  if (moving) {
    S.z += S.v * dt;
    S.head += curv(S.z) * S.v * dt;
    show(spd, String(Math.round(S.v * 3.6)));
  }
  sound();
  if (S.step === 1 && S.auto && !RM.matches) {
    S.at += dt;
    if (S.at > HI_SEC) {
      S.at = 0;
      setHi((S.hi + 1) % NL, false);
    }
  }
  if (R && visible && (dirty || moving)) {
    dirty = false;
    fitTo(cv, S.px);
    const base = { pitch: S.pitch, z: S.z, curv: curv(S.z), head: S.head, trees: S.trees };
    const bil: Filter = { b: 1, m: 1, a: 1 },
      tri: Filter = { b: 2, m: 1, a: 1 };
    const at = Math.round(cv.width * S.sp);
    let st: DriveState;
    if (S.step === 0) st = { ...base, A: eff(0), B: eff(1), split: S.cmp ? at : undefined };
    else if (S.step === 1) st = { ...base, A: tri, hi: S.hi };
    else if (S.step === 2) st = { ...base, A: bil, tint: true };
    else st = { ...base, A: bil, B: tri, tint: true, split: at };
    R.draw(st);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- 表示 ---------- */
function show(el: HTMLElement, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}
const NAMES = ['最近傍', 'バイリニア', 'トライリニア', '異方性'];
const name = (f: Filter): string =>
  (f.b === 3 ? `異方性 ${f.a}x` : NAMES[f.b]) + (f.b < 2 && f.m ? '＋ミップマップ' : '');
const reads = (f: Filter): string => (f.b === 3 ? `最大 ${maxReads(f)}` : String(maxReads(f)));
const mem = (f: Filter): string => (usesMip(f) ? '1.33' : '1.00');

function sync(): void {
  tagL.hidden = tagR.hidden = !split();
  if (S.step === 3) {
    show(tagL, '切り替え');
    show(tagR, '混ぜる');
  } else {
    show(tagL, name(eff(0)));
    show(tagR, name(eff(1)));
  }
  const two = S.cmp && S.step === 0;
  show(outR, two ? `${reads(eff(0))} / ${reads(eff(1))}` : reads(eff(0)));
  show(outRs, two ? '左 / 右' : ' ');
  show(outMem, two ? `${mem(eff(0))} / ${mem(eff(1))}` : mem(eff(0)));
  dirty = true;
}

/* ---------- 工程 ---------- */
function setStep(i: number): void {
  S.step = i;
  stepBtns.forEach((b, k) => {
    b.setAttribute('aria-pressed', String(k === i));
  });
  show(cap, STEPS[i][2]);
  pyr.hidden = i !== 1;
  chips.hidden = i !== 2;
  view.classList.toggle('split', split());
  modeC.setOff(i !== 0);
  S.at = 0;
  sync();
}
for (const b of stepBtns) b.addEventListener('click', () => setStep(Number(b.dataset.i)));

/* 縮めた絵の段（道路の絵） */
let pyrBtns: HTMLButtonElement[] = [];
function buildPyramid(): void {
  pyr.textContent = '';
  pyrBtns = roadLevels.map((d, l) => {
    const s = TS >> l,
      b = document.createElement('button'),
      c = document.createElement('canvas');
    c.width = c.height = s;
    const im = new ImageData(s, s);
    /* 行 0 が手前なので、絵は上下を返して奥を上にする */
    for (let y = 0; y < s; y++) im.data.set(d.subarray((s - 1 - y) * s * 4, (s - y) * s * 4), y * s * 4);
    (c.getContext('2d') as CanvasRenderingContext2D).putImageData(im, 0, 0);
    c.style.setProperty('--s', String(s));
    const lab = document.createElement('span');
    lab.textContent = String(s);
    b.type = 'button';
    b.setAttribute('aria-label', `${s} 画素の段`);
    b.append(c, lab);
    b.addEventListener('click', () => setHi(l, true));
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') setHi(l, true);
    });
    pyr.append(b);
    return b;
  });
  setHi(S.hi, false);
}
function setHi(l: number, user: boolean): void {
  S.hi = l;
  pyrBtns.forEach((b, i) => {
    b.setAttribute('aria-pressed', String(i === l));
  });
  if (user) S.auto = false;
  dirty = true;
}
pyr.addEventListener('pointerleave', () => {
  S.auto = true;
  S.at = 0;
});
chips.innerHTML = LEVEL_COLORS.map((c, i) => `<span style="background:${c}">${TS >> i}</span>`).join('');

/* ---------- 入力 ---------- */
const modeC = new Choice<'one' | 'cmp'>($('#tf-mode'), (v) => setMode(v));
function setMode(v: 'one' | 'cmp'): void {
  S.cmp = v === 'cmp';
  page.dataset.mode = v;
  $('#tf-s1').hidden = !S.cmp;
  setStep(S.step);
}

for (const k of [0, 1]) {
  const f = S.f[k];
  let mC: Choice<'0' | '1'> | null = null,
    aC: Choice | null = null;
  const fix = () => {
    mC?.setOff(f.b >= 2, 'トライリニアと異方性ではいつも使います');
    aC?.setOff(f.b !== 3, '異方性のときだけ使います');
    sync();
  };
  const fC = new Choice($(`#p-f${k}`), (v) => {
    f.b = Number(v) as FilterKind;
    fix();
  });
  mC = new Choice<'0' | '1'>($(`#p-m${k}`), (v) => {
    f.m = v === '1' ? 1 : 0;
    fix();
  });
  aC = new Choice($(`#p-a${k}`), (v) => {
    f.a = Number(v);
    fix();
  });
  f.b = Number(fC.value) as FilterKind;
  f.m = mC.value === '1' ? 1 : 0;
  f.a = Number(aC.value);
  fix();
}

const treeC = new Choice<'1' | '0'>($('#p-tree'), (v) => {
  S.trees = v === '1';
  dirty = true;
});
S.trees = treeC.value === '1';

const pxC = new Choice($('#p-px'), (v) => {
  S.px = Number(v);
  dirty = true;
});
S.px = Number(pxC.value);

new ParamGroup<'pitch'>([PITCH], (v) => {
  S.pitch = v.pitch;
  dirty = true;
});

/* ---------- アクセルとブレーキ（押している間だけ。動作の状態なので保存しない） ---------- */
function pedal(id: string, key: 'acc' | 'brk'): (on: boolean) => void {
  const b = $<HTMLButtonElement>(id);
  const set = (on: boolean) => {
    S[key] = on;
    b.setAttribute('aria-pressed', String(on));
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    set(true);
    cv.focus({ preventScroll: true });
  });
  for (const n of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    b.addEventListener(n, () => set(false));
  /* キーボードで押したとき（Enter・Space）は、押している間だけ */
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      set(true);
    }
  });
  b.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') set(false);
  });
  b.addEventListener('blur', () => set(false));
  return set;
}
const setAcc = pedal('#tf-acc', 'acc'),
  setBrk = pedal('#tf-brk', 'brk');
const KEYS: Record<string, (on: boolean) => void> = { ArrowUp: setAcc, KeyW: setAcc, ArrowDown: setBrk, KeyS: setBrk };
/** キーで運転するのは、ページの図や枠の中にいるときだけ（入力欄とスライダは除く） */
const driving = (e: KeyboardEvent): boolean => {
  const t = e.target;
  if (!(t instanceof Element) || !t.closest('#tf')) return false;
  return !t.closest('input,select,textarea,[role="slider"],.sc');
};
document.addEventListener('keydown', (e) => {
  const f = KEYS[e.code];
  if (!f || e.altKey || e.ctrlKey || e.metaKey || !driving(e)) return;
  e.preventDefault();
  f(true);
});
document.addEventListener('keyup', (e) => {
  KEYS[e.code]?.(false);
});
const release = () => {
  setAcc(false);
  setBrk(false);
};
addEventListener('blur', release);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) release();
});
cv.addEventListener('pointerdown', () => cv.focus({ preventScroll: true }));

/* ---------- 境目を動かす ---------- */
let down = false;
function act(e: PointerEvent): void {
  const b = cv.getBoundingClientRect();
  S.sp = Math.max(0.02, Math.min(0.98, (e.clientX - b.left) / b.width));
  dirty = true;
}
cv.addEventListener('pointerdown', (e) => {
  if (!split()) return;
  down = true;
  cv.setPointerCapture(e.pointerId);
  act(e);
});
cv.addEventListener('pointermove', (e) => {
  if (down) act(e);
});
for (const n of ['pointerup', 'pointercancel'] as const)
  cv.addEventListener(n, () => {
    down = false;
  });
cv.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (!d || !split()) return;
  e.preventDefault();
  S.sp = Math.max(0.02, Math.min(0.98, S.sp + d * (e.shiftKey ? 0.1 : 0.02)));
  dirty = true;
});

/* ---------- 音: エンジンのページのバイクの音を、回転数を保つ運転で鳴らし、変わったときだけ送る ---------- */
const audio = new EngineAudio(),
  sndBtn = $<HTMLButtonElement>('#tf-snd'),
  sndMsg = $('#tf-sndmsg');
let sentRpm = -1,
  sentThr = -1;
/** アクセルを踏んでいる間は全開、ブレーキでは閉じる。離して速さを保つ間は半ばほど、止まっていればアイドリング */
const throttle = (): number => (S.acc ? 1 : S.brk ? 0 : S.v > 0 ? 0.35 : 0.08);
function sound(): void {
  if (!S.snd) return;
  const rpm = Math.round(engineAt(S.v).rpm / 10) * 10,
    th = throttle();
  if (rpm === sentRpm && th === sentThr) return;
  sentRpm = rpm;
  sentThr = th;
  audio.set({ rpm, throttle: th });
}
function setSnd(on: boolean): void {
  S.snd = on;
  sndBtn.setAttribute('aria-pressed', String(on));
}
sndBtn.addEventListener('click', async () => {
  if (S.snd) {
    audio.stop();
    setSnd(false);
    return;
  }
  sndMsg.textContent = '';
  if (!(await audio.ready())) {
    sndMsg.textContent = 'この環境では音を鳴らせません';
    return;
  }
  audio.start('ja65', 'stock', { mode: 'hold', rpm: engineAt(S.v).rpm, throttle: throttle() });
  sentRpm = sentThr = -1;
  setSnd(true);
});
new ParamGroup<'vol'>([VOL], (v) => {
  audio.vol(v.vol);
});
/* スマートフォンで画面が隠れたら音を止める（lib/pause.ts と同じ考え） */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld() && S.snd) {
    audio.stop();
    setSnd(false);
  }
});

/* ---------- 全画面: 表示の切り替え・音・設定を浮かぶ枠へ ---------- */
initFullscreen({
  root: $('#tf-stage'),
  btn: $<HTMLButtonElement>('#tf-fs'),
  focus: cv,
  popTitle: '設定',
  pop: () => [$('#tf-aux'), $('#tf-snd'), $('#tf-sets'), [$('#p-px'), $('#p-tree'), $('#p-pitch')]],
});

buildPyramid();
setMode(modeC.value);

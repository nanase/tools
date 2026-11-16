/**
 * 振り子時計のページの入口。時計の模型を毎フレーム進めて描く。
 * 状態をブラウザに保存し、開き直すと閉じていた間を表で進めて戻す。
 * 1/10・早送りから実際の速さに戻しても、進めた結果（時刻とゼンマイ）のまま続ける
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { BOX, type Colors, drawDial, drawFront, drawSection, hitAt, minutesOf, readColors, viewOf } from './fig';
import { Clock, clamp, type EscType, GEO, isSaved, type Pt, rateOf, type Snap, SPRING, springF, TABLES } from './model';
import { VOL } from './params';
import { caseIR, roomIR } from './room';
import { cue, makeSfx, SFX_PRELOAD, type SfxKind, whirOf } from './sfx';

initToolPage();

type Focus = 'full' | 'auto' | 'esc' | 'strike' | 'spring' | 'motion' | 'free';
const S = {
  speed: 1,
  snd: false,
  focus: 'full' as Focus,
  /** 正面図の中心と高さ [mm]（null は全体） */
  vc: null as Pt | null,
  vh: null as number | null,
  wind: { T: false, S: false },
  gal: 0.8,
  /** 指している部品の id */
  hl: null as string | null,
};
let C: Colors = readColors();
const sv = stored('pc-clock');
const clock = isSaved(sv) ? Clock.load(sv) : new Clock('recoil');
clock.setMode('live');

/* ===== 切り替え ===== */
function segOn(sel: string, fn: (v: string) => void, init?: string): void {
  const box = $(sel),
    mark = (v: string) => {
      for (const b of $$('button', box)) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    };
  if (init !== undefined) mark(init);
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-v]');
    if (!b) return;
    const v = b.dataset.v ?? '';
    mark(v);
    fn(v);
  });
}
segOn(
  '#pc-type',
  (v) => {
    clock.setType(v as EscType);
    save();
  },
  clock.type,
);
segOn('#pc-speed', (v) => setSpeed(+v));
/* 開いたときはいつも全体を映す（見る場所は覚えない） */
segOn(
  '#pc-focus',
  (v) => {
    S.focus = v as Focus;
  },
  S.focus,
);
const galIn = stored('pc-gal');
if (typeof galIn === 'number' && [0.25, 0.8, 2.5].includes(galIn)) S.gal = galIn;
segOn(
  '#pc-gal',
  (v) => {
    S.gal = +v;
    store('pc-gal', S.gal);
  },
  String(S.gal),
);
function setSpeed(v: number): void {
  const was = S.speed;
  S.speed = v;
  /* 早送りした分だけ時計は先へ進んでいる。実際の時刻へは「実際の時刻に合わせる」で戻す */
  if (v === 1 && was !== 1) clock.real = Date.now();
  clock.setMode(v <= 1 ? 'live' : 'avg');
}
function save(): void {
  store('pc-clock', clock.save());
}

/** 押した指やマウスを要素に結びつける（取り消された直後などに失敗しても続ける） */
function capture(el: Element, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* 結びつけられなくても、押した所の処理は続ける */
  }
}

/* ===== ゼンマイ・振り子・揺れ・時刻合わせ ===== */
/* ゼンマイのバー: 押した所（ドラッグした所）まで巻く・緩める。矢印キーで 1/4 回転ずつ */
for (const bar of $$<HTMLElement>('[data-bar]')) {
  const k = bar.dataset.bar as 'T' | 'S',
    cur = () => (k === 'T' ? clock.nT : clock.nS);
  let held = false;
  const setAt = (x: number) => {
    const r = bar.getBoundingClientRect();
    clock.setWind(k, clamp((x - r.left) / r.width, 0, 1) * SPRING.N);
  };
  bar.addEventListener('pointerdown', (e) => {
    held = true;
    capture(bar, e.pointerId);
    setAt(e.clientX);
  });
  bar.addEventListener('pointermove', (e) => {
    if (held) setAt(e.clientX);
  });
  for (const ev of ['pointerup', 'pointercancel'])
    bar.addEventListener(ev, () => {
      if (!held) return;
      held = false;
      save();
    });
  bar.addEventListener('keydown', (e) => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.25 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.25 : 0;
    if (!d) return;
    e.preventDefault();
    clock.setWind(k, cur() + d);
    save();
  });
}
for (const b of $$<HTMLButtonElement>('[data-wind]')) {
  const k = b.dataset.wind as 'T' | 'S';
  const on = (e: Event) => {
    e.preventDefault();
    if (e instanceof PointerEvent) capture(b, e.pointerId);
    S.wind[k] = true;
    if (k === 'T') clock.windT = true;
    else clock.windS = true;
    b.setAttribute('aria-pressed', 'true');
  };
  const off = () => {
    S.wind[k] = false;
    if (k === 'T') clock.windT = false;
    else clock.windS = false;
    b.setAttribute('aria-pressed', 'false');
    save();
  };
  b.addEventListener('pointerdown', on);
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
  b.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) on(e);
  });
  b.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') off();
  });
}
$('#pc-push').addEventListener('click', () => clock.push());
/* 一時停止: 時計の時間を止める（実際の時刻はそのまま進むので、続けると時刻のずれが増える） */
let paused = false;
const pauseBtn = $<HTMLButtonElement>('#pc-pause');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.setAttribute('aria-pressed', String(paused));
  pauseBtn.textContent = paused ? '再開' : '一時停止';
});
/* おもりを押さえる: 真ん中で押さえて止める。もう一度押すと離す */
const holdBtn = $<HTMLButtonElement>('#pc-hold');
let holding = false;
holdBtn.addEventListener('click', () => {
  holding = !holding;
  clock.grab(holding ? 0 : null);
  holdBtn.setAttribute('aria-pressed', String(holding));
});
$('#pc-kick').addEventListener('click', () => clock.shake('push', S.gal));
$('#pc-quake').addEventListener('click', () => clock.shake('quake', S.gal));
$('#pc-pre').addEventListener('click', () => {
  clock.toBeforeStrike(1);
  save();
});
$('#pc-now').addEventListener('click', () => {
  clock.setNow(S.speed === 1 ? Date.now() : clock.real);
  save();
});

/* ===== 正面図の拡大と移動 ===== */
const front = $<HTMLCanvasElement>('[data-cv=front]'),
  mini = $<HTMLCanvasElement>('[data-cv=mini]'),
  dial = $<HTMLCanvasElement>('[data-cv=dial]'),
  sec = $<HTMLCanvasElement>('[data-cv=sec]');
const FULL = (() => {
  const [x0, y0, x1, y1] = BOX.full;
  return { c: [(x0 + x1) / 2, (y0 + y1) / 2] as Pt, w: x1 - x0, h: y1 - y0 };
})();
function frontBox(): { box: number[]; h0: number } {
  const a = front.clientWidth / Math.max(1, front.clientHeight),
    h0 = Math.max(FULL.h, FULL.w / a),
    h = S.vh ?? h0,
    c = S.vc ?? FULL.c;
  return { box: [c[0] - (h * a) / 2, c[1] - h / 2, c[0] + (h * a) / 2, c[1] + h / 2], h0 };
}
function markFocus(v: string): void {
  for (const q of $$('#pc-focus button')) q.setAttribute('aria-pressed', String(q.dataset.v === v));
}
function toFree(): void {
  if (S.focus !== 'free') {
    S.focus = 'free';
    markFocus('');
  }
}
function toFull(): void {
  S.vc = S.vh = null;
  S.focus = 'full';
  markFocus('full');
}
/** 画面の点 (px, py) を中心に k 倍に拡大する */
function zoomAt(k: number, px: number, py: number): void {
  const v = viewOf(front);
  if (!v) return;
  toFree();
  const { h0 } = frontBox(),
    wx = (px - v.ox) / v.s - clock.gx,
    wy = (v.oy - py) / v.s,
    c = S.vc ?? FULL.c,
    h = S.vh ?? h0,
    nh = clamp(h / k, 10, h0),
    r = nh / h;
  if (nh >= h0 - 1e-6) {
    toFull();
    return;
  }
  S.vc = [wx + (c[0] - wx) * r, wy + (c[1] - wy) * r];
  S.vh = nh;
}
{
  const pts = new Map<number, Pt>();
  let drag: { x: number; y: number; moved: boolean; c: Pt; d0: number } | null = null;
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  front.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = front.getBoundingClientRect();
      zoomAt(1.0018 ** -e.deltaY, e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  /* おもりをつかむ: 押した所から吊り点を見た角を、振り子の目標の角にする */
  let grabId: number | null = null;
  const grabAt = (e: PointerEvent) => {
    const r = front.getBoundingClientRect(),
      v = viewOf(front);
    if (!v) return;
    const wx = (e.clientX - r.left - v.ox) / v.s - clock.gx,
      wy = (v.oy - (e.clientY - r.top)) / v.s,
      [sx, sy] = GEO.SUS;
    clock.grab(Math.atan2(wx - sx, sy - wy));
  };
  front.addEventListener('pointerdown', (e) => {
    const r = front.getBoundingClientRect(),
      h = hitAt(front, e.clientX - r.left, e.clientY - r.top);
    if (h && (h.id === 'bob' || h.id === 'rod') && S.speed <= 1 && grabId === null) {
      capture(front, e.pointerId);
      grabId = e.pointerId;
      grabAt(e);
      return;
    }
    capture(front, e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    drag = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      c: [...(S.vc ?? FULL.c)] as Pt,
      d0: pts.size === 2 ? dist() : 0,
    };
  });
  front.addEventListener('pointermove', (e) => {
    if (e.pointerId === grabId) {
      grabAt(e);
      return;
    }
    if (!pts.has(e.pointerId) || !drag) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const r = front.getBoundingClientRect(),
      v = viewOf(front);
    if (!v) return;
    if (pts.size === 2) {
      const d = dist(),
        [a, b] = [...pts.values()];
      if (drag.d0) zoomAt(d / drag.d0, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
      drag.d0 = d;
      drag.moved = true;
      return;
    }
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved && S.vh) {
      toFree();
      S.vc = [drag.c[0] - dx / v.s, drag.c[1] + dy / v.s];
    }
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId === grabId) {
      grabId = null;
      clock.grab(holding ? 0 : null);
      return;
    }
    pts.delete(e.pointerId);
    if (!pts.size) drag = null;
  };
  front.addEventListener('pointerup', up);
  front.addEventListener('pointercancel', up);
  front.addEventListener('dblclick', toFull);
  $('#pc-zin').addEventListener('click', () => zoomAt(1.5, front.clientWidth / 2, front.clientHeight / 2));
  $('#pc-zout').addEventListener('click', () => zoomAt(1 / 1.5, front.clientWidth / 2, front.clientHeight / 2));
  /* 全体の図: 押した所を表示の中心にする（全体を映しているときは高さ 50 mm まで寄る） */
  const go = (e: PointerEvent) => {
    const r = mini.getBoundingClientRect(),
      v = viewOf(mini);
    if (!v) return;
    toFree();
    S.vc = [(e.clientX - r.left - v.ox) / v.s, (v.oy - (e.clientY - r.top)) / v.s];
    S.vh ??= 50;
  };
  mini.addEventListener('pointerdown', (e) => {
    capture(mini, e.pointerId);
    go(e);
  });
  mini.addEventListener('pointermove', (e) => {
    if (mini.hasPointerCapture(e.pointerId)) go(e);
  });
}
/* ===== 文字盤の分針をドラッグ ===== */
{
  let last: number | null = null;
  const ang = (e: PointerEvent) => {
    const r = dial.getBoundingClientRect();
    return Math.atan2(e.clientX - r.left - r.width / 2, -(e.clientY - r.top - r.height / 2));
  };
  dial.addEventListener('pointerdown', (e) => {
    capture(dial, e.pointerId);
    last = ang(e);
  });
  dial.addEventListener('pointermove', (e) => {
    if (last === null) return;
    const a = ang(e);
    let d = a - last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    last = a;
    clock.turnHands((d / (2 * Math.PI)) * 60);
  });
  for (const ev of ['pointerup', 'pointercancel'])
    dial.addEventListener(ev, () => {
      if (last !== null) save();
      last = null;
    });
}

/* ===== 見る場所（全体・自動・部品ごと） ===== */
const AUTO: Record<string, [Pt, number]> = {
  esc: [[0, 33], 36],
  strike: [[-30, 12], 50],
  spring: [[22, -26], 44],
  springS: [[-22, -26], 44],
  motion: [[-2, -2], 28],
};
function easeView(f: Snap): void {
  let k: string = S.focus;
  if (k === 'free') return;
  if (k === 'auto') k = S.wind.T ? 'spring' : S.wind.S ? 'springS' : f.sst !== 'lock' || f.hamT < 2 ? 'strike' : 'esc';
  if (k === 'spring' && S.wind.S && !S.wind.T) k = 'springS';
  const { h0 } = frontBox(),
    [c1, h1] = k === 'full' ? [FULL.c, h0] : AUTO[k],
    c0 = S.vc ?? FULL.c,
    hh = S.vh ?? h0,
    e = 0.14,
    nc: Pt = [c0[0] + (c1[0] - c0[0]) * e, c0[1] + (c1[1] - c0[1]) * e],
    nh = hh + (h1 - hh) * e;
  if (k === 'full' && Math.abs(nh - h0) < 0.3 && Math.hypot(nc[0] - FULL.c[0], nc[1] - FULL.c[1]) < 0.3)
    S.vc = S.vh = null;
  else {
    S.vc = nc;
    S.vh = Math.min(nh, h0);
  }
}

/* ===== 部品名の吹き出し: マウスは乗せる、タッチは押す ===== */
const tipAt = new Map<HTMLElement, { x: number; y: number; name: string }>();
for (const v of $$('.pc-v').filter((el) => el.querySelector('.pc-tip'))) {
  const cv = $<HTMLCanvasElement>('canvas', v),
    tip = $('.pc-tip', v);
  const hide = () => {
    tip.hidden = true;
    tipAt.delete(v);
    S.hl = null;
  };
  const show = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      h = hitAt(cv, x, y);
    if (!h) return hide();
    S.hl = h.id;
    tipAt.set(v, { x: e.clientX, y: e.clientY, name: h.name });
    tip.innerHTML = `<b>${esc(h.name)}</b>${h.sub ? `<span>${esc(h.sub)}</span>` : ''}`;
    tip.hidden = false;
    tip.style.left = `${clamp(x + 12, 4, Math.max(4, v.clientWidth - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(4, y - tip.offsetHeight - 10)}px`;
  };
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !e.buttons) show(e);
  });
  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') show(e);
    else hide();
  });
  cv.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });
}
document.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.pc-v')) return;
  for (const v of [...tipAt.keys()]) {
    $('.pc-tip', v).hidden = true;
    tipAt.delete(v);
  }
});

/* ===== 音: 効果音を前もって作り、当たりの速さに比例した大きさで鳴らす ===== */
type Ctor = typeof AudioContext;
const ACtor: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
let ac: AudioContext | null = null,
  out: GainNode | null = null,
  whir: { bp: BiquadFilterNode; g: GainNode } | null = null;
const bufs = new Map<SfxKind, AudioBuffer>();
function buf(a: AudioContext, kind: SfxKind): AudioBuffer {
  let b = bufs.get(kind);
  if (!b) {
    const y = makeSfx(kind, a.sampleRate);
    b = a.createBuffer(1, y.length, a.sampleRate);
    b.getChannelData(0).set(y);
    bufs.set(kind, b);
  }
  return b;
}
/** at: 鳴らす時刻（AudioContext の時刻） */
function play(kind: SfxKind, gain: number, at: number): void {
  if (!ac || !out || ac.state !== 'running') return;
  const s = ac.createBufferSource(),
    g = ac.createGain();
  s.buffer = buf(ac, kind);
  g.gain.value = gain;
  s.connect(g).connect(out);
  s.start(Math.max(ac.currentTime, at));
}
const sndBtn = $('#pc-snd');
function setSnd(on: boolean): void {
  S.snd = on;
  sndBtn.setAttribute('aria-pressed', String(on));
  $('.led', sndBtn).classList.toggle('on', on);
}
sndBtn.addEventListener('click', () => {
  if (S.snd) {
    void ac?.suspend();
    setSnd(false);
    return;
  }
  if (!ACtor) return;
  if (!ac) {
    ac = new ACtor();
    out = ac.createGain();
    /* 既定の大きさを −26 LUFS にそろえた値（bun run loudness） */
    out.gain.value = 1;
    comp = ac.createGain();
    vol = ac.createGain();
    vol.gain.value = 10 ** (SND.vol / 20);
    /* 音量を 0 dB より上げたときだけ、出口で割れないよう抑える（−2 dBFS より上） */
    lim = ac.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    lim.connect(ac.destination);
    comp.connect(vol);
    wire();
    wireVol();
    /* 風切りの風の音: 雑音を羽の通る数の周波数あたりで鳴らす */
    const n = ac.sampleRate * 2,
      nb = ac.createBuffer(1, n, ac.sampleRate),
      d = nb.getChannelData(0);
    let x = 21;
    for (let i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      d[i] = (x / 4294967296) * 2 - 1;
    }
    const src = ac.createBufferSource(),
      bp = ac.createBiquadFilter(),
      g = ac.createGain();
    src.buffer = nb;
    src.loop = true;
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    g.gain.value = 0;
    src.connect(bp).connect(g).connect(out);
    src.start();
    whir = { bp, g };
    for (const k of SFX_PRELOAD) buf(ac, k);
  }
  void ac.resume();
  setSnd(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld() && S.snd) {
    void ac?.suspend();
    setSnd(false);
  }
});
/*
 * 音の出口: 鳴らす音（out）→ 箱の響き → 部屋の響き → 大きさの補正（comp）→ 音量（vol）→ 抑え → スピーカー。
 * 箱と部屋は選んだときだけ畳み込む
 */
const SND = { case: false, room: 'off', vol: 0 };
/** 箱・部屋を入れても全体の大きさが変わらないようにする補正 [dB]（リコイル式の刻む音で測った値） */
const COMP: Record<string, number> = {
  'off/off': 0,
  'on/off': -6.0,
  'off/living': 3.75,
  'on/living': -2.1,
  'off/hall': 2.0,
  'on/hall': -4.4,
};
let comp: GainNode | null = null,
  vol: GainNode | null = null,
  lim: DynamicsCompressorNode | null = null,
  caseCv: ConvolverNode | null = null,
  roomCv: ConvolverNode | null = null,
  roomFor = '';
function wire(): void {
  if (!ac || !out || !comp) return;
  out.disconnect();
  caseCv?.disconnect();
  roomCv?.disconnect();
  let node: AudioNode = out;
  if (SND.case) {
    if (!caseCv) {
      const h = caseIR(ac.sampleRate),
        b = ac.createBuffer(1, h.length, ac.sampleRate);
      b.getChannelData(0).set(h);
      caseCv = ac.createConvolver();
      caseCv.normalize = false;
      caseCv.buffer = b;
    }
    node.connect(caseCv);
    node = caseCv;
  }
  const ir = SND.room === 'off' ? null : roomIR(ac.sampleRate, SND.room);
  if (ir) {
    if (!roomCv) {
      roomCv = ac.createConvolver();
      roomCv.normalize = false;
    }
    if (roomFor !== SND.room) {
      const b = ac.createBuffer(2, ir[0].length, ac.sampleRate);
      b.getChannelData(0).set(ir[0]);
      b.getChannelData(1).set(ir[1]);
      roomCv.buffer = b;
      roomFor = SND.room;
    }
    node.connect(roomCv);
    node = roomCv;
  }
  node.connect(comp);
  comp.gain.value = 10 ** ((COMP[`${SND.case ? 'on' : 'off'}/${SND.room}`] ?? 0) / 20);
}
/* 圧縮器は持ち上げ（メイクアップ）を掛けるので、0 dB 以下では通さない */
function wireVol(): void {
  if (!ac || !vol || !lim) return;
  vol.gain.value = 10 ** (SND.vol / 20);
  vol.disconnect();
  vol.connect(SND.vol > 0 ? lim : ac.destination);
}
new ParamGroup([VOL], (v) => {
  SND.vol = v.vol;
  wireVol();
});
const caseCh = new Choice<'on' | 'off'>($('#p-case'), (v) => {
    SND.case = v === 'on';
    wire();
  }),
  roomCh = new Choice<string>($('#p-room'), (v) => {
    SND.room = v;
    wire();
  });
SND.case = caseCh.value === 'on';
SND.room = roomCh.value;

/** 出来事は 1 こまの間に起きる。こまの終わりからのずれを保って、少し遅らせて鳴らす */
const LAG = 0.06;
function sounds(): void {
  if (!S.snd || !ac) return;
  const live = S.speed <= 1,
    now = ac.currentTime,
    tEnd = clock.live?.t ?? 0;
  for (const e of clock.events)
    for (const c of cue(e, clock.type, live)) {
      const off = live && e.t !== undefined ? Math.max(-LAG, (e.t - tEnd) / Math.max(S.speed, 1e-3)) : -LAG;
      play(c.kind, c.gain, now + LAG + off + (c.dt ?? 0));
    }
  if (whir) {
    const w = whirOf(live && clock.sst === 'run' ? clock.sw : 0);
    whir.bp.frequency.setTargetAtTime(w.freq, now, 0.03);
    whir.g.gain.setTargetAtTime(w.gain, now, 0.05);
  }
}

/* ===== 表示 ===== */
const setText = (id: string, v: string) => {
  const el = $(id);
  if (el.textContent !== v) el.textContent = v;
};
const two = (v: number) => String(v).padStart(2, '0');
const hms = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
/** ゼンマイが止まるまでの残りの日数 */
function daysLeft(n: number, stopF: number): number {
  let lo = 0,
    hi = SPRING.N;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (springF(m) > stopF) hi = m;
    else lo = m;
  }
  return Math.max(0, n - hi);
}
function render(): void {
  const f = clock.snap();
  easeView(f);
  const fb = frontBox();
  drawFront(front, f, C, { box: fb.box, full: !S.vh, hl: S.hl });
  drawFront(mini, f, C, { full: false, labels: false, lens: S.vh ? fb.box : null, shake: false, hl: S.hl });
  drawDial(dial, f, C, S.wind);
  drawSection(sec, f, C, S.hl);
  const tab = TABLES[f.type];
  setText('#pc-dT', `残り ${daysLeft(f.nT, tab.fStop).toFixed(1)} 日`);
  setText('#pc-dS', `残り ${f.nS.toFixed(1)} 日`);
  $('#pc-barT').style.width = `${clamp(f.nT / SPRING.N, 0, 1) * 100}%`;
  $('#pc-barS').style.width = `${clamp(f.nS / SPRING.N, 0, 1) * 100}%`;
  for (const [k, n, d] of [
    ['T', f.nT, daysLeft(f.nT, tab.fStop)],
    ['S', f.nS, f.nS],
  ] as const) {
    const bar = $(`[data-bar=${k}]`),
      v = n.toFixed(1);
    if (bar.getAttribute('aria-valuenow') !== v) {
      bar.setAttribute('aria-valuenow', v);
      bar.setAttribute('aria-valuetext', `残り ${d.toFixed(1)} 日`);
    }
  }
  const realMs = S.speed === 1 ? Date.now() : clock.real,
    err = (f.clockMs - realMs) / 1000,
    ae = Math.abs(err),
    sg = err >= 0 ? '+' : '−';
  setText('#pc-tc', hms(f.clockMs));
  setText('#pc-tr', hms(realMs));
  setText(
    '#pc-err',
    ae >= 120 ? `${sg}${Math.floor(ae / 60)} 分 ${(ae % 60).toFixed(1)} 秒` : `${sg}${ae.toFixed(1)} s`,
  );
  if (f.stopped) setText('#pc-rate', '停止中');
  else {
    const r = rateOf(f.type, f.fT);
    setText('#pc-rate', `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(0)} s/日`);
  }
  setText('#pc-amp', `±${f.A.toFixed(2)}°`);
  const nh = Math.floor(minutesOf(f) / 30 + 1) * 30,
    nd = new Date(f.clockMs);
  nd.setHours(0, nh, 0, 0);
  const atT = `${two(nd.getHours())}:${two(nd.getMinutes())}`;
  setText(
    '#pc-strk',
    f.sst === 'run'
      ? f.sw < 0.02 && f.nS < 0.05
        ? 'ゼンマイ切れ'
        : `打っている ${f.blows}/${clock.strikeTotal()}`
      : f.sst === 'lock'
        ? `次 ${atT}・${f.next} 回`
        : `予告 ${atT}・${f.next} 回`,
  );
  setText(
    '#pc-mode',
    paused ? '一時停止中' : S.speed === 1 ? '実際の時刻で動作中' : S.speed < 1 ? '1/10 の速さで動作中' : '早送り中',
  );
  $<HTMLButtonElement>('#pc-push').disabled = !f.stopped;
  setText('#pc-pnote', f.stopped ? (f.fT <= tab.fStop ? 'ゼンマイを巻いてから押す' : '止まっている振り子') : '');
  const live = S.speed <= 1;
  $<HTMLButtonElement>('#pc-kick').disabled = $<HTMLButtonElement>('#pc-quake').disabled = !live || f.quake;
  /* 早送りの間はつかめない。実際の速さへ戻ったら押さえ直す */
  holdBtn.disabled = !live;
  if (holding && live && !clock.grabbed) clock.grab(0);
  setText(
    '#pc-shk',
    !live
      ? '早送りの間は揺らせません'
      : clock.grabbed
        ? 'おもりをつかんでいる'
        : f.quake
          ? `台の変位 ${f.gx >= 0 ? '+' : '−'}${Math.abs(f.gx).toFixed(1)} mm`
          : '振り子の振れる向きに台を揺らす',
  );
}

let last = performance.now(),
  saveT = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock.advance(paused ? 0 : dt, S.speed);
  sounds();
  clock.events.length = 0;
  render();
  saveT += dt;
  if (saveT > 2) {
    saveT = 0;
    save();
  }
  requestAnimationFrame(frame);
}
addEventListener('pagehide', save);
const recolor = () => {
  C = readColors();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
requestAnimationFrame(frame);

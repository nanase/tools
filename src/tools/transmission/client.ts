/**
 * 変速機のページの入口。運転の模型を毎フレーム進めて描く。場面の枠を開くと、場面の記録の再生に切り替え、
 * 運転の操作に触れると運転の表示へ戻る。運転の模型は場面の再生中は止めておき、戻ったときに続きから動かす
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { EngineAudio } from '../engine/audio';
import { VOL } from '../engine/params';
import type { MufflerId } from '../engine/spec';
import {
  cfLabel,
  drawDrum,
  drawGraph,
  drawSection,
  drawSide,
  fmt,
  type GPt,
  type Hit,
  hitsOf,
  mpLabel,
  readColors,
  type View,
} from './fig';
import { clamp, Driver, DT, Model, REC_DT, type Rec, RPM, record, SCENES, type SceneId, type Snap } from './model';
import { makeSfx, type SfxKind } from './sfx';

initToolPage();

type ViewKey = 'path' | 'flow' | 'blur' | 'cut';
const S = {
  /** 指している部品の ID */
  hl: null as string | null,
  /** 運転の速さ（実際の速さに対する比） */
  slow: 1,
  auto: false,
  lock: false,
  /** 運転の一時停止 */
  paused: false,
  /** エンジンの音を鳴らしているか */
  snd: false,
  muf: 'stock' as MufflerId,
  src: 'live' as 'live' | 'scene',
  scene: 'up' as SceneId,
  play: false,
  /** 場面の再生位置 [s] */
  pt: 0,
  prate: 0.05,
  /** 場面を最後まで再生した時刻（少し止めてから頭へ戻す） */
  endT: 0,
  view: { path: true, flow: true, blur: true, cut: true } as Record<ViewKey, boolean>,
};
const m = new Model(),
  drv = new Driver(m);
const hist: GPt[] = [];
let histT = 0,
  prevSnap: Snap | null = null,
  C = readColors();

/* ---------- 場面 ---------- */
interface StageMap {
  ends: [number | null, number][];
  w: number[];
  tot: number;
}
const scenes: Partial<Record<SceneId, { rec: Rec; map: StageMap }>> = {};
function sceneOf(k: SceneId): { rec: Rec; map: StageMap } {
  const hit = scenes[k];
  if (hit) return hit;
  const rec = record(k);
  /* 段階ごとの幅は長さの平方根に比例させ、短い段階も押せる幅にする */
  const ends = rec.bounds.map((b, i): [number | null, number] => [
    b,
    rec.bounds.slice(i + 1).find((x) => x != null) ?? rec.dur,
  ]);
  const w = ends.map(([a, b]) => (a == null ? 0 : Math.sqrt(Math.max(0.02, b - a)))),
    tot = w.reduce((a, b) => a + b, 0);
  const sc = { rec, map: { ends, w, tot } };
  scenes[k] = sc;
  return sc;
}
const frameAt = (rec: Rec, t: number): Snap => rec.frames[clamp(Math.round(t / REC_DT), 0, rec.frames.length - 1)];
/** 再生位置 [s] → 再生の欄の位置（0〜1） */
function uOf(sc: { rec: Rec; map: StageMap }, t: number): number {
  let acc = 0;
  for (const [i, [a, b]] of sc.map.ends.entries()) {
    const fw = sc.map.w[i] / sc.map.tot;
    if (!fw || a == null) continue;
    if (t <= b || i === sc.map.ends.length - 1) return acc + fw * clamp((t - a) / (b - a), 0, 1);
    acc += fw;
  }
  return 1;
}
/** 再生の欄の位置（0〜1） → 再生位置 [s] */
function tOf(sc: { rec: Rec; map: StageMap }, u: number): number {
  let acc = 0;
  const n = sc.map.ends.length;
  for (let i = 0; i < n; i++) {
    const fw = sc.map.w[i] / sc.map.tot;
    if (!fw) continue;
    const [a, b] = sc.map.ends[i];
    if (a != null && (u <= acc + fw || i === n - 1)) return a + clamp((u - acc) / fw, 0, 1) * (b - a);
    acc += fw;
  }
  return sc.rec.dur;
}

const trk = $('#tp-trk'),
  pp = $<HTMLButtonElement>('#tp-pp'),
  list = $('#tm-list');
function buildScene(): void {
  const sc = sceneOf(S.scene),
    { rec } = sc;
  /* 段階の境目の目盛り（0〜100 の座標で描き、線の太さは拡大しない） */
  let d = '';
  let acc = 0;
  for (let i = 0; i < sc.map.w.length - 1; i++) {
    acc += sc.map.w[i] / sc.map.tot;
    if (sc.map.w[i]) d += `M${(acc * 100).toFixed(2)} 0V7`;
  }
  $('#tp-tk path.mj').setAttribute('d', d);
  list.innerHTML = rec.stages
    .map(
      (s, i) =>
        `<li${rec.bounds[i] == null ? ' hidden' : ''}><button type="button" data-i="${i}"><b>${esc(s.n)}</b><span>${esc(s.d)}</span></button></li>`,
    )
    .join('');
  $('#tp-n').textContent = String(rec.stages.filter((_, i) => rec.bounds[i] != null).length);
}
list.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-i]');
  if (!b) return;
  const t = sceneOf(S.scene).rec.bounds[Number(b.dataset.i)];
  if (t != null) {
    S.pt = t;
    S.play = false;
    S.src = 'scene';
  }
});

/* ---------- 操作 ---------- */
const scnBtn = $<HTMLButtonElement>('#hd-scn'),
  scnOpen = () => scnBtn.getAttribute('aria-expanded') === 'true';
function toLive(): void {
  S.src = 'live';
  S.play = false;
}
function toScene(): void {
  S.src = 'scene';
  S.pt = 0;
  S.endT = 0;
  S.play = !RM.matches;
}
const autoBtn = $<HTMLButtonElement>('#tm-auto'),
  lockBtn = $<HTMLButtonElement>('#tm-lock'),
  flBtn = $<HTMLButtonElement>('#tm-flb'),
  fl = $('#tm-fl');
/** 指を離すまで同じ要素で受ける（取れないときは受けないまま続ける） */
const capture = (el: Element, id: number) => {
  try {
    el.setPointerCapture(id);
  } catch {
    /* 合成のポインターなど */
  }
};
const syncTg = (b: HTMLButtonElement, on: boolean) => {
  b.setAttribute('aria-pressed', String(on));
  b.querySelector('.led')?.classList.toggle('on', on);
};
function stopAuto(): void {
  toLive();
  if (S.auto) {
    S.auto = false;
    drv.reset();
    m.thr = 0;
    m.brake = 0;
    syncAuto();
  }
}
syncTg(autoBtn, S.auto);
const flAuto = $<HTMLButtonElement>('#tm-fl-auto');
const syncAuto = () => {
  syncTg(autoBtn, S.auto);
  syncTg(flAuto, S.auto);
};
syncAuto();
const toggleAuto = () => {
  S.auto = !S.auto;
  syncAuto();
  toLive();
  drv.reset();
  m.thr = 0;
  m.brake = 0;
  m.release();
};
autoBtn.addEventListener('click', toggleAuto);
flAuto.addEventListener('click', toggleAuto);
lockBtn.addEventListener('click', () => {
  S.lock = !S.lock;
  syncTg(lockBtn, S.lock);
  if (!S.lock) m.thr = 0;
});
/* 操作盤: 運転の枠を小さくした窓を右下に浮かべる。開閉は保存する（初めは広い画面で開く） */
function setFloat(on: boolean, save = true): void {
  fl.hidden = !on;
  flBtn.setAttribute('aria-pressed', String(on));
  if (save) store('tm-float', on);
}
{
  const sv = stored('tm-float');
  setFloat(typeof sv === 'boolean' ? sv : matchMedia('(min-width: 1000px)').matches, false);
}
flBtn.addEventListener('click', () => setFloat(fl.hasAttribute('hidden')));
$('#tm-fl-x').addEventListener('click', () => setFloat(false));

for (const b of $$<HTMLButtonElement>('[data-ped]')) {
  const dir = b.dataset.ped === '1' ? 1 : -1;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stopAuto();
    m.press(dir);
    capture(b, e.pointerId);
  });
  for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => m.release());
}
for (const pad of $$('[data-pad]')) {
  const key = pad.dataset.pad === 'thr' ? 'thr' : 'brake';
  const set = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect(),
      u = clamp((e.clientX - r.left) / r.width, 0, 1);
    m[key] = key === 'brake' ? u * 0.6 : u;
    pad.classList.add('on');
  };
  pad.addEventListener('pointerdown', (e) => {
    stopAuto();
    capture(pad, e.pointerId);
    set(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (pad.hasPointerCapture(e.pointerId)) set(e);
  });
  for (const ev of ['pointerup', 'pointercancel'])
    pad.addEventListener(ev, () => {
      pad.classList.remove('on');
      if (!(key === 'thr' && S.lock)) m[key] = 0;
    });
}
/* キーボード: ↑ でシフトアップ、↓ でシフトダウン（押している間）。入力欄・ボタン・ほかのスライダーにいるときは使わない */
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
  if (
    e.repeat ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    (t instanceof Element && t.closest('input,select,textarea,button,summary,[role="slider"]:not([data-pad])'))
  )
    return;
  e.preventDefault();
  stopAuto();
  m.press(e.code === 'ArrowUp' ? 1 : -1);
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') m.release();
});

/* 保存した選択は生成の直後に読めるので、ここで状態へ写す（onChange は少し後で呼ばれる） */
const isScene = (v: string): v is SceneId => v in SCENES;
S.slow =
  Number(
    new Choice<string>($('#tm-slow'), (v) => {
      S.slow = Number(v) || 1;
    }).value,
  ) || S.slow;
S.prate =
  Number(
    new Choice<string>($('#tm-rate'), (v) => {
      S.prate = Number(v) || 0.05;
    }).value,
  ) || S.prate;
const sceneCh = new Choice<string>($('#tm-scene'), (v) => {
  if (!isScene(v)) return;
  S.scene = v;
  buildScene();
  if (scnOpen()) toScene();
});
if (isScene(sceneCh.value)) S.scene = sceneCh.value;
for (const k of ['path', 'flow', 'blur', 'cut'] as const) {
  const ch = new Choice<string>($(`#p-v-${k}`), (v) => {
    S.view[k] = v === '1';
    $('#tm-leg-path').hidden = !S.view.path;
  });
  S.view[k] = ch.value === '1';
}
$('#tm-leg-path').hidden = !S.view.path;
/* 場面の枠の開閉（開閉そのものは lib/tool-page.ts が先に済ませる） */
scnBtn.addEventListener('click', () => {
  if (scnOpen()) toScene();
  else toLive();
});

/* 再生の操作 */
pp.addEventListener('click', () => {
  const { rec } = sceneOf(S.scene);
  const playing = S.src === 'scene' && S.play;
  S.src = 'scene';
  S.play = !playing;
  S.endT = 0;
  if (S.play && S.pt >= rec.dur) S.pt = 0;
});
$('#tp-home').addEventListener('click', () => {
  S.src = 'scene';
  S.pt = 0;
  S.endT = 0;
});
const stepStage = (d: 1 | -1) => {
  const { rec } = sceneOf(S.scene),
    cur = frameAt(rec, S.pt).stage ?? 0;
  S.src = 'scene';
  S.play = false;
  if (d < 0) S.pt = [...rec.bounds.slice(0, cur)].reverse().find((x) => x != null) ?? 0;
  else {
    const t = rec.bounds.slice(cur + 1).find((x) => x != null);
    if (t != null) S.pt = t;
  }
};
$('#tp-prev').addEventListener('click', () => stepStage(-1));
$('#tp-next').addEventListener('click', () => stepStage(1));
trk.addEventListener('pointerdown', (e) => {
  const sc = sceneOf(S.scene);
  const go = (x: number) => {
    const r = trk.getBoundingClientRect();
    S.pt = tOf(sc, clamp((x - r.left) / r.width, 0, 1));
  };
  S.src = 'scene';
  S.play = false;
  capture(trk, e.pointerId);
  go(e.clientX);
  const move = (ev: PointerEvent) => go(ev.clientX);
  const up = () => {
    trk.removeEventListener('pointermove', move);
    trk.removeEventListener('pointerup', up);
    trk.removeEventListener('pointercancel', up);
  };
  trk.addEventListener('pointermove', move);
  trk.addEventListener('pointerup', up);
  trk.addEventListener('pointercancel', up);
});
trk.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  stepStage(d);
});

/* ---------- 部品名の吹き出し: マウスは乗せる、タッチは押す ---------- */
const tipAt = new Map<HTMLElement, { x: number; y: number; name: string }>();
const views = $$('.tm-v');
const inside = (h: Hit, x: number, y: number) => {
  if (h.t === 'r') return x >= h.a[0] && x <= h.a[2] && y >= h.a[1] && y <= h.a[3];
  const d = Math.hypot(x - h.a[0], y - h.a[1]);
  return d <= h.a[2] && d >= h.a[3];
};
for (const v of views) {
  const cv = $<HTMLCanvasElement>('canvas', v),
    tip = $('.tm-tip', v);
  const hide = () => {
    tip.hidden = true;
    tipAt.delete(v);
    S.hl = null;
  };
  const show = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      hs = hitsOf(cv);
    let h: Hit | undefined;
    for (let i = hs.length - 1; i >= 0 && !h; i--) if (inside(hs[i], x, y)) h = hs[i];
    if (!h) {
      hide();
      cv.style.cursor = '';
      return;
    }
    S.hl = h.id;
    cv.style.cursor = 'pointer';
    tipAt.set(v, { x: e.clientX, y: e.clientY, name: h.name });
    tip.innerHTML = `<b>${esc(h.name)}</b>${h.sub ? `<span>${esc(h.sub)}</span>` : ''}`;
    tip.hidden = false;
    const w = v.clientWidth;
    tip.style.left = `${clamp(x + 12, 4, Math.max(4, w - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(4, y - tip.offsetHeight - 10)}px`;
  };
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') show(e);
  });
  cv.addEventListener('pointerdown', show);
  cv.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });
}
document.addEventListener('pointerdown', (e) => {
  if (!(e.target instanceof Element && e.target.closest('.tm-v'))) {
    for (const t of $$('.tm-tip')) t.hidden = true;
    tipAt.clear();
    S.hl = null;
  }
});
addEventListener('resize', () => {
  for (const v of views) $('.tm-tip', v).hidden = true;
  tipAt.clear();
});
/** 開いている吹き出しの補足（回転数など）を今の値に合わせる */
function refreshTips(): void {
  for (const [v, at] of tipAt) {
    const cv = $<HTMLCanvasElement>('canvas', v),
      h = [...hitsOf(cv)].reverse().find((x) => x.name === at.name),
      sp = v.querySelector('.tm-tip span');
    if (h?.sub && sp && sp.textContent !== h.sub) sp.textContent = h.sub;
  }
}

/* ---------- 描画 ---------- */
const cvSec = $<HTMLCanvasElement>('[data-cv=sec]'),
  cvSide = $<HTMLCanvasElement>('[data-cv=side]'),
  cvDrum = $<HTMLCanvasElement>('[data-cv=drum]'),
  cvGraph = $<HTMLCanvasElement>('#tm-graph'),
  thrPads = $$('[data-pad=thr]'),
  brkFs = $$('[data-pad=brk] .thr-f');
const setAll = (k: string, v: string) => {
  for (const el of $$(`[data-o="${k}"]`)) if (el.textContent !== v) el.textContent = v;
};
const setText = (id: string, v: string) => {
  const el = $(id);
  if (el.textContent !== v) el.textContent = v;
};
/* 描くための角度: 各部品の回転数に、選んだ速さ（実際の速さ・1/4・1/20）を掛けて積み上げる */
const va: Snap['ang'] = { e: 0, d: 0, m: 0, c: 0, w: 0, M3: 0, M4: 0, C1: 0, C2: 0, ch: 0 };
function visual(f: Snap, dt: number): Snap {
  const k = (dt * S.slow) / RPM;
  va.e += f.rpm * k;
  va.d += f.drpm * k;
  va.m += f.mrpm * k;
  va.c += f.crpm * k;
  va.w += f.wrpm * k;
  va.M3 += ((f.crpm * 23) / 20) * k;
  va.M4 += ((f.crpm * 24) / 26) * k;
  va.C1 += ((f.mrpm * 14) / 35) * k;
  va.C2 += ((f.mrpm * 20) / 31) * k;
  va.ch += f.v * dt * S.slow;
  return { ...f, ang: { ...va } };
}
/* ペダルとギアの音: 踏み始め・ギアが噛み合う瞬間・ペダルが戻りきったとき。音を鳴らしている間だけ */
let lastDir = 0,
  lastPedV = 0,
  lastGear = -1;
function pedalSound(f: Snap): void {
  if (f.pedDir !== 0 && lastDir === 0) hit('press');
  if (lastGear >= 0 && f.gear !== lastGear) hit('gear');
  if (lastPedV > 0 && f.ped === 0) hit('release');
  lastDir = f.pedDir;
  lastPedV = f.ped;
  lastGear = f.gear;
}
function render(f: Snap): void {
  pedalSound(f);
  const o: View = { ...S.view, hl: S.hl };
  drawSection(cvSec, f, prevSnap, C, o);
  drawSide(cvSide, f, prevSnap, C, o);
  drawDrum(cvDrum, f, C, o);
  prevSnap = f;
  refreshTips();
  setAll('gear', f.gear ? String(f.gear) : 'N');
  setAll('kmh', (f.v * 3.6).toFixed(1));
  setAll('rpm', fmt(f.rpm));
  setText('#o-cf', cfLabel(f));
  setText('#o-mp', mpLabel(f));
  setText('#o-drpm', `${fmt(f.drpm)} rpm`);
  setText('#o-wrpm', `${fmt(f.wrpm)} rpm`);
  const thr = S.src === 'live' ? m.thr : f.thr;
  for (const pad of thrPads) {
    $('.thr-f', pad).style.width = `${(thr * 100).toFixed(1)}%`;
    pad.setAttribute('aria-valuenow', String(Math.round(thr * 100)));
  }
  for (const b of brkFs) b.style.width = `${((m.brake / 0.6) * 100).toFixed(1)}%`;
}
function showStage(sc: { rec: Rec; map: StageMap }, f: Snap): void {
  const i = f.stage ?? 0;
  setText('#tp-i', String(sc.rec.bounds.slice(0, i + 1).filter((b) => b != null).length));
  for (const b of $$<HTMLButtonElement>('button[data-i]', list))
    b.setAttribute('aria-current', String(Number(b.dataset.i) === i));
}
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sc = sceneOf(S.scene),
    { rec } = sc;
  if (S.src === 'live') {
    /* 変速の間（ペダルを踏んでいる間）はさらに 1/10 にして、ドグが入る様子を見せる */
    /* 加速・減速・変速は実際の速さで進め、速さの切り替え（S.slow）は回転の見え方だけに効かせる */
    let mt = S.paused ? 0 : dt;
    while (mt > 0) {
      const d = Math.min(DT, mt);
      if (S.auto) drv.step(d);
      m.step(d);
      mt -= d;
      histT += d;
      if (histT >= 0.01) {
        histT = 0;
        hist.push({ t: m.t, rpm: m.rpm, drpm: (m.wd * 60) / (2 * Math.PI), mrpm: (m.wm * 60) / (2 * Math.PI) });
        if (hist.length > 2500) hist.splice(0, hist.length - 2500);
      }
    }
    const f = visual(m.snap(), S.paused ? 0 : dt);
    render(f);
    sound(f, Math.max(m.thr, 0));
    drawGraph(cvGraph, hist, C, { span: 20 });
    setText('#tm-src', '表示中: 運転');
    setText('#tm-scnaux', '');
    showStage(sc, frameAt(rec, S.pt));
  } else {
    if (S.play) {
      S.pt += dt * S.prate;
      if (S.pt >= rec.dur) {
        S.pt = rec.dur;
        S.play = false;
        S.endT = now;
      }
    } else if (S.endT && now - S.endT > 1600 && S.pt >= rec.dur) {
      S.pt = 0;
      S.play = true;
      S.endT = 0;
    }
    const f = frameAt(rec, S.pt);
    render(f);
    sound(f, f.thr);
    drawGraph(cvGraph, rec.frames, C, { t0: 0, t1: rec.dur, cursor: S.pt, bounds: rec.bounds });
    showStage(sc, f);
    setText('#tm-src', `表示中: 場面「${rec.name}」`);
    setText('#tm-scnaux', `${rec.name}の再生中`);
  }
  /* 再生の操作 */
  const u = uOf(sc, S.pt),
    pc = `${(u * 100).toFixed(2)}%`;
  $('#tp-fill').style.width = pc;
  $('#tp-th').style.left = pc;
  trk.setAttribute('aria-valuenow', String(Math.round(u * 100)));
  setText('#tp-t', `${fmt(S.pt * 1000)} / ${fmt(rec.dur * 1000)} ms`);
  const playing = S.src === 'scene' && (S.play || S.endT > 0);
  pp.classList.toggle('on', playing);
  const l = playing ? '一時停止' : '再生';
  if (pp.title !== l) {
    pp.title = l;
    pp.setAttribute('aria-label', l);
  }
  requestAnimationFrame(frame);
}

/* ---------- 一時停止 ---------- */
const pauseBtn = $<HTMLButtonElement>('#tm-pause'),
  flPause = $<HTMLButtonElement>('#tm-fl-pause');
function setPause(on: boolean): void {
  S.paused = on;
  syncTg(pauseBtn, on);
  syncTg(flPause, on);
}
for (const b of [pauseBtn, flPause])
  b.addEventListener('click', () => {
    toLive();
    setPause(!S.paused);
  });
/* Space で運転の一時停止と再開。入力欄・ボタン・スライダーにいるときは使わない */
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input,select,textarea,button,summary,[role="slider"]')) return;
  e.preventDefault();
  toLive();
  setPause(!S.paused);
});

/* ---------- 音: エンジン音響モデルの音を、回転数を保つ運転で鳴らし、毎フレーム回転数とスロットルを送る ---------- */
const audio = new EngineAudio(),
  sndBtn = $<HTMLButtonElement>('#tm-snd'),
  sndT = $('#tm-sndT'),
  sndMsg = $('#tm-sndmsg');
const flSnd = $<HTMLButtonElement>('#tm-fl-snd');
function setSnd(on: boolean): void {
  S.snd = on;
  syncTg(sndBtn, on);
  syncTg(flSnd, on);
  sndT.textContent = on ? '停止' : '再生';
}
let sentRpm = -1,
  sentThr = -1;
function sound(f: Snap, thr: number): void {
  if (!S.snd) return;
  const rpm = Math.round(f.rpm),
    th = Math.round(thr * 100) / 100;
  if (rpm === sentRpm && th === sentThr) return;
  sentRpm = rpm;
  sentThr = th;
  audio.set({ rpm, throttle: th });
}
/* 効果音は別の小さな AudioContext で鳴らす（エンジンの音とは別の経路） */
type Ctor = typeof AudioContext;
const ACtor: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
let sfx: AudioContext | null = null,
  volDb = -10;
const bufs = new Map<SfxKind, AudioBuffer>();
function hit(kind: SfxKind): void {
  if (!S.snd || !sfx || sfx.state !== 'running') return;
  const ac = sfx;
  let buf = bufs.get(kind);
  if (!buf) {
    const y = makeSfx(kind, ac.sampleRate);
    buf = ac.createBuffer(1, y.length, ac.sampleRate);
    buf.getChannelData(0).set(y);
    bufs.set(kind, buf);
  }
  const src = ac.createBufferSource(),
    g = ac.createGain();
  src.buffer = buf;
  /* 録音のピークは −4 dBFS ほど。音量の 0 dB でその大きさにする */
  g.gain.value = 10 ** (volDb / 20) * 0.6;
  src.connect(g).connect(ac.destination);
  src.start();
}
async function toggleSnd(): Promise<void> {
  if (S.snd) {
    audio.stop();
    void sfx?.suspend();
    setSnd(false);
    return;
  }
  sndMsg.textContent = '';
  if (!(await audio.ready())) {
    sndMsg.textContent = 'このブラウザでは音を鳴らせません';
    return;
  }
  const f = S.src === 'live' ? m.snap() : null;
  audio.start('ja65', S.muf, { mode: 'hold', rpm: f ? f.rpm : 1400, throttle: m.thr });
  sentRpm = sentThr = -1;
  setSnd(true);
  if (ACtor) {
    sfx ??= new ACtor();
    void sfx.resume();
  }
}
sndBtn.addEventListener('click', toggleSnd);
flSnd.addEventListener('click', toggleSnd);
S.muf =
  (new Choice<string>($('#p-muf'), (v) => {
    S.muf = v === 'delta' ? 'delta' : 'stock';
    if (S.snd)
      audio.start(
        'ja65',
        S.muf,
        { mode: 'hold', rpm: sentRpm > 0 ? sentRpm : 1400, throttle: Math.max(0, sentThr) },
        true,
      );
  }).value as MufflerId) === 'delta'
    ? 'delta'
    : 'stock';
new ParamGroup<'vol'>([VOL], (v) => {
  volDb = v.vol;
  audio.vol(v.vol);
});
/* スマートフォンで画面が隠れたら音を止める（lib/pause.ts と同じ考え） */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld() && S.snd) {
    audio.stop();
    setSnd(false);
  }
});

const recolor = () => {
  C = readColors();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);

buildScene();
/* 前に場面の枠を開いたまま離れたときは、場面の表示で開く */
if (scnOpen()) toScene();
requestAnimationFrame(frame);

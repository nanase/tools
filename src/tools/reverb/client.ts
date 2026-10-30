/**
 * 残響のページの入口: 部屋（寸法・面の材料・音源と聞き手）→ 鏡像（図はメインスレッド、応答と指標は Worker）
 * → 上から見た部屋の波面と反射の経路・インパルス応答のグラフ・残響時間と指標 → 乾いた音に畳み込んで聞く
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { RoomAudio } from './audio';
import { DRY } from './dry';
import { type Images, images } from './image';
import { edc, fdnIR } from './ir';
import { HEIGHTS, type Key, ROOM, VOL } from './params';
import {
  type Acoustics,
  acoustics,
  BANDS,
  C0,
  clampIn,
  dist,
  FACE_NAMES,
  FACES,
  type Face,
  materialOf,
  NB,
  OPEN,
  PRESETS,
  presetOf,
  type Room,
  type Vec3,
} from './room';
import { drawIR, drawRoom, hits, type IrData, type IrView, type RoomView, roomAspect, watchTheme } from './view';
import type { DryJob, DryReply, Job, Reply } from './worker';

initToolPage();

const DASH = '—';
const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : DASH);
const ms = (t: number) => `${(t * 1000).toFixed(t < 0.1 ? 1 : 0)} ms`;
const minus = (s: string) => s.replace(/^-/, '−');

/** 図と指標の応答の標本化周波数 [Hz]（4 kHz の帯域まで足りる） */
const FS_VIEW = 16000;
/** 図で数える鏡像の数の上限 */
const N_VIEW = 6000;

/* ---------- 部屋 ---------- */
type Mut = { dim: Vec3; mat: Record<Face, string>; src: Vec3; rcv: Vec3 };
const copy = (r: Room): Mut => ({ dim: [...r.dim], mat: { ...r.mat }, src: [...r.src], rcv: [...r.rcv] });
let room: Mut = copy(presetOf('class').room);
let ac: Acoustics = acoustics(room);

/** 波面を動かす 1 周の長さ [s]: 閉じた部屋は平均自由行程の 5 倍、開いた空間は遠い壁まで往復 */
function tLoop(r: Room): number {
  const a = acoustics(r);
  if (a.closed) return Math.min(0.2, Math.max(0.035, (5 * a.mfp) / C0));
  return Math.min(0.6, (2 * Math.max(r.dim[0], r.dim[1])) / C0 + 0.03);
}
/** 応答の長さ [s]: 閉じた部屋は Eyring の残響時間の 1.25 倍（0.5〜4 s）、開いた空間は 1 周 + 0.15 s */
function durOf(r: Room): number {
  const a = acoustics(r);
  return a.closed ? Math.min(4, Math.max(0.5, 1.25 * Math.max(...a.eyr))) : Math.min(1.2, tLoop(r) + 0.15);
}
/** 応答のグラフの初めの幅 [s] */
const spanEarly = (t0: number, dur: number) => Math.min(dur, Math.max(0.12, t0 + 0.2));

/* ---------- 入力 ---------- */
const P = new ParamGroup<Key>(
  [...ROOM, ...HEIGHTS],
  (v, k) => {
    if (!k) return;
    if (k === 'W' || k === 'D' || k === 'H') {
      room.dim = [v.W, v.D, v.H];
      heightMax();
      room.src = clampIn([room.src[0], room.src[1], P.get('zs')], room.dim, 0.1);
      room.rcv = clampIn([room.rcv[0], room.rcv[1], P.get('zr')], room.dim, 0.1);
    } else if (k === 'zs') room.src = clampIn([room.src[0], room.src[1], v.zs], room.dim, 0.1);
    else if (k === 'zr') room.rcv = clampIn([room.rcv[0], room.rcv[1], v.zr], room.dim, 0.1);
    else return;
    changed();
  },
  null,
  { save: false },
);
const PV = new ParamGroup<Key>([VOL], () => {});
/** 高さの上限を天井の 0.1 m 下にする */
function heightMax(): void {
  const mx = Math.max(0.2, room.dim[2] - 0.1);
  for (const k of ['zs', 'zr'] as const) {
    P.update(k, { max: mx });
    if (P.get(k) > mx) P.set(k, mx, { silent: true });
  }
}

const presetCh = new Choice<string>($('#p-preset'), (v) => applyPreset(v));
const zoomCh = new Choice<string>($('#p-zoom'), () => draw());
const modeCh = new Choice<string>($('#p-mode'), () => syncMode());
const dryCh = new Choice<string>($('#p-dry'), (v) => {
  if (v === 'file' && !fileDry) pickFile();
  else prevDry = v;
});
let prevDry = dryCh.value === 'file' ? 'clap' : dryCh.value;
if (dryCh.value === 'file') dryCh.set('clap');

const sels = new Map(FACES.map((f) => [f, $<HTMLSelectElement>(`#m-${f}`)]));
for (const [f, el] of sels)
  el.addEventListener('change', () => {
    room.mat[f] = el.value;
    syncPreset();
    changed();
  });

function applyPreset(v: string): void {
  const p = PRESETS.find((x) => x.v === v);
  if (!p) return;
  room = copy(p.room);
  const vals: Record<Key, number> = {
    W: room.dim[0],
    D: room.dim[1],
    H: room.dim[2],
    zs: room.src[2],
    zr: room.rcv[2],
    vol: 0,
  };
  for (const k of ['W', 'D', 'H'] as const) P.update(k, { v: vals[k] });
  heightMax();
  for (const k of ['W', 'D', 'H', 'zs', 'zr'] as const) {
    if (k === 'zs' || k === 'zr') P.update(k, { v: vals[k] });
    P.set(k, vals[k], { silent: true });
  }
  for (const [f, el] of sels) el.value = room.mat[f];
  changed();
}
/** 今の部屋と同じ例を選んだ表示にする */
function syncPreset(): void {
  const same = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
  const p = PRESETS.find((x) => same(x.room.dim, room.dim) && FACES.every((f) => x.room.mat[f] === room.mat[f]));
  presetCh.set(p?.v ?? '');
}

/* ---------- 計算 ---------- */
let IMV: Images = images(room, { tMax: 0.1, nMax: N_VIEW });
let IR: (IrData & { r: Reply; dur: number }) | null = null;
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let jobId = 0,
  busy = false,
  dirty = false,
  /** 図の応答の要求の番号（古い返事は捨てる） */
  viewId = 0;
const waits = new Map<number, (r: Reply | DryReply) => void>();
worker.onmessage = (e: MessageEvent<Reply | DryReply>) => {
  const w = waits.get(e.data.id);
  waits.delete(e.data.id);
  w?.(e.data);
};
function ask<R extends Reply | DryReply>(j: Omit<Job, 'id'> | Omit<DryJob, 'id'>): Promise<R> {
  const id = ++jobId;
  return new Promise((res) => {
    waits.set(id, res as (r: Reply | DryReply) => void);
    worker.postMessage({ ...j, id });
  });
}

/** 部屋を変えたとき: 図の鏡像はすぐ、応答と指標は Worker で（計算中なら終わってから最新の部屋で 1 回） */
function changed(): void {
  ac = acoustics(room);
  const dur = durOf(room);
  IMV = images(room, {
    tMax: Math.min(dur, Math.max(tLoop(room), spanEarly(dist(room.src, room.rcv) / C0, dur))) + 0.01,
    nMax: N_VIEW,
  });
  audioIR = null;
  setAspect();
  info();
  if (busy) {
    dirty = true;
    return;
  }
  busy = true;
  const r: Room = { dim: [...room.dim], mat: { ...room.mat }, src: [...room.src], rcv: [...room.rcv] },
    id = ++viewId;
  void ask<Reply>({ room: r, o: { fs: FS_VIEW, dur } }).then((rep) => {
    busy = false;
    if (id === viewId)
      IR = {
        h: rep.h,
        fs: FS_VIEW,
        t0: rep.t0,
        e: edc(rep.h),
        echo: rep.ec.map((x) => x.dt),
        tMix: acoustics(r).closed ? acoustics(r).tMix : Number.NaN,
        r: rep,
        dur,
      };
    if (dirty) {
      dirty = false;
      changed();
    } else info();
  });
}

/* ---------- 図 ---------- */
const top = $<HTMLCanvasElement>('#rv-top'),
  irc = $<HTMLCanvasElement>('#rv-ir');
let rv: RoomView | null = null,
  iv: IrView | null = null;
const S = {
  t: 0,
  /** 応答のグラフで時刻を止めている間 */
  hold: false,
  /** 波面を動かす（動きを減らす設定なら止めて始める） */
  run: !RM.matches,
  pick: -1,
  hot: null as 'src' | 'rcv' | null,
  /** キーで動かす点 */
  key: 'rcv' as 'src' | 'rcv',
};
function setAspect(): void {
  const a = roomAspect(room).toFixed(3);
  if (top.dataset.ar !== a) top.dataset.ar = a;
}

function draw(): void {
  rv = drawRoom(top, { room, im: IMV, t: S.t, glow: 0.18 * tLoop(room), pick: S.pick, hot: S.hot });
  const T = IR ? (zoomCh.value === 'all' ? IR.h.length / IR.fs : earlyT(IR)) : 0.1;
  iv = drawIR(irc, IR, { T, t: S.t, pick: S.pick >= 0 ? IMV.t[S.pick] : null });
  status();
}

/** 初めの幅: エコーがあれば、その後ろまで */
const earlyT = (d: IrData & { dur: number }) =>
  Math.min(d.h.length / d.fs, Math.max(spanEarly(d.t0, d.dur), d.echo.length ? d.t0 + d.echo[0] + 0.04 : 0));

function status(): void {
  const lp = tLoop(room),
    slow = S.run ? Math.round(4 / lp) : 0;
  txt('#s-t', ms(S.t));
  txt('#s-spd', slow ? `1/${slow}` : '止めています');
  const pk = $('#s-pick');
  if (S.pick >= 0 && S.pick < IMV.n) {
    const i = S.pick,
      a = IMV.amp[i * NB + 2] / IMV.amp[2],
      faces = hits(IMV, i)
        .map(([f, n]) => `${FACE_NAMES[f]}${n > 1 ? ` ${n}` : ''}`)
        .join('・');
    html(
      '#s-pick-v',
      `${IMV.order[i]} 回 <span>${faces}</span> ${ms(IMV.t[i])} ${minus((20 * Math.log10(a)).toFixed(1))} dB`,
    );
    pk.hidden = false;
  } else pk.hidden = true;
}

/** 計算結果の表示 */
function info(): void {
  const d = dist(room.src, room.rcv);
  txt('#s-t0', ms(d / C0));
  txt('#s-n', IR ? String(IR.r.it.length) : DASH);
  txt('#s-mix', ac.closed ? ms(ac.tMix) : '開いた空間');
  const p = IR?.r.p,
    ec = IR?.r.ec ?? [];
  txt('#o-rt', ac.closed ? f2(ac.eyr[2]) : DASH);
  txt('#o-rts', ac.closed ? `Sabine ${f2(ac.sab[2])} s` : '開いた空間');
  /* 開いた空間の応答は指数で減衰しないので、残響時間は出さない */
  txt('#o-t30', p && ac.closed ? f2(p.t30[2]) : DASH);
  txt('#o-edt', p && ac.closed ? f2(p.edt[2]) : DASH);
  txt('#o-c80', p ? minus(p.c80[3].toFixed(1)) : DASH);
  txt('#o-d50', p ? String(Math.round(p.d50[3] * 100)) : DASH);
  txt('#o-r', d.toFixed(1));
  txt('#o-rc', ac.closed ? ac.rc[2].toFixed(1) : '∞');
  txt('#o-v', ac.closed ? String(Math.round(ac.V)) : DASH);
  txt('#o-mfp', ac.closed ? ac.mfp.toFixed(1) : DASH);
  const echo = ec.length ? ms(ec[0].dt) : 'なし';
  txt('#o-echo', echo);
  $('#o-echo').classList.toggle('bad', ec.length > 0);
  /* 帯域ごとの表 */
  const row = (name: string, v: readonly number[] | undefined, ok = true) =>
    `<tr><th>${name}</th>${BANDS.map((_, b) => `<td class="num">${ok && v ? f2(v[b]) : DASH}</td>`).join('')}</tr>`;
  html(
    '#o-bands',
    row('Sabine', ac.sab, ac.closed) +
      row('Eyring', ac.eyr, ac.closed) +
      row('T30（応答）', p?.t30, ac.closed) +
      row('EDT（応答）', p?.edt, ac.closed) +
      row(
        '吸音率の平均',
        ac.aMean.map((x) => x),
      ),
  );
  /* 面の材料の 500 Hz の吸音率 */
  for (const f of FACES) txt(`#a-${f}`, room.mat[f] === OPEN ? '開放' : materialOf(room.mat[f]).a[2].toFixed(2));
  /* 上の帯 */
  txt('#mt', ac.closed ? `${f2(ac.eyr[2])} s` : DASH);
  txt('#mc', p ? `${minus(p.c80[3].toFixed(1))} dB` : DASH);
  txt('#me', echo);
  syncMode();
}

/* ---------- 動き ---------- */
let last = performance.now(),
  seen = true;
new IntersectionObserver((es) => {
  seen = es.some((e) => e.isIntersecting);
}).observe($('.tgrid'));
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000),
    lp = tLoop(room);
  last = now;
  if (!S.hold && S.run) S.t = (S.t + (dt * lp) / 4) % lp;
  if (seen) draw();
  requestAnimationFrame(frame);
}
/** 動きを止める・再び動かす（止めても、なぞる・ドラッグはそのまま使える） */
function setRun(on: boolean): void {
  S.run = on;
  $('#runBtn').setAttribute('aria-pressed', String(on));
  $('#runLed').classList.toggle('on', on);
  txt('#runT', on ? 'RUN' : 'STOP');
}
$('#runBtn').addEventListener('click', () => setRun(!S.run));
watchTheme(draw);
addEventListener('resize', draw);

/* ---------- 音源と聞き手を動かす ---------- */
const near = (px: number, py: number, rad: number): 'src' | 'rcv' | null => {
  if (!rv) return null;
  let best: 'src' | 'rcv' | null = null,
    bd = rad;
  for (const k of ['rcv', 'src'] as const) {
    const d = Math.hypot(rv.X(room[k][0]) - px, rv.Y(room[k][1]) - py);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
};
const cpos = (cv: HTMLCanvasElement, x: number, y: number): [number, number] => {
  const r = cv.getBoundingClientRect(),
    k = cv.width / r.width;
  return [(x - r.left) * k, (y - r.top) * k];
};
let drag: 'src' | 'rcv' | null = null;
/* 点の上で触れたときだけ、ページのスクロールを止める */
top.addEventListener(
  'touchstart',
  (e) => {
    const t = e.touches[0],
      [x, y] = cpos(top, t.clientX, t.clientY);
    if (near(x, y, 30 * (top.width / top.clientWidth))) e.preventDefault();
  },
  { passive: false },
);
top.addEventListener('pointerdown', (e) => {
  const [x, y] = cpos(top, e.clientX, e.clientY),
    k = near(x, y, (e.pointerType === 'touch' ? 30 : 20) * (top.width / top.clientWidth));
  if (!k) return;
  drag = k;
  S.hot = k;
  S.key = k;
  top.setPointerCapture(e.pointerId);
  e.preventDefault();
});
top.addEventListener('pointermove', (e) => {
  if (!rv) return;
  const [x, y] = cpos(top, e.clientX, e.clientY);
  if (!drag) {
    top.style.cursor = near(x, y, 20 * (top.width / top.clientWidth)) ? 'grab' : '';
    return;
  }
  top.style.cursor = 'grabbing';
  moveTo(drag, rv.ix(x), rv.iy(y));
});
const up = () => {
  if (!drag) return;
  drag = null;
  S.hot = null;
  top.style.cursor = '';
};
top.addEventListener('pointerup', up);
top.addEventListener('pointercancel', up);
function moveTo(k: 'src' | 'rcv', x: number, y: number): void {
  room[k] = clampIn([x, y, room[k][2]], room.dim, 0.1);
  S.pick = -1;
  changed();
}
/* キー: 矢印で動かす（Shift で 1 m）、Enter・スペースで音源と聞き手を切り替える */
top.addEventListener('keydown', (e) => {
  const st = e.shiftKey ? 1 : 0.1,
    d: Record<string, [number, number]> = {
      ArrowLeft: [-st, 0],
      ArrowRight: [st, 0],
      ArrowUp: [0, st],
      ArrowDown: [0, -st],
    };
  if (e.key === 'Enter' || e.key === ' ') {
    S.key = S.key === 'rcv' ? 'src' : 'rcv';
    S.hot = S.key;
    txt('#rv-live', `${S.key === 'rcv' ? '聞き手' : '音源'}を動かします`);
  } else if (d[e.key]) {
    const p = room[S.key];
    S.hot = S.key;
    moveTo(S.key, p[0] + d[e.key][0], p[1] + d[e.key][1]);
  } else return;
  e.preventDefault();
});
top.addEventListener('blur', () => {
  S.hot = null;
});

/* ---------- 応答のグラフをなぞる: 時刻を止め、その時刻に届いた反射の経路を光らせる ---------- */
function scrub(x: number): void {
  if (!iv || !IR) return;
  const t = ((x - iv.L) / iv.pw) * iv.T;
  if (t < 0 || t > iv.T) return;
  S.hold = true;
  S.t = t;
  /* 近い時刻（±3 画素）に届く、いちばん強い反射 */
  const tol = (3 * (irc.width / irc.clientWidth) * iv.T) / iv.pw;
  let best = -1,
    ba = 0;
  for (let i = 1; i < IMV.n; i++) {
    if (IMV.t[i] < t - tol) continue;
    if (IMV.t[i] > t + tol) break;
    const a = IMV.amp[i * NB + 2];
    if (a > ba) {
      ba = a;
      best = i;
    }
  }
  S.pick = best;
  if (best >= 0) S.t = IMV.t[best];
  status();
}
const release = () => {
  S.hold = false;
  S.pick = -1;
};
irc.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' && !irc.hasPointerCapture(e.pointerId)) return;
  scrub(cpos(irc, e.clientX, e.clientY)[0]);
});
irc.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') irc.setPointerCapture(e.pointerId);
  scrub(cpos(irc, e.clientX, e.clientY)[0]);
});
irc.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') release();
});
irc.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') release();
});
irc.addEventListener('pointercancel', release);
/* キー: 左右で前後の反射へ、Esc で戻す */
irc.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') release();
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    let i = S.pick < 0 ? (dir > 0 ? 0 : IMV.n) : S.pick;
    for (i += dir; i > 0 && i < IMV.n && IMV.order[i] > 3; i += dir);
    if (i <= 0 || i >= IMV.n) return;
    S.hold = true;
    S.pick = i;
    S.t = IMV.t[i];
  } else return;
  e.preventDefault();
  status();
  txt('#rv-live', $('#s-pick').hidden ? '' : `反射 ${$('#s-pick-v').textContent}`);
});
irc.addEventListener('blur', release);

/* ---------- 聞く ---------- */
const audio = new RoomAudio(),
  playBtn = $('#playBtn');
let audioIR: { key: string; fs: number } | null = null,
  fileDry: { name: string; y: Float32Array; fs: number } | null = null,
  playing = 0;
const dryCache = new Map<string, Float32Array>();
const fileIn = $<HTMLInputElement>('#rv-file');

function pickFile(): void {
  fileIn.value = '';
  fileIn.click();
}
fileIn.addEventListener('cancel', () => {
  if (!fileDry) dryCh.set(prevDry);
});
fileIn.addEventListener('change', async () => {
  const f = fileIn.files?.[0];
  if (!f) {
    if (!fileDry) dryCh.set(prevDry);
    return;
  }
  try {
    const fs = audio.open(),
      y = await audio.decode(await f.arrayBuffer());
    /* 長すぎるファイルは初めの 30 秒 */
    fileDry = { name: f.name, y: y.length > 30 * fs ? y.slice(0, 30 * fs) : y, fs };
    prevDry = 'file';
    dryCh.set('file');
    $('#p-dry .chip[data-v="file"]').textContent =
      fileDry.name.length > 18 ? `${fileDry.name.slice(0, 17)}…` : fileDry.name;
    dryCh.note('');
  } catch {
    dryCh.set(prevDry);
    dryCh.note('この形式の音は読めませんでした', 'er');
  }
});
/* 選んでいるファイルのチップをもう一度押すと、選び直す */
$('#p-dry .chip[data-v="file"]').addEventListener('click', () => {
  if (fileDry && dryCh.value === 'file') pickFile();
});

async function dryOf(v: string, fs: number): Promise<Float32Array> {
  if (v === 'file' && fileDry) return fileDry.y;
  const key = `${v}@${fs}`,
    c = dryCache.get(key);
  if (c) return c;
  let y: Float32Array;
  if (v === 'guitar') y = (await ask<DryReply>({ dry: 'guitar', fs })).y;
  else y = (DRY.find((d) => d.v === v) ?? DRY[0]).make(fs);
  dryCache.set(key, y);
  return y;
}
const roomKey = (fs: number) => `${JSON.stringify(room)}@${fs}`;

async function play(): Promise<void> {
  const fs = audio.open(),
    mode = modeCh.value as 'room' | 'fdn' | 'dry',
    id = ++playing,
    r: Room = { dim: [...room.dim], mat: { ...room.mat }, src: [...room.src], rcv: [...room.rcv] },
    dur = durOf(r);
  setLed(true);
  const x = await dryOf(dryCh.value, fs);
  if (mode === 'room' && audioIR?.key !== roomKey(fs)) {
    const key = roomKey(fs),
      rep = await ask<Reply>({ room: r, o: { fs, dur } });
    if (id !== playing) return;
    audio.setIR([rep.h]);
    audioIR = { key, fs };
  } else if (mode === 'fdn') {
    audio.setIR(fdnIR(r, fs, dur));
    audioIR = null;
  }
  if (id !== playing) return;
  audio.play(x, mode, PV.get('vol'));
  const len = x.length / fs + (mode === 'dry' ? 0 : dur);
  setTimeout(() => {
    if (id === playing) setLed(false);
  }, 1000 * len);
}
function stop(): void {
  playing++;
  audio.stop();
  setLed(false);
}
function setLed(on: boolean): void {
  playBtn.setAttribute('aria-pressed', String(on));
  $('#playLed').classList.toggle('on', on);
}
playBtn.addEventListener('click', () => void play());
autoPause(audio, { pause: stop, hidden: () => {} });
function syncMode(): void {
  /* 楽器ページの残響は閉じた部屋だけ */
  modeCh.note(modeCh.value === 'fdn' && !ac.closed ? '開いた空間では残響がなく、直接音だけになります' : '');
}

/* ---------- 始める ---------- */
for (const [f, el] of sels) el.value = room.mat[f];
heightMax();
changed();
setRun(S.run);
if (!S.run) S.t = 0.45 * tLoop(room);
requestAnimationFrame(frame);

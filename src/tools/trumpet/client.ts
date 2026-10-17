/**
 * トランペット音響モデルのページの入口: ピストン・倍音・吹き方・楽器・部屋の入力 → 奏者と楽器（AudioWorklet）→
 * 図（気柱・ピストン・唇とマウスピースの断面・倍音のはしご）・管の共鳴・音の波形・計算結果・音。
 * 「吹く」（スペースキー）を押している間だけ吹き、ピストン（J・K・L）と倍音（↑↓）で音を選ぶ。曲は worklet が演奏する
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, fmtR, minus, plain, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { Pauser } from '../../lib/pause';
import { movePlayStore, outVol, type PlayKey, TEMPO } from '../../lib/play';
import { acoustics, reverbSpec, roomOf } from '../../lib/reverb';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { specPlot, wavePlot } from '../guitar/plot';
import { spectra } from '../spectrum/fft';
import { type Frame, TrumpetAudio } from './audio';
import { VALVE_LEN } from './bore';
import { CALIB, RES_DEV } from './calib';
import { type Cycle, type FigMode, TrumpetFigure } from './figure';
import { SCOPE_N } from './frame';
import { FINGERS, mtof, nameOf, openNote, semiOf } from './notes';
import { type BlowKey, DIST, DYNS, dynOf, FLIP, PM, TEMP, VOL0 } from './params';
import { type Expr, type Performance, performPiece } from './perform';
import { control, type Manual } from './player';
import { fAtX, LX, mouthpieceResonance, zAxes, zCurve, zEffOf, zPath, zY } from './plot';
import { type PieceData, pieceOf } from './score';
import { loadScore } from './scores/load';
import { airPoints } from './side';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};

/* ---------- 入力 ---------- */
let started = false;
const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
const audio = new TrumpetAudio();
const NO_SOUND = '音を出せませんでした';
const PAUSED = '一時停止の間は吹けません';
const sndMsg = (s: string) => txt('#snd-msg', s);

const nv = choice<FigMode>('nv', (v) => {
  fig.mode = v;
  figBar();
});
const names = choice<'con' | 'wri'>('names', () => {
  ladderNames();
  zDirty = true;
});
const sl = choice<string>('sl', (v) => {
  fig.slow = Number(v);
  figBar();
});
const lipMode = choice<'auto' | 'man'>('lip', () => {
  blowRows();
  sendManual();
});
const dyn = choice<string>('dyn', () => sendManual());
const PB = new ParamGroup<BlowKey>([PM, FLIP], () => {
  if (started) sendManual();
});
const tg = choice<'ta' | 'da' | 'slur'>('tg', () => sendManual());
const vib = choice<string>('vib', (v) => audio.setOpts({ vib: v === '1' }));
const nl = choice<string>('nl', (v) => audio.setOpts({ brass: Number(v) }));
const corr = choice<'slide' | 'none'>('corr', () => {
  audio.setOpts({ slides: corr.value === 'slide' });
  zDirty = true;
});
const PT = new ParamGroup<'temp'>([TEMP], (v) => {
  if (!started) return;
  audio.setOpts({ temp: v.temp });
  zDirty = true;
  instMetrics();
});
const noise = choice<string>('noise', (v) => audio.setOpts({ noise: Number(v) }));
const dir = choice<'front' | 'side'>('dir', (v) => audio.setOpts({ onAxis: v === 'front' }));
const zs = choice<'lin' | 'db'>('zs', () => (zDirty = true));
const room = choice<string>('room', () => roomView());
const PR = new ParamGroup<'dist'>([DIST], () => {
  if (started) roomView();
});
const expr = choice<Expr>('expr', () => retempo());
const ov = choice<'yt' | 'sp'>('ov', () => showOut());
const span = choice<string>('span', () => drawOut());
const fmax = choice<string>('fmax', () => drawOut());
let tempo = 1;
movePlayStore();
new ParamGroup<PlayKey>([TEMPO, outVol(VOL0)], (v, k) => {
  tempo = v.tempo / 100;
  audio.vol(v.vol);
  if (started && k === 'tempo') retempo();
});

/* ---------- 図 ---------- */
const fig = new TrumpetFigure();
fig.mode = nv.value;
fig.slow = Number(sl.value);
function figBar(): void {
  const amp = nv.value === 'amp';
  txt('#f-mode', amp ? '定在波の腹と節' : `スロー 1/${sl.value}`);
  txt('#f-keyt', amp ? '気柱の圧力の振れ幅' : '気柱の圧力');
  $('#f-key').classList.toggle('amp', amp);
  txt('#mp-slow', `スロー 1/${sl.value}`);
}
const nm = (m: number) => nameOf(names.value === 'wri' ? m + 2 : m);
const vName = (v: readonly boolean[]) => {
  const s = [v[0] ? '1' : '', v[1] ? '2' : '', v[2] ? '3' : ''].filter(Boolean);
  return s.length ? s.join('+') : 'ピストンなし';
};

/* ---------- 手で吹く: ピストン・倍音・吹く ---------- */
const M = { v: [false, false, false] as [boolean, boolean, boolean], n: 4, blow: false };
let blowTimer: ReturnType<typeof setTimeout> | undefined;
/** 鳴らす音（ピストンと倍音から） */
const manualNote = () => openNote(M.n) - semiOf(M.v);
function blowRows(): void {
  const man = lipMode.value === 'man';
  PB.setOff('pm', !man, man ? '' : '自動の間は、強弱と音から決まる値');
  PB.setOff('fl', !man, man ? '' : '自動の間は、鳴らす音に合わせた値');
  dyn.setOff(man, man ? '手動の間は使わない' : '');
}
function sendManual(): void {
  if (!started) return;
  const man = lipMode.value === 'man',
    m: Manual = {
      v: [...M.v],
      n: M.n,
      blow: M.blow,
      d: dynOf(dyn.value),
      auto: !man,
      fl: PB.get('fl'),
      pm: man ? PB.get('pm') * 1000 : 0,
      tongue: tg.value,
    };
  audio.manual(m);
  keysView();
}
async function blow(on: boolean): Promise<void> {
  clearTimeout(blowTimer);
  if (on === M.blow) return;
  if (on) {
    if (pauser.paused) {
      sndMsg(PAUSED);
      return;
    }
    if (P) stopPiece();
    const ok = await audio.ready();
    if (!ok) {
      sndMsg(NO_SOUND);
      return;
    }
    sndMsg('');
  }
  M.blow = on;
  $('#blowBtn').setAttribute('aria-pressed', String(on));
  sendManual();
}
function setValve(i: number, on: boolean): void {
  if (M.v[i] === on) return;
  M.v[i] = on;
  if (P) stopPiece();
  sendManual();
}
function setPartial(n: number): void {
  M.n = Math.max(2, Math.min(10, n));
  for (const b of $('#parts').querySelectorAll<HTMLButtonElement>('button'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.n) === M.n));
  sendManual();
}
function keysView(): void {
  for (let i = 0; i < 3; i++) $(`#vk-${i}`).setAttribute('aria-pressed', String(M.v[i]));
}
for (let i = 0; i < 3; i++) {
  $(`#vk-${i}`).addEventListener('click', () => setValve(i, !M.v[i]));
  $(`#k-${i}`).addEventListener('click', () => setValve(i, !M.v[i]));
}
for (const b of $('#parts').querySelectorAll<HTMLButtonElement>('button'))
  b.addEventListener('click', () => setPartial(Number(b.dataset.n)));
{
  const bb = $('#blowBtn');
  bb.addEventListener('pointerdown', (e) => {
    bb.setPointerCapture(e.pointerId);
    void blow(true);
  });
  const up = () => void blow(false);
  bb.addEventListener('pointerup', up);
  bb.addEventListener('pointercancel', up);
  bb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void blow(true);
  });
  bb.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') up();
  });
}
/* キーボード: スペースで吹く、J・K・L でピストン、↑↓ で倍音（入力欄にいるときは使わない） */
const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};
const KEYS: Record<string, number> = { j: 0, k: 1, l: 2 };
window.addEventListener('keydown', (e) => {
  if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === ' ' && !(e.target as HTMLElement).closest('button')) {
    e.preventDefault();
    if (!e.repeat) void blow(true);
  } else if (k in KEYS) {
    if (!e.repeat) setValve(KEYS[k], true);
  } else if (k === 'arrowup' || k === 'arrowdown') {
    if ((e.target as HTMLElement).closest('.sc,.seg,.chips')) return;
    e.preventDefault();
    const ns = [2, 3, 4, 5, 6, 7, 8],
      i = ns.indexOf(M.n);
    setPartial(ns[Math.max(0, Math.min(ns.length - 1, i + (k === 'arrowup' ? 1 : -1)))]);
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ') void blow(false);
  else if (k in KEYS) setValve(KEYS[k], false);
});
window.addEventListener('blur', () => {
  void blow(false);
  for (let i = 0; i < 3; i++) setValve(i, false);
});

/* ---------- 倍音のはしご ---------- */
const cells = [...$('#ladder').querySelectorAll<HTMLButtonElement>('.cell')];
function ladderNames(): void {
  for (const c of cells) {
    const n = Number(c.dataset.n),
      f = Number(c.dataset.f),
      g = FINGERS[f],
      m = openNote(n) - g.semi,
      dv = RES_DEV[f]?.[n - 2] ?? 0,
      std = n !== 7 && openNote(n) - m === g.semi && fingeringIs(m, n, g.semi);
    (c.querySelector('.nm') as HTMLElement).textContent = nm(m);
    (c.querySelector('.dv') as HTMLElement).textContent = `${dv > 0 ? '+' : dv < 0 ? '−' : '±'}${Math.abs(dv)}c`;
    c.className = `cell${n === 7 ? ' skip' : std ? ' std' : ' alt'}${dv < -10 ? ' flat' : dv > 10 ? ' sharp' : ''}`;
    c.title = `${nm(m)}（第 ${n} 倍音・${g.name}）${n === 7 ? '。第 7 倍音は低すぎるのでふつう使わない' : std ? '。ふつうの指使い' : '。替え指'}`;
  }
}
/** ふつうの指使いか（notes.ts の fingering と同じ選び方） */
function fingeringIs(m: number, n: number, semi: number): boolean {
  for (const k of [2, 3, 4, 5, 6, 8, 9, 10]) {
    const s = openNote(k) - m;
    if (s >= 0 && s <= 6) return k === n && s === semi;
  }
  return false;
}
for (const c of cells)
  c.addEventListener('click', async () => {
    const g = FINGERS[Number(c.dataset.f)];
    M.v = [...g.v];
    setPartial(Number(c.dataset.n));
    /* 押した音を 0.8 秒吹く（吹いている間は音だけ変える） */
    if (!M.blow) {
      await blow(true);
      blowTimer = setTimeout(() => void blow(false), 800);
    }
  });
function ladderOn(v: readonly boolean[], n: number): void {
  const f = semiOf(v);
  const fi = FINGERS.findIndex((g) => g.v.every((x, i) => x === v[i]));
  for (const c of cells)
    c.setAttribute('aria-pressed', String(Number(c.dataset.n) === n && Number(c.dataset.f) === (fi >= 0 ? fi : f)));
  for (const c of cells) c.classList.toggle('on', c.getAttribute('aria-pressed') === 'true');
}

/* ---------- 楽器の数値 ---------- */
const POP = mouthpieceResonance();
function slideOf(v: readonly boolean[]): number {
  if (corr.value !== 'slide') return 0;
  const [a, b, c] = v;
  return c ? (a && b ? 0.056 : a ? 0.031 : b ? 0.015 : 0) : a && b ? 0.016 : 0;
}
function instMetrics(v: readonly boolean[] = curV): void {
  const len = 1.4004 + v.reduce((s, on, i) => s + (on ? VALVE_LEN[i] : 0), 0) + slideOf(v);
  html('#i-len', ro(len, 'm', 3));
  const c = zCurve(v, slideOf(v), PT.get('temp'));
  html('#i-f2', c.peaks[1] ? ro(c.peaks[1].f, 'Hz', 4) : '—');
  html('#i-pop', ro(POP, 'Hz', 3));
  html('#i-z', ro(zEffOf(v), 'm', 3));
  txt('#f-len', `空気が通る長さ ${fmt(len, 'm', 3)}（${vName(v)}）`);
}

/* ---------- 管の共鳴 ---------- */
let zDirty = true,
  zKey = '';
function zDraw(v: readonly boolean[], n: number, f0: number, fl: number): void {
  const db = zs.value === 'db',
    key = `${v.map(Number).join('')}/${n}/${Math.round(f0)}/${Math.round(fl)}/${db}/${corr.value}/${PT.get('temp')}`;
  if (!zDirty && key === zKey) return;
  zDirty = false;
  zKey = key;
  const c = zCurve(v, slideOf(v), PT.get('temp'));
  $('#z-curve').setAttribute('d', zPath(c, db));
  html(
    '#z-lbl',
    c.peaks
      .slice(0, 10)
      .map(
        (p, i) =>
          `<text class="zn" x="${LX(p.f).toFixed(1)}" y="${Math.max(10, zY(p.z, db) - 6).toFixed(1)}" text-anchor="middle">${i + 1}</text>`,
      )
      .join(''),
  );
  html('#z-axes', zAxes(db));
  txt('#z-div', db ? '10 dB' : '20 MPa·s/m³');
  txt('#z-aux', `${vName(v)} の管を、カップの縁から見た値（管の中の温度 ${PT.get('temp')} °C）`);
  let h1 = '',
    hn = '';
  if (f0 > 0) {
    h1 = `M${LX(f0).toFixed(1)} 0V240`;
    for (let k = 2; k * f0 < 2000; k++) hn += `M${LX(k * f0).toFixed(1)} 0V240`;
  }
  $('#z-h1').setAttribute('d', h1 || 'M0 0');
  $('#z-hn').setAttribute('d', hn || 'M0 0');
  if (fl > 0) {
    const x = LX(fl),
      w = LX(fl * 1.06) - LX(fl / 1.06);
    $('#z-lip').setAttribute('d', `M${x.toFixed(1)} 0V240`);
    const b = $('#z-lipb');
    b.setAttribute('x', (x - w / 2).toFixed(1));
    b.setAttribute('width', w.toFixed(1));
    $('#z-lipt').setAttribute('x', x.toFixed(1));
  }
  const pk = c.peaks[n - 1];
  txt(
    '#z-rd',
    pk
      ? `第 ${n} 共鳴 ${fmt(pk.f, 'Hz', 4)}  ${(pk.z / 1e6).toFixed(0)} MPa·s/m³  Q ${pk.q.toFixed(0)}${f0 > 0 ? `  鳴る音 ${fmt(f0, 'Hz', 4)}` : ''}`
      : '',
  );
}
void fAtX;

/* ---------- 残響（部屋。再生の音だけに付ける） ---------- */
function roomView(): void {
  const r = roomOf(room.value),
    off = r.v === 'off',
    a = acoustics(r),
    dist = PR.get('dist');
  html('#r-t', off ? '—' : ro(a.t60, 's', 3));
  html('#r-th', off ? '—' : ro(a.t60Hi, 's', 3));
  html('#r-rc', off ? '—' : ro(a.rc, 'm', 3));
  html('#r-dr', off ? '—' : `${minus((20 * Math.log10(dist / a.rc)).toFixed(1))}<span class="u">dB</span>`);
  audio.setRoom(reverbSpec(r, dist));
}

/* ---------- 音の波形 ---------- */
let wave: Float32Array | null = null,
  waveFs = 48000,
  spec = new Float32Array(SCOPE_N / 2 + 1);
const waveBox = $<HTMLDetailsElement>('details.a-wave');
waveBox.addEventListener('toggle', () => audio.scope(waveBox.open));
audio.onWave = (y, fs) => {
  wave = y;
  waveFs = fs;
  const px = new Float32Array(SCOPE_N / 2 + 1);
  spectra(y, y, SCOPE_N, 'bh', px, new Float32Array(SCOPE_N / 2 + 1));
  spec = px;
  drawOut();
};
function showOut(): void {
  $('#v-yt').hidden = ov.value !== 'yt';
  $('#v-sp').hidden = ov.value !== 'sp';
  drawOut();
}
function drawOut(): void {
  const y = wave;
  if (!y) return;
  if (ov.value === 'yt') {
    const sp = Number(span.value),
      n = Math.min(y.length, Math.round(sp * waveFs)),
      seg = y.subarray(y.length - n),
      w = wavePlot(seg, waveFs, sp);
    $('#w-t1').setAttribute('d', w.d);
    html('#w-axes', w.axes);
    txt('#w-vd', `${plain(w.vd, 3)} Pa`);
    txt('#w-hd', fmt(w.hd, 's', 3));
    let pk = 0;
    for (const v of seg) pk = Math.max(pk, Math.abs(v));
    txt('#w-st', `PEAK ${fmtR(pk, 'Pa', 3)}`);
  } else {
    const fm = Number(fmax.value),
      s = specPlot(spec, waveFs, SCOPE_N, fm);
    $('#s-t1').setAttribute('d', s.d);
    html('#s-axes', s.axes);
    txt('#s-x', `0–${fmt(fm, 'Hz', 3)}`);
  }
}

/* ---------- 曲の演奏 ---------- */
let P: { v: string; data: PieceData; perf: Performance; bars: number } | null = null;
const piece = $<HTMLSelectElement>('#piece');
const pauser = new Pauser(audio, {
  playing: () => !!P,
  changed: syncPlay,
  failed: () => sndMsg(NO_SOUND),
  hidden: () => {},
});
{
  const v = stored('c:p-piece');
  if (typeof v === 'string' && [...piece.options].some((o) => o.value === v)) piece.value = v;
}
piece.addEventListener('change', () => {
  store('c:p-piece', piece.value);
  if (P) stopPiece();
});
let plBar = '';
function showBar(s = plBar): void {
  plBar = s;
  txt('#pl-bar', pauser.paused ? `${s}（一時停止中）` : s);
}
function syncPlay(): void {
  $('#playBtn').setAttribute('aria-pressed', String(!!P));
  $('#playLed').classList.toggle('on', !!P);
  txt('#playT', P ? '停止' : '演奏');
  $<HTMLButtonElement>('#pauseBtn').disabled = !P;
  txt('#pauseBtn', pauser.paused ? '再開' : '一時停止');
  showBar();
  if (!pauser.paused && $('#snd-msg').textContent === PAUSED) sndMsg('');
}
async function startPiece(): Promise<void> {
  const ok = await audio.ready();
  if (!ok) {
    sndMsg(NO_SOUND);
    return;
  }
  sndMsg('');
  const pc = pieceOf(piece.value);
  let data: PieceData;
  try {
    data = await loadScore(pc.file);
  } catch {
    sndMsg('曲のデータを読めませんでした');
    return;
  }
  if (P || piece.value !== pc.v) return;
  M.blow = false;
  const perf = performPiece(pc, data, tempo, expr.value);
  P = { v: pc.v, data, perf, bars: data.bars.length + 1 };
  audio.playPiece(perf.notes, 0);
  syncPlay();
}
function stopPiece(): void {
  if (!P) return;
  P = null;
  audio.resetIfPaused();
  pauser.clear();
  audio.stopPiece();
  showBar('');
  syncPlay();
}
/** テンポと表情を変えたら、いまの拍から演奏し直す */
function retempo(): void {
  if (!P || !last) return;
  const pc = pieceOf(P.v),
    beat = P.perf.beatAt(last.time),
    perf = performPiece(pc, P.data, tempo, expr.value);
  P.perf = perf;
  audio.playPiece(perf.notes, perf.secAt(beat));
}
$('#playBtn').addEventListener('click', () => {
  if (P) stopPiece();
  else void startPiece();
});
$('#pauseBtn').addEventListener('click', () => void (pauser.paused ? pauser.resume() : pauser.pause()));
$('#muteBtn').addEventListener('click', () => {
  if (P) {
    P = null;
    pauser.clear();
    showBar('');
  }
  M.blow = false;
  audio.resetIfPaused();
  audio.mute();
  syncPlay();
});
audio.onDone = () => {
  if (!P) return;
  P = null;
  showBar('');
  syncPlay();
};

/* ---------- 毎フレーム ---------- */
let last: Frame | null = null;
audio.onFrame = (f) => {
  last = f;
};
let curV: boolean[] = [false, false, false];
let lastRes = 0;
function tick(now: number): void {
  const f = last,
    sounding = !!f && f.f0 > 0 && f.rms > 1e-3,
    press = f ? f.press : M.v.map(Number),
    v = press.map((x) => x > 0.5),
    m = f && f.m >= 0 ? f.m : manualNote(),
    n = P && f && f.m >= 0 ? partialOf(m, v) : M.n,
    cyc: Cycle | null = f ? { h: f.h, p: f.p, u: f.u, air: f.air, f0: sounding ? f.f0 : 0, pm: f.pm } : null;
  curV = v;
  fig.keys(press);
  /* 唇の断面と、スローの気柱は、受け取った 1 周期をスローの速さで繰り返す */
  const k = cyc && sounding ? fig.phaseOf(cyc, now / 1000) : 0;
  fig.air(sounding ? cyc : null, k, press);
  fig.lips(cyc, k);
  txt('#f-amp', `${nv.value === 'amp' ? '' : '±'}${(fig.scale / 1000).toFixed(1)} kPa`);
  const g = FINGERS.find((x) => x.v.every((y, i) => y === v[i])),
    vn = g ? g.name : vName(v);
  txt('#f-note', `${nameOf(m)}（記譜 ${nameOf(m + 2)}）· 第 ${n} 倍音 · ${vn}`);
  txt('#f-big', `${nm(m)}  ${(sounding && f ? f.f0 : mtof(m)).toFixed(1)} Hz`);
  txt('#f-sub', `第 ${n} 倍音 · ${vn} · ${names.value === 'wri' ? `実音 ${nameOf(m)}` : `記譜 ${nameOf(m + 2)}`}`);
  const pmV = f ? f.pm : 0,
    flV = f ? f.fl : 0;
  txt('#f-sub2', `口の圧力 ${(pmV / 1000).toFixed(1)} kPa · 唇の共振 ${flV.toFixed(0)} Hz`);
  /* 唇の断面の数値 */
  txt('#mp-pm', `口の中 pm ${(pmV / 1000).toFixed(1)} kPa`);
  if (cyc && sounding) {
    txt('#mp-p', `カップの圧力 p ${(cyc.p[k] / 1000).toFixed(1)} kPa`);
    txt('#mp-u', `流量 U ${(cyc.u[k] * 1000).toFixed(2)} L/s`);
    txt('#mp-h', `唇の開き h ${Math.max(0, cyc.h[k] * 1000).toFixed(2)} mm`);
    const dh = cyc.h[(k + 1) % cyc.h.length] - cyc.h[(k + cyc.h.length - 1) % cyc.h.length];
    txt(
      '#mp-state',
      cyc.h[k] <= 0 ? '唇が閉じている' : dh > 0 ? '唇が開いていく（カップの側へ）' : '唇が閉じていく（口の側へ）',
    );
  } else {
    txt('#mp-p', '');
    txt('#mp-u', '');
    txt('#mp-h', '');
    txt('#mp-state', '');
  }
  ladderOn(v, n);
  /* 自動の間は、口の圧力と唇の共振の行に今の値を出す */
  if (lipMode.value === 'auto' && f && pmV > 1 && now - lastRes > 150) {
    PB.set('pm', Math.round(pmV / 100) / 10, { silent: true });
    PB.set('fl', Math.round(flV), { silent: true });
  }
  zDraw(v, n, sounding && f ? f.f0 : 0, flV);
  if (now - lastRes > 200) {
    lastRes = now;
    results(f, cyc, sounding, m);
    instMetrics(v);
  }
  if (P && f) showBar(`${Math.min(P.bars, barOf(P, P.perf.beatAt(f.time)))} / ${P.bars} 小節`);
  requestAnimationFrame(tick);
}
/** 曲の音の倍音（ふつうの指使いから） */
function partialOf(m: number, v: readonly boolean[]): number {
  const s = semiOf(v);
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) if (openNote(n) - s === m) return n;
  return M.n;
}
/** 拍の小節の番号（1 から。小節線の数 + 1） */
function barOf(p: NonNullable<typeof P>, beat: number): number {
  let b = 0;
  while (b < p.data.bars.length && p.data.bars[b] <= beat + 1e-6) b++;
  return b + 1;
}
/** 長さ [m] を mm で（接頭辞を付けない） */
const mm = (x: number) => `${plain(x * 1000, 3, true)}<span class="u">mm</span>`;
function results(f: Frame | null, c: Cycle | null, sounding: boolean, m: number): void {
  html('#o-f0', sounding && f ? ro(f.f0, 'Hz', 4) : '—');
  /* 鳴っている音に最も近い平均律の音と、そこからのずれ（狙いの音と違えば、狙いも書く） */
  const near = sounding && f ? Math.round(69 + 12 * Math.log2(f.f0 / 440)) : m;
  txt(
    '#o-f0s',
    sounding && f
      ? `${nm(near)}（平均律から ${minus((1200 * Math.log2(f.f0 / mtof(near))).toFixed(0))} セント）${near !== m && m >= 0 ? `・狙いは ${nm(m)}` : ''}`
      : '吹いていない',
  );
  html('#o-pm', f ? ro(f.pm < 1 ? 0 : f.pm, 'Pa', 3) : '—');
  html('#o-fl', f ? ro(f.fl, 'Hz', 3) : '—');
  let pmin = 0,
    pmax = 0,
    hmax = 0,
    closed = 0,
    u = 0;
  if (c) {
    pmin = Math.min(...c.p);
    pmax = Math.max(...c.p);
    hmax = Math.max(...c.h);
    for (const h of c.h) if (h <= 0) closed++;
    for (const x of c.u) u += x / c.u.length;
  }
  html('#o-pa', sounding ? ro((pmax - pmin) / 2, 'Pa', 3) : '—');
  html('#o-spl', sounding && f ? `${(20 * Math.log10(f.rms / 2e-5)).toFixed(1)}<span class="u">dB</span>` : '—');
  html('#o-h', sounding ? mm(hmax) : '—');
  html('#o-u', sounding ? ro(u * 1000, 'L/s', 3) : '—');
  html('#o-v', vName(curV) + (slideOf(curV) > 0 ? `（抜差し +${(slideOf(curV) * 1000).toFixed(0)} mm）` : ''));
  /* 吹き方の数値 */
  const rows = CALIB[m] ?? [];
  html('#b-thr', rows.length ? `${rows[0][0].toFixed(1)}<span class="u">kPa 以下</span>` : '—');
  html('#b-hmax', sounding ? mm(hmax) : '—');
  html('#b-closed', sounding && c ? `${Math.round((100 * closed) / c.h.length)}<span class="u">%</span>` : '—');
  html('#b-flow', sounding ? ro(u * 1000, 'L/s', 3) : '—');
}
void control;
void DYNS;

/* ---------- 起動 ---------- */
audio.setPoints(airPoints());
audio.setOpts({
  temp: PT.get('temp'),
  brass: Number(nl.value),
  onAxis: dir.value === 'front',
  vib: vib.value === '1',
  noise: Number(noise.value),
  slides: corr.value === 'slide',
});
started = true;
blowRows();
figBar();
ladderNames();
roomView();
showOut();
syncPlay();
instMetrics([false, false, false]);
requestAnimationFrame(tick);

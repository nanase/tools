/**
 * ヴァイオリン音響モデルのページの入口: 弓・左手・胴・部屋の入力 → 弓と弦と胴の模型（Worker）→ 図・弓の状態・胴の応答・
 * 音の波形・計算結果・音。弦を押すと、その位置を押さえて弓で弾き続ける（「弓を離す」まで）。曲は Worker が演奏する
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, fmtR, minus, plain, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { Pauser } from '../../lib/pause';
import { movePlayStore, outVol, type PlayKey, TEMPO } from '../../lib/play';
import { acoustics, reverbSpec, roomOf } from '../../lib/reverb';
import { SW } from '../../lib/scope';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { specPlot, wavePlot } from '../guitar/plot';
import { spectra } from '../spectrum/fft';
import { ViolinAudio } from './audio';
import { BODY_DEFAULT, type BodySpec, BRIDGE, makeBody, radiation, yTop } from './body';
import { MU_INF, MU_S } from './bow';
import { type FigMode, type View, ViolinFigure } from './figure';
import {
  BETA,
  BOW_F,
  BOW_V,
  type BowKey,
  DIST,
  LEVELS,
  type LhKey,
  levelOf,
  MUTES,
  PRESS,
  TUNES,
  type TuneKey,
  VIB_HZ,
  VIB_W,
  VOL0,
} from './params';
import { OPEN } from './perform';
import { type Frame, HAIR, type Manual } from './player';
import { BH, bodyPlot, fAtX } from './plot';
import { barOf, type Expr, type PieceData, pieceOf } from './score';
import { loadScore } from './scores/load';
import { L0, muOf, noteHz, STRINGS, tensionOf, z0Of } from './strings';
import { SCOPE_N } from './synth';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};
const NAMES = ['E', 'A', 'D', 'G'];
const PC = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const noteName = (n: number) => {
  const r = Math.round(n);
  return `${PC[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
};

/* ---------- 入力 ---------- */
/** 起動を終えたか（数値の行は作るときにも変化を知らせるので、それまでは何もしない） */
let started = false;
const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
const audio = new ViolinAudio();
const NO_SOUND = '音を出せませんでした';
const PAUSED = '一時停止の間は弾けません';
const sndMsg = (s: string) => txt('#snd-msg', s);

const view = choice<'top' | 'player'>('view', () => showView());
const nv = choice<FigMode>('nv', (v) => {
  fig.setMode(v);
  figBar();
});
const ex = choice<string>('ex', (v) => {
  fig.setExag(Number(v));
  figBar();
});
const sl = choice<string>('sl', (v) => {
  fig.setSlow(Number(v));
  figBar();
});
const dir = choice<'1' | '-1'>('dir', () => sendManual());
const lv = choice<string>('lv', () => {
  bowMetrics();
  sendManual();
});
const PB = new ParamGroup<BowKey>([BOW_V, BOW_F, BETA], () => {
  if (!started) return;
  bowMetrics();
  sendManual();
});
const fl = choice<string>('fl', () => sendFeel());
const rs = choice<string>('rs', () => sendFeel());
const vib = choice<string>('vib', () => sendVib());
const PL = new ParamGroup<LhKey>([VIB_W, VIB_HZ], () => {
  if (started) sendVib();
});
/** 弦ごとの調弦のずれ [セント]（0 = E 線 … 3 = G 線） */
const tuneC = [0, 0, 0, 0];
new ParamGroup<TuneKey>(TUNES, (v) => {
  for (let q = 0; q < 4; q++) tuneC[q] = v[`tn${NAMES[q]}` as TuneKey];
  if (!started) return;
  audio.tune(tuneC);
  tuneView();
  bowMetrics();
});
const hold = choice<string>('hold', () => rebuildBody());
const mute = choice<string>('mute', () => rebuildBody());
const inst = choice<string>('inst', () => rebuildBody());
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
/** 曲の弓圧の倍率 */
let pressK = 1;
new ParamGroup<'bowp'>([PRESS], (v) => {
  pressK = v.bowp / 100;
  if (started) sendFeel();
});

/* ---------- 図 ---------- */
const fig = new ViolinFigure($<SVGSVGElement>('#vtop'), $<SVGSVGElement>('#vpl'), $<SVGSVGElement>('#vbr'), {
  onPress: (si, n) => void press(si, n),
});
fig.setMode(nv.value);
fig.setExag(Number(ex.value));
fig.setSlow(Number(sl.value));
function showView(): void {
  $('#vw-top').hidden = view.value !== 'top';
  $('#vw-pl').hidden = view.value !== 'player';
}
function figBar(): void {
  txt('#vf-ex', `×${ex.value}`);
  txt('#vf-tm', nv.value === 'slow' ? `スロー 1/${sl.value}` : '実時間（残像）');
  $('#sl-row').hidden = nv.value !== 'slow';
}

/* ---------- 手で弾く ---------- */
/** 弓を当てているか、弦ごとに押さえている音の高さ（開放弦からの半音） */
const M = { bowing: false, stop: [0, 0, 0, 0] };
const level = () => Number(lv.value);
const levelStrings = (): number[] => [...LEVELS[level()].s];
/** 手で弾くときのいちばん高い弦 */
const manLead = () => Math.min(...levelStrings());
function manualMsg(): Manual {
  return {
    strings: M.bowing ? levelStrings() : [],
    stop: [...M.stop],
    v: PB.get('vb'),
    F: PB.get('fb'),
    beta: PB.get('beta'),
    dir: Number(dir.value),
  };
}
function sendManual(): void {
  if (M.bowing) audio.manual(manualMsg());
}
function sendFeel(): void {
  audio.feel(Number(fl.value), Number(rs.value), pressK);
}
function sendVib(): void {
  audio.setVib({ on: vib.value === '1', cent: PL.get('vw'), hz: PL.get('vh') });
}

/** 弦 si を、音の高さ n（null なら押さえる位置はそのまま）で弾く */
async function press(si: number, n: number | null): Promise<void> {
  if (pauser.paused) {
    sndMsg(PAUSED);
    return;
  }
  if (P) stopPiece();
  if (n !== null) M.stop[si] = Math.max(0, n - OPEN[si]);
  if (!levelStrings().includes(si)) lv.set(String(levelOf(si)));
  M.bowing = true;
  const ok = await audio.ready();
  if (!ok) {
    M.bowing = false;
    sndMsg(NO_SOUND);
    syncPlay();
    return;
  }
  sndMsg('');
  audio.manual(manualMsg());
  txt('#vf-live', `${NAMES[si]} 線 ${noteName(OPEN[si] + M.stop[si])} を弾いています`);
  bowMetrics();
  syncPlay();
}
function lift(): void {
  if (!M.bowing) return;
  M.bowing = false;
  audio.manual(manualMsg());
  txt('#vf-live', '弓を離しました');
  syncPlay();
}
/* キー操作: 上下で弦、左右で押さえる位置、スペースで弓を当てる・離す */
for (const id of ['#vw-top', '#vw-pl'])
  $(id).addEventListener('keydown', (e: KeyboardEvent) => {
    const q = manLead();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const nq = Math.max(0, Math.min(3, q + (e.key === 'ArrowUp' ? -1 : 1)));
      lv.set(String(levelOf(nq)));
      bowMetrics();
      sendManual();
      txt('#vf-live', `${NAMES[nq]} 線 ${noteName(OPEN[nq] + M.stop[nq])}`);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      M.stop[q] = Math.max(0, Math.min(24, M.stop[q] + (e.key === 'ArrowRight' ? 1 : -1)));
      bowMetrics();
      sendManual();
      txt('#vf-live', `${NAMES[q]} 線 ${noteName(OPEN[q] + M.stop[q])}`);
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (M.bowing) lift();
      else void press(q, null);
    } else return;
    e.preventDefault();
  });

/* ---------- 弓の値 ---------- */
/** 松脂の静止と動きの摩擦係数の差（模型の値） */
const DMU = MU_S - MU_INF;
/**
 * 弓圧の下限の目安 [N]: Schoonderwaldt ほか (2008) が測った F_min β²（弓速によらない）を β² で割る。
 * D 線の開放 0.69 mN・押さえた D 線 1.56 mN・E 線 0.17 mN（A 線と G 線は D 線の値を使う）
 */
const fMin = (q: number, stopped: boolean, beta: number) =>
  ((q === 0 ? (stopped ? 0.38 : 0.17) : stopped ? 1.56 : 0.69) * 1e-3) / (beta * beta);
/** Schelleng の上限 [N]: 2 Z0 v / (β (μs − μd)) */
const fMax = (q: number, v: number, beta: number) => (2 * z0Of(STRINGS[q], tuneC[q]) * v) / (beta * DMU);
/** 弦 q の振動する長さ [m] */
const lenOf = (q: number, n: number) => L0 * 2 ** (-(n - OPEN[q]) / 12);
function bowMetrics(): void {
  const q = manLead(),
    beta = PB.get('beta'),
    v = PB.get('vb'),
    stopped = M.stop[q] > 0;
  html('#m-fmax', ro(fMax(q, v, beta), 'N', 3));
  html('#m-fmin', ro(fMin(q, stopped, beta), 'N', 3));
  html('#m-xb', ro(beta * lenOf(q, OPEN[q] + M.stop[q]), 'm', 3));
  html('#m-slip', `${(100 * beta).toFixed(1)}<span class="u">%</span>`);
}

/** 調弦した開放弦の第 1 部分音（弦の曲げの硬さと駒との結合を除く）と張力 */
function tuneView(): void {
  for (let q = 0; q < 4; q++) {
    html(`#tf-${NAMES[q]}`, ro(noteHz(OPEN[q]) * 2 ** (tuneC[q] / 1200), 'Hz', 5));
    txt(`#tt-${NAMES[q]}`, `張力 ${tensionOf(STRINGS[q], tuneC[q]).toFixed(1)} N`);
  }
}

/* ---------- 胴 ---------- */
let bodySpec: BodySpec = { ...BODY_DEFAULT },
  body = makeBody(bodySpec),
  bodyFs: number[] = [];
function rebuildBody(): void {
  const mm = MUTES.find((m) => m[0] === mute.value)?.[2] ?? 0;
  bodySpec = { ...BODY_DEFAULT, hold: Number(hold.value), mute: mm, seed: Number(inst.value) };
  body = makeBody(bodySpec);
  audio.setBody(bodySpec);
  const f = (name: string) => body.raw.find((m) => m.name === name)?.f ?? 0;
  html('#b-a0', ro(f('A0'), 'Hz', 3));
  html('#b-cbr', ro(f('CBR'), 'Hz', 3));
  html('#b-b1m', ro(f('B1-'), 'Hz', 3));
  html('#b-b1p', ro(f('B1+'), 'Hz', 3));
  /* 弱音器を載せた駒の共振（足を固定したとき）: 揺れは慣性モーメント、上下は質量が増える */
  const I = bodySpec.inertia,
    fr = bodySpec.fRock * Math.sqrt(I / (I + mm * BRIDGE.L * BRIDGE.L)),
    fbn = bodySpec.fBounce * Math.sqrt(bodySpec.mBounce / (bodySpec.mBounce + mm));
  html('#b-rock', ro(fr, 'Hz', 3));
  html('#b-bnc', ro(fbn, 'Hz', 3));
  drawBody();
}
let bodyNote = -1;
function drawBody(): void {
  const b = bodyPlot(body, bodyFs);
  $('#b-t1').setAttribute('d', b.y);
  $('#b-t2').setAttribute('d', b.p);
  html('#b-mk', b.marks);
  html('#b-pt', b.partials);
  html('#b-axes', b.axes);
  bodyCursor();
}
/** 弾いている音の部分音の印（音が変わったときだけ描き直す） */
function bodyPartials(n: number): void {
  const r = Math.round(n * 2) / 2;
  if (r === bodyNote) return;
  bodyNote = r;
  const f1 = noteHz(r);
  bodyFs = [];
  for (let k = 1; k * f1 < 10000; k++) bodyFs.push(k * f1);
  drawBody();
}
let bodyCur: number | null = null;
function bodyCursor(): void {
  const x = bodyCur;
  $('#b-cur').setAttribute('d', x === null ? '' : `M${x.toFixed(1)} 0V${BH}`);
  if (x === null) {
    txt('#b-rd', '');
    return;
  }
  const f = fAtX(x),
    y = yTop(body, f),
    r0 = radiation(body, f, 0),
    r1 = radiation(body, f, 1),
    pa = Math.sqrt((r0.re ** 2 + r0.im ** 2 + r1.re ** 2 + r1.im ** 2) / 2);
  txt(
    '#b-rd',
    `${fmt(f, 'Hz', 3)}  CH1 ${minus((20 * Math.log10(Math.hypot(y.re, y.im))).toFixed(1))} dB  CH2 ${minus((20 * Math.log10(pa)).toFixed(1))} dB`,
  );
}
{
  const svg = $<SVGSVGElement>('#b-svg');
  svg.addEventListener('pointermove', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    bodyCur = q.x >= 0 && q.x <= SW && q.y >= 0 && q.y <= BH ? q.x : null;
    bodyCursor();
  });
  svg.addEventListener('pointerleave', () => {
    bodyCur = null;
    bodyCursor();
  });
}

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

/* ---------- 音の波形（直前の音を Worker から受け取る） ---------- */
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
/** 演奏中の曲（小節の数を出すために、主スレッドでも楽譜を読む） */
let P: { v: string; data: PieceData; bars: number } | null = null;
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
  $<HTMLButtonElement>('#liftBtn').disabled = !M.bowing;
  /* 図の左下のボタン: 弾き続けている間は弓を離す、曲の間は演奏を止める */
  $('#vf-stop').hidden = !(M.bowing || P);
  txt('#vf-stopT', P ? '演奏を止める' : '弓を離す');
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
    sndMsg('曲を読み込めませんでした');
    return;
  }
  if (P || piece.value !== pc.v) return;
  M.bowing = false;
  P = { v: pc.v, data, bars: data.bars.length + 1 };
  audio.playPiece(pc.v, data, expr.value, tempo, null);
  plBar = '';
  syncPlay();
}
function stopPiece(): void {
  if (!P) return;
  P = null;
  audio.resetIfPaused();
  pauser.clear();
  audio.stopPiece();
  plBar = '';
  syncPlay();
}
function retempo(): void {
  if (P) audio.retempo(expr.value, tempo);
}
audio.onDone = () => {
  P = null;
  plBar = '';
  syncPlay();
};
audio.onError = (msg) => sndMsg(`計算で問題が起きました（${msg}）`);
$('#playBtn').addEventListener('click', () => {
  if (P) stopPiece();
  else void startPiece();
});
$('#pauseBtn').addEventListener('click', () => void (pauser.paused ? pauser.resume() : pauser.pause()));
$('#liftBtn').addEventListener('click', () => lift());
$('#vf-stop').addEventListener('click', () => {
  if (P) stopPiece();
  else lift();
});
$('#muteBtn').addEventListener('click', () => {
  if (P) {
    P = null;
    pauser.clear();
    plBar = '';
  }
  M.bowing = false;
  audio.resetIfPaused();
  audio.mute();
  syncPlay();
});

/* ---------- 表示の状態（Worker の音に合わせる） ---------- */
let frames: Frame[] = [];
audio.onFrames = (fs) => {
  frames.push(...fs);
  if (frames.length > 400) frames = frames.slice(-400);
};
/** いま聞こえている時刻の状態 */
function heard(): Frame | null {
  if (!frames.length) return null;
  const at = audio.heardAt();
  if (at === null) return frames[frames.length - 1];
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].at < at) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 8) frames = frames.slice(lo - 8);
  return frames[Math.min(lo, 8)] ?? frames[frames.length - 1];
}
/** 曲で最後に弓が触れていた弦 */
let lastTouch: number[] = [1];
/** 弾く前の弓の位置 [m]（毛の元から。player.ts の初めの位置） */
const POS0 = 0.3;
/** 弓が弦に触れていないときに弓を置いておく弦（曲では最後に触れていた弦、手で弾くときは選んだ弦） */
const restOf = (): number[] => (P ? lastTouch : levelStrings());
/** 弓が触れている弦のうちいちばん高い弦（なければ弓を置いておく弦のいちばん高い弦） */
const leadOf = (f: Frame | null) => {
  if (f) for (let q = 0; q < 4; q++) if (f.c[q] > 0.3) return q;
  return Math.min(...restOf());
};
function viewOf(f: Frame | null): View {
  const q = leadOf(f),
    playing = !!P;
  if (!f)
    return {
      c: [0, 0, 0, 0],
      n: OPEN.map((o, i) => o + M.stop[i]),
      a: [0, 0, 0, 0],
      vb: 0,
      fb: PB.get('fb'),
      xb: PB.get('beta') * lenOf(q, OPEN[q] + M.stop[q]) * 1000,
      beta: PB.get('beta'),
      dir: Number(dir.value),
      pos: POS0,
      bowing: M.bowing,
      rest: restOf(),
    };
  const fb = f.f.reduce((s, x) => s + x, 0),
    /* 曲でなく弓も離しているときは、弓の位置は手で弾く値で描く */
    beta = playing || M.bowing ? f.b[q] : PB.get('beta'),
    n = playing || M.bowing ? f.n[q] : OPEN[q] + M.stop[q];
  return {
    c: f.c,
    n: f.n,
    a: f.a,
    vb: f.vb,
    fb: playing || M.bowing ? fb : PB.get('fb'),
    xb: beta * lenOf(q, n) * 1000,
    beta,
    dir: Number(dir.value),
    pos: f.pos,
    bowing: M.bowing || playing,
    rest: restOf(),
  };
}

/* 弓の状態のメーター（表示だけ） */
const meter = (k: string, v: number, lo: number, hi: number, okLo: number, okHi: number, text: string) => {
  const X = (x: number) => (300 * (Math.min(hi, Math.max(lo, x)) - lo)) / (hi - lo);
  $(`#bm-${k}-ok`).setAttribute('x', X(okLo).toFixed(1));
  $(`#bm-${k}-ok`).setAttribute('width', Math.max(0, X(okHi) - X(okLo)).toFixed(1));
  $(`#bm-${k}-bar`).setAttribute('width', X(v).toFixed(1));
  $(`#bm-${k}-nd`).setAttribute('d', `M${X(v).toFixed(1)} 0V10`);
  digits(k, text);
};
/** 弓の状態の値。小数点の位置を 4 つの行で揃えるため、整数部と小数部を別の欄に書く */
const digits = (k: string, text: string) => {
  const d = text.indexOf('.');
  txt(`#bm-${k}-i`, text.slice(0, d));
  txt(`#bm-${k}-f`, text.slice(d));
};
function meters(f: Frame | null, v: View): void {
  const beta = v.beta,
    live = !!f && (!!P || M.bowing),
    speed = Math.abs(f && live ? f.vb : PB.get('vb')),
    /* 弓圧は触れている弦の和なので、よく鳴る範囲も触れている弦ごとの範囲の和にする（弦ごとに β と押さえ方が違う） */
    on = f && live ? [0, 1, 2, 3].filter((q) => f.c[q] > 0.3) : [],
    strs = on.length ? on : P ? [leadOf(f)] : levelStrings();
  let lo = 0,
    hi = 0;
  for (const q of strs) {
    const bq = f && live ? f.b[q] : beta,
      stopped = (live ? v.n[q] - OPEN[q] : M.stop[q]) > 0.05;
    lo += fMin(q, stopped, bq);
    hi += fMax(q, Math.max(0.05, speed), bq);
  }
  meter('v', speed, 0, 1, 0.1, 0.6, speed.toFixed(2));
  meter('f', v.fb, 0, 4, lo, hi, v.fb.toFixed(2));
  meter('b', beta, 0, 0.25, 0.05, 0.15, beta.toFixed(3));
  /* 演奏者から見た向き（元が右）。下げ弓では、弦に触れる点が先の側（左）へ動く */
  const pos = f ? f.pos : POS0,
    x = 287 - (287 - 11) * (pos / HAIR);
  $('#bm-p-nd').setAttribute('d', `M${x.toFixed(1)} 0V10`);
  digits('p', pos.toFixed(2));
}
/** 弾いている音の表示（図の左上。弦ごとに 1 行、高い弦から） */
function noteBar(f: Frame | null): void {
  if (!f) {
    html('#vf-note', '');
    return;
  }
  html(
    '#vf-note',
    [0, 1, 2, 3]
      .filter((q) => f.c[q] > 0.3)
      .map(
        (q) =>
          `<span>${NAMES[q]} 線</span><span>${noteName(f.n[q])}</span><span>${(noteHz(Math.round(f.n[q])) * 2 ** (tuneC[q] / 1200)).toFixed(2)} Hz</span>`,
      )
      .join(''),
  );
}
/** 計算結果（いちばん高い弦） */
let lastOut = 0;
function results(f: Frame | null, v: View): void {
  const now = performance.now();
  if (now - lastOut < 200) return;
  lastOut = now;
  const q = leadOf(f),
    /* 弓を当てていない間は、手で弾くときに押さえる音 */
    n = P || M.bowing ? v.n[q] : OPEN[q] + M.stop[q],
    sp = STRINGS[q],
    T = tensionOf(sp, tuneC[q]),
    mu = muOf(sp),
    c = Math.sqrt(T / mu),
    L = lenOf(q, n),
    f1 = c / (2 * L),
    z0 = z0Of(sp, tuneC[q]),
    beta = v.beta,
    speed = Math.abs(f && (P || M.bowing) ? f.vb : PB.get('vb'));
  html('#o-f1', ro(f1, 'Hz', 4));
  txt('#o-f1s', `${NAMES[q]} 線 ${noteName(n)}（弦の曲げの硬さを除く値）`);
  html('#o-l', ro(L, 'm', 3));
  html('#o-t', ro(T, 'N', 3));
  html('#o-mu', ro(mu * 1000, 'g/m', 3));
  html('#o-c', ro(c, 'm/s', 3));
  html('#o-z0', ro(z0, 'kg/s', 3));
  html('#o-fb', ro((z0 * speed) / beta, 'N', 3));
  const a = f ? f.a[q] : 0;
  html('#o-amp', a > 1e-7 ? ro(a, 'm', 3) : '—');
  txt('#o-amps', `Helmholtz の運動の目安 v/(4βf) = ${fmt(speed / (4 * beta * f1), 'm', 3)}`);
}

/* 描く: 画面の更新ごと */
function tick(): void {
  const f = heard();
  if (f && P) {
    const on = [0, 1, 2, 3].filter((q) => f.c[q] > 0.3);
    if (on.length) lastTouch = on;
  }
  const v = viewOf(f);
  fig.draw(v, pauser.clock.now(), view.value === 'top');
  meters(f, v);
  noteBar(f && (P || M.bowing || f.c.some((c) => c > 0)) ? f : null);
  results(f, v);
  const q = leadOf(f);
  if (f && f.c[q] > 0.3) bodyPartials(f.n[q] + tuneC[q] / 100);
  if (P && f && f.beat !== null) showBar(`${Math.min(P.bars, barOf(P.data, f.beat))} / ${P.bars} 小節`);
  requestAnimationFrame(tick);
}

/* ---------- 起動 ---------- */
started = true;
showView();
figBar();
bowMetrics();
rebuildBody();
roomView();
sendVib();
sendFeel();
audio.tune(tuneC);
tuneView();
showOut();
syncPlay();
queueMicrotask(() => {
  bowMetrics();
  rebuildBody();
  roomView();
});
requestAnimationFrame(tick);

/**
 * FM 音源のページの入口: アルゴリズム・帰還量・オペレータ・鍵盤の入力 → 音色 → 結線図・波形・スペクトラム・代入式・音。
 * 波形とスペクトラムは入力が変わるたびに 32 周期ぶんを計算し直す。曲の演奏は、すべての音を今の音色で弾く
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { same } from '../../lib/eseries';
import { fmt, fmtR, minus, plain } from '../../lib/format';
import { MidiBox } from '../../lib/midi';
import { ParamGroup } from '../../lib/param';
import { autoPause, lookahead } from '../../lib/pause';
import { type PlayKey, TEMPO } from '../../lib/play';
import { DV } from '../../lib/scope';
import { forget, store, stored } from '../../lib/store';
import { TempoMap } from '../../lib/tempo';
import { initToolPage } from '../../lib/tool-page';
import { evenLine, type Line, Transport } from '../../lib/transport';
import { spectra, toDb } from '../spectrum/fft';
import { FmAudio } from './audio';
import { algH, algSvg, algText, DW } from './diagram';
import {
  ALG0,
  ampDef,
  ampPatch,
  I0,
  IDX,
  KEYS,
  type Key,
  L0,
  LVL,
  NOTE0,
  noteHz,
  noteName,
  OCT,
  OPS,
  type Op,
  R0,
  RATIOS,
  ratioDef,
  VOL,
} from './params';
import { PIECES, type Piece, type PieceData, pieceOf } from './score';
import { ALGS, FB_LABEL, isCarrier, normGain, type Patch, PTS, WAVES, waveIndex, waveOf } from './synth';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};

/* 表示窓: 10 × 4 div（400 × 160）。波形の振幅 0 は中央、スペクトラムは上端が 0 dBFS で 20 dB/div */
const W = 10 * DV,
  H = 4 * DV,
  MID = H / 2,
  DB_DIV = 20;
/** スペクトラムに使う周期の数（1 周期 PTS 点、計 16384 点） */
const SP_PER = 32,
  N = SP_PER * PTS;

/* ---------- 状態 ---------- */
const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
const alg = choice<string>('alg', (v) => {
  O.alg = Number(v);
  update();
});
const fb = choice<string>('fb', (v) => {
  O.fb = Number(v);
  update();
});
const norm = choice<'on' | 'off'>('norm', (v) => {
  O.norm = v === 'on';
  update();
});
const per = choice<string>('per', (v) => {
  O.per = Number(v);
  draw();
});
const rng = choice<string>('rng', (v) => {
  O.rng = Number(v);
  draw();
});
const hm = choice<string>('hm', (v) => {
  O.hm = Number(v);
  draw();
});
const view = new Choice<'yt' | 'sp'>($('#p-view'), (v) => {
  O.view = v;
  showView();
});
const O = {
  alg: Number(alg.value),
  fb: Number(fb.value),
  norm: norm.value === 'on',
  view: view.value,
  per: Number(per.value),
  rng: Number(rng.value),
  hm: Number(hm.value),
  /** カーソルの位置（表示窓の x）。外なら null */
  cur: null as number | null,
};
/** 保存した数値。なければ・使えなければ v0 */
const num = (k: string, v0: number, ok: (v: number) => boolean) => {
  const v = stored(k);
  return typeof v === 'number' && ok(v) ? v : v0;
};
/** オペレータの値（OP1〜OP4）: 波形・周波数比・変調指数・出力レベル（dB） */
const OV = {
  w: OPS.map(() => 0),
  r: OPS.map((n) => num(`p:r${n}`, R0[n - 1], (v) => RATIOS.includes(v))),
  i: OPS.map((n) => num(`p:i${n}`, I0[n - 1], (v) => v >= IDX.min && v <= IDX.max)),
  l: OPS.map((n) => num(`p:l${n}`, L0[n - 1], (v) => v >= LVL.min && v <= LVL.max)),
};
/** 鍵盤: 選んでいる音（MIDI のノート番号）と、左端の C のオクターブ */
const KB = {
  n: num('kb:n', NOTE0, (v) => Number.isInteger(v) && v >= 12 * (OCT.min + 1) && v < 12 * (OCT.max + 1) + KEYS),
  o: num('kb:o', OCT.v, (v) => Number.isInteger(v) && v >= OCT.min && v <= OCT.max),
};
const f0 = () => noteHz(KB.n);
/** 計算した 32 周期ぶんの出力と、そのスペクトラム（dB） */
let wave = new Float64Array(N),
  spec = new Float32Array(N / 2 + 1);
const audio = new FmAudio();

function patch(): Patch {
  return {
    alg: O.alg,
    fb: O.fb,
    w: OV.w,
    r: OV.r,
    a: OPS.map((_, k) => (isCarrier(O.alg, k) ? 10 ** (OV.l[k] / 20) : OV.i[k])),
    norm: O.norm,
  };
}

/* ---------- オペレータ ---------- */
const fmtI = (v: number) => `I ${plain(v, 3)}`;
const fmtL = (v: number) => `${minus(String(v))} dB`;
/* 周波数比（ブラウザに p:r1〜p:r4 として保存する） */
new ParamGroup<string>(OPS.map(ratioDef), (v, k) => {
  if (!k) return;
  OV.r[Number(k.slice(1)) - 1] = v[k];
  update();
});
/* 強さ: キャリアは出力レベル（p:l1〜p:l4 に保存）、モジュレータは変調指数（p:i1〜p:i4）。役割はアルゴリズムで変わる */
const role = OPS.map((n) => isCarrier(ALG0, n - 1));
const AG = new ParamGroup<string>(
  OPS.map((n) => ampDef(n, role[n - 1])),
  (v, k) => {
    if (!k) return;
    const i = Number(k.slice(1)) - 1,
      car = isCarrier(O.alg, i),
      x = v[k],
      key = `p:${car ? 'l' : 'i'}${i + 1}`;
    if (car) OV.l[i] = x;
    else OV.i[i] = x;
    if (same(x, car ? L0[i] : I0[i])) forget(key);
    else store(key, x);
    update();
  },
  null,
  { save: false },
);
/** キャリアかモジュレータかで、強さの行を出力レベルか変調指数にする */
function syncOp(k: number): void {
  const n = (k + 1) as Op,
    car = isCarrier(O.alg, k),
    v = car ? OV.l[k] : OV.i[k];
  txt(`#op${n}-role`, car ? 'キャリア' : 'モジュレータ');
  if (role[k] !== car) {
    role[k] = car;
    AG.update(`a${n}`, ampPatch(n, car));
  }
  if (!same(AG.get(`a${n}`), v)) AG.set(`a${n}`, v, { silent: true });
}
OPS.forEach((n, k) => {
  const wc = new Choice<string>($(`#p-w${n}`), (v) => {
    OV.w[k] = waveIndex(v);
    update();
  });
  OV.w[k] = waveIndex(wc.value);
});

/** 結線図の箱の下に添える値 */
const notes = () => OPS.map((_, k) => `×${plain(OV.r[k], 3)} · ${isCarrier(O.alg, k) ? fmtL(OV.l[k]) : fmtI(OV.i[k])}`);

/** 入力が変わったら: 音色を作り直し、波形とスペクトラムを計算して描く */
function update(): void {
  const p = patch();
  for (let k = 0; k < 4; k++) syncOp(k);
  const ng = normGain(p),
    nt = $('#w-norm');
  nt.hidden = ng === 1;
  txt('#w-norm b', `×${plain(ng, 3, true)}`);
  const svg = $('#alg-svg');
  svg.innerHTML = algSvg(O.alg, O.fb, notes());
  svg.setAttribute('viewBox', `0 0 ${DW} ${algH(O.alg)}`);
  svg.setAttribute('aria-label', `${algText(O.alg)}。帰還量 ${FB_LABEL[O.fb]}`);
  wave = waveOf(p, SP_PER);
  const px = new Float32Array(N / 2 + 1);
  spectra(wave, wave, N, 'bh', px, new Float32Array(N / 2 + 1));
  spec = px;
  subst(p);
  audio.send(p, f0());
  draw();
}

/* ---------- 波形 ---------- */
const vds = (v: number) => minus(String(Number(v.toPrecision(3))));
const signed = (v: number, d = 3) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
const wy = (v: number) => MID - (v / O.rng) * MID;

function drawWave(): void {
  const n = O.per * PTS,
    k = W / n,
    y = (v: number) => Math.max(-400, Math.min(H + 400, wy(v))).toFixed(1);
  let d = '';
  if (n <= 1600) for (let i = 0; i <= n; i++) d += `${i ? 'L' : 'M'}${(i * k).toFixed(2)} ${y(wave[i])}`;
  else
    for (let j = 0; j < 2 * W; j++) {
      const i0 = Math.floor(j / (2 * k)),
        i1 = Math.min(n, Math.floor((j + 1) / (2 * k)));
      let lo = Infinity,
        hi = -Infinity;
      for (let i = i0; i <= i1; i++) {
        lo = Math.min(lo, wave[i]);
        hi = Math.max(hi, wave[i]);
      }
      d += `${d ? 'L' : 'M'}${j / 2} ${y(hi)}L${j / 2} ${y(lo)}`;
    }
  $('#w-t1').setAttribute('d', d);
  const f0 = noteHz(KB.n),
    hd = O.per / f0 / 10,
    vd = O.rng / 2;
  let a = '';
  for (let i = 0; i <= 10; i += 2)
    a += `<text x="${i * DV}" y="${H + 17}" text-anchor="middle">${i ? fmt(i * hd, 's', 3) : '0'}</text>`;
  for (let j = 0; j <= 4; j++) {
    const v = (2 - j) * vd;
    a += `<text x="-10" y="${j * DV + 4}" text-anchor="end">${v === 0 ? '0' : (v > 0 ? '+' : '') + vds(v)}</text>`;
  }
  a += `<path class="mk1" d="M-8 ${MID - 5}L-1 ${MID}L-8 ${MID + 5}Z"/>`;
  html('#w-axes', a);
  txt('#w-vd', vds(vd));
  txt('#w-hd', fmt(hd, 's', 3));
  txt('#w-f0', fmt(f0, 'Hz', 4));
  let pk = 0;
  for (let i = 0; i <= n; i++) pk = Math.max(pk, Math.abs(wave[i]));
  $('#w-svg').setAttribute(
    'aria-label',
    `出力の波形。基本周波数 ${fmt(f0, 'Hz')} の ${O.per} 周期ぶん、ピーク ${plain(pk, 3)}。縦軸 ${vds(vd)}/div、横軸 ${fmt(hd, 's', 3)}/div。`,
  );
}

/* ---------- スペクトラム ---------- */
/** 横軸の右端の bin（基本周波数の hm 倍） */
const kMax = () => SP_PER * O.hm;
const sy = (db: number) => Math.max(-4, Math.min(H + 4, (-db / DB_DIV) * DV));

function drawSpec(): void {
  const km = kMax(),
    k = W / km;
  let d = '';
  for (let j = 0; j < 2 * W; j++) {
    const i0 = Math.ceil(j / (2 * k)),
      i1 = Math.min(km, Math.floor((j + 1) / (2 * k)));
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) hi = Math.max(hi, spec[i]);
    if (hi > -Infinity) d += `${d ? 'L' : 'M'}${j / 2} ${sy(toDb(hi)).toFixed(1)}`;
  }
  $('#s-t1').setAttribute('d', d);
  const f0 = noteHz(KB.n);
  let a = '';
  for (let i = 0; i <= 10; i += 2) {
    const f = (i / 10) * O.hm * f0;
    a += `<text x="${i * DV}" y="${H + 17}" text-anchor="middle">${i ? fmt(f, 'Hz', 3) : '0'}</text>`;
  }
  for (let j = 0; j <= 4; j++)
    a += `<text x="-10" y="${j * DV + 4}" text-anchor="end">${j ? minus(String(-j * DB_DIV)) : '0'}</text>`;
  html('#s-axes', a);
  txt('#s-x', `0–${fmt(O.hm * f0, 'Hz', 3)}`);
  $('#s-svg').setAttribute(
    'aria-label',
    `出力のスペクトラム。横軸 0 から ${fmt(O.hm * f0, 'Hz', 3)}（基本周波数の ${O.hm} 倍）、縦軸 0 から −80 dBFS。`,
  );
}

function draw(): void {
  if (O.view === 'yt') drawWave();
  else drawSpec();
  cursor();
}

function showView(): void {
  $('#v-yt').hidden = O.view !== 'yt';
  $('#v-sp').hidden = O.view !== 'sp';
  txt('#hd-wave', O.view === 'sp' ? 'スペクトラム' : '波形');
  O.cur = null;
  draw();
}

/* ---------- カーソルの読み値 ---------- */
const svgs = [$<SVGSVGElement>('#w-svg'), $<SVGSVGElement>('#s-svg')];
function cursor(): void {
  const sp = O.view === 'sp',
    id = sp ? 's' : 'w',
    x = O.cur;
  $(`#${sp ? 'w' : 's'}-cur`).setAttribute('d', '');
  if (x === null) {
    $(`#${id}-cur`).setAttribute('d', '');
    txt(`#${id}-rd`, '');
    return;
  }
  if (sp) {
    /* 近くの山（±4 bin）に合わせる */
    const km = kMax(),
      c = Math.round((x / W) * km);
    let b = c;
    for (let i = Math.max(0, c - 4); i <= Math.min(km, c + 4); i++) if (spec[i] > spec[b]) b = i;
    const xb = (b / km) * W,
      db = toDb(spec[b]);
    $('#s-cur').setAttribute('d', `M${xb.toFixed(1)} 0V${H}`);
    txt(
      '#s-rd',
      `f ${b ? fmtR((b / SP_PER) * f0(), 'Hz', 4) : '0 Hz'}   CH1 ${db < -150 ? '−∞' : minus(db.toFixed(2))} dBFS`,
    );
  } else {
    const n = O.per * PTS,
      i = Math.round((x / W) * n),
      t = i / PTS / f0();
    $('#w-cur').setAttribute('d', `M${x.toFixed(1)} 0V${H}`);
    txt('#w-rd', `t ${i ? fmtR(t, 's', 4) : '0'}   CH1 ${signed(wave[i])}`);
  }
}
for (const svg of svgs) {
  svg.addEventListener('pointermove', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    O.cur = p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H ? p.x : null;
    cursor();
  });
  svg.addEventListener('pointerleave', () => {
    O.cur = null;
    cursor();
  });
}

/* ---------- 代入した式 ---------- */
const mn = (s: string) => `<mn>${s}</mn>`;
const sOf = (k: number) => `<msub><mi>s</mi><mn>${k + 1}</mn></msub>`;
const DOT = '<mo>&#x22C5;</mo>';
function subst(p: Patch): void {
  const { e, c } = ALGS[p.alg];
  let h = '';
  for (let k = 0; k < 4; k++) {
    let m = '';
    for (const [j, t] of e) if (t === k) m += `<mo>+</mo>${mn(plain(p.a[j], 3))}${sOf(j)}`;
    if (k === 0 && p.fb)
      m += `<mo>+</mo><mrow>${mn(FB_LABEL[p.fb])}</mrow><msub><mover><mi>s</mi><mo>&#x2015;</mo></mover><mn>1</mn></msub>`;
    h += `<math display="block">${sOf(k)}<mo>=</mo><mi>${WAVES[p.w[k]][2]}</mi><mo>&#x2061;</mo><mrow><mo>(</mo><mn>2</mn><mi>π</mi>${DOT}${mn(plain(p.r[k] * f0(), 6))}<mi>t</mi>${m}<mo>)</mo></mrow></math>`;
  }
  const ng = normGain(p),
    sum = c.map((k) => `${mn(plain(p.a[k], 4, true))}${sOf(k)}`).join('<mo>+</mo>');
  h += `<math display="block"><mi>y</mi><mo>=</mo>${ng === 1 ? sum : `${mn(plain(ng, 4, true))}<mrow><mo>(</mo>${sum}<mo>)</mo></mrow>`}</math>`;
  html('#subst', h);
}

/* ---------- 鍵盤と音 ---------- */
const kb = $('#kb'),
  keys = $$<HTMLButtonElement>('.kk', kb),
  playBtn = $('#playBtn');
function syncKb(): void {
  const c0 = 12 * (KB.o + 1);
  for (const b of keys) {
    const n = c0 + Number(b.dataset.i);
    b.setAttribute('aria-pressed', String(n === KB.n));
    b.setAttribute('aria-label', `${noteName(n)} ${fmt(noteHz(n), 'Hz', 5)}`);
    const lab = b.querySelector('span');
    if (lab) lab.textContent = n % 12 === 0 ? noteName(n) : '';
  }
  txt('#kb-rng', `${noteName(c0)}–${noteName(c0 + KEYS - 1)}`);
  txt('#kb-note', noteName(KB.n));
  txt('#kb-hz', fmtR(noteHz(KB.n), 'Hz', 5));
  $<HTMLButtonElement>('#octDn').disabled = KB.o <= OCT.min;
  $<HTMLButtonElement>('#octUp').disabled = KB.o >= OCT.max;
  litKeys();
}
function pick(n: number): void {
  if (n === KB.n) return;
  KB.n = n;
  store('kb:n', n);
  syncKb();
  update();
}
for (const [id, d] of [
  ['#octDn', -1],
  ['#octUp', 1],
] as const)
  $(id).addEventListener('click', () => {
    KB.o = Math.max(OCT.min, Math.min(OCT.max, KB.o + d));
    store('kb:o', KB.o);
    syncKb();
  });

function syncSnd(err = ''): void {
  playBtn.setAttribute('aria-pressed', String(audio.latch));
  $('#sndLed').classList.toggle('on', audio.play);
  txt('#playT', audio.latch ? '停止' : '再生');
  txt('#snd-msg', err);
}
const NO_SOUND = '音を出せませんでした';
playBtn.addEventListener('click', async () => {
  const ok = await audio.setLatch(!audio.latch);
  if (!ok) audio.latch = false;
  syncSnd(ok ? '' : NO_SOUND);
});

/* 鍵盤: 押している間だけ鳴らす（再生中なら音の高さだけ変える）。押したまま横へ動かすと音が移る */
const keyAt = (e: Event) => (e.target as Element).closest<HTMLButtonElement>('.kk');
const noteOf = (b: HTMLButtonElement) => 12 * (KB.o + 1) + Number(b.dataset.i);
let down = false;
async function hold(on: boolean): Promise<void> {
  if (down === on) return;
  down = on;
  const ok = await audio.setHold(on);
  syncSnd(ok ? '' : NO_SOUND);
}
kb.addEventListener('pointerdown', (e) => {
  const b = keyAt(e);
  if (!b || e.button !== 0) return;
  b.releasePointerCapture(e.pointerId);
  pick(noteOf(b));
  void hold(true);
});
kb.addEventListener('pointerover', (e) => {
  const b = keyAt(e);
  if (b && down) pick(noteOf(b));
});
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => void hold(false));
kb.addEventListener('click', (e) => {
  const b = keyAt(e);
  /* キーボードの Enter・Space は音の高さを選ぶだけ */
  if (b && e.detail === 0) pick(noteOf(b));
});

/* ---------- 曲の演奏 ---------- */
const piece = $<HTMLSelectElement>('#piece');
{
  const v = stored('c:p-piece');
  if (typeof v === 'string' && PIECES.some((p) => p.v === v)) piece.value = v;
}
piece.addEventListener('change', () => {
  store('c:p-piece', piece.value);
  if (PL) stopPiece();
  void showLine();
});
const plMsg = (s: string) => txt('#pl-msg', s);
let tempo = TEMPO.v;

/* 曲で鳴っている鍵の印（鍵盤に見えている範囲だけ）。同じ高さの音が重なることがあるので数える */
const lit = new Map<number, number>();
function litKeys(): void {
  const c0 = 12 * (KB.o + 1);
  for (const b of keys) b.classList.toggle('on', (lit.get(c0 + Number(b.dataset.i)) ?? 0) > 0);
}
function light(n: number, on: boolean): void {
  const c = (lit.get(n) ?? 0) + (on ? 1 : -1);
  if (c > 0) lit.set(n, c);
  else lit.delete(n);
  keys.find((b) => noteOf(b) === n)?.classList.toggle('on', c > 0);
}

/** 曲の音 1 つ。vis は鍵の印（0 = まだ・1 = 出している・2 = 消した） */
interface Note {
  id: number;
  n: number;
  vis: 0 | 1 | 2;
}
interface Ev {
  b: number;
  on: boolean;
  x: Note;
}
interface Play {
  ev: Ev[];
  i: number;
  tm: TempoMap;
  at0: number;
  tau0: number;
  spb: number;
  /** 予約を済ませた先の AudioContext の時刻 */
  until: number;
  last: number;
  timer: ReturnType<typeof setInterval>;
  piece: Piece;
}
let PL: Play | null = null;
const cache = new Map<string, PieceData>();
const spbOf = (pc: Piece) => 60 / (pc.bpm * (tempo / 100));
const tempoOf = (d: PieceData) => new TempoMap(d.tempo);
const endOf = (d: PieceData) => Math.max(...d.notes.map((x) => x.t + x.d));
/** 拍の順。同じ拍では 終わり → 始まり の順 */
const byBeat = (a: Ev, b: Ev) => a.b - b.b || +a.on - +b.on;
/** 曲の出来事（音の始まりと終わり）。同じ高さの音を続けて弾くときに間があくよう、終わりを少し早める */
function eventsOf(d: PieceData): Ev[] {
  const ev: Ev[] = [];
  d.notes.forEach((y, id) => {
    const x: Note = { id, n: y.n, vis: 0 };
    ev.push({ b: y.t, on: true, x }, { b: y.t + Math.max(y.d * 0.95, y.d - 0.06), on: false, x });
  });
  return ev.sort(byBeat);
}
/** 拍 b の AudioContext の時刻 */
const atOf = (p: Play, b: number) => p.at0 + (p.tm.tau(b) - p.tau0) * p.spb;
/** AudioContext の時刻 an での曲の拍（鳴り始める前は、弾き始める位置） */
const beatOf = (p: Play, an: number) => p.tm.beat(p.tau0 + Math.max(0, an - p.at0) / p.spb);
/** 曲を読み込む（読み込んだ曲は覚えておく。読めなければ null） */
async function loadPiece(pc: Piece): Promise<PieceData | null> {
  let d = cache.get(pc.v);
  if (!d) {
    try {
      d = await pc.load();
    } catch {
      return null;
    }
    cache.set(pc.v, d);
  }
  return d;
}
function lineOf(pc: Piece, d: PieceData): Line {
  const tm = tempoOf(d);
  return evenLine({ bar: pc.bar, pickup: pc.pickup, end: endOf(d), sec: (b) => (tm.tau(b) * 60) / pc.bpm });
}
/** 選んだ曲を読み込んで、演奏の位置の欄に小節を描く */
async function showLine(): Promise<void> {
  const pc = pieceOf(piece.value);
  transport.setLine(null);
  const d = await loadPiece(pc);
  if (piece.value !== pc.v) return;
  if (d) transport.setLine(lineOf(pc, d));
  else plMsg('曲を読み込めませんでした');
}
/** 途中から弾くときに、弾き始める拍より前でも含める音の拍（小節の頭の直前の短い音） */
const EARLY = 0.05;
const AHEAD = 0.3;
/** 拍 b0 から演奏する。その拍で伸ばしている音は、その拍で弾き直す */
async function startPiece(b0: number): Promise<void> {
  const ok = await audio.ready();
  if (!ok) {
    plMsg(NO_SOUND);
    return;
  }
  plMsg('');
  const pc = pieceOf(piece.value),
    d = await loadPiece(pc);
  if (!d) {
    plMsg('曲を読み込めませんでした');
    return;
  }
  if (PL || piece.value !== pc.v) return;
  const all = eventsOf(d),
    i0 = all.findIndex((e) => e.b >= b0 - EARLY),
    i = i0 < 0 ? all.length : i0,
    rest = all.slice(i),
    ends = new Map<Note, number>(),
    now = audio.now() ?? 0,
    tm = tempoOf(d);
  for (const e of rest) if (!e.on) ends.set(e.x, e.b);
  for (const e of all.slice(0, i)) if (e.on && (ends.get(e.x) ?? 0) > b0 + 1e-6) rest.push({ ...e, b: b0 });
  audio.song = true;
  PL = {
    ev: rest.sort(byBeat),
    i: 0,
    tm,
    at0: now + 0.15,
    tau0: tm.tau(b0),
    spb: spbOf(pc),
    until: now + AHEAD,
    last: endOf(d),
    timer: setInterval(tick, 40),
    piece: pc,
  };
  transport.sync();
  tick();
}
function stopPiece(): void {
  if (!PL) return;
  clearInterval(PL.timer);
  PL = null;
  audio.stop();
  audio.song = false;
  audio.idle();
  lit.clear();
  /* MIDI で押している鍵の印は残す */
  for (const n of midiHeld) lit.set(n, 1);
  litKeys();
  transport.sync();
}
/** 一時停止: 演奏を止めて、鳴っている音を離す（その間も鍵盤で弾ける）。止めた拍を返す */
function pausePiece(): number {
  const p = PL;
  if (!p) return 0;
  const beat = Math.min(p.last, beatOf(p, audio.now() ?? p.at0));
  stopPiece();
  return beat;
}
const nowS = () => performance.now() / 1000;
const later = (t: number, fn: () => void) => setTimeout(fn, Math.max(0, (t - nowS()) * 1000));
function tick(): void {
  const p = PL;
  if (!p) return;
  const an = audio.now();
  if (an === null) return;
  /* 画面が隠れている間は、タイマーが間引かれるぶん先まで予約する */
  const ahead = lookahead(AHEAD);
  /* タイマーが止まっていた間に過ぎた分は、後ろへずらして続きから弾く（遅れた音をまとめて鳴らさない） */
  if (an > p.until) p.at0 += an - p.until;
  p.until = Math.max(p.until, an + ahead);
  const spb = spbOf(p.piece);
  if (spb !== p.spb) {
    p.tau0 += Math.max(0, an - p.at0) / p.spb;
    p.at0 = Math.max(an, p.at0);
    p.spb = spb;
  }
  const toPerf = (a: number) => nowS() + (a - an);
  while (p.i < p.ev.length && atOf(p, p.ev[p.i].b) < an + ahead) {
    const e = p.ev[p.i++],
      at = Math.max(an, atOf(p, e.b)),
      x = e.x;
    if (e.on) {
      audio.on(x.id, noteHz(x.n), at);
      later(toPerf(at), () => {
        if (PL !== p || x.vis) return;
        x.vis = 1;
        light(x.n, true);
      });
    } else {
      audio.off(x.id, at);
      later(toPerf(at), () => {
        if (PL !== p || x.vis !== 1) return;
        x.vis = 2;
        light(x.n, false);
      });
    }
  }
  const beat = beatOf(p, an);
  transport.setPos(Math.min(beat, p.last));
  if (p.i >= p.ev.length && beat > p.last + 1) {
    stopPiece();
    transport.stopped(true);
  }
}
const transport = new Transport({
  active: () => !!PL,
  start: startPiece,
  stop: stopPiece,
  pause: pausePiece,
  tempo: () => tempo,
});
new ParamGroup<PlayKey>([TEMPO], (v, k) => {
  tempo = v.tempo;
  if (k) transport.refresh();
});
autoPause(audio, { pause: () => transport.pause(), hidden: tick });
/* ブラウザや OS が AudioContext を止めたら、再生ボタンの音も止める */
{
  const lost = audio.onLost;
  audio.onLost = () => {
    lost?.();
    if (!audio.latch) return;
    audio.latch = false;
    syncSnd();
  };
}

/* ---------- MIDI ---------- */
/*
 * 曲の音と同じ仕組みで、押している間だけ鳴らす（和音も弾ける。曲とあわせて同時に 32 音まで）。
 * ベロシティとペダルは使わない。図と計算結果は、最後に押した音の高さにする
 */
const midiHeld = new Set<number>();
/** MIDI の音の id（曲の音の id は 0 以上） */
const midiId = (n: number) => -1 - n;
let midiPick = -1;
function midiOn(n: number, vel: number): void {
  midiBox.show(noteName(n), vel, '');
  if (midiHeld.has(n)) return;
  midiHeld.add(n);
  light(n, true);
  const play = () => midiHeld.has(n) && audio.on(midiId(n), noteHz(n), 0);
  if (audio.now() !== null) play();
  else void audio.ready().then((ok) => ok && play());
  /* 図は 1 フレームに 1 回だけ描き直す（和音で続けて押したとき） */
  if (midiPick < 0)
    requestAnimationFrame(() => {
      pick(midiPick);
      midiPick = -1;
    });
  midiPick = n;
}
function midiOff(n: number): void {
  if (!midiHeld.delete(n)) return;
  light(n, false);
  audio.off(midiId(n), 0);
}
const midiBox = new MidiBox(
  { on: midiOn, off: midiOff },
  {
    ready: () => {
      audio.midi = true;
      return audio.ready();
    },
    stopped: () => {
      audio.midi = false;
      audio.idle();
    },
  },
);

/* ---------- 起動 ---------- */
syncKb();
/* 生成時に 1 回目の onChange で音量を送る */
new ParamGroup<Key>([VOL], (v) => audio.vol(v.vol));
update();
showView();
void showLine();

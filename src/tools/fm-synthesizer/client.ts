/**
 * FMシンセサイザのページ: パートの一覧（鍵盤・波形・アルゴリズム・エンベロープ・音量）とサイドバー（音色の編集）、
 * 同梱の曲と MIDI ファイルの演奏、MIDI 機器の入力。音は audio.ts → worklet.ts（engine.ts の Synth）で鳴らす。
 * 一覧の図は、鳴らした出来事を画面の側でも覚えておき、engine.ts と同じ式（envAt・snapshot）で描く
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { MidiBox } from '../../lib/midi';
import { ParamGroup } from '../../lib/param';
import { autoPause, lookahead } from '../../lib/pause';
import { outVol, type PlayKey, TEMPO } from '../../lib/play';
import { addRow, mark } from '../../lib/reset';
import { reverbSpec, roomOf } from '../../lib/reverb';
import { forget, store, stored } from '../../lib/store';
import { TempoMap } from '../../lib/tempo';
import { initToolPage } from '../../lib/tool-page';
import { type Line, Transport, tableLine } from '../../lib/transport';
import { noteName } from '../fm-synth/params';
import { SynthAudio } from './audio';
import {
  type AlgLive,
  algSvg,
  bindAlg,
  drawEnv,
  drawKeys,
  drawPads,
  envMini,
  fitCanvas,
  keyAt,
  liveAlg,
  mainCarrier,
  padAt,
} from './draw';
import { DRUM_PART, envAt, isCarrier, type Op, REV0, snapshot, type Tone, VOL0, velGain } from './engine';
import { DRUM_HI, DRUM_LO, DRUM_NAMES, familyOf, GM_NAMES, PADS, padOf } from './gm';
import { PAD_ICONS } from './icons';
import { BEND, CC, OFF, ON, PC, parseSmf, type Smf, type SmfEv } from './smf';
import { songOf } from './songs';
import { DRUM_DEFAULT, DRUM_TONES, GM_TONES } from './tones';

initToolPage();

const audio = new SynthAudio();
const NO_SOUND = '音を出せませんでした。';
const nowS = () => performance.now() / 1000;
const css = (el: Element, k: string) => getComputedStyle(el).getPropertyValue(k).trim();
const minus = (s: string) => s.replace(/^-/, '−');

/* ---------- 音色の表（直した音色はブラウザに保存する） ---------- */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 保存した音色を読む（形が違えば捨てる） */
function loaded(k: string, def: Tone): Tone {
  const v = stored(k) as Tone | undefined;
  const ok =
    !!v &&
    typeof v === 'object' &&
    Number.isInteger(v.alg) &&
    v.alg >= 0 &&
    v.alg <= 7 &&
    Number.isInteger(v.fb) &&
    Array.isArray(v.ops) &&
    v.ops.length === 4 &&
    v.ops.every((o) =>
      ['r', 'i', 'l', 'ar', 'dr', 'sl', 'rr', 'vs', 'ks'].every((f) => Number.isFinite((o as never)[f])),
    ) &&
    !!v.lfo &&
    ['rate', 'vib', 'trem', 'delay'].every((f) => Number.isFinite((v.lfo as never)[f])) &&
    Number.isFinite(v.gain);
  if (!ok) {
    if (v !== undefined) forget(k);
    return def;
  }
  return { ...v, key: def.key };
}
const gm: Tone[] = GM_TONES.map((t, p) => loaded(`gm${p}`, t));
const drums = new Map<number, Tone>();
for (let n = DRUM_LO; n <= DRUM_HI; n++) drums.set(n, loaded(`dr${n}`, DRUM_TONES[n] ?? DRUM_DEFAULT));
for (const [p, t] of gm.entries()) if (t !== GM_TONES[p]) audio.gm(p, t);
for (const [n, t] of drums) if (t !== DRUM_TONES[n]) audio.drum(n, t);
const drumTone = (n: number) => drums.get(n) ?? DRUM_DEFAULT;

/* ---------- パート ---------- */
interface Part {
  ch: number;
  prog: number;
  /** 画面の音量 [dB]・定位（−1〜1）・残響へ送る量（0〜1）・ミュート */
  vol: number;
  pan: number;
  rev: number;
  mute: boolean;
  /** 押している音（ノート → ベロシティ 0〜1） */
  down: Map<number, number>;
  /** 離したがダンパーペダルで延ばしている音 */
  pend: Set<number>;
  /** 最後に鳴り始めた音（t0 は鳴り始めた時刻、off は離した時刻 [s]、performance.now の秒） */
  last: { note: number; vel: number; t0: number; off: number } | null;
  /** パッドごとに最後に鳴った時刻 */
  hits: Float64Array;
  sus: boolean;
  /** MIDI の音量（7）・エクスプレッション（11）は 0〜127、ピッチベンドは −1〜1 */
  cc7: number;
  cc11: number;
  bend: number;
  row: Row;
}
interface Row {
  el: HTMLElement;
  mute: HTMLButtonElement;
  nm: HTMLElement;
  sub: HTMLElement;
  kb: HTMLCanvasElement;
  ctl: HTMLElement[];
  wv: HTMLCanvasElement;
  alg: SVGSVGElement;
  ev: HTMLCanvasElement;
  vm: HTMLElement;
  /** 描いたアルゴリズムと、その動かす部品・描き直しが要るか */
  algDrawn: string;
  algLive: AlgLive | null;
  dirty: boolean;
}
const parts = new Map<number, Part>();
const rowsEl = $('#rows');
let sel = 0;

const partName = (p: Part) => (p.ch === DRUM_PART ? '打楽器' : GM_NAMES[p.prog]);

/** 保存したパートの音量・定位・残響へ送る量 */
function partStore(ch: number): [number, number, number] {
  const v = stored(`pt${ch}`);
  if (!Array.isArray(v) || !v.every(Number.isFinite)) return [0, 0, REV0];
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? REV0];
}
const sendPart = (p: Part) => audio.part(p.ch, p.vol, p.pan, p.mute, p.rev);

function ensure(ch: number): Part {
  const had = parts.get(ch);
  if (had) return had;
  const el = document.createElement('div');
  el.className = `fy-row${ch === DRUM_PART ? '' : ` c${ch % 8}`}`;
  el.setAttribute('role', 'option');
  el.tabIndex = -1;
  el.dataset.ch = String(ch);
  el.innerHTML =
    '<button type="button" class="fy-mute" aria-pressed="false"></button>' +
    '<div class="fy-nm"><b><i></i><em></em><span></span></b><small></small></div>' +
    '<div class="fy-kbw"><canvas class="kb"></canvas><div class="fy-ctl">' +
    '<span title="ボリューム"><i></i></span><span title="エクスプレッション"><i></i></span>' +
    '<span class="bd" title="ピッチベンド"><i></i></span></div></div>' +
    '<div class="fy-vm" title="音量"><i></i></div><canvas class="cv c-w"></canvas>' +
    '<svg class="alg" viewBox="0 0 72 44" aria-hidden="true"></svg><canvas class="cv c-e"></canvas>';
  const row: Row = {
    el,
    mute: $<HTMLButtonElement>('.fy-mute', el),
    nm: $('b span', el),
    sub: $('small', el),
    kb: $<HTMLCanvasElement>('.kb', el),
    ctl: $$<HTMLElement>('.fy-ctl i', el),
    wv: $<HTMLCanvasElement>('.c-w', el),
    alg: $<SVGSVGElement>('svg.alg', el),
    ev: $<HTMLCanvasElement>('.c-e', el),
    vm: $('.fy-vm i', el),
    algDrawn: '',
    algLive: null,
    dirty: true,
  };
  $('b em', el).textContent = String(ch + 1);
  const [vol, pan, rev] = partStore(ch);
  const p: Part = {
    ch,
    prog: 0,
    vol,
    pan,
    rev,
    mute: false,
    down: new Map(),
    pend: new Set(),
    last: null,
    hits: new Float64Array(PADS.length).fill(-1e9),
    sus: false,
    cc7: 100,
    cc11: 127,
    bend: 0,
    row,
  };
  parts.set(ch, p);
  sendPart(p);
  /* チャンネルの順に並べる */
  const after = [...rowsEl.children].find((c) => Number((c as HTMLElement).dataset.ch) > ch);
  rowsEl.insertBefore(el, after ?? null);
  /* 選んでいるパートを押すとサイドバーを開閉し、ほかのパートを押すと選ぶだけ（鍵盤とパッドを押したときは開閉しない） */
  el.addEventListener('click', (e) => {
    if (ch === sel && !(e.target as Element).closest('.kb')) $('#hd-side').click();
    else if (ch !== sel) select(ch);
  });
  row.mute.addEventListener('click', (e) => {
    e.stopPropagation();
    p.mute = !p.mute;
    sendPart(p);
    syncMute(p);
  });
  /* 右クリック: そのパートだけを鳴らす（ソロ）。すでにそのパートだけが鳴っていれば、全パートのミュートを解く */
  row.mute.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const alone = !p.mute && [...parts.values()].every((q) => q === p || q.mute);
    for (const q of parts.values()) {
      const m = alone ? false : q !== p;
      if (q.mute === m) continue;
      q.mute = m;
      sendPart(q);
      syncMute(q);
    }
  });
  syncMute(p);
  bindPlay(p);
  label(p);
  return p;
}
function syncMute(p: Part): void {
  const b = p.row.mute,
    t = `${p.ch + 1} チャンネル: ${p.mute ? 'オフ（押すとオン' : 'オン（押すとオフ'}、右クリックでこのパートだけ）`;
  b.setAttribute('aria-pressed', String(p.mute));
  b.title = t;
  b.setAttribute('aria-label', t);
  p.row.el.classList.toggle('muted', p.mute);
}

/** 行の名前と、GM の番号と系統 */
function label(p: Part): void {
  p.row.nm.textContent = partName(p);
  p.row.sub.textContent = p.ch === DRUM_PART ? 'GM の打楽器' : `GM ${p.prog + 1}・${familyOf(p.prog)}`;
  p.row.dirty = true;
}

/** 曲のチャンネルに合わせて行を並べ直す（MIDI 機器で足した行も消す） */
function setRows(chans: readonly number[], progs: Map<number, number>): void {
  for (const [ch, p] of parts)
    if (!chans.includes(ch)) {
      p.row.el.remove();
      parts.delete(ch);
    }
  for (const ch of chans) {
    const p = ensure(ch);
    setProg(p, progs.get(ch) ?? 0);
  }
  if (!parts.has(sel)) sel = chans[0] ?? 0;
  select(sel);
}

/** パートの GM の番号を替える（音にも送る） */
function setProg(p: Part, prog: number): void {
  if (p.ch === DRUM_PART) return;
  p.prog = prog;
  audio.prog(p.ch, prog);
  label(p);
  if (p.ch === sel) side();
}

/* ---------- 一覧の図に使う出来事 ---------- */
function vOn(ch: number, note: number, vel: number): void {
  const p = parts.get(ch);
  if (!p) return;
  const t = nowS();
  p.down.set(note, vel);
  p.pend.delete(note);
  p.last = { note, vel, t0: t, off: Number.POSITIVE_INFINITY };
  if (ch === DRUM_PART) {
    const i = padOf(note);
    if (i >= 0) p.hits[i] = t;
  }
  p.row.dirty = true;
  wake();
}
function vOff(ch: number, note: number): void {
  const p = parts.get(ch);
  if (!p?.down.has(note)) return;
  p.down.delete(note);
  p.row.dirty = true;
  if (ch === DRUM_PART) return;
  /* ダンパーペダルの間は延ばしている音として残す */
  if (p.sus) p.pend.add(note);
  else if (p.last && p.last.note === note) p.last.off = nowS();
}
function vCc(ch: number, num: number, v: number): void {
  const p = parts.get(ch);
  if (!p) return;
  if (num === 7) p.cc7 = v;
  else if (num === 11) p.cc11 = v;
  else if (num === 121) {
    p.cc7 = 100;
    p.cc11 = 127;
    p.bend = 0;
    p.sus = false;
    p.pend.clear();
  } else if (num === 64) {
    p.sus = v >= 64;
    if (!p.sus) {
      if (p.last && p.pend.has(p.last.note)) p.last.off = nowS();
      p.pend.clear();
    }
  }
  p.row.dirty = true;
  wake();
}
function vBend(ch: number, v: number): void {
  const p = parts.get(ch);
  if (!p) return;
  p.bend = v;
  p.row.dirty = true;
  wake();
}
function vAll(): void {
  const t = nowS();
  for (const p of parts.values()) {
    p.down.clear();
    p.pend.clear();
    p.sus = false;
    if (p.last && p.last.off > t) p.last.off = t;
    p.row.dirty = true;
  }
  wake();
}

/* ---------- 描画 ---------- */
let raf = 0;
/** サイドバーの大きな波形を描き直すか */
let sideDirty = true;
function wake(): void {
  if (!raf) raf = requestAnimationFrame(frame);
}
/** 鳴っている（減衰の途中を含む）か */
function busy(p: Part, t: number): boolean {
  if (p.down.size || p.pend.size) return true;
  const l = p.last;
  if (!l) return false;
  const tone = p.ch === DRUM_PART ? drumTone(l.note) : gm[p.prog],
    c = mainCarrier(tone),
    hold = p.ch === DRUM_PART ? Number.POSITIVE_INFINITY : l.off - l.t0;
  return envAt(tone.ops[c], t - l.t0, hold, tone.key ?? l.note) > 1e-3 || t - l.t0 < 0.3;
}
interface Colors {
  white: string;
  black: string;
  down: string;
  sus: string;
  line2: string;
  ink2: string;
  grid: string;
  faint: string;
  surface: string;
}
function frame(): void {
  raf = 0;
  const t = nowS(),
    root = document.documentElement,
    list = $('.fy-list'),
    colors: Colors = {
      white: css(list, '--fy-kw') || '#fff',
      black: css(list, '--fy-kb') || '#000',
      down: css(list, '--fy-down') || '#d0342c',
      sus: css(list, '--fy-sus') || '#2f6fd0',
      line2: css(root, '--line-2') || '#999',
      ink2: css(root, '--ink-2') || '#444',
      grid: css(root, '--grid') || '#ddd',
      faint: css(root, '--grid-2') || '#aaa',
      surface: css(root, '--surface') || '#fff',
    };
  let more = false;
  for (const p of parts.values()) {
    const b = busy(p, t);
    if (b) more = true;
    if (b || p.row.dirty) drawRow(p, t, colors);
  }
  if (sideOpen('op')) drawSideEnv(t);
  const sp = parts.get(sel);
  if (sp && (busy(sp, t) || sideDirty)) {
    sideDirty = false;
    drawSideWave(t, colors.grid);
    sideWork(t);
  }
  if (more || PL) wake();
}
/** パッドを塗っておく時間 [s] */
const PAD_LIT = 0.12;
/** 音を出している（鍵を押している）か。打楽器は叩いた直後の短い間 */
function sounding(p: Part, t: number): boolean {
  if (p.ch !== DRUM_PART) return p.down.size > 0;
  for (const h of p.hits) if (t - h < PAD_LIT) return true;
  return false;
}
function drawRow(p: Part, t: number, c: Colors): void {
  const r = p.row,
    col = css(r.el, '--pc') || c.ink2,
    l = p.last,
    drum = p.ch === DRUM_PART,
    tone = drum ? drumTone(l?.note ?? 36) : gm[p.prog],
    pitch = tone.key ?? l?.note ?? 60,
    hold = l ? (drum ? Number.POSITIVE_INFINITY : l.off - l.t0) : 0,
    age = l ? t - l.t0 : 0;
  r.dirty = false;
  r.mute.classList.toggle('on', sounding(p, t));
  /* 鍵盤かパッド */
  {
    const [g, w, h] = fitCanvas(r.kb);
    if (drum)
      drawPads(
        g,
        w,
        h,
        PADS.map((_, i) => t - p.hits[i] < PAD_LIT),
        /* 鳴ったパッドはパートの色で塗り、アイコンを白で抜く */
        { face: c.surface, edge: c.line2, ink: c.ink2, on: col, onInk: '#ffffff' },
      );
    else drawKeys(g, w, h, p.down.keys(), p.pend, { white: c.white, black: c.black, down: c.down, sus: c.sus });
  }
  /* 鍵盤の下の小さなバー: 音量・エクスプレッション・ピッチベンド（中央から左右へ） */
  r.ctl[0].style.width = `${((p.cc7 / 127) * 100).toFixed(1)}%`;
  r.ctl[1].style.width = `${((p.cc11 / 127) * 100).toFixed(1)}%`;
  r.ctl[2].style.left = `${(50 + Math.min(0, p.bend) * 50).toFixed(1)}%`;
  r.ctl[2].style.width = `${(Math.abs(p.bend) * 50).toFixed(1)}%`;
  /* 波形: 最後に鳴り始めた音の 2 周期 */
  drawWave(r.wv, p, t, c.grid, col, 2);
  /* アルゴリズム */
  const key = `${tone.alg}|${col}`;
  if (r.algDrawn !== key) {
    r.algDrawn = key;
    r.alg.innerHTML = algSvg(tone.alg, col, 72, 44);
    r.algLive = bindAlg(r.alg, false);
  }
  if (r.algLive) {
    const [lv, mod] = algWork(tone, l ? age : null, hold, pitch);
    liveAlg(r.algLive, lv, mod);
  }
  /* エンベロープ: 音量の目安のキャリア */
  const mc = mainCarrier(tone);
  {
    const [g, w, h] = fitCanvas(r.ev);
    drawEnv(
      g,
      w,
      h,
      tone.ops[mc],
      col,
      2,
      l ? age : null,
      hold,
      pitch,
      tone.ops.filter((_, k) => k !== mc),
      c.faint,
    );
  }
  /* 音量のメーター */
  const lv = l ? envAt(tone.ops[mc], age, hold, pitch) * velGain(tone.ops[mc].vs, l.vel) : 0;
  r.vm.style.height = `${Math.round(Math.min(1, lv) * 100)}%`;
}
/**
 * 結線図に重ねる働き: オペレータごとのエンベロープの大きさと、モジュレータの変調指数の目安（6 rad で 1）。
 * t は鳴り始めからの時間（鳴らしていなければ null）
 */
function algWork(tone: Tone, t: number | null, hold: number, pitch: number): [number[], number[]] {
  const lv = tone.ops.map((o) => (t === null ? 0 : envAt(o, t, hold, pitch))),
    mod = tone.ops.map((o, k) => (isCarrier(tone.alg, k) ? 0 : Math.min(1, o.i / 6)));
  return [lv, mod];
}
/** サイドバーの大きな結線図の動かす部品 */
let sideAlg: AlgLive | null = null;
/** パートの最後に鳴り始めた音の波形を periods 周期ぶん描く（その時刻のエンベロープを掛ける） */
function drawWave(cv: HTMLCanvasElement, p: Part, t: number, grid: string, col: string, periods: number): void {
  const [g, w, h] = fitCanvas(cv),
    l = p.last;
  g.fillStyle = grid;
  g.fillRect(0, h / 2, w, 1);
  if (!l) return;
  const drum = p.ch === DRUM_PART,
    tone = drum ? drumTone(l.note) : gm[p.prog],
    n = Math.max(64, Math.round((w * 1.5) / periods)),
    y = snapshot(tone, t - l.t0, drum ? Number.POSITIVE_INFINITY : l.off - l.t0, l.vel, tone.key ?? l.note, periods, n),
    full = fullScale(tone);
  g.strokeStyle = col;
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < y.length; i++) {
    const x = (i / (y.length - 1)) * w,
      v = h / 2 - Math.max(-1, Math.min(1, y[i] / full)) * (h / 2 - 3);
    if (i) g.lineTo(x, v);
    else g.moveTo(x, v);
  }
  g.stroke();
}
/** サイドバーの大きな結線図に、選んだパートの働きを重ねる（直している音色の図に、最後に鳴った音のエンベロープ） */
function sideWork(t: number): void {
  const p = parts.get(sel);
  if (!p || !sideAlg) return;
  const l = p.last,
    drum = p.ch === DRUM_PART,
    tone = editing().tone,
    show = !!l && (!drum || l.note === editNote),
    [lv, mod] = algWork(
      tone,
      show && l ? t - l.t0 : null,
      l && !drum ? l.off - l.t0 : Number.POSITIVE_INFINITY,
      tone.key ?? l?.note ?? 60,
    );
  liveAlg(sideAlg, lv, mod);
}
/** サイドバーの大きな波形（選んだパート） */
function drawSideWave(t: number, grid: string): void {
  const p = parts.get(sel);
  if (p) drawWave($<HTMLCanvasElement>('#s-wave'), p, t, grid, css(p.row.el, '--pc') || '#888', 4);
}
/** 波形の表示でフルスケールにする大きさ（キャリアの出力レベルの和） */
function fullScale(t: Tone): number {
  let s = 0;
  for (let k = 0; k < 4; k++) if (isCarrier(t.alg, k)) s += 10 ** (t.ops[k].l / 20);
  return Math.max(1e-6, s * 10 ** (t.gain / 20));
}

/* ---------- 手で弾く（行の鍵盤とパッド） ---------- */
function bindPlay(p: Part): void {
  const c = p.row.kb;
  let cur = -1;
  const up = () => {
    if (cur < 0) return;
    audio.ev({ k: OFF, ch: p.ch, a: cur, v: 0 }, 0, 1);
    vOff(p.ch, cur);
    cur = -1;
    audio.hand = false;
    audio.idle();
  };
  c.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = c.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top;
    let n: number;
    if (p.ch === DRUM_PART) {
      const i = padAt(x, y, r.width, r.height);
      if (i < 0) return;
      n = PADS[i].notes.includes(editNote) ? editNote : PADS[i].notes[PADS[i].notes.length > 1 ? 1 : 0];
      editNote = n;
    } else n = keyAt(x, y, r.width, r.height);
    c.setPointerCapture(e.pointerId);
    cur = n;
    audio.hand = true;
    void audio.ready().then((ok) => {
      if (!ok) plMsg(NO_SOUND);
      else if (cur === n) audio.ev({ k: ON, ch: p.ch, a: n, v: 100 }, 0, 1);
    });
    vOn(p.ch, n, 100 / 127);
  });
  /* 押したまま動かすと、別の鍵（パッド）に移ったところで前の音を離して新しい音を鳴らす */
  c.addEventListener('pointermove', (e) => {
    if (cur < 0 || !c.hasPointerCapture(e.pointerId)) return;
    const r = c.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = Math.min(r.height - 1, Math.max(0, e.clientY - r.top));
    let n: number;
    if (p.ch === DRUM_PART) {
      const i = padAt(x, y, r.width, r.height);
      if (i < 0) return;
      n = PADS[i].notes.includes(editNote) ? editNote : PADS[i].notes[PADS[i].notes.length > 1 ? 1 : 0];
    } else n = keyAt(Math.min(r.width - 1, Math.max(0, x)), y, r.width, r.height);
    if (n === cur) return;
    audio.ev({ k: OFF, ch: p.ch, a: cur, v: 0 }, 0, 1);
    vOff(p.ch, cur);
    cur = n;
    if (p.ch === DRUM_PART) editNote = n;
    audio.ev({ k: ON, ch: p.ch, a: n, v: 100 }, 0, 1);
    vOn(p.ch, n, 100 / 127);
  });
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
}

/* ---------- サイドバー ---------- */
const sideTitle = $('#hd-side');
const groups = new Map($$<HTMLElement>('.grp').map((g) => [g.dataset.g as string, g]));
const sideOpen = (g: string) => !groups.get(g)?.classList.contains('shut');
for (const [k, g] of groups) {
  const h = $<HTMLButtonElement>('.fy-gh', g),
    set = (open: boolean) => {
      g.classList.toggle('shut', !open);
      h.setAttribute('aria-expanded', String(open));
    };
  if (stored(`g:${k}`) === false) set(false);
  h.addEventListener('click', () => {
    const open = g.classList.contains('shut');
    set(open);
    if (open) forget(`g:${k}`);
    else store(`g:${k}`, false);
    side();
  });
}
/** 打楽器で直している音 */
let editNote = 36;
let selOp = 0;
const RATIOS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** サイドバーで直している音色と、その既定値 */
function editing(): { tone: Tone; def: Tone; save: (t: Tone) => void } {
  const p = parts.get(sel);
  if (p && p.ch === DRUM_PART) {
    const n = editNote;
    return {
      tone: drumTone(n),
      def: DRUM_TONES[n] ?? DRUM_DEFAULT,
      save: (t) => {
        drums.set(n, t);
        audio.drum(n, t);
        if (same(t, DRUM_TONES[n])) forget(`dr${n}`);
        else store(`dr${n}`, t);
      },
    };
  }
  const prog = p?.prog ?? 0;
  return {
    tone: gm[prog],
    def: GM_TONES[prog],
    save: (t) => {
      gm[prog] = t;
      audio.gm(prog, t);
      if (same(t, GM_TONES[prog])) forget(`gm${prog}`);
      else store(`gm${prog}`, t);
    },
  };
}
/** 音色を直す（写しを fn で書き換えて保存し、音と図に送る） */
function edit(fn: (t: { alg: number; fb: number; ops: Op[]; lfo: Tone['lfo'] }) => void): void {
  const e = editing(),
    t = structuredClone(e.tone) as unknown as { alg: number; fb: number; ops: Op[]; lfo: Tone['lfo'] };
  fn(t);
  e.save(t as unknown as Tone);
  for (const p of parts.values()) p.row.dirty = true;
  wake();
  side();
}

/** スライダーの行: 値と位置（0〜1000）の行き来・表示・既定値 */
interface Sl {
  id: string;
  get: (t: Tone, o: Op, p: Part | undefined) => number;
  set: (v: number) => void;
  def: (d: Tone, o: Op) => number;
  toPos: (v: number) => number;
  fromPos: (x: number) => number;
  text: (v: number) => string;
  /** 打楽器のときは使わない */
  noDrum?: boolean;
}
const lin = (lo: number, hi: number, step: number) => ({
  toPos: (v: number) => ((v - lo) / (hi - lo)) * 1000,
  fromPos: (x: number) => Math.round((lo + (x / 1000) * (hi - lo)) / step) * step,
});
const logT = (lo: number, hi: number, zero = false) => ({
  toPos: (v: number) => (zero && v <= 0 ? 0 : (Math.log(Math.max(lo, v) / lo) / Math.log(hi / lo)) * 1000),
  fromPos: (x: number) => {
    if (zero && x <= 0) return 0;
    const v = lo * (hi / lo) ** (x / 1000);
    return Number(v.toPrecision(2));
  },
});
const sec = (v: number) => (v <= 0 ? '0 ms' : v < 1 ? `${Math.round(v * 1000)} ms` : `${Number(v.toPrecision(3))} s`);
const pct = (v: number) => `${Math.round(v * 100)} %`;
const panT = (v: number) => (Math.abs(v) < 0.005 ? '中央' : `${v < 0 ? '左' : '右'} ${Math.round(Math.abs(v) * 100)}`);
const opOf = (t: Tone) => t.ops[selOp];
const carSel = () => isCarrier(editing().tone.alg, selOp);
const SL: Sl[] = [
  {
    id: 's-fb',
    get: (t) => t.fb,
    set: (v) =>
      edit((t) => {
        t.fb = v;
      }),
    def: (d) => d.fb,
    toPos: (v) => v,
    fromPos: (x) => Math.round(x),
    text: (v) => String(v),
  },
  {
    id: 's-r',
    get: (_t, o) => o.r,
    set: (v) =>
      edit((t) => {
        t.ops[selOp].r = v;
      }),
    def: (_d, o) => o.r,
    toPos: (v) => {
      let best = 0;
      for (const [i, r] of RATIOS.entries()) if (Math.abs(r - v) < Math.abs(RATIOS[best] - v)) best = i;
      return best;
    },
    fromPos: (x) => RATIOS[Math.round(x)],
    /* レビューで選んだ音色には範囲の外の比（0.0005 など）もあるので、有効数字 3 桁で出す */
    text: (v) => `×${Number(v.toPrecision(3))}`,
  },
  {
    id: 's-a',
    get: (_t, o) => (carSel() ? o.l : o.i),
    set: (v) =>
      edit((t) => {
        if (carSel()) t.ops[selOp].l = v;
        else t.ops[selOp].i = v;
      }),
    def: (_d, o) => (carSel() ? o.l : o.i),
    toPos: (v) => (carSel() ? ((v + 48) / 48) * 1000 : (v / 12) * 1000),
    fromPos: (x) => (carSel() ? Math.round(-48 + (x / 1000) * 48) : Math.round((x / 1000) * 120) / 10),
    text: (v) => (carSel() ? `${minus(String(v))} dB` : v.toFixed(1)),
  },
  {
    id: 's-ar',
    get: (_t, o) => o.ar,
    set: (v) =>
      edit((t) => {
        t.ops[selOp].ar = v;
      }),
    def: (_d, o) => o.ar,
    ...logT(0.001, 5, true),
    text: sec,
  },
  {
    id: 's-dr',
    get: (_t, o) => o.dr,
    set: (v) =>
      edit((t) => {
        t.ops[selOp].dr = v;
      }),
    def: (_d, o) => o.dr,
    ...logT(0.005, 30),
    text: sec,
  },
  {
    id: 's-sl',
    get: (_t, o) => o.sl,
    set: (v) =>
      edit((t) => {
        t.ops[selOp].sl = v;
      }),
    def: (_d, o) => o.sl,
    ...lin(0, 1, 0.01),
    text: pct,
  },
  {
    id: 's-rr',
    get: (_t, o) => o.rr,
    set: (v) =>
      edit((t) => {
        t.ops[selOp].rr = v;
      }),
    def: (_d, o) => o.rr,
    ...logT(0.005, 30),
    text: sec,
  },
  {
    id: 's-vs',
    get: (_t, o) => o.vs,
    set: (v) =>
      edit((t) => {
        t.ops[selOp].vs = v;
      }),
    def: (_d, o) => o.vs,
    ...lin(0, 1, 0.01),
    text: pct,
  },
  {
    id: 's-lr',
    get: (t) => t.lfo.rate,
    set: (v) =>
      edit((t) => {
        t.lfo.rate = v;
      }),
    def: (d) => d.lfo.rate,
    ...lin(0, 12, 0.1),
    text: (v) => `${v.toFixed(1)} Hz`,
  },
  {
    id: 's-lv',
    get: (t) => t.lfo.vib,
    set: (v) =>
      edit((t) => {
        t.lfo.vib = v;
      }),
    def: (d) => d.lfo.vib,
    ...lin(0, 100, 1),
    text: (v) => `±${Math.round(v)} ¢`,
  },
  {
    id: 's-lt',
    get: (t) => t.lfo.trem,
    set: (v) =>
      edit((t) => {
        t.lfo.trem = v;
      }),
    def: (d) => d.lfo.trem,
    ...lin(0, 12, 0.5),
    text: (v) => `${v.toFixed(1)} dB`,
  },
  {
    id: 's-ld',
    get: (t) => t.lfo.delay,
    set: (v) =>
      edit((t) => {
        t.lfo.delay = v;
      }),
    def: (d) => d.lfo.delay,
    ...lin(0, 3, 0.05),
    text: sec,
  },
  {
    id: 's-pv',
    get: (_t, _o, p) => p?.vol ?? 0,
    set: (v) => partSet(v, null, null),
    def: () => 0,
    ...lin(-40, 6, 1),
    text: (v) => `${minus(String(v))} dB`,
  },
  {
    id: 's-pp',
    get: (_t, _o, p) => p?.pan ?? 0,
    set: (v) => partSet(null, v, null),
    def: () => 0,
    ...lin(-1, 1, 0.05),
    text: panT,
  },
  {
    id: 's-pr',
    get: (_t, _o, p) => p?.rev ?? REV0,
    set: (v) => partSet(null, null, v),
    def: () => REV0,
    ...lin(0, 1, 0.01),
    text: pct,
  },
];
function partSet(vol: number | null, pan: number | null, rev: number | null): void {
  const p = parts.get(sel);
  if (!p) return;
  if (vol !== null) p.vol = vol;
  if (pan !== null) p.pan = Number(pan.toFixed(2));
  if (rev !== null) p.rev = Number(rev.toFixed(2));
  sendPart(p);
  if (p.vol || p.pan || p.rev !== REV0) store(`pt${p.ch}`, [p.vol, p.pan, p.rev]);
  else forget(`pt${p.ch}`);
  side();
}
const slEls = new Map<string, { row: HTMLElement; inp: HTMLInputElement; out: HTMLElement }>();
for (const s of SL) {
  const inp = $<HTMLInputElement>(`#${s.id}`),
    row = inp.closest('.sl') as HTMLElement;
  if (s.id === 's-fb') {
    inp.min = '0';
    inp.max = '7';
  } else if (s.id === 's-r') {
    inp.min = '0';
    inp.max = String(RATIOS.length - 1);
  } else {
    inp.min = '0';
    inp.max = '1000';
  }
  inp.step = '1';
  slEls.set(s.id, { row, inp, out: $(`#${s.id}-v`) });
  inp.addEventListener('input', () => {
    const v = s.fromPos(Number(inp.value));
    if (v !== s.get(editing().tone, opOf(editing().tone), parts.get(sel))) s.set(v);
  });
  addRow(row, {
    isMod: () => {
      const e = editing();
      return !!parts.get(sel) && !same(s.get(e.tone, opOf(e.tone), parts.get(sel)), s.def(e.def, opOf(e.def)));
    },
    reset: () => s.set(s.def(editing().def, opOf(editing().def))),
  });
}

/** サイドバーを選んだパートに合わせる */
function side(): void {
  const p = parts.get(sel),
    e = editing(),
    t = e.tone,
    drum = p?.ch === DRUM_PART,
    col = p ? css(p.row.el, '--pc') : 'var(--ink-3)';
  sideTitle.textContent = p ? `${p.ch + 1} ${partName(p)}` : '音色';
  /* 音色 */
  const gmSel = $<HTMLSelectElement>('#s-gm');
  gmSel.hidden = drum;
  ($('#s-gm').parentElement as HTMLElement).hidden = drum;
  $('#s-drum').hidden = !drum;
  if (p && !drum) gmSel.value = String(p.prog);
  if (drum) {
    const pad = Math.max(0, padOf(editNote));
    $('#s-pads').innerHTML = PADS.map(
      (x, i) =>
        `<button type="button" class="chip fy-pad" data-pad="${i}" aria-pressed="${i === pad}" title="${x.name}" aria-label="${x.name}"><svg viewBox="0 0 24 16" aria-hidden="true"><path d="${PAD_ICONS[i]}"/></svg></button>`,
    ).join('');
    $('#s-dl').innerHTML = PADS[pad].notes
      .map(
        (n) =>
          `<button type="button" data-n="${n}" aria-pressed="${n === editNote}" title="${DRUM_NAMES[n]}"><small>${n}</small>${DRUM_NAMES[n]}</button>`,
      )
      .join('');
  }
  $('#sum-tone').textContent = drum
    ? `${PADS[Math.max(0, padOf(editNote))].name}・${DRUM_NAMES[editNote]}`
    : p
      ? `${p.prog + 1} ${GM_NAMES[p.prog]}`
      : '';
  /* アルゴリズム */
  for (const b of $$<HTMLButtonElement>('#s-algc .chip'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.a) === t.alg));
  $('#s-alg').innerHTML = algSvg(t.alg, col, 118, 64, true);
  sideAlg = bindAlg($<SVGSVGElement>('#s-alg'), true);
  $('#sum-alg').innerHTML =
    `<svg width="40" height="24" viewBox="0 0 72 44" aria-hidden="true">${algSvg(t.alg, col, 72, 44)}</svg>${t.alg}・帰還量 ${t.fb}`;
  /* オペレータ */
  for (const b of $$<HTMLButtonElement>('#s-opt button'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.o) === selOp));
  const car = isCarrier(t.alg, selOp);
  $('#s-role').textContent = car ? 'キャリア' : 'モジュレータ';
  $('#s-a-l').textContent = car ? '出力レベル' : '変調指数';
  for (const b of $$<HTMLButtonElement>('#s-w button'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.w) === (t.ops[selOp].w ?? 0)));
  $('#sum-op').innerHTML = t.ops.map((o, k) => envMini(o, isCarrier(t.alg, k) ? col : 'var(--ink-3)')).join('');
  $('#sum-lfo').textContent = `${t.lfo.rate.toFixed(1)} Hz・±${Math.round(t.lfo.vib)} ¢・${t.lfo.trem.toFixed(1)} dB`;
  $('#sum-part').textContent = p ? `${minus(String(p.vol))} dB・${panT(p.pan)}・残響 ${pct(p.rev)}` : '';
  for (const s of SL) {
    const x = slEls.get(s.id);
    if (!x) continue;
    const v = s.get(t, opOf(t), p);
    if (document.activeElement !== x.inp) x.inp.value = String(s.toPos(v));
    x.out.textContent = s.text(v);
  }
  mark();
  drawSideEnv(nowS());
}
function drawSideEnv(t: number): void {
  if (!sideOpen('op')) return;
  const p = parts.get(sel),
    tone = editing().tone,
    col = p ? css(p.row.el, '--pc') : '#888',
    grid = css(document.documentElement, '--grid-2') || '#999',
    [g, w, h] = fitCanvas($<HTMLCanvasElement>('#s-env'));
  const l = p?.last,
    drum = p?.ch === DRUM_PART,
    showDot = !!l && (!drum || l.note === editNote);
  drawEnv(
    g,
    w,
    h,
    tone.ops[selOp],
    col,
    2,
    showDot && l ? t - l.t0 : null,
    l && !drum ? l.off - l.t0 : Number.POSITIVE_INFINITY,
    tone.key ?? l?.note ?? 60,
    tone.ops.filter((_, k) => k !== selOp),
    grid,
  );
}
function select(ch: number): void {
  sel = ch;
  sideDirty = true;
  wake();
  for (const p of parts.values()) p.row.el.setAttribute('aria-selected', String(p.ch === ch));
  const p = parts.get(ch);
  if (p?.ch === DRUM_PART && p.last) editNote = p.last.note;
  side();
}
$('#s-gm').addEventListener('change', (e) => {
  const p = parts.get(sel);
  if (p) setProg(p, Number((e.target as HTMLSelectElement).value));
});
$('#s-pads').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-pad]');
  if (!b) return;
  editNote = PADS[Number(b.dataset.pad)].notes[0];
  side();
});
$('#s-dl').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-n]');
  if (!b) return;
  editNote = Number(b.dataset.n);
  side();
});
$('#s-algc').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-a]');
  if (!b) return;
  edit((t) => {
    t.alg = Number(b.dataset.a);
  });
});
$('#s-w').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-w]');
  if (!b) return;
  const w = Number(b.dataset.w);
  edit((t) => {
    t.ops[selOp].w = w;
  });
});
/* 波形の行の ↺: 選んでいるオペレータの波形を既定値に戻す */
addRow($('#s-w').closest('.sl') as HTMLElement, {
  isMod: () => !!parts.get(sel) && (editing().tone.ops[selOp].w ?? 0) !== (editing().def.ops[selOp].w ?? 0),
  reset: () => {
    const w = editing().def.ops[selOp].w ?? 0;
    edit((t) => {
      t.ops[selOp].w = w;
    });
  },
});
$('#s-opt').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-o]');
  if (!b) return;
  selOp = Number(b.dataset.o);
  side();
});

/* ---------- 曲 ---------- */
const plMsg = (s: string) => {
  const el = $('#pl-msg');
  if (el.textContent !== s) el.textContent = s;
};
const songSel = $<HTMLSelectElement>('#song');
const fileOpt = $<HTMLOptionElement>('#song-file');
/** 曲のデータ: 出来事・ON の終わりの拍・テンポ・小節 */
interface SongData {
  smf: Smf;
  /** ON の出来事の、対になる OFF の拍 */
  offB: Map<SmfEv, number>;
  tm: TempoMap;
  line: Line;
  progs: Map<number, number>;
}
const cache = new Map<string, SongData>();
let fileData: SongData | null = null;

function prepare(smf: Smf): SongData {
  const offB = new Map<SmfEv, number>(),
    open = new Map<number, SmfEv[]>();
  for (const e of smf.ev) {
    const key = e.ch * 128 + e.a;
    if (e.k === ON) {
      const l = open.get(key) ?? [];
      l.push(e);
      open.set(key, l);
    } else if (e.k === OFF) {
      const on = open.get(key)?.shift();
      if (on) offB.set(on, e.b);
    }
  }
  const tm = new TempoMap(smf.tempo),
    progs = new Map<number, number>();
  for (const e of smf.ev) if (e.k === PC && !progs.has(e.ch)) progs.set(e.ch, e.a);
  return {
    smf,
    offB,
    tm,
    progs,
    line: tableLine({ starts: smf.starts, end: smf.end, sec: (b) => (tm.tau(b) * 60) / smf.bpm }),
  };
}

async function loadSong(v: string): Promise<SongData | null> {
  if (v === 'file') return fileData;
  const s = songOf(v);
  if (!s) return null;
  let d = cache.get(v);
  if (!d) {
    try {
      d = prepare(parseSmf(await s.load()));
    } catch {
      return null;
    }
    cache.set(v, d);
  }
  return d;
}

/** 選んだ曲を読み込み、行と演奏の位置の欄を合わせる */
async function showSong(): Promise<void> {
  const v = songSel.value;
  transport.setLine(null);
  const d = await loadSong(v);
  if (songSel.value !== v) return;
  if (!d) {
    plMsg('曲を読み込めませんでした');
    return;
  }
  plMsg('');
  transport.setLine(d.line);
  setRows(d.smf.chans, d.progs);
}

$('#openBtn').addEventListener('click', () => $<HTMLInputElement>('#fileIn').click());
$<HTMLInputElement>('#fileIn').addEventListener('change', async (e) => {
  const inp = e.target as HTMLInputElement,
    f = inp.files?.[0];
  inp.value = '';
  if (!f) return;
  let d: SongData;
  try {
    d = prepare(parseSmf(await f.arrayBuffer()));
  } catch (err) {
    plMsg(
      err instanceof Error && err.message
        ? `${f.name} を読めませんでした。${err.message}。`
        : `${f.name} を読めませんでした。`,
    );
    return;
  }
  stopSong();
  transport.stopped(true);
  fileData = d;
  fileOpt.hidden = false;
  fileOpt.textContent = f.name;
  songSel.value = 'file';
  await showSong();
});

interface Play {
  d: SongData;
  ev: SmfEv[];
  i: number;
  at0: number;
  tau0: number;
  spb: number;
  until: number;
  timer: ReturnType<typeof setInterval>;
}
let PL: Play | null = null;
let tempo = 100;
const spbOf = (d: SongData) => 60 / (d.smf.bpm * (tempo / 100));
const atOf = (p: Play, b: number) => p.at0 + (p.d.tm.tau(b) - p.tau0) * p.spb;
const beatOf = (p: Play, an: number) => p.d.tm.beat(p.tau0 + Math.max(0, an - p.at0) / p.spb);
const AHEAD = 0.3;

async function startSong(b0: number): Promise<void> {
  if (!(await audio.ready())) {
    plMsg(NO_SOUND);
    return;
  }
  const v = songSel.value,
    d = await loadSong(v);
  if (!d) {
    plMsg('曲を読み込めませんでした');
    return;
  }
  if (PL || songSel.value !== v) return;
  plMsg('');
  const now = audio.now() ?? 0,
    start = now + 0.15,
    rest: SmfEv[] = [];
  /* 弾き始める拍より前の音色とコントローラはすぐ送り、伸ばしている音はその拍から弾く */
  for (let k = 0; k < 16; k++) {
    audio.ev({ k: CC, ch: k, a: 121, v: 0 }, 0, 0);
    vCc(k, 121, 0);
  }
  for (const e of d.smf.ev) {
    if (e.b >= b0 - 1e-6) rest.push(e);
    else if (e.k === PC || e.k === CC || e.k === BEND) {
      audio.ev(e, 0, 0);
      if (e.k === CC) vCc(e.ch, e.a, e.v);
      else if (e.k === BEND) vBend(e.ch, e.v);
      if (e.k === PC) {
        const p = parts.get(e.ch);
        if (p) setProg(p, e.a);
      }
    } else if (e.k === ON && (d.offB.get(e) ?? 0) > b0 + 1e-6)
      rest.push({ ...e, b: b0 }, { ...e, k: OFF, b: d.offB.get(e) ?? b0 });
  }
  rest.sort((x, y) => x.b - y.b || +(x.k === ON) - +(y.k === ON));
  audio.song = true;
  PL = {
    d,
    ev: rest,
    i: 0,
    at0: start,
    tau0: d.tm.tau(b0),
    spb: spbOf(d),
    until: now + AHEAD,
    timer: setInterval(tick, 40),
  };
  transport.sync();
  tick();
  wake();
}
function stopSong(): void {
  if (!PL) return;
  clearInterval(PL.timer);
  PL = null;
  audio.stop();
  audio.song = false;
  audio.idle();
  vAll();
  transport.sync();
}
function pauseSong(): number {
  const p = PL;
  if (!p) return 0;
  const b = Math.min(p.d.smf.end, beatOf(p, audio.now() ?? p.at0));
  stopSong();
  return b;
}
const later = (t: number, fn: () => void) => setTimeout(fn, Math.max(0, (t - nowS()) * 1000));
function tick(): void {
  const p = PL;
  if (!p) return;
  const an = audio.now();
  if (an === null) return;
  const ahead = lookahead(AHEAD);
  if (an > p.until) p.at0 += an - p.until;
  p.until = Math.max(p.until, an + ahead);
  const spb = spbOf(p.d);
  if (spb !== p.spb) {
    p.tau0 += Math.max(0, an - p.at0) / p.spb;
    p.at0 = Math.max(an, p.at0);
    p.spb = spb;
  }
  const toPerf = (a: number) => nowS() + (a - an);
  while (p.i < p.ev.length && atOf(p, p.ev[p.i].b) < an + ahead) {
    const e = p.ev[p.i++],
      at = Math.max(an, atOf(p, e.b));
    audio.ev(e, at, 0);
    later(toPerf(at), () => {
      if (PL !== p) return;
      if (e.k === ON) vOn(e.ch, e.a, e.v / 127);
      else if (e.k === OFF) vOff(e.ch, e.a);
      else if (e.k === CC) vCc(e.ch, e.a, e.v);
      else if (e.k === BEND) vBend(e.ch, e.v);
      else if (e.k === PC) {
        const q = parts.get(e.ch);
        if (q && q.prog !== e.a) setProg(q, e.a);
      }
    });
  }
  const beat = beatOf(p, an);
  transport.setPos(Math.min(beat, p.d.smf.end));
  if (p.i >= p.ev.length && beat > p.d.smf.end + 1) {
    stopSong();
    transport.stopped(true);
  }
}
const transport = new Transport({
  active: () => !!PL,
  start: startSong,
  stop: stopSong,
  pause: pauseSong,
  tempo: () => tempo,
});
new ParamGroup<PlayKey>([TEMPO], (v, k) => {
  tempo = v.tempo;
  if (k) transport.refresh();
});
new ParamGroup<PlayKey>([outVol(VOL0)], (v) => audio.vol(v.vol));
/** 残響の部屋（聴く位置は部屋の既定。残響音の大きさはパートの送る量で決める） */
const roomTo = (v: string) => audio.room(reverbSpec(roomOf(v), roomOf(v).r));
roomTo(new Choice<string>($('#p-room'), roomTo).value);
const compTo = (v: string) => audio.compress(v === 'on');
compTo(new Choice<string>($('#p-comp'), compTo).value);
/* すべてのチャンネルの音をすぐ止める（曲の演奏は続ける） */
$('#panicBtn').addEventListener('click', () => {
  audio.panic();
  vAll();
});
autoPause(audio, { pause: () => transport.pause(), hidden: tick });
songSel.addEventListener('change', () => {
  stopSong();
  transport.stopped(true);
  void showSong();
});

/* ---------- MIDI ---------- */
const dst = new Choice<'ch' | 'sel'>($('#p-dst'));
const pcm = new Choice<'on' | 'off'>($('#p-pcm'));
const leds = $$<HTMLElement>('#m-chs span');
const ledT = new Float64Array(16);
function led(ch: number): void {
  ledT[ch] = nowS();
  leds[ch]?.classList.add('on');
  setTimeout(() => {
    if (nowS() - ledT[ch] >= 0.11) leds[ch]?.classList.remove('on');
  }, 120);
}
/** MIDI のチャンネル（1〜16）を鳴らすパート（0〜15）へ */
const route = (ch: number) => (dst.value === 'sel' ? sel : ch - 1);
/** 機器から押している音（離すときに、押したときのパートで離す） */
const midiHeld = new Map<number, number>();
function midiReady(fn: () => void): void {
  if (audio.now() !== null) fn();
  else void audio.ready().then((ok) => ok && fn());
}
const midiBox = new MidiBox(
  {
    on: (note, vel, ch) => {
      led(ch - 1);
      const part = route(ch),
        key = (ch << 7) | note;
      midiHeld.set(key, part);
      const p = ensure(part);
      midiBox.show(part === DRUM_PART ? (DRUM_NAMES[note] ?? noteName(note)) : noteName(note), vel, '');
      midiReady(() => midiHeld.get(key) === part && audio.ev({ k: ON, ch: part, a: note, v: vel }, 0, 1));
      vOn(p.ch, note, vel / 127);
    },
    off: (note, ch) => {
      const key = (ch << 7) | note,
        part = midiHeld.get(key);
      if (part === undefined) return;
      midiHeld.delete(key);
      audio.ev({ k: OFF, ch: part, a: note, v: 0 }, 0, 1);
      vOff(part, note);
    },
    cc: (num, v, ch) => {
      led(ch - 1);
      const part = route(ch);
      audio.ev({ k: CC, ch: part, a: num, v }, 0, 1);
      vCc(part, num, v);
    },
    bend: (v, ch) => {
      const part = route(ch);
      audio.ev({ k: BEND, ch: part, a: 0, v }, 0, 1);
      vBend(part, v);
    },
    pc: (prog, ch) => {
      led(ch - 1);
      if (pcm.value === 'off') return;
      const p = ensure(route(ch));
      setProg(p, prog);
    },
  },
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
new ResizeObserver(() => {
  for (const p of parts.values()) p.row.dirty = true;
  wake();
}).observe(rowsEl);
void showSong();

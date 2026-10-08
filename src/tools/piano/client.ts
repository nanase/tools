/**
 * ピアノ音響モデルのページの入口: 弦・打鍵・響板・部屋の入力 → ピアノの模型 → 鍵盤と弦の図・計算結果・響板の応答・
 * 音の波形・音。鍵や弦を押すとその鍵を打ち、離すとダンパーが下りる。曲の演奏は先の音を少しずつ予約する
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, fmtR, minus, plain, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { movePlayStore, outVol, type PlayKey, TEMPO } from '../../lib/play';
import { acoustics, reverbSpec, roomOf } from '../../lib/reverb';
import { SW } from '../../lib/scope';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { C, cabs } from '../guitar/body';
import { spectra, toDb } from '../spectrum/fft';
import { PianoAudio } from './audio';
import { type BoardDesc, boardDesc } from './engine';
import { Keys } from './keys';
import { damperRate, makePiano, NO_DAMPER, type Piano, type PianoSpec, type Strike, strikeKey } from './model';
import { DIST, THICK, UNI, VEL, VOL0 } from './params';
import { BH, boardPlot, fAtX, forcePlot, OH, specPlot, wavePlot, Y1_TOP, Y2_TOP } from './plot';
import { PIECES, type Piece, type PlayEv, pieceOf, playEvents, type ScoreNote, TempoMap } from './score';
import { admittance, pressure, yMeanOf } from './soundboard';
import { inharm, KEY_HI, KEY_LO, KEYS, noteHz, noteName, PIANO_TYPES, pianoTypeOf } from './strings';
import type { Job, Reply } from './worker';
import { renderStrike } from './worker';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};
const nowS = () => performance.now() / 1000;
/** ハンマーの速さの刻み [m/s]（衝突を覚えておく単位） */
const V_STEP = 0.05;
const qv = (v: number) => Math.max(V_STEP, Math.round(v / V_STEP) * V_STEP);

/* ---------- 状態 ---------- */
type TypeV = 'concert' | 'grand' | 'upright';
const S = {
  type: (PIANO_TYPES.some((t) => t.v === stored('type')) ? stored('type') : 'concert') as TypeV,
  /** 計算結果に出す鍵（最後に打った鍵） */
  last: 60,
  /** 押している鍵（鍵盤） */
  held: new Set<number>(),
};

const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
const typeCh = new Choice<TypeV>($('#p-type'), (v) => {
  S.type = v;
  store('type', v);
  rebuild();
});
typeCh.set(S.type);
const tun = choice<'stretch' | 'equal'>('tun', () => rebuild());
const a4 = choice<string>('a4', () => rebuild());
const wood = choice<string>('wood', () => rebuild());
const hard = choice<string>('hard', () => {
  cacheClear();
  rebuild();
});
const ped = choice<'auto' | 'on' | 'off'>('ped', () => syncPedal());
const soft = choice<'off' | 'on'>('soft', () => renderOut());
const thump = choice<string>('th', () => renderOut());
const room = choice<string>('room', () => roomView());
const nv = choice<'blur' | 'slow'>('nv', (v) => {
  keys.setMode(v);
  kbBar();
});
const ex = choice<string>('ex', (v) => {
  keys.setExag(Number(v));
  kbBar();
});
const sl = choice<string>('sl', (v) => {
  keys.setSlow(Number(v));
  kbBar();
});
const span = choice<string>('span', () => drawOut());
const fmax = choice<string>('fmax', () => drawOut());
const ov = choice<'yt' | 'sp' | 'hm'>('ov', () => showOut());
/* 曲（ドロップダウン）。選んだ曲は保存する */
const piece = $<HTMLSelectElement>('#piece');
{
  const v = stored('c:p-piece');
  if (typeof v === 'string' && PIECES.some((p) => p.v === v)) piece.value = v;
}
piece.addEventListener('change', () => {
  store('c:p-piece', piece.value);
  if (PL) stopPiece();
});

/** 数値の入力（保存する） */
const V = { vel: VEL.v, uni: UNI.v, h: THICK.v, dist: DIST.v, tempo: 100 };
const audio = new PianoAudio();

/* ---------- 鍵盤と弦 ---------- */
const keys = new Keys($<SVGSVGElement>('#kbd'), {
  onKey: (k, down) => (down ? void press(k) : lift(k)),
  now: nowS,
});
keys.setMode(nv.value);
keys.setExag(Number(ex.value));
keys.setSlow(Number(sl.value));
function kbBar(): void {
  $('#sl-row').hidden = nv.value !== 'slow';
  txt('#kb-ex', `×${ex.value}`);
  txt('#kb-tm', nv.value === 'slow' ? `スロー 1/${sl.value}` : '実時間（残像）');
}

/* ---------- 模型 ---------- */
let PM: Piano, BD: BoardDesc;
const specOf = (): PianoSpec => {
  const t = pianoTypeOf(S.type);
  return {
    type: t,
    board: { wood: wood.value, area: t.area, h: V.h / 1000, f1: t.f1 },
    a4: Number(a4.value),
    stretch: tun.value === 'stretch',
    unison: V.uni,
    hard: Number(hard.value),
  };
};
/** 衝突の結果（鍵・速さ・ソフトペダル） */
let contacts = new Map<string, Strike['contact']>();
const cacheClear = () => {
  contacts = new Map();
};
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
function rebuild(): void {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuildNow, 30);
}
function rebuildNow(): void {
  const spec = specOf();
  PM = makePiano(spec, audio.fs);
  cacheClear();
  BD = boardDesc(PM.board);
  audio.setSpec(spec);
  audio.setBoard(BD);
  keys.setGeo(
    PM.keys.map((km) => ({
      L: km.s.L,
      x0: km.x0,
      damper: km.s.key < NO_DAMPER,
      wound: km.s.wound,
      d: km.s.d,
    })),
  );
  table();
  results();
  boardView();
  renderOut();
}

/** 鍵 key を速さ v で打ったときの模型（表示用。主スレッドで解く） */
function strikeOf(key: number, v: number, free: (k: number) => boolean = () => false): Strike {
  const ck = `${key}|${v}|${soft.value}`,
    s = strikeKey(
      PM,
      { key, v, soft: soft.value === 'on', free, thump: Number(thump.value) },
      audio.fs,
      contacts.get(ck),
    );
  contacts.set(ck, s.contact);
  return s;
}

/* ---------- 入力 ---------- */
new ParamGroup<string>([VEL, UNI, THICK, DIST], (v, k) => {
  V.vel = v.vel;
  V.uni = v.uni;
  V.h = v.h;
  V.dist = v.dist;
  if (!PM) return;
  if (k === 'vel') {
    results();
    renderOut();
  } else if (k === 'uni' || k === 'h') rebuild();
  else if (k === 'dist') roomView();
});

/* ---------- 弦の一覧（C の鍵と A0） ---------- */
const cents = (f: number, n: number) => 1200 * Math.log2(f / noteHz(n, Number(a4.value)));
const signed = (v: number, d = 1) => (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '±') + Math.abs(v).toFixed(d);
function table(): void {
  let h = '';
  for (const k of [21, 24, 36, 48, 60, 72, 84, 96, 108]) {
    const km = PM.keys[k - KEY_LO],
      s = km.s;
    h += `<tr data-k="${k}" aria-selected="${k === S.last}"><td>${noteName(k)}</td><td>${(s.L * 1000).toFixed(0)} mm</td><td>${s.ns}</td><td>${(s.d * 1000).toFixed(2)}${s.wound ? ' 巻' : ''}</td><td>${s.T.toFixed(0)} N</td><td>${plain(inharm(s), 2, true)}</td><td>${signed(cents(PM.f1[k - KEY_LO], k))}</td></tr>`;
  }
  html('#stab tbody', h);
}
$('#stab').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-k]');
  if (!tr) return;
  S.last = Number(tr.dataset.k);
  table();
  results();
  boardView();
  renderOut();
});

/* ---------- 計算結果 ---------- */
const mn = (s: string) => `<mn>${s}</mn>`;
const mexp = (v: number, d = 2) => {
  const e = Math.floor(Math.log10(Math.abs(v)));
  return `<mrow>${mn((v / 10 ** e).toFixed(d))}<mo>×</mo><msup><mn>10</mn><mn>${minus(String(e))}</mn></msup></mrow>`;
};
const t60 = (s: number) => Math.log(1000) / s;
/**
 * 第 1 部分音の付近のモードから、初めと後の減衰時間を求める。初めは最も大きいモード（弦がそろって揺れる）、
 * 後は最大の 1/100 より大きいモードのうち最も遅く減るもの（弦が互い違いに揺れる、または水平の偏波）
 */
function decays(st: Strike, km: Piano['keys'][number]): [number, number] {
  const w1 = km.w[0][0],
    m = st.msg,
    near: number[] = [];
  for (let i = 0; i < m.N; i++) if (Math.abs(m.w[i] - w1) < 0.02 * w1 && m.own[i] === km.s.key) near.push(i);
  if (!near.length) return [Number.NaN, Number.NaN];
  const amp = (i: number) => Math.hypot(m.fr[i], m.fi[i]),
    top = near.reduce((a, b) => (amp(b) > amp(a) ? b : a));
  let slow = m.s[top];
  for (const i of near) if (amp(i) > amp(top) / 100 && m.s[i] < slow) slow = m.s[i];
  return [t60(m.s[top]), t60(slow)];
}
let lastStrike: Strike | null = null;
function results(): void {
  const k = S.last,
    km = PM.keys[k - KEY_LO],
    s = km.s,
    st = strikeOf(k, qv(V.vel)),
    f1 = PM.f1[k - KEY_LO],
    B = inharm(s),
    [ta, tb] = decays(st, km),
    hm = st.hammer,
    c = st.contact,
    ratio = km.x0 / s.L,
    y = admittance(PM.board, C.cx(km.w[0][0])),
    td = km.s.key < NO_DAMPER ? t60(damperRate(km, 1)) : 0;
  lastStrike = st;
  html('#o-f1', ro(f1, 'Hz', 5));
  txt('#o-f1s', `${noteName(k)}（平均律から ${signed(cents(f1, k))} セント）`);
  html('#o-l', ro(s.L * 1000, 'mm', 4).replace('kmm', 'm'));
  txt(
    '#o-ls',
    `${s.ns} 本、外径 ${(s.d * 1000).toFixed(2)} mm${s.wound ? `（芯線 ${(s.dc * 1000).toFixed(2)} mm の巻弦）` : ''}`,
  );
  html('#o-t', ro(s.T, 'N', 4));
  txt('#o-ts', `1 本あたり、線密度 ${(s.mu * 1000).toFixed(2)} g/m`);
  html('#o-z0', `${Math.sqrt(s.T * s.mu).toFixed(2)}<span class="u">N·s/m</span>`);
  html(
    '#o-b',
    `${(B / 10 ** Math.floor(Math.log10(B))).toFixed(2)}<span class="u">× 10<sup>${minus(String(Math.floor(Math.log10(B))))}</sup></span>`,
  );
  txt('#o-bs', `10 倍音が ${signed(1200 * Math.log2(Math.sqrt((1 + 100 * B) / (1 + B))), 1)} セント高い`);
  html('#o-mh', `${(hm.m * 1000).toFixed(1)}<span class="u">g</span>`);
  txt('#o-mhs', `速さ ${hm.v.toFixed(2)} m/s、p = ${hm.p.toFixed(2)}`);
  html('#o-tc', ro(c.tc, 's', 3));
  txt(
    '#o-tcs',
    `最大の力 ${fmtR(c.fmax * st.msg.att.length ? c.fmax : 0, 'N', 3)}（弦 1 本）、圧縮 ${(c.dmax * 1000).toFixed(2)} mm`,
  );
  html('#o-x0', `1/${(1 / ratio).toFixed(2)}`);
  txt('#o-x0s', `端から ${(km.x0 * 1000).toFixed(1)} mm`);
  html('#o-t1', ro(ta, 's', 3));
  txt('#o-t1s', s.ns > 1 ? '弦がそろって揺れ、響板へ強く逃げる' : '第 1 部分音');
  html('#o-t2', ro(tb, 's', 3));
  txt('#o-t2s', s.ns > 1 ? '弦が互い違いに揺れ、響板へ逃げにくい' : '水平の偏波');
  html('#o-td', td ? ro(td, 's', 3) : '—');
  txt('#o-tds', td ? '鍵を離したあとの第 1 部分音の T60' : 'この鍵にはダンパーがない');
  html('#o-y', `${(cabs(y) * 1000).toFixed(3)}<span class="u">mm/(s·N)</span>`);
  txt('#o-ys', `第 1 部分音の周波数で、実部 ${(y.re * 1000).toFixed(3)} mm/(s·N)`);
  html('#mF', fmtR(f1, 'Hz', 5));
  txt('#mT', fmtR(ta, 's', 3));
  txt('#mB', plain(B, 3, true));
  txt('#kb-note', `${noteName(k)}  ${fmtR(f1, 'Hz', 4)}`);
  /* 代入した式 */
  const f0 = Math.sqrt(s.T / s.mu) / (2 * s.L);
  let h = `<math display="block"><msub><mi>f</mi><mn>1</mn></msub><mo>=</mo><mfrac><mn>1</mn><mrow><mn>2</mn><mo>×</mo>${mn(s.L.toFixed(4))}</mrow></mfrac><msqrt><mfrac>${mn(s.T.toFixed(1))}${mexp(s.mu, 3)}</mfrac></msqrt><msqrt><mrow><mn>1</mn><mo>+</mo>${mexp(B, 2)}</mrow></msqrt><mo>=</mo>${mn((f0 * Math.sqrt(1 + B)).toFixed(2))}<mi mathvariant="normal">Hz</mi></math>`;
  h += `<math display="block"><msub><mi>t</mi><mi mathvariant="normal">c</mi></msub><mo>=</mo>${mn((c.tc * 1000).toFixed(2))}<mi mathvariant="normal">ms</mi><mo>,</mo><mspace width="1em"/><msub><mi>F</mi><mi>max</mi></msub><mo>=</mo>${mn(c.fmax.toFixed(1))}<mi mathvariant="normal">N</mi><mo>,</mo><mspace width="1em"/><msub><mi>T</mi><mn>60</mn></msub><mo>=</mo>${mn(ta.toFixed(2))}<mi mathvariant="normal">s</mi><mo>,</mo>${mn(tb.toFixed(1))}<mi mathvariant="normal">s</mi></math>`;
  html('#subst', h);
}

/* ---------- 響板 ---------- */
let boardPartials: number[] = [];
function boardView(): void {
  const b = PM.board,
    km = PM.keys[S.last - KEY_LO];
  html('#b-f1', ro(b.f1, 'Hz', 3));
  html('#b-df', ro(b.df, 'Hz', 3));
  html('#b-fc', ro(b.fc, 'Hz', 3));
  html('#b-y', `${(yMeanOf(b, 0) * 1000).toFixed(3)}<span class="u">mm/(s·N)</span>`);
  html('#b-a', `${b.spec.area.toFixed(1)}<span class="u">m²</span>`);
  html('#b-rh', `${b.rhoh.toFixed(2)}<span class="u">kg/m²</span>`);
  boardPartials = Array.from(km.w[0].subarray(0, Math.min(km.N, 60)), (w) => w / (2 * Math.PI));
  const pl = boardPlot(b, boardPartials);
  $('#b-t1').setAttribute('d', pl.y);
  $('#b-t2').setAttribute('d', pl.p);
  html('#b-pt', pl.partials);
  html('#b-axes', pl.axes);
  $('#b-svg').setAttribute(
    'aria-label',
    `響板の応答。横軸 20 Hz から 10 kHz の対数、CH1 は駒のアドミタンス（上端 ${minus(String(Y1_TOP))} dB）、CH2 は 1 m 先の音圧 ÷ 力（上端 ${Y2_TOP} dB）。下端の印は ${noteName(S.last)} の部分音`,
  );
}
cursor($<SVGSVGElement>('#b-svg'), BH, (x) => {
  if (x === null) {
    $('#b-cur').setAttribute('d', '');
    txt('#b-rd', '');
    return;
  }
  const f = fAtX(x),
    y = cabs(admittance(PM.board, C.cx(2 * Math.PI * f))),
    p = cabs(pressure(PM.board, f));
  $('#b-cur').setAttribute('d', `M${x.toFixed(1)} 0V${BH}`);
  txt(
    '#b-rd',
    `f ${fmtR(f, 'Hz', 4)}   CH1 ${minus((20 * Math.log10(y)).toFixed(1))} dB   CH2 ${minus((20 * Math.log10(p)).toFixed(1))} dB`,
  );
});

/** 表示窓のカーソル。fn には表示窓の x（外なら null）を渡す */
function cursor(svg: SVGSVGElement, h: number, fn: (x: number | null) => void): void {
  svg.addEventListener('pointermove', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    fn(p.x >= 0 && p.x <= SW && p.y >= 0 && p.y <= h ? p.x : null);
  });
  svg.addEventListener('pointerleave', () => fn(null));
}

/* ---------- 残響（部屋） ---------- */
function roomView(): void {
  const r = roomOf(room.value),
    off = r.v === 'off',
    a = acoustics(r);
  html('#r-t', off ? '—' : ro(a.t60, 's', 3));
  html('#r-th', off ? '—' : ro(a.t60Hi, 's', 3));
  html('#r-rc', off ? '—' : ro(a.rc, 'm', 3));
  html('#r-dr', off ? '—' : `${minus((20 * Math.log10(V.dist / a.rc)).toFixed(1))}<span class="u">dB</span>`);
  audio.setRoom(reverbSpec(r, V.dist));
}

/* ---------- 音の波形（Web Worker で計算） ---------- */
const OUT_S = 2,
  NFFT = 65536;
let out: Float32Array | null = null,
  outFs = 48000,
  spec = new Float32Array(NFFT / 2 + 1),
  jobId = 0,
  worker: Worker | null = null,
  outTimer: ReturnType<typeof setTimeout> | undefined;
function mkWorker(): Worker | null {
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Reply>) => {
      if (e.data.id === jobId) gotOut(e.data.y);
    };
    return w;
  } catch {
    return null;
  }
}
const waveBox = $<HTMLDetailsElement>('details.a-wave');
let outDirty = true;
waveBox.addEventListener('toggle', () => {
  if (waveBox.open && outDirty) renderOut();
});
function renderOut(): void {
  clearTimeout(outTimer);
  if (!waveBox.open) {
    outDirty = true;
    return;
  }
  outDirty = false;
  outTimer = setTimeout(() => {
    const st = strikeOf(S.last, qv(V.vel)),
      fs = audio.fs,
      p = st.msg,
      j: Job = {
        id: ++jobId,
        board: BD,
        p: {
          ...p,
          w: p.w.slice(),
          s: p.s.slice(),
          fr: p.fr.slice(),
          fi: p.fi.slice(),
          own: p.own.slice(),
          sd: p.sd.slice(),
          att: p.att.slice(),
        },
        fs,
        dur: OUT_S,
      };
    lastStrike = st;
    outFs = fs;
    worker ??= mkWorker();
    if (worker) worker.postMessage(j);
    else gotOut(renderStrike(j));
  }, 60);
}
function gotOut(y: Float32Array): void {
  out = y;
  const px = new Float32Array(NFFT / 2 + 1);
  spectra(y.subarray(0, NFFT), y.subarray(0, NFFT), NFFT, 'bh', px, new Float32Array(NFFT / 2 + 1));
  spec = px;
  drawOut();
}
let outCur: number | null = null;
function drawOut(): void {
  if (ov.value === 'hm') {
    const st = lastStrike;
    if (!st) return;
    const c = st.contact,
      h = forcePlot(c.force, c.dtF);
    $('#h-t1').setAttribute('d', h.d);
    html('#h-axes', h.axes);
    txt('#h-vd', fmt(h.vd, 'N', 3));
    txt('#h-hd', fmt(h.hd, 's', 3));
    txt('#h-st', `PEAK ${fmtR(c.fmax, 'N', 3)}`);
    outCursor();
    return;
  }
  if (!out) return;
  if (ov.value === 'yt') {
    const w = wavePlot(out, outFs, Number(span.value));
    $('#w-t1').setAttribute('d', w.d);
    html('#w-axes', w.axes);
    txt('#w-vd', `${plain(w.vd, 3)} Pa`);
    txt('#w-hd', fmt(w.hd, 's', 3));
    let pk = 0;
    for (const v of out) pk = Math.max(pk, Math.abs(v));
    txt('#w-st', `PEAK ${fmtR(pk, 'Pa', 3)}`);
    $('#w-svg').setAttribute(
      'aria-label',
      `1 m 先の音圧の波形。打ってから ${fmt(Number(span.value), 's')} まで、ピーク ${fmt(pk, 'Pa', 3)}`,
    );
  } else {
    const fm = Number(fmax.value),
      s = specPlot(spec, outFs, NFFT, fm);
    $('#s-t1').setAttribute('d', s.d);
    html('#s-axes', s.axes);
    txt('#s-x', `0–${fmt(fm, 'Hz', 3)}`);
  }
  outCursor();
}
function showOut(): void {
  $('#v-yt').hidden = ov.value !== 'yt';
  $('#v-sp').hidden = ov.value !== 'sp';
  $('#v-hm').hidden = ov.value !== 'hm';
  outCur = null;
  drawOut();
}
function outCursor(): void {
  const id = ov.value === 'sp' ? 's' : ov.value === 'hm' ? 'h' : 'w',
    x = outCur;
  for (const o of ['w', 's', 'h']) if (o !== id) $(`#${o}-cur`).setAttribute('d', '');
  if (x === null) {
    $(`#${id}-cur`).setAttribute('d', '');
    txt(`#${id}-rd`, '');
    return;
  }
  if (id === 'h') {
    const st = lastStrike;
    if (!st) return;
    const h = forcePlot(st.contact.force, st.contact.dtF),
      t = (x / SW) * 10 * h.hd,
      i = Math.min(st.contact.force.length - 1, Math.round(t / st.contact.dtF));
    $('#h-cur').setAttribute('d', `M${x.toFixed(1)} 0V${OH}`);
    txt('#h-rd', `t ${t ? fmtR(t, 's', 4) : '0'}   CH1 ${fmtR(st.contact.force[Math.max(0, i)] ?? 0, 'N', 4)}`);
    return;
  }
  if (!out) return;
  if (id === 's') {
    const fm = Number(fmax.value),
      km = Math.round((fm / outFs) * NFFT),
      c = Math.round((x / SW) * km);
    let b = c;
    for (let i = Math.max(1, c - 6); i <= Math.min(km, c + 6); i++) if (spec[i] > spec[b]) b = i;
    const f = (b / NFFT) * outFs,
      f1 = boardPartials[0] ?? 0,
      h = f1 ? f / f1 : 0,
      xb = (b / km) * SW;
    $('#s-cur').setAttribute('d', `M${xb.toFixed(1)} 0V${OH}`);
    txt(
      '#s-rd',
      `f ${fmtR(f, 'Hz', 4)}${h > 0.5 ? `（${plain(h, 4, true)} 倍）` : ''}   CH1 ${minus(toDb(spec[b]).toFixed(1))} dB`,
    );
  } else {
    const n = Math.round(Number(span.value) * outFs),
      i = Math.min(out.length - 1, Math.round((x / SW) * n));
    $('#w-cur').setAttribute('d', `M${x.toFixed(1)} 0V${OH}`);
    txt(
      '#w-rd',
      `t ${i ? fmtR(i / outFs, 's', 4) : '0'}   CH1 ${out[i] >= 0 ? '+' : '−'}${fmtR(Math.abs(out[i]), 'Pa', 4)}`,
    );
  }
}
for (const [id, h] of [
  ['#w-svg', OH],
  ['#s-svg', OH],
  ['#h-svg', OH],
] as const)
  cursor($<SVGSVGElement>(id), h, (x) => {
    outCur = x;
    outCursor();
  });

/* ---------- 打鍵（鍵盤） ---------- */
const NO_SOUND = '音を出せませんでした';
const sndMsg = (s: string) => txt('#snd-msg', s);
/** 鍵盤で弾くときのペダル */
const livePedal = () => ped.value === 'on';
/** 鍵ごとにダンパーが上がっているか（held は押している鍵、pedal はペダル） */
function freeOf(held: Set<number>, pedal: boolean): Uint8Array {
  const f = new Uint8Array(KEYS);
  for (let k = KEY_LO; k <= KEY_HI; k++) f[k - KEY_LO] = +(pedal || held.has(k) || k >= NO_DAMPER);
  return f;
}
function syncPedal(): void {
  if (PL) return;
  const on = livePedal();
  audio.pedal(on);
  keys.setPedal(on);
  $('#pedLed').classList.toggle('on', on);
}
/** 表示用のダンパーの減衰率（第 1 部分音） */
const sdOf = (k: number) => (k < NO_DAMPER ? damperRate(PM.keys[k - KEY_LO], 1) : 0);

async function press(k: number): Promise<void> {
  if (PL) return;
  S.held.add(k);
  keys.setDown(k, true);
  const ok = await audio.ready();
  sndMsg(ok ? '' : NO_SOUND);
  if (!ok) return;
  /* AudioWorklet を作った直後や、リリースでペダルを離したあとでも、ペダルの状態をそろえる */
  syncPedal();
  const t = nowS(),
    v = qv(V.vel),
    view = audio.strike(k, v, soft.value === 'on', Number(thump.value), freeOf(S.held, livePedal()));
  txt('#kb-live', noteName(k));
  /* ダンパーは図が鍵とペダルの状態から決める（表示が届く前に離していても、離した時刻から止める） */
  view.then((vw) => keys.set(k, { view: vw, t0: t, damp: Infinity, sd: sdOf(k) }));
  S.last = k;
  showLastSoon();
}
/** 最後に打った鍵の表・計算結果・響板・音の波形（グリッサンドで続けて打つときは、まとめて 1 回描く） */
let shown = -1,
  showTimer: ReturnType<typeof setTimeout> | undefined;
function showLastSoon(): void {
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    if (shown !== S.last) {
      shown = S.last;
      table();
      results();
      boardView();
    }
    renderOut();
  }, 60);
}
function lift(k: number): void {
  if (PL) return;
  S.held.delete(k);
  keys.setDown(k, false);
  audio.release(k);
}

/* テンポと音量（演奏中も効く） */
movePlayStore();
new ParamGroup<PlayKey>([TEMPO, outVol(VOL0)], (v) => {
  V.tempo = v.tempo;
  audio.vol(v.vol);
});

/* リリース: 押しているすべての鍵（手でも曲でも）から手を離し、ペダルで上がっているダンパーも下ろす。
   演奏は続け、曲なら次の打鍵・ペダルからまた効く。曲があとで離す鍵は、もう離れていても問題ない */
$('#relBtn').addEventListener('click', () => {
  const an = audio.now() ?? 0;
  S.held.clear();
  audio.releaseAll(an);
  keys.upAll();
  keys.setPedal(false);
  $('#pedLed').classList.remove('on');
  const p = PL;
  if (!p) return;
  /* 予約済みの出来事のうち、今より前に打った鍵とペダルを離したことにする（今より後の予約はそのまま） */
  for (const k of [...p.held.keys()]) if ((p.lastOn.get(k) ?? 0) <= an) p.held.delete(k);
  if (p.pedalAt <= an) p.pedal = false;
});

$('#muteBtn').addEventListener('click', () => {
  if (PL) stopPiece();
  audio.stop(0.06);
  const t = nowS();
  for (const k of keys.sounding()) keys.dampAt(k, t, 40);
});

/* ---------- 演奏 ---------- */
type Ev = PlayEv;
interface Play {
  ev: Ev[];
  i: number;
  /** テンポの比の表と、τ（標準のテンポの拍に直した時間）と AudioContext の時刻の対応 */
  tm: TempoMap;
  at0: number;
  tau0: number;
  spb: number;
  last: number;
  bars: number;
  timer: ReturnType<typeof setInterval>;
  piece: Piece;
  /** 予約した時点での、押している鍵とペダル（共鳴する弦を決める） */
  held: Map<number, number>;
  pedal: boolean;
  /** 鍵ごとの最後に打った時刻と、最後のペダルの出来事の時刻（AudioContext の時刻。リリースで使う） */
  lastOn: Map<number, number>;
  pedalAt: number;
}
let PL: Play | null = null;
const noteCache = new Map<string, ScoreNote[]>();
const spbOf = (pc: Piece) => 60 / (pc.bpm * (V.tempo / 100));
function syncPlay(): void {
  $('#playBtn').setAttribute('aria-pressed', String(!!PL));
  $('#playLed').classList.toggle('on', !!PL);
  txt('#playT', PL ? '停止' : '演奏');
}
async function startPiece(): Promise<void> {
  const ok = await audio.ready();
  if (!ok) {
    sndMsg(NO_SOUND);
    return;
  }
  sndMsg('');
  const pc = pieceOf(piece.value);
  let notes = noteCache.get(pc.v);
  if (!notes) {
    try {
      notes = await pc.load();
    } catch {
      sndMsg('曲を読み込めませんでした');
      return;
    }
    noteCache.set(pc.v, notes);
  }
  if (PL || piece.value !== pc.v) return;
  /* 鍵盤で押している鍵とペダルを離す */
  for (const k of S.held) lift(k);
  audio.pedal(false);
  keys.setPedal(false);
  const ev = playEvents(pc, notes, V.vel, ped.value),
    now = audio.now() ?? 0,
    end = Math.max(...notes.map((x) => x.t + x.d));
  PL = {
    ev,
    i: 0,
    tm: new TempoMap(pc.tempoMap),
    at0: now + 0.25,
    tau0: 0,
    spb: spbOf(pc),
    last: end,
    bars: Math.ceil((end - pc.pickup) / pc.bar),
    timer: setInterval(tick, 40),
    piece: pc,
    held: new Map(),
    pedal: false,
    lastOn: new Map(),
    pedalAt: 0,
  };
  txt('#pl-bar', '');
  syncPlay();
  tick();
}
function stopPiece(): void {
  if (!PL) return;
  clearInterval(PL.timer);
  PL = null;
  audio.stop(0.08);
  keys.clear();
  keys.upAll();
  keys.setPedal(false);
  $('#pedLed').classList.remove('on');
  txt('#pl-bar', '');
  syncPlay();
  syncPedal();
}
/** 時刻 t（performance の秒）に表示を変える（止めたあとの、予約済みの表示は捨てる） */
const later = (p: Play, t: number, fn: () => void) =>
  setTimeout(() => PL === p && fn(), Math.max(0, (t - nowS()) * 1000));
/** 先に予約する時間 [s] */
const AHEAD = 0.5;
function tick(): void {
  const p = PL;
  if (!p) return;
  const an = audio.now();
  if (an === null) return;
  const spb = spbOf(p.piece);
  if (spb !== p.spb) {
    p.tau0 += Math.max(0, an - p.at0) / p.spb;
    p.at0 = Math.max(an, p.at0);
    p.spb = spb;
  }
  const atOf = (b: number) => p.at0 + (p.tm.tau(b) - p.tau0) * p.spb,
    toPerf = (a: number) => nowS() + (a - an);
  while (p.i < p.ev.length && atOf(p.ev[p.i].b) < an + AHEAD) {
    const e = p.ev[p.i++],
      at = Math.max(an, atOf(e.b) + (e.type === 'on' ? e.jit : 0)),
      tp = toPerf(at);
    if (e.type === 'pedal') {
      p.pedal = e.on;
      p.pedalAt = at;
      audio.pedal(e.on, at);
      later(p, tp, () => {
        keys.setPedal(e.on);
        $('#pedLed').classList.toggle('on', e.on);
      });
    } else if (e.type === 'off') {
      const n = (p.held.get(e.key) ?? 1) - 1;
      if (n > 0) p.held.set(e.key, n);
      else p.held.delete(e.key);
      if (n > 0) continue;
      audio.release(e.key, at);
      later(p, tp, () => keys.setDown(e.key, false));
    } else {
      p.held.set(e.key, (p.held.get(e.key) ?? 0) + 1);
      p.lastOn.set(e.key, at);
      const free = freeOf(new Set(p.held.keys()), p.pedal),
        key = e.key;
      void audio.strike(key, qv(e.v), soft.value === 'on', Number(thump.value), free, at).then((view) => {
        if (PL !== p) return;
        keys.set(key, { view, t0: tp, damp: Infinity, sd: sdOf(key) });
      });
      later(p, tp, () => keys.setDown(key, true));
    }
  }
  const pc = p.piece,
    beat = p.tm.beat(p.tau0 + (an - p.at0) / p.spb),
    bar = Math.max(0, Math.floor((beat - pc.pickup) / pc.bar) + 1);
  txt('#pl-bar', `${Math.min(bar, p.bars)} / ${p.bars} 小節`);
  if (p.i >= p.ev.length && beat > p.last + 3) {
    clearInterval(p.timer);
    PL = null;
    syncPlay();
    syncPedal();
  }
}
$('#playBtn').addEventListener('click', () => {
  if (PL) stopPiece();
  else void startPiece();
});

/* ---------- 起動 ---------- */
rebuildNow();
kbBar();
showOut();
roomView();
syncPedal();

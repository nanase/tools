/**
 * オルガン音響モデルのページの入口: ストップ・風・調律・整音・部屋の入力 → 管の設定と調律（Worker）→
 * 管と鍵盤の図・計算結果・音の波形・音。鍵や管を押すと、その鍵盤の入っているストップの管が鳴る。
 * 曲の演奏は先の音を少しずつ予約する。手で押した鍵と曲の鍵は、鍵ごとに押している数を数え、
 * 押したときに弁を開いた管を覚えておいて、その管の弁を閉じる
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmt, fmtR, minus, plain, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { acoustics, reverbSpec, roomOf } from '../../lib/reverb';
import { SW } from '../../lib/scope';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { OH, specPlot, wavePlot } from '../guitar/plot';
import { spectra, toDb } from '../spectrum/fft';
import { OrganAudio } from './audio';
import type { PipeMsg, WindDesc } from './engine';
import { Keys, type Sounding } from './keys';
import { flueView, geoOf, type OrganSpec, panOf, pipeMsg, reedView, type Tuned } from './model';
import { CUT, DIST, SCALE, VOL0, WIND } from './params';
import type { FlueSpec } from './pipes';
import { type Div, PIECES, type Piece, pieceOf, type ScoreNote, TempoMap } from './score';
import { divOf, STOPS, type Stop, stopOf } from './stops';
import type { TuneIn, TuneOut } from './tuner';
import { noteName } from './tuning';
import type { Job, Reply } from './worker';

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

/* ---------- 状態 ---------- */
const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
/** 入っているストップ（保存する） */
const on = new Set<string>(
  (() => {
    const v = stored('stops');
    return Array.isArray(v) && v.every((x) => typeof x === 'string')
      ? (v as string[])
      : ['p8', 'p4', 'g8', 'sb16', 'ob8'];
  })().filter((id) => STOPS.some((s) => s.id === id)),
);
/** ストップごとの整音（スケールの偏差・カットアップ）の上書き（保存する） */
const voicing: Record<string, { scale?: number; cut?: number }> = (() => {
  const v = stored('voicing');
  return v && typeof v === 'object' ? (v as Record<string, { scale?: number; cut?: number }>) : {};
})();

const view = choice<string>('view', (v) => {
  showRank(v);
  syncVoice();
});
const trem = choice<'off' | 'on'>('trem', () => syncWind());
const sag = choice<string>('sag', () => syncWind());
const temp = choice<string>('temp', () => retune());
const a4 = choice<string>('a4', () => retune());
const room = choice<string>('room', () => roomView());
const nv = choice<'blur' | 'slow'>('nv', (v) => {
  keys.setMode(v);
  ppBar();
});
const ex = choice<string>('ex', (v) => {
  keys.setExag(Number(v));
  ppBar();
});
const sl = choice<string>('sl', (v) => {
  keys.setSlow(Number(v));
  ppBar();
});
const span = choice<string>('span', () => drawOut());
const fmax = choice<string>('fmax', () => drawOut());
const ov = choice<'yt' | 'sp'>('ov', () => showOut());
const piece = $<HTMLSelectElement>('#piece');
{
  const v = stored('c:p-piece');
  if (typeof v === 'string' && PIECES.some((p) => p.v === v)) piece.value = v;
}
piece.addEventListener('change', () => {
  store('c:p-piece', piece.value);
  if (PL) stopPiece();
});

const V = { wind: WIND.v, dist: DIST.v, tempo: 100 };
const audio = new OrganAudio();

/* ---------- ストップ ---------- */
const stopBtns = $$<HTMLButtonElement>('button.stop');
function syncStops(): void {
  for (const b of stopBtns) b.setAttribute('aria-pressed', String(on.has(b.dataset.stop as string)));
  rankTitle();
}
$('#stops').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button.stop');
  if (!b) return;
  setStop(b.dataset.stop as string, !on.has(b.dataset.stop as string));
  store('stops', [...on]);
});
/**
 * ストップを入れる・切る。鍵を押している間なら、実際のオルガンのスライダーと同じく、その鍵の管の弁も開く・閉じる。
 * 曲の先の音で、弁を開くのがまだ先の鍵は、その時刻に合わせる
 */
function setStop(id: string, v: boolean): void {
  if (v === on.has(id)) return;
  if (v) on.add(id);
  else on.delete(id);
  syncStops();
  const s = stopOf(id),
    now = audio.now() ?? 0;
  for (const h of held.values()) {
    if (h.div !== s.div) continue;
    const at = h.at > now ? h.at : 0;
    if (v) openStop(h, id, at);
    else {
      audio.off(h.ids.get(id) ?? [], at);
      h.ids.delete(id);
    }
  }
  /* 描く管のストップなら、押している鍵の管の振動も出す・止める */
  if (id === view.value)
    for (const k of vis.keys()) {
      const [d, key] = splitKey(k);
      if (d !== s.div) continue;
      if (v) keys.set(key, soundingOf(key, nowS()));
      else keys.release(key, nowS());
    }
}
/** 弁の開いている管のストップの、ストップと描く管のボタンを点ける（AudioWorklet が知らせる） */
const ledBtns = [...stopBtns, ...$$<HTMLButtonElement>('button.vstop')];
audio.onStops = (ids) => {
  for (const b of ledBtns)
    b.querySelector('.led')?.classList.toggle('on', ids.includes((b.dataset.stop ?? b.dataset.v) as string));
};

/* ---------- 押している鍵と弁 ---------- */
/** 押している鍵 1 つ（鍵盤と鍵ごと） */
interface Held {
  div: Div;
  key: number;
  /** 押している数（手と曲の音、曲の中で重なる同じ鍵の音） */
  n: number;
  /** 弁を開いた時刻（AudioContext の時刻。0 ならすぐ） */
  at: number;
  /** 弁を開いた管の番号（ストップ → 列） */
  ids: Map<string, string[]>;
}
const held = new Map<string, Held>();
/** 手で押している鍵 */
const hand = new Set<string>();
const keyOf = (d: Div, k: number) => `${d}:${k}`;
const splitKey = (s: string): [Div, number] => {
  const i = s.indexOf(':');
  return [s.slice(0, i) as Div, Number(s.slice(i + 1))];
};
/** 押している鍵 h の、ストップ id の管の弁を開く（調律がまだなら開かず、調律が届いたときに開く） */
function openStop(h: Held, id: string, at: number): void {
  const m = msgsOf(id, h.key);
  if (!m.length) return;
  h.ids.set(
    id,
    m.map((x) => x.id),
  );
  audio.on(m, at);
}
/** 鍵を押す（at は AudioContext の時刻。0 ならすぐ）。押している数が 0 から 1 になったら、入っているストップの弁を開く */
function keyOn(d: Div, k: number, at: number): void {
  const key = keyOf(d, k),
    cur = held.get(key);
  if (cur) {
    cur.n++;
    return;
  }
  const h: Held = { div: d, key: k, n: 1, at, ids: new Map() };
  held.set(key, h);
  for (const s of STOPS) if (s.div === d && on.has(s.id)) openStop(h, s.id, at);
}
/** 鍵を離す。押している数が 0 になったら、押したときに開いた管の弁を閉じる（弁を開く前なら、開いた時刻に閉じる） */
function keyOff(d: Div, k: number, at: number): void {
  const key = keyOf(d, k),
    h = held.get(key);
  if (!h || --h.n > 0) return;
  held.delete(key);
  audio.off([...h.ids.values()].flat(), Math.max(at, h.at));
}

/** 押している鍵の見た目（赤い鍵と、描く管の振動）。手と曲の音で同じ鍵を押していれば数える */
const vis = new Map<string, number>();
function show(d: Div, k: number, down: boolean, t: number): void {
  const key = keyOf(d, k),
    was = vis.get(key) ?? 0,
    c = Math.max(0, was + (down ? 1 : -1));
  if (c) vis.set(key, c);
  else vis.delete(key);
  if (c > 0 === was > 0) return;
  keys.setDown(d, k, c > 0);
  const s = stopOf(view.value);
  if (s.div !== d) return;
  if (c > 0 && on.has(s.id)) keys.set(k, soundingOf(k, t));
  else if (!c) keys.release(k, t);
}
/** 押している鍵の見た目をすべて消す */
function clearShow(): void {
  vis.clear();
  keys.clear();
}

/* ---------- 管の設定と調律（Worker） ---------- */
const S = {
  /** 計算結果に出す管（最後に弾いた鍵と、その鍵盤の描くストップ） */
  last: { stop: 'p8', key: 60 },
};
/** 調律した管（ストップ → 鍵 → 列） */
let tuned = new Map<string, (Tuned[] | undefined)[]>();
let specGen = 0;
const specOf = (): OrganSpec => ({
  temp: temp.value,
  a4: Number(a4.value),
  voicing,
});
let tuner: Worker | null = null;
/** 調律したサンプリング周波数（音を出すときに違っていれば、調律し直す） */
let tunedFs = 0;
function retune(): void {
  const gen = ++specGen,
    spec = specOf();
  tunedFs = audio.fs;
  tuned = new Map();
  txt('#pp-tune', '調律中');
  tuner?.terminate();
  try {
    tuner = new Worker(new URL('./tuner.ts', import.meta.url), { type: 'module' });
  } catch {
    tuner = null;
    txt('#pp-tune', '');
    return;
  }
  /* 描くストップと入っているストップを先に調律する */
  const order = [view.value, ...on, ...STOPS.map((s) => s.id)].filter((v, i, a) => a.indexOf(v) === i);
  tuner.onmessage = (e: MessageEvent<TuneOut>) => {
    if (gen !== specGen) return;
    const m = e.data;
    tuned.set(m.stop, m.pipes);
    txt('#pp-tune', m.done < m.total ? `調律中 ${m.done}/${m.total}` : '');
    /* 押している鍵で、調律がまだで開けなかった管の弁を開く */
    if (on.has(m.stop)) {
      const d = stopOf(m.stop).div,
        now = audio.now() ?? 0;
      for (const h of held.values()) if (h.div === d && !h.ids.has(m.stop)) openStop(h, m.stop, h.at > now ? h.at : 0);
    }
    if (m.stop === view.value) {
      showRank(view.value);
      syncVoice();
    }
    if (m.stop === S.last.stop) {
      results();
      renderOut();
    }
  };
  tuner.postMessage({ spec, fs: audio.fs, stops: order } satisfies TuneIn);
}
/** ストップ id の鍵 k の管（調律がまだなら null） */
const pipesOf = (id: string, k: number): Tuned[] | null => {
  const d = divOf(stopOf(id).div);
  return tuned.get(id)?.[k - d.lo] ?? null;
};
const msgsOf = (id: string, k: number): PipeMsg[] =>
  (pipesOf(id, k) ?? []).map((t) => pipeMsg(t, panOf(stopOf(id), k, t.rank)));

/* ---------- 管と鍵盤 ---------- */
const keys = new Keys($<SVGSVGElement>('#ppd'), {
  onKey: (d, k, down) => (down ? void press(d, k) : lift(d, k)),
  now: nowS,
});
keys.setMode(nv.value);
keys.setExag(Number(ex.value));
keys.setSlow(Number(sl.value));
function ppBar(): void {
  $('#sl-row').hidden = nv.value !== 'slow';
  txt('#pp-ex', `×${ex.value}`);
  txt('#pp-tm', nv.value === 'slow' ? `スロー 1/${sl.value}` : '実時間（残像）');
}
/** 描く管を並べる（ストップ id の管を、そのストップの鍵盤の鍵の上に）。押している鍵の管は振動も出す */
function showRank(id: string): void {
  const s = stopOf(id),
    d = divOf(s.div),
    pipes = [];
  for (let k = d.lo; k <= d.hi; k++) pipes.push((pipesOf(id, k) ?? []).map(geoOf));
  keys.setRank(s.div, pipes);
  rankTitle();
  if (on.has(id))
    for (const k of vis.keys()) {
      const [dv, key] = splitKey(k);
      if (dv === s.div) keys.set(key, soundingOf(key, nowS()));
    }
}
/** 図の上に、描いている管のストップと鍵盤（ストップが切ってあればそれも）を書く */
function rankTitle(): void {
  const s = stopOf(view.value);
  keys.setTitle(`${s.name}・${divOf(s.div).name}${on.has(s.id) ? '' : '（ストップは切）'}`);
}
/** 鍵 k を押したときの、描く管の振動 */
function soundingOf(k: number, t0: number): Sounding[] {
  return (pipesOf(view.value, k) ?? []).map((t, i) => ({
    slot: i,
    f: t.fMeas,
    amp: t.amp,
    ph: t.ph,
    t0,
    t1: Infinity,
    rise: Math.max(0.005, t.rise / 3),
  }));
}

/* ---------- 入力 ---------- */
const P1 = new ParamGroup<string>([WIND, SCALE, CUT, DIST], (v, k) => {
  V.wind = v.wind;
  V.dist = v.dist;
  if (k === 'wind') syncWind();
  else if (k === 'dist') roomView();
  else if (k === 'scale' || k === 'cut') {
    const s = stopOf(view.value);
    if (s.kind !== 'flue') return;
    /* 既定と同じ値は上書きしない（既定の整音なら調律の表を使える） */
    const o = { ...voicing[s.id] },
      x = k === 'scale' ? v.scale : v.cut,
      def = k === 'scale' ? s.scale : s.beta;
    o[k] = Math.abs(x - def) < 1e-9 ? undefined : x;
    if (o.scale === undefined && o.cut === undefined) delete voicing[s.id];
    else voicing[s.id] = o;
    store('voicing', voicing);
    retune();
  }
});
/** 整音の行を、描くストップの値に合わせる */
function syncVoice(): void {
  const s = stopOf(view.value),
    o = voicing[s.id] ?? {},
    reed = s.kind === 'reed';
  txt('#vo-aux', s.name);
  P1.set('scale', o.scale ?? (s.kind === 'flue' ? s.scale : 0), { silent: true });
  P1.set('cut', o.cut ?? (s.kind === 'flue' ? s.beta : 0.25), { silent: true });
  P1.setOff('scale', reed, 'リード管には使わない');
  P1.setOff('cut', reed, 'リード管には使わない');
  html('#v-al', s.kind === 'flue' ? plain(s.alpha, 3, true) : '—');
  html('#v-ga', s.kind === 'flue' ? plain(s.gamma, 3, true) : '—');
  const d = divOf(s.div);
  html('#v-rng', `${noteName(d.lo)}–${noteName(d.hi)}`);
  const t = pipesOf(s.id, S.last.key)?.[0];
  html('#v-toe', t && t.kind === 'flue' ? plain((t.spec as FlueSpec).toe, 3, true) : '—');
}

/* ---------- 風 ---------- */
/** ストップの風箱の圧力 [Pa] */
const chestOf = (s: Stop) => V.wind * divOf(s.div).windK;
function windDesc(): WindDesc {
  return {
    p0: { I: V.wind, II: V.wind * divOf('II').windK, P: V.wind * divOf('P').windK },
    tremHz: 5.5,
    tremDepth: trem.value === 'on' ? 0.08 : 0,
    sag: Number(sag.value) * 2.5,
    tau: 0.06,
  };
}
function syncWind(): void {
  audio.setWind(windDesc());
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

/* ---------- 計算結果 ---------- */
const mrow = (dt: string, dd: string, sub = '') =>
  `<div class="m"><dt>${dt}</dt><dd><span>${dd}</span>${sub ? `<span class="m-sub">${sub}</span>` : ''}</dd></div>`;
function results(): void {
  const { stop, key } = S.last,
    s = stopOf(stop),
    t = pipesOf(stop, key)?.[0];
  if (!t) {
    html('#res', '');
    return;
  }
  let h = `<div class="m m-main"><dt>鳴る高さ <i>f</i><sub>1</sub></dt><dd><span>${ro(t.fMeas, 'Hz', 5)}</span><span class="m-sub">${s.name}、鍵 ${noteName(key)}（目標 ${fmtR(t.f, 'Hz', 5)}）</span></dd></div>`;
  if (t.kind === 'flue') {
    const v = flueView(t, chestOf(s)),
      fl = v.s;
    h += mrow(
      '管の長さ <i>l</i>',
      ro(fl.l, 'm', 4),
      `内径 ${(fl.d * 1000).toFixed(1)} mm、${fl.stopped ? '閉管' : '開管'}`,
    );
    h += mrow('口の幅 <i>H</i>', ro(fl.H, 'm', 3), `カットアップ ${(fl.W * 1000).toFixed(2)} mm`);
    h += mrow('ジェットの厚さ <i>h</i>', ro(fl.h, 'm', 3), `唇のずれ ${(fl.y0 * 1e6).toFixed(0)} µm`);
    h += mrow('足の圧力', ro(v.pFoot, 'Pa', 3), `風箱の ${plain(fl.toe, 3, true)} 倍`);
    h += mrow('ジェットの速さ <i>U</i><sub>j</sub>', ro(v.Uj, 'm/s', 3));
    h += mrow('走行時間 <i>τ</i>', ro(v.tau, 's', 3), `周期の ${plain(v.tau * t.fMeas, 3, true)} 倍`);
    h += mrow('<i>θ</i> = <i>U</i><sub>j</sub>/<i>fW</i>', plain(v.theta, 3, true), '大きすぎると上のモードへ跳ぶ');
    h += mrow('口の端補正 <i>M</i>', ro(v.M, 'm', 3), `音響的な長さ ${fmtR(v.Lac, 'm', 4)}`);
    html('#mTh', plain(v.theta, 3, true));
    html('#mU', fmtR(v.Uj, 'm/s', 3));
  } else {
    const v = reedView(t),
      rd = v.s;
    h += mrow(
      '舌の固有振動数 <i>f</i><sub>r</sub>',
      ro(rd.fr, 'Hz', 4),
      `鳴る高さの ${plain(rd.fr / t.fMeas, 3, true)} 倍`,
    );
    h += mrow(
      '共鳴管の長さ <i>L</i>',
      ro(rd.L, 'm', 4),
      `${rd.bore === 'cone' ? '円錐' : '円筒'}、内径 ${(rd.d0 * 1000).toFixed(1)}–${(rd.d1 * 1000).toFixed(1)} mm`,
    );
    h += mrow('共鳴管の第 1 共鳴', ro(v.fRes, 'Hz', 4), `鳴る高さの ${plain(v.fRes / t.fMeas, 3, true)} 倍`);
    h += mrow('閉じる圧力 <i>p</i><sub>c</sub>', ro(v.pc, 'Pa', 3), `風箱の ${plain(v.pc / chestOf(s), 3, true)} 倍`);
    h += mrow('先の開き <i>y</i><sub>0</sub>', ro(rd.y0, 'm', 3), `流れの幅 ${(rd.w * 1000).toFixed(1)} mm、Q ${rd.Q}`);
    html('#mTh', '—');
    html('#mU', '—');
  }
  h += mrow('立ち上がり', ro(t.rise, 's', 3), '定常の −3 dB まで');
  h += mrow('音圧（1 m 先）', ro(t.rms, 'Pa', 3), `${(20 * Math.log10(t.rms / 2e-5)).toFixed(1)} dB SPL`);
  h += mrow(
    '調律のずれ',
    `${plain(1200 * Math.log2(t.fMeas / t.f), 2, true)}<span class="u">セント</span>`,
    '調律のあとの残り',
  );
  html('#res', h);
  html('#mF', fmtR(t.fMeas, 'Hz', 5));
  txt('#pp-note', `${s.name}  ${noteName(key)}  ${fmtR(t.fMeas, 'Hz', 4)}`);
}

/* ---------- 音の波形（Web Worker で計算） ---------- */
const OUT_S = 2,
  NFFT = 32768;
let out: Float32Array | null = null,
  outFs = 48000,
  spec = new Float32Array(NFFT / 2 + 1),
  jobId = 0,
  worker: Worker | null = null,
  outTimer: ReturnType<typeof setTimeout> | undefined;
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
    const p = pipesOf(S.last.stop, S.last.key);
    if (!p) return;
    const j: Job = {
      id: ++jobId,
      pipes: p.map((t) => pipeMsg(t, 0)),
      wind: windDesc(),
      fs: audio.fs,
      dur: OUT_S,
      offAt: 1.6,
    };
    outFs = j.fs;
    if (!worker)
      try {
        worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<Reply>) => {
          if (e.data.id === jobId) gotOut(e.data.y);
        };
      } catch {
        worker = null;
      }
    worker?.postMessage(j);
  }, 60);
}
function gotOut(y: Float32Array): void {
  out = y;
  /* スペクトラムは定常の部分（0.6 s から） */
  const s0 = Math.round(0.6 * outFs),
    seg = y.subarray(s0, s0 + NFFT),
    px = new Float32Array(NFFT / 2 + 1);
  spectra(seg, seg, NFFT, 'bh', px, new Float32Array(NFFT / 2 + 1));
  spec = px;
  drawOut();
}
let outCur: number | null = null;
function drawOut(): void {
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
  outCur = null;
  drawOut();
}
function outCursor(): void {
  const sp = ov.value === 'sp',
    id = sp ? 's' : 'w',
    x = outCur;
  $(`#${sp ? 'w' : 's'}-cur`).setAttribute('d', '');
  if (x === null || !out) {
    $(`#${id}-cur`).setAttribute('d', '');
    txt(`#${id}-rd`, '');
    return;
  }
  if (sp) {
    const fm = Number(fmax.value),
      km = Math.round((fm / outFs) * NFFT),
      c = Math.round((x / SW) * km);
    let b = c;
    for (let i = Math.max(1, c - 6); i <= Math.min(km, c + 6); i++) if (spec[i] > spec[b]) b = i;
    const f = (b / NFFT) * outFs,
      f1 = pipesOf(S.last.stop, S.last.key)?.[0]?.fMeas ?? 0,
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
function cursor(svg: SVGSVGElement, h: number, fn: (x: number | null) => void): void {
  svg.addEventListener('pointermove', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    fn(p.x >= 0 && p.x <= SW && p.y >= 0 && p.y <= h ? p.x : null);
  });
  svg.addEventListener('pointerleave', () => fn(null));
}
for (const id of ['#w-svg', '#s-svg'])
  cursor($<SVGSVGElement>(id), OH, (x) => {
    outCur = x;
    outCursor();
  });

/* ---------- 鍵盤 ---------- */
const NO_SOUND = '音を出せませんでした';
const sndMsg = (s: string) => txt('#snd-msg', s);
/** 鍵盤 d の鍵 k を手で押す（曲の演奏中も弾ける） */
async function press(d: Div, k: number): Promise<void> {
  const key = keyOf(d, k);
  if (hand.has(key)) return;
  hand.add(key);
  show(d, k, true, nowS());
  const ok = await audio.ready();
  sndMsg(ok ? '' : NO_SOUND);
  /* 音を出せないか、準備の間に離した */
  if (!ok || !hand.has(key)) return;
  if (audio.fs !== tunedFs) retune();
  audio.setWind(windDesc());
  keyOn(d, k, 0);
  txt('#pp-live', `${divOf(d).short} ${noteName(k)}`);
  const first =
    STOPS.find((s) => s.div === d && on.has(s.id) && s.id === view.value) ??
    STOPS.find((s) => s.div === d && on.has(s.id));
  if (first) {
    S.last = { stop: first.id, key: k };
    results();
    renderOut();
  }
}
function lift(d: Div, k: number): void {
  const key = keyOf(d, k);
  if (!hand.delete(key)) return;
  show(d, k, false, nowS());
  keyOff(d, k, 0);
}

/* 音量（スライダーだけ） */
const volIn = $<HTMLInputElement>('#vol'),
  volNum = (v: unknown) => (typeof v === 'number' && v >= -60 && v <= 0 ? Math.round(v) : VOL0);
function setVol(db: number): void {
  volIn.value = String(db);
  volIn.style.setProperty('--p', ((db + 60) / 60).toFixed(4));
  volIn.setAttribute('aria-valuetext', `${minus(String(db))} dB`);
  txt('#volv', `${minus(String(db))} dB`);
  audio.vol(db);
}
setVol(volNum(stored('vol')));
volIn.addEventListener('input', () => {
  const db = Number(volIn.value);
  setVol(db);
  store('vol', db);
});
const tempoIn = $<HTMLInputElement>('#tempo');
function setTempo(v: number): void {
  V.tempo = v;
  tempoIn.value = String(v);
  tempoIn.style.setProperty('--p', ((v - 25) / 125).toFixed(4));
  tempoIn.setAttribute('aria-valuetext', `${v} %`);
  txt('#tempov', `${v} %`);
}
{
  const v = stored('tempo');
  setTempo(typeof v === 'number' && v >= 25 && v <= 150 ? Math.round(v / 5) * 5 : 100);
}
tempoIn.addEventListener('input', () => {
  setTempo(Number(tempoIn.value));
  store('tempo', V.tempo);
});
$('#muteBtn').addEventListener('click', () => {
  if (PL) stopPiece();
  audio.stop();
  held.clear();
  hand.clear();
  clearShow();
});
/**
 * リリース: いま押しているすべての鍵（手でも曲でも、すべての鍵盤）から手を離し、すべての弁を閉じる（管は自然に鳴り止む）。
 * 演奏は止めず、まだ鳴り始めていない曲の音は予定どおり鳴らす。離した曲の音は、あとで離す予定が来ても何もしない
 */
$('#relBtn').addEventListener('click', () => {
  const now = audio.now() ?? 0,
    t = nowS();
  for (const key of hand) {
    const [d, k] = splitKey(key);
    show(d, k, false, t);
  }
  hand.clear();
  const p = PL,
    ahead: Note[] = [];
  if (p)
    for (const x of p.down) {
      if (x.at > now) {
        ahead.push(x);
        continue;
      }
      p.down.delete(x);
      x.st = 2;
      if (x.vis === 1) show(x.div, x.key, false, t);
      x.vis = 2;
    }
  for (const [key, h] of held) if (h.at <= now) held.delete(key);
  audio.release();
  /* 鳴り始めた鍵とまとめて数えていた、まだ先の曲の音は押し直す */
  for (const x of ahead) if (!held.has(keyOf(x.div, x.key))) keyOn(x.div, x.key, x.at);
});

/* ---------- 演奏 ---------- */
/** 曲の音 1 つ。st は 0 = まだ・1 = 押している・2 = 離した、vis は図の鍵の印（0 = まだ・1 = 出している・2 = 消した） */
interface Note {
  key: number;
  div: Div;
  /** 弁を開いた時刻（AudioContext の時刻） */
  at: number;
  st: 0 | 1 | 2;
  vis: 0 | 1 | 2;
}
type Ev = { b: number; type: 'on' | 'off'; n: Note };
interface Play {
  ev: Ev[];
  i: number;
  tm: TempoMap;
  at0: number;
  tau0: number;
  spb: number;
  last: number;
  bars: number;
  timer: ReturnType<typeof setInterval>;
  piece: Piece;
  /** 予約した時点で押している曲の音 */
  down: Set<Note>;
}
let PL: Play | null = null;
const cache = new Map<string, { notes: ScoreNote[]; tempo: readonly (readonly [number, number])[] }>();
const spbOf = (pc: Piece) => 60 / (pc.bpm * (V.tempo / 100));
function eventsOf(pc: Piece, notes: ScoreNote[]): Ev[] {
  const ev: Ev[] = [];
  for (const x of notes) {
    const n: Note = { key: x.n, div: pc.hands[x.h] ?? 'I', at: 0, st: 0, vis: 0 };
    ev.push({ b: x.t, type: 'on', n });
    /* 同じ鍵を続けて弾くときに弁が閉じる間をあける */
    ev.push({ b: x.t + Math.max(x.d * 0.95, x.d - 0.06), type: 'off', n });
  }
  return ev.sort((a, b) => a.b - b.b || (a.type === 'off' ? -1 : 1) - (b.type === 'off' ? -1 : 1));
}
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
  if (audio.fs !== tunedFs) retune();
  const pc = pieceOf(piece.value);
  let data = cache.get(pc.v);
  if (!data) {
    try {
      data = await pc.load();
    } catch {
      sndMsg('曲を読み込めませんでした');
      return;
    }
    cache.set(pc.v, data);
  }
  if (PL || piece.value !== pc.v) return;
  /* 曲のレジストレーション */
  for (const s of STOPS) setStop(s.id, pc.stops.includes(s.id));
  store('stops', [...on]);
  audio.setWind(windDesc());
  const notes = data.notes,
    end = Math.max(...notes.map((x) => x.t + x.d)),
    now = audio.now() ?? 0;
  PL = {
    ev: eventsOf(pc, notes),
    i: 0,
    tm: new TempoMap(pc.tempoMap.length ? pc.tempoMap : data.tempo),
    at0: now + 0.3,
    tau0: 0,
    spb: spbOf(pc),
    last: end,
    bars: Math.ceil((end - pc.pickup) / pc.bar),
    timer: setInterval(tick, 40),
    piece: pc,
    down: new Set(),
  };
  txt('#pl-bar', '');
  syncPlay();
  tick();
}
function stopPiece(): void {
  if (!PL) return;
  clearInterval(PL.timer);
  PL = null;
  audio.stop();
  held.clear();
  hand.clear();
  clearShow();
  txt('#pl-bar', '');
  syncPlay();
}
const later = (t: number, fn: () => void) => setTimeout(fn, Math.max(0, (t - nowS()) * 1000));
const AHEAD = 0.4;
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
      x = e.n,
      at = Math.max(an, atOf(e.b)),
      tp = toPerf(at);
    if (e.type === 'on') {
      x.st = 1;
      x.at = at;
      p.down.add(x);
      keyOn(x.div, x.key, at);
      later(tp, () => {
        if (PL !== p || x.vis) return;
        x.vis = 1;
        show(x.div, x.key, true, tp);
      });
    } else {
      /* リリースで離した音は何もしない */
      if (x.st !== 1) continue;
      x.st = 2;
      p.down.delete(x);
      keyOff(x.div, x.key, at);
      later(tp, () => {
        if (PL !== p || x.vis !== 1) return;
        x.vis = 2;
        show(x.div, x.key, false, tp);
      });
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
  }
}
$('#playBtn').addEventListener('click', () => {
  if (PL) stopPiece();
  else void startPiece();
});

/* ---------- 起動 ---------- */
syncStops();
ppBar();
showOut();
roomView();
syncWind();
showRank(view.value);
syncVoice();
retune();

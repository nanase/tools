/**
 * ローリングシャッターのページの入口: 入力 → 走査をゆっくり再生しながら描く（WebGL2）→ 計算結果。
 * 再生中は走査線より上に撮れた像、下に今の様子を暗く描く。1 回の走査が終わると少し止めて、次のコマへ進む
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { fastest, flicker, type Inputs, metrics, type Subject, T_RANGE } from './motion';
import { CAMS, type Key, PARAMS, SUBJECT_ROWS, sig3 } from './params';
import { type Frame, RsRenderer } from './render';

initToolPage();

/** 走査 1 回のスロー再生に掛ける最短の時間 [s] と、読み終えてから次のコマまで止める時間 [s] */
const SCAN_MIN = 3.5;
const HOLD = 1.4;
/** 次のコマへ進める時間 [s]（30 コマ/s の動画の 1 コマ） */
const FRAME = 1 / 30;
/** 題材の時刻を入力で決める題材と、その入力 */
const TIME_KEY: Partial<Record<Subject, Key>> = { golf: 'tg', moto: 'tm' };

const S = {
  subject: 'prop' as Subject,
  dir: 0 as 0 | 1,
  nb: 2,
  rev: false,
  /** 題材の時刻を入力で決めない題材の、コマの時刻 */
  clock: 0.0123,
  /** 走査の進み（0〜1 が読み出し中、1 より大きい間は読み終えて止めている） */
  phase: 1,
  play: !RM.matches,
};
let V = {} as Record<Key, number>;
let raf = 0;
let last = 0;
let visible = true;

/* ---------- 入力 ---------- */
const sub$ = new Choice<Subject>($('#p-sub'), (v) => {
  S.subject = v;
  showRows();
  S.phase = S.play ? 0 : 1;
  later();
});
const dir$ = new Choice<'0' | '1'>($('#p-dir'), (v) => {
  S.dir = v === '1' ? 1 : 0;
  later();
});
const nb$ = new Choice<string>($('#p-nb'), (v) => {
  S.nb = Number(v);
  later();
});
const cam$ = new Choice<string>($('#p-cam'), (v) => {
  const c = CAMS.find((x) => x[0] === v);
  if (c) G.set('tr', c[2]);
});
const tes$ = new Choice<string>($('#p-tes'), (v) => G.set('te', 1 / Number(v)));
const rev = $('#t-rev');
rev.addEventListener('click', () => {
  S.rev = rev.getAttribute('aria-pressed') !== 'true';
  rev.setAttribute('aria-pressed', String(S.rev));
  later();
});
storeToggle(rev);
const G = new ParamGroup<Key>(PARAMS, (v) => {
  V = v;
  syncChips();
  later();
});
V = G.values();
S.subject = sub$.value;
S.dir = dir$.value === '1' ? 1 : 0;
S.nb = Number(nb$.value);

/** 機種と露光のチップを、今の値に合うものだけ押した状態にする */
function syncChips(): void {
  const c = CAMS.find((x) => Math.abs(x[2] - V.tr) < 1e-9);
  cam$.set(c ? c[0] : '');
  const r = 1 / V.te;
  const t = [8000, 2000, 500, 125, 60, 30].find((x) => Math.abs(x - r) / x < 0.01);
  tes$.set(t ? String(t) : '');
}
function showRows(): void {
  const rows = SUBJECT_ROWS[S.subject] as readonly string[];
  for (const el of $$('[data-rows]')) el.hidden = el.dataset.rows !== S.subject;
  rev.hidden = !rows.includes('rev');
}
showRows();
syncChips();

function inputs(): Inputs {
  const s = S.subject;
  return {
    tr: V.tr,
    te: V.te,
    t: TIME_KEY[s] ? V[TIME_KEY[s] as Key] : 0,
    rps: V.rpm / 60,
    nb: S.nb,
    kmh: s === 'train' ? V.vt : V.vc,
    bike: V.vb,
    vs: V.vg,
    rotor: V.rr / 60,
    dir: S.dir,
  };
}
/** 最初の行の露光の始まりの時刻 */
const t0 = (): number => {
  const k = TIME_KEY[S.subject];
  return k ? V[k] - V.tr / 2 : S.clock;
};

/* ---------- 描画 ---------- */
const cv = $<HTMLCanvasElement>('#cv');
let R: RsRenderer | null = null;
try {
  R = new RsRenderer(cv);
} catch {
  const m = $('#st-msg');
  m.textContent = 'このブラウザでは WebGL2 が使えないため、像を描けません。計算結果は使えます。';
  m.hidden = false;
}

function size(): void {
  const w = Math.max(160, Math.min(1600, Math.round(cv.clientWidth * Math.min(2, devicePixelRatio || 1))));
  const h = Math.round((w * 9) / 16);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
}
new ResizeObserver(() => later()).observe(cv);

new IntersectionObserver(([e]) => {
  visible = e.isIntersecting;
  if (visible) later();
}).observe(cv);
document.addEventListener('visibilitychange', () => later());

/** 走査 1 回に掛ける実時間 [s]。画面の同じ所が 1 秒に 2 回より速く明暗を変えないように延ばす */
function scanWall(p: Inputs): number {
  if (V.tr === 0) return 0.6;
  return Math.max(SCAN_MIN, (flicker(S.subject, p) * V.tr) / 2);
}

function draw(): void {
  if (!R) return;
  size();
  const p = inputs();
  const cut = S.phase >= 1 ? 1 : S.phase;
  const start = t0();
  const [speed, viewH] = fastest(S.subject, p);
  const f: Frame = {
    subject: S.subject,
    p,
    nb: S.nb,
    rev: S.rev,
    t0: start,
    dir: S.dir,
    cut,
    now: start + cut * V.tr,
    k: Math.ceil((speed * V.te * cv.height) / viewH / 1.2),
  };
  R.draw(f);
  const pct = Math.round(cut * 100);
  $('#trk-f').style.width = `${pct}%`;
  $('#trk-t').style.left = `${pct}%`;
  $('#trk').setAttribute('aria-valuenow', String(pct));
  $('#o-row').textContent = `${pct}%`;
  $('#o-t').textContent = sig3(cut * V.tr * 1e3);
  $('#o-tag').textContent = S.phase >= 1 ? '撮れた像' : '読み出し中';
}

function showMetrics(): void {
  const ms = metrics(S.subject, inputs());
  $$('#met .m').forEach((el, i) => {
    const [name, v, u] = ms[i];
    const dt = $('dt', el);
    if (dt.textContent !== name) dt.textContent = name;
    $('dd', el).innerHTML = `${v === null ? '—' : sig3(v)}<span class="u">${u}</span>`;
  });
  const [n0, v0, u0] = ms[0];
  $('#o-key').textContent = `${n0} ${v0 === null ? '—' : sig3(v0)} ${u0}`;
}

/* ---------- 再生 ---------- */
function later(): void {
  if (!raf) raf = requestAnimationFrame(frame);
}
function frame(ts: number): void {
  raf = 0;
  const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
  last = ts;
  const p = inputs();
  if (S.play && visible && !document.hidden) {
    const W = scanWall(p);
    S.phase += dt / W;
    if (S.phase > 1 + HOLD / W) {
      S.phase = 0;
      next();
    }
  } else last = 0;
  showMetrics();
  draw();
  if (S.play && visible && !document.hidden) later();
}
/** 次のコマへ進める。題材の時刻を入力で決める題材は、その入力を進めて範囲の端で頭へ戻す */
function next(): void {
  const k = TIME_KEY[S.subject];
  if (!k) {
    S.clock += FRAME;
    return;
  }
  const [a, b] = T_RANGE[S.subject] ?? [0, 1];
  const v = V[k] + FRAME;
  G.set(k, v > b ? a : v);
}

const pp = $('#pp');
function setPlay(on: boolean): void {
  S.play = on;
  pp.classList.toggle('on', on);
  pp.setAttribute('aria-label', on ? '走査の停止' : '走査の再生');
  if (on && S.phase >= 1) S.phase = 0;
  last = 0;
  later();
}
pp.addEventListener('click', () => setPlay(!S.play));
setPlay(S.play);
if (S.play) S.phase = 0;

/* 読み出した行の位置をドラッグ・矢印キーで決める（再生は止める） */
const trk = $('#trk');
const seek = (x: number) => {
  setPlay(false);
  S.phase = Math.min(1, Math.max(0, x));
  later();
};
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  const r = trk.getBoundingClientRect();
  seek((e.clientX - r.left) / r.width);
});
trk.addEventListener('pointermove', (e) => {
  if (!trk.hasPointerCapture(e.pointerId)) return;
  const r = trk.getBoundingClientRect();
  seek((e.clientX - r.left) / r.width);
});
trk.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
  if (e.key === 'Home') seek(0);
  else if (e.key === 'End') seek(1);
  else if (d) seek(Math.min(1, S.phase) + d * (e.shiftKey ? 0.1 : 0.02));
  else return;
  e.preventDefault();
});

later();

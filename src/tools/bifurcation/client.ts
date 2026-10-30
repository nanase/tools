/**
 * 分岐図のページの入口: 入力（写像・r・初めの値）→ クモの巣図・分岐図・時系列・リアプノフ指数・計算結果・Feigenbaum の表。
 * r は分岐図とリアプノフ指数の上のドラッグ、数値の行、掃引の再生のどれからでも変わり、4 面と音が同じ r を使う
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { minus } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { MapAudio } from './audio';
import { BifFig, type BifState, type Col, drawCob, drawTs, LyFig, lamAt, readCol } from './fig';
import { type Cascade, cascade, iterate, MAPS, type MapId, period } from './map';
import {
  FEIG_LEVELS,
  type Key,
  MAP_INFO,
  MELODY_LO,
  MELODY_OCT,
  MELODY_RATE,
  R,
  rPatch,
  SWEEP_S,
  type View,
  VOL,
  WAVE_RATE,
  X0,
  ZOOMS,
} from './params';
import type { Scale, SoundMode } from './sound';

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

/* ---------- 状態 ---------- */
const S = {
  map: 'logistic' as MapId,
  r: R.v,
  x0: X0.v,
  /** 拡大の範囲（null は写像の既定の範囲）と、戻すための履歴 */
  view: null as View | null,
  hist: [] as (View | null)[],
  /** δ 倍の拡大の段（0 は使っていない） */
  lev: 0,
  rev: null as number | null,
  box: null as BifState['box'],
};
const m = () => MAPS[S.map];
const defView = (): View => {
  const [r0, r1] = m().view;
  return { r0, r1, y0: 0, y1: 1 };
};
const curView = (): View => S.view ?? defView();

/** 滑らかな写像の超安定な周期 2ⁿ の値と、半周期先の値と極大の差 d（α の元） */
const CAS: Partial<Record<MapId, Cascade & { d: number[] }>> = {};
function cas(id: MapId): (Cascade & { d: number[] }) | null {
  const mm = MAPS[id];
  if (!mm.smooth) return null;
  let c = CAS[id];
  if (!c) {
    const k = cascade(mm, 11);
    c = { ...k, d: k.R.map((r, n) => (n > 0 ? iterate(mm, r, mm.c, 2 ** (n - 1)) - mm.c : Number.NaN)) };
    CAS[id] = c;
  }
  return c;
}

/* ---------- 入力 ---------- */
let ready = false;
const audio = new MapAudio();
const P = new ParamGroup<Key>([R, X0, VOL], (v, k) => {
  S.x0 = v.x0;
  audio.vol(v.vol);
  if (k === 'r') setR(v.r, false);
  else if (ready) redraw();
});
S.r = P.get('r');
S.x0 = P.get('x0');

const mapCh = new Choice<MapId>($('#p-map'), (v) => setMap(v, true));
const spdCh = new Choice<string>($('#p-spd'));
const flipCh = new Choice<string>($('#p-flip'), () => {
  if (S.lev) zoomTo(feigView(S.lev), false);
});
const modeCh = new Choice<SoundMode>($('#p-mode'), () => {
  offs();
  send();
  outs();
});
const scaleCh = new Choice<Scale>($('#p-scale'), () => send());
const dragCh = new Choice<string>($('#b-mode'), (v) => {
  $('.a-fig').classList.toggle('zoomdrag', v === 'z');
});

function offs(): void {
  scaleCh.setOff(modeCh.value !== 'melody', modeCh.value !== 'melody' ? '旋律のときだけ使います' : '');
}

/** 写像を変える。user なら r を表示の範囲の中の同じ割合の位置へ移す */
function setMap(id: MapId, user: boolean): void {
  if (id === S.map) return;
  const old = m(),
    fr = (S.r - old.view[0]) / (old.view[1] - old.view[0]);
  S.map = id;
  P.update('r', rPatch(id));
  S.view = null;
  S.hist = [];
  S.lev = 0;
  const mm = m();
  if (user) setR(mm.view[0] + Math.min(1, Math.max(0, fr)) * (mm.view[1] - mm.view[0]));
  else setR(Math.min(mm.hi, Math.max(mm.lo, S.r)));
  syncZoom();
  paintFt();
}

/** r を変える（範囲に収め、数値の行と音に伝える） */
function setR(v: number, toRow = true): void {
  const mm = m();
  S.r = Math.min(mm.hi, Math.max(mm.lo, v));
  if (toRow) P.set('r', Number(S.r.toPrecision(9)), { silent: true });
  send();
  redraw();
}

/* ---------- 拡大 ---------- */
const zoomBtns = $$<HTMLButtonElement>('#b-zoom .chip');
function zoomTo(v: View | null, push = true): void {
  if (push) S.hist.push(S.view);
  S.view = v;
  const w = curView();
  if (S.r < w.r0 || S.r > w.r1) setR(w.r0 + 0.55 * (w.r1 - w.r0));
  syncZoom();
  redraw();
}
function syncZoom(): void {
  const logi = S.map === 'logistic';
  zoomBtns.forEach((b, i) => {
    const z = ZOOMS[i][1];
    b.disabled = !logi && i > 0;
    b.setAttribute('aria-pressed', String(z === S.view || (i === 0 && S.view === null)));
  });
  ($('#b-feig') as HTMLButtonElement).disabled = !cas(S.map);
  ($('#b-back') as HTMLButtonElement).disabled = S.hist.length === 0;
  txt('#fg-aux', S.lev ? `段 ${S.lev}` : '');
  paintFt();
}
zoomBtns.forEach((b, i) => {
  b.addEventListener('click', () => {
    S.lev = 0;
    zoomTo(ZOOMS[i][1]);
  });
});
$('#b-back').addEventListener('click', () => {
  if (!S.hist.length) return;
  S.view = S.hist.pop() ?? null;
  S.lev = 0;
  syncZoom();
  redraw();
});

/**
 * Feigenbaum の段 n の範囲: 超安定な R[n] の少し手前から集積点の先まで、縦は極大のまわりの枝の幅 d[n] の数倍。
 * 段ごとに横は δ 倍、縦は α 倍に縮み、枝の向きが入れ替わる（「そろえる」なら上下を反転して向きをそろえる）
 */
function feigView(n: number): View {
  const C = cas(S.map) as Cascade & { d: number[] },
    Rn = C.R,
    d = C.d[n],
    c = m().c;
  const r0 = Rn[n] - 0.35 * (Rn[n] - Rn[n - 1]),
    r1 = C.rInf + 1.1 * (C.rInf - Rn[n]);
  const lo = c + Math.min(0, d) * 1.45 - Math.abs(d) * 0.45,
    hi = c + Math.max(0, d) * 1.45 + Math.abs(d) * 0.45;
  return {
    r0,
    r1,
    y0: Math.max(0, lo),
    y1: Math.min(1, hi),
    flip: flipCh.value === '1' && d > 0,
    deep: 2 ** Math.max(0, n - 2),
  };
}
function feigGo(n: number): void {
  const C = cas(S.map);
  if (!C) return;
  S.lev = n;
  zoomTo(feigView(n));
  setR(C.R[n]);
}
$('#b-feig').addEventListener('click', () => feigGo(S.lev >= FEIG_LEVELS ? 1 : S.lev + 1));

/* ---------- Feigenbaum の表 ---------- */
const ft = $('#ft');
function paintFt(): void {
  const C = cas(S.map);
  if (!C) {
    ft.innerHTML = '<caption class="ft-none">テント写像は極大が折れ目なので、周期倍分岐の段がありません</caption>';
    return;
  }
  const f = (v: number, n: number) => (Number.isFinite(v) ? v.toFixed(n) : '');
  const sym = MAP_INFO[S.map].sym;
  let h = `<thead><tr><th><i>n</i></th><th>周期</th><th>超安定な <i>${sym}</i></th><th><i>δ</i><sub><i>n</i></sub></th><th><i>α</i><sub><i>n</i></sub></th></tr></thead><tbody>`;
  const N = Math.min(9, C.R.length - 1);
  for (let n = 1; n <= N; n++)
    h += `<tr data-n="${n}"${n === S.lev ? ' class="on"' : ''} title="${n <= FEIG_LEVELS ? 'この段へ拡大' : ''}"><td>${n}</td><td>${2 ** n}</td><td>${f(C.R[n], 9)}</td><td>${f(C.delta[n], 5)}</td><td>${f(C.alpha[n], 5)}</td></tr>`;
  h += `<tr class="lim"><td>∞</td><td></td><td><b>${C.rInf.toFixed(9)}</b></td><td>4.66920</td><td>2.50291</td></tr></tbody>`;
  ft.innerHTML = h;
}
ft.addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-n]');
  if (!tr) return;
  const n = Number(tr.dataset.n);
  if (n >= 1 && n <= FEIG_LEVELS) feigGo(n);
  else if (n > FEIG_LEVELS) {
    const C = cas(S.map);
    if (C) setR(C.R[n]);
  }
});

/* ---------- 図 ---------- */
let col: Col = readCol();
const bif = new BifFig($<HTMLCanvasElement>('#cv-bif')),
  ly = new LyFig($<HTMLCanvasElement>('#cv-ly')),
  cvCob = $<HTMLCanvasElement>('#cv-cob'),
  cvTs = $<HTMLCanvasElement>('#cv-ts');
const state = (): BifState => {
  const mm = m();
  return {
    m: mm,
    span: mm.view[1] - mm.view[0],
    v: curView(),
    r: S.r,
    x0: S.x0,
    sym: MAP_INFO[S.map].sym,
    rev: S.rev,
    box: S.box,
  };
};
let raf = 0;
function redraw(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    draw();
  });
}
let lam = 0,
  per = 0;
function draw(): void {
  const s = state();
  lam = lamAt(s.m, S.r, S.x0);
  per = period(s.m, S.r, S.x0);
  bif.draw(s, col);
  ly.draw(s, lam, col);
  drawCob(cvCob, s, col);
  drawTs(cvTs, s, col);
  outs();
}

/* ---------- 計算結果 ---------- */
const lamText = (v: number) => (v < -9 ? '−∞' : minus(v.toFixed(3)));
function outs(): void {
  const sym = MAP_INFO[S.map].sym,
    rs = S.r.toFixed(5),
    ps = per ? String(per) : lam > 0.001 ? 'カオス' : DASH;
  html('#b-eq', MAP_INFO[S.map].eq);
  txt('#b-sym', sym);
  txt('#m-sym', sym);
  html('#o-symt', `<i>${sym}</i>`);
  txt('#b-r', rs);
  txt('#o-r', rs);
  txt('#m-r', rs);
  txt('#b-lam', lamText(lam));
  txt('#o-lam', lamText(lam));
  txt('#m-lam', lamText(lam));
  txt('#o-p', ps);
  txt('#m-p', ps);
  let hz: string;
  if (modeCh.value === 'melody') hz = `${MELODY_LO}〜${MELODY_LO * 2 ** MELODY_OCT}<span class="u">Hz</span>`;
  else if (per > 1) hz = `${(WAVE_RATE / per).toFixed(1)}<span class="u">Hz</span>`;
  else if (per === 1) hz = '無音';
  else hz = '雑音';
  html('#o-hz', hz);
  const v = curView(),
    t = Math.max(0, Math.min(1, (S.r - v.r0) / (v.r1 - v.r0)));
  $('#b-fill').style.width = `${(100 * t).toFixed(2)}%`;
  $('#b-th').style.left = `${(100 * t).toFixed(2)}%`;
  txt('#b-rr', `${sym} ${v.r0.toFixed(4)} → ${v.r1.toFixed(4)}`);
  txt('#b-t', `${(t * SWEEP_S).toFixed(1)} / ${SWEEP_S.toFixed(1)} s`);
}

/* ---------- 図の上のドラッグ ---------- */
const cvBif = bif.cv,
  cvLy = ly.cv;
function rAt(cv: HTMLCanvasElement, fr: { l: number; pw: number } | null, x: number): number {
  const v = curView();
  if (!fr) return S.r;
  const b = cv.getBoundingClientRect();
  return Math.min(v.r1, Math.max(v.r0, v.r0 + ((x - b.left - fr.l) / fr.pw) * (v.r1 - v.r0)));
}
function userR(v: number): void {
  stopSweep();
  setR(v);
}
let drag: 'r' | 'z' | null = null;
cvBif.addEventListener('pointerdown', (e) => {
  if (!bif.P) return;
  cvBif.setPointerCapture(e.pointerId);
  const b = cvBif.getBoundingClientRect();
  if (dragCh.value === 'z') {
    drag = 'z';
    S.box = { x0: e.clientX - b.left, y0: e.clientY - b.top, x1: e.clientX - b.left, y1: e.clientY - b.top };
    return;
  }
  drag = 'r';
  userR(rAt(cvBif, bif.P, e.clientX));
});
cvBif.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag === 'r') userR(rAt(cvBif, bif.P, e.clientX));
  else if (S.box) {
    const b = cvBif.getBoundingClientRect();
    S.box.x1 = e.clientX - b.left;
    S.box.y1 = e.clientY - b.top;
    redraw();
  }
});
const endDrag = () => {
  const bx = S.box,
    P0 = bif.P;
  if (drag === 'z' && bx && P0 && Math.abs(bx.x1 - bx.x0) > 8 && Math.abs(bx.y1 - bx.y0) > 8) {
    const v = curView(),
      ra = (px: number) => v.r0 + ((Math.min(P0.l + P0.pw, Math.max(P0.l, px)) - P0.l) / P0.pw) * (v.r1 - v.r0),
      fy = (py: number) => Math.min(1, Math.max(0, (py - P0.t) / P0.ph)),
      ya = (py: number) => (v.flip ? v.y0 + fy(py) * (v.y1 - v.y0) : v.y1 - fy(py) * (v.y1 - v.y0)),
      a = ya(bx.y0),
      b = ya(bx.y1);
    S.box = null;
    S.lev = 0;
    zoomTo({
      r0: ra(Math.min(bx.x0, bx.x1)),
      r1: ra(Math.max(bx.x0, bx.x1)),
      y0: Math.min(a, b),
      y1: Math.max(a, b),
      flip: v.flip,
      deep: v.deep,
    });
  }
  S.box = null;
  drag = null;
  redraw();
};
cvBif.addEventListener('pointerup', endDrag);
cvBif.addEventListener('pointercancel', endDrag);
cvBif.addEventListener('keydown', (e) => {
  const v = curView(),
    st = (v.r1 - v.r0) / (e.shiftKey ? 20 : 400);
  let r: number | null = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') r = S.r + st;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') r = S.r - st;
  else if (e.key === 'Home') r = v.r0;
  else if (e.key === 'End') r = v.r1;
  if (r == null) return;
  e.preventDefault();
  userR(Math.min(v.r1, Math.max(v.r0, r)));
});
let dragLy = false;
cvLy.addEventListener('pointerdown', (e) => {
  if (!ly.P) return;
  dragLy = true;
  cvLy.setPointerCapture(e.pointerId);
  userR(rAt(cvLy, ly.P, e.clientX));
});
cvLy.addEventListener('pointermove', (e) => {
  if (dragLy) userR(rAt(cvLy, ly.P, e.clientX));
});
cvLy.addEventListener('pointerup', () => (dragLy = false));
cvLy.addEventListener('pointercancel', () => (dragLy = false));

/* ---------- 掃引 ---------- */
const pp = $('#b-pp'),
  trk = $('#b-trk');
let playing = false,
  last = 0;
function setSt(): void {
  html('#b-st', playing ? '<span class="led on" aria-hidden="true"></span>掃引中' : '');
  pp.classList.toggle('on', playing);
  pp.setAttribute('aria-label', playing ? '一時停止' : '掃引');
}
function stopSweep(): void {
  if (!playing && S.rev == null) return;
  playing = false;
  S.rev = null;
  setSt();
  redraw();
}
function tick(now: number): void {
  if (!playing) return;
  const v = curView(),
    dt = Math.min(0.1, (now - last) / 1000) * Number(spdCh.value);
  last = now;
  const r = S.r + ((v.r1 - v.r0) * dt) / SWEEP_S;
  if (r >= v.r1) {
    S.rev = null;
    playing = false;
    setR(v.r1);
    setSt();
    return;
  }
  S.rev = r;
  setR(r);
  requestAnimationFrame(tick);
}
pp.addEventListener('click', () => {
  if (playing) {
    playing = false;
    S.rev = null;
    setSt();
    redraw();
    return;
  }
  const v = curView();
  if (S.r >= v.r1 - 1e-12) setR(v.r0);
  playing = true;
  last = performance.now();
  S.rev = S.r;
  setSt();
  requestAnimationFrame(tick);
});
$('#b-home').addEventListener('click', () => {
  stopSweep();
  setR(curView().r0);
});
let dragTrk = false;
const trkAt = (x: number) => {
  const b = trk.getBoundingClientRect(),
    v = curView(),
    t = Math.min(1, Math.max(0, (x - b.left) / b.width));
  return v.r0 + t * (v.r1 - v.r0);
};
trk.addEventListener('pointerdown', (e) => {
  dragTrk = true;
  trk.setPointerCapture(e.pointerId);
  userR(trkAt(e.clientX));
});
trk.addEventListener('pointermove', (e) => {
  if (dragTrk) userR(trkAt(e.clientX));
});
trk.addEventListener('pointerup', () => (dragTrk = false));
trk.addEventListener('pointercancel', () => (dragTrk = false));
trk.addEventListener('keydown', (e) => {
  const v = curView(),
    st = (v.r1 - v.r0) / (e.shiftKey ? 10 : 100);
  if (e.key === 'ArrowRight') userR(Math.min(v.r1, S.r + st));
  else if (e.key === 'ArrowLeft') userR(Math.max(v.r0, S.r - st));
  else return;
  e.preventDefault();
});

/* ---------- 音 ---------- */
const playBtn = $('#playBtn');
function send(): void {
  const mode = modeCh.value;
  audio.send({
    map: S.map,
    r: S.r,
    mode,
    rate: mode === 'wave' ? WAVE_RATE : MELODY_RATE,
    lo: MELODY_LO,
    oct: MELODY_OCT,
    scale: scaleCh.value,
  });
}
async function setSound(on: boolean): Promise<void> {
  send();
  const ok = await audio.set(on);
  const now = on && ok;
  playBtn.setAttribute('aria-pressed', String(now));
  $('#sndLed').classList.toggle('on', now);
  txt('#snd-msg', on && !ok ? 'このブラウザでは音を鳴らせません' : '');
  if (on && !ok) await audio.set(false);
}
playBtn.addEventListener('click', () => void setSound(!audio.on));
/* スマートフォンとタブレットでは、画面が隠れたら止める（lib/pause.ts の理由と同じ） */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld() && audio.on) void setSound(false);
});

/* ---------- 色と大きさ ---------- */
const recolor = () => {
  col = readCol();
  redraw();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
let rt: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
  clearTimeout(rt);
  rt = setTimeout(redraw, 60);
}).observe($('.quad'));

/* ---------- 始める ---------- */
S.map = mapCh.value;
P.update('r', rPatch(S.map));
S.r = Math.min(m().hi, Math.max(m().lo, P.get('r')));
offs();
syncZoom();
ready = true;
redraw();

/**
 * カルマンフィルタのページの入口: 入力 → 追跡（本当の台車・距離計・フィルタ）を requestAnimationFrame で実時間に合わせて進める
 * → 線路の図・位置と速度の楕円・位置の分布・誤差の時間波形・計算結果
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmtR, plain, ro } from '../../lib/format';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { errSvg, gaussSvg, phaseSvg, step125, trackSvg } from './fig';
import { qDwna, type Sym, steady } from './kf';
import { FILT, type FiltKey, facText, SCENES, TRUE, type TrueKey } from './params';
import { type Phase, type Setup, SPAN, Tracker } from './sim';

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
const num = (v: number, sig = 4) => plain(v, sig, true);

/* ---------- 入力 ---------- */
type Key = TrueKey | FiltKey;
/** 変えると始め直す項目（初めの状態を決めるもの） */
const RESTART = new Set<string>(['v0', 'sp0', 'sv0']);
let V = {} as Record<Key, number>;
let tr: Tracker | null = null;
const P = new ParamGroup<Key>([...TRUE, ...FILT], (v, k) => {
  V = v;
  if (tr && k) changed(k);
});
V = P.values();
const tsCh = new Choice<string>($('#p-ts'), () => changed('T'));
const spdCh = new Choice<string>($('#p-spd'));
const sceneCh = new Choice<string>($('#p-scene'), (v) => applyScene(v));

const setup = (): Setup => ({
  T: Number(tsCh.value),
  sa: V.sa,
  sz: V.sz,
  v0: V.v0,
  fq: V.fq,
  fr: V.fr,
  sp0: V.sp0,
  sv0: V.sv0,
});

function changed(k: string): void {
  if (!tr) return;
  tr.u = setup();
  offs();
  syncScene();
  if (RESTART.has(k)) restart(15);
  else {
    win();
    draw(true);
  }
}
/** 本当の加速度のゆらぎが 0 なら、過程雑音の倍率は使わない */
function offs(): void {
  P.setOff('fq', V.sa === 0, V.sa === 0 ? '本当の加速度のゆらぎが 0 なので使いません' : '');
}
function applyScene(v: string): void {
  const s = SCENES.find((x) => x.v === v);
  if (!s || !tr) return;
  for (const [k, x] of Object.entries(s.vals)) P.set(k as Key, x, { silent: true });
  V = P.values();
  tr.u = setup();
  offs();
  restart(s.warm);
}
/** 今の値と一致する場面を選んだ表示にする */
function syncScene(): void {
  const s = SCENES.find((x) => Object.entries(x.vals).every(([k, v]) => V[k as Key] === v));
  sceneCh.set(s?.v ?? '');
}

/* ---------- 図の窓 ---------- */
/** 位置と速度の平面の半幅（定常の予測の広がりの 4 倍。本当の雑音とフィルタの見積りの大きい方）と、位置の分布の山の高さ */
let hx0 = 1,
  hv0 = 1,
  pk = 1,
  ssF: { pri: Sym; post: Sym; K: [number, number] } | null = null;
function win(): void {
  if (!tr) return;
  const u = tr.u,
    sT = steady(u.T, u.sa * u.sa, u.sz * u.sz, u.sp0, u.sv0);
  ssF = steady(u.T, tr.q(), tr.R(), u.sp0, u.sv0);
  hx0 = Math.max(0.3, 4 * Math.sqrt(sT.pri[0]), 4 * Math.sqrt(ssF.pri[0]), 3 * u.sz);
  hv0 = Math.max(0.3, 4 * Math.sqrt(sT.pri[2]), 4 * Math.sqrt(ssF.pri[2]));
  /* 過程雑音が 0 なら推定は細り続けるので、縦は出している山に合わせる */
  pk = tr.q() > 0 ? 1 / Math.sqrt(2 * Math.PI * Math.max(ssF.post[0], 1e-12)) : 0;
  subst();
}
/** 図の中心と半幅（滑らかに追う） */
const cam = { p: 0, v: 0, hx: 1, hv: 1 };
function camTarget(): typeof cam {
  if (!tr) return cam;
  const f = tr.f,
    w = tr.w,
    m = tr.phase === 'upd' ? f.x : f.pri.x;
  return {
    p: m[0],
    v: m[1],
    /* 本当の状態が窓から出ないように広げる */
    hx: Math.max(hx0, Math.abs(w.p - m[0]) * 1.25),
    hv: Math.max(hv0, Math.abs(w.v - m[1]) * 1.25),
  };
}

/* ---------- 描く ---------- */
const PH_TEXT: Record<Phase, string> = {
  pred: '予測しました。楕円が予測で膨らみました',
  obs: '観測しました。観測の帯が楕円に重なりました',
  upd: '更新しました。予測と観測を掛け合わせ、楕円が縮みました',
};
function draw(snap = false): void {
  if (!tr) return;
  const t = camTarget();
  if (snap) Object.assign(cam, t);
  const f = tr.f,
    w = tr.w,
    ph = tr.phase,
    post = ph === 'upd' ? { x: f.x, P: f.P } : null,
    est = post ?? f.pri,
    R = tr.R(),
    showObs = ph !== 'pred' && Number.isFinite(tr.z);
  $('#k-trk').innerHTML = trackSvg({
    cam: cam.p,
    span: 6,
    tru: w.p,
    est: est.x[0],
    sd: Math.sqrt(est.P[0]),
    zs: tr.zs,
  });
  $('#k-ph').innerHTML = phaseSvg({
    cx: cam.p,
    cv: cam.v,
    hx: cam.hx,
    hv: cam.hv,
    pri: f.pri,
    post,
    z: showObs ? tr.z : null,
    R,
    tru: [w.p, w.v],
    trail: tr.trail,
  });
  $('#k-mg').innerHTML = gaussSvg({
    pri: { m: f.pri.x[0], s: Math.sqrt(f.pri.P[0]) },
    obs: showObs ? { m: tr.z, s: Math.sqrt(R) } : null,
    est: post ? { m: post.x[0], s: Math.sqrt(post.P[0]) } : null,
    tru: w.p,
    lo: cam.p - cam.hx,
    hi: cam.p + cam.hx,
    K: post && w.k ? f.K[0] : null,
    pk,
  });
  /* 誤差: 縦は観測の雑音の 3 倍が 3 div に入る刻み */
  const vd = step125(Math.max(tr.u.sz, 0.01));
  html('#k-errd', errSvg(tr.hist, w.t, SPAN, vd));
  txt('#k-vd', fmtR(vd, 'm', 3));
  for (const s of $$('#k-phs span')) s.classList.toggle('on', s.dataset.p === ph);
  txt('#k-k', String(w.k));
  txt('#k-t', `${w.t.toFixed(1)} s`);
  $('#k-ph').setAttribute(
    'aria-label',
    `位置と速度の平面。推定 位置 ${num(est.x[0], 3)} m・速度 ${num(est.x[1], 3)} m/s、本当の位置 ${num(w.p, 3)} m・速度 ${num(w.v, 3)} m/s`,
  );
}
function outputs(): void {
  if (!tr) return;
  const f = tr.f,
    st = tr.stats(),
    est = tr.phase === 'upd' ? f.P : f.pri.P,
    still = tr.u.sa === 0 && tr.u.sv0 === 0;
  html('#o-rms', st ? ro(st.rms, 'm', 4) : DASH);
  txt('#o-rmss', st ? `観測だけなら ${fmtR(st.orms, 'm', 4)}（直近 ${st.n} 回）` : 'まだ観測していません');
  /* 更新した回数（予測と観測の段では、K はひとつ前の更新のもの） */
  const k = tr.phase === 'upd' ? tr.w.k : tr.w.k - 1;
  html('#o-kp', k ? num(f.K[0]) : DASH);
  txt(
    '#o-kps',
    still && k
      ? `止まった台車では 1/(k + R̂/σp0²) = 1/(${k} + ${num(tr.R() / (tr.u.sp0 * tr.u.sp0), 3)}) = ${num(1 / (k + tr.R() / (tr.u.sp0 * tr.u.sp0)))}`
      : ssF
        ? `定常 ${num(ssF.K[0])}`
        : '',
  );
  html('#o-kv', k ? `${num(f.K[1])}<span class="u">s⁻¹</span>` : DASH);
  txt('#o-kvs', ssF ? `定常 ${num(ssF.K[1])} s⁻¹` : '');
  html('#o-sp', ro(Math.sqrt(est[0]), 'm', 4));
  txt('#o-sps', `予測では ${fmtR(Math.sqrt(f.pri.P[0]), 'm', 4)}`);
  html('#o-sv', ro(Math.sqrt(est[2]), 'm/s', 4));
  txt('#o-svs', `予測では ${fmtR(Math.sqrt(f.pri.P[2]), 'm/s', 4)}`);
  if (st && st.n >= 15) {
    const bad = st.nis > st.band[1],
      low = st.nis < st.band[0];
    html(
      '#o-nis',
      `${num(st.nis, 3)}<span class="vd${bad ? ' bad' : ''}">${bad ? '過信（誤差が見積りの範囲をはみ出す）' : low ? '慎重すぎ（見積りの範囲が広すぎる）' : '見積りと合っている'}</span>`,
    );
    txt('#o-niss', `合っていれば ${num(st.band[0], 3)}〜${num(st.band[1], 3)} に入る（95 %、直近 ${st.n} 回）`);
  } else {
    html('#o-nis', DASH);
    txt('#o-niss', '15 回観測すると判定する');
  }
  txt('#m-rms', st ? fmtR(st.rms, 'm', 3) : DASH);
  txt('#m-kp', k ? num(f.K[0], 3) : DASH);
  txt('#m-nis', st ? num(st.nis, 3) : DASH);
  html('#k-st', running ? '<span class="led on" aria-hidden="true"></span>動作中' : '');
}

/* ---------- 代入した式 ---------- */
const mat = (rows: string[][]) =>
  `<mrow><mo>[</mo><mtable>${rows.map((r) => `<mtr>${r.map((c) => `<mtd>${c}</mtd>`).join('')}</mtr>`).join('')}</mtable><mo>]</mo></mrow>`;
const mn = (v: number) => `<mn>${v === 0 || v === 1 ? v : plain(v, 4, true)}</mn>`;
function subst(): void {
  const el = document.getElementById('subst');
  if (!el || !tr || !ssF) return;
  const u = tr.u,
    Q = qDwna(u.T, tr.q());
  el.innerHTML =
    `<math display="block"><mi>F</mi><mo>=</mo>${mat([
      [mn(1), mn(u.T)],
      [mn(0), mn(1)],
    ])}<mo>,</mo><mspace width="1em"/><mover><mi>Q</mi><mo>^</mo></mover><mo>=</mo>${mat([
      [mn(Q[0]), mn(Q[1])],
      [mn(Q[1]), mn(Q[2])],
    ])}<mo>,</mo><mspace width="1em"/><mover><mi>R</mi><mo>^</mo></mover><mo>=</mo>${mn(tr.R())}</math>` +
    `<math display="block"><msub><mi>K</mi><mi>∞</mi></msub><mo>=</mo>${mat([[mn(ssF.K[0])], [mn(ssF.K[1])]])}</math>`;
  el.setAttribute(
    'aria-label',
    `今の値を代入した式。Q̂ は本当の値の ${facText(u.fq)}、R̂ は本当の値の ${facText(u.fr)}。定常のカルマンゲイン ${num(ssF.K[0])}、${num(ssF.K[1])}`,
  );
}

/* ---------- 動かす ---------- */
let running = false,
  raf = 0,
  last = 0,
  acc = 0,
  lastOut = 0;
function loop(now: number): void {
  raf = 0;
  if (!tr) return;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  let stepped = false;
  if (running) {
    acc += dt * Number(spdCh.value);
    for (let i = 0; acc >= tr.u.T && i < 8; i++) {
      tr.full();
      acc -= tr.u.T;
      stepped = true;
    }
    if (acc > tr.u.T) acc = 0;
  }
  /* 図の中心と幅を滑らかに追う */
  const t = camTarget(),
    a = 1 - Math.exp(-dt * 8);
  let moving = false;
  for (const key of ['p', 'v', 'hx', 'hv'] as const) {
    const d = t[key] - cam[key];
    if (Math.abs(d) > 1e-4 * (key === 'p' || key === 'hx' ? cam.hx : cam.hv)) {
      cam[key] += d * a;
      moving = true;
    } else cam[key] = t[key];
  }
  if (stepped || moving) draw();
  if (stepped && now - lastOut > 150) {
    lastOut = now;
    outputs();
  }
  if (running || moving) raf = requestAnimationFrame(loop);
}
function kick(): void {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(loop);
}
function setRun(on: boolean): void {
  running = on;
  acc = 0;
  const pp = $('#k-pp');
  pp.classList.toggle('on', on);
  pp.title = on ? '止める' : '動かす';
  pp.setAttribute('aria-label', on ? '止める' : '動かす');
  outputs();
  kick();
}
function restart(n: number): void {
  if (!tr) return;
  tr.reset();
  tr.warm(n);
  win();
  draw(true);
  outputs();
}
$('#k-pp').addEventListener('click', () => setRun(!running));
$('#k-home').addEventListener('click', () => {
  setRun(false);
  restart(0);
});
$('#k-step').addEventListener('click', () => {
  if (!tr) return;
  if (running) setRun(false);
  tr.step();
  txt('#k-live', PH_TEXT[tr.phase]);
  draw();
  outputs();
  kick();
});

/* ---------- 起動 ---------- */
tr = new Tracker(setup());
offs();
restart(15);
/* 保存した値を戻したあと（マイクロタスク）にもう一度合わせる */
queueMicrotask(() => {
  if (!tr) return;
  tr.u = setup();
  offs();
  syncScene();
  restart(SCENES.find((s) => s.v === sceneCh.value)?.warm ?? 15);
  /* 動きを減らす設定では、動かすボタンを押すまで動かさない */
  setRun(!RM.matches);
});

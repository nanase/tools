/**
 * 倒立振子のページの入口: 入力 → 模型と制御器の設計 → シミュレーション（requestAnimationFrame で実時間に合わせて進める）
 * → 台車と振子の図・時間波形・極の配置図・計算結果
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmt, fmtR, minus, plain, ro } from '../../lib/format';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import type { Unit } from '../../lib/parse';
import { DV, ScopeView, SH, SW } from '../../lib/scope';
import { store } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { BAND_HOLD, BAND_TH, BAND_X, type Ctrl, type EvKind, type Kind, REC_N, type Sense, Sim } from './control';
import { Figure, type Target } from './fig';
import type { C } from './linalg';
import { driveOf, G, linearize, type Plant, rodLen } from './model';
import {
  DRIVE,
  type DriveKey,
  LQR,
  PID,
  PID_UNITS,
  type PidKey,
  PLACE,
  PLANT,
  type PlantKey,
  PRESETS,
  PUSH,
  SENSE,
  SWING,
} from './params';
import { maxAbs, ROWS, rollPath, splane, vdiv } from './plot';

initToolPage();

const D2R = Math.PI / 180;
const DASH = '—';
const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};
/** 符号つきの数（+0.3・−12.5）。0 は符号なし */
const signed = (v: number, d: number) => {
  const s = Math.abs(v).toFixed(d);
  return Number(s) === 0 ? s : `${v < 0 ? '−' : '+'}${s}`;
};

/* ---------- 入力 ---------- */
const DEFS = [...PLANT, ...DRIVE, ...SENSE, ...LQR, ...PLACE, ...PID, ...SWING, PUSH];
const PLANT_KEYS = new Set<string>([...PLANT, ...DRIVE].map((d) => d.k));
const SENSE_KEYS = new Set<string>(SENSE.map((d) => d.k));
let V: Record<string, number> = {};
let sim: Sim | null = null;
const P = new ParamGroup<string>(DEFS, (v, k) => {
  V = v;
  if (sim && k) changed(k);
});
V = P.values();

const kindCh = new Choice<Kind>($('#p-kind'), () => {
  showGroups();
  applyCtrl();
});
const swingCh = new Choice<'on' | 'off'>($('#p-swing'), () => {
  showGroups();
  applyCtrl();
});
const driveCh = new Choice<Plant['drive']>($('#p-drive'), () => applyDrive());
const tsCh = new Choice<string>($('#p-ts'), () => applySense());
const cprCh = new Choice<string>($('#p-cpr'), () => applySense());
const spdCh = new Choice<string>($('#p-spd'), () => status());
/* 教材の選択は値から決まるので保存しない */
$('#p-pre').setAttribute('data-nosave', '');
const preCh = new Choice<string>($('#p-pre'), (v) => applyPreset(v));

const plant = (): Plant => ({
  M: V.M,
  m: V.m,
  l: V.l / 1000,
  /* kg·cm² → kg·m² */
  J: V.J * 1e-4,
  bc: V.bc,
  fc: V.fc,
  bp: V.bp,
  rail: V.rail,
  drive: driveCh.value,
  umax: driveCh.value === 'motor' ? V.vmax : V.fmax,
  /* mN·m/A → N·m/A */
  kt: V.kt / 1000,
  rm: V.rm,
  kg: V.kg,
  rp: V.rp / 1000,
  /* g·cm² → kg·m² */
  jm: V.jm * 1e-7,
});
const ctrl = (): Ctrl => ({
  kind: kindCh.value,
  swing: swingCh.value === 'on',
  q: [V.qx, V.qt, V.qv, V.qw],
  r: V.r,
  w1: V.w1,
  z1: V.z1,
  w2: V.w2,
  z2: V.z2,
  kpa: V.kpa,
  kia: V.kia,
  kda: V.kda,
  kpx: V.kpx,
  kix: V.kix,
  kdx: V.kdx,
  ke: V.ke,
  amax: V.amax,
  thsw: V.thsw * D2R,
  th0: V.th0 * D2R,
});
const sense = (): Sense => ({
  ts: Number(tsCh.value) / 1000,
  cpr: Number(cprCh.value),
  xres: V.xres * 1e-6,
  fv: V.fv,
  nth: V.nth * D2R,
  nx: V.nx / 1000,
});
const isMotor = () => driveCh.value === 'motor';
/** 入力の単位（電圧か力） */
const uU = () => (isMotor() ? 'V' : 'N');

function showGroups(): void {
  const k = kindCh.value,
    sw = swingCh.value === 'on';
  $('#g-lqr').hidden = k !== 'lqr';
  $('#g-place').hidden = k !== 'place';
  $('#g-pid').hidden = k !== 'pid';
  $('#g-swing').hidden = !sw;
  $('#g-th0').hidden = sw;
}

/* ---------- 図 ---------- */
const fig = new Figure($<SVGSVGElement>('#pfig'), (t, dir, at) => push(t, dir, at));
const geo = () => {
  const p = plant();
  return { rail: p.rail, rod: rodLen(p), l: p.l };
};
/** 力の矢印の基準: 止まっているときに出せる最大の力 */
const fref = () => {
  const p = plant();
  return driveOf(p).alpha * p.umax;
};

/* ---------- 変更 ---------- */
function changed(k: string): void {
  if (!sim) return;
  if (PLANT_KEYS.has(k)) applyPlant();
  else if (SENSE_KEYS.has(k)) applySense();
  else if (k !== 'push') applyCtrl();
}
function applyPlant(): void {
  if (!sim) return;
  sim.setPlant(plant());
  fig.setGeo(geo());
  syncPreset();
  designOut();
  frame(performance.now());
}
function applyCtrl(): void {
  if (!sim) return;
  sim.setCtrl(ctrl());
  designOut();
  frame(performance.now());
}
function applySense(): void {
  sim?.setSense(sense());
}
function applyDrive(): void {
  const motor = isMotor(),
    u = uU();
  for (const k of ['vmax', 'kt', 'rm', 'kg', 'rp', 'jm'] as DriveKey[])
    P.setOff(k, !motor, motor ? '' : '力で駆動するときは使いません');
  P.setOff('fmax', motor, motor ? 'DC モータで駆動するときは使いません' : '');
  for (const k of Object.keys(PID_UNITS) as PidKey[]) P.update(k, { unit: PID_UNITS[k].replace('{u}', u) as Unit });
  $('#sc2-ch2').hidden = !motor;
  $('#sc2 .t2').setAttribute('d', '');
  applyPlant();
}
function applyPreset(v: string): void {
  const p = PRESETS.find((x) => x.v === v);
  if (!p) return;
  for (const [k, x] of Object.entries(p.vals)) P.set(k, x, { silent: true });
  V = P.values();
  driveCh.set(p.drive);
  store('c:p-drive', p.drive);
  applyDrive();
  reset();
}
/** 教材の値と一致していれば、その教材を選んだ表示にする */
function syncPreset(): void {
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const p = PRESETS.find(
    (x) => x.drive === driveCh.value && Object.entries(x.vals).every(([k, v]) => same(V[k as PlantKey], v)),
  );
  preCh.set(p?.v ?? '');
}

/* ---------- 計算結果（設計） ---------- */
const num = (v: number, sig = 4) => plain(v, sig, true);
const poleText = (ps: readonly C[]) => {
  const L: string[] = [];
  for (const p of ps) {
    if (p.im < -1e-9) continue;
    L.push(Math.abs(p.im) > 1e-9 ? `${num(p.re)} ± ${num(Math.abs(p.im))}j` : num(p.re));
  }
  return L.join('<span class="sep">、</span>');
};
/* 構造から決まる 0 と 1 はそのまま、計算した値は末尾の 0 を残す */
const mrow = (v: readonly number[]) => v.map((x) => `<mtd><mn>${x === 0 || x === 1 ? x : num(x)}</mn></mtd>`).join('');
const mmat = (rows: readonly (readonly number[])[]) =>
  `<mrow><mo>[</mo><mtable>${rows.map((r) => `<mtr>${mrow(r)}</mtr>`).join('')}</mtable><mo>]</mo></mrow>`;

function designOut(): void {
  if (!sim) return;
  const p = sim.p,
    ds = sim.ds,
    u = uU(),
    pu = ds.ol.filter((x) => x.re > 1e-9 && Math.abs(x.im) < 1e-9).sort((a, b) => b.re - a.re)[0];
  html('#o-p', pu ? ro(pu.re, 's⁻¹', 4) : DASH);
  txt(
    '#o-ps',
    pu ? `√(g/l) = ${fmtR(Math.sqrt(G / p.l), 's⁻¹', 4)}。傾きが 2 倍になるまで ${fmtR(Math.LN2 / pu.re, 's', 3)}` : '',
  );
  if (ds.K) {
    const unstable = ds.cl.some((x) => x.re > 1e-9);
    html('#o-cl', ds.cl.length ? `${poleText(ds.cl)}<span class="u">s⁻¹</span>` : DASH);
    txt(
      '#o-cls',
      unstable
        ? '右半面に極があり、線形の模型でも倒れる'
        : `線形の模型では安定${kindCh.value === 'pid' && ds.cl.length > 4 ? '（積分の極を含む）' : ''}`,
    );
    const units = [`${u}/m`, `${u}/rad`, `${u}·s/m`, `${u}·s/rad`];
    html('#o-k', ds.K.map((k, i) => `<span class="kv">${num(k)}<span class="u">${units[i]}</span></span>`).join(''));
    txt(
      '#o-ks',
      kindCh.value === 'lqr'
        ? 'u = −Kx、リカッチ方程式の解から'
        : kindCh.value === 'place'
          ? 'u = −Kx、アッカーマンの式から'
          : 'PID と等価な u = −Kx（積分を除く）',
    );
  } else {
    html('#o-cl', DASH);
    txt('#o-cls', ds.err);
    html('#o-k', DASH);
    txt('#o-ks', ds.err);
  }
  /* 極の配置図 */
  const sp = splane(ds.ol, ds.cl, (v) => minus(String(Number(v.toPrecision(3)))));
  $('#sp-ol').setAttribute('d', sp.ol);
  $('#sp-cl').setAttribute('d', sp.cl);
  html('#sp-ax', sp.axes);
  txt('#sp-d', `${plain(sp.d, 3)} s⁻¹`);
  const out = $('#sp-out');
  out.hidden = !sp.out;
  out.textContent = sp.out ? `枠の外に ${sp.out} 個` : '';
  $('#sp-svg').setAttribute(
    'aria-label',
    `s 平面の極。開ループ ${ds.ol.map((x) => `${num(x.re, 3)}${Math.abs(x.im) > 1e-9 ? `±${num(Math.abs(x.im), 3)}j` : ''}`).join('、')}。閉ループ ${ds.cl.map((x) => `${num(x.re, 3)}${Math.abs(x.im) > 1e-9 ? `±${num(Math.abs(x.im), 3)}j` : ''}`).join('、')}。1 div ${plain(sp.d, 3)} s⁻¹`,
  );
  /* 代入した式 */
  const { A, B } = linearize(p);
  let h = `<math display="block"><mi>A</mi><mo>=</mo>${mmat(A)}<mo>,</mo><mspace width="1em"/><mi>B</mi><mo>=</mo>${mmat(B.map((b) => [b]))}</math>`;
  if (ds.K) h += `<math display="block"><mi>K</mi><mo>=</mo>${mmat([ds.K])}</math>`;
  html('#subst', h);
}

/* ---------- 時間波形 ---------- */
new ScopeView($('#sc1'));
new ScopeView($('#sc2'));
interface Ch {
  /** 記録の配列、表示の単位への倍率、目盛りの下限、単位、±の境で線を切るか */
  buf: 'th' | 'x' | 'f' | 'u';
  k: number;
  lo: number;
  unit: string;
  wrap?: number;
  vd?: number;
}
const scopes: { id: string; c1: Ch; c2: Ch; axKey: string }[] = [
  {
    id: 'sc1',
    c1: { buf: 'th', k: 180 / Math.PI, lo: 0.5, unit: '°', wrap: 180 },
    c2: { buf: 'x', k: 1, lo: 0.001, unit: 'm' },
    axKey: '',
  },
  { id: 'sc2', c1: { buf: 'f', k: 1, lo: 0.5, unit: 'N' }, c2: { buf: 'u', k: 1, lo: 0.5, unit: 'V' }, axKey: '' },
];
const unitText = (v: number, u: string) => (u === '°' ? `${plain(v, 3)}°` : fmt(v, u, 3));
for (const sc of scopes) $(`#${sc.id} .s-td`).textContent = '1 s';

function drawScopes(): void {
  if (!sim) return;
  const r = sim.rec,
    start = (r.i - r.len + REC_N) % REC_N;
  for (const sc of scopes) {
    const root = $(`#${sc.id}`),
      motor = isMotor();
    for (const [ch, cls] of [
      [sc.c1, '.t1'],
      [sc.c2, '.t2'],
    ] as const) {
      if (sc.id === 'sc2' && cls === '.t2' && !motor) continue;
      const buf = r[ch.buf];
      ch.vd = vdiv(maxAbs(buf, start, r.len, ch.k), ch.lo, ch.vd);
      $(cls, root).setAttribute('d', r.len > 1 ? rollPath(buf, start, r.len, ch.k, ch.vd, ch.wrap ?? 0) : '');
    }
    const key = `${sc.c1.vd}|${sc.c2.vd}`;
    if (key === sc.axKey) continue;
    sc.axKey = key;
    const vd1 = sc.c1.vd ?? 1,
      y0 = SH / 2;
    let a = '';
    for (let i = 0; i <= 10; i += 2)
      a += `<text x="${i * DV}" y="${SH + 17}" text-anchor="middle">${i === 10 ? '0' : `−${10 - i} s`}</text>`;
    for (let j = -ROWS / 2; j <= ROWS / 2; j++)
      a += `<text x="-10" y="${y0 - j * DV + 4}" text-anchor="end">${j ? minus(unitText(j * vd1, sc.c1.unit)) : '0'}</text>`;
    a += `<path class="mk1" d="M-8 ${y0 - 5}L-1 ${y0}L-8 ${y0 + 5}Z"/><path class="mk2 c2x" d="M${SW + 8} ${y0 - 5}L${SW + 1} ${y0}L${SW + 8} ${y0 + 5}Z"/>`;
    html(`#${sc.id} .axes`, a);
    txt(`#${sc.id} .s-vd`, unitText(vd1, sc.c1.unit));
    txt(`#${sc.id} .s-vd2`, unitText(sc.c2.vd ?? 1, sc.c2.unit));
    $(`#${sc.id} svg`).setAttribute(
      'aria-label',
      sc.id === 'sc1'
        ? `角度と位置の時間波形（直近 10 s）。CH1 角度 ${unitText(vd1, '°')}/div、CH2 位置 ${unitText(sc.c2.vd ?? 1, 'm')}/div`
        : `力と電圧の時間波形（直近 10 s）。CH1 力 ${unitText(vd1, 'N')}/div${isMotor() ? `、CH2 電圧 ${unitText(sc.c2.vd ?? 1, 'V')}/div` : ''}`,
    );
  }
}
function clearScopes(): void {
  for (const sc of scopes) {
    sc.c1.vd = sc.c2.vd = undefined;
    sc.axKey = '';
  }
}

/* ---------- 状態と測定 ---------- */
const MODE = { swing: '振り上げ中', bal: '安定化中', fall: '倒れた（制御を止めた）' } as const;
const EV: Record<EvKind, string> = {
  start: '手を離してから',
  catch: '振り上げて切り替えてから',
  push: '押してから',
  fall: '倒れてから',
};
let lastMode = '';
let lastHit = -1e9;
function status(): void {
  if (!sim) return;
  const s = sim.s,
    th = ((((s[1] + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI,
    spd = Number(spdCh.value);
  txt('#st-mode', MODE[sim.mode]);
  txt('#st-t', `${sim.t.toFixed(2)} s${spd < 1 ? `（1/${Math.round(1 / spd)}）` : ''}`);
  txt('#st-th', `${signed(th / D2R, 1)}°`);
  txt('#st-x', `${signed(s[0] * 1000, 1)} mm`);
  if (sim.hit) lastHit = performance.now();
  $('#st-hit').hidden = performance.now() - lastHit > 300;
  if (sim.mode !== lastMode) {
    if (lastMode)
      txt(
        '#pf-live',
        sim.mode === 'bal'
          ? sim.tUp !== null && sim.ev.k === 'catch'
            ? `振り上げて立てました（${fmtR(sim.tUp, 's', 3)}）`
            : '安定化しています'
          : sim.mode === 'swing'
            ? '倒れたので振り上げ直します'
            : '倒れました。制御を止めています',
      );
    lastMode = sim.mode;
  }
}

/** 測定の結果（出来事からの整定時間・最大の力など） */
function measureOut(): void {
  if (!sim) return;
  const ev = EV[sim.ev.k],
    sw = swingCh.value === 'on';
  html('#o-ts', sim.settle !== null ? ro(sim.settle, 's', 3) : DASH);
  txt(
    '#o-tss',
    sim.mode === 'fall'
      ? '倒れました（制御を止めています）'
      : sim.mode === 'swing'
        ? '振り上げています'
        : sim.settle !== null
          ? `${ev}、角度 ±${BAND_TH / D2R}°・位置 ±${BAND_X * 1000} mm に入って ${BAND_HOLD} s 留まるまで`
          : `${ev}。まだ収まっていません`,
  );
  html('#o-tu', sim.tUp !== null ? ro(sim.tUp, 's', 3) : DASH);
  txt(
    '#o-tus',
    !sw ? '振り上げていません' : sim.mode === 'swing' ? '振り上げています' : '真下から切り替えるまで（最後の振り上げ）',
  );
  html('#o-fm', ro(sim.fmax, 'N', 3));
  txt('#o-fms', isMotor() ? `${ev}。電圧の最大 ${fmtR(sim.umaxSeen, 'V', 3)}` : ev);
  html('#o-xm', ro(sim.xmax, 'm', 3));
  txt('#o-xms', `${ev}。レールの端まで ${fmtR(sim.p.rail / 2, 'm', 3)}`);
  txt('#mts', sim.settle !== null ? fmtR(sim.settle, 's', 3) : DASH);
  txt('#mtu', sim.tUp !== null ? fmtR(sim.tUp, 's', 3) : DASH);
  txt('#mfm', fmtR(sim.fmax, 'N', 3));
}

/* ---------- 動かす ---------- */
let running = false,
  raf = 0,
  last = 0,
  lastOut = 0;
function frame(now: number): void {
  if (!sim) return;
  fig.draw(sim.s[0], sim.s[1], sim.F, fref(), now);
  drawScopes();
  status();
  if (now - lastOut > 150) {
    lastOut = now;
    measureOut();
  }
}
function loop(now: number): void {
  raf = 0;
  if (!sim) return;
  if (running) {
    /* 裏に回っていたときなどの大きな間は詰める */
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    sim.advance(dt * Number(spdCh.value));
  }
  frame(now);
  if (running || fig.pushing(now)) raf = requestAnimationFrame(loop);
}
function kick(): void {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(loop);
}
function setRun(on: boolean): void {
  running = on;
  $('#runBtn').setAttribute('aria-pressed', String(on));
  $('#runLed').classList.toggle('on', on);
  txt('#runT', on ? '停止' : '開始');
  if (on) kick();
  else {
    measureOut();
    frame(performance.now());
  }
}
$('#runBtn').addEventListener('click', () => setRun(!running));

function reset(): void {
  if (!sim) return;
  sim.reset();
  clearScopes();
  lastMode = '';
  measureOut();
  frame(performance.now());
}
$('#resetSim').addEventListener('click', reset);

/** 押す。止めているときは動かし始める */
function push(t: Target, dir: 1 | -1, at?: [number, number]): void {
  if (!sim) return;
  sim.push(dir * V.push, t.cart ? null : t.r);
  fig.showPush(at ?? fig.pushPoint(t, dir), dir, performance.now());
  txt('#pf-live', `${t.cart ? '台車' : '振子'}を${dir > 0 ? '右' : '左'}へ押しました`);
  measureOut();
  if (!running) setRun(true);
  else kick();
}
for (const b of $$<HTMLButtonElement>('.pushbar [data-push]'))
  b.addEventListener('click', () => {
    const dir = Number(b.dataset.dir) > 0 ? 1 : -1;
    push(b.dataset.push === 'cart' ? { cart: true } : { cart: false, r: rodLen(plant()) }, dir);
  });
$('#pfig').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const dir = e.key === 'ArrowRight' ? 1 : -1;
  push(e.shiftKey ? { cart: true } : { cart: false, r: rodLen(plant()) }, dir);
});

/* ---------- 起動 ---------- */
showGroups();
sim = new Sim(plant(), ctrl(), sense());
applyDrive();
reset();
/* 保存した値を戻したあと（マイクロタスク）にもう一度合わせる */
queueMicrotask(() => {
  showGroups();
  syncPreset();
  /* 動きを減らす設定では、押すか開始のボタンを押すまで動かさない */
  setRun(!RM.matches);
});

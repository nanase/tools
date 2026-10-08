/**
 * IIR フィルタのページの入口: 入力 → 設計 → 計算結果・周波数特性・極と零点・時間応答・係数・代入式、
 * 試聴（Web Audio。再生装置のサンプリング周波数で設計し直した双2次の縦続）
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { same } from '../../lib/eseries';
import { fmt, fmtR, parts, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { DV, SW } from '../../lib/scope';
import { storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { LV_HOT, lvX } from '../biquad/plot';
import { type Kind, NMAX, type Resp } from './analog';
import { abs, type C, scale } from './complex';
import { type Design, design, isBand, type Metrics, type Mode, metrics, type Spec } from './design';
import {
  analogTime,
  type Curve,
  cumsum,
  impinv,
  impulseBA,
  impulsePF,
  impulseSOS,
  pfToBA,
  type Quant,
  quantize,
  respBA,
  respPF,
  respS,
  respZ,
  type Section,
  type SosGain,
  type SosOrder,
  toBA,
  toSOS,
  zRoots,
} from './digital';
import { baMath, substHtml } from './math';
import {
  apLabel,
  CMP_AB,
  type Cmp,
  EDGES,
  type EdgeKey,
  edgeLabel,
  edgePatch,
  FMIN,
  hzT,
  type Key,
  kindOf,
  PARAMS,
  QUANTS,
  respAb,
} from './params';
import { type FView, fixed, freqAxis, frPlot, pzPlot, sig, sRange, TH, timePlot } from './plot';
import { isStable } from './poly';

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
initToolPage();

/* ---------- 知らせ ---------- */
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  delete t.dataset.off;
  clearTimeout(toastT);
  toastT = setTimeout(() => {
    t.dataset.off = '';
  }, 2600);
}

/* ---------- 選択肢（保存した値は生成のときに戻る） ---------- */
type TView = 'imp' | 'step';
type SView = 'proto' | 'ana';
const kind$ = new Choice<Kind>($('#p-kind'), (v) => {
  kind = v;
  applyState();
  schedule();
});
const resp$ = new Choice<Resp>($('#p-resp'), (v) => {
  resp = v;
  applyState();
  schedule();
});
const mode$ = new Choice<Mode>($('#p-mode'), (v) => {
  mode = v;
  applyState();
  schedule();
});
const fview$ = new Choice<FView>($('#fview'), (v) => {
  fview = v;
  $('#p-bot').hidden = v !== 'mag';
  drawFr();
});
const cmp$ = new Choice<Cmp>($('#p-cmp'), (v) => {
  cmp = v;
  cmp$.note('');
  if (st) {
    C2 = cmpOf(st);
    drawAll();
  }
});
const qz$ = new Choice<string>($('#p-qz'), (v) => {
  qz = v as Quant;
  if (!st) return;
  if (cmp === 'dq') C2 = cmpOf(st);
  showResults();
  drawAll();
});
const xs$ = new Choice<string>($('#p-xs'), (v) => {
  xlog = v === 'log';
  drawFr();
});
const tview$ = new Choice<TView>($('#tview'), (v) => {
  tview = v;
  drawTm();
});
const len$ = new Choice<string>($('#p-len'), (v) => {
  len = Number(v);
  if (st) {
    retime(st);
    C2 = cmpOf(st);
  }
  drawTm();
});
const sv$ = new Choice<SView>($('#p-sv'), (v) => {
  sview = v;
  drawPz();
});
const cview$ = new Choice<string>($('#cview'), (v) => {
  $('#v-sos').hidden = v !== 'sos';
  $('#v-ba').hidden = v !== 'ba';
  renderBA();
});
const sord$ = new Choice<SosOrder>($('#p-sord'), (v) => {
  sord = v;
  resos();
});
const sgain$ = new Choice<SosGain>($('#p-sgain'), (v) => {
  sgain = v;
  resos();
});

let kind = kind$.value,
  resp = resp$.value,
  mode = mode$.value,
  fview = fview$.value,
  cmp = cmp$.value,
  qz = qz$.value as Quant,
  xlog = xs$.value !== 'lin',
  tview = tview$.value,
  len = Number(len$.value),
  sview = sv$.value,
  sord = sord$.value,
  sgain = sgain$.value;
$('#p-bot').hidden = fview !== 'mag';
$('#v-sos').hidden = cview$.value !== 'sos';
$('#v-ba').hidden = cview$.value !== 'ba';

/* ---------- 入力の値 ---------- */
let g: ParamGroup<Key> | null = null;
const val = (k: Key): number => g?.get(k) ?? NaN;

/** 端の周波数の並び（小さい順）。次数を指定するときは基準の端だけ */
function chain(): EdgeKey[] {
  if (mode === 'order') return isBand(resp) ? ['f1', 'f2'] : ['f1'];
  switch (resp) {
    case 'lp':
      return ['f1', 's1'];
    case 'hp':
      return ['s1', 'f1'];
    case 'bp':
      return ['s1', 'f1', 'f2', 's2'];
    case 'bs':
      return ['f1', 's1', 's2', 'f2'];
  }
}
/** 並びが崩れたときに使う、f1 に対する比 */
function template(): number[] {
  if (mode === 'order') return isBand(resp) ? [1, 2] : [1];
  return { lp: [1, 2], hp: [0.5, 1], bp: [0.5, 1, 2, 4], bs: [1, 1.6, 2.5, 4] }[resp];
}
function chainValid(ks: readonly EdgeKey[], fs: number): boolean {
  let prev = 0;
  for (const k of ks) {
    const v = val(k);
    if (!(v > prev * (1 + 1e-9)) || v < FMIN) return false;
    prev = v;
  }
  return prev < (fs / 2) * (1 - 1e-9);
}

/** 応答・設計の方法を変えて端の並びが崩れたら、f1 を基準に作り直す */
function reconcile(): void {
  const G = g;
  if (!G) return;
  const ks = chain(),
    fs = val('fs');
  if (chainValid(ks, fs)) return;
  const t = template(),
    base = val('f1') / t[ks.indexOf('f1')];
  let vs = t.map((r) => base * r);
  const top = vs[vs.length - 1];
  if (top >= (fs / 2) * 0.95) vs = vs.map((v) => (v * fs * 0.4) / top);
  if (vs[0] < FMIN) vs = vs.map((v) => (v * FMIN) / vs[0]);
  vs = vs.map((v) => Number(v.toPrecision(3)));
  let first: EdgeKey | null = null;
  ks.forEach((k, i) => {
    if (same(val(k), vs[i])) return;
    G.set(k, vs[i], { silent: true });
    first ??= k;
  });
  if (first) G.note(first, '端の並びに合わせて、周波数を直しました', 'er');
}

/** 項目名の短い記号（メッセージ用） */
const nmOf = (k: EdgeKey) => edgeLabel(k, kind, resp, mode).nm;

/** 端の行の範囲を、隣の端と fs/2 で決め直す */
function patchEdges(): void {
  const G = g;
  if (!G) return;
  const ks = chain(),
    fs = val('fs');
  for (const k of EDGES) {
    const i = ks.indexOf(k),
      lab = edgeLabel(k, kind, resp, mode);
    if (i < 0) {
      G.update(k, lab);
      continue;
    }
    const lo = i ? val(ks[i - 1]) : 0,
      hi = i < ks.length - 1 ? val(ks[i + 1]) : fs / 2;
    const loName = i ? `${nmOf(ks[i - 1])}（${hzT(lo)}）` : '',
      hiName = i < ks.length - 1 ? `${nmOf(ks[i + 1])}（${hzT(hi)}）` : `fs/2 = ${hzT(fs / 2)}`;
    G.update(k, { ...edgePatch(val(k), lo, hi, loName, hiName), ...lab });
  }
}

/** 近似・応答・設計の方法に合わせて、行の見え方・項目名・範囲を整える */
function applyState(): void {
  const box = $('#iin');
  box.dataset.mode = mode;
  box.dataset.kind = kind;
  box.toggleAttribute('data-band', isBand(resp));
  g?.update('ap', apLabel(kind));
  reconcile();
  patchEdges();
  /* インパルス不変法は高域で減衰しない HPF・BSF には使えない */
  const noImp = resp === 'hp' || resp === 'bs';
  cmp$.disable('imp', noImp);
  if (!noImp) cmp$.note('');
  else if (cmp === 'imp') {
    cmp = 'ana';
    cmp$.set('ana');
    cmp$.note('HPF・BSF ではインパルス不変法を使えないため、アナログと比べます', 'er');
  }
}

function spec(): Spec {
  return {
    kind,
    resp,
    mode,
    n: val('n'),
    f1: val('f1'),
    f2: val('f2'),
    s1: val('s1'),
    s2: val('s2'),
    ap: val('ap'),
    as: val('as'),
    fs: val('fs'),
  };
}

/* ---------- 設計と比べるもの ---------- */
/** 時間応答を求める長さ（表示長 + 1 div） */
const nT = () => (len * 9) / 8 + 1;

interface State {
  D: Design;
  M: Metrics;
  S: Section[];
  b: number[];
  a: number[];
  /** CH1 のインパルス応答・ステップ応答 */
  h: Float64Array;
  s: Float64Array;
}
interface Cmp2 {
  name: string;
  curve: (f: ArrayLike<number>) => Curve;
  h: Float64Array;
  s: Float64Array;
  /** z 平面に重ねる零点・極 */
  zz: C[] | null;
  zp: C[] | null;
}
let st: State | null = null,
  C2: Cmp2 | null = null;

function cmpOf(S: State): Cmp2 | null {
  const { D } = S,
    fs = D.spec.fs;
  switch (cmp) {
    case 'ana': {
      const t = analogTime(D.ana0, fs, nT());
      return { name: CMP_AB.ana, curve: (f) => respS(D.ana0, f, fs), h: t.h, s: t.s, zz: null, zp: null };
    }
    case 'imp': {
      if (D.spec.resp === 'hp' || D.spec.resp === 'bs') return null;
      const pf = impinv(D.ana0, fs),
        h = impulsePF(pf, nT());
      return {
        name: CMP_AB.imp,
        curve: (f) => respPF(pf, f, fs),
        h,
        s: cumsum(h),
        zz: zRoots(pfToBA(pf).b),
        zp: pf.q,
      };
    }
    case 'dq': {
      const b = S.b.map((x) => quantize(x, qz)),
        a = S.a.map((x) => quantize(x, qz)),
        h = impulseBA(b, a, nT());
      return {
        name: CMP_AB.dq,
        curve: (f) => respBA(b, a, f, fs),
        h,
        s: cumsum(h),
        zz: zRoots(b),
        zp: zRoots(a),
      };
    }
  }
}

let pending = false;
/** 同じタスクの中の変更をまとめて 1 回だけ計算する */
function schedule(): void {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    compute();
  });
}

function compute(): void {
  if (!g) return;
  let D: Design;
  try {
    D = design(spec());
  } catch {
    return;
  }
  const M = metrics(D),
    S = toSOS(D.dig, sord, sgain),
    { b, a } = toBA(D.dig);
  st = { D, M, S, b, a, h: new Float64Array(0), s: new Float64Array(0) };
  retime(st);
  C2 = cmpOf(st);
  showResults();
  renderCoef();
  renderBA();
  html('#subst', substHtml(D, symOf));
  drawAll();
  setIIR();
}

/** CH1 の時間応答を、今の表示長まで求める */
function retime(S: State): void {
  S.h = impulseSOS(S.S, nT());
  S.s = cumsum(S.h);
}

function resos(): void {
  if (!st) return;
  st.S = toSOS(st.D.dig, sord, sgain);
  renderCoef();
}

function drawAll(): void {
  drawFr();
  drawPz();
  drawTm();
}

/* ---------- 計算結果 ---------- */
const QN: Record<string, string> = Object.fromEntries(QUANTS.map(([v, l]) => [v, v === 'f32' ? l : `有効数字 ${l}`]));
const hzR = (v: number) => (Number.isFinite(v) ? ro(v, 'Hz', 4) : '—');
const dbR = (v: number | null) => (v == null ? '—' : `${sig(v, 4, true)}<span class="u">dB</span>`);

function showResults(): void {
  if (!st) return;
  const { D, M, S, a } = st,
    s = D.spec,
    band = isBand(s.resp);
  txt('#o-n', String(D.N));
  const head =
    s.mode === 'order'
      ? '指定した次数'
      : D.exact != null && !D.short
        ? `仕様を満たす最小の次数（${sig(D.exact, 4, true)} を切り上げ）`
        : '仕様を満たす最小の次数';
  txt('#o-ns', `${head}。フィルタの次数 ${band ? 2 * D.N : D.N}、双2次 ${S.length} 段`);
  txt('#o-nw', D.short ? `上限の ${NMAX} 次でも仕様を満たしません` : '');
  html('#o-f3', M.f3.map(hzR).join('<br>'));
  html('#o-rip', dbR(M.ripple));
  html('#o-att', dbR(M.atten));
  html('#o-fst', M.fst ? M.fst.map(hzR).join('<br>') : '—');
  if (M.gd) {
    html('#o-gd', `${sig(M.gd[0], 4, true)} – ${sig(M.gd[1], 4, true)}<span class="u">サンプル</span>`);
    txt('#o-gds', `${fmtR(M.gd[0] / s.fs, 's', 4)} – ${fmtR(M.gd[1] / s.fs, 's', 4)}`);
  } else {
    html('#o-gd', '—');
    txt('#o-gds', '');
  }
  txt('#o-qn', QN[qz]);
  const ok = isStable(a.map((x) => quantize(x, qz)));
  html('#o-dq', ok ? '<span class="ok">安定</span>' : '<span class="ng">不安定</span>');
  /* 要約の帯 */
  txt('#mt', `${kindOf(s.kind).ab} ${respAb(s.resp)}`);
  txt('#mN', String(D.N));
  txt('#mf3', M.f3.map((v) => (Number.isFinite(v) ? fmt(v, 'Hz', 4) : '—')).join(' – '));
  $('#mxs').hidden = M.atten == null;
  if (M.atten != null) txt('#mas', `${sig(M.atten, 3)} dB`);
}

/* ---------- 係数 ---------- */
const DEG = (x: C) => Math.atan2(x.im, x.re);
/** 根の表記: 複素数は |r|∠±f、実数は値 */
function rootText(rs: readonly C[], fs: number): string {
  if (!rs.length) return '—';
  if (rs.length === 2 && Math.abs(rs[0].im) > 0 && Math.abs(rs[0].im + rs[1].im) < 1e-12 * (1 + abs(rs[0])))
    return `${sig(abs(rs[0]), 6, true)}∠±${fmtR((Math.abs(DEG(rs[0])) * fs) / (2 * Math.PI), 'Hz', 4)}`;
  return rs.map((r) => sig(r.re, 6, true)).join(', ');
}
function renderCoef(): void {
  if (!st) return;
  const fs = st.D.spec.fs;
  html(
    '#sos-b',
    st.S.map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td class="pz">${rootText(s.p, fs)}</td><td class="pz">${rootText(s.z, fs)}</td>${[
          s.b[0],
          s.b[1],
          s.b[2],
          s.a[1],
          s.a[2],
        ]
          .map((v) => `<td>${sig(v, 10, true)}</td>`)
          .join('')}<td>${fixed(s.peak, 2)} dB</td></tr>`,
    ).join(''),
  );
}
/** 直接形の係数と、丸めたときの極（直接形を出しているときだけ。根を求めるので重い） */
function renderBA(): void {
  if (!st || $('#v-ba').hidden) return;
  const { b, a } = st,
    n = a.length - 1;
  html('#ba-h', baMath(n));
  html(
    '#ba-b',
    a.map((_, k) => `<tr><td>${k}</td><td>${sig(b[k], 12, true)}</td><td>${sig(a[k], 12, true)}</td></tr>`).join(''),
  );
  /* 極は倍精度の多項式の根、安定かどうかは丸めた係数そのままでの Schur–Cohn の判定 */
  const rows = [['f64', '丸めなし（float64）'], ...QUANTS.map(([v]) => [v, QN[v]])].map(
    ([v, l]): [string, number, boolean] => {
      const aq = v === 'f64' ? a : a.map((x) => quantize(x, v as Quant));
      return [l, Math.max(...zRoots(aq).map(abs)), isStable(aq)];
    },
  );
  html(
    '#dq-b',
    rows
      .map(
        ([l, r, ok]) =>
          `<tr><td>${l}</td><td${r >= 1 ? ' class="ng"' : ''}>${sig(r, 8, true)}</td><td${ok ? '' : ' class="ng"'}>${ok ? '安定' : '不安定'}</td></tr>`,
      )
      .join(''),
  );
}

/* ---------- 動作原理と式 ---------- */
function symOf(k: 'f1' | 'f2'): [string, string] {
  const s = edgeLabel(k, kind, resp, mode).nm.slice(1);
  return [`<msub><mi>Ω</mi><mi>${s}</mi></msub>`, `<msub><mi>f</mi><mi>${s}</mi></msub>`];
}

/* ---------- 表示窓の共通 ---------- */
function svgX(svg: SVGSVGElement, ev: PointerEvent): number | null {
  const m = svg.getScreenCTM();
  return m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()).x : null;
}
function bindCursor(svg: SVGSVGElement, at: (x: number | null) => void): void {
  const move = (e: PointerEvent) => {
    const x = svgX(svg, e);
    if (x != null) at(x);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => at(null));
}
function bindChannel(btn: HTMLElement, box: HTMLElement, cls: string): void {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    box.classList.toggle(cls, !on);
  });
  storeToggle(btn);
}

/* ---------- 周波数特性 ---------- */
const NF = 1601;
let frX: number | null = null,
  FA: ReturnType<typeof freqAxis> | null = null;
const FV_NAME: Record<FView, string> = { mag: 'MAG', ph: 'PHASE', gd: 'DELAY' };
const vText = (v: number, view: FView) =>
  view === 'mag' ? `${fixed(v, 2)} dB` : view === 'ph' ? `${fixed(v, 1)}°` : `${sig(v, 4, true)} S`;

function drawFr(): void {
  if (!st || !g) return;
  const { D } = st,
    s = D.spec,
    nyq = s.fs / 2;
  const lo = Math.min(...chain().map((k) => val(k)));
  /* 対数の横軸の左端: いちばん低い端の 1/4 より下の 10 の累乗 */
  const f0 = 10 ** Math.floor(Math.log10(lo / 4));
  const ax = freqAxis(s.fs, xlog, f0);
  FA = ax;
  const f = new Float64Array(NF);
  for (let i = 0; i < NF; i++) f[i] = xlog ? f0 * (nyq / f0) ** (i / (NF - 1)) : (nyq * i) / (NF - 1);
  const A = respZ(D.dig, f, s.fs),
    B = C2 ? C2.curve(f) : null;
  const P = frPlot({ f, a: A, b: B, view: fview, ax, bot: val('bot'), mask: D.mask });
  html('#fr-grid', ax.grid);
  $('#fr-t1').setAttribute('d', P.t1);
  $('#fr-t2').setAttribute('d', P.t2);
  $('#fr-msk').setAttribute('d', P.mask);
  $('#fr-mskl').setAttribute('d', P.maskLine);
  html('#fr-axes', P.axes);
  txt('#fr-n1', FV_NAME[fview]);
  txt('#fr-vd', fview === 'mag' ? `${P.dv} dB` : fview === 'ph' ? '60°' : `${sig(P.dv, 3)} S`);
  txt('#fr-n2', C2 ? C2.name : '—');
  txt('#fr-xm', xlog ? 'LOG' : 'LIN');
  txt('#fr-x', `${xlog ? fmt(f0, 'Hz', 3) : '0'} – ${fmt(nyq, 'Hz', 4)}`);
  $('#fr-svg').setAttribute(
    'aria-label',
    `周波数特性（${{ mag: '振幅', ph: '位相', gd: '群遅延' }[fview]}）。横軸は ${xlog ? '対数' : '線形'}で ${xlog ? fmt(f0, 'Hz', 3) : '0 Hz'} から ${fmt(nyq, 'Hz', 4)}。`,
  );
  frCursor();
}
function frCursor(): void {
  if (!st || !FA) return;
  if (frX == null) {
    $('#fr-cur').setAttribute('d', '');
    html('#fr-rd', '');
    return;
  }
  const f = FA.F(frX),
    fs = st.D.spec.fs,
    a = respZ(st.D.dig, [f], fs),
    pick = (c: Curve) => (fview === 'mag' ? c.mag[0] : fview === 'ph' ? c.ph[0] : c.gd[0]);
  $('#fr-cur').setAttribute('d', `M${frX.toFixed(1)} 0V240`);
  const b = C2 ? pick(C2.curve([f])) : null;
  html(
    '#fr-rd',
    `CUR <b>${fmtR(f, 'Hz', 4)}</b> CH1 <b>${vText(pick(a), fview)}</b>${b == null ? '' : ` CH2 <b>${vText(b, fview)}</b>`}`,
  );
}
bindCursor($('#fr-svg'), (x) => {
  frX = x == null || x < 0 || x > SW ? null : x;
  frCursor();
});
bindChannel($('#fr-c1'), $('#fr-scope'), 'hide1');
bindChannel($('#fr-c2'), $('#fr-scope'), 'hide2');

/* ---------- 極と零点 ---------- */
const toHz = (rs: readonly C[]) => rs.map((r) => scale(r, 1 / (2 * Math.PI)));
const fShort = (v: number) => parts(v, '', 2).join('');
function drawPz(): void {
  if (!st) return;
  const { D } = st;
  /* s 平面: 原型（rad/s）か、周波数変換後（Hz） */
  let sz: C[],
    sp: C[],
    sz2: C[] | null = null,
    sp2: C[] | null = null;
  if (sview === 'proto') {
    sz = D.proto.z;
    sp = D.proto.p;
  } else {
    sz = toHz(D.ana.z);
    sp = toHz(D.ana.p);
    if (cmp === 'ana' || (cmp === 'imp' && C2)) {
      sz2 = toHz(D.ana0.z);
      sp2 = toHz(D.ana0.p);
    }
  }
  const R = sRange([...sz, ...(sz2 ?? [])], [...sp, ...(sp2 ?? [])]);
  const S = pzPlot({
    z: sz,
    p: sp,
    z2: sz2,
    p2: sp2,
    R,
    plane: 's',
    circle: sview === 'proto',
    lab: sview === 'proto' ? (v) => sig(v, 2) : fShort,
  });
  html('#ps-g', S.grid);
  html('#ps-m', S.marks);
  txt('#ps-cap', sview === 'proto' ? 's 平面（原型、rad/s）' : 's 平面（周波数変換後、Hz）');
  const Z = pzPlot({
    z: D.dig.z,
    p: D.dig.p,
    z2: C2?.zz,
    p2: C2?.zp,
    R: 1.5,
    plane: 'z',
    circle: true,
    lab: (v) => sig(v, 2),
  });
  html('#pz-g', Z.grid);
  html('#pz-m', Z.marks);
  txt('#pz-n1', '設計したフィルタ');
  const has2 = !!(sz2 || C2?.zp);
  txt('#pz-n2', has2 && C2 ? C2.name : '—');
  const pmax = Math.max(...D.dig.p.map(abs));
  $('#pz-svg').setAttribute(
    'aria-label',
    `z 平面の極と零点。極 ${D.dig.p.length} 個（最大の絶対値 ${sig(pmax, 6)}）、零点 ${D.dig.z.length} 個。`,
  );
  $('#ps-svg').setAttribute('aria-label', `s 平面の極と零点（${sview === 'proto' ? '原型' : '周波数変換後'}）。`);
}
bindChannel($('#pz-c2'), $('#pzw'), 'hide2');

/* ---------- 時間応答 ---------- */
let tmK: number | null = null,
  TP: ReturnType<typeof timePlot> | null = null;
function drawTm(): void {
  if (!st) return;
  const a = tview === 'imp' ? st.h : st.s,
    b = C2 ? (tview === 'imp' ? C2.h : C2.s) : null;
  TP = timePlot(a, b, len, tview === 'imp');
  const t1 = $('#tm-t1');
  t1.setAttribute('d', TP.t1);
  t1.setAttribute('class', tview === 'imp' ? 'stm c1x' : 't1 c1x');
  t1.style.strokeWidth = tview === 'imp' ? String(TP.width) : '';
  html('#tm-dots', TP.dots);
  $('#tm-t2').setAttribute('d', TP.t2);
  $('#tm-z').setAttribute('d', TP.zero);
  html('#tm-axes', TP.axes);
  txt('#tm-n1', tview === 'imp' ? 'h[n]' : 's[n]');
  txt('#tm-vd', String(TP.vd));
  txt('#tm-hd', String(TP.d));
  txt('#tm-n2', C2 ? C2.name : '—');
  $('#tm-svg').setAttribute(
    'aria-label',
    `${tview === 'imp' ? 'インパルス応答' : 'ステップ応答'}。n = 0 から ${len} まで、横軸 ${TP.d} サンプル/div、縦軸 ${TP.vd}/div。`,
  );
  tmCursor();
}
function tmCursor(): void {
  if (!st || !TP) return;
  if (tmK == null) {
    $('#tm-cur').setAttribute('d', '');
    html('#tm-rd', '');
    return;
  }
  const k = Math.max(0, Math.min(TP.nEnd - 1, tmK)),
    a = tview === 'imp' ? st.h : st.s,
    b = C2 ? (tview === 'imp' ? C2.h : C2.s) : null;
  $('#tm-cur').setAttribute('d', `M${TP.X(k).toFixed(1)} 0V${TH}`);
  html(
    '#tm-rd',
    `CUR <i>n</i> = <b>${k}</b> CH1 <b>${sig(a[k], 6, true)}</b>${b ? ` CH2 <b>${sig(b[k], 6, true)}</b>` : ''}`,
  );
}
bindCursor($('#tm-svg'), (x) => {
  if (!TP) return;
  tmK = x == null || x < DV - 4 || x > SW ? null : Math.round(((x - DV) / DV) * TP.d);
  tmCursor();
});
bindChannel($('#tm-c1'), $('#tm-scope'), 'hide1');
bindChannel($('#tm-c2'), $('#tm-scope'), 'hide2');

/* ---------- 試聴（ホワイトノイズ → 音量 → 双2次の縦続（IIRFilterNode）→ レベル計測） ---------- */
interface Sound {
  ctx: AudioContext;
  gain: GainNode;
  an: AnalyserNode;
  nodes: AudioNode[];
  buf: Float32Array<ArrayBuffer>;
}
let snd: Sound | null = null,
  playing = false,
  raf = 0,
  level = -Infinity;
function setVol(): void {
  if (!snd) return;
  snd.gain.gain.setTargetAtTime(10 ** (val('vol') / 20), snd.ctx.currentTime, 0.02);
}
/** 再生装置のサンプリング周波数で、画面と同じ次数のフィルタを設計し直す。端が高すぎれば比を保って下げる */
function setIIR(): void {
  if (!snd || !st) return;
  const r = snd.ctx.sampleRate,
    s = st.D.spec,
    top = Math.max(...chain().map((k) => s[k])),
    k = top >= r * 0.45 ? (r * 0.45) / top : 1;
  let S: Section[];
  try {
    const D = design({ ...s, fs: r, nFix: st.D.N, f1: s.f1 * k, f2: s.f2 * k, s1: s.s1 * k, s2: s.s2 * k });
    S = toSOS(D.dig, 'up', 'linf');
  } catch {
    return;
  }
  const nodes: AudioNode[] = [];
  try {
    for (const x of S) nodes.push(snd.ctx.createIIRFilter([...x.b], [...x.a]));
  } catch {
    return;
  }
  let prev: AudioNode = snd.gain;
  for (const n of nodes) {
    prev.connect(n);
    prev = n;
  }
  prev.connect(snd.an);
  for (const n of snd.nodes)
    try {
      n.disconnect();
    } catch {
      /* 既に切断済み */
    }
  if (snd.nodes[0])
    try {
      snd.gain.disconnect(snd.nodes[0]);
    } catch {
      /* 既に切断済み */
    }
  snd.nodes = nodes;
  txt('#lv-fs', fmt(r, 'Hz', 4) + (k < 1 ? `（周波数を ${sig(k, 3)} 倍に制限）` : ''));
}
function drawLv(v: number): void {
  const x = Number.isFinite(v) ? lvX(v) : 0,
    hot = lvX(LV_HOT);
  $('#lv-bar').setAttribute('width', Math.min(x, hot).toFixed(1));
  const h = $('#lv-hot');
  h.setAttribute('x', String(hot));
  h.setAttribute('width', Math.max(0, x - hot).toFixed(1));
  txt('#lv-t', Number.isFinite(v) && v > -120 ? fixed(v, 1) : '---');
}
function meter(): void {
  if (!snd) return;
  snd.an.getFloatTimeDomainData(snd.buf);
  let s = 0;
  for (const x of snd.buf) s += x * x;
  level = Math.max(10 * Math.log10(s / snd.buf.length), level - 0.6);
  drawLv(level);
  raf = requestAnimationFrame(meter);
}
function open(): Sound | null {
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const c = new AC(),
    n = c.sampleRate * 2,
    b = c.createBuffer(1, n, c.sampleRate),
    d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = b;
  src.loop = true;
  const s: Sound = { ctx: c, gain: c.createGain(), an: c.createAnalyser(), nodes: [], buf: new Float32Array(2048) };
  s.an.fftSize = 2048;
  src.connect(s.gain);
  s.an.connect(c.destination);
  s.gain.gain.value = 10 ** (val('vol') / 20);
  snd = s;
  setIIR();
  src.start();
  return s;
}
async function play(on: boolean): Promise<void> {
  if (on && !snd && !open()) {
    toast('この環境では音を鳴らせません');
    return;
  }
  playing = on;
  const btn = $('#playBtn');
  btn.setAttribute('aria-pressed', String(on));
  $('.led', btn).classList.toggle('on', on);
  txt('#playT', on ? '停止' : '再生');
  cancelAnimationFrame(raf);
  if (on) {
    await snd?.ctx.resume();
    raf = requestAnimationFrame(meter);
  } else {
    await snd?.ctx.suspend();
    level = -Infinity;
    drawLv(-Infinity);
  }
}
$('#playBtn').addEventListener('click', () => {
  void play(!playing);
});

/* ---------- 入力 ---------- */
g = new ParamGroup<Key>(PARAMS, (_, k) => {
  if (!k) return;
  if (k === 'vol') setVol();
  else if (k === 'bot') drawFr();
  else {
    if ((EDGES as readonly string[]).includes(k)) patchEdges();
    schedule();
  }
});
const G = g;
let lastFs = G.get('fs');
/* fs を下げて端が fs/2 を越えたら、端を fs に比例させて下げる */
G.on('fs', (fs) => {
  const top = Math.max(...chain().map((k) => G.get(k)));
  if (top >= (fs / 2) * (1 - 1e-9)) {
    const r = fs / lastFs;
    for (const k of EDGES) G.set(k, Number((G.get(k) * r).toPrecision(4)), { silent: true });
    G.note('fs', '端の周波数を fs に比例させて下げました', 'er');
  }
  lastFs = fs;
  reconcile();
  patchEdges();
});
applyState();
compute();
drawLv(-Infinity);

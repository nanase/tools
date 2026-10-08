/**
 * 極と零点のページの入口: 点の配置（ドラッグ・数値・プリセット）→ 特性と係数の計算 →
 * z 平面・周波数特性・距離と角度・インパルス応答・計算結果・係数、試聴（AudioWorklet）
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, fmtR, minus, parts, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { DV, SH, SW } from '../../lib/scope';
import { store, stored, storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { fixed, IH, type ImpPlot, impPlot, LV_HOT, lvX, sig } from '../biquad/plot';
import { PzAudio } from './audio';
import { geoMath, sosMath, tfMath } from './math';
import { type Key, L0, PARAMS, PRESET0, PRESETS, presetOf, RMAX, SEL, type SelKey, type Src } from './params';
import {
  type FrAxis,
  type FrPlot,
  frAxis,
  frPlot,
  frWs,
  labels,
  type Plane,
  plane,
  planeCursor,
  planeGrid,
  planePts,
  viewOf,
  ZS,
} from './plot';
import {
  ang,
  at,
  coefs,
  curves,
  EPS,
  freeSpot,
  type GainMode,
  gainOf,
  impulse,
  type Kind,
  LN2DB,
  order,
  type Pt,
  peak,
  polar,
  rad,
  resOf,
  type Sec,
  type Spot,
  type Stab,
  sos,
  stability,
  vectors,
  wrap,
} from './pz';

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

/* ---------- 表記 ---------- */
const D = Math.PI / 180;
/** 極・零点それぞれの根の個数の上限（共役の対は 2） */
const MAXO = 24;
const KIND: Record<Kind, string> = { p: '極', z: '零点' };
const dBh = (v: number) => `${fixed(v, 2)}<span class="u">dB</span>`;
/** ω を π の倍数で */
const wPi = (w: number) => `${fixed(w / Math.PI, 4)}π`;
/** 名前（p1・z2）を HTML に */
const nameH = (s: string, conj = false) => `<i>${s[0]}</i><sub>${s.slice(1)}</sub>${conj ? '<sup>*</sup>' : ''}`;
/** 係数: 小数 9 桁。小さすぎ・大きすぎる値は指数で */
const cf = (v: number): string => {
  const a = Math.abs(v);
  if (v === 0 || (a >= 1e-3 && a < 1e7)) return fixed(v, 9);
  const [m, e] = v.toExponential(8).split('e');
  return `${minus(m)}e${minus(String(Number(e)))}`;
};
/** 複素数の位置（有効数字 4 桁） */
const cx = (re: number, im: number): string =>
  im === 0
    ? sig(re, 4, true)
    : `${re === 0 ? '' : `${sig(re, 4, true)} ${im < 0 ? '−' : '+'} `}${re === 0 && im < 0 ? '−' : ''}j${sig(Math.abs(im), 4, true)}`;
/** 読み値の 1 項目（狭い画面では項目ごとに折り返す） */
const rd = (s: string) => `<span class="stag rd">${s}</span>`;
const stabText: Record<Stab, string> = { stable: '安定', marginal: '安定限界', unstable: '不安定' };

/* ---------- 点の並び（保存する） ---------- */
let pts: Pt[] = [];
let nid = 1;
let sel: number | null = null;
const cur = (): Pt | undefined => pts.find((p) => p.id === sel);

function load(sp: readonly Spot[]): void {
  pts = sp.map((s) => ({ ...s, id: nid++ }));
  sel = pts[0]?.id ?? null;
}
/** 保存した並び（[種類, 実部, 虚部] の配列）。読めなければ null */
function readSaved(v: unknown): Spot[] | null {
  if (!Array.isArray(v)) return null;
  const out: Spot[] = [];
  for (const e of v) {
    if (!Array.isArray(e) || e.length !== 3) return null;
    const [k, re, im] = e as unknown[];
    if ((k !== 'p' && k !== 'z') || typeof re !== 'number' || typeof im !== 'number') return null;
    if (!Number.isFinite(re) || !Number.isFinite(im) || im < 0 || Math.hypot(re, im) > RMAX + 1e-9) return null;
    out.push({ k, re, im });
  }
  return order(out, 'p') > MAXO || order(out, 'z') > MAXO ? null : out;
}
load(readSaved(stored('pts')) ?? presetOf(PRESET0)?.pts() ?? []);
const save = () =>
  store(
    'pts',
    pts.map((p) => [p.k, p.re, p.im]),
  );

/* ---------- 表示の状態 ---------- */
/** 周波数特性のカーソル（単位円の上の点 e^{jω}） */
let w = Math.PI / 3;
let P: Plane = plane(viewOf(pts));
let fs = 48e3;
let gm: GainMode = 'one';
let ch2: 'ph' | 'gd' = 'ph';
let lin = true;
let len = L0;
let ax: FrAxis = frAxis(lin, fs);
let ws = frWs(ax);
/** ドラッグ中のもの（点か e^{jω}） */
let drag: { id: number; lower: boolean } | 'w' | null = null;

/* ---------- 計算 ---------- */
interface An {
  pk: { w: number; lm: number };
  k: number;
  kok: boolean;
  st: { s: Stab; rmax: number };
  secs: Sec[];
  co: { b: number[]; a: number[] };
  dc: number;
  ny: number;
}
let A: An | null = null;
function analyze(): An {
  const pk = peak(pts),
    g = gainOf(pts, gm, pk);
  return {
    pk,
    k: g.k,
    kok: g.ok,
    st: stability(pts),
    secs: sos(pts, g.k),
    co: coefs(pts, g.k),
    dc: at(pts, 0).lm,
    ny: at(pts, Math.PI).lm,
  };
}
const kdb = () => (A ? 20 * Math.log10(A.k) : 0);
const fw = (x: number) => (x * fs) / (2 * Math.PI);

/* ---------- z 平面 ---------- */
const zsvg = $<SVGSVGElement>('#z-svg');
const hzLab = (deg: number) => parts((deg / 360) * fs, '', 3).join('');
function drawGrid(): void {
  html('#z-grid', planeGrid(P, hzLab));
}
function drawPts(): void {
  html('#z-pts', planePts(P, pts, sel));
}
function drawCur(): void {
  const c = planeCursor(P, pts, w);
  html('#z-lines', c.lines);
  html('#z-cur', c.dot);
  txt('#z-w', wPi(w));
}
function drawPlane(): void {
  drawPts();
  drawCur();
  const N = order(pts, 'p'),
    M = order(pts, 'z');
  txt('#z-np', String(N));
  txt('#z-nz', String(M));
  $<HTMLButtonElement>('#addP').disabled = N + 2 > MAXO;
  $<HTMLButtonElement>('#addZ').disabled = M + 2 > MAXO;
  $<HTMLButtonElement>('#delB').disabled = !cur();
  const st = A?.st.s ?? 'stable';
  zsvg.setAttribute(
    'aria-label',
    `z 平面。極 ${N} 個、零点 ${M} 個、${stabText[st]}。点を選んで矢印キーで動かし、Delete で消せます。`,
  );
  txt(
    '#z-msg',
    st === 'unstable'
      ? '単位円の外に極があるため不安定です'
      : st === 'marginal'
        ? '単位円の上に極があるため、出力が減衰しません（安定限界）'
        : '',
  );
}
/** 点がすべて入る表示の範囲にする（ドラッグ中は変えない） */
function fitView(): void {
  const v = viewOf(pts);
  if (v === P.v) return;
  P = plane(v);
  drawGrid();
}

/* ---------- 周波数特性 ---------- */
let FR: FrPlot | null = null;
function drawFr(): void {
  if (!A) return;
  const c = curves(pts, ws, A.k);
  FR = frPlot({ ax, ws, c, bot: G.get('bot'), ch2 });
  html('#fr-grid', FR.grid);
  $('#fr-t1').setAttribute('d', FR.mag);
  $('#fr-t2').setAttribute('d', FR.ch2);
  html('#fr-axes', FR.axes);
  txt('#fr-vd', `${FR.dv} dB`);
  txt('#fr-c2', ch2 === 'ph' ? 'PHASE' : 'DELAY');
  txt('#fr-vd2', ch2 === 'ph' ? '60°' : `${sig(FR.dv2, 3)} S`);
  txt('#fr-xm', lin ? 'X LIN' : 'X LOG');
  txt('#fr-x', `${lin ? '0' : fmt(fw(ax.w0), 'Hz', 3)} – ${fmt(fs / 2, 'Hz', 3)}`);
  $('#fr-svg').setAttribute(
    'aria-label',
    `周波数特性。横軸は ${lin ? '0' : fmt(fw(ax.w0), 'Hz', 3)} から ${fmt(fs / 2, 'Hz', 3)} の${lin ? '線形' : '対数'}、縦軸は振幅 ${FR.dv} dB/div と${ch2 === 'ph' ? '位相 60°/div' : `群遅延 ${sig(FR.dv2, 3)} サンプル/div`}。最大の利得 ${fixed(A.pk.lm * LN2DB + kdb(), 2)} dB。`,
  );
  frCursor();
}
function frCursor(): void {
  if (!A) return;
  const x = ax.X(w),
    r = at(pts, w);
  $('#fr-cur').setAttribute('d', w >= ax.w0 ? `M${x.toFixed(1)} 0V${SH}` : '');
  html(
    '#fr-rd',
    rd(`CUR <b>${fmtR(fw(w), 'Hz', 4)}</b>`) +
      rd(`|<i>H</i>| <b>${fixed(r.lm * LN2DB + kdb(), 2)}</b> dB`) +
      rd(`∠<i>H</i> <b>${fixed((wrap(r.ph) * 180) / Math.PI, 1)}</b>°`) +
      rd(`<i>τ</i> <b>${Number.isFinite(r.gd) ? sig(r.gd, 4, true) : '—'}</b> S`),
  );
}

/* ---------- 距離と角度 ---------- */
function drawGeo(): void {
  if (!A) return;
  const vs = vectors(pts, w),
    lab = labels(pts);
  let pz = 1,
    pp = 1,
    sz = 0,
    sp = 0,
    rows = '';
  for (const v of vs) {
    const deg = (v.phi * 180) / Math.PI;
    if (v.k === 'z') {
      pz *= v.d ** v.n;
      sz += v.n * deg;
    } else {
      pp *= v.d ** v.n;
      sp += v.n * deg;
    }
    const name = v.id == null ? `原点${v.n > 1 ? ` ×${v.n}` : ''}` : nameH(lab.get(v.id) ?? '', v.conj),
      on = v.id != null && v.id === sel;
    rows += `<tr class="${v.k}r${v.id == null ? ' imp' : ''}"${v.id != null ? ` data-id="${v.id}"` : ''} aria-selected="${on}"><td>${name}</td><td>${v.id == null ? '0' : cx(v.re, v.im)}</td><td>${sig(v.d, 4, true)}</td><td>${fixed(deg, 2)}°</td></tr>`;
  }
  html('#geo-tab tbody', rows || '<tr><td colspan="4">極も零点もありません</td></tr>');
  html('#geo-eq', geoMath({ k: A.k, pz, pp, sz, sp }));
  html('#geo-aux', `<i>ω</i> = ${wPi(w)}（${fmtR(fw(w), 'Hz', 4)}）`);
}

/** カーソルを動かす（z 平面・周波数特性・距離と角度だけ描き直す） */
function setW(x: number): void {
  w = Math.min(Math.PI, Math.max(0, x));
  drawCur();
  frCursor();
  drawGeo();
}
$('#fr-svg').addEventListener('pointermove', (e) => frAt(e));
$('#fr-svg').addEventListener('pointerdown', (e) => frAt(e));
function frAt(e: PointerEvent): void {
  const m = $<SVGSVGElement>('#fr-svg').getScreenCTM();
  if (!m) return;
  const x = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()).x;
  if (x >= 0 && x <= SW) setW(ax.W(x));
}
function bindChannel(btn: HTMLElement, scope: HTMLElement, cls: string): void {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    scope.classList.toggle(cls, !on);
  });
}
bindChannel($('#ch1f'), $('#fr-scope'), 'hide1');
bindChannel($('#ch2f'), $('#fr-scope'), 'hide2');
storeToggle($('#ch1f'));
storeToggle($('#ch2f'));

/* ---------- インパルス応答 ---------- */
let IM: ImpPlot | null = null,
  imH: Float64Array = new Float64Array(0),
  imK: number | null = null;
function drawImp(): void {
  if (!A) return;
  const n = len + Math.floor(len / 8) + 2;
  imH = impulse(A.secs, n);
  IM = impPlot(imH, n, len);
  const st = $('#im-st');
  st.setAttribute('d', IM.stem);
  st.style.strokeWidth = String(IM.width);
  html('#im-dots', IM.dots);
  $('#im-z').setAttribute('d', IM.zero);
  html('#im-axes', IM.axes);
  txt('#im-vd', String(IM.vd));
  txt('#im-hd', String(IM.d));
  imCursor();
  $('#im-svg').setAttribute(
    'aria-label',
    `インパルス応答。n = 0 から ${len} まで、横軸 ${IM.d} サンプル/div、縦軸 ${IM.vd}/div。h[0] = ${sig(imH[0], 6)}。`,
  );
}
function imCursor(): void {
  if (!IM) return;
  const k = Math.max(0, Math.min(IM.nEnd - 1, imK ?? 0));
  $('#im-cur').setAttribute('d', imK == null ? '' : `M${IM.X(k).toFixed(1)} 0V${IH}`);
  html('#im-rd', `CUR <i>n</i> = <b>${k}</b> <i>h</i> = <b>${sig(imH[k], 6, true)}</b>`);
}
{
  const svg = $<SVGSVGElement>('#im-svg');
  const at2 = (e: PointerEvent) => {
    const m = svg.getScreenCTM();
    if (!m || !IM) return;
    const x = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()).x;
    imK = x < DV - 4 || x > SW ? null : Math.round(((x - DV) / DV) * IM.d);
    imCursor();
  };
  svg.addEventListener('pointermove', at2);
  svg.addEventListener('pointerdown', at2);
  svg.addEventListener('pointerleave', () => {
    imK = null;
    imCursor();
  });
}

/* ---------- 計算結果・係数 ---------- */
function showResults(): void {
  if (!A) return;
  const k = kdb(),
    mx = A.pk.lm * LN2DB + k,
    N = order(pts, 'p'),
    M = order(pts, 'z');
  html('#o-max', dBh(mx));
  html('#o-maxf', ro(fw(A.pk.w), 'Hz', 4));
  txt('#o-maxw', `ω = ${wPi(A.pk.w)}`);
  txt('#o-st', stabText[A.st.s]);
  txt('#o-stn', A.st.s === 'unstable' ? '単位円の外に極がある' : A.st.s === 'marginal' ? '単位円の上に極がある' : '');
  txt('#o-ord', String(Math.max(N, M)));
  txt('#o-ordn', `極 ${N}・零点 ${M}`);
  html('#o-dc', dBh(A.dc * LN2DB + k));
  html('#o-ny', dBh(A.ny * LN2DB + k));
  txt('#o-rmax', N ? sig(A.st.rmax, 4, true) : '—');
  txt('#o-k', sig(A.k, 4, true));
  txt('#o-kn', A.kok ? '' : gm === 'peak' ? '最大が ∞ のため 1 にした' : '直流の振幅が 0 か ∞ のため 1 にした');
  txt('#mst', stabText[A.st.s]);
  txt('#mmx', `${fixed(mx, 2)} dB`);
  txt('#mord', String(Math.max(N, M)));
  /* 極と零点の一覧 */
  const lab = labels(pts);
  let rows = '';
  for (const p of pts) {
    const r = resOf(p, fs),
      bad = p.k === 'p' && r.r > 1 + EPS,
      q = p.k === 'p' ? (Number.isNaN(r.q) ? '—' : r.q === Infinity ? '∞' : sig(r.q, 4, true)) : '—',
      tau = p.k === 'p' ? (bad ? '—' : Number.isFinite(r.tau) ? fmtR(r.tau, 's', 4) : '∞') : '—';
    rows += `<tr class="${p.k}r${bad ? ' bad' : ''}" data-id="${p.id}" aria-selected="${p.id === sel}"><td>${nameH(lab.get(p.id) ?? '')}</td><td>${sig(r.r, 4, true)}</td><td>${fixed(r.th / D, 2)}°</td><td>${fmtR(r.f, 'Hz', 4)}</td><td>${q}</td><td>${tau}</td></tr>`;
  }
  html('#pt-tab tbody', rows || '<tr><td colspan="6">極も零点もありません</td></tr>');
}
function showCoef(): void {
  if (!A) return;
  const { b, a } = A.co,
    n = Math.max(b.length, a.length);
  html('#tf-hz', tfMath(b.length - 1, a.length - 1));
  let rows = '';
  for (let i = 0; i < n; i++)
    rows += `<tr><td>${i}</td><td>${i < b.length ? cf(b[i]) : ''}</td><td>${i < a.length ? cf(a[i]) : ''}</td></tr>`;
  html('#tf-tab tbody', rows);
  html('#sos-hz', sosMath(A.secs.length));
  html(
    '#sos-tab tbody',
    A.secs
      .map((s, i) => `<tr><td>${i + 1}</td>${[...s.b, s.a[1], s.a[2]].map((v) => `<td>${cf(v)}</td>`).join('')}</tr>`)
      .join(''),
  );
}
new Choice($('#cview'), (v) => {
  $('#v-tf').hidden = v !== 'tf';
  $('#v-sos').hidden = v !== 'sos';
});

/* 表の行を押すと、その点を選ぶ */
for (const id of ['#geo-tab', '#pt-tab'])
  $(id).addEventListener('click', (e) => {
    const tr = (e.target as Element).closest<HTMLElement>('tr[data-id]');
    if (tr) select(Number(tr.dataset.id));
  });

/* ---------- 選んだ点の数値 ---------- */
/**
 * 点の位置には既定値がないので、行の既定値をいつも今の値にして、既定値と違う行の印と ↺ を出さない
 * （吹き出しの「既定値」のボタンは style.css で隠す）
 */
function keepDefault(k: SelKey, v: number): void {
  if (S.def(k).v !== v) S.update(k, { v });
}
const S = new ParamGroup<SelKey>(
  SEL,
  (v, k) => {
    const p = cur();
    if (!k || !p) return;
    const s = polar(p.k, v.r, v.th * D);
    if (p.im === 0 && s.im > 0 && order(pts, p.k) + 1 > MAXO) {
      syncSel();
      S.note(k, `${KIND[p.k]}は ${MAXO} 個までのため、実軸から動かせません`, 'er');
      return;
    }
    keepDefault(k, v[k]);
    p.re = s.re;
    p.im = s.im;
    changed();
  },
  null,
  { save: false },
);
let selOff: boolean | null = null;
/** 数値の行を選んだ点に合わせる。値が同じなら触らない（確定したときのメッセージを残す） */
function syncSel(): void {
  const p = cur();
  if (selOff !== !p) {
    selOff = !p;
    for (const k of ['r', 'th'] as const) S.setOff(k, !p, '点を選ぶと使えます');
  }
  if (p) {
    const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    const r = rad(p),
      t = ang(p) / D;
    if (!near(S.get('r'), r)) S.set('r', r, { silent: true });
    if (!near(S.get('th'), t)) S.set('th', t, { silent: true });
    keepDefault('r', S.get('r'));
    keepDefault('th', S.get('th'));
  }
  if (!p) {
    html('#z-rd', '');
    return;
  }
  const r = resOf(p, fs),
    name = labels(pts).get(p.id) ?? '';
  html(
    '#z-rd',
    rd(`${nameH(name)} ${p.im > 0 ? '共役の対' : '実軸'}`) +
      rd(`<i>r</i> <b>${sig(r.r, 4, true)}</b>`) +
      rd(`<i>θ</i> <b>${fixed(r.th / D, 2)}</b>°`) +
      rd(`<i>f</i> <b>${fmtR(r.f, 'Hz', 4)}</b>`) +
      (p.k === 'p' && p.im > 0 && Number.isFinite(r.q) ? rd(`<i>Q</i> <b>${sig(r.q, 4, true)}</b>`) : ''),
  );
}
function select(id: number | null): void {
  sel = id;
  drawPlane();
  drawGeo();
  showResults();
  syncSel();
}

/* ---------- 点の追加・削除・プリセット ---------- */
const pre$ = (() => {
  const el = $('#p-pre');
  el.setAttribute('data-nosave', '');
  return new Choice(el, (v) => {
    const pr = presetOf(v);
    if (!pr) return;
    load(pr.pts());
    changed();
  });
})();
/** 今の並びと同じプリセットを押した状態にする */
function matchPreset(): void {
  const hit = PRESETS.find((pr) => {
    const s = pr.pts();
    return (
      s.length === pts.length &&
      s.every((q, i) => q.k === pts[i].k && Math.abs(q.re - pts[i].re) < 1e-9 && Math.abs(q.im - pts[i].im) < 1e-9)
    );
  });
  pre$.set(hit?.v ?? '');
}
function add(k: Kind): void {
  if (order(pts, k) + 2 > MAXO) {
    toast(`${KIND[k]}は ${MAXO} 個までです`);
    return;
  }
  const p: Pt = { ...freeSpot(pts, k), id: nid++ };
  pts.push(p);
  sel = p.id;
  changed();
}
function del(): void {
  const i = pts.findIndex((p) => p.id === sel);
  if (i < 0) return;
  pts.splice(i, 1);
  sel = pts[Math.min(i, pts.length - 1)]?.id ?? null;
  changed();
}
$('#addP').addEventListener('click', () => add('p'));
$('#addZ').addEventListener('click', () => add('z'));
$('#delB').addEventListener('click', del);

/* ---------- z 平面の操作（ドラッグ・キー） ---------- */
/** ポインタの位置を SVG の座標に */
function svgPt(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const m = zsvg.getScreenCTM();
  if (!m) return null;
  const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: q.x, y: q.y };
}
/** 画面の 1 px あたりの SVG の長さ */
const pxU = (): number => {
  const r = zsvg.getBoundingClientRect();
  return r.width ? (ZS + 12) / r.width : 1;
};
/** いちばん近い点（共役の側も）か e^{jω}。touch なら広めに取る */
function hit(x: number, y: number, touch: boolean): { id: number; lower: boolean } | 'w' | null {
  let best: { id: number; lower: boolean } | 'w' | null = null,
    bd = (touch ? 22 : 12) * pxU();
  for (const p of pts)
    for (const lower of p.im > 0 ? [false, true] : [false]) {
      const d = Math.hypot(x - P.x(p.re), y - P.y(lower ? -p.im : p.im));
      if (d < bd) {
        bd = d;
        best = { id: p.id, lower };
      }
    }
  if (Math.hypot(x - P.x(Math.cos(w)), y - P.y(Math.sin(w))) < bd) best = 'w';
  return best;
}
/** 点を動かす。上半面に折り返し、実軸・原点（と零点は単位円）の近くでは吸い付ける */
function moveTo(id: number, lower: boolean, x: number, y: number, snap: boolean): void {
  const p = pts.find((q) => q.id === id);
  if (!p) return;
  let re = Math.max(-P.v, Math.min(P.v, P.re(x))),
    im = Math.min(P.v, Math.abs(lower ? -P.im(y) : P.im(y)));
  const r0 = Math.hypot(re, im);
  if (r0 > RMAX) {
    re *= RMAX / r0;
    im *= RMAX / r0;
  }
  if (snap) {
    const t = (7 * pxU()) / P.s;
    if (Math.hypot(re, im) < t) re = im = 0;
    else {
      if (im < t) im = 0;
      const r = Math.hypot(re, im);
      if (p.k === 'z' && Math.abs(r - 1) < t) {
        re /= r;
        im /= r;
      }
    }
  }
  if (im < EPS) im = 0;
  if (p.im === 0 && im > 0 && order(pts, p.k) + 1 > MAXO) im = 0;
  p.re = re;
  p.im = im;
  changed();
}
zsvg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const q = svgPt(e),
    h = q ? hit(q.x, q.y, e.pointerType !== 'mouse') : null;
  if (!h) return;
  e.preventDefault();
  zsvg.focus({ preventScroll: true, focusVisible: false });
  try {
    zsvg.setPointerCapture(e.pointerId);
  } catch {
    /* 合成したイベントなど、捕まえられないポインタ */
  }
  drag = h;
  zsvg.classList.add('drag');
  if (h !== 'w' && h.id !== sel) select(h.id);
});
/* 点か e^{jω} の上で始めたタッチは、スクロールさせずにドラッグにする */
zsvg.addEventListener(
  'touchstart',
  (e) => {
    const t = e.changedTouches[0],
      q = t ? svgPt(t) : null;
    if (q && hit(q.x, q.y, true)) e.preventDefault();
  },
  { passive: false },
);
zsvg.addEventListener('pointermove', (e) => {
  const q = svgPt(e);
  if (!q) return;
  if (!drag) {
    if (e.pointerType === 'mouse') zsvg.classList.toggle('grab', !!hit(q.x, q.y, false));
    return;
  }
  if (drag === 'w') setW(Math.atan2(Math.abs(P.im(q.y)), P.re(q.x)));
  else moveTo(drag.id, drag.lower, q.x, q.y, !e.altKey);
});
for (const n of ['pointerup', 'pointercancel'] as const)
  zsvg.addEventListener(n, () => {
    if (!drag) return;
    const was = drag;
    drag = null;
    zsvg.classList.remove('drag');
    if (was !== 'w') changed();
  });
zsvg.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (cur()) {
      e.preventDefault();
      del();
    }
    return;
  }
  if (e.key === 'PageUp' || e.key === 'PageDown') {
    if (!pts.length) return;
    e.preventDefault();
    const i = pts.findIndex((p) => p.id === sel),
      j = (i + (e.key === 'PageDown' ? 1 : -1) + pts.length) % pts.length;
    select(pts[j].id);
    return;
  }
  const p = cur(),
    s = e.shiftKey ? 0.1 : 0.01,
    d = ({ ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] } as Record<string, number[]>)[
      e.key
    ];
  if (!p || !d) return;
  e.preventDefault();
  let re = Number((p.re + d[0]).toFixed(12)),
    im = Math.max(0, Number((p.im + d[1]).toFixed(12)));
  const r = Math.hypot(re, im);
  if (r > RMAX) {
    re *= RMAX / r;
    im *= RMAX / r;
  }
  if (im < EPS) im = 0;
  if (p.im === 0 && im > 0 && order(pts, p.k) + 1 > MAXO) return;
  p.re = re;
  p.im = im;
  changed();
});

/* ---------- 試聴 ---------- */
const au = new PzAudio();
let playing = false,
  raf = 0,
  level = -Infinity,
  src: Src = 'noise';
function sendAudio(): void {
  if (!A) return;
  const on = A.st.s === 'stable' && Number.isFinite(A.pk.lm);
  au.filter(pts, Math.exp(-A.pk.lm), on);
  txt(
    '#snd-msg',
    on
      ? ''
      : A.st.s === 'unstable'
        ? '単位円の外に極があり不安定なため、音を止めています'
        : '単位円の上に極があり出力が減衰しないため、音を止めています',
  );
}
function sendSrc(): void {
  au.source(src, G.get('sf'));
  txt('#lv-in', src === 'noise' ? 'WHITE NOISE' : `SAW ${fmt(G.get('sf'), 'Hz', 4)}`);
  G.setOff('sf', src !== 'saw', 'ノイズでは使いません');
}
function showRate(): void {
  const r = au.rate;
  txt('#lv-fs', r ? fmt(r, 'Hz', 4) + (Math.abs(r - fs) > 0.5 ? `（図は ${fmt(fs, 'Hz', 4)}）` : '') : '---');
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
  level = Math.max(au.level(), level - 0.6);
  drawLv(level);
  raf = requestAnimationFrame(meter);
}
async function play(on: boolean): Promise<void> {
  if (!(await au.play(on)) && on) {
    toast('この環境では音を鳴らせません');
    on = false;
  }
  playing = on;
  const btn = $('#playBtn');
  btn.setAttribute('aria-pressed', String(on));
  $('.led', btn).classList.toggle('on', on);
  txt('#playT', on ? '停止' : '再生');
  cancelAnimationFrame(raf);
  showRate();
  if (on) raf = requestAnimationFrame(meter);
  else {
    level = -Infinity;
    drawLv(-Infinity);
  }
}
$('#playBtn').addEventListener('click', () => {
  void play(!playing);
});

/* ---------- 設定 ---------- */
const G = new ParamGroup<Key>(PARAMS, (_, k) => {
  if (!k) return;
  if (k === 'vol') au.vol(G.get('vol'));
  else if (k === 'sf') sendSrc();
  else if (k === 'bot') drawFr();
  else if (k === 'fs') {
    fs = G.get('fs');
    ax = frAxis(lin, fs);
    drawGrid();
    showRate();
    renderAll();
  }
});
fs = G.get('fs');
au.vol(G.get('vol'));

const km$ = new Choice<GainMode>($('#p-km'), (v) => {
  gm = v;
  renderAll();
});
gm = km$.value;
const ch2$ = new Choice<'ph' | 'gd'>($('#p-ch2'), (v) => {
  ch2 = v;
  drawFr();
});
ch2 = ch2$.value;
const fx$ = new Choice<'lin' | 'log'>($('#p-fx'), (v) => {
  lin = v === 'lin';
  ax = frAxis(lin, fs);
  ws = frWs(ax);
  drawFr();
});
lin = fx$.value === 'lin';
const len$ = new Choice($('#p-len'), (v) => {
  len = Number(v);
  drawImp();
});
len = Number(len$.value);
const src$ = new Choice<Src>($('#p-src'), (v) => {
  src = v;
  sendSrc();
});
src = src$.value;
ax = frAxis(lin, fs);
ws = frWs(ax);

/* ---------- 描き直し ---------- */
let rq = 0;
/** 点の並びが変わった: 保存して、次の描画で計算し直す */
function changed(): void {
  save();
  matchPreset();
  if (!rq)
    rq = requestAnimationFrame(() => {
      rq = 0;
      renderAll();
    });
}
function renderAll(): void {
  A = analyze();
  if (!drag) fitView();
  drawPlane();
  drawFr();
  drawGeo();
  drawImp();
  showResults();
  showCoef();
  syncSel();
  sendAudio();
}
drawGrid();
matchPreset();
sendSrc();
renderAll();
drawLv(-Infinity);

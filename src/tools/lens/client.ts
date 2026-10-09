/**
 * カメラレンズのページの入口: レンズデータ → 近軸と実光線の計算 → 映像（WebGL2）・図・計算結果
 */
import { Choice } from '../../lib/choice';
import { $, esc } from '../../lib/dom';
import { fmtR } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import type { ParamPatch } from '../../lib/param-def';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { distortion, dof, halfAngle, illum, type PupilTable, pupilTable, spot } from './analysis';
import { LD } from './glass';
import { type LensId, lensOf, type Rx } from './lenses';
import {
  aimChief,
  build,
  HALF_DIAG,
  minFocus,
  objRay,
  polyR,
  type Ray,
  SENSOR,
  type State,
  type Sys,
  seidel,
  focus as solveFocus,
  thinLens,
  traceFwd,
  traceRev,
} from './optics';
import { angR, FNUM, FOCUS, FSTOPS, INF, type Key, mT, PARAMS, sig } from './params';
import { curveSvg, mapDynamic, mapLabel, sectionSvg, spotSvg } from './plot';
import { type LensU, Renderer, type ViewU } from './render';
import { angRadius, basis, bodyFrame, EYE, intersect, SKY, type V3 } from './scene';

const txt = (id: string, s: string) => {
  const e = $(id);
  if (e.textContent !== s) e.textContent = s;
};
const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
/** 計算結果の値（末尾の 0 を残す）と単位 */
const rv = (s: string, u: string) => `${s}<span class="u">${u}</span>`;
const mm = (v: number) => rv(sig(v, 3, true), 'mm');
const dist = (v: number) => (Number.isFinite(v) ? fmtR(v / 1000, 'm', 3) : '∞');

initToolPage();

/** 計算と描画は 1 フレームに 1 回にまとめる */
let raf = 0;
function later(): void {
  if (!raf) raf = requestAnimationFrame(update);
}

/* ---------- 選択肢 ---------- */
let ready = false;
const lens$ = new Choice<LensId>($('#p-lens'), (v) => setLens(v));
const blades$ = new Choice($('#p-bl'), () => later());
const cmp$ = new Choice($('#p-cmp'), () => later());
const zoom$ = new Choice($('#p-zm'), () => later());
const ch$ = new Choice($('#p-ch'), () => later());
const df$ = new Choice($('#p-df'), () => later());
const tod$ = new Choice<'day' | 'dusk' | 'night'>($('#p-tod'), () => later());
const gd$ = new Choice($('#p-gd'), () => later());
const av$ = new Choice($('#p-av'), () => drawAbr());
const sw$ = new Choice($('#p-sw'), () => later());
/** ピント合わせ: AF は向き・焦点距離・レンズが変わるたびに枠の点に合わせ直す。MF は撮影距離のまま */
const fm$ = new Choice($('#p-fm'), () => {
  afKey = '';
  later();
});

/* ---------- 状態 ---------- */
let sys: Sys | null = null,
  sysKey = '';
let st: State | null = null,
  stKey = '';
let tb: PupilTable | null = null;
let secKey = '';
/** AF で最後に合わせたときの条件（変わったら合わせ直す） */
let afKey = '';
/** ピントを合わせた点（AF の枠）。センサーの上の表示の向きの位置 [mm]。拡大の中心にもなるので保存する。初めは 50 mm で 2 m のチャートに重なる位置 */
let afPt: [number, number] = [-2.6, -3.3];
{
  const a = stored('af');
  if (Array.isArray(a) && a.length === 2 && a.every((x) => typeof x === 'number' && Number.isFinite(x)))
    afPt = [a[0], a[1]];
}

/**
 * レンズで決まる定義: 焦点距離の既定値は設計の画角になる値。F 値は下限を開放 F 値にして並びに足し、
 * 既定値は F2.8 か、それより暗いレンズでは開放
 */
const lensPatch = (k: 'f' | 'N', rx: Rx): ParamPatch =>
  k === 'f'
    ? { v: rx.f0 }
    : { min: rx.fno, v: Math.max(FNUM.v, rx.fno), list: [...new Set([rx.fno, ...FSTOPS])].sort((a, b) => a - b) };

/* 既定値と同じ値は保存しないので、選んでいるレンズの既定値で始める */
const rx0 = lensOf(lens$.value);
const G = new ParamGroup<Key>(
  PARAMS.map((d) => (d.k === 'f' || d.k === 'N' ? { ...d, ...lensPatch(d.k, rx0) } : d)),
  () => later(),
);

/** レンズを選んだとき: 焦点距離を設計の画角に合わせ、F 値の下限を開放 F 値にする */
function setLens(v: LensId): void {
  const rx = lensOf(v);
  G.update('f', lensPatch('f', rx));
  G.update('N', lensPatch('N', rx));
  if (G.get('N') < rx.fno) G.set('N', rx.fno, { silent: true });
  if (ready) G.set('f', rx.f0);
  else later();
}
queueMicrotask(() => {
  ready = true;
});

/* ---------- 映像 ---------- */
const canvas = $<HTMLCanvasElement>('#lvc'),
  lv = $('#lv'),
  msg = $('#lv-msg');
let R: Renderer | null = null;
try {
  R = new Renderer(canvas);
  R.onProgress = (n, w, h) => {
    txt('#v-spp', String(n));
    txt('#v-px', `${w}×${h}`);
  };
} catch (e) {
  msg.hidden = false;
  msg.textContent =
    String(e).includes('float') || String(e).includes('webgl2')
      ? 'このブラウザでは WebGL2（浮動小数点の描画）が使えないため、映像を描けません。図と計算結果は使えます。'
      : `映像のシェーダを用意できませんでした（${String(e).slice(0, 120)}）`;
  lv.classList.add('nogl');
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  msg.hidden = false;
  msg.textContent = '描画が中断されました。ページを開き直してください。';
});

/** キャンバスの大きさを表示に合わせる（画素数は 220 万まで） */
function fit(): void {
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  let k = Math.min(devicePixelRatio || 1, 2);
  const px = r.width * r.height * k * k;
  if (px > 2.2e6) k *= Math.sqrt(2.2e6 / px);
  const w = Math.round(r.width * k),
    h = Math.round(r.height * k);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    R?.redraw();
  }
}
new ResizeObserver(fit).observe(lv);

/** 描く範囲（センサーの上、表示の向き、mm）: 拡大したら AF の枠を中心にする */
function view(): { x0: number; y0: number; w: number; h: number } {
  const z = Number(zoom$.value) || 1,
    w = SENSOR.w / z,
    h = SENSOR.h / z;
  const cx = Math.max(-SENSOR.w / 2 + w / 2, Math.min(SENSOR.w / 2 - w / 2, afPt[0])),
    cy = Math.max(-SENSOR.h / 2 + h / 2, Math.min(SENSOR.h / 2 - h / 2, afPt[1]));
  return { x0: cx - w / 2, y0: cy - h / 2, w, h };
}

/* ---------- 計算 ---------- */
/** 絞りの羽根の枚数。開放では羽根が引っ込んで円になる */
function bladesNow(N: number, fno: number): number {
  return N <= fno * (1 + 1e-6) ? 0 : Number(blades$.value);
}

function update(): void {
  raf = 0;
  const v = G.values(),
    rx = lensOf(lens$.value);
  const k1 = `${rx.v}|${v.f}`;
  if (k1 !== sysKey || !sys) {
    sys = build(rx, v.f);
    sysKey = k1;
    stKey = '';
    /* 下限は最短撮影距離（撮影倍率 1/2）。既定値（2 m）より遠ければ、下限を既定値にする */
    const mf = Math.max(0.2, Math.ceil(minFocus(sys) / 10) / 100);
    G.update('fd', { min: mf, v: Math.max(FOCUS.v, mf) });
  }
  if (fm$.value === 'af') {
    const ak = JSON.stringify([k1, v.pan, v.tilt, cmp$.value, afPt]);
    if (ak !== afKey) {
      afKey = ak;
      v.fd = applyFd(afDistance(sys, v.fd, v.N), true);
    }
  }
  const fdMin = G.def('fd').min;
  if (v.fd < fdMin * (1 - 1e-9)) {
    G.set('fd', fdMin, { silent: true });
    G.note('fd', `最短撮影距離（撮影倍率 1/2）の ${mT(fdMin)} にしました`, 'er');
    v.fd = fdMin;
  }
  const bl = bladesNow(v.N, rx.fno);
  blades$.note(bl === 0 && Number(blades$.value) > 0 ? '開放なので円' : '');
  const D = v.fd >= INF * 0.999 ? Infinity : v.fd * 1000;
  const k2 = `${k1}|${v.N}|${bl}|${D}`;
  const optChanged = k2 !== stKey;
  if (optChanged || !st) {
    st = solveFocus(sys, D, v.N, bl);
    stKey = k2;
    tb = pupilTable(st);
  }
  if (optChanged) results(v.coc);
  else coc(v.coc);
  afState();
  drawMap();
  const k3 = `${stKey}|${cmp$.value}|${sw$.value}`;
  if (k3 !== secKey) {
    secKey = k3;
    drawSection();
  }
  if (optChanged) {
    drawAbr();
    prescription();
  }
  status();
  render();
}

/* 計算結果 */
let lastDof = { near: 0, far: 0, hyper: 0 };
function results(c: number): void {
  if (!st || !tb) return;
  const s = st;
  coc(c);
  const fd = halfAngle(s, HALF_DIAG),
    fw = halfAngle(s, SENSOR.w / 2),
    fh = halfAngle(s, SENSOR.h / 2);
  const deg = (a: number) => sig((2 * a * 180) / Math.PI, 3, true);
  html('#o-fov', rv(deg(fd), '°'));
  txt('#o-fovs', `水平 ${deg(fw)}°・垂直 ${deg(fh)}°（主光線の実光線から）`);
  txt('#mA', `${deg(fd)}°`);
  html('#o-mag', s.m === 0 ? rv('0', '倍') : rv(sig(Math.abs(s.m), 3, true), '倍'));
  txt('#o-mags', s.m === 0 ? '無限遠' : `1/${sig(1 / Math.abs(s.m), 3, true)}（像は倒立）`);
  html('#o-nw', `F${sig(s.Nw, 3, true)}`);
  txt('#o-nws', s.ext > 1e-6 ? `繰り出し ${sig(s.ext, 3, true)} mm` : '無限遠（繰り出しなし）');
  txt('#mN', sig(s.Nw, 3, true));
  html('#o-ep', mm(2 * s.rep));
  txt('#o-eps', `最初の面から ${sig(s.zep, 3, true)} mm・射出瞳 ${sig(2 * s.rxp, 3, true)} mm`);
  const il = illum(s, HALF_DIAG, tb);
  const ev = Math.log2(il);
  html('#o-ill', il > 0 ? rv((ev > 0 ? '+' : '') + sig(ev, 2, true), 'EV') : '—');
  txt('#o-ills', il > 0 ? `中心に対して ${sig(il * 100, 3, true)} %（cos⁴ とけられを含む）` : '隅まで光が届かない');
  const ds = distortion(s, HALF_DIAG);
  html('#o-dis', Number.isFinite(ds) ? rv(sig(ds, 3, true), '%') : '—');
  txt('#o-diss', Number.isFinite(ds) ? (ds < 0 ? '樽型' : '糸巻き型') : '主光線が届かない');
  html('#o-airy', rv(sig(2.44 * LD * s.Nw, 3, true), 'µm'));
  txt('#o-airys', '2.44 λ × 実効 F 値（λ = 587.6 nm）');
  const sf = s.sys.s,
    last = sf[sf.length - 1];
  html('#o-len', mm(last.z));
  txt('#o-lens', `前玉の径 ${sig(2 * sf[0].sd, 3, true)} mm・バックフォーカス ${sig(s.zs - last.z, 3, true)} mm`);
  /* ザイデル係数（センサーの隅、今の F 値とピント） */
  const sd = seidel(s, HALF_DIAG),
    lam = LD * 1e-3;
  const W = [sd.S[0] / 8, sd.S[1] / 2, sd.S[2] / 2, (sd.S[2] + sd.S[3]) / 4, sd.S[4] / 2, sd.C[0] / 2, sd.C[1]];
  const WN = ['W₀₄₀', 'W₁₃₁', 'W₂₂₂', 'W₂₂₀', 'W₃₁₁', 'W₀₂₀', 'W₁₁₁'];
  [...sd.S, ...sd.C].forEach((x, i) => {
    const id = i < 5 ? `#s${i + 1}` : `#c${i - 4}`;
    html(id, rv(sig(x * 1000, 3, true), 'µm'));
    txt(`${id}s`, `${WN[i]} ${sig(W[i] / lam, 3, true)} λ`);
  });
  html('#lh', mm(sd.H));
  txt('#lhs', '隅の主光線と周辺光線（d 線）');
}

/** 被写界深度（許容錯乱円だけが変わったときもここ） */
function coc(c: number): void {
  if (!st) return;
  const d = dof(st, c);
  lastDof = d;
  const tot = d.far - d.near;
  html('#o-dof', Number.isFinite(tot) ? fmtR(tot / 1000, 'm', 3).replace(/ (\S+)$/, '<span class="u">$1</span>') : '∞');
  txt('#o-dofs', `近点 ${dist(d.near)}・遠点 ${dist(d.far)}（センサーから、c = ${sig(c, 3)} mm）`);
  txt('#mD', Number.isFinite(tot) ? fmtR(tot / 1000, 'm', 3) : '∞');
  html('#o-hyp', fmtR(d.hyper / 1000, 'm', 3).replace(/ (\S+)$/, '<span class="u">$1</span>'));
  txt('#o-hyps', `ピントを合わせると、${dist(d.hyper / 2)} くらいから無限遠まで`);
}

/* ---------- 図 ---------- */
function drawMap(): void {
  if (!st) return;
  const v = G.values();
  const m = {
    pan: v.pan,
    hfov: (halfAngleCached() * 180) / Math.PI,
    fd: Number.isFinite(st.D) ? st.D / 1000 : Infinity,
    near: lastDof.near / 1000,
    far: lastDof.far / 1000,
  };
  html('#map-d', mapDynamic(m));
  $('#map').setAttribute('aria-label', mapLabel(m));
}
let haKey = '',
  haVal = 0;
/** 水平の半画角（ピントとレンズが同じなら前の値） */
function halfAngleCached(): number {
  if (!st) return 0;
  if (haKey !== stKey) {
    haKey = stKey;
    haVal = halfAngle(st, SENSOR.w / 2);
  }
  return haVal;
}

function drawSection(): void {
  if (!st) return;
  const v = G.values(),
    id = thinLens(v.f, st.D, v.N);
  const ideal = cmp$.value === 'ideal';
  const spec = sw$.value === 'spec';
  const p = sectionSvg({ st, ideal, spec, si: id.si, so: id.so, a: id.a });
  html('#sec', p.svg);
  $('#sec').setAttribute('aria-label', p.label);
  txt('#sec-st', ideal ? '収差なし' : `${st.sys.rx.name}`);
  /* 凡例: 7 波長のときは波長の帯、d 線だけのときは光束の色 */
  const many = spec && !ideal;
  for (const e of document.querySelectorAll<HTMLElement>('.sec-d')) e.hidden = many;
  for (const e of document.querySelectorAll<HTMLElement>('.sec-s')) e.hidden = !many;
}

function drawAbr(): void {
  if (!st) return;
  if (av$.value === 'curve') {
    const c = curveSvg(st);
    html('#abr', c.svg);
    $('#abr').setAttribute('aria-label', c.label);
    txt('#ab-sc', '');
  } else {
    const sp = [0, 0.7, 1].map((k) => spot(st as State, k * HALF_DIAG));
    const p = spotSvg(sp, st.Nw);
    html('#abr', p.svg);
    $('#abr').setAttribute('aria-label', p.label);
    txt('#ab-sc', `枠 ±${p.scale} µm・円はエアリー円盤`);
  }
}

/** レンズデータの表（今の焦点距離に拡大した値） */
function prescription(): void {
  if (!st) return;
  const s = st.sys,
    rx = s.rx;
  html(
    '#rx-src',
    `出典: ${rx.src}。表は焦点距離 ${sig(s.f, 4)} mm に相似拡大した値（出典の値の ${sig(s.k, 4)} 倍）で、有効径は${rx.dia ? '出典の値' : '設計の F 値と画角の光線から求めた値'}。最後の面からセンサーまでは、撮影距離から求める。`,
  );
  let no = 0;
  const rows = s.s
    .map((x, i) => {
      const next = s.s[i + 1];
      if (!x.stop) no++;
      const t = next ? next.z - x.z : st ? st.zs - x.z : 0;
      const g = x.m.nd === 1;
      return `<tr${x.stop ? ' class="stop"' : ''}><td>${x.stop ? '絞り' : no}</td><td>${x.c ? sig(1 / x.c, 5) : '∞'}</td><td>${sig(t, 4)}</td><td>${g ? '空気' : esc(x.m.name)}</td><td>${g ? '' : x.m.nd.toFixed(4)}</td><td>${g ? '' : x.m.vd.toFixed(1)}</td><td>${sig(2 * (x.stop ? (st?.rs ?? x.sd) : x.sd), 4)}</td></tr>`;
    })
    .join('');
  html('#rxt tbody', rows);
}

function status(): void {
  if (!st) return;
  const v = G.values();
  txt('#v-lens', cmp$.value === 'ideal' ? '収差なし' : st.sys.rx.ab);
  txt('#v-f', `${sig(v.f, 4)} mm`);
  txt('#v-N', `F${sig(v.N, 3)}`);
  txt('#v-fd', `${fm$.value === 'af' ? 'AF' : 'MF'} ${mT(v.fd)}`);
  canvas.setAttribute(
    'aria-label',
    `レンズ越しの映像（${cmp$.value === 'ideal' ? '収差なし' : st.sys.rx.name}、焦点距離 ${sig(v.f, 4)} mm、F${sig(v.N, 3)}、ピント ${mT(v.fd)}）`,
  );
}

/* ---------- 天体のガイド ---------- */
const gdEl = $('#gd');
const MOON_R = angRadius(SKY.find((b) => b.id === 'moon') ?? SKY[0]);
let gdKey = '';
/** 月のほかの天体の位置（表示の向き、センサーの上の mm）に、月と同じ角半径の円を描く */
function guides(): void {
  const vw = view();
  gdEl.setAttribute('viewBox', `${vw.x0} ${-(vw.y0 + vw.h)} ${vw.w} ${vw.h}`);
  const on = gd$.value === 'on' && !!st;
  const v = G.values();
  const key = JSON.stringify([on, stKey, cmp$.value, v.pan, v.tilt]);
  if (key === gdKey) return;
  gdKey = key;
  if (!on || !st) {
    gdEl.innerHTML = '';
    return;
  }
  const s = st,
    b = basis(v.pan, v.tilt),
    ideal = cmp$.value === 'ideal';
  const si = ideal ? thinLens(s.sys.f, s.D, s.N).si : s.zs - s.card.zH1;
  const dot = (a: V3, c: V3) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  let out = '';
  for (const k of SKY) {
    if (k.id === 'moon') continue;
    const { c } = bodyFrame(k);
    const dx = dot(c, b.r),
      dy = dot(c, b.u),
      dz = dot(c, b.f),
      rho = Math.hypot(dx, dy);
    if (dz <= 0 || rho > dz * 4) continue;
    const t = rho / dz;
    /* 像の高さ: 主光線を追跡する（収差なしは薄いレンズ）。追跡できなければ近軸 */
    let h = si * t;
    if (!ideal && t > 0) {
      const u = Number.isFinite(s.zo) ? t * (s.zep - s.zo) : t,
        r = objRay(s, u, 0, 0, aimChief(s, u, LD));
      /* 無限遠の u は光線の傾き（正は光軸の下の物点）、有限の u は物体の面での高さ（正は上）。像は倒立 */
      if (traceFwd(s, r, LD, undefined, { noClip: true }) < 0) h = Number.isFinite(s.zo) ? -r.y : r.y;
    }
    const x = rho > 0 ? (h * dx) / rho : 0,
      y = rho > 0 ? (h * dy) / rho : 0;
    out += `<circle cx="${x.toFixed(4)}" cy="${(-y).toFixed(4)}" r="${(MOON_R * si).toFixed(4)}"/>`;
  }
  gdEl.innerHTML = out;
}

/* ---------- 描画への受け渡し ---------- */
let lastKey = '';
function render(): void {
  placeAf();
  guides();
  if (!R || !st || !tb) return;
  const s = st.sys.s,
    ns = s.length;
  const S = new Float32Array(ns * 4),
    B = new Float32Array(ns * 4),
    C = new Float32Array(ns * 4),
    P = new Float32Array(tb.rows.length * 4);
  s.forEach((x, i) => {
    S.set([x.z, x.c, x.sd, x.stop ? 1 : 0], i * 4);
    const air = x.m.nd === 1;
    B.set(air ? [0, 0, 0, 1] : [...x.m.ref.B, x.m.k], i * 4);
    C.set(air ? [0, 0, 0, 0] : [...x.m.ref.C, x.m.off], i * 4);
  });
  tb.rows.forEach((r, i) => {
    P.set([r[0], r[1], r[2], 0], i * 4);
  });
  const v = G.values();
  const id = thinLens(v.f, st.D, v.N);
  const bl = st.blades;
  const L: LensU = {
    ns,
    S,
    B,
    C,
    P,
    hmax: tb.hmax,
    opt: [st.zs, st.zxp, 1 / (Math.PI * st.rxp * st.rxp), df$.value === 'on' ? st.Nw : 0],
    stop: [st.rc, bl, bl >= 3 ? Math.cos(Math.PI / bl) : 1],
    mode: cmp$.value === 'ideal' ? 1 : 0,
    ideal: [id.si, id.so, id.a, polyR(id.a, bl)],
    chrom: ch$.value === 'on',
  };
  const vw = view(),
    b = basis(v.pan, v.tilt);
  const V: ViewU = {
    view: [vw.x0, vw.y0, vw.w, vw.h],
    right: b.r,
    up: b.u,
    fwd: b.f,
    eye: [0, EYE, 0],
    tod: ['day', 'dusk', 'night'].indexOf(tod$.value),
  };
  /* 映像に関わる値が同じなら、ためた分を捨てない（許容錯乱円だけを変えたときなど） */
  const key = JSON.stringify([stKey, L.mode, L.chrom, L.opt[3], V.view, v.pan, v.tilt, V.tod]);
  if (key === lastKey) return;
  lastKey = key;
  R.set(L, V);
}

/* ---------- AF の枠と、押して合わせる・ドラッグで向きを変える ---------- */
const afEl = $('#af');
function placeAf(): void {
  const vw = view(),
    x = (afPt[0] - vw.x0) / vw.w,
    y = 1 - (afPt[1] - vw.y0) / vw.h;
  afEl.hidden = x < 0 || x > 1 || y < 0 || y > 1;
  afEl.style.left = `${(x * 100).toFixed(3)}%`;
  afEl.style.top = `${(y * 100).toFixed(3)}%`;
}

/**
 * 表示の点（センサーの上、mm）に写る物体までの、撮影者の前方向の距離 [mm]（空は Infinity）。
 * 光線はピントの状態 s のレンズ（収差なしなら薄いレンズ）を逆にたどる
 */
function depthAt(s: State, x: number, y: number): number {
  const v = G.values(),
    b = basis(v.pan, v.tilt);
  let o: V3, d: V3;
  const r: Ray = { x: -x, y: -y, z: s.zs, dx: 0, dy: 0, dz: 0 };
  {
    const dx = x,
      dy = y,
      dz = s.zxp - s.zs,
      L = Math.hypot(dx, dy, dz);
    r.dx = dx / L;
    r.dy = dy / L;
    r.dz = dz / L;
  }
  if (cmp$.value !== 'ideal' && traceRev(s, r, LD)) {
    o = [r.x, r.y, s.zs - r.z];
    d = [r.dx, r.dy, -r.dz];
  } else {
    const id = thinLens(s.sys.f, s.D, s.N);
    o = [0, 0, id.si];
    const L = Math.hypot(x / id.si, y / id.si, 1);
    d = [x / id.si / L, y / id.si / L, 1 / L];
  }
  const w = (a: V3, k: number): V3 => [
    (b.r[0] * a[0] + b.u[0] * a[1] + b.f[0] * a[2]) * k,
    (b.r[1] * a[0] + b.u[1] * a[1] + b.f[1] * a[2]) * k,
    (b.r[2] * a[0] + b.u[2] * a[1] + b.f[2] * a[2]) * k,
  ];
  const ow = w(o, 1e-3),
    dw = w(d, 1);
  ow[1] += EYE;
  const t = intersect(ow, dw);
  if (!Number.isFinite(t)) return Infinity;
  const p: V3 = [ow[0] + dw[0] * t, ow[1] + dw[1] * t - EYE, ow[2] + dw[2] * t];
  return (p[0] * b.f[0] + p[1] * b.f[1] + p[2] * b.f[2]) * 1000;
}

/**
 * AF の枠の点に合わせる撮影距離 [m]（1 km より遠ければ無限遠）。繰り出すと写る向きが少し変わるので、
 * 今の撮影距離で求めた距離に合わせてから、もう 1 度求める
 */
function afDistance(s: Sys, fd: number, N: number): number {
  let D = fd >= INF * 0.999 ? Infinity : fd * 1000;
  for (let i = 0; i < 2; i++) {
    const d = depthAt(solveFocus(s, D, N, 0), afPt[0], afPt[1]);
    if (!Number.isFinite(d) || d > 1e6) return INF;
    D = Math.max(d, 1);
  }
  return Number((D / 1000).toPrecision(6));
}

/** 撮影距離を合わせる（最短撮影距離より近ければ最短に）。合わせた値を返す */
function applyFd(fd: number, silent = false): number {
  const min = G.def('fd').min,
    v = Math.max(min, fd);
  if (v !== G.get('fd')) G.set('fd', v, { silent });
  if (fd < min) G.note('fd', `${mT(fd)} は最短撮影距離より近いため ${mT(min)} にしました`, 'er');
  return v;
}

/** 押した点（または今の枠の点）にピントを合わせる。AF なら次の更新で合わせ直す */
function autofocus(x: number, y: number): void {
  afPt = [Math.max(-SENSOR.w / 2, Math.min(SENSOR.w / 2, x)), Math.max(-SENSOR.h / 2, Math.min(SENSOR.h / 2, y))];
  store('af', afPt);
  afKey = '';
  if (fm$.value === 'mf' && sys) applyFd(afDistance(sys, G.get('fd'), G.get('N')));
  later();
}

/** 枠の点に写る物体が被写界深度に入っていれば、枠を緑にする */
function afState(): void {
  if (!st) return;
  const d = depthAt(st, afPt[0], afPt[1]);
  const ok = Number.isFinite(d)
    ? d >= lastDof.near * (1 - 1e-6) && d <= lastDof.far * (1 + 1e-6)
    : !Number.isFinite(lastDof.far);
  afEl.classList.toggle('ok', ok);
}

{
  let down: { id: number; x: number; y: number; lx: number; ly: number; moved: boolean } | null = null;
  const toMm = (cx: number, cy: number): [number, number] => {
    const r = canvas.getBoundingClientRect(),
      vw = view();
    return [vw.x0 + ((cx - r.left) / r.width) * vw.w, vw.y0 + (1 - (cy - r.top) / r.height) * vw.h];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id || !st) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
    down.moved = true;
    /* 押した点の景色が指についてくる向きに回す（1 画素あたりの角度は像距離から） */
    const r = canvas.getBoundingClientRect(),
      k = ((view().w / r.width / (st.zs - st.card.zH1)) * 180) / Math.PI;
    const dx = e.clientX - down.lx,
      dy = e.clientY - down.ly;
    down.lx = e.clientX;
    down.ly = e.clientY;
    const cl = (v: number, m: number) => angR(Math.max(-m, Math.min(m, v)));
    G.set('pan', cl(G.get('pan') - dx * k, 60));
    G.set('tilt', cl(G.get('tilt') + dy * k, 30));
  });
  const end = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return;
    const d = down;
    down = null;
    if (!d.moved && e.type === 'pointerup') autofocus(...toMm(e.clientX, e.clientY));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('keydown', (e) => {
    /* 1 回の向きの変化は画面の幅の 1/40（Shift は 1/8）。長い焦点距離や拡大でも同じ見え方で動く */
    const fov = st ? ((view().w / (st.zs - st.card.zH1)) * 180) / Math.PI : 40,
      step = Math.max(0.001, angR((fov / 40) * (e.shiftKey ? 5 : 1)));
    const mv: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (e.key in mv) {
      e.preventDefault();
      const [a, b] = mv[e.key];
      G.set('pan', angR(Math.max(-60, Math.min(60, G.get('pan') + a))));
      G.set('tilt', angR(Math.max(-30, Math.min(30, G.get('tilt') + b))));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      autofocus(afPt[0], afPt[1]);
    }
  });
}

/* ---------- 全画面 ---------- */
{
  const fs = $('#fs'),
    btn = $<HTMLButtonElement>('#lv-fs');
  /** 全画面へ移す要素: 映像、右の入力の行、左下の見取り図 */
  const ROWS = ['#p-lens', '#p-f', '#p-N', '#p-fd', '#p-fm', '#p-bl', '#p-zm', '#p-tod', '#p-ch', '#p-df'];
  let back: [Comment, HTMLElement][] = [],
    sy = 0;
  const move = (el: HTMLElement, to: HTMLElement) => {
    const ph = document.createComment('fs');
    el.before(ph);
    back.push([ph, el]);
    to.append(el);
  };
  const open = () => {
    if (!fs.hidden) return;
    sy = scrollY;
    move(lv, $('#fs-v'));
    for (const id of ROWS) move($(id), $('#fs-t'));
    move($('#mapw'), $('#fs-map'));
    fs.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    btn.setAttribute('aria-label', '全画面を閉じる');
    btn.title = '全画面を閉じる';
    fs.requestFullscreen?.().catch(() => {});
    canvas.focus();
  };
  const close = () => {
    if (fs.hidden) return;
    for (const [ph, el] of back) ph.replaceWith(el);
    back = [];
    fs.hidden = true;
    document.documentElement.style.overflow = '';
    btn.setAttribute('aria-label', '全画面で表示');
    btn.title = '全画面で表示';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    scrollTo(0, sy);
    btn.focus();
  };
  btn.addEventListener('click', () => (fs.hidden ? open() : close()));
  /* ブラウザの全画面を Esc などで抜けたら、こちらも閉じる */
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !fs.hidden && !document.fullscreenElement && !(e.target instanceof HTMLInputElement))
      close();
  });
}

later();

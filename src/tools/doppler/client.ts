/**
 * ドップラー効果のページ。音は AudioWorklet（worklet.ts）が音源と聞き手の位置から作り、図とグラフは kin.ts の式で描く。
 * 波面はストロボで照らしたように、決まった間隔で出た波面だけを描く（本数を保ち、見かけだけゆっくり広げる）。
 * 円の中心と半径はその波面が出た時刻の音源の位置と経過時間で決めるので、ある瞬間の図は実時間のまま正しい
 */
import { absorption, soundSpeed } from '../../lib/air';
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { minus } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { DV, nice } from '../../lib/scope';
import { initToolPage } from '../../lib/tool-page';
import { DopplerAudio } from './audio';
import { ampFactor, type Emission, emissions, type Pass, passAt, vec } from './kin';
import { DIST, LSPEED, type MoreKey, RH, SPEED, type SrcKey, TEMP, TONE, VOL } from './params';
import type { PropSet } from './prop';
import { engineRpm, HORN, SIREN, type SourceId, sourceOf } from './sources';

initToolPage();

const u = (v: string, unit: string) => `${v}<span class="u">${unit}</span>`;
const NS = 'http://www.w3.org/2000/svg';

/* ---------- 状態 ---------- */
const audio = new DopplerAudio();
/** 聞き手の耳の高さ [m] */
const HL = 1.5;
let src: SourceId = 'siren',
  /** 音源の速さ・聞き手の速さ [m/s]、すれ違う距離 [m]、正弦波の周波数 [Hz]、気温 [°C]、湿度 [%] */
  v = 60 / 3.6,
  lu = 0,
  dist = 10,
  tone = 1000,
  temp = 20,
  rh = 50,
  absorb = true,
  ground = true,
  moving = true,
  playing = false,
  /** グラフの準備ができたか（入力の生成時の呼び出しでは描かない） */
  booted = false;
const c = () => soundSpeed(temp);
const spec = () => sourceOf(src);
const propSet = (): PropSet => ({
  c: c(),
  air: { t: temp, rh },
  absorb,
  ground: ground ? 1 : 0,
  hs: spec().h,
  hl: HL,
  r0: spec().r0,
});
/** グラフと計算結果の周波数の基準 [Hz]: サイレンはピー、警笛は高い音、エンジンは点火の周波数 */
function fRef(): number {
  if (src === 'siren') return SIREN.hi;
  if (src === 'horn') return HORN.hi;
  if (src === 'engine') return engineRpm(v).rpm / 120;
  return tone;
}
/** 直接音の音圧レベル [dB]（距離・動く点音源の (1 − M_r)⁻²・空気の吸収。地面の反射は入れない） */
function level(e: Emission): number {
  const s = spec(),
    a = Math.abs(ampFactor(e.r, e.mr, s.r0));
  return s.db + 20 * Math.log10(a) - (absorb ? absorption(fRef() * Math.abs(e.ratio), { t: temp, rh }) * e.r : 0);
}
/** 距離だけで弱まるときの音圧レベル [dB] */
const levelR = (r: number): number => spec().db + 20 * Math.log10(spec().r0 / Math.max(1, r));

/* ---------- 位置（図の座標: 道路が y = 0、x は右向き [m]） ---------- */
let xs = 0,
  lx = 0,
  ly = dist,
  jump = false,
  drag: 's' | 'l' | null = null,
  /** 図の時刻 [s]（実時間） */
  simT = 0;
/** 音源の位置の記録（波面の中心） */
const hist: { t: number; x: number }[] = [];
/** 音源の今の速さ（止めているとき・ドラッグ中は 0） */
const vNow = () => (moving && drag !== 's' ? v : 0);
const uNow = () => (drag === 'l' ? 0 : lu);

/* ---------- 入力 ---------- */
const srcPg = new ParamGroup<SrcKey>([SPEED, DIST], (p, k) => {
  v = p.v / 3.6;
  dist = p.d;
  if (k === 'd' || k === undefined) ly = Math.sign(ly || 1) * dist;
  if (k === 'v') hist.length = 0;
  redraw();
});
new ParamGroup<MoreKey>([LSPEED, TONE, TEMP, RH], (p, k) => {
  lu = p.u / 3.6;
  tone = p.tone;
  temp = p.temp;
  rh = p.rh;
  if (k === 'tone') audio.tone(tone);
  if (k === 'temp' || k === 'rh') audio.set(propSet());
  redraw();
});
new ParamGroup<'vol'>([VOL], (p) => audio.vol(p.vol));
new Choice<SourceId>($('#p-src'), (s) => {
  src = s;
  $('#p-tone').hidden = s !== 'tone';
  if (playing) audio.start(src, propSet(), tone);
  redraw();
});
$('#p-tone').hidden = true;
new Choice<'1' | '0'>($('#p-abs'), (s) => {
  absorb = s === '1';
  audio.set(propSet());
  redraw();
});
new Choice<'1' | '0'>($('#p-gnd'), (s) => {
  ground = s === '1';
  audio.set(propSet());
});

/* ---------- 走らせる・止める ---------- */
const moveBtn = $('#moveBtn');
moveBtn.addEventListener('click', () => {
  moving = !moving;
  moveBtn.setAttribute('aria-pressed', String(moving));
});

/* ---------- 音 ---------- */
const playBtn = $('#playBtn'),
  playLed = $('#playLed'),
  playT = $('#playT'),
  sndMsg = $('#snd-msg');
function setPlay(on: boolean): void {
  playing = on;
  playBtn.setAttribute('aria-pressed', String(on));
  playLed.classList.toggle('on', on);
  playT.textContent = on ? '鳴っている' : '鳴らす';
}
playBtn.addEventListener('click', async () => {
  if (playing) {
    audio.stop();
    setPlay(false);
    return;
  }
  sndMsg.textContent = '';
  if (!(await audio.ready())) {
    sndMsg.textContent = 'このブラウザでは音を鳴らせません';
    return;
  }
  audio.start(src, propSet(), tone);
  setPlay(true);
});
/* スマートフォンで画面が隠れたら止める（lib/pause.ts と同じ考え） */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld() && playing) {
    audio.stop();
    setPlay(false);
  }
});

/* ---------- 道路の図（canvas） ---------- */
const cv = $<HTMLCanvasElement>('#road'),
  ctx = cv.getContext('2d') as CanvasRenderingContext2D;
let W = 0,
  H = 0,
  /** 図の縮尺 [px/m]、左右の端の x [m]、道路の y [px] */
  sx = 1,
  half = 160,
  cy = 0;
const narrow = () => W < 600;
function resize(): void {
  const w = cv.clientWidth || 300,
    dpr = Math.min(2, devicePixelRatio || 1),
    h = Math.round(w / (w < 600 ? 1.5 : 3.2));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = `${h}px`;
  }
  W = w;
  H = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
/** 縮尺: 道路の長さは広い図で ±160 m、狭い図で ±60 m。聞き手が下にはみ出るときは縮める */
function scale(): void {
  cy = H * 0.34;
  const base = narrow() ? 60 : 160;
  sx = Math.min(W / (2 * base), (H - cy - 24) / Math.max(12, Math.abs(ly) * 1.1));
  half = W / (2 * sx);
}
const X = (x: number) => W / 2 + x * sx,
  Y = (y: number) => cy + y * sx;

/** 波面の本数と、ストロボで 1 間隔ぶん広がるのにかかる時間 [s] */
const N = 9,
  P = 2;
/** 波面の間隔 [s]: 図の幅の 1/12 ずつ（音速を超えたら音源が進む距離で） */
const gap = () => (2 * half) / 12 / Math.max(c(), vNow());
/** 時刻 t の音源の位置（記録から補間。記録より前は null） */
function posAt(t: number): number | null {
  for (let i = hist.length - 1; i > 0; i--)
    if (hist[i - 1].t <= t) {
      const a = hist[i - 1],
        b = hist[i];
      return a.x + (b.x - a.x) * ((t - a.t) / (b.t - a.t || 1));
    }
  return hist.length && t >= hist[0].t - 1e-6 ? hist[0].x : null;
}

let col: Record<string, string> = {};
function colors(): void {
  const s = getComputedStyle(document.documentElement),
    g = (n: string) => s.getPropertyValue(n).trim();
  col = {
    ink: g('--ink'),
    ink3: g('--ink-3'),
    scr: g('--screen-ink'),
    ch1: g('--ch1'),
    ch2: g('--ch2'),
    acc: g('--accent'),
    mono: g('--mono'),
  };
}
colors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', colors);
new MutationObserver(colors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/** 今の音源・聞き手の位置と速度で、いま聞こえる音の放射時刻 */
const rootsNow = (): Emission[] =>
  emissions(vec(xs, 0, spec().h), vec(vNow(), 0, 0), vec(lx, ly, HL), vec(uNow(), 0, 0), c());

function drawRoad(rs: Emission[]): void {
  ctx.clearRect(0, 0, W, H);
  /* 道路（幅 7 m）と中央線 */
  ctx.fillStyle = col.scr;
  ctx.globalAlpha = 0.13;
  ctx.fillRect(0, Y(-3.5), W, 7 * sx);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = col.scr;
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, Y(0));
  ctx.lineTo(W, Y(0));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  /* 波面（ストロボ） */
  const g = gap(),
    ph = (simT / P) % 1;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = col.ch2;
  for (let k = 0; k < N; k++) {
    const age = (k + ph) * g,
      uu = (k + ph) / N,
      x = posAt(simT - age),
      r = c() * age;
    if (x === null || r <= 0) continue;
    ctx.globalAlpha = 0.85 * (1 - uu) * Math.min(1, uu * 10);
    ctx.beginPath();
    ctx.arc(X(x), Y(0), r * sx, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  /* マッハ円錐 */
  const M = vNow() / c();
  if (M > 1) {
    const mu = Math.asin(1 / M),
      L = (Math.abs(xs) + 3 * half) / Math.cos(mu);
    ctx.strokeStyle = col.ch1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const s of [1, -1]) {
      ctx.moveTo(X(xs), Y(0));
      ctx.lineTo(X(xs - L * Math.cos(mu)), Y(s * L * Math.sin(mu)));
    }
    ctx.stroke();
  }
  /* いま聞こえる音の出どころ */
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = col.ink3;
  ctx.lineWidth = 1.2;
  for (const e of rs) {
    const ex = xs - vNow() * e.delay;
    ctx.beginPath();
    ctx.moveTo(X(ex), Y(0));
    ctx.lineTo(X(lx), Y(ly));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(ex), Y(0), 5, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  /* 音源と聞き手 */
  ctx.fillStyle = col.ink;
  ctx.fillRect(X(xs) - 10, Y(0) - 5, 20, 10);
  ctx.fillStyle = col.acc;
  ctx.fillRect(X(xs) - 2, Y(0) - 2, 4, 4);
  ctx.beginPath();
  ctx.fillStyle = col.ink;
  ctx.arc(X(lx), Y(ly), 6, 0, 2 * Math.PI);
  ctx.fill();
  ctx.font = `11px ${col.mono}`;
  ctx.fillStyle = col.scr;
  ctx.textAlign = 'center';
  ctx.fillText('聞き手', X(lx), Y(ly) + (ly >= 0 ? 19 : -11));
  /* 目盛り */
  const bar = nice(half / 3);
  ctx.textAlign = 'left';
  ctx.fillText(`${bar} m`, 10, H - 10);
  ctx.strokeStyle = col.scr;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(52, H - 14);
  ctx.lineTo(52 + bar * sx, H - 14);
  ctx.stroke();
}

/* ドラッグ: 聞き手は自由に、音源は道路に沿って */
cv.addEventListener('pointerdown', (e) => {
  const rc = cv.getBoundingClientRect(),
    px = e.clientX - rc.left,
    py = e.clientY - rc.top,
    dl = Math.hypot(px - X(lx), py - Y(ly)),
    ds = Math.hypot(px - X(xs), py - Y(0));
  drag = dl < 26 ? 'l' : ds < 30 ? 's' : null;
  if (!drag) return;
  e.preventDefault();
  cv.setPointerCapture(e.pointerId);
  cv.classList.add('drag');
});
cv.addEventListener('pointermove', (e) => {
  const rc = cv.getBoundingClientRect(),
    px = e.clientX - rc.left,
    py = e.clientY - rc.top;
  if (!drag) {
    const near = Math.hypot(px - X(lx), py - Y(ly)) < 26 || Math.hypot(px - X(xs), py - Y(0)) < 30;
    cv.style.cursor = near ? 'grab' : '';
    return;
  }
  const x = Math.max(-half, Math.min(half, (px - W / 2) / sx));
  if (drag === 'l') {
    const y = (py - cy) / sx;
    lx = x;
    ly = (y < 0 ? -1 : 1) * Math.max(DIST.min, Math.min(DIST.max, Math.abs(y)));
  } else xs = x;
});
const endDrag = () => {
  if (drag === 'l') {
    dist = Math.round(Math.abs(ly) * 2) / 2;
    srcPg.set('d', dist);
  }
  drag = null;
  cv.classList.remove('drag');
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

/* ---------- すれ違いのグラフ（SVG、10 × 6 div） ---------- */
interface Graph {
  g: SVGGElement;
  now: SVGPathElement;
  dots: SVGGElement;
  /** 横軸 1 div [s]、縦軸 1 div と下端の値 */
  td: number;
  vd: number;
  y0: number;
}
function mkGraph(id: string): Graph {
  const svg = $<SVGSVGElement>(id),
    g = svg.querySelector('.cv') as SVGGElement,
    now = document.createElementNS(NS, 'path'),
    dots = document.createElementNS(NS, 'g');
  now.setAttribute('class', 'nowl');
  svg.append(now, dots);
  return { g, now, dots, td: 1, vd: 1, y0: 0 };
}
const gF = mkGraph('#fq-svg'),
  gL = mkGraph('#lv-svg');
/** グラフの縦の div の数 */
const GR = 4;
const GX = (gr: Graph, t: number) => 5 * DV + (t / gr.td) * DV,
  GY = (gr: Graph, y: number) => GR * DV - ((y - gr.y0) / gr.vd) * DV;
/** 1-2-5 で x 以上の切りのよい値 */
const niceUp = (x: number) => {
  const n = nice(x);
  return n < x * 0.999 ? nice(n * 1.01 * (x / n)) : n;
};
const fmtN = (v: number) => {
  const a = Math.abs(v);
  return minus(
    a >= 100 ? String(Math.round(v)) : a >= 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Number(v.toPrecision(2))),
  );
};
const tFmt = (t: number) => minus(`${Number(t.toPrecision(3))}`);

/** すれ違い（音源と聞き手が並ぶ時刻を 0）の曲線を描き直す */
function redraw(): void {
  if (!booted) return;
  const p: Pass = { v, d: dist, c: c(), hs: spec().h, hl: HL, u: lu },
    w = Math.max(0.5, Math.abs(v - lu)),
    td = niceUp(Math.min(8, Math.max(0.2, (1.2 * half) / w)) / 5),
    f0 = fRef(),
    n = 400,
    ts = Array.from({ length: n + 1 }, (_, i) => -5 * td + (10 * td * i) / n),
    rows = ts.map((t) => passAt(p, t));
  gF.td = gL.td = td;
  /* 周波数: f₀ の 0.2〜3 倍に収める */
  let lo = f0,
    hi = f0;
  for (const rs of rows)
    for (const e of rs) {
      const f = Math.abs(e.ratio) * f0;
      if (f < 3 * f0 && f > 0.2 * f0) {
        lo = Math.min(lo, f);
        hi = Math.max(hi, f);
      }
    }
  let vd = niceUp(Math.max((hi - lo) / (GR - 0.4), f0 * 0.005)),
    y0 = Math.round((lo + hi) / 2 / vd - GR / 2) * vd;
  while (y0 > lo || y0 + GR * vd < hi) {
    vd = niceUp(vd * 1.05);
    y0 = Math.round((lo + hi) / 2 / vd - GR / 2) * vd;
  }
  gF.vd = vd;
  gF.y0 = y0;
  let lmax = -Infinity;
  for (const rs of rows) for (const e of rs) lmax = Math.max(lmax, Math.min(160, level(e)));
  /* 大きさ: 10 dB/div（範囲が広ければ 20 dB/div）、上端は最大の上の 10 dB 刻み */
  let lmin = Infinity;
  for (const rs of rows) for (const e of rs) lmin = Math.min(lmin, level(e));
  const top = Math.ceil((Number.isFinite(lmax) ? lmax : 100) / 10) * 10;
  gL.vd = top - lmin > GR * 10 ? 20 : 10;
  gL.y0 = top - GR * gL.vd;
  const path = (gr: Graph, val: (e: Emission) => number, branch: number) => {
    let d = '',
      pen = false;
    rows.forEach((rs, i) => {
      const e = rs[branch];
      if (!e) {
        pen = false;
        return;
      }
      const y = Math.max(-6, Math.min(GR * DV + 6, GY(gr, val(e))));
      d += `${pen ? 'L' : 'M'}${GX(gr, ts[i]).toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const fv = (e: Emission) => Math.abs(e.ratio) * f0;
  let s = `<path class="f0l" d="M0 ${GY(gF, f0).toFixed(1)}H${10 * DV}"/>`;
  s += `<path class="t1" d="${path(gF, fv, 0)}"/><path class="t1" d="${path(gF, fv, 1)}"/>`;
  s += axes(gF, (y) => fmtN(y));
  gF.g.innerHTML = s;
  let dr = '';
  ts.forEach((t, i) => {
    const r = Math.hypot((v - lu) * t, dist, HL - spec().h);
    dr += `${i ? 'L' : 'M'}${GX(gL, t).toFixed(1)} ${Math.max(-6, Math.min(GR * DV + 6, GY(gL, levelR(r)))).toFixed(1)}`;
  });
  gL.g.innerHTML =
    `<path class="f0l" d="${dr}"/><path class="t2" d="${path(gL, level, 0)}"/><path class="t2" d="${path(gL, level, 1)}"/>` +
    axes(gL, (y) => String(Math.round(y)));
  $('#f-vd').textContent = `${fmtN(vd)} Hz`;
  $('#f-f0').textContent = `${fmtN(f0)} Hz`;
  $('#l-vd').textContent = `${gL.vd} dB`;
  for (const id of ['#f-td', '#l-td']) $(id).textContent = `${tFmt(td)} s`;
  /* 計算結果のうち、位置によらない値 */
  const M = v / c();
  $('#o-fb').innerHTML = M < 1 ? u(fmtN(f0 / (1 - M)), 'Hz') : '—';
  $('#o-fa').innerHTML = u(fmtN(f0 / (1 + M)), 'Hz');
  $('#o-m').textContent = M.toFixed(3);
  $('#mM').textContent = M.toFixed(2);
}
function axes(gr: Graph, f: (y: number) => string): string {
  let a = '';
  for (let j = 0; j <= GR; j++)
    a += `<text x="-6" y="${GR * DV - j * DV + 4}" text-anchor="end">${f(gr.y0 + j * gr.vd)}</text>`;
  for (const i of [0, 5, 10])
    a += `<text x="${i * DV}" y="${GR * DV + 17}" text-anchor="${i ? (i === 10 ? 'end' : 'middle') : 'start'}">${i === 5 ? '0' : `${tFmt((i - 5) * gr.td)} s`}</text>`;
  return a;
}

/** グラフの「今」: 音源と聞き手が並ぶ時刻からの時間 */
function drawNow(rs: Emission[]): void {
  const w = vNow() - uNow(),
    t = Math.abs(w) > 0.1 ? (xs - lx) / w : Number.NaN;
  for (const [gr, val] of [
    [gF, (e: Emission) => Math.abs(e.ratio) * fRef()],
    [gL, level],
  ] as const) {
    const ok = Number.isFinite(t) && Math.abs(t) <= 5 * gr.td;
    gr.now.setAttribute('d', ok ? `M${GX(gr, t).toFixed(1)} 0V${GR * DV}` : '');
    let s = '';
    if (ok)
      for (const e of rs)
        s += `<circle class="nowd" cx="${GX(gr, t).toFixed(1)}" cy="${Math.max(0, Math.min(GR * DV, GY(gr, val(e)))).toFixed(1)}" r="4"/>`;
    gr.dots.innerHTML = s;
  }
}

/* ---------- 計算結果 ---------- */
function setOut(rs: Emission[]): void {
  const f0 = fRef(),
    e = rs[0],
    fs = rs.map((x) => fmtN(Math.abs(x.ratio) * f0));
  $('#o-f').innerHTML = e ? u(fs.join(' / '), 'Hz') : u('—', '');
  $('#o-r').innerHTML = e ? u(e.r.toFixed(1), 'm') : '—';
  $('#o-dl').innerHTML = e ? u(String(Math.round(e.delay * 1000)), 'ms') : '—';
  $('#o-l').innerHTML = e ? u(level(e).toFixed(1), 'dB') : '—';
  $('#mF').textContent = e ? `${fs[0]} Hz` : '—';
  $('#mL').textContent = e ? `${level(e).toFixed(0)} dB` : '—';
  $('#o-n').textContent = rs.length >= 2 ? '2 つ（マッハ円錐の内側）' : rs.length ? '1 つ' : 'まだ届かない';
}

/* ---------- 毎フレーム ---------- */
let last = performance.now(),
  outT = 0,
  wasNarrow: boolean | null = null;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  resize();
  scale();
  if (wasNarrow !== narrow()) {
    wasNarrow = narrow();
    redraw();
  }
  simT += dt;
  /* 音源は道路の端から端へ。速いときは、通り過ぎた音が届き終わるまで画面の外を 2 秒走らせる */
  const L = Math.max(half * 1.15, half + 2 * v);
  if (moving && drag !== 's') {
    xs += v * dt;
    if (xs > L) {
      xs = -L;
      jump = true;
      hist.length = 0;
    }
  }
  if (drag !== 'l' && lu) {
    lx += lu * dt;
    if (Math.abs(lx) > half) {
      lx -= Math.sign(lx) * 2 * half;
      jump = true;
    }
  }
  hist.push({ t: simT, x: xs });
  while (hist.length > 2 && hist[1].t < simT - (N + 1) * gap()) hist.shift();
  if (playing) audio.pos({ sx: xs, sy: 0, lx, ly, jump, v: vNow() });
  jump = false;
  const rs = rootsNow();
  drawRoad(rs);
  drawNow(rs);
  if (now - outT > 100) {
    outT = now;
    setOut(rs);
  }
  requestAnimationFrame(frame);
}
xs = -half;
booted = true;
requestAnimationFrame(frame);

/**
 * オシロスコープの入口: 入力（マイク・ファイル・テスト信号）→ トリガ → 波形・リサジュー・測定。
 * 毎フレーム直近 NB 点を受け取り、トリガの位置を探して表示窓に描く
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, fmtR, minus, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { DV } from '../../lib/scope';
import { storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { NB } from '../audio/capture';
import { initInput } from '../audio/input';
import { corr, dbfs, findTrig, freqOf, phaseDiff, type Slope, stats } from './measure';
import { FADE, HY, type Hy, type Key, type Mode, PARAMS, type Persist, signed, type XyMode } from './params';

initToolPage();
const { a, tick: inTick } = initInput();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};

/* 表示窓: 10 × 8 div（400 × 320）。振幅 0 は中央 */
const W = 10 * DV,
  H = 8 * DV,
  MID = H / 2;

/* ---------- 状態 ---------- */
const O = {
  view: 'yt' as 'yt' | 'xy',
  run: true,
  hd: 200e-6,
  vd: 0.2,
  lay: 'ov' as 'ov' | 'sp',
  mode: 'auto' as Mode,
  ts: 1 as 1 | 2,
  slope: 'up' as Slope,
  lv: 0,
  pos: 0.1,
  hy: 'lo' as Hy,
  ch1: true,
  ch2: true,
  /** トリガの状態（表示窓の右上） */
  st: 'AUTO',
  /** トリガレベルの線を出しておく時刻（performance.now） */
  lvT: 0,
  drag: false,
  /** カーソルの位置（表示窓の x）。外なら null */
  cur: null as number | null,
  xy: 'xy' as XyMode,
  xr: 1,
  xl: 0.02,
  xp: 'short' as Persist,
  /** リサジューを描き直す（前の線を残さない） */
  xyClear: true,
};
/** 表示している波形: 直近 NB 点の写しと、トリガの位置（標本の番号） */
let fr: { L: Float32Array; R: Float32Array; c: number; fs: number } | null = null;

/* ---------- 入力 ---------- */
/* 生成時の 1 回目（k なし）は初期値のままなので何もしない */
const g = new ParamGroup<Key>(PARAMS, (v, k) => {
  if (!k) return;
  O.hd = v.hd;
  O.vd = v.vd;
  O.lv = v.tl;
  if (k === 'tl') O.lvT = performance.now() + 1500;
  labels();
});
const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
choice<'ov' | 'sp'>('lay', (v) => {
  O.lay = v;
  labels();
});
choice<string>('tp', (v) => {
  O.pos = Number(v);
  labels();
});
choice<Mode>('tm', (v) => {
  O.mode = v;
  if (v === 'single') setRun(true);
});
choice<'1' | '2'>('ts', (v) => {
  O.ts = v === '2' ? 2 : 1;
  labels();
});
choice<Slope>('tsl', (v) => {
  O.slope = v;
  labels();
});
choice<Hy>('tn', (v) => {
  O.hy = v;
});
choice<XyMode>('xm', (v) => {
  O.xy = v;
  O.xyClear = true;
  xyLabels();
});
choice<string>('xr', (v) => {
  O.xr = Number(v);
  O.xyClear = true;
  xyLabels();
});
choice<string>('xl', (v) => {
  O.xl = Number(v);
  O.xyClear = true;
});
choice<Persist>('xp', (v) => {
  O.xp = v;
  O.xyClear = true;
});
/* 波形とリサジューの切り替え（同じ枠に、選んだほうだけを出す） */
new Choice<'yt' | 'xy'>($('#p-view'), (v) => {
  O.view = v;
  $('#v-yt').hidden = v !== 'yt';
  $('#v-xy').hidden = v !== 'xy';
  txt('#hd-wave', v === 'xy' ? 'リサジュー' : '波形');
  O.xyClear = true;
});
function setRun(on: boolean): void {
  O.run = on;
  const b = $('#runO');
  b.setAttribute('aria-pressed', String(on));
  $('#runOLed').classList.toggle('on', on);
  txt('#runOT', on ? 'RUN' : 'STOP');
  if (!on) O.st = 'STOP';
}
$('#runO').addEventListener('click', () => setRun(!O.run));
for (const c of [1, 2] as const)
  $(`#ch${c}`).addEventListener('click', (e) => {
    const k = c === 1 ? 'ch1' : 'ch2';
    O[k] = !O[k];
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(O[k]));
    labels();
  });

/* ---------- 波形 ---------- */
const yOff = (ch: 1 | 2) => (O.lay === 'sp' ? (ch === 1 ? 2 : -2) * DV : 0);
const Y = (v: number, ch: 1 | 2) => MID - yOff(ch) - (v / O.vd) * DV;
const SLOPE_MARK: Record<Slope, string> = { up: '↑', down: '↓', both: '↕' };
const vds = (v: number) => minus(String(Number(v.toPrecision(3))));

/** 目盛りの数値・接地とトリガの印・表示窓の上の表記 */
function labels(): void {
  let s = '';
  for (let i = 0; i <= 10; i += 2) {
    const t = (i - O.pos * 10) * O.hd;
    s += `<text x="${i * DV}" y="${H + 17}" text-anchor="middle">${Math.abs(t) < 1e-12 ? '0' : fmt(t, 's', 3)}</text>`;
  }
  if (O.lay === 'ov')
    for (let j = 0; j <= 8; j += 2) {
      const v = (4 - j) * O.vd;
      s += `<text x="-10" y="${j * DV + 4}" text-anchor="end">${v === 0 ? '0' : (v > 0 ? '+' : '') + vds(v)}</text>`;
    }
  for (const c of [1, 2] as const)
    if (c === 1 ? O.ch1 : O.ch2) s += `<path class="mk${c}" d="M-8 ${Y(0, c) - 5}L-1 ${Y(0, c)}L-8 ${Y(0, c) + 5}Z"/>`;
  const c = O.ts,
    tx = O.pos * W,
    ty = Math.max(-4, Math.min(H + 4, Y(O.lv, c)));
  s += `<path class="mk${c}" d="M${tx - 5} -12L${tx + 5} -12L${tx} -5Z"/><path class="mk${c}" id="w-tlm" d="M${W + 1} ${ty}l7 -6v12Z"/>`;
  html('#w-axes', s);
  for (const b of document.querySelectorAll('.s-vd')) b.textContent = vds(O.vd);
  txt('#s-hd', fmt(O.hd, 's', 3));
  txt('#s-trig', `CH${c} ${SLOPE_MARK[O.slope]} ${signed(O.lv)}`);
  txt('#o-aux', `CH${c}`);
  $('#w-th').setAttribute('class', `th st${c}`);
}

/** 1 チャンネルの線。点が多ければ表示窓の 0.5 ごとに最小と最大を結ぶ */
function trace(arr: Float32Array, c: number, fs: number, ch: 1 | 2): string {
  const x0 = O.pos * W,
    k = DV / (O.hd * fs),
    iA = Math.max(0, Math.floor(c - x0 / k) - 1),
    iB = Math.min(arr.length - 1, Math.ceil(c + (W - x0) / k) + 1),
    y = (v: number) => Math.max(-400, Math.min(H + 400, Y(v, ch))).toFixed(1);
  let d = '';
  if (iB - iA <= 1600) {
    for (let i = iA; i <= iB; i++) d += `${i === iA ? 'M' : 'L'}${(x0 + (i - c) * k).toFixed(2)} ${y(arr[i])}`;
    return d;
  }
  for (let j = 0; j < 2 * W; j++) {
    const xs = j / 2,
      i0 = Math.max(0, Math.floor(c + (xs - x0) / k)),
      i1 = Math.min(arr.length - 1, Math.floor(c + (xs + 0.5 - x0) / k));
    let lo = Infinity,
      hi = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const v = arr[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo !== Infinity) d += `${d ? 'L' : 'M'}${xs} ${y(hi)}L${xs} ${y(lo)}`;
  }
  return d;
}

/** トリガを探して、表示する波形を決める */
function acquire(fresh: boolean): void {
  const fs = a.fs,
    cnt = 10 * O.hd * fs,
    pre = O.pos * cnt,
    post = cnt - pre;
  if (O.run && fresh) {
    const c = findTrig(O.ts === 1 ? a.L : a.R, O.lv, O.slope, HY[O.hy], pre + 1, NB - post - 2);
    if (c >= 0) {
      fr = { L: a.L.slice(), R: a.R.slice(), c, fs };
      O.st = "TRIG'D";
      if (O.mode === 'single') setRun(false);
    } else if (O.mode === 'auto') {
      fr = { L: a.L.slice(), R: a.R.slice(), c: NB - post - 2, fs };
      O.st = 'AUTO';
    } else O.st = O.mode === 'single' ? 'ARMED' : 'WAIT';
  }
  if (O.run && !a.run) O.st = 'NO INPUT';
}

function drawWave(now: number): void {
  txt('#s-st', O.st);
  $('#w-t1').setAttribute('d', fr && O.ch1 ? trace(fr.L, fr.c, fr.fs, 1) : '');
  $('#w-t2').setAttribute('d', fr && O.ch2 ? trace(fr.R, fr.c, fr.fs, 2) : '');
  $('#w-th').setAttribute('d', now < O.lvT || O.drag ? `M0 ${Y(O.lv, O.ts).toFixed(1)}H${W}` : '');
  cursor();
}

/* カーソルの読み値と、トリガレベルのドラッグ */
const svg = $<SVGSVGElement>('#w-svg');
const svgPt = (e: PointerEvent): [number, number] | null => {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [p.x, p.y];
};
const lerp = (arr: Float32Array, x: number) => {
  const i = Math.floor(x),
    t = x - i;
  return i < 0 || i + 1 >= arr.length ? Number.NaN : arr[i] * (1 - t) + arr[i + 1] * t;
};
function cursor(): void {
  if (O.cur === null || !fr) {
    $('#w-cur').setAttribute('d', '');
    txt('#w-rd', '');
    return;
  }
  const x = O.cur,
    t = ((x - O.pos * W) / DV) * O.hd,
    i = fr.c + t * fr.fs,
    v = (arr: Float32Array) => {
      const q = lerp(arr, i);
      return Number.isFinite(q) ? signed(q, 3) : '—';
    };
  $('#w-cur').setAttribute('d', `M${x.toFixed(1)} 0V${H}`);
  txt('#w-rd', `t ${Math.abs(t) < 1e-12 ? '0' : fmtR(t, 's', 3)}   CH1 ${v(fr.L)}   CH2 ${v(fr.R)}`);
}
svg.addEventListener('pointerdown', (e) => {
  const p = svgPt(e);
  if (p && p[0] > W - 20 && Math.abs(p[1] - Y(O.lv, O.ts)) < 18) {
    O.drag = true;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});
svg.addEventListener('pointermove', (e) => {
  const p = svgPt(e);
  if (!p) return;
  if (O.drag) {
    const v = Math.max(-1, Math.min(1, Math.round(((MID - yOff(O.ts) - p[1]) / DV) * O.vd * 100) / 100));
    if (v !== O.lv) g.set('tl', v);
    return;
  }
  O.cur = p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H ? p[0] : null;
});
svg.addEventListener('pointerup', () => {
  O.drag = false;
});
svg.addEventListener('pointerleave', () => {
  if (!O.drag) O.cur = null;
});

/* ---------- リサジュー ---------- */
const cv = $<HTMLCanvasElement>('#x-cv'),
  ctx = cv.getContext('2d');
let ink = '';
const readInk = () => {
  ink = getComputedStyle(document.documentElement).getPropertyValue('--ch1').trim();
  O.xyClear = true;
};
readInk();
/* テーマを変えたら線の色を読み直す */
new MutationObserver(readInk).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readInk);
new ResizeObserver(() => {
  const w = Math.round(cv.clientWidth * devicePixelRatio);
  if (w && w !== cv.width) {
    cv.width = cv.height = w;
    O.xyClear = true;
  }
}).observe(cv);

function xyLabels(): void {
  let s = '';
  for (let i = 0; i <= 8; i++) s += `<path class="gl" d="M${i * DV} 0V${H}M0 ${i * DV}H${H}"/>`;
  for (let p = 8; p < H; p += 8) s += `<path class="gb" d="M${p} ${MID - 3}v6M${MID - 3} ${p}h6"/>`;
  s += `<rect class="gb" x="0" y="0" width="${H}" height="${H}"/>`;
  if (O.xy === 'ms')
    s += `<path class="mkl" d="M0 0L${H} ${H}M${H} 0L0 ${H}"/><text class="xyl" x="8" y="14">L</text><text class="xyl" x="${H - 8}" y="14" text-anchor="end">R</text><text class="xyl" x="${MID + 6}" y="14">M</text><text class="xyl" x="8" y="${MID + 12}">S</text>`;
  else
    s += `<text class="xyl" x="${H - 6}" y="${MID + 14}" text-anchor="end">CH1</text><text class="xyl" x="${MID + 6}" y="14">CH2</text>`;
  html('#x-svg', s);
  html('#x-ax', O.xy === 'ms' ? 'M <b>L+R</b> S <b>L−R</b>' : 'X <b>CH1</b> Y <b>CH2</b>');
  txt('#x-dv', String(O.xr / 4));
}
function drawXy(fresh: boolean): void {
  if (!ctx) return;
  const src = O.run ? a : fr;
  if (!src || (!O.xyClear && (!fresh || !O.run))) return;
  const w = cv.width,
    h = w / 2,
    k = h / O.xr;
  if (O.xyClear || O.xp === 'off') ctx.clearRect(0, 0, w, w);
  else {
    /* 前の線を薄くする（残光） */
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${FADE[O.xp]})`;
    ctx.fillRect(0, 0, w, w);
    ctx.globalCompositeOperation = 'source-over';
  }
  O.xyClear = false;
  const M = Math.min(NB - 1, Math.round(O.xl * a.fs)),
    step = Math.max(1, Math.floor(M / 6000)),
    s0 = NB - M,
    ms = O.xy === 'ms';
  ctx.beginPath();
  for (let i = s0; i < NB; i += step) {
    const l = src.L[i],
      r = src.R[i],
      x = ms ? (r - l) * Math.SQRT1_2 : l,
      y = ms ? (l + r) * Math.SQRT1_2 : r;
    if (i === s0) ctx.moveTo(h + x * k, h - y * k);
    else ctx.lineTo(h + x * k, h - y * k);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.3 * devicePixelRatio;
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
  const r = corr(src.L, src.R, M);
  txt('#x-corr', Number.isFinite(r) ? signed(r) : '—');
}

/* ---------- 測定 ---------- */
const dbHtml = (v: number) => `${v < -150 ? '−∞' : minus(v.toFixed(2))}<span class="u">dBFS</span>`;
function measure(): void {
  const src = O.run ? a : fr;
  if (!src) return;
  const fs = a.fs,
    s1 = stats(src.L),
    s2 = stats(src.R),
    f = freqOf(O.ts === 1 ? src.L : src.R, fs, O.ts === 1 ? s1 : s2),
    ph = phaseDiff(src.L, src.R, f, fs),
    r1 = dbfs(Math.SQRT2 * s1.rms);
  html('#o-f', Number.isFinite(f) ? ro(f, 'Hz', 5) : '—');
  html('#o-T', Number.isFinite(f) ? ro(1 / f, 's', 4) : '—');
  html('#o-ph', Number.isFinite(ph) ? `${signed(ph, 1)}<span class="u">°</span>` : '—');
  html('#o-r1', dbHtml(r1));
  html('#o-r2', dbHtml(dbfs(Math.SQRT2 * s2.rms)));
  html('#o-p1', dbHtml(dbfs(s1.pk)));
  html('#o-p2', dbHtml(dbfs(s2.pk)));
  txt('#mf', fmtR(f, 'Hz', 4));
  txt('#mr', `${r1 < -150 ? '−∞' : minus(r1.toFixed(1))} dBFS`);
  txt('#mt', O.st);
}

/* ---------- 毎フレーム ---------- */
let frame = 0;
let epoch = a.epoch;
/** 入力元が変わったら、前の入力の波形と測定を消す */
function newInput(): void {
  epoch = a.epoch;
  fr = null;
  O.xyClear = true;
  for (const id of ['#o-f', '#o-T', '#o-ph', '#o-r1', '#o-r2', '#o-p1', '#o-p2', '#mf', '#mr']) txt(id, '—');
}
function loop(now: number): void {
  if (epoch !== a.epoch) newInput();
  const fresh = a.pull(now);
  inTick(fresh);
  acquire(fresh);
  if (O.view === 'yt') drawWave(now);
  else drawXy(fresh);
  if (fresh && ++frame % 6 === 0) measure();
  requestAnimationFrame(loop);
}
labels();
xyLabels();
storeToggle($('#ch1'));
storeToggle($('#ch2'));
requestAnimationFrame(loop);

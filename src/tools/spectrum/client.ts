/**
 * スペクトラムアナライザの入口: 入力（マイク・ファイル・テスト信号）→ FFT → スペクトラム・スペクトログラム・測定。
 * 毎フレーム直近 N 点を変換する。スペクトログラムは 600 列 × 240 行の dB を輪にして持ち、右端に今を足していく
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmtR, minus, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { initInput } from '../audio/input';
import {
  type Axis,
  type AxisFn,
  axisFn,
  type BinMap,
  binMap,
  dbStep,
  fLab,
  fTicks,
  niceStep,
  noteOf,
  peak,
  valAt,
} from './axis';
import { spectra, toDb, type Win, winData, winOf } from './fft';
import { AVG, type Avg, type Key, PARAMS } from './params';

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
const dbT = (v: number, d = 1) => (v < -150 ? '−∞' : minus(v.toFixed(d)));

/* 表示窓: 400 × 240。スペクトラムは 801 点、スペクトログラムは 600 列 × 240 行 */
const W = 400,
  H = 240,
  NP = 801,
  SGW = 600,
  SGH = 240;

/* ---------- 状態 ---------- */
const S = {
  run: true,
  N: 4096,
  win: 'hann' as Win,
  avg: 'lo' as Avg,
  ax: 'log' as Axis,
  fl: 20,
  fh: 20000,
  ym: 'db' as 'db' | 'lin',
  top: 0,
  bot: -120,
  ch1: true,
  ch2: true,
  hold: false,
  sg: 'mix' as '1' | '2' | 'mix',
  view: 'sp' as 'sp' | 'sg',
  span: 10,
};
/** 直近の変換（平均化の前）、平均化したパワー、PEAK HOLD */
let raw: [Float32Array, Float32Array] | null = null,
  pw: [Float32Array, Float32Array] | null = null,
  hold: [Float32Array, Float32Array] | null = null;
let ax: AxisFn = axisFn(S.ax, S.fl, S.fh, a.fs, S.N),
  map: BinMap = binMap(NP, ax, a.fs, S.N),
  sgMap: BinMap = binMap(SGH, ax, a.fs, S.N),
  sgKey = '';
let curX: number | null = null,
  sgCur: [number, number] | null = null;

/* ---------- 入力 ---------- */
/* 生成時の 1 回目（k なし）は初期値のままなので何もしない。最高と最低の強度は 10 dB 以上離す */
const g = new ParamGroup<Key>(PARAMS, (v, k) => {
  if (!k) return;
  if (k === 'top' && v.bot > v.top - 10) g.set('bot', v.top - 10, { silent: true });
  if (k === 'bot' && v.top < v.bot + 10) g.set('top', v.bot + 10, { silent: true });
  if (v.n !== S.N) reset();
  Object.assign(S, { N: v.n, fl: v.fl, fh: v.fh, top: g.get('top'), bot: g.get('bot') });
  axes();
});
new Choice<Win>($('#p-win'), (v) => {
  S.win = v;
  reset();
  axes();
});
new Choice<Avg>($('#p-avg'), (v) => {
  S.avg = v;
});
new Choice<Axis>($('#p-ax'), (v) => {
  S.ax = v;
  axes();
});
new Choice<'db' | 'lin'>($('#p-ym'), (v) => {
  S.ym = v;
  axes();
});
new Choice<string>($('#p-span'), (v) => {
  S.span = Number(v);
  sgClear();
  axes();
});
const SG_C = { 1: 'CH1', 2: 'CH2', mix: 'CH1 と CH2 の平均' } as const;
new Choice<'1' | '2' | 'mix'>($('#p-sgc'), (v) => {
  S.sg = v;
  txt('#sg-c', SG_C[v]);
});
/* スペクトラムとスペクトログラムの切り替え（同じ枠に、選んだほうだけを出す）。スペクトログラムは隠している間も記録する */
new Choice<'sp' | 'sg'>($('#p-view'), (v) => {
  S.view = v;
  $('#v-sp').hidden = v !== 'sp';
  $('#v-sg').hidden = v !== 'sg';
  $('.a-sp').classList.toggle('sg', v === 'sg');
  txt('#hd-sp', v === 'sg' ? 'スペクトログラム' : 'スペクトラム');
  sgDirty = true;
});
function setRun(on: boolean): void {
  S.run = on;
  $('#runS').setAttribute('aria-pressed', String(on));
  $('#runSLed').classList.toggle('on', on);
  txt('#runST', on ? 'RUN' : 'STOP');
}
$('#runS').addEventListener('click', () => setRun(!S.run));
for (const k of ['ch1', 'ch2', 'hold'] as const)
  $(`#${k}`).addEventListener('click', (e) => {
    S[k] = !S[k];
    if (k === 'hold') hold = null;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(S[k]));
  });
function reset(): void {
  pw = null;
  hold = null;
}

/* ---------- 変換 ---------- */
function compute(): void {
  const h = S.N / 2 + 1;
  if (!raw || raw[0].length !== h) raw = [new Float32Array(h), new Float32Array(h)];
  spectra(a.L, a.R, S.N, S.win, raw[0], raw[1]);
  const k = AVG[S.avg];
  if (!pw || pw[0].length !== h) pw = [Float32Array.from(raw[0]), Float32Array.from(raw[1])];
  else
    for (let c = 0; c < 2; c++) {
      const P = pw[c],
        r = raw[c];
      for (let i = 0; i < h; i++) P[i] = k * P[i] + (1 - k) * r[i];
    }
  if (S.hold) {
    if (!hold || hold[0].length !== h) hold = [Float32Array.from(pw[0]), Float32Array.from(pw[1])];
    else
      for (let c = 0; c < 2; c++) {
        const H = hold[c],
          P = pw[c];
        for (let i = 0; i < h; i++) if (P[i] > H[i]) H[i] = P[i];
      }
  }
}

/* ---------- 軸と目盛り ---------- */
/** パワー → 表示窓の y */
function yOf(p: number): number {
  if (S.ym === 'lin') return (1 - Math.sqrt(p) / 10 ** (S.top / 20)) * H;
  return ((S.top - toDb(p)) / (S.top - S.bot)) * H;
}
/** 軸・目盛り・写像を作り直す（設定か標本化周波数が変わったとき） */
function axes(): void {
  ax = axisFn(S.ax, S.fl, S.fh, a.fs, S.N);
  map = binMap(NP, ax, a.fs, S.N);
  const key = `${S.ax}|${ax.lo}|${ax.hi}|${S.N}|${a.fs}`;
  if (key !== sgKey) {
    sgKey = key;
    sgMap = binMap(SGH, ax, a.fs, S.N);
    sgClear();
  }
  sgDirty = true;
  const ft = fTicks(S.ax, ax);
  /* スペクトラム: 縦の線は周波数の目盛り、横の線は強度。重なる数値は間引く */
  let s = '',
    last = -99;
  for (const f of ft) {
    const x = ax.fwd(f) * W;
    s += `<path class="gl" d="M${x.toFixed(1)} 0V${H}"/>`;
    if (x - last >= 30) {
      s += `<text x="${x.toFixed(1)}" y="${H + 17}" text-anchor="middle">${fLab(f)}</text>`;
      last = x;
    }
  }
  if (S.ym === 'db') {
    const st = dbStep(S.top - S.bot);
    for (let v = Math.ceil(S.bot / st) * st; v <= S.top; v += st) {
      const y = ((S.top - v) / (S.top - S.bot)) * H;
      s += `<path class="gl" d="M0 ${y.toFixed(1)}H${W}"/><text x="-10" y="${(y + 4).toFixed(1)}" text-anchor="end">${minus(String(v))}</text>`;
    }
    txt('#s-y', `${st} dB`);
  } else {
    const A = 10 ** (S.top / 20);
    for (let i = 0; i <= 5; i++) {
      const y = H - (i * H) / 5;
      s += `<path class="gl" d="M0 ${y}H${W}"/><text x="-10" y="${y + 4}" text-anchor="end">${Number(((A * i) / 5).toPrecision(2))}</text>`;
    }
    txt('#s-y', String(Number((A / 5).toPrecision(2))));
  }
  html('#sp-grid', `${s}<rect class="gb" x="0" y="0" width="${W}" height="${H}"/>`);
  txt('#s-x', `${{ lin: 'LIN', log: 'LOG', mel: 'MEL' }[S.ax]} ${fLab(ax.lo)}–${fLab(ax.hi)} Hz`);
  txt('#s-n', `N ${S.N} · ${winOf(S.win)[2]}`);
  /* スペクトログラム: 縦が周波数、横が時間（右端が今）。像に重なる線は引かず、縁に目盛りだけ */
  let t = '';
  last = 999;
  for (const f of ft) {
    const y = H - ax.fwd(f) * H;
    t += `<path class="gb" d="M0 ${y.toFixed(1)}h-5M${W} ${y.toFixed(1)}h5"/>`;
    if (last - y >= 16) {
      t += `<text x="-10" y="${(y + 4).toFixed(1)}" text-anchor="end">${fLab(f)}</text>`;
      last = y;
    }
  }
  const ts = niceStep(S.span / 5);
  for (let x = 0; x <= S.span + 1e-9; x += ts) {
    const px = W - (x / S.span) * W;
    t += `<path class="gb" d="M${px.toFixed(1)} ${H}v5"/><text x="${px.toFixed(1)}" y="${H + 17}" text-anchor="middle">${x ? `−${Number(x.toPrecision(3))}` : '0 s'}</text>`;
  }
  html('#sg-grid', `${t}<rect class="gb" x="0" y="0" width="${W}" height="${H}"/>`);
  txt('#sg-h', `${Number((S.span / 5).toPrecision(3))} s`);
  txt('#cb-lo', minus(String(S.bot)));
  txt('#cb-hi', minus(String(S.top)));
  measure();
}

/* ---------- スペクトラム ---------- */
function path(P: Float32Array): string {
  let d = '';
  for (let j = 0; j < NP; j++) {
    const y = Math.max(-2, Math.min(H + 4, yOf(valAt(P, map, j))));
    d += `${j ? 'L' : 'M'}${((j * W) / (NP - 1)).toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}
function drawSpec(): void {
  $('#sp-t1').setAttribute('d', pw && S.ch1 ? path(pw[0]) : '');
  $('#sp-t2').setAttribute('d', pw && S.ch2 ? path(pw[1]) : '');
  $('#sp-h1').setAttribute('d', hold && S.hold && S.ch1 ? path(hold[0]) : '');
  $('#sp-h2').setAttribute('d', hold && S.hold && S.ch2 ? path(hold[1]) : '');
}

/* ---------- スペクトログラム ---------- */
const cv = $<HTMLCanvasElement>('#sg-cv'),
  ctx = cv.getContext('2d'),
  img = ctx?.createImageData(SGW, SGH),
  sgData = new Float32Array(SGW * SGH).fill(Number.NEGATIVE_INFINITY);
let head = 0,
  acc = 0,
  sgDirty = true;
/** 色: 強度の弱い順に並べた 6 色をつないだ 256 段（CSS の --sg0〜--sg5） */
const LUT = new Uint8Array(256 * 3);
{
  const cs = getComputedStyle($('.a-sg')),
    st = [0, 1, 2, 3, 4, 5].map((i) => {
      const h = cs.getPropertyValue(`--sg${i}`).trim().replace('#', '');
      return [0, 2, 4].map((o) => Number.parseInt(h.slice(o, o + 2), 16));
    });
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * 5,
      j = Math.min(4, Math.floor(t)),
      u = t - j;
    for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(st[j][c] + (st[j + 1][c] - st[j][c]) * u);
  }
}
function sgClear(): void {
  sgData.fill(Number.NEGATIVE_INFINITY);
  sgDirty = true;
}
/** 今の変換を n 列足す */
function sgPush(n: number): void {
  if (!raw) return;
  const [rL, rR] = raw,
    col = new Float32Array(SGH);
  for (let j = 0; j < SGH; j++) {
    const v =
      S.sg === 'mix' ? (valAt(rL, sgMap, j) + valAt(rR, sgMap, j)) / 2 : valAt(S.sg === '2' ? rR : rL, sgMap, j);
    col[SGH - 1 - j] = toDb(v);
  }
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < SGH; r++) sgData[r * SGW + head] = col[r];
    head = (head + 1) % SGW;
  }
  sgDirty = true;
}
function sgRender(): void {
  if (!sgDirty || !ctx || !img) return;
  sgDirty = false;
  const d = img.data,
    lo = S.bot,
    rg = S.top - S.bot,
    lin = S.ym === 'lin',
    A = 10 ** (S.top / 20);
  for (let r = 0; r < SGH; r++)
    for (let c = 0; c < SGW; c++) {
      const v = sgData[r * SGW + ((head + c) % SGW)];
      let t = lin ? 10 ** (v / 20) / A : (v - lo) / rg;
      t = t > 1 ? 1 : t > 0 ? t : 0;
      const q = Math.round(t * 255) * 3,
        o = (r * SGW + c) * 4;
      d[o] = LUT[q];
      d[o + 1] = LUT[q + 1];
      d[o + 2] = LUT[q + 2];
      d[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

/* ---------- カーソルの読み値 ---------- */
const svgPt = (svg: SVGSVGElement, e: PointerEvent): [number, number] | null => {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [p.x, p.y];
};
const inPlot = (p: [number, number] | null) => !!p && p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H;
{
  const sp = $<SVGSVGElement>('#sp-svg'),
    sg = $<SVGSVGElement>('#sg-svg');
  sp.addEventListener('pointermove', (e) => {
    const p = svgPt(sp, e);
    curX = p && inPlot(p) ? p[0] : null;
  });
  sp.addEventListener('pointerleave', () => {
    curX = null;
  });
  sg.addEventListener('pointermove', (e) => {
    const p = svgPt(sg, e);
    sgCur = p && inPlot(p) ? p : null;
  });
  sg.addEventListener('pointerleave', () => {
    sgCur = null;
  });
}
function cursors(): void {
  if (curX === null || !pw) {
    $('#sp-cur').setAttribute('d', '');
    txt('#sp-rd', '');
  } else {
    const j = Math.round((curX / W) * (NP - 1)),
      f = ax.inv(j / (NP - 1)),
      v = (P: Float32Array) => `${dbT(toDb(valAt(P, map, j)))} dBFS`;
    $('#sp-cur').setAttribute('d', `M${curX.toFixed(1)} 0V${H}`);
    txt('#sp-rd', `f ${fmtR(f, 'Hz', 4)}   CH1 ${v(pw[0])}   CH2 ${v(pw[1])}`);
  }
  if (!sgCur) {
    $('#sg-cur').setAttribute('d', '');
    txt('#sg-rd', '');
    return;
  }
  const [x, y] = sgCur,
    c = Math.min(SGW - 1, Math.floor((x / W) * SGW)),
    r = Math.min(SGH - 1, Math.floor((y / H) * SGH)),
    v = sgData[r * SGW + ((head + c) % SGW)];
  $('#sg-cur').setAttribute('d', `M${x.toFixed(1)} 0V${H}M0 ${y.toFixed(1)}H${W}`);
  txt(
    '#sg-rd',
    `t −${(((W - x) / W) * S.span).toFixed(2)} s   f ${fmtR(ax.inv(1 - y / H), 'Hz', 4)}   ${Number.isFinite(v) ? `${dbT(v)} dBFS` : '—'}`,
  );
}

/* ---------- 測定 ---------- */
function measure(): void {
  const fs = a.fs,
    N = S.N,
    df = fs / N,
    w = winData(S.win, N),
    u1 = S.ch1 || !S.ch2,
    u2 = S.ch2 || !S.ch1;
  html('#o-df', ro(df, 'Hz', 4));
  html('#o-fl', ro(N / fs, 's', 4));
  html('#o-fs', ro(fs, 'Hz', 4));
  html('#o-enbw', `${w.enbw.toFixed(2)}<span class="u">bin</span>`);
  txt('#o-enbwf', fmtR(w.enbw * df, 'Hz', 3));
  html('#o-cg', `${minus((20 * Math.log10(w.cg)).toFixed(2))}<span class="u">dB</span>`);
  txt('#o-aux', u1 && u2 ? 'CH1 と CH2 の大きいほう' : u1 ? 'CH1' : 'CH2');
  const P = pw,
    pk = P
      ? peak(
          (k) => Math.max(u1 ? P[0][k] : 0, u2 ? P[1][k] : 0),
          Math.ceil(ax.lo / df),
          Math.min(N / 2 - 1, Math.floor(ax.hi / df)),
          df,
        )
      : null,
    nt = pk ? noteOf(pk.f) : null,
    ntT = nt ? `${nt.name} ${nt.cent >= 0 ? '+' : '−'}${Math.abs(nt.cent)}` : '';
  html('#o-pf', pk ? ro(pk.f, 'Hz', 5) : '—');
  txt('#o-pn', nt ? `${ntT} セント` : '');
  html('#o-pl', pk ? `${dbT(pk.db, 2)}<span class="u">dBFS</span>` : '—');
  txt('#mf', pk ? fmtR(pk.f, 'Hz', 4) : '—');
  txt('#ml', pk ? `${dbT(pk.db)} dBFS` : '—');
  txt('#mn', nt ? `${ntT}¢` : '—');
}

/* ---------- 毎フレーム ---------- */
let prev = performance.now(),
  frame = 0,
  lastFs = a.fs;
let epoch = a.epoch;
function loop(now: number): void {
  const dt = Math.min(200, now - prev);
  prev = now;
  /* 入力元が変わったら、前の入力のスペクトラムとピークを消す（スペクトログラムの履歴は残す） */
  if (epoch !== a.epoch) {
    epoch = a.epoch;
    raw = null;
    reset();
    measure();
  }
  const fresh = a.pull(now);
  inTick(fresh);
  if (a.fs !== lastFs) {
    lastFs = a.fs;
    axes();
  }
  if (S.run && fresh) compute();
  if (S.run && a.run) {
    acc += (dt / 1000) * (SGW / S.span);
    const n = Math.min(30, Math.floor(acc));
    acc -= n;
    if (n > 0) sgPush(n);
  }
  if (S.view === 'sg') sgRender();
  else drawSpec();
  cursors();
  if (fresh && S.run && ++frame % 6 === 0) measure();
  requestAnimationFrame(loop);
}
axes();
for (const k of ['ch1', 'ch2', 'hold']) storeToggle($(`#${k}`));
requestAnimationFrame(loop);

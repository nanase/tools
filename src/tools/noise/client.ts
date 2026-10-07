/**
 * ノイズジェネレータの入口: 設定 → 生成の条件（gen.ts の design）→ 表示用の生成器、または鳴らしている AudioWorklet が
 * 送り返す音 → 輪のバッファ → 波形・分布・平均したスペクトラム・スペクトログラム・測定。
 * 表示は RUN の間ずっと動かし（音を止めていても、同じ生成器で作る）、STOP で止める。
 * LFSR は、音のクロックとは別に、レジスタの図をゆっくり動かす
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmt, fmtR, minus, plain, ro } from '../../lib/format';
import { fx, RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { DV } from '../../lib/scope';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { VOL } from '../fm-synth/params';
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
  valAt,
} from '../spectrum/axis';
import { bands, dbfs, FIT_HI, FIT_LO, type Fit, fitSlope, hist, psdOffset, rawPower, stats, Welch } from './analysis';
import { AFS, NoiseAudio } from './audio';
import { bitsSvg, cellW, frameSvg, HIST, histPath } from './diagram';
import { type Cfg, design, Gen, idealDb, type Kind, type PinkM, RMS, rmsOf, type Spec, slopeOf } from './gen';
import { expList, expOfBit, type Form, full, type LfsrCfg, PRESETS, stepper, tableExps } from './lfsr';
import { cur, type Key, PARAMS } from './params';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};
const signed = (v: number, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
const dbT = (v: number, d = 2) => (Number.isFinite(v) ? minus(v.toFixed(d)) : '−∞');

/* 表示窓: 波形と分布は 400 × 160（4 div）、スペクトラムは 400 × 240。スペクトログラムは 600 列 × 240 行 */
const W = 10 * DV,
  WH = 4 * DV,
  H = 240,
  NP = 801,
  SGW = 600,
  SGH = 240;
/** 輪のバッファ（約 5.5 s）。測定と分布はこの長さで見る */
const NB = 1 << 18;
const ring = new Float32Array(NB);

/* ---------- 状態 ---------- */
const S = {
  kind: 'pink' as Kind,
  pm: 'kellett' as PinkM,
  den: 2000,
  lf: { n: 15, exps: tableExps(15), form: 'fib', xnor: false, init: 1 } as LfsrCfg,
  clk: 8000,
  tapm: 'table' as 'table' | 'custom',
  run: true,
  wv: 'yt' as 'yt' | 'hist',
  sv: 'sp' as 'sp' | 'sg',
  hd: 1e-3,
  rng: 0.5,
  hy: 'lin' as 'lin' | 'log',
  ax: 'log' as Axis,
  N: 8192,
  avg: 32,
  top: -30,
  bot: -130,
  span: 10,
  spd: 4,
};
/** 表示の標本化周波数（鳴らしている AudioContext に合わせる） */
let fs = AFS;
/** 書いた標本の通し番号、今の条件で書き始めた番号、スペクトラムに使った番号 */
let wpos = 0,
  since = 0,
  rpos = 0;
let spec: Spec;
let gen: Gen;
/** 条件の版（AudioWorklet が送り返す音に付く） */
let ver = 0;
/** 条件を作り直す（次のフレームで） */
let dirty = true;
const audio = new NoiseAudio();
const seed = () => Math.floor(Math.random() * 2 ** 32);

/* ---------- 入力 ---------- */
const g = new ParamGroup<Key | 'vol'>([VOL, ...PARAMS], (v, k) => {
  if (!k) {
    Object.assign(S, { den: v.den, clk: v.clk, hd: v.hd, N: v.fft, top: v.top, bot: v.bot });
    Object.assign(S.lf, { n: v.n, init: v.init });
    audio.vol(v.vol);
    return;
  }
  switch (k) {
    case 'vol':
      audio.vol(v.vol);
      break;
    case 'den':
      S.den = v.den;
      dirty = true;
      break;
    case 'n':
      setN(v.n);
      break;
    case 'init':
      S.lf.init = v.init;
      lfChanged();
      break;
    case 'clk':
      S.clk = v.clk;
      lfChanged();
      break;
    case 'hd':
      S.hd = v.hd;
      break;
    case 'fft':
      S.N = v.fft;
      resetAnalysis();
      axes();
      break;
    case 'top':
    case 'bot':
      /* 最高と最低の強度は 10 dB 以上離す */
      if (k === 'top' && v.bot > v.top - 10) g.set('bot', v.top - 10, { silent: true });
      if (k === 'bot' && v.top < v.bot + 10) g.set('top', v.bot + 10, { silent: true });
      S.top = g.get('top');
      S.bot = g.get('bot');
      axes();
      break;
  }
});
const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
/** 選択を変えて保存する（押したときと同じく、開き直したときに戻す） */
const setChoice = <V extends string>(c: Choice<V>, v: V) => {
  c.set(v);
  store(`c:${c.root.id}`, v);
};
const kindC = choice<Kind>('kind', (v) => {
  S.kind = v;
  rows();
  dirty = true;
});
const pmC = choice<PinkM>('pm', (v) => {
  S.pm = v;
  dirty = true;
});
const formC = choice<Form>('form', (v) => {
  S.lf.form = v;
  lfChanged();
});
/* 実在の音源は保存しない（今の設定に合うものを押した状態にする） */
$('#p-pre').setAttribute('data-nosave', '');
const preC = choice<string>('pre', (v) => applyPreset(v));
const tapmC = choice<'table' | 'custom'>('tapm', (v) => {
  S.tapm = v;
  if (v === 'table') S.lf.exps = tableExps(S.lf.n);
  else store('lf:exps', S.lf.exps);
  lfChanged();
});
const fbC = choice<'xor' | 'xnor'>('fb', (v) => {
  S.lf.xnor = v === 'xnor';
  lfChanged();
});
const spdC = choice<string>('spd', (v) => {
  S.spd = Number(v);
});
const wvC = choice<'yt' | 'hist'>('wv', (v) => {
  S.wv = v;
  views();
});
const svC = choice<'sp' | 'sg'>('sv', (v) => {
  S.sv = v;
  views();
});
const rngC = choice<string>('rng', (v) => {
  S.rng = Number(v);
  waveAxes();
  if (S.wv === 'hist') measure();
});
const hyC = choice<'lin' | 'log'>('hy', (v) => {
  S.hy = v;
});
const axC = choice<Axis>('ax', (v) => {
  S.ax = v;
  axes();
});
const avgC = choice<string>('avg', (v) => {
  S.avg = Number(v);
  welch.len = S.avg;
});
const spanC = choice<string>('span', (v) => {
  S.span = Number(v);
  sgClear();
  axes();
});
Object.assign(S, {
  kind: kindC.value,
  pm: pmC.value,
  tapm: tapmC.value,
  spd: Number(spdC.value),
  wv: wvC.value,
  sv: svC.value,
  rng: Number(rngC.value),
  hy: hyC.value,
  ax: axC.value,
  avg: Number(avgC.value),
  span: Number(spanC.value),
});
Object.assign(S.lf, { form: formC.value, xnor: fbC.value === 'xnor' });
{
  const ex = stored('lf:exps');
  S.lf.exps = S.tapm === 'custom' && typeof ex === 'number' ? ex >>> 0 : tableExps(S.lf.n);
}

/** ビット長を変える: 表のタップなら表から、任意なら範囲の外の項を落とす。初期値の範囲も合わせる */
function setN(n: number): void {
  S.lf.n = cur.n = n;
  S.lf.exps = S.tapm === 'table' ? tableExps(n) : (S.lf.exps & full(n) & ~1) >>> 0;
  if (S.tapm === 'custom') store('lf:exps', S.lf.exps);
  g.update('init', { max: full(n) });
  if (S.lf.init > full(n)) {
    g.set('init', full(n), { silent: true });
    g.note('init', `${n} ビットに収まらないため ${full(n)} にしました`);
    S.lf.init = full(n);
  }
  lfChanged();
}

/** LFSR の設定が変わった: 合う音源を押した状態にし、作り直す */
function lfChanged(): void {
  const c = S.lf,
    m = PRESETS.find(
      (p) =>
        p.c.n === c.n &&
        p.c.exps === c.exps &&
        p.c.form === c.form &&
        p.c.xnor === c.xnor &&
        p.c.init === c.init &&
        Math.abs(p.clk - S.clk) < 1e-6 * p.clk,
    );
  preC.set(m?.v ?? '');
  dirty = true;
}

function applyPreset(v: string): void {
  const p = PRESETS.find((x) => x.v === v);
  if (!p) return;
  S.lf = { ...p.c };
  S.clk = p.clk;
  S.tapm = 'custom';
  cur.n = p.c.n;
  setChoice(tapmC, 'custom');
  setChoice(formC, p.c.form);
  setChoice(fbC, p.c.xnor ? 'xnor' : 'xor');
  store('lf:exps', p.c.exps);
  g.update('init', { max: full(p.c.n) });
  g.set('n', p.c.n, { silent: true });
  g.set('init', p.c.init, { silent: true });
  g.set('clk', p.clk, { silent: true });
  lfChanged();
}

/* ---------- 表示の切り替え ---------- */
/** 種類で出す行と枠 */
function rows(): void {
  $('#p-pm').hidden = S.kind !== 'pink';
  $('#p-den').hidden = S.kind !== 'velvet';
  $('.a-lfsr').hidden = S.kind !== 'lfsr';
  for (const el of $$('.m.lf')) el.hidden = S.kind !== 'lfsr';
}
/** 波形と分布、スペクトラムとスペクトログラム（図の下の設定も入れ替える） */
function views(): void {
  const hs = S.wv === 'hist',
    sg = S.sv === 'sg';
  $('#v-yt').hidden = hs;
  $('#v-hist').hidden = !hs;
  $('#p-hd').hidden = hs;
  $('#p-hy').hidden = !hs;
  txt('#hd-wave', hs ? '振幅の分布' : '波形');
  $('#v-sp').hidden = sg;
  $('#v-sg').hidden = !sg;
  $('#p-avg').hidden = sg;
  $('#p-span').hidden = !sg;
  txt('#hd-sp', sg ? 'スペクトログラム' : 'スペクトラム');
  curW = curH = curS = null;
  curG = null;
  sgDirty = true;
  if (hs) measure();
}
function setRun(on: boolean): void {
  S.run = on;
  $('#runBtn').setAttribute('aria-pressed', String(on));
  $('#runLed').classList.toggle('on', on);
  txt('#runT', on ? 'RUN' : 'STOP');
}
$('#runBtn').addEventListener('click', () => setRun(!S.run));

/* ---------- 音 ---------- */
const playBtn = $('#playBtn');
function syncSnd(err = ''): void {
  playBtn.setAttribute('aria-pressed', String(audio.playing));
  $('#sndLed').classList.toggle('on', audio.playing);
  txt('#playT', audio.playing ? '停止' : '再生');
  txt('#snd-msg', err);
}
playBtn.addEventListener('click', async () => {
  const ok = await audio.setPlay(!audio.playing);
  /* AudioContext が 48 kHz にならなかった環境では、表示もその標本化周波数で作る */
  const afs = audio.fs;
  if (ok && afs && afs !== fs) {
    fs = afs;
    resetAnalysis();
    sgClear();
    axes();
    rebuild();
  }
  syncSnd(ok ? '' : '音を出せませんでした');
});
/** 鳴らしている間は、AudioWorklet が送り返す音を表示に使う（古い条件の音は捨てる） */
audio.onData = (b, v) => {
  if (S.run && v === ver) write(b);
};
function write(b: Float32Array): void {
  for (let i = 0; i < b.length; i++) ring[(wpos + i) & (NB - 1)] = b[i];
  wpos += b.length;
}

/* ---------- 生成 ---------- */
function rebuild(): void {
  dirty = false;
  const c: Cfg = { kind: S.kind, pm: S.pm, den: S.den, lfsr: { ...S.lf }, clk: S.clk };
  spec = design(c, fs);
  gen = new Gen(spec, seed());
  ver++;
  const afs = audio.fs;
  audio.send(!afs || afs === fs ? spec : design(c, afs), ver);
  since = rpos = wpos;
  welch.reset();
  fit = null;
  /* 止めていなければ、表示用の生成器で先に 0.5 s 作って、スペクトラムと測定をすぐに出す */
  if (S.run && !audio.playing) {
    produce(fs >> 1);
    analyze();
  }
  lfReset();
  info();
  refPath();
  waveAxes();
  measure();
}
/** 表示用の生成器で、経った時間の分を作る（鳴らしている間は AudioWorklet の音を使う） */
function generate(dt: number): void {
  if (!audio.playing) produce(Math.min(Math.round((dt / 1000) * fs), fs >> 2));
}
function produce(n0: number): void {
  let cnt = n0;
  while (cnt > 0) {
    const o = wpos & (NB - 1),
      n = Math.min(cnt, NB - o);
    gen.fill(ring, o, n);
    wpos += n;
    cnt -= n;
  }
}

/* ---------- 解析 ---------- */
let welch = new Welch(S.N, S.avg);
let fit: Fit | null = null;
let hgram: Float64Array | null = null;
const HB = 80;
let off = psdOffset(S.N, fs);
function resetAnalysis(): void {
  welch = new Welch(S.N, S.avg);
  rpos = wpos;
  fit = null;
  off = psdOffset(S.N, fs);
}
/** 半分ずつ重ねた区間を平均に足す（今の条件で書いた標本だけ） */
function analyze(): void {
  const hop = S.N / 2;
  if (rpos < since) rpos = since;
  if (wpos - rpos > NB / 2) rpos = wpos - hop;
  let n = 0;
  while (rpos + hop <= wpos && n++ < 16) {
    rpos += hop;
    if (rpos - since >= S.N) welch.add(ring, rpos);
  }
  if (welch.count) fit = fitSlope(welch.P, bands(fs, S.N));
}

/* ---------- 波形 ---------- */
const vds = (v: number) => minus(String(Number(v.toPrecision(3))));
const wy = (v: number) => WH / 2 - (v / S.rng) * (WH / 2);
function waveAxes(): void {
  const hd = S.hd,
    vd = S.rng / 2;
  let a = '';
  for (let i = 0; i <= 10; i += 2)
    a += `<text x="${i * DV}" y="${WH + 17}" text-anchor="middle">${i ? fmt(i * hd, 's', 3) : '0'}</text>`;
  for (let j = 0; j <= 4; j++) {
    const v = (2 - j) * vd;
    a += `<text x="-10" y="${j * DV + 4}" text-anchor="end">${v === 0 ? '0' : (v > 0 ? '+' : '') + vds(v)}</text>`;
  }
  a += `<path class="mk1" d="M-8 ${WH / 2 - 5}L-1 ${WH / 2}L-8 ${WH / 2 + 5}Z"/>`;
  html('#w-axes', a);
  txt('#w-vd', vds(vd));
  txt('#w-hd', fmt(hd, 's', 3));
  txt('#w-src', `fs ${fmt(fs, 'Hz', 4)}`);
  /* 分布: 横は振幅、縦は確率密度 */
  let h = '';
  for (let i = 0; i <= 10; i++) h += `<path class="gl" d="M${i * DV} 0V${WH}"/>`;
  for (let j = 0; j <= 4; j++) h += `<path class="gl" d="M0 ${j * DV}H${W}"/>`;
  for (let i = 0; i <= 10; i += 2) {
    const v = ((i - 5) / 5) * S.rng;
    h += `<text x="${i * DV}" y="${WH + 17}" text-anchor="middle">${v === 0 ? '0' : (v > 0 ? '+' : '') + vds(v)}</text>`;
  }
  html('#h-grid', `${h}<rect class="gb" x="0" y="0" width="${W}" height="${WH}"/>`);
}
function drawWave(): void {
  const n = Math.min(NB - 1, Math.round(10 * S.hd * fs)),
    k = W / n,
    y = (v: number) => Math.max(-400, Math.min(WH + 400, wy(v))).toFixed(1),
    m = NB - 1,
    e = wpos - 1;
  let d = '';
  if (wpos > n) {
    if (n <= 1600)
      for (let i = 0; i <= n; i++) d += `${i ? 'L' : 'M'}${(i * k).toFixed(2)} ${y(ring[(e - n + i) & m])}`;
    else
      for (let j = 0; j < 2 * W; j++) {
        const i0 = Math.floor(j / (2 * k)),
          i1 = Math.min(n, Math.floor((j + 1) / (2 * k)));
        let lo = Infinity,
          hi = -Infinity;
        for (let i = i0; i <= i1; i++) {
          const v = ring[(e - n + i) & m];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        d += `${d ? 'L' : 'M'}${j / 2} ${y(hi)}L${j / 2} ${y(lo)}`;
      }
  }
  $('#w-t1').setAttribute('d', d);
  if (curW === null) {
    $('#w-cur').setAttribute('d', '');
    txt('#w-rd', '');
  } else {
    const i = Math.round((curW / W) * n),
      v = ring[(e - n + i) & m];
    $('#w-cur').setAttribute('d', `M${curW.toFixed(1)} 0V${WH}`);
    txt('#w-rd', `t ${i ? fmtR(i / fs, 's', 4) : '0'}   CH1 ${signed(v, 4)}`);
  }
}

/* ---------- 分布 ---------- */
/** 分布の参照（理論の確率密度）。離散の分布（ベルベット・LFSR）は null */
function refPdf(x: number): number | null {
  const k = S.kind;
  if (k === 'velvet' || k === 'lfsr') return null;
  if (k === 'wu') {
    const a = RMS * Math.sqrt(3);
    return Math.abs(x) <= a ? 1 / (2 * a) : 0;
  }
  return Math.exp(-(x * x) / (2 * RMS * RMS)) / (RMS * Math.sqrt(2 * Math.PI));
}
function drawHist(): void {
  const h = hgram,
    bw = W / HB,
    lw = 2 * S.rng;
  let mx = 0;
  if (h) for (const v of h) mx = Math.max(mx, v);
  const ref: number[] = [];
  for (let j = 0; j <= 200; j++) ref.push(refPdf(((j - 100) / 100) * S.rng) ?? Number.NaN);
  for (const v of ref) if (v > mx) mx = v;
  const top = mx * 1.1 || 1,
    lg = S.hy === 'log',
    yOf = (p: number) => {
      if (lg) {
        const lo = Math.log10(top) - 5;
        return p > 0 ? Math.min(WH + 2, WH * (1 - (Math.log10(p) - lo) / 5)) : WH + 2;
      }
      return WH * (1 - p / top);
    };
  let d = '';
  if (h)
    for (let i = 0; i < HB; i++) {
      const y = yOf(h[i]).toFixed(1);
      d += `${i ? 'L' : 'M'}${(i * bw).toFixed(1)} ${y}H${((i + 1) * bw).toFixed(1)}`;
    }
  $('#h-t1').setAttribute('d', d ? `${d}V${WH}H0Z` : '');
  let r = '';
  ref.forEach((p, j) => {
    if (Number.isNaN(p)) return;
    r += `${r ? 'L' : 'M'}${(j * 2).toFixed(1)} ${yOf(p).toFixed(1)}`;
  });
  $('#h-ref-p').setAttribute('d', r);
  txt('#h-n', `${HB} 区間 · ${lg ? 'LOG' : 'LIN'}`);
  const k = S.kind;
  txt('#h-ref', k === 'velvet' || k === 'lfsr' ? '—' : k === 'wu' ? '一様分布' : `正規分布 σ ${plain(RMS, 3, true)}`);
  if (curH === null || !h) {
    $('#h-cur').setAttribute('d', '');
    txt('#h-rd', '');
  } else {
    const i = Math.min(HB - 1, Math.floor((curH / W) * HB)),
      x = ((i + 0.5) / HB) * lw - S.rng;
    $('#h-cur').setAttribute('d', `M${curH.toFixed(1)} 0V${WH}`);
    txt('#h-rd', `x ${signed(x, 3)}   p ${plain(h[i], 4, true)}`);
  }
}

/* ---------- スペクトラム ---------- */
let ax: AxisFn = axisFn('log', 20, 20000, fs, S.N),
  map: BinMap = binMap(NP, ax, fs, S.N),
  sgMap: BinMap = binMap(SGH, ax, fs, S.N),
  sgKey = '';
/**
 * 表示の点 j の値: 範囲の bin の平均か、隣の bin の直線補間。LFSR は線スペクトルなので、範囲の最大
 * （線の高さをそのまま読む）
 */
function meanAt(P: ArrayLike<number>, m: BinMap, j: number): number {
  if (S.kind === 'lfsr') return valAt(P, m, j);
  if (m.k1[j] >= m.k0[j]) {
    let s = 0;
    for (let k = m.k0[j]; k <= m.k1[j]; k++) s += P[k];
    return s / (m.k1[j] - m.k0[j] + 1);
  }
  const x = m.fk[j],
    i = Math.floor(x),
    t = x - i;
  return P[i] * (1 - t) + P[i + 1] * t;
}
const yOf = (dB: number) => {
  const y = ((S.top - dB) / (S.top - S.bot)) * H;
  return Number.isFinite(y) ? Math.max(-4, Math.min(H + 4, y)) : H + 4;
};
function axes(): void {
  ax = S.ax === 'log' ? axisFn('log', 20, 20000, fs, S.N) : axisFn('lin', 0, fs / 2, fs, S.N);
  map = binMap(NP, ax, fs, S.N);
  off = psdOffset(S.N, fs);
  const key = `${S.ax}|${ax.lo}|${ax.hi}|${S.N}|${fs}`;
  if (key !== sgKey) {
    sgKey = key;
    sgMap = binMap(SGH, ax, fs, S.N);
    sgClear();
  }
  sgDirty = true;
  const ft = fTicks(S.ax, ax);
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
  const stp = dbStep(S.top - S.bot);
  for (let v = Math.ceil(S.bot / stp) * stp; v <= S.top; v += stp) {
    const y = ((S.top - v) / (S.top - S.bot)) * H;
    s += `<path class="gl" d="M0 ${y.toFixed(1)}H${W}"/><text x="-10" y="${(y + 4).toFixed(1)}" text-anchor="end">${minus(String(v))}</text>`;
  }
  html('#sp-grid', `${s}<rect class="gb" x="0" y="0" width="${W}" height="${H}"/>`);
  txt('#s-y', `${stp} dB`);
  txt('#s-x', `${S.ax === 'log' ? 'LOG' : 'LIN'} ${fLab(ax.lo)}–${fLab(ax.hi)} Hz`);
  txt('#s-n', `N ${S.N} · HANN`);
  /* スペクトログラム: 縦が周波数、横が時間（右端が今） */
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
  txt('#sg-n', `N ${S.N} · HANN`);
  txt('#cb-lo', minus(String(S.bot)));
  txt('#cb-hi', minus(String(S.top)));
  refPath();
}
/** 参照線（理想の形） */
/**
 * 参照線の値（dBFS/Hz）。LFSR の繰り返しの線が FFT で分かれるとき（間隔が窓の帯域幅の 2 倍以上）は、
 * 線 1 本のパワー（包絡 × 線の間隔）を帯域幅で割った、線の頭の高さにする
 */
function refDb(f: number): number {
  let v = idealDb(spec, f);
  if (S.kind === 'lfsr' && spec.period) {
    const k = S.clk / spec.period / ((1.5 * fs) / S.N);
    if (k >= 2) v += 10 * Math.log10(k);
  }
  return v;
}
function refPath(): void {
  if (!spec) return;
  let d = '';
  for (let j = 0; j < NP; j++) {
    const f = ax.inv(j / (NP - 1));
    if (!(f > 0)) continue;
    d += `${d ? 'L' : 'M'}${((j * W) / (NP - 1)).toFixed(1)} ${yOf(refDb(f)).toFixed(1)}`;
  }
  $('#sp-ref').setAttribute('d', d);
  const sl = slopeOf(S.kind);
  txt('#s-ref', S.kind === 'gray' ? 'A 特性の逆数' : S.kind === 'lfsr' ? 'sinc² の包絡' : `${signed(sl ?? 0)} dB/oct`);
}
function drawSpec(): void {
  let d = '';
  if (welch.count) {
    const P = welch.P;
    for (let j = 0; j < NP; j++) {
      const v = meanAt(P, map, j);
      d += `${j ? 'L' : 'M'}${((j * W) / (NP - 1)).toFixed(1)} ${yOf(10 * Math.log10(v + 1e-30) + off).toFixed(1)}`;
    }
  }
  $('#sp-t1').setAttribute('d', d);
  txt('#s-fit', fit ? `${signed(fit.slope)} dB/oct` : '—');
  if (curS === null || !welch.count) {
    $('#sp-cur').setAttribute('d', '');
    txt('#sp-rd', '');
  } else {
    const j = Math.round((curS / W) * (NP - 1)),
      f = ax.inv(j / (NP - 1)),
      v = 10 * Math.log10(meanAt(welch.P, map, j) + 1e-30) + off;
    $('#sp-cur').setAttribute('d', `M${curS.toFixed(1)} 0V${H}`);
    txt('#sp-rd', `f ${fmtR(f, 'Hz', 4)}   PSD ${dbT(v)} dBFS/Hz   REF ${f > 0 ? dbT(refDb(f)) : '—'}`);
  }
}

/* ---------- スペクトログラム ---------- */
const cv = $<HTMLCanvasElement>('#sg-cv'),
  ctx = cv.getContext('2d'),
  img = ctx?.createImageData(SGW, SGH),
  sgData = new Float32Array(SGW * SGH).fill(Number.NEGATIVE_INFINITY);
let head = 0,
  sgAcc = 0,
  sgDirty = true;
/** 色: 強度の弱い順に並べた 6 色をつないだ 256 段（CSS の --sg0〜--sg5） */
const LUT = new Uint8Array(256 * 3);
{
  const cs = getComputedStyle($('.a-sg')),
    stops = [0, 1, 2, 3, 4, 5].map((i) => {
      const h = cs.getPropertyValue(`--sg${i}`).trim().replace('#', '');
      return [0, 2, 4].map((o) => Number.parseInt(h.slice(o, o + 2), 16));
    });
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * 5,
      j = Math.min(4, Math.floor(t)),
      u = t - j;
    for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(stops[j][c] + (stops[j + 1][c] - stops[j][c]) * u);
  }
}
function sgClear(): void {
  sgData.fill(Number.NEGATIVE_INFINITY);
  sgDirty = true;
}
let rawP = new Float32Array(S.N / 2 + 1),
  rawSeg = new Float32Array(S.N),
  rawTmp = new Float32Array(S.N / 2 + 1);
/** 直近の N 点の変換を n 列足す */
function sgPush(n: number): void {
  if (wpos < S.N) return;
  if (rawSeg.length !== S.N) {
    rawP = new Float32Array(S.N / 2 + 1);
    rawSeg = new Float32Array(S.N);
    rawTmp = new Float32Array(S.N / 2 + 1);
  }
  rawPower(ring, wpos, S.N, rawP, rawSeg, rawTmp);
  const col = new Float32Array(SGH);
  for (let j = 0; j < SGH; j++) col[SGH - 1 - j] = 10 * Math.log10(meanAt(rawP, sgMap, j) + 1e-30) + off;
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
    rg = S.top - S.bot;
  for (let r = 0; r < SGH; r++)
    for (let c = 0; c < SGW; c++) {
      let t = (sgData[r * SGW + ((head + c) % SGW)] - lo) / rg;
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
function sgCursor(): void {
  if (!curG) {
    $('#sg-cur').setAttribute('d', '');
    txt('#sg-rd', '');
    return;
  }
  const [x, y] = curG,
    c = Math.min(SGW - 1, Math.floor((x / W) * SGW)),
    r = Math.min(SGH - 1, Math.floor((y / H) * SGH)),
    v = sgData[r * SGW + ((head + c) % SGW)];
  $('#sg-cur').setAttribute('d', `M${x.toFixed(1)} 0V${H}M0 ${y.toFixed(1)}H${W}`);
  txt(
    '#sg-rd',
    `t −${(((W - x) / W) * S.span).toFixed(2)} s   f ${fmtR(ax.inv(1 - y / H), 'Hz', 4)}   ${Number.isFinite(v) ? `${dbT(v, 1)} dBFS/Hz` : '—'}`,
  );
}

/* ---------- カーソル ---------- */
let curW: number | null = null,
  curH: number | null = null,
  curS: number | null = null,
  curG: [number, number] | null = null;
function track(id: string, h: number, fn: (p: [number, number] | null) => void): void {
  const svg = $<SVGSVGElement>(id);
  svg.addEventListener('pointermove', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    fn(p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= h ? [p.x, p.y] : null);
  });
  svg.addEventListener('pointerleave', () => fn(null));
}
track('#w-svg', WH, (p) => {
  curW = p ? p[0] : null;
});
track('#h-svg', WH, (p) => {
  curH = p ? p[0] : null;
});
track('#sp-svg', H, (p) => {
  curS = p ? p[0] : null;
});
track('#sg-svg', H, (p) => {
  curG = p;
});

/* ---------- 測定 ---------- */
/** 長い時間の表記（60 s 以上は分・時間・日・年） */
function dur(s: number): string {
  if (s < 60) return ro(s, 's', 4);
  const U: [number, string][] = [
    [60, '分'],
    [3600, '時間'],
    [86400, '日'],
    [31557600, '年'],
  ];
  let u = U[0];
  for (const x of U) if (s >= x[0]) u = x;
  return `${(s / u[0]).toPrecision(4)}<span class="u">${u[1]}</span>`;
}
const mathPow = (n: number) => `<math><msup><mn>2</mn><mn>${n}</mn></msup><mo>−</mo><mn>1</mn></math>`;
/** 設定で決まる値: 目標の傾き、LFSR の周期 */
function info(): void {
  const sl = slopeOf(S.kind);
  html(
    '#o-slt',
    sl === null
      ? S.kind === 'gray'
        ? '目標の傾きなし（A 特性の逆数）'
        : '目標の傾きなし（クロックの整数倍で零）'
      : `目標 ${signed(sl)} dB/oct · ${FIT_LO} Hz–${FIT_HI / 1000} kHz の 1/3 oct 帯`,
  );
  if (S.kind !== 'lfsr') return;
  const p = spec.period,
    n = S.lf.n;
  html('#o-per', p === null ? '—' : `${p}<span class="u">ステップ</span>`);
  html(
    '#o-pern',
    spec.locked
      ? '止まったまま（初期値を変える）'
      : p === null
        ? '16777216 ステップより長い'
        : spec.prim
          ? `最大周期 ${mathPow(n)}`
          : `最大周期（${mathPow(n)}）ではない`,
  );
  html('#o-pt', p === null ? '—' : dur(p / S.clk));
  html('#o-pf', p === null ? '—' : ro(S.clk / p, 'Hz', 4));
}
function measure(): void {
  const cnt = Math.min(wpos - since, NB);
  if (!spec || cnt < 1024) return;
  const st = stats(ring, wpos, cnt);
  if (S.wv === 'hist') hgram = hist(ring, wpos, cnt, S.rng, HB);
  const r = dbfs(Math.SQRT2 * st.rms),
    pk = dbfs(st.peak),
    cf = st.rms > 0 ? 20 * Math.log10(st.peak / st.rms) : Number.NaN;
  html('#o-sl', fit ? `${signed(fit.slope)}<span class="u">dB/oct</span>` : '—');
  html('#o-rms', `${dbT(r)}<span class="u">dBFS</span>`);
  html('#o-pk', `${dbT(pk)}<span class="u">dBFS</span>`);
  html('#o-cf', Number.isFinite(cf) ? `${cf.toFixed(2)}<span class="u">dB</span>` : '—');
  txt('#o-cfx', Number.isFinite(cf) ? `${plain(st.peak / st.rms, 4, true)} 倍` : '');
  html('#o-ku', Number.isFinite(st.kurt) ? plain(st.kurt, 4, true) : '—');
  txt('#o-kut', '正規分布は 3');
  txt('#o-aux', `直近 ${fmtR(cnt / fs, 's', 3)}`);
  txt('#mS', fit ? `${signed(fit.slope)} dB/oct` : '—');
  txt('#mR', `${dbT(r, 1)} dBFS`);
  txt('#mC', Number.isFinite(cf) ? `${cf.toFixed(1)} dB` : '—');
  /* ベルベットを疎にしてピークをフルスケールに抑えたときは、実効値が下がる */
  const low = rmsOf(spec) < RMS * 0.999;
  txt('#o-rmsn', low ? `ピークを 1 に抑えたため、${dbT(dbfs(Math.SQRT2 * rmsOf(spec)), 1)} dBFS` : '');
}

/* ---------- LFSR の図 ---------- */
let vs = 0,
  vstep = 0,
  vacc = 0,
  vf: (s: number) => number = (s) => s;
const outs: number[] = [];
const svg = $<SVGSVGElement>('#lf-svg');
function lfReset(): void {
  if (S.kind !== 'lfsr') return;
  const c = S.lf,
    focus = (document.activeElement as Element | null)?.getAttribute?.('data-b');
  vf = stepper(c);
  vs = (c.init >>> 0) & full(c.n);
  vstep = 0;
  outs.length = 0;
  svg.innerHTML = frameSvg(c);
  if (focus) svg.querySelector<SVGElement>(`[data-b="${focus}"]`)?.focus();
  drawBits(false);
  const terms = [
    `<msup><mi>x</mi><mn>${c.n}</mn></msup>`,
    ...expList((c.exps & full(c.n) & ~1) >>> 0).map((e) =>
      e === 1 ? '<mi>x</mi>' : `<msup><mi>x</mi><mn>${e}</mn></msup>`,
    ),
    '<mn>1</mn>',
  ];
  html(
    '#lf-poly',
    `<math><mi>P</mi><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo><mo>=</mo>${terms.join('<mo>+</mo>')}</math>`,
  );
  svg.setAttribute(
    'aria-label',
    `${c.n} ビットのシフトレジスタ（${c.form === 'fib' ? 'フィボナッチ形' : 'ガロア形'}、${c.xnor ? 'XNOR' : 'XOR'}）。タップのビットを押すと入れ切りする`,
  );
}
function drawBits(fresh: boolean): void {
  const p = spec?.period;
  $('#lf-bits').innerHTML = bitsSvg(S.lf, vs, fresh);
  $('#lf-hist').setAttribute('d', histPath([...outs, vs & 1]));
  txt('#lf-step', p ? `${vstep % p} / ${p}` : String(vstep));
}
function lfStep(anim: boolean): void {
  outs.push(vs & 1);
  if (outs.length >= HIST) outs.shift();
  vs = vf(vs);
  vstep++;
  drawBits(true);
  if (anim && !RM.matches) {
    const w = cellW(S.lf.n);
    fx($('#lf-bits'), [{ transform: `translateX(${-w}px)` }, { transform: 'translateX(0)' }], 180);
  }
}
$('#lf-one').addEventListener('click', () => lfStep(true));
$('#lf-rst').addEventListener('click', () => lfReset());
/** 図のビットを押す: タップを入れ切りする（表のタップから任意に変わる） */
function toggleBit(i: number): void {
  const e = expOfBit(S.lf, i);
  if (!e) return;
  S.lf.exps = (S.lf.exps ^ (1 << e)) >>> 0;
  if (S.tapm !== 'custom') {
    S.tapm = 'custom';
    setChoice(tapmC, 'custom');
  }
  store('lf:exps', S.lf.exps);
  lfChanged();
  rebuild();
}
svg.addEventListener('click', (e) => {
  const b = (e.target as Element).closest('[data-b]');
  if (b) toggleBit(Number(b.getAttribute('data-b')));
});
svg.addEventListener('keydown', (e) => {
  const b = (e.target as Element).closest('[data-b]');
  if (!b || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  toggleBit(Number(b.getAttribute('data-b')));
});

/* ---------- 毎フレーム ---------- */
let prev = performance.now(),
  frame = 0;
function loop(now: number): void {
  const dt = Math.min(250, now - prev);
  prev = now;
  if (dirty) rebuild();
  if (S.run) {
    generate(dt);
    analyze();
    sgAcc += (dt / 1000) * (SGW / S.span);
    const n = Math.min(30, Math.floor(sgAcc));
    sgAcc -= n;
    if (n > 0) sgPush(n);
    if (++frame % 6 === 0) measure();
  }
  if (S.wv === 'yt') drawWave();
  else drawHist();
  if (S.sv === 'sg') {
    sgRender();
    sgCursor();
  } else drawSpec();
  if (S.kind === 'lfsr' && S.spd > 0) {
    vacc += (dt / 1000) * S.spd;
    let k = 0;
    while (vacc >= 1 && k++ < 4) {
      vacc -= 1;
      lfStep(S.spd <= 4);
    }
    if (vacc >= 1) vacc = 0;
  }
  requestAnimationFrame(loop);
}

/* ---------- 起動 ---------- */
cur.n = S.lf.n;
g.update('init', { max: full(S.lf.n) });
rows();
views();
setRun(true);
syncSnd();
lfChanged();
rebuild();
axes();
requestAnimationFrame(loop);

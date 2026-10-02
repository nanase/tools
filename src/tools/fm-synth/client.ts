/**
 * FM 音源のページの入口: アルゴリズム・帰還量・オペレータ・鍵盤の入力 → 音色 → 結線図・波形・スペクトラム・代入式・音。
 * 波形とスペクトラムは入力が変わるたびに 32 周期ぶんを計算し直す
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmt, fmtR, minus, plain } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { DV } from '../../lib/scope';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { spectra, toDb } from '../spectrum/fft';
import { FmAudio } from './audio';
import { algH, algSvg, algText, DW } from './diagram';
import { I0, IDX, KEYS, type Key, L0, LVL, NOTE0, noteHz, noteName, OCT, OPS, R0, RATIOS, VOL } from './params';
import { ALGS, FB_LABEL, isCarrier, normGain, type Patch, PTS, WAVES, waveIndex, waveOf } from './synth';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};

/* 表示窓: 10 × 4 div（400 × 160）。波形の振幅 0 は中央、スペクトラムは上端が 0 dBFS で 20 dB/div */
const W = 10 * DV,
  H = 4 * DV,
  MID = H / 2,
  DB_DIV = 20;
/** スペクトラムに使う周期の数（1 周期 PTS 点、計 16384 点） */
const SP_PER = 32,
  N = SP_PER * PTS;

/* ---------- 状態 ---------- */
const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
const alg = choice<string>('alg', (v) => {
  O.alg = Number(v);
  update();
});
const fb = choice<string>('fb', (v) => {
  O.fb = Number(v);
  update();
});
const norm = choice<'on' | 'off'>('norm', (v) => {
  O.norm = v === 'on';
  update();
});
const per = choice<string>('per', (v) => {
  O.per = Number(v);
  draw();
});
const rng = choice<string>('rng', (v) => {
  O.rng = Number(v);
  draw();
});
const hm = choice<string>('hm', (v) => {
  O.hm = Number(v);
  draw();
});
const view = new Choice<'yt' | 'sp'>($('#p-view'), (v) => {
  O.view = v;
  showView();
});
const O = {
  alg: Number(alg.value),
  fb: Number(fb.value),
  norm: norm.value === 'on',
  view: view.value,
  per: Number(per.value),
  rng: Number(rng.value),
  hm: Number(hm.value),
  /** カーソルの位置（表示窓の x）。外なら null */
  cur: null as number | null,
};
/** 保存した数値。なければ・使えなければ v0 */
const num = (k: string, v0: number, ok: (v: number) => boolean) => {
  const v = stored(k);
  return typeof v === 'number' && ok(v) ? v : v0;
};
/** オペレータの値（OP1〜OP4）: 波形・周波数比・変調指数・出力レベル（dB） */
const OV = {
  w: OPS.map(() => 0),
  r: OPS.map((n) => num(`p:r${n}`, R0[n - 1], (v) => RATIOS.includes(v))),
  i: OPS.map((n) => num(`p:i${n}`, I0[n - 1], (v) => v >= IDX.min && v <= IDX.max)),
  l: OPS.map((n) => num(`p:l${n}`, L0[n - 1], (v) => v >= LVL.min && v <= LVL.max)),
};
/** 鍵盤: 選んでいる音（MIDI のノート番号）と、左端の C のオクターブ */
const KB = {
  n: num('kb:n', NOTE0, (v) => Number.isInteger(v) && v >= 12 * (OCT.min + 1) && v < 12 * (OCT.max + 1) + KEYS),
  o: num('kb:o', OCT.v, (v) => Number.isInteger(v) && v >= OCT.min && v <= OCT.max),
};
const f0 = () => noteHz(KB.n);
/** 計算した 32 周期ぶんの出力と、そのスペクトラム（dB） */
let wave = new Float64Array(N),
  spec = new Float32Array(N / 2 + 1);
const audio = new FmAudio();

function patch(): Patch {
  return {
    alg: O.alg,
    fb: O.fb,
    w: OV.w,
    r: OV.r,
    a: OPS.map((_, k) => (isCarrier(O.alg, k) ? 10 ** (OV.l[k] / 20) : OV.i[k])),
    norm: O.norm,
  };
}

/* ---------- オペレータ ---------- */
const fmtI = (v: number) => `I ${plain(v, 3)}`;
const fmtL = (v: number) => `${minus(String(v))} dB`;
/** キャリアかモジュレータかで、スライダーを出力レベルか変調指数にする */
function syncOp(k: number): void {
  const n = k + 1,
    car = isCarrier(O.alg, k),
    sl = $<HTMLInputElement>(`#op${n}-a`),
    R = car ? LVL : IDX,
    v = car ? OV.l[k] : OV.i[k];
  txt(`#op${n}-role`, car ? 'キャリア' : 'モジュレータ');
  sl.min = String(R.min);
  sl.max = String(R.max);
  sl.step = String(R.step);
  sl.value = String(v);
  sl.style.setProperty('--p', ((v - R.min) / (R.max - R.min)).toFixed(4));
  sl.setAttribute('aria-label', `OP${n} の${car ? '出力レベル' : '変調指数'}`);
  sl.setAttribute('aria-valuetext', car ? fmtL(v) : `変調指数 ${plain(v, 3)}`);
  txt(`#op${n}-v`, car ? fmtL(v) : fmtI(v));
  const ri = RATIOS.indexOf(OV.r[k]);
  txt(`#op${n}-r`, `×${plain(OV.r[k], 3)}`);
  for (const b of $$<HTMLButtonElement>(`#op${n} .ostp`))
    b.setAttribute('aria-disabled', String(b.dataset.d === '1' ? ri >= RATIOS.length - 1 : ri <= 0));
}
OPS.forEach((n, k) => {
  const wc = new Choice<string>($(`#p-w${n}`), (v) => {
    OV.w[k] = waveIndex(v);
    update();
  });
  OV.w[k] = waveIndex(wc.value);
  $<HTMLInputElement>(`#op${n}-a`).addEventListener('input', (e) => {
    const v = Number((e.currentTarget as HTMLInputElement).value),
      car = isCarrier(O.alg, k);
    if (car) OV.l[k] = v;
    else OV.i[k] = Number(v.toFixed(1));
    store(`p:${car ? 'l' : 'i'}${n}`, car ? OV.l[k] : OV.i[k]);
    update();
  });
  for (const b of $$<HTMLButtonElement>(`#op${n} .ostp`))
    b.addEventListener('click', () => {
      const ri = RATIOS.indexOf(OV.r[k]) + Number(b.dataset.d);
      if (ri < 0 || ri >= RATIOS.length) return;
      OV.r[k] = RATIOS[ri];
      store(`p:r${n}`, OV.r[k]);
      update();
    });
});

/** 結線図の箱の下に添える値 */
const notes = () => OPS.map((_, k) => `×${plain(OV.r[k], 3)} · ${isCarrier(O.alg, k) ? fmtL(OV.l[k]) : fmtI(OV.i[k])}`);

/** 入力が変わったら: 音色を作り直し、波形とスペクトラムを計算して描く */
function update(): void {
  const p = patch();
  for (let k = 0; k < 4; k++) syncOp(k);
  const ng = normGain(p),
    nt = $('#w-norm');
  nt.hidden = ng === 1;
  txt('#w-norm b', `×${plain(ng, 3, true)}`);
  const svg = $('#alg-svg');
  svg.innerHTML = algSvg(O.alg, O.fb, notes());
  svg.setAttribute('viewBox', `0 0 ${DW} ${algH(O.alg)}`);
  svg.setAttribute('aria-label', `${algText(O.alg)}。帰還量 ${FB_LABEL[O.fb]}`);
  wave = waveOf(p, SP_PER);
  const px = new Float32Array(N / 2 + 1);
  spectra(wave, wave, N, 'bh', px, new Float32Array(N / 2 + 1));
  spec = px;
  subst(p);
  audio.send(p, f0());
  draw();
}

/* ---------- 波形 ---------- */
const vds = (v: number) => minus(String(Number(v.toPrecision(3))));
const signed = (v: number, d = 3) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
const wy = (v: number) => MID - (v / O.rng) * MID;

function drawWave(): void {
  const n = O.per * PTS,
    k = W / n,
    y = (v: number) => Math.max(-400, Math.min(H + 400, wy(v))).toFixed(1);
  let d = '';
  if (n <= 1600) for (let i = 0; i <= n; i++) d += `${i ? 'L' : 'M'}${(i * k).toFixed(2)} ${y(wave[i])}`;
  else
    for (let j = 0; j < 2 * W; j++) {
      const i0 = Math.floor(j / (2 * k)),
        i1 = Math.min(n, Math.floor((j + 1) / (2 * k)));
      let lo = Infinity,
        hi = -Infinity;
      for (let i = i0; i <= i1; i++) {
        lo = Math.min(lo, wave[i]);
        hi = Math.max(hi, wave[i]);
      }
      d += `${d ? 'L' : 'M'}${j / 2} ${y(hi)}L${j / 2} ${y(lo)}`;
    }
  $('#w-t1').setAttribute('d', d);
  const f0 = noteHz(KB.n),
    hd = O.per / f0 / 10,
    vd = O.rng / 2;
  let a = '';
  for (let i = 0; i <= 10; i += 2)
    a += `<text x="${i * DV}" y="${H + 17}" text-anchor="middle">${i ? fmt(i * hd, 's', 3) : '0'}</text>`;
  for (let j = 0; j <= 4; j++) {
    const v = (2 - j) * vd;
    a += `<text x="-10" y="${j * DV + 4}" text-anchor="end">${v === 0 ? '0' : (v > 0 ? '+' : '') + vds(v)}</text>`;
  }
  a += `<path class="mk1" d="M-8 ${MID - 5}L-1 ${MID}L-8 ${MID + 5}Z"/>`;
  html('#w-axes', a);
  txt('#w-vd', vds(vd));
  txt('#w-hd', fmt(hd, 's', 3));
  txt('#w-f0', fmt(f0, 'Hz', 4));
  let pk = 0;
  for (let i = 0; i <= n; i++) pk = Math.max(pk, Math.abs(wave[i]));
  $('#w-svg').setAttribute(
    'aria-label',
    `出力の波形。基本周波数 ${fmt(f0, 'Hz')} の ${O.per} 周期ぶん、ピーク ${plain(pk, 3)}。縦軸 ${vds(vd)}/div、横軸 ${fmt(hd, 's', 3)}/div。`,
  );
}

/* ---------- スペクトラム ---------- */
/** 横軸の右端の bin（基本周波数の hm 倍） */
const kMax = () => SP_PER * O.hm;
const sy = (db: number) => Math.max(-4, Math.min(H + 4, (-db / DB_DIV) * DV));

function drawSpec(): void {
  const km = kMax(),
    k = W / km;
  let d = '';
  for (let j = 0; j < 2 * W; j++) {
    const i0 = Math.ceil(j / (2 * k)),
      i1 = Math.min(km, Math.floor((j + 1) / (2 * k)));
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) hi = Math.max(hi, spec[i]);
    if (hi > -Infinity) d += `${d ? 'L' : 'M'}${j / 2} ${sy(toDb(hi)).toFixed(1)}`;
  }
  $('#s-t1').setAttribute('d', d);
  const f0 = noteHz(KB.n);
  let a = '';
  for (let i = 0; i <= 10; i += 2) {
    const f = (i / 10) * O.hm * f0;
    a += `<text x="${i * DV}" y="${H + 17}" text-anchor="middle">${i ? fmt(f, 'Hz', 3) : '0'}</text>`;
  }
  for (let j = 0; j <= 4; j++)
    a += `<text x="-10" y="${j * DV + 4}" text-anchor="end">${j ? minus(String(-j * DB_DIV)) : '0'}</text>`;
  html('#s-axes', a);
  txt('#s-x', `0–${fmt(O.hm * f0, 'Hz', 3)}`);
  $('#s-svg').setAttribute(
    'aria-label',
    `出力のスペクトラム。横軸 0 から ${fmt(O.hm * f0, 'Hz', 3)}（基本周波数の ${O.hm} 倍）、縦軸 0 から −80 dBFS。`,
  );
}

function draw(): void {
  if (O.view === 'yt') drawWave();
  else drawSpec();
  cursor();
}

function showView(): void {
  $('#v-yt').hidden = O.view !== 'yt';
  $('#v-sp').hidden = O.view !== 'sp';
  txt('#hd-wave', O.view === 'sp' ? 'スペクトラム' : '波形');
  O.cur = null;
  draw();
}

/* ---------- カーソルの読み値 ---------- */
const svgs = [$<SVGSVGElement>('#w-svg'), $<SVGSVGElement>('#s-svg')];
function cursor(): void {
  const sp = O.view === 'sp',
    id = sp ? 's' : 'w',
    x = O.cur;
  $(`#${sp ? 'w' : 's'}-cur`).setAttribute('d', '');
  if (x === null) {
    $(`#${id}-cur`).setAttribute('d', '');
    txt(`#${id}-rd`, '');
    return;
  }
  if (sp) {
    /* 近くの山（±4 bin）に合わせる */
    const km = kMax(),
      c = Math.round((x / W) * km);
    let b = c;
    for (let i = Math.max(0, c - 4); i <= Math.min(km, c + 4); i++) if (spec[i] > spec[b]) b = i;
    const xb = (b / km) * W,
      db = toDb(spec[b]);
    $('#s-cur').setAttribute('d', `M${xb.toFixed(1)} 0V${H}`);
    txt(
      '#s-rd',
      `f ${b ? fmtR((b / SP_PER) * f0(), 'Hz', 4) : '0 Hz'}   CH1 ${db < -150 ? '−∞' : minus(db.toFixed(2))} dBFS`,
    );
  } else {
    const n = O.per * PTS,
      i = Math.round((x / W) * n),
      t = i / PTS / f0();
    $('#w-cur').setAttribute('d', `M${x.toFixed(1)} 0V${H}`);
    txt('#w-rd', `t ${i ? fmtR(t, 's', 4) : '0'}   CH1 ${signed(wave[i])}`);
  }
}
for (const svg of svgs) {
  svg.addEventListener('pointermove', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    O.cur = p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H ? p.x : null;
    cursor();
  });
  svg.addEventListener('pointerleave', () => {
    O.cur = null;
    cursor();
  });
}

/* ---------- 代入した式 ---------- */
const mn = (s: string) => `<mn>${s}</mn>`;
const sOf = (k: number) => `<msub><mi>s</mi><mn>${k + 1}</mn></msub>`;
const DOT = '<mo>&#x22C5;</mo>';
function subst(p: Patch): void {
  const { e, c } = ALGS[p.alg];
  let h = '';
  for (let k = 0; k < 4; k++) {
    let m = '';
    for (const [j, t] of e) if (t === k) m += `<mo>+</mo>${mn(plain(p.a[j], 3))}${sOf(j)}`;
    if (k === 0 && p.fb)
      m += `<mo>+</mo><mrow>${mn(FB_LABEL[p.fb])}</mrow><msub><mover><mi>s</mi><mo>&#x2015;</mo></mover><mn>1</mn></msub>`;
    h += `<math display="block">${sOf(k)}<mo>=</mo><mi>${WAVES[p.w[k]][2]}</mi><mo>&#x2061;</mo><mrow><mo>(</mo><mn>2</mn><mi>π</mi>${DOT}${mn(plain(p.r[k] * f0(), 6))}<mi>t</mi>${m}<mo>)</mo></mrow></math>`;
  }
  const ng = normGain(p),
    sum = c.map((k) => `${mn(plain(p.a[k], 4, true))}${sOf(k)}`).join('<mo>+</mo>');
  h += `<math display="block"><mi>y</mi><mo>=</mo>${ng === 1 ? sum : `${mn(plain(ng, 4, true))}<mrow><mo>(</mo>${sum}<mo>)</mo></mrow>`}</math>`;
  html('#subst', h);
}

/* ---------- 鍵盤と音 ---------- */
const kb = $('#kb'),
  keys = $$<HTMLButtonElement>('.kk', kb),
  playBtn = $('#playBtn');
function syncKb(): void {
  const c0 = 12 * (KB.o + 1);
  for (const b of keys) {
    const n = c0 + Number(b.dataset.i);
    b.setAttribute('aria-pressed', String(n === KB.n));
    b.setAttribute('aria-label', `${noteName(n)} ${fmt(noteHz(n), 'Hz', 5)}`);
    const lab = b.querySelector('span');
    if (lab) lab.textContent = n % 12 === 0 ? noteName(n) : '';
  }
  txt('#kb-rng', `${noteName(c0)}–${noteName(c0 + KEYS - 1)}`);
  txt('#kb-note', noteName(KB.n));
  txt('#kb-hz', fmtR(noteHz(KB.n), 'Hz', 5));
  $<HTMLButtonElement>('#octDn').disabled = KB.o <= OCT.min;
  $<HTMLButtonElement>('#octUp').disabled = KB.o >= OCT.max;
}
function pick(n: number): void {
  if (n === KB.n) return;
  KB.n = n;
  store('kb:n', n);
  syncKb();
  update();
}
for (const [id, d] of [
  ['#octDn', -1],
  ['#octUp', 1],
] as const)
  $(id).addEventListener('click', () => {
    KB.o = Math.max(OCT.min, Math.min(OCT.max, KB.o + d));
    store('kb:o', KB.o);
    syncKb();
  });

function syncSnd(err = ''): void {
  playBtn.setAttribute('aria-pressed', String(audio.latch));
  $('#sndLed').classList.toggle('on', audio.play);
  txt('#playT', audio.latch ? '停止' : '再生');
  txt('#snd-msg', err);
}
const NO_SOUND = '音を出せませんでした';
playBtn.addEventListener('click', async () => {
  const ok = await audio.setLatch(!audio.latch);
  if (!ok) audio.latch = false;
  syncSnd(ok ? '' : NO_SOUND);
});

/* 鍵盤: 押している間だけ鳴らす（再生中なら音の高さだけ変える）。押したまま横へ動かすと音が移る */
const keyAt = (e: Event) => (e.target as Element).closest<HTMLButtonElement>('.kk');
const noteOf = (b: HTMLButtonElement) => 12 * (KB.o + 1) + Number(b.dataset.i);
let down = false;
async function hold(on: boolean): Promise<void> {
  if (down === on) return;
  down = on;
  const ok = await audio.setHold(on);
  syncSnd(ok ? '' : NO_SOUND);
}
kb.addEventListener('pointerdown', (e) => {
  const b = keyAt(e);
  if (!b || e.button !== 0) return;
  b.releasePointerCapture(e.pointerId);
  pick(noteOf(b));
  void hold(true);
});
kb.addEventListener('pointerover', (e) => {
  const b = keyAt(e);
  if (b && down) pick(noteOf(b));
});
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => void hold(false));
kb.addEventListener('click', (e) => {
  const b = keyAt(e);
  /* キーボードの Enter・Space は音の高さを選ぶだけ */
  if (b && e.detail === 0) pick(noteOf(b));
});

/* ---------- 起動 ---------- */
syncKb();
/* 生成時に 1 回目の onChange で音量を送る */
new ParamGroup<Key>([VOL], (v) => audio.vol(v.vol));
update();
showView();

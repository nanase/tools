/**
 * チューナーの入口: 入力（マイク・ファイル・テスト信号）→ 高域通過・出だし → 音高の推定と追跡（tracker.ts）→
 * 針のメータか 12 音のストロボ、読み値、弦の並び、測定。推定は 40 ms ごと、描画は毎フレーム
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { fmtR } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { NB } from '../audio/capture';
import { initInput } from '../audio/input';
import { partial } from './mpm';
import { hzOf, instrumentOf, type NameOpts, type Naming, noteLabel, noteText } from './notes';
import {
  deviations,
  type Key,
  REF,
  RESP,
  type Resp,
  type Spd,
  TEMPERAMENTS,
  TONICS,
  TRANSPOSE,
  type View,
} from './params';
import { estimate, HighPass, Onset, type Reading, refWin, Tracker } from './tracker';
import { bandHz, bandOf, contrast, meterTicks, needlePath, type Part, stripes, zonePath } from './view';

initToolPage();
const { a, tick: inTick } = initInput();

const txt = (el: Element, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};
const cls = (el: Element, c: string) => {
  if (el.getAttribute('class') !== c) el.setAttribute('class', c);
};
const attr = (el: Element, k: string, v: string) => {
  if (el.getAttribute(k) !== v) el.setAttribute(k, v);
};
/** 符号つき（0 は符号なし）。マイナスは U+2212 */
const sg = (v: number, d = 1) => {
  const s = Math.abs(v).toFixed(d);
  return Number(s) === 0 ? s : (v < 0 ? '−' : '+') + s;
};
/** 周波数: 有効数字 5 桁、末尾の 0 を残す（110.00 Hz） */
const hz = (f: number) => fmtR(f, 'Hz', 5);

/* ---------- 状態 ---------- */
const S = {
  view: 'meter' as View,
  spd: 'hz' as Spd,
  scale: 50,
  tol: 2,
  resp: 'std' as Resp,
  inst: 'chr',
  tun: {} as Record<string, string>,
  /** 固定した弦（−1 は自動） */
  str: -1,
  ref: 440,
  nm: 'en' as Naming,
  c3: false,
  flat: false,
  tem: 'et',
  ton: 0,
  tr: 0,
};
const nameOpts = (): NameOpts => ({ nm: S.nm, flat: S.flat, c3: S.c3 });

const tracker = new Tracker({ a4: 440, strs: null, fix: -1, dev: null, minClarity: 0.9 });
/** 弦の音番号（楽器を選んでいるとき） */
function strs(): readonly number[] | null {
  const i = instrumentOf(S.inst);
  if (!i) return null;
  return (i.tunings.find((t) => t.v === S.tun[i.v]) ?? i.tunings[0]).notes;
}
/** 探す周波数の範囲: クロマチックは A0 の少し下から、楽器は最も低い弦の半オクターブ下から最も高い弦の 1 オクターブ上まで */
function range(): [number, number] {
  const st = strs();
  if (!st) return [26, 4400];
  return [hzOf(Math.min(...st), S.ref) * 2 ** (-6 / 12), hzOf(Math.max(...st), S.ref) * 2.2];
}
/** 追跡の条件を今の設定に合わせ、追っている音を捨てる */
function retarget(): void {
  tracker.o = { ...tracker.o, a4: S.ref, strs: strs(), fix: S.str, dev: deviations(S.tem, S.ton) };
  tracker.reset(true);
  rd = null;
  shown = null;
}

/* ---------- 入力の行と選択肢 ---------- */
const g = new ParamGroup<Key>([REF], (v, k) => {
  if (!k) return;
  S.ref = v.ref;
  retarget();
  strList();
  sync();
});
S.ref = g.get('ref');

const fig = $('.a-fig');
new Choice<View>($('#p-view'), (v) => {
  S.view = v;
  sync();
});
new Choice<Spd>($('#p-spd'), (v) => {
  S.spd = v;
  sync();
});
new Choice<string>($('#p-scale'), (v) => {
  S.scale = Number(v);
  meter();
});
new Choice<string>($('#p-tol'), (v) => {
  S.tol = Number(v);
  meter();
  sync();
});
new Choice<Resp>($('#p-resp'), (v) => {
  S.resp = v;
});
/* 楽器と調弦。調弦の行は楽器ごとに 1 行あり、選んだ楽器の行だけを出す */
const tunRows = $$('.tunr');
for (const row of tunRows) {
  const v = row.id.replace('p-tun-', '');
  const c = new Choice<string>(row, (t) => {
    S.tun[v] = t;
    S.str = -1;
    sv = {};
    retarget();
    strings();
    sync();
  });
  S.tun[v] = c.value;
}
new Choice<string>($('#p-inst'), (v) => {
  S.inst = v;
  S.str = -1;
  sv = {};
  retarget();
  strings();
  sync();
});
const nmC = new Choice<Naming>($('#p-nm'), (v) => {
  S.nm = v;
  names();
});
const ocC = new Choice<string>($('#p-oc'), (v) => {
  S.c3 = v === '3';
  names();
});
new Choice<string>($('#p-acc'), (v) => {
  S.flat = v === 'f';
  names();
});
const tonC = new Choice<string>($('#p-ton'), (v) => {
  S.ton = Number(v);
  retarget();
  strList();
  sync();
});
new Choice<string>($('#p-tem'), (v) => {
  S.tem = v;
  retarget();
  strList();
  sync();
});
new Choice<string>($('#p-trn'), (v) => {
  S.tr = Number(v);
  sync();
});
/* 保存した値は Choice が生成の直後（マイクロタスク）に onChange で戻す。初めの値は aria-pressed から読む */
S.view = ($('#p-view button[aria-pressed="true"]').dataset.v ?? 'meter') as View;
S.nm = nmC.value;
S.c3 = ocC.value === '3';
S.ton = Number(tonC.value);

/* ---------- 表示の切り替えと、設定に合わせて変える文字 ---------- */
function sync(): void {
  const st = S.view === 'strobe';
  fig.classList.toggle('st', st);
  txt($('#hd-fig'), st ? 'ストロボ' : 'メータ');
  txt($('#s-view'), st ? `12 音 · 縞の速さ ${S.spd === 'hz' ? '周波数の差' : 'セント'}` : '針');
  txt($('#s-ref'), S.ref.toFixed(1));
  txt($('#s-tol'), `±${S.tol}`);
  const tem = TEMPERAMENTS.find((t) => t[0] === S.tem) ?? TEMPERAMENTS[0],
    tr = TRANSPOSE.find((t) => t[0] === S.tr) ?? TRANSPOSE[0];
  txt($('#s-tem'), (tem[0] === 'et' ? '平均律' : `${tem[1]}（主音 ${TONICS[S.ton]}）`) + (S.tr ? ` · ${tr[1]}` : ''));
  const i = instrumentOf(S.inst);
  txt(
    $('#s-inst'),
    i
      ? `${i.name}${i.tunings.length > 1 ? ` ${(i.tunings.find((t) => t.v === S.tun[i.v]) ?? i.tunings[0]).name}` : ''} · ${S.str < 0 ? '弦は自動' : `${strLabel(S.str)}に固定`}`
      : 'クロマチック',
  );
  for (const row of tunRows) row.hidden = row.id !== `p-tun-${S.inst}`;
  ocC.setOff(S.nm === 'ja', 'ハニホでは使いません（一点・二点…で書きます）');
  tonC.setOff(S.tem === 'et', '平均律では使いません');
}

/* ---------- メータの目盛り ---------- */
function meter(): void {
  const t = meterTicks(S.scale),
    z = zonePath(S.tol, S.scale);
  attr($('#mt-tk'), 'd', t.minor);
  attr($('#mt-tk2'), 'd', t.major);
  attr($('#mt-zone'), 'd', z.zone);
  attr($('#mt-zl'), 'd', z.edge);
  $('#mt').classList.toggle('s20', S.scale === 20);
}

/* ---------- 弦の並び ---------- */
/** 弦ごとの、最後に測ったずれ [セント] */
let sv: Record<number, number> = {};
const strBox = $('#strs');
function strLabel(i: number): string {
  const ins = instrumentOf(S.inst),
    st = strs();
  if (!ins || !st) return '';
  return ins.numbered ? `${st.length - i} 弦` : `${noteLabel(st[i], nameOpts()).name} 線`;
}
const devOf = (n: number) => {
  const d = deviations(S.tem, S.ton);
  return d ? d[((n % 12) + 12) % 12] : 0;
};
function strings(): void {
  const st = strs();
  strBox.hidden = !st;
  $('#p-strl').hidden = !st;
  if (!st) {
    strBox.innerHTML = '';
    return;
  }
  let h = `<button type="button" class="sbtn auto" data-i="-1" aria-pressed="${S.str < 0}" title="いちばん近い弦を自動で選ぶ"><span>弦</span><b>自動</b><span class="d">—</span></button>`;
  st.forEach((n, i) => {
    h += `<button type="button" class="sbtn" data-i="${i}" aria-pressed="${S.str === i}" title="${esc(`${strLabel(i)} ${noteText(n, nameOpts())}（${hz(hzOf(n, S.ref, devOf(n)))}）に固定する`)}"><span>${esc(strLabel(i))}</span><b>${esc(noteText(n, nameOpts()))}</b><span class="d">—</span><span class="bar" aria-hidden="true"><i class="none"></i></span></button>`;
  });
  strBox.innerHTML = h;
  strList();
}
strBox.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('.sbtn');
  if (!b) return;
  const i = Number(b.dataset.i);
  S.str = i < 0 || S.str === i ? -1 : i;
  for (const x of $$<HTMLButtonElement>('.sbtn', strBox))
    x.setAttribute('aria-pressed', String(Number(x.dataset.i) === S.str));
  retarget();
  sync();
});
function strList(): void {
  const ins = instrumentOf(S.inst),
    st = strs();
  if (!ins || !st) return;
  txt(
    $('#strl'),
    `${st.map((n, i) => `${ins.numbered ? `${st.length - i} ` : ''}${noteText(n, nameOpts())} ${hzOf(n, S.ref, devOf(n)).toFixed(2)}`).join(' · ')} Hz`,
  );
}

/* ---------- 12 音のストロボの窓 ---------- */
interface Win {
  el: HTMLElement;
  label: HTMLElement;
  bg: SVGPathElement[];
  st: SVGPathElement[];
}
/** 窓 p の帯 o（0〜3 = 2〜5 オクターブ）。bg・st は帯の下から順 */
const wins: Win[] = $$('.swin').map((el) => {
  const bg = $$<SVGPathElement>('.bgd', el).reverse(),
    st = $$<SVGPathElement>('.stp', el).reverse();
  return { el, label: $('span', el), bg, st };
});
/** 帯ごとの縞の位相 [周]・速さ [本/s]・見え方 */
const ph = new Float64Array(48),
  rate = new Float64Array(48),
  vis = new Float64Array(48);
function names(): void {
  wins.forEach((w, p) => {
    txt(w.label, noteLabel(60 + p, nameOpts()).name);
  });
  strings();
  sync();
  shown = null;
}

/* ---------- 推定 ---------- */
const xb = new Float64Array(NB);
let onset = new Onset(48000),
  since0 = 0,
  fsCur = 0,
  epoch = a.epoch,
  lastAna = 0,
  /** 直近の読み値（追跡の結果）と、表示用にならしたずれ */
  rd: Reading | null = null,
  cs = 0,
  seen = -1e9,
  clar = 0,
  win = 0,
  /** 部分音（ストロボ用）と基本周波数 */
  parts: Part[] = [],
  f0 = 0;

function analyze(now: number): void {
  const fs = a.fs;
  if (fs !== fsCur || epoch !== a.epoch) {
    fsCur = fs;
    epoch = a.epoch;
    onset = new Onset(fs);
    since0 = 0;
    tracker.reset(true);
    rd = null;
  }
  /* マイクとファイルは CH1 と CH2 の平均。テスト信号は CH2 がリサジュー用に周波数比をずらした音なので CH1 だけ */
  if (a.src === 'test') xb.set(a.L);
  else for (let i = 0; i < NB; i++) xb[i] = 0.5 * (a.L[i] + a.R[i]);
  new HighPass(fs).process(xb);
  const n = Math.min(NB, Math.max(0, Math.round(((now - lastAna) / 1000) * fs)));
  onset.push(xb, NB - n, n);
  if (onset.since !== since0) {
    since0 = onset.since;
    tracker.reset(true);
  }
  const since = Math.max(0, NB - onset.ago),
    [fmin, fmax] = range(),
    e = estimate(xb, NB, { fs, fmin, fmax, maxW: 16384 }, since, tracker.hint()),
    r = tracker.push(e),
    dt = Math.min(0.2, (now - lastAna) / 1000);
  clar = e?.clarity ?? 0;
  if (r) {
    const tau = RESP[S.resp];
    cs =
      !rd || rd.tgt !== r.tgt || rd.si !== r.si || now - seen > 300
        ? r.cents
        : cs + (r.cents - cs) * (1 - Math.exp(-dt / tau));
    rd = r;
    seen = now;
    if (r.si >= 0) sv[r.si] = cs;
    /* ストロボ: 第 1〜8 部分音の周波数と強さを、出だしより後の窓で測る */
    let W = Math.min(16384, refWin(fs, r.f));
    while (W > 2048 && W > NB - since) W /= 2;
    win = W;
    const x = xb.subarray(NB - W);
    parts = [];
    for (let k = 1; k <= 8 && k * r.f < fs * 0.45; k++) parts.push({ k, ...partial(x, r.f, k, fs) });
    const top = Math.max(1e-12, ...parts.map((p) => p.a));
    for (const p of parts) p.a /= top;
    f0 = r.f;
  } else parts = [];
  /* 帯の見え方と縞の速さ（音がなければ止める） */
  const dev = deviations(S.tem, S.ton);
  for (let p = 0; p < 12; p++)
    for (let o = 0; o < 4; o++) {
      const i = p * 4 + o;
      if (!parts.length) {
        vis[i] = 0;
        rate[i] = 0;
        continue;
      }
      const b = bandOf(bandHz(p, o, S.ref, dev), f0, parts, S.spd);
      vis[i] = b.vis;
      rate[i] = b.rate;
    }
}

/* ---------- 描画 ---------- */
const el = {
  ndl: $('#mt-ndl'),
  lo: $('#lp-lo'),
  ok: $('#lp-ok'),
  hi: $('#lp-hi'),
  nt: $('#nt'),
  pre: $('#nt-pre'),
  n: $('#nt-n'),
  o: $('#nt-o'),
  cvl: $('#cvl'),
  cv: $('#cv'),
  fq: $('#fq'),
  stt: $('#stt'),
  sttT: $('#stt-t'),
  live: $('#live'),
  clBar: $('#cl-bar'),
  clT: $('#cl-t'),
  flg: $('#flg'),
};
/** 読み上げに出した文（変わったときだけ出し直す） */
let shown: string | null = null;
const flag = (v: unknown) => (v === false ? '切' : v === true ? '入' : '不明');

function render(now: number, dt: number): void {
  const run = a.run,
    hold = !!rd && now - seen < 1500,
    on = !!rd && now - seen < 250,
    st = S.view === 'strobe';
  const c = hold ? cs : 0,
    ok = hold && Math.abs(c) <= S.tol,
    flat = hold && c < -S.tol,
    sharp = hold && c > S.tol;
  /* 針 */
  if (!st) {
    attr(el.ndl, 'd', needlePath(c, S.scale));
    cls(el.ndl, on ? 'ndl' : 'ndl dim');
  }
  /* 灯りと読み値 */
  cls(el.lo, `lo${flat || ok ? ' on' : ''}`);
  cls(el.ok, `ok${ok ? ' on' : ''}`);
  cls(el.hi, `hi${sharp || ok ? ' on' : ''}`);
  const lab = hold && rd ? noteLabel(rd.tgt + S.tr, nameOpts()) : null;
  cls(el.nt, on ? 'nt' : 'nt dim');
  txt(el.pre, lab?.pre ?? '');
  txt(el.n, lab?.name ?? '—');
  cls(el.n, lab && (S.nm === 'do' || S.nm === 'ja') ? 'jp' : '');
  txt(el.o, lab?.oct ?? '');
  cls(el.cvl, on ? 'cvl' : 'cvl dim');
  txt(el.cv, hold ? sg(c) : '—');
  txt(el.fq, hold && rd ? `${hz(rd.f)}（目標 ${hz(rd.ft)}）` : '—');
  const state = !run ? '停止中' : !hold ? '音を待っています' : ok ? '合っています' : flat ? '低い' : '高い';
  cls(el.stt, `stt${ok ? ' ok' : flat || sharp ? ' go' : ''}`);
  txt(el.sttT, state);
  const say = hold && rd ? `${noteText(rd.tgt + S.tr, nameOpts())} ${state}` : state;
  if (say !== shown) {
    shown = say;
    txt(el.live, say);
  }
  /* 弦の並び */
  if (!strBox.hidden)
    for (const b of $$<HTMLButtonElement>('.sbtn', strBox)) {
      const i = Number(b.dataset.i);
      if (i < 0) {
        txt($('.d', b), S.str < 0 && hold && rd && rd.si >= 0 ? strLabel(rd.si) : '—');
        continue;
      }
      const v = sv[i],
        has = v != null,
        bar = $('.bar i', b);
      txt($('.d', b), has ? sg(v) : '—');
      cls(bar, has ? (Math.abs(v) <= S.tol ? 'ok' : '') : 'none');
      if (has) bar.style.left = `${(50 + Math.max(-50, Math.min(50, v))).toFixed(1)}%`;
      b.classList.toggle('cur', S.str < 0 && hold && rd?.si === i);
    }
  /* ストロボ（窓 12 × 帯 4）。音がない間はランプが消えかかって、かすかにちらつく */
  if (st) {
    const tgt = hold && rd ? ((rd.tgt % 12) + 12) % 12 : -1;
    wins.forEach((w, p) => {
      cls(w.el, `swin${p === tgt ? (ok ? ' ok' : ' on') : ''}`);
      const L = on ? 1 : run ? 0.12 + 0.08 * Math.random() : 0.05;
      for (let o = 0; o < 4; o++) {
        const i = p * 4 + o;
        if (on) ph[i] = (ph[i] + rate[i] * dt) % 1;
        const C = on ? contrast(vis[i], rate[i]) : 0;
        attr(w.st[o], 'd', C > 0.02 ? stripes(o, ph[i]) : '');
        attr(w.st[o], 'opacity', C.toFixed(2));
        attr(w.bg[o], 'opacity', (0.5 * (1 - C) * L).toFixed(2));
      }
    });
  }
}

/* 測定と入力の行（数値の文字は 10 回/s） */
function measure(): void {
  const hold = !!rd && performance.now() - seen < 1500;
  txt($('#o-f'), hold && rd ? hz(rd.f) : '—');
  txt($('#o-fn'), hold && rd ? `${noteText(rd.tgt + S.tr, nameOpts())} ${sg(cs)} セント` : '');
  txt($('#o-ft'), hold && rd ? hz(rd.ft) : '—');
  txt($('#o-df'), hold && rd ? `${sg(rd.f - rd.ft, 3)} Hz` : '—');
  txt($('#o-cl'), a.run ? clar.toFixed(2) : '—');
  txt($('#o-w'), win && a.run ? `${((win / a.fs) * 1000).toFixed(0)} ms` : '—');
  txt($('#o-wn'), win && a.run ? `${win} 点` : '');
  txt($('#o-fs'), a.run ? fmtR(a.fs, 'Hz', 4) : '—');
  /* 入力レベルは入力の枠の表示（直近 50 ms のピーク）を写す */
  txt($('#o-lv'), a.run ? ($('#lt0').textContent ?? '—') : '—');
  el.clBar.style.width = `${(a.run ? clar * 100 : 0).toFixed(1)}%`;
  cls(el.clBar, clar < 0.9 ? 'low' : '');
  txt(el.clT, a.run ? clar.toFixed(2) : '—');
  const m = a.src === 'mic' ? a.micSettings : null;
  txt(
    el.flg,
    m
      ? `エコー除去 ${flag(m.echoCancellation)} · 雑音抑圧 ${flag(m.noiseSuppression)} · 自動ゲイン ${flag(m.autoGainControl)}`
      : '—',
  );
  txt($('#mn'), hold && rd ? noteText(rd.tgt + S.tr, nameOpts()) : '—');
  txt($('#mc'), hold ? `${sg(cs)}¢` : '—');
  txt($('#mf'), hold && rd ? hz(rd.f) : '—');
}

/* ---------- 毎フレーム ---------- */
let prev = performance.now(),
  lastMeas = 0;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  const fresh = a.pull(now);
  inTick(fresh);
  if (!a.run) {
    rd = null;
    clar = 0;
  } else if (fresh && now - lastAna >= 40) {
    analyze(now);
    lastAna = now;
  }
  render(now, dt);
  if (now - lastMeas >= 100) {
    lastMeas = now;
    measure();
  }
  requestAnimationFrame(loop);
}

meter();
strings();
names();
retarget();
requestAnimationFrame(loop);

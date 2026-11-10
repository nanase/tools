/**
 * SPI のページの入口。設定が変わるたびに 1 回の通信を模擬し、その記録を再生位置に合わせて描く。
 * 開いた直後から再生し、終わりで少し止まってから頭へ戻る
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { type Config, DEVS, hex, type Mode, resultOf, type Sim, simulate } from './bus';
import { COL_W, colHeight, drawBus, drawWhole, drawZoom, readCols, sayColor, wholeAt } from './fig';
import { PARAMS, type PKey } from './params';
import { say } from './story';

initToolPage();

const root = $('#spi'),
  cvBus = $<HTMLCanvasElement>('#sp-bus'),
  cvWhole = $<HTMLCanvasElement>('#sp-whole'),
  cvZoom = $<HTMLCanvasElement>('#sp-zoom');

/** 終わりで止まる時間 [s] */
const HOLD = 1.6;
const C: Config = {
  mode: 0,
  order: 'msb',
  f: 1e6,
  len: 0.1,
  conn: 'cs',
  dest: 0,
  both: false,
  data: [0x2a, 0x07, 0x5a],
};
const S = {
  sim: null as Sim | null,
  pt: 0,
  playing: !RM.matches,
  hold: 0,
  rate: 1,
  /** 前後のボタンで止まる時刻（CS とすべてのエッジ） */
  stops: [] as number[],
  dirty: true,
};

const fmtT = (s: number): string => {
  const a = Math.abs(s);
  return a < 1e-6
    ? `${Number((s * 1e9).toFixed(1))} ns`
    : a < 1e-3
      ? `${Number((s * 1e6).toPrecision(3))} µs`
      : `${Number((s * 1e3).toPrecision(3))} ms`;
};
const fmtF = (f: number): string =>
  f < 1e6 ? `${Number((f / 1e3).toPrecision(3))} kHz` : `${Number((f / 1e6).toPrecision(3))} MHz`;
const html = (id: string, h: string) => {
  const n = $(id);
  if (n.innerHTML !== h) n.innerHTML = h;
};
const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};

/* ---------- 模擬と結果 ---------- */
let queued = false;
/** 設定が変わったら、同じフレームの変更をまとめて 1 回だけ模擬する */
function recompute(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const s = simulate(C);
    S.sim = s;
    S.stops = [s.tCs, ...s.edges.map((e) => e.t), s.tUp];
    if (S.pt > s.dur) S.pt = 0;
    showResult(s);
    S.dirty = true;
  });
}
const RES = {
  ok: '成功',
  both: '衝突 ― 2 台が MISO に出力',
  mode: 'モードの不一致',
  late: 'MISO の遅れで読み違い',
  order: 'ビットの順の不一致',
  bad: '読み違い',
} as const;
const mark = (ok: boolean) => `<span class="sp-mk-${ok ? 'ok' : 'ng'}" aria-hidden="true">${ok ? '✓' : '✗'}</span>`;
function showResult(s: Sim): void {
  const r = resultOf(s),
    ok = r === 'ok';
  html('#o-res', `${mark(ok)}<span class="${ok ? 'sp-ok' : 'sp-ng'}">${RES[r]}</span>`);
  const wM = s.want.get(0) ?? [];
  html(
    '#o-gm',
    `<span class="${s.errM ? 'sp-ng' : ''}">${s.devs[0].got.map(hex).join(' ')}</span><small>正しくは ${wM.map(hex).join(' ')}</small>`,
  );
  const gs = s.chain ? [3, 2, 1].map((i) => s.devs[i].got.at(-1) ?? 0) : s.devs[s.sel[0] + 1].got,
    ws = s.chain ? s.c.data.slice(0, 3) : s.c.data.slice(0, 2);
  html(
    '#o-gs',
    `<span class="${s.errS ? 'sp-ng' : ''}">${gs.map(hex).join(' ')}</span><small>${s.chain ? 'LED 3・2・1、' : ''}正しくは ${ws.map(hex).join(' ')}</small>`,
  );
  html(
    '#o-mg',
    `<span class="${s.margin < 0 ? 'sp-ng' : s.margin < 5e-9 ? 'sp-wn' : ''}">${fmtT(s.margin)}</span><small>往復 ${fmtT(s.rt)}・半周期 ${fmtT(s.h)}</small>`,
  );
  html('#o-dur', `${fmtT(s.tUp - s.tCs)}<small>${s.nb * 8} クロック・${fmtF(C.f)}</small>`);
  params.note('f', `半周期 ${fmtT(s.h)}`);
  params.note('len', `片道 ${fmtT(s.d)}`);
}

/* ---------- 入力 ---------- */
const params = new ParamGroup<PKey>(PARAMS, (v) => {
  C.data = [v.d0, v.d1, v.d2];
  C.f = v.f;
  C.len = v.len;
  S.rate = v.rate;
  recompute();
});
const both = $<HTMLButtonElement>('#tg-both');
const syncBoth = () => {
  both.setAttribute('aria-pressed', String(C.both));
  $('.led', both).classList.toggle('on', C.both);
  both.disabled = C.conn === 'chain';
};
const dest = new Choice<string>($('#p-dest'), (v) => {
  C.dest = Math.max(0, Math.min(DEVS.length - 1, Number(v) || 0));
  S.pt = 0;
  recompute();
});
const syncConn = () => {
  const ch = C.conn === 'chain';
  dest.setOff(ch, 'デイジーチェーンでは使いません');
  params.setOff('d2', !ch, '個別の CS では使いません');
  syncBoth();
};
new Choice<string>($('#p-conn'), (v) => {
  C.conn = v === 'chain' ? 'chain' : 'cs';
  syncConn();
  S.pt = 0;
  recompute();
});
new Choice<string>($('#p-mode'), (v) => {
  const m = Number(v);
  C.mode = (m >= 0 && m <= 3 ? m : 0) as Mode;
  recompute();
});
new Choice<string>($('#p-order'), (v) => {
  C.order = v === 'lsb' ? 'lsb' : 'msb';
  recompute();
});
C.both = stored('v:both') === true;
both.addEventListener('click', () => {
  C.both = !C.both;
  if (C.both) store('v:both', true);
  else forget('v:both');
  syncBoth();
  S.pt = 0;
  S.hold = 0;
  recompute();
});
syncConn();

/* ---------- 再生 ---------- */
const pp = $<HTMLButtonElement>('#tp-pp'),
  trk = $('#tp-trk');
function syncPlay(): void {
  pp.classList.toggle('on', S.playing);
  const l = S.playing ? '一時停止' : '再生';
  pp.title = l;
  pp.setAttribute('aria-label', l);
}
function seek(t: number): void {
  if (!S.sim) return;
  S.pt = Math.max(0, Math.min(S.sim.dur, t));
  S.hold = 0;
  S.dirty = true;
}
pp.addEventListener('click', () => {
  S.playing = !S.playing;
  if (S.playing && S.sim && S.pt >= S.sim.dur) seek(0);
  syncPlay();
});
$('#tp-home').addEventListener('click', () => seek(0));
/* 前後のエッジ: CS の上げ下げと SCK のエッジへ */
$('#tp-back').addEventListener('click', () => {
  S.playing = false;
  syncPlay();
  const prev = S.stops.filter((t) => t < S.pt - 1e-12);
  seek(prev.length ? prev[prev.length - 1] : 0);
});
$('#tp-step').addEventListener('click', () => {
  S.playing = false;
  syncPlay();
  seek(S.stops.find((t) => t > S.pt + 1e-12) ?? S.sim?.dur ?? 0);
});
function dragOn(el: HTMLElement, at: (x: number) => number): void {
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    seek(at(e.clientX));
    const move = (m: PointerEvent) => seek(at(m.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}
dragOn(trk, (x) => {
  const r = trk.getBoundingClientRect();
  return Math.max(0, Math.min(1, (x - r.left) / r.width)) * (S.sim?.dur ?? 0);
});
dragOn(cvWhole, (x) => (S.sim ? wholeAt(cvWhole, S.sim, x) : 0));
trk.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!d || !S.sim) return;
  e.preventDefault();
  $<HTMLButtonElement>(d > 0 ? '#tp-step' : '#tp-back').click();
});

/* ---------- 描画 ---------- */
function syncTransport(s: Sim): void {
  const u = s.dur ? S.pt / s.dur : 0,
    pc = `${(u * 100).toFixed(2)}%`;
  $('#tp-fill').style.width = pc;
  $('#tp-th').style.left = pc;
  trk.setAttribute('aria-valuenow', String(Math.round(u * 100)));
  /* 読み取りのエッジを数えたものがクロック数 */
  txt('#tp-a', String(Math.min(s.nb * 8, s.samples.filter((x) => x.i === 0 && x.t <= S.pt).length)));
  txt('#tp-b', String(s.nb * 8));
  txt('#tp-t', `${fmtT(S.pt)} / ${fmtT(s.dur)}`);
  txt('#sp-st', S.playing ? (S.hold > 0 ? '完了' : '再生中') : '一時停止中');
  $('#sp-led').className = `led${S.playing ? (S.hold > 0 ? ' half' : ' on') : ''}`;
}
function draw(s: Sim): void {
  /* 狭い画面では箱を縦に積むので、配線図を高くする */
  const hb = cvBus.getBoundingClientRect().width < COL_W ? `${colHeight(s.chain)}px` : '';
  if (cvBus.style.height !== hb) cvBus.style.height = hb;
  drawBus(cvBus, s, S.pt);
  drawWhole(cvWhole, s, S.pt, cvZoom.getBoundingClientRect().width);
  drawZoom(cvZoom, s, S.pt);
  const n = say(s, S.pt),
    el = $('#sp-say');
  if (el.textContent !== n.t) el.textContent = n.t;
  el.style.color = sayColor(n.w);
  syncTransport(s);
}

const recolor = () => {
  readCols(root);
  S.dirty = true;
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  S.dirty = true;
}).observe(root);

let last = 0;
function loop(now: number): void {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  const s = S.sim;
  if (s) {
    if (S.playing) {
      if (S.hold > 0) {
        S.hold -= dt;
        if (S.hold <= 0) S.pt = 0;
      } else {
        S.pt += dt * S.rate * s.T;
        if (S.pt >= s.dur) {
          S.pt = s.dur;
          S.hold = HOLD;
        }
      }
      S.dirty = true;
    }
    if (S.dirty) {
      S.dirty = false;
      draw(s);
    }
  }
  requestAnimationFrame(loop);
}
recolor();
syncPlay();
recompute();
requestAnimationFrame(loop);

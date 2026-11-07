/**
 * I2C のページの入口。設定が変わるたびに 1 回の通信を模擬し、その記録を再生位置に合わせて描く。
 * 開いた直後から再生し、終わりで少し止まってから頭へ戻る
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { type Config, hex, MODES, type ModeId, type Sim, simulate } from './bus';
import { drawBus, drawWhole, drawZoom, readCols, roleColor, wholeAt } from './fig';
import { PARAMS, type PKey } from './params';
import { say } from './story';

initToolPage();

const root = $('#i2c'),
  cvBus = $<HTMLCanvasElement>('#i2-bus'),
  cvWhole = $<HTMLCanvasElement>('#i2-whole'),
  cvZoom = $<HTMLCanvasElement>('#i2-zoom');

/** 終わりで止まる時間 [s] */
const HOLD = 1.6;
const C: Config = {
  mode: 'sm',
  rp: 4.7e3,
  cb: 100e-12,
  vdd: 3.3,
  op: 'w',
  addr: 0x48,
  data: [0x2a, 0x07],
  stretch: false,
  multi: false,
  sync: true,
};
const S = {
  sim: null as Sim | null,
  /** スレーブが持つ 2 バイト（書き込みが成功すると置き換わる） */
  mem: {} as Record<number, number[]>,
  pt: 0,
  playing: !RM.matches,
  /** 終わりで止まっている残りの時間 [s] */
  hold: 0,
  rate: 2,
  /** SCL の立ち上がりの時刻 */
  clk: [] as number[],
  dirty: true,
};

const fmtT = (s: number): string =>
  s < 1e-6
    ? `${Math.round(s * 1e9)} ns`
    : s < 1e-3
      ? `${Number((s * 1e6).toPrecision(3))} µs`
      : `${Number((s * 1e3).toPrecision(3))} ms`;
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
    const s = simulate(C, S.mem);
    if (C.op === 'w' && s.res === 'ok') S.mem = { ...S.mem, [C.addr]: s.mem[C.addr] };
    S.sim = s;
    S.clk = clocks(s);
    if (S.pt > s.dur) S.pt = 0;
    showResult(s);
    $('#i2-lg-m2').hidden = !C.multi;
    S.dirty = true;
  });
}
/** SCL が VIH を上へ越えた時刻 */
function clocks(s: Sim): number[] {
  const out: number[] = [];
  for (let i = 1; i < s.len; i++) if (s.vScl[i] > s.E.vih && s.vScl[i - 1] <= s.E.vih) out.push(i * s.dt);
  return out;
}
const mark = (ok: boolean) => `<span class="i2-mk-${ok ? 'ok' : 'ng'}" aria-hidden="true">${ok ? '✓' : '✗'}</span>`;
function showResult(s: Sim): void {
  const E = s.E;
  let ok = s.res === 'ok' && s.okData,
    t = ok ? (C.op === 'r' ? `成功 ${s.got.map(hex).join(' ')}` : '成功') : '';
  if (!ok) {
    if (E.vol > E.vil) t = 'Low にならない';
    else if (!s.frames.some((f) => f.k === 'addr')) t = 'ビットを読めない';
    else if (s.res === 'nack') t = 'NACK 応答なし';
    else if (s.res === 'nack-data') t = 'NACK 途中で中断';
    else if (s.res === 'ok') t = '読み違い';
    else t = '終わらない';
    ok = false;
  }
  html('#o-res', `${mark(ok)}<span class="${ok ? 'i2-ok' : 'i2-ng'}">${t}</span>`);
  const trOver = E.tr > E.mode.tr;
  html('#o-tr', `<span class="${trOver ? 'i2-ng' : ''}">${fmtT(E.tr)}</span><small>上限 ${fmtT(E.mode.tr)}</small>`);
  html(
    '#o-vol',
    `<span class="${E.vol > E.vil ? 'i2-ng' : E.vol > 0.4 ? 'i2-wn' : ''}">${E.vol.toFixed(2)} V</span><small>VIL ${E.vil.toFixed(2)} V</small>`,
  );
  const f = 1 / s.period;
  html(
    '#o-clk',
    `<span class="${f < E.mode.f * 0.8 ? 'i2-wn' : ''}">${fmtF(f)}</span><small>設定 ${fmtF(E.mode.f)}</small>`,
  );
  html('#o-dur', fmtT(s.dur));
  const p = params;
  p.note('rp', `推奨 ${fmtR(E.rpMin)}〜${fmtR(E.rpMax)}`, C.rp < E.rpMin || C.rp > E.rpMax ? 'er' : '');
  p.note('cb', `上限 ${Math.round(E.mode.cmax * 1e12)} pF`, C.cb > E.mode.cmax ? 'er' : '');
}
const fmtR = (r: number): string => (r < 1e3 ? `${Math.round(r)} Ω` : `${Number((r / 1e3).toPrecision(3))} kΩ`);

/* ---------- 入力 ---------- */
const params = new ParamGroup<PKey>(PARAMS, (v) => {
  C.rp = v.rp;
  C.cb = v.cb;
  C.data = [v.d0, v.d1];
  S.rate = v.rate;
  recompute();
});
const syncData = () => {
  for (const k of ['d0', 'd1'] as const) params.setOff(k, C.op === 'r', C.op === 'r' ? '読み出しでは使いません' : '');
};
new Choice<string>($('#p-op'), (v) => {
  C.op = v === 'r' ? 'r' : 'w';
  syncData();
  S.pt = 0;
  recompute();
});
new Choice<string>($('#p-addr'), (v) => {
  C.addr = Number(v);
  S.pt = 0;
  recompute();
});
new Choice<string>($('#p-mode'), (v) => {
  C.mode = (v in MODES ? v : 'sm') as ModeId;
  recompute();
});
new Choice<string>($('#p-vdd'), (v) => {
  C.vdd = Number(v) || 3.3;
  recompute();
});
for (const b of $$<HTMLButtonElement>('[data-tg]')) {
  const k = b.dataset.tg === 'multi' ? 'multi' : 'stretch';
  const sync = () => {
    b.setAttribute('aria-pressed', String(C[k]));
    $('.led', b).classList.toggle('on', C[k]);
  };
  C[k] = stored(`v:${k}`) === true;
  sync();
  b.addEventListener('click', () => {
    C[k] = !C[k];
    if (C[k]) store(`v:${k}`, true);
    else forget(`v:${k}`);
    sync();
    S.pt = 0;
    S.hold = 0;
    recompute();
  });
}
syncData();

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
/* 前後のクロック: 今より前・後の SCL の立ち上がりへ */
$('#tp-back').addEventListener('click', () => {
  S.playing = false;
  syncPlay();
  const prev = S.clk.filter((t) => t < S.pt - 1e-12);
  seek(prev.length ? prev[prev.length - 1] : 0);
});
$('#tp-step').addEventListener('click', () => {
  S.playing = false;
  syncPlay();
  const next = S.clk.find((t) => t > S.pt + 1e-12);
  seek(next ?? S.sim?.dur ?? 0);
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
  txt('#tp-a', String(S.clk.filter((t) => t <= S.pt).length));
  txt('#tp-b', String(S.clk.length));
  txt('#tp-t', `${fmtT(S.pt)} / ${fmtT(s.dur)}`);
  const st = S.playing ? (S.hold > 0 ? '完了' : '再生中') : '一時停止中';
  txt('#i2-st', st);
  $('#i2-led').className = `led${S.playing ? (S.hold > 0 ? ' half' : ' on') : ''}`;
}
function draw(s: Sim): void {
  drawBus(cvBus, s, S.pt);
  drawWhole(cvWhole, s, S.pt, cvZoom.getBoundingClientRect().width);
  drawZoom(cvZoom, s, S.pt);
  const n = say(s, S.pt),
    el = $('#i2-say');
  if (el.textContent !== n.t) el.textContent = n.t;
  el.style.color = n.w ? roleColor(n.w) : '';
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

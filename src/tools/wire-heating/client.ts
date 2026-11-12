/**
 * 配線の発熱のページの入口。形（基板・線・経路）ごとに温度の時間変化を計算し、再生位置に合わせて描く。
 * 線と経路は主スレッドで一度に解き、基板はワーカーで解きながら届いた分から再生する
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { BD, type Pattern, T_CAP } from './board';
import {
  type BoardRec,
  boardCell,
  type Ctx,
  drawAir,
  drawBal,
  drawBoard,
  drawBprof,
  drawPath,
  drawProf,
  drawTime,
  drawWire,
  drawXs,
  fmtC,
  jMax,
  lenText,
  type Particle,
  pathCoord,
  readCols,
  type TMap,
  timeAt,
  tOf,
  uOf,
  type WireOpt,
} from './fig';
import { PARAMS, PATH_H, type PKey, PRESET } from './params';
import { type WireSim, wireSim } from './sim';
import { type MatId, PVC, pathOf, type SurfId, type WireIn } from './wire';
import type { BoardChunk, BoardReq } from './worker';

initToolPage();

type Form = 'board' | 'line' | 'path';
const root = $('#wh'),
  cv = {
    board: $<HTMLCanvasElement>('#cv-board'),
    wire: $<HTMLCanvasElement>('#cv-wire'),
    path: $<HTMLCanvasElement>('#cv-path'),
    air: $<HTMLCanvasElement>('#cv-air'),
    prof: $<HTMLCanvasElement>('#cv-prof'),
    time: $<HTMLCanvasElement>('#cv-time'),
    xs: $<HTMLCanvasElement>('#cv-xs'),
    bal: $<HTMLCanvasElement>('#cv-bal'),
  };

/** 記録の全体を何秒で再生するか（速さ 1 倍） */
const PLAY_S = 16;
const C = {
  form: 'board' as Form,
  mat: 'cu' as MatId,
  shape: 'round' as 'round' | 'rect',
  surf: 'oxid' as SurfId,
  ends: 'sink' as 'sink' | 'free',
  ac: 'dc',
  mode: 'cont' as 'cont' | 'pulse',
  kind: 'neck' as Pattern,
  view: 'T' as 'T' | 'J',
  scale: 'all' as 'all' | 'now',
  /** 時間の変化のグラフの横軸 */
  taxis: 'log' as 'log' | 'lin',
  air: true,
  ctrl: PRESET.zig.map((p) => [...p]) as [number, number][],
};
const S = {
  wire: null as WireSim | null,
  board: null as BoardRec | null,
  pt: 0,
  playing: !RM.matches,
  rate: 1,
  drag: null as { k: number; path: ReturnType<typeof pathOf> } | null,
  hover: null as [number, number] | null,
  dirty: true,
};
const parts = { wire: [] as Particle[], air: [] as Particle[], path: [] as Particle[] };

const fmtT = (s: number): string =>
  s < 1e-3
    ? `${Number((s * 1e6).toPrecision(2))} µs`
    : s < 1
      ? `${Number((s * 1e3).toPrecision(3))} ms`
      : s < 120
        ? `${Number(s.toPrecision(3))} s`
        : `${Number((s / 60).toPrecision(3))} 分`;
const fmtR = (r: number): string =>
  r < 1e-3
    ? `${Number((r * 1e6).toPrecision(3))} µΩ`
    : r < 1
      ? `${Number((r * 1e3).toPrecision(3))} mΩ`
      : `${Number(r.toPrecision(3))} Ω`;
const fmtV = (v: number): string =>
  v < 1 ? `${Number((v * 1e3).toPrecision(3))} mV` : `${Number(v.toPrecision(3))} V`;
const fmtP = (p: number): string =>
  p < 1 ? `${Number((p * 1e3).toPrecision(3))} mW` : `${Number(p.toPrecision(3))} W`;
const fmtA = (a: number): string => `${Number(a.toPrecision(3))} A`;
const html = (el: HTMLElement, h: string) => {
  if (el.innerHTML !== h) el.innerHTML = h;
};
const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};

/* ---------- 計算 ---------- */
/** 解き直しの予約と、前回解いた設定 */
let queued = false,
  lastKey = '';
const params = new ParamGroup<PKey>(PARAMS, (v) => {
  S.rate = v.rate;
  queue();
});
const val = (k: PKey) => params.get(k);
function wireIn(): WireIn {
  const o: WireIn = {
    mat: C.mat,
    shape: C.shape,
    d: val('d') * 1e-3,
    w: val('w') * 1e-3,
    t: val('t') * 1e-3,
    len: val('len'),
    surf: C.surf,
    ends: C.ends,
    I: val('I'),
    f: C.ac === 'ac' ? val('f') : 0,
    mode: C.mode,
    tp: val('tp'),
    span: val('span'),
    Ta: val('Ta'),
    wind: val('wind'),
  };
  if (C.form === 'path')
    o.path = pathOf(
      C.ctrl.map(([x, y]) => [x * val('scale'), y * val('scale')] as [number, number]),
      120,
    );
  return o;
}

let worker: Worker | null = null,
  reqId = 0;
function startBoard(): void {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<BoardChunk>) => {
    const c = e.data;
    if (c.id !== reqId) return;
    if (c.cu && c.idx)
      S.board = {
        times: [],
        frames: [],
        R: [],
        Ion: [],
        maxT: [],
        bal: [],
        cu: c.cu,
        idx: c.idx,
        cutAt: c.cutAt,
        tOpen: null,
        tOff: null,
        V: c.V,
        sq: c.sq,
        tEff: c.tEff,
        dl: c.dl,
        t: 0,
        done: false,
      };
    const b = S.board;
    if (!b) return;
    b.times.push(...c.times);
    b.frames.push(...c.frames);
    b.R.push(...c.R);
    b.Ion.push(...c.Ion);
    b.maxT.push(...c.maxT);
    b.cutAt = c.cutAt;
    b.tOpen = c.tOpen;
    b.tOff = c.tOff;
    b.bal.push(...c.bal);
    b.V = c.V;
    b.sq = c.sq;
    b.t = c.t;
    b.done = c.done;
    $('#bd-busy').hidden = c.done;
    showResult();
    S.dirty = true;
  };
  reqId++;
  const msg: BoardReq = {
    id: reqId,
    cfg: {
      kind: C.kind,
      w: val('bw'),
      tcu: val('tcu') * 1e-6,
      tb: val('tb') * 1e-3,
      Ta: val('Ta'),
      I: val('bI'),
      f: C.ac === 'ac' ? val('f') : 0,
      mode: C.mode,
      tp: val('tp'),
      span: val('span'),
    },
  };
  S.board = null;
  $('#bd-busy').hidden = false;
  worker.postMessage(msg);
}

/** 計算に効く設定（変わったときだけ解き直す） */
const keyOf = () =>
  C.form === 'board'
    ? JSON.stringify([
        'b',
        C.kind,
        C.ac,
        C.mode,
        ...(['bw', 'tcu', 'tb', 'bI', 'f', 'tp', 'span', 'Ta'] as PKey[]).map(val),
      ])
    : JSON.stringify([
        C.form,
        C.mat,
        C.shape,
        C.surf,
        C.ends,
        C.ac,
        C.mode,
        C.form === 'path' ? C.ctrl : 0,
        ...(['d', 'w', 't', 'len', 'scale', 'I', 'f', 'tp', 'span', 'Ta', 'wind'] as PKey[]).map(val),
      ]);
/** 同じフレームの変更をまとめて 1 回だけ解く */
function queue(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    syncRows();
    const k = keyOf();
    if (k !== lastKey) {
      lastKey = k;
      S.pt = 0;
      if (C.form === 'board') {
        S.wire = null;
        startBoard();
      } else {
        S.wire = wireSim(wireIn());
        showResult();
      }
    }
    S.dirty = true;
  });
}

/* ---------- 入力 ---------- */
function syncRows(): void {
  params.setOff('d', C.shape !== 'round', '角線では使いません');
  params.setOff('w', C.shape !== 'rect', '丸線では使いません');
  params.setOff('t', C.shape !== 'rect', '丸線では使いません');
  params.setOff('f', C.ac !== 'ac', '直流では使いません');
  params.setOff('tp', C.mode !== 'pulse', '連続では使いません');
}
const form = new Choice<Form>($('#wh-form'), (v) => {
  C.form = v;
  root.dataset.form = v;
  lastKey = '';
  queue();
});
new Choice<'log' | 'lin'>($('#wh-taxis'), (v) => {
  C.taxis = v;
  S.dirty = true;
});
new Choice<'all' | 'now'>($('#wh-scale'), (v) => {
  C.scale = v;
  S.dirty = true;
});
new Choice<'T' | 'J'>($('#wh-view'), (v) => {
  C.view = v;
  S.dirty = true;
});
new Choice<MatId>($('#p-mat'), (v) => {
  C.mat = v;
  queue();
});
new Choice<'round' | 'rect'>($('#p-shape'), (v) => {
  C.shape = v;
  queue();
});
new Choice<SurfId>($('#p-surf'), (v) => {
  C.surf = v;
  queue();
});
new Choice<'sink' | 'free'>($('#p-ends'), (v) => {
  C.ends = v;
  queue();
});
new Choice<string>($('#p-ac'), (v) => {
  C.ac = v;
  queue();
});
new Choice<'cont' | 'pulse'>($('#p-mode'), (v) => {
  C.mode = v;
  queue();
});
new Choice<Pattern>($('#p-kind'), (v) => {
  C.kind = v;
  queue();
});
const preset = new Choice<string>($('#wh-preset'), (v) => {
  C.ctrl = (PRESET[v] ?? PRESET.zig).map((p) => [...p]) as [number, number][];
  queue();
});
const airBtn = $<HTMLButtonElement>('#tg-air');
airBtn.addEventListener('click', () => {
  C.air = !C.air;
  airBtn.setAttribute('aria-pressed', String(C.air));
  $('.led', airBtn).classList.toggle('on', C.air);
  S.dirty = true;
});
C.form = form.value;
root.dataset.form = C.form;

/* 経路の点のドラッグ。離したときに解き直す */
cv.path.addEventListener('pointerdown', (e) => {
  const [px, py] = pathCoord(cv.path, e.clientX, e.clientY),
    r = cv.path.getBoundingClientRect(),
    tol = 14 / Math.min(r.width - 40, (r.height - 28) / PATH_H);
  let best = -1,
    bd = tol;
  C.ctrl.forEach(([x, y], k) => {
    const d = Math.hypot(x - px, y - py);
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  if (best < 0) return;
  cv.path.setPointerCapture(e.pointerId);
  cv.path.classList.add('on');
  const move = (m: PointerEvent) => {
    const [x, y] = pathCoord(cv.path, m.clientX, m.clientY);
    C.ctrl[best] = [Math.max(0.01, Math.min(0.99, x)), Math.max(0.01, Math.min(PATH_H - 0.01, y))];
    S.drag = { k: best, path: pathOf(C.ctrl, 120) };
    S.dirty = true;
  };
  const up = () => {
    cv.path.removeEventListener('pointermove', move);
    cv.path.removeEventListener('pointerup', up);
    cv.path.removeEventListener('pointercancel', up);
    cv.path.classList.remove('on');
    S.drag = null;
    preset.set('');
    queue();
  };
  move(e);
  cv.path.addEventListener('pointermove', move);
  cv.path.addEventListener('pointerup', up);
  cv.path.addEventListener('pointercancel', up);
});
cv.board.addEventListener('pointermove', (e) => {
  S.hover = boardCell(cv.board, e.clientX, e.clientY);
  S.dirty = true;
});
cv.board.addEventListener('pointerleave', () => {
  S.hover = null;
  S.dirty = true;
});

/* ---------- 記録と時刻 ---------- */
interface Rec {
  times: number[];
  frames: Float32Array[];
}
const rec = (): Rec | null => (C.form === 'board' ? S.board : S.wire);
/** 再生できる最後の時刻と、目盛りに使う全体の時刻 */
const tAvail = (): number => {
  const r = rec();
  return r?.times.length ? r.times[r.times.length - 1] : 0;
};
const tEnd = (): number =>
  C.form === 'board'
    ? S.board?.done
      ? S.board.t
      : Math.max(S.board?.t ?? 0, val('span') > 0 ? val('span') : T_CAP / 3)
    : tAvail();
/** グラフの時間軸（対数か線形） */
const gmap = (): TMap => ({ ...tmap(), lin: C.taxis === 'lin' });
/**
 * 時間軸。t0 は等間隔から対数へ移る時刻で、溶断・パルス・時定数のうち早いものの 1/20。
 * 基板は銅箔が温まる 0.5 秒前後を目安にする
 */
function tmap(): TMap {
  const te = Math.max(1e-3, tEnd());
  if (C.form === 'board') {
    const b = S.board,
      ev = Math.min(
        b?.tOpen ?? Number.POSITIVE_INFINITY,
        C.mode === 'pulse' ? val('tp') : Number.POSITIVE_INFINITY,
        10,
      );
    return { t0: Math.max(1e-3, ev / 20), te };
  }
  const w = S.wire,
    ev = Math.min(
      w?.tau ?? 1,
      w?.tMelt ?? Number.POSITIVE_INFINITY,
      C.mode === 'pulse' ? val('tp') : Number.POSITIVE_INFINITY,
    );
  return { t0: Math.max(1e-4, ev / 20), te };
}
/** 時刻 t の温度の列（前後の 2 枚を補間）と、近い記録の番号 */
function frameAt(r: Rec, t: number): { T: Float32Array; i: number } {
  const ts = r.times;
  let lo = 0,
    hi = ts.length - 1;
  if (t >= ts[hi]) return { T: r.frames[hi], i: hi };
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= t) lo = m;
    else hi = m;
  }
  const u = (t - ts[lo]) / (ts[hi] - ts[lo] || 1),
    A = r.frames[lo],
    B = r.frames[hi],
    T = new Float32Array(A.length);
  for (let k = 0; k < A.length; k++) T[k] = A[k] + (B[k] - A[k]) * u;
  return { T, i: u < 0.5 ? lo : hi };
}
/** 色の目盛りの上限（記録の最高に合わせる） */
function scaleTop(T: ArrayLike<number>, all = false): number {
  const Ta = val('Ta');
  /* 「今の最高」では今の時刻の最高に合わせる（冷えていく熱の広がりを見るため） */
  if (C.scale === 'now' && !all) return Math.max(Ta + 5, maxOf(T));
  if (C.form === 'board') return Math.max(Ta + 20, ...(S.board?.maxT ?? [Ta]));
  let m = Ta + 20;
  for (const f of S.wire?.frames ?? []) for (const v of f) if (v > m) m = v;
  return m;
}
const meanOf = (T: ArrayLike<number>): number => {
  let m = 0;
  for (let k = 0; k < T.length; k++) m += T[k];
  return m / T.length;
};
const maxOf = (T: ArrayLike<number>, idx?: Int32Array): number => {
  let m = Number.NEGATIVE_INFINITY;
  if (idx) for (const k of idx) m = Math.max(m, T[k]);
  else for (let k = 0; k < T.length; k++) m = Math.max(m, T[k]);
  return m;
};
/** 今の時刻に流れている電流（パルスの後と溶断の後は 0） */
const curI = (): number =>
  (C.mode === 'pulse' && S.pt >= val('tp')) || (S.wire?.tMelt != null && S.pt >= S.wire.tMelt) ? 0 : val('I');

/* ---------- 結果 ---------- */
const resEl = $('#wh-res');
const m = (dt: string, dd: string) => `<div class="m"><dt>${dt}</dt><dd>${dd}</dd></div>`;
function showResult(T?: Float32Array, i = 0): void {
  if (C.form !== 'board' && S.wire) {
    const s = S.wire,
      fr = T ?? s.frames[s.frames.length - 1],
      mx = maxOf(fr),
      I = T ? curI() : val('I'),
      R = s.R(fr),
      broken = !!T && s.tMelt !== null && S.pt >= s.tMelt,
      over = C.surf === 'pvc' && mx > PVC.lim;
    const fin =
      s.tMelt !== null
        ? `<span class="ng">${fmtT(s.tMelt)} で溶断</span>`
        : s.Tss === null
          ? '<span class="ng">溶断</span>'
          : fmtC(s.Tss);
    html(
      resEl,
      m(
        '最高温度',
        `<span class="${mx >= s.m.mp || over ? 'ng' : ''}">${fmtC(mx)}</span><small>上昇 ${(mx - s.Ta).toFixed(1)} K${over ? '・被覆の耐熱を超過' : ''}</small>`,
      ) +
        m(
          C.mode === 'pulse' ? '連続なら' : C.form === 'path' ? 'まっすぐなら' : '行き着く温度',
          `${fin}<small>長い線の中ほど</small>`,
        ) +
        m(
          '抵抗',
          `${broken ? '<span class="ng">断線</span>' : fmtR(R)}<small>20 °C で ${fmtR((s.m.rho * s.ac20 * s.len) / s.g.A)}${s.ac20 > 1.005 ? `・交流 ×${s.ac20.toFixed(2)}` : ''}</small>`,
        ) +
        m('電圧降下・発熱', I > 0 ? `${fmtV(I * R)}<small>${fmtP(I * I * R)}</small>` : '0<small>電流なし</small>') +
        m('温度上昇 30 K の電流', `${fmtA(s.I30)}<small>溶断は ${fmtA(s.Imelt)}</small>`) +
        m('時定数', `${fmtT(s.tau)}<small>63 % に届くまで</small>`),
    );
    params.note('d', `断面積 ${Number((s.g.A * 1e6).toPrecision(3))} mm²`);
    params.note('I', `電流密度 ${Number((val('I') / (s.g.A * 1e6)).toPrecision(3))} A/mm²`);
    params.note('f', C.ac === 'ac' ? `表皮の深さ ${lenText(s.delta)}` : '');
    params.note('scale', C.form === 'path' ? `経路の長さ ${lenText(s.len)}` : '');
  } else if (C.form === 'board' && S.board && S.board.times.length) {
    const b = S.board,
      fr = T ?? b.frames[b.frames.length - 1],
      mx = maxOf(fr, b.idx),
      j = Math.min(T ? i : b.R.length - 1, b.R.length - 1),
      R = b.R[j],
      I = b.Ion[j] ?? val('bI'),
      open = b.tOpen !== null && (T ? S.pt >= b.tOpen : true);
    html(
      resEl,
      m(
        '最高温度',
        `<span class="${mx >= BD.tg ? 'ng' : ''}">${fmtC(mx)}</span><small>上昇 ${(mx - val('Ta')).toFixed(1)} K${mx >= BD.tg ? `・Tg ${BD.tg} °C を超過` : ''}</small>`,
      ) +
        m('抵抗', `${open ? '<span class="ng">断線</span>' : fmtR(R)}<small>パッドの間</small>`) +
        m('電圧降下・発熱', I > 0 ? `${fmtV(I * R)}<small>${fmtP(I * I * R)}</small>` : '0<small>電流なし</small>') +
        m(
          '最大の電流密度',
          `${I > 0 ? `${Number((jMax(b, I) * 1e-6).toPrecision(3))} A/mm²` : '0'}<small>平均 ${Number((val('bI') / (val('bw') * val('tcu') * 1e-3)).toPrecision(3))} A/mm²</small>`,
        ) +
        /* 線の形と同じ 6 項目にそろえ、形を切り替えても枠の高さを変えない */
        m('基板の平均温度', `${fmtC(meanOf(fr))}<small>30 × 18 mm 全体</small>`) +
        m(
          '溶断',
          b.tOpen !== null
            ? `<span class="ng">${fmtT(b.tOpen)}</span><small>パッドの間が切れた時刻</small>`
            : `なし<small>${b.done ? '融点 1085 °C に届かない' : '計算中'}</small>`,
        ),
    );
    params.note('f', C.ac === 'ac' ? `表皮の深さ ${lenText(b.dl)}` : '');
  }
  params.note('bI', `電流密度 ${Number((val('bI') / (val('bw') * val('tcu') * 1e-3)).toPrecision(3))} A/mm²`);
  params.note('tcu', `${Number((val('tcu') / 35).toPrecision(2))} oz`);
}

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
  S.pt = Math.max(0, Math.min(tAvail(), t));
  S.dirty = true;
}
/** 記録の最後にいるか */
const atLast = (): boolean => (C.form !== 'board' || !!S.board?.done) && S.pt >= tAvail() - 1e-9;
pp.addEventListener('click', () => {
  S.playing = !S.playing;
  if (S.playing && S.pt >= tAvail() - 1e-12) seek(0);
  syncPlay();
});
$('#tp-home').addEventListener('click', () => seek(0));
function dragOn(el: HTMLElement, at: (x: number) => number): void {
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    seek(at(e.clientX));
    const move = (mv: PointerEvent) => seek(at(mv.clientX));
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
  return tOf(tmap(), (x - r.left) / r.width);
});
dragOn(cv.time, (x) => timeAt(cv.time, x, gmap()));
trk.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  const tm = tmap();
  seek(tOf(tm, uOf(tm, S.pt) + d * 0.02));
});

/* ---------- 描画 ---------- */
/** 図の下の一言 */
function narr(T: Float32Array, i: number): [string, boolean] {
  if (C.form !== 'board' && S.wire) {
    const s = S.wire,
      mx = maxOf(T);
    if (s.tMelt !== null && S.pt >= s.tMelt)
      return [`${fmtT(s.tMelt)} で溶断・電流が止まり冷却中・最高 ${fmtC(mx)}`, true];
    if (C.mode === 'pulse' && S.pt >= val('tp')) return [`パルスのあと冷却中・最高 ${fmtC(mx)}`, false];
    const b = s.bal[i],
      out = b.conv + b.rad + b.term;
    const big = (
      [
        ['対流', b.conv],
        ['放射', b.rad],
        ['端子', b.term],
      ] as const
    ).reduce((p, q) => (q[1] > p[1] ? q : p));
    return [
      b.gen > 0 && out < 0.9 * b.gen
        ? `加熱中・発熱の ${Math.round((1 - out / b.gen) * 100)} % が温度上昇へ`
        : `ほぼ定常・放熱の多くは${big[0]}`,
      false,
    ];
  }
  const b = S.board;
  if (!b) return ['', false];
  const mx = maxOf(T);
  if (b.tOpen !== null && S.pt >= b.tOpen)
    return [`${fmtT(b.tOpen)} で溶断・電流が止まり冷却中・最高 ${fmtC(mx)}`, true];
  if (C.mode === 'pulse' && S.pt >= val('tp')) return [`パルスのあと冷却中・最高 ${fmtC(mx)}`, false];
  if (!b.done && S.pt >= b.t - 1e-9) return ['計算中', false];
  return mx >= BD.tg
    ? [`Tg ${BD.tg} °C を超過`, true]
    : [`最高 ${fmtC(mx)}・上昇 ${(mx - val('Ta')).toFixed(1)} K`, false];
}
let dtFrame = 0.016;
function draw(): void {
  const r = rec();
  if (S.drag) {
    drawPath(
      cv.path,
      null,
      null,
      { d: val('d'), ends: C.ends, scale: val('scale'), air: false },
      C.ctrl,
      S.drag,
      parts.path,
    );
    return;
  }
  if (!r?.times.length) return;
  const { T, i } = frameAt(r, Math.min(S.pt, tAvail())),
    Ta = val('Ta');
  const c: Ctx = {
    Ta,
    top: scaleTop(T),
    topAll: scaleTop(T, true),
    pt: S.pt,
    tm: tmap(),
    gm: gmap(),
    T,
    i,
    limits:
      C.form === 'board'
        ? [[BD.tg, 'Tg']]
        : [
            [S.wire?.m.mp ?? 1085, '融点'],
            ...(C.surf === 'pvc' ? ([[PVC.lim, '被覆の耐熱']] as [number, string][]) : []),
          ],
    dt: dtFrame,
  };
  if (C.form === 'board' && S.board) {
    const b = S.board;
    drawBoard(cv.board, b, c, b.Ion[i] ?? 0, C.view, S.hover);
    drawBprof(cv.prof, b, c);
    drawTime(cv.time, c, b.times, b.frames, b.idx, b.tOff, b.tOpen);
  } else if (S.wire) {
    const s = S.wire,
      o: WireOpt = {
        shape: C.shape,
        d: val('d'),
        t: val('t'),
        surf: C.surf,
        ends: C.ends,
        I: curI(),
        f: C.ac === 'ac' ? val('f') : 0,
        wind: val('wind'),
      };
    if (C.form === 'line') {
      drawWire(cv.wire, s, c, o, parts.wire);
      drawAir(cv.air, s, c, o, parts.air);
    } else
      drawPath(cv.path, s, c, { d: val('d'), ends: C.ends, scale: val('scale'), air: C.air }, C.ctrl, null, parts.path);
    const cm = s.len < 1,
      xs = Array.from({ length: s.N }, (_, k) => ((k + 0.5) / s.N) * s.len * (cm ? 100 : 1));
    drawProf(cv.prof, c, xs, cm ? 'cm' : 'm');
    drawTime(cv.time, c, s.times, s.frames, null, s.tOff, s.tMelt);
    drawXs(cv.xs, s, c, o);
    drawBal(cv.bal, s.bal[i]);
  }
  const [t, ng] = narr(T, i),
    say = $('#wh-say');
  if (say.textContent !== t) say.textContent = t;
  say.classList.toggle('ng', ng);
  const te = tEnd(),
    u = Math.min(1, uOf(c.tm, S.pt)),
    pc = `${(u * 100).toFixed(2)}%`;
  $('#tp-fill').style.width = pc;
  $('#tp-th').style.left = pc;
  trk.setAttribute('aria-valuenow', String(Math.round(u * 100)));
  txt('#tp-a', fmtT(S.pt));
  txt('#tp-b', C.form === 'board' && !S.board?.done ? '' : `全 ${fmtT(te)}`);
  const atEnd = !S.playing && atLast();
  txt('#wh-st', S.playing ? '再生中' : atEnd ? '終了' : '一時停止中');
  $('#wh-led').className = `led${S.playing ? ' on' : atEnd ? ' half' : ''}`;
  showResult(T, i);
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
  dtFrame = RM.matches ? 0 : dt;
  if (S.playing) {
    const tm = tmap(),
      lim = tAvail();
    /* 時間軸の上を一定の速さで進む（対数に近いので、速い出来事はゆっくり、長い冷却は速く） */
    const u = uOf(tm, S.pt) + (dt * S.rate) / PLAY_S;
    S.pt = tOf(tm, u);
    /* 目盛りの端（u = 1）は丸めで最後の時刻に少し届かないことがあるので、u でも見る */
    if (u >= 1 || S.pt >= lim - 1e-9) {
      S.pt = lim;
      /* 最後まで来たら止める（頭へは戻さない。計算中なら届くのを待つ） */
      if (C.form !== 'board' || S.board?.done) {
        S.playing = false;
        syncPlay();
      }
    }
    S.dirty = true;
  }
  /* 空気の粒は止めている間も動かす（線と経路で空気を出しているとき） */
  if (C.form === 'line' || (C.form === 'path' && C.air)) S.dirty = true;
  if (S.dirty) {
    S.dirty = false;
    draw();
  }
  requestAnimationFrame(loop);
}
recolor();
syncPlay();
queue();
requestAnimationFrame(loop);

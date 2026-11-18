/**
 * 川の枠: 計算（100 s のステップ応答を前もって計算して再生する）とライブ（止まらずに続く計算に手を出す）の 2 つのモード。
 * 川の図・2 枚の表示窓・計算結果に出す。ブイの位置は入力の目標位置 r と同じ値（onTarget で入力へ戻す）
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, fmtR, plain, ro } from '../../lib/format';
import { RM } from '../../lib/motion';
import { DV, SW } from '../../lib/scope';
import { storeToggle } from '../../lib/store';
import {
  Boat,
  DT,
  type EvKind,
  HOLD,
  type In,
  Meter,
  type Metrics,
  metrics,
  N,
  type Rec,
  ROWS,
  record,
  vscale,
} from './model';
import { type Arrow, FOAM_LIFE, type Foam, RiverFig, viewOf } from './river';

/** ライブの表示窓の長さ（60 s ぶんのステップ数） */
export const LEN = 600;
/** 押す強さ [m/s] */
export const PUSH = 2;
/** 目標位置の入力の範囲 [m] */
const R_LIM = 100;
/** 計算のモードの長さ [s] */
const T_PLAN = (N - 1) * DT;
const PH = ROWS * DV;
const DASH = '—';

type Mode = 'plan' | 'live';
/** 操作量の内訳の表示窓と矢印に出すもの */
const COMPS = ['p', 'i', 'd', 'u', 't'] as const;
type Comp = (typeof COMPS)[number];

/** 表示窓に描く値の列 */
interface Src {
  len: number;
  at(j: number): number;
}

/** 古い方から並ぶ固定長の記録 */
class Ring implements Src {
  readonly b = new Float64Array(LEN);
  i = 0;
  len = 0;
  push(v: number): void {
    this.b[this.i] = v;
    this.i = (this.i + 1) % LEN;
    if (this.len < LEN) this.len++;
  }
  at(j: number): number {
    return this.b[(this.i - this.len + j + LEN) % LEN];
  }
  clear(): void {
    this.i = this.len = 0;
  }
}

const arr = (a: ArrayLike<number>, len: number): Src => ({ len, at: (j) => a[j] });
const fill = (v: number, len: number): Src => ({ len, at: () => v });

type Scale = { vd: number; k: number };

/** 縦軸。今の目盛りに収まり、細かすぎもしないなら変えない（ちらつきを抑える） */
function keepScale(cur: Scale | undefined, lo: number, hi: number, fb: number): Scale {
  const nw = vscale(lo, hi, fb, ROWS);
  if (!cur) return nw;
  const tol = cur.vd * 0.1,
    bot = -cur.k * cur.vd,
    top = (ROWS - cur.k) * cur.vd;
  return lo >= bot - tol && hi <= top + tol && cur.vd <= nw.vd * 2.5 ? cur : nw;
}

/** 列の最小・最大（数でない値と ±10⁶ の外は除く） */
function range(srcs: Src[]): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const r of srcs)
    for (let j = 0; j < r.len; j++) {
      const v = r.at(j);
      if (Math.abs(v) <= 1e6) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  return hi >= lo ? [lo, hi] : [0, 0];
}

/** 跳ねを除いた振れ幅（絶対値の 97 パーセンタイルの 1.3 倍） */
function robustMax(srcs: Src[]): number {
  const a: number[] = [];
  for (const r of srcs) for (let j = 0; j < r.len; j++) a.push(Math.abs(r.at(j)));
  if (!a.length) return 0;
  a.sort((p, q) => p - q);
  return Math.min(a[Math.min(a.length - 1, Math.floor(a.length * 0.97))] * 1.3, 1e6);
}

const txt = (sel: string, s: string) => {
  const el = $(sel);
  if (el.textContent !== s) el.textContent = s;
};
const html = (sel: string, s: string) => {
  const el = $(sel);
  if (el.innerHTML !== s) el.innerHTML = s;
};
const signed = (v: number, d: number) => {
  const s = Math.abs(v).toFixed(d);
  return Number(s) === 0 ? s : `${v < 0 ? '−' : ''}${s}`;
};
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** 列の時刻 t [s] の値（ステップの間を補う） */
const atT = (a: ArrayLike<number>, n: number, t: number) => {
  const f = Math.max(0, Math.min(n - 1, t / DT)),
    i = Math.floor(f),
    j = Math.min(n - 1, i + 1);
  return lerp(a[i], a[j], f - i);
};
const pct = (os: number) =>
  `${os >= 1e5 ? os.toExponential(2).replace('e+', 'e') : os.toFixed(1)}<span class="u">%</span>`;

const EV: Record<EvKind, string> = {
  start: '最初から',
  target: '目標を変えてから',
  push: '押してから',
  pid: 'PID を入れてから',
};

/** 直前のステップの値（描くときに今のステップとの間を補う） */
interface Snap {
  x: number;
  t: number;
  up: number;
  ui: number;
  ud: number;
  th: number;
}

export class Live {
  private readonly boat: Boat;
  private readonly fig: RiverFig;
  private readonly cv: HTMLCanvasElement;
  private readonly meter = new Meter();
  private readonly mode: Choice<Mode>;
  private readonly spd: Choice<string>;
  /** 入力の値 */
  private inp: In;
  private view = { lo: 0, hi: 1 };
  /* 計算のモード: 100 s の記録・指標・再生の時刻 */
  private rec: Rec;
  private met: Metrics;
  private pt = 0;
  /* ライブ */
  private foam: Foam[] = [];
  private prev: Snap = { x: 0, t: 0, up: 0, ui: 0, ud: 0, th: 0 };
  private readonly rx = new Ring();
  private readonly rr = new Ring();
  private readonly rv = new Ring();
  private readonly rw = new Ring();
  private readonly rp = new Ring();
  private readonly ri = new Ring();
  private readonly rd = new Ring();
  private readonly ru = new Ring();
  private readonly rt = new Ring();
  private sx?: Scale;
  private sv?: Scale;
  private su?: Scale;
  private running = false;
  private shown = true;
  private raf = 0;
  private last = 0;
  private acc = 0;
  /** つかんでいるブイの位置（離すまで入力へ戻さない） */
  private dragR: number | null = null;
  private hot = false;
  private div = false;
  /** 表示窓を描き直す必要（ステップが進んだ・表示を変えた） */
  private dirty = true;
  private lastOut = 0;
  /** 内訳の表示窓と矢印に出すもの */
  private readonly on = new Set<Comp>();

  /** ブイを動かし終えたとき（入力の目標位置へ戻す） */
  onTarget: (r: number) => void = () => {};
  /** 計算結果が変わったとき（上部の要約のバー） */
  onMeas: (ts: string, os: string, e: string) => void = () => {};

  constructor(p: In) {
    this.inp = p;
    this.cv = $<HTMLCanvasElement>('#rv');
    this.fig = new RiverFig(this.cv);
    this.boat = new Boat({ ...p });
    this.rec = record(p);
    this.met = metrics(this.rec, p.x0, p.r);
    this.spd = new Choice<string>($('#p-rspd'));
    this.mode = new Choice<Mode>($('#p-mode'), () => this.enter());
    this.bind();
    this.enter();
  }

  private get plan(): boolean {
    return this.mode.value === 'plan';
  }

  /** 入力が変わったとき */
  update(p: In, k?: string): void {
    this.inp = p;
    if (this.plan) {
      this.recompute();
      /* 出発・目標・初速が変わったら頭から再生する。ゲインなどは同じ時刻のまま新しい結果へ */
      if (!k || k === 'x0' || k === 'r' || k === 'v0') {
        this.pt = 0;
        this.view = viewOf(p.x0, p.r);
      }
      this.frame();
      return;
    }
    if (!k || k === 'x0' || k === 'v0') this.reset(p);
    else if (k === 'r') this.setTarget(p.r, false);
    else {
      this.boat.p = { ...p, r: this.boat.p.r };
      this.frame();
    }
  }

  /** 自動で始める（動きを減らす設定では始めない） */
  start(): void {
    this.setRun(!RM.matches);
  }

  /** モードに入る（初めと切り替えたとき） */
  private enter(): void {
    const plan = this.plan;
    $('#rvPid').parentElement?.toggleAttribute('hidden', plan);
    for (const id of ['#rv-pl', '#rv-pr']) $(id).style.visibility = plan ? 'hidden' : '';
    txt('#lv-x-h', plan ? '10 s' : '6 s');
    txt('#lv-x-m', plan ? 'STEP' : 'ROLL');
    txt('#o-eel', plan ? '終了時の偏差' : '今の偏差');
    $('#rv-rs').title = plan ? '再生を時刻 0 へ戻す' : '入力の初期位置・初速から始め直す';
    this.sx = this.sv = this.su = undefined;
    if (plan) {
      this.recompute();
      this.pt = 0;
      this.view = viewOf(this.inp.x0, this.inp.r);
    } else this.reset();
    for (const s of ['#lv-x-cur', '#lv-u-cur']) $(s).style.display = plan ? '' : 'none';
    this.setRun(this.running);
  }

  private recompute(): void {
    const p = this.inp;
    this.rec = record(p);
    this.met = metrics(this.rec, p.x0, p.r);
    this.sx = this.sv = this.su = undefined;
    this.dirty = true;
    this.output(true);
  }

  /* ---------- ライブ ---------- */
  private reset(p: In = this.inp): void {
    this.boat.reset({ ...p });
    this.view = viewOf(p.x0, p.r);
    this.foam = [];
    for (const r of [this.rx, this.rr, this.rv, this.rw, this.rp, this.ri, this.rd, this.ru, this.rt]) r.clear();
    this.sx = this.sv = this.su = undefined;
    this.acc = 0;
    this.div = false;
    this.snap();
    this.record();
    this.event('start');
    this.frame();
  }

  private event(kind: EvKind): void {
    const b = this.boat;
    this.meter.begin(kind, b.t, b.x, b.p.r);
    this.output(true);
  }

  /** 目標を変える（ライブ）。図の外なら範囲を広げる。fromFig なら入力へ戻す */
  private setTarget(r: number, fromFig: boolean): void {
    const b = this.boat;
    if (r === b.p.r && !fromFig) return;
    b.p = { ...b.p, r };
    const { lo, hi } = this.view;
    if (r < lo + 1 || r > hi - 1) this.view = viewOf(b.x, r);
    this.event('target');
    if (fromFig) this.onTarget(r);
    this.frame();
  }

  private setPid(on: boolean): void {
    const was = this.boat.on;
    this.boat.setOn(on);
    $('#rvPid').setAttribute('aria-pressed', String(on));
    $('#rvPidLed').classList.toggle('on', on);
    txt('#rvPidT', on ? 'PID 入' : 'PID 切');
    if (on && !was) this.event('pid');
    this.frame();
  }

  /** 今のステップの値を、描くときの補いの起点として残す */
  private snap(): void {
    const b = this.boat;
    this.prev = { x: b.x, t: b.t, up: b.up, ui: b.ui, ud: b.ud, th: b.a / DT };
  }

  private step(): void {
    const b = this.boat,
      w = b.p.w;
    this.snap();
    b.step();
    for (const f of this.foam) {
      f.x += w * DT;
      f.age += DT;
    }
    this.foam = this.foam.filter((f) => f.age < FOAM_LIFE);
    /* 船尾（ボートの絵の左端）から泡を出す。推力が強いほど濃い */
    const th = Math.abs(b.a / DT);
    if (th > 0.01 && Math.round(b.t / DT) % 2 === 0)
      this.foam.push({ x: this.stern(b.x), age: 0, k: Math.min(1, th / 0.4), dy: ((b.t * 7.31) % 1) - 0.5 });
    this.record();
    this.meter.sample(b.t, b.x, b.v);
    if (b.diverged) this.div = true;
  }

  private stern(x: number): number {
    return this.fig.meter(this.fig.px(x) - 22);
  }

  private record(): void {
    const b = this.boat;
    this.rx.push(b.x);
    this.rr.push(b.p.r);
    this.rv.push(b.v);
    this.rw.push(-b.p.w);
    this.rp.push(b.up);
    this.ri.push(b.ui);
    this.rd.push(b.ud);
    this.ru.push(b.u);
    this.rt.push(b.a / DT);
    this.dirty = true;
  }

  /* ---------- 動かす ---------- */
  private setRun(on: boolean): void {
    if (on && this.div && !this.plan) on = false;
    this.running = on;
    $('#rvRun').setAttribute('aria-pressed', String(on));
    $('#rvRunLed').classList.toggle('on', on);
    txt('#rvRunT', on ? '停止' : this.plan ? '再生' : '開始');
    this.kick();
    this.frame();
  }

  private kick(): void {
    if (this.raf || !this.running || !this.shown) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private loop(now: number): void {
    this.raf = 0;
    if (!this.running || !this.shown) return;
    /* 裏に回っていたときなどの大きな間は詰める */
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)) * Number(this.spd.value);
    this.last = now;
    if (this.plan) {
      const end = (this.rec.n - 1) * DT;
      /* 終わりで 1 s 止めてから頭へ戻る */
      this.pt += dt;
      if (this.pt > end + Number(this.spd.value)) this.pt = 0;
      this.frame();
      this.kick();
      return;
    }
    this.acc += dt;
    while (this.acc >= DT && !this.div) {
      this.acc -= DT;
      this.step();
    }
    this.frame();
    if (this.div) this.setRun(false);
    else this.kick();
  }

  /* ---------- 描く ---------- */
  private arrows(v: Record<Comp, number>): Arrow[] {
    const A: Arrow[] = [];
    if (this.on.has('t')) A.push({ v: v.t, col: '--rv-thrust', name: '推力', lw: 4 });
    if (this.on.has('u')) A.push({ v: v.u, col: '--ink', name: 'u', lw: 4 });
    if (this.on.has('d')) A.push({ v: v.d, col: '--ch2', name: 'D' });
    if (this.on.has('i')) A.push({ v: v.i, col: '--rv-i', name: 'I' });
    if (this.on.has('p')) A.push({ v: v.p, col: '--ch1', name: 'P' });
    return A;
  }

  private frame(): void {
    if (this.plan) this.framePlan();
    else this.frameLive();
  }

  private framePlan(): void {
    const R = this.rec,
      n = R.n,
      p = this.inp,
      t = Math.min(this.pt, (n - 1) * DT),
      x = atT(R.X, n, t),
      g = (a: Float64Array) => atT(a, n, t);
    /* 泡: 0.2 s ごとに船尾から出て、水と一緒に流れる */
    const foam: Foam[] = [];
    for (let te = Math.max(0, Math.ceil((t - FOAM_LIFE) / 0.2) * 0.2); te <= t; te += 0.2) {
      const th = Math.abs(atT(R.A, n, te));
      if (th > 0.01)
        foam.push({
          x: this.stern(atT(R.X, n, te)) + p.w * (t - te),
          age: t - te,
          k: Math.min(1, th / 0.4),
          dy: ((te * 7.31) % 1) - 0.5,
        });
    }
    const up = g(R.UP),
      ui = g(R.UI),
      ud = g(R.UD);
    this.fig.draw({
      ...this.view,
      t: this.pt,
      w: p.w,
      r: this.dragR ?? p.r,
      x0: p.x0,
      x,
      arrows: this.arrows({ p: up, i: ui, d: ud, u: up + ui + ud, t: g(R.A) }),
      foam,
      grab: this.dragR !== null,
      hot: this.hot,
    });
    this.status(t, x, p.r - x, n < N);
    if (this.dirty) {
      this.dirty = false;
      const xs = (j: number) => (j * DT * SW) / T_PLAN;
      this.scopeX(arr(R.X, n), fill(p.r, n), arr(R.V, n), fill(-p.w, n), xs);
      this.scopeU([arr(R.UP, n), arr(R.UI, n), arr(R.UD, n), arr(this.sum(R), n), arr(R.A, n)], xs);
    }
    const cx = ((t * SW) / T_PLAN).toFixed(1);
    for (const s of ['#lv-x-cur', '#lv-u-cur']) $(s).setAttribute('d', `M${cx} 0V${PH}`);
  }

  private sumCache: { r: Rec; s: Float64Array } | null = null;
  private sum(R: Rec): Float64Array {
    if (this.sumCache?.r !== R) {
      const s = new Float64Array(R.n);
      for (let i = 0; i < R.n; i++) s[i] = R.UP[i] + R.UI[i] + R.UD[i];
      this.sumCache = { r: R, s };
    }
    return this.sumCache.s;
  }

  private frameLive(): void {
    const b = this.boat,
      /* 前のステップと今のステップの間を、たまった時間の割合で補う（ボートを滑らかに動かす） */
      u = this.div ? 1 : Math.min(1, this.acc / DT),
      q = this.prev,
      x = lerp(q.x, b.x, u),
      back = (1 - u) * DT;
    this.fig.draw({
      ...this.view,
      t: lerp(q.t, b.t, u),
      w: b.p.w,
      r: this.dragR ?? b.p.r,
      x0: b.p.x0,
      x,
      arrows: this.arrows({
        p: lerp(q.up, b.up, u),
        i: lerp(q.ui, b.ui, u),
        d: lerp(q.ud, b.ud, u),
        u: lerp(q.up + q.ui + q.ud, b.u, u),
        t: lerp(q.th, b.a / DT, u),
      }),
      foam: this.foam.map((f) => ({ ...f, x: f.x - b.p.w * back, age: Math.max(0, f.age - back) })),
      grab: this.dragR !== null,
      hot: this.hot,
    });
    this.status(b.t, b.x, b.p.r - b.x, this.div);
    if (this.dirty) {
      this.dirty = false;
      const xs = (j: number, len: number) => SW - ((len - 1 - j) * SW) / LEN;
      this.scopeX(this.rx, this.rr, this.rv, this.rw, xs);
      this.scopeU([this.rp, this.ri, this.rd, this.ru, this.rt], xs);
    }
    this.output(!this.running);
  }

  private status(t: number, x: number, e: number, div: boolean): void {
    txt('#rv-t', `${t.toFixed(1)} s`);
    txt('#rv-x', `${signed(x, 1)} m`);
    txt('#rv-e', `${signed(e, 1)} m`);
    $('#rv-dv').style.visibility = div ? '' : 'hidden';
    const px = this.fig.px(x),
      out = !div && !(px >= -4 && px <= this.cv.clientWidth + 4);
    $('#rv-out').style.visibility = out ? '' : 'hidden';
  }

  /** 計算結果。計算のモードは 100 s のステップ応答、ライブは最後の出来事から。ライブで動いている間は 150 ms ごと */
  private output(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastOut < 150) return;
    this.lastOut = now;
    if (this.plan) {
      const M = this.met;
      html('#o-ts', M.ts == null ? DASH : ro(M.ts, 's'));
      txt(
        '#o-tsn',
        M.div
          ? '発散しました（|x| か |v| が 10⁶ を超えました）'
          : M.flat
            ? '目標位置が初期位置と同じです'
            : M.ts == null
              ? '100 s 以内に ±2 % の範囲へ収まりません'
              : '時刻 0 から、±2 % の範囲に入ったままになるまで',
      );
      html('#o-tr', M.tr == null ? DASH : ro(M.tr, 's'));
      html('#o-os', M.os == null ? DASH : pct(M.os));
      html('#o-tp', M.tp == null ? DASH : ro(M.tp, 's'));
      html('#o-ee', ro(M.ee, 'm'));
      html('#o-iae', `${plain(M.iae, 4, true)}<span class="u">m·s</span>`);
      html('#o-vm', ro(M.vm, 'm/s'));
      this.onMeas(M.ts == null ? DASH : fmtR(M.ts, 's'), M.os == null ? DASH : `${M.os.toFixed(1)} %`, fmtR(M.ee, 'm'));
      return;
    }
    const m = this.meter.get();
    html('#o-ts', m.ts === null ? DASH : ro(m.ts, 's'));
    txt(
      '#o-tsn',
      this.div
        ? '発散しました（|x| か |v| が 10⁶ を超えました）'
        : `${EV[m.kind]}、±${fmtR(m.band, 'm', 2)} に入って ${HOLD} s 留まるまで`,
    );
    html('#o-tr', m.tr === null ? DASH : ro(m.tr, 's'));
    html('#o-os', m.os === null ? DASH : pct(m.os));
    html('#o-tp', m.tp === null ? DASH : ro(m.tp, 's'));
    html('#o-ee', ro(m.e, 'm'));
    html('#o-iae', `${plain(m.iae, 4, true)}<span class="u">m·s</span>`);
    html('#o-vm', ro(m.vm, 'm/s'));
    this.onMeas(m.ts === null ? DASH : fmtR(m.ts, 's'), m.os === null ? DASH : `${m.os.toFixed(1)} %`, fmtR(m.e, 'm'));
  }

  /** 折れ線。xs は列の番号から横の位置 */
  private path(r: Src, s: Scale, xs: (j: number, len: number) => number): string {
    const y0 = PH - s.k * DV,
      lim = 0.3 * DV;
    let d = '';
    for (let j = 0; j < r.len; j++) {
      const y = Math.max(-lim, Math.min(PH + lim, y0 - (r.at(j) / s.vd) * DV));
      d += `${j ? 'L' : 'M'}${xs(j, r.len).toFixed(1)} ${Number.isFinite(y) ? y.toFixed(1) : '0'}`;
    }
    return d;
  }

  private axes(id: string, s: Scale, unit: string, s2?: Scale): void {
    const el = $(`#${id}-ax`),
      plan = this.plan,
      key = `${plan}|${s.vd}|${s.k}|${s2 ? `${s2.vd}|${s2.k}` : ''}`;
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    let a = '';
    for (let i = 0; i <= 10; i += 2)
      a += `<text x="${i * DV}" y="${PH + 17}" text-anchor="middle">${plan ? (i ? `${i * 10} s` : '0') : i === 10 ? '0' : `−${(10 - i) * 6} s`}</text>`;
    for (let j = 0; j <= ROWS; j++) {
      const v = (j - s.k) * s.vd;
      a += `<text x="-10" y="${PH - j * DV + 4}" text-anchor="end">${v ? fmt(v, unit, 3) : '0'}</text>`;
    }
    const y1 = PH - s.k * DV;
    a += `<path class="mk1" d="M-8 ${y1 - 5}L-1 ${y1}L-8 ${y1 + 5}Z"/>`;
    if (s2) {
      const y2 = PH - s2.k * DV;
      a += `<path class="mk2 c2x" d="M${SW + 8} ${y2 - 5}L${SW + 1} ${y2}L${SW + 8} ${y2 + 5}Z"/>`;
    }
    el.innerHTML = a;
    txt(`#${id}-vd`, fmt(s.vd, unit, 3));
  }

  private scopeX(x: Src, r: Src, v: Src, w: Src, xs: (j: number, len: number) => number): void {
    const [lo, hi] = range([x, r]);
    this.sx = keepScale(this.sx, lo, hi, 1);
    $('#lv-x-tr').setAttribute('d', this.path(x, this.sx, xs));
    $('#lv-x-rl').setAttribute('d', this.path(r, this.sx, xs));
    const [vlo, vhi] = range([v, w]);
    this.sv = keepScale(this.sv, vlo, vhi, 1);
    $('#lv-x-v').setAttribute('d', this.path(v, this.sv, xs));
    $('#lv-x-w').setAttribute('d', this.path(w, this.sv, xs));
    txt('#lv-x-vd2', fmt(this.sv.vd, 'm/s', 3));
    this.axes('lv-x', this.sx, 'm', this.sv);
  }

  /** 内訳の表示窓。縦の範囲は出しているものだけで決める */
  private scopeU(srcs: Src[], xs: (j: number, len: number) => number): void {
    const shown = srcs.filter((_, i) => this.on.has(COMPS[i])),
      m = robustMax(shown.length ? shown : srcs);
    this.su = keepScale(this.su, -m, m, 0.1);
    COMPS.forEach((c, i) => {
      $(`#lv-u-${c}`).setAttribute('d', this.on.has(c) ? this.path(srcs[i], this.su as Scale, xs) : '');
    });
    this.axes('lv-u', this.su, 'm/s²');
  }

  /* ---------- 操作 ---------- */
  private push(dir: 1 | -1): void {
    if (this.plan || this.div) return;
    this.boat.push(dir * PUSH);
    this.event('push');
    txt('#rv-live', `ボートを${dir > 0 ? '右' : '左'}へ押しました`);
    if (!this.running) this.setRun(true);
    else this.frame();
  }

  /** 図の上の位置からブイの位置（1 m 単位、図と入力の範囲の中） */
  private buoyAt(m: number): number {
    const { lo, hi } = this.view;
    return Math.round(Math.max(Math.max(lo + 1, -R_LIM), Math.min(Math.min(hi - 1, R_LIM), m)));
  }

  private target(): number {
    return this.plan ? this.inp.r : this.boat.p.r;
  }

  /** ブイを r へ（離したとき・キー）。計算のモードは入力を変えて計算し直し、ライブはその場で目標を変える */
  private dropBuoy(r: number): void {
    if (this.plan) {
      if (r !== this.inp.r) this.onTarget(r);
      else this.frame();
    } else this.setTarget(r, true);
    txt('#rv-live', `目標を ${signed(r, 0)} m にしました`);
  }

  private bind(): void {
    const cv = this.cv,
      at = (e: PointerEvent) => e.clientX - cv.getBoundingClientRect().left;
    cv.addEventListener('pointerdown', (e) => {
      if (!this.fig.nearBuoy(at(e), this.target())) return;
      this.dragR = this.target();
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* 合成のポインターでは捕まえられない */
      }
      e.preventDefault();
      this.frame();
    });
    cv.addEventListener('pointermove', (e) => {
      const x = at(e),
        grab = this.dragR !== null,
        hot = grab || this.fig.nearBuoy(x, this.target());
      cv.style.cursor = grab ? 'grabbing' : hot ? 'grab' : '';
      if (grab) {
        /* つかんでいる間は図の中だけで動かし、離したときに入力へ戻す */
        this.dragR = this.buoyAt(this.fig.meter(x));
        this.frame();
      } else if (hot !== this.hot) {
        this.hot = hot;
        this.frame();
      }
    });
    const up = () => {
      if (this.dragR === null) return;
      const r = this.dragR;
      this.dragR = null;
      this.dropBuoy(r);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => {
      if (this.hot && this.dragR === null) {
        this.hot = false;
        this.frame();
      }
    });
    cv.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) this.dropBuoy(Math.max(-R_LIM, Math.min(R_LIM, this.target() + dir)));
      else this.push(dir);
    });
    $('#rvRun').addEventListener('click', () => {
      /* 計算のモードで終わりまで再生していたら頭から */
      if (this.plan && !this.running && this.pt >= (this.rec.n - 1) * DT) this.pt = 0;
      this.setRun(!this.running);
    });
    $('#rvPid').addEventListener('click', () => this.setPid(!this.boat.on));
    $('#rv-pl').addEventListener('click', () => this.push(-1));
    $('#rv-pr').addEventListener('click', () => this.push(1));
    $('#rv-rs').addEventListener('click', () => {
      if (this.plan) {
        this.pt = 0;
        this.frame();
      } else this.reset();
      if (!RM.matches && !this.running) this.setRun(true);
    });
    /* 計算のモード: 表示窓を押す・なぞると、その時刻へ */
    for (const id of ['#lv-x', '#lv-u']) {
      const svg = $<SVGSVGElement>(`${id} svg`);
      let drag = false;
      const seek = (e: PointerEvent) => {
        const b = svg.getBoundingClientRect(),
          vb = svg.viewBox.baseVal,
          sx = vb.x + ((e.clientX - b.left) / b.width) * vb.width;
        this.pt = Math.max(0, Math.min(T_PLAN, (sx / SW) * T_PLAN));
        this.frame();
      };
      svg.addEventListener('pointerdown', (e) => {
        if (!this.plan) return;
        drag = true;
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          /* 合成のポインターでは捕まえられない */
        }
        seek(e);
      });
      svg.addEventListener('pointermove', (e) => {
        if (drag && this.plan) seek(e);
      });
      svg.addEventListener('pointerup', () => {
        drag = false;
      });
    }
    /* CH2（速度） */
    const ch2 = $('#lv-x-ch2');
    ch2.addEventListener('click', () => {
      const on = ch2.getAttribute('aria-pressed') !== 'true';
      ch2.setAttribute('aria-pressed', String(on));
      $('#lv-x .scope').classList.toggle('hide2', !on);
    });
    storeToggle(ch2);
    /* 内訳の表示窓と矢印に出すもの */
    for (const c of COMPS) {
      const b = $(`#lv-c-${c}`),
        sync = () => {
          if (b.getAttribute('aria-pressed') === 'true') this.on.add(c);
          else this.on.delete(c);
        };
      sync();
      b.addEventListener('click', () => {
        b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
        sync();
        this.dirty = true;
        this.su = undefined;
        this.frame();
      });
      storeToggle(b);
    }
    /* 画面の外・タブが隠れている間は止める（開始・停止の状態は変えない） */
    new IntersectionObserver((es) => {
      for (const e of es) this.shown = e.isIntersecting && !document.hidden;
      this.kick();
    }).observe(cv);
    document.addEventListener('visibilitychange', () => {
      this.shown = !document.hidden;
      this.kick();
    });
    new ResizeObserver(() => this.frame()).observe(cv);
    const recolor = () => {
      this.fig.recolor();
      this.frame();
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
    new MutationObserver(recolor).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }
}

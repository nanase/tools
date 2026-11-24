/**
 * 鍵盤の上に重ねる図（弦の図の代わり）。canvas に描く。
 * - 弦の振動: 鍵ごとの弦の振れの大きさを、その鍵の上の帯の濃さで描き、下から上へ流す。打弦された弦は黄、
 *   共鳴弦は暗い青で細く（打弦された弦より目立たないように）。明るい配色でも暗い地に描く
 * - 楽譜: 曲の音符を上から鍵盤へ落とす（白鍵も黒鍵も同じ幅）。左端の帯がダンパーペダルを踏んでいる区間
 * 横位置と高さは鍵盤の図（keys.ts）と同じ単位で、図の幅に合わせて拡大する
 */
import { FIG_KY, FIG_W, type KbView, keyMid, type StringVel } from './keys';
import { isBlack, KEY_HI, KEY_LO } from './strings';

/** 描く範囲の下端（図の単位。鍵盤の少し上） */
const BOT = FIG_KY - 4;
/**
 * 弦の振動: 流れる速さ [図の単位/s]、0 dB にする弦の速さの振幅 [m/s]（mf で打った弦がほぼ 0 dB）と、
 * 描く範囲 [dB]
 */
const SPEED = 50,
  A_REF = 5,
  RANGE = 40;
/**
 * 濃さを色の混ぜ具合にする式: 打弦された弦は明るい黄（--ch1 より明るい）で、音が小さくなるにつれて地に溶ける。
 * 共鳴弦は弱い振動ほど暗く
 */
const hitMix = (l: number): number => l ** 0.6,
  resMix = (l: number): number => (0.1 + 0.9 * l ** 1.4) * RES_MAX;
/**
 * 弦の振動は、明るい配色でも暗い表示窓に描く（暗い地のほうが弱い振動まで見やすい）。色はサイトの暗い配色の
 * --screen・--ch1・--ch2・--grid・--ink-3
 */
const DARK: Pick<Colors, 'bg' | 'hit' | 'res' | 'grid' | 'ink'> = {
  bg: [8, 9, 10],
  hit: [255, 214, 72],
  res: [82, 196, 221],
  grid: '#1c2428',
  ink: '#838c93',
};
/** 楽譜: 音符の幅（図の単位）。白鍵も黒鍵も同じ幅で、鍵の中心に置く（隣の半音の音符と重ならない幅） */
const NOTE_W = 8.6;
/** 弦の振動: 打弦された弦・共鳴弦の帯の幅（図の単位。鍵の中心に置く） */
const HIT_W = NOTE_W,
  RES_W = 4.4;
/** 共鳴弦の色の濃さの上限（ペダルで多くの弦が共鳴しても、打弦された弦より目立たないように） */
const RES_MAX = 0.7;
/** 楽譜: 見せる先の時間 [s] と、ペダルの帯の左右の端（図の単位） */
export const ROLL_S = 4;
const PED_X0 = 0.5,
  PED_X1 = 5;

/** 弦の速さの振幅 a [m/s] の濃さ（0〜1。RANGE dB より小さければ 0） */
export const levelOf = (a: number): number =>
  a > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(a / A_REF) + RANGE) / RANGE)) : 0;

/** 楽譜の音符（拍） */
export interface RollNote {
  /** 鍵・打つ拍・長さ [拍] */
  n: number;
  t: number;
  d: number;
}
/** 楽譜の図に描くもの。時刻は今からの秒（負は過ぎた時刻） */
export interface RollView {
  notes: { key: number; t0: number; t1: number }[];
  /** ペダルを踏んでいる区間 */
  ped: [number, number][];
  /** 小節の頭と小節の番号 */
  bars: { t: number; n: number }[];
}

/** 拍の列 xs（昇順）で、x 以上の最初の位置 */
function lower(xs: readonly number[], x: number): number {
  let a = 0,
    b = xs.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (xs[m] < x) a = m + 1;
    else b = m;
  }
  return a;
}

/** 音符の拍の列（曲ごとに 1 回作る） */
const beatCache = new WeakMap<readonly RollNote[], number[]>();
function beatsOf(notes: readonly RollNote[]): number[] {
  let ts = beatCache.get(notes);
  if (!ts) {
    ts = notes.map((x) => x.t);
    beatCache.set(notes, ts);
  }
  return ts;
}

/**
 * 楽譜の図の中身。notes は打つ拍の順、maxD は最も長い音符の拍、ped はペダルを踏む区間 [拍]、starts は小節の頭の拍、
 * beat は今の拍、sec は今から拍 b までの秒（テンポの変化を含む）。span 秒先までと、少し前に過ぎたものを返す
 */
export function rollWindow(
  notes: readonly RollNote[],
  starts: readonly number[],
  maxD: number,
  ped: readonly (readonly [number, number])[],
  beat: number,
  sec: (b: number) => number,
  span = ROLL_S,
): RollView {
  const out: RollView = { notes: [], ped: [], bars: [] },
    ts = beatsOf(notes);
  for (let i = lower(ts, beat - maxD); i < notes.length; i++) {
    const x = notes[i],
      t0 = sec(x.t);
    if (t0 > span) break;
    const t1 = sec(x.t + x.d);
    if (t1 > 0) out.notes.push({ key: x.n, t0, t1 });
  }
  for (const [a, b] of ped) {
    const t0 = sec(a),
      t1 = sec(b);
    if (t1 > 0 && t0 < span) out.ped.push([t0, t1]);
  }
  for (let i = Math.max(0, lower(starts, beat) - 1); i < starts.length; i++) {
    const t = sec(starts[i]);
    if (t > span) break;
    if (t >= -0.5) out.bars.push({ t, n: i + 1 });
  }
  return out;
}

/** ペダルの出来事（拍の順）から、踏んでいる区間 [拍]。最後まで離さなければ end まで */
export function pedalSpans(ev: readonly { b: number; on: boolean }[], end: number): [number, number][] {
  const out: [number, number][] = [];
  let on: number | null = null;
  for (const e of ev) {
    if (e.on && on === null) on = e.b;
    else if (!e.on && on !== null) {
      out.push([on, e.b]);
      on = null;
    }
  }
  if (on !== null) out.push([on, end]);
  return out;
}

type RGB = [number, number, number];
interface Colors {
  bg: RGB;
  hit: RGB;
  res: RGB;
  on: RGB;
  grid: string;
  line: string;
  ink: string;
}
const mix = (a: RGB, b: RGB, u: number): string =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;

export interface KbCanvasOpt {
  /** 鍵ごとの弦の振れ */
  vels(): Map<number, StringVel>;
  /** 楽譜の図の中身（曲がなければ null） */
  roll(): RollView | null;
}

/** 鍵盤の上に重ねる canvas。弦の図の間は描かない */
export class KbCanvas {
  private mode: KbView = 'str';
  private readonly ctx: CanvasRenderingContext2D;
  /** 弦の振動の履歴（cv と同じ大きさ） */
  private readonly off = document.createElement('canvas');
  private readonly oc: CanvasRenderingContext2D;
  private col: Colors | null = null;
  private colAt = 0;
  private raf = 0;
  private last = 0;
  private acc = 0;
  /** 履歴に何か残っている間の秒（流しきったら、次に鳴るまで描き直さない） */
  private live = 0;
  /** 今の大きさ・図で一度描いたか */
  private painted = false;

  constructor(
    private readonly cv: HTMLCanvasElement,
    private readonly opt: KbCanvasOpt,
  ) {
    this.ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    this.oc = this.off.getContext('2d') as CanvasRenderingContext2D;
    new ResizeObserver(() => this.resize()).observe(cv);
    /* 配色を変えたら、次のコマで色を読み直す */
    new MutationObserver(() => {
      this.col = null;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.col = null;
    });
  }

  setMode(m: KbView): void {
    this.mode = m;
    this.cv.hidden = m === 'str';
    if (m === 'str') {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.painted = false;
    this.resize();
    this.kick();
  }

  /** 図の単位あたりの canvas の画素 */
  private get k(): number {
    return this.cv.width / FIG_W;
  }

  /** canvas の画素を表示の大きさに合わせる（変わったら履歴は消す） */
  private resize(): void {
    const r = this.cv.getBoundingClientRect(),
      dpr = Math.min(2, window.devicePixelRatio || 1),
      w = Math.round(r.width * dpr),
      h = Math.round(r.height * dpr);
    if (!w || !h || (w === this.cv.width && h === this.cv.height)) return;
    this.cv.width = this.off.width = w;
    this.cv.height = this.off.height = h;
    this.live = 0;
    this.painted = false;
    this.kick();
  }

  private colors(): Colors {
    const now = performance.now();
    if (this.col && now - this.colAt < 2000) return this.col;
    const cs = getComputedStyle(this.cv),
      v = (n: string) => cs.getPropertyValue(n).trim(),
      rgb = (s: string): RGB => {
        this.ctx.fillStyle = '#000';
        this.ctx.fillStyle = s;
        const c = this.ctx.fillStyle;
        if (c.startsWith('#')) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as RGB;
        const m = c.match(/[\d.]+/g) ?? ['0', '0', '0'];
        return [Number(m[0]), Number(m[1]), Number(m[2])];
      };
    this.col = {
      bg: rgb(v('--screen')),
      hit: rgb(v('--ch1')),
      res: rgb(v('--ch2')),
      on: rgb(v('--key-on')),
      grid: v('--grid'),
      line: v('--line-2'),
      ink: v('--ink-3'),
    };
    this.colAt = now;
    return this.col;
  }

  private kick(): void {
    if (!this.raf && this.mode !== 'str') {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  private frame(t: number): void {
    this.raf = 0;
    if (this.mode === 'str') return;
    const dt = Math.min(0.25, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    if (this.mode === 'vib') this.vib(dt);
    else this.rollFrame();
    this.raf = requestAnimationFrame((x) => this.frame(x));
  }

  /* ---------- 弦の振動 ---------- */
  private vib(dt: number): void {
    const { cv, off, oc, ctx } = this,
      k = this.k,
      c = DARK,
      vs = this.opt.vels(),
      rows: { x: number; l: number; res: boolean }[] = [];
    for (const [key, v] of vs) {
      if (key < KEY_LO || key > KEY_HI) continue;
      const lh = levelOf(v.hit),
        lr = levelOf(v.res);
      if (lh > 0) rows.push({ x: keyMid(key), l: lh, res: false });
      if (lr > 0) rows.push({ x: keyMid(key), l: lr, res: true });
    }
    if (!rows.length && this.live <= 0 && this.painted) return;
    this.painted = true;
    if (rows.length) this.live = (BOT / SPEED) * 1.05;
    else this.live = Math.max(0, this.live - dt);
    /* 履歴を上へずらし、下端に新しい行を描く。打弦された弦を共鳴弦より手前に描く */
    this.acc += SPEED * k * dt;
    const d = Math.floor(this.acc);
    if (d > 0) {
      this.acc -= d;
      oc.globalCompositeOperation = 'copy';
      oc.drawImage(off, 0, -d);
      oc.globalCompositeOperation = 'source-over';
      /* 新しい行は画素の境にそろえる（途中から塗ると、行が半端に塗られて暗く残る） */
      const y = off.height - d;
      rows.sort((p, q) => Number(q.res) - Number(p.res));
      for (const p of rows) {
        const w = p.res ? RES_W : HIT_W;
        oc.fillStyle = p.res ? mix(c.bg, c.res, resMix(p.l)) : mix(c.bg, c.hit, hitMix(p.l));
        oc.fillRect((p.x - w / 2) * k, y, w * k, d);
      }
    }
    ctx.fillStyle = `rgb(${c.bg.join(',')})`;
    ctx.fillRect(0, 0, cv.width, cv.height);
    this.grid(c, k);
    ctx.drawImage(off, 0, 0);
  }

  /** オクターブの縦線と、2 秒ごとの横線（右端に何秒前か） */
  private grid(c: Pick<Colors, 'grid' | 'ink'>, k: number): void {
    const { ctx } = this;
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = Math.max(1, k * 0.8);
    ctx.beginPath();
    for (let key = 24; key <= KEY_HI; key += 12) {
      const x = Math.round(keyMid(key) * k) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, BOT * k);
    }
    for (let s = 2; s * SPEED < BOT; s += 2) {
      const y = Math.round((BOT - s * SPEED) * k) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(FIG_W * k, y);
    }
    ctx.stroke();
    ctx.fillStyle = c.ink;
    ctx.font = `500 ${(9.5 * k).toFixed(1)}px "Fira Mono",ui-monospace,monospace`;
    ctx.textAlign = 'right';
    for (let s = 2; s * SPEED < BOT; s += 2) ctx.fillText(`−${s} s`, (FIG_W - 3) * k, (BOT - s * SPEED - 3) * k);
  }

  /* ---------- 楽譜 ---------- */
  private rollFrame(): void {
    const { cv, ctx } = this,
      k = this.k,
      c = this.colors(),
      v = this.opt.roll();
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!v) return;
    const yOf = (t: number) => (BOT - (t / ROLL_S) * BOT) * k;
    /* ペダル: 左端の帯と、踏んでいる区間の薄い地 */
    for (const [a, b] of v.ped) {
      const y0 = Math.min(BOT * k, yOf(a)),
        y1 = Math.max(0, yOf(b));
      ctx.fillStyle = mix(c.bg, c.res, 0.08);
      ctx.fillRect(PED_X1 * k, y1, (FIG_W - PED_X1) * k, y0 - y1);
      ctx.fillStyle = mix(c.bg, c.res, 1);
      ctx.fillRect(PED_X0 * k, y1, (PED_X1 - PED_X0) * k, y0 - y1);
    }
    /* 小節の線と番号 */
    ctx.strokeStyle = c.line;
    ctx.lineWidth = Math.max(1, k * 0.8);
    ctx.fillStyle = c.ink;
    ctx.font = `500 ${(10 * k).toFixed(1)}px "Fira Mono",ui-monospace,monospace`;
    ctx.textAlign = 'left';
    for (const b of v.bars) {
      const y = Math.round(yOf(b.t)) + 0.5;
      if (y > BOT * k) continue;
      ctx.beginPath();
      ctx.moveTo(PED_X1 * k, y);
      ctx.lineTo(FIG_W * k, y);
      ctx.stroke();
      ctx.fillText(String(b.n), 9 * k, y - 3 * k);
    }
    /* 音符: 鳴っている間は押した鍵の色、これから弾く音は黄（黒鍵は暗く） */
    const gap = 0.8 * k;
    for (const nt of v.notes) {
      if (nt.key < KEY_LO || nt.key > KEY_HI) continue;
      const x = (keyMid(nt.key) - NOTE_W / 2) * k,
        y0 = Math.min(BOT * k, yOf(nt.t0)),
        y1 = Math.max(0, yOf(nt.t1));
      if (y0 <= y1) continue;
      ctx.fillStyle = nt.t0 <= 0 ? mix(c.bg, c.on, 1) : isBlack(nt.key) ? mix(c.bg, c.hit, 0.62) : mix(c.bg, c.hit, 1);
      ctx.fillRect(x, y1 + gap / 2, NOTE_W * k, y0 - y1 - gap);
    }
  }
}

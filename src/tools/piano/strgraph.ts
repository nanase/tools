/**
 * 弦の枠のグラフ: 鍵ごとの弦の値（弦長・張力・外径・非調和性係数 B・調律のずれ）を、下の小さな鍵盤にそろえた横軸で描く。
 * 3 つの大きさのピアノを重ね、選んでいる大きさを太く描く。グラフの下に巻線と弦の本数の帯を置く。
 * 指した鍵の値は opt.cursor で知らせ、押すと opt.pick で選ぶ。色は枠の CSS 変数（--kb-w・--kb-b・--kb-cu など）
 */
import { keyRect } from './keys';
import { inharm, isBlack, KEY_HI, KEY_LO, type KeyString } from './strings';

export type SgKind = 'len' | 'ten' | 'dia' | 'b' | 'tun';

/** 1 つの大きさのピアノの弦（鍵の順）と、第 1 部分音の 12 平均律からのずれ [セント] */
export interface SgSeries {
  name: string;
  s: readonly KeyString[];
  cents: ArrayLike<number>;
}

interface Kind {
  log: boolean;
  val: (s: KeyString, c: number) => number;
  /** 目盛りの文字（v は val の単位） */
  tick: (v: number) => string;
}
const mm = (v: number) => (v >= 1 ? `${v} m` : `${Math.round(v * 1000)} mm`);
const KINDS: Record<SgKind, Kind> = {
  len: { log: true, val: (s) => s.L, tick: mm },
  ten: { log: false, val: (s) => s.T, tick: (v) => `${v} N` },
  dia: { log: true, val: (s) => s.d * 1000, tick: (v) => `${v} mm` },
  b: { log: true, val: (s) => inharm(s), tick: (v) => String(v) },
  tun: { log: false, val: (_, c) => c, tick: (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0') },
};

/** 対数の目盛り（1・2・5 の倍数。数が多ければ 10 の累乗だけ） */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(3));
      if (v >= lo && v <= hi) out.push(v);
    }
  return out.length > 6 ? out.filter((v) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9) : out;
}
/** 線形の目盛り（1・2・5 × 10 の累乗の間隔で 3〜5 本） */
export function linTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4,
    e = 10 ** Math.floor(Math.log10(raw)),
    step = [1, 2, 5, 10].map((m) => m * e).find((s) => s >= raw) ?? 10 * e,
    out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toPrecision(6)) + 0);
  return out;
}

export interface StrGraphOpt {
  /** 指している鍵（離れたら null） */
  cursor(key: number | null): void;
  /** 鍵を選んだ */
  pick(key: number): void;
}

export class StrGraph {
  private readonly ctx: CanvasRenderingContext2D;
  private kind: SgKind = 'len';
  private series: SgSeries[] = [];
  private cur = 0;
  private sel = 60;
  private hover: number | null = null;
  /** 描く大きさ [CSS px] */
  private w = 0;
  private h = 0;

  constructor(
    private readonly cv: HTMLCanvasElement,
    private readonly opt: StrGraphOpt,
  ) {
    this.ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    new ResizeObserver(() => this.draw()).observe(cv);
    const keyAt = (e: PointerEvent): number | null => {
      const r = cv.getBoundingClientRect();
      return this.keyAt(e.clientX - r.left, e.clientY - r.top);
    };
    cv.addEventListener('pointermove', (e) => {
      const k = keyAt(e);
      if (k === this.hover) return;
      this.hover = k;
      cv.style.cursor = k !== null ? 'pointer' : '';
      this.opt.cursor(k);
      this.draw();
    });
    cv.addEventListener('pointerleave', () => {
      this.hover = null;
      this.opt.cursor(null);
      this.draw();
    });
    cv.addEventListener('click', (e) => {
      const k = keyAt(e);
      if (k !== null) this.opt.pick(k);
    });
  }

  setKind(k: SgKind): void {
    this.kind = k;
    this.draw();
  }
  /** 3 つの大きさの弦と、選んでいる大きさの番号 */
  setData(series: SgSeries[], cur: number): void {
    this.series = series;
    this.cur = cur;
    this.draw();
  }
  /** 選んでいる鍵（最後に打った鍵） */
  setSel(key: number): void {
    this.sel = key;
    this.draw();
  }

  /* ---------- 座標（CSS px） ---------- */
  private static readonly M = 6;
  /** 鍵の四角の横の範囲を、グラフの幅に直す */
  private kx(x: number): number {
    const x0 = keyRect(KEY_LO)[0],
      [hx, , hw] = keyRect(KEY_HI),
      M = StrGraph.M;
    return M + ((x - x0) / (hx + hw - x0)) * (this.w - 2 * M);
  }
  private mid(key: number): number {
    const [x, , w] = keyRect(key);
    return this.kx(x + w / 2);
  }
  /** グラフ・帯・鍵盤の上下 */
  private get rows() {
    const kh = Math.min(44, Math.max(30, this.w * 0.085)),
      ky = this.h - kh - 1,
      by = ky - 16;
    return { y0: 12, y1: by - 20, by, ky, kh };
  }
  private keyAt(x: number, y: number): number | null {
    if (y < 0 || y > this.h || !this.w) return null;
    let best: number | null = null,
      bd = Infinity;
    const { ky } = this.rows;
    for (let k = KEY_LO; k <= KEY_HI; k++) {
      if (y >= ky && y <= ky + this.rows.kh * 0.62 && isBlack(k)) {
        const [bx, , bw] = keyRect(k);
        if (x >= this.kx(bx) && x <= this.kx(bx + bw)) return k;
      }
      const d = Math.abs(this.mid(k) - x);
      if (d < bd && !(y >= ky && isBlack(k))) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  draw(): void {
    const { cv, ctx } = this,
      r = cv.getBoundingClientRect(),
      dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    if (!this.w || !this.h || !this.series.length) return;
    const pw = Math.round(this.w * dpr),
      ph = Math.round(this.h * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const cs = getComputedStyle(cv),
      v = (n: string) => cs.getPropertyValue(n).trim(),
      cols = [v('--ch1'), v('--ch2'), v('--ink-3')],
      K = KINDS[this.kind],
      { y0, y1, by, ky, kh } = this.rows,
      vals = this.series.map((s) => s.s.map((x, i) => K.val(x, s.cents[i])));
    /* 縦軸の範囲と目盛り */
    let lo = Math.min(...vals.flat()),
      hi = Math.max(...vals.flat());
    if (K.log) {
      lo /= 1.25;
      hi *= 1.25;
    } else {
      const pad = Math.max(1, (hi - lo) * 0.1);
      lo -= pad;
      hi += pad;
    }
    const ticks = K.log ? logTicks(lo, hi) : linTicks(lo, hi),
      y = (x: number) => y1 - (K.log ? Math.log(x / lo) / Math.log(hi / lo) : (x - lo) / (hi - lo)) * (y1 - y0);
    ctx.font = '500 10.5px "Fira Mono",ui-monospace,monospace';
    ctx.textAlign = 'left';
    ctx.lineWidth = 1;
    for (const t of ticks) {
      const yy = Math.round(y(t)) + 0.5;
      ctx.strokeStyle = !K.log && t === 0 ? v('--line-2') : v('--grid');
      ctx.beginPath();
      ctx.moveTo(this.kx(keyRect(KEY_LO)[0]), yy);
      ctx.lineTo(this.w - StrGraph.M, yy);
      ctx.stroke();
      ctx.fillStyle = v('--ink-3');
      ctx.fillText(K.tick(t), StrGraph.M + 3, yy - 3);
    }
    ctx.strokeStyle = v('--grid');
    ctx.beginPath();
    for (let k = 24; k <= KEY_HI; k += 12) {
      const x = Math.round(this.mid(k)) + 0.5;
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    ctx.stroke();
    /* 3 つの大きさ（選んでいる大きさを最後に太く） */
    const order = this.series.map((_, i) => i).filter((i) => i !== this.cur);
    order.push(this.cur);
    for (const i of order) {
      ctx.strokeStyle = cols[i];
      ctx.lineWidth = i === this.cur ? 2.2 : 1.2;
      ctx.beginPath();
      vals[i].forEach((x, j) => {
        if (j) ctx.lineTo(this.mid(KEY_LO + j), y(x));
        else ctx.moveTo(this.mid(KEY_LO + j), y(x));
      });
      ctx.stroke();
    }
    /* 巻線と本数の帯（巻線は茶、本数は帯の中の区切り） */
    const cur = this.series[this.cur].s;
    for (let k = KEY_LO; k <= KEY_HI; k++) {
      if (isBlack(k)) continue;
      const [x, , w] = keyRect(k),
        s = cur[k - KEY_LO],
        a = this.kx(x),
        b = this.kx(x + w) - 0.6;
      ctx.fillStyle = s.wound ? v('--kb-cu') : v('--line-2');
      ctx.fillRect(a, by, b - a, 12);
      ctx.fillStyle = v('--screen');
      for (let n = 1; n < s.ns; n++) ctx.fillRect(a, by + (n * 12) / s.ns - 0.5, b - a, 1);
    }
    ctx.font = '500 10px system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = v('--ink-2');
    ctx.fillText('巻線', this.mid(KEY_LO) - 2, by - 4);
    ctx.fillText('弦の本数 1・2・3', this.mid(46), by - 4);
    /* 鍵盤 */
    const key = this.hover ?? this.sel;
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = v('--line-2');
    for (const black of [false, true])
      for (let k = KEY_LO; k <= KEY_HI; k++) {
        if (isBlack(k) !== black) continue;
        const [x, , w] = keyRect(k),
          a = this.kx(x),
          b = this.kx(x + w),
          hh = black ? kh * 0.62 : kh;
        ctx.fillStyle = k === key ? v('--accent') : black ? v('--kb-b') : v('--kb-w');
        ctx.fillRect(a, ky, b - a, hh);
        ctx.strokeRect(a, ky, b - a, hh);
      }
    /* 指している鍵 */
    const x = Math.round(this.mid(key)) + 0.5;
    ctx.strokeStyle = v('--ink-2');
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, ky);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const i of order) {
      ctx.fillStyle = cols[i];
      ctx.beginPath();
      ctx.arc(this.mid(key), y(vals[i][key - KEY_LO]), i === this.cur ? 3.6 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

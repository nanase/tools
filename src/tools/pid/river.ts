/** 川の枠の図（上から見た川・岸の目盛り・ブイ・ボート・矢印）。キャンバスに描き、計算は持たない */

/** 図の範囲 [m]。出発と目標の両側に、間の距離の 35 %（少なくとも 8 m）の余白を取る */
export function viewOf(x0: number, r: number): { lo: number; hi: number } {
  const a = Math.min(x0, r),
    b = Math.max(x0, r),
    pad = Math.max(8, Math.max(b - a, 20) * 0.35);
  return { lo: a - pad, hi: b + pad };
}

/** 目盛りの間隔（1-2-5）。target 本ほどになる値 */
export function tickStep(span: number, target: number): number {
  const raw = span / target,
    p = 10 ** Math.floor(Math.log10(raw)),
    m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export interface Arrow {
  /** 値 [m/s²]（正なら下流から上流と逆の、x の正の向き） */
  v: number;
  /** 色のトークン名（--ch1 など） */
  col: string;
  name: string;
  /** 太さ */
  lw?: number;
}

export interface Foam {
  /** 位置 [m]・生まれてからの時間 [s]・強さ 0〜1・上下のずれ（−0.5〜0.5） */
  x: number;
  age: number;
  k: number;
  dy: number;
}

export interface Frame {
  lo: number;
  hi: number;
  /** 時刻 [s]（水の筋を流す） */
  t: number;
  w: number;
  r: number;
  x0: number;
  x: number;
  arrows: Arrow[];
  foam: readonly Foam[];
  /** ブイをつかんでいるか・ブイに指が乗っているか */
  grab: boolean;
  hot: boolean;
}

/** 泡の寿命 [s] */
export const FOAM_LIFE = 7;
/** 矢印の長さが飽和の 76 %（tanh 1）になる値 [m/s²] */
const ARROW_S = 0.4;
const TOP = 20,
  BOT = 30,
  PAD = 16;

type Col = Record<string, string>;
const TOKENS = [
  '--ink',
  '--ink-2',
  '--ink-3',
  '--surface',
  '--ch1',
  '--ch2',
  '--warn',
  '--ic-red',
  '--rv-water',
  '--rv-streak',
  '--rv-bank',
  '--rv-bank-2',
  '--rv-i',
  '--rv-thrust',
];

export class RiverFig {
  private col: Col = {};
  private W = 0;
  private H = 0;
  private lo = 0;
  private hi = 1;
  private mono = 'monospace';
  private sans = 'sans-serif';

  constructor(readonly cv: HTMLCanvasElement) {
    this.recolor();
  }

  recolor(): void {
    const s = getComputedStyle(this.cv);
    for (const t of TOKENS) this.col[t] = s.getPropertyValue(t).trim();
    this.mono = s.getPropertyValue('--mono').trim() || 'monospace';
    this.sans = s.getPropertyValue('--sans').trim() || 'sans-serif';
  }

  /** 位置 [m] → 図の x [CSS px] */
  px(m: number): number {
    return PAD + ((m - this.lo) / (this.hi - this.lo)) * (this.W - 2 * PAD);
  }

  /** 図の x [CSS px] → 位置 [m] */
  meter(px: number): number {
    return this.lo + ((px - PAD) / (this.W - 2 * PAD)) * (this.hi - this.lo);
  }

  /** ブイの近く（つかめる所）か。x は図の左端からの CSS px */
  nearBuoy(px: number, r: number): boolean {
    return Math.abs(px - this.px(r)) < 22;
  }

  private fitCanvas(): CanvasRenderingContext2D | null {
    const cv = this.cv,
      dpr = Math.min(window.devicePixelRatio || 1, 2),
      w = cv.clientWidth,
      h = cv.clientHeight;
    if (!w || !h) return null;
    const bw = Math.round(w * dpr),
      bh = Math.round(h * dpr);
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw;
      cv.height = bh;
    }
    this.W = w;
    this.H = h;
    const ctx = cv.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  draw(f: Frame): void {
    this.lo = f.lo;
    this.hi = f.hi;
    const ctx = this.fitCanvas();
    if (!ctx) return;
    const { W, H, col: c } = this,
      X = (m: number) => this.px(m),
      wy0 = TOP,
      wy1 = H - BOT;
    /* 岸と水 */
    ctx.fillStyle = c['--rv-bank'];
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c['--rv-water'];
    ctx.fillRect(0, wy0, W, wy1 - wy0);
    ctx.strokeStyle = c['--rv-bank-2'];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, wy0 + 0.75);
    ctx.lineTo(W, wy0 + 0.75);
    ctx.moveTo(0, wy1 - 0.75);
    ctx.lineTo(W, wy1 - 0.75);
    ctx.stroke();

    /* 水の筋: 世界座標で w·t だけずれて流れる */
    const span = 10,
      rows = Math.max(4, Math.round((wy1 - wy0 - 16) / 18)),
      pxm = (W - 2 * PAD) / (f.hi - f.lo),
      len = Math.min(span * pxm * 0.6, 8 + Math.abs(f.w) * 8),
      sx = f.w * f.t;
    ctx.strokeStyle = c['--rv-streak'];
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < rows; k++) {
      const y = wy0 + 8 + ((wy1 - wy0 - 16) * (k + 0.5)) / rows,
        ph = (k * 3.7) % span,
        m0 = Math.floor((f.lo - span - sx - ph) / span) * span + sx + ph;
      for (let m = m0; m < f.hi + span; m += span) {
        const x = X(m);
        ctx.moveTo(x, y);
        ctx.lineTo(x + (f.w > 0 ? -len : len), y);
      }
    }
    ctx.stroke();

    /* 岸の目盛り */
    const st = tickStep(f.hi - f.lo, Math.max(3, Math.min(9, W / 90)));
    ctx.strokeStyle = c['--ink-2'];
    ctx.fillStyle = c['--ink-2'];
    ctx.lineWidth = 1;
    ctx.font = `13px ${this.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.beginPath();
    for (let m = Math.ceil(f.lo / st) * st; m <= f.hi; m += st) {
      const x = Math.round(X(m)) + 0.5;
      ctx.moveTo(x, wy1);
      ctx.lineTo(x, wy1 + 6);
    }
    ctx.stroke();
    for (let m = Math.ceil(f.lo / st) * st; m <= f.hi; m += st)
      ctx.fillText(`${Math.abs(m) < 1e-9 ? '0' : String(+m.toPrecision(6)).replace('-', '−')} m`, X(m), H - 8);

    /* 流れの札 */
    ctx.textAlign = 'left';
    ctx.font = `13px ${this.sans}`;
    ctx.fillStyle = c['--ink-2'];
    const ws = `${Math.abs(f.w).toFixed(1)} m/s`;
    ctx.fillText(Math.abs(f.w) < 1e-9 ? '流れ 0 m/s' : f.w < 0 ? `◀ 流れ ${ws}` : `流れ ${ws} ▶`, 8, 14);

    const yc = wy0 + (wy1 - wy0) * 0.7;
    /* 出発の杭 */
    const xs = X(f.x0);
    ctx.strokeStyle = c['--ink-3'];
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(xs, yc - 14);
    ctx.lineTo(xs, wy1);
    ctx.stroke();
    ctx.setLineDash([]);

    /* ブイ（目標）: 縦の破線と、ボートの線の下の浮き */
    const rx = X(f.r),
      red = c['--ic-red'];
    ctx.strokeStyle = red;
    ctx.lineWidth = f.grab || f.hot ? 2 : 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(rx, wy0 + 2);
    ctx.lineTo(rx, wy1 - 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const by = Math.min(wy1 - 9, yc + 19);
    ctx.fillStyle = red;
    ctx.beginPath();
    ctx.arc(rx, by, f.grab ? 8.5 : 7, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = c['--surface'];
    ctx.fillRect(rx - 5, by - 1, 10, 2);
    ctx.fillStyle = red;
    ctx.font = `italic 600 15px ${this.mono}`;
    ctx.textAlign = 'left';
    ctx.fillText('r', rx + 6, wy0 + 15);

    /* 泡: 船尾から出て水と一緒に流れる */
    ctx.fillStyle = c['--rv-streak'];
    for (const b of f.foam) {
      const x = X(b.x);
      if (x < -6 || x > W + 6) continue;
      ctx.globalAlpha = Math.max(0, (1 - b.age / FOAM_LIFE) * (0.3 + 0.7 * b.k));
      ctx.beginPath();
      ctx.arc(x, yc + b.dy * (5 + b.age * 2), 1.4 + b.age * 0.45, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* ボート。範囲の外なら端に印 */
    const bx = X(f.x);
    if (!(bx >= -4 && bx <= W + 4)) {
      const left = !(bx > W + 4);
      ctx.fillStyle = c['--warn'];
      const ex = left ? 6 : W - 6;
      ctx.beginPath();
      ctx.moveTo(ex, yc);
      ctx.lineTo(ex + (left ? 12 : -12), yc - 8);
      ctx.lineTo(ex + (left ? 12 : -12), yc + 8);
      ctx.closePath();
      ctx.fill();
      return;
    }
    this.boat(ctx, bx, yc);

    /* 矢印: ボートの上に積む。長さは飽和する目盛り */
    const L = Math.min(110, W * 0.14);
    let ay = yc - 17;
    for (const a of f.arrows) {
      this.arrow(ctx, bx, ay, L * Math.tanh(a.v / ARROW_S), c[a.col] || c['--ink'], a.name, a.lw ?? 3);
      ay -= 15;
    }
  }

  private boat(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const c = this.col;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = c['--surface'];
    ctx.strokeStyle = c['--ink'];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-17, -7);
    ctx.lineTo(8, -7);
    ctx.quadraticCurveTo(19, -4, 21, 0);
    ctx.quadraticCurveTo(19, 4, 8, 7);
    ctx.lineTo(-17, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9, -7);
    ctx.lineTo(-9, 7);
    ctx.moveTo(4, -7);
    ctx.lineTo(4, 7);
    ctx.stroke();
    /* 船外機 */
    ctx.fillStyle = c['--ink'];
    ctx.fillRect(-23, -3.5, 6, 7);
    ctx.restore();
  }

  private arrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    len: number,
    col: string,
    name: string,
    lw: number,
  ): void {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = lw;
    ctx.lineCap = 'butt';
    if (Math.abs(len) >= 2) {
      const s = Math.sign(len),
        e = x + len,
        h = Math.min(9, Math.abs(len));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(e - s * h * 0.7, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(e, y);
      ctx.lineTo(e - s * h, y - 5);
      ctx.lineTo(e - s * h, y + 5);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.font = `600 13px ${this.mono}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = len >= 0 ? 'right' : 'left';
    ctx.fillText(name, x + (len >= 0 ? -7 : 7), y + 0.5);
    ctx.textBaseline = 'alphabetic';
  }
}

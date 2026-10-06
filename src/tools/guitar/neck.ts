/**
 * 指板と弦の図（ギターを横に倒した向き。左がヘッド、右が駒、1 弦が上）。弦を押さえる指と、弦の振動を描き、
 * 押して弾く・キーボードで弾く操作を受ける。振動は弦のモードの和で描き、振幅は強調できる。
 * 弦の間隔は見やすいように実際より広げて描く（横は弦長に比例）
 */
import { coefAt, type Pluck, shapeOf } from './model';
import { fretX } from './strings';

/** 図の座標: 幅・高さ、ナットと駒の x、弦の中心の y、ナットと駒での弦の間隔 */
const W = 1000,
  H = 236,
  X0 = 46,
  XB = 944,
  YC = 112,
  SN = 24,
  SB = 34;
/** 弦の間隔の 1 mm を何単位で描くか（ナットの弦の間隔 8.6 mm が SN） */
const PX_MM = SN / 8.6;
/** 振動を描く点の数・残像を作る位相の数・足すモードの数 */
const PTS = 72,
  PHASES = 10,
  MODES = 48;

export interface NeckGeo {
  /** 弦長 [m]・フレットの数・胴とつながるフレット */
  L: number;
  frets: number;
  /** サウンドホールの直径 [m] */
  dh: number;
  /** 弦の外径 [m] と巻弦か（1 弦から） */
  d: readonly number[];
  wound: readonly boolean[];
  /** ナイロン弦のセットか（色を変える） */
  nylon: boolean;
}

/** 鳴っている弦 */
export interface Sounding {
  pl: Pluck;
  /** 弾いた時刻・指を離した時刻 [s]（離していなければ Infinity） */
  t0: number;
  damp: number;
  /** 押さえているフレット（0 は開放） */
  fret: number;
  /** 弾く向き [rad] */
  dir: number;
  /** 弾いた位置（駒からの距離） [m] */
  xb: number;
}

/** 弾いた点から広がる輪の時間 [s] と、最大の半径（図の単位） */
const RIP_S = 0.7,
  RIP_R = 36;

export interface NeckOpt {
  /** 弦 si をフレット fret で弾く（null は今押さえているフレットのまま、右手で弾く） */
  onPluck(si: number, fret: number | null): void;
  /** 今の時刻 [s]（Sounding.t0 と同じ時計） */
  now(): number;
}

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  e.setAttribute('class', cls);
  parent.appendChild(e);
  return e;
};

export class Neck {
  private geo: NeckGeo | null = null;
  private exag = 3;
  private mode: 'blur' | 'slow' = 'blur';
  private slow = 200;
  /** 弦ごとの弾く位置（駒から） [m] */
  private pos = [0.13, 0.13, 0.13, 0.13, 0.13, 0.13];
  /** 弾いた点から広がる輪 */
  private rips: { x: number; y: number; t0: number }[] = [];
  /** 輪を出し終えた撥弦（同じ撥弦で 2 度出さない） */
  private readonly ripped: (Pluck | null)[] = [null, null, null, null, null, null];
  private readonly gRip: SVGGElement;
  private readonly snd: (Sounding | null)[] = [null, null, null, null, null, null];
  /** これから鳴らす弦（演奏の予定。時刻の順） */
  private readonly pend: Sounding[][] = [[], [], [], [], [], []];
  private readonly gStatic: SVGGElement;
  private readonly lines: SVGPathElement[] = [];
  private readonly vib: SVGPathElement[] = [];
  private readonly dots: SVGCircleElement[] = [];
  /** 弦の番号の左の、鳴っている印 */
  private readonly leds: SVGCircleElement[] = [];
  private readonly hover: SVGRectElement;
  private readonly cursor: SVGRectElement;
  private readonly posMk: SVGGElement;
  private raf = 0;
  /** キーボードの位置（弦・フレット） */
  private cur = { si: 0, fret: 0 };

  constructor(
    readonly svg: SVGSVGElement,
    private readonly opt: NeckOpt,
  ) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.gStatic = el('g', 'nk-st', svg);
    this.posMk = el('g', 'nk-pos', svg);
    this.gRip = el('g', 'nk-rips', svg);
    const gs = el('g', 'nk-strs', svg);
    for (let i = 0; i < 6; i++) {
      this.lines.push(el('path', 'nk-s', gs));
      this.vib.push(el('path', 'nk-v', gs));
    }
    const gl = el('g', 'nk-leds', svg);
    for (let i = 0; i < 6; i++) {
      const c = el('circle', 'nk-led', gl);
      c.setAttribute('r', '4');
      this.leds.push(c);
    }
    const gd = el('g', 'nk-dots', svg);
    for (let i = 0; i < 6; i++) {
      const c = el('circle', 'nk-f', gd);
      c.setAttribute('r', '6.5');
      c.style.display = 'none';
      this.dots.push(c);
    }
    this.hover = el('rect', 'nk-hv', svg);
    this.cursor = el('rect', 'nk-cur', svg);
    this.hover.style.display = this.cursor.style.display = 'none';
    this.bind();
  }

  /* ---------- 座標 ---------- */
  /** ナットからの距離 [m] → x */
  private X(xm: number): number {
    const L = this.geo?.L ?? 0.65;
    return X0 + (xm / L) * (XB - X0);
  }
  /** 弦の行（0 が上）の、x での y */
  private rowY(r: number, x: number): number {
    const u = (x - X0) / (XB - X0);
    return YC + (r - 2.5) * (SN + (SB - SN) * u);
  }
  /** 弦の行（ヘッドを左にして、1 弦が上） */
  private row(si: number): number {
    return si;
  }
  /** 指板の終わり（最後のフレットの少し先） [m] */
  private boardEnd(): number {
    const g = this.geo;
    return g ? fretX(g.L, g.frets) + 0.008 : 0.45;
  }

  /* ---------- 設定 ---------- */
  setGeo(g: NeckGeo): void {
    this.geo = g;
    this.drawStatic();
    this.drawIdle();
  }
  /** 弦ごとの弾く位置（駒からの距離 [m]、1 弦から） */
  setPos(m: readonly number[]): void {
    this.pos = m.slice();
    this.drawPos();
  }
  setExag(k: number): void {
    this.exag = k;
    this.kick();
  }
  setMode(m: 'blur' | 'slow'): void {
    this.mode = m;
    this.kick();
  }
  setSlow(n: number): void {
    this.slow = n;
    this.kick();
  }
  /** 弦の振動を始める・止める（null で消す）。t0 が先なら、その時刻に始める */
  set(si: number, s: Sounding | null): void {
    if (s && s.t0 > this.opt.now() + 0.005) {
      this.pend[si].push(s);
      this.pend[si].sort((a, b) => a.t0 - b.t0);
    } else this.snd[si] = s;
    this.kick();
  }
  /** 予定をすべて消す */
  clearPending(): void {
    for (const p of this.pend) p.length = 0;
  }
  get(si: number): Sounding | null {
    return this.snd[si];
  }

  /* ---------- 描画 ---------- */
  private drawStatic(): void {
    const g = this.geo;
    if (!g) return;
    const xe = this.X(this.boardEnd()),
      pad = 13,
      yTop = (x: number) => this.rowY(0, x) - pad,
      yBot = (x: number) => this.rowY(5, x) + pad,
      r = (g.dh / 2 / g.L) * (XB - X0),
      hx = xe + r + 8,
      join = this.X(fretX(g.L, g.nylon ? 12 : 14));
    let h = '';
    /* 表板・サウンドホールとロゼッタ・駒 */
    h += `<rect class="nk-top" x="${join.toFixed(1)}" y="0" width="${(W - join).toFixed(1)}" height="${H}"/>`;
    h += `<path class="nk-edge" d="M${join.toFixed(1)} 0V${H}"/>`;
    for (const k of [16, 11, 7])
      h += `<circle class="nk-ros" cx="${hx.toFixed(1)}" cy="${YC}" r="${(r + k).toFixed(1)}"/>`;
    h += `<circle class="nk-hole" cx="${hx.toFixed(1)}" cy="${YC}" r="${r.toFixed(1)}"/>`;
    const by0 = yTop(XB) - 6,
      by1 = yBot(XB) + 6;
    h += `<rect class="nk-br" x="${XB - 10}" y="${by0.toFixed(1)}" width="34" height="${(by1 - by0).toFixed(1)}" rx="4"/>`;
    h += `<path class="nk-sad" d="M${XB} ${(by0 + 4).toFixed(1)}V${(by1 - 4).toFixed(1)}"/>`;
    /* ヘッドの端・指板・フレット・ナット */
    h += `<path class="nk-head" d="M0 ${(yTop(X0) - 6).toFixed(1)}H${X0}V${(yBot(X0) + 6).toFixed(1)}H0Z"/>`;
    h += `<path class="nk-board" d="M${X0} ${yTop(X0).toFixed(1)}L${xe.toFixed(1)} ${yTop(xe).toFixed(1)}V${yBot(xe).toFixed(1)}L${X0} ${yBot(X0).toFixed(1)}Z"/>`;
    const marks = [3, 5, 7, 9, 15, 17, 19].filter((n) => n <= g.frets);
    for (const n of marks) {
      const x = this.X((fretX(g.L, n - 1) + fretX(g.L, n)) / 2);
      h += `<circle class="nk-in" cx="${x.toFixed(1)}" cy="${YC}" r="3.2"/>`;
    }
    {
      const x = this.X((fretX(g.L, 11) + fretX(g.L, 12)) / 2);
      h += `<circle class="nk-in" cx="${x.toFixed(1)}" cy="${(YC - 1.5 * SN).toFixed(1)}" r="3.2"/><circle class="nk-in" cx="${x.toFixed(1)}" cy="${(YC + 1.5 * SN).toFixed(1)}" r="3.2"/>`;
    }
    for (let n = 1; n <= g.frets; n++) {
      const x = this.X(fretX(g.L, n));
      h += `<path class="nk-fr" d="M${x.toFixed(1)} ${yTop(x).toFixed(1)}V${yBot(x).toFixed(1)}"/>`;
    }
    h += `<path class="nk-nut" d="M${X0} ${(yTop(X0) - 2).toFixed(1)}V${(yBot(X0) + 2).toFixed(1)}"/>`;
    /* フレットの番号 */
    for (const n of [0, ...marks, 12].sort((a, b) => a - b)) {
      const x = n ? this.X((fretX(g.L, n - 1) + fretX(g.L, n)) / 2) : X0 / 2,
        y = Math.max(yBot(x), yBot(X0)) + 15;
      h += `<text class="nk-n" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${n}</text>`;
    }
    /* 弦の番号（ヘッドの側） */
    for (let si = 0; si < 6; si++)
      h += `<text class="nk-sn" x="${X0 - 10}" y="${(this.rowY(this.row(si), X0) + 3.5).toFixed(1)}" text-anchor="end">${si + 1}</text>`;
    this.gStatic.innerHTML = h;
    for (let si = 0; si < 6; si++) {
      this.leds[si].setAttribute('cx', '14');
      this.leds[si].setAttribute('cy', this.rowY(this.row(si), X0).toFixed(1));
      /* 線の太さ: 細い弦はおよそ外径に比例、太い弦はさらに太く（0.5 mm を超えた分を強める） */
      const dm = g.d[si] * 1000,
        w = Math.max(1, 2.2 * dm * (1 + 0.7 * Math.max(0, dm - 0.5)));
      this.lines[si].style.strokeWidth = w.toFixed(2);
      /* 振動している弦も同じ太さで描く */
      this.vib[si].style.strokeWidth = w.toFixed(2);
      this.lines[si].classList.toggle('wd', g.wound[si]);
      this.lines[si].classList.toggle('ny', g.nylon && !g.wound[si]);
    }
    this.drawPos();
  }

  /** 弾く位置の印: 各弦の弾く点を結ぶ線（両端は少し延ばす）と、下の三角 */
  private drawPos(): void {
    const g = this.geo;
    if (!g) return;
    const pt = this.pos.map((p, si) => {
        const x = this.X(g.L - p);
        return [x, this.rowY(this.row(si), x)];
      }),
      ext = (a: number[], b: number[], k: number) => [a[0] + (a[0] - b[0]) * k, a[1] + (a[1] - b[1]) * k],
      top = ext(pt[0], pt[1], 10 / Math.max(1, pt[1][1] - pt[0][1])),
      bot = ext(pt[5], pt[4], 10 / Math.max(1, pt[5][1] - pt[4][1])),
      [bx, by] = bot;
    this.posMk.innerHTML = `<path class="nk-pl" d="M${[top, ...pt, bot].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}"/><path class="nk-pm" d="M${(bx - 5).toFixed(1)} ${(by + 8).toFixed(1)}L${bx.toFixed(1)} ${(by + 1).toFixed(1)}L${(bx + 5).toFixed(1)} ${(by + 8).toFixed(1)}Z"/>`;
  }

  /** 弾いた点から広がる輪を描く。描くものが残っていれば true */
  private drawRips(now: number): boolean {
    this.rips = this.rips.filter((r) => now - r.t0 < RIP_S);
    let h = '';
    for (const r of this.rips) {
      const u = Math.max(0, now - r.t0) / RIP_S;
      h += `<circle class="nk-rip" cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${(3 + RIP_R * u ** 0.6).toFixed(1)}" opacity="${(1 - u).toFixed(3)}"/>`;
    }
    if (this.gRip.innerHTML !== h) this.gRip.innerHTML = h;
    return this.rips.length > 0;
  }

  /** 弦をまっすぐに描く（鳴っていない弦） */
  private straight(si: number): void {
    const r = this.row(si);
    this.lines[si].setAttribute('d', `M${X0} ${this.rowY(r, X0).toFixed(2)}L${XB} ${this.rowY(r, XB).toFixed(2)}`);
    this.vib[si].setAttribute('d', '');
    this.dots[si].style.display = 'none';
  }
  private drawIdle(): void {
    for (let si = 0; si < 6; si++) if (!this.snd[si]) this.straight(si);
    this.kick();
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** 1 コマ描く。鳴っている弦がなくなったら止める */
  private frame(): void {
    this.raf = 0;
    const g = this.geo;
    if (!g) return;
    const now = this.opt.now();
    let any = false;
    for (let si = 0; si < 6; si++) {
      const p = this.pend[si];
      while (p.length && p[0].t0 <= now) this.snd[si] = p.shift() as Sounding;
      if (p.length) any = true;
      const s = this.snd[si];
      this.leds[si].classList.toggle('on', !!s);
      if (!s) continue;
      const t = now - s.t0;
      if (t >= 0 && this.ripped[si] !== s.pl) {
        this.ripped[si] = s.pl;
        const x = this.X(g.L - s.xb);
        this.rips.push({ x, y: this.rowY(this.row(si), x), t0: s.t0 });
      }
      if (this.drawString(si, s, t, now)) any = true;
      else {
        this.snd[si] = null;
        this.straight(si);
        this.leds[si].classList.remove('on');
      }
    }
    if (this.drawRips(now)) any = true;
    if (any) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** 鳴っている弦を描く。消えたら false */
  private drawString(si: number, s: Sounding, t: number, now: number): boolean {
    const g = this.geo as NeckGeo,
      r = this.row(si),
      Lv = s.pl.modes.L,
      xf = this.X(g.L - Lv),
      k = this.exag * PX_MM * 1000,
      fade = now > s.damp ? Math.exp(-(now - s.damp) / 0.06) : 1;
    /* ナット側（押さえた点まで）はまっすぐ */
    this.lines[si].setAttribute(
      'd',
      s.fret > 0 ? `M${X0} ${this.rowY(r, X0).toFixed(2)}L${xf.toFixed(2)} ${this.rowY(r, xf).toFixed(2)}` : '',
    );
    const xs: number[] = [],
      base: number[] = [];
    for (let j = 0; j <= PTS; j++) {
      const xb = Lv * (1 - j / PTS);
      xs.push(xb);
      base.push(this.rowY(r, this.X(g.L - xb)));
    }
    const sx = (j: number) => this.X(g.L - xs[j]).toFixed(1);
    let d = '',
      peak = 0;
    if (this.mode === 'slow') {
      const c = coefAt(s.pl, t / this.slow, t, s.dir, MODES);
      for (let j = 0; j <= PTS; j++) {
        const y = shapeOf(c, Lv, xs[j]) * fade;
        peak = Math.max(peak, Math.abs(y));
        d += `${j ? 'L' : 'M'}${sx(j)} ${(base[j] - y * k).toFixed(2)}`;
      }
    } else {
      /* 残像: 1 周期の中のいくつかの瞬間の形の最大と最小 */
      const T1 = (2 * Math.PI) / s.pl.modes.w[0],
        hi = new Float64Array(PTS + 1).fill(-Infinity),
        lo = new Float64Array(PTS + 1).fill(Infinity);
      for (let p = 0; p < PHASES; p++) {
        const tt = t + (p / PHASES) * T1,
          c = coefAt(s.pl, tt, t, s.dir, MODES);
        for (let j = 0; j <= PTS; j++) {
          const y = shapeOf(c, Lv, xs[j]) * fade;
          if (y > hi[j]) hi[j] = y;
          if (y < lo[j]) lo[j] = y;
        }
      }
      for (let j = 0; j <= PTS; j++) {
        peak = Math.max(peak, hi[j], -lo[j]);
        d += `${j ? 'L' : 'M'}${sx(j)} ${(base[j] - hi[j] * k).toFixed(2)}`;
      }
      for (let j = PTS; j >= 0; j--) d += `L${sx(j)} ${(base[j] - lo[j] * k).toFixed(2)}`;
      d += 'Z';
    }
    this.vib[si].setAttribute('d', d);
    this.vib[si].classList.toggle('band', this.mode !== 'slow');
    /* 押さえている指 */
    const dot = this.dots[si];
    if (s.fret > 0 && now < s.damp) {
      const x = this.X(fretX(g.L, s.fret - 1) + 0.68 * (fretX(g.L, s.fret) - fretX(g.L, s.fret - 1)));
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', this.rowY(r, x).toFixed(1));
      dot.style.display = '';
    } else dot.style.display = 'none';
    /* 1 µm を下回ったら消す */
    return peak > 1e-6 || now < s.damp;
  }

  /* ---------- 操作 ---------- */
  /** 図の座標 → 弦とフレット（右の胴の上なら null：押さえているフレットのまま） */
  private hit(x: number, y: number): { si: number; fret: number | null } | null {
    const g = this.geo;
    if (!g || x < 0 || x > W) return null;
    const sp = SN + ((SB - SN) * (x - X0)) / (XB - X0),
      r = Math.round((y - YC) / sp + 2.5);
    if (r < 0 || r > 5 || Math.abs(y - this.rowY(r, x)) > sp * 0.75) return null;
    const si = r;
    if (x < X0) return { si, fret: 0 };
    const xm = ((x - X0) / (XB - X0)) * g.L;
    if (xm > fretX(g.L, g.frets)) return { si, fret: null };
    for (let n = 1; n <= g.frets; n++) if (xm <= fretX(g.L, n)) return { si, fret: n };
    return { si, fret: null };
  }

  /** 弦 si・フレット fret のます目 */
  private cell(si: number, fret: number): [number, number, number, number] {
    const g = this.geo as NeckGeo,
      x0 = fret ? this.X(fretX(g.L, fret - 1)) : 2,
      x1 = fret ? this.X(fretX(g.L, fret)) : X0 - 2,
      xm = (x0 + x1) / 2,
      sp = SN + ((SB - SN) * (xm - X0)) / (XB - X0),
      y = this.rowY(this.row(si), xm);
    return [x0 + 1, y - sp / 2, x1 - x0 - 2, sp];
  }
  private showRect(rc: SVGRectElement, c: [number, number, number, number] | null): void {
    if (!c) {
      rc.style.display = 'none';
      return;
    }
    rc.setAttribute('x', c[0].toFixed(1));
    rc.setAttribute('y', c[1].toFixed(1));
    rc.setAttribute('width', c[2].toFixed(1));
    rc.setAttribute('height', c[3].toFixed(1));
    rc.setAttribute('rx', '3');
    rc.style.display = '';
  }

  private bind(): void {
    const { svg } = this;
    const at = (e: PointerEvent) => {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      return this.hit(p.x, p.y);
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const h = at(e);
      if (!h) return;
      e.preventDefault();
      this.opt.onPluck(h.si, h.fret);
    });
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const h = at(e);
      this.showRect(this.hover, h && h.fret !== null ? this.cell(h.si, h.fret) : null);
      svg.style.cursor = h ? 'pointer' : '';
    });
    svg.addEventListener('pointerleave', () => this.showRect(this.hover, null));
    svg.addEventListener('focus', () => this.showRect(this.cursor, this.cell(this.cur.si, this.cur.fret)));
    svg.addEventListener('blur', () => this.showRect(this.cursor, null));
    svg.addEventListener('keydown', (e) => {
      const g = this.geo;
      if (!g) return;
      const c = this.cur,
        up = -1;
      if (e.key === 'ArrowUp') c.si = Math.max(0, Math.min(5, c.si + up));
      else if (e.key === 'ArrowDown') c.si = Math.max(0, Math.min(5, c.si - up));
      else if (e.key === 'ArrowLeft') c.fret = Math.max(0, c.fret - 1);
      else if (e.key === 'ArrowRight') c.fret = Math.min(g.frets, c.fret + 1);
      else if (e.key === 'Enter' || e.key === ' ') this.opt.onPluck(c.si, c.fret);
      else return;
      e.preventDefault();
      this.showRect(this.cursor, this.cell(c.si, c.fret));
    });
  }
}

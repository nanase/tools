/**
 * 鍵盤と弦の図（グランドピアノを上から見た向き。手前に鍵盤、奥へ弦が伸び、低音が左）。
 * 弦の長さは実際の長さに比例させ、弦の間隔と振動の幅は見やすいように広げて描く。
 * ハンマーが打つ点・ダンパー・駒を示し、鳴っている弦の振動（残像・スロー）を描く。鍵や弦を押して弾く操作を受ける
 */
import type { StringView } from './model';
import { isBlack, KEY_HI, KEY_LO, KEYS } from './strings';

/** 図の座標: 幅・高さ、鍵盤の左右の端と上端、白鍵・黒鍵の長さ、弦の手前の端 */
const W = 1000,
  H = 352,
  KX0 = 6,
  KX1 = 994,
  KY = 268,
  WH = 78,
  BH = 48,
  SY0 = 252;
/** 最も長い弦を描く長さ */
const LEN_PX = 214;
/** 弦の間隔（半音あたり） */
const SP = (KX1 - KX0) / KEYS;
/** 振動を描く点の数・残像を作る位相の数・足す部分音の数 */
const PTS = 24,
  PHASES = 8,
  PARTS = 24;
/** ×1 のとき、変位 1 mm を何単位で描くか（弦の間隔 13.7 mm を SP とする） */
const PX_MM = SP / 13.7;
/** 弾いた点から広がる輪の時間 [s] と最大の半径 */
const RIP_S = 0.6,
  RIP_R = 26;

/** 1 つの鍵の弦（描く寸法） */
export interface KeyGeo {
  /** 弦長 [m]・打つ点（手前の端から） [m]・ダンパーのある鍵か・巻弦か・外径 [m] */
  L: number;
  x0: number;
  damper: boolean;
  wound: boolean;
  d: number;
}

/** 鳴っている弦 */
export interface Sounding {
  view: StringView;
  /** 打った時刻 [s] */
  t0: number;
  /** ダンパーが下りた時刻 [s]（下りていなければ Infinity）と、そのときの減衰率 [1/s] */
  damp: number;
  sd: number;
}

export interface KeysOpt {
  /** 鍵 key を押す・離す */
  onKey(key: number, down: boolean): void;
  now(): number;
}

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  e.setAttribute('class', cls);
  parent.appendChild(e);
  return e;
};

/** sin(nπ j / PTS)（n = 1〜PARTS） */
const SIN = Array.from({ length: PARTS }, (_, i) =>
  Float64Array.from({ length: PTS + 1 }, (_, j) => Math.sin(((i + 1) * Math.PI * j) / PTS)),
);

/** 白鍵の番号（左から）と、黒鍵の左右の位置 */
function keyRect(key: number): [number, number, number, number] {
  let wi = 0;
  for (let k = KEY_LO; k < key; k++) if (!isBlack(k)) wi++;
  const nw = 52,
    ww = (KX1 - KX0) / nw;
  if (!isBlack(key)) return [KX0 + wi * ww, KY, ww, WH];
  const bw = ww * 0.58;
  return [KX0 + wi * ww - bw / 2, KY, bw, BH];
}

export class Keys {
  private geo: KeyGeo[] = [];
  private scale = LEN_PX / 2;
  private exag = 10;
  private mode: 'blur' | 'slow' = 'blur';
  private slow = 50;
  private readonly snd = new Map<number, Sounding>();
  private readonly pend: { key: number; s: Sounding }[] = [];
  private readonly down = new Set<number>();
  private pedal = false;
  private rips: { x: number; y: number; t0: number }[] = [];
  private readonly gStatic: SVGGElement;
  private readonly gDamp: SVGGElement;
  private readonly gVib: SVGPathElement;
  private readonly gRip: SVGGElement;
  private readonly keyEls: SVGRectElement[] = [];
  private readonly hover: SVGRectElement;
  private readonly cursor: SVGRectElement;
  private raf = 0;
  private cur = 60;
  /** ポインタごとの押している鍵 */
  private readonly ptr = new Map<number, number>();

  constructor(
    readonly svg: SVGSVGElement,
    private readonly opt: KeysOpt,
  ) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.gStatic = el('g', 'kb-st', svg);
    this.gDamp = el('g', 'kb-dmp', svg);
    this.gVib = el('path', 'kb-v', svg);
    this.gRip = el('g', 'kb-rips', svg);
    const gk = el('g', 'kb-keys', svg);
    const order = [...Array.from({ length: KEYS }, (_, i) => i + KEY_LO).filter((k) => !isBlack(k))];
    order.push(...Array.from({ length: KEYS }, (_, i) => i + KEY_LO).filter(isBlack));
    for (let i = 0; i < KEYS; i++) this.keyEls.push(null as unknown as SVGRectElement);
    for (const k of order) {
      const r = el('rect', isBlack(k) ? 'kk b' : 'kk w', gk),
        [x, y, w, h] = keyRect(k);
      r.setAttribute('x', x.toFixed(2));
      r.setAttribute('y', String(y));
      r.setAttribute('width', w.toFixed(2));
      r.setAttribute('height', String(h));
      r.setAttribute('rx', '2');
      r.dataset.k = String(k);
      this.keyEls[k - KEY_LO] = r;
    }
    this.hover = el('rect', 'kb-hv', svg);
    this.cursor = el('rect', 'kb-cur', svg);
    this.hover.style.display = this.cursor.style.display = 'none';
    this.bind();
  }

  /* ---------- 座標 ---------- */
  private sx(key: number): number {
    return KX0 + (key - KEY_LO + 0.5) * SP;
  }
  /** 手前の端からの距離 [m] → y */
  private sy(m: number): number {
    return SY0 - m * this.scale;
  }

  /* ---------- 設定 ---------- */
  setGeo(g: KeyGeo[]): void {
    this.geo = g;
    const Lmax = Math.max(...g.map((x) => x.L));
    this.scale = LEN_PX / Math.max(1.6, Lmax);
    this.drawStatic();
    this.drawDampers();
    this.kick();
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
  /** 鍵を押している表示 */
  setDown(key: number, on: boolean): void {
    if (on) this.down.add(key);
    else this.down.delete(key);
    this.keyEls[key - KEY_LO]?.classList.toggle('on', on);
    this.drawDampers();
  }
  setPedal(on: boolean): void {
    this.pedal = on;
    this.drawDampers();
  }
  /** 弦の振動を始める（t0 が先なら、その時刻に始める） */
  set(key: number, s: Sounding): void {
    if (s.t0 > this.opt.now() + 0.005) {
      this.pend.push({ key, s });
      this.pend.sort((a, b) => a.s.t0 - b.s.t0);
    } else this.start(key, s);
    this.kick();
  }
  /** ダンパーが下りた（鍵 key の振動を、時刻 t から減衰させる） */
  dampAt(key: number, t: number, sd: number): void {
    const s = this.snd.get(key);
    if (s && s.damp > t) {
      s.damp = t;
      s.sd = sd;
    }
    for (const p of this.pend) if (p.key === key && p.s.damp > t && p.s.t0 < t) p.s.damp = t;
  }
  /** 予定と振動をすべて消す */
  clear(): void {
    this.pend.length = 0;
    this.snd.clear();
    this.kick();
  }
  sounding(): Set<number> {
    return new Set(this.snd.keys());
  }

  private start(key: number, s: Sounding): void {
    this.snd.set(key, s);
    const g = this.geo[key - KEY_LO];
    if (g) this.rips.push({ x: this.sx(key), y: this.sy(g.x0), t0: s.t0 });
  }

  /* ---------- 描画 ---------- */
  private drawStatic(): void {
    const g = this.geo;
    if (!g.length) return;
    let h = '';
    /* 枠（弦の奥の端をなぞる外形）と響板 */
    const ends = g.map((x, i) => [this.sx(i + KEY_LO), this.sy(x.L)] as const),
      top = Math.min(...ends.map((e) => e[1])) - 14;
    let rim = `M${KX0 - 4} ${SY0 + 8}L${KX0 - 4} ${top.toFixed(1)}`;
    for (let i = 0; i < ends.length; i += 4) rim += `L${(ends[i][0] + 6).toFixed(1)} ${(ends[i][1] - 12).toFixed(1)}`;
    rim += `L${KX1 + 4} ${(ends[ends.length - 1][1] - 12).toFixed(1)}L${KX1 + 4} ${SY0 + 8}Z`;
    h += `<path class="kb-rim" d="${rim}"/>`;
    /* 駒（高音の駒と、巻弦の低音の駒） */
    let tb = '',
      bb = '';
    g.forEach((x, i) => {
      const p = `${this.sx(i + KEY_LO).toFixed(1)} ${(this.sy(x.L) - 1.5).toFixed(1)}`;
      if (x.wound) bb += `${bb ? 'L' : 'M'}${p}`;
      else tb += `${tb ? 'L' : 'M'}${p}`;
    });
    h += `<path class="kb-br" d="${tb}"/><path class="kb-br" d="${bb}"/>`;
    /* 弦の手前の端（アグラフ）の線 */
    h += `<path class="kb-ag" d="M${KX0} ${SY0}H${KX1}"/>`;
    /* 弦（巻弦は太く濃く） */
    g.forEach((x, i) => {
      const xs = this.sx(i + KEY_LO).toFixed(1),
        w = Math.max(0.7, Math.min(3, x.d * 1000 * 0.55));
      h += `<path class="kb-s${x.wound ? ' wd' : ''}" style="stroke-width:${w.toFixed(2)}" d="M${xs} ${SY0}V${this.sy(x.L).toFixed(1)}"/>`;
    });
    /* 打つ点を結ぶ線 */
    let hl = '';
    g.forEach((x, i) => {
      hl += `${i ? 'L' : 'M'}${this.sx(i + KEY_LO).toFixed(1)} ${this.sy(x.x0).toFixed(1)}`;
    });
    h += `<path class="kb-hl" d="${hl}"/>`;
    /* オクターブの目印（C の鍵の上の音名） */
    for (let k = 24; k <= KEY_HI; k += 12) {
      const [x, , w] = keyRect(k);
      h += `<text class="kb-n" x="${(x + w / 2).toFixed(1)}" y="${KY + WH - 6}" text-anchor="middle">C${k / 12 - 1}</text>`;
    }
    this.gStatic.innerHTML = h;
  }

  /** ダンパー（鍵を押しているか、ペダルを踏んでいれば上がる） */
  private drawDampers(): void {
    const g = this.geo;
    let h = '';
    g.forEach((x, i) => {
      if (!x.damper) return;
      const k = i + KEY_LO,
        up = this.pedal || this.down.has(k),
        y = this.sy(Math.min(x.L * 0.6, x.x0 + 0.035));
      h += `<rect class="kb-d${up ? ' up' : ''}" x="${(this.sx(k) - SP * 0.38).toFixed(1)}" y="${(y - (up ? 7 : 3)).toFixed(1)}" width="${(SP * 0.76).toFixed(1)}" height="5" rx="1"/>`;
    });
    this.gDamp.innerHTML = h;
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** 1 コマ描く。鳴っている弦がなくなったら止める */
  private frame(): void {
    this.raf = 0;
    const now = this.opt.now();
    while (this.pend.length && this.pend[0].s.t0 <= now) {
      const p = this.pend.shift() as { key: number; s: Sounding };
      this.start(p.key, p.s);
    }
    let d = '';
    for (const [key, s] of this.snd) {
      const r = this.drawString(key, s, now);
      if (r === null) this.snd.delete(key);
      else d += r;
    }
    this.gVib.setAttribute('d', d);
    this.gVib.classList.toggle('band', this.mode !== 'slow');
    const rip = this.drawRips(now);
    if (this.snd.size || this.pend.length || rip) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** 弾いた点から広がる輪。描くものが残っていれば true */
  private drawRips(now: number): boolean {
    this.rips = this.rips.filter((r) => now - r.t0 < RIP_S);
    let h = '';
    for (const r of this.rips) {
      const u = Math.max(0, now - r.t0) / RIP_S;
      h += `<circle class="kb-rip" cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${(2 + RIP_R * u ** 0.6).toFixed(1)}" opacity="${(1 - u).toFixed(3)}"/>`;
    }
    if (this.gRip.innerHTML !== h) this.gRip.innerHTML = h;
    return this.rips.length > 0;
  }

  /** 部分音ごとの、時刻 to の位相・時刻 td の減衰での変位 [m] */
  private coef(s: Sounding, to: number, td: number): Float64Array {
    const c = new Float64Array(PARTS),
      fade = td > s.damp ? Math.exp(-s.sd * (td - s.damp)) : 1;
    for (const p of s.view.parts) {
      if (p.n > PARTS) continue;
      let y = 0;
      for (let m = 0; m < p.ar.length; m++) {
        const e = Math.exp(-p.li[m] * td),
          ph = p.lr[m] * to;
        y += e * (p.ar[m] * Math.cos(ph) - p.ai[m] * Math.sin(ph));
      }
      c[p.n - 1] += y * fade;
    }
    return c;
  }

  /** 鳴っている弦の path。消えたら null */
  private drawString(key: number, s: Sounding, now: number): string | null {
    const t = now - s.t0;
    if (t < 0) return '';
    const x = this.sx(key),
      g = this.geo[key - KEY_LO],
      k = this.exag * PX_MM * 1000,
      ys = (j: number) => (SY0 - (j / PTS) * g.L * this.scale).toFixed(1);
    let peak = 0,
      d = '';
    const shape = (c: Float64Array, out: Float64Array) => {
      for (let j = 0; j <= PTS; j++) {
        let y = 0;
        for (let n = 0; n < PARTS; n++) if (c[n]) y += c[n] * SIN[n][j];
        out[j] = y;
      }
    };
    const buf = new Float64Array(PTS + 1);
    if (this.mode === 'slow') {
      shape(this.coef(s, t / this.slow, t), buf);
      for (let j = 0; j <= PTS; j++) {
        peak = Math.max(peak, Math.abs(buf[j]));
        d += `${j ? 'L' : 'M'}${(x + buf[j] * k).toFixed(1)} ${ys(j)}`;
      }
    } else {
      const w1 = s.view.parts[0]?.lr[0] ?? 1000,
        T1 = (2 * Math.PI) / Math.abs(w1),
        hi = new Float64Array(PTS + 1).fill(-Infinity),
        lo = new Float64Array(PTS + 1).fill(Infinity);
      for (let p = 0; p < PHASES; p++) {
        shape(this.coef(s, t + (p / PHASES) * T1, t), buf);
        for (let j = 0; j <= PTS; j++) {
          if (buf[j] > hi[j]) hi[j] = buf[j];
          if (buf[j] < lo[j]) lo[j] = buf[j];
        }
      }
      for (let j = 0; j <= PTS; j++) {
        peak = Math.max(peak, hi[j], -lo[j]);
        d += `${j ? 'L' : 'M'}${(x + hi[j] * k).toFixed(1)} ${ys(j)}`;
      }
      for (let j = PTS; j >= 0; j--) d += `L${(x + lo[j] * k).toFixed(1)} ${ys(j)}`;
      d += 'Z';
    }
    /* 0.5 µm を下回ったら消す */
    return peak > 5e-7 ? d : null;
  }

  /* ---------- 操作 ---------- */
  /** 図の座標 → 鍵（鍵盤の上は鍵の形で、弦の上は近い弦で） */
  private hit(x: number, y: number): number | null {
    if (x < KX0 || x > KX1 || y < 0 || y > KY + WH) return null;
    if (y >= KY) {
      if (y <= KY + BH)
        for (let k = KEY_LO; k <= KEY_HI; k++) {
          if (!isBlack(k)) continue;
          const [bx, , bw] = keyRect(k);
          if (x >= bx && x <= bx + bw) return k;
        }
      for (let k = KEY_LO; k <= KEY_HI; k++) {
        if (isBlack(k)) continue;
        const [wx, , ww] = keyRect(k);
        if (x >= wx && x <= wx + ww) return k;
      }
      return null;
    }
    const k = Math.round((x - KX0) / SP - 0.5) + KEY_LO;
    if (k < KEY_LO || k > KEY_HI) return null;
    const g = this.geo[k - KEY_LO];
    return g && y >= this.sy(g.L) - 6 && y <= SY0 + 6 ? k : null;
  }

  private showRect(rc: SVGRectElement, key: number | null): void {
    if (key === null) {
      rc.style.display = 'none';
      return;
    }
    const [x, y, w, h] = keyRect(key);
    rc.setAttribute('x', (x + 1).toFixed(1));
    rc.setAttribute('y', String(y + 1));
    rc.setAttribute('width', (w - 2).toFixed(1));
    rc.setAttribute('height', String(h - 2));
    rc.setAttribute('rx', '2');
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
    const up = (e: PointerEvent) => {
      const k = this.ptr.get(e.pointerId);
      if (k === undefined) return;
      this.ptr.delete(e.pointerId);
      if (![...this.ptr.values()].includes(k)) this.opt.onKey(k, false);
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const k = at(e);
      if (k === null) return;
      e.preventDefault();
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* 合成したイベントなど、捕まえられないポインタ */
      }
      this.ptr.set(e.pointerId, k);
      this.opt.onKey(k, true);
    });
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || this.ptr.size) return;
      const k = at(e);
      this.showRect(this.hover, k);
      svg.style.cursor = k !== null ? 'pointer' : '';
    });
    svg.addEventListener('pointerleave', () => this.showRect(this.hover, null));
    svg.addEventListener('focus', () => this.showRect(this.cursor, this.cur));
    svg.addEventListener('blur', () => this.showRect(this.cursor, null));
    let held: number | null = null;
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.cur = Math.max(KEY_LO, this.cur - 1);
      else if (e.key === 'ArrowRight') this.cur = Math.min(KEY_HI, this.cur + 1);
      else if (e.key === 'ArrowDown') this.cur = Math.max(KEY_LO, this.cur - 12);
      else if (e.key === 'ArrowUp') this.cur = Math.min(KEY_HI, this.cur + 12);
      else if (e.key === 'Enter' || e.key === ' ') {
        if (!e.repeat && held === null) {
          held = this.cur;
          this.opt.onKey(held, true);
        }
      } else return;
      e.preventDefault();
      this.showRect(this.cursor, this.cur);
    });
    svg.addEventListener('keyup', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && held !== null) {
        this.opt.onKey(held, false);
        held = null;
      }
    });
  }
}

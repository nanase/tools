/**
 * 管と鍵盤の図。選んだストップの管を、鍵の上に並べて正面から描く（管の長さと太さは実際に比例させ、図に収まるように
 * 縮める）。鳴っている管には、管の中の音圧の分布（定在波）を描く。残像は振れる範囲、スローは瞬間の分布。
 * 下の鍵盤で、選んだ鍵盤（第 1・第 2 手鍵盤、ペダル）を弾く
 */
import { isBlack } from './tuning';

/** 図の座標: 幅・高さ、鍵盤の左右の端と上端、白鍵・黒鍵の長さ、管の足の下端 */
const W = 1000,
  H = 360,
  KX0 = 6,
  KX1 = 994,
  KY = 282,
  WH = 72,
  BH = 44,
  BASE = 268;
/** 最も長い管を描く長さ（足を除く） */
const LEN_PX = 220;
/** 管の足（口より下）の長さ */
const FOOT = 16;
/** 分布を描く点の数・残像の位相の数・倍音の数 */
const PTS = 28,
  PHASES = 8,
  HARM = 12;
/** 弾いた口から広がる輪 */
const RIP_S = 0.5,
  RIP_R = 22;

/** 1 本の管の形 */
export interface PipeGeo {
  /** 管の長さ（口の上端から） [m]・内径 [m]（リード管は先端の内径と、リード側の内径） */
  l: number;
  d: number;
  d0?: number;
  kind: 'open' | 'stopped' | 'cone' | 'cyl';
}

/** 鳴っている管 */
export interface Sounding {
  /** 鍵の位置の何番目の管か（ミクスチュアは複数） */
  slot: number;
  /** 基本周波数 [Hz]・倍音ごとの管の中の音圧の振幅（最大で 1）と位相 */
  f: number;
  amp: readonly number[];
  ph: readonly number[];
  /** 弁を開いた時刻・閉じた時刻 [s]（閉じていなければ Infinity）と、立ち上がりの時定数 [s] */
  t0: number;
  t1: number;
  rise: number;
}

export interface KeysOpt {
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

export class Keys {
  /** 鍵盤の範囲（MIDI の番号） */
  private lo = 36;
  private hi = 96;
  /** 鍵ごとの管（ミクスチュアは複数） */
  private pipes: PipeGeo[][] = [];
  private scale = 1;
  private wscale = 1;
  private exag = 1;
  private mode: 'blur' | 'slow' = 'blur';
  private slow = 50;
  private readonly snd = new Map<number, Sounding[]>();
  private readonly down = new Set<number>();
  private rips: { x: number; y: number; t0: number }[] = [];
  private readonly gStatic: SVGGElement;
  private readonly gVib: SVGPathElement;
  private readonly gRip: SVGGElement;
  private readonly gKeys: SVGGElement;
  private keyEls = new Map<number, SVGRectElement>();
  private readonly hover: SVGRectElement;
  private readonly cursor: SVGRectElement;
  private raf = 0;
  private cur = 60;
  private readonly ptr = new Map<number, number>();

  constructor(
    readonly svg: SVGSVGElement,
    private readonly opt: KeysOpt,
  ) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.gStatic = el('g', 'og-st', svg);
    this.gVib = el('path', 'og-v', svg);
    this.gRip = el('g', 'og-rips', svg);
    this.gKeys = el('g', 'og-keys', svg);
    this.hover = el('rect', 'og-hv', svg);
    this.cursor = el('rect', 'og-cur', svg);
    this.hover.style.display = this.cursor.style.display = 'none';
    this.bind();
  }

  /* ---------- 座標 ---------- */
  private nWhite(): number {
    let n = 0;
    for (let k = this.lo; k <= this.hi; k++) if (!isBlack(k)) n++;
    return n;
  }
  private keyRect(key: number): [number, number, number, number] {
    let wi = 0;
    for (let k = this.lo; k < key; k++) if (!isBlack(k)) wi++;
    const ww = (KX1 - KX0) / this.nWhite();
    if (!isBlack(key)) return [KX0 + wi * ww, KY, ww, WH];
    const bw = ww * 0.58;
    return [KX0 + wi * ww - bw / 2, KY, bw, BH];
  }
  /** 鍵の管の中心の x（半音ごとに等しい間隔） */
  private px(key: number, slot = 0, n = 1): number {
    const sp = (KX1 - KX0) / (this.hi - this.lo + 1),
      x = KX0 + (key - this.lo + 0.5) * sp;
    return n > 1 ? x + (slot - (n - 1) / 2) * (sp / n) : x;
  }
  private pw(g: PipeGeo, n: number): number {
    const sp = (KX1 - KX0) / (this.hi - this.lo + 1);
    return Math.max(1.2, Math.min((0.86 * sp) / n, g.d * this.wscale));
  }

  /* ---------- 設定 ---------- */
  /** 鍵盤の範囲と、表示するストップの管 */
  setRank(lo: number, hi: number, pipes: PipeGeo[][]): void {
    this.lo = lo;
    this.hi = hi;
    this.pipes = pipes;
    const lmax = Math.max(...pipes.flat().map((g) => g.l)),
      dmax = Math.max(...pipes.flat().map((g) => g.d)),
      sp = (KX1 - KX0) / (hi - lo + 1);
    this.scale = LEN_PX / Math.max(0.3, lmax);
    this.wscale = (0.86 * sp) / dmax;
    this.snd.clear();
    this.drawStatic();
    this.drawKeys();
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
  setDown(key: number, on: boolean): void {
    if (on) this.down.add(key);
    else this.down.delete(key);
    this.keyEls.get(key)?.classList.toggle('on', on);
  }
  /** 鍵 key の管を鳴らす（同じ鍵の前の音は置きかえる） */
  set(key: number, s: Sounding[]): void {
    this.snd.set(key, s);
    const g = this.pipes[key - this.lo]?.[0];
    if (g) this.rips.push({ x: this.px(key), y: BASE - FOOT, t0: s[0]?.t0 ?? this.opt.now() });
    this.kick();
  }
  /** 鍵 key の弁を時刻 t に閉じる */
  release(key: number, t: number): void {
    for (const s of this.snd.get(key) ?? []) if (s.t1 > t) s.t1 = t;
    this.kick();
  }
  clear(): void {
    this.snd.clear();
    for (const k of [...this.down]) this.setDown(k, false);
    this.kick();
  }
  sounding(): Set<number> {
    return new Set(this.snd.keys());
  }

  /* ---------- 描画 ---------- */
  private drawStatic(): void {
    let h = '';
    /* 管を並べる台（風箱）の上面 */
    h += `<rect class="og-chest" x="${KX0}" y="${BASE}" width="${KX1 - KX0}" height="${KY - BASE - 4}"/>`;
    this.pipes.forEach((ps, i) => {
      const key = i + this.lo;
      ps.forEach((g, j) => {
        const x = this.px(key, j, ps.length),
          w = this.pw(g, ps.length),
          top = BASE - FOOT - g.l * this.scale;
        /* 足（円錐）と口 */
        h += `<path class="og-foot" d="M${(x - w / 2).toFixed(2)} ${BASE - FOOT}L${(x - 0.6).toFixed(2)} ${BASE}H${(x + 0.6).toFixed(2)}L${(x + w / 2).toFixed(2)} ${BASE - FOOT}Z"/>`;
        if (g.kind === 'cone') {
          const w0 = Math.max(1, (g.d0 ?? g.d / 8) * this.wscale);
          h += `<path class="og-pipe rd" d="M${(x - w0 / 2).toFixed(2)} ${BASE - FOOT}L${(x - w / 2).toFixed(2)} ${top.toFixed(1)}H${(x + w / 2).toFixed(2)}L${(x + w0 / 2).toFixed(2)} ${BASE - FOOT}Z"/>`;
        } else {
          h += `<rect class="og-pipe${g.kind === 'cyl' ? ' rd' : ''}" x="${(x - w / 2).toFixed(2)}" y="${top.toFixed(1)}" width="${w.toFixed(2)}" height="${(g.l * this.scale).toFixed(1)}"/>`;
          if (g.kind === 'stopped')
            h += `<rect class="og-cap" x="${(x - w / 2 - 0.6).toFixed(2)}" y="${(top - 2).toFixed(1)}" width="${(w + 1.2).toFixed(2)}" height="3"/>`;
        }
        if (g.kind === 'open' || g.kind === 'stopped')
          h += `<rect class="og-mouth" x="${(x - w * 0.28).toFixed(2)}" y="${BASE - FOOT - Math.max(1.5, w * 0.22)}" width="${(w * 0.56).toFixed(2)}" height="${Math.max(1.5, w * 0.22).toFixed(2)}"/>`;
        else
          h += `<rect class="og-boot" x="${(x - Math.max(1.5, w * 0.35)).toFixed(2)}" y="${BASE - FOOT - 6}" width="${Math.max(3, w * 0.7).toFixed(2)}" height="6"/>`;
      });
    });
    /* オクターブの目印 */
    this.gStatic.innerHTML = h;
  }

  private drawKeys(): void {
    this.gKeys.innerHTML = '';
    this.keyEls.clear();
    const order = [];
    for (let k = this.lo; k <= this.hi; k++) if (!isBlack(k)) order.push(k);
    for (let k = this.lo; k <= this.hi; k++) if (isBlack(k)) order.push(k);
    for (const k of order) {
      const r = el('rect', isBlack(k) ? 'kk b' : 'kk w', this.gKeys),
        [x, y, w, h] = this.keyRect(k);
      r.setAttribute('x', x.toFixed(2));
      r.setAttribute('y', String(y));
      r.setAttribute('width', w.toFixed(2));
      r.setAttribute('height', String(h));
      r.setAttribute('rx', '2');
      r.classList.toggle('on', this.down.has(k));
      this.keyEls.set(k, r);
    }
    let t = '';
    for (let k = this.lo; k <= this.hi; k++) {
      if (k % 12) continue;
      const [x, , w] = this.keyRect(k);
      t += `<text class="kb-n" x="${(x + w / 2).toFixed(1)}" y="${KY + WH - 6}" text-anchor="middle">C${k / 12 - 1}</text>`;
    }
    this.gKeys.insertAdjacentHTML('beforeend', t);
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    this.raf = 0;
    const now = this.opt.now();
    let d = '';
    for (const [key, list] of this.snd) {
      let alive = false;
      for (const s of list) {
        const r = this.drawPipe(key, s, now, list.length);
        if (r !== null) {
          d += r;
          alive = true;
        }
      }
      if (!alive) this.snd.delete(key);
    }
    this.gVib.setAttribute('d', d);
    this.gVib.classList.toggle('band', this.mode !== 'slow');
    const rip = this.drawRips(now);
    if (this.snd.size || rip) this.raf = requestAnimationFrame(() => this.frame());
  }

  private drawRips(now: number): boolean {
    this.rips = this.rips.filter((r) => now - r.t0 < RIP_S);
    let h = '';
    for (const r of this.rips) {
      const u = Math.max(0, now - r.t0) / RIP_S;
      if (now < r.t0) continue;
      h += `<circle class="og-rip" cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${(2 + RIP_R * u ** 0.6).toFixed(1)}" opacity="${(1 - u).toFixed(3)}"/>`;
    }
    if (this.gRip.innerHTML !== h) this.gRip.innerHTML = h;
    return this.rips.length > 0;
  }

  /**
   * 管の中の音圧の分布（第 m 倍音、u は口・リードの側からの位置 0〜1）。開管は両端が圧力の節で sin(mπu)、
   * 閉管は口が節で閉じた端が腹の sin(mπu/2)（m が奇数のときが共鳴）、円筒の共鳴管はリードの側が腹で cos(mπu/2)、
   * 円錐は頂点から測った距離 r で sin(mπr)/(mπr)（リードの側は頂点を切り取った位置 r = 0.08）
   */
  private shape(g: PipeGeo, m: number, u: number): number {
    if (g.kind === 'open') return Math.sin(m * Math.PI * u);
    if (g.kind === 'stopped') return Math.sin((m * Math.PI * u) / 2);
    if (g.kind === 'cyl') return Math.cos((m * Math.PI * u) / 2);
    const r = 0.08 + 0.92 * u;
    return Math.sin(m * Math.PI * r) / (m * Math.PI * r);
  }

  /** 鳴っている管の path。消えたら null */
  private drawPipe(key: number, s: Sounding, now: number, n: number): string | null {
    const g = this.pipes[key - this.lo]?.[s.slot];
    if (!g) return null;
    const t = now - s.t0;
    if (t < 0) return '';
    const env = (1 - Math.exp(-t / s.rise)) * (now > s.t1 ? Math.exp(-(now - s.t1) / 0.04) : 1);
    if (env < 2e-3 && now > s.t1) return null;
    const x = this.px(key, s.slot, n),
      w = this.pw(g, n),
      half = Math.max(3, w / 2) * this.exag,
      bot = BASE - FOOT,
      len = g.l * this.scale,
      ys = (j: number) => (bot - (j / PTS) * len).toFixed(1),
      nh = Math.min(HARM, s.amp.length),
      val = (to: number) => {
        const out = new Float64Array(PTS + 1);
        for (let h = 0; h < nh; h++) {
          const a = s.amp[h];
          if (!a) continue;
          const m = h + 1,
            c = a * Math.cos(2 * Math.PI * m * s.f * to + s.ph[h]);
          for (let j = 0; j <= PTS; j++) out[j] += c * this.shape(g, m, j / PTS);
        }
        return out;
      };
    let d = '';
    if (this.mode === 'slow') {
      const v = val(t / this.slow);
      for (let j = 0; j <= PTS; j++) d += `${j ? 'L' : 'M'}${(x + v[j] * env * half).toFixed(1)} ${ys(j)}`;
    } else {
      const T1 = 1 / s.f,
        hi = new Float64Array(PTS + 1).fill(-Infinity),
        lo = new Float64Array(PTS + 1).fill(Infinity);
      for (let p = 0; p < PHASES; p++) {
        const v = val(t + (p / PHASES) * T1);
        for (let j = 0; j <= PTS; j++) {
          if (v[j] > hi[j]) hi[j] = v[j];
          if (v[j] < lo[j]) lo[j] = v[j];
        }
      }
      for (let j = 0; j <= PTS; j++) d += `${j ? 'L' : 'M'}${(x + hi[j] * env * half).toFixed(1)} ${ys(j)}`;
      for (let j = PTS; j >= 0; j--) d += `L${(x + lo[j] * env * half).toFixed(1)} ${ys(j)}`;
      d += 'Z';
    }
    return d;
  }

  /* ---------- 操作 ---------- */
  private hit(x: number, y: number): number | null {
    if (x < KX0 || x > KX1 || y < 0 || y > KY + WH) return null;
    if (y >= KY) {
      if (y <= KY + BH)
        for (let k = this.lo; k <= this.hi; k++) {
          if (!isBlack(k)) continue;
          const [bx, , bw] = this.keyRect(k);
          if (x >= bx && x <= bx + bw) return k;
        }
      for (let k = this.lo; k <= this.hi; k++) {
        if (isBlack(k)) continue;
        const [wx, , ww] = this.keyRect(k);
        if (x >= wx && x <= wx + ww) return k;
      }
      return null;
    }
    const sp = (KX1 - KX0) / (this.hi - this.lo + 1),
      k = Math.round((x - KX0) / sp - 0.5) + this.lo;
    if (k < this.lo || k > this.hi) return null;
    const g = this.pipes[k - this.lo]?.[0];
    return g && y >= BASE - FOOT - g.l * this.scale - 6 && y <= BASE ? k : null;
  }

  private showRect(rc: SVGRectElement, key: number | null): void {
    if (key === null) {
      rc.style.display = 'none';
      return;
    }
    const [x, y, w, h] = this.keyRect(key);
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
      if (e.key === 'ArrowLeft') this.cur = Math.max(this.lo, this.cur - 1);
      else if (e.key === 'ArrowRight') this.cur = Math.min(this.hi, this.cur + 1);
      else if (e.key === 'ArrowDown') this.cur = Math.max(this.lo, this.cur - 12);
      else if (e.key === 'ArrowUp') this.cur = Math.min(this.hi, this.cur + 12);
      else if (e.key === 'Enter' || e.key === ' ') {
        if (!e.repeat && held === null) {
          held = this.cur;
          this.opt.onKey(held, true);
        }
      } else return;
      e.preventDefault();
      this.cur = Math.min(this.hi, Math.max(this.lo, this.cur));
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

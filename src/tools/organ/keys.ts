/**
 * 管と鍵盤の図。実際のコンソールと同じく、第 2 手鍵盤・第 1 手鍵盤を上下に重ね、ペダルを一番下に置いて、3 つの鍵盤を
 * 同時に描く（押している鍵は赤）。その上に、選んだストップの管を、そのストップの鍵盤の鍵に合わせて正面から描く
 * （管の長さと太さは実際に比例させ、図に収まるように縮める）。管を描いている鍵盤は、左の札と線で示す。
 * 鳴っている管には、管の中の音圧の分布（定在波）を描く。残像は振れる範囲、スローは瞬間の分布。
 * 鍵を押したまま動かすとグリッサンドになる（押し始めた鍵盤の中で。ポインタごとに別々に動く）
 */
import { type Div, divOf } from './stops';
import { isBlack } from './tuning';

/** 図の座標: 幅・高さ、鍵盤の左右の端（左に鍵盤の札）、管の足の下端（風箱の上面）と風箱の厚さ */
const W = 1000,
  H = 446,
  KX0 = 46,
  KX1 = 994,
  BASE = 238,
  CHEST = 10;
/** 鍵盤の段（上から第 2 手鍵盤・第 1 手鍵盤・ペダル）: 上端・白鍵の長さ・黒鍵の長さ */
const ROWS: readonly { div: Div; y: number; wh: number; bh: number }[] = [
  { div: 'II', y: 256, wh: 54, bh: 33 },
  { div: 'I', y: 316, wh: 54, bh: 33 },
  { div: 'P', y: 384, wh: 58, bh: 30 },
];
/** 最も長い管を描く長さ（足を除く） */
const LEN_PX = 196;
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
  onKey(div: Div, key: number, down: boolean): void;
  now(): number;
}

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  e.setAttribute('class', cls);
  parent.appendChild(e);
  return e;
};
const rowOf = (d: Div) => ROWS.find((r) => r.div === d) ?? ROWS[0];
const kk = (d: Div, key: number) => `${d}:${key}`;

/** 鍵の矩形 [x, y, 幅, 高さ]（鍵盤 d の範囲で、白鍵を等しく並べる） */
function keyRect(d: Div, key: number): [number, number, number, number] {
  const { lo, hi } = divOf(d),
    r = rowOf(d);
  let n = 0,
    wi = 0;
  for (let k = lo; k <= hi; k++)
    if (!isBlack(k)) {
      n++;
      if (k < key) wi++;
    }
  const ww = (KX1 - KX0) / n;
  if (!isBlack(key)) return [KX0 + wi * ww, r.y, ww, r.wh];
  const bw = ww * (d === 'P' ? 0.5 : 0.58);
  return [KX0 + wi * ww - bw / 2, r.y, bw, r.bh];
}

export class Keys {
  /** 管を描く鍵盤と、その範囲（MIDI の番号） */
  private div: Div = 'I';
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
  private readonly down = new Set<string>();
  private rips: { x: number; y: number; t0: number }[] = [];
  private readonly gStatic: SVGGElement;
  private readonly gVib: SVGPathElement;
  private readonly gRip: SVGGElement;
  private readonly gKeys: SVGGElement;
  private readonly gLbl: SVGGElement;
  private readonly title: SVGTextElement;
  private readonly keyEls = new Map<string, SVGRectElement>();
  private readonly hover: SVGRectElement;
  private readonly cursor: SVGRectElement;
  private raf = 0;
  private cur: { div: Div; key: number } = { div: 'I', key: 60 };
  /** ポインタごとに押している鍵と、押し始めたのが管の図か（なぞる範囲は押し始めた鍵盤の段か、管の図の中だけ） */
  private readonly ptr = new Map<number, { div: Div; key: number; pipe: boolean }>();

  constructor(
    readonly svg: SVGSVGElement,
    private readonly opt: KeysOpt,
  ) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.title = el('text', 'kb-t', svg);
    this.title.setAttribute('x', String(KX0));
    this.title.setAttribute('y', '14');
    this.gStatic = el('g', 'og-st', svg);
    this.gVib = el('path', 'og-v', svg);
    this.gRip = el('g', 'og-rips', svg);
    this.gLbl = el('g', 'og-lbls', svg);
    this.gKeys = el('g', 'og-keys', svg);
    this.hover = el('rect', 'og-hv', svg);
    this.cursor = el('rect', 'og-cur', svg);
    this.hover.style.display = this.cursor.style.display = 'none';
    this.drawKeys();
    this.bind();
  }

  /* ---------- 座標 ---------- */
  /** 鍵の管の中心の x（管を描く鍵盤の範囲で、半音ごとに等しい間隔） */
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
  /** 管を描く鍵盤と、その鍵盤の範囲の鍵ごとの管 */
  setRank(div: Div, pipes: PipeGeo[][]): void {
    const { lo, hi } = divOf(div);
    this.div = div;
    this.lo = lo;
    this.hi = hi;
    this.pipes = pipes;
    const all = pipes.flat(),
      lmax = Math.max(0.3, ...all.map((g) => g.l)),
      dmax = Math.max(1e-3, ...all.map((g) => g.d)),
      sp = (KX1 - KX0) / (hi - lo + 1);
    this.scale = LEN_PX / lmax;
    this.wscale = (0.86 * sp) / dmax;
    this.snd.clear();
    this.drawStatic();
    this.drawLabels();
    this.kick();
  }
  /** 図の上に書く、描いている管の名前 */
  setTitle(s: string): void {
    if (this.title.textContent !== s) this.title.textContent = s;
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
  /** 鍵盤 div の鍵 key を押している（赤く塗る） */
  setDown(div: Div, key: number, on: boolean): void {
    const k = kk(div, key);
    if (on) this.down.add(k);
    else this.down.delete(k);
    this.keyEls.get(k)?.classList.toggle('on', on);
  }
  /** 管を描く鍵盤の鍵 key の管を鳴らす（同じ鍵の前の音は置きかえる） */
  set(key: number, s: Sounding[]): void {
    if (!s.length) return;
    this.snd.set(key, s);
    if (this.pipes[key - this.lo]?.[0]) this.rips.push({ x: this.px(key), y: BASE - FOOT, t0: s[0].t0 });
    this.kick();
  }
  /** 管を描く鍵盤の鍵 key の弁を時刻 t に閉じる */
  release(key: number, t: number): void {
    for (const s of this.snd.get(key) ?? []) if (s.t1 > t) s.t1 = t;
    this.kick();
  }
  /** 管の振動と、押している鍵の印を消す */
  clear(): void {
    this.snd.clear();
    for (const k of this.down) this.keyEls.get(k)?.classList.remove('on');
    this.down.clear();
    this.kick();
  }

  /* ---------- 描画 ---------- */
  private drawStatic(): void {
    let h = '';
    /* 管を並べる台（風箱）の上面 */
    h += `<rect class="og-chest" x="${KX0}" y="${BASE}" width="${KX1 - KX0}" height="${CHEST}"/>`;
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
    this.gStatic.innerHTML = h;
  }

  /** 鍵盤の札（II・I・P）。管を描いている鍵盤の札を塗り、風箱から線でつなぐ */
  private drawLabels(): void {
    let h = '';
    for (const r of ROWS) {
      const d = divOf(r.div),
        y = r.y + r.wh / 2,
        on = r.div === this.div;
      /* 風箱の左端から、ほかの札の左を通って札へ */
      if (on) h += `<path class="og-link" d="M${KX0} ${BASE + CHEST / 2}H3V${y}H8"/>`;
      h += `<rect class="kb-l${on ? ' on' : ''}" x="8" y="${y - 12}" width="28" height="24" rx="4"/>`;
      h += `<text class="kb-lt${on ? ' on' : ''}" x="22" y="${y + 4.5}" text-anchor="middle">${d.short}</text>`;
    }
    this.gLbl.innerHTML = h;
  }

  private drawKeys(): void {
    for (const r of ROWS) {
      const { lo, hi } = divOf(r.div),
        g = el('g', `kb kb-${r.div}`, this.gKeys),
        order = [];
      for (let k = lo; k <= hi; k++) if (!isBlack(k)) order.push(k);
      for (let k = lo; k <= hi; k++) if (isBlack(k)) order.push(k);
      for (const k of order) {
        const e = el('rect', isBlack(k) ? 'kk b' : 'kk w', g),
          [x, y, w, h] = keyRect(r.div, k);
        e.setAttribute('x', x.toFixed(2));
        e.setAttribute('y', String(y));
        e.setAttribute('width', w.toFixed(2));
        e.setAttribute('height', String(h));
        e.setAttribute('rx', '2');
        this.keyEls.set(kk(r.div, k), e);
      }
      let t = '';
      for (let k = lo; k <= hi; k++) {
        if (k % 12) continue;
        const [x, , w] = keyRect(r.div, k);
        t += `<text class="kb-n" x="${(x + w / 2).toFixed(1)}" y="${r.y + r.wh - 6}" text-anchor="middle">C${k / 12 - 1}</text>`;
      }
      g.insertAdjacentHTML('beforeend', t);
    }
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
  /** 点 (x, y) の鍵（鍵盤の鍵か、管を描いている鍵盤の管） */
  private hit(x: number, y: number): { div: Div; key: number } | null {
    if (x < KX0 || x > KX1) return null;
    for (const r of ROWS) {
      if (y < r.y || y > r.y + r.wh) continue;
      const { lo, hi } = divOf(r.div);
      if (y <= r.y + r.bh)
        for (let k = lo; k <= hi; k++) {
          if (!isBlack(k)) continue;
          const [bx, , bw] = keyRect(r.div, k);
          if (x >= bx && x <= bx + bw) return { div: r.div, key: k };
        }
      for (let k = lo; k <= hi; k++) {
        if (isBlack(k)) continue;
        const [wx, , ww] = keyRect(r.div, k);
        if (x >= wx && x <= wx + ww) return { div: r.div, key: k };
      }
      return null;
    }
    if (y > BASE) return null;
    const sp = (KX1 - KX0) / (this.hi - this.lo + 1),
      k = Math.round((x - KX0) / sp - 0.5) + this.lo;
    if (k < this.lo || k > this.hi) return null;
    const g = this.pipes[k - this.lo]?.[0];
    return g && y >= BASE - FOOT - g.l * this.scale - 6 ? { div: this.div, key: k } : null;
  }

  /**
   * なぞっている点 (x, y) の鍵。押し始めた鍵盤の段の中だけで探す（上下の段へ移らない。段の外は段の端に寄せ、
   * 左右の端より外は端の鍵）。管の図で押し始めたら、管の図の並びで探す
   */
  private slide(s: { div: Div; pipe: boolean }, x: number, y: number): number {
    const { lo, hi } = divOf(s.div),
      xx = Math.min(KX1 - 0.5, Math.max(KX0 + 0.5, x));
    if (s.pipe) {
      const sp = (KX1 - KX0) / (this.hi - this.lo + 1);
      return Math.min(this.hi, Math.max(this.lo, Math.round((xx - KX0) / sp - 0.5) + this.lo));
    }
    const r = rowOf(s.div),
      yy = Math.min(r.y + r.wh - 0.5, Math.max(r.y + 0.5, y));
    if (yy <= r.y + r.bh)
      for (let k = lo; k <= hi; k++) {
        if (!isBlack(k)) continue;
        const [bx, , bw] = keyRect(s.div, k);
        if (xx >= bx && xx <= bx + bw) return k;
      }
    for (let k = lo; k <= hi; k++) {
      if (isBlack(k)) continue;
      const [wx, , ww] = keyRect(s.div, k);
      if (xx >= wx && xx <= wx + ww) return k;
    }
    return hi;
  }

  private showRect(rc: SVGRectElement, at: { div: Div; key: number } | null): void {
    if (at === null) {
      rc.style.display = 'none';
      return;
    }
    const [x, y, w, h] = keyRect(at.div, at.key);
    rc.setAttribute('x', (x + 1).toFixed(1));
    rc.setAttribute('y', String(y + 1));
    rc.setAttribute('width', (w - 2).toFixed(1));
    rc.setAttribute('height', String(h - 2));
    rc.setAttribute('rx', '2');
    rc.style.display = '';
  }

  private bind(): void {
    const { svg } = this;
    const pt = (e: PointerEvent) => {
      const m = svg.getScreenCTM();
      return m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : null;
    };
    const at = (e: PointerEvent) => {
      const p = pt(e);
      return p ? this.hit(p.x, p.y) : null;
    };
    /** ポインタ id の鍵を離す（ほかのポインタが同じ鍵を押していれば、音は止めない） */
    const lift = (id: number, div: Div, key: number) => {
      if (![...this.ptr].some(([i, x]) => i !== id && x.div === div && x.key === key)) this.opt.onKey(div, key, false);
    };
    const up = (e: PointerEvent) => {
      const k = this.ptr.get(e.pointerId);
      if (k === undefined) return;
      this.ptr.delete(e.pointerId);
      lift(e.pointerId, k.div, k.key);
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = pt(e),
        k = p ? this.hit(p.x, p.y) : null;
      if (!p || k === null) return;
      e.preventDefault();
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* 合成したイベントなど、捕まえられないポインタ */
      }
      this.ptr.set(e.pointerId, { ...k, pipe: p.y <= BASE });
      this.opt.onKey(k.div, k.key, true);
    });
    /*
     * 鍵の上で始めたタッチは、スクロールさせずにグリッサンドにする。SVG の中の要素の touch-action は効かないブラウザが
     * あるので、touchstart を止める（管の図で始めたタッチは、図を横にスクロールする）
     */
    svg.addEventListener(
      'touchstart',
      (e) => {
        const t = e.changedTouches[0],
          m = svg.getScreenCTM();
        if (!t || !m) return;
        const p = new DOMPoint(t.clientX, t.clientY).matrixTransform(m.inverse());
        if (p.y > BASE && this.hit(p.x, p.y)) e.preventDefault();
      },
      { passive: false },
    );
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointermove', (e) => {
      const s = this.ptr.get(e.pointerId);
      if (!s) {
        if (e.pointerType !== 'mouse' || this.ptr.size) return;
        const k = at(e);
        this.showRect(this.hover, k);
        svg.style.cursor = k !== null ? 'pointer' : '';
        return;
      }
      /* グリッサンド: 押したまま動かすと、入った鍵を押して前の鍵を離す。図の外へ出たら離す */
      const r = svg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        up(e);
        return;
      }
      const p = pt(e);
      if (!p) return;
      const key = this.slide(s, p.x, p.y);
      if (key === s.key) return;
      const old = s.key;
      s.key = key;
      this.opt.onKey(s.div, key, true);
      lift(e.pointerId, s.div, old);
    });
    svg.addEventListener('pointerleave', () => this.showRect(this.hover, null));
    svg.addEventListener('focus', () => this.showRect(this.cursor, this.cur));
    svg.addEventListener('blur', () => this.showRect(this.cursor, null));
    let held: { div: Div; key: number } | null = null;
    svg.addEventListener('keydown', (e) => {
      const c = this.cur,
        ri = ROWS.findIndex((r) => r.div === c.div);
      if (e.key === 'ArrowLeft') c.key--;
      else if (e.key === 'ArrowRight') c.key++;
      else if (e.key === 'PageDown') c.key -= 12;
      else if (e.key === 'PageUp') c.key += 12;
      else if (e.key === 'ArrowUp') c.div = ROWS[Math.max(0, ri - 1)].div;
      else if (e.key === 'ArrowDown') c.div = ROWS[Math.min(ROWS.length - 1, ri + 1)].div;
      else if (e.key === 'Enter' || e.key === ' ') {
        if (!e.repeat && held === null) {
          held = { ...c };
          this.opt.onKey(held.div, held.key, true);
        }
      } else return;
      e.preventDefault();
      const { lo, hi } = divOf(c.div);
      c.key = Math.min(hi, Math.max(lo, c.key));
      this.showRect(this.cursor, c);
    });
    svg.addEventListener('keyup', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && held !== null) {
        this.opt.onKey(held.div, held.key, false);
        held = null;
      }
    });
  }
}

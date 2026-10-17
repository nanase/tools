/**
 * 鍵盤と弦の図（グランドピアノを上から見た向き。手前に鍵盤、奥へ弦が伸び、低音が左）。
 * 弦の長さは実際の長さの LEN_EXP 乗に比例させ（高音の短い弦も見えるように）、弦の間隔と振動の幅は見やすいように
 * 広げて描く。弦の上の位置（打つ点・ダンパー・振動）は、弦の長さに対する比で描く。
 * ハンマーが打つ点・ダンパー・駒を示し、鳴っている弦の振動（残像・スロー）を描く。振動を描いている間は、
 * その弦の止まった線を隠す。ダンパーが上がっている弦の共鳴も描く（駒を通して揺れ始め、モードごとに持ち主の鍵の
 * ダンパーが下りると止まる）。鍵や弦を押して弾く操作を受ける
 * （押したまま動かすと、ポインタの入った鍵を押し、前の鍵を離す。グリッサンド）。振動は音と同じく、ダンパーが
 * 下りると（鍵を離していてペダルも踏んでいない）止まる。画面で 0.5 px より小さい間は描かず、打ったときより
 * 60 dB 小さくなったら（聞こえなくなる目安）消す
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
/** 最も長い弦を描く長さ（1.6 m より短いピアノは、1.6 m に対する比で短く描く）と、長さを縮める指数 */
const LEN_PX = 234,
  LEN_EXP = 0.6,
  LEN_REF = 1.6;
/** 弦の間隔（半音あたり） */
const SP = (KX1 - KX0) / KEYS;
/** ダンパーを描く幅・弦を描く長さに対する長さの比と、その上限・下限・打つ点からの隙間（図の単位） */
const DMP_W = SP * 0.46,
  DMP_FRAC = 0.08,
  DMP_MAX = 16,
  DMP_MIN = 8,
  DMP_GAP = 3;
/** 振動を描く点の数・残像を作る位相の数・足す部分音の数 */
const PTS = 24,
  PHASES = 8,
  PARTS = 24;
/** ×1 のとき、変位 1 mm を何単位で描くか（弦の間隔 13.7 mm を SP とする） */
const PX_MM = SP / 13.7;
/** mf で打ったときの、弾いた点から広がる輪の時間 [s] と最大の半径 */
const RIP_S = 0.6,
  RIP_R = 26;
/** 輪の時間の下限 [s]（弱い音でも輪が見えるように）と、速さの比を時間の比にする指数 */
const RIP_S_MIN = 0.25,
  RIP_S_EXP = 0.7;
/** 輪の大きさの基準にするハンマーの速さ（mf） [m/s] と、速さの比を半径の比にする指数（mf より弱い・強い） */
const RIP_V = 2.5,
  RIP_WEAK = 0.7,
  RIP_STRONG = 0.3;

/**
 * ハンマーの速さ v [m/s] で打ったときの輪の最大の半径。弱い音ははっきり小さくし（pp で約 0.45 倍）、
 * 強い音は大きくなりすぎないようにする（ff で約 1.3 倍）
 */
export const ripRadius = (v: number): number => RIP_R * (v / RIP_V) ** (v < RIP_V ? RIP_WEAK : RIP_STRONG);

/** ハンマーの速さ v [m/s] で打ったときに輪が続く時間 [s]。強い音ほど長い（pp で約 0.27 s、ff で約 1.1 s） */
export const ripTime = (v: number): number => Math.max(RIP_S_MIN, RIP_S * (v / RIP_V) ** RIP_S_EXP);
/** 描くのをやめる振れ: 画面での大きさ [px] と、打ったときの振れに対する比（−60 dB） */
const MIN_PX = 0.5,
  MIN_REL = 1e-3;

/**
 * ポインタごとに押している鍵を持ち、押したまま動かしたときに鍵を押し替える（グリッサンド）。DOM に依存しない。
 * ほかのポインタが押している鍵は打ち直さず、離さない
 */
export class Gliss {
  private readonly ptr = new Map<number, number | null>();
  constructor(private readonly onKey: (key: number, down: boolean) => void) {}
  /** ポインタ id がこの図で押しているか（鍵の外へ出ていても） */
  has(id: number): boolean {
    return this.ptr.has(id);
  }
  get size(): number {
    return this.ptr.size;
  }
  /** ポインタ id の押している鍵を k にする（null は鍵の外） */
  move(id: number, k: number | null): void {
    const cur = this.ptr.get(id) ?? null;
    if (k === cur && this.ptr.has(id)) return;
    this.ptr.set(id, k);
    const held = [...this.ptr.values()];
    if (cur !== null && !held.includes(cur)) this.onKey(cur, false);
    if (k !== null && k !== cur && held.filter((x) => x === k).length === 1) this.onKey(k, true);
  }
  /** ポインタ id を離す */
  up(id: number): void {
    if (!this.ptr.has(id)) return;
    this.move(id, null);
    this.ptr.delete(id);
  }
}

/** ダンパーが下りてからの振れの倍率（時刻 t は s.damp と同じ絶対の時刻 [s]） */
export const damperFade = (s: Pick<Sounding, 'damp' | 'sd'>, t: number): number =>
  t > s.damp ? Math.exp(-s.sd * (t - s.damp)) : 1;

/** 1 つの鍵の弦（描く寸法） */
export interface KeyGeo {
  /** 弦長 [m]・打つ点（手前の端から） [m]・ダンパーのある鍵か・巻弦か・外径 [m] */
  L: number;
  x0: number;
  damper: boolean;
  wound: boolean;
  d: number;
}

/**
 * 鍵ごとの、ダンパーが下りていた区間の記録（DOM に依存しない）。初めはどの鍵も下りている。
 * 共鳴する弦の、モードごとの減衰を求めるのに使う
 */
export class DamperLog {
  /** 鍵ごとの区間 [下りた時刻, 上がった時刻]（いま下りていれば上がった時刻は Infinity） */
  private readonly iv: [number, number][][];
  constructor(n: number) {
    this.iv = Array.from({ length: n }, () => [[-Infinity, Infinity]]);
  }
  /** 鍵 i のダンパーが時刻 t に下りた（down）・上がった */
  set(i: number, down: boolean, t: number): void {
    const iv = this.iv[i],
      last = iv[iv.length - 1],
      isDown = last !== undefined && last[1] === Infinity;
    if (down && !isDown) {
      iv.push([t, Infinity]);
      /* 古い区間は捨てる（いま鳴っている弦の打った時刻より前のものしか消えない数にする） */
      if (iv.length > 64) iv.splice(0, iv.length - 64);
    } else if (!down && isDown) last[1] = t;
  }
  /** 鍵 i のダンパーが、時刻 a〜b の間に下りていた時間 [s] */
  downTime(i: number, a: number, b: number): number {
    let s = 0;
    for (const [d, u] of this.iv[i]) {
      const x = Math.max(a, d),
        y = Math.min(b, u);
      if (y > x) s += y - x;
    }
    return s;
  }
}

/** 鳴っている弦 */
export interface Sounding {
  view: StringView;
  /** 打った時刻 [s] と、ハンマーの速さ [m/s]（輪の大きさと続く時間に使う） */
  t0: number;
  v: number;
  /** ダンパーが下りた時刻 [s]（下りていなければ Infinity）と、ダンパーで増える減衰率 [1/s] */
  damp: number;
  sd: number;
  /** 打ったときの振れ [m]（描き始めに求める） */
  peak0?: number;
}

export interface KeysOpt {
  /** 鍵 key を押す・離す */
  onKey(key: number, down: boolean): void;
  now(): number;
  /** 鍵 key の弦にダンパーが触れたときに増える減衰率 [1/s]（表示用。ダンパーのない鍵は 0） */
  sd(key: number): number;
}

/** 共鳴して揺れている弦（打った弦の表示が始まると始まる） */
interface Res {
  view: StringView;
  t0: number;
  /** 打った弦の、打ったときの振れ [m]（消す目安の基準） */
  ref: number;
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

const ONE = () => 1;

/**
 * 部分音ごとの、時刻 to の位相・時刻 td の減衰での変位 [m]（to・td は打ってからの時間）を c に足す。
 * fade はモードの持ち主の鍵ごとのダンパーによる減衰の倍率
 */
export function coefOf(
  v: StringView,
  to: number,
  td: number,
  fade: (own: number) => number,
  c = new Float64Array(PARTS),
): Float64Array {
  for (const p of v.parts) {
    if (p.n > PARTS) continue;
    let y = 0;
    for (let m = 0; m < p.ar.length; m++) {
      const e = Math.exp(-p.li[m] * td) * fade(p.own[m]),
        ph = p.lr[m] * to;
      y += e * (p.ar[m] * Math.cos(ph) - p.ai[m] * Math.sin(ph));
    }
    c[p.n - 1] += y;
  }
  return c;
}

/** 時刻 td での振れの上限 [m]（モードの大きさの和。初めは打ち消し合って止まっている共鳴の弦でも 0 にならない） */
export function envOf(v: StringView, td: number, fade: (own: number) => number): number {
  let s = 0;
  for (const p of v.parts) {
    if (p.n > PARTS) continue;
    for (let m = 0; m < p.ar.length; m++) s += Math.hypot(p.ar[m], p.ai[m]) * Math.exp(-p.li[m] * td) * fade(p.own[m]);
  }
  return s;
}

/** 部分音の成分 c から、弦の上の PTS + 1 点の変位を out に書く */
function shapeOf(c: Float64Array, out: Float64Array): Float64Array {
  for (let j = 0; j <= PTS; j++) {
    let y = 0;
    for (let n = 0; n < PARTS; n++) if (c[n]) y += c[n] * SIN[n][j];
    out[j] = y;
  }
  return out;
}

/** 部分音の成分 c の、弦の上での振れの最大 [m] */
const peakOf = (c: Float64Array): number => Math.max(...shapeOf(c, new Float64Array(PTS + 1)).map(Math.abs));

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
  /** 鍵ごとの弦を描く長さ（図の単位） */
  private len = new Float64Array(KEYS);
  private exag = 10;
  private mode: 'blur' | 'slow' = 'blur';
  private slow = 50;
  /** 共鳴している弦を描くか */
  private symOn = true;
  private readonly snd = new Map<number, Sounding>();
  /** 鍵ごとの共鳴している弦と、ダンパーの記録。すべて止めた時刻 [s] と、そのときの減衰率 [1/s] */
  private readonly res = new Map<number, Res[]>();
  private readonly dlog = new DamperLog(KEYS);
  private stopT = Infinity;
  private stopSd = 0;
  private readonly pend: { key: number; s: Sounding }[] = [];
  private readonly down = new Set<number>();
  private pedal = false;
  /** 鍵ごとの最後に離した時刻と、最後にペダルを離した時刻 [s]（打つ前の表示を作ってから鍵を離したときに使う） */
  private readonly upAt = new Float64Array(KEYS).fill(-Infinity);
  private pedalOffAt = -Infinity;
  /** 画面の 1 px あたりの図の単位の逆数（図の単位あたりの px） */
  private pxPerUnit = 1;
  private rips: { x: number; y: number; t0: number; r: number; s: number }[] = [];
  private readonly gStatic: SVGGElement;
  private readonly gDamp: SVGGElement;
  private readonly gVib: SVGPathElement;
  private readonly gRip: SVGGElement;
  private readonly keyEls: SVGRectElement[] = [];
  /** 鍵ごとの止まった弦の線と、振動を描いているので隠している鍵 */
  private strEls: SVGPathElement[] = [];
  private readonly vib = new Set<number>();
  private readonly hover: SVGRectElement;
  private readonly cursor: SVGRectElement;
  private raf = 0;
  private cur = 60;
  /** ポインタごとの押している鍵 */
  private readonly gl: Gliss;

  constructor(
    readonly svg: SVGSVGElement,
    private readonly opt: KeysOpt,
  ) {
    this.gl = new Gliss((k, d) => this.opt.onKey(k, d));
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
    /* オクターブの目印（C の鍵の上の音名） */
    let t = '';
    for (let k = 24; k <= KEY_HI; k += 12) {
      const [x, , w] = keyRect(k);
      t += `<text class="kb-n" x="${(x + w / 2).toFixed(1)}" y="${KY + WH - 6}" text-anchor="middle">C${k / 12 - 1}</text>`;
    }
    gk.insertAdjacentHTML('beforeend', t);
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
  private sy(key: number, m: number): number {
    const g = this.geo[key - KEY_LO];
    return SY0 - (g ? (m / g.L) * this.len[key - KEY_LO] : 0);
  }

  /* ---------- 設定 ---------- */
  setGeo(g: KeyGeo[]): void {
    this.geo = g;
    const Lref = Math.max(LEN_REF, ...g.map((x) => x.L));
    this.len = Float64Array.from(g, (x) => LEN_PX * (x.L / Lref) ** LEN_EXP);
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
  /** 共鳴している弦を描くか（描かない間も、共鳴は止まるまで覚えておく） */
  setSym(on: boolean): void {
    this.symOn = on;
    this.kick();
  }
  /** 鍵を押している表示。離したとき、ペダルを踏んでいなければダンパーが下りて弦が止まり始める */
  setDown(key: number, on: boolean): void {
    if (on) this.down.add(key);
    else {
      this.down.delete(key);
      const t = this.opt.now();
      this.upAt[key - KEY_LO] = t;
      if (!this.pedal) this.dampKey(key, t);
    }
    this.logDamper(key);
    this.keyEls[key - KEY_LO]?.classList.toggle('on', on);
    this.drawDampers();
  }
  /** すべての鍵を離した表示にする */
  upAll(): void {
    const t = this.opt.now();
    for (const k of this.down) {
      this.keyEls[k - KEY_LO]?.classList.remove('on');
      this.upAt[k - KEY_LO] = t;
      if (!this.pedal) this.dampKey(k, t);
    }
    const ks = [...this.down];
    this.down.clear();
    for (const k of ks) this.logDamper(k);
    this.drawDampers();
  }
  /** ペダル。離すと、押していない鍵の弦のダンパーが下りる */
  setPedal(on: boolean): void {
    if (this.pedal && !on) {
      const t = this.opt.now();
      this.pedalOffAt = t;
      for (const k of new Set([...this.snd.keys(), ...this.pend.map((p) => p.key)]))
        if (!this.down.has(k)) this.dampKey(k, t);
    }
    this.pedal = on;
    for (let k = KEY_LO; k <= KEY_HI; k++) this.logDamper(k);
    this.drawDampers();
  }
  /** 鍵 key のダンパーの状態を記録する（鍵を押しているか、ペダルを踏んでいれば上がっている） */
  private logDamper(key: number): void {
    this.dlog.set(key - KEY_LO, !this.pedal && !this.down.has(key), this.opt.now());
  }
  /** 鍵 key のダンパーが時刻 t に下りた（ダンパーのない弦は止まらない） */
  private dampKey(key: number, t: number): void {
    if (!this.geo[key - KEY_LO]?.damper) return;
    const s = this.snd.get(key);
    if (s && s.damp > t) s.damp = t;
    for (const p of this.pend) if (p.key === key && p.s.damp > t && p.s.t0 < t) p.s.damp = t;
  }
  /** 弦の振動を始める（t0 が先なら、その時刻に始める） */
  set(key: number, s: Sounding): void {
    if (s.t0 > this.opt.now() + 0.005) {
      this.pend.push({ key, s });
      this.pend.sort((a, b) => a.s.t0 - b.s.t0);
    } else this.start(key, s);
    this.kick();
  }
  /**
   * 鍵 key の振動を、時刻 t から減衰率 sd [1/s] で止める（すべて止めるとき）。すでにダンパーで止まり始めていれば、
   * そこまでの減衰を保ったまま、t から速い減衰に切り替える
   */
  dampAt(key: number, t: number, sd: number): void {
    /* 共鳴している弦と、打った弦のほかの鍵が持ち主のモードは、t からこの減衰率で止める */
    this.stopT = t;
    this.stopSd = sd;
    const s = this.snd.get(key);
    if (s) {
      if (s.damp >= t) {
        s.damp = t;
        s.sd = sd;
      } else if (sd > s.sd) {
        s.damp = t - (s.sd * (t - s.damp)) / sd;
        s.sd = sd;
      }
    }
    for (const p of this.pend)
      if (p.key === key && p.s.damp > t && p.s.t0 < t) {
        p.s.damp = t;
        p.s.sd = sd;
      }
  }
  /** 予定と振動をすべて消す */
  clear(): void {
    this.pend.length = 0;
    this.snd.clear();
    this.res.clear();
    this.kick();
  }
  sounding(): Set<number> {
    return new Set([...this.snd.keys(), ...this.res.keys()]);
  }

  private start(key: number, s: Sounding): void {
    /* 打ったあと、表示を始める前に鍵を離していた（ダンパーが下りていた）ら、その時刻から止め始める */
    const up = this.upAt[key - KEY_LO];
    if (!this.down.has(key) && !this.pedal && this.geo[key - KEY_LO]?.damper && up >= s.t0)
      s.damp = Math.min(s.damp, Math.max(up, this.pedalOffAt));
    this.snd.set(key, s);
    s.peak0 ??= peakOf(coefOf(s.view, 0, 0, ONE));
    /* 共鳴する弦（打ったときより 60 dB 以上小さいまま終わるものは描かない） */
    for (const v of s.view.sym ?? []) {
      const r: Res = { view: v, t0: s.t0, ref: s.peak0 };
      if (envOf(v, 0, ONE) < MIN_REL * r.ref) continue;
      const list = this.res.get(v.key);
      if (list) list.push(r);
      else this.res.set(v.key, [r]);
    }
    const g = this.geo[key - KEY_LO];
    if (g) this.rips.push({ x: this.sx(key), y: this.sy(key, g.x0), t0: s.t0, r: ripRadius(s.v), s: ripTime(s.v) });
  }

  /* ---------- 描画 ---------- */
  private drawStatic(): void {
    const g = this.geo;
    if (!g.length) return;
    let h = '';
    /* 枠（弦の奥の端をなぞる外形）と響板 */
    const ends = g.map((x, i) => [this.sx(i + KEY_LO), this.sy(i + KEY_LO, x.L)] as const),
      top = Math.min(...ends.map((e) => e[1])) - 14;
    let rim = `M${KX0 - 4} ${SY0 + 8}L${KX0 - 4} ${top.toFixed(1)}`;
    for (let i = 0; i < ends.length; i += 4) rim += `L${(ends[i][0] + 6).toFixed(1)} ${(ends[i][1] - 12).toFixed(1)}`;
    rim += `L${KX1 + 4} ${(ends[ends.length - 1][1] - 12).toFixed(1)}L${KX1 + 4} ${SY0 + 8}Z`;
    h += `<path class="kb-rim" d="${rim}"/>`;
    /* 駒（高音の駒と、巻弦の低音の駒） */
    let tb = '',
      bb = '';
    g.forEach((x, i) => {
      const p = `${this.sx(i + KEY_LO).toFixed(1)} ${(this.sy(i + KEY_LO, x.L) - 1.5).toFixed(1)}`;
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
      h += `<path class="kb-s${x.wound ? ' wd' : ''}" style="stroke-width:${w.toFixed(2)}" d="M${xs} ${SY0}V${this.sy(i + KEY_LO, x.L).toFixed(1)}"/>`;
    });
    /* 打つ点を結ぶ線 */
    let hl = '';
    g.forEach((x, i) => {
      hl += `${i ? 'L' : 'M'}${this.sx(i + KEY_LO).toFixed(1)} ${this.sy(i + KEY_LO, x.x0).toFixed(1)}`;
    });
    h += `<path class="kb-hl" d="${hl}"/>`;
    this.gStatic.innerHTML = h;
    this.strEls = Array.from(this.gStatic.querySelectorAll<SVGPathElement>('.kb-s'));
    this.vib.clear();
  }

  /** 振動を描いている鍵（keys）の止まった弦の線を隠し、ほかの弦は見せる */
  private hideStrings(keys: Set<number>): void {
    for (const k of this.vib)
      if (!keys.has(k)) {
        this.strEls[k - KEY_LO]?.classList.remove('vib');
        this.vib.delete(k);
      }
    for (const k of keys)
      if (!this.vib.has(k)) {
        this.strEls[k - KEY_LO]?.classList.add('vib');
        this.vib.add(k);
      }
  }

  /**
   * ダンパー（鍵を押しているか、ペダルを踏んでいれば上がり、薄く描く）。フェルトは弦に沿って長いので、打つ点のすぐ
   * 奥から弦に沿って縦長に描く
   */
  private drawDampers(): void {
    const g = this.geo;
    let h = '';
    g.forEach((x, i) => {
      if (!x.damper) return;
      const k = i + KEY_LO,
        up = this.pedal || this.down.has(k),
        len = Math.max(DMP_MIN, Math.min(DMP_MAX, DMP_FRAC * this.len[i])),
        y0 = this.sy(k, x.x0) - DMP_GAP;
      h += `<rect class="kb-d${up ? ' up' : ''}" x="${(this.sx(k) - DMP_W / 2).toFixed(1)}" y="${(y0 - len).toFixed(1)}" width="${DMP_W.toFixed(1)}" height="${len.toFixed(1)}" rx="1.5"/>`;
    });
    this.gDamp.innerHTML = h;
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** 1 コマ描く。鳴っている弦がなくなったら止める */
  private frame(): void {
    this.raf = 0;
    const now = this.opt.now(),
      w = this.svg.getBoundingClientRect().width;
    this.pxPerUnit = w > 0 ? w / W : 1;
    while (this.pend.length && this.pend[0].s.t0 <= now) {
      const p = this.pend.shift() as { key: number; s: Sounding };
      this.start(p.key, p.s);
    }
    let d = '';
    const drawn = new Set<number>();
    for (const key of new Set([...this.snd.keys(), ...this.res.keys()])) {
      const r = this.drawString(key, now);
      if (r === null) {
        this.snd.delete(key);
        this.res.delete(key);
      } else d += r;
      if (r) drawn.add(key);
    }
    this.gVib.setAttribute('d', d);
    this.hideStrings(drawn);
    this.gVib.classList.toggle('band', this.mode !== 'slow');
    const rip = this.drawRips(now);
    if (this.snd.size || this.res.size || this.pend.length || rip) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** 弾いた点から広がる輪。描くものが残っていれば true */
  private drawRips(now: number): boolean {
    this.rips = this.rips.filter((r) => now - r.t0 < r.s);
    let h = '';
    for (const r of this.rips) {
      const u = Math.max(0, now - r.t0) / r.s;
      h += `<circle class="kb-rip" cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${(2 + r.r * u ** 0.6).toFixed(1)}" opacity="${(1 - u).toFixed(3)}"/>`;
    }
    if (this.gRip.innerHTML !== h) this.gRip.innerHTML = h;
    return this.rips.length > 0;
  }

  /**
   * 時刻 t0 に打った弦の、時刻 t での、モードの持ち主の鍵ごとの減衰の倍率。self は打った弦で、その鍵のモードは
   * self のダンパーの時刻で止める。ほかの鍵のモードは、その鍵のダンパーが下りていた時間と、すべて止めた時刻から止める
   */
  private fader(t0: number, t: number, self?: Sounding): (own: number) => number {
    const memo = new Map<number, number>(),
      stop = t0 < this.stopT && t > this.stopT ? Math.exp(-this.stopSd * (t - this.stopT)) : 1;
    return (o) => {
      let f = memo.get(o);
      if (f === undefined) {
        if (self && o === self.view.key) f = damperFade(self, t);
        else {
          const dt = this.geo[o - KEY_LO]?.damper ? this.dlog.downTime(o - KEY_LO, t0, t) : 0;
          f = (dt > 0 ? Math.exp(-this.opt.sd(o) * dt) : 1) * stop;
        }
        memo.set(o, f);
      }
      return f;
    };
  }

  /**
   * 鍵 key の弦（打った振動と、共鳴の和）の path。消えたら null。打ったときより 60 dB 小さくなったら（聞こえなくなる
   * 目安）消す。共鳴はその弦を鳴らした打鍵の振れを基準にする
   */
  private drawString(key: number, now: number): string | null {
    const s = this.snd.get(key),
      rs = this.res.get(key) ?? [],
      src: { view: StringView; t: number; fade: (own: number) => number }[] = [];
    if (s) {
      const t = now - s.t0,
        fade = this.fader(s.t0, now, s);
      if (t >= 0 && envOf(s.view, t, fade) < MIN_REL * (s.peak0 ?? 0)) this.snd.delete(key);
      else if (t >= 0) src.push({ view: s.view, t, fade });
    }
    const keep = rs.filter((r) => {
      const t = now - r.t0,
        fade = this.fader(r.t0, now);
      if (t < 0) return true;
      if (envOf(r.view, t, fade) < MIN_REL * r.ref) return false;
      if (this.symOn) src.push({ view: r.view, t, fade });
      return true;
    });
    if (keep.length) this.res.set(key, keep);
    else this.res.delete(key);
    if (!this.snd.has(key) && !keep.length) return null;
    if (!src.length) return '';
    const x = this.sx(key),
      k = this.exag * PX_MM * 1000,
      ys = (j: number) => (SY0 - (j / PTS) * this.len[key - KEY_LO]).toFixed(1);
    let peak = 0,
      d = '';
    /* 時刻をずらして（dt）、すべての振動の部分音の成分を足す */
    const sum = (dt: number, slow: number) => {
      const c = new Float64Array(PARTS);
      for (const v of src) coefOf(v.view, (v.t + dt) / slow, v.t, v.fade, c);
      return c;
    };
    const buf = new Float64Array(PTS + 1);
    if (this.mode === 'slow') {
      shapeOf(sum(0, this.slow), buf);
      for (let j = 0; j <= PTS; j++) {
        peak = Math.max(peak, Math.abs(buf[j]));
        d += `${j ? 'L' : 'M'}${(x + buf[j] * k).toFixed(1)} ${ys(j)}`;
      }
    } else {
      const w1 = src[0].view.parts[0]?.lr[0] ?? 1000,
        T1 = (2 * Math.PI) / Math.abs(w1),
        hi = new Float64Array(PTS + 1).fill(-Infinity),
        lo = new Float64Array(PTS + 1).fill(Infinity);
      for (let p = 0; p < PHASES; p++) {
        shapeOf(sum((p / PHASES) * T1, 1), buf);
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
    /* 画面で 0.5 px より小さい間は描かない（振幅の強調を大きくすれば、また見える） */
    return peak * k * this.pxPerUnit >= MIN_PX ? d : '';
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
    return g && y >= this.sy(k, g.L) - 6 && y <= SY0 + 6 ? k : null;
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
    const up = (e: PointerEvent) => this.gl.up(e.pointerId);
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
      this.showRect(this.hover, null);
      this.gl.move(e.pointerId, k);
    });
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointermove', (e) => {
      /* 押したまま動かすと、ポインタの入った鍵を押し、前の鍵を離す（図の外や鍵のない所では離す） */
      if (this.gl.has(e.pointerId)) {
        this.gl.move(e.pointerId, at(e));
        return;
      }
      if (e.pointerType !== 'mouse' || this.gl.size) return;
      const k = at(e);
      this.showRect(this.hover, k);
      svg.style.cursor = k !== null ? 'pointer' : '';
    });
    svg.addEventListener('pointerleave', (e) => {
      if (this.gl.has(e.pointerId)) this.gl.move(e.pointerId, null);
      this.showRect(this.hover, null);
    });
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

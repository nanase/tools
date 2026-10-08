/**
 * 極と零点（z 平面）から求めるもの: 多項式の係数、周波数特性（振幅・位相・群遅延）、最大の利得、安定判定、
 * 双2次の縦続（SOS）、インパルス応答、極の共振の周波数と Q。DOM に依存しない。
 *
 * 伝達関数は H(z) = k ∏(1 − z_m z⁻¹) / ∏(1 − p_n z⁻¹)（因果的な形）。極と零点の個数が違うときは、
 * 足りない側の根を原点に置いたのと同じになる（原点の根は H の振幅を変えず、位相に ω を足し引きする）
 */

export type Kind = 'p' | 'z';

/**
 * 極か零点の 1 点。im > 0 なら共役の対（im < 0 の側を含めて 2 個の根）、im = 0 なら実軸の上の 1 個の根。
 * id は画面の上の点を見分ける番号（選択・試聴の係数の切り替えに使う）
 */
export interface Pt {
  id: number;
  k: Kind;
  re: number;
  im: number;
}

/** 位置だけの点（プリセット・保存） */
export type Spot = Omit<Pt, 'id'>;

/** 実軸・単位円・原点とみなす幅 */
export const EPS = 1e-9;

/** 点の根の個数（共役の対は 2） */
export const deg = (p: Spot): number => (p.im > 0 ? 2 : 1);
/** 極か零点の根の個数 */
export const order = (pts: readonly Spot[], k: Kind): number => pts.reduce((s, p) => s + (p.k === k ? deg(p) : 0), 0);
/** 原点からの距離 */
export const rad = (p: Spot): number => Math.hypot(p.re, p.im);
/** 偏角（0 … π） */
export const ang = (p: Spot): number => Math.atan2(p.im, p.re);
/** 極座標から点の位置。θ は 0 … π に収め、実軸に近ければ実軸に載せる */
export function polar(k: Kind, r: number, th: number): Spot {
  const t = Math.min(Math.PI, Math.max(0, th));
  let re = r * Math.cos(t),
    im = r * Math.sin(t);
  if (im < EPS) im = 0;
  if (Math.abs(re) < EPS) re = 0;
  return { k, re, im };
}

/* ---------- 多項式 ---------- */
/** 多項式の積（係数は z⁻¹ の昇べき） */
export function conv(a: readonly number[], b: readonly number[]): number[] {
  const c = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) c[i + j] += a[i] * b[j];
  return c;
}

/** 1 点ぶんの因子: 対なら 1 − 2Re(c) z⁻¹ + |c|² z⁻²、実軸なら 1 − c z⁻¹ */
export const factor = (p: Spot): number[] => (p.im > 0 ? [1, -2 * p.re, p.re * p.re + p.im * p.im] : [1, -p.re]);

/** 極か零点を展開した多項式 ∏(1 − c z⁻¹) の係数（先頭は 1） */
export function expand(pts: readonly Spot[], k: Kind): number[] {
  let c = [1];
  for (const p of pts) if (p.k === k) c = conv(c, factor(p));
  return c;
}

/** 伝達関数の係数: 分子 b = k ∏(1 − z_m z⁻¹)、分母 a = ∏(1 − p_n z⁻¹)（a0 = 1） */
export function coefs(pts: readonly Spot[], gain: number): { b: number[]; a: number[] } {
  return { b: expand(pts, 'z').map((x) => x * gain), a: expand(pts, 'p') };
}

/* ---------- 周波数特性 ---------- */
export interface Point {
  /** ln |H|（k = 1） */
  lm: number;
  /** 位相 [rad]（折り返さない和） */
  ph: number;
  /** 群遅延 [サンプル] */
  gd: number;
}

/**
 * 単位円の上の点 e^{jω} での H（k = 1）: ln|H| = Σ ln|e^{jω} − z| − Σ ln|e^{jω} − p|、
 * 位相 = Σ ∠(e^{jω} − z) − Σ ∠(e^{jω} − p) + (N − M)ω、群遅延 = −dφ/dω
 */
export function at(pts: readonly Spot[], w: number): Point {
  const cw = Math.cos(w),
    sw = Math.sin(w);
  let lm = 0,
    ph = 0,
    gd = 0,
    nz = 0,
    np = 0;
  for (const p of pts) {
    const s = p.k === 'z' ? 1 : -1,
      ims = p.im > 0 ? [p.im, -p.im] : [p.im];
    for (const im of ims) {
      const dx = cw - p.re,
        dy = sw - im,
        d2 = dx * dx + dy * dy;
      lm += (s * Math.log(d2)) / 2;
      ph += s * Math.atan2(dy, dx);
      /* dφ/dω = Re[e^{jω} / (e^{jω} − c)] */
      gd -= (s * (cw * dx + sw * dy)) / d2;
    }
    if (p.k === 'z') nz += ims.length;
    else np += ims.length;
  }
  return { lm, ph: ph + (np - nz) * w, gd: gd - (np - nz) };
}

/** e^{jω} から 1 つの根（か原点に足した根）への線 */
export interface Vec {
  k: Kind;
  /** 点の id（原点に足した根は null） */
  id: number | null;
  /** 共役の対の下半面の側 */
  conj: boolean;
  /** 個数（原点に足した根だけ 2 以上になる） */
  n: number;
  re: number;
  im: number;
  /** 長さ */
  d: number;
  /** 実軸の正の向きからの角度 [rad]（−π … π） */
  phi: number;
}

/**
 * 単位円の上の点 e^{jω} から各零点・各極（共役の側も別に）へ引いた線の長さと角度。
 * 極と零点の個数が違えば、少ない側の根を原点に足す（長さ 1、角度 ω）。並びは零点、極の順
 */
export function vectors(pts: readonly Pt[], w: number): Vec[] {
  const cw = Math.cos(w),
    sw = Math.sin(w),
    out: Vec[] = [],
    d = order(pts, 'p') - order(pts, 'z');
  for (const k of ['z', 'p'] as const) {
    for (const p of pts) {
      if (p.k !== k) continue;
      for (const conj of p.im > 0 ? [false, true] : [false]) {
        const im = conj ? -p.im : p.im;
        out.push({
          k,
          id: p.id,
          conj,
          n: 1,
          re: p.re,
          im,
          d: Math.hypot(cw - p.re, sw - im),
          phi: Math.atan2(sw - im, cw - p.re),
        });
      }
    }
    if ((k === 'z' && d > 0) || (k === 'p' && d < 0))
      out.push({ k, id: null, conj: false, n: Math.abs(d), re: 0, im: 0, d: 1, phi: w });
  }
  return out;
}

/** 位相を −π … π に折り返す */
export const wrap = (x: number): number => {
  const y = x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
  return y <= -Math.PI ? y + 2 * Math.PI : y;
};

export const LN2DB = 20 / Math.LN10;

export interface Curves {
  /** 振幅 [dB]・位相 [°]（−180 … 180）・群遅延 [サンプル] */
  db: Float64Array;
  deg: Float64Array;
  gd: Float64Array;
}

/** 角周波数の並び ws での特性。gain は H に掛ける定数 k */
export function curves(pts: readonly Spot[], ws: Float64Array, gain: number): Curves {
  const n = ws.length,
    db = new Float64Array(n),
    dg = new Float64Array(n),
    gd = new Float64Array(n),
    g = Math.log(gain) * LN2DB;
  for (let i = 0; i < n; i++) {
    const r = at(pts, ws[i]);
    db[i] = r.lm * LN2DB + g;
    dg[i] = (wrap(r.ph) * 180) / Math.PI;
    gd[i] = r.gd;
  }
  return { db, deg: dg, gd };
}

/** 黄金分割で [a, b] の最大を探す */
function golden(f: (w: number) => number, a: number, b: number): [number, number] {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a),
    d = a + g * (b - a),
    fc = f(c),
    fd = f(d);
  for (let i = 0; i < 60 && b - a > 1e-13; i++) {
    if (fc >= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return fc >= fd ? [c, fc] : [d, fd];
}

/**
 * 最大の利得（k = 1）: ln|H| の最大とその角周波数。0 … π を 2048 等分した点と各極の偏角のまわりを
 * 黄金分割で詰める（鋭い共振を取りこぼさない）。極が単位円の上にあれば +∞
 */
export function peak(pts: readonly Spot[]): { w: number; lm: number } {
  const G = 2048,
    h = Math.PI / G,
    f = (w: number) => at(pts, w).lm;
  let bw = 0,
    bl = -Infinity;
  const take = (w: number, l: number) => {
    if (l > bl || (Number.isNaN(bl) && !Number.isNaN(l))) {
      bw = w;
      bl = l;
    }
  };
  let gi = 0,
    gl = -Infinity;
  for (let i = 0; i <= G; i++) {
    const l = f(i * h);
    if (l > gl) {
      gl = l;
      gi = i;
    }
  }
  take(gi * h, gl);
  const cand = [gi * h];
  for (const p of pts) if (p.k === 'p') cand.push(ang(p));
  for (const c of cand) {
    take(c, f(c));
    if (bl === Infinity) break;
    const [w, l] = golden(f, Math.max(0, c - 2 * h), Math.min(Math.PI, c + 2 * h));
    take(w, l);
  }
  return { w: bw, lm: bl };
}

/** 利得 k の決め方: 1、最大を 0 dB、直流を 0 dB */
export type GainMode = 'one' | 'peak' | 'dc';

/** k を決める。決められない（∞ や 0 で割る）ときは 1 にして ok = false */
export function gainOf(pts: readonly Spot[], mode: GainMode, pk = peak(pts)): { k: number; ok: boolean } {
  if (mode === 'one') return { k: 1, ok: true };
  const lm = mode === 'peak' ? pk.lm : at(pts, 0).lm;
  return Number.isFinite(lm) ? { k: Math.exp(-lm), ok: true } : { k: 1, ok: false };
}

/* ---------- 安定判定 ---------- */
export type Stab = 'stable' | 'marginal' | 'unstable';

/** 極の最大の半径で判定する。単位円の上（±1e-9）なら安定限界 */
export function stability(pts: readonly Spot[]): { s: Stab; rmax: number } {
  let r = 0;
  for (const p of pts) if (p.k === 'p') r = Math.max(r, rad(p));
  return { s: r > 1 + EPS ? 'unstable' : r >= 1 - EPS ? 'marginal' : 'stable', rmax: r };
}

/* ---------- 極の共振 ---------- */
export interface Res {
  r: number;
  /** 偏角 [rad]（0 … π） */
  th: number;
  /** 偏角の周波数 θ fs / 2π [Hz] */
  f: number;
  /** s = fs ln p とみたときの Q = |s| / (−2 Re s)。実軸の点・単位円の外は NaN、単位円の上は ∞ */
  q: number;
  /** 減衰の時定数 −1 / (fs ln r) [s]。単位円の上と外は ∞ */
  tau: number;
}

export function resOf(p: Spot, fs: number): Res {
  const r = rad(p),
    th = ang(p),
    l = Math.log(r);
  return {
    r,
    th,
    f: (th * fs) / (2 * Math.PI),
    q: p.im > 0 && l <= 0 ? (l === 0 ? Infinity : Math.hypot(l, th) / (-2 * l)) : NaN,
    tau: l < 0 ? -1 / (fs * l) : r === 0 ? 0 : Infinity,
  };
}

/* ---------- 双2次の縦続 ---------- */
/** 1 段: (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²)。a = [1, a1, a2] */
export interface Sec {
  b: [number, number, number];
  a: [number, number, number];
}

/** 段に入れる根のまとまり（対 1 つか、実軸の根 1〜2 個） */
interface Unit {
  /** 根（上半面の側だけ。対は 1 個、実軸は 1〜2 個） */
  c: Spot[];
  poly: number[];
  /** 単位円までの距離（いちばん近い根） */
  d: number;
}

const toUnit = (c: Spot[]): Unit => ({
  c,
  poly: c.reduce<number[]>((s, p) => conv(s, factor(p)), [1]),
  d: Math.min(...c.map((p) => Math.abs(rad(p) - 1))),
});

/** 極か零点を段の単位にまとめる。実軸の根は単位円に近い順に 2 個ずつ組む */
function units(pts: readonly Spot[], k: Kind): Unit[] {
  const pairs = pts.filter((p) => p.k === k && p.im > 0).map((p) => toUnit([p]));
  const reals = pts
    .filter((p) => p.k === k && p.im === 0)
    .sort((x, y) => Math.abs(Math.abs(x.re) - 1) - Math.abs(Math.abs(y.re) - 1));
  for (let i = 0; i < reals.length; i += 2) pairs.push(toUnit(reals.slice(i, i + 2)));
  return pairs;
}

/** 2 つのまとまりの根の間の最短距離 */
const gap = (a: Unit, b: Unit): number => {
  let m = Infinity;
  for (const p of a.c) for (const q of b.c) m = Math.min(m, Math.hypot(p.re - q.re, p.im - q.im));
  return m;
};

const pad3 = (c: readonly number[]): [number, number, number] => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];

/**
 * 双2次の縦続に分ける。極のまとまりを単位円に近い順に取り、いちばん近い零点のまとまりと組む
 * （SciPy の zpk2sos の nearest に倣う）。並びは極が単位円から遠い段を先に、近い段を後ろにし、
 * 利得 k は 1 段目の分子に掛ける。段の数は ⌈max(M, N) / 2⌉
 */
export function sos(pts: readonly Spot[], gain: number): Sec[] {
  const P = units(pts, 'p').sort((x, y) => x.d - y.d),
    Z = units(pts, 'z');
  const out: { s: Sec; d: number }[] = [];
  for (const p of P) {
    let bi = -1,
      bd = Infinity;
    Z.forEach((z, i) => {
      const g = gap(p, z);
      if (g < bd) {
        bd = g;
        bi = i;
      }
    });
    const z = bi >= 0 ? Z.splice(bi, 1)[0] : null;
    out.push({ s: { b: pad3(z ? z.poly : [1]), a: pad3(p.poly) }, d: p.d });
  }
  for (const z of Z) out.push({ s: { b: pad3(z.poly), a: [1, 0, 0] }, d: Infinity });
  out.sort((x, y) => y.d - x.d);
  const S = out.map((o) => o.s);
  if (!S.length) S.push({ b: [1, 0, 0], a: [1, 0, 0] });
  S[0].b = S[0].b.map((x) => x * gain) as Sec['b'];
  return S;
}

/** 段を掛け合わせた多項式（確かめ用） */
export function sosPoly(S: readonly Sec[]): { b: number[]; a: number[] } {
  return {
    b: S.reduce<number[]>((s, x) => conv(s, x.b), [1]),
    a: S.reduce<number[]>((s, x) => conv(s, x.a), [1]),
  };
}

/* ---------- インパルス応答 ---------- */
/** 発散しても描けるように、この大きさで頭打ちにする */
const HUGE = 1e150;

/** 双2次の縦続（転置直接形 II）に単位インパルスを入れた応答 h[0 … n − 1] */
export function impulse(S: readonly Sec[], n: number): Float64Array {
  const x = new Float64Array(n);
  if (n) x[0] = 1;
  for (const { b, a } of S) {
    let z1 = 0,
      z2 = 0;
    for (let i = 0; i < n; i++) {
      const u = x[i],
        y = Math.max(-HUGE, Math.min(HUGE, b[0] * u + z1));
      z1 = b[1] * u - a[1] * y + z2;
      z2 = b[2] * u - a[2] * y;
      x[i] = y;
    }
  }
  return x;
}

/* ---------- 点を足す場所 ---------- */
/** ほかの点から離れた場所（半径 0.5 の円の上で、上半面の 90° から左右に探す） */
export function freeSpot(pts: readonly Spot[], k: Kind): Spot {
  const near = (s: Spot) => pts.some((p) => Math.hypot(p.re - s.re, Math.abs(p.im) - s.im) < 0.12);
  for (const r of [0.5, 0.75, 0.3])
    for (const d of [90, 60, 120, 30, 150, 75, 105, 45, 135, 15, 165])
      if (!near(polar(k, r, (d * Math.PI) / 180))) return polar(k, r, (d * Math.PI) / 180);
  return polar(k, 0.5, Math.PI / 2);
}

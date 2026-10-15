/**
 * 管の時間領域の模型（DOM に依存しない）。平面波の進行波（圧力）で、
 * マウスピースとリードパイプ、ベルは 1 標本の長さの円筒の階段（Kelly–Lochbaum の散乱）、
 * 円筒部と弁の迂回管は遅延線で表す。弁は主管・既定の通路・迂回管の 3 管の接合（圧力が等しく、流量の和が 0）。
 * 粘性・熱の損失は区間ごとに e^{−K√ω (1 + j)} を 2 次の最小位相の IIR で近似し、開口は非フランジ管の
 * 放射インピーダンス（質量と抵抗の並列）の 1 次の反射フィルタで閉じる
 */
import { type Air, lenOf, type Profile, radiusAt, VALVE_LEN } from './bore';

/** 1 次の区間の縦続。区間 i は (b0 + b1 z⁻¹)/(1 + a1 z⁻¹) */
export class Cascade {
  private x: Float64Array;
  private y: Float64Array;
  constructor(readonly c: Float64Array) {
    const n = c.length / 3;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
  }
  run(v: number): number {
    const c = this.c,
      X = this.x,
      Y = this.y;
    for (let i = 0, j = 0; i < X.length; i++, j += 3) {
      const y = c[j] * v + c[j + 1] * X[i] - c[j + 2] * Y[i];
      X[i] = v;
      Y[i] = y;
      v = y;
    }
    return v;
  }
  reset() {
    this.x.fill(0);
    this.y.fill(0);
  }
  clone(): Cascade {
    return new Cascade(this.c);
  }
  /** 周波数応答（ω は 1 標本あたりのラジアン）: [大きさ, 位相] */
  response(w: number): [number, number] {
    const cr = Math.cos(w),
      ci = -Math.sin(w),
      c = this.c;
    let m = 1,
      ph = 0;
    for (let j = 0; j < c.length; j += 3) {
      const nr = c[j] + c[j + 1] * cr,
        ni = c[j + 1] * ci,
        dr = 1 + c[j + 2] * cr,
        di = c[j + 2] * ci;
      m *= Math.hypot(nr, ni) / Math.hypot(dr, di);
      ph += Math.atan2(ni, nr) - Math.atan2(di, dr);
    }
    return [m, ph];
  }
}

/** 区間の損失の係数 K [s^½]: 減衰と位相の遅れが K√ω（Keefe の太い管の近似の第 1 項）。sumLa = Σ 長さ / 半径 */
export const lossK = (air: Air, sumLa: number) => (1.045 * Math.sqrt(air.eta / air.rho) * sumLa) / air.c;

/** s 領域の 1 次の極と零点の組（DC で 1）を双一次変換した区間の係数 */
function pzSections(pz: number[], fs: number): Float64Array {
  const g = 2 * fs,
    out = new Float64Array((pz.length / 2) * 3);
  /* (s + z)/(s + p) · p/z → ((g + z) − (g − z) z⁻¹) / ((g + p) − (g − p) z⁻¹) · p/z */
  for (let i = 0; i < pz.length; i += 2) {
    const p = pz[i],
      z = pz[i + 1],
      d = g + p,
      k = p / z,
      j = (i / 2) * 3;
    out[j] = (k * (g + z)) / d;
    out[j + 1] = (-k * (g - z)) / d;
    out[j + 2] = -(g - p) / d;
  }
  return out;
}

const lossCache = new Map<string, Float64Array>();
/** e^{−K√ω (1 + j)} の大きさに合わせた最小位相の 3 区間の縦続（20 Hz〜18 kHz の対数の誤差を Nelder–Mead で最小に） */
export function lossFilter(K: number, fs: number): Cascade {
  if (K <= 0) return new Cascade(new Float64Array([1, 0, 0]));
  const key = `${K.toPrecision(6)}/${fs}`,
    hit = lossCache.get(key);
  if (hit) return new Cascade(hit);
  const NF = 40,
    w: number[] = [],
    tgt: number[] = [];
  for (let i = 0; i < NF; i++) {
    const f = 20 * (18000 / 20) ** (i / (NF - 1));
    w.push((2 * Math.PI * f) / fs);
    tgt.push(-K * Math.sqrt(2 * Math.PI * f));
  }
  /* u = [ln p, ln(ln(z/p))] × 3 */
  const coef = (u: number[]) => {
    const pz: number[] = [];
    for (let i = 0; i < u.length; i += 2) pz.push(Math.exp(u[i]), Math.exp(u[i] + Math.exp(u[i + 1])));
    return pzSections(pz, fs);
  };
  const probe = new Cascade(new Float64Array(9));
  const err = (u: number[]) => {
    const c = coef(u);
    probe.c.set(c);
    let e = 0;
    for (let i = 0; i < NF; i++) {
      const d = Math.log(probe.response(w[i])[0]) - tgt[i];
      e += d * d;
    }
    return e;
  };
  const n = 6;
  let S = [[Math.log(2 * Math.PI * 30), -0.5, Math.log(2 * Math.PI * 400), -0.5, Math.log(2 * Math.PI * 5000), -0.5]];
  for (let i = 0; i < n; i++) S.push(S[0].map((x, j) => (j === i ? x + 0.6 : x)));
  let F = S.map(err);
  for (let it = 0; it < 900; it++) {
    const ix = F.map((_, i) => i).sort((a, b) => F[a] - F[b]);
    S = ix.map((i) => S[i]);
    F = ix.map((i) => F[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const W = S[n],
      xr = c.map((x, j) => 2 * x - W[j]),
      fr = err(xr);
    if (fr < F[0]) {
      const xe = c.map((x, j) => 3 * x - 2 * W[j]),
        fe = err(xe);
      if (fe < fr) [S[n], F[n]] = [xe, fe];
      else [S[n], F[n]] = [xr, fr];
    } else if (fr < F[n - 1]) [S[n], F[n]] = [xr, fr];
    else {
      const xc = c.map((x, j) => 0.5 * (x + W[j])),
        fc = err(xc);
      if (fc < F[n]) [S[n], F[n]] = [xc, fc];
      else
        for (let i = 1; i <= n; i++) {
          S[i] = S[i].map((x, j) => 0.5 * (x + S[0][j]));
          F[i] = err(S[i]);
        }
    }
  }
  const out = coef(S[0]);
  lossCache.set(key, out);
  return new Cascade(out);
}

/** 小数の遅延線（4 点の Lagrange 補間で読む） */
export class Delay {
  private buf: Float64Array;
  private mask: number;
  private w = 0;
  /** 読む遅延 [標本]（2 以上） */
  d: number;
  constructor(maxLen: number, d: number) {
    let n = 4;
    while (n < maxLen + 4) n <<= 1;
    this.buf = new Float64Array(n);
    this.mask = n - 1;
    this.d = d;
  }
  write(x: number) {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }
  /** 書く前に読む: d 標本前に書いた値 */
  read(): number {
    return this.readAt(this.d);
  }
  readAt(d: number): number {
    const i = Math.floor(d),
      t = d - i,
      m = this.mask,
      b = this.buf,
      w = this.w;
    /* x(−i+1), x(−i), x(−i−1), x(−i−2) を、t = d − i の位置で */
    const xm1 = b[(w - i + 1 + m + 1) & m],
      x0 = b[(w - i + m + 1) & m],
      x1 = b[(w - i - 1 + 2 * (m + 1)) & m],
      x2 = b[(w - i - 2 + 2 * (m + 1)) & m];
    const c0 = (-t * (t - 1) * (t - 2)) / 6,
      c1 = ((t + 1) * (t - 1) * (t - 2)) / 2,
      c2 = (-(t + 1) * t * (t - 2)) / 2,
      c3 = ((t + 1) * t * (t - 1)) / 6;
    return c0 * xm1 + c1 * x0 + c2 * x1 + c3 * x2;
  }
  clear() {
    this.buf.fill(0);
  }
}

/**
 * 1 本の円筒（往き・帰りの遅延線と、片道の損失）。nl > 0 なら往きの波に非線形の伝搬をまとめて掛ける:
 * 圧力 p の部分は速く進み、遅延が nl·p [標本] 縮む（Cooper・Abel 2010 の集中型）
 */
class Tube {
  fwd: Delay;
  bwd: Delay;
  lf: Cascade;
  lb: Cascade;
  /** 出口に着いた波（この標本で読んだ値） */
  outF = 0;
  outB = 0;
  nl = 0;
  private rawF = 0;
  constructor(d: number, K: number, fs: number) {
    this.fwd = new Delay(Math.ceil(d) + 72, d);
    this.bwd = new Delay(Math.ceil(d) + 4, d);
    this.lf = lossFilter(K, fs);
    this.lb = lossFilter(K, fs);
  }
  read() {
    if (this.nl > 0) {
      const d0 = this.fwd.d,
        d = Math.min(d0 + 64, Math.max(2, d0 - this.nl * this.rawF));
      this.rawF = this.fwd.readAt(d);
      this.outF = this.lf.run(this.rawF);
    } else this.outF = this.lf.run(this.fwd.read());
    this.outB = this.lb.run(this.bwd.read());
  }
  write(inF: number, inB: number) {
    this.fwd.write(inF);
    this.bwd.write(inB);
  }
  clear() {
    this.fwd.clear();
    this.bwd.clear();
    this.lf.reset();
    this.lb.reset();
    this.rawF = 0;
  }
}

/** 階段の円筒の列（各 1 標本）。損失は指定した継ぎ目でまとめて掛ける */
class Steps {
  readonly n: number;
  /** 継ぎ目 i（区間 i と i+1 の間）の圧力の反射率 */
  readonly r: Float64Array;
  readonly area: Float64Array;
  F: Float64Array;
  B: Float64Array;
  private nF: Float64Array;
  private nB: Float64Array;
  /** 損失を掛ける継ぎ目と、その往き・帰りのフィルタ */
  private lossAt: Int32Array;
  private lf: Cascade[];
  private lb: Cascade[];
  constructor(area: Float64Array, lossAt: number[], K: number[], fs: number) {
    const n = area.length;
    this.n = n;
    this.area = area;
    this.r = new Float64Array(Math.max(0, n - 1));
    for (let i = 0; i + 1 < n; i++) this.r[i] = (area[i] - area[i + 1]) / (area[i] + area[i + 1]);
    this.F = new Float64Array(n);
    this.B = new Float64Array(n);
    this.nF = new Float64Array(n);
    this.nB = new Float64Array(n);
    this.lossAt = new Int32Array(n).fill(-1);
    this.lf = [];
    this.lb = [];
    lossAt.forEach((j, k) => {
      this.lossAt[j] = k;
      this.lf.push(lossFilter(K[k], fs));
      this.lb.push(lossFilter(K[k], fs));
    });
  }
  /** 1 標本進める。左端に入る往きの波 inL、右端に入る帰りの波 inR */
  step(inL: number, inR: number) {
    const n = this.n,
      F = this.F,
      B = this.B,
      nF = this.nF,
      nB = this.nB,
      r = this.r,
      la = this.lossAt;
    nF[0] = inL;
    nB[n - 1] = inR;
    for (let i = 0; i + 1 < n; i++) {
      const a = F[i],
        b = B[i + 1],
        d = r[i] * (a - b);
      const k = la[i];
      if (k < 0) {
        nF[i + 1] = a + d;
        nB[i] = b + d;
      } else {
        nF[i + 1] = this.lf[k].run(a + d);
        nB[i] = this.lb[k].run(b + d);
      }
    }
    this.F = nF;
    this.nF = F;
    this.B = nB;
    this.nB = B;
  }
  clear() {
    this.F.fill(0);
    this.B.fill(0);
    this.nF.fill(0);
    this.nB.fill(0);
    for (const f of this.lf) f.reset();
    for (const f of this.lb) f.reset();
  }
}

/**
 * 弁 1 本: 既定の通路と迂回管。press はピストンの位置（0 = 押していない、1 = 押し切った）。
 * 通路の開きは、既定の通路が 0〜0.6 で閉じ、迂回管が 0.4〜1 で開く（途中は両方が狭まる。この割合はこのツールで決めた）
 */
class Valve {
  dflt: Tube;
  byp: Tube;
  press = 0;
  /** 迂回管を回しているか（閉じたら中の空気を静止に戻す） */
  private live = false;
  private liveD = true;
  constructor(d0: number, dB: number, K0: number, KB: number, fs: number) {
    this.dflt = new Tube(d0, K0, fs);
    this.byp = new Tube(dB, KB, fs);
  }
  get qd() {
    return Math.min(1, Math.max(0, 1 - this.press / 0.6));
  }
  get qb() {
    return Math.min(1, Math.max(0, (this.press - 0.4) / 0.6));
  }
  read() {
    if (this.liveD) this.dflt.read();
    if (this.live) this.byp.read();
  }
  /**
   * 入口の接合で左から来た往きの波 aL、出口の接合で右から来た帰りの波 aR を受け、通路へ入る波を書く。
   * 返すのは [左へ返す帰りの波, 右へ出す往きの波]
   */
  junction(aL: number, aR: number): [number, number] {
    const qd = this.qd,
      qb = this.qb;
    if (qb <= 0) {
      if (this.live) {
        this.byp.clear();
        this.live = false;
      }
    } else if (!this.live) {
      this.live = true;
      this.byp.outF = this.byp.outB = 0;
    }
    if (qd <= 0) {
      if (this.liveD) {
        this.dflt.clear();
        this.liveD = false;
      }
    } else if (!this.liveD) {
      this.liveD = true;
      this.dflt.outF = this.dflt.outB = 0;
    }
    if (qb <= 0 && qd >= 1) {
      this.dflt.write(aL, aR);
      return [this.dflt.outB, this.dflt.outF];
    }
    if (qd <= 0 && qb >= 1) {
      this.byp.write(aL, aR);
      return [this.byp.outB, this.byp.outF];
    }
    /* 3 管の接合（主管の面積を 1 として 1, qd, qb）: p_J = 2 Σ S a / Σ S、出ていく波 = p_J − 来た波 */
    const g = 2 / (1 + qd + qb),
      pIn = g * (aL + qd * this.dflt.outB + qb * this.byp.outB),
      pOut = g * (aR + qd * this.dflt.outF + qb * this.byp.outF);
    if (this.liveD) this.dflt.write(pIn - this.dflt.outB, pOut - this.dflt.outF);
    if (this.live) this.byp.write(pIn - this.byp.outB, pOut - this.byp.outF);
    return [pIn - aL, pOut - aR];
  }
}

/** 管全体 */
export class Bore {
  readonly fs: number;
  readonly air: Air;
  /** 入口（カップの縁）と開口の特性インピーダンス */
  readonly zIn: number;
  readonly zEnd: number;
  private head: Steps;
  private tail: Steps;
  private cyl: Tube[];
  readonly valves: Valve[];
  /* 開口の反射 R(z) = (b0 + b1 z⁻¹)/(1 + a1 z⁻¹) */
  private rb0: number;
  private rb1: number;
  private ra1: number;
  private rx = 0;
  private ry = 0;
  /** 開口から出た体積流量 [m³/s]（この標本） */
  uEnd = 0;
  /** 開口の放射の抵抗と特性インピーダンスの比 */
  static RAD_R = 1.25;
  /** 非線形の伝搬の実効円筒長 z = ∫ D0/D dx [m]（マウスピースの後から開口まで、弁は押していないとき）と、1 Pa あたりの遅延の縮み [標本] */
  readonly zEff: number;
  readonly nlPerPa: number;

  constructor(p: Profile, air: Air, fs: number) {
    this.fs = fs;
    this.air = air;
    const dx = air.c / fs;
    /* 階段: 各区間の面積は容積 / dx（容積を保つ） */
    const steps = (pr: { x: Float64Array; r: Float64Array }) => {
      const L = lenOf(pr),
        n = Math.max(1, Math.round(L / dx)),
        h = L / n,
        area = new Float64Array(n),
        la = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        /* 区間の中を 8 点で積分 */
        let v = 0,
          q = 0;
        for (let j = 0; j < 8; j++) {
          const r = radiusAt(pr, pr.x[0] + (i + (j + 0.5) / 8) * h);
          v += Math.PI * r * r;
          q += 1 / r;
        }
        area[i] = v / 8;
        la[i] = (q / 8) * h;
      }
      return { area, la, n, rest: L - n * dx };
    };
    const H = steps(p.head),
      T = steps(p.tail);
    /* 損失をまとめる継ぎ目: 頭はマウスピースの終わりとリードパイプの終わり、ベルは半ばと終わりの手前 */
    const sumLa = (la: Float64Array, a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += la[i];
      return s;
    };
    const hm = Math.max(1, Math.min(H.n - 2, Math.round(0.088 / dx))),
      tm = Math.round(T.n / 2);
    this.head = new Steps(
      H.area,
      [hm, H.n - 2],
      [lossK(air, sumLa(H.la, 0, hm + 1)), lossK(air, sumLa(H.la, hm + 1, H.n))],
      fs,
    );
    this.tail = new Steps(
      T.area,
      [tm, T.n - 2],
      [lossK(air, sumLa(T.la, 0, tm + 1)), lossK(air, sumLa(T.la, tm + 1, T.n))],
      fs,
    );
    /* 円筒部: 階段の端数を円筒に足す。弁の既定の通路は 3 cm、弁と弁の間は 2 cm */
    const a = p.cylR,
      cs = (L: number) => (L / air.c) * fs,
      d0 = Math.round(cs(0.03)),
      gap = Math.round(cs(0.02)),
      L0 = p.cylLen + H.rest + T.rest,
      rest = cs(L0) - 3 * d0 - 2 * gap,
      first = Math.round(rest * 0.4),
      last = rest - first;
    const K = (d: number) => lossK(air, (d * dx) / a);
    this.cyl = [first, gap, gap, last].map((d) => new Tube(Math.max(2, d), K(d), fs));
    this.valves = VALVE_LEN.map((dl) => new Valve(d0, d0 + cs(dl), K(d0), K(d0 + cs(dl)), fs));
    /* 実効円筒長: 階段の各区間の dx · rc / r と円筒部 */
    let z = L0;
    for (let i = hm + 1; i < H.n; i++) z += (dx * a) / Math.sqrt(H.area[i] / Math.PI);
    for (let i = 0; i < T.n; i++) z += (dx * a) / Math.sqrt(T.area[i] / Math.PI);
    this.zEff = z;
    /* 単純波: 速さ c + (γ+1)/(2γ) · c · p/P0 → 遅延の縮み τ0 (γ+1)/(2γ P0) p */
    this.nlPerPa = ((z / air.c) * fs * (air.gamma + 1)) / (2 * air.gamma * 101325);
    this.zIn = (air.rho * air.c) / H.area[0];
    const Send = Math.PI * p.bellR * p.bellR;
    this.zEnd = (air.rho * air.c) / Send;
    /* 開口: Z_r = sM‖R、M = ρ 0.6133 a / S、R = RAD_R · Zc。x = sτ（τ = 0.6133 a / c）で R(s) = (x(r−1) − r)/(x(r+1) + r) */
    const tau = (0.6133 * p.bellR) / air.c,
      g = 2 * fs * tau,
      r = Bore.RAD_R,
      D = g * (r + 1) + r;
    this.rb0 = (g * (r - 1) - r) / D;
    this.rb1 = -(g * (r - 1) + r) / D;
    this.ra1 = -(g * (r + 1) - r) / D;
  }

  /** 非線形の伝搬の強さ（0 で線形、1 で物理の値） */
  setBrass(k: number) {
    this.cyl[3].nl = k * this.nlPerPa;
  }

  /** 入口に着いた帰りの波 p⁻ */
  incoming(): number {
    return this.head.B[0];
  }

  /** 1 標本進める。入口から入る往きの波 p⁺ を与える */
  step(pPlus: number) {
    const head = this.head,
      tail = this.tail,
      cyl = this.cyl,
      V = this.valves;
    for (const t of cyl) t.read();
    for (const v of V) v.read();
    /* 頭 → 円筒 0（面積は等しいので素通し） */
    const hF = head.F[head.n - 1];
    head.step(pPlus, cyl[0].outB);
    /* 円筒 0 → 弁 1 → 円筒 1 → 弁 2 → 円筒 2 → 弁 3 → 円筒 3 */
    let toLeft: number, toRight: number;
    [toLeft, toRight] = V[0].junction(cyl[0].outF, cyl[1].outB);
    cyl[0].write(hF, toLeft);
    const r1 = toRight;
    [toLeft, toRight] = V[1].junction(cyl[1].outF, cyl[2].outB);
    cyl[1].write(r1, toLeft);
    const r2 = toRight;
    [toLeft, toRight] = V[2].junction(cyl[2].outF, cyl[3].outB);
    cyl[2].write(r2, toLeft);
    const r3 = toRight;
    /* 円筒 3 → ベル */
    const tB = tail.B[0];
    /* 開口: 着いた往きの波を反射 */
    const a = tail.F[tail.n - 1],
      refl = this.rb0 * a + this.rb1 * this.rx - this.ra1 * this.ry;
    this.rx = a;
    this.ry = refl;
    this.uEnd = (a - refl) / this.zEnd;
    tail.step(cyl[3].outF, refl);
    cyl[3].write(r3, tB);
  }

  clear() {
    this.head.clear();
    this.tail.clear();
    for (const t of this.cyl) t.clear();
    for (const v of this.valves) {
      v.dflt.clear();
      v.byp.clear();
      v.press = 0;
    }
    this.rx = this.ry = this.uEnd = 0;
  }
}

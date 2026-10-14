/**
 * 音を作る部分（DOM に依存しない）。AudioWorklet と、確認用の計算で同じものを使う。
 * 胴は、駒と結合したモードを減衰する複素指数で回し、駒の上端の力から 2 点の音圧 [Pa] を出す。
 * 弦は、モードを同じく複素指数で回し、弓の位置の摩擦を 1 標本ごとに解いて、駒の力 [N] を出す
 */
import type { Body } from './body';
import { type Contact, muT, type Slip, solveCurve, solveThermal, Thermal } from './bow';
import type { StringModes } from './strings';

/** 胴の共振器の列。力は標本の間で一定として、厳密に進める */
export class BodyBank {
  readonly n: number;
  /* e^{λT}、力の係数を掛けた (e^{λT} − 1) / λ（水平・垂直の力）、音圧の係数（左・右） */
  private er: Float64Array;
  private ei: Float64Array;
  private hr: Float64Array;
  private hi: Float64Array;
  private wr: Float64Array;
  private wi: Float64Array;
  private lr: Float64Array;
  private li: Float64Array;
  private rr: Float64Array;
  private ri: Float64Array;
  private zr: Float64Array;
  private zi: Float64Array;
  /** 力がそのまま音圧に出る分（単極子の放射の、加速度のうち力に比例する項。水平・垂直の力） */
  private dH = 0;
  private dV = 0;

  constructor(
    b: Body,
    readonly fs: number,
  ) {
    const n = b.n,
      T = 1 / fs;
    this.n = n;
    this.er = new Float64Array(n);
    this.ei = new Float64Array(n);
    this.hr = new Float64Array(n);
    this.hi = new Float64Array(n);
    this.wr = new Float64Array(n);
    this.wi = new Float64Array(n);
    this.lr = new Float64Array(n);
    this.li = new Float64Array(n);
    this.rr = new Float64Array(n);
    this.ri = new Float64Array(n);
    this.zr = new Float64Array(n);
    this.zi = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const w = b.w[j],
        sr = -b.z[j] * w,
        si = w * Math.sqrt(1 - b.z[j] * b.z[j]),
        e = Math.exp(sr * T),
        er = e * Math.cos(si * T),
        ei = e * Math.sin(si * T),
        dd = sr * sr + si * si,
        /* (e^{λT} − 1) / λ */
        br = ((er - 1) * sr + ei * si) / dd,
        bi = (ei * sr - (er - 1) * si) / dd;
      this.er[j] = er;
      this.ei[j] = ei;
      this.hr[j] = b.aH[j] * br;
      this.hi[j] = b.aH[j] * bi;
      this.wr[j] = b.aV[j] * br;
      this.wi[j] = b.aV[j] * bi;
      /* 速度 = 2 Re(r z)、r = λ / (λ − λ*) = 1/2 − i σ / (2 ω_d)。加速度 = 2 Re(r λ z) + 力 */
      const vr = 1,
        vi = -sr / si,
        ar = vr * sr - vi * si,
        ai = vr * si + vi * sr;
      this.lr[j] = b.gL[j] * vr + b.m[j] * ar;
      this.li[j] = b.gL[j] * vi + b.m[j] * ai;
      this.rr[j] = b.gR[j] * vr + b.m[j] * ar;
      this.ri[j] = b.gR[j] * vi + b.m[j] * ai;
      this.dH += b.m[j] * b.aH[j];
      this.dV += b.m[j] * b.aV[j];
    }
  }

  /** 状態を 0 に戻す */
  clear(): void {
    this.zr.fill(0);
    this.zi.fill(0);
  }

  /**
   * 駒の上端の水平・垂直の力 [N] の len 標本（128 以下）から、音圧 [Pa] を outL・outR の off から書く（上書き）
   */
  process(fH: Float64Array, fV: Float64Array, outL: Float64Array, outR: Float64Array, off: number, len: number): void {
    const { er, ei, hr, hi, wr, wi, lr, li, rr, ri, zr, zi, dH, dV } = this;
    for (let i = 0; i < len; i++) {
      const p = dH * fH[i] + dV * fV[i];
      outL[off + i] = p;
      outR[off + i] = p;
    }
    for (let j = 0; j < this.n; j++) {
      let qr = zr[j],
        qi = zi[j];
      const a = er[j],
        b = ei[j],
        c = hr[j],
        d = hi[j],
        e = wr[j],
        g = wi[j],
        pl = lr[j],
        ql = li[j],
        pr = rr[j],
        qq = ri[j];
      for (let i = 0; i < len; i++) {
        const t = qr * a - qi * b + c * fH[i] + e * fV[i];
        qi = qr * b + qi * a + d * fH[i] + g * fV[i];
        qr = t;
        outL[off + i] += pl * qr - ql * qi;
        outR[off + i] += pr * qr - qq * qi;
      }
      zr[j] = qr;
      zi[j] = qi;
    }
  }
}

/** 弦のモードの数の上限: 横振動・ねじり。ねじりのモードは横振動のあとの決まった場所に置く */
const NX = 128,
  NT = 40;

/**
 * 弓で擦る弦 1 本。モードごとに z' = e^{λT} z + b f（f は弓の位置の摩擦力、標本の間は一定）で進め、
 * 弓の位置の速度が v = v_h + G f の形になることを使って、摩擦との交点を 1 標本ごとに求める。
 * 弓が触れるのは弦の表面なので、横振動の速度に、ねじりによる表面の速度を足したものが弓の位置の速度になる
 */
export class BowedString {
  /* 使っているモードの数（横振動・ねじり） */
  private nx = 0;
  private nt = 0;
  private er = new Float64Array(NX + NT);
  private ei = new Float64Array(NX + NT);
  /* 弓の位置の速度の係数・摩擦力の係数・駒の力の係数 */
  private ar = new Float64Array(NX + NT);
  private ai = new Float64Array(NX + NT);
  private br = new Float64Array(NX + NT);
  private bi = new Float64Array(NX + NT);
  private cf = new Float64Array(NX);
  private zr = new Float64Array(NX + NT);
  private zi = new Float64Array(NX + NT);
  /* 弓の幅: 2 本目の毛（ナット側）の速度の係数と摩擦力の係数 */
  private a2r = new Float64Array(NX + NT);
  private a2i = new Float64Array(NX + NT);
  private b2r = new Float64Array(NX + NT);
  private b2i = new Float64Array(NX + NT);
  /** 弓の幅 [m]（0 なら 1 点で触れる）。幅の両側に毛を 1 本ずつ置き、弓圧を半分ずつ受け持たせる */
  private width = 0;
  /* 2 本の毛の応答の行列（G11 は G と同じ） */
  private G12 = 0;
  private G22 = 0;
  private state2: Slip = 0;
  private f2 = 0;
  private readonly hit2: Contact = { f: 0, state: 0 };
  /** 力 1 N が 1 刻みの間に生む、弓の位置の速度 [m/(s·N)] */
  G = 0;
  /** 1 標本を何刻みに分けて解くか */
  private os = 1;
  /** 摩擦の状態（0 = 固着、±1 = 滑り） */
  state: Slip = 0;
  private readonly hit: Contact = { f: 0, state: 0 };
  /** 確認用: 最後の標本の、弓の位置の弦の表面の速度 [m/s] と摩擦力 [N] */
  v = 0;
  f = 0;
  /** 確認用: 固着から滑りへ移った回数と、滑っていた標本の数（呼ぶ側が 0 に戻して使う） */
  slips = 0;
  slipN = 0;
  /** 確認用: 滑り始めた時刻 [標本]（null なら記録しない）と、時刻の基準（process ごとに len だけ進む） */
  log: number[] | null = null;
  tick = 0;
  /**
   * 松脂のむら: 摩擦係数の相対的な揺れの大きさ（標準偏差）と、弓の毛の上での揺れの相関の長さ [m]。
   * 弓が進むと、触れる毛の位置が変わるので、揺れの速さは弓速 ÷ 相関の長さで決まる
   * （観測される非周期性の主な原因は松脂のむらなどの外からの不規則さ。McIntyre・Schumacher・Woodhouse 1981）
   */
  rough = 0;
  roughLen = 0.5e-3;
  /** 摩擦の模型: 'curve' = 滑りの速さの摩擦曲線と履歴の規則、'thermal' = 接触の温度（Woodhouse 2003） */
  friction: 'curve' | 'thermal' = 'curve';
  readonly heat = new Thermal();
  private nz = 0;
  private seed = 0x9e3779b9;

  constructor(readonly fs: number) {}

  /** モード 1 つの係数を j 番に入れ、G への寄与を返す（sh2 は 2 本目の毛の位置でのモードの形） */
  private coef(j: number, w: number, s: number, mass: number, sh: number, sh2 = 0): number {
    const T = 1 / (this.fs * this.os),
      sr = -s,
      si = Math.sqrt(Math.max(1e-6, w * w - sr * sr)),
      e = Math.exp(sr * T),
      er = e * Math.cos(si * T),
      ei = e * Math.sin(si * T),
      dd = sr * sr + si * si,
      /* (e^{λT} − 1) / λ */
      pr = ((er - 1) * sr + ei * si) / dd,
      pi = (ei * sr - (er - 1) * si) / dd,
      /* 速度 = 2 Re(r z)、2r = 1 − i σ/ω_d */
      ar = sh,
      ai = (-sh * sr) / si,
      br = (pr * sh) / mass,
      bi = (pi * sh) / mass;
    this.er[j] = er;
    this.ei[j] = ei;
    this.ar[j] = ar;
    this.ai[j] = ai;
    this.br[j] = br;
    this.bi[j] = bi;
    if (this.width > 0) {
      const a2r = sh2,
        a2i = (-sh2 * sr) / si,
        b2r = (pr * sh2) / mass,
        b2i = (pi * sh2) / mass;
      this.a2r[j] = a2r;
      this.a2i[j] = a2i;
      this.b2r[j] = b2r;
      this.b2i[j] = b2i;
      this.G12 += ar * b2r - ai * b2i;
      this.G22 += a2r * b2r - a2i * b2i;
    }
    return ar * br - ai * bi;
  }

  /**
   * 弦のモードと弓の位置 xb [m]（駒から）を入れ替える。モードの状態はそのまま引き継ぐ
   * （数が減ったときは、なくなったモードを消す）。torsion を false にすると、ねじりのモードを使わない。
   * os は 1 標本を分ける刻みの数。周期が短い高い音では、滑りの時間が数標本しかなく、摩擦の交点の切り替わりを
   * 追えないので、刻みを細かくする
   */
  set(m: StringModes, xb: number, torsion = true, os = 1, width = 0, fRad = 21600): void {
    const nx = Math.min(m.n, NX),
      nt = torsion ? Math.min(m.nt, NT) : 0,
      /* 弓の幅があるときは、毛を中心の両側 width/2 に置く */
      x1 = width > 0 ? xb - width / 2 : xb,
      x2 = xb + width / 2;
    this.os = os;
    this.width = width;
    this.G12 = 0;
    this.G22 = 0;
    let G = 0;
    for (let j = 0; j < nx; j++) {
      const kx = ((j + 1) * Math.PI) / m.L;
      G += this.coef(j, m.w[j], m.s[j], m.m, Math.sin(kx * x1), Math.sin(kx * x2));
      /* 変位 = Im(z) / ω_d。fRad より高いモードは弓との接触にだけ使い、駒の力には入れない */
      this.cf[j] =
        m.w[j] > 2 * Math.PI * fRad ? 0 : m.kf[j] / Math.sqrt(Math.max(1e-6, m.w[j] * m.w[j] - m.s[j] * m.s[j]));
    }
    for (let k = 0; k < nt; k++) {
      const kx = ((k + 1) * Math.PI) / m.L;
      G += this.coef(NX + k, m.wt[k], m.st[k], m.mt, Math.sin(kx * x1), Math.sin(kx * x2));
    }
    this.zr.fill(0, nx, Math.max(nx, this.nx));
    this.zi.fill(0, nx, Math.max(nx, this.nx));
    this.zr.fill(0, NX + nt, NX + Math.max(nt, this.nt));
    this.zi.fill(0, NX + nt, NX + Math.max(nt, this.nt));
    this.nx = nx;
    this.nt = nt;
    this.G = G;
  }

  /** 弦を止める */
  clear(): void {
    this.zr.fill(0);
    this.zi.fill(0);
    this.state = 0;
  }

  /**
   * len 標本ぶん進める。vb は弓速 [m/s]、fn は弓圧 [N]（0 なら弓は弦から離れている）。
   * 駒の力（弓の向き） [N] を out の off から書く
   */
  process(vb: Float64Array, fn: Float64Array, out: Float64Array, off: number, len: number): void {
    if (this.width > 0) {
      this.process2(vb, fn, out, off, len);
      return;
    }
    const { er, ei, ar, ai, br, bi, cf, zr, zi, nx, G, hit, os, rough } = this,
      t1 = NX + this.nt,
      dt = 1 / (this.fs * os);
    let state = this.state,
      v = 0,
      f = 0,
      nz = this.nz,
      seed = this.seed;
    for (let i = 0; i < len * os; i++) {
      /* 力がないときの次の刻みの状態と、弓の位置の速度 */
      const ib = (i / os) | 0;
      let vh = 0;
      for (let j = 0; j < nx; j++) {
        const qr = zr[j] * er[j] - zi[j] * ei[j],
          qi = zr[j] * ei[j] + zi[j] * er[j];
        zr[j] = qr;
        zi[j] = qi;
        vh += ar[j] * qr - ai[j] * qi;
      }
      for (let j = NX; j < t1; j++) {
        const qr = zr[j] * er[j] - zi[j] * ei[j],
          qi = zr[j] * ei[j] + zi[j] * er[j];
        zr[j] = qr;
        zi[j] = qi;
        vh += ar[j] * qr - ai[j] * qi;
      }
      let fe = fn[ib];
      if (rough > 0 && fe > 0) {
        /* 1 次の低域通過に通した一様乱数（分散が 1 になるよう √3 倍） */
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const a = Math.exp((-Math.abs(vb[ib]) * dt) / this.roughLen),
          u = ((seed >>> 0) / 4294967296 - 0.5) * 2 * Math.sqrt(3);
        nz = a * nz + Math.sqrt(1 - a * a) * u;
        fe *= Math.max(0, 1 + rough * nz);
      }
      if (this.friction === 'thermal') {
        const heat = this.heat;
        solveThermal(vh - vb[ib], G, fe, muT(heat.T), hit);
        const dv = Math.abs(vh - vb[ib] + G * hit.f);
        heat.step(dt, fe, Math.abs(hit.f) * dv, dv);
      } else solveCurve(vh - vb[ib], G, fe, state, hit);
      f = hit.f;
      if (hit.state !== 0) {
        if (state === 0) {
          this.slips++;
          this.log?.push(this.tick + i / os);
        }
        this.slipN++;
      }
      state = hit.state;
      v = vh + G * f;
      let fb = 0;
      for (let j = 0; j < nx; j++) {
        zr[j] += br[j] * f;
        zi[j] += bi[j] * f;
        fb += cf[j] * zi[j];
      }
      for (let j = NX; j < t1; j++) {
        zr[j] += br[j] * f;
        zi[j] += bi[j] * f;
      }
      /* 刻みの平均を 1 標本の値にする */
      if (i % os === 0) out[off + ib] = fb / os;
      else out[off + ib] += fb / os;
    }
    this.state = state;
    this.v = v;
    this.f = f;
    this.nz = nz;
    this.seed = seed;
    this.tick += len;
  }

  /**
   * 弓の幅があるときの process。2 本の毛の速度は v1 = v1h + G11 f1 + G12 f2、v2 = v2h + G12 f1 + G22 f2 で
   * 互いに影響するので、交点を交互に解き直す（Gauss–Seidel を 3 回）。履歴の規則は、前の刻みの状態から選ぶ
   */
  private process2(vb: Float64Array, fn: Float64Array, out: Float64Array, off: number, len: number): void {
    const { er, ei, ar, ai, br, bi, a2r, a2i, b2r, b2i, cf, zr, zi, nx, G, G12, G22, hit, hit2, os, rough } = this,
      t1 = NX + this.nt,
      dt = 1 / (this.fs * os);
    let s1 = this.state,
      s2 = this.state2,
      f1 = this.f,
      f2 = this.f2,
      nz = this.nz,
      seed = this.seed;
    for (let i = 0; i < len * os; i++) {
      const ib = (i / os) | 0;
      let v1 = 0,
        v2 = 0;
      for (let j = 0; j < nx; j++) {
        const qr = zr[j] * er[j] - zi[j] * ei[j],
          qi = zr[j] * ei[j] + zi[j] * er[j];
        zr[j] = qr;
        zi[j] = qi;
        v1 += ar[j] * qr - ai[j] * qi;
        v2 += a2r[j] * qr - a2i[j] * qi;
      }
      for (let j = NX; j < t1; j++) {
        const qr = zr[j] * er[j] - zi[j] * ei[j],
          qi = zr[j] * ei[j] + zi[j] * er[j];
        zr[j] = qr;
        zi[j] = qi;
        v1 += ar[j] * qr - ai[j] * qi;
        v2 += a2r[j] * qr - a2i[j] * qi;
      }
      let fe = 0.5 * fn[ib];
      if (rough > 0 && fe > 0) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const a = Math.exp((-Math.abs(vb[ib]) * dt) / this.roughLen),
          u = ((seed >>> 0) / 4294967296 - 0.5) * 2 * Math.sqrt(3);
        nz = a * nz + Math.sqrt(1 - a * a) * u;
        fe *= Math.max(0, 1 + rough * nz);
      }
      const p1 = s1,
        p2 = s2;
      for (let it = 0; it < 3; it++) {
        solveCurve(v1 + G12 * f2 - vb[ib], G, fe, p1, hit);
        f1 = hit.f;
        solveCurve(v2 + G12 * f1 - vb[ib], G22, fe, p2, hit2);
        f2 = hit2.f;
      }
      if (hit.state !== 0) {
        if (p1 === 0) {
          this.slips++;
          this.log?.push(this.tick + i / os);
        }
        this.slipN++;
      }
      s1 = hit.state;
      s2 = hit2.state;
      let fb = 0;
      for (let j = 0; j < nx; j++) {
        zr[j] += br[j] * f1 + b2r[j] * f2;
        zi[j] += bi[j] * f1 + b2i[j] * f2;
        fb += cf[j] * zi[j];
      }
      for (let j = NX; j < t1; j++) {
        zr[j] += br[j] * f1 + b2r[j] * f2;
        zi[j] += bi[j] * f1 + b2i[j] * f2;
      }
      if (i % os === 0) out[off + ib] = fb / os;
      else out[off + ib] += fb / os;
    }
    this.state = s1;
    this.state2 = s2;
    this.f = f1;
    this.f2 = f2;
    this.v = 0;
    this.nz = nz;
    this.seed = seed;
    this.tick += len;
  }
}

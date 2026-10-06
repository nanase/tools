/**
 * 音を作る部分（DOM に依存しない）。AudioWorklet（worklet.ts）と、表示用の計算（worker.ts）で同じものを使う。
 * 弦のモードを減衰する複素指数で回し、駒にかかる力を胴のモードへ入れて、1 m 先の音圧を出す。
 * 出力は 1 Pa を 1（フルスケール）とする
 */
import { type Body, cvLp, R_MIC } from './body';
import { AIR } from './strings';

/** 胴のモード（AudioWorklet へ送れる形） */
export interface BodyDesc {
  /** 2 自由度の模型の 2 つのモード: 極と、体積速度 ÷ 力の留数（実部・虚部） */
  cv: number[];
  /** 2 自由度の模型の放射の低域通過の境目 [Hz] */
  lp: number;
  /** 統計的なモード: 極（実部・虚部）、速度 ÷ 力の留数（実部・虚部）、力の向きの重み（垂直・平行）、音圧の重み */
  st: number[];
}
/** BodyDesc.st の 1 モードの長さ */
const ST = 7;

/** 胴の模型を、音を作る部分へ渡す形にする */
export function bodyDesc(b: Body): BodyDesc {
  const cv: number[] = [];
  for (const m of b.cv) cv.push(m.lam.re, m.lam.im, m.r.re, m.r.im);
  const st: number[] = [];
  for (const m of b.stat) {
    const wk = 2 * Math.PI * m.f,
      lr = (-m.eta * wk) / 2,
      li = wk * Math.sqrt(1 - (m.eta * m.eta) / 4),
      /* 速度 ÷ 力 = s / (m (s² + η ω_k s + ω_k²)) の極 λ の留数 λ / (m (λ − λ*)) */
      d = 2 * li * m.m;
    st.push(lr, li, li / d, -lr / d, Math.cos(m.th), Math.sin(m.th), m.G);
  }
  return { cv, lp: cvLp(b), st };
}

/** 撥弦 1 回ぶん（AudioWorklet へ送れる形） */
export interface PluckMsg {
  /** 弦（0 = 1 弦） */
  si: number;
  /** 偏波ごとのモードの数 */
  N: number;
  /** 角周波数 [rad/s]・減衰率 [1/s]・駒の力の振幅 [N]（長さ 2N、垂直が先） */
  w: Float64Array;
  s: Float64Array;
  f: Float64Array;
}

/** 撥弦をやめた弦のモードを消す時定数 [s]（新しく弾いたとき・指を離したとき） */
export const FADE_S = 0.01,
  DAMP_S = 0.06;
/** 離す前に駒にかかっていた力を、ゆっくり抜く時定数 [s]（胴の静かなたわみ。音にはならない） */
const PRE_S = 0.3;
/** 消すモードの大きさ [N] */
const FLOOR = 1e-7;
/** 1 Pa を出力の 1 とする */
export const P_REF = 1;

class Voice {
  si: number;
  n: number;
  nv: number;
  zr: Float64Array;
  zi: Float64Array;
  mr: Float64Array;
  mi: Float64Array;
  pol: Uint8Array;
  /** 消している途中なら 1 標本あたりに掛ける値（1 なら消さない） */
  fade = 1;
  constructor(p: PluckMsg, fs: number) {
    this.si = p.si;
    const n2 = 2 * p.N,
      T = 1 / fs;
    this.zr = new Float64Array(n2);
    this.zi = new Float64Array(n2);
    this.mr = new Float64Array(n2);
    this.mi = new Float64Array(n2);
    this.pol = new Uint8Array(n2);
    let k = 0;
    for (let i = 0; i < n2; i++) {
      if (Math.abs(p.f[i]) < FLOOR || p.w[i] * T > Math.PI * 0.95) continue;
      const e = Math.exp(-p.s[i] * T);
      this.zr[k] = p.f[i];
      this.zi[k] = 0;
      this.mr[k] = e * Math.cos(p.w[i] * T);
      this.mi[k] = e * Math.sin(p.w[i] * T);
      this.pol[k] = i < p.N ? 0 : 1;
      k++;
    }
    this.n = k;
    this.nv = 0;
  }
  /** 小さくなったモードを外す */
  prune(): void {
    let k = 0;
    const { zr, zi, mr, mi, pol } = this;
    for (let i = 0; i < this.n; i++) {
      if (zr[i] * zr[i] + zi[i] * zi[i] < FLOOR * FLOOR) continue;
      zr[k] = zr[i];
      zi[k] = zi[i];
      mr[k] = mr[i];
      mi[k] = mi[i];
      pol[k] = pol[i];
      k++;
    }
    this.n = k;
  }
}

/** 弦の力に足す雑音（こすれる音） */
interface Noise {
  si: number;
  buf: Float32Array;
  pos: number;
}

export class Engine {
  private voices: Voice[] = [];
  private noises: Noise[] = [];
  /* 胴: 2 自由度の模型 */
  private cvEr = new Float64Array(2);
  private cvEi = new Float64Array(2);
  private cvBr = new Float64Array(2);
  private cvBi = new Float64Array(2);
  private cvRr = new Float64Array(2);
  private cvRi = new Float64Array(2);
  private cvQr = new Float64Array(2);
  private cvQi = new Float64Array(2);
  private uPrev = 0;
  /* 2 次の低域通過（双 1 次変換） */
  private lb = [0, 0, 0, 0, 0];
  private lz = [0, 0];
  /* 胴: 統計的なモード */
  private nst = 0;
  private sEr = new Float64Array(0);
  private sEi = new Float64Array(0);
  private sBr = new Float64Array(0);
  private sBi = new Float64Array(0);
  private sRr = new Float64Array(0);
  private sRi = new Float64Array(0);
  private sCv = new Float64Array(0);
  private sCh = new Float64Array(0);
  private sG = new Float64Array(0);
  private sQr = new Float64Array(0);
  private sQi = new Float64Array(0);
  /* 離す前の力 */
  private preV = 0;
  private preH = 0;
  private readonly preK: number;
  /* 作業用 */
  private fv = new Float64Array(128);
  private fh = new Float64Array(128);
  private pr = new Float64Array(128);

  constructor(readonly fs: number) {
    this.preK = Math.exp(-1 / (PRE_S * fs));
  }

  /** 胴を入れ替える（モードの状態は 0 から） */
  setBody(d: BodyDesc): void {
    const T = 1 / this.fs;
    /* e^{λT} と (e^{λT} − 1) / λ */
    const disc = (lr: number, li: number): [number, number, number, number] => {
      const e = Math.exp(lr * T),
        er = e * Math.cos(li * T),
        ei = e * Math.sin(li * T),
        nr = er - 1,
        ni = ei,
        dd = lr * lr + li * li;
      return [er, ei, (nr * lr + ni * li) / dd, (ni * lr - nr * li) / dd];
    };
    for (let k = 0; k < 2; k++) {
      const [er, ei, br, bi] = disc(d.cv[4 * k], d.cv[4 * k + 1]);
      this.cvEr[k] = er;
      this.cvEi[k] = ei;
      this.cvBr[k] = br;
      this.cvBi[k] = bi;
      this.cvRr[k] = d.cv[4 * k + 2];
      this.cvRi[k] = d.cv[4 * k + 3];
    }
    this.cvQr.fill(0);
    this.cvQi.fill(0);
    this.uPrev = 0;
    /* 2 次のバターワース低域通過 */
    const K = Math.tan((Math.PI * d.lp) / this.fs),
      q = Math.SQRT2,
      n = 1 / (1 + q * K + K * K);
    this.lb = [K * K * n, 2 * K * K * n, K * K * n, 2 * (K * K - 1) * n, (1 - q * K + K * K) * n];
    this.lz = [0, 0];
    const m = d.st.length / ST;
    this.nst = m;
    for (const k of ['sEr', 'sEi', 'sBr', 'sBi', 'sRr', 'sRi', 'sCv', 'sCh', 'sG', 'sQr', 'sQi'] as const)
      this[k] = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const o = k * ST,
        [er, ei, br, bi] = disc(d.st[o], d.st[o + 1]);
      this.sEr[k] = er;
      this.sEi[k] = ei;
      this.sBr[k] = br;
      this.sBi[k] = bi;
      this.sRr[k] = d.st[o + 2];
      this.sRi[k] = d.st[o + 3];
      this.sCv[k] = d.st[o + 4];
      this.sCh[k] = d.st[o + 5];
      this.sG[k] = d.st[o + 6];
    }
  }

  /** 弦を弾く。同じ弦の前の振動は指が触れて消える */
  pluck(p: PluckMsg): void {
    this.damp(p.si, FADE_S);
    const v = new Voice(p, this.fs);
    for (let i = 0; i < v.n; i++)
      if (v.pol[i]) this.preH += v.zr[i];
      else this.preV += v.zr[i];
    this.voices.push(v);
  }

  /** 弦の振動を時定数 tau [s] で止める（指を離す・触れる） */
  damp(si: number, tau = DAMP_S): void {
    const g = Math.exp(-1 / (tau * this.fs));
    for (const v of this.voices) if (v.si === si) v.fade = Math.min(v.fade, g);
  }

  /** すべての弦を止める */
  dampAll(tau = DAMP_S): void {
    for (let s = 0; s < 6; s++) this.damp(s, tau);
  }

  /** 弦 si の駒の力（垂直）に雑音を足す [N] */
  noise(si: number, buf: Float32Array): void {
    this.noises.push({ si, buf, pos: 0 });
  }

  /** 鳴っている弦（0 = 1 弦）の集合 */
  active(): Set<number> {
    return new Set(this.voices.map((v) => v.si));
  }

  /** out[off] から len 標本を書く（上書き）。len は 128 以下 */
  render(out: Float32Array | Float64Array, off: number, len: number): void {
    const { fv, fh, pr } = this;
    fv.fill(0, 0, len);
    fh.fill(0, 0, len);
    pr.fill(0, 0, len);
    /* 弦 → 駒の力 */
    for (const v of this.voices) {
      const { zr, zi, mr, mi, pol } = v;
      if (v.fade < 1) {
        for (let k = 0; k < v.n; k++) {
          mr[k] *= v.fade;
          mi[k] *= v.fade;
        }
        v.fade = 1;
      }
      for (let k = 0; k < v.n; k++) {
        let r = zr[k],
          im = zi[k];
        const a = mr[k],
          b = mi[k],
          dst = pol[k] ? fh : fv;
        for (let i = 0; i < len; i++) {
          dst[i] += r;
          const t = r * a - im * b;
          im = r * b + im * a;
          r = t;
        }
        zr[k] = r;
        zi[k] = im;
      }
      v.prune();
    }
    this.voices = this.voices.filter((v) => v.n > 0);
    for (const nz of this.noises) {
      const n = Math.min(len, nz.buf.length - nz.pos);
      for (let i = 0; i < n; i++) fv[i] += nz.buf[nz.pos + i];
      nz.pos += n;
    }
    this.noises = this.noises.filter((nz) => nz.pos < nz.buf.length);
    /* 離す前の力を引く */
    for (let i = 0; i < len; i++) {
      fv[i] -= this.preV;
      fh[i] -= this.preH;
      this.preV *= this.preK;
      this.preH *= this.preK;
    }
    /* 胴: 統計的なモード（速度 × 音圧の重み） */
    const { sEr, sEi, sBr, sBi, sRr, sRi, sCv, sCh, sG, sQr, sQi } = this;
    for (let k = 0; k < this.nst; k++) {
      let qr = sQr[k],
        qi = sQi[k];
      const er = sEr[k],
        ei = sEi[k],
        br = sBr[k],
        bi = sBi[k],
        cv = sCv[k],
        ch = sCh[k],
        gr = 2 * sG[k] * sRr[k],
        gi = 2 * sG[k] * sRi[k];
      for (let i = 0; i < len; i++) {
        const d = cv * fv[i] + ch * fh[i],
          t = qr * er - qi * ei + br * d;
        qi = qr * ei + qi * er + bi * d;
        qr = t;
        pr[i] += gr * qr - gi * qi;
      }
      sQr[k] = qr;
      sQi[k] = qi;
    }
    /* 胴: 2 自由度の模型（体積速度の微分を低域通過に通す） */
    const kp = (AIR.rho / (4 * Math.PI * R_MIC)) * this.fs,
      [b0, b1, b2, a1, a2] = this.lb;
    let [z1, z2] = this.lz,
      up = this.uPrev;
    for (let i = 0; i < len; i++) {
      let u = 0;
      for (let k = 0; k < 2; k++) {
        const qr = this.cvQr[k],
          qi = this.cvQi[k],
          er = this.cvEr[k],
          ei = this.cvEi[k],
          nr = qr * er - qi * ei + this.cvBr[k] * fv[i],
          ni = qr * ei + qi * er + this.cvBi[k] * fv[i];
        this.cvQr[k] = nr;
        this.cvQi[k] = ni;
        u += 2 * (this.cvRr[k] * nr - this.cvRi[k] * ni);
      }
      const x = kp * (u - up);
      up = u;
      /* 転置直接形 II */
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      out[off + i] = (pr[i] + y) / P_REF;
    }
    this.lz = [z1, z2];
    this.uPrev = up;
  }
}

/**
 * ピアス型の水晶発振回路（CMOS インバータ 1 個・帰還抵抗 Rf・制限抵抗 Rd・C1・C2）の計算。
 * 水晶は等価回路（直列の Rm・Lm・Cm に並列の C0）で表す。
 * 発振の条件は、水晶の振動の枝（Rm・Lm・Cm）から外側を見たインピーダンスの実部（負性抵抗）が Rm を上回ること
 */
import type { Crystal } from './crystals';

export const TAU = 2 * Math.PI;
/** 端子ごとの浮遊容量（インバータの入出力・配線）。C1・C2 に足す */
export const CS = 3e-12;
/** 電源電圧 */
export const VDD = 5;
/**
 * 74HCU04 を 5 V で中点にバイアスしたとき。gm はデータシートの順方向トランスコンダクタンス（typ 30 mA/V）、
 * ro は開ループ利得 20 を gm で割った出力抵抗、ron は振り切ったときの出力抵抗（このツールで決めた値）
 */
export const INV = { gm: 30e-3, ro: 20 / 30e-3, ron: 100 };
/** 起動の始まりの振れ幅（雑音） */
export const A0 = 1e-6;
/** 発振余裕度の目安。これ未満は「余裕が少ない」 */
export const MARGIN_OK = 5;

export interface Parts {
  /** XIN 側の容量 [F] */
  c1: number;
  /** 出力側の容量 [F] */
  c2: number;
  /** 制限抵抗 [Ω] */
  rd: number;
  /** 帰還抵抗 [Ω] */
  rf: number;
}

/** 0 発振しない・1 余裕が少ない・2 安定・3 過励振 */
export type State = 0 | 1 | 2 | 3;
export const STATE_NAME = ['発振しない', '余裕が少ない', '安定', '過励振'] as const;

export interface Result {
  x: Crystal;
  /** 直列共振周波数 [Hz] */
  fs: number;
  /** 発振周波数 [Hz] */
  f: number;
  /** 公称値からのずれ [ppm] */
  ppm: number;
  /** 等価インダクタンス [H] */
  lm: number;
  /** 回路の負荷容量（浮遊容量を含む）[F] */
  cl: number;
  /** 負性抵抗の大きさ [Ω]（負なら損失） */
  rneg: number;
  /** 発振余裕度（rneg / Rm） */
  margin: number;
  q: number;
  /** 振れ幅が増える速さ [1/s]（e 倍になる時間の逆数） */
  alpha: number;
  /** 起動時間（雑音から定常の振れ幅まで）[s]。発振しないなら Infinity */
  ts: number;
  /** 電源を切ったあとの振れ幅の時定数 [s] */
  tau: number;
  /** 定常の振れ幅（片振幅）[V]: XIN・水晶の右端 */
  vIn: number;
  vR: number;
  /** 水晶の電流の振幅 [A] */
  i: number;
  /** 励振レベル [W] */
  p: number;
  st: State;
}

interface Cx {
  re: number;
  im: number;
}
const cx = (re: number, im = 0): Cx => ({ re, im });
const add = (a: Cx, b: Cx) => cx(a.re + b.re, a.im + b.im);
const sub = (a: Cx, b: Cx) => cx(a.re - b.re, a.im - b.im);
const mul = (a: Cx, b: Cx) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: Cx, b: Cx) => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};

/** 制限抵抗を通したインバータ（電流源 gm と出力抵抗 ro）を、水晶の右端から見た電流源と並列のコンダクタンスに直す */
export function inverterAt(rd: number): { gm: number; g: number } {
  return { gm: (INV.gm * INV.ro) / (INV.ro + rd), g: 1 / (INV.ro + rd) };
}

/**
 * 振動の枝から外側を見たインピーダンス。節点は XIN（1）と水晶の右端（2）。
 * 1 A を XIN に入れて右端から抜いたときの電圧差で求める
 */
export function zOut(w: number, x: Crystal, p: Parts): Cx {
  const c1 = p.c1 + CS,
    c2 = p.c2 + CS,
    inv = inverterAt(p.rd);
  /* C0 と Rf は XIN と右端の間 */
  const y0 = cx(1 / p.rf, w * x.c0);
  const y11 = add(cx(0, w * c1), y0),
    y22 = add(cx(inv.g, w * c2), y0),
    y12 = cx(-y0.re, -y0.im),
    /* インバータは XIN の電圧で右端へ −gm·V1 の電流を流す（右端から抜ける向きを正） */
    y21 = cx(-y0.re + inv.gm, -y0.im);
  const det = sub(mul(y11, y22), mul(y12, y21));
  const v1 = div(add(y22, y12), det),
    v2 = div(cx(-y21.re - y11.re, -y21.im - y11.im), det);
  return sub(v1, v2);
}

/** 負荷容量（直列の C1・C2 に浮遊容量を足したもの） */
export const loadCap = (p: Parts): number => {
  const c1 = p.c1 + CS,
    c2 = p.c2 + CS;
  return (c1 * c2) / (c1 + c2);
};

export function solve(x: Crystal, p: Parts): Result {
  const fs = x.f / Math.sqrt(1 + x.cm / (x.c0 + x.cl)),
    lm = 1 / ((TAU * fs) ** 2 * x.cm),
    cl = loadCap(p),
    f = fs * Math.sqrt(1 + x.cm / (x.c0 + cl)),
    w = TAU * f,
    rneg = -zOut(w, x, p).re,
    margin = rneg / x.rm,
    q = (TAU * fs * lm) / x.rm,
    alpha = (rneg - x.rm) / (2 * lm),
    tau = (2 * lm) / x.rm;
  /* 定常の振れ幅: インバータの出力を振り切った矩形波とみて、Rd と C2 で丸めた基本波が右端に出る。
     水晶を通る電流は C1 にも C2 にも流れるので、XIN は右端の C2/C1 倍。XIN はインバータの入力で頭打ち */
  const c1 = p.c1 + CS,
    c2 = p.c2 + CS;
  const vq = (4 / Math.PI) * (VDD / 2),
    vR0 = vq / Math.hypot(1, w * (p.rd + INV.ron) * c2),
    vIn = Math.min(0.45 * VDD, (vR0 * c2) / c1),
    vR = (vIn * c1) / c2,
    i = w * c1 * vIn,
    pw = (i * i * x.rm) / 2;
  const osc = margin > 1;
  const st: State = !osc ? 0 : pw > x.pmax ? 3 : margin < MARGIN_OK ? 1 : 2;
  return {
    x,
    fs,
    f,
    ppm: (f / x.f - 1) * 1e6,
    lm,
    cl,
    rneg,
    margin,
    q,
    alpha,
    ts: osc ? Math.log(vIn / A0) / alpha : Number.POSITIVE_INFINITY,
    tau,
    vIn: osc ? vIn : 0,
    vR: osc ? vR : 0,
    i: osc ? i : 0,
    p: osc ? pw : 0,
    st,
  };
}

/**
 * 時刻 t [s] の XIN の振れ幅。電源を入れた時刻を 0 とし、off は電源を切った時刻。
 * 起動は指数関数で増えて定常で頭打ちになる（ロジスティック形）。切ったあとは時定数 tau で減る
 */
export function amp(r: Result, t: number, off: number | null = null): number {
  if (r.st === 0) return 0;
  const A = r.vIn,
    grow = (u: number) => A / Math.sqrt(1 + ((A * A) / (A0 * A0) - 1) * Math.exp(-2 * r.alpha * u));
  if (off == null || t < off) return grow(Math.max(0, t));
  return grow(off) * Math.exp(-(t - off) / r.tau);
}

/** 各点の電圧と電流。a は XIN の振れ幅、ph は位相 [rad]、on は電源 */
export interface Probe {
  xin: number;
  xout: number;
  xr: number;
  out: number;
  /** 水晶の電流（右端 → XIN を正）[A] */
  ix: number;
  /** Rf の電流（XOUT → XIN を正）、Rd の電流（XOUT → 右端を正）、C1・C2 の電流（上 → GND を正）[A] */
  irf: number;
  ird: number;
  ic1: number;
  ic2: number;
}
export function probe(r: Result, p: Parts, a: number, ph: number, on: boolean): Probe {
  const mid = on ? VDD / 2 : 0,
    s = Math.sin(ph),
    c = Math.cos(ph),
    w = TAU * r.f,
    clip = (v: number) => Math.max(0, Math.min(VDD, v));
  const xin = mid + a * s,
    /* インバータの出力: 小さいうちは gm·ro 倍、大きくなると振り切る */
    xout = on ? clip(mid - INV.gm * INV.ro * a * s) : 0,
    k = (p.c1 + CS) / (p.c2 + CS),
    xr = mid - k * a * s,
    out = on ? clip(mid + 60 * (mid - xout)) : 0;
  const ix = (p.c1 + CS) * a * w * c,
    irf = (xout - xin) / p.rf,
    ic1 = ix + irf,
    /* Rd の電流は両端の電圧から。C2 の電流は右端の節点の出入りのつり合いから */
    ird = (xout - xr) / (p.rd + INV.ron),
    ic2 = ird - ix;
  return { xin, xout, xr, out, ix, irf, ird, ic1, ic2 };
}

/** 振動の枝（Rm・Lm・Cm）に 1 V をかけたときの電流の大きさ [S]。df は fs からのずれ [Hz]。C0 は含めない */
export function admittance(x: Crystal, lm: number, fs: number, df: number): number {
  const w = TAU * (fs + df);
  return 1 / Math.hypot(x.rm, w * lm - 1 / (w * x.cm));
}

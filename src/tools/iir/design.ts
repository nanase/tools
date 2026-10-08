/**
 * IIR フィルタの設計の流れ: 仕様 → プリワーピング → 原型（正規化した LPF）→ 周波数変換 → 双一次変換。
 * 比べるために、プリワーピングしないアナログフィルタ（インパルス不変法の元）も作る。
 * DOM に依存しない
 */
import {
  A3,
  analogToProto,
  bessel,
  butter,
  cheby1,
  cheby2,
  cheby2Pass,
  edgeOf,
  ellip,
  epsOf,
  type Kind,
  lp2bp,
  lp2bs,
  lp2hp,
  lp2lp,
  minOrder,
  protoToAnalog,
  type Resp,
  rescale,
  type ZPK,
} from './analog';
import { bilinear, prewarp, unwarp, zpkFns } from './digital';

export type Mode = 'order' | 'spec';

export interface Spec {
  kind: Kind;
  resp: Resp;
  mode: Mode;
  /** 原型の次数（次数を指定するとき） */
  n: number;
  /** 基準の端 [Hz]（仕様なら通過域端）。BPF・BSF は f1 < f2 */
  f1: number;
  f2: number;
  /** 阻止域端 [Hz]（仕様のとき） */
  s1: number;
  s2: number;
  /** 通過域の減衰（リップル）・阻止域の減衰量 [dB] */
  ap: number;
  as: number;
  fs: number;
  /** 次数を固定する（試聴で別の fs のときも画面と同じ次数にする） */
  nFix?: number;
}

/** 仕様の枠（[Hz] の区間と減衰） */
export interface Mask {
  pass: [number, number][];
  ap: number | null;
  stop: [number, number][];
  as: number | null;
}

export interface Design {
  spec: Spec;
  /** 原型の次数 */
  N: number;
  /** 切り上げる前の次数（仕様から求めたとき。ベッセルは null） */
  exact: number | null;
  /** 上限の次数でも仕様を満たさない */
  short: boolean;
  /** 原型での阻止域の始まり（減衰 As に達する周波数）。なければ null */
  wst: number | null;
  /** 仕様の選択度（原型の阻止域端 / 通過域端） */
  sel: number | null;
  proto: ZPK;
  /** プリワーピングしたアナログフィルタ（双一次変換の元） */
  ana: ZPK;
  /** プリワーピングしないアナログフィルタ（目標の周波数そのまま。インパルス不変法の元） */
  ana0: ZPK;
  dig: ZPK;
  /** 周波数変換の中心・帯域幅（プリワーピングした値 [rad/s]） */
  wo: number;
  bw: number;
  mask: Mask;
}

export const isBand = (r: Resp): boolean => r === 'bp' || r === 'bs';

/** 周波数変換の中心と帯域幅（W は Hz → rad/s の写像） */
function centre(s: Spec, W: (f: number) => number): { wo: number; bw: number } {
  if (!isBand(s.resp)) return { wo: W(s.f1), bw: 0 };
  const a = W(s.f1),
    b = W(s.f2);
  return { wo: Math.sqrt(a * b), bw: b - a };
}

function transform(f: ZPK, r: Resp, wo: number, bw: number): ZPK {
  switch (r) {
    case 'lp':
      return lp2lp(f, wo);
    case 'hp':
      return lp2hp(f, wo);
    case 'bp':
      return lp2bp(f, wo, bw);
    case 'bs':
      return lp2bs(f, wo, bw);
  }
}

/** 阻止域の端 [Hz]（1〜2 個）から阻止域の区間を作る */
function stopIv(r: Resp, e: readonly number[], nyq: number): [number, number][] {
  switch (r) {
    case 'lp':
      return [[e[0], nyq]];
    case 'hp':
      return [[0, e[0]]];
    case 'bp':
      return [
        [0, e[0]],
        [e[1], nyq],
      ];
    case 'bs':
      return [[e[0], e[1]]];
  }
}
function passIv(s: Spec, nyq: number): [number, number][] {
  switch (s.resp) {
    case 'lp':
      return [[0, s.f1]];
    case 'hp':
      return [[s.f1, nyq]];
    case 'bp':
      return [[s.f1, s.f2]];
    case 'bs':
      return [
        [0, s.f1],
        [s.f2, nyq],
      ];
  }
}

/** 仕様の選択度: プリワーピングした阻止域端を原型の周波数にしたもの（BPF・BSF は厳しい方） */
export function selectivity(s: Spec): number {
  const W = (f: number) => prewarp(f, s.fs),
    { wo, bw } = centre(s, W);
  const e = isBand(s.resp) ? [s.s1, s.s2] : [s.s1];
  return Math.min(...e.map((f) => analogToProto(s.resp, W(f), wo, bw)));
}

/** 原型（基準の端を Ω = 1 に置いた LPF） */
function prototype(kind: Kind, N: number, s: Spec): ZPK & { ks?: number } {
  const spec = s.mode === 'spec';
  switch (kind) {
    case 'butter':
      return butter(N, spec ? s.ap : A3);
    case 'cheby1':
      return cheby1(N, s.ap);
    case 'cheby2':
      return spec ? rescale(cheby2(N, s.as), cheby2Pass(N, s.ap, s.as)) : cheby2(N, s.as);
    case 'ellip':
      return ellip(N, s.ap, s.as);
    case 'bessel':
      return bessel(N, spec ? s.ap : A3);
  }
}

/** 原型で減衰 As に達する周波数（阻止域の始まり） */
function stopStart(kind: Kind, s: Spec, p: ZPK & { ks?: number }, N: number): number | null {
  const spec = s.mode === 'spec';
  switch (kind) {
    case 'ellip':
      return 1 / (p.ks ?? 1);
    case 'cheby2':
      return spec ? Math.cosh(Math.acosh(epsOf(s.as) / epsOf(s.ap)) / N) : 1;
    case 'butter':
      return spec ? (epsOf(s.as) / epsOf(s.ap)) ** (1 / N) : null;
    case 'cheby1':
      return spec ? Math.cosh(Math.acosh(epsOf(s.as) / epsOf(s.ap)) / N) : null;
    case 'bessel':
      return spec ? edgeOf(p, s.as) : null;
  }
}

export function design(s: Spec): Design {
  const nyq = s.fs / 2;
  let N = Math.round(s.n),
    exact: number | null = null,
    short = false,
    sel: number | null = null;
  if (s.mode === 'spec') {
    sel = selectivity(s);
    if (s.nFix) N = s.nFix;
    else ({ N, exact, short } = minOrder(s.kind, sel, s.ap, s.as));
  }
  const proto = prototype(s.kind, N, s);
  const { wo, bw } = centre(s, (f) => prewarp(f, s.fs)),
    c0 = centre(s, (f) => 2 * Math.PI * f);
  const ana = transform(proto, s.resp, wo, bw),
    ana0 = transform(proto, s.resp, c0.wo, c0.bw),
    dig = bilinear(ana, s.fs);
  const wst = stopStart(s.kind, s, proto, N);
  /* 仕様の枠: 仕様から設計したときは入力した仕様、次数を指定したときは設計の基準 */
  let mask: Mask;
  if (s.mode === 'spec')
    mask = {
      pass: passIv(s, nyq),
      ap: s.ap,
      stop: stopIv(s.resp, isBand(s.resp) ? [s.s1, s.s2] : [s.s1], nyq),
      as: s.as,
    };
  else if (s.kind === 'cheby2')
    mask = { pass: [], ap: null, stop: stopIv(s.resp, isBand(s.resp) ? [s.f1, s.f2] : [s.f1], nyq), as: s.as };
  else {
    const ap = s.kind === 'butter' || s.kind === 'bessel' ? A3 : s.ap;
    mask = { pass: passIv(s, nyq), ap, stop: [], as: null };
    if (s.kind === 'ellip' && wst)
      mask = { ...mask, stop: stopIv(s.resp, stopEdges(s.resp, wst, wo, bw, s.fs), nyq), as: s.as };
  }
  return { spec: s, N, exact, short, wst, sel, proto, ana, ana0, dig, wo, bw, mask };
}

/** 原型の周波数 W を、デジタルの周波数 [Hz] へ */
export const stopEdges = (r: Resp, W: number, wo: number, bw: number, fs: number): number[] =>
  protoToAnalog(r, W, wo, bw).map((w) => unwarp(w, fs));

/* ---------- 実際の特性 ---------- */
export interface Metrics {
  /** −3 dB の周波数（LPF・HPF は 1 つ、BPF・BSF は下と上） */
  f3: number[];
  /** 通過域の振幅の変動（最大 − 最小）[dB] */
  ripple: number | null;
  /** 阻止域の最小の減衰量 [dB] */
  atten: number | null;
  /** 実際の阻止域の端（減衰が As に達する周波数）[Hz] */
  fst: number[] | null;
  /** 通過域の群遅延の最小・最大 [サンプル] */
  gd: [number, number] | null;
}

type Fn = (w: number) => number;

/** 振幅が −3.0103 dB を横切る周波数を、a（−3 dB より上）と b の間で二分法で求める */
function cross(mag: Fn, fs: number, a: number, b: number): number {
  const w = (f: number) => (2 * Math.PI * f) / fs;
  let lo = a,
    hi = b;
  for (let i = 0; i < 50; i++) {
    const m = Math.sqrt(lo * hi) || (lo + hi) / 2;
    if (mag(w(m)) >= -A3) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** −3 dB の周波数。LPF は高い方から、HPF は低い方から探す（通過域のリップルの谷を拾わない） */
export function f3dB(D: Design, mag: Fn = zpkFns(D.dig).mag): number[] {
  const s = D.spec,
    fs = s.fs,
    nyq = fs / 2;
  const n = 1200,
    lo = Math.min(s.f1, s.mode === 'spec' ? s.s1 : s.f1) / 1000;
  const g = Array.from({ length: n + 1 }, (_, i) => lo * (nyq / lo) ** (i / n));
  g[n] = nyq * (1 - 1e-12);
  const m = g.map((f) => mag((2 * Math.PI * f) / fs)),
    up = (from: number) => {
      for (let i = from; i <= n; i++) if (m[i] >= -A3) return i > 0 ? cross(mag, fs, g[i], g[i - 1]) : g[0];
      return NaN;
    },
    down = (from: number) => {
      for (let i = from; i >= 0; i--) if (m[i] >= -A3) return i < n ? cross(mag, fs, g[i], g[i + 1]) : g[n];
      return NaN;
    };
  switch (s.resp) {
    case 'lp':
      return [down(n)];
    case 'hp':
      return [up(0)];
    case 'bp':
      return [up(0), down(n)];
    case 'bs': {
      const fc = unwarp(D.wo, fs);
      let c = 0;
      while (c < n && g[c] < fc) c++;
      return [down(c), up(c)];
    }
  }
}

/** 黄金分割法で、[lo, hi] の中の v の最大を詰める */
function golden(v: Fn, lo: number, hi: number): number {
  const r = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const x1 = hi - r * (hi - lo),
      x2 = lo + r * (hi - lo);
    if (v(x1) > v(x2)) hi = x2;
    else lo = x1;
  }
  return v((lo + hi) / 2);
}

/** 区間の中の最小と最大。刻んだ点で探してから、山と谷を黄金分割法で詰める */
function range(fn: Fn, iv: readonly [number, number][], fs: number, n: number): [number, number] {
  const nyq = fs / 2;
  let mn = Infinity,
    mx = -Infinity;
  for (const [a, b0] of iv) {
    const b = Math.min(b0, nyq * (1 - 1e-12)),
      h = (b - a) / n,
      v = (f: number) => fn((2 * Math.PI * f) / fs);
    let iMx = 0,
      iMn = 0,
      vMx = -Infinity,
      vMn = Infinity;
    for (let i = 0; i <= n; i++) {
      const x = v(a + h * i);
      if (Number.isNaN(x)) continue;
      if (x > vMx) {
        vMx = x;
        iMx = i;
      }
      if (x < vMn) {
        vMn = x;
        iMn = i;
      }
    }
    const near = (i: number): [number, number] => [Math.max(a, a + h * (i - 1)), Math.min(b, a + h * (i + 1))];
    mx = Math.max(mx, vMx, golden(v, ...near(iMx)));
    mn = Math.min(mn, vMn, -golden((f) => -v(f), ...near(iMn)));
  }
  return [mn, mx];
}

export function metrics(D: Design): Metrics {
  const { dig: d, spec: s, mask } = D,
    fs = s.fs,
    nyq = fs / 2,
    F = zpkFns(d);
  const f3 = f3dB(D, F.mag);
  let ripple: number | null = null,
    gd: [number, number] | null = null;
  /* 通過域（なければ −3 dB の内側）の振幅の変動と群遅延 */
  let pass = mask.pass;
  if (!pass.length && f3.every(Number.isFinite))
    pass =
      s.resp === 'lp'
        ? [[0, f3[0]]]
        : s.resp === 'hp'
          ? [[f3[0], nyq]]
          : s.resp === 'bp'
            ? [[f3[0], f3[1]]]
            : [
                [0, f3[0]],
                [f3[1], nyq],
              ];
  if (pass.length) {
    const n = 20 * D.N + 200;
    if (mask.pass.length) {
      const [mn, mx] = range(F.mag, pass, fs, n);
      ripple = mx - mn;
    }
    gd = range(F.gd, pass, fs, n);
  }
  const atten = mask.stop.length ? -range(F.mag, mask.stop, fs, 30 * D.N + 300)[1] : null;
  const fst = D.wst ? stopEdges(s.resp, D.wst, D.wo, D.bw, fs) : null;
  return { f3, ripple, atten, fst, gd };
}

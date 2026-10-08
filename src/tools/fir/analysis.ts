/**
 * 設計した係数の解析（DOM に依存しない）: 周波数特性（振幅・位相・群遅延）、仕様に対する実際の値、
 * 同じ仕様の IIR フィルタの次数、零点
 */
import { fft } from '../biquad/filter';
import { type Band, type Resp, twoEdges } from './spec';

/* ---------- 周波数特性 ---------- */
export interface Freq {
  /** FFT の点数（周波数の刻みは fs/L） */
  L: number;
  /** k = 0 … L/2 の振幅 |H|・位相 [°]（2π の飛びをつないだもの）・群遅延 [サンプル]（零点の近くは NaN） */
  mag: Float64Array;
  ph: Float64Array;
  gd: Float64Array;
}

/** 周波数特性を求める FFT の点数: 1 つのリップルに 32 点ほど入る長さ */
export const fftLen = (N: number): number => {
  let L = 1 << 14;
  while (L < 64 * N && L < 1 << 18) L *= 2;
  return L;
};

/** 長さ L に 0 を足して FFT し、振幅・位相・群遅延（Σ n h[n] e^{−jωn} / H の実部）を求める */
export function freqResp(h: Float64Array, L = fftLen(h.length)): Freq {
  const ar = new Float64Array(L),
    ai = new Float64Array(L),
    br = new Float64Array(L),
    bi = new Float64Array(L);
  h.forEach((v, n) => {
    ar[n] = v;
    br[n] = n * v;
  });
  fft(ar, ai);
  fft(br, bi);
  const K = L / 2 + 1,
    mag = new Float64Array(K),
    ph = new Float64Array(K),
    gd = new Float64Array(K);
  let mx = 0;
  for (let k = 0; k < K; k++) {
    mag[k] = Math.hypot(ar[k], ai[k]);
    if (mag[k] > mx) mx = mag[k];
  }
  let prev = 0,
    off = 0;
  for (let k = 0; k < K; k++) {
    /* 隣の点との差が ±π を超えたら 2π を足し引きしてつなぐ */
    const a = Math.atan2(ai[k], ar[k]);
    if (k) {
      let d = a + off - prev;
      while (d > Math.PI) {
        off -= 2 * Math.PI;
        d -= 2 * Math.PI;
      }
      while (d < -Math.PI) {
        off += 2 * Math.PI;
        d += 2 * Math.PI;
      }
    }
    prev = a + off;
    ph[k] = (prev * 180) / Math.PI;
    const p = mag[k] * mag[k];
    gd[k] = mag[k] > mx * 1e-9 ? (br[k] * ar[k] + bi[k] * ai[k]) / p : Number.NaN;
  }
  return { L, mag, ph, gd };
}

/** 1 つの周波数 f（fs で割った値）での |H| */
export function magAt(h: Float64Array, f: number): number {
  let re = 0,
    im = 0;
  const w = 2 * Math.PI * f;
  h.forEach((v, n) => {
    re += v * Math.cos(w * n);
    im -= v * Math.sin(w * n);
  });
  return Math.hypot(re, im);
}

/* ---------- 仕様に対する実際の値 ---------- */
export interface Metrics {
  /** 通過域の最大・最小と阻止域の最大の |H| */
  passMax: number;
  passMin: number;
  stopMax: number;
  /** 通過域のリップル [dB]（ピーク間） */
  ripple: number;
  /** 阻止域の減衰 [dB] */
  atten: number;
  /** 通過域の 1 からのずれの最大 δp と、阻止域の最大 δs */
  dp: number;
  ds: number;
  /** 実際の遷移帯域幅（fs で割った値。2 か所あれば広い方） */
  trans: number;
}

/** 3 点の放物線で極値を求め直す（頂点が帯域の外なら y1 のまま） */
function peak(y0: number, y1: number, y2: number): { y: number; p: number } {
  const d = y0 - 2 * y1 + y2;
  if (d === 0) return { y: y1, p: 0 };
  const p = (y0 - y2) / (2 * d);
  return Math.abs(p) <= 0.5 ? { y: y1 - ((y0 - y2) * p) / 4, p } : { y: y1, p: 0 };
}

/** 帯域 [lo, hi] での |H| の最大と最小（格子の極値を放物線で補い、帯域の端は直接求める） */
function bandMinMax(h: Float64Array, fr: Freq, lo: number, hi: number): [number, number] {
  const { L, mag } = fr;
  let mx = Math.max(magAt(h, lo), magAt(h, hi)),
    mn = Math.min(magAt(h, lo), magAt(h, hi));
  const k0 = Math.ceil(lo * L - 1e-9),
    k1 = Math.floor(hi * L + 1e-9);
  for (let k = k0; k <= k1; k++) {
    const y = mag[k];
    if (y > mx) mx = y;
    if (y < mn) mn = y;
    if (k <= 0 || k >= mag.length - 1) continue;
    const a = mag[k - 1],
      b = mag[k + 1];
    if ((y >= a && y >= b) || (y <= a && y <= b)) {
      const q = peak(a, y, b),
        f = (k + q.p) / L;
      if (f < lo || f > hi) continue;
      if (q.y > mx) mx = q.y;
      if (q.y < mn) mn = Math.max(0, q.y);
    }
  }
  return [mx, mn];
}

/**
 * 遷移帯域 [e0, e1] の実際の幅: 通過域の端から、|H| が 1 ± tp を外れるところまで進み、阻止域の端から、
 * |H| が ts を超えるところまで戻る。その間の幅（交わる点は線形補間）
 */
function transWidth(h: Float64Array, fr: Freq, e0: number, e1: number, passFirst: boolean, tp: number, ts: number) {
  const { L, mag } = fr,
    k0 = Math.ceil(e0 * L + 1e-9),
    k1 = Math.floor(e1 * L - 1e-9);
  const pts: [number, number][] = [[e0, magAt(h, e0)]];
  for (let k = k0; k <= k1; k++) pts.push([k / L, mag[k]]);
  pts.push([e1, magAt(h, e1)]);
  if (!passFirst) pts.reverse();
  const cross = (inside: (m: number) => boolean, level: (m: number) => number, list: [number, number][]) => {
    for (let i = 1; i < list.length; i++) {
      const [f, m] = list[i];
      if (inside(m)) continue;
      const [fp, mp] = list[i - 1],
        lv = level(m);
      return m === mp ? f : fp + ((lv - mp) / (m - mp)) * (f - fp);
    }
    return list[list.length - 1][0];
  };
  const fpA = cross(
    (m) => Math.abs(m - 1) <= tp,
    (m) => (m < 1 ? 1 - tp : 1 + tp),
    pts,
  );
  const fsA = cross(
    (m) => m <= ts,
    () => ts,
    pts.slice().reverse(),
  );
  return Math.max(0, Math.abs(fsA - fpA));
}

/** 仕様の帯域で実際のリップル・減衰・遷移帯域幅を測る。dp・ds は仕様の許容値 */
export function measure(h: Float64Array, fr: Freq, bands: readonly Band[], dp: number, ds: number): Metrics {
  let pMax = 0,
    pMin = Infinity,
    sMax = 0;
  for (const b of bands) {
    const [mx, mn] = bandMinMax(h, fr, b.lo, b.hi);
    if (b.pass) {
      pMax = Math.max(pMax, mx);
      pMin = Math.min(pMin, mn);
    } else sMax = Math.max(sMax, mx);
  }
  const dpA = Math.max(pMax - 1, 1 - pMin),
    tp = Math.max(dp, dpA) * (1 + 1e-9),
    ts = Math.max(ds, sMax) * (1 + 1e-9);
  let trans = 0;
  for (let i = 0; i + 1 < bands.length; i++)
    trans = Math.max(trans, transWidth(h, fr, bands[i].hi, bands[i + 1].lo, bands[i].pass, tp, ts));
  return {
    passMax: pMax,
    passMin: pMin,
    stopMax: sMax,
    ripple: 20 * Math.log10(pMax / pMin),
    atten: -20 * Math.log10(sMax),
    dp: dpA,
    ds: sMax,
    trans,
  };
}

/* ---------- 同じ仕様の IIR フィルタ ---------- */
/** 算術幾何平均 */
function agm(a: number, b: number): number {
  for (let i = 0; i < 60 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return a;
}
/** 第 1 種完全楕円積分 K を、補母数 k′ = √(1 − k²) から求める（K = π / (2 AGM(1, k′))） */
export const ellipKc = (kp: number): number => Math.PI / (2 * agm(1, kp));

export interface IirOrder {
  ellip: number;
  butter: number;
  /** 低域の原型の選択度 k（通過域端 / 阻止域端、1 未満）と識別度 k1 */
  k: number;
  k1: number;
}

/**
 * 同じ仕様（双一次変換で帯域端を写す）を満たすアナログ原型の次数から、デジタル IIR フィルタの次数を求める。
 * 楕円: n ≥ K(k) K′(k1) / (K′(k) K(k1))、バタワース: n ≥ log(1/k1) / log(1/k)（BPF・BSF は 2 倍）
 */
export function iirOrder(t: Resp, f1: number, f2: number, df: number, ap: number, as: number): IirOrder {
  const W = (f: number) => Math.tan(Math.PI * f),
    hw = df / 2;
  let k: number;
  if (t === 'lowpass') k = W(f1 - hw) / W(f1 + hw);
  else if (t === 'highpass') k = W(f1 - hw) / W(f1 + hw);
  else {
    /* 通過域の端 p1・p2 を ±1 に写す帯域変換で、阻止域の端がどこへ行くか */
    const bp = t === 'bandpass',
      p1 = W(bp ? f1 + hw : f1 - hw),
      p2 = W(bp ? f2 - hw : f2 + hw),
      s1 = W(bp ? f1 - hw : f1 + hw),
      s2 = W(bp ? f2 + hw : f2 - hw),
      B = p2 - p1,
      o2 = p1 * p2,
      map = (s: number) => (bp ? Math.abs(s * s - o2) / (B * s) : (B * s) / Math.abs(o2 - s * s));
    k = 1 / Math.min(map(s1), map(s2));
  }
  const k1 = Math.sqrt((10 ** (ap / 10) - 1) / (10 ** (as / 10) - 1)),
    kp = Math.sqrt(1 - k * k),
    k1p = Math.sqrt(1 - k1 * k1);
  const ne = (ellipKc(kp) * ellipKc(k1)) / (ellipKc(k) * ellipKc(k1p)),
    nb = Math.log(1 / k1) / Math.log(1 / k),
    up = (x: number) => Math.max(1, Math.ceil(x - 1e-9)) * (twoEdges(t) ? 2 : 1);
  return { ellip: up(ne), butter: up(nb), k, k1 };
}

/** 双2次の段に分けた IIR フィルタの 1 サンプルあたりの乗算（2 次の段は 5 回、1 次の段は 3 回） */
export const iirMults = (n: number): number => 5 * Math.floor(n / 2) + 3 * (n % 2);

/* ---------- 零点 ---------- */
export interface Zeros {
  re: Float64Array;
  im: Float64Array;
}

/**
 * 多項式 c[0] zⁿ + c[1] zⁿ⁻¹ + … + c[n] の根（Aberth–Ehrlich 法）。
 * |z| > 1 では逆順の多項式で求め、桁あふれを避ける
 */
export function roots(c: ArrayLike<number>, maxIter = 400): Zeros {
  let a = 0,
    b = c.length - 1;
  const mx = Math.max(...Array.from(c, Math.abs));
  while (a <= b && Math.abs(c[a]) <= mx * 1e-14) a++;
  while (b >= a && Math.abs(c[b]) <= mx * 1e-14) b--;
  /* 末尾の 0 は z = 0 の根 */
  const z0 = c.length - 1 - b,
    p = Array.from({ length: b - a + 1 }, (_, i) => c[a + i]),
    n = p.length - 1;
  const re = new Float64Array(n + z0),
    im = new Float64Array(n + z0);
  if (n <= 0) return { re, im };
  /* 初期値: 根の大きさの幾何平均の円の上に、少しずらして並べる */
  const R = Math.abs(p[n] / p[0]) ** (1 / n);
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n + 0.4;
    re[k] = R * Math.cos(t);
    im[k] = R * Math.sin(t);
  }
  /** p(z)/p′(z) */
  const ratio = (x: number, y: number): [number, number] => {
    const inside = x * x + y * y <= 1;
    let pr: number, pi: number, dr: number, di: number;
    if (inside) {
      pr = p[0];
      pi = 0;
      dr = 0;
      di = 0;
      for (let i = 1; i <= n; i++) {
        /* p′ ← p′ z + p、p ← p z + c */
        const tr = dr * x - di * y + pr,
          ti = dr * y + di * x + pi;
        dr = tr;
        di = ti;
        const ur = pr * x - pi * y + p[i],
          ui = pr * y + pi * x;
        pr = ur;
        pi = ui;
      }
      const d = dr * dr + di * di;
      return [(pr * dr + pi * di) / d, (pi * dr - pr * di) / d];
    }
    /* w = 1/z、q(w) = Σ c_k w^k。p/p′ = z q / (n q − w q′) */
    const m = x * x + y * y,
      wr = x / m,
      wi = -y / m;
    let qr = p[n],
      qi = 0,
      sr = 0,
      si = 0;
    for (let i = n - 1; i >= 0; i--) {
      const tr = sr * wr - si * wi + qr,
        ti = sr * wi + si * wr + qi;
      sr = tr;
      si = ti;
      const ur = qr * wr - qi * wi + p[i],
        ui = qr * wi + qi * wr;
      qr = ur;
      qi = ui;
    }
    /* 分子 z q、分母 n q − w q′ */
    const nr = x * qr - y * qi,
      ni = x * qi + y * qr,
      er = n * qr - (wr * sr - wi * si),
      ei = n * qi - (wr * si + wi * sr),
      d = er * er + ei * ei;
    return [(nr * er + ni * ei) / d, (ni * er - nr * ei) / d];
  };
  const done = new Uint8Array(n);
  for (let it = 0; it < maxIter; it++) {
    let moving = 0;
    for (let k = 0; k < n; k++) {
      if (done[k]) continue;
      const [rr, ri] = ratio(re[k], im[k]);
      let sr = 0,
        si = 0;
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const dx = re[k] - re[j],
          dy = im[k] - im[j],
          d = dx * dx + dy * dy || 1e-300;
        sr += dx / d;
        si -= dy / d;
      }
      /* w = r / (1 − r S) */
      const er = 1 - (rr * sr - ri * si),
        ei = -(rr * si + ri * sr),
        d = er * er + ei * ei,
        wr = (rr * er + ri * ei) / d,
        wi = (ri * er - rr * ei) / d;
      if (!Number.isFinite(wr) || !Number.isFinite(wi)) continue;
      re[k] -= wr;
      im[k] -= wi;
      const s = Math.hypot(wr, wi);
      if (s <= 1e-15 * Math.max(1, Math.hypot(re[k], im[k]))) done[k] = 1;
      else moving++;
    }
    if (!moving) break;
  }
  return { re, im };
}

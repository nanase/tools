/**
 * 調律（DOM に依存しない）。管を短く鳴らして周波数を測り、フルー管は管の長さを、リード管は舌の固有振動数を直して、
 * 目標の周波数に合わせる。オルガン職人が管の長さ（リード管は調律の針金で舌の振動する長さ）で合わせるのと同じ。
 * 周波数は YIN の差分関数（de Cheveigné・Kawahara 2002）で周期を求め、何周期も離れた遅れでの差分関数の谷を
 * 放物線で補間して精度を上げる
 */
import { FluePipe, type FlueSpec, ReedPipe, type ReedSpec } from './pipes';

/** 1 回の処理の標本の数（AudioWorklet と同じ） */
export const BLOCK = 128;

/**
 * 管を鳴らす。sec 秒ぶんの音圧 [Pa] を返す。offAt [s] で弁を閉じる（省くと閉じない）。wind は風箱の圧力 [Pa]
 */
export function sound(p: FluePipe | ReedPipe, fs: number, sec: number, wind: number, offAt = Infinity): Float64Array {
  const n = Math.round(sec * fs),
    out = new Float64Array(n),
    w = new Float64Array(BLOCK).fill(wind),
    nOff = Math.round(offAt * fs);
  p.on();
  for (let i = 0; i < n; i += BLOCK) {
    if (i >= nOff) p.off();
    p.render(out, i, Math.min(BLOCK, n - i), w);
  }
  return out;
}

/** x[s..s+N) と x[s+L..s+L+N) の差の 2 乗和 */
function diff(x: Float64Array, s: number, N: number, L: number): number {
  let d = 0;
  for (let i = 0; i < N; i++) {
    const e = x[s + i] - x[s + i + L];
    d += e * e;
  }
  return d;
}

/** 3 点 (−1, 0, 1) の値の放物線の頂点の位置（−0.5〜0.5） */
function vertex(a: number, b: number, c: number): number {
  const den = a - 2 * b + c;
  return den > 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
}

/** 周期の推定の結果 */
export interface F0 {
  /** 周波数 [Hz] */
  f: number;
  /** 周期性の弱さ（YIN の正規化した差分の谷の値。0 で完全に周期的） */
  ap: number;
}

/**
 * x の終わりから sec 秒を使って周波数を推定する。fMin〜fMax [Hz] の範囲の周期を探す
 * （YIN の正規化した差分関数で、しきい値を下回る最初の谷を選ぶので、倍音で鳴っていればその周期になる）
 */
export function measureF0(x: Float64Array, fs: number, fMin: number, fMax: number, sec = 0.2): F0 {
  const N = Math.min(x.length, Math.round(sec * fs)),
    s = x.length - N,
    lMin = Math.max(2, Math.floor(fs / fMax)),
    lMax = Math.min(Math.floor(N / 2), Math.ceil(fs / fMin)),
    W = N - lMax;
  if (W < 16 || lMax <= lMin) return { f: NaN, ap: 1 };
  const d = new Float64Array(lMax + 2);
  for (let L = 1; L <= lMax + 1; L++) d[L] = diff(x, s, W, L);
  /* 正規化（累積の平均で割る） */
  const dn = new Float64Array(lMax + 2);
  let cum = 0;
  for (let L = 1; L <= lMax + 1; L++) {
    cum += d[L];
    dn[L] = cum > 0 ? (d[L] * L) / cum : 1;
  }
  let L0 = -1;
  for (let L = lMin; L <= lMax; L++)
    if (dn[L] < 0.2) {
      while (L < lMax && dn[L + 1] < dn[L]) L++;
      L0 = L;
      break;
    }
  if (L0 < 0) {
    let best = Infinity;
    for (let L = lMin; L <= lMax; L++)
      if (dn[L] < best) {
        best = dn[L];
        L0 = L;
      }
  }
  if (L0 <= 1) return { f: NaN, ap: 1 };
  let P = L0 + vertex(dn[L0 - 1], dn[L0], dn[L0 + 1]);
  /*
   * 何周期も離れた遅れで精度を上げる。遅れの周期の数を 2 倍ずつ増やし、前の段の周期から谷の位置を見込んで
   * 近くの谷へ下る（見込みのずれが数標本に収まるので、隣の周期の谷へ移らない）
   */
  const kMax = Math.floor((N * 0.5) / P),
    ks: number[] = [];
  for (let k = 2; k < kMax; k *= 2) ks.push(k);
  if (kMax > 1) ks.push(kMax);
  for (const k of ks) {
    const Wk = N - Math.round(k * P) - 2;
    if (Wk <= 16) break;
    let c = Math.round(k * P),
      dc = diff(x, s, Wk, c);
    for (let it = 0; it < 8; it++) {
      const dl = diff(x, s, Wk, c - 1),
        dr = diff(x, s, Wk, c + 1);
      if (dl < dc && dl <= dr) {
        c--;
        dc = dl;
      } else if (dr < dc) {
        c++;
        dc = dr;
      } else {
        P = (c + vertex(dl, dc, dr)) / k;
        break;
      }
    }
  }
  return { f: fs / P, ap: dn[L0] };
}

/** 2 つの周波数の比 [セント] */
export const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref);

/** 調律の結果 */
export interface Tuned<S> {
  spec: S;
  /** 直す前・直したあとの周波数 [Hz] */
  f0: number;
  f: number;
  /** 測った回数 */
  runs: number;
  /** 目標との差が許容（±tol セント）に入ったか */
  ok: boolean;
}

/** 周波数を測る窓 [s]（30 周期。乱流の雑音による揺れをならす） */
export const measSec = (f: number): number => Math.max(0.15, 30 / f);
/** 測るために鳴らす時間 [s]（低い管は立ち上がりが遅いので長く。終わりの measSec を測る） */
export const tuneSec = (f: number): number => 0.4 + 100 / f + measSec(f);

/** 1 回の測定 */
interface Meas<S> {
  x: number;
  y: number;
  spec: S;
  f: number;
}

/**
 * 1 つの値 v（対数 x = ln v で扱う）を直して、鳴る周波数を目標 fT [Hz] に合わせる。make は値から管を作る関数、
 * slope は ln v に対するセントの傾きの初めの推定（符号が正しければよい）、maxStep は 1 回に動かす ln v の上限。
 * 目標をはさむ 2 点が見つかるまでは傾きで外へ進み、はさんだら Illinois 法で詰める。鳴らない・周期的でない・
 * 目標から 600 セント以上離れた（別のレジームへ跳んだ）点は使わず、手前との中点へ戻す
 */
function tuneBy<S>(
  make: (v: number) => { pipe: FluePipe | ReedPipe; spec: S },
  v0: number,
  slope0: number,
  maxStep: number,
  fT: number,
  fs: number,
  wind: number,
  tol: number,
  maxRuns: number,
  /** ln v の範囲（外へは動かさない） */
  xMin = -Infinity,
  xMax = Infinity,
): Tuned<S> {
  const sec = tuneSec(fT),
    win = measSec(fT);
  let runs = 0;
  const meas = (x: number): Meas<S> | null => {
    runs++;
    const m = make(Math.exp(x)),
      sig = sound(m.pipe, fs, sec, wind);
    let e = 0;
    for (let i = sig.length - 4800; i < sig.length; i++) e += sig[i] * sig[i];
    const r = measureF0(sig, fs, fT / 2, fT * 2, win),
      y = cents(r.f, fT);
    if (!(Math.sqrt(e / 4800) > 1e-3) || !Number.isFinite(y) || r.ap > 0.2 || Math.abs(y) > 600) return null;
    return { x, y, spec: m.spec, f: r.f };
  };
  let cur = meas(Math.log(v0));
  if (!cur) return { spec: make(v0).spec, f0: NaN, f: NaN, runs, ok: false };
  const f0 = cur.f;
  let best = cur,
    slope = slope0,
    lo: Meas<S> | null = null,
    hi: Meas<S> | null = null,
    side = 0;
  const keep = (m: Meas<S>) => {
    if (Math.abs(m.y) < Math.abs(best.y)) best = m;
    if (m.y < 0 && (!lo || m.y > lo.y)) lo = m;
    if (m.y > 0 && (!hi || m.y < hi.y)) hi = m;
  };
  keep(cur);
  while (runs < maxRuns && Math.abs(best.y) > tol / 4) {
    let x: number;
    if (lo && hi) {
      /* Illinois 法（前の回に反対側を置き換えたら、残った側の値を半分にみなす） */
      const a: Meas<S> = lo,
        b: Meas<S> = hi,
        ya = side === 1 ? a.y / 2 : a.y,
        yb = side === -1 ? b.y / 2 : b.y;
      x = a.x - (ya * (b.x - a.x)) / (yb - ya);
    } else {
      const step = Math.max(-maxStep, Math.min(maxStep, -cur.y / slope));
      x = Math.max(xMin, Math.min(xMax, cur.x + step));
      /* 範囲の端に着いて、そこでも届かないなら打ち切る */
      if (x === cur.x) break;
    }
    let m = meas(x);
    /* 使えない点なら、今の点との中点へ戻す（2 回まで） */
    for (let k = 0; !m && k < 2 && runs < maxRuns; k++) {
      x = (x + cur.x) / 2;
      m = meas(x);
    }
    if (!m) break;
    if (m.x !== cur.x && Math.sign(m.y - cur.y) === Math.sign(slope0) && Math.abs(m.y - cur.y) > 0.05)
      slope = (m.y - cur.y) / (m.x - cur.x);
    side = m.y < 0 ? -1 : 1;
    cur = m;
    keep(m);
  }
  return { spec: best.spec, f0, f: best.f, runs, ok: Math.abs(best.y) <= tol };
}

/**
 * フルー管を管の長さで合わせる。初めの傾きは、音響的な長さ（管の長さ + 端補正）が周波数に反比例するとして決める
 */
export function tuneFlue(spec: FlueSpec, fT: number, fs: number, wind: number, tol = 2, maxRuns = 10): Tuned<FlueSpec> {
  const probe = new FluePipe(spec, fs),
    k = spec.l / probe.info.Lac;
  return tuneBy(
    (l) => {
      const s = { ...spec, l };
      return { pipe: new FluePipe(s, fs), spec: s };
    },
    spec.l,
    (-1200 / Math.LN2) * k,
    0.2,
    fT,
    fs,
    wind,
    tol,
    maxRuns,
  );
}

/** 舌の固有振動数を動かす範囲（鳴る音に対する比。外では鳴りが弱まるか、別のレジームへ跳ぶ） */
export const FR_MIN = 0.8,
  FR_MAX = 1.3;

/** 調律の結果（リード管）。res は共鳴管の長さに掛けた倍率（舌だけで合わなかったときに直す） */
export interface TunedReed extends Tuned<ReedSpec> {
  res: number;
}

/**
 * リード管を舌の固有振動数で合わせる。鳴る周波数は共鳴管にも引かれて、舌の固有振動数の変化の一部しか動かないので、
 * 初めの傾きは 0.3 とみる。舌だけで合わないとき（共鳴管に引かれて届かない）は、整音と同じく共鳴管の長さを
 * 残りのずれの分だけ直して（円錐はシャロットの容積も長さに比例させて）、もう一度舌で合わせる（4 回まで）。
 * 舌の固有振動数に対して鳴る周波数は単調でなく、高い管では標本の間隔に引き込まれた段もあるので、
 * 舌だけでは届かない目標がある
 */
export function tuneReed(spec: ReedSpec, fT: number, fs: number, wind: number, tol = 2, maxRuns = 10): TunedReed {
  const byReed = (sp: ReedSpec) =>
    tuneBy(
      (fr) => {
        const s = { ...sp, fr };
        return { pipe: new ReedPipe(s, fs), spec: s };
      },
      sp.fr,
      (1200 / Math.LN2) * 0.3,
      0.08,
      fT,
      fs,
      wind,
      tol,
      maxRuns,
      Math.log(FR_MIN * fT),
      Math.log(FR_MAX * fT),
    );
  let r = byReed(spec),
    res = 1,
    runs = r.runs;
  const f0 = r.f0;
  for (let k = 0; k < 4 && !r.ok && Number.isFinite(r.f); k++) {
    const q = r.f / fT;
    res *= q;
    r = byReed({ ...r.spec, fr: spec.fr, L: spec.L * res, Vs: spec.Vs * res });
    runs += r.runs;
  }
  return { ...r, f0, runs, res };
}

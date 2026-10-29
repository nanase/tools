/**
 * 音源の音を聞き手まで伝える（DOM に依存しない。AudioWorklet と図とテストで共有する）。
 * 音源が出した音を放射時刻の目盛りでためておき、聞き手の各時刻に、放射時刻 τ の音を補間して読む（可変の遅延線。
 * Smith ほか 2002）。読む速さ dτ/dt が聞こえる周波数の比になり、音源が動いても聞き手が動いても同じ式で済む。
 * 音源の位置は制御の刻み（TICK 標本）ごとに記録し、記録の中から |L − S(τ)| = c (t − τ) の解をすべて探す
 * （音源が音速より速いと解は 2 つになる。ドラッグで速く動かしたときも同じ）。
 * 道の端で戻るなどの瞬間移動は記録を区切り、区切りをまたぐ解は探さない。
 * 道（経路）は直接音と地面で反射した音の 2 つ。地面の反射は鏡像の音源（高さ −h）からの音とする
 */
import { AIR0, type Air, AirFilter, airPole } from '../../lib/air';
import { ampFactor } from './kin';

/** 制御の刻み [標本] */
export const TICK = 64;

/** 音源の位置の記録（制御の刻みごと）。区切り（瞬間移動）からの刻みも持つ */
export class Track {
  readonly n: number;
  private x: Float64Array;
  private y: Float64Array;
  /** その刻みが属する区切りの最初の刻み（通し番号） */
  private seg: Float64Array;
  /** 1 刻みで動いた距離 [m] */
  private step: Float64Array;
  /** いちばん新しい刻みの通し番号（まだなければ −1） */
  head = -1;
  /** 記録の中で 1 刻みに動いた距離の最大 [m]（解を探すときに飛ばせる幅を決める） */
  vmax = 0;
  constructor(n: number) {
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.seg = new Float64Array(n);
    this.step = new Float64Array(n);
  }
  /** 刻みを 1 つ進めて位置を記録する。jump なら前の刻みとつながない */
  push(x: number, y: number, jump = false): void {
    const h = ++this.head,
      i = h % this.n;
    let d = 0,
      s = h;
    if (h > 0 && !jump) {
      const j = (h - 1) % this.n;
      d = Math.hypot(x - this.x[j], y - this.y[j]);
      s = this.seg[j];
    }
    this.x[i] = x;
    this.y[i] = y;
    this.seg[i] = s;
    this.step[i] = d;
    if (d > this.vmax) this.vmax = d;
    /* 古い速い動きが記録から抜けたら最大を測り直す */
    if (h % 256 === 0) {
      let m = 0;
      for (let k = 0; k < this.n; k++) if (this.step[k] > m) m = this.step[k];
      this.vmax = m;
    }
  }
  get oldest(): number {
    return Math.max(0, this.head - this.n + 1);
  }
  xAt(k: number): number {
    return this.x[k % this.n];
  }
  yAt(k: number): number {
    return this.y[k % this.n];
  }
  segAt(k: number): number {
    return this.seg[k % this.n];
  }
  /** 刻み k の位置（端数は直線で補間。区切りをまたがない） */
  at(k: number): { x: number; y: number } {
    const k0 = Math.floor(k),
      u = k - k0;
    if (u === 0 || k0 + 1 > this.head) return { x: this.xAt(k0), y: this.yAt(k0) };
    return {
      x: this.xAt(k0) + u * (this.xAt(k0 + 1) - this.xAt(k0)),
      y: this.yAt(k0) + u * (this.yAt(k0 + 1) - this.yAt(k0)),
    };
  }
}

/** 解の 1 つ: 放射した刻み（端数あり）と、そこからの距離 [m]・聞き手の向きのマッハ数 */
export interface Root {
  k: number;
  r: number;
  mr: number;
}

/**
 * 聞き手が刻み now に (lx, ly) で聞く音の放射時刻を、記録の中からすべて探す（新しい順）。
 * g(k) = cT (now − k) − |L − S(k)| の符号が変わる所が解。cT は 1 刻みに音が進む距離 [m]、dz は高さの差 [m]。
 * |g| が大きい所は、g が 1 刻みに cT + vmax より速く変わらないことを使って飛ばす
 */
export function findRoots(tr: Track, now: number, lx: number, ly: number, dz: number, cT: number, out: Root[]): Root[] {
  out.length = 0;
  const lo = tr.oldest,
    dz2 = dz * dz,
    rate = cT + tr.vmax,
    g = (k: number) => cT * (now - k) - Math.sqrt((lx - tr.xAt(k)) ** 2 + (ly - tr.yAt(k)) ** 2 + dz2);
  let k = Math.min(now, tr.head);
  while (k >= lo) {
    const s = Math.max(lo, tr.segAt(k));
    let gk = g(k);
    while (k > s) {
      const skip = Math.floor(Math.abs(gk) / rate);
      if (skip > 1) {
        k = Math.max(s, k - skip + 1);
        gk = g(k);
        continue;
      }
      const g1 = g(k - 1);
      if ((gk < 0 && g1 >= 0) || (gk >= 0 && g1 < 0)) {
        /* 刻み k − 1 と k の間: g を直線で補間する */
        const kr = k - gk / (gk - g1),
          p = tr.at(kr),
          ex = lx - p.x,
          ey = ly - p.y,
          r = Math.sqrt(ex * ex + ey * ey + dz2),
          vx = tr.xAt(k) - tr.xAt(k - 1),
          vy = tr.yAt(k) - tr.yAt(k - 1);
        out.push({ k: kr, r, mr: (ex * vx + ey * vy) / (r * cT) });
      }
      k--;
      gk = g1;
    }
    /* 区切りの最初まで来た: その前の区切りへ */
    k = s - 1;
  }
  return out;
}

/** 道（直接音・地面で反射した音）の 1 つの解を鳴らす声。前の刻みから今の刻みまで、読む位置と大きさを直線で補間する */
interface Voice {
  /** 読む位置 [標本]（放射時刻）の前と今 */
  t0: number;
  t1: number;
  /** 前の刻みで読み進めた幅 [標本] */
  slope: number;
  /** 振幅の倍率の前と今 */
  g0: number;
  g1: number;
  /** 空気の吸収の係数の前と今 */
  p0: number;
  p1: number;
  f: AirFilter;
  /** 今の刻みで解に対応したか */
  hit: boolean;
  /** 情報: 距離 [m]・マッハ数 */
  r: number;
  mr: number;
}

/** 伝え方の設定 */
export interface PropSet {
  /** 音速 [m/s] */
  c: number;
  air: Air;
  /** 空気の吸収を入れるか */
  absorb: boolean;
  /** 地面の反射の係数（0 で反射なし。硬い地面は 1） */
  ground: number;
  /** 音源と聞き手の高さ [m] */
  hs: number;
  hl: number;
  /** 音源の大きさを決める距離 [m]（音源の音はこの距離の音圧で与える） */
  r0: number;
}
export const PROP0: PropSet = { c: 343.2, air: AIR0, absorb: true, ground: 1, hs: 1, hl: 1.5, r0: 1 };

/** 前の刻みの声を続けるとみなす、読む位置のずれの上限 [標本] */
const MATCH = 2 * TICK;

/** 吸収の係数を引く表の距離 [m]（対数で等間隔） */
const POLE_R0 = 1,
  POLE_R1 = 1e4,
  POLE_N = 256;

/** 4 点のエルミート補間 */
function hermite(b: Float32Array, mask: number, t: number): number {
  const i = Math.floor(t),
    u = t - i,
    xm = b[(i - 1) & mask],
    x0 = b[i & mask],
    x1 = b[(i + 1) & mask],
    x2 = b[(i + 2) & mask],
    c1 = 0.5 * (x1 - xm),
    c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2,
    c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * u + c2) * u + c1) * u + x0;
}

/** 伝える計算の本体。刻みごとに advance() を呼ぶ */
export class Propagator {
  readonly fs: number;
  readonly track: Track;
  set: PropSet;
  /** 音源の音（放射時刻の目盛り）。長さは 2 のべき */
  private sig: Float32Array;
  private mask: number;
  /** 書いた標本の数 */
  private written = 0;
  private paths: Voice[][] = [[], []];
  private roots: Root[] = [];
  private poles = new Float64Array(POLE_N);
  /** いちばん大きく聞こえる解（直接音）。図の表示用 */
  main: Root | null = null;
  /** 直接音の解の数 */
  count = 0;

  /** 記録する時間 [s]（これより前に出た音は届かない） */
  constructor(fs: number, seconds = 4, set: PropSet = PROP0) {
    this.fs = fs;
    const n = Math.ceil((seconds * fs) / TICK) + 2;
    this.track = new Track(n);
    let len = 1;
    while (len < (n + 2) * TICK) len *= 2;
    this.sig = new Float32Array(len);
    this.mask = len - 1;
    this.set = set;
    this.setAir(set);
  }

  /** 設定を変える（気温・湿度が変わったら吸収の表を作り直す） */
  setAir(s: PropSet): void {
    this.set = s;
    for (let i = 0; i < POLE_N; i++) {
      const r = POLE_R0 * (POLE_R1 / POLE_R0) ** (i / (POLE_N - 1));
      this.poles[i] = airPole(r, this.fs, s.air);
    }
  }

  private pole(r: number): number {
    if (!this.set.absorb) return 0;
    const u =
        ((POLE_N - 1) * Math.log(Math.max(POLE_R0, Math.min(POLE_R1, r)) / POLE_R0)) / Math.log(POLE_R1 / POLE_R0),
      i = Math.min(POLE_N - 2, Math.floor(u)),
      w = u - i;
    return this.poles[i] + w * (this.poles[i + 1] - this.poles[i]);
  }

  /**
   * 刻みを 1 つ進める。src は次の TICK 標本の音源の音（r0 での音圧）、(sx, sy) は今の刻みの音源の位置、jump は瞬間移動、
   * (lx, ly) は今の刻みの聞き手の位置。out へ、1 刻み前から今の刻みまでの聞き手の音圧を TICK 標本書く
   */
  advance(src: Float32Array, sx: number, sy: number, jump: boolean, lx: number, ly: number, out: Float32Array): void {
    const tr = this.track,
      s = this.set,
      cT = (s.c * TICK) / this.fs,
      sig = this.sig,
      mask = this.mask;
    tr.push(sx, sy, jump);
    for (let j = 0; j < TICK; j++) sig[(this.written + j) & mask] = src[j];
    this.written += TICK;
    out.fill(0);
    const now = tr.head;
    for (let pi = 0; pi < 2; pi++) {
      const refl = pi === 1;
      if (refl && s.ground === 0) {
        this.paths[1].length = 0;
        continue;
      }
      const dz = refl ? s.hs + s.hl : s.hl - s.hs,
        roots = findRoots(tr, now, lx, ly, dz, cT, this.roots),
        vs = this.paths[pi];
      if (!refl) {
        this.count = roots.length;
        this.main = null;
        let best = 0;
        for (const r of roots) {
          const a = Math.abs(ampFactor(r.r, r.mr));
          if (a > best) {
            best = a;
            this.main = { ...r };
          }
        }
      }
      for (const v of vs) {
        v.hit = false;
        v.slope = v.t1 - v.t0;
        v.t0 = v.t1;
        v.g0 = v.g1;
        v.p0 = v.p1;
      }
      for (const r of roots) {
        const t = r.k * TICK,
          gain = (refl ? s.ground : 1) * ampFactor(r.r, r.mr, s.r0),
          p = this.pole(r.r);
        /* 前の刻みの声のうち、同じ速さで読み進めた位置がいちばん近いものを続ける */
        let best: Voice | null = null,
          bd = MATCH;
        for (const v of vs) {
          if (v.hit) continue;
          const d = Math.abs(v.t0 + v.slope - t);
          if (d < bd) {
            best = v;
            bd = d;
          }
        }
        if (best) {
          best.t1 = t;
          best.g1 = gain;
          best.p1 = p;
          best.hit = true;
          best.r = r.r;
          best.mr = r.mr;
        } else {
          /* 新しい解（マッハ円錐が来たとき・記録の始め）: 大きさ 0 から上げる */
          const f = new AirFilter();
          vs.push({ t0: t, t1: t, slope: 0, g0: 0, g1: gain, p0: p, p1: p, f, hit: true, r: r.r, mr: r.mr });
        }
      }
      /* 解がなくなった声は、同じ速さで読み進めながら大きさを 0 へ下げ、次の刻みで消す */
      for (let i = vs.length - 1; i >= 0; i--) {
        const v = vs[i];
        if (v.hit) continue;
        if (v.g0 === 0) {
          vs.splice(i, 1);
          continue;
        }
        v.t1 = v.t0 + v.slope;
        v.g1 = 0;
        v.p1 = v.p0;
      }
      /* 1 刻み前から今の刻みまでを書く。読む位置は書いた範囲（written − TICK − 2 まで）に収める */
      const top = this.written - 3;
      for (const v of vs) {
        const dt = (v.t1 - v.t0) / TICK,
          dg = (v.g1 - v.g0) / TICK,
          dp = (v.p1 - v.p0) / TICK;
        for (let j = 0; j < TICK; j++) {
          const t = Math.min(top, v.t0 + dt * j);
          v.f.p = v.p0 + dp * j;
          out[j] += (v.g0 + dg * j) * v.f.step(hermite(sig, mask, t));
        }
      }
    }
  }
}

/**
 * マクスウェルの悪魔の計算。箱は幅 2・高さ 1 で、仕切りは x = 1、扉は仕切りの中央にある。
 * 分子は平面の剛体円板で、質量 m = 1。kT = 1 を 300 K とし、速さ 1 は √(kT/m)（窒素・300 K で 298 m/s）にあたる。
 * 分子どうしと壁の衝突は弾性で、全体の運動エネルギーは変わらない
 */

/** kT = 1 にあたる温度 [K] */
export const K0 = 300;
/** 速さ 1 にあたる速さ [m/s]（窒素の分子の質量で √(kT/m)） */
export const MS = 298.4;
export const LN2 = Math.LN2;

export type Mode = 'temp' | 'press' | 'none' | 'hand';

/** xorshift の乱数（0 以上 1 未満） */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
/** ln n! */
export function lnFact(n: number): number {
  let s = 0;
  for (let k = 2; k <= n; k++) s += Math.log(k);
  return s;
}
/** 平面のマクスウェル分布（速さ v の確率密度、kT/m = T） */
export const mb2 = (v: number, T: number): number => (v / T) * Math.exp((-v * v) / (2 * T));

export interface Stats {
  /** 左右の分子の数 */
  N: [number, number];
  /** 左右の温度（kT の単位、分子がいなければ 0） */
  T: [number, number];
}
export interface Sample {
  t: number;
  T: [number, number];
  N: [number, number];
}
/** 悪魔の今の判断 */
export interface Judge {
  i: number;
  /** 分子が来た側（0 左、1 右） */
  s: 0 | 1;
  ok: boolean;
  t: number;
}

export class Gas {
  n = 0;
  r = 0.012;
  mode: Mode = 'temp';
  /** 速さのしきい値（速さ 1 の単位） */
  vth = 1.1774;
  /** 扉の幅（仕切りの高さとの比） */
  gap = 0.22;
  /** 手で操作するときの扉の開閉 */
  hand = false;
  /** 記憶の容量 [ビット]。満杯になると消す */
  cap = 256;
  x = new Float64Array(0);
  y = new Float64Array(0);
  vx = new Float64Array(0);
  vy = new Float64Array(0);
  side = new Uint8Array(0);
  /** 扉を通り抜けている途中 */
  pass = new Uint8Array(0);
  t = 0;
  /** 悪魔の判断の回数 */
  meas = 0;
  /** 記憶にあるビット（古い順） */
  tape: number[] = [];
  /** これまでに消したビット数 */
  erased = 0;
  /** 最後に消した時刻 */
  erasedAt = -9;
  /** 最後に扉を開けた時刻 */
  doorAt = -9;
  last: Judge | null = null;
  samples: Sample[] = [];
  private nextSample = 0;
  private head = new Int32Array(0);
  private next = new Int32Array(0);

  /** 壁の揺らぎの乱数 */
  private rand = rng(99);
  /*
   * 悪魔が知っている左の分子の数。扉を閉じた時点の左の数 k は知らず、扉を通った差し引き kD と、
   * 観測から絞った k の範囲 [kLo, kHi] だけを知っている。扉が開くと忘れる
   */
  private kD = 0;
  private kLo = 0;
  private kHi = 0;
  /** 扉が開いていたので、閉じたら知識を初めからにする */
  private kStale = false;
  /** 扉を閉じた時点の温度の項 */
  private th0 = 0;
  /** ln n! の表 */
  private lf = new Float64Array(1);

  constructor(n = 200, seed = 7) {
    this.reset(n, seed);
  }

  /** 左右に同じ数ずつ置き、左右とも 300 K にそろえる。悪魔はまだ何も知らず、記憶は空 */
  reset(n = this.n, seed = 7): void {
    const R = rng(seed),
      r = this.r;
    this.rand = rng(seed * 31 + 5);
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    const { x, y, vx, vy } = this;
    this.side = new Uint8Array(n);
    this.pass = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const s = i % 2;
      for (let k = 0; k < 200; k++) {
        const px = s + 2 * r + (1 - 4 * r) * R(),
          py = r + (1 - 2 * r) * R();
        let ok = true;
        for (let j = 0; j < i && ok; j++) if ((x[j] - px) ** 2 + (y[j] - py) ** 2 < 9 * r * r) ok = false;
        if (ok || k === 199) {
          x[i] = px;
          y[i] = py;
          break;
        }
      }
      this.side[i] = s;
      vx[i] = gauss(R);
      vy[i] = gauss(R);
    }
    for (const s of [0, 1]) {
      let e = 0,
        c = 0;
      for (let i = 0; i < n; i++)
        if (this.side[i] === s) {
          e += 0.5 * (vx[i] ** 2 + vy[i] ** 2);
          c++;
        }
      const f = e > 0 ? Math.sqrt(c / e) : 1;
      for (let i = 0; i < n; i++)
        if (this.side[i] === s) {
          vx[i] *= f;
          vy[i] *= f;
        }
    }
    this.t = 0;
    this.meas = 0;
    this.erased = 0;
    this.erasedAt = -9;
    this.doorAt = -9;
    this.last = null;
    this.samples = [];
    this.nextSample = 0;
    this.tape = [];
    this.lf = new Float64Array(n + 1);
    for (let k = 2; k <= n; k++) this.lf[k] = this.lf[k - 1] + Math.log(k);
    this.forget();
    this.sample();
  }

  speed(i: number): number {
    return Math.hypot(this.vx[i], this.vy[i]);
  }
  stats(): Stats {
    const N: [number, number] = [0, 0],
      E = [0, 0];
    for (let i = 0; i < this.n; i++) {
      const s = this.side[i];
      N[s]++;
      E[s] += 0.5 * (this.vx[i] ** 2 + this.vy[i] ** 2);
    }
    return { N, T: [N[0] ? E[0] / N[0] : 0, N[1] ? E[1] / N[1] : 0] };
  }
  /** 扉が開いたままか（悪魔なし・手で開けている間） */
  doorOpen(): boolean {
    return this.mode === 'none' || (this.mode === 'hand' && this.hand);
  }
  /** 悪魔の知識を初めからにする（左右の数を知らない）。温度の項もこの時点を基準にする */
  private forget(): void {
    this.kD = 0;
    this.kLo = 0;
    this.kHi = this.n;
    this.kStale = false;
    this.th0 = this.thermal();
  }
  /** 温度の項 Σ N ln(T/T̄) [k]。全エネルギーが同じなら、左右の温度がそろったとき最大の 0 */
  private thermal(): number {
    if (!this.n) return 0;
    const { N, T } = this.stats(),
      Tm = (N[0] * T[0] + N[1] * T[1]) / this.n;
    let s = 0;
    for (const k of [0, 1]) if (N[k] && T[k] > 0) s += N[k] * Math.log(T[k] / Tm);
    return s;
  }
  /** 扉が開いている間は知識を捨てる印を付け、閉じたら初めからにする */
  private syncKnow(): void {
    if (this.doorOpen()) this.kStale = true;
    else if (this.kStale) this.forget();
  }
  private lnC(k: number): number {
    return this.lf[this.n] - this.lf[k] - this.lf[this.n - k];
  }
  /**
   * 左右の数の項 [k]。悪魔が知っていることから数える（基準は左右の数を知らない状態で 0）。
   * 閉じた時点の左の数 k は二項分布 C(N, k)/2^N で、観測から絞った範囲に限る。今の左の数は k + kD。
   * S = H(k) + E[ln C(N, k + kD)] − N ln 2
   */
  private placeEntropy(): number {
    const n = this.n,
      D = this.kD,
      lo = Math.max(this.kLo, -D),
      hi = Math.min(this.kHi, n - D);
    if (lo > hi) return 0;
    let m = -Infinity;
    for (let k = lo; k <= hi; k++) m = Math.max(m, this.lnC(k));
    let z = 0;
    for (let k = lo; k <= hi; k++) z += Math.exp(this.lnC(k) - m);
    const lz = Math.log(z);
    let s = 0;
    for (let k = lo; k <= hi; k++) {
      const lp = this.lnC(k) - m - lz;
      s += Math.exp(lp) * (this.lnC(k + D) - lp);
    }
    return s - n * LN2;
  }
  /**
   * 気体のエントロピー [k]。基準は扉を閉じた時点（初めの状態も 0）で、悪魔はそのときの左右の数を知らない。
   * 扉が閉じている間は、温度の項の閉じた時点からの変化と、左右の数の項の和。
   * 扉が開いている間は、悪魔は何も知らず、気体は平衡に向かうので 0 と数える
   */
  entropy(): number {
    this.syncKnow();
    if (!this.n || this.doorOpen()) return 0;
    return this.thermal() - this.th0 + this.placeEntropy();
  }
  /** 記憶のエントロピー [k]（1 ビット = k ln 2 と数える） */
  memory(): number {
    return this.tape.length * LN2;
  }
  /** 消去で周りへ出した熱を温度で割った値 [k]（1 ビットあたり ln 2 の最小値） */
  heat(): number {
    return this.erased * LN2;
  }
  /** 記憶を全部消す。消したビット数を返す */
  erase(): number {
    const b = this.tape.length;
    this.erased += b;
    this.tape = [];
    if (b) this.erasedAt = this.t;
    return b;
  }
  /** 記憶に 1 ビット書く。満杯なら、先に記録を全部消す（容量 1 ビットなら毎回消す） */
  private write(bit: number): void {
    if (this.tape.length >= this.cap) this.erase();
    this.tape.push(bit);
  }
  /** 手で扉を開け閉めする。開けるのも閉じるのも 1 回の判断として記憶に書く */
  setHand(open: boolean): void {
    if (this.hand === open) return;
    this.hand = open;
    if (this.mode !== 'hand') return;
    this.meas++;
    this.write(open ? 1 : 0);
    if (open) this.doorAt = this.t;
  }
  private decide(i: number, s: 0 | 1): boolean {
    const m = this.mode;
    if (m === 'none') return true;
    if (m === 'hand') return this.hand;
    const ok = m === 'press' ? s === 0 : s === 0 ? this.speed(i) > this.vth : this.speed(i) < this.vth;
    /* 来た側に 1 個以上いることがわかる */
    this.syncKnow();
    if (s === 0) this.kLo = Math.max(this.kLo, 1 - this.kD);
    else this.kHi = Math.min(this.kHi, this.n - 1 - this.kD);
    this.meas++;
    this.write(ok ? 1 : 0);
    this.last = { i, s, ok, t: this.t };
    return ok;
  }
  /** 扉が開いて見えるか */
  open(): boolean {
    return this.mode === 'none' || (this.mode === 'hand' && this.hand) || this.t - this.doorAt < 0.14;
  }
  sample(): void {
    const { N, T } = this.stats();
    this.samples.push({ t: this.t, T, N });
    if (this.samples.length > 900) this.samples.splice(0, this.samples.length - 900);
  }
  step(dt: number): void {
    this.syncKnow();
    const { n, r, x, y, vx, vy, side, pass } = this,
      half = this.gap / 2;
    for (let i = 0; i < n; i++) {
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      if (x[i] < r) {
        x[i] = r;
        vx[i] = Math.abs(vx[i]);
        this.jitter(i);
      } else if (x[i] > 2 - r) {
        x[i] = 2 - r;
        vx[i] = -Math.abs(vx[i]);
        this.jitter(i);
      }
      if (y[i] < r) {
        y[i] = r;
        vy[i] = Math.abs(vy[i]);
        this.jitter(i);
      } else if (y[i] > 1 - r) {
        y[i] = 1 - r;
        vy[i] = -Math.abs(vy[i]);
        this.jitter(i);
      }
      const s = side[i] as 0 | 1;
      if (pass[i]) {
        if ((s === 0 && x[i] > 1) || (s === 1 && x[i] < 1)) {
          side[i] = s === 0 ? 1 : 0;
          pass[i] = 0;
          /* 悪魔が通した分子は、左の数の差し引きに数える */
          if (!this.doorOpen()) this.kD += s === 0 ? -1 : 1;
        } else if ((s === 0 && x[i] < 1 - r) || (s === 1 && x[i] > 1 + r)) pass[i] = 0;
        continue;
      }
      const hit = s === 0 ? x[i] > 1 - r && vx[i] > 0 : x[i] < 1 + r && vx[i] < 0;
      if (!hit) continue;
      if (Math.abs(y[i] - 0.5) < half - r * 0.5 && this.decide(i, s)) {
        pass[i] = 1;
        if (this.mode !== 'none') this.doorAt = this.t;
        continue;
      }
      vx[i] = -vx[i];
      x[i] = s === 0 ? 1 - r : 1 + r;
    }
    this.collide();
    this.t += dt;
    if (this.t >= this.nextSample) {
      this.sample();
      this.nextSample = this.t + 0.1;
    }
  }
  /**
   * 外壁で跳ね返った向きを少しだけ回す（速さは変えない）。壁の凹凸の代わりで、分子が少ないときに
   * 同じ軌道を回り続けて扉に来なくなるのを防ぐ。壁の外へ向かうほど回すときは回さない
   */
  private jitter(i: number): void {
    const a = (this.rand() - 0.5) * 0.4,
      c = Math.cos(a),
      s = Math.sin(a),
      vx = this.vx[i] * c - this.vy[i] * s,
      vy = this.vx[i] * s + this.vy[i] * c,
      r = this.r;
    const outX = (this.x[i] <= r && vx < 0) || (this.x[i] >= 2 - r && vx > 0),
      outY = (this.y[i] <= r && vy < 0) || (this.y[i] >= 1 - r && vy > 0);
    if (outX || outY) return;
    this.vx[i] = vx;
    this.vy[i] = vy;
  }
  /** 分子どうしの弾性衝突。格子で近い組だけを見る。仕切りをはさんだ組はぶつからない */
  private collide(): void {
    const { n, r, x, y, vx, vy, side, pass } = this,
      c = 0.05,
      gw = 40,
      gh = 20;
    if (this.head.length !== gw * gh) this.head = new Int32Array(gw * gh);
    if (this.next.length < n) this.next = new Int32Array(n);
    const head = this.head,
      next = this.next;
    head.fill(-1);
    const cell = (v: number, m: number) => Math.min(m - 1, Math.max(0, (v / c) | 0));
    for (let i = 0; i < n; i++) {
      const k = cell(x[i], gw) + cell(y[i], gh) * gw;
      next[i] = head[k];
      head[k] = i;
    }
    const d2 = 4 * r * r;
    for (let i = 0; i < n; i++) {
      const cx = cell(x[i], gw),
        cy = cell(y[i], gh);
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const qx = cx + ox,
            qy = cy + oy;
          if (qx < 0 || qy < 0 || qx >= gw || qy >= gh) continue;
          for (let j = head[qx + qy * gw]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            const dx = x[j] - x[i],
              dy = y[j] - y[i],
              q = dx * dx + dy * dy;
            if (q >= d2 || q === 0) continue;
            if (side[i] !== side[j] && !pass[i] && !pass[j]) continue;
            const dot = (vx[j] - vx[i]) * dx + (vy[j] - vy[i]) * dy;
            if (dot >= 0) continue;
            const p = dot / q;
            vx[i] += p * dx;
            vy[i] += p * dy;
            vx[j] -= p * dx;
            vy[j] -= p * dy;
          }
        }
    }
  }
  /** sec 秒ぶん進める（1/600 秒刻み） */
  run(sec: number): void {
    const h = 1 / 600;
    let k = Math.round(sec / h);
    while (k-- > 0) this.step(h);
  }
  /** 左右の部屋ごとの速さのヒストグラム */
  hist(bins = 32, vmax = 4): [Float64Array, Float64Array] {
    const h: [Float64Array, Float64Array] = [new Float64Array(bins), new Float64Array(bins)];
    for (let i = 0; i < this.n; i++) h[this.side[i]][Math.min(bins - 1, ((this.speed(i) / vmax) * bins) | 0)]++;
    return h;
  }
}

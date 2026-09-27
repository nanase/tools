/**
 * 復号（DOM に依存しない）: 包絡線（1 ms ごと）→ しきい値 → パルス → 分の同期 → 1 分ぶんの符号 → 値とフラグ。
 * 符号の割り当ては JJY シミュレータ（../jjy/code.ts）と共有する
 */
import { type Code, FIELDS, type Field, MARKERS, PA1, PA2 } from '../jjy/code';
import { p2 } from '../jjy/time';

/** 読んだ 1 秒の符号。?: 読めない */
export type Sym = Code | '?';

/** 立ち上がりを受け付けるずれ（ms）と、枠を合わせ直す割合 */
export const SLACK = 60,
  PLL = 0.1;
/** パルス幅 τ（ms）から符号を決める。区切りは規定の 0.2・0.5・0.8 秒の中間 */
export const classify = (w: number): Sym => (w < 100 ? '?' : w < 350 ? 'P' : w < 650 ? '1' : w < 950 ? '0' : '?');

const JST = 9 * 3600e3,
  DAY = 864e5;

export interface Pulse {
  /** 立ち上がりと立ち下がりの位置（ms。立ち下がりの前は null） */
  r: number;
  f: number | null;
}

/** 読み終えた分の信号の品質 */
export interface Quality {
  /** 読めた秒と、見た秒 */
  ok: number;
  n: number;
  /** 立ち上がりのずれの RMS（ms） */
  jit: number;
  /** 高出力・低出力の振幅 */
  hi: number;
  lo: number;
  /** 直近 1 秒の平均電力（dBFS） */
  lvl: number;
}

/** 1 分の枠。c・w・S・np は秒ごと（未受信は null・NaN・0） */
export interface Frame {
  /** 0 秒の位置（ms） */
  t0: number;
  c: (Sym | null)[];
  /** パルス幅（ms） */
  w: number[];
  /** その秒の枠の始まり（ms） */
  S: number[];
  /** 枠の中の立ち上がりの数 */
  np: number[];
  /** 読み終えた分の値（読んでいる途中は null） */
  res: Res | null;
  done: boolean;
  q?: Quality;
}

/** 値: undefined は未受信、NaN は読めない */
export type Val = number | undefined;

/** 1 分ぶんの符号から読んだ値とフラグ */
export interface Res {
  m: Val;
  h: Val;
  /** 年の通算日 */
  d: Val;
  /** パリティが合うか（ビットがそろっていなければ null） */
  pa1: boolean | null;
  pa2: boolean | null;
  su1: Val;
  /** コールサインの分か（40〜48 秒を 1 つも受け取っていなければ null） */
  cs: boolean | null;
  /** 受け取ったマーカの位置の数と、そのうちマーカだった数 */
  mkN: number;
  mkOk: number;
  su2?: Val;
  /** 年の下 2 桁と曜日（コールサインでない分） */
  y?: Val;
  w?: Val;
  /** 停波が始まるまで（ST1〜3、コールサインの分） */
  stA?: Val;
  /** 停波の予告の分か */
  st: boolean | null;
  st4?: Val;
  /** 停波の期間（ST5・ST6） */
  st56?: Val;
  ls1?: Val;
  ls2?: Val;
  /** 西暦（2000 年代）。コールサインの分は前の分から引き継ぐ */
  Y: number;
  yCarry?: boolean;
  /** 年と通算日から求めた月・日・曜日 */
  mo?: number;
  day?: number;
  wdC?: number;
  /** 曜日が年と通算日から求めたものと合うか */
  wdOk: boolean | null;
  /** その分の時刻（0 時からの ms）と、その分の始まり（UTC の ms） */
  tod: number;
  epoch: number;
  /** 検査（パリティ・範囲・マーカ・曜日）をすべて通ったか */
  ok: boolean;
}

/** 0 以上の読めた値か */
export const nn = (x: Val): x is number => x !== undefined && x >= 0;
const pos = (x: Val): x is number => x !== undefined && x > 0;
const odd = (c: readonly (Sym | null)[], ss: readonly number[]) => ss.filter((s) => c[s] === '1').length % 2 === 1;

/** 1 分ぶんの符号から値とフラグを読む。prev は年を引き継ぐ前の分 */
export function evalFrame(c: readonly (Sym | null)[], prev: Res | null): Res {
  const B = (s: number): Val => (c[s] == null ? undefined : c[s] === '1' ? 1 : c[s] === '0' ? 0 : Number.NaN);
  /* BCD の各桁が 9 以下で、範囲に収まる値 */
  const get = (f: Field, max: number, min = 0): Val => {
    let v = 0,
      un = false;
    const g: Record<number, number> = {};
    for (const [w, s] of f) {
      const b = B(s);
      if (b === undefined) un = true;
      else if (Number.isNaN(b)) return Number.NaN;
      else {
        v += w * b;
        const p = 10 ** Math.floor(Math.log10(w));
        g[p] = (g[p] || 0) + (b * w) / p;
      }
    }
    if (un) return undefined;
    return v >= min && v <= max && Object.values(g).every((x) => x <= 9) ? v : Number.NaN;
  };
  const par = (L: readonly number[], s: number): boolean | null =>
    L.every((i) => nn(B(i))) && nn(B(s)) ? odd(c, L) === (c[s] === '1') : null;
  let n = 0,
    u = 0;
  for (let s = 40; s <= 48; s++)
    if (c[s] != null) {
      n++;
      if (c[s] === 'S' || c[s] === '?') u++;
    }
  const cs = n ? u * 2 > n : null;
  const r: Res = {
    m: get(FIELDS.m, 59),
    h: get(FIELDS.h, 23),
    d: get(FIELDS.d, 366, 1),
    pa1: par(PA1, 36),
    pa2: par(PA2, 37),
    su1: B(38),
    cs,
    mkN: 0,
    mkOk: 0,
    st: null,
    Y: Number.NaN,
    wdOk: null,
    tod: Number.NaN,
    epoch: Number.NaN,
    ok: false,
  };
  for (const s of MARKERS)
    if (c[s] != null) {
      r.mkN++;
      if (c[s] === 'P') r.mkOk++;
    }
  if (cs === false) {
    r.su2 = B(40);
    r.y = get(FIELDS.y, 99);
    r.w = get(FIELDS.w, 6);
  } else if (cs) r.stA = get(FIELDS.w, 7);
  r.st = cs ? (nn(r.stA) ? r.stA > 0 : null) : cs === false ? false : null;
  if (r.st) {
    r.st4 = B(53);
    const a = B(54),
      b = B(55);
    r.st56 = nn(a) && nn(b) ? a * 2 + b : a === undefined || b === undefined ? undefined : Number.NaN;
  } else if (r.st === false) {
    r.ls1 = B(53);
    r.ls2 = B(54);
  }
  /* 年は下 2 桁を 2000 年代とする。送られない分は前の分から引き継ぐ（通算日が戻れば翌年） */
  if (nn(r.y)) r.Y = 2000 + r.y;
  else if (prev && prev.Y > 0 && pos(r.d)) {
    r.Y = prev.Y + (pos(prev.d) && r.d < prev.d ? 1 : 0);
    r.yCarry = true;
  }
  if (r.Y > 0 && pos(r.d)) {
    const leap = (r.Y % 4 === 0 && r.Y % 100 !== 0) || r.Y % 400 === 0;
    if (r.d > (leap ? 366 : 365)) r.d = Number.NaN;
    else {
      const t = new Date(Date.UTC(r.Y, 0, r.d));
      r.mo = t.getUTCMonth() + 1;
      r.day = t.getUTCDate();
      r.wdC = t.getUTCDay();
    }
  }
  r.wdOk = nn(r.w) && r.wdC !== undefined ? r.w === r.wdC : null;
  if (nn(r.h) && nn(r.m)) {
    r.tod = (r.h * 60 + r.m) * 60000;
    if (r.Y > 0 && pos(r.d)) r.epoch = Date.UTC(r.Y, 0, r.d, r.h, r.m) - JST;
  }
  r.ok =
    nn(r.m) &&
    nn(r.h) &&
    pos(r.d) &&
    r.pa1 === true &&
    r.pa2 === true &&
    r.mkN === 7 &&
    r.mkOk === 7 &&
    r.wdOk !== false &&
    (r.cs === true || nn(r.y));
  return r;
}

/** 包絡線から 1 分ずつ符号を読む。push で 1 ms ずつ流し込む */
export class Decoder {
  /** 包絡線と電力の輪バッファ（2^bits 点） */
  readonly M: number;
  readonly E: Float32Array;
  readonly W: Float32Array;
  /** 受け取った点の数 */
  n = 0;
  /** 高出力・低出力の振幅、しきい値とヒステリシスの幅 */
  hi = 0;
  lo = 0;
  th = 0;
  hy = 0;
  /** 高・低を分けられる信号があるか */
  sig = false;
  pulses: Pulse[] = [];
  state: 'SEARCH' | 'LOCK' = 'SEARCH';
  /** 1 秒おきの立ち上がりが続いた回数 */
  reg = 0;
  /** 同期中: 0 秒の位置（ms）、次に読む秒、読んでいる分 */
  t0 = 0;
  s = 0;
  fr: Frame | null = null;
  /** 読み終えた分 */
  frames: Frame[] = [];
  /** frames を 60 分で捨てずに全部残すか（ファイル） */
  keepAll = false;
  /** 状態が変わるたびに増える（画面の描き直しの判定） */
  ver = 0;
  onFrame: ((f: Frame) => void) | null = null;
  private hiSt = 0;
  private pa = 0;
  private up = -1;
  private dn = -1;
  private prev: { r: number; c: Sym } | null = null;
  private miss = 0;
  private log: { ok: boolean; e: number }[] = [];

  constructor(bits: number) {
    const n = 1 << bits;
    this.M = n - 1;
    this.E = new Float32Array(n);
    this.W = new Float32Array(n);
  }

  /** 振幅 a と電力 p を 1 点（1 ms）流し込む */
  push(a: number, p: number): void {
    const k = this.n++;
    this.E[k & this.M] = a;
    this.W[k & this.M] = p;
    if (k % 100 === 99) this.level(k);
    if (this.th > 0 && this.sig) this.edge(k, a);
    else this.pa = a;
    while (this.state === 'LOCK' && k >= this.t0 + 1000 * (this.s + 1) - SLACK) this.slot();
  }

  /** 直近 3 秒の上位 10 % と下位 10 % の点から、高出力・低出力・しきい値を決める */
  private level(k: number): void {
    const n = Math.min(3000, k + 1);
    if (n < 500) return;
    const s = new Float32Array(Math.ceil(n / 5));
    let j = 0;
    for (let i = k - n + 1; i <= k; i += 5) s[j++] = this.E[i & this.M];
    s.subarray(0, j).sort();
    const lo = s[Math.floor(j * 0.1)],
      hi = s[Math.floor(j * 0.9)];
    this.lo = lo;
    this.hi = hi;
    this.th = (hi + lo) / 2;
    this.hy = 0.1 * (hi - lo);
    this.sig = hi > 3e-4 && hi > 2 * lo;
  }

  /** ヒステリシス付きで高・低を分け、しきい値を横切った時刻（補間）をパルスの端にする */
  private edge(k: number, a: number): void {
    const { th, hy, pa } = this;
    this.pa = a;
    if (pa < th && a >= th) this.up = k - 1 + (th - pa) / (a - pa);
    else if (pa >= th && a < th) this.dn = k - 1 + (pa - th) / (pa - a);
    if (!this.hiSt && a > th + hy) {
      this.hiSt = 1;
      const r = this.up > k - 200 ? this.up : k,
        L = this.pulses.at(-1);
      /* 20 ms 未満の低い区間はつなぐ */
      if (L && L.f != null && r - L.f < 20) L.f = null;
      else this.pulses.push({ r, f: null });
      if (this.pulses.length > 300) this.pulses.splice(0, 100);
    } else if (this.hiSt && a < th - hy) {
      this.hiSt = 0;
      const L = this.pulses.at(-1);
      if (!L) return;
      L.f = this.dn > k - 200 ? this.dn : k;
      /* 20 ms 未満の高い区間は雑音 */
      if (L.f - L.r < 20) {
        this.pulses.pop();
        return;
      }
      if (this.state !== 'LOCK') this.search(L);
    }
  }

  /** 同期前: 1 秒おきの立ち上がりでマーカが 2 回続いたら、2 回目を 0 秒にする */
  private search(p: Pulse): void {
    const c = classify((p.f ?? p.r) - p.r),
      q = this.prev;
    this.prev = { r: p.r, c };
    if (q && Math.abs(p.r - q.r - 1000) <= SLACK) {
      this.reg++;
      if (c === 'P' && q.c === 'P') {
        this.state = 'LOCK';
        this.t0 = p.r;
        this.s = 0;
        this.miss = 0;
        this.fr = newFrame(p.r);
        this.ver++;
      }
    } else this.reg = 0;
  }

  /** 同期中: 1 秒の枠を読み終えたら符号を決める */
  private slot(): void {
    const s = this.s,
      S = this.t0 + 1000 * s,
      lo = S - SLACK,
      hi = S + 1000 - SLACK,
      L: Pulse[] = [];
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      if (p.r < lo) break;
      if (p.r < hi) L.push(p);
    }
    let c: Sym = '?',
      w = Number.NaN,
      e = Number.NaN;
    const p = L[0];
    if (L.length === 1 && p.f != null && p.f < hi && Math.abs(p.r - S) <= SLACK) {
      w = p.f - p.r;
      c = classify(w);
      if (c !== '?') {
        e = p.r - S;
        this.t0 += PLL * e;
      }
    }
    const ss = s % 60;
    this.log.push({ ok: c !== '?' || (ss >= 40 && ss <= 48 && L.length > 1), e });
    if (this.log.length > 60) this.log.shift();
    const f = this.fr as Frame;
    if (s === 60) {
      const ok = c === 'P' && f.c[59] === 'P';
      this.finish(f);
      if (!ok) {
        this.lost();
        return;
      }
      this.t0 += 60000;
      const g = newFrame(this.t0);
      g.c[0] = c;
      g.w[0] = w;
      g.S[0] = S;
      g.np[0] = L.length;
      this.fr = g;
      this.s = 1;
      this.miss = 0;
      this.ver++;
      return;
    }
    f.c[s] = c;
    f.w[s] = w;
    f.S[s] = S;
    f.np[s] = L.length;
    this.s++;
    this.ver++;
    if ((s === 9 || s === 19 || s === 29 || s === 39 || s === 49) && c !== 'P' && ++this.miss >= 2) this.lost();
  }

  private lost(): void {
    this.state = 'SEARCH';
    this.reg = 0;
    this.prev = null;
    this.ver++;
  }

  /** 1 分を読み終えた: コールサインを決め、値を読む */
  private finish(f: Frame): void {
    if (f.done) return;
    let u = 0;
    for (let s = 40; s <= 48; s++) if (f.c[s] === '?') u++;
    if (u >= 5) for (let s = 40; s <= 48; s++) f.c[s] = 'S';
    f.res = evalFrame(f.c, this.lastY());
    f.done = true;
    f.q = this.quality();
    this.frames.push(f);
    if (!this.keepAll && this.frames.length > 60) this.frames.shift();
    this.ver++;
    this.onFrame?.(f);
  }

  /** ファイルの終わり: 59 秒まで読めた分は閉じる */
  end(): void {
    if (this.state === 'LOCK' && this.s >= 60 && this.fr && !this.fr.done) this.finish(this.fr);
  }

  /** 年を読めた最後の分 */
  lastY(): Res | null {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const r = this.frames[i].res;
      if (r && r.Y > 0) return r;
    }
    return null;
  }

  /** 直近 1 秒の平均電力（dBFS） */
  lvl(): number {
    const k = this.n - 1,
      n = Math.min(1000, this.n);
    if (!n) return -Infinity;
    let s = 0;
    for (let i = k - n + 1; i <= k; i++) s += this.W[i & this.M];
    return 10 * Math.log10(s / n + 1e-12);
  }

  quality(): Quality {
    const L = this.log,
      es = L.map((x) => x.e).filter(Number.isFinite);
    return {
      ok: L.filter((x) => x.ok).length,
      n: L.length,
      jit: es.length ? Math.sqrt(es.reduce((a, b) => a + b * b, 0) / es.length) : Number.NaN,
      hi: this.hi,
      lo: this.lo,
      lvl: this.lvl(),
    };
  }
}

function newFrame(t0: number): Frame {
  return {
    t0,
    c: Array(60).fill(null),
    w: Array(60).fill(Number.NaN),
    S: Array(60).fill(Number.NaN),
    np: Array(60).fill(0),
    res: null,
    done: false,
  };
}

/** 包絡線全体を読む（ファイル）。読み終えた分を返す */
export function decodeAll(env: Float32Array, pw: Float32Array): Decoder {
  const d = new Decoder(Math.max(12, Math.ceil(Math.log2(env.length + 2))));
  d.keepAll = true;
  for (let i = 0; i < env.length; i++) d.push(env[i], pw[i]);
  d.end();
  return d;
}

/* ---------- 時刻の表記 ---------- */
/** 「HH:MM」（時と分を読めていなければ ''） */
export const hm = (r: Res | null | undefined): string => (r && nn(r.h) && nn(r.m) ? `${p2(r.h)}:${p2(r.m)}` : '');
/** UTC の ms の、JST の 0 時からの ms */
export const todOf = (w: number): number => (((w + JST) % DAY) + DAY) % DAY;
/** 1 日の差を −12〜+12 時間に寄せる */
export const half = (x: number): number => ((((x + DAY / 2) % DAY) + DAY) % DAY) - DAY / 2;
/** 0 時からの ms の「HH:MM:SS」 */
export const hms = (ms: number): string => {
  const t = ((Math.floor(ms / 1000) % 86400) + 86400) % 86400;
  return `${p2(Math.floor(t / 3600))}:${p2(Math.floor(t / 60) % 60)}:${p2(t % 60)}`;
};

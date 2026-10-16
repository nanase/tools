/**
 * 奏者（DOM に依存しない）: 口の圧力・唇の共振・弁を標本ごとに決めて、トランペットを吹く。
 * 強弱は、その音が鳴る口の圧力の範囲（calib.ts）の中で対数に割り振り、同じ表から音高が合う唇の比を引く。
 * 舌（タ・ダ）は口の圧力を止めて離す弁として、立ち上がりの速さと少しの行き過ぎで表す（Hruska ら 2015 の
 * 口圧の形）。舌を離す瞬間、唇はタでは閉じた位置、ダでは半ば閉じた位置から動き始める（開いた位置から
 * 始めると、振動が育つのに 0.1〜0.2 秒かかり、短い音が鳴りきらない）。スラーは口の圧力を続けたまま唇の共振を移す。
 * 弁は VALVE_TIME で押し切る
 */
import { CALIB } from './calib';
import type { Trumpet } from './instrument';
import { FINGERS, fingering, mtof } from './notes';

/** 演奏する音（主スレッドが楽譜から作る。時刻は曲の頭から [s]） */
export interface PNote {
  t: number;
  /** 鳴らす長さ [s]（スタッカートなどで短くした後） */
  d: number;
  /** 次の音の頭までの長さ [s] */
  span: number;
  /** 実音の MIDI 番号 */
  m: number;
  /** 強弱（0 = pp 〜 1 = ff）の、音の頭と終わり */
  d0: number;
  d1: number;
  /** 次の音へスラーでつなぐ */
  slur: boolean;
  /** アクセント（立ち上がりの行き過ぎを大きく） */
  acc: boolean;
  /** 舌: 'ta' は鋭く、'da' はやわらかく */
  tongue: 'ta' | 'da';
}

/** 強弱 d（0〜1）での口の圧力 [Pa] と、音高が合う唇の比 */
export function control(m: number, d: number): { pm: number; ratio: number; db: number } {
  let rows = CALIB[m];
  if (!rows?.length) {
    /* 表にない音は近い音の表を使う */
    for (let k = 1; k < 6 && !rows?.length; k++) rows = CALIB[m - k]?.length ? CALIB[m - k] : CALIB[m + k];
  }
  if (!rows?.length) return { pm: 4000, ratio: 0.85, db: 95 };
  /* 鳴り始めの弱い発振（次の圧力より 12 dB 以上小さい）は使わない */
  while (rows.length > 1 && rows[0][2] < rows[1][2] - 12) rows = rows.slice(1);
  const lo = Math.log(rows[0][0]),
    hi = Math.log(rows[rows.length - 1][0]),
    lp = lo + (hi - lo) * Math.min(1, Math.max(0, d));
  let ratio = rows[rows.length - 1][1],
    db = rows[rows.length - 1][2];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = Math.log(rows[i][0]),
      b = Math.log(rows[i + 1][0]);
    if (lp >= a && lp <= b) {
      const t = b > a ? (lp - a) / (b - a) : 0;
      ratio = rows[i][1] + t * (rows[i + 1][1] - rows[i][1]);
      db = rows[i][2] + t * (rows[i + 1][2] - rows[i][2]);
      break;
    }
  }
  if (rows.length === 1) [ratio, db] = [rows[0][1], rows[0][2]];
  return { pm: Math.exp(lp) * 1000, ratio, db };
}

/** 手で吹くときの入力 */
export interface Manual {
  /** 押す弁 */
  v: [boolean, boolean, boolean];
  /** 狙う倍音（弁の組と合わせて音が決まる） */
  n: number;
  /** 吹いているか */
  blow: boolean;
  /** 強弱（0〜1） */
  d: number;
  /** 唇の共振と口の圧力を自動で合わせるか。false なら fl [Hz] と pm [Pa] のまま */
  auto: boolean;
  fl: number;
  pm: number;
  tongue: 'ta' | 'da' | 'slur';
}

/** 標本ごとの制御の量（表示にも使う） */
export interface Ctl {
  pm: number;
  fl: number;
  /** 狙っている音（MIDI）、なければ −1 */
  m: number;
  /** 曲の中の音の番号、なければ −1 */
  idx: number;
}

/** 舌を離す瞬間の唇の閉じ具合（1 = 閉じている。lips.ts の set） */
const CLOSE = { ta: 1, da: 0.5 } as const;

/** ビブラートの速さ [Hz] と深さ [セント]（唇の共振を揺らす。トランペット固有の実測はなく、このツールで決めた） */
const VIB_HZ = 5.5,
  VIB_C = 14;

export class Player {
  private T: number;
  /** 口の圧力と唇の共振（なめらかにした値） */
  pm = 0;
  fl = 400;
  private noise = 0;
  private seed = 12345;
  vib = false;
  /** 息の雑音（口の圧力のゆっくりした揺れの標準偏差、割合） */
  noiseAmp = 0.01;
  /* 手で吹く */
  private man: Manual | null = null;
  private manT = 0;
  private manM = -1;
  /* 曲 */
  private notes: PNote[] = [];
  private k = 0;
  /** 唇を閉じた位置から始めた音（曲の音の番号） */
  private begun = -1;
  /** 曲の頭からの時刻 [s] */
  time = 0;
  playing = false;
  readonly ctl: Ctl = { pm: 0, fl: 0, m: -1, idx: -1 };
  constructor(fs: number) {
    this.T = 1 / fs;
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return (this.seed / 4294967296) * 2 - 1;
  }

  /** 手で吹く入力。吹いていない間の入力（吹き方の設定）は覚えるだけで、曲は止めない */
  setManual(m: Manual | null): void {
    const was = this.man;
    this.man = m;
    if (m) {
      const semi = (m.v[1] ? 1 : 0) + (m.v[0] ? 2 : 0) + (m.v[2] ? 3 : 0),
        target = Math.round(46 + 12 * Math.log2(m.n)) - semi;
      if (m.blow) {
        this.playing = false;
        /* 吹き始め、または舌を使って吹き直す音 */
        if (!was?.blow || (target !== this.manM && m.tongue !== 'slur')) this.manT = 0;
      }
      this.manM = target;
    }
  }

  start(notes: PNote[], from = 0): void {
    this.notes = notes;
    this.man = null;
    this.time = from;
    this.k = 0;
    this.begun = -1;
    while (this.k < notes.length && notes[this.k].t + notes[this.k].span <= from) this.k++;
    this.playing = notes.length > 0;
  }

  stop(): void {
    this.playing = false;
    this.notes = [];
  }

  /** 1 標本ぶん進めて、楽器を鳴らす。1 m 先の音圧 [Pa] を返す */
  step(tr: Trumpet): number {
    let want = 0,
      fGoal = this.fl,
      glide = 1,
      m = -1,
      idx = -1,
      vibT = -1;
    const T = this.T;
    if (this.man && !this.playing) {
      const g = this.man;
      m = this.manM;
      const c = control(m, g.d),
        f = g.auto ? mtof(m) * c.ratio : g.fl;
      if (!g.auto) c.pm = g.pm;
      tr.setValves(g.v);
      if (g.blow) {
        const t = this.manT,
          tau = g.tongue === 'da' ? 0.012 : 0.005;
        if (t === 0 && g.tongue !== 'slur') tr.lips.set(CLOSE[g.tongue]);
        want =
          t < 0.3 && g.tongue !== 'slur' ? c.pm * (1 - Math.exp(-t / tau)) * (1 + 0.12 * Math.exp(-t / 0.04)) : c.pm;
        fGoal = t < 0.1 && g.tongue !== 'slur' ? f * (1 + 0.03 * Math.exp(-t / 0.015)) : f;
        glide = t < 0.1 && g.tongue !== 'slur' ? 1 : T / 0.01;
        vibT = t;
        this.manT += T;
      } else {
        want = 0;
        fGoal = f;
      }
    } else if (this.playing) {
      const ns = this.notes;
      while (this.k < ns.length && this.time >= ns[this.k].t + ns[this.k].span) this.k++;
      if (this.k >= ns.length) {
        this.playing = false;
      } else {
        const n = ns[this.k],
          t = this.time - n.t;
        if (t >= 0) {
          idx = this.k;
          m = n.m;
          const prev = ns[this.k - 1],
            legato = !!prev?.slur && prev.t + prev.span >= n.t - 1e-6,
            u = n.d > 0 ? Math.min(1, t / n.d) : 1,
            c = control(n.m, n.d0 + (n.d1 - n.d0) * u),
            f = mtof(n.m) * c.ratio;
          tr.setValves(FINGERS[fingering(n.m).semi].v);
          if (t < n.d) {
            const tau = n.tongue === 'da' ? 0.012 : 0.005,
              over = n.acc ? 0.3 : 0.12;
            if (!legato && this.begun !== this.k) {
              tr.lips.set(CLOSE[n.tongue]);
              this.begun = this.k;
            }
            want = legato ? c.pm : c.pm * (1 - Math.exp(-t / tau)) * (1 + over * Math.exp(-t / 0.04));
            /* 舌で止める音は終わりの 35 ms（短い音は 1/3）で口の圧力を抜く */
            const rel = n.slur ? 0 : Math.min(0.035, n.d / 3);
            if (rel > 0 && t > n.d - rel) want *= (n.d - t) / rel;
            fGoal = legato ? f : f * (1 + 0.03 * Math.exp(-t / 0.015));
            glide = legato ? T / 0.01 : 1;
            vibT = t;
          } else {
            want = 0;
            fGoal = f;
          }
        }
      }
      this.time += T;
    }
    /* 口の圧力: 舌で離す・止めるときはすぐ（形は want で作る）、スラーでは 20 ms でなめらかに */
    this.pm += (want - this.pm) * (glide === 1 ? 0.25 : Math.min(1, T / 0.02));
    if (this.pm < 0) this.pm = 0;
    this.fl += (fGoal - this.fl) * Math.min(1, glide);
    let fl = this.fl;
    if (this.vib && vibT > 0.25) {
      const a = Math.min(1, (vibT - 0.25) / 0.3);
      fl *= 2 ** ((VIB_C * a * Math.sin(2 * Math.PI * VIB_HZ * vibT)) / 1200);
    }
    /* 息の雑音: 一様乱数を 1 次の低域通過に通したもの（標準偏差 0.07）を noiseAmp に合わせる */
    this.noise = 0.97 * this.noise + 0.03 * this.rnd();
    const ctl = this.ctl;
    ctl.pm = this.pm;
    ctl.fl = fl;
    ctl.m = m;
    ctl.idx = idx;
    return tr.step(this.pm * (1 + (this.noiseAmp / 0.07) * this.noise), fl);
  }
}

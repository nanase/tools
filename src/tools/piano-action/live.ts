/**
 * 鍵盤を押している間だけ進める、その場の計算。押す・離すを力の曲線（Hirschkorn の実験の力）に写して、
 * 計算した動きを Run と同じ形で記録する。弾き終えたら toRun() を段階の絵と再生に渡せる
 */
import { CONTACTS } from './geom';
import { Action } from './model';
import { at, DT, EVERY, FF, FP, FRAME, fnAt, gapAt, type Run } from './sim';
import type { StageId, Strike } from './stages';

export type LiveTouch = 'forte' | 'piano';

/** 力の曲線の読み方 [s]。hold は力が一定になった所、minT はジャックが抜けなくても離せる所（打弦の少しあと） */
const KIND: Record<LiveTouch, { F: readonly number[]; hold: number; minT: number }> = {
  forte: { F: FF, hold: 0.25, minT: 0.12 },
  piano: { F: FP, hold: 0.36, minT: 0.24 },
};
/** 押し始める力 [N]。これより前の、力がほぼ 0 の待ちは省く */
const START_N = 0.2;
/** 押し直すときに力をかけ直す所（一定の力に対する割合）。sim.ts の連打の 3 N に当たる */
const REPRESS = 0.11;
/** 静止まで戻ったとみなす鍵の前の下がり [m] */
const REST_DIP = 5e-4;
/** 落ち着いたとみなす角速度 [rad/s] と、静止とみなす姿勢の差 [rad] */
const CALM = 0.01,
  NEAR = 0.01;
/** 離してから静止に戻らなくても打ち切るまでの時間 [s] */
const END_MAX = 1.5;
/** 接触の番号: バックチェック・ナックル・つま先とボタン・弦 */
const C_CHECK = 4,
  C_KNUCKLE = 7,
  C_LETOFF = 8,
  C_STRING = 12;
const TOUCHED = 0.005;

type Phase = 'off' | 'attack' | 'hold';

export class LiveAction {
  readonly action: Action;
  /** 記録（n は増えていく）。qAt・fnAt などでそのまま読める */
  readonly run: Run;
  /** 打弦のたびに呼ぶ */
  onStrike?: (s: Strike) => void;
  /** いまの段階 */
  stage: StageId = 'rest';
  /** 押したまま落ち着いて、計算を止めている */
  held = false;
  /** 静止に戻った（これ以上進まない） */
  done = false;

  private phase: Phase = 'off';
  /** 力の曲線の上の時刻 [s] */
  private tau = 0;
  /** 離したが、まだ押した扱いにしている */
  private upLater = false;
  private carry = 0;
  private sinceUp = 0;
  /** 押した記録の位置（コマの番号）。古い打鍵を捨てるのに使う */
  private presses: number[] = [];
  private touching = false;
  private readonly F: readonly number[];
  private readonly hold: number;
  private readonly minT: number;
  private readonly level: number;
  private cap = 4000;

  constructor(base: Pick<Run, 'reg' | 'rig' | 'q0'>, kind: LiveTouch) {
    const k = KIND[kind];
    this.F = k.F;
    this.hold = k.hold;
    this.minT = k.minT;
    this.level = at(k.F, k.hold);
    this.action = new Action(base.rig, base.q0);
    this.run = {
      kind,
      reg: base.reg,
      rig: base.rig,
      n: 0,
      q: new Float32Array(this.cap * 5),
      fn: new Float32Array(this.cap * CONTACTS.length),
      force: new Float32Array(this.cap),
      q0: base.q0,
    };
    this.action.step(DT);
    this.record();
  }

  /** 鍵に力をかけている */
  get pressing(): boolean {
    return this.phase === 'attack' || this.phase === 'hold';
  }

  /** この打鍵でジャックが抜けたか、ハンマーが弦に届いた（鍵を離しても打弦は変わらない） */
  private get launched(): boolean {
    return this.stage !== 'rest' && this.stage !== 'acc' && this.stage !== 'rep' && this.stage !== 'ret';
  }

  /** 押す。戻っている途中なら、力の曲線の途中からかけ直す */
  down(): void {
    this.upLater = false;
    if (this.pressing || this.done) return;
    const again = this.presses.length > 0;
    /* 鍵が静止まで戻っていれば、最初の打鍵と同じ力にする */
    const rising = (this.run.q0[0] - this.action.q[0]) * 0.2278 > REST_DIP;
    const want = again && rising ? this.level * REPRESS : START_N;
    let i = 0;
    while (i * 0.002 < this.hold && this.F[i] < want) i++;
    this.tau = i * 0.002;
    this.phase = 'attack';
    this.held = false;
    /* 記録には直近の 2 回だけ残す */
    if (this.presses.length >= 2) this.dropBefore(this.presses[this.presses.length - 1]);
    this.presses.push(this.run.n - 1);
    if (again) this.stage = 'rep';
  }

  /** 離す。力はすぐ 0 にする。ただしジャックが抜ける前なら、打てるように抜けるまで押した扱いにする */
  up(): void {
    if (!this.pressing) return;
    if (!this.launched && this.tau < this.minT) {
      this.upLater = true;
      return;
    }
    this.letGo();
  }

  private letGo(): void {
    this.upLater = false;
    this.phase = 'off';
    this.held = false;
    this.sinceUp = 0;
  }

  /**
   * 計算を t [s] 進める。until（performance.now の時刻）を過ぎたら残りは捨てる（重い端末では実時間より遅くなるだけ）
   */
  advance(t: number, until = Infinity): void {
    if (this.done || this.held) return;
    this.carry += t;
    let steps = Math.floor(this.carry / DT);
    this.carry -= steps * DT;
    for (; steps > 0 && !this.done && !this.held; steps--) {
      this.stepOnce();
      if (steps % 64 === 0 && performance.now() > until) {
        this.carry = 0;
        break;
      }
    }
  }

  private stepOnce(): void {
    const a = this.action;
    a.force = this.forceNow();
    a.step(DT);
    this.count++;
    if (this.count % EVERY === 0) this.record();
  }
  private count = 0;

  private forceNow(): number {
    switch (this.phase) {
      case 'attack': {
        if (this.upLater && (this.launched || this.tau >= this.minT)) {
          this.letGo();
          return 0;
        }
        const f = at(this.F, this.tau);
        this.tau += DT;
        if (this.tau >= this.hold) this.phase = 'hold';
        return f;
      }
      case 'hold':
        return this.level;
      default:
        this.sinceUp += DT;
        return 0;
    }
  }

  private record(): void {
    const R = this.run,
      a = this.action;
    if (R.n === this.cap) this.grow();
    const i = R.n;
    R.q.set(a.q, i * 5);
    R.fn.set(a.fn, i * CONTACTS.length);
    R.force[i] = a.force;
    R.n = i + 1;
    this.watch(i);
  }

  private grow(): void {
    const R = this.run;
    this.cap *= 2;
    const q = new Float32Array(this.cap * 5),
      fn = new Float32Array(this.cap * CONTACTS.length),
      force = new Float32Array(this.cap);
    q.set(R.q);
    fn.set(R.fn);
    force.set(R.force);
    R.q = q;
    R.fn = fn;
    R.force = force;
  }

  /** k コマより前を捨てる */
  private dropBefore(k: number): void {
    const R = this.run,
      nc = CONTACTS.length;
    R.q.copyWithin(0, k * 5, R.n * 5);
    R.fn.copyWithin(0, k * nc, R.n * nc);
    R.force.copyWithin(0, k, R.n);
    R.n -= k;
    this.presses = this.presses.filter((p) => p >= k).map((p) => p - k);
  }

  /** 記録したコマから、打弦・段階・落ち着いたことを見る */
  private watch(i: number): void {
    const R = this.run,
      a = this.action;
    const on = (c: number) => fnAt(R, i, c) > TOUCHED;
    const hit = on(C_STRING);
    if (hit && !this.touching) {
      const b = Math.max(0, i - 3);
      const s: Strike = {
        t: i * FRAME,
        v: b === i ? 0 : (gapAt(R, b) - gapAt(R, i)) / ((i - b) * FRAME),
        blocked: on(C_KNUCKLE),
      };
      this.stage = s.blocked ? 'block' : 'hit';
      this.onStrike?.(s);
    }
    this.touching = hit;
    const falling = this.phase === 'off';
    if (!hit) {
      if (this.stage === 'rest' && a.force > 0 && (R.q0[0] - R.q[i * 5]) * 0.2278 > 2e-4) this.stage = 'acc';
      else if ((this.stage === 'acc' || this.stage === 'rep') && on(C_LETOFF)) this.stage = 'let';
      else if ((this.stage === 'hit' || this.stage === 'block') && on(C_CHECK)) this.stage = 'chk';
      else if (falling && this.stage !== 'rest' && this.stage !== 'rest2' && this.stage !== 'ret') this.stage = 'ret';
    }
    let fast = 0;
    for (let k = 0; k < a.qd.length; k++) fast = Math.max(fast, Math.abs(a.qd[k]));
    if (this.phase === 'hold' && fast < CALM) {
      this.held = true;
      return;
    }
    if (this.phase !== 'off' || !this.presses.length) return;
    let near = true;
    for (let k = 0; k < a.q.length; k++) if (Math.abs(a.q[k] - R.q0[k]) > NEAR) near = false;
    if ((near && fast < CALM) || this.sinceUp > END_MAX) {
      this.done = true;
      this.stage = 'rest2';
    }
  }

  /** 記録を切り詰めて Run にする */
  toRun(): Run {
    const R = this.run,
      nc = CONTACTS.length;
    return {
      ...R,
      q: R.q.slice(0, R.n * 5),
      fn: R.fn.slice(0, R.n * nc),
      force: R.force.slice(0, R.n),
    };
  }
}

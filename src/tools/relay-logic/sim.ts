/**
 * 回路 1 つの時間の進め方。入力とリレーの接点から、どのコイルに電流が流れるかを決め、リレーを少しずつ動かす。
 * 画面（DOM）には触らない
 */
import type { Def } from './circuits';
import { type Circuit, type Contacts, loadsOn } from './net';
import { Relay, type RelayEvent } from './relay';

/** 1 回に進める時間 [ms]（チャタリングの開閉より十分短く） */
const H = 0.04;

export class Sim {
  readonly R: Record<string, Relay> = {};
  readonly inp: Record<string, number> = {};
  /** 時刻 [ms] */
  t = 0;
  /** 接点か入力が変わり、コイルを決め直す */
  private dirty = true;
  readonly cs: Contacts;
  /** 電流の流れているランプの辺の添字 */
  lit = new Set<number>();
  /** 変化の記録（タイミングチャート）: 入力・リレーの a 接点・ランプの id、時刻 [ms]、値 */
  log: ((id: string, t: number, v: number) => void) | null = null;

  constructor(
    readonly def: Def,
    public G: Circuit,
  ) {
    /* リレーごとの番号（ばらつきと音の種類） */
    let seed = 3;
    const next = () => {
      seed += 7;
      return seed;
    };
    for (const q of def.ins) if (q.kind === 'rel') this.R[q.id] = new Relay(next());
    for (const rg of def.rungs)
      for (const ld of rg.loads)
        if (ld.kind !== 'lamp' && !this.R[ld.id])
          this.R[ld.id] = new Relay(next(), ld.kind === 'coilC' ? (def.delay ?? 0) : 0);
    for (const [id, r] of Object.entries(this.R)) r.id = id;
    for (const q of def.ins) this.inp[q.id] = def.init?.[q.id] ?? 0;
    this.cs = (r) => {
      const rl = this.R[r];
      if (rl) return rl;
      const v = !!this.inp[r];
      return { a: v, b: !v, x: v ? 1 : 0 };
    };
  }
  set(id: string, v: number): void {
    if (this.inp[id] === v) return;
    this.inp[id] = v;
    this.dirty = true;
    this.log?.(`i:${id}`, this.t, v);
  }
  /** コイルに流れる電流を決める */
  private solve(): void {
    for (const q of this.def.ins) if (q.kind === 'rel') this.R[q.id].coil = !!this.inp[q.id];
    const on = loadsOn(this.G, this.cs);
    this.G.E.forEach((e, i) => {
      if (e.k !== 'load') return;
      if (e.ld.kind !== 'lamp') this.R[e.ld.id].coil = on.has(i);
      else if (on.has(i) !== this.lit.has(i)) {
        if (on.has(i)) this.lit.add(i);
        else this.lit.delete(i);
        this.log?.(`l:${e.ld.lb}`, this.t, +on.has(i));
      }
    });
    this.dirty = false;
  }
  /** 落ち着いているか（決め直しが要らず、どのリレーもコイルどおりの位置で止まっている） */
  get idle(): boolean {
    return !this.dirty && Object.values(this.R).every((r) => !r.busy && r.coil === (r.ph === 'r1'));
  }
  /** ms 進める。音の出来事を返す */
  advance(ms: number): RelayEvent[] {
    const ev: RelayEvent[] = [];
    const rs = Object.values(this.R);
    let left = ms;
    while (left > 1e-9) {
      if (this.dirty) this.solve();
      /* 動いていなければ一度に進める */
      if (this.idle) {
        this.t += left;
        break;
      }
      const h = Math.min(H, left);
      this.t += h;
      left -= h;
      for (const r of rs) {
        const a = r.a,
          b = r.b;
        r.step(h, this.t, ev);
        if (r.a !== a || r.b !== b) this.dirty = true;
        if (r.a !== a) this.log?.(`r:${r.id}`, this.t, +r.a);
      }
    }
    return ev;
  }
  /** 落ち着くまで進める（試験と、回路を開いた直後に使う）。最長 ms */
  settle(ms = 200): void {
    for (let i = 0; i < ms; i++) {
      this.advance(1);
      if (this.idle) return;
    }
  }
}

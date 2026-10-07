/**
 * 極と零点のフィルタを試聴する AudioWorklet。audio.ts が ?worker&url で読み込み、'pole-zero' として使う。
 * ホワイトノイズか鋸歯状波を作り、点ごとの因子（零点は分子、極は分母の 1 次・2 次式）を縦続に掛ける。
 * 係数は点の id ごとに持ち、新しい値へ時定数 10 ms で近づける（点を動かしている間も音を途切れさせない）
 */

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 点 1 つの因子: (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²) */
export interface UnitMsg {
  id: number;
  c: [number, number, number, number, number];
}

export type PzMsg =
  /** 因子の並びと全体に掛ける値 g。on でなければ（不安定など）音を止め、因子は前のままにする */
  | { t: 'set'; u: UnitMsg[]; g: number; on: boolean }
  /** 入力の音（ホワイトノイズか鋸歯状波、f は鋸歯状波の周波数） */
  | { t: 'src'; s: 'noise' | 'saw'; f: number };

/** 係数を目標へ近づける時定数（s）と、全体の大きさの時定数 */
const COEF_S = 0.01,
  GAIN_S = 0.02;
/** 係数を近づける間隔（サンプル） */
const SUB = 16;
const ID = [1, 0, 0, 0, 0];

class Unit {
  readonly c = Float64Array.from(ID);
  readonly t = Float64Array.from(ID);
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  /** 消す途中（目標は 1） */
  gone = false;
  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

registerProcessor(
  'pole-zero',
  class extends AudioWorkletProcessor {
    private readonly units = new Map<number, Unit>();
    private g = 0;
    private gt = 0;
    private src: 'noise' | 'saw' = 'noise';
    private dt = 110 / sampleRate;
    private ph = 0;
    private seed = 0x9e3779b9;
    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<PzMsg>) => {
        const m = e.data;
        if (m.t === 'src') {
          this.src = m.s;
          this.dt = m.f / sampleRate;
          return;
        }
        this.gt = m.on && Number.isFinite(m.g) ? m.g : 0;
        if (!m.on) return;
        const seen = new Set<number>();
        for (const u of m.u) {
          seen.add(u.id);
          let x = this.units.get(u.id);
          if (!x) {
            x = new Unit();
            this.units.set(u.id, x);
          }
          x.gone = false;
          x.t.set(u.c);
        }
        for (const [id, x] of this.units)
          if (!seen.has(id)) {
            x.gone = true;
            x.t.set(ID);
          }
      };
    }

    /** 一様乱数 −1 … 1（xorshift32） */
    private rnd(): number {
      let s = this.seed;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      this.seed = s >>> 0;
      return this.seed / 0x80000000 - 1;
    }

    /** 帯域を制限した鋸歯状波（PolyBLEP） */
    private saw(): number {
      const t = this.ph,
        dt = this.dt;
      let v = 2 * t - 1;
      if (t < dt) {
        const x = t / dt;
        v -= x + x - x * x - 1;
      } else if (t > 1 - dt) {
        const x = (t - 1) / dt;
        v -= x * x + x + x + 1;
      }
      this.ph += dt;
      if (this.ph >= 1) this.ph -= 1;
      return v;
    }

    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const o = out[0],
        n = o.length,
        ac = 1 - Math.exp(-SUB / (COEF_S * sampleRate)),
        ag = 1 - Math.exp(-1 / (GAIN_S * sampleRate)),
        us = [...this.units.values()];
      let bad = false;
      for (let i = 0; i < n; i++) {
        if (i % SUB === 0) for (const u of us) for (let j = 0; j < 5; j++) u.c[j] += ac * (u.t[j] - u.c[j]);
        let x = this.src === 'noise' ? this.rnd() : this.saw();
        for (const u of us) {
          const c = u.c,
            y = c[0] * x + c[1] * u.x1 + c[2] * u.x2 - c[3] * u.y1 - c[4] * u.y2;
          u.x2 = u.x1;
          u.x1 = x;
          u.y2 = u.y1;
          u.y1 = y;
          x = y;
        }
        if (!(Math.abs(x) < 1e8)) {
          bad = true;
          x = 0;
        }
        this.g += ag * (this.gt - this.g);
        o[i] = Math.max(-1, Math.min(1, x * this.g));
      }
      /* 発散したときと、止めて小さくなったときは、因子の中の値を消す */
      if (bad || (this.gt === 0 && this.g < 1e-6)) for (const u of us) u.reset();
      /* 消す途中の因子は、1 に近づいたら外す */
      for (const [id, u] of this.units)
        if (u.gone && u.c.every((v, j) => Math.abs(v - ID[j]) < 1e-6)) this.units.delete(id);
      for (let c = 1; c < out.length; c++) out[c].set(o);
      return true;
    }
  },
);

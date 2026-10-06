/**
 * オルガンの音を作る部分（DOM に依存しない）。AudioWorklet（worklet.ts）と、表示用の計算（worker.ts）で同じものを使う。
 * 鳴らす管（pipes.ts）を持ち、風箱ごとの圧力を標本ごとに作って管に渡し、1 m 先の音圧を足して出す。
 * 風箱の圧力は、静かな圧力に、トレモラント（周期的な揺れ）と、鳴っている管が使う空気の量による下がり
 * （送風の遅れを 1 次遅れで表す）を加えたもの。
 * ステレオ（再生だけ）では、管ごとに左右の重みを変える。重みは聞こえ方の目安で、模型には基づかない
 */
import { panGains } from '../guitar/engine';
import { AIR, FluePipe, type FlueSpec, ReedPipe, type ReedSpec } from './pipes';

/** 風箱: 第 1 手鍵盤・第 2 手鍵盤・ペダル */
export const CHESTS = ['I', 'II', 'P'] as const;
export type Chest = (typeof CHESTS)[number];

/** 鳴らす管（AudioWorklet へ送れる形） */
export interface PipeMsg {
  /** 管の番号（ストップ・列・鍵で決まる） */
  id: string;
  chest: Chest;
  kind: 'flue' | 'reed';
  spec: FlueSpec | ReedSpec;
  /** 定位（−1 が左、1 が右） */
  pan: number;
}

/** 風の設定 */
export interface WindDesc {
  /** 風箱ごとの静かな圧力 [Pa] */
  p0: Record<Chest, number>;
  /** トレモラント: 速さ [Hz] と深さ（圧力に対する比）。深さ 0 でなし */
  tremHz: number;
  tremDepth: number;
  /** 風の揺れ: 管が使う空気の量 1 m³/s あたりの圧力の下がり（圧力に対する比）と、送風の遅れの時定数 [s] */
  sag: number;
  tau: number;
}

interface Live {
  pipe: FluePipe | ReedPipe;
  chest: number;
  g: readonly number[];
  /** 定常で使う空気の量の目安 [m³/s]（圧力の下がりに使う） */
  q: number;
}

/** 管が定常で使う空気の量の目安 [m³/s] */
function flowOf(m: PipeMsg, p: number): number {
  const v = Math.sqrt((2 * p) / AIR.rho);
  if (m.kind === 'flue') {
    const s = m.spec as FlueSpec;
    return s.h * s.H * v * s.toe ** 0.5;
  }
  const s = m.spec as ReedSpec;
  return 0.5 * s.w * s.y0 * v;
}

export class Engine {
  private readonly live = new Map<string, Live>();
  private wind: WindDesc = { p0: { I: 800, II: 700, P: 900 }, tremHz: 5, tremDepth: 0, sag: 0, tau: 0.05 };
  /** 風箱ごとの、空気の量による圧力の下がりの状態 [Pa] と、その標本ごとの値 */
  private readonly drop = new Float64Array(3);
  private readonly wbuf = [new Float64Array(128), new Float64Array(128), new Float64Array(128)];
  private readonly mono = new Float64Array(128);
  private phase = 0;

  constructor(
    readonly fs: number,
    readonly stereo = false,
  ) {}

  setWind(w: WindDesc): void {
    this.wind = w;
  }

  /** 管を鳴らす（同じ番号の管が鳴っていれば、弁を開き直す） */
  on(m: PipeMsg): void {
    const cur = this.live.get(m.id);
    if (cur) {
      cur.pipe.on();
      return;
    }
    const pipe =
      m.kind === 'flue' ? new FluePipe(m.spec as FlueSpec, this.fs) : new ReedPipe(m.spec as ReedSpec, this.fs);
    pipe.on();
    const ci = CHESTS.indexOf(m.chest);
    this.live.set(m.id, {
      pipe,
      chest: ci,
      g: this.stereo ? panGains(m.pan) : [1],
      q: flowOf(m, this.wind.p0[m.chest]),
    });
  }

  /** 管の弁を閉じる */
  off(id: string): void {
    this.live.get(id)?.pipe.off();
  }

  /** すべての弁を閉じる */
  allOff(): void {
    for (const l of this.live.values()) l.pipe.off();
  }

  /** 鳴っている管の番号 */
  active(): string[] {
    return [...this.live.keys()];
  }

  /** out[off] から len 標本を書く（上書き）。len は 128 以下。ステレオなら左を out、右を outR に書く */
  render(out: Float32Array | Float64Array, off: number, len: number, outR?: Float32Array | Float64Array): void {
    out.fill(0, off, off + len);
    if (outR) outR.fill(0, off, off + len);
    const w = this.wind,
      fs = this.fs;
    /* 風箱の圧力: 空気の量の和で下がり（1 次遅れ）、トレモラントで揺れる */
    const q = [0, 0, 0];
    for (const l of this.live.values()) if (!l.pipe.done) q[l.chest] += l.q;
    const k = 1 - Math.exp(-len / (w.tau * fs)),
      dph = (2 * Math.PI * w.tremHz) / fs;
    CHESTS.forEach((c, ci) => {
      const p0 = w.p0[c],
        target = Math.min(0.5, w.sag * q[ci]) * p0,
        d0 = this.drop[ci];
      this.drop[ci] += k * (target - d0);
      const buf = this.wbuf[ci];
      for (let i = 0; i < len; i++) {
        const d = d0 + ((this.drop[ci] - d0) * i) / len,
          tr = w.tremDepth ? 1 + w.tremDepth * Math.sin(this.phase + dph * i) : 1;
        buf[i] = (p0 - d) * tr;
      }
    });
    this.phase = (this.phase + dph * len) % (2 * Math.PI);
    const m = this.mono;
    for (const [id, l] of this.live) {
      m.fill(0, 0, len);
      l.pipe.render(m, 0, len, this.wbuf[l.chest]);
      const gl = l.g[0];
      for (let i = 0; i < len; i++) out[off + i] += gl * m[i];
      if (outR && l.g[1] !== undefined) {
        const gr = l.g[1];
        for (let i = 0; i < len; i++) outR[off + i] += gr * m[i];
      }
      if (l.pipe.done) this.live.delete(id);
    }
  }
}

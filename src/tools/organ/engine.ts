/**
 * オルガンの音を作る部分（DOM に依存しない）。AudioWorklet（worklet.ts）と、表示用の計算（worker.ts）で同じものを使う。
 * 鳴らす管（pipes.ts）を持ち、風箱ごとの圧力を標本ごとに作って管に渡し、1 m 先の音圧を足して出す。
 * 風箱の圧力は、静かな圧力に、トレモラント（周期的な揺れ）と、鳴っている管が使う空気の量による下がり
 * （送風の遅れを 1 次遅れで表す）を加えたもの。
 * ステレオ（再生だけ）では、管ごとに左右の重みを変える。重みは聞こえ方の目安で、模型には基づかない。
 * 第 2 手鍵盤の管は箱（スウェル）に入っていて、扉を閉じると高い音ほど弱まる。扉の開き s（0 で閉じる、1 で開く）で、
 * 扉を通る音 √s と、閉じた箱を通る音（1 次の低域通過、160 Hz）を混ぜる（閉じると 30 Hz ではほとんど弱まらず、8 kHz で
 * 約 35 dB 弱まり、少し開くと急に大きくなる。Colin Pykett "Swell boxes: their effect on pipe sounds" の平均の特性。
 * √s は概数）。扉を開き切ると、箱の音はそのまま
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

/** スウェルの箱に入っている風箱（第 2 手鍵盤）と、閉じた箱の低域通過の境目 [Hz] */
const SWELL_CHEST = 1,
  SWELL_FC = 160;

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

/** 設定の数の値が同じか（調律し直した管は、鳴り残っていても別の管として作り直す） */
function sameSpec(a: object, b: object): boolean {
  const o = b as Record<string, unknown>;
  for (const [k, v] of Object.entries(a)) if (typeof v === 'number' && o[k] !== v) return false;
  return true;
}

export class Engine {
  private readonly live = new Map<string, Live>();
  /** 作り直した古い管に付ける番号 */
  private seq = 0;
  /** 同時に鳴らす管の数の上限（計算が間に合わないときに AudioWorklet が下げる） */
  budget = Infinity;
  private wind: WindDesc = { p0: { I: 800, II: 700, P: 900 }, tremHz: 5, tremDepth: 0, sag: 0, tau: 0.05 };
  /** 風箱ごとの、空気の量による圧力の下がりの状態 [Pa] と、その標本ごとの値 */
  private readonly drop = new Float64Array(3);
  private readonly wbuf = [new Float64Array(128), new Float64Array(128), new Float64Array(128)];
  private readonly mono = new Float64Array(128);
  private phase = 0;
  /* スウェル: 扉を通る音の割合（目標と今の値）、閉じた箱の低域通過の係数と状態、箱の中の管の和 */
  private swellTo = 1;
  private swellA = 1;
  private readonly swK: number;
  private readonly swZ = [0, 0];
  private readonly swL = new Float64Array(128);
  private readonly swR = new Float64Array(128);

  constructor(
    readonly fs: number,
    readonly stereo = false,
  ) {
    this.swK = 1 - Math.exp((-2 * Math.PI * SWELL_FC) / fs);
  }

  setWind(w: WindDesc): void {
    this.wind = w;
  }

  /** スウェルの扉の開き（0 で閉じる、1 で開く） */
  setSwell(s: number): void {
    this.swellTo = Math.sqrt(Math.min(1, Math.max(0, s)));
  }

  /** 管を鳴らす（同じ番号・同じ設定の管が鳴っていれば、弁を開き直す） */
  on(m: PipeMsg): void {
    const cur = this.live.get(m.id);
    if (cur && sameSpec(cur.pipe.spec, m.spec)) {
      cur.pipe.on();
      return;
    }
    /* 上限に達していたら、弁を閉じて鳴り終わりかけの管を 1 本やめる。それもなければ新しい管は鳴らさない */
    if (this.live.size >= this.budget) {
      let gone = false;
      for (const [id, l] of this.live)
        if (!l.pipe.open) {
          this.live.delete(id);
          gone = true;
          break;
        }
      if (!gone) return;
    }
    /* 設定の違う古い管は、弁を閉じて別の番号で鳴り終わらせる */
    if (cur) {
      cur.pipe.off();
      this.live.delete(m.id);
      this.live.set(`${m.id}#${++this.seq}`, cur);
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

  /** 弁の開いている管のストップ（管の番号の「:」の前） */
  openStops(out: Set<string>): Set<string> {
    for (const [id, l] of this.live) if (l.pipe.open) out.add(id.slice(0, id.indexOf(':')));
    return out;
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
    const m = this.mono,
      /* 扉が開き切っていれば、箱の中の管もそのまま足す */
      box = this.swellA < 1 || this.swellTo < 1,
      { swL, swR } = this;
    if (box) {
      swL.fill(0, 0, len);
      swR.fill(0, 0, len);
    }
    for (const [id, l] of this.live) {
      m.fill(0, 0, len);
      l.pipe.render(m, 0, len, this.wbuf[l.chest]);
      const inBox = box && l.chest === SWELL_CHEST,
        L = inBox ? swL : out,
        R = inBox ? swR : outR,
        o = inBox ? 0 : off,
        gl = l.g[0];
      for (let i = 0; i < len; i++) L[o + i] += gl * m[i];
      if (R && l.g[1] !== undefined) {
        const gr = l.g[1];
        for (let i = 0; i < len; i++) R[o + i] += gr * m[i];
      }
      if (l.pipe.done) this.live.delete(id);
    }
    if (box) {
      /* 扉の開きは 1 回の処理の間に直線で動かす */
      const a0 = this.swellA,
        a1 = a0 + (this.swellTo - a0) * Math.min(1, len / (0.03 * fs)),
        k = this.swK;
      this.swellA = Math.abs(a1 - this.swellTo) < 1e-4 ? this.swellTo : a1;
      for (let c = 0; c < (outR ? 2 : 1); c++) {
        const x = c ? swR : swL,
          y = (c ? outR : out) as Float32Array | Float64Array;
        let z = this.swZ[c];
        for (let i = 0; i < len; i++) {
          const a = a0 + ((a1 - a0) * i) / len;
          z += k * (x[i] - z);
          y[off + i] += a * x[i] + (1 - a) * z;
        }
        this.swZ[c] = z;
      }
    }
  }
}

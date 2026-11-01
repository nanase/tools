/**
 * 操作の音: 値ごとに短い音を 1 つ鳴らす。音の高さは棒の高さで決める。
 * 速いときは 1 コマに鳴らす音の数を抑える
 */
type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 1 コマに鳴らす音の上限 */
export const TONE_MAX = 8;
/** 音の高さの範囲: 最も低い音 [Hz] と、最も高い音までの半音の数 */
export const F_LOW = 110;
export const SEMIS = 48;

export type Wave = 'triangle' | 'square' | 'sine';
export type Scale = 'cont' | 'penta';

const PENTA = [0, 2, 4, 7, 9, 12];

/** 値 v（1〜vm）の音の高さ [Hz] */
export function freqOf(v: number, vm: number, scale: Scale): number {
  const s = (SEMIS * Math.max(0, v - 1)) / Math.max(1, vm - 1);
  if (scale === 'cont') return F_LOW * 2 ** (s / 12);
  const o = Math.floor(s / 12);
  let b = 0;
  for (const p of PENTA) if (Math.abs(o * 12 + p - s) < Math.abs(o * 12 + b - s)) b = p;
  return F_LOW * 2 ** ((o * 12 + b) / 12);
}

export class SortAudio {
  /** ブラウザや OS に止められたとき（lib/pause.ts の autoPause が設定する） */
  onLost: (() => void) | null = null;
  on = true;
  wave: Wave = 'triangle';
  scale: Scale = 'cont';
  private ac: AudioContext | null = null;
  private g: GainNode | null = null;
  private db = -20;
  private own = false;

  /** 押した操作の中で呼ぶ（自動再生の制限） */
  ready(): void {
    if (!AC) return;
    if (!this.ac) {
      const ac = new AC(),
        g = ac.createGain(),
        co = ac.createDynamicsCompressor();
      g.connect(co).connect(ac.destination);
      ac.onstatechange = () => {
        if (ac.state !== 'running' && !this.own) this.onLost?.();
        this.own = false;
      };
      this.ac = ac;
      this.g = g;
      this.vol(this.db);
    }
    if (this.ac.state !== 'running') void this.ac.resume().catch(() => {});
  }

  suspend(): void {
    if (this.ac?.state === 'running') {
      this.own = true;
      void this.ac.suspend();
    }
  }

  vol(db: number): void {
    this.db = db;
    if (this.g) this.g.gain.value = 10 ** (db / 20);
  }

  private tone(v: number, vm: number, t: number, d: number): void {
    const { ac, g } = this;
    if (!ac || !g) return;
    const o = ac.createOscillator(),
      e = ac.createGain();
    o.type = this.wave;
    o.frequency.value = freqOf(v, vm, this.scale);
    /* 矩形波は同じ振幅だと大きく聞こえる */
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(this.wave === 'square' ? 0.16 : 0.32, t + 0.003);
    e.gain.exponentialRampToValueAtTime(0.0008, t + d);
    o.connect(e).connect(g);
    o.start(t);
    o.stop(t + d + 0.01);
  }

  /** 1 コマ dt [s] の間に値の列を鳴らす。音の長さは d [s]。多いときは間引く */
  play(list: readonly number[], vm: number, dt: number, d: number, max = TONE_MAX): void {
    const { ac } = this;
    if (!ac || !this.on || !list.length || ac.state !== 'running') return;
    const t0 = ac.currentTime + 0.012,
      m = Math.min(list.length, max);
    for (let i = 0; i < m; i++)
      this.tone(list[Math.floor((i * list.length) / m)], vm, t0 + (i * Math.max(dt, 0.001)) / m, d);
  }
}

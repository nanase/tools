/**
 * 4 ビット CPU の音（音の案 1）: 出力の値をドレミの高さで鳴らし（1 がド、8 が 1 オクターブ上のド）、
 * クロックごとに小さな刻みを鳴らす
 */
type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

const SCALE = [0, 2, 4, 5, 7, 9, 11];
/** 出力の値 v（1〜15）の音の高さ [Hz] */
export function hzOf(v: number): number {
  const k = v - 1;
  return 261.63 * 2 ** ((12 * Math.floor(k / 7) + SCALE[k % 7]) / 12);
}

export class CpuAudio {
  /** ブラウザや OS に止められたとき（lib/pause.ts の autoPause が設定する） */
  onLost: (() => void) | null = null;
  on = true;
  private ac: AudioContext | null = null;
  private g: GainNode | null = null;
  private db = -20;
  private own = false;

  /** 押した操作の中で呼ぶ（自動再生の制限） */
  ready(): void {
    if (!AC) return;
    if (!this.ac) {
      const ac = new AC(),
        g = ac.createGain();
      g.connect(ac.destination);
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

  private live(): AudioContext | null {
    return this.on && this.ac?.state === 'running' ? this.ac : null;
  }

  /** 出力が書き換わった（0 は鳴らさない） */
  note(v: number, dur = 0.32): void {
    const ac = this.live();
    if (!ac || !this.g || !v) return;
    const t = ac.currentTime,
      o = ac.createOscillator(),
      e = ac.createGain();
    o.type = 'triangle';
    o.frequency.value = hzOf(v);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.6, t + 0.012);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e).connect(this.g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** クロックの始まり */
  tick(): void {
    const ac = this.live();
    if (!ac || !this.g) return;
    const t = ac.currentTime,
      o = ac.createOscillator(),
      e = ac.createGain();
    o.type = 'square';
    o.frequency.value = 1800;
    e.gain.setValueAtTime(0.05, t);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
    o.connect(e).connect(this.g);
    o.start(t);
    o.stop(t + 0.03);
  }
}

/**
 * 値の列を音にする（worklet.ts が出力のサンプリング周波数で呼ぶ。テストからも直接呼べる）。
 * 値は写像の x の範囲を 0〜1 に直して使う。
 * - 波形: 写像を毎秒 rate 回まわし、値をそのまま波形の標本にする。周期 p の軌道は rate/p Hz の音になり、
 *   周期が倍になるたびに 1 オクターブ下がる。カオスでは雑音になる
 * - 旋律: 毎秒 rate 回の音符にし、値 0〜1 を高さ lo〜lo·2^oct へ写す（scale が 'penta' なら五音音階へ丸める）
 */
import { MAPS, type MapDef, type MapId } from './map';

export type SoundMode = 'wave' | 'melody';
export type Scale = 'cont' | 'penta';

export interface SoundParams {
  map: MapId;
  r: number;
  mode: SoundMode;
  /** 写像をまわす回数 [回/s]（波形では周期 2 の音の 2 倍、旋律では音符の数） */
  rate: number;
  /** 旋律の最も低い音 [Hz] とオクターブの幅 */
  lo: number;
  oct: number;
  scale: Scale;
}

export const SOUND0: SoundParams = { map: 'logistic', r: 3.2, mode: 'wave', rate: 880, lo: 220, oct: 2, scale: 'cont' };

/** 波形の直流を除く高域通過の遮断 [Hz] と、段差をならす低域通過の遮断（rate の倍数） */
const DC_HZ = 10;
const SMOOTH = 4;
/** 旋律の音の立ち上がりと減衰の時定数 [s] */
const ATTACK = 0.005;
const DECAY = 0.12;
/** 五音音階（ド・レ・ミ・ソ・ラ）の半音の位置 */
const PENTA = [0, 2, 4, 7, 9];

/** 値 x（0〜1）の旋律の高さ [Hz] */
export function pitchOf(x: number, p: Pick<SoundParams, 'lo' | 'oct' | 'scale'>): number {
  let s = x * p.oct * 12;
  if (p.scale === 'penta') {
    const o = Math.floor(s / 12),
      w = s - o * 12;
    let best = 0;
    for (const q of [...PENTA, 12]) if (Math.abs(q - w) < Math.abs(best - w)) best = q;
    s = o * 12 + best;
  }
  return p.lo * 2 ** (s / 12);
}

export class MapVoice {
  private p: SoundParams = SOUND0;
  private x = MAPS.logistic.x0;
  /** 次の反復までの位相（0〜1） */
  private ph = 1;
  private hp = 0;
  private hpIn = 0;
  private lp = 0;
  /** 旋律の発振器の位相・周波数・包絡 */
  private oPh = 0;
  private f = 0;
  private env = 0;
  private age = 0;

  set(p: SoundParams): void {
    if (p.map !== this.p.map) this.x = MAPS[p.map].x0;
    this.p = p;
  }

  /** 今の値（表示と合わせるため） */
  get value(): number {
    return this.x;
  }

  /** 今の値を x の範囲の中の割合（0〜1）で */
  private u(m: MapDef): number {
    return (this.x - m.x[0]) / (m.x[1] - m.x[0]);
  }

  /** n 個の標本を out へ書く（大きさは ±1 以内） */
  render(out: Float32Array, n: number, fs: number): void {
    const m = MAPS[this.p.map],
      { r, rate, mode } = this.p,
      inc = rate / fs;
    if (mode === 'wave') {
      const a = Math.exp((-2 * Math.PI * DC_HZ) / fs),
        b = 1 - Math.exp((-2 * Math.PI * Math.min(SMOOTH * rate, fs / 3)) / fs);
      for (let i = 0; i < n; i++) {
        this.ph += inc;
        if (this.ph >= 1) {
          this.ph -= Math.floor(this.ph);
          this.next(m, r);
        }
        this.lp += b * (this.u(m) - this.lp);
        /* 1 次の高域通過 y[n] = a (y[n−1] + x[n] − x[n−1]) */
        this.hp = a * (this.hp + this.lp - this.hpIn);
        this.hpIn = this.lp;
        out[i] = Math.max(-1, Math.min(1, 1.6 * this.hp));
      }
      return;
    }
    const ka = 1 - Math.exp(-1 / (ATTACK * fs)),
      kd = Math.exp(-1 / (DECAY * fs));
    for (let i = 0; i < n; i++) {
      this.ph += inc;
      if (this.ph >= 1) {
        this.ph -= Math.floor(this.ph);
        this.next(m, r);
        this.f = pitchOf(this.u(m), this.p);
        this.age = 0;
      }
      /* 立ち上がりは目標 1 へ近づけ、そのあとは指数で減衰させる */
      this.env = this.age < ATTACK * fs * 3 ? this.env + ka * (1 - this.env) : this.env * kd;
      this.age++;
      this.oPh += this.f / fs;
      this.oPh -= Math.floor(this.oPh);
      out[i] = 0.5 * this.env * Math.sin(2 * Math.PI * this.oPh);
    }
  }

  private next(m: MapDef, r: number): void {
    const y = m.f(this.x, r),
      [a, b] = m.x;
    /* 外へ出た値は端に収める（表示の iterate と同じ）。NaN と、不安定なのに丸めでちょうど端に乗った軌道
       （ロジスティクの r = 4 の 0.5 → 1 → 0）は始め直す */
    if (Number.isNaN(y)) this.x = m.x0;
    else if ((y === a || y === b) && Math.abs(m.dx(y, r)) > 1) this.x = m.x0;
    else this.x = y < a ? a : y > b ? b : y;
  }
}

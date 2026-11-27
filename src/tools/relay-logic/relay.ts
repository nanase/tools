/**
 * リレー 1 個の動き。コイルに電流が流れると、少し遅れて接極子が鉄心へ引き寄せられ、a 接点が閉じて b 接点が開く。
 * 電流が切れると、ばねで戻って b 接点が閉じる。閉じた直後は接点が跳ねて何度か開閉する（チャタリング）。
 * 時間は ms。値は小形リレーの典型的な値として決めたもので、特定の製品の値ではない
 */

/** 動作時間・復帰時間・チャタリングの長さ [ms] */
export const RV = { tOn: 8, tOff: 4, ch: 1.2 } as const;

/** 番号から −1〜1 の決まった値（リレーごとのばらつき） */
export const hs = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

/** チャタリングの開閉の並び（区間の割合と、閉じているか） */
const CH_PAT: readonly (readonly [number, 0 | 1])[] = [
  [0, 1],
  [0.28, 0],
  [0.48, 1],
  [0.7, 0],
  [0.82, 1],
];
const chat = (u: number): 0 | 1 => {
  let s: 0 | 1 = 1;
  for (const [k, v] of CH_PAT) if (u >= k) s = v;
  return s;
};

/**
 * 段階: r0 復帰した状態・d1 動作の遅れ・m1 接極子が動く・c1 a 接点のチャタリング・
 * r1 動作した状態・d0 復帰の遅れ・m0 接極子が戻る・c0 b 接点のチャタリング
 */
export type Phase = 'r0' | 'd1' | 'm1' | 'c1' | 'r1' | 'd0' | 'm0' | 'c0';
/** 音を鳴らす出来事: on 接極子が鉄心に当たる・off ばねで戻って止まる・tick と tick2 は跳ねた接点が当たり直す */
export type ClickKind = 'on' | 'off' | 'tick' | 'tick2';
export interface RelayEvent {
  r: Relay;
  k: ClickKind;
  /** 起きた時刻 [ms] */
  t: number;
}

export interface ContactState {
  /** a 接点が閉じているか */
  a: boolean;
  /** b 接点が閉じているか */
  b: boolean;
  /** 接極子の位置（0 復帰・1 動作） */
  x: number;
}

export class Relay implements ContactState {
  /** 名前（R1、A など） */
  id = '';
  readonly seed: number;
  readonly tOn: number;
  readonly tOff: number;
  readonly ch: number;
  /** 復帰を遅らせる時間 [ms]（コイルに並列のコンデンサ） */
  readonly exOff: number;
  coil = false;
  ph: Phase = 'r0';
  a = false;
  b = true;
  x = 0;
  private t = 0;

  constructor(seed = 0, exOff = 0) {
    this.seed = seed;
    this.tOn = RV.tOn * (1 + 0.07 * hs(seed + 1));
    this.tOff = RV.tOff * (1 + 0.09 * hs(seed + 2));
    this.ch = RV.ch * (1 + 0.2 * hs(seed + 3));
    this.exOff = exOff;
  }
  /** 動作の遅れ・接極子が動く時間・復帰の遅れ・戻る時間 */
  private get D1(): number {
    return 0.6 * this.tOn;
  }
  private get M1(): number {
    return 0.4 * this.tOn;
  }
  private get D0(): number {
    return 0.4 * this.tOff + this.exOff;
  }
  private get M0(): number {
    return 0.6 * this.tOff;
  }
  /** 動いている途中か */
  get busy(): boolean {
    return this.ph !== 'r0' && this.ph !== 'r1';
  }
  /** コンデンサの電気でコイルに電流が続いているか */
  get held(): boolean {
    return this.ph === 'd0' && this.exOff > 0;
  }
  private go(p: Phase): void {
    this.ph = p;
    this.t = 0;
  }
  /** h ms 進める。now は進めた後の時刻。音を鳴らす出来事を ev に足す */
  step(h: number, now: number, ev: RelayEvent[]): void {
    this.t += h;
    switch (this.ph) {
      case 'r0':
        if (this.coil) this.go('d1');
        break;
      case 'd1':
        if (!this.coil) this.go('r0');
        else if (this.t >= this.D1) this.go('m1');
        break;
      case 'm1': {
        const u = Math.min(1, this.t / this.M1);
        this.x = u * u;
        this.b = this.x < 0.22;
        if (u >= 1) {
          this.x = 1;
          this.a = true;
          this.go('c1');
          ev.push({ r: this, k: 'on', t: now });
        }
        break;
      }
      case 'c1': {
        const u = this.t / this.ch;
        if (u >= 1) {
          this.go('r1');
          this.a = true;
          this.x = 1;
        } else {
          const c = chat(u);
          if (c && !this.a) ev.push({ r: this, k: 'tick', t: now });
          this.a = !!c;
          this.x = c ? 1 : 0.93;
        }
        break;
      }
      case 'r1':
        if (!this.coil) this.go('d0');
        break;
      case 'd0':
        if (this.coil) this.go('r1');
        else if (this.t >= this.D0) this.go('m0');
        break;
      case 'm0': {
        const u = Math.min(1, this.t / this.M0);
        this.x = 1 - u * u;
        this.a = false;
        if (u >= 1) {
          this.x = 0;
          this.b = true;
          this.go('c0');
          ev.push({ r: this, k: 'off', t: now });
        }
        break;
      }
      case 'c0': {
        const u = this.t / (this.ch * 0.7);
        if (u >= 1) {
          this.go('r0');
          this.b = true;
          this.x = 0;
        } else {
          const c = chat(u);
          if (c && !this.b) ev.push({ r: this, k: 'tick2', t: now });
          this.b = !!c;
          this.x = c ? 0 : 0.07;
        }
        break;
      }
    }
  }
}

/**
 * 音源の音（DOM に依存しない。AudioWorklet とテストで使う）。どれも、音源から r0 [m] の所の音圧 [Pa] を標本ごとに返す。
 * サイレン・警笛・正弦波は帯域を制限した波形表、エンジンはエンジン音響モデル（EngineSim）を回転数を保って回す
 */
import { EngineSim } from '../engine/engine';
import { JA65, specOf } from '../engine/spec';

/** 20 µPa を 0 dB とした音圧レベル [dB] から実効値 [Pa] */
export const paOf = (db: number): number => 20e-6 * 10 ** (db / 20);

/** 音源の種類 */
export type SourceId = 'siren' | 'horn' | 'engine' | 'tone';

/** 音源の諸元: 大きさ（r0 [m] での音圧レベル [dB]）と高さ */
export interface SourceSpec {
  v: SourceId;
  name: string;
  /** 大きさを決める距離 [m] と、そこでの音圧レベル [dB] */
  r0: number;
  db: number;
  /** 地面からの高さ [m]（このツールで決めた） */
  h: number;
}
/**
 * 音源の一覧。大きさは範囲の中ほどにした: サイレンは保安基準の 90〜120 dB（前方 20 m）、警笛は Zöllner の EN 15153-2 の品の
 * 101〜109 dB(C)（25 m）。エンジンの大きさは EngineSim の音（排気口から 0.5 m）の実効値で、10〜100 km/h で 104〜111 dB の中ほど
 * （グラフと計算結果だけに使い、音は EngineSim の音圧のまま）
 */
export const SOURCES: readonly SourceSpec[] = [
  { v: 'siren', name: '救急車のサイレン', r0: 20, db: 105, h: 2 },
  { v: 'horn', name: '電車の警笛', r0: 25, db: 105, h: 3 },
  { v: 'engine', name: 'エンジン', r0: 0.5, db: 108, h: 0.3 },
  { v: 'tone', name: '正弦波', r0: 10, db: 90, h: 1 },
];
export const sourceOf = (v: string): SourceSpec => SOURCES.find((s) => s.v === v) ?? SOURCES[0];

/** 救急車のサイレン: ピー 960 Hz・ポー 770 Hz を 0.65 s ずつ（1 周期 1.3 s）、ビブラート 10 Hz（消防科学研究所報 30 号の規定値）。ビブラートの深さ trem は報告に書かれていないので仮の値 */
export const SIREN = { hi: 960, lo: 770, half: 0.65, vib: 10, trem: 0.3 };
/** 電車の警笛の 2 音 [Hz]（EN 15153-2 の組み合わせの 1 つ。370 Hz ± 20 Hz・660 Hz ± 30 Hz） */
export const HORN = { lo: 370, hi: 660 };

/** 波形表の長さ */
const TBL = 2048;

/**
 * 1 周期の波形表: n 倍音の振幅 amp(n) を、f·n·headroom < 0.45 fs の倍音まで足し、実効値を 1 にする。
 * headroom はドップラー効果で周波数が上がっても折り返さないための余裕
 */
export function waveTable(f: number, fs: number, amp: (n: number) => number, headroom = 2): Float32Array {
  const t = new Float32Array(TBL + 1),
    nMax = Math.max(1, Math.floor((0.45 * fs) / (f * headroom)));
  let e = 0;
  for (let n = 1; n <= nMax; n++) {
    const a = amp(n);
    if (!a) continue;
    e += (a * a) / 2;
    for (let i = 0; i < TBL; i++) t[i] += a * Math.sin((2 * Math.PI * n * i) / TBL);
  }
  const k = 1 / Math.sqrt(e);
  for (let i = 0; i < TBL; i++) t[i] *= k;
  t[TBL] = t[0];
  return t;
}

/** 波形表を読む発振器 */
class Osc {
  private ph = 0;
  constructor(
    private tbl: Float32Array,
    private fs: number,
  ) {}
  step(f: number): number {
    const x = this.ph * TBL,
      i = Math.floor(x),
      u = x - i,
      y = this.tbl[i] + u * (this.tbl[i + 1] - this.tbl[i]);
    this.ph += f / this.fs;
    if (this.ph >= 1) this.ph -= 1;
    return y;
  }
}

/** 音源の共通の形 */
export interface Source {
  readonly spec: SourceSpec;
  /** 次の標本 [Pa]（r0 での音圧） */
  step(): number;
  /** 今の基本の周波数 [Hz]（グラフの縦軸の基準） */
  f0(): number;
  /** 音源の速さ [m/s] を知らせる（エンジンの回転数を決める） */
  speed(v: number): void;
}

/** 奇数倍音だけの波形（矩形波に近い）。電子サイレンの音色はこのツールで決めた */
const odd = (n: number) => (n % 2 ? 1 / n : 0);
/** すべての倍音（のこぎり波に近い）。警笛の音色はこのツールで決めた */
const saw = (n: number) => 1 / n;

export class Siren implements Source {
  readonly spec = sourceOf('siren');
  private hiO: Osc;
  private loO: Osc;
  private n = 0;
  private a: number;
  constructor(
    private fs: number,
    /** ビブラート（10 Hz の振幅の揺れ）の深さ（0〜1。仮の値） */
    private trem = SIREN.trem,
  ) {
    this.hiO = new Osc(waveTable(SIREN.hi, fs, odd), fs);
    this.loO = new Osc(waveTable(SIREN.lo, fs, odd), fs);
    /* 揺らしても実効値が変わらないようにする */
    this.a = paOf(this.spec.db) / Math.sqrt(1 + (trem * trem) / 2);
  }
  /** 今がピー（高い音）か */
  private get high(): boolean {
    return (this.n / this.fs) % (2 * SIREN.half) < SIREN.half;
  }
  step(): number {
    const y = this.high ? this.hiO.step(SIREN.hi) : this.loO.step(SIREN.lo),
      g = 1 + this.trem * Math.sin((2 * Math.PI * SIREN.vib * this.n) / this.fs);
    this.n++;
    return this.a * g * y;
  }
  f0(): number {
    return this.high ? SIREN.hi : SIREN.lo;
  }
  speed(): void {}
}

export class Horn implements Source {
  readonly spec = sourceOf('horn');
  private lo: Osc;
  private hi: Osc;
  private a: number;
  constructor(fs: number) {
    this.lo = new Osc(waveTable(HORN.lo, fs, saw), fs);
    this.hi = new Osc(waveTable(HORN.hi, fs, saw), fs);
    /* 2 音を同じ大きさで重ね、合わせた実効値を spec.db にする */
    this.a = paOf(this.spec.db) / Math.SQRT2;
  }
  step(): number {
    return this.a * (this.lo.step(HORN.lo) + this.hi.step(HORN.hi));
  }
  f0(): number {
    return HORN.hi;
  }
  speed(): void {}
}

export class Tone implements Source {
  readonly spec = sourceOf('tone');
  private o: Osc;
  private a: number;
  constructor(
    fs: number,
    public f = 1000,
  ) {
    this.o = new Osc(
      waveTable(1, fs, (n) => (n === 1 ? 1 : 0), 1),
      fs,
    );
    this.a = paOf(this.spec.db);
  }
  step(): number {
    return this.a * this.o.step(this.f);
  }
  f0(): number {
    return this.f;
  }
  speed(): void {}
}

/** タイヤの半径 [m]（エンジン音響モデルの走行と同じ） */
const R_WHEEL = 0.284;
/** 変速の目安: この回転数 [rpm] を超えたら上のギアにする */
const UPSHIFT = 5500;

/** 速さ v [m/s] で走る CT125（JA65）のギアと回転数 [rpm]。いちばん上のギアでも超えるときは燃料を切る回転数で止める */
export function engineRpm(v: number): { gear: number; rpm: number } {
  const d = JA65.drive,
    w = Math.abs(v) / R_WHEEL;
  let gear = 1,
    rpm = 0;
  for (; gear <= d.gears.length; gear++) {
    rpm = ((w * d.primary * d.gears[gear - 1] * d.final) / (2 * Math.PI)) * 60;
    if (rpm <= UPSHIFT || gear === d.gears.length) break;
  }
  return { gear, rpm: Math.min(JA65.cut - 200, Math.max(JA65.idle, rpm)) };
}

/** エンジン: 回転数を保って回す（音源の速さからギアと回転数を決める）。音圧は排気口から 0.5 m の値 */
export class Engine implements Source {
  readonly spec = sourceOf('engine');
  private e: EngineSim;
  private target: number;
  constructor(
    private fs: number,
    /** スロットルの開き（0〜1） */
    throttle = 0.3,
  ) {
    this.e = new EngineSim(specOf('ja65', 'stock'), fs);
    this.e.mode = 'hold';
    this.e.throttle = throttle;
    this.target = this.e.rpm;
  }
  step(): number {
    /* 回転数は 0.2 s ほどでなめらかに追う */
    const e = this.e;
    e.rpm += (this.target - e.rpm) * (5 / this.fs);
    return e.step();
  }
  /** 点火の周波数 [Hz]（単気筒の 4 ストロークは 2 回転に 1 回） */
  f0(): number {
    return this.e.rpm / 120;
  }
  speed(v: number): void {
    this.target = engineRpm(v).rpm;
  }
}

export function makeSource(id: SourceId, fs: number): Source {
  return id === 'horn' ? new Horn(fs) : id === 'engine' ? new Engine(fs) : id === 'tone' ? new Tone(fs) : new Siren(fs);
}

/**
 * フレットノイズ（指が巻弦の上をすべる音）。Pakarinen ら (2008) の接触音の模型にならう:
 * 巻線を 1 本越えるたびに短い雑音のパルスが出るとし、その間隔（速さ ÷ 巻きのピッチ）で
 * 時間とともに変わる共振器と波形の飽和（倍音）、弦の縦振動の静的な共振を通す。プレーン弦は弱い白色雑音だけ。
 * 出力は駒にかかる力 [N]（DOM に依存しない）
 */
import { rng } from './body';

export interface SlideSpec {
  /** 巻弦か */
  wound: boolean;
  /** 巻きのピッチ（巻線の直径） [m] */
  pw: number;
  /** 弦の縦振動の第 1 モード [Hz] */
  fL: number;
  /** すべる距離 [m] と時間 [s] */
  dist: number;
  dur: number;
  /** 大きさ（1 が標準） */
  level: number;
  seed?: number;
}

/** 1 本の巻線を越えたときのパルスの時定数 [s] */
const PULSE_S = 2.5e-4;
/** 速さ 0.5 m/s のときの力の大きさ [N]（巻弦・プレーン弦） */
const GAIN_W = 0.05,
  GAIN_P = 0.006;

/** 2 次の共振器（帯域通過、中心で利得 1） */
class Reso {
  private y1 = 0;
  private y2 = 0;
  step(x: number, f: number, q: number, fs: number): number {
    const r = Math.exp((-Math.PI * f) / (q * fs)),
      y = (1 - r) * x + 2 * r * Math.cos((2 * Math.PI * f) / fs) * this.y1 - r * r * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** すべる音の力の波形（サンプリング周波数 fs） */
export function slideNoise(sp: SlideSpec, fs: number): Float32Array {
  const n = Math.ceil((sp.dur + 0.03) * fs),
    out = new Float32Array(n),
    r = rng(sp.seed ?? 7),
    pd = Math.exp(-1 / (PULSE_S * fs)),
    tv = new Reso(),
    s1 = new Reso(),
    s2 = new Reso();
  let ph = 0,
    env = 0,
    lp = 0;
  const lpk = 1 - Math.exp((-2 * Math.PI * 3000) / fs);
  for (let i = 0; i < n; i++) {
    const t = i / fs,
      v = t < sp.dur ? (sp.dist / sp.dur) * (Math.PI / 2) * Math.sin((Math.PI * t) / sp.dur) : 0,
      g = sp.level * (v / 0.5),
      w = 2 * r() - 1;
    if (!sp.wound) {
      lp += lpk * (w - lp);
      out[i] = GAIN_P * g * lp;
      continue;
    }
    /* 巻線を越えるたびにパルス */
    const fc = v / sp.pw;
    ph += fc / fs;
    if (ph >= 1) {
      ph -= Math.floor(ph);
      env = 1;
    }
    env *= pd;
    const x = env * w,
      f1 = Math.min(0.4 * fs, Math.max(40, fc)),
      y = Math.tanh(6 * tv.step(x, f1, 4, fs)),
      st = s1.step(x, sp.fL, 6, fs) + 0.6 * s2.step(x, Math.min(0.4 * fs, 2 * sp.fL), 6, fs);
    lp += lpk * (y + 1.5 * st - lp);
    out[i] = GAIN_W * g * lp;
  }
  return out;
}

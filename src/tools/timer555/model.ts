/** 555 非安定マルチバイブレータの計算と波形（理想素子モデル） */
import { mapper, nice, SW } from '../../lib/scope';

export interface In {
  r1: number;
  r2: number;
  c1: number;
  vcc: number;
}
export interface Out {
  tH: number;
  tL: number;
  T: number;
  f: number;
  D: number;
  I: number;
  P: number;
}

export function solve({ r1, r2, c1, vcc }: In): Out {
  const L = Math.LN2,
    tH = L * (r1 + r2) * c1,
    tL = L * r2 * c1,
    T = tH + tL;
  return { tH, tL, T, f: 1 / T, D: ((r1 + r2) / (r1 + 2 * r2)) * 100, I: vcc / r1, P: (vcc * vcc) / r1 };
}

/** 定常状態の波形。1 周期が 3 div 程度になるよう時間軸を選ぶ */
export function wave({ r1, r2, c1, vcc }: In, { tH, tL, T }: Out) {
  const td = nice((T * 3) / 9),
    vd = nice(vcc / 5),
    { X, Y } = mapper(td, vd);
  const t0 = -td,
    end = 9 * td,
    p0 = ((t0 % T) + T) % T;

  /* CH1: 出力（方形波） */
  let hi = p0 < tH,
    nx = t0 + (hi ? tH - p0 : T - p0),
    ch1 = `M0 ${Y(hi ? vcc : 0)}`;
  while (nx < end) {
    ch1 += `H${X(nx)}V${Y(hi ? 0 : vcc)}`;
    hi = !hi;
    nx += hi ? tH : tL;
  }
  ch1 += `H${SW}`;

  /* CH2: C1 の電圧（1/3 VCC と 2/3 VCC の間の充放電） */
  const N = 600,
    tau1 = (r1 + r2) * c1,
    tau2 = r2 * c1;
  let ch2 = '';
  for (let i = 0; i <= N; i++) {
    const t = t0 + (10 * td * i) / N,
      q = ((t % T) + T) % T;
    const v = q < tH ? vcc - ((2 * vcc) / 3) * Math.exp(-q / tau1) : ((2 * vcc) / 3) * Math.exp(-(q - tH) / tau2);
    ch2 += `${(i ? 'L' : 'M') + ((i * SW) / N).toFixed(1)} ${Y(v)}`;
  }
  return { td, vd, ch1, ch2, y1: +Y(vcc / 3), y2: +Y((2 * vcc) / 3) };
}

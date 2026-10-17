/**
 * 入力インピーダンス（DOM に依存しない）。平面波の伝達行列で、細かい円筒の階段として計算する。
 * 損失は Keefe（1984）の太い管の近似、開口は非フランジ円管の反射（Silva ら 2009 の近似式）
 */
import { type Air, type Profile, radiusAt } from './bore';

/** 複素数 [re, im] */
type C = [number, number];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const cexp = (a: C): C => {
  const e = Math.exp(a[0]);
  return [e * Math.cos(a[1]), e * Math.sin(a[1])];
};

/** 円筒の特性インピーダンスと伝搬定数（e^{jωt}、e^{−Γx}） */
export function lossyTube(air: Air, f: number, a: number): { zc: C; g: C } {
  const w = 2 * Math.PI * f,
    rv = a * Math.sqrt((air.rho * w) / air.eta),
    z0 = (air.rho * air.c) / (Math.PI * a * a),
    k = w / air.c;
  return {
    zc: [z0 * (1 + 0.369 / rv), -z0 * (0.369 / rv + 1.149 / rv ** 2 + 0.303 / rv ** 3)],
    g: [k * (1.045 / rv + 1.08 / rv ** 2 + 0.75 / rv ** 3), k * (1 + 1.045 / rv)],
  };
}

/** 非フランジ円管の開口の反射率 R（圧力、管の中から見た値） */
export function radReflect(air: Air, f: number, a: number): C {
  const k = (2 * Math.PI * f) / air.c,
    ka = k * a,
    m = (1 + 0.2 * ka - 0.084 * ka * ka) / (1 + 0.2 * ka + (0.5 - 0.084) * ka * ka),
    l = a * ((0.6133 * (1 + 0.044 * ka * ka)) / (1 + 0.19 * ka * ka) - 0.02 * Math.sin(2 * ka) ** 2);
  const e = cexp([0, -2 * k * l]);
  return [-m * e[0], -m * e[1]];
}

/** 開口の放射インピーダンス */
export function radImpedance(air: Air, f: number, a: number): C {
  const R = radReflect(air, f, a),
    z0 = (air.rho * air.c) / (Math.PI * a * a);
  const z = cdiv([1 + R[0], R[1]], [1 - R[0], -R[1]]);
  return [z0 * z[0], z0 * z[1]];
}

/** 円筒 1 本を通して、出口のインピーダンスから入口のインピーダンスへ */
function through(air: Air, f: number, a: number, L: number, Z: C): C {
  const { zc, g } = lossyTube(air, f, a);
  const e1 = cexp([g[0] * L, g[1] * L]),
    e2 = cexp([-g[0] * L, -g[1] * L]),
    ch: C = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2],
    sh: C = [(e1[0] - e2[0]) / 2, (e1[1] - e2[1]) / 2];
  /* Z_in = (ch Z + Zc sh) / (sh Z / Zc + ch) */
  const num = cadd(cmul(ch, Z), cmul(zc, sh)),
    den = cadd(cdiv(cmul(sh, Z), zc), ch);
  return cdiv(num, den);
}

/** 管の階段（長さ・半径の列）。入口から順に */
export interface Steps {
  len: Float64Array;
  rad: Float64Array;
  /** 開口の半径 */
  end: number;
}

/** 折れ線を刻み dx の円筒の列にする（各円筒の半径は中点の値） */
function stepsOf(p: { x: Float64Array; r: Float64Array }, dx: number, len: number[], rad: number[]) {
  const x0 = p.x[0],
    L = p.x[p.x.length - 1] - x0;
  /* 折れ線の節点を境にし、その間を dx 以下に分ける */
  for (let i = 0; i + 1 < p.x.length; i++) {
    const a = p.x[i],
      b = p.x[i + 1];
    if (b - a <= 0) continue;
    const n = Math.max(1, Math.ceil((b - a) / dx));
    for (let j = 0; j < n; j++) {
      const xm = a + ((j + 0.5) * (b - a)) / n;
      len.push((b - a) / n);
      rad.push(radiusAt(p, xm));
    }
  }
  return L;
}

/** 指使いの円筒部の長さ extra [m] を足した、管全体の階段 */
export function boreSteps(p: Profile, extra = 0, dx = 5e-4): Steps {
  const len: number[] = [],
    rad: number[] = [];
  stepsOf(p.head, dx, len, rad);
  len.push(p.cylLen + extra);
  rad.push(p.cylR);
  stepsOf(p.tail, dx, len, rad);
  return { len: Float64Array.from(len), rad: Float64Array.from(rad), end: p.bellR };
}

/** 入口（カップの縁の面）の入力インピーダンス [Pa·s/m³]。複素数 */
export function inputImpedance(air: Air, s: Steps, f: number): C {
  let Z = radImpedance(air, f, s.end);
  for (let i = s.len.length - 1; i >= 0; i--) Z = through(air, f, s.rad[i], s.len[i], Z);
  return Z;
}

/** 入口の圧力に対する開口の体積流量（Z_in で割る前の伝達）: U_end / p_in */
export function transfer(air: Air, s: Steps, f: number): C {
  /* 開口で U = 1 として、入口へ向かって (p, U) を運ぶ */
  const Zr = radImpedance(air, f, s.end);
  let p: C = Zr,
    U: C = [1, 0];
  for (let i = s.len.length - 1; i >= 0; i--) {
    const { zc, g } = lossyTube(air, f, s.rad[i]),
      L = s.len[i],
      e1 = cexp([g[0] * L, g[1] * L]),
      e2 = cexp([-g[0] * L, -g[1] * L]),
      ch: C = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2],
      sh: C = [(e1[0] - e2[0]) / 2, (e1[1] - e2[1]) / 2];
    const np = cadd(cmul(ch, p), cmul(cmul(zc, sh), U)),
      nU = cadd(cdiv(cmul(sh, p), zc), cmul(ch, U));
    p = np;
    U = nU;
  }
  return cdiv([1, 0], p);
}

/** インピーダンスの山: 周波数 [Hz]、大きさ、Q（−3 dB の幅から） */
export interface Peak {
  f: number;
  z: number;
  q: number;
}
export function peaksOf(f: Float64Array, z: Float64Array): Peak[] {
  const out: Peak[] = [],
    df = f[1] - f[0];
  for (let i = 1; i + 1 < z.length; i++) {
    if (!(z[i] > z[i - 1] && z[i] >= z[i + 1])) continue;
    const y0 = Math.log(z[i - 1]),
      y1 = Math.log(z[i]),
      y2 = Math.log(z[i + 1]),
      dd = y0 - 2 * y1 + y2,
      d = dd !== 0 ? (0.5 * (y0 - y2)) / dd : 0,
      fp = f[i] + d * df,
      zp = Math.exp(y1 - 0.25 * (y0 - y2) * d),
      half = zp / Math.SQRT2;
    let j = i,
      k = i;
    while (j > 0 && z[j] > half) j--;
    while (k < z.length - 1 && z[k] > half) k++;
    let q = Number.NaN;
    if (j > 0 && k < z.length - 1) {
      const fl = f[j] + ((half - z[j]) / (z[j + 1] - z[j])) * df,
        fh = f[k - 1] + ((half - z[k - 1]) / (z[k] - z[k - 1])) * df;
      q = fp / (fh - fl);
    }
    out.push({ f: fp, z: zp, q });
  }
  return out;
}

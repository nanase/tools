/**
 * 星の動きの計算（DOM に依存しない）。星は太陽から見て等速の直線で動くとし、年 y の向きと等級を出す。
 * 位置は J2000 の平均赤道と分点の直交座標 [pc]、速度は [pc/千年]
 */
import { ltpPole } from '../../lib/astro/ltp';
import type { Vec3 } from '../../lib/astro/vec';
import { BV_Q, FAR, MAG_Q, MAG0, REC, V_Q } from './format';

export const NOW = 2026;
/** 年のバーの範囲 */
export const Y_SPAN = 100000;
export const YMIN = NOW - Y_SPAN;
export const YMAX = NOW + Y_SPAN;
const D = Math.PI / 180;
/** 1 km/s を pc/千年 で */
export const KMS = 1.0227121650537077e-3;
/** 1 pc を光年で */
export const LY = 3.261563777;

export interface Stars {
  n: number;
  /** J2000 の位置 [pc] */
  p: Float64Array;
  /** 速度 [pc/千年] */
  v: Float64Array;
  /** 今の距離 [pc]（分からない星は FAR） */
  d: Float64Array;
  /** 距離が分かるか */
  known: Uint8Array;
  mag: Float32Array;
  bv: Float32Array;
  con: Uint8Array;
}

/** stars.bin を読む */
export function decode(buf: ArrayBuffer): Stars {
  const dv = new DataView(buf),
    n = Math.floor(buf.byteLength / REC);
  const s: Stars = {
    n,
    p: new Float64Array(n * 3),
    v: new Float64Array(n * 3),
    d: new Float64Array(n),
    known: new Uint8Array(n),
    mag: new Float32Array(n),
    bv: new Float32Array(n),
    con: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const o = i * REC,
      ra = (dv.getUint16(o, true) / 65536) * 2 * Math.PI,
      de = (dv.getInt16(o + 2, true) / 32767) * (Math.PI / 2),
      dq = dv.getUint16(o + 6, true),
      d = dq ? 10 ** ((dq / 65535) * 4) : FAR;
    const u = [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)];
    s.mag[i] = MAG0 + dv.getUint8(o + 4) * MAG_Q;
    s.bv[i] = dv.getInt8(o + 5) * BV_Q;
    s.d[i] = d;
    s.known[i] = dq ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      s.p[i * 3 + k] = (u[k] as number) * d;
      s.v[i * 3 + k] = dv.getInt16(o + 8 + k * 2, true) / V_Q;
    }
    s.con[i] = dv.getUint8(o + 14);
  }
  return s;
}

/** 年 y の位置 [pc] */
export function posAt(s: Stars, i: number, y: number): Vec3 {
  const t = (y - 2000) / 1000;
  return [
    s.p[i * 3] + s.v[i * 3] * t,
    s.p[i * 3 + 1] + s.v[i * 3 + 1] * t,
    s.p[i * 3 + 2] + s.v[i * 3 + 2] * t,
  ] as Vec3;
}
/** 年 y の向き（単位ベクトル） */
export function dirAt(s: Stars, i: number, y: number): Vec3 {
  const p = posAt(s, i, y),
    r = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / r, p[1] / r, p[2] / r];
}
/** 年 y の等級（距離の変化だけを見る） */
export function magAt(s: Stars, i: number, y: number): number {
  const p = posAt(s, i, y);
  return (s.mag[i] as number) + 5 * Math.log10(Math.hypot(p[0], p[1], p[2]) / (s.d[i] as number));
}
/** 2 つの向きのなす角 [°] */
export const angDeg = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D;

/**
 * 年 y の全星の向きと等級を out・mag に書く（毎コマ呼ぶので配列を使い回す）
 */
export function fillAt(s: Stars, y: number, out: Float64Array, mag: Float32Array): void {
  const t = (y - 2000) / 1000;
  for (let i = 0; i < s.n; i++) {
    const x = s.p[i * 3] + s.v[i * 3] * t,
      yy = s.p[i * 3 + 1] + s.v[i * 3 + 1] * t,
      z = s.p[i * 3 + 2] + s.v[i * 3 + 2] * t,
      r = Math.hypot(x, yy, z);
    out[i * 3] = x / r;
    out[i * 3 + 1] = yy / r;
    out[i * 3 + 2] = z / r;
    mag[i] = (s.mag[i] as number) + 5 * Math.log10(r / (s.d[i] as number));
  }
}

/** 年 y の天の北極（J2000 の座標） */
export const poleAt = (y: number): Vec3 => ltpPole(y);

/** 速さを視線方向（近づくと負）と横向きに分ける [km/s] */
export function speeds(p: Vec3, v: Vec3): { vr: number; vt: number } {
  const r = Math.hypot(p[0], p[1], p[2]),
    u = [p[0] / r, p[1] / r, p[2] / r] as Vec3,
    vr = v[0] * u[0] + v[1] * u[1] + v[2] * u[2],
    vt = Math.hypot(v[0] - vr * u[0], v[1] - vr * u[1], v[2] - vr * u[2]);
  return { vr: vr / KMS, vt: vt / KMS };
}

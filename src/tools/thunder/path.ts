/**
 * 雷鳴のページの伝わり方（DOM に依存しない）: 放電路を短い要素に分け、要素ごとに聞き手までの距離と届く時刻を求める。
 * 地面と山（鉛直の崖）での反射は鏡像で、気温の勾配で音が上へ曲がる影の領域（Fleagle 1949）は届く範囲の判定で扱う
 */
import { AIR0, type Air, soundSpeed } from '../../lib/air';
import type { Branch } from './channel';
import { airDensity, ETA0, lineAmp, nDuration, nDuration0, P0, STRETCH0, type Stretch } from './shock';

/** 届く経路: 直接・地面・山・地面と山 */
export enum Via {
  Direct = 0,
  Ground = 1,
  Hill = 2,
  Both = 3,
}

export interface Scene {
  /** 落雷点から聞き手までの水平距離 [m]（聞き手は +x） */
  dist: number;
  /** 聞き手の耳の高さ [m] */
  ear: number;
  air: Air;
  /** 地面の音圧の反射率（0 で反射なし、1 で硬い地面） */
  ground: number;
  /** 聞き手の後ろの山（x = dist + hillBack に立つ鉛直の崖）。hillH = 0 で山なし */
  hillBack: number;
  hillH: number;
  /** 山の音圧の反射率 */
  hill: number;
  /** 気温の減り方 [K/km]。0 で音は曲がらない */
  lapse: number;
  /** 影の領域での減衰 [dB] */
  shadowDb: number;
  stretch: Stretch;
  /** 放電路のエネルギーのうち音になる割合 */
  eta: number;
}

/** 既定（仮） */
export const SCENE0: Scene = {
  dist: 3000,
  ear: 1.5,
  air: AIR0,
  ground: 1,
  hillBack: 1500,
  hillH: 0,
  hill: 0.8,
  lapse: 6.5,
  shadowDb: 25,
  stretch: STRETCH0,
  eta: ETA0,
};

/**
 * 要素の長さを、その距離の N 波の波長の何分の 1 にするか。波形は要素の N 波を隣との間隔の幅にならして足すので、
 * 4 で 64 に細かくしたときとスペクトルが 1 dB 以内で合う（300 m 先の 8 kHz まで）
 */
const PER_WAVE = 4;

/**
 * 要素の一覧。区間（折れ線の隣り合う頂点の間）ごとに並ぶ。
 * seg[k] は区間 k の要素の範囲 [start, end)、segT[k]・segR[k] はその区間の N 波の継続時間と代表の距離
 */
export interface Elements {
  n: number;
  /** 届く時刻 [s]（最初に光った時刻が 0） */
  t: Float64Array;
  /** 経路の長さ [m] */
  r: Float64Array;
  /** 正の山の高さ [Pa] */
  p: Float64Array;
  /** 要素の長さ [m] */
  dl: Float64Array;
  /** 要素の中点 x, y, z [m] */
  xyz: Float64Array;
  via: Uint8Array;
  /** 枝の番号（0 が本流） */
  br: Uint16Array;
  nSeg: number;
  segStart: Uint32Array;
  segEnd: Uint32Array;
  segT: Float64Array;
  segR: Float64Array;
  segVia: Uint8Array;
}

/** 曲がりの半径 R = 2T/Γ [m]（音速 ∝ √T、気温が高さ 1 m で Γ [K] 下がるとき） */
export const bendRadius = (tC: number, lapse: number): number =>
  lapse <= 0 ? Number.POSITIVE_INFINITY : (2 * (tC + 273.15)) / (lapse / 1000);

/** 高さ z の音が地面の高さ h の聞き手まで届く最も遠い水平距離 [m]: √(2Rz) + √(2Rh) */
export const audibleRange = (z: number, h: number, R: number): number =>
  Math.sqrt(2 * R * Math.max(z, 0)) + Math.sqrt(2 * R * Math.max(h, 0));

/** 鏡像: 経路ごとに点を映す */
function image(x: number, y: number, z: number, via: Via, xm: number): [number, number, number] {
  return [via & 2 ? 2 * xm - x : x, y, via & 1 ? -z : z];
}

/**
 * 放電路の要素を作り、聞き手に届く時刻と山の高さを求める。
 * 山がなければ山の経路は作らない。山の経路は、反射点が崖の高さより下にあるときだけ
 */
export function elements(ch: readonly Branch[], s: Scene): Elements {
  const c = soundSpeed(s.air.t),
    p0 = (s.air.p ?? P0 / 1000) * 1000,
    rho = airDensity(s.air.t, p0),
    R = bendRadius(s.air.t, s.lapse),
    xm = s.dist + s.hillBack,
    ox = s.dist,
    oz = s.ear,
    vias: Via[] = [Via.Direct];
  if (s.ground > 0) vias.push(Via.Ground);
  if (s.hillH > 0 && s.hill > 0) {
    vias.push(Via.Hill);
    if (s.ground > 0) vias.push(Via.Both);
  }
  const T: number[] = [],
    Rr: number[] = [],
    P: number[] = [],
    DL: number[] = [],
    X: number[] = [],
    V: number[] = [],
    B: number[] = [],
    ss: number[] = [],
    se: number[] = [],
    sT: number[] = [],
    sR: number[] = [],
    sV: number[] = [];
  ch.forEach((b, bi) => {
    const T0 = nDuration0(b.e, c, p0),
      t0 = b.t,
      amp = lineAmp(b.e, s.eta, rho),
      q = b.p;
    for (let k = 3; k < q.length; k += 3) {
      const ax = q[k - 3],
        ay = q[k - 2],
        az = q[k - 1],
        dx = q[k] - ax,
        dy = q[k + 1] - ay,
        dz = q[k + 2] - az,
        L = Math.hypot(dx, dy, dz);
      if (L <= 0) continue;
      for (const via of vias) {
        const coef = (via & 1 ? s.ground : 1) * (via & 2 ? s.hill : 1),
          [mx, my, mz] = image(ax + dx / 2, ay + dy / 2, az + dz / 2, via, xm),
          rMid = Math.hypot(mx - ox, my, mz - oz),
          Tm = nDuration(T0, rMid, s.stretch),
          /* 要素は N 波の波長の 1/PER_WAVE より短くする */
          n = Math.max(1, Math.ceil(L / ((c * Tm) / PER_WAVE))),
          dl = L / n,
          start = T.length;
        for (let e = 0; e < n; e++) {
          const u = (e + 0.5) / n,
            x = ax + u * dx,
            y = ay + u * dy,
            z = az + u * dz,
            [ix, iy, iz] = image(x, y, z, via, xm);
          /* 山の経路は、崖を横切る点が崖の高さより下のときだけ */
          if (via & 2) {
            const w = (xm - ix) / (ox - ix),
              zc = iz + w * (oz - iz);
            if (Math.abs(zc) > s.hillH) continue;
          }
          const r = Math.hypot(ix - ox, iy, iz - oz),
            Tn = nDuration(T0, r, s.stretch),
            /* 影の領域: 鏡像から聞き手への水平距離が届く範囲を超えた分だけ、範囲の 1 割で shadowDb まで下げる */
            hd = Math.hypot(ix - ox, iy),
            lim = audibleRange(z, oz, R),
            over = Number.isFinite(lim) ? Math.min(1, Math.max(0, (hd - lim) / (0.1 * lim))) : 0,
            sh = 10 ** ((-s.shadowDb * over) / 20);
          T.push(t0 + r / c);
          Rr.push(r);
          /* 正の側の面積 a·dl/(2r) を保って伸びる */
          P.push((coef * amp * dl * sh) / (Math.max(r, 1) * Tn));
          DL.push(dl);
          X.push(x, y, z);
          V.push(via);
          B.push(bi);
        }
        if (T.length > start) {
          ss.push(start);
          se.push(T.length);
          sT.push(Tm);
          sR.push(rMid);
          sV.push(via);
        }
      }
    }
  });
  return {
    n: T.length,
    t: Float64Array.from(T),
    r: Float64Array.from(Rr),
    p: Float64Array.from(P),
    dl: Float64Array.from(DL),
    xyz: Float64Array.from(X),
    via: Uint8Array.from(V),
    br: Uint16Array.from(B),
    nSeg: ss.length,
    segStart: Uint32Array.from(ss),
    segEnd: Uint32Array.from(se),
    segT: Float64Array.from(sT),
    segR: Float64Array.from(sR),
    segVia: Uint8Array.from(sV),
  };
}

/** 最初に届く時刻 [s]（直接の経路） */
export function firstArrival(el: Elements): number {
  let t = Number.POSITIVE_INFINITY;
  for (let i = 0; i < el.n; i++) if (el.via[i] === Via.Direct && el.t[i] < t) t = el.t[i];
  return t;
}

/**
 * 届く時刻の分布: 幅 dt [s] の箱ごとに、届く N 波の山の高さの和 [Pa]（経路ごと）。
 * 山の高さは要素の長さに比例するので、和は要素の分け方に依らない。
 * 放電路が聞き手から見て横を向く所は、多くの要素が同時に届いて高くなる。
 * 戻り値の h[via][k] は時刻 t0 + k·dt からの箱
 */
export function arrivalHistogram(el: Elements, t0: number, t1: number, dt: number): Float64Array[] {
  const nb = Math.max(1, Math.ceil((t1 - t0) / dt)),
    h = [0, 1, 2, 3].map(() => new Float64Array(nb));
  for (let i = 0; i < el.n; i++) {
    const k = Math.floor((el.t[i] - t0) / dt);
    if (k >= 0 && k < nb) h[el.via[i]][k] += el.p[i];
  }
  return h;
}

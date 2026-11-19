/**
 * 場面（写真の中身）と、光を当てて写す計算。
 * 場面は設計座標 800 × 500 の関数で、点ごとに材質・明るさ（陰影）・鏡面の光を返す。画素ごとに 2 × 2 の点で呼び、平均する。
 * 写す（shoot）は、材質ごとの RAW を先に求め、画素では陰影を掛けて足すだけにする。
 * 光は 2 つまで混ぜられ、画素ごとの重み（Scene.w）で決める
 */
import { arr, enc, flat, KX, NM, ONE, rawOf, type Spec, smoothFit, type Vec3 } from './spectrum';

/** 設計座標の大きさ */
export const DW = 800,
  DH = 500;

/** 点の材質（M の番号）・明るさ・鏡面の光 */
export interface Out {
  id: number;
  sh: number;
  sp: number;
}
/** 材質の反射率: 数値は全波長で同じ、[r, g, b] は昼光で見た sRGB、関数は波長 [nm] → 反射率 */
export type Mat = number | readonly [number, number, number] | ((l: number) => number) | Spec;

export interface Scene {
  id: string;
  /** 選択肢に出す名前 */
  name: string;
  /** スポイトの初めの位置（白か灰の物の上） */
  pick: readonly [number, number];
  /** 結果に出す白い所 [x, y, 名前]。光が 2 つの場面は 2 つ */
  refs?: readonly (readonly [number, number, string])[];
  /** 光 2 つの場面の光 1・光 2 の初めの選択（L0S の鍵） */
  lights?: readonly [string, string];
  mats: Readonly<Record<string, Mat>>;
  /** 光る材質 → 光の番号（0・1） */
  emit?: Readonly<Record<string, 0 | 1>>;
  f(o: Out, x: number, y: number, M: Readonly<Record<string, number>>): void;
  /** 光が 2 つの場面だけ。点に届く光 1・光 2 の強さ */
  w?(x: number, y: number): readonly [number, number];
}

/* ---------- 形の補助 ---------- */

/** 光の向き（左上の手前から） */
export const LD: Vec3 = (() => {
  const l: Vec3 = [-0.45, -0.55, 0.7],
    n = Math.hypot(...l);
  return [l[0] / n, l[1] / n, l[2] / n];
})();
/** 鏡面の向き（光と視線の中間） */
export const HV: Vec3 = (() => {
  const h: Vec3 = [LD[0], LD[1], LD[2] + 1],
    n = Math.hypot(...h);
  return [h[0] / n, h[1] / n, h[2] / n];
})();
/** 球（楕円体）。中にあれば o に書いて true */
export function sph(o: Out, x: number, y: number, cx: number, cy: number, rx: number, ry: number, id: number): boolean {
  const nx = (x - cx) / rx,
    ny = (y - cy) / ry,
    q = nx * nx + ny * ny;
  if (q >= 1) return false;
  const nz = Math.sqrt(1 - q);
  o.id = id;
  o.sh = 0.14 + 0.86 * Math.max(0, nx * LD[0] + ny * LD[1] + nz * LD[2]);
  o.sp = 0.55 * Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]) ** 70;
  return true;
}
export const inEl = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
/** 時計回りの四角形の内側 */
export function inQuad(x: number, y: number, P: readonly (readonly [number, number])[]): boolean {
  for (let i = 0; i < 4; i++) {
    const a = P[i] as readonly [number, number],
      b = P[(i + 1) % 4] as readonly [number, number];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}
/** 木目の明暗 */
export const grain = (x: number, y: number): number =>
  1 + 0.05 * Math.sin(x * 0.05 + 2.2 * Math.sin(y * 0.06) + y * 0.02);
/** 0〜1 の決まった乱数 */
export const hash = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * 場面の中身を dy だけ上へずらす（写真の下端に重ねたボタンに、手前の物が隠れないように）。
 * 上端からはみ出した分は切れ、下端には場面の続き（床や机）が見える
 */
export function lift(S: Scene, dy: number): Scene {
  const w = S.w;
  return {
    ...S,
    pick: [S.pick[0], S.pick[1] - dy],
    refs: S.refs?.map(([x, y, n]) => [x, y - dy, n] as const),
    f: (o, x, y, M) => S.f(o, x, y + dy, M),
    w: w ? (x, y) => w(x, y + dy) : undefined,
  };
}

/* ---------- 場面を画素に ---------- */

export function matOf(d: Mat): Spec {
  if (typeof d === 'number') return flat(d);
  if (d instanceof Float64Array) return d;
  if (typeof d === 'function') return arr((l) => Math.min(0.99, Math.max(0.005, d(l))));
  return smoothFit(d as readonly [number, number, number]);
}

export interface SceneData {
  W: number;
  H: number;
  NP: number;
  /** 2 × 2 の点ごとの材質・明るさ・鏡面 */
  ID: Uint8Array;
  SH: Float32Array;
  SP: Float32Array;
  /** 画素ごとの光 1・光 2 の重み */
  W0: Float32Array;
  W1: Float32Array;
  /** 材質ごとの光る番号（−1 は光らない） */
  EM: Int8Array;
  mats: Spec[];
  two: boolean;
}

const OFF = [0.25, 0.75] as const;

/** 場面を画素の表にする。重いので、rows ごとに中断できる生成器にする（client が少しずつ進める） */
export function* sceneRows(S: Scene, W: number, H: number, rows = 8): Generator<number, SceneData> {
  const names = Object.keys(S.mats),
    M: Record<string, number> = {};
  names.forEach((m, i) => {
    M[m] = i;
  });
  const NP = W * H,
    sc = DW / W,
    d: SceneData = {
      W,
      H,
      NP,
      ID: new Uint8Array(NP * 4),
      SH: new Float32Array(NP * 4),
      SP: new Float32Array(NP * 4),
      W0: new Float32Array(NP),
      W1: new Float32Array(NP),
      EM: new Int8Array(names.length).fill(-1),
      mats: names.map((n) => matOf(S.mats[n] as Mat)),
      two: !!S.w,
    };
  if (S.emit) for (const [k, v] of Object.entries(S.emit)) d.EM[M[k] as number] = v;
  const o: Out = { id: 0, sh: 0, sp: 0 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      for (let k = 0; k < 4; k++) {
        o.id = 0;
        o.sh = 0;
        o.sp = 0;
        S.f(o, (x + (OFF[k & 1] as number)) * sc, (y + (OFF[k >> 1] as number)) * sc, M);
        d.ID[p * 4 + k] = o.id;
        d.SH[p * 4 + k] = o.sh;
        d.SP[p * 4 + k] = o.sp;
      }
      if (S.w) {
        const w = S.w((x + 0.5) * sc, (y + 0.5) * sc);
        d.W0[p] = w[0];
        d.W1[p] = w[1];
      } else d.W0[p] = 1;
    }
    if ((y + 1) % rows === 0) yield (y + 1) / H;
  }
  return d;
}
/** 場面を一度に画素の表にする（試験用） */
export function sceneData(S: Scene, W = DW, H = DH): SceneData {
  const g = sceneRows(S, W, H, H);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** 写した結果: RAW と、画素ごとに当たっている光の白の RAW、露出 */
export interface Shot {
  raw: Float32Array;
  wh: Float32Array;
  /** 光の当たる強さ（光る物を除く）の 90 % 点で決めた露出 */
  expo: number;
}

/** 光 E0（と E1 を lp 倍）を当てて写す */
export function shoot(d: SceneData, E0: Spec, E1: Spec | null = null, lp = 1): Shot {
  const { NP, ID, SH, SP, W0, W1, EM } = d,
    nm = d.mats.length,
    O0 = new Float64Array(nm * 3),
    O1 = new Float64Array(nm * 3);
  d.mats.forEach((r, i) => {
    O0.set(rawOf(r, E0), i * 3);
    if (E1) O1.set(rawOf(r, E1), i * 3);
  });
  const w0 = rawOf(ONE, E0),
    w1: Vec3 = E1 ? rawOf(ONE, E1) : [0, 0, 0];
  const raw = new Float32Array(NP * 3),
    wh = new Float32Array(NP * 3);
  for (let p = 0; p < NP; p++) {
    const a = W0[p] as number,
      b = E1 ? (W1[p] as number) * lp : 0;
    let r = 0,
      g = 0,
      bl = 0;
    for (let k = 0; k < 4; k++) {
      const s = p * 4 + k,
        id = ID[s] as number,
        sh = SH[s] as number,
        e = EM[id] as number;
      if (e === 0) {
        r += sh * w0[0];
        g += sh * w0[1];
        bl += sh * w0[2];
      } else if (e === 1) {
        r += sh * w1[0];
        g += sh * w1[1];
        bl += sh * w1[2];
      } else {
        const sp = SP[s] as number,
          j = id * 3;
        r += sh * (a * (O0[j] as number) + b * (O1[j] as number)) + sp * (a * w0[0] + b * w1[0]);
        g += sh * (a * (O0[j + 1] as number) + b * (O1[j + 1] as number)) + sp * (a * w0[1] + b * w1[1]);
        bl += sh * (a * (O0[j + 2] as number) + b * (O1[j + 2] as number)) + sp * (a * w0[2] + b * w1[2]);
      }
    }
    raw[p * 3] = r / 4;
    raw[p * 3 + 1] = g / 4;
    raw[p * 3 + 2] = bl / 4;
    const e0 = EM[ID[p * 4] as number] as number,
      q = p * 3;
    const lit: Vec3 =
      e0 === 0 ? w0 : e0 === 1 ? w1 : [a * w0[0] + b * w1[0], a * w0[1] + b * w1[1], a * w0[2] + b * w1[2]];
    wh[q] = lit[0];
    wh[q + 1] = lit[1];
    wh[q + 2] = lit[2];
  }
  /* 露出: 決まった間隔で拾った画素の光の強さの 90 % 点 */
  const smp: number[] = [];
  for (let p = 0; p < NP; p += 97) if ((EM[ID[p * 4] as number] as number) < 0) smp.push(wh[p * 3 + 1] as number);
  smp.sort((x, y) => x - y);
  const ref = smp.length ? (smp[Math.floor(smp.length * 0.9)] as number) : w0[1];
  return { raw, wh, expo: 1 / ref };
}

/** 白の RAW からゲイン（G を 1 として） */
export const gainsFrom = (S: readonly number[]): Vec3 => [
  (S[1] as number) / (S[0] as number),
  1,
  (S[1] as number) / (S[2] as number),
];
/** 色かぶり補正（+ で緑を弱める）を G のゲインへ */
export const tintGain = (tint: number): number => Math.exp(-tint * 0.006);

/**
 * 現像して RGBA に書く。g はゲイン（null なら画素ごとに当たっている光に合わせる）
 */
export function develop(out: Uint8ClampedArray, shot: Shot, g: readonly number[] | null, tint: number): void {
  const { raw, wh } = shot,
    NP = raw.length / 3,
    t = tintGain(tint),
    ex = shot.expo * KX,
    [[a, b, c], [d, e, f], [h, i, j]] = NM;
  for (let p = 0; p < NP; p++) {
    const q = p * 3;
    let gr: number, gb: number;
    if (g) {
      gr = g[0] as number;
      gb = g[2] as number;
    } else {
      gr = (wh[q + 1] as number) / (wh[q] as number);
      gb = (wh[q + 1] as number) / (wh[q + 2] as number);
    }
    const R = (raw[q] as number) * gr * ex,
      G = (raw[q + 1] as number) * ex * t,
      B = (raw[q + 2] as number) * gb * ex;
    out[p * 4] = enc(a * R + b * G + c * B);
    out[p * 4 + 1] = enc(d * R + e * G + f * B);
    out[p * 4 + 2] = enc(h * R + i * G + j * B);
    out[p * 4 + 3] = 255;
  }
}

/** 写真全体の RAW の平均（グレーワールド） */
export function meanRaw(shot: Shot): Vec3 {
  const r = shot.raw,
    n = r.length / 3;
  let s0 = 0,
    s1 = 0,
    s2 = 0;
  for (let p = 0; p < n; p++) {
    s0 += r[p * 3] as number;
    s1 += r[p * 3 + 1] as number;
    s2 += r[p * 3 + 2] as number;
  }
  return [s0 / n, s1 / n, s2 / n];
}
/** 最も明るい 0.5 % の画素の RAW の平均と、その重心 */
export function brightest(shot: Shot, W: number): { S: Vec3; at: [number, number] } {
  const r = shot.raw,
    n = r.length / 3,
    L = new Float32Array(n);
  for (let p = 0; p < n; p++) L[p] = (r[p * 3] as number) + (r[p * 3 + 1] as number) + (r[p * 3 + 2] as number);
  const th = Float32Array.from(L).sort()[Math.floor(n * 0.995)] as number;
  const S: Vec3 = [0, 0, 0];
  let k = 0,
    cx = 0,
    cy = 0;
  for (let p = 0; p < n; p++)
    if ((L[p] as number) >= th) {
      S[0] += r[p * 3] as number;
      S[1] += r[p * 3 + 1] as number;
      S[2] += r[p * 3 + 2] as number;
      k++;
      cx += p % W;
      cy += Math.floor(p / W);
    }
  return { S: [S[0] / k, S[1] / k, S[2] / k], at: [cx / k, cy / k] };
}
/** 点のまわり（半径 rad 画素）の RAW の平均 */
export function rawAt(shot: Shot, W: number, H: number, x: number, y: number, rad = 3): Vec3 {
  const s: Vec3 = [0, 0, 0];
  let n = 0;
  for (let dy = -rad; dy <= rad; dy++)
    for (let dx = -rad; dx <= rad; dx++) {
      const X = Math.round(x + dx),
        Y = Math.round(y + dy);
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const q = (Y * W + X) * 3;
      s[0] += shot.raw[q] as number;
      s[1] += shot.raw[q + 1] as number;
      s[2] += shot.raw[q + 2] as number;
      n++;
    }
  return [s[0] / n, s[1] / n, s[2] / n];
}
/** 点に当たっている光の白の RAW */
export function whAt(shot: Shot, W: number, x: number, y: number): Vec3 {
  const q = (Math.round(y) * W + Math.round(x)) * 3;
  return [shot.wh[q] as number, shot.wh[q + 1] as number, shot.wh[q + 2] as number];
}

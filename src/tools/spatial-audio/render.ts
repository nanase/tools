/**
 * 立体音響の音を作る（DOM に依存しない。worklet.ts が使う）。
 * 音源ごとに直接音と鏡像の音源（model.ts の images）を 1 本ずつの「道」にし、道ごとに両耳の
 * 遅れ（道のりの差＋両耳間時間差）・距離による減衰と空気の吸収・頭の陰のフィルタ・耳介の反射（直接音だけ）・
 * 反射面の高い音の減衰を掛けて足す。
 * その後の残響は 8 本の遅延線のフィードバック網（Jot・Chaigne 1991）で作り、左右で別の組み合わせを出す
 */
import { AirFilter, airPole } from '../../lib/air';
import {
  CS,
  type Cues,
  clamp,
  earModel,
  HEAD_A,
  type Late,
  type Listener,
  MIN_R,
  type Obstacle,
  OCC_FLOOR,
  PIN_R,
  type Place,
  paths,
  TAU,
  toHead,
  unit,
  type Vec3,
} from './model';

export type Mode = 'hrtf' | 'pan' | 'mono';
/** 鳴らす音源: key は置いた音源ごとの番号（動かしても鳴らし直さない） */
export interface VoiceSpec {
  key: number;
  sound: string;
  x: number;
  y: number;
  /** 1 m 先の大きさ（倍率） */
  gain: number;
}
export interface SceneSpec {
  srcs: readonly VoiceSpec[];
  lis: Listener;
  place: Place;
  obs: readonly Obstacle[];
  mode: Mode;
  cues: Cues;
}

/** 録音: くり返す波形と、大きさをそろえる係数 */
export interface Clip {
  data: Float32Array;
  gain: number;
}

const RING = 1 << 16,
  MASK = RING - 1;
/** 道のりの遅れの上限 [s]（リングの長さに収める） */
const MAX_LAG = (RING - 64) / 48000 / 2;

interface EarState {
  side: -1 | 1;
  dl: number;
  dt: number;
  alpha: number;
  at: number;
  taps: number[];
  tt: number[];
  pin: number;
  pinT: number;
  rear: number;
  rearT: number;
  lp: number;
  /** 反射面の低域通過の係数と状態 */
  ac: number;
  al: number;
  x1: number;
  y1: number;
  g: number;
  gt: number;
  b0: number;
  b1: number;
  a1: number;
  fresh: boolean;
  /** 障害物で遮られた音の低域通過の係数と状態 */
  oc: number;
  ol: number;
  /** 距離による空気の吸収 */
  air: AirFilter;
}
const newEar = (side: -1 | 1): EarState => ({
  side,
  dl: 0,
  dt: 0,
  alpha: 1,
  at: 1,
  taps: [0, 0, 0, 0, 0],
  tt: [0, 0, 0, 0, 0],
  pin: 0,
  pinT: 0,
  rear: 0,
  rearT: 0,
  lp: 0,
  ac: 1,
  al: 0,
  x1: 0,
  y1: 0,
  g: 0,
  gt: 0,
  b0: 1,
  b1: 0,
  a1: 0,
  fresh: true,
  oc: 1,
  ol: 0,
  air: new AirFilter(),
});

interface Voice {
  key: number;
  sound: string;
  pos: number;
  ring: Float32Array;
  w: number;
  /** 道ごとの両耳の状態（鍵は model.ts の paths の key） */
  paths: Map<string, EarState[]>;
  spec: VoiceSpec;
  /** 消すところ（音を絞ってから外す） */
  dying: boolean;
  fade: number;
}

/** 8 本の遅延線（標本数は 48 kHz のとき。互いに素） */
const LEN0 = [1031, 1327, 1523, 1871, 2053, 2311, 2647, 2953];
class Fdn {
  private readonly bufs: Float32Array[];
  private readonly idx: number[];
  private readonly lp: number[];
  private readonly g: number[];
  private readonly c: number;
  private readonly pre: Float32Array;
  private readonly preN: number;
  private pw = 0;
  private readonly o = new Float64Array(8);
  constructor(
    fs: number,
    readonly late: Late,
  ) {
    const lens = LEN0.map((n) => Math.max(8, Math.round((n * late.size * fs) / 48000)));
    this.bufs = lens.map((n) => new Float32Array(n));
    this.idx = lens.map(() => 0);
    this.lp = lens.map(() => 0);
    /* 1 周で残響時間に見合うだけ減らす */
    this.g = lens.map((n) => 10 ** ((-3 * n) / (fs * late.t60)));
    this.c = 1 - Math.exp((-TAU * late.fc) / fs);
    this.preN = Math.max(1, Math.round(late.pre * fs));
    this.pre = new Float32Array(this.preN + 1);
  }
  /** 入力 x の 1 標本を入れ、左右の出力を out に書く */
  step(x: number, out: [number, number]): void {
    const { bufs, idx, lp, g, o } = this;
    this.pre[this.pw] = x;
    this.pw = (this.pw + 1) % this.pre.length;
    const xin = this.pre[this.pw];
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      lp[i] += (bufs[i][idx[i]] - lp[i]) * this.c;
      o[i] = lp[i] * g[i];
      sum += o[i];
    }
    /* ハウスホルダー行列で混ぜて戻す */
    const h = sum / 4;
    let l = 0,
      r = 0;
    for (let i = 0; i < 8; i++) {
      bufs[i][idx[i]] = o[i] - h + xin * (i & 1 ? 0.35 : -0.35);
      idx[i] = (idx[i] + 1) % bufs[i].length;
      if (i < 4) l += i & 1 ? -o[i] : o[i];
      else r += i & 1 ? o[i] : -o[i];
    }
    out[0] = l * 0.5;
    out[1] = r * 0.5;
  }
}

export class Binaural {
  private readonly clips = new Map<string, Clip>();
  private voices: Voice[] = [];
  private scene: SceneSpec | null = null;
  private fdn: Fdn | null = null;
  private readonly K: number;
  private readonly B = (2 * CS) / HEAD_A;
  private readonly cRear: number;
  /** 補間の速さ（1 標本あたり） */
  private readonly sm: number;
  constructor(readonly fs: number) {
    this.K = 2 * fs;
    this.cRear = 1 - Math.exp((-TAU * 2500) / fs);
    this.sm = 1 - Math.exp(-1 / (0.012 * fs));
  }

  setClip(id: string, clip: Clip): void {
    this.clips.set(id, clip);
  }
  has(id: string): boolean {
    return this.clips.has(id);
  }

  setScene(s: SceneSpec): void {
    const late = s.place.late;
    if (JSON.stringify(late) !== JSON.stringify(this.scene?.place.late ?? null))
      this.fdn = late ? new Fdn(this.fs, late) : null;
    this.scene = s;
    const keep = new Set(s.srcs.map((v) => v.key));
    for (const v of this.voices) if (!keep.has(v.key)) v.dying = true;
    for (const sp of s.srcs) {
      const v = this.voices.find((x) => x.key === sp.key && !x.dying);
      if (v && v.sound === sp.sound) v.spec = sp;
      else {
        if (v) v.dying = true;
        const len0 = this.clips.get(sp.sound)?.data.length ?? 0;
        /* 同じ録音を 2 か所に置いても揃って聞こえないよう、始める位置をずらす */
        this.voices.push({
          key: sp.key,
          sound: sp.sound,
          pos: Math.floor(Math.random() * len0),
          ring: new Float32Array(RING),
          w: 0,
          paths: new Map(),
          spec: sp,
          dying: false,
          fade: 0,
        });
      }
    }
  }

  /** 距離 r [m] の空気の吸収の係数（0.5 m ごとに覚えておく） */
  private readonly airCache = new Map<number, number>();
  private airOf(r: number): number {
    const k = Math.round(r * 2);
    let p = this.airCache.get(k);
    if (p === undefined) {
      p = r < 5 ? 0 : airPole(k / 2, this.fs);
      this.airCache.set(k, p);
    }
    return p;
  }

  /** 道ごとの目標（遅れ・α・強さ）を決める。なくなった道は音を絞ってから外す */
  private targets(v: Voice, s: SceneSpec): void {
    const lis = s.lis,
      ps = paths([v.spec.x, v.spec.y, 0], [lis.x, lis.y, 0], s.place, s.obs),
      keep = new Set(ps.map((q) => q.key));
    for (const [k, ears] of v.paths)
      if (!keep.has(k)) {
        for (const e of ears) e.gt = 0;
        if (ears.every((e) => Math.abs(e.g) < 1e-6)) v.paths.delete(k);
      }
    const p0 = toHead(ps[0].p, lis),
      r0 = Math.max(MIN_R, Math.hypot(...p0));
    for (const q of ps) {
      let ears = v.paths.get(q.key);
      if (!ears) {
        ears = [newEar(-1), newEar(1)];
        v.paths.set(q.key, ears);
      }
      const p = toHead(q.p, lis),
        r = Math.max(MIN_R, Math.hypot(...p)),
        d: Vec3 = unit(p),
        lag = Math.min(MAX_LAG, (r - r0) / CS) * this.fs,
        g = (v.spec.gain * q.g * q.occ.g) / r,
        ac = q.fc ? 1 - Math.exp((-TAU * q.fc) / this.fs) : 1,
        oc = q.occ.fc ? 1 - Math.exp((-TAU * q.occ.fc) / this.fs) : 1,
        air = this.airOf(r),
        direct = q.key === 'd';
      for (const e of ears) {
        e.ac = ac;
        e.oc = oc;
        e.air.p = air;
        if (s.mode !== 'hrtf') {
          const a = s.mode === 'mono' ? Math.PI / 4 : ((clamp(d[0], -1, 1) + 1) * Math.PI) / 4;
          e.dt = lag + (HEAD_A / CS) * this.fs;
          e.at = 1;
          e.pinT = 0;
          e.rearT = 0;
          e.gt = g * (e.side < 0 ? Math.cos(a) : Math.sin(a)) * Math.SQRT2 * 0.8;
        } else {
          const m = earModel(d, e.side, direct ? s.cues : { ...s.cues, pinna: false });
          e.dt = lag + m.delay * this.fs;
          e.at = m.alpha;
          e.gt = g * 0.8;
          if (m.taps) {
            e.pinT = 1;
            for (let k = 0; k < 5; k++) e.tt[k] = (m.taps[k] * this.fs) / 44100;
          } else e.pinT = 0;
          e.rearT = m.rear;
        }
        if (e.fresh) {
          e.dl = e.dt;
          e.alpha = e.at;
          e.pin = e.pinT;
          e.rear = e.rearT;
          e.taps = e.tt.slice();
          e.fresh = false;
        }
      }
    }
  }

  /** n 標本を L・R に書く（足さずに上書き） */
  render(L: Float32Array, R: Float32Array, n: number): void {
    L.fill(0, 0, n);
    R.fill(0, 0, n);
    const s = this.scene;
    if (!s) return;
    const { K, B, sm, cRear } = this,
      fdn = this.fdn,
      bus = fdn ? new Float32Array(n) : null,
      send = fdn ? fdn.late.wet : 0;
    for (const v of this.voices) {
      const clip = this.clips.get(v.sound);
      this.targets(v, s);
      /* 標本ごとの繰り返しで Map をたどらないよう、両耳の状態を配列にしておく */
      const ears = [...v.paths.values()].flat();
      for (const e of ears) {
        e.alpha += (e.at - e.alpha) * 0.3;
        e.pin += (e.pinT - e.pin) * 0.3;
        e.rear += (e.rearT - e.rear) * 0.3;
        for (let q = 0; q < 5; q++) e.taps[q] += (e.tt[q] - e.taps[q]) * 0.3;
        e.b0 = (e.alpha * K + B) / (K + B);
        e.b1 = (B - e.alpha * K) / (K + B);
        e.a1 = (B - K) / (K + B);
      }
      const fadeT = v.dying ? 0 : 1,
        data = clip?.data,
        cg = clip?.gain ?? 0;
      const ring = v.ring;
      for (let i = 0; i < n; i++) {
        v.fade += (fadeT - v.fade) * sm;
        let x = 0;
        if (data) {
          x = data[v.pos] * cg * v.fade;
          if (++v.pos >= data.length) v.pos = 0;
        }
        v.w = (v.w + 1) & MASK;
        ring[v.w] = x;
        if (bus) bus[i] += x * send * v.spec.gain;
        for (const e of ears) {
          e.dl += (e.dt - e.dl) * sm;
          e.g += (e.gt - e.g) * sm;
          let p = v.w - e.dl,
            j = Math.floor(p),
            f = p - j;
          let y = ring[j & MASK] * (1 - f) + ring[(j + 1) & MASK] * f;
          if (e.pin > 0.001) {
            let q = 0;
            for (let k = 0; k < 5; k++) {
              p = v.w - e.dl - e.taps[k];
              j = Math.floor(p);
              f = p - j;
              q += PIN_R[k] * (ring[j & MASK] * (1 - f) + ring[(j + 1) & MASK] * f);
            }
            y += q * e.pin;
          }
          if (e.ac < 1) {
            e.al += (y - e.al) * e.ac;
            y = e.al;
          }
          if (e.oc < 1) {
            e.ol += (y - e.ol) * e.oc;
            y = e.ol * (1 - OCC_FLOOR) + y * OCC_FLOOR;
          }
          if (e.air.p > 0) y = e.air.step(y);
          e.lp += (y - e.lp) * cRear;
          y = y * (1 - e.rear) + e.lp * e.rear;
          const z = e.b0 * y + e.b1 * e.x1 - e.a1 * e.y1;
          e.x1 = y;
          e.y1 = z;
          if (e.side < 0) L[i] += z * e.g;
          else R[i] += z * e.g;
        }
      }
    }
    this.voices = this.voices.filter((v) => !(v.dying && v.fade < 1e-4));
    if (fdn && bus) {
      const o: [number, number] = [0, 0];
      for (let i = 0; i < n; i++) {
        fdn.step(bus[i], o);
        L[i] += o[0];
        R[i] += o[1];
      }
    }
  }
}

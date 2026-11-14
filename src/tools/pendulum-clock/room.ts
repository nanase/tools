/**
 * 箱と部屋の響き（選んだときだけ、出力の前で畳み込む）。
 * 箱: 機械を収めた木の箱の裏板・前板の振動の型と、中の空気のヘルムホルツの共鳴。機械の音が箱を揺らし、箱の板が
 *   空気へ音を出す。小さな部品からじかに出る音は低い音が弱いが、箱の型は 2.5 kHz より下に集まり、低い型ほど Q が
 *   高く長く鳴るので、低い音ほど強く響く（80〜500 Hz でおよそ +20 dB、2.5 kHz より上はほぼ変わらない）。
 *   板の放射効率は一致周波数より下で √(f/fc) とする。
 * 部屋: 共有の残響（lib/reverb.ts、Eyring の式とフィードバック遅延網）にインパルスを通した応答
 */
import { Reverb, type Room, reverbSpec } from '../../lib/reverb';
import { plateModes } from './sfx-tick';

/** 部屋の例（寸法と吸音率はこのツールで選んだ概数）。聴く位置は時計から 2 m */
export const PC_ROOMS: readonly Room[] = [
  { v: 'off', name: 'なし', dim: [0, 0, 0], a: 1, aHi: 1, r: 1 },
  { v: 'living', name: '居間', dim: [5, 4, 2.4], a: 0.3, aHi: 0.38, r: 2 },
  { v: 'hall', name: '広間', dim: [10, 8, 3.5], a: 0.18, aHi: 0.26, r: 2 },
];
export const LISTEN_M = 2;

/** 部屋の応答（左右）。直接音を含む */
export function roomIR(fs: number, v: string): [Float32Array, Float32Array] | null {
  const room = PC_ROOMS.find((r) => r.v === v);
  if (!room || room.v === 'off') return null;
  const spec = reverbSpec(room, LISTEN_M),
    n = Math.round(Math.min(3, spec.t60 * 1.3 + spec.pre + 0.05) * fs),
    L = new Float32Array(n),
    R = new Float32Array(n),
    rv = new Reverb(fs);
  rv.set(spec);
  L[0] = R[0] = 1;
  rv.process(L, R, 0, n);
  return [L, R];
}

/** 木（板の繊維の向きの平均）: ヤング率・密度・ポアソン比・Q */
const WOOD = { E: 1.0e10, rho: 600, nu: 0.3, Q: 30 };
/** 箱の板 [m]: 裏板 230×200×4、前板 260×220×6。中の空気 6.3 L とすき間（ヘルムホルツ 170 Hz、Q 8） */
const PANELS = [
  { a: 0.23, b: 0.2, h: 0.004, w: 1 },
  { a: 0.26, b: 0.22, h: 0.006, w: 0.7 },
];
const HELM = { f: 170, Q: 8, w: 0.5 };
/** 箱の型の音の合計のエネルギーを、機械から直に出る音の何倍にするか */
const CASE_GAIN = 3;

/** 箱の応答: 機械から直に出る音（δ）と、箱の型の減衰する正弦の和 */
export function caseIR(fs: number): Float32Array {
  const n = Math.round(0.5 * fs),
    h = new Float64Array(n),
    modes: { f: number; Q: number; a: number }[] = [];
  for (const p of PANELS) {
    const cL = Math.sqrt(WOOD.E / WOOD.rho),
      fc = (343 * 343) / (1.8 * p.h * cL);
    for (const md of plateModes(p.a, p.b, p.h, WOOD.E, WOOD.rho, WOOD.nu, WOOD.Q, 2500, 8)) {
      /* 中ほどを揺らされ、中ほどで聞く（型の形の積）。放射効率は √(f/fc) */
      const phi = Math.sin((md.m * Math.PI) / 2) * Math.sin((md.n * Math.PI) / 2) * 0.8 + 0.2,
        sig = Math.min(1, Math.sqrt(md.f / fc));
      modes.push({ f: md.f, Q: md.Q, a: p.w * phi * sig });
    }
  }
  modes.push({ f: HELM.f, Q: HELM.Q, a: HELM.w });
  for (const md of modes) {
    const w = (2 * Math.PI * md.f) / fs,
      d = Math.exp(-(Math.PI * md.f) / (md.Q * fs));
    let e = md.a;
    for (let i = 0; i < n && e > 1e-6 * md.a; i++) {
      h[i] += e * Math.sin(w * i);
      e *= d;
    }
  }
  /* 型の音のエネルギーを、直に出る音（1）の CASE_GAIN 倍にそろえる */
  let en = 0;
  for (const v of h) en += v * v;
  const k = Math.sqrt(CASE_GAIN / Math.max(en, 1e-12)),
    out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = h[i] * k;
  out[0] += 1;
  return out;
}

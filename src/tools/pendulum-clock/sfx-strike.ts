/**
 * 振り子時計の時打ち・こはぜ・止めの音。録音は使わず、当たりの力学と部品の振動の型（モード）から作る
 * （2026-11-13 の聴き比べの案 S1。刻む音は sfx-tick.ts）。
 *
 * 時打ち: 渦巻きのゴング（鋼線の片持ちの棒、曲がりの補正つき）を革のハンマーで打つ。ハンマーと棒の当たりは
 * 時間を刻んで解き（Hunt–Crossley の革のばね）、各型の振幅と位相を得る。音は棒からの直接の放射と、根元の力が
 * ゴングの台（質量）を通って座板と箱を鳴らす分の和。根元から箱へ逃げるエネルギーを各型の減衰に入れる。
 * 面内の型と面外の型（曲がりとねじれの結びつきで少し低い）が組になってうなる。
 *
 * こはぜ・止め: 鋼どうしの短い当たりの力が、レバーの軸・地板・座板を通って木の箱の板から出る
 */
import { type ClockEvent, GEO, type Pt, W } from './model';

export interface Mode {
  f: number;
  amp: number;
  /** 振幅が 1/e になる時間 [s] */
  decay: number;
}

/* ===== 複素数 ===== */
type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const scl = (a: C, k: number): C => [a[0] * k, a[1] * k];
const cexp = (a: C): C => {
  const e = Math.exp(a[0]);
  return [e * Math.cos(a[1]), e * Math.sin(a[1])];
};
const cpow = (a: C, n: number): C => {
  let r: C = [1, 0];
  for (let i = 0; i < n; i++) r = mul(r, a);
  return r;
};

/* ===== 型の連なり: 各段は Σ g·s^nd/(s² + 2ζωs + ω²)（と s^sp・定数 d）。極ごとの留数を足して音にする ===== */
interface Sec {
  id: number;
  f: number;
  z: number;
  g: number;
  nd: number;
}
interface Stage {
  secs: Sec[];
  d?: number;
  sp?: number;
}
let secId = 0;
const sec = (f: number, z: number, g: number, nd: number, id = ++secId): Sec => ({ id, f, z, g, nd });
const poleOf = (s: Sec): C => {
  const w = 2 * Math.PI * s.f;
  return [-s.z * w, w * Math.sqrt(1 - s.z * s.z)];
};
function evalStage(st: Stage, s: C): C {
  let h: C = [st.d ?? 0, 0];
  for (const q of st.secs) {
    const w = 2 * Math.PI * q.f,
      den: C = [s[0] * s[0] - s[1] * s[1] + 2 * q.z * w * s[0] + w * w, 2 * s[0] * s[1] + 2 * q.z * w * s[1]];
    h = add(h, scl(div(cpow(s, q.nd), den), q.g));
  }
  return st.sp ? mul(h, cpow(s, st.sp)) : h;
}
interface Pole {
  p: C;
  r: C;
}
type Acc = Map<number, Pole>;
interface Src {
  x: (s: C) => C;
  poles: { id: number; p: C; r: C }[];
}
function put(acc: Acc, id: number, p: C, r: C): void {
  const o = acc.get(id);
  if (o) o.r = add(o.r, r);
  else acc.set(id, { p, r });
}
/** 入力 src を段 stages に通した出力（係数 c）の極と留数を acc に足す */
function cascade(acc: Acc, src: Src, stages: Stage[], c: number): void {
  stages.forEach((st, i) => {
    for (const q of st.secs) {
      const p = poleOf(q);
      let r = scl(div(cpow(p, q.nd), [0, 2 * p[1]]), q.g * c);
      if (st.sp) r = mul(r, cpow(p, st.sp));
      stages.forEach((o, j) => {
        if (j !== i) r = mul(r, evalStage(o, p));
      });
      put(acc, q.id, p, mul(r, src.x(p)));
    }
  });
  for (const q of src.poles) {
    let r = scl(q.r, c);
    for (const o of stages) r = mul(r, evalStage(o, q.p));
    put(acc, q.id, q.p, r);
  }
}
/** 半正弦の山（面積 1、長さ tau）のラプラス変換 */
const halfSine =
  (tau: number) =>
  (s: C): C => {
    const w = Math.PI / tau,
      num = scl(add([1, 0], cexp(scl(s, -tau))), (w * w) / 2),
      den: C = [s[0] * s[0] - s[1] * s[1] + w * w, 2 * s[0] * s[1]];
    return div(num, den);
  };
/** 極と留数から音を足す: y(t) = Σ 2 Re(r e^{pt})。最初の ramp [s] は立ち上がりを滑らかにする */
function renderPoles(acc: Acc, out: Float64Array, fs: number, ramp: number, floor = 1e-5): void {
  let mx = 0;
  for (const { r } of acc.values()) mx = Math.max(mx, Math.hypot(r[0], r[1]));
  const nr = Math.max(1, Math.round(ramp * fs));
  for (const { p, r } of acc.values()) {
    const w = p[1] / fs;
    if (p[1] / (2 * Math.PI) > Math.min(20000, fs * 0.45)) continue;
    const A = 2 * Math.hypot(r[0], r[1]);
    if (A < floor * mx) continue;
    const ph = Math.atan2(r[1], r[0]),
      rr = Math.exp(p[0] / fs),
      n = Math.min(out.length, Math.ceil(Math.log((floor * mx) / A) / (p[0] / fs)) + 2),
      c2 = 2 * rr * Math.cos(w),
      r2 = rr * rr;
    const rmp = (i: number) => (i < nr ? Math.sin((Math.PI * i) / (2 * nr)) ** 2 : 1);
    let y2 = A * Math.cos(ph),
      y1 = A * rr * Math.cos(w + ph);
    out[0] += y2 * rmp(0);
    if (n > 1) out[1] += y1 * rmp(1);
    for (let i = 2; i < n; i++) {
      const y = c2 * y1 - r2 * y2;
      out[i] += y * rmp(i);
      y2 = y1;
      y1 = y;
    }
  }
}
/** 短い波形 g(t)（0〜T）を帯域を制限して足す（窓付き sinc、遮断 fc） */
function renderShort(g: (t: number) => number, T: number, out: Float64Array, fs: number, k = 1): void {
  const fc = Math.min(19000, fs * 0.42),
    half = Math.round(0.0008 * fs),
    sub = 96,
    du = T / sub;
  for (let i = -half; i < Math.ceil(T * fs) + half; i++) {
    if (i < 0 || i >= out.length) continue;
    const t = i / fs;
    let acc = 0;
    for (let j = 0; j < sub; j++) {
      const u = (j + 0.5) * du,
        x = t - u;
      if (Math.abs(x) * fs > half) continue;
      const sn = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x),
        win = 0.5 + 0.5 * Math.cos((Math.PI * x * fs) / half);
      acc += g(u) * sn * win * du;
    }
    out[i] += acc * k;
  }
}

/* ===== 空気と放射 ===== */
const RHO = 1.2,
  CA = 343,
  /** 聞く距離 [m]・双極子の向きの平均（部屋の反射込みで 1/√3）・箱の中から外へ出る割合 */
  RL = 0.5,
  COS = 0.58,
  T_IN = 0.5;
/** 板の放射効率: 一致周波数 fc より下は縁の放射（Maidanik の中ほどの形 ∝ √(f/fc)）、上は 1 */
const sigma = (f: number, fc: number, P: number, S: number) =>
  f >= fc ? 1 : Math.min(1, ((P * CA) / (Math.PI ** 2 * S * fc)) * Math.sqrt(f / fc));
/** 板の型の速さの振幅 1 m/s あたりの音圧の振幅 [Pa]（放射の仕事率 ρcSσ<v²> から） */
const radPlate = (S: number, sg: number) => (RHO * CA * Math.sqrt(S * sg)) / (4 * Math.sqrt(Math.PI) * RL);
/** 小さな物の双極子: 速さ u の 2 階微分あたりの音圧 [Pa·s³/m]（半径 a の球、ka ≪ 1） */
const dip = (a3: number) => (RHO * a3 * COS) / (2 * RL * CA);

/* ===== 板 ===== */
interface PlateMode {
  f: number;
  m: number;
  n: number;
  Q: number;
}
/** 単純支持の長方形板 a×b [m]・厚さ h・ヤング率 E・密度 rho・ポアソン比 nu の型（fmax 未満） */
export function plateModes(
  a: number,
  b: number,
  h: number,
  E: number,
  rho: number,
  nu: number,
  Q: number,
  fmax: number,
  mmax = 8,
): PlateMode[] {
  const k = (Math.PI / 2) * Math.sqrt((E * h * h) / (12 * (1 - nu * nu) * rho)),
    out: PlateMode[] = [];
  for (let m = 1; m <= mmax; m++)
    for (let n = 1; n <= mmax; n++) {
      const f = k * ((m / a) ** 2 + (n / b) ** 2);
      if (f < fmax) out.push({ f, m, n, Q });
    }
  return out.sort((p, q) => p.f - q.f);
}
/** 地板 104×106×2 mm の真鍮。減衰は真鍮の内部損失 1e-3 に柱の継ぎ目・ほぞの油を足した η = 0.006 */
const PL = { a: 0.104, b: 0.106, h: 0.002, E: 1.0e11, rho: 8500, nu: 0.34, eta: 0.006 };
export const PLATE = plateModes(PL.a, PL.b, PL.h, PL.E, PL.rho, PL.nu, 1 / PL.eta, 18000, 12);
const PL_FC = (CA * CA) / (1.8138 * Math.sqrt(PL.E / (PL.rho * (1 - PL.nu ** 2))) * PL.h);
/** 機械の座標 [mm] を地板の上の点 [m] へ */
const onPlate = ([x, y]: Pt): Pt => [(x - GEO.soundPlate[0]) / 1000, (y - GEO.soundPlate[1]) / 1000];

/** 木の箱の板（直交異方性、a が木目の向き）。w は座板に対する揺れの割合（継ぎ目を越えると小さくなる） */
interface Panel {
  name: string;
  a: number;
  b: number;
  h: number;
  w: number;
  /** 力が入る点（a, b に対する比） */
  at: Pt;
  dt: number;
}
const WOOD = { EL: 1.1e10, ET: 0.9e9, G: 0.7e9, nuLT: 0.4, rho: 650, eta: 0.025 };
const PANELS: Panel[] = [
  { name: '座板', a: 0.2, b: 0.11, h: 0.008, w: 1, at: [0.3, 0.45], dt: 1 },
  { name: '裏蓋', a: 0.23, b: 0.2, h: 0.004, w: 0.35, at: [0.08, 0.3], dt: 1 },
  { name: '左の側板', a: 0.25, b: 0.11, h: 0.006, w: 0.3, at: [0.07, 0.5], dt: 1 },
  { name: '右の側板', a: 0.25, b: 0.11, h: 0.006, w: 0.3, at: [0.07, 0.45], dt: 1.03 },
  { name: '天板', a: 0.22, b: 0.12, h: 0.008, w: 0.2, at: [0.1, 0.4], dt: 1 },
  { name: '前板', a: 0.26, b: 0.22, h: 0.006, w: 0.3, at: [0.06, 0.2], dt: 1 },
];
interface CaseMode {
  f: number;
  /** 力の入る点の形・放射（符号つき）・型の質量 */
  phi: number;
  rad: number;
  M: number;
  /** 座板の上の点の形: 機械の 2 本の足（そろって・逆向きに押す）とゴングの台 */
  feet: number;
  rock: number;
  block: number;
}
function caseModes(fmax: number): CaseMode[] {
  const out: CaseMode[] = [];
  for (const P of PANELS) {
    const h3 = P.h ** 3 / 12,
      D1 = (WOOD.EL * h3) / (1 - 0.4 * 0.03),
      D2 = (WOOD.ET * h3) / (1 - 0.4 * 0.03),
      D3 = WOOD.nuLT * D2 + 2 * WOOD.G * h3,
      rh = WOOD.rho * P.h,
      fc = ((CA * CA) / (2 * Math.PI)) * Math.sqrt(rh / Math.sqrt(D1 * D2)),
      S = P.a * P.b,
      per = 2 * (P.a + P.b),
      M = (rh * S) / 4;
    for (let m = 1; m <= 30; m++)
      for (let n = 1; n <= 30; n++) {
        const km = m / P.a,
          kn = n / P.b,
          f = P.dt * (Math.PI / 2) * Math.sqrt((D1 * km ** 4 + 2 * D3 * km * km * kn * kn + D2 * kn ** 4) / rh);
        if (f > fmax) continue;
        const sh = (u: number, v: number) => Math.sin(m * Math.PI * u) * Math.sin(n * Math.PI * v),
          sgn = Math.sign(sh(0.41, 0.37)) || 1;
        out.push({
          f,
          phi: P.w * sh(P.at[0], P.at[1]),
          rad: sgn * radPlate(S, sigma(f, fc, per, S)),
          M,
          feet: P.w === 1 ? 0.5 * (sh(0.3, 0.45) + sh(0.7, 0.55)) : P.w * sh(P.at[0], P.at[1]),
          rock: P.w === 1 ? sh(0.3, 0.45) - sh(0.7, 0.55) : P.w * 0.7 * sh(P.at[0], P.at[1]),
          block: P.w === 1 ? sh(0.12, 0.22) : P.w * 0.5 * sh(P.at[0], P.at[1]),
        });
      }
  }
  return out.sort((p, q) => p.f - q.f);
}
const CASE = caseModes(9000);
/** 箱と地板の型の番号（入り方が違っても同じ型は 1 つの極にまとめる） */
const CASE_ID = CASE.map(() => ++secId);
const PLATE_ID = [PLATE.map(() => ++secId), PLATE.map(() => ++secId)];
/** 座板の無限板としての動きやすさ [m/(s·N)]（直交異方性: 1/(8√(ρh√(D1 D2)))） */
const Y_SEAT = (() => {
  const P = PANELS[0],
    h3 = P.h ** 3 / 12;
  return 1 / (8 * Math.sqrt(WOOD.rho * P.h * Math.sqrt(WOOD.EL * h3 * WOOD.ET * h3)));
})();
/** 箱の型の段: 点に入る力 [N] → 外の音圧 [Pa]。pick で入る点を選ぶ */
const caseStage = (pick: (c: CaseMode) => number): Stage => ({
  secs: CASE.map((c, i) => sec(c.f, WOOD.eta / 2, (pick(c) * c.rad) / c.M, 1, CASE_ID[i])),
});
/**
 * 地板の段: ほぞ穴の点 p に面内の力 [N]（向き dir [rad]）が掛かり、穴の中で e_b 片寄ったモーメントで板を曲げる。
 * 力は前の板と後ろの板に 6:4 で分かれる。eBack を渡すと後ろの板のほぞは板から eBack 離れた受け（裏の受け）にあり、
 * そのモーメント F·eBack で後ろの板を曲げる（このとき力は 5:5）
 */
const E_B = 0.0005;
function plateStage(p: Pt, dir: number, eBack?: number): Stage {
  const [x, y] = onPlate(p),
    cx = Math.cos(dir),
    cy = Math.sin(dir),
    M = (PL.rho * PL.h * PL.a * PL.b) / 4,
    S = PL.a * PL.b,
    fu = CA / (2 * Math.max(PL.a, PL.b)),
    secs: Sec[] = [];
  /* 前の板と後ろの板（穴や切り欠きで 2 % ずれる）。力は 6:4 に分かれる */
  for (const [j, part, dt, e] of [
    [0, eBack ? 0.5 : 0.6, 1, E_B],
    [1, eBack ? 0.5 : 0.4, 1.02, eBack ?? E_B],
  ]) {
    PLATE.forEach((md, i) => {
      const kx = (md.m * Math.PI) / PL.a,
        ky = (md.n * Math.PI) / PL.b,
        gx = kx * Math.cos(kx * x) * Math.sin(ky * y),
        gy = ky * Math.sin(kx * x) * Math.cos(ky * y),
        f = md.f * dt,
        u = (f / fu) ** 2 / (1 + (f / fu) ** 2),
        sgn = Math.sign(Math.sin(md.m * Math.PI * 0.43) * Math.sin(md.n * Math.PI * 0.61)) || 1,
        rad = sgn * T_IN * radPlate(S, sigma(f, PL_FC, 2 * (PL.a + PL.b), S) * u);
      secs.push(sec(f, PL.eta / 2, (part * e * (cx * gx + cy * gy) * rad) / M, 1, PLATE_ID[j][i]));
    });
  }
  return { secs };
}

/* ===== 機械の揺れ（止め・こはぜの当たりが座板へ伝わる道） ===== */
/** レバーの軸の横揺れの減衰比 */
const Z_ARB = 0.15;
/** 機械（0.7 kg）が座板の上で弾む型（座板のばねと、座板の無限板としての抵抗で減衰） */
const MOUNT = { M: 0.7, f: 135 };
/** 機械に掛かる正味の力 → 座板に入る力。共振より上は座板の抵抗 Z と機械の質量の比 Z/(jωM) で弱まる */
function mountStage(): Stage {
  const wm = 2 * Math.PI * MOUNT.f,
    zm = Math.min(0.9, 1 / (2 * Y_SEAT * MOUNT.M * wm));
  return { secs: [sec(MOUNT.f, zm, 2 * zm * wm, 1)] };
}

/* ===== ゴング ===== */
/** 鋼線 直径 2.3 mm・長さ 1.4 m を根元で台に固定。渦巻きの平均の半径 60 mm。ハンマーは根元から 30 mm を打つ */
const GONG = { d: 0.0023, L: 1.4, E: 2.05e11, rho: 7850, nu: 0.29, Rc: 0.06, xh: 0.03, etaI: 2e-4 };
/** 革のハンマー: 質量 5 g、F = Kδ^1.5 (1 + λ δ')（革 20 MPa・厚さ 1.5 mm から）、打つ速さ [m/s] */
const HAM = { m: 0.005, K: 5e6, p: 1.5, lam: 1.2, v: 0.6 };
/** ゴングの台（鋳物 80 g）を座板の隅に留める */
const M_BLOCK = 0.08;
interface GongMode {
  f: number;
  /** 打つ点・根元の力（1 m の振れあたり、[N/m]）・型の質量 */
  phiH: number;
  V: number;
  M: number;
  plane: boolean;
}
export function gongRaw(fmax: number): GongMode[] {
  const { d, L, E, rho, nu, Rc, xh } = GONG,
    A = (Math.PI * d * d) / 4,
    EI = (E * Math.PI * d ** 4) / 64,
    c = Math.sqrt(EI / (rho * A)),
    out: GongMode[] = [];
  for (let n = 1; n <= 200; n++) {
    const bl = n === 1 ? 1.8751 : n === 2 ? 4.6941 : n === 3 ? 7.8548 : n === 4 ? 10.9955 : ((2 * n - 1) * Math.PI) / 2,
      b = bl / L,
      x = b * Rc,
      f0 = (c * b * b) / (2 * Math.PI);
    if (f0 > fmax * 1.1) break;
    if (x < 1.5) continue;
    const bx = b * xh,
      sg = bl > 12 ? 1 : (Math.cosh(bl) + Math.cos(bl)) / (Math.sinh(bl) + Math.sin(bl)),
      phiH = Math.cosh(bx) - Math.cos(bx) - sg * (Math.sinh(bx) - Math.sin(bx)),
      V = 2 * sg * b ** 3 * EI,
      /* 曲がった棒: 面内は (1 − 1/x²)²/(1 + 1/x²)、面外はねじれが入り (1 − 1/x²)²/(1 + (1 + ν)/x²)（輪の式） */
      gi = (1 - 1 / (x * x)) ** 2 / (1 + 1 / (x * x)),
      go = (1 - 1 / (x * x)) ** 2 / (1 + (1 + nu) / (x * x));
    out.push({ f: f0 * Math.sqrt(gi), phiH, V, M: rho * A * L, plane: true });
    out.push({ f: f0 * Math.sqrt(go), phiH, V, M: rho * A * L, plane: false });
  }
  return out.filter((m) => m.f <= fmax);
}
/** 台と座板の動きやすさ（台の質量と座板・箱の型） */
function yMount(f: number): C {
  const w = 2 * Math.PI * f;
  let y: C = [0, 0];
  for (const c of CASE) {
    if (!c.block) continue;
    const wk = 2 * Math.PI * c.f;
    y = add(y, scl(div([0, w], [wk * wk - w * w, WOOD.eta * wk * w]), (c.block * c.block) / c.M));
  }
  y = add(y, [Y_SEAT * 0.3, 0]);
  return div([1, 0], add(div([1, 0], y), [0, w * M_BLOCK]));
}
/** ゴングの型の減衰率 ζ: 鋼の内部損失・空気の粘り・根元から台と箱へ逃げる分 */
function gongZeta(g: GongMode): number {
  const w = 2 * Math.PI * g.f,
    eBlock = (g.V * g.V * yMount(g.f)[0]) / (g.M * w ** 3),
    eAir = 2e-5 * Math.sqrt(1000 / g.f);
  return (GONG.etaI + eAir + eBlock) / 2;
}
/** 棒からの直接の放射: 細い円柱の双極子 R' = (π²/2)ρc a (ka)³。型の速さ 1 m/s（長さで平均）あたりの音圧 [Pa] */
function gongDirect(f: number): number {
  const a = GONG.d / 2,
    ka = (2 * Math.PI * f * a) / CA,
    Rp = (Math.PI ** 2 / 2) * RHO * CA * a * ka ** 3 * GONG.L,
    W = Rp / 2;
  return Math.sqrt((2 * RHO * CA * W) / (4 * Math.PI * RL * RL));
}
/** ハンマーとゴングの当たりを解く。型ごとの振れの複素振幅（打った時刻に戻したもの）と当たりの長さ */
export function strike(modes: GongMode[], v: number, oop: number): { q: C[]; tc: number } {
  const all = gongRaw(25000).filter((m) => m.plane),
    dt = 2e-6,
    nIn = all.length,
    q = new Float64Array(nIn),
    qd = new Float64Array(nIn),
    w2 = all.map((m) => (2 * Math.PI * m.f) ** 2),
    hist: number[] = [];
  let y = 0,
    yd = v,
    tc = 0,
    F = 0;
  const steps = 2000;
  for (let i = 0; i < steps; i++) {
    let wx = 0,
      wv = 0;
    for (let k = 0; k < nIn; k++) {
      wx += all[k].phiH * q[k];
      wv += all[k].phiH * qd[k];
    }
    const del = y - wx,
      dd = yd - wv;
    F = del > 0 ? Math.max(0, HAM.K * del ** HAM.p * (1 + HAM.lam * dd)) : 0;
    if (F > 0) tc = (i + 1) * dt;
    hist.push(F);
    yd -= (F / HAM.m) * dt;
    y += yd * dt;
    for (let k = 0; k < nIn; k++) {
      qd[k] += ((F * all[k].phiH) / all[k].M - w2[k] * q[k]) * dt;
      q[k] += qd[k] * dt;
    }
  }
  /*
   * 求める型ごとに、記録した力でたたみ込む（面外は斜めの分 oop）。q(t) = Σ g sin ω(t − tᵢ) = Re(A e^{jωt})、
   * A = Σ g (−sin ωtᵢ − j cos ωtᵢ)
   */
  const out: C[] = modes.map((m) => {
    const w = 2 * Math.PI * m.f;
    let re = 0,
      im = 0;
    for (let i = 0; i < hist.length; i++) {
      if (!hist[i]) continue;
      const t = (i + 0.5) * dt,
        g = (hist[i] * m.phiH * dt) / (m.M * w);
      re -= g * Math.sin(w * t);
      im -= g * Math.cos(w * t);
    }
    return scl([re, im], m.plane ? 1 : oop);
  });
  return { q: out, tc };
}
/** 台に入る力 [N] → 箱の音圧 [Pa] */
const blockStage = (): Stage => caseStage((c) => c.block);
/** ゴングの型（テスト・図のため）: 振幅は 1 打ちの音圧 [Pa] の目安 */
export function gongModes(): Mode[] {
  const modes = gongRaw(6000).filter((m) => m.f >= 60),
    { q } = strike(modes, HAM.v, 0.15);
  return modes.map((m, i) => {
    const w = 2 * Math.PI * m.f,
      amp = Math.hypot(q[i][0], q[i][1]),
      hc = evalStage(blockStage(), [0, w]);
    return {
      f: m.f,
      amp: amp * (w * gongDirect(m.f) + m.V * Math.hypot(hc[0], hc[1])),
      decay: 1 / (gongZeta(m) * w),
    };
  });
}
/** ゴングの音 [Pa]（打つ速さ v） */
function gongSound(fs: number, len: number, v: number): Float64Array {
  const modes = gongRaw(Math.min(9000, fs * 0.45)).filter((m) => m.f >= 50),
    { q } = strike(modes, v, 0.15),
    acc: Acc = new Map(),
    out = new Float64Array(Math.round(len * fs));
  /* 型ごとの極: 振れ q(t) = Re(A e^{pt})。根元の力は V·q、棒の速さは p·q */
  const poles = modes.map((m, i) => {
    const z = gongZeta(m),
      w = 2 * Math.PI * m.f,
      p: C = [-z * w, w * Math.sqrt(1 - z * z)];
    return { id: ++secId, p, A: q[i], m };
  });
  /* 直接の放射: 音圧 = G·(棒の速さ)、速さは Re(pA e^{pt}) */
  for (const { id, p, A, m } of poles) put(acc, id, p, scl(mul(p, A), gongDirect(m.f) / 2));
  /* 根元の力 → 台（質量）→ 座板と箱 */
  const src: Src = {
      x: (s) => {
        let x: C = [0, 0];
        for (const { p, A, m } of poles) {
          const r = scl(A, m.V / 2);
          x = add(x, add(div(r, add(s, scl(p, -1))), div([r[0], -r[1]], add(s, [-p[0], p[1]]))));
        }
        return x;
      },
      poles: poles.map(({ id, p, A, m }) => ({ id, p, r: scl(A, m.V / 2) })),
    },
    /* 台の質量で高い音ほど伝わりにくい（座板の動きやすさとの比） */
    lp = (s: C): C => div([1, 0], add([1, 0], scl(s, M_BLOCK * Y_SEAT))),
    tmp: Acc = new Map();
  cascade(tmp, src, [blockStage()], 1);
  for (const [id, o] of tmp) put(acc, id, o.p, mul(o.r, lp(o.p)));
  renderPoles(acc, out, fs, 0.0008, 1e-5);
  return out;
}

/* ===== ほかの当たり（止め・予告・こはぜ・振り子の当たり止め） ===== */
/**
 * 機械の中の点 p で、換算質量 m の鋼どうしが速さ v [m/s] で当たる。力は向き dir、レバーの支点と当たる所が
 * 別の部品なので、差の力の割合 net が機械を揺らす
 */
function knock(
  p: Pt,
  m: number,
  k: number,
  v: number,
  dir: number,
  net: number,
  fs: number,
  len: number,
): Float64Array {
  const tau = Math.PI * Math.sqrt(m / k),
    J = 1.6 * m * v,
    hs = halfSine(tau),
    src: Src = { x: (s) => scl(hs(s), J), poles: [] },
    acc: Acc = new Map(),
    mount = mountStage(),
    lever: Stage = { secs: [sec(900, Z_ARB, (2 * Math.PI * 900) ** 2, 0)] };
  cascade(acc, src, [lever, mount, caseStage((c) => c.feet)], net);
  cascade(acc, src, [lever, plateStage(p, dir)], 1);
  const out = new Float64Array(Math.round(len * fs));
  renderPoles(acc, out, fs, tau);
  const w = Math.PI / tau,
    kAcc = (T_IN * dip(0.003 ** 3)) / (2 * m);
  renderShort((t) => ((J * w) / 2) * w * Math.cos(w * t), tau, out, fs, kAcc);
  return out;
}

/* ===== 音の種類と鳴らし方 ===== */
export type SfxKind = 'gong' | 'clickT' | 'clickS' | 'lock';
/** 開いたときに作っておく音（ゴングは初めて鳴らすときに作る） */
export const SFX_PRELOAD: readonly SfxKind[] = ['clickT', 'clickS', 'lock'];
/** 出来事 1 つで鳴らす音。dt は出来事の時刻からのずれ [s] */
export interface Cue {
  kind: SfxKind;
  gain: number;
  dt?: number;
}
/** 音圧 [Pa] から音の値へ（ページの他の音と大きさをそろえる値） */
const K_GONG = 7;
/**
 * 出来事を音へ割り当てる（時打ち・こはぜ・止めの音）。live は実際の速さ以下で動かしているとき。
 * 刻む音は sfx-tick.ts が受け持つ
 */
export function cue(e: ClockEvent, live: boolean): Cue[] {
  if (e.k === 'click') return [{ kind: e.w === 'T' ? 'clickT' : 'clickS', gain: 0.22 }];
  if (!live) return [];
  switch (e.k) {
    case 'gong':
      /* ハンマーの速さはばねの力の割合で 0.45〜0.6 m/s。音はほぼ速さに比例 */
      return [{ kind: 'gong', gain: (0.45 + 0.15 * Math.min(1, e.f)) / HAM.v }];
    case 'warn':
      return [{ kind: 'lock', gain: 0.12 }];
    case 'lock':
    case 'unlock':
      return [{ kind: 'lock', gain: 0.18 }];
    default:
      return [];
  }
}
/** 時打ちの間の風切りの風の音: 帯域通過の中心 [Hz] と大きさ。sw は数取り車の回る速さ */
export function whirOf(sw: number): { freq: number; gain: number } {
  return { freq: Math.max(60, 128 * sw), gain: sw > 0.05 ? 0.035 * Math.min(1, sw) : 0 };
}
const toF32 = (y: Float64Array, k: number): Float32Array => {
  const o = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) o[i] = y[i] * k;
  return o;
};
const norm = (y: Float64Array): Float32Array => {
  let mx = 0;
  for (const v of y) mx = Math.max(mx, Math.abs(v));
  return toF32(y, mx > 0 ? 1 / mx : 0);
};
/** 型を足して音にする（最大を peak にそろえる）。図やテストのための単純な形 */
export function render(modes: readonly Mode[], len: number, fs: number, _seed = 1, peak = 1): Float32Array {
  const acc: Acc = new Map();
  for (const md of modes) {
    const w = 2 * Math.PI * md.f;
    put(acc, ++secId, [-1 / md.decay, w], [md.amp / 2, 0]);
  }
  const out = new Float64Array(Math.round(len * fs));
  renderPoles(acc, out, fs, 0);
  let mx = 0;
  for (const v of out) mx = Math.max(mx, Math.abs(v));
  return toF32(out, mx > 0 ? peak / mx : 0);
}
/** 効果音を作る */
export function makeSfx(kind: SfxKind, fs: number): Float32Array {
  switch (kind) {
    case 'gong':
      return toF32(gongSound(fs, 7, HAM.v), K_GONG);
    case 'clickT':
      return norm(knock(W.bar.c, 1e-3, 8e5, 0.08, Math.PI / 2, 0.3, fs, 0.25));
    case 'clickS':
      return norm(knock(W.sbar.c, 1e-3, 8e5, 0.08, Math.PI / 2, 0.3, fs, 0.25));
    default:
      return norm(knock(GEO.lock, 2e-3, 1.2e6, 0.05, -Math.PI / 2, 0.4, fs, 0.3));
  }
}

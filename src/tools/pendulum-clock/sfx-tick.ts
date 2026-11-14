/**
 * 振り子時計の音。録音は使わず、計算した接触の力を源にし、部品から箱までの伝わりを振動の型（モード）で解いて作る。
 * 刻む音: 脱進機の計算（esc.ts）の当たりごとの力積（hit）と、爪が歯を放すときの力の抜け（free）が源。
 *   当たりの形はヘルツの接触（真鍮の歯と鋼の爪）の長さ数十 µs の山で、力積は計算の値から（cue）。
 *   伝わり: 歯 → がんぎ車の軸・アンクルの軸（横の曲げの型）→ ほぞ → 地板（軸の傾きと柱の曲げで面外へ）→ ねじで前板・足で底板。
 *   がんぎ車とアンクルの面外の型は直に鳴る。地板と前板の音は、聞く向きのレイリー積分で求める。箱の中の空気の型も足す。
 * 時打ち: 革のハンマーと渦巻きのゴングの接触を、ゴングの型と一緒に時間で解く。
 *   ゴングは曲げの向きで 2 つの型の族（巻きの面内・面外）に分かれ、根元の力が台から箱の裏板へ伝わって鳴る。
 *   型ごとの減衰は、鋼の内部摩擦・熱弾性・空気・裏板へ逃げる分の和
 */
import { ESCJ, type EscType } from './esc';
import { type ClockEvent, GEO, type Pt, W } from './model';

export interface Mode {
  f: number;
  amp: number;
  /** 振幅が 1/e になる時間 [s] */
  decay: number;
}
interface PlateMode {
  f: number;
  m: number;
  n: number;
  Q: number;
}
const DEG = Math.PI / 180,
  RHO0 = 1.2,
  C0 = 343;
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

/* ===== 板 ===== */
interface Panel {
  a: number;
  b: number;
  /** 面密度 [kg/m²] */
  mu: number;
  eta: number;
  modes: PlateMode[];
  /** 板の一致周波数 [Hz]（参考）・曲げの硬さの相乗平均 */
  fc: number;
  D: number;
}
/** 直交異方性の単純支持の板（木は木目の向き a が E1） */
function panel(
  a: number,
  b: number,
  h: number,
  E1: number,
  E2: number,
  G: number,
  nu12: number,
  rho: number,
  eta: number,
  fmax: number,
): Panel {
  const nu21 = (nu12 * E2) / E1,
    dd = 1 - nu12 * nu21,
    D1 = (E1 * h ** 3) / (12 * dd),
    D2 = (E2 * h ** 3) / (12 * dd),
    H = D1 * nu21 + (2 * G * h ** 3) / 12,
    mu = rho * h,
    modes: PlateMode[] = [];
  for (let m = 1; m <= 40; m++)
    for (let n = 1; n <= 40; n++) {
      const p = m / a,
        q = n / b,
        f = (Math.PI / 2) * Math.sqrt((D1 * p ** 4 + 2 * H * p * p * q * q + D2 * q ** 4) / mu);
      if (f < fmax) modes.push({ f, m, n, Q: 1 / eta });
    }
  modes.sort((p, q) => p.f - q.f);
  return {
    a,
    b,
    mu,
    eta,
    modes,
    fc: ((C0 * C0) / (2 * Math.PI)) * Math.sqrt(mu / Math.sqrt(D1 * D2)),
    D: Math.sqrt(D1 * D2),
  };
}
/** 地板 104×106×2 mm の真鍮。η は真鍮そのもの（約 0.001）に柱・ほぞ・車の分を足して 0.006（前板へ逃げる分は plateLeak） */
const PL = { a: 0.104, b: 0.106, h: 0.002 };
export const PLATE = plateModes(PL.a, PL.b, PL.h, 1.0e11, 8500, 0.34, 1 / 0.006, 16000, 12);
const PLATE_P: Panel = {
  a: PL.a,
  b: PL.b,
  mu: 8500 * PL.h,
  eta: 0.006,
  modes: PLATE,
  fc: 0,
  D: (1e11 * PL.h ** 3) / (12 * (1 - 0.34 ** 2)),
};
/**
 * 箱の木（マホガニーほど）: E1 11 GPa・E2 1.0 GPa・G 0.75 GPa・密度 600。η は木そのもの（約 0.01）に継ぎ目の分を足して 0.03。
 * 前板 300×220×8 mm（機械をねじで留める）、裏板 300×220×5 mm（ゴングの台を留める）
 */
const FRONT = panel(0.3, 0.22, 0.008, 11e9, 1.0e9, 0.75e9, 0.4, 600, 0.03, 9000);
const BACK = panel(0.3, 0.22, 0.005, 11e9, 1.0e9, 0.75e9, 0.4, 600, 0.03, 9000);
/** 底板 300×140×10 mm（機械の下の柱の足が載る）。聞く人からは縁の向こうなので音は 0.5 倍 */
const BOTTOM = panel(0.3, 0.14, 0.01, 11e9, 1.0e9, 0.75e9, 0.4, 600, 0.03, 9000);
/** 底板の上の足（下の 2 本の柱の下、機械の座標 mm）と、その底板の上の点 [m] */
const FEET: Pt[] = [
  [-46, -50],
  [46, -50],
];
const onBottom = ([x]: Pt): Pt => [0.15 + x / 1000, 0.06];
/** 足の木への食い込みの硬さで決まる機械の上下・揺れの共振 550 Hz（η 0.15）。力は前のねじと底の足で半分ずつ受ける */
const SEAT = { f: 550, eta: 0.15, share: 0.5 };
export const CASE = BACK.modes;

/* ===== 複素数の小道具 ===== */
type Cx = [number, number];
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
/** 1 自由度の共振 1 / (ω0²(1 + jη) − ω²) */
const res = (w: number, w0: number, eta: number): Cx => {
  const re = w0 * w0 - w * w,
    im = w0 * w0 * eta,
    d = re * re + im * im;
  return [re / d, -im / d];
};

/* ===== 聞く位置: 前 1 m、横へ 30°・上へ 15° ずれた所 ===== */
const LIS = { r: 1, sx: Math.sin(30 * DEG) * Math.cos(15 * DEG), sy: Math.sin(15 * DEG) };
/** ∫0^L sin(κx) e^{jαx} dx（κ = mπ/L） */
function sinInt(m: number, L: number, al: number): Cx {
  const ka = (m * Math.PI) / L;
  let d = ka * ka - al * al;
  if (Math.abs(d) < 1e-6 * ka * ka) d = 1e-6 * ka * ka;
  const s = m % 2 ? -1 : 1,
    E: Cx = [s * Math.cos(al * L), s * Math.sin(al * L)];
  return [(ka * (1 - E[0])) / d, (ka * -E[1]) / d];
}
/** 板の型 (m, n) が単位の速さで動くときの、聞く位置の音圧（バッフル付きのレイリー積分）。jωρ0/(2πr) まで含む */
function farField(p: Panel, md: PlateMode, w: number): Cx {
  const k = w / C0,
    I = cmul(sinInt(md.m, p.a, k * LIS.sx), sinInt(md.n, p.b, k * LIS.sy)),
    g = (w * RHO0) / (2 * Math.PI * LIS.r);
  return [-g * I[1], g * I[0]];
}
/** バッフルのない小さな板（大きさ a）: 表と裏の打ち消し */
const unbaffled = (w: number, a: number) => {
  const x = (w / C0) * a;
  return x / Math.sqrt(1 + x * x);
};
const sinS = (md: PlateMode, p: Panel, x: number, y: number) =>
  Math.sin((md.m * Math.PI * x) / p.a) * Math.sin((md.n * Math.PI * y) / p.b);
/** 型の傾き（x, y） */
const gradS = (md: PlateMode, p: Panel, x: number, y: number): Pt => [
  ((md.m * Math.PI) / p.a) * Math.cos((md.m * Math.PI * x) / p.a) * Math.sin((md.n * Math.PI * y) / p.b),
  ((md.n * Math.PI) / p.b) * Math.sin((md.m * Math.PI * x) / p.a) * Math.cos((md.n * Math.PI * y) / p.b),
];

/* ===== 機械の部品 ===== */
/** 機械の座標 [mm] を地板の上の点 [m] へ */
const onPlate = ([x, y]: Pt): Pt => [(x - GEO.soundPlate[0]) / 1000, (y - GEO.soundPlate[1]) / 1000];
/** 機械の座標 [mm] を前板の上の点 [m] へ（地板の中心が前板の 0.15, 0.115） */
const onFront = ([x, y]: Pt): Pt => [0.15 + x / 1000, 0.115 + y / 1000];
/** 柱（地板の四隅から 6 mm 内）。前の端はねじで前板に留まる */
const PILLARS: Pt[] = [
  [-46, -44],
  [46, -44],
  [-46, 50],
  [46, 50],
];
/** 柱の長さ（地板の間）と、ほぞの力の線から前板の板厚の中までの腕 [m]（ねじのせん断が前板を曲げるモーメントの腕） */
const PILLAR_L = 0.04,
  SCREW_ARM = 0.03;
/**
 * 軸の横の曲げの型（両端をほぞで支えた鋼の軸に車が載る）。w は低い周波数で 1 になる重み。η は油のほぞで 0.05。
 * がんぎ車: 軸 φ1.5 mm・40 mm、車と かな 1.5 g を 1/3 の所 → 約 900 Hz と 3.6 kHz。
 * アンクル: 軸 φ1.5 mm、アンクル 1.5〜3 g → 型ごとに 600〜800 Hz
 */
interface Arbor {
  f: number[];
  w: number[];
  eta: number;
}
const ESC_ARBOR: Arbor = { f: [900, 3600], w: [0.85, 0.15], eta: 0.05 },
  /** 3 番車の軸（車 2 g） */
  W3_ARBOR: Arbor = { f: [850, 3400], w: [0.85, 0.15], eta: 0.05 };
/**
 * 歯の力はがんぎ車を回す向きの力積でもある。その大半はがんぎ車自身の慣性が受け、かな（6 枚、半径 0.9 mm）と
 * 3 番車のかみ合いに伝わるのは、先の輪列の慣性の分（3 番車 6e-8 kg·m² を歯数比 12 の 2 乗で割り、がんぎ車 5e-8 と比べて 0.0084）
 */
const MESH = { share: 0.0084, rp: 0.0009 };
/** 型ごとのアンクル: 軸の型と、アンクル自身の面外の型 [f, 重み]（直に鳴る） */
const ANCHOR: Record<EscType, { arbor: Arbor; own: [number, number][][]; S: number }> = {
  /* 鋼の帯（厚さ 1.5 mm）を曲げた「へ」の字: 腕の面外の曲げ（片持ち 13 mm と 11 mm）が 6〜8 kHz に来る */
  recoil: {
    arbor: { f: [700, 3000], w: [0.85, 0.15], eta: 0.05 },
    own: [
      [
        [6300, 1],
        [8900, 0.35],
      ],
      [
        [7900, 1],
        [6300, 0.3],
      ],
    ],
    S: 3e-4,
  },
  /* 厚い一枚のアンクルに焼き入れた爪: 自身の型は 12 kHz より上で、弱い */
  graham: {
    arbor: { f: [780, 3300], w: [0.85, 0.15], eta: 0.05 },
    own: [
      [
        [12500, 0.4],
        [15500, 0.3],
      ],
      [
        [12900, 0.4],
        [15500, 0.3],
      ],
    ],
    S: 4e-4,
  },
  /* 広い板（厚さ 2.5 mm）の両端にピン: 板の腕の面外の型が 9〜10 kHz */
  brocot: {
    arbor: { f: [620, 2800], w: [0.85, 0.15], eta: 0.05 },
    own: [
      [
        [9300, 1],
        [10400, 0.4],
      ],
      [
        [10100, 1],
        [9300, 0.4],
      ],
    ],
    S: 5e-4,
  },
};
/** がんぎ車: 半径 12 mm・厚さ 0.5 mm の真鍮の円板を中心で固定（λ² は中心固定・縁自由の円板）。η は軸への固定と爪との接触で 0.008 */
const WK = Math.sqrt((1e11 * 0.0005 ** 2) / (12 * (1 - 0.34 ** 2) * 8500)) / (2 * Math.PI * 0.012 ** 2);
const ETA_WHEEL = 0.008;
export const WHEEL = [3.75, 5.2, 9.0, 20.9, 26.0].map((l, i) => ({
  f: l * WK,
  Q: 1 / ETA_WHEEL,
  w: [1, 0.6, 0.45, 0.25, 0.2][i],
}));
/** 機械の全体（0.6 kg）をねじ 4 本（横の硬さ 1 本 2.5e6 N/m ほど）で前板に留めた揺れ: 並進 600 Hz・回転 950 Hz（木のねじ穴、η 0.15） */
const MOUNT = { ft: 600, fr: 950, eta: 0.15 };
/** 面内の力のうち面外へ移る割合（軸の傾き 2° ほど・柱の曲げ）と、その向き */
const TILT = { k: 0.04, uE: [0.6, 0.8] as Pt, uP: [-0.8, 0.6] as Pt };
/** 結合の大きさ（直に鳴る部品）: 歯の面の傾きで車の面外へ移る割合 */
const K_WHEEL = 0.03,
  K_ANCHOR = 0.03,
  /* アンクルは振り子の竿とつながり、爪は歯に触れている: η 0.006 */
  ETA_ANCHOR = 0.006;
/** 箱の中の空気: 内のり 280×200×120 mm。型の Q は木の壁の吸音と隙間で 18。外へは裏戸の透かし（1000 mm²） */
const CAV = { L: [0.28, 0.2, 0.12], Q: 18, out: 0.008, fH: 140, etaH: 0.3 };
/** 地板の音が箱の外へ出る割合（ガラス・透かし・隙間） */
const T_CASE = 0.35;

/** 力の加わる所と向き（脱進機の座標 [mm]、がんぎ車の中心が原点）。n は歯が受ける力の向き */
interface Hit {
  type: EscType;
  side: 0 | 1;
  p: Pt;
  n: Pt;
}
/** esc.ts の計算で測った、型ごと・左右ごとの最初の当たりの点・向き・近づく速さ [mm/s] */
const NOM: Record<EscType, [{ p: Pt; n: Pt; v: number }, { p: Pt; n: Pt; v: number }]> = {
  recoil: [
    { p: [-8.72, 8.25], n: [0.16, -0.99], v: 43 },
    { p: [8.37, 8.6], n: [-1.0, -0.04], v: 54 },
  ],
  graham: [
    { p: [-8.84, 8.11], n: [-0.7, -0.71], v: 51 },
    { p: [8.11, 8.84], n: [-0.7, 0.71], v: 52 },
  ],
  brocot: [
    { p: [-8.86, 8.1], n: [0.17, -0.98], v: 89 },
    { p: [8.05, 8.9], n: [-0.98, -0.22], v: 76 },
  ],
};

/** 軸の横の曲げを通る、車の力からほぞの力への伝わり（低い周波数で 1） */
function arborT(a: Arbor, w: number): Cx {
  let re = 0,
    im = 0;
  for (let i = 0; i < a.f.length; i++) {
    const w0 = 2 * Math.PI * a.f[i],
      r = res(w, w0, a.eta);
    re += a.w[i] * w0 * w0 * r[0];
    im += a.w[i] * w0 * w0 * r[1];
  }
  return [re, im];
}
/**
 * 機械の伝わりの基底: 点 at（機械の座標 mm）に向き n の面内の単位の力（frontAt があれば前板の点を面外に打つ）。
 * 周波数によらない係数（型の形の値）を前もって求めておく
 */
interface BasisDef {
  at: Pt;
  n: Pt;
  frontAt?: Pt;
}
interface BasisPre {
  /** 地板の型の一般化力（単位の力あたり）・軸の傾きで面外へ移る力・機械の全体へ掛かる力とモーメント */
  cP: Float64Array;
  fn: number;
  fx: number;
  fy: number;
  mz: number;
  /** 足のまわりのモーメント（下の足の中点のまわり）[m] */
  mf: number;
  /** 前板を直に打つときの型の値 */
  cF?: Float64Array;
}
const MCX = (GEO.soundPlate[0] + GEO.soundPlate[2]) / 2,
  MCY = (GEO.soundPlate[1] + GEO.soundPlate[3]) / 2;
/** ねじの所の前板の型の係数: 面外の反力の 1/4・x と y のせん断の 1/4・モーメントの分（いずれも型ごと） */
const FRONT_PRE = (() => {
  const B = FRONT,
    nm = B.modes.length,
    aR = new Float64Array(nm),
    bX = new Float64Array(nm),
    bY = new Float64Array(nm),
    bM = new Float64Array(nm);
  let r2 = 0;
  for (const q of PILLARS) r2 += ((q[0] - MCX) / 1000) ** 2 + ((q[1] - MCY) / 1000) ** 2;
  B.modes.forEach((md, j) => {
    for (const q of PILLARS) {
      const [x, y] = onFront(q),
        g = gradS(md, B, x, y),
        dx = (q[0] - MCX) / 1000,
        dy = (q[1] - MCY) / 1000;
      aR[j] += sinS(md, B, x, y) / 4;
      bX[j] += (SCREW_ARM * g[0]) / 4;
      bY[j] += (SCREW_ARM * g[1]) / 4;
      bM[j] += SCREW_ARM * ((-dy / r2) * g[0] + (dx / r2) * g[1]);
    }
  });
  return { aR, bX, bY, bM };
})();
const volOf = (p: Panel, md: PlateMode) =>
  md.m % 2 && md.n % 2 ? (4 * p.a * p.b) / (md.m * md.n * Math.PI * Math.PI) : 0;
/**
 * 地板の型が柱から前板へ逃げる分の減衰。柱の反力 R = ω²μ∫φ（単位の振れあたり）を 4 本のねじで受け、
 * 前板を無限の板の点の動きやすさ Y∞ = 1/(8√(Dμ)) とみて η = R² Y∞ /(4 m ω³)（0.2 で頭打ち）
 */
function plateLeak(md: PlateMode, vol: number): number {
  if (!vol) return 0;
  const B = FRONT,
    Yinf = 1 / (8 * Math.sqrt(B.D * B.mu)),
    w = 2 * Math.PI * md.f,
    m = (PLATE_P.mu * PLATE_P.a * PLATE_P.b) / 4,
    R = w * w * PLATE_P.mu * vol;
  return Math.min(0.2, (R * R * Yinf) / (4 * m * w ** 3));
}
function basisPre(d: BasisDef): BasisPre {
  const P = PLATE_P,
    [x, y] = onPlate(d.at),
    u = d.at[1] < GEO.P[1] - 1 ? TILT.uE : TILT.uP,
    fn = TILT.k * (d.n[0] * u[0] + d.n[1] * u[1]),
    pls = PILLARS.map(onPlate),
    cP = new Float64Array(P.modes.length);
  P.modes.forEach((md, i) => {
    /* 軸の傾き: 面外の力 fn。柱: 力の半分が裏の地板から柱を通り、柱 1 本に 1/8、端のモーメントは力 × 長さ/2 */
    let c = fn * sinS(md, P, x, y);
    for (const q of pls) {
      const g = gradS(md, P, q[0], q[1]);
      c += ((d.n[0] * g[0] + d.n[1] * g[1]) * PILLAR_L) / 16;
    }
    cP[i] = c;
  });
  const out: BasisPre = {
    cP,
    fn,
    fx: d.n[0],
    fy: d.n[1],
    mz: ((d.at[0] - MCX) * d.n[1] - (d.at[1] - MCY) * d.n[0]) / 1000,
    mf: (d.at[0] * d.n[1] - (d.at[1] - FEET[0][1]) * d.n[0]) / 1000,
  };
  if (d.frontAt) {
    const [fx, fy] = onFront(d.frontAt);
    out.cF = Float64Array.from(FRONT.modes, (md) => sinS(md, FRONT, fx, fy));
    out.cP.fill(0);
    out.fn = out.fx = out.fy = out.mz = out.mf = 0;
  }
  return out;
}
/** 遠くの音圧の係数を粗い格子（step ビンごと）で求めておき、間は直線で埋める */
function ffTable(p: Panel, fs: number, N: number, kmax: number, step: number): Float64Array[] {
  const nc = Math.ceil(kmax / step) + 2;
  return p.modes.map((md) => {
    const t = new Float64Array(nc * 2);
    for (let c = 0; c < nc; c++) {
      const f = Math.max(1, (c * step * fs) / N),
        v = farField(p, md, 2 * Math.PI * f);
      t[2 * c] = v[0];
      t[2 * c + 1] = v[1];
    }
    return t;
  });
}
const BASES: BasisDef[] = [
  { at: GEO.E, n: [1, 0] },
  { at: GEO.E, n: [0, 1] },
  { at: GEO.P, n: [1, 0] },
  { at: GEO.P, n: [0, 1] },
  { at: W.bar.c, n: [0, -1] },
  { at: W.sbar.c, n: [0, -1] },
  { at: GEO.lock, n: [0.6, -0.8] },
  { at: [0, 0], n: [0, 0], frontAt: [0, -40] },
  { at: W.w3.c, n: [1, 0] },
  { at: W.w3.c, n: [0, 1] },
];
/** 周波数の格子での基底の伝わり（ビン 0〜N/2、単位の力 1 N → 聞く位置の音圧 [Pa]） */
interface BasisGrid {
  fs: number;
  N: number;
  kmax: number;
  H: { re: Float64Array; im: Float64Array }[];
}
let BGRID: BasisGrid | null = null;
function basisGrid(fs: number, N: number): BasisGrid {
  if (BGRID && BGRID.fs === fs && BGRID.N === N) return BGRID;
  const fmax = Math.min(fs / 2 - 500, 16500),
    kmax = Math.floor((fmax * N) / fs),
    step = 8,
    pre = BASES.map(basisPre),
    P = PLATE_P,
    B = FRONT,
    mP = (P.mu * P.a * P.b) / 4,
    mB = (B.mu * B.a * B.b) / 4,
    ffP = ffTable(P, fs, N, kmax, step),
    ffB = ffTable(B, fs, N, kmax, step),
    D = BOTTOM,
    mD = (D.mu * D.a * D.b) / 4,
    ffD = ffTable(D, fs, N, kmax, step),
    wD = D.modes.map((md) => 2 * Math.PI * md.f),
    /* 足の所の底板の型の値（左・右） */
    fD = FEET.map((q) => D.modes.map((md) => sinS(md, D, ...onBottom(q)))),
    dFeet = (FEET[1][0] - FEET[0][0]) / 1000,
    vP = P.modes.map((md) => volOf(P, md)),
    vB = B.modes.map((md) => volOf(B, md)),
    wP = P.modes.map((md) => 2 * Math.PI * md.f),
    etaP = P.modes.map((md, i) => P.eta + plateLeak(md, vP[i])),
    wB = B.modes.map((md) => 2 * Math.PI * md.f),
    nb = BASES.length,
    H = BASES.map(() => ({ re: new Float64Array(N / 2 + 1), im: new Float64Array(N / 2 + 1) })),
    { aR, bX, bY, bM } = FRONT_PRE;
  /* 基底ごとの和（使い回す） */
  const pr = new Float64Array(nb),
    pi = new Float64Array(nb),
    rr = new Float64Array(nb),
    ri = new Float64Array(nb),
    ur = new Float64Array(nb),
    ui = new Float64Array(nb),
    br = new Float64Array(nb),
    bi = new Float64Array(nb);
  for (let k = 1; k <= kmax; k++) {
    const f = (k * fs) / N,
      w = 2 * Math.PI * f,
      c = Math.floor(k / step),
      u = k / step - c,
      /* 上の端 2 kHz は滑らかに落とす */
      roll = f > fmax - 2000 ? 0.5 + 0.5 * Math.cos((Math.PI * (f - fmax + 2000)) / 2000) : 1;
    pr.fill(0);
    pi.fill(0);
    rr.fill(0);
    ri.fill(0);
    ur.fill(0);
    ui.fill(0);
    br.fill(0);
    bi.fill(0);
    /* --- 地板の面外の型 --- */
    for (let i = 0; i < wP.length; i++) {
      const r = res(w, wP[i], etaP[i]),
        t = ffP[i],
        fr = t[2 * c] * (1 - u) + t[2 * c + 2] * u,
        fi = t[2 * c + 1] * (1 - u) + t[2 * c + 3] * u,
        /* 単位の一般化力の速さ v = jω r / m、その音圧 v × ff */
        vr = (-w * r[1]) / mP,
        vi = (w * r[0]) / mP,
        sr = vr * fr - vi * fi,
        si = vr * fi + vi * fr,
        /* 柱の反力のうち板の慣性の分 ω² μ q vol（q = r / m） */
        mr = (w * w * P.mu * vP[i] * r[0]) / mP,
        mi = (w * w * P.mu * vP[i] * r[1]) / mP;
      for (let b = 0; b < nb; b++) {
        const cc = pre[b].cP[i];
        if (cc === 0) continue;
        pr[b] += cc * sr;
        pi[b] += cc * si;
        rr[b] += cc * mr;
        ri[b] += cc * mi;
        /* 地板の体積速度（箱の空気を押す分は 0.3） */
        ur[b] += 0.3 * cc * vr * vP[i];
        ui[b] += 0.3 * cc * vi * vP[i];
      }
    }
    const ub = unbaffled(w, 0.06) * T_CASE;
    /* --- 機械の全体の揺れ → ねじ → 前板 --- */
    const Gt = res(w, 2 * Math.PI * MOUNT.ft, MOUNT.eta),
      Gr = res(w, 2 * Math.PI * MOUNT.fr, MOUNT.eta),
      wt = (2 * Math.PI * MOUNT.ft) ** 2,
      wr = (2 * Math.PI * MOUNT.fr) ** 2;
    for (let j = 0; j < wB.length; j++) {
      const r = res(w, wB[j], B.eta),
        t = ffB[j],
        fr = t[2 * c] * (1 - u) + t[2 * c + 2] * u,
        fi = t[2 * c + 1] * (1 - u) + t[2 * c + 3] * u,
        vr = (-w * r[1]) / mB,
        vi = (w * r[0]) / mB,
        sr = vr * fr - vi * fi,
        si = vr * fi + vi * fr,
        vv = vB[j];
      for (let b = 0; b < nb; b++) {
        const p = pre[b];
        /* 一般化力 Q = R aR + (Fx bX + Fy bY) Gt + Mz bM Gr、R = fn + 反力 */
        let Qr: number, Qi: number;
        if (p.cF) {
          Qr = p.cF[j];
          Qi = 0;
        } else {
          const sh = (p.fx * bX[j] + p.fy * bY[j]) * wt * (1 - SEAT.share),
            mo = p.mz * bM[j] * wr * (1 - SEAT.share);
          Qr = (p.fn + rr[b]) * aR[j] + sh * Gt[0] + mo * Gr[0];
          Qi = ri[b] * aR[j] + sh * Gt[1] + mo * Gr[1];
        }
        br[b] += Qr * sr - Qi * si;
        bi[b] += Qr * si + Qi * sr;
        /* 前板の内側の体積速度は箱の空気を押す */
        if (vv) {
          ur[b] += (Qr * vr - Qi * vi) * vv;
          ui[b] += (Qr * vi + Qi * vr) * vv;
        }
      }
    }
    /* --- 底板: 足の力 N = −Fy/2 ∓ M/d（機械の揺れ G を通す） --- */
    const Gs = res(w, 2 * Math.PI * SEAT.f, SEAT.eta),
      ws = (2 * Math.PI * SEAT.f) ** 2 * SEAT.share;
    for (let j = 0; j < wD.length; j++) {
      const r = res(w, wD[j], D.eta),
        t = ffD[j],
        fr = t[2 * c] * (1 - u) + t[2 * c + 2] * u,
        fi = t[2 * c + 1] * (1 - u) + t[2 * c + 3] * u,
        vr = (-w * r[1]) / mD,
        vi = (w * r[0]) / mD,
        sr = 0.5 * (vr * fr - vi * fi),
        si = 0.5 * (vr * fi + vi * fr),
        a0 = fD[0][j],
        a1 = fD[1][j];
      for (let b = 0; b < nb; b++) {
        const p = pre[b];
        if (p.cF) continue;
        /* 足の力の型への和（実数）× Gs */
        const q = (-p.fy / 2) * (a0 + a1) + (p.mf / dFeet) * (a0 - a1);
        if (q === 0) continue;
        const Qr = q * ws * Gs[0],
          Qi = q * ws * Gs[1];
        br[b] += Qr * sr - Qi * si;
        bi[b] += Qr * si + Qi * sr;
      }
    }
    const cv = cavityGain(w);
    for (let b = 0; b < nb; b++) {
      H[b].re[k] = roll * (pr[b] * ub + br[b] + ur[b] * cv[0] - ui[b] * cv[1]);
      H[b].im[k] = roll * (pi[b] * ub + bi[b] + ur[b] * cv[1] + ui[b] * cv[0]);
    }
  }
  BGRID = { fs, N, kmax, H };
  return BGRID;
}
/** 箱の中の空気の型（剛な壁の箱、体積速度 U を前の壁の中ほどに置き、裏の角から出す）＋穴の共鳴 */
const CAV_MODES = (() => {
  const [a, b, c] = CAV.L,
    o: { f: number; g: number }[] = [];
  for (let l = 0; l < 6; l++)
    for (let m = 0; m < 5; m++)
      for (let n = 0; n < 3; n++) {
        if (l + m + n === 0) continue;
        const f = (C0 / 2) * Math.sqrt((l / a) ** 2 + (m / b) ** 2 + (n / c) ** 2);
        if (f > 3500) continue;
        /* 源（前の壁 z = 0 の (0.5a, 0.55b)）と出口（裏の壁 z = c の (0.8a, 0.8b)）での型の値。∫ψ² = V/ε */
        const ps = Math.cos(l * Math.PI * 0.5) * Math.cos(m * Math.PI * 0.55),
          po = Math.cos(l * Math.PI * 0.8) * Math.cos(m * Math.PI * 0.8) * Math.cos(n * Math.PI),
          eps = (l ? 2 : 1) * (m ? 2 : 1) * (n ? 2 : 1);
        o.push({ f, g: ps * po * eps });
      }
  return o;
})();
/** 箱の中の空気: 体積速度 1 m³/s あたりの、聞く位置の音圧 */
function cavityGain(w: number): Cx {
  const V = CAV.L[0] * CAV.L[1] * CAV.L[2],
    k = (RHO0 * C0 * C0) / V;
  /* p = jω ρc²/V Σ ψψ/(ω0²(1+jη) − ω²) U。0 次の型は穴の質量と組んで共鳴（fH） */
  let sr = 0,
    si = 0;
  const h = res(w, 2 * Math.PI * CAV.fH, CAV.etaH);
  sr += h[0];
  si += h[1];
  for (const md of CAV_MODES) {
    const r = res(w, 2 * Math.PI * md.f, 1 / CAV.Q);
    sr += md.g * r[0];
    si += md.g * r[1];
  }
  return [-w * si * k * CAV.out, w * sr * k * CAV.out];
}
/** 小さな部品の型（がんぎ車・アンクル）を直に鳴らす: 速さ × 面積 S の点源 × 表裏の打ち消し */
function small(modes: [number, number][], eta: number, mass: number, S: number, a: number, w: number): Cx {
  let re = 0,
    im = 0;
  for (const [f, k] of modes) {
    const r = res(w, 2 * Math.PI * f, eta);
    re += (k / mass) * r[0];
    im += (k / mass) * r[1];
  }
  /* 変位 → 速さ jω、点源 jωρ0 S/(2πr) */
  const g = ((w * w * RHO0 * S) / (2 * Math.PI * LIS.r)) * unbaffled(w, a);
  return [-g * re, -g * im];
}
/** がんぎ車とアンクルの、直に鳴る型の伝わり（歯に単位の力） */
function partsH(h: Hit, w: number): Cx {
  const A = ANCHOR[h.type],
    wh = small(
      WHEEL.map((m) => [m.f, m.w]),
      ETA_WHEEL,
      0.0003,
      4.5e-4,
      0.012,
      w,
    ),
    an = small(A.own[h.side], ETA_ANCHOR, 0.0004, A.S, 0.012, w);
  return [K_WHEEL * wh[0] + K_ANCHOR * an[0], K_WHEEL * wh[1] + K_ANCHOR * an[1]];
}
/* ===== FFT（基数 2） ===== */
function fft(re: Float64Array, im: Float64Array, inv: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len,
      wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k,
          b = a + len / 2,
          tr = re[b] * cr - im[b] * ci,
          ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
/** 刻む音の伝わり H（型・左右ごと）: 歯の力 n はがんぎ車の軸へ、反作用 −n はアンクルの軸へ */
const HCACHE = new Map<string, { fs: number; N: number; re: Float64Array; im: Float64Array }>();
function tickGrid(type: EscType, side: 0 | 1, fs: number, N: number) {
  const key = `${type}-${side}`,
    hit0 = HCACHE.get(key);
  if (hit0 && hit0.fs === fs && hit0.N === N) return hit0;
  const bg = basisGrid(fs, N),
    nm = NOM[type][side],
    h: Hit = { type, side, p: nm.p, n: nm.n },
    A = ANCHOR[type],
    re = new Float64Array(N / 2 + 1),
    im = new Float64Array(N / 2 + 1),
    [nx, ny] = nm.n,
    /* 歯の力のトルク [N·m / N]（反時計回りが正）と、かみ合いの力の向き t（がんぎ車の中心から 3 番車への向きを 90° 回す） */
    tq = (nm.p[0] * nm.n[1] - nm.p[1] * nm.n[0]) * 1e-3,
    ux = W.w3.c[0] - GEO.E[0],
    uy = W.w3.c[1] - GEO.E[1],
    ul = Math.hypot(ux, uy),
    tx = -uy / ul,
    ty = ux / ul;
  for (let k = 1; k <= bg.kmax; k++) {
    const w = (2 * Math.PI * k * fs) / N,
      Te = arborT(ESC_ARBOR, w),
      Ta = arborT(A.arbor, w),
      eR = nx * bg.H[0].re[k] + ny * bg.H[1].re[k],
      eI = nx * bg.H[0].im[k] + ny * bg.H[1].im[k],
      aR = nx * bg.H[2].re[k] + ny * bg.H[3].re[k],
      aI = nx * bg.H[2].im[k] + ny * bg.H[3].im[k],
      sp = partsH(h, w),
      /* かみ合いの力: トルク τ = p × n（1 N あたり）、かなへ −τG/rp t、3 番車へ +τG/rp t */
      T3 = arborT(W3_ARBOR, w),
      mR = (tq / MESH.rp) * MESH.share,
      mI = 0,
      pinR = tx * bg.H[0].re[k] + ty * bg.H[1].re[k],
      pinI = tx * bg.H[0].im[k] + ty * bg.H[1].im[k],
      w3R = tx * bg.H[8].re[k] + ty * bg.H[9].re[k],
      w3I = tx * bg.H[8].im[k] + ty * bg.H[9].im[k],
      /* かな側 −Te × H_E、3 番車側 +T3 × H_3 */
      cR = -(Te[0] * pinR - Te[1] * pinI) + (T3[0] * w3R - T3[1] * w3I),
      cI = -(Te[0] * pinI + Te[1] * pinR) + (T3[0] * w3I + T3[1] * w3R),
      meshR = mR * cR - mI * cI,
      meshI = mR * cI + mI * cR,
      f = (k * fs) / N,
      fmax = Math.min(fs / 2 - 500, 16500),
      roll = f > fmax - 2000 ? 0.5 + 0.5 * Math.cos((Math.PI * (f - fmax + 2000)) / 2000) : 1;
    re[k] = Te[0] * eR - Te[1] * eI - (Ta[0] * aR - Ta[1] * aI) + meshR + roll * sp[0];
    im[k] = Te[0] * eI + Te[1] * eR - (Ta[0] * aI + Ta[1] * aR) + meshI + roll * sp[1];
  }
  const g = { fs, N, re, im };
  HCACHE.set(key, g);
  return g;
}
/** 機械の中の別の所（基底 b）の当たり: 軸の型 arbor と部品の型 own を通す */
function partGrid(key: string, b: number, arbor: Arbor | null, own: [number, number][], fs: number, N: number) {
  const hit0 = HCACHE.get(key);
  if (hit0 && hit0.fs === fs && hit0.N === N) return hit0;
  const bg = basisGrid(fs, N),
    re = new Float64Array(N / 2 + 1),
    im = new Float64Array(N / 2 + 1);
  for (let k = 1; k <= bg.kmax; k++) {
    const w = (2 * Math.PI * k * fs) / N,
      T: Cx = arbor ? arborT(arbor, w) : [1, 0],
      v = cmul(T, [bg.H[b].re[k], bg.H[b].im[k]]),
      sp = own.length ? small(own, 0.004, 0.0005, 3e-4, 0.01, w) : [0, 0];
    re[k] = v[0] + 0.1 * sp[0];
    im[k] = v[1] + 0.1 * sp[1];
  }
  const g = { fs, N, re, im };
  HCACHE.set(key, g);
  return g;
}
/** H × 源のスペクトル S(f) を時間へ戻し、長さ len [s] で切る（終わり 40 ms は弱める） */
function synth(
  g: { fs: number; N: number; re: Float64Array; im: Float64Array },
  src: (f: number) => Cx,
  len: number,
): Float32Array {
  const { fs, N } = g,
    re = new Float64Array(N),
    im = new Float64Array(N);
  for (let k = 1; k <= N / 2; k++) {
    if (g.re[k] === 0 && g.im[k] === 0) continue;
    const s = src((k * fs) / N),
      v = cmul([g.re[k], g.im[k]], s);
    re[k] = v[0];
    im[k] = v[1];
    if (k < N / 2) {
      re[N - k] = v[0];
      im[N - k] = -v[1];
    }
  }
  fft(re, im, true);
  const n = Math.min(N, Math.round(len * fs)),
    o = new Float32Array(n),
    fade = Math.round(0.04 * fs),
    sc = fs / N;
  for (let i = 0; i < n; i++)
    o[i] = re[i] * sc * (i > n - fade ? 0.5 + 0.5 * Math.cos((Math.PI * (i - n + fade)) / fade) : 1);
  return o;
}
/** 長さ tau の半正弦の山（面積 1）のスペクトル。山の真ん中までの遅れを含む */
function halfSine(f: number, tau: number): Cx {
  const u = f * tau,
    mag = Math.abs(u - 0.5) < 1e-6 ? Math.PI / 4 : Math.cos(Math.PI * u) / (1 - 4 * u * u),
    ph = -Math.PI * u;
  return [mag * Math.cos(ph), mag * Math.sin(ph)];
}
/** 力が長さ tr で滑らかに 0 へ抜ける（大きさ 1 N）: −(1/jω) × 面積 1 の山 */
function release(f: number, tr: number): Cx {
  const w = 2 * Math.PI * f,
    s = halfSine(f, tr);
  /* −s / (jω) = j s / ω */
  return [-s[1] / w, s[0] / w];
}

/* ===== ヘルツの接触 ===== */
/** 真鍮の歯と鋼の爪の E*（ν 0.34・0.29） */
const ESTAR = 1 / ((1 - 0.34 ** 2) / 1.0e11 + (1 - 0.29 ** 2) / 2.05e11);
/** 歯先の丸み [m]（ブロコ式はピンの丸み 1.05 mm と直列） */
const RTIP: Record<EscType, number> = { recoil: 1e-4, graham: 1e-4, brocot: 1 / (1 / 1e-4 + 1 / 1.05e-3) };
/**
 * がんぎ車の慣性を、力の向きの点の質量へ（腕は歯先の点と向きから）。力が車の中心へ向くときは車は回れず、
 * 軸ごと横へ押されるので、車・かな・軸の質量 1.5 g で頭打ち
 */
export const meff = (p: Pt, n: Pt): number =>
  Math.min(1.5e-3, ESCJ / Math.max(1e-6, (Math.abs(p[0] * n[1] - p[1] * n[0]) * 1e-3) ** 2));
/** ヘルツの当たりの長さ τ = 2.87 (m² / (R E*² v))^(1/5) */
const hertzTau = (m: number, R: number, v: number) => 2.87 * ((m * m) / (R * ESTAR * ESTAR * Math.max(1e-4, v))) ** 0.2;
/** 計算の跳ね返りの係数（esc.ts の KC・CC と車の質量から。約 0.4） */
const REST = 0.4;

/* ===== ゴング ===== */
/** 渦巻きのゴング: 直径 2.3 mm・長さ 1.4 m の鋼線を根元で台に固定。ハンマーは根元から 30 mm を打つ */
const GG = { d: 0.0023, L: 1.4, E: 2.05e11, rho: 7850, nu: 0.29, xh: 0.03, Rc: 0.045 };
interface GongMode {
  f: number;
  /** 0: 巻きの面内、1: 面外 */
  fam: 0 | 1;
  bl: number;
  eta: number;
  /** ハンマーの点での型の値・根元の力（単位の変位あたり）[N/m] */
  phi: number;
  root: number;
}
const sigOf = (bl: number) => (bl > 12 ? 1 : (Math.cosh(bl) + Math.cos(bl)) / (Math.sinh(bl) + Math.sin(bl)));
const phiAt = (bl: number, x: number) => {
  const s = sigOf(bl),
    b = (bl / GG.L) * x;
  /* 大きな βx では cosh − σ sinh を指数で */
  const hyp = bl > 12 ? Math.exp(-b) : Math.cosh(b) - s * Math.sinh(b);
  return hyp - Math.cos(b) + s * Math.sin(b);
};
/** ゴングの型（60 Hz〜6 kHz と、接触を解くための 20 kHz まで） */
function gongAll(fmax: number): GongMode[] {
  const { d, L, E, rho, nu } = GG,
    A = (Math.PI * d * d) / 4,
    I = (Math.PI * d ** 4) / 64,
    c = Math.sqrt((E * I) / (rho * A)),
    out: GongMode[] = [];
  for (let n = 1; n <= 200; n++) {
    const bl = n === 1 ? 1.8751 : n === 2 ? 4.6941 : n === 3 ? 7.8548 : ((2 * n - 1) * Math.PI) / 2,
      beta = bl / L,
      f0 = ((beta * beta) / (2 * Math.PI)) * c;
    if (f0 > fmax) break;
    if (f0 < 60) continue;
    /* 巻き（半径 Rc）による分かれ: 輪の面内と面外の式の比 √((n²+1+ν)/(n²+1))、n は βRc（2 未満は 2） */
    const nr = Math.max(2, beta * GG.Rc),
      split = Math.sqrt((nr * nr + 1 + nu) / (nr * nr + 1)) - 1;
    for (const fam of [0, 1] as const) {
      const f = fam === 0 ? f0 * (1 + split / 2) : f0 * (1 - split / 2),
        w = 2 * Math.PI * f,
        /* 鋼の内部摩擦 2e-4、台のねじ止めの摩擦 2e-4、熱弾性（Zener: Δ 2.4e-3、緩和 d²/(π²κ)、κ 1.4e-5）、空気の粘性 */
        tz = (d * d) / (Math.PI * Math.PI * 1.4e-5),
        ted = (2.4e-3 * w * tz) / (1 + (w * tz) ** 2),
        air = (RHO0 / rho) * 2 * Math.SQRT2 * (Math.sqrt((2 * 1.5e-5) / w) / (d / 2)),
        root = E * I * 2 * sigOf(bl) * beta ** 3;
      out.push({ f, fam, bl, eta: 2e-4 + 2e-4 + ted + air, phi: phiAt(bl, GG.xh), root });
    }
  }
  return out;
}
/** 裏板のゴングの台の点（裏板の座標 [m]）と、台の高さ（面内の力を曲げモーメントに変える腕） */
const GBLOCK = { at: [0.06, 0.05] as Pt, h: 0.015 };
/** 裏板の、台の点での速さの伝わり Y(ω)（面外の力 1 N あたり）と、聞く位置の音圧（板の向こうへ回る分 0.7） */
function backBoard(w: number, Fn: number, M: Pt): { Y: Cx; p: Cx } {
  const B = BACK,
    mB = (B.mu * B.a * B.b) / 4;
  let yr = 0,
    yi = 0,
    pr = 0,
    pi = 0;
  for (const md of B.modes) {
    const ph = sinS(md, B, GBLOCK.at[0], GBLOCK.at[1]),
      g = gradS(md, B, GBLOCK.at[0], GBLOCK.at[1]),
      Q = Fn * ph + M[0] * g[0] + M[1] * g[1],
      r = res(w, 2 * Math.PI * md.f, B.eta),
      v: Cx = [(-w * r[1] * Q) / mB, (w * r[0] * Q) / mB];
    yr += (-w * r[1] * ph * ph) / mB;
    yi += (w * r[0] * ph * ph) / mB;
    const o = cmul(v, farField(B, md, w));
    pr += o[0];
    pi += o[1];
  }
  return { Y: [yr, yi], p: [0.7 * pr, 0.7 * pi] };
}
/** 試験と図のための型の一覧（f・大きさ・減衰） */
export function gongModes(): Mode[] {
  return gongAll(6000).map((g) => ({
    f: g.f,
    amp: Math.abs(g.phi) * (g.fam ? 0.35 : 1),
    decay: 1 / (Math.PI * g.f * g.eta),
  }));
}
/**
 * 打った音を作る。ハンマー（質量 6 g、速さ v0）と線の型を、革の接触 F = K δ^p (1 + λ δ̇) で一緒に解き、
 * 離れたあとの型の振れから、台 → 裏板 → 聞く位置への音を型ごとに足す
 */
function gongSound(fs: number, len: number): Float32Array {
  const ms = gongAll(20000),
    { d, L, rho } = GG,
    mModal = rho * ((Math.PI * d * d) / 4) * L,
    /* ハンマーは面内（巻きの半径の向き）を打つ。面外の族へは打つ面の傾きとねじれで 0.35 */
    proj = ms.map((g) => g.phi * (g.fam ? 0.35 : 1)),
    q = new Float64Array(ms.length),
    qd = new Float64Array(ms.length),
    w0 = ms.map((g) => 2 * Math.PI * g.f);
  /* 革: K は 50 N で 0.25 mm 縮む硬さ、p 2、λ 0.6 s/m */
  const K = 50 / 2.5e-4 ** 2,
    pw = 2,
    lam = 0.6,
    mh = 0.006,
    dt = 1 / 400000;
  let xh = 0,
    vh = 0.7,
    t = 0,
    started = false;
  const force: number[] = [];
  for (let it = 0; it < 4000; it++) {
    let y = 0,
      yd = 0;
    for (let i = 0; i < ms.length; i++) {
      y += proj[i] * q[i];
      yd += proj[i] * qd[i];
    }
    const del = xh - y,
      F = del > 0 ? Math.max(0, K * del ** pw * (1 + lam * (vh - yd))) : 0;
    if (F > 0) started = true;
    force.push(F);
    vh -= (F / mh) * dt;
    xh += vh * dt;
    for (let i = 0; i < ms.length; i++) {
      const a = (F * proj[i]) / mModal - w0[i] * w0[i] * q[i] - ms[i].eta * w0[i] * qd[i];
      qd[i] += a * dt;
      q[i] += qd[i] * dt;
    }
    t += dt;
    if (started && F === 0 && vh < 0) break;
  }
  const tc = t;
  /* 台の力: 面外の族は根元のせん断の力、面内の族は台の高さで曲げモーメントに変わる分（0.2） */
  const n = Math.round(len * fs),
    out = new Float64Array(n);
  for (let i = 0; i < ms.length; i++) {
    const g = ms[i];
    if (g.f > Math.min(12000, fs / 2 - 500)) continue;
    const w = w0[i],
      Fb = g.fam ? g.root : 0.2 * g.root,
      Mb: Pt = g.fam ? [0, (g.root * GBLOCK.h) / 2] : [(g.root * GBLOCK.h) / 2, 0],
      bb = backBoard(w, Fb, Mb),
      /* 裏板へ逃げる分の減衰 η = |c|² Re(Y)/(m ω³)（大きすぎる値は 0.004 で頭打ち） */
      eta = g.eta + Math.min(0.004, (Fb * Fb * Math.max(0, bb.Y[0])) / (mModal * w ** 3)),
      /* 離れた時刻の振れ（q, q̇）から、e^{−ηω t/2}(A cos + B sin) の形で鳴らす */
      sg = (eta * w) / 2,
      wd = w * Math.sqrt(1 - (eta * eta) / 4),
      A0 = q[i],
      B0 = (qd[i] + sg * q[i]) / wd,
      /* 音圧 = 裏板の伝わり（根元の力は変位 q に比例）: p = bb.p × q */
      pr = bb.p[0],
      pim = bb.p[1];
    /* p(t) = Re{(pr + j pim) · q̃(t)}、q̃ は解析信号: q = A cos + B sin → q̃ = (A − jB) e^{jωt} */
    const cr = pr * A0 + pim * B0,
      ci = pim * A0 - pr * B0;
    const amp = Math.hypot(cr, ci);
    if (amp === 0) continue;
    const decay = 1 / sg,
      i0 = Math.round(tc * fs),
      m = Math.min(n - i0, Math.round(decay * fs * 9)),
      rot = [Math.cos(wd / fs), Math.sin(wd / fs)],
      ed = Math.exp(-sg / fs);
    let zr = cr,
      zi = ci;
    for (let k = 0; k < m; k++) {
      out[i0 + k] += zr;
      const nr = (zr * rot[0] - zi * rot[1]) * ed;
      zi = (zr * rot[1] + zi * rot[0]) * ed;
      zr = nr;
    }
  }
  /*
   * ハンマーの当たりの力は、30 mm の所では線が硬いので、ほぼ静的に根元へ行く。面内の力なので台の高さで曲げに変わる分（0.2）が
   * 裏板そのものを鳴らす（どん、という音）
   */
  const fsr = 400000,
    Jt = force.reduce((s, v) => s + v, 0) / fsr;
  const tauH = force.filter((v) => v > 0).length / fsr;
  const thump = new Float64Array(n);
  for (const md of BACK.modes) {
    if (md.f > 8000) continue;
    const w = 2 * Math.PI * md.f,
      mB = (BACK.mu * BACK.a * BACK.b) / 4,
      ph = sinS(md, BACK, GBLOCK.at[0], GBLOCK.at[1]),
      pulse = halfSine(md.f, tauH),
      ff = farField(BACK, md, w),
      /* 単位の力積の応答: 速さ v(t) = (J φ/m) e^{−σt} cos(ωt)。音圧 = v × ff */
      amp = ((0.2 * Jt * ph) / mB) * Math.hypot(pulse[0], pulse[1]) * 0.7,
      z: Cx = cmul([amp, 0], ff),
      sg = (BACK.eta * w) / 2,
      mm = Math.min(n, Math.round((9 / sg) * fs)),
      rot = [Math.cos(w / fs), Math.sin(w / fs)],
      ed = Math.exp(-sg / fs);
    let zr = z[0],
      zi = z[1];
    for (let k = 0; k < mm; k++) {
      thump[k] += zr;
      const nr = (zr * rot[0] - zi * rot[1]) * ed;
      zi = (zr * rot[1] + zi * rot[0]) * ed;
      zr = nr;
    }
  }
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = out[i] + thump[i];
  return o;
}

/* ===== 音の種類 ===== */
type Var = 0 | 1;
export type SfxKind =
  | 'tickL'
  | 'tickR'
  | `h-${EscType}-${0 | 1}-${Var}`
  | `r-${EscType}-${0 | 1}`
  | 'gong'
  | 'clickT'
  | 'clickS'
  | 'lock'
  | 'bank';
const TYPES_: EscType[] = ['recoil', 'graham', 'brocot'];
/** 開いたときに作っておく音（時打ちの音は初めて鳴らすときに作る） */
export const SFX_PRELOAD: readonly SfxKind[] = [
  ...TYPES_.flatMap((t) =>
    ([0, 1] as const).flatMap((s) => [`h-${t}-${s}-0`, `h-${t}-${s}-1`, `r-${t}-${s}`] as SfxKind[]),
  ),
  'clickT',
  'clickS',
  'lock',
  'bank',
];
/** 出来事 1 つで鳴らす音。dt は出来事の時刻からのずれ [s] */
export interface Cue {
  kind: SfxKind;
  gain: number;
  dt?: number;
}
/**
 * 音の全体の大きさ: 1 Pa を何倍して鳴らすか。ページの既定の大きさ（−26 LUFS ほど）に合わせた値
 */
const CAL = 0.38,
  /* 弱い当たり（跳ね返り）の型は近づく速さ 1/4 で作る */
  VWEAK = 0.25;
/** 当たりの力積 J [N·s] のうち、衝突の分（(1 + e) m v を超える分は静かに押す力なので除く） */
function impactJ(e: Extract<ClockEvent, { k: 'hit' }>, type: EscType): number {
  const m = meff([e.x, e.y], [e.nx, e.ny]),
    nm = NOM[type][e.side],
    /* 動かし始め（型を替えたとき）の大きな食い込みは数えない: 定常の落ちる当たりの 1.3 倍で頭打ち */
    jn = (1 + REST) * meff(nm.p, nm.n) * nm.v * 1e-3;
  return Math.min(e.J, (1 + REST) * m * Math.abs(e.v) * 1e-3, 1.3 * jn);
}
/**
 * 型ごとの大きさの補正。計算どおりの力積ではグラハム式とブロコ式の差が 15 dB になる（グラハム式は力が歯先の円に沿い、
 * 車の慣性の効く腕が長く質量が小さい。ブロコ式は落ちる速さが大きい）。聞き比べやすいよう、リコイル式との差を dB で半分にする
 */
const TYPE_EQ: Record<EscType, number> = { recoil: 1, graham: 1.5, brocot: 0.64 };
/**
 * 出来事を音へ割り当てる。live は実際の速さ以下で動かしているとき（刻む音と時打ちはそのときだけ鳴らす）
 */
export function cue(e: ClockEvent, type: EscType, live: boolean): Cue[] {
  if (e.k === 'click') return [{ kind: e.w === 'T' ? 'clickT' : 'clickS', gain: 0.22 }];
  if (!live) return [];
  switch (e.k) {
    case 'hit': {
      /* 刻む音: 当たりの始まり（t − d）に、衝突の力積に比例した大きさで鳴らす。単位は 1e-5 N·s */
      const J = impactJ(e, type) / 1e-5,
        nom = NOM[type][e.side].v,
        vr: Var = Math.abs(e.v) > nom * 0.45 ? 0 : 1;
      if (J < 0.01) return [];
      return [{ kind: `h-${type}-${e.side}-${vr}`, gain: CAL * TYPE_EQ[type] * J, dt: -e.d }];
    }
    case 'free':
      /* 爪が歯を放す: 押していた力 F [N] が抜ける */
      return e.F && e.F > 2e-4 ? [{ kind: `r-${type}-${e.side}`, gain: CAL * TYPE_EQ[type] * (e.F / 0.01) }] : [];
    case 'bank':
      return [{ kind: 'bank', gain: Math.min(1, 0.4 + 2 * e.v) }];
    case 'gong':
      return [{ kind: 'gong', gain: 0.5 * Math.min(1, 0.5 + 0.5 * e.f) }];
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
/** 刻む音の音圧のものさし: 単位の力積 1e-5 N·s・当たり 1 つで出る音圧 [Pa] をこの倍にして返す */
const TICK_SCALE = 1e-5 * 100,
  REL_SCALE = 100;
/** 刻む音の FFT の長さ（0.34 s ほど） */
const fftN = (fs: number) => {
  let N = 1;
  while (N < 0.33 * fs) N <<= 1;
  return N;
};
function tickKind(type: EscType, side: 0 | 1, vr: Var, fs: number): Float32Array {
  const nm = NOM[type][side],
    g = tickGrid(type, side, fs, fftN(fs)),
    tau = hertzTau(meff(nm.p, nm.n), RTIP[type], (nm.v * (vr ? VWEAK : 1)) / 1000);
  return synth(
    g,
    (f) => {
      const s = halfSine(f, tau);
      return [s[0] * TICK_SCALE, s[1] * TICK_SCALE];
    },
    0.3,
  );
}
/** 爪が歯を放すとき、力 0.01 N が 0.4 ms で抜ける（歯先が爪の端を滑り落ちる） */
function releaseKind(type: EscType, side: 0 | 1, fs: number): Float32Array {
  const g = tickGrid(type, side, fs, fftN(fs));
  return synth(
    g,
    (f) => {
      const s = release(f, 4e-4);
      /* 抜けるのは押していた向き（当たりと逆の符号）。大きさは 0.01 N あたり */
      return [-s[0] * 0.01 * REL_SCALE, -s[1] * 0.01 * REL_SCALE];
    },
    0.3,
  );
}
function partKind(key: string, b: number, arbor: Arbor | null, tau: number, own: [number, number][], fs: number) {
  const g = partGrid(key, b, arbor, own, fs, fftN(fs));
  return synth(g, (f) => halfSine(f, tau), 0.3);
}
const peak1 = (b: Float32Array) => {
  let mx = 0;
  for (const v of b) mx = Math.max(mx, Math.abs(v));
  if (mx > 0) for (let i = 0; i < b.length; i++) b[i] /= mx;
  return b;
};
/** 効果音を作る */
export function makeSfx(kind: SfxKind, fs: number): Float32Array {
  switch (kind) {
    case 'tickL':
      return peak1(tickKind('recoil', 0, 0, fs));
    case 'tickR':
      return peak1(tickKind('recoil', 1, 0, fs));
    case 'gong': {
      const b = gongSound(fs, 7);
      let mx = 0;
      for (const v of b) mx = Math.max(mx, Math.abs(v));
      for (let i = 0; i < b.length; i++) b[i] /= mx;
      return b;
    }
    /* こはぜ: 鋼のこはぜ（約 0.2 g）が角穴車の歯へ落ちる。香箱の軸は太く短い（2.2 kHz）。こはぜのばねの型 3.1・7.4 kHz */
    case 'clickT':
      return peak1(
        partKind(
          'cT',
          4,
          { f: [2200], w: [1], eta: 0.06 },
          3e-5,
          [
            [3100, 1],
            [7400, 0.5],
          ],
          fs,
        ),
      );
    case 'clickS':
      return peak1(
        partKind(
          'cS',
          5,
          { f: [2200], w: [1], eta: 0.06 },
          3e-5,
          [
            [3300, 1],
            [7900, 0.5],
          ],
          fs,
        ),
      );
    /* 止め: 鋼の止めレバーが止め車のピンに当たる（レバーの型 2.6・5.8 kHz） */
    case 'lock':
      return peak1(
        partKind(
          'lk',
          6,
          { f: [1300, 4200], w: [0.8, 0.2], eta: 0.05 },
          8e-5,
          [
            [2600, 1],
            [5800, 0.5],
          ],
          fs,
        ),
      );
    /* 竿が当たり止め（箱の側）に当たる: 前板の下を長さ 2 ms の力で打つ */
    case 'bank':
      return peak1(partKind('bk', 7, null, 0.002, [], fs));
    default: {
      const [h, t, s, v] = kind.split('-') as [string, EscType, string, string];
      if (h === 'h') return tickKind(t, +s as 0 | 1, +v as Var, fs);
      return releaseKind(t, +s as 0 | 1, fs);
    }
  }
}

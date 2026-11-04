/**
 * 式で求める部分: 大気圏突入（Collins ほか 2005）、クレーターの大きさ（Collins ほか 2005、Richardson 2009）、
 * 単純クレーターと複雑クレーターの境（Schenk ほか 2021）、噴出物の速度（Housen & Holsapple 2011）
 */
export type BodyKey = 'earth' | 'moon' | 'mars' | 'venus';
export type TargetKey = 'rock' | 'sand' | 'water';
export type ImpactorKey = 'stone' | 'iron' | 'ice';

export interface Body {
  nm: string;
  /** 表面重力 [m/s²] */
  g: number;
  /** 地表の大気の密度 [kg/m³] */
  rho0: number;
  /** 大気のスケールハイト [m] */
  H: number;
  /** 半径 [m] */
  R: number;
}

export const BODIES: Record<BodyKey, Body> = {
  earth: { nm: '地球', g: 9.81, rho0: 1, H: 8000, R: 6371e3 },
  moon: { nm: '月', g: 1.62, rho0: 0, H: 1, R: 1737e3 },
  mars: { nm: '火星', g: 3.71, rho0: 0.02, H: 11100, R: 3390e3 },
  venus: { nm: '金星', g: 8.87, rho0: 65, H: 15900, R: 6052e3 },
};

/** Richardson 2009 の表 1 の K1・μ・Y と密度 */
export const TARGETS: Record<TargetKey, { nm: string; K1: number; mu: number; Y: number; rho: number }> = {
  rock: { nm: '岩石', K1: 0.2, mu: 0.55, Y: 7.6e6, rho: 2500 },
  sand: { nm: '砂', K1: 0.24, mu: 0.41, Y: 0, rho: 1750 },
  water: { nm: '水', K1: 2.3, mu: 0.55, Y: 0, rho: 1000 },
};

export const IMPACTORS: Record<ImpactorKey, { nm: string; rho: number }> = {
  stone: { nm: '岩石', rho: 3000 },
  iron: { nm: '鉄', rho: 7800 },
  ice: { nm: '氷', rho: 1000 },
};

/** 噴出物の速度の定数（Housen & Holsapple 2011 の表 3。岩石の重力域は水と同じ μ の組を使う） */
export interface EjectaLaw {
  mu: number;
  C1: number;
  H1: number;
  n2: number;
  p: number;
  /** 強度域の v の係数 C1 (H2 ∛(4π/3))^(−1/μ) √(Y/ρ) [m/s]。ないときは 0 */
  strengthV: number;
}
const rockStrengthV = 1.5 * (1.1 * Math.cbrt((4 * Math.PI) / 3)) ** (-1 / 0.55) * Math.sqrt(30e6 / 3000);
export const EJECTA: Record<TargetKey, EjectaLaw> = {
  rock: { mu: 0.55, C1: 1.5, H1: 0.68, n2: 1.5, p: 0.5, strengthV: rockStrengthV },
  water: { mu: 0.55, C1: 1.5, H1: 0.68, n2: 1.5, p: 0.5, strengthV: 0 },
  sand: { mu: 0.41, C1: 0.55, H1: 0.59, n2: 1.3, p: 0.3, strengthV: 0 },
};

/** 噴出物の放出速度 [m/s]。x は衝突点からの距離、Rc はクレーターの半径 */
export function ejectaSpeed(law: EjectaLaw, x: number, Rc: number, g: number): number {
  const a = law.C1 * law.H1 ** (-(2 + law.mu) / (2 * law.mu)) * Math.sqrt(g * Rc),
    base = Math.max(a, law.strengthV),
    tail = 1 - x / (law.n2 * Rc);
  return tail <= 0 ? 0 : base * (x / Rc) ** (-1 / law.mu) * tail ** law.p;
}

export type EntryKind = 'none' | 'intact' | 'breakup' | 'airburst';
export interface Entry {
  kind: EntryKind;
  /** 地面（または空中で止まる高度）での速度 [m/s] */
  v: number;
  /** 砕ける高度 [m] */
  zs?: number;
  /** 空中で爆発する高度 [m] */
  zb?: number;
}

/** 大気圏突入。L は直径 [m]、v0 は大気に入る前の速度 [m/s]、th は入射角 [°] */
export function entry(L: number, rhoi: number, v0: number, th: number, body: Body, air: boolean): Entry {
  if (!air || body.rho0 === 0) return { kind: 'none', v: v0 };
  const s = Math.sin((th * Math.PI) / 180),
    CD = 2,
    fp = 7,
    { H, rho0 } = body,
    rho = (z: number) => rho0 * Math.exp(-z / H),
    Yi = 10 ** (2.107 + 0.0624 * Math.sqrt(rhoi)),
    If = (4.07 * CD * H * Yi) / (rhoi * L * v0 * v0 * s),
    vIntact = (z: number) => v0 * Math.exp((-3 * rho(z) * CD * H) / (4 * rhoi * L * s));
  if (If >= 1) return { kind: 'intact', v: vIntact(0) };
  const zs = -H * (Math.log(Yi / (rho0 * v0 * v0)) + 1.308 - 0.314 * If - 1.303 * Math.sqrt(1 - If)),
    rhoS = rho(zs),
    vs = vIntact(zs),
    l = L * s * Math.sqrt(rhoi / (CD * rhoS)),
    Lz = (z: number) => L * Math.sqrt(1 + ((2 * H) / l) ** 2 * (Math.exp((zs - z) / (2 * H)) - 1) ** 2),
    zb = zs - 2 * H * Math.log(1 + (l / (2 * H)) * Math.sqrt(fp * fp - 1)),
    zEnd = Math.max(zb, 0);
  let I = 0;
  const N = 80;
  for (let i = 0; i < N; i++) {
    const z = zEnd + ((zs - zEnd) * (i + 0.5)) / N;
    I += Math.exp((zs - z) / H) * Lz(z) ** 2 * ((zs - zEnd) / N);
  }
  const v = vs * Math.exp((-0.75 * CD * rhoS * I) / (rhoi * L ** 3 * s));
  return zb > 0 ? { kind: 'airburst', v, zs, zb } : { kind: 'breakup', v, zs };
}

/**
 * 一時的なクレーターの直径 [m]。岩石と水は Collins ほか 2005 の式で、小さい衝突では Richardson 2009 の式の
 * 強度の分だけ小さくする。砂は Richardson 2009 の式
 */
export function transientD(L: number, rhoi: number, v: number, th: number, g: number, target: TargetKey): number {
  const T = TARGETS[target],
    a = L / 2,
    sin = Math.sin((th * Math.PI) / 180),
    vv = v * sin,
    c1 = 1 + 0.5 * T.mu,
    c2 = (-3 * T.mu) / (2 + T.mu),
    pi2 = (g * a) / (vv * vv),
    pi3 = T.Y / (T.rho * vv * vv),
    pi4 = T.rho / rhoi,
    piG = T.K1 * (pi2 * pi4 ** (-1 / 3)) ** c2,
    piV = T.K1 * (pi2 * pi4 ** (-1 / 3) + pi3 ** c1) ** c2;
  if (target === 'sand') {
    const m = (4 / 3) * Math.PI * a ** 3 * rhoi;
    return 2 * Math.cbrt((3 * piV * (m / T.rho)) / Math.PI);
  }
  const k = target === 'water' ? 1.365 : 1.161;
  return k * Math.cbrt(rhoi / T.rho) * L ** 0.78 * v ** 0.44 * g ** -0.22 * Math.cbrt(sin) * Math.cbrt(piV / piG);
}

/** 単純クレーターから複雑クレーターに変わる直径 [m]（Schenk ほか 2021 の図 7 の当てはめ） */
export const transitionD = (g: number): number => 10 ** (-0.5484575694575697 * Math.log10(g) + 4.201369948094472);

export type CraterKind = '単純クレーター' | '中央丘クレーター' | 'ピークリング' | '衝突盆地';
export interface FinalCrater {
  kind: CraterKind;
  /** 単純と複雑の境の直径 [m] */
  Dc: number;
  /** 縁から縁までの直径 [m] */
  Dfr: number;
  /** 縁から底までの深さ [m] */
  dfr: number;
  /** 衝突前の地面からの縁の高さ [m] */
  hfr: number;
}

/**
 * 完成したクレーターの大きさ（Collins ほか 2005）。複雑クレーターの深さの式は金星の値なので、
 * 月の d = 1.044 D^0.301（Pike 1977）に合うように重力で直して使う
 */
export function finalCrater(Dtc: number, g: number): FinalCrater {
  const Dc = transitionD(g),
    dtc = Dtc / (2 * Math.SQRT2);
  if (Dtc * 1.25 <= Dc) {
    const Dfr = 1.25 * Dtc,
      hfr = (0.07 * Dtc ** 4) / Dfr ** 3,
      Vbr = 0.032 * Dfr ** 3,
      tbr = (2.8 * Vbr * (dtc + hfr)) / (dtc * Dfr * Dfr);
    return { kind: '単純クレーター', Dc, Dfr, hfr, dfr: dtc + hfr - tbr };
  }
  const Dfr = (1.17 * Dtc ** 1.13) / Dc ** 0.13,
    hfr = (0.07 * Dtc ** 4) / Dfr ** 3,
    dfr = 1000 * 0.4 * (Dfr / 1000) ** 0.3 * (9.81 / g) ** 0.53;
  return { kind: Dfr > 500e3 ? '衝突盆地' : Dfr > 7 * Dc ? 'ピークリング' : '中央丘クレーター', Dc, Dfr, hfr, dfr };
}

export interface Condition {
  /** 衝突体の直径 [m] */
  L: number;
  /** 大気に入る前の速度 [km/s] */
  v: number;
  /** 入射角 [°] */
  th: number;
  body: BodyKey;
  air: boolean;
  imp: ImpactorKey;
  tgt: TargetKey;
  /** 計算の細かさ（直径あたりの格子の数） */
  q: number;
}

export interface Plan {
  e: Entry;
  /** 地面での速度 [m/s] */
  vS: number;
  /** 衝突のエネルギー [J] */
  E: number;
  /** 一時的なクレーターの直径 [m] */
  Dtc: number;
  f: FinalCrater;
  /** 真上から当たったときの一時的なクレーターの直径 [m] */
  size: number;
  /** 計算の範囲の基準にする直径 [m]（完成したクレーターが収まる大きさ） */
  domain: number;
  /** 断面の計算で球の代わりに使う円柱の直径 [m] */
  Lc: number;
  /** 岩の振動の強さ（音響流動化） */
  cVib: number;
}

/** 入力から、式の値と計算の条件を求める */
export function plan(c: Condition): Plan {
  const b = BODIES[c.body],
    I = IMPACTORS[c.imp],
    T = TARGETS[c.tgt],
    e = entry(c.L, I.rho, c.v * 1000, c.th, b, c.air),
    vS = Math.max(e.v, 500),
    E = (Math.PI / 6) * I.rho * c.L ** 3 * 0.5 * vS * vS,
    Dtc = transientD(c.L, I.rho, vS, c.th, b.g, c.tgt),
    size = Math.max(transientD(c.L, I.rho, vS, 90, b.g, c.tgt), 1),
    f = finalCrater(Dtc, b.g),
    domain = Math.max(size, finalCrater(size, b.g).Dfr / 1.25),
    /* 幅が式の直径に近づく円柱の直径（断面の計算で求めた較正）。衝突体の直径を超えない */
    X = (size * b.g) / 98100,
    Lc = Math.min(
      c.L,
      0.9 *
        size *
        (X > 1 ? 0.03 * X ** 0.33 : Math.max(0.022, 0.03 * X ** 0.235)) *
        (vS / 20000) ** -0.67 *
        Math.sqrt((T.rho / 2500) * (2700 / I.rho)) *
        (9.81 / b.g) ** 0.15,
    ),
    /* 衝撃波の振動の強さ（崩壊の深さが式に近づく値） */
    cVib = 0.15;
  return { e, vS, E, Dtc, f, size, domain, Lc, cVib };
}

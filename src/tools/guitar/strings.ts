/**
 * 弦の物理量（DOM に依存しない）: 材質・外径・張力 → 線密度・曲げ剛性・振動モードの周波数と内部損失。
 * 損失の形は Woodhouse (2004) の式に、空気の粘性による損失（Valette 1995）を足したもの
 */

/** 空気の密度 [kg/m³]・粘性率 [Pa·s]・音速 [m/s] */
export const AIR = { rho: 1.2, eta: 1.8e-5, c: 343 } as const;
/** 巻線の充填率（丸線を巻いたときに、巻線の層の断面のうち線が占める割合） */
export const WRAP_FILL = 0.8;

/** 弦の材質 */
export interface Material {
  v: string;
  name: string;
  /** 巻弦か */
  wound: boolean;
  /** 密度 [kg/m³]（巻弦は芯線） */
  rho: number;
  /** 巻線の密度 [kg/m³] */
  rhoW: number;
  /** 芯線の直径 ÷ 外径（巻弦。プレーン弦は 1） */
  core: number;
  /** 曲げのヤング率 [Pa]（芯線の直径で曲げ剛性を求める実効値） */
  E: number;
  /** 張力の側の損失係数（内部摩擦） */
  etaF: number;
  /** 低い周波数で増える損失の係数 [1/s]（空気の粘性の分を除いた残り。巻弦の巻線の摩擦など） */
  etaX: number;
  /** 曲げの側の損失係数（粘弾性） */
  etaB: number;
  /** 縦波の速さを決めるヤング率 [Pa]（芯線の断面で張力を受け持つ。こすれる音の静的な共振に使う） */
  Eax: number;
}

/**
 * 材質。ナイロンとナイロン芯の巻弦の損失係数は Woodhouse (2004) の Table I（D'Addario Pro Arte、
 * 1〜3 弦と 4〜6 弦の平均）から、空気の粘性の分を除いて決めた。スチールの損失は Cuesta・Valette の値の範囲から選んだ
 */
export const MATERIALS: readonly Material[] = [
  {
    v: 'nylon',
    name: 'ナイロン',
    wound: false,
    rho: 1140,
    rhoW: 0,
    core: 1,
    E: 9e9,
    etaF: 3.1e-4,
    etaX: 0.7,
    etaB: 1.5e-2,
    Eax: 4e9,
  },
  {
    v: 'nylonw',
    name: '銅巻（ナイロン芯）',
    wound: true,
    rho: 1140,
    rhoW: 8960,
    core: 0.5,
    E: 9e9,
    etaF: 4.7e-5,
    etaX: 2.0,
    etaB: 1.1e-2,
    Eax: 4e9,
  },
  {
    v: 'steel',
    name: 'スチール',
    wound: false,
    rho: 7850,
    rhoW: 0,
    core: 1,
    E: 2e11,
    etaF: 5.6e-5,
    etaX: 0,
    etaB: 1e-3,
    Eax: 2e11,
  },
  {
    v: 'bronze',
    name: 'ブロンズ巻（スチール芯）',
    wound: true,
    rho: 7850,
    rhoW: 8860,
    core: 0.43,
    E: 2e11,
    etaF: 1e-4,
    etaX: 0.3,
    etaB: 1e-3,
    Eax: 2e11,
  },
];
export const matOf = (v: string): Material => MATERIALS.find((m) => m.v === v) ?? MATERIALS[0];

/** 1 本の弦の指定（1 弦から順に並べる） */
export interface StringSpec {
  /** 材質（Material.v） */
  m: string;
  /** 外径 [m] */
  d: number;
  /** 張力 [N] */
  T: number;
}

/** 調弦: 1 弦から 6 弦の開放弦の音（MIDI のノート番号） */
export interface Tuning {
  v: string;
  name: string;
  notes: readonly number[];
}
export const TUNINGS: readonly Tuning[] = [
  { v: 'std', name: '標準', notes: [64, 59, 55, 50, 45, 40] },
  { v: 'dropd', name: 'ドロップ D', notes: [64, 59, 55, 50, 45, 38] },
  { v: 'dadgad', name: 'DADGAD', notes: [62, 57, 55, 50, 45, 38] },
  { v: 'opg', name: 'オープン G', notes: [62, 59, 55, 50, 43, 38] },
];
export const tuningOf = (v: string): Tuning => TUNINGS.find((t) => t.v === v) ?? TUNINGS[0];

/** 弦のセット（外径と張力は標準の調弦に合わせた値） */
export interface StringSet {
  v: 'nylon' | 'steel';
  name: string;
  /** 弦長（スケール） [m] */
  L: number;
  /** フレットの数 */
  frets: number;
  strings: readonly StringSpec[];
}
/**
 * クラシックの線密度と張力は Woodhouse (2004) の Table I（D'Addario Pro Arte Composites、ハードテンション）、
 * 外径はその線密度になる値。スチールは D'Addario EJ16（フォスファーブロンズ、ライト .012〜.053）の表から
 */
export const SETS: readonly StringSet[] = [
  {
    v: 'nylon',
    name: 'クラシック（ナイロン弦）',
    L: 0.65,
    frets: 19,
    strings: [
      { m: 'nylon', d: 0.65e-3, T: 70.3 },
      { m: 'nylon', d: 0.76e-3, T: 53.4 },
      { m: 'nylon', d: 1.0e-3, T: 58.3 },
      { m: 'nylonw', d: 0.66e-3, T: 71.2 },
      { m: 'nylonw', d: 0.9e-3, T: 73.9 },
      { m: 'nylonw', d: 1.18e-3, T: 71.6 },
    ],
  },
  {
    v: 'steel',
    name: 'アコースティック（スチール弦）',
    L: 0.645,
    frets: 20,
    strings: [
      { m: 'steel', d: 0.305e-3, T: 104.1 },
      { m: 'steel', d: 0.406e-3, T: 103.6 },
      { m: 'bronze', d: 0.61e-3, T: 133.9 },
      { m: 'bronze', d: 0.813e-3, T: 133 },
      { m: 'bronze', d: 1.067e-3, T: 128.5 },
      { m: 'bronze', d: 1.346e-3, T: 110.8 },
    ],
  },
];
export const setOf = (v: string): StringSet => SETS.find((s) => s.v === v) ?? SETS[0];

/** 平均律の周波数（A4 = 440 Hz） */
export const noteHz = (n: number): number => 440 * 2 ** ((n - 69) / 12);
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** 音名（C4 = 60） */
export const noteName = (n: number): string => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

/** 弦の物理量 */
export interface StringPhys {
  mat: Material;
  /** 外径・芯線の直径 [m] */
  d: number;
  dc: number;
  /** 線密度 [kg/m] */
  mu: number;
  /** 曲げ剛性 EI [N·m²] */
  B: number;
  T: number;
  /** 巻線の直径（巻きのピッチ） [m]。プレーン弦は 0 */
  pw: number;
}

/** 材質・外径・張力から線密度と曲げ剛性を求める */
export function stringPhys(s: StringSpec): StringPhys {
  const mat = matOf(s.m),
    dc = s.d * mat.core,
    q = Math.PI / 4;
  const mu = mat.wound
    ? q * (mat.rho * dc * dc + WRAP_FILL * mat.rhoW * (s.d * s.d - dc * dc))
    : q * mat.rho * s.d * s.d;
  return { mat, d: s.d, dc, mu, B: (mat.E * Math.PI * dc ** 4) / 64, T: s.T, pw: mat.wound ? (s.d - dc) / 2 : 0 };
}

/** 振動する長さ L [m] の第 1 部分音の周波数（曲げ剛性を含む） */
export const f1Of = (p: StringPhys, L: number): number =>
  (Math.sqrt(p.T / p.mu) / (2 * L)) * Math.sqrt(1 + (Math.PI ** 2 * p.B) / (p.T * L * L));

/** 開放弦の第 1 部分音を f にする張力（曲げ剛性の分を差し引く） */
export const tensionFor = (p: Omit<StringPhys, 'T'>, L: number, f: number): number =>
  4 * L * L * p.mu * f * f - (Math.PI ** 2 * p.B) / (L * L);

/** 非調和性係数 β（f_n = n f₀ √(1 + β n²)） */
export const betaOf = (p: StringPhys, L: number): number => (Math.PI ** 2 * p.B) / (p.T * L * L);

/** フレット n の位置（ナットから） [m] */
export const fretX = (L: number, n: number): number => L * (1 - 2 ** (-n / 12));

/** 空気の粘性による損失係数（Valette）。外径 d [m]・線密度 mu [kg/m]・周波数 f [Hz] */
export const etaAir = (d: number, mu: number, f: number): number =>
  (AIR.eta + d * Math.sqrt(Math.PI * AIR.eta * AIR.rho * f)) / (mu * f);

/**
 * 弦だけの損失係数 η（モードの減衰率は η ω / 2）。
 * η = η_air(f) + η_X / ω + (T η_F + B k² η_B) / (T + B k²)、k = nπ / L
 */
export function etaString(p: StringPhys, L: number, n: number, f: number): number {
  const k = (n * Math.PI) / L,
    bk = p.B * k * k,
    m = p.mat;
  return etaAir(p.d, p.mu, f) + m.etaX / (2 * Math.PI * f) + (p.T * m.etaF + bk * m.etaB) / (p.T + bk);
}

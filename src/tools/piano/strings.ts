/**
 * ピアノの弦（DOM に依存しない）: 鍵ごとの弦の長さ・太さ・張力・本数（スケーリング）、硬い弦の周波数、損失、調律。
 * 弦の周波数は両端を単純支持した硬い弦（Fletcher 1964）、損失の形はギターと同じく Valette の空気の粘性と
 * 張力・曲げの内部損失の和。鍵は MIDI のノート番号（A0 = 21 〜 C8 = 108）で表す
 */
import { AIR, etaAir } from '../guitar/strings';

export { AIR, etaAir };

/** 鍵の範囲 */
export const KEY_LO = 21,
  KEY_HI = 108,
  KEYS = KEY_HI - KEY_LO + 1;

/** 鋼（ピアノ線）と、巻線の銅の密度 [kg/m³]・ヤング率 [Pa] */
export const STEEL = { rho: 7850, E: 2.0e11 } as const;
export const COPPER = { rho: 8960 } as const;
/** 巻線の充填率 */
const WRAP_FILL = 0.8;

/**
 * ピアノの大きさ: 最も長い弦の長さの上限 [m]・響板の面積 [m²]・響板の最も低いモード [Hz]。
 * 最も低いモードは実測の値（コンサートグランド 62 Hz: Wogram 1980、グランド 75 Hz: Miranda Valiente ら 2024、
 * アップライト 81 Hz: Ege・Boutillon・Rébillat 2013）。弦長と面積は概数
 */
export interface PianoType {
  v: 'concert' | 'grand' | 'upright';
  name: string;
  /** 奥行き（アップライトは高さ） [cm] */
  size: number;
  Lmax: number;
  area: number;
  f1: number;
}
export const PIANO_TYPES: readonly PianoType[] = [
  { v: 'concert', name: 'コンサートグランド', size: 274, Lmax: 2.1, area: 2.4, f1: 62 },
  { v: 'grand', name: 'グランド', size: 211, Lmax: 1.62, area: 1.9, f1: 75 },
  { v: 'upright', name: 'アップライト', size: 131, Lmax: 1.2, area: 1.4, f1: 81 },
];
export const pianoTypeOf = (v: string): PianoType => PIANO_TYPES.find((p) => p.v === v) ?? PIANO_TYPES[0];

/** 平均律の周波数（A4 = a4 Hz） */
export const noteHz = (n: number, a4 = 440): number => a4 * 2 ** ((n - 69) / 12);
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** 音名（C4 = 60） */
export const noteName = (n: number): string => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
/** 黒鍵か */
export const isBlack = (n: number): boolean => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

/** 1 つの鍵の弦（ユニゾンの各弦は同じ寸法） */
export interface KeyString {
  key: number;
  /** 弦の本数（1〜3） */
  ns: number;
  /** 振動する長さ [m] */
  L: number;
  /** 外径・芯線の直径 [m]（プレーン弦は同じ） */
  d: number;
  dc: number;
  wound: boolean;
  /** 線密度 [kg/m]・曲げ剛性 EI [N·m²]・張力 [N] */
  mu: number;
  B: number;
  T: number;
}

/* ---------- スケーリング ---------- */
/** 最も高い C8 の弦長 [m] と、高音部の 1 オクターブあたりの弦長の比 */
const L_C8 = 0.051,
  OCT_RATIO = 1.92;
/** 巻弦にする上限（この鍵まで巻弦）・1 本弦と 2 本弦の上限（Engelbrecht・Mägi・Stulov 1999 の中型グランド: 1〜10 鍵が 1 本、11〜25 鍵が 2 本の巻弦） */
const WOUND_HI = 45,
  SINGLE_HI = 30,
  DOUBLE_HI = 45;

/** 振動する長さ [m]: 高音部は 1 オクターブで OCT_RATIO 倍、低音部は大きさの上限へ滑らかに縮める */
export function lengthOf(key: number, t: PianoType): number {
  const lp = L_C8 * OCT_RATIO ** ((KEY_HI - key) / 12);
  return lp / Math.sqrt(1 + (lp / t.Lmax) ** 2);
}

/** プレーン弦の外径 [m]（C8 の 0.775 mm から A♯2 の 1.125 mm へ太くする。Engelbrecht ら 1999 の表の範囲） */
const plainD = (key: number) => (0.775 + ((1.125 - 0.775) * Math.min(62, KEY_HI - key)) / 62) * 1e-3;

/** 巻弦の芯線 [m] と張力の目安 [N]（低い弦ほど太く強く張る） */
function woundDesign(key: number): { dc: number; T: number } {
  const u = (WOUND_HI - key) / (WOUND_HI - KEY_LO);
  return { dc: (1.15 + 0.45 * u) * 1e-3, T: 750 + 850 * u };
}

/**
 * 鍵 key の弦。f は第 1 部分音の周波数（調律で決まる）。プレーン弦は外径を決めて張力を求め、
 * 巻弦は芯線と張力の目安を決めて、音程が合う線密度になる巻線の太さを求める
 */
export function keyString(key: number, t: PianoType, f: number): KeyString {
  const L = lengthOf(key, t),
    ns = key <= SINGLE_HI ? 1 : key <= DOUBLE_HI ? 2 : 3,
    q = Math.PI / 4;
  if (key > WOUND_HI) {
    const d = plainD(key),
      mu = q * STEEL.rho * d * d,
      B = (STEEL.E * Math.PI * d ** 4) / 64;
    /* f1 = (1/2L) √(T/μ) √(1 + π² B / (T L²)) → T = 4 L² μ f² − π² B / L² */
    return { key, ns, L, d, dc: d, wound: false, mu, B, T: 4 * L * L * mu * f * f - (Math.PI ** 2 * B) / (L * L) };
  }
  const { dc, T } = woundDesign(key),
    B = (STEEL.E * Math.PI * dc ** 4) / 64,
    mu = (T + (Math.PI ** 2 * B) / (L * L)) / (4 * L * L * f * f),
    d = Math.sqrt(dc * dc + (mu / q - STEEL.rho * dc * dc) / (WRAP_FILL * COPPER.rho));
  return { key, ns, L, d, dc, wound: true, mu, B, T };
}

/** 非調和性係数 B（f_n = n f₀ √(1 + B n²)） */
export const inharm = (s: KeyString): number => (Math.PI ** 2 * s.B) / (s.T * s.L * s.L);
/** 弦だけの周波数 f₀ = (1/2L)√(T/μ)（曲げ剛性なし） */
export const f0Of = (s: KeyString): number => Math.sqrt(s.T / s.mu) / (2 * s.L);
/** 第 n 部分音の周波数 */
export const partialHz = (s: KeyString, n: number): number => n * f0Of(s) * Math.sqrt(1 + inharm(s) * n * n);

/**
 * ピアノ線の損失係数: 張力の側（熱弾性 Q⁻¹）・曲げの側（粘弾性 δ）は、Ege・Chaigne（arXiv:1101.4511）が両端を固定して測った
 * ピアノ線（L = 28.1 cm、f₁ = 810 Hz）の第 1〜6 部分音の減衰率（第 3 部分音を除く）に、Valette の損失の形で
 * 合わせた値（外径 0.95 mm とした。ギターの鋼弦の値 2.03 × 10⁻⁴・0.0045 では 3〜4 kHz の減衰が 2 倍ほど速い）。
 * 低い周波数で増える分 [1/s]（巻弦の巻線の摩擦）は概数
 */
const ETA_F = 1.25e-4,
  ETA_B = 2.6e-3,
  ETA_X_WOUND = 0.6;

/** 弦だけの損失係数 η（モードの減衰率は η ω / 2） */
export function etaOf(s: KeyString, n: number, f: number): number {
  const k = (n * Math.PI) / s.L,
    bk = s.B * k * k;
  return (
    etaAir(s.d, s.mu, f) + (s.wound ? ETA_X_WOUND : 0) / (2 * Math.PI * f) + (s.T * ETA_F + bk * ETA_B) / (s.T + bk)
  );
}

/* ---------- 調律 ---------- */
/**
 * 調律した第 1 部分音 [Hz]。平均律（stretch = false）か、ストレッチ（A3〜A4 を平均律にし、
 * それより上は 1 オクターブ下の第 2 部分音に、下は 1 オクターブ上の第 2 部分音へ自分の第 4 部分音を合わせる）。
 * 部分音の比は弦の非調和性から求める（硬い弦の f_n / f_1 = n √((1 + B n²) / (1 + B))）
 */
export function tuning(t: PianoType, a4: number, stretch: boolean): Float64Array {
  const f = new Float64Array(KEYS);
  for (let k = KEY_LO; k <= KEY_HI; k++) f[k - KEY_LO] = noteHz(k, a4);
  if (!stretch) return f;
  /* 非調和性は音程でほとんど変わらないので、平均律の音で求める */
  const B = Array.from({ length: KEYS }, (_, i) => inharm(keyString(i + KEY_LO, t, f[i]))),
    ratio = (i: number, n: number) => n * Math.sqrt((1 + B[i] * n * n) / (1 + B[i]));
  for (let k = 70; k <= KEY_HI; k++) {
    const i = k - KEY_LO;
    f[i] = f[i - 12] * ratio(i - 12, 2);
  }
  for (let k = 56; k >= KEY_LO; k--) {
    const i = k - KEY_LO;
    f[i] = (f[i + 12] * ratio(i + 12, 2)) / ratio(i, 4);
  }
  return f;
}

/**
 * 星の表（public/proper-motion/stars.bin）の形。scripts/proper-motion.ts が書き、model.ts が読む。
 * 1 星 15 バイトで、明るい順に並べる。座標は J2000 の平均赤道と分点
 *
 * | バイト | 型 | 中身 |
 * | --- | --- | --- |
 * | 0 | u16 | 赤経 × 65536 / 360° |
 * | 2 | i16 | 赤緯 × 32767 / 90° |
 * | 4 | u8 | (等級 + 1.5) / 0.05 |
 * | 5 | i8 | B−V / 0.025 |
 * | 6 | u16 | log10(距離 pc) / 4 × 65535。0 は距離が分からない星 |
 * | 8 | i16 × 3 | 速度 vx・vy・vz [pc/千年] × 50000 |
 * | 14 | u8 | 星座（CONS の番号） |
 *
 * 距離が分からない星は 1000 pc に置き、速度は固有運動だけから作ってある
 */
export const REC = 15;
export const MAG0 = -1.5;
export const MAG_Q = 0.05;
export const BV_Q = 0.025;
export const V_Q = 50000;
/** 距離が分からない星を置く距離 [pc] */
export const FAR = 1000;

/** 天の川の格子: 銀経 0〜360° と銀緯 −90〜90° を 2° ごと。値は 0〜255 の明るさ */
export const MW_STEP = 2;
export const MW_W = 360 / MW_STEP;
export const MW_H = 180 / MW_STEP;

/** sky.json の形 */
export interface SkyJson {
  /** 星座 [略符, 日本語名, 名前を出す順位 1〜3] */
  cons: [string, string, number][];
  /** 星座線（星の番号の折れ線） */
  lines: Record<string, number[][]>;
  /** 星の日本語の固有名 */
  names: Record<string, string>;
  /** バイエル符号（「Alp」「Bet1」など。5 等より明るい星だけ） */
  bay: Record<string, string>;
  /** 星の並び（北斗七星・夏の大三角・冬の大三角）の折れ線 */
  aster: Record<string, number[][]>;
  /** 天の川の格子（base64、MW_W × MW_H バイト、行は銀緯の低い順） */
  mw: string;
}

/** J2000 の赤道直交から銀河座標の直交への回転（行が銀河座標の x・y・z。Hipparcos の定義） */
export const GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
] as const;

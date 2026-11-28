/**
 * 水晶振動子とセラミック発振子の等価回路の定数（出典は Theory.astro の表と出典）。
 * Rm はデータシートの最大値（最も発振しにくい個体）。セラミック発振子は村田製作所の資料の測定値。
 * f は負荷容量 cl での公称周波数。既定の C1・C2 は cl に近い E12 の値、Rd・Rf は 74HCU04 の推奨値の範囲
 */
export interface Crystal {
  id: string;
  /** 選択肢の名前 */
  name: string;
  /** 回路図に添える短い名前 */
  short: string;
  /** 用途 */
  use: string;
  /** 選択肢のまとまり */
  grp: string;
  f: number;
  /** 負荷容量の指定 [F] */
  cl: number;
  /** 等価直列抵抗 [Ω] */
  rm: number;
  /** 等価直列容量 [F] */
  cm: number;
  /** 並列容量 [F] */
  c0: number;
  /** 励振レベルの上限 [W]。記載がなければ Infinity */
  pmax: number;
  /** 周波数のずれの目安 [ppm]。これを超えると計算結果を黄にする（このツールで決めた値） */
  tol: number;
  /** 既定の C1・C2・Rd・Rf */
  def: { c1: number; c2: number; rd: number; rf: number };
}

const pF = 1e-12,
  fF = 1e-15;
/** AEL の HC-49/S（CL 30 pF・C0 7 pF・C1 20 fF・励振レベル 500 µW） */
const hc49 = (id: string, f: number, name: string, use: string, rm: number, rd: number): Crystal => ({
  id,
  name,
  short: name.replace(' HC-49/S', ''),
  use,
  grp: 'HC-49/S（リード品）',
  f,
  cl: 30 * pF,
  rm,
  cm: 20 * fF,
  c0: 7 * pF,
  pmax: 500e-6,
  tol: 30,
  def: { c1: 56 * pF, c2: 56 * pF, rd, rf: 1e6 },
});

export const CRYSTALS: Crystal[] = [
  {
    id: 'k32',
    name: '32.768 kHz 音叉型',
    short: '32.768 kHz',
    use: '時計・RTC',
    grp: '音叉型',
    f: 32768,
    cl: 12.5 * pF,
    rm: 70e3,
    cm: 3.4 * fF,
    c0: 1.0 * pF,
    pmax: 0.5e-6,
    tol: 30,
    def: { c1: 22 * pF, c2: 22 * pF, rd: 1e6, rf: 10e6 },
  },
  hc49('m3579', 3.579545e6, '3.579545 MHz HC-49/S', 'アナログテレビの色信号', 150, 4.7e3),
  hc49('m4', 4e6, '4 MHz HC-49/S', 'マイコン', 120, 3.3e3),
  hc49('m4194', 4.194304e6, '4.194304 MHz HC-49/S', '2²² Hz・時計', 100, 3.3e3),
  hc49('m8', 8e6, '8 MHz HC-49/S', 'マイコン', 60, 1.5e3),
  hc49('m12', 12e6, '12 MHz HC-49/S', 'USB', 40, 1e3),
  hc49('m16', 16e6, '16 MHz HC-49/S', 'マイコン', 40, 680),
  {
    id: 'm40',
    name: '40 MHz 3225 表面実装',
    short: '40 MHz',
    use: '無線・通信',
    grp: '表面実装',
    f: 40e6,
    cl: 8 * pF,
    rm: 50,
    cm: 2.6 * fF,
    c0: 2.0 * pF,
    pmax: 100e-6,
    tol: 30,
    def: { c1: 12 * pF, c2: 12 * pF, rd: 2.2e3, rf: 1e6 },
  },
  {
    id: 'cer4',
    name: '4 MHz セラミック発振子',
    short: 'セラミック 4 MHz',
    use: '家電・おもちゃ',
    grp: 'セラミック発振子',
    f: 4e6,
    cl: 13 * pF,
    rm: 9,
    cm: 3.8377 * pF,
    c0: 19.773 * pF,
    pmax: Number.POSITIVE_INFINITY,
    tol: 5000,
    def: { c1: 22 * pF, c2: 22 * pF, rd: 1e3, rf: 1e6 },
  },
  {
    id: 'cer8',
    name: '8 MHz セラミック発振子',
    short: 'セラミック 8 MHz',
    use: '家電・おもちゃ',
    grp: 'セラミック発振子',
    f: 8e6,
    cl: 13 * pF,
    rm: 8,
    cm: 3.503 * pF,
    c0: 19.9175 * pF,
    pmax: Number.POSITIVE_INFINITY,
    tol: 5000,
    def: { c1: 22 * pF, c2: 22 * pF, rd: 470, rf: 1e6 },
  },
];

export const XT: Record<string, Crystal> = Object.fromEntries(CRYSTALS.map((x) => [x.id, x]));

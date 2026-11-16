/**
 * 論理ゲートのページの計算: ゲートの働き・回路のサンプル・配線の道筋・計算と真理値表。
 * 計算はゲート 1 段の遅れを 1 として、すべてのゲートを同時に進める（単位遅延）。
 * 入力を変えた直後の途中の値と、落ち着くまでの段数・ハザードはこの進め方から出る
 */

export type Bit = 0 | 1;
export type GateType = 'not' | 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor';
export type NodeType = GateType | 'in' | 'out' | 'j';

/** 入力のつなぎ方。x: 縦に折れる位置、p: 通る点（帰還の線）、dot: 分かれ目の点を描く */
export interface Wire {
  s: string;
  x?: number;
  p?: readonly (readonly [number, number])[];
  dot?: boolean;
}
/** 回路の部品。x・y はゲートなら左端と中央、入力・出力は箱と丸の左端と中央 */
export interface Node {
  id: string;
  t: NodeType;
  x: number;
  y: number;
  ins: Wire[];
  /** 画面の名前（入力・出力） */
  lb: string;
  /** 分かれる縦の線の x（入力・ゲート） */
  bus?: number;
  /** タイミングチャートの「途中の信号」に出す名前 */
  nm?: string;
}
/** 前の状態も使う回路の動作の表の 1 行 */
export interface SeqRow {
  c: readonly (number | string)[];
  m: (v: Record<string, Bit>, edge: boolean) => boolean;
  nt: string;
  warn?: boolean;
}
export interface Sample {
  id: string;
  g: 'basic' | 'comb' | 'seq';
  name: string;
  sub: string;
  /** 論理式（HTML。上線は <span class="ov">） */
  expr: readonly string[];
  nodes: Node[];
  uses: readonly string[];
  /** 真理値表の右の補足（加算の式など） */
  extra?: (v: Record<string, Bit>) => string;
  /** 回路の下の補足 */
  hint?: string;
  /** ゲートの初めの値（ラッチなど輪になった回路） */
  init?: Record<string, Bit>;
  /** 入力の初めの値（0 で働く入力は 1 から） */
  defIn?: Record<string, Bit>;
  /** 発振を見せる回路 */
  osc?: boolean;
  /** 立ち上がりで動く入力 */
  edge?: string;
  seq?: { cols: readonly string[]; rows: readonly SeqRow[] };
}

export const GF: Record<GateType, (a: Bit[]) => Bit> = {
  not: (a) => (a[0] ? 0 : 1),
  and: (a) => (a.every(Boolean) ? 1 : 0),
  or: (a) => (a.some(Boolean) ? 1 : 0),
  nand: (a) => (a.every(Boolean) ? 0 : 1),
  nor: (a) => (a.some(Boolean) ? 0 : 1),
  xor: (a) => (a.reduce<number>((p, q) => p ^ q, 0) ? 1 : 0),
  xnor: (a) => (a.reduce<number>((p, q) => p ^ q, 0) ? 0 : 1),
};
export const isGate = (t: NodeType): t is GateType => t in GF;
/** 出力に反転の丸が付くゲート */
export const NEG: Partial<Record<GateType, true>> = { not: true, nand: true, nor: true, xnor: true };
/** OR の形（背が反る）のゲート */
export const ORT: Partial<Record<GateType, true>> = { or: true, nor: true, xor: true, xnor: true };
export const XT: Partial<Record<GateType, true>> = { xor: true, xnor: true };
export const GNAME: Record<GateType, string> = {
  not: 'NOT',
  and: 'AND',
  or: 'OR',
  nand: 'NAND',
  nor: 'NOR',
  xor: 'XOR',
  xnor: 'XNOR',
};
/** 入力どうしの間隔 */
export const PITCH = 16;
/** OR の背の反り */
export const BACK = 9;
export const gh = (n: number): number => (n <= 1 ? 28 : Math.max(32, PITCH * n));
export const gw = (t: GateType): number => (t === 'not' ? 32 : XT[t] ? 50 : 44);

/* ---------- 部品 ---------- */
type In = string | Wire;
type Opt = Partial<Pick<Node, 'lb' | 'bus' | 'nm'>>;
const wires = (a: readonly In[]): Wire[] => a.map((v) => (typeof v === 'string' ? { s: v } : v));
const I = (id: string, x: number, y: number, o: Opt = {}): Node => ({ id, t: 'in', x, y, ins: [], lb: id, ...o });
const O = (id: string, x: number, y: number, src: In, o: Opt = {}): Node => ({
  id,
  t: 'out',
  x,
  y,
  ins: wires([src]),
  lb: id,
  ...o,
});
const G = (t: GateType, id: string, x: number, y: number, ins: readonly In[], o: Opt = {}): Node => ({
  id,
  t,
  x,
  y,
  ins: wires(ins),
  lb: id,
  ...o,
});
const J = (id: string, x: number, y: number, src: In): Node => ({ id, t: 'j', x, y, ins: wires([src]), lb: id });

/** ゲート 1 個（NOT は入力 1 本） */
function basic(t: GateType): Node[] {
  if (t === 'not') return [I('A', 0, 36), G('not', 'g', 100, 36, ['A']), O('Y', 200, 36, 'g')];
  return [I('A', 0, 20), I('B', 0, 52), G(t, 'g', 100, 36, ['A', 'B']), O('Y', 210, 36, 'g')];
}
/** 入力とその反転を縦の線に並べる（デコーダ・比較器など） */
function rails(names: readonly string[], x0 = 120): Node[] {
  const out: Node[] = [];
  names.forEach((k, i) => {
    const y = 20 + i * 52;
    out.push(I(k, 0, y, { bus: 52 }), G('not', `n${k}`, 64, y + 20, [k], { nm: `¬${k}` }));
    out.push(J(`j${k}`, x0 + i * 28, y, k), J(`jn${k}`, x0 + 14 + i * 28, y + 20, `n${k}`));
  });
  return out;
}
/** NOR の SR ラッチ。上の NOR に top、下の NOR に bottom をつなぐ（上の出力が Q）。ox は横のずらし */
function norLatch(p: string, ox: number, top: In, bottom: In): Node[] {
  return [
    G('nor', `${p}g1`, ox + 260, 36, [
      top,
      {
        s: `${p}g2`,
        p: [
          [ox + 340, 112],
          [ox + 340, 80],
          [ox + 230, 80],
        ],
        dot: true,
      },
    ]),
    G('nor', `${p}g2`, ox + 260, 112, [
      {
        s: `${p}g1`,
        p: [
          [ox + 330, 36],
          [ox + 330, 64],
          [ox + 240, 64],
        ],
        dot: true,
      },
      bottom,
    ]),
  ];
}
/** D ラッチ（NOR の SR ラッチの前に AND 2 個）。p は id の頭。D は y = 20、E は x = ox + 128 の縦の線で届く */
function dlatch(p: string, dSrc: string, eSrc: string, ox = 0): Node[] {
  return [
    G('not', `${p}nd`, ox + 70, 20, [dSrc]),
    G('and', `${p}ar`, ox + 150, 28, [`${p}nd`, eSrc]),
    G('and', `${p}as`, ox + 150, 120, [{ s: dSrc, x: ox + 56, dot: true }, eSrc]),
    ...norLatch(p, ox, `${p}ar`, `${p}as`),
  ];
}
/** 立ち上がりで動く D フリップフロップ（D ラッチ 2 段）。D は y = 20、CLK は y = 180 で左から届く。出力は sg1（Q）と sg2 */
function dffBlock(ox: number, d: string, clk: string): Node[] {
  return [
    G('not', 'nc', ox + 70, 180, [clk], { bus: ox + 128, nm: '¬CLK' }),
    J('jc', ox + 370, 204, {
      s: clk,
      p: [
        [ox + 56, 180],
        [ox + 56, 204],
      ],
      dot: true,
    }),
    ...dlatch('m', d, 'nc', ox),
    G('and', 'sar', ox + 410, 60, [{ s: 'mg2', x: ox + 394 }, 'jc']),
    G('and', 'sas', ox + 410, 140, [{ s: 'mg1', x: ox + 384 }, 'jc']),
    G('nor', 'sg1', ox + 500, 68, [
      'sar',
      {
        s: 'sg2',
        p: [
          [ox + 580, 132],
          [ox + 580, 108],
          [ox + 470, 108],
        ],
        dot: true,
      },
    ]),
    G('nor', 'sg2', ox + 500, 132, [
      {
        s: 'sg1',
        p: [
          [ox + 570, 68],
          [ox + 570, 96],
          [ox + 480, 96],
        ],
        dot: true,
      },
      'sas',
    ]),
  ];
}
const DFF_INIT: Record<string, Bit> = { mg1: 0, mg2: 1, sg1: 0, sg2: 1, nc: 1, mnd: 1 };

/* ---------- サンプル ---------- */
const ov = (s: string): string => `<span class="ov">${s}</span>`;
export const SAMPLES: Sample[] = [
  {
    id: 'not',
    g: 'basic',
    name: 'NOT',
    sub: '入力の反転',
    expr: [`Y = ${ov('A')}`],
    nodes: basic('not'),
    uses: ['0 と 1 の入れ替え', '暗くなると点く街灯', 'リングオシレータ'],
  },
  {
    id: 'and',
    g: 'basic',
    name: 'AND',
    sub: 'すべて 1 のときだけ 1',
    expr: ['Y = A · B'],
    nodes: basic('and'),
    uses: ['プレス機の両手押しボタン', '加算器の桁上げ', 'ビットの取り出し（マスク）'],
  },
  {
    id: 'or',
    g: 'basic',
    name: 'OR',
    sub: 'どれか 1 つでも 1 なら 1',
    expr: ['Y = A + B'],
    nodes: basic('or'),
    uses: ['どれかのドアが開くと点く車の室内灯', 'どれか 1 つで鳴る警報', '全加算器の桁上げ'],
  },
  {
    id: 'nand',
    g: 'basic',
    name: 'NAND',
    sub: 'AND の反転',
    expr: [`Y = ${ov('A · B')}`],
    nodes: basic('nand'),
    uses: ['NAND だけでどのゲートも作れる', 'SR ラッチ', 'NAND 型フラッシュメモリの名前の由来'],
  },
  {
    id: 'nor',
    g: 'basic',
    name: 'NOR',
    sub: 'OR の反転',
    expr: [`Y = ${ov('A + B')}`],
    nodes: basic('nor'),
    uses: ['NOR だけでどのゲートも作れる', 'SR ラッチ', 'どれも 0 のときだけ 1 になる知らせ'],
  },
  {
    id: 'xor',
    g: 'basic',
    name: 'XOR',
    sub: '入力が違うときだけ 1',
    expr: ['Y = A ⊕ B'],
    nodes: basic('xor'),
    uses: ['階段の照明（上と下のスイッチ）', '加算器の和', 'パリティ'],
  },
  {
    id: 'xnor',
    g: 'basic',
    name: 'XNOR',
    sub: '入力が同じときだけ 1',
    expr: [`Y = ${ov('A ⊕ B')}`],
    nodes: basic('xnor'),
    uses: ['一致の検出', '比較器'],
  },

  {
    id: 'ha',
    g: 'comb',
    name: '半加算器',
    sub: '1 桁の 2 進数の足し算',
    expr: ['S = A ⊕ B', 'C = A · B'],
    nodes: [
      I('A', 0, 20, { bus: 60 }),
      I('B', 0, 60, { bus: 74 }),
      G('xor', 'x', 110, 28, ['A', 'B']),
      G('and', 'a', 110, 76, ['A', 'B']),
      O('S', 200, 28, 'x', { lb: 'S 和' }),
      O('C', 200, 76, 'a', { lb: 'C 桁上げ' }),
    ],
    extra: (v) => `${v.A} + ${v.B} = ${v.C}${v.S}`,
    uses: ['全加算器の部品', '2 進数の 1 の位の足し算'],
  },
  {
    id: 'fa',
    g: 'comb',
    name: '全加算器',
    sub: '下の桁からの桁上げも足す',
    expr: ['S = A ⊕ B ⊕ Cin', 'Cout = A · B + (A ⊕ B) · Cin'],
    nodes: [
      I('A', 0, 20, { bus: 56 }),
      I('B', 0, 52, { bus: 70 }),
      I('Cin', 0, 140, { bus: 176 }),
      G('xor', 'x1', 100, 28, ['A', 'B'], { nm: 'A⊕B' }),
      G('and', 'a1', 100, 84, ['A', 'B'], { nm: 'A·B' }),
      G('xor', 'x2', 200, 44, ['x1', 'Cin']),
      G('and', 'a2', 200, 116, ['x1', 'Cin']),
      G('or', 'r', 290, 100, [
        { s: 'a1', x: 270 },
        { s: 'a2', x: 270 },
      ]),
      O('S', 360, 44, 'x2', { lb: 'S 和' }),
      O('Cout', 360, 100, 'r', { lb: 'Cout 桁上げ' }),
    ],
    extra: (v) => `${v.A} + ${v.B} + ${v.Cin} = ${v.Cout}${v.S}`,
    uses: ['多桁の加算器の 1 桁', 'CPU の演算装置'],
  },
  {
    id: 'add2',
    g: 'comb',
    name: '2 ビット加算器',
    sub: '半加算器と全加算器で 2 桁の足し算',
    expr: ['S0 = A0 ⊕ B0', 'S1 = A1 ⊕ B1 ⊕ C0', 'S2 = A1 · B1 + (A1 ⊕ B1) · C0'],
    nodes: [
      I('A0', 0, 20, { bus: 56 }),
      I('B0', 0, 52, { bus: 70 }),
      I('A1', 0, 140, { bus: 56 }),
      I('B1', 0, 172, { bus: 70 }),
      G('xor', 'x0', 100, 28, ['A0', 'B0']),
      G('and', 'c0', 100, 76, ['A0', 'B0'], { nm: 'C0', bus: 176 }),
      G('xor', 'x1', 100, 148, ['A1', 'B1'], { bus: 164 }),
      G('and', 'a1', 100, 196, ['A1', 'B1']),
      G('xor', 'x2', 220, 156, ['x1', 'c0']),
      G('and', 'a2', 220, 228, ['x1', 'c0']),
      G('or', 'r', 310, 216, [
        { s: 'a1', x: 290 },
        { s: 'a2', x: 290 },
      ]),
      O('S0', 400, 28, 'x0'),
      O('S1', 400, 156, 'x2'),
      O('S2', 400, 216, 'r'),
    ],
    extra: (v) => `${v.A1 * 2 + v.A0} + ${v.B1 * 2 + v.B0} = ${v.S2 * 4 + v.S1 * 2 + v.S0}`,
    uses: ['電卓や CPU の足し算', '桁を増やすと 8・32・64 ビット'],
  },
  {
    id: 'mux',
    g: 'comb',
    name: 'マルチプレクサ',
    sub: 'S で A か B の一方を選ぶ',
    expr: [`Y = ${ov('S')} · A + S · B`],
    hint: 'A = B = 1 のまま S を 1 から 0 にすると、Y に一瞬 0 が出る',
    nodes: [
      I('A', 0, 20),
      I('B', 0, 60),
      I('S', 0, 120, { bus: 56 }),
      G('not', 'ns', 80, 104, ['S'], { nm: '¬S' }),
      G('and', 'a1', 170, 28, ['A', { s: 'ns', x: 140 }], { nm: '¬S·A' }),
      G('and', 'a2', 170, 76, [{ s: 'B', x: 100 }, 'S'], { nm: 'S·B' }),
      G('or', 'r', 260, 52, [
        { s: 'a1', x: 240 },
        { s: 'a2', x: 240 },
      ]),
      O('Y', 330, 52, 'r'),
    ],
    uses: ['データの切り替え', 'CPU の中の信号の選択', '並列のデータを 1 本の線で順に送る'],
  },
  {
    id: 'dec',
    g: 'comb',
    name: 'デコーダ',
    sub: '2 ビットの番号で 4 本のうち 1 本だけ 1',
    expr: [`Y0 = ${ov('A1')} · ${ov('A0')}`, `Y1 = ${ov('A1')} · A0`, `Y2 = A1 · ${ov('A0')}`, 'Y3 = A1 · A0'],
    nodes: [
      ...rails(['A1', 'A0']),
      G('and', 'y0', 190, 140, ['jnA1', 'jnA0']),
      G('and', 'y1', 190, 190, ['jnA1', 'jA0']),
      G('and', 'y2', 190, 240, ['jA1', 'jnA0']),
      G('and', 'y3', 190, 290, ['jA1', 'jA0']),
      O('Y0', 280, 140, 'y0'),
      O('Y1', 280, 190, 'y1'),
      O('Y2', 280, 240, 'y2'),
      O('Y3', 280, 290, 'y3'),
    ],
    extra: (v) => `番号 ${v.A1 * 2 + v.A0} → Y${v.A1 * 2 + v.A0}`,
    uses: ['メモリの番地の選択', '7 セグメント表示', '命令の解読'],
  },
  {
    id: 'cmp',
    g: 'comb',
    name: '比較器',
    sub: '1 ビットの大小と一致',
    expr: [`A>B = A · ${ov('B')}`, `A=B = ${ov('A ⊕ B')}`, `A<B = ${ov('A')} · B`],
    nodes: [
      ...rails(['A', 'B']),
      G('and', 'gt', 190, 140, ['jA', 'jnB']),
      G('xnor', 'eq', 190, 190, ['jA', 'jB']),
      G('and', 'lt', 190, 240, ['jnA', 'jB']),
      O('A>B', 290, 140, 'gt'),
      O('A=B', 290, 190, 'eq'),
      O('A<B', 290, 240, 'lt'),
    ],
    uses: ['数の大小の判定', 'プログラムの条件分岐'],
  },
  {
    id: 'par',
    g: 'comb',
    name: 'パリティ',
    sub: '1 の数が奇数なら 1',
    expr: ['P = D0 ⊕ D1 ⊕ D2 ⊕ D3'],
    nodes: [
      I('D0', 0, 20),
      I('D1', 0, 52),
      I('D2', 0, 100),
      I('D3', 0, 132),
      G('xor', 'x1', 100, 36, ['D0', 'D1']),
      G('xor', 'x2', 100, 116, ['D2', 'D3']),
      G('xor', 'x3', 200, 76, ['x1', 'x2']),
      O('P', 280, 76, 'x3'),
    ],
    extra: (v) => `1 の数 ${v.D0 + v.D1 + v.D2 + v.D3}`,
    uses: ['通信の誤りの検出', 'メモリの誤りの検出'],
  },
  {
    id: 'maj',
    g: 'comb',
    name: '多数決回路',
    sub: '3 つのうち 2 つ以上が 1 なら 1',
    expr: ['Y = A · B + B · C + C · A'],
    nodes: [
      I('A', 0, 20, { bus: 100 }),
      I('B', 0, 60, { bus: 114 }),
      I('C', 0, 100, { bus: 128 }),
      G('and', 'ab', 170, 28, ['A', 'B']),
      G('and', 'bc', 170, 80, ['B', 'C']),
      G('and', 'ca', 170, 132, ['A', 'C']),
      G('or', 'r', 270, 80, [{ s: 'ab', x: 250 }, 'bc', { s: 'ca', x: 250 }]),
      O('Y', 350, 80, 'r'),
    ],
    uses: ['審査員 3 人の判定', '同じ装置を 3 台並べて多数決を取る系', '全加算器の桁上げ'],
  },
  {
    id: 'nandb',
    g: 'comb',
    name: 'NAND で作る基本ゲート',
    sub: 'NAND だけで NOT・AND・OR',
    expr: [`${ov('A')} = ${ov('A · A')}`, `A · B = ${ov(ov('A · B'))}`, `A + B = ${ov(`${ov('A')} · ${ov('B')}`)}`],
    nodes: [
      I('A', 0, 20, { bus: 90 }),
      I('B', 0, 100, { bus: 104 }),
      G('nand', 'na', 130, 28, ['A', 'A'], { bus: 200, nm: '¬A' }),
      G('nand', 'nb', 130, 84, ['B', 'B'], { nm: '¬B' }),
      G('nand', 'n2', 130, 140, ['A', 'B'], { bus: 205, nm: '¬(A·B)' }),
      G('nand', 'or', 230, 56, ['na', { s: 'nb', x: 215 }]),
      G('nand', 'an', 230, 140, ['n2', 'n2']),
      O('¬A', 340, 28, 'na'),
      O('A+B', 340, 56, 'or'),
      O('A·B', 340, 140, 'an'),
    ],
    uses: ['1 種類のゲートだけで作る IC', 'NAND が万能ゲートと呼ばれる理由'],
  },
  {
    id: 'nandx',
    g: 'comb',
    name: 'NAND で作る XOR',
    sub: 'NAND 4 個で XOR',
    expr: ['Y = A ⊕ B'],
    nodes: [
      I('A', 0, 20, { bus: 70 }),
      I('B', 0, 100, { bus: 84 }),
      G('nand', 'n1', 110, 60, ['A', 'B'], { bus: 184, nm: '¬(A·B)' }),
      G('nand', 'n2', 210, 28, ['A', 'n1']),
      G('nand', 'n3', 210, 92, ['n1', 'B']),
      G('nand', 'n4', 310, 60, [
        { s: 'n2', x: 290 },
        { s: 'n3', x: 290 },
      ]),
      O('Y', 390, 60, 'n4'),
    ],
    uses: ['ゲートの数を減らす工夫', '万能ゲートの例'],
  },
  {
    id: 'xaon',
    g: 'comb',
    name: '基本ゲートで作る XOR',
    sub: 'NOT・AND・OR で XOR',
    expr: [`Y = A · ${ov('B')} + ${ov('A')} · B`],
    nodes: [
      ...rails(['A', 'B']),
      G('and', 'a1', 190, 140, ['jA', 'jnB'], { nm: 'A·¬B' }),
      G('and', 'a2', 190, 200, ['jnA', 'jB'], { nm: '¬A·B' }),
      G('or', 'r', 280, 170, [
        { s: 'a1', x: 260 },
        { s: 'a2', x: 260 },
      ]),
      O('Y', 360, 170, 'r'),
    ],
    uses: ['真理値表の 1 の行から回路を作る方法（積和形）'],
  },
  {
    id: 'norx',
    g: 'comb',
    name: 'NOR で作る XOR',
    sub: 'NOR 5 個で XOR',
    expr: ['Y = A ⊕ B'],
    nodes: [
      I('A', 0, 20, { bus: 70 }),
      I('B', 0, 100, { bus: 84 }),
      G('nor', 'n1', 110, 60, ['A', 'B'], { bus: 184, nm: '¬(A+B)' }),
      G('nor', 'n2', 210, 28, ['A', 'n1']),
      G('nor', 'n3', 210, 92, ['n1', 'B']),
      G(
        'nor',
        'n4',
        310,
        60,
        [
          { s: 'n2', x: 290 },
          { s: 'n3', x: 290 },
        ],
        { nm: 'XNOR', bus: 380 },
      ),
      G('nor', 'n5', 400, 60, ['n4', 'n4']),
      O('Y', 480, 60, 'n5'),
    ],
    uses: ['万能ゲートの例', 'アポロ誘導コンピュータは NOR だけで作られた'],
  },
  {
    id: 'dem',
    g: 'comb',
    name: 'ド・モルガンの法則',
    sub: 'NAND と、反転してからの OR は同じ',
    expr: [`${ov('A · B')} = ${ov('A')} + ${ov('B')}`],
    nodes: [
      I('A', 0, 20, { bus: 60 }),
      I('B', 0, 52, { bus: 74 }),
      G('nand', 'g1', 120, 36, ['A', 'B']),
      G('not', 'na', 120, 110, ['A'], { nm: '¬A' }),
      G('not', 'nb', 120, 150, ['B'], { nm: '¬B' }),
      G('or', 'r', 230, 130, [
        { s: 'na', x: 200 },
        { s: 'nb', x: 210 },
      ]),
      O('Y1', 320, 36, 'g1'),
      O('Y2', 320, 130, 'r'),
    ],
    uses: ['論理式の変形', 'AND・OR の回路を NAND・NOR へ置き換える'],
  },
  {
    id: 'haz',
    g: 'comb',
    name: 'ハザード',
    sub: '遅れの差で一瞬だけ出る誤った出力',
    expr: [`Y = A · B + ${ov('A')} · C`],
    hint: 'B = C = 1 で A を 1 から 0 にすると、Y に一瞬 0 が出る',
    nodes: [
      I('A', 0, 60, { bus: 56 }),
      I('B', 0, 20),
      I('C', 0, 120),
      G('not', 'na', 80, 80, ['A'], { nm: '¬A' }),
      G('and', 'a1', 170, 28, ['B', 'A'], { nm: 'A·B' }),
      G(
        'and',
        'a2',
        170,
        100,
        [
          { s: 'na', x: 150 },
          { s: 'C', x: 140 },
        ],
        { nm: '¬A·C' },
      ),
      G('or', 'r', 260, 64, [
        { s: 'a1', x: 240 },
        { s: 'a2', x: 240 },
      ]),
      O('Y', 340, 64, 'r'),
    ],
    uses: ['回路が誤動作する原因', 'クロックの瞬間だけ値を読む理由'],
  },

  {
    id: 'sr',
    g: 'seq',
    name: 'SR ラッチ',
    sub: '最後に 1 にした側を覚える',
    expr: [`Q = ${ov(`R + ${ov('Q')}`)}`, `${ov('Q')} = ${ov('S + Q')}`],
    nodes: [
      I('R', 0, 20),
      I('S', 0, 120),
      G('nor', 'g1', 120, 28, [
        'R',
        {
          s: 'g2',
          p: [
            [200, 112],
            [200, 72],
            [90, 72],
          ],
          dot: true,
        },
      ]),
      G('nor', 'g2', 120, 112, [
        {
          s: 'g1',
          p: [
            [190, 28],
            [190, 56],
            [100, 56],
          ],
          dot: true,
        },
        'S',
      ]),
      O('Q', 260, 28, 'g1'),
      O('¬Q', 260, 112, 'g2'),
    ],
    init: { g1: 0, g2: 1 },
    seq: {
      cols: ['S', 'R', 'Q', '¬Q'],
      rows: [
        { c: [0, 0, '前のまま'], m: (v) => !v.S && !v.R, nt: '保持' },
        { c: [1, 0, 1, 0], m: (v) => !!v.S && !v.R, nt: 'セット' },
        { c: [0, 1, 0, 1], m: (v) => !v.S && !!v.R, nt: 'リセット' },
        { c: [1, 1, 0, 0], m: (v) => !!v.S && !!v.R, nt: '禁止', warn: true },
      ],
    },
    uses: ['バスの降車ボタンのランプ', 'スイッチのチャタリングの除去', 'フリップフロップの部品'],
  },
  {
    id: 'srn',
    g: 'seq',
    name: 'SR ラッチ（NAND）',
    sub: '0 にした側を覚える NAND 2 個のラッチ',
    expr: [`Q = ${ov(`${ov('S')} · ${ov('Q')}`)}`, `${ov('Q')} = ${ov(`${ov('R')} · Q`)}`],
    hint: '入力は 0 で働く（負論理）',
    nodes: [
      I('¬S', 0, 20),
      I('¬R', 0, 120),
      G('nand', 'g1', 120, 28, [
        '¬S',
        {
          s: 'g2',
          p: [
            [200, 112],
            [200, 72],
            [90, 72],
          ],
          dot: true,
        },
      ]),
      G('nand', 'g2', 120, 112, [
        {
          s: 'g1',
          p: [
            [190, 28],
            [190, 56],
            [100, 56],
          ],
          dot: true,
        },
        '¬R',
      ]),
      O('Q', 260, 28, 'g1'),
      O('¬Q', 260, 112, 'g2'),
    ],
    init: { g1: 0, g2: 1 },
    defIn: { '¬S': 1, '¬R': 1 },
    seq: {
      cols: ['¬S', '¬R', 'Q', '¬Q'],
      rows: [
        { c: [1, 1, '前のまま'], m: (v) => !!v['¬S'] && !!v['¬R'], nt: '保持' },
        { c: [0, 1, 1, 0], m: (v) => !v['¬S'] && !!v['¬R'], nt: 'セット' },
        { c: [1, 0, 0, 1], m: (v) => !!v['¬S'] && !v['¬R'], nt: 'リセット' },
        { c: [0, 0, 1, 1], m: (v) => !v['¬S'] && !v['¬R'], nt: '禁止', warn: true },
      ],
    },
    uses: ['スイッチのチャタリングの除去', 'NAND だけで作る記憶'],
  },
  {
    id: 'gsr',
    g: 'seq',
    name: 'ゲート付き SR ラッチ',
    sub: 'E = 1 の間だけ S と R を受け付ける',
    expr: ['E = 1 の間だけ SR ラッチ'],
    nodes: [
      I('R', 0, 20),
      I('E', 0, 76, { bus: 128 }),
      I('S', 0, 112),
      G('and', 'ar', 150, 28, ['R', 'E'], { nm: 'R·E' }),
      G('and', 'as', 150, 120, ['S', 'E'], { nm: 'S·E' }),
      ...norLatch('', 0, 'ar', 'as'),
      O('Q', 420, 36, 'g1'),
      O('¬Q', 420, 112, 'g2'),
    ],
    init: { g1: 0, g2: 1 },
    seq: {
      cols: ['E', 'S', 'R', 'Q', '¬Q'],
      rows: [
        { c: [0, '–', '–', '前のまま'], m: (v) => !v.E, nt: '保持' },
        { c: [1, 0, 0, '前のまま'], m: (v) => !!v.E && !v.S && !v.R, nt: '保持' },
        { c: [1, 1, 0, 1, 0], m: (v) => !!v.E && !!v.S && !v.R, nt: 'セット' },
        { c: [1, 0, 1, 0, 1], m: (v) => !!v.E && !v.S && !!v.R, nt: 'リセット' },
        { c: [1, 1, 1, 0, 0], m: (v) => !!v.E && !!v.S && !!v.R, nt: '禁止', warn: true },
      ],
    },
    uses: ['決めた時だけ入力を受け付ける記憶', 'D ラッチの元'],
  },
  {
    id: 'dl',
    g: 'seq',
    name: 'D ラッチ',
    sub: 'E = 1 の間は D を通し、0 にすると覚える',
    expr: ['Q = D（E = 1）', 'Q は前のまま（E = 0）'],
    nodes: [
      I('D', 0, 20),
      I('E', 0, 76, { bus: 128 }),
      ...dlatch('', 'D', 'E'),
      O('Q', 420, 36, 'g1'),
      O('¬Q', 420, 112, 'g2'),
    ],
    init: { g1: 0, g2: 1, nd: 1 },
    seq: {
      cols: ['E', 'D', 'Q', '¬Q'],
      rows: [
        { c: [0, '–', '前のまま'], m: (v) => !v.E, nt: '保持' },
        { c: [1, 0, 0, 1], m: (v) => !!v.E && !v.D, nt: '通す' },
        { c: [1, 1, 1, 0], m: (v) => !!v.E && !!v.D, nt: '通す' },
      ],
    },
    uses: ['レジスタ', 'データを一時的に止めて持つ所'],
  },
  {
    id: 'dff',
    g: 'seq',
    name: 'D フリップフロップ',
    sub: 'CLK が 0 から 1 になる瞬間の D を覚える',
    expr: ['Q ← D（CLK の立ち上がり）'],
    nodes: [
      I('D', 0, 20),
      I('CLK', 0, 180),
      ...dffBlock(0, 'D', 'CLK'),
      O('Q', 640, 68, 'sg1'),
      O('¬Q', 640, 132, 'sg2'),
    ],
    init: DFF_INIT,
    edge: 'CLK',
    seq: {
      cols: ['CLK', 'D', 'Q', '¬Q'],
      rows: [
        { c: ['↑', 0, 0, 1], m: (v, e) => e && !v.D, nt: '取り込む' },
        { c: ['↑', 1, 1, 0], m: (v, e) => e && !!v.D, nt: '取り込む' },
        { c: ['0・1', '–', '前のまま'], m: (_v, e) => !e, nt: '保持' },
      ],
    },
    uses: ['CPU のレジスタ', 'カウンタ・シフトレジスタ', 'クロックで動く回路の全般'],
  },
  {
    id: 'jk',
    g: 'seq',
    name: 'JK フリップフロップ',
    sub: 'J・K で保持・セット・リセット・反転',
    expr: [`Q ← J · ${ov('Q')} + ${ov('K')} · Q（CLK の立ち上がり）`],
    nodes: [
      I('J', 0, -20),
      I('K', 0, 44),
      I('CLK', 0, 180),
      G('not', 'nk', 48, 44, ['K'], { nm: '¬K' }),
      G('and', 'a1', 100, -12, [
        'J',
        {
          s: 'sg2',
          p: [
            [840, 132],
            [840, -44],
            [80, -44],
            [80, -4],
          ],
          dot: true,
        },
      ]),
      G('and', 'a2', 100, 52, [
        'nk',
        {
          s: 'sg1',
          p: [
            [830, 68],
            [830, 230],
            [92, 230],
            [92, 60],
          ],
          dot: true,
        },
      ]),
      G(
        'or',
        'd',
        180,
        20,
        [
          { s: 'a1', x: 165 },
          { s: 'a2', x: 165 },
        ],
        { nm: 'D' },
      ),
      ...dffBlock(230, 'd', 'CLK'),
      O('Q', 870, 68, 'sg1'),
      O('¬Q', 870, 132, 'sg2'),
    ],
    init: DFF_INIT,
    edge: 'CLK',
    seq: {
      cols: ['CLK', 'J', 'K', 'Q', '¬Q'],
      rows: [
        { c: ['↑', 0, 0, '前のまま'], m: (v, e) => e && !v.J && !v.K, nt: '保持' },
        { c: ['↑', 0, 1, 0, 1], m: (v, e) => e && !v.J && !!v.K, nt: 'リセット' },
        { c: ['↑', 1, 0, 1, 0], m: (v, e) => e && !!v.J && !v.K, nt: 'セット' },
        { c: ['↑', 1, 1, '反転'], m: (v, e) => e && !!v.J && !!v.K, nt: '反転' },
        { c: ['0・1', '–', '–', '前のまま'], m: (_v, e) => !e, nt: '保持' },
      ],
    },
    uses: ['カウンタ', 'クロックの周波数を下げる分周器', '保持・セット・リセット・反転を 1 つでこなす記憶'],
  },
  {
    id: 'tff',
    g: 'seq',
    name: 'T フリップフロップ',
    sub: 'T = 1 なら CLK の立ち上がりごとに反転',
    expr: ['Q ← T ⊕ Q（CLK の立ち上がり）'],
    nodes: [
      I('T', 0, 12),
      I('CLK', 0, 180),
      G(
        'xor',
        'd',
        100,
        20,
        [
          'T',
          {
            s: 'sg1',
            p: [
              [760, 68],
              [760, -30],
              [80, -30],
              [80, 28],
            ],
            dot: true,
          },
        ],
        { nm: 'D' },
      ),
      ...dffBlock(160, 'd', 'CLK'),
      O('Q', 800, 68, 'sg1'),
      O('¬Q', 800, 132, 'sg2'),
    ],
    init: DFF_INIT,
    edge: 'CLK',
    seq: {
      cols: ['CLK', 'T', 'Q', '¬Q'],
      rows: [
        { c: ['↑', 0, '前のまま'], m: (v, e) => e && !v.T, nt: '保持' },
        { c: ['↑', 1, '反転'], m: (v, e) => e && !!v.T, nt: '反転' },
        { c: ['0・1', '–', '前のまま'], m: (_v, e) => !e, nt: '保持' },
      ],
    },
    uses: ['クロックの周波数を半分にする分周器', '2 進カウンタ'],
  },
  {
    id: 'ring',
    g: 'seq',
    name: 'リングオシレータ',
    sub: '反転を輪にすると 0 と 1 をくり返す',
    expr: ['EN = 1 で発振'],
    nodes: [
      I('EN', 0, 52),
      G('nand', 'g0', 80, 44, [
        {
          s: 'n2',
          p: [
            [340, 44],
            [340, 4],
            [60, 4],
            [60, 36],
          ],
          dot: true,
        },
        'EN',
      ]),
      G('not', 'n1', 170, 44, ['g0']),
      G('not', 'n2', 260, 44, ['n1']),
      O('Y', 390, 44, 'n2'),
    ],
    init: { g0: 1, n1: 0, n2: 1 },
    osc: true,
    seq: {
      cols: ['EN', 'Y'],
      rows: [
        { c: [0, 1], m: (v) => !v.EN, nt: '停止' },
        { c: [1, '0 と 1 をくり返す'], m: (v) => !!v.EN, nt: '発振' },
      ],
    },
    uses: ['クロックのもと', 'IC の速さの測定', '乱数のもと'],
  },
];
export const SAMPLE: Record<string, Sample> = Object.fromEntries(SAMPLES.map((s) => [s.id, s]));
export const GROUPS: readonly (readonly [Sample['g'], string])[] = [
  ['basic', '基本ゲート'],
  ['comb', '組み合わせ回路'],
  ['seq', '順序回路'],
];

/* ---------- 下ごしらえ ---------- */
export interface Seg {
  /** 値を運ぶ部品の id */
  s: string;
  d: string;
}
export interface Prepared {
  c: Sample;
  N: Map<string, Node>;
  inputs: Node[];
  outputs: Node[];
  gates: (Node & { t: GateType })[];
  segs: Seg[];
  dots: { s: string; x: number; y: number }[];
  /** viewBox（x・y・幅・高さ） */
  box: [number, number, number, number];
  gateCount: number;
  /** 入力から出力までの最長のゲートの数（輪になった回路は null） */
  depth: number | null;
}
const cache = new Map<string, Prepared>();
export const outPin = (n: Node): [number, number] =>
  n.t === 'in'
    ? [n.x + 40, n.y]
    : n.t === 'j' || n.t === 'out'
      ? [n.x, n.y]
      : [n.x + gw(n.t) + (NEG[n.t] ? 7 : 0), n.y];
const pinY = (n: Node, i: number): number => n.y + (i - (n.ins.length - 1) / 2) * PITCH;
export function inPin(n: Node, i: number): [number, number] {
  if (n.t === 'out' || n.t === 'j' || n.t === 'in') return [n.x, n.y];
  const y = pinY(n, i);
  let x = n.x;
  if (ORT[n.t]) {
    const h = gh(n.ins.length),
      t = (y - (n.y - h / 2)) / h;
    x += 2 * t * (1 - t) * BACK;
  }
  return [x, y];
}
/** 文字の幅のおおよそ [px] */
export const textW = (s: string, a = 8): number => [...s].reduce((p, ch) => p + (ch.charCodeAt(0) > 255 ? 13.5 : a), 0);

export function prep(c: Sample): Prepared {
  const hit = cache.get(c.id);
  if (hit) return hit;
  const N = new Map(c.nodes.map((n) => [n.id, n]));
  const cons = new Map<string, { n: Node; i: number; e: Wire }[]>();
  for (const n of c.nodes)
    n.ins.forEach((e, i) => {
      const a = cons.get(e.s) ?? [];
      a.push({ n, i, e });
      cons.set(e.s, a);
    });
  const segs: Seg[] = [],
    dots: Prepared['dots'] = [];
  const seg = (s: string, d: string) => segs.push({ s, d });
  for (const [sid, list] of cons) {
    const s = N.get(sid);
    if (!s) throw new Error(`${c.id}: ${sid} がない`);
    const [px, py] = outPin(s);
    const def = list.filter((k) => k.e.x == null && !k.e.p);
    const useBus = def.length > 0 && (s.bus != null || s.t === 'j' || def.length >= 2);
    if (useBus) {
      const bx = s.t === 'j' ? s.x : (s.bus ?? px + 14);
      const ys = def.map((k) => inPin(k.n, k.i)[1]);
      const lo = Math.min(py, ...ys),
        hi = Math.max(py, ...ys);
      if (bx > px) seg(sid, `M${px} ${py}H${bx}`);
      if (hi > lo) seg(sid, `M${bx} ${lo}V${hi}`);
      for (const y of new Set([py, ...ys])) {
        const deg = (ys.includes(y) ? 1 : 0) + (y > lo ? 1 : 0) + (y < hi ? 1 : 0) + (y === py ? 1 : 0);
        if (deg >= 3) dots.push({ s: sid, x: bx, y });
      }
      for (const k of def) {
        const [tx, ty] = inPin(k.n, k.i);
        seg(sid, `M${bx} ${ty}H${tx}`);
      }
    } else
      for (const k of def) {
        const [tx, ty] = inPin(k.n, k.i);
        if (ty === py) seg(sid, `M${px} ${py}H${tx}`);
        else {
          let xm = tx - 12;
          if (xm <= px) xm = (px + tx) / 2;
          seg(sid, `M${px} ${py}H${xm}V${ty}H${tx}`);
        }
      }
    for (const k of list) {
      const [tx, ty] = inPin(k.n, k.i);
      if (k.e.x != null) {
        seg(sid, `M${px} ${py}H${k.e.x}V${ty}H${tx}`);
        if (k.e.dot) dots.push({ s: sid, x: k.e.x, y: py });
      } else if (k.e.p) {
        let d = `M${px} ${py}`,
          lx = px,
          ly = py;
        for (const [x, y] of k.e.p) {
          d += `L${x} ${y}`;
          lx = x;
          ly = y;
        }
        if (ly !== ty) d += `L${lx} ${ty}`;
        d += `L${tx} ${ty}`;
        seg(sid, d);
        if (k.e.dot) dots.push({ s: sid, x: k.e.p[0][0], y: k.e.p[0][1] });
      }
    }
  }
  /* 大きさ（ラベルの幅を含める） */
  let x0 = -40,
    y0 = 1e9,
    x1 = 0,
    y1 = -1e9;
  for (const n of c.nodes) {
    const h = isGate(n.t) ? gh(n.ins.length) / 2 : 14;
    y0 = Math.min(y0, n.y - h);
    y1 = Math.max(y1, n.y + h);
    if (n.t === 'out') x1 = Math.max(x1, n.x + 34 + textW(n.lb) + 6);
    else x1 = Math.max(x1, outPin(n)[0]);
    if (n.t === 'in') x0 = Math.min(x0, -12 - textW(n.lb, 8.5));
    for (const e of n.ins)
      if (e.p)
        for (const [, y] of e.p) {
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
  }
  /* 段数（輪があれば null） */
  const memo = new Map<string, number>(),
    stack = new Set<string>();
  let loop = false;
  const depth = (id: string): number => {
    const n = N.get(id);
    if (!n || n.t === 'in') return 0;
    const m = memo.get(id);
    if (m != null) return m;
    if (stack.has(id)) {
      loop = true;
      return 0;
    }
    stack.add(id);
    const d = Math.max(0, ...n.ins.map((e) => depth(e.s))) + (isGate(n.t) ? 1 : 0);
    stack.delete(id);
    memo.set(id, d);
    return d;
  };
  const outputs = c.nodes.filter((n) => n.t === 'out');
  const dep = Math.max(...outputs.map((n) => depth(n.id)));
  const gates = c.nodes.filter((n): n is Node & { t: GateType } => isGate(n.t));
  const p: Prepared = {
    c,
    N,
    inputs: c.nodes.filter((n) => n.t === 'in'),
    outputs,
    gates,
    segs,
    dots,
    box: [x0, y0 - 10, x1 - x0, y1 - y0 + 20],
    gateCount: gates.length,
    depth: loop ? null : dep,
  };
  cache.set(c.id, p);
  return p;
}

/* ---------- 計算 ---------- */
export interface Sim {
  p: Prepared;
  /** ゲートの出力 */
  v: Record<string, Bit>;
  inp: Record<string, Bit>;
  val: (id: string) => Bit;
  /** 1 段進める。変わったゲートの数を返す */
  tick: () => number;
  /** 落ち着くまで進める。かかった段数（落ち着かなければ −1） */
  settle: (max?: number) => number;
}
export function makeSim(c: Sample): Sim {
  const p = prep(c);
  const v: Record<string, Bit> = {},
    inp: Record<string, Bit> = {};
  for (const g of p.gates) v[g.id] = c.init?.[g.id] ?? 0;
  for (const n of p.inputs) inp[n.id] = 0;
  const val = (id: string): Bit => {
    const n = p.N.get(id);
    if (!n) return 0;
    if (n.t === 'in') return inp[id];
    if (isGate(n.t)) return v[id];
    return val(n.ins[0].s);
  };
  const tick = (): number => {
    const nv: Record<string, Bit> = {};
    let ch = 0;
    for (const g of p.gates) {
      nv[g.id] = GF[g.t](g.ins.map((e) => val(e.s)));
      if (nv[g.id] !== v[g.id]) ch++;
    }
    Object.assign(v, nv);
    return ch;
  };
  const settle = (max = 120): number => {
    for (let k = 0; k < max; k++) if (!tick()) return k;
    return -1;
  };
  return { p, v, inp, val, tick, settle };
}

export interface TruthTable {
  ins: string[];
  outs: string[];
  rows: Record<string, Bit>[];
}
const ttCache = new Map<string, TruthTable>();
/** 真理値表（組み合わせ回路）。入力は定義の順で、先頭が上位のビット */
export function truthTable(c: Sample): TruthTable {
  const hit = ttCache.get(c.id);
  if (hit) return hit;
  const p = prep(c);
  const ins = p.inputs.map((n) => n.id),
    outs = p.outputs.map((n) => n.id),
    rows: Record<string, Bit>[] = [];
  for (let k = 0; k < 1 << ins.length; k++) {
    const s = makeSim(c),
      row: Record<string, Bit> = {};
    ins.forEach((id, i) => {
      const b = ((k >> (ins.length - 1 - i)) & 1) as Bit;
      s.inp[id] = b;
      row[id] = b;
    });
    s.settle();
    for (const id of outs) row[id] = s.val(id);
    rows.push(row);
  }
  const t = { ins, outs, rows };
  ttCache.set(c.id, t);
  return t;
}

/** 記録の中から出力のハザード（1〜2 段だけ反対に振れる）を探す。[出力の id, 始まりの添字, 長さ] */
export function hazards(hs: readonly Record<string, Bit>[], ids: readonly string[]): [string, number, number][] {
  const out: [string, number, number][] = [];
  for (const id of ids)
    for (let i = 1; i < hs.length - 1; i++) {
      const b = hs[i][id];
      if (hs[i - 1][id] === b) continue;
      let k = i;
      while (k < hs.length && hs[k][id] === b) k++;
      if (k < hs.length && k - i <= 2) out.push([id, i, k - i]);
    }
  return out;
}

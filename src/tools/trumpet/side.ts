import { arc, f1, join, lerpT, mpIn, normals, OUT, P, type Pt, RIM, rect, ribbon, seg } from './shapes';

/**
 * 横から見たトランペットの図の形（DOM に依存しない。図の座標、約 1.73 px/mm）。
 * 奏者の右側から見た図。各部の位置・太さ・形は、Wikimedia Commons の写真「Yamaha Trumpet YTR-8335LA.tif」
 * （Yamaha Corporation、CC BY-SA 4.0）をベルの縁の直径 123 mm で図の縮尺にそろえて測った（写真の傾きは直し、
 * リードパイプ・ベル管・下の段の管を水平にした）。弁のケースの口の位置は写真「Trompette - corps.JPG」（Wikimedia Commons、
 * Eusebius、CC BY 3.0。抜差しを外した本体）で確かめた。管の通り道: マウスピース → リードパイプ → 主管抜差し →
 * 下の管 → 第 3 弁 → 弁の間の管 → 第 2 弁 → 弁の間の管 → 第 1 弁 → ベル管の下の管（第 1 抜差しの奥）→
 * ベルの曲がり → ベル管（弁のケースの奥）→ ベル。第 3 抜差しの下の管は主管抜差しの下の管の奥に隠れる。
 * 弁のケースの中の通り道は外から見えないので、ケースの奥に置く（見えるのはケースの間の管だけ）
 */
export const SIDE_VIEW = '-10 -42 985 362';
const PXM = 1.73;
/** 弁の中心の x と、ケースの胴の半幅 */
export const VX = [362, 403, 444] as const;
const CW = 17.5;
/** 中心線の高さ: リードパイプ（とマウスピース）、ベル管、下の段（主管抜差しの下の管・弁の間の管・ベル管の下の管） */
const Y_LP = 142.5,
  Y_BELL = 110.5,
  Y_LOW = 240;
/** 円筒部の管の外の半幅と、気柱の半幅（内径 11.65 mm から管の壁の分を引いた見た目の値） */
const HW = 10.6,
  AIR = 9;
/** ベルの曲がり（中心と半径） */
const BOW = { x: 196, y: (Y_BELL + Y_LOW) / 2, r: (Y_LOW - Y_BELL) / 2 };
/** ベル管の外の半幅（x）。写真の上の縁から測った。弁のケースの奥（x 340〜470）は前後から補った */
const BELL: readonly (readonly [number, number])[] = [
  [196, 12.2],
  [250, 12.4],
  [300, 12.8],
  [330, 13.5],
  [480, 17.4],
  [560, 18.6],
  [640, 20.5],
  [700, 22.7],
  [735, 24.7],
  [780, 27.5],
  [800, 29.5],
  [820, 32],
  [840, 35.1],
  [860, 40.3],
  [880, 48.4],
  [890, 54.3],
  [900, 62.3],
  [910, 83],
  [920, 103.7],
  [930, 105.7],
];
/** ベルの開口（縁の楕円の中心と半径） */
const MOUTH = { x: 931, rx: 20, ry: 106.5 };
/** ベルの曲がりとベル管の外の半幅（曲がりは下の 10.6 から上の 12.2 へ太る） */
const bellHw = (p: Pt) =>
  p[0] < BOW.x - 0.01 || p[1] > Y_BELL + 0.5 ? HW + (1.6 * (Y_LOW - p[1])) / (Y_LOW - Y_BELL) : lerpT(BELL, p[0]);
const bellPts = () => join(arc(BOW.x, BOW.y, BOW.r, 90, 270, 4), seg(BOW.x, Y_BELL, MOUTH.x - 1, Y_BELL, 4));

/** 主管抜差しの曲がり（上の管の端 → 角 → 縦 → 角 → 下の管の端）。角の半径 25 */
const crookPts = (x0: number, x1: number) =>
  join(
    seg(x0, Y_LP, 714, Y_LP),
    arc(714, Y_LP + 25, 25, -90, 0, 3),
    seg(739, Y_LP + 25, 739, Y_LOW - 25),
    arc(714, Y_LOW - 25, 25, 0, 90, 3),
    seg(714, Y_LOW, x1, Y_LOW),
  );
/** 第 1 抜差し: 上下の管の高さ、曲がりの中心 x、ケースへ曲がる端の x */
const S1 = { yu: 219, yl: 255, x: 251, xe: 352 };
const s1Bend = () => arc(S1.x, (S1.yu + S1.yl) / 2, (S1.yl - S1.yu) / 2, 270, 90, 3);
/** 第 3 抜差し: 上の管の高さ（下の管は Y_LOW）、曲がりの中心 x、ケースの口の x */
const S3 = { yu: 208.5, x: 650, xe: VX[2] + CW };
const s3Bend = () => arc(S3.x, (S3.yu + Y_LOW) / 2, (Y_LOW - S3.yu) / 2, -90, 90, 3);
/**
 * 第 2 抜差し: 第 2 弁のケースの手前から、左下へ 24° 傾いて出る短い U 字の管（写真では管の面が奥へ傾いている）。
 * 上の管の口 u0、向き d、曲がりの半径 r、上と下の管の長さ
 */
const S2 = (() => {
  const a = (156 * Math.PI) / 180,
    d: Pt = [Math.cos(a), Math.sin(a)],
    n: Pt = [Math.sin(a), -Math.cos(a)],
    u0: Pt = [409, 219],
    l0: Pt = [410, 251],
    /* 2 つの口の差を、管の向きと、それに直交する向きに分ける */
    dl: Pt = [l0[0] - u0[0], l0[1] - u0[1]],
    r = (dl[0] * n[0] + dl[1] * n[1]) / 2,
    la = 32,
    lb = la - (dl[0] * d[0] + dl[1] * d[1]),
    b: Pt = [u0[0] + la * d[0] + r * n[0], u0[1] + la * d[1] + r * n[1]];
  return { d, n, u0, l0, r, la, lb, b, deg: (a * 180) / Math.PI };
})();
const s2Pts = () => {
  const { d, n, u0, l0, r, la, b, deg } = S2;
  return join(
    seg(u0[0], u0[1], u0[0] + la * d[0], u0[1] + la * d[1], 3),
    arc(b[0], b[1], r, deg + 90, deg - 90, 3),
    seg(b[0] + r * n[0], b[1] + r * n[1], l0[0], l0[1], 3),
  );
};

/** 動かない管・弁のケース・小物 */
const S = (() => {
  const band = (x0: number, x1: number, y: number, hw: number, r = 1) => rect(x0, y - hw, x1, y + hw, r);
  const ell = (cx: number, cy: number, rx: number, ry: number) =>
    `M${P(cx, cy - ry)}A${f1(rx)} ${f1(ry)} 0 0 1 ${P(cx, cy + ry)}A${f1(rx)} ${f1(ry)} 0 0 1 ${P(cx, cy - ry)}Z`;
  const circ = (cx: number, cy: number, r: number) => ell(cx, cy, r, r);
  /* 弁のケースの間（ケースの胴の縁から縁） */
  const gaps = [
    [VX[0] + CW, VX[1] - CW],
    [VX[1] + CW, VX[2] - CW],
  ] as const;
  const { d, u0, l0 } = S2;
  const along = (p: Pt, t: number): Pt => [p[0] + t * d[0], p[1] + t * d[1]];
  return {
    /* 奥: ベルの曲がりとベル管、ベル管の下の管（第 1 弁から曲がりまで） */
    bell: ribbon(bellPts(), bellHw),
    bellLow: ribbon(seg(VX[0], Y_LOW, BOW.x, Y_LOW, 4), HW),
    bellMouth: ell(MOUTH.x, Y_BELL, MOUTH.rx, MOUTH.ry),
    bellRim: ell(MOUTH.x + 1.5, Y_BELL, MOUTH.rx - 3.5, MOUTH.ry - 4.5),
    /* 弁のケースの間: 空気が通る管（下の段）と、ケースをつなぐ支え */
    knuck: gaps.map(([a, b]) => band(a - 3, b + 3, Y_LOW + 1, 5.5)).join(''),
    spacers: gaps
      .map(([a, b]) =>
        [192, 266]
          .map(
            (y) =>
              band(a - 2, b + 2, y, 3.2) + band(a - 0.5, a + 1.8, y, 4.6, 0.8) + band(b - 1.8, b + 0.5, y, 4.6, 0.8),
          )
          .join(''),
      )
      .join(''),
    /* 弁のケース: 胴、上の帯、上のキャップ（ローレット）、フェルト、下のキャップ */
    casings: VX.map((c) => rect(c - CW, 116, c + CW, 286, 1.5)).join(''),
    bands: VX.map((c) => rect(c - 18.8, 172, c + 18.8, 182, 1.5)).join(''),
    caps: VX.map((c) => rect(c - 20, 101, c + 20, 121, 3) + rect(c - 19.5, 285, c + 19.5, 299, 3)).join(''),
    knurl: VX.map((c) => {
      let s = `M${P(c - 20, 105.5)}H${f1(c + 20)}M${P(c - 20, 112)}H${f1(c + 20)}M${P(c - 19.5, 288.5)}H${f1(c + 19.5)}`;
      for (let x = c - 18; x <= c + 18; x += 3) s += `M${P(x, 106.5)}V112M${P(x, 289.5)}V297`;
      return s;
    }).join(''),
    felts: VX.map((c) => ell(c, 101.5, 16, 2.6)).join(''),
    /* 第 3 抜差し（主管抜差しの下の管より奥）: 上の管・曲がり・下の管、ケースの口の輪、継ぎ目の輪、止め */
    third:
      ribbon(s3Bend(), HW) +
      ribbon(seg(S3.x + 1, Y_LOW, S3.xe, Y_LOW, 6), HW) +
      ribbon(seg(S3.xe, S3.yu, S3.x + 1, S3.yu, 6), 11),
    thirdRings:
      band(S3.xe - 0.5, S3.xe + 4.5, S3.yu, 12.5, 1.2) +
      band(477.5, 481.5, S3.yu, 12.2) +
      band(S3.x - 3, S3.x + 1, S3.yu, 11.8),
    stops:
      [599.5, 624.5].map((x) => rect(x - 6, 219, x + 6, 222.5, 1) + rect(x - 4, 222.5, x + 4, 229.5, 1.2)).join('') +
      rect(558.5, 219.5, 561.5, 229.5, 0.6),
    /* 手前: 第 1 抜差し（曲がり、上下の管とケースへ曲がる端、継ぎ目の輪、引き手） */
    first:
      ribbon(s1Bend(), 10) +
      ribbon(seg(S1.xe, S1.yu, S1.x - 1, S1.yu, 6), 10, [true, false]) +
      ribbon(seg(S1.x - 1, S1.yl, S1.xe, S1.yl, 6), 10, [false, true]),
    firstRings:
      band(S1.x - 1.5, S1.x + 2, S1.yu, 11) +
      band(S1.x - 1.5, S1.x + 2, S1.yl, 11) +
      band(340.5, 344, S1.yu, 11) +
      band(340.5, 344, S1.yl, 11),
    firstKnob: circ(S1.x - (S1.yl - S1.yu) / 2 - 0.5, (S1.yu + S1.yl) / 2, 4.5),
    /* 第 2 抜差し（第 2 弁のケースの手前）: U 字の管、ケースの口の輪、継ぎ目の輪、引き手 */
    second: ribbon(s2Pts(), 9.5),
    secondRings: [u0, l0]
      .flatMap((p) => [ribbon([along(p, -1), along(p, 3)], 10.8), ribbon([along(p, 9), along(p, 12)], 10.4)])
      .join(''),
    secondKnob: circ(382, 250, 4.5),
    /* 手前: 主管抜差し（下の管とケースへ曲がる端、曲がり、継ぎ目の輪） */
    mainLow: ribbon(seg(701, Y_LOW, VX[2] + 3, Y_LOW, 6), 10.9, [false, true]),
    crook: ribbon(crookPts(674, 699), HW),
    mainRings:
      band(698, 702.5, Y_LP, 11.6) +
      band(698, 702.5, Y_LOW, 11.6) +
      band(670, 675, Y_LP, 12.4) +
      band(660, 669, Y_LOW, 11.9),
    /* リードパイプ: 受け口、管（入口の 8.6 から 10.2 へ太る）、主管抜差しの外管 */
    recv: band(106, 184, Y_LP, 11.5, 1.5) + band(105.5, 109, Y_LP, 12.3) + band(180.5, 184.5, Y_LP, 12.3),
    lead: ribbon(seg(183, Y_LP, 517, Y_LP, 8), (p) => 8.6 + (1.6 * (p[0] - 183)) / 334),
    outer: band(515, 674, Y_LP, 11.4),
    mouth: ribbon(seg(0, Y_LP, 106, Y_LP, 0.4), (p) => lerpT(RIM.slice(2).concat(OUT), p[0] / PXM) * PXM),
    /* 支え: ベル管とリードパイプ（左）、ベル管と主管抜差し（右） */
    braces:
      'M203 117Q236 106 268 115.5Q236 126 203 117Z' +
      ribbon(seg(197, 133, 214, 118, 3), 2.6) +
      'M652 112Q690 103 724 118Q690 126 652 112Z' +
      ribbon(join(seg(641, 132, 648, 122, 3), seg(648, 122, 658, 114, 3)), 2.6),
    /* 小指掛け（リードパイプの上）、第 1 抜差しの親指掛け、第 3 抜差しの指輪 */
    hookBase: rect(466, 129.5, 521, 133.5, 1.5),
    hook: 'M471 131C469 120 468 108 471 99C474 91 482 86 489 88C494 89 496 92 494 95',
    saddle: 'M301 162C302 176 304 192 312 200C316 204 322 204 326 200C334 192 337 176 339 161M318 203V209',
    ring: `${circ(519.5, 177.5, 17.5)}M505 197.6Q519.5 202 534 197.6M519.5 195V199`,
    /* 第 3 抜差しの止めの棒（主管抜差しの上の管から下の管へ） */
    rod: `${rect(681, 151, 685, 232, 1) + rect(678.5, 149, 687.5, 158, 1.5)}M676 230L690 230L683 243Z`,
    /* ウォーターキー: 主管抜差しの曲がりの下（受け・レバー・軸）と、第 3 抜差しの曲がり（レバーだけ見える） */
    wkCup: rect(714, 248, 732, 259.5, 3),
    wkLever:
      'M728 255C742 254 752 246 757 232C762 218 765 205 770 195L773.5 197C769.5 207 767 220 762 234C756 250 744 260 729 260Z' +
      'M688 233C691 222 693 210 694 199L697.5 200C697.5 211 695.5 223 692 234Z',
    wkPivot: circ(746, 238, 3.2),
  };
})();

/** 図の描く順: 形（class・d・部品の名前）か、気柱の層（9 段の色の path を置く）。弁のボタンと文字はこの後 */
export type SideItem = { cls: string; d: string; name: string } | { air: AirLayer };
/** 部品の名前（図の上で指したときの説明） */
const NAMES: Record<keyof typeof S, string> = {
  bell: 'ベル管とベルの曲がり',
  bellLow: 'ベル管の下の管',
  bellMouth: 'ベルの開口',
  bellRim: 'ベルの縁',
  knuck: '弁の間の管',
  spacers: '弁のケースの間の支え',
  casings: '弁のケース',
  bands: '弁のケースの帯',
  caps: '弁のケースのキャップ',
  knurl: 'キャップのローレット',
  felts: 'フェルト',
  third: '第 3 抜差し',
  thirdRings: '第 3 抜差しの輪',
  stops: '第 3 抜差しの止め',
  first: '第 1 抜差し',
  firstRings: '第 1 抜差しの輪',
  firstKnob: '第 1 抜差しの引き手',
  second: '第 2 抜差し',
  secondRings: '第 2 抜差しの輪',
  secondKnob: '第 2 抜差しの引き手',
  mainLow: '主管抜差しの下の管',
  crook: '主管抜差しの曲がり',
  mainRings: '主管抜差しの輪',
  recv: '受け口',
  lead: 'リードパイプ',
  outer: '主管抜差しの外管',
  mouth: 'マウスピース',
  braces: '支え',
  hookBase: '小指掛けの台',
  hook: '小指掛け',
  saddle: '第 1 抜差しの親指掛け',
  ring: '第 3 抜差しの指輪',
  rod: '第 3 抜差しの止めの棒',
  wkCup: 'ウォーターキーの受け',
  wkLever: 'ウォーターキーのレバー',
  wkPivot: 'ウォーターキーの軸',
};
const it = (cls: string, ...ks: (keyof typeof S)[]): SideItem[] => ks.map((k) => ({ cls, d: S[k], name: NAMES[k] }));
export const SIDE_ITEMS: SideItem[] = [
  ...it('t-tube', 'bell', 'bellLow'),
  ...it('t-tube2', 'bellMouth'),
  { air: 'b' },
  ...it('t-line', 'bellMouth', 'bellRim'),
  ...it('t-tube', 'knuck'),
  { air: 'v' },
  ...it('t-tube2', 'spacers'),
  ...it('t-tube', 'casings'),
  ...it('t-tube2', 'bands', 'caps'),
  ...it('t-thin', 'knurl'),
  ...it('t-felt', 'felts'),
  ...it('t-tube', 'third'),
  ...it('t-tube2', 'thirdRings', 'stops'),
  { air: 'm' },
  ...it('t-tube', 'first'),
  ...it('t-tube2', 'firstRings'),
  ...it('t-tube', 'second'),
  ...it('t-tube2', 'secondRings'),
  ...it('t-tube', 'mainLow', 'crook'),
  ...it('t-tube2', 'mainRings'),
  ...it('t-tube', 'recv', 'lead', 'outer'),
  ...it('t-silver', 'mouth'),
  { air: 'f' },
  ...it('t-tube2', 'firstKnob', 'secondKnob', 'braces'),
  ...it('t-silver', 'hookBase'),
  ...it('t-wire', 'hook'),
  ...it('t-wire-i', 'hook'),
  ...it('t-wire', 'saddle'),
  ...it('t-wire-i', 'saddle'),
  ...it('t-wire', 'ring'),
  ...it('t-wire-i', 'ring'),
  ...it('t-silver', 'rod'),
  ...it('t-tube2', 'wkCup'),
  ...it('t-silver', 'wkLever', 'wkPivot'),
];

/** 図の文字: 位置、寄せ、文字、class（既定 lbs）、id（client が書き換える） */
export interface SideText {
  x: number;
  y: number;
  t: string;
  a?: 'start' | 'middle' | 'end';
  cls?: string;
  id?: string;
}
export const SIDE_TEXT: SideText[] = [
  ...VX.map((x, i): SideText => ({ x, y: 162, t: String(i + 1), a: 'middle', cls: 'lbb' })),
  { x: 46, y: 181, t: 'マウスピース', a: 'middle' },
  { x: 235, y: 168, t: 'リードパイプ', a: 'middle' },
  { x: 757, y: 168, t: '主管抜差し' },
  { x: 742, y: 276, t: 'ウォーターキー', a: 'middle' },
  { x: 600, y: 190, t: '第 3 抜差し', a: 'middle' },
  { x: 268, y: 282, t: '第 1 抜差し', a: 'middle' },
  { x: 338, y: 300, t: '第 2 抜差し', a: 'end' },
  { x: 880, y: 235, t: 'ベル', a: 'middle' },
  { x: 700, y: 300, t: '', a: 'middle', id: 'f-len' },
];

/** 弁のボタン（押し具合 0〜1 で 19 px 下がる）: 軸・ボタン・真珠・押した印 */
export function keyShapes(press: readonly number[]): {
  stems: string;
  caps: string[];
  pearls: string[];
  marks: string[];
} {
  const caps: string[] = [],
    pearls: string[] = [],
    marks: string[] = [];
  let stems = '';
  VX.forEach((c, i) => {
    const y = 65 + 19 * press[i];
    stems += rect(c - 4.5, y + 13, c + 4.5, 101, 1.5);
    caps.push(rect(c - 14, y, c + 14, y + 14, 5));
    pearls.push(rect(c - 11.5, y + 1.6, c + 11.5, y + 6.4, 2.4));
    marks.push(press[i] > 0.5 ? rect(c - 17, y - 3, c + 17, y + 17, 6) : 'M0 0');
  });
  return { stems, caps, pearls, marks };
}

/**
 * 気柱の層: b はベル管とその下の管（弁のケースと第 1 抜差しの奥）、v は弁のケースの中と弁の間の管（ケースの奥。見えるのはケースの間だけ）、
 * m は第 3 抜差し（主管抜差しの下の管の奥）、f は手前の管（マウスピース・リードパイプ・主管抜差し・第 1・第 2 抜差し）
 */
export const AIR_LAYERS = ['b', 'v', 'm', 'f'] as const;
export type AirLayer = (typeof AIR_LAYERS)[number];

/**
 * 気柱の区間: 中心線、内側の半幅、層、管の模型の要素と位置（Bore.pressureAt の el と s の範囲）。
 * 弁の組ごとに通り道が変わる（押した弁は抜差しを回る）
 */
interface AirPiece {
  pts: Pt[];
  hw: (p: Pt) => number;
  layer: AirLayer;
  el: number;
  s0: number;
  s1: number;
}
/** 気柱の 1 つの四角（帯の 1 区切り）: 形、層、要素と位置 */
export interface AirQuad {
  d: string;
  layer: AirLayer;
  el: number;
  s: number;
}

/** 押した弁の組（第 1・第 2・第 3）の気柱の四角の列 */
export function airQuads(v: readonly boolean[]): AirQuad[] {
  const pieces: AirPiece[] = [];
  type Part = [Pt[], number | ((p: Pt) => number), AirLayer];
  /** 要素 el の s0〜s1 を、続いた区間の長さで分ける */
  const chain = (el: number, parts: Part[], s0 = 0, s1 = 1) => {
    const lens = parts.map(([pts]) => {
      let l = 0;
      for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return l;
    });
    const L = lens.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    parts.forEach(([pts, hw, layer], i) => {
      const a = s0 + ((s1 - s0) * acc) / L;
      acc += lens[i];
      pieces.push({
        pts,
        hw: typeof hw === 'number' ? () => hw : hw,
        layer,
        el,
        s0: a,
        s1: s0 + ((s1 - s0) * acc) / L,
      });
    });
  };
  /* 弁のケースの中の通り道（ケースの口と口を結ぶ。ケースに隠れる） */
  const IN = 4.5;
  const inside = (x0: number, y0: number, x1: number, y1: number): Part => [seg(x0, y0, x1, y1, 3), IN, 'v'];
  const c1 = VX[0],
    c2 = VX[1],
    c3 = VX[2];
  /* マウスピース（88 mm）とリードパイプ: 要素 0 の 0〜0.261 と 0.261〜1 */
  chain(0, [[seg(0.9, Y_LP, 152, Y_LP, 1.2), (p) => Math.max(0.8, mpIn(p[0] / PXM) * PXM - 0.6), 'f']], 0, 0.261);
  chain(
    0,
    [[seg(152, Y_LP, 700, Y_LP, 5), (p) => 7 + (AIR - 7) * Math.min(1, Math.max(0, (p[0] - 184) / 333)), 'f']],
    0.261,
    1,
  );
  /* 主管抜差し: 曲がりから下の管を通って第 3 弁のケースの中ほどまで */
  chain(1, [[crookPts(700, c3), AIR, 'f']]);
  /* 第 3 弁: 押すと上の管から第 3 抜差しを回り、下の管からケースへ戻る */
  if (v[2])
    chain(2, [
      inside(c3, Y_LOW, S3.xe, S3.yu),
      [join(seg(S3.xe, S3.yu, S3.x, S3.yu, 5), s3Bend(), seg(S3.x, Y_LOW, S3.xe, Y_LOW, 5)), AIR, 'm'],
      inside(S3.xe, Y_LOW, c3 - CW, Y_LOW),
    ]);
  else chain(2, [inside(c3, Y_LOW, c3 - CW, Y_LOW)]);
  chain(3, [[seg(c3 - CW, Y_LOW, c2 + CW, Y_LOW, 1.5), IN, 'v']]);
  /* 第 2 弁: 押すとケースの手前の口から第 2 抜差しを回る */
  if (v[1])
    chain(4, [
      inside(c2 + CW, Y_LOW, S2.u0[0], S2.u0[1]),
      [s2Pts(), 8, 'f'],
      inside(S2.l0[0], S2.l0[1], c2 - CW, Y_LOW),
    ]);
  else chain(4, [inside(c2 + CW, Y_LOW, c2 - CW, Y_LOW)]);
  chain(5, [[seg(c2 - CW, Y_LOW, c1 + CW, Y_LOW, 1.5), IN, 'v']]);
  /* 第 1 弁: 押すと上の管から第 1 抜差しを回り、下の管からケースへ戻る。出口はベル管の下の管 */
  if (v[0])
    chain(6, [
      inside(c1 + CW, Y_LOW, S1.xe + 4, S1.yu),
      [join(seg(S1.xe + 4, S1.yu, S1.x, S1.yu, 5), s1Bend(), seg(S1.x, S1.yl, S1.xe + 4, S1.yl, 5)), 8.5, 'f'],
      inside(S1.xe + 4, S1.yl, c1 - CW, Y_LOW),
    ]);
  else chain(6, [inside(c1 + CW, Y_LOW, c1 - CW, Y_LOW)]);
  chain(7, [[seg(c1 - CW, Y_LOW, BOW.x, Y_LOW, 4), AIR, 'b']]);
  chain(8, [[bellPts(), (p) => Math.max(AIR, bellHw(p) - 1.6), 'b']]);
  const out: AirQuad[] = [];
  for (const pc of pieces) {
    const nm = normals(pc.pts),
      w = pc.pts.map((p) => pc.hw(p)),
      len: number[] = [0];
    for (let i = 1; i < pc.pts.length; i++)
      len.push(len[i - 1] + Math.hypot(pc.pts[i][0] - pc.pts[i - 1][0], pc.pts[i][1] - pc.pts[i - 1][1]));
    const L = len[len.length - 1] || 1;
    for (let i = 0; i + 1 < pc.pts.length; i++) {
      const a = pc.pts[i],
        b = pc.pts[i + 1],
        u = (len[i] + len[i + 1]) / 2 / L;
      out.push({
        d: `M${P(a[0] + nm[i][0] * w[i], a[1] + nm[i][1] * w[i])}L${P(b[0] + nm[i + 1][0] * w[i + 1], b[1] + nm[i + 1][1] * w[i + 1])}L${P(b[0] - nm[i + 1][0] * w[i + 1], b[1] - nm[i + 1][1] * w[i + 1])}L${P(a[0] - nm[i][0] * w[i], a[1] - nm[i][1] * w[i])}Z`,
        layer: pc.layer,
        el: pc.el,
        s: pc.s0 + (pc.s1 - pc.s0) * u,
      });
    }
  }
  return out;
}

/** 管の中の圧力を読む点（要素ごとの数）。図の四角は最も近い点の値を使う */
export const AIR_N = [80, 24, 12, 3, 8, 3, 12, 10, 80] as const;
/** 読む点の列（要素, 位置）の対 */
export function airPoints(): Float32Array {
  const out: number[] = [];
  AIR_N.forEach((n, el) => {
    for (let i = 0; i < n; i++) out.push(el, (i + 0.5) / n);
  });
  return Float32Array.from(out);
}
/** 要素 el の位置 s に最も近い読む点の番号 */
export function airIndex(el: number, s: number): number {
  let k = 0;
  for (let i = 0; i < el; i++) k += AIR_N[i];
  return k + Math.min(AIR_N[el] - 1, Math.max(0, Math.floor(s * AIR_N[el])));
}

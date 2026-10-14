/**
 * ヴァイオリンの図: 上から見た図・演奏者の目線の図（透視図）・駒の側から見た図。
 * 楽器の形は図を作るときに 1 回だけ描き、弓・指・弦の振れ・矢印は表示の状態（View）から毎回描き直す。
 * 上から見た図と演奏者の目線の図は、弦を押すとその位置を押さえて弾く（onPress）
 */
import { esc } from '../../lib/dom';
import { LEVELS } from './params';
import { OPEN } from './perform';
import { HAIR } from './player';
import {
  BFOOT,
  BRIDGE,
  BRIDGE_M,
  BTOP,
  CHIN_CLAMPS,
  CHINREST,
  COLLAR,
  crPts,
  FHOLE,
  HEART,
  OUTLINE,
  outlineIn,
  PEG,
  PEGBOX,
  PEGS,
  type Pts,
  SCROLL,
  SCROLL_LINES,
  STR_NUT,
  STR_U,
} from './shapes';
import { L0 } from './strings';

/** 表示の状態（弦は 0 = E 線 … 3 = G 線） */
export interface View {
  /** 弦ごと: 弓が触れている割合・音の高さ（MIDI）・弦の中ほどの全振幅 [m] */
  c: readonly number[];
  n: readonly number[];
  a: readonly number[];
  /** 弓速 [m/s]（下げ弓が正）・弓圧 [N]（全部の弦の和）・弓が触れる位置の駒からの距離 [mm] */
  vb: number;
  fb: number;
  xb: number;
  /** 弓が触れる位置 ÷ 振動する長さ（いちばん高い弦） */
  beta: number;
  /** 弓の向き（弓が止まっているときの表示に使う。1 = 下げ弓） */
  dir: number;
  /** 弓の毛の元（毛箱の側）から、弦に触れる点までの長さ [m] */
  pos: number;
  /** 弓が当たっているか */
  bowing: boolean;
  /** 弓が弦に触れていないときに弓を置いておく弦（いちばん高い弦が先頭でなくてもよい） */
  rest: readonly number[];
}

const NS = 'http://www.w3.org/2000/svg';
const f1 = (v: number) => String(Math.round(v * 10) / 10);
const p = (x: number, y: number) => `${f1(x)} ${f1(y)}`;
const polyD = (pts: Pts) => `M${pts.map((q) => p(q[0], q[1])).join('L')}Z`;
const lineD = (pts: Pts) => `M${pts.map((q) => p(q[0], q[1])).join('L')}`;
const circ = (cx: number, cy: number, r: number) =>
  `M${p(cx - r, cy)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`;
/** Catmull-Rom の曲線（閉じる） */
function crLoop(pts: Pts): string {
  const n = pts.length;
  let d = `M${p(pts[0][0], pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n],
      p1 = pts[i],
      p2 = pts[(i + 1) % n],
      p3 = pts[(i + 2) % n];
    d += `C${p(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)} ${p(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)} ${p(p2[0], p2[1])}`;
  }
  return `${d}Z`;
}
/** Catmull-Rom の曲線（開く。close なら最後に閉じる） */
function crOpen(pts: Pts, close: boolean): string {
  let d = `M${p(pts[0][0], pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)],
      p1 = pts[i],
      p2 = pts[i + 1],
      p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${p(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)} ${p(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)} ${p(p2[0], p2[1])}`;
  }
  return d + (close ? 'Z' : '');
}

function mk<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}
const setD = (e: SVGElement, d: string) => {
  if (e.getAttribute('d') !== d) e.setAttribute('d', d);
};
/** 弓が弦から離れている度合い（0 = 弦に触れている、1 = 離れている）と、弓の不透明度 */
const liftOf = (v: View) => 1 - Math.min(1, Math.max(0, ...v.c));
const bowOpacity = (v: View, lift: number) => (v.bowing ? 1 - 0.45 * lift : 0.35);

/** 振動する長さ [mm] */
const lenMm = (q: number, n: number) => L0 * 1000 * 2 ** (-(n - OPEN[q]) / 12);
/** 弦ごとの、ひとりで弾く弓の傾き [rad]（駒の側から見た図。G 線の側が左。外側の弦は 9° 余分に傾ける） */
const SINGLE: number[] = (() => {
  const k = 4.4,
    R = [3.4, 4.4, 5.0, 5.8],
    C = STR_U.map((u, i) => [u * k, -BTOP(u) * k - R[i]]),
    pair = (a: number, c: number) => Math.atan2(C[c][1] - C[a][1], C[c][0] - C[a][0]),
    deg = Math.PI / 180,
    p32 = pair(3, 2),
    p21 = pair(2, 1),
    p10 = pair(1, 0);
  return [p10 + 9 * deg, (p21 + p10) / 2, (p32 + p21) / 2, p32 - 9 * deg];
})();
/** 弦の触れ方から弓の傾き [rad]（触れている弦の傾きの重みつき平均） */
export function bowAngle(c: readonly number[], last: number): number {
  let s = 0,
    w = 0;
  for (let q = 0; q < 4; q++) {
    s += c[q] * SINGLE[q];
    w += c[q];
  }
  return w > 0.05 ? s / w : last;
}
/** 段（LEVELS の番号）の弓の傾き [rad] */
export const levelAngle = (lv: number): number =>
  bowAngle(
    [0, 1, 2, 3].map((q) => ((LEVELS[lv].s as readonly number[]).includes(q) ? 1 : 0)),
    0,
  );

export interface FigOpt {
  /** 弦 si の、音の高さ n（MIDI。開放弦なら OPEN[si]）を押さえて弾く。n が null なら押さえる位置は変えない */
  onPress: (si: number, n: number | null) => void;
}

/** 押さえる位置の音の高さ（半音に丸める。駒に近すぎる位置は 2 オクターブ上まで） */
const stopAt = (q: number, lenMmV: number) =>
  OPEN[q] + Math.max(0, Math.min(24, Math.round(12 * Math.log2((L0 * 1000) / Math.max(1, lenMmV)))));

/* ===== 上から見た図: 1 mm を 1.45 px、渦巻きが左、E 線が上 ===== */
const S = 1.45,
  CY = 160,
  TIP = 50,
  NUT = TIP + 125 * S,
  PB = NUT - PEGBOX.len * S,
  BRX = NUT + 328 * S,
  BX0 = BRX - BRIDGE_M * S,
  X = (mm: number) => NUT + mm * S,
  XB = (m: number) => BX0 + m * S,
  yN = STR_NUT.map((d) => CY - d * S),
  yB = STR_U.map((d) => CY - d * S),
  XT = XB(246) + 9,
  yT = [-20.7, -6.9, 6.9, 20.7].map((d) => CY + d),
  yAt = (i: number, x: number) => yN[i] + ((yB[i] - yN[i]) * (x - NUT)) / (BRX - NUT),
  /** 指板の端（上駒から 270 mm） */
  BOARD_END = X(270);

function topStatic(): [string, string, string?][] {
  const outline = (ins: number) => {
    const pts = outlineIn(ins);
    return crOpen(
      pts
        .map(([m, h]) => [XB(m), CY - h * S])
        .concat(
          pts
            .slice()
            .reverse()
            .slice(1)
            .map(([m, h]) => [XB(m), CY + h * S]),
        ),
      true,
    );
  };
  const fholes = [1, -1].map((sg) => polyD(FHOLE.map(([m, h]) => [XB(m), CY - sg * h * S]))).join('');
  const scroll = polyD(SCROLL.map(([d, w]) => [PB - d * S, CY - w * S]));
  const scrollLines = SCROLL_LINES.map((l) => lineD(l.map(([d, w]) => [PB - d * S, CY - w * S]))).join('');
  const w0 = PEGBOX.w0 * S + 0.05,
    w1 = PEGBOX.w1 * S;
  const pegbox = `M${p(NUT + 1, CY - w0)}L${p(PB, CY - w1)}L${p(PB, CY + w1)}L${p(NUT + 1, CY + w0)}Z`;
  const slot = `M${p(NUT - 5, CY - 10.2)}L${p(PB + 5, CY - 9)}L${p(PB + 5, CY + 9)}L${p(NUT - 5, CY + 10.2)}Z`;
  const wallAt = (x: number) => w1 + ((x - PB) * (w0 - w1)) / (NUT - PB);
  let shafts = '',
    heads = '',
    collars = '',
    boxStr = '';
  for (const g of PEGS) {
    const x = X(-g.d),
      sg = g.s <= 1 ? -1 : 1,
      w = wallAt(x),
      at = ([a, c]: number[]) => [x + c * S, CY + sg * (w + a * S)];
    shafts += `M${p(x - 2.6, CY - sg * (w + 4))}L${p(x - 2.6, CY + sg * w)}L${p(x + 2.6, CY + sg * w)}L${p(x + 2.6, CY - sg * (w + 4))}Z`;
    heads += polyD(PEG.map(at));
    collars += polyD(COLLAR.map(at));
    boxStr += `M${p(NUT, yN[g.s])}L${p(x, CY + sg * 6.5)}`;
  }
  const board = `M${p(X(0), CY - 12 * S)}L${p(X(270), CY - 21 * S)}Q${p(X(273.5), CY)} ${p(X(270), CY + 21 * S)}L${p(X(0), CY + 12 * S)}Z`;
  const nut = `M${p(NUT + 1, CY - 12 * S)}L${p(NUT + 1, CY + 12 * S)}`;
  const x0 = XB(244),
    x1 = XB(343),
    ht = 20 * S,
    hb = 11 * S;
  const tail =
    `M${p(x0 + 4, CY - ht)}L${p(x1 - 6, CY - hb)}Q${p(x1 + 2, CY - hb + 2)} ${p(x1 + 3, CY)}Q${p(x1 + 2, CY + hb - 2)} ${p(x1 - 6, CY + hb)}` +
    `L${p(x0 + 4, CY + ht)}Q${p(x0 - 2, CY + ht - 2)} ${p(x0 - 2, CY)}Q${p(x0 - 2, CY - ht + 2)} ${p(x0 + 4, CY - ht)}Z`;
  const tailFret = `M${p(x0 + 5, CY - ht + 5)}L${p(x0 + 5, CY + ht - 5)}`;
  const tuner = yT
    .map(
      (y) =>
        `M${p(XT + 2, y - 4)}L${p(XT + 18, y - 4)}L${p(XT + 18, y + 4)}L${p(XT + 2, y + 4)}Z${circ(XT + 24, y, 3.2)}`,
    )
    .join('');
  const sad = XB(353.5);
  const tailgut = `M${p(x1 + 3, CY - 4)}L${p(sad, CY - 3)}M${p(x1 + 3, CY + 4)}L${p(sad, CY + 3)}`;
  const saddle = `M${p(sad - 1, CY - 14)}L${p(sad + 5, CY - 14)}L${p(sad + 5, CY + 14)}L${p(sad - 1, CY + 14)}Z`;
  const endpin = circ(XB(356) + 6, CY, 5);
  const chin = crLoop(CHINREST.map(([m, h]) => [XB(m), CY + h * S]));
  /* 留め金: 胴の輪郭の上に、側板をまたぐ向きで置く */
  const OUTD = crPts(OUTLINE, 20).filter(([m]) => m > 330);
  const brackets = CHIN_CLAMPS.map((hh) => {
    let k = 1;
    for (let i = 1; i < OUTD.length - 1; i++) if (Math.abs(OUTD[i][1] - hh) < Math.abs(OUTD[k][1] - hh)) k = i;
    const cx = XB(OUTD[k][0]),
      cy = CY + OUTD[k][1] * S,
      dm = OUTD[k + 1][0] - OUTD[k - 1][0],
      dh = OUTD[k + 1][1] - OUTD[k - 1][1],
      l = Math.hypot(dm, dh),
      tx = dm / l,
      ty = dh / l;
    return polyD(
      [
        [5, 3.5],
        [5, -3.5],
        [-5, -3.5],
        [-5, 3.5],
      ].map(([a, b]) => [cx - ty * a + tx * b, cy + tx * a + ty * b]),
    );
  }).join('');
  const bridge = polyD(
    BFOOT.map(([u, d]) => [BRX + 1 - d * S, CY - u * S]).concat([
      [BRX + 1, CY - 22.5 * S],
      [BRX + 1, CY + 22.5 * S],
    ]),
  );
  const bridgeTop = `M${p(BRX - 0.3, CY - 22.4 * S)}L${p(BRX - 0.3, CY + 22.4 * S)}`;
  /* 弦の駒からテールピースまで（上駒から駒までは振動と一緒に描く） */
  const after = (i: number) => `M${p(BRX, yB[i])}L${p(XT, yT[i])}`;
  return [
    [scroll, 'v-wood'],
    [scrollLines, 'v-dima'],
    [pegbox, 'v-wood'],
    [slot, 'v-hole'],
    [shafts, 'v-ebony'],
    [boxStr, 'v-str', 'stroke-width:1.1px'],
    [heads, 'v-ebony'],
    [collars, 'v-maple', 'stroke-width:0.8px'],
    [outline(0), 'v-top'],
    [outline(3.2), 'v-purf'],
    [outline(4.6), 'v-purf'],
    [fholes, 'v-hole'],
    [chin, 'v-ebony'],
    [brackets, 'v-maple'],
    [board, 'v-ebony'],
    [nut, 'v-nut'],
    [tail, 'v-ebony'],
    [tailFret, 'v-dima', 'stroke:var(--surface);stroke-width:2px'],
    [tuner, 'v-maple'],
    [tailgut, 'v-dima', 'stroke-width:1.6px'],
    [saddle, 'v-ebony'],
    [endpin, 'v-wood'],
    [bridge, 'v-maple'],
    [bridgeTop, 'v-dima'],
    ...strPaths(after, SW_TOP),
  ];
}

/** 弦の太さ [px]（上から見た図・演奏者の目線の図。0 = E 線） */
const SW_TOP = [1.1, 1.5, 1.7, 2],
  SW_PL = [1.2, 1.6, 1.8, 2.1];
/** 弦の縁取り（指板の上でも見えるように）と弦の線 */
const strPaths = (d: (i: number) => string, w: readonly number[]): [string, string, string][] =>
  [0, 1, 2, 3].flatMap((i): [string, string, string][] => [
    [d(i), 'v-sth', `stroke-width:${w[i] + 1.6}px`],
    [d(i), i ? 'v-str w' : 'v-str', `stroke-width:${w[i]}px`],
  ]);

/* ===== 演奏者の目線（透視図）: z は弦に沿って駒 0 から上駒 328、x は E 線の側が正、y は上 ===== */
const EYE = [-20, 330, -330],
  TGT = [0, 20, 150],
  ZB = BRIDGE_M,
  ZN = 328,
  ZS = ZN + PEGBOX.len,
  YFN = 26,
  YFE = 38.5,
  ZFE = 58,
  YBF = 14,
  /** 弦がテールピースへ下りる点 */
  XT3 = [9.5, 3.2, -3.2, -9.5],
  RM = [0.6, 0.8, 0.9, 1.0];
type V3 = [number, number, number];
const sub = (a: readonly number[], c: readonly number[]): V3 => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
const dot = (a: readonly number[], c: readonly number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
const cross = (a: readonly number[], c: readonly number[]): V3 => [
  a[1] * c[2] - a[2] * c[1],
  a[2] * c[0] - a[0] * c[2],
  a[0] * c[1] - a[1] * c[0],
];
const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const FW = nrm(sub(TGT, EYE)),
  RT = nrm(cross([0, 1, 0], FW)),
  UP = cross(FW, RT);
const raw = (P: readonly number[]) => {
  const d = sub(P, EYE),
    z = dot(d, FW);
  return [dot(d, RT) / z, -dot(d, UP) / z, z];
};
const outline3 = (ins: number): V3[] => {
  const pts = outlineIn(ins).map(([m, h]) => [ZB - m, h]);
  return pts
    .map(([z, h]) => [h, 0, z] as V3)
    .concat(
      pts
        .slice()
        .reverse()
        .slice(1)
        .map(([z, h]) => [-h, 0, z] as V3),
    );
};
/* 図の枠（1000 × 360）に合わせる倍率と位置 */
const PQ = (() => {
  const fit = outline3(0)
    .filter((P) => P[2] >= -80)
    .concat([
      [0, 22, 440],
      [-30, 22, 420],
      [30, 22, 420],
    ])
    .map(raw);
  const minX = Math.min(...fit.map((v) => v[0])),
    maxX = Math.max(...fit.map((v) => v[0])),
    minY = Math.min(...fit.map((v) => v[1])),
    maxY = Math.max(...fit.map((v) => v[1])),
    sc = Math.min(940 / (maxX - minX), 334 / (maxY - minY));
  return { sc, ox: 500 - (sc * (minX + maxX)) / 2, oy: 14 - sc * minY };
})();
const pr = (P: readonly number[]): number[] => {
  const v = raw(P);
  return [PQ.ox + PQ.sc * v[0], PQ.oy + PQ.sc * v[1], v[2]];
};
const rad = (P: readonly number[], r: number) => (PQ.sc * r) / raw(P)[2];
const poly3 = (pts: readonly (readonly number[])[]) => polyD(pts.map(pr));
const line3 = (pts: readonly (readonly number[])[]) =>
  `M${pts.map((P) => p(...(pr(P).slice(0, 2) as [number, number]))).join('L')}`;
const yBr = (i: number) => YBF + BTOP(STR_U[i]) + RM[i];
/** 弦 i の、駒から z [mm] の点 */
const sAt = (i: number, z: number): V3 => [
  STR_U[i] + ((STR_NUT[i] - STR_U[i]) * z) / ZN,
  yBr(i) + ((YFN + 1 - yBr(i)) * z) / ZN,
  z,
];

function playerStatic(): [string, string, string?][] {
  const body = crOpen(outline3(0).map(pr), true),
    purf = crOpen(outline3(3.5).map(pr), true),
    fholes = [1, -1].map((sg) => poly3(FHOLE.map(([m, h]) => [sg * h, 10, ZB - m]))).join(''),
    board = poly3([
      [-12, YFN, ZN],
      [12, YFN, ZN],
      [21, YFE, ZFE],
      [-21, YFE, ZFE],
    ]),
    boardEnd = poly3([
      [-21, YFE, ZFE],
      [21, YFE, ZFE],
      [21, YFE - 6, ZFE],
      [-21, YFE - 6, ZFE],
    ]),
    nut = line3([
      [-12, YFN + 1, ZN],
      [12, YFN + 1, ZN],
    ]),
    pegbox = poly3([
      [-PEGBOX.w0, 22, ZN + 2],
      [PEGBOX.w0, 22, ZN + 2],
      [PEGBOX.w1, 22, ZS],
      [-PEGBOX.w1, 22, ZS],
    ]),
    slot = poly3([
      [-7, 23, ZN + 8],
      [7, 23, ZN + 8],
      [6, 23, ZS - 6],
      [-6, 23, ZS - 6],
    ]),
    scP = ([d, w]: number[]) => [w, 22, ZS + d],
    scroll = poly3(SCROLL.map(scP)),
    scrollLines = SCROLL_LINES.map((l) => line3(l.map(scP))).join(''),
    wallQ = (z: number) => PEGBOX.w0 - ((PEGBOX.w0 - PEGBOX.w1) * (z - ZN - 2)) / (ZS - ZN - 2),
    pegZ = (d: number) => ZN + d,
    side = (s: number) => (s <= 1 ? 1 : -1),
    heads = PEGS.map((g) => poly3(PEG.map(([a, c]) => [side(g.s) * (wallQ(pegZ(g.d)) + a), 22, pegZ(g.d) + c]))).join(
      '',
    ),
    collars = PEGS.map((g) =>
      poly3(COLLAR.map(([a, c]) => [side(g.s) * (wallQ(pegZ(g.d)) + a), 22, pegZ(g.d) + c])),
    ).join(''),
    shafts = PEGS.map((g) => {
      const z = pegZ(g.d),
        w = wallQ(z),
        sg = side(g.s);
      return poly3([
        [-sg * (w + 2.5), 22, z - 1.8],
        [sg * w, 22, z - 1.8],
        [sg * w, 22, z + 1.8],
        [-sg * (w + 2.5), 22, z + 1.8],
      ]);
    }).join(''),
    tail = poly3([
      [-18, 24, -14],
      [18, 24, -14],
      [20, 23.5, -26],
      [10, 21, -125],
      [-10, 21, -125],
      [-20, 23.5, -26],
    ]),
    tuner = [10.9, 3.7, -3.7, -10.9]
      .map((x) => {
        const P = [x, 26, -34],
          c = pr(P);
        return circ(c[0], c[1], rad(P, 2.6));
      })
      .join(''),
    chin = crLoop(CHINREST.map(([m, h]) => pr([-h, 26, ZB - m]))),
    bridge = poly3(BRIDGE.map(([u, v]) => [u, YBF + v, 0])) + poly3(HEART.map(([u, v]) => [u, YBF + v, 0])),
    pegOf = (i: number) => PEGS.find((g) => g.s === i) ?? PEGS[0],
    /* 弦のテールピースから駒までと、上駒から糸巻きまで（上駒から駒までは振動と一緒に描く） */
    str = (i: number) =>
      line3([
        [XT3[i], 25, -22],
        [STR_U[i], yBr(i), 0],
      ]) +
      line3([
        [STR_NUT[i], YFN + 1, ZN],
        [STR_NUT[i] * 0.5, 22, pegZ(pegOf(i).d)],
      ]);
  return [
    [scroll, 'v-wood'],
    [scrollLines, 'v-dima'],
    [pegbox, 'v-wood'],
    [slot, 'v-hole'],
    [shafts, 'v-ebony'],
    [heads, 'v-ebony'],
    [collars, 'v-maple', 'stroke-width:0.8px'],
    [body, 'v-top'],
    [purf, 'v-purf'],
    [fholes, 'v-hole'],
    [boardEnd, 'v-ebony'],
    [board, 'v-ebony'],
    [nut, 'v-nut'],
    [tail, 'v-ebony'],
    [tuner, 'v-maple'],
    [chin, 'v-ebony'],
    [bridge, 'v-maple', 'fill-rule:evenodd'],
    ...strPaths(str, SW_PL),
  ];
}

/* ===== 駒の側から見た図: 1 mm を 4.4 px、G 線が左 ===== */
const BK = 4.4,
  BCX = 220,
  BYB = 262,
  BR = [3.4, 4.4, 5.0, 5.8],
  BC = STR_U.map((u, i) => [BCX + u * BK, BYB - BTOP(u) * BK - BR[i]]);

/*
 * ===== 弓の形 [mm]: s は毛の元（毛箱の金具の前の端）から先へ測る長さ、o は毛から棹の側への高さ =====
 * 毛箱・金具・目・ねじは J. A. Lamy の弓の毛箱の横からの写真（Wikimedia Commons「Joseph Alfred Lamy frog.jpg」）、
 * 頭と先の板は J.-J. Millant の弓の頭の写真（同「Violin Bow by Jean-Jacques Millant, Paris, Head.jpg」）の輪郭を
 * なぞった（金具の長さを 10 mm、頭の棹の太さを約 5 mm として mm に直した）。毛の長さは 650 mm。
 * 棹は元で毛から 25 mm、中ほど（元から 360 mm）で最も近づいて 10 mm、頭の手前で 21.5 mm（反り）
 */
const HAIR_MM = HAIR * 1000,
  /** 棹の中心の高さ */
  stickO = (s: number) =>
    s <= 0 ? 25 : s < 360 ? 10 + 15 * ((360 - s) / 360) ** 2 : 10 + 11.5 * ((Math.min(s, 645) - 360) / 285) ** 2,
  /** 棹の太さの半分（元 4.2 → 頭 2.45） */
  stickR = (s: number) => 4.2 - 1.75 * Math.min(1, Math.max(0, s / 645)),
  /** 横から見た毛箱（親指を掛ける前の切り欠きを含む）・金具・頭・ねじ（s, o） */
  FROG_SIDE: Pts = [
    [-0.8, 21.2],
    [-50.2, 21.2],
    [-50.2, 0.6],
    [-10, -1.4],
    [-10, 4.9],
    [-13, 5.3],
    [-14.9, 9.1],
    [-14.3, 13],
    [-11.3, 15.7],
    [-5.3, 17.1],
    [-1.5, 17.7],
  ],
  FERRULE_SIDE: Pts = [
    [0, -2],
    [-0.6, 4.4],
    [-10, 4.9],
    [-10, -1.4],
  ],
  /** 毛箱の目（貝）の中心と半径 */
  FROG_EYE = [-33.5, 9.7, 3.6],
  HEAD_SIDE: Pts = [
    [650, 0],
    [649.8, 8.9],
    [648.9, 15.6],
    [645, 19],
    [641, 23.8],
    [647.8, 24.4],
    [654.4, 25.3],
    [659.6, 25.1],
    [661.6, 20],
    [664.4, 14.4],
    [668.9, 10],
    [673.3, 7.6],
    [675.8, 6.4],
    [674.4, 4.4],
    [667.8, 2.2],
    [660, 0.7],
  ],
  BUTTON = [-83, -65.5],
  /** 握りの革と巻き線の範囲 */
  GRIP = [0, 25],
  WIND = [25, 100],
  /** 弓の中ほどの印と、5 cm ごとの目盛り（元から。弓が長さの向きに動くのが見えるように） */
  MID = HAIR_MM / 2,
  TICKS = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600];

export type FigMode = 'blur' | 'slow';

/** 弓の部品の描き分け（上から見た図と演奏者の目線の図で同じ） */
const BOW_PARTS: [string, string][] = [
  ['hair', 'v-hair'],
  ['ticks', 'v-tick'],
  ['stick', 'v-stick'],
  ['wind', 'v-wind'],
  ['grip', 'v-grip'],
  ['button', 'v-frog'],
  ['frog', 'v-frog'],
  ['eye', 'v-eye'],
  ['ferrule', 'v-ferrule'],
  ['head', 'v-stick'],
  ['plate', 'v-plate'],
  ['mid', 'v-mk'],
];

export class ViolinFigure {
  private readonly top: Record<string, SVGElement>;
  private readonly pl: Record<string, SVGElement>;
  private readonly br: Record<string, SVGElement>;
  private readonly bowT: Record<string, SVGElement>;
  private readonly bowP: Record<string, SVGElement>;
  private mode: FigMode = 'blur';
  private exag = 1;
  private slow = 50;
  private ang = SINGLE[1];

  constructor(
    private readonly svgTop: SVGSVGElement,
    private readonly svgPl: SVGSVGElement,
    svgBr: SVGSVGElement,
    private readonly opt: FigOpt,
  ) {
    /* 上から見た図 */
    for (const [d, cls, st] of topStatic()) mk('path', { d, class: cls, ...(st ? { style: st } : {}) }, svgTop);
    const T: Record<string, SVGElement> = {};
    /* 上駒から駒までの弦（振れている間は、振動の帯・形が弦の代わり） */
    for (let q = 0; q < 4; q++) {
      T[`h${q}`] = mk('path', { class: 'v-sth', style: `stroke-width:${SW_TOP[q] + 1.6}px` }, svgTop);
      T[`s${q}`] = mk('path', { class: q ? 'v-str w' : 'v-str', style: `stroke-width:${SW_TOP[q]}px` }, svgTop);
    }
    T.vib = mk('path', { class: 'v-band' }, svgTop);
    T.env = mk('path', { class: 'v-env' }, svgTop);
    T.bow = mk('g', {}, svgTop);
    this.bowT = Object.fromEntries(BOW_PARTS.map(([k, c]) => [k, mk('path', { class: c }, T.bow)]));
    T.fing = mk('path', { class: 'v-f' }, svgTop);
    T.lbF = mk('text', { class: 'lb2', y: 16, 'text-anchor': 'end' }, svgTop);
    T.lbF.textContent = '元（毛箱） ↑';
    T.lbT = mk('text', { class: 'lb2', y: 312, 'text-anchor': 'end' }, svgTop);
    T.lbT.textContent = '先 ↓';
    T.arrow = mk('path', { class: 'v-ar' }, svgTop);
    T.lv = mk('text', { class: 'lb3', y: 30 }, svgTop);
    T.lf = mk('text', { class: 'lb3', y: 46 }, svgTop);
    T.dimL = mk('path', { class: 'v-dim' }, svgTop);
    T.dimA = mk('path', { class: 'v-dima' }, svgTop);
    T.dimT = mk('text', { y: 237, 'text-anchor': 'end' }, svgTop);
    this.top = T;
    /* 演奏者の目線 */
    for (const [d, cls, st] of playerStatic()) mk('path', { d, class: cls, ...(st ? { style: st } : {}) }, svgPl);
    const P: Record<string, SVGElement> = {};
    for (let q = 0; q < 4; q++) {
      P[`h${q}`] = mk('path', { class: 'v-sth', style: `stroke-width:${SW_PL[q] + 1.6}px` }, svgPl);
      P[`s${q}`] = mk('path', { class: q ? 'v-str w' : 'v-str', style: `stroke-width:${SW_PL[q]}px` }, svgPl);
    }
    P.vib = mk('path', { class: 'v-band' }, svgPl);
    P.bow = mk('g', {}, svgPl);
    this.bowP = Object.fromEntries(BOW_PARTS.map(([k, c]) => [k, mk('path', { class: c }, P.bow)]));
    P.fing = mk('path', { class: 'v-f' }, svgPl);
    P.arrow = mk('path', { class: 'v-ar' }, svgPl);
    P.lv = mk('text', { class: 'lb3', 'text-anchor': 'middle' }, svgPl);
    const cap = mk('text', { class: 'lb2', x: 984, y: 350, 'text-anchor': 'end' }, svgPl);
    cap.textContent = '演奏者の目の位置から';
    this.pl = P;
    /* 駒の側から */
    mk('path', { class: 'v-top', d: 'M0 272L0 268Q220 254 440 268L440 272Z' }, svgBr);
    const B: Record<string, SVGElement> = {};
    B.ghost = mk('path', { class: 'v-ghost', d: this.ghosts() }, svgBr);
    mk(
      'path',
      {
        class: 'v-maple',
        style: 'fill-rule:evenodd',
        d:
          polyD(BRIDGE.map(([u, v]) => [BCX + u * BK, BYB - v * BK])) +
          crLoop(HEART.map(([u, v]) => [BCX + u * BK, BYB - v * BK])),
      },
      svgBr,
    );
    B.ring = mk('path', { class: 'v-on' }, svgBr);
    mk('path', { class: 'v-strc', d: BC.map(([x, y], i) => circ(x, y, BR[i])).join('') }, svgBr);
    B.hairO = mk('path', { class: 'v-hair-o' }, svgBr);
    B.hairL = mk('path', { class: 'v-hair-l' }, svgBr);
    B.stick = mk('path', { class: 'v-stick-l' }, svgBr);
    B.fArrow = mk('path', { class: 'v-ar' }, svgBr);
    B.vArrow = mk('path', { class: 'v-ar' }, svgBr);
    B.name = mk('text', { class: 'lbbig', x: 14, y: 32 }, svgBr);
    B.angle = mk('text', { class: 'lb3', x: 426, y: 32, 'text-anchor': 'end' }, svgBr);
    ['E', 'A', 'D', 'G'].forEach((nm, i) => {
      const t = mk(
        'text',
        { class: 'lb3', x: f1(BC[i][0]), y: f1(BC[i][1] + BR[i] + 19), 'text-anchor': 'middle' },
        svgBr,
      );
      t.textContent = nm;
    });
    this.br = B;
    this.bindTop();
    this.bindPlayer();
  }

  setMode(m: FigMode): void {
    this.mode = m;
    this.top.vib.setAttribute('class', m === 'slow' ? 'v-shape' : 'v-band');
    this.pl.vib.setAttribute('class', m === 'slow' ? 'v-shape' : 'v-band');
  }
  setExag(x: number): void {
    this.exag = x;
  }
  setSlow(k: number): void {
    this.slow = k;
  }

  /** 7 段の弓の線（薄い点線） */
  private ghosts(): string {
    let d = '';
    for (let l = 0; l < 7; l++) {
      const c = this.contact(levelAngle(l), LEVELS[l].s as readonly number[]);
      d += this.seg(c, 40, 400, 0);
    }
    return d;
  }
  /** 駒の側から見た図の、傾き th の弓が弦 ss に触れる点（毛の中心）と向き */
  private contact(th: number, ss: readonly number[]) {
    const nx = Math.sin(th),
      ny = -Math.cos(th),
      cps = ss.map((i) => [BC[i][0] + nx * (BR[i] + 3.5), BC[i][1] + ny * (BR[i] + 3.5)]);
    return {
      ux: Math.cos(th),
      uy: Math.sin(th),
      nx,
      ny,
      x: cps.reduce((s, c) => s + c[0], 0) / cps.length,
      y: cps.reduce((s, c) => s + c[1], 0) / cps.length,
    };
  }
  private seg(c: ReturnType<ViolinFigure['contact']>, xa: number, xb: number, off: number): string {
    const t0 = (xa - c.x) / c.ux,
      t1 = (xb - c.x) / c.ux;
    return `M${p(c.x + c.ux * t0 + c.nx * off, c.y + c.uy * t0 + c.ny * off)}L${p(c.x + c.ux * t1 + c.nx * off, c.y + c.uy * t1 + c.ny * off)}`;
  }

  /** 上から見た図を押したとき: 近い弦を、その位置で押さえて弾く */
  private bindTop(): void {
    this.svgTop.addEventListener('pointerdown', (e) => {
      const pt = this.local(this.svgTop, e);
      if (!pt || pt[0] < NUT - 8 || pt[0] > BRX) return;
      let best = -1,
        bd = 1e9;
      for (let i = 0; i < 4; i++) {
        const d = Math.abs(yAt(i, pt[0]) - pt[1]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best < 0 || bd > 14) return;
      e.preventDefault();
      this.opt.onPress(best, pt[0] <= BOARD_END ? stopAt(best, (BRX - Math.max(NUT, pt[0])) / S) : null);
    });
  }
  /** 演奏者の目線の図を押したとき: 弦の上の、画面で最も近い点を探す */
  private bindPlayer(): void {
    this.svgPl.addEventListener('pointerdown', (e) => {
      const pt = this.local(this.svgPl, e);
      if (!pt) return;
      let best = -1,
        bz = 0,
        bd = 1e9;
      for (let i = 0; i < 4; i++)
        for (let z = 0; z <= ZN; z += 2) {
          const v = pr(sAt(i, z)),
            d = Math.hypot(v[0] - pt[0], v[1] - pt[1]);
          if (d < bd) {
            bd = d;
            best = i;
            bz = z;
          }
        }
      if (best < 0 || bd > 10) return;
      e.preventDefault();
      this.opt.onPress(best, bz >= ZN - 270 ? stopAt(best, bz) : null);
    });
  }
  private local(svg: SVGSVGElement, e: PointerEvent): number[] | null {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [q.x, q.y];
  }

  /** 表示を描き直す。t は時刻 [s]（スローの動きに使う） */
  draw(v: View, t: number, showTop: boolean): void {
    this.ang = v.c.some((c) => c > 0.05)
      ? bowAngle(v.c, this.ang)
      : bowAngle(
          [0, 1, 2, 3].map((q) => (v.rest.includes(q) ? 1 : 0)),
          this.ang,
        );
    if (showTop) this.drawTop(v, t);
    else this.drawPlayer(v, t);
    this.drawBridge(v);
  }

  /** 弦 q の振れの形（u は指 0 → 駒 1）。スローでは角が往復する Helmholtz の形、残像では振れる範囲の帯 */
  private shape(a: number, f0: number, t: number): { band: (u: number) => number; corner: number | null } {
    if (this.mode === 'slow') {
      const ph = ((((f0 * t) / this.slow) % 1) + 1) % 1,
        /* 角は前半で駒から指へ（上の枝）、後半で指から駒へ（下の枝） */
        u = ph < 0.5 ? 1 - 2 * ph : 2 * ph - 1,
        sg = ph < 0.5 ? 1 : -1;
      return { band: (x) => 4 * x * (1 - x) * a, corner: sg * u };
    }
    return { band: (x) => 4 * x * (1 - x) * a, corner: null };
  }

  /**
   * 弓を描く。at(s, o, dz) は弓の上の点（s: 毛の元から先へ [mm]、o: 毛から棹の側への高さ [mm]、dz: 毛の幅の向き [mm]）の
   * 図の上の位置。上から見た図では o を横（棹は渦巻きの側へ傾けて持つ）、演奏者の目線では高さとして描く
   */
  private drawBow(B: Record<string, SVGElement>, at: (s: number, o: number, dz: number) => number[], top: boolean) {
    const P = (s: number, o: number, dz = 0) => {
        const q = at(s, o, dz);
        return p(q[0], q[1]);
      },
      poly = (pts: number[][]) => `M${pts.map(([s, o, dz]) => P(s, o, dz ?? 0)).join('L')}Z`,
      /* 棹の中心の高さ（上から見た図では、毛から渦巻きの側への横のずれ） */
      oc = (s: number) => (top ? -7.5 : stickO(s)),
      stickBand = (s0: number, s1: number, extra: number) => {
        const up: number[][] = [],
          dn: number[][] = [];
        for (let k = 0; k <= 12; k++) {
          const s = s0 + ((s1 - s0) * k) / 12;
          up.push([s, oc(s) + stickR(s) + extra]);
          dn.push([s, oc(s) - stickR(s) - extra]);
        }
        return poly(up.concat(dn.reverse()));
      },
      HW = 5.5;
    setD(
      B.hair,
      top
        ? poly([
            [0, -HW + 0.5],
            [HAIR_MM, -HW + 0.5],
            [HAIR_MM, HW - 0.5],
            [0, HW - 0.5],
          ])
        : poly([
            [0, 0, -HW],
            [HAIR_MM, 0, -HW],
            [HAIR_MM, 0, HW],
            [0, 0, HW],
          ]),
    );
    setD(
      B.ticks,
      TICKS.map((s) => (top ? `M${P(s, -HW + 0.5)}L${P(s, HW - 0.5)}` : `M${P(s, 0, -HW)}L${P(s, 0, HW)}`)).join(''),
    );
    setD(B.stick, stickBand(BUTTON[1], 646, 0));
    setD(B.wind, stickBand(WIND[0], WIND[1], 0.5));
    setD(B.grip, stickBand(GRIP[0], GRIP[1], 1));
    setD(B.button, stickBand(BUTTON[0], BUTTON[1], 0.6));
    if (top) {
      /*
       * 上から: 毛箱（幅 13 mm）は棹と毛の下に、頭は先の端に。目は毛箱の横の面にあるので見えない。
       * 棹を渦巻きの側へ傾けて持つので、毛箱と頭は棹の側へ寄って見える
       */
      setD(
        B.frog,
        poly([
          [-0.8, -10],
          [-0.8, 3],
          [-48, 3],
          [-50.2, 1],
          [-50.2, -8],
          [-48, -10],
        ]),
      );
      setD(
        B.ferrule,
        poly([
          [0, -5.5],
          [0, 5.5],
          [-10, 5.5],
          [-10, -5.5],
        ]),
      );
      setD(B.eye, '');
      setD(
        B.head,
        poly([
          [645, -9.9],
          [660, -8],
          [675.8, -4.5],
          [675.8, 1.5],
          [662, 5],
          [650, 5],
        ]),
      );
      setD(B.plate, '');
    } else {
      setD(B.frog, poly(FROG_SIDE));
      setD(B.ferrule, poly(FERRULE_SIDE));
      const e = at(FROG_EYE[0], FROG_EYE[1], 0),
        r = Math.hypot(
          ...at(FROG_EYE[0] + FROG_EYE[2], FROG_EYE[1], 0)
            .map((x, i) => x - e[i])
            .slice(0, 2),
        );
      setD(B.eye, circ(e[0], e[1], r));
      setD(B.head, poly(HEAD_SIDE));
      setD(B.plate, `M${P(675.8, 6.4)}L${P(667.8, 2.2)}L${P(660, 0.7)}`);
    }
    /* 弓の中ほどの印（棹の上のひし形） */
    const m = oc(MID),
      mr = stickR(MID) + 2.2;
    setD(
      B.mid,
      poly([
        [MID - 8, m],
        [MID, m + mr],
        [MID + 8, m],
        [MID, m - mr],
      ]),
    );
  }

  private drawTop(v: View, t: number): void {
    const T = this.top,
      /* 弓は、いちばん高い触れている弦の弓の位置に置く */
      xc = BRX - v.xb * S;
    let vib = '',
      env = '',
      fing = '';
    for (let q = 0; q < 4; q++) {
      const len = lenMm(q, v.n[q]),
        xf = Math.max(NUT, BRX - len * S),
        stopped = v.n[q] - OPEN[q] > 0.05,
        ampPx = ((v.a[q] * 1000 * S * this.exag) / 2) * (v.c[q] > 0 || v.a[q] > 1e-6 ? 1 : 0),
        f0 = (440 * 2 ** ((OPEN[q] - 69) / 12) * L0 * 1000) / len,
        /* 振れている間は、上駒から指までだけ弦を描く（指から駒までは振動の帯・形） */
        sd =
          ampPx < 0.15
            ? `M${p(NUT, yN[q])}L${p(BRX, yB[q])}`
            : xf > NUT + 0.5
              ? `M${p(NUT, yN[q])}L${p(xf, yAt(q, xf))}`
              : '';
      setD(T[`h${q}`], sd);
      setD(T[`s${q}`], sd);
      if (stopped && (v.c[q] > 0.3 || v.a[q] > 2e-6)) fing += circ(xf, yAt(q, xf), 6);
      if (ampPx < 0.15) continue;
      const sh = this.shape(ampPx, f0, t),
        xs = (u: number) => xf + (BRX - xf) * u,
        ys = (u: number) => yAt(q, xs(u)),
        us: number[] = [];
      for (let k = 0; k <= 24; k++) us.push(k / 24);
      if (sh.corner !== null) {
        const u = Math.abs(sh.corner),
          y = ys(u) - Math.sign(sh.corner) * sh.band(u);
        vib += `M${p(xf, ys(0))}L${p(xs(u), y)}L${p(BRX, ys(1))}`;
        env += `M${us.map((u2) => p(xs(u2), ys(u2) - sh.band(u2))).join('L')}M${us.map((u2) => p(xs(u2), ys(u2) + sh.band(u2))).join('L')}`;
      } else
        vib += `M${us.map((u2) => p(xs(u2), ys(u2) - sh.band(u2))).join('L')}L${us
          .slice()
          .reverse()
          .map((u2) => p(xs(u2), ys(u2) + sh.band(u2)))
          .join('L')}Z`;
    }
    setD(T.vib, vib);
    setD(T.env, env);
    setD(T.fing, fing);
    /*
     * 弓: 弦に触れる点が、毛の元から pos の位置（実際の長さで描く）。元は上（E 線の側）。弓が弦から離れると薄くする。
     * 触れる点の高さは、触れている弦（なければ弓を置いておく弦）の真ん中
     */
    const on = [0, 1, 2, 3].filter((q) => v.c[q] > 0.3),
      ss = on.length ? on : v.rest.length ? v.rest : [this.lead(v)],
      yc = ss.reduce((a, q) => a + yAt(q, xc), 0) / ss.length,
      yF = yc - v.pos * 1000 * S,
      lift = liftOf(v);
    this.drawBow(this.bowT, (s, o) => [xc + o * S, yF + s * S], true);
    T.bow.style.opacity = String(bowOpacity(v, lift));
    T.lbF.setAttribute('x', f1(xc - 22));
    T.lbT.setAttribute('x', f1(xc - 22));
    /* 弓の動く向き: 下げ弓は弓が元の側（上）へ動く */
    const down = (v.vb === 0 ? v.dir : v.vb) > 0,
      ax = xc + 22,
      ay0 = down ? 72 : 26,
      ay1 = down ? 26 : 72;
    setD(
      T.arrow,
      `M${p(ax, ay0)}L${p(ax, ay1)}M${p(ax - 5, ay1 + (down ? 7 : -7))}L${p(ax, ay1)}L${p(ax + 5, ay1 + (down ? 7 : -7))}`,
    );
    T.lv.setAttribute('x', f1(xc + 34));
    T.lf.setAttribute('x', f1(xc + 34));
    T.lv.textContent = `${down ? '下げ弓' : '上げ弓'} ${Math.abs(v.vb).toFixed(2)} m/s`;
    T.lf.textContent = `弓圧 ${v.fb.toFixed(2)} N`;
    setD(T.dimL, `M${f1(xc)} 222V242M${f1(BRX)} 222V242`);
    setD(
      T.dimA,
      `M${f1(xc + 1)} 233H${f1(BRX - 1)}M${f1(xc + 6)} 229L${f1(xc + 1)} 233L${f1(xc + 6)} 237M${f1(BRX - 6)} 229L${f1(BRX - 1)} 233L${f1(BRX - 6)} 237`,
    );
    T.dimT.setAttribute('x', f1(xc - 6));
    T.dimT.innerHTML = `x<tspan font-size="8" dy="2">b</tspan><tspan dy="-2"> ${esc(v.xb.toFixed(1))} mm（β ${v.beta.toFixed(2)}）</tspan>`;
  }

  private drawPlayer(v: View, t: number): void {
    const P = this.pl,
      lead = this.lead(v),
      zb = v.xb,
      SC = [0, 1, 2, 3].map((i) => sAt(i, zb)),
      /* 駒の側から見た図は y が下向き、透視図の空間は y が上向きなので、傾きの符号を変える */
      th = -this.ang,
      ux = Math.cos(th),
      uy = Math.sin(th),
      nx = -Math.sin(th),
      ny = Math.cos(th),
      on = [0, 1, 2, 3].filter((q) => v.c[q] > 0.3),
      ss = on.length ? on : v.rest.length ? [...v.rest] : [lead],
      cps = ss.map((i) => [SC[i][0] + nx * (RM[i] + 1.2), SC[i][1] + ny * (RM[i] + 1.2)]),
      Cx = cps.reduce((s, c) => s + c[0], 0) / cps.length,
      Cy = cps.reduce((s, c) => s + c[1], 0) / cps.length,
      /* 弓が弦から離れると、弦から 12 mm 浮かせる */
      lift = liftOf(v),
      B = (tt: number, o: number, dz = 0): V3 => [
        Cx + ux * tt + nx * (o + 12 * lift),
        Cy + uy * tt + ny * (o + 12 * lift),
        zb + dz,
      ];
    let vib = '',
      fing = '';
    for (let q = 0; q < 4; q++) {
      const len = lenMm(q, v.n[q]),
        stopped = v.n[q] - OPEN[q] > 0.05,
        aMm = ((v.a[q] * 1000 * this.exag) / 2) * (v.c[q] > 0 || v.a[q] > 1e-6 ? 1 : 0),
        f0 = (440 * 2 ** ((OPEN[q] - 69) / 12) * L0 * 1000) / len,
        sd = aMm < 0.05 ? line3([sAt(q, ZN), sAt(q, 0)]) : len < ZN - 0.5 ? line3([sAt(q, ZN), sAt(q, len)]) : '';
      setD(P[`h${q}`], sd);
      setD(P[`s${q}`], sd);
      if (stopped && (v.c[q] > 0.3 || v.a[q] > 2e-6)) {
        const fq = pr(sAt(q, len));
        fing += circ(fq[0], fq[1] - 1, 5.5);
      }
      if (aMm < 0.05) continue;
      const sh = this.shape(aMm, f0, t),
        pt = (s: number, side: number) => {
          const z = len * (1 - s),
            base = sAt(q, z),
            a = sh.band(s) * side;
          const r = pr([base[0] + ux * a, base[1] + uy * a, z]);
          return p(r[0], r[1]);
        },
        ssA: number[] = [];
      for (let j = 0; j <= 30; j++) ssA.push(j / 30);
      if (sh.corner !== null) {
        const u = Math.abs(sh.corner);
        vib += `M${pt(0, 0)}L${pt(u, Math.sign(sh.corner))}L${pt(1, 0)}`;
      } else
        vib += `M${ssA.map((s) => pt(s, 1)).join('L')}L${ssA
          .slice()
          .reverse()
          .map((s) => pt(s, -1))
          .join('L')}Z`;
    }
    setD(P.vib, vib);
    setD(P.fing, fing);
    /* 弓: 元（毛箱）は演奏者から見て右。弦に触れる点が、毛の元から pos の位置 */
    const tf = v.pos * 1000;
    this.drawBow(this.bowP, (s, o, dz) => pr(B(tf - s, o, dz)), false);
    P.bow.style.opacity = String(bowOpacity(v, lift));
    /* 下げ弓は、弓が元の側（演奏者から見て右）へ動く */
    const down = (v.vb === 0 ? v.dir : v.vb) > 0,
      sg = down ? 1 : -1,
      a0 = pr(B(200 - 50 * sg, 26)),
      a1 = pr(B(200 + 50 * sg, 26)),
      dx = a1[0] - a0[0],
      dy = a1[1] - a0[1],
      dl = Math.hypot(dx, dy) || 1,
      ex = dx / dl,
      ey = dy / dl;
    setD(
      P.arrow,
      `M${p(a0[0], a0[1])}L${p(a1[0], a1[1])}M${p(a1[0] - ex * 9 + ey * 6, a1[1] - ey * 9 - ex * 6)}L${p(a1[0], a1[1])}L${p(a1[0] - ex * 9 - ey * 6, a1[1] - ey * 9 + ex * 6)}`,
    );
    const vq = pr(B(200, 44));
    P.lv.setAttribute('x', f1(vq[0]));
    P.lv.setAttribute('y', f1(vq[1]));
    P.lv.textContent = `${down ? '下げ弓' : '上げ弓'} ${Math.abs(v.vb).toFixed(2)} m/s`;
  }

  private drawBridge(v: View): void {
    const B = this.br,
      on = [0, 1, 2, 3].filter((q) => v.c[q] > 0.3),
      lead = this.lead(v),
      cur = this.contact(this.ang, on.length ? on : v.rest.length ? v.rest : [lead]),
      /* 弓が弦から離れると、弦から 16 px 浮かせる */
      lift = liftOf(v),
      up = 16 * lift,
      ax = (tt: number, o: number) => [
        cur.x + cur.ux * tt + cur.nx * (o + up),
        cur.y + cur.uy * tt + cur.ny * (o + up),
      ],
      head = (tip: number[], dx: number, dy: number) =>
        `M${p(tip[0] - dx * 13 + dy * 9, tip[1] - dy * 13 - dx * 9)}L${p(tip[0], tip[1])}L${p(tip[0] - dx * 13 - dy * 9, tip[1] - dy * 13 + dx * 9)}`;
    setD(B.ring, on.map((i) => circ(BC[i][0], BC[i][1], BR[i] + 5)).join(''));
    const line = this.seg(cur, 0, 440, up);
    setD(B.hairO, line);
    setD(B.hairL, line);
    setD(B.stick, this.seg(cur, 8, 432, 20 + up));
    const op = bowOpacity(v, lift);
    for (const k of ['hairO', 'hairL', 'stick', 'vArrow']) B[k].style.opacity = String(op);
    /* 弓圧の矢印は、弓が弦に触れている間だけ */
    B.fArrow.style.opacity = String(op * (1 - lift));
    const fT = ax(0, 22),
      fS = ax(0, 56);
    setD(B.fArrow, `M${p(fS[0], fS[1])}L${p(fT[0], fT[1])}${head(fT, -cur.nx, -cur.ny)}`);
    const down = (v.vb === 0 ? v.dir : v.vb) > 0,
      sg = down ? 1 : -1,
      v0 = ax(-70 * sg, 76),
      v1 = ax(70 * sg, 76);
    setD(B.vArrow, `M${p(v0[0], v0[1])}L${p(v1[0], v1[1])}${head(v1, cur.ux * sg, cur.uy * sg)}`);
    const names = ['E', 'A', 'D', 'G'],
      ss = on.length ? on : v.rest.length ? [...v.rest].sort((a, b) => a - b) : [lead];
    B.name.textContent =
      ss.length > 1
        ? `${ss
            .map((q) => names[q])
            .reverse()
            .join('・')} の重音`
        : `${names[ss[0]]} 線`;
    const deg = Math.round((this.ang * 180) / Math.PI);
    B.angle.textContent = `傾き ${deg > 0 ? '+' : deg < 0 ? '−' : ''}${Math.abs(deg)}°`;
  }

  /** 弓が触れている弦のうち、いちばん高い弦（なければ弓を置いておく弦のいちばん高い弦） */
  private lead(v: View): number {
    for (let q = 0; q < 4; q++) if (v.c[q] > 0.3) return q;
    return v.rest.length ? Math.min(...v.rest) : 1;
  }
}

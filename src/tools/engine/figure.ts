/**
 * エンジンの図: 縦に描いた単気筒の断面と、吸気・排気の管（模型には依存しない）。
 * 断面は空冷 SOHC 2 弁の形（ヘッドとシリンダのフィン、カムとロッカーアーム、弁とばね、点火プラグ、ポート、
 * リングの溝のあるピストン、I 断面の連接棒、円盤のクランク、クランクケース）。内径 50.0・行程 63.1・連接棒 100 mm を
 * 1 mm ≒ 1.01 px で描く。形は見た目の目安で、実物の図面ではない。
 * 管は区間の長さを道のり、内径を太さにして並べ、中の圧力の大気との差を色で塗る。作るときに形を描き、update で動かす。
 * 並べ方は 2 通り: 広い画面は管を右へまっすぐ伸ばし、弁のリフトの図を断面の右に置く（横長）。狭い画面は管を
 * 右へ出してから下へ折り、弁のリフトの図を下に置く（縦長）
 */
import type { SegSpec } from './duct';

const NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number>;
function mk<T extends SVGElement = SVGElement>(tag: string, a: Attrs, parent?: Element, text?: string): T {
  const e = document.createElementNS(NS, tag) as T;
  for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
}
const f1 = (v: number) => v.toFixed(1);

/** 区間ごとの圧力の点の数 − 1 */
export const PIPE_N = 24;

export interface FigState {
  /** サイクルの角度 [°]（0 が吸気の上死点、360 が燃焼の上死点） */
  phi: number;
  /** 弁のリフト [mm] と、リフトが最大になる角度 [°] */
  liftIn: number;
  liftEx: number;
  peakIn: number;
  peakEx: number;
  /** 筒内の圧力 [Pa] */
  pCyl: number;
  /** スロットルの開き（0〜1） */
  throttle: number;
  /** 火花（燃えている間の光）を出すか */
  spark: boolean;
  /** 排気管の区間ごとの圧力の大気との差 [kPa]（区間ごとに PIPE_N + 1 点） */
  pipe: readonly (readonly number[])[];
}

/* ---------- 断面の寸法 [px] ---------- */
const SC = 64 / 63.1,
  CX = 175,
  B = 50 * SC,
  A = 31.55 * SC,
  L = 100 * SC,
  /** 上死点のピストンの頂面・ピンまで・ピストンの高さ */
  Y0 = 100,
  PIN = 14,
  PH = 30,
  CRANK_Y = Y0 + PIN + L + A,
  /** 弁の傾き（鉛直から）・弁座・軸の長さ */
  VANG = (14 * Math.PI) / 180,
  SEAT_X = 11,
  SEAT_Y = 96,
  STEM = 50,
  /** カム軸の中心と基礎円の半径・山の高さ */
  CAM_X = CX,
  CAM_Y = 50,
  CAM_R = 8,
  CAM_H = 5,
  /** 吸気の出口（左）と排気の出口（右）の x、排気管の中心の y */
  EXL = CX - B / 2 - 34,
  EXR = CX + B / 2 + 34,
  YC = 97;

/** 並べ方: 図の大きさ、弁のリフトの図の x の範囲と軸の y、角度の文字の位置、管の太さの倍率 [px/m] */
interface Layout {
  narrow: boolean;
  W: number;
  H: number;
  tx0: number;
  tx1: number;
  ty: number;
  ax: number;
  ay: number;
  ky: number;
}
const WIDE: Layout = { narrow: false, W: 960, H: 320, tx0: 300, tx1: 940, ty: 262, ax: CX + 74, ay: 306, ky: 720 };
/** 狭い画面: 管は x = XN で下へ折れ、y = YN の出口まで */
const XN = 322,
  YN = 372;
const NARROW: Layout = { narrow: true, W: 452, H: 500, tx0: 24, tx1: 436, ty: 478, ax: 16, ay: 338, ky: 560 };
const rectD = (x: number, y: number, w: number, h: number) => `M${f1(x)} ${f1(y)}h${f1(w)}v${f1(h)}h${f1(-w)}Z`;

/** 弁 1 本（左が吸気、右が排気）: 軸の向き（上へ外へ）と弁座 */
interface Valve {
  side: -1 | 1;
  ux: number;
  uy: number;
  sx: number;
  sy: number;
  g: SVGGElement;
  spring: SVGPathElement;
  rocker: SVGPathElement;
  lobe: SVGPathElement;
  /** カムの山がフォロワーを向く角度 [rad] */
  aim: number;
  /** ロッカーの支点・フォロワー（カム側の端）の静止位置 */
  px: number;
  py: number;
  fx: number;
  fy: number;
}

type Timing = { in: [number, number]; ex: [number, number]; lift: (deg: number, ex: boolean) => number };

export class EngineFigure {
  private readonly svg: SVGSVGElement;
  private readonly timing: Timing;
  private segs: readonly SegSpec[];
  private lay: Layout;
  private gas!: SVGPathElement;
  private piston!: SVGGElement;
  private rod!: SVGPathElement;
  private bigEnd!: SVGCircleElement;
  private smallEnd!: SVGCircleElement;
  private web!: SVGGElement;
  private spark!: SVGGElement;
  private thrT!: SVGTextElement;
  private butterfly!: SVGPathElement;
  private cursor!: SVGPathElement;
  private angle!: SVGTextElement;
  private valves: Valve[] = [];
  private pipeG!: SVGGElement;
  private cells: SVGPathElement[][] = [];
  private range = 50;

  constructor(svg: SVGSVGElement, segs: readonly SegSpec[], timing: Timing, narrow = false) {
    this.svg = svg;
    this.segs = segs;
    this.timing = timing;
    this.lay = narrow ? NARROW : WIDE;
    this.build();
  }

  /** 並べ方を替える（狭い画面なら縦長）。替わったときだけ描き直す */
  setLayout(narrow: boolean): void {
    if (narrow === this.lay.narrow) return;
    this.lay = narrow ? NARROW : WIDE;
    this.build();
  }

  private build(): void {
    const svg = this.svg,
      lay = this.lay,
      timing = this.timing;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${lay.W} ${lay.H}`);
    svg.classList.toggle('nar', lay.narrow);
    const back = mk<SVGGElement>('g', {}, svg);

    /* クランクケース（ピストンの下からクランクを囲む） */
    mk(
      'path',
      {
        class: 'e-case',
        d: `M${f1(CX - B / 2 - 6)} 206C${CX - 40} 214 ${CX - 66} 222 ${CX - 66} ${f1(CRANK_Y)}A66 66 0 0 0 ${CX + 66} ${f1(CRANK_Y)}C${CX + 66} 222 ${CX + 40} 214 ${f1(CX + B / 2 + 6)} 206Z`,
      },
      back,
    );
    /* シリンダのフィン（下ほど短い）と胴 */
    for (let y = 106, i = 0; y <= 200; y += 8, i++) {
      const w = B / 2 + 30 - i * 0.8;
      mk(
        'path',
        { class: 'e-fin', d: `M${f1(CX - w)} ${y}H${f1(CX - B / 2 - 4)}M${f1(CX + B / 2 + 4)} ${y}H${f1(CX + w)}` },
        back,
      );
    }
    mk('rect', { class: 'e-metal', x: f1(CX - B / 2 - 5), y: 100, width: f1(B + 10), height: 106 }, back);
    mk('rect', { class: 'e-bore', x: f1(CX - B / 2), y: 98, width: f1(B), height: 108 }, back);
    /* ヘッド（フィン付き）とカムのカバー */
    for (let y = 44; y <= 92; y += 8) {
      mk(
        'path',
        { class: 'e-fin', d: `M${f1(EXL + 2)} ${y}H${f1(CX - B / 2 - 4)}M${f1(CX + B / 2 + 4)} ${y}H${f1(EXR - 2)}` },
        back,
      );
    }
    mk(
      'path',
      {
        class: 'e-metal',
        d: `M${f1(CX - B / 2 - 6)} 100V36H${CX - 30}C${CX - 30} 14 ${CX - 16} 10 ${CX} 10S${CX + 30} 14 ${CX + 30} 36H${f1(CX + B / 2 + 6)}V100Z`,
      },
      back,
    );
    /* カムとロッカーアームの入る部屋 */
    mk(
      'path',
      { class: 'e-cav', d: `M${CX - 26} 58V34C${CX - 26} 20 ${CX - 14} 16 ${CX} 16S${CX + 26} 20 ${CX + 26} 34V58Z` },
      back,
    );
    /* 燃焼室（屋根の形）と、そこから下のガス */
    this.gas = mk<SVGPathElement>('path', { class: 'e-gas' }, back);
    mk('path', { class: 'e-wall', d: `M${f1(CX - B / 2)} 100Q${CX} 80 ${f1(CX + B / 2)} 100` }, back);
    /* 吸気ポート（左上へ）と排気ポート（右へ）。中を表示窓の地で塗ってフィンを隠す */
    mk(
      'path',
      {
        class: 'e-port',
        d: `M${f1(EXL)} 52C${CX - 40} 52 ${CX - 24} 68 ${CX - 19} 94L${CX - 4} 97C${CX - 10} 78 ${CX - 30} 66 ${f1(EXL)} 66Z`,
      },
      back,
    );
    mk(
      'path',
      {
        class: 'e-port',
        d: `M${CX + 4} 97C${CX + 12} 103 ${CX + 30} 104 ${f1(EXR)} 104L${f1(EXR)} 90C${CX + 34} 90 ${CX + 24} 92 ${CX + 19} 94Z`,
      },
      back,
    );

    /* 弁・ばね・ロッカーアーム・カム */
    this.valves = ([-1, 1] as const).map((side) => {
      const ux = side * Math.sin(VANG),
        uy = -Math.cos(VANG),
        sx = CX + side * SEAT_X,
        sy = SEAT_Y,
        w = side < 0 ? 8 : 6.5,
        g = mk<SVGGElement>('g', {}, svg);
      /* 軸・傘・コッター */
      mk('path', { class: 'e-valve', d: `M${f1(sx)} ${f1(sy)}L${f1(sx + ux * STEM)} ${f1(sy + uy * STEM)}` }, g);
      mk(
        'path',
        { class: 'e-valve', d: `M${f1(sx + uy * w)} ${f1(sy - ux * w)}L${f1(sx - uy * w)} ${f1(sy + ux * w)}` },
        g,
      );
      mk(
        'path',
        {
          class: 'e-valve',
          d: `M${f1(sx + ux * (STEM - 6) + uy * 5)} ${f1(sy + uy * (STEM - 6) - ux * 5)}L${f1(sx + ux * (STEM - 6) - uy * 5)} ${f1(sy + uy * (STEM - 6) + ux * 5)}`,
        },
        g,
      );
      const spring = mk<SVGPathElement>('path', { class: 'e-spring' }, svg),
        px = CX + side * 15,
        py = 30,
        fx = CX + side * 6,
        fy = CAM_Y - CAM_R - 2,
        rocker = mk<SVGPathElement>('path', { class: 'e-rock' }, svg);
      mk('circle', { class: 'e-pivot', cx: px, cy: py, r: 3 }, svg);
      const lobe = mk<SVGPathElement>('path', { class: side < 0 ? 'e-cam ci' : 'e-cam ce' }, svg);
      return { side, ux, uy, sx, sy, g, spring, rocker, lobe, aim: Math.atan2(fy - CAM_Y, fx - CAM_X), px, py, fx, fy };
    });
    mk('circle', { class: 'e-pivot', cx: CAM_X, cy: CAM_Y, r: 2.5 }, svg);

    /* 点火プラグ（右上から燃焼室へ）と火花 */
    mk('path', { class: 'e-plug', d: `M${CX + 9} 90L${CX + 30} 66`, 'stroke-width': 5 }, svg);
    mk('path', { class: 'e-plug', d: `M${CX + 26} 70L${CX + 40} 54`, 'stroke-width': 9 }, svg);
    mk('path', { class: 'e-plug', d: `M${CX + 40} 54L${CX + 54} 38`, 'stroke-width': 6 }, svg);
    /* 火花: プラグの先を中心に、燃焼室に広がる光（2 重の円）と、2 倍の大きさの火花の形 */
    this.spark = mk<SVGGElement>('g', { visibility: 'hidden' }, svg);
    mk('circle', { class: 'e-glow', cx: CX + 8, cy: 91, r: 26, opacity: 0.18 }, this.spark);
    mk('circle', { class: 'e-glow', cx: CX + 8, cy: 91, r: 15, opacity: 0.35 }, this.spark);
    mk(
      'path',
      {
        class: 'e-spark',
        d: `M${CX + 6} 84l3 5l5 -1l-3 4l3 5l-6 -2l-4 4l0 -6l-5 -2l5 -2z`,
        transform: `translate(${CX + 8} 91) scale(2) translate(${-(CX + 8)} -91)`,
      },
      this.spark,
    );

    /* ピストン（リングの溝・ピン）・連接棒（I 断面）・クランク（円盤・ピン・釣り合いの穴） */
    this.piston = mk<SVGGElement>('g', {}, svg);
    mk('rect', { class: 'e-pis', x: f1(CX - B / 2 + 1.5), y: 0, width: f1(B - 3), height: PH, rx: 2 }, this.piston);
    for (const y of [4, 8, 13])
      mk(
        'path',
        { class: 'e-ring', d: `M${f1(CX - B / 2 + 1.5)} ${y}h5M${f1(CX + B / 2 - 1.5)} ${y}h-5` },
        this.piston,
      );
    this.web = mk<SVGGElement>('g', {}, svg);
    mk('circle', { class: 'e-web', cx: 0, cy: 0, r: 42 }, this.web);
    mk('path', { class: 'e-cw', d: 'M-30 18A35 35 0 0 0 30 18L20 10A23 23 0 0 1 -20 10Z' }, this.web);
    mk('circle', { class: 'e-pivot', cx: 0, cy: 0, r: 6 }, this.web);
    this.rod = mk<SVGPathElement>('path', { class: 'e-rod' }, svg);
    this.bigEnd = mk<SVGCircleElement>('circle', { class: 'e-pis', r: 10 }, svg);
    this.smallEnd = mk<SVGCircleElement>('circle', { class: 'e-pis', r: 5.5 }, svg);
    this.angle = mk<SVGTextElement>('text', { x: lay.ax, y: lay.ay }, svg);

    /* 吸気: エアクリーナー側からスロットル、インシュレータ */
    mk('path', { class: 'e-pipe', d: `M24 52H${f1(EXL)}M24 66H${f1(EXL)}` }, svg);
    this.butterfly = mk<SVGPathElement>('path', { class: 'e-valve' }, svg);
    mk('text', { x: 24, y: 42 }, svg, '吸気 →');
    this.thrT = mk<SVGTextElement>('text', { class: 'lb2', x: 40, y: 84 }, svg, 'スロットル 0 %');

    /* 排気管 */
    this.pipeG = mk<SVGGElement>('g', {}, svg);
    this.setPipe(this.segs);

    /* 弁のリフトの時間図と角度 */
    const { tx0, tx1, ty } = lay,
      tg = mk<SVGGElement>('g', {}, svg),
      X = (d: number) => tx0 + ((((d % 720) + 720) % 720) / 720) * (tx1 - tx0);
    mk('path', { class: 'gl', d: `M${tx0} ${ty}H${tx1}` }, tg);
    for (const [d, lb] of [
      [0, '吸気 上死点'],
      [180, '下死点'],
      [360, '燃焼 上死点'],
      [540, '下死点'],
    ] as const) {
      mk('path', { class: 'gl', d: `M${f1(X(d))} ${ty - 40}V${ty + 4}` }, tg);
      mk('text', { class: 'lb2', x: f1(X(d) + 3), y: ty + 16 }, tg, lb);
    }
    const lmax = Math.max(
      timing.lift(timing.in[0] + timing.in[1] / 2, false),
      timing.lift(timing.ex[0] + timing.ex[1] / 2, true),
    );
    for (const [cls, [open, dur], ex] of [
      ['t2', timing.in, false],
      ['t1', timing.ex, true],
    ] as const) {
      let d = '',
        prev = Number.NaN;
      for (let k = 0; k <= 80; k++) {
        const deg = open + (dur * k) / 80,
          x = X(deg),
          y = ty - (34 * timing.lift(deg, ex)) / lmax;
        d += `${Number.isNaN(prev) || x < prev ? 'M' : 'L'}${f1(x)} ${f1(y)}`;
        prev = x;
      }
      mk('path', { class: cls, d }, tg);
    }
    mk('text', { class: 'lb2', x: tx0, y: ty - 48 }, tg, '弁のリフトと角度');
    mk('path', { class: 't2', d: `M${tx1 - 150} ${ty - 52}h18` }, tg);
    mk('text', { class: 'lb2', x: tx1 - 128, y: ty - 48 }, tg, '吸気');
    mk('path', { class: 't1', d: `M${tx1 - 80} ${ty - 52}h18` }, tg);
    mk('text', { class: 'lb2', x: tx1 - 58, y: ty - 48 }, tg, '排気');
    this.cursor = mk<SVGPathElement>('path', { class: 'opl' }, tg);
  }

  /** 排気管の区間を描き直す（マフラーを替えたとき） */
  setPipe(segs: readonly SegSpec[]): void {
    this.segs = segs;
    const g = this.pipeG,
      { narrow, ky } = this.lay;
    g.replaceChildren();
    this.cells = [];
    const total = segs.reduce((s, x) => s + x.len, 0),
      hs = segs.map((sg) => Math.max(8, sg.d * ky)),
      /* 道のり s [px] → 形。広い画面はまっすぐ右へ。狭い画面は右へ s1 だけ進んでから下へ（折れ目は最初の区間の太さで角にする） */
      s1 = narrow ? XN + hs[0] / 2 - EXR : Number.POSITIVE_INFINITY,
      len = narrow ? s1 + (YN - YC - hs[0] / 2) : 940 - EXR,
      kx = len / total,
      /* 道のり a〜b の太さ h の管の形（折れ目をまたぐときは 2 つの長方形） */
      part = (a: number, b: number, h: number) => {
        let d = '';
        if (a < s1) d += rectD(EXR + a, YC - h / 2, Math.min(b, s1) - a, h);
        if (b > s1) {
          const y0 = YC + hs[0] / 2 + Math.max(0, a - s1);
          d += rectD(XN - h / 2, y0, h, YC + hs[0] / 2 + (b - s1) - y0);
        }
        return d;
      },
      names =
        segs.length === 7
          ? ['エキゾーストパイプ', '触媒', '', 'マフラー 1 室', '', '2 室', 'テールパイプ']
          : ['エキゾーストパイプ', 'サイレンサー', '出口'];
    let s = 0;
    segs.forEach((sg, i) => {
      const w = sg.len * kx,
        h = hs[i],
        row: SVGPathElement[] = [];
      for (let k = 0; k < PIPE_N; k++)
        row.push(
          mk<SVGPathElement>(
            'path',
            { class: 'e-hi', d: part(s + (k * w) / PIPE_N, s + ((k + 1) * w) / PIPE_N + 0.6, h), opacity: 0 },
            g,
          ),
        );
      this.cells.push(row);
      const b = s + w;
      if (s < s1 && b > s1) {
        /* 折れ目をまたぐ区間の外形は L の字 */
        const yb = YC + hs[0] / 2 + (b - s1);
        mk(
          'path',
          {
            class: 'e-pipe',
            d: `M${f1(EXR + s)} ${f1(YC - h / 2)}H${f1(XN + h / 2)}V${f1(yb)}H${f1(XN - h / 2)}V${f1(YC + h / 2)}H${f1(EXR + s)}Z`,
          },
          g,
        );
      } else mk('path', { class: 'e-pipe', d: part(s, b, h) }, g);
      if (narrow) {
        /* 名前は縦の部分の真ん中の右 */
        const ya = YC + hs[0] / 2 + Math.max(0, s - s1),
          yb = YC + hs[0] / 2 + (b - s1);
        if (names[i]) mk('text', { class: 'lb2', x: f1(XN + h / 2 + 6), y: f1((ya + yb) / 2 + 4) }, g, names[i]);
      } else {
        if (names[i])
          mk(
            'text',
            { class: 'lb2', x: f1(EXR + s + w / 2), y: f1(YC + h / 2 + 15), 'text-anchor': 'middle' },
            g,
            names[i],
          );
        mk('path', { class: 'e-dim', d: `M${f1(EXR + s)} ${YC + 58}v8` }, g);
      }
      s = b;
    });
    const road = `音の通り道 ${total.toFixed(2)} m（排気弁から出口まで）`;
    if (narrow) {
      mk('text', { class: 'lb2', x: this.lay.W - 8, y: YN + 20, 'text-anchor': 'end' }, g, road);
      return;
    }
    const x = EXR + s;
    mk('path', { class: 'e-dim', d: `M${f1(x)} ${YC + 50}v8M${f1(EXR)} ${YC + 54}H${f1(x)}` }, g);
    mk('text', { class: 'lb2', x: f1((EXR + x) / 2), y: YC + 70, 'text-anchor': 'middle' }, g, road);
  }

  /** 圧力の色の範囲 [kPa]（最も濃くなる差） */
  setRange(kPa: number): void {
    this.range = kPa;
  }

  update(st: FigState): void {
    const th = (st.phi * Math.PI) / 180,
      s = A + L - (A * Math.cos(th) + Math.sqrt(L * L - (A * Math.sin(th)) ** 2)),
      crown = Y0 + s,
      pinY = crown + PIN,
      cpx = CX + A * Math.sin(th),
      cpy = CRANK_Y - A * Math.cos(th);
    /* ピストン・連接棒（ピンとクランクピンの間を、ピン側 5 px・クランク側 8 px の幅で結ぶ）・クランク */
    this.piston.setAttribute('transform', `translate(0 ${f1(crown)})`);
    const dx = cpx - CX,
      dy = cpy - pinY,
      len = Math.hypot(dx, dy),
      nx = -dy / len,
      ny = dx / len;
    this.rod.setAttribute(
      'd',
      `M${f1(CX + nx * 4)} ${f1(pinY + ny * 4)}L${f1(cpx + nx * 7)} ${f1(cpy + ny * 7)}L${f1(cpx - nx * 7)} ${f1(cpy - ny * 7)}L${f1(CX - nx * 4)} ${f1(pinY - ny * 4)}Z`,
    );
    this.smallEnd.setAttribute('cx', f1(CX));
    this.smallEnd.setAttribute('cy', f1(pinY));
    this.bigEnd.setAttribute('cx', f1(cpx));
    this.bigEnd.setAttribute('cy', f1(cpy));
    this.web.setAttribute('transform', `translate(${CX} ${f1(CRANK_Y)}) rotate(${f1(st.phi)})`);
    /* 燃焼室から頂面までのガス（圧力 0〜60 bar を濃さ 0.08〜0.7 に） */
    this.gas.setAttribute('d', `M${f1(CX - B / 2)} 100Q${CX} 80 ${f1(CX + B / 2)} 100V${f1(crown)}H${f1(CX - B / 2)}Z`);
    this.gas.setAttribute('opacity', f1(0.08 + 0.62 * Math.min(1, Math.max(0, (st.pCyl - 101325) / 6e6)) ** 0.5));
    this.spark.setAttribute('visibility', st.spark ? 'visible' : 'hidden');
    /* 弁: 軸に沿って下へ。ばねは弁座の上のばね受けと、動くリテーナの間で縮む。ロッカーは支点で回る */
    for (const v of this.valves) {
      const lift = (v.side < 0 ? st.liftIn : st.liftEx) * SC,
        ox = -v.ux * lift,
        oy = -v.uy * lift;
      v.g.setAttribute('transform', `translate(${f1(ox)} ${f1(oy)})`);
      const b0x = v.sx + v.ux * 26,
        b0y = v.sy + v.uy * 26,
        t0x = v.sx + v.ux * (STEM - 6) + ox,
        t0y = v.sy + v.uy * (STEM - 6) + oy;
      let d = `M${f1(b0x)} ${f1(b0y)}`;
      for (let k = 1; k <= 8; k++) {
        const r = k / 8,
          x = b0x + (t0x - b0x) * r,
          y = b0y + (t0y - b0y) * r,
          w = k === 8 ? 0 : k % 2 ? 6 : -6;
        d += `L${f1(x - v.uy * w)} ${f1(y + v.ux * w)}`;
      }
      v.spring.setAttribute('d', d);
      const tipX = v.sx + v.ux * STEM + ox,
        tipY = v.sy + v.uy * STEM + oy;
      v.rocker.setAttribute('d', `M${f1(v.fx)} ${f1(v.fy - lift * 0.6)}L${v.px} ${v.py}L${f1(tipX)} ${f1(tipY - 2)}`);
      /* カムの山（カム軸はクランクの半分の速さ。リフトが最大の角度で山がフォロワーを向く） */
      const peak = v.side < 0 ? st.peakIn : st.peakEx,
        nose = v.aim + (((st.phi - peak) / 2) * Math.PI) / 180;
      let lp = '';
      for (let k = 0; k <= 36; k++) {
        const a = (k / 36) * 2 * Math.PI,
          dd = Math.atan2(Math.sin(a - nose), Math.cos(a - nose)),
          r = CAM_R + (Math.abs(dd) < 1.2 ? CAM_H * Math.cos((dd / 1.2) * (Math.PI / 2)) ** 2 : 0);
        lp += `${k ? 'L' : 'M'}${f1(CAM_X + r * Math.cos(a))} ${f1(CAM_Y + r * Math.sin(a))}`;
      }
      v.lobe.setAttribute('d', `${lp}Z`);
    }
    /* スロットルの蝶弁（閉 5°、全開で管と平行） */
    const ta = ((5 + st.throttle * 85) * Math.PI) / 180,
      bx = 7 * Math.cos(ta),
      by = 7 * Math.sin(ta);
    this.butterfly.setAttribute('d', `M${f1(56 - by)} ${f1(59 - bx)}L${f1(56 + by)} ${f1(59 + bx)}`);
    this.thrT.textContent = `スロットル ${Math.round(st.throttle * 100)} %`;
    /* 排気管の色 */
    const R = this.range;
    st.pipe.forEach((row, i) => {
      const cells = this.cells[i];
      if (!cells) return;
      for (let k = 0; k < PIPE_N; k++) {
        const p = (row[k] + row[k + 1]) / 2,
          c = cells[k];
        c.setAttribute('class', p >= 0 ? 'e-hi' : 'e-lo');
        c.setAttribute('opacity', (0.06 + 0.86 * Math.min(1, Math.abs(p) / R)).toFixed(2));
      }
    });
    const { tx0, tx1, ty } = this.lay,
      X = tx0 + ((((st.phi % 720) + 720) % 720) / 720) * (tx1 - tx0);
    this.cursor.setAttribute('d', `M${f1(X)} ${ty - 48}V${ty + 4}`);
    /* 角度は弁のリフトの図・p–θ と同じく、吸気の上死点を 0° とする */
    this.angle.textContent = `クランク角 ${Math.round(((st.phi % 720) + 720) % 720)}°`;
    void this.svg;
  }
}

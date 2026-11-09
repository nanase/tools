/**
 * サイフォンの断面図とグラフ。寸法は m（scenes.ts）で、図の範囲 view に収まるように縦横同じ倍率で描く。
 * 容器と管の形は模型と同じ。器の厚み・台・床・地層などの周りの物は、実物の寸法に合わせて描き足す
 */
import type { Pt, Siphon } from './model';
import { AQ, CUP, HGT, KER, KUS, PER, type Scene, TOI } from './scenes';
import type { Vals } from './sim';

export const COL = {
  screen: '',
  grid: '',
  grid2: '',
  sink: '',
  ink: '',
  ink2: '',
  ch1: '',
  ch2: '',
  warn: '',
  water: '',
  wall: '',
  body: '',
  wood: '',
  rock: '',
  rock2: '',
  air: '',
  low: '',
  mono: '',
  sans: '',
};
export function readCols(root: Element): void {
  const c = getComputedStyle(root),
    v = (k: string) => c.getPropertyValue(k).trim();
  COL.screen = v('--screen');
  COL.grid = v('--grid');
  COL.grid2 = v('--grid-2');
  COL.sink = v('--screen-ink');
  COL.ink = v('--ink');
  COL.ink2 = v('--ink-2');
  COL.ch1 = v('--ch1');
  COL.ch2 = v('--ch2');
  COL.warn = v('--warn');
  COL.water = v('--sf-water');
  COL.wall = v('--sf-wall');
  COL.body = v('--sf-body');
  COL.wood = v('--sf-wood');
  COL.rock = v('--sf-rock');
  COL.rock2 = v('--sf-rock2');
  COL.air = v('--sf-air');
  COL.low = v('--sf-low');
  COL.mono = v('--mono');
  COL.sans = v('--sans');
}

type G = CanvasRenderingContext2D;
export interface View {
  k: number;
  X: (x: number) => number;
  Z: (z: number) => number;
}
const TAU = Math.PI * 2;

export function fitView(view: readonly number[], W: number, H: number, pad = 10): View {
  const [x0, x1, z0, z1] = view,
    k = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (z1 - z0));
  const ox = (W - (x1 - x0) * k) / 2 - x0 * k,
    oz = (H + (z1 - z0) * k) / 2 + z0 * k;
  return { k, X: (x) => ox + x * k, Z: (z) => oz - z * k };
}

/* ---------- 描く道具 ---------- */
function poly(g: G, V: View, pts: readonly Pt[], close = true): void {
  g.beginPath();
  for (const [i, [x, z]] of pts.entries()) {
    if (i) g.lineTo(V.X(x), V.Z(z));
    else g.moveTo(V.X(x), V.Z(z));
  }
  if (close) g.closePath();
}
function rr(g: G, V: View, x0: number, z0: number, x1: number, z1: number, r: number): void {
  g.beginPath();
  g.roundRect(V.X(x0), V.Z(z1), V.X(x1) - V.X(x0), V.Z(z0) - V.Z(z1), Math.max(0, r * V.k));
}
function paint(g: G, fill: string | null, stroke: string | null, lw = 1.2): void {
  if (fill) {
    g.fillStyle = fill;
    g.fill('evenodd');
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.stroke();
  }
}
function line(g: G, V: View, pts: readonly Pt[], col: string, lw: number, dash: number[] = []): void {
  poly(g, V, pts, false);
  g.setLineDash(dash);
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.stroke();
  g.setLineDash([]);
}
/** 床・机の面: 線と下の斜線 */
function floor(g: G, V: View, x0: number, x1: number, z: number): void {
  line(
    g,
    V,
    [
      [x0, z],
      [x1, z],
    ],
    COL.wall,
    1.4,
  );
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1;
  g.beginPath();
  const y = V.Z(z);
  for (let x = V.X(x0); x < V.X(x1); x += 9) {
    g.moveTo(x, y + 1);
    g.lineTo(x - 6, y + 7);
  }
  g.stroke();
}
export function label(
  g: G,
  txt: string,
  x: number,
  y: number,
  o: { size?: number; w?: number; color?: string; align?: CanvasTextAlign; mono?: boolean; halo?: boolean } = {},
): void {
  g.font = `${o.w ?? 500} ${o.size ?? 13}px ${o.mono ? COL.mono : COL.sans}`;
  g.textAlign = o.align ?? 'left';
  g.textBaseline = 'middle';
  if (o.halo !== false) {
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.strokeStyle = COL.screen;
    g.strokeText(txt, x, y);
  }
  g.fillStyle = o.color ?? COL.ink;
  g.fillText(txt, x, y);
}
/** 多角形を z ≤ h で切る */
function clipBelow(pts: readonly Pt[], h: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length],
      ia = a[1] <= h,
      ib = b[1] <= h;
    if (ia) out.push(a);
    if (ia !== ib) out.push([a[0] + ((h - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), h]);
  }
  return out;
}
/** 決まった並びの乱数（岩の凹凸・砂利） */
function rnd(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** 辺を細かく分けて凹凸を付けた多角形（洞窟の壁） */
function rough(pts: readonly Pt[], amp: number, seed: number, n = 6): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    for (let j = 0; j < n; j++) {
      const u = j / n,
        e = j === 0 ? 0 : (rnd(seed + i * 17 + j) - 0.5) * 2 * amp;
      const nx = -(b[1] - a[1]),
        nz = b[0] - a[0],
        L = Math.hypot(nx, nz) || 1;
      out.push([a[0] + (b[0] - a[0]) * u + (nx / L) * e, a[1] + (b[1] - a[1]) * u + (nz / L) * e]);
    }
  }
  return out;
}

/* ---------- 管 ---------- */
function tubeAt(S: Siphon, s: number): Pt {
  const p = S.pts;
  for (let i = 1; i < p.length; i++)
    if (s <= S.s[i] || i === p.length - 1) {
      const u = Math.min(1, Math.max(0, (s - S.s[i - 1]) / (S.s[i] - S.s[i - 1] || 1)));
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * u, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * u];
    }
  return p[p.length - 1];
}
function tubeSeg(g: G, V: View, S: Siphon, s0: number, s1: number): void {
  if (s1 <= s0) return;
  g.beginPath();
  const a = tubeAt(S, s0);
  g.moveTo(V.X(a[0]), V.Z(a[1]));
  for (let i = 1; i < S.pts.length; i++) if (S.s[i] > s0 && S.s[i] < s1) g.lineTo(V.X(S.pts[i][0]), V.Z(S.pts[i][1]));
  const b = tubeAt(S, s1);
  g.lineTo(V.X(b[0]), V.Z(b[1]));
  g.stroke();
}
/** from から to へ歩き、高さ z を超える最初の位置 */
function sAtZ(S: Siphon, z: number, from: number, to: number): number {
  const N = 240;
  for (let i = 0; i <= N; i++) {
    const s = from + ((to - from) * i) / N;
    if (tubeAt(S, s)[1] > z) return s;
  }
  return to;
}
/** 管の中の水: 満ちていれば全部、そうでなければ入口側は水位まで、下りは満ち具合だけとぎれとぎれ */
function tubeWater(g: G, V: View, S: Siphon, inner: number, phase: number): void {
  const sC = S.s[S.ic];
  g.lineWidth = inner;
  g.lineCap = 'butt';
  g.strokeStyle = COL.water;
  if (S.full) tubeSeg(g, V, S, 0, S.L);
  else if (S.vapor) {
    tubeSeg(g, V, S, 0, sAtZ(S, S.h1 + S.lift, 0, sC));
    tubeSeg(g, V, S, sAtZ(S, S.outRef + S.lift, S.L, sC), S.L);
  } else {
    if (S.h1 > S.zIn) tubeSeg(g, V, S, 0, sAtZ(S, S.h1, 0, sC));
    if (S.phi > 0.01) {
      g.setLineDash([Math.max(1, S.phi * 9), Math.max(1.5, (1 - S.phi) * 9)]);
      g.lineDashOffset = -phase * 40;
      tubeSeg(g, V, S, sC, S.L);
      g.setLineDash([]);
    }
    if (S.h1 >= S.zC - 1e-4 && S.q > 0) tubeSeg(g, V, S, 0, sC + (S.L - sC) * 0.12);
  }
  if (S.dst && S.h2 > S.zOut) tubeSeg(g, V, S, sAtZ(S, S.h2, S.L, sC), S.L);
}
/** 流れの点 */
function tubeDots(g: G, V: View, S: Siphon, r: number, sp: number, phase: number, from = 0): void {
  if (S.q <= 1e-9 || S.vapor || !(S.full || S.phi > 0.3)) return;
  g.fillStyle = COL.ch2;
  for (let s = from + (phase % 1) * sp; s < S.L; s += sp) {
    const [x, z] = tubeAt(S, s);
    g.beginPath();
    g.arc(V.X(x), V.Z(z), r, 0, TAU);
    g.fill();
  }
}
/** 管の本体（壁・中・水・点） */
function tube(
  g: G,
  V: View,
  S: Siphon,
  wallCol: string,
  inCol: string,
  phase: number,
  small: boolean,
  minW = 5,
): number {
  const tw = Math.max(small ? 3 : minW, S.c.d * V.k + (small ? 1.5 : 3)),
    inner = Math.max(small ? 1.5 : 3, tw - (small ? 1.5 : 3));
  /* 端は切りっぱなし（開いた口）、曲がりは丸く */
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  g.strokeStyle = wallCol;
  g.lineWidth = tw;
  tubeSeg(g, V, S, 0, S.L);
  g.strokeStyle = inCol;
  g.lineWidth = inner;
  tubeSeg(g, V, S, 0, S.L);
  tubeWater(g, V, S, inner, phase);
  if (!small) tubeDots(g, V, S, Math.max(1.2, inner * 0.28), Math.max(tw * 2.4, 14) / V.k, phase);
  return inner;
}
/** 容器の水（多角形を水位で切る） */
function vesselWater(g: G, V: View, pts: readonly Pt[], h: number, z0: number): void {
  if (h <= z0 + 1e-6) return;
  const wp = clipBelow(pts, h);
  if (wp.length < 3) return;
  poly(g, V, wp);
  g.fillStyle = COL.water;
  g.fill();
  const xs = wp.filter((p) => Math.abs(p[1] - h) < 1e-9).map((p) => p[0]);
  if (xs.length >= 2)
    line(
      g,
      V,
      [
        [Math.min(...xs), h],
        [Math.max(...xs), h],
      ],
      COL.ch2,
      1.5,
    );
}
/** 落ちる水の筋 */
function stream(g: G, V: View, x: number, z0: number, z1: number, w: number, dx = 0): void {
  g.strokeStyle = COL.water;
  g.lineWidth = w;
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(V.X(x), V.Z(z0));
  g.quadraticCurveTo(V.X(x + dx), V.Z(z0), V.X(x + dx * 1.3), V.Z(z1));
  g.stroke();
  g.lineCap = 'round';
}
const streamW = (S: Siphon, max: number) => Math.max(1.5, Math.min(max, max * Math.sqrt(S.q / (S.qmax || S.q || 1))));

/* ---------- 例ごとの絵 ---------- */
interface Ctx {
  sc: Scene;
  g: G;
  V: View;
  S: Siphon;
  v: Vals;
  small: boolean;
  phase: number;
  pour: boolean;
}

/** 灯油ポンプ: 台・ポリタンク・ポンプ・カートリッジタンク */
function kerosene({ g, V, S, v, small, phase }: Ctx): void {
  const Sz = v.kst / 100,
    [c0, c1, ch] = KER.ct,
    [n0, n1, nh] = KER.ctNeck;
  floor(g, V, -0.06, 0.92, 0);
  /* 台 */
  rr(g, V, -0.02, 0, 0.36, Sz, 0.004);
  paint(g, COL.wood, COL.wall, 1.2);
  if (!small)
    line(
      g,
      V,
      [
        [-0.02, Sz - 0.025],
        [0.36, Sz - 0.025],
      ],
      COL.wall,
      1,
    );
  /* ポリタンク: 外形（取っ手・給油口）と中 */
  const T0 = Sz,
    T1 = Sz + KER.h;
  rr(g, V, 0, T0, KER.w, T1, 0.025);
  paint(g, COL.body, COL.wall, 1.4);
  const [k0, k1, kh] = KER.neck;
  rr(g, V, k0, T1 - 0.01, k1, T1 + kh, 0.004);
  paint(g, COL.body, COL.wall, 1.4);
  /* 取っ手（握る穴つき） */
  g.beginPath();
  g.roundRect(V.X(0.15), V.Z(T1 + 0.07), V.X(0.32) - V.X(0.15), (0.075 + 0.002) * V.k, 0.02 * V.k);
  g.roundRect(V.X(0.17), V.Z(T1 + 0.05), V.X(0.3) - V.X(0.17), 0.04 * V.k, 0.012 * V.k);
  paint(g, COL.body, COL.wall, 1.4);
  poly(g, V, S.src.poly);
  paint(g, COL.screen, null);
  rr(g, V, k0 + 0.004, T1 - 0.012, k1 - 0.004, T1 + kh, 0);
  paint(g, COL.screen, null);
  vesselWater(g, V, S.src.poly, S.h1, S.src.z0);
  /* カートリッジタンク（給油口を上に向けて床に置く） */
  rr(g, V, c0, 0, c1, ch, 0.02);
  paint(g, COL.body, COL.wall, 1.4);
  rr(g, V, n0 - 0.004, ch - 0.01, n1 + 0.004, ch + nh, 0.003);
  paint(g, COL.body, COL.wall, 1.4);
  g.beginPath();
  g.roundRect(V.X(0.71), V.Z(ch + 0.05), V.X(0.84) - V.X(0.71), 0.055 * V.k, 0.015 * V.k);
  g.roundRect(V.X(0.73), V.Z(ch + 0.035), V.X(0.82) - V.X(0.73), 0.03 * V.k, 0.008 * V.k);
  paint(g, COL.body, COL.wall, 1.4);
  if (S.dst) {
    poly(g, V, S.dst.poly);
    paint(g, COL.screen, null);
    vesselWater(g, V, S.dst.poly, S.h2, S.dst.z0);
  }
  /* あふれた灯油が床に広がる */
  if (S.over) {
    const w = Math.min(0.2, 0.05 + S.t * 0.0004);
    rr(g, V, n1, 0, n1 + w + 0.15, 0.004, 0.002);
    paint(g, COL.water, null);
    line(
      g,
      V,
      [
        [n1 + 0.002, ch + nh],
        [n1 + 0.03, ch + nh - 0.02],
        [c1 + 0.01, 0.12],
        [c1 + 0.02, 0.004],
      ],
      COL.water,
      2.2,
    );
  }
  /* ポンプ: 吸い上げの管・ふくらみ・空気弁 */
  const inner = tube(g, V, S, COL.wall, COL.screen, phase, small, 6);
  const x = KER.pipeX,
    zb = Sz + 0.44,
    open = S.broken && S.ev[S.ev.length - 1]?.k === 'stop';
  g.beginPath();
  g.ellipse(V.X(x), V.Z(zb), 0.03 * V.k, 0.06 * V.k, 0, 0, TAU);
  paint(g, null, COL.wall, 1.6);
  if (!small) {
    g.strokeStyle = COL.wall;
    g.lineWidth = 1;
    g.beginPath();
    for (const dz of [-0.035, -0.012, 0.012, 0.035]) {
      const hw = 0.03 * Math.sqrt(1 - (dz / 0.06) ** 2);
      g.moveTo(V.X(x - hw), V.Z(zb + dz));
      g.lineTo(V.X(x + hw), V.Z(zb + dz));
    }
    g.stroke();
  }
  const capZ = Sz + 0.512 + (open ? 0.018 : 0);
  rr(g, V, x - 0.012, capZ, x + 0.012, capZ + 0.02, 0.003);
  paint(g, COL.body, COL.wall, 1.4);
  /* ノズル */
  const tip = S.pts[S.pts.length - 1];
  rr(g, V, tip[0] - 0.008, tip[1], tip[0] + 0.008, tip[1] + 0.06, 0.002);
  paint(g, null, COL.wall, 1.2);
  if (S.q > 1e-9 && S.h2 < S.zOut) stream(g, V, tip[0], tip[1], Math.max(S.h2, 0.005), streamW(S, inner));
  if (!small) {
    label(g, 'ポリタンク', V.X(0.22), V.Z(T1 - 0.03), { align: 'center', color: COL.ink2 });
    label(g, 'カートリッジタンク', V.X((c0 + c1) / 2 + 0.03), V.Z(ch * 0.62), {
      align: 'center',
      color: COL.ink2,
      size: 12,
    });
    label(g, open ? '空気弁（開）' : '空気弁', V.X(x + 0.02), V.Z(capZ + 0.012), { color: COL.ink2, size: 12 });
    label(g, '台', V.X(0.17), V.Z(Sz / 2), { align: 'center', color: COL.ink2 });
  }
}

/** 水槽の水換え: 水槽台・ガラス・砂利・水換えホース・バケツ */
function aquarium({ g, V, S, small, phase }: Ctx): void {
  floor(g, V, -0.06, 1.12, 0);
  /* 水槽台（扉 2 枚） */
  rr(g, V, 0, 0, 0.62, AQ.stand, 0.006);
  paint(g, COL.wood, COL.wall, 1.2);
  if (!small) {
    rr(g, V, 0.025, 0.04, 0.3, AQ.stand - 0.03, 0.004);
    paint(g, null, COL.wall, 1);
    rr(g, V, 0.32, 0.04, 0.595, AQ.stand - 0.03, 0.004);
    paint(g, null, COL.wall, 1);
    for (const hx of [0.285, 0.335])
      line(
        g,
        V,
        [
          [hx, 0.33],
          [hx, 0.41],
        ],
        COL.wall,
        2,
      );
  }
  /* 水槽: 下の枠・ガラス・上の枠 */
  const { x0, x1, glass } = AQ;
  rr(g, V, x0, AQ.stand, x1, AQ.stand + 0.015, 0.003);
  paint(g, COL.wall, null);
  vesselWater(g, V, S.src.poly, S.h1, S.src.z0);
  /* 砂利 */
  poly(g, V, [
    [x0 + glass, AQ.floor],
    [x1 - glass, AQ.floor],
    [x1 - glass, AQ.gravel],
    [x0 + glass, AQ.gravel],
  ]);
  paint(g, COL.rock, null);
  if (!small) {
    g.strokeStyle = COL.rock2;
    g.lineWidth = 1;
    for (let i = 0; i < 120; i++) {
      const x = x0 + glass + 0.004 + rnd(i) * (x1 - x0 - 2 * glass - 0.008),
        z = AQ.floor + 0.004 + rnd(i + 500) * (AQ.gravel - AQ.floor - 0.008),
        r = (0.003 + rnd(i + 900) * 0.004) * V.k;
      g.beginPath();
      g.ellipse(V.X(x), V.Z(z), r, r * 0.75, 0, 0, TAU);
      g.stroke();
    }
  }
  g.fillStyle = COL.wall;
  g.fillRect(V.X(x0), V.Z(AQ.rim), glass * V.k, (AQ.rim - AQ.stand) * V.k);
  g.fillRect(V.X(x1 - glass), V.Z(AQ.rim), glass * V.k, (AQ.rim - AQ.stand) * V.k);
  rr(g, V, x0 - 0.004, AQ.rim - 0.015, x1 + 0.004, AQ.rim, 0.003);
  paint(g, COL.wall, null);
  /* バケツ（取っ手つき） */
  const [b0, b1, t0, t1, bh] = AQ.bucket;
  if (S.dst) vesselWater(g, V, S.dst.poly, S.h2, S.dst.z0);
  poly(
    g,
    V,
    [
      [t0, bh],
      [b0, 0.006],
      [b1, 0.006],
      [t1, bh],
    ],
    false,
  );
  paint(g, null, COL.wall, 2.4);
  rr(g, V, t0 - 0.008, bh - 0.012, t0 + 0.004, bh + 0.004, 0.004);
  paint(g, COL.wall, null);
  rr(g, V, t1 - 0.004, bh - 0.012, t1 + 0.008, bh + 0.004, 0.004);
  paint(g, COL.wall, null);
  if (!small) {
    g.beginPath();
    g.ellipse(V.X((t0 + t1) / 2), V.Z(bh - 0.01), ((t1 - t0) / 2) * V.k, 0.13 * V.k, 0, Math.PI, TAU);
    paint(g, null, COL.grid2, 1.4);
  }
  /* 水換えホースの筒（吸い口） */
  const tip = S.pts[0],
    cx = AQ.cx;
  rr(g, V, cx - 0.016, tip[1], cx + 0.016, 1.1, 0.004);
  paint(g, null, COL.wall, 1.4);
  if (!small)
    line(
      g,
      V,
      [
        [cx - 0.016, tip[1] + 0.006],
        [cx + 0.016, tip[1] + 0.006],
      ],
      COL.wall,
      1,
      [2, 2],
    );
  const inner = tube(g, V, S, COL.wall, COL.screen, phase, small, 6);
  const out = S.pts[S.pts.length - 1];
  if (S.q > 1e-9 && S.h2 < S.zOut) stream(g, V, out[0], out[1], Math.max(S.h2, 0.006), streamW(S, inner));
  if (!small) {
    label(g, '水槽', V.X(0.05), V.Z(AQ.rim) - 12, { color: COL.ink2 });
    label(g, 'バケツ', V.X(b0 + 0.02), V.Z(bh * 0.8), { color: COL.ink2, size: 12 });
    label(g, '吸い口', V.X(cx + 0.024), V.Z(tip[1] + 0.02), { color: COL.ink2, size: 12 });
    label(g, '水槽台', V.X(0.31), V.Z(AQ.stand / 2), { align: 'center', color: COL.ink2 });
  }
}

/** 教訓茶碗: 杯の断面（厚み・中央の柱・足の穴）・急須・受け皿 */
function cup({ g, V, S, v, small, phase, pour }: Ctx): void {
  const c = v.cc / 100,
    capTop = c + 0.004,
    zb = 0,
    foot = CUP.foot;
  floor(g, V, -0.16, 0.11, CUP.table);
  /* 受け皿と、たまった水 */
  poly(g, V, [
    [-0.085, CUP.table + 0.012],
    [-0.07, CUP.table + 0.002],
    [0.07, CUP.table + 0.002],
    [0.085, CUP.table + 0.012],
    [0.08, CUP.table + 0.012],
    [0.066, CUP.table + 0.0045],
    [-0.066, CUP.table + 0.0045],
    [-0.08, CUP.table + 0.012],
  ]);
  paint(g, COL.body, COL.wall, 1.2);
  const pool = Math.min(0.0075, (S.out / 0.012) * 1.0);
  if (pool > 0.0002) {
    poly(g, V, [
      [-0.066 - pool * 1.9, CUP.table + 0.0045 + pool],
      [-0.066, CUP.table + 0.0045],
      [0.066, CUP.table + 0.0045],
      [0.066 + pool * 1.9, CUP.table + 0.0045 + pool],
    ]);
    paint(g, COL.water, null);
  }
  /* 杯の外形（陶器） */
  const outer: Pt[] = [
    [-0.049, CUP.rim + 0.002],
    [-0.045, 0.045],
    [-0.039, 0.012],
    [-0.033, -0.004],
    [-0.013, -0.006],
    [-0.011, foot + 0.012],
    [-0.03, foot + 0.003],
    [-0.031, foot],
    [0.031, foot],
    [0.03, foot + 0.003],
    [0.011, foot + 0.012],
    [0.013, -0.006],
    [0.033, -0.004],
    [0.039, 0.012],
    [0.045, 0.045],
    [0.049, CUP.rim + 0.002],
    [0.044, CUP.rim + 0.002],
    /* ここから内側の面を右の縁から左の縁へたどる（口は開けたまま） */
    [0.044, CUP.rim],
    [0.041, 0.05],
    [0.036, 0.02],
    [0.031, 0],
    [-0.031, 0],
    [-0.036, 0.02],
    [-0.041, 0.05],
    [-0.044, CUP.rim],
    [-0.044, CUP.rim + 0.002],
  ];
  poly(g, V, outer);
  paint(g, COL.body, COL.wall, 1.3);
  vesselWater(g, V, S.src.poly, S.h1, S.src.z0);
  /* 中央の柱（かぶせた筒）と、中の管 */
  rr(g, V, -CUP.col, zb, CUP.col, capTop, 0.003);
  paint(g, COL.body, COL.wall, 1.2);
  const a0 = 0.0062,
    t0 = 0.0034,
    bore = 0.0024;
  const annTop = capTop - 0.0016;
  for (const sg of [-1, 1]) {
    poly(g, V, [
      [sg * t0, zb],
      [sg * a0, zb],
      [sg * a0, annTop],
      [sg * t0, annTop],
    ]);
    paint(g, COL.screen, null);
  }
  poly(g, V, [
    [-a0, c - 0.0005],
    [a0, c - 0.0005],
    [a0, annTop],
    [-a0, annTop],
  ]);
  paint(g, COL.screen, null);
  /* 柱の下の入口の切り欠き */
  for (const sg of [-1, 1]) {
    poly(g, V, [
      [sg * a0, zb],
      [sg * CUP.col, zb],
      [sg * CUP.col, zb + 0.003],
      [sg * a0, zb + 0.003],
    ]);
    paint(g, COL.screen, null);
  }
  /* 中の管（足の穴まで通る） */
  poly(g, V, [
    [-t0, foot],
    [t0, foot],
    [t0, c - 0.002],
    [-t0, c - 0.002],
  ]);
  paint(g, COL.body, COL.wall, 1);
  poly(g, V, [
    [-bore, foot],
    [bore, foot],
    [bore, c - 0.002],
    [-bore, c - 0.002],
  ]);
  paint(g, COL.screen, null);
  /* 柱と管の中の水 */
  const full = S.full,
    annH = full ? annTop : Math.min(S.h1, annTop);
  g.fillStyle = COL.water;
  for (const sg of [-1, 1])
    if (annH > zb) g.fillRect(V.X(sg > 0 ? t0 : -a0), V.Z(annH), (a0 - t0) * V.k, (annH - zb) * V.k);
  if (full) {
    g.fillRect(V.X(-a0), V.Z(annTop), 2 * a0 * V.k, (annTop - c + 0.0005) * V.k);
    g.fillRect(V.X(-bore), V.Z(c - 0.002), 2 * bore * V.k, (c - 0.002 - foot) * V.k);
  } else if (S.phi > 0.01 || S.q > 0) {
    g.save();
    g.beginPath();
    g.rect(V.X(-bore), V.Z(c - 0.002), 2 * bore * V.k, (c - 0.002 - foot) * V.k);
    g.clip();
    const n = 9,
      seg = (c - 0.002 - foot) / n;
    for (let i = 0; i < n; i++) {
      const z = c - 0.002 - (i + ((phase * 2) % 1)) * seg;
      g.fillRect(V.X(-bore), V.Z(z), 2 * bore * V.k, seg * Math.max(0.15, S.phi) * V.k);
    }
    g.restore();
  }
  if (!small && S.q > 1e-9 && (full || S.phi > 0.3)) {
    g.fillStyle = COL.ch2;
    const sp = 0.009;
    for (let z = foot + ((phase * 1.4) % 1) * sp; z < c - 0.002; z += sp) {
      g.beginPath();
      g.arc(V.X(0), V.Z(z), 1.6, 0, TAU);
      g.fill();
    }
  }
  /* 足の穴から落ちる水 */
  if (S.q > 1e-9) stream(g, V, 0, foot, CUP.table + 0.0045 + pool, streamW(S, 2 * bore * V.k));
  /* 急須: 注ぐ間は右へ傾け、注ぎ口の先が杯の中の真上に来る位置に置く（寸法は m、画面の下向きが正） */
  const tilt = pour ? 0.5 : 0,
    tipL: Pt = [0.066, -0.028],
    rot = (p: Pt, a: number): Pt => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)],
    tip0 = rot(tipL, 0.5),
    px = -0.022 - tip0[0],
    pz = 0.11 + tip0[1];
  g.save();
  g.translate(V.X(px), V.Z(pz));
  g.rotate(tilt);
  const k = V.k;
  g.beginPath();
  g.moveTo(0.028 * k, -0.004 * k);
  g.quadraticCurveTo(0.052 * k, -0.006 * k, 0.062 * k, -0.03 * k);
  g.lineTo(0.068 * k, -0.026 * k);
  g.quadraticCurveTo(0.056 * k, 0.006 * k, 0.03 * k, 0.014 * k);
  paint(g, COL.body, COL.wall, 1.3);
  g.beginPath();
  g.ellipse(0, 0, 0.034 * k, 0.026 * k, 0, 0, TAU);
  paint(g, COL.body, COL.wall, 1.3);
  g.beginPath();
  g.ellipse(0, -0.026 * k, 0.017 * k, 0.004 * k, 0, 0, TAU);
  paint(g, COL.body, COL.wall, 1.2);
  g.beginPath();
  g.arc(0, -0.033 * k, 0.0045 * k, 0, TAU);
  paint(g, COL.body, COL.wall, 1.2);
  g.beginPath();
  g.moveTo(-0.031 * k, -0.01 * k);
  g.quadraticCurveTo(-0.058 * k, -0.004 * k, -0.032 * k, 0.012 * k);
  paint(g, null, COL.wall, 2.2);
  g.restore();
  if (pour && S.qin > 0) {
    const t = rot(tipL, tilt),
      sx = px + t[0],
      sz = pz - t[1],
      zEnd = Math.max(S.h1, 0.002);
    g.strokeStyle = COL.water;
    g.lineWidth = Math.max(1.5, Math.min(4, Math.sqrt(S.qin / 5e-6) * 2.5));
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(V.X(sx), V.Z(sz));
    g.bezierCurveTo(V.X(sx + 0.004), V.Z(sz), V.X(sx + 0.005), V.Z(sz - 0.01), V.X(sx + 0.005), V.Z(zEnd));
    g.stroke();
  }
  if (!small) {
    label(g, '中央の柱', V.X(0.05), V.Z(capTop + 0.012), { color: COL.ink2, size: 12 });
    line(
      g,
      V,
      [
        [0.048, capTop + 0.009],
        [CUP.col + 0.001, capTop - 0.002],
      ],
      COL.grid2,
      1,
    );
    label(g, '底の穴', V.X(0.022), V.Z(foot - 0.006), { color: COL.ink2, size: 12 });
    label(g, '急須', V.X(px), V.Z(pz - 0.042), { align: 'center', color: COL.ink2, size: 12 });
  }
}

/** サイフォン式トイレ: 陶器の便器・排水路・タンクの中の部品・便座・床の排水管 */
function toilet({ g, V, S, v, small, phase }: Ctx): void {
  const [tx0, tx1, tz0, tz1] = TOI.tank;
  /* 壁と床・床下の排水管 */
  line(
    g,
    V,
    [
      [0.56, -0.02],
      [0.56, 0.84],
    ],
    COL.wall,
    1.4,
  );
  floor(g, V, -0.42, 0.56, 0);
  rr(g, V, 0.268, -0.16, 0.326, 0.0, 0);
  paint(g, COL.screen, COL.wall, 1.4);
  rr(g, V, 0.25, -0.012, 0.344, 0.002, 0.002);
  paint(g, COL.wall, null);
  /* 便器の陶器 */
  poly(g, V, [
    [-0.335, 0.4],
    [-0.335, 0.372],
    [-0.315, 0.31],
    [-0.27, 0.235],
    [-0.2, 0.165],
    [-0.12, 0.105],
    [-0.08, 0.055],
    [-0.085, 0.0],
    [0.36, 0.0],
    [0.36, 0.4],
  ]);
  paint(g, COL.body, COL.wall, 1.4);
  /* 縁の中の通水路（前と後ろ） */
  rr(g, V, -0.33, 0.37, -0.295, 0.393, 0.008);
  paint(g, COL.screen, COL.wall, 1);
  rr(g, V, 0.11, 0.37, 0.2, 0.393, 0.008);
  paint(g, COL.screen, COL.wall, 1);
  poly(g, V, S.src.poly);
  paint(g, COL.screen, null);
  line(g, V, S.src.poly as Pt[], COL.wall, 1.2);
  vesselWater(g, V, S.src.poly, S.h1, S.src.z0);
  /* 排水路（陶器の中の管） */
  const inner = tube(g, V, S, COL.wall, COL.screen, phase, small, 6);
  if (S.q > 1e-9) stream(g, V, S.pts[S.pts.length - 1][0], S.zOut, -0.16, streamW(S, inner * 0.9));
  /* 便座とふた */
  rr(g, V, -0.345, 0.4, 0.12, 0.422, 0.008);
  paint(g, COL.body, COL.wall, 1.3);
  rr(g, V, 0.118, 0.43, 0.142, 0.81, 0.008);
  paint(g, COL.body, COL.wall, 1.3);
  /* タンク */
  rr(g, V, tx0, tz0, tx1, tz1, 0.012);
  paint(g, COL.body, COL.wall, 1.4);
  rr(g, V, tx0 - 0.008, tz1, tx1 + 0.008, tz1 + 0.025, 0.006);
  paint(g, COL.body, COL.wall, 1.4);
  rr(g, V, tx0 + 0.012, tz0 + 0.012, tx1 - 0.012, tz1 - 0.004, 0.006);
  paint(g, COL.screen, null);
  let f = 1;
  if (S.flushT >= 0) {
    const u = S.t - S.flushT,
      d = S.c.flushDur ?? 1;
    f = u < d ? 1 - u / d : Math.min(1, (u - d) / (S.c.refillDur ?? 20));
  }
  const full = 0.74,
    empty = tz0 + 0.035,
    lv = empty + (full - empty) * f;
  vesselWater(
    g,
    V,
    [
      [tx0 + 0.012, tz0 + 0.012],
      [tx1 - 0.012, tz0 + 0.012],
      [tx1 - 0.012, tz1],
      [tx0 + 0.012, tz1],
    ],
    lv,
    tz0 + 0.012,
  );
  /* 排水弁・オーバーフロー管・浮き玉 */
  const flushing = S.flushT >= 0 && S.t - S.flushT < (S.c.flushDur ?? 0);
  line(
    g,
    V,
    [
      [0.27, tz0 + 0.014],
      [0.27, 0.76],
    ],
    COL.wall,
    3,
  );
  if (flushing)
    line(
      g,
      V,
      [
        [0.29, tz0 + 0.03],
        [0.34, tz0 + 0.07],
      ],
      COL.wall,
      3,
    );
  else
    line(
      g,
      V,
      [
        [0.29, tz0 + 0.015],
        [0.35, tz0 + 0.015],
      ],
      COL.wall,
      3,
    );
  rr(g, V, 0.255, tz0 - 0.03, 0.3, tz0 + 0.012, 0);
  paint(g, COL.screen, COL.wall, 1.2);
  line(
    g,
    V,
    [
      [0.46, tz1 - 0.02],
      [0.46, 0.5],
    ],
    COL.wall,
    2,
  );
  /* 浮き玉: 長さの決まった腕の先。水面に浮き、水が抜けると止め（腕の角度 50°）で空中に止まる */
  const piv: Pt = [0.46, 0.7],
    arm = 0.075,
    dz = Math.min(arm * Math.sin(0.87), Math.max(-arm * 0.3, piv[1] - (lv + 0.012))),
    fl: Pt = [piv[0] - Math.sqrt(arm * arm - dz * dz), piv[1] - dz];
  line(g, V, [piv, fl], COL.wall, 1.6);
  g.beginPath();
  g.arc(V.X(fl[0]), V.Z(fl[1]), 0.02 * V.k, 0, TAU);
  paint(g, COL.body, COL.wall, 1.3);
  /* レバー */
  const lev = flushing ? 0.5 : 0;
  g.save();
  g.translate(V.X(tx0 + 0.01), V.Z(0.76));
  g.rotate(lev);
  g.fillStyle = COL.wall;
  g.fillRect(-0.06 * V.k, -2, 0.06 * V.k, 4);
  g.restore();
  /* 縁から流れ込む水 */
  if (S.qin > 0 && !small) {
    g.fillStyle = COL.ch2;
    const bowl = S.src.poly,
      n = 6;
    for (const side of [0, 1]) {
      const a = side ? bowl[bowl.length - 1] : bowl[0],
        b = side ? bowl[bowl.length - 3] : bowl[3];
      for (let i = 0; i < n; i++) {
        const u = (phase * 0.9 + i / n) % 1,
          z = a[1] - 0.03 - u * (a[1] - 0.03 - Math.max(S.h1, b[1]));
        const x = side ? 0.1 - (0.4 - z) * 0.18 : -0.28 + (0.4 - z) * 0.9;
        g.beginPath();
        g.arc(V.X(x), V.Z(z), 1.8, 0, TAU);
        g.fill();
      }
    }
  }
  if (!small) {
    label(g, 'タンク', V.X((tx0 + tx1) / 2), V.Z(tz1 - 0.04), { align: 'center', color: COL.ink2 });
    label(g, '排水路', V.X(0.2), V.Z(0.06), { align: 'center', color: COL.ink2, size: 12 });
    label(g, '排水管', V.X(0.34), V.Z(-0.12), { color: COL.ink2, size: 12 });
    label(g, `${v.tv.toFixed(1)} L`, V.X((tx0 + tx1) / 2), V.Z(tz0 + 0.08), {
      align: 'center',
      color: COL.ink2,
      size: 12,
      mono: true,
    });
  }
}

/**
 * 間欠冷泉: 地表と木・地層と断層・割れ目・空洞・水路と脇道・崖の湧き口・川。
 * 水路は崖の面で終わり、湧き口の穴の床を流れて崖から川へ落ちる
 */
function cave({ sc, g, V, S, small, phase }: Ctx, P: typeof KUS, river: string): void {
  const [x0, x1, z0, z1] = sc.view,
    span = x1 - x0,
    hgt = z1 - z0,
    op = S.pts[S.pts.length - 1],
    cl = P.cliff,
    surf = z1 - hgt * 0.13,
    tw = Math.max(small ? 3 : 7, S.c.d * V.k + (small ? 1.5 : 3)),
    half = tw / 2 / V.k,
    zf = op[1] - half,
    mt = zf + P.mouth,
    hx = cl - P.hole,
    fx = (z: number) => P.fault.x + P.fault.k * z;
  /* 地表の線（ゆるい起伏）と崖。崖は湧き口の高さで開く */
  const ground: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = x0 - span * 0.5 + ((cl - 0.2 - (x0 - span * 0.5)) * i) / 24;
    ground.push([x, surf + Math.sin((x * 0.9) / (span / 9)) * hgt * 0.02 + (rnd(i + 40) - 0.5) * hgt * 0.01]);
  }
  const upper: Pt[] = [
      [cl - 0.2, surf],
      [cl - 0.05, surf - hgt * 0.12],
      [cl + 0.05, mt + hgt * 0.05],
      [cl, mt],
    ],
    lower: Pt[] = [
      [cl, zf],
      [cl, P.river + hgt * 0.02],
      [cl + 0.3, P.river],
    ];
  const rock: Pt[] = [...ground, ...upper, ...lower, [cl + 0.3, z0 - hgt], [x0 - span, z0 - hgt]];
  poly(g, V, rock);
  paint(g, COL.rock, null);
  /* 地層の線（断層の右側はずれる）と小さな割れ目 */
  if (!small) {
    g.save();
    poly(g, V, rock);
    g.clip();
    g.strokeStyle = COL.rock2;
    g.lineWidth = 1;
    const dz = hgt / 9;
    for (let j = -3; j < 11; j++) {
      const zz = z0 + dz * (j + 0.3);
      for (const side of [0, 1]) {
        g.beginPath();
        let pen = false;
        for (let i = 0; i <= 60; i++) {
          const x = x0 - span * 0.1 + (span * 1.2 * i) / 60,
            y = zz + Math.sin(x * 0.7 + j) * dz * 0.08 + (side ? P.fault.throw : 0);
          if (x > fx(y) !== (side === 1)) {
            pen = false;
            continue;
          }
          if (pen) g.lineTo(V.X(x), V.Z(y));
          else g.moveTo(V.X(x), V.Z(y));
          pen = true;
        }
        g.stroke();
      }
      for (let i = 0; i < 3; i++) {
        const x = x0 + span * rnd(j * 13 + i),
          a = rnd(j * 7 + i + 3),
          zA = zz + dz * (0.1 + a * 0.2),
          zB = zz + dz * (0.55 + rnd(j + i * 5) * 0.4);
        g.beginPath();
        g.moveTo(V.X(x), V.Z(zA));
        g.lineTo(V.X(x + span * (a - 0.5) * 0.012), V.Z((zA + zB) / 2));
        g.lineTo(V.X(x + span * (a - 0.3) * 0.008), V.Z(zB));
        g.stroke();
      }
    }
    /* 断層 */
    line(
      g,
      V,
      [
        [fx(surf + 1), surf + 1],
        [fx(z0 - 2), z0 - 2],
      ],
      COL.rock2,
      2.4,
    );
    g.restore();
  }
  /* 地表の針葉樹と草 */
  if (!small) {
    g.strokeStyle = COL.wall;
    g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      const p = ground[3 + ((i * 7) % 19)],
        th = hgt * (0.07 + rnd(i + 70) * 0.05),
        w = th * 0.22;
      g.beginPath();
      g.moveTo(V.X(p[0]), V.Z(p[1]));
      g.lineTo(V.X(p[0]), V.Z(p[1] + th * 0.25));
      g.moveTo(V.X(p[0] - w), V.Z(p[1] + th * 0.25));
      g.lineTo(V.X(p[0]), V.Z(p[1] + th));
      g.lineTo(V.X(p[0] + w), V.Z(p[1] + th * 0.25));
      g.closePath();
      g.stroke();
    }
    g.beginPath();
    for (let i = 0; i < 40; i++) {
      const p = ground[Math.floor(rnd(i + 200) * (ground.length - 2)) + 1],
        x = p[0] + (rnd(i + 300) - 0.5) * span * 0.03,
        y = V.Z(p[1]);
      g.moveTo(V.X(x) - 2, y);
      g.lineTo(V.X(x) - 1, y - 4);
      g.moveTo(V.X(x) + 1, y);
      g.lineTo(V.X(x) + 2, y - 4);
    }
    g.stroke();
  }
  line(g, V, [...ground, ...upper], COL.wall, 1.5);
  line(g, V, lower.slice(0, 2), COL.wall, 1.5);
  /* 雨水がしみこむ割れ目 */
  const top = Math.max(...S.src.poly.map((p) => p[1])),
    cx = (S.src.poly[0][0] + S.src.poly[1][0]) / 2,
    xs = [-0.3, 0.05, 0.35].map((d) => cx + d * span * 0.3);
  for (const [i, xx] of xs.entries()) {
    const pts: Pt[] = [];
    for (let j = 0; j <= 5; j++) {
      const u = j / 5;
      pts.push([xx + (rnd(i * 9 + j) - 0.5) * span * 0.02 + (1 - u) * span * 0.01, surf - u * (surf - top + 0.1)]);
    }
    line(g, V, pts, COL.rock2, small ? 1 : 2);
  }
  /* 空洞 */
  const wall = rough(S.src.poly, hgt * 0.012, 7);
  poly(g, V, wall);
  paint(g, COL.air, null);
  vesselWater(g, V, wall, S.h1, Math.min(...wall.map((p) => p[1])));
  poly(g, V, wall);
  paint(g, null, COL.rock2, 1.6);
  /* 脇道（分かれてまた合わさる割れ目）。主な道が満ちていれば水 */
  const bw = Math.max(small ? 2 : 4, tw * 0.5);
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  for (const b of P.branches)
    for (const [col, w] of [
      [COL.rock2, bw],
      [S.full ? COL.water : COL.air, bw - 2],
    ] as const) {
      poly(g, V, b, false);
      g.strokeStyle = col;
      g.lineWidth = w;
      g.stroke();
    }
  /* 主な水路 */
  const inner = tube(g, V, S, COL.rock2, COL.air, phase, small, 7);
  g.lineJoin = 'round';
  /* 湧き口: 崖の面に開いた穴。床は水路の底と同じ高さで、奥の壁は水路の口より上だけ */
  g.beginPath();
  g.moveTo(V.X(cl + 0.05), V.Z(zf));
  g.lineTo(V.X(hx), V.Z(zf));
  g.lineTo(V.X(hx), V.Z(mt - P.mouth * 0.4));
  g.quadraticCurveTo(V.X(hx), V.Z(mt), V.X(cl + 0.05), V.Z(mt));
  g.closePath();
  g.fillStyle = COL.air;
  g.fill();
  g.beginPath();
  g.moveTo(V.X(cl), V.Z(zf));
  g.lineTo(V.X(hx - half), V.Z(zf));
  g.moveTo(V.X(hx), V.Z(op[1] + half));
  g.lineTo(V.X(hx), V.Z(mt - P.mouth * 0.4));
  g.quadraticCurveTo(V.X(hx), V.Z(mt), V.X(cl), V.Z(mt));
  paint(g, null, COL.rock2, 1.6);
  /* 川 */
  poly(g, V, [
    [cl + 0.05, P.river],
    [x1 + span, P.river],
    [x1 + span, z0 - hgt],
    [cl + 0.05, z0 - hgt],
  ]);
  paint(g, COL.water, null);
  line(
    g,
    V,
    [
      [cl + 0.05, P.river],
      [x1 + span, P.river],
    ],
    COL.ch2,
    1.5,
  );
  if (!small)
    for (let i = 0; i < 6; i++) {
      const x = cl + 0.4 + ((i * 0.37 + phase * 0.05) % 1) * (x1 - cl - 0.5),
        z = P.river - hgt * (0.03 + (i % 3) * 0.025);
      line(
        g,
        V,
        [
          [x, z],
          [x + span * 0.025, z],
        ],
        COL.ch2,
        1,
      );
    }
  /* 湧き口の床を流れ、崖から川へ落ちる水 */
  if (S.q > 1e-9) {
    const w = streamW(S, inner),
      film = Math.min(P.mouth * 0.3, w / V.k);
    poly(g, V, [
      [hx, zf],
      [cl, zf],
      [cl, zf + film],
      [hx, zf + film],
    ]);
    paint(g, COL.water, null);
    line(
      g,
      V,
      [
        [hx, zf + film],
        [cl, zf + film],
      ],
      COL.ch2,
      1.2,
    );
    if (!small) {
      g.fillStyle = COL.ch2;
      const sp = P.hole / 3;
      for (let x = hx + ((phase * 1.5) % 1) * sp; x < cl; x += sp) {
        g.beginPath();
        g.arc(V.X(x), V.Z(zf + film / 2), Math.max(1.2, inner * 0.28), 0, TAU);
        g.fill();
      }
    }
    stream(g, V, cl, zf + film / 2, P.river, w, span * 0.025);
  }
  /* しみこむ地下水 */
  if (S.qin > 0) {
    g.fillStyle = COL.ch2;
    const n = Math.min(6, 1 + Math.round(Math.log2(1 + (S.qin / (S.c.qfilm * 4)) * 2)));
    for (const [j, xx] of xs.entries())
      for (let i = 0; i < n; i++) {
        const u = (phase * 0.7 + i / n + j * 0.3) % 1,
          z = top - 0.1 - u * (top - 0.1 - S.h1);
        g.beginPath();
        g.arc(V.X(xx), V.Z(z), small ? 1 : 2, 0, TAU);
        g.fill();
      }
  }
  if (!small) {
    label(g, '空洞', V.X(cx), V.Z(top) + 14, { align: 'center', color: COL.ink2 });
    label(g, '湧き口', V.X(cl - P.hole / 2), V.Z(mt) - 12, { align: 'center', color: COL.ink2, size: 12 });
    label(g, river, V.X((cl + x1) / 2), V.Z(P.river - hgt * 0.1), { align: 'center', color: COL.ink2, size: 12 });
    label(g, '雨水がしみこむ割れ目', V.X(xs[2] + span * 0.03), V.Z(surf - hgt * 0.06), { color: COL.ink2, size: 12 });
    label(g, '断層', V.X(fx(z0 + hgt * 0.12)) + 6, V.Z(z0 + hgt * 0.12), { color: COL.ink2, size: 12 });
  }
}

/** 高さの限界: 地面・上の水槽の台・穴の中の下の水槽・足場・目盛り */
function height({ g, V, S, small, phase }: Ctx): void {
  const gz = HGT.ground;
  /* 地面と穴 */
  const [l0, l1, lz0] = HGT.lower;
  poly(g, V, [
    [-2.3, gz],
    [l0 - 0.08, gz],
    [l0 - 0.08, lz0 - 0.08],
    [l1 + 0.08, lz0 - 0.08],
    [l1 + 0.08, gz],
    [6.5, gz],
    [6.5, gz - 0.4],
    [-2.3, gz - 0.4],
  ]);
  paint(g, COL.rock, null);
  line(
    g,
    V,
    [
      [-2.3, gz],
      [l0 - 0.08, gz],
      [l0 - 0.08, lz0 - 0.08],
      [l1 + 0.08, lz0 - 0.08],
      [l1 + 0.08, gz],
      [6.5, gz],
    ],
    COL.wall,
    1.4,
  );
  /* 上の水槽の台 */
  rr(g, V, 0.05, gz, 1.15, 0, 0.02);
  paint(g, COL.wood, COL.wall, 1.2);
  /* 足場（頂上まで） */
  const top = S.zC;
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1.2;
  g.beginPath();
  for (const x of [1.4, 2.6]) {
    g.moveTo(V.X(x), V.Z(gz));
    g.lineTo(V.X(x), V.Z(top - 0.05));
  }
  for (let z = gz; z < top - 0.05; z += 1.2) {
    const z2 = Math.min(top - 0.05, z + 1.2);
    g.moveTo(V.X(1.4), V.Z(z));
    g.lineTo(V.X(2.6), V.Z(z2));
    g.moveTo(V.X(1.4), V.Z(z2));
    g.lineTo(V.X(2.6), V.Z(z2));
  }
  g.stroke();
  /* 水槽 */
  for (const [vs, h] of [
    [S.src, S.h1],
    [S.dst, S.h2],
  ] as const) {
    if (!vs) continue;
    vesselWater(g, V, vs.poly, h, vs.z0);
    const xs = vs.poly.map((p) => p[0]),
      zs = vs.poly.map((p) => p[1]);
    poly(
      g,
      V,
      [
        [Math.min(...xs) - 0.03, Math.max(...zs) + 0.02],
        [Math.min(...xs) - 0.03, Math.min(...zs) - 0.03],
        [Math.max(...xs) + 0.03, Math.min(...zs) - 0.03],
        [Math.max(...xs) + 0.03, Math.max(...zs) + 0.02],
      ],
      false,
    );
    paint(g, null, COL.wall, 2.2);
  }
  tube(g, V, S, COL.wall, COL.screen, phase, small, 5);
  if (small) return;
  /* 目盛り（上の水面から） */
  const h0 = S.h1,
    rx = -0.5;
  g.strokeStyle = COL.sink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(V.X(rx), V.Z(h0));
  g.lineTo(V.X(rx), V.Z(h0 + 13.5));
  for (let m = 0; m <= 13; m++) {
    g.moveTo(V.X(rx), V.Z(h0 + m));
    g.lineTo(V.X(rx + (m % 5 ? 0.1 : 0.22)), V.Z(h0 + m));
  }
  g.stroke();
  for (const m of [0, 5, 10])
    label(g, `${m} m`, V.X(rx - 0.1), V.Z(h0 + m), {
      align: 'right',
      size: 12,
      color: COL.sink,
      mono: true,
      halo: false,
    });
  const lim = h0 + S.lift;
  line(
    g,
    V,
    [
      [rx, lim],
      [6.4, lim],
    ],
    COL.warn,
    1.4,
    [5, 4],
  );
  label(g, `限界の高さ ${S.lift.toFixed(1)} m`, V.X(6.4), V.Z(lim) + 12, { align: 'right', size: 13, color: COL.warn });
  label(g, '上の水槽', V.X(0.6), V.Z(1.2) - 12, { align: 'center', color: COL.ink2 });
  label(g, '下の水槽', V.X((l0 + l1) / 2), V.Z(gz) - 12, { align: 'center', color: COL.ink2 });
}

const PAINT: Record<string, (c: Ctx) => void> = {
  kerosene,
  aquarium,
  cup,
  toilet,
  kusama: (c) => cave(c, KUS, '佐伏川'),
  periodic: (c) => cave(c, PER, '川'),
  height,
};

/** 断面図を描く。small は例の選択ボタンの小さな絵（札なし） */
export function drawScene(
  g: G,
  sc: Scene,
  S: Siphon,
  v: Vals,
  W: number,
  H: number,
  o: { phase?: number; small?: boolean; pour?: boolean } = {},
): void {
  const small = !!o.small,
    V = fitView(sc.view, W, H, small ? 2 : 10);
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  g.lineJoin = 'round';
  PAINT[sc.id]({ sc, g, V, S, v, small, phase: o.phase ?? 0, pour: o.pour ?? true });
  if (small) return;
  /* 頂上の負圧 */
  const cp = S.pts[S.ic],
    dp = S.patm - S.crestP();
  const txt = S.vapor
    ? '頂上: 沸騰で分断'
    : S.full
      ? `頂上の負圧 ${(dp / 1000).toFixed(dp < 10000 ? 1 : 0)} kPa`
      : '頂上: 空気';
  const cx = Math.min(W - 100, Math.max(100, V.X(cp[0])));
  label(g, txt, cx, V.Z(cp[1]) - 18, {
    align: 'center',
    size: 15,
    w: 700,
    color: S.vapor ? COL.warn : S.full ? COL.low : COL.ink,
  });
  /* 落差 */
  const zo = S.outRef,
    xr = sc.view[1] - (sc.view[1] - sc.view[0]) * 0.03,
    op = S.pts[S.pts.length - 1];
  if (S.h1 > zo + 1e-4) {
    const xs = Math.max(...S.src.poly.map((p) => p[0]));
    line(
      g,
      V,
      [
        [xs, S.h1],
        [xr, S.h1],
      ],
      COL.ch1,
      1.2,
      [3, 3],
    );
    line(
      g,
      V,
      [
        [op[0], zo],
        [xr, zo],
      ],
      COL.ch1,
      1.2,
      [3, 3],
    );
    line(
      g,
      V,
      [
        [xr, S.h1],
        [xr, zo],
      ],
      COL.ch1,
      1.5,
    );
    label(g, `落差 ${len(S.h1 - zo)}`, V.X(xr) - 6, (V.Z(S.h1) + V.Z(zo)) / 2, {
      align: 'right',
      size: 15,
      w: 700,
      color: COL.ch1,
    });
  }
  /* 出来事 */
  const msg = status(S, sc);
  if (msg)
    label(g, msg[0], 12, W < 560 ? H - 16 : 18, {
      size: W < 560 ? 13 : 15,
      w: 700,
      color: msg[1] ? COL.warn : COL.ink,
    });
}

/** 図の左上に出す今の状態 [文言, 警告か] */
export function status(S: Siphon, sc: Scene): [string, boolean] | null {
  const last = S.ev[S.ev.length - 1];
  if (S.over && (S.spill2 > 0 || (last?.k === 'over' && S.t - last.t < 3)))
    return [sc.id === 'kerosene' ? 'カートリッジタンクからあふれ' : 'バケツからあふれ', true];
  if (last && S.t - last.t < sc.win / 15) {
    const m: Record<string, [string, boolean]> = {
      prime: ['呼び水で管が満ちて流れ始め', false],
      air: ['入口から空気が入り停止', false],
      stop: ['管に空気を入れて停止', false],
      vap: ['頂上の水が沸騰して水柱が分断', true],
      over: ['あふれ', true],
    };
    return m[last.k] ?? null;
  }
  if (S.choke) return ['頂上で沸騰が始まり流量が頭打ち', true];
  return null;
}

export function len(m: number): string {
  return m < 1 ? `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm` : `${m.toFixed(m < 10 ? 2 : 1)} m`;
}
/** 流量の換算 [倍率, 単位] */
export function qConv(u: Scene['qUnit']): [number, string] {
  return ({ 'L/min': [6e4, 'L/min'], 'mL/s': [1e6, 'mL/s'], 'L/s': [1e3, 'L/s'], 'm³/s': [1, 'm³/s'] } as const)[u] as [
    number,
    string,
  ];
}
export function dur(sec: number): string {
  if (sec < 120) return `${sec.toFixed(sec < 10 ? 1 : 0)} 秒`;
  if (sec < 7200) return `${(sec / 60).toFixed(sec < 600 ? 1 : 0)} 分`;
  return `${(sec / 3600).toFixed(1)} 時間`;
}

/** 水位と流量の時間変化 */
export function drawTime(g: G, sc: Scene, S: Siphon, W: number, H: number): void {
  const [qk, qu] = qConv(sc.qUnit),
    L = 50,
    R = 56,
    T = 14,
    B = 24,
    pw = W - L - R,
    ph = H - T - B;
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  const t1 = Math.max(S.t, sc.win),
    t0 = t1 - sc.win;
  const [tk, tu, stp] =
    sc.win <= 180
      ? [1, '秒', sc.win <= 70 ? 10 : 30]
      : sc.win <= 3 * 3600
        ? [60, '分', sc.win <= 3600 ? 10 : 20]
        : [3600, '時間', 2];
  const X = (t: number) => L + ((t - t0) / (t1 - t0)) * pw;
  const z0 = S.zIn - (S.zC - S.zIn) * 0.15,
    z1 = Math.max(S.src.z1, S.zC + (S.zC - S.zIn) * 0.1);
  const Zl = (z: number) => T + ph - ((z - z0) / (z1 - z0)) * ph;
  let qm = S.qmax || 1e-9;
  for (const h of S.hist) qm = Math.max(qm, h.qin);
  qm *= 1.15;
  const Zq = (q: number) => T + ph - (q / qm) * ph;
  g.strokeStyle = COL.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i <= 4; i++) {
    g.moveTo(L, T + (ph * i) / 4);
    g.lineTo(L + pw, T + (ph * i) / 4);
  }
  const s0 = Math.ceil(t0 / (tk * stp)) * tk * stp;
  for (let t = s0; t <= t1; t += tk * stp) {
    g.moveTo(X(t), T);
    g.lineTo(X(t), T + ph);
  }
  g.stroke();
  g.font = `12px ${COL.mono}`;
  g.fillStyle = COL.sink;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (let t = s0; t <= t1; t += tk * stp) g.fillText(`${Math.round(t / tk)}`, X(t), T + ph + 5);
  g.textAlign = 'left';
  g.fillText(tu, L + pw + 6, T + ph + 5);
  line2(g, L, Zl(S.zC), L + pw, COL.ch2, [4, 4]);
  line2(g, L, Zl(S.zIn), L + pw, COL.grid2, [4, 4]);
  label(g, '頂上', L + 4, Zl(S.zC) - 8, { size: 12, color: COL.ch2 });
  label(g, '入口', L + 4, Zl(S.zIn) + 9, { size: 12, color: COL.sink });
  const trace = (
    f: (h: (typeof S.hist)[number]) => number,
    Y: (x: number) => number,
    col: string,
    w: number,
    dash: number[] = [],
  ) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.setLineDash(dash);
    g.beginPath();
    for (const [i, h] of S.hist.entries()) {
      if (i) g.lineTo(X(h.t), Y(f(h)));
      else g.moveTo(X(h.t), Y(f(h)));
    }
    g.stroke();
    g.setLineDash([]);
  };
  if (S.hist.some((h) => h.qin > 0)) trace((h) => h.qin, Zq, COL.sink, 1.2, [5, 4]);
  trace((h) => h.h1, Zl, COL.ch2, 2);
  trace((h) => h.q, Zq, COL.ch1, 2.2);
  g.font = `12px ${COL.mono}`;
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  g.fillStyle = COL.ch2;
  g.fillText(len(z1 - S.zIn).replace(' ', ''), L - 5, T + 2);
  g.fillText('0', L - 5, Zl(S.zIn));
  g.textAlign = 'left';
  g.fillStyle = COL.ch1;
  g.fillText(`${Number((qm * qk).toPrecision(2))}`, L + pw + 6, T + 2);
  g.fillText(qu, L + pw + 6, T + 17);
  g.fillText('0', L + pw + 6, T + ph - 4);
}
function line2(g: G, x0: number, y: number, x1: number, col: string, dash: number[]): void {
  g.strokeStyle = col;
  g.lineWidth = 1;
  g.setLineDash(dash);
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x1, y);
  g.stroke();
  g.setLineDash([]);
}

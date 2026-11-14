/**
 * 振り子時計の図。正面から見た機械（板を外した図）・文字盤・展開図を描く。
 * f は Clock.snap() の写し、C は色。描くたびに cv.hits へ部品の当たり判定（画面の座標）を入れ、
 * 指した部品の名前を吹き出しに出す（client.ts）。同じ部品は id でどの図でも黄色で囲む
 */
import { R as ER, makeEsc, TOOTH_H, toothPts } from './esc';
import {
  DEG,
  GEO,
  HAM,
  hamAngle,
  hPinsAt,
  liftAt,
  lockByLift,
  lockByRim,
  type Pt,
  RATIO,
  SK,
  SLOT,
  type Snap,
  SPRING,
  SRATIO,
  TAU,
  type Train,
  TYPES,
  W,
  type Wheel,
  wPinAt,
} from './model';

export interface Colors {
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  line2: string;
  surface: string;
  inset: string;
  screen: string;
  ch1: string;
  accent: string;
  go: string;
  goBg: string;
  st: string;
  stBg: string;
  mw: string;
  mwBg: string;
  steel: string;
  steel2: string;
  hot: string;
  hotBg: string;
  mono: string;
  sans: string;
}
export function readColors(): Colors {
  const g = getComputedStyle(document.documentElement),
    v = (n: string, f: string) => g.getPropertyValue(n).trim() || f;
  return {
    ink: v('--ink', '#15191c'),
    ink2: v('--ink-2', '#48505a'),
    ink3: v('--ink-3', '#687078'),
    line: v('--line', '#d5d9d3'),
    line2: v('--line-2', '#abb2aa'),
    surface: v('--surface', '#fafbf8'),
    inset: v('--inset', '#f0f2ed'),
    screen: v('--screen', '#f6f7f2'),
    ch1: v('--ch1', '#9a6c00'),
    accent: v('--accent', '#bf4308'),
    go: v('--pc-go', '#0a6e8a'),
    goBg: v('--pc-go-bg', '#dcebee'),
    st: v('--pc-st', '#9a6c00'),
    stBg: v('--pc-st-bg', '#f2e7cd'),
    mw: v('--pc-mw', '#5a4f8a'),
    mwBg: v('--pc-mw-bg', '#e6e2f2'),
    steel: v('--pc-steel', '#4a535a'),
    steel2: v('--pc-steel-2', '#79828a'),
    hot: v('--pc-hot', '#c0392b'),
    hotBg: v('--pc-hot-bg', '#f6d5cf'),
    mono: v('--mono', 'monospace'),
    sans: v('--sans', 'sans-serif'),
  };
}

/* ===== 当たり判定 ===== */
export interface Hit {
  id: string;
  name: string;
  sub?: string;
  /** 'c': 円 [cx, cy, r]、'r': 長方形 [x0, y0, x1, y1]（画面の座標） */
  t: 'c' | 'r';
  a: number[];
}
const HITS = new WeakMap<HTMLCanvasElement, Hit[]>();
export const hitsOf = (cv: HTMLCanvasElement): Hit[] => HITS.get(cv) ?? [];
/** 画面の点 (x, y) に当たる部品（後に入れたものほど手前） */
export function hitAt(cv: HTMLCanvasElement, x: number, y: number): Hit | null {
  const hs = hitsOf(cv);
  for (let i = hs.length - 1; i >= 0; i--) {
    const h = hs[i];
    if (
      h.t === 'r'
        ? x >= h.a[0] && x <= h.a[2] && y >= h.a[1] && y <= h.a[3]
        : Math.hypot(x - h.a[0], y - h.a[1]) <= h.a[2]
    )
      return h;
  }
  return null;
}

/* ===== キャンバス ===== */
export interface View {
  s: number;
  ox: number;
  oy: number;
}
const VIEWS = new WeakMap<HTMLCanvasElement, View>();
export const viewOf = (cv: HTMLCanvasElement): View | undefined => VIEWS.get(cv);
interface Fit {
  ctx: CanvasRenderingContext2D;
  s: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  hit: (h: Omit<Hit, 'a' | 't'>, shape: { c: Pt; r: number } | { box: [number, number, number, number] }) => void;
}
/** キャンバスを CSS の大きさに合わせ、世界の箱 [x0, y0, x1, y1]（mm、y は上が正）を中央に置く。shift は台の揺れ [mm] */
function fitBox(cv: HTMLCanvasElement, box: readonly number[], pad = 6, shift = 0): Fit {
  const dpr = window.devicePixelRatio || 1,
    Wd = cv.clientWidth,
    Hd = cv.clientHeight;
  if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Hd * dpr)) {
    cv.width = Math.round(Wd * dpr);
    cv.height = Math.round(Hd * dpr);
  }
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, Wd, Hd);
  const [x0, y0, x1, y1] = box,
    s = Math.max(1e-6, Math.min((Wd - 2 * pad) / (x1 - x0), (Hd - 2 * pad) / (y1 - y0))),
    ox = (Wd - s * (x1 - x0)) / 2 - s * x0,
    oy = (Hd + s * (y1 - y0)) / 2 + s * y0;
  VIEWS.set(cv, { s, ox, oy });
  const hits: Hit[] = [];
  HITS.set(cv, hits);
  const X = (x: number) => ox + s * (x + shift),
    Y = (y: number) => oy - s * y;
  return {
    ctx,
    s,
    X,
    Y,
    hit: (h, sh) => {
      if ('c' in sh) hits.push({ ...h, t: 'c', a: [X(sh.c[0]), Y(sh.c[1]), Math.max(6, sh.r * s)] });
      else hits.push({ ...h, t: 'r', a: [X(sh.box[0]), Y(sh.box[3]), X(sh.box[2]), Y(sh.box[1])] });
    },
  };
}
function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: { size?: number; w?: number; col?: string; align?: CanvasTextAlign; mono?: boolean; C: Colors; halo?: boolean },
): void {
  const { size = 13, w = 500, align = 'left', mono = false, C, halo = true } = o;
  ctx.font = `${w} ${size}px ${mono ? C.mono : C.sans}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (halo) {
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = C.surface;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = o.col ?? C.ink;
  ctx.fillText(str, x, y);
}
const TR = (C: Colors, tr: Train): [string, string] =>
  tr === 'go' ? [C.go, C.goBg] : tr === 'st' ? [C.st, C.stBg] : [C.mw, C.mwBg];
const circ = (
  ctx: CanvasRenderingContext2D,
  X: (x: number) => number,
  Y: (y: number) => number,
  s: number,
  cx: number,
  cy: number,
  r: number,
  ccw = false,
) => {
  ctx.moveTo(X(cx + r), Y(cy));
  ctx.arc(X(cx), Y(cy), Math.max(0, r * s), 0, TAU, ccw);
};
const rotP = (pv: Pt, p: Pt, a: number): Pt => [
  pv[0] + (p[0] - pv[0]) * Math.cos(a) - (p[1] - pv[1]) * Math.sin(a),
  pv[1] + (p[0] - pv[0]) * Math.sin(a) + (p[1] - pv[1]) * Math.cos(a),
];
const at = (p: Pt, r: number, a: number): Pt => [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)];

/* ===== 噛み合いの位相と回転 ===== */
function meshPhase(phi1: number, z1: number, z2: number, c1: Pt, c2: Pt): number {
  const a = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]);
  return -(z1 / z2) * (phi1 - a) + a + Math.PI + Math.PI / z2;
}
const PH: Record<string, { w: number; p: number }> = {};
for (const id in W) PH[id] = { w: 0, p: 0 };
for (const [a, b] of [
  ['bar', 'wi'],
  ['wi', 'w2'],
  ['w2', 'w3'],
  ['w3', 'esc'],
  ['sbar', 'si'],
  ['si', 'pw'],
  ['pw', 'lw'],
  ['lw', 'ww'],
  ['ww', 'fly'],
] as const)
  PH[b].p = meshPhase(PH[a].w, W[a].z ?? 1, W[b].pin?.z ?? 1, W[a].c, W[b].c);
PH.mw.w = meshPhase(0, 12, 36, W.cannon.c, W.mw.c);
PH.hw.w = meshPhase(PH.mw.w, 10, 40, W.mw.c, W.hw.c);
PH.cw.w = meshPhase(0, 8, 90, W.pw.c, W.cw.c);
/** 軸の角（数学の向き、反時計回りが正） */
function arborAng(f: Snap, id: string): number {
  if (RATIO[id] !== undefined) return -RATIO[id] * f.adv;
  if (SRATIO[id] !== undefined) return -SRATIO[id] * f.s * TAU;
  return 0;
}
/** 時計の示す時刻の分（0 時からの分） */
export const minutesOf = (f: Snap): number => {
  const d = new Date(f.clockMs);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
};
/** 1 回転の長さ（ふつうの速さ）。時打ちは打つ数で */
export const PERIOD: Record<string, string> = {
  esc: '30 秒',
  w3: '6 分',
  w2: '1 時間',
  wi: '4 時間',
  bar: '24 時間',
  anc: '往復 1 秒',
  lw: '1 打ち',
  pw: '8 打ち',
  si: '20 打ち',
  sbar: '180 打ち',
  ww: '1/8 打ち',
  fly: '1/64 打ち',
  cw: '12 時間',
  cannon: '1 時間',
  mw: '3 時間',
  hw: '12 時間',
};
/** 吹き出しに出す部品の役割 */
const ROLE: Record<string, string> = {
  wi: '香箱の力を 2 番車へ',
  w2: '軸の前に分針',
  w3: '2 番車からがんぎ車へ速さを上げる',
  si: '時打ちの香箱の力をピン車へ',
  pw: 'ピン 8 本でハンマーを順に持ち上げる',
  lw: '切り欠きの壁が止めの爪に当たると時打ちの輪列が止まる',
  ww: '予告ピンを持つ。予告の間は持ち上げレバーの旗で止まる',
  cw: '縁の溝の間隔が打つ数（30 分の 1 打ち、正時の 1〜12 打ち）。止めレバーの尾が溝に落ちると打ち終わる',
};
const subOf = (w: Wheel): string =>
  [ROLE[w.id] ?? '', w.z ? `${w.z} 歯` : '', PERIOD[w.id] ? `1 回転 ${PERIOD[w.id]}` : ''].filter(Boolean).join('・');

/* ===== 歯車 ===== */
/** 時計の歯車の輪郭（先の丸い歯） */
function gearPath(
  ctx: CanvasRenderingContext2D,
  X: (x: number) => number,
  Y: (y: number) => number,
  cx: number,
  cy: number,
  r: number,
  z: number,
  phi: number,
  m: number,
): void {
  const rr = r - 1.15 * m,
    pa = TAU / z,
    sh: Pt[] = [
      [rr, -0.5],
      [rr, -0.3],
      [r - 0.15 * m, -0.24],
      [r + 0.6 * m, -0.15],
      [r + 0.95 * m, -0.05],
      [r + 0.95 * m, 0.05],
      [r + 0.6 * m, 0.15],
      [r - 0.15 * m, 0.24],
      [rr, 0.3],
    ];
  ctx.beginPath();
  for (let k = 0; k < z; k++) {
    const a = phi + k * pa;
    for (let i = 0; i < sh.length; i++) {
      const [rad, u] = sh[i],
        t = a + u * pa,
        x = X(cx + rad * Math.cos(t)),
        y = Y(cy + rad * Math.sin(t));
      if (k === 0 && i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}
/** スポークの間の抜きを今の道に足す */
function crossings(
  c: Fit,
  cx: number,
  cy: number,
  rim: number,
  hub: number,
  half: number,
  n: number,
  ang: number,
): void {
  const { ctx, X, Y } = c;
  for (let k = 0; k < n; k++) {
    const a0 = ang + (k * TAU) / n,
      a1 = a0 + TAU / n,
      da = Math.asin(Math.min(0.9, half / hub)),
      db = Math.asin(Math.min(0.9, half / rim));
    ctx.moveTo(X(cx + rim * Math.cos(a0 + db)), Y(cy + rim * Math.sin(a0 + db)));
    for (let i = 0; i <= 16; i++) {
      const t = a0 + db + ((a1 - a0 - 2 * db) * i) / 16;
      ctx.lineTo(X(cx + rim * Math.cos(t)), Y(cy + rim * Math.sin(t)));
    }
    for (let i = 0; i <= 8; i++) {
      const t = a1 - da - ((a1 - a0 - 2 * da) * i) / 8;
      ctx.lineTo(X(cx + hub * Math.cos(t)), Y(cy + hub * Math.sin(t)));
    }
    ctx.closePath();
  }
}
/** 軸のかなと軸 */
function arbor(c: Fit, C: Colors, w: Wheel, ang: number, ph: number): void {
  const { ctx, X, Y, s } = c;
  if (w.pin && w.r * s > 10) {
    const pm = w.pin.m;
    gearPath(ctx, X, Y, w.c[0], w.c[1], (w.pin.z * pm) / 2, w.pin.z, ang + ph, pm);
    ctx.fillStyle = C.steel;
    ctx.fill();
  }
  ctx.beginPath();
  circ(ctx, X, Y, s, w.c[0], w.c[1], w.pin ? 0.45 : 0.9);
  ctx.fillStyle = w.pin ? C.surface : C.steel;
  ctx.fill();
}
/** 車（スポーク付き）。数取り車は裏板の外なので線だけ */
function drawWheel(c: Fit, f: Snap, w: Wheel, C: Colors): void {
  const { ctx, X, Y, s } = c,
    ang = arborAng(f, w.id),
    [col, bg] = TR(C, w.tr),
    ph = PH[w.id],
    m = w.m ?? 0.3,
    tiny = s * w.r < 10;
  ctx.save();
  if (tiny) {
    ctx.beginPath();
    circ(ctx, X, Y, s, w.c[0], w.c[1], w.r);
  } else gearPath(ctx, X, Y, w.c[0], w.c[1], w.r, w.z ?? 1, ang + ph.w, m);
  if (w.back) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    if (w.spk)
      crossings(
        c,
        w.c[0],
        w.c[1],
        w.r - 1.15 * m - Math.max(0.9, w.r * 0.1),
        Math.max(1.6, w.r * 0.2),
        Math.max(0.35, w.r * 0.045),
        w.spk,
        ang + ph.w,
      );
    ctx.fillStyle = bg;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.3;
    ctx.fill('evenodd');
    ctx.stroke();
  }
  ctx.restore();
  /* ピン車のピンは時打ちの部品（strikeParts）で、ハンマーの計算と同じ位置に描く */
  arbor(c, C, w, ang, ph.p);
  c.hit({ id: w.id, name: w.name, sub: subOf(w) }, { c: w.c, r: w.r + 1 });
}
/** 香箱とゼンマイ。ゼンマイは巻いてあるほど芯に寄る */
function drawBarrel(c: Fit, f: Snap, w: Wheel, C: Colors): void {
  const { ctx, X, Y, s } = c,
    ang = arborAng(f, w.id),
    [col, bg] = TR(C, w.tr),
    n = w.id === 'bar' ? f.nT : f.nS;
  gearPath(ctx, X, Y, w.c[0], w.c[1], w.r, w.z ?? 1, ang, w.m ?? 0.5);
  circ(ctx, X, Y, s, w.c[0], w.c[1], w.r - 2.2, true);
  ctx.fillStyle = bg;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.3;
  ctx.fill('evenodd');
  ctx.stroke();
  const u = Math.min(1, Math.max(0, n / SPRING.N)),
    turns = 11,
    a0 = 3.2 + (1 - u) * 6.5,
    a1 = w.r - 2.6 - u * 7.5,
    arb = -n * TAU,
    N = turns * 48;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const t = i / N,
      r = a0 + (a1 - a0) * t ** 0.9,
      a = arb * (1 - t) + ang * t + t * turns * TAU,
      x = X(w.c[0] + r * Math.cos(a)),
      y = Y(w.c[1] + r * Math.sin(a));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = C.steel;
  ctx.lineWidth = Math.max(0.8, 0.3 * s);
  ctx.stroke();
  /* 芯・角穴・角穴車（こはぜの歯 24） */
  ctx.beginPath();
  circ(ctx, X, Y, s, w.c[0], w.c[1], 3);
  ctx.fillStyle = C.inset;
  ctx.fill();
  ctx.strokeStyle = C.steel;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const p = at(w.c, 1.4 * Math.SQRT2, arb + Math.PI / 4 + (k * TAU) / 4);
    if (k) ctx.lineTo(X(p[0]), Y(p[1]));
    else ctx.moveTo(X(p[0]), Y(p[1]));
  }
  ctx.closePath();
  ctx.fillStyle = C.steel;
  ctx.fill();
  ctx.beginPath();
  for (let k = 0; k < 24; k++) {
    const a = arb + (k * TAU) / 24,
      b = a + TAU / 24,
      p0 = at(w.c, 4.7, a),
      p1 = at(w.c, 5.6, b - 0.02),
      p2 = at(w.c, 4.7, b);
    if (k) ctx.lineTo(X(p0[0]), Y(p0[1]));
    else ctx.moveTo(X(p0[0]), Y(p0[1]));
    ctx.lineTo(X(p1[0]), Y(p1[1]));
    ctx.lineTo(X(p2[0]), Y(p2[1]));
  }
  ctx.closePath();
  ctx.stroke();
  c.hit(
    { id: w.id, name: w.name, sub: `ゼンマイ 残り ${n.toFixed(1)} 回転・1 回転 ${PERIOD[w.id]}` },
    { c: w.c, r: w.r + 1 },
  );
}

/* ===== 脱進機 ===== */
function drawEsc(c: Fit, f: Snap, C: Colors): void {
  const { ctx, X, Y } = c,
    e = makeEsc(f.type),
    [ex, ey] = GEO.E;
  ctx.beginPath();
  for (let k = 0; k < 30; k++)
    for (const [i, [x, y]] of toothPts(f.type, e.phi0, k, f.adv).entries()) {
      if (k === 0 && i === 0) ctx.moveTo(X(ex + x), Y(ey + y));
      else ctx.lineTo(X(ex + x), Y(ey + y));
    }
  ctx.closePath();
  crossings(c, ex, ey, ER - TOOTH_H - 1.6, 3.5, 0.55, 4, -f.adv + 0.3);
  ctx.fillStyle = C.goBg;
  ctx.strokeStyle = C.go;
  ctx.lineWidth = 1.3;
  ctx.fill('evenodd');
  ctx.stroke();
  arbor(c, C, W.esc, -f.adv, PH.esc.p);
  c.hit({ id: 'esc', name: 'がんぎ車', sub: '30 歯・1 回転 30 秒' }, { c: GEO.E, r: ER + 0.5 });
}
/**
 * 隠れ線: 手前の車に隠れた歯とかなの輪郭を、細かい点線で上から重ねる。かなと車の噛み合いが車の後ろでも見える。
 * 見えている輪郭の上では実線に重なるだけで目立たない
 */
function hiddenLines(c: Fit, f: Snap, C: Colors): void {
  const { ctx, X, Y, s } = c;
  ctx.save();
  ctx.setLineDash([2, 2]);
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  for (const id of ['bar', 'sbar', 'wi', 'w2', 'w3', 'si', 'pw', 'lw', 'ww', 'esc', 'fly']) {
    const w = W[id],
      ang = id === 'esc' ? -f.adv : arborAng(f, id),
      ph = PH[id];
    ctx.strokeStyle = TR(C, w.tr)[0];
    if (id !== 'esc' && w.z && w.r * s > 10) {
      gearPath(ctx, X, Y, w.c[0], w.c[1], w.r, w.z, ang + ph.w, w.m ?? 0.3);
      ctx.stroke();
    }
    if (w.pin && (w.r * s > 10 || id === 'fly')) {
      const pm = w.pin.m;
      gearPath(ctx, X, Y, w.c[0], w.c[1], (w.pin.z * pm) / 2, w.pin.z, ang + ph.p, pm);
      ctx.strokeStyle = C.ink2;
      ctx.stroke();
    }
  }
  ctx.restore();
}
/**
 * アンクル: 支点のボス・2 本の腕・爪を 1 つの鋼の部品として描く（輪郭を先に太く引き、上から塗って継ぎ目を消す）。
 * グラハム式の爪は支点を中心とする円弧の板、リコイル式は先の細い斜めの板、ブロコ式は腕の先の半円のピン。
 * 腕は支点から爪の根元（歯から遠い端）へ、がんぎ車をまたぐ弓なりに伸ばす
 */
function drawAnchor(c: Fit, f: Snap, C: Colors): void {
  const { ctx, X, Y, s } = c,
    e = makeEsc(f.type),
    [px, py] = GEO.P,
    th = f.th,
    tr = (p: Pt): Pt => [
      px + p[0] * Math.cos(th) - p[1] * Math.sin(th),
      py + p[0] * Math.sin(th) + p[1] * Math.cos(th),
    ];
  const parts: Pt[][] = [],
    roots: Pt[] = [],
    tips: Pt[] = [];
  /* 外形を持つ型（リコイル式・ブロコ式）はそれを 1 枚の板として描く。吹き出しの位置は爪の中ほど */
  if (e.body) {
    parts.push(e.body);
    for (const p of e.pal) {
      const n = p.pts.length;
      tips.push([p.pts.reduce((a, q) => a + q[0], 0) / n, p.pts.reduce((a, q) => a + q[1], 0) / n]);
    }
  }
  for (let i = 0; i < 2 && !e.body; i++) {
    const sh = e.show[i],
      /* 面は 25 点。腕は面の 20 点目と、その向かいの裏の点の中ほどに付け、板と重ねて継ぎ目を消す */
      opp = e.pin
        ? sh[0]
        : sh
            .slice(25)
            .reduce(
              (b, p) =>
                Math.hypot(p[0] - sh[20][0], p[1] - sh[20][1]) < Math.hypot(b[0] - sh[20][0], b[1] - sh[20][1]) ? p : b,
              sh[25],
            ),
      root: Pt = e.pin ? e.pin[i].c : [(sh[20][0] + opp[0]) / 2, (sh[20][1] + opp[1]) / 2],
      L = Math.hypot(root[0], root[1]),
      wb = e.pin ? 1.2 : 2.6,
      wt = e.pin ? 0.9 : f.type === 'graham' ? 1.1 : 1.5,
      nx = -root[1] / L,
      ny = root[0] / L,
      side = i === 0 ? -1 : 1,
      /* ブロコ式の腕はまっすぐ、ほかは弓なり */
      bow = e.pin ? 0 : 2.2,
      mid: Pt = [root[0] / 2 + nx * bow * side, root[1] / 2 + ny * bow * side],
      band: Pt[] = [],
      back: Pt[] = [];
    roots.push(root);
    tips.push(e.pin ? e.pin[i].c : sh[0]);
    for (let k = 0; k <= 16; k++) {
      const t = k / 16,
        q: Pt = [2 * (1 - t) * t * mid[0] + t * t * root[0], 2 * (1 - t) * t * mid[1] + t * t * root[1]],
        dx = 2 * (1 - t) * mid[0] + 2 * t * (root[0] - mid[0]),
        dy = 2 * (1 - t) * mid[1] + 2 * t * (root[1] - mid[1]),
        dl = Math.hypot(dx, dy) || 1,
        hw = (wb + (wt - wb) * t) / 2;
      band.push([q[0] - (dy / dl) * hw, q[1] + (dx / dl) * hw]);
      back.push([q[0] + (dy / dl) * hw, q[1] - (dx / dl) * hw]);
    }
    parts.push([...band, ...back.reverse()]);
    if (!e.pin) parts.push(sh);
  }
  const path = (pts: readonly Pt[]) => {
    for (const [k, p] of pts.entries()) {
      const [x, y] = tr(p);
      if (k) ctx.lineTo(X(x), Y(y));
      else ctx.moveTo(X(x), Y(y));
    }
    ctx.closePath();
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const p of parts) path(p);
  /* 外形のない型（グラハム式）は支点のボスを足す */
  if (!e.body)
    circ(
      ctx,
      (x) => X(px + x),
      (y) => Y(py + y),
      s,
      0,
      0,
      2.6,
    );
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = C.steel2;
  ctx.fill('nonzero');
  /* 爪（歯が当たる所）は腕と色を分け、歯が当たっている間は赤く塗る */
  for (let i = 0; i < 2; i++) {
    const on = f.Fn[i] > 1e-4;
    ctx.beginPath();
    path(e.pal[i].pts);
    ctx.fillStyle = on ? C.hot : C.surface;
    ctx.strokeStyle = on ? C.hot : C.ink2;
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  circ(ctx, X, Y, s, px, py, 0.7);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.restore();
  c.hit({ id: 'anc', name: 'アンクル', sub: `${TYPES[f.type].name}・振り子と一緒に揺れる` }, { c: [px, py - 6], r: 9 });
  for (let i = 0; i < 2; i++)
    c.hit(
      {
        id: i ? 'palR' : 'palL',
        name: i ? '出爪' : '入爪',
        sub: f.Fn[i] > 1e-4 ? '歯が当たっている' : '歯から離れている',
      },
      { c: tr(tips[i]), r: 1.8 },
    );
}
/** 振り子。図の竿は 130 mm に縮める（計算は 248 mm）。振れの角は計算どおり */
function drawPendulum(c: Fit, f: Snap, C: Colors, full: boolean): void {
  const { ctx, X, Y, s } = c,
    [sx, sy] = GEO.SUS,
    th = f.th,
    Ld = 130,
    pt = (d: number): Pt => [sx + Math.sin(th) * d, sy - Math.cos(th) * d];
  ctx.save();
  ctx.lineCap = 'round';
  /*
   * 吊り台（裏の受けに留めた台）と、そこに挟んだ薄い吊りばね。振り子はばねの下の端から下がり、
   * ばねが曲がる所（挟み金の下の端、sy）が振れの支点になる
   */
  ctx.fillStyle = C.steel2;
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(X(sx - 4.5), Y(sy + 6.5), 9 * s, 3 * s);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.ink2;
  ctx.fillRect(X(sx - 1.6), Y(sy + 3.5), 3.2 * s, 3 * s);
  ctx.strokeStyle = C.steel;
  ctx.lineWidth = Math.max(1.2, 0.5 * s);
  ctx.beginPath();
  ctx.moveTo(X(sx), Y(sy + 0.5));
  ctx.lineTo(X(pt(6)[0]), Y(pt(6)[1]));
  ctx.stroke();
  /* 支点: ばねの曲がる所 */
  ctx.beginPath();
  circ(ctx, X, Y, s, sx, sy, 0.9);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = Math.max(1.4, 0.9 * s);
  ctx.beginPath();
  ctx.moveTo(X(pt(6)[0]), Y(pt(6)[1]));
  ctx.lineTo(X(pt(Ld)[0]), Y(pt(Ld)[1]));
  ctx.stroke();
  /* 竿受け: アンクルの軸から下へ伸び、竿をはさむ（機械の裏） */
  const [px, py] = GEO.P;
  ctx.strokeStyle = C.steel;
  ctx.lineWidth = Math.max(1.2, 0.8 * s);
  ctx.beginPath();
  ctx.moveTo(X(px), Y(py));
  ctx.lineTo(X(px + Math.sin(th) * 30), Y(py - Math.cos(th) * 30));
  ctx.stroke();
  /* 先の二股で竿をはさむ */
  const ux = Math.sin(th),
    uy = -Math.cos(th),
    nx = Math.cos(th),
    ny = Math.sin(th),
    ex = px + ux * 30,
    ey = py + uy * 30;
  ctx.beginPath();
  for (const k of [-1, 1]) {
    ctx.moveTo(X(ex), Y(ey));
    ctx.lineTo(X(ex + nx * 1.8 * k), Y(ey + ny * 1.8 * k));
    ctx.lineTo(X(ex + nx * 1.8 * k + ux * 3.5), Y(ey + ny * 1.8 * k + uy * 3.5));
  }
  ctx.stroke();
  c.hit(
    { id: 'crutch', name: '竿受け', sub: 'アンクルの軸から下り、先の二股で振り子の竿をはさむ' },
    { c: [ex, ey + 1.5], r: 3 },
  );
  const [bx, by] = pt(Ld);
  ctx.beginPath();
  ctx.arc(X(bx), Y(by), 22 * s, 0, TAU);
  ctx.fillStyle = C.inset;
  ctx.fill();
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(bx), Y(by), 15 * s, 0, TAU);
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (full)
    text(ctx, `${Math.abs(th / DEG).toFixed(1)}°`, X(bx), Y(by), {
      size: 15,
      mono: true,
      align: 'center',
      C,
      col: C.ink2,
    });
  ctx.restore();
  c.hit(
    { id: 'rod', name: '振り子の竿', sub: '長さ 248 mm（図は短く描く）' },
    { box: [Math.min(sx, bx) - 2, by + 22, Math.max(sx, bx) + 2, GEO.plate[1]] },
  );
  c.hit(
    { id: 'susp', name: '吊りばねと吊り台', sub: '薄い板ばねで振り子を吊る。ばねの曲がる所が振れの支点' },
    { c: [sx, sy + 3], r: 4 },
  );
  c.hit(
    { id: 'bob', name: '振り子のおもり', sub: `120 g・振り角 ±${f.A.toFixed(2)}°・ドラッグでつかむ` },
    { c: [bx, by], r: 22 },
  );
}

/* ===== 時打ち ===== */
/** ゴング: 鋼線を機械の後ろで渦巻きにしたもの。根元はゴングの台 */
/** over: 部品の上から点線で重ね、後ろに隠れた所も見せる */
function drawGong(c: Fit, f: Snap, C: Colors, over = false): void {
  const { ctx, X, Y, s } = c,
    b = GEO.gongBase,
    g = GEO.gongC,
    r0 = Math.hypot(b[0] - g[0], b[1] - g[1]),
    a0 = Math.atan2(b[1] - g[1], b[0] - g[0]),
    hit = f.hamT < 0.4,
    amp = hit ? 0.5 * Math.exp(-f.hamT / 0.12) * Math.sin(f.hamT * 2 * Math.PI * 60) : 0;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 260; i++) {
    const t = i / 260,
      r = r0 - 11 * t + amp * Math.sin(t * Math.PI * 3),
      a = a0 - t * 1.55 * TAU,
      x = X(g[0] + r * Math.cos(a)),
      y = Y(g[1] + r * Math.sin(a));
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  /* 裏板の外にあるので、打った直後のほかは細い破線。上から重ねるときは薄い点線 */
  if (over) {
    ctx.strokeStyle = hit ? C.hot : C.ink3;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.strokeStyle = hit ? C.hot : C.ink3;
  ctx.lineWidth = hit ? Math.max(1.5, 1.2 * s) : Math.max(1.2, 0.6 * s);
  if (!hit) ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  /* ゴングの台 */
  ctx.fillStyle = C.ink2;
  ctx.beginPath();
  ctx.roundRect(X(b[0] - 4), Y(b[1] + 3), 8 * s, 6 * s, 1.5 * s);
  ctx.fill();
  ctx.restore();
  c.hit({ id: 'gong', name: 'ゴング', sub: '鋼線 2.3 mm・長さ 1.4 m の渦巻き' }, { c: b, r: 6 });
}
/** レバー。halo: 後ろの部品の上を通るとき、まわりを背景の色で縁取って前にあることを示す */
function lever(c: Fit, C: Colors, pts: Pt[], w: number, col: string, halo = false): void {
  const { ctx, X, Y, s } = c;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const go = () => {
    ctx.beginPath();
    for (const [i, p] of pts.entries()) {
      if (i) ctx.lineTo(X(p[0]), Y(p[1]));
      else ctx.moveTo(X(p[0]), Y(p[1]));
    }
  };
  if (halo) {
    go();
    ctx.strokeStyle = C.screen;
    ctx.lineWidth = Math.max(5, w * s + 6);
    ctx.stroke();
  }
  go();
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = Math.max(2.5, w * s + 2);
  ctx.stroke();
  go();
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1.5, w * s);
  ctx.stroke();
  ctx.restore();
}
/** レバーの支点: レバーと同じ色の丸い座に、軸の黒い穴 */
function pivot(c: Fit, C: Colors, p: Pt, col: string): void {
  const { ctx, X, Y, s } = c;
  ctx.beginPath();
  circ(ctx, X, Y, s, p[0], p[1], 1.4);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  circ(ctx, X, Y, s, p[0], p[1], 0.5);
  ctx.fillStyle = C.ink;
  ctx.fill();
}
function pinDot(c: Fit, C: Colors, p: Pt, r: number, col = C.steel): void {
  const { ctx, X, Y, s } = c;
  ctx.beginPath();
  circ(ctx, X, Y, s, p[0], p[1], r);
  ctx.fillStyle = col;
  ctx.fill();
}
function strikeParts(c: Fit, f: Snap, C: Colors): void {
  const { ctx, X, Y, s } = c,
    lw = W.lw,
    cw = W.cw,
    ccw = f.s % 90;
  /* 止め車の切り欠きのカム: s が整数（止めた所）で切り欠きが止めの爪の向きに来る */
  const ca = arborAng(f, 'lw') + SK.detA + SK.cam.off,
    { R: cR, floor: cF, half } = SK.cam;
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * TAU,
      d = Math.abs(((t + Math.PI) % TAU) - Math.PI),
      r = d < half ? cF : cR,
      x = X(lw.c[0] + r * Math.cos(ca + t)),
      y = Y(lw.c[1] + r * Math.sin(ca + t));
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = C.surface;
  ctx.strokeStyle = C.st;
  ctx.lineWidth = 1.2;
  ctx.fill();
  ctx.stroke();
  /* 数取り車の溝: 尾の下に来た溝 p は角 tailA。数取り車は時計回りに回る */
  ctx.save();
  ctx.strokeStyle = C.st;
  ctx.lineWidth = 1.2;
  for (const p of SLOT) {
    const a = SK.tailA - ((ccw - p) * TAU) / 90,
      q0 = at(cw.c, cw.r + 0.3, a),
      q1 = at(cw.c, cw.r - SK.slot.depth, a);
    ctx.beginPath();
    ctx.moveTo(X(q0[0]), Y(q0[1]));
    ctx.lineTo(X(q1[0]), Y(q1[1]));
    ctx.stroke();
  }
  ctx.restore();
  /* 予告車の予告ピン */
  const wp = wPinAt(f.s);
  pinDot(c, C, wp, SK.wPin.r);
  /* ピン車のピン（ハンマーの尾を押す） */
  for (const p of hPinsAt(f.s)) pinDot(c, C, p, SK.hPin.r);
  /* 持ち上げレバー: 先を筒かなのピンに押されて上がる。G で止めレバーを押し、旗の指で予告ピンを止める */
  const phi = f.lift,
    rl = (p: Pt) => rotP(SK.L, p, phi),
    { G, Ft } = liftAt(phi),
    tip = rl(SK.tip);
  /* 止めレバー: 持ち上げレバーの G と数取り車の縁のうち、高く押すほうで上がる。爪は止め車の切り欠きへ、尾は溝へ */
  const psi = Math.max(lockByLift(phi), lockByRim(ccw)),
    rk = (p: Pt) => rotP(SK.K, p, -psi),
    tail = rk(SK.tail),
    det = rk(SK.det);
  /* 尾は同じ軸の裏板の外（数取り車の側）にあるので薄く描く */
  ctx.save();
  ctx.globalAlpha = 0.5;
  lever(c, C, [SK.K, tail], 1.0, C.st);
  pinDot(c, C, tail, SK.tailR, C.st);
  ctx.restore();
  lever(c, C, [SK.K, rk(SK.wpt), det], 1.0, C.st);
  pinDot(c, C, det, SK.detR, C.st);
  pivot(c, C, SK.K, C.st);
  /* 持ち上げレバーは止めレバーの手前の面にあり、裏へ出したピン G で止めレバーの腕を押す */
  lever(c, C, [tip, SK.L, G], 0.9, C.mw, true);
  lever(c, C, [SK.L, rl(SK.fk), rl(SK.F), Ft], 0.9, C.mw, true);
  pinDot(c, C, tip, SK.tipR, C.mw);
  pinDot(c, C, G, SK.gR, C.steel);
  pivot(c, C, SK.L, C.mw);
  const lockSub = psi > 0.01 ? '上がっている' : '尾が数取り車の溝に、爪が止め車の切り欠きに入っている';
  c.hit({ id: 'lock', name: '止めレバー', sub: lockSub }, { c: SK.K, r: 3 });
  c.hit({ id: 'lock', name: '止めレバー', sub: lockSub }, { c: det, r: 2 });
  c.hit({ id: 'lock', name: '止めレバー', sub: lockSub }, { c: tail, r: 2 });
  c.hit(
    { id: 'lift', name: '持ち上げレバー', sub: '筒かなのピンで上がり、正時と 30 分ちょうどに落ちる' },
    { c: SK.L, r: 3 },
  );
  c.hit({ id: 'lift', name: '持ち上げレバー', sub: '旗の指で予告ピンを止める' }, { c: Ft, r: 2 });
  c.hit({ id: 'lift', name: '持ち上げレバー', sub: 'ピンで止めレバーを押し上げる' }, { c: G, r: 2 });
  c.hit({ id: 'wpin', name: '予告ピン', sub: '予告の間は持ち上げレバーの旗で止まる' }, { c: wp, r: 1.5 });
  /* ハンマー: 尾をピン車のピンに押されて上がり、ピンが外れると落ちてゴングを打ち、少し戻って休む */
  let ha = hamAngle(f.s);
  const hit = HAM.hit;
  /* 外れてから 0.02 秒で落ちて当たり、0.015 秒触れてから、0.035 秒で休む位置へ戻る */
  if (f.hamT < 0.02) ha = HAM.max + (hit - HAM.max) * (f.hamT / 0.02);
  else if (f.hamT < 0.035) ha = hit;
  else if (f.hamT < 0.07) ha = hit * (1 - (f.hamT - 0.035) / 0.035);
  const rh = (p: Pt) => rotP(SK.H, p, -ha),
    head = rh(SK.head),
    htail = rh(SK.htail);
  lever(c, C, [htail, SK.H, head], 1.1, C.steel2);
  pinDot(c, C, htail, SK.htailR, C.steel2);
  pivot(c, C, SK.H, C.steel2);
  ctx.beginPath();
  ctx.ellipse(X(head[0]), Y(head[1]), SK.headR * s, SK.headR * s, 0, 0, TAU);
  ctx.fillStyle = C.ink2;
  ctx.fill();
  c.hit({ id: 'ham', name: 'ハンマー', sub: 'ピン車のピンで持ち上がり、外れるとゴングを打つ' }, { c: head, r: 3 });
  c.hit({ id: 'ham', name: 'ハンマー', sub: 'ピン車のピンで持ち上がり、外れるとゴングを打つ' }, { c: SK.H, r: 2.5 });
}
/** 風切り: 正面から見ると、軸のまわりに回る板 */
function drawFly(c: Fit, f: Snap, C: Colors): void {
  const { ctx, X, Y, s } = c,
    w = W.fly,
    a = arborAng(f, 'fly'),
    /* 1 秒に 4 回転より速いと、こまごとの羽の向きが飛んで逆に回って見える。ぶれた円盤だけを描く */
    fast = (f.sst === 'run' || f.sst === 'warn0') && 64 * f.sw > 4;
  ctx.save();
  if (fast) {
    ctx.beginPath();
    circ(ctx, X, Y, s, w.c[0], w.c[1], 6.5);
    ctx.fillStyle = C.stBg;
    ctx.fill();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = C.st;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const ux = Math.cos(a),
    uy = Math.sin(a),
    p = fast
      ? []
      : (
          [
            [-6.5, -0.8],
            [6.5, -0.8],
            [6.5, 0.8],
            [-6.5, 0.8],
          ] as Pt[]
        ).map(([l, h]) => [w.c[0] + ux * l - uy * h, w.c[1] + uy * l + ux * h] as Pt);
  ctx.beginPath();
  for (const [i, q] of p.entries()) {
    if (i) ctx.lineTo(X(q[0]), Y(q[1]));
    else ctx.moveTo(X(q[0]), Y(q[1]));
  }
  ctx.closePath();
  ctx.fillStyle = C.stBg;
  ctx.strokeStyle = C.st;
  ctx.lineWidth = 1.1;
  if (!fast) {
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  arbor(c, C, w, a, PH.fly.p);
  c.hit({ id: 'fly', name: '風切り', sub: '空気の抵抗で打つ速さを保つ・1 打ちで 64 回転' }, { c: w.c, r: 6.5 });
}
/** 表輪列（筒かな・日の裏車・筒車）と持ち上げのピン。前板の前にあるので線だけで重ねる */
function drawMotion(c: Fit, f: Snap, C: Colors): void {
  const { ctx, X, Y, s } = c,
    hand = Math.PI / 2 - TAU * ((minutesOf(f) % 60) / 60);
  ctx.save();
  for (const id of ['hw', 'mw', 'cannon']) {
    const w = W[id],
      ang = id === 'cannon' ? hand : id === 'mw' ? -hand * (12 / 36) : hand / 12;
    gearPath(ctx, X, Y, w.c[0], w.c[1], w.r, w.z ?? 1, ang + PH[id].w, w.m ?? 0.3);
    ctx.strokeStyle = C.mw;
    ctx.lineWidth = 1;
    ctx.setLineDash(id === 'hw' ? [3, 2] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    if (w.pin) {
      const pm = w.pin.m;
      gearPath(ctx, X, Y, w.c[0], w.c[1], (w.pin.z * pm) / 2, w.pin.z, ang, pm);
      ctx.fillStyle = C.mw;
      ctx.fill();
    }
  }
  ctx.beginPath();
  circ(ctx, X, Y, s, 0, 0, 4.6);
  ctx.strokeStyle = C.mw;
  ctx.lineWidth = 1;
  ctx.stroke();
  for (const off of [0, Math.PI]) pinDot(c, C, at([0, 0], SK.cPin.R, hand + SK.cPin.off + off), SK.cPin.r, C.mw);
  ctx.restore();
  c.hit({ id: 'mw', name: '日の裏車', sub: `36 歯・かな 10・1 回転 3 時間` }, { c: W.mw.c, r: W.mw.r });
  c.hit(
    { id: 'cannon', name: '筒かな', sub: '分針の軸・ピン 2 本で 30 分ごとに持ち上げレバーを押し上げる' },
    { c: [0, 0], r: 2.5 },
  );
  for (const off of [0, Math.PI])
    c.hit(
      { id: 'cannon', name: '筒かなのピン', sub: '持ち上げレバーの先を押し上げ、正時と 30 分に外れる' },
      { c: at([0, 0], SK.cPin.R, hand + SK.cPin.off + off), r: 1.4 },
    );
  c.hit({ id: 'hw', name: '筒車', sub: '時針の軸・40 歯・12 時間で 1 回転' }, { c: [0, 0], r: W.hw.r });
}

/* ===== 正面図 ===== */
/** 全体の範囲: 箱の裏板（ゴングと振り子のおもりまで） */
export const BOX = { full: [-68, -110, 72, 66] as const };
export interface FrontOpt {
  box?: readonly number[];
  /** 全体を映しているとき（札と振り角を出す） */
  full?: boolean;
  labels?: boolean;
  /** 表示中の範囲の枠（全体図） */
  lens?: readonly number[] | null;
  /** 指している部品の id */
  hl?: string | null;
  /** 台の揺れを図に出すか */
  shake?: boolean;
}
function drawHL(cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D, hl: string | null | undefined, C: Colors): void {
  if (!hl) return;
  ctx.save();
  ctx.strokeStyle = C.ch1;
  ctx.fillStyle = C.ch1;
  ctx.lineWidth = 2.5;
  for (const h of hitsOf(cv)) {
    if (h.id !== hl) continue;
    ctx.beginPath();
    if (h.t === 'r') ctx.rect(h.a[0] - 2, h.a[1] - 2, h.a[2] - h.a[0] + 4, h.a[3] - h.a[1] + 4);
    else ctx.arc(h.a[0], h.a[1], h.a[2] + 2, 0, TAU);
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  }
  ctx.restore();
}
export function drawFront(cv: HTMLCanvasElement, f: Snap, C: Colors, o: FrontOpt = {}): void {
  const box = o.box ?? BOX.full,
    c = fitBox(cv, box, 6, o.shake === false ? 0 : f.gx),
    { ctx, X, Y, s } = c,
    full = o.full ?? true;
  /* 裏板の輪郭（板は外して描く） */
  const [px0, py0, px1, py1] = GEO.plate;
  /* 箱の裏板: ゴングの台はここに留まる（機械の地板より大きい） */
  {
    const [bx0, by0, bx1, by1] = GEO.caseBack;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(X(bx0), Y(by1), (bx1 - bx0) * s, (by1 - by0) * s, 8 * s);
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 3, 2, 3]);
    ctx.stroke();
    ctx.restore();
    if (o.labels !== false && full)
      text(ctx, '箱の裏板', X(bx0 + 3), Y(by1 - 4), { size: 12, w: 600, C, align: 'left', col: C.ink3 });
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(X(px0), Y(py1), (px1 - px0) * s, (py1 - py0) * s, 6 * s);
  ctx.fillStyle = C.screen;
  ctx.fill();
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.restore();
  /* ゴングは機械の後ろ（箱の裏板）にある。板の上に描き、あとで部品の上から点線で重ねる */
  drawGong(c, f, C);
  drawWheel(c, f, W.cw, C);
  drawPendulum(c, f, C, full);
  for (const id of ['bar', 'sbar']) drawBarrel(c, f, W[id], C);
  for (const id of ['wi', 'w2', 'w3', 'si', 'pw', 'lw', 'ww']) drawWheel(c, f, W[id], C);
  drawFly(c, f, C);
  drawEsc(c, f, C);
  hiddenLines(c, f, C);
  strikeParts(c, f, C);
  drawAnchor(c, f, C);
  drawMotion(c, f, C);
  drawGong(c, f, C, true);
  if (o.labels !== false && full) {
    const lab = (str: string, x: number, y: number, al: CanvasTextAlign, col: string) =>
      text(ctx, str, X(x), Y(y), { size: 12, w: 600, C, align: al, col });
    lab('がんぎ車', GEO.E[0] + 15, GEO.E[1] + 9, 'left', C.go);
    lab('アンクル', GEO.P[0] + 6, GEO.P[1] + 5, 'left', C.ink2);
    lab('香箱', W.bar.c[0], W.bar.c[1] - 21.5, 'center', C.go);
    lab('香箱', W.sbar.c[0], W.sbar.c[1] - 21.5, 'center', C.st);
    lab('2 番車', W.w2.c[0] + 13, W.w2.c[1] - 13, 'left', C.go);
    lab('風切り', W.fly.c[0] - 8, W.fly.c[1] + 6, 'right', C.st);
    lab('数取り車', W.cw.c[0] - 4, W.cw.c[1] + W.cw.r + 4, 'center', C.st);
    lab('ハンマー', GEO.ham[0] - 2, GEO.ham[1] + 4, 'right', C.ink2);
    lab('ゴング', GEO.gongBase[0] - 6, GEO.gongBase[1], 'right', C.ink3);
    lab('振り子', GEO.SUS[0] + 26, -80, 'left', C.ink2);
  }
  if (o.lens) {
    const b = o.lens;
    ctx.save();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(X(b[0]), Y(b[3]), (b[2] - b[0]) * s, (b[3] - b[1]) * s);
    ctx.restore();
  }
  drawHL(cv, ctx, o.hl, C);
}

/* ===== 文字盤 ===== */
export function drawDial(cv: HTMLCanvasElement, f: Snap, C: Colors, wind: { T: boolean; S: boolean }): void {
  const c = fitBox(cv, [-62, -62, 62, 62], 4),
    { ctx, X, Y, s } = c;
  ctx.beginPath();
  circ(ctx, X, Y, s, 0, 0, 58);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (let k = 0; k < 60; k++) {
    const a = Math.PI / 2 - (k * TAU) / 60,
      r0 = k % 5 ? 52 : 49;
    ctx.beginPath();
    ctx.moveTo(X(r0 * Math.cos(a)), Y(r0 * Math.sin(a)));
    ctx.lineTo(X(54 * Math.cos(a)), Y(54 * Math.sin(a)));
    ctx.strokeStyle = k % 5 ? C.ink3 : C.ink;
    ctx.lineWidth = k % 5 ? 1 : 2;
    ctx.stroke();
  }
  for (let h = 1; h <= 12; h++) {
    const a = Math.PI / 2 - (h * TAU) / 12;
    text(ctx, String(h), X(41 * Math.cos(a)), Y(41 * Math.sin(a)), {
      size: Math.max(10, 8.5 * s),
      w: 600,
      align: 'center',
      C,
      halo: false,
    });
  }
  /* 巻き穴（4 時と 8 時のあたり） */
  for (const [id, key] of [
    ['bar', 'T'],
    ['sbar', 'S'],
  ] as const) {
    const p = W[id].c,
      on = wind[key];
    ctx.beginPath();
    circ(ctx, X, Y, s, p[0], p[1], 4.2);
    ctx.fillStyle = on ? C.hotBg : C.inset;
    ctx.fill();
    ctx.strokeStyle = on ? C.hot : C.line2;
    ctx.lineWidth = 1;
    ctx.stroke();
    const a = -(key === 'T' ? f.nT : f.nS) * TAU + Math.PI / 4;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const q = at(p, 1.9, a + (k * TAU) / 4);
      if (k) ctx.lineTo(X(q[0]), Y(q[1]));
      else ctx.moveTo(X(q[0]), Y(q[1]));
    }
    ctx.closePath();
    ctx.fillStyle = C.ink2;
    ctx.fill();
  }
  const mins = minutesOf(f),
    ma = Math.PI / 2 - TAU * ((mins % 60) / 60),
    ha = Math.PI / 2 - TAU * ((mins % 720) / 720),
    hand = (a: number, L: number, w: number) => {
      ctx.beginPath();
      ctx.moveTo(X(-8 * Math.cos(a)), Y(-8 * Math.sin(a)));
      ctx.lineTo(X(L * Math.cos(a)), Y(L * Math.sin(a)));
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
  hand(ha, 30, Math.max(3, 3.2 * s));
  hand(ma, 46, Math.max(2, 2.2 * s));
  ctx.beginPath();
  circ(ctx, X, Y, s, 0, 0, 2.6);
  ctx.fillStyle = C.ink;
  ctx.fill();
}

/* ===== 展開図: 軸を横に並べ、前板から裏板までの重なりを縦に見る（前板 z = 0、裏板 z = −26、文字盤 z = +9） ===== */
type Item = [
  'barrel' | 'wheel' | 'pin' | 'mwork' | 'hand' | 'escw' | 'anchor' | 'crutch' | 'cpin' | 'pins' | 'cam' | 'vane',
  number,
  number,
  number,
];
const SEC: Record<'go' | 'st', { id: string; name: string; items: Item[] }[]> = {
  go: [
    { id: 'bar', name: '香箱', items: [['barrel', -23, -4, 18]] },
    {
      id: 'wi',
      name: '中間車',
      items: [
        ['wheel', -20, -19, 10.8],
        ['pin', -21, -15, 3],
      ],
    },
    {
      id: 'w2',
      name: '2 番車',
      items: [
        ['wheel', -12, -11, 16],
        ['pin', -22, -18, 2.7],
        ['mwork', 1, 4, 1.9],
        ['hand', 6, 8, 0],
      ],
    },
    {
      id: 'w3',
      name: '3 番車',
      items: [
        ['wheel', -4.5, -3.5, 10.8],
        ['pin', -13, -10, 1.6],
      ],
    },
    {
      id: 'esc',
      name: 'がんぎ車',
      items: [
        ['escw', -9.5, -8.5, 12],
        ['pin', -5, -3, 0.9],
      ],
    },
    {
      id: 'anc',
      name: 'アンクル',
      items: [
        ['anchor', -7, -10, 6],
        ['crutch', -26.8, -28.6, 3],
      ],
    },
  ],
  st: [
    { id: 'sbar', name: '香箱', items: [['barrel', -23, -4, 18]] },
    {
      id: 'si',
      name: '中間車',
      items: [
        ['wheel', -20, -19, 9],
        ['pin', -21, -15, 2],
      ],
    },
    {
      id: 'pw',
      name: 'ピン車',
      items: [
        ['wheel', -16, -15, 9.6],
        ['pin', -20, -17, 3.6],
        ['cpin', -28, -26, 1.44],
        ['pins', -14.5, -13, 7.4],
      ],
    },
    {
      id: 'lw',
      name: '止め車',
      items: [
        ['wheel', -11, -10, 7],
        ['pin', -16, -14, 1.2],
        ['cam', -6, -4.5, 4],
      ],
    },
    {
      id: 'ww',
      name: '予告車',
      items: [
        ['wheel', -6.5, -5.5, 5.3],
        ['pin', -11, -9.5, 0.9],
      ],
    },
    {
      id: 'fly',
      name: '風切り',
      items: [
        ['vane', -24, -8, 6.5],
        ['pin', -7, -5.5, 0.66],
      ],
    },
  ],
};
export function drawSection(cv: HTMLCanvasElement, f: Snap, C: Colors, hl?: string | null): void {
  const gap = 15,
    cols: { id: string; name: string; items: Item[]; tr: 'go' | 'st'; x: number }[] = [];
  let x = 0;
  for (const tr of ['st', 'go'] as const) {
    const list = tr === 'st' ? [...SEC.st].reverse() : SEC.go;
    for (const a of list) {
      cols.push({ ...a, tr, x });
      x += gap;
    }
    x += gap * 0.9;
  }
  const xmax = x - gap * 1.9,
    c = fitBox(cv, [-12, -53, xmax + 12, 14], 6),
    { ctx, X, Y, s } = c;
  ctx.fillStyle = C.inset;
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  for (const [z, name] of [
    [0, '前板'],
    [-26, '裏板'],
  ] as const) {
    ctx.fillRect(X(-6), Y(z + 0.8), (xmax + 12) * s, 1.6 * s);
    ctx.strokeRect(X(-6), Y(z + 0.8), (xmax + 12) * s, 1.6 * s);
    text(ctx, name, X(-7), Y(z), { size: 12, C, align: 'right', col: C.ink3 });
  }
  ctx.fillStyle = C.surface;
  ctx.fillRect(X(-6), Y(10), (xmax + 12) * s, 1.2 * s);
  ctx.strokeRect(X(-6), Y(10), (xmax + 12) * s, 1.2 * s);
  text(ctx, '文字盤', X(-7), Y(9.4), { size: 12, C, align: 'right', col: C.ink3 });
  cols.forEach((a, idx) => {
    const [col, bg] = TR(C, a.tr),
      ang = a.id === 'anc' ? 0 : arborAng(f, a.id);
    ctx.strokeStyle = C.steel;
    ctx.lineWidth = Math.max(1, 0.7 * s);
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.id === 'w2' ? 8 : 0.8));
    ctx.lineTo(X(a.x), Y(-26.8));
    ctx.stroke();
    for (const [k, z0, z1, r] of a.items) {
      const zt = Math.max(z0, z1),
        zb = Math.min(z0, z1),
        hw = Math.min(r, gap * 0.46);
      if (k === 'hand') {
        ctx.fillStyle = C.ink;
        ctx.fillRect(X(a.x - hw - 3), Y(zt), (2 * hw + 6) * s, 0.8 * s);
        ctx.fillRect(X(a.x - 3), Y(zt - 1.4), 6 * s, 0.8 * s);
        continue;
      }
      const steel = k === 'pin' || k === 'cpin',
        ww = steel ? Math.min(r, 2.4) : hw;
      ctx.fillStyle = steel ? C.steel : k === 'mwork' ? C.mwBg : k === 'anchor' || k === 'crutch' ? C.steel2 : bg;
      ctx.strokeStyle = steel ? C.steel : k === 'mwork' ? C.mw : k === 'anchor' || k === 'crutch' ? C.ink2 : col;
      ctx.lineWidth = 1;
      ctx.fillRect(X(a.x - ww), Y(zt), 2 * ww * s, (zt - zb) * s);
      ctx.strokeRect(X(a.x - ww), Y(zt), 2 * ww * s, (zt - zb) * s);
      if (k === 'barrel' || k === 'wheel' || k === 'escw') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(X(a.x - ww), Y(zt), 2 * ww * s, (zt - zb) * s);
        ctx.clip();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.55;
        for (let i = 0; i < 6; i++) {
          const t = ang + (i * TAU) / 6;
          if (Math.sin(t) <= 0) continue;
          const xx = a.x - ww * Math.cos(t);
          ctx.beginPath();
          ctx.moveTo(X(xx), Y(zt));
          ctx.lineTo(X(xx), Y(zb));
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    /* 回転の印（白黒 4 分割の丸を軸と同じ角で回す）と 1 回転の長さ */
    const ly = idx % 2 ? -47 : -38.5,
      mx = X(a.x),
      my = Y(-31.5),
      ra = 2.3 * s;
    if (a.id !== 'anc') {
      for (let q = 0; q < 4; q++) {
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.arc(mx, my, ra, -ang + (q * Math.PI) / 2, -ang + ((q + 1) * Math.PI) / 2);
        ctx.closePath();
        ctx.fillStyle = q % 2 ? C.surface : col;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(mx, my, ra, 0, TAU);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(-f.th * 6);
      ctx.strokeStyle = C.ink2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-ra, 0);
      ctx.lineTo(ra, 0);
      ctx.stroke();
      ctx.restore();
    }
    text(ctx, a.name, X(a.x), Y(ly), { size: 12, w: 600, C, align: 'center', col: a.id === 'anc' ? C.ink2 : col });
    text(ctx, PERIOD[a.id] ?? '', X(a.x), Y(ly - 3.6), { size: 12, mono: true, C, align: 'center', col: C.ink3 });
    const w = W[a.id];
    c.hit(
      {
        id: a.id,
        name: a.id === 'anc' ? 'アンクル' : w.name,
        sub:
          a.id === 'anc'
            ? `${TYPES[f.type].name}・振り子と一緒に揺れる`
            : w.barrel
              ? `ゼンマイ 残り ${(a.id === 'bar' ? f.nT : f.nS).toFixed(1)} 回転`
              : subOf(w),
      },
      { box: [a.x - gap / 2, -50, a.x + gap / 2, 9] },
    );
  });
  const anc = cols.find((q) => q.id === 'anc');
  if (anc) text(ctx, '↓ 振り子', X(anc.x + 4), Y(-29), { size: 12, C, col: C.ink3 });
  drawHL(cv, ctx, hl, C);
}

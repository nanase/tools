/**
 * 変速機のページの図。f は Model.snap() の写し、prev は 1 コマ前の写し、C は色、o は表示の設定。
 * o: path は伝達経路の色、flow は伝達経路の点線、blur はモーションブラー、cut は遠心クラッチの拡大図、hl は強調する部品。
 * 描くたびに部品の当たり判定（画面の座標）を作り直し、hitsOf で引ける
 */
import { clamp, FC, FM, groove, POS, type Snap, SPEC } from './model';

const TAU = Math.PI * 2;
export const fmt = (x: number): string => Math.round(x).toLocaleString('en-US');

export interface Colors {
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  line2: string;
  surface: string;
  inset: string;
  bg: string;
  screen: string;
  grid: string;
  grid2: string;
  sink: string;
  ch1: string;
  ch2: string;
  accent: string;
  ledOff: string;
  pow: string;
  powBg: string;
  slip: string;
  fric: string;
  mono: string;
  sans: string;
  /** 文字の縁取りの色 */
  halo: string;
}
export interface View {
  path?: boolean;
  flow?: boolean;
  blur?: boolean;
  cut?: boolean;
  labels?: boolean;
  hl?: string | null;
}
/** 部品の当たり判定。t = 'r' は長方形 [x0, y0, x1, y1]、'c' は円環 [cx, cy, 外の半径, 内の半径] */
export interface Hit {
  id: string;
  name: string;
  sub: string;
  t: 'r' | 'c';
  a: [number, number, number, number];
}
const HITS = new WeakMap<HTMLCanvasElement, Hit[]>();
export const hitsOf = (cv: HTMLCanvasElement): Hit[] => HITS.get(cv) ?? [];

/** クラッチの状態の名前 */
export function cfLabel(f: Snap): string {
  const touch = f.rpm > SPEC.cfIn;
  if (touch && f.rpm - f.drpm > 30) return '接触（滑走）';
  if (touch && Math.abs(f.rpm - f.drpm) <= 30) return '接触（伝達）';
  if (f.Tow < -0.05 || (f.drpm > 5 && f.drpm >= f.rpm - 5)) return 'ワンウェイ（伝達）';
  return '切断';
}
export function mpLabel(f: Snap): string {
  if (f.eng < 0.05) return '切断';
  if (Math.abs(f.drpm / SPEC.p - f.mrpm) > 15) return '接触（滑走）';
  return '接触（伝達）';
}
export function readColors(): Colors {
  const g = getComputedStyle(document.documentElement),
    v = (n: string, d: string) => g.getPropertyValue(n).trim() || d;
  const bg = v('--bg', '#e9ebe7');
  return {
    ink: v('--ink', '#15191c'),
    ink2: v('--ink-2', '#48505a'),
    ink3: v('--ink-3', '#687078'),
    line: v('--line', '#d5d9d3'),
    line2: v('--line-2', '#abb2aa'),
    surface: v('--surface', '#fafbf8'),
    inset: v('--inset', '#f0f2ed'),
    bg,
    screen: v('--screen', '#f6f7f2'),
    grid: v('--grid', '#dde1d8'),
    grid2: v('--grid-2', '#b3baad'),
    sink: v('--screen-ink', '#4a535a'),
    ch1: v('--ch1', '#9a6c00'),
    ch2: v('--ch2', '#0a6e8a'),
    accent: v('--accent', '#bf4308'),
    ledOff: v('--led-off', '#b3b9b2'),
    pow: v('--tm-pow', '#b8322a'),
    powBg: v('--tm-pow-bg', '#f3d9d4'),
    slip: v('--tm-slip', '#9a6c00'),
    fric: v('--tm-fric', '#8a6a4a'),
    mono: v('--mono', 'monospace'),
    sans: v('--sans', 'sans-serif'),
    halo: bg,
  };
}
/** 部品の名前から、図をまたいで共通の ID を決める */
function idOf(name: string): string {
  const g = name.match(/^(メイン|カウンター)シャフトの (\d) 速ギア/);
  if (g) return (g[1] === 'メイン' ? 'M' : 'C') + g[2];
  const fk = name.match(/（(M2|C3) 用）/);
  if (fk) return `fork${fk[1]}`;
  const tab: [string, string][] = [
    ['クランク', 'crank'],
    ['遠心クラッチのドラム', 'drum'],
    ['クラッチシュー', 'shoe'],
    ['ワンウェイ', 'ow'],
    ['プライマリドライブギア', 'p19'],
    ['クラッチアウター', 'co65'],
    ['多板クラッチ', 'plates'],
    ['ドライブスプロケット', 'sp14'],
    ['ドリブンスプロケット', 'sp38'],
    ['チェーン', 'chain'],
  ];
  for (const [k, v] of tab) if (name.startsWith(k)) return v;
  return name;
}
/** 指している部品を黄色で囲む */
function drawHL(cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D, hl: string | null | undefined, C: Colors): void {
  if (!hl) return;
  ctx.save();
  ctx.strokeStyle = C.ch1;
  ctx.lineWidth = 2.5;
  ctx.fillStyle = C.ch1;
  for (const h of hitsOf(cv)) {
    if (h.id !== hl) continue;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    if (h.t === 'r') ctx.rect(h.a[0] - 2, h.a[1] - 2, h.a[2] - h.a[0] + 4, h.a[3] - h.a[1] + 4);
    else {
      ctx.arc(h.a[0], h.a[1], h.a[2] + 2, 0, TAU);
      if (h.a[3] > 0) {
        ctx.moveTo(h.a[0] + Math.max(0, h.a[3] - 2), h.a[1]);
        ctx.arc(h.a[0], h.a[1], Math.max(0, h.a[3] - 2), 0, TAU, true);
      }
    }
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    ctx.stroke();
  }
  ctx.restore();
}
/** キャンバスの解像度を CSS の大きさと画素比に合わせ、消して 2D の文脈を返す */
function prep(cv: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; W: number; H: number } {
  const dpr = window.devicePixelRatio || 1,
    W = cv.clientWidth,
    H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2d context');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}
interface Fit {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  s: number;
  sx: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  hits: Hit[];
  hR: (name: string, sub: string, x0: number, y0: number, x1: number, y1: number) => void;
  hC: (name: string, sub: string, cx: number, cy: number, r1: number, r0?: number) => void;
}
/** 世界座標の箱 [x0, y0, x1, y1] をキャンバスの中央に置く（kx は横の伸ばし） */
function fitBox(cv: HTMLCanvasElement, box: [number, number, number, number], pad = 6, kx = 1): Fit {
  const { ctx, W, H } = prep(cv);
  const [x0, y0, x1, y1] = box,
    s = Math.min((W - 2 * pad) / ((x1 - x0) * kx), (H - 2 * pad) / (y1 - y0)),
    sx = s * kx;
  const ox = (W - sx * (x1 - x0)) / 2 - sx * x0,
    oy = (H - s * (y1 - y0)) / 2 - s * y0;
  const hits: Hit[] = [];
  HITS.set(cv, hits);
  const X = (x: number) => ox + sx * x,
    Y = (y: number) => oy + s * y;
  /* 当たり判定: 長方形と円環（どちらも世界座標で渡す） */
  const hR = (name: string, sub: string, a0: number, b0: number, a1: number, b1: number) =>
    hits.push({
      id: idOf(name),
      name,
      sub,
      t: 'r',
      a: [Math.min(X(a0), X(a1)), Math.min(Y(b0), Y(b1)), Math.max(X(a0), X(a1)), Math.max(Y(b0), Y(b1))],
    });
  const hC = (name: string, sub: string, cx: number, cy: number, r1: number, r0 = 0) =>
    hits.push({ id: idOf(name), name, sub, t: 'c', a: [X(cx), Y(cy), r1 * s, r0 * s] });
  return { ctx, W, H, s, sx, X, Y, hits, hR, hC };
}
interface TextOpt {
  size?: number;
  w?: number;
  col?: string;
  align?: CanvasTextAlign;
  base?: CanvasTextBaseline;
  mono?: boolean;
  halo?: boolean;
  C: Colors;
}
function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, o: TextOpt): void {
  const { size = 13, w = 500, col, align = 'left', base = 'middle', mono = false, C, halo = true } = o;
  ctx.font = `${w} ${size}px ${mono ? C.mono : C.sans}`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if (halo) {
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = C.halo;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = col ?? C.ink;
  ctx.fillText(str, x, y);
}
/** 部品の状態: 動力の伝達・空転・停止 */
type St = 'pow' | 'spin' | 'stop';
const style = (C: Colors, st: St) =>
  st === 'pow'
    ? { f: C.powBg, s: C.pow, w: 2 }
    : st === 'spin'
      ? { f: C.surface, s: C.ink3, w: 1.2 }
      : { f: C.inset, s: C.line2, w: 1 };
const stName = (st: St) => (st === 'pow' ? '動力の伝達' : st === 'spin' ? '空転' : '停止');
const subOf = (st: St, rpm: number) => `${stName(st)}・${fmt(Math.abs(rpm))} rpm`;

/**
 * 回転の残像: dphi は 1 コマで回った角、per は模様の周期の角。draw(phi) を何回か重ねる。
 * 速すぎるときは smear で模様をぼかした輪にする
 */
function spun(
  ctx: CanvasRenderingContext2D,
  phi: number,
  dphi: number,
  per: number,
  draw: (ph: number) => void,
  smear: (() => void) | null,
  on: boolean,
): void {
  const a = Math.abs(dphi);
  if (!on || a < per * 0.18) {
    draw(phi);
    return;
  }
  if (a >= per * 1.5 && smear) {
    smear();
    /* 実際の回転は速すぎて止まって見えるので、回る向きへ 1 秒に模様 4 つ分だけ流れる模様を重ねる */
    ctx.globalAlpha = 0.55;
    draw(Math.sign(dphi) * (performance.now() / 1000) * per * 4);
    ctx.globalAlpha = 1;
    return;
  }
  const K = Math.min(9, Math.ceil(a / (per * 0.12)));
  for (let k = 0; k < K; k++) {
    ctx.globalAlpha = (0.25 + (0.75 * (k + 1)) / K) * Math.min(1, 2.2 / K);
    draw(phi - (dphi * (K - 1 - k)) / K);
  }
  ctx.globalAlpha = 1;
}

/** 白黒に 4 分割した丸（衝突試験のダミー人形の印のような）を部品と同じ角度で回す */
function rotMark(
  ctx: CanvasRenderingContext2D,
  C: Colors,
  cx: number,
  cy: number,
  ang: number,
  d: number,
  blur: boolean,
  r = 10,
): void {
  const draw = (ph: number) => {
    for (let q = 0; q < 4; q++) {
      ctx.fillStyle = q % 2 ? C.surface : C.ink;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, ph + (q * Math.PI) / 2, ph + ((q + 1) * Math.PI) / 2);
      ctx.closePath();
      ctx.fill();
    }
  };
  spun(
    ctx,
    -ang,
    -d,
    Math.PI,
    draw,
    () => {
      ctx.fillStyle = C.ink3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
    },
    blur,
  );
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
}
/** 横から見た回る部品の面に、回転とともに上下へ流れる線を n 本描く（溝のない部品でも回っているのが分かるように） */
function faceLines(
  c: Fit,
  x0: number,
  x1: number,
  cy: number,
  r: number,
  n: number,
  phi: number,
  dphi: number,
  col: string,
  blur: boolean,
): void {
  const { ctx, X, Y } = c;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.2;
  const draw = (ph: number) => {
    for (let k = 0; k < n; k++) {
      const a = ph + (k * TAU) / n;
      if (Math.sin(a) <= 0) continue;
      const y = cy - r * Math.cos(a);
      ctx.beginPath();
      ctx.moveTo(X(x0) + 1, Y(y));
      ctx.lineTo(X(x1) - 1, Y(y));
      ctx.stroke();
    }
  };
  spun(
    ctx,
    phi,
    dphi,
    TAU / n,
    draw,
    () => {
      ctx.globalAlpha *= 0.4;
      for (let y = cy - r; y <= cy + r; y += 2.5) {
        ctx.beginPath();
        ctx.moveTo(X(x0) + 1, Y(y));
        ctx.lineTo(X(x1) - 1, Y(y));
        ctx.stroke();
      }
      ctx.globalAlpha /= 0.4;
    },
    blur,
  );
}

/* ============ 展開図: 軸に沿って部品を並べる（右がクラッチ側で、車体の右） ============ */
const ROW = { e: 0, m: 73.5, c: 123.5 };
type Kind = 'free' | 'slide' | 'fix';
interface GearDef {
  k: string;
  g: number;
  x: [number, number];
  z: number;
  r: number;
  kind: Kind;
}
const MAIN: GearDef[] = [
  { k: 'M4', g: 4, x: [32, 41], z: 26, r: 26.0, kind: 'free' },
  { k: 'M2', g: 2, x: [47, 56], z: 20, r: 19.6, kind: 'slide' },
  { k: 'M3', g: 3, x: [62, 71], z: 20, r: 23.3, kind: 'free' },
  { k: 'M1', g: 1, x: [77, 86], z: 14, r: 14.3, kind: 'fix' },
];
const CNT: GearDef[] = [
  { k: 'C4', g: 4, x: [32, 41], z: 24, r: 24.0, kind: 'fix' },
  { k: 'C2', g: 2, x: [47, 56], z: 31, r: 30.4, kind: 'free' },
  { k: 'C3', g: 3, x: [62, 71], z: 23, r: 26.7, kind: 'slide' },
  { k: 'C1', g: 1, x: [77, 86], z: 35, r: 35.7, kind: 'free' },
];
const KIND: Record<Kind, string> = { free: '空転するギア', slide: 'スライドするギア', fix: '軸に固定のギア' };
const PATH_OF: Record<number, string[]> = {
  1: ['M1', 'C1', 'C3'],
  2: ['M2', 'C2', 'C3'],
  3: ['M2', 'M3', 'C3'],
  4: ['M2', 'M4', 'C4'],
};
const MESH_OF: Record<number, [string, string]> = {
  1: ['M1', 'C1'],
  2: ['M2', 'C2'],
  3: ['M3', 'C3'],
  4: ['M4', 'C4'],
};

function gearSide(
  c: Fit,
  x0: number,
  x1: number,
  cy: number,
  r: number,
  z: number,
  phi: number,
  dphi: number,
  st: St,
  C: Colors,
  blur: boolean | undefined,
): void {
  const { ctx, X, Y, s, sx } = c,
    ad = 1.6,
    sty = style(C, st);
  ctx.fillStyle = sty.f;
  ctx.strokeStyle = sty.s;
  ctx.lineWidth = sty.w;
  ctx.beginPath();
  ctx.rect(X(x0), Y(cy - r - ad), sx * (x1 - x0), s * 2 * (r + ad));
  ctx.fill();
  ctx.stroke();
  const pitch = TAU / z;
  ctx.strokeStyle = st === 'pow' ? C.pow : C.ink3;
  ctx.lineWidth = 1;
  const lines = (ph: number) => {
    for (let k = 0; k < z; k++) {
      const a = ph + k * pitch;
      if (Math.sin(a) <= 0) continue;
      const y = cy - (r + ad * 0.4) * Math.cos(a);
      ctx.beginPath();
      ctx.moveTo(X(x0) + 1, Y(y));
      ctx.lineTo(X(x1) - 1, Y(y));
      ctx.stroke();
    }
  };
  spun(
    ctx,
    phi,
    dphi,
    pitch,
    lines,
    () => {
      ctx.globalAlpha = 0.4;
      for (let y = cy - r; y <= cy + r; y += 2.2) {
        ctx.beginPath();
        ctx.moveTo(X(x0) + 1, Y(y));
        ctx.lineTo(X(x1) - 1, Y(y));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    blur !== false,
  );
}
export function drawSection(cv: HTMLCanvasElement, f: Snap, prev: Snap | null, C: Colors, o: View = {}): void {
  const c = fitBox(cv, [-62, -76, 184, 174], 4, cv.clientWidth < 600 ? 1 : 1.2),
    { ctx, X, Y, s, sx, hR } = c;
  const dA = (k: keyof Snap['ang']) => (prev ? f.ang[k] - prev.ang[k] : 0);
  const p = SPEC.p,
    eps = 0.25,
    PW = o.path !== false;
  const pw = (st: St): St => (st === 'pow' && !PW ? 'spin' : st);
  const cfOn = f.Tcf > eps,
    owOn = f.Tow < -0.05,
    drumPow = cfOn || owOn || Math.abs(f.Tmp) > eps;
  const mpOn = Math.abs(f.Tmp) > eps,
    path = f.gear > 0 && mpOn ? PATH_OF[f.gear] : [];
  const spinE = f.rpm > 5,
    spinD = f.drpm > 5,
    spinM = Math.abs(f.mrpm) > 5,
    spinC = f.crpm > 2;
  const engPow = f.Te > 0.3 && drumPow;
  /* 軸 */
  ctx.lineCap = 'round';
  const shaft = (x0: number, x1: number, y: number, on: boolean, pwr: boolean) => {
    ctx.strokeStyle = pwr && PW ? C.pow : on ? C.ink2 : C.line2;
    ctx.lineWidth = s * 5;
    ctx.beginPath();
    ctx.moveTo(X(x0), Y(y));
    ctx.lineTo(X(x1), Y(y));
    ctx.stroke();
  };
  const inPow = mpOn && f.gear > 0;
  shaft(-2, 176, ROW.e, spinE, engPow);
  shaft(24, 150, ROW.m, spinM, inPow);
  hR('メインシャフト', subOf(pw(inPow ? 'pow' : spinM ? 'spin' : 'stop'), f.mrpm), 24, ROW.m - 3, 150, ROW.m + 3);
  shaft(4, 92, ROW.c, spinC, inPow);
  hR('カウンターシャフト', subOf(pw(inPow ? 'pow' : spinC ? 'spin' : 'stop'), f.crpm), 4, ROW.c - 3, 92, ROW.c + 3);
  /* エンジン: シリンダー・ピストン・コンロッド・クランク・発電機 */
  const eSt = pw(spinE ? (engPow ? 'pow' : 'spin') : 'stop'),
    es = style(C, eSt);
  const rod = 44,
    pinOf = (th: number) => -12 * Math.cos(th),
    pisOf = (th: number) => pinOf(th) - Math.sqrt(rod * rod - (12 * Math.sin(th)) ** 2);
  /* エンジンはこのページの主役ではないので薄く描く。ピストンとコンロッドはクランクウェブより奥 */
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(X(55), Y(-68));
  ctx.lineTo(X(55), Y(-30));
  ctx.moveTo(X(81), Y(-68));
  ctx.lineTo(X(81), Y(-30));
  ctx.stroke();
  hR('シリンダー', '', 53, -68, 83, -30);
  /* ピストン・コンロッド・クランクピン: 1 コマで回った角の分だけ残像を重ねる */
  const piston = (th: number) => {
    const pinY = pinOf(th),
      pisY = pisOf(th);
    ctx.fillStyle = es.f;
    ctx.strokeStyle = es.s;
    ctx.lineWidth = es.w;
    ctx.beginPath();
    ctx.rect(X(56), Y(pisY - 8), sx * 24, s * 14);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = es.s;
    ctx.lineWidth = s * 3;
    ctx.beginPath();
    ctx.moveTo(X(68), Y(pisY));
    ctx.lineTo(X(68), Y(pinY));
    ctx.stroke();
    ctx.fillStyle = C.ink3;
    ctx.beginPath();
    ctx.rect(X(60), Y(pinY - 4), sx * 16, s * 8);
    ctx.fill();
  };
  spun(
    ctx,
    f.ang.e,
    dA('e'),
    TAU,
    piston,
    () => {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = es.s;
      ctx.beginPath();
      ctx.rect(X(56), Y(-64), sx * 24, s * 38);
      ctx.fill();
      ctx.fillStyle = C.ink3;
      ctx.beginPath();
      ctx.rect(X(60), Y(-16), sx * 16, s * 32);
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = es.s;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.rect(X(56), Y(-64), sx * 24, s * 38);
      ctx.stroke();
    },
    o.blur !== false,
  );
  ctx.fillStyle = es.f;
  ctx.strokeStyle = es.s;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.rect(X(0), Y(-44), sx * 20, s * 88);
  ctx.fill();
  ctx.stroke();
  hR('発電機のロータ', subOf(spinE ? 'spin' : 'stop', f.rpm), 0, -44, 20, 44);
  ctx.beginPath();
  ctx.rect(X(50), Y(-24), sx * 10, s * 48);
  ctx.rect(X(76), Y(-24), sx * 10, s * 48);
  ctx.fill();
  ctx.stroke();
  hR('クランクウェブ', subOf(eSt, f.rpm), 50, -24, 86, 24);
  /* 発電機のロータとクランクウェブの面の模様（回っているのが分かるように） */
  const bl = o.blur !== false;
  faceLines(c, 0, 20, 0, 40, 8, f.ang.e, dA('e'), es.s, bl);
  faceLines(c, 50, 60, 0, 20, 4, f.ang.e, dA('e'), es.s, bl);
  faceLines(c, 76, 86, 0, 20, 4, f.ang.e, dA('e'), es.s, bl);
  ctx.restore();
  hR('クランク軸', subOf(pw(engPow ? 'pow' : spinE ? 'spin' : 'stop'), f.rpm), -2, -3, 176, 3);
  {
    const th = f.ang.e;
    hR('ピストン', '燃焼の圧力を受ける', 56, pisOf(th) - 8, 80, pisOf(th) + 6);
    hR('コンロッド', 'ピストンとクランクをつなぐ', 65, pisOf(th), 71, pinOf(th));
  }
  /* 力の入口の札 */
  if (o.labels !== false) {
    text(ctx, '↓ エンジンの力', X(84), Y(-62), { size: 13, w: 700, C, col: PW && engPow ? C.pow : C.ink });
  }
  /* 1 次減速 19T と遠心クラッチ */
  const pSt = pw(drumPow && spinD ? (mpOn ? 'pow' : 'spin') : spinD ? 'spin' : 'stop');
  gearSide(c, 113, 123, ROW.e, 16.6, 19, f.ang.d, dA('d'), pSt, C, o.blur);
  hR('プライマリドライブギア 19T', subOf(pSt, f.drpm), 113, -18, 123, 18);
  const dSt = pw(spinD ? (drumPow ? 'pow' : 'spin') : 'stop'),
    ds = style(C, dSt);
  ctx.strokeStyle = ds.s;
  ctx.lineWidth = s * 2.4;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(X(176), Y(-48));
  ctx.lineTo(X(148), Y(-48));
  ctx.lineTo(X(148), Y(48));
  ctx.lineTo(X(176), Y(48));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(X(124), Y(-12));
  ctx.lineTo(X(148), Y(-12));
  ctx.moveTo(X(124), Y(12));
  ctx.lineTo(X(148), Y(12));
  ctx.stroke();
  hR('遠心クラッチのドラム', subOf(dSt, f.drpm), 146, -50, 177, -45);
  hR('遠心クラッチのドラム', subOf(dSt, f.drpm), 146, 45, 177, 50);
  hR('遠心クラッチのドラム', subOf(dSt, f.drpm), 145, -45, 150, 45);
  const open = clamp((f.rpm - 1500) / 500, 0, 1),
    ro = 41.5 + 4.6 * open;
  const cfl = cfLabel(f),
    shSt = pw(cfOn ? 'pow' : spinE ? 'spin' : 'stop'),
    ss = style(C, shSt);
  for (const sg of [-1, 1]) {
    ctx.fillStyle = ss.f;
    ctx.strokeStyle = ss.s;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(X(154), Y(sg > 0 ? ro - 7 : -ro), sx * 12, s * 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.fric;
    ctx.beginPath();
    ctx.rect(X(154), Y(sg > 0 ? ro - 1.6 : -ro), sx * 12, s * 1.6);
    ctx.fill();
    hR('クラッチシュー', `${cfl}・遠心力で外へ開く`, 154, sg > 0 ? ro - 7 : -ro, 166, sg > 0 ? ro : -ro + 7);
    if (cfl === '接触（滑走）') {
      const y0 = sg * 44.5,
        y1 = sg * 51;
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(152), Y(Math.min(y0, y1)), sx * 16, s * Math.abs(y1 - y0));
      ctx.clip();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = C.slip;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.slip;
      ctx.lineWidth = 2;
      for (let x = 146; x < 170; x += 2.6) {
        ctx.beginPath();
        ctx.moveTo(X(x), Y(y1));
        ctx.lineTo(X(x + 6), Y(y0));
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.fillStyle = style(C, eSt).f;
  ctx.strokeStyle = style(C, eSt).s;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.rect(X(167), Y(-40), sx * 5, s * 80);
  ctx.fill();
  ctx.stroke();
  faceLines(c, 167, 172, 0, 36, 6, f.ang.e, dA('e'), style(C, eSt).s, o.blur !== false);
  hR('ドライブプレート', `クランクと一体・${fmt(f.rpm)} rpm`, 167, -40, 172, 40);
  for (const sg of [-1, 1]) {
    const on = owOn && PW;
    ctx.fillStyle = on ? C.pow : C.surface;
    ctx.strokeStyle = on ? C.pow : C.ink3;
    ctx.beginPath();
    ctx.arc(X(151), Y(sg * 15), s * 2.4, 0, TAU);
    ctx.fill();
    ctx.stroke();
    hR('ワンウェイクラッチ', owOn ? '伝達・ドラムがクランクを回す' : '空転', 148, sg * 15 - 3, 154, sg * 15 + 3);
  }
  /* クラッチアウター 65T・多板クラッチ */
  const coSt = pw(spinD ? (mpOn ? 'pow' : 'spin') : 'stop');
  gearSide(c, 112, 124, ROW.m, 56.9, 65, -f.ang.d / p, -dA('d') / p, coSt, C, o.blur);
  hR('クラッチアウター 65T', subOf(coSt, f.drpm / p), 112, ROW.m - 58, 124, ROW.m + 58);
  const cs = style(C, coSt);
  ctx.strokeStyle = cs.s;
  ctx.lineWidth = s * 1.6;
  ctx.beginPath();
  ctx.moveTo(X(124), Y(ROW.m - 44));
  ctx.lineTo(X(141), Y(ROW.m - 44));
  ctx.moveTo(X(124), Y(ROW.m + 44));
  ctx.lineTo(X(141), Y(ROW.m + 44));
  ctx.stroke();
  const gap = (1 - f.eng) * 0.7,
    push = (1 - f.eng) * 4,
    mpl = mpLabel(f);
  for (let i = 0; i < 7; i++) {
    const x = 126 + i * 2 + i * gap,
      fr = i % 2 === 0;
    ctx.strokeStyle = mpOn && PW ? C.pow : fr ? C.fric : C.ink3;
    ctx.lineWidth = s * (fr ? 1.5 : 1.1);
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(X(x), Y(ROW.m + sg * (fr ? 43 : 20)));
      ctx.lineTo(X(x), Y(ROW.m + sg * (fr ? 24 : 39)));
      ctx.stroke();
    }
  }
  hR('多板クラッチ', `${mpl}・摩擦板 4 枚とクラッチ板 3 枚`, 125, ROW.m - 44, 140, ROW.m + 44);
  const pp = 141 + 6 * gap + push;
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = s * 2;
  ctx.beginPath();
  ctx.moveTo(X(pp), Y(ROW.m - 40));
  ctx.lineTo(X(pp), Y(ROW.m + 40));
  ctx.stroke();
  hR('プレッシャープレート', 'ばねで板を押しつける', pp - 1.5, ROW.m - 40, pp + 1.5, ROW.m + 40);
  ctx.fillStyle = f.eng < 0.99 ? C.ink : C.line2;
  ctx.beginPath();
  ctx.rect(X(pp + 2), Y(ROW.m - 6), sx * 6, s * 12);
  ctx.fill();
  hR(
    'クラッチリフター',
    f.eng < 0.99 ? 'ペダルで押して板を離す' : 'ペダルを踏むと押す',
    pp + 2,
    ROW.m - 6,
    pp + 8,
    ROW.m + 6,
  );
  /* 変速機 */
  const fo: Record<string, number> = { M2: -f.fm * 5, C3: -f.fc * 5 };
  const angOf: Record<string, number> = {
    M1: f.ang.m,
    M2: f.ang.m,
    M3: f.ang.M3,
    M4: f.ang.M4,
    C1: f.ang.C1,
    C2: f.ang.C2,
    C3: f.ang.c,
    C4: f.ang.c,
  };
  const dOf: Record<string, number> = {
    M1: dA('m'),
    M2: dA('m'),
    M3: dA('M3'),
    M4: dA('M4'),
    C1: dA('C1'),
    C2: dA('C2'),
    C3: dA('c'),
    C4: dA('c'),
  };
  const rpmOf: Record<string, number> = {
    M1: f.mrpm,
    M2: f.mrpm,
    M3: (f.crpm * 23) / 20,
    M4: (f.crpm * 24) / 26,
    C1: (f.mrpm * 14) / 35,
    C2: (f.mrpm * 20) / 31,
    C3: f.crpm,
    C4: f.crpm,
  };
  const rows: [number, GearDef[], string][] = [
    [ROW.m, MAIN, 'メインシャフト'],
    [ROW.c, CNT, 'カウンターシャフト'],
  ];
  for (const [row, list, sh] of rows)
    for (const g of list) {
      const off = fo[g.k] ?? 0,
        x0 = g.x[0] + off,
        x1 = g.x[1] + off;
      const st = pw(path.includes(g.k) ? 'pow' : Math.abs(rpmOf[g.k]) > 2 ? 'spin' : 'stop');
      const sgn = row === ROW.m ? 1 : -1;
      gearSide(c, x0, x1, row, g.r, g.z, angOf[g.k] * sgn, dOf[g.k] * sgn, st, C, o.blur);
      hR(
        `${sh}の ${g.g} 速ギア ${g.z}T`,
        `${KIND[g.kind]}・${stName(st)}・${fmt(Math.abs(rpmOf[g.k]))} rpm`,
        x0,
        row - g.r - 1.6,
        x1,
        row + g.r + 1.6,
      );
      if (g.kind === 'free') {
        ctx.setLineDash([3, 2]);
        ctx.strokeStyle = C.ink3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(X(x0 + 1), Y(row - 5.5), sx * (x1 - x0 - 2), s * 11);
        ctx.stroke();
        ctx.setLineDash([]);
        const sl = row === ROW.m ? MAIN[1] : CNT[2],
          side = g.x[0] > sl.x[0] ? -1 : 1,
          xf = side < 0 ? x0 : x1 - 3;
        ctx.fillStyle = C.bg;
        for (const yy of [-0.5, 0.5]) {
          ctx.beginPath();
          ctx.rect(X(xf), Y(row + yy * g.r - 2.8), sx * 3, s * 5.6);
          ctx.fill();
        }
      }
      if (g.kind === 'slide') {
        ctx.fillStyle = st === 'pow' ? C.pow : C.ink2;
        for (const sg of [-1, 1])
          for (const yy of [-0.5, 0.5]) {
            const xd = sg < 0 ? x0 - 4 : x1;
            ctx.beginPath();
            ctx.rect(X(xd), Y(row + yy * g.r - 2.5), sx * 4, s * 5);
            ctx.fill();
          }
        ctx.strokeStyle = C.ink2;
        ctx.lineWidth = s * 2.2;
        ctx.lineCap = 'round';
        const xm = (x0 + x1) / 2,
          top = row - g.r - 4;
        ctx.beginPath();
        ctx.moveTo(X(xm - 3), Y(top + 2));
        ctx.lineTo(X(xm - 3), Y(top - 2));
        ctx.lineTo(X(xm + 3), Y(top - 2));
        ctx.lineTo(X(xm + 3), Y(top + 2));
        ctx.moveTo(X(xm), Y(top - 2));
        ctx.lineTo(X(xm), Y(top - 9));
        ctx.stroke();
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(X(xm), Y(top - 10), s * 2, 0, TAU);
        ctx.fill();
        hR(`シフトフォーク（${g.k} 用）`, 'ドラムの溝に沿って動く', xm - 4, top - 13, xm + 4, top + 2);
      }
      if (o.labels !== false)
        text(
          ctx,
          `${g.z}`,
          X((x0 + x1) / 2),
          Y(row + (row === ROW.m ? -g.r - 2 : g.r + 2)) + (row === ROW.m ? -8 : 8),
          {
            size: 11,
            col: C.ink3,
            align: 'center',
            C,
            mono: true,
          },
        );
    }
  /* スプロケット 14T とチェーン */
  const spSt = pw(spinC ? (path.length ? 'pow' : 'spin') : 'stop');
  gearSide(c, 8, 15, ROW.c, 28.5, 14, -f.ang.c, -dA('c'), spSt, C, o.blur);
  hR('ドライブスプロケット 14T', subOf(spSt, f.crpm), 8, ROW.c - 30, 15, ROW.c + 30);
  const ch = (((f.ang.ch * 1000) % 12.7) + 12.7) % 12.7;
  ctx.strokeStyle = spSt === 'pow' ? C.pow : C.ink3;
  ctx.lineWidth = s * 1.6;
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(X(-6), Y(ROW.c + sg * 30));
    ctx.lineTo(X(8), Y(ROW.c + sg * 30));
    ctx.stroke();
  }
  hR('チェーン', `428・108 リンク・${(f.v * 3.6).toFixed(1)} km/h`, -8, ROW.c - 33, 8, ROW.c + 33);
  ctx.fillStyle = spSt === 'pow' ? C.pow : C.ink3;
  for (let k = -2; k < 2; k++) {
    const x = 6 - ch - k * 12.7 - 12.7;
    if (x < -8 || x > 8) continue;
    ctx.beginPath();
    ctx.arc(X(x), Y(ROW.c - 30), s * 1.6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(X(-x - 2), Y(ROW.c + 30), s * 1.6, 0, TAU);
    ctx.fill();
  }
  /* 流れの点線 */
  if (o.flow !== false && f.gear > 0 && mpOn) {
    const mesh = MESH_OF[f.gear],
      mg = MAIN.find((g) => g.k === mesh[0]) ?? MAIN[0];
    const xm = (mg.x[0] + mg.x[1]) / 2 + (fo[mg.k] ?? 0);
    const pts: [number, number][] = [
      [68, -56],
      [68, 0],
      [170, 0],
      [118, 0],
      [118, ROW.m],
      [134, ROW.m],
      [xm, ROW.m],
      [xm, ROW.c],
      [11, ROW.c],
      [-10, ROW.c],
    ];
    const seq = f.Tmp < 0 ? [...pts].reverse() : pts;
    ctx.save();
    ctx.strokeStyle = PW ? C.pow : C.ink;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -((performance.now() / 40) % 13);
    ctx.beginPath();
    seq.forEach(([x, y], i) => {
      if (i) ctx.lineTo(X(x), Y(y));
      else ctx.moveTo(X(x), Y(y));
    });
    ctx.stroke();
    ctx.restore();
    const head = (hx: number, hy: number, an: number, sz: number) => {
      ctx.beginPath();
      ctx.moveTo(hx + sz * 0.35 * Math.cos(an), hy + sz * 0.35 * Math.sin(an));
      ctx.lineTo(hx - sz * Math.cos(an - 0.42), hy - sz * Math.sin(an - 0.42));
      ctx.lineTo(hx - sz * 0.55 * Math.cos(an), hy - sz * 0.55 * Math.sin(an));
      ctx.lineTo(hx - sz * Math.cos(an + 0.42), hy - sz * Math.sin(an + 0.42));
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = PW ? C.pow : C.ink;
    for (let i = 1; i < seq.length; i++) {
      const [ax, ay] = seq[i - 1],
        [bx, by] = seq[i],
        last = i === seq.length - 1,
        L = Math.hypot(X(bx) - X(ax), Y(by) - Y(ay));
      if (L < 40 && !last) continue;
      const an = Math.atan2(Y(by) - Y(ay), X(bx) - X(ax));
      head(last ? X(bx) : (X(ax) + X(bx)) / 2, last ? Y(by) : (Y(ay) + Y(by)) / 2, an, last ? 17 : 13);
    }
  }
  if (o.labels !== false) {
    const lab = (y: number, name: string, rpm: number, k: 'e' | 'm' | 'c') => {
      text(ctx, name, X(-60), Y(y) - 10, { size: 12, col: C.ink3, C });
      const num = fmt(rpm);
      text(ctx, num, X(-60), Y(y) + 8, { size: 15, w: 700, mono: true, C });
      ctx.font = `700 15px ${C.mono}`;
      text(ctx, 'rpm', X(-60) + ctx.measureText(num).width + 4, Y(y) + 9, { size: 11, col: C.ink3, C, mono: true });
      /* メインシャフトはクランク・カウンターシャフトと逆の向きに回るので、印も逆に回す */
      const sg = k === 'm' ? -1 : 1;
      rotMark(ctx, C, X(-60) + 11, Y(y) + 32, sg * f.ang[k], sg * dA(k), o.blur !== false);
    };
    lab(ROW.e - 18, 'クランク', f.rpm, 'e');
    lab(ROW.m - 4, 'メインシャフト', f.mrpm, 'm');
    lab(ROW.c + 6, 'カウンターシャフト', f.crpm, 'c');
    text(ctx, '遠心クラッチ', X(162), Y(-52), { size: 12, col: C.ink2, align: 'center', C });
    text(ctx, '多板クラッチ', X(133), Y(ROW.m + 52), { size: 12, col: C.ink2, align: 'center', C });
    text(ctx, '19', X(118), Y(-20), { size: 11, col: C.ink3, align: 'center', C, mono: true });
    text(ctx, '65', X(118), Y(ROW.m + 62), { size: 11, col: C.ink3, align: 'center', C, mono: true });
    text(ctx, '14', X(11.5), Y(ROW.c + 37), { size: 11, col: C.ink3, align: 'center', C, mono: true });
    text(ctx, '← 後輪へ', X(11.5), Y(ROW.c - 38), { size: 12, col: C.ink3, align: 'center', C });
  }
  drawHL(cv, ctx, o.hl, C);
}

/* ============ 右から見た図: 遠心クラッチと噛み合い ============ */
const P_E: [number, number] = [0, 0],
  P_M: [number, number] = [-58, 45],
  P_C: [number, number] = [-74, 92.4];
function gearPath(
  ctx: CanvasRenderingContext2D,
  X: (x: number) => number,
  Y: (y: number) => number,
  cx: number,
  cy: number,
  r: number,
  z: number,
  phi: number,
): void {
  const m = (2 * r) / z,
    ra = r + m,
    rr = r - 1.25 * m,
    pa = TAU / z;
  const shape: [number, number][] = [
    [rr, -0.5],
    [rr, -0.29],
    [ra, -0.15],
    [ra, 0.15],
    [rr, 0.29],
    [rr, 0.5],
  ];
  ctx.beginPath();
  for (let k = 0; k < z; k++) {
    const a = phi + k * pa;
    for (const [rad, u] of shape) {
      const t = a + u * pa,
        x = cx + rad * Math.cos(t),
        y = cy + rad * Math.sin(t);
      if (k === 0 && u === -0.5) ctx.moveTo(X(x), Y(y));
      else ctx.lineTo(X(x), Y(y));
    }
  }
  ctx.closePath();
}
function meshPhase(phi1: number, z1: number, z2: number, c1: [number, number], c2: [number, number]): number {
  const a = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]);
  return -(z1 / z2) * (phi1 - a) + a + Math.PI + Math.PI / z2;
}
/** 歯車を残像つきで描く。速すぎるときは歯の帯をぼかした輪にする */
function gearBlur(
  c: Fit,
  C: Colors,
  cx: number,
  cy: number,
  r: number,
  z: number,
  phi: number,
  dphi: number,
  st: St,
  blur: boolean,
): void {
  const { ctx, X, Y, s } = c,
    y = style(C, st),
    m = (2 * r) / z;
  spun(
    ctx,
    phi,
    dphi,
    TAU / z,
    (ph) => {
      gearPath(ctx, X, Y, cx, cy, r, z, ph);
      ctx.fillStyle = y.f;
      ctx.strokeStyle = y.s;
      ctx.lineWidth = y.w;
      ctx.fill();
      ctx.stroke();
    },
    () => {
      ctx.fillStyle = y.f;
      ctx.strokeStyle = y.s;
      ctx.lineWidth = y.w;
      ctx.beginPath();
      ctx.arc(X(cx), Y(cy), s * (r - 1.25 * m), 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = s * 2.25 * m;
      ctx.beginPath();
      ctx.arc(X(cx), Y(cy), s * (r - 0.12 * m), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    blur,
  );
}
export function drawSide(cv: HTMLCanvasElement, f: Snap, prev: Snap | null, C: Colors, o: View = {}): void {
  const c = fitBox(cv, [-302, -74, 58, 192], 4),
    { ctx, X, Y, s, hR, hC } = c;
  const dA = (k: keyof Snap['ang']) => (prev ? f.ang[k] - prev.ang[k] : 0),
    PW = o.path !== false,
    pw = (st: St): St => (st === 'pow' && !PW ? 'spin' : st),
    blur = o.blur !== false;
  const eps = 0.25,
    cfOn = f.Tcf > eps,
    owOn = f.Tow < -0.05,
    mpOn = Math.abs(f.Tmp) > eps;
  const drumPow = cfOn || owOn || mpOn,
    spinD = f.drpm > 5,
    spinE = f.rpm > 5,
    cfl = cfLabel(f);
  /* チェーンと後ろのスプロケット（一部） */
  /* 後ろのスプロケットは実物（ピッチ円の半径 76.8 mm）より小さく描く */
  /* 前後とも歯の間隔 PCH で描く（実物より小さい）。チェーンの点は歯 2 枚に 1 つ */
  const PCH = 8.93,
    PR: [number, number] = [-212, 128],
    rS = (14 * PCH) / TAU,
    rR = (38 * PCH) / TAU,
    spSt = pw(f.crpm > 2 ? (f.gear > 0 && mpOn ? 'pow' : 'spin') : 'stop');
  const rwSt = f.v > 0.05 ? spSt : 'stop';
  gearBlur(c, C, PR[0], PR[1], rR, 38, f.ang.w, dA('w'), rwSt, blur);
  ctx.fillStyle = style(C, rwSt).f;
  ctx.strokeStyle = style(C, rwSt).s;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(X(PR[0]), Y(PR[1]), s * 10, 0, TAU);
  ctx.fill();
  ctx.stroke();
  hC('ドリブンスプロケット 38T', `後輪と一体・${subOf(rwSt, f.wrpm)}`, PR[0], PR[1], rR + 3);
  {
    /* 後輪の回転の印と回転数（ドリブンスプロケットの右下の空いた所） */
    const mx = X(PR[0] + rR * 0.95),
      my = Y(PR[1] + rR * 0.95);
    rotMark(ctx, C, mx, my, -f.ang.w, -dA('w'), blur); /* ドリブンスプロケットと同じ向きに回す */
    text(ctx, '後輪', mx + 16, my - 9, { size: 12, col: C.ink3, C });
    const num = fmt(f.wrpm);
    text(ctx, num, mx + 16, my + 8, { size: 15, w: 700, mono: true, C });
    ctx.font = `700 15px ${C.mono}`;
    text(ctx, 'rpm', mx + 16 + ctx.measureText(num).width + 4, my + 9, { size: 11, col: C.ink3, C, mono: true });
  }
  /* チェーン: 2 つのスプロケットの外側の接線 */
  const cdx = PR[0] - P_C[0],
    cdy = PR[1] - P_C[1],
    D = Math.hypot(cdx, cdy),
    base = Math.atan2(cdy, cdx),
    al = Math.acos((rS - rR) / D);
  const tg = (sg: number): [[number, number], [number, number]] => {
    const a = base + sg * al;
    return [
      [P_C[0] + rS * Math.cos(a), P_C[1] + rS * Math.sin(a)],
      [PR[0] + rR * Math.cos(a), PR[1] + rR * Math.sin(a)],
    ];
  };
  const top = tg(-1);
  /* 今のギアの組（N なら 1 速の組） */
  const g = f.gear || 1,
    pr = SPEC.pairs[g - 1],
    a = 50,
    rM = (a * pr.m) / (pr.m + pr.c),
    rC = (a * pr.c) / (pr.m + pr.c);
  const prSt = pw(f.gear > 0 && mpOn ? 'pow' : Math.abs(f.mrpm) > 5 || f.crpm > 2 ? 'spin' : 'stop');
  const phM = -f.ang.m,
    dM = -dA('m');
  gearBlur(c, C, P_M[0], P_M[1], rM, pr.m, phM, dM, prSt, blur);
  gearBlur(c, C, P_C[0], P_C[1], rC, pr.c, meshPhase(phM, pr.m, pr.c, P_M, P_C), (-dM * pr.m) / pr.c, prSt, blur);
  hC(`カウンターシャフトの ${g} 速ギア ${pr.c}T`, subOf(prSt, f.crpm), P_C[0], P_C[1], rC + 2, rS + 1);
  hC('ドライブスプロケット 14T', subOf(spSt, f.crpm), P_C[0], P_C[1], rS + 1);
  hC(`メインシャフトの ${g} 速ギア ${pr.m}T`, subOf(prSt, f.mrpm), P_M[0], P_M[1], rM + 2);
  /* ドライブスプロケット 14T（車体の左の端で歯車より奥）は輪郭だけ手前に描き、チェーンを巻く */
  const sy0 = style(C, spSt);
  spun(
    ctx,
    f.ang.c,
    dA('c'),
    TAU / 14,
    (ph) => {
      gearPath(ctx, X, Y, P_C[0], P_C[1], rS, 14, ph);
      ctx.strokeStyle = sy0.s;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    },
    () => {
      ctx.strokeStyle = sy0.s;
      ctx.lineWidth = s * 2.2;
      ctx.beginPath();
      ctx.arc(X(P_C[0]), Y(P_C[1]), s * rS, 0, TAU);
      ctx.stroke();
    },
    blur,
  );
  /* チェーンの輪: 上の直線 → 後ろのスプロケットの奥側 → 下の直線 → 前のスプロケットの奥側 */
  const loop: [number, number][] = [];
  const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    const n = Math.max(6, Math.ceil(((a1 - a0) * r) / 3));
    for (let i = 0; i <= n; i++) {
      const u = a0 + ((a1 - a0) * i) / n;
      loop.push([cx + r * Math.cos(u), cy + r * Math.sin(u)]);
    }
  };
  arcPts(PR[0], PR[1], rR, base - al, base + al);
  arcPts(P_C[0], P_C[1], rS, base + al, base - al + TAU);
  loop.push(loop[0]);
  const cum = [0];
  for (let i = 1; i < loop.length; i++)
    cum.push(cum[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
  const total = cum[cum.length - 1];
  ctx.strokeStyle = spSt === 'pow' ? C.pow : C.ink3;
  ctx.lineWidth = s * 3.2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [i, [x, y]] of loop.entries()) {
    if (i) ctx.lineTo(X(x), Y(y));
    else ctx.moveTo(X(x), Y(y));
  }
  ctx.stroke();
  hR(
    'チェーン',
    `${(f.v * 3.6).toFixed(1)} km/h`,
    top[1][0],
    Math.min(top[0][1], top[1][1]) - 4,
    top[0][0],
    Math.max(top[0][1], top[1][1]) + 4,
  );
  const at = (d: number): [number, number] => {
    let j = 1;
    while (j < cum.length - 1 && cum[j] < d) j++;
    const u = (d - cum[j - 1]) / Math.max(1e-9, cum[j] - cum[j - 1]);
    return [loop[j - 1][0] + (loop[j][0] - loop[j - 1][0]) * u, loop[j - 1][1] + (loop[j][1] - loop[j - 1][1]) * u];
  };
  const chain = (sh: number) => {
    ctx.fillStyle = C.surface;
    for (let d = ((sh % (2 * PCH)) + 2 * PCH) % (2 * PCH); d < total; d += 2 * PCH) {
      const [x, y] = at(d);
      ctx.beginPath();
      ctx.arc(X(x), Y(y), s * 1.1, 0, TAU);
      ctx.fill();
    }
  };
  spun(ctx, f.ang.c * rS, dA('c') * rS, 2 * PCH, chain, null, blur);
  /* クラッチアウター 65T（輪だけ）と 1 次減速 19T */
  const phD = f.ang.d,
    phCO = meshPhase(phD, 19, 65, P_E, P_M),
    coSt = pw(spinD ? (mpOn ? 'pow' : 'spin') : 'stop'),
    cy = style(C, coSt);
  const ring = (ph: number) => {
    gearPath(ctx, X, Y, P_M[0], P_M[1], 56.9, 65, ph);
    ctx.moveTo(X(P_M[0] + 46), Y(P_M[1]));
    ctx.arc(X(P_M[0]), Y(P_M[1]), s * 46, 0, TAU, true);
    ctx.fillStyle = cy.f;
    ctx.strokeStyle = cy.s;
    ctx.lineWidth = cy.w;
    ctx.fill('evenodd');
    ctx.stroke();
  };
  spun(
    ctx,
    phCO,
    (-dA('d') * 19) / 65,
    TAU / 65,
    ring,
    () => {
      ctx.strokeStyle = cy.s;
      ctx.fillStyle = cy.f;
      ctx.lineWidth = s * 11;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(X(P_M[0]), Y(P_M[1]), s * 52, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    blur,
  );
  hC('クラッチアウター 65T', subOf(coSt, f.drpm / SPEC.p), P_M[0], P_M[1], 59, 45);
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = mpOn && PW ? C.pow : C.ink3;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(X(P_M[0]), Y(P_M[1]), s * 40, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  const pSt = pw(spinD ? (mpOn ? 'pow' : 'spin') : 'stop');
  gearBlur(c, C, P_E[0], P_E[1], 16.6, 19, phD, dA('d'), pSt, blur);
  /* 遠心クラッチ: ドラム・シュー 3 個・ばね・ワンウェイのローラー */
  const dSt = pw(spinD ? (drumPow ? 'pow' : 'spin') : 'stop'),
    dy = style(C, dSt);
  ctx.strokeStyle = dy.s;
  ctx.lineWidth = s * 2.6;
  ctx.beginPath();
  ctx.arc(X(0), Y(0), s * 48, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  spun(
    ctx,
    f.ang.d,
    dA('d'),
    TAU / 8,
    (ph) => {
      for (let k = 0; k < 8; k++) {
        const t = ph + (k * TAU) / 8;
        ctx.beginPath();
        ctx.moveTo(X(49.3 * Math.cos(t)), Y(49.3 * Math.sin(t)));
        ctx.lineTo(X(53 * Math.cos(t)), Y(53 * Math.sin(t)));
        ctx.stroke();
      }
    },
    () => {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = s * 3.7;
      ctx.beginPath();
      ctx.arc(X(0), Y(0), s * 51.2, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    blur,
  );
  hC('遠心クラッチのドラム', subOf(dSt, f.drpm), 0, 0, 54, 46.5);
  const open = clamp((f.rpm - 1500) / 500, 0, 1),
    shSt = pw(cfOn ? 'pow' : spinE ? 'spin' : 'stop'),
    sy = style(C, shSt),
    sw = 0.09 * open,
    rp = 37;
  const shoes = (ph: number) => {
    for (let k = 0; k < 3; k++) {
      const t0 = ph + (k * TAU) / 3,
        pv = [rp * Math.cos(t0), rp * Math.sin(t0)];
      ctx.save();
      ctx.translate(X(pv[0]), Y(pv[1]));
      ctx.rotate(t0 + sw);
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const u = (i / 12) * 1.55,
          x = 46.3 * Math.cos(u) - rp,
          y = 46.3 * Math.sin(u);
        if (i) ctx.lineTo(s * x, s * y);
        else ctx.moveTo(s * x, s * y);
      }
      for (let i = 12; i >= 0; i--) {
        const u = (i / 12) * 1.55,
          x = 39 * Math.cos(u) - rp,
          y = 39 * Math.sin(u);
        ctx.lineTo(s * x, s * y);
      }
      ctx.closePath();
      ctx.fillStyle = sy.f;
      ctx.strokeStyle = sy.s;
      ctx.lineWidth = sy.w;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const u = (i / 12) * 1.55,
          x = 46.3 * Math.cos(u) - rp,
          y = 46.3 * Math.sin(u);
        if (i) ctx.lineTo(s * x, s * y);
        else ctx.moveTo(s * x, s * y);
      }
      ctx.strokeStyle = C.fric;
      ctx.lineWidth = s * 1.6;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = C.ink2;
      ctx.beginPath();
      ctx.arc(X(pv[0]), Y(pv[1]), s * 2.2, 0, TAU);
      ctx.fill();
      const t1 = t0 + 1.55 + sw,
        q0 = [35 * Math.cos(t1), 35 * Math.sin(t1)],
        t2 = ph + ((k + 1) * TAU) / 3 - 0.25,
        q1 = [33 * Math.cos(t2), 33 * Math.sin(t2)];
      ctx.strokeStyle = C.ink3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        const u = i / 10,
          x = q0[0] + (q1[0] - q0[0]) * u,
          y = q0[1] + (q1[1] - q0[1]) * u,
          n = i % 2 ? 1.8 : -1.8,
          nx = -(q1[1] - q0[1]),
          ny = q1[0] - q0[0],
          L = Math.hypot(nx, ny),
          e = i && i < 10;
        if (i) ctx.lineTo(X(x + (e ? (n * nx) / L : 0)), Y(y + (e ? (n * ny) / L : 0)));
        else ctx.moveTo(X(x), Y(y));
      }
      ctx.stroke();
    }
  };
  spun(
    ctx,
    f.ang.e,
    dA('e'),
    TAU / 3,
    shoes,
    () => {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = sy.s;
      ctx.lineWidth = s * 7.3;
      ctx.beginPath();
      ctx.arc(X(0), Y(0), s * (39 + 3.65 + sw * 30), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.fric;
      ctx.lineWidth = s * 1.6;
      ctx.beginPath();
      ctx.arc(X(0), Y(0), s * (45.5 + sw * 9), 0, TAU);
      ctx.stroke();
    },
    blur,
  );
  hC('クラッチシュー（3 個）', `${cfl}・遠心力で外へ開く`, 0, 0, 46.5, 36);
  ctx.fillStyle = style(C, spinE ? 'spin' : 'stop').f;
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(X(0), Y(0), s * 10, 0, TAU);
  ctx.fill();
  ctx.stroke();
  const owSh = owOn && PW;
  spun(
    ctx,
    f.ang.e,
    dA('e'),
    TAU / 6,
    (ph) => {
      for (let k = 0; k < 6; k++) {
        const t = ph + (k * TAU) / 6;
        ctx.fillStyle = owSh ? C.pow : C.surface;
        ctx.strokeStyle = owSh ? C.pow : C.ink3;
        ctx.beginPath();
        ctx.arc(X(12.5 * Math.cos(t)), Y(12.5 * Math.sin(t)), s * 1.6, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    },
    () => {
      ctx.strokeStyle = owSh ? C.pow : C.ink3;
      ctx.lineWidth = s * 3.2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(X(0), Y(0), s * 12.5, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    blur,
  );
  hC('ワンウェイクラッチ', owOn ? '伝達・ドラムがクランクを回す' : '空転', 0, 0, 15, 10);
  hC('クランク軸（エンジンの力の入口）', `${fmt(f.rpm)} rpm`, 0, 0, 10);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2;
  spun(
    ctx,
    f.ang.e,
    dA('e'),
    TAU,
    (ph) => {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      ctx.lineTo(X(8 * Math.cos(ph)), Y(8 * Math.sin(ph)));
      ctx.stroke();
    },
    null,
    blur,
  );
  hC('多板クラッチ', mpLabel(f), P_M[0], P_M[1], 43, 37);
  /* 遠心クラッチの拡大図（クランクと一緒に回るカメラ） */
  if (o.cut !== false) drawCut(c, f, prev, C, o);
  if (o.labels !== false) {
    text(ctx, '↓ エンジンの力', X(4), Y(-62), {
      size: 12,
      w: 700,
      align: 'right',
      col: PW && drumPow && f.Te > 0.3 ? C.pow : C.ink,
      C,
    });
    text(ctx, '遠心クラッチ', X(-48), Y(-48), { size: 12, col: C.ink2, align: 'right', C });
    text(ctx, f.gear ? `${f.gear} 速 ${pr.m}/${pr.c}` : 'N', X(P_C[0] + 40), Y(P_C[1] + 30), {
      size: 13,
      w: 700,
      col: prSt === 'pow' ? C.pow : C.ink2,
      C,
    });
    ctx.font = `700 13px ${C.sans}`;
    text(ctx, cfl, Math.min(X(36) + ctx.measureText(cfl).width / 2, c.W - 4), Y(54), {
      size: 13,
      w: 700,
      col: cfl !== '切断' ? C.pow : C.ink3,
      align: 'right',
      C,
    });
  }
  drawHL(cv, ctx, o.hl, C);
}
function drawCut(c: Fit, f: Snap, prev: Snap | null, C: Colors, o: View): void {
  const { ctx, X, Y, hits } = c;
  const bx = X(-300),
    by = Y(-72),
    bw = X(-118) - bx,
    bh = Y(54) - by;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = C.ink3;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + bw, by + bh * 0.35);
  ctx.lineTo(X(-42), Y(-16));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.screen;
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 5);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx + 1, by + 1, bw - 2, bh - 2);
  ctx.clip();
  /* クランクと一緒に回るカメラで見た遠心クラッチ。ドラムだけがクランクとの差で回る */
  const k = (bh * 0.62) / 50,
    cx = bx + bw * 0.6,
    cy = by + bh * 0.72,
    P = (r: number, a: number): [number, number] => [cx + k * r * Math.cos(a), cy + k * r * Math.sin(a)];
  const PW = o.path !== false,
    cfl = cfLabel(f),
    on = cfl.startsWith('接触'),
    blur = o.blur !== false;
  const dSt: St = f.drpm > 5 ? (on && PW ? 'pow' : 'spin') : 'stop',
    dy = style(C, dSt);
  ctx.strokeStyle = dy.s;
  ctx.lineWidth = k * 3;
  ctx.beginPath();
  ctx.arc(cx, cy, k * 49.5, 0, TAU);
  ctx.stroke();
  const rel = f.ang.d - f.ang.e,
    drel = prev ? f.ang.d - prev.ang.d - (f.ang.e - prev.ang.e) : 0;
  ctx.lineWidth = 1.6;
  spun(
    ctx,
    rel,
    drel,
    TAU / 12,
    (ph) => {
      for (let i = 0; i < 12; i++) {
        const a = ph + (i * TAU) / 12,
          [x0, y0] = P(51, a),
          [x1, y1] = P(55, a);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    },
    () => {
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = k * 4;
      ctx.beginPath();
      ctx.arc(cx, cy, k * 53, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    blur,
  );
  hits.push({ id: 'drum', name: '遠心クラッチのドラム', sub: subOf(dSt, f.drpm), t: 'c', a: [cx, cy, k * 56, k * 47] });
  /* シュー 3 個（止まって見える）・ばね・ハブ */
  const open = clamp((f.rpm - 1500) / 500, 0, 1),
    sw = 0.09 * open,
    rp = 37,
    sSt: St = on && PW ? 'pow' : f.rpm > 5 ? 'spin' : 'stop',
    sy = style(C, sSt);
  for (let i = 0; i < 3; i++) {
    const t0 = -Math.PI * 0.95 + (i * TAU) / 3,
      pv = P(rp, t0);
    ctx.save();
    ctx.translate(pv[0], pv[1]);
    ctx.rotate(t0 + sw);
    const arcPts = (r: number) => {
      const q: [number, number][] = [];
      for (let j = 0; j <= 14; j++) {
        const u = (j / 14) * 1.55;
        q.push([k * (r * Math.cos(u) - rp), k * r * Math.sin(u)]);
      }
      return q;
    };
    const outer = arcPts(46.3),
      inner = arcPts(39);
    ctx.beginPath();
    outer.forEach(([x, y], j) => {
      if (j) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    for (const [x, y] of [...inner].reverse()) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = sy.f;
    ctx.strokeStyle = sy.s;
    ctx.lineWidth = sy.w;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    outer.forEach(([x, y], j) => {
      if (j) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.strokeStyle = C.fric;
    ctx.lineWidth = k * 1.8;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.ink2;
    ctx.beginPath();
    ctx.arc(pv[0], pv[1], k * 2.4, 0, TAU);
    ctx.fill();
    const t1 = t0 + 1.55 + sw,
      q0 = P(35, t1),
      t2 = t0 + TAU / 3 - 0.25,
      q1 = P(33, t2);
    ctx.strokeStyle = C.ink3;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(q0[0], q0[1]);
    for (let j = 1; j < 10; j++) {
      const u = j / 10,
        nx = -(q1[1] - q0[1]),
        ny = q1[0] - q0[0],
        L = Math.hypot(nx, ny),
        n = (j % 2 ? 1 : -1) * k * 2;
      ctx.lineTo(q0[0] + (q1[0] - q0[0]) * u + (n * nx) / L, q0[1] + (q1[1] - q0[1]) * u + (n * ny) / L);
    }
    ctx.lineTo(q1[0], q1[1]);
    ctx.stroke();
  }
  hits.push({
    id: 'shoe',
    name: 'クラッチシュー（3 個）',
    sub: `${cfl}・遠心力で外へ開く`,
    t: 'c',
    a: [cx, cy, k * 47, k * 36],
  });
  ctx.fillStyle = C.surface;
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, k * 16, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, k * 9, 0, TAU);
  ctx.stroke();
  hits.push({
    id: 'crank',
    name: 'クランク軸（エンジンの力の入口）',
    sub: `${fmt(f.rpm)} rpm`,
    t: 'c',
    a: [cx, cy, k * 16, 0],
  });
  /* 上のシューに遠心力（外へ）とばねの力（内へ） */
  const ta = -Math.PI * 0.95 + 0.9,
    [ax, ay] = P(43, ta),
    ux = Math.cos(ta),
    uy = Math.sin(ta),
    fc = Math.min(1.7, (f.rpm / 2000) ** 2);
  const arrow = (x: number, y: number, len: number, col: string) => {
    const ex = x + ux * len,
      ey = y + uy * len,
      sg = Math.sign(len);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex + ux * sg * 7, ey + uy * sg * 7);
    ctx.lineTo(ex - uy * 4.5, ey + ux * 4.5);
    ctx.lineTo(ex + uy * 4.5, ey - ux * 4.5);
    ctx.fill();
  };
  arrow(ax - uy * 6, ay + ux * 6, 22 * fc, C.ch1);
  arrow(ax + uy * 6, ay - ux * 6, -16, C.ch2);
  ctx.restore();
  text(ctx, cfl, bx + 8, by + 14, { size: 13, w: 700, C, col: on ? C.pow : C.ink, halo: false });
  const gap = Math.max(0, 47 - (41.6 + 5.4 * open));
  text(
    ctx,
    on ? (cfl === '接触（滑走）' ? `差 ${fmt(f.rpm - f.drpm)} rpm` : '差 0 rpm') : `すき間 ${gap.toFixed(1)} mm`,
    bx + 8,
    by + 31,
    { size: 12, mono: true, C, col: C.ink2, halo: false },
  );
  const lx = bx + 8,
    ly = by + bh - 26;
  ctx.fillStyle = C.ch1;
  ctx.fillRect(lx, ly - 1, 12, 3);
  text(ctx, '遠心力', lx + 16, ly, { size: 11, C, col: C.ink2 });
  ctx.fillStyle = C.ch2;
  ctx.fillRect(lx, ly + 15, 12, 3);
  text(ctx, 'ばね', lx + 16, ly + 16, { size: 11, C, col: C.ink2 });
}

/* ============ ドラム: 溝の展開とペダル ============ */
export function drawDrum(cv: HTMLCanvasElement, f: Snap, C: Colors, o: View = {}): void {
  const { ctx, W, H } = prep(cv);
  const hits: Hit[] = [];
  HITS.set(cv, hits);
  const hit = (name: string, sub: string, x0: number, y0: number, x1: number, y1: number) =>
    hits.push({ id: idOf(name), name, sub, t: 'r', a: [x0, y0, x1, y1] });
  const short = W >= 300 && H < 330,
    L = 52,
    R = W - 12,
    T = 26,
    Hd = short ? Math.min(108, H * 0.46) : Math.min(170, H * 0.5),
    B = T + Hd;
  const xOf = (th: number) => L + ((R - L) * th) / 5;
  ctx.fillStyle = C.inset;
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(L, T, R - L, Hd);
  ctx.fill();
  ctx.stroke();
  for (let k = 0; k <= 5; k++) {
    const x = xOf(k);
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(x, T);
    ctx.lineTo(x, B);
    ctx.stroke();
    text(ctx, POS[k], x, T - 11, {
      size: 15,
      w: 700,
      align: 'center',
      mono: true,
      C,
      col: Math.round(f.base) % 5 === k % 5 && f.pedDir === 0 ? C.ink : C.ink3,
    });
  }
  const lanes = [
      { tab: FM, y: T + Hd * 0.3, v: f.fm, n: 'M2' },
      { tab: FC, y: T + Hd * 0.72, v: f.fc, n: 'C3' },
    ],
    amp = Hd * 0.14;
  const thM = f.th < 0 ? f.th + 5 : f.th;
  for (const ln of lanes) {
    ctx.strokeStyle = C.surface;
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const th = (i / 200) * 5,
        y = ln.y - amp * groove(ln.tab, th);
      if (i) ctx.lineTo(xOf(th), y);
      else ctx.moveTo(xOf(th), y);
    }
    ctx.stroke();
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(xOf(thM), ln.y - amp * ln.v, 5.5, 0, TAU);
    ctx.fill();
    text(ctx, ln.n, 8, ln.y, { size: 13, w: 700, C, mono: true });
    text(ctx, 'フォーク', 8, ln.y + 15, { size: 11, C, col: C.ink3 });
    hit(`シフトドラムの溝（${ln.n} 用）`, '溝の曲がりでフォークが横へ動く', L, ln.y - amp - 8, R, ln.y + amp + 8);
    hit(
      `シフトフォークのピン（${ln.n} 用）`,
      '溝に入って動く',
      xOf(thM) - 8,
      ln.y - amp * ln.v - 8,
      xOf(thM) + 8,
      ln.y - amp * ln.v + 8,
    );
  }
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(xOf(thM), T);
  ctx.lineTo(xOf(thM), B);
  ctx.stroke();
  ctx.setLineDash([]);
  const py = B + (short ? 24 : 34),
    pw = short ? (R - L) * 0.5 : R - L;
  text(ctx, 'ペダル', 8, py + 7, { size: 12, C, col: C.ink3 });
  ctx.fillStyle = C.inset;
  ctx.strokeStyle = C.line2;
  ctx.beginPath();
  ctx.rect(L, py, pw, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = f.pedDir ? C.ink : C.line2;
  ctx.beginPath();
  ctx.rect(L, py, pw * f.ped, 14);
  ctx.fill();
  ctx.strokeStyle = C.surface;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L + pw * 0.33, py);
  ctx.lineTo(L + pw * 0.33, py + 14);
  ctx.stroke();
  text(ctx, 'クラッチの切断', L + pw * 0.165, py + 28, {
    size: 11,
    align: 'center',
    C,
    col: f.ped > 0.05 && f.ped < 0.35 ? C.ink : C.ink3,
  });
  text(ctx, 'ドラムの回転', L + pw * 0.66, py + 28, {
    size: 11,
    align: 'center',
    C,
    col: f.ped >= 0.35 ? C.ink : C.ink3,
  });
  hit('チェンジペダルの踏み込み', '遊びの間に多板クラッチを切断・その先でドラムを回転', L, py - 4, L + pw, py + 34);
  text(ctx, f.pedDir > 0 ? '▲ シフトアップ' : f.pedDir < 0 ? '▼ シフトダウン' : '', L + pw, py - 10, {
    size: 12,
    w: 700,
    align: 'right',
    C,
  });
  const cy = short ? py + 10 : py + 78,
    cx = short ? L + pw + 50 : L + 40,
    rr = short ? Math.min(28, H - cy - 8) : Math.min(34, H - cy - 8);
  if (rr > 16) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-thM * TAU) / 5);
    ctx.fillStyle = C.surface;
    ctx.strokeStyle = C.ink2;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (k * TAU) / 10 - Math.PI / 2,
        r2 = k % 2 ? rr * 0.62 : rr;
      if (k) ctx.lineTo(r2 * Math.cos(a), r2 * Math.sin(a));
      else ctx.moveTo(r2 * Math.cos(a), r2 * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let k = 0; k < 5; k++) {
      const a = (k * TAU) / 5 - Math.PI / 2 + TAU / 10;
      ctx.fillStyle = C.ink3;
      ctx.beginPath();
      ctx.arc(rr * 0.45 * Math.cos(a), rr * 0.45 * Math.sin(a), 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    hit('シフトカム', '5 か所のくぼみで止まる', cx - rr, cy - rr, cx + rr, cy + rr);
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(cx, cy - rr * 0.62 - 5, 5, 0, TAU);
    ctx.fill();
    hit('ストッパー', 'ばねでくぼみに押しつける', cx - 8, cy - rr * 0.62 - 13, cx + 8, cy - rr * 0.62 + 3);
    text(ctx, 'ストッパー', cx + 14, cy - rr * 0.62 - 6, { size: 11, C, col: C.ink3 });
    const lock = f.blocked === 'lock',
      wide = !short && R - (cx + rr + 22) > 110,
      side = short && R - (cx + rr + 14) >= 100,
      lx = side ? cx + rr + 14 : short ? 14 : wide ? cx + rr + 22 : 14,
      ly = side ? cy - 4 : short ? py + 50 : wide ? cy + 8 : cy + rr + 14;
    ctx.fillStyle = lock ? C.accent : C.ledOff;
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, TAU);
    ctx.fill();
    text(ctx, 'ドラムロック', lx + 10, ly, { size: 12, w: lock ? 700 : 500, C, col: lock ? C.ink : C.ink3 });
    text(ctx, '走行中の 4↔N', lx + 10, ly + 17, { size: 11, C, col: C.ink3 });
    hit('ドラムロックプレート', '走行中は 4 速と N の間を回らない', lx - 8, ly - 12, lx + 120, ly + 24);
  }
  drawHL(cv, ctx, o.hl, C);
}

/* ============ 回転数のグラフ ============ */
/** グラフの 1 点: 時刻・クランク・ドラム・メインシャフトの回転数 */
export interface GPt {
  t: number;
  rpm: number;
  drpm: number;
  mrpm: number;
}
interface GraphOpt {
  ymax?: number;
  t0?: number;
  t1?: number;
  span?: number;
  cursor?: number;
  bounds?: (number | null)[];
}
export function drawGraph(cv: HTMLCanvasElement, hist: readonly GPt[], C: Colors, o: GraphOpt = {}): void {
  const { ctx, W, H } = prep(cv);
  const L = 44,
    R = W - 8,
    T = 8,
    B = H - 22,
    ymax = o.ymax ?? 8000;
  ctx.fillStyle = C.screen;
  ctx.fillRect(L, T, R - L, B - T);
  const t1 = o.t1 ?? (hist.length ? hist[hist.length - 1].t : 0),
    t0 = o.t0 ?? t1 - (o.span ?? 6);
  const xOf = (t: number) => L + ((R - L) * (t - t0)) / (t1 - t0),
    yOf = (v: number) => B - ((B - T) * clamp(v, 0, ymax)) / ymax;
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let v = 0; v <= ymax; v += 2000) {
    ctx.beginPath();
    ctx.moveTo(L, yOf(v));
    ctx.lineTo(R, yOf(v));
    ctx.stroke();
    text(ctx, `${v / 1000}k`, L - 6, yOf(v), { size: 11, align: 'right', mono: true, C, col: C.ink3, halo: false });
  }
  const sp = t1 - t0,
    step = sp > 12 ? 2 : sp > 5 ? 1 : sp > 1.6 ? 0.5 : sp > 0.8 ? 0.2 : 0.1;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    ctx.beginPath();
    ctx.moveTo(xOf(t), T);
    ctx.lineTo(xOf(t), B);
    ctx.stroke();
    text(ctx, `${+t.toFixed(1)} s`, xOf(t), B + 11, {
      size: 11,
      align: 'center',
      mono: true,
      C,
      col: C.ink3,
      halo: false,
    });
  }
  const vis = hist.filter((h) => h.t >= t0 - 0.05 && h.t <= t1 + 0.05);
  ctx.fillStyle = C.slip;
  ctx.globalAlpha = 0.18;
  for (const h of vis)
    if (h.rpm > SPEC.cfIn && h.rpm - h.drpm > 30) ctx.fillRect(xOf(h.t) - 1, yOf(h.rpm), 2.5, yOf(h.drpm) - yOf(h.rpm));
  ctx.globalAlpha = 1;
  const line = (key: (h: GPt) => number, col: string, dash?: number[]) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash ?? []);
    ctx.beginPath();
    vis.forEach((h, i) => {
      if (i) ctx.lineTo(xOf(h.t), yOf(key(h)));
      else ctx.moveTo(xOf(h.t), yOf(key(h)));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line((h) => h.mrpm * SPEC.p, C.ink2, [5, 4]);
  line((h) => h.drpm, C.ch2);
  line((h) => h.rpm, C.ch1);
  if (o.cursor != null) {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xOf(o.cursor), T);
    ctx.lineTo(xOf(o.cursor), B);
    ctx.stroke();
  }
  if (o.bounds) {
    ctx.strokeStyle = C.grid2;
    ctx.setLineDash([2, 3]);
    for (const b of o.bounds)
      if (b != null && b > t0) {
        ctx.beginPath();
        ctx.moveTo(xOf(b), T);
        ctx.lineTo(xOf(b), B);
        ctx.stroke();
      }
    ctx.setLineDash([]);
  }
}

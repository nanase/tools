/**
 * 「MP3 のしくみ」の 7 工程。今の音と設定の実データ（1 グラニュールの途中経過）を描く。
 * 文は使わず、図の札と短い見出しで伝える
 */
import { minus } from '../../lib/format';
import { surface } from '../pcm/fig';
import type { Capture, Stats } from './encoder';
import { FS, SFB_L } from './encoder';
import { alpha, COL, clamp, label } from './fig';
import { LIN, tabOf } from './huffman';

export const STEPS: readonly (readonly [string, string])[] = [
  ['音の波', '短く区切る'],
  ['周波数に分ける', '576 本に'],
  ['聞こえない音を探す', 'マスキング'],
  ['量子化', '粗く丸める'],
  ['ハフマン符号', '短い符号に'],
  ['フレームに詰める', '決まった大きさ'],
  ['ローパスとビット', 'ビットの配分'],
];

/** ローパスの比較（なしと、あり） */
export interface LpPair {
  cut: number;
  none: Stats;
  with: Stats;
  nmrNone: number;
  nmrWith: number;
}
export interface StoryData {
  cap: Capture;
  stats: Stats;
  /** 原音の 1 チャンネル */
  x: Float32Array;
  dur: number;
  pair: LpPair | null;
  /** 比較に使うローパス [Hz] */
  cut: number;
}

const num = (v: number) => Math.round(v).toLocaleString('en-US');
const dB = (p: number) => 10 * Math.log10(p + 1e-14);
const kHz = (f: number) => Number((f / 1000).toFixed(1));
/** 1 本の線の周波数の幅 [Hz] */
const LINE_HZ = FS / 2 / 576;

function countAbove(c: Capture): number {
  let n = 0;
  for (let b = 0; b < c.lo.length - 1; b++) {
    const th = c.xmin[b] / Math.max(1, c.lo[b + 1] - c.lo[b]);
    for (let i = c.lo[b]; i < c.lo[b + 1]; i++) if (c.xr[i] * c.xr[i] > th) n++;
  }
  return n;
}
/** 高音を捨てて空いた分 [kbps] */
function freedKbps(p: LpPair, dur: number): number {
  let s = 0;
  /* sfb 21 は 16 kHz から上を 1 つにまとめるので、ローパスにかかる帯は減った分だけ数える */
  for (let k = 0; k < 22; k++)
    if (SFB_L[k + 1] * LINE_HZ > p.cut) s += Math.max(0, p.none.bandBits[k] - p.with.bandBits[k]);
  return s / dur / 1000;
}

/** 工程ごとの札（今の値を入れる） */
export function caption(i: number, d: StoryData | null): string {
  if (!d) return '';
  const c = d.cap;
  switch (i) {
    case 0:
      return '1 フレーム = 1,152 サンプル（26 ms）';
    case 1:
      return '32 帯域 → MDCT → 576 本の周波数';
    case 2:
      return `大きな音のそばの小さな音は聞こえない・閾値を超える線 ${countAbove(c)} / 576 本`;
    case 3:
      return `帯域ごとに丸めの粗さを変える・0 になった線 ${c.ix.reduce((a, v) => a + (v === 0 ? 1 : 0), 0)} / 576 本`;
    case 4:
      return `小さな値ほど短い符号・16 ビットなら 9,216 → ${num(c.bits)} ビット`;
    case 5:
      return `1 フレーム ${num(c.frameBytes)} バイト・余りは次のフレームへ（ビットリザーバ）`;
    default:
      if (!d.pair) return '計算中…';
      {
        const kb = freedKbps(d.pair, d.dur),
          nmr = `NMR ${minus(d.pair.nmrNone.toFixed(1))} → ${minus(d.pair.nmrWith.toFixed(1))} dB`;
        return kb < 1
          ? `捨てる高音にビットをほとんど使っていない・${nmr}`
          : `高音を捨てて空いた ${kb.toFixed(0)} kbps が低い帯域へ・${nmr}`;
      }
  }
}

/* ---------- 周波数の線の図（工程 2〜4） ---------- */
function lineGeom(W: number, H: number, small: boolean) {
  const L = small ? 2 : 44,
    R = small ? 2 : 12,
    top = small ? 3 : 14,
    bottom = small ? H - 3 : H - 26;
  return {
    L,
    R,
    top,
    bottom,
    x: (i: number) => L + (i / 576) * (W - L - R),
    y: (d: number) => top + (clamp(-d, 0, 100) / 100) * (bottom - top),
    w: Math.max(1, (W - L - R) / 576),
  };
}
type Geom = ReturnType<typeof lineGeom>;

function lineAxes(g: CanvasRenderingContext2D, W: number, G: Geom): void {
  g.lineWidth = 1;
  g.strokeStyle = COL.grid;
  for (const k of [0, 5, 10, 15, 20]) {
    const x = G.x((k * 1000) / LINE_HZ);
    g.beginPath();
    g.moveTo(x + 0.5, G.top);
    g.lineTo(x + 0.5, G.bottom);
    g.stroke();
    label(g, `${k} kHz`, x, G.bottom + 15, { al: k ? 'center' : 'left', mono: true, px: 11 });
  }
  for (let d = 0; d >= -100; d -= 25) {
    const y = Math.round(G.y(d)) + 0.5;
    g.beginPath();
    g.moveTo(G.L, y);
    g.lineTo(W - G.R, y);
    g.stroke();
    label(g, minus(String(d)), G.L - 6, y + 4, { al: 'right', mono: true, px: 11 });
  }
  label(g, 'dB', 4, G.top + 2, { mono: true, px: 11 });
}

function stepLine(
  g: CanvasRenderingContext2D,
  c: Capture,
  G: Geom,
  val: (b: number) => number,
  frac: number,
  col: string,
  lw: number,
): void {
  const end = Math.floor((c.lo.length - 1) * frac);
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.beginPath();
  for (let b = 0; b < end; b++) {
    const v = G.y(val(b));
    if (b) g.lineTo(G.x(c.lo[b]), v);
    else g.moveTo(G.x(c.lo[b]), v);
    g.lineTo(G.x(c.lo[b + 1]), v);
  }
  g.stroke();
}

function drawLines(
  g: CanvasRenderingContext2D,
  i: number,
  W: number,
  H: number,
  u: number,
  c: Capture,
  small: boolean,
): void {
  const G = lineGeom(W, H, small),
    bar = (k: number, d: number, col: string) => {
      const yy = G.y(d);
      g.fillStyle = col;
      g.fillRect(G.x(k), yy, G.w, G.bottom - yy);
    },
    band = new Int32Array(576),
    lines = new Float64Array(576);
  for (let b = 0; b < c.lo.length - 1; b++) for (let k = c.lo[b]; k < c.lo[b + 1]; k++) band[k] = b;
  for (let k = 0; k < 576; k++) lines[k] = dB(c.xr[k] * c.xr[k]);
  const thrB = (b: number) => dB(c.xmin[b] / Math.max(1, c.lo[b + 1] - c.lo[b]));
  if (!small) lineAxes(g, W, G);
  if (i === 1) {
    const n = small ? 576 : Math.floor(576 * clamp(u * 1.4, 0, 1));
    for (let k = 0; k < n; k++) bar(k, lines[k], COL.ch2);
    if (small) return;
    g.strokeStyle = alpha(COL.grid2, 0.6);
    g.lineWidth = 1;
    for (let sb = 1; sb < 32; sb++) {
      const x = G.x(sb * 18);
      g.beginPath();
      g.moveTo(x + 0.5, G.top);
      g.lineTo(x + 0.5, G.top + 7);
      g.stroke();
    }
    label(g, '上の目盛り = 32 帯域', G.L + 10, G.top + 22, { w: 700 });
    label(g, '線 1 本 = 周波数 1 つ', G.L + 10, G.top + 40, { w: 700 });
    return;
  }
  if (i === 2) {
    const q = small ? 1 : clamp(u * 1.5, 0, 1),
      reveal = 576 * q;
    for (let k = 0; k < 576; k++)
      bar(k, lines[k], k < reveal && lines[k] < thrB(band[k]) ? alpha(COL.ink3, 0.35) : COL.ch2);
    stepLine(g, c, G, thrB, q, COL.over, small ? 1 : 2);
    if (small) return;
    label(g, 'マスキングの閾値', G.x(120), G.y(thrB(band[120])) - 8, { w: 700, c: COL.over });
    label(g, '灰色 = 聞こえない線', W - G.R - 8, G.top + 18, { al: 'right', w: 700 });
    return;
  }
  /* 量子化: 丸めた値へ動かす */
  const m = small ? 1 : clamp((u - 0.1) * 1.8, 0, 1),
    qv = new Float64Array(576);
  for (let k = 0; k < 576; k++) qv[k] = c.ix[k] ** (4 / 3) * 2 ** ((c.gg - 210) / 4) * 2 ** (-0.5 * c.sf[band[k]]);
  for (let k = 0; k < 576; k++) bar(k, lines[k], alpha(COL.ink3, 0.3));
  for (let k = 0; k < 576; k++) {
    const a = Math.abs(c.xr[k]),
      v = a + (qv[k] - a) * m;
    if (v > 0) bar(k, dB(v * v), COL.ch2);
  }
  stepLine(g, c, G, thrB, 1, COL.over, small ? 1 : 2);
  if (small) return;
  const noise = new Float64Array(c.lo.length - 1);
  for (let b = 0; b < noise.length; b++) {
    let s = 0;
    for (let k = c.lo[b]; k < c.lo[b + 1]; k++) s += (Math.abs(c.xr[k]) - qv[k]) ** 2;
    noise[b] = s / Math.max(1, c.lo[b + 1] - c.lo[b]);
  }
  if (m > 0.3) stepLine(g, c, G, (b) => dB(noise[b]), m, COL.ch1, 2);
  label(g, '丸めた値', G.x(16), G.top + 14, { w: 700, c: COL.ch2 });
  label(g, '丸めた後の雑音', W - G.R - 8, G.y(-30), { al: 'right', w: 700, c: COL.ch1 });
  label(g, '閾値', W - G.R - 8, G.y(-46), { al: 'right', w: 700, c: COL.over });
}

/* ---------- 工程 1: 音の波 ---------- */
function drawWave(g: CanvasRenderingContext2D, W: number, H: number, u: number, d: StoryData, small: boolean): void {
  const L = small ? 2 : 44,
    R = small ? 2 : 12,
    X = d.x,
    F0 = d.cap.fr * 1152,
    stH = small ? H * 0.4 : H * 0.28,
    wy = stH / 2 + (small ? 2 : 14),
    pw = W - L - R,
    stp = X.length / pw;
  g.fillStyle = COL.ink3;
  for (let k = 0; k < pw; k++) {
    let lo = 1,
      hi = -1;
    for (let j = Math.floor(k * stp); j < Math.floor((k + 1) * stp); j += 16) {
      if (X[j] < lo) lo = X[j];
      if (X[j] > hi) hi = X[j];
    }
    g.fillRect(L + k, wy - hi * stH * 0.46, 1, Math.max(1, (hi - lo) * stH * 0.46));
  }
  const fx = L + (F0 / X.length) * pw,
    fw = Math.max(2, (1152 / X.length) * pw);
  g.fillStyle = COL.over;
  g.globalAlpha = small ? 1 : clamp(u * 3, 0, 1);
  g.fillRect(fx, wy - stH * 0.5, fw, stH);
  g.globalAlpha = 1;
  const y0 = small ? H * 0.46 : H * 0.36,
    y1 = small ? H - 2 : H - 24,
    mid = (y0 + y1) / 2,
    e = small ? 1 : clamp((u - 0.2) * 2, 0, 1);
  if (!small) {
    g.strokeStyle = COL.over;
    g.lineWidth = 1;
    g.globalAlpha = 0.55 * e;
    g.beginPath();
    g.moveTo(fx, wy + stH / 2);
    g.lineTo(L, y0);
    g.moveTo(fx + fw, wy + stH / 2);
    g.lineTo(W - R, y0);
    g.stroke();
    g.globalAlpha = 1;
  }
  let pk = 0.05;
  for (let j = 0; j < 1152; j++) pk = Math.max(pk, Math.abs(X[F0 + j] || 0));
  g.strokeStyle = COL.ink;
  g.lineWidth = small ? 1 : 1.4;
  g.beginPath();
  const nDraw = Math.floor(1152 * e);
  for (let j = 0; j < nDraw; j++) {
    const x = L + (j / 1152) * pw,
      v = mid - ((X[F0 + j] || 0) / pk) * (y1 - y0) * 0.46;
    if (j) g.lineTo(x, v);
    else g.moveTo(x, v);
  }
  g.stroke();
  if (small) return;
  const xm = L + pw / 2,
    nw = W < 520;
  g.strokeStyle = COL.grid2;
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(xm + 0.5, y0);
  g.lineTo(xm + 0.5, y1);
  g.stroke();
  g.setLineDash([]);
  label(g, nw ? 'グラニュール 1' : 'グラニュール 1（576 サンプル）', L + 4, y1 + 16);
  label(g, nw ? 'グラニュール 2' : 'グラニュール 2（576 サンプル）', xm + 4, y1 + 16);
  label(g, '音全体', L + 2, 11, { px: 12 });
  label(g, nw ? '1 フレーム' : '1 フレーム = 1,152 サンプル', Math.min(fx + fw + 6, W - R - (nw ? 70 : 180)), 11, {
    w: 700,
    c: COL.over,
  });
}

/* ---------- 工程 5: ハフマン符号 ---------- */
function drawHuffman(g: CanvasRenderingContext2D, W: number, H: number, u: number, c: Capture, small: boolean): void {
  const L = small ? 2 : 44,
    R = small ? 2 : 12,
    top = small ? 3 : 14,
    area = small ? H - 3 : H * 0.68,
    x = (i: number) => L + (i / 576) * (W - L - R),
    MAXB = 12,
    yb = (v: number) => area - (clamp(v, 0, MAXB) / MAXB) * (area - top),
    zones = [
      [0, c.c1, COL.ch2, '2 個ずつ'],
      [c.c1, c.end, COL.ch1, '0 と ±1 は 4 個ずつ'],
      [c.end, 576, COL.grid, 'すべて 0 は書かない'],
    ] as const;
  for (const [a, b, col] of zones) {
    if (b <= a) continue;
    g.fillStyle = alpha(col, 0.14);
    g.fillRect(x(a), top, x(b) - x(a), area - top);
  }
  const r = small ? 1 : clamp(u * 1.4, 0, 1),
    w = Math.max(1, (W - L - R) / 576);
  for (let k = 0; k < Math.floor(576 * r); k++) {
    g.fillStyle = k < c.c1 ? COL.ch2 : COL.ch1;
    g.fillRect(x(k), yb(c.lb[k]), w, area - yb(c.lb[k]));
  }
  if (small) return;
  for (const [a, b, , s] of zones) if (x(b) - x(a) > 52) label(g, s, x(a) + 4, top + 14, { px: 12, w: 700 });
  label(g, '1 本の線のビット', W - R - 4, area - 8, { al: 'right', px: 12 });
  const tag = W < 520 ? 96 : 110,
    by = area + 12,
    bh = 16,
    full = W - L - R - tag,
    b1 = full * Math.min(1, c.bits / 9216) * clamp((u - 0.2) * 2, 0, 1);
  g.fillStyle = COL.ink3;
  g.fillRect(L + tag, by, full, bh);
  g.fillStyle = COL.ch2;
  g.fillRect(L + tag, by + bh + 6, b1, bh);
  label(g, '16 ビットのまま', L + tag - 8, by + 12, { al: 'right', px: 12 });
  label(g, 'ハフマン符号', L + tag - 8, by + bh + 18, { al: 'right', px: 12 });
  label(g, '9,216', L + tag + full - 6, by + 12, { al: 'right', mono: true, c: '#fff', halo: COL.ink3 });
  label(g, num(c.bits), L + tag + b1 + 6, by + bh + 18, { mono: true, w: 700, c: COL.ink });
  /* 符号の実例: 最も短い符号・中くらい・最も長い符号 */
  if (!c.tables[0]) return;
  const T = tabOf(c.tables[0]),
    lin = LIN[c.tables[0]] || 0,
    seen = new Map<number, [number, number, string]>();
  for (let k = 0; k + 1 < Math.min(c.e0, 576); k += 2) {
    const a = lin && c.ix[k] > 14 ? 15 : c.ix[k],
      b = lin && c.ix[k + 1] > 14 ? 15 : c.ix[k + 1],
      id = (a << 4) | b;
    if (T.l[id]) seen.set(id, [a, b, T.c[id].toString(2).padStart(T.l[id], '0')]);
  }
  const list = [...seen.values()].sort((p, q) => p[2].length - q[2].length),
    pick = list.length > 3 ? [list[0], list[list.length >> 1], list[list.length - 1]] : list,
    ey = by + (bh + 6) * 2 + 18;
  let ex = L + tag;
  label(g, '値 → 符号', L + tag - 8, ey, { al: 'right', px: 12 });
  for (const [a, b, s] of pick) {
    const tx = `(${a}, ${b}) → ${s}`;
    label(g, tx, ex, ey, { mono: true, c: COL.ink, px: 12 });
    ex += g.measureText(tx).width + 22;
    if (ex > W - 140) break;
  }
}

/* ---------- 工程 6: フレーム ---------- */
function drawFrames(g: CanvasRenderingContext2D, W: number, H: number, u: number, d: StoryData, small: boolean): void {
  const c = d.cap,
    st = d.stats,
    L = small ? 2 : 44,
    R = small ? 2 : 12,
    K = small ? 3 : W < 620 ? 3 : 5,
    S = (W - L - R) / K;
  /* ビットリザーバがよく見える所を選ぶ */
  let fr0 = c.fr,
    peak = -1;
  for (let f = 2; f + K < st.res.length; f++)
    if (st.res[f] > peak) {
      peak = st.res[f];
      fr0 = f - 1;
    }
  const fb = c.frameBytes,
    side = st.sideBits / 8 / st.res.length,
    sc = S / fb,
    yA = small ? 8 : 30,
    hA = small ? 16 : 32,
    yB = yA + hA + (small ? 3 : 22),
    hB = small ? 12 : 32,
    prog = small ? K : clamp(u * 1.25, 0, 1) * K,
    mainSc = sc * (fb / (fb - side));
  for (let k = 0; k < K; k++) {
    const x = L + k * S,
      a = clamp(prog - k, 0, 1);
    g.globalAlpha = a > 0 ? 1 : 0.25;
    g.fillStyle = COL.inset;
    g.fillRect(x + 1, yA, S - 2, hA);
    g.strokeStyle = COL.line2;
    g.lineWidth = 1;
    g.strokeRect(x + 1.5, yA + 0.5, S - 3, hA - 1);
    g.fillStyle = COL.ink3;
    g.fillRect(x + 1, yA, Math.max(2, side * sc), hA);
    g.globalAlpha = 1;
    if (a <= 0) continue;
    const fr = fr0 + k,
      sx = x + side * sc - (st.res[fr] ?? 0) * mainSc,
      dx = Math.max(L, sx),
      wX = (st.frameMain[fr] ?? 0) * mainSc * a;
    g.fillStyle = k % 2 ? COL.ch1 : COL.ch2;
    g.fillRect(dx, yB, Math.max(0, Math.min(wX - (dx - sx), W - R - dx)), hB);
    if (small) continue;
    if (S > 70)
      label(g, `${num(st.frameMain[fr] ?? 0)} B`, dx + 5, yB + hB / 2 + 4, {
        mono: true,
        c: '#fff',
        halo: 'rgba(0,0,0,.35)',
        px: 11.5,
      });
    g.strokeStyle = alpha(COL.ink3, 0.7);
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x + side * sc, yA + hA);
    g.lineTo(dx, yB);
    g.stroke();
    g.setLineDash([]);
  }
  if (small) return;
  const nw = W < 620;
  label(
    g,
    nw ? 'フレーム' : `フレーム（灰色 = ヘッダーとサイド情報、1 秒に ${(FS / 1152).toFixed(1)} 個）`,
    L + 2,
    yA - 10,
    { w: 700 },
  );
  label(g, nw ? '中身' : '中身（破線 = 前のフレームの余りから入れる）', L + 2, yB + hB + 15, { w: 700 });
  const yC = yB + hB + 46,
    yD = H - 26,
    res = st.res,
    Nf = res.length,
    xf = (f: number) => L + (f / Math.max(1, Nf - 1)) * (W - L - R),
    yr = (v: number) => yD - (v / 511) * (yD - yC);
  if (yD - yC < 24) return;
  label(g, nw ? 'ビットリザーバの残り [B]' : 'ビットリザーバの残り [バイト]', L + 2, yC - 8, { w: 700 });
  g.strokeStyle = COL.grid;
  g.lineWidth = 1;
  for (const v of [0, 511]) {
    const yy = Math.round(yr(v)) + 0.5;
    g.beginPath();
    g.moveTo(L, yy);
    g.lineTo(W - R, yy);
    g.stroke();
    label(g, String(v), L - 6, yy + 4, { al: 'right', mono: true, px: 11 });
  }
  g.fillStyle = alpha(COL.ch2, 0.25);
  g.beginPath();
  g.moveTo(xf(0), yD);
  for (let f = 0; f < Nf; f++) g.lineTo(xf(f), yr(res[f]));
  g.lineTo(xf(Nf - 1), yD);
  g.closePath();
  g.fill();
  g.strokeStyle = COL.ch2;
  g.lineWidth = 2;
  g.beginPath();
  for (let f = 0; f < Nf; f++) {
    if (f) g.lineTo(xf(f), yr(res[f]));
    else g.moveTo(xf(f), yr(res[f]));
  }
  g.stroke();
  g.fillStyle = alpha(COL.ink, 0.16);
  g.fillRect(xf(fr0), yC, Math.max(3, xf(fr0 + K) - xf(fr0)), yD - yC);
  for (let s = 0; s <= Math.floor(d.dur); s += Math.max(1, Math.ceil(d.dur / 8)))
    label(g, `${s} s`, L + (s / d.dur) * (W - L - R), yD + 16, { al: s ? 'center' : 'left', mono: true, px: 11 });
}

/* ---------- 工程 7: ローパスとビット ---------- */
const FMIN = 40,
  FMAX = FS / 2;
function drawBits(g: CanvasRenderingContext2D, W: number, H: number, u: number, d: StoryData, small: boolean): void {
  const L = small ? 2 : 44,
    R = small ? 2 : 12,
    top = small ? 3 : 28,
    bottom = small ? H - 3 : H - 26,
    xf = (f: number) =>
      L + ((Math.log(clamp(f, FMIN, FMAX)) - Math.log(FMIN)) / (Math.log(FMAX) - Math.log(FMIN))) * (W - L - R),
    p = d.pair,
    toKb = (s: Stats) => Array.from(s.bandBits, (v) => v / d.dur / 1000),
    a = p ? toKb(p.none) : toKb(d.stats),
    b = p ? toKb(p.with) : a,
    mx = Math.max(...a, ...b),
    nice = [2, 5, 10, 20, 30, 40, 60, 80, 120, 160, 240].find((v) => v >= mx) ?? mx,
    y = (v: number) => bottom - (v / nice) * (bottom - top),
    e = small ? 1 : clamp((u - 0.15) * 1.6, 0, 1),
    ease = e * e * (3 - 2 * e);
  if (!small) {
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    for (const v of [0, nice / 2, nice]) {
      const yy = Math.round(y(v)) + 0.5;
      g.beginPath();
      g.moveTo(L, yy);
      g.lineTo(W - R, yy);
      g.stroke();
      label(g, String(v), L - 6, yy + 4, { al: 'right', mono: true, px: 11 });
    }
    label(g, 'kbps', 4, 14, { mono: true, px: 11 });
    for (const f of [100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = xf(f);
      g.beginPath();
      g.moveTo(x + 0.5, top);
      g.lineTo(x + 0.5, bottom);
      g.stroke();
      label(g, f >= 1000 ? `${f / 1000}k` : String(f), x, bottom + 15, { al: 'center', mono: true, px: 11 });
    }
    label(g, 'Hz', L - 6, bottom + 15, { al: 'right', mono: true, px: 11 });
  }
  for (let s = 0; s < 22; s++) {
    const x0 = xf(Math.max(FMIN, SFB_L[s] * LINE_HZ)),
      x1 = xf(SFB_L[s + 1] * LINE_HZ),
      w = Math.max(1, x1 - x0 - (small ? 1 : 2)),
      v = a[s] + (b[s] - a[s]) * ease;
    g.fillStyle = COL.ch2;
    g.fillRect(x0 + 1, y(v), w, bottom - y(v));
    if (p) {
      g.strokeStyle = COL.ink3;
      g.lineWidth = small ? 1 : 1.5;
      g.strokeRect(x0 + 1, y(a[s]), w, bottom - y(a[s]));
    }
  }
  const xc = xf(d.cut);
  g.strokeStyle = COL.ink;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(xc, top);
  g.lineTo(xc, bottom);
  g.stroke();
  if (small) return;
  label(g, `ローパス ${kHz(d.cut)} kHz`, xc - 8, top + 14, { al: 'right', w: 700, c: COL.ink });
  g.fillStyle = COL.ch2;
  g.fillRect(L + 2, 8, 14, 10);
  label(g, `ローパス ${kHz(d.cut)} kHz`, L + 21, 17, { px: 12 });
  g.strokeStyle = COL.ink3;
  g.lineWidth = 1.5;
  const lx = L + 21 + g.measureText(`ローパス ${kHz(d.cut)} kHz`).width + 16;
  g.strokeRect(lx, 8, 14, 10);
  label(g, 'ローパスなし', lx + 19, 17, { px: 12 });
}

/** 工程 i の図を描く。u は進み具合（0〜1） */
export function drawStory(c: HTMLCanvasElement, i: number, u: number, d: StoryData | null, small = false): void {
  const s = surface(c);
  if (!s) return;
  const { g, w: W, h: H } = s;
  g.clearRect(0, 0, W, H);
  if (!d) return;
  if (i === 0) drawWave(g, W, H, u, d, small);
  else if (i <= 3) drawLines(g, i, W, H, u, d.cap, small);
  else if (i === 4) drawHuffman(g, W, H, u, d.cap, small);
  else if (i === 5) drawFrames(g, W, H, u, d, small);
  else drawBits(g, W, H, u, d, small);
}

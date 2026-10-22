/**
 * 符号の地図（canvas）を描く。QR コードは地の色に依らず白地に描く（読み取れる色のまま見せるため）。
 * 区分の色は、この図と符号語の表だけで使う（信号色・LED の色とは別。style.css の --q-* の明るい地の値と同じ）
 */
import type { Encoded } from './encode';
import { MASKS, Role } from './spec';

/** 静かな余白（モジュール） */
export const QZ = 4;
export type Cat = 'h' | 'd' | 'p' | 'e';
const INK = '#15191c';
const COL = {
  paper: '#ffffff',
  /** まだ置いていないデータの領域 */
  empty: '#f3f4f0',
  fnLight: '#e9eae6',
  fmt: '#f6e7a8',
  rem: '#d9dbd6',
  bad: '#d1242f',
  cat: {
    h: ['#e4d8f3', '#5a2d91'],
    d: ['#d3e3f6', '#1d4f91'],
    p: ['#e6e6e2', '#5d625f'],
    e: ['#f8dcc4', '#8f3f06'],
  } as Record<Cat, [string, string]>,
};

/** 段の番号 */
export const STAGE = { text: 0, bits: 1, data: 2, ec: 3, place: 4, mask: 5, done: 6 } as const;

/** 置いた符号語の区分: 誤り訂正語は e、データ語はその先頭のビットの区切り（モードと文字数 h・データ d・終端と埋め草 p） */
export function catOf(q: Encoded, c: number): Cat {
  const s = q.src[c];
  if (s.ec) return 'e';
  const d = q.bk.sizes.slice(0, s.b).reduce((a, b) => a + b, 0) + s.i,
    bit = d * 8,
    sp = q.spans.find((x) => bit >= x.from && bit < x.to);
  return !sp ? 'p' : sp.k === 'mode' || sp.k === 'count' ? 'h' : sp.k === 'data' ? 'd' : 'p';
}

export interface MapState {
  q: Encoded;
  cats: Cat[];
  stage: number;
  /** 選んだ符号語（置く順の番号。−1 はなし） */
  sel: number;
  /** 汚した格子（汚すときだけ） */
  soil: Uint8Array | null;
  /** 直した符号語（汚すときだけ） */
  bad: ReadonlySet<number>;
}

/** 符号語の境目の線（モジュールの単位の線分 [x1, y1, x2, y2]）。only を渡すとその符号語の外周だけ */
export function cwEdges(q: Encoded, only?: ReadonlySet<number>): number[] {
  const n = q.n,
    at = q.cwAt,
    out: number[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const c = at[y * n + x];
      if (c < 0 || (only && !only.has(c))) continue;
      if (x === n - 1 || at[y * n + x + 1] !== c) out.push(x + 1, y, x + 1, y + 1);
      if (y === n - 1 || at[(y + 1) * n + x] !== c) out.push(x, y + 1, x + 1, y + 1);
      if (only) {
        if (x === 0 || at[y * n + x - 1] !== c) out.push(x, y, x, y + 1);
        if (y === 0 || at[(y - 1) * n + x] !== c) out.push(x, y, x + 1, y);
      } else {
        if (x === 0 || (at[y * n + x - 1] < 0 && at[y * n + x - 1] !== c)) out.push(x, y, x, y + 1);
        if (y === 0 || (at[(y - 1) * n + x] < 0 && at[(y - 1) * n + x] !== c)) out.push(x, y, x + 1, y);
      }
    }
  return out;
}

function stroke(
  ctx: CanvasRenderingContext2D,
  segs: number[],
  k: number,
  color: string,
  w: number,
  dash?: number[],
): void {
  if (!segs.length) return;
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    ctx.moveTo((segs[i] + QZ) * k, (segs[i + 1] + QZ) * k);
    ctx.lineTo((segs[i + 2] + QZ) * k, (segs[i + 3] + QZ) * k);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'square';
  ctx.setLineDash(dash ?? []);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 符号の地図を描く。k は 1 モジュールの画素数 */
export function drawMap(ctx: CanvasRenderingContext2D, k: number, s: MapState, edges: number[]): void {
  const { q, stage, soil } = s,
    n = q.n,
    role = q.frame.role,
    f = MASKS[q.mask],
    W = (n + 2 * QZ) * k;
  ctx.fillStyle = COL.paper;
  ctx.fillRect(0, 0, W, W);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        r = role[i];
      let col: string;
      if (soil) col = soil[i] ? INK : COL.paper;
      else if (stage >= STAGE.done) col = q.mods[i] ? INK : COL.paper;
      else if (r === Role.Format || r === Role.Version) col = COL.fmt;
      else if (r !== Role.Data) col = q.frame.fn[i] ? INK : COL.fnLight;
      else if (stage < STAGE.place) col = COL.empty;
      else {
        const c = q.cwAt[i],
          bit = stage === STAGE.mask ? q.base[i] ^ (f(x, y) ? 1 : 0) : q.base[i];
        col = c < 0 ? (bit ? '#8a8f8b' : COL.rem) : COL.cat[s.cats[c]][bit];
      }
      if (col === COL.paper) continue;
      ctx.fillStyle = col;
      ctx.fillRect((x + QZ) * k, (y + QZ) * k, k, k);
    }
  if (soil) {
    /* 元と違うモジュールに赤い枠 */
    ctx.strokeStyle = COL.bad;
    ctx.lineWidth = Math.max(1.5, k * 0.16);
    const o = ctx.lineWidth / 2;
    for (let i = 0; i < n * n; i++)
      if (soil[i] !== q.mods[i])
        ctx.strokeRect(((i % n) + QZ) * k + o, (Math.floor(i / n) + QZ) * k + o, k - 2 * o, k - 2 * o);
    if (s.bad.size) stroke(ctx, cwEdges(q, s.bad), k, COL.bad, Math.max(1.5, k * 0.12), [k * 0.5, k * 0.3]);
  } else if (stage === STAGE.place || stage === STAGE.mask)
    stroke(ctx, edges, k, 'rgba(21,25,28,.55)', Math.max(1, k * 0.07));
  if (s.sel >= 0 && (soil || (stage >= STAGE.place && stage < STAGE.done))) {
    const e = cwEdges(q, new Set([s.sel]));
    stroke(ctx, e, k, '#ffffff', Math.max(4, k * 0.42));
    stroke(ctx, e, k, INK, Math.max(2.5, k * 0.24));
  }
}

/** マスクの模様の小さな図（データの領域だけ、反転する所を濃く） */
export function drawMask(ctx: CanvasRenderingContext2D, k: number, q: Encoded, mk: number): void {
  const n = q.n,
    f = MASKS[mk],
    W = (n + 2) * k;
  ctx.fillStyle = COL.paper;
  ctx.fillRect(0, 0, W, W);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (q.frame.role[y * n + x] !== Role.Data) continue;
      ctx.fillStyle = f(x, y) ? '#5d625f' : COL.empty;
      ctx.fillRect((x + 1) * k, (y + 1) * k, k, k);
    }
}

/** 白黒の格子（汚したもの） */
export function drawPlain(ctx: CanvasRenderingContext2D, k: number, m: Uint8Array, n: number, qz = QZ): void {
  const W = (n + 2 * qz) * k;
  ctx.fillStyle = COL.paper;
  ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = INK;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (m[y * n + x]) ctx.fillRect((x + qz) * k, (y + qz) * k, k, k);
}

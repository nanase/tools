/** MP3 のページの図（canvas）の共通部とスペクトログラム。色はサイトの変数から読む */
import { surface } from '../pcm/fig';
import { FS } from './encoder';
import { bandOf, type Spectrogram } from './evaluate';

export interface Col {
  screen: string;
  grid: string;
  grid2: string;
  ink: string;
  ink2: string;
  ink3: string;
  ch1: string;
  ch2: string;
  over: string;
  surface: string;
  inset: string;
  line2: string;
  mono: string;
  sans: string;
}
export const COL: Col = {
  screen: '',
  grid: '',
  grid2: '',
  ink: '',
  ink2: '',
  ink3: '',
  ch1: '',
  ch2: '',
  over: '',
  surface: '',
  inset: '',
  line2: '',
  mono: 'monospace',
  sans: 'sans-serif',
};
export function readCols(root: Element): void {
  const c = getComputedStyle(root),
    v = (k: string) => c.getPropertyValue(k).trim();
  COL.screen = v('--screen');
  COL.grid = v('--grid');
  COL.grid2 = v('--grid-2');
  COL.ink = v('--ink');
  COL.ink2 = v('--ink-2');
  COL.ink3 = v('--ink-3');
  COL.ch1 = v('--ch1');
  COL.ch2 = v('--ch2');
  COL.over = v('--mp3-o');
  COL.surface = v('--surface');
  COL.inset = v('--inset');
  COL.line2 = v('--line-2');
  COL.mono = v('--mono');
  COL.sans = v('--sans');
}

const rgb = (h: string): [number, number, number] => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
];
export const alpha = (h: string, a: number): string => {
  const [r, g, b] = rgb(h);
  return `rgba(${r},${g},${b},${a})`;
};
export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

interface LabelOpt {
  w?: number;
  px?: number;
  mono?: boolean;
  al?: CanvasTextAlign;
  c?: string;
  halo?: string;
}
/** 図の中の札。地の色で縁取って線の上でも読めるようにする */
export function label(g: CanvasRenderingContext2D, s: string, x: number, y: number, o: LabelOpt = {}): void {
  g.font = `${o.w ?? 500} ${o.px ?? 12.5}px ${o.mono ? COL.mono : COL.sans}`;
  g.textAlign = o.al ?? 'left';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = o.halo ?? COL.screen;
  g.strokeText(s, x, y);
  g.fillStyle = o.c ?? COL.ink2;
  g.fillText(s, x, y);
}

/* ---------- スペクトログラム ---------- */
export type SgMode = 'orig' | 'mp3' | 'over';
const SG_L = 40,
  SG_R = 10,
  SG_TOP = 6;
/** 図の縦の範囲（一番下の図だけ時間の目盛りの分を空ける） */
export const sgBottom = (mode: SgMode, H: number): number => H - (mode === 'over' ? 20 : 6);
/** 図の横の位置から時間の割合へ */
export const sgTime = (x: number, W: number): number => (x - SG_L) / (W - SG_L - SG_R);
/** 周波数と図の縦の位置の変換 */
export const sgY = (f: number, mode: SgMode, H: number): number => {
  const b = sgBottom(mode, H);
  return b - (f / (FS / 2)) * (b - SG_TOP);
};
export const sgF = (y: number, mode: SgMode, H: number): number => {
  const b = sgBottom(mode, H);
  return ((b - y) / (b - SG_TOP)) * (FS / 2);
};

export interface SgInput {
  mode: SgMode;
  sg: Spectrogram;
  /** 今のローパス [Hz]。0 ならかけていない */
  lp: number;
  dur: number;
  /** 雑音 / 閾値（mode が over のとき） */
  ratio?: Float32Array;
  ratioT?: number;
  nBands?: number;
  /** グラニュールごとのブロックの型（mode が mp3 のとき） */
  types?: Uint8Array;
}

interface SgCanvas extends HTMLCanvasElement {
  __base?: HTMLCanvasElement;
  __key?: string;
}

function renderSg(c: SgCanvas, o: SgInput, W: number, H: number): void {
  const d = Math.min(2, devicePixelRatio || 1),
    base = c.__base ?? document.createElement('canvas');
  c.__base = base;
  base.width = Math.round(W * d);
  base.height = Math.round(H * d);
  const g = base.getContext('2d');
  if (!g) return;
  g.setTransform(d, 0, 0, d, 0, 0);
  const { sg, mode, lp } = o,
    bottom = sgBottom(mode, H),
    pw = W - SG_L - SG_R,
    ph = bottom - SG_TOP,
    c0 = rgb(COL.screen),
    c1 = rgb(COL.ink),
    w = rgb(COL.over),
    off = document.createElement('canvas');
  off.width = sg.T;
  off.height = sg.R;
  const og = off.getContext('2d');
  if (!og) return;
  const img = og.createImageData(sg.T, sg.R),
    px = img.data,
    /* 帯の番号は行ごとに決まるので先に引く */
    rowBand = Int32Array.from({ length: sg.R }, (_, r) => bandOf(((r + 0.5) / sg.R) * (FS / 2))),
    rowF = Float64Array.from({ length: sg.R }, (_, r) => ((r + 0.5) / sg.R) * (FS / 2));
  for (let t = 0; t < sg.T; t++) {
    const ov = o.ratio ? Math.min((o.ratioT ?? 1) - 1, t >> 1) : 0;
    for (let r = 0; r < sg.R; r++) {
      let v = clamp((sg.d[t * sg.R + r] + 92) / 62, 0, 1) ** 1.4;
      const p = ((sg.R - 1 - r) * sg.T + t) * 4;
      if (mode === 'over' && o.ratio) {
        v *= 0.3;
        const q = o.ratio[ov * (o.nBands ?? 1) + rowBand[r]],
          a = q > 1 && (!lp || rowF[r] < lp) ? clamp((10 * Math.log10(q)) / 10, 0.25, 1) : 0;
        for (let k = 0; k < 3; k++) px[p + k] = (c0[k] + (c1[k] - c0[k]) * v) * (1 - a) + w[k] * a;
      } else for (let k = 0; k < 3; k++) px[p + k] = c0[k] + (c1[k] - c0[k]) * v;
      px[p + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  g.clearRect(0, 0, W, H);
  g.imageSmoothingEnabled = pw < sg.T;
  g.imageSmoothingQuality = 'high';
  g.drawImage(off, SG_L, SG_TOP, pw, ph);
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1;
  for (const k of [5, 10, 15, 20]) {
    const y = Math.round(sgY(k * 1000, mode, H)) + 0.5;
    g.beginPath();
    g.moveTo(SG_L - 4, y);
    g.lineTo(SG_L, y);
    g.stroke();
    label(g, `${k}k`, SG_L - 6, y + 4, { al: 'right', mono: true, px: 11 });
  }
  if (lp && mode !== 'orig') {
    const y = sgY(lp, mode, H);
    g.strokeStyle = COL.ch1;
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    g.beginPath();
    g.moveTo(SG_L, y);
    g.lineTo(W - SG_R, y);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = COL.ch1;
    g.beginPath();
    g.arc(W - 24, y, 6, 0, 7);
    g.fill();
    label(g, `${Number((lp / 1000).toFixed(1))} kHz`, W - 34, y - 6, { al: 'right', w: 700, c: COL.ink });
  }
  if (mode === 'mp3' && o.types) {
    /* 短いブロックの印（1 グラニュールは 576 サンプル） */
    g.fillStyle = COL.ch2;
    const unit = (576 / (o.dur * FS)) * pw;
    for (let i = 0; i < o.types.length; i++)
      if (o.types[i] === 2) g.fillRect(SG_L + i * unit, SG_TOP, Math.max(2, unit), 5);
  }
  if (mode === 'over') {
    const step = Math.max(1, Math.ceil(o.dur / 8));
    for (let s = 0; s <= o.dur; s += step)
      label(g, String(s), SG_L + (s / o.dur) * pw, H - 6, { al: 'center', mono: true, px: 11 });
    label(g, 's', SG_L - 6, H - 6, { al: 'right', mono: true, px: 11 });
  }
}

/** スペクトログラムを描く。下絵は入力が変わったときだけ作り直し、毎回は再生位置の線だけを重ねる */
export function drawSg(c: HTMLCanvasElement, o: SgInput, key: string, pos: number | null): void {
  const s = surface(c);
  if (!s) return;
  const { g, w: W, h: H } = s,
    cv = c as SgCanvas,
    k = `${key}|${o.lp}|${Math.round(W)}|${Math.round(H)}|${COL.ink}`;
  if (cv.__key !== k) {
    cv.__key = k;
    renderSg(cv, o, W, H);
  }
  g.clearRect(0, 0, W, H);
  if (cv.__base) g.drawImage(cv.__base, 0, 0, W, H);
  if (pos !== null) {
    const x = SG_L + (pos / o.dur) * (W - SG_L - SG_R);
    g.strokeStyle = COL.ink;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
}

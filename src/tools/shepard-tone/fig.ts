/**
 * 無限音階のページの図: スペクトログラム・音域ごとの音量・音名の環。
 * スペクトログラムの履歴は固定の大きさで持ち、図の幅に縮めて描く（トグルで幅が変わっても履歴は崩れない）
 */
import { COL, surface } from '../pcm/fig';
import { envAt, hzOf, N_OCT, noteOf, octOf, type Shepard, type Voice } from './shepard';

type Ctx = CanvasRenderingContext2D;

/** 履歴の大きさ: 横は WINDOW 秒分 */
const HIST_W = 1200;
const HIST_H = 400;
/** 図に出す時間 [s] */
const WINDOW = 24;
/** 1 秒の列の数 */
export const COLS_PER_SEC = HIST_W / WINDOW;
/** 色に当てる大きさの範囲 [dB] */
const DB_FLOOR = -86;
const DB_RANGE = 62;
/** この高さより下は長い分析を使う [Hz] */
const SPLIT = 700;
/** 計算した音の大きさと、分析の dB の差 [dB]。音を出す前の図と鳴らしたあとの図の明るさをそろえる */
const PREVIEW_DB = -13;

/** スペクトログラムの色: 黒・紫・青・緑・赤・白（VVVF のページと同じ） */
const LUT = new Uint8Array(256 * 3);
{
  const SG = [
    [0, 0, 0],
    [52, 20, 92],
    [32, 70, 170],
    [40, 170, 90],
    [224, 60, 40],
    [255, 255, 255],
  ];
  for (let i = 0; i < 256; i++) {
    const p = Math.min(0.9999, i / 255) * (SG.length - 1),
      j = Math.floor(p),
      u = p - j;
    for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(SG[j][c] + (SG[j + 1][c] - SG[j][c]) * u);
  }
}

/** 図の上の高さの比（0 が下端）→ 音の高さ [オクターブ] */
const yOf = (x: number, h: number): number => (1 - x / N_OCT) * h;

export class ShepardSpec {
  private readonly hist = document.createElement('canvas');
  private readonly hc: Ctx;
  private readonly img: ImageData;
  private readonly col = new Float32Array(HIST_H);
  private map: { low: boolean; b0: number; b1: number; i0: number; i1: number }[] | null = null;
  private dL: Float32Array<ArrayBuffer> | null = null;
  private dH: Float32Array<ArrayBuffer> | null = null;
  private acc = 0;
  constructor(private readonly cv: HTMLCanvasElement) {
    this.hist.width = HIST_W;
    this.hist.height = HIST_H;
    this.hc = this.hist.getContext('2d') as Ctx;
    this.hc.fillStyle = '#000';
    this.hc.fillRect(0, 0, HIST_W, HIST_H);
    this.img = this.hc.createImageData(1, HIST_H);
  }

  /** 位置 pos の音を計算で描く。鳴らしていない間の図に使う */
  private previewCol(m: Shepard, pos: number): void {
    const col = this.col;
    col.fill(0);
    if (m.gate(pos) <= 0.25) return;
    const g = m.norm(),
      shown = m.stepped ? Math.round(pos) : pos;
    for (const p of m.voices(shown)) {
      if (p.x < 0 || p.x > N_OCT) continue;
      const v = (20 * Math.log10(p.a * g) + PREVIEW_DB - DB_FLOOR) / DB_RANGE;
      if (v <= 0) continue;
      const yc = yOf(p.x, HIST_H),
        /* 低い音ほど分析の幅が広く、線が太く見える */
        sig = 1.8 + 2.4 * Math.max(0, (4 - p.x) / 4),
        y0 = Math.max(0, Math.floor(yc - 3 * sig)),
        y1 = Math.min(HIST_H - 1, Math.ceil(yc + 3 * sig));
      for (let y = y0; y <= y1; y++) {
        const u = v * Math.exp(-((y - yc) ** 2) / (2 * sig * sig));
        if (u > col[y]) col[y] = u;
      }
    }
  }
  /** 分析の結果を列にする。低い音は長い分析、高い音は短い分析で読む */
  private liveCol(low: AnalyserNode, high: AnalyserNode): void {
    const fs = low.context.sampleRate;
    this.map ??= Array.from({ length: HIST_H }, (_, y) => {
      const x0 = (1 - y / HIST_H) * N_OCT,
        x1 = (1 - (y + 1) / HIST_H) * N_OCT,
        isLow = hzOf((x0 + x1) / 2) < SPLIT,
        hz = fs / (isLow ? low.fftSize : high.fftSize),
        b0 = hzOf(x1) / hz,
        b1 = hzOf(x0) / hz;
      return { low: isLow, b0, b1, i0: Math.floor(b0), i1: Math.ceil(b1) };
    });
    this.dL ??= new Float32Array(low.frequencyBinCount);
    this.dH ??= new Float32Array(high.frequencyBinCount);
    low.getFloatFrequencyData(this.dL);
    high.getFloatFrequencyData(this.dH);
    for (let y = 0; y < HIST_H; y++) {
      const q = this.map[y],
        d = q.low ? this.dL : this.dH;
      let v = -200;
      if (q.b1 - q.b0 < 1) v = d[q.i0] + (d[q.i0 + 1] - d[q.i0]) * (q.b0 - q.i0);
      else for (let i = q.i0; i <= q.i1 && i < d.length; i++) if (d[i] > v) v = d[i];
      this.col[y] = (v - DB_FLOOR) / DB_RANGE;
    }
  }
  private put(x: number): void {
    const a = this.img.data;
    for (let y = 0; y < HIST_H; y++) {
      const q = Math.round(Math.max(0, Math.min(1, this.col[y])) * 255) * 3,
        o = y * 4;
      a[o] = LUT[q];
      a[o + 1] = LUT[q + 1];
      a[o + 2] = LUT[q + 2];
      a[o + 3] = 255;
    }
    this.hc.putImageData(this.img, x, 0);
  }

  /** 開いた直後の履歴を計算で埋める */
  fill(m: Shepard): void {
    const v = m.moving ? m.rate * m.dir : 0;
    for (let x = 0; x < HIST_W; x++) {
      this.previewCol(m, m.pos + (v * (x - HIST_W)) / COLS_PER_SEC);
      this.put(x);
    }
  }
  /** dt [s] 分の列を右から足す。分析がなければ計算で描く */
  scroll(dt: number, m: Shepard, low: AnalyserNode | null, high: AnalyserNode | null, preview: boolean): void {
    this.acc += dt * COLS_PER_SEC;
    const n = Math.floor(this.acc);
    if (n < 1) return;
    this.acc -= n;
    this.hc.drawImage(this.hist, -n, 0);
    if (preview) this.previewCol(m, m.pos);
    else if (low && high) this.liveCol(low, high);
    else this.col.fill(0);
    for (let x = HIST_W - n; x < HIST_W; x++) this.put(x);
  }
  draw(): void {
    const s = surface(this.cv);
    if (!s) return;
    const { g, w, h } = s;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.hist, 0, 0, w, h);
    g.font = `13px ${COL.mono}`;
    g.lineJoin = 'round';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const label = (t: string, x: number, y: number) => {
      g.lineWidth = 3;
      g.strokeStyle = '#000';
      g.strokeText(t, x, y);
      g.fillStyle = '#e6e8e4';
      g.fillText(t, x, y);
    };
    for (const [f, t] of [
      [50, '50'],
      [100, '100'],
      [200, '200'],
      [500, '500'],
      [1000, '1k'],
      [2000, '2k'],
      [5000, '5k'],
      [10000, '10k Hz'],
    ] as const) {
      const y = yOf(octOf(f), h);
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillRect(0, y - 0.5, 5, 1);
      label(t, 8, y);
    }
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (const t of w < 520 ? [20, 10] : [20, 15, 10, 5]) label(`−${t} 秒`, w * (1 - t / WINDOW), h - 3);
  }
}

/** スペクトログラムの地は黒なので、テーマによらず同じ色で描く */
const SIDE = { root: '#f2c230', other: '#52c4dd', line: '#aab3b8', dim: '#48525a', text: '#e6e8e4' };

/** 音域ごとの音量: スペクトログラムと高さをそろえ、山と今鳴っている音を描く */
export function drawLevels(cv: HTMLCanvasElement, m: Shepard): void {
  const s = surface(cv);
  if (!s) return;
  const { g, w, h } = s,
    L = 8,
    R = w - 10,
    X = (a: number) => L + (R - L) * a;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = SIDE.line;
  g.lineWidth = 1.5;
  g.beginPath();
  let pen = false;
  for (let i = 0; i <= 180; i++) {
    const x = (i / 180) * N_OCT,
      v = envAt(x, m.center, m.width);
    if (v <= 0) {
      pen = false;
      continue;
    }
    if (pen) g.lineTo(X(v), yOf(x, h));
    else g.moveTo(X(v), yOf(x, h));
    pen = true;
  }
  g.stroke();
  const ps: Voice[] = m.voices().filter((p) => p.x >= 0 && p.x <= N_OCT);
  g.lineWidth = 1.5;
  g.strokeStyle = SIDE.dim;
  for (const p of ps) {
    if (p.fund) continue;
    g.beginPath();
    g.moveTo(L, yOf(p.x, h));
    g.lineTo(X(p.a), yOf(p.x, h));
    g.stroke();
  }
  g.lineWidth = 2;
  for (const p of ps) {
    if (!p.fund) continue;
    const c = p.pc === 0 ? SIDE.root : SIDE.other,
      y = yOf(p.x, h);
    g.strokeStyle = c;
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(L, y);
    g.lineTo(X(p.a), y);
    g.stroke();
    g.beginPath();
    g.arc(X(p.a), y, 3.5, 0, 7);
    g.fill();
  }
  g.font = `13px ${COL.sans}`;
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillStyle = SIDE.text;
  g.fillText('音量', w - 6, h - 3);
}

const RING = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** 環の位置 0 は C。音の位置 0 は A なので 9 半音ずらす */
const A_ON_RING = 9;

/** 音名の環: 12 の音名の上で今の和音が回る。上昇で時計回り */
export function drawRing(
  cv: HTMLCanvasElement,
  m: Shepard,
  pcs: readonly number[],
  name: string,
  surfaceColor: string,
): void {
  const s = surface(cv);
  if (!s) return;
  const { g, w, h } = s,
    cx = w / 2,
    cy = h / 2,
    R = Math.min(w, h) / 2 - 30,
    ang = (k: number) => (k / 12) * 2 * Math.PI - Math.PI / 2;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(cx, cy, R, 0, 7);
  g.stroke();
  g.font = `500 15px ${COL.mono}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) {
    const a = ang(i),
      c = Math.cos(a),
      q = Math.sin(a);
    g.beginPath();
    g.moveTo(cx + c * (R - 4), cy + q * (R - 4));
    g.lineTo(cx + c * (R + 4), cy + q * (R + 4));
    g.stroke();
    g.fillStyle = RING[i].length > 1 ? COL.ink3 : COL.ink;
    g.fillText(RING[i], cx + c * (R + 18), cy + q * (R + 18));
  }
  const p = m.shown() + A_ON_RING,
    pts = pcs.map((k) => {
      const a = ang(p + k);
      return [cx + Math.cos(a) * R, cy + Math.sin(a) * R] as const;
    });
  if (pts.length > 1) {
    g.strokeStyle = COL.ch2;
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach(([x, y], i) => {
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    if (pts.length > 2) g.closePath();
    g.stroke();
  }
  pts.forEach(([x, y], i) => {
    g.fillStyle = i ? COL.ch2 : COL.ch1;
    g.beginPath();
    g.arc(x, y, i ? 5 : 7, 0, 7);
    g.fill();
  });
  /* 中央の文字は和音の線に重ならないよう地を敷く */
  g.fillStyle = surfaceColor;
  g.beginPath();
  g.arc(cx, cy, 52, 0, 7);
  g.fill();
  const oct = m.pos / 12;
  g.fillStyle = COL.ink;
  g.font = `600 ${name.length > 6 ? 19 : 28}px ${COL.mono}`;
  g.fillText(name, cx, cy - 12);
  g.fillStyle = COL.ink3;
  g.font = `500 15px ${COL.mono}`;
  g.fillText(octText(oct), cx, cy + 13);
  g.font = `13px ${COL.sans}`;
  g.fillText('オクターブ', cx, cy + 31);
}

/** オクターブ数の表記（正負の記号つき） */
export const octText = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
/** セントの表記 */
export const centText = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
/** 和音の名前: 今の根音と種類 */
export const chordName = (pos: number, suffix: string): string => `${noteOf(pos).name}${suffix}`;

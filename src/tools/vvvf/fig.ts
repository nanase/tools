/** VVVF のページの図（canvas）: 基本波 1 周期の波形・モード図・流れるスペクトログラム。色はサイトの変数から読む */
import { COL, surface } from '../pcm/fig';
import { type Car, f1Of, hzPerKmh, type ModeNow, modeOf, pick, type Run, V_MAX } from './cars';
import { tri } from './inverter';

type Ctx = CanvasRenderingContext2D;
const TAU = 2 * Math.PI;

/** 札: 地の色で縁取って線の上でも読めるようにする */
function tag(g: Ctx, s: string, x: number, y: number, col: string, al: CanvasTextAlign = 'left'): void {
  g.font = `500 11px ${COL.mono}`;
  g.textAlign = al;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = COL.screen;
  g.strokeText(s, x, y);
  g.fillStyle = col;
  g.fillText(s, x, y);
}

const hz = (f: number): string => (f >= 100 ? f.toFixed(0) : f.toFixed(1));

/** 図の下の文 */
export function ratioText(M: ModeNow, r: Run): string {
  if (!M.on) {
    if (r.v > 0.1) return r.brake ? '空気ブレーキ: スイッチ停止' : '惰行: スイッチ停止';
    return '停止中: 「自動」か「加速」で発車';
  }
  if (M.one) return `1 パルス: 基本波 ${hz(M.f1)} Hz の 1 周期に 1 回のオン・オフ`;
  if (M.sync) return `同期: キャリア ${hz(M.fc)} Hz ÷ 基本波 ${hz(M.f1)} Hz = ちょうど ${M.n} 倍`;
  const q = M.fc / Math.max(M.f1, 0.01);
  return `非同期: キャリア ${hz(M.fc)} Hz ÷ 基本波 ${hz(M.f1)} Hz = ${q >= 1000 ? q.toFixed(0) : q.toFixed(2)} 倍`;
}

/** 右の枠のモードの名前 */
export function modeName(M: ModeNow, r: Run): string {
  if (!M.on) return r.v > 0.1 ? (r.brake ? '空気ブレーキ' : '惰行') : '停止';
  return M.one ? '1 パルス' : M.sync ? `同期 ${M.n} 倍` : '非同期';
}

/**
 * 基本波 1 周期の波形。上に基本波とキャリア、下に出力。drift は非同期のパルスのずれ（0〜1）。
 * キャリアが多いときは 1 周期の一部だけを描く。止まっている間は 20 Hz あたりの例を描く
 */
export function drawCycle(c: HTMLCanvasElement, M0: ModeNow, r: Run, car: Car, drift: number): void {
  const s = surface(c);
  if (!s) return;
  const { g, w, h } = s;
  g.clearRect(0, 0, w, h);
  const top = 8,
    h1 = (h - top - 22) * 0.58,
    y1 = top + h1 / 2,
    y2t = top + h1 + 14,
    h2 = h - y2t - 8,
    y2 = y2t + h2 / 2;
  g.strokeStyle = COL.grid;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, y1);
  g.lineTo(w, y1);
  g.moveTo(0, y2);
  g.lineTo(w, y2);
  g.stroke();
  let M = M0;
  if (!M.on) {
    if (r.v > 0.1) {
      g.font = `13px ${COL.sans}`;
      g.fillStyle = COL.ink3;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('スイッチ停止', w / 2, h / 2);
      return;
    }
    M = modeOf(car, { v: 18, a: 0, power: true, brake: false });
  }
  const f1 = Math.max(M.f1, 0.5),
    rate = M.fc / f1,
    cycles = Math.min(1, 42 / Math.max(rate, 1)),
    N = Math.floor(w * 2),
    yA = h1 / 2 - 2,
    yB = h2 / 2 - 2,
    carAt = (x: number) => (M.sync ? -tri(M.n * x) : tri(rate * x + drift)),
    A = M.one ? 1 : Math.min(M.m, 1.6);
  if (!M.one) {
    g.lineWidth = 1;
    g.strokeStyle = COL.ink3;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * cycles,
        X = (i / N) * w,
        Y = y1 - carAt(x) * yA;
      if (i) g.lineTo(X, Y);
      else g.moveTo(X, Y);
    }
    g.stroke();
  }
  g.lineWidth = 1.8;
  g.strokeStyle = COL.ch2;
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * cycles,
      X = (i / N) * w,
      Y = y1 - Math.max(-1.25, Math.min(1.25, A * Math.sin(TAU * x))) * yA * 0.8;
    if (i) g.lineTo(X, Y);
    else g.moveTo(X, Y);
  }
  g.stroke();
  g.lineWidth = 1.5;
  g.strokeStyle = COL.ch1;
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * cycles,
      X = (i / N) * w,
      on = M.one ? Math.sin(TAU * x) >= 0 : A * Math.sin(TAU * x) >= carAt(x),
      Y = y2 - (on ? 1 : -1) * yB;
    if (i) g.lineTo(X, Y);
    else g.moveTo(X, Y);
  }
  g.stroke();
  tag(g, '基本波', 8, top + 12, COL.ch2);
  if (!M.one) tag(g, 'キャリア', 66, top + 12, COL.ink2);
  tag(g, '出力（オン・オフ）', 8, y2t - 1, COL.ch1);
  tag(
    g,
    cycles < 1 ? `基本波 1 周期の ${(cycles * 100).toFixed(0)} % の範囲` : '基本波 1 周期',
    w - 8,
    top + 12,
    COL.ink2,
    'right',
  );
}

/** 図に同じ倍率の線を引く倍率 */
const RAYS = [3, 5, 9, 15, 27, 45];
/** 縦軸の上限 [Hz] */
const C_MAX = 2000;

/** モード図: 横軸は速度、縦軸はキャリアの周波数。同期は原点からの直線の上を進む */
export function drawMap(c: HTMLCanvasElement, r: Run, on: boolean, car: Car): void {
  const s = surface(c);
  if (!s) return;
  const { g, w, h } = s,
    L = 46,
    R = 12,
    T = 12,
    B = 36,
    W = w - L - R,
    H = h - T - B,
    k = hzPerKmh(car),
    X = (v: number) => L + (v / V_MAX) * W,
    Y = (fc: number) => T + H - (fc / C_MAX) * H;
  g.clearRect(0, 0, w, h);
  g.font = `11px ${COL.mono}`;
  g.textBaseline = 'alphabetic';
  g.lineWidth = 1;
  g.strokeStyle = COL.grid;
  g.fillStyle = COL.ink2;
  g.textAlign = 'right';
  g.beginPath();
  for (let y = 0; y <= C_MAX; y += 500) {
    g.moveTo(L, Y(y));
    g.lineTo(L + W, Y(y));
    g.fillText(String(y), L - 5, Y(y) + 4);
  }
  g.textAlign = 'center';
  for (let v = 0; v <= V_MAX; v += 20) {
    g.moveTo(X(v), T);
    g.lineTo(X(v), T + H);
    g.fillText(String(v), X(v), T + H + 14);
  }
  g.stroke();
  g.fillText('速度 [km/h]', L + W / 2, T + H + 30);
  g.save();
  g.translate(11, T + H / 2);
  g.rotate(-Math.PI / 2);
  g.fillText('キャリアの周波数 [Hz]', 0, 0);
  g.restore();
  g.strokeStyle = COL.grid2;
  g.setLineDash([3, 4]);
  g.textAlign = 'left';
  g.fillStyle = COL.ink3;
  for (const n of RAYS) {
    const end = Math.min(V_MAX, C_MAX / (n * k));
    g.beginPath();
    g.moveTo(X(0), Y(0));
    g.lineTo(X(end), Y(end * k * n));
    g.stroke();
    if (end >= V_MAX) g.fillText(`${n} 倍`, X(end) - 30, Y(end * k * n) - 4);
    else g.fillText(`${n} 倍`, Math.min(X(end) + 3, w - 34), Y(end * k * n) + 10);
  }
  g.setLineDash([]);
  const tab = r.brake ? car.brk : car.acc,
    /* 今のすべり周波数の分だけ、モードの線を速度の軸の上でずらす。点はいつも線の上にある */
    f1 = f1Of(car, r),
    sl = r.v > 0.02 || r.power ? f1 - k * r.v : 0,
    XF = (f: number) => X(Math.max(0, Math.min(V_MAX, (f - sl) / k))),
    fEnd = V_MAX * k + sl;
  tab.forEach((m, i) => {
    const nb = tab[i + 1],
      a = m.f,
      b = Math.min(nb?.f ?? fEnd, fEnd);
    if (a >= fEnd) return;
    const y0 = m.sync ? a * m.n : m.fc0,
      y1 = m.sync ? b * m.n : m.fc1;
    g.strokeStyle = m.sync ? COL.ch1 : COL.ch2;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(XF(a), Y(y0));
    g.lineTo(XF(b), Y(y1));
    g.stroke();
    if (nb) {
      /* 切り替えの段差を細い点線でつなぐ */
      g.lineWidth = 1;
      g.setLineDash([2, 2]);
      g.beginPath();
      g.moveTo(XF(b), Y(y1));
      g.lineTo(XF(b), Y(nb.sync ? nb.f * nb.n : nb.fc0));
      g.stroke();
      g.setLineDash([]);
    } else if (m.sync && m.n === 1) {
      g.fillStyle = COL.ink2;
      g.textAlign = 'right';
      g.fillText('1 パルス（1 倍）', X(V_MAX) - 2, Y(fEnd) - 7);
    }
  });
  if (r.v > 0.02 || r.power) {
    const p = pick(tab, f1),
      yy = Y(Math.min(C_MAX, p.fc));
    g.beginPath();
    g.arc(X(Math.min(V_MAX, r.v)), yy, 5.5, 0, TAU);
    if (on) {
      g.fillStyle = COL.accent;
      g.shadowColor = COL.accent;
      g.shadowBlur = 8;
      g.fill();
      g.shadowBlur = 0;
    } else {
      g.strokeStyle = COL.accent;
      g.lineWidth = 2;
      g.stroke();
    }
  }
}

/** スペクトログラムの色（テーマに依らない。スペクトラムアナライザのページと同じ 黒 → 紫 → 青 → 緑 → 赤 → 白） */
const SG: readonly (readonly [number, number, number])[] = [
  [0x00, 0x00, 0x00],
  [0x5b, 0x1a, 0x8f],
  [0x20, 0x50, 0xe0],
  [0x1f, 0xb0, 0x4a],
  [0xe3, 0x26, 0x1f],
  [0xff, 0xff, 0xff],
];
const LUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const t = (i / 255) * 5,
    j = Math.min(4, Math.floor(t)),
    u = t - j;
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(SG[j][c] + (SG[j + 1][c] - SG[j][c]) * u);
}

/** 右から流れるスペクトログラム。0〜4 kHz */
export class LiveSpec {
  private readonly hist = document.createElement('canvas');
  private readonly hc: Ctx;
  private readonly col: ImageData;
  private data: Float32Array<ArrayBuffer> | null = null;
  private acc = 0;
  private used = false;
  constructor(private readonly cv: HTMLCanvasElement) {
    this.hist.width = 800;
    this.hist.height = 200;
    this.hc = this.hist.getContext('2d') as Ctx;
    this.hc.fillStyle = '#000';
    this.hc.fillRect(0, 0, 800, 200);
    this.col = this.hc.createImageData(2, 200);
  }
  /** an があれば dt [s] 分だけ右から足し、描く */
  draw(an: AnalyserNode | null, run: boolean, dt: number): void {
    if (an && run) {
      this.acc += dt;
      this.used = true;
      while (this.acc > 0.03) {
        this.acc -= 0.03;
        this.data ??= new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(this.data);
        const df = an.context.sampleRate / an.fftSize,
          d = this.col.data;
        for (let y = 0; y < 200; y++) {
          const f = ((200 - y) / 200) * 4000,
            v = this.data[Math.round(f / df)],
            q = Math.round(Math.max(0, Math.min(1, (v + 100) / 70)) * 255) * 3;
          for (let x = 0; x < 2; x++) {
            const o = (y * 2 + x) * 4;
            d[o] = LUT[q];
            d[o + 1] = LUT[q + 1];
            d[o + 2] = LUT[q + 2];
            d[o + 3] = 255;
          }
        }
        this.hc.drawImage(this.hist, -2, 0);
        this.hc.putImageData(this.col, 798, 0);
      }
    }
    const s = surface(this.cv);
    if (!s) return;
    const { g, w, h } = s;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.hist, 0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.textBaseline = 'alphabetic';
    if (!this.used) {
      g.textAlign = 'center';
      g.font = `13px ${COL.sans}`;
      g.fillText('発車で右から流れる音の高さ', w / 2, h / 2);
    }
    g.textAlign = 'left';
    g.font = `11px ${COL.mono}`;
    for (const f of [1, 2, 3]) {
      const y = h * (1 - f / 4);
      g.fillRect(0, y, 6, 1);
      g.fillText(`${f} kHz`, 9, y + 4);
    }
  }
}

/**
 * 「VVVF のしくみ」の図: 8 つの工程を順に動かす。値は固定で、運転や車種では変わらない。
 * t は工程の中の経過時間 [s]。カードの小さい図は t を固定して描く
 */
import { COL, surface } from '../pcm/fig';
import { tri } from './inverter';

type Ctx = CanvasRenderingContext2D;
const TAU = 2 * Math.PI;

export const STEPS = [
  ['交流モーター', '周波数で決まる速さ'],
  ['スイッチ', '直流のオン・オフ'],
  ['PWM', '2 つの波の比較'],
  ['磁励音', 'オン・オフの音'],
  ['非同期', '端数のある倍率'],
  ['同期', '整数の倍率'],
  ['倍率の切り替え', '高速ほど低い倍率'],
  ['1 パルス', '1 周期に 1 回'],
] as const;

export const CAPTIONS = [
  '電車のモーターを回す 3 本の交流。周波数と電圧の上昇で高速に。VVVF は Variable Voltage Variable Frequency（可変電圧・可変周波数）の略',
  '架線の直流をスイッチでオン・オフ。オンの時間の割合の変化で、なめらかにした波が交流に',
  '基本波は作りたい交流、キャリアは比べる三角波。基本波がキャリアより上の間だけオン',
  'オン・オフの細かい揺れで磁力が変化。モーターの鉄心が振動して音に。音の高さはキャリアで変化',
  '基本波と無関係なキャリア。倍率に端数があるので、周期ごとにずれるパルスの位置',
  '基本波の整数倍に固定したキャリア。パルスは止まって見え、速度に比例して音も上昇',
  'スイッチの回数には上限。高速ほど低い倍率に切り替え、切り替えのたびに音の高さが変化',
  '最も高い電圧を出すモード。キャリアがなくなり、基本波の 6 倍の音が残る状態',
] as const;

/** 工程 4 の図: 線間電圧の周波数成分を 1 度だけ測る（キャリア 740 Hz・基本波 25 Hz・m = 0.5） */
let SPEC: Float32Array | null = null;
function spec(cols: number): Float32Array {
  if (SPEC) return SPEC;
  const N = 2 ** 16,
    Fs = 2 ** 18,
    re = new Float64Array(N),
    im = new Float64Array(N),
    bits = 16;
  for (let k = 0; k < N; k++) {
    const t = k / Fs,
      a = 0.5 * Math.sin(TAU * 25 * t),
      b = 0.5 * Math.sin(TAU * 25 * t - TAU / 3),
      c = tri(740 * t + 0.13),
      w = 0.5 - 0.5 * Math.cos((TAU * k) / N);
    let r = 0;
    for (let q = 0, m = k; q < bits; q++, m >>= 1) r = (r << 1) | (m & 1);
    re[r] = (((a >= c ? 1 : -1) - (b >= c ? 1 : -1)) * 0.5 * w * 4) / N;
  }
  for (let size = 2; size <= N; size *= 2) {
    const ang = -TAU / size,
      wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let s = 0; s < N; s += size) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = s + j,
          b = a + size / 2,
          tr = re[b] * cr - im[b] * ci,
          ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  const out = new Float32Array(cols).fill(-200),
    df = Fs / N;
  for (let k = Math.ceil(100 / df); k * df < 4000; k++) {
    const q = Math.floor(((k * df) / 4000) * cols);
    out[q] = Math.max(out[q], 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-6));
  }
  SPEC = out;
  return out;
}

/** 工程の図を描く */
function fig(i: number, g: Ctx, w: number, h: number, t: number, small: boolean): void {
  g.clearRect(0, 0, w, h);
  const font = `${small ? 9 : 12}px ${COL.sans}`,
    lw = small ? 1 : 1.8;
  g.textBaseline = 'alphabetic';
  const tag = (s: string, x: number, y: number, col: string, al: CanvasTextAlign = 'left') => {
    if (small) return;
    g.font = font;
    g.textAlign = al;
    g.lineJoin = 'round';
    g.lineWidth = 3;
    g.strokeStyle = COL.screen;
    g.strokeText(s, x, y);
    g.fillStyle = col;
    g.fillText(s, x, y);
  };
  const axis = (y: number) => {
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  };
  const path = (fn: (x: number) => number, col: string, width = lw) => {
    g.strokeStyle = col;
    g.lineWidth = width;
    g.beginPath();
    const N = Math.max(200, Math.floor(w * 2));
    for (let k = 0; k <= N; k++) {
      const x = k / N,
        y = fn(x);
      if (k) g.lineTo(x * w, y);
      else g.moveTo(x * w, y);
    }
    g.stroke();
  };
  /** 上に基本波とキャリア、下に出力。drift が null なら同期（キャリアは基本波に固定）。cover まで出力を描く */
  const pwm = (n: number, drift: number | null, A: number, cover = 1) => {
    const y1 = h * 0.3,
      yA = h * 0.24,
      y2 = h * 0.76,
      yB = h * 0.16,
      car = (x: number) => (drift === null ? -tri(n * x) : tri(n * x + drift));
    axis(y1);
    axis(y2);
    path((x) => y1 - car(x) * yA, COL.ink3, small ? 0.7 : 1);
    path((x) => y1 - A * Math.sin(TAU * x) * yA, COL.ch2);
    g.strokeStyle = COL.ch1;
    g.lineWidth = lw * 0.8;
    g.beginPath();
    const N = Math.floor(w * 3);
    for (let k = 0; k <= N * cover; k++) {
      const x = k / N,
        Y = y2 - (A * Math.sin(TAU * x) >= car(x) ? 1 : -1) * yB;
      if (k) g.lineTo(x * w, Y);
      else g.moveTo(x * w, Y);
    }
    g.stroke();
    if (cover < 1) {
      g.strokeStyle = COL.accent;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cover * w, 0);
      g.lineTo(cover * w, h);
      g.stroke();
    }
    tag('基本波', 8, 16, COL.ch2);
    tag('キャリア', 62, 16, COL.ink2);
    tag('出力', 8, h * 0.56, COL.ch1);
  };
  const note = (s: string) => tag(s, w - 8, 16, COL.ink2, 'right');

  if (i === 0) {
    const y = h / 2,
      A = h * 0.34,
      q = (t * 0.12) % 1,
      fr = small ? 2 : 2 + 2 * q,
      amp = small ? 0.8 : 0.5 + 0.5 * q;
    axis(y);
    for (const [ph, col] of [
      [0, COL.ch1],
      [1 / 3, COL.ch2],
      [2 / 3, COL.ink2],
    ] as const)
      path((x) => y - A * amp * Math.sin(TAU * (x * fr - ph - t * 0.25)), col);
    tag('3 本の交流', 8, 16, COL.ink2);
    note('周波数と電圧の上昇で高速に');
  } else if (i === 1) {
    const y1 = h * 0.28,
      yB = h * 0.18,
      y2 = h * 0.72,
      n = 21,
      A = 0.85;
    axis(y1);
    axis(y2);
    path((x) => y1 - (A * Math.sin(TAU * x) >= -tri(n * x) ? 1 : -1) * yB, COL.ch1, lw * 0.8);
    path((x) => y2 - A * Math.sin(TAU * x) * h * 0.2, COL.ch2);
    tag('スイッチのオン・オフ', 8, 14, COL.ch1);
    tag('なめらかにした波', 8, h * 0.5 + 8, COL.ch2);
  } else if (i === 2) {
    pwm(15, null, 0.8, small ? 1 : Math.min(1, ((t * 0.16) % 1.15) as number));
    note('基本波がキャリアより上の間だけオン');
  } else if (i === 3) {
    const B = h - (small ? 6 : 24),
      cols = spec(400),
      cw = w / cols.length;
    g.strokeStyle = COL.ch1;
    g.lineWidth = small ? 0.8 : 1.4;
    g.beginPath();
    cols.forEach((a, q) => {
      const Y = B - Math.max(0, (a + 46) / 46) * (B - (small ? 6 : 34));
      if (Y < B - 1) {
        g.moveTo((q + 0.5) * cw, B);
        g.lineTo((q + 0.5) * cw, Y);
      }
    });
    g.stroke();
    axis(B);
    if (!small) {
      g.fillStyle = COL.ink2;
      g.font = font;
      g.textAlign = 'center';
      for (const f of [1, 2, 3]) g.fillText(`${f} kHz`, (f / 4) * w, h - 7);
      tag('出力の周波数成分（キャリア 740 Hz・基本波 25 Hz）', 8, 16, COL.ink2);
      const xx = (1480 / 4000) * w;
      g.strokeStyle = COL.accent;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(xx, 24);
      g.lineTo(xx, B);
      g.stroke();
      g.setLineDash([]);
      tag('最も強いキャリアの 2 倍付近', xx + 6, 36, COL.accent);
    }
  } else if (i === 4) {
    pwm(14.3, (t * 0.28) % 1, 0.75);
    note('14.3 倍: 周期ごとにずれるパルス');
  } else if (i === 5) {
    pwm(15, null, 0.75);
    note('ちょうど 15 倍: 止まって見えるパルス');
  } else if (i === 6) {
    const list = [27, 15, 9, 5, 3],
      cur = small ? 2 : Math.floor((t * 0.5) % list.length);
    pwm(list[cur], null, 0.45 + cur * 0.13);
    note(`${list[cur]} 倍: 基本波 30 Hz でキャリア ${list[cur] * 30} Hz`);
  } else {
    const y1 = h * 0.3,
      yA = h * 0.24,
      y2 = h * 0.76,
      yB = h * 0.16;
    axis(y1);
    axis(y2);
    path((x) => y1 - Math.sin(TAU * x) * yA, COL.ch2);
    path((x) => y2 - (Math.sin(TAU * x) >= 0 ? 1 : -1) * yB, COL.ch1);
    tag('基本波', 8, 16, COL.ch2);
    tag('出力', 8, h * 0.56, COL.ch1);
    note('1 周期に 1 回のオン・オフ');
  }
}

export function drawStory(c: HTMLCanvasElement, i: number, t: number): void {
  const s = surface(c);
  if (s) fig(i, s.g, s.w, s.h, t, false);
}
export function drawThumb(c: HTMLCanvasElement, i: number): void {
  const s = surface(c);
  if (s) fig(i, s.g, s.w, s.h, 1.5, true);
}

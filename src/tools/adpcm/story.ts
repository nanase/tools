/**
 * 「ADPCM のしくみ」の図: 小さい音が急に大きくなる波を 6 つの工程で順に動かす。値は固定（8 kHz・4 bit・440 Hz）で、
 * 設定の入力では変わらない。u は工程の中の進み（0〜1）で、1 のときは工程を終えた絵になる
 */
import { COL, surface, timeLabel, yAxisLabel } from '../pcm/fig';
import { ease } from '../pcm/story';
import { delta, encode } from './adpcm';

type Ctx = CanvasRenderingContext2D;
const FS = 8000,
  N = 4,
  M = 7,
  /** 間隔が落ち着くまで先に流す標本の数・図の標本の数・音が大きくなる標本 */
  PRE = 200,
  CNT = 44,
  ON = 14,
  HZ = 440;

export const STEPS = [
  ['音の波', '隣の標本は近い値'],
  ['予測', '前の値を次の予想に'],
  ['差', '予測との差を測る'],
  ['量子化', '差を 16 段階に丸める'],
  ['適応', '段階の間隔を変える'],
  ['再生', 'ビットだけから戻す'],
] as const;

/** 工程ごとの説明 */
export const CAPTIONS = [
  '音の波を標本化すると、隣どうしの標本はほとんど同じ高さになります。',
  '次の標本は前の値に近いはずです。前の値をそのまま予測値にします。',
  '記録するのは予測値との差だけです。差は波の高さよりずっと小さくなります。',
  '差を 16 段階のうち最も近い値に丸め、4 ビットの数にします。段階は予測値を中心に動きます。',
  '外側の段階を選ぶと段階の間隔を広げ、内側なら狭めます。音が急に大きくなると、追いつくまで差が残ります。',
  '再生する側も同じ計算で予測値と間隔を作るので、記録したビットだけから波を戻せます。',
] as const;

const amp = (n: number) => (n < PRE + ON ? 0.07 : 0.72);
/** 大きくなる所で 0 を上向きに横切るよう位相を合わせ、波が跳ばないようにする */
const wave = (n: number) => amp(n) * Math.sin((2 * Math.PI * HZ * (n - PRE - ON)) / FS);
let D: { x: Float64Array; a: ReturnType<typeof encode> } | null = null;
function data() {
  if (D) return D;
  const x = Float64Array.from({ length: PRE + CNT + 2 }, (_, n) => wave(n));
  D = { x, a: encode(x, { bits: N, pred: true, adapt: true, fix: 7 }) };
  return D;
}

function tag(g: Ctx, x: number, y: number, t: string, col: string, al: CanvasTextAlign = 'center', bold = true): void {
  g.font = `${bold ? 700 : 500} 12px ${COL.sans}`;
  g.textAlign = al;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = COL.screen;
  g.strokeText(t, x, y);
  g.fillStyle = col;
  g.fillText(t, x, y);
}
const seg = (g: Ctx, x0: number, y0: number, x1: number, y1: number, col: string, lw = 1): void => {
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
};
const rungs = (st: number) => Array.from({ length: M + 1 }, (_, m) => delta(m, st, N) / 32768);
const bitOf = (c: number) => c.toString(2).padStart(N, '0');

export function drawStory(c: HTMLCanvasElement, st: number, u: number): void {
  const a = surface(c);
  if (!a) return;
  const { x: xs, a: A0 } = data(),
    { g, w: W, h: H } = a,
    phone = W < 620,
    L = Math.min(58, W * 0.14),
    inset = (st === 3 || st === 4) && !phone ? 150 : 0,
    Rm = 8 + inset,
    T = 18,
    band = st >= 2 ? Math.round(H * 0.2) : 0,
    gap = band ? 20 : 0,
    B = 20,
    mainH = H - T - band - gap - B,
    PW = W - L - Rm,
    cy = T + mainH / 2,
    Am = mainH / 2 / 1.1,
    yv = (v: number) => cy - v * Am,
    dx = PW / (CNT - 1),
    X = (k: number) => L + k * dx,
    sv = (k: number) => xs[PRE + k],
    pv = (k: number) => A0.p[PRE + k],
    yo = (k: number) => A0.y[PRE + k],
    stp = (k: number) => Math.round(A0.st[PRE + k] * 32768),
    code = (k: number) => A0.code[PRE + k],
    cur = Math.min(CNT - 1, Math.floor(ease(u) * CNT));
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  seg(g, L, Math.round(cy) + 0.5, W - Rm, Math.round(cy) + 0.5, COL.grid2);
  yAxisLabel(g, 11, cy, '振幅');
  timeLabel(g, W - Rm, H - 2, Number((((CNT - 1) / FS) * 1000).toFixed(1)));

  /* 元の波 */
  const reveal = st === 0 ? ease(u / 0.5) : 1;
  g.strokeStyle = COL.ch2;
  g.lineWidth = st === 0 ? 2 : 1.3;
  g.globalAlpha = st >= 2 ? 0.55 : 1;
  g.beginPath();
  for (let px = 0; px <= PW * reveal; px += 1) {
    const y = yv(wave(PRE + px / dx));
    if (px) g.lineTo(L + px, y);
    else g.moveTo(L + px, y);
  }
  g.stroke();
  g.globalAlpha = 1;

  const dot = (k: number, v: number, col: string, r = 3) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(X(k), yv(v), r, 0, Math.PI * 2);
    g.fill();
  };
  const ring = (k: number, v: number, r = 3.2) => {
    g.fillStyle = COL.screen;
    g.strokeStyle = COL.ink2;
    g.lineWidth = 1.3;
    g.beginPath();
    g.arc(X(k), yv(v), r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  const ladder = (k: number, hl: boolean) => {
    const p = pv(k),
      tick = Math.min(dx * 0.82, 12);
    g.strokeStyle = hl ? COL.ink : COL.ink3;
    g.lineWidth = 1;
    g.globalAlpha = hl ? 1 : 0.75;
    g.beginPath();
    for (const v of rungs(stp(k)))
      for (const s of [1, -1]) {
        const y = Math.round(yv(p + s * v)) + 0.5;
        g.moveTo(X(k) - tick / 2, y);
        g.lineTo(X(k) + tick / 2, y);
      }
    g.stroke();
    g.globalAlpha = 1;
  };
  /** 下の帯のビット */
  const bits = (by: number, h: number, last: number, dim = 0.13) => {
    const rh = h / N,
      cw = Math.max(1, dx - 1);
    for (let k = 0; k <= last; k++) {
      const tx = bitOf(code(k));
      for (let r = 0; r < N; r++) {
        g.fillStyle = COL.ch1;
        g.globalAlpha = tx[r] === '1' ? 0.95 : dim;
        g.fillRect(X(k) - cw / 2, by + r * rh, cw, rh - 1);
      }
    }
    g.globalAlpha = 1;
  };

  if (st === 0) {
    const n = Math.floor(ease((u - 0.45) / 0.45) * (CNT + 1));
    for (let k = 0; k < n; k++) {
      seg(g, X(k), cy, X(k), yv(sv(k)), COL.grid2);
      dot(k, sv(k), COL.ch2);
    }
    if (u < 0.5 && reveal > 0.45) tag(g, X(ON + 6), yv(0.72) - 8, '音の波', COL.ch2);
    if (n > 26) {
      const k = 24,
        y0 = yv(sv(k)),
        y1 = yv(sv(k + 1));
      g.strokeStyle = COL.ink;
      g.lineWidth = 1.4;
      g.strokeRect(X(k) - 6, Math.min(y0, y1) - 6, dx + 12, Math.abs(y1 - y0) + 12);
      tag(g, X(k) + dx / 2, Math.min(y0, y1) - 18, '隣の標本は近い', COL.ink);
    }
  } else if (st === 1) {
    for (let k = 0; k < CNT; k++) dot(k, sv(k), COL.ch2, 2.6);
    g.setLineDash([3, 3]);
    for (let k = 1; k <= cur; k++) seg(g, X(k - 1), yv(pv(k)), X(k), yv(pv(k)), COL.ink2);
    g.setLineDash([]);
    for (let k = 1; k <= cur; k++) ring(k, pv(k));
    if (cur > 26) tag(g, X(26) + 6, yv(pv(26)) + (pv(26) > 0 ? 26 : -26), '前の値を予測値に', COL.ink, 'left');
  } else if (st === 2) {
    const grow = ease(u / 0.6);
    for (let k = 0; k < CNT; k++) {
      seg(g, X(k), yv(pv(k)), X(k), yv(pv(k) + (sv(k) - pv(k)) * grow), COL.err, 2.4);
      ring(k, pv(k), 2.6);
      dot(k, sv(k), COL.ch2, 2.6);
    }
    const by = T + mainH + gap,
      bm = by + band / 2,
      sc = band / 2 / 0.8,
      rev = ease((u - 0.45) / 0.45);
    seg(g, L, Math.round(bm) + 0.5, W - Rm, Math.round(bm) + 0.5, COL.grid);
    g.globalAlpha = rev * 0.5;
    g.strokeStyle = COL.ch2;
    g.lineWidth = 1;
    g.beginPath();
    for (let px = 0; px <= PW; px += 1) {
      const y = bm - wave(PRE + px / dx) * sc;
      if (px) g.lineTo(L + px, y);
      else g.moveTo(L + px, y);
    }
    g.stroke();
    g.globalAlpha = rev;
    for (let k = 0; k < CNT; k++) seg(g, X(k), bm, X(k), bm - (sv(k) - pv(k)) * sc, COL.err, Math.min(4, dx * 0.4));
    g.globalAlpha = 1;
    tag(g, L - 4, bm, '差', COL.err, 'right');
    if (rev > 0.7) tag(g, X(CNT - 1), by + 8, '差は波の高さより小さい', COL.err, 'right');
  } else if (st === 3 || st === 4) {
    for (let k = 0; k <= cur; k++) ladder(k, k === cur);
    for (let k = 0; k <= cur; k++) dot(k, yo(k), COL.ch1, k === cur ? 3.4 : 2.4);
    const by = T + mainH + gap;
    if (st === 3) {
      tag(g, L - 4, by + band / 2, 'ビット', COL.ch1, 'right');
      bits(by, band, cur);
    } else {
      const LOG = Math.log10(7 / 32768),
        Y = (v: number) => by + 2 + (Math.log10(v) / LOG) * (band - 4);
      g.strokeStyle = COL.grid;
      g.lineWidth = 1;
      g.strokeRect(L + 0.5, by + 0.5, PW, band);
      g.strokeStyle = COL.ch1;
      g.lineWidth = 1.8;
      g.beginPath();
      for (let k = 0; k <= cur; k++) {
        const y = Y(A0.st[PRE + k]);
        if (k) g.lineTo(X(k), y);
        else g.moveTo(X(k), y);
      }
      g.stroke();
      tag(g, L + 6, by + 10, '段階の間隔', COL.ch1, 'left');
      if (cur >= ON + 1 && cur < ON + 9)
        tag(g, X(ON + 1), T + 8, '音が急に大きくなり、段階が追いつかない', COL.ink, 'left');
    }
    /* 今の標本の段階を大きく見せる */
    if (inset) {
      const ix = W - inset + 12,
        iw = inset - 22,
        iy = T,
        ih = mainH,
        p = pv(cur),
        s = sv(cur),
        rg = rungs(stp(cur)),
        span = Math.max(rg[M] * 1.15, Math.abs(s - p) * 1.1),
        yi = (v: number) => iy + ih / 2 - ((v - p) / span) * (ih / 2 - 6),
        mag = code(cur) & M,
        neg = code(cur) >> (N - 1) === 1,
        chosen = neg ? p - rg[mag] : p + rg[mag];
      g.strokeStyle = COL.grid2;
      g.lineWidth = 1;
      g.strokeRect(ix + 0.5, iy + 0.5, iw, ih);
      for (let m = 0; m <= M; m++)
        for (const sg of [1, -1]) {
          const on = m === mag && (sg === -1) === neg,
            y = Math.round(yi(p + sg * rg[m])) + 0.5;
          if (y >= iy && y <= iy + ih) seg(g, ix + 18, y, ix + iw - 8, y, on ? COL.ch1 : COL.ink3, on ? 2 : 1);
        }
      const ys = Math.max(iy + 4, Math.min(iy + ih - 4, yi(s)));
      seg(g, ix + 40, yi(p), ix + 40, ys, COL.err, 2);
      g.fillStyle = COL.ch2;
      g.beginPath();
      g.arc(ix + 40, ys, 3.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = COL.ch1;
      g.beginPath();
      g.arc(ix + iw - 22, yi(chosen), 3.4, 0, Math.PI * 2);
      g.fill();
      g.font = `11px ${COL.mono}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(bitOf(code(cur)), ix + 5, iy + 11);
      g.font = `11px ${COL.sans}`;
      g.fillStyle = COL.ink2;
      g.textAlign = 'right';
      g.fillText(mag >= 4 ? '広げる' : '狭める', ix + iw - 4, iy + 11);
      g.textAlign = 'left';
      g.fillStyle = COL.ch2;
      g.fillText('実際の値', ix + 5, iy + ih - 24);
      g.fillStyle = COL.ch1;
      g.fillText('選んだ段階', ix + 5, iy + ih - 10);
      g.setLineDash([2, 3]);
      seg(g, X(cur), yv(p), ix, iy + ih / 2, COL.grid2);
      g.setLineDash([]);
    }
  } else {
    const by = T + mainH + gap,
      rev = Math.min(CNT - 1, Math.floor(ease(u / 0.8) * CNT)),
      bm = by + band * 0.74,
      sc = (band * 0.24) / 0.4;
    tag(g, L - 4, by + band * 0.2, 'ビット', COL.ch1, 'right');
    bits(by, band * 0.42, CNT - 1);
    g.strokeStyle = COL.ch1;
    g.lineWidth = 1.8;
    g.beginPath();
    for (let k = 0; k <= rev; k++) {
      if (k) {
        g.lineTo(X(k), yv(yo(k - 1)));
        g.lineTo(X(k), yv(yo(k)));
      } else g.moveTo(X(k), yv(yo(k)));
    }
    g.stroke();
    for (let k = 0; k <= rev; k++) dot(k, yo(k), COL.ch1, 2.4);
    seg(g, L, Math.round(bm) + 0.5, W - Rm, Math.round(bm) + 0.5, COL.grid);
    for (let k = 0; k <= rev; k++) {
      const e = Math.max(-0.4, Math.min(0.4, yo(k) - sv(k)));
      seg(g, X(k), bm, X(k), bm - e * sc, COL.err, Math.min(3, dx * 0.4));
    }
    tag(g, L - 4, bm, '誤差', COL.err, 'right');
    if (rev >= ON + 2 && rev < CNT - 12)
      tag(g, X(ON + 1), T + 8, '立ち上がりは追いつくまで誤差が大きい', COL.ink, 'left');
    if (rev >= CNT - 12) tag(g, X(ON + 12), T + 8, '追いついたあとは原音に沿う', COL.ink, 'left');
  }
}

/** 工程のカードの小さいアニメーション（t は秒。動きを減らす設定では固定の絵にする） */
export function drawThumb(c: HTMLCanvasElement, i: number, t: number): void {
  const a = surface(c);
  if (!a) return;
  const { g, w: W, h: H } = a,
    cy = H / 2,
    Am = H * 0.38,
    u = (t % 3) / 3,
    K = 11,
    xs = Array.from({ length: K }, (_, k) => ((k + 0.5) / K) * W),
    f = (x: number) => Math.sin((x / W) * Math.PI * 3 + 0.4),
    n = Math.floor(u * (K + 2)),
    dot = (x: number, v: number, col: string, r = 2.2) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(x, cy - v * Am, r, 0, Math.PI * 2);
      g.fill();
    },
    curve = (al: number) => {
      g.strokeStyle = COL.ch2;
      g.lineWidth = 1.2;
      g.globalAlpha = al;
      g.beginPath();
      for (let x = 0; x <= W; x += 1) {
        const y = cy - f(x) * Am;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
      g.globalAlpha = 1;
    };
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  if (i === 0) {
    curve(0.6);
    xs.forEach((x, k) => {
      if (k < n) dot(x, f(x), COL.ch2);
    });
  } else if (i === 1) {
    curve(0.4);
    xs.forEach((x, k) => {
      if (k === 0 || k >= n) return;
      const v = f(xs[k - 1]);
      seg(g, xs[k - 1], cy - v * Am, x, cy - v * Am, COL.ink2);
      dot(x, v, COL.ink2);
    });
  } else if (i === 2) {
    xs.forEach((x, k) => {
      if (!k) return;
      if (k < n) seg(g, x, cy - f(xs[k - 1]) * Am, x, cy - f(x) * Am, COL.err, 2);
      dot(x, f(x), COL.ch2, 1.8);
    });
  } else if (i === 3) {
    const k = Math.min(K - 1, n),
      p = k ? f(xs[k - 1]) : 0;
    curve(0.3);
    for (let m = -3; m <= 3; m++) {
      const y = cy - (p + m * 0.15) * Am;
      seg(g, xs[k] - 8, y, xs[k] + 8, y, COL.ink3);
    }
    for (let q = 0; q <= k; q++) dot(xs[q], f(xs[q]), COL.ch1, 1.8);
  } else if (i === 4) {
    const w = 0.08 + 0.3 * Math.abs(Math.sin(t * 1.6));
    for (let m = -3; m <= 3; m++) {
      const y = cy - m * w * Am;
      seg(g, W * 0.25, y, W * 0.75, y, COL.ink3);
    }
  } else {
    const rows = 4,
      rh = (H * 0.4) / rows,
      cw = W / K;
    xs.forEach((x, k) => {
      const c0 = Math.round((f(x) + 1) * 7.4);
      for (let r = 0; r < rows; r++) {
        g.fillStyle = COL.ch1;
        g.globalAlpha = k < n ? ((c0 >> (rows - 1 - r)) & 1 ? 0.95 : 0.14) : 0.06;
        g.fillRect(k * cw + 0.5, H * 0.58 + r * rh, cw - 1, rh - 1);
      }
      g.globalAlpha = 1;
      if (k < n) dot(x, f(x) * 0.5 + 0.55, COL.ch1, 1.8);
    });
  }
}

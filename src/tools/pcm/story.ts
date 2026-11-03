/**
 * 「1. PCM のしくみ」の図: 1 つの波を 5 つの工程で順に動かす。値は固定（8 kHz・4 bit・440 Hz の正弦波）で、
 * 下の入力では変わらない。u は工程の中の進み（0〜1）で、1 のときは工程を終えた絵になる
 */
import { bitStr, COL, levelList, readAt, surface, timeLabel, trigger, yAxisLabel } from './fig';
import { mod, type Quant, quantize, restore, sample, sine, stepOf } from './pcm';
import { comma, kHzLabel } from './text';

const F = 48000,
  DUR = 0.25,
  FS = 8000,
  N = 4;

export const STEPS = [
  ['音の波', '連続する波'],
  ['標本化', '一定の間隔で測る'],
  ['量子化', '近い値に丸める'],
  ['符号化', '2 進数にする'],
  ['再生', '波に戻す'],
] as const;

/** 工程ごとの説明 */
export const CAPTIONS = [
  '音は空気を伝わる圧力の変化です。マイクはこれを電圧の波に変えます。',
  `1 秒に ${comma(FS)} 回、波の高さを測ります。表せる音は ${kHzLabel(FS / 2)} kHz までです。`,
  `測った値を ${2 ** N} 段階のうち最も近い値に丸めます。丸めたずれは雑音になります。`,
  `丸めた値を ${N} ビットの 2 進数にします。1 秒で ${comma(FS)} × ${N} = ${comma(FS * N)} ビットです。`,
  '数値を電圧に戻すと階段状の波になり、ローパスフィルタで滑らかにします。',
] as const;

interface Data {
  x: Float32Array;
  s: Float64Array;
  q: Quant;
  o: Float32Array;
  t0: number;
}
let D: Data | null = null;
function data(): Data {
  if (D) return D;
  const x = Float32Array.from(sine(440, F, DUR), (v) => v * 10 ** (-3 / 20)),
    s = sample(x, F, FS, true),
    q = quantize(s, N),
    o = restore(q.y, F, FS, x.length, 'smooth');
  D = { x, s, q, o, t0: trigger(x, F, 0.1) };
  return D;
}

export const ease = (u: number): number => {
  const v = Math.max(0, Math.min(1, u));
  return v * v * (3 - 2 * v);
};

function tag(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: string,
  col: string,
  al: CanvasTextAlign = 'center',
  bold = true,
): void {
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
const seg = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string): void => {
  g.strokeStyle = col;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
};

export function drawStory(c: HTMLCanvasElement, st: number, u: number): void {
  const a = surface(c);
  if (!a) return;
  const { x, s, q, o, t0 } = data(),
    { g, w: W, h: H } = a,
    ms = W < 520 ? 2.5 : 5,
    L = Math.min(58, W * 0.14),
    Rm = 8,
    T = 18,
    band = st >= 2 ? Math.round(H * 0.18) : 0,
    gap = band ? 20 : 0,
    B = 20,
    mainH = H - T - band - gap - B,
    PW = W - L - Rm,
    cy = T + mainH / 2,
    A = mainH / 2 / 1.1,
    yv = (v: number) => cy - v * A,
    win = ms / 1000,
    xt = (t: number) => L + ((t - t0) / win) * PW,
    dx = PW / (win * FS),
    n0 = Math.ceil(t0 * FS),
    n1 = Math.floor((t0 + win) * FS),
    cnt = Math.max(1, n1 - n0),
    Nf = s.length,
    sAt = (n: number) => s[mod(n, Nf)],
    yAt = (n: number) => q.y[mod(n, Nf)],
    cAt = (n: number) => q.code[mod(n, Nf)];
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  seg(g, L, Math.round(cy) + 0.5, W - Rm, Math.round(cy) + 0.5, COL.grid2);
  yAxisLabel(g, 11, cy, '振幅');
  timeLabel(g, W - Rm, H - 2, ms);

  /* レベルの線と値 */
  const lvA = st === 2 ? ease(u / 0.3) : 1;
  if (st >= 2) {
    const lines = levelList(N, 'lin') ?? [];
    g.globalAlpha = lvA;
    for (const [, v] of lines) seg(g, L, Math.round(yv(v)) + 0.5, W - Rm, Math.round(yv(v)) + 0.5, COL.grid);
    g.font = `10.5px ${COL.mono}`;
    g.fillStyle = COL.ink3;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const [k, v] of lines) g.fillText(st >= 3 ? bitStr(k, N) : `${k}`.replace('-', '−'), L - 3, yv(v));
    g.globalAlpha = 1;
  }

  /* 元の波 */
  const inRev = st === 0 ? ease(u) : 1;
  g.strokeStyle = COL.ch2;
  g.lineWidth = st === 0 ? 2.2 : 1.4;
  g.globalAlpha = st >= 2 ? 0.55 : 1;
  g.beginPath();
  for (let px = 0; px <= PW * inRev; px += 1) {
    const y = yv(readAt(x, F, t0 + (px / PW) * win));
    if (px) g.lineTo(L + px, y);
    else g.moveTo(L + px, y);
  }
  g.stroke();
  g.globalAlpha = 1;
  if (st === 0 && inRev > 0.32) {
    tag(g, L + PW * 0.28, Math.max(T + 8, yv(readAt(x, F, t0 + 0.28 * win)) - 26), '音の波', COL.ch2);
    if (inRev > 0.8) {
      const bx = L + PW * 0.72,
        vy = yv(readAt(x, F, t0 + 0.72 * win));
      seg(g, bx, yv(0), bx, vy, COL.ink3);
      tag(g, bx + 6, (yv(0) + vy) / 2, 'この高さが音の大きさ', COL.ink2, 'left', false);
    }
  }

  /* 標本 */
  const revN = st === 1 ? Math.floor(ease(u / 0.85) * (cnt + 1)) : cnt + 1;
  if (st >= 1) {
    const slide = st === 2 ? ease((u - 0.3) / 0.5) : st > 2 ? 1 : 0;
    g.strokeStyle = COL.grid2;
    g.lineWidth = 1;
    g.beginPath();
    for (let n = n0, i = 0; n <= n1 && i < revN; n++, i++) {
      const X = Math.round(xt(n / FS)) + 0.5,
        v = sAt(n) + (yAt(n) - sAt(n)) * slide;
      g.moveTo(X, cy);
      g.lineTo(X, yv(v));
    }
    g.stroke();
    /* 階段と滑らかな波（再生） */
    if (st === 4) {
      const uS = ease(u / 0.45),
        uL = ease((u - 0.45) / 0.45);
      g.strokeStyle = COL.ch1;
      g.lineWidth = 1.6;
      g.globalAlpha = 1 - 0.55 * uL;
      g.beginPath();
      let first = true;
      const clip = (v: number) => Math.max(L, Math.min(L + PW * uS, v));
      for (let n = n0 - 1; n <= n1; n++) {
        const X0 = clip(xt(n / FS)),
          X1 = clip(xt((n + 1) / FS)),
          y = yv(yAt(n));
        if (first) {
          g.moveTo(X0, y);
          first = false;
        } else g.lineTo(X0, y);
        g.lineTo(X1, y);
      }
      g.stroke();
      g.globalAlpha = 1;
      if (uL > 0) {
        g.lineWidth = 2.4;
        g.beginPath();
        for (let px = 0; px <= PW * uL; px += 1) {
          const y = yv(readAt(o, F, t0 + (px / PW) * win));
          if (px) g.lineTo(L + px, y);
          else g.moveTo(L + px, y);
        }
        g.stroke();
      }
    }
    /* 点 */
    const rr = Math.max(1.8, Math.min(3.8, dx * 0.2));
    for (let n = n0, i = 0; n <= n1 && i < revN; n++, i++) {
      const X = xt(n / FS),
        vs = sAt(n),
        v = vs + (yAt(n) - vs) * slide;
      if (st >= 2 && st <= 3 && slide > 0) {
        g.strokeStyle = COL.err;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(X, yv(vs));
        g.lineTo(X, yv(v));
        g.stroke();
      }
      g.fillStyle = st >= 2 && slide > 0.5 ? COL.ch1 : COL.ch2;
      g.beginPath();
      g.arc(X, yv(v), st === 4 ? Math.max(1.4, rr - 1.2) : rr, 0, Math.PI * 2);
      g.fill();
    }
  }

  /* 図の中の説明 */
  if (st === 1) {
    if (revN > cnt * 0.75) {
      const i0 = n0 + Math.floor(cnt * 0.62),
        x0 = xt(i0 / FS),
        x1 = xt((i0 + 1) / FS),
        y = T + 6;
      g.strokeStyle = COL.ink;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x0, y - 4);
      g.lineTo(x0, y + 4);
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.moveTo(x1, y - 4);
      g.lineTo(x1, y + 4);
      g.stroke();
      tag(g, x1 + 6, y, `${1000 / FS} ms ごとに測る`, COL.ink, 'left');
    }
    if (revN > cnt * 0.25) {
      const n = n0 + Math.floor(cnt * 0.12),
        up = sAt(n) >= 0 ? 1 : -1;
      tag(g, xt(n / FS) + 4, yv(sAt(n)) - 22 * up, '標本', COL.ch2, 'left');
    }
  }
  if (st === 2 && lvA > 0.5) tag(g, L + 8, T + 2, `${2 ** N} 段階（${N} ビット）`, COL.ink, 'left');

  /* 下の帯 */
  if (band) {
    const by = T + mainH + gap,
      bm = by + band / 2,
      sc = (band / 2 - 1) / stepOf(N),
      lim = (v: number) => Math.max(-band / 2, Math.min(band / 2, v));
    if (st === 2) {
      const rev = ease((u - 0.55) / 0.45);
      g.globalAlpha = rev;
      seg(g, L, Math.round(bm) + 0.5, W - Rm, Math.round(bm) + 0.5, COL.grid);
      g.strokeStyle = COL.err;
      g.lineWidth = Math.max(1, Math.min(dx * 0.45, 3));
      g.beginPath();
      for (let n = n0; n <= n1; n++) {
        const X = xt(n / FS);
        g.moveTo(X, bm);
        g.lineTo(X, bm - lim(q.e[mod(n, Nf)] * sc));
      }
      g.stroke();
      tag(g, L - 4, bm, '誤差', COL.err, 'right');
      g.globalAlpha = 1;
    } else if (st === 3) {
      const rh = band / N,
        rev = Math.floor(ease(u / 0.85) * (cnt + 1)),
        cw = Math.max(1, dx - 1);
      tag(g, L - 4, bm, 'ビット', COL.ch1, 'right');
      for (let n = n0, i = 0; n <= n1 && i < rev; n++, i++) {
        const X = xt(n / FS) - cw / 2,
          tx = bitStr(cAt(n), N);
        for (let r = 0; r < N; r++) {
          const on = tx[r] === '1';
          g.fillStyle = COL.ch1;
          g.globalAlpha = on ? 0.95 : 0.13;
          g.fillRect(X, by + r * rh, cw, rh - 1);
          g.globalAlpha = 1;
          if (cw >= 13 && rh >= 11) {
            g.font = `10px ${COL.mono}`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillStyle = on ? COL.screen : COL.ink3;
            g.fillText(on ? '1' : '0', X + cw / 2, by + (r + 0.5) * rh);
          }
        }
      }
      /* 今の標本 */
      if (rev >= 1 && rev <= cnt) {
        const n = n0 + rev - 1,
          X = xt(n / FS),
          yy = yv(yAt(n));
        g.strokeStyle = COL.accent;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(X, yy, 6, 0, Math.PI * 2);
        g.moveTo(X, yy + 6);
        g.lineTo(X, by);
        g.stroke();
      }
    } else {
      const rev = ease((u - 0.55) / 0.45);
      g.globalAlpha = rev;
      seg(g, L, Math.round(bm) + 0.5, W - Rm, Math.round(bm) + 0.5, COL.grid);
      g.strokeStyle = COL.err;
      g.lineWidth = 1.2;
      g.beginPath();
      for (let px = 0; px <= PW; px += 1) {
        const t = t0 + (px / PW) * win,
          y = bm - lim((readAt(o, F, t) - readAt(x, F, t)) * sc);
        if (px) g.lineTo(L + px, y);
        else g.moveTo(L + px, y);
      }
      g.stroke();
      tag(g, L + 4, by + 8, '原音との差', COL.err, 'left');
      g.globalAlpha = 1;
    }
  }
  /* 値の横の 2 進数 */
  if (st === 3 && dx >= 11) {
    const rev = Math.floor(ease(u / 0.85) * (cnt + 1)),
      tw = N * 6.8 + 2;
    g.font = `10.5px ${COL.mono}`;
    g.fillStyle = COL.ch1;
    g.textBaseline = 'middle';
    for (let n = n0, i = 0; n <= n1 && i < rev; n++, i++) {
      const X = xt(n / FS),
        yy = yv(yAt(n)),
        tx = bitStr(cAt(n), N),
        up = yAt(n) >= 0;
      if (dx >= tw) {
        g.textAlign = 'center';
        g.fillText(tx, X, yy + (up ? -11 : 11));
      } else {
        g.save();
        g.translate(X, yy + (up ? -8 : 8));
        g.rotate(-Math.PI / 2);
        g.textAlign = up ? 'left' : 'right';
        g.fillText(tx, 0, 0);
        g.restore();
      }
    }
  }
  if (st === 4) {
    const uS = ease(u / 0.45),
      uL = ease((u - 0.45) / 0.45),
      at = (f: number): [number, number] => {
        const n = n0 + Math.floor(cnt * f);
        return [xt(n / FS), yv(yAt(n))];
      },
      place = (Y: number) => Math.max(T + 6, Math.min(T + mainH - 6, Y + (Y < cy ? -22 : 22)));
    if (uS > 0.5) {
      const [X, Y] = at(0.2);
      tag(g, X, place(Y), '階段状の波', COL.ch1);
    }
    if (uL > 0.6) {
      const [X, Y] = at(0.62);
      tag(g, X, place(Y), 'ローパス後', COL.ch1);
      tag(g, L + 8, T + 2, '青が原音', COL.ch2, 'left', false);
    }
  }
  /* 大きいずれを離れた位置で数か所指す */
  if (st === 2 && u > 0.7) {
    const cand: [number, number][] = [];
    for (let n = n0; n <= n1; n++) if (xt(n / FS) < L + PW * 0.88) cand.push([Math.abs(yAt(n) - sAt(n)), n]);
    cand.sort((p, q) => q[0] - p[0]);
    const picked: number[] = [],
      gapX = Math.max(90, W * 0.2);
    for (const [, n] of cand) {
      const X = xt(n / FS);
      if (picked.length < 4 && picked.every((q) => Math.abs(q - X) >= gapX)) picked.push(X);
      if (picked.length === 4) break;
    }
    for (const X of picked) {
      const n = Math.round(((X - L) / PW) * win * FS + t0 * FS),
        Y = (yv(yAt(n)) + yv(sAt(n))) / 2,
        d = Y < cy ? -1 : 1;
      seg(g, X + 3, Y, X + 16, Y + d * 16, COL.err);
      tag(g, X + 19, Y + d * 18, 'ずれ', COL.err, 'left');
    }
  }
}

/** 工程のカードの小さいアニメーション（t は秒。動きを減らす設定では固定の絵にする） */
export function drawThumb(c: HTMLCanvasElement, i: number, t: number): void {
  const a = surface(c);
  if (!a) return;
  const { g, w: W, h: H } = a,
    cy = H / 2,
    A = H * 0.38,
    u = (t % 3) / 3,
    f = (x: number) => Math.sin((x / W) * Math.PI * 3 + 0.4),
    K = 11,
    xs = Array.from({ length: K }, (_, k) => ((k + 0.5) / K) * W),
    Lv = 3,
    rd = (v: number) => Math.round(v * Lv) / Lv;
  g.fillStyle = COL.screen;
  g.fillRect(0, 0, W, H);
  const line = (fn: (x: number) => number, col: string, lw: number, end = W, alpha = 1) => {
    g.strokeStyle = col;
    g.lineWidth = lw;
    g.globalAlpha = alpha;
    g.beginPath();
    for (let x = 0; x <= end; x += 1) {
      const y = cy - fn(x) * A;
      if (x) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    g.globalAlpha = 1;
  };
  const dot = (x: number, v: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, cy - v * A, 2.2, 0, Math.PI * 2);
    g.fill();
  };
  if (i === 0) line((x) => Math.sin(((x + t * 40) / W) * Math.PI * 3), COL.ch2, 1.8);
  else if (i === 1) {
    line(f, COL.ch2, 1.2, W, 0.6);
    const n = Math.floor(u * (K + 2));
    xs.forEach((x, k) => {
      if (k >= n) return;
      seg(g, x, cy, x, cy - f(x) * A, COL.grid2);
      dot(x, f(x), COL.ch2);
    });
  } else if (i === 2) {
    for (let k = -Lv; k <= Lv; k++)
      seg(g, 0, Math.round(cy - (k / Lv) * A) + 0.5, W, Math.round(cy - (k / Lv) * A) + 0.5, COL.grid);
    const sl = ease((u - 0.2) / 0.5);
    for (const x of xs) dot(x, f(x) + (rd(f(x)) - f(x)) * sl, sl > 0.5 ? COL.ch1 : COL.ch2);
  } else if (i === 3) {
    const rows = 4,
      rh = (H - 4) / rows,
      cw = W / K,
      n = Math.floor(u * (K + 2));
    xs.forEach((x, k) => {
      const c0 = Math.round((f(x) + 1) * 7.4);
      for (let r = 0; r < rows; r++) {
        g.fillStyle = COL.ch1;
        g.globalAlpha = k < n ? ((c0 >> (rows - 1 - r)) & 1 ? 0.95 : 0.14) : 0.06;
        g.fillRect(k * cw + 0.5, 2 + r * rh, cw - 1, rh - 1);
      }
    });
    g.globalAlpha = 1;
  } else {
    const sl = ease((u - 0.25) / 0.4),
      st = (x: number) => rd(f(xs[Math.min(K - 1, Math.floor((x / W) * K))]));
    line(st, COL.ch1, 1.3, W, 1 - 0.6 * sl);
    if (sl > 0) line(f, COL.ch1, 2, W * sl);
  }
}

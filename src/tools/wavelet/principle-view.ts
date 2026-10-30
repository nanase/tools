/**
 * 原理の枠: 1 フーリエ変換では「いつ」が消える・2 短い波を重ねて掛けて足す・4 隣り合う 2 つの平均と差
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { el, lutOf, maxAbs, paint, rgb, svgPt, trace, txt } from './fig';
import {
  centered,
  cutSmall,
  dftMag,
  freqOfJ,
  haarRebuild,
  haarRows,
  jOfFreq,
  outCoi,
  PJ,
  PN,
  PS,
  probe,
  type Scalo,
  scaloOf,
  twoTones,
} from './principle';
import { type Sig, sample } from './signals';

const W = 400,
  /** スカログラムの高さ（SVG の単位） */
  MH = 240,
  /** スカログラムの色の範囲 dB（最も大きい所から） */
  RANGE = 30;
const yOfJ = (j: number) => (j / PJ) * MH;

/** スカログラムを塗る（上が高い周波数）。mask が 0 の所は塗らずに市松にする */
function paintScalo(cv: HTMLCanvasElement, lut: Uint8Array, m: Scalo, mask?: Uint8Array): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const cw = cv.width,
    ch = cv.height,
    img = ctx.createImageData(cw, ch);
  for (let r = 0; r < ch; r++) {
    const j = Math.round((r * PJ) / (ch - 1));
    for (let q = 0; q < cw; q++) {
      const n = Math.floor((q * PN) / cw),
        o = (r * cw + q) * 4;
      if (mask && !mask[j * PN + n]) {
        const g = ((r >> 4) + (q >> 4)) % 2 ? 22 : 14;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
        img.data[o + 3] = 255;
        continue;
      }
      const a = Math.hypot(m.re[j][n], m.im[j][n]) / m.mx,
        dim = outCoi(j, n) ? (((r >> 1) + (q >> 1)) % 3 === 0 ? 0.3 : 0.62) : 1;
      paint(lut, (20 * Math.log10(a + 1e-9) + RANGE) / RANGE, img.data, o, dim);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** スカログラムの目盛り（周波数と時間）と枠 */
function scaloAxes(svg: SVGSVGElement): void {
  const g = el('g');
  for (const f of [2, 4, 8, 16, 32, 64, 128])
    g.append(el('text', { x: -6, y: yOfJ(jOfFreq(f)) + 4, 'text-anchor': 'end' }, f === 128 ? '128 Hz' : String(f)));
  for (const t of [0, 0.25, 0.5, 0.75, 1])
    g.append(
      el(
        'text',
        { x: t * W, y: MH + 16, 'text-anchor': t === 0 ? 'start' : t === 1 ? 'end' : 'middle' },
        t === 1 ? '1 s' : String(t),
      ),
    );
  g.append(el('rect', { class: 'gb', x: 0, y: 0, width: W, height: MH }));
  svg.prepend(g);
}

/* ================= 1 フーリエ変換では「いつ」が消える ================= */
export function initOrder(): void {
  const xs = $<SVGSVGElement>('#or-x'),
    fs = $<SVGSVGElement>('#or-f'),
    cv = $<HTMLCanvasElement>('#or-m'),
    lut = lutOf('.a-or'),
    K = 48,
    FH = 120;
  scaloAxes($<SVGSVGElement>('#or-s'));
  /* 比べる波の形: 正弦波は区間の端から端まで続き、ウェーブレットは短い */
  {
    const sine = Float64Array.from({ length: PN }, (_, n) => Math.sin((2 * Math.PI * 8 * n) / PN)),
      wav = Float64Array.from({ length: PN }, (_, n) => {
        const e = (n - PN * 0.7) / 10;
        return Math.cos(6 * e) * Math.exp((-e * e) / 2);
      });
    $<SVGSVGElement>('#or-k').replaceChildren(
      el('text', { x: -6, y: 18, 'text-anchor': 'end' }, '正弦波'),
      el('path', { class: 't1', d: trace(sine, 0, W, 14, 10), 'stroke-width': 1.3 }),
      el('text', { x: -6, y: 48, 'text-anchor': 'end' }, 'ウェーブレット'),
      el('path', { class: 't1', d: trace(wav, 0, W, 44, 11), 'stroke-width': 1.5 }),
    );
  }
  function draw(swap: boolean): void {
    const x = twoTones(swap),
      lab = (f: number, left: boolean) =>
        el('text', { class: 'tl', x: left ? 100 : 300, y: 4, 'text-anchor': 'middle' }, `${f} Hz`);
    xs.replaceChildren(
      el('line', { class: 'gl', x1: 0, y1: 30, x2: W, y2: 30 }),
      el('path', { class: 't2', d: trace(x, 0, W, 30, 24), 'stroke-width': 1.4 }),
      lab(6, !swap),
      lab(32, swap),
      el('text', { x: -6, y: 34, 'text-anchor': 'end' }, 'x'),
    );
    /* |DFT| 0〜48 Hz（どちらの順でも同じ） */
    const mag = dftMag(x, K),
      mx = maxAbs(mag),
      bw = W / (K + 1);
    fs.replaceChildren(el('line', { class: 'gl', x1: 0, y1: FH, x2: W, y2: FH }));
    mag.forEach((m, k) => {
      const h = (m / mx) * (FH - 6);
      fs.append(el('rect', { class: 'fq', x: k * bw + 1, y: FH - h, width: bw - 2, height: h }));
    });
    for (const f of [0, 6, 16, 32, 48])
      fs.append(
        el(
          'text',
          { x: (f + 0.5) * bw, y: FH + 16, 'text-anchor': f === 0 ? 'start' : f === 48 ? 'end' : 'middle' },
          f === 48 ? '48 Hz' : String(f),
        ),
      );
    fs.append(el('text', { x: -6, y: 14, 'text-anchor': 'end' }, '|X|'));
    paintScalo(cv, lut, scaloOf(x));
  }
  new Choice<string>($('#or-ord'), (v) => draw(v === 'hl'));
  draw(false);
}

/* ================= 2 短い波を重ねて、掛けて足す ================= */
export function initSlide(): void {
  const pnl = $('.a-sl'),
    xs = $<SVGSVGElement>('#sl-x'),
    ps = $<SVGSVGElement>('#sl-p'),
    gs = $<SVGSVGElement>('#sl-g'),
    cv = $<HTMLCanvasElement>('#sl-m'),
    ov = $<SVGSVGElement>('#sl-s'),
    rng = $<HTMLInputElement>('#sl-w'),
    lut = lutOf('.a-sl');
  const S = { sig: 'two', u: 64, j: Math.round(jOfFreq(6)), hand: false };
  let x = twoTones(),
    M = scaloOf(x),
    mask = new Uint8Array((PJ + 1) * PN),
    raf = 0;
  rng.max = String(PJ);
  scaloAxes(ov);
  const mark = el('g', { class: 'mk' });
  ov.append(mark);

  const load = () => {
    x = S.sig === 'two' ? twoTones() : centered(sample(S.sig as Sig, PN));
    M = scaloOf(x);
  };
  const reveal = (j0: number, n0: number, dj = 1, dn = 3) => {
    for (let j = Math.max(0, j0 - dj); j <= Math.min(PJ, j0 + dj); j++)
      for (let n = Math.max(0, n0 - dn); n <= Math.min(PN - 1, n0 + dn); n++) mask[j * PN + n] = 1;
  };
  const repaint = () => paintScalo(cv, lut, M, S.hand ? mask : undefined);

  function draw(): void {
    const s = PS[S.j],
      u = S.u,
      p = probe(x, u, s),
      v = p.mag / M.mx,
      kx = 24 / maxAbs(x),
      kp = maxAbs(p.psi),
      x0 = Math.max(0, ((u - 2 * s * PN) / PN) * W),
      x1 = Math.min(W, ((u + 2 * s * PN) / PN) * W);
    /* 信号とウェーブレット（波の山の位置は一番合う所へずらす） */
    xs.replaceChildren(
      el('rect', { class: 'span', x: x0, y: 0, width: x1 - x0, height: 56 }),
      el('line', { class: 'gl', x1: 0, y1: 28, x2: W, y2: 28 }),
      el('path', { class: 't2', d: trace(x, 0, W, 28, kx), 'stroke-width': 1.3 }),
      el('path', { class: 'wv', d: trace(p.psi, 0, W, 28, 24 / kp) }),
      el('text', { x: -6, y: 32, 'text-anchor': 'end' }, 'x・ψ'),
    );
    /* 掛けた値: + と − を塗り分ける。目盛りは |x| と |ψ| の最大の積で決め、似ていないと小さく見える */
    const kq = 24 / (maxAbs(x) * kp);
    let dp = 'M0 28',
      dn = 'M0 28';
    for (let n = 0; n < PN; n++) {
      const X = ((W * (n + 0.5)) / PN).toFixed(1),
        q = p.prod[n];
      dp += `L${X} ${(28 - kq * Math.max(0, q)).toFixed(1)}`;
      dn += `L${X} ${(28 - kq * Math.min(0, q)).toFixed(1)}`;
    }
    ps.replaceChildren(
      el('path', { class: 'pp', d: `${dp}L${W} 28Z` }),
      el('path', { class: 'pn', d: `${dn}L${W} 28Z` }),
      el('line', { class: 'gl', x1: 0, y1: 28, x2: W, y2: 28 }),
      el('text', { x: -6, y: 32, 'text-anchor': 'end' }, 'x × ψ'),
    );
    /* 合計: スカログラムの 1 番明るい所で 1。棒の色はスカログラムの同じ所の色 */
    gs.replaceChildren(
      el('rect', { class: 'gb', x: 0, y: 3, width: W, height: 16 }),
      el('rect', {
        x: 0,
        y: 3,
        width: Math.min(1, v) * W,
        height: 16,
        fill: rgb(lut, Math.max(0.12, (20 * Math.log10(v + 1e-9) + RANGE) / RANGE)),
      }),
      ...[0.25, 0.5, 0.75].map((t) => el('line', { class: 'gl', x1: t * W, y1: 19, x2: t * W, y2: 23 })),
      el('text', { x: -6, y: 15, 'text-anchor': 'end' }, '合計'),
    );
    rng.value = String(S.j);
    rng.style.setProperty('--p', String(S.j / PJ));
    const f = freqOfJ(S.j),
      fd = f < 10 ? 1 : 0;
    txt(
      '#sl-rd',
      `t ${(u / PN).toFixed(2)} s  ${f.toFixed(fd)} Hz  幅 ${(4 * s * 1000).toFixed(0)} ms  合計 ${v.toFixed(2)}`,
    );
    /* スカログラムの印: 位置の縦線、幅の帯（±2s）、丸 */
    const mx = ((u + 0.5) / PN) * W,
      my = yOfJ(S.j);
    mark.replaceChildren(
      el('rect', { class: 'mb', x: x0, y: my - 4, width: x1 - x0, height: 8 }),
      el('line', { x1: mx, y1: 0, x2: mx, y2: MH }),
      el('circle', { cx: mx, cy: my, r: 4 }),
    );
  }
  const set = (u: number, j: number) => {
    S.u = Math.max(0, Math.min(PN - 1, Math.round(u)));
    S.j = Math.max(0, Math.min(PJ, Math.round(j)));
    if (S.hand) {
      reveal(S.j, S.u);
      repaint();
    }
    draw();
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    pnl.classList.remove('run');
  };
  /* スカログラムを押す・なぞる: 位置と幅を選ぶ */
  const onScalo = (e: PointerEvent) => {
    const q = svgPt(ov, e);
    if (q) set((q[0] / W) * PN, (q[1] / MH) * PJ);
  };
  ov.addEventListener('pointerdown', (e) => {
    stop();
    ov.setPointerCapture(e.pointerId);
    onScalo(e);
  });
  ov.addEventListener('pointermove', (e) => {
    if (e.buttons) onScalo(e);
  });
  ov.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    stop();
    set(S.u + d[0], S.j + d[1]);
  });
  /* 信号を引く: 位置だけ動かす */
  const onSig = (e: PointerEvent) => {
    const q = svgPt(xs, e);
    if (q) set((q[0] / W) * PN, S.j);
  };
  xs.addEventListener('pointerdown', (e) => {
    stop();
    xs.setPointerCapture(e.pointerId);
    onSig(e);
  });
  xs.addEventListener('pointermove', (e) => {
    if (e.buttons) onSig(e);
  });
  rng.addEventListener('input', () => {
    stop();
    set(S.u, Number(rng.value));
  });
  /* 掃引: 今の幅で左から右へ 1.6 秒 */
  $('#sl-sweep').addEventListener('click', () => {
    if (raf) {
      stop();
      return;
    }
    const t0 = performance.now(),
      j = S.j;
    pnl.classList.add('run');
    const tick = (now: number) => {
      const r = Math.min(1, (now - t0) / 1600),
        u = r * (PN - 1);
      if (S.hand) for (let n = Math.max(0, S.u - 4); n <= u; n++) reveal(j, n, 0, 0);
      set(u, j);
      if (r < 1) raf = requestAnimationFrame(tick);
      else stop();
    };
    raf = requestAnimationFrame(tick);
  });
  $('#sl-clear').addEventListener('click', () => {
    mask = new Uint8Array((PJ + 1) * PN);
    repaint();
  });
  new Choice<string>($('#sl-sig'), (v) => {
    stop();
    S.sig = v;
    load();
    mask = new Uint8Array((PJ + 1) * PN);
    repaint();
    draw();
  });
  new Choice<string>($('#sl-reveal'), (v) => {
    S.hand = v === 'hand';
    pnl.dataset.hand = S.hand ? '1' : '0';
    repaint();
  });
  pnl.dataset.hand = '0';
  repaint();
  draw();
}

/* ================= 4 隣り合う 2 つの平均と差 ================= */
export function initHaar8(): void {
  const svg = $<SVGSVGElement>('#h8-svg'),
    x = [4, 6, 10, 12, 8, 6, 5, 5],
    S = { lev: 3, cut: false, hov: null as null | { r: number; i: number } },
    CW = 50,
    BH = 100,
    TOP = 18,
    VMAX = 16,
    RH = 38,
    /** 0 にする差の大きさ */
    TH = 1;
  const fn = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('-', '−');
  const vOf = (py: number) => Math.max(0, Math.min(VMAX, Math.round(((TOP + BH - py) / BH) * VMAX * 2) / 2));

  function draw(): void {
    const R = haarRows(x),
      last = S.cut ? cutSmall(R[3].v, TH) : R[3].v,
      rec = haarRebuild(last),
      ky = BH / VMAX,
      h = S.hov && S.hov.r <= S.lev ? S.hov : null,
      /** 触れているマスの組の番号（平均かその段の差のとき） */
      hk = h && h.r >= 1 && h.i < 2 * R[h.r].na ? h.i % R[h.r].na : -1;
    svg.replaceChildren(el('text', { x: -8, y: TOP + BH - 2, 'text-anchor': 'end' }, 'x'));
    /* 段 0: 8 本の棒（上下に引いて変える） */
    x.forEach((v, i) => {
      const hl = h?.r === 1 && hk >= 0 && Math.floor(i / 2) === hk;
      svg.append(
        el('rect', {
          class: `h8b${hl ? ' hl' : ''}`,
          x: i * CW + 8,
          y: TOP + BH - v * ky,
          width: CW - 16,
          height: Math.max(0.5, v * ky),
        }),
        el('text', { x: i * CW + CW / 2, y: TOP + BH - v * ky - 4, 'text-anchor': 'middle' }, fn(v)),
      );
      if (S.cut)
        svg.append(
          el('rect', { class: 'h8g', x: i * CW + 4, y: TOP + BH - rec[i] * ky - 1, width: CW - 8, height: 2 }),
        );
    });
    /* 段 1〜3: [平均 | その段の差 | 前の段までの差] */
    for (let r = 1; r <= S.lev; r++) {
      const y0 = TOP + BH + 14 + (r - 1) * (RH + 6),
        { v, na } = R[r];
      svg.append(el('text', { x: -8, y: y0 + RH / 2 + 4, 'text-anchor': 'end' }, `${r} 段`));
      v.forEach((val, i) => {
        const kind = i < na ? 'a' : i < 2 * na ? 'd' : 'o',
          zero = r === 3 && S.cut && last[i] === 0 && i > 0,
          hl = h && ((h.r === r && h.i === i) || (h.r === r + 1 && hk >= 0 && i < na && Math.floor(i / 2) === hk)),
          g = el('g', { class: `h8c ${kind}${hl ? ' hl' : ''}${zero ? ' z' : ''}`, 'data-r': r, 'data-i': i }),
          bh = kind === 'a' ? (val / VMAX) * (RH - 6) : (val / 8) * (RH / 2 - 3),
          by = kind === 'a' ? y0 + RH - 3 - bh : y0 + RH / 2 - Math.max(0, bh);
        g.append(
          el('rect', { class: 'fr', x: i * CW + 2, y: y0, width: CW - 4, height: RH, rx: 3 }),
          el('rect', { class: 'mi', x: i * CW + 6, y: by, width: 5, height: Math.max(0.5, Math.abs(bh)) }),
          el('text', { x: i * CW + CW / 2 + 4, y: y0 + RH / 2 + 4, 'text-anchor': 'middle' }, zero ? '0' : fn(val)),
        );
        svg.append(g);
      });
    }
    svg.setAttribute('viewBox', `-48 0 452 ${TOP + BH + 14 + S.lev * (RH + 6) + 2}`);
    txt('#h8-lev', `段 ${S.lev} / 3`);
    /* 読み */
    if (h && hk >= 0) {
      const pv = R[h.r - 1].v,
        a = pv[2 * hk],
        b = pv[2 * hk + 1];
      txt(
        '#h8-rd',
        `平均 (${fn(a)} + ${fn(b)}) / 2 = ${fn((a + b) / 2)}  差 (${fn(a)} − ${fn(b)}) / 2 = ${fn((a - b) / 2)}  復元 ${fn((a + b) / 2)} ± ${fn((a - b) / 2)} → ${fn(a)}, ${fn(b)}`,
      );
    } else if (S.cut) {
      const nz = last.filter((v, i) => i > 0 && v === 0).length,
        err = Math.max(...rec.map((v, i) => Math.abs(v - x[i])));
      txt('#h8-rd', `0 にした差 ${nz} / 7  復元の誤差 最大 ${fn(err)}`);
    } else txt('#h8-rd', '');
  }
  /* 棒を上下に引く・マスに触れる */
  let drag = -1;
  const pick = (e: PointerEvent) => {
    const t = (e.target as Element).closest<SVGGElement>('g.h8c');
    return t ? { r: Number(t.dataset.r), i: Number(t.dataset.i) } : null;
  };
  svg.addEventListener('pointerdown', (e) => {
    const q = svgPt(svg, e);
    if (q && q[1] < TOP + BH + 8 && q[0] >= 0 && q[0] < 8 * CW) {
      drag = Math.floor(q[0] / CW);
      svg.setPointerCapture(e.pointerId);
      x[drag] = vOf(q[1]);
      S.hov = null;
      draw();
      return;
    }
    S.hov = pick(e);
    draw();
  });
  svg.addEventListener('pointermove', (e) => {
    if (drag >= 0 && e.buttons) {
      const q = svgPt(svg, e);
      if (q) x[drag] = vOf(q[1]);
      draw();
      return;
    }
    if (e.pointerType !== 'mouse') return;
    const nh = pick(e);
    if (nh?.r !== S.hov?.r || nh?.i !== S.hov?.i) {
      S.hov = nh;
      draw();
    }
  });
  svg.addEventListener('pointerup', () => {
    drag = -1;
  });
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse' || drag >= 0) return;
    S.hov = null;
    draw();
  });
  $('#h8-home').addEventListener('click', () => {
    S.lev = 0;
    draw();
  });
  $('#h8-next').addEventListener('click', () => {
    S.lev = S.lev >= 3 ? 0 : S.lev + 1;
    draw();
  });
  new Choice<string>($('#h8-cut'), (v) => {
    S.cut = v === 'on';
    if (S.cut) S.lev = 3;
    draw();
  });
  draw();
}

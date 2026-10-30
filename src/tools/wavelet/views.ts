/**
 * 平面より下の枠: 分解を段ごとに（Mallat の算法を動かす）・多重解像度の成分・係数を捨てて戻す・スカログラム
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { coiPeriod, cwt, fourierFactor, power, scales } from './cwt';
import {
  analyze,
  bank,
  compress,
  denoise,
  flat,
  mra,
  type Shrink,
  sigmaMad,
  snr,
  universal,
  type Wav,
  wavedec,
  waverec,
} from './dwt';
import { el, fx, html, lutOf, maxAbs, paint, svgPt, trace, txt } from './fig';
import { SHRINK, type ShKey } from './params';
import { noisy, type Sig, sample } from './signals';

const W = 400;

/* ================= 分解を段ごとに ================= */
/**
 * 行 j は j 段まで分けた係数の並び [a_j | d_j | d_(j−1) | … | d_1]（どの係数も同じ間隔）。
 * 動かすと、1 つ上の行の近似の上をフィルタが 2 つずつ進み、近似と詳細を 1 組ずつ作る
 */
export function initSteps(onLevel: (s: string) => void): void {
  const N = 128,
    J = 5,
    RH = 46,
    DUR = 1.6,
    dx = W / N;
  const S = { sig: 'heavisine' as Sig, w: 'db2' as Wav, lev: J, k: 0, run: false };
  let A: Float64Array[] = [],
    D: Float64Array[] = [],
    last = 0;
  const svg = $<SVGSVGElement>('#st-svg'),
    pp = $<HTMLButtonElement>('#st-pp');
  $('#st-phs').innerHTML = Array.from({ length: J }, (_, i) => `<span>段 ${i + 1}</span>`).join('');
  const phs = Array.from($('#st-phs').children) as HTMLElement[];

  function compute(): void {
    A = [sample(S.sig, N)];
    D = [];
    for (let j = 1; j <= J; j++) {
      const r = analyze(A[j - 1], S.w);
      A.push(r.a);
      D.push(r.d);
    }
    draw();
  }

  function draw(): void {
    const kd = 17 / Math.max(...D.map((d) => maxAbs(d))),
      L = bank(S.w).h.length,
      /* 今作っている段と、その段で作った組の数 */
      cur = S.lev < J && S.k > 0 ? S.lev + 1 : 0,
      shown = RM.matches ? 0 : S.k;
    svg.replaceChildren();
    for (let j = 0; j <= J; j++) {
      const y0 = j * RH + RH / 2;
      svg.append(el('text', { x: -8, y: y0 + 4, 'text-anchor': 'end' }, j ? `段 ${j}` : 'x'));
      svg.append(el('line', { class: 'gl', x1: 0, y1: y0, x2: W, y2: y0 }));
      if (j > Math.max(S.lev, cur)) continue;
      const nj = N >> j,
        upto = cur && j === cur ? Math.floor(shown * nj) : nj,
        ka = 17 / maxAbs(A[j]);
      /* 近似 */
      svg.append(
        el('path', { class: 't2', d: trace(A[j].subarray(0, upto), 0, upto * dx, y0, ka, true), 'stroke-width': 1.3 }),
      );
      /* 詳細: この段で作るものは CH1 の色、前の段のものは灰色（右へ d_(j−1) … d_1） */
      let s = '',
        g = '';
      for (let i = 1; i <= j; i++) {
        const d = D[i - 1],
          n = d.length,
          x0 = (N >> i) * dx,
          m = i === j ? upto : n;
        for (let q = 0; q < m; q++) {
          const seg = `M${(x0 + (q + 0.5) * dx).toFixed(2)} ${y0}V${(y0 - Math.max(-20, Math.min(20, kd * d[q]))).toFixed(1)}`;
          if (i === j) s += seg;
          else g += seg;
        }
      }
      if (g) svg.append(el('path', { class: 'sh-g', d: g, 'stroke-width': 1.4 }));
      if (s) svg.append(el('path', { class: 'st-d', d: s, 'stroke-width': 1.8 }));
      /* 動いているフィルタ: 1 つ上の行の近似の上 */
      if (cur && j === cur && upto < nj) {
        const xa = 2 * upto * dx,
          yp = (j - 1) * RH;
        svg.append(
          el('rect', {
            class: 'st-f',
            x: xa,
            y: yp + 4,
            width: Math.min(L * dx, (N >> (j - 1)) * dx - xa),
            height: RH - 8,
          }),
        );
        svg.append(
          el('path', {
            class: 'st-fl',
            d: `M${(xa + (L * dx) / 2).toFixed(1)} ${yp + RH - 4}L${(upto * dx).toFixed(1)} ${y0 - 4}M${(xa + (L * dx) / 2).toFixed(1)} ${yp + RH - 4}L${((nj + upto) * dx).toFixed(1)} ${y0 - 4}`,
          }),
        );
      }
    }
    const lv = cur || S.lev;
    phs.forEach((p, i) => {
      p.classList.toggle('on', i + 1 === lv && (cur > 0 || S.lev > 0));
      p.classList.toggle('done', i + 1 < lv);
    });
    txt('#st-n', String(cur ? Math.floor(shown * (N >> cur)) : S.lev ? N >> S.lev : 0));
    txt('#st-len', lv ? `長さ ${N >> (lv - 1)} → ${N >> lv} + ${N >> lv}` : `長さ ${N}`);
    txt('#st-aux', `${N} 点・${J} 段`);
    pp.classList.toggle('on', S.run);
    pp.title = S.run ? '一時停止' : '分解を動かす';
    pp.setAttribute('aria-label', pp.title);
    onLevel(`${lv} / ${J}`);
  }

  function tick(now: number): void {
    if (!S.run) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    S.k += dt / DUR;
    if (S.k >= 1) {
      S.k = 0;
      S.lev++;
      if (S.lev >= J) S.run = false;
    }
    draw();
    if (S.run) requestAnimationFrame(tick);
  }
  pp.addEventListener('click', () => {
    if (!S.run && S.lev >= J) {
      S.lev = 0;
      S.k = 0;
    }
    S.run = !S.run;
    last = performance.now();
    if (S.run && S.k === 0) S.k = 1e-6;
    draw();
    if (S.run) requestAnimationFrame(tick);
  });
  $('#st-step').addEventListener('click', () => {
    S.run = false;
    if (S.lev >= J) S.lev = 0;
    else S.lev++;
    S.k = 0;
    draw();
  });
  $('#st-home').addEventListener('click', () => {
    S.run = false;
    S.lev = 0;
    S.k = 0;
    draw();
  });
  new Choice<Sig>($('#st-sig'), (v) => {
    S.sig = v;
    compute();
  });
  new Choice<Wav>($('#st-w'), (v) => {
    S.w = v;
    compute();
  });
  compute();
}

/* ================= 多重解像度の成分 ================= */
export function initMra(): void {
  const N = 512,
    J = 5,
    RH = 34;
  const S = { sig: 'doppler' as Sig, w: 'db4' as Wav };
  const svg = $<SVGSVGElement>('#mr-svg');
  function draw(): void {
    const x = sample(S.sig, N),
      parts = mra(wavedec(x, S.w, J)),
      k = 14 / maxAbs(x),
      names = ['x', `A${J}`, ...Array.from({ length: J }, (_, i) => `D${J - i}`)];
    svg.replaceChildren();
    svg.setAttribute('viewBox', `-52 -4 460 ${(parts.length + 1) * RH + 6}`);
    [x, ...parts].forEach((p, i) => {
      const y0 = i * RH + RH / 2;
      svg.append(el('text', { x: -8, y: y0 + 4, 'text-anchor': 'end' }, names[i]));
      svg.append(el('line', { class: 'gl', x1: 0, y1: y0, x2: W, y2: y0 }));
      svg.append(
        el('path', { class: i <= 1 ? 't2' : 't1', d: trace(p, 0, W, y0, i ? k * 1.6 : k), 'stroke-width': 1.2 }),
      );
    });
    txt('#mr-aux', `x = A${J} + D${J} + … + D1`);
  }
  new Choice<Sig>($('#mr-sig'), (v) => {
    S.sig = v;
    draw();
  });
  new Choice<Wav>($('#mr-w'), (v) => {
    S.w = v;
    draw();
  });
  draw();
}

/* ================= 係数を捨てて戻す ================= */
export function initShrink(onSnr: (s: string) => void): void {
  const N = 1024,
    J = 6,
    /** 雑音: 信号の標準偏差 1 に対して 1/7（Donoho・Johnstone の SN 比 7） */
    RSNR = 7,
    SEED = 5;
  const pnl = $('.a-sh'),
    svg = $<SVGSVGElement>('#sh-svg'),
    cs = $<SVGSVGElement>('#sh-c');
  const S = { mode: 'dn', sig: 'doppler' as Sig, w: 'db4' as Wav, m: 'hard' as Shrink, lam: 1, keep: 5 };
  let ready = false;

  function draw(): void {
    if (!ready) return;
    pnl.dataset.m = S.mode;
    const [clean, nz, sg] = noisy(sample(S.sig, N), RSNR, SEED),
      dn = S.mode === 'dn',
      src = dn ? nz : clean,
      c = wavedec(src, S.w, J);
    let y: Float64Array, kept: number, th: number;
    if (dn) {
      th = S.lam * universal(sigmaMad(c.d[0]), N);
      const r = denoise(c, th, S.m);
      y = waverec(r.c);
      kept = r.kept;
    } else {
      kept = Math.round((S.keep / 100) * N);
      y = waverec(compress(c, kept).c);
      th = kept > 0 ? Float64Array.from(flat(c), Math.abs).sort()[N - kept] : Number.POSITIVE_INFINITY;
    }
    /* 戻した信号 */
    const k = 44 / maxAbs(src);
    svg.replaceChildren(
      el('line', { class: 'gl', x1: 0, y1: 50, x2: W, y2: 50 }),
      el('rect', { class: 'gb', x: 0, y: 0, width: W, height: 100 }),
      el('path', { class: 't2', d: trace(src, 0, W, 50, k), 'stroke-width': 1, opacity: 0.7 }),
      el('path', { class: 't1', d: trace(y, 0, W, 50, k), 'stroke-width': 1.6 }),
    );
    /* 係数（Mallat の順: a_J, d_J, …, d_1）。目盛りは詳細の最大で決め、はみ出す近似は端で切る */
    const f = flat(c),
      kc = 34 / Math.max(...c.d.map((d) => maxAbs(d))),
      clip = (v: number) => Math.max(-38, Math.min(38, v));
    let s = '',
      g = '';
    for (let i = 0; i < N; i++) {
      const seg = `M${(((i + 0.5) * W) / N).toFixed(2)} 40V${(40 - clip(kc * f[i])).toFixed(1)}`;
      if ((dn && i < c.a.length) || Math.abs(f[i]) >= th) s += seg;
      else g += seg;
    }
    const tb = Math.min(38, kc * th);
    cs.replaceChildren(
      el('rect', {
        class: 'sh-t',
        x: (c.a.length * W) / N,
        y: 40 - tb,
        width: W - (c.a.length * W) / N,
        height: 2 * tb,
      }),
      el('path', { class: 'sh-g', d: g, 'stroke-width': 0.6 }),
      el('path', { class: 't1', d: s, 'stroke-width': 0.9 }),
      el('rect', { class: 'gb', x: 0, y: 0, width: W, height: 80 }),
    );
    let o = 0;
    const lab = [`a${J}`, ...Array.from({ length: J }, (_, i) => `d${J - i}`)],
      lens = [
        c.a.length,
        ...c.d
          .slice()
          .reverse()
          .map((d) => d.length),
      ];
    lens.forEach((n, i) => {
      if (i) cs.append(el('line', { class: 'gb', x1: (o * W) / N, y1: 0, x2: (o * W) / N, y2: 80 }));
      /* 幅の狭い段（近似と粗い詳細）は名前を出さない */
      if ((n * W) / N >= 20)
        cs.append(el('text', { class: 'lv', x: ((o + n / 2) * W) / N, y: 78, 'text-anchor': 'middle' }, lab[i]));
      o += n;
    });
    txt('#sh-l2', dn ? '雑音あり' : '元の信号');
    txt('#sh-lt', dn ? '閾値 ±λ' : '残す境 ±|c|');
    const sn = snr(clean, y),
      m = (dt: string, dd: string, u = '') =>
        `<div class="m"><dt>${dt}</dt><dd>${dd}${u ? `<span class="u">${u}</span>` : ''}</dd></div>`;
    html(
      '#sh-out',
      dn
        ? m('残した係数', String(kept), `/ ${N}`) +
            m('閾値 λ', fx(th, 3), `σ̂ ${fx(sigmaMad(c.d[0]), 3)}（真 ${fx(sg, 3)}）`) +
            m('SN 比（雑音あり）', fx(snr(clean, nz)), 'dB') +
            m('SN 比（戻した後）', fx(sn), 'dB')
        : m('残した係数', String(kept), `/ ${N}（${fx((100 * kept) / N)} %）`) + m('SN 比', fx(sn), 'dB'),
    );
    onSnr(`${fx(sn)} dB`);
  }

  new ParamGroup<ShKey>(SHRINK, (v) => {
    S.lam = v.lam;
    S.keep = v.keep;
    draw();
  });
  new Choice<string>($('#sh-mode'), (v) => {
    S.mode = v;
    draw();
  });
  new Choice<Sig>($('#sh-sig'), (v) => {
    S.sig = v;
    draw();
  });
  new Choice<Wav>($('#sh-w'), (v) => {
    S.w = v;
    draw();
  });
  new Choice<Shrink>($('#sh-m'), (v) => {
    S.m = v;
    draw();
  });
  ready = true;
  draw();
}

/* ================= スカログラム ================= */
export function initScalo(): void {
  const N = 512,
    dt = 1 / N,
    dj = 1 / 10,
    /** 周期 2δt から 2δt·2^6（0.25 s）まで */
    J = 60,
    s = scales((2 * dt) / fourierFactor(), dj, J),
    coi = coiPeriod(N, dt),
    RANGE = 40,
    H = 240;
  const cv = $<HTMLCanvasElement>('#sc-cv'),
    ov = $<SVGSVGElement>('#sc-svg'),
    xs = $<SVGSVGElement>('#sc-x'),
    lut = lutOf('.a-sc');
  let sig: Sig = 'doppler',
    P: Float32Array[] = [],
    mx = 1;
  const pmin = Math.log2(s[0] * fourierFactor()),
    pmax = Math.log2(s[J] * fourierFactor());
  /** 縦の位置 0（上）〜 H → 尺度の番号 */
  const rowJ = (y: number) => Math.max(0, Math.min(J, Math.round(((y / H) * (pmax - pmin)) / dj)));

  function draw(): void {
    const x = sample(sig, N);
    P = power(cwt(x, dt, s));
    mx = P.reduce((m, r) => r.reduce((a, v) => (v > a ? v : a), m), 1e-12);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const cw = cv.width,
      ch = cv.height,
      img = ctx.createImageData(cw, ch);
    for (let r = 0; r < ch; r++) {
      /* 上が短い周期（高い周波数） */
      const lp = pmin + ((pmax - pmin) * r) / (ch - 1),
        j = rowJ((r / (ch - 1)) * H);
      for (let q = 0; q < cw; q++) {
        const n = Math.floor((q * N) / cw),
          out = 2 ** lp > coi[n],
          dim = out ? (((r >> 1) + (q >> 1)) % 3 === 0 ? 0.3 : 0.62) : 1;
        paint(lut, (10 * Math.log10(P[j][n] / mx + 1e-12) + RANGE) / RANGE, img.data, (r * cw + q) * 4, dim);
      }
    }
    ctx.putImageData(img, 0, 0);
    xs.replaceChildren(
      el('line', { class: 'gl', x1: 0, y1: 22, x2: W, y2: 22 }),
      el('path', { class: 't2', d: trace(x, 0, W, 22, 19 / maxAbs(x)), 'stroke-width': 1.3 }),
      el('text', { x: -6, y: 26, 'text-anchor': 'end' }, 'x'),
    );
  }
  /* 目盛り: 周波数（1/周期）と時間 */
  {
    const g = el('g');
    for (const f of [4, 8, 16, 32, 64, 128, 256]) {
      const y = ((pmax - Math.log2(1 / f)) / (pmax - pmin)) * H;
      g.append(el('text', { x: -6, y: H - y + 4, 'text-anchor': 'end' }, f === 256 ? '256 Hz' : String(f)));
    }
    for (const t of [0, 0.25, 0.5, 0.75, 1])
      g.append(
        el(
          'text',
          { x: t * W, y: H + 16, 'text-anchor': t === 0 ? 'start' : t === 1 ? 'end' : 'middle' },
          t === 1 ? '1 s' : String(t),
        ),
      );
    g.append(el('rect', { class: 'gb', x: 0, y: 0, width: W, height: H }));
    ov.append(g, el('path', { class: 'cur', id: 'sc-cur', d: '' }));
  }
  ov.addEventListener('pointermove', (e) => {
    const p = svgPt(ov, e),
      cur = $('#sc-cur');
    if (!p || p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H || !P.length) {
      cur.setAttribute('d', '');
      txt('#sc-rd', '');
      return;
    }
    const n = Math.min(N - 1, Math.floor((p[0] / W) * N)),
      j = rowJ(p[1]),
      per = s[j] * fourierFactor();
    cur.setAttribute('d', `M${p[0].toFixed(1)} 0V${H}M0 ${p[1].toFixed(1)}H${W}`);
    txt('#sc-rd', `t ${fx(n / N, 3)} s  f ${fx(1 / per)} Hz  ${fx(10 * Math.log10(P[j][n] / mx + 1e-12))} dB`);
  });
  ov.addEventListener('pointerleave', () => {
    $('#sc-cur').setAttribute('d', '');
    txt('#sc-rd', '');
  });
  txt('#sc-lo', `−${RANGE}`);
  new Choice<Sig>($('#sc-sig'), (v) => {
    sig = v;
    draw();
  });
  draw();
}

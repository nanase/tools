/**
 * 5 同じことを 256 点で: 分解を段ごとに（Mallat の算法を動かす）
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { analyze, bank, type Wav } from './dwt';
import { el, maxAbs, trace, txt } from './fig';
import { type Sig, sample } from './signals';

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
    pp.title = S.run ? '一時停止' : '分解の再生';
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

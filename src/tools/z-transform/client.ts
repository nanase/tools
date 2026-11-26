/* z 変換のページの動き */
import { bindEq, initChapterNav } from '../../lib/chapter-page';
import { $, $$ } from '../../lib/dom';
import { initToolPage } from '../../lib/tool-page';
import {
  AR,
  ARC,
  AU,
  type C,
  CI,
  cabs,
  carg,
  cdiv,
  clamp,
  cmul,
  cpol,
  degOf,
  dstr,
  every,
  Fig,
  FS,
  fade,
  HND,
  hlCss,
  L,
  later,
  niceMax,
  noise,
  num,
  PI,
  PL,
  POLE,
  type Pt,
  peakNorm,
  pstr,
  r1,
  radio,
  rmsNorm,
  stem,
  stemBase,
  sup,
  TAU,
  type Timer,
  TX,
  zBase,
} from './fig';

/** 数列の図に並べる標本の数 */
const N = 30;
const hz = (w: number): number => Math.max(Math.min(w, 360), Math.min(w * 0.8, 420));
const seq = (r: number, t: number, n: number): C => cpol(r ** n, t * n);
const isOn = (root: ParentNode, sel: string): boolean => $(sel, root).getAttribute('aria-pressed') === 'true';
/** 押すたびに aria-pressed を入れ替えるボタン */
const flip = (root: ParentNode, sel: string): void => {
  const b = $(sel, root);
  b.addEventListener('click', () => {
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
  });
};
/** data-p="0.88,36" のような値を数の並びにする */
const nums = (s: string | undefined): number[] => (s ?? '').split(',').map(Number);
const unpress = (btns: HTMLElement[]): void => {
  for (const c of btns) c.setAttribute('aria-pressed', 'false');
};
const tri = (cx: number, cy: number, dir: 'd' | 'l' | 'r', c = ''): string => {
  const s = 13;
  const p: Pt[] =
    dir === 'd'
      ? [
          [cx - s, cy - s * 0.8],
          [cx + s, cy - s * 0.8],
          [cx, cy + s],
        ]
      : dir === 'l'
        ? [
            [cx + s * 0.8, cy - s],
            [cx + s * 0.8, cy + s],
            [cx - s, cy],
          ]
        : [
            [cx - s * 0.8, cy - s],
            [cx - s * 0.8, cy + s],
            [cx + s, cy],
          ];
  return `<path class="box ${c}" d="M${p.map((q) => `${r1(q[0])},${r1(q[1])}`).join('L')}Z"/>`;
};
const adder = (cx: number, cy: number, c = ''): string =>
  CI(cx, cy, 11, `box ${c}`) + TX(cx, cy + 5, '+', 'v', 'middle');
const piS = (v: number): string => {
  const k = v / PI;
  return Math.abs(k) < 0.005 ? '0' : `${num(k, 2)}π`;
};

// ----- 問い 1 z を 1 つ決めると何が出てくるか -----
function q1(root: HTMLElement): void {
  const S = { r: 0.9, t: (40 * PI) / 180, k: 0, drag: false };
  const fz = new Fig($('#q1z', root), { x: [-1.5, 1.5], y: [-1.5, 1.5], eq: true, h: hz });
  const fs = new Fig($('#q1s', root), { x: [-0.8, N + 0.3], y: [-1, 1], h: hz, m: [16, 14, 24, 46] });
  const snd = $('#q1snd', root);
  const chips = $$('#q1 .chip', root);
  const sndOn = () => isOn(root, '#q1snd');
  function drawZ(): void {
    const f = fz;
    const z = cpol(S.r, S.t);
    const K = S.drag ? N - 1 : S.k;
    f.handles = [];
    let s = zBase(f);
    s += CI(f.X(0), f.Y(0), S.r * f.kx, 'ln c1 ds th hk k-r');
    s += L(f.X(0), f.Y(0), f.X(z[0]), f.Y(z[1]), 'ln c3 th k-r');
    if (Math.abs(S.t) > 0.02) {
      s += ARC(f.X(0), f.Y(0), 30, 0, S.t, 'c3 k-th', true, 6);
      const tm = S.t / 2;
      s += TX(f.X(0) + 46 * Math.cos(tm) - 4, f.Y(0) - 46 * Math.sin(tm) + 5, 'θ', 'm k-th');
    }
    const pts: C[] = [];
    for (let n = 0; n <= K; n++) {
      const p = seq(S.r, S.t, n);
      if (cabs(p) > 40) break;
      pts.push(p);
    }
    for (let n = 1; n < pts.length; n++)
      s += AR(f.X(pts[n - 1][0]), f.Y(pts[n - 1][1]), f.X(pts[n][0]), f.Y(pts[n][1]), 'c1 th k-zn', 6);
    pts.forEach((p, n) => {
      s += CI(f.X(p[0]), f.Y(p[1]), n === K ? 6.5 : 3.6, 'dot c1 k-zn');
    });
    const pk = pts[pts.length - 1];
    if (pk && cabs(pk) < 1.6 && K > 1) s += TX(f.X(pk[0]) + 9, f.Y(pk[1]) - 9, `z${sup(K)}`, 'm h k-zn');
    s += TX(f.X(1) + 6, f.Y(0) - 8, 'z⁰', 'm h');
    s += HND(f.X(z[0]), f.Y(z[1]), 'c1', 'k-zn');
    f.hnd('z', z[0], z[1]);
    s += TX(f.X(z[0]) + 12, f.Y(z[1]) + 20, 'z', 'm h');
    s += TX(10, 18, 'z をドラッグ', 'hint');
    f.set(s);
  }
  function drawS(): void {
    const f = fs;
    const K = S.drag ? N - 1 : S.k;
    let m = 0;
    for (let n = 0; n < N; n++) m = Math.max(m, Math.abs(seq(S.r, S.t, n)[0]));
    const ym = Math.min(niceMax(m), 20);
    f.range([-0.8, N + 0.3], [-ym * 1.12, ym * 1.12]);
    let s = stemBase(f, { yt: [ym, -ym] });
    for (let n = 0; n <= K; n++) s += stem(f, n, seq(S.r, S.t, n)[0], 'c1', ym * 1.1, n === K);
    const v = seq(S.r, S.t, K)[0];
    s += TX(
      f.X(K) + (f.X(K) + 130 > f.r ? -8 : 8),
      f.Y(clamp(v, -ym, ym)) + (v >= 0 ? -10 : 20),
      `n = ${K} : ${num(v)}`,
      'v h',
      f.X(K) + 130 > f.r ? 'end' : '',
    );
    f.set(s);
  }
  function text(): void {
    const d = degOf(S.t);
    const r = S.r;
    const rot =
      d === 0
        ? '回りません'
        : Math.abs(d) === 180
          ? '半周ずつ回り、符号が毎回入れ替わります'
          : `<b>${num(Math.abs(d), 0)}°</b> ずつ${d > 0 ? '左' : '右'}回りに回ります`;
    let t: string;
    if (Math.abs(r - 1) < 0.005)
      t = `z = <b>${pstr(1, S.t)}</b> は単位円の上にあります。zⁿ の大きさは 1 のまま変わらず、1 標本ごとに ${rot}。`;
    else if (r < 1)
      t = `z = <b>${pstr(r, S.t)}</b> なので、zⁿ は 1 標本ごとに <b>${num(r)}</b> 倍に縮み、${rot}。数列は 0 に近づいていきます。`;
    else
      t = `z = <b>${pstr(r, S.t)}</b> なので、zⁿ は 1 標本ごとに <b class="w">${num(r)}</b> 倍に膨らみ、${rot}。数列は限りなく大きくなります。`;
    if (sndOn()) t += ` 音の高さは ${Math.round((Math.abs(d) / 360) * FS)} Hz です。`;
    $('#q1t', root).innerHTML = t;
  }
  const draw1 = () => {
    drawZ();
    drawS();
    text();
  };
  fz.draw = drawZ;
  fs.draw = drawS;
  const setZ = (x: number, y: number) => {
    let r = Math.hypot(x, y);
    if (Math.abs(r - 1) < 0.03) r = 1;
    S.r = clamp(r, 0.05, 1.45);
    S.t = Math.atan2(y, x);
    if (Math.abs(S.t) < 0.04) S.t = 0;
    if (Math.abs(Math.abs(S.t) - PI) < 0.04) S.t = PI;
  };
  fz.interact({
    move: (_, x, y) => {
      S.drag = true;
      setZ(x, y);
      draw1();
      unpress(chips);
    },
    end: () => {
      S.drag = false;
      S.k = 0;
      draw1();
      if (sndOn()) sound();
    },
    tap: (x, y) => {
      setZ(x, y);
      S.k = 0;
      draw1();
      if (sndOn()) sound();
    },
  });
  radio(chips, (b) => {
    const [r, d] = nums(b.dataset.p);
    S.r = r;
    S.t = (d * PI) / 180;
    S.k = 0;
    draw1();
    if (sndOn()) sound();
  });
  let hold = 0;
  every(240, () => {
    if (!isOn(root, '#q1run') || S.drag) return;
    if (S.k >= N - 1) {
      if (++hold > 6) {
        hold = 0;
        S.k = 0;
      }
    } else S.k++;
    drawZ();
    drawS();
  });
  flip(root, '#q1run');
  function sound(): void {
    const n = Math.floor(1.6 * FS);
    const x = new Float32Array(n);
    const q = S.r ** (1 / 100);
    for (let i = 0; i < n; i++) x[i] = q ** i * Math.cos(S.t * i);
    fade(peakNorm(x, 0.55), 0.005, 0.08);
    AU.play(x, {
      onstop: () => {
        snd.setAttribute('aria-pressed', 'false');
        text();
      },
    });
    snd.setAttribute('aria-pressed', 'true');
    text();
  }
  snd.addEventListener('click', () => {
    if (sndOn()) {
      AU.stop();
      return;
    }
    sound();
  });
  draw1();
}

// ----- 問い 2 z 変換の和はどこで収まるか -----
function q2(root: HTMLElement): void {
  /** trail: 通った z の点 [re, im, 収束域の中か] */
  const T: { a: C; z: C; k: number; trail: [number, number, boolean][]; roc: boolean } = {
    a: cpol(0.8, (35 * PI) / 180),
    z: cpol(1.25, (-30 * PI) / 180),
    k: 0,
    trail: [],
    roc: false,
  };
  const M = 40;
  const gz = new Fig($('#q2z', root), { x: [-1.5, 1.5], y: [-1.5, 1.5], eq: true, h: hz });
  const gs = new Fig($('#q2s', root), { x: [-2, 2], y: [-2, 2], eq: true, h: hz, m: [10, 10, 10, 10] });
  const sums = (): { q: C; rho: number; out: C[] } => {
    const q = cdiv(T.a, T.z);
    const out: C[] = [];
    let t: C = [1, 0];
    let S2: C = [0, 0];
    for (let n = 0; n <= M; n++) {
      S2 = [S2[0] + t[0], S2[1] + t[1]];
      out.push(S2);
      t = cmul(t, q);
      if (cabs(S2) > 1e4) break;
    }
    return { q, rho: cabs(q), out };
  };
  function drawZ2(): void {
    const f = gz;
    f.handles = [];
    let s = '';
    const ra = cabs(T.a);
    if (T.roc)
      s += `<rect class="fill2" x="0" y="0" width="${f.W}" height="${f.H}"/><circle style="fill:var(--screen)" cx="${r1(f.X(0))}" cy="${r1(f.Y(0))}" r="${r1(ra * f.kx)}"/>`;
    s += zBase(f, { ucAt: -2.3 });
    if (T.roc) {
      s += CI(f.X(0), f.Y(0), ra * f.kx, 'ln ci ds');
      s += TX(f.r - 8, f.b - 10, '収束域 |z| &gt; |a|', 'lb h', 'end');
    }
    for (const p of T.trail) s += CI(f.X(p[0]), f.Y(p[1]), 2.6, `trail ${p[2] ? 'ok' : 'ng'}`);
    s += L(f.X(T.a[0]), f.Y(T.a[1]), f.X(T.z[0]), f.Y(T.z[1]), 'ln c3 th hk k-den');
    s += HND(f.X(T.a[0]), f.Y(T.a[1]), 'c1', 'k-a');
    f.hnd('a', T.a[0], T.a[1]);
    s += TX(f.X(T.a[0]) + 12, f.Y(T.a[1]) - 10, 'a', 'm h');
    s += HND(f.X(T.z[0]), f.Y(T.z[1]), 'c2', 'k-z');
    f.hnd('z', T.z[0], T.z[1]);
    s += TX(f.X(T.z[0]) + 12, f.Y(T.z[1]) + 20, 'z', 'm h');
    s += TX(10, 18, 'z と a をドラッグ', 'hint');
    f.set(s);
  }
  function drawS2(): void {
    const f = gs;
    const { rho, out } = sums();
    let R: number;
    if (rho < 1) {
      let m = 1.2;
      for (const p of out) m = Math.max(m, Math.abs(p[0]), Math.abs(p[1]));
      R = Math.min(m * 1.15, 40);
    } else {
      let m = 2;
      for (const p of out.slice(0, 7)) m = Math.max(m, Math.abs(p[0]), Math.abs(p[1]));
      R = Math.min(m * 1.1, 20);
    }
    f.range([-R, R], [-R, R]);
    let s = L(f.X(-R), f.Y(0), f.X(R), f.Y(0), 'ax') + L(f.X(0), f.Y(-R), f.X(0), f.Y(R), 'ax');
    s += TX(f.r - 4, f.Y(0) - 7, 'Re', 'lb', 'end') + TX(f.X(0) + 6, 15, 'Im', 'lb');
    const tk = niceMax(R * 0.6);
    s +=
      L(f.X(tk), f.Y(0) - 4, f.X(tk), f.Y(0) + 4, 'ax') +
      TX(f.X(tk), f.Y(0) + 17, num(tk, tk < 1 ? 1 : 0), '', 'middle');
    s += TX(f.X(0) - 6, f.Y(0) + 17, '0', '', 'end');
    const K = Math.min(T.k, out.length - 1);
    let prev: C = [0, 0];
    for (let n = 0; n <= K; n++) {
      const p = out[n];
      s += AR(f.X(prev[0]), f.Y(prev[1]), f.X(p[0]), f.Y(p[1]), `${n === K ? 'c2 bd' : 'c2'} k-q`, n === K ? 10 : 7);
      prev = p;
    }
    if (rho < 0.995) {
      const X = cdiv([1, 0], [1 - cdiv(T.a, T.z)[0], -cdiv(T.a, T.z)[1]]);
      s += CI(f.X(X[0]), f.Y(X[1]), 8, 'ln ci') + TX(f.X(X[0]) + 12, f.Y(X[1]) - 10, 'X(z)', 'm h');
    } else s += TX(10, f.b - 10, '収束域の外', 'lb cw h');
    s += TX(10, 18, `n = ${K} までの和`, 'hint');
    f.set(s);
  }
  function text2(): void {
    const { q, rho } = sums();
    const X = cdiv([1, 0], [1 - q[0], -q[1]]);
    let t: string;
    if (rho < 0.985) {
      t = `|a z⁻¹| = <b>${num(rho)}</b> &lt; 1 なので足す項が ${num(rho)} 倍ずつ縮み、和は X(z) = <b>${pstr(cabs(X), carg(X))}</b> に収まります。`;
      if (cabs(X) > 5) t += ' z が a に近いほど X(z) は大きくなります。';
    } else if (rho <= 1.015) t = '|a z⁻¹| = <b>1</b> なので項が縮まず、和は 1 点に収まりません。';
    else t = `<span class="w">|a z⁻¹| = <b>${num(rho)}</b> &gt; 1</span> なので足す項が膨らみ、和は収まりません。`;
    $('#q2t', root).innerHTML = t;
  }
  gz.draw = drawZ2;
  gs.draw = drawS2;
  const all2 = () => {
    drawZ2();
    drawS2();
    text2();
  };
  const lim = (x: number, y: number): C => {
    const r = Math.hypot(x, y);
    return r > 1.45 ? [(x * 1.45) / r, (y * 1.45) / r] : [x, y];
  };
  const pushTrail = () => {
    const p = T.trail[T.trail.length - 1];
    if (!p || Math.hypot(p[0] - T.z[0], p[1] - T.z[1]) > 0.035) {
      T.trail.push([T.z[0], T.z[1], cabs(T.z) > cabs(T.a) + 1e-9]);
      if (T.trail.length > 600) T.trail.shift();
    }
  };
  gz.interact({
    move: (n, x, y) => {
      const p = lim(x, y);
      if (n === 'a') {
        T.a = p;
        T.trail = [];
      } else {
        if (Math.hypot(p[0], p[1]) < 0.06) return;
        T.z = p;
        pushTrail();
      }
      T.k = M;
      all2();
    },
    end: () => {
      T.k = 0;
      all2();
    },
    tap: (x, y) => {
      const p = lim(x, y);
      if (Math.hypot(p[0], p[1]) < 0.06) return;
      T.z = p;
      pushTrail();
      T.k = 0;
      all2();
    },
  });
  $('#q2clr', root).addEventListener('click', () => {
    T.trail = [];
    drawZ2();
  });
  const roc = $('#q2roc', root);
  roc.addEventListener('click', () => {
    T.roc = !T.roc;
    roc.setAttribute('aria-pressed', String(T.roc));
    drawZ2();
  });
  let hold2 = 0;
  every(170, () => {
    if (T.k >= M) {
      if (++hold2 > 10) {
        hold2 = 0;
        T.k = 0;
      }
    } else T.k++;
    drawS2();
  });
  all2();
}

// ----- 問い 3 実数の数列に点が 2 つ要るのはなぜか -----
function q3(root: HTMLElement): void {
  const U = { r: 0.9, t: (40 * PI) / 180, k: 0 };
  const hz3 = new Fig($('#q3z', root), { x: [-1.3, 1.3], y: [-1.3, 1.3], eq: true, h: hz });
  const hs3 = new Fig($('#q3s', root), { x: [-0.8, N + 0.3], y: [-1, 1], h: hz, m: [16, 14, 24, 46] });
  function drawZ3(): void {
    const f = hz3;
    const K = U.k;
    f.handles = [];
    let s = zBase(f, { ucAt: -2.4 });
    for (const sg of [1, -1]) {
      const c = sg > 0 ? 'c1' : 'c2';
      const pts: C[] = [];
      for (let n = 0; n <= K; n++) pts.push(seq(U.r, sg * U.t, n));
      for (let n = 1; n < pts.length; n++)
        s += AR(
          f.X(pts[n - 1][0]),
          f.Y(pts[n - 1][1]),
          f.X(pts[n][0]),
          f.Y(pts[n][1]),
          `${c} th ${sg > 0 ? 'k-a' : 'k-q'}`,
          6,
        );
      for (const p of pts) s += CI(f.X(p[0]), f.Y(p[1]), 3.2, `dot ${c}`);
    }
    const p = seq(U.r, U.t, K);
    const h: C = [p[0] / 2, p[1] / 2];
    const e: C = [p[0], 0];
    s += AR(f.X(0), f.Y(0), f.X(h[0]), f.Y(h[1]), 'c1 bd k-a', 10);
    s += AR(f.X(h[0]), f.Y(h[1]), f.X(e[0]), f.Y(e[1]), 'c2 bd k-q', 10);
    s += CI(f.X(e[0]), f.Y(0), 6, 'dot ci');
    s += TX(f.X(e[0]), f.Y(0) + (h[1] >= 0 ? 22 : -12), num(e[0]), 'v h', 'middle');
    const a = cpol(U.r, U.t);
    const ab = cpol(U.r, -U.t);
    s += HND(f.X(a[0]), f.Y(a[1]), 'c1');
    f.hnd('a', a[0], a[1]);
    s += HND(f.X(ab[0]), f.Y(ab[1]), 'c2');
    f.hnd('b', ab[0], ab[1]);
    s += TX(f.X(a[0]) + 12, f.Y(a[1]) - 10, 'a', 'm h') + TX(f.X(ab[0]) + 12, f.Y(ab[1]) + 20, 'ā', 'm h');
    s += TX(10, 18, 'a をドラッグ', 'hint');
    f.set(s);
  }
  function drawS3(): void {
    const f = hs3;
    let s = stemBase(f, { yt: [1, -1] });
    for (let n = 0; n <= U.k; n++) s += stem(f, n, seq(U.r, U.t, n)[0], 'ci', 1.1, n === U.k);
    f.set(s);
  }
  function text3(): void {
    const v = seq(U.r, U.t, U.k)[0];
    $('#q3t', root).innerHTML =
      `a = <b class="c1">${pstr(U.r, U.t)}</b> と ā = <b class="c2">${pstr(U.r, -U.t)}</b> は逆向きに回ります。n = ${U.k} で半分ずつ足すと虚部が打ち消し合い、和は実数の <b>${num(v)}</b> になります。`;
  }
  hz3.draw = drawZ3;
  hs3.draw = drawS3;
  const all3 = () => {
    drawZ3();
    drawS3();
    text3();
  };
  hz3.interact({
    move: (n, x, y) => {
      const r = Math.hypot(x, y);
      U.r = clamp(Math.abs(r - 1) < 0.03 ? 1 : r, 0.3, 1.04);
      U.t = Math.abs(Math.atan2(n === 'a' ? y : -y, x));
      all3();
    },
    end: () => {
      U.k = 0;
      all3();
    },
  });
  let hold3 = 0;
  every(320, () => {
    if (!isOn(root, '#q3run')) return;
    if (U.k >= N - 1) {
      if (++hold3 > 5) {
        hold3 = 0;
        U.k = 0;
      }
    } else U.k++;
    all3();
  });
  flip(root, '#q3run');
  all3();
}

// ----- s 平面の下地（問い 4・5） -----
const tickLab = (k: number): string => (k === 1 ? 'π/T' : k === -1 ? '−π/T' : `${k < 0 ? '−' : ''}${Math.abs(k)}π/T`);
/** fill: 左半分を塗る、ticks: π/T の何倍に目盛りを打つか、strips: 奇数倍に横の点線を引く、noSig: σ の名前を出さない */
function sAxes(f: Fig, o: { fill?: boolean; ticks: number[]; strips?: boolean; noSig?: boolean }): string {
  let s = '';
  if (o.fill) s += `<rect class="ucf" x="${r1(f.l)}" y="0" width="${r1(f.X(0) - f.l)}" height="${f.H}"/>`;
  for (const k of o.ticks) {
    const y = f.Y(k * PI);
    if (o.strips && k % 2) s += L(f.l, y, f.r, y, 'ln c3 th ds k-T');
    else s += L(f.X(0) - 4, y, f.X(0) + 4, y, 'ax');
    s += TX(f.r - 4, y - 4, tickLab(k), '', 'end');
  }
  s += L(f.l, f.Y(0), f.r, f.Y(0), 'ax');
  s += L(f.X(0), f.t - 8, f.X(0), f.b + 8, 'ln ci');
  s += TX(f.X(0) + 6, f.t + 8, 'jω', 'm');
  if (!o.noSig) s += TX(f.l + 4, f.Y(0) - 7, 'σ', 'm');
  return s;
}

// ----- 問い 4 e^{st} を標本化すると z はどこにあるか -----
function q4(root: HTMLElement): void {
  const S = { sg: -0.1, om: 0.4 * PI };
  const p4 = new Fig($('#q4p', root), {
    x: [-1.6, 0.6],
    y: [-1.25 * PI, 1.25 * PI],
    h: (w) => (w >= 340 ? 270 : 330),
    m: [14, 8, 14, 8],
  });
  const z4 = new Fig($('#q4z', root), { x: [-1.9, 1.9], y: [-1.9, 1.9], eq: true, h: (w) => Math.min(w, 330) });
  const w4 = new Fig($('#q4w', root), {
    x: [-0.4, 12.4],
    y: [-1, 1],
    h: (w) => (w < 420 ? 260 : 330),
    m: [14, 16, 30, 46],
  });
  const chips = $$('#q4 .chip', root);
  function drawP(): void {
    const f = p4;
    f.handles = [];
    let s = sAxes(f, { fill: true, ticks: [-1, 1] });
    s += TX(f.X(-1), f.Y(0) + 17, '−1/T', '', 'middle') + TX(f.X(0.45), f.Y(0) + 17, '0.5/T', '', 'middle');
    s += TX(f.X(0) + 6, f.Y(-0.55 * PI), '虚軸', 'lb h');
    s += L(f.X(S.sg), f.t, f.X(S.sg), f.b, 'ln c1 ds th k-sig');
    s += L(f.l, f.Y(S.om), f.r, f.Y(S.om), 'ln c3 ds th k-om');
    s += HND(f.X(S.sg), f.Y(S.om), 'c1', 'k-sT');
    f.hnd('s', S.sg, S.om);
    s += TX(f.X(S.sg) + 12, f.Y(S.om) - 10, 's', 'm h');
    s += TX(8, f.H - 10, 's をドラッグ', 'hint');
    f.set(s);
  }
  function drawZ(): void {
    const f = z4;
    f.handles = [];
    let s = zBase(f, { fillIn: true, ucAt: -2.2 });
    const r = Math.exp(S.sg);
    const z = cpol(r, S.om);
    s += CI(f.X(0), f.Y(0), r * f.kx, 'ln c1 ds th k-sig');
    s += L(f.X(0), f.Y(0), f.X(1.85 * Math.cos(S.om)), f.Y(1.85 * Math.sin(S.om)), 'ln c3 ds th k-om');
    if (Math.abs(S.om) > 0.05) s += ARC(f.X(0), f.Y(0), 24, 0, S.om, 'c3 k-om', true, 6);
    s += HND(f.X(z[0]), f.Y(z[1]), 'c1', 'k-sT');
    f.hnd('z', z[0], z[1]);
    s += TX(f.X(z[0]) + 12, f.Y(z[1]) + 20, 'z', 'm h');
    s += TX(10, 18, 'z もドラッグ', 'hint');
    f.set(s);
  }
  function drawW(): void {
    const f = w4;
    let m = 1;
    for (let t = 0; t <= 12; t += 0.25) m = Math.max(m, Math.exp(S.sg * t));
    const ym = Math.min(niceMax(m), 10);
    f.range([-0.4, 12.4], [-ym * 1.1, ym * 1.1]);
    let s = '';
    for (const v of [ym, -ym]) s += L(f.l, f.Y(v), f.r, f.Y(v), 'gr') + TX(f.l - 6, f.Y(v) + 4, num(v, 0), '', 'end');
    s += AR(f.l, f.Y(0), f.r + 4, f.Y(0), 'c3 th', 7) + TX(f.r, f.Y(0) - 8, 't', 'm', 'end');
    for (let n = 0; n <= 12; n += 2) s += TX(f.X(n), f.b + 16, n === 0 ? '0' : `${n}T`, '', 'middle');
    const pts: Pt[] = [];
    for (let i = 0; i <= 12 * 40; i++) {
      const t = i / 40;
      pts.push([f.X(t), f.Y(clamp(Math.exp(S.sg * t) * Math.cos(S.om * t), -ym * 1.1, ym * 1.1))]);
    }
    s += PL(pts, 'ln c2');
    for (let n = 0; n <= 12; n++) s += stem(f, n, Math.exp(S.sg * n) * Math.cos(S.om * n), 'c1', ym * 1.08);
    const yb = f.b - 2;
    s +=
      L(f.X(0), yb - 6, f.X(0), yb, 'ax') +
      L(f.X(1), yb - 6, f.X(1), yb, 'ax') +
      L(f.X(0), yb - 3, f.X(1), yb - 3, 'ax');
    s += TX(f.X(0.5), yb - 9, 'T', 'm', 'middle');
    f.set(s);
  }
  function text(): void {
    const r = Math.exp(S.sg);
    let t = `σT = <b>${num(S.sg)}</b> なので |z| = e<sup>σT</sup> = <b>${num(r)}</b>、ωT = <b>${piS(S.om)}</b> なので ∠z = <b>${dstr(S.om)}</b> です。1 標本の間 T に e<sup>st</sup> は z 倍になります。`;
    t +=
      Math.abs(S.sg) < 0.005
        ? ' s は虚軸の上にあり、z は単位円の上に乗ります。'
        : S.sg < 0
          ? ' s は s 平面の左半分にあり、z は単位円の内側に入ります。'
          : ' <span class="w">s は s 平面の右半分にあり、z は単位円の外側に出ます。</span>';
    $('#q4t', root).innerHTML = t;
  }
  p4.draw = drawP;
  z4.draw = drawZ;
  w4.draw = drawW;
  const all = () => {
    drawP();
    drawZ();
    drawW();
    text();
  };
  const setS = (x: number, y: number) => {
    S.sg = clamp(Math.abs(x) < 0.03 ? 0 : x, -1.55, 0.55);
    S.om = clamp(Math.abs(y) < 0.06 ? 0 : y, -1.2 * PI, 1.2 * PI);
  };
  p4.interact({
    move: (_, x, y) => {
      setS(x, y);
      all();
      unpress(chips);
    },
    tap: (x, y) => {
      setS(x, y);
      all();
      unpress(chips);
    },
  });
  z4.interact({
    move: (_, x, y) => {
      const r = clamp(Math.hypot(x, y), Math.exp(-1.55), Math.exp(0.55));
      let a = Math.atan2(y, x);
      if (Math.abs(a) < 0.04) a = 0;
      setS(Math.log(Math.abs(r - 1) < 0.03 ? 1 : r), a);
      all();
      unpress(chips);
    },
  });
  radio(chips, (b) => {
    const [a, c] = nums(b.dataset.s);
    S.sg = a;
    S.om = c * PI;
    all();
  });
  all();
}

// ----- 問い 5 速く回る波は標本でどう見えるか -----
function q5(root: HTMLElement): void {
  /** mode: 連続の波（c）か標本の列（s）を鳴らす */
  const F = { f: 1000, mode: 's' };
  const fsr = FS;
  const WM = 3.5 * PI;
  const p5 = new Fig($('#q5p', root), {
    x: [-0.55, 0.55],
    y: [-WM, WM],
    h: (w) => (w >= 340 ? 300 : 340),
    m: [14, 8, 14, 8],
  });
  const w5 = new Fig($('#q5w', root), {
    x: [-0.4, 16.4],
    y: [-1.25, 1.25],
    h: (w) => (w < 420 ? 260 : 340),
    m: [14, 16, 30, 40],
  });
  const z5 = new Fig($('#q5z', root), { x: [-1.45, 1.45], y: [-1.45, 1.45], eq: true, h: (w) => Math.min(w, 340) });
  const range = $<HTMLInputElement>('#q5f', root);
  const snd = $('#q5snd', root);
  const chips = $$('#q5 .chip', root);
  const alias = (f: number) => {
    const k = Math.round(f / fsr);
    return Math.abs(f - k * fsr);
  };
  const omT = () => (TAU * F.f) / fsr;
  function drawP(): void {
    const f = p5;
    f.handles = [];
    let s = sAxes(f, { ticks: [-3, -2, -1, 1, 2, 3], strips: true, noSig: true });
    const w = omT();
    // 虚軸のうち 0 から ωT までを太く（z 平面で単位円を回った道のり）
    if (w > 0.02) s += AR(f.X(0), f.Y(0), f.X(0), f.Y(Math.min(w, WM)), 'c1 bd k-f', 9);
    s += CI(f.X(0), f.Y(-w), 6, 'dot o c1');
    s += CI(f.X(0), f.Y(w), 6.5, 'dot c1');
    s += TX(f.X(0) - 10, f.Y(w) + 5, 'jω', 'm c1 h', 'end');
    s += TX(f.X(0) - 10, f.Y(-w) + 5, '−jω', 'm c1 h', 'end');
    f.set(s);
  }
  function drawW(): void {
    const f = w5;
    let s = '';
    for (const v of [1, -1]) s += L(f.l, f.Y(v), f.r, f.Y(v), 'gr') + TX(f.l - 6, f.Y(v) + 4, num(v, 0), '', 'end');
    s += AR(f.l, f.Y(0), f.r + 4, f.Y(0), 'c3 th', 7) + TX(f.r, f.Y(0) - 8, 'n', 'm', 'end');
    for (let n = 0; n <= 16; n += 4) s += TX(f.X(n), f.b + 16, n, '', 'middle');
    const fa = alias(F.f);
    const w = (TAU * F.f) / fsr;
    const wa = (TAU * fa) / fsr;
    const NN = 16 * 60;
    const cont: Pt[] = [];
    const al: Pt[] = [];
    for (let i = 0; i <= NN; i++) {
      const t = i / 60;
      cont.push([f.X(t), f.Y(Math.cos(w * t))]);
      al.push([f.X(t), f.Y(Math.cos(wa * t))]);
    }
    if (Math.abs(fa - F.f) > 1) s += PL(al, 'ln c3 ds');
    s += PL(cont, 'ln c2 th');
    for (let n = 0; n <= 16; n++) s += stem(f, n, Math.cos(w * n), 'c1', 2);
    f.set(s);
  }
  function drawZ(): void {
    const f = z5;
    let s = zBase(f, { ucAt: -2.3 });
    const th = omT();
    if (th > 0.05) {
      const n = Math.ceil(th / 0.04);
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (th * i) / n;
        const rr = 0.3 + (0.13 * t) / TAU;
        pts.push([f.X(rr * Math.cos(t)), f.Y(rr * Math.sin(t))]);
      }
      const last = pts[pts.length - 1];
      const pre = pts[Math.max(0, pts.length - 3)];
      s += PL(pts.slice(0, -1), 'ln c1 k-f') + AR(pre[0], pre[1], last[0], last[1], 'c1 k-f', 7);
    }
    const z = cpol(1, th);
    s += L(f.X(0), f.Y(0), f.X(z[0]), f.Y(z[1]), 'ln c1 th');
    s += CI(f.X(z[0]), f.Y(-z[1]), 6, 'dot o c1');
    s += CI(f.X(z[0]), f.Y(z[1]), 7, 'dot c1');
    s += TX(10, 18, `ωT = ${Math.round((th * 180) / PI)}°`, 'v');
    s += TX(10, 38, `${Math.floor(th / TAU + 1e-9)} 周 ＋ ${num(((((th * 180) / PI) % 360) + 360) % 360, 0)}°`, 'hint');
    f.set(s);
  }
  function text(): void {
    const d = (F.f / fsr) * 360;
    const eqd = degOf(omT());
    const fa = alias(F.f);
    let t = `f = <b>${F.f} Hz</b> の波は 1 標本ごとに <b>${Math.round(d)}°</b> 回ります。`;
    if (Math.abs(fa - F.f) > 1)
      t += `単位円の上では <b>${num(eqd, 0)}°</b> と同じ点なので、標本の列は <b class="w">${Math.round(fa)} Hz</b> の波と区別できません。`;
    else t += '標本の列はこの波の形をそのまま追えます。';
    $('#q5t', root).innerHTML = t;
  }
  p5.draw = drawP;
  w5.draw = drawW;
  z5.draw = drawZ;
  const all = () => {
    drawP();
    drawW();
    drawZ();
    text();
    $('#q5o', root).textContent = `${F.f} Hz`;
    range.value = String(F.f);
  };
  let tm: Timer | undefined;
  function sound(): void {
    if (F.mode === 'c') {
      // 連続の波を鳴らしているあいだは発振器の周波数だけ変える
      if (AU.src && 'frequency' in AU.src && AU.ctx) {
        AU.src.frequency.setTargetAtTime(F.f, AU.ctx.currentTime, 0.01);
        return;
      }
      AU.osc(F.f, { gain: 0.3, onstop: off });
    } else {
      const x = new Float32Array(fsr);
      for (let n = 0; n < fsr; n++) x[n] = 0.3 * Math.cos((TAU * F.f * n) / fsr);
      AU.play(x, { loop: true, periodic: true, onstop: off });
    }
    snd.setAttribute('aria-pressed', 'true');
  }
  function off(): void {
    snd.setAttribute('aria-pressed', 'false');
  }
  const playing = () => isOn(root, '#q5snd');
  const setF = (v: number) => {
    F.f = Math.round(v);
    all();
    if (playing()) {
      clearTimeout(tm);
      if (F.mode === 'c') sound();
      else tm = later(140, sound);
    }
  };
  range.addEventListener('input', () => {
    setF(+range.value);
    for (const c of chips) c.setAttribute('aria-pressed', String(Number(c.dataset.f) === F.f));
  });
  radio(chips, (b) => setF(Number(b.dataset.f)));
  radio($$('#q5src button', root), (b) => {
    F.mode = b.dataset.m ?? '';
    if (playing()) {
      AU.onstop = null;
      AU.stop(0.02);
      sound();
    }
  });
  snd.addEventListener('click', () => {
    if (playing()) AU.stop();
    else sound();
  });
  chips[0]?.setAttribute('aria-pressed', 'true');
  all();
}

// ----- 問い 6 z⁻¹ を掛けると数列はどうなるか -----
function q6(root: HTMLElement): void {
  const X0 = [1, 0.6, -0.4, 0.2];
  /** d: z⁻¹ を掛けた回数、prev: 1 つ前の d（まだ押していなければ null） */
  const S: { d: number; prev: number | null } = { d: 0, prev: null };
  const N1 = 10;
  const f1 = new Fig($('#q6s', root), {
    x: [-0.6, N1 + 0.6],
    y: [-0.75, 1.35],
    h: (w) => (w < 420 ? 230 : 260),
    m: [10, 14, 26, 40],
  });
  const mul = $<HTMLButtonElement>('#q6m', root);
  const div = $<HTMLButtonElement>('#q6d', root);
  const termStr = (v: number, p: number, first: boolean): string => {
    const sgn = v < 0 ? '−' : first ? '' : '+';
    const a = Math.abs(v);
    const c = p === 0 ? num(a, 1) : a === 1 ? '' : num(a, 1);
    return `${first ? '' : ' '}${sgn}${first ? '' : ' '}${c}${p === 0 ? '' : `z${sup(`−${p}`)}`}`;
  };
  function draw1(): void {
    const f = f1;
    let s = '';
    for (const v of [1, -0.5])
      s += L(f.l, f.Y(v), f.r, f.Y(v), 'gr') + TX(f.l - 6, f.Y(v) + 4, num(v, v % 1 ? 1 : 0), '', 'end');
    s += AR(f.l, f.Y(0), f.r + 4, f.Y(0), 'c3 th', 7) + TX(f.r, f.Y(0) - 8, 'n', 'm', 'end');
    for (let n = 0; n <= N1; n++) s += TX(f.X(n), f.b + 16, n, '', 'middle');
    const prev = S.prev;
    if (prev !== null && prev !== S.d) {
      X0.forEach((v, i) => {
        const n = i + prev;
        if (n > N1) return;
        s += L(f.X(n), f.Y(0), f.X(n), f.Y(v), 'stem c3') + CI(f.X(n), f.Y(v), 4, 'dot o c3');
      });
      X0.forEach((v, i) => {
        const a = i + prev;
        const b = i + S.d;
        if (a > N1 || b > N1) return;
        s += AR(f.X(a), f.Y(v) - (v >= 0 ? 12 : -12), f.X(b), f.Y(v) - (v >= 0 ? 12 : -12), 'c3 k-d1', 7);
      });
    }
    X0.forEach((v, i) => {
      const n = i + S.d;
      if (n > N1) return;
      s += stem(f, n, v, 'c1', 9, true);
      s += TX(f.X(n), f.Y(v) + (v >= 0 ? -14 : 24), `z${sup(`−${n}`)}`, 'm c1 h k-d1', 'middle');
    });
    f.set(s);
    const terms = X0.map((v, i) => termStr(v, i + S.d, i === 0)).join('');
    $('#q6p', root).innerHTML =
      `<span class="ml">${S.d === 0 ? 'X(z)' : `z${sup(`−${S.d}`)}X(z)`} =</span> <b>${terms}</b>`;
    $('#q6t', root).innerHTML =
      S.d === 0
        ? '元の数列 X(z) では、各項の z⁻ⁿ の次数が番号 n を表します。'
        : `z⁻¹ を <b>${S.d}</b> 回掛けました。どの項も次数が ${S.d} つ上がり、数列は <b>${S.d}</b> 標本右へ遅れました。`;
    div.disabled = S.d === 0;
    mul.disabled = S.d >= N1 - 3;
  }
  f1.draw = draw1;
  mul.addEventListener('click', () => {
    S.prev = S.d;
    S.d = Math.min(S.d + 1, N1 - 3);
    draw1();
  });
  div.addEventListener('click', () => {
    S.prev = S.d;
    S.d = Math.max(S.d - 1, 0);
    draw1();
  });
  $('#q6r', root).addEventListener('click', () => {
    S.prev = S.d;
    S.d = 0;
    draw1();
  });
  later(900, () => {
    if (S.d === 0 && S.prev === null) {
      S.prev = 0;
      S.d = 1;
      draw1();
    }
  });
  draw1();
}

// ----- 問い 7 出力を戻すと何が起きるか -----
function q7(root: HTMLElement): void {
  const U = { a: 0.8, n: 0, hold: 0 };
  const NM = 24;
  const yr = (n: number) => U.a ** n;
  const gd = new Fig($('#q7d', root), { x: [0, 1], y: [0, 1], h: 230, m: [0, 0, 0, 0] });
  const gy = new Fig($('#q7y', root), { x: [-0.6, NM - 0.4], y: [-1, 1], h: 230, m: [14, 14, 24, 40] });
  const gz = new Fig($('#q7z', root), { x: [-1.35, 1.35], y: [-1.35, 1.35], eq: true, h: (w) => Math.min(w, 230) });
  const range = $<HTMLInputElement>('#q7a', root);
  const btn = $('#q7snd', root);
  function drawD(): void {
    const f = gd;
    const W = f.W;
    const n = U.n;
    const yA = 60;
    const yB = 170;
    const xa = Math.max(84, W * 0.32);
    const xn = W - Math.max(58, W * 0.2);
    const xb = (xa + xn) / 2;
    const yn = yr(n);
    const yp = n > 0 ? yr(n - 1) : 0;
    let s = TX(8, yA + 5, 'x[n]', 'm') + AR(44, yA, xa - 11, yA, 'wire', 7) + adder(xa, yA);
    s +=
      L(xa + 11, yA, xn, yA, 'wire') +
      CI(xn, yA, 3, 'dot ci') +
      AR(xn, yA, W - 8, yA, 'wire', 7) +
      TX(W - 8, yA - 14, 'y[n]', 'm', 'end');
    s += TX(W - 8, yA + 26, num(clamp(yn, -999, 999), 2), 'v c2', 'end');
    s += L(xn, yA, xn, yB, 'wire fb k-fb') + AR(xn, yB, xb + 24, yB, 'wire fb k-fb', 7);
    s +=
      `<rect class="box k-fb" x="${r1(xb - 24)}" y="${yB - 17}" width="48" height="34" rx="3"/>` +
      TX(xb, yB + 6, 'z⁻¹', 'm', 'middle');
    s += AR(xb - 24, yB, xa + 14, yB, 'wire fb k-fb', 7) + tri(xa, yB, 'l', 'k-fb');
    s += TX(xa + 4, yB + 32, `a = ${num(U.a)}`, 'm', 'middle');
    s += AR(xa, yB - 13, xa, yA + 11, 'wire fb k-fb', 7);
    s += TX(xb, yB - 24, num(clamp(yp, -999, 999), 2), 'c3', 'middle');
    s += TX(xa - 8, (yA + yB) / 2 + 4, num(clamp(U.a * yp, -999, 999), 2), 'c3', 'end');
    s += TX(8, f.H - 10, `n = ${n}　入力はインパルス`, 'hint');
    f.set(s);
  }
  function drawY(): void {
    const f = gy;
    let m = 1;
    for (let k = 0; k < NM; k++) m = Math.max(m, Math.abs(yr(k)));
    const ym = Math.min(niceMax(m), 10);
    f.range([-0.6, NM - 0.4], [-ym * 1.12, ym * 1.12]);
    let s = stemBase(f, { yt: [ym, -ym], xs: 5 });
    for (let k = 0; k <= U.n; k++) s += stem(f, k, yr(k), 'c2', ym * 1.08, k === U.n);
    f.set(s);
  }
  function drawZ(): void {
    const f = gz;
    f.handles = [];
    let s = zBase(f, { ucAt: -2.2 });
    s += POLE(f.X(U.a), f.Y(0), Math.abs(U.a) > 1 ? 'cw' : '');
    s += CI(f.X(U.a), f.Y(0), 14, 'ln c3 th dt');
    f.hnd('a', U.a, 0);
    s += TX(f.X(U.a), f.Y(0) - 18, 'a', 'm h', 'middle');
    s += TX(8, 18, '× をドラッグ', 'hint');
    f.set(s);
  }
  function text(): void {
    const a = U.a;
    const A = Math.abs(a);
    let t: string;
    if (Math.abs(A - 1) < 0.001)
      t = `a = <b>${num(a)}</b> なので出力は大きさ 1 のまま${a < 0 ? '符号を変えながら' : ''}続きます。`;
    else if (A < 1)
      t = `a = <b>${num(a)}</b> なので出力は 1 標本ごとに ${num(a)} 倍になります。インパルス 1 個から列が終わらずに続き、${a < 0 ? '符号を変えながら' : ''}0 へ近づきます。`;
    else
      t = `<span class="w">a = <b>${num(a)}</b></span> なので出力は 1 標本ごとに ${num(A)} 倍に${a < 0 ? '符号を変えながら' : ''}膨らみ続けます。`;
    if (A < 0.001) t = 'a = 0 なので戻す値が 0 になり、出力はインパルスそのものです。';
    $('#q7t', root).innerHTML = t;
  }
  gd.draw = drawD;
  gy.draw = drawY;
  gz.draw = drawZ;
  const all = () => {
    drawD();
    drawY();
    drawZ();
    text();
    $('#q7o', root).textContent = num(U.a);
    range.value = String(U.a);
  };
  const setA = (v: number) => {
    U.a = Math.round(clamp(v, -1.2, 1.2) * 20) / 20;
    U.n = NM - 1;
    all();
    if (isOn(root, '#q7snd')) snd();
  };
  range.addEventListener('input', () => setA(+range.value));
  gz.interact({
    move: (_, x) => setA(x),
    end: () => {
      U.n = 0;
      all();
    },
  });
  every(420, () => {
    if (U.n >= NM - 1) {
      if (++U.hold > 5) {
        U.hold = 0;
        U.n = 0;
      }
    } else U.n++;
    drawD();
    drawY();
  });
  function snd(): void {
    const n = 2 * FS;
    const x = noise(n);
    const y = new Float32Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) {
      p = clamp(x[i] + U.a * p, -1e6, 1e6);
      y[i] = p;
    }
    if (Math.abs(U.a) < 1) rmsNorm(y, 0.14);
    else {
      // 膨らむときは最初の 400 標本の大きさでそろえ、上限で止める
      let s = 0;
      for (let i = 0; i < 400; i++) s += y[i] * y[i];
      const g = 0.05 / Math.sqrt(s / 400 + 1e-12);
      for (let i = 0; i < n; i++) y[i] = clamp(y[i] * g, -0.5, 0.5);
    }
    AU.play(fade(y), { loop: true, onstop: () => btn.setAttribute('aria-pressed', 'false') });
    btn.setAttribute('aria-pressed', 'true');
  }
  btn.addEventListener('click', () => {
    if (isOn(root, '#q7snd')) AU.stop();
    else snd();
  });
  all();
}

// ----- 問い 8 単位円の上を歩くと何が見えるか -----
function q8(root: HTMLElement): void {
  /** p: 極、w: 単位円の上の角 ω、sw: 掃引の音を鳴らしている */
  const S = { p: cpol(0.9, PI / 3), w: 0, hold: 0, sw: false };
  const fz = new Fig($('#q8z', root), { x: [-1.35, 1.35], y: [-1.35, 1.35], eq: true, h: hz });
  const ff = new Fig($('#q8f', root), { x: [0, PI], y: [0, 1], h: hz, m: [16, 18, 44, 46] });
  const swBtn = $('#q8sw', root);
  const conj = (a: C): C => [a[0], -a[1]];
  const dist = (a: C, b: C) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const magAt = (w: number) => {
    const e = cpol(1, w);
    return 1 / (dist(e, S.p) * dist(e, conj(S.p)));
  };
  /** 周波数特性の横軸の目盛り: [ω, 角の名前, 周波数] */
  const ticks: [number, string, string][] = [
    [0, '0', '0 Hz'],
    [PI / 2, 'π/2', '2000 Hz'],
    [PI, 'π', '4000 Hz'],
  ];
  function drawZ(): void {
    const f = fz;
    f.handles = [];
    let s = zBase(f, { ucAt: -2.4 });
    const e = cpol(1, S.w);
    if (S.w > 0.03) s += ARC(f.X(0), f.Y(0), f.kx, 0, S.w, 'ci bd', true, 9);
    for (const a of [S.p, conj(S.p)]) {
      s += L(f.X(e[0]), f.Y(e[1]), f.X(a[0]), f.Y(a[1]), 'ln c1 k-den');
      const mx = (e[0] + a[0]) / 2;
      const my = (e[1] + a[1]) / 2;
      s += TX(f.X(mx) + 6, f.Y(my) - 6, num(dist(e, a)), 'c1 h k-den');
    }
    s += POLE(f.X(S.p[0]), f.Y(S.p[1])) + POLE(f.X(S.p[0]), f.Y(-S.p[1]));
    f.hnd('p', S.p[0], S.p[1]);
    f.hnd('pb', S.p[0], -S.p[1]);
    s += TX(f.X(S.p[0]) + 10, f.Y(S.p[1]) - 10, 'p', 'm h') + TX(f.X(S.p[0]) + 10, f.Y(-S.p[1]) + 22, 'p̄', 'm h');
    s += CI(f.X(e[0]), f.Y(e[1]), 7, 'dot ci');
    f.hnd('w', e[0], e[1]);
    s += TX(
      f.X(1.12 * e[0]) + (e[0] < -0.2 ? -6 : 4),
      f.Y(1.12 * e[1]) - 6,
      'e<tspan baseline-shift="super" font-size="11">jω</tspan>',
      'm h',
      e[0] < -0.2 ? 'end' : '',
    );
    s += TX(10, 18, '× と ● をドラッグ', 'hint');
    f.set(s);
  }
  function drawF(): void {
    const f = ff;
    let m = 1;
    for (let i = 0; i <= 200; i++) m = Math.max(m, magAt((PI * i) / 200));
    const ym = Math.min(niceMax(m), 50);
    f.range([0, PI], [0, ym * 1.08]);
    let s = '';
    for (const v of [ym / 2, ym])
      s += L(f.l, f.Y(v), f.r, f.Y(v), 'gr') + TX(f.l - 6, f.Y(v) + 4, num(v, v < 10 && v % 1 ? 1 : 0), '', 'end');
    s += AR(f.l, f.Y(0), f.r + 6, f.Y(0), 'c3 th', 7) + TX(f.r + 2, f.Y(0) - 8, 'ω', 'm', 'end');
    for (const [w, a, b] of ticks) {
      const anchor = w === PI ? 'end' : w ? 'middle' : 'start';
      s +=
        L(f.X(w), f.Y(0), f.X(w), f.Y(0) + 4, 'ax') +
        TX(f.X(w), f.b + 17, a, '', anchor) +
        TX(f.X(w), f.b + 34, b, 'hint', anchor);
    }
    const pts: Pt[] = [];
    const n = Math.max(1, Math.round((S.w / PI) * 300));
    for (let i = 0; i <= n; i++) {
      const w = (S.w * i) / n;
      pts.push([f.X(w), f.Y(Math.min(magAt(w), ym * 1.08))]);
    }
    s += PL(pts, 'ln ci bd');
    const v = magAt(S.w);
    s +=
      L(f.X(S.w), f.Y(0), f.X(S.w), f.Y(Math.min(v, ym * 1.08)), 'ln c3 th dt') +
      CI(f.X(S.w), f.Y(Math.min(v, ym * 1.08)), 6, 'dot ci');
    s += TX(
      f.X(S.w) + (S.w > PI * 0.7 ? -10 : 10),
      Math.max(f.Y(Math.min(v, ym)) - 10, 30),
      num(v),
      'v h',
      S.w > PI * 0.7 ? 'end' : '',
    );
    f.set(s);
  }
  function text(): void {
    const e = cpol(1, S.w);
    const d = [dist(e, S.p), dist(e, conj(S.p))];
    $('#q8t', root).innerHTML =
      `ω = <b>${num(S.w / PI)}π</b>（${Math.round((S.w / PI) * 4000)} Hz）です。極まで <b class="c1">${num(d[0])}</b> と <b class="c1">${num(d[1])}</b> なので |H| = 1 ÷ (${num(d[0])} × ${num(d[1])}) = <b>${num(magAt(S.w))}</b> です。`;
  }
  fz.draw = drawZ;
  ff.draw = drawF;
  const all = () => {
    drawZ();
    drawF();
    text();
  };
  fz.interact({
    move: (n, x, y) => {
      if (n === 'w') {
        $('#q8run', root).setAttribute('aria-pressed', 'false');
        S.w = clamp(Math.abs(Math.atan2(y, x)), 0, PI);
        all();
        return;
      }
      const yy = n === 'pb' ? -y : y;
      const r = Math.min(Math.hypot(x, yy), 0.98);
      S.p = cpol(r, Math.atan2(yy, x));
      all();
    },
    end: (n) => {
      if (n !== 'w' && S.sw) snd();
    },
  });
  flip(root, '#q8run');
  every(110, () => {
    if (S.sw) {
      const t = AU.elapsed();
      if (t >= 0) {
        S.w = clamp(t / 4, 0, 1) * PI;
        all();
      }
      return;
    }
    if (!isOn(root, '#q8run')) return;
    if (S.w >= PI - 1e-9) {
      if (++S.hold > 10) {
        S.hold = 0;
        S.w = 0;
      }
    } else S.w = Math.min(PI, S.w + PI / 60);
    all();
  });
  function filt(x: Float32Array): Float32Array<ArrayBuffer> {
    const a1 = 2 * S.p[0];
    const a2 = S.p[0] ** 2 + S.p[1] ** 2;
    const y = new Float32Array(x.length);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i] + a1 * y1 - a2 * y2;
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    return y;
  }
  function snd(): void {
    const n = 4 * FS;
    const x = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      ph += (TAU * (4000 * (i / n))) / FS;
      x[i] = Math.sin(ph);
    }
    S.sw = true;
    AU.play(fade(peakNorm(filt(x), 0.5), 0.01, 0.05), {
      onstop: () => {
        S.sw = false;
        swBtn.setAttribute('aria-pressed', 'false');
      },
    });
    swBtn.setAttribute('aria-pressed', 'true');
  }
  swBtn.addEventListener('click', () => {
    if (S.sw) AU.stop();
    else snd();
  });
  all();
}

initToolPage();
const st = document.createElement('style');
st.textContent = hlCss();
document.head.appendChild(st);
const root = $('#zt');
for (const init of [q1, q2, q3, q4, q5, q6, q7, q8]) init(root);
bindEq(root);
initChapterNav(root, { key: 'zt:view', onLeave: () => AU.stop() });

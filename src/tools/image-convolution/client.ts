/**
 * 画像の畳み込みのページの入口: 画像とカーネル → 出力の画像を計算し、走査線より上を出力・下を入力にした 1 枚の画像、
 * 止めている間だけ窓に付く拡大鏡、窓の積和、カーネルの係数（上下のドラッグで編集）と |H| を描く。
 * 「入力ごとに配る」では、入力の画素ごとにカーネルの写しを配って足していく（Smith の図 24-14）
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { TILE, testChart } from './chart';
import {
  conv2,
  conv2sep,
  type Edge,
  extend,
  fromRGBA,
  gradMag,
  type Img,
  type Kernel,
  kernel,
  kspec,
  ksum,
  median,
  type Show,
  separate,
  terms,
  toRGBA,
} from './image';
import { H, type KindName, PAD, PARAMS, type ParamKey, SPEEDS, type SrcName, USES, W } from './params';

initToolPage();

const BASE = import.meta.env.BASE_URL;
const N = W * H,
  PW = W + 2 * PAD,
  PH = H + 2 * PAD;

/* ---------- 状態 ---------- */
const S = {
  src: 'chart' as SrcName,
  edge: 'clamp' as Edge,
  kn: 'gauss' as KindName,
  /** 係数を編集したカーネル（例のままなら null） */
  kern: null as Kernel | null,
  corr: false,
  /** 「出力ごとに集める」の位置（出力の画素の番号） */
  pos: 64 * W,
  /** 「入力ごとに配る」の位置（外にカーネルの半幅を足した入力の画素の番号） */
  q: 0,
  play: !RM.matches,
  view: 'out' as 'out' | 'in',
  brush: 'pick' as 'pick' | 'w' | 'k',
};
let V = {} as Record<ParamKey, number>;
let ready = false;

/* ---------- 画像 ---------- */
const SRCIMG: Partial<Record<SrcName, Img>> = {};
let SRC: Img = { w: W, h: H, v: new Float32Array(N) };
function fromCanvas(draw: (g: CanvasRenderingContext2D) => void): Img {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return { w: W, h: H, v: new Float32Array(N) };
  g.fillStyle = '#808080';
  g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = 'high';
  draw(g);
  return fromRGBA(g.getImageData(0, 0, W, H).data, W, H);
}
/** テスト画像。文字の区画だけキャンバスで描く（左右・上下の向きが分かる F と、細い線の多い漢字） */
function chartImg(): Img {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TILE;
  const g = cv.getContext('2d');
  let text: Float32Array | null = null;
  if (g) {
    g.fillStyle = '#e6e6e6';
    g.fillRect(0, 0, TILE, TILE);
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 34px sans-serif';
    g.fillText('F', 6, 34);
    g.font = 'bold 26px sans-serif';
    g.fillText('字', 32, 32);
    g.font = '13px sans-serif';
    g.fillText('Aa 画像', 5, 56);
    text = fromRGBA(g.getImageData(0, 0, TILE, TILE).data, TILE, TILE).v;
  }
  return { w: W, h: H, v: testChart(text) };
}
/** 手描きの最初の絵。点・線・縁: カーネルがそのまま点像・線像・縁の応答として見える。下は市松と円 */
function drawImg(): Img {
  const v = new Float32Array(N).fill(0.08),
    set = (r: number, c: number, a: number) => {
      if (r >= 0 && r < H && c >= 0 && c < W) v[r * W + c] = a;
    };
  set(48, 48, 1);
  for (let r = 20; r < 80; r++) set(r, 128, 1);
  for (let r = 20; r < 80; r++) for (let c = 200; c < 248; c++) set(r, c, 1);
  for (let r = 110; r < 176; r++)
    for (let c = 20; c < 92; c++) if (((r - 110) >> 3) % 2 === ((c - 20) >> 3) % 2) set(r, c, 0.9);
  for (let r = 110; r < 176; r++)
    for (let c = 110; c < 236; c++) if ((c - 172) ** 2 + (r - 143) ** 2 < 900) set(r, c, 0.75);
  return { w: W, h: H, v };
}
/** 画像を 256 × 192 に切り抜いて縮める（短い辺を合わせる） */
function cover(im: HTMLImageElement): Img {
  return fromCanvas((g) => {
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight),
      w = im.naturalWidth * s,
      h = im.naturalHeight * s;
    g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  });
}
function useSrc(): void {
  if (S.src === 'draw' && !SRCIMG.draw) SRCIMG.draw = drawImg();
  if (!SRCIMG.chart) SRCIMG.chart = chartImg();
  SRC = SRCIMG[S.src] ?? SRCIMG.chart;
}
function loadImage(url: string, done: (im: HTMLImageElement) => void, fail?: () => void): void {
  const im = new Image();
  im.onload = () => done(im);
  im.onerror = () => fail?.();
  im.src = url;
}

/* ---------- カーネルと計算 ---------- */
const isNC = () => !S.kern && (S.kn === 'median' || S.kn === 'grad');
const isMedian = () => !S.kern && S.kn === 'median';
const isGrad = () => !S.kern && S.kn === 'grad';
function curK(): Kernel {
  if (S.kern) return S.kern;
  if (S.kn === 'median') return { w: V.m, h: V.m, v: new Float32Array(V.m * V.m) };
  if (S.kn === 'grad') return kernel('sobelx');
  return kernel(S.kn, V.n, V.s, V.kk);
}
/** 表示の幅の切りのよい値 */
function nice(v: number): number {
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * e * 1.0001) return m * e;
  return 10 * e;
}
let OUT: Img = SRC,
  SHOW: Show = 'clip',
  GAIN = 1,
  IN_RGBA: Uint8ClampedArray = new Uint8ClampedArray(PW * PH * 4),
  OUT_RGBA: Uint8ClampedArray = new Uint8ClampedArray(N * 4);
function compute(): void {
  const k = curK();
  if (isMedian()) OUT = median(SRC, V.m, S.edge);
  else if (isGrad())
    OUT = gradMag(conv2(SRC, kernel('sobelx'), S.edge, S.corr), conv2(SRC, kernel('sobely'), S.edge, S.corr));
  else {
    /* 分離できる大きいカーネルは横 → 縦の 2 回で（相関は直接） */
    const sp = !S.corr && k.w * k.h > 9 ? separate(k) : null;
    OUT = sp ? conv2sep(SRC, sp.a, sp.b, S.edge) : conv2(SRC, k, S.edge, S.corr);
  }
  SHOW = isGrad() ? 'abs' : !isNC() && Math.abs(ksum(k)) < 1e-6 ? 'signed' : 'clip';
  let m = 0;
  for (const v of OUT.v) m = Math.max(m, Math.abs(v));
  GAIN = SHOW === 'clip' ? 1 : nice(Math.max(0.05, m));
  IN_RGBA = toRGBA(extend(SRC, PAD, S.edge), 'clip');
  OUT_RGBA = toRGBA(OUT, SHOW, GAIN);
  ACC = null;
}
/** 計算し直して描く。カーネルが変わったときは係数・|H|・行の出し入れも */
function recompute(kchanged = false): void {
  if (!ready) return;
  compute();
  setPos(curPos());
  if (kchanged) kernelUI();
  render();
}
const shade = (v: number) => {
  const u = SHOW === 'clip' ? v : SHOW === 'abs' ? Math.abs(v) / GAIN : 0.5 + v / (2 * GAIN);
  return Math.round(Math.min(1, Math.max(0, u)) * 255);
};

/** 画像の外の座標（image.ts の idx と同じ決まり。0 のときは −1） */
function ix(i: number, n: number): number {
  if (i >= 0 && i < n) return i;
  if (S.edge === 'zero') return -1;
  if (S.edge === 'clamp') return i < 0 ? 0 : n - 1;
  if (S.edge === 'wrap') return ((i % n) + n) % n;
  const p = 2 * n;
  let j = ((i % p) + p) % p;
  if (j >= n) j = p - 1 - j;
  return j;
}
const px = (r: number, c: number) => {
  const rr = ix(r, H),
    cc = ix(c, W);
  return rr < 0 || cc < 0 ? 0 : SRC.v[rr * W + cc];
};

/* ---------- 入力ごとに配る: 入力の画素ごとにカーネルの写しを足す（外の画素も配り終えると出力と同じ） ---------- */
let ACC: Float32Array | null = null,
  ACCQ = 0;
const kr = (): [number, number] => {
  const k = curK();
  return [(k.w - 1) / 2, (k.h - 1) / 2];
};
const EW = () => W + 2 * kr()[0],
  EH = () => H + 2 * kr()[1];
const scatter = () => S.view === 'in' && !isNC();
const total = () => (scatter() ? EW() * EH() : N);
const curPos = () => (scatter() ? S.q : S.pos);
function setPos(p: number): void {
  const v = Math.max(0, Math.min(total() - 1, p));
  if (scatter()) S.q = v;
  else S.pos = v;
}
/** 今の位置の画素（配るときは、外を含む入力の画素） */
function curRC(): [number, number] {
  const p = curPos();
  if (!scatter()) return [Math.floor(p / W), p % W];
  const [cx, cy] = kr(),
    ew = EW();
  return [Math.floor(p / ew) - cy, (p % ew) - cx];
}
function stamp(q: number, acc: Float32Array): void {
  const k = curK(),
    [cx, cy] = kr(),
    ew = EW(),
    sr = Math.floor(q / ew) - cy,
    sc = (q % ew) - cx,
    v = px(sr, sc);
  if (v === 0) return;
  for (let j = 0; j < k.h; j++)
    for (let i = 0; i < k.w; i++) {
      const g = k.v[j * k.w + i];
      if (!g) continue;
      const dy = j - cy,
        dx = i - cx,
        r = S.corr ? sr - dy : sr + dy,
        c = S.corr ? sc - dx : sc + dx;
      if (r >= 0 && r < H && c >= 0 && c < W) acc[r * W + c] += g * v;
    }
}
function accTo(q: number): Float32Array {
  if (!ACC || q < ACCQ - 1) {
    ACC = new Float32Array(N);
    ACCQ = 0;
  }
  while (ACCQ <= q) stamp(ACCQ++, ACC);
  return ACC;
}

/* ---------- 表記 ---------- */
const f2 = (v: number) => (Math.abs(v) < 5e-4 ? '0.00' : v.toFixed(2));
const f3 = (v: number) => (Math.abs(v) < 5e-4 ? '0.000' : v.toFixed(3));
/** カーネルの係数（整数はそのまま、小数は先頭の 0 を省く） */
const fw = (v: number) =>
  Math.abs(v) < 1e-9
    ? '0'
    : Math.abs(v - Math.round(v)) < 1e-6
      ? String(Math.round(v))
      : (Math.abs(v) < 0.1 ? v.toFixed(3) : v.toFixed(2)).replace(/^(-?)0\./, '$1.');
const gray = (b: number) => `rgb(${b},${b},${b})`;
const txt = (el: HTMLElement, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};
const html = (el: HTMLElement, s: string) => {
  if (el.innerHTML !== s) el.innerHTML = s;
};

/* ---------- 画像（1 枚に重ねる） ---------- */
const stage = $('#st'),
  cv = $<HTMLCanvasElement>('#cv'),
  ov = $('#ov'),
  loupe = $('#loupe'),
  ctx = cv.getContext('2d');
const IMD = ctx?.createImageData(PW, PH);
/** 走査した所までは出力、その先は入力。配るときは、配り始めた所から出力（足しかけの値） */
function paint(): void {
  if (!ctx || !IMD) return;
  const d = IMD.data;
  d.set(IN_RGBA);
  if (scatter()) {
    const acc = accTo(S.q),
      ew = EW();
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        if (r * ew + c > S.q) continue;
        const o = 4 * ((r + PAD) * PW + c + PAD),
          b = shade(acc[r * W + c]);
        d[o] = d[o + 1] = d[o + 2] = b;
      }
  } else {
    const lim = Math.min(S.pos, N - 1);
    for (let i = 0; i <= lim; i++) {
      const r = Math.floor(i / W),
        o = 4 * ((r + PAD) * PW + (i % W) + PAD);
      d[o] = OUT_RGBA[4 * i];
      d[o + 1] = OUT_RGBA[4 * i + 1];
      d[o + 2] = OUT_RGBA[4 * i + 2];
    }
  }
  ctx.putImageData(IMD, 0, 0);
}
function overlay(): void {
  const k = curK(),
    [r, c] = curRC();
  let s = `<rect class="ov-img" x="${PAD}" y="${PAD}" width="${W}" height="${H}"/>`;
  s += `<path class="ov-out" fill-rule="evenodd" d="M0 0H${PW}V${PH}H0Z M${PAD} ${PAD}V${PAD + H}H${PAD + W}V${PAD}Z"/>`;
  const sy = (scatter() ? Math.min(H - 1, Math.max(0, r + kr()[1])) : r) + 0.5;
  s += `<line class="ov-scan" x1="${PAD}" x2="${PAD + W}" y1="${PAD + sy}" y2="${PAD + sy}"/>`;
  s += `<rect class="ov-win${scatter() ? ' dash' : ''}" x="${PAD + c - (k.w - 1) / 2}" y="${PAD + r - (k.h - 1) / 2}" width="${k.w}" height="${k.h}"/>`;
  ov.innerHTML = s;
}

/* ---------- 拡大鏡（窓のまわりの画素と、重ねたカーネルの係数） ---------- */
interface Mag {
  key: string;
  cells: HTMLElement[];
  kov: HTMLElement;
  spans: HTMLElement[];
}
const MAGS = new WeakMap<HTMLElement, Mag>();
function magGrid(box: HTMLElement, cs: number, compact: boolean): { m: Mag; sh: number; sv: number; cols: number } {
  const k = curK(),
    lim = compact ? 9 : 7,
    sh = Math.min(k.w, lim),
    sv = Math.min(k.h, lim),
    cols = sh + 2,
    rows = sv + 2,
    key = `${cols}x${rows}|${cs}|${compact}`;
  let m = MAGS.get(box);
  if (!m || m.key !== key) {
    const mg = document.createElement('div');
    mg.className = 'ic-mg';
    mg.style.gridTemplateColumns = `repeat(${cols},${cs}px)`;
    const cells: HTMLElement[] = [];
    for (let i = 0; i < cols * rows; i++) {
      const c = document.createElement('div');
      c.className = 'mc';
      c.style.width = c.style.height = `${cs}px`;
      if (!compact) c.appendChild(document.createElement('i'));
      mg.appendChild(c);
      cells.push(c);
    }
    const kov = document.createElement('div');
    kov.className = 'kov';
    Object.assign(kov.style, {
      left: `${1 + (cs + 1)}px`,
      top: `${1 + (cs + 1)}px`,
      width: `${sh * (cs + 1) - 1}px`,
      height: `${sv * (cs + 1) - 1}px`,
      gridTemplateColumns: `repeat(${sh},1fr)`,
    });
    const spans: HTMLElement[] = [];
    for (let i = 0; i < sh * sv; i++) spans.push(kov.appendChild(document.createElement('span')));
    mg.appendChild(kov);
    box.querySelector('.ic-mg')?.remove();
    box.prepend(mg);
    m = { key, cells, kov, spans };
    MAGS.set(box, m);
  }
  return { m, sh, sv, cols };
}
function magnifier(box: HTMLElement, cs: number, compact: boolean): void {
  const k = curK(),
    sc = scatter(),
    [r0, c0] = curRC(),
    { m, sh, sv, cols } = magGrid(box, cs, compact),
    rows = sv + 2,
    ox = (k.w - sh) / 2,
    oy = (k.h - sv) / 2,
    hx = (sh - 1) / 2 + 1,
    hy = (sv - 1) / 2 + 1,
    acc = sc ? accTo(S.q) : null,
    nums = !compact && cs >= 30;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const r = r0 + j - hy,
        c = c0 + i - hx,
        cell = m.cells[j * cols + i],
        inside = r >= 0 && r < H && c >= 0 && c < W;
      let v: number, b: number;
      if (acc) {
        v = inside ? acc[r * W + c] : 0;
        b = inside ? shade(v) : 128;
      } else {
        v = px(r, c);
        b = Math.round(Math.min(1, Math.max(0, v)) * 255);
      }
      cell.style.background = gray(b);
      cell.classList.toggle('out', !inside);
      cell.classList.toggle('cen', j === hy && i === hx && !sc);
      const t = cell.firstElementChild as HTMLElement | null;
      if (t) {
        t.hidden = !nums || (sc && !inside);
        txt(t, nums ? f2(v) : '');
      }
    }
  /* 集めるときはカーネルを 180° 回して重ねる（相関なら回さない）。配るときは形がそのまま（相関なら回す） */
  m.kov.classList.toggle('rot', !isMedian() && (sc ? S.corr : !S.corr));
  m.kov.classList.toggle('med', isMedian());
  const v0 = sc ? px(r0, c0) : 1;
  for (let j = 0; j < sv; j++)
    for (let i = 0; i < sh; i++) {
      const v = k.v[(j + oy) * k.w + i + ox] * v0;
      html(m.spans[j * sh + i], isMedian() || !nums ? '' : `<b>${fw(sc ? Math.round(v * 1000) / 1000 : v)}</b>`);
    }
}

/** 窓に付く小さな拡大鏡。再生中は窓が速く動いて追えないので、止めている間だけ出す */
function placeLoupe(): void {
  const show = !scatter() && !S.play;
  loupe.hidden = !show;
  if (!show) return;
  const sw = stage.clientWidth,
    sh = stage.clientHeight,
    cs = Math.max(5, Math.min(12, Math.round(sw / 48)));
  magnifier(loupe, cs, true);
  let s = loupe.querySelector<HTMLElement>('.lsum');
  if (!s) {
    s = document.createElement('div');
    s.className = 'lsum';
    loupe.appendChild(s);
  }
  const [r, c] = curRC();
  txt(s, `(${c}, ${r}) → ${f3(OUT.v[r * W + c] ?? 0)}`);
  const lw = loupe.offsetWidth,
    lh = loupe.offsetHeight,
    x = ((c + PAD) / PW) * sw,
    y = ((r + PAD) / PH) * sh;
  loupe.style.left = `${Math.min(sw - lw - 6, Math.max(6, x + 18))}px`;
  loupe.style.top = `${Math.min(sh - lh - 6, Math.max(6, y > sh / 2 ? y - lh - 14 : y + 14))}px`;
}

/* ---------- 窓の計算（枠） ---------- */
const magBox = $('#mag');
function windowPanel(): void {
  const k = curK(),
    cols = Math.min(k.w, 7) + 2,
    avail = (magBox.clientWidth || 360) - 4,
    cs = Math.max(20, Math.min(40, Math.floor(avail / cols) - 1));
  magnifier(magBox, cs, false);
  let t = magBox.querySelector<HTMLElement>('.terms'),
    s = magBox.querySelector<HTMLElement>('.sumline');
  if (!t || !s) {
    t = document.createElement('div');
    t.className = 'terms';
    s = document.createElement('div');
    s.className = 'sumline';
    magBox.append(t, s);
  }
  const [r, c] = curRC(),
    y = OUT.v[r * W + c] ?? 0,
    pxb = (b: number) => `<span class="px" style="background:${gray(b)}"></span>`;
  if (scatter()) {
    const v = px(r, c);
    t.hidden = true;
    html(
      s,
      `<span>入力 (${c}, ${r})</span>${pxb(Math.round(Math.min(1, Math.max(0, v)) * 255))}<b>${f2(v)}</b><span>× カーネル${S.corr ? '（反転）' : ''}</span><span class="eq">→</span><span>出力に足す</span>`,
    );
    return;
  }
  t.hidden = false;
  if (isMedian()) {
    const vals: number[] = [],
      h = (V.m - 1) / 2;
    for (let j = -h; j <= h; j++) for (let i = -h; i <= h; i++) vals.push(px(r + j, c + i));
    vals.sort((a, b) => a - b);
    const mid = (vals.length - 1) / 2,
      shown = vals.length > 9 ? vals.slice(mid - 4, mid + 5) : vals;
    t.className = 'terms med';
    t.style.gridTemplateColumns = '';
    html(
      t,
      `${vals.length > 9 ? `<em>小さい ${mid - 4} 個</em>` : ''}${shown.map((v, i) => `<span${(vals.length > 9 ? i === 4 : i === mid) ? ' class="on"' : ''}>${f2(v)}</span>`).join('')}${vals.length > 9 ? `<em>大きい ${mid - 4} 個</em>` : ''}`,
    );
    html(s, `<span>${vals.length} 個の中央値</span><span class="eq">=</span>${pxb(shade(y))}<b>${f3(y)}</b>`);
    return;
  }
  const T = terms(SRC, k, r, c, S.edge, S.corr),
    tw = Math.min(k.w, 5),
    th = Math.min(k.h, 5),
    tx = (k.w - tw) / 2,
    ty = (k.h - th) / 2;
  t.className = 'terms';
  t.style.gridTemplateColumns = `repeat(${tw},minmax(0,1fr))`;
  let h = '';
  for (let j = 0; j < th; j++)
    for (let i = 0; i < tw; i++) {
      const n = (j + ty) * k.w + i + tx;
      h += `<span class="${k.v[n] === 0 ? 'z' : ''}">${fw(k.v[n])}×${f2(T.xs[n])}</span>`;
    }
  html(t, h);
  const big = k.w > 5 || k.h > 5 ? '（表は中央 5×5）' : '';
  if (isGrad()) {
    const gy = terms(SRC, kernel('sobely'), r, c, S.edge, S.corr).sum;
    html(
      s,
      `<span><i>G</i>x ${f3(T.sum)}</span><span><i>G</i>y ${f3(gy)}</span><span class="eq">→</span><span>√(<i>G</i>x² + <i>G</i>y²)</span>${pxb(shade(y))}<b>${f3(y)}</b>`,
    );
  } else html(s, `<span>Σ 係数 × 画素値${big}</span><span class="eq">=</span>${pxb(shade(y))}<b>${f3(T.sum)}</b>`);
}

/* ---------- カーネルの係数と |H| ---------- */
const kgBox = $('#kg'),
  kmeta = $('#o-km'),
  kreset = $<HTMLButtonElement>('#b-kreset'),
  cvH = $<HTMLCanvasElement>('#cv-h'),
  hcap = $('#o-hcap');
let kgKey = '';
function editK(n: number, v: number): void {
  if (isMedian()) return;
  const base = curK();
  S.kern = S.kern ?? { w: base.w, h: base.h, v: Float32Array.from(base.v) };
  const nv = Math.round(v * 8) / 8;
  if (S.kern.v[n] === nv) return;
  S.kern.v[n] = nv;
  knCh.set('' as KindName);
  recompute(true);
}
function kernelGrid(): void {
  const k = curK(),
    sh = Math.min(k.w, 7),
    sv = Math.min(k.h, 7),
    ox = (k.w - sh) / 2,
    oy = (k.h - sv) / 2,
    small = sh > 5 || ((kgBox.clientWidth || 400) < 330 && sh > 3),
    key = `${k.w}x${k.h}|${small}`;
  if (kgKey !== key) {
    kgKey = key;
    kgBox.innerHTML = '';
    const g = document.createElement('div');
    g.className = 'kg';
    g.style.gridTemplateColumns = `repeat(${sh},auto)`;
    for (let j = 0; j < sv; j++)
      for (let i = 0; i < sh; i++) {
        const n = (j + oy) * k.w + i + ox,
          c = document.createElement('div');
        c.className = `kc${small ? ' sm' : ''}`;
        c.tabIndex = 0;
        c.dataset.n = String(n);
        c.setAttribute('role', 'spinbutton');
        let y0: number | null = null,
          v0 = 0;
        c.addEventListener('pointerdown', (e) => {
          c.setPointerCapture(e.pointerId);
          y0 = e.clientY;
          v0 = curK().v[n];
        });
        c.addEventListener('pointermove', (e) => {
          if (y0 != null && Math.abs(e.clientY - y0) > 3) editK(n, v0 + (y0 - e.clientY) / 40);
        });
        const up = () => {
          y0 = null;
        };
        c.addEventListener('pointerup', up);
        c.addEventListener('pointercancel', up);
        c.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          editK(n, curK().v[n] + (e.key === 'ArrowUp' ? 0.125 : -0.125));
        });
        g.appendChild(c);
      }
    kgBox.appendChild(g);
  }
  let mx = 0;
  for (const v of k.v) mx = Math.max(mx, Math.abs(v));
  for (const c of $$('.kc', kgBox)) {
    const n = Number(c.dataset.n),
      v = k.v[n],
      a = Math.abs(v) / (mx || 1);
    c.style.background = isMedian()
      ? 'var(--inset)'
      : `color-mix(in srgb,${v >= 0 ? 'var(--ch1)' : 'var(--ch2)'} ${Math.round(a * 48)}%,var(--surface))`;
    txt(c, isMedian() ? '·' : fw(v));
    c.setAttribute('aria-label', `${Math.floor(n / k.w) + 1} 行 ${(n % k.w) + 1} 列`);
    c.setAttribute('aria-valuenow', String(v));
    c.toggleAttribute('aria-disabled', isMedian());
  }
}
function kernelUI(): void {
  const k = curK();
  kernelGrid();
  const sep = isMedian() ? null : separate(k);
  let m: string[];
  if (isMedian()) m = [`${k.w}×${k.h} の窓`, '中央値', '非線形'];
  else if (isGrad()) m = ['Sobel x・y', '√(Gx² + Gy²)', '非線形'];
  else {
    const n = k.w * k.h,
      ops = sep && n > 9 ? `積和 ${k.w + k.h} 回/画素（直接なら ${n} 回）` : `積和 ${n} 回/画素`;
    m = [
      `${k.w}×${k.h}${k.w > 7 || k.h > 7 ? '（中央 7×7）' : ''}`,
      `係数の和 ${fw(ksum(k))}`,
      sep ? '分離可能' : '分離不可',
      ops,
    ];
  }
  /* 区切りの所でだけ折り返す */
  html(kmeta, m.map((x) => `<span>${x}</span>`).join(' · '));
  kreset.disabled = !S.kern;
  /* 数値の行は例のカーネルのときだけ */
  for (const p of PARAMS) $(`#p-${p.k}`).hidden = !!S.kern || !(USES[S.kn] ?? []).includes(p.k as ParamKey);
  viewCh.disable('in', isNC());
  paintH();
  txt($('#o-op'), isMedian() ? 'メディアン' : isGrad() ? '勾配の大きさ' : S.corr ? '相関' : '畳み込み');
}
/** カーネルの周波数特性 |H|（0 の周波数を中央に、直線の目盛り） */
function paintH(): void {
  const g = cvH.getContext('2d');
  if (!g) return;
  const n = 64,
    id = g.createImageData(n, n),
    hk = isNC() ? null : kspec(curK(), n);
  let m = 0;
  if (hk) for (const v of hk) m = Math.max(m, v);
  const top = Math.max(1, m);
  for (let i = 0; i < n * n; i++) {
    const b = hk ? Math.round(Math.min(1, hk[i] / top) * 255) : 0;
    id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = b;
    id.data[4 * i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  txt(hcap, hk ? `周波数特性 |H|（白 = ${top === 1 ? '1' : f2(top)}）` : '|H| なし（非線形）');
}

/* ---------- まとめて描く ---------- */
const trk = $('#trk'),
  trkF = $('#trk-f'),
  trkT = $('#trk-t'),
  ppBtn = $('#b-pp'),
  oPl = $('#o-pl'),
  oY = $('#o-y'),
  sShow = $('#s-show'),
  sLg = $('#s-lg'),
  sSt = $('#s-st');
function render(): void {
  paint();
  overlay();
  placeLoupe();
  windowPanel();
  const [r, c] = curRC(),
    p = curPos() / Math.max(1, total() - 1);
  html(oPl, scatter() ? `入力 <b>(${c}, ${r})</b>` : `画素 <b>(${c}, ${r})</b>`);
  txt(oY, scatter() ? '—' : f3(OUT.v[r * W + c] ?? 0));
  txt(sShow, SHOW === 'clip' ? '0〜1' : SHOW === 'abs' ? `0〜${GAIN}` : `±${GAIN}（0 が灰色）`);
  txt(sLg, scatter() ? '線より上: 足しかけの出力　下: 入力' : '線より上: 出力　下: 入力');
  txt(sSt, S.view === 'in' && isNC() ? '「配る」は線形のカーネルだけ' : '');
  trkF.style.width = `${p * 100}%`;
  trkT.style.left = `${p * 100}%`;
  trk.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  trk.setAttribute('aria-valuetext', `${scatter() ? '入力' : '画素'} (${c}, ${r})`);
  ppBtn.classList.toggle('on', S.play);
  ppBtn.setAttribute('aria-label', S.play ? '一時停止' : '再生');
  ppBtn.title = S.play ? '一時停止' : '再生';
}

/* ---------- 入力 ---------- */
const P = new ParamGroup<ParamKey>(PARAMS, (v) => {
  V = v;
  recompute(true);
});
V = P.values();
const srcCh = new Choice<SrcName>($('#p-src'), (v) => {
  if (v === 'own') {
    srcCh.set(S.src);
    $<HTMLInputElement>('#fileIn').click();
    return;
  }
  S.src = v;
  $('#g-brush').hidden = v !== 'draw';
  useSrc();
  recompute();
});
const edgeCh = new Choice<Edge>($('#p-edge'), (v) => {
  S.edge = v;
  recompute();
});
const knCh = new Choice<KindName>($('#p-kn'), (v) => {
  if (!v) return;
  S.kn = v;
  S.kern = null;
  kgKey = '';
  if (scatter()) S.q = 0;
  recompute(true);
});
const viewCh = new Choice<'out' | 'in'>($('#p-view'), (v) => {
  S.view = v;
  S.q = 0;
  ACC = null;
  S.play = !RM.matches;
  render();
});
new Choice<'pick' | 'w' | 'k'>($('#p-brush'), (v) => {
  S.brush = v;
});
const spdCh = new Choice<string>($('#p-spd'));
S.edge = edgeCh.value;
S.kn = knCh.value || 'gauss';

function ownImage(f: File | undefined): void {
  if (!f?.type.startsWith('image/')) return;
  const url = URL.createObjectURL(f);
  loadImage(
    url,
    (im) => {
      SRCIMG.own = cover(im);
      URL.revokeObjectURL(url);
      S.src = 'own';
      srcCh.set('own');
      $('#g-brush').hidden = true;
      useSrc();
      recompute();
    },
    () => URL.revokeObjectURL(url),
  );
}
$<HTMLInputElement>('#fileIn').addEventListener('change', (e) => {
  const inp = e.target as HTMLInputElement;
  ownImage(inp.files?.[0]);
  inp.value = '';
});
stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  stage.classList.add('drop');
});
stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('drop');
  ownImage(e.dataTransfer?.files[0]);
});
$('#b-clear').addEventListener('click', () => {
  SRCIMG.draw = drawImg();
  useSrc();
  recompute();
});
const opCh = new Choice<'conv' | 'corr'>($('#p-op'), (v) => {
  S.corr = v === 'corr';
  recompute(true);
});
S.corr = opCh.value === 'corr';
kreset.addEventListener('click', () => {
  S.kern = null;
  kgKey = '';
  knCh.set(S.kn);
  recompute(true);
});

/* 走査の操作 */
$('#b-pp').addEventListener('click', () => {
  S.play = !S.play;
  if (S.play && curPos() >= total() - 1) setPos(0);
  carry = 0;
  render();
});
$('#b-home').addEventListener('click', () => {
  S.play = false;
  setPos(0);
  render();
});
$('#b-step').addEventListener('click', () => {
  S.play = false;
  setPos(curPos() + 1);
  render();
});
function seek(e: PointerEvent): void {
  const b = trk.getBoundingClientRect();
  S.play = false;
  setPos(Math.round(Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * (total() - 1)));
  render();
}
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  seek(e);
});
trk.addEventListener('pointermove', (e) => {
  if (trk.hasPointerCapture(e.pointerId)) seek(e);
});
/** 矢印キーで動かす: ← → は 1 画素、↑ ↓ は 1 行 */
function keyMove(e: KeyboardEvent): void {
  const row = scatter() ? EW() : W,
    d: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -row,
      ArrowDown: row,
      PageUp: -16 * row,
      PageDown: 16 * row,
    };
  let p: number | null = null;
  if (e.key in d) p = curPos() + d[e.key];
  else if (e.key === 'Home') p = 0;
  else if (e.key === 'End') p = total() - 1;
  if (p == null) return;
  e.preventDefault();
  S.play = false;
  setPos(p);
  render();
}
trk.addEventListener('keydown', keyMove);
stage.addEventListener('keydown', keyMove);

/* 画像を押すとその画素へ（手描きでは白・黒で塗る） */
function at(e: PointerEvent): [number, number] {
  const b = cv.getBoundingClientRect();
  return [
    Math.floor(((e.clientY - b.top) / b.height) * PH) - PAD,
    Math.floor(((e.clientX - b.left) / b.width) * PW) - PAD,
  ];
}
function pick(e: PointerEvent): void {
  const [r, c] = at(e);
  if (S.src === 'draw' && S.brush !== 'pick') {
    const v = S.brush === 'w' ? 1 : 0.08;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++)
        if (r + j >= 0 && r + j < H && c + i >= 0 && c + i < W) SRC.v[(r + j) * W + c + i] = v;
    recompute();
    return;
  }
  if (r < 0 || r >= H || c < 0 || c >= W) return;
  S.play = false;
  if (scatter()) {
    const [cx, cy] = kr();
    S.q = (r + cy) * EW() + c + cx;
  } else S.pos = r * W + c;
  render();
}
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  pick(e);
});
cv.addEventListener('pointermove', (e) => {
  if (cv.hasPointerCapture(e.pointerId)) pick(e);
});

/* ---------- 走査 ---------- */
let last = 0,
  carry = 0;
function tick(ts: number): void {
  const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
  last = ts;
  if (S.play) {
    carry += dt * (SPEEDS.find((s) => s[0] === spdCh.value)?.[2] ?? 900);
    const n = Math.floor(carry);
    carry -= n;
    if (n > 0) {
      const p = curPos() + n;
      if (p >= total() - 1) S.play = false;
      setPos(p);
      render();
    }
  }
  requestAnimationFrame(tick);
}
let rsz = 0,
  rw = 0;
new ResizeObserver(([e]) => {
  /* 幅が変わったときだけ（中身で高さが変わるたびには作り直さない） */
  if (Math.abs(e.contentRect.width - rw) < 1) return;
  rw = e.contentRect.width;
  cancelAnimationFrame(rsz);
  rsz = requestAnimationFrame(() => {
    kgKey = '';
    if (ready) {
      kernelGrid();
      render();
    }
  });
}).observe($('.tgrid'));

useSrc();
ready = true;
recompute(true);
requestAnimationFrame(tick);
loadImage(`${BASE}image-convolution/moon.jpg`, (im) => {
  SRCIMG.moon = cover(im);
  if (S.src === 'moon') {
    useSrc();
    recompute();
  }
});

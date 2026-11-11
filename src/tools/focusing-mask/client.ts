/**
 * フォーカシングマスクのページの入口: 入力 → 星の像（Worker で回折を計算）→ カメラの映像・光条の解析・
 * グラフ・横から見た光の通り道・計算結果
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { reserveHeight } from '../../lib/reserve';
import { mark } from '../../lib/reset';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { toRgba } from './camera';
import { starBands } from './color';
import { type Cam, expose, type Scene } from './engine';
import { reading, type Section, sections, spot } from './geometry';
import { keyOf, type Mask, type MaskImage, type MaskKind, rasterize, type Scope } from './mask';
import { fitBahtinov, hfd } from './measure';
import type { Aberr, Img } from './optics';
import { type Key, MAG0, MASKS, OBS0, PARAMS, type ScopeKind, type SrcKind, SW0, sig, TH0 } from './params';
import { type Beam, type Curve, FSC, fscSvg, fscValue, gpSvg, niceMax, raySvg, scaleRange, sgn } from './plot';
import { Pool } from './pool';
import { cluster, doubleStar, type Plane, type Raster, type Star } from './source';
import type { Msg } from './worker';

const txt = (id: string, s: string) => {
  const e = $(id);
  if (e.textContent !== s) e.textContent = s;
};
const html = (id: string, s: string) => {
  const e = $(id);
  if (e.innerHTML !== s) e.innerHTML = s;
};
/** 計算結果の値（末尾の 0 を残す）と単位 */
const rv = (s: string, u: string) => `${s}<span class="u">${u}</span>`;
const DASH = '—';
/** 有効数字 3 桁、符号つき */
const sg3 = (v: number) => (v > 0 ? '+' : '') + sig(v, 3, true);
const RAD = Math.PI / 180;
const RAD_AS = RAD / 3600;
const LAMBDA = 0.55;

initToolPage();

/* ---------- 入力 ---------- */
let G: ParamGroup<Key>;
/** 入力を組み立て終えたか（ParamGroup は生成の中で一度 onChange を呼ぶ） */
let ready = false;
/** 保存した値を戻している間（選択肢の onChange が生成の直後に呼ばれる） */
let boot = true;
const later = () => {
  if (ready) schedule();
};
const mk$ = new Choice<MaskKind>($('#p-mk'), (v) => setMask(v));
const tp$ = new Choice<ScopeKind>($('#p-tp'), (v) => setScope(v));
const or$ = new Choice<'std' | 'rev'>($('#p-or'), later);
const ov$ = new Choice<'on' | 'off'>($('#p-ov'), () => draw());
const gv$ = new Choice<'both' | 'one'>($('#p-gv'), () => drawGraph());
const st$ = new Choice<'lin' | 'asinh'>($('#p-st'), () => draw());
const cm$ = new Choice<'color' | 'mono'>($('#p-cm'), () => draw());
const ic$ = new Choice<'white' | 'black'>($('#p-ic'), later);
const im$ = new Choice<'circle' | 'whole'>($('#p-im'), later);
/** 等級と色温度の行の名前（二重星は主星、星団は最も明るい星） */
const MAG_NAMES = ['等級', '主星の等級', '最も明るい星の等級'],
  T_NAMES = ['星の色温度', '主星の色温度'];
const src$ = new Choice<SrcKind>($('#p-src'), (v) => setSrc(v));

/* ---------- 画像のマスク ---------- */
/** 読み込んだ画像の明るさ（1 辺 SRC_N の正方形、0〜1、行は上から） */
const SRC_N = 512;
let src: { L: Float32Array; name: string; id: number } | null = null,
  srcId = 0,
  mimg: MaskImage | undefined;
/** しきい値と光を通す色から、透過率の画像を作る（境目は明るさ ±4 % でぼかす） */
function maskImage(thr: number, white: boolean): MaskImage | undefined {
  if (!src) return undefined;
  const key = `${src.id}:${thr}:${white ? 'w' : 'b'}`;
  if (mimg?.key === key) return mimg;
  const t = thr / 100,
    w = 0.04,
    a = new Float32Array(SRC_N * SRC_N);
  for (let i = 0; i < a.length; i++) {
    const v = Math.max(0, Math.min(1, (src.L[i] - t) / (2 * w) + 0.5));
    a[i] = white ? v : 1 - v;
  }
  mimg = { n: SRC_N, a, key };
  return mimg;
}
/** 画像を正方形に収め（縦横比は保ち、余りは黒）、明るさにする。透明な所は黒とみなす */
function luminance(img: CanvasImageSource, w: number, h: number): Float32Array {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SRC_N;
  const ctx = cv.getContext('2d');
  const L = new Float32Array(SRC_N * SRC_N);
  if (!ctx) return L;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SRC_N, SRC_N);
  const k = SRC_N / Math.max(w, h),
    dw = w * k,
    dh = h * k;
  ctx.drawImage(img, (SRC_N - dw) / 2, (SRC_N - dh) / 2, dw, dh);
  const d = ctx.getImageData(0, 0, SRC_N, SRC_N).data,
    lin = (c: number) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
  /* 明るさは sRGB を線形に戻した輝度を、もう一度 sRGB の明るさの尺度にしたもの（見た目の明るさに近い） */
  for (let i = 0; i < L.length; i++) {
    const Y = 0.2126 * lin(d[i * 4]) + 0.7152 * lin(d[i * 4 + 1]) + 0.0722 * lin(d[i * 4 + 2]);
    L[i] = Y <= 0.0031308 ? 12.92 * Y : 1.055 * Y ** (1 / 2.4) - 0.055;
  }
  return L;
}
/** 開き直したときに戻すため、明るさを 256 画素の PNG にして保存する */
function keepImage(name: string): void {
  if (!src) return;
  const n = 256,
    cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const im = ctx.createImageData(n, n),
    k = SRC_N / n;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const v = Math.round(255 * src.L[Math.floor((j + 0.5) * k) * SRC_N + Math.floor((i + 0.5) * k)]),
        q = (j * n + i) * 4;
      im.data[q] = im.data[q + 1] = im.data[q + 2] = v;
      im.data[q + 3] = 255;
    }
  ctx.putImageData(im, 0, 0);
  try {
    store('img', { name, url: cv.toDataURL('image/png') });
  } catch {
    /* 保存できなくても、このページを開いている間は使える */
  }
}
async function loadFile(f: File): Promise<void> {
  txt('#mf-m', '');
  try {
    const bm = await createImageBitmap(f);
    src = { L: luminance(bm, bm.width, bm.height), name: f.name, id: ++srcId };
    bm.close();
    keepImage(f.name);
    if (mk$.value !== 'image') mk$.set('image');
    schedule();
  } catch {
    txt('#mf-m', '画像を読めませんでした。PNG・JPEG・WebP・GIF などを選んでください。');
  }
}
/** 保存した画像を戻す */
function restoreImage(): void {
  const v = stored('img') as { name?: string; url?: string } | undefined;
  if (!v?.url) return;
  const im = new Image();
  im.onload = () => {
    src = { L: luminance(im, im.naturalWidth, im.naturalHeight), name: v.name ?? '', id: ++srcId };
    if (ready) schedule();
  };
  im.src = v.url;
}
{
  const inp = $<HTMLInputElement>('#mf-in'),
    mf = $('#mf');
  inp.addEventListener('change', () => {
    const f = inp.files?.[0];
    if (f) void loadFile(f);
    inp.value = '';
  });
  mf.addEventListener('dragover', (e) => {
    if (mk$.value !== 'image') return;
    e.preventDefault();
    mf.classList.add('drag');
  });
  mf.addEventListener('dragleave', () => mf.classList.remove('drag'));
  mf.addEventListener('drop', (e) => {
    mf.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (mk$.value !== 'image' || !f) return;
    e.preventDefault();
    void loadFile(f);
  });
}

/* ---------- 光源の画像 ---------- */
/** 光源の画像の長い辺の上限（画素） */
const SRC_MAX = 1024;
let srcImg: { img: Raster; name: string; id: number } | null = null;
/** 画像を長い辺 m 画素までに縮め、線形 sRGB にする。透明な所は黒とみなす */
function toRaster(img: CanvasImageSource, w: number, h: number, m = SRC_MAX): Raster {
  const k = Math.min(1, m / Math.max(w, h)),
    W = Math.max(1, Math.round(w * k)),
    H = Math.max(1, Math.round(h * k)),
    cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d'),
    r = new Float32Array(W * H),
    g = new Float32Array(W * H),
    b = new Float32Array(W * H);
  if (!ctx) return { w: W, h: H, r, g, b };
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data,
    lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    lin[i] = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }
  for (let i = 0; i < W * H; i++) {
    r[i] = lin[d[i * 4]];
    g[i] = lin[d[i * 4 + 1]];
    b[i] = lin[d[i * 4 + 2]];
  }
  return { w: W, h: H, r, g, b };
}
/** 開き直したときに戻すため、長い辺 512 画素の JPEG にして保存する */
function keepSrc(bm: ImageBitmap, name: string): void {
  const k = Math.min(1, 512 / Math.max(bm.width, bm.height)),
    cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bm.width * k));
  cv.height = Math.max(1, Math.round(bm.height * k));
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bm, 0, 0, cv.width, cv.height);
  try {
    store('srcimg', { name, url: cv.toDataURL('image/jpeg', 0.9) });
  } catch {
    /* 保存できなくても、このページを開いている間は使える */
  }
}
async function loadSrcFile(f: File): Promise<void> {
  txt('#src-m', '');
  try {
    const bm = await createImageBitmap(f);
    srcImg = { img: toRaster(bm, bm.width, bm.height), name: f.name, id: ++srcId };
    keepSrc(bm, f.name);
    bm.close();
    if (src$.value !== 'image') {
      src$.choose('image');
      setSrc('image');
    } else schedule();
  } catch {
    txt('#src-m', '画像を読めませんでした。PNG・JPEG・WebP・GIF などを選んでください。');
  }
}
/** 保存した光源の画像を戻す */
function restoreSrc(): void {
  const v = stored('srcimg') as { name?: string; url?: string } | undefined;
  if (!v?.url) return;
  const im = new Image();
  im.onload = () => {
    srcImg = { img: toRaster(im, im.naturalWidth, im.naturalHeight), name: v.name ?? '', id: ++srcId };
    if (ready) schedule();
  };
  im.src = v.url;
}
{
  const inp = $<HTMLInputElement>('#src-in'),
    sv = $('#sv');
  inp.addEventListener('change', () => {
    const f = inp.files?.[0];
    if (f) void loadSrcFile(f);
    inp.value = '';
  });
  sv.addEventListener('dragover', (e) => {
    if (src$.value !== 'image') return;
    e.preventDefault();
    sv.classList.add('drag');
  });
  sv.addEventListener('dragleave', () => sv.classList.remove('drag'));
  sv.addEventListener('drop', (e) => {
    sv.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (src$.value !== 'image' || !f) return;
    e.preventDefault();
    void loadSrcFile(f);
  });
}

/** ピントの位置（µm）。入力なので保存する */
let dz = 100;
{
  const v = stored('dz');
  if (typeof v === 'number' && Number.isFinite(v)) dz = v;
}

G = new ParamGroup<Key>(PARAMS, later);

/**
 * マスクを選んだとき: 斜めの格子の角度の既定値を、マスクごとの値にする。
 * 開き直して保存した値を戻している間は、角度を保存していればその値を残す
 */
function setMask(v: MaskKind): void {
  const t0 = TH0[v];
  if (t0 != null) {
    G.update('th', { v: t0 });
    if (!boot || stored('p:th') === undefined) G.set('th', t0, { silent: true });
  }
  later();
}
/** 望遠鏡の形式を選んだとき: 中央遮蔽の既定値を形式ごとの値にする（屈折では使わない） */
function setScope(v: ScopeKind): void {
  if (v !== 'refr') {
    G.update('obs', { v: OBS0[v] });
    if (!boot || stored('p:obs') === undefined) G.set('obs', OBS0[v], { silent: true });
  }
  later();
}
/**
 * 光源を選んだとき: 幅の既定値を光源ごとの値にし、押して選んだときは光源の全体が映るまで引く
 * （保存した値を戻している間は、幅を保存していればその値を残し、拡大も変えない）
 */
function setSrc(v: SrcKind): void {
  for (const [k, d] of [
    ['sw', SW0[v]],
    ['mag', MAG0[v]],
  ] as const) {
    if (d == null) continue;
    G.update(k, { v: d });
    if (!boot || stored(`p:${k}`) === undefined) G.set(k, d, { silent: true });
  }
  labelMag(v);
  if (!ready) return;
  schedule();
  if (!boot) {
    const h = objHalf(C);
    vx = vy = 0;
    if (h > 0) setZoom(Math.min(1, BASE / (2.3 * h)));
  }
}

/* 光源を替えると行の名前の長さが変わる。いちばん長い名前の高さを取っておき、行を動かさない */
reserveHeight(
  $('#n-mag'),
  MAG_NAMES.map((n) => `<span class="sr">等級 </span>${n}`),
  { html: true },
);
reserveHeight(
  $('#n-T'),
  T_NAMES.map((n) => `<span class="sr">T </span>${n}`),
  { html: true },
);
function labelMag(v: SrcKind): void {
  const name = v === 'double' ? MAG_NAMES[1] : v === 'cluster' ? MAG_NAMES[2] : MAG_NAMES[0];
  if (G.def('mag').name !== name) G.update('mag', { name });
  const tn = v === 'double' ? T_NAMES[1] : T_NAMES[0];
  if (G.def('T').name !== tn) G.update('T', { name: tn });
}

/* ---------- 条件 ---------- */
/** 光源（星 1 つのほか）: 星の並びか、画像と幅（rad） */
type Obj = { kind: 'stars'; stars: Star[] } | { kind: 'raster'; img: Raster; W: number };
interface Cond {
  kind: MaskKind;
  D: number;
  f: number;
  N: number;
  sc: Scope;
  m: Mask;
  ab?: Aberr;
  T: number;
  cam: Cam;
  ex: number;
  /** 星の等級と、画像の白い所の 1 平方秒角あたりの等級 */
  mag: number;
  sb: number;
  cfz: number;
  R: number;
  src: SrcKind;
  /** 光源（星 1 つと、画像を選んでいないときは null）と、その鍵 */
  obj: Obj | null;
  objKey: string;
}

function cond(): Cond {
  const v = G.values(),
    kind = mk$.value,
    tp = tp$.value,
    R = v.D / 2,
    grating = kind === 'bahtinov' || kind === 'tri' || kind === 'carey',
    isImg = kind === 'image',
    /* JWST と、開口全体として使う画像は、鏡筒の口・中央遮蔽・スパイダーを使わない */
    own = kind === 'jwst' || (isImg && im$.value === 'whole');
  G.setOff('th', !grating, 'このマスクでは使いません');
  G.setOff('bf', !grating, 'このマスクでは使いません');
  G.setOff('hd', kind !== 'hartmann' && kind !== 'scheiner', '穴のマスクだけで使います');
  G.setOff('obs', tp === 'refr' || own, own ? 'このマスクでは使いません' : '屈折では使いません');
  for (const id of ['#p-thr', '#p-ic', '#p-im', '#mf-f']) $(id).hidden = !isImg;
  $('#mf-drop').hidden = !isImg || !!src;
  txt('#mf-n', isImg && src ? src.name : '');
  /* 光源 */
  const sk = src$.value,
    star = sk === 'star' || sk === 'double';
  $('#p-sw').hidden = star;
  $('#p-mag').hidden = sk === 'image';
  $('#p-sb').hidden = sk !== 'image';
  for (const id of ['#p-sep', '#p-dm', '#p-T2']) $(id).hidden = sk !== 'double';
  $('#src-f').hidden = sk !== 'image';
  txt('#src-n', sk === 'image' && srcImg ? srcImg.name : '');
  G.setOff('T', !star, 'この光源では使いません');
  ov$.setOff(sk !== 'star');
  /* 解析が使えないときは、ボタンの代わりに破線の枠で理由を出す */
  $('#p-ov').hidden = sk !== 'star';
  $('#ov-off').hidden = sk === 'star';
  const W = v.sw * 60 * RAD_AS;
  let obj: Obj | null = null,
    objKey = sk;
  if (sk === 'double') {
    obj = { kind: 'stars', stars: doubleStar(v.sep, v.dm, v.T, v.T2) };
    objKey += ` ${v.sep} ${v.dm} ${v.T} ${v.T2}`;
  } else if (sk === 'cluster') {
    obj = { kind: 'stars', stars: cluster(W) };
    objKey += ` ${v.sw}`;
  } else if (sk === 'image' && srcImg) {
    obj = { kind: 'raster', img: srcImg.img, W };
    objKey += ` ${v.sw} ${srcImg.id}`;
  }
  mark();
  const sc: Scope = {
    obs: tp === 'refr' ? 0 : v.obs / 100,
    vanes: tp === 'newt' ? 4 : 0,
    /* スパイダーの幅 2 mm */
    vw: 2 / R,
  };
  const m: Mask = {
    kind,
    p: v.f / v.bf / R,
    th: v.th * RAD,
    th2: kind === 'carey' ? ((v.th * 10) / 12) * RAD : undefined,
    duty: 0.5,
    bar: v.bar / R,
    rot: v.rot * RAD,
    holes: 3,
    hd: (2 * v.hd) / 100,
    hr: 0.6,
    flip: or$.value === 'rev',
    img: isImg ? maskImage(v.thr, ic$.value === 'white') : undefined,
    whole: isImg && im$.value === 'whole',
  };
  const ab: Aberr | undefined =
    v.coma || v.ast ? { cx: v.coma * LAMBDA, cy: 0, a0: v.ast * LAMBDA, a45: 0, sph: 0 } : undefined;
  const N = v.f / v.D,
    cfz = 2 * LAMBDA * N * N;
  return {
    kind,
    D: v.D,
    f: v.f,
    N,
    sc,
    m,
    ab,
    T: v.T,
    cam: { pitch: v.px, n: 224, see: v.see },
    ex: v.ex,
    mag: v.mag,
    sb: v.sb,
    cfz,
    R: scaleRange(cfz),
    src: sk,
    obj,
    objKey,
  };
}

/* ---------- 計算（Worker） ---------- */
const pool = new Pool();
/** FFT の大きさ（ふだんと、×1 の点像の範囲より引いたとき）と、操作中・止めたあとの波長の帯の数 */
const NFFT = 1024,
  NFFT_WIDE = 2048,
  NB_QUICK = 6,
  NB_FULL = 16;
/** 拡大の範囲 */
const ZMIN = 0.1,
  ZMAX = 16;
let C = cond();
let S: Section[] = [];
let secKey = '';
/** カメラの像（格子）: s はカメラの画素いくつを 1 画素にまとめたか、ox・oy は左上の角の光軸からの位置（カメラの画素） */
interface Frame extends Img {
  s: number;
  ox: number;
  oy: number;
  /** 光源の像を作ったときの点像と光源（星 1 つの像は ''） */
  key: string;
}
let frame: Frame | null = null;
/** 最後に計算した点像（拡大・縮小でカメラの像を作り直すときに使う）と、その通し番号 */
let lastPsf: { img: Img; c: Cond; N: number; id: number } | null = null;
let psfSeq = 0;
/** 映像の拡大（×1 で BASE 画素）と、表示の中心（光軸からの画素、下が正） */
let zoom = 1,
  vx = 0,
  vy = 0;
{
  const z = stored('zoom');
  if (typeof z === 'number' && Number.isFinite(z) && z > 0) zoom = Math.max(ZMIN, Math.min(ZMAX, z));
}
/** マスクなしで合焦した星像（露出の基準と HFD の基準） */
let ref: { key: string; peak: number; hfd: number } | null = null;
let busy = false,
  dirty = false,
  /** 今の条件で、全部の帯を計算し終えたか */
  full = false,
  version = 0;

/** ×1 で映像の幅に出すカメラの画素の数 */
const BASE = 224;
/** カメラの 1 画素の角度（rad） */
const betaOf = (c: Cond): number => (c.cam.pitch * 1e-6) / (c.f * 1e-3);
/** 点像の範囲（FFT の大きさ N、点像は N/2 の画素）に収まるカメラの画素の数 */
const nFov = (c: Cond, N = nfftOf(c)): number => {
  const alpha = 400e-9 / (1.1 * c.D * 1e-3);
  return Math.max(32, Math.min(1024, 2 * Math.floor(((N / 2) * alpha) / betaOf(c) / 2)));
};
/**
 * 今の拡大で使う FFT の大きさ: 星 1 つの像で、×1 の点像の範囲より引いたときだけ広げる
 * （光源の像は畳み込みが重くなるので広げない）
 */
function nfftOf(c: Cond): number {
  return !c.obj && BASE / zoom > nFov(c, NFFT) + 1e-6 ? NFFT_WIDE : NFFT;
}
/** 星 1 つの像の 1 辺（×1 より縮小すると点像の範囲まで広げる） */
const needN = (c: Cond): number => Math.min(nFov(c), Math.max(BASE, 2 * Math.ceil(BASE / zoom / 2)));
const camOf = (c: Cond, n = Math.min(BASE, nFov(c, NFFT))): Cam => ({ ...c.cam, n });
/** 点像の条件。広げた FFT は重いので、操作中（少ない帯）はふだんの大きさで作る */
const sceneOf = (c: Cond, nb: number, N = nb < NB_FULL ? NFFT : nfftOf(c)): Scene => ({
  D: c.D,
  f: c.f,
  dz,
  sc: c.sc,
  m: c.m,
  ab: c.ab,
  /* 光源が星 1 つでないときは白い光の点像を作り、星の色や画像の色を後で掛ける */
  T: c.obj ? 6500 : c.T,
  nb,
  N,
});

/** 光源の中心から端までの長さ（カメラの画素、星 1 つは 0） */
function objHalf(c: Cond): number {
  const o = c.obj,
    b = betaOf(c);
  if (!o) return 0;
  if (o.kind === 'raster') return Math.max(o.W, (o.W * o.img.h) / o.img.w) / 2 / b;
  let m = 0;
  for (const s of o.stars) m = Math.max(m, Math.abs(s.x), Math.abs(s.y));
  return m / b;
}
/** 映像の中心を動かせる範囲（光軸からの画素） */
function extent(): number {
  if (C.obj) return objHalf(C) + nFov(C) / 2;
  return frame && !frame.key ? frame.n / 2 : BASE / 2;
}

/** 像の計算に効く条件の鍵（露出・等級だけの変更では計算し直さない） */
let calcKey = '';
function schedule(): void {
  C = cond();
  const ck = keyOf([C.D, C.f, C.sc, C.m, C.ab ?? null, C.obj ? 0 : C.T, C.cam, C.objKey]);
  if (ck === calcKey && lastPsf) {
    drawStatic();
    draw();
    return;
  }
  calcKey = ck;
  version++;
  full = false;
  const k = keyOf([C.sc, C.m, C.ab ?? null]);
  if (k !== secKey) {
    secKey = k;
    S = sections(C.sc, C.m, C.ab);
    drawMask();
  }
  drawStatic();
  refStar();
  const noImg = C.src === 'image' && !C.obj;
  $('#sv-drop').hidden = !noImg;
  if (noImg) {
    frame = null;
    $('#sv-busy').hidden = true;
    draw();
    return;
  }
  void run();
}

/** 計算を 1 つずつ流す（操作中は少ない帯、止まったら全部の帯）。点像のあとにカメラの像を作る */
async function run(): Promise<void> {
  if (busy) {
    dirty = true;
    return;
  }
  busy = true;
  dirty = false;
  const v = version,
    nb = full ? NB_FULL : NB_QUICK,
    c = C,
    sc = sceneOf(c, nb),
    img = await pool.render(sc, 'main');
  if (img && v === version) {
    lastPsf = { img, c, N: sc.N, id: ++psfSeq };
    kern = null;
    await post();
  }
  busy = false;
  if (img && v === version && nb === NB_QUICK && !dirty) {
    full = true;
    void run();
    return;
  }
  if (dirty || v !== version) void run();
}

/** 最後の点像から、今の拡大でのカメラの像を作る */
async function post(): Promise<void> {
  if (C.obj) await renderObj();
  else await renderStar();
}

/** 星 1 つの像: 点像をカメラの画素に積分し、シーイングで広げる */
async function renderStar(): Promise<void> {
  const L = lastPsf;
  if (!L || L.c.obj) return;
  const c = L.c,
    n = Math.min(needN(c), nFov(c, L.N)),
    r = await pool.run<Img>('exp', [{ m: { t: 'exp', img: L.img, px: betaOf(c), n, see: c.cam.see * RAD_AS } }]);
  if (!r || lastPsf !== L || C.obj) return;
  frame = { ...r[0], s: 1, ox: -n / 2, oy: -n / 2, key: '' };
  $('#sv-busy').hidden = true;
  draw();
}

/** 格子の大きさの点像（核）: 通し番号と格子ごとに 1 つ */
let kern: { key: string; K: Img } | null = null;
/** 光源の像を作る範囲: 格子 s、左上の角 ox・oy（カメラの画素）、1 辺 R、核の 1 辺 nk */
function regionOf(c: Cond, N: number): { s: number; ox: number; oy: number; R: number; nk: number } {
  const sw = BASE / zoom,
    E = extent(),
    W = Math.max(256, svc.width || 0);
  let s = 1;
  while (sw / s > W) s *= 2;
  for (;;) {
    const nk = 2 * Math.ceil(nFov(c, N) / s / 2),
      side = Math.min(sw * 1.3, 2 * E),
      R = 2 * Math.ceil(side / s / 2);
    if (R + nk <= 1024 || s >= 64) {
      const cx = Math.max(-E, Math.min(E, vx)),
        cy = Math.max(-E, Math.min(E, vy));
      return { s, R, nk, ox: Math.floor((cx - (R * s) / 2) / s) * s, oy: Math.floor((cy - (R * s) / 2) / s) * s };
    }
    s *= 2;
  }
}
const objKeyOf = (c: Cond, id: number, s: number) => `${id} ${s} ${c.objKey}`;
/** 今の像が、今の拡大で見える範囲を覆っているか */
function covered(): boolean {
  const fr = frame,
    L = lastPsf;
  if (!fr || !L || !C.obj) return false;
  const g = regionOf(C, L.N),
    sw = BASE / zoom,
    E = extent(),
    x0 = Math.max(vx - sw / 2, -E),
    y0 = Math.max(vy - sw / 2, -E),
    x1 = Math.min(vx + sw / 2, E),
    y1 = Math.min(vy + sw / 2, E),
    e = fr.n * fr.s;
  return (
    fr.key === objKeyOf(C, L.id, g.s) &&
    x0 >= fr.ox - 1e-6 &&
    y0 >= fr.oy - 1e-6 &&
    x1 <= fr.ox + e + 1e-6 &&
    y1 <= fr.oy + e + 1e-6
  );
}

/** 光源の像: 光源を格子に標本にし、格子の大きさに積分した点像と畳み込む（色ごとに Worker で） */
async function renderObj(): Promise<void> {
  const L = lastPsf,
    c = C,
    o = c.obj;
  if (!L || !o || L.c.objKey !== c.objKey) return;
  const g = regionOf(c, L.N),
    b = betaOf(c),
    key = objKeyOf(c, L.id, g.s);
  if (!frame || frame.key.split(' ').slice(2).join(' ') !== c.objKey) $('#sv-busy').hidden = false;
  if (kern?.key !== `${L.id} ${g.s}`) {
    const r = await pool.run<Img>('kern', [
      { m: { t: 'exp', img: L.img, px: b * g.s, n: g.nk, see: c.cam.see * RAD_AS } },
    ]);
    if (!r || lastPsf !== L) return;
    kern = { key: `${L.id} ${g.s}`, K: r[0] };
  }
  const K = kern.K,
    /* 光源を標本にする範囲は、像の範囲の外へ核の半分ずつ広い */
    x0 = g.ox - (g.nk / 2) * g.s,
    y0 = g.oy - (g.nk / 2) * g.s,
    planes: Plane[] = [0, 1, 2].map((ch) => {
      if (o.kind === 'stars') {
        const pts = new Float64Array(o.stars.length * 3);
        o.stars.forEach((st, i) => {
          pts[i * 3] = (st.x / b - x0) / g.s;
          pts[i * 3 + 1] = (st.y / b - y0) / g.s;
          pts[i * 3 + 2] = (st.F * colorOf(st.T)[ch]) / (g.s * g.s);
        });
        return { kind: 'stars', pts };
      }
      const im = o.img,
        pp = o.W / im.w,
        du = (g.s * b) / pp;
      return {
        kind: 'raster',
        w: im.w,
        h: im.h,
        a: [im.r, im.g, im.b][ch],
        u0: (x0 * b) / pp + im.w / 2,
        v0: (y0 * b) / pp + im.h / 2,
        du,
      };
    }),
    ks = [K.r, K.g, K.b],
    r = await pool.run<Float64Array>(
      'obj',
      planes.map((p, ch) => ({ m: { t: 'conv', p, K: ks[ch], nk: g.nk, R: g.R } as Msg })),
    );
  if (!r || lastPsf !== L || C.objKey !== c.objKey) return;
  frame = { n: g.R, px: b * g.s, r: r[0], g: r[1], b: r[2], s: g.s, ox: g.ox, oy: g.oy, key };
  $('#sv-busy').hidden = true;
  draw();
}

/** 色温度 T の星の色（線形 sRGB、輝度 1。6500 K で白）。白い光の点像の色ごとに掛ける */
const colors = new Map<number, [number, number, number]>();
function colorOf(T: number): [number, number, number] {
  const k = Math.round(T);
  let c = colors.get(k);
  if (!c) {
    const sum: [number, number, number] = [0, 0, 0];
    for (const bd of starBands(k, NB_FULL)) for (let i = 0; i < 3; i++) sum[i] += bd.rgb[i];
    c = sum;
    colors.set(k, c);
  }
  return c;
}

/** 拡大・移動で見える範囲が変わったとき、光源の像を作り直す（少し待って、まとめて） */
let reTimer = 0;
function refresh(): void {
  if (!lastPsf) return;
  if (!C.obj) {
    if (frame && !frame.key && frame.n !== needN(C)) void renderStar();
    return;
  }
  if (covered()) return;
  clearTimeout(reTimer);
  reTimer = window.setTimeout(() => {
    if (!covered()) void renderObj();
  }, 60);
}

/** マスクなしで合焦した星像: 露出の基準（最も明るい画素）と HFD の基準。望遠鏡・カメラ・星が変わったときだけ */
function refStar(): void {
  const cam = camOf(C),
    key = JSON.stringify([C.D, C.f, C.sc, C.T, cam]);
  if (ref?.key === key) return;
  const c = C,
    s: Scene = { ...sceneOf(c, 4, 512), dz: 0, m: { ...c.m, kind: 'none', img: undefined }, ab: undefined };
  void pool.render(s, 'ref').then((img) => {
    if (!img) return;
    const fr = expose(img, c.f, cam),
      Y = lum(fr);
    let pk = 0;
    for (const v of Y) pk = Math.max(pk, v);
    ref = { key, peak: pk, hfd: hfd(Y, fr.n) * c.cam.pitch };
    draw();
  });
}

/** 明るさ（線形 sRGB の輝度） */
function lum(p: Img): Float64Array {
  const Y = new Float64Array(p.n * p.n);
  for (let i = 0; i < Y.length; i++) Y[i] = 0.2126 * p.r[i] + 0.7152 * p.g[i] + 0.0722 * p.b[i];
  return Y;
}

/* ---------- ピントの位置（目盛り・つまみ・よく使う値） ---------- */
const fsc = $<SVGSVGElement>('#fsc'),
  focB = $('#foc-b');
function setDz(v: number, commit = true): void {
  const r = Math.round(Math.max(-C.R, Math.min(C.R, v)));
  if (r === dz) return;
  dz = r;
  if (commit) {
    if (dz === 100) forget('dz');
    else store('dz', dz);
  }
  version++;
  full = false;
  drawStatic();
  void run();
}
const xOf = (e: PointerEvent) => {
  const b = fsc.getBoundingClientRect();
  return ((e.clientX - b.left) / b.width) * FSC.w;
};
let dragging = false;
fsc.addEventListener('pointerdown', (e) => {
  dragging = true;
  fsc.setPointerCapture(e.pointerId);
  setDz(fscValue(xOf(e), C.R));
});
fsc.addEventListener('pointermove', (e) => {
  if (dragging) setDz(fscValue(xOf(e), C.R));
});
for (const n of ['pointerup', 'pointercancel'] as const)
  fsc.addEventListener(n, () => {
    dragging = false;
  });
fsc.addEventListener('keydown', (e) => {
  const step = C.R / 40,
    big = C.R / 4;
  const d: Record<string, number> = {
    ArrowLeft: -step,
    ArrowDown: -step,
    ArrowRight: step,
    ArrowUp: step,
    PageDown: -big,
    PageUp: big,
  };
  if (e.key in d) setDz(dz + d[e.key]);
  else if (e.key === 'Home') setDz(-C.R);
  else if (e.key === 'End') setDz(C.R);
  else return;
  e.preventDefault();
});
focB.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (b) setDz(Number(b.dataset.v));
});

/* ---------- 描画 ---------- */
const svc = $<HTMLCanvasElement>('#sv-c'),
  zmc = $<HTMLCanvasElement>('#zm-c'),
  ov = $<SVGSVGElement>('#sv-ov'),
  mfc = $<HTMLCanvasElement>('#mf-c');

/** マスクの正面（板は濃い灰色、開いた所は明るい灰色、外は透明） */
function drawMask(): void {
  const whole = C.kind === 'image' && !!C.m.whole,
    n = Math.round(132 * Math.min(2, devicePixelRatio || 1)),
    a = rasterize(n, C.sc, C.m),
    ctx = mfc.getContext('2d');
  if (!ctx) return;
  mfc.width = mfc.height = n;
  const im = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -1 + ((i + 0.5) * 2) / n,
        y = 1 - ((j + 0.5) * 2) / n,
        /* 板: 円い口の外側の縁。開口全体として使う画像は正方形のまま */
        plate = whole ? 1 : Math.max(0, Math.min(1, (1.06 - Math.hypot(x, y)) * (n / 2) + 0.5)),
        t = a[j * n + i],
        q = (j * n + i) * 4;
      im.data[q] = 0x2b + (0xd5 - 0x2b) * t;
      im.data[q + 1] = 0x32 + (0xd9 - 0x32) * t;
      im.data[q + 2] = 0x37 + (0xd3 - 0x37) * t;
      im.data[q + 3] = 255 * plate;
    }
  ctx.putImageData(im, 0, 0);
  const D: Record<MaskKind, string> = {
    none: '<b>マスクなし</b>。星像の大きさだけが手がかりで、ピントの手前と奥で同じ形になります。',
    bahtinov:
      '<b>バーティノフマスク</b>（P. Bahtinov、2005）。半円の格子が中央の光条を、四分円 2 つの格子が X 字の光条を作ります。ピントが合うと中央の光条が X の交点を通ります。',
    tri: '<b>トライ・バーティノフマスク</b>（C. Y. Tan、2016）。120° ずつの扇 3 つにバーティノフの模様を置きます。光軸がずれていると 3 組が同時には合いません。',
    carey:
      '<b>キャリー・マスク</b>（2009）。四分円 4 つの斜めの格子が、開きの違う 2 つの X 字の光条を作ります。ピントが合うと 2 つの X が対称に重なります。',
    hartmann:
      '<b>ハルトマンマスク</b>。3 つの穴の像が、ピントが合うと 1 つに重なります。三角形の向きで手前か奥かが分かります。',
    scheiner: '<b>シャイナーの円板</b>（C. Scheiner、1619）。2 つの穴の像が、ピントが合うと 1 つに重なります。',
    jwst: '<b>JWST の主鏡</b>。六角形 18 枚の鏡の縁が 6 本の大きな光条を、副鏡の縦の支柱が横の細い光条を作ります。口径は外接円の径です。',
    image: src
      ? '<b>画像のマスク</b>。白（または黒）の所が光を通します。'
      : '<b>画像のマスク</b>。画像を選ぶか、左の円にドロップしてください。白（または黒）の所が光を通します。',
  };
  html('#mf-d', D[C.kind]);
  mfc.setAttribute('aria-label', `${MASKS.find((x) => x[0] === C.kind)?.[1] ?? ''}の正面`);
}

/** 読み値（幾何光学）。トライは扇ごと、ほかは 1 つ */
const readAt = (z: number) => reading(C.kind, S, C.D, C.f, z).v;

/** 入力だけで決まる表示（目盛り・グラフ・光の通り道・ラベル） */
function drawStatic(): void {
  const c = C;
  txt(
    '#v-mask',
    (MASKS.find((x) => x[0] === c.kind)?.[1] ?? '') + (TH0[c.kind] != null ? ` ${sig(G.get('th'), 3)}°` : ''),
  );
  txt('#v-D', `${sig(c.D, 4)} mm`);
  txt('#v-f', `${sig(c.f, 4)} mm`);
  txt('#v-N', `F/${sig(c.N, 3)}`);
  txt('#v-dz', `${sgn(dz)} µm`);
  txt('#v-see', `${sig(c.cam.see, 2)}″`);
  txt('#dz-v', sgn(dz));
  fsc.innerHTML = fscSvg(c.R, c.cfz, dz);
  fsc.setAttribute('aria-valuemin', String(-c.R));
  fsc.setAttribute('aria-valuemax', String(c.R));
  fsc.setAttribute('aria-valuenow', String(dz));
  fsc.setAttribute('aria-valuetext', `${sgn(dz)} µm`);
  const pre = [-0.75, -0.5, -0.25, -0.125, 0, 0.125, 0.25, 0.5, 0.75].map((k) => Math.round(k * c.R)),
    chips = pre
      .map(
        (v) =>
          `<button type="button" class="chip" data-v="${v}" aria-pressed="${v === dz}">${v ? sgn(v) : '0'}</button>`,
      )
      .join('');
  if (focB.innerHTML !== chips) focB.innerHTML = chips;
  drawGraph();
  drawRay();
}

/** グラフの CH1 の凡例（マスクごと。空ならその凡例を隠す） */
const GP_L1: Record<MaskKind, string> = {
  none: '',
  bahtinov: 'CH1 中央の光条のずれ e（µm）',
  tri: 'CH1 3 組の光条のずれ（µm、実線・破線・点線）',
  carey: 'CH1 2 つの X の間隔（µm）',
  hartmann: 'CH1 穴の像の間隔（µm）',
  scheiner: 'CH1 穴の像の間隔（µm）',
  jwst: '',
  image: '',
};
/* グラフの上の凡例は折り返す。CH1 の文はマスクで変わるので、いちばん高くなる文の高さを取っておく */
reserveHeight(
  $('#gp-lg'),
  Object.values(GP_L1).map(
    (t) =>
      (t ? `<span class="stag"><i class="sw"></i><span>${t}</span></span>` : '') +
      '<span class="stag"><i class="sw c2"></i>CH2 星像の大きさ HFD（マスクなし）</span><span class="stag">X <b>1000 µm/div</b></span>',
  ),
  { html: true },
);
function drawGraph(): void {
  const c = C,
    n = 81,
    zs = Array.from({ length: n }, (_, i) => -c.R + (2 * c.R * i) / (n - 1)),
    vals = zs.map((z) => readAt(z)),
    h0 = ref?.hfd ?? 3 * c.cam.pitch,
    hz = (z: number) => Math.sqrt(h0 * h0 + (Math.abs(z) / (c.N * Math.SQRT2)) ** 2),
    curves: Curve[] = [];
  let y1 = 0;
  const k = vals[0]?.length ?? 0;
  for (let j = 0; j < k; j++) {
    for (const v of vals) y1 = Math.max(y1, Math.abs(v[j]));
    curves.push({ cls: j === 0 ? 't1' : j === 1 ? 't1 t1b' : 't1 t1c', ax: 1, pts: zs.map((z, i) => [z, vals[i][j]]) });
  }
  const hs = zs.map(hz),
    y2 = niceMax(Math.max(...hs) * 1.05);
  curves.unshift({ cls: 't2', ax: 2, pts: zs.map((z, i) => [z, hs[i]]) });
  y1 = niceMax(y1 * 1.05 || 1);
  html('#gp', gpSvg(c.R, c.cfz, y1, y2, curves, dz));
  $('#gp').parentElement?.classList.toggle('one', gv$.value === 'one');
  txt('#gp-t1', GP_L1[c.kind]);
  $('#gp-l1').hidden = !GP_L1[c.kind];
  txt('#gp-x', `Δz ${sig(c.R / 4, 3)} µm/div`);
  const r = readAt(dz);
  txt(
    '#gp-rd',
    `Δz ${sgn(dz)} µm${r.length ? ` · ${r.map((v) => `${sg3(v)} µm`).join(' · ')}` : ''} · HFD ${sig(hz(dz), 3, true)} µm`,
  );
}

/** 横から見た光の通り道: 区画を重心の上下で 2 つに分け、縦の範囲を合わせる */
function drawRay(): void {
  const c = C,
    up: Beam = { cls: 'b1', y0: 1, y1: -1 },
    lo: Beam = { cls: 'b2', y0: 1, y1: -1 };
  /* 区画が 1 つ（マスクなし・JWST・画像）なら開口の全体を 1 つの光束にする */
  const one = S.length === 1;
  for (const s of S) {
    if (s.w <= 0) continue;
    const b = one || s.c[1] >= 0 ? up : lo;
    b.y0 = Math.min(b.y0, s.y0);
    b.y1 = Math.max(b.y1, s.y1);
  }
  const beams = [up, lo].filter((b) => b.y1 > b.y0);
  html('#ray', raySvg(beams, (dz / c.R) * 60));
  const T: Record<MaskKind, [string, string]> = {
    none: ['開口の全体', ''],
    bahtinov: ['上半分（X 字の光条）', '下半分（中央の光条）'],
    tri: ['上の区画', '下の区画'],
    carey: ['上の 2 区画', '下の 2 区画'],
    hartmann: ['上の穴', '下の 2 つの穴'],
    scheiner: ['上の穴', '下の穴'],
    jwst: ['開口の全体', ''],
    image: ['開口の全体', ''],
  };
  const [a, b] = T[c.kind];
  txt('#ray-t1', a);
  txt('#ray-t2', b);
  $('#ray-l2').hidden = !b;
}

/** 映像・重ねる線・計算結果（計算の結果が来るたび） */
function draw(): void {
  const c = C,
    fr = frame;
  const noImg = c.src === 'image' && !c.obj;
  $('#sv-zm').hidden = !!c.obj || noImg;
  /* 画像を選ぶまでは拡大の操作と画素の表示を隠し、ドロップの枠と重ねない */
  $('#sv .sv-z').hidden = noImg;
  $('#sv-lab').hidden = noImg;
  if (!fr || noImg) {
    fc.width = fc.height = 1;
    levels = [];
    view();
    if (noImg) results(null, null, 0);
    return;
  }
  const n = fr.n;
  /* 露出: マスクなしで合焦した 0 等の星像の最も明るい画素を、リニアで 2500 倍飽和させる明るさを ×1 とする。
     画像は、白い所の 1 平方秒角あたりの等級から、カメラの 1 画素に入る明るさにする */
  const pk = ref?.peak || 1e-3,
    lin = st$.value === 'lin',
    bright = c.obj?.kind === 'raster' ? 10 ** (-0.4 * c.sb) * (betaOf(c) / RAD_AS) ** 2 : 10 ** (-0.4 * c.mag),
    gain = c.ex * bright * (lin ? 2500 / pk : 40 / pk);
  let img: Img = fr;
  if (cm$.value === 'mono') {
    const Y = lum(fr);
    img = { ...fr, r: Y, g: Y, b: Y };
  }
  const px = toRgba(img, gain, lin ? 'lin' : 'asinh');
  if (fc.width !== n) fc.width = fc.height = n;
  fc.getContext('2d')?.putImageData(new ImageData(px, n, n), 0, 0);
  levels = [fc];
  ovl.length = 0;
  if (fr.key) {
    /* 光源の像では、光条の解析と中心の拡大を使わない */
    view();
    results(null, null, n);
    return;
  }
  /* 中心の拡大（×4 の範囲を画素のまま） */
  const zn = Math.max(8, Math.round(n / 4 / 2) * 2),
    z0 = (n - zn) / 2,
    zctx = zmc.getContext('2d');
  if (zctx) {
    const sub = {
      n: zn,
      px: fr.px,
      r: new Float64Array(zn * zn),
      g: new Float64Array(zn * zn),
      b: new Float64Array(zn * zn),
    };
    for (let y = 0; y < zn; y++)
      for (let x = 0; x < zn; x++) {
        const i = (y + z0) * n + x + z0,
          o = y * zn + x;
        sub.r[o] = img.r[i];
        sub.g[o] = img.g[i];
        sub.b[o] = img.b[i];
      }
    if (zmc.width !== zn) zmc.width = zmc.height = zn;
    zctx.putImageData(new ImageData(toRgba(sub, gain / 6, lin ? 'lin' : 'asinh'), zn, zn), 0, 0);
  }

  /* 光条の解析（バーティノフ）と、穴の像の位置の予測 */
  const Y = lum(fr),
    th = c.m.th,
    blur = Math.abs(dz) / c.N / c.cam.pitch + (c.cam.see * 4.848e-6 * c.f * 1e3) / c.cam.pitch,
    half = Math.max(3, 0.8 * blur + 2),
    r0 = Math.max(6, (1.6 * half) / Math.sin(th)),
    r1 = n * 0.45;
  let meas: number | null = null;
  const ln = (a: number, q: number, cls: string) => {
    /* 向き a（y は上）、法線の向きの位置 q（画素）の直線を、像の端まで */
    const d = [Math.cos(a), Math.sin(a)],
      nn = [-Math.sin(a), Math.cos(a)],
      L = n,
      p = (t: number) => [n / 2 + nn[0] * q + d[0] * t, n / 2 - (nn[1] * q + d[1] * t)];
    const [x0, y0] = p(-L),
      [x1, y1] = p(L);
    ovl.push({ k: 'l', cls, x0, y0, x1, y1 });
  };
  if (c.kind === 'bahtinov' && r1 > r0 + 4) {
    const fit = fitBahtinov(Y, n, c.m.rot, th, r0, r1, half, 0.5);
    meas = fit.off * c.cam.pitch;
    ln(c.m.rot, fit.mid, 'l1');
    ln(c.m.rot + th, fit.qa, 'l2');
    ln(c.m.rot - th, fit.qb, 'l2');
    ovl.push({
      k: 'c',
      cls: 'cx',
      x0: n / 2 - Math.sin(c.m.rot) * fit.cross,
      y0: n / 2 - Math.cos(c.m.rot) * fit.cross,
    });
  } else if (c.kind === 'hartmann' || c.kind === 'scheiner' || c.kind === 'tri' || c.kind === 'carey') {
    /* 幾何光学の予測: 区画の像の位置（穴）と光条（格子） */
    for (const s of S) {
      const [x, y] = spot(s, c.D, c.f, dz).map((v) => v / c.cam.pitch);
      if (s.dir) {
        const a = Math.atan2(s.dir[1], s.dir[0]),
          q = -Math.sin(a) * x + Math.cos(a) * y;
        ln(a, q, 'l2');
      } else ovl.push({ k: 'c', cls: 'sp', x0: n / 2 + x, y0: n / 2 - y });
    }
  }
  view();
  results(meas, Y, n);
}

/** 重ねる線と点（カメラの像の画素の座標） */
const ovl: { k: 'l' | 'c'; cls: string; x0: number; y0: number; x1?: number; y1?: number }[] = [];
/** トーンを掛けたカメラの像（拡大・移動ではこれを描き直すだけ） */
const fc = document.createElement('canvas');
/** fc を 1/2 ずつ縮めた像（引いて 1 画素が表示の 1 画素より小さくなったときに使う。初めの要素が fc） */
let levels: HTMLCanvasElement[] = [];
function level(i: number): HTMLCanvasElement {
  while (levels.length <= i) {
    const a = levels[levels.length - 1],
      b = document.createElement('canvas');
    b.width = Math.max(1, Math.ceil(a.width / 2));
    b.height = Math.max(1, Math.ceil(a.height / 2));
    const ctx = b.getContext('2d');
    if (ctx) {
      /* ちょうど 1/2 の双一次は、2×2 の画素の平均になる */
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(a, 0, 0, a.width / 2, a.height / 2);
    }
    levels.push(b);
  }
  return levels[i];
}

/** 今の拡大と中心で、映像と重ねる線を描く。像の外は黒 */
function view(): void {
  const fr = frame,
    ctx = svc.getContext('2d');
  if (!ctx) return;
  const W = Math.max(1, Math.round(svc.clientWidth * Math.min(2, devicePixelRatio || 1)));
  zoom = Math.max(ZMIN, Math.min(ZMAX, zoom));
  const sw = BASE / zoom,
    lim = Math.max(0, extent() - sw / 2);
  /* 中心を、像の外へ出ない範囲に戻す */
  vx = Math.max(-lim, Math.min(lim, vx));
  vy = Math.max(-lim, Math.min(lim, vy));
  if (svc.width !== W) svc.width = svc.height = W;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, W);
  const wx = vx - sw / 2,
    wy = vy - sw / 2,
    k = W / sw;
  if (fr && levels.length) {
    const e = fr.n * fr.s,
      x0 = Math.max(wx, fr.ox),
      y0 = Math.max(wy, fr.oy),
      x1 = Math.min(wx + sw, fr.ox + e),
      y1 = Math.min(wy + sw, fr.oy + e);
    if (x1 > x0 && y1 > y0) {
      /* 像の 1 画素が表示の 1 画素より小さいときは、縮めた像から引く */
      let lv = 0;
      while (fr.s * k * 2 ** lv < 1 && lv < 10) lv++;
      const im = level(lv),
        q = fr.s * 2 ** lv;
      /* カメラの 1 画素が 3 表示画素より大きいときは、画素のまま（ぼかさない） */
      ctx.imageSmoothingEnabled = q * k < 3;
      ctx.drawImage(
        im,
        (x0 - fr.ox) / q,
        (y0 - fr.oy) / q,
        (x1 - x0) / q,
        (y1 - y0) / q,
        (x0 - wx) * k,
        (y0 - wy) * k,
        (x1 - x0) * k,
        (y1 - y0) * k,
      );
    }
  }
  const ox = fr ? fr.ox : -sw / 2,
    oy = fr ? fr.oy : -sw / 2;
  ov.setAttribute('viewBox', `${(wx - ox).toFixed(3)} ${(wy - oy).toFixed(3)} ${sw.toFixed(3)} ${sw.toFixed(3)}`);
  const r = (4 * sw) / Math.max(1, svc.clientWidth);
  ov.innerHTML =
    ov$.value === 'on' && fr && !fr.key
      ? ovl
          .map((o) =>
            o.k === 'l'
              ? `<path class="ln ${o.cls}" d="M${o.x0.toFixed(2)} ${o.y0.toFixed(2)}L${o.x1?.toFixed(2)} ${o.y1?.toFixed(2)}"/>`
              : `<circle class="${o.cls}" cx="${o.x0.toFixed(2)}" cy="${o.y0.toFixed(2)}" r="${r.toFixed(3)}"/>`,
          )
          .join('')
      : '';
  const arcs = (betaOf(C) / RAD_AS).toPrecision(3),
    vis = Math.round(sw);
  txt('#sv-lab', `${vis} × ${vis} px（${sig(C.cam.pitch, 3)} µm）· ${arcs}″/px`);
  txt('#zm-v', `×${zoomText(zoom)}`);
  $<HTMLButtonElement>('#zm-in').disabled = zoom >= ZMAX - 1e-9;
  $<HTMLButtonElement>('#zm-out').disabled = zoom <= ZMIN + 1e-9;
  svc.classList.toggle('pan', lim > 0.5);
  svc.setAttribute('aria-label', `カメラの映像。ピントの位置 ${sgn(dz)} µm、拡大 ×${zoomText(zoom)}`);
}
/** 拡大の倍率の表示（1 未満は有効数字 2 桁） */
const zoomText = (z: number) => (z < 1 ? sig(z, 2) : z < 10 ? z.toFixed(1) : z.toFixed(0));

/**
 * 拡大を z にする。(fx, fy) は映像の上の割合（0〜1）で、その点が動かないように中心をずらす。
 * 見える範囲が変わったら、カメラの像を作り直す（×1 の点像の範囲より引くと、点像も広い範囲で作り直す）
 */
function setZoom(z: number, fx = 0.5, fy = 0.5): void {
  const z1 = Math.max(ZMIN, Math.min(ZMAX, z)),
    sw0 = BASE / zoom,
    sw1 = BASE / z1,
    n0 = nfftOf(C);
  /* 指した点の、光軸からの位置（画素）を保つ */
  const px = vx + (fx - 0.5) * sw0,
    py = vy + (fy - 0.5) * sw0;
  vx = px - (fx - 0.5) * sw1;
  vy = py - (fy - 0.5) * sw1;
  zoom = z1;
  if (Math.abs(zoom - 1) < 1e-9) forget('zoom');
  else store('zoom', zoom);
  view();
  if (nfftOf(C) !== n0) {
    /* 点像の範囲だけが変わるので、少ない帯の計算を飛ばす */
    version++;
    full = true;
    void run();
  } else refresh();
}

/* 拡大・縮小と移動: ホイール（指した点を中心に）、ボタン、ドラッグ、キー、ダブルクリック */
{
  const at = (e: { clientX: number; clientY: number }) => {
    const b = svc.getBoundingClientRect();
    return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height] as const;
  };
  svc.addEventListener(
    'wheel',
    (e) => {
      if (!frame) return;
      e.preventDefault();
      /* 行単位のスクロールは 1 行を 40 画素とみなす。1 刻み（100 画素）で約 1.2 倍 */
      const d = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY,
        [fx, fy] = at(e);
      setZoom(zoom * Math.exp(-d * 0.0018), fx, fy);
    },
    { passive: false },
  );
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  svc.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !frame) return;
    drag = { x: e.clientX, y: e.clientY, vx, vy };
    svc.setPointerCapture(e.pointerId);
  });
  svc.addEventListener('pointermove', (e) => {
    if (!drag || !frame) return;
    const k = BASE / zoom / svc.getBoundingClientRect().width;
    vx = drag.vx - (e.clientX - drag.x) * k;
    vy = drag.vy - (e.clientY - drag.y) * k;
    view();
    refresh();
  });
  for (const n of ['pointerup', 'pointercancel'] as const)
    svc.addEventListener(n, () => {
      drag = null;
    });
  svc.addEventListener('dblclick', () => {
    vx = vy = 0;
    setZoom(1);
  });
  svc.addEventListener('keydown', (e) => {
    const step = BASE / zoom / 10;
    if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
    else if (e.key === '-' || e.key === '_') setZoom(zoom / 1.25);
    else if (e.key === '0') {
      vx = vy = 0;
      setZoom(1);
    } else if (e.key.startsWith('Arrow')) {
      if (e.key === 'ArrowLeft') vx -= step;
      else if (e.key === 'ArrowRight') vx += step;
      else if (e.key === 'ArrowUp') vy -= step;
      else vy += step;
      view();
      refresh();
    } else return;
    e.preventDefault();
  });
  $('#zm-in').addEventListener('click', () => setZoom(zoom * 1.5));
  $('#zm-out').addEventListener('click', () => setZoom(zoom / 1.5));
  $('#zm-v').addEventListener('click', () => {
    vx = vy = 0;
    setZoom(1);
  });
  if (typeof ResizeObserver !== 'undefined')
    new ResizeObserver(() => {
      view();
      refresh();
    }).observe(svc);
}

function results(meas: number | null, Y: Float64Array | null, n: number): void {
  const c = C,
    pitch = c.cam.pitch,
    r = readAt(dz),
    /* 1 µm のピントのずれあたりの読み値の変化（収差による一定のずれを除く） */
    g = (readAt(100)[0] ?? 0) / 100 - (readAt(0)[0] ?? 0) / 100,
    h0 = ref?.hfd ?? 0,
    hfdNow = c.kind === 'none' && Y ? hfd(Y, n) * pitch : Math.sqrt(h0 * h0 + (Math.abs(dz) / (c.N * Math.SQRT2)) ** 2);
  let mt = '',
    mv = '',
    ms = '',
    et = '',
    ev = '',
    es = '',
    miniE = '',
    miniX = '';
  const where = (z: number) =>
    Math.abs(z) <= c.cfz
      ? '臨界焦点範囲の中。ピントは合っています。'
      : z > 0
        ? `臨界焦点範囲の外。センサーが焦点より奥にあります。${Math.round(Math.abs(z))} µm 手前へ送ってください。`
        : `臨界焦点範囲の外。センサーが焦点より手前にあります。${Math.round(Math.abs(z))} µm 奥へ送ってください。`;
  switch (c.kind) {
    case 'bahtinov': {
      const est = meas != null && g ? meas / g : null;
      mt = 'ピントのずれ（光条から推定）';
      mv = est == null ? DASH : rv(sgn(est), 'µm');
      ms =
        est != null
          ? where(est)
          : c.obj || c.src === 'image'
            ? '光源が星のときだけ測ります'
            : '光条が像の外へ出ていて測れません';
      et = '中央の光条のずれ e';
      ev = meas == null ? DASH : rv(sg3(meas / pitch), 'px');
      es = meas == null ? '' : `${sg3(meas)} µm（幾何光学の予測 ${sg3(r[0])} µm）`;
      miniE = meas == null ? DASH : `${sg3(meas / pitch)} px`;
      miniX = est == null ? DASH : `${sgn(est)} µm`;
      break;
    }
    case 'tri':
      mt = '3 組の光条のずれ（幾何光学）';
      mv = rv(r.map((v) => sg3(v)).join(' / '), 'µm');
      ms = `3 組の差 ${(Math.max(...r) - Math.min(...r)).toFixed(2)} µm。光軸が合っていればそろいます。`;
      et = '光条のずれ（扇 1）';
      ev = rv(sg3(r[0] / pitch), 'px');
      es = `${sg3(r[0])} µm`;
      miniE = `${sg3(r[0] / pitch)} px`;
      break;
    case 'carey':
      mt = '2 つの X の間隔（幾何光学）';
      mv = rv(sg3(r[0]), 'µm');
      ms = '2 つの X が重なるとピントが合います。';
      et = '2 つの X の間隔';
      ev = rv(sg3(r[0] / pitch), 'px');
      es = `${sg3(r[0])} µm`;
      miniE = `${sg3(r[0] / pitch)} px`;
      break;
    case 'hartmann':
    case 'scheiner':
      mt = '穴の像の間隔（幾何光学）';
      mv = rv(sig(r[0], 3, true), 'µm');
      ms = c.kind === 'scheiner' ? '2 つの像の並びは手前と奥で同じ' : '三角形の向きは手前と奥で逆';
      et = '穴の像の間隔';
      ev = rv(sig(r[0] / pitch, 3, true), 'px');
      es = `${sig(r[0], 3, true)} µm`;
      miniE = `${sig(r[0] / pitch, 3, true)} px`;
      break;
    default:
      mt = '星像の大きさ HFD';
      mv = rv(sig(hfdNow, 3, true), 'µm');
      ms = 'マスクなしではピントの手前と奥を区別できません。';
      et = '星像の大きさ HFD';
      ev = rv(sig(hfdNow / pitch, 3, true), 'px');
      es = `${sig(hfdNow, 3, true)} µm`;
  }
  txt('#o-mt', mt);
  html('#o-mv', mv);
  txt('#o-ms', ms);
  txt('#o-et', et);
  html('#o-ev', ev);
  txt('#o-es', es);
  html('#o-cfz', rv(`±${sig(c.cfz, 3, true)}`, 'µm'));
  txt('#o-st', '感度');
  if (g) {
    html('#o-sv', rv(sig(Math.abs(pitch / g), 3, true), 'µm/px'));
    txt('#o-ss', '読み値 1 画素あたりのピントのずれ');
  } else {
    html('#o-sv', DASH);
    txt('#o-ss', 'マスクなしでは読み値がありません。');
  }
  html('#o-hfd', rv(sig(hfdNow, 3, true), 'µm'));
  const grating = c.kind === 'bahtinov' || c.kind === 'tri' || c.kind === 'carey',
    B = G.get('bf');
  if (grating) {
    html('#o-ord', rv(sig(LAMBDA * B, 3, true), 'µm'));
    txt('#o-ords', `λ × バーティノフ係数（${sig((LAMBDA * B) / pitch, 3)} px）`);
    html('#o-per', rv(sig(c.f / B, 3, true), 'mm'));
    txt('#o-pers', `f ÷ ${sig(B, 3)}（口径に ${Math.round(c.D / (c.f / B))} 本）`);
  } else {
    html('#o-ord', DASH);
    txt('#o-ords', '格子がありません。');
    html('#o-per', DASH);
    txt('#o-pers', '格子がありません。');
  }
  txt('#mZ', `${sgn(dz)} µm`);
  txt('#mE', miniE || DASH);
  txt('#mX', miniX || DASH);
  $('#mXl').hidden = c.kind !== 'bahtinov';
  $('#mEl').hidden = !r.length;
}

ready = true;
restoreImage();
restoreSrc();
schedule();
queueMicrotask(() => {
  boot = false;
});

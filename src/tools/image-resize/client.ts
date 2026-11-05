/**
 * 画像の拡大縮小のページの入口。単独は結果の画像と拡大鏡、比較は同じ範囲を手法ごとに並べ、一覧は手法 × 画像の表にする。
 * 画面の 1 画素に出力の 1 画素が対応するよう、キャンバスは端末の画素の大きさで描く
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { mountMech } from './mech';
import {
  type Img,
  METHODS,
  type Method,
  methodOf,
  metric,
  mkImg,
  outSize,
  type Px,
  resample,
  type Win,
} from './resample';
import { genChart, genFloor, genPixel, genScene, genText, SAMPLES } from './samples';

initToolPage();

const BASE = import.meta.env.BASE_URL;
const MIN_S = 1 / 8;
const MAX_S = 8;
/** 拡大鏡の 1 辺の出力の画素数 */
const LENS = 30;
/** ファイルの長辺の上限 */
const FILE_MAX = 1024;
/** 比較に並べる上限 */
const CMP_MAX = 9;
/** 倍率の再生の速さ [オクターブ/秒] */
const SWEEP = 0.55;
const SNAP = 0.09;

type Mode = 'one' | 'cmp' | 'list';

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const dpr = (): number => devicePixelRatio || 1;
const cssv = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** 分数は 1/n、それ以外は末尾の 0 を落とす */
const scaleText = (s: number): string =>
  s < 1 && Math.abs(1 / s - Math.round(1 / s)) < 1e-3 ? `1/${Math.round(1 / s)}` : `${+s.toFixed(s < 1 ? 3 : 2)}`;
const psnrText = (v: number | null): string => (v === null ? '–' : v === Infinity ? '∞' : v.toFixed(1));

/* ---------- 画像 ---------- */
interface Entry {
  id: string;
  n: string;
  img?: Img;
  gen?: () => Img;
}
const images: Entry[] = SAMPLES.map((s) => ({ id: s.id, n: s.n }));
const GEN: Record<string, () => Img> = {
  scene: genScene,
  text: genText,
  pixel: genPixel,
  chart: genChart,
  floor: genFloor,
};
for (const e of images) e.gen = GEN[e.id];
const entry = (id: string): Entry => images.find((e) => e.id === id) ?? images[0];
function imgOf(id: string): Img {
  const e = entry(id);
  if (!e.img && e.gen) e.img = e.gen();
  /* 月面を読み終える前は風景で代える */
  return e.img ?? imgOf('scene');
}
/** 初めの中心と拡大鏡の位置（違いの出る所） */
const CENTER: Record<string, readonly [number, number, number, number]> = {
  scene: [610, 300, 590, 286],
  moon: [128, 96, 128, 96],
  text: [150, 90, 120, 48],
  pixel: [28, 30, 14, 24],
  chart: [240, 128, 300, 128],
  floor: [384, 250, 384, 250],
};
function srcCanvas(id: string): HTMLCanvasElement {
  const e = entry(id) as Entry & { cv?: HTMLCanvasElement },
    img = imgOf(id);
  /* 月面を読み終える前は風景の絵を覚えない */
  if (!e.img) return srcCanvas('scene');
  if (e.cv) return e.cv;
  const k = document.createElement('canvas');
  k.width = img.w;
  k.height = img.h;
  (k.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(img.d, img.w, img.h), 0, 0);
  e.cv = k;
  return k;
}

/* ---------- 状態 ---------- */
const savedS = stored('rz-s'),
  savedM = stored('rz-m'),
  savedC = stored('rz-c'),
  savedI = stored('rz-i');
const S = {
  mode: 'one' as Mode,
  img: typeof savedI === 'string' && SAMPLES.some((x) => x.id === savedI) ? savedI : 'scene',
  m: typeof savedM === 'string' && METHODS.some((x) => x.id === savedM) ? savedM : 'lanczos3',
  s: typeof savedS === 'number' && savedS >= MIN_S && savedS <= MAX_S ? savedS : 4,
  zoom: 1,
  aa: true,
  lin: false,
  cmp:
    Array.isArray(savedC) && savedC.length
      ? (savedC as string[]).filter((id) => METHODS.some((x) => x.id === id)).slice(0, CMP_MAX)
      : ['nearest', 'box', 'bilinear', 'bspline', 'mitchell', 'catrom', 'lanczos2', 'lanczos3', 'scale2x'],
  cx: 610,
  cy: 300,
  lx: 590,
  ly: 286,
  playing: false,
};
function resetCenter(): void {
  const img = imgOf(S.img),
    c = CENTER[S.img] ?? [img.w / 2, img.h / 2, img.w / 2, img.h / 2];
  [S.cx, S.cy, S.lx, S.ly] = c;
}
resetCenter();
const opt = (): { aa: boolean; lin: boolean } => ({ aa: S.aa, lin: S.lin });
/** 月面を読み終える前の代わりの画像と PSNR を混ぜないよう、大きさも入れる */
const metricKey = (id: string, img: Img): string => `${id}:${img.w}`;

/* ---------- 描画の部品 ---------- */
function sizeCv(cv: HTMLCanvasElement): [number, number] {
  const r = cv.getBoundingClientRect(),
    d = dpr(),
    w = Math.max(1, Math.round(r.width * d)),
    h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  return [w, h];
}
const ctx = (cv: HTMLCanvasElement): CanvasRenderingContext2D => cv.getContext('2d') as CanvasRenderingContext2D;
const tmp = document.createElement('canvas'),
  tmpC = tmp.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
/** 大きいまま使い回すと描くたびの転送が重いので、必要な大きさだけ用意する */
function blit(c: CanvasRenderingContext2D, rgba: Px, w: number, h: number, dx: number, dy: number, z: number): void {
  if (!w || !h) return;
  if (tmp.width !== w || tmp.height !== h) {
    tmp.width = w;
    tmp.height = h;
  }
  tmpC.putImageData(new ImageData(rgba, w, h), 0, 0);
  c.imageSmoothingEnabled = false;
  c.drawImage(tmp, 0, 0, w, h, dx, dy, w * z, h * z);
}
interface View {
  win: Win;
  ow: number;
  oh: number;
  dx: number;
  dy: number;
  z: number;
}
/** 中心 (cx, cy)・倍率 s で画面 (cw, ch) に出す窓 */
function viewOf(img: Img, s: number, cx: number, cy: number, cw: number, ch: number, z: number): View {
  const [ow, oh] = outSize(img, s),
    vw = Math.ceil(cw / z),
    vh = Math.ceil(ch / z),
    win = { x: 0, y: 0, w: Math.min(ow, vw), h: Math.min(oh, vh) };
  if (ow > vw) win.x = clamp(Math.round(cx * s - vw / 2), 0, ow - vw);
  if (oh > vh) win.y = clamp(Math.round(cy * s - vh / 2), 0, oh - vh);
  return {
    win,
    ow,
    oh,
    dx: ow > vw ? 0 : Math.round((cw - ow * z) / 2),
    dy: oh > vh ? 0 : Math.round((ch - oh * z) / 2),
    z,
  };
}
function drawView(cv: HTMLCanvasElement, img: Img, s: number, m: Method, cx: number, cy: number, z: number): View {
  const [W, H] = sizeCv(cv),
    c = ctx(cv),
    v = viewOf(img, s, cx, cy, W, H, z),
    out = resample(img, s, m, v.win, opt());
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  blit(c, out, v.win.w, v.win.h, v.dx, v.dy, v.z);
  return v;
}
/** どの色の画像でも見える黒と白の枠 */
function dualRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  c.lineWidth = 3;
  c.strokeStyle = '#000';
  c.strokeRect(x, y, w, h);
  c.lineWidth = 1;
  c.strokeStyle = '#fff';
  c.strokeRect(x, y, w, h);
}

/* ---------- 少しずつ描く（マスの多い表のため） ---------- */
let jobs: (() => void)[] = [],
  jobRun = false;
function runJobs(): void {
  const t0 = performance.now();
  while (jobs.length && performance.now() - t0 < 14) (jobs.shift() as () => void)();
  if (jobs.length) setTimeout(runJobs, 0);
  else jobRun = false;
}
function setJobs(j: (() => void)[]): void {
  jobs = j;
  if (!jobRun && j.length) {
    jobRun = true;
    setTimeout(runJobs, 0);
  }
}

/* ---------- 単独 ---------- */
const root = $('#rz'),
  mainCv = $<HTMLCanvasElement>('#rz-cv'),
  lensCv = $<HTMLCanvasElement>('#rz-lens'),
  ovCv = $<HTMLCanvasElement>('#rz-ov'),
  kCv = $<HTMLCanvasElement>('#rz-k');
let mainView: View | null = null;

function drawOne(): void {
  const img = imgOf(S.img),
    m = methodOf(S.m),
    v = drawView(mainCv, img, S.s, m, S.cx, S.cy, S.zoom);
  mainView = v;
  dualRect(
    ctx(mainCv),
    Math.round(v.dx + (S.lx * S.s - LENS / 2 - v.win.x) * v.z) + 0.5,
    Math.round(v.dy + (S.ly * S.s - LENS / 2 - v.win.y) * v.z) + 0.5,
    LENS * v.z,
    LENS * v.z,
  );
  /* 拡大鏡 */
  const [lw, lh] = sizeCv(lensCv),
    lc = ctx(lensCv),
    win = {
      x: clamp(Math.round(S.lx * S.s - LENS / 2), 0, Math.max(0, v.ow - LENS)),
      y: clamp(Math.round(S.ly * S.s - LENS / 2), 0, Math.max(0, v.oh - LENS)),
      w: Math.min(LENS, v.ow),
      h: Math.min(LENS, v.oh),
    };
  lc.fillStyle = '#000';
  lc.fillRect(0, 0, lw, lh);
  blit(lc, resample(img, S.s, m, win, opt()), win.w, win.h, 0, 0, lw / LENS);
  /* 元の画像と表示の範囲 */
  const [ow, oh] = sizeCv(ovCv),
    oc = ctx(ovCv),
    k = Math.min(ow / img.w, oh / img.h),
    ox = (ow - img.w * k) / 2,
    oy = (oh - img.h * k) / 2;
  oc.fillStyle = '#000';
  oc.fillRect(0, 0, ow, oh);
  oc.imageSmoothingEnabled = S.img !== 'pixel';
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(srcCanvas(S.img), ox, oy, img.w * k, img.h * k);
  const [W, H] = [mainCv.width, mainCv.height],
    sw = Math.min(img.w, W / v.z / S.s),
    sh = Math.min(img.h, H / v.z / S.s);
  dualRect(
    oc,
    Math.round(ox + (v.win.x / S.s) * k) + 0.5,
    Math.round(oy + (v.win.y / S.s) * k) + 0.5,
    Math.max(4, sw * k),
    Math.max(4, sh * k),
  );
  $('#rz-tag').textContent = `${m.n}　${scaleText(S.s)} 倍`;
}

function drawKernel(): void {
  const m = methodOf(S.m),
    [W, H] = sizeCv(kCv),
    d = dpr(),
    w = W / d,
    h = H / d,
    c = ctx(kCv),
    fs = S.aa && S.s < 1 && m.id !== 'nearest' ? 1 / S.s : 1,
    range = Math.min(16, Math.max(3.5, 3.5 * Math.max(1, (S.aa && S.s < 1 ? 1 / S.s : 1) * 0.6))),
    x0 = 8,
    x1 = w - 8,
    y1 = 24,
    y0 = h - 28,
    X = (x: number): number => (x0 + x1) / 2 + (x / range) * ((x1 - x0) / 2),
    top = m.pix ? 1 : m.k(0) / fs,
    Y = (v: number): number => y0 - (v / Math.max(0.2, top)) * (y0 - y1);
  c.setTransform(d, 0, 0, d, 0, 0);
  c.clearRect(0, 0, w, h);
  c.font = '500 13px "Fira Mono",ui-monospace,Consolas,monospace';
  c.strokeStyle = cssv('--line-2');
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0, Y(0) + 0.5);
  c.lineTo(x1, Y(0) + 0.5);
  c.stroke();
  c.fillStyle = cssv('--ink-3');
  c.textAlign = 'center';
  const stepT = range > 8 ? 4 : range > 4.5 ? 2 : 1;
  for (let i = -Math.floor(range / stepT) * stepT; i <= range; i += stepT) {
    c.fillRect(X(i) - 0.5, Y(0), 1, 4);
    c.fillText(String(i), X(i), h - 12);
  }
  c.textAlign = 'right';
  c.fillText('距離 [元の画素]', x1, 15);
  c.textAlign = 'left';
  if (!m.pix) {
    const R = m.r * fs,
      n = 280;
    c.strokeStyle = cssv('--ch1');
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = -range + (2 * range * i) / n,
        v = Math.abs(x) <= R ? m.k(x / fs) / fs : 0;
      if (i) c.lineTo(X(x), Y(v));
      else c.moveTo(X(x), Y(v));
    }
    c.stroke();
  }
  c.fillStyle = cssv('--ch1');
  c.fillText(m.pix ? `${m.n}（カーネルなし）` : m.n, x0, 15);
}

/* ---------- 比較 ---------- */
const cmpHost = $('#rz-cmp');
let cmpKey = '';
function drawCmp(): void {
  const img = imgOf(S.img),
    list = S.cmp.map(methodOf);
  if (cmpKey !== S.cmp.join()) {
    cmpKey = S.cmp.join();
    cmpHost.replaceChildren(
      ...list.map((m) => {
        const el = document.createElement('div'),
          head = document.createElement('div'),
          cv = document.createElement('canvas');
        el.className = 'rz-cell';
        el.dataset.m = m.id;
        head.className = 'rz-cl';
        head.innerHTML = '<span class="r"></span><b></b><span class="v"></span>';
        (head.querySelector('b') as HTMLElement).textContent = m.n;
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', `${m.n}の結果`);
        el.append(head, cv);
        bindView(cv);
        return el;
      }),
    );
  }
  const ps = list.map((m) => (S.playing ? null : metric(metricKey(S.img, img), img, S.s, m, opt()))),
    order = ps.filter((x): x is number => x !== null).sort((a, b) => b - a);
  list.forEach((m, i) => {
    const el = cmpHost.querySelector(`[data-m="${m.id}"]`) as HTMLElement,
      rank = ps[i] === null ? 0 : order.indexOf(ps[i] as number) + 1,
      r = el.querySelector('.r') as HTMLElement;
    drawView(el.querySelector('canvas') as HTMLCanvasElement, img, S.s, m, S.cx, S.cy, S.zoom);
    r.textContent = rank ? String(rank) : '';
    r.classList.toggle('top', rank === 1);
    const pv = el.querySelector('.v') as HTMLElement;
    pv.textContent = ps[i] === null ? '' : `${psnrText(ps[i])} dB`;
    pv.title = '正解との PSNR。拡大は縮めて戻した画像と元の画像、縮小は Lanczos8 の結果との差';
  });
}

/* ---------- 一覧 ---------- */
const listT = $<HTMLTableElement>('#rz-t');
let listKey = '';
function drawList(): void {
  const shown = images.filter((e) => e.img || e.gen),
    key = shown.map((e) => e.id).join();
  if (key !== listKey) {
    listKey = key;
    const cols = shown
        .map(
          (i) =>
            `<th scope="col"><button type="button" data-col="${i.id}" title="この画像を比較">${esc(i.n)}</button></th>`,
        )
        .join(''),
      rows = METHODS.map(
        (m) =>
          `<tr><th scope="row"><button type="button" data-row="${m.id}" title="この手法を単独で表示">${m.n}</button></th>${shown.map((i) => `<td><button type="button" class="rz-c" data-m="${m.id}" data-i="${i.id}" aria-label="${m.n}と${esc(i.n)}"><canvas></canvas><i></i></button></td>`).join('')}</tr>`,
      ).join('');
    listT.innerHTML = `<thead><tr><th></th>${cols}</tr></thead><tbody>${rows}</tbody>`;
  }
  const j: (() => void)[] = [],
    best: Record<string, number> = {},
    o = opt();
  for (const i of shown) {
    const img = imgOf(i.id);
    j.push(() => {
      best[i.id] = Math.max(...METHODS.map((m) => metric(metricKey(i.id, img), img, S.s, m, o) ?? -1));
    });
    for (const m of METHODS)
      j.push(() => {
        const el = listT.querySelector(`[data-m="${m.id}"][data-i="${i.id}"]`) as HTMLElement,
          cv = el.querySelector('canvas') as HTMLCanvasElement,
          [W, H] = sizeCv(cv),
          [ow, oh] = outSize(img, S.s),
          /* 小さい画像はマスに収まる整数倍で見せる */
          z = Math.max(1, Math.floor(Math.min(W / ow, H / oh))),
          c = CENTER[i.id] ?? [img.w / 2, img.h / 2];
        drawView(cv, img, S.s, m, c[0], c[1], z);
        const p = metric(metricKey(i.id, img), img, S.s, m, o),
          lb = el.querySelector('i') as HTMLElement;
        lb.textContent = psnrText(p);
        lb.classList.toggle('top', p !== null && p >= best[i.id] - 1e-6);
      });
  }
  setJobs(j);
}

/* ---------- 全体の描画 ---------- */
let raf = 0;
function render(): void {
  raf = 0;
  barRefresh();
  if (S.mode === 'one') {
    drawOne();
    drawKernel();
  } else if (S.mode === 'cmp') drawCmp();
  else drawList();
  $('#rz-mx').textContent = S.mode === 'cmp' ? `${S.cmp.length} / ${CMP_MAX}` : '';
}
function schedule(): void {
  if (!raf) raf = requestAnimationFrame(render);
}

/* ---------- 画像の操作（移動・倍率） ---------- */
function setScale(s: number): void {
  S.s = clamp(s, MIN_S, MAX_S);
  if (!S.playing) store('rz-s', S.s);
  schedule();
}
function bindView(
  cv: HTMLCanvasElement,
  hooks: { move?: (e: PointerEvent) => void; tap?: (e: PointerEvent) => void } = {},
): void {
  const pts = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; cx: number; cy: number } | null = null,
    pinch: { d: number; s: number } | null = null,
    moved = false;
  const dist = (): number => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  cv.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cv.setPointerCapture(e.pointerId);
    if (pts.size === 2) {
      pinch = { d: dist(), s: S.s };
      start = null;
    } else {
      start = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy };
      moved = false;
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      setScale(pinch.s * (dist() / Math.max(1, pinch.d)));
      return;
    }
    if (!start) {
      if (!pts.size) hooks.move?.(e);
      return;
    }
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3) moved = true;
    if (!moved) return;
    const img = imgOf(S.img),
      k = dpr() / (S.s * S.zoom);
    S.cx = clamp(start.cx - (e.clientX - start.x) * k, 0, img.w);
    S.cy = clamp(start.cy - (e.clientY - start.y) * k, 0, img.h);
    cv.classList.add('drag');
    schedule();
  });
  const up = (e: PointerEvent): void => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (start && !moved && e.type === 'pointerup') hooks.tap?.(e);
    if (!pts.size) start = null;
    cv.classList.remove('drag');
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (bar.playing) barStop();
      setScale(2 ** (Math.log2(S.s) - Math.sign(e.deltaY) * 0.25));
    },
    { passive: false },
  );
}
function lensAt(e: PointerEvent): void {
  if (!mainView) return;
  const r = mainCv.getBoundingClientRect(),
    d = dpr(),
    v = mainView,
    img = imgOf(S.img);
  S.lx = clamp(((e.clientX - r.left) * d - v.dx) / v.z / S.s + v.win.x / S.s, 0, img.w);
  S.ly = clamp(((e.clientY - r.top) * d - v.dy) / v.z / S.s + v.win.y / S.s, 0, img.h);
  schedule();
}
bindView(mainCv, { move: lensAt, tap: lensAt });
mainCv.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  const img = imgOf(S.img),
    st = 40 / (S.s * S.zoom);
  S.cx = clamp(S.cx + d[0] * st, 0, img.w);
  S.cy = clamp(S.cy + d[1] * st, 0, img.h);
  schedule();
});
ovCv.addEventListener('pointerdown', (e) => {
  const r = ovCv.getBoundingClientRect(),
    img = imgOf(S.img),
    k = Math.min(r.width / img.w, r.height / img.h);
  S.cx = S.lx = clamp((e.clientX - r.left - (r.width - img.w * k) / 2) / k, 0, img.w);
  S.cy = S.ly = clamp((e.clientY - r.top - (r.height - img.h * k) / 2) / k, 0, img.h);
  schedule();
});

/* ---------- 倍率のバー ---------- */
const trk = $('#tp-trk'),
  pp = $<HTMLButtonElement>('#tp-pp');
const bar = { playing: false, dir: 1, last: 0, raf: 0 };
function barRefresh(): void {
  const p = ((Math.log2(S.s) + 3) / 6) * 100,
    img = imgOf(S.img),
    [ow, oh] = outSize(img, S.s);
  $('#tp-fill').style.width = `${p}%`;
  $('#tp-th').style.left = `${p}%`;
  trk.setAttribute('aria-valuenow', S.s.toFixed(3));
  trk.setAttribute('aria-valuetext', `${scaleText(S.s)} 倍`);
  $('#rz-size').textContent = `${img.w} × ${img.h} → ${ow} × ${oh} px`;
  $('#rz-sv').textContent = `${scaleText(S.s)} 倍`;
  for (const b of $$('#rz-tk button')) b.classList.toggle('on', Math.abs(Number(b.dataset.t) - S.s) < 1e-3);
}
function barStop(): void {
  bar.playing = false;
  S.playing = false;
  pp.classList.remove('on');
  pp.title = '倍率を再生';
  pp.setAttribute('aria-label', '倍率を再生');
  cancelAnimationFrame(bar.raf);
  store('rz-s', S.s);
  schedule();
}
function barStep(ms: number): void {
  if (!bar.playing) return;
  const dt = Math.min(0.1, (ms - bar.last) / 1000);
  bar.last = ms;
  let u = Math.log2(S.s) + bar.dir * dt * SWEEP;
  if (u >= 3) {
    u = 3;
    bar.dir = -1;
  }
  if (u <= -3) {
    u = -3;
    bar.dir = 1;
  }
  S.s = 2 ** u;
  schedule();
  bar.raf = requestAnimationFrame(barStep);
}
pp.addEventListener('click', () => {
  if (bar.playing) {
    barStop();
    return;
  }
  bar.playing = true;
  S.playing = true;
  pp.classList.add('on');
  pp.title = '一時停止';
  pp.setAttribute('aria-label', '一時停止');
  bar.last = performance.now();
  if (S.s >= MAX_S) bar.dir = -1;
  if (S.s <= MIN_S) bar.dir = 1;
  bar.raf = requestAnimationFrame(barStep);
});
$('#tp-home').addEventListener('click', () => {
  if (bar.playing) barStop();
  setScale(1);
});
$('#rz-tk').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-t]');
  if (!b) return;
  if (bar.playing) barStop();
  setScale(Number(b.dataset.t));
});
{
  let drag = false;
  const from = (e: PointerEvent): void => {
    const r = trk.getBoundingClientRect(),
      u = clamp((e.clientX - r.left) / r.width, 0, 1) * 6 - 3,
      near = Math.round(u);
    /* 2 のべき乗の近くでは吸い付く */
    setScale(2 ** (Math.abs(u - near) < SNAP ? near : Math.round(u * 12) / 12));
  };
  trk.addEventListener('pointerdown', (e) => {
    if (bar.playing) barStop();
    drag = true;
    trk.setPointerCapture(e.pointerId);
    from(e);
  });
  trk.addEventListener('pointermove', (e) => {
    if (drag) from(e);
  });
  trk.addEventListener('pointerup', () => {
    drag = false;
  });
  trk.addEventListener('pointercancel', () => {
    drag = false;
  });
  trk.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    if (bar.playing) barStop();
    setScale(2 ** (Math.log2(S.s) + d / 4));
  });
}

/* ---------- 手法 ---------- */
const chips = $$<HTMLButtonElement>('#rz-m button[data-v]');
function chipsRefresh(): void {
  for (const b of chips)
    b.setAttribute(
      'aria-pressed',
      String(S.mode === 'cmp' ? S.cmp.includes(b.dataset.v as string) : S.m === b.dataset.v),
    );
}
$('#rz-m').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (!b) return;
  const id = b.dataset.v as string;
  if (S.mode === 'cmp') {
    const i = S.cmp.indexOf(id);
    if (i >= 0) {
      if (S.cmp.length > 1) S.cmp.splice(i, 1);
    } else if (S.cmp.length < CMP_MAX) S.cmp.push(id);
    store('rz-c', S.cmp);
  } else {
    S.m = id;
    store('rz-m', id);
  }
  chipsRefresh();
  schedule();
});

/* ---------- 画像の選択 ---------- */
const imgHost = $('#rz-i'),
  fileIn = $<HTMLInputElement>('#rz-file');
function drawThumb(cv: HTMLCanvasElement, id: string): void {
  const e = entry(id);
  if (!e.img && !e.gen) return;
  const img = imgOf(id),
    c = ctx(cv),
    W = 140,
    H = 92,
    k = Math.min(W / img.w, H / img.h);
  cv.width = W;
  cv.height = H;
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  c.imageSmoothingEnabled = id !== 'pixel';
  c.imageSmoothingQuality = 'high';
  c.drawImage(srcCanvas(id), (W - img.w * k) / 2, (H - img.h * k) / 2, img.w * k, img.h * k);
}
function imgButtons(): void {
  for (const b of $$<HTMLButtonElement>('button[data-i]', imgHost))
    b.setAttribute('aria-pressed', String(b.dataset.i === S.img));
}
function addFileButton(id: string, name: string): void {
  const b = document.createElement('button'),
    cv = document.createElement('canvas');
  b.type = 'button';
  b.className = 'rz-ib';
  b.dataset.i = id;
  b.append(cv, name);
  $('#rz-fb').before(b);
  drawThumb(cv, id);
}
function pickImage(id: string): void {
  S.img = id;
  if (SAMPLES.some((x) => x.id === id)) store('rz-i', id);
  resetCenter();
  imgButtons();
  schedule();
}
imgHost.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b) return;
  if (b.id === 'rz-fb') fileIn.click();
  else if (b.dataset.i) pickImage(b.dataset.i);
});
fileIn.addEventListener('change', async () => {
  const f = fileIn.files?.[0];
  fileIn.value = '';
  if (!f) return;
  const msg = $('#rz-msg');
  msg.textContent = '';
  try {
    const bm = await createImageBitmap(f),
      k = Math.min(1, FILE_MAX / Math.max(bm.width, bm.height)),
      w = Math.max(1, Math.round(bm.width * k)),
      h = Math.max(1, Math.round(bm.height * k)),
      cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    c.drawImage(bm, 0, 0, w, h);
    bm.close();
    const id = `file${images.length}`;
    images.push({ id, n: f.name, img: mkImg(w, h, c.getImageData(0, 0, w, h).data) });
    addFileButton(id, 'ファイル');
    listKey = '';
    pickImage(id);
  } catch {
    msg.textContent = 'この画像は読み込めません。';
  }
});
/* 重い見本は 1 枚ずつ、画面を止めないように作る */
{
  const thumbs = $$<HTMLButtonElement>('button[data-i]', imgHost).map(
      (b) => [b.querySelector('canvas') as HTMLCanvasElement, b.dataset.i as string] as const,
    ),
    next = (i: number): void => {
      if (i >= thumbs.length) return;
      drawThumb(thumbs[i][0], thumbs[i][1]);
      setTimeout(() => next(i + 1), 0);
    };
  const moon = new Image();
  moon.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = moon.width;
    cv.height = moon.height;
    const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    c.drawImage(moon, 0, 0);
    entry('moon').img = mkImg(moon.width, moon.height, c.getImageData(0, 0, moon.width, moon.height).data);
    const b = imgHost.querySelector<HTMLButtonElement>('button[data-i="moon"] canvas') as HTMLCanvasElement | null;
    if (b) drawThumb(b, 'moon');
    if (S.img === 'moon') resetCenter();
    listKey = '';
    schedule();
  };
  moon.src = `${BASE}image-convolution/moon.jpg`;
  setTimeout(() => next(0), 0);
}

/* ---------- 表示と設定 ---------- */
const coarse = matchMedia('(pointer:coarse)').matches;
function hint(): void {
  $('#rz-hint').textContent =
    S.mode === 'one'
      ? coarse
        ? '押して拡大鏡　ドラッグで移動　2 本指で倍率'
        : 'なぞって拡大鏡　ドラッグで移動　ホイールで倍率'
      : coarse
        ? 'ドラッグで全部を移動'
        : 'ドラッグで全部を移動　ホイールで倍率';
}
function setMode(v: Mode): void {
  S.mode = v;
  root.dataset.mode = v;
  $('#rz-one').hidden = v !== 'one';
  cmpHost.hidden = v !== 'cmp';
  $('#rz-list').hidden = v !== 'list';
  /* 一覧の表は全部を描き直すので再生しない */
  if (v === 'list' && bar.playing) barStop();
  pp.disabled = v === 'list';
  hint();
  chipsRefresh();
  render();
}
const modeCh = new Choice<Mode>($('#rz-mode'), setMode);
new Choice<string>($('#rz-zoom'), (v) => {
  S.zoom = Number(v);
  schedule();
});
const aaCh = new Choice<string>($('#p-aa'), (v) => {
    S.aa = v === 'on';
    schedule();
  }),
  linCh = new Choice<string>($('#p-lin'), (v) => {
    S.lin = v === 'lin';
    schedule();
  });
S.aa = aaCh.value === 'on';
S.lin = linCh.value === 'lin';

listT.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b) return;
  const go = (m: Mode): void => {
    modeCh.set(m);
    store('c:rz-mode', m);
    setMode(m);
  };
  if (b.dataset.col) {
    pickImage(b.dataset.col);
    go('cmp');
  } else if (b.dataset.row) {
    S.m = b.dataset.row;
    store('rz-m', S.m);
    go('one');
  } else if (b.dataset.m && b.dataset.i) {
    S.m = b.dataset.m;
    store('rz-m', S.m);
    pickImage(b.dataset.i);
    go('one');
  }
});

/* ---------- 大きさと配色の変化 ---------- */
let lastW = innerWidth;
addEventListener('resize', () => {
  /* スマートフォンのスクロールで高さだけ変わるときは描き直さない */
  if (innerWidth === lastW) return;
  lastW = innerWidth;
  schedule();
});
new ResizeObserver(() => {
  if (S.mode === 'one') drawKernel();
}).observe(kCv);
new MutationObserver(() => {
  if (S.mode === 'one') drawKernel();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

imgButtons();
mountMech($('#rz-how'));
setMode(modeCh.value);
requestAnimationFrame(() => {
  $('#rz-busy').hidden = true;
});

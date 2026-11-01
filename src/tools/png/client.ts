/**
 * PNG のページの入口: 画像（見本 2 枚・ファイル）→ 符号化かファイルの読み取り（Worker）→
 * 計算結果、画像と重ねる層、フィルタの比較、行の符号化、ハフマン表、ファイルの構成
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { minus, plain, ro } from '../../lib/format';
import { bindFileInput, loadImage, saveBytes } from '../../lib/imgfmt/file';
import { nice } from '../../lib/scope';
import { initToolPage } from '../../lib/tool-page';
import { drawSample, SAMPLE_H, SAMPLE_W } from '../jpeg/sample';
import { FileMap } from './filemap';
import { Huff } from './huff';
import { Ladder } from './ladder';
import {
  bitsPerPixelMap,
  type Compare,
  type EncOpts,
  type Fail,
  FILE_MAX_PIXELS,
  filterName,
  type Model,
  passMap,
  pixelByte,
  pixelRow,
  posRow,
  residualImage,
  rowPass,
  rowPixelXY,
  rowStartPos,
} from './model';
import { COLOR_TYPES, LADDER_N, MAX_SIDE } from './params';
import { type ColorType, decodePng } from './png';
import { ILLUST_H, ILLUST_W, illust } from './sample';
import { TK_MATCH, tokenAtPos } from './trace';
import { FILE_CMP_LEVEL, type Job, type Reply, run } from './worker';

initToolPage();

const txt = (id: string, s: string): void => {
  $(id).textContent = s;
};
const html = (id: string, s: string): void => {
  $(id).innerHTML = s;
};
const ctx2d = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('canvas を使えません');
  return x;
};
const cnt = (v: number): string => v.toLocaleString('en');
const sig = (v: number, s = 4): string => plain(v, s, true);
const bytesH = (n: number): string => (n < 1000 ? `${Math.round(n)}<span class="u">B</span>` : ro(n, 'B'));
const FC = ['--f0', '--f1', '--f2', '--f3', '--f4'];
const CMP_N = ['None', 'Sub', 'Up', 'Average', 'Paeth', '適応'];
/** パス 1〜7 の色（画像の上に重ねるので、テーマに依らない） */
const PASS_C = ['#e8554e', '#f2a93b', '#e8d24a', '#5cc06a', '#4fb3d9', '#6f7fe0', '#c069d6'];
/** ビット数の地図の濃淡（JPEG のページと同じ。テーマに依らない）: 黒 → 紫 → 白 */
const BITS_STOPS = [
  [8, 6, 16],
  [52, 26, 98],
  [112, 64, 176],
  [184, 150, 232],
  [248, 244, 255],
] as const;

/* ---------- 知らせ ---------- */
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  delete t.dataset.off;
  clearTimeout(toastT);
  toastT = setTimeout(() => {
    t.dataset.off = '';
  }, 2600);
}

/* ---------- 状態 ---------- */
interface Img {
  id: number;
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  name: string;
  /** PNG ファイルならそのバイト列 */
  png: Uint8Array | null;
}
let img: Img | null = null,
  nextImg = 0;
const imgs: Partial<Record<'test' | 'illust' | 'file', Img>> = {};
/** 今の結果と、フィルタの比較（あとから届く） */
let M: Model | null = null,
  CMP: Compare | null = null;
/** 比較の残差の画像（求めたものから持っておく） */
let cmpImg: (Uint8ClampedArray | null)[] = [];
/** 選んだ行と窓 */
let row = 0,
  x0 = 0,
  hb = 0;
/** フィルタの比較で指を乗せている図（−1 はなし） */
let preview = -1;

const css = (v: string): string => getComputedStyle($('.pgrid')).getPropertyValue(v).trim();

/* ---------- 入力 ---------- */
const src$ = new Choice($('#p-src'), (v) => setSrc(v as 'test' | 'illust' | 'file'));
const tg$ = new Choice($('#p-tg'), () => request());
const ct$ = new Choice($('#p-ct'), () => request());
const fi$ = new Choice($('#p-fi'), () => request());
const lv$ = new Choice($('#p-lv'), () => request());
const il$ = new Choice($('#p-il'), () => request());
const lay$ = new Choice($('#p-lay'), () => drawMain());
const cmpv$ = new Choice($('#p-cmpv'), () => drawCmp());
const hsw$ = new Choice($('#p-hsw'), (v) => huff.setTab(v as 'l' | 'd'));
const fileMode = (): boolean => !!img?.png && tg$.value === 'file';
const opts = (): EncOpts => ({
  colorType: Number(ct$.value) as ColorType,
  filter: fi$.value === 'a' ? 'adaptive' : (Number(fi$.value) as 0 | 1 | 2 | 3 | 4),
  level: Number(lv$.value),
  interlace: il$.value === '1',
});
/** ファイルをそのまま読む間は、符号化の設定を使わない */
function syncRows(): void {
  const f = fileMode();
  $('#in-tab').toggleAttribute('data-png', !!img?.png);
  for (const c of [ct$, fi$, lv$, il$]) c.setOff(f, '元のファイルのまま');
  if (!f && ct$.value !== '3') ct$.setOff(false);
}

/* ---------- 符号化（Web Worker） ---------- */
let worker: Worker | null = null,
  noWorker = false,
  busy = false,
  pending = false,
  jobId = 0,
  busyT: ReturnType<typeof setTimeout> | undefined;
function mkWorker(): Worker | null {
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Reply>) => done(e.data);
    w.onerror = (e) => {
      e.preventDefault();
      worker = null;
      noWorker = true;
      busy = false;
      request();
    };
    return w;
  } catch {
    noWorker = true;
    return null;
  }
}
function sendImg(i: Img): void {
  if (!worker) return;
  const c = i.rgba.slice();
  worker.postMessage({ kind: 'img', img: i.id, w: i.w, h: i.h, rgba: c } satisfies Job, [c.buffer]);
}
function setBusy(on: boolean): void {
  clearTimeout(busyT);
  $('#iv').classList.toggle('busy', on);
  if (on)
    busyT = setTimeout(() => {
      txt('#iv-st', '計算中…');
    }, 250);
  else txt('#iv-st', '');
}
function request(): void {
  const cur = img;
  if (!cur) return;
  syncRows();
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  setBusy(true);
  CMP = null;
  const j: Job =
    fileMode() && cur.png
      ? { kind: 'file', id: ++jobId, img: cur.id, bytes: cur.png.slice() }
      : { kind: 'enc', id: ++jobId, img: cur.id, opts: opts() };
  if (!worker && !noWorker) {
    worker = mkWorker();
    if (worker) sendImg(cur);
  }
  if (worker) worker.postMessage(j);
  else
    setTimeout(() => {
      run(j, { kind: 'img', img: cur.id, w: cur.w, h: cur.h, rgba: cur.rgba }, (r) => done(r));
    }, 16);
}
const FAIL: Record<Fail, string> = {
  'too-many-colors': '色が 256 を超えるため、パレットにできません。',
  'not-png': 'PNG ファイルとして読めませんでした。',
  'too-large': '画素が多すぎるため、元のファイルのままでは調べられません。',
};
function done(r: Reply): void {
  if (r.kind === 'cmp') {
    if (img && r.img === img.id && r.id === jobId) {
      CMP = r.c;
      cmpImg = [];
      drawCmp();
    }
    if (pending) {
      pending = false;
      busy = false;
      request();
    } else {
      busy = false;
      setBusy(false);
    }
    return;
  }
  if (!img || r.img !== img.id) return;
  if (r.m) apply(r.m);
  else {
    busy = false;
    setBusy(false);
    if (r.fail === 'too-many-colors') {
      /* パレットを選べなくして、ほかの色の型で符号化し直す */
      palette(false);
      request();
      return;
    }
    if (r.fail) {
      toast(FAIL[r.fail]);
      if (img.png) {
        tg$.set('enc');
        tg$.disable('file');
        request();
      }
    } else toast('符号化できませんでした。');
  }
}

/* ---------- 結果を出す ---------- */
function apply(m: Model): void {
  /* 前の結果で見ていた画素を、新しい結果の行と窓に移す（色の型やインターレースで行とバイトの並びが変わる） */
  const o = M?.layout,
    L = m.layout;
  if (o && o.width === L.width && o.height === L.height) {
    const pxOf = (j: number): number => Math.floor((j * 8) / o.bitsPerPixel),
      [ax, ay] = rowPixelXY(o, row, pxOf(x0)),
      [bx, by] = rowPixelXY(o, row, pxOf(x0 + hb)),
      [r, pa] = pixelRow(L, ax, ay),
      [, pb] = pixelRow(L, bx, by);
    row = r;
    x0 = pixelByte(L, pa);
    hb = Math.max(0, pixelByte(L, pb) - x0);
  }
  M = m;
  row = Math.min(row, L.rows - 1);
  clampX();
  fitView();
  results();
  drawBand();
  drawMain();
  ladder.render(m, { row, x0, n: winN(), hb });
  huff.set(m);
  focusBlock();
  fmap.set(m);
  drawCmp();
  $<HTMLButtonElement>('#saveBtn').disabled = m.mode !== 'enc';
  txt('#iv-sz', `${L.width}×${L.height}`);
  void browserZlib(m);
  /* 新しい画像の最初の結果では、画像ごとに決めた画素を選ぶ */
  if (pendingSel) {
    const [y, x] = pendingSel;
    pendingSel = null;
    const [r, px] = pixelRow(L, Math.min(L.width - 1, x), Math.min(L.height - 1, y));
    select(r, px);
  }
}
function results(): void {
  const m = M;
  if (!m) return;
  const L = m.layout,
    n = m.bytes.length,
    px = L.width * L.height,
    T = m.trace.tokens;
  let nl = 0,
    nm = 0,
    lb = 0,
    mb = 0;
  for (let i = 0; i < T.count; i++)
    if (T.kind[i] === 0) {
      nl++;
      lb += T.nbits[i];
    } else if (T.kind[i] === TK_MATCH) {
      nm++;
      mb += T.len[i];
    }
  const idat = m.zlib.length;
  html('#o-size', bytesH(n));
  txt('#o-sizes', `${cnt(n)} バイト · IDAT ${cnt(idat)}`);
  html('#o-bpp', `${sig((n * 8) / px)}<span class="u">bit/px</span>`);
  txt('#o-bpps', `元は ${L.bitsPerPixel} ビット`);
  html('#o-ratio', `${sig(L.rawSize / n, 3)} : 1`);
  txt('#o-ratios', `生 ${cnt(L.rawSize)} バイト`);
  html('#o-lit', `${cnt(nl)}<span class="u">個</span>`);
  txt('#o-lits', `ビットの ${sig((lb / 8 / Math.max(1, idat)) * 100, 3)} %`);
  html('#o-mat', `${cnt(nm)}<span class="u">個</span>`);
  txt('#o-mats', `元の ${sig((mb / Math.max(1, L.filteredSize)) * 100, 3)} % 分`);
  html('#o-crc', m.crcOk && m.adlerOk ? '<span class="ok">✓ 一致</span>' : '<span class="ng">✗ 不一致</span>');
  txt(
    '#o-crcs',
    `チャンク ${m.chunks.length} 個${m.crcOk ? '' : ` · CRC ✗ ${m.chunks.filter((c) => !c.crcOk).length}`}${m.adlerOk ? '' : ' · Adler ✗'}`,
  );
  html('#o-zl', '—');
  txt('#o-zls', '');
}
/** ブラウザの zlib（CompressionStream）で同じフィルタ後の並びを圧縮した大きさ */
async function browserZlib(m: Model): Promise<void> {
  try {
    const s = new Blob([m.filtered as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'));
    const n = (await new Response(s).arrayBuffer()).byteLength;
    if (m !== M) return;
    html('#o-zl', bytesH(n));
    txt('#o-zls', `自前との差 ${minus(sig(((n - m.zlib.length) / m.zlib.length) * 100, 2))} %`);
  } catch {
    /* 使えないブラウザでは出さない */
  }
}

/* ---------- 画像 ---------- */
const cv = $<HTMLCanvasElement>('#cv-img'),
  cx = ctx2d(cv),
  ov = $<HTMLCanvasElement>('#cv-ov'),
  ox = ctx2d(ov),
  iv = $('#iv');
function fitView(): void {
  const m = M;
  if (!m) return;
  const L = m.layout,
    e = $('.eiv');
  e.style.setProperty('--ar', String(L.width / L.height));
  iv.classList.toggle('smooth', cv.clientWidth > 0 && cv.clientWidth < L.width);
  const r = iv.getBoundingClientRect(),
    dpr = Math.min(2, window.devicePixelRatio || 1);
  ov.width = Math.max(1, Math.round(r.width * dpr));
  ov.height = Math.max(1, Math.round(r.height * dpr));
}
new ResizeObserver(() => {
  fitView();
  drawOverlay();
  const n = winN();
  if (M && n !== curN) {
    curN = n;
    clampX();
    ladder.render(M, { row, x0, n, hb });
  }
}).observe($('.a-img'));
let curN = 32;
/** 行の符号化の窓のバイト数（枠の幅で決める） */
const winN = (): number => ($('.ladw').clientWidth >= 860 ? LADDER_N[0] : LADDER_N[1]);

/** フィルタの帯: 画像の各行のフィルタ（Adam7 はパスごとの列） */
function drawBand(): void {
  const m = M;
  if (!m) return;
  const L = m.layout,
    c = $<HTMLCanvasElement>('#cv-band'),
    cols = L.passes.length;
  c.width = cols;
  c.height = L.height;
  const x = ctx2d(c),
    col = FC.map(css);
  x.clearRect(0, 0, cols, L.height);
  L.passes.forEach((p, i) => {
    for (let py = 0; py < p.h; py++) {
      x.fillStyle = col[m.types[p.rowStart + py]] ?? '#000';
      x.fillRect(i, p.y0 + py * p.dy, 1, p.dy);
    }
  });
  html(
    '#iv-blg',
    `左の帯${FC.map((v, i) => `<i style="background:var(${v})"></i>${filterName(i)}`).join('')}${L.interlace ? ' · 列はパス 1〜7' : ''}`,
  );
}

let memo: { m: Model; k: string; d: Uint8ClampedArray } | null = null;
function layerData(k: string): Uint8ClampedArray | null {
  const m = M;
  if (!m) return null;
  if (memo && memo.m === m && memo.k === k) return memo.d;
  const L = m.layout,
    W = L.width,
    H = L.height;
  let d: Uint8ClampedArray;
  if (k === 'r') d = residualImage(L, m.filtered, m.types);
  else if (k === 'b') {
    const b = bitsPerPixelMap(L, m.trace),
      top = nice(Math.max(4, Float32Array.from(b).sort()[Math.floor((b.length - 1) * 0.99)] ?? 8));
    d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const v = Math.min(1, b[i] / top) * (BITS_STOPS.length - 1),
        q = Math.min(BITS_STOPS.length - 2, Math.floor(v)),
        f = v - q;
      for (let c = 0; c < 3; c++) d[i * 4 + c] = BITS_STOPS[q][c] + (BITS_STOPS[q + 1][c] - BITS_STOPS[q][c]) * f;
      d[i * 4 + 3] = 255;
    }
    bitsTop = top;
  } else if (k === 'p') {
    const p = passMap(W, H);
    d = new Uint8ClampedArray(m.rgba);
    for (let i = 0; i < W * H; i++) {
      const c = PASS_C[p[i] - 1],
        g =
          (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) * (d[i * 4 + 3] / 255) +
          255 * (1 - d[i * 4 + 3] / 255);
      for (let q = 0; q < 3; q++) d[i * 4 + q] = Number.parseInt(c.slice(1 + q * 2, 3 + q * 2), 16) * 0.55 + g * 0.45;
      d[i * 4 + 3] = 255;
    }
  } else d = m.rgba;
  memo = { m, k, d };
  return d;
}
let bitsTop = 8;
function drawMain(): void {
  const m = M;
  if (!m) return;
  const L = m.layout,
    k = lay$.value;
  cv.width = L.width;
  cv.height = L.height;
  let d: Uint8ClampedArray | null;
  if (preview >= 0) d = cmpData(preview);
  else d = layerData(k);
  if (d) cx.putImageData(new ImageData(d as Uint8ClampedArray<ArrayBuffer>, L.width, L.height), 0, 0);
  let lg = '';
  if (preview >= 0) lg = `${CMP_N[preview]} の残差 · 灰色が 0`;
  else if (k === 'r') lg = `${filterName(m.types[row])} ほかの残差 · 灰色が 0`;
  else if (k === 'b') lg = `0 → ${bitsTop} ビット/画素`;
  else if (k === 'p') lg = 'パス 1〜7';
  else if (k === 'm') lg = '選んだ行の一致 → 写し元';
  if (k === 'r' && preview < 0) lg = '残差 · 灰色が 0';
  txt('#iv-lg', lg);
  drawOverlay();
}
/** 選んだ行・窓、一致の矢印、パスの番号 */
function drawOverlay(): void {
  const m = M;
  ox.clearRect(0, 0, ov.width, ov.height);
  if (!m) return;
  const L = m.layout,
    sx = ov.width / L.width,
    sy = ov.height / L.height,
    dpr = ov.width / Math.max(1, iv.clientWidth),
    [p, py] = rowPass(L, row),
    y = p.y0 + py * p.dy;
  /* 一致: 選んだ行の一致を塗り、写し元へ弧を引く */
  if (lay$.value === 'm' && preview < 0) {
    ox.fillStyle = 'rgba(0,0,0,.45)';
    ox.fillRect(0, 0, ov.width, ov.height);
    const T = m.trace.tokens,
      s = rowStartPos(L, row),
      e = s + p.rowBytes + 1,
      at = (pos: number): [number, number] => {
        const [r, j] = posRow(L, pos),
          [xx, yy] = rowPixelXY(L, r, Math.max(0, Math.floor((Math.max(0, j) * 8) / L.bitsPerPixel)));
        return [(xx + 0.5) * sx, (yy + 0.5) * sy];
      };
    ox.lineWidth = 1.5 * dpr;
    const mc = css('--mat');
    for (let i = Math.max(0, tokenAtPos(T, s)); i < T.count && T.pos[i] < e; i++) {
      if (T.kind[i] !== TK_MATCH) continue;
      const [a0, b0] = at(T.pos[i]),
        [a1, b1] = at(T.pos[i] - T.dist[i]),
        [a2] = at(Math.min(e - 1, T.pos[i] + T.len[i] - 1));
      ox.fillStyle = mc;
      ox.fillRect(a0 - sx / 2, b0 - Math.max(sy, 2 * dpr) / 2, Math.max(sx, a2 - a0 + sx), Math.max(sy, 2 * dpr));
      ox.strokeStyle = mc;
      ox.beginPath();
      ox.moveTo(a0, b0);
      ox.quadraticCurveTo((a0 + a1) / 2, Math.min(b0, b1) - 18 * dpr, a1, b1);
      ox.stroke();
      ox.strokeStyle = '#fff';
      ox.strokeRect(
        a1 - sx / 2,
        b1 - sy / 2,
        Math.max(sx, (T.len[i] * 8 * sx) / L.bitsPerPixel),
        Math.max(sy, 2 * dpr),
      );
    }
  }
  /* 選んだ行（両端の印）と窓 */
  const [pa, pb] = [Math.floor((x0 * 8) / L.bitsPerPixel), Math.floor(((x0 + curN) * 8 - 1) / L.bitsPerPixel)],
    [xa] = rowPixelXY(L, row, Math.min(p.w - 1, pa)),
    [xb] = rowPixelXY(L, row, Math.min(p.w - 1, pb)),
    h = Math.max(sy * p.dy, 3 * dpr);
  ox.fillStyle = 'rgba(255,255,255,.85)';
  ox.fillRect(0, y * sy, 5 * dpr, Math.max(sy, 2 * dpr));
  ox.fillRect(ov.width - 5 * dpr, y * sy, 5 * dpr, Math.max(sy, 2 * dpr));
  const rx = xa * sx - 2 * dpr,
    ry = y * sy - 2 * dpr,
    rw = (xb - xa + p.dx) * sx + 4 * dpr,
    rh = (p.dy > 1 ? sy : h) + 4 * dpr;
  ox.lineWidth = 3.5 * dpr;
  ox.strokeStyle = '#000';
  ox.strokeRect(rx, ry, rw, rh);
  ox.lineWidth = 1.5 * dpr;
  ox.strokeStyle = '#fff';
  ox.strokeRect(rx, ry, rw, rh);
  txt('#iv-row', String(row));
}

/* 画像を押して行と窓を選ぶ。指を乗せた所は読み値に出す */
function pixelAt(e: PointerEvent | MouseEvent): [number, number] | null {
  const m = M;
  if (!m) return null;
  const r = cv.getBoundingClientRect(),
    x = Math.floor(((e.clientX - r.left) / r.width) * m.layout.width),
    y = Math.floor(((e.clientY - r.top) / r.height) * m.layout.height);
  return x >= 0 && y >= 0 && x < m.layout.width && y < m.layout.height ? [x, y] : null;
}
iv.addEventListener('pointermove', (e) => {
  const m = M,
    p = pixelAt(e);
  if (!m || !p) return;
  const [r] = pixelRow(m.layout, p[0], p[1]),
    [ps] = rowPass(m.layout, r);
  txt('#iv-rd', `(${p[0]}, ${p[1]}) · ${m.layout.interlace ? `パス ${ps.pass} · ` : ''}${filterName(m.types[r])}`);
});
iv.addEventListener('pointerleave', () => txt('#iv-rd', ''));
iv.addEventListener('click', (e) => {
  const m = M,
    p = pixelAt(e);
  if (!m || !p) return;
  const [r, px] = pixelRow(m.layout, p[0], p[1]);
  select(r, px);
});
iv.addEventListener('keydown', (e) => {
  const m = M;
  if (!m) return;
  const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  if (d[0]) {
    row = Math.max(0, Math.min(m.layout.rows - 1, row + d[0]));
    clampX();
  } else x0 += d[1] * Math.max(1, curN >> 1);
  update();
});
/** 行 r の画素 px を窓の 1/4 ほどの所に置く */
function select(r: number, px: number): void {
  const m = M;
  if (!m) return;
  row = r;
  const L = m.layout,
    bpx = L.bitsPerPixel / 8;
  x0 = pixelByte(L, Math.max(0, px - Math.floor(curN / Math.max(1, bpx) / 4)));
  hb = Math.min(curN - 1, pixelByte(L, px) - x0);
  clampX();
  update();
}
function clampX(): void {
  const m = M;
  if (!m) return;
  const [p] = rowPass(m.layout, row),
    bpx = Math.max(1, m.layout.bitsPerPixel >> 3);
  let x = Math.max(0, Math.min(x0, p.rowBytes - curN));
  x -= x % bpx;
  x0 = Math.max(0, x);
}
function update(): void {
  const m = M;
  if (!m) return;
  clampX();
  drawOverlay();
  ladder.render(m, { row, x0, n: curN, hb });
  focusBlock();
}
for (const b of $$<HTMLButtonElement>('#ladNav button'))
  b.addEventListener('click', () => {
    x0 += Number(b.dataset.d) * curN;
    update();
  });

/* ---------- フィルタの比較 ---------- */
function cmpData(f: number): Uint8ClampedArray | null {
  const m = M,
    c = CMP;
  if (!m || !c) return null;
  cmpImg[f] ??= residualImage(m.layout, c.data[f], c.types[f]);
  return cmpImg[f];
}
/** 今の結果に当たる比較の図（ファイルをそのまま読む間はなし） */
const curCmp = (): number => (fileMode() ? -1 : fi$.value === 'a' ? 5 : Number(fi$.value));
function drawCmp(): void {
  const m = M,
    c = CMP,
    figs = $$<HTMLElement>('#cmp figure');
  txt('#cmp-lv', m ? `LEVEL ${fileMode() ? FILE_CMP_LEVEL : lv$.value}` : '');
  txt('#cmp-st', c ? '' : '計算中…');
  const mn = c ? Math.min(...c.sizes) : 0,
    mx = c ? Math.max(...c.sizes) : 1;
  figs.forEach((fg, f) => {
    fg.setAttribute('aria-pressed', String(f === curCmp()));
    fg.classList.toggle('best', !!c && c.sizes[f] === mn);
    const cvs = $<HTMLCanvasElement>('canvas', fg),
      b = $('b', fg),
      u = $('u', fg);
    if (!m || !c) {
      b.textContent = '—';
      u.style.width = '0';
      return;
    }
    const L = m.layout,
      d = cmpv$.value === 'o' ? m.rgba : cmpData(f);
    cvs.width = L.width;
    cvs.height = L.height;
    if (d) ctx2d(cvs).putImageData(new ImageData(d as Uint8ClampedArray<ArrayBuffer>, L.width, L.height), 0, 0);
    if (cmpv$.value === 'o') {
      /* 元の画像に行ごとのフィルタの帯を重ねる */
      const x = ctx2d(cvs),
        col = FC.map(css),
        w = Math.max(2, Math.round(L.width / 24));
      for (const p of L.passes)
        for (let py = 0; py < p.h; py++) {
          x.fillStyle = col[c.types[f][p.rowStart + py]];
          x.fillRect(0, p.y0 + py * p.dy, w, p.dy);
        }
    }
    b.innerHTML = bytesH(c.sizes[f]);
    u.style.width = `${(c.sizes[f] / mx) * 100}%`;
    u.style.background = f === 5 ? 'var(--ink)' : `var(${FC[f]})`;
  });
}
$('#cmp').addEventListener('pointerover', (e) => {
  const fg = (e.target as Element).closest<HTMLElement>('figure[data-f]'),
    f = fg ? Number(fg.dataset.f) : -1;
  if (f !== preview && CMP) {
    preview = f;
    drawMain();
  }
});
$('#cmp').addEventListener('pointerleave', () => {
  if (preview < 0) return;
  preview = -1;
  drawMain();
});
function pickCmp(f: number): void {
  if (!img) return;
  /* 押したフィルタで符号化する。同じ図をもう 1 度押すと適応に戻す */
  const v = f === 5 || f === curCmp() ? 'a' : String(f);
  if (img.png) tg$.choose('enc');
  fi$.choose(v);
  if (v !== 'a') lay$.choose('r');
  preview = -1;
  request();
}
$('#cmp').addEventListener('click', (e) => {
  const fg = (e.target as Element).closest<HTMLElement>('figure[data-f]');
  if (fg) pickCmp(Number(fg.dataset.f));
});
$('#cmp').addEventListener('keydown', (e) => {
  const fg = (e.target as Element).closest<HTMLElement>('figure[data-f]');
  if (fg && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    pickCmp(Number(fg.dataset.f));
  }
});

/* ---------- 行の符号化・ハフマン表・ファイルの構成 ---------- */
const huff = new Huff($<SVGSVGElement>('#huf'), {
  blk: $('#hf-blk'),
  type: $('#hf-type'),
  lg: $('#hf-lg'),
  rd: $('#hf-rd'),
  prev: $<HTMLButtonElement>('#blkPrev'),
  next: $<HTMLButtonElement>('#blkNext'),
});
if (hsw$.value === 'd') huff.setTab('d');
const ladder = new Ladder(
  $('#lad'),
  $('#ldet'),
  { row: $('#ld-row'), x: $('#ld-x'), f: $('#ld-f'), bits: $('#ld-bits') },
  (t) => {
    huff.point(t);
    fmap.markToken(t);
  },
);
const fmap = new FileMap({ strip: $('#strip'), table: $('#segs tbody'), hex: $('#hx'), sym: $('#fsym') }, (t) => {
  const m = M;
  if (!m) return;
  const [r, j] = posRow(m.layout, m.trace.tokens.pos[t]);
  select(r, Math.floor((Math.max(0, j) * 8) / m.layout.bitsPerPixel));
});
/** 選んだ行の最初の記号のブロックをハフマン表に出す */
function focusBlock(): void {
  const m = M;
  if (!m) return;
  const T = m.trace.tokens,
    i = tokenAtPos(T, rowStartPos(m.layout, row) + 1 + x0);
  if (i >= 0) huff.go(T.block[i]);
}

/* ---------- 入力元 ---------- */
function sampleTest(): Img {
  const c = document.createElement('canvas');
  c.width = SAMPLE_W;
  c.height = SAMPLE_H;
  const x = ctx2d(c);
  drawSample(x);
  return {
    id: ++nextImg,
    w: SAMPLE_W,
    h: SAMPLE_H,
    rgba: x.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data,
    name: 'test',
    png: null,
  };
}
function setImage(i: Img, at: [number, number]): void {
  img = i;
  M = null;
  CMP = null;
  memo = null;
  cmpImg = [];
  row = at[0];
  x0 = 0;
  hb = 0;
  pendingSel = at;
  palette(countColors(i.rgba) <= 256);
  tg$.disable('file', false);
  $<HTMLButtonElement>('#saveBtn').disabled = true;
  if (worker) sendImg(i);
  request();
}
/** 色の数（257 で数えるのをやめる） */
function countColors(d: Uint8ClampedArray): number {
  const s = new Set<number>(),
    v = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2);
  for (let i = 0; i < v.length && s.size <= 256; i++) s.add(d[i * 4 + 3] ? v[i] : 0);
  return s.size;
}
/** パレットを選べるか（256 色を超える画像では選べない） */
function palette(ok: boolean): void {
  ct$.disable('3', !ok);
  const b = $<HTMLButtonElement>('#p-ct button[data-v="3"]');
  b.title = ok ? COLOR_TYPES[3][2] : '色が 256 を超えるため選べない';
  if (!ok && ct$.value === '3') ct$.set('6');
}
/** 新しい画像の最初の結果で選ぶ画素 */
let pendingSel: [number, number] | null = null;
function setSrc(v: 'test' | 'illust' | 'file'): void {
  $('#in-tab').dataset.src = v;
  if (v === 'test') {
    imgs.test ??= sampleTest();
    setImage(imgs.test, [150, 150]);
  } else if (v === 'illust') {
    imgs.illust ??= { id: ++nextImg, w: ILLUST_W, h: ILLUST_H, rgba: illust(), name: 'illust', png: null };
    setImage(imgs.illust, [44, 30]);
  } else if (imgs.file) setImage(imgs.file, [imgs.file.h >> 1, imgs.file.w >> 2]);
  else $<HTMLInputElement>('#fileIn').click();
}
const isPng = (b: Uint8Array): boolean =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
async function loadFile(f: File): Promise<void> {
  const ms = $('#m-file');
  ms.className = 'msg';
  ms.textContent = '読み込んでいます…';
  try {
    const r = await loadImage(f, { maxSide: MAX_SIDE });
    const png = isPng(r.bytes) ? r.bytes : null;
    imgs.file = { id: ++nextImg, w: r.w, h: r.h, rgba: r.rgba, name: r.name, png };
    ms.textContent = `${f.name} · ${r.W}×${r.H}${r.w < r.W ? ` を ${r.w}×${r.h} に縮小` : ''}`;
    src$.set('file');
    $('#in-tab').dataset.src = 'file';
    setImage(imgs.file, [r.h >> 1, r.w >> 2]);
  } catch {
    /* ブラウザが読めない PNG（CRC の誤り・途中で切れたものなど）は、自前の復号器で読めた所まで出す */
    const b = new Uint8Array(await f.arrayBuffer());
    try {
      if (!isPng(b)) throw new Error('PNG でない');
      const d = decodePng(b, { tolerant: true, ignoreCrc: true, trace: false }),
        n = d.width * d.height;
      if (!n || n > FILE_MAX_PIXELS) throw new Error('大きさ');
      imgs.file = {
        id: ++nextImg,
        w: d.width,
        h: d.height,
        rgba: d.rgba,
        name: f.name.replace(/\.[^.]*$/, '') || 'image',
        png: b,
      };
      ms.textContent = `${f.name} · ${d.width}×${d.height} · ブラウザでは表示できないファイル`;
      src$.set('file');
      $('#in-tab').dataset.src = 'file';
      tg$.set('file');
      setImage(imgs.file, [d.height >> 1, d.width >> 2]);
    } catch {
      ms.className = 'msg er';
      ms.textContent = `${f.name} を画像として読めませんでした`;
    }
  }
}
bindFileInput($('#fileBtn'), $<HTMLInputElement>('#fileIn'), [$('.a-in'), $('.a-img')], (f) => void loadFile(f));

/* ---------- 保存 ---------- */
$('#saveBtn').addEventListener('click', () => {
  const m = M;
  if (!m || !img || m.mode !== 'enc') return;
  const o = opts();
  saveBytes(
    m.bytes,
    'image/png',
    `${img.name}-ct${o.colorType}-${o.filter === 'adaptive' ? 'a' : filterName(o.filter)}-l${o.level}${o.interlace ? '-adam7' : ''}.png`,
  );
});

/* ---------- 始める ---------- */
setSrc(src$.value === 'file' ? 'test' : (src$.value as 'test' | 'illust'));

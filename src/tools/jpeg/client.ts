/**
 * JPEG のページの入口: 画像（見本・ファイル）→ 符号化と復号（Worker）→
 * 画像の表示・拡大、選んだブロックの途中の値、計算結果、ファイルの構成、代入した式
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmtR, minus, plain, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { nice } from '../../lib/scope';
import { initToolPage } from '../../lib/tool-page';
import { type BlockInfo, blockInfo, compBlock } from './block';
import { rgbToYcc, type Sub, type Up, yccToRgb } from './color';
import { basis } from './dct';
import type { EncOpts, Huff } from './encoder';
import { bitsImage, diffImage } from './metrics';
import { HUFFS, MAX_SIDE, QUALITY, SUBS } from './params';
import { drawSample, SAMPLE_BLOCK, SAMPLE_H, SAMPLE_W } from './sample';
import { FLAT, K1, type QTab, qualityScale, ZIGZAG, ZZ_OF } from './tables';
import { substHtml } from './theory';
import { type Job, type Reply, type Result, run } from './worker';

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
const ctx2d = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('canvas を使えません');
  return x;
};
const imageData = (d: Uint8ClampedArray, w: number, h: number) =>
  new ImageData(d as Uint8ClampedArray<ArrayBuffer>, w, h);
initToolPage();

/* ---------- 表記 ---------- */
/** 有効数字 s 桁（計算結果なので末尾の 0 を残す） */
const sig = (v: number, s = 4): string => plain(v, s, true);
/** 整数（負はマイナス記号） */
const int = (v: number): string => minus(String(Math.round(v) || 0));
/** 実数を小数 n 桁で */
const fix = (v: number, n = 2): string => minus((Math.abs(v) < 0.5 * 10 ** -n ? 0 : v).toFixed(n));
const bytesH = (n: number): string => (n < 1000 ? `${Math.round(n)}<span class="u">B</span>` : ro(n, 'B'));
const bytesT = (n: number): string => (n < 1000 ? `${Math.round(n)} B` : fmtR(n, 'B'));
const dbH = (v: number): string => (Number.isFinite(v) ? `${sig(v)}<span class="u">dB</span>` : '∞');
const CN = ['Y', 'Cb', 'Cr'];
/** ビット数の地図の濃淡（テーマに依らない）: 黒 → 紫 → 白。明るいほど多い */
const BITS_STOPS = [
  [8, 6, 16],
  [52, 26, 98],
  [112, 64, 176],
  [184, 150, 232],
  [248, 244, 255],
] as const;
/** ビット数の地図の上端 [ビット/ブロック]: 画像のブロックの 99 % が収まる切りのよい値（16 以上） */
function bitsTop(map: Float32Array): number {
  const a = Float32Array.from(map).sort();
  return nice(Math.max(16, a[Math.floor((a.length - 1) * 0.99)] ?? 16));
}
/** DCT の基底の図: 1 つの基底の大きさと間隔 [canvas の画素] */
const T = 32,
  GAP = 2;

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
  /** 保存するファイル名の元 */
  name: string;
}
let img: Img | null = null,
  sampleImg: Img | null = null,
  fileImg: Img | null = null,
  nextImg = 0;
/** 最後に符号化した結果（今の画像のもの） */
let R: Result | null = null;
/** 選んだブロック（Y のブロックの位置） */
let sel: [number, number] = [SAMPLE_BLOCK[0], SAMPLE_BLOCK[1]];
/** 選んだブロックの途中の値 */
let B: BlockInfo | null = null;

const view$ = new Choice($('#p-view'), () => {
  drawMain();
  drawZoom();
});
const sub$ = new Choice($('#p-sub'), () => request());
const qt$ = new Choice($('#p-qt'), () => request());
const huff$ = new Choice($('#p-huff'), () => request());
const up$ = new Choice($('#p-up'), () => request());
const zoom$ = new Choice($('#p-zoom'), () => {
  drawZoom();
  drawOverlay();
});
const gain$ = new Choice($('#p-gain'), () => {
  if (view$.value === 'diff') {
    drawMain();
    drawZoom();
  }
});
const comp$ = new Choice($('#p-comp'), () => {
  syncComp();
  renderBlock();
  drawOverlay();
  drawZoom();
});
const src$ = new Choice($('#p-src'), (v) => setSrc(v));
const G = new ParamGroup<'q'>([QUALITY], (_v, k) => {
  if (k) request();
});
const ci = (): number => Number(comp$.value);
const opts = (): EncOpts => ({
  q: G.get('q'),
  sub: sub$.value as Sub,
  qt: qt$.value as QTab,
  huff: huff$.value as Huff,
});

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
/** 今の画像と設定で符号化する。計算中なら、終わった後に最新の設定でもう 1 度 */
function request(): void {
  const cur = img;
  if (!cur) return;
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  setBusy(true);
  const j = { kind: 'enc', id: ++jobId, img: cur.id, opts: opts(), up: up$.value as Up } as const;
  if (!worker && !noWorker) {
    worker = mkWorker();
    if (worker) sendImg(cur);
  }
  if (worker) worker.postMessage(j satisfies Job);
  else
    setTimeout(() => {
      let r: Result | null = null;
      try {
        r = run(cur.rgba, cur.w, cur.h, j.opts, j.up);
      } catch {
        r = null;
      }
      done({ id: j.id, img: cur.id, r });
    }, 16);
}
function done(rep: Reply): void {
  busy = false;
  if (img && rep.img === img.id) {
    if (rep.r) apply(rep.r);
    else toast('符号化できませんでした');
  }
  if (pending) {
    pending = false;
    request();
  } else setBusy(false);
}

function apply(r: Result): void {
  R = r;
  clampSel();
  drawMain();
  drawZoom();
  drawOverlay();
  showResults();
  renderBlock();
  renderFile();
  renderSubst();
  $<HTMLButtonElement>('#saveBtn').disabled = false;
}

/* ---------- 画像 ---------- */
const cv = $<HTMLCanvasElement>('#cv-img'),
  cx = ctx2d(cv),
  iv = $('#iv');
/** 表示する層。差とビット数の地図は、結果と強調が同じ間は作り直さない */
let memo: { r: Result; key: string; d: Uint8ClampedArray } | null = null;
function layer(kind: string): Uint8ClampedArray | null {
  if (!img) return null;
  if (kind === 'org' || !R) return img.rgba;
  if (kind === 'dec') return R.dec;
  const key = kind === 'diff' ? `diff${gain$.value}` : kind;
  if (memo?.r === R && memo.key === key) return memo.d;
  const d =
    kind === 'diff'
      ? diffImage(img.rgba, R.dec, Number(gain$.value))
      : bitsImage(R.enc.map, R.enc.comps[0].bw, img.w, img.h, bitsTop(R.enc.map), BITS_STOPS);
  memo = { r: R, key, d };
  return d;
}
function drawMain(): void {
  const d = layer(view$.value);
  if (!d || !img) return;
  if (cv.width !== img.w || cv.height !== img.h) {
    cv.width = img.w;
    cv.height = img.h;
  }
  cx.putImageData(imageData(d, img.w, img.h), 0, 0);
  legend();
}
function legend(): void {
  const v = view$.value,
    g = `linear-gradient(90deg,${BITS_STOPS.map((c) => `rgb(${c.join(' ')})`).join(',')})`;
  html(
    '#iv-lg',
    v === 'diff'
      ? `DIFF <b>×${gain$.value}</b>（灰色が 0）`
      : v === 'bits'
        ? `<b>0</b><i class="cbar" style="background:${g}" aria-hidden="true"></i><b>${R ? bitsTop(R.enc.map) : ''}</b> bit/ブロック（平方根の目盛り）`
        : v === 'org'
          ? '元の画像'
          : R
            ? `Q <b>${R.enc.opts.q}</b> · ${SUBS.find((s) => s[0] === R?.enc.opts.sub)?.[1] ?? ''}`
            : '',
  );
}
/** 画像の大きさに合わせた表示: 縦長の画像は高さを抑え、縮小して見せるときは滑らかに */
function fitView(): void {
  if (!img) return;
  iv.style.setProperty('--ar', String(img.w / img.h));
  iv.classList.toggle('smooth', cv.clientWidth > 0 && cv.clientWidth < img.w);
}
new ResizeObserver(fitView).observe(iv);

/** 選んだブロックの範囲 [x, y, w, h]（色差を選んでいれば、そのブロックが受け持つ画素） */
function selRect(): [number, number, number, number] {
  if (!R) return [sel[0] * 8, sel[1] * 8, 8, 8];
  const e = R.enc,
    c = e.comps[ci()],
    fx = e.hmax / c.h,
    fy = e.vmax / c.v,
    [bx, by] = compBlock(e, ci(), sel[0], sel[1]);
  return [bx * 8 * fx, by * 8 * fy, 8 * fx, 8 * fy];
}
/** 拡大する範囲の左上（8 の倍数） */
function zoomOrigin(): [number, number] {
  const S = Number(zoom$.value),
    w8 = Math.ceil((img?.w ?? 0) / 8) * 8,
    h8 = Math.ceil((img?.h ?? 0) / 8) * 8,
    at = (b: number, n: number) => Math.max(0, Math.min(Math.max(0, n - S), Math.floor((b * 8 + 4 - S / 2) / 8) * 8));
  return [at(sel[0], w8), at(sel[1], h8)];
}
const rectAttr = (el: Element, r: readonly number[]) => {
  el.setAttribute('x', String(r[0]));
  el.setAttribute('y', String(r[1]));
  el.setAttribute('width', String(r[2]));
  el.setAttribute('height', String(r[3]));
};
function drawOverlay(): void {
  if (!img) return;
  $('#ov-img').setAttribute('viewBox', `0 0 ${img.w} ${img.h}`);
  const r = selRect();
  rectAttr($('#ov-so'), r);
  rectAttr($('#ov-si'), r);
  const S = Number(zoom$.value),
    [x0, y0] = zoomOrigin();
  rectAttr($('#ov-zr'), [x0, y0, S, S]);
}

/* 拡大: 元と（表示中の層の）復号を並べる。格子は 8×8 のブロックの境目 */
function crop(d: Uint8ClampedArray, x0: number, y0: number, S: number): ImageData {
  const o = new ImageData(S, S);
  if (!img) return o;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const sx = x0 + x,
        sy = y0 + y;
      if (sx >= img.w || sy >= img.h) continue;
      const i = (sy * img.w + sx) * 4,
        j = (y * S + x) * 4;
      o.data[j] = d[i];
      o.data[j + 1] = d[i + 1];
      o.data[j + 2] = d[i + 2];
      o.data[j + 3] = 255;
    }
  return o;
}
function drawZoom(): void {
  if (!img) return;
  const S = Number(zoom$.value),
    [x0, y0] = zoomOrigin(),
    v = view$.value,
    right = v === 'org' ? 'dec' : v,
    sr = selRect();
  txt('#zc1', right === 'dec' ? '復号' : right === 'diff' ? `差 ×${gain$.value}` : 'ビット数');
  [img.rgba, layer(right)].forEach((d, i) => {
    const c = $<HTMLCanvasElement>(`#cv-z${i}`);
    c.width = S;
    c.height = S;
    if (d) ctx2d(c).putImageData(crop(d, x0, y0, S), 0, 0);
    let g = '';
    for (let k = 8; k < S; k += 8) g += `M${k} 0V${S}M0 ${k}H${S}`;
    const r = [sr[0] - x0, sr[1] - y0, sr[2], sr[3]];
    const svg = $(`#ov-z${i}`);
    svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
    svg.innerHTML = `<path class="g" d="${g}"/><rect class="o" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}"/><rect class="i" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}"/>`;
  });
}

/* 選ぶ: 画像・拡大の上を押す、矢印キー */
function nBlocks(): [number, number] {
  return img ? [Math.ceil(img.w / 8), Math.ceil(img.h / 8)] : [1, 1];
}
function clampSel(): void {
  const [nx, ny] = nBlocks();
  sel = [Math.max(0, Math.min(nx - 1, sel[0])), Math.max(0, Math.min(ny - 1, sel[1]))];
}
function select(bx: number, by: number): void {
  const old = `${sel}`;
  sel = [bx, by];
  clampSel();
  if (`${sel}` === old) return;
  drawOverlay();
  drawZoom();
  renderBlock();
}
/** ポインタの位置を、要素 el に描いた w×h の画像の座標に */
function posIn(el: Element, e: PointerEvent, w: number, h: number): [number, number] | null {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const x = Math.floor(((e.clientX - r.left) / r.width) * w),
    y = Math.floor(((e.clientY - r.top) / r.height) * h);
  return x >= 0 && y >= 0 && x < w && y < h ? [x, y] : null;
}
iv.addEventListener('pointerdown', (e) => {
  const p = img && posIn(cv, e, img.w, img.h);
  if (p) select(p[0] >> 3, p[1] >> 3);
});
iv.addEventListener('pointermove', (e) => {
  const p = img && posIn(cv, e, img.w, img.h);
  readPx(p ?? null);
  if (p && e.pointerType === 'mouse' && e.buttons & 1) select(p[0] >> 3, p[1] >> 3);
});
iv.addEventListener('pointerleave', () => readPx(null));
iv.addEventListener('keydown', (e) => {
  const d: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const m = d[e.key];
  if (!m) return;
  e.preventDefault();
  select(sel[0] + m[0], sel[1] + m[1]);
});
for (const z of $$('.zw'))
  z.addEventListener('pointerdown', (e) => {
    const S = Number(zoom$.value),
      p = posIn(z, e, S, S),
      [x0, y0] = zoomOrigin();
    if (p) select((x0 + p[0]) >> 3, (y0 + p[1]) >> 3);
  });
/** 画像の下の読み値: 指している画素の値（なければ選んだブロック） */
function readPx(p: [number, number] | null): void {
  if (!img) return;
  if (!p) {
    html(
      '#iv-rd',
      R && B
        ? `BLOCK <b>(${sel[0]}, ${sel[1]})</b> · <b>${Math.round(R.enc.map[sel[1] * R.enc.comps[0].bw + sel[0]])}</b> bit`
        : '',
    );
    return;
  }
  const i = (p[1] * img.w + p[0]) * 4,
    o = img.rgba,
    rgb = (d: Uint8ClampedArray) => `${d[i]} ${d[i + 1]} ${d[i + 2]}`;
  let s = `<b>${p[0]}, ${p[1]}</b> · 元 <b>${rgb(o)}</b>`;
  if (R) {
    s += ` · 復号 <b>${rgb(R.dec)}</b>`;
    if (view$.value === 'bits')
      s += ` · <b>${Math.round(R.enc.map[(p[1] >> 3) * R.enc.comps[0].bw + (p[0] >> 3)])}</b> bit`;
  }
  html('#iv-rd', s);
}

/* ---------- 計算結果 ---------- */
function showResults(): void {
  if (!R) return;
  const r = R,
    e = r.enc,
    n = e.bytes.length,
    px = e.w * e.h,
    bits = n * 8,
    sum = (f: (c: (typeof e.comps)[number]) => number) => e.comps.reduce((s, c) => s + f(c), 0);
  html('#o-size', bytesH(n));
  txt('#o-sizes', `${n} バイト（バイトスタッフィング ${e.stuffed}）`);
  html('#o-bpp', `${sig(bits / px)}<span class="u">bit/px</span>`);
  txt('#o-bpps', `${e.w}×${e.h} 画素`);
  html('#o-ratio', `${sig((px * 3) / n)}<span class="u">: 1</span>`);
  txt('#o-ratios', `無圧縮の ${sig((bits / (px * 24)) * 100, 3)} %`);
  html('#o-py', dbH(r.psnrY));
  html('#o-prgb', dbH(r.psnrRgb));
  const tot = sum((c) => c.coef.length),
    z = sum((c) => c.zeros);
  html('#o-zero', `${sig((z / tot) * 100)}<span class="u">%</span>`);
  txt('#o-zeros', `${e.comps.map((c, i) => `${CN[i]} ${sig((c.zeros / c.coef.length) * 100, 3)}`).join('・')} %`);
  const dc = sum((c) => c.dcBits),
    ac = sum((c) => c.acBits),
    eob = sum((c) => c.eobBits + c.zrlBits);
  html('#o-dc', ro(dc / 8, 'B'));
  txt('#o-dcs', `全体の ${sig((dc / bits) * 100, 3)} %`);
  html('#o-ac', ro(ac / 8, 'B'));
  txt('#o-acs', `全体の ${sig((ac / bits) * 100, 3)} %・うち EOB と ZRL ${sig((eob / bits) * 100, 3)} %`);
  const len = (nm: string) => e.segs.find((s) => s.name === nm)?.len ?? 0;
  html('#o-hd', bytesH(n - e.ecs));
  txt('#o-hds', `DQT ${len('DQT')}・DHT ${len('DHT')}・ほか ${n - e.ecs - len('DQT') - len('DHT')}`);
  html('#o-mcu', `${e.mx * e.my}<span class="u">個</span>`);
  txt('#o-mcus', `${8 * e.hmax}×${8 * e.vmax} 画素・Y ${e.hmax * e.vmax}、Cb 1、Cr 1 ブロック`);
  txt('#mS', bytesT(n));
  txt('#mB', sig(bits / px, 3));
  txt('#mP', Number.isFinite(r.psnrY) ? `${sig(r.psnrY)} dB` : '∞');
  txt('#iv-mcu', `${8 * e.hmax}×${8 * e.vmax}`);
  legend();
}

/* ---------- ブロックの符号化 ---------- */
const cells = (id: string) => $$<HTMLElement>(`#${id} > span`);
const MXS = {
  px: cells('mx-px'),
  dct: cells('mx-dct'),
  q: cells('mx-q'),
  s: cells('mx-s'),
  rec: cells('mx-rec'),
};
const ZZS = cells('zzs');
const MCU_CV = $<HTMLCanvasElement>('#cv-mcu');

/** 灰色の標本（実際の明るさ。テーマに依らない） */
function fillGray(cs: HTMLElement[], v: ArrayLike<number>): void {
  cs.forEach((s, i) => {
    s.textContent = String(v[i]);
    s.style.background = `rgb(${v[i]} ${v[i]} ${v[i]})`;
    s.style.color = v[i] > 140 ? '#111' : '#f4f4f4';
  });
}
/** 符号つきの値: 正は赤、負は青、0 は地の色。濃さは |x| の対数で、M で頭打ち */
const divBg = (x: number, M: number): string => {
  const r = Math.round(x);
  if (!r) return '';
  const t = Math.min(1, Math.log1p(Math.abs(x)) / Math.log1p(M));
  return `color-mix(in srgb,var(${x > 0 ? '--jp-pos' : '--jp-neg'}) ${Math.round(12 + t * 88)}%,var(--surface))`;
};
function fillDiv(cs: HTMLElement[], v: ArrayLike<number>, M: number): void {
  cs.forEach((s, i) => {
    s.textContent = int(v[i]);
    s.style.background = divBg(v[i], M);
    s.classList.toggle('z', Math.round(v[i]) === 0);
  });
}
/** 量子化テーブル: 大きいほど濃いインク色 */
function fillQ(cs: HTMLElement[], Q: ArrayLike<number>): void {
  cs.forEach((s, i) => {
    s.textContent = String(Q[i]);
    s.style.background = `color-mix(in srgb,var(--ink) ${Math.round((Math.log(Q[i]) / Math.log(255)) * 30)}%,var(--surface))`;
  });
}

/** 成分の選択（ブロックの枠の右上と、YCbCr の 3 面）をそろえる */
function syncComp(): void {
  for (const b of $$('.yc')) b.setAttribute('aria-pressed', String(b.dataset.c === comp$.value));
}
for (const b of $$<HTMLButtonElement>('.yc'))
  b.addEventListener('click', () => {
    const v = b.dataset.c ?? '0';
    if (v === comp$.value) return;
    $<HTMLButtonElement>(`#p-comp button[data-v="${v}"]`).click();
  });

/** 選んだブロックを含む MCU の範囲 [x, y, w, h] */
function mcuRect(): [number, number, number, number] {
  const e = R?.enc,
    hm = e?.hmax ?? 1,
    vm = e?.vmax ?? 1;
  return [Math.floor(sel[0] / hm) * 8 * hm, Math.floor(sel[1] / vm) * 8 * vm, 8 * hm, 8 * vm];
}

/** 1・2: MCU の画素（RGB）と、Y・Cb・Cr の 3 面 */
function drawMcu(): void {
  if (!img || !R) return;
  const e = R.enc,
    [x0, y0, mw, mh] = mcuRect(),
    sr = selRect(),
    rel = [sr[0] - x0, sr[1] - y0, sr[2], sr[3]];
  MCU_CV.width = mw;
  MCU_CV.height = mh;
  const o = new ImageData(mw, mh);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      const sx = Math.min(img.w - 1, x0 + x),
        sy = Math.min(img.h - 1, y0 + y),
        i = (sy * img.w + sx) * 4,
        j = (y * mw + x) * 4;
      o.data.set(img.rgba.subarray(i, i + 3), j);
      o.data[j + 3] = 255;
    }
  ctx2d(MCU_CV).putImageData(o, 0, 0);
  let g = '';
  for (let k = 8; k < mw; k += 8) g += `M${k} 0V${mh}`;
  for (let k = 8; k < mh; k += 8) g += `M0 ${k}H${mw}`;
  const marks = `<path class="g" d="${g}"/><rect class="o" x="${rel[0]}" y="${rel[1]}" width="${rel[2]}" height="${rel[3]}"/><rect class="i" x="${rel[0]}" y="${rel[1]}" width="${rel[2]}" height="${rel[3]}"/>`;
  const ov = $('#ov-mcu');
  ov.setAttribute('viewBox', `0 0 ${mw} ${mh}`);
  ov.innerHTML = marks;
  MCU_CV.style.aspectRatio = `${mw} / ${mh}`;
  txt('#cap1', `MCU ${mw}×${mh} 画素・左上 (${x0}, ${y0})`);

  e.comps.forEach((c, k) => {
    const fx = e.hmax / c.h,
      fy = e.vmax / c.v,
      w = mw / fx,
      h = mh / fy,
      px0 = x0 / fx,
      py0 = y0 / fy,
      cvs = $<HTMLCanvasElement>(`#cv-c${k}`),
      im = new ImageData(w, h);
    cvs.width = w;
    cvs.height = h;
    cvs.style.aspectRatio = `${mw} / ${mh}`;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = c.plane.d[(py0 + y) * c.plane.w + px0 + x],
          rgb = k === 0 ? [v, v, v] : k === 1 ? yccToRgb(128, v, 128) : yccToRgb(128, 128, v),
          j = (y * w + x) * 4;
        im.data[j] = rgb[0];
        im.data[j + 1] = rgb[1];
        im.data[j + 2] = rgb[2];
        im.data[j + 3] = 255;
      }
    ctx2d(cvs).putImageData(im, 0, 0);
    const svg = $(`#ov-c${k}`);
    svg.setAttribute('viewBox', `0 0 ${mw} ${mh}`);
    let gg = '';
    for (let q = 8 * fx; q < mw; q += 8 * fx) gg += `M${q} 0V${mh}`;
    for (let q = 8 * fy; q < mh; q += 8 * fy) gg += `M0 ${q}H${mw}`;
    svg.innerHTML =
      `<path class="g" d="${gg}"/>` +
      (k === ci()
        ? `<rect class="o" x="${rel[0]}" y="${rel[1]}" width="${rel[2]}" height="${rel[3]}"/><rect class="i" x="${rel[0]}" y="${rel[1]}" width="${rel[2]}" height="${rel[3]}"/>`
        : '');
  });
  const cs = e.comps[1];
  txt(
    '#cap2',
    e.hmax === 1 && e.vmax === 1
      ? '4:4:4。Cb・Cr も Y と同じ数の標本'
      : `${SUBS.find((s) => s[0] === e.opts.sub)?.[1]}。Cb・Cr は ${8 * cs.h}×${8 * cs.v}（${e.hmax === 2 ? '横' : ''}${e.vmax === 2 ? '縦' : ''} 1/2）`,
  );
}

/** 1・2 の読み値: MCU の中の画素 (x, y) の RGB と YCbCr */
function readMcu(p: [number, number] | null): void {
  if (!img || !R) return;
  const e = R.enc;
  if (!p) {
    txt('#rd1', '');
    txt('#rd2', '');
    return;
  }
  const [x0, y0] = mcuRect(),
    sx = Math.min(img.w - 1, x0 + p[0]),
    sy = Math.min(img.h - 1, y0 + p[1]),
    i = (sy * img.w + sx) * 4,
    [r, g, b] = [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]],
    [Y, Cb, Cr] = rgbToYcc(r, g, b);
  html('#rd1', `(${x0 + p[0]}, ${y0 + p[1]}) R <b>${r}</b> G <b>${g}</b> B <b>${b}</b>`);
  const at = (k: number) => {
    const c = e.comps[k],
      fx = e.hmax / c.h,
      fy = e.vmax / c.v;
    return c.plane.d[Math.floor((y0 + p[1]) / fy) * c.plane.w + Math.floor((x0 + p[0]) / fx)];
  };
  html(
    '#rd2',
    `Y <b>${at(0)}</b> Cb <b>${at(1)}</b> Cr <b>${at(2)}</b>` +
      (e.hmax > 1 || e.vmax > 1
        ? `（間引く前 ${fix(Cb, 1)}・${fix(Cr, 1)}）`
        : `（${fix(Y, 1)}・${fix(Cb, 1)}・${fix(Cr, 1)}）`),
  );
}
MCU_CV.parentElement?.addEventListener('pointermove', (e) => {
  const [, , mw, mh] = mcuRect();
  readMcu(posIn(MCU_CV, e, mw, mh));
});
MCU_CV.parentElement?.addEventListener('pointerdown', (e) => {
  const [x0, y0, mw, mh] = mcuRect(),
    p = posIn(MCU_CV, e, mw, mh);
  if (p) select((x0 + p[0]) >> 3, (y0 + p[1]) >> 3);
});
MCU_CV.parentElement?.addEventListener('pointerleave', () => readMcu(null));
for (const pv of $$('.yc .pv'))
  pv.addEventListener('pointermove', (e) => {
    const [, , mw, mh] = mcuRect();
    readMcu(posIn(pv, e, mw, mh));
  });
for (const pv of $$('.yc .pv')) pv.addEventListener('pointerleave', () => readMcu(null));

const ZZM = $$<SVGRectElement>('#zzm-c rect');
/** 9: ジグザグの順路と、ジグザグ順の 64 個 */
function fillZigzag(b: BlockInfo): void {
  const pts = ZIGZAG.map((n) => `${(n % 8) + 0.5} ${(n >> 3) + 0.5}`),
    last = Math.max(0, b.last);
  $('#zz-a').setAttribute('d', `M${pts.slice(0, last + 1).join('L')}`);
  $('#zz-b').setAttribute('d', last < 63 ? `M${pts.slice(last).join('L')}` : '');
  ZZM.forEach((r, i) => {
    r.style.fill = divBg(b.S[i], 64) || '';
  });
  ZZS.forEach((s, k) => {
    const v = b.S[ZIGZAG[k]];
    $('b', s).textContent = int(v);
    s.style.background = k > b.last ? '' : divBg(v, 64);
    s.classList.toggle('z', v === 0);
    s.classList.toggle('eob', k > b.last);
  });
  txt(
    '#cap9',
    b.last >= 63
      ? '最後の係数まで 0 でないため、EOB を使わない'
      : b.last < 0
        ? 'すべて 0。DC の差分の後はすぐ EOB'
        : `0 でない最後の係数はジグザグ ${b.last} 番。残りの ${b.last + 1}〜63 番の ${63 - b.last} 個は EOB 1 つで表す`,
  );
}
/** 記号が受け持つジグザグ順の範囲 */
function span(s: BlockInfo['syms'][number]): [number, number] {
  if (s.kind === 'dc') return [0, 0];
  if (s.kind === 'eob') return [s.k, 63];
  if (s.kind === 'zrl') return [s.k - 15, s.k];
  return [s.k - s.run, s.k];
}
/** 10: 記号の表とビット列 */
function fillSyms(b: BlockInfo): void {
  const kindT = { dc: 'DC', ac: 'AC', zrl: 'ZRL', eob: 'EOB' } as const;
  const rows = b.syms.map((s) => {
    const [a, z] = span(s),
      pos = a === z ? String(a) : `${a}–${z}`,
      val =
        s.kind === 'dc'
          ? `${int(s.val)} <small>= ${int(b.S[0])} − ${b.pred < 0 ? `(${int(b.pred)})` : int(b.pred)}</small>`
          : s.kind === 'ac'
            ? int(s.val)
            : `<small>0 ×${z - a + 1}</small>`,
      rs =
        s.kind === 'dc' ? String(s.size) : `${s.run.toString(16).toUpperCase()}/${s.size.toString(16).toUpperCase()}`;
    return `<tr data-a="${a}" data-b="${z}"><td>${pos}</td><td>${kindT[s.kind]}</td><td>${val}</td><td title="記号 0x${s.sym.toString(16).toUpperCase().padStart(2, '0')}">${rs}</td><td class="cd"><b>${s.code}</b>${s.extra}</td><td>${s.code.length + s.extra.length}</td></tr>`;
  });
  $('#sym tbody').innerHTML = rows.join('');
  html(
    '#bs',
    b.syms
      .map((s) => {
        const [a, z] = span(s);
        return `<span data-a="${a}" data-b="${z}"><b>${s.code}</b>${s.extra}</span>`;
      })
      .join(''),
  );
  const c = R?.enc.comps[b.ci];
  html(
    '#cap10',
    `DC の予測 ${int(b.pred)}（走査の順で 1 つ前の ${CN[b.ci]} のブロックの DC${b.pred === 0 && !b.bx && !b.by ? '。先頭なので 0' : ''}）・${c?.t ? '色差' : '輝度'}の表・合計 <b>${b.bits}</b> ビット。符号の太字はハフマン符号、細字は付加ビット`,
  );
}

function renderBlock(): void {
  if (!R || !img) return;
  const e = R.enc,
    k = ci(),
    c = e.comps[k],
    [bx, by] = compBlock(e, k, sel[0], sel[1]),
    b = blockInfo(e, k, bx, by);
  B = b;
  txt('#bk-pos', `${CN[k]} (${bx}, ${by})`);
  txt('#bk-mcu', `(${Math.floor(bx / c.h)}, ${Math.floor(by / c.v)})`);
  const qs = qualityScale(e.opts.q);
  txt('#bk-q', `${e.opts.q} · ${qs} %`);
  txt('#bk-bits', String(b.bits));
  drawMcu();
  fillGray(MXS.px, b.px);
  fillDiv(MXS.dct, b.F, 1024);
  fillQ(MXS.q, b.Q);
  fillDiv(MXS.s, b.S, 64);
  fillGray(MXS.rec, b.rec);
  const mean = b.px.reduce((s, v) => s + v, 0) / 64;
  let maxE = 0;
  for (let i = 0; i < 64; i++) maxE = Math.max(maxE, Math.abs(b.rec[i] - b.px[i]));
  const tName = e.opts.qt === 'flat' ? '平坦な表' : c.t ? 'K.2（色差）' : 'K.1（輝度）';
  txt('#cap3', `${CN[k]} の標本。DCT の前に 128 を引く`);
  html('#cap4', '<i>F</i>(<i>u</i>, <i>v</i>)。横が <i>u</i>、縦が <i>v</i>（整数に丸めて表示）');
  txt('#cap5', `${tName} を ${qs} % にしたもの`);
  html('#cap6', `<i>F</i>/<i>Q</i> を丸めたもの。0 でない係数 ${b.nz} 個`);
  txt('#cap7', `逆量子化と逆 DCT で戻したもの。元との差は最大 ${maxE}`);
  fillZigzag(b);
  fillSyms(b);
  defaults = {
    rd3: `平均 ${sig(mean)}`,
    rd4: `DC <b>${fix(b.F[0])}</b> = 8 × (${sig(mean)} − 128)`,
    rd5: '',
    rd6: '',
    rd7: '',
    rd8: '',
    rd9: '',
  };
  updateHover();
  readPx(null);
}

/* 触れた係数・画素を、すべての表で囲み、読み値を出す */
type Hv = { t: 'c' | 'p'; i: number } | null;
let hv: Hv = null,
  defaults: Record<string, string> = {};
function setHv(h: Hv): void {
  if (h?.t === hv?.t && h?.i === hv?.i) return;
  hv = h;
  updateHover();
}
function updateHover(): void {
  const b = B,
    c = hv?.t === 'c' ? hv.i : -1,
    p = hv?.t === 'p' ? hv.i : -1,
    k = c >= 0 ? ZZ_OF[c] : -1;
  const mark = (cs: HTMLElement[], j: number) => {
    cs.forEach((s, i) => {
      s.classList.toggle('hv', i === j);
    });
  };
  for (const cs of [MXS.dct, MXS.q, MXS.s]) mark(cs, c);
  for (const cs of [MXS.px, MXS.rec]) mark(cs, p);
  mark(ZZS, k);
  ZZM.forEach((r, i) => {
    r.classList.toggle('hv', i === c);
  });
  for (const el of $$<HTMLElement>('#sym tbody tr, #bs span'))
    el.classList.toggle('hv', k >= 0 && Number(el.dataset.a) <= k && k <= Number(el.dataset.b));
  const bh = $('#bas-h');
  bh.classList.toggle('off', c < 0);
  if (c >= 0) rectAttr(bh, [(c % 8) * (T + GAP) + GAP / 2, (c >> 3) * (T + GAP) + GAP / 2, T + GAP, T + GAP]);
  const out: Record<string, string> = { ...defaults };
  if (b && c >= 0) {
    const u = c % 8,
      v = c >> 3,
      uv = `(${u}, ${v})`;
    out.rd4 = `<i>F</i>${uv} = <b>${fix(b.F[c])}</b>`;
    out.rd5 = `<i>Q</i>${uv} = <b>${b.Q[c]}</b>`;
    out.rd6 = `${fix(b.F[c])} / ${b.Q[c]} = ${fix(b.F[c] / b.Q[c], 3)} → <b>${int(b.S[c])}</b>`;
    out.rd8 = `基底 ${uv} · 重み <b>${fix(b.F[c])}</b>`;
    out.rd9 = `ジグザグ <b>${k}</b> 番 = ${uv} · <b>${int(b.S[c])}</b>`;
  }
  if (b && p >= 0) {
    const xy = `(${p % 8}, ${p >> 3})`;
    out.rd3 = `<i>f</i>${xy} = <b>${b.px[p]}</b>（−128 で ${int(b.px[p] - 128)}）`;
    out.rd7 = `${xy} = <b>${b.rec[p]}</b>（差 ${int(b.rec[p] - b.px[p])}）`;
  }
  for (const [id, s] of Object.entries(out)) html(`#${id}`, s);
}
function bindHover(el: HTMLElement, t: 'c' | 'p', idx: (target: Element) => number): void {
  el.addEventListener('pointerover', (e) => {
    const i = idx(e.target as Element);
    if (i >= 0) setHv({ t, i });
  });
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') setHv(null);
  });
}
const cellIdx = (cs: HTMLElement[]) => (t: Element) => cs.indexOf(t.closest('span') as HTMLElement);
for (const [key, cs] of Object.entries(MXS)) {
  const parent = cs[0]?.parentElement;
  if (parent) bindHover(parent, key === 'px' || key === 'rec' ? 'p' : 'c', cellIdx(cs));
}
bindHover($('#zzm'), 'c', (t) => ZZM.indexOf(t as SVGRectElement));
bindHover($('#zzs'), 'c', (t) => {
  const k = ZZS.indexOf(t.closest('#zzs > span') as HTMLElement);
  return k >= 0 ? ZIGZAG[k] : -1;
});
bindHover($('#sym'), 'c', (t) => {
  const tr = t.closest<HTMLElement>('tbody tr');
  return tr ? ZIGZAG[Number(tr.dataset.a)] : -1;
});
bindHover($('#bs'), 'c', (t) => {
  const sp = t.closest<HTMLElement>('#bs > span');
  return sp ? ZIGZAG[Number(sp.dataset.a)] : -1;
});

/* 8: DCT の基底（1 度だけ描く。白が正、黒が負） */
{
  const c = $<HTMLCanvasElement>('#cv-bas'),
    x = ctx2d(c),
    n = 8 * T + 9 * GAP;
  c.width = n;
  c.height = n;
  const im = x.createImageData(n, n),
    s = T / 8;
  for (let v = 0; v < 8; v++)
    for (let u = 0; u < 8; u++) {
      const b = basis(u, v),
        m = Math.max(...Array.from(b, Math.abs));
      for (let py = 0; py < T; py++)
        for (let px = 0; px < T; px++) {
          const g = Math.round(128 + (127 * b[Math.floor(py / s) * 8 + Math.floor(px / s)]) / m),
            X = GAP + u * (T + GAP) + px,
            Y = GAP + v * (T + GAP) + py,
            j = (Y * n + X) * 4;
          im.data[j] = im.data[j + 1] = im.data[j + 2] = g;
          im.data[j + 3] = 255;
        }
    }
  x.putImageData(im, 0, 0);
  const pic = c.parentElement as HTMLElement;
  pic.addEventListener('pointermove', (e) => {
    const p = posIn(c, e, n, n);
    if (!p) return;
    const u = Math.min(7, Math.floor((p[0] - GAP / 2) / (T + GAP))),
      v = Math.min(7, Math.floor((p[1] - GAP / 2) / (T + GAP)));
    if (u >= 0 && v >= 0) setHv({ t: 'c', i: v * 8 + u });
  });
  pic.addEventListener('pointerdown', (e) => {
    const p = posIn(c, e, n, n);
    if (!p) return;
    const u = Math.min(7, Math.floor(p[0] / (T + GAP))),
      v = Math.min(7, Math.floor(p[1] / (T + GAP)));
    setHv({ t: 'c', i: v * 8 + u });
  });
  pic.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') setHv(null);
  });
}

/* ---------- ファイルの構成 ---------- */
function renderFile(): void {
  if (!R) return;
  const e = R.enc,
    hx = (a: Uint8Array) => Array.from(a, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    hn = HUFFS.find((h) => h[0] === e.opts.huff)?.[1] ?? '';
  const desc: Record<string, string> = {
    SOI: '画像の始まり',
    APP0: 'JFIF 1.02。画素の縦横比 1:1',
    DQT: '量子化テーブル 2 個（8 ビット、ジグザグ順）',
    SOF0: `ベースライン。${e.w}×${e.h}、3 成分（Y ${e.hmax}×${e.vmax}、Cb 1×1、Cr 1×1）`,
    DHT: `ハフマン表 4 個（${hn}。DC と AC の輝度・色差）`,
    SOS: 'スキャンの開始。3 成分を MCU ごとに混ぜる',
    ECS: `符号化したデータ。0xFF の後に挟んだ 0x00 が ${e.stuffed} 個、最後の ${e.pad} ビットは 1 で埋める`,
    EOI: '画像の終わり',
  };
  $('#segs tbody').innerHTML = e.segs
    .map((s) => {
      const head = e.bytes.subarray(s.off, s.off + Math.min(s.len, 12));
      return `<tr><td>${s.name === 'ECS' ? '（データ）' : s.name}</td><td>${s.off}</td><td>${s.len}</td><td>${desc[s.name] ?? ''}</td><td>${hx(head)}${s.len > 12 ? ' …' : ''}</td></tr>`;
    })
    .join('');
  const nm = ['DC 輝度', 'AC 輝度', 'DC 色差', 'AC 色差'];
  html(
    '#hts',
    [e.dc[0], e.ac[0], e.dc[1], e.ac[1]]
      .map((t, i) => `<p><b>${nm[i]}</b> 長さ 1〜16 の符号の数 ${t.bits.join(' ')} · 記号 ${t.vals.length} 個</p>`)
      .join(''),
  );
}

/* ---------- 動作原理と式 ---------- */
function renderSubst(): void {
  if (!R) return;
  const q = R.enc.opts.q,
    s = qualityScale(q),
    base = (R.enc.opts.qt === 'flat' ? FLAT : K1)[0];
  html('#subst', substHtml(q, s, base, R.enc.qt[0][0]));
}

/* ---------- 入力元 ---------- */
function sampleImage(): Img {
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
    name: 'sample',
  };
}
function setImage(i: Img, at: [number, number]): void {
  img = i;
  R = null;
  B = null;
  sel = at;
  clampSel();
  $<HTMLButtonElement>('#saveBtn').disabled = true;
  txt('#iv-sz', `${i.w}×${i.h}`);
  fitView();
  if (worker) sendImg(i);
  drawMain();
  drawOverlay();
  drawZoom();
  request();
}
function setSrc(v: string): void {
  $('#in-tab').dataset.src = v;
  if (v === 'sample') {
    sampleImg ??= sampleImage();
    setImage(sampleImg, [SAMPLE_BLOCK[0], SAMPLE_BLOCK[1]]);
  } else if (fileImg) setImage(fileImg, [fileImg.w >> 4, fileImg.h >> 4]);
  else fin.click();
}
const fin = $<HTMLInputElement>('#fileIn');
async function loadFile(f: File | undefined): Promise<void> {
  if (!f) return;
  const m = $('#m-file');
  m.className = 'msg';
  m.textContent = '読み込んでいます…';
  try {
    const bmp = await createImageBitmap(f),
      W = bmp.width,
      H = bmp.height,
      s = Math.min(1, MAX_SIDE / Math.max(W, H)),
      w = Math.max(1, Math.round(W * s)),
      h = Math.max(1, Math.round(H * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = ctx2d(c);
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    x.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    fileImg = {
      id: ++nextImg,
      w,
      h,
      rgba: x.getImageData(0, 0, w, h).data,
      name: f.name.replace(/\.[^.]*$/, '') || 'image',
    };
    m.textContent = `${f.name} · ${W}×${H}${s < 1 ? ` を ${w}×${h} に縮小` : ''}`;
    src$.set('file');
    $('#in-tab').dataset.src = 'file';
    setImage(fileImg, [w >> 4, h >> 4]);
  } catch {
    m.className = 'msg er';
    m.textContent = `${f.name} を画像として読めませんでした`;
  }
}
$('#fileBtn').addEventListener('click', () => fin.click());
fin.addEventListener('change', () => {
  void loadFile(fin.files?.[0]);
  fin.value = '';
});
for (const pnl of [$('.a-in'), $('.a-img')]) {
  pnl.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    pnl.classList.add('drop');
  });
  pnl.addEventListener('dragleave', (e) => {
    if (!pnl.contains(e.relatedTarget as Node | null)) pnl.classList.remove('drop');
  });
  pnl.addEventListener('drop', (e) => {
    e.preventDefault();
    pnl.classList.remove('drop');
    void loadFile(e.dataTransfer?.files[0]);
  });
}

/* ---------- 保存 ---------- */
$('#saveBtn').addEventListener('click', () => {
  if (!R || !img) return;
  const o = R.enc.opts,
    a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([R.enc.bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
  a.download = `${img.name}-q${o.q}-${o.sub}${o.qt === 'flat' ? '-flat' : ''}${o.huff === 'opt' ? '-opt' : ''}.jpg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

/* ---------- 始める ---------- */
syncComp();
sampleImg = sampleImage();
setImage(sampleImg, [SAMPLE_BLOCK[0], SAMPLE_BLOCK[1]]);

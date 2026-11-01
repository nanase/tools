/**
 * デモザイクのページの入口: テスト画像（か手持ちの画像）をベイヤー配列で 1 画素 1 色にし、選んだ手法で復元して描く。
 * 押した画素は拡大鏡に映し、その画素で足りない色をどう求めたかを「画素の計算」に出す。
 * 「手法の比較」の表は 6 手法をすべて計算して、少しずつ埋める
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { initToolPage } from '../../lib/tool-page';
import { CHART_H as H, makeChart, TILE, CHART_W as W } from './chart';
import {
  ahdSteps,
  blur,
  type Ch,
  cfaColor,
  DIRS,
  demosaic,
  haDirections,
  haGrad,
  METHODS,
  type Method,
  MHC,
  type Mosaic,
  medianChroma,
  mhcKernel,
  mosaic,
  newRgb,
  type Pattern,
  type Rgb,
  reflect,
  type Score,
  score,
  srgbToLab,
  vngPixel,
} from './demosaic';
import { LOUPE, LP_SIGMA, MED_TIMES, methodTitle, type SrcName, type View } from './params';

initToolPage();

const CN = ['R', 'G', 'B'] as const;
const S = {
  src: 'chart' as SrcName,
  pat: 'RGGB' as Pattern,
  lp: false,
  med: false,
  view: 'out' as View,
  method: 'ahd' as Method,
  /* 押した画素。初めは柵の杭の縁 */
  px: 20,
  py: 84,
  /** 「画素の計算」で求める色（-1 なら G か最初の足りない色） */
  tgt: -1,
};

/* ---------- 画像 ---------- */
/** 文字の区画（128 × 128）をキャンバスで描く */
function textTile(): Rgb | undefined {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TILE;
  const g = cv.getContext('2d');
  if (!g) return undefined;
  const font = (wt: number, px: number) =>
    `${wt} ${px}px system-ui,"Segoe UI","Hiragino Sans","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif`;
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, TILE, TILE);
  g.fillStyle = '#111';
  g.font = font(700, 30);
  g.fillText('RAW', 6, 32);
  g.font = font(500, 15);
  g.fillText('デモザイク', 6, 54);
  g.font = font(400, 10);
  g.fillText('Bayer CFA 0123456789', 6, 70);
  g.fillStyle = '#1d3fbf';
  g.fillRect(0, 80, TILE, 26);
  g.fillStyle = '#ff2a2a';
  g.font = font(700, 18);
  g.fillText('色の縁 RGB', 6, 100);
  g.fillStyle = '#111';
  g.font = font(400, 8);
  g.fillText('The quick brown fox jumps', 6, 120);
  return fromRGBA(g.getImageData(0, 0, TILE, TILE).data, TILE, TILE);
}
function fromRGBA(d: Uint8ClampedArray, w: number, h: number): Rgb {
  const o = newRgb(w, h);
  for (let i = 0; i < w * h; i++) {
    o.r[i] = d[4 * i] / 255;
    o.g[i] = d[4 * i + 1] / 255;
    o.b[i] = d[4 * i + 2] / 255;
  }
  return o;
}
let CHART: Rgb | null = null;
let OWN: Rgb | null = null;
/** 元の画像が変わるたびに増やす（控えの鍵に入れる） */
let gen = 0;
function base(): Rgb {
  if (S.src === 'own' && OWN) return OWN;
  if (!CHART) CHART = makeChart(textTile());
  return CHART;
}

/* ---------- 計算の控え ---------- */
const memo = new Map<string, unknown>();
function keep<T>(k: string, f: () => T): T {
  const key = `${gen}|${S.pat}|${S.lp}|${S.med}|${k}`;
  let v = memo.get(key) as T | undefined;
  if (v === undefined) {
    v = f();
    memo.set(key, v);
  }
  return v;
}
const src = () => keep('src', () => (S.lp ? blur(base(), LP_SIGMA) : base()));
const mos = () => keep<Mosaic>('mos', () => mosaic(src(), S.pat));
const raw = (k: Method) => keep(`raw|${k}`, () => demosaic(mos(), k));
const out = (k: Method) => keep(`out|${k}`, () => (S.med ? medianChroma(mos(), raw(k), MED_TIMES) : raw(k)));
const sc = (k: Method) => keep<Score>(`sc|${k}`, () => score(src(), out(k)));
const ahdInfo = () => keep('ahd-steps', () => ahdSteps(mos()));
const haDir = () => keep('ha-dir', () => haDirections(mos()));
function clearMemo(): void {
  memo.clear();
}

/* ---------- 描画 ---------- */
const cv = $<HTMLCanvasElement>('#cv'),
  g = cv.getContext('2d'),
  lc = $<HTMLCanvasElement>('#lc'),
  lg = lc.getContext('2d'),
  stage = $('#st'),
  loupe = $('#lp');
/** 表示する画像をキャンバスの大きさの ImageData にする */
function pixels(v: View): ImageData {
  return keep(`img|${v}|${S.method}`, () => {
    const id = new ImageData(W, H),
      d = id.data;
    if (v === 'mos') {
      const m = mos();
      for (let i = 0; i < m.v.length; i++) {
        d[4 * i + m.c[i]] = m.v[i] * 255;
        d[4 * i + 3] = 255;
      }
      return id;
    }
    const a = v === 'src' ? src() : out(S.method);
    const b = v === 'err' ? src() : null;
    for (let i = 0; i < W * H; i++) {
      if (b) {
        d[4 * i] = Math.abs(a.r[i] - b.r[i]) * 4 * 255;
        d[4 * i + 1] = Math.abs(a.g[i] - b.g[i]) * 4 * 255;
        d[4 * i + 2] = Math.abs(a.b[i] - b.b[i]) * 4 * 255;
      } else {
        d[4 * i] = a.r[i] * 255;
        d[4 * i + 1] = a.g[i] * 255;
        d[4 * i + 2] = a.b[i] * 255;
      }
      d[4 * i + 3] = 255;
    }
    return id;
  });
}
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#bf4308';
function paint(): void {
  const id = pixels(S.view);
  g?.putImageData(id, 0, 0);
  drawLoupe(id);
}
/** 拡大鏡: 押した画素の周り 16 × 16 を、画素の格子と押した画素の枠を付けて描く */
function drawLoupe(id: ImageData): void {
  if (!lg) return;
  const n = LOUPE,
    s = lc.width / n,
    x0 = S.px - (n >> 1),
    y0 = S.py - (n >> 1);
  lg.fillStyle = '#000';
  lg.fillRect(0, 0, lc.width, lc.height);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const X = x0 + x,
        Y = y0 + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const i = 4 * (Y * W + X);
      lg.fillStyle = `rgb(${id.data[i]},${id.data[i + 1]},${id.data[i + 2]})`;
      lg.fillRect(x * s, y * s, s, s);
    }
  lg.strokeStyle = 'rgba(128,128,128,.35)';
  lg.lineWidth = 1;
  lg.beginPath();
  for (let i = 1; i < n; i++) {
    lg.moveTo(i * s + 0.5, 0);
    lg.lineTo(i * s + 0.5, lc.height);
    lg.moveTo(0, i * s + 0.5);
    lg.lineTo(lc.width, i * s + 0.5);
  }
  lg.stroke();
  lg.strokeStyle = accent();
  lg.lineWidth = 2;
  lg.strokeRect((n >> 1) * s + 1, (n >> 1) * s + 1, s - 2, s - 2);
  placeLoupe();
}
/** 拡大鏡は押した画素の右に置き、はみ出すなら左へ */
function placeLoupe(): void {
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const sx = r.width / W,
    lw = loupe.offsetWidth || 172,
    lh = loupe.offsetHeight || 172;
  const x = (S.px + 0.5) * sx,
    y = (S.py + 0.5) * sx,
    gap = Math.max(16, sx * 3);
  loupe.style.left = `${x + gap + lw > r.width ? Math.max(0, x - gap - lw) : x + gap}px`;
  loupe.style.top = `${Math.min(Math.max(0, y - lh / 2), Math.max(0, r.height - lh))}px`;
}

/* ---------- 結果の帯 ---------- */
const fmt = (v: number) => (v === Infinity ? '∞' : v.toFixed(1));
function status(): void {
  const s = sc(S.method);
  $('#s-name').textContent = methodTitle(S.method);
  $('#s-ps').textContent = `${fmt(s.cpsnr)} dB`;
  $('#s-de').textContent = s.de.toFixed(2);
}

/* ---------- 画素の計算 ---------- */
const b8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
const sw = (c: readonly number[]) => `<i class="dm-sw" style="background:rgb(${c.map(b8).join(',')})"></i>`;
const tgtEl = $('#p-tgt'),
  sten = $('#sten'),
  ex = $('#ex'),
  cmpSvg = $<SVGSVGElement>('#cmpss'),
  cmpW = $('#cmpw');
sten.innerHTML = Array.from(
  { length: 25 },
  () => '<div class="dm-c"><span class="cn"></span><span class="cv"></span><span class="cw"></span></div>',
).join('');
const cells = $$('.dm-c', sten);
tgtEl.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (!b) return;
  S.tgt = Number(b.dataset.v);
  calc();
});

function calc(): void {
  const m = mos(),
    k = S.method,
    { px, py } = S,
    i = py * W + px,
    own = m.c[i] as Ch;
  const miss = ([0, 1, 2] as Ch[]).filter((c) => c !== own);
  if (!miss.includes(S.tgt as Ch)) S.tgt = miss.includes(1) ? 1 : miss[0];
  const t = S.tgt as Ch,
    nm = CN[t];
  tgtEl.innerHTML = miss
    .map((c) => `<button type="button" data-v="${c}" aria-pressed="${c === t}">${CN[c]} を求める</button>`)
    .join('');
  $('#o-px').textContent = `(${px}, ${py}) · ${CN[own]} の画素`;
  const at = (dx: number, dy: number) => {
    const j = reflect(py + dy, H) * W + reflect(px + dx, W);
    return { c: m.c[j] as Ch, v: m.v[j] };
  };
  /* 使う画素の印と、その上に書く係数 */
  const use = new Map<string, string>();
  const key = (dx: number, dy: number) => `${dx},${dy}`;
  const lines: string[] = [];
  const o = out(k),
    res = [o.r[i], o.g[i], o.b[i]];
  const r0 = raw(k),
    resRaw = [r0.r[i], r0.g[i], r0.b[i]];
  cmpW.hidden = true;
  const eq = (s: string) => lines.push(`<span class="eq">${s}</span>`);
  if (k === 'nearest') {
    let dx = 0,
      dy = 0;
    if (t === 1) dx = (px ^ 1) - px;
    else
      for (let j = 0; j < 4; j++) {
        const xx = (px & ~1) + (j & 1),
          yy = (py & ~1) + (j >> 1);
        if (cfaColor(S.pat, xx, yy) === t) {
          dx = xx - px;
          dy = yy - py;
          break;
        }
      }
    use.set(key(dx, dy), '');
    eq(`${nm} = <b>${b8(resRaw[t])}</b>`);
    lines.push('<span class="dm-aux">同じ 2 × 2 の区画の値</span>');
  } else if (k === 'bilinear') {
    const vs: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && at(dx, dy).c === t) {
          use.set(key(dx, dy), '');
          vs.push(b8(at(dx, dy).v));
        }
    eq(`${nm} = (${vs.join(' + ')}) / ${vs.length} = <b>${b8(resRaw[t])}</b>`);
  } else if (k === 'mhc') {
    const kn = mhcKernel(m, px, py, t);
    if (kn) {
      const c = MHC[kn];
      for (let j = 0; j < 25; j++) if (c[j]) use.set(key((j % 5) - 2, Math.floor(j / 5) - 2), String(c[j]));
    }
    eq(`${nm} = Σ 係数 × 値 / 8 = <b>${b8(resRaw[t])}</b>`);
  } else if (k === 'ha') {
    if (t === 1) {
      const gr = haGrad(m, px, py),
        d = haDir()[i];
      for (const dd of [-2, -1, 1, 2]) {
        if (d & 1) use.set(key(dd, 0), '');
        if (d & 2) use.set(key(0, dd), '');
      }
      eq(`Δ<sub>横</sub> = <b>${b8(gr.h)}</b>　Δ<sub>縦</sub> = <b>${b8(gr.v)}</b>`);
      eq(`→ ${d === 1 ? '横' : d === 2 ? '縦' : '平均'}　G = <b>${b8(resRaw[1])}</b>`);
    } else {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(dx, dy).c === t) use.set(key(dx, dy), '');
      eq(`${nm} = G + (${nm} − G の平均) = <b>${b8(resRaw[t])}</b>`);
    }
  } else if (k === 'vng') {
    const info = vngPixel(m, px, py);
    for (const d of info.sel) {
      const [, dy, dx] = DIRS[d];
      use.set(key(dx, dy), '');
    }
    const mx = Math.max(...info.grad, 1e-6),
      R = 44;
    let bars = '';
    info.grad.forEach((gv, d) => {
      const [nmD, dy, dx] = DIRS[d],
        n = Math.hypot(dx, dy),
        l = 8 + (gv / mx) * R,
        on = info.sel.includes(d) ? ' on' : '';
      bars += `<line x1="60" y1="60" x2="${(60 + (dx / n) * l).toFixed(1)}" y2="${(60 + (dy / n) * l).toFixed(1)}" class="cb${on}"/>`;
      bars += `<text x="${(60 + (dx / n) * 56).toFixed(1)}" y="${(63 + (dy / n) * 54).toFixed(1)}" class="cl${on}">${nmD}</text>`;
    });
    cmpSvg.innerHTML = `<circle cx="60" cy="60" r="${(8 + (info.t / mx) * R).toFixed(1)}" class="ct"/>${bars}`;
    cmpW.hidden = false;
    eq(`閾値 T = <b>${b8(info.t)}</b>`);
    eq(`T 以下の ${info.sel.length} 方向　${nm} = <b>${b8(resRaw[t])}</b>`);
  } else {
    const s = ahdInfo(),
      d = s.dir[i];
    for (const dd of [-2, -1, 1, 2]) {
      if (d & 1) use.set(key(dd, 0), '');
      if (d & 2) use.set(key(0, dd), '');
    }
    eq(`横 ${sw([s.h.r[i], s.h.g[i], s.h.b[i]])} 均質 <b>${s.hh[i]}</b>`);
    eq(`縦 ${sw([s.v.r[i], s.v.g[i], s.v.b[i]])} 均質 <b>${s.hv[i]}</b>`);
    eq(`→ ${d === 1 ? '横' : d === 2 ? '縦' : '平均'}　${nm} = <b>${b8(resRaw[t])}</b>`);
  }
  if (S.med) lines.push(`<span class="eq">色差メディアン → <b>${b8(res[t])}</b></span>`);
  const s0 = src(),
    ref = [s0.r[i], s0.g[i], s0.b[i]];
  const l1 = srgbToLab(ref[0], ref[1], ref[2]),
    l2 = srgbToLab(res[0], res[1], res[2]);
  const de = Math.hypot(l1[0] - l2[0], l1[1] - l2[1], l1[2] - l2[2]);
  lines.push(`<span class="eq dm-res">元 ${sw(ref)} 復元 ${sw(res)} ΔE <b>${de.toFixed(1)}</b></span>`);
  ex.innerHTML = lines.join('');
  let j = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const a = at(dx, dy),
        v = b8(a.v),
        u = use.get(key(dx, dy)),
        el = cells[j++];
      el.style.background = a.c === 0 ? `rgb(${v},0,0)` : a.c === 1 ? `rgb(0,${v},0)` : `rgb(0,0,${v})`;
      el.className = `dm-c${dx === 0 && dy === 0 ? ' cen' : u !== undefined ? ' use' : ' dim'}`;
      (el.children[0] as HTMLElement).textContent = CN[a.c];
      (el.children[1] as HTMLElement).textContent = String(v);
      (el.children[2] as HTMLElement).textContent = u ?? '';
    }
}

/* ---------- 比較の表 ---------- */
const rows = $$<HTMLTableRowElement>('#cmp tbody tr');
let tableJob = 0;
/** 6 手法を 1 つずつ計算して表を埋める（間に描画をはさむ） */
function fillTable(): void {
  const job = ++tableJob;
  for (const r of rows) r.classList.toggle('sel', r.dataset.v === S.method);
  const step = (n: number) => {
    if (job !== tableJob) return;
    if (n < METHODS.length) {
      sc(METHODS[n]);
      setTimeout(() => step(n + 1), 0);
      return;
    }
    /* 棒は最も悪い手法より 3 dB 下を 0 にして、差を見やすくする */
    const all = METHODS.map((k) => sc(k)),
      fin = all.map((s) => s.cpsnr).filter((v) => v < Infinity),
      hi = Math.max(...fin, 1),
      lo = Math.min(...fin, hi) - 3;
    rows.forEach((r, j) => {
      const s = all[j],
        td = r.cells,
        f = s.cpsnr === Infinity ? 1 : (s.cpsnr - lo) / (hi - lo);
      (td[1].querySelector('.dm-bar-v') as HTMLElement).style.width = `${Math.max(0.03, f) * 55}%`;
      (td[1].querySelector('b') as HTMLElement).textContent = `${fmt(s.cpsnr)} dB`;
      (td[2].firstElementChild as HTMLElement).textContent = s.de.toFixed(2);
      (td[3].firstElementChild as HTMLElement).textContent = `${(s.bad * 100).toFixed(1)}%`;
    });
  };
  /* まだ計算していない手法の行は空けておく */
  rows.forEach((r) => {
    const k = r.dataset.v as Method,
      key = `${gen}|${S.pat}|${S.lp}|${S.med}|sc|${k}`;
    if (!memo.has(key)) {
      (r.cells[1].querySelector('b') as HTMLElement).textContent = '';
      (r.cells[1].querySelector('.dm-bar-v') as HTMLElement).style.width = '0';
      (r.cells[2].firstElementChild as HTMLElement).textContent = '';
      (r.cells[3].firstElementChild as HTMLElement).textContent = '';
    }
  });
  setTimeout(() => step(0), 0);
}
for (const r of rows)
  r.addEventListener('click', () => {
    const k = r.dataset.v as Method;
    if (k === S.method) return;
    S.method = k;
    mCh.choose(k);
    render();
  });

/* ---------- まとめて描く ---------- */
function render(table = false): void {
  paint();
  status();
  calc();
  if (table) fillTable();
  else for (const r of rows) r.classList.toggle('sel', r.dataset.v === S.method);
}
function changed(): void {
  render(true);
}

/* ---------- 入力 ---------- */
const viewCh = new Choice<View>($('#p-view'), (v) => {
  S.view = v;
  render();
});
const patCh = new Choice<Pattern>($('#p-pat'), (v) => {
  S.pat = v;
  changed();
});
const lpCh = new Choice<'off' | 'on'>($('#p-lp'), (v) => {
  S.lp = v === 'on';
  changed();
});
const medCh = new Choice<'off' | 'on'>($('#p-med'), (v) => {
  S.med = v === 'on';
  changed();
});
const mCh = new Choice<Method>($('#p-m'), (v) => {
  S.method = v;
  render();
});
const srcCh = new Choice<SrcName>($('#p-src'), (v) => {
  if (v === 'own') {
    srcCh.set(S.src);
    $<HTMLInputElement>('#fileIn').click();
    return;
  }
  S.src = v;
  gen++;
  clearMemo();
  changed();
});
S.view = viewCh.value;
S.pat = patCh.value;
S.lp = lpCh.value === 'on';
S.med = medCh.value === 'on';
S.method = mCh.value;

/** 手持ちの画像を 384 × 256 に切り抜いて縮める（短い辺を合わせる） */
function ownImage(f: File | undefined): void {
  if (!f?.type.startsWith('image/')) return;
  const url = URL.createObjectURL(f),
    im = new Image();
  im.onload = () => {
    URL.revokeObjectURL(url);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const cg = c.getContext('2d');
    if (!cg) return;
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight),
      w = im.naturalWidth * s,
      h = im.naturalHeight * s;
    cg.imageSmoothingQuality = 'high';
    cg.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
    OWN = fromRGBA(cg.getImageData(0, 0, W, H).data, W, H);
    S.src = 'own';
    srcCh.set('own');
    gen++;
    clearMemo();
    changed();
  };
  im.onerror = () => URL.revokeObjectURL(url);
  im.src = url;
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

/* 画像を押すとその画素へ。ドラッグで動かす */
function pick(e: PointerEvent): void {
  const b = cv.getBoundingClientRect();
  const x = Math.floor(((e.clientX - b.left) / b.width) * W),
    y = Math.floor(((e.clientY - b.top) / b.height) * H);
  const nx = Math.min(W - 1, Math.max(0, x)),
    ny = Math.min(H - 1, Math.max(0, y));
  if (nx === S.px && ny === S.py) return;
  S.px = nx;
  S.py = ny;
  drawLoupe(pixels(S.view));
  calc();
}
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  pick(e);
});
cv.addEventListener('pointermove', (e) => {
  if (cv.hasPointerCapture(e.pointerId)) pick(e);
});
stage.addEventListener('keydown', (e) => {
  const st = e.shiftKey ? 8 : 1;
  const d: Record<string, [number, number]> = {
    ArrowLeft: [-st, 0],
    ArrowRight: [st, 0],
    ArrowUp: [0, -st],
    ArrowDown: [0, st],
  };
  const m = d[e.key];
  if (!m) return;
  e.preventDefault();
  S.px = Math.min(W - 1, Math.max(0, S.px + m[0]));
  S.py = Math.min(H - 1, Math.max(0, S.py + m[1]));
  drawLoupe(pixels(S.view));
  calc();
});

let rw = 0;
new ResizeObserver(([e]) => {
  if (Math.abs(e.contentRect.width - rw) < 1) return;
  rw = e.contentRect.width;
  placeLoupe();
}).observe(stage);

changed();

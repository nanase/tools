/** LZW の項目: いまの 1 手、画素の格子、辞書の木 */
import { $ } from '../../lib/dom';
import { dictAt, type LzwTrace } from './lzw';
import { buildTree, type FrameView, stopLabel } from './model';

/** 辞書の木に描く項目の数 */
const TREE_CAP = 200;
/** 格子の 1 目 [CSS px、図の中の単位] */
const CELL = 26;
/** 全体を格子にする大きさの上限 */
const WHOLE = 24;

export type Dir = 'e' | 'd';

const cnt = (v: number): string => v.toLocaleString('en');
const rgbOf = (v: FrameView, i: number): string =>
  `rgb(${v.pal[i * 3] ?? 0},${v.pal[i * 3 + 1] ?? 0},${v.pal[i * 3 + 2] ?? 0})`;

/** 画素の色の列。長い列は末尾を見せる（足した画素が末尾に来るため） */
function swatches(v: FrameView, from: number, len: number, max: number, nxLast = false): string {
  const n = Math.min(len, max),
    t = v.f.transparent;
  let s = '<span class="gf-swr">';
  for (let k = 0; k < n; k++) {
    const c = v.order[len > max ? from + len - max + k : from + k],
      cl = `${c === t ? 't' : ''}${nxLast && k === n - 1 ? ' nx' : ''}`.trim();
    s += `<i${cl ? ` class="${cl}"` : ''}${c === t ? '' : ` style="background:${rgbOf(v, c)}"`}></i>`;
  }
  return `${s}${len > max ? `<small>+${cnt(len - max)}</small>` : ''}</span>`;
}

/** step の直前までで最後に画素を出した符号 */
function prevData(t: LzwTrace, step: number): number {
  let j = step - 1;
  while (j >= 0 && t.len[j] === 0) j--;
  return j;
}

function box(label: string, body: string, cls = ''): string {
  return `<div${cls ? ` class="${cls}"` : ''}><small>${label}</small>${body}</div>`;
}

function drawNow(v: FrameView, t: LzwTrace, i: number, dir: Dir): void {
  const c = t.code[i],
    clear = 1 << v.m,
    a = t.added[i],
    w = t.width[i],
    big = (s: string | number): string => `<span class="big">${s}</span>`;
  let h = '';
  if (c === clear) h = box(`符号 · ${w} ビット`, big(c)) + box('辞書の作り直し', big('Clear'));
  else if (c === clear + 1) h = box(`符号 · ${w} ビット`, big(c)) + box('終わり', big('EOI'));
  else if (dir === 'e') {
    h =
      box('いまの列 + 次の画素', swatches(v, t.start[i], t.len[i] + (a >= 0 ? 1 : 0), 12, a >= 0)) +
      box(`出す符号 · ${w} ビット`, big(c)) +
      (a >= 0 ? box('辞書への追加', big(a), 'new') : '');
  } else {
    const p = prevData(t, i);
    h =
      box(`読む符号 · ${w} ビット`, big(c)) +
      box('出す画素', swatches(v, t.start[i], t.len[i], 12)) +
      (a >= 0 && p >= 0
        ? box(
            c === a ? '辞書への追加 · KwKwK' : '辞書への追加',
            `<span class="gf-ad">${big(a)}${swatches(v, t.start[p], t.len[p] + 1, 8, true)}</span>`,
            'new',
          )
        : '');
  }
  $('#now').innerHTML = h;
}

function drawGrid(v: FrameView, t: LzwTrace, i: number, dir: Dir): void {
  const { f, rows } = v,
    W = f.w,
    H = f.h,
    s = t.start[i],
    l = t.len[i],
    cv = $<HTMLCanvasElement>('#cv-grid'),
    whole = W <= WHOLE && H <= WHOLE,
    cols = whole ? W : Math.min(W, 24),
    rn = whole ? H : Math.min(H, 18),
    last = Math.max(0, Math.min(s, v.order.length - 1)),
    cx = last % W,
    cy = rows[Math.floor(last / W)] ?? 0,
    x0 = Math.max(0, Math.min(W - cols, cx - (cols >> 1))),
    y0 = Math.max(0, Math.min(H - rn, cy - (rn >> 1))),
    D = 2,
    pw = cols * CELL,
    ph = rn * CELL;
  if (cv.width !== pw * D || cv.height !== ph * D) {
    cv.width = pw * D;
    cv.height = ph * D;
  }
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  c.setTransform(D, 0, 0, D, 0, 0);
  c.clearRect(0, 0, pw, ph);
  c.font = '500 11px "Fira Mono",monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  /* 画像の行 → 符号の順の行 */
  const so = new Int32Array(H);
  rows.forEach((y, k) => {
    so[y] = k;
  });
  const t0 = f.transparent;
  for (let ry = 0; ry < rn; ry++)
    for (let rx = 0; rx < cols; rx++) {
      const p = so[y0 + ry] * W + x0 + rx,
        px = v.order[p],
        seen = p < s + l;
      /* 復号はまだ出していない画素を描かない */
      if (dir === 'd' && !seen) continue;
      c.globalAlpha = seen ? 1 : 0.3;
      if (px !== t0) {
        c.fillStyle = rgbOf(v, px);
        c.fillRect(rx * CELL, ry * CELL, CELL, CELL);
      }
      c.globalAlpha = 1;
      if (p >= s && p < s + l + (dir === 'e' ? 1 : 0)) {
        const lum = px === t0 ? 0.9 : (v.pal[px * 3] * 0.3 + v.pal[px * 3 + 1] * 0.6 + v.pal[px * 3 + 2] * 0.1) / 255;
        c.fillStyle = lum > 0.55 ? 'rgba(0,0,0,.72)' : 'rgba(255,255,255,.88)';
        c.fillText(String(px), (rx + 0.5) * CELL, (ry + 0.5) * CELL);
      }
    }
  const cs = getComputedStyle(cv),
    mark = (p: number, col: string, dash: number[]): void => {
      const px = p % W,
        py = rows[Math.floor(p / W)];
      if (py === undefined || px < x0 || px >= x0 + cols || py < y0 || py >= y0 + rn) return;
      c.strokeStyle = col;
      c.setLineDash(dash);
      c.lineWidth = 2.5;
      c.strokeRect((px - x0) * CELL + 1.25, (py - y0) * CELL + 1.25, CELL - 2.5, CELL - 2.5);
      c.setLineDash([]);
    };
  const ink = cs.getPropertyValue('--ink'),
    acc = cs.getPropertyValue('--accent');
  /* 長い列でも見える分だけ印を付ける */
  for (let k = Math.max(0, l - cols * rn); k < l; k++) mark(s + k, ink, []);
  if (t.added[i] >= 0)
    if (dir === 'e') {
      if (l) mark(s + l, acc, [4, 3]);
    } else if (l) mark(s, acc, [4, 3]);
}

function drawTree(v: FrameView, t: LzwTrace, i: number, dir: Dir): void {
  const clear = 1 << v.m,
    ents = dictAt(t, v.order, v.m, i, dir),
    T = buildTree(ents, clear, v.colors, TREE_CAP),
    CW = 30,
    CH = 40,
    SZ = 22,
    X = (x: number): number => 10 + x * CW + CW / 2,
    Y = (d: number): number => 8 + d * CH,
    on = new Set<number>(),
    nw = t.added[i];
  /* いまの列（符号化は符号の列、復号も同じ）の道すじ */
  for (let k = T.at.get(t.code[i]) ?? -1; k >= 0; k = T.nodes[k].parent) on.add(k);
  const W = Math.max(280, T.leaves * CW + 20),
    H = (T.depth + 1) * CH + 22;
  let edges = '',
    nodes = '';
  T.nodes.forEach((n, k) => {
    const x = X(n.x),
      y = Y(n.d);
    if (n.parent >= 0) {
      const p = T.nodes[n.parent],
        px = X(p.x),
        py = Y(p.d) + SZ;
      edges += `<path class="e${on.has(k) && on.has(n.parent) ? ' on' : ''}" d="M${px} ${py}C${px} ${py + 8} ${x} ${y - 8} ${x} ${y}"/>`;
    }
    const tr = n.v === v.f.transparent,
      cls = n.code === nw ? 'nw' : on.has(k) ? 'on' : '';
    nodes += `<rect x="${x - SZ / 2}" y="${y}" width="${SZ}" height="${SZ}" rx="2"${cls || tr ? ` class="${`${cls}${tr ? ' tr' : ''}`.trim()}"` : ''}${tr ? '' : ` fill="${rgbOf(v, n.v)}"`}/><text x="${x}" y="${y + SZ + 10}"${cls ? ' class="on"' : ''}>${n.code}</text>`;
  });
  const svg = $<HTMLElement>('#tree');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.innerHTML = edges + nodes;
  /* 足した節を枠の中ほどへ送る */
  const k = T.at.get(nw >= 0 ? nw : t.code[i]);
  if (k !== undefined) {
    const b = $('#treew');
    b.scrollLeft = X(T.nodes[k].x) - b.clientWidth / 2;
    b.scrollTop = Y(T.nodes[k].d) - b.clientHeight / 2;
  }
}

/** 項目全体を描く */
export function drawLzw(v: FrameView, i: number, dir: Dir): void {
  const t = dir === 'e' ? v.enc : v.tr,
    clear = 1 << v.m;
  let nx = clear + 2;
  for (let k = i; k >= 0; k--) {
    if (t.code[k] === clear) break;
    if (t.added[k] >= 0) {
      nx = t.added[k] + 1;
      break;
    }
  }
  $('#st-n').textContent = cnt(i);
  $('#st-max').textContent = cnt(t.n - 1);
  $('#st-w').textContent = `${t.width[i]} ビット`;
  /* 次の符号長に上がる大きさまで */
  $('#st-d').textContent = `${nx} / ${Math.min(4096, 1 << t.width[i])}`;
  $('#st-stop').textContent = stopLabel(v.dec.stop);
  drawNow(v, t, i, dir);
  drawGrid(v, t, i, dir);
  drawTree(v, t, i, dir);
}

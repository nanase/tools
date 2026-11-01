/**
 * 減色。色数が上限以下ならそのまま、超えたら median cut でカラーテーブルを作り、
 * 誤差拡散（Floyd–Steinberg）を選べる。透明な画素（不透明度 128 未満）は透過色の 1 色にまとめる
 */

export interface Quantized {
  /** RGB を並べたカラーテーブル */
  pal: Uint8Array;
  /** 色数 */
  colors: number;
  /** 行の上から順の画素の値 */
  idx: Uint8Array;
  /** 透過色の番号（なければ −1） */
  transparent: number;
  /** 減色せずに元の色のまま入った */
  exact: boolean;
}

interface Box {
  c: number[];
}

const R5 = (k: number): number => (k >> 10) & 31;
const G5 = (k: number): number => (k >> 5) & 31;
const B5 = (k: number): number => k & 31;

function rangeOf(b: Box): { ch: number; size: number } {
  const lo = [31, 31, 31],
    hi = [0, 0, 0];
  for (const k of b.c) {
    const v = [R5(k), G5(k), B5(k)];
    for (let i = 0; i < 3; i++) {
      if (v[i] < lo[i]) lo[i] = v[i];
      if (v[i] > hi[i]) hi[i] = v[i];
    }
  }
  /* 緑に敏感なので重みを付ける */
  const r = [(hi[0] - lo[0]) * 2, (hi[1] - lo[1]) * 3, hi[2] - lo[2]];
  const ch = r[1] >= r[0] && r[1] >= r[2] ? 1 : r[0] >= r[2] ? 0 : 2;
  return { ch, size: r[ch] };
}

/** median cut。色ごとの 5 ビットのヒストグラムから n 色を作る */
export function medianCut(rgba: Uint8ClampedArray, n: number): Uint8Array {
  const hist = new Uint32Array(32768),
    sum = new Float64Array(32768 * 3);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const k = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
    hist[k]++;
    sum[k * 3] += rgba[i];
    sum[k * 3 + 1] += rgba[i + 1];
    sum[k * 3 + 2] += rgba[i + 2];
  }
  const all: number[] = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) all.push(k);
  const boxes: Box[] = [{ c: all }];
  while (boxes.length < n) {
    /* 広がりと画素の数の大きい箱から割る */
    let best = -1,
      bestV = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].c.length < 2) continue;
      const v = (rangeOf(boxes[i]).size + 1) * Math.sqrt(boxes[i].c.reduce((a, k) => a + hist[k], 0));
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    if (best < 0) break;
    const b = boxes[best],
      { ch } = rangeOf(b),
      val = ch === 0 ? R5 : ch === 1 ? G5 : B5;
    b.c.sort((x, y) => val(x) - val(y));
    const half = b.c.reduce((a, k) => a + hist[k], 0) / 2;
    let acc = 0,
      cut = 1;
    for (let i = 0; i < b.c.length - 1; i++) {
      acc += hist[b.c[i]];
      if (acc >= half) {
        cut = i + 1;
        break;
      }
      cut = i + 1;
    }
    boxes.splice(best, 1, { c: b.c.slice(0, cut) }, { c: b.c.slice(cut) });
  }
  const pal = boxes.map((b) => {
    let w = 0,
      r = 0,
      g = 0,
      bl = 0;
    for (const k of b.c) {
      w += hist[k];
      r += sum[k * 3];
      g += sum[k * 3 + 1];
      bl += sum[k * 3 + 2];
    }
    return [Math.round(r / w), Math.round(g / w), Math.round(bl / w)];
  });
  /* 明るさの順に並べる（画素の値の図が読みやすくなる） */
  pal.sort((a, b) => a[0] * 2 + a[1] * 5 + a[2] - (b[0] * 2 + b[1] * 5 + b[2]));
  return Uint8Array.from(pal.flat());
}

/** 減色する */
export function quantize(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  o: { colors: number; dither: boolean },
): Quantized {
  const n = w * h,
    idx = new Uint8Array(n);
  let hasT = false;
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i] < 128) {
      hasT = true;
      break;
    }
  const room = Math.max(1, o.colors - (hasT ? 1 : 0));
  /* 元の色が room 以下なら、出てきた順にそのまま */
  const seen = new Map<number, number>();
  let exact = true;
  for (let i = 0; i < n && exact; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    if (!seen.has(key)) {
      if (seen.size >= room) exact = false;
      else seen.set(key, seen.size);
    }
  }
  if (exact) {
    const t = hasT ? seen.size : -1,
      colors = Math.max(2, seen.size + (hasT ? 1 : 0)),
      pal = new Uint8Array(colors * 3);
    for (const [key, v] of seen) pal.set([key >> 16, (key >> 8) & 255, key & 255], v * 3);
    for (let i = 0; i < n; i++)
      idx[i] =
        rgba[i * 4 + 3] < 128 ? t : (seen.get((rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]) ?? 0);
    return { pal, colors, idx, transparent: t, exact: true };
  }
  const base = medianCut(rgba, room),
    count = base.length / 3,
    t = hasT ? count : -1,
    colors = Math.max(2, count + (hasT ? 1 : 0)),
    pal = new Uint8Array(colors * 3);
  pal.set(base);
  /* 5 ビットの色ごとに、最も近いカラーテーブルの色を覚えておく */
  const near = new Int16Array(32768).fill(-1);
  const nearest = (r: number, g: number, b: number): number => {
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (near[k] >= 0) return near[k];
    let best = 0,
      bd = Infinity;
    for (let i = 0; i < count; i++) {
      const dr = pal[i * 3] - r,
        dg = pal[i * 3 + 1] - g,
        db = pal[i * 3 + 2] - b,
        d = dr * dr * 2 + dg * dg * 4 + db * db;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    near[k] = best;
    return best;
  };
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  if (!o.dither) {
    for (let i = 0; i < n; i++)
      idx[i] = rgba[i * 4 + 3] < 128 ? t : nearest(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  } else {
    const cur = new Float32Array((w + 2) * 3),
      nxt = new Float32Array((w + 2) * 3);
    for (let y = 0; y < h; y++) {
      nxt.fill(0);
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (rgba[p + 3] < 128) {
          idx[y * w + x] = t;
          continue;
        }
        const j = (x + 1) * 3,
          r = clamp(rgba[p] + cur[j]),
          g = clamp(rgba[p + 1] + cur[j + 1]),
          b = clamp(rgba[p + 2] + cur[j + 2]),
          v = nearest(r, g, b);
        idx[y * w + x] = v;
        const e = [r - pal[v * 3], g - pal[v * 3 + 1], b - pal[v * 3 + 2]];
        for (let c = 0; c < 3; c++) {
          cur[j + 3 + c] += (e[c] * 7) / 16;
          nxt[j - 3 + c] += (e[c] * 3) / 16;
          nxt[j + c] += (e[c] * 5) / 16;
          nxt[j + 3 + c] += (e[c] * 1) / 16;
        }
      }
      cur.set(nxt);
    }
  }
  return { pal, colors, idx, transparent: t, exact: false };
}

/** 画素の値から RGBA へ */
export function toRgba(idx: Uint8Array, pal: Uint8Array, transparent: number): Uint8ClampedArray {
  const o = new Uint8ClampedArray(idx.length * 4);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    if (v === transparent) continue;
    o[i * 4] = pal[v * 3];
    o[i * 4 + 1] = pal[v * 3 + 1];
    o[i * 4 + 2] = pal[v * 3 + 2];
    o[i * 4 + 3] = 255;
  }
  return o;
}

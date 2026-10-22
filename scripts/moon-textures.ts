/**
 * 月のページの模様と高さのテクスチャ（public/moon/color8.jpg・height8.png）を作る。
 *
 *   bun scripts/moon-textures.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-moon）に
 * 元の TIFF がなければ NASA SVS からダウンロードする。
 * 範囲は表側と秤動の分: 経度 −100°〜+100°、緯度 +90°〜−90° を 1° あたり 8 画素（1600×1440）。
 * 画素 (i, j) の中心は 経度 −100 + (i + 0.5)/8、緯度 90 − (j + 0.5)/8。
 * height8.png は 8 ビット RGB で、q = round((h[km] + 10) / 0.01)（10 m 刻み）、R = q >> 8、G = q & 255、B = 0。
 *
 * 元データ（許諾・出典表記は src/tools/moon/SOURCES.md）: NASA SVS「CGI Moon Kit」（パブリックドメイン）
 * https://svs.gsfc.nasa.gov/4720/
 * - ldem_16.tif: LOLA の高さ（float32、半径 1737.4 km からの km、5760×2880、1° あたり 16 画素）
 * - lroc_color_16bit_srgb_4k.tif: LROC WAC の色（uint16 の sRGB、4096×2048、LZW 圧縮）
 * どちらも経度 0° が中央（列 0 が 180°W）、行 0 が 90°N
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { encode } from '../src/tools/jpeg/encoder';

const SVS = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/';
const HEIGHT = 'ldem_16.tif',
  COLOR = 'lroc_color_16bit_srgb_4k.tif';
const OUT = new URL('../public/moon/', import.meta.url);

/** 経度 −100〜+100、緯度 +90〜−90、1° あたり 8 画素 */
const PPD = 8,
  LON0 = -100,
  W = 200 * PPD,
  H = 180 * PPD;

/* ---------- TIFF ---------- */

interface Tiff {
  w: number;
  h: number;
  /** 画素ごとの標本の数 */
  spp: number;
  /** 標本（行ごと、画素ごとに spp 個） */
  data: Float32Array;
}

/** ストリップ・チャンキー（PlanarConfiguration 1）で、無圧縮か LZW の TIFF だけ読む。ほかは止める */
function tiff(buf: Uint8Array, name: string): Tiff {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const bo = String.fromCharCode(buf[0], buf[1]);
  if (bo !== 'II' && bo !== 'MM') throw new Error(`${name}: TIFF ではありません`);
  const le = bo === 'II';
  if (dv.getUint16(2, le) !== 42) throw new Error(`${name}: 版 ${dv.getUint16(2, le)} は扱えません（BigTIFF など）`);
  const ifd = dv.getUint32(4, le);
  const tags = new Map<number, number[]>();
  for (let k = 0, n = dv.getUint16(ifd, le); k < n; k++) {
    const e = ifd + 2 + k * 12,
      tag = dv.getUint16(e, le),
      type = dv.getUint16(e + 2, le),
      count = dv.getUint32(e + 4, le);
    // SHORT と LONG だけ読む（ほかの型のタグは使わない）
    const size = type === 3 ? 2 : type === 4 ? 4 : 0;
    if (!size) continue;
    const p = size * count <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    tags.set(
      tag,
      Array.from({ length: count }, (_, i) => (size === 2 ? dv.getUint16(p + i * 2, le) : dv.getUint32(p + i * 4, le))),
    );
  }
  const one = (tag: number, def?: number) => {
    const v = tags.get(tag);
    if (v === undefined) {
      if (def === undefined) throw new Error(`${name}: タグ ${tag} がありません`);
      return def;
    }
    if (v.some((x) => x !== v[0])) throw new Error(`${name}: タグ ${tag} の値がそろっていません（${v}）`);
    return v[0];
  };
  const w = one(256),
    h = one(257),
    spp = one(277, 1),
    bps = one(258, 1),
    fmt = one(339, 1),
    rps = one(278, h);
  const comp = one(259, 1),
    pred = one(317, 1);
  // 圧縮は無圧縮（1）と LZW（5）。LZW の予測は なし（1）と横の差（2）
  if (comp !== 1 && comp !== 5) throw new Error(`${name}: 圧縮 Compression ${comp} は扱えません`);
  if (pred !== 1 && !(comp === 5 && pred === 2 && bps === 16))
    throw new Error(`${name}: 予測 Predictor ${pred} は扱えません`);
  if (one(284, 1) !== 1) throw new Error(`${name}: PlanarConfiguration ${one(284)} は扱えません`);
  if (tags.has(322)) throw new Error(`${name}: タイル形式は扱えません`);
  const kind = `${fmt}:${bps}`;
  if (kind !== '3:32' && kind !== '1:16')
    throw new Error(`${name}: SampleFormat ${fmt}・BitsPerSample ${bps} は扱えません`);
  const offs = tags.get(273),
    counts = tags.get(279);
  if (!offs || !counts || offs.length !== counts.length || offs.length !== Math.ceil(h / rps))
    throw new Error(`${name}: ストリップの表が壊れています`);
  const bytes = bps / 8,
    rowBytes = w * spp * bytes,
    data = new Float32Array(w * h * spp);
  offs.forEach((off, s) => {
    const rows = Math.min(rps, h - s * rps),
      n = rows * rowBytes;
    const strip = comp === 5 ? lzw(buf.subarray(off, off + counts[s]), n) : buf.subarray(off, off + counts[s]);
    if (strip.length < n) throw new Error(`${name}: ストリップ ${s} が短すぎます`);
    const sv = new DataView(strip.buffer, strip.byteOffset, strip.byteLength);
    for (let i = 0, base = s * rps * w * spp; i < rows * w * spp; i++) {
      let v = bytes === 4 ? sv.getFloat32(i * 4, le) : sv.getUint16(i * 2, le);
      // 横の差: 同じ行の 1 画素前の同じ標本に足す（16 ビットで桁あふれさせる）
      if (pred === 2 && i % (w * spp) >= spp) v = (v + data[base + i - spp]) & 0xffff;
      data[base + i] = v;
    }
  });
  console.log(
    `${name}: ${w}×${h}、${spp} 標本、${kind === '3:32' ? 'float32' : 'uint16'}、${le ? 'II' : 'MM'}、圧縮 ${comp}`,
  );
  return { w, h, spp, data };
}

/** TIFF の LZW（上位ビットから詰めた 9〜12 ビットの符号、符号の幅は 1 つ早く広げる）を n バイトまで展開する */
function lzw(src: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n),
    prefix = new Int32Array(4096),
    suffix = new Uint8Array(4096),
    first = new Uint8Array(4096),
    len = new Int32Array(4096);
  for (let c = 0; c < 256; c++) {
    prefix[c] = -1;
    suffix[c] = first[c] = c;
    len[c] = 1;
  }
  let o = 0,
    bit = 0,
    next = 258,
    width = 9,
    prev = -1;
  const put = (c: number) => {
    const l = len[c];
    if (o + l > n) throw new Error('LZW の展開が長すぎます');
    for (let k = l - 1, x = c; k >= 0; k--, x = prefix[x]) out[o + k] = suffix[x];
    o += l;
  };
  while (o < n) {
    if (bit + width > src.length * 8) throw new Error('LZW のデータが途中で終わっています');
    let code = 0;
    for (let k = 0; k < width; k++, bit++) code = (code << 1) | ((src[bit >> 3] >> (7 - (bit & 7))) & 1);
    if (code === 257) break;
    if (code === 256) {
      next = 258;
      width = 9;
      prev = -1;
      continue;
    }
    if (prev < 0) put(code);
    else {
      if (code > next) throw new Error('LZW の符号が壊れています');
      // まだない符号（code === next）は、前の列 + 前の列の先頭
      const head = code < next ? first[code] : first[prev];
      prefix[next] = prev;
      suffix[next] = head;
      first[next] = first[prev];
      len[next] = len[prev] + 1;
      next++;
      put(code);
    }
    prev = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out.subarray(0, o);
}

/* ---------- PNG ---------- */

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b: Uint8Array) => {
  let c = ~0;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length),
    dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** 8 ビット RGB の PNG。行ごとに、差の絶対値の和（符号付きバイトとして）が最小になるフィルタを選ぶ */
function png(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 3,
    raw = new Uint8Array(h * (stride + 1)),
    cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const cur = rgb.subarray(y * stride, (y + 1) * stride),
      up = y ? rgb.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    let best = 0,
      bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f];
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 3 ? cur[x - 3] : 0,
          b = up[x],
          c = x >= 3 ? up[x - 3] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (cur[x] - pred) & 255;
        o[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    raw.set(cand[best], y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13),
    dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 ビット、RGB、deflate、フィルタ方式 0、インターレースなし
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk('IEND', new Uint8Array()),
  ];
  return Buffer.concat(parts);
}

/** 確かめ用: 上の png() が書いた形（IDAT 1 つ、8 ビット RGB）だけ読み戻す */
function unpng(file: Uint8Array, w: number, h: number): Uint8Array {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const len = dv.getUint32(33);
  const raw = inflateSync(file.subarray(41, 41 + len)),
    stride = w * 3,
    out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? out[y * stride + x - 3] : 0,
        b = y ? out[(y - 1) * stride + x] : 0,
        c = x >= 3 && y ? out[(y - 1) * stride + x - 3] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      out[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + pred) & 255;
    }
  }
  return out;
}

/* ---------- 高さ ---------- */

/** 1° あたり 16 画素の高さ [km] を 2×2 の平均で 8 画素にする */
function heights(t: Tiff): Float32Array {
  if (t.w !== 360 * 16 || t.h !== 180 * 16 || t.spp !== 1) throw new Error('高さの TIFF の大きさが違います');
  const out = new Float32Array(W * H),
    c0 = (LON0 + 180) * 16;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const p = 2 * j * t.w + c0 + 2 * i;
      out[j * W + i] = (t.data[p] + t.data[p + 1] + t.data[p + t.w] + t.data[p + t.w + 1]) / 4;
    }
  return out;
}

/* ---------- 色 ---------- */

/** 箱フィルタの重み: 出力の画素 k は、元の座標 [a(k), a(k+1)) に重なる画素を重なりの長さで平均する */
function boxWeights(n: number, a: (k: number) => number): { i0: number; w: number[] }[] {
  return Array.from({ length: n }, (_, k) => {
    const lo = a(k),
      hi = a(k + 1),
      i0 = Math.floor(lo),
      w: number[] = [];
    for (let i = i0; i < hi; i++) w.push(Math.min(hi, i + 1) - Math.max(lo, i));
    const s = w.reduce((x, y) => x + y, 0);
    return { i0, w: w.map((x) => x / s) };
  });
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** 16 ビット sRGB の地図を、光の強さ（線形）で箱フィルタにかけて 8 ビット sRGB の RGBA にする */
function colors(t: Tiff): Uint8Array {
  if (t.w !== 2 * t.h || t.spp !== 3) throw new Error('色の TIFF の大きさが違います');
  const lut = Float32Array.from({ length: 65536 }, (_, v) => toLinear(v / 65535));
  const sx = t.w / 360,
    sy = t.h / 180;
  const cols = boxWeights(W, (i) => (LON0 + i / PPD + 180) * sx),
    rows = boxWeights(H, (j) => (j / PPD) * sy);
  // 横に縮めてから縦に縮める
  const mid = new Float32Array(t.h * W * 3);
  for (let y = 0; y < t.h; y++)
    cols.forEach(({ i0, w }, i) => {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        w.forEach((wk, k) => {
          s += wk * lut[t.data[(y * t.w + i0 + k) * 3 + c]];
        });
        mid[(y * W + i) * 3 + c] = s;
      }
    });
  const out = new Uint8Array(W * H * 4);
  rows.forEach(({ i0, w }, j) => {
    for (let i = 0; i < W; i++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        w.forEach((wk, k) => {
          s += wk * mid[((i0 + k) * W + i) * 3 + c];
        });
        out[(j * W + i) * 4 + c] = Math.round(Math.min(1, Math.max(0, toSrgb(s))) * 255);
      }
      out[(j * W + i) * 4 + 3] = 255;
    }
  });
  return out;
}

/* ---------- 書き出し ---------- */

async function cached(dir: string, name: string): Promise<Uint8Array> {
  const path = join(dir, name);
  if (!existsSync(path)) {
    console.log(`${SVS}${name} をダウンロード`);
    const res = await fetch(SVS + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
  }
  return new Uint8Array(readFileSync(path));
}

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-moon');
mkdirSync(dir, { recursive: true });
mkdirSync(OUT, { recursive: true });

const hgt = heights(tiff(await cached(dir, HEIGHT), HEIGHT));
const rgb = new Uint8Array(W * H * 3);
let lo = Infinity,
  hi = -Infinity;
hgt.forEach((h, k) => {
  if (!Number.isFinite(h)) throw new Error(`高さが数ではありません（画素 ${k}）`);
  lo = Math.min(lo, h);
  hi = Math.max(hi, h);
  const q = Math.round((h + 10) / 0.01);
  if (q < 0 || q > 0xffff) throw new Error(`高さ ${h} km が範囲の外です`);
  rgb[k * 3] = q >> 8;
  rgb[k * 3 + 1] = q & 255;
});
const pngBytes = png(rgb, W, H);
writeFileSync(new URL('height8.png', OUT), pngBytes);
// 書いた PNG を読み戻して、元の高さとの差を見る
const back = unpng(pngBytes, W, H);
let maxErr = 0;
for (let k = 0; k < W * H; k++)
  maxErr = Math.max(maxErr, Math.abs(((back[k * 3] << 8) | back[k * 3 + 1]) * 0.01 - 10 - hgt[k]));
console.log(
  `高さ: 最小 ${lo.toFixed(3)} km、最大 ${hi.toFixed(3)} km、読み戻しの差は最大 ${(maxErr * 1000).toFixed(2)} m`,
);
for (const [lat, lon] of [
  [0, 0],
  [-43.3, -11.2], // ティコ
  [9.62, -20.08], // コペルニクス
  [-89.9, 0],
]) {
  const i = Math.floor((lon - LON0) * PPD),
    j = Math.floor((90 - lat) * PPD),
    k = j * W + i;
  const dec = ((back[k * 3] << 8) | back[k * 3 + 1]) * 0.01 - 10;
  console.log(`  (${lat}, ${lon}): ${hgt[k].toFixed(4)} km → ${dec.toFixed(2)} km`);
}
console.log(`height8.png: ${W}×${H}、${pngBytes.length} バイト`);

const col = colors(tiff(await cached(dir, COLOR), COLOR));
const jpg = encode(col, W, H, { q: 85, sub: '420', qt: 'k', huff: 'opt' }).bytes;
writeFileSync(new URL('color8.jpg', OUT), jpg);
console.log(`color8.jpg: ${W}×${H}、${jpg.length} バイト`);

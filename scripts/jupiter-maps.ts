/**
 * 木星のページの模様の地図（public/jupiter/j<年><回>.webp）を作る。WebP への変換に ImageMagick（magick）を使う。
 *
 *   bun scripts/jupiter-maps.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-jupiter）に
 * 元の TIFF がなければ MAST からダウンロードする。
 * 元データ（許諾・出典表記は src/tools/jupiter/SOURCES.md）: Hubble の OPAL（Outer Planet Atmospheres Legacy）の
 * 全球の地図（色合成、3600×1800、1° あたり 10 画素、CC BY 4.0）https://archive.stsci.edu/hlsp/opal
 * 地図は正距円筒で、左端が System III の西経 0°（右へ減る）、上端が惑星図緯度 +90°。
 *
 * 作り方:
 * - 撮れていない極の側（行の 2 % 以上が黒い行）は、端に近い 12 行の平均の色で埋める
 * - 行の中の欠けは、その行の平均の色で埋める
 * - 3072×1536 に縮め（面積の平均）、WebP（品質 82）にする
 * - 大赤斑の経度（南緯 14〜30° で赤みが最も強い所）を出す。src/tools/jupiter/grs.ts の表を足すときに使う
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAST = 'https://archive.stsci.edu/hlsps/opal/';
const OUT = new URL('../public/jupiter/', import.meta.url);
const W = 3072,
  H = 1536;

/** [出力の名前, 観測の周期, 元のファイルの名前の一部] */
const MAPS: [string, number, string][] = [
  ['j2015a', 22, '2015a_f395n-f502n-f631n'],
  ['j2016a', 23, '2016a_f395n-f502n-f631n'],
  ['j2017a', 24, '2017a_f395n-f502n-f631n'],
  ['j2018a', 25, '2018a_f395n-f502n-f631n'],
  ['j2019a', 26, '2019a_f395n-f502n-f631n'],
  ['j2020a', 27, '2020a_f395n-f502n-f631n'],
  ['j2021a', 28, '2021a_f395n-f502n-f631n'],
  // 2022 年の 1 周目は途中で欠けているので 2 周目を使う
  ['j2022b', 29, '2022b_f395n-f502n-f631n'],
  ['j2024a', 30, '2024a_f395n-f502n-f658n'],
  ['j2024c', 31, '2024c_f395n-f502n-f631n'],
  ['j2025a', 32, '2025a_f395n-f502n-f631n'],
];

/** 無圧縮・8 ビット・ストリップの TIFF を、画素ごとに RGB を並べた配列で読む（PlanarConfiguration 1・2） */
function tiff(buf: Uint8Array, name: string): { w: number; h: number; rgb: Uint8Array } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = String.fromCharCode(buf[0], buf[1]) === 'II';
  if (dv.getUint16(2, le) !== 42) throw new Error(`${name}: TIFF ではありません`);
  const ifd = dv.getUint32(4, le);
  const tags = new Map<number, number[]>();
  for (let k = 0, n = dv.getUint16(ifd, le); k < n; k++) {
    const e = ifd + 2 + k * 12,
      tag = dv.getUint16(e, le),
      type = dv.getUint16(e + 2, le),
      count = dv.getUint32(e + 4, le);
    const size = type === 3 ? 2 : type === 4 ? 4 : 0;
    if (!size) continue;
    const p = size * count <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    tags.set(
      tag,
      Array.from({ length: count }, (_, i) => (size === 2 ? dv.getUint16(p + i * 2, le) : dv.getUint32(p + i * 4, le))),
    );
  }
  const one = (tag: number, def: number) => tags.get(tag)?.[0] ?? def;
  const w = one(256, 0),
    h = one(257, 0),
    spp = one(277, 1),
    planar = one(284, 1),
    rps = one(278, h);
  if (one(259, 1) !== 1) throw new Error(`${name}: 圧縮したものは扱えません`);
  if (one(258, 8) !== 8 || spp < 3) throw new Error(`${name}: 8 ビットの RGB ではありません`);
  const offs = tags.get(273) ?? [],
    counts = tags.get(279) ?? [];
  const per = Math.ceil(h / rps);
  const rgb = new Uint8Array(w * h * 3);
  offs.forEach((off, s) => {
    const strip = buf.subarray(off, off + counts[s]);
    if (planar === 1) {
      const y0 = s * rps;
      for (let i = 0; i < strip.length / spp; i++) {
        const px = y0 * w + i;
        for (let c = 0; c < 3; c++) rgb[px * 3 + c] = strip[i * spp + c];
      }
    } else {
      const c = Math.floor(s / per),
        y0 = (s % per) * rps;
      if (c > 2) return;
      for (let i = 0; i < strip.length; i++) rgb[(y0 * w + i) * 3 + c] = strip[i];
    }
  });
  return { w, h, rgb };
}

/** 欠けを埋めた画素（float、RGB）と、撮れている行の範囲 */
function fill(t: { w: number; h: number; rgb: Uint8Array }): Float32Array {
  const { w, h, rgb } = t;
  const a = Float32Array.from(rgb);
  const ok = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    return Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) > 3;
  };
  const rowOk: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (ok(x, y)) n++;
    rowOk.push(n > 0.98 * w);
  }
  let r0 = rowOk.indexOf(true),
    r1 = rowOk.lastIndexOf(true);
  r0 += 4;
  r1 -= 4;
  const mean = (ya: number, yb: number) => {
    const m = [0, 0, 0];
    let n = 0;
    for (let y = ya; y <= yb; y++)
      for (let x = 0; x < w; x++) {
        if (!ok(x, y)) continue;
        for (let c = 0; c < 3; c++) m[c] += a[(y * w + x) * 3 + c];
        n++;
      }
    return m.map((v) => v / Math.max(1, n));
  };
  for (let y = r0; y <= r1; y++) {
    if (rowOk[y] && [...Array(w).keys()].every((x) => ok(x, y))) continue;
    const m = mean(y, y);
    for (let x = 0; x < w; x++) if (!ok(x, y)) a.set(m, (y * w + x) * 3);
  }
  const top = mean(r0, r0 + 11),
    bot = mean(r1 - 11, r1);
  for (let y = 0; y < r0; y++) for (let x = 0; x < w; x++) a.set(top, (y * w + x) * 3);
  for (let y = r1 + 1; y < h; y++) for (let x = 0; x < w; x++) a.set(bot, (y * w + x) * 3);
  return a;
}

/** 面積の平均で縮める */
function shrink(a: Float32Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  const fx = w / W,
    fy = h / H;
  for (let y = 0; y < H; y++) {
    const ya = y * fy,
      yb = (y + 1) * fy;
    for (let x = 0; x < W; x++) {
      const xa = x * fx,
        xb = (x + 1) * fx;
      const s = [0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(ya); sy < Math.ceil(yb); sy++) {
        const wy = Math.min(yb, sy + 1) - Math.max(ya, sy);
        for (let sx = Math.floor(xa); sx < Math.ceil(xb); sx++) {
          const ww = wy * (Math.min(xb, sx + 1) - Math.max(xa, sx));
          const i = (sy * w + sx) * 3;
          for (let c = 0; c < 3; c++) s[c] += a[i + c] * ww;
          n += ww;
        }
      }
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(255, s[c] / n));
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 大赤斑の経度（System III の西経）[°]: 南緯 14〜30° で、幅 12° でならした赤み (R − B) / (R + G + B) の最大 */
function grs(a: Float32Array, w: number, h: number): number {
  const col = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    if (lat > -14 || lat < -30) continue;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      col[x] += (a[i] - a[i + 2]) / (a[i] + a[i + 1] + a[i + 2] + 1);
    }
  }
  const k = Math.round((12 / 360) * w);
  let best = -1,
    bx = 0;
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -k / 2; d < k / 2; d++) s += col[(x + d + w) % w];
    if (s > best) {
      best = s;
      bx = x;
    }
  }
  return (((360 - ((bx + 0.5) / w) * 360) % 360) + 360) % 360;
}

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-jupiter');
mkdirSync(dir, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const [key, cycle, part] of MAPS) {
  const file = `hlsp_opal_hst_wfc3-uvis_jupiter-${part}_v1_globalmap.tif`;
  const path = join(dir, file);
  if (!existsSync(path)) {
    console.log(`${file} をダウンロードします`);
    const r = await fetch(`${MAST}cycle${cycle}/jupiter/${file}`);
    if (!r.ok) throw new Error(`${file}: ${r.status}`);
    writeFileSync(path, new Uint8Array(await r.arrayBuffer()));
  }
  const t = tiff(new Uint8Array(readFileSync(path)), file);
  const a = fill(t);
  /* 縮めた RGBA をそのまま渡し、ImageMagick で WebP にする */
  const raw = join(dir, `${key}.rgba`);
  writeFileSync(raw, shrink(a, t.w, t.h));
  const out = fileURLToPath(new URL(`${key}.webp`, OUT));
  execFileSync('magick', [
    '-size',
    `${W}x${H}`,
    '-depth',
    '8',
    `rgba:${raw}`,
    '-alpha',
    'off',
    '-quality',
    '82',
    '-define',
    'webp:method=6',
    out,
  ]);
  rmSync(raw);
  console.log(
    `${key}.webp: ${Math.round(statSync(out).size / 1024)} KB、大赤斑 System III ${grs(a, t.w, t.h).toFixed(1)}°`,
  );
}

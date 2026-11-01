import { describe, expect, it } from 'vitest';
import { distLabel } from '../src/tools/png/ladder';
import {
  bitsPerPixelMap,
  bytePixels,
  compare,
  encodeModel,
  fileModel,
  type Model,
  pixelRow,
  posRow,
  residualImage,
  rowPixelXY,
  rowStartPos,
} from '../src/tools/png/model';
import { pngLayout } from '../src/tools/png/png';
import {
  CHART_BAND,
  CHART_FILTERS,
  CHART_W,
  chart,
  ILLUST_H,
  ILLUST_W,
  illust,
  SAMPLES,
} from '../src/tools/png/samples';

/** なめらかな模様（色が多い） */
function grad(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([x * 7, y * 5, (x * y) & 255, 255], (y * w + x) * 4);
  return d;
}
const model = (r: ReturnType<typeof encodeModel>): Model => {
  if ('fail' in r) throw new Error(r.fail);
  return r;
};

describe('行・バイト・画素の対応', () => {
  for (const il of [false, true])
    it(`画素 → 行 → 画素で戻る（インターレース ${il ? 'Adam7' : 'なし'}）`, () => {
      const L = pngLayout(13, 11, 6, 8, il);
      for (let y = 0; y < 11; y++)
        for (let x = 0; x < 13; x++) {
          const [r, px] = pixelRow(L, x, y);
          expect(rowPixelXY(L, r, px)).toEqual([x, y]);
        }
    });

  it('行の先頭の位置 → 行と −1', () => {
    const L = pngLayout(13, 11, 2, 8, true);
    for (let r = 0; r < L.rows; r++) {
      expect(posRow(L, rowStartPos(L, r))).toEqual([r, -1]);
      expect(posRow(L, rowStartPos(L, r) + 1)).toEqual([r, 0]);
    }
  });

  it('深度 4 では 1 バイトに 2 画素', () => {
    const L = pngLayout(7, 2, 3, 4, false);
    expect(bytePixels(L, 0, 0)).toEqual([0, 1]);
    expect(bytePixels(L, 0, 3)).toEqual([6, 6]);
  });
});

describe('符号化とファイルの読み取り', () => {
  it('イラストのパレットは深度 4', () => {
    const m = model(
      encodeModel(illust(), ILLUST_W, ILLUST_H, { colorType: 3, filter: 'adaptive', level: 6, interlace: false }),
    );
    expect(m.layout.bitDepth).toBe(4);
    expect(m.palette?.length).toBe(16 * 3);
    expect(m.loss).toEqual({ color: 0, alpha: 0 });
  });

  it('色の多い画像はパレットにできない', () => {
    const r = encodeModel(grad(64, 64), 64, 64, { colorType: 3, filter: 'adaptive', level: 6, interlace: false });
    expect('fail' in r && r.fail).toBe('too-many-colors');
  });

  it('符号化したファイルを読むと、同じ行と記号になる', () => {
    const e = model(encodeModel(grad(40, 30), 40, 30, { colorType: 6, filter: 'adaptive', level: 6, interlace: true })),
      f = fileModel(e.bytes);
    if ('fail' in f) throw new Error(f.fail);
    expect(f.raw).toEqual(e.raw);
    expect(f.types).toEqual(e.types);
    expect(f.sums).toEqual(e.sums);
    expect(f.trace.tokens.count).toBe(e.trace.tokens.count);
    expect(f.rgba).toEqual(e.rgba);
    expect(f.crcOk && f.adlerOk).toBe(true);
  });

  it('画素が多すぎるファイルは、復号する前に断る', () => {
    const e = model(encodeModel(grad(8, 8), 8, 8, { colorType: 6, filter: 'adaptive', level: 6, interlace: false })),
      huge = e.bytes.slice(),
      v = new DataView(huge.buffer);
    /* 署名 8・長さ 4・種類 4 の後が IHDR の幅と高さ。CRC は読むときに無視する */
    v.setUint32(16, 65535);
    v.setUint32(20, 65535);
    expect(fileModel(huge)).toEqual({ fail: 'too-large' });
    /* 先に別の問題（途中で切れている）があっても同じ */
    expect(fileModel(huge.subarray(0, huge.length - 6))).toEqual({ fail: 'too-large' });
  });

  it('PNG でないものは読めない', () => {
    expect(fileModel(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toEqual({ fail: 'not-png' });
  });

  it('比較の適応は、適応で符号化した大きさと同じ', () => {
    const m = model(
        encodeModel(grad(48, 32), 48, 32, { colorType: 2, filter: 'adaptive', level: 6, interlace: false }),
      ),
      c = compare(m.layout, m.raw, 6);
    expect(c.sizes[5]).toBe(m.zlib.length);
    expect(c.data[5]).toEqual(m.filtered);
    expect(c.types[0].every((t) => t === 0)).toBe(true);
  });
});

describe('画像に描く層', () => {
  const m = model(encodeModel(grad(32, 24), 32, 24, { colorType: 6, filter: 0, level: 6, interlace: false }));

  it('None の残差の画像は元の画素', () => {
    const r = residualImage(m.layout, m.filtered, m.types);
    for (let i = 0; i < 32 * 24; i++) for (let c = 0; c < 3; c++) expect(r[i * 4 + c]).toBe(m.rgba[i * 4 + c]);
  });

  it('画素ごとのビット数を足すと記号のビット数（終わりの符号を除く）', () => {
    const b = bitsPerPixelMap(m.layout, m.trace),
      T = m.trace.tokens;
    let s = 0;
    for (let i = 0; i < T.count; i++) if (T.kind[i] !== 2) s += T.nbits[i];
    expect(b.reduce((a, v) => a + v, 0)).toBeCloseTo(s, 1);
  });

  it('一致の距離を行と画素で言う', () => {
    const stride = 32 * 4 + 1;
    expect(distLabel(m, 1, stride)).toBe('↑ 1 行上');
    expect(distLabel(m, 1, 2 * stride)).toBe('↑ 2 行上');
    expect(distLabel(m, 1, 8)).toBe('← 2 画素');
    expect(distLabel(m, 1, 7)).toBe('距離 7');
  });
});

describe('見本', () => {
  it('試験図の各段は、狙ったフィルタで最も小さくなる', () => {
    const all = chart(),
      W = CHART_W,
      B = CHART_BAND;
    CHART_FILTERS.forEach((want, k) => {
      const band = all.slice(k * B * W * 4, (k + 1) * B * W * 4),
        sizes = ([0, 1, 2, 3, 4] as const).map(
          (f) => model(encodeModel(band, W, B, { colorType: 2, filter: f, level: 6, interlace: false })).zlib.length,
        );
      expect(sizes.indexOf(Math.min(...sizes))).toBe(want);
    });
  });

  it('画面とイラストはパレットにでき、写真風と試験図はできない', () => {
    const ok = (s: (typeof SAMPLES)[number]) =>
      !('fail' in encodeModel(s.draw(), s.w, s.h, { colorType: 3, filter: 'adaptive', level: 6, interlace: false }));
    expect(SAMPLES.map((s) => [s.id, ok(s)])).toEqual([
      ['chart', false],
      ['photo', false],
      ['screen', true],
      ['illust', true],
    ]);
  });
});

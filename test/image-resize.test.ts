import { describe, expect, it } from 'vitest';
import {
  axis,
  cubic,
  METHODS,
  methodOf,
  metric,
  mkImg,
  outSize,
  type Px,
  psnrOf,
  resample,
  step2x,
  step3x,
} from '../src/tools/image-resize/resample';
import { genChart, genPixel, genScene } from '../src/tools/image-resize/samples';

const gray = (w: number, h: number, f: (x: number, y: number) => number) => {
  const d: Px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = f(x, y);
      d.set([v, v, v, 255], (y * w + x) * 4);
    }
  return mkImg(w, h, d);
};
const FILTERS = METHODS.filter((m) => !m.pix);
const SCALES = [1 / 8, 1 / 3, 1 / 2, 1, 1.5, 2, 3, 8];

describe('重みの表', () => {
  it('どの手法でも出力ごとの重みの和は 1', () => {
    for (const m of FILTERS)
      for (const s of SCALES) {
        const n = Math.max(1, Math.round(16 * s)),
          a = axis(16, s, m, 0, n, true);
        for (let i = 0; i < n; i++) {
          let w = 0;
          for (let q = a.st[i]; q < a.st[i + 1]; q++) w += a.wt[q];
          expect(w, `${m.id} ${s}`).toBeCloseTo(1, 5);
        }
      }
  });

  it('端の外は端の画素を使う', () => {
    for (const m of FILTERS) {
      const a = axis(8, 2, m, 0, 16, true);
      for (const j of a.ix) {
        expect(j).toBeGreaterThanOrEqual(0);
        expect(j).toBeLessThan(8);
      }
    }
  });

  it('アンチエイリアスは縮小でカーネルを 1/倍率 に広げる', () => {
    const m = methodOf('lanczos3'),
      taps = (aa: boolean) => {
        const a = axis(256, 1 / 4, m, 16, 1, aa);
        return a.st[1] - a.st[0];
      };
    expect(taps(false)).toBeLessThanOrEqual(6);
    expect(taps(true)).toBeGreaterThanOrEqual(22);
  });

  it('拡大ではアンチエイリアスの設定によらない', () => {
    const m = methodOf('lanczos3');
    expect(axis(16, 2, m, 0, 32, true).wt).toEqual(axis(16, 2, m, 0, 32, false).wt);
  });
});

describe('カーネル', () => {
  it('3 次のカーネルの B と C が Mitchell-Netravali の式どおり', () => {
    /* B = 0 は補間で、整数の位置では 0 か 1 */
    expect(cubic(0, 0.5)(0)).toBeCloseTo(1, 12);
    expect(cubic(0, 0.5)(1)).toBeCloseTo(0, 12);
    /* B スプラインの中央は 2/3 で負にならない */
    expect(cubic(1, 0)(0)).toBeCloseTo(2 / 3, 12);
    for (let x = -2; x <= 2; x += 0.05) expect(cubic(1, 0)(x)).toBeGreaterThanOrEqual(-1e-12);
    /* k(0) = (6 − 2B) / 6 */
    expect(cubic(1 / 3, 1 / 3)(0)).toBeCloseTo(8 / 9, 12);
    /* Catmull-Rom の負の裾の最小は −0.074（x = 4/3） */
    expect(cubic(0, 0.5)(4 / 3)).toBeCloseTo(-2 / 27, 10);
  });

  it('Lanczos は 0 で 1、整数で 0、半径の外で 0', () => {
    const k = methodOf('lanczos3').k;
    expect(k(0)).toBe(1);
    for (const x of [1, 2, -1, -2]) expect(k(x)).toBeCloseTo(0, 12);
    expect(k(3)).toBe(0);
    expect(k(3.5)).toBe(0);
  });
});

describe('拡大縮小', () => {
  it('平らな画像は平らなまま', () => {
    const flat = gray(16, 16, () => 100);
    for (const m of METHODS)
      for (const s of SCALES) {
        const [w, h] = outSize(flat, s),
          r = resample(flat, s, m, { x: 0, y: 0, w: Math.min(w, 8), h: Math.min(h, 8) });
        for (let i = 0; i < r.length; i += 4) expect(Math.abs(r[i] - 100), `${m.id} ${s}`).toBeLessThanOrEqual(1);
      }
  });

  it('補間する手法の 1 倍は元のまま、B スプラインと Mitchell はぼける', () => {
    const src = genScene(),
      win = { x: 400, y: 200, w: 64, h: 64 },
      orig = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y++)
      orig.set(src.d.subarray(((y + 200) * src.w + 400) * 4, ((y + 200) * src.w + 464) * 4), y * 64 * 4);
    for (const id of ['nearest', 'box', 'bilinear', 'catrom', 'lanczos2', 'lanczos3'])
      expect(psnrOf(resample(src, 1, methodOf(id), win), orig), id).toBe(Infinity);
    for (const id of ['bspline', 'mitchell'])
      expect(psnrOf(resample(src, 1, methodOf(id), win), orig), id).toBeLessThan(60);
  });

  it('平均画素法の 1/2 は 4 画素の平均', () => {
    const img = gray(2, 2, (x, y) => [0, 100, 100, 200][y * 2 + x]);
    expect(resample(img, 0.5, methodOf('box'), { x: 0, y: 0, w: 1, h: 1 })[0]).toBe(100);
  });

  it('最近傍の整数倍はブロックのまま', () => {
    const img = gray(2, 1, (x) => (x ? 200 : 10)),
      r = resample(img, 3, methodOf('nearest'), { x: 0, y: 0, w: 6, h: 3 });
    expect([0, 1, 2, 3, 4, 5].map((i) => r[i * 4])).toEqual([10, 10, 10, 200, 200, 200]);
  });

  it('窓で計算しても全体の該当部分と同じ', () => {
    const src = genPixel();
    for (const m of METHODS)
      for (const s of [0.5, 1.5, 2, 3, 4]) {
        const [W, H] = outSize(src, s),
          win = { x: Math.floor(W / 3), y: Math.floor(H / 3), w: Math.floor(W / 3), h: Math.floor(H / 3) },
          all = resample(src, s, m, { x: 0, y: 0, w: W, h: H }),
          part = resample(src, s, m, win);
        let e = 0;
        for (let y = 0; y < win.h; y++)
          for (let x = 0; x < win.w * 4; x++)
            e = Math.max(e, Math.abs(part[y * win.w * 4 + x] - all[((y + win.y) * W + win.x) * 4 + x]));
        expect(e, `${m.id} ${s}`).toBeLessThanOrEqual(1);
      }
  });

  it('リンギング: Lanczos3 は段差の手前で元より下がり、バイリニアは下がらない', () => {
    /* 暗い側の値を浮かせて、負への行き過ぎが 0 で切れないようにする */
    const img = gray(16, 1, (x) => (x < 8 ? 60 : 200)),
      row = (id: string) =>
        [...resample(img, 8, methodOf(id), { x: 0, y: 0, w: 128, h: 1 })].filter((_, i) => i % 4 === 0);
    expect(Math.min(...row('lanczos3'))).toBeLessThan(55);
    expect(Math.max(...row('lanczos3'))).toBeGreaterThan(205);
    expect(Math.min(...row('bilinear'))).toBe(60);
    expect(Math.max(...row('bilinear'))).toBe(200);
  });

  it('リニア RGB: 白黒の縞の 1/2 は sRGB で 128、リニアで 188', () => {
    const img = gray(4, 2, (x) => (x % 2 ? 255 : 0)),
      win = { x: 0, y: 0, w: 1, h: 1 },
      box = methodOf('box');
    expect(resample(img, 0.5, box, win)[0]).toBe(128);
    expect(resample(img, 0.5, box, win, { lin: true })[0]).toBe(188);
  });
});

describe('ドット絵向け', () => {
  const K = 0xff000000,
    W = 0xffffffff;

  it('Scale2x の 4 つの規則', () => {
    /* 左と上が黒、右と下が白: 左上だけ黒が入る */
    const a = Uint32Array.from([K, K, W, K, W, W, W, W, W]),
      o = step2x(3, 3, a, false),
      at = (x: number, y: number) => o[y * 6 + x];
    expect([at(2, 2), at(3, 2), at(2, 3), at(3, 3)]).toEqual([K, W, W, W]);
    /* 縦の線の真ん中（B と H が同じ）は変えない */
    const v = Uint32Array.from([W, K, W, W, K, W, W, K, W]),
      p = step2x(3, 3, v, false);
    expect([p[1 * 6 * 2 + 2], p[1 * 6 * 2 + 3], p[3 * 6 + 2], p[3 * 6 + 3]]).toEqual([K, K, K, K]);
  });

  it('Eagle は斜めの 3 画素が同じ色なら角を塗る', () => {
    /* 左・左上・上が黒: 左上の角だけ黒 */
    const a = Uint32Array.from([K, K, W, K, W, W, W, W, W]),
      o = step2x(3, 3, a, true);
    expect([o[2 * 6 + 2], o[2 * 6 + 3], o[3 * 6 + 2], o[3 * 6 + 3]]).toEqual([K, W, W, W]);
  });

  it('Scale3x は中央を変えず、斜めの段の角を埋める', () => {
    const a = Uint32Array.from([K, K, W, K, W, W, W, W, W]),
      o = step3x(3, 3, a);
    expect(o[3 * 9 + 3]).toBe(K);
    expect(o[4 * 9 + 4]).toBe(W);
    expect(o[5 * 9 + 5]).toBe(W);
  });

  it('1 倍以下は最近傍と同じ', () => {
    const src = genPixel(),
      win = { x: 0, y: 0, w: 32, h: 24 };
    expect(resample(src, 0.5, methodOf('scale2x'), win)).toEqual(resample(src, 0.5, methodOf('nearest'), win));
  });

  it('ドット絵の階段を Scale2x は最近傍より崩さない', () => {
    /* 拡大の PSNR は往復で測る。平らな色の絵なので最近傍と大きくは変わらない */
    const src = genPixel(),
      a = metric('t-pix', src, 2, methodOf('scale2x')) as number,
      b = metric('t-pix', src, 2, methodOf('nearest')) as number;
    expect(a).toBeGreaterThan(b - 3);
  });
});

describe('正解との PSNR', () => {
  it('1 倍は null', () => {
    expect(metric('t-ch', genPixel(), 1, methodOf('lanczos3'))).toBeNull();
  });

  it('縮小: 試験図で間引きはアンチエイリアスより基準から遠い', () => {
    const ch = genChart(),
      p = (id: string, aa = true) => metric('t-ch2', ch, 0.25, methodOf(id), { aa }) as number;
    expect(p('nearest')).toBeLessThan(p('bilinear'));
    expect(p('bilinear')).toBeLessThan(p('lanczos3'));
    /* アンチエイリアスをやめると基準から遠くなる */
    expect(p('lanczos3', false)).toBeLessThan(p('lanczos3') - 10);
  });

  it('拡大: 風景で Lanczos3 は最近傍より元に近い', () => {
    const src = genScene(),
      p = (id: string) => metric('t-sc', src, 4, methodOf(id)) as number;
    expect(p('lanczos3')).toBeGreaterThan(p('nearest'));
  });
});

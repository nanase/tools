import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter, ByteWriter } from '../src/tools/jpeg/bits';
import { blockInfo, compBlock } from '../src/tools/jpeg/block';
import { downsample, rgbToYcc, upsample, yccToRgb } from '../src/tools/jpeg/color';
import { basis, dequantIdct, fdct, idct, quantize, roundHalfAway } from '../src/tools/jpeg/dct';
import { decode } from '../src/tools/jpeg/decoder';
import { encode, forEachBlock, prevBlock } from '../src/tools/jpeg/encoder';
import { blockSymbols, scanBlock } from '../src/tools/jpeg/entropy';
import { bitStr, buildCodes, category, extend, extraBits, optimalSpec } from '../src/tools/jpeg/huffman';
import { bitsImage, diffImage, psnr, ramp } from '../src/tools/jpeg/metrics';
import {
  AC_CHR,
  AC_LUM,
  DC_CHR,
  DC_LUM,
  K1,
  K2,
  qualityScale,
  quantTables,
  ZIGZAG,
  ZZ_OF,
} from '../src/tools/jpeg/tables';

/** 決まった種から作る疑似乱数（xorshift） */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2 ** 32;
  };
}
/** 試験用の画像: なめらかな模様に雑音を足したもの */
function testImage(w: number, h: number, seed = 1, noise = 40): Uint8ClampedArray {
  const r = rng(seed),
    d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = 128 + 100 * Math.sin(x / 7) + (r() - 0.5) * noise;
      d[i + 1] = 128 + 100 * Math.cos(y / 5) + (r() - 0.5) * noise;
      d[i + 2] = (x * 255) / w + (r() - 0.5) * noise;
      d[i + 3] = 255;
    }
  return d;
}
const flat = (w: number, h: number, rgb: [number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([...rgb, 255], i * 4);
  return d;
};
const codeOf = (s: Parameters<typeof buildCodes>[0], sym: number) => {
  const c = buildCodes(s);
  return bitStr(c.code[sym], c.len[sym]);
};

describe('表', () => {
  it('ジグザグ順は 0〜63 の並べ替えで、斜めに往復する', () => {
    expect([...ZIGZAG].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(ZIGZAG.slice(0, 10)).toEqual([0, 1, 8, 16, 9, 2, 3, 10, 17, 24]);
    expect(ZIGZAG[63]).toBe(63);
    for (let k = 0; k < 64; k++) expect(ZZ_OF[ZIGZAG[k]]).toBe(k);
    /* 隣り合う位置は縦横か斜めに 1 つずつ */
    for (let k = 1; k < 64; k++) {
      const a = ZIGZAG[k - 1],
        b = ZIGZAG[k];
      expect(Math.max(Math.abs((a % 8) - (b % 8)), Math.abs((a >> 3) - (b >> 3)))).toBe(1);
    }
  });

  it('IJG の品質の倍率: 50 で 100 %、75 で 50 %、10 で 500 %', () => {
    expect(qualityScale(50)).toBe(100);
    expect(qualityScale(75)).toBe(50);
    expect(qualityScale(10)).toBe(500);
    expect(qualityScale(1)).toBe(5000);
    expect(qualityScale(100)).toBe(0);
  });

  it('品質 50 は Annex K の表そのもの、75 は IJG の既定の表、100 はすべて 1、1 は 255 で頭打ち', () => {
    const [l50, c50] = quantTables(50, 'k');
    expect([...l50]).toEqual(K1);
    expect([...c50]).toEqual(K2);
    expect([...quantTables(75, 'k')[0].slice(0, 8)]).toEqual([8, 6, 5, 8, 12, 20, 26, 31]);
    expect([...quantTables(75, 'k')[1].slice(0, 8)]).toEqual([9, 9, 12, 24, 50, 50, 50, 50]);
    expect([...quantTables(100, 'k')[0]].every((x) => x === 1)).toBe(true);
    expect(Math.max(...quantTables(1, 'k')[0])).toBe(255);
    expect([...quantTables(50, 'flat')[0]].every((x) => x === 16)).toBe(true);
  });

  it('Annex K のハフマン表の符号（K.3〜K.6）', () => {
    expect(DC_LUM.vals.length).toBe(DC_LUM.bits.reduce((a, b) => a + b));
    expect(AC_LUM.bits.reduce((a, b) => a + b)).toBe(162);
    expect(AC_CHR.bits.reduce((a, b) => a + b)).toBe(162);
    /* K.3 輝度の DC */
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((s) => codeOf(DC_LUM, s))).toEqual([
      '00',
      '010',
      '011',
      '100',
      '101',
      '110',
      '1110',
      '11110',
      '111110',
      '1111110',
      '11111110',
      '111111110',
    ]);
    /* K.4 色差の DC */
    expect(codeOf(DC_CHR, 0)).toBe('00');
    expect(codeOf(DC_CHR, 2)).toBe('10');
    expect(codeOf(DC_CHR, 3)).toBe('110');
    expect(codeOf(DC_CHR, 11)).toBe('11111111110');
    /* K.5 輝度の AC */
    expect(codeOf(AC_LUM, 0x00)).toBe('1010');
    expect(codeOf(AC_LUM, 0x01)).toBe('00');
    expect(codeOf(AC_LUM, 0x02)).toBe('01');
    expect(codeOf(AC_LUM, 0x03)).toBe('100');
    expect(codeOf(AC_LUM, 0x04)).toBe('1011');
    expect(codeOf(AC_LUM, 0x11)).toBe('1100');
    expect(codeOf(AC_LUM, 0xf0)).toBe('11111111001');
    expect(codeOf(AC_LUM, 0xfa)).toBe('1111111111111110');
    /* K.6 色差の AC */
    expect(codeOf(AC_CHR, 0x00)).toBe('00');
    expect(codeOf(AC_CHR, 0x01)).toBe('01');
    expect(codeOf(AC_CHR, 0x02)).toBe('100');
    expect(codeOf(AC_CHR, 0xf0)).toBe('1111111010');
  });
});

describe('DCT', () => {
  it('DCT → IDCT で元に戻る', () => {
    const r = rng(7),
      f = Array.from({ length: 64 }, () => r() * 255 - 128);
    const g = idct(fdct(f));
    for (let i = 0; i < 64; i++) expect(g[i]).toBeCloseTo(f[i], 9);
  });

  it('一様なブロックは直流だけ（F(0,0) = 8 × 値）、エネルギーは保存する', () => {
    const F = fdct(new Array(64).fill(-100));
    expect(F[0]).toBeCloseTo(-800, 9);
    for (let i = 1; i < 64; i++) expect(Math.abs(F[i])).toBeLessThan(1e-9);
    const r = rng(3),
      f = Array.from({ length: 64 }, () => r() * 200 - 100),
      G = fdct(f);
    const e = (a: ArrayLike<number>) => Array.from(a).reduce((s, x) => s + x * x, 0);
    expect(e(G)).toBeCloseTo(e(f), 6);
  });

  it('基底は正規直交で、基底 (u, v) の変換は係数 (u, v) だけ', () => {
    for (const [u, v] of [
      [0, 0],
      [3, 1],
      [7, 7],
    ]) {
      const b = basis(u, v),
        F = fdct(b);
      for (let i = 0; i < 64; i++) expect(F[i]).toBeCloseTo(i === v * 8 + u ? 1 : 0, 9);
    }
  });

  it('量子化は 0 から遠い側へ丸め、逆量子化と IDCT で水準を戻す', () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(-0.4)).toBe(0);
    const S = quantize([-1024, 33, -8, ...new Array(61).fill(0)], [16, 11, 10, ...new Array(61).fill(16)]);
    expect([...S.slice(0, 3)]).toEqual([-64, 3, -1]);
    const g = dequantIdct(
      quantize(
        new Array(64).fill(0).map((_, i) => (i ? 0 : -400)),
        K1,
      ),
      K1,
    );
    expect(g[0]).toBeCloseTo(78, 9);
  });
});

describe('色', () => {
  it('JFIF の式: 灰色は Cb = Cr = 128、行き来で戻る', () => {
    expect(rgbToYcc(200, 200, 200)).toEqual([expect.closeTo(200, 9), expect.closeTo(128, 9), expect.closeTo(128, 9)]);
    const [y, cb, cr] = rgbToYcc(255, 0, 0);
    expect(y).toBeCloseTo(76.245, 9);
    expect(cb).toBeCloseTo(84.97, 2);
    expect(cr).toBeCloseTo(255.5, 9);
    const back = yccToRgb(...rgbToYcc(12, 200, 99));
    expect(back[0]).toBeCloseTo(12, 2);
    expect(back[1]).toBeCloseTo(200, 2);
    expect(back[2]).toBeCloseTo(99, 2);
  });

  it('間引きは平均、補間の線形は 3:1 の重み', () => {
    const p = { w: 4, h: 2, d: Uint8Array.from([0, 4, 8, 8, 4, 8, 8, 8]) };
    expect([...downsample(p, 2, 2).d]).toEqual([4, 8]);
    expect([...downsample(p, 2, 1).d]).toEqual([2, 8, 6, 8]);
    const q = { w: 2, h: 1, d: Uint8Array.from([0, 100]) };
    expect([...upsample(q, 2, 1, 'near')]).toEqual([0, 0, 100, 100]);
    expect([...upsample(q, 2, 1, 'lin')]).toEqual([0, 25, 75, 100]);
  });
});

describe('ハフマン符号', () => {
  it('SSSS と付加ビット（負は 1 の補数）', () => {
    expect([0, 1, -1, 2, 3, -3, 4, 255, -1024].map(category)).toEqual([0, 1, 1, 2, 2, 2, 3, 8, 11]);
    expect(bitStr(extraBits(-1, 1), 1)).toBe('0');
    expect(bitStr(extraBits(-3, 2), 2)).toBe('00');
    expect(bitStr(extraBits(-2, 2), 2)).toBe('01');
    expect(bitStr(extraBits(5, 3), 3)).toBe('101');
    for (const x of [-1023, -64, -5, -1, 1, 7, 64, 1023]) {
      const s = category(x);
      expect(extend(extraBits(x, s), s)).toBe(x);
    }
  });

  it('最適な表は 16 ビット以下で、すべて 1 の符号を使わず、頻度の高い記号ほど短い', () => {
    const fr = new Array(256).fill(0);
    fr[0] = 1000;
    fr[1] = 500;
    fr[2] = 100;
    for (let i = 3; i < 200; i++) fr[i] = 1;
    const s = optimalSpec(fr),
      c = buildCodes(s);
    expect(s.vals.length).toBe(200);
    expect(s.bits.reduce((a, b) => a + b)).toBe(200);
    for (let i = 0; i < 200; i++) {
      expect(c.len[i]).toBeGreaterThan(0);
      expect(c.len[i]).toBeLessThanOrEqual(16);
      expect(c.code[i]).not.toBe((1 << c.len[i]) - 1);
    }
    expect(c.len[0]).toBeLessThanOrEqual(c.len[1]);
    expect(c.len[1]).toBeLessThanOrEqual(c.len[2]);
    /* クラフトの不等式（すべて 1 の符号を除くので < 1） */
    let k = 0;
    for (let i = 0; i < 200; i++) k += 2 ** -c.len[i];
    expect(k).toBeLessThan(1);
    /* 記号が 1 つでも符号は 1 ビット */
    const one = optimalSpec(Object.assign(new Array(256).fill(0), { 0: 9 }));
    expect(one.bits[0]).toBe(1);
    expect(one.vals).toEqual([0]);
  });
});

describe('記号化', () => {
  it('DC の差分、AC のランと大きさ、ZRL・EOB', () => {
    const c = new Int16Array(64);
    c[0] = 20;
    c[ZIGZAG[1]] = -3;
    c[ZIGZAG[4]] = 1;
    c[ZIGZAG[30]] = 2;
    const syms: [boolean, number, number, number, number][] = [];
    scanBlock(c, 0, 15, (...a) => syms.push(a));
    expect(syms).toEqual([
      [true, 3, 5, 3, 0],
      [false, 0x02, 0, 2, 1],
      [false, 0x21, 1, 1, 4],
      [false, 0xf0, 0, 0, 20],
      [false, 0x92, 2, 2, 30],
      [false, 0x00, 0, 0, 31],
    ]);
    const s = blockSymbols(c, 15, buildCodes(DC_LUM), buildCodes(AC_LUM));
    expect(s.map((x) => x.kind)).toEqual(['dc', 'ac', 'ac', 'zrl', 'ac', 'eob']);
    expect(s[0]).toMatchObject({ val: 5, size: 3, code: '100', extra: '101' });
    expect(s[1]).toMatchObject({ val: -3, run: 0, size: 2, code: '01', extra: '00' });
    expect(s[5].code).toBe('1010');
  });

  it('最後の係数が 0 でなければ EOB を出さない', () => {
    const c = new Int16Array(64);
    c[63] = 1;
    const syms: number[] = [];
    scanBlock(c, 0, 0, (_dc, sym) => syms.push(sym));
    expect(syms).toEqual([0, 0xf0, 0xf0, 0xf0, 0xe1]);
  });
});

describe('ビット列', () => {
  it('0xFF の後に 0x00 を挟み、最後は 1 で埋める。読むときは外す', () => {
    const w = new ByteWriter(),
      b = new BitWriter(w);
    b.put(0xff, 8);
    b.put(0b101, 3);
    expect(b.finish()).toBe(5);
    expect([...w.out()]).toEqual([0xff, 0x00, 0xbf]);
    expect(b.stuffed).toBe(1);
    const r = new BitReader(w.out(), 0);
    expect(r.read(8)).toBe(0xff);
    expect(r.read(3)).toBe(0b101);
  });
});

describe('符号器と復号器', () => {
  it('マーカーの並びと JFIF 1.02 のヘッダ', () => {
    const e = encode(testImage(40, 24), 40, 24, { q: 75, sub: '420', qt: 'k', huff: 'std' });
    expect(e.segs.map((s) => s.name)).toEqual(['SOI', 'APP0', 'DQT', 'SOF0', 'DHT', 'SOS', 'ECS', 'EOI']);
    const b = e.bytes;
    expect([b[0], b[1], b[2], b[3]]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(String.fromCharCode(...b.subarray(6, 10))).toBe('JFIF');
    expect([b[11], b[12]]).toEqual([1, 2]);
    expect([b[b.length - 2], b[b.length - 1]]).toEqual([0xff, 0xd9]);
    /* 区切りは隙間なく並ぶ */
    let off = 0;
    for (const s of e.segs) {
      expect(s.off).toBe(off);
      off += s.len;
    }
    expect(off).toBe(b.length);
    /* 標準のヘッダは 609 バイト（SOI 2・APP0 18・DQT 134・SOF0 19・DHT 420・SOS 14・EOI 2） */
    expect(e.segs.filter((s) => s.name !== 'ECS').map((s) => s.len)).toEqual([2, 18, 134, 19, 420, 14, 2]);
    const d = decode(b);
    expect(d.markers).toEqual(['SOI', 'APP0', 'DQT', 'SOF0', 'DHT', 'SOS', 'EOI']);
    expect(d.jfif).toBe('1.02');
    expect([d.w, d.h]).toEqual([40, 24]);
  });

  it('一様な灰色の 8×8 は 14 ビット（Y: 00 1010、Cb・Cr: 00 00）で、全体は 611 バイト', () => {
    const e = encode(flat(8, 8, [128, 128, 128]), 8, 8, { q: 50, sub: '444', qt: 'k', huff: 'std' });
    expect(e.comps.map((c) => c.bits[0])).toEqual([6, 4, 4]);
    expect(e.pad).toBe(2);
    expect(e.ecs).toBe(2);
    expect([...e.bytes.subarray(e.bytes.length - 4)]).toEqual([0x28, 0x03, 0xff, 0xd9]);
    expect(e.bytes.length).toBe(611);
  });

  it('黒の 8×8 は Y の DC が −64（SSSS 7、11110 0111111）、全体で 24 ビット', () => {
    const e = encode(flat(8, 8, [0, 0, 0]), 8, 8, { q: 50, sub: '444', qt: 'k', huff: 'std' });
    expect(e.comps[0].coef[0]).toBe(-64);
    expect(e.comps.map((c) => c.bits[0])).toEqual([16, 4, 4]);
    expect(e.pad).toBe(0);
    expect([...e.bytes.subarray(e.bytes.length - 5, e.bytes.length - 2)]).toEqual([0xf3, 0xfa, 0x00]);
  });

  for (const sub of ['444', '422', '420'] as const)
    for (const huff of ['std', 'opt'] as const)
      it(`作ったビット列を復号器で戻すと係数と画素が一致する（${sub}・${huff}）`, () => {
        const w = 53,
          h = 37,
          img = testImage(w, h, 11, 120);
        const e = encode(img, w, h, { q: 85, sub, qt: 'k', huff });
        const d = decode(e.bytes, 'near');
        expect(d.comps.length).toBe(3);
        e.comps.forEach((c, i) => {
          expect(d.comps[i].bw).toBe(c.bw);
          expect(d.comps[i].bh).toBe(c.bh);
          expect(d.comps[i].coef).toEqual(c.coef);
          expect([d.comps[i].h, d.comps[i].v]).toEqual([c.h, c.v]);
        });
        /* ビット数の数え: 符号化したデータ = ビット数 + 埋め + 挟んだ 0x00 */
        const bits = e.comps.reduce((s, c) => s + c.dcBits + c.acBits, 0);
        expect(e.comps.reduce((s, c) => s + c.bits.reduce((a, b) => a + b, 0), 0)).toBe(bits);
        expect((bits + e.pad) / 8 + e.stuffed).toBe(e.ecs);
        /* 画素: 復号器の Y の面は、係数を自分で逆量子化・逆変換したものと同じ */
        const Q = e.qt[0],
          y = d.comps[0];
        for (const b of [0, 5, y.bw * y.bh - 1]) {
          const f = dequantIdct(e.comps[0].coef.subarray(b * 64, b * 64 + 64), Q),
            bx = b % y.bw,
            by = Math.floor(b / y.bw);
          for (let k = 0; k < 64; k++)
            expect(y.plane.d[(by * 8 + (k >> 3)) * y.plane.w + bx * 8 + (k & 7)]).toBe(
              Math.min(255, Math.max(0, Math.round(f[k]))),
            );
        }
      });

  it('最適化したハフマン表は標準の表より短い', () => {
    const img = testImage(64, 48, 5);
    const a = encode(img, 64, 48, { q: 75, sub: '420', qt: 'k', huff: 'std' }),
      b = encode(img, 64, 48, { q: 75, sub: '420', qt: 'k', huff: 'opt' });
    expect(b.ecs).toBeLessThan(a.ecs);
    expect(b.comps[0].coef).toEqual(a.comps[0].coef);
  });

  it('品質 100・4:4:4 なら元の画像に近く、品質を下げると小さくなり誤差が増える', () => {
    const w = 48,
      h = 32,
      img = testImage(w, h, 2, 20);
    const sizes: number[] = [],
      ps: number[] = [];
    for (const q of [100, 75, 25, 5]) {
      const e = encode(img, w, h, { q, sub: '444', qt: 'k', huff: 'std' });
      const d = decode(e.bytes);
      sizes.push(e.bytes.length);
      ps.push(psnr(img, d.rgba, 'rgb'));
    }
    expect(ps[0]).toBeGreaterThan(42);
    for (let i = 1; i < 4; i++) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1]);
      expect(ps[i]).toBeLessThan(ps[i - 1]);
    }
  });

  it('走査の順と、DC の予測に使う 1 つ前のブロック', () => {
    const e = encode(testImage(40, 24), 40, 24, { q: 50, sub: '420', qt: 'k', huff: 'std' });
    expect([e.mx, e.my]).toEqual([3, 2]);
    expect(e.comps.map((c) => [c.bw, c.bh])).toEqual([
      [6, 4],
      [3, 2],
      [3, 2],
    ]);
    const order: string[] = [];
    forEachBlock(e, (ci, b) => order.push(`${ci}:${b}`));
    expect(order.slice(0, 8)).toEqual(['0:0', '0:1', '0:6', '0:7', '1:0', '2:0', '0:2', '0:3']);
    /* 各成分の走査の順で、1 つ前のブロックが prevBlock と同じ */
    e.comps.forEach((c, ci) => {
      let last = -1;
      forEachBlock(e, (cj, b) => {
        if (cj !== ci) return;
        expect(prevBlock(c, e.mx, b % c.bw, Math.floor(b / c.bw))).toBe(last);
        last = b;
      });
    });
  });
});

describe('選んだブロックの途中の値', () => {
  it('記号のビット数の和はブロックのビット数、DC の予測は 1 つ前のブロックの DC', () => {
    const w = 40,
      h = 24,
      e = encode(testImage(w, h, 9, 60), w, h, { q: 60, sub: '420', qt: 'k', huff: 'opt' });
    for (let ci = 0; ci < 3; ci++) {
      const c = e.comps[ci];
      for (let by = 0; by < c.bh; by++)
        for (let bx = 0; bx < c.bw; bx++) {
          const b = blockInfo(e, ci, bx, by);
          expect(b.syms.reduce((s, x) => s + x.code.length + x.extra.length, 0)).toBe(b.bits);
          expect(b.syms[0].val).toBe(b.S[0] - b.pred);
          const pb = prevBlock(c, e.mx, bx, by);
          expect(b.pred).toBe(pb < 0 ? 0 : c.coef[pb * 64]);
          /* DCT 係数を量子化すると、符号器の係数と同じ */
          for (let i = 0; i < 64; i++) expect(roundHalfAway(b.F[i] / b.Q[i])).toBe(b.S[i]);
        }
    }
    /* Y のブロック (3, 1) を含む色差のブロックは (1, 0) */
    expect(compBlock(e, 1, 3, 1)).toEqual([1, 0]);
    expect(compBlock(e, 0, 3, 1)).toEqual([3, 1]);
  });
});

describe('画質の指標と図', () => {
  it('PSNR: 同じなら ∞、差が一様に 1 なら 48.13 dB', () => {
    const a = flat(4, 4, [10, 20, 30]),
      b = flat(4, 4, [11, 21, 31]);
    expect(psnr(a, a, 'rgb')).toBe(Infinity);
    expect(psnr(a, b, 'rgb')).toBeCloseTo(10 * Math.log10(255 * 255), 9);
    expect(psnr(a, b, 'y')).toBeCloseTo(10 * Math.log10(255 * 255), 6);
  });

  it('差の画像は 128 が 0、ビット数の地図は 8×8 画素ごとに同じ色', () => {
    const a = flat(2, 1, [100, 100, 100]),
      b = flat(2, 1, [101, 99, 100]);
    expect([...diffImage(a, b, 4).slice(0, 4)]).toEqual([132, 124, 128, 255]);
    const stops = [
      [0, 0, 0],
      [255, 255, 255],
    ] as const;
    expect(ramp(stops, 0.5)).toEqual([127.5, 127.5, 127.5]);
    const m = bitsImage([0, 100], 2, 16, 8, 100, stops);
    expect([...m.slice(0, 3)]).toEqual([0, 0, 0]);
    expect([...m.slice(8 * 4, 8 * 4 + 3)]).toEqual([255, 255, 255]);
    expect([...m.slice((7 * 16 + 15) * 4, (7 * 16 + 15) * 4 + 3)]).toEqual([255, 255, 255]);
  });
});

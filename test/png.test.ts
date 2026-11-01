import { constants, deflateRawSync, deflateSync, inflateRawSync, inflateSync, crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { adam7Passes, adam7PassOf } from '../src/tools/png/adam7';
import { adler32 } from '../src/tools/png/adler32';
import { BitReader, BitWriter } from '../src/tools/png/bits';
import { deflate, LEVELS } from '../src/tools/png/deflate';
import { FILTER_NAMES, type FilterType, filterImage, paeth, unfilterImage } from '../src/tools/png/filter';
import { buildDecoder, canonicalCodes, codeLengths, reverseBits } from '../src/tools/png/huffman';
import { InflateError, inflate } from '../src/tools/png/inflate';
import {
  type ColorType,
  decodePng,
  encodePng,
  idatToFile,
  PNG_SIGNATURE,
  type PngEncoded,
  PngError,
} from '../src/tools/png/png';
import {
  TK_END,
  TK_LIT,
  TK_MATCH,
  TK_STORED,
  tokenAt,
  tokenAtBit,
  tokenAtPos,
  tokenBytes,
} from '../src/tools/png/trace';
import { zlibCompress, zlibDecompress } from '../src/tools/png/zlib';

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
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const randomBytes = (n: number, seed = 1) => {
  const r = rng(seed);
  return Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
};
/** 試験用の画像: なめらかな模様に雑音を足したもの */
function testImage(w: number, h: number, seed = 1, noise = 40, alpha = false): Uint8ClampedArray {
  const r = rng(seed),
    d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = 128 + 100 * Math.sin(x / 7) + (r() - 0.5) * noise;
      d[i + 1] = 128 + 100 * Math.cos(y / 5) + (r() - 0.5) * noise;
      d[i + 2] = (x * 255) / w + (r() - 0.5) * noise;
      d[i + 3] = alpha ? (x * 255) / Math.max(1, w - 1) : 255;
    }
  return d;
}

/** 入力の見本 */
const SAMPLES: [string, Uint8Array][] = (() => {
  const text = ascii(
    'PNG は行ごとにフィルタをかけてから Deflate で縮める。'.repeat(1) +
      'the quick brown fox jumps over the lazy dog. '.repeat(200),
  );
  const rep = new Uint8Array(5000).fill(0x41);
  const abab = Uint8Array.from({ length: 3000 }, (_, i) => (i % 3 === 0 ? 1 : i % 7));
  /* 32 KiB ちょうど・それを超える距離で同じ列が現れる */
  const far = randomBytes(70000, 5);
  far.set(far.subarray(0, 300), 32768);
  far.set(far.subarray(100, 400), 32769 + 32768);
  const img = testImage(300, 20, 3, 20);
  const rows = new Uint8Array(img.buffer);
  return [
    ['空', new Uint8Array(0)],
    ['1 バイト', Uint8Array.of(42)],
    ['2 バイト', Uint8Array.of(1, 2)],
    ['全部同じ', rep],
    ['繰り返し', abab],
    ['乱数', randomBytes(20000, 2)],
    ['テキスト', text],
    ['遠い距離', far],
    ['画像の行', rows],
  ];
})();

describe('Adler-32', () => {
  it('既知の値: "Wikipedia" は 0x11E60398、空は 1', () => {
    expect(adler32(ascii('Wikipedia'))).toBe(0x11e60398);
    expect(adler32(new Uint8Array(0))).toBe(1);
  });
  it('長い列でも node の zlib の末尾と一致する', () => {
    const d = randomBytes(200000, 9),
      z = deflateSync(d),
      tail = ((z[z.length - 4] << 24) | (z[z.length - 3] << 16) | (z[z.length - 2] << 8) | z[z.length - 1]) >>> 0;
    expect(adler32(d)).toBe(tail);
  });
});

describe('ビット列', () => {
  it('下位ビットから詰め、読み手で同じ値に戻る', () => {
    const w = new BitWriter();
    w.put(1, 1);
    w.put(2, 2);
    w.put(0x1234, 16);
    w.put(5, 3);
    expect(w.bits).toBe(22);
    const b = w.out();
    expect(b[0] & 0b111).toBe(0b101);
    const r = new BitReader(b);
    expect([r.read(1), r.read(2), r.read(16), r.read(3)]).toEqual([1, 2, 0x1234, 5]);
    expect(r.over).toBe(false);
    r.read(10);
    expect(r.over).toBe(true);
  });
  it('reverseBits', () => {
    expect(reverseBits(0b1101, 4)).toBe(0b1011);
    expect(reverseBits(1, 7)).toBe(64);
  });
});

describe('ハフマン符号', () => {
  it('RFC 1951 3.2.2 の例: 長さ (3,3,3,3,3,2,4,4) の正準符号', () => {
    const c = canonicalCodes([3, 3, 3, 3, 3, 2, 4, 4]);
    expect(Array.from(c)).toEqual([0b010, 0b011, 0b100, 0b101, 0b110, 0b00, 0b1110, 0b1111]);
  });
  it('出現回数から作った長さは上限以下で、完全な符号になる', () => {
    const r = rng(7);
    for (const [n, max] of [
      [286, 15],
      [30, 15],
      [19, 7],
    ]) {
      for (let k = 0; k < 20; k++) {
        /* フィボナッチ風の偏った回数で深い木を作る */
        const f = Array.from({ length: n }, (_, i) => (k % 2 ? Math.floor(1.6 ** (i % 40)) : Math.floor(r() * 1000)));
        const lens = codeLengths(f, max);
        expect(Math.max(...lens)).toBeLessThanOrEqual(max);
        const d = buildDecoder(lens);
        expect(d.left).toBe(0);
        /* 多いものほど短い */
        let bad = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (f[i] > f[j] && f[j] > 0 && lens[i] > lens[j]) bad++;
        expect(bad).toBe(0);
      }
    }
  });
  it('記号が 1 つ・0 個でも長さ 1 の符号を 2 つ作る', () => {
    expect(Array.from(codeLengths([0, 0, 5, 0], 15))).toEqual([1, 0, 1, 0]);
    expect(Array.from(codeLengths([0, 0, 0], 15))).toEqual([1, 1, 0]);
  });
});

describe('Deflate の符号化', () => {
  for (const [name, d] of SAMPLES)
    it(`${name}: level 0〜9 を node の zlib で戻せる`, () => {
      for (let level = 0; level <= 9; level++) {
        const e = deflate(d, { level });
        expect(Buffer.from(inflateRawSync(e.data)).equals(Buffer.from(d))).toBe(true);
        expect(Math.ceil(e.bits / 8)).toBe(e.data.length);
        /* 記録を取らなくても同じ出力 */
        expect(Buffer.from(deflate(d, { level, trace: false }).data).equals(Buffer.from(e.data))).toBe(true);
      }
    });

  it('小さいブロックに分けても戻せ、ブロックごとに最も短い種類を選ぶ', () => {
    const d = SAMPLES.find((s) => s[0] === '画像の行')?.[1] as Uint8Array;
    const e = deflate(d, { level: 6, blockSymbols: 500 });
    expect(Buffer.from(inflateRawSync(e.data)).equals(Buffer.from(d))).toBe(true);
    const bl = e.trace?.blocks ?? [];
    expect(bl.length).toBeGreaterThan(5);
    expect(bl.filter((b) => b.final).length).toBe(1);
    expect(bl[bl.length - 1].final).toBe(true);
    for (const b of bl) {
      const s = b.sizes;
      expect(s).not.toBeNull();
      if (!s) continue;
      expect(b.end - b.start).toBe(s[b.type]);
      expect(s[b.type]).toBe(Math.min(s.stored, s.fixed, s.dynamic));
    }
    /* 乱数は stored、短いテキストは fixed になる */
    expect(deflate(randomBytes(3000), { level: 6 }).trace?.blocks[0].type).toBe('stored');
    expect(deflate(ascii('abcabcabc'), { level: 6 }).trace?.blocks[0].type).toBe('fixed');
    expect(deflate(SAMPLES[6][1], { level: 6 }).trace?.blocks[0].type).toBe('dynamic');
  });

  it('記録: ブロックと記号のビット位置がつながり、記号から元データに戻せる', () => {
    for (const [, d] of SAMPLES) {
      for (const level of [0, 1, 6, 9]) {
        const e = deflate(d, { level }),
          tr = e.trace;
        if (!tr) throw new Error('記録がない');
        const t = tr.tokens,
          out: number[] = [];
        let bit = 0;
        for (const [bi, b] of tr.blocks.entries()) {
          expect(b.start).toBe(bit);
          bit = b.end;
          for (let i = b.tokenStart; i < b.tokenEnd; i++) expect(t.block[i]).toBe(bi);
          if (b.type === 'dynamic') {
            expect(b.litLens?.length).toBe(b.hlit + 257);
            expect(b.distLens?.length).toBe(b.hdist + 1);
            expect(b.clLens?.length).toBe(19);
          }
        }
        expect(bit).toBe(e.bits);
        let bad = 0;
        for (let i = 0; i < t.count; i++) {
          const k = tokenAt(t, i);
          if (k.pos !== out.length) bad++;
          /* 同じブロックの中では次の記号がすぐ後に続く */
          if (i + 1 < t.count && t.kind[i] !== TK_STORED && t.kind[i] !== TK_END && t.bit[i + 1] !== k.bit + k.nbits)
            bad++;
          if (k.kind === 'lit') out.push(k.sym);
          else if (k.kind === 'match') {
            if (k.nbits !== k.codeLen + k.lenExtraBits + k.dcodeLen + k.distExtraBits) bad++;
            for (let j = 0; j < k.len; j++) out.push(out[out.length - k.dist]);
          } else if (k.kind === 'stored') for (let j = 0; j < k.len; j++) out.push(d[k.pos + j]);
        }
        expect(bad).toBe(0);
        expect(out.length).toBe(d.length);
        expect(Buffer.from(out).equals(Buffer.from(d))).toBe(true);
      }
    }
  });

  it('記号の符号は記録の符号長から作った正準符号と同じ', () => {
    const e = deflate(SAMPLES[6][1], { level: 6 }),
      tr = e.trace;
    if (!tr) throw new Error('記録がない');
    const b = tr.blocks[0],
      lc = canonicalCodes(b.litLens as Uint8Array),
      dc = canonicalCodes(b.distLens as Uint8Array);
    for (let i = b.tokenStart; i < b.tokenEnd; i++) {
      const k = tokenAt(tr.tokens, i);
      expect(k.code).toBe(lc[k.sym]);
      if (k.kind === 'match') expect(k.dcode).toBe(dc[k.dsym]);
    }
  });

  it('距離 32768 ちょうどの一致を使い、32769 は使わない', () => {
    const d = new Uint8Array(32768 + 300);
    const r = rng(11);
    for (let i = 0; i < 32768; i++) d[i] = Math.floor(r() * 256);
    d.set(d.subarray(0, 300), 32768);
    const t = deflate(d, { level: 9 }).trace?.tokens;
    if (!t) throw new Error('記録がない');
    let max = 0;
    for (let i = 0; i < t.count; i++) if (t.kind[i] === TK_MATCH) max = Math.max(max, t.dist[i]);
    expect(max).toBe(32768);
    const d2 = new Uint8Array(32769 + 300);
    for (let i = 0; i < 32769; i++) d2[i] = Math.floor(r() * 256);
    d2.set(d2.subarray(0, 300), 32769);
    const t2 = deflate(d2, { level: 9 }).trace?.tokens;
    if (!t2) throw new Error('記録がない');
    for (let i = 0; i < t2.count; i++) if (t2.kind[i] === TK_MATCH) expect(t2.dist[i]).toBeLessThanOrEqual(32768);
  });

  it('258 を超える繰り返しは長さ 258（記号 285）に分かれる', () => {
    const d = new Uint8Array(1000).fill(7),
      t = deflate(d, { level: 6 }).trace?.tokens;
    if (!t) throw new Error('記録がない');
    const m = tokenAt(t, 1);
    expect(m.kind).toBe('match');
    expect(m.dist).toBe(1);
    expect(m.len).toBe(258);
    expect(m.sym).toBe(285);
  });

  it('level が上がるとだいたい小さくなり、level 6 は node の zlib と大差ない', () => {
    const img = new Uint8Array(testImage(256, 96, 4, 12).buffer),
      text = SAMPLES[6][1],
      sz = (d: Uint8Array, level: number) => deflate(d, { level, trace: false }).data.length;
    for (const d of [img, text]) {
      const s = LEVELS.map((_, l) => sz(d, l));
      expect(s[1]).toBeLessThan(s[0]);
      expect(s[6]).toBeLessThanOrEqual(s[1]);
      expect(s[9]).toBeLessThanOrEqual(s[4] * 1.01);
      const ref = deflateRawSync(d, { level: 6 }).length;
      expect(s[6]).toBeLessThan(ref * 1.05);
    }
  });
});

describe('Deflate の復号', () => {
  const strategies = [
    constants.Z_DEFAULT_STRATEGY,
    constants.Z_FILTERED,
    constants.Z_HUFFMAN_ONLY,
    constants.Z_RLE,
    constants.Z_FIXED,
  ];
  for (const [name, d] of SAMPLES)
    it(`${name}: node の zlib の出力（level 0〜9・strategy 5 種）を戻せる`, () => {
      for (let level = 0; level <= 9; level++)
        for (const strategy of strategies) {
          const z = deflateRawSync(d, { level, strategy }),
            r = inflate(z);
          expect(r.done).toBe(true);
          expect(Buffer.from(r.data).equals(Buffer.from(d))).toBe(true);
          /* Z_FIXED でも stored のほうが短ければ zlib は stored にする */
          if (strategy === constants.Z_FIXED && level > 0)
            expect(r.trace?.blocks.every((b) => b.type !== 'dynamic')).toBe(true);
        }
    });

  it('自前の符号化と記録が一致する（ブロック・記号の欄）', () => {
    const d = SAMPLES[8][1],
      e = deflate(d, { level: 6, blockSymbols: 3000 }),
      r = inflate(e.data);
    const a = e.trace,
      b = r.trace;
    if (!a || !b) throw new Error('記録がない');
    expect(b.blocks.length).toBe(a.blocks.length);
    for (const [i, x] of a.blocks.entries()) {
      const y = b.blocks[i];
      expect([y.type, y.final, y.start, y.end, y.headerBits, y.srcStart, y.srcEnd, y.tokenStart, y.tokenEnd]).toEqual([
        x.type,
        x.final,
        x.start,
        x.end,
        x.headerBits,
        x.srcStart,
        x.srcEnd,
        x.tokenStart,
        x.tokenEnd,
      ]);
      expect([y.hlit, y.hdist, y.hclen]).toEqual([x.hlit, x.hdist, x.hclen]);
      expect(y.clSyms).toEqual(x.clSyms);
      expect(y.clExtra).toEqual(x.clExtra);
    }
    const keys = ['kind', 'pos', 'bit', 'nbits', 'sym', 'code', 'codeLen', 'len', 'lenExtra', 'dist', 'dcode'] as const;
    for (const k of keys) expect(Buffer.from(b.tokens[k].buffer).equals(Buffer.from(a.tokens[k].buffer))).toBe(true);
  });

  it('記号を位置から探せる', () => {
    const d = SAMPLES[6][1],
      t = deflate(d, { level: 6 }).trace?.tokens;
    if (!t) throw new Error('記録がない');
    for (const p of [0, 1, 100, 5000, d.length - 1]) {
      const i = tokenAtPos(t, p);
      expect(t.pos[i]).toBeLessThanOrEqual(p);
      expect(p).toBeLessThan(t.pos[i] + tokenBytes(t, i));
      expect(tokenAtBit(t, t.bit[i])).toBe(i);
      expect(tokenAtBit(t, t.bit[i] + t.nbits[i] - 1)).toBe(i);
    }
    expect(tokenAtPos(t, d.length)).toBe(-1);
    expect(tokenAtBit(t, 0)).toBe(-1);
    expect(t.kind[t.count - 1]).toBe(TK_END);
    expect(t.kind[0]).toBe(TK_LIT);
  });

  it('壊れた入力: 既定は理由つきで投げ、寛容モードはそこまでの出力と位置を返す', () => {
    const d = SAMPLES[8][1],
      z = deflateRawSync(d, { level: 6 });
    /* 途中で切る */
    const cut = z.subarray(0, z.length >> 1);
    expect(() => inflate(cut)).toThrow(InflateError);
    const r = inflate(cut, { tolerant: true });
    expect(r.error?.reason).toBe('eof');
    expect(r.done).toBe(false);
    expect(r.data.length).toBeGreaterThan(100);
    expect(Buffer.from(r.data).equals(Buffer.from(d.subarray(0, r.data.length)))).toBe(true);
    /* BTYPE = 3 */
    const bad = Uint8Array.of(0b111, 0, 0);
    try {
      inflate(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InflateError);
      expect((e as InflateError).reason).toBe('block-type');
      expect((e as InflateError).bit).toBe(0);
    }
    /* stored の NLEN が合わない */
    expect(inflate(Uint8Array.of(1, 5, 0, 0, 0, 1, 2, 3, 4, 5), { tolerant: true }).error?.reason).toBe('stored-len');
    /* 距離が先頭より前（固定ハフマン: 長さ 3 = 記号 257 = 0000001、距離 0 = 00000） */
    const w = new BitWriter();
    w.put(1, 1);
    w.put(1, 2);
    w.put(reverseBits(0b0000001, 7), 7);
    w.put(0, 5);
    const far = inflate(w.out(), { tolerant: true });
    expect(far.error?.reason).toBe('dist-too-far');
    expect(far.error?.bit).toBe(3);
    /* 乱れたビットのどこかで止まり、投げない */
    const r2 = rng(3);
    for (let k = 0; k < 100; k++) {
      const c = Uint8Array.from(z);
      for (let j = 0; j < 3; j++) c[Math.floor(r2() * c.length)] ^= 1 << Math.floor(r2() * 8);
      const x = inflate(c, { tolerant: true, maxOut: 1 << 16, trace: false });
      expect(x.error === null || x.error instanceof InflateError).toBe(true);
      if (x.error) expect(x.error.bit).toBeGreaterThanOrEqual(0);
    }
  });

  it('出力の上限で止まる', () => {
    const d = new Uint8Array(100000),
      z = deflateRawSync(d),
      r = inflate(z, { tolerant: true, maxOut: 1000 });
    expect(r.error?.reason).toBe('out-limit');
    expect(r.data.length).toBe(1000);
  });
});

describe('zlib', () => {
  it('自前の包みを node の inflateSync で戻せ、頭は 0x78 0x9C（level 6）', () => {
    for (const [, d] of SAMPLES)
      for (const level of [0, 1, 6, 9]) {
        const z = zlibCompress(d, { level });
        expect(Buffer.from(inflateSync(z.bytes)).equals(Buffer.from(d))).toBe(true);
        expect(z.header.checkOk).toBe(true);
      }
    const z6 = zlibCompress(ascii('abc'), { level: 6 }).bytes;
    expect([z6[0], z6[1]]).toEqual([0x78, 0x9c]);
    const z1 = zlibCompress(ascii('abc'), { level: 1 }).bytes;
    expect([z1[0], z1[1]]).toEqual([0x78, 0x01]);
  });
  it('node の deflateSync を戻し、Adler-32 の一致・不一致を返す', () => {
    const d = SAMPLES[6][1],
      z = deflateSync(d, { level: 9 }),
      r = zlibDecompress(z);
    expect(r.adlerOk).toBe(true);
    expect(r.end).toBe(z.length);
    expect(Buffer.from(r.data).equals(Buffer.from(d))).toBe(true);
    const c = Uint8Array.from(z);
    c[c.length - 1] ^= 1;
    const r2 = zlibDecompress(c);
    expect(r2.adlerOk).toBe(false);
    expect(r2.adlerStored).not.toBe(r2.adlerActual);
    expect(r2.data.length).toBe(d.length);
  });
  it('頭の誤り', () => {
    expect(() => zlibDecompress(Uint8Array.of(0x78, 0x9d, 3, 0))).toThrow(/FCHECK/);
    const r = zlibDecompress(Uint8Array.of(0x78, 0x9d, 3, 0), { tolerant: true });
    expect(r.error?.reason).toBe('zlib-check');
    expect(r.error?.bit).toBe(-16);
  });
});

describe('フィルタ', () => {
  it('Paeth の予測（9.4）', () => {
    expect(paeth(10, 20, 15)).toBe(15);
    expect(paeth(10, 20, 10)).toBe(20);
    expect(paeth(10, 20, 20)).toBe(10);
    expect(paeth(5, 5, 5)).toBe(5);
  });
  it('5 種と適応のどれでも戻り、適応は和が最小の種類を選ぶ', () => {
    const rowBytes = 30,
      rows = 12,
      raw = randomBytes(rowBytes * rows, 4);
    for (let i = 0; i < raw.length; i++) if (i % 5) raw[i] = raw[i - 1] + 3;
    for (const bpp of [1, 3, 4, 6])
      for (const mode of [0, 1, 2, 3, 4, 'adaptive'] as const) {
        const f = filterImage(raw, rowBytes, rows, bpp, mode),
          u = unfilterImage(f.data, rowBytes, rows, bpp);
        expect(u.rows).toBe(rows);
        expect(Buffer.from(u.raw).equals(Buffer.from(raw))).toBe(true);
        for (let y = 0; y < rows; y++) {
          const s = Array.from(f.sums.subarray(y * 5, y * 5 + 5));
          if (mode === 'adaptive') expect(s[f.types[y]]).toBe(Math.min(...s));
          else expect(f.types[y]).toBe(mode);
          /* None の和は行そのものの符号付きの絶対値の和 */
          let s0 = 0;
          for (let i = 0; i < rowBytes; i++) {
            const v = raw[y * rowBytes + i];
            s0 += v < 128 ? v : 256 - v;
          }
          expect(s[0]).toBe(s0);
        }
      }
    expect(FILTER_NAMES[4 as FilterType]).toBe('Paeth');
  });
  it('途中で切れたら読めた行まで、種類が 5 以上の行で止まる', () => {
    const raw = randomBytes(40, 1),
      f = filterImage(raw, 10, 4, 1, 4),
      u = unfilterImage(f.data.subarray(0, 11 * 2 + 5), 10, 4, 1);
    expect(u.rows).toBe(2);
    expect(u.partial).toBe(4);
    expect(Buffer.from(u.raw.subarray(0, 24)).equals(Buffer.from(raw.subarray(0, 24)))).toBe(true);
    const bad = Uint8Array.from(f.data);
    bad[11 * 3] = 9;
    const u2 = unfilterImage(bad, 10, 4, 1);
    expect(u2.badRow).toBe(3);
    expect(u2.rows).toBe(3);
  });
});

describe('Adam7', () => {
  it('7 つのパスで各画素をちょうど 1 回ずつ送る', () => {
    for (const [w, h] of [
      [1, 1],
      [3, 5],
      [8, 8],
      [13, 9],
      [33, 17],
    ]) {
      const seen = new Uint8Array(w * h);
      for (const p of adam7Passes(w, h))
        for (let py = 0; py < p.h; py++)
          for (let px = 0; px < p.w; px++) {
            const x = p.x0 + px * p.dx,
              y = p.y0 + py * p.dy;
            expect(x).toBeLessThan(w);
            expect(y).toBeLessThan(h);
            expect(adam7PassOf(x, y)).toBe(p.pass);
            seen[y * w + x]++;
          }
      expect(seen.every((v) => v === 1)).toBe(true);
    }
    expect(adam7Passes(1, 1).map((p) => p.w * p.h)).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });
});

/** PNG のチャンクを組む（CRC は node の zlib で計算する） */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const c = new Uint8Array(12 + data.length),
    dv = new DataView(c.buffer);
  dv.setUint32(0, data.length);
  c.set(ascii(type), 4);
  c.set(data, 8);
  dv.setUint32(8 + data.length, nodeCrc32(c.subarray(4, 8 + data.length)));
  return c;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function ihdr(w: number, h: number, depth: number, ct: number, il = 0): Uint8Array {
  const d = new Uint8Array(13),
    dv = new DataView(d.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  d[8] = depth;
  d[9] = ct;
  d[12] = il;
  return d;
}
/** 手で組む PNG（フィルタなし、IDAT は node の zlib） */
function handPng(w: number, h: number, depth: number, ct: number, rows: Uint8Array[], extra: Uint8Array[] = []) {
  const f = concat(rows.map((r) => concat([Uint8Array.of(0), r])));
  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr(w, h, depth, ct)),
    ...extra,
    chunk('IDAT', deflateSync(f)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** 色の少ない、透明な所のある画像 */
function fewColors(w: number, h: number, n: number, transparent = true): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const k = (i * 7 + ((i / w) | 0)) % n;
    d.set([(k * 53) & 255, (k * 97) & 255, (k * 31) & 255, transparent && k === 0 ? 0 : 255], i * 4);
  }
  return d;
}
const grayImage = (w: number, h: number, levels: number) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const g = Math.round(((i % levels) * 255) / (levels - 1));
    d.set([g, g, g, 255], i * 4);
  }
  return d;
};

describe('PNG', () => {
  const combos: [ColorType, 1 | 2 | 4 | 8, () => Uint8ClampedArray][] = [
    [0, 1, () => grayImage(13, 7, 2)],
    [0, 2, () => grayImage(13, 7, 4)],
    [0, 4, () => grayImage(13, 7, 16)],
    [0, 8, () => grayImage(13, 7, 256)],
    [2, 8, () => testImage(13, 7, 1, 30)],
    [3, 1, () => fewColors(13, 7, 2)],
    [3, 2, () => fewColors(13, 7, 4)],
    [3, 4, () => fewColors(13, 7, 16)],
    [3, 8, () => fewColors(13, 7, 200)],
    [4, 8, () => grayImage(13, 7, 256).map((v, i) => (i % 4 === 3 ? i & 255 : v))],
    [6, 8, () => testImage(13, 7, 2, 30, true)],
  ];
  for (const [ct, depth, make] of combos)
    it(`色の型 ${ct}・深度 ${depth}: インターレース 2 通り × フィルタ 6 通りで元に戻り、node の zlib でも IDAT が戻る`, () => {
      const img = make();
      for (const interlace of [false, true])
        for (const filter of [0, 1, 2, 3, 4, 'adaptive'] as const) {
          const e = encodePng(img, 13, 7, { colorType: ct, bitDepth: depth, interlace, filter, level: 6 });
          if (!e.ok) throw new Error(e.reason);
          expect(e.loss).toEqual({ color: 0, alpha: 0 });
          const d = decodePng(e.bytes);
          expect(d.complete).toBe(true);
          expect(d.issues).toEqual([]);
          expect([d.width, d.height, d.colorType, d.bitDepth, d.interlace]).toEqual([13, 7, ct, depth, interlace]);
          expect(Buffer.from(d.rgba).equals(Buffer.from(img))).toBe(true);
          expect(Buffer.from(inflateSync(e.zlib.bytes)).equals(Buffer.from(e.filtered))).toBe(true);
          expect(Buffer.from(d.filtered).equals(Buffer.from(e.filtered))).toBe(true);
          expect(Buffer.from(d.raw).equals(Buffer.from(e.raw))).toBe(true);
          expect(d.filterTypes).toEqual(e.filterTypes);
        }
    });

  it('チャンクの一覧と CRC、IDAT の分け方', () => {
    const img = testImage(64, 64, 5, 60),
      e = encodePng(img, 64, 64, { idatSize: 1000 }) as PngEncoded;
    expect(e.chunks[0]).toMatchObject({ type: 'IHDR', offset: 8, length: 13 });
    expect(e.chunks.at(-1)).toMatchObject({ type: 'IEND', length: 0, crc: 0xae426082 });
    const idats = e.chunks.filter((c) => c.type === 'IDAT');
    expect(idats.length).toBe(Math.ceil(e.zlib.bytes.length / 1000));
    expect(idats.every((c, i) => c.length === (i < idats.length - 1 ? 1000 : e.zlib.bytes.length - 1000 * i))).toBe(
      true,
    );
    /* IDAT をつないだ列の位置からファイルの位置へ */
    for (const p of [0, 999, 1000, e.zlib.bytes.length - 1])
      expect(e.bytes[idatToFile(e.chunks, p)]).toBe(e.zlib.bytes[p]);
    expect(idatToFile(e.chunks, e.zlib.bytes.length)).toBe(-1);
    const d = decodePng(e.bytes);
    expect(d.chunks).toEqual(e.chunks);
    expect(d.zlib?.adlerOk).toBe(true);
  });

  it('パレット: 256 色を超えると作れず、深度が足りなければそう返す。tRNS は α の色を前に並べる', () => {
    const many = testImage(40, 40, 1, 60);
    expect(encodePng(many, 40, 40, { colorType: 3 })).toEqual({ ok: false, reason: 'too-many-colors', colors: 257 });
    expect(encodePng(fewColors(8, 8, 5), 8, 8, { colorType: 3, bitDepth: 2 })).toEqual({
      ok: false,
      reason: 'depth-too-small',
      colors: 5,
    });
    const e = encodePng(fewColors(8, 8, 5), 8, 8, { colorType: 3, bitDepth: 4 }) as PngEncoded;
    expect(e.palette?.length).toBe(15);
    expect(Array.from(e.trns ?? [])).toEqual([0]);
    /* tRNS を使わなければ α を捨てる */
    const n = encodePng(fewColors(8, 8, 5), 8, 8, { colorType: 3, trns: false }) as PngEncoded;
    expect(n.trns).toBeNull();
    expect(n.loss.alpha).toBeGreaterThan(0);
  });

  it('グレー・RGB の 1 色の透明（tRNS）。不透明な画素と色が重なれば使われていない色を選ぶ', () => {
    const img = testImage(16, 16, 1, 0);
    for (let i = 0; i < 16; i++) img[i * 4 * 17 + 3] = 0;
    const e = encodePng(img, 16, 16, { colorType: 2 }) as PngEncoded;
    expect(e.trns?.length).toBe(6);
    expect(e.loss).toEqual({ color: 0, alpha: 0 });
    const d = decodePng(e.bytes);
    for (let i = 0; i < 256; i++) expect(d.rgba[i * 4 + 3]).toBe(img[i * 4 + 3]);
    /* 1 ビットのグレーで 2 色とも使われていれば透明にできない */
    const g = grayImage(8, 2, 2);
    g[3] = 0;
    g[7] = 0;
    const e1 = encodePng(g, 8, 2, { colorType: 0, bitDepth: 1 }) as PngEncoded;
    expect(e1.trns).toBeNull();
    expect(e1.loss.alpha).toBe(2);
    /* 半透明は表せない */
    const e2 = encodePng(testImage(8, 8, 1, 10, true), 8, 8, { colorType: 2 }) as PngEncoded;
    expect(e2.loss.alpha).toBeGreaterThan(0);
  });

  it('手で組んだ PNG を戻す: 16 ビットの RGBA・グレー、1 ビットのグレー、パレットと tRNS、知らない補助チャンク', () => {
    /* 16 ビットの RGBA 2×1 */
    const r16 = Uint8Array.of(0x12, 0x34, 0xff, 0xff, 0, 1, 0x80, 0, 0xab, 0xcd, 0, 0, 0xff, 0xff, 0x7f, 0xff);
    const d16 = decodePng(handPng(2, 1, 16, 6, [r16]));
    expect(Array.from(d16.rgba)).toEqual([0x12, 0xff, 0, 0x80, 0xab, 0, 0xff, 0x7f]);
    /* 16 ビットのグレーと tRNS（0x1234 が透明） */
    const g16 = decodePng(
      handPng(
        3,
        1,
        16,
        0,
        [Uint8Array.of(0x12, 0x34, 0x12, 0x35, 0xff, 0xff)],
        [chunk('tRNS', Uint8Array.of(0x12, 0x34))],
      ),
    );
    expect(Array.from(g16.rgba)).toEqual([0x12, 0x12, 0x12, 0, 0x12, 0x12, 0x12, 255, 255, 255, 255, 255]);
    /* 1 ビットのグレー 10×2（行は 2 バイト、余りのビットは捨てる） */
    const g1 = decodePng(handPng(10, 2, 1, 0, [Uint8Array.of(0b10110000, 0b11000000), Uint8Array.of(0xff, 0)]));
    expect(Array.from({ length: 10 }, (_, i) => g1.rgba[i * 4])).toEqual([255, 0, 255, 255, 0, 0, 0, 0, 255, 255]);
    expect(Array.from({ length: 10 }, (_, i) => g1.rgba[40 + i * 4])).toEqual([
      255, 255, 255, 255, 255, 255, 255, 255, 0, 0,
    ]);
    /* 2 ビットのパレットと tRNS、知らない補助チャンク */
    const pal = decodePng(
      handPng(
        4,
        1,
        2,
        3,
        [Uint8Array.of(0b00011011)],
        [
          chunk('PLTE', Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9)),
          chunk('tRNS', Uint8Array.of(128)),
          chunk('zzZz', ascii('hello')),
        ],
      ),
    );
    expect(Array.from(pal.rgba)).toEqual([255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 255]);
    expect(pal.chunks.find((c) => c.type === 'zzZz')).toMatchObject({ known: false, critical: false, crcOk: true });
    /* 16 ビットの RGB を Adam7 で（node の zlib、パスごとにフィルタなし） */
    const w = 5,
      h = 3,
      px = (x: number, y: number) => [x * 4000, y * 9000, 65535 - x * y * 300];
    const parts: Uint8Array[] = [];
    for (const p of adam7Passes(w, h)) {
      if (!p.w || !p.h) continue;
      for (let py = 0; py < p.h; py++) {
        const row = [0];
        for (let qx = 0; qx < p.w; qx++)
          for (const v of px(p.x0 + qx * p.dx, p.y0 + py * p.dy)) row.push(v >> 8, v & 255);
        parts.push(Uint8Array.from(row));
      }
    }
    const a7 = decodePng(
      concat([
        PNG_SIGNATURE,
        chunk('IHDR', ihdr(w, h, 16, 2, 1)),
        chunk('IDAT', deflateSync(concat(parts))),
        chunk('IEND', new Uint8Array(0)),
      ]),
    );
    expect(a7.complete).toBe(true);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        expect(Array.from(a7.rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4))).toEqual([
          ...px(x, y).map((v) => v >> 8),
          255,
        ]);
  });

  it('壊れた PNG: CRC の不一致を見つけ、ignoreCrc・寛容モードで読み進める', () => {
    const e = encodePng(testImage(32, 32, 1, 40), 32, 32, { idatSize: 500 }) as PngEncoded,
      idat = e.chunks.filter((c) => c.type === 'IDAT')[1],
      bad = Uint8Array.from(e.bytes);
    bad[idat.offset + 8 + 10] ^= 0x40;
    expect(() => decodePng(bad)).toThrow(PngError);
    try {
      decodePng(bad);
    } catch (x) {
      expect((x as PngError).reason).toBe('crc');
      expect((x as PngError).issue.offset).toBe(idat.offset);
    }
    const t = decodePng(bad, { tolerant: true });
    expect(t.chunks.find((c) => c.offset === idat.offset)?.crcOk).toBe(false);
    expect(t.error?.reason).toBe('crc');
    expect(t.rows).toBeLessThan(32);
    /* 署名だけ壊す: 寛容モードなら読める */
    const sig = Uint8Array.from(e.bytes);
    sig[1] = 0;
    expect(() => decodePng(sig)).toThrow(/署名/);
    expect(decodePng(sig, { tolerant: true }).rows).toBe(32);
  });

  it('途中で切れた PNG: 寛容モードで戻せた行の数を返す', () => {
    const img = testImage(40, 30, 2, 40),
      e = encodePng(img, 40, 30, { level: 6 }) as PngEncoded,
      cut = e.bytes.subarray(0, Math.floor(e.bytes.length * 0.6));
    expect(() => decodePng(cut)).toThrow(PngError);
    const d = decodePng(cut, { tolerant: true });
    expect(d.error?.reason).toBe('truncated');
    expect(d.rows).toBeGreaterThan(5);
    expect(d.rows).toBeLessThan(30);
    expect(d.complete).toBe(false);
    /* 戻せた行は元と同じ */
    expect(Buffer.from(d.rgba.subarray(0, d.rows * 40 * 4)).equals(Buffer.from(img.subarray(0, d.rows * 40 * 4)))).toBe(
      true,
    );
    /* 乱れたバイトでも投げない */
    const r = rng(5);
    for (let k = 0; k < 100; k++) {
      const c = Uint8Array.from(e.bytes);
      for (let j = 0; j < 4; j++) c[Math.floor(r() * c.length)] = Math.floor(r() * 256);
      const x = decodePng(c, { tolerant: true, ignoreCrc: true, trace: false });
      expect(x.rows).toBeGreaterThanOrEqual(0);
    }
  });

  it('知らない必須チャンク・フィルタの種類の誤り', () => {
    const base = handPng(2, 2, 8, 0, [Uint8Array.of(1, 2), Uint8Array.of(3, 4)], [chunk('ABCD', new Uint8Array(1))]);
    expect(() => decodePng(base)).toThrow(/必須/);
    const f = concat([
      PNG_SIGNATURE,
      chunk('IHDR', ihdr(2, 2, 8, 0)),
      chunk('IDAT', deflateSync(Uint8Array.of(0, 1, 2, 7, 3, 4))),
      chunk('IEND', new Uint8Array(0)),
    ]);
    const d = decodePng(f, { tolerant: true });
    expect(d.error?.reason).toBe('filter');
    expect(d.rows).toBe(1);
    expect(Array.from(d.rgba.subarray(0, 8))).toEqual([1, 1, 1, 255, 2, 2, 2, 255]);
  });
});

describe('記録の例', () => {
  it('記号の種類の定数', () => {
    expect([TK_LIT, TK_MATCH, TK_END, TK_STORED]).toEqual([0, 1, 2, 3]);
  });
});

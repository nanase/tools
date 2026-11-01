import { describe, expect, it } from 'vitest';
import {
  decodeFrame,
  deinterlace,
  encodeGif,
  type FrameSpec,
  interlace,
  interlaceRows,
  parseGif,
} from '../src/tools/gif/gif';
import { decodeLzw, dictAt, encodeLzw, encView } from '../src/tools/gif/lzw';
import {
  blockAt,
  buildTree,
  dataIndex,
  fileRanges,
  frameView,
  fromBytes,
  fromImage,
  interlacePair,
  MAX_PIXELS,
  type Model,
  progressive,
} from '../src/tools/gif/model';
import { medianCut, quantize } from '../src/tools/gif/quant';
import { SPRITE_H, SPRITE_W, soft, sprite } from '../src/tools/gif/samples';

function rnd(seed: number): () => number {
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
function noise(n: number, k: number, seed = 3): Uint8Array {
  const r = rnd(seed);
  return Uint8Array.from({ length: n }, () => Math.floor(r() * k));
}

describe('LZW', () => {
  it('手計算と合う', () => {
    /* 3 色の 1 1 1 1 1 2 2 2 2 2 を m=2 で。Clear=4 EOI=5 */
    const e = encodeLzw(Uint8Array.from([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]), 2);
    expect(Array.from(e.trace.code.subarray(0, e.trace.n))).toEqual([4, 1, 6, 6, 2, 9, 9, 5]);
    expect(Array.from(e.trace.width.subarray(0, e.trace.n))).toEqual([3, 3, 3, 3, 4, 4, 4, 4]);
  });

  it('戻せる', () => {
    for (const [n, k, m] of [
      [0, 2, 2],
      [1, 2, 2],
      [10, 4, 2],
      [1000, 2, 2],
      [20000, 4, 2],
      [50000, 16, 4],
      [200000, 256, 8],
    ]) {
      const a = noise(n, k),
        e = encodeLzw(a, m),
        d = decodeLzw(e.data, m, n);
      expect(d.stop).toBe('eoi');
      expect(d.n).toBe(n);
      expect(Buffer.from(d.out).equals(Buffer.from(a))).toBe(true);
      expect(e.data.length).toBe((e.bits + 7) >> 3);
    }
  });

  it('同じ値の並びでは KwKwK が出て、列が長く育つ', () => {
    const a = new Uint8Array(5000).fill(1),
      e = encodeLzw(a, 2),
      d = decodeLzw(e.data, 2, a.length);
    expect(d.stop).toBe('eoi');
    expect(d.kwkwk).toBeGreaterThan(50);
    expect(e.trace.n).toBeLessThan(120);
  });

  it('辞書が埋まると Clear を出す', () => {
    const a = noise(100000, 256),
      e = encodeLzw(a, 8);
    expect(e.clears).toBeGreaterThan(1);
    expect(e.maxWidth).toBe(12);
    const d = decodeLzw(e.data, 8, a.length);
    expect(d.stop).toBe('eoi');
    expect(Buffer.from(d.out).equals(Buffer.from(a))).toBe(true);
  });

  it('符号化の記録と復号の記録の符号と符号長が同じ', () => {
    const a = noise(30000, 8),
      e = encodeLzw(a, 3),
      d = decodeLzw(e.data, 3, a.length, { trace: true });
    const t = d.trace;
    expect(t?.n).toBe(e.trace.n);
    expect(Array.from(t?.code.subarray(0, 4000) ?? [])).toEqual(Array.from(e.trace.code.subarray(0, 4000)));
    expect(Array.from(t?.width.subarray(0, 4000) ?? [])).toEqual(Array.from(e.trace.width.subarray(0, 4000)));
    expect(Array.from(t?.start.subarray(0, 4000) ?? [])).toEqual(Array.from(e.trace.start.subarray(0, 4000)));
  });

  it('辞書の番号は記録と一致し、画素の数も合う', () => {
    const a = noise(500, 4),
      e = encodeLzw(a, 2),
      dic = dictAt(e.trace, a, 2, e.trace.n - 1);
    expect(dic[0].code).toBe(6);
    expect(dic.every((d, i) => d.code === 6 + i)).toBe(true);
    /* 辞書の列は元の画素の中に現れる: 1 件目は先頭の 2 画素 */
    expect(dic[0].prefix).toBe(a[0]);
    expect(dic[0].suffix).toBe(a[1]);
  });

  it('壊れても例外を投げず、止まった理由を返す', () => {
    const a = noise(3000, 4),
      e = encodeLzw(a, 2);
    /* 途中で切る */
    const cut = decodeLzw(e.data.subarray(0, 100), 2, a.length);
    expect(cut.stop).toBe('end');
    expect(cut.n).toBeGreaterThan(0);
    expect(cut.n).toBeLessThan(a.length);
    expect(Buffer.from(cut.out.subarray(0, cut.n - 8)).equals(Buffer.from(a.subarray(0, cut.n - 8)))).toBe(true);
    /* 最小符号サイズが変 */
    expect(decodeLzw(e.data, 0, 10).stop).toBe('bad-min');
    expect(decodeLzw(e.data, 12, 10).stop).toBe('bad-min');
    /* 辞書にない符号: Clear の直後に大きな番号 */
    const bad = decodeLzw(Uint8Array.from([0b00111100, 0xff, 0xff]), 2, 16);
    expect(bad.stop).toBe('bad-code');
    /* どのバイトを壊しても投げない */
    const r = rnd(9);
    for (let i = 0; i < 300; i++) {
      const c = e.data.slice();
      c[Math.floor(r() * c.length)] ^= 1 << Math.floor(r() * 8);
      const d = decodeLzw(c, 2, a.length);
      expect(d.n).toBeLessThanOrEqual(a.length);
    }
  });

  it('画素が多すぎるデータは期待の数で止める', () => {
    const a = noise(1000, 4),
      e = encodeLzw(a, 2),
      d = decodeLzw(e.data, 2, 300);
    expect(d.stop).toBe('full');
    expect(d.n).toBe(300);
    expect(Buffer.from(d.out).equals(Buffer.from(a.subarray(0, 300)))).toBe(true);
  });

  it('辞書が埋まったまま続く（deferred clear の）データも読める', () => {
    /* Clear を出さない符号化器を試験の中で作る */
    const a = noise(40000, 4, 5),
      m = 2,
      clear = 4,
      eoi = 5,
      dict = new Map<number, number>();
    let next = eoi + 1,
      width = m + 1,
      bit = 0;
    const out = new Uint8Array(100000);
    const emit = (c: number): void => {
      for (let k = 0; k < width; k++, bit++) if ((c >> k) & 1) out[bit >> 3] |= 1 << (bit & 7);
    };
    emit(clear);
    let w = a[0];
    for (let i = 1; i < a.length; i++) {
      const key = (w << 8) | a[i],
        h = dict.get(key);
      if (h !== undefined) {
        w = h;
        continue;
      }
      emit(w);
      if (next < 4096) {
        dict.set(key, next);
        next++;
        if (next > 1 << width && width < 12) width++;
      }
      w = a[i];
    }
    emit(w);
    emit(eoi);
    const d = decodeLzw(out.subarray(0, (bit + 7) >> 3), m, a.length);
    expect(d.stop).toBe('eoi');
    expect(Buffer.from(d.out).equals(Buffer.from(a))).toBe(true);
  });
});

describe('インターレース', () => {
  it('行の順が仕様どおり', () => {
    expect(interlaceRows(10)).toEqual([0, 8, 4, 2, 6, 1, 3, 5, 7, 9]);
    for (const h of [1, 2, 3, 5, 8, 9, 17, 100]) {
      const r = interlaceRows(h);
      expect([...r].sort((a, b) => a - b)).toEqual(Array.from({ length: h }, (_, i) => i));
    }
  });
  it('戻せる', () => {
    const a = noise(12 * 19, 200);
    expect(Array.from(deinterlace(interlace(a, 12, 19), 12, 19))).toEqual(Array.from(a));
  });
});

const PAL2 = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
const fr = (o: Partial<FrameSpec>): FrameSpec => ({
  x: 0,
  y: 0,
  w: 4,
  h: 4,
  idx: new Uint8Array(16).fill(1),
  disposal: 1,
  delay: 10,
  transparent: -1,
  interlace: false,
  ...o,
});

describe('GIF ファイル', () => {
  it('組み立てて読み戻せる', () => {
    const img = noise(40 * 30, 4);
    const e = encodeGif({
      w: 40,
      h: 30,
      gct: PAL2,
      bg: 0,
      loop: 0,
      comment: 'hello',
      frames: [
        fr({ w: 40, h: 30, idx: img, delay: 7, disposal: 2, transparent: 3 }),
        fr({ x: 3, y: 5, w: 10, h: 9, idx: noise(90, 4), interlace: true, lct: PAL2 }),
      ],
    });
    const g = parseGif(e.bytes);
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.version).toBe('GIF89a');
    expect([g.w, g.h, g.brokenAt, g.loop, g.comment]).toEqual([40, 30, -1, 0, 'hello']);
    expect(g.frames.length).toBe(2);
    expect(g.frames[0]).toMatchObject({ disposal: 2, delay: 7, transparent: 3, minCode: 2, interlace: false });
    expect(g.frames[1]).toMatchObject({ x: 3, y: 5, w: 10, h: 9, interlace: true, disposal: 1 });
    expect(g.frames[1].lct?.length).toBe(12);
    expect(Array.from(decodeFrame(g.frames[0]).idx)).toEqual(Array.from(img));
    /* 区画はファイルを隙間なく覆う */
    let p = 0;
    for (const b of g.blocks) {
      expect(b.start).toBe(p);
      p = b.end;
    }
    expect(p).toBe(e.bytes.length);
    expect(g.blocks.at(-1)?.kind).toBe('trailer');
  });

  it('255 バイトずつのサブブロックに分ける', () => {
    const e = encodeGif({
        w: 300,
        h: 300,
        gct: PAL2,
        bg: 0,
        loop: null,
        frames: [fr({ w: 300, h: 300, idx: noise(90000, 4) })],
      }),
      g = parseGif(e.bytes);
    const f = g?.frames[0];
    expect(f?.data.length).toBeGreaterThan(255);
    expect(e.bytes[f?.dataStart ?? 0]).toBe(255);
    expect(Buffer.from(f?.data ?? []).equals(Buffer.from(e.lzw[0].data))).toBe(true);
  });

  it('色数に足りるカラーテーブルと最小符号サイズ', () => {
    for (const [colors, m, bytes] of [
      [2, 2, 6],
      [3, 2, 12],
      [4, 2, 12],
      [5, 3, 24],
      [17, 5, 96],
      [256, 8, 768],
    ]) {
      const e = encodeGif({
          w: 2,
          h: 1,
          gct: new Uint8Array(colors * 3),
          bg: 0,
          loop: null,
          frames: [fr({ w: 2, h: 1, idx: new Uint8Array(2) })],
        }),
        g = parseGif(e.bytes);
      expect(g?.gct?.length).toBe(bytes);
      expect(g?.frames[0].minCode).toBe(m);
    }
  });

  it('GIF でないものは null、切れたファイルは読めた所まで', () => {
    expect(parseGif(new Uint8Array(100))).toBeNull();
    const img = noise(100 * 100, 4),
      e = encodeGif({ w: 100, h: 100, gct: PAL2, bg: 0, loop: null, frames: [fr({ w: 100, h: 100, idx: img })] });
    const g = parseGif(e.bytes.subarray(0, 1500));
    expect(g?.brokenAt).toBe(1500);
    expect(g?.frames.length).toBe(1);
    const d = g ? decodeFrame(g.frames[0]) : null;
    expect(d?.lzw.stop).toBe('end');
    expect(d?.lzw.n).toBeGreaterThan(0);
    /* どこで切っても投げない */
    for (let i = 0; i < e.bytes.length; i += 97) parseGif(e.bytes.subarray(0, i));
    /* 途中のバイトを壊しても投げない */
    const r = rnd(4);
    for (let i = 0; i < 300; i++) {
      const c = e.bytes.slice();
      c[Math.floor(r() * 400)] = Math.floor(r() * 256);
      const k = parseGif(c);
      if (k) for (const f of k.frames) if (f.w * f.h < 1e6) decodeFrame(f);
    }
  });
});

describe('減色', () => {
  it('色が少なければそのまま', () => {
    const q = quantize(sprite(), SPRITE_W, SPRITE_H, { colors: 256, dither: false });
    expect(q.exact).toBe(true);
    expect(q.colors).toBe(6);
    expect(q.transparent).toBe(5);
    expect(Array.from(q.pal.subarray(0, 3))).toEqual([0xd6, 0x50, 0x3c]);
  });
  it('上限の色数に収まる', () => {
    const s = soft(),
      w = 192,
      h = 128;
    for (const colors of [2, 4, 16, 64, 256]) {
      for (const dither of [false, true]) {
        const q = quantize(s, w, h, { colors, dither });
        expect(q.colors).toBeLessThanOrEqual(colors);
        expect(Math.max(...q.idx)).toBeLessThan(q.colors);
      }
    }
    expect(medianCut(s, 16).length).toBe(48);
  });
  it('誤差拡散で LZW の効きが落ちる', () => {
    const s = soft(),
      w = 192,
      h = 128,
      a = encodeLzw(quantize(s, w, h, { colors: 32, dither: false }).idx, 5),
      b = encodeLzw(quantize(s, w, h, { colors: 32, dither: true }).idx, 5);
    expect(b.data.length).toBeGreaterThan(a.data.length);
  });
});

describe('画面の計算', () => {
  const m = (): Model => fromImage(sprite(), SPRITE_W, SPRITE_H, { colors: 256, dither: false }, 'x');

  it('復号の記録から符号化の記録を作れる', () => {
    const a = noise(30000, 8),
      e = encodeLzw(a, 3),
      d = decodeLzw(e.data, 3, a.length, { trace: true }),
      v = encView(d.trace as NonNullable<typeof d.trace>, 8);
    for (let i = 0; i < e.trace.n; i++) {
      /* Clear の直前に足した番号は、復号器の記録に現れない */
      if (e.trace.code[i + 1] === 8) continue;
      expect(v.added[i]).toBe(e.trace.added[i]);
    }
  });

  it('符号化と復号の辞書は 1 つ遅れて同じ項目になる', () => {
    const a = noise(800, 4),
      e = encodeLzw(a, 2),
      d = decodeLzw(e.data, 2, a.length, { trace: true }),
      s = 100;
    const E = dictAt(e.trace, a, 2, s, 'e'),
      D = dictAt(d.trace as NonNullable<typeof d.trace>, d.out, 2, s + 1, 'd');
    expect(D).toEqual(E);
  });

  it('辞書の木は親が先で、葉が重ならない', () => {
    const v = frameView(m(), 0),
      ents = dictAt(v.enc, v.order, v.m, v.enc.n - 1),
      T = buildTree(ents, 1 << v.m, v.colors, 200);
    expect(T.nodes.length).toBe(ents.length + 6);
    T.nodes.forEach((n, i) => {
      expect(n.parent).toBeLessThan(i);
      if (n.parent >= 0) expect(n.d).toBe(T.nodes[n.parent].d + 1);
    });
    const leaf = T.nodes.filter((n) => !T.nodes.some((k) => T.nodes[k.parent] === n)).map((n) => n.x);
    expect(new Set(leaf).size).toBe(leaf.length);
    expect(leaf.length).toBe(T.leaves);
  });

  it('多すぎる辞書は新しい分と祖先だけ残す。深い列でも溢れない', () => {
    const a = noise(30000, 4),
      e = encodeLzw(a, 2),
      ents = dictAt(e.trace, a, 2, e.trace.n - 1);
    expect(ents.length).toBeGreaterThan(200);
    const T = buildTree(ents, 4, 4, 200);
    expect(T.nodes.length).toBeLessThan(ents.length);
    for (let i = ents.length - 200; i < ents.length; i++) expect(T.at.has(ents[i].code)).toBe(true);
    const deep = new Uint8Array(4000000).fill(1),
      f = encodeLzw(deep, 2),
      U = buildTree(dictAt(f.trace, deep, 2, f.trace.n - 1), 4, 4, 4096);
    expect(U.depth).toBeGreaterThan(1000);
  });

  it('16 進ダンプの範囲は隙間なく昇順で、LZW のデータの位置に戻せる', () => {
    const img = noise(300 * 40, 4),
      e = encodeGif({ w: 300, h: 40, gct: PAL2, bg: 0, loop: null, frames: [fr({ w: 300, h: 40, idx: img })] }),
      M = fromBytes(e.bytes, 'x') as Model,
      R = fileRanges(M);
    let p = 0;
    for (const r of R) {
      expect(r.start).toBe(p);
      p = r.end;
    }
    expect(p).toBe(e.bytes.length);
    const f = M.file.frames[0];
    expect(dataIndex(M, f, f.dataStart)).toBe(-1);
    expect(dataIndex(M, f, f.dataStart + 1)).toBe(0);
    expect(dataIndex(M, f, f.dataStart + 255)).toBe(254);
    expect(dataIndex(M, f, f.dataStart + 256)).toBe(-1);
    expect(dataIndex(M, f, f.dataStart + 257)).toBe(255);
    expect(M.bytes[f.dataStart + 257]).toBe(f.data[255]);
    expect(blockAt(M, 0)).toBe(0);
    expect(M.file.blocks[blockAt(M, f.dataStart + 1)].kind).toBe('data');
  });

  it('インターレースの比較は、どちらも同じ画素に戻る', () => {
    const v = frameView(m(), 0),
      p = interlacePair(v),
      a = decodeLzw(p.plain, v.m, v.idx.length),
      b = progressive(p.il, v.m, v.f.w, v.f.h);
    expect(Array.from(a.out)).toEqual(Array.from(v.idx));
    expect(Array.from(b.px)).toEqual(Array.from(v.idx));
    expect(b.rows).toBe(v.f.h);
  });

  it('途中まで受信したインターレースは粗い絵で全体を埋める', () => {
    const img = noise(64 * 64, 4),
      e = encodeLzw(interlace(img, 64, 64), 2),
      /* 1 パス目（8 行）より少し多い長さ */
      cut = e.data.subarray(0, Math.ceil(e.data.length * 0.2)),
      q = progressive(cut, 2, 64, 64);
    expect(q.rows).toBeGreaterThanOrEqual(8);
    /* 1 パス目の行が、次に届く行の手前まで伸びる */
    expect(Array.from(q.px.subarray(64 * 3, 64 * 4))).toEqual(Array.from(img.subarray(0, 64)));
  });

  it('開けないファイルは理由を返す', () => {
    expect(fromBytes(new Uint8Array(100), 'x')).toBe('not-gif');
    const big = encodeGif({ w: 3000, h: 3000, gct: PAL2, bg: 0, loop: null, frames: [fr({})] });
    expect(fromBytes(big.bytes, 'x')).toBe('too-big');
    expect(3000 * 3000).toBeGreaterThan(MAX_PIXELS);
    const none = encodeGif({ w: 3, h: 3, gct: PAL2, bg: 0, loop: null, frames: [] });
    expect(fromBytes(none.bytes, 'x')).toBe('no-frame');
    const huge = encodeGif({
      w: 10,
      h: 10,
      gct: PAL2,
      bg: 0,
      loop: null,
      frames: [fr({ w: 60000, h: 60000, idx: new Uint8Array(0) })],
    });
    expect(fromBytes(huge.bytes, 'x')).toBe('too-big');
  });

  it('壊れたファイルでも読めたフレームは開ける', () => {
    const e = encodeGif({
        w: 100,
        h: 100,
        gct: PAL2,
        bg: 0,
        loop: null,
        frames: [fr({ w: 100, h: 100, idx: noise(10000, 4) })],
      }),
      M = fromBytes(e.bytes.subarray(0, 1200), 'x') as Model,
      v = frameView(M, 0);
    expect(v.dec.stop).toBe('end');
    expect(v.enc.n).toBeGreaterThan(0);
    expect(M.file.brokenAt).toBe(1200);
  });
});

import { describe, expect, it } from 'vitest';
import { encodeGif, parseGif } from '../src/tools/gif/gif';
import { decodeLzw, encodeLzw } from '../src/tools/gif/lzw';
import {
  damage,
  decodeLax,
  ENCODE_DEFAULTS,
  type EncodeOpts,
  encodeAs,
  FMTS,
  type Fmt,
  MAX_PIXELS,
  type Source,
} from '../src/tools/image-corruption/codec';
import { applyOps, randomFlips, rng } from '../src/tools/image-corruption/corrupt';
import { locate, makeBase, outcome, type Plan, planOps } from '../src/tools/image-corruption/model';
import { decode as decodeJpeg } from '../src/tools/jpeg/decoder';
import { encode as encodeJpeg } from '../src/tools/jpeg/encoder';
import { unfilterImage } from '../src/tools/png/filter';
import { decodePng, encodePng } from '../src/tools/png/png';

/** なめらかな色の面と少しの乱れ。色は 256 より多い */
function picture(w = 96, h = 64): Source {
  const r = rng(5),
    rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        n = r() * 18;
      rgba[i] = 40 + x * 2 + n;
      rgba[i + 1] = 200 - y * 2 + n;
      rgba[i + 2] = 90 + ((x + y) % 40) * 3;
      rgba[i + 3] = 255;
    }
  return { w, h, rgba };
}
const PIC = picture();
const PLAN: Plan = { place: 'data', op: 'flip', n: 1, seed: 1, pos: 0.3, width: 104, height: 48 };

describe('壊す操作', () => {
  const src = Uint8Array.of(1, 2, 3, 4, 5);
  it('元の列は変えず、順に当てる', () => {
    const b = applyOps(src, [
      { kind: 'flip', pos: 0, bit: 1 },
      { kind: 'set', pos: 1, value: 9 },
      { kind: 'del', pos: 2 },
      { kind: 'ins', pos: 4, value: 7 },
    ]);
    expect([...b]).toEqual([3, 9, 4, 5, 7]);
    expect([...src]).toEqual([1, 2, 3, 4, 5]);
  });
  it('切断は後ろを捨て、範囲の外は無視する', () => {
    expect([...applyOps(src, [{ kind: 'cut', pos: 2 }])]).toEqual([1, 2]);
    expect([...applyOps(src, [{ kind: 'flip', pos: 9, bit: 0 }])]).toEqual([...src]);
  });
  it('種が同じなら同じ位置を壊す', () => {
    expect(randomFlips(10, 90, 5, 3)).toEqual(randomFlips(10, 90, 5, 3));
    expect(randomFlips(10, 90, 5, 3)).not.toEqual(randomFlips(10, 90, 5, 4));
    for (const o of randomFlips(10, 90, 50, 1)) expect(o.pos >= 10 && o.pos < 90).toBe(true);
  });
});

describe('壊していないとき', () => {
  for (const f of FMTS)
    it(`${f}: 全部読めて、問題がない`, () => {
      const e = encodeAs(f, PIC),
        d = decodeLax(f, e.bytes);
      expect([d.w, d.h]).toEqual([PIC.w, PIC.h]);
      expect(d.coverage).toBe(1);
      expect(d.issues).toEqual([]);
      expect(d.sumBad).toBe(false);
      expect(damage(d, d).ratio).toBe(0);
    });
  it('JPEG: 寛容な復号は通常の復号と同じ画素', () => {
    const b = encodeJpeg(PIC.rgba, PIC.w, PIC.h, { q: 75, sub: '420', qt: 'k', huff: 'std' }).bytes;
    expect(decodeJpeg(b, 'lin', { tolerant: true }).rgba).toEqual(decodeJpeg(b).rgba);
  });
  it('JPEG: RST を入れても通常の復号で同じ画素に戻る', () => {
    const o = { q: 75, sub: '420', qt: 'k', huff: 'std' } as const;
    const plain = decodeJpeg(encodeJpeg(PIC.rgba, PIC.w, PIC.h, o).bytes).rgba;
    for (const huff of ['std', 'opt'] as const) {
      const b = encodeJpeg(PIC.rgba, PIC.w, PIC.h, { ...o, huff, dri: 4 }).bytes;
      expect(decodeJpeg(b).rgba).toEqual(plain);
      expect(decodeJpeg(b, 'lin', { tolerant: true }).rgba).toEqual(plain);
    }
  });
});

describe('止まらない復号', () => {
  it('どう壊しても例外を投げず、上限を超えない', () => {
    const r = rng(9);
    for (const f of FMTS) {
      const e = encodeAs(f, PIC);
      for (let i = 0; i < 400; i++) {
        /* 半分はヘッダの近くを壊す */
        const span = i % 2 ? 900 : e.bytes.length,
          pos = Math.floor(r() * Math.min(span, e.bytes.length)),
          kind = i % 4;
        const b = applyOps(e.bytes, [
          kind === 0
            ? { kind: 'flip', pos, bit: Math.floor(r() * 8) }
            : kind === 1
              ? { kind: 'set', pos, value: Math.floor(r() * 256) }
              : kind === 2
                ? { kind: 'del', pos }
                : { kind: 'ins', pos, value: Math.floor(r() * 256) },
        ]);
        const d = decodeLax(f, b);
        expect(d.w * d.h).toBeLessThanOrEqual(MAX_PIXELS);
        expect(d.rgba.length).toBe(d.w * d.h * 4);
        expect(d.issues).not.toContain('読み取り不能');
      }
    }
  });
  it('巨大な大きさの値は描かない', () => {
    for (const f of FMTS) {
      const e = makeBase(f, PIC, ENCODE_DEFAULTS).e,
        big = { ...PLAN, width: 60000, height: 60000 },
        d = decodeLax(
          f,
          applyOps(e.bytes, [
            ...planOps(f, e, { ...big, place: 'width' }),
            ...planOps(f, e, { ...big, place: 'height' }),
          ]),
        );
      expect([d.w, d.h], f).toEqual([0, 0]);
      expect(d.issues, f).toContain('大きさの上限超え');
    }
  });
  it('途中で切ると、切った所より先は読めない', () => {
    for (const f of FMTS) {
      const e = encodeAs(f, PIC),
        dp = e.parts.find((p) => p.data) as { start: number; end: number },
        d = decodeLax(f, e.bytes.slice(0, dp.start + Math.floor((dp.end - dp.start) / 2)));
      expect(d.coverage, f).toBeGreaterThan(0.1);
      expect(d.coverage, f).toBeLessThan(0.9);
      /* 読めなかった所は透明 */
      expect(d.rgba[d.rgba.length - 1], f).toBe(0);
    }
  });
});

describe('PNG', () => {
  const W = 40,
    H = 30,
    flat = new Uint8ClampedArray(W * H * 4).fill(128);
  for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
  /** 圧縮なしで (x, y) の赤のバイトを壊し、変わった画素を返す */
  function changed(filter: 0 | 1 | 2 | 3 | 4, x: number, y: number): Set<string> {
    const e = encodePng(flat, W, H, { colorType: 2, filter, level: 0, trace: false });
    if (!e.ok) throw new Error('encode');
    const c = decodePng(e.bytes, { tolerant: true, trace: false }).rgba;
    /* stored ブロックの頭 5 バイトは 1 つだけ。チャンクの頭 8 と zlib の頭 2 の後 */
    const start = 33 + 8 + 2 + 5,
      pos = start + y * (1 + W * 3) + 1 + x * 3,
      b = applyOps(e.bytes, [{ kind: 'flip', pos, bit: 6 }]),
      d = decodePng(b, { tolerant: true, ignoreCrc: true, trace: false, keepGoing: true }).rgba,
      s = new Set<string>();
    for (let v = 0; v < H; v++)
      for (let u = 0; u < W; u++) if (d[(v * W + u) * 4] !== c[(v * W + u) * 4]) s.add(`${u},${v}`);
    return s;
  }
  it('None は 1 画素、Sub は右へ、Up は下へ広がる', () => {
    expect([...changed(0, 10, 10)]).toEqual(['10,10']);
    const sub = changed(1, 10, 10);
    expect(sub.size).toBe(W - 10);
    expect(sub.has('39,10')).toBe(true);
    const up = changed(2, 10, 10);
    expect(up.size).toBe(H - 10);
    expect(up.has('10,29')).toBe(true);
  });
  it('Paeth と Average は右と下の両方へ広がる', () => {
    for (const f of [3, 4] as const) {
      const s = changed(f, 10, 10);
      expect(s.has('11,10'), String(f)).toBe(true);
      expect(s.has('10,11'), String(f)).toBe(true);
      expect(s.size, String(f)).toBeGreaterThan(H);
    }
  });
  it('5 以上のフィルタ番号は既定で止まり、keepGoing で None として続ける', () => {
    /* 2 行 2 バイト、2 行目の番号が 9 */
    const data = Uint8Array.of(0, 1, 2, 9, 3, 4);
    const a = unfilterImage(data, 2, 2, 1);
    expect([a.rows, a.badRow]).toEqual([1, 1]);
    const b = unfilterImage(data, 2, 2, 1, true);
    expect([b.rows, b.badRow]).toEqual([2, 1]);
    expect([...b.raw]).toEqual([1, 2, 3, 4]);
  });
  it('検査値が合わないことを知らせ、画像は描く', () => {
    const e = encodeAs('png', PIC),
      i = e.parts.find((p) => p.name === 'IHDR') as { end: number },
      d = decodeLax('png', applyOps(e.bytes, [{ kind: 'flip', pos: i.end - 1, bit: 0 }]));
    expect(d.sumBad).toBe(true);
    expect(d.coverage).toBe(1);
  });
});

describe('JPEG', () => {
  const ENC: EncodeOpts = { ...ENCODE_DEFAULTS };
  /** データの前の方の各位置・各ビットを壊した崩れのうち、最も大きいもの */
  function worst(dri: number): number {
    const b = makeBase('jpeg', PIC, { ...ENC, dri }),
      dp = b.e.parts.find((p) => p.data) as { start: number; end: number };
    let m = 0;
    for (let i = 8; i < 48; i++)
      for (let bit = 0; bit < 8; bit++) {
        const d = decodeLax('jpeg', applyOps(b.e.bytes, [{ kind: 'flip', pos: dp.start + i, bit }]));
        m = Math.max(m, damage(b.clean, d).ratio);
      }
    return m;
  }
  it('RST があると崩れが間隔の中で止まる', () => {
    expect(worst(0)).toBeGreaterThan(0.3);
    expect(worst(2)).toBeLessThan(0.1);
  });
  it('マーカーの番号が飛ぶと、その間隔のブロックを読まない', () => {
    const b = encodeJpeg(PIC.rgba, PIC.w, PIC.h, { q: 75, sub: '420', qt: 'k', huff: 'std', dri: 2 }).bytes;
    /* 最初の RST0（FF D0）を読めなくする代わりに RST1 に書き換える */
    let at = -1;
    for (let i = 0; i < b.length - 1; i++)
      if (b[i] === 0xff && b[i + 1] === 0xd0) {
        at = i;
        break;
      }
    expect(at).toBeGreaterThan(0);
    const c = b.slice();
    c[at + 1] = 0xd1;
    const d = decodeJpeg(c, 'lin', { tolerant: true });
    expect(d.issues.map((i) => i.reason)).toContain('rst-order');
    expect(d.coverage).toBeLessThan(1);
  });
  it('表がなくても止まらない', () => {
    const e = encodeAs('jpeg', PIC),
      dht = e.parts.find((p) => p.name === 'DHT') as { start: number; end: number },
      dqt = e.parts.find((p) => p.name === 'DQT') as { start: number; end: number };
    /* マーカーを COM に変えて読み飛ばさせる */
    const noH = applyOps(e.bytes, [{ kind: 'set', pos: dht.start + 1, value: 0xfe }]),
      noQ = applyOps(e.bytes, [{ kind: 'set', pos: dqt.start + 1, value: 0xfe }]),
      a = decodeJpeg(noH, 'lin', { tolerant: true }),
      b = decodeJpeg(noQ, 'lin', { tolerant: true });
    expect(a.issues.map((i) => i.reason)).toContain('no-dht');
    expect(b.issues.map((i) => i.reason)).toContain('no-dqt');
    /* 標準の表で符号化しているので、標準の表に戻せば読める */
    expect(a.coverage).toBe(1);
    expect(() => decodeJpeg(noH)).toThrow();
    expect(() => decodeJpeg(noQ)).toThrow();
  });
});

describe('GIF', () => {
  const m = 4,
    idx = Uint8Array.from({ length: 2000 }, (_, i) => (i * i) % 16),
    enc = encodeLzw(idx, m).data;
  it('辞書にない符号で既定は止まり、keepGoing は読み続ける', () => {
    /* 先頭の Clear の直後の符号（5 ビット）を 1 画素の範囲の外にする */
    const c = enc.slice();
    c[0] = (c[0] & 0b00011111) | (0b11100000 & 0xff);
    c[1] |= 0b11;
    const a = decodeLzw(c, m, idx.length),
      b = decodeLzw(c, m, idx.length, { keepGoing: true });
    expect(a.stop).toBe('bad-code');
    expect(a.n).toBe(0);
    expect(b.bad).toBeGreaterThan(0);
    expect(b.n).toBeGreaterThan(idx.length / 2);
  });
  it('壊れていなければ keepGoing でも同じ', () => {
    const a = decodeLzw(enc, m, idx.length),
      b = decodeLzw(enc, m, idx.length, { keepGoing: true });
    expect(b.out).toEqual(a.out);
    expect(b.bad).toBe(0);
    expect(b.stop).toBe('eoi');
  });
  it('署名や区画の印を壊しても次の区画を探して読む', () => {
    const e = encodeAs('gif', PIC),
      sig = applyOps(e.bytes, [{ kind: 'flip', pos: 0, bit: 0 }]);
    expect(parseGif(sig)).toBeNull();
    expect(parseGif(sig, { lenient: true })?.frames.length).toBe(1);
    const gce = e.parts.find((p) => p.name === '制御') as { start: number },
      broken = applyOps(e.bytes, [{ kind: 'flip', pos: gce.start, bit: 0 }]),
      d = decodeLax('gif', broken);
    expect(d.coverage).toBe(1);
    expect(d.issues).toContain('区画の並びの乱れ');
  });
  it('色表がないと番号を灰色で描く', () => {
    const w = 8,
      h = 8,
      e = encodeGif({
        w,
        h,
        gct: null,
        bg: 0,
        loop: null,
        frames: [
          {
            x: 0,
            y: 0,
            w,
            h,
            idx: new Uint8Array(64).fill(1),
            disposal: 0,
            delay: 0,
            transparent: -1,
            interlace: false,
          },
        ],
      }),
      d = decodeLax('gif', e.bytes);
    expect(d.issues).toContain('色表なし');
    expect(d.rgba[0]).toBe(1);
    expect(d.rgba[3]).toBe(255);
  });
  it('インターレースは読めた行を飛び飛びに描く', () => {
    const e = encodeAs('gif', PIC, { ...ENCODE_DEFAULTS, interlace: true }),
      dp = e.parts.find((p) => p.data) as { start: number; end: number },
      d = decodeLax('gif', e.bytes.slice(0, dp.start + Math.floor((dp.end - dp.start) * 0.2)));
    /* 最初のパスは 8 行おき */
    expect(d.rgba[(8 * PIC.w + 3) * 4 + 3]).toBe(255);
    expect(d.rgba[(7 * PIC.w + 3) * 4 + 3]).toBe(0);
  });
});

describe('場所', () => {
  const fmts: Fmt[] = [...FMTS];
  it('幅と高さは値をそのまま書く', () => {
    for (const f of fmts) {
      const b = makeBase(f, PIC, ENCODE_DEFAULTS),
        w = outcome(f, b, { ...PLAN, place: 'width', width: 104 }, false).d,
        h = outcome(f, b, { ...PLAN, place: 'height', height: 48 }, false).d;
      expect([w.w, w.h], f).toEqual([104, PIC.h]);
      expect([h.w, h.h], f).toEqual([PIC.w, 48]);
    }
  });
  it('幅を増やすと崩れ、高さを減らすと下だけ消える', () => {
    for (const f of fmts) {
      const b = makeBase(f, PIC, ENCODE_DEFAULTS),
        o = outcome(f, b, { ...PLAN, place: 'height', height: 48 }, false);
      expect(o.ratio, f).toBeCloseTo(1 - 48 / PIC.h, 1);
      expect(outcome(f, b, { ...PLAN, place: 'width', width: 104 }, false).ratio, f).toBeGreaterThan(0.2);
    }
  });
  it('色の情報と符号の表はヘッダかデータの先頭にある', () => {
    for (const f of fmts) {
      const e = encodeAs(f, PIC),
        dp = e.parts.find((p) => p.data) as { start: number; end: number };
      for (const pl of ['color', 'table'] as const) {
        const r = locate(f, e, pl);
        expect(r.end, `${f} ${pl}`).toBeGreaterThan(r.start);
        expect(r.end, `${f} ${pl}`).toBeLessThanOrEqual(dp.start + 80);
      }
    }
  });
  it('操作の数と位置は設定どおり', () => {
    const e = encodeAs('jpeg', PIC),
      dp = e.parts.find((p) => p.data) as { start: number; end: number };
    const ops = planOps('jpeg', e, { ...PLAN, n: 8, pos: 0.5 });
    expect(ops.length).toBe(8);
    expect(ops[0].pos).toBe(dp.start + Math.floor(0.5 * (dp.end - dp.start)));
    for (const o of ops) expect(o.pos).toBeGreaterThanOrEqual(ops[0].pos);
    expect(planOps('jpeg', e, { ...PLAN, op: 'cut', n: 8 }).length).toBe(1);
    /* 短い範囲には何か所も当てない */
    expect(planOps('gif', encodeAs('gif', PIC), { ...PLAN, place: 'table', n: 64 }).length).toBe(1);
    expect(planOps('png', encodeAs('png', PIC), { ...PLAN, place: 'color', n: 8 }).length).toBe(1);
  });
  it('PNG の色の型は読める値の間を動く', () => {
    const b = makeBase('png', PIC, ENCODE_DEFAULTS);
    for (let seed = 1; seed < 30; seed++) {
      const o = outcome('png', b, { ...PLAN, place: 'color', n: 1, seed, pos: 0 }, false);
      expect(o.d.issues).not.toContain('IHDR の値の不正');
    }
  });
  it('バイト列はブラウザで開くときだけ返す', () => {
    const b = makeBase('gif', PIC, ENCODE_DEFAULTS);
    expect(outcome('gif', b, PLAN, false).bytes).toBeNull();
    expect(outcome('gif', b, PLAN, true).bytes?.length).toBe(b.e.bytes.length);
  });
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decode, parse, readFormat } from '../src/tools/qr-code/decode';
import { type Encoded, encode, type Mode, penalty, sjisMap, units } from '../src/tools/qr-code/encode';
import { div, EXP, LOG, mul } from '../src/tools/qr-code/gf';
import { generator, rsDecode, rsEncode } from '../src/tools/qr-code/rs';
import { alignPos, blocks, type Ecc, formatBits, frame, Role, size, versionBits } from '../src/tools/qr-code/spec';

/** 決まった種から作る疑似乱数（xorshift） */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
const ok = (r: ReturnType<typeof encode>): Encoded => {
  if ('err' in r) throw new Error(r.err);
  return r;
};
const opts = { ecc: 'M' as Ecc, ver: 0, mask: -1, mode: 'auto' as const, boost: false };

describe('GF(2⁸)', () => {
  it('指数表と対数表が逆になり、α の位数が 255', () => {
    for (let x = 1; x < 256; x++) expect(EXP[LOG[x]]).toBe(x);
    expect(new Set(EXP.slice(0, 255)).size).toBe(255);
  });
  it('掛け算と割り算', () => {
    for (let a = 1; a < 256; a += 7) for (let b = 1; b < 256; b += 11) expect(div(mul(a, b), b)).toBe(a);
    expect(mul(0x80, 2)).toBe(0x1d);
  });
});

describe('リード・ソロモン符号', () => {
  it('Thonky の例（HELLO WORLD・1-M）の誤り訂正語', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsEncode(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it('生成多項式の根は α⁰〜α^(n−1)', () => {
    const g = generator(7);
    expect(g[0]).toBe(1);
    for (let i = 0; i < 7; i++) {
      let y = 0;
      for (const c of g) y = mul(y, EXP[i]) ^ c;
      expect(y).toBe(0);
    }
  });
  it('n/2 語までの誤りを直し、途中の値も返す', () => {
    const r = rng(7);
    for (let t = 0; t < 200; t++) {
      const k = 5 + Math.floor(r() * 40),
        n = 2 * (1 + Math.floor(r() * 15)),
        data = Array.from({ length: k }, () => Math.floor(r() * 256)),
        cw = [...data, ...rsEncode(data, n)],
        recv = cw.slice(),
        ne = Math.floor(r() * (n / 2 + 1)),
        pos = new Set<number>();
      while (pos.size < ne) pos.add(Math.floor(r() * cw.length));
      for (const p of pos) recv[p] ^= 1 + Math.floor(r() * 255);
      const d = rsDecode(recv, n);
      expect(d.ok).toBe(true);
      expect(d.out).toEqual(cw);
      expect(d.fixes.map((f) => f.i)).toEqual([...pos].sort((a, b) => a - b));
      expect(d.lambda.length - 1).toBe(ne);
    }
  });
  it('n/2 語を超えると直せないか、別の符号語になる', () => {
    const r = rng(9),
      data = Array.from({ length: 20 }, () => Math.floor(r() * 256)),
      cw = [...data, ...rsEncode(data, 10)];
    let fail = 0;
    for (let t = 0; t < 100; t++) {
      const recv = cw.slice();
      for (let i = 0; i < 6; i++) recv[(i * 5 + t) % cw.length] ^= 1 + ((t + i) % 255);
      const d = rsDecode(recv, 10);
      if (!d.ok) fail++;
      else expect(d.out).not.toEqual(cw);
    }
    expect(fail).toBeGreaterThan(90);
  });
});

describe('型番ごとの数', () => {
  it('大きさと位置合わせの模様（Thonky の表の例）', () => {
    expect(size(1)).toBe(21);
    expect(size(40)).toBe(177);
    expect(alignPos(2)).toEqual([6, 18]);
    expect(alignPos(7)).toEqual([6, 22, 38]);
    expect(alignPos(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignPos(36)).toEqual([6, 24, 50, 76, 102, 128, 154]);
    expect(alignPos(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });
  it('符号語の数（Thonky の誤り訂正の表の例）', () => {
    expect(blocks(1, 'M')).toEqual({ total: 26, data: 16, ec: 10, sizes: [16] });
    expect(blocks(5, 'Q')).toEqual({ total: 134, data: 62, ec: 18, sizes: [15, 15, 16, 16] });
    expect(blocks(40, 'H').total).toBe(3706);
    expect(blocks(40, 'L').data).toBe(2956);
  });
  it('余りのビットは 0・3・4・7', () => {
    const rem = Array.from({ length: 40 }, (_, i) => frame(i + 1).order.length % 8);
    expect(new Set(rem)).toEqual(new Set([0, 3, 4, 7]));
    expect(rem[0]).toBe(0);
    expect(rem[1]).toBe(7);
  });
  it('形式情報の 32 通りの符号どうしは 7 ビット以上、型番情報は 8 ビット以上違う', () => {
    const pop = (v: number) => v.toString(2).replace(/0/g, '').length;
    const f = ['L', 'M', 'Q', 'H'].flatMap((e) => Array.from({ length: 8 }, (_, m) => formatBits(e as Ecc, m)));
    const v = Array.from({ length: 34 }, (_, i) => versionBits(i + 7));
    const minD = (a: number[]) => Math.min(...a.flatMap((x, i) => a.slice(i + 1).map((y) => pop(x ^ y))));
    expect(minD(f)).toBe(7);
    expect(minD(v)).toBe(8);
  });
  it('形式情報と型番情報（BCH）', () => {
    expect(formatBits('M', 2).toString(2).padStart(15, '0')).toBe('101111001111100');
    expect(formatBits('L', 4).toString(2).padStart(15, '0')).toBe('110011000101111');
    expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
  });
});

describe('符号化', () => {
  it('ビット列の区切り（例: https://nanase.cc/tools/qr-code/ ・M）', () => {
    const q = ok(encode('https://nanase.cc/tools/qr-code/', opts));
    expect([q.ver, q.mode, q.mask]).toEqual([3, 'byte', 2]);
    expect(q.spans.filter((s) => s.k !== 'data').map((s) => [s.k, s.from, s.to])).toEqual([
      ['mode', 0, 4],
      ['count', 4, 12],
      ['term', 268, 272],
      ['pad', 272, 280],
      ['pad', 280, 288],
      ['pad', 288, 296],
      ['pad', 296, 304],
      ['pad', 304, 312],
      ['pad', 312, 320],
      ['pad', 320, 328],
      ['pad', 328, 336],
      ['pad', 336, 344],
      ['pad', 344, 352],
    ]);
    expect(
      q.cw
        .slice(44)
        .map((v) => v.toString(16).toUpperCase().padStart(2, '0'))
        .join(' '),
    ).toBe('BF 78 EC BF A7 DC FC F1 D3 FB 55 1A 66 2A D1 21 CA 50 F9 91 29 38 43 97 D4 85');
    expect(q.pens.map((p) => p.total)).toEqual([1545, 1383, 1306, 1332, 1428, 1407, 1384, 1416]);
  });
  it('Nayuki の実装と同じ模様になる（型番 1〜40、4 つのレベル、3 つのモード）', () => {
    const fx = JSON.parse(readFileSync(new URL('./fixtures/qr-code/nayuki.json', import.meta.url), 'utf8'));
    for (const c of fx.cases as {
      text: string;
      ecc: Ecc;
      mode: Mode;
      mask: number;
      ver: number;
      gotMask: number;
      sha256: string;
    }[]) {
      const q = ok(encode(c.text, { ...opts, ecc: c.ecc, mode: c.mode, mask: c.mask }));
      expect([q.ver, q.mask]).toEqual([c.ver, c.gotMask]);
      expect(createHash('sha256').update(Array.from(q.mods).join('')).digest('hex')).toBe(c.sha256);
    }
  });
  it('モードの自動の選び方と、使えない文字', () => {
    expect(ok(encode('0123456789', opts)).mode).toBe('num');
    expect(ok(encode('HELLO WORLD', opts)).mode).toBe('alnum');
    expect(ok(encode('hello', opts)).mode).toBe('byte');
    const e = encode('ABC1a', { ...opts, mode: 'alnum' });
    expect(e).toEqual({ err: 'char', mode: 'alnum', at: 4, ch: 'a' });
  });
  it.runIf(sjisMap())('漢字モード: 規格の例の「点」「茗」の値', () => {
    expect(units(['点', '茗'], 'kanji').map((u) => u.v)).toEqual([0xd9f, 0x1aaa]);
    const q = ok(encode('漢字モード', opts));
    expect(q.mode).toBe('kanji');
    expect(decode(q.mods, q.n)?.parsed.text).toBe('漢字モード');
  });
  it('入らない長さ・固定した型番・レベルを上げる', () => {
    expect(encode('A'.repeat(5000), opts)).toMatchObject({ err: 'long', ver: 40 });
    expect(ok(encode('HELLO', { ...opts, ver: 5 })).ver).toBe(5);
    expect(encode('A'.repeat(100), { ...opts, ver: 1 })).toMatchObject({ err: 'long', ver: 1 });
    const b = ok(encode('https://nanase.cc/tools/qr-code/', { ...opts, boost: true }));
    expect([b.ver, b.ecc, b.ecc0]).toEqual([3, 'Q', 'M']);
  });
  it('失点の 4 つの和', () => {
    const q = ok(encode('HELLO WORLD', opts));
    for (const p of q.pens) expect(p.n1 + p.n2 + p.n3 + p.n4).toBe(p.total);
    expect(penalty(q.mods, q.n).total).toBe(q.pens[q.mask].total);
  });
  it('符号語の地図: 置いたビットが符号語の値と合う', () => {
    const q = ok(encode('The quick brown fox jumps over the lazy dog 0123456789', { ...opts, ecc: 'Q' }));
    expect(q.bk.sizes.length).toBeGreaterThan(1);
    let n = 0;
    for (let i = 0; i < q.n * q.n; i++) {
      const c = q.cwAt[i];
      if (c < 0) continue;
      expect(q.base[i]).toBe((q.cw[c] >> q.bitAt[i]) & 1);
      n++;
    }
    expect(n).toBe(q.cw.length * 8);
    expect(q.frame.role.filter((r) => r === Role.Data).length).toBe(q.frame.order.length);
  });
});

describe('復号', () => {
  it('汚していなければそのまま読める（モードと型番を変えて）', () => {
    for (const [t, m] of [
      ['https://nanase.cc/tools/qr-code/', 'auto'],
      ['31415926535897932384626433832795', 'num'],
      ['QR CODE $%*+-./:', 'alnum'],
      ['日本語と English を混ぜた文字列 🍣', 'byte'],
    ] as const) {
      for (const ecc of ['L', 'M', 'Q', 'H'] as Ecc[]) {
        const q = ok(encode(t, { ...opts, ecc, mode: m })),
          d = decode(q.mods, q.n);
        expect(d?.ok).toBe(true);
        expect(d?.parsed.text).toBe(t);
        expect([d?.ecc, d?.mask]).toEqual([q.ecc, q.mask]);
      }
    }
  });
  it('しみとこすれの例: 11 語の誤りを直す', () => {
    const q = ok(encode('https://nanase.cc/tools/qr-code/', opts)),
      m = q.mods.slice(),
      n = q.n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const dx = (x - 16.5) / 3.4,
          dy = (y - 13.5) / 2.7,
          w = 0.25 * Math.sin(x * 1.7 + y * 0.9),
          t = (x - 10) * 0.4 - (y - 25);
        if (dx * dx + dy * dy < 1 + w) m[y * n + x] = 1;
        else if (x >= 10 && x <= 19 && y >= 20 && y <= 27 && Math.abs(t - 2) < 0.75) m[y * n + x] = 0;
      }
    const d = decode(m, n);
    expect(d?.rs[0].fixes.map((f) => f.i)).toEqual([20, 26, 27, 30, 31, 34, 40, 41, 43, 45, 46]);
    expect(d?.ok).toBe(true);
    expect(d?.parsed.text).toBe('https://nanase.cc/tools/qr-code/');
    expect(d?.raw.text).not.toBe(d?.parsed.text);
  });
  it('ブロックごとに上限まで壊しても読める（型番 10・H）', () => {
    const t = 'x'.repeat(100),
      q = ok(encode(t, { ...opts, ecc: 'H', ver: 10 })),
      d0 = decode(q.mods, q.n);
    expect(d0?.ok).toBe(true);
    /* 置く順の符号語を、ブロックごとに ec/2 語ずつ壊す */
    const m = q.mods.slice(),
      per = new Map<number, number>(),
      hit = new Set<number>();
    q.src.forEach((s, i) => {
      const k = per.get(s.b) ?? 0;
      if (k < q.bk.ec / 2 && i % 3 === 0) {
        per.set(s.b, k + 1);
        hit.add(i);
      }
    });
    for (let i = 0; i < q.n * q.n; i++) if (hit.has(q.cwAt[i]) && q.bitAt[i] === 0) m[i] ^= 1;
    const d = decode(m, q.n);
    expect(d?.ok).toBe(true);
    expect(d?.parsed.text).toBe(t);
    expect(d?.rs.reduce((s, r) => s + r.fixes.length, 0)).toBe(hit.size);
  });
  it('形式情報は 3 ビットまでの誤りを直す', () => {
    const q = ok(encode('HELLO', opts)),
      m = q.mods.slice();
    m[8 * q.n + 0] ^= 1;
    m[8 * q.n + 1] ^= 1;
    m[0 * q.n + 8] ^= 1;
    const f = readFormat(m, q.n);
    expect(f.ok).toBe(true);
    expect([f.ecc, f.mask]).toEqual([q.ecc, q.mask]);
  });
  it('ビット列の読み方（終端と、区切りごとの文字のビットの範囲）', () => {
    const q = ok(encode('AB1', { ...opts, mode: 'alnum' })),
      p = parse(q.data, q.ver);
    expect(p.text).toBe('AB1');
    expect(p.chars.map((c) => [c.from, c.to])).toEqual([
      [13, 24],
      [13, 24],
      [24, 30],
    ]);
  });
});

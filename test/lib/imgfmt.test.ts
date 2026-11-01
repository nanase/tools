import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, crc32Update } from '../../src/lib/imgfmt/crc32';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('CRC-32', () => {
  it('既知の値: "123456789" は 0xCBF43926、空は 0', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    /* PNG の IEND チャンクの CRC（種類だけにかける） */
    expect(crc32(ascii('IEND'))).toBe(0xae426082);
  });

  it('範囲を指定でき、続けて計算してもつないだ列と同じ', () => {
    const a = ascii('xx123456789yy');
    expect(crc32(a, 2, 11)).toBe(0xcbf43926);
    expect(crc32Update(crc32(a, 2, 6), a, 6, 11)).toBe(0xcbf43926);
  });

  it('node の zlib の crc32 と一致する', () => {
    const d = new Uint8Array(10000);
    for (let i = 0; i < d.length; i++) d[i] = (i * 7919) ^ (i >> 3);
    expect(crc32(d)).toBe(nodeCrc32(d));
  });
});

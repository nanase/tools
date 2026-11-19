/** SMF を組み立てる（テスト用）。tracks は [間隔の tick, …バイト] の並び */
export function smfBytes(fmt: number, ppq: number, tracks: number[][][]): Uint8Array {
  const vlq = (v: number) => {
    const o = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) o.unshift((x & 0x7f) | 0x80);
    return o;
  };
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const out = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, fmt, 0, tracks.length, ppq >> 8, ppq & 255];
  for (const t of tracks) {
    const body = [...t.flatMap(([dt, ...b]) => [...vlq(dt), ...b]), 0, 0xff, 0x2f, 0];
    out.push(0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body);
  }
  return new Uint8Array(out);
}

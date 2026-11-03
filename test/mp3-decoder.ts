/**
 * テストのための MP3 デコーダ（MPEG-1 Layer III・44.1 kHz）。エンコーダのビット列が規格どおりに読めるかを、
 * エンコーダの部品を使わずに確かめる。共有するのは規格の表（tables.ts）だけ
 */
import { HUFF, SYNTH_D } from '../src/tools/mp3/tables';

const SFB_L = [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576];
const SFB_S = [0, 4, 8, 12, 16, 22, 30, 40, 52, 66, 84, 106, 136, 192];
const SLEN = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [3, 0],
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 1],
  [3, 2],
  [3, 3],
  [4, 2],
  [4, 3],
];
const BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const LINBITS: Record<number, number> = {
  16: 1,
  17: 2,
  18: 3,
  19: 4,
  20: 6,
  21: 8,
  22: 10,
  23: 13,
  24: 4,
  25: 5,
  26: 6,
  27: 7,
  28: 8,
  29: 9,
  30: 11,
  31: 13,
};
const CI = [-0.6, -0.535, -0.33, -0.185, -0.095, -0.041, -0.0142, -0.0037];
const PI = Math.PI;

class Reader {
  p = 0;
  constructor(readonly b: Uint8Array) {}
  bit(): number {
    const v = (this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1;
    this.p++;
    return v;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 2 + this.bit();
    return v;
  }
}

/** 符号（長さ・値）から値を引く表 */
const lookup = new Map<number, Map<number, number>>();
for (const [k, e] of Object.entries(HUFF)) {
  const m = new Map<number, number>();
  for (let i = 0; i < e.length; i += 3) m.set(e[i + 2] * 2 ** 24 + e[i + 1], e[i]);
  lookup.set(Number(k), m);
}
function readCode(r: Reader, table: number): number {
  const m = lookup.get(table >= 24 && table < 32 ? 24 : table >= 16 && table < 24 ? 16 : table);
  if (!m) throw new Error(`表がない: ${table}`);
  let c = 0;
  for (let n = 1; n <= 24; n++) {
    c = c * 2 + r.bit();
    const v = m.get(n * 2 ** 24 + c);
    if (v !== undefined) return v;
  }
  throw new Error('符号が読めない');
}

export interface FrameHead {
  offset: number;
  size: number;
  kbps: number;
  ms: boolean;
  nch: number;
  mainBegin: number;
}
interface Gr {
  len: number;
  bv: number;
  gg: number;
  comp: number;
  type: number;
  tables: number[];
  r0: number;
  r1: number;
  sbg: number[];
  preflag: number;
  scale: number;
  c1t: number;
}

/** フレームのヘッダを順にたどる。同期が外れたら例外 */
export function frames(b: Uint8Array): FrameHead[] {
  const out: FrameHead[] = [];
  let o = 0;
  while (o < b.length) {
    if (b[o] !== 0xff || (b[o + 1] & 0xfe) !== 0xfa) throw new Error(`同期が外れた: ${o}`);
    const kbps = BITRATE[b[o + 2] >> 4],
      pad = (b[o + 2] >> 1) & 1,
      mode = b[o + 3] >> 6,
      ext = (b[o + 3] >> 4) & 3,
      nch = mode === 3 ? 1 : 2,
      size = Math.floor((144 * kbps * 1000) / 44100) + pad;
    if (((b[o + 2] >> 2) & 3) !== 0) throw new Error('44.1 kHz でない');
    out.push({
      offset: o,
      size,
      kbps,
      ms: mode === 1 && (ext & 2) !== 0,
      nch,
      mainBegin: (b[o + 4] << 1) | (b[o + 5] >> 7),
    });
    o += size;
  }
  return out;
}

function sideInfo(b: Uint8Array, f: FrameHead): Gr[][] {
  const r = new Reader(b);
  r.p = (f.offset + 4) * 8 + 9 + (f.nch === 1 ? 5 : 3) + 4 * f.nch;
  const out: Gr[][] = [[], []];
  for (let g = 0; g < 2; g++)
    for (let c = 0; c < f.nch; c++) {
      const len = r.bits(12),
        bv = r.bits(9),
        gg = r.bits(8),
        comp = r.bits(4),
        ws = r.bit();
      let type = 0,
        r0 = 0,
        r1 = 0;
      const tables = [0, 0, 0],
        sbg = [0, 0, 0];
      if (ws) {
        type = r.bits(2);
        if (r.bit()) throw new Error('混合ブロックは読まない');
        tables[0] = r.bits(5);
        tables[1] = r.bits(5);
        for (let i = 0; i < 3; i++) sbg[i] = r.bits(3);
        r0 = type === 2 ? 8 : 7;
        r1 = 36;
      } else {
        for (let i = 0; i < 3; i++) tables[i] = r.bits(5);
        r0 = r.bits(4);
        r1 = r.bits(3);
      }
      out[g][c] = { len, bv, gg, comp, type, tables, r0, r1, sbg, preflag: r.bit(), scale: r.bit(), c1t: r.bit() };
    }
  return out;
}

/** 量子化した値を読む */
function readValues(r: Reader, g: Gr, end: number, ix: Int32Array): void {
  ix.fill(0);
  const e0 = g.type === 2 ? 36 : SFB_L[Math.min(g.r0 + 1, 22)],
    e1 = g.type !== 0 ? 576 : SFB_L[Math.min(g.r0 + g.r1 + 2, 22)],
    big = g.bv * 2;
  let i = 0;
  while (i < big) {
    const t = i < e0 ? g.tables[0] : i < e1 ? g.tables[1] : g.tables[2];
    if (t === 0) {
      i += 2;
      continue;
    }
    const v = readCode(r, t),
      lin = LINBITS[t] || 0;
    let x = v >> 4,
      y = v & 15;
    if (lin && x === 15) x += r.bits(lin);
    if (x && r.bit()) x = -x;
    if (lin && y === 15) y += r.bits(lin);
    if (y && r.bit()) y = -y;
    ix[i++] = x;
    ix[i++] = y;
  }
  while (r.p < end && i + 3 < 576) {
    const v = readCode(r, g.c1t ? 33 : 32);
    for (const m of [8, 4, 2, 1]) {
      let q = v & m ? 1 : 0;
      if (q && r.bit()) q = -q;
      ix[i++] = q;
    }
  }
  if (r.p !== end) throw new Error(`part2_3_length と合わない: ${r.p} ${end}`);
}

/** MP3 を読み、チャンネルごとの音を返す（遅れはそのまま） */
export function decode(b: Uint8Array): Float32Array[] {
  const fs = frames(b),
    nch = fs[0].nch,
    out = Array.from({ length: nch }, () => new Float32Array(fs.length * 1152)),
    prev = Array.from({ length: nch }, () => new Float64Array(576)),
    V = Array.from({ length: nch }, () => new Float64Array(1024)),
    /* メインデータだけをつないだ列 */
    stream = new Uint8Array(b.length),
    ix = new Int32Array(576),
    N = new Float64Array(64 * 32);
  for (let i = 0; i < 64; i++)
    for (let k = 0; k < 32; k++) N[i * 32 + k] = Math.cos(((16 + i) * (2 * k + 1) * PI) / 64);
  const win36 = (type: number, i: number) => {
    if (type === 1)
      return i < 18 ? Math.sin((PI / 36) * (i + 0.5)) : i < 24 ? 1 : i < 30 ? Math.sin((PI / 12) * (i - 18 + 0.5)) : 0;
    if (type === 3)
      return i < 6 ? 0 : i < 12 ? Math.sin((PI / 12) * (i - 6 + 0.5)) : i < 18 ? 1 : Math.sin((PI / 36) * (i + 0.5));
    return Math.sin((PI / 36) * (i + 0.5));
  };
  let have = 0;
  fs.forEach((f, fi) => {
    const si = sideInfo(b, f),
      head = 4 + (f.nch === 1 ? 17 : 32),
      slots = f.size - head;
    if (f.mainBegin > have) throw new Error(`main_data_begin が前のデータを超えた: ${f.mainBegin} ${have}`);
    const r = new Reader(stream);
    r.p = (have - f.mainBegin) * 8;
    stream.set(b.subarray(f.offset + head, f.offset + f.size), have);
    have += slots;
    for (let g = 0; g < 2; g++) {
      const xrs: Float64Array[] = [];
      for (let c = 0; c < nch; c++) {
        const gr = si[g][c],
          start = r.p,
          [s1, s2] = SLEN[gr.comp],
          xr = new Float64Array(576);
        xrs[c] = xr;
        const sf: number[] = [];
        if (gr.type === 2) {
          for (let s = 0; s < 12; s++) for (let w = 0; w < 3; w++) sf.push(r.bits(s <= 5 ? s1 : s2));
          for (let w = 0; w < 3; w++) sf.push(0);
        } else {
          for (let s = 0; s < 21; s++) sf.push(r.bits(s <= 10 ? s1 : s2));
          sf.push(0);
        }
        readValues(r, gr, start + gr.len, ix);
        const mul = gr.scale ? 1 : 0.5,
          base = 2 ** ((gr.gg - 210) / 4),
          rq = (v: number, k: number) => Math.sign(v) * Math.abs(v) ** (4 / 3) * base * 2 ** (-mul * k);
        if (gr.type === 2) {
          /* sfb・窓の順から、帯域 × 周波数 × 窓の順へ */
          let p = 0;
          for (let s = 0; s < 13; s++)
            for (let w = 0; w < 3; w++)
              for (let q = SFB_S[s]; q < SFB_S[s + 1]; q++) {
                const sb = Math.floor(q / 6);
                xr[sb * 18 + 3 * (q - sb * 6) + w] = rq(ix[p], sf[s * 3 + w]);
                p++;
              }
        } else for (let s = 0; s < 22; s++) for (let i = SFB_L[s]; i < SFB_L[s + 1]; i++) xr[i] = rq(ix[i], sf[s]);
      }
      if (f.ms)
        for (let i = 0; i < 576; i++) {
          const m = xrs[0][i],
            s = xrs[1][i];
          xrs[0][i] = (m + s) / Math.SQRT2;
          xrs[1][i] = (m - s) / Math.SQRT2;
        }
      for (let c = 0; c < nch; c++) {
        const gr = si[g][c],
          xr = xrs[c],
          raw = new Float64Array(576),
          cur = new Float64Array(576);
        if (gr.type !== 2)
          for (let sb = 1; sb < 32; sb++)
            for (let i = 0; i < 8; i++) {
              const cs = 1 / Math.sqrt(1 + CI[i] * CI[i]),
                ca = CI[i] * cs,
                a = sb * 18 - 1 - i,
                d = sb * 18 + i,
                u = xr[a],
                l = xr[d];
              xr[a] = u * cs - l * ca;
              xr[d] = l * cs + u * ca;
            }
        for (let sb = 0; sb < 32; sb++) {
          const o = new Float64Array(36);
          if (gr.type === 2) {
            for (let w = 0; w < 3; w++)
              for (let i = 0; i < 12; i++) {
                let s = 0;
                for (let k = 0; k < 6; k++)
                  s += xr[sb * 18 + 3 * k + w] * Math.cos((PI / 24) * (2 * i + 1 + 6) * (2 * k + 1));
                o[6 + 6 * w + i] += s * Math.sin((PI / 12) * (i + 0.5));
              }
          } else
            for (let i = 0; i < 36; i++) {
              let s = 0;
              for (let k = 0; k < 18; k++) s += xr[sb * 18 + k] * Math.cos((PI / 72) * (2 * i + 1 + 18) * (2 * k + 1));
              o[i] = s * win36(gr.type, i);
            }
          for (let i = 0; i < 18; i++) {
            raw[sb * 18 + i] = o[i] + prev[c][sb * 18 + i];
            prev[c][sb * 18 + i] = o[i + 18];
          }
        }
        for (let t = 0; t < 18; t++) {
          const v = V[c];
          v.copyWithin(64, 0, 960);
          for (let i = 0; i < 64; i++) {
            let s = 0;
            for (let k = 0; k < 32; k++) {
              const q = raw[k * 18 + t];
              s += N[i * 32 + k] * (k & 1 && t & 1 ? -q : q);
            }
            v[i] = s;
          }
          for (let j = 0; j < 32; j++) {
            let s = 0;
            for (let i = 0; i < 8; i++) {
              s += v[i * 128 + j] * SYNTH_D[i * 64 + j];
              s += v[i * 128 + 96 + j] * SYNTH_D[i * 64 + 32 + j];
            }
            cur[t * 32 + j] = s;
          }
        }
        out[c].set(cur.subarray(0, 576), fi * 1152 + g * 576);
      }
    }
  });
  return out;
}

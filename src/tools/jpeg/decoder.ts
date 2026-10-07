/**
 * ベースラインの JPEG 復号器（T.81 の順次 DCT・ハフマン符号、8 ビット、1 成分か 3 成分）。
 * 自前の符号器が作ったビット列を画素に戻し、途中の係数も返す。プログレッシブ・算術符号には対応しない
 */
import { BitReader } from './bits';
import { type Plane, planesToRgba, type Up, upsample } from './color';
import { dequantIdct, toSample } from './dct';
import { extend } from './huffman';
import { type HuffSpec, ZIGZAG } from './tables';

export interface DecComp {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** ブロックの数（横・縦、MCU の倍数まで） */
  bw: number;
  bh: number;
  /** 量子化された係数（自然順） */
  coef: Int16Array;
  plane: Plane;
}

export interface Decoded {
  w: number;
  h: number;
  comps: DecComp[];
  rgba: Uint8ClampedArray;
  /** 出てきたマーカーの名前の並び */
  markers: string[];
  /** JFIF の版（APP0 があれば） */
  jfif: string;
}

/** 復号用の表（T.81 F.2.2.3 の MINCODE・MAXCODE・VALPTR） */
interface DecTab {
  min: Int32Array;
  max: Int32Array;
  ptr: Int32Array;
  vals: readonly number[];
}
function decTab(s: HuffSpec): DecTab {
  const min = new Int32Array(17),
    max = new Int32Array(17).fill(-1),
    ptr = new Int32Array(17);
  let code = 0,
    k = 0;
  for (let l = 1; l <= 16; l++) {
    const n = s.bits[l - 1];
    if (n) {
      ptr[l] = k;
      min[l] = code;
      code += n;
      k += n;
      max[l] = code - 1;
    }
    code <<= 1;
  }
  return { min, max, ptr, vals: s.vals };
}
function decodeSym(r: BitReader, t: DecTab): number {
  let code = r.bit();
  for (let l = 1; l <= 16; l++) {
    if (t.max[l] >= 0 && code <= t.max[l] && code >= t.min[l]) return t.vals[t.ptr[l] + code - t.min[l]];
    code = (code << 1) | r.bit();
  }
  throw new Error('ハフマン符号を読めません');
}

const NAMES = new Map<number, string>([
  [0xd8, 'SOI'],
  [0xd9, 'EOI'],
  [0xc0, 'SOF0'],
  [0xc1, 'SOF1'],
  [0xc4, 'DHT'],
  [0xda, 'SOS'],
  [0xdb, 'DQT'],
  [0xdd, 'DRI'],
  [0xfe, 'COM'],
]);
const nameOf = (m: number): string =>
  NAMES.get(m) ?? (m >= 0xe0 && m <= 0xef ? `APP${m - 0xe0}` : `0x${m.toString(16).toUpperCase()}`);

export function decode(d: Uint8Array, up: Up = 'lin'): Decoded {
  const u16 = (p: number) => (d[p] << 8) | d[p + 1];
  if (u16(0) !== 0xffd8) throw new Error('JPEG ではありません（SOI がない）');
  const markers = ['SOI'],
    qts: Uint16Array[] = [],
    dcT: DecTab[] = [],
    acT: DecTab[] = [];
  let p = 2,
    W = 0,
    H = 0,
    comps: DecComp[] = [],
    hmax = 1,
    vmax = 1,
    ri = 0,
    jfif = '';
  for (;;) {
    while (p < d.length && d[p] !== 0xff) p++;
    while (p < d.length && d[p] === 0xff) p++;
    if (p >= d.length) break;
    const m = d[p++];
    markers.push(nameOf(m));
    if (m === 0xd9) break;
    const len = u16(p),
      end = p + len;
    let q = p + 2;
    if (m === 0xe0 && d[q] === 0x4a && d[q + 1] === 0x46 && d[q + 4] === 0)
      jfif = `${d[q + 5]}.${String(d[q + 6]).padStart(2, '0')}`;
    else if (m === 0xdb)
      while (q < end) {
        const pq = d[q] >> 4,
          tq = d[q] & 15,
          t = new Uint16Array(64);
        q++;
        for (let k = 0; k < 64; k++) {
          t[ZIGZAG[k]] = pq ? u16(q) : d[q];
          q += pq ? 2 : 1;
        }
        qts[tq] = t;
      }
    else if (m === 0xc0 || m === 0xc1) {
      if (d[q] !== 8) throw new Error('8 ビットの標本にだけ対応します');
      H = u16(q + 1);
      W = u16(q + 3);
      const n = d[q + 5];
      comps = [];
      for (let i = 0; i < n; i++) {
        const o = q + 6 + i * 3;
        comps.push({
          id: d[o],
          h: d[o + 1] >> 4,
          v: d[o + 1] & 15,
          tq: d[o + 2],
          bw: 0,
          bh: 0,
          coef: new Int16Array(0),
          plane: { w: 0, h: 0, d: new Uint8Array(0) },
        });
      }
      hmax = Math.max(...comps.map((c) => c.h));
      vmax = Math.max(...comps.map((c) => c.v));
      const mxN = Math.ceil(W / (8 * hmax)),
        myN = Math.ceil(H / (8 * vmax));
      for (const c of comps) {
        c.bw = mxN * c.h;
        c.bh = myN * c.v;
        c.coef = new Int16Array(c.bw * c.bh * 64);
      }
    } else if (m >= 0xc2 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      throw new Error('ベースラインの JPEG にだけ対応します');
    else if (m === 0xc4)
      while (q < end) {
        const tc = d[q] >> 4,
          th = d[q] & 15,
          bits = Array.from(d.subarray(q + 1, q + 17)),
          n = bits.reduce((a, b) => a + b, 0),
          vals = Array.from(d.subarray(q + 17, q + 17 + n));
        (tc ? acT : dcT)[th] = decTab({ bits, vals });
        q += 17 + n;
      }
    else if (m === 0xdd) ri = u16(q);
    else if (m === 0xda) {
      const ns = d[q],
        sc = Array.from({ length: ns }, (_, i) => {
          const c = comps.find((x) => x.id === d[q + 1 + i * 2]);
          if (!c) throw new Error('SOS の成分が SOF にありません');
          return { c, td: d[q + 2 + i * 2] >> 4, ta: d[q + 2 + i * 2] & 15, pred: 0 };
        });
      p = end;
      p = scan(d, p, sc, W, H, hmax, vmax, ri, dcT, acT);
      continue;
    }
    p = end;
  }
  if (!comps.length) throw new Error('SOF がありません');

  /* 逆量子化・逆 DCT */
  const f = new Float64Array(64);
  for (const c of comps) {
    const Q = qts[c.tq];
    if (!Q) throw new Error('量子化テーブルがありません');
    const pw = c.bw * 8,
      pl: Plane = { w: pw, h: c.bh * 8, d: new Uint8Array(pw * c.bh * 8) };
    for (let by = 0; by < c.bh; by++)
      for (let bx = 0; bx < c.bw; bx++) {
        dequantIdct(c.coef.subarray((by * c.bw + bx) * 64, (by * c.bw + bx + 1) * 64), Q, f);
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) pl.d[(by * 8 + y) * pw + bx * 8 + x] = toSample(f[y * 8 + x]);
      }
    c.plane = pl;
  }

  /* 色: 各成分を輝度の大きさに戻して RGB に */
  let rgba: Uint8ClampedArray;
  if (comps.length === 3) {
    const full = comps.map((c) => {
      const fx = hmax / c.h,
        fy = vmax / c.v;
      return {
        w: c.plane.w * fx,
        d: fx === 1 && fy === 1 ? Float32Array.from(c.plane.d) : upsample(c.plane, fx, fy, up),
      };
    });
    rgba = planesToRgba(full[0].d, full[1].d, full[2].d, full[0].w, W, H);
  } else {
    const c = comps[0];
    rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = c.plane.d[y * c.plane.w + x],
          i = (y * W + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
  }
  return { w: W, h: H, comps, rgba, markers, jfif };
}

interface ScanComp {
  c: DecComp;
  td: number;
  ta: number;
  pred: number;
}

/** 1 つのスキャンの符号化したデータを読み、係数を入れる。読み終えた位置を返す */
function scan(
  d: Uint8Array,
  p: number,
  sc: ScanComp[],
  W: number,
  H: number,
  hmax: number,
  vmax: number,
  ri: number,
  dcT: DecTab[],
  acT: DecTab[],
): number {
  const r = new BitReader(d, p);
  const block = (s: ScanComp, b: number) => {
    const t = s.c.coef,
      o = b * 64,
      ds = decodeSym(r, dcT[s.td]);
    s.pred += extend(r.read(ds), ds);
    t[o] = s.pred;
    for (let k = 1; k < 64; ) {
      const rs = decodeSym(r, acT[s.ta]),
        run = rs >> 4,
        sz = rs & 15;
      if (!sz) {
        if (run !== 15) break;
        k += 16;
        continue;
      }
      k += run;
      if (k > 63) throw new Error('係数の位置が 63 を超えます');
      t[o + ZIGZAG[k]] = extend(r.read(sz), sz);
      k++;
    }
  };
  /* 単位: 1 成分なら 1 ブロック（画像にかかるブロックだけ）、複数なら MCU */
  let units: (() => void)[] = [];
  if (sc.length === 1) {
    const s = sc[0],
      c = s.c,
      nx = Math.ceil(Math.ceil((W * c.h) / hmax) / 8),
      ny = Math.ceil(Math.ceil((H * c.v) / vmax) / 8);
    units = Array.from({ length: nx * ny }, (_, i) => () => block(s, Math.floor(i / nx) * c.bw + (i % nx)));
  } else {
    const mxN = Math.ceil(W / (8 * hmax)),
      myN = Math.ceil(H / (8 * vmax));
    units = Array.from({ length: mxN * myN }, (_, i) => () => {
      const mx = i % mxN,
        my = Math.floor(i / mxN);
      for (const s of sc)
        for (let v = 0; v < s.c.v; v++)
          for (let h = 0; h < s.c.h; h++) block(s, (my * s.c.v + v) * s.c.bw + mx * s.c.h + h);
    });
  }
  units.forEach((u, i) => {
    if (ri && i > 0 && i % ri === 0) {
      /* リスタート: バイトの境目に合わせ、RSTn を読み飛ばして DC の予測を 0 に戻す */
      r.align();
      if (r.marker >= 0xd0 && r.marker <= 0xd7) {
        r.p += 2;
        r.marker = -1;
      } else {
        while (r.p < d.length - 1 && !(d[r.p] === 0xff && d[r.p + 1] >= 0xd0 && d[r.p + 1] <= 0xd7)) r.p++;
        r.p += 2;
      }
      for (const s of sc) s.pred = 0;
    }
    u();
  });
  /* 次のマーカーまで進める */
  let q = r.p;
  while (q < d.length - 1 && !(d[q] === 0xff && d[q + 1] !== 0 && !(d[q + 1] >= 0xd0 && d[q + 1] <= 0xd7))) q++;
  return q;
}

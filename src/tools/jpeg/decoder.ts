/**
 * ベースラインの JPEG 復号器（T.81 の順次 DCT・ハフマン符号、8 ビット、1 成分か 3 成分）。
 * 自前の符号器が作ったビット列を画素に戻し、途中の係数も返す。プログレッシブ・算術符号には対応しない。
 * tolerant なら壊れたファイルでも例外を投げず、読めた所までと見つけた問題を返す
 */
import { BitReader } from './bits';
import { type Plane, planesToRgba, type Up, upsample } from './color';
import { dequantIdct, toSample } from './dct';
import { extend } from './huffman';
import { AC_CHR, AC_LUM, DC_CHR, DC_LUM, type HuffSpec, ZIGZAG } from './tables';

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
  /** スキャンで読んだブロックの印（tolerant のときだけ。長さは bw·bh） */
  seen?: Uint8Array;
}

/** 問題の種類 */
export type JpegReason =
  /** 先頭が SOI でない */
  | 'soi'
  /** 画素の数が上限を超える */
  | 'too-large'
  /** 幅か高さが 0、または成分の数が読めない */
  | 'sof'
  /** SOF がない */
  | 'no-sof'
  /** SOS がない */
  | 'no-sos'
  /** ベースラインでない SOF をベースラインとして読んだ */
  | 'not-baseline'
  /** SOS の成分が SOF にない */
  | 'sos-comp'
  /** 量子化テーブルがない */
  | 'no-dqt'
  /** ハフマン表がないので標準の表で読んだ */
  | 'no-dht'
  /** どの符号にも当たらないビット列 */
  | 'bad-code'
  /** 係数の位置が 63 を超える */
  | 'bad-run'
  /** スキャンの途中の知らないマーカー */
  | 'stray-marker'
  /** リスタートマーカーの番号が順でない */
  | 'rst-order'
  /** 全部のブロックを読む前にデータが尽きた */
  | 'short-scan';

export interface JpegIssue {
  reason: JpegReason;
  /** ファイルの中のバイト位置（分からなければ −1） */
  offset: number;
}

export interface DecodeOpts {
  /** 壊れた所で throw せず、戻せた所までを返す */
  tolerant?: boolean;
  /** 画素の数の上限（tolerant のとき。超えるなら SOF を読んだ所で止める） */
  maxPixels?: number;
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
  /** tolerant のとき見つけた問題（種類ごとに最初の 1 つ） */
  issues: JpegIssue[];
  /** tolerant のとき読めたブロックの割合（輝度の面、0〜1） */
  coverage: number;
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
/** 読めない符号なら −1 */
function decodeSym(r: BitReader, t: DecTab): number {
  let code = r.bit();
  for (let l = 1; l <= 16; l++) {
    if (t.max[l] >= 0 && code <= t.max[l] && code >= t.min[l]) return t.vals[t.ptr[l] + code - t.min[l]] ?? -1;
    code = (code << 1) | r.bit();
  }
  return -1;
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

/** tolerant で読むスキャンの数の上限（壊れて SOS が並んでも時間がかからないように） */
const MAX_SCANS = 16;

export function decode(d: Uint8Array, up: Up = 'lin', opts: DecodeOpts = {}): Decoded {
  const u16 = (p: number) => (d[p] << 8) | d[p + 1];
  const tol = opts.tolerant ?? false,
    issues: JpegIssue[] = [];
  /** tolerant なら記録し、そうでなければ投げる */
  const bad = (reason: JpegReason, offset: number, msg: string): void => {
    if (!tol) throw new Error(msg);
    if (!issues.some((i) => i.reason === reason)) issues.push({ reason, offset });
  };
  if (u16(0) !== 0xffd8) bad('soi', 0, 'JPEG ではありません（SOI がない）');
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
    jfif = '',
    scans = 0;
  const std = [decTab(DC_LUM), decTab(AC_LUM), decTab(DC_CHR), decTab(AC_CHR)];
  const empty = (): Decoded => ({
    w: W,
    h: H,
    comps,
    rgba: new Uint8ClampedArray(0),
    markers,
    jfif,
    issues,
    coverage: 0,
  });
  for (;;) {
    while (p < d.length && d[p] !== 0xff) p++;
    while (p < d.length && d[p] === 0xff) p++;
    if (p >= d.length) break;
    const m = d[p++];
    markers.push(nameOf(m));
    if (m === 0xd9 && (!tol || scans > 0)) break;
    /* 長さを持たないマーカー */
    if (tol && (m === 0 || m === 1 || (m >= 0xd0 && m <= 0xd9))) continue;
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
    else if (m === 0xc0 || m === 0xc1 || (tol && m >= 0xc2 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)) {
      if (m > 0xc1) bad('not-baseline', p - 2, '');
      if (d[q] !== 8 && !tol) throw new Error('8 ビットの標本にだけ対応します');
      H = u16(q + 1);
      W = u16(q + 3);
      const n = d[q + 5];
      if (tol && (!W || !H || !n || n > 4 || q + 6 + n * 3 > d.length)) {
        bad('sof', p - 2, '');
        comps = [];
        continue;
      }
      if (tol && opts.maxPixels !== undefined && W * H > opts.maxPixels) {
        bad('too-large', p - 2, '');
        return empty();
      }
      comps = [];
      for (let i = 0; i < n; i++) {
        const o = q + 6 + i * 3,
          /* 倍率の 0 は読めないので 1 に */
          sh = d[o + 1] >> 4,
          sv = d[o + 1] & 15;
        comps.push({
          id: d[o],
          h: tol ? Math.min(4, sh || 1) : sh,
          v: tol ? Math.min(4, sv || 1) : sv,
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
        if (tol) c.seen = new Uint8Array(c.bw * c.bh);
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
      if (tol && (!comps.length || scans >= MAX_SCANS)) {
        p = end;
        continue;
      }
      scans++;
      const ns = tol ? Math.min(4, d[q]) : d[q],
        sc: ScanComp[] = [];
      for (let i = 0; i < ns; i++) {
        const c = comps.find((x) => x.id === d[q + 1 + i * 2]);
        if (!c) {
          bad('sos-comp', q + 1 + i * 2, 'SOS の成分が SOF にありません');
          continue;
        }
        const td = d[q + 2 + i * 2] >> 4,
          ta = d[q + 2 + i * 2] & 15;
        if (!dcT[td] || !acT[ta]) bad('no-dht', p - 2, 'ハフマン表がありません');
        sc.push({ c, dc: dcT[td] ?? std[c.tq ? 2 : 0], ac: acT[ta] ?? std[c.tq ? 3 : 1], pred: 0 });
      }
      p = end;
      if (sc.length) p = tol ? scanTolerant(d, p, sc, W, H, hmax, vmax, ri, bad) : scan(d, p, sc, W, H, hmax, vmax, ri);
      continue;
    }
    p = end;
  }
  if (!comps.length) {
    bad('no-sof', -1, 'SOF がありません');
    return empty();
  }
  if (!scans) bad('no-sos', -1, 'SOS がありません');

  /* 逆量子化・逆 DCT */
  const f = new Float64Array(64);
  for (const c of comps) {
    if (!qts[c.tq]) bad('no-dqt', -1, '量子化テーブルがありません');
    const Q = qts[c.tq] ?? qts.find(Boolean) ?? FLAT_Q;
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
  if (tol && comps.length === 3 && !comps.every((c) => hmax % c.h === 0 && vmax % c.v === 0)) {
    rgba = colorNearest(comps, hmax, vmax, W, H);
  } else if (comps.length === 3) {
    const full = comps.map((c) => {
      const fx = hmax / c.h,
        fy = vmax / c.v;
      return {
        w: c.plane.w * fx,
        d: fx === 1 && fy === 1 ? Float32Array.from(c.plane.d) : upsample(c.plane, fx, fy, up),
      };
    });
    rgba = planesToRgba(full[0].d, full[1].d, full[2].d, full[0].w, W, H);
  } else if (tol) {
    rgba = grayNearest(comps[0], hmax, vmax, W, H);
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
  let coverage = 1;
  if (tol) {
    /* 読めなかったブロックは透明にする（輝度の面で見る） */
    const y = comps[0],
      sx = y.h / hmax,
      sy = y.v / vmax,
      seen = y.seen as Uint8Array;
    let n = 0;
    for (const v of seen) n += v;
    coverage = n / seen.length;
    for (let py = 0; py < H; py++) {
      const by = Math.floor((py * sy) / 8);
      for (let px = 0; px < W; px++) if (!seen[by * y.bw + Math.floor((px * sx) / 8)]) rgba[(py * W + px) * 4 + 3] = 0;
    }
  }
  return { w: W, h: H, comps, rgba, markers, jfif, issues, coverage };
}

/** 量子化テーブルが 1 つもないときの代わり */
const FLAT_Q = new Uint16Array(64).fill(16);

/** 最近傍で輝度の大きさの座標から成分を読む（壊れた倍率でも割り切れなくてよい） */
function nearestAt(c: DecComp, x: number, y: number, hmax: number, vmax: number): number {
  return c.plane.d[Math.floor((y * c.v) / vmax) * c.plane.w + Math.floor((x * c.h) / hmax)];
}
function grayNearest(c: DecComp, hmax: number, vmax: number, W: number, H: number): Uint8ClampedArray {
  const o = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = nearestAt(c, x, y, hmax, vmax),
        i = (y * W + x) * 4;
      o[i] = o[i + 1] = o[i + 2] = v;
      o[i + 3] = 255;
    }
  return o;
}
function colorNearest(comps: DecComp[], hmax: number, vmax: number, W: number, H: number): Uint8ClampedArray {
  const n = W * H,
    P = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  comps.forEach((c, k) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) P[k][y * W + x] = nearestAt(c, x, y, hmax, vmax);
  });
  return planesToRgba(P[0], P[1], P[2], W, W, H);
}

interface ScanComp {
  c: DecComp;
  dc: DecTab;
  ac: DecTab;
  pred: number;
}

/** 1 成分なら 1 ブロック（画像にかかるブロックだけ）、複数なら MCU を単位に回す。[単位の数, 単位の中のブロックを回す] */
function scanUnits(
  sc: ScanComp[],
  W: number,
  H: number,
  hmax: number,
  vmax: number,
  block: (s: ScanComp, b: number) => void,
): [number, (i: number) => void] {
  if (sc.length === 1) {
    const s = sc[0],
      c = s.c,
      nx = Math.ceil(Math.ceil((W * c.h) / hmax) / 8),
      ny = Math.ceil(Math.ceil((H * c.v) / vmax) / 8);
    return [nx * ny, (i) => block(s, Math.floor(i / nx) * c.bw + (i % nx))];
  }
  const mxN = Math.ceil(W / (8 * hmax)),
    myN = Math.ceil(H / (8 * vmax));
  return [
    mxN * myN,
    (i) => {
      const mx = i % mxN,
        my = Math.floor(i / mxN);
      for (const s of sc)
        for (let v = 0; v < s.c.v; v++)
          for (let h = 0; h < s.c.h; h++) block(s, (my * s.c.v + v) * s.c.bw + mx * s.c.h + h);
    },
  ];
}

/** 次の区切りのマーカー（RST を除く）まで進めた位置 */
function nextMarker(d: Uint8Array, p: number): number {
  let q = p;
  while (q < d.length - 1 && !(d[q] === 0xff && d[q + 1] !== 0 && !(d[q + 1] >= 0xd0 && d[q + 1] <= 0xd7))) q++;
  return q;
}

/** スキャンを終わらせるマーカー。ほかは壊れたデータの中に偶然できたものとして読み飛ばす */
const ENDS_SCAN = new Set([0xd9, 0xda, 0xc4, 0xdb, 0xdd, 0xc0]);

/**
 * 壊れたスキャンを読み切る。読めない符号は 0（libjpeg の jpeg_huff_decode と同じ）、はみ出す係数は捨てる。
 * リスタートの間隔ごとに次の RST まで進めて同期を取り直し、番号が飛んでいたら飛んだ分のブロックを読まずに進む。
 * データが尽きた間隔の残りのブロックは読まない（seen が 0 のまま）
 */
function scanTolerant(
  d: Uint8Array,
  p: number,
  sc: ScanComp[],
  W: number,
  H: number,
  hmax: number,
  vmax: number,
  ri: number,
  bad: (reason: JpegReason, offset: number, msg: string) => void,
): number {
  const r = new BitReader(d, p);
  const block = (s: ScanComp, b: number) => {
    const t = s.c.coef,
      o = b * 64;
    (s.c.seen as Uint8Array)[b] = 1;
    let ds = decodeSym(r, s.dc);
    if (ds < 0) {
      bad('bad-code', r.p, '');
      ds = 0;
    }
    ds &= 15;
    s.pred += extend(r.read(ds), ds);
    t[o] = s.pred;
    for (let k = 1; k < 64; ) {
      const rs = decodeSym(r, s.ac);
      if (rs < 0) {
        bad('bad-code', r.p, '');
        break;
      }
      const run = rs >> 4,
        sz = rs & 15;
      if (!sz) {
        if (run !== 15) break;
        k += 16;
        continue;
      }
      k += run;
      if (k > 63) {
        bad('bad-run', r.p, '');
        r.read(sz);
        break;
      }
      t[o + ZIGZAG[k]] = extend(r.read(sz), sz);
      k++;
    }
  };
  const [n, unit] = scanUnits(sc, W, H, hmax, vmax, block);
  let rst = 0,
    i = 0,
    ended = false;
  while (i < n) {
    if (ri && i > 0 && i % ri === 0) {
      /* 次の RST を探す。スキャンの終わりのマーカーが先なら止める */
      r.align();
      r.marker = -1;
      let q = r.p;
      while (
        q < d.length - 1 &&
        !(d[q] === 0xff && ((d[q + 1] >= 0xd0 && d[q + 1] <= 0xd7) || ENDS_SCAN.has(d[q + 1])))
      )
        q++;
      if (q >= d.length - 1 || !(d[q + 1] >= 0xd0 && d[q + 1] <= 0xd7)) {
        r.p = q;
        ended = true;
        break;
      }
      const got = d[q + 1] & 7,
        lost = (got - rst) & 7;
      r.p = q + 2;
      rst = (got + 1) & 7;
      /* 少し先の番号なら間隔を飛ばす。戻る番号はそのまま読む */
      if (lost && lost < 4) {
        bad('rst-order', q, '');
        i += lost * ri;
        if (i >= n) break;
      }
      for (const s of sc) s.pred = 0;
    }
    /* 偶然できたマーカーは読み飛ばす */
    while (r.marker >= 0 && !ENDS_SCAN.has(r.marker) && !(ri && r.marker >= 0xd0 && r.marker <= 0xd7)) {
      bad('stray-marker', r.p, '');
      r.skipMarker();
    }
    /* ファイルが切れた */
    if (r.p >= d.length && r.marker < 0) {
      ended = true;
      break;
    }
    if (r.marker >= 0) {
      /* データが尽きた: 間隔の残りを読まずに次の間隔へ */
      if (!ri || ENDS_SCAN.has(r.marker)) {
        ended = true;
        break;
      }
      i = (Math.floor(i / ri) + 1) * ri;
      continue;
    }
    unit(i);
    i++;
  }
  if (ended && i < n) bad('short-scan', r.p, '');
  return nextMarker(d, r.p);
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
): number {
  const r = new BitReader(d, p);
  const need = (v: number): number => {
    if (v < 0) throw new Error('ハフマン符号を読めません');
    return v;
  };
  const block = (s: ScanComp, b: number) => {
    const t = s.c.coef,
      o = b * 64,
      ds = need(decodeSym(r, s.dc));
    s.pred += extend(r.read(ds), ds);
    t[o] = s.pred;
    for (let k = 1; k < 64; ) {
      const rs = need(decodeSym(r, s.ac)),
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
  const [n, unit] = scanUnits(sc, W, H, hmax, vmax, block);
  for (let i = 0; i < n; i++) {
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
    unit(i);
  }
  return nextMarker(d, r.p);
}

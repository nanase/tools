/**
 * ベースラインの JPEG 符号器（T.81 の順次 DCT・ハフマン符号、8 ビット、3 成分を 1 つのスキャンに混ぜる）。
 * ファイルは JFIF 1.02（APP0）。色の変換・間引き・DCT・量子化・記号化・ハフマン符号の途中の値も返す
 */
import { BitWriter, ByteWriter } from './bits';
import { downsample, type Plane, SAMPLING, type Sub, toYccPlanes } from './color';
import { fdct, quantize } from './dct';
import { scanBlock } from './entropy';
import { buildCodes, type HuffCode, optimalSpec } from './huffman';
import { AC_CHR, AC_LUM, DC_CHR, DC_LUM, type HuffSpec, type QTab, quantTables, ZIGZAG } from './tables';

export type Huff = 'std' | 'opt';

export interface EncOpts {
  /** IJG の品質 1〜100 */
  q: number;
  sub: Sub;
  qt: QTab;
  huff: Huff;
}

/** 1 つの成分の途中の値と、符号の量 */
export interface CompOut {
  /** 成分の番号（1: Y、2: Cb、3: Cr） */
  id: number;
  /** 標本化の倍率 */
  h: number;
  v: number;
  /** 量子化テーブル・ハフマン表の番号（0: 輝度、1: 色差） */
  t: 0 | 1;
  /** ブロックの数（横・縦） */
  bw: number;
  bh: number;
  /** 標本（MCU の倍数まで広げたもの） */
  plane: Plane;
  /** 量子化した係数（ブロック (bx, by) は (by·bw + bx)·64 から、自然順） */
  coef: Int16Array;
  /** ブロックごとのビット数（ハフマン符号と付加ビット） */
  bits: Uint32Array;
  dcBits: number;
  acBits: number;
  /** AC のうち EOB と ZRL の符号 */
  eobBits: number;
  zrlBits: number;
  /** 0 になった係数の数 */
  zeros: number;
}

/** ファイルの区切り（マーカーごと） */
export interface Seg {
  name: string;
  off: number;
  len: number;
}

export interface Encoded {
  w: number;
  h: number;
  opts: EncOpts;
  /** 輝度の標本化の倍率（MCU は 8·hmax × 8·vmax 画素） */
  hmax: number;
  vmax: number;
  /** MCU の数（横・縦） */
  mx: number;
  my: number;
  comps: CompOut[];
  /** 量子化テーブル [輝度, 色差]（自然順） */
  qt: [Uint8Array, Uint8Array];
  /** ハフマン表 [輝度, 色差] */
  dc: [HuffSpec, HuffSpec];
  ac: [HuffSpec, HuffSpec];
  bytes: Uint8Array;
  segs: Seg[];
  /** 符号化したデータのバイト数（挟んだ 0x00 を含む） */
  ecs: number;
  stuffed: number;
  /** 最後のバイトを埋めたビット数 */
  pad: number;
  /** 8×8 画素ごとのビット数（Y のブロックの格子、色差は MCU の中の Y のブロックに等分） */
  map: Float32Array;
}

/** 成分の面を DCT・量子化する */
function transform(p: Plane, Q: ArrayLike<number>): Int16Array {
  const bw = p.w / 8,
    bh = p.h / 8,
    c = new Int16Array(bw * bh * 64),
    f = new Float64Array(64),
    F = new Float64Array(64),
    S = new Int16Array(64);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) f[y * 8 + x] = p.d[(by * 8 + y) * p.w + bx * 8 + x] - 128;
      fdct(f, F);
      quantize(F, Q, S);
      c.set(S, (by * bw + bx) * 64);
    }
  return c;
}

/** 走査の順（MCU の順、MCU の中は成分ごとに左上から）でブロックを回る。fn(成分, ブロックの番号) */
export function forEachBlock(
  e: Pick<Encoded, 'mx' | 'my'> & { comps: readonly Pick<CompOut, 'h' | 'v' | 'bw'>[] },
  fn: (ci: number, b: number) => void,
): void {
  for (let my = 0; my < e.my; my++)
    for (let mx = 0; mx < e.mx; mx++)
      e.comps.forEach((c, ci) => {
        for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) fn(ci, (my * c.v + v) * c.bw + mx * c.h + h);
      });
}

/**
 * 走査の順で 1 つ前の同じ成分のブロック（DC の予測に使う）。先頭のブロックなら -1
 */
export function prevBlock(c: Pick<CompOut, 'h' | 'v' | 'bw'>, mxN: number, bx: number, by: number): number {
  const mx = Math.floor(bx / c.h),
    my = Math.floor(by / c.v),
    i = (by % c.v) * c.h + (bx % c.h);
  if (i > 0) {
    const j = i - 1;
    return (my * c.v + Math.floor(j / c.h)) * c.bw + mx * c.h + (j % c.h);
  }
  const m = my * mxN + mx - 1;
  if (m < 0) return -1;
  const pmx = m % mxN,
    pmy = Math.floor(m / mxN);
  return (pmy * c.v + c.v - 1) * c.bw + pmx * c.h + c.h - 1;
}

const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];

export function encode(rgba: ArrayLike<number>, w: number, h: number, opts: EncOpts): Encoded {
  const [hmax, vmax] = SAMPLING[opts.sub],
    mx = Math.ceil(w / (8 * hmax)),
    my = Math.ceil(h / (8 * vmax)),
    pw = mx * 8 * hmax,
    ph = my * 8 * vmax;
  const qt = quantTables(opts.q, opts.qt);
  const [Y, Cb, Cr] = toYccPlanes(rgba, w, h, pw, ph);
  const planes = [Y, downsample(Cb, hmax, vmax), downsample(Cr, hmax, vmax)];
  const comps: CompOut[] = planes.map((p, i) => {
    const t = i === 0 ? 0 : 1,
      coef = transform(p, qt[t]);
    let zeros = 0;
    for (const x of coef) if (x === 0) zeros++;
    return {
      id: i + 1,
      h: i === 0 ? hmax : 1,
      v: i === 0 ? vmax : 1,
      t,
      bw: p.w / 8,
      bh: p.h / 8,
      plane: p,
      coef,
      bits: new Uint32Array((p.w / 8) * (p.h / 8)),
      dcBits: 0,
      acBits: 0,
      eobBits: 0,
      zrlBits: 0,
      zeros,
    };
  });
  const geo = { mx, my, comps };

  /* ハフマン表: 標準（K.3〜K.6）か、記号の出現回数から作る */
  let dc: [HuffSpec, HuffSpec] = [DC_LUM, DC_CHR],
    ac: [HuffSpec, HuffSpec] = [AC_LUM, AC_CHR];
  if (opts.huff === 'opt') {
    const fd = [new Uint32Array(256), new Uint32Array(256)],
      fa = [new Uint32Array(256), new Uint32Array(256)],
      pred = [0, 0, 0];
    forEachBlock(geo, (ci, b) => {
      const c = comps[ci];
      scanBlock(c.coef, b * 64, pred[ci], (isDc, sym) => {
        (isDc ? fd : fa)[c.t][sym]++;
      });
      pred[ci] = c.coef[b * 64];
    });
    dc = [optimalSpec(fd[0]), optimalSpec(fd[1])];
    ac = [optimalSpec(fa[0]), optimalSpec(fa[1])];
  }
  const dcC: HuffCode[] = dc.map(buildCodes),
    acC: HuffCode[] = ac.map(buildCodes);

  /* ヘッダ */
  const out = new ByteWriter(),
    segs: Seg[] = [];
  const seg = (name: string, body: () => void) => {
    const off = out.n;
    body();
    segs.push({ name, off, len: out.n - off });
  };
  seg('SOI', () => out.word(0xffd8));
  seg('APP0', () => {
    out.word(0xffe0);
    out.word(2 + JFIF.length);
    out.bytes(JFIF);
  });
  seg('DQT', () => {
    out.word(0xffdb);
    out.word(2 + 65 * 2);
    qt.forEach((t, i) => {
      out.byte(i);
      for (let k = 0; k < 64; k++) out.byte(t[ZIGZAG[k]]);
    });
  });
  seg('SOF0', () => {
    out.word(0xffc0);
    out.word(8 + 3 * comps.length);
    out.byte(8);
    out.word(h);
    out.word(w);
    out.byte(comps.length);
    for (const c of comps) {
      out.byte(c.id);
      out.byte((c.h << 4) | c.v);
      out.byte(c.t);
    }
  });
  seg('DHT', () => {
    const tabs: [number, HuffSpec][] = [
      [0x00, dc[0]],
      [0x10, ac[0]],
      [0x01, dc[1]],
      [0x11, ac[1]],
    ];
    out.word(0xffc4);
    out.word(2 + tabs.reduce((s, [, t]) => s + 17 + t.vals.length, 0));
    for (const [id, t] of tabs) {
      out.byte(id);
      out.bytes(t.bits);
      out.bytes(t.vals);
    }
  });
  seg('SOS', () => {
    out.word(0xffda);
    out.word(6 + 2 * comps.length);
    out.byte(comps.length);
    for (const c of comps) {
      out.byte(c.id);
      out.byte((c.t << 4) | c.t);
    }
    out.byte(0);
    out.byte(63);
    out.byte(0);
  });

  /* 符号化したデータ */
  const bw = new BitWriter(out),
    pred = [0, 0, 0],
    ecs0 = out.n;
  forEachBlock(geo, (ci, b) => {
    const c = comps[ci],
      D = dcC[c.t],
      A = acC[c.t];
    let n = 0;
    scanBlock(c.coef, b * 64, pred[ci], (isDc, sym, amp, size) => {
      const T = isDc ? D : A,
        l = T.len[sym];
      bw.put(T.code[sym], l);
      bw.put(amp, size);
      n += l + size;
      if (isDc) c.dcBits += l + size;
      else {
        c.acBits += l + size;
        if (sym === 0) c.eobBits += l;
        else if (sym === 0xf0) c.zrlBits += l;
      }
    });
    c.bits[b] = n;
    pred[ci] = c.coef[b * 64];
  });
  const pad = bw.finish();
  const ecs = out.n - ecs0;
  segs.push({ name: 'ECS', off: ecs0, len: ecs });
  seg('EOI', () => out.word(0xffd9));

  /* 8×8 画素ごとのビット数 */
  const [cy, cb, cr] = comps,
    map = new Float32Array(cy.bw * cy.bh);
  for (let by = 0; by < cy.bh; by++)
    for (let bx = 0; bx < cy.bw; bx++) {
      const k = Math.floor(by / vmax) * cb.bw + Math.floor(bx / hmax);
      map[by * cy.bw + bx] = cy.bits[by * cy.bw + bx] + (cb.bits[k] + cr.bits[k]) / (hmax * vmax);
    }

  return {
    w,
    h,
    opts,
    hmax,
    vmax,
    mx,
    my,
    comps,
    qt,
    dc,
    ac,
    bytes: out.out(),
    segs,
    ecs,
    stuffed: bw.stuffed,
    pad,
    map,
  };
}

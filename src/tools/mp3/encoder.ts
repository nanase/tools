/**
 * MP3（MPEG-1 Layer III・44.1 kHz・固定ビットレート）のエンコーダ（DOM に依存しない）。
 * 図のために、帯域ごとのビットとビットリザーバの様子、1 グラニュールの途中経過を返す
 */
import { lowpass, mdctGranule, polyphase, type Subbands } from './filterbank';
import { BitWriter, type HuffInfo, huffInfo, lineBits, MAX_IX, writeHuffman } from './huffman';
import { analyze, type PsyOut, type PsyPrev, psyTable } from './psy';

export const FS = 44100;
export const BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
/** sfb の境界（44.1 kHz、ISO/IEC 11172-3） */
export const SFB_L = [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576];
const SFB_S = [0, 4, 8, 12, 16, 22, 30, 40, 52, 66, 84, 106, 136, 192];
/** scalefac_compress ごとの slen1・slen2 */
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
/** ビットリザーバの上限（main_data_begin は 9 ビット）[バイト] */
const RES_MAX = 511;
/** 量子化の丸めのずれ（ISO/IEC 11172-3 の 0.0946 を 0.5 から引いた値） */
const ROUND = 0.4054;
/** 外側のループの上限 */
const MAX_ITER = 14;

const P43 = Float64Array.from({ length: MAX_IX + 4 }, (_, i) => i ** (4 / 3));
const LINE_SFB = new Uint8Array(577);
for (let s = 0; s < 22; s++) for (let i = SFB_L[s]; i < SFB_L[s + 1]; i++) LINE_SFB[i] = s;

export interface EncodeOptions {
  kbps: number;
  /** ローパス [Hz]。0 ならかけない */
  lowpass?: number;
  /** 途中経過を見るフレーム（これ以降の最初の長いブロック）。省略すると取らない */
  capture?: number;
  onProgress?: (p: number) => void;
}

/** 1 グラニュールの途中経過（図のため） */
export interface Capture {
  /** MDCT の値（短いブロックは並べ替えの後） */
  xr: Float64Array;
  ix: Int32Array;
  xmin: Float64Array;
  /** 帯の境界の線番号 */
  lo: Int32Array;
  sf: Int32Array;
  gg: number;
  type: number;
  bits: number;
  tables: number[];
  e0: number;
  c1: number;
  end: number;
  lb: Float32Array;
  fr: number;
  frameBytes: number;
}

export interface Stats {
  /** グラニュールごとのブロックの型 */
  types: Uint8Array;
  /** フレームごとの main_data_begin [バイト] */
  res: Int32Array;
  /** フレームごとの中身のバイト数 */
  frameMain: Int32Array;
  /** sfb ごとのハフマン符号のビットの合計 */
  bandBits: Float64Array;
  sfBits: number;
  mainBits: number;
  sideBits: number;
  totalBits: number;
  capture: Capture | null;
}
export interface Encoded {
  bytes: Uint8Array;
  stats: Stats;
}

/** 短いブロックの帯（sfb × 3 窓）と長いブロックの帯 */
interface Bands {
  n: number;
  lo: Int32Array;
  win: Int32Array;
  sfb: Int32Array;
}
const BANDS_L: Bands = {
  n: 22,
  lo: Int32Array.from(SFB_L),
  win: new Int32Array(22),
  sfb: Int32Array.from({ length: 22 }, (_, i) => i),
};
const BANDS_S: Bands = (() => {
  const lo = new Int32Array(40),
    win = new Int32Array(39),
    sfb = new Int32Array(39);
  let p = 0;
  for (let s = 0; s < 13; s++)
    for (let w = 0; w < 3; w++) {
      const b = s * 3 + w;
      lo[b] = p;
      win[b] = w;
      sfb[b] = s;
      p += SFB_S[s + 1] - SFB_S[s];
    }
  lo[39] = p;
  return { n: 39, lo, win, sfb };
})();

/** 短いブロックの値を sfb・窓・周波数の順に並べ替える */
function reorderShort(xr: Float64Array, tmp: Float64Array): void {
  tmp.set(xr);
  let p = 0;
  for (let s = 0; s < 13; s++)
    for (let w = 0; w < 3; w++)
      for (let f = SFB_S[s]; f < SFB_S[s + 1]; f++) {
        const sb = Math.floor(f / 6);
        xr[p++] = tmp[sb * 18 + 3 * (f - sb * 6) + w];
      }
}

/** サブバンドのエネルギーの急増を探し、ブロックの型の列を決める */
function blockTypes(subs: Subbands[], nGr: number): Uint8Array {
  const bts = new Uint8Array(nGr + 1);
  for (const { sub, T } of subs) {
    let prevE = 0;
    for (let g = 0; g < nGr; g++)
      for (let w = 0; w < 3; w++) {
        let e = 1e-9;
        for (let t = 0; t < 6; t++) {
          const tt = g * 18 + w * 6 + t;
          if (tt >= T) break;
          for (let sb = 2; sb < 32; sb++) e += sub[tt * 32 + sb] ** 2;
        }
        if (e > prevE * 8 && e > 1e-5) bts[g] = 2;
        prevE = 0.5 * prevE + 0.5 * e;
      }
  }
  for (let g = 0; g < nGr; g++) {
    if (bts[g] === 2) continue;
    const nx = g + 1 < nGr && bts[g + 1] === 2,
      pv = g > 0 && bts[g - 1] === 2;
    if (nx && pv) bts[g] = 2;
    else if (nx) bts[g] = 1;
    else if (pv) bts[g] = 3;
  }
  return bts;
}

interface Quantized {
  gg: number;
  ix: Int32Array;
  sf: Int32Array;
  comp: number;
  info: HuffInfo;
  over: number;
  score: number;
}

const part2Bits = (comp: number, short: boolean) =>
  short ? 18 * (SLEN[comp][0] + SLEN[comp][1]) : 11 * SLEN[comp][0] + 10 * SLEN[comp][1];

/**
 * 量子化の二重のループ: 内側で global_gain を目標のビットに合わせ、外側で閾値を超えた帯のスケールファクタを上げる。
 * 閾値を超えた量が最も小さかった回の結果を返す
 */
function quantizeLoop(xr: Float64Array, xmin: Float64Array, bands: Bands, type: number, target: number): Quantized {
  const short = type === 2,
    { n, lo } = bands,
    real = n - (short ? 3 : 1),
    xr34 = new Float64Array(576),
    gain = new Float64Array(576),
    ix = new Int32Array(576),
    sf = new Int32Array(n);
  for (let i = 0; i < 576; i++) {
    const a = Math.abs(xr[i]);
    xr34[i] = Math.sqrt(a * Math.sqrt(a));
  }
  const lowPart = (b: number) => (short ? bands.sfb[b] <= 5 : b <= 10),
    maxSf = (b: number) => (lowPart(b) ? 15 : 7);
  const chooseComp = () => {
    let m1 = 0,
      m2 = 0;
    for (let b = 0; b < real; b++) {
      if (lowPart(b)) m1 = Math.max(m1, sf[b]);
      else m2 = Math.max(m2, sf[b]);
    }
    let best = -1,
      bits = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 16; k++) {
      if (2 ** SLEN[k][0] - 1 < m1 || 2 ** SLEN[k][1] - 1 < m2) continue;
      const c = part2Bits(k, short);
      if (c < bits) {
        bits = c;
        best = k;
      }
    }
    return best;
  };
  const quantize = (gg: number) => {
    const base = 2 ** (((210 - gg) * 3) / 16);
    for (let b = 0; b < n; b++) {
      const g = base * 2 ** (0.375 * sf[b]);
      for (let i = lo[b]; i < lo[b + 1]; i++) gain[i] = g;
    }
    let mx = 0;
    for (let i = 0; i < 576; i++) {
      const v = Math.floor(xr34[i] * gain[i] + ROUND);
      ix[i] = v;
      if (v > mx) mx = v;
    }
    return mx;
  };

  let best: Quantized | null = null,
    last = 210;
  for (let it = 0; it < MAX_ITER; it++) {
    const comp = chooseComp();
    if (comp < 0) break;
    const p2 = part2Bits(comp, short);
    let found = -1,
      info: HuffInfo | null = null;
    const search = (a: number, b: number) => {
      let l = a,
        h = b;
      while (l <= h) {
        const mid = (l + h) >> 1,
          inf = quantize(mid) <= MAX_IX ? huffInfo(ix, SFB_L, type) : null;
        if (inf && inf.bits + p2 <= target) {
          found = mid;
          info = inf;
          h = mid - 1;
        } else l = mid + 1;
      }
    };
    if (it === 0) search(0, 255);
    else {
      /* スケールファクタを上げるとビットは増えるので、前の値より上だけを探す */
      search(last, Math.min(255, last + 15));
      if (found < 0 && last + 16 <= 255) search(last + 16, 255);
    }
    if (found < 0) {
      /* 最も粗くしても入らなければ、この回は 0 にする */
      found = 255;
      ix.fill(0);
      info = huffInfo(ix, SFB_L, type);
    } else quantize(found);
    last = found;
    const stepG = 2 ** ((found - 210) / 4),
      dist = new Float64Array(n);
    let over = 0,
      sum = 0,
      mxD = 0;
    for (let b = 0; b < n; b++) {
      const s = stepG * 2 ** (-0.5 * sf[b]);
      let e = 0;
      for (let i = lo[b]; i < lo[b + 1]; i++) {
        const d = Math.abs(xr[i]) - P43[ix[i]] * s;
        e += d * d;
      }
      const q = e / xmin[b];
      dist[b] = q;
      if (q > 1) {
        over++;
        sum += 10 * Math.log10(q);
      }
      if (q > mxD) mxD = q;
    }
    if (info && (!best || sum < best.score))
      best = { gg: found, ix: ix.slice(), sf: sf.slice(), comp, info, over, score: sum };
    if (over === 0) break;
    const thr = Math.max(1, Math.sqrt(mxD));
    let amp = 0,
      all = true;
    for (let b = 0; b < real; b++)
      if ((dist[b] > thr || (dist[b] > 1 && mxD < 1.5)) && sf[b] < maxSf(b)) {
        sf[b]++;
        amp++;
      }
    for (let b = 0; b < real; b++)
      if (sf[b] === 0) {
        all = false;
        break;
      }
    if (!amp || all) break;
  }
  if (best) return best;
  ix.fill(0);
  const info = huffInfo(ix, SFB_L, type);
  if (!info) throw new Error('huffInfo');
  return { gg: 210, ix, sf, comp: 0, info, over: 0, score: 0 };
}

/** チャンネルの音（±1、44.1 kHz、1 または 2 チャンネル）を MP3 にする */
export function encode(chans: readonly Float32Array[], o: EncodeOptions): Encoded {
  const nch = chans.length,
    brIdx = BITRATES.indexOf(o.kbps as (typeof BITRATES)[number]) + 1;
  if (brIdx <= 0) throw new Error(`使えないビットレート: ${o.kbps}`);
  const src = chans.map((c) => lowpass(c, FS, o.lowpass ?? 0)),
    L = src[0].length,
    subs = src.map(polyphase),
    nGr = Math.ceil((L + 1152) / 576),
    nFr = Math.ceil(nGr / 2),
    bts = blockTypes(subs, nGr);

  /* 心理モデルは M/S でも見るので、和と差の音を作っておく */
  const views: Float32Array[] = [...src];
  if (nch === 2) {
    const m = new Float32Array(L),
      s = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      m[i] = (src[0][i] + src[1][i]) / Math.SQRT2;
      s[i] = (src[0][i] - src[1][i]) / Math.SQRT2;
    }
    views.push(m, s);
  }
  const tabL = psyTable(1024, FS, SFB_L),
    tabS = psyTable(256, FS, SFB_S),
    prev: (PsyPrev | null)[] = [null, null, null, null],
    prevGr = [-9, -9, -9, -9];

  const frameF = (144 * o.kbps * 1000) / FS,
    sideBytes = nch === 1 ? 17 : 32,
    mainBuf = new Uint8Array(Math.ceil(frameF * nFr) + 8192),
    heads: { head: Uint8Array; slots: number; pos: number }[] = [],
    res = new Int32Array(nFr),
    frameMain = new Int32Array(nFr),
    bandBits = new Float64Array(22),
    tmp = new Float64Array(576),
    sign = new Uint8Array(576);
  let padAcc = 0,
    pos = 0,
    prevEnd = 0,
    peRun = -1,
    sfBits = 0,
    mainBits = 0,
    capture: Capture | null = null;

  for (let fr = 0; fr < nFr; fr++) {
    padAcc += frameF - Math.floor(frameF);
    const pad = padAcc >= 1 ? 1 : 0;
    padAcc -= pad;
    const frameBytes = Math.floor(frameF) + pad,
      slots = frameBytes - 4 - sideBytes,
      start = Math.max(prevEnd, pos - RES_MAX),
      reservoir = (pos - start) * 8,
      main = new BitWriter(16384);

    /* MDCT と、M/S にするかの判定（フレームの単位） */
    const xrs: Float64Array[][] = [];
    let eM = 0,
      eS = 0;
    for (let gi = 0; gi < 2; gi++) {
      const g = fr * 2 + gi;
      xrs[gi] = subs.map((s) => {
        const xr = new Float64Array(576);
        mdctGranule(s, g, bts[g], xr);
        return xr;
      });
      if (nch === 2)
        for (let i = 0; i < 576; i++) {
          const a = xrs[gi][0][i],
            b = xrs[gi][1][i];
          eM += (a + b) ** 2;
          eS += (a - b) ** 2;
        }
    }
    const ms = nch === 2 && eS < 0.3 * eM;
    if (ms)
      for (const [a, b] of xrs)
        for (let i = 0; i < 576; i++) {
          const m = (a[i] + b[i]) / Math.SQRT2;
          b[i] = (a[i] - b[i]) / Math.SQRT2;
          a[i] = m;
        }

    /* 心理モデルと必要なビットの見積もり（知覚エントロピー） */
    const psy: { lng: PsyOut; sh: PsyOut[] | null }[][] = [],
      pes: number[][] = [];
    let peSum = 0;
    for (let gi = 0; gi < 2; gi++) {
      const g = fr * 2 + gi,
        center = 576 * g - 240;
      psy[gi] = [];
      pes[gi] = [];
      for (let c = 0; c < nch; c++) {
        const key = c + (ms ? 2 : 0),
          x = views[key],
          pv = prevGr[key] === g - 1 ? prev[key] : null,
          lng = analyze(tabL, x, center, pv);
        prev[key] = {
          r1: lng.r,
          p1: lng.ph,
          r2: pv ? pv.r1 : new Float64Array(lng.r.length),
          p2: pv ? pv.p1 : new Float64Array(lng.r.length),
        };
        prevGr[key] = g;
        const sh = bts[g] === 2 ? [0, 1, 2].map((w) => analyze(tabS, x, center + (w - 1) * 192, null)) : null;
        psy[gi][c] = { lng, sh };
        let pe = 0;
        if (sh) {
          for (const s of sh)
            for (let k = 0; k < 13; k++)
              if (s.ratio[k] < 1) pe += (SFB_S[k + 1] - SFB_S[k]) * 0.5 * Math.log2(1 / s.ratio[k]);
        } else {
          for (let k = 0; k < 22; k++)
            if (lng.ratio[k] < 1) pe += (SFB_L[k + 1] - SFB_L[k]) * 0.5 * Math.log2(1 / lng.ratio[k]);
        }
        pes[gi][c] = pe;
        peSum += pe;
      }
    }

    /* このフレームの予算: いつもの所では少し残して貯め、必要な量が急に増えた所で使う */
    peRun = peRun < 0 ? peSum : 0.92 * peRun + 0.08 * peSum;
    const peRatio = peSum / Math.max(1, peRun),
      full = reservoir / (RES_MAX * 8);
    let plan = slots * 8;
    if (peRatio < 1.15 && full < 0.9) plan -= slots * 8 * 0.1;
    plan += reservoir * Math.max(0, Math.min(0.85, (peRatio - 1.1) / 0.5));
    if (full > 0.9) plan += reservoir - 0.9 * RES_MAX * 8;
    let remain = Math.min((pos + slots - start) * 8, plan),
      peLeft = Math.max(1, peSum);

    const side: { len: number; bv: number; gg: number; comp: number; type: number; info: HuffInfo }[][] = [[], []];
    for (let gi = 0; gi < 2; gi++) {
      const g = fr * 2 + gi,
        type = bts[g],
        short = type === 2,
        bands = short ? BANDS_S : BANDS_L;
      for (let c = 0; c < nch; c++) {
        const xr = xrs[gi][c],
          share = 2 * nch - (gi * nch + c),
          flat = remain / share,
          pe = Math.max(pes[gi][c], 1),
          weighted = peSum > 0 ? remain * (pe / peLeft) : flat,
          target = Math.min(Math.floor(0.5 * flat + 0.5 * weighted), 4095, remain);
        peLeft = Math.max(1, peLeft - pe);
        if (short) reorderShort(xr, tmp);
        for (let i = 0; i < 576; i++) sign[i] = xr[i] < 0 ? 1 : 0;

        /* 閾値（線のエネルギー × FFT で求めた比） */
        const xmin = new Float64Array(bands.n),
          p = psy[gi][c];
        for (let b = 0; b < bands.n; b++) {
          let e = 0;
          for (let i = bands.lo[b]; i < bands.lo[b + 1]; i++) e += xr[i] * xr[i];
          const rt = short && p.sh ? p.sh[bands.win[b]].ratio[bands.sfb[b]] : p.lng.ratio[b];
          xmin[b] = Math.max(e * rt, 1e-14);
        }

        const q = quantizeLoop(xr, xmin, bands, type, target),
          before = main.n,
          [s1, s2] = SLEN[q.comp];
        if (short) {
          for (let s = 0; s < 12; s++) for (let w = 0; w < 3; w++) main.put(q.sf[s * 3 + w], s <= 5 ? s1 : s2);
        } else for (let b = 0; b < 21; b++) main.put(q.sf[b], b <= 10 ? s1 : s2);
        const p2 = main.n - before;
        writeHuffman(main, q.ix, sign, q.info, type);
        const used = main.n - before;
        if (used !== q.info.bits + p2) throw new Error(`ビット数の不一致: ${used} ${q.info.bits + p2}`);
        remain -= used;
        side[gi][c] = { len: used, bv: q.info.bv, gg: q.gg, comp: q.comp, type, info: q.info };

        /* 図のための記録 */
        const lb = lineBits(q.ix, q.info, type);
        if (short) {
          for (let b = 0; b < bands.n; b++) {
            const s0 = SFB_S[bands.sfb[b]];
            for (let i = bands.lo[b]; i < bands.lo[b + 1]; i++)
              bandBits[LINE_SFB[Math.min(575, (s0 + i - bands.lo[b]) * 3 + 1)]] += lb[i];
          }
        } else for (let i = 0; i < 576; i++) bandBits[LINE_SFB[i]] += lb[i];
        sfBits += p2;
        mainBits += used;
        const cap = o.capture;
        if (cap !== undefined && fr >= cap && gi === 0 && c === 0 && (!capture || (capture.type !== 0 && type === 0)))
          capture = {
            xr: xr.slice(),
            ix: q.ix,
            xmin,
            lo: bands.lo,
            sf: q.sf,
            gg: q.gg,
            type,
            bits: used,
            tables: [...q.info.tables],
            e0: q.info.e0,
            c1: q.info.c1,
            end: q.info.end,
            lb,
            fr,
            frameBytes,
          };
      }
    }

    /* メインデータはバイト境界で終える。前のフレームの余りから続けて入れる */
    const mainBytes = (main.n + 7) >> 3;
    if (start + mainBytes > pos + slots) throw new Error(`フレーム ${fr} があふれた`);
    mainBuf.set(main.b.subarray(0, mainBytes), start);

    /* ヘッダとサイド情報 */
    const h = new BitWriter(64);
    h.put(0x7ff, 11);
    h.put(3, 2); /* MPEG-1 */
    h.put(1, 2); /* Layer III */
    h.put(1, 1); /* CRC なし */
    h.put(brIdx, 4);
    h.put(0, 2); /* 44.1 kHz */
    h.put(pad, 1);
    h.put(0, 1);
    h.put(nch === 1 ? 3 : 1, 2); /* モノラル・ジョイントステレオ */
    h.put(ms ? 2 : 0, 2);
    h.put(0, 1);
    h.put(1, 1);
    h.put(0, 2);
    h.put(pos - start, 9);
    h.put(0, nch === 1 ? 5 : 3);
    for (let c = 0; c < nch; c++) h.put(0, 4); /* scfsi は使わない */
    for (let gi = 0; gi < 2; gi++)
      for (let c = 0; c < nch; c++) {
        const s = side[gi][c];
        h.put(s.len, 12);
        h.put(s.bv, 9);
        h.put(s.gg, 8);
        h.put(s.comp, 4);
        if (s.type !== 0) {
          h.put(1, 1);
          h.put(s.type, 2);
          h.put(0, 1);
          h.put(s.info.tables[0], 5);
          h.put(s.info.tables[1], 5);
          h.put(0, 9); /* subblock_gain は使わない */
        } else {
          h.put(0, 1);
          h.put(s.info.tables[0], 5);
          h.put(s.info.tables[1], 5);
          h.put(s.info.tables[2], 5);
          h.put(s.info.r0, 4);
          h.put(s.info.r1, 3);
        }
        h.put(0, 2); /* preflag・scalefac_scale は使わない */
        h.put(s.info.c1t, 1);
      }
    heads.push({ head: h.b.slice(0, 4 + sideBytes), slots, pos });
    res[fr] = pos - start;
    frameMain[fr] = mainBytes;
    prevEnd = start + mainBytes;
    pos += slots;
    if (fr % 16 === 0) o.onProgress?.((fr + 1) / nFr);
  }

  let total = 0;
  for (const f of heads) total += f.head.length + f.slots;
  const bytes = new Uint8Array(total);
  let w = 0,
    sideBits = 0;
  for (const f of heads) {
    bytes.set(f.head, w);
    w += f.head.length;
    sideBits += f.head.length * 8;
    bytes.set(mainBuf.subarray(f.pos, f.pos + f.slots), w);
    w += f.slots;
  }
  return {
    bytes,
    stats: {
      types: bts.slice(0, nGr),
      res,
      frameMain,
      bandBits,
      sfBits,
      mainBits,
      sideBits,
      totalBits: total * 8,
      capture,
    },
  };
}

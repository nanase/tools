/**
 * GIF の LZW（GIF89a の付録 F）。符号は 12 ビットまでの可変長で、下位ビットから詰める。
 * 復号器は壊れた符号でも例外を投げず、止まった理由と位置を返す（画像の破損のページでも使う）
 */

/** 辞書の上限（12 ビット） */
export const DICT_MAX = 4096;

/** 1 つの符号の記録（配列の組。添字が同じものが同じ符号） */
export interface LzwTrace {
  /** 符号の数（Clear・EOI を含む） */
  n: number;
  code: Uint16Array;
  /** 符号長 [ビット] */
  width: Uint8Array;
  /** データの先頭から数えた、符号の先頭のビット位置 */
  bit: Uint32Array;
  /** 出力の中の位置（画素の番号） */
  start: Uint32Array;
  /** 表す画素の数（Clear・EOI は 0） */
  len: Uint32Array;
  /** この符号のあとで辞書に足した番号（足さなければ −1） */
  added: Int16Array;
}

function newTrace(cap: number): LzwTrace {
  return {
    n: 0,
    code: new Uint16Array(cap),
    width: new Uint8Array(cap),
    bit: new Uint32Array(cap),
    start: new Uint32Array(cap),
    len: new Uint32Array(cap),
    added: new Int16Array(cap),
  };
}

function growTrace(t: LzwTrace): LzwTrace {
  const b = newTrace(t.code.length * 2);
  b.n = t.n;
  b.code.set(t.code);
  b.width.set(t.width);
  b.bit.set(t.bit);
  b.start.set(t.start);
  b.len.set(t.len);
  b.added.set(t.added);
  return b;
}

export interface LzwEncoded {
  /** サブブロックに分ける前のデータ */
  data: Uint8Array;
  /** データの長さ [ビット] */
  bits: number;
  trace: LzwTrace;
  /** Clear の数（先頭の 1 回を含む） */
  clears: number;
  /** 最後に使った符号長の最大 */
  maxWidth: number;
}

/**
 * 符号化。先頭で Clear を出し、辞書が 4096 に達したら Clear を出して作り直す。
 * m は最小符号サイズ（画素の値は 2^m 未満）
 */
export function encodeLzw(idx: Uint8Array, m: number): LzwEncoded {
  const clear = 1 << m,
    eoi = clear + 1,
    n = idx.length,
    /* 符号の数の上限: 画素ごとに 1 つ + Clear（辞書が埋まるたび）+ 先頭の Clear + EOI */
    cap = n + Math.ceil(n / (DICT_MAX - clear - 2)) + 3,
    t = newTrace(cap),
    data = new Uint8Array(((cap * 12) >> 3) + 2),
    dict = new Map<number, number>();
  let next = eoi + 1,
    width = m + 1,
    maxWidth = width,
    bit = 0,
    clears = 0;
  const emit = (code: number, start: number, len: number, added: number): void => {
    const i = t.n++;
    t.code[i] = code;
    t.width[i] = width;
    t.bit[i] = bit;
    t.start[i] = start;
    t.len[i] = len;
    t.added[i] = added;
    for (let k = 0; k < width; k++, bit++) if ((code >> k) & 1) data[bit >> 3] |= 1 << (bit & 7);
    if (width > maxWidth) maxWidth = width;
  };
  emit(clear, 0, 0, -1);
  clears++;
  if (n > 0) {
    let w = idx[0],
      s = 0;
    for (let p = 1; p < n; p++) {
      const k = idx[p],
        key = (w << 8) | k,
        hit = dict.get(key);
      if (hit !== undefined) {
        w = hit;
        continue;
      }
      /* 足す番号は next。符号長の更新は符号を書いたあと（復号器は 1 つ遅れて足すので、ここで揃う） */
      const added = next < DICT_MAX ? next : -1;
      emit(w, s, p - s, added);
      if (added >= 0) {
        dict.set(key, next);
        next++;
        if (next > 1 << width && width < 12) width++;
      }
      if (next >= DICT_MAX) {
        emit(clear, p, 0, -1);
        clears++;
        dict.clear();
        next = eoi + 1;
        width = m + 1;
      }
      w = k;
      s = p;
    }
    emit(w, s, n - s, -1);
  }
  emit(eoi, n, 0, -1);
  return { data: data.subarray(0, (bit + 7) >> 3), bits: bit, trace: t, clears, maxWidth };
}

/** 復号が止まった理由 */
export type LzwStop =
  /** EOI まで読んだ */
  | 'eoi'
  /** データが途中で終わった */
  | 'end'
  /** 辞書にない符号 */
  | 'bad-code'
  /** 期待した画素の数を超えた（超えた分は捨てる） */
  | 'full'
  /** 最小符号サイズが範囲の外 */
  | 'bad-min';

export interface LzwDecoded {
  /** 画素の値。足りない所は 0 */
  out: Uint8Array;
  /** 出力できた画素の数 */
  n: number;
  stop: LzwStop;
  /** 読んだビット数（止まった所） */
  bitPos: number;
  /** 読んだ符号の数 */
  codes: number;
  /** 止まった符号の値（bad-code のとき） */
  badCode: number;
  /** 止まったときの辞書の次の番号 */
  next: number;
  /** KwKwK（辞書にまだない番号が来た）の回数 */
  kwkwk: number;
  /** trace を求めたときだけ */
  trace?: LzwTrace;
}

/** 復号する。want は期待する画素の数。例外は投げない */
export function decodeLzw(data: Uint8Array, m: number, want: number, opts: { trace?: boolean } = {}): LzwDecoded {
  const out = new Uint8Array(want);
  const res: LzwDecoded = { out, n: 0, stop: 'bad-min', bitPos: 0, codes: 0, badCode: -1, next: 0, kwkwk: 0 };
  if (!(m >= 1 && m <= 8)) return res;
  const clear = 1 << m,
    eoi = clear + 1,
    prefix = new Int16Array(DICT_MAX),
    suffix = new Uint8Array(DICT_MAX),
    head = new Uint8Array(DICT_MAX),
    lens = new Uint16Array(DICT_MAX);
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    head[i] = i;
    lens[i] = 1;
  }
  const total = data.length * 8;
  let t = opts.trace ? newTrace(Math.max(16, Math.min(want + 8, 4096))) : null,
    next = eoi + 1,
    width = m + 1,
    bit = 0,
    pos = 0,
    prev = -1,
    stop: LzwStop = 'end';
  const log = (code: number, w: number, b: number, start: number, len: number, added: number): void => {
    if (!t) return;
    if (t.n === t.code.length) t = growTrace(t);
    const i = t.n++;
    t.code[i] = code;
    t.width[i] = w;
    t.bit[i] = b;
    t.start[i] = start;
    t.len[i] = len;
    t.added[i] = added;
  };
  for (;;) {
    if (bit + width > total) {
      stop = 'end';
      break;
    }
    let code = 0;
    const w = width,
      b = bit;
    for (let k = 0; k < w; k++, bit++) if ((data[bit >> 3] >> (bit & 7)) & 1) code |= 1 << k;
    res.codes++;
    if (code === clear) {
      next = eoi + 1;
      width = m + 1;
      prev = -1;
      log(code, w, b, pos, 0, -1);
      continue;
    }
    if (code === eoi) {
      log(code, w, b, pos, 0, -1);
      stop = 'eoi';
      break;
    }
    /* Clear の直後は 1 画素の符号だけ。それ以外は今の次の番号（KwKwK）まで */
    if ((prev < 0 && code >= clear) || (prev >= 0 && code > next)) {
      res.badCode = code;
      stop = 'bad-code';
      break;
    }
    let added = -1;
    if (prev >= 0) {
      const kw = code === next;
      if (kw) res.kwkwk++;
      if (next < DICT_MAX) {
        prefix[next] = prev;
        suffix[next] = kw ? head[prev] : head[code];
        head[next] = head[prev];
        lens[next] = lens[prev] + 1;
        added = next;
        next++;
        if (next === 1 << width && width < 12) width++;
      }
    }
    const len = lens[code];
    log(code, w, b, pos, len, added);
    for (let c = code, q = pos + len - 1; c >= 0; c = prefix[c], q--) if (q < want) out[q] = suffix[c];
    pos += len;
    prev = code;
    if (pos >= want) {
      /* ちょうど埋まったら、続く EOI まで読む。超えたら止める */
      if (pos > want) {
        stop = 'full';
        break;
      }
    }
  }
  res.n = Math.min(pos, want);
  res.stop = stop;
  res.bitPos = bit;
  res.next = next;
  if (t) res.trace = t;
  return res;
}

/**
 * 復号の記録から、符号化から見た記録を作る（符号・符号長・画素は同じ）。
 * 符号化器は符号を出した直後に足し、復号器は次の符号を読んでから足すので、番号は 1 つ前へずれる
 */
export function encView(d: LzwTrace, clear: number): LzwTrace {
  const e = { ...d, added: new Int16Array(d.n) };
  for (let i = 0; i < d.n; i++) e.added[i] = d.code[i] < clear || d.code[i] > clear + 1 ? (d.added[i + 1] ?? -1) : -1;
  if (d.n) e.added[d.n - 1] = -1;
  return e;
}

/** 辞書の 1 項目 */
export interface DictEntry {
  /** 番号 */
  code: number;
  /** 前の項目の番号 */
  prefix: number;
  /** 終わりの画素の値 */
  suffix: number;
}

/**
 * step 番目の符号の時点の辞書（直前の Clear からの分だけ）。order は符号の順の画素、dir は記録の向き。
 * 符号化は「いまの列 + 次の画素」、復号は「前の列 + いまの列の先頭」を足す
 */
export function dictAt(tr: LzwTrace, order: Uint8Array, m: number, step: number, dir: 'e' | 'd' = 'e'): DictEntry[] {
  const clear = 1 << m;
  let s = Math.min(step, tr.n - 1);
  while (s > 0 && tr.code[s] !== clear) s--;
  const out: DictEntry[] = [];
  for (let i = s; i <= step && i < tr.n; i++) {
    const a = tr.added[i];
    if (a < 0) continue;
    if (dir === 'e') out.push({ code: a, prefix: tr.code[i], suffix: order[tr.start[i] + tr.len[i]] });
    else out.push({ code: a, prefix: tr.code[i - 1], suffix: order[tr.start[i]] });
  }
  return out;
}

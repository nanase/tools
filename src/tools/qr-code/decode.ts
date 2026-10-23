/**
 * QR コードの復号（モジュールの格子 → 文字列）: 形式情報を読む → マスクを外す → ジグザグに符号語を集める
 * → ブロックに戻す → ブロックごとにリード・ソロモン符号で直す → モードと文字数に従ってビット列を読む。
 * 画像から格子を読み取る処理（ファインダーを探す・傾きを直す）はしない。格子の大きさからバージョンを決める
 */
import { ALNUM, ccBits, MODE_IND, type Mode, type Src, sjisChar, srcOrder } from './encode';
import { type RsResult, rsDecode } from './rs';
import { blocks, ECCS, type Ecc, formatBits, formatCells, frame, MASKS, Role, versionBits, versionCells } from './spec';

const pop = (v: number): number => {
  let c = 0;
  for (; v; v &= v - 1) c++;
  return c;
};

export interface InfoRead {
  /** 2 か所で読んだビット */
  got: [number, number];
  /** 最も近い正しい符号との距離（2 か所） */
  dist: [number, number];
  /** 最も近い正しい符号 */
  code: number;
  /** 距離が 3 以下で決まった */
  ok: boolean;
}

function readCells(m: Uint8Array, n: number, cells: [number, number][]): number {
  let v = 0;
  cells.forEach(([x, y], i) => {
    v |= m[y * n + x] << i;
  });
  return v;
}

/** 形式情報を読み、32 通りの正しい符号のうち最も近いものに決める */
export function readFormat(m: Uint8Array, n: number): InfoRead & { ecc: Ecc; mask: number } {
  const [a, b] = formatCells(n),
    got: [number, number] = [readCells(m, n, a), readCells(m, n, b)];
  let best = { d: 99, ecc: 'M' as Ecc, mask: 0, code: 0 };
  for (const ecc of ECCS)
    for (let mask = 0; mask < 8; mask++) {
      const code = formatBits(ecc, mask),
        d = Math.min(pop(code ^ got[0]), pop(code ^ got[1]));
      if (d < best.d) best = { d, ecc, mask, code };
    }
  const dist: [number, number] = [pop(best.code ^ got[0]), pop(best.code ^ got[1])];
  return { got, dist, code: best.code, ok: best.d <= 3, ecc: best.ecc, mask: best.mask };
}

/** バージョン情報を読む（バージョン 7 以上）。34 通りの正しい符号のうち最も近いもの */
export function readVersion(m: Uint8Array, n: number): InfoRead & { ver: number } {
  const [a, b] = versionCells(n),
    got: [number, number] = [readCells(m, n, a), readCells(m, n, b)];
  let best = { d: 99, ver: 7, code: 0 };
  for (let ver = 7; ver <= 40; ver++) {
    const code = versionBits(ver),
      d = Math.min(pop(code ^ got[0]), pop(code ^ got[1]));
    if (d < best.d) best = { d, ver, code };
  }
  const dist: [number, number] = [pop(best.code ^ got[0]), pop(best.code ^ got[1])];
  return { got, dist, code: best.code, ok: best.d <= 3, ver: best.ver };
}

/* ---------- ビット列を読む ---------- */
export interface ReadChar {
  /** 文字（読めない値は U+FFFD） */
  s: string;
  /** データのビット列の中の範囲 */
  from: number;
  to: number;
}
export interface Parsed {
  mode: Mode | null;
  chars: ReadChar[];
  text: string;
  /** 読めなかった理由（なければ空） */
  err: string;
}

/** データの符号語のビット列を、モードと文字数に従って読む（最初のモードの 1 区切りだけでなく、続く区切りも読む） */
export function parse(data: readonly number[], ver: number): Parsed {
  const total = data.length * 8;
  let p = 0;
  const bit = (i: number) => (data[i >> 3] >>> (7 - (i & 7))) & 1;
  const take = (len: number) => {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 1) | bit(p++);
    return v;
  };
  const chars: ReadChar[] = [];
  let mode: Mode | null = null,
    err = '';
  while (p + 4 <= total) {
    const ind = take(4);
    if (ind === 0) break;
    const m = (Object.keys(MODE_IND) as Mode[]).find((k) => MODE_IND[k] === ind);
    if (!m) {
      err = `モードの指示子 ${ind.toString(2).padStart(4, '0')} を読めません`;
      break;
    }
    mode ??= m;
    const cb = ccBits(m, ver);
    if (p + cb > total) {
      err = '文字数の欄の途中で終わりました';
      break;
    }
    const count = take(cb);
    if (m === 'num') {
      for (let left = count; left > 0; ) {
        const k = Math.min(3, left),
          len = [0, 4, 7, 10][k];
        if (p + len > total)
          return { mode, chars, text: chars.map((c) => c.s).join(''), err: '容量より長い文字数です' };
        const from = p,
          s = String(take(len)).padStart(k, '0');
        for (const ch of s.slice(-k)) chars.push({ s: ch, from, to: p });
        left -= k;
      }
    } else if (m === 'alnum') {
      for (let left = count; left > 0; ) {
        const len = left >= 2 ? 11 : 6;
        if (p + len > total)
          return { mode, chars, text: chars.map((c) => c.s).join(''), err: '容量より長い文字数です' };
        const from = p,
          v = take(len),
          s = left >= 2 ? (ALNUM[Math.floor(v / 45)] ?? '�') + (ALNUM[v % 45] ?? '�') : (ALNUM[v] ?? '�');
        for (const ch of s) chars.push({ s: ch, from, to: p });
        left -= s.length;
      }
    } else if (m === 'kanji') {
      for (let i = 0; i < count; i++) {
        if (p + 13 > total) return { mode, chars, text: chars.map((c) => c.s).join(''), err: '容量より長い文字数です' };
        const from = p,
          v = take(13),
          t = Math.floor(v / 0xc0) * 256 + (v % 0xc0),
          code = t + (t < 0x1f00 ? 0x8140 : 0xc140);
        chars.push({ s: sjisChar(code), from, to: p });
      }
    } else {
      /* バイト: UTF-8 として、文字の切れ目ごとに戻す。壊れた並びは U+FFFD */
      const bytes: { v: number; from: number; to: number }[] = [];
      for (let i = 0; i < count; i++) {
        if (p + 8 > total) {
          err = '容量より長い文字数です';
          break;
        }
        const from = p;
        bytes.push({ v: take(8), from, to: p });
      }
      chars.push(...utf8Chars(bytes));
      if (err) break;
    }
  }
  return { mode, chars, text: chars.map((c) => c.s).join(''), err };
}

/** バイトの並びを UTF-8 の文字に分ける（文字ごとにビットの範囲を持つ） */
function utf8Chars(bytes: { v: number; from: number; to: number }[]): ReadChar[] {
  const out: ReadChar[] = [],
    dec = new TextDecoder('utf-8');
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i].v,
      len = b < 0x80 ? 1 : b >= 0xc2 && b < 0xe0 ? 2 : b >= 0xe0 && b < 0xf0 ? 3 : b >= 0xf0 && b < 0xf5 ? 4 : 0;
    const seq = len ? bytes.slice(i, i + len) : [];
    if (len && seq.length === len && seq.slice(1).every((x) => (x.v & 0xc0) === 0x80)) {
      const s = dec.decode(new Uint8Array(seq.map((x) => x.v)));
      if (s.length && !s.includes('�')) {
        out.push({ s, from: seq[0].from, to: seq[len - 1].to });
        i += len;
        continue;
      }
    }
    out.push({ s: '�', from: bytes[i].from, to: bytes[i].to });
    i++;
  }
  return out;
}

/* ---------- 全体 ---------- */
export interface Decoded {
  ver: number;
  n: number;
  fmt: ReturnType<typeof readFormat>;
  /** バージョン情報（バージョン 7 以上） */
  vinfo: ReturnType<typeof readVersion> | null;
  ecc: Ecc;
  mask: number;
  src: Src[];
  /** マスクを外した格子 */
  unmasked: Uint8Array;
  /** 読んだ符号語（配置順） */
  recv: number[];
  /** 直した符号語（配置順。直せないブロックは読んだまま） */
  fixed: number[];
  rs: RsResult[];
  ok: boolean;
  /** データの符号語（ブロックの順に並べ直したもの）。直したもの・読んだまま */
  data: number[];
  rawData: number[];
  /** データの並びの番号 → 配置順の番号 */
  dataPos: number[];
  parsed: Parsed;
  raw: Parsed;
}

/** 格子 m（n × n、1 が暗い）を復号する。形式情報が読めなければ null */
export function decode(m: Uint8Array, n: number): Decoded | null {
  const ver = (n - 17) / 4;
  if (!Number.isInteger(ver) || ver < 1 || ver > 40) return null;
  const fmt = readFormat(m, n);
  if (!fmt.ok) return null;
  const vinfo = ver >= 7 ? readVersion(m, n) : null,
    { ecc, mask } = fmt,
    fr = frame(ver),
    f = MASKS[mask],
    unmasked = m.slice();
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (fr.role[y * n + x] === Role.Data && f(x, y)) unmasked[y * n + x] ^= 1;
  const bk = blocks(ver, ecc),
    src = srcOrder(bk),
    recv = src.map(() => 0);
  fr.order.forEach((mi, i) => {
    if (i < recv.length * 8) recv[i >> 3] |= unmasked[mi] << (7 - (i & 7));
  });
  /* ブロックに戻して直す */
  const per = bk.sizes.map((s) => new Array<number>(s + bk.ec).fill(0)),
    where = bk.sizes.map((s) => new Array<number>(s + bk.ec).fill(0));
  src.forEach((s, i) => {
    per[s.b][s.i] = recv[i];
    where[s.b][s.i] = i;
  });
  const rs = per.map((b) => rsDecode(b, bk.ec)),
    fixed = recv.slice();
  rs.forEach((r, b) => {
    r.out.forEach((v, i) => {
      fixed[where[b][i]] = v;
    });
  });
  const dataPos: number[] = [];
  bk.sizes.forEach((s, b) => {
    for (let i = 0; i < s; i++) dataPos.push(where[b][i]);
  });
  const data = dataPos.map((i) => fixed[i]),
    rawData = dataPos.map((i) => recv[i]);
  return {
    ver,
    n,
    fmt,
    vinfo,
    ecc,
    mask,
    src,
    unmasked,
    recv,
    fixed,
    rs,
    ok: rs.every((r) => r.ok),
    data,
    rawData,
    dataPos,
    parsed: parse(data, ver),
    raw: parse(rawData, ver),
  };
}

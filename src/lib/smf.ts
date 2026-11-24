/**
 * MIDI ファイル（SMF のフォーマット 0・1 と、それを RIFF に入れた RMI）を、演奏する出来事の列に直す（DOM に依存しない）。
 * 読むのはノート・プログラムチェンジ・ピッチベンド・コントロールチェンジ（7・10・11・64・121）と、テンポと拍子とトラック名。
 * 時刻は 4 分音符を 1 とする拍で持ち、テンポは最初のテンポに対する比の表にする（lib/tempo.ts の TempoMap に渡す）
 */

/** 出来事の種類: 音の始まり・終わり・プログラムチェンジ・コントロールチェンジ・ピッチベンド */
export const ON = 0,
  OFF = 1,
  PC = 2,
  CC = 3,
  BEND = 4;
export type Kind = typeof ON | typeof OFF | typeof PC | typeof CC | typeof BEND;

/** 出来事。tr はトラックの番号（0 から）、ch は 0〜15。a はノート・プログラム・コントロールの番号、v はベロシティと値（0〜127）、ピッチベンドは −1〜1 */
export interface SmfEv {
  b: number;
  tr: number;
  ch: number;
  k: Kind;
  a: number;
  v: number;
}

export interface Smf {
  /** 拍の順。同じ拍では プログラム → コントロール → ベンド → 終わり → 始まり の順 */
  ev: SmfEv[];
  /** 最初のテンポ（1 分あたりの 4 分音符の数） */
  bpm: number;
  /** テンポの変化 [拍, 最初のテンポに対する比] */
  tempo: [number, number][];
  /** 小節の頭の拍（拍子の変化を反映する） */
  starts: number[];
  /** 最後の音が終わる拍 */
  end: number;
  /** 音のあるチャンネル（0〜15、小さい順） */
  chans: number[];
  /** トラックごとの名前（最初のトラック名。なければ ''） */
  names: string[];
  /** 拍子記号 [拍, 分子, 分母]（拍の順。なければ空で、4/4 とみなす） */
  sig: [number, number, number][];
}

/** 読めないファイル */
export class SmfError extends Error {}

/** トラック名の文字列: UTF-8 として読めなければ Shift_JIS として読む（日本の MIDI ファイルに多い） */
function text(d: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(d).trim();
  } catch {
    try {
      return new TextDecoder('shift_jis').decode(d).trim();
    } catch {
      return '';
    }
  }
}

/** 使うコントロールチェンジ */
const CCS = new Set([7, 10, 11, 64, 121]);
/** 同じ拍での並び（プログラム → コントロール → ベンド → 終わり → 始まり） */
const RANK: Record<Kind, number> = { [PC]: 0, [CC]: 1, [BEND]: 2, [OFF]: 3, [ON]: 4 };

/**
 * RMI（RIFF MIDI。RIFF の箱に SMF を入れた古い形式）なら、中の SMF（data の塊）を取り出す。RMI でなければそのまま返す。
 * 塊の大きさはリトルエンディアンで、奇数の大きさの塊のあとには 1 バイトの詰め物がある
 */
export function unwrapRmi(buf: Uint8Array): Uint8Array {
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (buf.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'RMID') return buf;
  let p = 12;
  while (p + 8 <= buf.length) {
    const size = (buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16) | (buf[p + 7] << 24)) >>> 0;
    if (tag(p) === 'data') return buf.subarray(p + 8, Math.min(buf.length, p + 8 + size));
    p += 8 + size + (size & 1);
  }
  throw new SmfError('RMI ファイルの中に MIDI のデータがありません');
}

export function parseSmf(src: ArrayBuffer | Uint8Array): Smf {
  const buf = unwrapRmi(src instanceof Uint8Array ? src : new Uint8Array(src));
  let p = 0;
  const need = (n: number) => {
      if (p + n > buf.length) throw new SmfError('ファイルが途中で切れています');
    },
    u32 = () => {
      need(4);
      return ((buf[p++] << 24) | (buf[p++] << 16) | (buf[p++] << 8) | buf[p++]) >>> 0;
    },
    u16 = () => {
      need(2);
      return (buf[p++] << 8) | buf[p++];
    },
    tag = () => {
      need(4);
      return String.fromCharCode(buf[p++], buf[p++], buf[p++], buf[p++]);
    },
    vlq = () => {
      let v = 0,
        b: number;
      do {
        need(1);
        b = buf[p++];
        v = v * 128 + (b & 0x7f);
      } while (b & 0x80);
      return v;
    };
  if (buf.length < 14 || tag() !== 'MThd') throw new SmfError('MIDI ファイルではありません');
  const hl = u32(),
    h0 = p,
    fmt = u16(),
    ntr = u16(),
    ppq = u16();
  if (fmt > 1) throw new SmfError('フォーマット 2 の MIDI ファイルには対応していません');
  if (ppq & 0x8000 || ppq === 0) throw new SmfError('この時間の単位には対応していません');
  p = h0 + hl;
  const ev: SmfEv[] = [],
    tempo: { t: number; us: number }[] = [],
    meter: { t: number; num: number; den: number }[] = [],
    names: string[] = [];
  for (let k = 0; k < ntr && p < buf.length; k++) {
    if (tag() !== 'MTrk') throw new SmfError('MIDI ファイルが壊れています');
    names.push('');
    const end = Math.min(buf.length, u32() + p);
    let t = 0,
      run = 0;
    while (p < end) {
      t += vlq();
      need(1);
      let st = buf[p];
      if (st & 0x80) p++;
      else if (run) st = run;
      else throw new SmfError('MIDI ファイルが壊れています');
      if (st === 0xff) {
        need(1);
        const ty = buf[p++],
          len = vlq();
        need(len);
        const d = buf.subarray(p, p + len);
        p += len;
        if (ty === 0x51 && len >= 3) tempo.push({ t, us: (d[0] << 16) | (d[1] << 8) | d[2] });
        else if (ty === 0x58 && len >= 2) meter.push({ t, num: d[0], den: 2 ** d[1] });
        else if (ty === 0x03 && !names[k]) names[k] = text(d);
        else if (ty === 0x2f) break;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        p += vlq();
        continue;
      }
      run = st;
      const ty = st & 0xf0,
        ch = st & 0x0f,
        one = ty === 0xc0 || ty === 0xd0;
      need(one ? 1 : 2);
      const a = buf[p++] & 0x7f,
        v = one ? 0 : buf[p++] & 0x7f,
        b = t / ppq;
      if (ty === 0x90 && v > 0) ev.push({ b, tr: k, ch, k: ON, a, v });
      else if (ty === 0x80 || ty === 0x90) ev.push({ b, tr: k, ch, k: OFF, a, v: 0 });
      else if (ty === 0xc0) ev.push({ b, tr: k, ch, k: PC, a, v: 0 });
      else if (ty === 0xb0 && CCS.has(a)) ev.push({ b, tr: k, ch, k: CC, a, v });
      else if (ty === 0xe0) ev.push({ b, tr: k, ch, k: BEND, a: 0, v: Math.max(-1, (((v << 7) | a) - 8192) / 8191) });
    }
    p = end;
  }
  ev.sort((x, y) => x.b - y.b || RANK[x.k] - RANK[y.k]);
  tempo.sort((x, y) => x.t - y.t);
  meter.sort((x, y) => x.t - y.t);
  if (!ev.some((e) => e.k === ON)) throw new SmfError('音がありません');
  /*
   * 曲の終わり: 対になる終わりのある音はその終わり、終わりのない音は始まりの 1 拍後。
   * 対のない終わり（曲の後ろでまとめて送る「全部の音を止める」など）は数えない（後ろの無音を延ばさない）
   */
  let endB = 0;
  {
    const open = new Map<number, number[]>();
    for (const e of ev) {
      const key = e.ch * 128 + e.a;
      if (e.k === ON) {
        const l = open.get(key) ?? [];
        l.push(e.b);
        open.set(key, l);
      } else if (e.k === OFF && open.get(key)?.length) {
        open.get(key)?.shift();
        endB = Math.max(endB, e.b);
      }
    }
    for (const l of open.values()) for (const b of l) endB = Math.max(endB, b + 1);
  }
  /* 拍子: 1 小節が短すぎる・長すぎるもの（壊れた拍子）は使わない */
  let bars = meter.map((m) => ({ b: m.t / ppq, len: (m.num * 4) / m.den })).filter((m) => m.len >= 0.5 && m.len <= 32);
  /* 頭の無音: 最初の音が 2 小節目以降なら、その音を含む小節を曲の頭にする */
  const first = Math.min(...ev.filter((e) => e.k === ON).map((e) => e.b)),
    s0 = barStarts(bars, first + 1e-6),
    head = s0.filter((x) => x <= first + 1e-6).pop() ?? 0,
    tempoB = tempo.map((x) => ({ b: x.t / ppq, us: x.us }));
  let tb = tempoB;
  if (head > 0) {
    for (const e of ev) e.b = Math.max(0, e.b - head);
    endB -= head;
    /* 頭より前の拍子とテンポは、最後のものを頭に置く */
    const shift = <T extends { b: number }>(xs: T[]): T[] => {
      const before = xs.filter((x) => x.b <= head + 1e-6).pop();
      return [
        ...(before ? [{ ...before, b: 0 }] : []),
        ...xs.filter((x) => x.b > head + 1e-6).map((x) => ({ ...x, b: x.b - head })),
      ];
    };
    bars = shift(bars);
    tb = shift(tempoB);
  }
  const us0 = tb.find((x) => x.b === 0)?.us ?? tb[0]?.us ?? 500000,
    tp: [number, number][] = [];
  for (const x of tb) {
    const r = us0 / x.us;
    if (tp.length && tp[tp.length - 1][0] === x.b) tp[tp.length - 1][1] = r;
    else if (!tp.length || tp[tp.length - 1][1] !== r) tp.push([x.b, r]);
  }
  return {
    ev,
    bpm: 60e6 / us0,
    tempo: tp.length === 1 && tp[0][1] === 1 ? [] : tp,
    starts: barStarts(bars, endB),
    end: endB,
    chans: [...new Set(ev.filter((e) => e.k === ON).map((e) => e.ch))].sort((x, y) => x - y),
    names,
    sig: meter.map((m): [number, number, number] => [m.t / ppq, m.num, m.den]),
  };
}

/** 拍子の変化（拍 b から 1 小節が len 拍）から、小節の頭の拍を曲の終わりまで並べる。拍子がなければ 4/4 */
export function barStarts(meter: readonly { b: number; len: number }[], end: number): number[] {
  const m = meter.filter((x) => x.len > 0);
  if (!m.length || m[0].b > 0) m.unshift({ b: 0, len: 4 });
  const out: number[] = [];
  let b = 0,
    i = 0;
  while (b < end - 1e-6 || !out.length) {
    out.push(b);
    while (i + 1 < m.length && m[i + 1].b <= b + 1e-6) i++;
    let nb = b + m[i].len;
    /* 小節の途中で拍子が変わったら、そこを次の小節の頭にする */
    if (i + 1 < m.length && m[i + 1].b < nb - 1e-6) nb = m[i + 1].b;
    b = nb;
    if (out.length > 100000) break;
  }
  return out;
}

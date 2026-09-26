/**
 * JJY のタイムコード（DOM に依存しない）: 1 分ぶんの符号、各秒の意味、送信の包絡線。
 * 符号の割り当ては NICT「標準電波の出し方」による
 */
import { type Jst, jst } from './time';

/** P: マーカ（M・P0〜P5）、0・1: ビット、S: コールサイン */
export type Code = 'P' | '0' | '1' | 'S';

/** 送出する情報（旧実装の EncodeOptions と同じ意味） */
export interface Options {
  /** default: 毎時 15 分と 45 分、force: 毎分、disable: 送らない */
  callSign: 'default' | 'force' | 'disable';
  /** SU2: 夏時間を実施中 */
  summerTime: boolean;
  /** SU1: 6 日以内に夏時間を開始か終了する */
  summerTimeNotice: boolean;
  /** LS1: 月末に閏秒を実施する */
  leapSecondNotice: boolean;
  /** LS2: true なら挿入、false なら削除 */
  leapSecondType: boolean;
  /** ST1〜3: 停波が始まるまで（0: 予定なし、1: 7 日以内 … 6: 2 時間以内） */
  stopAfter: number;
  /** ST4: 停波が昼間だけ */
  stopType: boolean;
  /** ST5〜6: 停波の期間（1: 7 日間以上・未定、2: 2〜6 日間、3: 2 日間以内） */
  stopDuration: number;
}

export const DEFAULTS: Readonly<Options> = {
  callSign: 'default',
  summerTime: false,
  summerTimeNotice: false,
  leapSecondNotice: false,
  leapSecondType: true,
  stopAfter: 0,
  stopType: false,
  stopDuration: 3,
};

/** 値の各桁を 2 進で置く秒: [重み, 秒] */
export type Field = readonly (readonly [number, number])[];
export const FIELDS = {
  m: [
    [40, 1],
    [20, 2],
    [10, 3],
    [8, 5],
    [4, 6],
    [2, 7],
    [1, 8],
  ],
  h: [
    [20, 12],
    [10, 13],
    [8, 15],
    [4, 16],
    [2, 17],
    [1, 18],
  ],
  d: [
    [200, 22],
    [100, 23],
    [80, 25],
    [40, 26],
    [20, 27],
    [10, 28],
    [8, 30],
    [4, 31],
    [2, 32],
    [1, 33],
  ],
  y: [
    [80, 41],
    [40, 42],
    [20, 43],
    [10, 44],
    [8, 45],
    [4, 46],
    [2, 47],
    [1, 48],
  ],
  w: [
    [4, 50],
    [2, 51],
    [1, 52],
  ],
} as const satisfies Record<string, Field>;
/** 偶数パリティを取る秒（PA1: 時、PA2: 分） */
export const PA1 = [12, 13, 15, 16, 17, 18] as const;
export const PA2 = [1, 2, 3, 5, 6, 7, 8] as const;
const MARKERS = [0, 9, 19, 29, 39, 49, 59];

/** この分にコールサインを送るか */
export const callSignOn = (mi: number, o: Options): boolean =>
  o.callSign !== 'disable' && (o.callSign === 'force' || mi === 15 || mi === 45);
/** この分に停波の予告（ST4〜6）を送るか */
export const stopOn = (mi: number, o: Options): boolean => callSignOn(mi, o) && o.stopAfter !== 0;

/** 重み w の桁のビット（BCD）: 重み 40 なら 10 の位の 4 のビット */
function bcd(v: number, w: number): boolean {
  const p = 10 ** Math.floor(Math.log10(w));
  return ((Math.floor(v / p) % 10) & (w / p)) !== 0;
}
const bit = (b: boolean): Code => (b ? '1' : '0');
const xor = (c: readonly Code[], ss: readonly number[]): boolean => ss.filter((s) => c[s] === '1').length % 2 === 1;

/** 1 分ぶんの符号。t はその分の JST（秒は見ない） */
export function encode(t: Pick<Jst, 'y' | 'h' | 'mi' | 'wd' | 'doy'>, o: Options): Code[] {
  const c: Code[] = Array.from({ length: 60 }, () => '0');
  const put = (f: Field, v: number) => {
    for (const [w, s] of f) c[s] = bit(bcd(v, w));
  };
  for (const s of MARKERS) c[s] = 'P';
  put(FIELDS.m, t.mi);
  put(FIELDS.h, t.h);
  put(FIELDS.d, t.doy);
  c[36] = bit(xor(c, PA1));
  c[37] = bit(xor(c, PA2));
  c[38] = bit(o.summerTimeNotice);
  if (callSignOn(t.mi, o)) {
    for (let s = 40; s <= 48; s++) c[s] = 'S';
    put(FIELDS.w, o.stopAfter);
  } else {
    c[40] = bit(o.summerTime);
    put(FIELDS.y, t.y % 100);
    put(FIELDS.w, t.wd);
  }
  if (stopOn(t.mi, o)) {
    c[53] = bit(o.stopType);
    c[54] = bit((o.stopDuration & 2) !== 0);
    c[55] = bit((o.stopDuration & 1) !== 0);
  } else {
    c[53] = bit(o.leapSecondNotice);
    c[54] = bit(o.leapSecondNotice && o.leapSecondType);
  }
  return c;
}

/** 符号から値を読み戻す（重みを掛けて足す）。コールサインの分の y・w は意味を持たない */
export function decode(c: readonly Code[]) {
  const val = (f: Field) => f.reduce((a, [w, s]) => a + (c[s] === '1' ? w : 0), 0);
  return {
    m: val(FIELDS.m),
    h: val(FIELDS.h),
    d: val(FIELDS.d),
    y: val(FIELDS.y),
    w: val(FIELDS.w),
    /** PA1・PA2 を含めた偶数パリティが保たれているか */
    pa1: xor(c, PA1) === (c[36] === '1'),
    pa2: xor(c, PA2) === (c[37] === '1'),
  };
}

/* ---------- 表示用の説明 ---------- */
export const CNAME: Record<Code, string> = {
  P: 'ポジションマーカー',
  '0': 'ビット 0',
  '1': 'ビット 1',
  S: 'コールサイン',
};
export const CSIG: Record<Code, string> = {
  P: '高出力 0.2 秒、低出力 0.8 秒',
  '0': '高出力 0.8 秒、低出力 0.2 秒',
  '1': '高出力 0.5 秒、低出力 0.5 秒',
  S: '・－－－ ・－－－ －・－－ を 2 回（40〜48 秒）',
};

const FIXED: Record<number, string> = {
  0: 'M: 分の始まりを表すポジションマーカー',
  9: 'P1: ポジションマーカー',
  19: 'P2: ポジションマーカー',
  29: 'P3: ポジションマーカー',
  39: 'P4: ポジションマーカー',
  49: 'P5: ポジションマーカー',
  59: 'P0: ポジションマーカー（次の M と続いて分の始まりを示す）',
  36: 'PA1: 「時」のビットの偶数パリティ',
  37: 'PA2: 「分」のビットの偶数パリティ',
  38: 'SU1: 6 日以内に夏時間を開始か終了するときビット 1',
};
const NAMES = { m: '分', h: '時', d: '年の通算日', y: '年（下 2 桁）', w: '曜日（日曜 = 0）' } as const;
const UNUSED = '未使用（常にビット 0）';

/** s 秒の符号の意味。cs: コールサインの分、st: 停波の予告を送る分 */
export function meaning(s: number, cs: boolean, st: boolean): string {
  if (FIXED[s]) return FIXED[s];
  if (cs && s >= 40 && s <= 48) return '「JJY」を表すコールサイン（モールス符号）';
  if (s === 40) return 'SU2: 夏時間を実施中のときビット 1';
  if (cs && s >= 50 && s <= 52) return `ST${s - 49}: 停波が始まるまでの時間の上位 ${s - 49} ビット目`;
  if (s === 53) return st ? 'ST4: 停波が昼間だけのときビット 1' : 'LS1: 月末に閏秒を実施するときビット 1';
  if (s === 54) return st ? 'ST5: 停波の期間の上位 1 ビット目' : 'LS2: 閏秒が挿入のときビット 1、削除のときビット 0';
  if (s === 55 && st) return 'ST6: 停波の期間の上位 2 ビット目';
  for (const [k, f] of Object.entries(FIELDS) as [keyof typeof FIELDS, Field][]) {
    const hit = f.find(([, x]) => x === s);
    if (hit) return `${NAMES[k]}の重み（${hit[0]}）`;
  }
  return UNUSED;
}

/* ---------- 送信の包絡線 ---------- */
/** 低出力の振幅（高出力を 1 とする） */
export const LOW = 0.1;
/** 符号ごとの高出力の長さ τ（秒） */
export const WIDTH: Record<Exclude<Code, 'S'>, number> = { P: 0.2, '1': 0.5, '0': 0.8 };

/** 高出力の区間 [開始, 終了]（分の頭からの秒） */
export function envelope(c: readonly Code[]): [number, number][] {
  const H: [number, number][] = [];
  for (let s = 0; s < 60; s++) {
    const k = c[s];
    if (k !== 'S') {
      H.push([s, s + WIDTH[k]]);
      continue;
    }
    if (s && c[s - 1] === 'S') continue;
    /* モールス: 短点 0.1 秒、長点 0.25 秒、点の間 0.1 秒、文字の間 +0.05 秒。1 回 4.2 秒で 2 回送る */
    let t = s;
    const on = (d: number) => {
      H.push([t, t + d]);
      t += d;
    };
    for (let i = 0; i < 2; i++) {
      t += 0.3;
      for (const ch of ['.---', '.---', '-.--']) {
        for (const x of ch) {
          on(x === '.' ? 0.1 : 0.25);
          t += 0.1;
        }
        t += 0.05;
      }
    }
  }
  return H;
}

export interface Minute {
  /** その分の 0 秒の JST */
  t: Jst;
  codes: Code[];
  /** 高出力の区間 */
  H: [number, number][];
}

/** 分ごとの符号と包絡線。送出する情報（opt）を変えたら clear する */
export class Signal {
  private readonly cache = new Map<number, Minute>();
  constructor(readonly opt: Options) {}

  /** m0: 分の頭（UTC のミリ秒） */
  minute(m0: number): Minute {
    let v = this.cache.get(m0);
    if (!v) {
      const t = jst(m0),
        codes = encode(t, this.opt);
      v = { t, codes, H: envelope(codes) };
      if (this.cache.size > 4) this.cache.clear();
      this.cache.set(m0, v);
    }
    return v;
  }

  /** 時刻 ms（UTC のミリ秒）の振幅: 1 か LOW */
  level(ms: number): number {
    const m0 = Math.floor(ms / 60000) * 60000,
      x = (ms - m0) / 1000;
    return this.minute(m0).H.some(([a, b]) => x >= a && x < b) ? 1 : LOW;
  }

  clear(): void {
    this.cache.clear();
  }
}

import { describe, expect, it } from 'vitest';
import {
  type Code,
  callSignOn,
  DEFAULTS,
  decode,
  encode,
  envelope,
  LOW,
  meaning,
  type Options,
  Signal,
  stopOn,
} from '../src/tools/jjy/code';
import { EQS, substHtml } from '../src/tools/jjy/math';
import { apply, OPT_ROWS, offRows, rowNotes } from '../src/tools/jjy/options';
import { diffHtml, jst, nextCallSign } from '../src/tools/jjy/time';

/** JST の日時を UTC のミリ秒にする（月は 1〜12） */
const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s);
const code = (ms: number, o: Partial<Options> = {}) => encode(jst(ms), { ...DEFAULTS, ...o }).join('');

describe('日本標準時', () => {
  it('UTC に 9 時間を足して暦に分ける', () => {
    expect(jst(at(2026, 9, 26, 22, 20, 36))).toEqual({ y: 2026, mo: 9, d: 26, h: 22, mi: 20, s: 36, wd: 6, doy: 269 });
  });
  it('UTC の 15 時が JST の翌日 0 時になる', () => {
    const t = jst(Date.UTC(2026, 11, 31, 15, 0, 0));
    expect([t.y, t.mo, t.d, t.h, t.doy, t.wd]).toEqual([2027, 1, 1, 0, 1, 5]);
  });
  it('閏年の年末は通算 366 日目', () => {
    expect(jst(at(2024, 12, 31, 12, 0)).doy).toBe(366);
    expect(jst(at(2025, 12, 31, 12, 0)).doy).toBe(365);
    expect(jst(at(2024, 3, 1, 0, 0)).doy).toBe(61);
  });
});

/* 期待値は旧実装（legacy/lib/jjy.ts、date-fns を使い TZ=Asia/Tokyo で実行）の出力 */
describe('符号化: 旧実装と同じ符号', () => {
  const cases: [string, number, Partial<Options>, string][] = [
    ['通常の分', at(2026, 9, 26, 22, 20, 36), {}, 'P01000000P001000010P001000110P100100010P000100110P110000000P'],
    [
      '15 分はコールサイン',
      at(2026, 9, 26, 22, 15),
      {},
      'P00100101P001000010P001000110P100100010PSSSSSSSSSP000000000P',
    ],
    [
      '45 分の停波の予告',
      at(2026, 9, 26, 9, 45, 10),
      { stopAfter: 6, stopType: true, stopDuration: 2 },
      'P10000101P000001001P001000110P100100010PSSSSSSSSSP110110000P',
    ],
    [
      'コールサインの分でも停波の予定がなければ閏秒',
      at(2026, 9, 26, 9, 15, 10),
      { leapSecondNotice: true, leapSecondType: false },
      'P00100101P000001001P001000110P100100010PSSSSSSSSSP000100000P',
    ],
    [
      'コールサインを常に送る',
      at(2026, 9, 26, 22, 20),
      { callSign: 'force' },
      'P01000000P001000010P001000110P100100010PSSSSSSSSSP000000000P',
    ],
    [
      'コールサインを送らない（15 分でも年と曜日）',
      at(2026, 9, 26, 22, 15),
      { callSign: 'disable', summerTime: true },
      'P00100101P001000010P001000110P100100010P100100110P110000000P',
    ],
    [
      '夏時間の予告と実施',
      at(2026, 9, 26, 22, 20),
      { summerTime: true, summerTimeNotice: true },
      'P01000000P001000010P001000110P100100011P100100110P110000000P',
    ],
    [
      '閏秒の挿入',
      at(2026, 12, 31, 23, 59),
      { leapSecondNotice: true, leapSecondType: true },
      'P10101001P001000011P001100110P010100100P000100110P100110000P',
    ],
    [
      '閏秒の削除',
      at(2026, 12, 31, 23, 59),
      { leapSecondNotice: true, leapSecondType: false },
      'P10101001P001000011P001100110P010100100P000100110P100100000P',
    ],
    [
      '2000 年 1 月 1 日 0 時 0 分',
      at(2000, 1, 1, 0, 0),
      {},
      'P00000000P000000000P000000000P000100000P000000000P110000000P',
    ],
    ['2099 年の大晦日', at(2099, 12, 31, 23, 58), {}, 'P10101000P001000011P001100110P010100110P010011001P100000000P'],
    ['閏年の 366 日目', at(2024, 12, 31, 12, 34), {}, 'P01100100P000100010P001100110P011000010P000100100P010000000P'],
  ];
  for (const [name, ms, o, want] of cases) it(name, () => expect(code(ms, o)).toBe(want));
});

describe('符号化: 各場合', () => {
  const t0 = at(2026, 9, 26, 22, 20);
  const c = (o: Partial<Options> = {}, ms = t0) => encode(jst(ms), { ...DEFAULTS, ...o });

  it('マーカは 0・9・19・29・39・49・59 秒だけ', () => {
    const pos = c()
      .map((k, s) => (k === 'P' ? s : -1))
      .filter((s) => s >= 0);
    expect(pos).toEqual([0, 9, 19, 29, 39, 49, 59]);
  });

  it('年: 下 2 桁を 41〜48 秒に BCD で置く', () => {
    for (const y of [2000, 2009, 2026, 2045, 2099, 2100]) {
      const r = decode(c({}, at(y, 6, 1, 12, 0)));
      expect(r.y).toBe(y % 100);
    }
    expect(
      c({}, at(2026, 6, 1, 12, 0))
        .slice(41, 49)
        .join(''),
    ).toBe('00100110');
  });

  it('曜日: 日曜 = 0 から土曜 = 6 を 50〜52 秒に置く', () => {
    /* 2026-09-20 は日曜 */
    for (let i = 0; i < 7; i++) {
      const ms = at(2026, 9, 20 + i, 10, 0);
      expect(jst(ms).wd).toBe(i);
      expect(decode(c({}, ms)).w).toBe(i);
    }
    expect(
      c({}, at(2026, 9, 26, 10, 0))
        .slice(50, 53)
        .join(''),
    ).toBe('110');
  });

  it('閏秒: LS1 が「なし」なら LS2 も 0、「あり」なら挿入 1・削除 0', () => {
    expect(c({ leapSecondNotice: false, leapSecondType: true }).slice(53, 56).join('')).toBe('000');
    expect(c({ leapSecondNotice: true, leapSecondType: true }).slice(53, 56).join('')).toBe('110');
    expect(c({ leapSecondNotice: true, leapSecondType: false }).slice(53, 56).join('')).toBe('100');
  });

  it('夏時間: SU1 は 38 秒、SU2 は 40 秒（コールサインの分は S になる）', () => {
    expect(c({ summerTimeNotice: true })[38]).toBe('1');
    expect(c({ summerTime: true })[40]).toBe('1');
    expect(c()[38]).toBe('0');
    expect(c()[40]).toBe('0');
    expect(c({ summerTime: true }, at(2026, 9, 26, 22, 45))[40]).toBe('S');
    expect(c({ summerTimeNotice: true }, at(2026, 9, 26, 22, 45))[38]).toBe('1');
  });

  it('停波の予告: コールサインの分だけ ST1〜6 を送る', () => {
    const o = { stopAfter: 5, stopType: true, stopDuration: 1 };
    const cs = c(o, at(2026, 9, 26, 22, 15));
    expect(cs.slice(50, 56).join('')).toBe('101101');
    /* コールサインのない分は曜日と閏秒のまま */
    expect(c(o).slice(50, 56).join('')).toBe(c().slice(50, 56).join(''));
    /* 停波の予定がなければ ST1〜3 は 000、53〜54 秒は閏秒 */
    expect(
      c({ stopAfter: 0, stopType: true, leapSecondNotice: true }, at(2026, 9, 26, 22, 15))
        .slice(50, 56)
        .join(''),
    ).toBe('000110');
    for (let a = 0; a <= 6; a++) expect(decode(c({ stopAfter: a }, at(2026, 9, 26, 22, 45))).w).toBe(a);
  });

  it('コールサイン: 既定は 15・45 分だけ、force は毎分、disable は送らない', () => {
    const S = 'SSSSSSSSS';
    for (let mi = 0; mi < 60; mi++) {
      const ms = at(2026, 9, 26, 3, mi);
      expect(c({}, ms).slice(40, 49).join('') === S).toBe(mi === 15 || mi === 45);
      expect(c({ callSign: 'force' }, ms).slice(40, 49).join('')).toBe(S);
      expect(c({ callSign: 'disable' }, ms).includes('S')).toBe(false);
    }
    expect(callSignOn(15, { ...DEFAULTS, callSign: 'disable' })).toBe(false);
    expect(stopOn(15, { ...DEFAULTS, stopAfter: 1 })).toBe(true);
    expect(stopOn(16, { ...DEFAULTS, stopAfter: 1 })).toBe(false);
  });

  it('パリティ: PA1 は時、PA2 は分のビットの偶数パリティ', () => {
    /* 23 時 = 10 0011（1 が 3 個）→ 1、59 分 = 101 1001（1 が 4 個）→ 0 */
    const x = c({}, at(2026, 9, 26, 23, 59));
    expect([x[36], x[37]]).toEqual(['1', '0']);
    /* 22 時 = 10 0010（2 個）→ 0、20 分 = 010 0000（1 個）→ 1 */
    const y = c({}, at(2026, 9, 26, 22, 20));
    expect([y[36], y[37]]).toEqual(['0', '1']);
  });

  it('読み戻すと元の時・分・通算日・年・曜日になり、パリティが合う', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 500; i++) {
      const ms = Date.UTC(2000, 0, 1) + Math.floor(rnd() * 100 * 365.25 * 864e5);
      const t = jst(ms),
        r = decode(encode(t, { ...DEFAULTS, callSign: 'disable' }));
      expect([r.h, r.m, r.d, r.y, r.w, r.pa1, r.pa2]).toEqual([t.h, t.mi, t.doy, t.y % 100, t.wd, true, true]);
    }
  });
});

describe('各秒の意味', () => {
  it('マーカ・重み・未使用', () => {
    expect(meaning(0, false, false)).toMatch(/^M: /);
    expect(meaning(59, false, false)).toMatch(/^P0: /);
    expect(meaning(1, false, false)).toBe('分の重み（40）');
    expect(meaning(18, false, false)).toBe('時の重み（1）');
    expect(meaning(22, false, false)).toBe('年の通算日の重み（200）');
    expect(meaning(41, false, false)).toBe('年（下 2 桁）の重み（80）');
    expect(meaning(50, false, false)).toBe('曜日（日曜 = 0）の重み（4）');
    for (const s of [4, 10, 11, 14, 20, 21, 24, 34, 35, 56, 57, 58])
      expect(meaning(s, false, false)).toBe('未使用（常にビット 0）');
  });
  it('コールサインと停波の分で意味が変わる', () => {
    expect(meaning(40, false, false)).toMatch(/^SU2: /);
    expect(meaning(40, true, false)).toMatch(/コールサイン/);
    expect(meaning(51, true, false)).toMatch(/^ST2: /);
    expect(meaning(53, true, false)).toMatch(/^LS1: /);
    expect(meaning(53, true, true)).toMatch(/^ST4: /);
    expect(meaning(54, true, true)).toMatch(/^ST5: /);
    expect(meaning(55, true, true)).toMatch(/^ST6: /);
    expect(meaning(55, true, false)).toBe('未使用（常にビット 0）');
  });
});

describe('送信の包絡線', () => {
  it('高出力の長さは P 0.2 秒、1 は 0.5 秒、0 は 0.8 秒', () => {
    const H = envelope(['P', '1', '0', ...Array<Code>(57).fill('0')]);
    expect(H.slice(0, 3)).toEqual([
      [0, 0.2],
      [1, 1.5],
      [2, 2.8],
    ]);
    expect(H).toHaveLength(60);
  });
  it('コールサインは 40 秒からモールスの点と線 24 個を 2 回で送り、49 秒までに終わる', () => {
    const c = encode(jst(at(2026, 9, 26, 22, 15)), DEFAULTS),
      H = envelope(c),
      S = H.filter(([a]) => a >= 40 && a < 49);
    expect(H).toHaveLength(60 - 9 + 24);
    expect(S).toHaveLength(24);
    expect(S[0][0]).toBeCloseTo(40.3, 9);
    expect(S[0][1] - S[0][0]).toBeCloseTo(0.1, 9);
    expect(S[1][1] - S[1][0]).toBeCloseTo(0.25, 9);
    expect(S.at(-1)?.[1]).toBeCloseTo(48.25, 9);
  });
  it('Signal.level は高出力の区間で 1、それ以外は LOW', () => {
    const sig = new Signal({ ...DEFAULTS }),
      m0 = at(2026, 9, 26, 22, 20);
    expect(sig.level(m0)).toBe(1);
    expect(sig.level(m0 + 199)).toBe(1);
    expect(sig.level(m0 + 200)).toBe(LOW);
    /* 20 分: 1 秒目は 0（0.8 秒）、2 秒目は 1（0.5 秒） */
    expect(sig.level(m0 + 1700)).toBe(1);
    expect(sig.level(m0 + 1900)).toBe(LOW);
    expect(sig.level(m0 + 2400)).toBe(1);
    expect(sig.level(m0 + 2600)).toBe(LOW);
  });
  it('設定を変えたら clear で符号を作り直す', () => {
    const o = { ...DEFAULTS },
      sig = new Signal(o),
      m0 = at(2026, 9, 26, 22, 20);
    expect(sig.minute(m0).codes[40]).toBe('0');
    o.summerTime = true;
    expect(sig.minute(m0).codes[40]).toBe('0');
    sig.clear();
    expect(sig.minute(m0).codes[40]).toBe('1');
  });
});

describe('選択肢の行', () => {
  it('押した値を設定に写す', () => {
    const o = { ...DEFAULTS },
      row = (k: string) => OPT_ROWS.find((r) => r.k === k) ?? OPT_ROWS[0];
    apply(o, row('stopAfter'), '4');
    apply(o, row('leapSecondType'), 'false');
    apply(o, row('callSign'), 'force');
    apply(o, row('callSign'), 'nope');
    expect([o.stopAfter, o.leapSecondType, o.callSign]).toEqual([4, false, 'force']);
  });
  it('LS1 が「なし」なら LS2、停波の予定がなければ ST4〜6 を使わない', () => {
    expect(offRows(DEFAULTS)).toEqual({ leapSecondType: true, stopType: true, stopDuration: true });
    expect(offRows({ ...DEFAULTS, leapSecondNotice: true, stopAfter: 3 })).toEqual({
      leapSecondType: false,
      stopType: false,
      stopDuration: false,
    });
  });
  it('注記: 次のコールサインの時刻と、この分に使わない理由', () => {
    const n = rowNotes({ h: 23, mi: 50 }, DEFAULTS);
    expect(n.callSign).toBe('次は 00:15 に送ります');
    expect(n.stopAfter).toBe('コールサインの分だけ使います（次は 00:15）');
    expect(n.stopType).toBe('停波の予告があるときだけ使います');
    const cs = rowNotes({ h: 9, mi: 45 }, { ...DEFAULTS, stopAfter: 2, leapSecondNotice: true });
    expect(cs.callSign).toBe('この分は 40–48 秒に送ります');
    expect(cs.summerTime).toBe('この分はコールサインを送るため使いません');
    expect(cs.leapSecondNotice).toBe('この分は停波の予告を送るため使いません');
    expect(cs.stopType).toBe('');
    expect(rowNotes({ h: 9, mi: 45 }, { ...DEFAULTS, callSign: 'disable', stopAfter: 1 }).stopAfter).toBe(
      'コールサインを送らないため使いません',
    );
  });
});

describe('表記', () => {
  it('次のコールサイン', () => {
    expect(nextCallSign({ h: 9, mi: 0 })).toBe('09:15');
    expect(nextCallSign({ h: 9, mi: 15 })).toBe('09:45');
    expect(nextCallSign({ h: 9, mi: 44 })).toBe('09:45');
    expect(nextCallSign({ h: 23, mi: 45 })).toBe('00:15');
  });
  it('現在時刻との差', () => {
    expect(diffHtml(0)).toBe('0<span class="u">s</span>');
    expect(diffHtml(40)).toBe('0<span class="u">s</span>');
    expect(diffHtml(-2500)).toBe('−2.5<span class="u">s</span>');
    expect(diffHtml(59_940)).toBe('+59.9<span class="u">s</span>');
    expect(diffHtml(-(3600 + 62) * 1000)).toBe('−1:01:02');
  });
  it('代入した式は読み戻した値で終わる', () => {
    const codes = encode(jst(at(2026, 9, 26, 22, 20)), DEFAULTS),
      h = substHtml(codes);
    expect(h).toContain('<mo>=</mo><mn>20</mn></math>');
    expect(h).toContain('<mo>=</mo><mn>22</mn></math>');
    expect(h).toContain('<mo>=</mo><mn>269</mn></math>');
    expect((h.match(/<math /g) ?? []).length).toBe(4);
    expect((EQS.match(/<math /g) ?? []).length).toBe(8);
  });
});

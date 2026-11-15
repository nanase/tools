import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../src/tools/chord-progression/samples';
import {
  compute,
  endless,
  fromFile,
  type Item,
  parseSong,
  playOrder,
  toFile,
} from '../src/tools/chord-progression/song';
import {
  type Chord,
  type CustomPat,
  chordName,
  func,
  type Key,
  namedNext,
  PAT_ORDER,
  PATS,
  patOf,
  roman,
  setCustomPats,
  toGrid,
  trans,
  voicing,
} from '../src/tools/chord-progression/theory';

const C: Key = { t: 0, m: 'maj' },
  D: Key = { t: 2, m: 'maj' },
  Am: Key = { t: 9, m: 'min' };
const ch = (d: number, q: Chord['q'] = 'M', inv = 0): Chord => ({ d, q, inv });
const take = <T>(g: Generator<T>, n: number): T[] => {
  const out: T[] = [];
  for (const x of g) {
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
};

describe('名前と綴り', () => {
  it('度数と音名', () => {
    expect(roman(ch(9, 'm'), C)).toBe('Ⅵm');
    expect(chordName(ch(7, '7'), C)).toBe('G7');
    expect(chordName(ch(0, 'M', 1), C)).toBe('C/E');
    expect(chordName(ch(8), D)).toBe('B♭');
    expect(chordName(ch(10), D)).toBe('C');
    expect(chordName(ch(11, 'dim'), D)).toBe('C♯dim');
    expect(chordName(ch(3), { t: 3, m: 'maj' })).toBe('G♭');
    expect(roman(ch(3), Am)).toBe('Ⅲ');
    expect(chordName(ch(3), Am)).toBe('C');
  });
  it('6・9 などのコード', () => {
    const Bb: Key = { t: 10, m: 'maj' };
    expect(chordName(ch(0, '6'), Bb)).toBe('B♭6');
    expect(chordName(ch(9, 'm7'), C)).toBe('Am7');
    expect(chordName(ch(2, 'm9'), C)).toBe('Dm9');
    expect(chordName(ch(7, '7sus4'), C)).toBe('G7sus4');
    expect(chordName(ch(11, 'dim7'), C)).toBe('Bdim7');
    expect(voicing(ch(0, '9'), C)).toHaveLength(6);
    const items = parseSong('[key Bb maj] I6 ii9 IM9 vM7 V7sus4 Iadd9 Isus2 viio7');
    expect(compute(items).chords.map((e) => chordName(e.it, e.key))).toEqual([
      'B♭6',
      'Cm9',
      'B♭M9',
      'FmM7',
      'F7sus4',
      'B♭add9',
      'B♭sus2',
      'Adim7',
    ]);
  });
  it('機能', () => {
    expect(func(ch(0), C)).toBe('T');
    expect(func(ch(5), C)).toBe('S');
    expect(func(ch(7, '7'), C)).toBe('D');
    expect(func(ch(4, '7'), C)).toBe('D');
    expect(func(ch(10), C)).toBe('S');
    expect(func(ch(11, 'dim'), C)).toBe('D');
  });
});

describe('つながりの強さと終止', () => {
  it('教科書の表の 3 段', () => {
    expect(trans(ch(0), C, ch(5), C).lv).toBe(3);
    expect(trans(ch(0), C, ch(9, 'm'), C).lv).toBe(2);
    expect(trans(ch(0), C, ch(2, 'm'), C).lv).toBe(1);
    expect(trans(ch(4, 'm'), C, ch(7), C).lv).toBe(1);
    expect(trans(ch(11, 'dim'), C, ch(4, 'm'), C).lv).toBe(3);
  });
  it('終止の名前', () => {
    expect(trans(ch(7, '7'), C, ch(0), C)).toEqual({ lv: 3, name: '完全終止' });
    expect(trans(ch(5), C, ch(0), C).name).toBe('変格終止');
    expect(trans(ch(7), C, ch(9, 'm'), C).name).toBe('偽終止');
    expect(trans(ch(2, 'm7'), C, ch(7, '7'), C).name).toBe('ツーファイブ');
    expect(trans(ch(7, '7'), Am, ch(0, 'm'), Am).name).toBe('完全終止');
    expect(trans(ch(7), Am, ch(8), Am).name).toBe('偽終止');
  });
  it('セカンダリードミナントと調の外', () => {
    expect(trans(ch(4, '7'), C, ch(9, 'm'), C)).toEqual({ lv: 3, name: 'ドミナント進行' });
    expect(trans(ch(4, '7'), C, ch(5), C).lv).toBeLessThanOrEqual(1);
    expect(trans(ch(0), C, ch(10), C).lv).toBeLessThan(trans(ch(0), C, ch(5), C).lv);
  });
  it('同じコードと転調をまたぐ', () => {
    expect(trans(ch(0), C, ch(0), C).lv).toBe(0);
    expect(trans(ch(0), C, ch(0), D).lv).toBe(-1);
  });
});

describe('和音と奏法', () => {
  it('音の高さの範囲', () => {
    for (let t = 0; t < 12; t++)
      for (const q of ['M', 'm', '7', 'm7b5'] as const)
        for (let inv = 0; inv < 3; inv++) {
          const v = voicing(ch(0, q, inv), { t, m: 'maj' });
          expect(v[0]).toBeGreaterThanOrEqual(40);
          expect(v[0]).toBeLessThanOrEqual(51);
          expect(v[1]).toBeGreaterThanOrEqual(52);
          expect(v[1]).toBeLessThanOrEqual(63);
          expect(v.length).toBe(5);
        }
  });
  it('奏法は和音の中の音だけを弾く', () => {
    for (const p of PAT_ORDER)
      for (const n of [4, 5, 6])
        for (const [bs, bar] of [
          [2, 8],
          [2, 6],
          [1, 6],
        ])
          for (const S of [4, 6, 8, 12])
            for (const x of PATS[p].g(n, S, bs, bar)) {
              expect(x.s).toBeGreaterThanOrEqual(0);
              expect(x.s).toBeLessThan(S);
              expect(x.l).toBeGreaterThan(0);
              if (typeof x.i === 'number') {
                expect(x.i).toBeGreaterThanOrEqual(0);
                expect(x.i).toBeLessThan(n);
              }
            }
  });
  it('ベースと和音は拍子に合わせてベースを置く', () => {
    const bassAt = (bs: number, bar: number) =>
      PATS.oom
        .g(5, bar, bs, bar)
        .filter((x) => typeof x.i === 'number')
        .map((x) => x.s);
    expect(bassAt(2, 8)).toEqual([0, 4]);
    expect(bassAt(2, 6)).toEqual([0]);
    expect(bassAt(1, 6)).toEqual([0, 3]);
  });
});

describe('曲の計算', () => {
  it('拍子どおりの長さは拍子の分子', () => {
    const tl = compute(parseSong('[met 4/4] I [met 3/4] V IV:2 [met 6/8] I'));
    expect(tl.chords.map((e) => e.beats)).toEqual([4, 3, 2, 6]);
    expect(tl.chords.map((e) => e.durQ)).toEqual([4, 3, 2, 3]);
    expect(tl.chords.map((e) => e.bars[0]?.no)).toEqual([1, 2, 3, 4]);
  });
  it('転調のあとは度数のまま', () => {
    const tl = compute(parseSong('[key C maj] I V [key D maj] I V'));
    expect(tl.chords.map((e) => chordName(e.it, e.key))).toEqual(['C', 'G', 'D', 'A']);
    expect(tl.chords[2].tr?.lv).toBe(-1);
  });
  it('名前のある進行を見つける', () => {
    const tl = compute(parseSong('[key C maj] I IV V iii vi I'));
    expect(tl.chords.map((e) => e.grp?.n ?? null)).toEqual([
      null,
      '王道進行',
      '王道進行',
      '王道進行',
      '王道進行',
      null,
    ]);
    const tl2 = compute(parseSong('[key A min] i VI VII III'));
    expect(tl2.chords[0].grp?.n).toBe('小室進行');
    const s = tl.chords.slice(0, 3).map((e) => ({ c: e.it, key: e.key, i: e.i }));
    expect(namedNext(s).map((x) => x.n)).toContain('王道進行');
  });
});

describe('くり返し', () => {
  const order = (src: string, n = 50) => {
    const items = parseSong(src);
    return take(playOrder(items), n).map((s) => chordName(items[s.i] as Extract<Item, { k: 'ch' }> as Chord, C));
  };
  it('回数どおりに戻る', () => {
    expect(order('I |: IV V :|3 I')).toEqual(['C', 'F', 'G', 'F', 'G', 'F', 'G', 'C']);
  });
  it('始めがなければ曲の頭へ', () => {
    expect(order('I V :|2 IV')).toEqual(['C', 'G', 'C', 'G', 'F']);
  });
  it('続けて置いたくり返し', () => {
    expect(order('|: I :|2 |: V :|2')).toEqual(['C', 'C', 'G', 'G']);
  });
  it('無制限は止めるまで続く', () => {
    const items = parseSong('I |: V IV :|*');
    expect(endless(items)).toBe(true);
    expect(take(playOrder(items), 9).map((s) => s.i)).toHaveLength(9);
    expect(endless(parseSong('I :|* V'))).toBe(true);
    expect(endless(parseSong('[tmp 90] |: :|*'))).toBe(false);
  });
  it('回目を数える', () => {
    const items = parseSong('|: I :|3'),
      reps = take(playOrder(items), 5).map((s) => s.rep?.pass);
    expect(reps).toEqual([1, 2, 3]);
  });
  it('コードのない区間はくり返さない', () => {
    expect(order('I |: [tmp 90] :|* V')).toEqual(['C', 'G']);
  });
});

describe('ラベルと作った奏法', () => {
  it('ラベルは小節を改め、演奏では飛ばす', () => {
    const items = parseSong('[met 4/4] I:2 [lbl サビ br] V:2 IV'),
      tl = compute(items);
    expect(tl.chords.map((e) => e.bars[0]?.no)).toEqual([1, 2, 3]);
    expect(take(playOrder(items), 10).map((x) => items[x.i].k)).toEqual(['ch', 'ch', 'ch']);
    const lb = items.find((x) => x.k === 'lbl');
    expect(lb).toMatchObject({ t: 'サビ', br: true });
  });
  it('作った奏法は格子どおりに弾き、1 周をくり返す', () => {
    const p: CustomPat = {
      id: 'u1',
      name: 'テスト',
      res: 0.5,
      len: 4,
      cells: [
        [0, 0],
        [1, 2],
        [3, 5],
      ],
    };
    setCustomPats([p]);
    const ev = patOf('u1').g(5, 4);
    expect(ev.map((x) => [x.s, x.i])).toEqual([
      [0, 0],
      [0.5, 2],
      [2, 0],
      [2.5, 2],
    ]);
    expect(patOf('u9').name).toBe(PATS.updown.name);
    setCustomPats([]);
  });
  it('組み込みの奏法を格子へ写す', () => {
    expect(toGrid('whole', 1, 8)).toEqual([0, 1, 2, 3, 4, 5].map((r) => [0, r]));
    expect(toGrid('up', 0.5, 4).map((c) => c[0])).toEqual([0, 2, 4, 6]);
  });
  it('作った奏法を曲と一緒に保存し、ない奏法への参照は戻す', () => {
    const items = parseSong('[pat updown] I V');
    (items[1] as Extract<Item, { k: 'ch' }>).p = 'u1';
    const pats: CustomPat[] = [{ id: 'u1', name: 'A', res: 1, len: 8, cells: [[0, 0]] }];
    const back = fromFile(JSON.parse(JSON.stringify(toFile('x', items, pats))));
    expect(back?.pats).toEqual(pats);
    expect((back?.items[1] as Extract<Item, { k: 'ch' }> | undefined)?.p).toBe('u1');
    const lost = fromFile(JSON.parse(JSON.stringify(toFile('x', items))));
    expect((lost?.items[1] as Extract<Item, { k: 'ch' }> | undefined)?.p).toBeNull();
    expect(fromFile({ v: 1, items: [], pats: [{ id: 'x', name: 'a', res: 1, len: 8, cells: [] }] })).toBeNull();
    expect(fromFile({ v: 1, items: [], pats: [{ id: 'u2', name: 'a', res: 1, len: 8, cells: [[8, 0]] }] })).toBeNull();
  });
});

describe('保存の形式', () => {
  it('書いて読むと同じ', () => {
    const items = parseSong('[key Eb min] [met 6/8] [tmp 70] [pat three] [vce str] |: i iv7:3/1@up V7 :|* ');
    const back = fromFile(JSON.parse(JSON.stringify(toFile('テスト', items))));
    expect(back?.name).toBe('テスト');
    expect(back?.items.map(({ id: _i, ...r }) => r)).toEqual(items.map(({ id: _i, ...r }) => r));
  });
  it('形の違うものは読まない', () => {
    expect(fromFile(null)).toBeNull();
    expect(fromFile({ v: 2, items: [] })).toBeNull();
    expect(fromFile({ v: 1, items: [{ k: 'ch', d: 12, q: 'M', inv: 0, b: 0, p: null }] })).toBeNull();
    expect(fromFile({ v: 1, items: [{ k: 'ch', d: 0, q: 'X', inv: 0, b: 0, p: null }] })).toBeNull();
    expect(fromFile({ v: 1, items: [{ k: 're', n: 1 }] })).toBeNull();
    expect(fromFile({ v: 1, items: [{ k: 'met', n: 3, dn: 5 }] })).toBeNull();
    expect(fromFile({ v: 1, items: [{ k: 'hack' }] })).toBeNull();
  });
});

describe('サンプル', () => {
  it.each(SAMPLES.map((s) => [s.name, s.src]))('%s', (_n, src) => {
    const items = parseSong(src),
      tl = compute(items);
    expect(tl.chords.length).toBeGreaterThan(0);
    expect(take(playOrder(items), 40).length).toBeGreaterThan(0);
  });
  it('名前の付いたサンプルはその進行を含む', () => {
    for (const [id, n] of [
      ['canon', 'カノン進行'],
      ['oudou', '王道進行'],
      ['komuro', '小室進行'],
      ['marusa', '丸サ進行'],
      ['cycle', '循環進行'],
      ['two-five', 'ツーファイブワン'],
      ['blues', '12 小節のブルース'],
    ]) {
      const s = SAMPLES.find((x) => x.id === id);
      expect(
        compute(parseSong(s?.src ?? '')).chords.some((e) => e.grp?.n === n),
        `${id}`,
      ).toBe(true);
    }
  });
});

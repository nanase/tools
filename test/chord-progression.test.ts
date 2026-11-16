import { describe, expect, it } from 'vitest';
import { bandNotes, MEMBERS, type MemberId, memberOf, previewNotes, STYLES } from '../src/tools/chord-progression/band';
import { SAMPLES, sampleSong } from '../src/tools/chord-progression/samples';
import {
  ALL_PLACES,
  adjacent,
  compute,
  fromFile,
  inLattice,
  keyAt,
  nearestPlace,
  parseChords,
  parseKey,
  type Song,
  STYLE_ORDER,
  toFile,
  triadOf,
} from '../src/tools/chord-progression/song';
import {
  type Chord,
  chordName,
  func,
  type Key,
  namedNext,
  roman,
  trans,
  voicing,
} from '../src/tools/chord-progression/theory';

const C: Key = { t: 0, m: 'maj' },
  D: Key = { t: 2, m: 'maj' },
  Am: Key = { t: 9, m: 'min' };
const ch = (d: number, q: Chord['q'] = 'M', inv = 0): Chord => ({ d, q, inv });
const song = (src: string, o: Partial<Song> = {}): Song => ({
  name: '',
  key: C,
  meter: 4,
  bpm: 120,
  style: 'pop',
  keys: 'pf',
  gtr: 'gtr',
  chords: parseChords(src),
  ...o,
});
const names = (s: Song): string[] => compute(s).entries.map((e) => chordName(e.ch, e.key));
const ALL_ON: Record<MemberId, boolean> = { drums: true, bass: true, keys: true, gtr: true, cho: true };

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
    expect(names(song('Bb6 Cm9 BbM9 FmM7 F7sus4 Bbadd9 Bbsus2 Adim7', { key: { t: 10, m: 'maj' } }))).toEqual([
      'B♭6',
      'Cm9',
      'B♭M9',
      'FmM7',
      'F7sus4',
      'B♭add9',
      'B♭sus2',
      'Adim7',
    ]);
    expect(voicing(ch(0, '9'), C)).toHaveLength(6);
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
});

describe('和音の地図', () => {
  it('上向きは長三和音、下向きは短三和音', () => {
    expect(triadOf({ i: 0, j: 0, up: true })).toEqual({ r: 0, q: 'M' });
    expect(triadOf({ i: 0, j: 0, up: false })).toEqual({ r: 4, q: 'm' });
    expect(triadOf({ i: 1, j: 0, up: true })).toEqual({ r: 7, q: 'M' });
    expect(triadOf({ i: -1, j: 0, up: false })).toEqual({ r: 9, q: 'm' });
  });
  it('どの長三和音・短三和音も 2 か所以上に出る', () => {
    for (const q of ['M', 'm'] as const)
      for (let r = 0; r < 12; r++)
        expect(
          ALL_PLACES.filter((p) => triadOf(p).r === r && triadOf(p).q === q).length,
          `${r}${q}`,
        ).toBeGreaterThanOrEqual(2);
  });
  it('隣の三角形は 2 音を共有し、どれも 3 つまで', () => {
    const tones = (p: (typeof ALL_PLACES)[number]) => {
      const t = triadOf(p),
        third = t.q === 'M' ? 4 : 3;
      return new Set([t.r, (t.r + third) % 12, (t.r + 7) % 12]);
    };
    for (const a of ALL_PLACES) {
      const ns = ALL_PLACES.filter((b) => adjacent(a, b));
      expect(ns.length).toBeLessThanOrEqual(3);
      for (const b of ns) {
        const ta = tones(a),
          shared = [...tones(b)].filter((x) => ta.has(x));
        expect(shared).toHaveLength(2);
        expect(b.up).toBe(!a.up);
      }
    }
  });
  it('C の隣は Am・Em・Cm（P・L・R）', () => {
    const c = { i: 0, j: 0, up: true },
      ns = ALL_PLACES.filter((b) => adjacent(c, b)).map((b) => {
        const t = triadOf(b);
        return `${t.r}${t.q}`;
      });
    expect(ns.sort()).toEqual(['0m', '4m', '9m'].sort());
  });
  it('置く場所は前の和音に近い所', () => {
    const c = nearestPlace(0, 'M', null);
    expect(inLattice(c)).toBe(true);
    const am = nearestPlace(9, 'm7', c);
    expect(adjacent(c, am)).toBe(true);
    expect(nearestPlace(7, '7', c).up).toBe(true);
    expect(nearestPlace(11, 'dim', c).up).toBe(false);
  });
});

describe('曲の計算', () => {
  it('拍子どおりの長さと小節', () => {
    const tl = compute(song('C G:2 Am:2 F'));
    expect(tl.entries.map((e) => e.beats)).toEqual([4, 2, 2, 4]);
    expect(tl.entries.map((e) => e.bar)).toEqual([1, 2, 2, 3]);
    expect(tl.beats).toBe(12);
    expect(tl.bars).toBe(3);
    const w = compute(song('F C7 F', { meter: 3 }));
    expect(w.entries.map((e) => e.beats)).toEqual([3, 3, 3]);
    expect(w.bars).toBe(3);
  });
  it('転調すると度数が変わり、つながりは −1', () => {
    const s = song('C G >D D A');
    const tl = compute(s);
    expect(tl.entries.map((e) => roman(e.ch, e.key))).toEqual(['Ⅰ', 'Ⅴ', 'Ⅰ', 'Ⅴ']);
    expect(tl.entries[2].tr?.lv).toBe(-1);
    expect(keyAt(s, 1)).toEqual(C);
    expect(keyAt(s, 3)).toEqual(D);
  });
  it('緊張はドミナントで高く、トニックで低い', () => {
    const tl = compute(song('C F G7 C'));
    const t = tl.entries.map((e) => e.tension);
    expect(t[2]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[0]);
    expect(t[3]).toBe(t[0]);
  });
  it('名前のある進行を見つける', () => {
    const tl = compute(song('C F G Em Am C'));
    expect(tl.entries.map((e) => e.grp?.n ?? null)).toEqual([
      null,
      '王道進行',
      '王道進行',
      '王道進行',
      '王道進行',
      null,
    ]);
    expect(compute(song('Am F G C', { key: Am })).entries[0].grp?.n).toBe('小室進行');
    const s = tl.entries.slice(0, 3).map((e) => ({ c: e.ch, key: e.key, i: e.k }));
    expect(namedNext(s).map((x) => x.n)).toContain('王道進行');
  });
});

describe('サンプルの記法', () => {
  it('調と和音', () => {
    expect(parseKey('F#m')).toEqual({ t: 6, m: 'min' });
    expect(parseKey('Bb')).toEqual({ t: 10, m: 'maj' });
    const cs = parseChords('C Am7:2 >Gm D7');
    expect(cs.map((c) => [c.r, c.q, c.b])).toEqual([
      [0, 'M', 0],
      [9, 'm7', 2],
      [2, '7', 0],
    ]);
    expect(cs[2].mod).toEqual({ t: 7, m: 'min' });
    expect(() => parseChords('Cx')).toThrow();
    expect(() => parseKey('H')).toThrow();
  });
});

describe('保存の形式', () => {
  it('書いて読むと同じ', () => {
    const s = song('Ebm Abm7:3 >F# Bb7 F#', {
      name: 'テスト',
      key: { t: 3, m: 'min' },
      meter: 3,
      bpm: 70,
      style: 'bossa',
      keys: 'str',
      gtr: 'cgt',
    });
    const back = fromFile(JSON.parse(JSON.stringify(toFile(s))));
    expect(back).not.toBeNull();
    expect(back && toFile(back)).toEqual(toFile(s));
  });
  it('形の違うものは読まない', () => {
    const ok = toFile(song('C G'));
    expect(fromFile(null)).toBeNull();
    expect(fromFile({ ...ok, v: 1 })).toBeNull();
    expect(fromFile({ ...ok, meter: 5 })).toBeNull();
    expect(fromFile({ ...ok, bpm: 999 })).toBeNull();
    expect(fromFile({ ...ok, style: 'hack' })).toBeNull();
    expect(fromFile({ ...ok, chords: [{ ...ok.chords[0], r: 12 }] })).toBeNull();
    expect(fromFile({ ...ok, chords: [{ ...ok.chords[0], q: 'X' }] })).toBeNull();
    expect(fromFile({ ...ok, chords: [{ ...ok.chords[0], i: 99 }] })).toBeNull();
    expect(fromFile({ ...ok, chords: [{ ...ok.chords[0], mod: { t: 0, m: 'dor' } }] })).toBeNull();
    expect(fromFile({ ...ok, name: 'x'.repeat(100) })?.name).toHaveLength(60);
    /* 外した音色のベルはビブラフォンで開く */
    expect(fromFile({ ...ok, keys: 'bell' })?.keys).toBe('vib');
    expect(fromFile({ ...ok, keys: 'xx' })).toBeNull();
  });
});

describe('バンド', () => {
  it('型の長さは 1 小節の歩の数', () => {
    for (const st of STYLE_ORDER)
      for (const m of [3, 4] as const)
        for (const [k, v] of Object.entries(STYLES[st][m]))
          if (typeof v === 'string' && v) expect(v.length, `${st} ${m} ${k}`).toBe(m * 4);
  });
  it('和音の頭で鍵盤とベースが鳴り、音は和音の中に収まる', () => {
    for (const st of STYLE_ORDER)
      for (const meter of [3, 4] as const) {
        const s = song('C G:2 Am:1 F', { style: st, meter }),
          { entries } = compute(s),
          spb = 60 / s.bpm / 4;
        for (const e of entries) {
          const ns = bandNotes(e, s, ALL_ON, spb),
            dur = e.beats * 4 * spb;
          expect(
            ns.some((n) => n.t === 0 && n.v === 'bass'),
            `${st} ${meter} ${e.k}`,
          ).toBe(true);
          expect(ns.some((n) => n.t < 0.02 && memberOf(n.v) === 'keys')).toBe(true);
          for (const n of ns) {
            expect(n.t).toBeGreaterThanOrEqual(0);
            expect(n.t).toBeLessThan(dur);
            expect(n.end).toBeGreaterThanOrEqual(n.t);
          }
        }
      }
  });
  it('ミュートしたメンバーは鳴らない', () => {
    const s = song('C'),
      e = compute(s).entries[0];
    for (const m of MEMBERS) {
      const ns = bandNotes(e, s, { ...ALL_ON, [m]: false }, 0.125);
      expect(ns.some((n) => memberOf(n.v) === m)).toBe(false);
      expect(ns.length).toBeGreaterThan(0);
    }
  });
  it('メトロノームは拍ごとに鳴り、小節の頭は高い音', () => {
    const s = song('C:2 G:4 Am:2'),
      es = compute(s).entries,
      clk = (k: number) => bandNotes(es[k], s, ALL_ON, 0.125, { met: true }).filter((n) => n.v === 'clk');
    expect(clk(0).map((n) => n.m)).toEqual([1760, 1180]);
    expect(clk(1).map((n) => n.m)).toEqual([1180, 1180, 1760, 1180]);
    expect(clk(1).map((n) => n.t)).toEqual([0, 0.5, 1, 1.5]);
    expect(bandNotes(es[0], s, ALL_ON, 0.125).some((n) => n.v === 'clk')).toBe(false);
    expect(memberOf('clk')).toBeNull();
  });
  it('コーラスは和音の間ずっと上の 3 声を伸ばす', () => {
    const s = song('C G:2'),
      es = compute(s).entries,
      cho = bandNotes(es[1], s, ALL_ON, 0.125).filter((n) => n.v === 'cho');
    expect(cho).toHaveLength(3);
    expect(cho.every((n) => n.t === 0 && n.end >= 1)).toBe(true);
  });
  it('くり返す前の 2 拍でフィル、頭へ戻るとクラッシュ', () => {
    const s = song('C F G C'),
      es = compute(s).entries,
      drums = (k: number, o = {}) => bandNotes(es[k], s, ALL_ON, 0.125, o).filter((n) => memberOf(n.v) === 'drums');
    const last = drums(3, { fillAt: 16 }),
      toms = last.filter((n) => n.v === 'tom');
    expect(toms.map((n) => n.m)).toEqual([220, 220, 160, 160, 115, 115]);
    expect(toms[0].t).toBeCloseTo(10 * 0.125);
    expect(last.some((n) => n.v === 'hat' && n.t >= 8 * 0.125)).toBe(false);
    expect(drums(2, { fillAt: 16 }).some((n) => n.v === 'tom')).toBe(false);
    expect(drums(3).some((n) => n.v === 'tom')).toBe(false);
    expect(drums(0, { crash: true })[0].v).toBe('crash');
    expect(memberOf('tom')).toBe('drums');
    expect(memberOf('cho')).toBe('cho');
  });
  it('転調の直前の 1 拍で弱いフィル', () => {
    const s = song('C G >D D A'),
      es = compute(s).entries,
      modAt = [es[2].start],
      sn = bandNotes(es[1], s, ALL_ON, 0.125, { modAt }).filter((n) => n.v === 'snare' && n.t >= 12 * 0.125);
    expect(sn.map((n) => n.vel)).toEqual([0.3, 0.42, 0.55, 0.7]);
    expect(
      bandNotes(es[1], s, ALL_ON, 0.125)
        .filter((n) => n.v === 'snare' && n.t >= 12 * 0.125)
        .map((n) => n.vel),
    ).toEqual([1]);
    expect(bandNotes(es[2], s, ALL_ON, 0.125, { modAt }).filter((n) => n.v === 'snare' && n.vel < 0.8)).toHaveLength(0);
  });
  it('音色の切り替えに従う', () => {
    const s = song('C', { keys: 'ep', gtr: 'cgt' }),
      ns = bandNotes(compute(s).entries[0], s, ALL_ON, 0.125);
    expect(ns.some((n) => n.v === 'ep')).toBe(true);
    expect(ns.some((n) => n.v === 'cgt')).toBe(true);
    expect(ns.some((n) => n.v === 'pf' || n.v === 'gtr')).toBe(false);
    expect(previewNotes(compute(s).entries[0], s).map((n) => n.v)).toEqual(['bass', 'ep', 'ep', 'ep', 'ep']);
  });
});

describe('サンプル', () => {
  it.each(SAMPLES.map((s) => [s.name, s.id]))('%s', (_n, id) => {
    const s = sampleSong(id),
      tl = compute(s);
    expect(tl.entries.length).toBeGreaterThan(0);
    for (const c of s.chords) expect(inLattice(c.at)).toBe(true);
    expect(fromFile(JSON.parse(JSON.stringify(toFile(s))))).not.toBeNull();
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
    ])
      expect(
        compute(sampleSong(id)).entries.some((e) => e.grp?.n === n),
        id,
      ).toBe(true);
  });
});

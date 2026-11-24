import { afterEach, describe, expect, it, vi } from 'vitest';
import { partsOf } from '../src/lib/midi-file';
import { OFF, ON, parseSmf, type SmfEv } from '../src/lib/smf';
import { analyze, chordsOf } from '../src/tools/chord-progression/analyze';
import type { CpAudio } from '../src/tools/chord-progression/audio';
import type { MemberId } from '../src/tools/chord-progression/band';
import { litAt, MidiPlay, midiSong } from '../src/tools/chord-progression/midi-play';
import { sampleSong } from '../src/tools/chord-progression/samples';
import type { Song } from '../src/tools/chord-progression/song';
import type { SynthAudio } from '../src/tools/fm-synthesizer/audio';
import { smfBytes } from './smf-bytes';

describe('鳴っている音', () => {
  it('拍 b に鳴っている音の音名ごとの量（いちばん多い音名が 1）', () => {
    const lit = litAt(
      [
        [
          { t: 0, d: 4, n: 60, v: 100 },
          { t: 0, d: 4, n: 72, v: 100 },
          { t: 0, d: 2, n: 64, v: 100 },
        ],
      ],
      3,
    );
    /* C は 2 つ鳴っていて、E は拍 2 で終わっている */
    expect(lit).toEqual([{ pc: 0, w: 1 }]);
  });
  it('足す音（バンドの和音）も数え、何も鳴っていなければ空', () => {
    expect(litAt([], 1, [62, 66, 69]).map((x) => x.pc)).toEqual([2, 6, 9]);
    expect(litAt([[{ t: 0, d: 1, n: 60, v: 90 }]], 2)).toEqual([]);
  });
});

/** 2 パート（チャンネル 0 の和音とチャンネル 1 のメロディ）と打楽器の 2 小節 */
function file() {
  const on = (ch: number, n: number) => [0x90 | ch, n, 100],
    off = (dt: number, ch: number, n: number) => [dt, 0x80 | ch, n, 0];
  const smf = parseSmf(
    smfBytes(1, 480, [
      [[0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20]],
      [
        [0, ...on(0, 60)],
        [0, ...on(0, 64)],
        [0, ...on(0, 67)],
        off(1920, 0, 60),
        [0, 0x80, 64, 0],
        [0, 0x80, 67, 0],
        [0, ...on(0, 65)],
        [0, ...on(0, 69)],
        [0, ...on(0, 72)],
        off(1920, 0, 65),
        [0, 0x80, 69, 0],
        [0, 0x80, 72, 0],
      ],
      [[0, ...on(1, 76)], off(3840, 1, 76)],
      [[0, ...on(9, 36)], off(480, 9, 36)],
    ]),
  );
  return midiSong('test', smf, partsOf(smf));
}

describe('MIDI ファイルの演奏', () => {
  const fake = () => {
    const a = { t: 0, notes: 0, ev: [] as SmfEv[] },
      audio = {
        now: () => a.t,
        ready: async () => true,
        bus: () => ({}) as GainNode,
        drop: () => {},
        release: () => {},
        hush: () => {},
        note: () => {
          a.notes++;
        },
      } as unknown as CpAudio,
      fm = {
        ready: async () => true,
        ev: (e: SmfEv) => a.ev.push(e),
        stop: () => {},
      } as unknown as SynthAudio;
    return { a, audio, fm };
  };
  const ALL: Record<MemberId, boolean> = { drums: true, bass: true, keys: true, gtr: true, cho: true };
  const songOf = (m: ReturnType<typeof file>, use: Set<string>): Song => {
    const notes = m.parts.filter((p) => use.has(p.id)).flatMap((p) => p.notes),
      { key, chords } = chordsOf(analyze(notes, m.smf.starts, m.smf.end));
    return { ...sampleSong('canon'), key, chords };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('原曲は全パートを鳴らし、バンドは鳴らさない', async () => {
    vi.stubGlobal('document', { hidden: false });
    const m = file(),
      use = new Set(['1:0']),
      song = songOf(m, use),
      { a, audio, fm } = fake(),
      p = new MidiPlay(audio, fm, () => ({
        m,
        song,
        band: false,
        use,
        mute: new Set<string>(),
        on: ALL,
        loop: false,
        met: false,
      }));
    expect(song.chords.map((c) => [c.r, c.q, c.b])).toEqual([
      [0, 'M', 4],
      [5, 'M', 4],
    ]);
    expect(await p.start(0)).toBe(true);
    a.t = 10;
    p.tick();
    const ons = a.ev.filter((e) => e.k === ON);
    expect(new Set(ons.map((e) => e.ch))).toEqual(new Set([0, 1, 9]));
    expect(a.notes).toBe(0);
    p.halt();
  });

  it('バンドでは解析に使ったパートと打楽器を止め、外したパートだけ原曲で鳴らす', async () => {
    vi.stubGlobal('document', { hidden: false });
    const m = file(),
      use = new Set(['1:0']),
      song = songOf(m, use),
      { a, audio, fm } = fake(),
      p = new MidiPlay(audio, fm, () => ({
        m,
        song,
        band: true,
        use,
        mute: new Set<string>(),
        on: ALL,
        loop: false,
        met: false,
      }));
    expect(await p.start(0)).toBe(true);
    a.t = 10;
    p.tick();
    expect(a.ev.filter((e) => e.k === ON).map((e) => e.ch)).toEqual([1]);
    expect(a.notes).toBeGreaterThan(0);
    p.halt();
  });

  it('途中から弾くと、伸ばしている音はその拍から鳴らし、拍は TempoMap で進む', async () => {
    vi.stubGlobal('document', { hidden: false });
    const m = file(),
      use = new Set(['1:0']),
      song = songOf(m, use),
      { a, audio, fm } = fake(),
      p = new MidiPlay(audio, fm, () => ({
        m,
        song,
        band: false,
        use,
        mute: new Set<string>(),
        on: ALL,
        loop: false,
        met: false,
      }));
    expect(await p.start(6)).toBe(true);
    const ons = a.ev.filter((e) => e.k === ON);
    /* 2 小節目の F の和音と、頭から伸びているメロディ（E） */
    expect(ons.map((e) => e.a).sort()).toEqual([65, 69, 72, 76]);
    /* テンポは 120（0.5 秒で 1 拍） */
    a.t = 0.08 + 0.5;
    expect(p.beat()).toBeCloseTo(7, 5);
    p.halt();
    expect(p.beat()).toBeNull();
  });
});

describe('MIDI ファイルのミュート', () => {
  it('ミュートしたパートは鳴らさず、演奏中にミュートすると鳴っている音を離す', async () => {
    vi.stubGlobal('document', { hidden: false });
    const m = file(),
      use = new Set(['1:0']),
      notes = m.parts.filter((p) => use.has(p.id)).flatMap((p) => p.notes),
      { key, chords } = chordsOf(analyze(notes, m.smf.starts, m.smf.end)),
      song: Song = { ...sampleSong('canon'), key, chords },
      a = { t: 0, ev: [] as SmfEv[] },
      audio = {
        now: () => a.t,
        ready: async () => true,
        bus: () => ({}) as GainNode,
        drop: () => {},
        release: () => {},
        hush: () => {},
        note: () => {},
      } as unknown as CpAudio,
      fm = { ready: async () => true, ev: (e: SmfEv) => a.ev.push(e), stop: () => {} } as unknown as SynthAudio,
      mute = new Set<string>(),
      p = new MidiPlay(audio, fm, () => ({
        m,
        song,
        band: false,
        use,
        mute,
        on: { drums: true, bass: true, keys: true, gtr: true, cho: true },
        loop: false,
        met: false,
      }));
    expect(await p.start(0)).toBe(true);
    for (; a.t < 0.6; a.t += 0.025) p.tick();
    /* メロディ（チャンネル 1 の E5）を鳴らしている最中にミュートする */
    a.ev = [];
    mute.add('2:1');
    p.refilter();
    expect(a.ev).toContainEqual({ k: OFF, ch: 1, a: 76, v: 0 });
    for (; a.t < 2.5; a.t += 0.025) p.tick();
    expect(a.ev.filter((e) => e.k === ON).every((e) => e.ch !== 1)).toBe(true);
    p.halt();
  });
});

describe('MIDI ファイルのメトロノーム', () => {
  it('原曲でもメトロノームを鳴らし、演奏中に入れるとすぐ効く', async () => {
    vi.stubGlobal('document', { hidden: false });
    const m = file(),
      use = new Set(['1:0']),
      notes = m.parts.filter((p) => use.has(p.id)).flatMap((p) => p.notes),
      { key, chords } = chordsOf(analyze(notes, m.smf.starts, m.smf.end)),
      song: Song = { ...sampleSong('canon'), key, chords },
      a = { t: 0, clk: 0 },
      audio = {
        now: () => a.t,
        ready: async () => true,
        bus: () => ({}) as GainNode,
        drop: () => {},
        release: () => {},
        hush: () => {},
        note: (x: { v: string }) => {
          if (x.v === 'clk') a.clk++;
        },
      } as unknown as CpAudio,
      fm = { ready: async () => true, ev: () => {}, stop: () => {} } as unknown as SynthAudio,
      ctx = {
        m,
        song,
        band: false,
        use,
        mute: new Set<string>(),
        on: { drums: true, bass: true, keys: true, gtr: true, cho: true },
        loop: false,
        met: false,
      },
      p = new MidiPlay(audio, fm, () => ctx);
    expect(await p.start(0)).toBe(true);
    /* 予約は 25 ms ごと（時刻を飛ばすと、画面が隠れていたとみなして曲の時刻をずらす） */
    for (; a.t < 0.6; a.t += 0.025) p.tick();
    expect(a.clk).toBe(0);
    /* 拍 1 の少しあと（0.6 s）で入れると、同じ和音の残りの拍から鳴る */
    ctx.met = true;
    p.rebar();
    /* 拍 2・3 と、次の和音の頭（拍 4、2.08 s）まで */
    for (; a.t < 2.2; a.t += 0.025) p.tick();
    expect(a.clk).toBe(3);
    p.halt();
  });
});

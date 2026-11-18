/**
 * コード進行のページのバンド: スタイルごとの 16 分音符の型（4 拍子は 16 歩、3 拍子は 12 歩で 1 小節）で、
 * ドラム・ベース・鍵盤・ギターの音を和音ごとに並べ、演奏の順に鳴る直前に予約する。
 * 型の文字: x は打つ・. は休み・g は小さく打つ（ゴーストノート）・o はハイハットを開いて打つ。
 * ベースの 1 は根音、3 は 3 度、5 は 5 度、6 は長 6 度、7 は 7 度（なければ短 7 度）、8 はオクターブ上
 */
import { lookahead } from '../../lib/pause';
import type { CpAudio, NoteEv, Voice } from './audio';
import { compute, type Entry, type Meter, type Song, type StyleId } from './song';
import { QUALS, voicing } from './theory';

export type MemberId = 'drums' | 'bass' | 'keys' | 'gtr' | 'cho';
export const MEMBERS: readonly MemberId[] = ['drums', 'bass', 'keys', 'gtr', 'cho'];
export const MEMBER_NAMES: Record<MemberId, string> = {
  drums: 'ドラム',
  bass: 'ベース',
  keys: '鍵盤',
  gtr: 'ギター',
  cho: 'コーラス',
};

interface Pat {
  k: string;
  s: string;
  h: string;
  r?: string;
  b: string;
  c: string;
  g: string;
  /** 鍵盤の 1 打の長さ（歩） */
  cl: number;
  /** 跳ねる（拍の裏の 8 分を 3 連符の 3 つ目へ遅らせる） */
  sw?: boolean;
}
/* 4 拍子は 16 歩、3 拍子は 12 歩で 1 小節 */
export const STYLES: Record<StyleId, Record<Meter, Pat>> = {
  pop: {
    4: {
      k: 'x.......x.x.....',
      s: '....x.......x...',
      h: 'x.x.x.x.x.x.x.x.',
      b: '1...1...5...1.1.',
      c: 'x.....x...x.....',
      g: '..x...x...x...x.',
      cl: 2,
    },
    3: {
      k: 'x...........',
      s: '....x...x...',
      h: 'x.x.x.x.x.x.',
      b: '1.......5...',
      c: '....x...x...',
      g: 'x...x...x...',
      cl: 2,
    },
  },
  rock: {
    4: {
      k: 'x.....x.x.......',
      s: '....x.......x...',
      h: 'xxxxxxxxxxxxxxxx',
      b: '1.1.1.1.1.1.1.1.',
      c: 'x...............',
      g: 'x.x.x.x.x.x.x.x.',
      cl: 16,
    },
    3: {
      k: 'x.....x.....',
      s: '....x.......',
      h: 'xxxxxxxxxxxx',
      b: '1.1.1.1.1.1.',
      c: 'x...........',
      g: 'x.x.x.x.x.x.',
      cl: 12,
    },
  },
  ballad: {
    4: {
      k: 'x.......x.......',
      s: '........x.......',
      h: 'x...x...x...x...',
      b: '1.......5.......',
      c: 'x.......x.......',
      g: 'x...x...x...x...',
      cl: 8,
    },
    3: {
      k: 'x...........',
      s: '........x...',
      h: 'x...x...x...',
      b: '1.......5...',
      c: 'x...........',
      g: 'x...x...x...',
      cl: 12,
    },
  },
  funk: {
    4: {
      k: 'x..x......x..x..',
      s: '....x..g.g..x..g',
      h: 'xxxxxxxxxxxxxxxx',
      b: '1..1...8..1.5.8.',
      c: '..x..x....x..x..',
      g: 'x.xxx.xxx.xxx.xx',
      cl: 1,
    },
    3: {
      k: 'x..x......x.',
      s: '....x..g.g..',
      h: 'xxxxxxxxxxxx',
      b: '1..1...8..5.',
      c: '..x..x....x.',
      g: 'x.xxx.xxx.xx',
      cl: 1,
    },
  },
  disco: {
    4: {
      k: 'x...x...x...x...',
      s: '....x.......x...',
      h: '..o...o...o...o.',
      b: '1.8.1.8.1.8.1.8.',
      c: '....x.......x...',
      g: 'x.x.x.x.x.x.x.x.',
      cl: 2,
    },
    3: {
      k: 'x...x...x...',
      s: '....x...x...',
      h: '..o...o...o.',
      b: '1.8.1.8.1.8.',
      c: '....x...x...',
      g: 'x.x.x.x.x.x.',
      cl: 2,
    },
  },
  reggae: {
    4: {
      k: '........x.......',
      s: '........x.......',
      h: 'x.x.x.x.x.x.x.x.',
      b: '1.....5.1...5...',
      c: '..x...x...x...x.',
      g: '..x...x...x...x.',
      cl: 1,
    },
    3: {
      k: '........x...',
      s: '........x...',
      h: 'x.x.x.x.x.x.',
      b: '1.....5.1...',
      c: '..x...x...x.',
      g: '..x...x...x.',
      cl: 1,
    },
  },
  shuffle: {
    4: {
      k: 'x.......x.......',
      s: '....x.......x...',
      h: 'x.x.x.x.x.x.x.x.',
      b: '1.3.5.6.8.6.5.3.',
      c: '....x.......x...',
      g: 'x.x.x.x.x.x.x.x.',
      cl: 2,
      sw: true,
    },
    3: {
      k: 'x...........',
      s: '....x...x...',
      h: 'x.x.x.x.x.x.',
      b: '1.3.5.6.5.3.',
      c: '....x...x...',
      g: 'x.x.x.x.x.x.',
      cl: 2,
      sw: true,
    },
  },
  jazz: {
    4: {
      k: 'x...............',
      s: '....g.......g...',
      h: 'x...x.x.x...x.x.',
      b: '1...3...5...6...',
      c: '......x.....x...',
      g: 'x...x...x...x...',
      cl: 2,
      sw: true,
    },
    3: {
      k: 'x...........',
      s: '....g...g...',
      h: 'x...x.x.x.x.',
      b: '1...3...5...',
      c: '....x.....x.',
      g: 'x...x...x...',
      cl: 2,
      sw: true,
    },
  },
  bossa: {
    4: {
      k: 'x..x..x.x..x..x.',
      s: '',
      r: 'x..x..x...x..x..',
      h: 'x.x.x.x.x.x.x.x.',
      b: '1..5..5.1..5..5.',
      c: 'x..x..x...x..x..',
      g: '',
      cl: 2,
    },
    3: {
      k: 'x..x..x.....',
      s: '',
      r: 'x..x....x...',
      h: 'x.x.x.x.x.x.',
      b: '1..5..5.....',
      c: 'x..x....x...',
      g: '',
      cl: 2,
    },
  },
  samba: {
    4: {
      k: 'x..xx..xx..xx..x',
      s: '',
      r: 'x.x..x.x.x..x.x.',
      h: 'xxxxxxxxxxxxxxxx',
      b: '1..5.1.51..5.1.5',
      c: 'x.x..x.x.x..x.x.',
      g: '',
      cl: 1,
    },
    3: {
      k: 'x..xx..xx..x',
      s: '',
      r: 'x.x..x.x.x..',
      h: 'xxxxxxxxxxxx',
      b: '1..5.1.51..5',
      c: 'x.x..x.x.x..',
      g: '',
      cl: 1,
    },
  },
};
const MEMBER_OF: Partial<Record<Voice, MemberId>> = {
  kick: 'drums',
  snare: 'drums',
  hat: 'drums',
  rim: 'drums',
  tom: 'drums',
  crash: 'drums',
  bass: 'bass',
  cho: 'cho',
};
/** 音を弾くメンバー（メトロノームはどのメンバーでもない） */
export const memberOf = (v: Voice): MemberId | null =>
  v === 'clk' ? null : (MEMBER_OF[v] ?? (v === 'gtr' || v === 'cgt' ? 'gtr' : 'keys'));

/**
 * 和音 1 つ分の音。t・end は和音の頭からの秒。spb は 16 分音符 1 つの秒。
 * 和音の頭が小節の途中でも、型は小節の頭から数える。和音の頭に鍵盤とベースの音がなければ足す（和音が変わったのが聞こえるように）。
 * コーラスは和音の間ずっと上の 3 声を伸ばす
 */
export interface BandOpt {
  /** メトロノームを拍ごとに鳴らす（小節の頭は高い音） */
  met?: boolean;
  /** 曲の長さ [拍]。あれば曲の終わりの 2 拍でドラムがフィルを叩く（くり返して頭へ戻る前） */
  fillAt?: number;
  /** 和音の頭でクラッシュシンバル（くり返して頭へ戻った所） */
  crash?: boolean;
  /** 転調する和音の頭 [拍]。その直前の 1 拍でドラムが弱いフィルを叩く */
  modAt?: readonly number[];
}
/** フィルの 8 歩（2 拍）: スネア 2 つのあと、高いタムから低いタムへ。数字はタムの周波数 [Hz] */
const FILL: readonly (readonly ['snare' | 'tom', number, number])[] = [
  ['snare', 0, 1],
  ['snare', 0, 0.5],
  ['tom', 220, 0.9],
  ['tom', 220, 0.7],
  ['tom', 160, 0.9],
  ['tom', 160, 0.7],
  ['tom', 115, 1],
  ['tom', 115, 0.8],
];
/** 転調の前の弱いフィルの 4 歩（1 拍）: だんだん強くなるスネア */
const SOFT_FILL: readonly number[] = [0.3, 0.42, 0.55, 0.7];
export function bandNotes(
  e: Entry,
  song: Song,
  on: Record<MemberId, boolean>,
  spb: number,
  opt: BandOpt = {},
): NoteEv[] {
  const P = STYLES[song.style][song.meter],
    bar = song.meter * 4,
    tones = voicing(e.ch, e.key),
    up = tones.slice(1),
    steps = e.beats * 4,
    dur = e.beats * 4 * spb,
    out: NoteEv[] = [];
  const iv = QUALS[e.ch.q].iv,
    /* ベースの数字から根音からの半音の数 */
    BASS: Record<string, number> = { 1: 0, 3: iv[1], 5: iv[2], 6: 9, 7: iv[3] ?? 10, 8: 12 },
    chAt = (s: number, ch: string | undefined) => ch?.[(e.start * 4 + s) % bar] ?? '.',
    at = (s: number, ch: string | undefined) => chAt(s, ch) !== '.',
    VEL: Record<string, number> = { x: 1, g: 0.35, o: 0.8 };
  /* フィルは曲が 2 小節以上あるときだけ、最後の 8 歩 */
  const fill0 = opt.fillAt && opt.fillAt >= song.meter * 2 ? opt.fillAt * 4 - FILL.length : Number.POSITIVE_INFINITY;
  if (on.drums && opt.crash) out.push({ t: 0, m: 0, v: 'crash', end: 0, vel: 1 });
  if (on.cho)
    up.slice(0, 3).forEach((m) => {
      out.push({ t: 0, m, v: 'cho', end: dur + 0.05, vel: 0.5 });
    });
  for (let s = 0; s < steps; s++) {
    const g = (e.start * 4 + s) % bar,
      /* 跳ねるスタイルは拍の裏の 8 分を 3 連符の 3 つ目へ */
      t = (s + (P.sw && g % 4 === 2 ? 2 / 3 : 0)) * spb,
      fj = e.start * 4 + s - fill0,
      /* 転調の頭までの歩の数（1〜4 なら弱いフィルの中） */
      mj = (opt.modAt ?? []).map((b) => b * 4 - (e.start * 4 + s)).find((d) => d >= 1 && d <= SOFT_FILL.length);
    if (on.drums && fj >= 0) {
      const [v, m, vel] = FILL[fj];
      out.push({ t, m, v, end: t, vel });
      if (fj % 4 === 0) out.push({ t, m: 0, v: 'kick', end: t, vel: 0.8 });
    } else if (on.drums && mj !== undefined) {
      out.push({ t, m: 0, v: 'snare', end: t, vel: SOFT_FILL[SOFT_FILL.length - mj] });
      if (mj === SOFT_FILL.length) out.push({ t, m: 0, v: 'kick', end: t, vel: 0.7 });
    } else if (on.drums) {
      if (at(s, P.k)) out.push({ t, m: 0, v: 'kick', end: t, vel: VEL[chAt(s, P.k)] ?? 1 });
      if (at(s, P.s)) out.push({ t, m: 0, v: 'snare', end: t, vel: VEL[chAt(s, P.s)] ?? 1 });
      if (at(s, P.r)) out.push({ t, m: 0, v: 'rim', end: t, vel: 1 });
      if (at(s, P.h)) {
        const open = chAt(s, P.h) === 'o';
        out.push({ t, m: 0, v: 'hat', end: open ? t + 0.2 : t, vel: open ? 0.8 : g % 4 === 0 ? 1 : 0.6 });
      }
    }
    const b = P.b[g];
    if (on.bass && ((b && b !== '.') || (s === 0 && b === '.'))) {
      const m = tones[0] - 12 + (BASS[b] ?? 0);
      out.push({ t, m, v: 'bass', end: Math.min(dur, t + 4 * spb), vel: 0.9 });
    }
    if (on.keys && (at(s, P.c) || (s === 0 && !at(0, P.c))))
      up.forEach((m, k) => {
        out.push({ t: t + k * 0.006, m, v: song.keys, end: Math.min(dur + 0.04, t + P.cl * spb), vel: 0.6 });
      });
    if (on.gtr && at(s, P.g))
      up.forEach((m, k) => {
        out.push({
          t: t + k * 0.009,
          m: m - 12,
          v: song.gtr,
          end: Math.min(dur + 0.04, t + 3 * spb),
          vel: 0.55,
          tones: up.map((x) => x - 12),
        });
      });
  }
  if (opt.met)
    for (let k = 0; k < e.beats; k++)
      out.push({
        t: k * 4 * spb,
        m: (e.start + k) % song.meter === 0 ? 1760 : 1180,
        v: 'clk',
        end: k * 4 * spb,
        vel: 1,
      });
  return out.sort((a, b) => a.t - b.t);
}

/** 予約した和音 */
export interface Occ {
  k: number;
  id: number;
  e: Entry;
  /** 鳴り始め（AudioContext の時刻） */
  at: number;
  dur: number;
  bus: GainNode;
  pending: NoteEv[];
}
/** 先に予約する時間 [s] */
const AHEAD = 0.25;

/** 曲の演奏。最後まで弾いたら、くり返しなら頭へ戻る */
export class Player {
  occ: Occ[] = [];
  private next = 0;
  private nextAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private done = false;
  onEnd: (() => void) | null = null;
  /** 音を鳴らした（バンドのメンバーの絵を動かす）。at は AudioContext の時刻 */
  onHit: ((m: MemberId, at: number) => void) | null = null;

  constructor(
    private readonly audio: CpAudio,
    private readonly ctx: () => { song: Song; on: Record<MemberId, boolean>; loop: boolean; met: boolean },
  ) {}

  get playing(): boolean {
    return this.timer !== undefined;
  }
  /** k 番目の和音から弾く。鳴らせなければ false */
  async start(k: number): Promise<boolean> {
    this.halt();
    if (!this.ctx().song.chords.length || !(await this.audio.ready())) return false;
    this.restart(k, (this.audio.now() ?? 0) + 0.06);
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
    return true;
  }
  /** 演奏中に k 番目の和音から弾き直す */
  jump(k: number): void {
    if (!this.playing) return;
    for (const o of this.occ) this.audio.drop(o.bus);
    this.audio.hush();
    this.occ = [];
    this.restart(k, (this.audio.now() ?? 0) + 0.04);
    this.tick();
  }
  /** 編集した: 鳴っている和音はそのまま、次の和音から並べ直す */
  resync(): void {
    if (!this.playing) return;
    const now = this.audio.now() ?? 0,
      cur = this.current(),
      later = this.occ.filter((o) => o.at > now + 0.005);
    for (const o of later) this.audio.drop(o.bus);
    this.occ = this.occ.filter((o) => !later.includes(o));
    const { song } = this.ctx();
    if (cur) {
      const ix = song.chords.findIndex((c) => c.id === cur.id);
      this.restart(ix >= 0 ? ix + 1 : cur.k, Math.max(now, cur.at + cur.dur));
    } else this.restart(0, now + 0.04);
  }
  private restart(k: number, at: number): void {
    this.next = k;
    this.nextAt = at;
    this.done = false;
  }
  /** 鳴っている和音 */
  current(): Occ | null {
    const now = this.audio.now();
    if (now === null) return null;
    let c: Occ | null = null;
    for (const o of this.occ) if (o.at <= now + 0.001) c = o;
    return c;
  }
  /** 先の音を予約する。止めている間は何もしない（画面が隠れたときにも呼ばれる） */
  tick(): void {
    const now = this.audio.now();
    if (now === null || !this.playing) return;
    if (this.nextAt < now - 0.1) this.nextAt = now + 0.02;
    const { song, on, loop, met } = this.ctx(),
      { entries, beats: total } = compute(song),
      modAt = entries.filter((x) => x.k > 0 && x.c.mod).map((x) => x.start),
      spb = 60 / song.bpm / 4,
      horizon = now + lookahead(AHEAD);
    while (!this.done && this.nextAt < horizon) {
      let wrapped = false;
      if (this.next >= entries.length) {
        if (!loop || !entries.length) {
          this.done = true;
          break;
        }
        this.next = 0;
        wrapped = true;
      }
      const e = entries[this.next],
        bus = this.audio.bus();
      if (!bus) return;
      const dur = e.beats * 4 * spb;
      this.occ.push({
        k: this.next,
        id: e.c.id,
        e,
        at: this.nextAt,
        dur,
        bus,
        pending: bandNotes(e, song, on, spb, { met, fillAt: loop ? total : undefined, crash: wrapped, modAt }),
      });
      this.nextAt += dur;
      this.next++;
    }
    for (const o of this.occ)
      while (o.pending.length && o.at + o.pending[0].t < horizon) {
        const x = o.pending.shift() as NoteEv;
        this.audio.note(x, o.at + x.t, o.at + x.end, o.bus);
        const m = memberOf(x.v);
        if (m) this.onHit?.(m, o.at + x.t);
      }
    while (this.occ.length > 1 && this.occ[1].at + 3 < now) this.occ.shift();
    if (this.done && now >= this.nextAt) {
      this.halt();
      this.onEnd?.();
    }
  }
  /** 演奏を止める。予約していない音は捨て、鳴っている音は鍵を離すように消す（ギターの弦は鳴らしたまま）。fade なら全部消す */
  halt(fade = false): void {
    clearInterval(this.timer);
    this.timer = undefined;
    const now = this.audio.now() ?? 0;
    for (const o of this.occ) {
      o.pending = [];
      if (fade || o.at > now) this.audio.drop(o.bus);
      else this.audio.release(o.bus);
    }
    if (fade) this.audio.hush();
    this.occ = [];
  }
}

/** 1 つの和音を今すぐ鳴らす（地図や駅を押したときの試聴）: 鍵盤とベースで 1 拍半 */
export function previewNotes(e: Entry, song: Song): NoteEv[] {
  const tones = voicing(e.ch, e.key),
    up = tones.slice(1);
  return [
    { t: 0, m: tones[0] - 12, v: 'bass', end: 0.7, vel: 0.85 },
    ...up.map((m, k): NoteEv => ({ t: k * 0.012, m, v: song.keys, end: 0.9, vel: 0.6 })),
  ];
}

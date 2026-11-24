/**
 * コード進行のページで MIDI ファイルを演奏する: 原曲の音は FMシンセサイザの GM 音源で、バンドは推したコード進行で鳴らす。
 * 2 つを同じ AudioContext の時刻で予約し、テンポの変化（lib/tempo.ts）にも合わせる。
 * 「原曲」では全パートを鳴らし、「バンド」では解析に使ったパートと打楽器を止めて、解析で外したパート（メロディなど）だけを残す
 */
import type { FilePart, FNote } from '../../lib/midi-file';
import { lookahead } from '../../lib/pause';
import { CC, OFF, ON, PC, type Smf, type SmfEv } from '../../lib/smf';
import { TempoMap } from '../../lib/tempo';
import type { SynthAudio } from '../fm-synthesizer/audio';
import { GM_NAMES } from '../fm-synthesizer/gm';
import type { CpAudio, NoteEv } from './audio';
import { bandNotes, type MemberId, memberOf } from './band';
import { ICON } from './icons';
import { compute, type Entry, type Song } from './song';
import { voicing } from './theory';

/** 開いた MIDI ファイル */
export interface MidiSong {
  name: string;
  smf: Smf;
  parts: FilePart[];
  tm: TempoMap;
  /** パートの id（`${tr}:${ch}`）ごとの音（開始の順） */
  notes: Map<string, FNote[]>;
}

export function midiSong(name: string, smf: Smf, parts: FilePart[]): MidiSong {
  return { name, smf, parts, tm: new TempoMap(smf.tempo), notes: new Map(parts.map((p) => [p.id, p.notes])) };
}

/** パートの最初のプログラムチェンジ（なければ 0）。パートの id は `${tr}:${ch}` */
export function progsOf(smf: Smf): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of smf.ev) if (e.k === PC && !out.has(`${e.tr}:${e.ch}`)) out.set(`${e.tr}:${e.ch}`, e.a);
  return out;
}
/** パートの音色の名前（GM。打楽器はパーカッション） */
export const voiceName = (drum: boolean, prog: number): string => (drum ? 'パーカッション' : (GM_NAMES[prog] ?? ''));
/**
 * パートのアイコン: GM の音色の系統（8 音色ずつ）から、このページの楽器のアイコンを選ぶ。
 * 系統に合うアイコンがなければ近いもの（シンセや効果音はシンセパッド）
 */
export function partIcon(drum: boolean, prog: number): string {
  if (drum) return ICON.drums;
  if (prog === 24) return ICON.cgt;
  if (prog === 46) return ICON.harp;
  if (prog >= 52 && prog <= 54) return ICON.cho;
  if (prog === 12 || prog === 13) return ICON.mar;
  const fam = [
    ICON.pf,
    ICON.vib,
    ICON.org,
    ICON.gtr,
    ICON.ebass,
    ICON.str,
    ICON.str,
    ICON.brs,
    ICON.wind,
    ICON.wind,
    ICON.pad,
    ICON.pad,
    ICON.pad,
    ICON.gtr,
    ICON.drums,
    ICON.pad,
  ];
  if (prog === 4 || prog === 5) return ICON.ep;
  return fam[prog >> 3] ?? ICON.pf;
}
/** 拍 b に鳴っているか */
export function soundingAt(notes: readonly FNote[], b: number): boolean {
  for (const x of notes) {
    if (x.t > b) break;
    if (x.t + x.d > b) return true;
  }
  return false;
}

/** 鳴っている音の音名と、その量（いちばん多い音名を 1 とする） */
export interface Lit {
  pc: number;
  w: number;
}
/**
 * 拍 b に鳴っている音の音名ごとの量。量はベロシティの和で、鳴り始めの音は少し強く見る（すぐ薄れる）。
 * extra は音名をそのまま足す（バンドの和音の音）
 */
export function litAt(groups: readonly (readonly FNote[])[], b: number, extra: readonly number[] = []): Lit[] {
  const w = new Array<number>(12).fill(0);
  for (const notes of groups)
    for (const x of notes) {
      if (x.t > b) break;
      if (x.t + x.d <= b) continue;
      w[x.n % 12] += (x.v / 127) * (0.6 + 0.4 * Math.exp(-(b - x.t) * 3));
    }
  for (const n of extra) w[((n % 12) + 12) % 12] += 0.8;
  const max = Math.max(...w);
  if (max <= 0) return [];
  return w.flatMap((v, pc) => (v > max * 0.08 ? [{ pc, w: v / max }] : []));
}

/** 先に予約する時間 [s] */
const AHEAD = 0.25;
/** 予約したバンドの和音 */
interface Occ {
  at: number;
  bus: GainNode;
  pending: NoteEv[];
}
export interface MidiCtx {
  m: MidiSong;
  song: Song;
  /** バンドで鳴らすか（false は原曲） */
  band: boolean;
  /** 解析に使うパート */
  use: ReadonlySet<string>;
  /** ミュートしたパート */
  mute: ReadonlySet<string>;
  on: Record<MemberId, boolean>;
  loop: boolean;
  met: boolean;
}
const NO_MEMBER: Record<MemberId, boolean> = { drums: false, bass: false, keys: false, gtr: false, cho: false };
/** 原曲で鳴らさない出来事（音の始まり）か: ミュートしたパートと、バンドのときの解析に使ったパートと打楽器 */
const dropped = (c: MidiCtx, e: SmfEv): boolean => {
  const id = `${e.tr}:${e.ch}`;
  return c.mute.has(id) || (c.band && (e.ch === 9 || c.use.has(id)));
};

/** MIDI ファイルの演奏。最後まで弾いたら、くり返しなら頭へ戻る */
export class MidiPlay {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** 拍 tau0（標準のテンポでの拍）を鳴らす AudioContext の時刻 */
  private at0 = 0;
  private tau0 = 0;
  private ev: SmfEv[] = [];
  private i = 0;
  private entries: Entry[] = [];
  private nextE = 0;
  private occ: Occ[] = [];
  onEnd: (() => void) | null = null;
  onHit: ((m: MemberId, at: number) => void) | null = null;

  constructor(
    private readonly audio: CpAudio,
    private readonly fm: SynthAudio,
    private readonly ctx: () => MidiCtx,
  ) {}

  get playing(): boolean {
    return this.timer !== undefined;
  }
  /** 1 拍（4 分音符）の秒数（ファイルの最初のテンポで） */
  private spq(): number {
    return 60 / this.ctx().m.smf.bpm;
  }
  private atOf(b: number): number {
    return this.at0 + (this.ctx().m.tm.tau(b) - this.tau0) * this.spq();
  }
  /** 鳴っている拍（止めている間は null） */
  beat(): number | null {
    const now = this.audio.now();
    if (now === null || !this.playing) return null;
    return this.ctx().m.tm.beat(this.tau0 + Math.max(0, now - this.at0) / this.spq());
  }
  /** 拍 b から弾く。鳴らせなければ false */
  async start(b: number): Promise<boolean> {
    this.halt();
    if (!(await this.audio.ready()) || !(await this.fm.ready())) return false;
    this.restart(b, (this.audio.now() ?? 0) + 0.08);
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
    return true;
  }
  /** 演奏中に拍 b から弾き直す（原曲とバンドの切り替え・位置の移動） */
  jump(b: number): void {
    if (!this.playing) return;
    this.silence(true);
    this.restart(b, (this.audio.now() ?? 0) + 0.05);
    this.tick();
  }
  /**
   * バンドとメトロノームだけを今の拍から並べ直す（メトロノームやメンバーの切り替えをすぐ効かせる）。
   * 原曲の音はそのまま。鳴っている和音のバンドの音は鍵を離すように消し、今より後ろの音から鳴らし直す
   */
  rebar(): void {
    const b = this.beat();
    if (b === null) return;
    const now = this.audio.now() ?? 0;
    for (const o of this.occ) {
      o.pending = [];
      if (o.at > now) this.audio.drop(o.bus);
      else this.audio.release(o.bus);
    }
    this.occ = [];
    const k = this.entries.findIndex((e) => e.start + e.beats > b + 1e-6);
    this.nextE = k < 0 ? this.entries.length : k;
    this.from = b;
    this.tick();
  }
  /**
   * 鳴らすパートを変えた（ミュート・原曲とバンドの切り替え）: 止めたパートの鳴っている音を離し、バンドを今の拍から並べ直す。
   * 鳴らし始めたパートは次の音から鳴る
   */
  refilter(): void {
    const b = this.beat();
    if (b === null) return;
    const c = this.ctx();
    for (const p of c.m.parts)
      for (const x of p.notes) {
        if (x.t > b) break;
        if (x.t + x.d > b && dropped(c, { b, tr: p.tr, ch: p.ch, k: ON, a: x.n, v: x.v }))
          this.fm.ev({ k: OFF, ch: p.ch, a: x.n, v: 0 }, 0, 0);
      }
    this.rebar();
  }
  /** 鳴っている音を消し、予約を捨てる。fade なら全部すぐ消す */
  private silence(fade: boolean): void {
    this.fm.stop();
    const now = this.audio.now() ?? 0;
    for (const o of this.occ) {
      o.pending = [];
      if (fade || o.at > now) this.audio.drop(o.bus);
      else this.audio.release(o.bus);
    }
    if (fade) this.audio.hush();
    this.occ = [];
  }
  private restart(b: number, at: number): void {
    const c = this.ctx(),
      { m, song } = c,
      rest: SmfEv[] = [],
      open = new Map<string, SmfEv>();
    /* 弾き始める拍より前の音色とコントローラはすぐ送り、伸ばしている音はその拍から弾く */
    for (let ch = 0; ch < 16; ch++) this.fm.ev({ k: CC, ch, a: 121, v: 0 }, 0, 0);
    for (const e of m.smf.ev) {
      const key = `${e.tr}:${e.ch}:${e.a}`;
      if (e.b >= b - 1e-6) {
        if (e.k === OFF && open.has(key)) {
          rest.push({ ...(open.get(key) as SmfEv), b });
          open.delete(key);
        }
        rest.push(e);
      } else if (e.k === ON) {
        if (!dropped(c, e)) open.set(key, e);
      } else if (e.k === OFF) open.delete(key);
      else this.fm.ev(e, 0, 0);
    }
    rest.sort((x, y) => x.b - y.b || +(x.k === ON) - +(y.k === ON));
    this.ev = rest;
    this.i = 0;
    this.at0 = at;
    this.tau0 = m.tm.tau(b);
    this.entries = compute(song).entries;
    this.nextE = this.entries.findIndex((e) => e.start + e.beats > b + 1e-6);
    if (this.nextE < 0) this.nextE = this.entries.length;
    this.from = b;
    this.until = at;
  }
  /** ここまで予約した AudioContext の時刻 */
  private until = 0;
  /** 弾き始めた拍（最初の和音は、この拍より前の音を鳴らさない） */
  private from = 0;
  /** 先の音を予約する */
  tick(): void {
    const now = this.audio.now();
    if (now === null || !this.playing) return;
    const c = this.ctx(),
      horizon = now + lookahead(AHEAD);
    /* 画面が隠れて予約が止まっていた分は、曲の時刻を後ろへずらす（止まっていた所から続ける） */
    if (now > this.until) {
      const d = now - this.until;
      this.at0 += d;
      for (const o of this.occ) o.at += d;
    }
    this.until = Math.max(this.until, horizon);
    while (this.i < this.ev.length) {
      const e = this.ev[this.i],
        at = this.atOf(e.b);
      if (at >= horizon) break;
      if (!(e.k === ON && dropped(c, e))) this.fm.ev(e, Math.max(now, at), 0);
      this.i++;
    }
    /* バンド（原曲のときはメトロノームだけ） */
    const on = c.band ? c.on : NO_MEMBER,
      modAt = this.entries.filter((x) => x.k > 0 && x.c.mod).map((x) => x.start);
    while (this.nextE < this.entries.length) {
      const e = this.entries[this.nextE],
        at = this.atOf(e.start);
      if (at >= horizon) break;
      const bus = this.audio.bus();
      if (!bus) return;
      /* 和音の中ほどのテンポで 16 分音符の長さを決める */
      const mid = e.start + e.beats / 2,
        spb = ((c.m.tm.tau(mid + 0.01) - c.m.tm.tau(mid)) / 0.01) * (this.spq() / 4),
        skip = this.atOf(this.from) - at;
      this.occ.push({
        at,
        bus,
        pending: bandNotes(e, c.song, on, spb, { met: c.met, modAt }).filter((x) => x.t >= skip - 1e-3),
      });
      this.nextE++;
    }
    for (const o of this.occ)
      while (o.pending.length && o.at + o.pending[0].t < horizon) {
        const x = o.pending.shift() as NoteEv;
        this.audio.note(x, Math.max(now, o.at + x.t), o.at + x.end, o.bus);
        const mb = memberOf(x.v);
        if (mb && c.band) this.onHit?.(mb, o.at + x.t);
      }
    while (this.occ.length > 1 && this.occ[1].at + 3 < now) this.occ.shift();
    if (this.i >= this.ev.length && now >= this.atOf(c.m.smf.end) + 0.05) {
      if (c.loop) {
        this.silence(false);
        this.restart(0, now + 0.05);
      } else {
        this.halt();
        this.onEnd?.();
      }
    }
  }
  /** 演奏を止める。fade なら鳴っている音もすぐ消す */
  halt(fade = false): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.silence(fade);
  }
  /** バンドの和音の音（地図で光らせる。ベースと鍵盤の音） */
  static chordTones(e: Entry): number[] {
    return voicing(e.ch, e.key);
  }
}

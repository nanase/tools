/**
 * コード進行のページの音: Web Audio API のノードで 4 つの音色・ベース・メトロノームを鳴らし、
 * くり返しを展開した順（song.ts の playOrder）にコードを先へ予約していく。
 * 音色は、ギターが Karplus-Strong の撥弦、エレピが 2 オペレータの FM、オルガンが倍音の和、ストリングスがのこぎり波 2 本と低域通過。
 * コードごとに 1 つの GainNode を通し、編集や移動のときは先に予約した分だけを消す
 */
import { lookahead } from '../../lib/pause';
import { type ChordEntry, type Item, playOrder, type Step, type Timeline } from './song';
import { PATS, voicing } from './theory';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

export type Voice = 'gtr' | 'ep' | 'org' | 'str' | 'bass' | 'clk';
/** 1 つの音。t・end はコードの頭からの秒、m は MIDI のノート番号（メトロノームは周波数 [Hz]） */
export interface NoteEv {
  t: number;
  m: number;
  v: Voice;
  end: number;
  vel: number;
}
export interface Accomp {
  bass: boolean;
  click: boolean;
}
/** コードの音の並び。弦をかき鳴らす音は 11 ms ずつずらす */
export function notesOf(e: ChordEntry, acc: Accomp): NoteEv[] {
  const tones = voicing(e.it, e.key),
    n = tones.length,
    S = Math.max(1, Math.round(e.durQ * 2)),
    stepT = e.dur / S,
    out: NoteEv[] = [];
  for (const x of PATS[e.pat].g(n, S)) {
    const ms = x.i === 'all' ? tones : [tones[x.i]];
    ms.forEach((m, k) => {
      out.push({
        t: x.s * stepT + (x.i === 'all' ? k * 0.011 : 0),
        m,
        v: e.vce,
        end: e.dur + 0.04,
        vel: x.i === 'all' ? 0.62 : x.i === 0 ? 0.9 : 0.75,
      });
    });
  }
  if (acc.bass) out.push({ t: 0, m: tones[0] - 12, v: 'bass', end: e.dur * 0.96, vel: 0.9 });
  if (acc.click) {
    const bs = (60 / e.bpm) * (4 / e.dn);
    for (let k = 0; k < e.beats; k++)
      out.push({ t: k * bs, m: e.bars.some((b) => b.o === k) ? 1760 : 1180, v: 'clk', end: 0, vel: 1 });
  }
  return out.sort((a, b) => a.t - b.t);
}

const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

export class CpAudio {
  /** AudioContext が止まったときに呼ぶ（ブラウザや OS が止めたとき） */
  onLost: (() => void) | null = null;
  ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private db = -12;
  private readonly ks = new Map<number, { buf: AudioBuffer; rate: number }>();

  now(): number | null {
    return this.ac?.state === 'running' ? this.ac.currentTime : null;
  }
  suspend(): void {
    void this.ac?.suspend();
  }
  /** AudioContext を作って動かす（押した操作の中で呼ぶ）。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    if (!this.ac) {
      const ac = new AC({ latencyHint: 'interactive' }),
        master = ac.createGain(),
        lim = ac.createDynamicsCompressor();
      lim.threshold.value = -6;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.002;
      lim.release.value = 0.15;
      master.gain.value = 10 ** (this.db / 20);
      master.connect(lim).connect(ac.destination);
      ac.addEventListener('statechange', () => {
        if (ac.state !== 'running') this.onLost?.();
      });
      this.ac = ac;
      this.master = master;
    }
    try {
      await this.ac.resume();
    } catch {
      /* 再生できない環境 */
    }
    return this.ac.state === 'running';
  }
  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.008);
  }
  /** 音を集める GainNode（コードごと・試聴ごとに作る） */
  bus(): GainNode | null {
    const { ac, master } = this;
    if (!ac || !master) return null;
    const g = ac.createGain();
    g.connect(master);
    return g;
  }
  /** bus を少しで消して外す */
  drop(g: GainNode): void {
    const ac = this.ac;
    if (!ac) return;
    g.gain.cancelScheduledValues(ac.currentTime);
    g.gain.setTargetAtTime(0, ac.currentTime, 0.03);
    setTimeout(() => g.disconnect(), 300);
  }

  private ksBuf(m: number): { buf: AudioBuffer; rate: number } {
    const hit = this.ks.get(m);
    if (hit) return hit;
    const ac = this.ac as AudioContext,
      sr = ac.sampleRate,
      f = mtof(m),
      /* 3 点の低域通過（1/4・1/2・1/4）で遅れが 1 サンプル増えるので、整数の遅延より 1 サンプル長い周期になる。再生の速さで合わせる */
      N = Math.max(3, Math.floor(sr / f - 1)),
      len = Math.floor(sr * 2.6),
      buf = ac.createBuffer(1, len, sr),
      d = buf.getChannelData(0),
      ring = new Float32Array(N),
      ex = new Float32Array(N);
    /* 弾く音: 雑音を 2 段の 1 次低域通過で丸め、弾く位置（弦の 18 % の所）で消える倍音を引く。尖った音を和らげる */
    let a1 = 0,
      a2 = 0,
      seed = m * 7919 + 1;
    for (let i = 0; i < N; i++) {
      seed = (seed * 16807) % 2147483647;
      a1 += 0.45 * ((seed / 2147483647) * 2 - 1 - a1);
      a2 += 0.45 * (a1 - a2);
      ex[i] = a2;
    }
    const P = Math.max(1, Math.round(N * 0.18));
    for (let i = 0; i < N; i++) ring[i] = ex[i] - 0.9 * ex[(i - P + N) % N];
    const rho = 0.9985 - Math.min(0.003, f / 500000);
    for (let i = 0, ix = 0; i < len; i++) {
      const a = ring[ix],
        b = ring[(ix + 1) % N],
        c = ring[(ix + 2) % N];
      d[i] = a;
      ring[ix] = rho * (0.25 * a + 0.5 * b + 0.25 * c);
      ix = (ix + 1) % N;
    }
    const o = { buf, rate: (f * (N + 1)) / sr };
    this.ks.set(m, o);
    return o;
  }

  /** 音を 1 つ予約する。w・end は AudioContext の時刻 */
  note(x: NoteEv, w: number, end: number, dest: AudioNode): void {
    const ac = this.ac;
    if (!ac) return;
    const f = mtof(x.m),
      g = ac.createGain(),
      stopAt = end + 0.8,
      vel = x.vel;
    g.connect(dest);
    const env = (a: number, peak: number, rel: number) => {
      g.gain.setValueAtTime(0, w);
      g.gain.linearRampToValueAtTime(peak, w + a);
      g.gain.setTargetAtTime(0, end, rel);
    };
    const osc = (type: OscillatorType, fr: number, to: AudioNode, det = 0) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      o.detune.value = det;
      o.connect(to);
      o.start(w);
      o.stop(stopAt);
      return o;
    };
    switch (x.v) {
      case 'gtr': {
        const k = this.ksBuf(x.m),
          s = ac.createBufferSource(),
          lp = ac.createBiquadFilter();
        s.buffer = k.buf;
        s.playbackRate.value = k.rate;
        lp.frequency.value = 2400;
        s.connect(lp).connect(g);
        g.gain.setValueAtTime(0, w);
        g.gain.linearRampToValueAtTime(vel * 0.42, w + 0.003);
        g.gain.setTargetAtTime(0, end, 0.08);
        s.start(w);
        s.stop(Math.min(stopAt, w + 2.6));
        break;
      }
      case 'ep': {
        const mg = ac.createGain();
        const c = osc('sine', f, g);
        mg.gain.setValueAtTime(f * 2.2, w);
        mg.gain.setTargetAtTime(f * 0.25, w, 0.25);
        osc('sine', f, mg);
        mg.connect(c.frequency);
        g.gain.setValueAtTime(0, w);
        g.gain.linearRampToValueAtTime(vel * 0.32, w + 0.004);
        g.gain.setTargetAtTime(0, w + 0.004, 0.9);
        g.gain.setTargetAtTime(0, end, 0.12);
        break;
      }
      case 'org':
        for (const [h, a] of [
          [1, 1],
          [2, 0.55],
          [3, 0.3],
          [4, 0.22],
        ]) {
          const og = ac.createGain();
          og.gain.value = a;
          og.connect(g);
          osc('sine', f * h, og);
        }
        env(0.012, vel * 0.09, 0.03);
        break;
      case 'str': {
        const lp = ac.createBiquadFilter();
        lp.frequency.value = 1900;
        lp.connect(g);
        osc('sawtooth', f, lp, -7);
        osc('sawtooth', f, lp, 7);
        env(0.16, vel * 0.075, 0.18);
        break;
      }
      case 'bass': {
        const lp = ac.createBiquadFilter();
        lp.frequency.value = 700;
        lp.connect(g);
        osc('triangle', f, lp);
        env(0.008, vel * 0.42, 0.05);
        break;
      }
      case 'clk': {
        const o = ac.createOscillator();
        o.frequency.value = x.m;
        o.connect(g);
        g.gain.setValueAtTime(vel * 0.25, w);
        g.gain.exponentialRampToValueAtTime(0.0001, w + 0.04);
        o.start(w);
        o.stop(w + 0.06);
        break;
      }
    }
  }

  /** 1 つのコードを今すぐ鳴らす（試聴）。bus を返す */
  play(e: ChordEntry, acc: Accomp, at = 0.03): GainNode | null {
    const ac = this.ac,
      g = this.bus();
    if (!ac || !g) return null;
    const w = ac.currentTime + at;
    for (const x of notesOf(e, acc)) this.note(x, w + x.t, w + x.end, g);
    return g;
  }
}

/** 予約したコード */
export interface Occ {
  /** ブロックの id */
  id: number;
  e: ChordEntry;
  /** 鳴り始め（AudioContext の時刻） */
  at: number;
  rep: Step['rep'];
  bus: GainNode;
}
/** 先に予約する時間 [s] */
const AHEAD = 0.25;

/** 曲の演奏。くり返しの回数は id ごとに持ち、編集しても数え直さない */
export class Player {
  occ: Occ[] = [];
  private gen: Generator<Step> | null = null;
  private nextAt = 0;
  private passes = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private done = false;
  onEnd: (() => void) | null = null;

  constructor(
    private readonly audio: CpAudio,
    private readonly song: () => { items: readonly Item[]; tl: Timeline; acc: Accomp },
  ) {}

  get playing(): boolean {
    return this.timer !== undefined;
  }

  /** 位置 from（ブロックの並びの位置）から弾く。鳴らせなければ false */
  async start(from: number): Promise<boolean> {
    this.halt();
    if (!(await this.audio.ready())) return false;
    this.passes = new Map();
    this.restart(from, (this.audio.now() ?? 0) + 0.06);
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
    return true;
  }
  /** 演奏中に、位置 from から弾き直す（今のコードも止める） */
  jump(from: number): void {
    if (!this.playing) return;
    for (const o of this.occ) this.audio.drop(o.bus);
    this.occ = [];
    this.passes = new Map();
    this.restart(from, (this.audio.now() ?? 0) + 0.04);
    this.tick();
  }
  /** 編集した: 今のコードは鳴らしたまま、次のコードから並べ直す */
  resync(): void {
    if (!this.playing) return;
    const now = this.audio.now() ?? 0,
      cur = this.current(),
      { items } = this.song();
    const later = this.occ.filter((o) => o.at > now + 0.005);
    for (const o of later) this.audio.drop(o.bus);
    this.occ = this.occ.filter((o) => !later.includes(o));
    let from: number;
    if (cur) {
      const ix = items.findIndex((x) => x.id === cur.id);
      from = ix >= 0 ? ix + 1 : Math.min(cur.e.i, items.length);
      this.restart(from, Math.max(now, cur.at + cur.e.dur));
    } else this.restart(later.length ? Math.min(later[0].e.i, items.length) : 0, now + 0.04);
  }
  private restart(from: number, at: number): void {
    const { items } = this.song();
    this.gen = playOrder(items, from, this.passes);
    this.nextAt = at;
    this.done = false;
  }
  /** 鳴っているコード */
  current(): Occ | null {
    const now = this.audio.now();
    if (now === null) return null;
    let c: Occ | null = null;
    for (const o of this.occ) if (o.at <= now + 0.001) c = o;
    return c;
  }
  tick(): void {
    const now = this.audio.now();
    if (now === null || !this.gen) return;
    /* タイマーが止まっていた間に過ぎた分は飛ばす（遅れた音をまとめて鳴らさない） */
    if (this.nextAt < now - 0.1) this.nextAt = now + 0.02;
    const { tl, acc } = this.song(),
      horizon = now + lookahead(AHEAD);
    while (!this.done && this.nextAt < horizon) {
      const r = this.gen.next();
      if (r.done) {
        this.done = true;
        break;
      }
      const e = tl.all[r.value.i];
      if (e?.it.k !== 'ch') continue;
      const ce = e as ChordEntry,
        bus = this.audio.bus();
      if (!bus) return;
      for (const x of notesOf(ce, acc)) this.audio.note(x, this.nextAt + x.t, this.nextAt + x.end, bus);
      this.occ.push({ id: ce.it.id, e: ce, at: this.nextAt, rep: r.value.rep, bus });
      this.nextAt += ce.dur;
    }
    /* 鳴り終えたコードは一覧から外す（音は自然に消える） */
    while (this.occ.length > 1 && this.occ[1].at + 3 < now) this.occ.shift();
    if (this.done && now >= this.nextAt) {
      this.halt();
      this.onEnd?.();
    }
  }
  /** 演奏を止める。fade なら鳴っている音も消す */
  halt(fade = false): void {
    clearInterval(this.timer);
    this.timer = undefined;
    const now = this.audio.now() ?? 0;
    for (const o of this.occ) if (fade || o.at > now) this.audio.drop(o.bus);
    this.occ = [];
    this.gen = null;
  }
}

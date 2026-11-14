/**
 * コード進行のページの音: Web Audio API のノードで 4 つの音色・ベース・メトロノームを鳴らし、
 * くり返しを展開した順（song.ts の playOrder）にコードを先へ予約していく。
 * 音色は、ギターが Karplus-Strong の撥弦、エレピが 2 オペレータの FM、オルガンが倍音の和、ストリングスがのこぎり波 2 本と低域通過。
 * コードごとに 1 つの GainNode を通し、編集や移動のときは先に予約した分だけを消す
 */
import { lookahead } from '../../lib/pause';
import { Reverb, reverbSpec, roomOf } from '../../lib/reverb';
import { type GtKind, GtrVoices } from './gtr';
import { type ChordEntry, type Item, playOrder, type Step, type Timeline } from './song';
import { PATS, type VoiceId, voicing } from './theory';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

export type Voice = VoiceId | 'bass' | 'clk';
/** 1 つの音。t・end はコードの頭からの秒、m は MIDI のノート番号（メトロノームは周波数 [Hz]） */
export interface NoteEv {
  t: number;
  m: number;
  v: Voice;
  end: number;
  vel: number;
  /** 和音の音（ギターで弦とフレットを割り当てるのに使う） */
  tones?: readonly number[];
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
  const bs = 8 / e.dn;
  for (const x of PATS[e.pat].g(n, S, bs, e.n * bs)) {
    const ms = x.i === 'all' ? tones : x.i === 'up' ? tones.slice(1) : [tones[x.i]];
    ms.forEach((m, k) => {
      out.push({
        t: x.s * stepT + (x.i === 'all' || x.i === 'up' ? k * 0.011 : 0),
        m,
        v: e.vce,
        end: e.dur + 0.04,
        vel: x.i === 'all' || x.i === 'up' ? 0.62 : x.i === 0 ? 0.9 : 0.75,
        tones,
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
/** ギターのページの模型の出力に掛ける倍率（ほかの音色と実効値をそろえる。書き出して測って決めた） */
const GT_GAIN = 1;
/**
 * 音色ごとの大きさの倍率。同じ和音（上下のアルペジオ 1 小節と全音符）を鳴らしたときの実効値が
 * −20 dBFS 前後にそろうよう、書き出して測って決めた
 */
const LEVEL: Record<Voice, number> = {
  gtr: 0.97,
  cgt: 2.35,
  harp: 0.27,
  pf: 0.83,
  ep: 0.575,
  org: 0.79,
  str: 1.15,
  pad: 1.6,
  brs: 1.36,
  mar: 0.73,
  vib: 0.73,
  bell: 0.84,
  bass: 1,
  clk: 1,
};

/** ギターの撥弦の予定（送るまで手元に置き、編集や一時停止で先の分を消せるようにする） */
interface GtEv {
  k: GtKind;
  tones: readonly number[];
  m: number;
  at: number;
  end: number;
  vel: number;
  bus: GainNode;
}
/** ギターの撥弦を送る先の時間 [s] */
const GT_AHEAD = 0.15;

export class CpAudio {
  /** AudioContext が止まったときに呼ぶ（ブラウザや OS が止めたとき） */
  onLost: (() => void) | null = null;
  ac: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private roomIn: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private lim: DynamicsCompressorNode | null = null;
  private gtr: GtrVoices | null = null;
  private gq: GtEv[] = [];
  /** 書き出し（OfflineAudioContext）では撥弦をすぐ送る */
  private offline = false;
  private db = -12;
  private room = 'small';
  private readonly ks = new Map<string, { buf: AudioBuffer; rate: number }>();
  /** ピアノの 2 つの波形（明るい成分と柔らかい成分） */
  private waves: [PeriodicWave, PeriodicWave] | null = null;
  /** メトロノームの音量（倍率） */
  click = 1;

  now(): number | null {
    return this.ac?.state === 'running' ? this.ac.currentTime : null;
  }
  suspend(): void {
    void (this.ac as AudioContext | null)?.suspend();
  }
  /** AudioContext を作って動かす（押した操作の中で呼ぶ）。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    if (!this.ac) {
      const ac = new AC({ latencyHint: 'interactive' });
      ac.addEventListener('statechange', () => {
        if (ac.state !== 'running') this.onLost?.();
      });
      await this.init(ac);
      setInterval(() => this.flush(), 25);
    }
    const ac = this.ac as AudioContext;
    try {
      await ac.resume();
    } catch {
      /* 再生できない環境 */
    }
    return ac.state === 'running';
  }
  /** 音の経路を作る: 音色 → 音量 → 部屋の残響 → リミッタ → 出力。ギターはワークレットを読み込む */
  async init(ac: BaseAudioContext): Promise<void> {
    const master = ac.createGain(),
      roomIn = ac.createGain(),
      conv = ac.createConvolver(),
      lim = ac.createDynamicsCompressor(),
      gtrIn = ac.createGain();
    lim.threshold.value = -6;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.15;
    conv.normalize = false;
    master.gain.value = 10 ** (this.db / 20);
    master.connect(roomIn);
    lim.connect(ac.destination);
    /* ギターのページの模型は 1 m 先の音圧 [Pa]。ほかの音色と同じ実効値になる倍率 */
    gtrIn.gain.value = GT_GAIN;
    gtrIn.connect(master);
    this.offline = !(ac instanceof AudioContext);
    Object.assign(this, { ac, master, roomIn, conv, lim });
    this.gtr = new GtrVoices(ac, gtrIn);
    this.setRoom(this.room);
    await this.gtr.load();
  }
  /** 部屋の残響（lib/reverb.ts の部屋。聴く位置は 3 m）。off は残響なし */
  setRoom(v: string): void {
    this.room = v;
    const { ac, roomIn, conv, lim } = this;
    if (!ac || !roomIn || !conv || !lim) return;
    roomIn.disconnect();
    conv.disconnect();
    const r = roomOf(v);
    if (r.v === 'off') {
      roomIn.connect(lim);
      return;
    }
    const sr = ac.sampleRate,
      spec = reverbSpec(r, 3),
      len = Math.min(6, spec.t60 * 1.2 + 0.2) * sr,
      L = new Float32Array(len),
      R = new Float32Array(len),
      rv = new Reverb(sr);
    rv.set(spec);
    L[0] = 1;
    R[0] = 1;
    rv.process(L, R, 0, len);
    const buf = ac.createBuffer(2, len, sr);
    buf.copyToChannel(L, 0);
    buf.copyToChannel(R, 1);
    conv.buffer = buf;
    roomIn.connect(conv).connect(lim);
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
  /** bus を少しで消して外す。まだ送っていないギターの撥弦も消す */
  drop(g: GainNode): void {
    const ac = this.ac;
    if (!ac) return;
    g.gain.cancelScheduledValues(ac.currentTime);
    g.gain.setTargetAtTime(0, ac.currentTime, 0.03);
    setTimeout(() => g.disconnect(), 300);
    this.gq = this.gq.filter((e) => e.bus !== g);
  }
  /** ギターの弦をすべて止める（演奏の場所を移したとき） */
  hush(): void {
    this.gq = [];
    this.gtr?.stop();
  }
  /** 近づいたギターの撥弦をワークレットへ送る */
  private flush(): void {
    const now = this.now();
    if (now === null || !this.gtr) return;
    const until = now + lookahead(GT_AHEAD);
    const due = this.gq.filter((e) => e.at < until);
    if (!due.length) return;
    this.gq = this.gq.filter((e) => e.at >= until);
    for (const e of due) this.gtr.pluck(e.k, e.tones, e.m, Math.max(e.at, now), e.end, e.vel);
  }

  /** 撥弦の音。harp は弦の真ん中寄りを指ではじき、長く響く */
  private ksBuf(m: number, harp = false): { buf: AudioBuffer; rate: number } {
    const key = `${harp ? 'h' : 'g'}${m}`,
      hit = this.ks.get(key);
    if (hit) return hit;
    const ac = this.ac as BaseAudioContext,
      sr = ac.sampleRate,
      f = mtof(m),
      /* 3 点の低域通過（1/4・1/2・1/4）で遅れが 1 サンプル増えるので、整数の遅延より 1 サンプル長い周期になる。再生の速さで合わせる */
      N = Math.max(3, Math.floor(sr / f - 1)),
      len = Math.floor(sr * (harp ? 5 : 2.6)),
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
    const P = Math.max(1, Math.round(N * (harp ? 0.4 : 0.18)));
    if (harp) {
      /* ハープ: 指の腹で弦の 40 % の所を引いて離す。初めの形は角を丸めた三角形 */
      const tri = new Float32Array(N);
      for (let i = 0; i < N; i++) tri[i] = i < P ? i / P : (N - i) / (N - P);
      let b1 = 0;
      for (let pass = 0; pass < 3; pass++)
        for (let i = 0; i < N; i++) {
          b1 += 0.35 * (tri[i] - b1);
          tri[i] = b1;
        }
      const mean = tri.reduce((a, v) => a + v, 0) / N;
      for (let i = 0; i < N; i++) ring[i] = (tri[i] - mean) * 1.6 + ex[i] * 0.05;
    } else for (let i = 0; i < N; i++) ring[i] = ex[i] - 0.9 * ex[(i - P + N) % N];
    const rho = (harp ? 0.9996 : 0.9985) - Math.min(harp ? 0.0012 : 0.003, f / (harp ? 900000 : 500000));
    for (let i = 0, ix = 0; i < len; i++) {
      const a = ring[ix],
        b = ring[(ix + 1) % N],
        c = ring[(ix + 2) % N];
      d[i] = a;
      ring[ix] = rho * (0.25 * a + 0.5 * b + 0.25 * c);
      ix = (ix + 1) % N;
    }
    const o = { buf, rate: (f * (N + 1)) / sr };
    this.ks.set(key, o);
    return o;
  }

  private nz: AudioBuffer | null = null;
  /** メトロノームの当たりに使う短い雑音 */
  private noiseBuf(): AudioBuffer {
    if (this.nz) return this.nz;
    const ac = this.ac as BaseAudioContext,
      b = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.03), ac.sampleRate),
      d = b.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    this.nz = b;
    return b;
  }

  private pianoWaves(): [PeriodicWave, PeriodicWave] {
    if (this.waves) return this.waves;
    const ac = this.ac as BaseAudioContext,
      mk = (amp: (n: number) => number, n: number) => {
        const re = new Float32Array(n + 1),
          im = new Float32Array(n + 1);
        for (let k = 1; k <= n; k++) im[k] = amp(k);
        return ac.createPeriodicWave(re, im);
      };
    this.waves = [mk((k) => 1 / k ** 1.1, 12), mk((k) => [0, 1, 0.45, 0.2, 0.1][k] ?? 0, 4)];
    return this.waves;
  }

  /** 音を 1 つ予約する。w・end は AudioContext の時刻 */
  note(x: NoteEv, w: number, end: number, dest: AudioNode): void {
    const ac = this.ac;
    if (!ac) return;
    if (x.v === 'gtr' || x.v === 'cgt') {
      const ev: GtEv = {
        k: x.v === 'gtr' ? 'steel' : 'nylon',
        tones: x.tones ?? [x.m],
        m: x.m,
        at: w,
        end,
        vel: x.vel * LEVEL[x.v],
        bus: dest as GainNode,
      };
      if (this.offline) this.gtr?.pluck(ev.k, ev.tones, ev.m, ev.at, ev.end, ev.vel);
      else this.gq.push(ev);
      return;
    }
    const f = mtof(x.m),
      g = ac.createGain(),
      stopAt = end + 0.8,
      vel = x.vel * LEVEL[x.v];
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
      case 'harp': {
        /* 響板の山（250 Hz と 900 Hz あたり）と、高い音を落とすフィルタ。指を離しても長く響く */
        const k = this.ksBuf(x.m, true),
          s = ac.createBufferSource(),
          p1 = ac.createBiquadFilter(),
          p2 = ac.createBiquadFilter(),
          lp = ac.createBiquadFilter();
        s.buffer = k.buf;
        s.playbackRate.value = k.rate;
        p1.type = 'peaking';
        p1.frequency.value = 250;
        p1.Q.value = 1;
        p1.gain.value = 4;
        p2.type = 'peaking';
        p2.frequency.value = 900;
        p2.Q.value = 1.4;
        p2.gain.value = 2.5;
        lp.frequency.value = 2800;
        s.connect(p1).connect(p2).connect(lp).connect(g);
        g.gain.setValueAtTime(0, w);
        g.gain.linearRampToValueAtTime(vel * 0.42, w + 0.006);
        g.gain.setTargetAtTime(0, end + 1.5, 0.6);
        s.start(w);
        s.stop(w + 5);
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
        /* 合奏: 少しずつずれた 3 本ののこぎり波に、遅れて掛かるビブラートと胴の響きの山（300 Hz・1 kHz・2.8 kHz） */
        const lp = ac.createBiquadFilter(),
          vib = ac.createOscillator(),
          vg = ac.createGain();
        lp.frequency.value = 3200;
        let node: AudioNode = lp;
        for (const [fr, q, gn] of [
          [300, 1.2, 4],
          [1000, 1.5, 3],
          [2800, 2, 2],
        ]) {
          const pk = ac.createBiquadFilter();
          pk.type = 'peaking';
          pk.frequency.value = fr;
          pk.Q.value = q;
          pk.gain.value = gn;
          node.connect(pk);
          node = pk;
        }
        node.connect(g);
        vib.frequency.value = 5.2;
        vg.gain.setValueAtTime(0, w);
        vg.gain.linearRampToValueAtTime(f * 0.004, w + 0.5);
        vib.connect(vg);
        vib.start(w);
        vib.stop(stopAt);
        for (const ct of [-9, 0, 8]) vg.connect(osc('sawtooth', f, lp, ct).frequency);
        env(0.2, vel * 0.05, 0.22);
        break;
      }
      case 'pf': {
        /* 明るい成分は早く、柔らかい成分は遅く消える。少しずらした 2 本でうなりを作る */
        const [wb, wm] = this.pianoWaves(),
          tl = Math.min(4, 2.4 * (262 / f) ** 0.5),
          gb = ac.createGain(),
          gm = ac.createGain();
        gb.connect(g);
        gm.connect(g);
        osc('sine', f, gb).setPeriodicWave(wb);
        osc('sine', f, gm).setPeriodicWave(wm);
        osc('sine', f, gm, 1.8).setPeriodicWave(wm);
        gb.gain.setValueAtTime(0, w);
        gb.gain.linearRampToValueAtTime(vel * 0.1, w + 0.003);
        gb.gain.setTargetAtTime(0, w + 0.003, 0.12);
        gm.gain.setValueAtTime(0, w);
        gm.gain.linearRampToValueAtTime(vel * 0.09, w + 0.004);
        gm.gain.setTargetAtTime(0, w + 0.004, tl);
        g.gain.setValueAtTime(1, w);
        g.gain.setTargetAtTime(0, end, 0.12);
        break;
      }
      case 'pad': {
        const lp = ac.createBiquadFilter(),
          lfo = ac.createOscillator(),
          lg = ac.createGain();
        lp.frequency.value = 1300;
        lp.Q.value = 1;
        lfo.frequency.value = 0.3;
        lg.gain.value = 350;
        lfo.connect(lg).connect(lp.frequency);
        lfo.start(w);
        lfo.stop(stopAt);
        lp.connect(g);
        for (const ct of [-10, 0, 10]) osc('sawtooth', f, lp, ct);
        env(0.45, vel * 0.05, 0.4);
        break;
      }
      case 'brs': {
        /* 吹き始めに明るくなり、少し落ち着くフィルタ */
        const lp = ac.createBiquadFilter();
        lp.Q.value = 2;
        lp.frequency.setValueAtTime(400, w);
        lp.frequency.linearRampToValueAtTime(2600, w + 0.06);
        lp.frequency.setTargetAtTime(1500, w + 0.06, 0.15);
        lp.connect(g);
        const vib = ac.createOscillator(),
          vg = ac.createGain();
        vib.frequency.value = 5;
        vg.gain.setValueAtTime(0, w);
        vg.gain.linearRampToValueAtTime(f * 0.003, w + 0.6);
        vib.connect(vg);
        vib.start(w);
        vib.stop(stopAt);
        vg.connect(osc('sawtooth', f, lp, -4).frequency);
        vg.connect(osc('sawtooth', f, lp, 4).frequency);
        env(0.035, vel * 0.065, 0.06);
        break;
      }
      case 'mar':
      case 'vib': {
        /* 板の 1 次と 4 倍の振動。ビブラフォンは長く響き、回る羽で音量が揺れる */
        const vib = x.v === 'vib',
          tau = vib ? Math.min(3, 2.6 * (262 / f) ** 0.3) : Math.min(0.9, 0.5 * (262 / f) ** 0.5),
          g1 = ac.createGain(),
          g4 = ac.createGain();
        g1.connect(g);
        g4.connect(g);
        osc('sine', f, g1);
        osc('sine', f * 4, g4);
        g1.gain.setValueAtTime(0, w);
        g1.gain.linearRampToValueAtTime(vel * (vib ? 0.2 : 0.3), w + 0.004);
        g1.gain.setTargetAtTime(0, w + 0.004, tau);
        g4.gain.setValueAtTime(0, w);
        g4.gain.linearRampToValueAtTime(vel * (vib ? 0.04 : 0.1), w + 0.002);
        g4.gain.setTargetAtTime(0, w + 0.002, vib ? 0.25 : 0.05);
        if (vib) {
          const lfo = ac.createOscillator(),
            lg = ac.createGain();
          lfo.frequency.value = 5.5;
          lg.gain.value = 0.3;
          lfo.connect(lg).connect(g.gain);
          lfo.start(w);
          lfo.stop(stopAt);
          g.gain.setValueAtTime(0.7, w);
        } else g.gain.setValueAtTime(1, w);
        g.gain.setTargetAtTime(0, end, vib ? 0.3 : 0.1);
        break;
      }
      case 'bell': {
        /* 周波数比 3.5 の周波数変調。打った直後ほど金属らしい成分が多い */
        const mg = ac.createGain(),
          c = osc('sine', f, g);
        mg.gain.setValueAtTime(f * 4, w);
        mg.gain.setTargetAtTime(f * 0.4, w, 0.5);
        osc('sine', f * 3.5, mg);
        mg.connect(c.frequency);
        g.gain.setValueAtTime(0, w);
        g.gain.linearRampToValueAtTime(vel * 0.18, w + 0.002);
        g.gain.setTargetAtTime(0, w + 0.002, 1.1);
        g.gain.setTargetAtTime(0, end, 0.3);
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
        /* 木を打つ音: 短い雑音を帯域通過に通した当たりと、すぐ消える正弦波 */
        const o = ac.createOscillator(),
          n = ac.createBufferSource(),
          bp = ac.createBiquadFilter(),
          gn = ac.createGain(),
          a = Math.max(1e-4, vel * 1.4 * this.click);
        n.buffer = this.noiseBuf();
        bp.type = 'bandpass';
        bp.frequency.value = x.m * 1.6;
        bp.Q.value = 3;
        n.connect(bp).connect(gn).connect(g);
        gn.gain.setValueAtTime(a * 1.5, w);
        gn.gain.exponentialRampToValueAtTime(1e-4, w + 0.015);
        o.frequency.value = x.m;
        o.connect(g);
        g.gain.setValueAtTime(a, w);
        g.gain.exponentialRampToValueAtTime(1e-4, w + 0.06);
        o.start(w);
        o.stop(w + 0.07);
        n.start(w);
        n.stop(w + 0.03);
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
    this.audio.hush();
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
    if (fade) this.audio.hush();
    this.occ = [];
    this.gen = null;
  }
}

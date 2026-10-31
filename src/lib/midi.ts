/**
 * MIDI 入力（Web MIDI API）: MIDI 機器の鍵盤とペダルで、楽器のページを弾く。
 * MidiIn は機器から届いた打鍵・離鍵・コントロールチェンジを渡す（DOM に依存しない）。
 * MidiBox は MIDI の枠（components/MidiPanel.astro）の開始・停止、機器とチャンネルの選択、入力の表示を受け持つ。
 * チャンネルは 1〜16 の 1 つか、すべて（0）を受ける
 */
import { $ } from './dom';
import { forget, store, stored } from './store';

/** 楽器のページへ渡す入力 */
export interface MidiSink {
  /** 打鍵。vel は 1〜127 */
  on(note: number, vel: number): void;
  off(note: number): void;
  /** コントロールチェンジ（64 ダンパーペダル・67 ソフトペダルなど）。v は 0〜127 */
  cc?(num: number, v: number): void;
}

/** タッチ（ベロシティの曲線）: 軽いほど弱く弾いても強い音になる */
export type Touch = 'light' | 'std' | 'heavy';
const GAMMA: Record<Touch, number> = { light: 0.7, std: 1, heavy: 1.4 };
/** ベロシティ 1〜127 を、タッチの曲線で 0〜1 の強さに直す */
export const touchOf = (vel: number, t: Touch): number =>
  ((Math.min(127, Math.max(1, vel)) - 1) / 126) ** (GAMMA[t] ?? 1);
/** 0〜1 の強さを、lo〜hi の範囲へ対数の目盛りで割り当てる（ハンマーの速さなど） */
export const logMap = (x: number, lo: number, hi: number): number => lo * (hi / lo) ** x;

/** 64 以上で踏んだとみなす（ダンパーペダル・ソフトペダル） */
export const pedalOn = (v: number): boolean => v >= 64;

/** この環境で MIDI 機器を使えるか（Safari・iPhone・iPad では使えない） */
export const midiOk = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function' && isSecureContext;

/**
 * MIDI のメッセージ 1 つを読む。打鍵は vel > 0 の 0x9n、離鍵は 0x8n と vel = 0 の 0x9n。
 * CC 120（すべての音を止める）と 123（すべての鍵を離す）は 'all' にする。ch はチャンネル 1〜16
 */
export type MidiMsg = { ch: number } & (
  | { t: 'on'; note: number; vel: number }
  | { t: 'off'; note: number }
  | { t: 'cc'; num: number; v: number }
  | { t: 'all' }
);
export function parseMidi(d: ArrayLike<number>): MidiMsg | null {
  if (d.length < 3) return null;
  const st = d[0] & 0xf0,
    ch = (d[0] & 0x0f) + 1,
    a = d[1] & 0x7f,
    b = d[2] & 0x7f;
  if (st === 0x90 && b > 0) return { ch, t: 'on', note: a, vel: b };
  if (st === 0x80 || st === 0x90) return { ch, t: 'off', note: a };
  if (st === 0xb0) return a === 120 || a === 123 ? { ch, t: 'all' } : { ch, t: 'cc', num: a, v: b };
  return null;
}
/** 押している鍵の覚え方: チャンネルと音の番号をまとめた 1 つの数 */
const keyOf = (ch: number, note: number) => ch * 128 + note;

export type StartResult = 'ok' | 'none' | 'denied';

/**
 * MIDI 機器から受ける。選んだ機器（名前。'' はすべて）とチャンネル（0 はすべて）だけを聞く。
 * 機器ごとに押している鍵を覚え、止めたとき・機器を抜いたとき・選び直したときに離す
 */
export class MidiIn {
  private acc: MIDIAccess | null = null;
  private dev = '';
  private ch = 0;
  private readonly held = new Map<string, Set<number>>();
  /** 機器の一覧が変わったとき（抜き差し） */
  onList?: () => void;

  constructor(private readonly sink: MidiSink) {}

  get running(): boolean {
    return !!this.acc;
  }

  /** つないでいる入力の機器（名前の順） */
  inputs(): { id: string; name: string }[] {
    if (!this.acc) return [];
    return [...this.acc.inputs.values()]
      .filter((p) => p.state === 'connected')
      .map((p) => ({ id: p.id, name: p.name || p.id }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  /** 許可を求めて聞き始める。機器がなくても聞き始め、あとでつないだ機器も聞く */
  async start(): Promise<StartResult> {
    if (this.acc) return this.inputs().length ? 'ok' : 'none';
    let acc: MIDIAccess;
    try {
      acc = await navigator.requestMIDIAccess();
    } catch {
      return 'denied';
    }
    this.acc = acc;
    acc.onstatechange = () => {
      this.bind();
      this.onList?.();
    };
    this.bind();
    return this.inputs().length ? 'ok' : 'none';
  }

  stop(): void {
    const acc = this.acc;
    if (!acc) return;
    acc.onstatechange = null;
    for (const p of acc.inputs.values()) p.onmidimessage = null;
    this.acc = null;
    for (const id of [...this.held.keys()]) this.lift(id);
  }

  /** 聞く機器を選ぶ（名前。'' はすべて） */
  select(name: string): void {
    this.dev = name;
    this.bind();
  }

  /** 聞くチャンネルを選ぶ（1〜16。0 はすべて）。外したチャンネルで押していた鍵は離す */
  channel(ch: number): void {
    this.ch = ch;
    if (ch) for (const id of [...this.held.keys()]) for (let c = 1; c <= 16; c++) if (c !== ch) this.lift(id, c);
  }

  /** 選んだ機器にだけ受け口をつなぐ。外した機器・抜いた機器で押していた鍵は離す */
  private bind(): void {
    const acc = this.acc;
    if (!acc) return;
    const live = new Set<string>();
    for (const p of acc.inputs.values()) {
      const use = p.state === 'connected' && (!this.dev || (p.name || p.id) === this.dev);
      if (use) {
        live.add(p.id);
        if (!p.onmidimessage) p.onmidimessage = (e) => this.recv(p.id, e);
      } else if (p.onmidimessage) p.onmidimessage = null;
    }
    for (const id of [...this.held.keys()]) if (!live.has(id)) this.lift(id);
  }

  private recv(id: string, e: MIDIMessageEvent): void {
    if (!e.data) return;
    const m = parseMidi(e.data);
    if (!m || (this.ch && m.ch !== this.ch)) return;
    const h = this.held.get(id) ?? new Set<number>();
    this.held.set(id, h);
    if (m.t === 'on') {
      h.add(keyOf(m.ch, m.note));
      this.sink.on(m.note, m.vel);
    } else if (m.t === 'off') {
      if (h.delete(keyOf(m.ch, m.note))) this.sink.off(m.note);
    } else if (m.t === 'cc') this.sink.cc?.(m.num, m.v);
    else this.lift(id, m.ch);
  }

  /** 機器 id で押している鍵をすべて離す（ch を与えたら、そのチャンネルの鍵だけ） */
  private lift(id: string, ch = 0): void {
    const h = this.held.get(id);
    if (!h) return;
    for (const k of [...h])
      if (!ch || k >> 7 === ch) {
        h.delete(k);
        this.sink.off(k & 0x7f);
      }
    if (!h.size) this.held.delete(id);
  }
}

const NO_ACCESS = 'MIDI の使用が許可されていません。';
const NO_DEVICE = 'MIDI 機器がつながっていません。';
const NO_SOUND = '音を出せませんでした';
const ALL = 'すべての機器';

/**
 * MIDI の枠（MidiPanel.astro）。使えない環境では枠を出さない。
 * 開始を押すと、音の準備（ready）と許可の求めを同じ操作で済ませる
 */
export class MidiBox {
  readonly midi: MidiIn;
  private readonly box = $('#hd-midi').closest('.pnl') as HTMLElement;
  private readonly btn = $<HTMLButtonElement>('#midiBtn');
  private readonly dev = $<HTMLSelectElement>('#midi-dev');
  private readonly ch = $<HTMLSelectElement>('#midi-ch');
  private readonly msg = $('#midi-msg');

  constructor(
    sink: MidiSink,
    private readonly opt: {
      /** 音を出す準備（AudioContext を作って動かす）。出せなければ false */
      ready: () => Promise<boolean>;
      /** 止めたとき（ペダルを画面の設定に戻すなど） */
      stopped?: () => void;
    },
  ) {
    this.midi = new MidiIn(sink);
    if (!midiOk()) return;
    this.box.hidden = false;
    this.midi.onList = () => this.list();
    this.btn.addEventListener('click', () => void (this.midi.running ? this.stop() : this.start()));
    this.dev.addEventListener('change', () => {
      store('midi-dev', this.dev.value);
      this.midi.select(this.dev.value);
    });
    /* チャンネルは止めている間も選べる（既定のすべては保存しない） */
    const c = stored('midi-ch');
    if (typeof c === 'number' && Number.isInteger(c) && c >= 1 && c <= 16) this.ch.value = String(c);
    this.midi.channel(Number(this.ch.value));
    this.ch.addEventListener('change', () => {
      const v = Number(this.ch.value);
      if (v) store('midi-ch', v);
      else forget('midi-ch');
      this.midi.channel(v);
    });
    this.sync();
  }

  private async start(): Promise<void> {
    const snd = this.opt.ready();
    const r = await this.midi.start();
    if (r === 'denied') {
      this.say(NO_ACCESS);
      return;
    }
    const v = stored('midi-dev');
    this.list(typeof v === 'string' ? v : '');
    this.midi.select(this.dev.value);
    this.sync();
    if (!(await snd)) this.say(NO_SOUND);
  }

  private stop(): void {
    this.midi.stop();
    this.list();
    this.sync();
    this.say('');
    this.show('', 0, '');
    this.pedals(null, null);
    this.opt.stopped?.();
  }

  /** 機器の一覧を作り直す。want はできれば選ぶ機器の名前 */
  private list(want = this.dev.value): void {
    const ins = this.midi.inputs(),
      names = ins.map((p) => p.name),
      opts: [string, string][] = [['', ALL], ...names.map((n): [string, string] => [n, n])];
    /* 選んでいた機器を抜いても、選んだまま残す（差し直すとまた聞く） */
    if (want && !names.includes(want)) opts.push([want, want]);
    this.dev.replaceChildren(
      ...opts.map(([v, l]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        return o;
      }),
    );
    this.dev.value = want;
    this.dev.disabled = !this.midi.running;
    if (this.midi.running) this.say(ins.length ? '' : NO_DEVICE);
  }

  private sync(): void {
    const on = this.midi.running;
    this.btn.setAttribute('aria-pressed', String(on));
    $('#midiLed').classList.toggle('on', on);
    $('#midiT').textContent = on ? '停止' : '開始';
    this.dev.disabled = !on;
  }

  /** メッセージを出す。閉じた枠では見えないので、出すときは枠を開く */
  private say(s: string): void {
    if (this.msg.textContent !== s) this.msg.textContent = s;
    this.msg.classList.toggle('er', !!s);
    if (s && this.box.classList.contains('shut')) $('#hd-midi').click();
  }

  /** 最後に弾いた音を出す: 音名・ベロシティ（1〜127）・楽器の値（「3.2 m/s」など） */
  show(name: string, vel: number, val: string): void {
    $('#mi-note').textContent = name || '—';
    $('#mi-bar').style.width = `${((100 * vel) / 127).toFixed(1)}%`;
    $('#mi-v').textContent = vel ? `${vel}${val ? ` → ${val}` : ''}` : '';
  }

  /** ペダルの灯り（null は MIDI から受けていない） */
  pedals(damper: boolean | null, soft: boolean | null): void {
    this.box.querySelector('#mi-ped')?.classList.toggle('on', !!damper);
    this.box.querySelector('#mi-soft')?.classList.toggle('on', !!soft);
  }
}

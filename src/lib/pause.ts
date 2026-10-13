/**
 * 楽器のページ（ギター・ピアノ・オルガン）の演奏の一時停止。
 * 一時停止は AudioContext を止める: AudioContext の時刻も、鳴っている音も、AudioWorklet に予約した出来事もそのまま残り、
 * 再開すると続きから鳴る。図の振動と予約した表示は、同じ間だけ止まる時計（PauseClock）で合わせる
 */

/** 一時停止の間は進まない時計。予約した呼び出し（at）も、止めている間は待つ */
export class PauseClock {
  /** 止めていた時間の合計 [ms] と、止めた時刻 [ms]（動いていれば null） */
  private skip = 0;
  private since: number | null = null;
  private readonly waits = new Set<{ t: number; fn: () => void; id: ReturnType<typeof setTimeout> | undefined }>();

  /** 今の時刻 [s] */
  readonly now = (): number => ((this.since ?? performance.now()) - this.skip) / 1000;

  pause(): void {
    if (this.since !== null) return;
    this.since = performance.now();
    for (const w of this.waits) clearTimeout(w.id);
  }

  resume(): void {
    if (this.since === null) return;
    this.skip += performance.now() - this.since;
    this.since = null;
    for (const w of this.waits) this.arm(w);
  }

  /** 時刻 t [s]（この時計の時刻。過ぎていればすぐ）に fn を呼ぶ */
  at(t: number, fn: () => void): void {
    const w = { t, fn, id: undefined };
    this.waits.add(w);
    if (this.since === null) this.arm(w);
  }

  private arm(w: { t: number; fn: () => void; id: ReturnType<typeof setTimeout> | undefined }): void {
    w.id = setTimeout(
      () => {
        this.waits.delete(w);
        w.fn();
      },
      Math.max(0, (w.t - this.now()) * 1000),
    );
  }
}

/** 止める前に音量を絞る時定数 [s] と、動かしてから音量を戻すまでの無音 [s] */
const FADE = 0.006,
  GAP = 0.02;

/** AudioContext の一時停止。master は出力の手前の音量、gain はその今の値（戻すときに使う） */
export class AudioPause {
  private on = false;
  /** 止めていないのに、ブラウザや OS が AudioContext を止めたときに呼ぶ（画面のロック、電話の着信など） */
  onLost: (() => void) | null = null;

  constructor(
    private readonly ac: AudioContext,
    private readonly master: GainNode,
    private readonly gain: () => number,
  ) {
    ac.addEventListener('statechange', () => {
      if (ac.state !== 'running') {
        if (!this.on) this.onLost?.();
      } else if (this.on) void ac.suspend();
    });
  }

  get paused(): boolean {
    return this.on;
  }

  /**
   * 止める。切れ目の雑音を避けるために音量を短く絞ってから止めるが、fast ならすぐ止める
   * （画面が隠れるときは、絞るのを待つ間にタイマーが止まることがある）
   */
  async pause(fast = false): Promise<void> {
    const { ac, master } = this;
    this.on = true;
    if (!fast && ac.state === 'running') {
      master.gain.setTargetAtTime(0, ac.currentTime, FADE);
      await new Promise((r) => setTimeout(r, FADE * 5000));
      /* 待つ間に再開した */
      if (!this.on) return;
    }
    try {
      await ac.suspend();
    } catch {
      /* すでに止められている */
    }
  }

  /** 一時停止を解く（このあと ac.resume() を呼ぶ）。音量は、短い無音のあとで戻す */
  release(): void {
    if (!this.on) return;
    this.on = false;
    const { ac, master } = this,
      t = ac.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(0, t);
    master.gain.setTargetAtTime(this.gain(), t + GAP, 0.01);
  }
}

/** 一時停止する音の出口（各ページの audio.ts） */
export interface PauseAudio {
  ready(): Promise<boolean>;
  pause(fast?: boolean): Promise<void>;
  onLost: (() => void) | null;
}

/**
 * 演奏の一時停止と再開の進行。画面が隠れたとき（スリープ、ほかのタブやアプリへの切り替え）と、
 * ブラウザが AudioContext を止めたときは、自動で一時停止する（再開は自動ではしない）。
 * playing は曲を演奏しているか、changed は一時停止の状態が変わったとき、failed は再開で音を出せなかったときに呼ぶ
 */
export class Pauser {
  readonly clock = new PauseClock();
  private on = false;

  constructor(
    private readonly audio: PauseAudio,
    private readonly opt: { playing: () => boolean; changed: () => void; failed: () => void },
  ) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.pause(true);
    });
    audio.onLost = () => void this.pause(true);
  }

  get paused(): boolean {
    return this.on;
  }

  async pause(fast = false): Promise<void> {
    if (this.on || !this.opt.playing()) return;
    this.on = true;
    this.opt.changed();
    if (fast) this.clock.pause();
    await this.audio.pause(fast);
    /* 待つ間に再開・停止していなければ */
    if (this.on) this.clock.pause();
  }

  async resume(): Promise<void> {
    if (!this.on) return;
    const ok = await this.audio.ready();
    /* 待つ間に停止した */
    if (!this.on) return;
    /* 音を出せなかったか、待つ間に画面が隠れた: 止めたままにする */
    if (!ok || document.hidden) {
      void this.audio.pause(true);
      if (!ok) this.opt.failed();
      return;
    }
    this.on = false;
    this.clock.resume();
    this.opt.changed();
  }

  /** 演奏を止めたときに、一時停止を解く（音は呼ぶ側が止める） */
  clear(): void {
    this.on = false;
    this.clock.resume();
  }
}

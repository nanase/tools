/**
 * 楽器のページの演奏の操作（components/Transport.astro・TransportState.astro）。
 * 演奏と一時停止は 1 つのボタンで切り替え、一時停止しても位置は残る。位置の欄を押すかドラッグすると、その小節の頭から弾く
 * （演奏中はすぐ、止まっている間は次に演奏したとき）。曲の頭へ戻ると、一時停止は解いて止める（演奏中なら頭から弾き直す）
 */
import { $ } from './dom';
import type { Pauser } from './pause';

/** 曲の小節と時間（曲を読み込んだあとで作る） */
export interface Line {
  /** 小節の数 */
  bars: number;
  /** 小節 n（1 から）の頭の拍。n = 1 は曲の頭（弱起の拍を含む） */
  start(n: number): number;
  /** 拍 b の小節（1 から bars） */
  barOf(b: number): number;
  /** 曲の頭から拍 b までの時間 [s]（テンポ 100 %） */
  sec(b: number): number;
  /** 曲の終わりの拍 */
  end: number;
}

/** ページの演奏 */
export interface PlayHooks {
  /** 曲を演奏しているか（一時停止の間も含む） */
  active(): boolean;
  /** 小節 bar の頭から演奏する */
  start(bar: number): void | Promise<void>;
  /** 演奏を止める（音も止める）。ここでは Transport の stopped を呼ばない */
  stop(): void;
  /** テンポ [%]（時間の表示に使う） */
  tempo(): number;
}

/** 隣の目盛りとの最小の間隔 [px]。狭いときは 2・4・8 … 小節おきに間引く */
const TICK_GAP = 3;
/** キーで動かしたあと、その位置へ移るまでの待ち [ms]（続けて押す間は弾き直さない） */
const KEY_WAIT = 400;
/** ドラッグとみなす動き [px]（数値欄と同じ） */
const DRAG_PX = 4;

const mmss = (t: number): string => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Transport {
  private line: Line | null = null;
  /** 曲の頭からの時間の割合（小節の頭ごと。最後は曲の終わりの 1） */
  private fr: number[] = [];
  /** 演奏していないときに、次に弾き始める小節 */
  private cue = 1;
  /** 表示している位置の拍（演奏中は今の位置） */
  private beat = 0;
  /** ドラッグ中・キーで動かしている間の小節（null は動かしていない） */
  private pick: number | null = null;
  private keyT: ReturnType<typeof setTimeout> | undefined;

  private readonly pp = $<HTMLButtonElement>('#tp-pp');
  private readonly home = $<HTMLButtonElement>('#tp-home');
  private readonly trk = $('#tp-trk');
  private readonly fill = $('#tp-fill');
  private readonly th = $('#tp-th');
  private readonly tk = $<SVGSVGElement>('#tp-tk');
  private readonly st = $('#tp-st');

  constructor(
    private readonly hooks: PlayHooks,
    private readonly pauser: Pauser,
  ) {
    this.pp.addEventListener('click', () => this.toggle());
    this.home.addEventListener('click', () => this.seek(1));
    this.bindTrack();
    new ResizeObserver(() => requestAnimationFrame(() => this.drawTicks())).observe(this.trk);
    this.sync();
  }

  /** 曲を変えた・読み込んだ（null は読み込み中）。位置は曲の頭に戻す */
  setLine(l: Line | null): void {
    this.line = l;
    this.cue = 1;
    this.beat = 0;
    this.pick = null;
    if (l) {
      const total = l.sec(l.end) || 1;
      this.fr = Array.from({ length: l.bars }, (_, i) => Math.min(1, l.sec(l.start(i + 1)) / total));
      this.fr.push(1);
    } else this.fr = [];
    this.trk.setAttribute('aria-valuemax', String(l?.bars ?? 1));
    $('#tp-bars').textContent = l ? String(l.bars) : '–';
    $('#tp-bar').style.minWidth = `${String(l?.bars ?? 1).length}ch`;
    this.drawTicks();
    this.sync();
  }

  /** 表示を描き直す（止まっている間にテンポを変えたとき） */
  refresh(): void {
    this.draw();
  }

  /** 演奏中の位置（拍）。ページの演奏の進みに合わせて呼ぶ */
  setPos(b: number): void {
    this.beat = b;
    this.draw();
  }

  /**
   * 演奏が止まった（ページの側で止めた）。end は曲の終わりまで弾いたか、曲を変えたとき: 次は頭から弾く。
   * それ以外（手で弾いて曲を止めたなど）は、止めた小節から弾けるように残す
   */
  stopped(end: boolean): void {
    const l = this.line;
    this.cue = end || !l ? 1 : l.barOf(this.beat);
    this.beat = l && !end ? l.start(this.cue) : 0;
    this.sync();
  }

  /** 演奏・一時停止の状態が変わったときに呼ぶ（ページの syncPlay と Pauser の changed） */
  sync(): void {
    const act = this.hooks.active(),
      play = act && !this.pauser.paused,
      wait = !play && (act || this.cue > 1);
    this.pp.classList.toggle('on', play);
    this.pp.setAttribute('aria-label', play ? '一時停止する' : '演奏する');
    this.pp.title = play
      ? '一時停止する（位置は残る。スマートフォンとタブレットでは、画面が隠れると自動で一時停止する）'
      : '今の位置から演奏する';
    this.pp.disabled = !this.line;
    this.home.disabled = !this.line;
    this.trk.setAttribute('aria-disabled', String(!this.line));
    this.st.hidden = !play && !wait;
    $('#tp-led').classList.toggle('on', play);
    $('#tp-led').classList.toggle('half', wait);
    $('#tp-stT').textContent = play ? '演奏中' : wait ? '一時停止中' : '';
    this.draw();
  }

  private toggle(): void {
    if (!this.line) return;
    if (this.hooks.active()) void (this.pauser.paused ? this.pauser.resume() : this.pauser.pause());
    else void this.hooks.start(this.cue);
  }

  /** 小節 n へ移る。演奏中ならそこから弾き直し、一時停止の間と止まっている間は、次に演奏したときにそこから弾く */
  private seek(n: number): void {
    const l = this.line;
    if (!l) return;
    n = Math.min(l.bars, Math.max(1, Math.round(n)));
    const act = this.hooks.active(),
      play = act && !this.pauser.paused;
    if (act) this.hooks.stop();
    this.cue = n;
    this.beat = l.start(n);
    if (play) void this.hooks.start(n);
    this.sync();
  }

  /** 割合 f の位置にある小節 */
  private barAt(f: number): number {
    let i = 0;
    while (i + 1 < this.fr.length - 1 && this.fr[i + 1] <= f) i++;
    return i + 1;
  }

  private draw(): void {
    const l = this.line,
      b = this.pick !== null && l ? l.start(this.pick) : this.beat,
      total = l ? l.sec(l.end) : 0,
      f = l && total > 0 ? Math.min(1, Math.max(0, l.sec(b) / total)) : 0,
      bar = l ? (this.pick ?? Math.min(l.bars, l.barOf(b))) : 1,
      pc = `${(f * 100).toFixed(3)}%`,
      k = this.hooks.tempo() / 100;
    this.fill.style.width = pc;
    this.th.style.left = pc;
    $('#tp-bar').textContent = String(bar);
    $('#tp-time').textContent = l ? `${mmss(l.sec(b) / k)} / ${mmss(total / k)}` : '';
    this.trk.setAttribute('aria-valuenow', String(bar));
    this.trk.setAttribute('aria-valuetext', l ? `${bar} / ${l.bars} 小節` : '曲を読み込んでいます');
  }

  private drawTicks(): void {
    const w = this.trk.clientWidth,
      n = this.fr.length - 1,
      [mn, mj] = this.tk.querySelectorAll('path');
    this.tk.setAttribute('viewBox', `0 0 ${w} 7`);
    if (n < 1 || w <= 0) {
      mn.setAttribute('d', '');
      mj.setAttribute('d', '');
      return;
    }
    /* 平均の小節の幅から、間引く小節の数（1・2・4 …）を決める。4 つおきを長くする */
    let s = 1;
    while (s < n && (w / n) * s < TICK_GAP) s *= 2;
    let a = '',
      c = '';
    for (let i = 0; i <= n; i += s) {
      const x = (Math.round(this.fr[i] * (w - 1)) + 0.5).toFixed(1);
      if ((i / s) % 4 === 0) c += `M${x} 0V7`;
      else a += `M${x} 0V3.5`;
    }
    mn.setAttribute('d', a);
    mj.setAttribute('d', c);
  }

  private bindTrack(): void {
    const t = this.trk;
    let id: number | null = null,
      x0 = 0,
      moved = false;
    const at = (e: PointerEvent) => {
      const r = t.getBoundingClientRect();
      return this.barAt((e.clientX - r.left) / Math.max(1, r.width));
    };
    t.addEventListener('pointerdown', (e) => {
      if (!this.line || e.button !== 0) return;
      id = e.pointerId;
      x0 = e.clientX;
      moved = false;
      /* タッチは横に動かしたときだけ位置を動かす（縦のスクロールを妨げない） */
      if (e.pointerType !== 'touch') {
        t.setPointerCapture(id);
        this.pick = at(e);
        this.draw();
      }
    });
    t.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      if (!moved && Math.abs(e.clientX - x0) < DRAG_PX) return;
      if (!moved && e.pointerType === 'touch') t.setPointerCapture(id);
      moved = true;
      this.pick = at(e);
      this.draw();
    });
    const end = (e: PointerEvent, ok: boolean) => {
      if (e.pointerId !== id) return;
      id = null;
      const n = ok ? at(e) : null;
      this.pick = null;
      if (n !== null) this.seek(n);
      else this.draw();
    };
    t.addEventListener('pointerup', (e) => end(e, true));
    t.addEventListener('pointercancel', (e) => end(e, false));
    t.addEventListener('keydown', (e) => {
      const l = this.line;
      if (!l) return;
      const cur = this.pick ?? l.barOf(this.beat),
        big = Math.max(4, Math.round(l.bars / 10)),
        to =
          e.key === 'ArrowLeft' || e.key === 'ArrowDown'
            ? cur - 1
            : e.key === 'ArrowRight' || e.key === 'ArrowUp'
              ? cur + 1
              : e.key === 'PageDown'
                ? cur - big
                : e.key === 'PageUp'
                  ? cur + big
                  : e.key === 'Home'
                    ? 1
                    : e.key === 'End'
                      ? l.bars
                      : null;
      if (to === null) return;
      e.preventDefault();
      this.pick = Math.min(l.bars, Math.max(1, to));
      this.draw();
      clearTimeout(this.keyT);
      this.keyT = setTimeout(() => {
        const n = this.pick;
        this.pick = null;
        if (n !== null) this.seek(n);
      }, KEY_WAIT);
    });
  }
}

/** 拍子が一定の曲の小節（bar は 1 小節の拍の数、pickup は弱起の拍の数、sec は拍までの時間） */
export function evenLine(o: { bar: number; pickup: number; end: number; sec: (b: number) => number }): Line {
  const { bar, pickup, end } = o,
    bars = Math.max(1, Math.ceil((end - pickup) / bar - 1e-6));
  return {
    bars,
    end,
    sec: o.sec,
    start: (n) => (n <= 1 ? 0 : pickup + (n - 1) * bar),
    barOf: (b) => Math.min(bars, Math.max(1, Math.floor((b - pickup) / bar + 1e-6) + 1)),
  };
}

/** 小節線の拍の表から作る小節（starts は小節 1, 2 … の頭の拍。starts[0] は曲の頭として 0 に置き換える） */
export function tableLine(o: { starts: readonly number[]; end: number; sec: (b: number) => number }): Line {
  const s = o.starts.length ? [0, ...o.starts.slice(1)] : [0],
    bars = s.length;
  return {
    bars,
    end: o.end,
    sec: o.sec,
    start: (n) => s[Math.min(bars, Math.max(1, n)) - 1],
    barOf: (b) => {
      let lo = 0,
        hi = bars - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (s[m] <= b + 1e-6) lo = m;
        else hi = m - 1;
      }
      return lo + 1;
    },
  };
}

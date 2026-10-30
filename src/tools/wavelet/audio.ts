/**
 * 音のスカログラムの枠: Morlet のスカログラムと STFT のスペクトログラムを、同じ周波数の行（50 Hz〜10 kHz、
 * 1 オクターブ 10 行）・同じ色・同じ dBFS で並べる。
 * 試しの音とファイルは全体を先に計算して描き（処理を選べる）、マイクは 10 ms ごとに右端へ足して流す（10 秒分）
 */

import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { handheld } from '../../lib/pause';
import { AudioIn, NB } from '../audio/capture';
import { axisFn, type BinMap, binMap, fLab, valAt } from '../spectrum/axis';
import { snr } from './dwt';
import { el, fx, lutOf, paint, svgPt, txt } from './fig';
import { freqs, ScaloBank } from './live';
import { gauss, rng } from './signals';
import { type AudioTest, play, processAudio, testClip } from './sound';
import { stftColumn, stftWindow } from './tf';

type Src = 'mic' | 'file' | 'test';
type Proc = 'off' | 'noise' | 'dn' | 'cp';

/** 行の周波数、列の間隔 [s]、STFT の点数、マイクで流す列の数（10 秒）、色の範囲 dBFS */
const F = freqs(50, 10000, 10),
  R = F.length,
  HOP = 0.01,
  NFFT = 4096,
  RING = 1000,
  LO = -100,
  /** 試しの音の長さ・標本化周波数、ファイルから使う長さ [s]、足す雑音の σ */
  TEST_DUR = 3,
  TEST_FS = 48000,
  FILE_MAX = 30,
  NOISE = 0.03,
  /** 描く範囲（SVG の単位） */
  W = 400,
  H = 240;

const RUN_T: Record<Src, [string, string, string]> = {
  mic: ['開始', '停止', 'マイクから取り込む・止める'],
  file: ['再生', '停止', '処理した音を鳴らす・止める'],
  test: ['再生', '停止', '処理した音を鳴らす・止める'],
};

export function initAudio(): void {
  const pnl = $('.a-au'),
    tab = $('#au-tab'),
    run = $<HTMLButtonElement>('#au-run'),
    cvs = { w: $<HTMLCanvasElement>('#au-cw'), s: $<HTMLCanvasElement>('#au-cs') },
    ovs = { w: $<SVGSVGElement>('#au-sw'), s: $<SVGSVGElement>('#au-ss') },
    lut = lutOf('.a-au');
  const S = {
    src: 'test' as Src,
    clip: 'mix' as AudioTest,
    proc: 'off' as Proc,
    /** ファイル（モノラル、先頭 FILE_MAX 秒） */
    file: null as null | { x: Float32Array; fs: number; name: string; dur: number },
    fileMsg: '',
    /** 今の音（処理の後）と標本化周波数 */
    y: new Float32Array(0) as Float32Array<ArrayBufferLike>,
    fs: TEST_FS,
    info: '',
  };
  /* 描く値（dBFS）: 行 × 列。マイクは輪にして head が最も古い列 */
  let cols = 0,
    ring = false,
    head = 0,
    dW = new Float32Array(0),
    dS = new Float32Array(0),
    dirty = true,
    job = 0;
  /* 鳴らす */
  let ac: AudioContext | null = null,
    stop: (() => void) | null = null,
    t0 = 0;
  /* マイク */
  let mic: AudioIn | null = null,
    acc = 0;
  const mono = new Float32Array(NB);

  /* 計算の道具は標本化周波数ごとに作る */
  const tools = new Map<number, { bank: ScaloBank; map: BinMap; win: Float64Array; hop: number }>();
  const toolOf = (fs: number) => {
    let t = tools.get(fs);
    if (!t) {
      const hop = Math.round(fs * HOP);
      t = {
        bank: new ScaloBank(fs, F, hop),
        map: binMap(R, axisFn('log', F[0], F[R - 1], fs, NFFT), fs, NFFT),
        win: stftWindow(NFFT, 'hann'),
        hop,
      };
      tools.set(fs, t);
    }
    return t;
  };
  const amp = new Float32Array(R),
    pw = new Float32Array(NFFT / 2 + 1);
  /** 列 q に、x の位置 c を中心とした値を書く */
  function column(x: ArrayLike<number>, c: number, fs: number, q: number): void {
    const t = toolOf(fs);
    t.bank.column(x, c, amp);
    stftColumn(x, c, t.win, pw);
    for (let r = 0; r < R; r++) {
      dW[r * cols + q] = 20 * Math.log10(amp[r] + 1e-12);
      dS[r * cols + q] = 10 * Math.log10(valAt(pw, t.map, r) + 1e-24);
    }
  }
  function alloc(n: number, isRing: boolean): void {
    cols = n;
    ring = isRing;
    head = 0;
    dW = new Float32Array(R * n).fill(Number.NEGATIVE_INFINITY);
    dS = new Float32Array(R * n).fill(Number.NEGATIVE_INFINITY);
    for (const cv of [cvs.w, cvs.s]) {
      cv.width = Math.max(1, n);
      cv.height = R;
    }
    axes();
    dirty = true;
  }

  function render(): void {
    if (!dirty) return;
    dirty = false;
    for (const [cv, d] of [
      [cvs.w, dW],
      [cvs.s, dS],
    ] as const) {
      const ctx = cv.getContext('2d');
      if (!ctx || !cols) continue;
      const img = ctx.createImageData(cols, R);
      for (let r = 0; r < R; r++)
        for (let q = 0; q < cols; q++) {
          const v = d[r * cols + (ring ? (head + q) % cols : q)];
          /* 上が高い周波数 */
          paint(lut, (v - LO) / -LO, img.data, ((R - 1 - r) * cols + q) * 4);
        }
      ctx.putImageData(img, 0, 0);
    }
  }

  /* ---------- 目盛り ---------- */
  const yOf = (f: number) => H - ((Math.log2(f / F[0]) * 10 + 0.5) / R) * H;
  function axes(): void {
    const dur = ring ? RING * HOP : cols * HOP,
      st = dur > 20 ? 5 : dur > 8 ? 2 : dur > 4 ? 1 : 0.5;
    for (const ov of [ovs.w, ovs.s]) {
      ov.querySelector('g.ax')?.remove();
      const g = el('g', { class: 'ax' });
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000])
        g.append(el('text', { x: -6, y: yOf(f) + 4, 'text-anchor': 'end' }, fLab(f)));
      g.append(el('text', { x: -6, y: -4, 'text-anchor': 'end' }, 'Hz'));
      for (let t = 0; t <= dur + 1e-9; t += st) {
        const x = (t / dur) * W,
          lab = ring
            ? t === dur
              ? '0 s'
              : `−${Number((dur - t).toFixed(1))}`
            : t + st > dur + 1e-9
              ? `${Number(t.toFixed(1))} s`
              : String(Number(t.toFixed(1)));
        g.append(
          el('text', { x, y: H + 16, 'text-anchor': t === 0 ? 'start' : t + st > dur + 1e-9 ? 'end' : 'middle' }, lab),
        );
      }
      g.append(el('rect', { class: 'gb', x: 0, y: 0, width: W, height: H }));
      ov.prepend(g);
    }
  }

  /* ---------- 試しの音とファイル: 処理して全体を描く ---------- */
  function load(): void {
    stopPlay();
    if (S.src === 'mic') return;
    let x: Float32Array, fs: number;
    if (S.src === 'test') {
      fs = TEST_FS;
      x = testClip(S.clip, fs, TEST_DUR);
    } else if (S.file) {
      fs = S.file.fs;
      x = S.file.x;
    } else {
      S.y = new Float32Array(0);
      S.info = '';
      alloc(0, false);
      sync();
      return;
    }
    let y = x,
      kept = 0,
      total = 0;
    if (S.proc !== 'off') {
      const r = rng(7),
        nz = Float32Array.from(x, (v) => v + NOISE * gauss(r));
      if (S.proc === 'noise') y = nz;
      else {
        const o = processAudio(
          S.proc === 'dn' ? nz : x,
          'db4',
          8,
          S.proc === 'dn' ? { kind: 'denoise', m: 'hard', k: 1 } : { kind: 'compress', keep: 0.05 },
        );
        y = o.y;
        kept = o.kept;
        total = o.total;
      }
    }
    S.y = y;
    S.fs = fs;
    const parts = [`${fx(fs / 1000, fs % 1000 ? 1 : 0)} kHz`, `${fx(x.length / fs)} s`];
    if (total) parts.push(`残した係数 ${fx((100 * kept) / total)} %`);
    if (S.proc !== 'off') parts.push(`SN 比 ${fx(snr(x, y))} dB`);
    S.info = parts.join(' · ');
    analyse();
    sync();
  }
  /** 全体を少しずつ計算して描く（1 フレームに 12 ms まで） */
  function analyse(): void {
    const id = ++job,
      y = S.y,
      fs = S.fs,
      hop = toolOf(fs).hop,
      n = Math.floor(y.length / hop);
    alloc(n, false);
    let q = 0;
    const step = () => {
      if (id !== job) return;
      const end = performance.now() + 12;
      while (q < n && performance.now() < end) {
        column(y, q * hop + hop / 2, fs, q);
        q++;
      }
      dirty = true;
      if (q < n) requestAnimationFrame(step);
    };
    step();
  }

  /* ---------- 鳴らす ---------- */
  const ctx = (): AudioContext | null => {
    if (!ac) {
      const AC =
        globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    return ac;
  };
  function stopPlay(): void {
    stop?.();
    stop = null;
  }
  async function startPlay(): Promise<void> {
    const a = ctx();
    if (!a || !S.y.length) return;
    try {
      await a.resume();
    } catch {
      /* 再生を始められない環境 */
    }
    stopPlay();
    t0 = a.currentTime;
    stop = play(a, S.y, S.fs, 1, () => {
      stop = null;
      sync();
    });
  }

  /* ---------- マイク ---------- */
  function micOn(): boolean {
    return !!mic?.micOn;
  }

  /* ---------- 画面との受け渡し ---------- */
  function sync(): void {
    const s = S.src,
      on = s === 'mic' ? micOn() : !!stop;
    tab.dataset.src = s;
    run.disabled = s === 'file' && !S.file;
    run.setAttribute('aria-pressed', String(on));
    run.title = RUN_T[s][2];
    $('#au-led').classList.toggle('on', on);
    txt('#au-runT', RUN_T[s][on ? 1 : 0]);
    txt('#au-msg', s === 'mic' ? (mic?.micMsg ?? '') : '');
    const fm = $('#au-fileMsg');
    fm.className = `msg${S.fileMsg ? ' er' : ''}`;
    txt(
      '#au-fileMsg',
      S.fileMsg ||
        (S.file
          ? `${S.file.name} · ${S.file.dur < FILE_MAX ? `${fx(S.file.dur)} 秒` : `先頭 ${FILE_MAX} 秒`}`
          : 'まだ選んでいません'),
    );
    txt(
      '#au-info',
      s === 'mic' ? (micOn() && mic ? `${fx(mic.fs / 1000, mic.fs % 1000 ? 1 : 0)} kHz · 10 ms ごと` : '') : S.info,
    );
  }

  const src = new Choice<Src>($('#au-src'), (v) => {
    S.src = v;
    if (v !== 'mic' && mic?.micOn) void mic.toggle();
    if (v === 'mic') {
      stopPlay();
      job++;
      alloc(RING, true);
    } else load();
    sync();
  });
  new Choice<AudioTest>($('#p-clip'), (v) => {
    S.clip = v;
    load();
  });
  new Choice<Proc>($('#p-proc'), (v) => {
    S.proc = v;
    load();
  });

  run.addEventListener('click', () => {
    if (S.src === 'mic') {
      mic ??= new AudioIn();
      mic.onChange = sync;
      acc = 0;
      void mic.toggle().then(sync);
      return;
    }
    if (stop) stopPlay();
    else void startPlay().then(sync);
    sync();
  });

  /* ファイル: 選ぶ・枠へ落とす */
  const fin = $<HTMLInputElement>('#au-file');
  async function open(f: File | undefined): Promise<void> {
    if (!f) return;
    const a = ctx();
    if (!a) {
      S.fileMsg = 'この環境では音声を扱えません';
      sync();
      return;
    }
    S.fileMsg = '';
    txt('#au-fileMsg', '読み込んでいます…');
    try {
      const b = await a.decodeAudioData(await f.arrayBuffer()),
        n = Math.min(b.length, Math.round(b.sampleRate * FILE_MAX)),
        x = new Float32Array(n);
      for (let ch = 0; ch < b.numberOfChannels; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < n; i++) x[i] += d[i] / b.numberOfChannels;
      }
      S.file = { x, fs: b.sampleRate, name: f.name, dur: b.duration };
    } catch {
      S.fileMsg = 'このファイルは読み込めませんでした（WAV・MP3・FLAC など）';
    }
    if (S.src !== 'file') {
      src.set('file');
      S.src = 'file';
      if (mic?.micOn) void mic.toggle();
    }
    load();
  }
  $('#au-fileBtn').addEventListener('click', () => fin.click());
  fin.addEventListener('change', () => {
    void open(fin.files?.[0]);
    fin.value = '';
  });
  pnl.addEventListener('dragover', (e) => {
    e.preventDefault();
    pnl.classList.add('drop');
  });
  pnl.addEventListener('dragleave', (e) => {
    if (!pnl.contains(e.relatedTarget as Node | null)) pnl.classList.remove('drop');
  });
  pnl.addEventListener('drop', (e) => {
    e.preventDefault();
    pnl.classList.remove('drop');
    void open(e.dataTransfer?.files[0]);
  });

  /* スマートフォンで画面が隠れたら止める */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !handheld()) return;
    stopPlay();
    if (mic?.micOn) void mic.toggle();
    sync();
  });

  /* カーソルの読み値 */
  let curP: [number, number] | null = null;
  for (const ov of [ovs.w, ovs.s]) {
    ov.addEventListener('pointermove', (e) => {
      const p = svgPt(ov, e);
      curP = p && p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H ? p : null;
      cursor();
    });
    ov.addEventListener('pointerleave', () => {
      curP = null;
      cursor();
    });
  }
  function cursor(): void {
    if (!curP || !cols) {
      for (const k of ['w', 's']) $(`#au-cur${k}`).setAttribute('d', '');
      txt('#au-rd', '');
      return;
    }
    const [x, y] = curP,
      q = Math.min(cols - 1, Math.floor((x / W) * cols)),
      r = Math.max(0, Math.min(R - 1, Math.floor(((H - y) / H) * R))),
      i = r * cols + (ring ? (head + q) % cols : q),
      db = (v: number) => (Number.isFinite(v) ? fx(Math.max(-199, v)) : '—'),
      t = ring ? -((cols - q) * HOP) : q * HOP;
    for (const k of ['w', 's']) $(`#au-cur${k}`).setAttribute('d', `M${x.toFixed(1)} 0V${H}M0 ${y.toFixed(1)}H${W}`);
    txt('#au-rd', `t ${fx(t, 2)} s  f ${fLab(F[r])} Hz  W ${db(dW[i])}  S ${db(dS[i])} dBFS`);
  }

  /* ---------- 毎フレーム ---------- */
  let prev = performance.now();
  function loop(now: number): void {
    const dt = Math.min(0.2, (now - prev) / 1000);
    prev = now;
    if (S.src === 'mic' && mic?.micOn && mic.pull(now)) {
      const fs = mic.fs,
        t = toolOf(fs);
      for (let i = 0; i < NB; i++) mono[i] = (mic.L[i] + mic.R[i]) / 2;
      acc += dt / HOP;
      const n = Math.min(30, Math.floor(acc));
      acc -= n;
      for (let k = 0; k < n; k++) {
        column(mono, NB - 1 - t.bank.delay - (n - 1 - k) * t.hop, fs, head);
        head = (head + 1) % cols;
      }
      if (n) dirty = true;
    }
    render();
    /* 再生の位置 */
    const ph = stop && ac && !ring && S.y.length ? (ac.currentTime - t0) / (S.y.length / S.fs) : -1,
      d = ph >= 0 && ph <= 1 ? `M${(ph * W).toFixed(1)} 0V${H}` : '';
    for (const k of ['w', 's']) {
      const p = $(`#au-ph${k}`);
      if (p.getAttribute('d') !== d) p.setAttribute('d', d);
    }
    if (curP && (ring || dirty)) cursor();
    requestAnimationFrame(loop);
  }
  if (src.value !== 'test') {
    S.src = src.value;
  }
  load();
  requestAnimationFrame(loop);
}

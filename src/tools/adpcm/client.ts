/**
 * ADPCM のページの入口。上は 4 秒全体と拡大の図で、段階の間隔と誤差の変化を PCM と比べて確かめる。
 * 下は「ADPCM のしくみ」（固定の値で 6 つの工程を順に動かす）。音の計算はワーカーで行う
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { reserveHeight } from '../../lib/reserve';
import { initToolPage } from '../../lib/tool-page';
import { Deck } from '../pcm/deck';
import { COL, drawOverview, readCols, trigger } from '../pcm/fig';
import { hasFreq, type SrcName, TEST_FS } from '../pcm/sources';
import { snrLabel } from '../pcm/text';
import { Recorder } from '../wavelet-denoise/rec';
import type { Marks } from './adpcm';
import { drawGap, drawWhole, drawZoom, WHOLE_L, WHOLE_R, type Win } from './fig';
import { PARAMS, type PKey, PRESETS } from './params';
import { CAPTIONS, drawStory, drawThumb, STEPS } from './story';
import type { Job, Out } from './worker';

initToolPage();

type SrcKind = 'test' | 'file' | 'mic';
interface Rec {
  /** チャンネルごとの列 */
  x: Float32Array[];
  F: number;
}
/** ファイルとマイクの長さの上限 [s] */
const MAX = 10;

const root = $('#adpcm'),
  deck = new Deck(),
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
/* 開いたときは ADPCM の音を選んでおく */
deck.sel = 2;

const S = {
  kind: 'test' as SrcKind,
  src: 'mix' as SrcName,
  f: 440,
  lv: -3,
  fs: 8000,
  bits: 4,
  pred: true,
  adapt: true,
  gap: 337,
  ms: 10,
  file: null as Rec | null,
  mic: null as Rec | null,
};
let res: Out | null = null,
  dirty = true;

/* ---------- 計算のワーカー: 動いている間に頼まれたら、終わってから最新の条件で 1 度だけ頼み直す ---------- */
let jobN = 0,
  busy = false,
  again = false,
  timer = 0,
  srcKey = '';
function post(): void {
  const rec = S.kind === 'file' ? S.file : S.kind === 'mic' ? S.mic : null;
  if (S.kind !== 'test' && !rec) {
    res = null;
    deck.set([], TEST_FS);
    show();
    return;
  }
  const key = rec ? `r${rec.x[0].length}/${rec.F}/${S.kind}` : `g${S.src}/${hasFreq(S.src) ? S.f : 0}`;
  if (key !== srcKey) {
    srcKey = key;
    worker.postMessage(
      (rec ? { kind: 'src', x: rec.x, F: rec.F } : { kind: 'gen', name: S.src, f: S.f }) satisfies Job,
    );
  }
  busy = true;
  $('#ls-busy').hidden = false;
  worker.postMessage({
    kind: 'run',
    id: ++jobN,
    lv: S.lv,
    fs: S.fs,
    set: { bits: S.bits, pred: S.pred, adapt: S.adapt, fix: S.gap },
  } satisfies Job);
}
function run(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (busy) again = true;
    else post();
  }, 20);
}
worker.onmessage = (e: MessageEvent<Out>) => {
  busy = false;
  if (again) {
    again = false;
    post();
    return;
  }
  $('#ls-busy').hidden = true;
  res = e.data;
  deck.set([res.x, res.po, res.yo, res.df], res.F);
  show();
};

/* ---------- 文と数値 ---------- */
const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};
const minusDb = (v: number) => (v > 0 ? `+${v}` : `${v}`.replace('-', '−'));
function show(): void {
  txt('#k-0', `${minusDb(S.lv)} dB`);
  txt('#k-1', res ? `SN 比 ${snrLabel(res.snrQ)} dB` : ' ');
  txt('#k-2', res ? `SN 比 ${snrLabel(res.snrA)} dB` : ' ');
  txt('#zm-eff', res ? `SN 比 ${snrLabel(res.snrA)} dB（同じビット数の PCM は ${snrLabel(res.snrQ)} dB）` : '');
  for (const b of presetBtns) {
    const p = PRESETS[Number(b.dataset.i)];
    b.setAttribute('aria-pressed', String(p.fs === S.fs && p.bits === S.bits && S.pred && S.adapt));
  }
  dirty = true;
  overview = true;
}

/* ---------- 図 ---------- */
const cvA = $<HTMLCanvasElement>('#all-cv'),
  cvZ = $<HTMLCanvasElement>('#zm-w'),
  cvG = $<HTMLCanvasElement>('#zm-g');
/** 拡大する範囲: 止めている間は選んだ位置、再生中は波が止まって見えるよう 0 を横切る位置に合わせる */
function win(r: Out): Win {
  const p = deck.pos();
  return { t: deck.playing ? trigger(r.so, r.F, p) : p, ms: S.ms };
}
function drawFigs(): void {
  const r = res;
  if (!r) {
    for (const c of [cvA, cvZ, cvG]) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    return;
  }
  const w = win(r);
  drawWhole(cvA, r, w);
  drawZoom(cvZ, r, w);
  drawGap(cvG, r, w);
}

/* 全体の図: 押した所とドラッグした所を拡大する。指はスクロールと分けるため、離したときに移す */
const seekCentered = (t: number) => {
  const w = S.ms / 1000;
  deck.seek(Math.max(0, Math.min(Math.max(0, deck.dur - w), t - w / 2)));
};
const allAt = (e: PointerEvent) => {
  const q = cvA.getBoundingClientRect(),
    PW = q.width - WHOLE_L - WHOLE_R;
  seekCentered(((e.clientX - q.left - WHOLE_L) / PW) * deck.dur);
};
cvA.addEventListener('pointerdown', (e) => {
  cvA.setPointerCapture(e.pointerId);
  if (e.pointerType === 'mouse') allAt(e);
});
cvA.addEventListener('pointermove', (e) => {
  if (cvA.hasPointerCapture(e.pointerId)) allAt(e);
});
cvA.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') allAt(e);
});
cvA.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowLeft' ? -0.1 : e.key === 'ArrowRight' ? 0.1 : 0;
  if (d) deck.seek(Math.max(0, deck.pos() + d));
  else if (e.key === 'Home') deck.seek(0);
  else return;
  e.preventDefault();
});
/* 移動先: 変化が枠の左から 1/3 の所に来るようにする */
$('#all-jump').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.chip');
  if (!b || !res) return;
  const k = b.dataset.m as keyof Marks;
  deck.seek(Math.max(0, res.marks[k] - (k === 'low' ? 0 : S.ms / 3000)));
});

/* ---------- 試聴 ---------- */
const pp = $<HTMLButtonElement>('#ls-pp'),
  wv = $('#ls-wv'),
  keys = $$<HTMLButtonElement>('#ls-keys .pcm-key');
let overview = true,
  seen: Float32Array | null = null;
deck.onState = () => {
  pp.classList.toggle('on', deck.playing);
  const t = deck.playing ? '一時停止' : '再生';
  pp.setAttribute('aria-label', t);
  pp.title = t;
  keys.forEach((k, i) => {
    k.setAttribute('aria-pressed', String(i === deck.sel));
  });
  dirty = true;
};
pp.addEventListener('click', () => deck.toggle());
$('#ls-keys').addEventListener('click', (e) => {
  const k = (e.target as Element).closest<HTMLElement>('.pcm-key');
  if (k) deck.select(Number(k.dataset.i));
});
const seekAt = (e: PointerEvent) => {
  const r = wv.getBoundingClientRect();
  deck.seek(((e.clientX - r.left) / r.width) * deck.dur);
};
wv.addEventListener('pointerdown', (e) => {
  wv.setPointerCapture(e.pointerId);
  seekAt(e);
});
wv.addEventListener('pointermove', (e) => {
  if (wv.hasPointerCapture(e.pointerId)) seekAt(e);
});
wv.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowLeft' ? -0.5 : e.key === 'ArrowRight' ? 0.5 : 0;
  if (d) deck.seek(deck.pos() + d);
  else if (e.key === 'Home') deck.seek(0);
  else return;
  e.preventDefault();
});

/* ---------- 入力 ---------- */
const tab = $('#ls-tab');
const syncTab = () => {
  tab.dataset.src = S.kind;
  tab.dataset.freq = String(S.kind === 'test' && hasFreq(S.src));
  tab.dataset.adapt = String(S.adapt);
};
let ready = false;
const P = new ParamGroup<PKey>(PARAMS, (v, k) => {
  S.fs = v.fs;
  S.bits = v.bits;
  S.f = v.f;
  S.lv = v.lv;
  S.gap = v.gap;
  S.ms = v.ms;
  deck.volume(v.vol);
  /* 生成時の 1 回目は値を受け取るだけ（画面の部品がまだそろっていない） */
  if (!ready || k === 'vol') return;
  if (k === 'ms') {
    dirty = true;
    return;
  }
  show();
  run();
});
const predC = new Choice<string>($('#p-pred'), (v) => {
  S.pred = v === '1';
  show();
  run();
});
const adaptC = new Choice<string>($('#p-adapt'), (v) => {
  S.adapt = v === '1';
  syncTab();
  show();
  run();
});
new Choice<SrcKind>($('#ls-src'), (v) => {
  S.kind = v;
  if (v !== 'mic' && rec.on) rec.stop();
  syncTab();
  run();
});
new Choice<SrcName>($('#p-src'), (v) => {
  S.src = v;
  syncTab();
  run();
});
const presetBtns = $$<HTMLButtonElement>('#ls-pre .chip');
$('#ls-pre').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.chip');
  if (!b) return;
  const p = PRESETS[Number(b.dataset.i)];
  S.pred = true;
  S.adapt = true;
  predC.choose('1');
  adaptC.choose('1');
  P.set('fs', p.fs);
  P.set('bits', p.bits);
  syncTab();
  show();
  run();
});

/* ファイル: 選ぶ・枠へ落とす */
const fin = $<HTMLInputElement>('#ls-file'),
  pnl = $('.a-set');
async function open(f: File | undefined): Promise<void> {
  if (!f) return;
  const a = deck.ctx(),
    msg = $('#ls-fileMsg');
  if (!a) {
    msg.textContent = 'この環境では音声を扱えません';
    return;
  }
  msg.textContent = '読み込み中…';
  try {
    const b = await a.decodeAudioData(await f.arrayBuffer()),
      n = Math.min(b.length, Math.round(b.sampleRate * MAX));
    S.file = {
      x: Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, c) => b.getChannelData(c).slice(0, n)),
      F: b.sampleRate,
    };
    srcKey = '';
    msg.textContent = `${f.name}・${b.duration <= MAX ? `${b.duration.toFixed(1)} 秒` : `先頭 ${MAX} 秒`}`;
    msg.classList.remove('er');
  } catch {
    msg.textContent = 'このファイルは読み込めませんでした（WAV・MP3・FLAC など）';
    msg.classList.add('er');
    return;
  }
  if (S.kind !== 'file') $<HTMLButtonElement>('#ls-src button[data-v="file"]').click();
  else run();
}
$('#ls-fileBtn').addEventListener('click', () => fin.click());
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

/* マイク: 押すと録り始め、もう一度押すか 10 秒で止める */
const rec = new Recorder(() => deck.ctx(), MAX);
rec.onChange = () => {
  $('#ls-rec').setAttribute('aria-pressed', String(rec.on));
  $('#ls-recLed').classList.toggle('on', rec.on);
  txt('#ls-recT', rec.on ? '停止' : '録音');
  txt(
    '#ls-micMsg',
    rec.msg ||
      (rec.on
        ? `録音中 ${rec.sec.toFixed(1)} / ${MAX} 秒`
        : S.mic
          ? `${(S.mic.x[0].length / S.mic.F).toFixed(1)} 秒`
          : 'まだ録音がありません'),
  );
};
rec.onDone = (x, F) => {
  S.mic = { x: [x], F };
  srcKey = '';
  rec.onChange();
  if (S.kind === 'mic') run();
};
$('#ls-rec').addEventListener('click', () => {
  if (rec.on) rec.stop();
  else {
    deck.pause();
    void rec.start();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !handheld()) return;
  deck.suspend();
  rec.stop();
});

/* ---------- ADPCM のしくみ ---------- */
/** 1 工程の動く時間と止めて見せる時間 [s] */
const DURA = 6,
  HOLD = 1.2;
const St = { i: 0, t: RM.matches ? DURA : 0, run: !RM.matches, seen: false };
const cvH = $<HTMLCanvasElement>('#how-cv'),
  cards = $$<HTMLButtonElement>('#how-steps .pcm-st'),
  thumbs = cards.map((b) => $<HTMLCanvasElement>('canvas', b)),
  hpp = $<HTMLButtonElement>('#how-pp'),
  trk = $('#how-trk');
/* 工程の説明は長さが違うので、いちばん長い説明の高さを取っておく */
reserveHeight($('#how-cap'), CAPTIONS);
function syncStep(): void {
  cards.forEach((b, i) => {
    const on = i === St.i;
    b.setAttribute('aria-pressed', String(on));
    if (on) {
      const w = b.parentElement;
      if (w) w.scrollLeft = b.offsetLeft - w.offsetLeft - (w.clientWidth - b.offsetWidth) / 2;
    }
  });
  txt('#how-cap', CAPTIONS[St.i]);
  txt('#how-name', STEPS[St.i][0]);
  hpp.classList.toggle('on', St.run);
  const t = St.run ? '一時停止' : '再生';
  hpp.setAttribute('aria-label', t);
  hpp.title = t;
}
function goStep(i: number, t = St.run ? 0 : DURA): void {
  St.i = (i + STEPS.length) % STEPS.length;
  St.t = t;
  syncStep();
}
$('#how-steps').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.pcm-st');
  if (b) goStep(Number(b.dataset.i));
});
$('#how-prev').addEventListener('click', () => goStep(St.i - 1));
hpp.addEventListener('click', () => {
  St.run = !St.run;
  syncStep();
});
const trkAt = (e: PointerEvent) => {
  const r = trk.getBoundingClientRect(),
    v = Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)) * STEPS.length,
    i = Math.floor(v);
  goStep(i, (v - i) * DURA);
};
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  trkAt(e);
});
trk.addEventListener('pointermove', (e) => {
  if (trk.hasPointerCapture(e.pointerId)) trkAt(e);
});
trk.addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (!d) return;
  goStep(St.i + d);
  e.preventDefault();
});
/* 枠を閉じたときと画面の外にあるときは止める */
new IntersectionObserver(([e]) => {
  St.seen = e.isIntersecting;
}).observe(cvH);
function drawHow(now: number, dt: number): void {
  if (!St.seen) return;
  if (St.run) {
    St.t += dt;
    if (St.t >= DURA + HOLD) goStep(St.i + 1);
  }
  const u = Math.min(1, St.t / DURA);
  drawStory(cvH, St.i, u);
  const tm = RM.matches ? 2.4 : now / 1000;
  thumbs.forEach((c, i) => {
    drawThumb(c, i, tm);
  });
  const p = ((St.i + u) / STEPS.length) * 100;
  $('#how-fill').style.width = `${p}%`;
  $('#how-th').style.left = `${p}%`;
  trk.setAttribute('aria-valuenow', String(St.i + 1));
}

/* ---------- 毎フレーム ---------- */
const recolor = () => {
  readCols(root);
  dirty = true;
  overview = true;
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  dirty = true;
  overview = true;
}).observe(root);
let last = 0,
  lastPos = -1;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  drawHow(now, dt);
  const d = deck.dur,
    t = deck.pos();
  if (deck.playing || dirty || t !== lastPos) {
    dirty = false;
    lastPos = t;
    drawFigs();
  }
  const cur = deck.cur;
  if (cur && (overview || cur !== seen)) {
    overview = false;
    seen = cur;
    drawOverview($<HTMLCanvasElement>('#ls-wc'), cur, COL.ink3);
  }
  $('#ls-ph').style.left = `${(d ? (100 * t) / d : 0).toFixed(3)}%`;
  txt('#ls-tm', `${t.toFixed(2)} / ${d.toFixed(2)} s`);
  wv.setAttribute('aria-valuemax', d.toFixed(2));
  wv.setAttribute('aria-valuenow', t.toFixed(2));
  cvA.setAttribute('aria-valuemax', d.toFixed(2));
  cvA.setAttribute('aria-valuenow', t.toFixed(2));
  requestAnimationFrame(loop);
}
readCols(root);
syncTab();
syncStep();
ready = true;
queueMicrotask(() => {
  syncTab();
  show();
  run();
});
requestAnimationFrame(loop);

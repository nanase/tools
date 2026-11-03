/**
 * MP3 のページの入口。上で音を圧縮して見比べ・聴き比べ、下の「MP3 のしくみ」で工程を追う。
 * エンコードと評価はワーカーで行い、復号はブラウザに任せる（本物の MP3 として読めることも確かめられる）
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { minus } from '../../lib/format';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import { Deck } from '../pcm/deck';
import { drawOverview } from '../pcm/fig';
import { FS, type Stats } from './encoder';
import { type Evaluation, NBANDS, type Spectrogram } from './evaluate';
import { COL, drawSg, readCols, type SgMode, sgBottom, sgF, sgTime, sgY } from './fig';
import { followLp, LAME_LP, LP_NONE, lpKHz, lpView, PARAMS, type PKey } from './params';
import type { SrcName } from './sources';
import { caption, drawStory, type LpPair, STEPS, type StoryData } from './story';
import type { Job, Out } from './worker';

initToolPage();

/** ファイルの長さの上限 [s] と、しくみの図で見る時刻 [s] */
const MAX = 10,
  CAP_T = 1.05;

interface Result {
  kbps: number;
  lp: number;
  bytes: Uint8Array;
  stats: Stats;
  al: Float32Array[];
  diff: Float32Array[];
  ev: Evaluation;
  sd: Spectrogram;
}

const root = $('#mp3'),
  deck = new Deck(),
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
deck.sel = 1;

const S = {
  kind: 'test' as 'test' | 'file',
  src: 'mix' as SrcName,
  kbps: 128,
  /** 0 はローパスなし */
  lp: 0,
  file: null as Float32Array[] | null,
};

/* ---------- 計算: 1 度に 1 つ。今の設定を先に、しくみが見えていれば比較の相手も計算して覚えておく ---------- */
const cache = new Map<string, Result>();
const CACHE_MAX = 8;
let srcKey = '',
  fileN = 0,
  orig: Float32Array[] | null = null,
  so: Spectrogram | null = null,
  res: Result | null = null,
  jobN = 0,
  job: { id: number; key: string; srcKey: string; kbps: number; lp: number } | null = null,
  decodeFail = false;
const post = (j: Job) => worker.postMessage(j);
const keyOf = (kbps: number, lp: number) => `${srcKey}|${kbps}|${lp}`;
/** 比較に使うローパス: 今かけていれば今の値、かけていなければ LAME の既定 */
const cutNow = () => S.lp || LAME_LP[S.kbps];

function setSource(): void {
  cache.clear();
  orig = null;
  so = null;
  res = null;
  if (S.kind === 'file') {
    if (!S.file) {
      srcKey = '';
      deck.set([], FS);
      show();
      return;
    }
    srcKey = `f${fileN}`;
    post({ kind: 'src', ch: S.file });
  } else {
    srcKey = `s${S.src}`;
    post({ kind: 'gen', name: S.src });
  }
  showBusy(0);
}

function pump(): void {
  if (job || !orig) return;
  const n = orig[0].length,
    wants: [number, number][] = [[S.kbps, S.lp]];
  if (St.seen) wants.push([S.kbps, S.lp ? 0 : cutNow()]);
  const want = wants.find(([k, l]) => !cache.has(keyOf(k, l)));
  if (!want) return;
  const [kbps, lp] = want;
  job = { id: ++jobN, key: keyOf(kbps, lp), srcKey, kbps, lp };
  if (kbps === S.kbps && lp === S.lp) showBusy(0);
  post({
    kind: 'enc',
    id: job.id,
    kbps,
    lp,
    capture: Math.min(Math.floor((CAP_T * FS) / 1152), Math.floor(n / 1152 / 2)),
  });
}

/** MP3 のバイト列をブラウザで復号する。標本化周波数は 44.1 kHz のまま取る */
async function decodeMp3(bytes: Uint8Array): Promise<Float32Array[]> {
  const a = new OfflineAudioContext(2, FS, FS),
    copy = bytes.slice().buffer as ArrayBuffer,
    b = await a.decodeAudioData(copy);
  return Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
}

const pendings = new Map<number, { bytes: Uint8Array; stats: Stats }>();
worker.onmessage = (e: MessageEvent<Out>) => {
  const m = e.data;
  if (m.kind === 'src') {
    orig = m.ch;
    so = m.so;
    show();
    pump();
    return;
  }
  if (m.kind === 'prog') {
    if (job?.id === m.id && job.kbps === S.kbps && job.lp === S.lp) showBusy(m.p);
    return;
  }
  const cur = job;
  if (!cur || cur.id !== m.id) return;
  if (cur.srcKey !== srcKey) {
    job = null;
    pump();
    return;
  }
  if (m.kind === 'enc') {
    pendings.set(m.id, { bytes: m.bytes, stats: m.stats });
    decodeMp3(m.bytes)
      .then((dec) => {
        if (cur.srcKey !== srcKey) {
          pendings.delete(m.id);
          job = null;
          pump();
          return;
        }
        post({ kind: 'an', id: m.id, lp: cur.lp, dec });
      })
      .catch(() => {
        decodeFail = true;
        job = null;
        show();
      });
    return;
  }
  const enc = pendings.get(m.id);
  pendings.delete(m.id);
  if (enc) {
    cache.set(cur.key, { kbps: cur.kbps, lp: cur.lp, ...enc, al: m.al, diff: m.diff, ev: m.ev, sd: m.sd });
    if (cache.size > CACHE_MAX) {
      const old = [...cache.keys()].find((k) => k !== cur.key && k !== keyOf(S.kbps, S.lp));
      if (old) cache.delete(old);
    }
  }
  job = null;
  apply();
  pump();
};

/** 今の設定の結果があれば画面へ出す */
function apply(): void {
  const r = cache.get(keyOf(S.kbps, S.lp));
  if (r && r !== res) {
    res = r;
    if (orig) deck.set([orig, r.al, r.diff], FS);
  }
  show();
}

/* ---------- 文と数値 ---------- */
const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};
function showBusy(p: number): void {
  $('#mp3-busy').hidden = false;
  $('#mp3-prog').style.width = `${p * 100}%`;
}
const num = (v: number) => Math.round(v).toLocaleString('en-US');
function dbOfDiff(r: Result, x: Float32Array): string {
  let s = 0,
    e = 0;
  const d = r.diff[0];
  for (let i = 0; i < x.length; i += 4) {
    s += x[i] * x[i];
    e += d[i] * d[i];
  }
  return minus((10 * Math.log10(e / (s + 1e-12) + 1e-12)).toFixed(1));
}
let storyDirty = true,
  figDirty = true,
  overview = true,
  seen: Float32Array | null = null;
function show(): void {
  const r = res && res.kbps === S.kbps && res.lp === S.lp ? res : null,
    wait = !r && (!!orig || (!!srcKey && !decodeFail));
  $('#mp3-busy').hidden = !wait;
  if (!wait) $('#mp3-prog').style.width = '0';
  txt('#mp3-msg', decodeFail ? 'この環境では MP3 を復号できません' : '');
  if (orig && res) {
    const ch = orig.length,
      pcm = (ch * 705.6) / res.kbps;
    txt('#rd-ratio', `1/${Math.max(1, Math.round(pcm))}`);
    txt('#rd-over', (res.ev.over * 100).toFixed(1));
    txt('#rd-nmr', minus(res.ev.nmr.toFixed(1)));
    txt('#k-0', `${num((ch * 2 * orig[0].length) / 1000)} KB`);
    txt('#k-1', `${num(res.bytes.length / 1000)} KB`);
    txt('#k-2', `${dbOfDiff(res, orig[0])} dB`);
    txt('#how-set', `${res.kbps} kbps・${res.lp ? `ローパス ${lpKHz(res.lp)}` : 'ローパスなし'}`);
  }
  for (const b of $$<HTMLButtonElement>('#lp-pre .chip'))
    b.setAttribute('aria-pressed', String(b.dataset.v === 'none' ? S.lp === 0 : S.lp === LAME_LP[S.kbps]));
  storyDirty = true;
  figDirty = true;
  overview = true;
}

/* ---------- スペクトログラム ---------- */
const figs: [HTMLCanvasElement, SgMode][] = [
  [$<HTMLCanvasElement>('#sg-o'), 'orig'],
  [$<HTMLCanvasElement>('#sg-m'), 'mp3'],
  [$<HTMLCanvasElement>('#sg-n'), 'over'],
];
function drawFigs(): void {
  if (!res || !orig || !so) {
    for (const [c] of figs) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    return;
  }
  const dur = orig[0].length / FS,
    t = deck.pos(),
    pos = deck.playing || t > 0 ? t : null,
    key = `${srcKey}|${res.kbps}|${res.lp}`;
  drawSg(figs[0][0], { mode: 'orig', sg: so, lp: S.lp, dur }, srcKey, pos);
  drawSg(figs[1][0], { mode: 'mp3', sg: res.sd, lp: S.lp, dur, types: res.stats.types }, key, pos);
  drawSg(
    figs[2][0],
    { mode: 'over', sg: so, lp: S.lp, dur, ratio: res.ev.ratio, ratioT: res.ev.T, nBands: NBANDS },
    key,
    pos,
  );
}
/*
 * 選んでいない図を押すとその音を選ぶ（聴き比べられるよう位置は保つ）。選んでいる図を押すと再生位置を移動する。
 * 破線はドラッグでローパス。押した瞬間でなく click で受けるので、スマートフォンで図の上をスクロールしても反応しない
 */
for (const [i, [c, mode]] of figs.entries()) {
  let drag = false,
    /* 破線を実際に動かしたか。動かさずに押しただけなら、ふつうに押したのと同じに扱う */
    moved = false;
  const nearLine = (e: PointerEvent) => {
    if (!S.lp || mode === 'orig') return false;
    const r = c.getBoundingClientRect();
    return Math.abs(e.clientY - r.top - sgY(S.lp, mode, r.height)) < 10;
  };
  c.addEventListener('pointerdown', (e) => {
    moved = false;
    if (!nearLine(e)) return;
    drag = true;
    c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('click', (e) => {
    /* 破線のドラッグの終わりにも click が来る */
    if (moved) {
      moved = false;
      return;
    }
    if (deck.sel !== i) {
      deck.select(i);
      return;
    }
    const r = c.getBoundingClientRect();
    if (e.clientY - r.top <= sgBottom(mode, r.height))
      deck.seek(Math.max(0, sgTime(e.clientX - r.left, r.width)) * deck.dur);
    figDirty = true;
  });
  c.addEventListener('pointermove', (e) => {
    c.style.cursor = drag || nearLine(e) ? 'ns-resize' : '';
    if (!drag) return;
    const r = c.getBoundingClientRect(),
      f = sgF(e.clientY - r.top, mode, r.height),
      v = Math.max(4000, Math.min(20000, Math.round(f / 1000) * 1000));
    if (v !== S.lp) {
      moved = true;
      P.set('lp', v);
    }
  });
  /* 離したときも取り消されたときも来る */
  c.addEventListener('lostpointercapture', () => {
    drag = false;
  });
}

/* ---------- 試聴 ---------- */
const pp = $<HTMLButtonElement>('#ls-pp'),
  wv = $('#ls-wv'),
  keys = $$<HTMLButtonElement>('#ls-keys .mp3-key'),
  /* 聴く音と同じ並び: 原音・MP3・閾値を超えた雑音（原音との差に対応） */
  panes = $$<HTMLElement>('#mp3 .mp3-pane');
deck.onState = () => {
  pp.classList.toggle('on', deck.playing);
  const t = deck.playing ? '一時停止' : '再生';
  pp.setAttribute('aria-label', t);
  pp.title = t;
  keys.forEach((k, i) => {
    k.setAttribute('aria-pressed', String(i === deck.sel));
  });
  panes.forEach((p, i) => {
    p.classList.toggle('on', i === deck.sel);
  });
  overview = true;
  figDirty = true;
};
pp.addEventListener('click', () => deck.toggle());
$('#ls-keys').addEventListener('click', (e) => {
  const k = (e.target as Element).closest<HTMLElement>('.mp3-key');
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
$('#ls-save').addEventListener('click', () => {
  if (!res) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: 'audio/mpeg' }));
  a.download = `sample-${res.kbps}kbps${res.lp ? `-${lpView(res.lp)}Hz` : ''}.mp3`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- 入力 ---------- */
const tab = $('#ls-tab');
let ready = false;
const P = new ParamGroup<PKey>(PARAMS, (v, k) => {
  const before = S.kbps;
  S.kbps = v.kbps;
  S.lp = v.lp >= LP_NONE ? 0 : v.lp;
  deck.volume(v.vol);
  if (ready && k === 'kbps') {
    const lp = followLp(S.lp, before, S.kbps);
    if (lp !== S.lp) {
      S.lp = lp;
      P.set('lp', lp, { silent: true });
    }
  }
  if (!ready || k === 'vol') return;
  decodeFail = false;
  apply();
  pump();
});
new Choice<'test' | 'file'>($('#ls-src'), (v) => {
  S.kind = v;
  tab.dataset.src = v;
  setSource();
});
new Choice<SrcName>($('#p-src'), (v) => {
  S.src = v;
  setSource();
});
$('#lp-pre').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.chip');
  if (b) P.set('lp', b.dataset.v === 'none' ? LP_NONE : LAME_LP[S.kbps]);
});

/* ファイル: 選ぶ・枠へ落とす */
const fin = $<HTMLInputElement>('#ls-file'),
  pnl = $('.a-set');
async function open(f: File | undefined): Promise<void> {
  if (!f) return;
  const msg = $('#ls-fileMsg');
  msg.textContent = '読み込み中…';
  try {
    /* 44.1 kHz へ直して読む */
    const b = await new OfflineAudioContext(2, FS, FS).decodeAudioData(await f.arrayBuffer()),
      n = Math.min(b.length, FS * MAX);
    S.file = Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, c) => b.getChannelData(c).slice(0, n));
    fileN++;
    msg.textContent = `${f.name}・${b.duration <= MAX ? `${b.duration.toFixed(1)} 秒` : `先頭 ${MAX} 秒`}`;
    msg.classList.remove('er');
  } catch {
    msg.textContent = 'このファイルは読み込めませんでした（WAV・MP3・FLAC など）';
    msg.classList.add('er');
    return;
  }
  if (S.kind !== 'file') $<HTMLButtonElement>('#ls-src button[data-v="file"]').click();
  else setSource();
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

document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld()) deck.suspend();
});

/* ---------- MP3 のしくみ ---------- */
/** 1 工程の動く時間と止めて見せる時間 [s] */
const DURA = 3.4,
  HOLD = 1.8;
const St = { i: 0, t: RM.matches ? DURA : 0, run: !RM.matches, seen: false };
const cvH = $<HTMLCanvasElement>('#how-cv'),
  cards = $$<HTMLButtonElement>('#how-steps .mp3-st'),
  thumbs = cards.map((b) => $<HTMLCanvasElement>('canvas', b)),
  hpp = $<HTMLButtonElement>('#how-pp'),
  trk = $('#how-trk');

function pairNow(): LpPair | null {
  const cut = cutNow(),
    a = cache.get(keyOf(S.kbps, 0)),
    b = cache.get(keyOf(S.kbps, S.lp || cut));
  return a && b ? { cut, none: a.stats, with: b.stats, nmrNone: a.ev.nmr, nmrWith: b.ev.nmr } : null;
}
function storyData(): StoryData | null {
  if (!res || !orig || !res.stats.capture) return null;
  return {
    cap: res.stats.capture,
    stats: res.stats,
    x: orig[0],
    dur: orig[0].length / FS,
    pair: pairNow(),
    cut: cutNow(),
  };
}
function syncStep(): void {
  cards.forEach((b, i) => {
    const on = i === St.i;
    b.setAttribute('aria-pressed', String(on));
    if (on) {
      const w = b.parentElement;
      if (w) w.scrollLeft = b.offsetLeft - w.offsetLeft - (w.clientWidth - b.offsetWidth) / 2;
    }
  });
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
  const b = (e.target as Element).closest<HTMLElement>('.mp3-st');
  if (b) goStep(Number(b.dataset.i));
});
$('#how-prev').addEventListener('click', () => goStep(St.i - 1));
hpp.addEventListener('click', () => {
  St.run = !St.run;
  syncStep();
});
$('#to-mask').addEventListener('click', () => {
  const f = $('#hd-how');
  if (f.getAttribute('aria-expanded') === 'false') f.click();
  goStep(2);
  $('.a-how').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
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
new IntersectionObserver(
  ([e]) => {
    St.seen = e.isIntersecting;
    storyDirty = true;
    pump();
  },
  { threshold: 0.3 },
).observe(cvH);
let lastI = -1;
function drawHow(dt: number): void {
  /* 結果が変わったら、画面の外でも描いておく（スクロールしたときに空にならないように） */
  if (!St.seen && !storyDirty) return;
  if (St.seen && St.run) {
    St.t += dt;
    if (St.t >= DURA + HOLD) goStep(St.i + 1);
  }
  const u = Math.min(1, St.t / DURA),
    d = storyData();
  drawStory(cvH, St.i, u, d);
  if (storyDirty || lastI !== St.i) {
    txt('#how-cap', caption(St.i, d));
    lastI = St.i;
  }
  if (storyDirty) {
    storyDirty = false;
    thumbs.forEach((c, i) => {
      drawStory(c, i, 1, d, true);
    });
  }
  const p = ((St.i + u) / STEPS.length) * 100;
  $('#how-fill').style.width = `${p}%`;
  $('#how-th').style.left = `${p}%`;
  trk.setAttribute('aria-valuenow', String(St.i + 1));
}

/* ---------- 毎フレーム ---------- */
const recolor = () => {
  readCols(root);
  show();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  figDirty = true;
  overview = true;
  storyDirty = true;
}).observe(root);
let last = 0;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  drawHow(dt);
  if (deck.playing || figDirty) {
    figDirty = false;
    drawFigs();
  }
  const cur = deck.cur;
  if (cur && (overview || cur !== seen)) {
    overview = false;
    seen = cur;
    drawOverview($<HTMLCanvasElement>('#ls-wc'), cur, deck.sel === 0 ? COL.ink3 : deck.sel === 1 ? COL.ch1 : COL.over);
  }
  const d = deck.dur,
    t = deck.pos();
  $('#ls-ph').style.left = `${(d ? (100 * t) / d : 0).toFixed(3)}%`;
  txt('#ls-tm', `${t.toFixed(2)} / ${d.toFixed(2)} s`);
  wv.setAttribute('aria-valuemax', d.toFixed(2));
  wv.setAttribute('aria-valuenow', t.toFixed(2));
  requestAnimationFrame(loop);
}
readCols(root);
tab.dataset.src = S.kind;
syncStep();
ready = true;
queueMicrotask(() => {
  setSource();
  show();
});
requestAnimationFrame(loop);

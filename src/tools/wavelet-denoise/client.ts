/**
 * ウェーブレットで雑音除去と圧縮のページの入口（案 A 聴き比べ卓）。
 * 音源（試しの音・ファイル・マイク）を計算のワーカーへ渡し、返ってきた音を同じ位置で切り替えて鳴らす。
 * 前後のスカログラム・段ごとの σ と λ・基底ごとの SN 比とビット数を描く
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { initToolPage } from '../../lib/tool-page';
import type { Wav } from '../wavelet/dwt';
import { type Clip, clip, type Noise, quietest, rms } from './clips';
import { Deck } from './deck';
import { el, fx, html, lutOf, paintGrid, svgPt, txt, wave } from './fig';
import type { PKey } from './params';
import { PARAMS } from './params';
import { Recorder } from './rec';
import { BASES, type Basis } from './run';
import type { DnSet } from './set';
import type { Rule, SigmaMode } from './thresh';
import { type CpOut, type DnOut, type Job, type Out, SC_F, SC_HOP } from './worker';

initToolPage();

type Mode = 'dn' | 'cp';
type SrcKind = 'test' | 'file' | 'mic';
interface Source {
  x: Float32Array;
  fs: number;
  quiet: [number, number];
}

/** 試しの音の標本化周波数・長さ・頭の無音 [s]、ファイルとマイクの長さの上限 [s]、色の下限 dBFS、目盛りの範囲 */
const TEST_FS = 48000,
  TEST_DUR = 3,
  TEST_LEAD = 0.5,
  MAX = 10,
  LO = -90,
  W = 400,
  H = 160,
  R = SC_F.length;

const root = $('#wd'),
  deck = new Deck(),
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  lut = lutOf('#wd'),
  keys = $$<HTMLButtonElement>('#ab-keys .key');

const S = {
  mode: 'dn' as Mode,
  src: 'test' as SrcKind,
  clip: 'drums' as Clip,
  file: null as Source | null,
  mic: null as Source | null,
  set: { noise: 'white', snrIn: 10, w: 'db4', J: 8, rule: 'sure', sm: 'global', m: 'soft', k: 1, spin: 1 } as DnSet,
  keep: 0.05,
  basis: 'wav' as Basis,
};
let res: Out | null = null,
  cur: Source | null = null,
  tracks: Float32Array[] = [];

/* ---------- 計算のワーカー: 動いている間に頼まれたら、終わってから最新の条件で 1 度だけ頼み直す ---------- */
let srcN = 0,
  jobN = 0,
  busy = false,
  again = false,
  timer = 0;
const testCache = new Map<Clip, Source>();
function source(): Source | null {
  if (S.src === 'file') return S.file;
  if (S.src === 'mic') return S.mic;
  let s = testCache.get(S.clip);
  if (!s) {
    s = { x: clip(S.clip, TEST_FS, TEST_DUR, TEST_LEAD), fs: TEST_FS, quiet: [0, Math.round(TEST_LEAD * TEST_FS)] };
    testCache.set(S.clip, s);
  }
  return s;
}
function post(): void {
  const s = source();
  if (s !== cur) {
    cur = s;
    res = null;
    if (s) worker.postMessage({ kind: 'src', src: ++srcN, x: s.x, fs: s.fs, quiet: s.quiet } satisfies Job);
  }
  if (!s) {
    show();
    return;
  }
  busy = true;
  $('#ab-busy').hidden = false;
  const id = ++jobN;
  worker.postMessage(
    (S.mode === 'dn'
      ? { kind: 'dn', id, set: { ...S.set } }
      : { kind: 'cp', id, basis: S.basis, keep: S.keep, w: S.set.w }) satisfies Job,
  );
}
/** 条件が変わった（続けて変わることがあるので、まとめてから頼む） */
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
  $('#ab-busy').hidden = true;
  if (e.data.id !== jobN) return;
  res = e.data;
  show();
};

/* ---------- 表示 ---------- */
const COL: Record<Mode, string[]> = {
  dn: ['--ink-3', '--ch2', '--ch1', '--accent'],
  cp: ['--ink-3', '--ch1', '--accent'],
};
const css = (v: string) => getComputedStyle(root).getPropertyValue(v).trim();
const dbfs = (x: Float32Array) => `実効値 ${fx(20 * Math.log10(rms(x) + 1e-12))} dBFS`;
const pct = (v: number) => fx(100 * v, v < 0.1 ? 2 : 1);
/** 数値の 1 項目。main は枠の主な結果（大きく出し、画面から外れたら上の帯に要約を出す） */
const m = (dt: string, dd: string, u = '', main = false) =>
  `<div class="m${main ? ' m-main' : ''}"><dt>${dt}</dt><dd>${dd}${u ? `<span class="u">${u}</span>` : ''}</dd></div>`;
const kLab = (f: number) => (f >= 1000 ? `${Number((f / 1000).toFixed(1))}k` : String(Math.round(f)));

/** 結果がそろったら、音・キー・波形・スカログラム・数値を入れ替える */
function show(): void {
  root.dataset.m = S.mode;
  const dn = S.mode === 'dn',
    r = res,
    s = cur;
  for (const k of keys) {
    const b = k.querySelector('b');
    if (b) b.textContent = (dn ? b.dataset.dn : b.dataset.cp) ?? '';
    k.hidden = !dn && k.dataset.i === '3';
  }
  txt('#hd-pr', dn ? '雑音除去' : '圧縮');
  if (!s || !r || r.kind !== S.mode) {
    if (!s) {
      tracks = [];
      deck.set([], TEST_FS);
      for (const k of ['b', 'a']) paintGrid($(`#sc-c${k}`), lut, new Float32Array(0), R, 0, LO);
      html('#pr-out', '');
      html('#pr-tab', '');
      for (let i = 0; i < 4; i++) txt(`#ab-km${i}`, '');
      drawWave();
    }
    return;
  }
  if (r.kind === 'dn') {
    const d = r as DnOut,
      none = S.set.noise === 'none';
    tracks = [s.x, d.noisy, d.out, d.removed];
    txt('#ab-km0', '');
    txt('#ab-km1', none ? dbfs(d.noisy) : `SN 比 ${fx(d.snrIn)} dB`);
    txt('#ab-km2', none ? dbfs(d.out) : `SN 比 ${fx(d.snrOut)} dB`);
    txt('#ab-km3', dbfs(d.removed));
    txt('#sc-hb', none ? '処理の前' : '雑音入り');
    txt('#sc-ha', '除いた後');
    html(
      '#pr-out',
      (none
        ? m('取り除いた成分', fx(20 * Math.log10(rms(d.removed) + 1e-12)), 'dBFS', true)
        : m('除いた後の SN 比', fx(d.snrOut), 'dB', true) + m('改善', fx(d.snrOut - d.snrIn), 'dB')) +
        m('残した係数', pct(d.kept / d.total), '%'),
    );
    html('#pr-tab', levelTable(d, s.fs));
    txt('#m-snr', none ? '—' : `${fx(d.snrOut)} dB`);
    txt('#m-kept', `${pct(d.kept / d.total)} %`);
    setMiniX('改善', none ? '—' : `${fx(d.snrOut - d.snrIn)} dB`);
  } else {
    const c = r as CpOut,
      row = c.rows.find((x) => x.b === S.basis) ?? c.rows[0],
      pcm = (16 * s.fs) / 1000;
    tracks = [s.x, c.out, c.diff];
    txt('#ab-km0', `PCM 16 ビット ${fx(pcm, 0)} kbps`);
    txt('#ab-km1', `SN 比 ${fx(row.snr)} dB・${fx(row.kbps, 0)} kbps`);
    txt('#ab-km2', dbfs(c.diff));
    txt('#sc-hb', '原音');
    txt('#sc-ha', `圧縮後（${BASES.find((b) => b[0] === S.basis)?.[1]}）`);
    html(
      '#pr-out',
      m('SN 比', fx(row.snr), 'dB') +
        m('おおよそ', fx(row.kbps, 0), 'kbps') +
        m('残した係数', pct(c.kept / s.x.length), '%'),
    );
    html('#pr-tab', basisTable(c, pcm));
    txt('#m-snr', `${fx(row.snr)} dB`);
    txt('#m-kept', `${pct(c.kept / s.x.length)} %`);
    setMiniX('kbps', fx(row.kbps, 0));
  }
  deck.set(tracks, s.fs);
  paintGrid($('#sc-cb'), lut, r.scBefore.d, R, r.scBefore.cols, LO);
  paintGrid($('#sc-ca'), lut, r.scAfter.d, R, r.scAfter.cols, LO);
  axes(s.x.length / s.fs);
  drawWave();
  syncKeys();
}
function setMiniX(label: string, v: string): void {
  const sp = $('#m-xl'),
    t = sp.firstChild;
  if (t && t.nodeType === Node.TEXT_NODE && t.textContent !== label) t.textContent = label;
  txt('#m-x', v);
}

/** 段ごとの帯域・σ・λ・残した割合 */
function levelTable(d: DnOut, fs: number): string {
  let rows = '';
  for (let j = 0; j < d.sig.length; j++) {
    const p = 100 * d.keptJ[j];
    rows += `<tr><td>d${j + 1}</td><td class="n">${kLab(fs / 2 ** (j + 2))}〜${kLab(fs / 2 ** (j + 1))}</td><td class="n">${fx(d.sig[j] * 1000, 2)}</td><td class="n">${fx(d.lam[j] * 1000, 2)}</td><td class="n"><span class="pbar" style="--p:${p.toFixed(1)}%"></span>${fx(p)}</td></tr>`;
  }
  const J = d.sig.length;
  rows += `<tr><td>a${J}</td><td class="n">〜${kLab(fs / 2 ** (J + 1))}</td><td class="n" colspan="2">処理しない</td><td class="n"><span class="pbar" style="--p:100%"></span>100</td></tr>`;
  return `<table class="tt"><thead><tr><th>段</th><th class="n">帯域 Hz</th><th class="n">σ ×10⁻³</th><th class="n">λ ×10⁻³</th><th class="n">残した %</th></tr></thead><tbody>${rows}</tbody></table>`;
}
/** 基底ごとの SN 比とビット数（行を押すとその基底を聴く） */
function basisTable(c: CpOut, pcm: number): string {
  const rows = c.rows
    .map((r) => {
      const l = BASES.find((b) => b[0] === r.b)?.[1] ?? r.b;
      return `<tr class="${r.b === S.basis ? 'on' : ''}"><td><button type="button" class="lnk" data-b="${r.b}" aria-pressed="${r.b === S.basis}">${l}</button></td><td class="n">${fx(r.snr)}</td><td class="n">${fx(r.snrKeep)}</td><td class="n">${fx(r.kbps, 0)}</td><td class="n">${fx(pcm / r.kbps, 0)}</td></tr>`;
    })
    .join('');
  return `<table class="tt"><thead><tr><th>基底</th><th class="n">SN 比 dB</th><th class="n">量子化なし</th><th class="n">kbps</th><th class="n">PCM の 1/n</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* 波形: 原音（灰）の上に聴いている音 */
function drawWave(): void {
  const cv = $<HTMLCanvasElement>('#ab-wc'),
    q = $('#ab-qz'),
    s = cur;
  if (!s || !tracks.length) {
    wave(cv, []);
    q.hidden = true;
    return;
  }
  const i = Math.min(deck.sel, tracks.length - 1);
  wave(cv, [
    { x: tracks[0], color: css('--line-2') },
    ...(i ? [{ x: tracks[i], color: css(COL[S.mode][i]) }] : [{ x: tracks[0], color: css('--ink-3') }]),
  ]);
  /* 雑音だけの区間（静かな区間から σ を測るとき） */
  q.hidden = !(S.mode === 'dn' && S.set.sm === 'quiet');
  q.style.left = `${(100 * s.quiet[0]) / s.x.length}%`;
  q.style.width = `${(100 * (s.quiet[1] - s.quiet[0])) / s.x.length}%`;
}
function syncKeys(): void {
  keys.forEach((k, i) => {
    k.setAttribute('aria-pressed', String(i === deck.sel));
  });
}

/* スカログラムの目盛り（上が高い周波数） */
const yOf = (f: number) => H - ((Math.log2(f / SC_F[0]) * 8 + 0.5) / R) * H;
function axes(dur: number): void {
  const st = dur > 6 ? 2 : dur > 3 ? 1 : 0.5;
  for (const k of ['b', 'a']) {
    const g = $(`#sc-s${k} .ax`);
    g.replaceChildren();
    for (const f of [100, 300, 1000, 3000, 10000])
      g.append(el('text', { x: -6, y: yOf(f) + 4, 'text-anchor': 'end' }, kLab(f)));
    g.append(el('text', { x: -6, y: -4, 'text-anchor': 'end' }, 'Hz'));
    for (let t = 0; t <= dur + 1e-9; t += st) {
      const last = t + st > dur + 1e-9;
      g.append(
        el(
          'text',
          { x: (t / dur) * W, y: H + 16, 'text-anchor': t === 0 ? 'start' : last ? 'end' : 'middle' },
          last ? `${Number(t.toFixed(1))} s` : String(Number(t.toFixed(1))),
        ),
      );
    }
    g.append(el('rect', { class: 'gb', x: 0, y: 0, width: W, height: H }));
  }
}

/* スカログラムの読み値 */
let curP: [number, number] | null = null;
for (const k of ['b', 'a']) {
  const ov = $<SVGSVGElement>(`#sc-s${k}`);
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
  const r = res;
  if (!curP || !r || !cur) {
    for (const k of ['b', 'a']) $(`#sc-cur${k}`).setAttribute('d', '');
    txt('#sc-rd', '');
    return;
  }
  const [x, y] = curP,
    cols = r.scBefore.cols,
    q = Math.min(cols - 1, Math.floor((x / W) * cols)),
    row = Math.max(0, Math.min(R - 1, Math.floor(((H - y) / H) * R))),
    v = (d: Float32Array) => fx(Math.max(-199, d[row * cols + q]));
  for (const k of ['b', 'a']) $(`#sc-cur${k}`).setAttribute('d', `M${x.toFixed(1)} 0V${H}M0 ${y.toFixed(1)}H${W}`);
  txt('#sc-rd', `t ${fx(q * SC_HOP, 2)} s  f ${kLab(SC_F[row])} Hz  前 ${v(r.scBefore.d)}  後 ${v(r.scAfter.d)} dBFS`);
}

/* ---------- 再生 ---------- */
const pp = $<HTMLButtonElement>('#ab-pp'),
  wv = $('#ab-wv');
deck.onState = () => {
  pp.classList.toggle('on', deck.playing);
  const t = deck.playing ? '一時停止' : '再生する';
  pp.setAttribute('aria-label', t);
  syncKeys();
  drawWave();
};
pp.addEventListener('click', () => deck.toggle());
$('#ab-home').addEventListener('click', () => deck.seek(0));
$('#ab-keys').addEventListener('click', (e) => {
  const k = (e.target as Element).closest<HTMLElement>('.key');
  if (k) deck.select(Number(k.dataset.i));
});
/* 波形を押す・なぞると頭出し */
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
/* 1〜4 で聴く音、スペースで再生（入力欄・スライダーの中は除く） */
document.addEventListener('keydown', (e) => {
  const t = e.target as Element;
  if (t.closest('input,textarea,select,[contenteditable],.sc,.sc-in') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^Digit[1-4]$/.test(e.code)) {
    const i = Number(e.code.slice(5)) - 1;
    if (!keys[i]?.hidden) deck.select(i);
  } else if (e.code === 'Space') {
    if (t.closest('button,a,[role=slider]') && !t.closest('.key,#ab-wv')) return;
    e.preventDefault();
    deck.toggle();
  }
});

/* ---------- 入力 ---------- */
const tab = $('#ab-tab');
function setSrc(v: SrcKind): void {
  S.src = v;
  tab.dataset.src = v;
  if (v !== 'mic' && rec.on) rec.stop();
  run();
}
new Choice<SrcKind>($('#ab-src'), setSrc);
new Choice<Clip>($('#p-clip'), (v) => {
  S.clip = v;
  run();
});
new Choice<Mode>($('#ab-mode'), (v) => {
  S.mode = v;
  deck.sel = v === 'dn' ? 2 : 1;
  res = null;
  show();
  run();
});
new Choice<Basis>($('#ab-b'), (v) => {
  S.basis = v;
  run();
});
$('#pr-tab').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-b]');
  if (!b?.dataset.b) return;
  const v = b.dataset.b as Basis;
  $<HTMLButtonElement>(`#ab-b button[data-v="${v}"]`).click();
});
const pick = <K extends keyof DnSet>(id: string, k: K, f: (v: string) => DnSet[K]) =>
  new Choice<string>($(id), (v) => {
    S.set[k] = f(v);
    if (k === 'sm') drawWave();
    run();
  });
pick('#p-noise', 'noise', (v) => v as Noise | 'none');
pick('#p-rule', 'rule', (v) => v as Rule);
pick('#p-m', 'm', (v) => v as DnSet['m']);
pick('#p-sm', 'sm', (v) => v as SigmaMode);
pick('#p-spin', 'spin', Number);
pick('#p-w', 'w', (v) => v as Wav);
new ParamGroup<PKey>(PARAMS, (v) => {
  S.set.snrIn = v.snr;
  S.set.k = v.k;
  S.keep = v.keep / 100;
  run();
});

/* ファイル: 選ぶ・枠へ落とす */
const fin = $<HTMLInputElement>('#ab-file'),
  pnl = $('.a-ab');
async function open(f: File | undefined): Promise<void> {
  if (!f) return;
  const a = deck.ctx(),
    msg = $('#ab-fileMsg');
  if (!a) {
    msg.textContent = 'この環境では音声を扱えません';
    return;
  }
  msg.textContent = '読み込んでいます…';
  try {
    const b = await a.decodeAudioData(await f.arrayBuffer()),
      n = Math.min(b.length, Math.round(b.sampleRate * MAX)),
      x = new Float32Array(n);
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) x[i] += d[i] / b.numberOfChannels;
    }
    S.file = { x, fs: b.sampleRate, quiet: quietest(x, b.sampleRate) };
    msg.textContent = `${f.name} · ${b.duration <= MAX ? `${fx(b.duration)} 秒` : `先頭 ${MAX} 秒`}`;
    msg.classList.remove('er');
  } catch {
    msg.textContent = 'このファイルは読み込めませんでした（WAV・MP3・FLAC など）';
    msg.classList.add('er');
    return;
  }
  if (S.src !== 'file') $<HTMLButtonElement>('#ab-src button[data-v="file"]').click();
  else run();
}
$('#ab-fileBtn').addEventListener('click', () => fin.click());
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
  const b = $('#ab-rec');
  b.setAttribute('aria-pressed', String(rec.on));
  $('#ab-recLed').classList.toggle('on', rec.on);
  txt('#ab-recT', rec.on ? '止める' : '録る');
  txt(
    '#ab-micMsg',
    rec.msg ||
      (rec.on
        ? `録っています ${fx(rec.sec)} / ${MAX} 秒`
        : S.mic
          ? `${fx(S.mic.x.length / S.mic.fs)} 秒`
          : 'まだ録っていません'),
  );
};
rec.onDone = (x, fs) => {
  S.mic = { x, fs, quiet: quietest(x, fs) };
  rec.onChange();
  if (S.src === 'mic') run();
};
$('#ab-rec').addEventListener('click', () => {
  if (rec.on) rec.stop();
  else {
    deck.pause();
    void rec.start();
  }
});

/* スマートフォンで画面が隠れたら止める */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !handheld()) return;
  deck.suspend();
  rec.stop();
});
addEventListener('resize', drawWave);

/* ---------- 毎フレーム: 再生の位置 ---------- */
function loop(): void {
  const d = deck.dur,
    t = deck.pos(),
    f = d ? t / d : 0,
    ph = `M${(f * W).toFixed(1)} 0V${H}`;
  $('#ab-ph').style.left = `${(100 * f).toFixed(3)}%`;
  for (const k of ['b', 'a']) {
    const p = $(`#sc-ph${k}`);
    if (p.getAttribute('d') !== ph) p.setAttribute('d', d ? ph : '');
  }
  txt('#ab-tm', `${t.toFixed(2)} / ${d.toFixed(2)} s`);
  wv.setAttribute('aria-valuemax', d.toFixed(2));
  wv.setAttribute('aria-valuenow', t.toFixed(2));
  requestAnimationFrame(loop);
}
deck.sel = 2;
run();
requestAnimationFrame(loop);

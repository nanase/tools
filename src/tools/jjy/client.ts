/** JJY シミュレータの入口: 時刻の進行 → 1 分ぶんの符号 → 時刻・タイムコード・式・音 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmt } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { addTip, initToolPage } from '../../lib/tool-page';
import { JjyAudio } from './audio';
import { CNAME, CSIG, callSignOn, DEFAULTS, type Minute, meaning, type Options, Signal, stopOn } from './code';
import { drawFan } from './fan';
import { substHtml } from './math';
import { apply, OPT_ROWS, offRows, rowNotes } from './options';
import { type Key, PARAMS } from './params';
import { diffHtml, jst, p2, WD } from './time';

initToolPage();
addTip($('#syncBtn'), $('#syncTip'), $('.a-snd'), true);

const opt: Options = { ...DEFAULTS };
const sig = new Signal(opt);

/* ---------- 時刻の進行 ---------- */
/** diff: 実時刻 − 表示時刻（ms）、frozen: 停止中の表示時刻 */
let diff = 0,
  frozen: number | null = null;
const simNow = () => frozen ?? Date.now() - diff;

const audio = new JjyAudio(sig, { now: simNow, frozen: () => frozen !== null });

/* ---------- 送出する情報 ---------- */
const optRows = OPT_ROWS.map((row) => ({
  row,
  c: new Choice($(`#p-${row.k}`), (v) => {
    apply(opt, row, v);
    optChanged();
  }),
  off: undefined as boolean | undefined,
}));
function syncOpts(t: Minute['t']): void {
  const off = offRows(opt),
    notes = rowNotes(t, opt);
  for (const r of optRows) {
    const k = r.row.k,
      o = !!off[k];
    r.c.set(String(opt[k]));
    if (r.off !== o) r.c.setOff(o);
    r.off = o;
    r.c.note(notes[k]);
  }
}

const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};

/* ---------- 音 ---------- */
const g = new ParamGroup<Key>(PARAMS, (v) => {
  audio.freq = v.f;
  audio.vol = v.vol;
  audio.params();
});
/** 再生（枠の右上のボタン）。鳴らせなかったときは音の種類の行に知らせる */
const playBtn = $('#playBtn');
let playErr = '';
playBtn.addEventListener('click', async () => {
  const ok = await audio.setPlay(!audio.play);
  playErr = ok ? '' : '音を出せませんでした';
  syncSnd();
});
const mode = new Choice<'tone' | 'sync'>($('#p-mode'), (v) => {
  audio.mode = v;
  audio.params();
  syncSnd();
});
function syncSnd(): void {
  playBtn.setAttribute('aria-pressed', String(audio.play));
  /* 双2次フィルタの再生ボタンと同じく、鳴らしている間は LED を点ける */
  $('#sndLed').classList.toggle('on', audio.play);
  txt('#playT', audio.play ? '停止' : '再生');
  const fixed = audio.mode === 'sync',
    sr = audio.sampleRate;
  g.setOff('f', fixed, '時刻合わせでは 13.333 kHz に固定します');
  mode.note(playErr || (fixed && sr ? `出力のサンプリング周波数 ${fmt(sr, 'Hz')}` : ''), playErr ? 'er' : '');
}

/* ---------- 時刻・タイムコード ---------- */
const tc = $('#tc'),
  bars = $$('.tb', tc),
  CODES = ['tc-P', 'tc-0', 'tc-1', 'tc-S'];
let cur: Minute | null = null,
  curMin = Number.NaN,
  curSec = -1,
  /** 押して固定した秒と、マウスで指している秒（-1 はなし） */
  pinned = -1,
  hover = -1;

function rebuild(m0: number): void {
  cur = sig.minute(m0);
  curMin = m0;
  const { t, codes } = cur;
  codes.forEach((k, s) => {
    bars[s].classList.remove(...CODES);
    bars[s].classList.add(`tc-${k}`);
  });
  txt('#w-aux', `${p2(t.h)}:${p2(t.mi)} の符号`);
  tc.setAttribute(
    'aria-label',
    `${p2(t.h)} 時 ${p2(t.mi)} 分のタイムコード: ${codes.join('')}。矢印キーで選ぶ秒を動かします。`,
  );
  syncOpts(t);
  html('#subst', substHtml(codes));
  curSec = -1;
}
function optChanged(): void {
  sig.clear();
  rebuild(curMin);
  showCursor();
  audio.resync();
}

function clock(ms: number): void {
  if (!cur) return;
  const t = jst(ms),
    hms = `${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}`;
  txt('#o-time', hms);
  txt('#o-date', `${t.y}/${p2(t.mo)}/${p2(t.d)}`);
  html('#o-wd', `${WD[t.wd]}曜日<span class="u">${t.wd}</span>`);
  html('#o-doy', `${t.doy}<span class="u">日目</span>`);
  txt('#mt', hms);
  txt('#ms', p2(t.s));
  txt('#mc', cur.codes[t.s] === 'S' ? 'S' : t.s === 0 ? 'M' : cur.codes[t.s]);
}

const run = new Choice($('#run'), (v) => {
  if (v === '1' && frozen !== null) {
    diff = Date.now() - frozen;
    frozen = null;
  } else if (v === '0' && frozen === null) frozen = simNow();
  syncRun();
  audio.resync();
});
const nowBtn = $<HTMLButtonElement>('#nowBtn');
let lastDiff = '';
function syncRun(): void {
  const h = diffHtml(simNow() - Date.now());
  if (h !== lastDiff) {
    html('#o-diff', h);
    lastDiff = h;
  }
  nowBtn.disabled = frozen === null && diff === 0;
  run.set(frozen === null ? '1' : '0');
}
nowBtn.addEventListener('click', () => {
  diff = 0;
  frozen = null;
  syncRun();
  audio.resync();
});

/* 選ぶ秒: 既定は現在の秒を追う。押すと固定し、もう一度押すか「現在の秒に戻す」で戻す */
const follow = $<HTMLButtonElement>('#follow');
function showCursor(): void {
  if (!cur) return;
  const s = hover >= 0 ? hover : pinned >= 0 ? pinned : Math.max(0, curSec),
    k = cur.codes[s],
    mi = cur.t.mi;
  bars.forEach((b, i) => {
    b.classList.toggle('sel', i === s);
    b.classList.toggle('now', i === curSec);
  });
  html('#b-s', `${s}<span class="u">秒</span>`);
  html('#b-c', `${s === 0 ? 'M' : k}<span class="u">${CNAME[k]}</span>`);
  txt('#b-sig', CSIG[k]);
  txt('#b-mean', meaning(s, callSignOn(mi, opt), stopOn(mi, opt)));
  follow.disabled = pinned < 0;
}
const barAt = (e: Event) => {
  const b = (e.target as Element).closest<HTMLElement>('.tb');
  return b ? Number(b.dataset.s) : -1;
};
const cols = () => getComputedStyle(tc).gridTemplateColumns.split(' ').length;
tc.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const s = barAt(e);
  if (s >= 0 && s !== hover) {
    hover = s;
    showCursor();
  }
});
tc.addEventListener('pointerleave', () => {
  if (hover < 0) return;
  hover = -1;
  showCursor();
});
tc.addEventListener('click', (e) => {
  const s = barAt(e);
  if (s < 0) return;
  pinned = pinned === s ? -1 : s;
  hover = -1;
  showCursor();
});
tc.addEventListener('keydown', (e) => {
  const base = pinned >= 0 ? pinned : Math.max(0, curSec),
    c = cols();
  const mv = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -c, ArrowDown: c } as Record<string, number>)[e.key];
  if (mv != null) pinned = (base + mv + 60) % 60;
  else if (e.key === 'Home') pinned = 0;
  else if (e.key === 'End') pinned = 59;
  else if (e.key === 'Escape' && pinned >= 0) pinned = -1;
  else return;
  e.preventDefault();
  hover = -1;
  showCursor();
});
follow.addEventListener('click', () => {
  pinned = -1;
  showCursor();
});

const fan = $<SVGElement>('#fan');

function frame(): void {
  const t = simNow(),
    m0 = Math.floor(t / 60000) * 60000;
  drawFan(fan, t);
  if (m0 !== curMin) rebuild(m0);
  const s = Math.floor((t - m0) / 1000);
  if (s !== curSec) {
    curSec = s;
    clock(t);
    showCursor();
  }
  requestAnimationFrame(frame);
}

/* ---------- 起動 ---------- */
syncSnd();
syncRun();
setInterval(syncRun, 200);
requestAnimationFrame(frame);

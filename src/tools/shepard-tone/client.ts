/**
 * 無限音階のページの入口。音はワークレットで作り、画面は送られた位置で描く。
 * 開いた直後は自動で音を出せないので、計算で描いたスペクトログラムを音なしで流し、再生を押すと実際の音の分析に替える
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { handheld } from '../../lib/pause';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { readCols } from '../pcm/fig';
import { ShepardAudio } from './audio';
import { centText, chordName, drawLevels, drawRing, octText, ShepardSpec } from './fig';
import { PARAMS, type PKey, REVERBS, type ReverbId } from './params';
import { CHORDS, type ChordId, noteOf, octOf, Shepard, type TimbreId } from './shepard';

initToolPage();

const root = $('#shepard-tone'),
  audio = new ShepardAudio(),
  /* 音を作らず、位置と音の一覧だけに使う */
  model = new Shepard(48000),
  spec = new ShepardSpec($<HTMLCanvasElement>('#sht-sp'));

const S = {
  chord: 'fifth' as ChordId,
  reverb: 'church' as ReverbId,
  wet: 1,
  playing: false,
  /** まだ 1 度も再生していない */
  preview: true,
  /** 残響が消えるまで図を流す時刻 [ms] */
  tailEnd: 0,
  levels: false,
  ring: false,
};

const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};
const dirOf = (v: string): 1 | -1 => (v === '-1' ? -1 : 1);

/* ---------- 再生と音程の変化 ---------- */
const playBtn = $<HTMLButtonElement>('#sht-play'),
  holdBtn = $<HTMLButtonElement>('#sht-hold');
function syncUi(): void {
  playBtn.setAttribute('aria-pressed', String(S.playing));
  playBtn.classList.toggle('on', S.playing);
  txt('#sht-playT', S.playing ? '停止' : '再生');
  holdBtn.setAttribute('aria-pressed', String(!model.moving));
  holdBtn.classList.toggle('on', !model.moving);
  txt('#sht-holdT', model.moving ? '音程の変化を停止' : '音程の変化を再開');
  $('#sht-led').classList.toggle('on', S.playing);
  const way = !model.moving ? '音程の変化を停止中' : model.dir > 0 ? '上昇' : '下降';
  txt('#sht-st', S.playing ? `再生中・${way}` : S.preview ? `待機中・${way}` : '停止');
}
function stop(): void {
  if (!S.playing) return;
  S.playing = false;
  S.tailEnd = performance.now() + (REVERBS[S.reverb].t60 * 1.15 + 0.6) * 1000;
  model.on = false;
  audio.post({ type: 'play', on: false, pos: model.pos });
  syncUi();
}
playBtn.addEventListener('click', () => {
  if (S.playing) {
    stop();
    return;
  }
  S.playing = true;
  S.preview = false;
  audio.post({ type: 'play', on: true, pos: model.pos });
  syncUi();
  void audio.ready().then((ok) => {
    if (ok) return;
    S.playing = false;
    syncUi();
  });
});
holdBtn.addEventListener('click', () => {
  model.moving = !model.moving;
  audio.post({ type: 'moving', on: model.moving });
  syncUi();
});
audio.onPos = (m) => {
  model.pos = m.pos;
  model.vel = m.vel;
};

/* ---------- 入力 ---------- */
new Choice<string>($('#p-dir'), (v) => {
  model.dir = dirOf(v);
  audio.post({ type: 'dir', v: model.dir });
  syncUi();
});
new Choice<string>($('#p-step'), (v) => {
  model.stepped = v === '1';
  audio.post({ type: 'stepped', on: model.stepped });
});
function applyChord(v: ChordId): void {
  S.chord = v;
  model.setChord(CHORDS[v].s);
  audio.post({ type: 'chord', s: CHORDS[v].s });
}
function applyTimbre(v: TimbreId): void {
  model.setTimbre(v);
  audio.post({ type: 'timbre', id: v });
}
/* 音の計算の既定（長三和音・正弦波）とページの既定が違うので、初めの値も送る */
applyChord(new Choice<ChordId>($('#p-chord'), applyChord).value);
applyTimbre(new Choice<TimbreId>($('#p-timbre'), applyTimbre).value);
/** 1 オクターブの秒数の表記 */
const octSec = (r: number): string => {
  const t = 12 / r;
  return t < 10 ? t.toFixed(1) : t.toFixed(0);
};
function applyParams(v: Record<PKey, number>): void {
  model.rate = v.rate;
  audio.post({ type: 'rate', v: v.rate });
  S.wet = v.wet / 100;
  audio.reverb(S.reverb, S.wet);
  audio.vol(v.vol);
  model.center = octOf(v.center);
  model.width = v.width;
  audio.post({ type: 'range', center: model.center, width: model.width });
}
const params = new ParamGroup<PKey>(PARAMS, applyParams);
const noteRate = (r: number) => params.note('rate', `1 オクターブ ${octSec(r)} 秒`);
noteRate(params.get('rate'));
params.on('rate', noteRate);
const syncReverb = () => {
  const t60 = REVERBS[S.reverb].t60;
  params.setOff('wet', !t60, t60 ? '' : '残響なし');
  params.note('wet', t60 ? `残響時間 ${t60} 秒` : '');
};
new Choice<ReverbId>($('#p-reverb'), (v) => {
  S.reverb = v;
  audio.reverb(v, S.wet);
  syncReverb();
});
syncReverb();

/* ---------- 追加の表示 ---------- */
const view = $('#sht-view'),
  specBox = $('#sht-specw'),
  ringPanel = $('.sht-ringp'),
  legend = $('#sht-lg');
function syncView(): void {
  for (const b of $$<HTMLButtonElement>('[data-view]')) {
    const on = b.dataset.view === 'levels' ? S.levels : S.ring;
    b.setAttribute('aria-pressed', String(on));
    $('.led', b).classList.toggle('on', on);
  }
  view.classList.toggle('ring', S.ring);
  specBox.classList.toggle('levels', S.levels);
  ringPanel.hidden = !S.ring;
  legend.hidden = !S.levels && !S.ring;
}
S.levels = stored('v:levels') === true;
S.ring = stored('v:ring') === true;
$('#sht-opts').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-view]');
  if (!b) return;
  const k = b.dataset.view === 'levels' ? 'levels' : 'ring';
  S[k] = !S[k];
  if (S[k]) store(`v:${k}`, true);
  else forget(`v:${k}`);
  syncView();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld()) {
    stop();
    audio.sleep();
  }
});

/* ---------- 毎フレーム ---------- */
const cvLevels = $<HTMLCanvasElement>('#sht-levels'),
  cvRing = $<HTMLCanvasElement>('#sht-ring');
let surfaceColor = '';
const recolor = () => {
  readCols(root);
  surfaceColor = getComputedStyle(root).getPropertyValue('--surface').trim();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);

let last = 0,
  filled = false;
function loop(now: number): void {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (!filled) {
    /* 保存した設定を読んだあと（マイクロタスクのあと）に埋める */
    filled = true;
    model.vel = model.moving ? model.rate * model.dir : 0;
    spec.fill(model);
  }
  const still = S.preview && RM.matches;
  if (S.preview && !still) model.advance(dt);
  if (!still && (S.preview || S.playing || now < S.tailEnd)) spec.scroll(dt, model, audio.low, audio.high, S.preview);
  spec.draw();
  const shown = model.shown(),
    note = noteOf(shown),
    name = chordName(shown, CHORDS[S.chord].suffix);
  txt('#m-name', name);
  txt('#m-cent', centText(note.cent));
  txt('#m-oct', octText(model.pos / 12));
  if (S.levels) drawLevels(cvLevels, model);
  if (S.ring) drawRing(cvRing, model, CHORDS[S.chord].s, name, surfaceColor);
  requestAnimationFrame(loop);
}
recolor();
syncUi();
syncView();
requestAnimationFrame(loop);

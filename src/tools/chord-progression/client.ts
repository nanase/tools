/**
 * コード進行のページの入口: 和音の地図で和音を並べ、緊張のレールとバンドで鳴らす。
 * 地図の三角形を押すと選んだ和音の後ろ（なければ最後）に足し、マウスでなぞると続けて足す。道の番号か駅を押すと選ぶ。
 * 曲は開き直しても戻るようにブラウザに保存し、名前を付けた保存は別のキーに持つ（設定をもとに戻しても消さない）
 */
import { Choice } from '../../lib/choice';
import { $, esc } from '../../lib/dom';
import { type FNote, partsOf } from '../../lib/midi-file';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { outVol, type PlayKey } from '../../lib/play';
import { parseSmf } from '../../lib/smf';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { SynthAudio } from '../fm-synthesizer/audio';
import { analyze, chordsOf } from './analyze';
import { CpAudio } from './audio';
import { MEMBER_NAMES, MEMBERS, type MemberId, Player, previewNotes } from './band';
import { Coaster, type CoasterState } from './coaster';
import { ICON } from './icons';
import { type MapState, MapView } from './map';
import {
  type Lit,
  litAt,
  MidiPlay,
  type MidiSong,
  midiSong,
  partIcon,
  progsOf,
  soundingAt,
  voiceName,
} from './midi-play';
import { BPM, CLICK, FM_DB, VOL0 } from './params';
import { SAMPLE0, sampleSong } from './samples';
import {
  BPM_MAX,
  BPM_MIN,
  compute,
  type Entry,
  fromFile,
  GTR_ORDER,
  type GtrId,
  KEYS_ORDER,
  type KeysId,
  keyAt,
  LENGTHS,
  type Meter,
  nearestPlace,
  newId,
  type Place,
  type SChord,
  type Song,
  STYLE_NAMES,
  type StyleId,
  samePlace,
  toFile,
  triadOf,
} from './song';
import { chordName, KEY_NAMES, type Key, keyName, md, QUAL_ORDER, QUALS, type Qual, roman, VOICES } from './theory';

initToolPage();

/* ---------- 状態 ---------- */
const S = {
  song: sampleSong(SAMPLE0),
  sel: null as number | null,
  /** 止まっている間に次に弾き始める和音 */
  cue: 0,
  on: { drums: true, bass: true, keys: true, gtr: true, cho: true } as Record<MemberId, boolean>,
  loop: true,
  /** メトロノームを鳴らすか */
  met: false,
  dirty: false,
};
{
  const f = fromFile(stored('song2'));
  if (f) {
    S.song = f;
    S.dirty = stored('dirty') === true;
  }
  const on = stored('on') as Partial<Record<MemberId, boolean>> | undefined;
  if (on && typeof on === 'object') for (const m of MEMBERS) S.on[m] = on[m] !== false;
  if (stored('loop') === false) S.loop = false;
  if (stored('met') === true) S.met = true;
}
/**
 * 開いている MIDI ファイル（なければ null）。開いている間の S.song は推したコード進行で、編集できず、ブラウザにも保存しない。
 * use は解析に使うパート、mute はミュートしたパート、band は原曲の代わりにバンドで鳴らすか、prog はパートの GM の音色
 */
let M: { m: MidiSong; use: Set<string>; mute: Set<string>; band: boolean; prog: Map<string, number> } | null = null;
let entries: Entry[] = [],
  beats = 0;
function recompute(): void {
  ({ entries, beats } = compute(S.song));
  if (S.sel !== null && S.sel >= S.song.chords.length) S.sel = null;
  if (S.cue >= S.song.chords.length) S.cue = 0;
}
recompute();

/* ---------- 元に戻す ---------- */
const undo: string[] = [],
  redo: string[] = [];
const snap = () => JSON.stringify(toFile(S.song));
function remember(): void {
  undo.push(snap());
  if (undo.length > 100) undo.shift();
  redo.length = 0;
}
function travel(from: string[], to: string[]): void {
  const prev = from.pop();
  if (!prev) return;
  to.push(snap());
  const f = fromFile(JSON.parse(prev));
  if (!f) return;
  S.song = f;
  S.sel = null;
  changed();
  syncControls();
}

/* ---------- 音と演奏 ---------- */
const audio = new CpAudio(),
  player = new Player(audio, () => ({ song: S.song, on: S.on, loop: S.loop, met: S.met })),
  /* MIDI ファイルの原曲は FMシンセサイザの GM 音源で、バンドと同じ AudioContext・同じ音量と残響に通す */
  fm = new SynthAudio({
    ready: async () => ((await audio.ready()) ? (audio.ac as AudioContext) : null),
    out: () => audio.input(),
  }),
  mplay = new MidiPlay(audio, fm, () => {
    const m = M as NonNullable<typeof M>;
    return { m: m.m, song: S.song, band: m.band, use: m.use, mute: m.mute, on: S.on, loop: S.loop, met: S.met };
  });
fm.vol(FM_DB);
/** 演奏しているか（MIDI ファイルか、地図の曲か） */
const isPlaying = (): boolean => (M ? mplay.playing : player.playing);
/** MIDI ファイルの拍 b を含む和音 */
const entryAt = (b: number): number => {
  let k = 0;
  for (let j = 0; j < entries.length; j++) if (entries[j].start <= b + 1e-6) k = j;
  return k;
};
/** 鳴っている和音（止めている間は −1） */
function curK(): number {
  if (!M) return player.playing ? (player.current()?.k ?? -1) : -1;
  const b = mplay.beat();
  return b === null ? -1 : entryAt(b);
}
let previewBus: GainNode | null = null;
/** 止まっている間の試聴（和音 1 つ） */
function preview(k: number): void {
  const e = entries[k];
  if (!e || isPlaying()) return;
  void audio.ready().then((ok) => {
    const ac = audio.ac,
      g = audio.bus();
    if (!ok || !ac || !g) return;
    if (previewBus) audio.drop(previewBus);
    previewBus = g;
    const w = ac.currentTime + 0.02;
    for (const x of previewNotes(e, S.song)) audio.note(x, w + x.t, w + x.end, g);
    setTimeout(() => {
      if (previewBus === g) audio.drop(g);
    }, 1800);
  });
}
const pp = $<HTMLButtonElement>('#cp-pp');
function syncPlay(): void {
  const on = isPlaying();
  pp.classList.toggle('on', on);
  pp.setAttribute('aria-label', on ? '一時停止' : '演奏');
  pp.title = on ? '一時停止' : '選んだ和音から演奏';
  $('#cp-st').hidden = false;
  $('#cp-led').className = on ? 'led on' : 'led';
  $('#cp-stT').textContent = on ? '演奏中' : '待機中';
  posText(on ? Math.max(0, curK()) : S.cue);
}
/** 和音の小節（1 から）。MIDI ファイルはファイルの小節で数える */
function barOf(e: Entry): number {
  if (!M) return e.bar;
  const st = M.m.smf.starts;
  let n = 0;
  while (n + 1 < st.length && st[n + 1] <= e.start + 1e-6) n++;
  return n + 1;
}
function posText(k: number): void {
  const e = entries[k],
    t = e ? `${barOf(e)} 小節 · ${roman(e.ch, e.key)}` : '–';
  const el = $('#cp-pos');
  if (el.textContent !== t) el.textContent = t;
}
async function play(): Promise<void> {
  if (isPlaying()) return pause();
  if (previewBus) audio.drop(previewBus);
  const k = S.sel ?? S.cue;
  if (!(await (M ? mplay.start(k > 0 ? (entries[k]?.start ?? 0) : 0) : player.start(k)))) return;
  syncPlay();
  requestAnimationFrame(frame);
}
function pause(): void {
  const k = curK();
  if (M) {
    mplay.halt();
    lit = [];
    hitParts(null);
  } else player.halt();
  if (k >= 0) S.cue = k;
  syncPlay();
  draw();
}
player.onEnd = mplay.onEnd = () => {
  S.cue = 0;
  lit = [];
  hitParts(null);
  syncPlay();
  draw();
};
/** 弾き始めの位置を変える（演奏中はすぐそこへ移る） */
function cueTo(k: number): void {
  S.cue = k;
  if (M) {
    if (mplay.playing) mplay.jump(entries[k]?.start ?? 0);
    else posText(k);
  } else if (player.playing) player.jump(k);
  else posText(k);
}
function barJump(dir: -1 | 1): void {
  if (!entries.length) return;
  const cur = isPlaying() ? Math.max(0, curK()) : S.cue;
  if (M) {
    /* MIDI ファイルは小節の頭から弾き直す。前へは、小節の頭から 1 拍より後ろならその小節の頭へ */
    const st = M.m.smf.starts,
      n = barOf(entries[cur]) - 1,
      b = mplay.beat() ?? entries[cur].start,
      to = dir < 0 && b - st[n] > 1 ? st[n] : st[Math.max(0, Math.min(st.length - 1, n + dir))];
    S.cue = entryAt(to);
    if (mplay.playing) mplay.jump(to);
    else posText(S.cue);
    draw();
    return;
  }
  const target = entries[cur].bar + dir;
  let k = entries.findIndex((e) => e.bar >= target);
  if (target < 1) k = 0;
  if (k < 0) return;
  S.sel = k;
  cueTo(k);
  draw();
  showEd();
}
pp.addEventListener('click', () => void play());
$('#cp-prev').addEventListener('click', () => barJump(-1));
$('#cp-next').addEventListener('click', () => barJump(1));
$('#cp-undo').addEventListener('click', () => travel(undo, redo));
$('#cp-redo').addEventListener('click', () => travel(redo, undo));
autoPause(audio, { pause: () => isPlaying() && pause(), hidden: () => (M ? mplay.tick() : player.tick()) });
new ParamGroup<PlayKey>([outVol(VOL0)], (v) => audio.vol(v.vol));
const bpmGroup = new ParamGroup<'bpm'>(
  [BPM],
  (v, k) => {
    if (!k || M) return;
    remember();
    S.song.bpm = v.bpm;
    changed();
  },
  null,
  { save: false },
);
const clickGroup = new ParamGroup<'clk'>([CLICK], (v) => {
  audio.click = 10 ** (v.clk / 20);
});
new Choice<string>($('#p-room'), (v) => audio.setRoom(v));

/* ---------- 地図 ---------- */
const mapCv = $<HTMLCanvasElement>('#cp-map'),
  mapView = new MapView(mapCv),
  mapw = $('#cp-mapw');
let hover: Place | null = null,
  /** 鳴っている和音が鳴り始めてからの秒 */
  age = 0;
/** 道の点のドラッグ（動かした先の三角形の和音に変える） */
let ndrag: { k: number; x0: number; y0: number; moved: boolean; at: Place | null } | null = null;
const playing = (): number => (M ? (isPlaying() ? curK() : (S.sel ?? S.cue)) : curK());
/** MIDI ファイルで鳴っている音 */
let lit: Lit[] = [];
/** 演奏中に次に鳴る和音 */
function nextOf(k: number): number {
  const n = S.song.chords.length;
  if (k < 0 || !n) return -1;
  return k + 1 < n ? k + 1 : S.loop ? 0 : -1;
}
const mapState = (): MapState => {
  const k = playing();
  return {
    song: S.song,
    entries,
    sel: S.sel,
    play: k,
    next: nextOf(k),
    drag: ndrag?.moved ? { k: ndrag.k, at: ndrag.at } : null,
    age,
    hover,
    ...(M ? { next: -1, prev: k - 1, lit, bar: entries[k] ? barOf(entries[k]) : undefined } : {}),
  };
};
/** 選んだ和音の後ろ（なければ最後）に三角形の和音を足す */
function addAt(p: Place, after: number | null): number {
  const t = triadOf(p),
    ix = after === null ? S.song.chords.length : after + 1,
    c: SChord = { id: newId(), r: t.r, q: t.q, b: 0, at: p, mod: null };
  S.song.chords.splice(ix, 0, c);
  return ix;
}
/** 和音を別の三角形へ移す。長短の系統が同じなら 7 などの種類はそのまま */
function moveTo(c: SChord, p: Place): void {
  const t = triadOf(p),
    fam = QUALS[c.q].b;
  c.r = t.r;
  if (t.q === 'M' ? fam !== 'M' : fam === 'M') c.q = t.q;
  c.at = p;
}
/** 和音を選ぶ。小窓は道の点か駅を押したときだけ開き、同じ和音をもう一度押すと閉じる */
function pick(k: number): void {
  if (S.sel === k && edOpen) edOpen = false;
  else {
    S.sel = k;
    edOpen = true;
    cueTo(k);
    preview(k);
  }
  draw();
  showEd();
}
let drawing: { last: Place } | null = null;
const local = (ev: PointerEvent, el: HTMLElement): [number, number] => {
  const r = el.getBoundingClientRect();
  return [ev.clientX - r.left, ev.clientY - r.top];
};
mapCv.addEventListener('pointerdown', (ev) => {
  if (ev.button > 0) return;
  /* 調や曲の小窓が開いていれば、地図を押しても和音は足さずに閉じるだけ */
  if (closePops() || M) return;
  const [x, y] = local(ev, mapCv),
    k = mapView.nodeAt(mapState(), x, y);
  if (k >= 0) {
    ndrag = { k, x0: x, y0: y, moved: false, at: null };
    mapCv.setPointerCapture(ev.pointerId);
    return;
  }
  const p = mapView.hit(x, y);
  if (!p) return;
  remember();
  S.sel = addAt(p, S.sel);
  edOpen = false;
  changed();
  preview(S.sel);
  /* マウスとペンはなぞると続けて足す（タッチはスクロールのため押すだけ） */
  if (ev.pointerType !== 'touch') {
    drawing = { last: p };
    mapCv.setPointerCapture(ev.pointerId);
  }
});
mapCv.addEventListener('pointermove', (ev) => {
  const [x, y] = local(ev, mapCv),
    p = mapView.hit(x, y);
  if (ndrag) {
    if (!ndrag.moved && Math.hypot(x - ndrag.x0, y - ndrag.y0) > 6) {
      ndrag.moved = true;
      edOpen = false;
      showEd();
    }
    if (ndrag.moved && !(p && ndrag.at && samePlace(p, ndrag.at))) {
      ndrag.at = p;
      draw();
    }
    return;
  }
  if (drawing && p && !samePlace(p, drawing.last)) {
    drawing.last = p;
    S.sel = addAt(p, S.sel);
    changed();
    preview(S.sel);
    return;
  }
  if (!(p === hover || (p && hover && samePlace(p, hover)))) {
    hover = M ? null : p;
    if (!isPlaying()) mapView.draw(mapState());
  }
});
mapCv.addEventListener('pointerup', () => {
  const d = ndrag;
  ndrag = null;
  if (!d) return;
  if (!d.moved) return pick(d.k);
  const c = S.song.chords[d.k];
  if (!c || !d.at || samePlace(c.at, d.at)) return draw();
  remember();
  moveTo(c, d.at);
  S.sel = d.k;
  changed();
  preview(d.k);
});
mapCv.addEventListener('pointercancel', () => {
  ndrag = null;
  draw();
});
addEventListener('pointerup', () => {
  drawing = null;
});
mapCv.addEventListener('pointerleave', () => {
  hover = null;
  if (!isPlaying()) mapView.draw(mapState());
});

/* ---------- 緊張のレール ---------- */
const rcCv = $<HTMLCanvasElement>('#cp-rc'),
  coaster = new Coaster(rcCv);
let rdrag: { k: number; x0: number; moved: boolean; slot: number; cx: number } | null = null;
let cartBeat: number | null = null;
/** 止まっている間のトロッコは、次に弾き始める和音の頭に置く */
const coasterState = (): CoasterState => ({
  entries,
  beats,
  sel: S.sel,
  play: M ? (isPlaying() ? curK() : -1) : playing(),
  cart: cartBeat ?? entries[S.cue]?.start ?? 0,
  playing: isPlaying(),
  loop: S.loop,
  caret: rdrag?.moved ? rdrag.cx : null,
});
rcCv.addEventListener('pointerdown', (ev) => {
  const [x] = local(ev, rcCv),
    k = coaster.stationAt(coasterState(), x);
  if (k < 0) return;
  rdrag = { k, x0: x, moved: false, slot: k, cx: x };
  rcCv.setPointerCapture(ev.pointerId);
});
rcCv.addEventListener('pointermove', (ev) => {
  if (!rdrag) return;
  const [x] = local(ev, rcCv);
  if (Math.abs(x - rdrag.x0) > 6 && !M) rdrag.moved = true;
  [rdrag.slot, rdrag.cx] = coaster.slotAt(coasterState(), x);
  if (rdrag.moved) coaster.draw(coasterState());
});
rcCv.addEventListener('pointerup', () => {
  const d = rdrag;
  rdrag = null;
  if (!d) return;
  if (!d.moved) {
    if (M) {
      /* MIDI ファイルでは駅を押すとその和音から弾く */
      cueTo(d.k);
      return draw();
    }
    reveal(d.k);
    return pick(d.k);
  }
  let to = d.slot;
  if (to === d.k || to === d.k + 1) return draw();
  remember();
  const [c] = S.song.chords.splice(d.k, 1);
  if (d.k < to) to--;
  S.song.chords.splice(to, 0, c);
  S.sel = to;
  changed();
});

/* ---------- 選んだ和音の小窓 ---------- */
const NEAR_KEYS: [string, string][] = [
  ['', 'そのまま'],
  ['h1', '半音上'],
  ['w1', '全音上'],
  ['dom', '属調'],
  ['sub', '下属調'],
  ['rel', '平行調'],
  ['par', '同主調'],
];
function modKey(prev: Key, v: string): Key {
  const to: Record<string, [number, Key['m']]> = {
    dom: [7, prev.m],
    sub: [5, prev.m],
    h1: [1, prev.m],
    w1: [2, prev.m],
    rel: prev.m === 'maj' ? [9, 'min'] : [3, 'maj'],
    par: [0, prev.m === 'maj' ? 'min' : 'maj'],
  };
  const [dt, m] = to[v];
  return { t: md(prev.t + dt), m };
}
const iconBtn = (a: string, icon: string, name: string) =>
  `<button type="button" class="cp-pi" data-a="${a}" title="${name}" aria-label="${name}">${icon}</button>`;
const chipRow = (lb: string, a: string, opts: readonly (readonly [string | number, string])[], cur: unknown) =>
  `<div class="cp-er">${lb ? `<span class="cp-el">${lb}</span>` : ''}<div class="chips">${opts
    .map(
      ([v, t]) =>
        `<button type="button" class="chip" data-a="${a}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${t}</button>`,
    )
    .join('')}</div></div>`;
/** 小窓を開いているか、開いている項目（種類・長さ・転調） */
let edOpen = false,
  edTab: 'q' | 'b' | 'mod' | null = null;
const lenName = (b: number) => (b === 0 ? `1 小節（${S.song.meter} 拍）` : `${b} 拍`);
function showEd(): void {
  let ed = document.getElementById('cp-ed');
  const k = S.sel,
    e = k === null ? undefined : entries[k];
  if (!edOpen || k === null || !e || M) {
    ed?.remove();
    return;
  }
  if (!ed) {
    ed = document.createElement('div');
    ed.id = 'cp-ed';
    ed.className = 'cp-ed';
    ed.setAttribute('role', 'dialog');
    ed.setAttribute('aria-label', '選んだ和音');
    mapw.appendChild(ed);
  }
  const c = e.c,
    prevKey = k > 0 ? keyAt(S.song, k - 1) : S.song.key,
    modV = c.mod
      ? (NEAR_KEYS.find(([v]) => v && modKey(prevKey, v).t === c.mod?.t && modKey(prevKey, v).m === c.mod?.m)?.[0] ??
        'x')
      : '',
    tab = (v: 'q' | 'b' | 'mod', lb: string, cur: string) =>
      `<button type="button" class="cp-et" data-a="tab" data-v="${v}" aria-expanded="${edTab === v}"><span>${lb}</span>${cur}<i aria-hidden="true">▾</i></button>`;
  const body =
    edTab === 'q'
      ? chipRow(
          '',
          'q',
          QUAL_ORDER.map((q) => [q, chordName({ ...e.ch, q }, e.key)]),
          c.q,
        )
      : edTab === 'b'
        ? chipRow(
            '',
            'b',
            LENGTHS.map((b) => [b, lenName(b)]),
            c.b,
          )
        : edTab === 'mod'
          ? chipRow('', 'mod', NEAR_KEYS, modV)
          : '';
  ed.innerHTML = `<div class="cp-eh"><b>${k + 1}</b>${tab('q', '種類', chordName(e.ch, e.key))}${tab('b', '長さ', lenName(c.b))}${tab('mod', '転調', c.mod ? `→ ${keyName(c.mod)}` : 'なし')}${iconBtn('aud', ICON.aud, '試聴')}${iconBtn('del', ICON.del, '削除')}<button type="button" class="cp-ex" data-a="close" aria-label="閉じる" title="閉じる">×</button></div>${body}`;
  /*
   * 番号の周りの和音を隠さないように、地図の上端か下端に寄せる（番号が下半分なら上端、上半分なら下端）。
   * 左右は番号に近づけるが、上端では左上の演奏の操作と調のボタンを、下端では右下の緊張の図を避ける。
   * 位置は枠（mapw）からの値。狭い画面では小窓を地図の下に並べるので（CSS で static）、この値は効かない
   */
  const st = mapState(),
    wr = mapw.getBoundingClientRect(),
    rel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - wr.left, r: r.right - wr.left, t: r.top - wr.top, b: r.bottom - wr.top };
    },
    cv = rel(mapCv),
    [px, py] = mapView.nodePos(st, k),
    nx = px + cv.l,
    ny = py + cv.t,
    w = ed.offsetWidth,
    h = ed.offsetHeight,
    mw = mapw.clientWidth,
    atTop = ny > cv.t + (cv.b - cv.t) / 2;
  let lo = 4,
    hi = mw - w - 4;
  if (atTop) for (const el of [$('.cp-tools'), $('.cp-meta')]) lo = Math.max(lo, rel(el).r + 8);
  else {
    const rc = $('#cp-rcw');
    if (!rc.classList.contains('below')) hi = Math.min(hi, rel(rc).l - w - 8);
  }
  const left = hi >= lo ? Math.max(lo, Math.min(hi, nx - w / 2)) : Math.max(4, Math.min(mw - w - 4, nx - w / 2));
  ed.style.left = `${left}px`;
  ed.style.top = `${atTop ? cv.t + 8 : Math.max(cv.t + 8, cv.b - h - 8)}px`;
}
mapw.addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLElement>('#cp-ed [data-a]');
  if (!b || S.sel === null) return;
  const k = S.sel,
    c = S.song.chords[k],
    a = b.dataset.a,
    v = b.dataset.v ?? '';
  if (a === 'tab') {
    edTab = edTab === v ? null : (v as typeof edTab);
    return showEd();
  }
  if (a === 'close') {
    edOpen = false;
    return showEd();
  }
  if (a === 'aud') return preview(k);
  if (a === 'del') {
    remember();
    S.song.chords.splice(k, 1);
    S.sel = k > 0 ? k - 1 : S.song.chords.length ? 0 : null;
    edOpen = false;
  } else if (a === 'q') {
    remember();
    const q = v as Qual,
      flip = QUALS[q].b !== QUALS[c.q].b;
    c.q = q;
    /* 長短が変わったら、同じ根音の向きの違う三角形へ移す */
    if (flip) c.at = nearestPlace(c.r, q, c.at);
    changed();
    return preview(k);
  } else if (a === 'b') {
    remember();
    c.b = Number(v);
  } else if (a === 'mod') {
    remember();
    c.mod = v ? modKey(k > 0 ? keyAt(S.song, k - 1) : S.song.key, v) : null;
  }
  changed();
});

/* ---------- 曲の調（移調） ---------- */
const keyBtn = $<HTMLButtonElement>('#cp-key'),
  keyPop = $('#cp-keypop');
function renderKeyPop(): void {
  const k = S.song.key;
  keyPop.innerHTML = `${chipRow(
    '主音',
    'kt',
    KEY_NAMES.map((n, i) => [i, n]),
    k.t,
  )}${chipRow(
    '種類',
    'km',
    [
      ['maj', 'メジャー'],
      ['min', 'マイナー'],
    ],
    k.m,
  )}<p class="cp-en">主音を変えると和音ごと移る（移調）</p>`;
}
/** 地図の上の小窓（調・曲）をどちらも閉じる。閉じたら true */
function closePops(): boolean {
  if (keyPop.hidden && songPop.hidden) return false;
  popOpen(keyBtn, keyPop, false);
  popOpen(songBtn, songPop, false);
  return true;
}
/* 小窓の外を押したら閉じる */
document.addEventListener('pointerdown', (ev) => {
  const t = ev.target as Element;
  if (t.closest('#cp-keypop, #cp-songpop, #cp-key, #cp-songb')) return;
  if (t !== mapCv) closePops();
});
/** 地図の上の小窓（調・曲）を開け閉めする。開くときはもう一方を閉じる */
function popOpen(btn: HTMLElement, pop: HTMLElement, open: boolean): void {
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}
keyBtn.addEventListener('click', () => {
  if (M) return;
  const open = keyPop.hidden === true;
  popOpen(keyBtn, keyPop, open);
  if (open) {
    popOpen(songBtn, songPop, false);
    renderKeyPop();
  }
});
keyPop.addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLElement>('[data-a]');
  if (!b) return;
  remember();
  if (b.dataset.a === 'kt') transpose(md(Number(b.dataset.v) - S.song.key.t));
  else S.song.key = { ...S.song.key, m: b.dataset.v as Key['m'] };
  renderKeyPop();
  changed();
});
/** 曲全体を n 半音移す。地図の上は、前の和音に近い三角形へ置き直す */
function transpose(n: number): void {
  if (!n) return;
  S.song.key = { ...S.song.key, t: md(S.song.key.t + n) };
  let prev: Place | null = null;
  for (const c of S.song.chords) {
    c.r = md(c.r + n);
    if (c.mod) c.mod = { ...c.mod, t: md(c.mod.t + n) };
    c.at = nearestPlace(c.r, c.q, prev);
    prev = c.at;
  }
}

/* ---------- バンド ---------- */
const BAND_ICON: Record<MemberId, () => string> = {
  drums: () => ICON.drums,
  bass: () => ICON.ebass,
  keys: () => ICON[S.song.keys],
  gtr: () => ICON[S.song.gtr],
  cho: () => ICON.cho,
};
const memberSub: Record<MemberId, () => string> = {
  drums: () => STYLE_NAMES[S.song.style],
  bass: () => 'エレキベース',
  keys: () => VOICES[S.song.keys],
  gtr: () => VOICES[S.song.gtr],
  cho: () => '持続音',
};
/** 音色を選べるメンバーと、その選択肢 */
const VOICE_OPTS: Partial<Record<MemberId, readonly (KeysId | GtrId)[]>> = { keys: KEYS_ORDER, gtr: GTR_ORDER };
const bandEl = $('#cp-band'),
  memberEl = {} as Record<MemberId, HTMLButtonElement>,
  /** メンバーの枠（鳴ったときに動かす） */
  cardEl = {} as Record<MemberId, HTMLElement>,
  /** 枠の下段: 鍵盤とギターは音色のボタン、ほかは文字 */
  subEl = {} as Record<MemberId, HTMLElement>,
  voiceBtn: Partial<Record<MemberId, HTMLButtonElement>> = {};
/* メンバーの枠: 上はミュートのボタン、水平線の下は今の音色。鍵盤とギターの下段は押すと音色のメニューを開く */
for (const m of MEMBERS) {
  const w = document.createElement('div'),
    b = document.createElement('button');
  w.className = 'cp-memw';
  b.type = 'button';
  b.className = 'cp-mem';
  b.dataset.m = m;
  b.addEventListener('click', () => {
    S.on[m] = !S.on[m];
    store('on', S.on);
    syncBand();
    player.resync();
  });
  w.appendChild(b);
  if (VOICE_OPTS[m]) {
    const v = document.createElement('button');
    v.type = 'button';
    v.className = 'cp-vb';
    v.setAttribute('aria-haspopup', 'menu');
    v.setAttribute('aria-expanded', 'false');
    v.addEventListener('click', () => (vmenuFor === m ? closeVoiceMenu() : openVoiceMenu(m)));
    voiceBtn[m] = v;
    subEl[m] = v;
  } else {
    subEl[m] = document.createElement('div');
    subEl[m].className = 'cp-msub';
  }
  w.appendChild(subEl[m]);
  bandEl.appendChild(w);
  memberEl[m] = b;
  cardEl[m] = w;
}
function syncBand(): void {
  for (const m of MEMBERS) {
    const b = memberEl[m];
    b.setAttribute('aria-pressed', String(S.on[m]));
    b.title = `${MEMBER_NAMES[m]}（押すと${S.on[m] ? 'ミュート' : '戻す'}）`;
    b.innerHTML = `${BAND_ICON[m]()}<span>${MEMBER_NAMES[m]}</span>`;
    cardEl[m].classList.toggle('off', !S.on[m]);
    const v = voiceBtn[m],
      sub = memberSub[m]();
    if (v) {
      v.setAttribute('aria-label', `${MEMBER_NAMES[m]}の音色: ${sub}`);
      v.innerHTML = `<span>${sub}</span><svg viewBox="0 0 10 7" aria-hidden="true"><path d="M0 0H10L5 7z"/></svg>`;
    } else subEl[m].textContent = sub;
  }
}
/* ---------- 音色のメニュー ---------- */
const vmenu = document.createElement('div');
vmenu.className = 'cp-vmenu';
vmenu.setAttribute('role', 'menu');
vmenu.hidden = true;
bandEl.appendChild(vmenu);
let vmenuFor: MemberId | null = null;
const curVoice = (m: MemberId): string => (m === 'keys' ? S.song.keys : S.song.gtr);
function openVoiceMenu(m: MemberId): void {
  const opts = VOICE_OPTS[m],
    btn = voiceBtn[m];
  if (!opts || !btn) return;
  closeVoiceMenu();
  vmenuFor = m;
  vmenu.setAttribute('aria-label', `${MEMBER_NAMES[m]}の音色`);
  vmenu.innerHTML = opts
    .map(
      (v) =>
        `<button type="button" role="menuitemradio" data-v="${v}" aria-checked="${v === curVoice(m)}">${ICON[v]}<span>${VOICES[v]}</span></button>`,
    )
    .join('');
  vmenu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  /* ボタンの下に置き、バンドの枠からはみ出さないように左右を寄せる */
  const br = bandEl.getBoundingClientRect(),
    r = btn.getBoundingClientRect(),
    w = vmenu.offsetWidth;
  vmenu.style.top = `${r.bottom - br.top + 4}px`;
  vmenu.style.left = `${Math.max(0, Math.min(br.width - w, r.left - br.left + r.width / 2 - w / 2))}px`;
  (vmenu.querySelector<HTMLElement>('[aria-checked="true"]') ?? vmenu.querySelector<HTMLElement>('button'))?.focus();
}
function closeVoiceMenu(focus = false): void {
  if (!vmenuFor) return;
  const btn = voiceBtn[vmenuFor];
  vmenuFor = null;
  vmenu.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
  if (focus) btn?.focus();
}
vmenu.addEventListener('click', (ev) => {
  const it = (ev.target as Element).closest<HTMLElement>('[data-v]'),
    m = vmenuFor;
  if (!it || !m) return;
  const v = it.dataset.v ?? '';
  closeVoiceMenu(true);
  if (v === curVoice(m)) return;
  songSet(() => {
    if (m === 'keys') S.song.keys = v as KeysId;
    else S.song.gtr = v as GtrId;
  });
});
vmenu.addEventListener('keydown', (ev) => {
  const items = [...vmenu.querySelectorAll<HTMLElement>('[data-v]')],
    i = items.indexOf(document.activeElement as HTMLElement);
  if (ev.key === 'Escape') {
    ev.preventDefault();
    closeVoiceMenu(true);
  } else if (ev.key === 'Tab') closeVoiceMenu();
  else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  } else if (ev.key === 'Home' || ev.key === 'End') {
    ev.preventDefault();
    items[ev.key === 'Home' ? 0 : items.length - 1]?.focus();
  }
});
document.addEventListener('pointerdown', (ev) => {
  const t = ev.target as Element;
  if (vmenuFor && !vmenu.contains(t) && !t.closest('.cp-vb')) closeVoiceMenu();
});
player.onHit = mplay.onHit = (m, at) => {
  const now = audio.now() ?? 0;
  setTimeout(
    () => {
      cardEl[m].classList.add('hit');
      setTimeout(() => cardEl[m].classList.remove('hit'), 90);
    },
    Math.max(0, (at - now) * 1000),
  );
};
/* 曲ごとの選択肢（保存は曲と一緒にするので、選択肢としては保存しない） */
for (const id of ['#p-style', '#p-meter']) $(id).setAttribute('data-nosave', '');
const styleCh = new Choice<StyleId>($('#p-style'), (v) => songSet(() => (S.song.style = v)));
const meterCh = new Choice<string>($('#p-meter'), (v) => songSet(() => (S.song.meter = Number(v) as Meter)));
function songSet(fn: () => void): void {
  remember();
  fn();
  changed();
  syncBand();
}
const loopBtn = $<HTMLButtonElement>('#cp-loop');
function syncLoop(): void {
  loopBtn.setAttribute('aria-pressed', String(S.loop));
  loopBtn.querySelector('.led')?.classList.toggle('on', S.loop);
}
loopBtn.addEventListener('click', () => {
  S.loop = !S.loop;
  store('loop', S.loop);
  syncLoop();
  draw();
});
const metBtn = $<HTMLButtonElement>('#cp-met');
function syncMet(): void {
  metBtn.setAttribute('aria-pressed', String(S.met));
  metBtn.querySelector('.led')?.classList.toggle('on', S.met);
  clickGroup.setOff('clk', !S.met, 'メトロノームを止めている間は使いません');
}
metBtn.addEventListener('click', () => {
  S.met = !S.met;
  store('met', S.met);
  syncMet();
  player.resync();
  mplay.rebar();
});
/** 曲を入れ替えたあと、選択肢と数値の行を曲に合わせる */
function syncControls(): void {
  styleCh.set(S.song.style);
  meterCh.set(String(S.song.meter));
  bpmGroup.set('bpm', S.song.bpm, { silent: true });
  syncBand();
}

/* ---------- 描画 ---------- */
function draw(): void {
  mapView.draw(mapState());
  coaster.draw(coasterState());
  keyBtn.textContent = keyName(M ? (entries[playing()]?.key ?? S.song.key) : S.song.key);
}
function changed(): void {
  recompute();
  S.dirty = true;
  saveCurrent();
  player.resync();
  draw();
  showEd();
  posText(isPlaying() ? Math.max(0, curK()) : (S.sel ?? S.cue));
}
function frame(): void {
  if (!isPlaying()) {
    cartBeat = null;
    draw();
    return;
  }
  if (M) {
    const b = mplay.beat() ?? 0,
      k = entryAt(b),
      e = entries[k];
    cartBeat = b;
    age = e ? ((M.m.tm.tau(b) - M.m.tm.tau(e.start)) * 60) / M.m.smf.bpm : 0;
    lit = litAt(soundingGroups(), b, M.band && e ? MidiPlay.chordTones(e) : []);
    hitParts(b);
    posText(k);
    draw();
    requestAnimationFrame(frame);
    return;
  }
  const occ = player.current(),
    now = audio.now() ?? 0;
  if (occ) {
    age = now - occ.at;
    cartBeat = occ.e.start + Math.min(1, age / occ.dur) * occ.e.beats;
    posText(occ.k);
  }
  draw();
  requestAnimationFrame(frame);
}
/** 狭い画面で地図を横にスクロールしているとき、k 番目の和音（なければ最後）が見えるようにする */
function reveal(k: number | null): void {
  const sc = $('#cp-mapsc'),
    n = S.song.chords.length;
  if (sc.scrollWidth <= sc.clientWidth || !n) return;
  const [x] = mapView.nodePos(mapState(), Math.min(k ?? n - 1, n - 1)),
    m = 60;
  if (x < sc.scrollLeft + m || x > sc.scrollLeft + sc.clientWidth - m) sc.scrollLeft = x - sc.clientWidth / 2;
}
const rcw = $('#cp-rcw'),
  /** 緊張のレールの左右の端を地図に溶かす幅 [px]（style.css の .cp-rcw と合わせる） */
  FADE_L = 40,
  FADE_R = 18;
function layout(): void {
  mapView.layout();
  /* 緊張のレールは地図の右下の空いた所に重ねる。入らなければ地図の下に置く */
  const sc = $('#cp-mapsc'),
    box = sc.scrollWidth > sc.clientWidth + 1 ? null : mapView.freeBox(120, 150);
  rcw.classList.toggle('below', !box);
  if (box) {
    /* 左の端は地図に溶かすので、その分だけ三角形の上へ広げる */
    const w = Math.round(Math.min(box.w + FADE_L, 400));
    rcw.style.left = `${box.x + box.w - w}px`;
    rcw.style.top = `${box.y}px`;
    coaster.layout(w, box.h, FADE_R + 4);
  } else {
    rcw.style.left = rcw.style.top = '';
    coaster.layout(rcw.clientWidth || mapw.clientWidth, 128);
  }
  draw();
  reveal(S.sel);
  showEd();
}
$('#cp-mapsc').addEventListener('scroll', () => {
  if (S.sel !== null) showEd();
});
new ResizeObserver(layout).observe(mapw);
new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
document.addEventListener('keydown', (ev) => {
  const t = ev.target as Element;
  if (t.closest('input, textarea')) return;
  if (M && ev.key !== 'Escape') return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) travel(redo, undo);
    else travel(undo, redo);
  } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
    ev.preventDefault();
    travel(redo, undo);
  } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && S.sel !== null) {
    ev.preventDefault();
    remember();
    S.song.chords.splice(S.sel, 1);
    S.sel = null;
    changed();
  } else if (ev.key === 'Escape' && (!keyPop.hidden || !songPop.hidden)) {
    closePops();
  } else if (ev.key === 'Escape' && S.sel !== null) {
    /* 小窓が開いていれば閉じ、閉じていれば選ぶのをやめる */
    if (edOpen) edOpen = false;
    else S.sel = null;
    draw();
    showEd();
  }
});

/* ---------- 曲の保存・新規・サンプル ---------- */
const SAVE_KEY = 'chord-progression:saved2';
const nameIn = $<HTMLInputElement>('#cp-name'),
  msg = $('#cp-msg');
function saveCurrent(): void {
  if (M) return;
  store('song2', toFile(S.song));
  store('dirty', S.dirty);
}
function readSaved(): { name: string; at: number; file: unknown }[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string') : [];
  } catch {
    return [];
  }
}
function writeSaved(list: { name: string; at: number; file: unknown }[]): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
function say(s: string): void {
  msg.textContent = s;
  msg.style.visibility = s ? 'visible' : 'hidden';
}
function renderSaved(): void {
  const list = readSaved();
  $('#cp-saved').innerHTML = list.length
    ? list
        .map(
          (x, j) =>
            `<li><button type="button" class="cp-sv" data-open="${j}">${esc(x.name)}</button><button type="button" class="cp-sx" data-rm="${j}" aria-label="${esc(`「${x.name}」を削除`)}" title="削除">×</button></li>`,
        )
        .join('')
    : '<li class="cp-none">まだ保存した進行はありません。</li>';
}
/* ---------- 地図の上の曲の選択（サンプル・保存した進行・新規） ---------- */
const songBtn = $<HTMLButtonElement>('#cp-songb'),
  songPop = $('#cp-songpop');
function syncSongBtn(): void {
  $('#cp-songn').textContent = S.song.name || '新しい進行';
}
songBtn.addEventListener('click', () => {
  const open = songPop.hidden === true;
  popOpen(songBtn, songPop, open);
  if (open) {
    popOpen(keyBtn, keyPop, false);
    /* 今の曲のサンプルを押した形にする */
    for (const b of songPop.querySelectorAll<HTMLElement>('#cp-samples [data-s]'))
      b.setAttribute('aria-pressed', String(b.textContent === S.song.name));
  }
});
/** 曲を入れ替える。変更が残っていれば確かめる */
function load(song: Song, midi: typeof M = null): boolean {
  if (S.dirty && !confirm(`保存していない変更は失われます。「${song.name || '新しい進行'}」を開きますか？`))
    return false;
  player.halt(true);
  mplay.halt(true);
  M = midi;
  lit = [];
  syncMidi();
  undo.length = 0;
  redo.length = 0;
  S.song = song;
  S.sel = null;
  S.cue = 0;
  recompute();
  S.dirty = false;
  nameIn.value = song.name;
  syncSongBtn();
  saveCurrent();
  syncControls();
  popOpen(songBtn, songPop, false);
  syncPlay();
  draw();
  showEd();
  return true;
}
nameIn.value = S.song.name;
nameIn.addEventListener('input', () => {
  S.song.name = nameIn.value.slice(0, 60);
  S.dirty = true;
  saveCurrent();
  syncSongBtn();
});
syncSongBtn();
$('#cp-samples').addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLElement>('[data-s]');
  if (b && load(sampleSong(b.dataset.s as string))) say('');
});
$('#cp-new').addEventListener('click', () => {
  const s = sampleSong(SAMPLE0);
  if (load({ ...s, name: '', chords: [] })) say('');
});
$('#cp-save').addEventListener('click', () => {
  const name = nameIn.value.trim() || '無題の進行',
    list = readSaved().filter((x) => x.name !== name);
  S.song.name = name;
  list.unshift({ name, at: Date.now(), file: toFile(S.song) });
  if (!writeSaved(list.slice(0, 50))) return say('このブラウザでは保存できません。');
  nameIn.value = name;
  S.dirty = false;
  saveCurrent();
  renderSaved();
  syncSongBtn();
  say(`「${name}」を保存しました。`);
});
$('#cp-saved').addEventListener('click', (ev) => {
  const t = ev.target as Element,
    o = t.closest<HTMLElement>('[data-open]'),
    r = t.closest<HTMLElement>('[data-rm]'),
    list = readSaved();
  if (o) {
    const x = list[Number(o.dataset.open)],
      f = x && fromFile(x.file);
    if (!f) return say('この保存は読み込めません。');
    if (load({ ...f, name: x.name })) say('');
  } else if (r) {
    const j = Number(r.dataset.rm),
      x = list[j];
    if (!x || !confirm(`「${x.name}」を削除しますか？元に戻せません。`)) return;
    list.splice(j, 1);
    writeSaved(list);
    renderSaved();
  }
});
$('#cp-export').addEventListener('click', () => {
  const name = nameIn.value.trim() || 'コード進行',
    blob = new Blob([JSON.stringify({ ...toFile(S.song), name }, null, 1)], { type: 'application/json' }),
    a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const fileIn = $<HTMLInputElement>('#cp-file');
$('#cp-import').addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', async () => {
  const f = fileIn.files?.[0];
  fileIn.value = '';
  if (!f) return;
  try {
    const r = fromFile(JSON.parse(await f.text()));
    if (!r) return say('このファイルは読み込めません。');
    if (load({ ...r, name: r.name || f.name.replace(/\.json$/i, '') })) say('');
  } catch {
    say('このファイルは読み込めません。');
  }
});

/* ---------- MIDI ファイル ---------- */
const midiIn = $<HTMLInputElement>('#cp-midi'),
  plistEl = $('#cp-plist'),
  srcEl = $('#cp-src');
/** 地図で光らせる音: 鳴らしているパートの音（打楽器は除く）。バンドの和音の音は別に足す */
function soundingGroups(): FNote[][] {
  if (!M) return [];
  const { m, use, band, mute } = M;
  return m.parts.filter((p) => !p.drum && !mute.has(p.id) && !(band && use.has(p.id))).map((p) => p.notes);
}
/** 解析に使うパートでコード進行を推し直す */
function reanalyze(): boolean {
  if (!M) return false;
  const { m, use } = M,
    notes = m.parts.filter((p) => use.has(p.id)).flatMap((p) => p.notes),
    segs = analyze(notes, m.smf.starts, m.smf.end);
  if (!segs.length) return false;
  const { key, chords } = chordsOf(segs);
  S.song.key = key;
  S.song.chords = chords;
  recompute();
  return true;
}
/** 音域の図の範囲（ピアノの 88 鍵） */
const LO = 21,
  HI = 108;
/**
 * パートの表: アイコン・パート・音色・音域・解析に使うか・ミュート。
 * バンドのときは、バンドが代わりに弾くパート（解析に使ったパートと打楽器）を薄くする
 */
function renderParts(): void {
  if (!M) return;
  const { m, use, mute, band, prog } = M,
    pc = (n: number) => ((Math.max(LO, Math.min(HI, n)) - LO) / (HI - LO)) * 100,
    last = use.size === 1;
  plistEl.innerHTML = `<div class="cp-ph" aria-hidden="true"><span></span><span>パート</span><span>音色</span><span>音域</span><span>解析</span><span>音</span></div>${m.parts
    .map((p) => {
      const on = use.has(p.id),
        mu = mute.has(p.id),
        by = band && (p.drum || on),
        voice = voiceName(p.drum, prog.get(p.id) ?? 0),
        dis = p.drum || (on && last);
      return `<div class="cp-pl${mu ? ' mu' : ''}${by ? ' by' : ''}" data-p="${esc(p.id)}"><span class="cp-pi">${partIcon(p.drum, prog.get(p.id) ?? 0)}</span><span class="cp-pn">${esc(p.name)}</span><span class="cp-pg">${esc(voice === p.name ? '' : voice)}</span><span class="cp-rng" aria-hidden="true"><i style="left:${pc(p.lo)}%;width:${Math.max(1.5, pc(p.hi) - pc(p.lo))}%"></i></span><span class="cp-pu"><input type="checkbox" data-a="use"${on ? ' checked' : ''}${dis ? ' disabled' : ''} aria-label="${esc(`${p.name}を解析に使う`)}"${p.drum ? ' title="打楽器は解析に使いません"' : ''} /></span><button type="button" class="cp-pm" data-a="mute" aria-pressed="${mu}" aria-label="${esc(`${p.name}をミュート`)}" title="${mu ? '鳴らす' : 'ミュート'}">${mu ? ICON.mute : ICON.aud}</button></div>`;
    })
    .join('')}`;
}
/** 鳴っているパートの行に色を付ける */
function hitParts(b: number | null): void {
  if (!M) return;
  for (const row of plistEl.querySelectorAll<HTMLElement>('.cp-pl')) {
    const notes = M.m.notes.get(row.dataset.p ?? ''),
      on =
        b !== null &&
        !!notes &&
        !M.mute.has(row.dataset.p ?? '') &&
        !row.classList.contains('by') &&
        soundingAt(notes, b);
    if (row.classList.contains('hit') !== on) row.classList.toggle('hit', on);
  }
}
plistEl.addEventListener('change', (ev) => {
  const t = ev.target as HTMLInputElement,
    id = t.closest<HTMLElement>('[data-p]')?.dataset.p;
  if (!M || !id || t.dataset.a !== 'use') return;
  if (t.checked) M.use.add(id);
  else M.use.delete(id);
  if (!reanalyze()) {
    M.use.add(id);
    t.checked = true;
    return;
  }
  if (S.cue >= entries.length) S.cue = 0;
  renderParts();
  /* バンドのときは、バンドが代わりに弾くパートも変わる */
  mplay.refilter();
  draw();
});
plistEl.addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLElement>('[data-a="mute"]'),
    id = b?.closest<HTMLElement>('[data-p]')?.dataset.p;
  if (!M || !id) return;
  if (M.mute.has(id)) M.mute.delete(id);
  else M.mute.add(id);
  renderParts();
  mplay.refilter();
});
srcEl.addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLButtonElement>('[data-v]');
  if (!b || !M || M.band === (b.dataset.v === 'band')) return;
  M.band = b.dataset.v === 'band';
  syncMidi();
  mplay.refilter();
});
/** MIDI ファイルを開いているか・原曲かバンドかで、操作の出し入れを合わせる */
function syncMidi(): void {
  const on = !!M,
    orig = !!M && !M.band;
  $('#cp-page').classList.toggle('cp-midi', on);
  srcEl.hidden = !on;
  plistEl.hidden = !on;
  bandEl.hidden = orig;
  $('#p-style').hidden = orig;
  $('#hd-band').textContent = orig ? '演奏' : 'バンド';
  const chip = $<HTMLButtonElement>('#cp-midin');
  chip.hidden = !on;
  chip.textContent = M?.m.name ?? '';
  for (const b of srcEl.querySelectorAll<HTMLElement>('[data-v]'))
    b.setAttribute('aria-pressed', String((b.dataset.v === 'band') === !!M?.band));
  for (const el of document.querySelectorAll<HTMLElement>('.cp-lgM')) el.hidden = !on;
  for (const el of document.querySelectorAll<HTMLElement>('.cp-lgE')) el.hidden = on;
  keyBtn.classList.toggle('ro', on);
  keyBtn.title = on ? '推した調' : '曲の調';
  const sig = M?.m.smf.sig[0];
  bpmGroup.setOff('bpm', on, M ? `${Math.round(M.m.smf.bpm)}（MIDI ファイル）` : '');
  meterCh.setOff(on, M ? `${sig ? `${sig[1]}/${sig[2]}` : '4/4'}（MIDI ファイル）` : '');
  if (on) renderParts();
}
$('#cp-midib').addEventListener('click', () => midiIn.click());
midiIn.addEventListener('change', async () => {
  const f = midiIn.files?.[0];
  midiIn.value = '';
  if (!f) return;
  let m: MidiSong;
  try {
    const smf = parseSmf(await f.arrayBuffer());
    m = midiSong(f.name.replace(/\.(midi?|rmi|kar)$/i, ''), smf, partsOf(smf));
  } catch {
    return say(`${f.name} は読み込めません。`);
  }
  const use = new Set(m.parts.filter((p) => !p.drum).map((p) => p.id));
  if (!use.size) return say('打楽器のほかに音がないので、コードを推せません。');
  const st = m.smf.starts,
    first = (st[1] ?? m.smf.end) - (st[0] ?? 0),
    base = sampleSong(SAMPLE0),
    song: Song = {
      ...base,
      name: m.name,
      meter: first === 3 ? 3 : 4,
      bpm: Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(m.smf.bpm))),
      style: S.song.style,
      keys: S.song.keys,
      gtr: S.song.gtr,
      chords: [],
    },
    prev = S.song;
  S.song = song;
  const midi = { m, use, mute: new Set<string>(), band: false, prog: progsOf(m.smf) };
  M = midi;
  const ok = reanalyze();
  S.song = prev;
  M = null;
  recompute();
  if (!ok) return say('打楽器のほかに音がないので、コードを推せません。');
  if (load(song, midi)) {
    say('');
    reveal(0);
  }
});

renderSaved();
say('');
syncControls();
syncLoop();
syncMet();
syncPlay();
layout();

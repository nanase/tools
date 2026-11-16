/**
 * コード進行のページの入口: 和音の地図で和音を並べ、緊張のレールとバンドで鳴らす。
 * 地図の三角形を押すと選んだ和音の後ろ（なければ最後）に足し、マウスでなぞると続けて足す。道の番号か駅を押すと選ぶ。
 * 曲は開き直しても戻るようにブラウザに保存し、名前を付けた保存は別のキーに持つ（設定をもとに戻しても消さない）
 */
import { Choice } from '../../lib/choice';
import { $, esc } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { outVol, type PlayKey } from '../../lib/play';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { CpAudio } from './audio';
import { MEMBER_NAMES, MEMBERS, type MemberId, Player, previewNotes } from './band';
import { Coaster, type CoasterState } from './coaster';
import { ICON } from './icons';
import { type MapState, MapView } from './map';
import { BPM, CLICK, VOL0 } from './params';
import { SAMPLE0, sampleSong } from './samples';
import {
  compute,
  type Entry,
  fromFile,
  type GtrId,
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
  player = new Player(audio, () => ({ song: S.song, on: S.on, loop: S.loop, met: S.met }));
let previewBus: GainNode | null = null;
/** 止まっている間の試聴（和音 1 つ） */
function preview(k: number): void {
  const e = entries[k];
  if (!e || player.playing) return;
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
  const on = player.playing;
  pp.classList.toggle('on', on);
  pp.setAttribute('aria-label', on ? '一時停止' : '演奏');
  pp.title = on ? '一時停止' : '選んだ和音から演奏';
  $('#cp-st').hidden = false;
  $('#cp-led').className = on ? 'led on' : 'led';
  $('#cp-stT').textContent = on ? '演奏中' : '待機中';
  posText(on ? (player.current()?.k ?? S.cue) : S.cue);
}
function posText(k: number): void {
  const e = entries[k],
    t = e ? `${e.bar} 小節 · ${roman(e.ch, e.key)}` : '–';
  const el = $('#cp-pos');
  if (el.textContent !== t) el.textContent = t;
}
async function play(): Promise<void> {
  if (player.playing) return pause();
  if (previewBus) audio.drop(previewBus);
  if (!(await player.start(S.sel ?? S.cue))) return;
  syncPlay();
  requestAnimationFrame(frame);
}
function pause(): void {
  const cur = player.current();
  player.halt();
  if (cur) S.cue = cur.k;
  syncPlay();
  draw();
}
player.onEnd = () => {
  S.cue = 0;
  syncPlay();
  draw();
};
/** 弾き始めの位置を変える（演奏中はすぐそこへ移る） */
function cueTo(k: number): void {
  S.cue = k;
  if (player.playing) player.jump(k);
  else posText(k);
}
function barJump(dir: -1 | 1): void {
  if (!entries.length) return;
  const cur = player.playing ? (player.current()?.k ?? S.cue) : S.cue,
    target = entries[cur].bar + dir;
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
autoPause(audio, { pause: () => player.playing && pause(), hidden: () => player.tick() });
new ParamGroup<PlayKey>([outVol(VOL0)], (v) => audio.vol(v.vol));
const bpmGroup = new ParamGroup<'bpm'>(
  [BPM],
  (v, k) => {
    if (!k) return;
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
const playing = (): number => (player.playing ? (player.current()?.k ?? -1) : -1);
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
  if (closePops()) return;
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
    hover = p;
    if (!player.playing) mapView.draw(mapState());
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
  if (!player.playing) mapView.draw(mapState());
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
  play: playing(),
  cart: cartBeat ?? entries[S.cue]?.start ?? 0,
  playing: player.playing,
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
  if (Math.abs(x - rdrag.x0) > 6) rdrag.moved = true;
  [rdrag.slot, rdrag.cx] = coaster.slotAt(coasterState(), x);
  if (rdrag.moved) coaster.draw(coasterState());
});
rcCv.addEventListener('pointerup', () => {
  const d = rdrag;
  rdrag = null;
  if (!d) return;
  if (!d.moved) {
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
  if (!edOpen || k === null || !e) {
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
  /* 地図は狭い画面で横にスクロールするので、枠からの位置に直す */
  const st = mapState(),
    cr = mapCv.getBoundingClientRect(),
    wr = mapw.getBoundingClientRect(),
    [px, py] = mapView.nodePos(st, k),
    nx = px + cr.left - wr.left,
    ny = py + cr.top - wr.top,
    w = ed.offsetWidth,
    h = ed.offsetHeight,
    mw = mapw.clientWidth,
    mh = mapCv.clientHeight;
  ed.style.left = `${Math.max(4, Math.min(mw - w - 4, nx - w / 2))}px`;
  ed.style.top = `${ny + 22 + h > mh ? Math.max(4, ny - h - 22) : ny + 22}px`;
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
const bandEl = $('#cp-band'),
  memberEl = {} as Record<MemberId, HTMLButtonElement>;
for (const m of MEMBERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cp-mem';
  b.dataset.m = m;
  b.addEventListener('click', () => {
    S.on[m] = !S.on[m];
    store('on', S.on);
    syncBand();
    player.resync();
  });
  bandEl.appendChild(b);
  memberEl[m] = b;
}
function syncBand(): void {
  for (const m of MEMBERS) {
    const b = memberEl[m];
    b.setAttribute('aria-pressed', String(S.on[m]));
    b.title = `${MEMBER_NAMES[m]}（押すと${S.on[m] ? 'ミュート' : '戻す'}）`;
    b.innerHTML = `${BAND_ICON[m]()}<span>${MEMBER_NAMES[m]}</span><small>${memberSub[m]()}</small>`;
  }
}
player.onHit = (m, at) => {
  const now = audio.now() ?? 0;
  setTimeout(
    () => {
      memberEl[m].classList.add('hit');
      setTimeout(() => memberEl[m].classList.remove('hit'), 90);
    },
    Math.max(0, (at - now) * 1000),
  );
};
/* 曲ごとの選択肢（保存は曲と一緒にするので、選択肢としては保存しない） */
for (const id of ['#p-style', '#p-meter', '#p-keys', '#p-gtr']) $(id).setAttribute('data-nosave', '');
const styleCh = new Choice<StyleId>($('#p-style'), (v) => songSet(() => (S.song.style = v)));
const meterCh = new Choice<string>($('#p-meter'), (v) => songSet(() => (S.song.meter = Number(v) as Meter)));
const keysCh = new Choice<KeysId>($('#p-keys'), (v) => songSet(() => (S.song.keys = v)));
const gtrCh = new Choice<GtrId>($('#p-gtr'), (v) => songSet(() => (S.song.gtr = v)));
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
});
/** 曲を入れ替えたあと、選択肢と数値の行を曲に合わせる */
function syncControls(): void {
  styleCh.set(S.song.style);
  meterCh.set(String(S.song.meter));
  keysCh.set(S.song.keys);
  gtrCh.set(S.song.gtr);
  bpmGroup.set('bpm', S.song.bpm, { silent: true });
  syncBand();
}

/* ---------- 描画 ---------- */
function draw(): void {
  mapView.draw(mapState());
  coaster.draw(coasterState());
  keyBtn.textContent = keyName(S.song.key);
}
function changed(): void {
  recompute();
  S.dirty = true;
  saveCurrent();
  player.resync();
  draw();
  showEd();
  posText(player.playing ? (player.current()?.k ?? S.cue) : (S.sel ?? S.cue));
}
function frame(): void {
  if (!player.playing) {
    cartBeat = null;
    draw();
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
    box = sc.scrollWidth > sc.clientWidth + 1 ? null : mapView.freeBox(104, 150);
  rcw.classList.toggle('below', !box);
  if (box) {
    /* 左の端は地図に溶かすので、その分だけ三角形の上へ広げる */
    const w = Math.round(Math.min(box.w + FADE_L, 400));
    rcw.style.left = `${box.x + box.w - w}px`;
    rcw.style.top = `${box.y}px`;
    coaster.layout(w, box.h, FADE_R + 4);
  } else {
    rcw.style.left = rcw.style.top = '';
    coaster.layout(rcw.clientWidth || mapw.clientWidth, 112);
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
function load(song: Song): boolean {
  if (S.dirty && !confirm(`保存していない変更は失われます。「${song.name || '新しい進行'}」を開きますか？`))
    return false;
  player.halt(true);
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

renderSaved();
say('');
syncControls();
syncLoop();
syncMet();
syncPlay();
layout();

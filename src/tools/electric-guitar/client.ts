/**
 * エレキギターのページの入口: 機材の並び（ペダルを足す・外す・並べ替える）・設定の窓・プリセット・
 * フレーズの演奏・指板・MIDI → ワークレット（音）と描画。
 * 全体図と一覧を切り替える。機材を押すと隣に設定の窓を開き、選んだ機材を通った音の波形を出して試聴できる。
 * 波形と指板は、音を出すまで空のままにする（演奏を始める前に動いて見えないように）
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { MidiBox, touchOf } from '../../lib/midi';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { outVol, type PlayKey, TEMPO } from '../../lib/play';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { evenLine, Transport } from '../../lib/transport';
import { EgAudio } from './audio';
import { ANY, type Any, defOf, KEY, KNOB_ROWS, keyOf, knobOff, PICK_ROWS, scaleOf, VOL0 } from './params';
import { defaults, FIXED, KINDS, type Kind } from './pedals';
import { phraseOf, presetOf, presetRack } from './phrases';
import type { Msg, Snap } from './proc';
import { cloneRack, DEFAULT_RACK, MAX_PEDALS, type Pedal, type Rack, type StageId, stagesOf } from './rig';
import { FRETS, TUNING } from './strings';
import {
  anchorOf,
  drawChar,
  drawFret,
  drawSpec,
  drawWave,
  dropSlot,
  type Flash,
  fretHit,
  type Layout,
  layout,
  readColors,
  rigSvg,
  type Sec,
} from './view';

initToolPage();

const txt = (el: Element, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};
const EAR =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9a5 5 0 0 1 10 0v4h-2.5V9.5H13M3 9v4h2.5V9.5H3"/></svg>';
const SPK =
  '<svg class="eg-spkI" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 6h3l4-3.5v11l-4-3.5h-3Z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M13 3.5a6.5 6.5 0 0 1 0 9"/></svg>';

/* ---------- 機材の並びの保存と読み込み ---------- */
const isKind = (k: unknown): k is Kind => typeof k === 'string' && k in KINDS;
/** 保存した並びを確かめて戻す（足りない項目は既定値で埋める） */
function loadRack(): Rack {
  const x = stored('rack') as Partial<Rack> | undefined,
    R = cloneRack(DEFAULT_RACK);
  if (!x || typeof x !== 'object') return R;
  for (const d of ['pu', 'amp', 'cab'] as const) if (x[d] && typeof x[d] === 'object') Object.assign(R[d], x[d]);
  const seen = new Set<number>();
  const ped = (list: unknown): Pedal[] =>
    (Array.isArray(list) ? list : [])
      .filter(
        (p): p is Pedal =>
          !!p &&
          typeof p === 'object' &&
          isKind((p as Pedal).k) &&
          Number.isInteger((p as Pedal).id) &&
          !seen.has((p as Pedal).id),
      )
      .slice(0, MAX_PEDALS)
      .map((p) => {
        seen.add(p.id);
        return { id: p.id, k: p.k, on: p.on !== false, v: { ...defaults(KINDS[p.k]), ...(p.v ?? {}) } };
      });
  if (Array.isArray(x.pre)) R.pre = ped(x.pre);
  if (Array.isArray(x.post)) R.post = ped(x.post);
  return R;
}

/** 並びの比べ方: キーの順によらない文字列 */
function canon(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${k}:${canon((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(x);
}
/** 最後に読み込んだプリセット（なければ既定の並び）。変えたかどうかをこれと比べる */
const base0 = stored('rackBase') as { v?: unknown; R?: unknown } | undefined;
let base = {
  v: typeof base0?.v === 'string' ? base0.v : '',
  R: typeof base0?.R === 'string' ? base0.R : canon(DEFAULT_RACK),
};

/* ---------- 状態 ---------- */
const S = {
  R: loadRack(),
  /** 選んだ段（波形を出す・設定の窓を開く）と、窓を開いているか */
  sel: 'amp' as StageId,
  open: false,
  /** 開いている足す所 */
  menu: null as { sec: Sec; i: number } | null,
  /** 試聴している段（'out' は出力。保存しない） */
  listen: 'out' as StageId,
  preset: '',
  tempo: 100,
  key: 0,
  /** フレーズを弾いているか（一時停止の間は含まない） */
  playing: false,
  snap: null as Snap | null,
  snapFs: 24000,
  drag: null as { id: number; x: number; y: number; to: ReturnType<typeof dropSlot> } | null,
};
if (canon(S.R) === base.R) S.preset = base.v;
/** 読み込んだプリセットから機材を変えたか */
const edited = () => canon(S.R) !== base.R;
const audio = new EgAudio();
const post = (m: Msg) => audio.post(m);
const view = new Choice<'rig' | 'list'>($('#p-view'), () => render());

/* ---------- 機材と段 ---------- */
const pedals = () => [...S.R.pre, ...S.R.post];
const pedalOf = (id: StageId): Pedal | undefined =>
  id[0] === 'p' ? pedals().find((p) => `p${p.id}` === id) : undefined;
const anyOf = (id: StageId): Any => (pedalOf(id)?.k ?? id) as Any;
/** 段の設定（ペダルは v、動かせない機材は R の項目） */
const valsOf = (id: StageId): Record<string, number | string> =>
  pedalOf(id)?.v ?? (S.R[id as 'pu' | 'amp' | 'cab'] as unknown as Record<string, number | string>);
/** 段の名前。同じ種類のペダルが 2 台以上なら番号を付ける */
function nameOf(id: StageId): string {
  if (id === 'out') return '出力';
  const p = pedalOf(id);
  if (!p) return FIXED[id as 'pu' | 'amp' | 'cab']?.name ?? '';
  const same = pedals().filter((q) => q.k === p.k);
  return same.length > 1 ? `${KINDS[p.k].name} ${same.indexOf(p) + 1}` : KINDS[p.k].name;
}
const secOf = (p: Pedal): Sec => (S.R.pre.includes(p) ? 'pre' : 'post');
const exists = (id: StageId) => id === 'out' || stagesOf(S.R).includes(id);

/** 並びや設定を変えたあと: 保存し、音へ送り、描き直す。swap は音色の切り替え */
function commit(swap = false): void {
  store('rack', S.R);
  post({ t: 'rack', R: S.R, swap });
  if (!exists(S.sel)) S.sel = 'amp';
  if (!exists(S.listen)) listenAt('out');
  render();
}
/**
 * つまみと選択の変更: 保存して音へ送り、図と窓の中身だけを替える。
 * 窓を動かしたり行を入れ直したりしない（ドラッグ中のスライダーが外れるため）
 */
function tweak(): void {
  store('rack', S.R);
  post({ t: 'rack', R: S.R });
  if (view.value === 'rig') $('#rig').innerHTML = rigSvg(S.R, L, S.sel, S.listen, S.menu, S.drag);
  else {
    const row = $(`[data-strow="${S.sel}"]`, $('#list'));
    if (row) {
      row.outerHTML = rowHtml(S.sel);
      drawRowChar(S.sel);
    }
  }
  const a = anyOf(S.sel),
    v = valsOf(S.sel),
    g = groups.get(a);
  for (const d of defOf(a).knobs) {
    const why = knobOff(a, d.k, v);
    g?.setOff(keyOf(a, d.k), !!why, why);
  }
  const p = pedalOf(S.sel);
  drawChar($<HTMLCanvasElement>('#pop-char'), a, v, 48000, !!p && !p.on);
  syncPresets();
}

/* ---------- 設定の窓の行（種類ごとに 1 組。開いた機材の値を出し入れする） ---------- */
const groups = new Map<Any, ParamGroup<string>>();
const picks = new Map<string, Choice<string>>();
for (const a of ANY) {
  groups.set(
    a,
    new ParamGroup<string>(
      KNOB_ROWS[a],
      (v, k) => {
        if (!k || !S.open || anyOf(S.sel) !== a) return;
        const d = defOf(a).knobs.find((q) => keyOf(a, q.k) === k);
        if (!d) return;
        valsOf(S.sel)[d.k] = v[k] / scaleOf(d);
        S.preset = '';
        tweak();
      },
      null,
      { save: false },
    ),
  );
  for (const p of PICK_ROWS[a]) {
    const id = keyOf(a, p.k);
    forget(`c:p-${id}`);
    picks.set(
      id,
      new Choice<string>($(`#p-${id}`), (v) => {
        if (!S.open || anyOf(S.sel) !== a) return;
        valsOf(S.sel)[p.k] = v;
        S.preset = '';
        tweak();
      }),
    );
  }
}
/** 開いていない種類の行は既定の値に戻しておく（枠の「↺ n」に数えないため） */
function resetRows(except: Any | null): void {
  for (const b of ANY) {
    if (b === except) continue;
    const g = groups.get(b);
    for (const d of defOf(b).knobs) g?.set(keyOf(b, d.k), Number((d.v * scaleOf(d)).toFixed(6)), { silent: true });
    for (const p of defOf(b).picks ?? []) picks.get(keyOf(b, p.k))?.set(p.v);
  }
}
/** 窓の行へ、開いた機材の値を入れる */
function fillPop(): void {
  resetRows(anyOf(S.sel));
  const a = anyOf(S.sel),
    v = valsOf(S.sel),
    g = groups.get(a);
  for (const sec of $$<HTMLElement>('[data-rows]')) sec.hidden = sec.dataset.rows !== a;
  for (const d of defOf(a).knobs) {
    const k = keyOf(a, d.k);
    g?.set(k, Number((Number(v[d.k]) * scaleOf(d)).toFixed(6)), { silent: true });
    const why = knobOff(a, d.k, v);
    g?.setOff(k, !!why, why);
  }
  for (const p of defOf(a).picks ?? []) picks.get(keyOf(a, p.k))?.set(String(v[p.k]));
}

/* ---------- 選ぶ・試聴・オンとスルー・動かす・足す・外す ---------- */
function selectDev(id: StageId): void {
  S.menu = null;
  /* 出力は設定がないので、選ぶだけ（波形を出す） */
  if (id === 'out') {
    S.sel = 'out';
    S.open = false;
    render();
    return;
  }
  /* 開いている機材をもう一度押すと閉じる */
  S.open = !(S.sel === id && S.open);
  S.sel = id;
  render();
}
function listenAt(id: StageId): void {
  S.listen = id;
  post({ t: 'listen', k: id });
  render();
}
function toggleOn(id: StageId): void {
  const p = pedalOf(id);
  if (!p) return;
  p.on = !p.on;
  S.preset = '';
  commit();
}
function move(id: StageId, d: number): void {
  const p = pedalOf(id);
  if (!p) return;
  const L = S.R[secOf(p)],
    i = L.indexOf(p),
    j = i + d;
  if (j < 0 || j >= L.length) return;
  [L[i], L[j]] = [L[j], L[i]];
  S.preset = '';
  commit();
}
/** ペダル id を、列 sec の i 番目の前へ動かす */
function moveTo(id: number, sec: Sec, i: number): void {
  const p = pedals().find((q) => q.id === id);
  if (!p) return;
  const from = S.R[secOf(p)],
    k = from.indexOf(p);
  /* 今と同じ位置なら何もしない */
  if (from === S.R[sec] && (i === k || i === k + 1)) {
    render();
    return;
  }
  from.splice(k, 1);
  S.R[sec].splice(from === S.R[sec] && k < i ? i - 1 : i, 0, p);
  S.preset = '';
  commit();
}
function addPedal(k: Kind): void {
  const m = S.menu;
  if (!m || S.R[m.sec].length >= MAX_PEDALS) return;
  const id = Math.max(0, ...pedals().map((p) => p.id)) + 1;
  S.R[m.sec].splice(m.i, 0, { id, k, on: true, v: defaults(KINDS[k]) });
  S.menu = null;
  S.sel = `p${id}`;
  S.open = true;
  S.preset = '';
  commit();
}
function removePedal(id: StageId): void {
  const p = pedalOf(id);
  if (!p) return;
  const L = S.R[secOf(p)];
  L.splice(L.indexOf(p), 1);
  S.open = false;
  S.sel = 'amp';
  S.preset = '';
  commit();
}

/* ---------- 描画（全体図・一覧・窓） ---------- */
let L: Layout = layout(S.R);
const pop = $('#pop'),
  menu = $('#eg-menu'),
  home = pop.parentElement as HTMLElement;
const ARW_D = '<svg viewBox="0 0 12 14"><path d="M6 0V10"/><path class="eg-ah" d="M1.5 7.5L6 13L10.5 7.5Z"/></svg>';
/** 一覧の行 */
function rowHtml(id: StageId): string {
  const p = pedalOf(id),
    a = anyOf(id),
    g = p ? KINDS[p.k].g : 'fix',
    sub = p ? (p.on ? 'オン' : 'スルー') : subOf(id),
    i = p ? S.R[secOf(p)].indexOf(p) : 0,
    n = p ? S.R[secOf(p)].length : 0,
    ls = S.listen === id,
    nm = nameOf(id);
  const grip = p
    ? `<i class="ls-st ls-grip" data-grip="${p.id}" title="ドラッグで並べ替え" aria-hidden="true"></i>`
    : '<i class="ls-st" aria-hidden="true"></i>';
  return `<div class="eg-st g-${g}${S.sel === id ? ' sel' : ''}${p && !p.on ? ' byp' : ''}" data-strow="${id}" data-dev="${id}">${grip}<div class="eg-stn"><b>${nm}</b><small class="eg-sub">${sub}</small></div>${p ? `<button type="button" class="tg eg-on2" data-on="${id}" aria-pressed="${p.on}" title="${nm}のオンとスルー"><span class="led${p.on ? ' on' : ''}" aria-hidden="true"></span><span>${p.on ? 'オン' : 'スルー'}</span></button>` : '<span></span>'}<canvas class="eg-cv eg-mw" data-mwave="${id}" aria-hidden="true"></canvas><canvas class="eg-cv eg-mc" data-mchar="${id}" data-a="${a}" aria-hidden="true"></canvas>${p ? `<span class="seg eg-mv"><button type="button" data-mv="${id}:-1" ${i === 0 ? 'disabled' : ''} title="前へ" aria-label="前へ">↑</button><button type="button" data-mv="${id}:1" ${i === n - 1 ? 'disabled' : ''} title="後ろへ" aria-label="後ろへ">↓</button></span>` : '<span></span>'}<button type="button" class="eg-ear" data-listen="${id}" aria-pressed="${ls}" title="${nm}を通った音を試聴">${EAR}<span>${ls ? '試聴中' : '試聴'}</span></button></div>`;
}
const arw = `<div class="eg-arw" aria-hidden="true">${ARW_D}</div>`;
function subOf(id: StageId): string {
  const R = S.R;
  if (id === 'pu') {
    const c = FIXED.pu.picks?.[0].choices.find((q) => q[0] === R.pu.coil)?.[1],
      s = FIXED.pu.picks?.[1].choices.find((q) => q[0] === R.pu.sel)?.[1];
    return `${c} · ${s}`;
  }
  if (id === 'amp') return FIXED.amp.picks?.[0].choices.find((q) => q[0] === R.amp.type)?.[1] ?? '';
  return FIXED.cab.picks?.[0].choices.find((q) => q[0] === R.cab.type)?.[1] ?? '';
}
function listHtml(): string {
  const add = (sec: Sec) =>
    S.R[sec].length < MAX_PEDALS
      ? `<button type="button" class="ls-add${S.menu?.sec === sec ? ' on' : ''}" data-slot="${sec}:${S.R[sec].length}" data-add-of="${sec}">＋ 機材を追加</button>${arw}`
      : '';
  let s = rowHtml('pu') + arw;
  for (const p of S.R.pre) s += rowHtml(`p${p.id}`) + arw;
  s += `${add('pre')}${rowHtml('amp')}${arw}${rowHtml('cab')}${arw}`;
  for (const p of S.R.post) s += rowHtml(`p${p.id}`) + arw;
  const ls = S.listen === 'out';
  return `${s}${add('post')}<div class="eg-st fx${S.sel === 'out' ? ' sel' : ''}" data-strow="out" data-dev="out"><i class="ls-st" aria-hidden="true"></i><div class="eg-stn"><b class="eg-ob">${SPK}出力</b><small class="eg-sub">スピーカー</small></div><span></span><canvas class="eg-cv eg-mw" data-mwave="out" aria-hidden="true"></canvas><span></span><span></span><button type="button" class="eg-ear" data-listen="out" aria-pressed="${ls}" title="出力を試聴">${EAR}<span>${ls ? '試聴中' : '試聴'}</span></button></div>`;
}
/** 一覧の行の特性の小さな図 */
function drawRowChar(id: StageId): void {
  const cv = $<HTMLCanvasElement>(`[data-mchar="${id}"]`, $('#list'));
  if (!cv) return;
  const p = pedalOf(id);
  drawChar(cv, anyOf(id), valsOf(id), 48000, !!p && !p.on, true);
}
/** 窓（設定・足す）を、全体図では機材の下に浮かせ、一覧では行の下に入れる */
function placePops(): void {
  const rig = view.value === 'rig',
    narrow = $('#rigw').clientWidth < 620;
  for (const el of [pop, menu]) {
    el.classList.remove('pp-f', 'pp-in');
    el.style.cssText = '';
  }
  pop.hidden = !S.open;
  menu.hidden = !S.menu;
  const el = S.menu ? menu : S.open ? pop : null;
  if (!el) return;
  if (rig && !narrow) {
    const w = $('#rigw'),
      k = w.clientWidth / 1000,
      a = S.menu ? (L.slots.find((q) => q.sec === S.menu?.sec && q.i === S.menu?.i) ?? null) : anchorOf(L, S.sel),
      ax = (a?.x ?? 500) * k,
      ay = ((a?.y ?? 200) + (S.menu ? 16 : 0)) * k,
      pw = Math.min(el === menu ? 420 : 360, w.clientWidth - 8),
      left = Math.max(4, Math.min(w.clientWidth - pw - 4, ax - pw / 2));
    w.append(el);
    el.classList.add('pp-f');
    el.style.cssText = `left:${left}px;top:${ay + 8}px;width:${pw}px;--ax:${(ax - left).toFixed(0)}px`;
  } else if (rig) {
    $('#v-rig').append(el);
    el.classList.add('pp-in');
  } else {
    const after = S.menu
      ? $(`[data-slot="${S.menu.sec}:${S.menu.i}"]`, $('#list'))
      : $(`[data-strow="${S.sel}"]`, $('#list'));
    (after ?? $('#list')).after(el);
    el.classList.add('pp-in');
  }
}
function syncPop(): void {
  if (!S.open) {
    resetRows(null);
    return;
  }
  const p = pedalOf(S.sel),
    nm = nameOf(S.sel),
    on = $<HTMLButtonElement>('#pop-on');
  txt($('#pop-name'), nm);
  on.hidden = !p;
  if (p) {
    on.setAttribute('aria-pressed', String(p.on));
    $('.led', on).classList.toggle('on', p.on);
    txt($('.eg-ont', on), p.on ? 'オン' : 'スルー');
    on.title = `${nm}のオンとスルー`;
    const list = S.R[secOf(p)],
      i = list.indexOf(p);
    $<HTMLButtonElement>('#pop-l').disabled = i === 0;
    $<HTMLButtonElement>('#pop-r').disabled = i === list.length - 1;
  }
  $('#pop-mv').hidden = !p;
  $('#pop-del').hidden = !p;
  const ls = S.listen === S.sel;
  $('#pop-ls').setAttribute('aria-pressed', String(ls));
  txt($('#pop-lsT'), ls ? '試聴中' : '試聴');
  fillPop();
  drawChar($<HTMLCanvasElement>('#pop-char'), anyOf(S.sel), valsOf(S.sel), 48000, !!p && !p.on);
}
function render(): void {
  L = layout(S.R);
  /* 窓を一時的に元の場所へ戻してから描き直す（一覧の描き直しで消さないため） */
  home.append(pop, menu);
  const rig = view.value === 'rig';
  $('#v-rig').hidden = !rig;
  $('#v-list').hidden = rig;
  if (rig) $('#rig').innerHTML = rigSvg(S.R, L, S.sel, S.listen, S.menu, S.drag);
  else {
    $('#list').innerHTML = listHtml();
    for (const cv of $$<HTMLCanvasElement>('[data-mchar]', $('#list'))) drawRowChar(cv.dataset.mchar as StageId);
  }
  placePops();
  syncPop();
  /* 波形とスペクトルの枠・試聴・音色 */
  txt($('#out-name'), nameOf(S.sel));
  txt($('#out-suf'), S.sel === 'out' ? '' : 'を通った音');
  const ls = S.listen === S.sel;
  $('#lsnBtn').setAttribute('aria-pressed', String(ls));
  txt($('#lsnT'), ls ? '試聴中' : '試聴');
  txt($('#hear-name'), S.listen === 'out' ? '出力' : `${nameOf(S.listen)}を通った音`);
  $('#hearBack').hidden = S.listen === 'out';
  syncPresets();
}
function syncPresets(): void {
  for (const b of $$<HTMLButtonElement>('[data-preset]'))
    b.setAttribute('aria-pressed', String(b.dataset.preset === S.preset));
}

/* ---------- プリセット ---------- */
function applyPreset(v: string): void {
  /* 読み込んだプリセットから機材を変えていれば、捨ててよいかを確かめる */
  if (edited() && !confirm(`変更した機材の設定は失われます。「${presetOf(v).name}」に切り替えますか？`)) return;
  S.R = presetRack(v);
  S.preset = v;
  base = { v, R: canon(S.R) };
  store('rackBase', base);
  S.open = false;
  S.menu = null;
  commit(true);
  pickPhrase(presetOf(v).phrase);
}
$('#tone').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-preset]');
  if (b?.dataset.preset) applyPreset(b.dataset.preset);
});

/* ---------- 演奏 ---------- */
const phrase = new Choice<string>($('#p-phr'), () => {
  S.preset = '';
  render();
  phraseChanged();
});
function pickPhrase(v: string): void {
  if (phrase.value === v) return;
  phrase.choose(v);
  phraseChanged();
}
const bpm = () => (phraseOf(phrase.value).bpm * S.tempo) / 100;
function lineOf() {
  const ph = phraseOf(phrase.value);
  return evenLine({ bar: 4, pickup: 0, end: ph.bars * 4, sec: (b) => (b * 60) / ph.bpm });
}
/** フレーズを変えた: 位置を頭に戻し、弾いていればその頭から弾き直す */
function phraseChanged(): void {
  const was = S.playing;
  if (was) audio.post({ t: 'pause' });
  S.playing = false;
  transport.setLine(lineOf());
  transport.stopped(true);
  if (was) void startPhrase(0);
}
const msg = (s: string) => txt($('#snd-msg'), s);
const NO_SOUND = '音を出せませんでした。';
/** 拍 b から弾く（くり返しの中の位置） */
async function startPhrase(b: number): Promise<void> {
  if (!(await audio.ready())) {
    msg(NO_SOUND);
    return;
  }
  msg('');
  S.playing = true;
  audio.post({ t: 'play', v: phrase.value, bpm: bpm(), beat: b });
  transport.sync();
}
function stopPhrase(): void {
  if (!S.playing) return;
  S.playing = false;
  audio.post({ t: 'pause' });
  transport.sync();
}
/** 一時停止: フレーズを止め、弦は鳴らしたままにする。止めた拍を返す */
function pausePhrase(): number {
  const b = S.snap && S.snap.beat >= 0 ? S.snap.beat % (phraseOf(phrase.value).bars * 4) : 0;
  stopPhrase();
  return b;
}
const transport = new Transport({
  active: () => S.playing,
  start: startPhrase,
  stop: stopPhrase,
  pause: pausePhrase,
  tempo: () => S.tempo,
});
transport.setLine(lineOf());
new ParamGroup<PlayKey>([TEMPO], (v, k) => {
  S.tempo = v.tempo;
  audio.post({ t: 'bpm', bpm: bpm() });
  if (k) transport.refresh();
});
new ParamGroup<PlayKey>([outVol(VOL0)], (v) => audio.vol(v.vol));
new ParamGroup<'key'>([KEY], (v) => {
  S.key = v.key;
  post({ t: 'key', k: S.key });
});
$('#muteBtn').addEventListener('click', () => audio.post({ t: 'mute', si: -1 }));
autoPause(audio, { pause: () => transport.pause(), hidden: () => {} });

/* 音の準備ができたら、設定をまとめて送り直す */
audio.onReady = () => {
  audio.post({ t: 'rack', R: S.R });
  audio.post({ t: 'listen', k: S.listen });
  audio.post({ t: 'key', k: S.key });
};
audio.onSnap = (s) => {
  took(s);
  S.snapFs = audio.rate;
};
/** 写しを受ける。弾いた弦には指板に輪を出す */
function took(s: Snap): void {
  S.snap = s;
  const now = performance.now();
  for (const p of s.plucks) flash.push({ si: p.si, fr: p.fret, at: now });
}

/* ---------- 指板 ---------- */
const flash: Flash[] = [];
async function pluck(si: number, fr: number, amp = 0.9): Promise<void> {
  if (!(await audio.ready())) {
    msg(NO_SOUND);
    return;
  }
  audio.post({ t: 'pluck', si, fret: fr, amp });
}
{
  const cv = $<HTMLCanvasElement>('#fret');
  let drag: { last: number; fr: number } | null = null;
  cv.addEventListener('pointerdown', (e) => {
    const h = fretHit(cv, e.clientX, e.clientY);
    if (h.mute) {
      audio.post({ t: 'mute', si: h.si });
      return;
    }
    void pluck(h.si, h.fr);
    drag = { last: h.si, fr: h.fr };
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const h = fretHit(cv, e.clientX, e.clientY);
    if (h.mute || h.si === drag.last) return;
    const d = h.si > drag.last ? 1 : -1;
    for (let s = drag.last + d; s !== h.si + d; s += d) void pluck(s, h.fr, 0.8);
    drag.last = h.si;
  });
  const end = () => {
    drag = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

/* ---------- MIDI ---------- */
/** 開放弦の MIDI の番号（1 弦から） */
const OPEN = TUNING.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** 押している音: 音 → 弦とフレット、押した順 */
const held = new Map<number, { si: number; fr: number; t: number }>();
let sustain = false;
const sustained = new Set<number>();
let heldT = 0,
  wheelBend = 0,
  wheelVib = 0;
/** 押した音を、押さえるフレットがいちばん低くなる空いた弦で弾く。空いた弦がなければ、最も前に押した音の弦を使う */
function stringFor(note: number): { si: number; fr: number } | null {
  const can = OPEN.map((o, si) => ({ si, fr: note - o })).filter((c) => c.fr >= 0 && c.fr <= FRETS);
  if (!can.length) return null;
  const used = new Map([...held.values()].map((h) => [h.si, h.t])),
    free = can.filter((c) => !used.has(c.si));
  if (free.length) return free.reduce((a, b) => (b.fr < a.fr ? b : a));
  return can.reduce((a, b) => ((used.get(b.si) ?? 0) < (used.get(a.si) ?? 0) ? b : a));
}
const midiBox = new MidiBox(
  {
    on(note, vel) {
      const at = stringFor(note),
        name = `${NOTE[note % 12]}${Math.floor(note / 12) - 1}`;
      if (!at) {
        midiBox.show(name, vel, '弦の範囲外');
        return;
      }
      for (const [n, h] of held) if (h.si === at.si) held.delete(n);
      held.set(note, { ...at, t: ++heldT });
      sustained.delete(note);
      midiBox.show(name, vel, `${at.si + 1} 弦 ${at.fr} フレット`);
      void pluck(at.si, at.fr, 0.25 + 0.85 * touchOf(vel, 'std'));
    },
    off(note) {
      const h = held.get(note);
      if (!h) return;
      if (sustain) {
        sustained.add(note);
        return;
      }
      held.delete(note);
      audio.post({ t: 'mute', si: h.si });
    },
    cc(num, v) {
      if (num === 64) {
        sustain = v >= 64;
        if (!sustain) {
          for (const n of sustained) {
            const h = held.get(n);
            if (h) audio.post({ t: 'mute', si: h.si });
            held.delete(n);
          }
          sustained.clear();
        }
      } else if (num === 1) {
        wheelVib = (v / 127) * 0.5;
        audio.post({ t: 'wheel', bend: wheelBend, vib: wheelVib });
      }
    },
    bend(v) {
      wheelBend = 2 * v;
      audio.post({ t: 'wheel', bend: wheelBend, vib: wheelVib });
    },
  },
  {
    ready: () => audio.ready(),
    stopped: () => {
      held.clear();
      sustained.clear();
      sustain = false;
      wheelBend = wheelVib = 0;
      audio.post({ t: 'wheel', bend: 0, vib: 0 });
    },
  },
);

/* ---------- 押す・ドラッグ ---------- */
/** ドラッグのあとに来るクリックを無視する */
let dragged = false;
document.addEventListener('click', (e) => {
  const t = e.target as Element;
  if (dragged) {
    dragged = false;
    if (t.closest('#rig, #list')) return;
  }
  if (t.closest('#pop, #eg-menu')) return;
  const fs = t.closest<SVGElement>('[data-fs]');
  if (fs?.dataset.fs) return toggleOn(fs.dataset.fs);
  const on = t.closest<HTMLElement>('[data-on]');
  if (on?.dataset.on) return toggleOn(on.dataset.on);
  const mv = t.closest<HTMLElement>('[data-mv]');
  if (mv?.dataset.mv) {
    const [id, d] = mv.dataset.mv.split(':');
    return move(id, Number(d));
  }
  const li = t.closest<HTMLElement>('[data-listen]');
  if (li?.dataset.listen) return listenAt(li.dataset.listen === S.listen ? 'out' : li.dataset.listen);
  const sl = t.closest<HTMLElement | SVGElement>('[data-slot]');
  if (sl?.dataset.slot) {
    const [sec, i] = sl.dataset.slot.split(':');
    S.menu = S.menu?.sec === sec && S.menu.i === Number(i) ? null : { sec: sec as Sec, i: Number(i) };
    S.open = false;
    return render();
  }
  const dv = t.closest<HTMLElement | SVGElement>('[data-dev]');
  if (dv?.dataset.dev) return selectDev(dv.dataset.dev);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (S.open || S.menu)) {
    S.open = false;
    S.menu = null;
    render();
    return;
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target as Element,
    sl = t.closest<SVGElement>('svg [data-slot]'),
    dv = t.closest<SVGElement>('svg [data-dev]');
  if (!sl && !dv) return;
  e.preventDefault();
  (sl ?? dv)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
$('#pop-x').addEventListener('click', () => {
  S.open = false;
  render();
});
$('#eg-menu-x').addEventListener('click', () => {
  S.menu = null;
  render();
});
$('#pop-on').addEventListener('click', () => toggleOn(S.sel));
$('#pop-l').addEventListener('click', () => move(S.sel, -1));
$('#pop-r').addEventListener('click', () => move(S.sel, 1));
$('#pop-ls').addEventListener('click', () => listenAt(S.listen === S.sel ? 'out' : S.sel));
$('#pop-del').addEventListener('click', () => removePedal(S.sel));
$('#eg-menu').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-add]');
  if (b?.dataset.add && isKind(b.dataset.add)) addPedal(b.dataset.add);
});
$('#lsnBtn').addEventListener('click', () => listenAt(S.listen === S.sel ? 'out' : S.sel));
$('#hearBack').addEventListener('click', () => listenAt('out'));
/* 全体図のペダルをドラッグして並べ替える */
{
  const svg = $<SVGSVGElement>('#rig');
  let start: { id: number; x: number; y: number; pid: number } | null = null;
  const toSvg = (e: PointerEvent) => {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  svg.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest<SVGElement>('[data-dev^="p"]');
    if (!g?.dataset.dev || (e.target as Element).closest('[data-fs]')) return;
    const q = toSvg(e);
    start = { id: Number(g.dataset.dev.slice(1)), x: q.x, y: q.y, pid: e.pointerId };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.pid) return;
    const q = toSvg(e);
    if (!S.drag && Math.hypot(q.x - start.x, q.y - start.y) < 8) return;
    if (!S.drag) {
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* 合成したイベントなど、捕まえられないとき */
      }
      S.open = false;
      S.menu = null;
    }
    S.drag = { id: start.id, x: q.x, y: q.y, to: dropSlot(S.R, q.x, q.y, start.id) };
    render();
  });
  const end = () => {
    const d = S.drag;
    start = null;
    if (!d) return;
    S.drag = null;
    dragged = true;
    if (d.to) moveTo(d.id, d.to.sec, d.to.i);
    else render();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

/* 一覧の行を、名前の左の帯をつかんでドラッグして並べ替える */
{
  const list = $('#list'),
    line = document.createElement('div');
  line.className = 'ls-drop';
  let d: { id: number; pid: number; row: HTMLElement; to: { sec: Sec; i: number } | null } | null = null;
  /** 落とす所の候補: 列ごとの行のあいだの y（画面の座標） */
  function gaps(): { sec: Sec; i: number; y: number }[] {
    const out: { sec: Sec; i: number; y: number }[] = [],
      top = (el: Element | null) => el?.getBoundingClientRect().top ?? 0,
      bot = (el: Element | null) => el?.getBoundingClientRect().bottom ?? 0,
      row = (id: string) => $(`[data-strow="${id}"]`, list);
    for (const sec of ['pre', 'post'] as const) {
      const L2 = S.R[sec];
      if (d && !L2.some((p) => p.id === d?.id) && L2.length >= MAX_PEDALS) continue;
      const before = row(sec === 'pre' ? 'pu' : 'cab'),
        after = $(`[data-add-of="${sec}"]`, list) ?? row(sec === 'pre' ? 'amp' : 'out');
      L2.forEach((p, i) => {
        const r = row(`p${p.id}`),
          prev = i ? row(`p${L2[i - 1].id}`) : before;
        out.push({ sec, i, y: (bot(prev) + top(r)) / 2 });
      });
      const last = L2.length ? row(`p${L2[L2.length - 1].id}`) : before;
      out.push({ sec, i: L2.length, y: (bot(last) + top(after)) / 2 });
    }
    return out;
  }
  list.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest<HTMLElement>('[data-grip]');
    if (!g?.dataset.grip) return;
    e.preventDefault();
    const row = g.closest<HTMLElement>('[data-strow]');
    if (!row) return;
    d = { id: Number(g.dataset.grip), pid: e.pointerId, row, to: null };
    try {
      g.setPointerCapture(e.pointerId);
    } catch {
      /* 合成したイベントなど、捕まえられないとき */
    }
    if (S.open || S.menu) {
      S.open = false;
      S.menu = null;
      placePops();
    }
    row.classList.add('ls-dragging');
  });
  list.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.pid) return;
    let best: { sec: Sec; i: number; y: number } | null = null;
    for (const q of gaps()) if (!best || Math.abs(q.y - e.clientY) < Math.abs(best.y - e.clientY)) best = q;
    d.to = best;
    if (!best) return;
    const lr = list.getBoundingClientRect();
    line.style.top = `${(best.y - lr.top).toFixed(0)}px`;
    if (!line.isConnected) list.append(line);
  });
  const end = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.pid) return;
    const x = d;
    d = null;
    line.remove();
    x.row.classList.remove('ls-dragging');
    dragged = true;
    /* ドラッグのあとのクリックが来ないこともあるので、すぐに戻す */
    setTimeout(() => {
      dragged = false;
    }, 0);
    if (x.to) moveTo(x.id, x.to.sec, x.to.i);
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

/* ---------- 描画のくり返し ---------- */
const specMem = new Float32Array(1024);
function frame(now: number): void {
  if (!document.hidden) {
    const sn = S.snap,
      fs = S.snapFs;
    drawWave($<HTMLCanvasElement>('#wave'), sn, S.sel, fs);
    drawSpec($<HTMLCanvasElement>('#spec'), sn, S.sel, fs, specMem);
    if (view.value === 'list')
      for (const cv of $$<HTMLCanvasElement>('[data-mwave]')) drawWave(cv, sn, cv.dataset.mwave as StageId, fs, true);
    drawFret($<HTMLCanvasElement>('#fret'), sn, flash, now, S.key);
    if (S.playing && sn && sn.beat >= 0) transport.setPos(sn.beat % (phraseOf(phrase.value).bars * 4));
  }
  requestAnimationFrame(frame);
}

/* ---------- 起動 ---------- */
const recolor = () => {
  readColors();
  render();
};
readColors();
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => placePops()).observe($('#rigw'));
render();
requestAnimationFrame(frame);

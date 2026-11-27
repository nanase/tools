/**
 * 立体音響のページの入口。場面（場所の種類・空間の値・音源・聞き手）を持ち、図のドラッグと矢印キーで動かす。
 * 変えるたびに場面を worklet へ送り、図を描き直す。場面はブラウザに保存する。
 * 開発者ツールのコンソールで saScene() を呼ぶと今の場面を場面の定義の形で返し、saLoad() で読み込める
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { onPick, pickAct } from '../../lib/press';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { SpatialAudio } from './audio';
import { SceneView } from './fig';
import {
  azimuthDeg,
  buildPlace,
  type Cues,
  clampTo,
  KINDS,
  kindOf,
  type Listener,
  MAX_OBS,
  MAX_SOURCES,
  OBS_PRESETS,
  type Obstacle,
  type Place,
  type Placed,
  type PlaceId,
  SCENES,
  type Scene,
  SOUNDS,
  type Space,
  sceneOf,
  sceneSpace,
  soundOf,
  toHead,
} from './model';
import { OBS_P, type OKey, PARAMS, type PKey, type SKey, SPACE, SRC_VOL, type VKey } from './params';
import type { Mode } from './render';

initToolPage();

interface Src extends Placed {
  key: number;
  db: number;
}
const S = {
  kind: 'forest' as PlaceId,
  space: { ...kindOf('forest').def } as Space,
  mode: 'hrtf' as Mode,
  cues: { itd: true, ild: true, pinna: true } as Cues,
  srcs: [] as Src[],
  lis: { x: 0, y: 0, yaw: 0 } as Listener,
  sel: 0,
  obs: [] as Obstacle[],
  /** 選んだ障害物（なければ −1） */
  selObs: -1,
  /** 選んだ場面（動かしたら空） */
  scene: '',
  playing: false,
  vol: -7,
};
let nextKey = 1;
/** 初めの設定を終えたか（それまでは入力の行の呼び出しを使わない） */
let ready = false;
let place: Place = buildPlace(kindOf(S.kind), S.space);

const audio = new SpatialAudio(),
  cv = $<HTMLCanvasElement>('#sa-cv'),
  view = new SceneView(cv);

const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};

/* ---------- 空間の値 ---------- */
/** 画面の値（%）と空間の値（割合）の対応 */
const toRows = (s: Space): Record<SKey, number> => ({
  w: s.w,
  d: s.d,
  h: s.h,
  refl: Math.round(s.refl * 100),
  t60: s.t60,
  wet: Math.round(s.wet * 100),
});
const space = new ParamGroup<SKey>(
  SPACE,
  (v) => {
    /* 作った直後の呼び出しは既定値なので使わない（場面の値は setSpace で入れる） */
    if (ready) {
      S.space = { w: v.w, d: v.d, h: v.h, refl: v.refl / 100, t60: v.t60, wet: v.wet / 100 };
      rebuild();
      S.scene = '';
      changed();
    }
  },
  null,
  { save: false },
);
/** 種類に合わせて使わない行を無効にする */
function syncRows(): void {
  const k = kindOf(S.kind),
    def = toRows(k.def);
  /* 行の ↺ は選んだ場所の既定へ戻す */
  for (const r of Object.keys(def) as SKey[]) space.update(r, { v: def[r] });
  space.setOff('h', !k.indoor || !!k.free, k.free ? '反射なしでは使いません' : k.indoor ? '' : '屋外では使いません');
  for (const r of ['refl', 't60', 'wet'] as const) space.setOff(r, !!k.free, k.free ? '反射なしでは使いません' : '');
}
function setSpace(s: Space): void {
  S.space = { ...s };
  const r = toRows(s);
  for (const k of Object.keys(r) as SKey[]) space.set(k, r[k], { silent: true });
  syncRows();
}
/** 場所を作り直し、範囲の外に出た音源と聞き手を寄せる */
function rebuild(): void {
  place = buildPlace(kindOf(S.kind), S.space);
  [S.lis.x, S.lis.y] = clampTo(place, S.lis.x, S.lis.y);
  for (const s of S.srcs) [s.x, s.y] = clampTo(place, s.x, s.y, S.lis);
}

/* ---------- 保存と場面 ---------- */
interface Saved {
  kind: PlaceId;
  space: Space;
  srcs: Placed[];
  lis: Listener;
  scene: string;
  obs?: Obstacle[];
}
function save(): void {
  store('s:scene2', {
    kind: S.kind,
    space: S.space,
    srcs: S.srcs.map(({ sound, x, y, db }) => ({ sound, x, y, db })),
    lis: S.lis,
    scene: S.scene,
    obs: S.obs,
  } satisfies Saved);
}
function useScene(sc: Pick<Scene, 'srcs' | 'lis' | 'obs'> & { kind: PlaceId; space: Space }, id: string): void {
  S.kind = KINDS.some((k) => k.id === sc.kind) ? sc.kind : 'forest';
  setSpace(sc.space);
  S.srcs = sc.srcs
    .filter((p) => SOUNDS.some((s) => s.id === p.sound))
    .slice(0, MAX_SOURCES)
    .map((p) => ({ ...p, db: p.db ?? 0, key: nextKey++ }));
  S.lis = { ...sc.lis };
  S.sel = 0;
  S.obs = (sc.obs ?? []).slice(0, MAX_OBS).map((o) => ({ ...o }));
  S.selObs = S.obs.length ? 0 : -1;
  S.scene = id;
  kindChoice.choose(S.kind);
  rebuild();
}

const kindChoice = new Choice<PlaceId>($('#p-place'), (v) => {
  /* 保存した選択を戻すときの呼び出し（場面の値は保存した場面から戻している） */
  if (v === S.kind) return;
  S.kind = v;
  setSpace(kindOf(v).def);
  rebuild();
  S.scene = '';
  changed();
});
const modeChoice = new Choice<Mode>($('#p-mode'), (v) => {
  S.mode = v;
  changed(false);
});
S.mode = modeChoice.value;
for (const k of ['itd', 'ild', 'pinna'] as const)
  new Choice<string>($(`#p-${k}`), (v) => {
    S.cues = { ...S.cues, [k]: v === '1' };
    changed(false);
  });

const fromScene = (sc: Scene) => ({ kind: sc.place, space: sceneSpace(sc), srcs: sc.srcs, lis: sc.lis, obs: sc.obs });
const sv = stored('s:scene2') as Saved | undefined;
if (sv?.srcs && sv.lis && sv.kind && sv.space) useScene(sv, sv.scene ?? '');
else useScene(fromScene(SCENES[0]), SCENES[0].id);

const scenes = new Choice<string>($('#sa-scenes'), (id) => {
  const sc = sceneOf(id);
  if (!sc) return;
  useScene(fromScene(sc), id);
  syncSrcVol();
  renderObs();
  changed();
});

/* ---------- 音 ---------- */
const params = new ParamGroup<PKey>(PARAMS, (v) => {
  S.vol = v.vol;
  audio.vol(v.vol, S.playing);
});
S.vol = params.get('vol');

const gainOf = (s: Src): number => 10 ** ((soundOf(s.sound).db + s.db) / 20);
function sendScene(): void {
  audio.setScene({
    srcs: S.srcs.map((s) => ({ key: s.key, sound: s.sound, x: s.x, y: s.y, gain: gainOf(s) })),
    lis: { ...S.lis },
    place,
    obs: S.obs.map((o) => ({ ...o })),
    mode: S.mode,
    cues: { ...S.cues },
  });
}
/** 鳴らしている間に足した音源の録音を読む */
function loadAll(): Promise<unknown> {
  return Promise.all(S.srcs.map((s) => audio.load(s.sound).catch(() => undefined)));
}
const playBtn = $<HTMLButtonElement>('#sa-play');
function syncPlay(): void {
  playBtn.setAttribute('aria-pressed', String(S.playing));
}
function stop(): void {
  if (!S.playing) return;
  S.playing = false;
  audio.stop();
  syncPlay();
}
playBtn.addEventListener('click', () => {
  if (S.playing) stop();
  else void start();
});
/** 止まっている間に場面・音源の追加を選んだら鳴らし始める（利用者の操作だけ） */
function autoPlay(e: Event): void {
  if (pickAct(e, S.playing) === 'start') void start();
}
onPick($('#sa-scenes'), autoPlay);
async function start(): Promise<void> {
  S.playing = true;
  syncPlay();
  const ok = await audio.ready();
  if (!ok || !S.playing) {
    S.playing = false;
    syncPlay();
    return;
  }
  sendScene();
  await loadAll();
  if (!S.playing) return;
  audio.vol(S.vol, true);
  audio.start();
}
autoPause(audio, { pause: stop, hidden: () => undefined });

/* ---------- 音源の一覧・音量・追加 ---------- */
const list = $('#sa-list');
const srcVol = new ParamGroup<VKey>(
  SRC_VOL,
  (v) => {
    const s = S.srcs[S.sel];
    if (!s || !ready) return;
    s.db = v.svol;
    S.scene = '';
    changed();
  },
  null,
  { save: false },
);
function syncSrcVol(): void {
  const s = S.srcs[S.sel];
  srcVol.set('svol', s ? s.db : 0, { silent: true });
  srcVol.setOff('svol', !s, s ? '' : '音源がありません');
}
function fmtAz(az: number): string {
  const a = Math.round(az);
  if (a === 0) return '正面';
  if (Math.abs(a) === 180) return '真後ろ';
  return `${a > 0 ? '右' : '左'} ${Math.abs(a)}°`;
}
function renderList(): void {
  list.replaceChildren(
    ...S.srcs.map((s, i) => {
      const li = document.createElement('li');
      li.className = i === S.sel ? 'on' : '';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'sa-pick';
      pick.dataset.i = String(i);
      pick.setAttribute('aria-pressed', String(i === S.sel));
      const nm = document.createElement('b');
      nm.textContent = soundOf(s.sound).name;
      const at = document.createElement('span');
      at.className = 'sa-at';
      at.dataset.i = String(i);
      pick.append(nm, at);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sa-del';
      del.dataset.del = String(i);
      del.setAttribute('aria-label', `${soundOf(s.sound).name}を外す`);
      del.title = '外す';
      del.textContent = '×';
      li.append(pick, del);
      return li;
    }),
  );
  const full = S.srcs.length >= MAX_SOURCES;
  for (const b of $$<HTMLButtonElement>('[data-add]')) b.disabled = full;
  txt('#sa-count', `${S.srcs.length} / ${MAX_SOURCES}`);
  updateList();
}
function updateList(): void {
  for (const at of $$<HTMLElement>('.sa-at', list)) {
    const s = S.srcs[Number(at.dataset.i)];
    if (!s) continue;
    const p = toHead([s.x, s.y, 0], S.lis),
      r = Math.hypot(p[0], p[1]),
      t = `${fmtAz(azimuthDeg(p))}・${r < 10 ? r.toFixed(1) : r.toFixed(0)} m`;
    if (at.textContent !== t) at.textContent = t;
  }
}
function select(i: number): void {
  S.sel = i;
  renderList();
  syncSrcVol();
  dirty = true;
}
list.addEventListener('click', (e) => {
  const t = e.target as Element,
    del = t.closest<HTMLElement>('[data-del]'),
    pick = t.closest<HTMLElement>('.sa-pick');
  if (del) {
    S.srcs.splice(Number(del.dataset.del), 1);
    S.sel = Math.max(0, Math.min(S.sel, S.srcs.length - 1));
    S.scene = '';
    syncSrcVol();
    changed();
  } else if (pick) select(Number(pick.dataset.i));
});
/** 空いている所: 聞き手の前から順に、ほかの音源から離れた所（距離は場所の広さに合わせる） */
function freeSpot(): [number, number] {
  const base = Math.max(2, Math.min(place.w, place.d) / 8);
  for (const r of [base, base * 1.5, base * 0.7, base * 2])
    for (const da of [0, 45, -45, 90, -90, 135, -135, 180]) {
      const a = S.lis.yaw + (da * Math.PI) / 180,
        [x, y] = clampTo(place, S.lis.x + r * Math.sin(a), S.lis.y + r * Math.cos(a), S.lis);
      if (S.srcs.every((s) => Math.hypot(s.x - x, s.y - y) > base * 0.6)) return [x, y];
    }
  return clampTo(place, S.lis.x, S.lis.y + base, S.lis);
}
$('#sa-add').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-add]');
  if (!b || S.srcs.length >= MAX_SOURCES) return;
  const [x, y] = freeSpot();
  S.srcs.push({ sound: b.dataset.add ?? SOUNDS[0].id, x, y, db: 0, key: nextKey++ });
  S.sel = S.srcs.length - 1;
  S.scene = '';
  syncSrcVol();
  changed();
  autoPlay(e);
});

/* ---------- 障害物 ---------- */
const obsList = $('#sa-obs-list');
const obsP = new ParamGroup<OKey>(
  OBS_P,
  (v) => {
    const o = S.obs[S.selObs];
    if (!o || !ready) return;
    o.w = v.ow;
    o.d = v.od;
    o.h = v.oh;
    S.scene = '';
    renderObs();
    changed();
  },
  null,
  { save: false },
);
const fmtLen = (v: number) => String(Number(v.toPrecision(3)));
function renderObs(): void {
  obsList.replaceChildren(
    ...S.obs.map((o, i) => {
      const li = document.createElement('li');
      li.className = i === S.selObs ? 'on' : '';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'sa-pick';
      pick.dataset.o = String(i);
      pick.setAttribute('aria-pressed', String(i === S.selObs));
      const nm = document.createElement('b');
      nm.textContent = o.name;
      const at = document.createElement('span');
      at.className = 'sa-at';
      at.textContent = `${fmtLen(o.w)} × ${fmtLen(o.d)} × ${fmtLen(o.h)} m`;
      pick.append(nm, at);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sa-del';
      del.dataset.odel = String(i);
      del.setAttribute('aria-label', `${o.name}を外す`);
      del.title = '外す';
      del.textContent = '×';
      li.append(pick, del);
      return li;
    }),
  );
  for (const b of $$<HTMLButtonElement>('[data-obs]')) b.disabled = S.obs.length >= MAX_OBS;
  txt('#sa-obs-count', `${S.obs.length} / ${MAX_OBS}`);
  const o = S.obs[S.selObs];
  if (o) {
    obsP.set('ow', o.w, { silent: true });
    obsP.set('od', o.d, { silent: true });
    obsP.set('oh', o.h, { silent: true });
  }
  for (const k of ['ow', 'od', 'oh'] as const) obsP.setOff(k, !o, o ? '' : '障害物がありません');
}
function selectObs(i: number): void {
  S.selObs = i;
  renderObs();
  dirty = true;
}
obsList.addEventListener('click', (e) => {
  const t = e.target as Element,
    del = t.closest<HTMLElement>('[data-odel]'),
    pick = t.closest<HTMLElement>('[data-o]');
  if (del) {
    S.obs.splice(Number(del.dataset.odel), 1);
    S.selObs = Math.min(S.selObs, S.obs.length - 1);
    S.scene = '';
    renderObs();
    changed();
  } else if (pick) selectObs(Number(pick.dataset.o));
});
$('#sa-obs-add').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-obs]');
  const pre = OBS_PRESETS[Number(b?.dataset.obs)];
  if (!b || !pre || S.obs.length >= MAX_OBS) return;
  /* 聞き手の少し前に置く */
  const r = Math.max(1.5, Math.min(place.w, place.d) / 6),
    [x, y] = clampTo(place, S.lis.x + r * Math.sin(S.lis.yaw), S.lis.y + r * Math.cos(S.lis.yaw));
  S.obs.push({ ...pre, x, y });
  S.selObs = S.obs.length - 1;
  S.scene = '';
  renderObs();
  changed();
});

/* ---------- コンソールで場面を書き出す・読み込む ---------- */
const r2 = (v: number) => Math.round(v * 100) / 100;
/** 今の場面を、model.ts の SCENES に足せる形の文字列で返す（空間の値は場所の既定と違うものだけ） */
function sceneText(): string {
  const def = kindOf(S.kind).def,
    sp: Partial<Space> = {};
  for (const k of Object.keys(def) as (keyof Space)[]) if (Math.abs(S.space[k] - def[k]) > 1e-9) sp[k] = r2(S.space[k]);
  const sc = {
    id: 'my-scene',
    name: '新しい場面',
    place: S.kind,
    ...(Object.keys(sp).length ? { space: sp } : {}),
    srcs: S.srcs.map((s) => ({ sound: s.sound, x: r2(s.x), y: r2(s.y), ...(s.db ? { db: r2(s.db) } : {}) })),
    lis: { x: r2(S.lis.x), y: r2(S.lis.y), yaw: r2(S.lis.yaw) },
    ...(S.obs.length
      ? { obs: S.obs.map((o) => ({ name: o.name, x: r2(o.x), y: r2(o.y), w: r2(o.w), d: r2(o.d), h: r2(o.h) })) }
      : {}),
  };
  return JSON.stringify(sc, null, 2);
}
/** saScene() の文字列（か同じ形のもの）を読み込む */
function loadText(t: string | object): string {
  const sc = (typeof t === 'string' ? JSON.parse(t) : t) as Scene;
  if (!sc || !Array.isArray(sc.srcs) || !sc.lis || !sc.place)
    return '読み込めませんでした（place・srcs・lis が要ります）';
  useScene(fromScene(sc), '');
  syncSrcVol();
  renderObs();
  changed();
  return '読み込みました';
}
Object.assign(window, {
  saScene: () => {
    const t = sceneText();
    console.log(t);
    return t;
  },
  saLoad: loadText,
});

/* ---------- 図の操作 ---------- */
type Drag =
  | { kind: 'src'; i: number }
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'turn'; off: number }
  | { kind: 'obs'; i: number; dx: number; dy: number }
  | null;
let drag: Drag = null;
const ptOf = (e: PointerEvent): [number, number] => {
  const b = cv.getBoundingClientRect();
  return [e.clientX - b.left, e.clientY - b.top];
};
cv.addEventListener('pointerdown', (e) => {
  const [px, py] = ptOf(e),
    h = view.hit(px, py, S.srcs, S.lis, S.obs);
  if (!h) return;
  cv.setPointerCapture(e.pointerId);
  if (h.kind === 'src') {
    drag = { kind: 'src', i: h.i };
    select(h.i);
  } else if (h.kind === 'move') {
    const [wx, wy] = view.toWorld(px, py);
    drag = { kind: 'move', dx: S.lis.x - wx, dy: S.lis.y - wy };
  } else if (h.kind === 'obs') {
    const [wx, wy] = view.toWorld(px, py),
      o = S.obs[h.i];
    drag = { kind: 'obs', i: h.i, dx: o.x - wx, dy: o.y - wy };
    selectObs(h.i);
  } else drag = { kind: 'turn', off: S.lis.yaw - view.angleAt(px, py, S.lis) };
  dirty = true;
  e.preventDefault();
});
cv.addEventListener('pointermove', (e) => {
  const [px, py] = ptOf(e);
  if (!drag) {
    const h = view.hit(px, py, S.srcs, S.lis, S.obs);
    cv.style.cursor = !h ? '' : h.kind === 'turn' ? 'alias' : 'grab';
    return;
  }
  const [wx, wy] = view.toWorld(px, py);
  if (drag.kind === 'src') {
    const s = S.srcs[drag.i];
    if (s) [s.x, s.y] = clampTo(place, wx, wy, S.lis);
  } else if (drag.kind === 'move') {
    [S.lis.x, S.lis.y] = clampTo(place, wx + drag.dx, wy + drag.dy);
    for (const s of S.srcs) [s.x, s.y] = clampTo(place, s.x, s.y, S.lis);
  } else if (drag.kind === 'obs') {
    const o = S.obs[drag.i];
    if (o) [o.x, o.y] = clampTo(place, wx + drag.dx, wy + drag.dy);
  } else S.lis.yaw = view.angleAt(px, py, S.lis) + drag.off;
  S.scene = '';
  changed(false);
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  save();
  renderObs();
  scenes.set('');
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

function turn(deg: number): void {
  S.lis.yaw += (deg * Math.PI) / 180;
  S.scene = '';
  changed();
}
/** 歩く幅は場所の長い方の辺に合わせる（狭い部屋で 0.5 m、広い田んぼで 5 m） */
const stride = (): number => {
  const m = Math.max(place.w, place.d);
  return m < 15 ? 0.5 : m < 80 ? 2 : 5;
};
function walk(dir: number): void {
  const m = dir * stride();
  [S.lis.x, S.lis.y] = clampTo(place, S.lis.x + m * Math.sin(S.lis.yaw), S.lis.y + m * Math.cos(S.lis.yaw));
  for (const s of S.srcs) [s.x, s.y] = clampTo(place, s.x, s.y, S.lis);
  S.scene = '';
  changed();
}
for (const b of $$<HTMLButtonElement>('[data-turn]')) b.addEventListener('click', () => turn(Number(b.dataset.turn)));
for (const b of $$<HTMLButtonElement>('[data-walk]')) b.addEventListener('click', () => walk(Number(b.dataset.walk)));
cv.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft') turn(-15);
  else if (k === 'ArrowRight') turn(15);
  else if (k === 'ArrowUp') walk(0.5);
  else if (k === 'ArrowDown') walk(-0.5);
  else return;
  e.preventDefault();
});

/* ---------- 描画 ---------- */
let dirty = true,
  pendingScene = true;
/** 変えたとき: 保存（save）・一覧の作り直し・worklet へ送る・描き直し */
function changed(full = true): void {
  if (full) {
    save();
    renderList();
    scenes.set(S.scene);
  }
  if (S.playing) {
    sendScene();
    /* 場面を替えたときや音源を足したときに、まだ読んでいない録音を読む */
    void loadAll();
  } else pendingScene = true;
  dirty = true;
}

function status(): void {
  const a = Math.round(((((S.lis.yaw * 180) / Math.PI) % 360) + 540) % 360) - 180;
  txt(
    '#sa-st',
    `${place.name}・頭の向き ${a === 0 ? '正面' : `${a > 0 ? '右' : '左'} ${Math.abs(a)}°`}・格子 ${view.gridStep()} m`,
  );
  txt('#sa-walk-f', `前へ ${stride()} m`);
  txt('#sa-walk-b', `後ろへ ${stride()} m`);
}

const recolor = () => {
  view.recolor();
  dirty = true;
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  dirty = true;
}).observe(cv);

function frame(): void {
  if (pendingScene && S.playing) {
    sendScene();
    pendingScene = false;
  }
  if (dirty) {
    dirty = false;
    view.draw(
      place,
      S.srcs,
      S.lis,
      S.sel,
      S.srcs.map(() => S.playing),
      S.obs,
      S.selObs,
    );
    updateList();
    status();
  }
  requestAnimationFrame(frame);
}
renderList();
syncSrcVol();
renderObs();
scenes.set(S.scene);
syncPlay();
ready = true;
requestAnimationFrame(frame);

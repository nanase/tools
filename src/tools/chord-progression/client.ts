/**
 * コード進行のページの入口: ブロックの並び（曲）を持ち、3 つの表示・編集の窓・下のパレット・ドラッグ・演奏・保存をつなぐ。
 * 曲は開き直しても戻るようにブラウザに保存し、名前を付けた保存は別のキーに持つ（設定をもとに戻しても消さない）
 */
import { $, $$, esc } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { outVol, type PlayKey } from '../../lib/play';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { type Accomp, CpAudio, Player } from './audio';
import { ICON, keySig } from './icons';
import { CLICK, VOL0 } from './params';
import { SAMPLE0, SAMPLES } from './samples';
import {
  type ChordEntry,
  compute,
  copyItem,
  endless,
  fromFile,
  type Item,
  type ItemSpec,
  isChord,
  type Kind,
  LENGTHS,
  type MarkEntry,
  METERS,
  parseSong,
  REPEATS,
  type Timeline,
  toFile,
  withId,
} from './song';
import {
  type Chord,
  chordName,
  DIATONIC,
  diatonicQ,
  func,
  KEY_NAMES,
  type Key,
  keyName,
  lvName,
  md,
  namedNext,
  OTHER,
  PAT_ORDER,
  PATS,
  type PatId,
  patGlyph,
  QUAL_ORDER,
  QUALS,
  type Qual,
  roman,
  romanBase,
  rootName,
  sameKey,
  sigOf,
  trans,
  VOICE_ORDER,
  VOICES,
} from './theory';
import { type Ctx, type Drag, drawBands, keyShort, redrawWheel, type Target, VIEWS, type ViewId } from './view';

initToolPage();

const sampleItems = (id: string): Item[] => parseSong((SAMPLES.find((s) => s.id === id) ?? SAMPLES[0]).src);
const sampleName = (id: string): string => (SAMPLES.find((s) => s.id === id) ?? SAMPLES[0]).name;

/* ---------- 状態 ---------- */
const S = {
  items: [] as Item[],
  tl: null as unknown as Timeline,
  name: '',
  sel: null as number | null,
  cue: null as number | null,
  view: 'score' as ViewId,
  nOf: 3 as 3 | 4,
  tab: 'ch' as 'ch' | 'mk',
  acc: { bass: true, click: false } as Accomp,
  /** 開くか保存してから変えたか */
  dirty: false,
};
{
  const f = fromFile(stored('song'));
  if (f?.items.length) {
    S.items = f.items;
    S.name = f.name;
    S.dirty = stored('dirty') === true;
  } else {
    S.items = sampleItems(SAMPLE0);
    S.name = sampleName(SAMPLE0);
  }
  const v = stored('view');
  if (v === 'score' || v === 'lanes' || v === 'wheel') S.view = v;
  if (stored('n4') === true) S.nOf = 4;
  const a = stored('acc') as Partial<Accomp> | undefined;
  if (a && typeof a === 'object') S.acc = { bass: a.bass !== false, click: a.click === true };
}
S.tl = compute(S.items);

const ctx = (): Ctx => ({ tl: S.tl, items: S.items, sel: S.sel, cue: S.cue, nOf: S.nOf });
const entryOf = (id: number | null) => (id === null ? undefined : S.tl.all.find((e) => e.it.id === id));
const indexOf = (id: number) => S.items.findIndex((x) => x.id === id);

/* ---------- 元に戻す ---------- */
const undo: Item[][] = [],
  redo: Item[][] = [];
const snap = () => S.items.map((x) => ({ ...x }));
/** 変える前に呼ぶ */
function remember(): void {
  undo.push(snap());
  if (undo.length > 100) undo.shift();
  redo.length = 0;
}
function travel(from: Item[][], to: Item[][]): void {
  const prev = from.pop();
  if (!prev) return;
  to.push(snap());
  S.items = prev;
  if (S.sel !== null && indexOf(S.sel) < 0) S.sel = null;
  changed();
}

/* ---------- 音と演奏 ---------- */
const audio = new CpAudio(),
  player = new Player(audio, () => ({ items: S.items, tl: S.tl, acc: S.acc }));
let auditionBus: GainNode | null = null;
/** 止まっている間の試聴（コード 1 つ。長いコードは 3 秒で消す） */
function audition(e: ChordEntry | undefined, pat?: PatId): void {
  if (!e || player.playing) return;
  void audio.ready().then((ok) => {
    if (!ok) return;
    if (auditionBus) audio.drop(auditionBus);
    const x = pat ? { ...e, pat } : e,
      g = audio.play(x, { bass: S.acc.bass, click: false });
    auditionBus = g;
    if (g)
      setTimeout(
        () => {
          if (auditionBus === g) audio.drop(g);
        },
        Math.min(x.dur, 3) * 1000 + 600,
      );
  });
}
const playBtn = $<HTMLButtonElement>('#cp-pp');
function syncPlay(): void {
  const on = player.playing;
  playBtn.classList.toggle('on', on);
  playBtn.setAttribute('aria-label', on ? '一時停止' : '演奏');
  playBtn.title = on ? '一時停止' : '選んだ位置から演奏';
  const st = $('#cp-st');
  st.hidden = !on && S.cue === null;
  $('#cp-led').className = on ? 'led on' : 'led half';
  $('#cp-stT').textContent = on ? '演奏中' : '一時停止中';
  $('#pal-pp').classList.toggle('on', on);
  $('#pal-pp').setAttribute('aria-label', on ? '一時停止' : '演奏');
  posText(null);
}
/** 位置の表示: 小節・コード・くり返しの回目 */
function posText(occ: { e: ChordEntry; rep: { pass: number } | null } | null): void {
  let e: ChordEntry | undefined = occ?.e;
  if (!e) {
    const c = entryOf(S.cue);
    e = c && isChord(c) ? c : S.tl.chords[0];
  }
  const t = e
    ? `${e.bars[0]?.no ?? '–'} 小節 · ${roman(e.it, e.key)}${occ?.rep ? ` · ${occ.rep.pass} 回目` : ''}`
    : '–';
  const el = $('#cp-pos');
  if (el.textContent !== t) el.textContent = t;
  $('#cp-len').textContent = endless(S.items) ? 'くり返しは無制限' : `${S.tl.chords.at(-1)?.bars.at(-1)?.no ?? 0} 小節`;
}
async function play(): Promise<void> {
  if (player.playing) return pause();
  if (auditionBus) audio.drop(auditionBus);
  const ix = S.cue === null ? 0 : Math.max(0, indexOf(S.cue));
  if (!(await player.start(ix))) return;
  syncPlay();
  requestAnimationFrame(frame);
}
function pause(): void {
  const cur = player.current();
  player.halt();
  if (cur) S.cue = cur.id;
  syncPlay();
  render();
}
player.onEnd = () => {
  S.cue = null;
  syncPlay();
  render();
};
function frame(): void {
  if (!player.playing) return;
  const occ = player.current(),
    now = audio.now() ?? 0,
    f = occ ? (now - occ.at) / occ.e.dur : 0;
  VIEWS[S.view].playhead(viewEl, ctx(), occ, f);
  posText(occ);
  requestAnimationFrame(frame);
}
/** 弾き始めの位置を変える（演奏中はすぐそこへ移る） */
function cueTo(id: number | null): void {
  S.cue = id;
  if (player.playing) player.jump(id === null ? 0 : Math.max(0, indexOf(id)));
}
playBtn.addEventListener('click', () => void play());
$('#cp-home').addEventListener('click', () => {
  cueTo(null);
  if (!player.playing) {
    syncPlay();
    render();
  }
});
autoPause(audio, { pause: () => player.playing && pause(), hidden: () => player.tick() });
new ParamGroup<PlayKey>([outVol(VOL0)], (v) => audio.vol(v.vol));
const clickGroup = new ParamGroup<'clk'>([CLICK], (v) => {
  audio.click = 10 ** (v.clk / 20);
});
const syncClick = () => clickGroup.setOff('clk', !S.acc.click, 'メトロノームを止めている間は使いません');
for (const b of $$<HTMLButtonElement>('[data-acc]')) {
  const k = b.dataset.acc as keyof Accomp,
    set = () => {
      b.setAttribute('aria-pressed', String(S.acc[k]));
      b.querySelector('.led')?.classList.toggle('on', S.acc[k]);
    };
  set();
  b.addEventListener('click', () => {
    S.acc[k] = !S.acc[k];
    store('acc', S.acc);
    set();
    syncClick();
    player.resync();
  });
}

/* ---------- 強調の切り替え ---------- */
const pageRoot = $('#cp-page');
for (const b of $$<HTMLButtonElement>('[data-hl]')) {
  const k = b.dataset.hl as string,
    set = (on: boolean) => {
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.led')?.classList.toggle('on', on);
      pageRoot.classList.toggle(`cp-no-${k}`, !on);
      $('#cp-pal').classList.toggle(`cp-no-${k}`, !on);
    };
  set(stored(`hl-${k}`) !== false);
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    set(on);
    store(`hl-${k}`, on);
  });
}

/* ---------- 描画 ---------- */
const viewEl = $('#cp-view'),
  stage = $('#cp-stage');
function render(): void {
  const v = VIEWS[S.view],
    c = ctx();
  viewEl.innerHTML = v.html(c);
  v.mount(viewEl, c);
  if (player.playing) frame();
  for (const b of $$<HTMLButtonElement>('#cp-vw button'))
    b.setAttribute('aria-pressed', String(b.dataset.v === S.view));
  showEd();
  renderPal();
  posText(null);
}
function changed(): void {
  S.tl = compute(S.items);
  if (S.cue !== null && indexOf(S.cue) < 0) S.cue = null;
  S.dirty = true;
  saveCurrent();
  player.resync();
  render();
}
function saveCurrent(): void {
  store('song', toFile(S.name, S.items));
  store('dirty', S.dirty);
}
$('#cp-vw').addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLElement>('[data-v]');
  if (!b) return;
  S.view = b.dataset.v as ViewId;
  store('view', S.view);
  render();
});

/* ---------- 編集の窓 ---------- */
/** 選択肢の行。3 つ目の要素は吹き出しと読み上げの名前（中身が図柄だけのとき） */
const chipRow = (lb: string, a: string, opts: readonly (readonly [string | number, string, string?])[], cur: unknown) =>
  `<div class="cp-er"><span class="cp-el">${lb}</span><div class="chips">${opts
    .map(
      ([v, t, tt]) =>
        `<button type="button" class="chip" data-a="${a}" data-v="${v}" aria-pressed="${String(v) === String(cur)}"${tt ? ` title="${tt}" aria-label="${tt}"` : ''}>${t}</button>`,
    )
    .join('')}</div></div>`;
const iconBtn = (a: string, icon: string, name: string) =>
  `<button type="button" class="cp-pi" data-a="${a}" title="${name}" aria-label="${name}">${icon}</button>`;
const lenLabel = (b: number) => (b === 0 ? '拍子どおり' : `${b} 拍`);
function edHTML(e: (typeof S.tl.all)[number]): string {
  const it = e.it;
  const head = (t: string, aud = false) =>
    `<div class="cp-eh"><b>${t}</b>${aud ? iconBtn('aud', ICON.aud, '試聴') : ''}${iconBtn('dup', ICON.dup, '複製')}${iconBtn('del', ICON.del, '削除')}<button type="button" class="cp-ex" data-a="close" aria-label="閉じる" title="閉じる">×</button></div>`;
  if (isChord(e)) {
    const c = e.it,
      k = e.key,
      pv = e.prev && sameKey(e.prev.key, k) ? e.prev : null,
      n = QUALS[c.q].iv.length > 3 ? 4 : 3;
    let rt = '';
    for (let d = 0; d < 12; d++) {
      const dq = diatonicQ(d, k, n),
        lv = pv ? trans(pv.it, pv.key, { d, q: dq ?? c.q, inv: 0 }, k).lv : -1;
      rt += `<button type="button" class="${dq ? 'dia' : ''}" data-a="d" data-v="${d}" aria-pressed="${d === c.d}"><b>${romanBase(d, k)}</b><span>${rootName(d, k)}</span><i class="cp-lvb${lv > 0 ? ` l${lv}` : ''}"></i></button>`;
    }
    const INV = ['基本形', '第 1 転回形', '第 2 転回形', '第 3 転回形'],
      invs = QUALS[c.q].iv.map((_, i) => [i, chordName({ ...c, inv: i }, k), INV[i]] as const);
    return (
      head(`${roman(c, k)} · ${chordName(c, k)}`, true) +
      `<div class="cp-er"><span class="cp-el">根音</span><div class="cp-rt">${rt}</div></div>` +
      chipRow(
        '種類',
        'q',
        QUAL_ORDER.map((q) => [q, chordName({ d: c.d, q, inv: 0 }, k), QUALS[q].name]),
        c.q,
      ) +
      chipRow('転回', 'inv', invs, c.inv) +
      chipRow(
        '長さ',
        'b',
        LENGTHS.map((b) => [b, b === 0 ? `拍子どおり（${e.n} 拍）` : lenLabel(b)]),
        c.b,
      ) +
      `<div class="cp-er"><span class="cp-el">奏法</span><div class="chips"><button type="button" class="chip" data-a="p" data-v="" aria-pressed="${!c.p}" title="奏法ブロックどおり（${PATS[e.defPat].name}）">ブロックどおり</button>${PAT_ORDER.map((p) => `<button type="button" class="chip cp-gc" data-a="p" data-v="${p}" aria-pressed="${c.p === p}" title="${PATS[p].name}" aria-label="${PATS[p].name}">${patGlyph(p)}</button>`).join('')}</div></div>`
    );
  }
  const m = e as MarkEntry;
  switch (it.k) {
    case 'key': {
      const near: [string, string][] = [
        ['dom', '属調'],
        ['sub', '下属調'],
        ['rel', '平行調'],
        ['par', '同主調'],
        ['h1', '半音上'],
        ['w1', '全音上'],
      ];
      return (
        head(m.first ? '調' : '転調') +
        chipRow(
          '主音',
          't',
          KEY_NAMES.map((n, i) => [i, n]),
          it.t,
        ) +
        chipRow(
          '種類',
          'm',
          [
            ['maj', 'メジャー'],
            ['min', 'マイナー'],
          ],
          it.m,
        ) +
        (m.first
          ? ''
          : `<div class="cp-er"><span class="cp-el">前の調から</span><div class="chips">${near.map(([v, t]) => `<button type="button" class="chip" data-a="near" data-v="${v}">${t}</button>`).join('')}</div></div><p class="cp-en">前の調 ${keyName(m.prevKey)} · 後ろのコードは度数のまま移る</p>`)
      );
    }
    case 'met':
      return (
        head('拍子') +
        chipRow(
          '拍子',
          'met',
          METERS.map(([n, d]) => [`${n}/${d}`, `${n}/${d}`]),
          `${it.n}/${it.dn}`,
        )
      );
    case 'tmp':
      return `${head('テンポ')}<div class="cp-er"><span class="cp-el">♩</span><input type="range" min="40" max="200" step="1" value="${it.v}" data-a="tmpR" aria-label="テンポ"><b class="cp-tv">♩=${it.v}</b></div>${chipRow(
        '',
        'tmp',
        [60, 80, 96, 120, 144].map((v) => [v, String(v)]),
        it.v,
      )}`;
    case 'pat':
      return `${head('奏法')}${chipRow(
        '奏法',
        'pv',
        PAT_ORDER.map((p) => [p, patGlyph(p), PATS[p].name]),
        it.v,
      )}<p class="cp-en">次の奏法ブロックまでのコードに効く · 押すと次のコードで試聴</p>`;
    case 'vce':
      return (
        head('音色') +
        chipRow(
          '音色',
          'vv',
          VOICE_ORDER.map((v) => [v, `${ICON[v]}${VOICES[v]}`]),
          it.v,
        )
      );
    case 'rs':
      return `${head('くり返しの始め')}<p class="cp-en">ここから後ろのくり返しの終わりまでをくり返す</p>`;
    case 're':
      return `${head('くり返しの終わり')}${chipRow(
        '回数',
        'rn',
        REPEATS.map((n) => [n, n === 0 ? '無制限' : `${n} 回`]),
        it.n,
      )}<p class="cp-en">始めがなければ曲の頭か前のくり返しの終わりまで戻る</p>`;
    default:
      return '';
  }
}
function showEd(): void {
  let ed = document.getElementById('cp-ed');
  const e = entryOf(S.sel),
    a = S.sel === null ? null : viewEl.querySelector<HTMLElement>(`[data-id="${S.sel}"]`);
  if (!e || !a) {
    ed?.remove();
    return;
  }
  if (!ed) {
    ed = document.createElement('div');
    ed.id = 'cp-ed';
    ed.className = 'cp-ed';
    ed.setAttribute('role', 'dialog');
    ed.setAttribute('aria-label', 'ブロックの設定');
    stage.appendChild(ed);
  }
  ed.innerHTML = edHTML(e);
  const sr = stage.getBoundingClientRect(),
    ar = a.getBoundingClientRect(),
    w = ed.offsetWidth;
  const left = Math.max(0, Math.min(ar.left - sr.left + ar.width / 2 - 40, sr.width - w));
  ed.style.left = `${left}px`;
  ed.style.top = `${ar.bottom - sr.top + 10}px`;
  ed.style.setProperty('--ax', `${Math.max(14, Math.min(w - 14, ar.left - sr.left + ar.width / 2 - left))}px`);
}
/** 選んだブロックを変える */
function edit(fn: (it: Item) => void, aud?: PatId | true): void {
  const it = S.items.find((x) => x.id === S.sel);
  if (!it) return;
  remember();
  fn(it);
  changed();
  if (aud) {
    const e = entryOf(it.id);
    if (e && isChord(e)) audition(e, aud === true ? undefined : aud);
  }
}
/** 奏法ブロックの試聴に使う、そのブロックの次のコード */
const nextChord = (i: number): ChordEntry | undefined => S.tl.chords.find((c) => c.i > i);
stage.addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLElement>('#cp-ed [data-a]');
  if (!b) return;
  const a = b.dataset.a,
    v = b.dataset.v ?? '';
  if (a === 'close') {
    S.sel = null;
    render();
  } else if (a === 'aud') audition(entryOf(S.sel) as ChordEntry);
  else if (a === 'del') del(S.sel);
  else if (a === 'dup') {
    const i = indexOf(S.sel as number);
    remember();
    const c = copyItem(S.items[i]);
    S.items.splice(i + 1, 0, c);
    S.sel = c.id;
    changed();
  } else if (a === 'd')
    edit((it) => {
      if (it.k !== 'ch') return;
      it.d = Number(v);
      const e = entryOf(it.id) as ChordEntry,
        dq = diatonicQ(it.d, e.key, QUALS[it.q].iv.length > 3 ? 4 : 3);
      if (dq) it.q = dq;
      if (it.inv >= QUALS[it.q].iv.length) it.inv = 0;
    }, true);
  else if (a === 'q')
    edit((it) => {
      if (it.k !== 'ch') return;
      it.q = v as Qual;
      if (it.inv >= QUALS[it.q].iv.length) it.inv = 0;
    }, true);
  else if (a === 'inv') edit((it) => it.k === 'ch' && Object.assign(it, { inv: Number(v) }), true);
  else if (a === 'b') edit((it) => it.k === 'ch' && Object.assign(it, { b: Number(v) }));
  else if (a === 'p') edit((it) => it.k === 'ch' && Object.assign(it, { p: v || null }), true);
  else if (a === 't') edit((it) => it.k === 'key' && Object.assign(it, { t: Number(v) }));
  else if (a === 'm') edit((it) => it.k === 'key' && Object.assign(it, { m: v }));
  else if (a === 'near')
    edit((it) => {
      if (it.k !== 'key') return;
      const pk = (entryOf(it.id) as MarkEntry).prevKey,
        to: Record<string, [number, Key['m']]> = {
          dom: [7, pk.m],
          sub: [5, pk.m],
          h1: [1, pk.m],
          w1: [2, pk.m],
          rel: pk.m === 'maj' ? [9, 'min'] : [3, 'maj'],
          par: [0, pk.m === 'maj' ? 'min' : 'maj'],
        },
        [dt, m] = to[v];
      it.t = md(pk.t + dt);
      it.m = m;
    });
  else if (a === 'met')
    edit((it) => {
      if (it.k !== 'met') return;
      const [n, dn] = v.split('/').map(Number);
      it.n = n;
      it.dn = dn;
    });
  else if (a === 'tmp') edit((it) => it.k === 'tmp' && Object.assign(it, { v: Number(v) }));
  else if (a === 'pv') {
    edit((it) => it.k === 'pat' && Object.assign(it, { v }));
    const it = S.items.find((x) => x.id === S.sel);
    if (it) audition(nextChord(indexOf(it.id)), v as PatId);
  } else if (a === 'vv') {
    edit((it) => it.k === 'vce' && Object.assign(it, { v }));
    const it = S.items.find((x) => x.id === S.sel);
    if (it) audition(nextChord(indexOf(it.id)));
  } else if (a === 'rn') edit((it) => it.k === 're' && Object.assign(it, { n: Number(v) }));
});
stage.addEventListener('input', (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.dataset.a !== 'tmpR') return;
  const it = S.items.find((x) => x.id === S.sel);
  if (it?.k !== 'tmp') return;
  const v = Number(t.value);
  (t.nextElementSibling as HTMLElement).textContent = `♩=${v}`;
  clearTimeout(tmpT);
  tmpT = setTimeout(() => {
    remember();
    it.v = v;
    changed();
  }, 150);
});
let tmpT: ReturnType<typeof setTimeout> | undefined;
function del(id: number | null): void {
  if (id === null) return;
  const i = indexOf(id);
  if (i < 0) return;
  remember();
  S.items.splice(i, 1);
  if (S.sel === id) S.sel = null;
  changed();
}

/* ---------- パレット ---------- */
const pal = $('#cp-pal'),
  palBody = $('#pal-b'),
  palRef = $('#pal-ref');
/** 置く位置と、その位置の調・前のコード */
function insertCtx(): { index: number; key: Key; prev: ChordEntry | null; upto: ChordEntry[] } {
  const e = entryOf(S.sel);
  if (e) {
    const j = S.tl.all.indexOf(e),
      prev = isChord(e) ? e : ([...S.tl.all.slice(0, j + 1)].reverse().find(isChord) ?? null);
    return { index: indexOf(e.it.id) + 1, key: e.key, prev, upto: S.tl.chords.slice(0, prev ? prev.ci + 1 : 0) };
  }
  return { index: S.items.length, key: S.tl.end.key, prev: S.tl.chords.at(-1) ?? null, upto: S.tl.chords };
}
/** パレットの目印のブロック: 名前（吹き出し）・見た目・置くときの中身。置く位置の調から決める */
const MARKS: { k: Kind; name: (k: Key) => string; face: (k: Key) => string; spec: (k: Key) => ItemSpec }[] = [
  {
    k: 'key',
    name: (k) => `転調 ${keyName({ t: md(k.t + 2), m: k.m })}`,
    face: (k) => {
      const nk: Key = { t: md(k.t + 2), m: k.m };
      return `<b>${keyShort(nk)}</b><span>${keySig(nk.t, nk.m) || '&nbsp;'}</span>`;
    },
    spec: (k) => ({ k: 'key', t: md(k.t + 2), m: k.m }),
  },
  {
    k: 'met',
    name: () => '拍子 3/4',
    face: () => '<span class="cp-ts"><b>3</b><b>4</b></span>',
    spec: () => ({ k: 'met', n: 3, dn: 4 }),
  },
  {
    k: 'tmp',
    name: () => 'テンポ ♩=120',
    face: () => `${ICON.click}<span>120</span>`,
    spec: () => ({ k: 'tmp', v: 120 }),
  },
  { k: 'pat', name: () => `奏法 ${PATS.up.name}`, face: () => patGlyph('up'), spec: () => ({ k: 'pat', v: 'up' }) },
  { k: 'vce', name: () => `音色 ${VOICES.org}`, face: () => ICON.org, spec: () => ({ k: 'vce', v: 'org' }) },
  { k: 'rs', name: () => 'くり返しの始め', face: () => '<b class="cp-rp">𝄆</b>', spec: () => ({ k: 'rs' }) },
  {
    k: 're',
    name: () => 'くり返しの終わり',
    face: () => '<b class="cp-rp">𝄇</b><span>×2</span>',
    spec: () => ({ k: 're', n: 2 }),
  },
];
function renderPal(): void {
  const c = insertCtx(),
    k = c.key,
    pv = c.prev && sameKey(c.prev.key, k) ? c.prev : null,
    sug = pv ? namedNext(c.upto.map((x) => ({ c: x.it, key: x.key, i: x.i }))) : [];
  palRef.innerHTML = pv ? `<b>${roman(pv.it, pv.key)}</b> の次 · ${keyName(k)}` : `${keyName(k)}`;
  for (const b of $$<HTMLButtonElement>('#pal-tab button'))
    b.setAttribute('aria-pressed', String(b.dataset.t === S.tab));
  const nb = $('#pal-n');
  nb.style.visibility = S.tab === 'ch' ? '' : 'hidden';
  for (const b of $$<HTMLButtonElement>('#pal-n button'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.n) === S.nOf));
  $<HTMLButtonElement>('#pal-undo').disabled = !undo.length;
  $<HTMLButtonElement>('#pal-redo').disabled = !redo.length;
  const chip = (d: number, q: Qual) => {
    const ch: Chord = { d, q, inv: 0 },
      lv = pv ? trans(pv.it, pv.key, ch, k).lv : -1,
      g = sigOf(ch, k),
      s = sug.find((x) => x.s[0] === g[0] && x.s[1] === g[1]);
    return `<button type="button" class="cp-pc cp-f${func(ch, k)}" data-new="ch" data-d="${d}" data-q="${q}" title="${esc(`${roman(ch, k)} · ${chordName(ch, k)}${lv >= 0 ? ` · ${lvName(lv)}` : ''}`)}"><b>${roman(ch, k)}</b><span>${chordName(ch, k)}</span><i class="cp-lvb${lv > 0 ? ` l${lv}` : ''}"></i>${s ? `<em class="cp-sug">${s.n}</em>` : ''}</button>`;
  };
  palBody.innerHTML =
    S.tab === 'ch'
      ? `<div class="cp-pr"><span class="cp-pl">ダイアトニック</span>${DIATONIC[k.m][S.nOf].map(([d, q]) => chip(d, q)).join('')}</div><div class="cp-pr"><span class="cp-pl">その他</span>${OTHER[k.m].map(([d, q]) => chip(d, q)).join('')}</div>`
      : `<div class="cp-pr">${MARKS.map((m) => `<button type="button" class="cp-pc cp-pm" data-new="${m.k}" title="${m.name(k)}" aria-label="${m.name(k)}">${m.face(k)}</button>`).join('')}</div>`;
}
function newItem(el: HTMLElement): Item {
  const k = el.dataset.new as Kind,
    c = insertCtx();
  if (k === 'ch') return withId({ k: 'ch', d: Number(el.dataset.d), q: el.dataset.q as Qual, inv: 0, b: 0, p: null });
  const m = MARKS.find((x) => x.k === k);
  return withId((m as (typeof MARKS)[number]).spec(c.key));
}
function insert(it: Item, index: number): void {
  remember();
  S.items.splice(index, 0, it);
  S.sel = it.id;
  changed();
  const e = entryOf(it.id);
  if (e && isChord(e)) audition(e);
}
pal.addEventListener('click', (ev) => {
  const t = (ev.target as Element).closest<HTMLElement>('[data-t],[data-n],#pal-pp,#pal-min,#pal-undo,#pal-redo');
  if (!t) return;
  if (t.dataset.t) S.tab = t.dataset.t as 'ch' | 'mk';
  else if (t.dataset.n) {
    S.nOf = Number(t.dataset.n) as 3 | 4;
    store('n4', S.nOf === 4);
    if (S.view === 'wheel') redrawWheel(viewEl, ctx(), player.current());
  } else if (t.id === 'pal-pp') return void play();
  else if (t.id === 'pal-undo') return travel(undo, redo);
  else if (t.id === 'pal-redo') return travel(redo, undo);
  else if (t.id === 'pal-min') {
    const min = !pal.classList.contains('min');
    pal.classList.toggle('min', min);
    t.setAttribute('aria-expanded', String(!min));
    store('palMin', min);
    padPal();
    return;
  }
  renderPal();
});
if (stored('palMin') === true) {
  pal.classList.add('min');
  $('#pal-min').setAttribute('aria-expanded', 'false');
}
/** パレットの高さだけページの下を空ける */
function padPal(): void {
  document.documentElement.style.setProperty('--cp-palh', `${pal.offsetHeight + 24}px`);
}
new ResizeObserver(padPal).observe(pal);

/* ---------- 選ぶ・ドラッグ ---------- */
interface DragState {
  el: HTMLElement;
  src: 'view' | 'pal';
  x0: number;
  y0: number;
  t0: number;
  touch: boolean;
  on: boolean;
  d: Drag;
  ghost?: HTMLElement;
  tg?: Target | null;
  overPal?: boolean;
}
let D: DragState | null = null;
document.addEventListener('pointerdown', (ev) => {
  if (ev.button > 0) return;
  const t = ev.target as Element;
  if (t.closest('#cp-ed')) return;
  const el = t.closest<HTMLElement>('#cp-view [data-id], #cp-view [data-sel], #pal-b [data-new]');
  if (!el) return;
  const src = el.closest('#pal-b') ? 'pal' : 'view',
    id = Number(el.dataset.id ?? el.dataset.sel ?? 0);
  D = {
    el,
    src,
    x0: ev.clientX,
    y0: ev.clientY,
    t0: performance.now(),
    touch: ev.pointerType === 'touch',
    on: false,
    d: {
      id: src === 'view' ? id : 0,
      kind: src === 'view' ? (S.items.find((x) => x.id === id)?.k ?? 'ch') : (el.dataset.new as Kind),
    },
  };
});
const caret = () => viewEl.querySelector<HTMLElement>('#cp-caret');
document.addEventListener('pointermove', (ev) => {
  if (!D) return;
  if (!D.on) {
    if (Math.hypot(ev.clientX - D.x0, ev.clientY - D.y0) < 6) return;
    /* タッチは少し押さえてから動かしたときだけドラッグにする（すぐ動かすのはスクロール） */
    if (D.touch && performance.now() - D.t0 < 260) {
      D = null;
      return;
    }
    D.on = true;
    const g = D.el.cloneNode(true) as HTMLElement;
    g.classList.add('cp-ghost');
    g.classList.remove('sel');
    g.style.width = `${D.el.offsetWidth}px`;
    g.style.height = `${D.el.offsetHeight}px`;
    document.body.appendChild(g);
    D.ghost = g;
    if (D.src === 'view') {
      pal.classList.add('drag-del');
      D.el.classList.add('cp-lift');
    }
  }
  const g = D.ghost as HTMLElement;
  g.style.left = `${ev.clientX}px`;
  g.style.top = `${ev.clientY}px`;
  const pr = pal.getBoundingClientRect();
  D.overPal =
    D.src === 'view' && ev.clientX > pr.left && ev.clientX < pr.right && ev.clientY > pr.top && ev.clientY < pr.bottom;
  pal.classList.toggle('over', D.overPal);
  D.tg = D.overPal ? null : VIEWS[S.view].target(viewEl, ev.clientX, ev.clientY, D.d, ctx());
  const ca = caret();
  if (ca) {
    ca.style.display = D.tg ? 'block' : 'none';
    if (D.tg) Object.assign(ca.style, { left: `${D.tg.cx}px`, top: `${D.tg.cy}px`, height: `${D.tg.ch}px` });
  }
});
document.addEventListener(
  'touchmove',
  (ev) => {
    if (D?.on) ev.preventDefault();
  },
  { passive: false },
);
function endDrag(): DragState | null {
  const d = D;
  D = null;
  pal.classList.remove('drag-del', 'over');
  d?.ghost?.remove();
  d?.el.classList.remove('cp-lift');
  const ca = caret();
  if (ca) ca.style.display = 'none';
  return d;
}
document.addEventListener('pointerup', () => {
  const d = endDrag();
  if (!d) return;
  if (!d.on) {
    if (d.src === 'view') pick(d.d.id);
    else insert(newItem(d.el), insertCtx().index);
    return;
  }
  if (d.src === 'view') {
    const from = indexOf(d.d.id);
    if (d.overPal) return del(d.d.id);
    if (!d.tg || from < 0) return;
    let to = d.tg.index;
    if (to === from || to === from + 1) return;
    remember();
    const [it] = S.items.splice(from, 1);
    if (from < to) to--;
    S.items.splice(to, 0, it);
    changed();
  } else if (d.tg) insert(newItem(d.el), d.tg.index);
});
document.addEventListener('pointercancel', () => endDrag());
/** ブロックを押した: 選ぶ。コードなら弾き始めの位置にもする */
function pick(id: number): void {
  const e = entryOf(id);
  if (!e) return;
  S.sel = S.sel === id ? null : id;
  if (isChord(e)) {
    cueTo(id);
    audition(e);
  }
  syncPlay();
  render();
}
viewEl.addEventListener('click', (ev) => {
  const t = ev.target as Element,
    seg = t.closest<SVGGElement>('.cp-wseg'),
    add = t.closest<HTMLElement>('[data-add]');
  if (seg) addAfter(Number(seg.dataset.d), seg.dataset.q as Qual);
  else if (add) {
    const [d, q] = (add.dataset.add as string).split(',');
    addAfter(Number(d), q as Qual);
  }
});
/** 選んだブロックの後ろ（なければ最後）にコードを足す */
function addAfter(d: number, q: Qual): void {
  insert(withId({ k: 'ch', d, q, inv: 0, b: 0, p: null }), insertCtx().index);
}
viewEl.addEventListener('keydown', (ev) => {
  const el = (ev.target as Element).closest<HTMLElement>('[data-id]');
  if (el && (ev.key === 'Enter' || ev.key === ' ')) {
    ev.preventDefault();
    pick(Number(el.dataset.id));
  }
});
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
  } else if (
    (ev.key === 'Delete' || ev.key === 'Backspace') &&
    S.sel !== null &&
    (t.closest('#cp-view') || t === document.body)
  ) {
    ev.preventDefault();
    del(S.sel);
  } else if (ev.key === 'Escape' && S.sel !== null) {
    S.sel = null;
    render();
  }
});
/* 幅が変わると折り返しが変わるので、括弧と設定の窓を置き直す */
new ResizeObserver(() => {
  drawBands(viewEl.querySelector('#cp-sc'));
  showEd();
}).observe(viewEl);

/* ---------- 曲の保存・新規・サンプル ---------- */
const SAVE_KEY = 'chord-progression:saved';
const nameIn = $<HTMLInputElement>('#cp-name'),
  msg = $('#cp-msg');
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
  const list = readSaved(),
    box = $('#cp-saved');
  box.innerHTML = list.length
    ? list
        .map(
          (x, j) =>
            `<li><button type="button" class="cp-sv" data-open="${j}">${esc(x.name)}</button><button type="button" class="cp-sx" data-rm="${j}" aria-label="${esc(`「${x.name}」を削除`)}" title="削除">×</button></li>`,
        )
        .join('')
    : '<li class="cp-none">まだ保存した進行はありません。</li>';
}
/** 曲を入れ替える。変更が残っていれば確かめる */
function load(items: Item[], name: string, dirty = false): boolean {
  if (S.dirty && !confirm(`保存していない変更は失われます。「${name || '新しい進行'}」を開きますか？`)) return false;
  player.halt(true);
  undo.length = 0;
  redo.length = 0;
  S.items = items;
  S.name = name;
  S.sel = null;
  S.cue = null;
  S.tl = compute(S.items);
  S.dirty = dirty;
  nameIn.value = name;
  saveCurrent();
  syncPlay();
  render();
  return true;
}
nameIn.value = S.name;
nameIn.addEventListener('input', () => {
  S.name = nameIn.value.slice(0, 60);
  S.dirty = true;
  saveCurrent();
});
$('#cp-samples').addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLElement>('[data-s]');
  if (!b) return;
  const id = b.dataset.s as string;
  if (load(sampleItems(id), sampleName(id))) say('');
});
$('#cp-new').addEventListener('click', () => {
  if (load(parseSong('[key C maj] [met 4/4] [tmp 96] [pat updown] [vce gtr]'), '')) say('');
});
$('#cp-save').addEventListener('click', () => {
  const name = nameIn.value.trim() || '無題の進行',
    list = readSaved().filter((x) => x.name !== name);
  list.unshift({ name, at: Date.now(), file: toFile(name, S.items) });
  if (!writeSaved(list.slice(0, 50))) return say('このブラウザでは保存できません。');
  S.name = name;
  nameIn.value = name;
  S.dirty = false;
  saveCurrent();
  renderSaved();
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
    if (load(f.items, x.name)) say('');
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
    blob = new Blob([JSON.stringify(toFile(name, S.items), null, 1)], { type: 'application/json' }),
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
    if (load(r.items, r.name || f.name.replace(/\.json$/i, ''))) say('');
  } catch {
    say('このファイルは読み込めません。');
  }
});

syncClick();
renderSaved();
say('');
syncPlay();
render();

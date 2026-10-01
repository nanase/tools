/** 受動素子組み合わせ計算機の入口: 入力 → 探索（Worker）→ 結果・回路・候補・代入式 */
import { Choice } from '../../lib/choice';
import { $, esc } from '../../lib/dom';
import { eList, inSeries, type Series, same } from '../../lib/eseries';
import { fmt, fmtR, parts, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { parse } from '../../lib/parse';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { circuitSvg } from './circuit';
import { type Cand, cand, errTxt, type TyState, usable } from './model';
import { K, type N, NS, NUM_KEYS, type NumKey, numDef, numPatch, STOPS, TY, type Ty } from './params';
import type { Found } from './search';
import type { FromWorker, ToWorker } from './worker';

initToolPage();

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};

/* ---------- 入力の状態（種類ごとに持つ）。ブラウザに保存し、開き直したときに戻す ---------- */
const ST: Record<Ty, TyState> = {
  R: { ...TY.R.v, ex: [] },
  C: { ...TY.C.v, ex: [] },
  L: { ...TY.L.v, ex: [] },
};
{
  const sv = stored('st') as Partial<Record<Ty, Partial<TyState>>> | undefined;
  const ok = (x: unknown, t: Ty): x is number => typeof x === 'number' && x >= TY[t].lo && x <= TY[t].hi;
  for (const t of ['R', 'C', 'L'] as const) {
    const s = sv?.[t];
    if (!s || !ok(s.t, t) || !ok(s.min, t) || !ok(s.max, t) || s.min > s.max) continue;
    ST[t] = { t: s.t, min: s.min, max: s.max, ex: Array.isArray(s.ex) ? s.ex.filter((x) => ok(x, t)) : [] };
  }
}
let ty: Ty = 'R',
  es: Series = 12,
  stopI = 2,
  nSel: N = 3;

/* ---------- 数値の行: 目標・最小・最大 ---------- */
/* 値は種類ごとの状態（ST）として保存するので、行ごとには保存しない */
const g = new ParamGroup<NumKey>(
  NUM_KEYS.map((k) => numDef(k, 'R')),
  (v, k) => {
    if (!k) return;
    Object.assign(ST[ty], v);
    renderEs();
    schedule();
  },
  null,
  { save: false },
);
g.on('min', (v) => {
  if (v > g.get('max')) {
    g.set('max', v, { silent: true });
    g.note('max', '最小に合わせました');
  }
});
g.on('max', (v) => {
  if (v < g.get('min')) {
    g.set('min', v, { silent: true });
    g.note('min', '最大に合わせました');
  }
});

/* ---------- E 系列 ---------- */
const esRow = new Choice($('#p-es'), (v) => {
  es = Number(v) as Series;
  renderEs();
  schedule();
});
function renderEs(): void {
  const s = ST[ty],
    u = TY[ty].u,
    n = usable(es, s).length,
    x = eList(es, s.min, s.max).length - n,
    range = `${fmt(s.min, u)} – ${fmt(s.max, u)}`;
  esRow.note(
    n ? `${range} の E${es}: ${n} 個${x ? `（${x} 個を除く）` : ''}` : `${range} に使える E${es} の値がありません`,
    n ? '' : 'er',
  );
}

/* ---------- 除外する値 ---------- */
const exRow = $('#p-ex'),
  exIn = $<HTMLInputElement>('#in-ex'),
  exMsg = $('#m-ex'),
  exChips = $('#exChips'),
  exAdd = $('#exAdd');
const XMARK = '<svg viewBox="0 0 9 9" aria-hidden="true"><path d="M1 1L8 8M8 1L1 8"/></svg>';
function exSet(cls: '' | 'pv' | 'er', t: string): void {
  exMsg.className = `msg${cls ? ` ${cls}` : ''}`;
  exMsg.textContent = t;
}
function renderEx(): void {
  const T = TY[ty],
    L = ST[ty].ex;
  $('.c-sym', exRow).innerHTML = `<i>${T.s}</i><sub>ex</sub>`;
  $('.nm', exRow).textContent = `使わない${T.q}`;
  $('#u-ex').textContent = T.u;
  exIn.placeholder = T.ph;
  exChips.innerHTML =
    L.map(
      (v) =>
        `<button type="button" class="chip xc" data-v="${v}" aria-label="${esc(fmt(v, T.u))} を除外から外す">${esc(fmt(v, T.u, 3))}${XMARK}</button>`,
    ).join('') + (L.length > 1 ? '<button type="button" class="chip clr" data-all="1">すべて外す</button>' : '');
}
function addEx(onBlur: boolean): void {
  const raw = exIn.value.trim(),
    T = TY[ty],
    s = ST[ty];
  exRow.classList.remove('dirty', 'bad');
  exIn.removeAttribute('aria-invalid');
  if (!raw) {
    exSet('', '');
    return;
  }
  const v = parse(raw, T.u);
  if (!(v > 0)) {
    if (!onBlur) {
      exRow.classList.add('bad');
      exIn.setAttribute('aria-invalid', 'true');
    }
    exSet('er', '読めない値です（例 1k・4k7・100n）');
    return;
  }
  exIn.value = '';
  if (s.ex.some((x) => same(x, v))) {
    exSet('', `${fmt(v, T.u)} はすでに除外しています`);
    return;
  }
  s.ex.push(v);
  s.ex.sort((a, b) => a - b);
  exSet('', inSeries(192, v) || inSeries(es, v) ? '' : `${fmt(v, T.u)} は E 系列にない値です`);
  renderEx();
  renderEs();
  schedule();
}
exIn.addEventListener('input', () => {
  exRow.classList.add('dirty');
  exRow.classList.remove('bad');
  const t = exIn.value.trim(),
    v = parse(t, TY[ty].u);
  if (!t) {
    exRow.classList.remove('dirty');
    exSet('', '');
  } else exSet(v > 0 ? 'pv' : '', v > 0 ? `→ ${fmt(v, TY[ty].u, 6)}（Enter で追加）` : '…');
});
exIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addEx(false);
  } else if (e.key === 'Escape' && exIn.value) {
    e.preventDefault();
    exIn.value = '';
    exRow.classList.remove('dirty', 'bad');
    exSet('', '');
  }
});
exIn.addEventListener('blur', (e) => {
  if (e.relatedTarget !== exAdd && exIn.value.trim()) addEx(true);
});
exAdd.addEventListener('click', () => {
  addEx(false);
  exIn.focus();
});
exChips.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button');
  if (!b) return;
  const s = ST[ty];
  if (b.dataset.all) {
    s.ex = [];
    exSet('', '');
  } else {
    const v = Number(b.dataset.v);
    s.ex = s.ex.filter((x) => !same(x, v));
    exSet('', `${fmt(v, TY[ty].u)} を外しました`);
  }
  renderEx();
  renderEs();
  schedule();
  (exChips.querySelector<HTMLElement>('button') ?? exIn).focus();
});

/* ---------- 探索を終える誤差 ---------- */
new Choice($('#p-stop'), (v) => {
  stopI = Number(v);
  schedule();
});

/* ---------- 素子の種類 ---------- */
function applyType(): void {
  for (const k of NUM_KEYS) {
    g.update(k, numPatch(k, ty));
    g.set(k, ST[ty][k], { silent: true });
  }
  renderEx();
  exIn.value = '';
  exRow.classList.remove('dirty', 'bad');
  exSet('', '');
  renderEs();
}
new Choice($('#ctype'), (v) => {
  ty = v as Ty;
  applyType();
  run();
});

/* ---------- 探索（Web Worker） ---------- */
type St = 'wait' | 'run' | 'none' | 'reach' | 'all' | 'abort' | 'err';
interface Res {
  st: St;
  p: number;
  list: Cand[];
  sel: number;
}
const RES = {} as Record<N, Res>;
/** 探索を始めたときの種類と目標（結果の表示に使う） */
let RUN: { ty: Ty; t: number } | null = null;
let W: Worker | null = null,
  runT: ReturnType<typeof setTimeout> | undefined;
const busy = () => NS.some((n) => RES[n].st === 'run' || RES[n].st === 'wait');

/** 入力が続けて変わるときは 0.25 秒待ってから探索する */
/** 入力が変わったら保存して、少し待って探し直す */
function schedule(): void {
  store('st', ST);
  clearTimeout(runT);
  runT = setTimeout(run, 250);
}
function stopWorker(): void {
  W?.terminate();
  W = null;
}
function run(): void {
  clearTimeout(runT);
  stopWorker();
  const s = ST[ty],
    vals = usable(es, s);
  RUN = { ty, t: s.t };
  for (const n of NS) RES[n] = { st: vals.length ? 'wait' : 'none', p: 0, list: [], sel: 0 };
  if (vals.length) {
    try {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      W = w;
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        if (w === W) onMsg(e.data);
      };
      w.onerror = (e) => {
        e.preventDefault();
        if (w === W) onMsg({ k: 'x', msg: e.message });
      };
      const msg: ToWorker = { t: s.t, v: vals, stop: STOPS[stopI][0], ns: NS, K };
      w.postMessage(msg);
    } catch {
      for (const n of NS) RES[n].st = 'err';
    }
  }
  paint();
}
function abort(): void {
  stopWorker();
  for (const n of NS) if (RES[n].st === 'run' || RES[n].st === 'wait') RES[n].st = 'abort';
  paint();
}
function onMsg(d: FromWorker): void {
  if (d.k === 'x') {
    for (const n of NS) if (RES[n].st === 'run' || RES[n].st === 'wait') RES[n].st = 'err';
    stopWorker();
    paint();
    return;
  }
  const r = RES[d.n as N];
  if (d.k === 's') {
    r.st = 'run';
    r.p = 0;
  } else if (d.k === 'p') {
    r.p = d.p;
    if (d.list) setList(r, d.list);
  } else {
    r.st = d.r;
    r.p = 1;
    setList(r, d.list);
    if (d.n === NS[NS.length - 1]) stopWorker();
  }
  paint();
}
/** 候補を差し替える。選んでいた候補があれば、同じ値の候補を選び直す */
function setList(r: Res, list: Found[]): void {
  if (!RUN) return;
  const { ty: t, t: target } = RUN,
    keep = r.list[r.sel]?.v;
  r.list = list.map((f) => cand(f, t, target));
  const i = keep == null ? -1 : r.list.findIndex((c) => same(c.v, keep));
  r.sel = i < 0 ? 0 : i;
}

/* ---------- 表示 ---------- */
const ST_TXT: Record<Exclude<St, 'run'>, string> = {
  wait: '待機中',
  none: '使える値がありません',
  reach: '誤差の条件に届いたので終了',
  all: '全探索が完了',
  abort: '中止しました',
  err: 'エラーで中止しました',
};
const stTxt = (r: Res) => (r.st === 'run' ? `探索中 ${(r.p * 100).toFixed(1)} %` : ST_TXT[r.st]);
/** MathML の量。合成値（keep）は末尾の 0 を残す */
const qty = (v: number, u: string, sig = 6, keep = false) => {
  const [n, x] = parts(v, u, sig, keep);
  return `<mn>${n}</mn><mspace width="0.17em"/><mi mathvariant="normal">${x}</mi>`;
};
const runBtn = $('#runBtn');

let paintRaf = 0;
function paint(): void {
  if (!paintRaf) paintRaf = requestAnimationFrame(render);
}
function render(): void {
  paintRaf = 0;
  if (!RUN) return;
  const r = RES[nSel],
    c = r.list[r.sel],
    T = TY[RUN.ty],
    u = T.u;
  txt('#o-vl', `${T.syn}（${nSel} 本）`);
  html('#o-v', c ? ro(c.v, u, 6) : '—');
  html(
    '#o-e',
    c
      ? esc(errTxt(c.e)).replace(/ %$/, '<span class="u">%</span>') +
          (Math.abs(c.e) < 1e-12 ? '<span class="m-q">正確</span>' : '')
      : '—',
  );
  html('#o-k', c ? `${c.k}<span class="u">種</span>` : '—');
  txt('#o-x', c ? c.x : '—');
  txt('#o-s', stTxt(r));
  const anyRun = busy(),
    anyAbort = NS.some((n) => RES[n].st === 'abort' || RES[n].st === 'err');
  runBtn.hidden = !anyRun && !anyAbort;
  runBtn.textContent = anyRun ? '中止' : 'もう一度探索';
  runBtn.dataset.a = anyRun ? 'stop' : 'run';
  /* スマホで上に留まる要約 */
  html('#mn', `${nSel} 本<b>${c ? esc(fmtR(c.v, u, 6)) : '—'}</b>`);
  txt('#me', c ? errTxt(c.e) : '—');
  /* 候補 */
  txt('#cmb-aux', c ? `${r.sel + 1} 番目の候補` : '');
  html(
    '#clist',
    r.list.length
      ? '<div class="cr cr-h" aria-hidden="true"><span class="v">合成値</span><span class="e">誤差</span><span class="x">組み合わせ</span><span class="k">種類</span></div>' +
          r.list
            .map(
              (c, i) =>
                `<button type="button" class="cr${i ? '' : ' best'}" data-i="${i}" aria-pressed="${i === r.sel}" aria-label="${esc(`${fmtR(c.v, u, 6)}、誤差 ${errTxt(c.e)}、${c.x}、${c.k} 種類`)}"><span class="v">${esc(fmtR(c.v, u, 6))}</span><span class="e">${esc(errTxt(c.e))}</span><span class="x">${esc(c.x)}</span><span class="k">${c.k} 種</span></button>`,
            )
            .join('')
      : `<p class="empty-c">${r.st === 'run' || r.st === 'wait' ? '探索しています…' : r.st === 'none' ? '使える値がありません。範囲か E 系列を変えてください' : 'まだ候補がありません'}</p>`,
  );
  html('#cmbw', c ? circuitSvg(c, RUN.ty) : '<p class="empty-c">組み合わせが見つかると、ここに回路を描きます</p>');
  /* 代入した式 */
  const X = `<msub><mi>${T.s}</mi><mi mathvariant="normal">T</mi></msub>`,
    t = RUN.t;
  html(
    '#subst',
    c
      ? `<math display="block"><mi>${T.s}</mi><mo>=</mo><mtext>${esc(c.x)}</mtext><mo>&#x2248;</mo>${qty(c.v, u, 6, true)}</math>` +
          `<math display="block"><mi>ε</mi><mo>=</mo><mfrac><mrow>${qty(c.v, u, 6, true)}<mo>&#x2212;</mo>${qty(t, u)}</mrow>${qty(t, u)}</mfrac><mo>&#xD7;</mo><mn>100</mn><mspace width="0.2em"/><mi mathvariant="normal">%</mi><mo>&#x2248;</mo><mn>${esc(errTxt(c.e).replace(/ %$/, ''))}</mn><mspace width="0.2em"/><mi mathvariant="normal">%</mi></math>` +
          `<math display="block"><mphantom><mi>ε</mi></mphantom><mspace width="0.2em"/><mtext>（</mtext>${X}<mo>=</mo>${qty(t, u)}<mtext>、組み合わせの + は直列、∥ は並列）</mtext></math>`
      : '<math display="block"><mtext>候補が見つかると、ここに値を代入した式を出します</mtext></math>',
  );
}

new Choice($('#nsel'), (v) => {
  nSel = Number(v) as N;
  paint();
});
$('#clist').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button.cr');
  if (!b) return;
  RES[nSel].sel = Number(b.dataset.i);
  render();
  $<HTMLElement>(`#clist button[data-i="${b.dataset.i}"]`).focus();
});
runBtn.addEventListener('click', () => {
  if (runBtn.dataset.a === 'stop') abort();
  else run();
});

/* ---------- 初期化（保存した値を行に出す。種類を保存していれば Choice が後で切り替える） ---------- */
applyType();
run();

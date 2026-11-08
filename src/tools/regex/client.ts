/**
 * 正規表現のページの入口。入力のたびに 5 つの方式で照合を記録し、上の枠に一致、下の図で照合の手順を再生する。
 * 表示は 単独（1 方式のコマ）・比較（全方式を比較の回数で同時に進める）・一覧（方式と例の表）の 3 つ。
 * 図の描き方（状態図・対応の線・表）は比較の枠としくみの小さな図にも使う
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { type FigData, narrate, paint, readColors, type View } from './fig';
import {
  type Analysis,
  analyze,
  ENGINES,
  type EngineId,
  engineOf,
  isErr,
  PAT_MAX,
  PRESETS,
  type Run,
  replaceAll,
  TEXT_MAX,
} from './model';
import { type Key, SPEED } from './params';

initToolPage();

type Mode = 'one' | 'cmp' | 'list';
type Table = 'steps' | 'feat';
const num = (v: number): string => v.toLocaleString('en-US');
const str = (k: string, d: string, max: number): string => {
  const v = stored(k);
  return typeof v === 'string' && v.length <= max ? v : d;
};

/* ---------- 状態 ---------- */
const root = $('#rx');
const cv = $<HTMLCanvasElement>('#rx-cv');
const patIn = $<HTMLInputElement>('#rx-in');
const textIn = $<HTMLTextAreaElement>('#rx-tx');
const repIn = $<HTMLInputElement>('#rx-rep');
let pat = str('pat', PRESETS[0].pat, PAT_MAX);
let text = str('text', PRESETS[0].text, TEXT_MAX);
let rep = str('rep', PRESETS[0].rep, 200);
let flags = str('flags', '', 2).replace(/[^im]/g, '');
let eng: EngineId = engineOf(String(stored('eng')))?.id ?? 'bt';
/** 保存したパターンが読めなければ最初の例に戻す */
const first = analyze(pat, text, flags);
if (isErr(first)) {
  pat = PRESETS[0].pat;
  text = PRESETS[0].text;
  flags = '';
}
let A = isErr(first) ? (analyze(pat, text) as Analysis) : first;
let sel = -1;
let step = 0;
let rate = SPEED.v;
let playing = false;
let acc = 0;
let last = 0;
let raf = 0;
let booted = false;
let one: FigData | null = null;
let cells: { id: EngineId; el: HTMLElement; cv: HTMLCanvasElement; d: FigData }[] = [];

const modeCh = new Choice<Mode>($('#rx-mode'), (m) => changeMode(m));
let mode: Mode = modeCh.value;
const viewCh = new Choice<View>($('#rx-view'), () => {
  if (!booted) return;
  resetFigs();
  draw();
  drawHow();
});
const tableCh = new Choice<Table>($('#rx-tbl'), () => {
  if (booted) buildList();
});
new ParamGroup<Key>([SPEED], (v) => {
  rate = v.sp;
  if (booted) syncTrack();
});

/* ---------- 再生の長さ ---------- */
const runOf = (id: EngineId = eng): Run => A.runs[id];
/** 比較では比較の回数、単独と一覧ではコマで進める */
function maxStep(): number {
  if (mode === 'cmp')
    return Math.max(
      1,
      ...ENGINES.map((e) => runOf(e.id))
        .filter((r) => !r.unsup)
        .map((r) => r.steps),
    );
  const r = runOf();
  return r.unsup ? 0 : r.fr.length - 1;
}
/** 比較の回数が c までのコマ */
function frameBySteps(r: Run, c: number): number {
  let lo = 0,
    hi = r.fr.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (r.fr[m].steps <= c) lo = m;
    else hi = m - 1;
  }
  return lo;
}

/* ---------- 一致の表示 ---------- */
function renderMatches(): void {
  const ms = A.matches,
    ng = Math.min(A.re.ng, 3),
    cls = new Array<string | null>(text.length).fill(null);
  $('#rx-cnt').textContent = `${ms.length} 件`;
  ms.forEach((m, k) => {
    for (let p = m.s; p < m.e; p++) {
      /* いちばん内側のグループの色で下線を引く */
      let g = 0,
        best = Infinity;
      for (let q = 1; q <= ng; q++) {
        const a = m.caps[2 * q],
          b = m.caps[2 * q + 1];
        if (a >= 0 && b >= 0 && p >= a && p < b && b - a <= best) {
          best = b - a;
          g = q;
        }
      }
      cls[p] = `${k}|${g}`;
    }
  });
  let html = '',
    p = 0;
  while (p < text.length) {
    const c = cls[p];
    let q = p;
    while (q < text.length && cls[q] === c) q++;
    const s = esc(text.slice(p, q));
    if (c === null) html += s;
    else {
      const [k, g] = c.split('|');
      html += `<mark data-m="${k}" class="${g !== '0' ? `g${g}` : ''}${Number(k) === sel ? ' sel' : ''}">${s}</mark>`;
    }
    p = q;
  }
  $('#rx-hl').innerHTML = html;
  const gh = Array.from(
    { length: ng },
    (_, k) => `<th><i style="background:var(--rx-g${k + 1})" aria-hidden="true"></i>グループ ${k + 1}</th>`,
  ).join('');
  $('#rx-mt').innerHTML = ms.length
    ? `<thead><tr><th>#</th><th>位置</th><th>一致</th>${gh}</tr></thead><tbody>${ms
        .slice(0, 30)
        .map((m, k) => {
          const gs = Array.from({ length: ng }, (_, q) => {
            const a = m.caps[2 * q + 2],
              b = m.caps[2 * q + 3];
            return `<td>${a >= 0 && b >= 0 ? esc(text.slice(a, b)) : '<span class="rx-nil">–</span>'}</td>`;
          }).join('');
          return `<tr data-m="${k}" class="${k === sel ? 'sel' : ''}" title="この一致の照合を再生"><td class="n">${k + 1}</td><td>${m.s}〜${m.e}</td><td>${esc(text.slice(m.s, m.e)) || '<span class="rx-nil">（空）</span>'}</td>${gs}</tr>`;
        })
        .join('')}</tbody>`
    : '';
  const ro = $('#rx-ro');
  ro.hidden = !rep;
  if (rep) {
    const r = replaceAll(text, ms, rep);
    let h = '',
      at = 0;
    for (const [a, b] of r.parts) {
      h += `${esc(r.out.slice(at, a))}<b>${esc(r.out.slice(a, b))}</b>`;
      at = b;
    }
    ro.innerHTML = h + esc(r.out.slice(at));
  }
}

/* ---------- 図 ---------- */
function resetFigs(): void {
  one = null;
  for (const c of cells) c.d = { ...c.d, lay: undefined };
  for (const h of how) h.d = { ...h.d, lay: undefined };
}
function buildRace(): void {
  const host = $('#rx-race');
  host.textContent = '';
  cells = [];
  if (mode !== 'cmp') return;
  for (const e of ENGINES) {
    const el = document.createElement('div');
    el.className = 'rx-cell';
    el.innerHTML = `<div class="rx-ch"><span class="rx-cn"></span><span class="rx-dn"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.8 2.8L10 3.5"/></svg>完了</span><em></em></div><span class="rx-cb"><b></b></span><canvas role="img"></canvas>`;
    $('.rx-cn', el).textContent = e.name;
    const c = $<HTMLCanvasElement>('canvas', el);
    c.setAttribute('aria-label', e.name);
    host.append(el);
    cells.push({ id: e.id, el, cv: c, d: { re: A.re, text, run: runOf(e.id), i: 0, mini: true } });
  }
}
function draw(): void {
  const view = viewCh.value;
  if (mode === 'cmp') {
    for (const c of cells) {
      const run = runOf(c.id);
      c.d = { ...c.d, re: A.re, text, run, i: run.unsup ? 0 : frameBySteps(run, step) };
      paint(c.cv, view, c.d);
    }
  } else {
    one = { ...(one ?? {}), re: A.re, text, run: runOf(), i: step, mini: false };
    paint(cv, view, one);
  }
  syncTrack();
  syncResults();
  syncStatus();
}
function kick(): void {
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick(now: number): void {
  raf = 0;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!playing) return;
  acc += rate * dt;
  const k = Math.floor(acc);
  if (k > 0) {
    acc -= k;
    step = Math.min(maxStep(), step + k);
    if (step >= maxStep()) setPlay(false);
    draw();
  }
  if (playing) kick();
}
function setPlay(on: boolean): void {
  playing = on;
  const b = $('#tp-pp'),
    t = on ? '一時停止' : '再生';
  b.classList.toggle('on', on);
  b.title = t;
  b.setAttribute('aria-label', t);
  if (on) {
    last = performance.now();
    acc = 0;
    kick();
  }
  syncStatus();
}
function seekTo(s: number): void {
  step = Math.max(0, Math.min(maxStep(), Math.round(s)));
  draw();
}
const mmss = (v: number): string => {
  const s = Math.floor(v);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function syncTrack(): void {
  const tot = maxStep(),
    pc = `${((tot ? step / tot : 0) * 100).toFixed(2)}%`,
    unit = mode === 'cmp' ? '回の比較' : '手順',
    trk = $('#tp-trk');
  $('#tp-fill').style.width = pc;
  $('#tp-th').style.left = pc;
  $('#tp-a').textContent = num(step);
  $('#tp-b').textContent = num(tot);
  $('#tp-u').textContent = unit;
  $('#tp-t').textContent = tot / rate < 1 ? '' : `${mmss(step / rate)} / ${mmss(tot / rate)}`;
  trk.setAttribute('aria-valuemax', String(tot));
  trk.setAttribute('aria-valuenow', String(step));
  trk.setAttribute('aria-valuetext', `${num(step)} / ${num(tot)} ${unit}`);
}
function syncStatus(): void {
  const end = step >= maxStep(),
    txt = playing ? '実行中' : end && step > 0 ? '完了' : step > 0 ? '一時停止中' : '',
    t = $('#rx-stT');
  $('#rx-led').className = `led${playing ? ' on' : end && step > 0 ? ' rx-ok' : txt ? ' half' : ''}`;
  if (t.textContent !== txt) t.textContent = txt;
  $('#rx-st').hidden = !txt;
}
function syncResults(): void {
  if (mode === 'cmp') {
    const mx = maxStep();
    for (const c of cells) {
      const r = runOf(c.id),
        em = $('em', c.el);
      c.el.toggleAttribute('data-na', !!r.unsup);
      if (r.unsup) {
        em.textContent = '–';
        c.el.removeAttribute('data-done');
        continue;
      }
      const done = step >= r.steps,
        v = done ? r.steps : r.fr[frameBySteps(r, step)].steps;
      em.textContent = `${num(v)}${r.aborted && done ? '+' : ''} 回`;
      c.el.toggleAttribute('data-done', done && !r.aborted);
      $<HTMLElement>('.rx-cb b', c.el).style.width = `${Math.min(100, (v / mx) * 100)}%`;
    }
    $('#rx-say').textContent = '';
    return;
  }
  const r = runOf(),
    bt = eng === 'bt' || eng === 'memo';
  $('#o-aT').textContent = bt ? '後戻り' : '同時に追跡した状態';
  $('#o-bT').textContent = bt ? 'スタックの深さ' : 'DFA の状態';
  if (r.unsup) {
    for (const id of ['#o-s', '#o-m', '#o-a', '#o-b']) $(id).textContent = '–';
    $('#rx-say').textContent = r.unsup;
    return;
  }
  const f = r.fr[Math.min(step, r.fr.length - 1)];
  $('#o-s').textContent = `${num(f.steps)}${r.aborted && step >= r.fr.length - 1 ? '+' : ''}`;
  $('#o-m').textContent = `${f.mc} 件`;
  $('#o-a').textContent = bt ? num(f.back) : num(f.th?.length ?? 0);
  $('#o-b').textContent = bt ? num(f.d) : f.states !== undefined ? num(f.states) : '–';
  $('#rx-say').textContent = narrate(A.re, text, f, r.alpha);
}
function buildRank(): void {
  const body = $('#rx-rkb');
  body.textContent = '';
  for (const e of ENGINES) {
    const r = runOf(e.id),
      tr = document.createElement('tr');
    tr.innerHTML = `<th class="l" scope="row"></th>${
      r.unsup
        ? `<td class="na" colspan="5"></td>`
        : `<td>${num(r.steps)}${r.aborted ? '+' : ''}</td><td>${e.id === 'bt' || e.id === 'memo' ? num(r.back) : '–'}</td><td>${num(r.maxTh)}</td><td>${r.states !== undefined ? num(r.states) : '–'}</td><td>${r.matches.length} 件</td>`
    }<td class="l w"></td>`;
    $('th', tr).textContent = e.name;
    if (r.unsup) $('.na', tr).textContent = r.unsup;
    $('.w', tr).textContent = e.who;
    body.append(tr);
  }
}

/* ---------- 一覧 ---------- */
let presetRuns: Analysis[] | null = null;
const FEAT: Record<EngineId, [string, string, string, string]> = {
  bt: ['✓', '✓', '✓', 'O(2ⁿ)'],
  memo: ['✓ メモ化なし', '✓', '✓', 'O(mn)'],
  nfa: ['×', '✓', '✓', 'O(mn)'],
  ldfa: ['×', '✓', '位置だけ', 'O(mn)'],
  dfa: ['×', '×', '×', 'O(n) と作成 O(2ᵐ)'],
};
function buildList(): void {
  const lt = $('#rx-lt'),
    steps = tableCh.value === 'steps';
  $('#hd-mat').textContent = steps ? '方式と例の比較の回数' : '方式ごとの記法と手間';
  if (steps) {
    presetRuns ??= PRESETS.map((p) => analyze(p.pat, p.text) as Analysis);
    const all = presetRuns.flatMap((a) =>
        ENGINES.map((e) => a.runs[e.id])
          .filter((r) => !r.unsup)
          .map((r) => r.steps),
      ),
      lmax = Math.log10(Math.max(10, ...all)),
      cur = PRESETS.findIndex((p) => p.pat === pat && p.text === text);
    lt.innerHTML = `<thead><tr><th></th>${PRESETS.map((p, k) => `<th scope="col"><button type="button" class="rx-lh" data-p="${k}" title="${esc(p.name)}: 比較">${esc(p.name)}</button></th>`).join('')}</tr></thead><tbody>${ENGINES.map(
      (e) =>
        `<tr><th scope="row"><button type="button" class="rx-lr" data-e="${e.id}">${e.name}</button></th>${presetRuns
          ?.map((a, k) => {
            const r = a.runs[e.id];
            if (r.unsup)
              return `<td><button type="button" class="rx-c na" data-e="${e.id}" data-p="${k}" title="${esc(r.unsup)}">×</button></td>`;
            const x = Math.log10(Math.max(1, r.steps)) / lmax,
              hot = r.steps >= 1000;
            return `<td><button type="button" class="rx-c${hot ? ' hot' : ''}${cur === k && eng === e.id ? ' sel' : ''}" style="--rx-c-bg:color-mix(in srgb,var(--rx-mov) ${Math.round(8 + 60 * x * x)}%,transparent)" data-e="${e.id}" data-p="${k}" title="${esc(PRESETS[k].name)}: ${e.name}">${num(r.steps)}${r.aborted ? '+' : ''}</button></td>`;
          })
          .join('')}</tr>`,
    ).join('')}</tbody>`;
  } else {
    lt.innerHTML = `<thead><tr><th></th><th scope="col">後方参照</th><th scope="col">^ $ \\b</th><th scope="col">グループ</th><th scope="col">最悪の手間</th><th scope="col">使われている所</th></tr></thead><tbody class="rx-ft">${ENGINES.map(
      (e) =>
        `<tr><th scope="row"><button type="button" class="rx-lr" data-e="${e.id}">${e.name}</button></th>${FEAT[e.id]
          .map((v, k) => `<td class="${k === 3 ? 'o' : ''}">${v}</td>`)
          .join('')}<td>${e.who}</td></tr>`,
    ).join('')}<tr><td class="nb" colspan="6">n 文章の長さ・m パターンの長さ</td></tr></tbody>`;
  }
}

/* ---------- しくみ ---------- */
const HOW = [
  { t: '1 文字ずつ比較', s: '部品と文字を先頭から順に照合', pat: 'cat', text: 'cat', eng: 'bt' },
  { t: '開始位置の移動', s: '不一致なら 1 文字右から再開', pat: 'cat', text: 'cocat', eng: 'bt' },
  { t: '選択', s: '<code>|</code> の左から順に試行', pat: 'gr(a|e)y', text: 'grey', eng: 'bt' },
  { t: '繰り返し', s: '<code>+</code> は 1 回以上・<code>*</code> は 0 回以上', pat: 'ab+c', text: 'abbbc', eng: 'bt' },
  { t: '後戻り', s: '行き止まりで分かれ道まで戻って別の道へ', pat: '.*c', text: 'abcab', eng: 'bt' },
  { t: '最短一致', s: '<code>?</code> 付きの繰り返しは短いほうから試行', pat: '<.+?>', text: '<b>x</b>', eng: 'bt' },
  { t: '同時の追跡', s: '分かれ道をすべて同時に進めて文章を 1 回だけ読む', pat: 'a+b', text: 'aab', eng: 'nfa' },
  { t: '破滅的バックトラック', s: '分け方の組み合わせの数だけ後戻り', pat: '(a+)+b', text: 'aaaaa', eng: 'bt' },
] as const;
const how = HOW.map((h) => {
  const a = analyze(h.pat, h.text) as Analysis,
    run = a.runs[h.eng],
    end = run.fr.length - 1,
    hit = run.fr.findLastIndex((f) => f.k === 'match' || f.k === 'found'),
    rest = hit >= 0 ? hit : end;
  /* 選んでいない図は止めておく。一致があれば一致を見つけたコマ、なければ最後のコマ */
  return {
    ...h,
    a,
    end,
    rest,
    i: rest,
    wait: 0,
    cv: null as HTMLCanvasElement | null,
    d: { re: a.re, text: h.text, run, i: rest, mini: true } as FigData,
  };
});
/** 押して選んだしくみの図（-1 はなし）。選んだ図だけを動かす */
let howSel = -1;
let howSeen = false;
function buildHow(): void {
  const host = $('#rx-how');
  host.innerHTML = how
    .map(
      (h, k) =>
        `<button type="button" class="rx-hc" data-k="${k}" aria-pressed="false"><span class="rx-ht">${h.t}</span><span class="rx-hs">${h.s}</span><canvas role="img" aria-label="${h.t}"></canvas></button>`,
    )
    .join('');
  $$<HTMLCanvasElement>('canvas', host).forEach((c, k) => {
    how[k].cv = c;
  });
}
function drawHow(): void {
  for (const h of how) {
    if (!h.cv) continue;
    h.d = { ...h.d, i: h.i };
    paint(h.cv, viewCh.value, h.d);
  }
}
/** 選んだ図を見えている間だけ 1 秒に 3 コマで進め、終わりで少し止めて繰り返す */
let howTimer = 0;
function howRun(): void {
  clearInterval(howTimer);
  howTimer = 0;
  const h = how[howSel];
  if (!h || !howSeen) return;
  howTimer = window.setInterval(() => {
    if (h.i >= h.end) {
      if (++h.wait > 5) {
        h.i = 0;
        h.wait = 0;
      }
    } else h.i = Math.min(h.end, h.i + (h.end > 60 ? Math.ceil(h.end / 50) : 1));
    if (h.cv) {
      h.d = { ...h.d, i: h.i };
      paint(h.cv, viewCh.value, h.d);
    }
  }, 330);
}
/** 押した図を最初から動かす。もう一度押すと止めて結果のコマに戻す */
function pickHow(k: number): void {
  const prev = how[howSel];
  if (prev) {
    prev.i = prev.rest;
    prev.wait = 0;
  }
  howSel = howSel === k ? -1 : k;
  const h = how[howSel];
  if (h) {
    h.i = 0;
    h.wait = 0;
  }
  for (const b of $$('#rx-how .rx-hc')) b.setAttribute('aria-pressed', String(Number(b.dataset.k) === howSel));
  drawHow();
  howRun();
}
$('#rx-how').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.rx-hc');
  if (b) pickHow(Number(b.dataset.k));
});

/* ---------- 入力 ---------- */
function syncInputs(): void {
  if (patIn.value !== pat) patIn.value = pat;
  if (textIn.value !== text) textIn.value = text;
  if (repIn.value !== rep) repIn.value = rep;
  for (const b of $$('#rx-flags [data-f]')) b.setAttribute('aria-pressed', String(flags.includes(b.dataset.f ?? '')));
  $('#rx-flv').textContent = `g${flags}`;
  const k = PRESETS.findIndex((p) => p.pat === pat && p.text === text);
  for (const b of $$('#rx-smp [data-p]')) b.setAttribute('aria-pressed', String(Number(b.dataset.p) === k));
  for (const b of $$('#rx-eng [data-v]')) b.setAttribute('aria-pressed', String(b.dataset.v === eng));
  $('#rx-who').textContent = engineOf(eng)?.who ?? '';
}
/** 照合し直す。パターンが読めなければ前の結果のまま誤りを出す */
function reanalyze(): void {
  const r = analyze(pat, text, flags),
    err = $('#rx-err');
  $('.rx-pat').classList.toggle('bad', isErr(r));
  if (isErr(r)) {
    err.hidden = false;
    err.textContent = `位置 ${r.at}: ${r.err}`;
    return;
  }
  err.hidden = true;
  A = r;
  sel = -1;
  setPlay(false);
  step = 0;
  one = null;
  renderMatches();
  rebuild();
}
function rebuild(): void {
  root.dataset.mode = mode;
  $('#hd-fig').textContent = mode === 'cmp' ? '比較' : '照合の手順';
  buildRace();
  if (mode === 'cmp') buildRank();
  if (mode === 'list') buildList();
  syncInputs();
  draw();
}
function setPreset(k: number): void {
  const p = PRESETS[k];
  pat = p.pat;
  text = p.text;
  rep = p.rep;
  flags = '';
  for (const [key, v] of [
    ['pat', pat],
    ['text', text],
    ['rep', rep],
    ['flags', flags],
  ])
    store(key, v);
  syncInputs();
  reanalyze();
}
function setEngine(id: EngineId): void {
  eng = id;
  store('eng', id);
  setPlay(false);
  step = 0;
  one = null;
  rebuild();
}
function changeMode(m: Mode): void {
  if (!booted) return;
  mode = m;
  setPlay(false);
  step = 0;
  rebuild();
  if (m === 'list' && matchMedia('(max-width:999.98px)').matches)
    $('.a-mat').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
}
const figTop = () => $('.a-fig').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
/** 一致を押すと、その一致を探し始めた所から再生する */
function jumpTo(k: number): void {
  const m = A.matches[k];
  if (!m) return;
  sel = k;
  if (mode !== 'one') {
    mode = 'one';
    modeCh.choose('one');
  }
  renderMatches();
  rebuild();
  const r = runOf();
  if (!r.unsup) {
    const at = r.fr.findIndex(
      (f) => (f.k === 'start' && f.st === m.s) || (f.th !== undefined && f.k !== 'build' && f.pos === m.s),
    );
    seekTo(Math.max(0, at));
    setPlay(true);
  }
  figTop();
}

let tm = 0;
const later = (f: () => void) => {
  clearTimeout(tm);
  tm = window.setTimeout(f, 160);
};
patIn.addEventListener('input', () => {
  pat = patIn.value;
  store('pat', pat);
  later(reanalyze);
});
textIn.addEventListener('input', () => {
  text = textIn.value;
  store('text', text);
  later(reanalyze);
});
repIn.addEventListener('input', () => {
  rep = repIn.value;
  store('rep', rep);
  renderMatches();
});
$('#rx-smp').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-p]');
  if (b) setPreset(Number(b.dataset.p));
});
$('#rx-flags').addEventListener('click', (e) => {
  const f = (e.target as Element).closest<HTMLElement>('[data-f]')?.dataset.f;
  if (!f) return;
  flags = flags.includes(f) ? flags.replace(f, '') : [...flags, f].sort().join('');
  store('flags', flags);
  syncInputs();
  reanalyze();
});
$('#rx-eng').addEventListener('click', (e) => {
  const v = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (v) setEngine(v as EngineId);
});
$('#rx-mt').addEventListener('click', (e) => {
  const r = (e.target as Element).closest<HTMLElement>('tr[data-m]');
  if (r) jumpTo(Number(r.dataset.m));
});
$('#rx-hl').addEventListener('click', (e) => {
  const r = (e.target as Element).closest<HTMLElement>('mark[data-m]');
  if (r) jumpTo(Number(r.dataset.m));
});
$('#rx-lt').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b) return;
  const narrow = matchMedia('(max-width:999.98px)').matches;
  if (b.classList.contains('rx-lh')) {
    setPreset(Number(b.dataset.p));
    mode = 'cmp';
    modeCh.choose('cmp');
    rebuild();
    setPlay(true);
    figTop();
    return;
  }
  const id = b.dataset.e as EngineId | undefined;
  if (b.dataset.p !== undefined) {
    const k = Number(b.dataset.p);
    if (PRESETS[k].pat !== pat || PRESETS[k].text !== text) setPreset(k);
  }
  if (id) setEngine(id);
  setPlay(true);
  if (narrow) figTop();
});

/* ---------- 再生の操作 ---------- */
$('#tp-pp').addEventListener('click', () => {
  if (playing) {
    setPlay(false);
    return;
  }
  if (step >= maxStep()) seekTo(0);
  setPlay(true);
});
$('#tp-home').addEventListener('click', () => {
  setPlay(false);
  seekTo(0);
});
$('#tp-step').addEventListener('click', () => {
  setPlay(false);
  seekTo(step + 1);
});
$('#tp-back').addEventListener('click', () => {
  setPlay(false);
  seekTo(step - 1);
});
const trk = $('#tp-trk');
const trkAt = (e: PointerEvent): number => {
  const b = trk.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - b.left) / Math.max(1, b.width))) * maxStep();
};
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  setPlay(false);
  seekTo(trkAt(e));
});
trk.addEventListener('pointermove', (e) => {
  if (trk.hasPointerCapture(e.pointerId)) seekTo(trkAt(e));
});
trk.addEventListener('keydown', (e) => {
  const big = Math.max(1, Math.round(maxStep() / 20)),
    to = {
      ArrowLeft: step - 1,
      ArrowDown: step - 1,
      ArrowRight: step + 1,
      ArrowUp: step + 1,
      PageDown: step - big,
      PageUp: step + big,
      Home: 0,
      End: maxStep(),
    }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  setPlay(false);
  seekTo(to);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPlay(false);
});

/* ---------- 起動 ---------- */
readColors();
buildHow();
const recolor = () => {
  readColors();
  draw();
  drawHow();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  if (!booted) return;
  draw();
  drawHow();
}).observe(root);
new IntersectionObserver((es) => {
  howSeen = es.some((e) => e.isIntersecting);
  howRun();
}).observe($('#rx-how'));
/* 保存した値を戻したあと（マイクロタスク）に組み立てる */
queueMicrotask(() => {
  booted = true;
  mode = modeCh.value;
  renderMatches();
  rebuild();
  drawHow();
});

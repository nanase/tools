/**
 * ソートのページの入口。データとアルゴリズムの手順を先に記録し、再生で 1 回ずつ棒グラフと音へ出す。
 * 表示は 単独（棒グラフ 1 枚）・比較（最大 9 個を同時に）・一覧（棒グラフと組み合わせの表）の 3 つ
 */
import { bigO } from '../../lib/big-o';
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { store, stored, storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { ALGS, algOf, findAlg } from './algorithms';
import { type Scale, SortAudio, TONE_MAX, type Wave } from './audio';
import { type DataKind, DISTS, type Dist, distName, gen, resample } from './data';
import { drawAux, drawBars, readColors, type Shown } from './fig';
import { type Key, SIZE, SPEED, VOL } from './params';
import { countOps, LIM_CMP, LIM_PLAY, type Result, Run, ranks, type ToneKind } from './run';

initToolPage();

type Mode = 'one' | 'cmp' | 'list';
type Axis = 'alg' | 'data';
type Metric = 'total' | 'cmp' | 'mv';

const MAX_CMP = 9;
const DEF_RACE = ['bubble', 'insertion', 'shell', 'heap', 'merge', 'quick-med'];
const DEF_RACE_D: Dist[] = ['random', 'nearly', 'sorted', 'reversed', 'center', 'few'];
const isDist = (v: unknown): v is Dist => DISTS.some((d) => d[0] === v);
const fmt = (v: number): string => v.toLocaleString('en-US');

/* ---------- 状態 ---------- */
const root = $('#so');
const audio = new SortAudio();
let alg = findAlg(String(stored('alg')))?.id ?? 'quick-last';
let dist: DataKind = stored('dist') === 'draw' ? 'draw' : isDist(stored('dist')) ? (stored('dist') as Dist) : 'random';
let race = loadList(stored('race'), (v) => !!findAlg(v), DEF_RACE);
let raceD = loadList(stored('raceD'), isDist, DEF_RACE_D) as Dist[];
let drawn: number[] | null = Array.isArray(stored('drawn')) ? (stored('drawn') as number[]) : null;
const kinds: Record<ToneKind, boolean> = { c: true, r: true, w: true };
const show: Shown = { pivot: true, range: true, fix: true, info: true, aux: true };
let n = SIZE.v;
let rate = SPEED.v;
let seed = 1;
let focus = 0;
let booted = false;

function loadList<T extends string>(v: unknown, ok: (x: string) => boolean, def: readonly T[]): T[] {
  if (!Array.isArray(v)) return [...def];
  const a = v.filter((x): x is T => typeof x === 'string' && ok(x)).slice(0, MAX_CMP);
  return a.length ? a : [...def];
}

let runs: Run[] = [];
let playing = false;
let sweeping = false;
let acc = 0;
let last = 0;
let raf = 0;
let dirty = false;

/* ---------- 選択肢 ---------- */
const modeCh = new Choice<Mode>($('#so-mode'), (m) => changeMode(m));
const axisCh = new Choice<Axis>($('#so-axis'), (v) => changeAxis(v));
const metricCh = new Choice<Metric>($('#so-metric'), () => fillTable());
const waveCh = new Choice<Wave>($('#p-wave'), (v) => {
  audio.wave = v;
});
const scaleCh = new Choice<Scale>($('#p-scale'), (v) => {
  audio.scale = v;
});
let mode: Mode = modeCh.value;
let axis: Axis = axisCh.value;
const pg = new ParamGroup<Key>([SPEED, SIZE, VOL], (v, k) => {
  rate = v.sp;
  audio.vol(v.vol);
  n = v.n;
  if (!booted) return;
  if (k === 'sp') paint();
  if (k === 'n') {
    build();
    fillTable();
  }
});

/* ---------- データと実行 ---------- */
function dataOf(k: DataKind): number[] {
  if (k !== 'draw') return gen(k, n, seed);
  if (!drawn?.length) drawn = gen('organ', n, seed);
  else if (drawn.length !== n) drawn = resample(drawn, n);
  return drawn;
}
const byData = (): boolean => mode === 'cmp' && axis === 'data';

function build(): void {
  setPlay(false);
  if (byData()) {
    runs = raceD.map((d) => {
      const r = new Run(algOf(alg), gen(d, n, seed), LIM_CMP);
      r.label = distName(d);
      return r;
    });
  } else if (mode === 'cmp') {
    const src = dataOf(dist);
    runs = race.map((id) => new Run(algOf(id), src, LIM_CMP));
  } else runs = [new Run(algOf(alg), dataOf(dist), LIM_PLAY)];
  if (focus >= runs.length) focus = 0;
  acc = 0;
  sweeping = false;
  if (mode === 'cmp') buildCells();
  syncAll();
  paint();
}
const maxTotal = (): number => runs.reduce((m, r) => Math.max(m, r.total), 0);
const curPos = (): number => runs.reduce((m, r) => Math.max(m, r.pos), 0);
const allDone = (): boolean => runs.every((r) => r.done);

/* ---------- 再生 ---------- */
function setPlay(on: boolean): void {
  playing = on;
  const b = $('#tp-pp'),
    t = on ? '一時停止' : '再生';
  b.classList.toggle('on', on);
  b.title = t;
  b.setAttribute('aria-label', t);
  if (on) {
    audio.ready();
    last = performance.now();
    kick();
  }
  syncStatus();
}
function kick(): void {
  if (!raf) raf = requestAnimationFrame(tick);
}
/** 次のコマで描き直す */
function paint(): void {
  dirty = true;
  kick();
}
function stepSweep(r: Run, dt: number, audible: boolean): void {
  const from = Math.floor(r.sweep);
  r.sweep = Math.min(r.n, r.sweep + Math.max(1, (r.n / 0.9) * dt));
  if (audible) {
    const list: number[] = [];
    for (let i = from; i < Math.floor(r.sweep); i++) list.push(r.a[i]);
    audio.play(list, r.vm, dt, 0.05, 3);
  }
  if (r.sweep >= r.n) {
    r.sweep = -1;
    r.ok = true;
    r.ti = [];
    r.tk = [];
  }
  dirty = true;
}
function advance(dt: number): void {
  acc += rate * dt;
  const k = Math.floor(acc);
  if (k <= 0) return;
  acc -= k;
  const stride = Math.max(1, Math.floor(k / TONE_MAX)),
    dur = Math.min(0.22, Math.max(0.028, 1.8 / rate));
  runs.forEach((r, idx) => {
    if (r.done) return;
    r.ti = [];
    r.tk = [];
    const list: number[] = [],
      heard = idx === focus,
      add = (v: number, kd: ToneKind) => {
        if (kinds[kd]) list.push(v);
      };
    for (let i = 0; i < k && !r.done; i++) r.step(heard && i % stride === 0 ? add : null, i >= k - 6);
    if (heard) audio.play(list, r.vm, dt, dur);
    if (r.done && !r.trunc) r.sweep = 0;
  });
  dirty = true;
  if (allDone()) {
    sweeping = runs.some((r) => r.sweep >= 0);
    if (!sweeping) setPlay(false);
  }
}
function tick(now: number): void {
  raf = 0;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (playing) {
    if (!sweeping) advance(dt);
    /* 先に終わった組も確かめる */
    runs.forEach((r, idx) => {
      if (r.sweep >= 0 && !r.ok) stepSweep(r, dt, sweeping && idx === focus);
    });
    if (sweeping && runs.every((r) => r.sweep < 0)) {
      sweeping = false;
      setPlay(false);
    }
  }
  if (dirty) {
    dirty = false;
    draw();
  }
  if (playing) kick();
}
function resetRuns(): void {
  for (const r of runs) r.reset();
  sweeping = false;
  acc = 0;
  paint();
}
function seekTo(p: number): void {
  for (const r of runs) r.seek(p);
  sweeping = false;
  syncStatus();
  paint();
}

/* ---------- 描く ---------- */
const mainCv = $<HTMLCanvasElement>('#so-main'),
  auxCv = $<HTMLCanvasElement>('#so-aux');
function draw(): void {
  if (!runs.length) return;
  if (mode === 'cmp') {
    $$('.so-cell').forEach((el, i) => {
      const r = runs[i];
      if (!r) return;
      drawBars($<HTMLCanvasElement>('canvas', el), r, show, true);
      $('em', el).textContent = fmt(r.pos);
    });
    syncRanks();
  } else {
    const r = runs[0],
      showAux = r.auxN > 0 && show.aux;
    if (auxCv.hidden === showAux) auxCv.hidden = !showAux;
    drawBars(mainCv, r, show, false);
    if (showAux) drawAux(auxCv, r);
    const c = r.c;
    $('#o-t').textContent = fmt(c.cmp + c.swap + c.read + c.write);
    $('#o-c').textContent = fmt(c.cmp);
    $('#o-s').textContent = fmt(c.swap);
    $('#o-r').textContent = fmt(c.read);
    $('#o-w').textContent = fmt(c.write);
  }
  syncTrack();
  syncStatus();
}
const mmss = (v: number): string => {
  const s = Math.floor(v);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function syncTrack(): void {
  const tot = maxTotal(),
    p = curPos(),
    pc = `${((tot ? p / tot : 0) * 100).toFixed(2)}%`,
    trk = $('#tp-trk');
  $('#tp-fill').style.width = pc;
  $('#tp-th').style.left = pc;
  $('#tp-a').textContent = fmt(p);
  $('#tp-b').textContent = fmt(tot);
  $('#tp-t').textContent = tot / rate < 0.1 ? '' : `${mmss(p / rate)} / ${mmss(tot / rate)}`;
  trk.setAttribute('aria-valuemax', String(tot));
  trk.setAttribute('aria-valuenow', String(p));
  trk.setAttribute('aria-valuetext', `${fmt(p)} / ${fmt(tot)} 回`);
}
function syncStatus(): void {
  if (!runs.length) return;
  const led = $('#so-led'),
    t = $('#so-stT'),
    p = curPos(),
    end = allDone(),
    ok = runs.every((r) => r.ok),
    cut = end && runs.some((r) => r.trunc),
    busy = playing || sweeping,
    txt = busy ? '実行中' : ok ? '完了' : cut ? '打ち切り' : p > 0 ? '一時停止中' : '';
  led.className = `led${busy ? ' on' : ok ? ' so-ok' : txt ? ' half' : ''}`;
  if (t.textContent !== txt) t.textContent = txt;
  $('#so-st').hidden = !txt;
}

/* ---------- 見出しと選択の表示 ---------- */
function syncAll(): void {
  root.dataset.mode = mode;
  $('#hd-fig').textContent = mode === 'cmp' && !byData() ? 'アルゴリズムの比較' : algOf(alg).f;
  $('#hd-alg').textContent = mode === 'cmp' && !byData() ? `アルゴリズム（${MAX_CMP} 種まで）` : 'アルゴリズム';
  $('#hd-data').textContent = byData() ? `データ（${MAX_CMP} 種まで）` : 'データ';
  $('#so-an').textContent = mode === 'cmp' && !byData() ? `${race.length} / ${MAX_CMP}` : `${ALGS.length} 種`;
  root.classList.toggle('so-drawing', dist === 'draw' && mode === 'one');
  const multi = mode === 'cmp' && !byData();
  for (const b of $$<HTMLButtonElement>('#so-algs [data-v]'))
    b.setAttribute('aria-pressed', String(multi ? race.includes(b.dataset.v ?? '') : b.dataset.v === alg));
  for (const b of $$<HTMLButtonElement>('#so-dists [data-v]')) {
    const v = b.dataset.v as DataKind;
    b.setAttribute('aria-pressed', String(byData() ? raceD.includes(v as Dist) : v === dist));
    b.disabled = byData() && v === 'draw';
  }
  syncLegend();
  syncAlgInfo();
  syncTableSel();
  if (mode === 'cmp') buildRank();
  syncStatus();
}
function syncLegend(): void {
  const cmp = mode === 'cmp',
    r = runs[0],
    a = r.alg,
    u = r.used,
    items: [keyof Shown, string | false | undefined][] = [
      ['pivot', u.pivot && (a.pv ?? 'ピボット')],
      ['range', u.range && (a.rg ?? '範囲')],
      ['fix', u.fix && '確定'],
      ['info', u.info && a.inf],
      ['aux', u.aux && '補助配列'],
    ];
  for (const [k, label] of items) {
    const b = $(`#so-t-${k}`);
    b.hidden = cmp || !label;
    if (label) $('span', b).textContent = label;
  }
  $('#so-axis').hidden = !cmp;
}
function syncAlgInfo(): void {
  const a = algOf(alg);
  $('#o-b').innerHTML = bigO(a.b);
  $('#o-av').innerHTML = bigO(a.a);
  $('#o-wc').innerHTML = bigO(a.w);
  $('#o-mm').innerHTML = bigO(a.m);
  $('#o-st').textContent = a.st ? '安定' : '不安定';
}

/* ---------- 比較 ---------- */
function buildCells(): void {
  const host = $('#so-race'),
    m = runs.length;
  host.style.setProperty('--cols', String(m <= 1 ? 1 : m <= 4 ? 2 : 3));
  host.textContent = '';
  runs.forEach((r, i) => {
    const b = document.createElement('button'),
      head = document.createElement('div'),
      led = document.createElement('span'),
      name = document.createElement('span'),
      em = document.createElement('em'),
      cv = document.createElement('canvas');
    b.type = 'button';
    b.className = 'so-cell';
    b.setAttribute('aria-pressed', String(i === focus));
    head.className = 'so-ch';
    led.className = `led${i === focus ? ' on' : ''}`;
    led.setAttribute('aria-hidden', 'true');
    name.className = 'so-cn';
    name.textContent = r.label;
    em.textContent = '0';
    head.append(led, name, em);
    b.append(head, cv);
    b.addEventListener('click', () => {
      focus = i;
      audio.ready();
      $$('.so-cell', host).forEach((c, k) => {
        c.setAttribute('aria-pressed', String(k === i));
        $('.led', c).classList.toggle('on', k === i);
      });
    });
    host.append(b);
  });
}
const runRanks = () => ranks(runs.map((r) => r.total));
function buildRank(): void {
  const rk = runRanks(),
    rows = runs
      .map((r, i) => ({ r, rank: rk[i] }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ r, rank }) => {
        const c = r.final;
        return `<tr><td>${rank}</td><td class="l">${r.label}</td><td><b>${fmt(r.total)}${r.trunc ? '+' : ''}</b></td><td>${fmt(c.cmp)}</td><td>${fmt(c.swap)}</td><td>${fmt(c.read)}</td><td>${fmt(c.write)}</td></tr>`;
      })
      .join('');
  $('#so-rt').innerHTML =
    `<thead><tr><th>順位</th><th class="l">名前</th><th>全操作</th><th>比較</th><th>交換</th><th>読み取り</th><th>書き込み</th></tr></thead><tbody>${rows}</tbody>`;
}
function syncRanks(): void {
  const rank = runRanks();
  $$('.so-cell').forEach((el, i) => {
    const head = $('.so-ch', el),
      ok = runs[i]?.ok;
    let rk = head.querySelector<HTMLElement>('.so-rk');
    if (ok && !rk) {
      rk = document.createElement('span');
      rk.className = 'so-rk';
      head.insertBefore(rk, $('em', head));
    } else if (!ok && rk) rk.remove();
    if (ok && rk) rk.textContent = String(rank[i]);
  });
}

/* ---------- 表示の切り替え ---------- */
/** 比較で聞いていた組を、単独と一覧へ持ち越す */
function carryFocus(): void {
  if (mode !== 'cmp' || !runs[focus]) return;
  if (axis === 'alg') setAlg(runs[focus].alg.id);
  else setDist(raceD[focus]);
}
/** 単独で選んでいた組を比較に入れて、その音を聞く */
function includeCurrent(): void {
  if (axis === 'alg') {
    if (!race.includes(alg)) {
      race.unshift(alg);
      if (race.length > MAX_CMP) race.pop();
      store('race', race);
    }
    focus = race.indexOf(alg);
  } else {
    if (dist !== 'draw' && !raceD.includes(dist)) {
      raceD.unshift(dist);
      if (raceD.length > MAX_CMP) raceD.pop();
      store('raceD', raceD);
    }
    focus = Math.max(0, raceD.indexOf(dist as Dist));
  }
}
function setAlg(id: string): void {
  alg = id;
  store('alg', id);
}
function setDist(k: DataKind): void {
  dist = k;
  store('dist', k);
}
function changeMode(m: Mode): void {
  if (!booted) return;
  carryFocus();
  mode = m;
  if (m === 'cmp') includeCurrent();
  applyMode();
}
function changeAxis(v: Axis): void {
  if (!booted) return;
  carryFocus();
  axis = v;
  includeCurrent();
  build();
}
function applyMode(): void {
  if (mode === 'list' && dist === 'draw') setDist('random');
  root.dataset.mode = mode;
  build();
  fillTable();
}

/* ---------- アルゴリズムとデータの選択 ---------- */
$('#so-algs').addEventListener('click', (e) => {
  const id = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (!id) return;
  if (mode === 'cmp' && axis === 'alg') {
    const i = race.indexOf(id);
    if (i >= 0) {
      if (race.length > 1) race.splice(i, 1);
    } else if (race.length < MAX_CMP) race.push(id);
    else return;
    store('race', race);
    build();
    return;
  }
  const was = playing;
  setAlg(id);
  build();
  if (was) setPlay(true);
});
$('#so-dists').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-v]');
  if (!b || b.disabled) return;
  const k = b.dataset.v as DataKind;
  if (byData()) {
    const i = raceD.indexOf(k as Dist);
    if (i >= 0) {
      if (raceD.length > 1) raceD.splice(i, 1);
    } else raceD.push(k as Dist);
    store('raceD', raceD);
    build();
    return;
  }
  const was = playing;
  setDist(k);
  build();
  if (was) setPlay(true);
});
$('#so-new').addEventListener('click', () => {
  const was = playing;
  seed++;
  if (dist === 'draw') {
    drawn = null;
    store('drawn', null);
  }
  build();
  fillTable();
  if (was) setPlay(true);
});

/* ---------- 手描き ---------- */
function bindDraw(): void {
  let on = false,
    pi = -1,
    pv = 0;
  const paintAt = (e: PointerEvent) => {
    const b = mainCv.getBoundingClientRect(),
      i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - b.left) / b.width) * n))),
      v = Math.max(1, Math.min(n, Math.round((1 - (e.clientY - b.top) / b.height) * n))),
      a = drawn as number[];
    if (pi < 0) a[i] = v;
    else {
      const s = Math.sign(i - pi) || 1;
      for (let k = pi; k !== i + s; k += s) a[k] = Math.round(pv + ((v - pv) * (k - pi)) / (i - pi || 1));
    }
    pi = i;
    pv = v;
    runs[0].a = Int32Array.from(a);
    paint();
  };
  mainCv.addEventListener('pointerdown', (e) => {
    if (dist !== 'draw' || mode !== 'one') return;
    e.preventDefault();
    setPlay(false);
    runs[0].reset();
    on = true;
    pi = -1;
    mainCv.setPointerCapture(e.pointerId);
    paintAt(e);
  });
  mainCv.addEventListener('pointermove', (e) => {
    if (on) paintAt(e);
  });
  const end = () => {
    if (!on) return;
    on = false;
    store('drawn', drawn);
    build();
  };
  mainCv.addEventListener('pointerup', end);
  mainCv.addEventListener('pointercancel', end);
}
bindDraw();

/* ---------- 組み合わせの表 ---------- */
const results = new Map<string, Result>();
const resultOf = (id: string, d: Dist): Result => {
  const k = `${n}:${seed}:${id}:${d}`;
  let r = results.get(k);
  if (!r) {
    r = countOps(algOf(id), gen(d, n, seed));
    results.set(k, r);
  }
  return r;
};
const compact = (v: number): string =>
  v < 1000
    ? String(v)
    : v < 10000
      ? `${(v / 1000).toFixed(2)}k`
      : v < 100000
        ? `${(v / 1000).toFixed(1)}k`
        : v < 1e6
          ? `${Math.round(v / 1000)}k`
          : `${(v / 1e6).toFixed(2)}M`;
const metricOf = (r: Result): number =>
  metricCh.value === 'cmp' ? r.c.cmp : metricCh.value === 'mv' ? r.c.swap + r.c.write : r.total;
function paintCell(b: HTMLElement, r: Result): void {
  const lo = Math.log(Math.max(2, n / 2)),
    hi = Math.log(Math.max(4, n * n)),
    t = r.trunc ? 1 : Math.max(0, Math.min(1, (Math.log(Math.max(1, metricOf(r))) - lo) / (hi - lo))),
    pc = Math.round(t * t * 72);
  b.textContent = r.trunc ? `>${compact(r.total)}` : compact(metricOf(r));
  b.classList.toggle('cut', r.trunc);
  b.style.background = `color-mix(in srgb,var(--ink) ${pc}%,transparent)`;
  b.style.color = pc > 42 ? 'var(--surface)' : 'var(--ink)';
}
let fillTok = 0;
/** 計算が重いので、少しずつ埋める */
function fillTable(): void {
  if (mode !== 'list') return;
  const tok = ++fillTok,
    cells = $$('.so-c');
  let i = 0;
  const work = () => {
    if (tok !== fillTok) return;
    const t0 = performance.now();
    while (i < cells.length && performance.now() - t0 < 12) {
      const b = cells[i++];
      paintCell(b, resultOf(b.dataset.a as string, b.dataset.d as Dist));
    }
    if (i < cells.length) setTimeout(work, 0);
  };
  work();
}
function syncTableSel(): void {
  for (const b of $$('.so-c.sel')) b.classList.remove('sel');
  document.querySelector(`.so-c[data-a="${alg}"][data-d="${dist}"]`)?.classList.add('sel');
}
const figTop = () => $('.a-fig').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
function toCompare(): void {
  focus = 0;
  mode = 'cmp';
  modeCh.choose('cmp');
  axisCh.choose(axis);
  applyMode();
  figTop();
  setPlay(true);
}
$('#so-tb').addEventListener('click', (e) => {
  const t = e.target as Element,
    row = t.closest<HTMLElement>('.so-mr'),
    col = t.closest<HTMLElement>('.so-mh'),
    cell = t.closest<HTMLElement>('.so-c');
  if (row) {
    setAlg(row.dataset.a as string);
    raceD = DISTS.map((d) => d[0]);
    store('raceD', raceD);
    axis = 'data';
    toCompare();
  } else if (col) {
    const d = col.dataset.d as Dist,
      best = ALGS.map((a) => ({ id: a.id, r: resultOf(a.id, d) }))
        .filter((x) => !x.r.trunc)
        .sort((p, q) => metricOf(p.r) - metricOf(q.r))
        .slice(0, 6)
        .map((x) => x.id);
    race = best;
    store('race', race);
    setAlg(best[0]);
    setDist(d);
    axis = 'alg';
    toCompare();
  } else if (cell) {
    setAlg(cell.dataset.a as string);
    setDist(cell.dataset.d as Dist);
    build();
    if (matchMedia('(max-width:999.98px)').matches) figTop();
    setPlay(true);
  }
});

/* ---------- 再生の操作 ---------- */
$('#tp-pp').addEventListener('click', () => {
  if (playing) {
    setPlay(false);
    return;
  }
  if (allDone()) resetRuns();
  setPlay(true);
});
$('#tp-home').addEventListener('click', () => {
  resetRuns();
  syncStatus();
});
$('#tp-step').addEventListener('click', () => {
  setPlay(false);
  audio.ready();
  runs.forEach((r, i) => {
    if (r.done) return;
    r.ti = [];
    r.tk = [];
    const list: number[] = [];
    r.step(
      i === focus
        ? (v, kd) => {
            if (kinds[kd]) list.push(v);
          }
        : null,
      true,
    );
    audio.play(list, r.vm, 0.02, 0.1);
  });
  syncStatus();
  paint();
});
$('#tp-back').addEventListener('click', () => {
  setPlay(false);
  seekTo(curPos() - 1);
});
const trk = $('#tp-trk');
const trkAt = (e: PointerEvent): number => {
  const b = trk.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - b.left) / Math.max(1, b.width))) * maxTotal();
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
  const big = Math.max(1, Math.round(maxTotal() / 50)),
    p = curPos(),
    to = {
      ArrowLeft: p - 1,
      ArrowDown: p - 1,
      ArrowRight: p + 1,
      ArrowUp: p + 1,
      PageDown: p - big,
      PageUp: p + big,
      Home: 0,
      End: maxTotal(),
    }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  setPlay(false);
  seekTo(to);
});

/* ---------- 音と表示の切り替え ---------- */
$('#so-snd').addEventListener('click', () => {
  audio.on = !audio.on;
  $('#so-snd').setAttribute('aria-pressed', String(audio.on));
  $('#so-sndL').classList.toggle('on', audio.on);
  $('#so-sndT').textContent = audio.on ? 'オン' : 'オフ';
});
storeToggle($('#so-snd'));
const savedKinds = stored('kinds');
if (Array.isArray(savedKinds)) for (const k of Object.keys(kinds) as ToneKind[]) kinds[k] = savedKinds.includes(k);
for (const b of $$('#so-kinds [data-v]')) {
  const k = b.dataset.v as ToneKind;
  b.setAttribute('aria-pressed', String(kinds[k]));
  b.addEventListener('click', () => {
    kinds[k] = !kinds[k];
    b.setAttribute('aria-pressed', String(kinds[k]));
    store(
      'kinds',
      (Object.keys(kinds) as ToneKind[]).filter((x) => kinds[x]),
    );
  });
}
for (const k of Object.keys(show) as (keyof Shown)[]) {
  const b = $(`#so-t-${k}`);
  b.addEventListener('click', () => {
    show[k] = !show[k];
    b.setAttribute('aria-pressed', String(show[k]));
    paint();
  });
  storeToggle(b);
}

autoPause(audio, {
  pause: () => setPlay(false),
  hidden: () => setPlay(false),
});

/* ---------- 起動 ---------- */
readColors();
const recolor = () => {
  readColors();
  paint();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => paint()).observe(root);
/* 保存した値を戻したあと（マイクロタスク）に組み立てる */
queueMicrotask(() => {
  booted = true;
  mode = modeCh.value;
  axis = axisCh.value;
  audio.wave = waveCh.value;
  audio.scale = scaleCh.value;
  const v = pg.values();
  rate = v.sp;
  n = v.n;
  audio.vol(v.vol);
  if (mode === 'cmp') includeCurrent();
  applyMode();
});

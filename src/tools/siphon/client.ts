/**
 * サイフォンのページの入口。開いた直後から選んだ例が動き、毎フレーム模型を進めて断面図とグラフを描き直す。
 * 動きを減らす設定のときは停止した状態で開く
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { drawScene, drawTime, dur, len, qConv, readCols, status } from './fig';
import type { Siphon } from './model';
import { PARAMS } from './params';
import { type PKey, SCENES, type Scene, sceneOf } from './scenes';
import { DEFAULTS, makeSim, rebuild, retune, run, start, type Vals } from './sim';

initToolPage();

const root = $('#sf');
/** 形が変わる行（変えたら模型を作り直す） */
const SHAPE = new Set<PKey>(['kst', 'kd', 'atip', 'ad', 'cc', 'ht']);
const st = {
  sc: SCENES[0] as Scene,
  S: null as unknown as Siphon,
  v: { ...DEFAULTS } as Vals,
  run: !RM.matches,
  speed: {} as Record<string, number>,
  pour: true,
  phase: 0,
};
const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};
const num = (x: number, n = 3) =>
  Math.abs(x) < 1e-12 ? '0' : Number(x.toPrecision(n)).toLocaleString('ja-JP', { maximumFractionDigits: 3 });

/* ---------- 再生 ---------- */
const pp = $<HTMLButtonElement>('#sf-pp');
function syncRun(): void {
  pp.classList.toggle('on', st.run);
  pp.title = st.run ? '一時停止' : '再生';
  pp.setAttribute('aria-label', pp.title);
  $('#sf-led').classList.toggle('on', st.run);
  txt('#sf-st', st.run ? '再生中' : '停止中');
}
pp.addEventListener('click', () => {
  st.run = !st.run;
  syncRun();
});
$('#sf-home').addEventListener('click', () => {
  st.S = start(st.sc.id, st.v, st.pour);
  draw();
});
const spBox = $('#sf-sp');
function buildSpeed(): void {
  const sc = st.sc,
    cur = st.speed[sc.id] ?? sc.speed;
  spBox.innerHTML = sc.speeds
    .map(
      (x) =>
        `<button type="button" data-v="${x}" aria-pressed="${x === cur}">${x < 1 ? `1/${1 / x} 倍` : x === 1 ? '実時間' : `${x.toLocaleString('ja-JP')} 倍`}</button>`,
    )
    .join('');
}
spBox.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (!b) return;
  st.speed[st.sc.id] = Number(b.dataset.v);
  for (const q of $$('button', spBox)) q.setAttribute('aria-pressed', String(q === b));
});

/* ---------- 操作のボタン ---------- */
const acts = $('#sf-acts');
function buildActs(): void {
  acts.innerHTML = st.sc.acts
    .map(
      ([k, n]) =>
        `<button type="button" class="chip sf-act" data-k="${k}"${k === 'pour' ? ` aria-pressed="${st.pour}"` : ''}>${n}</button>`,
    )
    .join('');
  acts.hidden = !st.sc.acts.length;
}
acts.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-k]');
  if (!b) return;
  const S = st.S;
  switch (b.dataset.k) {
    case 'prime':
      S.prime();
      break;
    case 'stop':
      S.breakAir();
      break;
    case 'flush':
      S.flush();
      break;
    case 'pour':
      st.pour = !st.pour;
      b.setAttribute('aria-pressed', String(st.pour));
      retune(S, st.sc, st.v, st.pour);
      break;
  }
  draw();
});

/* ---------- 入力 ---------- */
let booted = false;
const params = new ParamGroup<PKey>(PARAMS, (v) => {
  const old = st.v;
  st.v = { ...v };
  if (!booted) return;
  const shape = st.sc.rows.some((k) => SHAPE.has(k) && old[k] !== v[k]);
  st.S = shape ? rebuild(st.S, st.sc, st.v, st.pour) : st.S;
  retune(st.S, st.sc, st.v, st.pour);
  draw();
});
function showRows(): void {
  for (const d of PARAMS) $(`#p-${d.k}`).hidden = !st.sc.rows.includes(d.k);
}

/* ---------- 例の選択 ---------- */
const exBox = $('#sf-ex');
function thumbs(): void {
  for (const b of $$<HTMLButtonElement>('.sf-exb', exBox)) {
    const sc = sceneOf(b.dataset.v ?? ''),
      cv = $<HTMLCanvasElement>('canvas', b),
      r = devicePixelRatio || 1,
      w = cv.clientWidth || 70,
      h = cv.clientHeight || 44;
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
    const g = cv.getContext('2d');
    if (!g) continue;
    g.setTransform(r, 0, 0, r, 0, 0);
    const S = makeSim(sc, DEFAULTS);
    if (sc.group === 'nature') {
      S.v1 = S.src.cap * 0.55;
      S.step(0);
    }
    if (sc.id !== 'cup' && sc.id !== 'toilet') S.prime();
    drawScene(g, sc, S, DEFAULTS, w, h, { small: true, pour: false });
  }
}
function select(id: string): void {
  st.sc = sceneOf(id);
  st.S = start(id, st.v, st.pour);
  txt('#sf-note', st.sc.note);
  txt('#sf-liq', id === 'kerosene' ? '灯油' : '水');
  $('#sf-cv').classList.toggle('sf-tall', id === 'height');
  buildSpeed();
  buildActs();
  showRows();
  metricsFrame();
  draw();
}
const ex = new Choice<string>(exBox, (id) => select(id));

/* ---------- 計算結果 ---------- */
type Row = [string, string, string];
function metricRows(): Row[] {
  const S = st.S,
    sc = st.sc,
    [qk, qu] = qConv(sc.qUnit),
    rows: Row[] = [['流量', num(S.q * qk), qu]];
  const dp = S.patm - S.crestP(),
    h = len(Math.max(0, S.h1 - S.outRef)).split(' ');
  rows.push(
    ['頂上の負圧', S.full ? (dp / 1000).toFixed(dp < 10000 ? 2 : 1) : S.vapor ? '分断' : '—', S.full ? 'kPa' : ''],
    ['落差', h[0], h[1]],
  );
  if (sc.group === 'nature' || sc.id === 'cup') {
    const p = S.period(),
      b = S.bursts[S.bursts.length - 1],
      pd = p ? dur(p).split(' ') : ['—', ''];
    rows.push(['周期', pd[0], pd[1]]);
    rows.push([
      sc.id === 'cup' ? '1 回に抜けた量' : '1 回の量',
      b ? num(b.vol * (sc.id === 'cup' ? 1e6 : sc.id === 'periodic' ? 1 : 1)) : '—',
      b ? (sc.id === 'cup' ? 'mL' : 'm³') : '',
    ]);
    rows.push(['最大の流量', b ? num(b.peak * qk) : '—', b ? qu : '']);
  } else if (sc.id === 'toilet') {
    const b = S.bursts[S.bursts.length - 1];
    rows.push(
      ['1 回に流れた水', b ? num(b.vol * 1000) : '—', b ? 'L' : ''],
      ['最大の流量', b ? num(b.peak * qk) : '—', b ? qu : ''],
    );
  } else if (sc.id === 'height')
    rows.push(['限界の高さ', S.lift.toFixed(2), 'm'], ['大気圧', (S.patm / 100).toFixed(0), 'hPa']);
  else rows.push(['移した量', num(S.out * 1000), 'L']);
  return rows;
}
function metricsFrame(): void {
  $('#sf-m').innerHTML = metricRows()
    .map(
      ([n], i) =>
        `<div class="m${i ? '' : ' m-main'}"><dt>${n}</dt><dd><span class="sf-v"></span><span class="u"></span></dd></div>`,
    )
    .join('');
}
function metrics(): void {
  const rows = metricRows(),
    box = $('#sf-m');
  if (box.children.length !== rows.length) metricsFrame();
  rows.forEach(([n, v, u], i) => {
    const el = box.children[i];
    if (!el) return;
    const dt = $('dt', el),
      vv = $('.sf-v', el),
      uu = $('.u', el);
    if (dt.textContent !== n) dt.textContent = n;
    if (vv.textContent !== v) vv.textContent = v;
    if (uu.textContent !== u) uu.textContent = u;
  });
}

/* ---------- 描画 ---------- */
const cv = $<HTMLCanvasElement>('#sf-cv'),
  tv = $<HTMLCanvasElement>('#sf-tv');
function surface(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = c.clientWidth,
    h = c.clientHeight;
  if (!w || !h) return null;
  const r = devicePixelRatio || 1;
  if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) {
    c.width = Math.round(w * r);
    c.height = Math.round(h * r);
  }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(r, 0, 0, r, 0, 0);
  return { g, w, h };
}
function draw(): void {
  const s = surface(cv);
  if (s) drawScene(s.g, st.sc, st.S, st.v, s.w, s.h, { phase: st.phase, pour: st.pour });
  const t = surface(tv);
  if (t) drawTime(t.g, st.sc, st.S, t.w, t.h);
  txt('#sf-t', `経過 ${dur(st.S.t)}`);
  txt('#sf-win', `直近 ${dur(st.sc.win)}`);
  $('#sf-tl-in').hidden = !st.S.hist.some((h) => h.qin > 0);
  metrics();
  const msg = status(st.S, st.sc);
  cv.setAttribute(
    'aria-label',
    `${st.sc.name}の断面図。${msg ? msg[0] : `流量 ${num(st.S.q * qConv(st.sc.qUnit)[0])} ${qConv(st.sc.qUnit)[1]}`}`,
  );
}

const recolor = () => {
  readCols(root);
  thumbs();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
addEventListener('resize', thumbs);

let last = 0;
function loop(now: number): void {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (st.run && dt > 0) {
    st.phase += dt * 2.5;
    run(st.S, st.sc, dt * (st.speed[st.sc.id] ?? st.sc.speed));
  }
  draw();
  requestAnimationFrame(loop);
}
recolor();
st.v = params.values();
booted = true;
select(ex.value || SCENES[0].id);
syncRun();
requestAnimationFrame(loop);

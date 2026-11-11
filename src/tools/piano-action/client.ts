/**
 * ピアノのアクションのページの入口: 打鍵と整調 → 動きの計算（Worker）→ 段階に分ける →
 * 段階のコマの絵・主の図・説明・段階のトランスポート・計算結果・段階の時間。
 * 再生は段階ごとに進め、自動ではどの段階も 1.5〜4 秒で見せる。打弦の瞬間に、ピアノ音響モデルの弦を鳴らす。
 * 鍵盤を押すとその場で計算して動かし（live.ts）、弾き終えた動きを段階の絵と再生に渡す
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { outVol } from '../../lib/play';
import { reserveHeight } from '../../lib/reserve';
import { ROOMS, reverbSpec } from '../../lib/reverb';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { PianoAudio } from '../piano/audio';
import { boardDesc } from '../piano/engine';
import { KEYS, makePiano, type PianoSpec } from '../piano/model';
import { KEY_LO, noteName, pianoTypeOf } from '../piano/strings';
import { ActionFig, DAMPER_N, damperLift, PART_TIP, type PartTip, type Ripple, thumbSvg } from './fig';
import { CONTACTS } from './geom';
import { LiveAction } from './live';
import { gp, pose, type Reg } from './model';
import { NOTE0, OCT, REGS, type RegKey, VOL0 } from './params';
import { FRAME, fnAt, gapAt, headSpeed, qAt, type Run, simulate, type TouchKind } from './sim';
import { D, type Events, events, NAME, type Stage, type StageId, type Strike, stages } from './stages';
import type { SimIn } from './worker';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const ms = (t: number, d = 1) => `${(t * 1000).toFixed(d)} ms`;

/* 段階が変わるたびに説明の行数が変わり、下の枠が動く。いちばん長い説明の高さを取っておく。
   見出しは番号の有無で 1 px 変わるので、番号ありとなしの両方で測る */
reserveHeight($('#cap-d'), Object.values(D));
reserveHeight(
  $('.cap h3'),
  Object.values(NAME).flatMap((n) => [
    `<span class="no">13</span><span>${esc(n)}</span>`,
    `<span class="no"></span><span>${esc(n)}</span>`,
  ]),
  { html: true },
);

/* ---------- 段階ごとの部品 ---------- */
/** 図で強調する部品 */
const FOCUS: Record<StageId, string[]> = {
  rest: [],
  acc: ['key', 'whippen', 'jack', 'hammer'],
  let: ['jack', 'hammer'],
  hit: ['hammer'],
  hit2: ['hammer', 'rep'],
  block: ['jack', 'hammer'],
  miss: ['jack', 'hammer'],
  chk: ['hammer', 'key'],
  half: ['rep', 'hammer', 'jack'],
  rep: ['jack', 'hammer', 'rep'],
  fail: ['jack', 'rep'],
  ret: ['rep', 'jack', 'damper', 'key'],
  rest2: [],
};
const BAD = new Set<StageId>(['hit2', 'block', 'miss', 'fail']);

/* ---------- 入力 ---------- */
const toReg = (v: Record<RegKey, number>): Reg => ({
  dip: v.dip / 1000,
  blow: v.blow / 1000,
  letoff: v.letoff / 1000,
  drop: v.drop / 1000,
  check: v.check / 1000,
  spring: v.spring / 100,
});
let reg: Reg;
/** 入力の部品を作り終えるまで（保存した値を戻す呼び出しの間）は計算しない */
let started = false;
const P = new ParamGroup<RegKey>(REGS, (v) => {
  reg = toReg(v);
  if (started) changed();
});
reg = toReg(P.values());
const touchCh = new Choice<TouchKind>($('#p-touch'), () => started && changed());
const spdCh = new Choice<string>($('#p-spd'));
const keySpd = new Choice<string>($('#p-kspd'));
/** 打鍵や整調を変えたら、弾いている途中でも打ち切って計算し直す */
function changed(): void {
  stopLive();
  request();
}

/* ---------- 計算（Worker。使えなければ主スレッド） ---------- */
let worker: Worker | null = null;
try {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
} catch {
  worker = null;
}
let seq = 0,
  reqTimer: ReturnType<typeof setTimeout> | undefined;
function request(): void {
  clearTimeout(reqTimer);
  reqTimer = setTimeout(() => {
    const m: SimIn = { id: ++seq, kind: touchCh.value, reg };
    $('#busy').hidden = false;
    if (worker) worker.postMessage(m);
    else setTimeout(() => setRun(simulate(m.kind, m.reg)), 0);
  }, 40);
}
worker?.addEventListener('message', (e: MessageEvent<{ id: number; run: Run }>) => {
  if (e.data.id === seq) setRun(e.data.run);
});

/* ---------- 状態 ---------- */
let run: Run | null = null,
  E: Events | null = null,
  L: Stage[] = [];
const S = { k: 1, u: 0.85, playing: false, loop: false, hl: 0 };
const fig = new ActionFig($<SVGSVGElement>('#a-svg'), $('#a-lab'));
/* 狭い画面では鍵の前を切る */
let narrow = false;
new ResizeObserver(([e]) => {
  const n = e.contentRect.width < 560;
  if (n !== narrow) {
    narrow = n;
    fig.setNarrow(n);
    draw();
  }
}).observe($('.awrap'));

/** コマの絵の時刻（段階の中の代表の時刻） */
function repT(s: Stage): number {
  const len = s.t1 - s.t0;
  if (s.id === 'let') return s.t0 + len * 0.6;
  if (s.id === 'hit' || s.id === 'hit2' || s.id === 'block') return s.t0 + Math.min(len * 0.5, 3e-4);
  if (s.id === 'rep' && E) {
    const s2 = E.strikes.find((x) => x.t > s.t0);
    if (s2) return Math.max(s.t0, s2.t - 1.5e-3);
  }
  return s.t0 + len * 0.85;
}

function setRun(R: Run): void {
  /* 弾いている間に届いた結果は、弾き終えてから使う */
  if (live) {
    queued = R;
    return;
  }
  const prev = L[S.k]?.id;
  run = R;
  E = events(R);
  L = stages(R, E);
  fig.setRig(R.rig, R.q0);
  /* 同じ名前の段階があればそこに留まる */
  const same = prev ? L.findIndex((s) => s.id === prev) : -1;
  S.k = same >= 0 ? same : Math.min(S.k, L.length - 1);
  $('#busy').hidden = true;
  frames();
  chapters();
  timeline();
  results();
  draw(true);
}

/* ---------- 段階のコマ ---------- */
function frames(): void {
  if (!run) return;
  const R = run,
    box = $('#frames');
  box.style.setProperty('--nf', String(L.length));
  box.innerHTML = L.map((s, i) => {
    const q = qAt(R, Math.round(repT(s) / FRAME));
    return `<button type="button" class="fr${BAD.has(s.id) ? ' bad' : ''}" data-k="${i}" aria-pressed="false"><span class="no">${i + 1}</span><span class="fth">${thumbSvg(q, R.q0, R.rig, FOCUS[s.id])}</span><b>${esc(s.name)}</b><small>${ms(s.t0)}</small></button>`;
  }).join('');
}
$('#frames').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.fr');
  if (!b) return;
  const k = Number(b.dataset.k),
    s = L[k];
  goStage(k, (repT(s) - s.t0) / (s.t1 - s.t0));
});

/* ---------- 段階のトランスポート ---------- */
/** 位置の欄での段階の区切り（0〜1）。段階の幅は長さの対数で決め、短い打弦やレットオフも押せる幅にする */
let B: number[] = [0, 1];
const trk = $('#tp-trk'),
  tk = $<SVGSVGElement>('#tp-tk');
function chapters(): void {
  const w = L.map((s) => Math.max(4, Math.log(1 + (s.t1 - s.t0) * 1000) * 10)),
    sum = w.reduce((a, b) => a + b, 0);
  B = [0];
  for (const x of w) B.push(B[B.length - 1] + x / sum);
  B[B.length - 1] = 1;
  txt('#tp-n', String(L.length));
  ticks();
}
/** 段階の境の目盛り */
function ticks(): void {
  const w = trk.clientWidth;
  tk.setAttribute('viewBox', `0 0 ${w} 7`);
  (tk.firstElementChild as SVGPathElement).setAttribute(
    'd',
    B.map((b) => `M${(Math.round(b * (w - 1)) + 0.5).toFixed(1)} 0V7`).join(''),
  );
}
new ResizeObserver(() => requestAnimationFrame(ticks)).observe(trk);
/** 欄の位置 p（0〜1）を段階と段階の中の位置に */
function seekTo(p: number): void {
  p = Math.max(0, Math.min(1, p));
  let k = 0;
  while (k < L.length - 1 && p > B[k + 1]) k++;
  goStage(k, (p - B[k]) / Math.max(1e-9, B[k + 1] - B[k]));
}
{
  let id: number | null = null,
    x0 = 0,
    moved = false;
  const at = (e: PointerEvent) => {
    const r = trk.getBoundingClientRect();
    return (e.clientX - r.left) / Math.max(1, r.width);
  };
  trk.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    id = e.pointerId;
    x0 = e.clientX;
    moved = false;
    /* タッチは横に動かしたときだけ位置を動かす（縦のスクロールを妨げない） */
    if (e.pointerType !== 'touch') {
      seekTo(at(e));
      trk.setPointerCapture(id);
    }
  });
  trk.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    if (!moved && Math.abs(e.clientX - x0) < 4) return;
    if (!moved && e.pointerType === 'touch') trk.setPointerCapture(id);
    moved = true;
    seekTo(at(e));
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    if (e.pointerType === 'touch' && !moved) seekTo(at(e));
  };
  trk.addEventListener('pointerup', end);
  trk.addEventListener('pointercancel', () => {
    id = null;
  });
  trk.addEventListener('keydown', (e) => {
    const p = B[S.k] + (B[S.k + 1] - B[S.k]) * S.u;
    const to =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? p - 0.01
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? p + 0.01
          : e.key === 'PageDown'
            ? B[Math.max(0, S.k - 1)]
            : e.key === 'PageUp'
              ? B[Math.min(L.length - 1, S.k + 1)]
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? 1
                  : null;
    if (to === null) return;
    e.preventDefault();
    seekTo(to);
  });
}
function goStage(k: number, u: number): void {
  if (live) return;
  S.k = Math.max(0, Math.min(L.length - 1, k));
  S.u = Math.max(0, Math.min(1, u));
  last = null;
  draw();
}
$('#tp-home').addEventListener('click', () => goStage(0, 0));
$('#tp-prev').addEventListener('click', () => goStage(S.k - 1, 0));
$('#tp-next').addEventListener('click', () => goStage(S.k + 1, 0));
$('#tp-loop').addEventListener('click', () => {
  S.loop = !S.loop;
  $('#tp-loop').setAttribute('aria-pressed', String(S.loop));
});
const pp = $('#tp-pp');
pp.addEventListener('click', () => {
  if (live) return;
  if (!S.playing && S.k === L.length - 1 && S.u >= 1) goStage(0, 0);
  setPlaying(!S.playing);
});
function setPlaying(on: boolean): void {
  S.playing = on;
  pp.classList.toggle('on', on);
  pp.setAttribute('aria-label', on ? '一時停止' : '再生');
  pp.title = on ? '一時停止' : '今の位置から再生';
  last = null;
  /* 再生を押した操作の中で、止まっている AudioContext を動かしておく */
  if (on && sndOn) void audioReady();
  if (on) loop();
}

/* ---------- 段階の時間・計算結果 ---------- */
function timeline(): void {
  const lg = (t: number) => Math.log10(Math.max(1e-4, t));
  $('#tl').innerHTML = L.map((s, i) => {
    const len = s.t1 - s.t0,
      w = Math.max(1.5, ((lg(len) + 4) / 4) * 85);
    return `<span class="nm" data-k="${i}">${i + 1} ${esc(s.name)}</span><span class="row"><span class="bar" data-k="${i}" style="width:${w.toFixed(1)}%"></span><span class="len">${len < 0.01 ? (len * 1000).toFixed(1) : Math.round(len * 1000)} ms</span></span>`;
  }).join('');
}
function results(): void {
  if (!run || !E) return;
  const R = run,
    s1 = E.strikes[0];
  const block = L.some((s) => s.id === 'block'),
    miss = !s1 || L.some((s) => s.id === 'miss');
  $('#o-v').innerHTML = miss || block ? '—' : `${s1.v.toFixed(2)}<span class="u">m/s</span>`;
  const s2 = E.repress !== null ? E.strikes.find((x) => x.t > (E?.repress ?? 0)) : null;
  txt(
    '#o-vs',
    miss
      ? 'ハンマーが弦に届きません'
      : block
        ? 'ジャックが抜けず、ハンマーは弦に押し付けられたままです'
        : E.repress !== null
          ? s2
            ? `押し直しの打弦 ${s2.v.toFixed(2)} m/s`
            : '押し直しでは打てません'
          : `弦に触れていた時間 ${ms(E.onString, 1)}`,
  );
  const v = (id: string, t: number | null) =>
    ($(id).innerHTML = t === null ? '—' : `${(t * 1000).toFixed(1)}<span class="u">ms</span>`);
  v('#o-ts', s1 && !miss ? s1.t - E.move : null);
  v('#o-tf', s1 && !miss && !block && E.letoff !== null ? s1.t - E.letoff : null);
  $('#o-ck').innerHTML =
    E.check === null
      ? '—'
      : `${(gapAt(R, Math.round((E.release - 5e-3) / FRAME)) * 1000).toFixed(1)}<span class="u">mm</span>`;
}

/* ---------- 描く ---------- */
let shownK = -1,
  curI = 0;
/* ---------- 打弦の波紋（実時間で広がる。スローでも止めていても動く） ---------- */
const RIP_S = 2.4;
let rips: { x: number; t0: number; a: number; tau: number }[] = [],
  drawnT: number | null = null,
  ripRaf = 0;
/** 打弦 s の波紋を足す */
function addRipple(R: Run, s: Strike): void {
  const P = pose(qAt(R, Math.round(s.t / FRAME)));
  rips.push({
    x: gp(P, 'hammer', [-0.1321, 0.0356])[0] * 1000,
    t0: performance.now(),
    a: Math.min(6, 1 + 1.6 * s.v),
    tau: s.blocked ? 0.2 : 1.6,
  });
}
/** 表示の時刻が打弦を前へ越えたら（打弦の 20 ms 以内に来たら）波紋を足す */
function ripplesAt(t: number): Ripple[] {
  const R = run;
  if (R && E && drawnT !== null && t > drawnT)
    for (const s of E.strikes) if (s.t > drawnT && s.t <= t && t - s.t < 0.02) addRipple(R, s);
  drawnT = t;
  return ripplesNow();
}
function ripplesNow(): Ripple[] {
  const now = performance.now();
  rips = rips.filter((r) => now - r.t0 < RIP_S * 1000);
  if (rips.length && !ripRaf && !S.playing && !live)
    ripRaf = requestAnimationFrame(() => {
      ripRaf = 0;
      draw();
    });
  return rips.map((r) => ({ x: r.x, age: (now - r.t0) / 1000, a: r.a, tau: r.tau }));
}
/** 記録 R のコマ i を図と、図の右上の数値に描く */
function paint(R: Run, i: number, id: StageId, ripples: Ripple[]): void {
  curI = i;
  const q = qAt(R, i);
  const on = CONTACTS.filter((c) => fnAt(R, i, c.n) > 0.005).map((c) => c.n);
  const v = headSpeed(R, i);
  fig.draw({
    q,
    focus: FOCUS[id],
    on,
    hl: S.hl,
    push: R.force[i] > 0.3,
    vel: (id === 'acc' || id === 'let' || id === 'rep') && v > 0.25 ? v : null,
    ripples,
  });
  showTip();
  txt(
    '#cap-h',
    `${Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2).replace('-', '−')} m/s・弦まで ${(Math.max(0, gapAt(R, i)) * 1000).toFixed(1)} mm`,
  );
}
function draw(force = false): void {
  if (live) {
    drawLive();
    return;
  }
  if (!run) return;
  const R = run,
    s = L[S.k],
    t = s.t0 + (s.t1 - s.t0) * S.u,
    i = Math.min(R.n - 1, Math.round(t / FRAME));
  paint(R, i, s.id, ripplesAt(t));
  /* 説明（段階が変わったときと、接触が変わったときだけ書き直す） */
  if (force || shownK !== S.k) {
    shownK = S.k;
    txt('#cap-no', String(S.k + 1));
    txt('#cap-nm', s.name);
    txt('#cap-d', s.desc);
    $('#a-svg').setAttribute('aria-label', `グランドピアノのアクションを横から見た図。${S.k + 1} ${s.name}`);
    for (const b of $$('#frames .fr')) b.setAttribute('aria-pressed', String(Number(b.dataset.k) === S.k));
    for (const b of $$('#tl [data-k]')) b.classList.toggle('on', Number(b.dataset.k) === S.k);
    txt('#tp-k', String(S.k + 1));
  }
  txt('#cap-t', ms(t, 2));
  txt('#tp-t', ms(t, 2));
  const p = (B[S.k] + (B[S.k + 1] - B[S.k]) * S.u) * 100;
  $('#tp-fill').style.width = `${p}%`;
  $('#tp-th').style.left = `${p}%`;
  trk.setAttribute('aria-valuenow', String(Math.round(p)));
  trk.setAttribute('aria-valuetext', `${S.k + 1} ${s.name}、${ms(t, 2)}`);
}
/* ---------- 図の上の名前と役割の吹き出し ---------- */
/** 吹き出しを出している所（接触の番号か部品）。描き直すたびに位置と力を更新する */
let tipOn: { kind: 'contact'; n: number } | { kind: 'part'; id: PartTip } | null = null;
const awrap = $('.awrap'),
  tip = $('#a-tip');
function showTip(): void {
  const sp =
    tipOn &&
    fig.spots.find((x) =>
      tipOn?.kind === 'contact'
        ? x.kind === 'contact' && x.n === tipOn.n
        : x.kind === 'part' && x.id === (tipOn as { id: PartTip }).id,
    );
  const R = live?.run ?? run;
  if (!tipOn || !sp || !R) {
    tip.hidden = true;
    return;
  }
  if (tipOn.kind === 'contact') {
    if (tipOn.n === DAMPER_N) tip.innerHTML = '<b>鍵の後ろ → ダンパーのてこ</b>仮の形で、力は計算外';
    else {
      const f = fnAt(R, curI, tipOn.n);
      tip.innerHTML = `<b>${esc(CONTACTS[tipOn.n - 1].name)}</b><span class="f">押す力 ${f < 10 ? f.toFixed(2) : f.toFixed(1)} N</span>`;
    }
  } else {
    const d = PART_TIP[tipOn.id];
    tip.innerHTML = `<b>${esc(d.name)}</b>${esc(d.role)}`;
  }
  tip.hidden = false;
  const [x, y] = fig.px(sp.x, sp.y),
    W = awrap.clientWidth,
    w = tip.offsetWidth,
    h = tip.offsetHeight;
  const left = Math.max(0, Math.min(W - w, x + 12)),
    top = y + 14 + h > awrap.clientHeight ? Math.max(0, y - 14 - h) : y + 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function setTip(t: typeof tipOn): void {
  const same = JSON.stringify(t) === JSON.stringify(tipOn);
  tipOn = t;
  S.hl = t?.kind === 'contact' ? t.n : 0;
  if (!same) draw();
  else showTip();
}
const tipAt = (e: PointerEvent): typeof tipOn => {
  const lab = (e.target as Element).closest<HTMLElement>('.a-lab.hv');
  if (lab) return { kind: 'part', id: lab.dataset.p as PartTip };
  const s = fig.hit(e.clientX, e.clientY, e.pointerType === 'touch' ? 16 : 9);
  return !s ? null : s.kind === 'contact' ? { kind: 'contact', n: s.n } : { kind: 'part', id: s.id };
};
awrap.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') setTip(tipAt(e));
});
awrap.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch') setTip(null);
});
/* タッチは押した所の吹き出しを出し、ほかを押すと消す */
awrap.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') setTip(tipAt(e));
});

/* ---------- 再生 ---------- */
let raf = 0,
  prevNow = 0,
  /** 直前に描いた時刻 [s]（音を鳴らす区間の始まり。飛んだあとは null） */
  last: number | null = null;
function loop(): void {
  cancelAnimationFrame(raf);
  prevNow = performance.now();
  const tick = (now: number) => {
    if (!S.playing || !run) return;
    const dt = Math.min(0.05, (now - prevNow) / 1000);
    prevNow = now;
    const s = L[S.k],
      len = s.t1 - s.t0;
    const secs = spdCh.value === 'auto' ? Math.max(1.5, Math.min(4, len * 50)) : len * Number(spdCh.value);
    let u = S.u + dt / secs;
    if (u >= 1) {
      if (S.loop) {
        u = 0;
        last = null;
      } else if (S.k < L.length - 1) {
        S.k++;
        u = 0;
      } else {
        S.u = 1;
        sound(s.t1);
        draw();
        setPlaying(false);
        return;
      }
    }
    S.u = u;
    const cur = L[S.k];
    sound(cur.t0 + (cur.t1 - cur.t0) * u);
    draw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/* ---------- 音 ---------- */
const audio = new PianoAudio();
let sndOn = true;
const sndBtn = $('#sndBtn');
function specOf(): PianoSpec {
  const t = pianoTypeOf('grand');
  return {
    type: t,
    board: { wood: 'spruce', area: t.area, h: 9e-3, f1: t.f1 },
    a4: 440,
    stretch: true,
    unison: 1,
    hard: 1,
  };
}
let ready = false,
  prepared = false;
/** ピアノのページと同じく、AudioContext を作る前に模型・響板・部屋を渡しておく。重いので 1 回だけ */
function prepAudio(): void {
  if (prepared) return;
  prepared = true;
  const spec = specOf();
  audio.setSpec(spec);
  audio.setBoard(boardDesc(makePiano(spec, audio.fs).board));
  const room = ROOMS.find((r) => r.v === 'small') ?? ROOMS[0];
  audio.setRoom(reverbSpec(room, 4.5));
  audio.vol(volDb);
}
/** 音の準備。押した操作の中で呼ぶと、止まっている AudioContext も動く */
async function audioReady(): Promise<boolean> {
  prepAudio();
  const ok = await audio.ready();
  txt('#snd-msg', ok ? '' : 'このブラウザでは音を鳴らせません');
  ready = ok;
  return ok;
}
function soundOn(on: boolean): void {
  sndOn = on;
  sndBtn.setAttribute('aria-pressed', String(on));
  $('#sndLed').classList.toggle('on', on);
  if (on) void audioReady();
  else audio.stop();
}
sndBtn.addEventListener('click', () => soundOn(!sndOn));
let volDb = VOL0;
new ParamGroup<string>([outVol(VOL0)], (v) => {
  volDb = v.vol;
  audio.vol(volDb);
});
/** 前に描いた時刻から t までに起きた打弦と、ダンパーが下りたことを音にする */
function sound(t: number): void {
  if (!run || !E) return;
  const a = last;
  last = t;
  if (!sndOn || a === null || t <= a) return;
  for (const s of E.strikes) if (s.t > a && s.t <= t) strikeNote(s);
  const da = damperLift(qAt(run, Math.round(a / FRAME)), run.q0),
    db = damperLift(qAt(run, Math.round(t / FRAME)), run.q0);
  if (da > 0 && db <= 0) audio.release(KB.n);
}
/** 打弦 s の速さで、選んでいる鍵の弦を鳴らす */
function strikeNote(s: Strike): void {
  const key = KB.n,
    free = new Uint8Array(KEYS);
  free[key - KEY_LO] = 1;
  const v = Math.max(0.1, s.v),
    blocked = s.blocked;
  /* 鳴らさない間が 1 分続くと AudioContext が止まるので、打つたびに動かし直す */
  void audioReady().then((ok) => {
    if (!ok) return;
    void audio.strike(key, v, false, 1, free);
    /* ブロッキングでは、押し付けたハンマーがすぐに弦を止める */
    if (blocked) setTimeout(() => audio.release(key), 30);
  });
}

/* ---------- 鍵盤 ---------- */
const inRange = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const c0Of = (o: number) => 12 * (o + 1);
const KB = {
  n: NOTE0 as number,
  o: OCT.v as number,
};
{
  const n = stored('kb:n'),
    o = stored('kb:o');
  if (inRange(n, c0Of(OCT.min), c0Of(OCT.max) + 24)) KB.n = n as number;
  if (inRange(o, OCT.min, OCT.max)) KB.o = o as number;
}
const kb = $('#kb'),
  keys = $$<HTMLButtonElement>('.kk', kb);
const noteOf = (b: HTMLElement) => c0Of(KB.o) + Number(b.dataset.i);
function syncKb(): void {
  const c0 = c0Of(KB.o);
  for (const b of keys) {
    const n = noteOf(b);
    b.setAttribute('aria-pressed', String(n === KB.n));
    b.setAttribute('aria-label', noteName(n));
    const lab = b.querySelector('span');
    if (lab) lab.textContent = n % 12 === 0 ? noteName(n) : '';
  }
  txt('#kb-rng', `${noteName(c0)}–${noteName(c0 + 24)}`);
  txt('#kb-note', noteName(KB.n));
  $<HTMLButtonElement>('#octDn').disabled = KB.o <= OCT.min;
  $<HTMLButtonElement>('#octUp').disabled = KB.o >= OCT.max;
  lightKey();
}
for (const [id, d] of [
  ['#octDn', -1],
  ['#octUp', 1],
] as const)
  $(id).addEventListener('click', () => {
    KB.o = Math.max(OCT.min, Math.min(OCT.max, KB.o + d));
    store('kb:o', KB.o);
    syncKb();
  });
/** 押している間だけ、選んでいる鍵を光らせる */
function lightKey(): void {
  const lit = !!live && held !== null;
  for (const b of keys) b.classList.toggle('on', lit && noteOf(b) === KB.n);
}

/* ---------- 鍵盤でその場で動かす ---------- */
let live: LiveAction | null = null,
  /** 弾いている間に届いた計算の結果 */
  queued: Run | null = null,
  liveRaf = 0,
  lastLift = 0;
function pressKey(n: number): void {
  if (!run) return;
  if (S.playing) setPlaying(false);
  if (n !== KB.n) {
    /* アクションは 1 つなので、前の鍵の音は止める */
    if (ready) audio.release(KB.n);
    KB.n = n;
    store('kb:n', n);
    syncKb();
  }
  if (sndOn) void audioReady();
  if (!live) startLive(run);
  live?.down();
  lightKey();
}
function startLive(base: Run): void {
  const a = new LiveAction(base, touchCh.value === 'piano' ? 'piano' : 'forte');
  a.onStrike = (s) => {
    addRipple(a.run, s);
    if (sndOn) strikeNote(s);
  };
  live = a;
  lastLift = 0;
  shownK = -1;
  /* 弾いている間は段階の位置を出さない（弾き終えると新しい動きの段階になる） */
  for (const b of $$('#frames .fr')) b.setAttribute('aria-pressed', 'false');
  for (const b of $$('#tl [data-k]')) b.classList.remove('on');
  txt('#tp-k', '–');
  txt('#tp-t', '');
  $('#tp-fill').style.width = '0';
  $('#tp-th').style.left = '0';
  cancelAnimationFrame(liveRaf);
  let prev = performance.now();
  const tick = (now: number) => {
    if (live !== a) return;
    const dt = Math.max(0, Math.min(0.05, (now - prev) / 1000));
    prev = now;
    /* 1 コマの計算は 10 ms まで。重い端末では実時間より遅く動く */
    a.advance(dt / Number(keySpd.value), performance.now() + 10);
    if (a.done) {
      endLive(a);
      return;
    }
    /* 押したまま落ち着いて波紋もなければ、描き直さない */
    if (!a.held || rips.length) drawLive();
    liveRaf = requestAnimationFrame(tick);
  };
  liveRaf = requestAnimationFrame(tick);
}
function drawLive(): void {
  const a = live;
  if (!a) return;
  const R = a.run,
    i = R.n - 1;
  paint(R, i, a.stage, ripplesNow());
  const lift = damperLift(a.action.q, R.q0);
  if (lastLift > 0 && lift <= 0 && sndOn && ready) audio.release(KB.n);
  lastLift = lift;
  txt('#cap-no', '');
  txt('#cap-nm', NAME[a.stage]);
  txt('#cap-d', D[a.stage]);
  txt('#cap-t', ms(i * FRAME, 2));
  lightKey();
}
/** 静止に戻ったら、弾いた動きを段階の絵と再生へ渡す */
function endLive(a: LiveAction): void {
  live = null;
  lightKey();
  const R = queued ?? a.toRun();
  queued = null;
  setRun(R);
  goStage(L.length - 1, 1);
}
/** 弾いている途中で打ち切る */
function stopLive(): void {
  if (!live) return;
  cancelAnimationFrame(liveRaf);
  live = null;
  queued = null;
  lightKey();
  shownK = -1;
}
/* 同時に押せるのは 1 つだけ。押している指やボタンが離れたら離す */
let held: number | 'key' | null = null;
const release = () => {
  held = null;
  live?.up();
  lightKey();
};
const keyAt = (e: Event) => (e.target as Element).closest<HTMLButtonElement>('.kk');
kb.addEventListener('pointerdown', (e) => {
  const b = keyAt(e);
  if (!b || e.button !== 0 || held !== null) return;
  b.releasePointerCapture(e.pointerId);
  held = e.pointerId;
  pressKey(noteOf(b));
});
for (const t of ['pointerup', 'pointercancel'] as const)
  addEventListener(t, (e) => {
    if (e.pointerId === held) release();
  });
kb.addEventListener('contextmenu', (e) => e.preventDefault());
const isPress = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ';
kb.addEventListener('keydown', (e) => {
  const b = keyAt(e);
  if (!b || !isPress(e)) return;
  e.preventDefault();
  if (e.repeat || held !== null) return;
  held = 'key';
  pressKey(noteOf(b));
});
kb.addEventListener('keyup', (e) => {
  if (isPress(e) && held === 'key') release();
});
addEventListener('blur', () => {
  if (held !== null) release();
});
syncKb();

started = true;
request();
/* 最初の打鍵で止まらないように、開いて少ししてから音の模型を作っておく */
setTimeout(prepAudio, 500);

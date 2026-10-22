/**
 * ピアノのアクションのページの入口: 打鍵と整調 → 動きの計算（Worker）→ 段階に分ける →
 * 段階のコマの絵・主の図・説明・段階のトランスポート・計算結果・段階の時間。
 * 再生は段階ごとに進め、自動ではどの段階も 1.5〜4 秒で見せる。打弦の瞬間に、ピアノ音響モデルの弦を鳴らす
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { outVol } from '../../lib/play';
import { ROOMS, reverbSpec } from '../../lib/reverb';
import { initToolPage } from '../../lib/tool-page';
import { PianoAudio } from '../piano/audio';
import { boardDesc } from '../piano/engine';
import { KEYS, makePiano, type PianoSpec } from '../piano/model';
import { KEY_LO, pianoTypeOf } from '../piano/strings';
import { ActionFig, damperLift, thumbSvg } from './fig';
import { CONTACTS } from './geom';
import type { Reg } from './model';
import { REGS, type RegKey, VOL0 } from './params';
import { FRAME, fnAt, gapAt, headSpeed, qAt, type Run, simulate, type TouchKind } from './sim';
import { type Events, events, type Stage, type StageId, stages } from './stages';
import type { SimIn } from './worker';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const ms = (t: number, d = 1) => `${(t * 1000).toFixed(d)} ms`;

/* ---------- 段階ごとの部品 ---------- */
const PN: Record<string, string> = {
  key: '鍵',
  whippen: 'ウィッペン',
  jack: 'ジャック',
  rep: 'レペティションレバー',
  hammer: 'ハンマー',
  damper: 'ダンパー',
};
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
/** 説明の「動く部品」 */
const MOVING: Record<StageId, string[]> = {
  rest: [],
  acc: ['key', 'whippen', 'jack', 'rep', 'hammer', 'damper'],
  let: ['jack', 'hammer'],
  hit: ['hammer'],
  hit2: ['hammer', 'rep'],
  block: ['key', 'jack', 'hammer'],
  miss: ['jack', 'hammer'],
  chk: ['hammer'],
  half: ['key', 'whippen', 'rep', 'hammer', 'jack', 'damper'],
  rep: ['key', 'whippen', 'jack', 'hammer'],
  fail: ['key', 'whippen'],
  ret: ['key', 'whippen', 'rep', 'jack', 'hammer', 'damper'],
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
  if (started) request();
});
reg = toReg(P.values());
const touchCh = new Choice<TouchKind>($('#p-touch'), () => started && request());
const spdCh = new Choice<string>($('#p-spd'));
const noteCh = new Choice<string>($('#p-note'));

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
function chapters(): void {
  $('#tp-ch').innerHTML = L.map((s, i) => {
    const w = Math.max(4, Math.log(1 + (s.t1 - s.t0) * 1000) * 10);
    return `<button type="button" class="ch" data-k="${i}" style="flex:${w.toFixed(1)} 1 0" title="${esc(s.name)}" aria-label="${i + 1} ${esc(s.name)}"><i></i></button>`;
  }).join('');
  txt('#tp-n', String(L.length));
}
$('#tp-ch').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.ch');
  if (b) goStage(Number(b.dataset.k), 0);
});
function goStage(k: number, u: number): void {
  S.k = Math.max(0, Math.min(L.length - 1, k));
  S.u = Math.max(0, Math.min(1, u));
  last = null;
  draw();
}
$('#tp-prev').addEventListener('click', () => goStage(S.k - 1, 0));
$('#tp-next').addEventListener('click', () => goStage(S.k + 1, 0));
$('#tp-loop').addEventListener('click', () => {
  S.loop = !S.loop;
  $('#tp-loop').setAttribute('aria-pressed', String(S.loop));
});
const pp = $('#tp-pp');
pp.addEventListener('click', () => {
  if (!S.playing && S.k === L.length - 1 && S.u >= 1) goStage(0, 0);
  setPlaying(!S.playing);
});
function setPlaying(on: boolean): void {
  S.playing = on;
  pp.classList.toggle('on', on);
  pp.setAttribute('aria-label', on ? '一時停止' : '再生');
  pp.title = on ? '一時停止' : '再生';
  last = null;
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
  txt('#m-v', miss || block ? '—' : `${s1.v.toFixed(2)} m/s`);
}

/* ---------- 描く ---------- */
let shownK = -1,
  shownCt = '';
function draw(force = false): void {
  if (!run) return;
  const R = run,
    s = L[S.k],
    t = s.t0 + (s.t1 - s.t0) * S.u,
    i = Math.min(R.n - 1, Math.round(t / FRAME));
  const q = qAt(R, i);
  const on = CONTACTS.filter((c) => fnAt(R, i, c.n) > 0.005).map((c) => c.n);
  const v = headSpeed(R, i);
  fig.draw({
    q,
    focus: FOCUS[s.id],
    on,
    hl: on.includes(S.hl) ? S.hl : 0,
    push: R.force[i] > 0.3,
    vel: (s.id === 'acc' || s.id === 'let' || s.id === 'rep') && v > 0.25 ? v : null,
  });
  /* 説明（段階が変わったときと、接触が変わったときだけ書き直す） */
  if (force || shownK !== S.k) {
    shownK = S.k;
    txt('#cap-no', String(S.k + 1));
    txt('#cap-nm', s.name);
    txt('#cap-d', s.desc);
    txt('#cap-mv', MOVING[s.id].map((b) => PN[b]).join('・') || '（なし）');
    txt('#m-st', s.name);
    $('#a-svg').setAttribute('aria-label', `グランドピアノのアクションを横から見た図。${S.k + 1} ${s.name}`);
    for (const b of $$('#frames .fr')) b.setAttribute('aria-pressed', String(Number(b.dataset.k) === S.k));
    for (const b of $$('#tp-ch .ch')) b.classList.toggle('on', Number(b.dataset.k) === S.k);
    for (const b of $$('#tl [data-k]')) b.classList.toggle('on', Number(b.dataset.k) === S.k);
    txt('#tp-k', String(S.k + 1));
  }
  const ct = on.join(',');
  if (force || ct !== shownCt) {
    shownCt = ct;
    $('#cap-ct').innerHTML =
      on
        .map(
          (n) =>
            `<button type="button" class="ctb" data-n="${n}" title="図の上に印を付ける"><span class="led on" aria-hidden="true"></span>${esc(CONTACTS[n - 1].name)}</button>`,
        )
        .join('') || '（なし）';
  }
  txt('#cap-t', ms(t, 2));
  txt(
    '#cap-h',
    `${Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2).replace('-', '−')} m/s・弦まで ${(Math.max(0, gapAt(R, i)) * 1000).toFixed(1)} mm`,
  );
  txt('#tp-t', ms(t, 2));
  txt('#m-t', ms(t));
  for (const b of $$<HTMLElement>('#tp-ch .ch')) {
    const k = Number(b.dataset.k);
    (b.firstElementChild as HTMLElement).style.width = `${k < S.k ? 100 : k === S.k ? S.u * 100 : 0}%`;
  }
}
/* 説明の接触の名前にマウスやフォーカスを当てると、図の上に輪を付ける */
const capCt = $('#cap-ct');
const hlOf = (e: Event) => Number((e.target as Element).closest<HTMLElement>('.ctb')?.dataset.n ?? 0);
for (const ev of ['mouseover', 'focusin'])
  capCt.addEventListener(ev, (e) => {
    S.hl = hlOf(e);
    draw();
  });
for (const ev of ['mouseout', 'focusout'])
  capCt.addEventListener(ev, () => {
    S.hl = 0;
    draw();
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
let sndOn = false;
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
let ready = false;
async function soundOn(on: boolean): Promise<void> {
  sndOn = on;
  sndBtn.setAttribute('aria-pressed', String(on));
  $('#sndLed').classList.toggle('on', on);
  if (!on) {
    audio.stop();
    return;
  }
  const ok = await audio.ready();
  txt('#snd-msg', ok ? '' : 'このブラウザでは音を鳴らせません');
  if (!ok || ready) return;
  ready = true;
  const spec = specOf();
  audio.setSpec(spec);
  audio.setBoard(boardDesc(makePiano(spec, audio.fs).board));
  const room = ROOMS.find((r) => r.v === 'small') ?? ROOMS[0];
  audio.setRoom(reverbSpec(room, 4.5));
  audio.vol(volDb);
}
sndBtn.addEventListener('click', () => void soundOn(!sndOn));
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
  if (!sndOn || !ready || a === null || t <= a) return;
  const key = Number(noteCh.value);
  for (const s of E.strikes) {
    if (s.t > a && s.t <= t) {
      const free = new Uint8Array(KEYS);
      free[key - KEY_LO] = 1;
      void audio.strike(key, Math.max(0.1, s.v), false, 1, free);
      /* ブロッキングでは、押し付けたハンマーがすぐに弦を止める */
      if (s.blocked) setTimeout(() => audio.release(key), 30);
    }
  }
  const da = damperLift(qAt(run, Math.round(a / FRAME)), run.q0),
    db = damperLift(qAt(run, Math.round(t / FRAME)), run.q0);
  if (da > 0 && db <= 0) audio.release(key);
}

started = true;
request();

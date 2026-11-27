/**
 * 4 ビット CPU のページの入口。止めた状態で開き、再生すると 1 クロックごとに値の札がブロックからバスを通って行き先へ動く。
 * 図の中の ROM のビットを押すと、動かしたまま命令を書き換えられる。次にその行を読むと値の流れが変わる
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { bindFig, type Fig, type FigVals, type Lit } from './fig';
import { type Cpu, chip, DEF_PROG, dec, type Exec, HLT, makeCpu, PROG, romOf, type Snap, snap, step } from './model';
import { type Key, VOL } from './params';
import { CpuAudio } from './sound';

initToolPage();

/** 1 クロックの長さ [ms] */
const SPEED = { slow: 2600, mid: 1300, fast: 420 } as const;
type Speed = keyof typeof SPEED;

/* 1 クロックの中の進み（0〜1）: 命令の読み出しを光らせる間・値の札が出る所・札が着いて値が書き換わる所 */
const F_IR = 0.08,
  F_FETCH = 0.3,
  F_SRC = 0.18,
  F_TAG = 0.3,
  F_DONE = 0.8;

const root = $('#cp'),
  playBtn = $<HTMLButtonElement>('#cp-play'),
  clkEl = $('#cp-clk'),
  opEl = $('#cp-op'),
  exEl = $('#cp-ex');
const audio = new CpuAudio();

let M: Cpu = makeCpu(romOf(PROG[DEF_PROG]), PROG[DEF_PROG].inp);
/** 実行中の命令の記録・進み・実行の前後の値・前の命令の語 */
const R = {
  e: null as Exec | null,
  f: 1,
  prev: null as Snap | null,
  next: null as Snap | null,
  prevIr: M.rom[0],
  playing: false,
  /** 1 クロックだけ進めている */
  one: false,
};
/** 書き換えた行と時刻 */
const EDIT = new Map<number, number>();
let speed: Speed = 'mid';
/** 押して選んだ行（狭い枠の大きなスイッチで書く行） */
let sel = 0;

/* ---------- 実行 ---------- */
function resetR(): void {
  R.e = null;
  R.f = 1;
  R.prev = R.next = null;
  R.prevIr = M.rom[M.pc];
}
function loadProg(id: string): void {
  const p = PROG[id] ?? PROG[DEF_PROG];
  M = makeCpu(romOf(p), p.inp);
  EDIT.clear();
  resetR();
}
function restart(): void {
  M = makeCpu(M.rom, M.inp);
  resetR();
}
/** 次の命令を始める */
function begin(): void {
  R.prevIr = R.e ? R.e.d.b : M.rom[M.pc];
  R.prev = snap(M);
  R.e = step(M);
  R.next = snap(M);
  R.f = 0;
  audio.tick();
}
/** 進みが札の着く所を越えたら、出力の音を鳴らす */
function advance(to: number): void {
  const f0 = R.f;
  R.f = to;
  if (R.e?.dst === 'out' && f0 < F_DONE && to >= F_DONE) audio.note(R.e.val);
}
function editBit(r: number, j: number): void {
  M.rom[r] ^= 1 << (7 - j);
  EDIT.set(r, performance.now());
  draw();
}
function clearRom(): void {
  const now = performance.now();
  for (let i = 0; i < 16; i++) {
    if (M.rom[i] !== HLT) EDIT.set(i, now);
    M.rom[i] = HLT;
  }
  progCh.set('');
  restart();
}

/* ---------- 表示 ---------- */
function view(): { v: FigVals; lit: Lit } {
  const base = { inp: M.inp, rom: M.rom, edited: EDIT, sel };
  const e = R.e;
  if (!e || !R.prev || !R.next) return { v: { ...snap(M), ...base, row: M.pc }, lit: {} };
  const f = R.f,
    after = f >= F_DONE,
    s = after ? R.next : R.prev;
  const v: FigVals = {
    ...s,
    ...base,
    ir: f >= F_IR ? e.d.b : R.prevIr,
    pc: after ? R.next.pc : e.pc,
    row: after ? R.next.pc : e.pc,
  };
  const moving = f >= F_SRC && !!e.src;
  const lit: Lit = {
    fetch: f < F_FETCH,
    src: f >= F_SRC ? e.src : null,
    dst: e.dst,
    val: e.val,
    tag: moving ? Math.min(1, Math.max(0, (f - F_TAG) / (F_DONE - F_TAG))) : null,
    alu: e.src === 'alu' && f >= F_SRC,
    inc: after && e.dst !== 'pc' && e.d.k !== 'hlt',
  };
  return { v, lit };
}
/** 図の下の表示: クロック・命令・補足 */
function status(): [string, string, string] {
  const e = R.e;
  if (!e) return [`クロック ${M.clk}`, '最初の行から', ''];
  const d = e.d,
    c = `クロック ${M.clk}`;
  if (d.k === 'hlt') return [c, '停止', '再生で最初から'];
  if (d.k === 'jnc' && !e.taken) return [c, '条件ジャンプ', 'C=1 で次の行'];
  const s = `${d.nm} ${chip(d)}`;
  if (d.k === 'add') return [c, s, `${e.A0}+${e.B0}=${e.sum}${e.sum > 15 ? ' 桁上げ' : ''}`];
  return [c, s, ''];
}
const setText = (el: Element, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};

const figs = $$<SVGSVGElement>('.cp-dp').map(bindFig);
/** 見えている方の図（狭い枠では縦の図） */
let fig: Fig | null = null;
function pickFig(): void {
  fig = figs.find((g) => getComputedStyle(g.svg).display !== 'none') ?? null;
}
function draw(): void {
  if (!fig) return;
  const { v, lit } = view();
  fig.update(v, lit);
  const [a, b, c] = status();
  setText(clkEl, a);
  setText(opEl, b);
  setText(exEl, c);
  drawBig();
}
/** 狭い枠の大きなスイッチ: 選んだ行のビットと札 */
const bigBtns = $$<HTMLButtonElement>('.cp-bsw');
function drawBig(): void {
  const w = M.rom[sel],
    d = dec(w);
  for (const b of bigBtns) {
    const on = (w >> (7 - Number(b.dataset.j))) & 1;
    b.setAttribute('aria-pressed', String(!!on));
    setText(b, String(on));
  }
  setText($('#cp-bigT'), `${sel} 行目`);
  setText($('#cp-bigC'), `${d.nm} ${chip(d)}`.trim());
}
function syncPlay(): void {
  playBtn.setAttribute('aria-pressed', String(R.playing));
}
function setPlay(on: boolean): void {
  R.playing = on;
  R.one = false;
  syncPlay();
}

/* ---------- 毎フレーム ---------- */
let last = 0;
function loop(t: number): void {
  const dt = Math.min(100, t - (last || t));
  last = t;
  if (R.playing || R.one) {
    if (R.e && R.f < 1) advance(Math.min(1, R.f + dt / SPEED[speed]));
    else if (R.e?.d.k === 'hlt' && R.playing) setPlay(false);
    else if (R.playing) begin();
    else R.one = false;
  }
  draw();
  requestAnimationFrame(loop);
}

/* ---------- 操作 ---------- */
playBtn.addEventListener('click', () => {
  audio.ready();
  if (!R.playing && M.halt) restart();
  setPlay(!R.playing);
});
$('#cp-step').addEventListener('click', () => {
  audio.ready();
  setPlay(false);
  if (R.e && R.f < 1) advance(1);
  begin();
  R.one = true;
});
$('#cp-reset').addEventListener('click', () => {
  restart();
  draw();
});
for (const b of bigBtns) b.addEventListener('click', () => editBit(sel, Number(b.dataset.j)));
$('#cp-clear').addEventListener('click', () => {
  clearRom();
  draw();
});

/** 保存した値を戻し終えたか（戻すときは動かし始めない） */
let booted = false;
const progCh = new Choice($('#cp-prog'), (id) => {
  loadProg(id);
  if (booted) setPlay(true);
  draw();
});
new Choice<Speed>($('#p-speed'), (v) => {
  speed = v;
});
speed = (($('#p-speed').querySelector('[aria-pressed="true"]') as HTMLElement | null)?.dataset.v as Speed) ?? 'mid';

/* 図: 入力のスイッチと ROM のビット */
function onFig(t: Element): boolean {
  const sw = t.closest<SVGGElement>('.cp-sw');
  if (sw) {
    M.inp ^= 1 << (3 - Number(sw.dataset.inb));
    draw();
    return true;
  }
  const bx = t.closest<SVGGElement>('.cp-rbx');
  if (bx) {
    sel = Number(bx.dataset.r);
    editBit(sel, Number(bx.dataset.j));
    return true;
  }
  const row = t.closest<SVGGElement>('[data-rowg]');
  if (row) {
    sel = Number(row.dataset.rowg);
    draw();
    return true;
  }
  return false;
}
/** ROM のビットの間を矢印キーで移る（Tab で入るのは 1 つだけ） */
function moveBit(g: SVGGElement, key: string): boolean {
  const r = Number(g.dataset.r),
    j = Number(g.dataset.j);
  const to = { ArrowUp: [r - 1, j], ArrowDown: [r + 1, j], ArrowLeft: [r, j - 1], ArrowRight: [r, j + 1] }[key];
  if (!to) return false;
  const [r2, j2] = to;
  if (r2 < 0 || r2 > 15 || j2 < 0 || j2 > 7) return true;
  const svg = g.ownerSVGElement;
  const n = svg?.querySelector<SVGGElement>(`.cp-rbx[data-r="${r2}"][data-j="${j2}"]`);
  if (n) {
    sel = r2;
    g.setAttribute('tabindex', '-1');
    n.setAttribute('tabindex', '0');
    n.focus();
  }
  return true;
}
for (const { svg } of figs) {
  svg.addEventListener('click', (ev) => {
    const t = ev.target as Element;
    const bx = t.closest<SVGGElement>('.cp-rbx');
    if (bx) {
      for (const o of $$('.cp-rbx[tabindex="0"]', svg)) o.setAttribute('tabindex', '-1');
      bx.setAttribute('tabindex', '0');
    }
    onFig(t);
  });
  svg.addEventListener('keydown', (ev) => {
    const t = ev.target as Element;
    if (ev.key === 'Enter' || ev.key === ' ') {
      if (onFig(t)) ev.preventDefault();
      return;
    }
    const bx = t.closest<SVGGElement>('.cp-rbx');
    if (bx && moveBit(bx, ev.key)) ev.preventDefault();
  });
}

/* ---------- 音 ---------- */
const sndBtn = $<HTMLButtonElement>('#cp-snd');
sndBtn.addEventListener('click', () => {
  audio.on = !audio.on;
  if (audio.on) audio.ready();
  sndBtn.setAttribute('aria-pressed', String(audio.on));
});
storeToggle(sndBtn);
const pg = new ParamGroup<Key>([VOL], (v) => audio.vol(v.vol));
/* 動かし始めたあとに鳴らせるよう、ページのどこかを押したら音を用意する */
root.addEventListener('pointerdown', () => audio.ready());
autoPause(audio, {
  pause: () => setPlay(false),
  hidden: () => {},
});

/* ---------- 起動 ---------- */
new ResizeObserver(() => {
  const was = fig;
  pickFig();
  if (fig !== was) draw();
}).observe($('#cp-figw'));
pickFig();
syncPlay();
/* 保存した値を戻したあと（マイクロタスク）に組み立てる */
queueMicrotask(() => {
  booted = true;
  audio.vol(pg.values().vol);
  draw();
  requestAnimationFrame(loop);
});

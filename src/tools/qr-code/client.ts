/**
 * QR コードのページの入口: 入力 → 符号化（encode.ts）→ QR コードの構造（段ごとの図・符号語の表・説明）・計算結果・マスクの比較。
 * 誤り訂正実験では図をなぞってしみやこすれを付け、そのたびに復号（decode.ts）して読み取り結果を出す
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { ParamGroup } from '../../lib/param';
import { addRow, mark } from '../../lib/reset';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { type Decoded, decode } from './decode';
import { type Cat, catOf, cwEdges, drawMap, drawMask, drawPlain, QZ, STAGE } from './draw';
import { capBits, ccBits, type Encoded, type EncodeError, encode, MODE_NAME, type Mode } from './encode';
import { setAutoVer, TEXT0, VER } from './params';
import { ECCS, type Ecc, ROLE_NAME, Role } from './spec';
import { hex2, inspect, inspectSoil, vis } from './view';

initToolPage();

const DASH = '—';
const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};

/* ---------- 入力 ---------- */
/** 入力の部品が保存した値を戻すときの呼び出しは、すべて作り終えてから 1 回にまとめる */
let ready = false;
const textEl = $<HTMLTextAreaElement>('#q-text');
const sv = stored('text');
if (typeof sv === 'string' && sv) textEl.value = sv;
let tTimer: ReturnType<typeof setTimeout> | undefined;
textEl.addEventListener('input', () => {
  clearTimeout(tTimer);
  tTimer = setTimeout(onText, 150);
});
function onText(): void {
  if (textEl.value === TEXT0) forget('text');
  else store('text', textEl.value);
  mark();
  rebuild();
}
addRow($('#p-text'), {
  isMod: () => textEl.value !== TEXT0,
  reset: () => {
    textEl.value = TEXT0;
    onText();
  },
});
const eccCh = new Choice<Ecc>($('#p-ecc'), () => rebuild());
const modeCh = new Choice<Mode | 'auto'>($('#p-mode'), () => rebuild());
const boostCh = new Choice<string>($('#p-boost'), () => rebuild());
const P = new ParamGroup<'ver'>([VER], () => rebuild());

/** 固定したマスク（−1 は自動） */
let maskFix = typeof stored('mask') === 'number' ? (stored('mask') as number) : -1;
const mautoCh = new Choice<string>($('#p-mauto'), (v) => {
  maskFix = v === 'auto' ? -1 : (q?.mask ?? 0);
  saveMask();
  rebuild();
});
if (maskFix >= 0) mautoCh.set('fix');
function saveMask(): void {
  if (maskFix < 0) forget('mask');
  else store('mask', maskFix);
}

/* ---------- 状態 ---------- */
let q: Encoded | null = null;
let cats: Cat[] = [];
let edges: number[] = [];
let stage: number = STAGE.place;
let sel = -1;
let act: 'look' | 'soil' = 'look';
let soil: Uint8Array | null = null;
let dec: Decoded | null = null;
new Choice<'look' | 'soil'>($('#p-act'), (v) => setAct(v));
/** 汚れのないときの読み取り（入力が変わるたびに作る） */
let baseDec: Decoded | null = null;

const ERR_TEXT = (e: EncodeError): string => {
  switch (e.err) {
    case 'empty':
      return '文字列を入れてください';
    case 'char':
      return `${MODE_NAME[e.mode]}モードでは「${vis(e.ch)}」（${e.at + 1} 文字目）を符号化できません`;
    default:
      return e.ver === 40
        ? `長すぎてバージョン 40 にも入りません（${e.need} ビット、容量 ${e.cap} ビット）`
        : `バージョン ${e.ver} に入りません（${e.need} ビット、容量 ${e.cap} ビット）。バージョンを上げるか自動にしてください`;
  }
};

function rebuild(): void {
  if (!ready) return;
  const r = encode(textEl.value, {
    ecc: eccCh.value,
    ver: P.get('ver'),
    mask: maskFix,
    mode: modeCh.value,
    boost: boostCh.value === '1',
  });
  const msg = $('#m-text');
  if ('err' in r) {
    msg.textContent = ERR_TEXT(r);
    msg.className = 'msg er';
    $('#q-fig').classList.add('dim');
    counts(null);
    return;
  }
  msg.textContent = '';
  msg.className = 'msg';
  $('#q-fig').classList.remove('dim');
  const same = q && q.n === r.n && q.mods.every((v, i) => v === r.mods[i]) && q.cw.length === r.cw.length;
  const prevLen = q?.cw.length;
  q = r;
  setAutoVer(P.get('ver') === 0 ? r.ver : 0);
  P.refresh('ver');
  cats = r.cw.map((_, c) => catOf(r, c));
  edges = cwEdges(r);
  baseDec = decode(r.mods, r.n);
  if (!same) {
    soil = act === 'soil' ? r.mods.slice() : null;
    redecode();
  }
  if (sel < 0 || sel >= r.cw.length || prevLen !== r.cw.length) sel = Math.max(0, cats.indexOf('d'));
  counts(r);
  buildTable();
  render();
}

function counts(r: Encoded | null): void {
  const chars = [...textEl.value].length;
  if (!r) {
    html('#q-cnt', `<span>${chars} 文字</span>`);
    return;
  }
  const bytes = new TextEncoder().encode(textEl.value).length;
  html(
    '#q-cnt',
    `<span>${chars} 文字</span>${r.mode === 'byte' ? `<span>UTF-8 で <b>${bytes} バイト</b></span>` : ''}<span>モード <b>${MODE_NAME[r.mode]}</b></span>`,
  );
}

/* ---------- 誤り訂正実験 ---------- */
function setAct(v: 'look' | 'soil'): void {
  act = v;
  if (v === 'soil' && q && !soil) soil = q.mods.slice();
  $('#q-tools').hidden = v !== 'soil';
  $('#q-leg').hidden = v === 'soil';
  $('#q-leg2').hidden = v !== 'soil';
  $('#q-stagerow').hidden = v === 'soil';
  $('#q-exp').hidden = v !== 'soil';
  $('#q-fig').classList.toggle('soil', v === 'soil');
  redecode();
  buildTable();
  render();
}
let tool = 'ink';
for (const b of $$<HTMLButtonElement>('#q-tools [data-t]'))
  b.addEventListener('click', () => {
    tool = b.dataset.t ?? 'ink';
    for (const x of $$('#q-tools [data-t]')) x.setAttribute('aria-pressed', String(x === b));
  });
$('#q-rand').addEventListener('click', () => {
  if (!q || !soil) return;
  for (let i = 0; i < 8; i++) {
    const k = Math.floor(Math.random() * q.n * q.n);
    soil[k] ^= 1;
  }
  soiled();
});
$('#q-clean').addEventListener('click', () => {
  if (!q) return;
  soil = q.mods.slice();
  soiled();
});
/** 汚れを付けた格子が変わった */
let rq = 0;
function soiled(): void {
  if (rq) return;
  rq = requestAnimationFrame(() => {
    rq = 0;
    redecode();
    paintTable();
    render();
  });
}
function redecode(): void {
  dec = q && soil ? decode(soil, q.n) : null;
}
/** 筆を (x, y)（モジュールの単位、小数）に当てる */
const visited = new Set<number>();
function brush(x: number, y: number): void {
  if (!q || !soil) return;
  const n = q.n;
  if (tool === 'flip') {
    const mx = Math.floor(x),
      my = Math.floor(y);
    if (mx < 0 || my < 0 || mx >= n || my >= n || visited.has(my * n + mx)) return;
    visited.add(my * n + mx);
    soil[my * n + mx] ^= 1;
    return;
  }
  const r = tool === 'ink' ? 1.35 : 0.75,
    v = tool === 'ink' ? 1 : 0;
  for (let my = Math.floor(y - r); my <= Math.ceil(y + r); my++)
    for (let mx = Math.floor(x - r); mx <= Math.ceil(x + r); mx++) {
      if (mx < 0 || my < 0 || mx >= n || my >= n) continue;
      if (Math.hypot(mx + 0.5 - x, my + 0.5 - y) <= r) soil[my * n + mx] = v;
    }
}

/* ---------- 図 ---------- */
const cv = $<HTMLCanvasElement>('#cv-map'),
  ctx = cv.getContext('2d') as CanvasRenderingContext2D,
  fig = $('#q-fig');
function drawNow(): void {
  if (!q) return;
  const side = q.n + 2 * QZ,
    css = fig.clientWidth || 370,
    k = Math.max(2, Math.round((css * devicePixelRatio) / side));
  if (cv.width !== side * k) {
    cv.width = side * k;
    cv.height = side * k;
  }
  drawMap(
    ctx,
    k,
    { q, cats, stage, sel, soil: act === 'soil' ? soil : null, bad: act === 'soil' ? badSet() : new Set() },
    edges,
  );
}
new ResizeObserver(() => requestAnimationFrame(drawNow)).observe(fig);
/** 訂正した符号語（配置順） */
function badSet(): Set<number> {
  const s = new Set<number>();
  if (dec) for (let i = 0; i < dec.recv.length; i++) if (dec.recv[i] !== dec.fixed[i]) s.add(i);
  return s;
}
/** 押した位置のモジュール（小数） */
function modAt(e: PointerEvent): [number, number] {
  const r = cv.getBoundingClientRect(),
    side = (q?.n ?? 21) + 2 * QZ;
  return [((e.clientX - r.left) / r.width) * side - QZ, ((e.clientY - r.top) / r.height) * side - QZ];
}
let down: [number, number] | null = null;
fig.addEventListener('pointerdown', (e) => {
  if (!q) return;
  const [x, y] = modAt(e);
  if (act === 'soil') {
    if (e.isPrimary) fig.setPointerCapture?.(e.pointerId);
    visited.clear();
    down = [x, y];
    brush(x, y);
    soiled();
    e.preventDefault();
    return;
  }
  const i = Math.floor(y) * q.n + Math.floor(x);
  if (x >= 0 && y >= 0 && x < q.n && y < q.n && q.cwAt[i] >= 0 && stage >= STAGE.place) pick(q.cwAt[i]);
});
fig.addEventListener('pointermove', (e) => {
  if (!q) return;
  const [x, y] = modAt(e);
  readout(x, y);
  if (act !== 'soil' || !down) return;
  /* 前の位置からの線の上に筆を置く */
  const [x0, y0] = down,
    steps = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / 0.3));
  for (let i = 1; i <= steps; i++) brush(x0 + ((x - x0) * i) / steps, y0 + ((y - y0) * i) / steps);
  down = [x, y];
  soiled();
});
const up = () => {
  down = null;
};
fig.addEventListener('pointerup', up);
fig.addEventListener('pointercancel', up);
fig.addEventListener('pointerleave', () => {
  if (!down) txt('#q-rd', '');
});
fig.addEventListener('keydown', (e) => {
  if (!q) return;
  const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -10, ArrowDown: 10 }[e.key];
  if (!d) return;
  e.preventDefault();
  pick(Math.min(q.cw.length - 1, Math.max(0, sel + d)));
});
function readout(x: number, y: number): void {
  if (!q) return;
  const mx = Math.floor(x),
    my = Math.floor(y),
    n = q.n;
  if (mx < 0 || my < 0 || mx >= n || my >= n) {
    txt('#q-rd', '');
    return;
  }
  const i = my * n + mx,
    c = q.cwAt[i],
    r = q.frame.role[i];
  let s = `(${mx}, ${my}) · `;
  if (c >= 0)
    s += `符号語 ${c} のビット ${q.bitAt[i]} · ${{ h: 'モードと文字数', d: 'データ', p: '終端と埋め草', e: '誤り訂正' }[cats[c]]}`;
  else s += r === Role.Data ? ROLE_NAME[Role.Rem] : ROLE_NAME[r];
  if (act === 'soil' && soil && soil[i] !== q.mods[i]) s += ' · 汚れ';
  txt('#q-rd', s);
}
function pick(c: number): void {
  sel = c;
  paintTable();
  render();
  const b = $('#q-cws').children[c] as HTMLElement | undefined;
  b?.scrollIntoView({ block: 'nearest' });
}

/** 説明の「もう一度見る」: 中身を入れ直して、現れる動きを始めからにする */
$('#q-insp').addEventListener('click', (e) => {
  if (!(e.target as Element).closest('.q-replay')) return;
  const el = $('#q-insp'),
    h = el.innerHTML;
  el.classList.remove('still');
  el.innerHTML = '';
  void el.offsetWidth;
  el.innerHTML = h;
  el.querySelector<HTMLElement>('.q-replay')?.focus();
});

/* ---------- 段 ---------- */
const stageBtns = $$<HTMLButtonElement>('#q-stage button');
for (const b of stageBtns) b.addEventListener('click', () => setStage(Number(b.dataset.s)));
for (const s of $$('#q-stage span'))
  s.addEventListener('click', () => s.previousElementSibling?.dispatchEvent(new MouseEvent('click')));
function setStage(s: number): void {
  stage = s;
  paintTable();
  render();
}

/* ---------- 符号語の表 ---------- */
function buildTable(): void {
  if (!q) return;
  const box = $('#q-cws');
  box.innerHTML = q.cw
    .map((_, i) => `<button type="button" data-c="${i}"><small>${i}</small><span></span></button>`)
    .join('');
  const nb = q.bk.sizes.length;
  txt('#q-cwn', `${q.cw.length} 語（データ ${q.bk.data} + 誤り訂正 ${q.bk.ec}${nb > 1 ? ` × ${nb}` : ''}）· 配置順`);
  paintTable();
}
$('#q-cws').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-c]');
  if (b) pick(Number(b.dataset.c));
});
function paintTable(): void {
  if (!q) return;
  const box = $('#q-cws'),
    soilOn = act === 'soil' && !!soil,
    bs = $$<HTMLButtonElement>('button', box);
  bs.forEach((b, c) => {
    const ec = q?.src[c].ec ?? false,
      shown = soilOn || stage >= STAGE.ec || (stage === STAGE.data && !ec);
    let cls = shown ? cats[c] : 'z',
      val = shown ? hex2(q?.cw[c] ?? 0) : '';
    if (soilOn && dec) {
      val = hex2(dec.fixed[c]);
      if (dec.recv[c] !== dec.fixed[c]) cls += ' bad';
      else if (dec.recv[c] !== q?.cw[c]) cls += ' lost';
    }
    if (b.className !== cls) b.className = cls;
    const v = b.lastElementChild as HTMLElement;
    if (v.textContent !== val) v.textContent = val;
    const on = String(c === sel);
    if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
  });
}

/* ---------- まとめて描く ---------- */
/** 説明の動きを始めからにする場面（段・操作・符号）。符号語を選び直しただけなら動かさずに出す */
let inspKey = '';
function render(): void {
  if (!q) return;
  drawNow();
  const key = `${act}:${stage}:${q.ver}:${q.ecc}:${q.mask}:${q.text}`;
  $('#q-insp').classList.toggle('still', key === inspKey);
  inspKey = key;
  html(
    '#q-insp',
    act === 'soil' ? inspectSoil(q, dec, sel) : inspect(q, stage, sel, { autoMode: modeCh.value === 'auto' }),
  );
  stageBar();
  outputs();
  maskPanel();
  readPanel();
}

function stageBar(): void {
  if (!q) return;
  const used = q.spans
      .filter((s) => s.k === 'mode' || s.k === 'count' || s.k === 'data')
      .reduce((a, s) => a + s.to - s.from, 0),
    subs = [
      `${q.chars.length} 文字`,
      `${used} ビット`,
      `${q.bk.data} 語`,
      `+ ${q.bk.ec * q.bk.sizes.length} 語`,
      `${q.n} × ${q.n}`,
      `マスク ${q.mask}`,
      '形式情報',
    ];
  $$('#q-stage li').forEach((li, i) => {
    li.className = i < stage ? 'done' : i === stage ? 'on' : '';
    const sm = li.querySelector('small');
    if (sm && sm.textContent !== subs[i]) sm.textContent = subs[i];
    const b = li.querySelector('button');
    if (i === stage) b?.setAttribute('aria-current', 'step');
    else b?.removeAttribute('aria-current');
  });
}

/** バージョン ver・レベル ecc に入る文字数（モードの単位） */
function capChars(mode: Mode, ver: number, ecc: Ecc): number {
  const a = capBits(ver, ecc) - 4 - ccBits(mode, ver);
  if (a <= 0) return 0;
  if (mode === 'num') return Math.floor(a / 10) * 3 + (a % 10 >= 7 ? 2 : a % 10 >= 4 ? 1 : 0);
  if (mode === 'alnum') return Math.floor(a / 11) * 2 + (a % 11 >= 6 ? 1 : 0);
  return Math.floor(a / (mode === 'kanji' ? 13 : 8));
}

function outputs(): void {
  if (!q) return;
  const nb = q.bk.sizes.length,
    pads = q.spans.filter((s) => s.k === 'pad').length,
    count = q.mode === 'byte' ? q.units.length : q.chars.length,
    room = capChars(q.mode, q.ver, q.ecc) - count,
    unit = q.mode === 'byte' ? 'バイト' : '文字',
    up = ECCS.slice(ECCS.indexOf(q.ecc) + 1).filter((e) => capChars(q?.mode ?? 'byte', q?.ver ?? 1, e) >= count),
    rem = q.frame.order.length - q.cw.length * 8,
    best = q.pens.reduce((b, x, i, a) => (x.total < a[b].total ? i : b), 0);
  txt('#o-ver', String(q.ver));
  txt(
    '#o-vers',
    `${q.n} × ${q.n} モジュール · 誤り訂正 ${q.ecc}${q.ecc !== q.ecc0 ? `（${q.ecc0} から上げた）` : ''} · ブロック ${nb}`,
  );
  txt('#o-data', `${q.bk.data - pads} / ${q.bk.data} 語`);
  txt('#o-datas', `埋め草 ${pads} 語`);
  txt('#o-ec', `${q.bk.ec * nb} 語`);
  txt('#o-ecs', nb > 1 ? `ブロックごとに ${q.bk.ec / 2} 語まで訂正できる` : `${q.bk.ec / 2} 語まで訂正できる`);
  txt('#o-mask', String(q.mask));
  txt(
    '#o-masks',
    `ペナルティ ${q.pens[q.mask].total}${maskFix >= 0 && q.mask !== best ? `（最小は ${best} の ${q.pens[best].total}）` : ''}`,
  );
  const dark = q.pens[q.mask].dark;
  txt('#o-dark', `${((dark / (q.n * q.n)) * 100).toFixed(1)} %`);
  txt('#o-darks', `${dark} / ${q.n * q.n}`);
  txt('#o-room', `${room} ${unit}`);
  txt(
    '#o-rooms',
    up.length
      ? `${up[up.length - 1]} でも同じバージョン`
      : q.ecc === 'H'
        ? 'いちばん高いレベル'
        : '上のレベルではバージョンが上がる',
  );
  txt('#o-rem', String(rem));
  txt('#o-rems', `バージョン ${q.ver} の端数`);
  txt('#m-ver', `${q.ver}`);
  txt('#m-ecc', q.ecc);
  txt('#m-mask', String(q.mask));
}

const maskBtns = $$<HTMLButtonElement>('#q-masks button');
maskBtns.forEach((b, i) => {
  b.addEventListener('click', () => {
    maskFix = i;
    saveMask();
    mautoCh.set('fix');
    mark();
    rebuild();
  });
});
let maskKey = '';
function maskPanel(): void {
  if (!q) return;
  const best = q.pens.reduce((b, x, i, a) => (x.total < a[b].total ? i : b), 0),
    max = Math.max(...q.pens.map((p) => p.total));
  if (maskKey !== `${q.ver}`) {
    maskKey = `${q.ver}`;
    const side = q.n + 2,
      k = Math.max(1, Math.round((58 * devicePixelRatio) / side));
    maskBtns.forEach((b, i) => {
      const c = b.querySelector('canvas') as HTMLCanvasElement;
      c.width = side * k;
      c.height = side * k;
      drawMask(c.getContext('2d') as CanvasRenderingContext2D, k, q as Encoded, i);
    });
  }
  maskBtns.forEach((b, i) => {
    b.setAttribute('aria-pressed', String(i === q?.mask));
    b.classList.toggle('best', i === best);
    const s = b.querySelector('.t span') as HTMLElement;
    s.textContent = String(q?.pens[i].total);
    b.title = `マスク ${i}: ペナルティ ${q?.pens[i].total}`;
  });
  const w = (v: number) => `${((v / max) * 100).toFixed(2)}%`;
  html(
    '#q-pen',
    q.pens
      .map(
        (p, i) =>
          `<div class="r${i === q?.mask ? ' on' : ''}"><span>${i}${i === best ? ' ◆' : ''}</span><span class="bar" title="N1 ${p.n1} · N2 ${p.n2} · N3 ${p.n3} · N4 ${p.n4}"><i class="n1" style="width:${w(p.n1)}"></i><i class="n2" style="width:${w(p.n2)}"></i><i class="n3" style="width:${w(p.n3)}"></i><i class="n4" style="width:${w(p.n4)}"></i></span><span>${p.total}</span></div>`,
      )
      .join(''),
  );
}

/* ---------- 読み取り結果 ---------- */
function readPanel(): void {
  if (!q) return;
  const changed = soil ? soil.reduce((a, v, i) => a + (v !== q?.mods[i] ? 1 : 0), 0) : 0,
    d = soil && changed ? dec : baseDec;
  txt('#q-readst', changed ? `変わったモジュール ${changed} 個` : '');
  txt('#m-err', d ? String(d.rs.reduce((a, r) => a + (r.ok ? r.fixes.length : 0), 0)) : DASH);
  if (!d) {
    html('#q-meters', '');
    html('#q-out', '<span class="q-ng">読み取り失敗（形式情報が 2 か所とも 4 ビット以上ずれた）</span>');
    return;
  }
  /* ブロックごとの誤りの数（元と違う符号語）と上限 */
  const nb = q.bk.sizes.length,
    t = q.bk.ec / 2;
  let mh = '';
  for (let b = 0; b < nb; b++) {
    let e = 0;
    d.src.forEach((s, i) => {
      if (s.b === b && d.recv[i] !== q?.cw[i]) e++;
    });
    const over = e > t,
      cells = Array.from({ length: q.bk.ec }, (_, i) => `<i${i < 2 * e ? ' class="on"' : ''}></i>`).join('');
    mh += `<div class="q-meter${over ? ' over' : ''}"><div class="lab"><span>${nb > 1 ? `ブロック ${b + 1}` : '誤った符号語'}</span><b>${e} <small>/ ${t} 語</small></b></div><div class="q-cells">${cells}</div>${b === 0 ? '<span class="sc2">誤り 1 語に誤り訂正語 2 語を使う</span>' : ''}</div>`;
  }
  html('#q-meters', mh);
  if (!changed) {
    html('#q-out', `<span class="k">読み取れた文字列</span><span class="v">${esc(d.parsed.text)}</span>`);
    return;
  }
  const fixedPos = new Set<number>();
  for (let i = 0; i < d.recv.length; i++) if (d.recv[i] !== d.fixed[i]) fixedPos.add(i);
  const wrongPos = new Set<number>();
  for (let i = 0; i < d.recv.length; i++) if (d.recv[i] !== q.cw[i]) wrongPos.add(i);
  /** 文字のビットの範囲が、印の付いた符号語にかかるか */
  const hits = (from: number, to: number, set: Set<number>) => {
    for (let b = from; b < to; b += 1) if (set.has(d.dataPos[b >> 3])) return true;
    return false;
  };
  const show = (p: Decoded['parsed'], set: Set<number>, tag: string) =>
    p.chars.map((c) => (hits(c.from, c.to, set) ? `<${tag}>${esc(vis(c.s))}</${tag}>` : esc(c.s))).join('');
  const nFix = fixedPos.size;
  let out = '';
  if (wrongPos.size)
    out += `<span class="k">訂正しないで読み取ると</span><span class="v">${show(d.raw, wrongPos, 'u') || '（読めない）'}</span>`;
  if (d.ok && d.parsed.text === q.text)
    out += `<span class="k">リード・ソロモン符号で訂正すると</span><span class="v">${show(d.parsed, fixedPos, 'em')}</span><span class="q-ok">${nFix ? `読み取り成功（${nFix} 語を訂正）` : '読み取り成功（誤りなし）'}</span>`;
  else if (d.ok)
    out += `<span class="k">リード・ソロモン符号で訂正すると</span><span class="v">${esc(d.parsed.text)}</span><span class="q-ng">読み取り失敗（誤りが多すぎて、別の正しい符号語に訂正してしまった）</span>`;
  else {
    const bad = d.rs.map((r, i) => (r.ok ? -1 : i + 1)).filter((i) => i > 0);
    out += `<span class="q-ng">読み取り失敗（訂正できる上限を超えた${nb > 1 ? `: ブロック ${bad.join('・')}` : ''}）</span>`;
  }
  html('#q-out', out);
}

/* ---------- 保存 ---------- */
$('#saveBtn').addEventListener('click', () => {
  if (!q) return;
  const m = act === 'soil' && soil ? soil : q.mods,
    c = document.createElement('canvas'),
    k = 8,
    side = (q.n + 2 * QZ) * k;
  c.width = side;
  c.height = side;
  drawPlain(c.getContext('2d') as CanvasRenderingContext2D, k, m, q.n);
  c.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'qr-code.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

ready = true;
rebuild();

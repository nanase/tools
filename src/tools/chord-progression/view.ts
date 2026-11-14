/**
 * コード進行のページの「進行」の枠の 3 つの表示: 譜面（ブロックを小節の幅で折り返す）・レーン（横軸が時間）・五度圏。
 * どれも曲の計算（song.ts の Timeline）から HTML を作り、演奏中の位置だけを要素の class と位置で動かす
 */
import { esc } from '../../lib/dom';
import type { Occ } from './audio';
import { ICON, keySig } from './icons';
import { type ChordEntry, type Item, isChord, type MarkEntry, repeatStart, type Timeline } from './song';
import {
  type Chord,
  chordName,
  DIATONIC,
  func,
  type Key,
  keyTonic,
  type Lv,
  lvName,
  md,
  modeName,
  namedNext,
  OTHER,
  PATS,
  patGlyph,
  QUALS,
  roman,
  sigOf,
  trans,
  VOICES,
  voicing,
} from './theory';

export type ViewId = 'score' | 'lanes' | 'wheel';
export interface Ctx {
  tl: Timeline;
  items: readonly Item[];
  sel: number | null;
  /** 止まっている間に次に弾き始めるコードの id */
  cue: number | null;
  nOf: 3 | 4;
}
/** ドラッグで入れる位置: index はブロックの並びの位置、cx・cy・ch は印の線（枠の中の座標） */
export interface Target {
  index: number;
  cx: number;
  cy: number;
  ch: number;
}
export interface Drag {
  id: number;
  kind: Item['k'];
}

/* ---------- 共通の部品 ---------- */
/** つながりの矢印（強さで太さと破線を変える） */
export function arrow(lv: Lv): string {
  if (lv < 1) return '<svg class="cp-ar" viewBox="0 0 16 14" aria-hidden="true"></svg>';
  const w = [0, 1.2, 2, 3.4][lv],
    x = lv === 3 ? 8 : 9;
  return `<svg class="cp-ar" viewBox="0 0 16 14" aria-hidden="true"><path class="cp-arl${lv === 1 ? ' d' : ''}" d="M1 7H${x + 1}" stroke-width="${w}"/><path class="cp-arh" d="M${x} 2.5L15 7L${x} 11.5Z"/></svg>`;
}
const trTitle = (e: ChordEntry): string => {
  if (!e.tr || !e.prev) return '';
  if (e.tr.lv < 0) return '転調をまたぐつながり';
  return `${roman(e.prev.it, e.prev.key)} → ${roman(e.it, e.key)}: ${lvName(e.tr.lv)}${e.tr.name ? ` · ${e.tr.name}` : ''}`;
};
const repLabel = (n: number): string => (n === 0 ? '∞' : `×${n}`);
/** 目印のブロックの中身 */
export const keyShort = (k: Key): string => `${keyTonic(k)}${k.m === 'min' ? 'm' : ''}`;
/** 目印のブロックの中身（文字を減らし、記号とアイコンで描く。名前は title に出す） */
function markInner(e: MarkEntry): string {
  const it = e.it;
  switch (it.k) {
    case 'key':
      return `<b class="cp-kt">${keyShort(e.key)}</b><span class="cp-ks">${keySig(e.key.t, e.key.m) || '&nbsp;'}</span>`;
    case 'met':
      return `<span class="cp-ts"><b>${it.n}</b><b>${it.dn}</b></span>`;
    case 'tmp':
      return `${ICON.click}<b>${it.v}</b>`;
    case 'pat':
      return patGlyph(it.v, 'cp-mg');
    case 'vce':
      return ICON[it.v].replace('class="cp-ic"', 'class="cp-ic cp-big"');
    case 'rs':
      return '<b class="cp-rp">𝄆</b>';
    case 're':
      return `<b class="cp-rp">𝄇</b><span class="cp-ms cp-pass" data-l="${repLabel(it.n)}">${repLabel(it.n)}</span>`;
  }
}
/** 目印のブロックの名前（指したときの吹き出しと読み上げ） */
export function markTitle(e: MarkEntry): string {
  const it = e.it;
  switch (it.k) {
    case 'key':
      return `${e.first ? '調' : '転調'} ${keyTonic(e.key)} ${modeName(e.key)}`;
    case 'met':
      return `拍子 ${it.n}/${it.dn}`;
    case 'tmp':
      return `テンポ ♩=${it.v}`;
    case 'pat':
      return `奏法 ${PATS[it.v].name}`;
    case 'vce':
      return `音色 ${VOICES[it.v]}`;
    case 'rs':
      return 'くり返しの始め';
    case 're':
      return `くり返しの終わり ${it.n === 0 ? '無制限' : `${it.n} 回`}`;
  }
}
function markHTML(e: MarkEntry, c: Ctx, extra = ''): string {
  return `<div class="cp-it cp-mk cp-mk-${e.it.k}${c.sel === e.it.id ? ' sel' : ''}" data-id="${e.it.id}" title="${esc(markTitle(e))}" aria-label="${esc(markTitle(e))}" role="button" tabindex="0"${extra}>${markInner(e)}</div>`;
}
const blockW = (beats: number, cmp: boolean): number =>
  Math.max(cmp ? 52 : 58, cmp ? 16 + beats * 16 : 22 + beats * 21);
function chordHTML(e: ChordEntry, c: Ctx, cmp: boolean, style = '', g = -1): string {
  const it = e.it,
    name = chordName(it, e.key),
    rm = roman(it, e.key);
  let h = `<div class="cp-it cp-ch cp-f${func(it, e.key)}${c.sel === it.id ? ' sel' : ''}${c.cue === it.id ? ' cue' : ''}" data-id="${it.id}" style="${style || `width:${blockW(e.beats, cmp)}px`}" title="${esc(`${rm} · ${name} · ${e.beats} 拍`)}" role="button" tabindex="0"${g >= 0 && e.grp ? ` data-g="${g}" data-gn="${esc(e.grp.n)}"` : ''}>`;
  h += `<div class="cp-rm">${rm}</div><div class="cp-cn">${name}</div>${patGlyph(e.pat, `cp-gl${e.patOwn ? ' own' : ''}`)}`;
  h += `<div class="cp-bts">${'<i></i>'.repeat(e.beats)}</div>`;
  for (const b of e.bars) {
    const x = (b.o / e.beats) * 100;
    if (b.o > 0) h += `<i class="cp-bl" style="left:${x}%"></i>`;
    h += `<span class="cp-bn" style="left:${b.o ? `calc(${x}% + 2px)` : '0'}">${b.no}</span>`;
  }
  return `${h}<i class="cp-phl"></i><i class="cp-cuem" aria-hidden="true"></i></div>`;
}
/** ブロックを並びの順に（譜面と五度圏の下の帯） */
function seqHTML(c: Ctx, cmp: boolean): string {
  let h = '',
    g = -1;
  for (const e of c.tl.all) {
    if (isChord(e)) {
      if (e.grp?.first) g++;
      if (e.adj && e.tr) {
        h += `<div class="cp-jn" title="${esc(trTitle(e))}">${arrow(e.tr.lv)}${e.tr.name ? `<span class="cp-cad">${e.tr.name}</span>` : ''}</div>`;
      } else if (e.prev) h += '<div class="cp-jn"></div>';
      h += chordHTML(e, c, cmp, '', e.grp ? g : -1);
    } else h += markHTML(e, c);
  }
  return h || '<p class="cp-empty">下のパレットからブロックを置いてください。</p>';
}

/**
 * 名前のある進行の括弧を、描いたあとのブロックの位置から行ごとに 1 本の線で引く（譜面と五度圏の帯）。
 * ブロックと矢印で別々に引くと、枠線の分だけ高さがずれる
 */
export function drawBands(box: HTMLElement | null): void {
  if (!box) return;
  for (const el of box.querySelectorAll('.cp-nmb')) el.remove();
  const br = box.getBoundingClientRect(),
    groups = new Map<string, { n: string; rs: DOMRect[] }>();
  for (const el of box.querySelectorAll<HTMLElement>('.cp-ch[data-g]')) {
    const k = el.dataset.g as string,
      gr = groups.get(k) ?? { n: el.dataset.gn ?? '', rs: [] };
    gr.rs.push(el.getBoundingClientRect());
    groups.set(k, gr);
  }
  for (const { n, rs } of groups.values()) {
    const rows: DOMRect[][] = [];
    for (const r of rs) {
      const row = rows.at(-1);
      if (row && Math.abs(row[0].top - r.top) < 4) row.push(r);
      else rows.push([r]);
    }
    rows.forEach((row, j) => {
      const el = document.createElement('div'),
        l = row[0].left,
        rt = (row.at(-1) as DOMRect).right;
      el.className = `cp-nmb${j === 0 ? ' first' : ''}${j === rows.length - 1 ? ' last' : ''}`;
      el.style.left = `${l - br.left + box.scrollLeft}px`;
      el.style.top = `${row[0].top - br.top + box.scrollTop - 24}px`;
      el.style.width = `${rt - l}px`;
      if (j === 0) {
        const sp = document.createElement('span');
        sp.textContent = n;
        el.appendChild(sp);
      }
      box.appendChild(el);
    });
  }
}

/** 鳴っているコードに印を付ける（譜面と五度圏の帯） */
function markNow(root: ParentNode, occ: Occ | null, frac: number): void {
  for (const el of root.querySelectorAll<HTMLElement>('.cp-it.now'))
    if (Number(el.dataset.id) !== occ?.id) el.classList.remove('now');
  for (const el of root.querySelectorAll<HTMLElement>('.cp-pass.on')) {
    el.textContent = el.dataset.l ?? '';
    el.classList.remove('on');
  }
  if (!occ) return;
  const el = root.querySelector<HTMLElement>(`.cp-ch[data-id="${occ.id}"]`);
  if (el) {
    el.classList.add('now');
    const l = el.querySelector<HTMLElement>('.cp-phl');
    if (l) l.style.left = `${Math.min(1, frac) * 100}%`;
  }
  if (occ.rep) {
    for (const p of root.querySelectorAll<HTMLElement>(`[data-id="${occ.rep.id}"] .cp-pass`)) {
      const n = p.dataset.l ?? '';
      p.textContent = `${occ.rep.pass}/${n.replace('×', '')}`;
      p.classList.add('on');
    }
  }
}
/** 並びの順の要素から、入れる位置を決める（譜面と五度圏の帯） */
function domTarget(box: HTMLElement | null, x: number, y: number, d: Drag, items: readonly Item[]): Target | null {
  if (!box) return null;
  const br = box.getBoundingClientRect();
  if (x < br.left - 30 || x > br.right + 30 || y < br.top - 40 || y > br.bottom + 40) return null;
  const els = [...box.querySelectorAll<HTMLElement>('.cp-it')].filter((el) => Number(el.dataset.id) !== d.id);
  if (!els.length) return { index: items.length, cx: 12, cy: 24, ch: 72 };
  let best: { el: HTMLElement; before: boolean; r: DOMRect } | null = null,
    bd = Number.POSITIVE_INFINITY;
  for (const el of els) {
    const r = el.getBoundingClientRect(),
      dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0,
      before = x < r.left + r.width / 2,
      dist = dy * 4 + Math.abs(x - (before ? r.left : r.right));
    if (dist < bd) {
      bd = dist;
      best = { el, before, r };
    }
  }
  if (!best) return null;
  const ix = items.findIndex((it) => it.id === Number(best.el.dataset.id));
  return {
    index: ix + (best.before ? 0 : 1),
    cx: (best.before ? best.r.left - 5 : best.r.right + 5) - br.left + box.scrollLeft,
    cy: best.r.top - br.top + box.scrollTop,
    ch: best.r.height,
  };
}

export interface View {
  html(c: Ctx): string;
  /** 描いたあとに呼ぶ */
  mount(root: HTMLElement, c: Ctx): void;
  playhead(root: HTMLElement, c: Ctx, occ: Occ | null, frac: number): void;
  target(root: HTMLElement, x: number, y: number, d: Drag, c: Ctx): Target | null;
}

/* ---------- 譜面 ---------- */
const score: View = {
  html: (c) => `<div class="cp-sc" id="cp-sc">${seqHTML(c, false)}<div class="cp-caret" id="cp-caret"></div></div>`,
  mount: (root) => drawBands(root.querySelector('#cp-sc')),
  playhead: (root, _c, occ, f) => markNow(root, occ, f),
  target: (root, x, y, d, c) => domTarget(root.querySelector('#cp-sc'), x, y, d, c.items),
};

/* ---------- レーン ---------- */
const PX = 24,
  LX = 84;
const LANES: readonly (readonly [string, string, number])[] = [
  ['ruler', '', 16],
  ['key', '調', 26],
  ['met', '拍子・テンポ', 26],
  ['rep', 'くり返し', 24],
  ['nm', '進行の名前', 18],
  ['ch', 'コード', 66],
  ['jn', 'つながり', 18],
  ['pat', '奏法', 26],
  ['vce', '音色', 26],
  ['roll', '鳴る音', 110],
];
const xq = (q: number): number => LX + q * PX;
function laneRoll(tl: Timeline, w: number): string {
  const lo = 38,
    hi = 78,
    H = 104,
    ym = (m: number) => 3 + ((hi - m) / (hi - lo)) * H;
  let s = `<svg class="cp-roll" width="${w}" height="110" aria-hidden="true">`;
  for (const e of tl.chords) {
    const tones = voicingOf(e),
      S = Math.max(1, Math.round(e.durQ * 2)),
      w1 = (e.durQ * PX) / S;
    for (const x of PATS[e.pat].g(tones.length, S)) {
      const ms = x.i === 'all' ? tones : [tones[x.i]],
        x0 = xq(e.q) + x.s * w1,
        len = Math.max(3, (S - x.s) * w1 - 1);
      for (const m of ms)
        s += `<rect class="${m === tones[0] ? 'cp-rb' : `cp-r${func(e.it, e.key)}`}" x="${x0.toFixed(1)}" y="${(ym(m) - 2).toFixed(1)}" width="${len.toFixed(1)}" height="4" rx="1"/>`;
    }
  }
  return `${s}</svg>`;
}
const voicingOf = (e: ChordEntry): number[] => voicing(e.it, e.key);
const lanes: View = {
  html(c) {
    const { tl, items } = c,
      tq = Math.max(tl.totalQ, 8) + 4,
      W = LX + tq * PX,
      body: Record<string, string> = {};
    for (const [k] of LANES) body[k] = '';
    let grid = '';
    for (const e of tl.chords) {
      const bq = 4 / e.dn;
      for (let k = 0; k < e.beats; k++) {
        const bar = e.bars.find((b) => b.o === k),
          x = xq(e.q + k * bq);
        if (bar) body.ruler += `<span style="left:${x + 2}px">${bar.no}</span>`;
        grid += `<i class="cp-vl${bar ? '' : ' beat'}" style="left:${x}px"></i>`;
      }
    }
    const marks = (k: Item['k']) => tl.all.filter((e): e is MarkEntry => e.it.k === k);
    const spans = (k: Item['k'], label: (e: MarkEntry) => string) => {
      const ms = marks(k);
      return ms
        .map((e, j) => {
          const end = j + 1 < ms.length ? ms[j + 1].q : tq - 4;
          return `<div class="cp-bx cp-span k${j % 2}${c.sel === e.it.id ? ' sel' : ''}" data-id="${e.it.id}" style="left:${xq(e.q)}px;width:${Math.max(52, (end - e.q) * PX - 2)}px" role="button" tabindex="0" title="${esc(markTitle(e))}">${label(e)}</div>`;
        })
        .join('');
    };
    body.key = spans('key', (e) => `<b>${keyShort(e.key)}</b> ${keySig(e.key.t, e.key.m)}`);
    body.pat = spans('pat', (e) => (e.it.k === 'pat' ? `${patGlyph(e.it.v)}${PATS[e.it.v].name}` : ''));
    body.vce = spans('vce', (e) => (e.it.k === 'vce' ? `${ICON[e.it.v]}${VOICES[e.it.v]}` : ''));
    const at: Record<number, number> = {};
    for (const e of tl.all) {
      if (e.it.k !== 'met' && e.it.k !== 'tmp') continue;
      const me = e as MarkEntry,
        o = at[me.q] ?? 0;
      at[me.q] = o + 1;
      body.met += `<div class="cp-bx cp-flag${c.sel === e.it.id ? ' sel' : ''}" data-id="${e.it.id}" style="left:${xq(me.q) + o * 62}px;width:58px" role="button" tabindex="0" title="${esc(markTitle(me))}">${e.it.k === 'met' ? `${e.it.n}/${e.it.dn}` : `♩=${e.it.v}`}</div>`;
    }
    for (const e of tl.all) {
      if (e.it.k === 'rs')
        body.rep += `<div class="cp-bx cp-flag cp-rsf${c.sel === e.it.id ? ' sel' : ''}" data-id="${e.it.id}" style="left:${xq((e as MarkEntry).q)}px;width:30px" role="button" tabindex="0" title="くり返しの始め">𝄆</div>`;
      if (e.it.k === 're') {
        const s0 = repeatStart(items, e.i),
          first = tl.all.find((x) => x.i >= s0),
          q0 = first ? ('q' in first ? first.q : 0) : 0,
          q1 = (e as MarkEntry).q;
        body.rep += `<div class="cp-bx cp-span cp-res${c.sel === e.it.id ? ' sel' : ''}" data-id="${e.it.id}" style="left:${xq(q0) + 32}px;width:${Math.max(56, (q1 - q0) * PX - 34)}px" role="button" tabindex="0" title="くり返しの終わり"><span class="cp-pass" data-l="${repLabel(e.it.n)}">${repLabel(e.it.n)}</span> 𝄇</div>`;
      }
    }
    for (const e of tl.chords) {
      const x = xq(e.q),
        w = e.durQ * PX - 3;
      body.ch += chordHTML(e, c, false, `left:${x + 1}px;width:${w}px`);
      if (e.patOwn)
        body.pat += `<div class="cp-bx cp-own" data-sel="${e.it.id}" style="left:${x + 1}px;width:${w}px">${patGlyph(e.pat)}${w > 110 ? PATS[e.pat].name : ''}</div>`;
      if (e.adj && e.tr) {
        body.jn += `<span class="cp-bj" style="left:${x}px" title="${esc(trTitle(e))}">${arrow(e.tr.lv)}</span>`;
        if (e.tr.name) body.jn += `<span class="cp-cad cp-cadb" style="left:${x + 11}px">${e.tr.name}</span>`;
      }
      if (e.grp?.first) {
        const L = tl.chords.slice(e.ci).find((x) => x.grp?.last) ?? e;
        body.nm += `<div class="cp-nmbx cp-nm" style="left:${x + 1}px;width:${(L.q + L.durQ - e.q) * PX - 3}px"><span>${e.grp.n}</span></div>`;
      }
    }
    body.roll = laneRoll(tl, W);
    let h = `<div class="cp-lnw" id="cp-lnw"><div class="cp-ln" id="cp-ln" style="width:${W}px"><div class="cp-grid">${grid}</div>`;
    for (const [k, lab, hh] of LANES)
      h += `<div class="cp-lr cp-lr-${k}" style="height:${hh}px"><div class="cp-lh">${lab}</div>${body[k]}</div>`;
    return `${h}<i class="cp-phv" id="cp-phv"></i><div class="cp-caret" id="cp-caret"></div></div></div>`;
  },
  mount(root, c) {
    if (c.cue === null) return;
    const e = c.tl.chords.find((x) => x.it.id === c.cue),
      w = root.querySelector<HTMLElement>('#cp-lnw');
    if (e && w) {
      const x = xq(e.q);
      if (x > w.scrollLeft + w.clientWidth - 60 || x < w.scrollLeft + LX) w.scrollLeft = x - LX - 40;
    }
  },
  playhead(root, _c, occ, f) {
    markNow(root, occ, f);
    const phv = root.querySelector<HTMLElement>('#cp-phv'),
      w = root.querySelector<HTMLElement>('#cp-lnw');
    if (!phv || !w) return;
    if (!occ) {
      phv.style.display = 'none';
      return;
    }
    const x = xq(occ.e.q + Math.min(1, f) * occ.e.durQ);
    phv.style.display = 'block';
    phv.style.left = `${x}px`;
    if (x > w.scrollLeft + w.clientWidth - 60 || x < w.scrollLeft + LX) w.scrollLeft = x - LX - 40;
  },
  target(root, x, y, d, c) {
    const ln = root.querySelector<HTMLElement>('#cp-ln');
    if (!ln) return null;
    const br = ln.getBoundingClientRect();
    if (y < br.top - 30 || y > br.bottom + 30) return null;
    const q = (x - br.left - LX) / PX,
      { items, tl } = c,
      j = tl.chords.findIndex((e) => q < e.q + e.durQ / 2 && e.it.id !== d.id);
    let index: number, cq: number;
    if (j < 0) {
      index = items.length;
      cq = tl.totalQ;
    } else {
      const e = tl.chords[j];
      cq = e.q;
      index = e.i;
      /* コードは、そのコードに付いた目印（転調など）の前へ入れる */
      if (d.kind === 'ch') while (index > 0 && items[index - 1].k !== 'ch' && items[index - 1].id !== d.id) index--;
    }
    return { index, cx: xq(cq), cy: 0, ch: br.height };
  },
};

/* ---------- 五度圏 ---------- */
const FIFTH = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const W_MAJ = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
const W_MIN = ['Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m', 'D♯m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm'];
const W_DIM = ['B°', 'F♯°', 'C♯°', 'G♯°', 'D♯°', 'A♯°', 'E♯°', 'C°', 'G°', 'D°', 'A°', 'E°'];
const RING = [
  [170, 124],
  [122, 82],
  [80, 50],
] as const;
const pol = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
const angOf = (ix: number) => ((ix * 30 - 90) * Math.PI) / 180;
/** 円の上の場所（輪: 0 長三和音・1 短三和音・2 減三和音） */
function ringOf(c: Chord, k: Key): { ring: number; ix: number } {
  const r = md(k.t + c.d),
    b = QUALS[c.q].b;
  if (b === 'M') return { ring: 0, ix: FIFTH.indexOf(r) };
  if (b === 'm') return { ring: 1, ix: FIFTH.indexOf(md(r + 3)) };
  return { ring: 2, ix: FIFTH.indexOf(md(r + 1)) };
}
const ctrOf = (c: Chord, k: Key): [number, number] => {
  const { ring, ix } = ringOf(c, k);
  return pol(angOf(ix), (RING[ring][0] + RING[ring][1]) / 2);
};
/** 次の候補（強い順） */
export function candidates(e: ChordEntry, nOf: 3 | 4): { c: Chord; lv: Lv; name: string }[] {
  const k = e.key,
    seen = new Set<string>(),
    out: { c: Chord; lv: Lv; name: string }[] = [];
  const add = (d: number, q: Chord['q']) => {
    if (seen.has(`${d}${q}`)) return;
    seen.add(`${d}${q}`);
    const c: Chord = { d, q, inv: 0 },
      tr = trans(e.it, k, c, k);
    out.push({ c, ...tr });
  };
  for (const [d, q] of DIATONIC[k.m][nOf]) add(d, q);
  for (const [d, q] of OTHER[k.m]) add(d, q);
  for (const [d, q] of DIATONIC[k.m][nOf === 3 ? 4 : 3]) add(d, q);
  return out.sort((a, b) => b.lv - a.lv);
}
/** 五度圏で見るコード: 演奏中は鳴っているコード、止まっていれば選んだコード・弾き始めのコード・最後のコード */
function focus(c: Ctx, occ: Occ | null): ChordEntry | null {
  if (occ) return occ.e;
  for (const id of [c.sel, c.cue]) {
    const e = c.tl.all.find((x) => x.it.id === id);
    if (e && isChord(e)) return e;
  }
  return c.tl.chords.at(-1) ?? null;
}
function wheelSVG(c: Ctx, e: ChordEntry | null): string {
  const k = e ? e.key : c.tl.end.key,
    ti = FIFTH.indexOf(k.m === 'min' ? md(k.t + 3) : k.t);
  let s = '<svg class="cp-wheel" viewBox="-180 -180 360 360" role="img" aria-label="五度圏と次のコードの候補">';
  for (let ring = 0; ring < 3; ring++)
    for (let ix = 0; ix < 12; ix++) {
      const [ro, ri] = RING[ring],
        a0 = angOf(ix - 0.5),
        a1 = angOf(ix + 0.5),
        p = [pol(a0, ro), pol(a1, ro), pol(a1, ri), pol(a0, ri)],
        dd = (ix - ti + 12) % 12,
        lit = (dd === 0 || dd === 1 || dd === 11) && (ring < 2 || dd === 0),
        pcR = FIFTH[ix],
        pc = ring === 0 ? pcR : ring === 1 ? md(pcR - 3) : md(pcR - 1),
        q = ring === 0 ? 'M' : ring === 1 ? 'm' : 'dim',
        ch: Chord = { d: md(pc - k.t), q, inv: 0 },
        nm = lit ? chordName(ch, k).replace('dim', '°') : [W_MAJ, W_MIN, W_DIM][ring][ix],
        [tx, ty] = pol(angOf(ix), (ro + ri) / 2),
        f = (v: [number, number]) => `${v[0].toFixed(1)} ${v[1].toFixed(1)}`;
      s += `<g class="cp-wseg${lit ? ' lit' : ''}" data-d="${ch.d}" data-q="${q}" role="button" aria-label="${esc(`${nm}を後ろに追加`)}"><path d="M${f(p[0])}A${ro} ${ro} 0 0 1 ${f(p[1])}L${f(p[2])}A${ri} ${ri} 0 0 0 ${f(p[3])}Z"/>`;
      s += `<text class="cp-wn r${ring}" x="${tx.toFixed(1)}" y="${(ty + (lit ? -2 : 4)).toFixed(1)}">${nm}</text>`;
      if (lit)
        s += `<text class="cp-wr cp-t${func(ch, k)}" x="${tx.toFixed(1)}" y="${(ty + 12).toFixed(1)}">${roman(ch, k)}</text>`;
      s += '</g>';
    }
  s += `<text class="cp-wk" x="0" y="4">${keyTonic(k)} ${modeName(k)}</text>`;
  if (e) {
    const [cx, cy] = ctrOf(e.it, e.key);
    let arr = '';
    for (const x of candidates(e, c.nOf)) {
      if (x.lv < 2) continue;
      const [x2, y2] = ctrOf(x.c, e.key);
      if (Math.hypot(x2 - cx, y2 - cy) < 1) continue;
      const mx = (cx + x2) * 0.35,
        my = (cy + y2) * 0.35,
        ang = Math.atan2(y2 - my, x2 - mx),
        ex = x2 - Math.cos(ang) * 16,
        ey = y2 - Math.sin(ang) * 16,
        hs = x.lv === 3 ? 9 : 7,
        tip = (da: number, r: number) =>
          `${(ex + Math.cos(ang + da) * r).toFixed(1)} ${(ey + Math.sin(ang + da) * r).toFixed(1)}`;
      arr += `<g class="cp-wa l${x.lv}"><path class="cp-wal" d="M${cx.toFixed(1)} ${cy.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}"/><path class="cp-wah" d="M${tip(0, hs)}L${tip(2.5, hs * 0.8)}L${tip(-2.5, hs * 0.8)}Z"/></g>`;
    }
    s += `<g class="cp-war">${arr}</g><circle class="cp-wcur" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="17"/>`;
  }
  return `${s}</svg>`;
}
function candHTML(c: Ctx, e: ChordEntry | null): string {
  if (!e) return '<p class="cp-empty">コードを置くと次の候補が出ます。</p>';
  const sug = namedNext(c.tl.chords.slice(0, e.ci + 1).map((x) => ({ c: x.it, key: x.key, i: x.i }))),
    list = candidates(e, c.nOf)
      .filter((x) => x.lv >= 1)
      .slice(0, 9);
  let h = `<h3 class="cp-ch3"><b>${roman(e.it, e.key)}</b>（${chordName(e.it, e.key)}）の次の候補</h3><div class="cp-clist">`;
  for (const x of list) {
    const g = sigOf(x.c, e.key),
      s = sug.find((y) => y.s[0] === g[0] && y.s[1] === g[1]);
    h += `<button type="button" class="cp-f${func(x.c, e.key)}" data-add="${x.c.d},${x.c.q}"><span class="r">${roman(x.c, e.key)}</span><span class="n">${chordName(x.c, e.key)}</span><span class="c">${x.name || (s ? `${s.n}の続き` : '')}</span><span class="l">${lvName(x.lv)}</span></button>`;
  }
  return `${h}</div>`;
}
const wheel: View & { last: number; draw(root: HTMLElement, c: Ctx, occ: Occ | null): void } = {
  last: -2,
  html: (c) =>
    `<div class="cp-wtop"><div id="cp-wh"></div><div class="cp-cand" id="cp-cand"></div></div><div class="cp-sc cmp" id="cp-sc">${seqHTML(c, true)}<div class="cp-caret" id="cp-caret"></div></div>`,
  mount(root, c) {
    this.draw(root, c, null);
    drawBands(root.querySelector('#cp-sc'));
    const el = root.querySelector<HTMLElement>('.cp-ch.cue, .cp-ch.sel'),
      sc = root.querySelector<HTMLElement>('#cp-sc');
    if (el && sc) sc.scrollLeft = Math.max(0, el.offsetLeft - sc.clientWidth / 2);
  },
  draw(root, c, occ) {
    const e = focus(c, occ);
    const wh = root.querySelector('#cp-wh'),
      cd = root.querySelector('#cp-cand');
    if (wh) wh.innerHTML = wheelSVG(c, e);
    if (cd) cd.innerHTML = candHTML(c, e);
    this.last = e ? e.it.id : -1;
  },
  playhead(root, c, occ, f) {
    markNow(root, occ, f);
    if (occ && occ.id !== this.last) {
      this.draw(root, c, occ);
      const el = root.querySelector<HTMLElement>(`#cp-sc .cp-ch[data-id="${occ.id}"]`),
        sc = root.querySelector<HTMLElement>('#cp-sc');
      if (el && sc) sc.scrollLeft = Math.max(0, el.offsetLeft - sc.clientWidth / 2);
    }
  },
  target: (root, x, y, d, c) => domTarget(root.querySelector('#cp-sc'), x, y, d, c.items),
};

export const VIEWS: Record<ViewId, View> = { score, lanes, wheel };
export const redrawWheel = (root: HTMLElement, c: Ctx, occ: Occ | null): void => wheel.draw(root, c, occ);

/**
 * QR コードの構造の右側（符号語の表の下）に出す説明の HTML。段ごとに、選んだ符号語のビットの中身・置いた場所・
 * マスク・形式情報を組む。値の計算は encode.ts・decode.ts、ここは見せ方だけ
 */
import { esc } from '../../lib/dom';
import type { Decoded } from './decode';
import { type Cat, catOf, STAGE } from './draw';
import { badChar, ccBits, type Encoded, MODE_NAME, needBits, type Span, units } from './encode';
import { MASK_TEXT, MASKS, versionBits } from './spec';

export const hex2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');
const CAT_NAME: Record<Cat, string> = { h: 'モードと文字数', d: 'データ', p: '終端と埋め草', e: '誤り訂正' };
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => [...String(n)].map((c) => SUP[Number(c)]).join('');
/** 見える形の文字（空白・制御文字を記号にする） */
export const vis = (s: string): string =>
  [...s.replace(/ /g, '␣')]
    .map((c) => (c.charCodeAt(0) < 0x20 ? String.fromCharCode(0x2400 + c.charCodeAt(0)) : c))
    .join('');

/** データの並びの番号（ブロックの順） */
export const dataIndex = (q: Encoded, c: number): number => {
  const s = q.src[c];
  return q.bk.sizes.slice(0, s.b).reduce((a, b) => a + b, 0) + s.i;
};

/* ---------- ビットの持ち主 ---------- */
export interface BitGroup {
  n: number;
  cls: 'h' | 'd' | 'p';
  label: string;
}
function spanLabel(q: Encoded, sp: Span): string {
  const ch = sp.c0 !== undefined ? vis(q.chars.slice(sp.c0, sp.c1).join('')) : '';
  switch (sp.k) {
    case 'mode':
      return 'モード指示子';
    case 'count':
      return `文字数 ${sp.v}`;
    case 'data':
      return q.mode === 'byte' ? `「${ch}」0x${hex2(sp.v)}` : `「${ch}」${sp.v}`;
    case 'term':
      return '終端';
    case 'fill':
      return '端数の 0';
    default:
      return `埋め草 0x${hex2(sp.v)}`;
  }
}
/** データの符号語 d の 8 ビットを、どの区切りのどの部分かでまとめる */
export function bitGroups(q: Encoded, d: number): BitGroup[] {
  const out: (BitGroup & { sp: Span; b0: number })[] = [];
  for (let b = d * 8; b < d * 8 + 8; b++) {
    const sp = q.spans.find((x) => b >= x.from && b < x.to);
    if (!sp) continue;
    const last = out[out.length - 1];
    if (last && last.sp === sp) last.n++;
    else
      out.push({
        n: 1,
        sp,
        b0: b,
        cls: sp.k === 'mode' || sp.k === 'count' ? 'h' : sp.k === 'data' ? 'd' : 'p',
        label: '',
      });
  }
  for (const g of out) {
    const len = g.sp.to - g.sp.from,
      base = spanLabel(q, g.sp);
    if (g.n === len) g.label = base;
    else if (g.b0 === g.sp.from) g.label = `${base} の上位 ${g.n} ビット`;
    else if (g.b0 + g.n === g.sp.to) g.label = `${base} の下位 ${g.n} ビット`;
    else g.label = `${base} の中ほど ${g.n} ビット`;
  }
  return out.map(({ n, cls, label }) => ({ n, cls, label }));
}

/** 符号語 c の 8 つのモジュール（ビット 7 から） */
export function cwModules(q: Encoded, c: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < q.n * q.n; i++) if (q.cwAt[i] === c) out[7 - q.bitAt[i]] = [i % q.n, Math.floor(i / q.n)];
  return out;
}

/* ---------- 段ごとの説明 ---------- */
/* 説明は短い「です・ます」の 1〜2 文にし、中身は図と表で見せる。class="a" の要素は --i の順に現れる（style.css） */
const note = (s: string) => `<p class="q-note a" style="--i:${NOTE_I}">${s}</p>`;
/** 説明の文は、図が出そろうころに出す */
const NOTE_I = 6;
const REPLAY =
  '<button type="button" class="q-replay" title="もう一度見る" aria-label="もう一度見る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V9h4.5"/></svg></button>';
const h3 = (s: string, replay = true) => `<h3><span>${s}</span>${replay ? REPLAY : ''}</h3>`;
const ai = (i: number) => ` style="--i:${i}"`;
const MAX_UNITS = 32;
const MODE_ORDER = ['num', 'alnum', 'kanji', 'byte'] as const;
const UNIT_TEXT: Record<string, string> = {
  num: '数字を 3 けたずつ 10 ビットにします。',
  alnum: '2 文字ずつ 11 ビットにします。',
  kanji: '1 文字を 13 ビットにします。',
  byte: '文字を UTF-8 のバイトにして、1 バイトを 8 ビットにします。',
};

export interface InspectOpts {
  /** モードを自動で選んだか */
  autoMode: boolean;
}

function stText(q: Encoded, o: InspectOpts): string {
  const pills = MODE_ORDER.map((m, i) => {
    const bad = badChar(q.chars, m) >= 0,
      bits = bad ? 0 : needBits(units(q.chars, m), m, q.ver);
    return `<span class="q-pill a${m === q.mode ? ' on' : ''}${bad ? ' no' : ''}"${ai(i)}>${MODE_NAME[m]}<small>${bad ? '使えない' : `${bits} ビット`}</small></span>`;
  }).join('');
  const chips = q.units
    .slice(0, MAX_UNITS)
    .map((u, i) => {
      const ch = vis(q.chars.slice(u.c0, u.c1).join('')),
        val = q.mode === 'byte' ? hex2(u.v) : q.mode === 'kanji' ? u.v.toString(16).toUpperCase() : String(u.v);
      return `<span class="q-chip a"${ai(4 + i * 0.5)}><b>${esc(ch)}</b><small>${val}</small></span>`;
    })
    .join('');
  const more = q.units.length > MAX_UNITS ? `<span class="q-more">…あと ${q.units.length - MAX_UNITS}</span>` : '';
  return (
    h3(`${q.chars.length} 文字を${MODE_NAME[q.mode]}モードで`) +
    `<div class="q-pills">${pills}</div>` +
    `<div class="q-chips">${chips}${more}</div>` +
    note(`${o.autoMode ? 'ビット列がいちばん短くなるモードを選びます。' : ''}${UNIT_TEXT[q.mode]}`)
  );
}

function stBits(q: Encoded): string {
  const data = q.spans.filter((s) => s.k === 'data'),
    pads = q.spans.filter((s) => s.k === 'pad'),
    bits = (s: Span) => Array.from(q.bits.slice(s.from, s.to)).join(''),
    cap = q.bits.length;
  let i = 0;
  const seg = (s: Span, cls: string, lab: string) =>
    `<span class="q-seg ${cls} a"${ai(i++)}><b>${bits(s)}</b><small>${esc(lab)}</small></span>`;
  let h = '';
  for (const s of q.spans.filter((x) => x.k === 'mode' || x.k === 'count'))
    h += seg(s, 'h', s.k === 'mode' ? 'モード' : `文字数 ${s.v}`);
  const head = data.slice(0, 6);
  for (const s of head) h += seg(s, 'd', vis(q.chars.slice(s.c0, s.c1).join('')));
  if (data.length > head.length + 1) h += `<span class="q-more a"${ai(i++)}>…</span>`;
  if (data.length > head.length) {
    const s = data[data.length - 1];
    h += seg(s, 'd', vis(q.chars.slice(s.c0, s.c1).join('')));
  }
  for (const s of q.spans.filter((x) => x.k === 'term' || x.k === 'fill'))
    h += seg(s, 'p', s.k === 'term' ? '終端' : '端数');
  for (const s of pads.slice(0, 2)) h += seg(s, 'p', '埋め草');
  if (pads.length > 2) h += `<span class="q-more a"${ai(i++)}>× ${pads.length}</span>`;
  const sum = (ks: string[]) => q.spans.filter((s) => ks.includes(s.k)).reduce((a, s) => a + s.to - s.from, 0),
    nh = sum(['mode', 'count']),
    nd = sum(['data']),
    np = cap - nh - nd,
    pc = (v: number) => `${((v / cap) * 100).toFixed(2)}%`;
  return (
    h3(`ビット列 · ${nh + nd} ビット`) +
    `<div class="q-segs">${h}</div>` +
    `<div class="q-capbar" role="img" aria-label="容量 ${cap} ビットの内訳"><i class="h" style="width:${pc(nh)};--i:0"></i><i class="d" style="width:${pc(nd)};--i:1"></i><i class="p" style="width:${pc(np)};--i:2"></i></div>` +
    `<div class="q-caplab"><span><i class="h"></i>見出し ${nh}</span><span><i class="d"></i>データ ${nd}</span><span><i class="p"></i>終端と埋め草 ${np}</span><span>容量 ${cap} ビット</span></div>` +
    note('モード・文字数・データの順に並べ、終端と埋め草で容量いっぱいまで埋めます。')
  );
}

/** 8 ビットの箱（1 ビットずつ現れる）と、その下の持ち主の名前 */
function bitBoxA(v: number, groups: BitGroup[], i0 = 0): string {
  let i = 0,
    cells = '',
    labs = '';
  groups.forEach((g, k) => {
    for (let j = 0; j < g.n; j++, i++)
      cells += `<span class="${g.cls}${k % 2 ? ' alt' : ''} a"${ai(i0 + i * 0.6)}>${(v >>> (7 - i)) & 1}</span>`;
    labs += `<span class="a" style="grid-column: span ${g.n};--i:${i0 + 5}">${esc(g.label)}</span>`;
  });
  return `<div class="q-bitbox">${cells}</div><div class="q-bitbox-l">${labs}</div>`;
}
const bitRowA = (v: number, cls: string, i0: number) =>
  `<div class="q-bitbox">${Array.from({ length: 8 }, (_, i) => `<span class="${cls} a"${ai(i0 + i * 0.4)}>${(v >>> (7 - i)) & 1}</span>`).join('')}</div>`;

function cwTitle(q: Encoded, c: number): string {
  const s = q.src[c],
    pos = s.ec
      ? `ブロック ${s.b + 1} の誤り訂正語`
      : q.bk.sizes.length > 1
        ? `ブロック ${s.b + 1} の ${s.i + 1} 語目`
        : CAT_NAME[catOf(q, c)];
  return `符号語 ${c} · 0x${hex2(q.cw[c])} · ${pos}`;
}

/** 読み取った値の 8 ビット。正解値と違うビットだけ赤くする */
const bitRowDiff = (v: number, ref: number, i0: number) =>
  `<div class="q-bitbox">${Array.from({ length: 8 }, (_, i) => {
    const b = (v >>> (7 - i)) & 1;
    return `<span class="${b === ((ref >>> (7 - i)) & 1) ? 'd' : 'x'} a"${ai(i0 + i * 0.4)}>${b}</span>`;
  }).join('')}</div>`;

function stData(q: Encoded, c: number): string {
  const header = 4 + ccBits(q.mode, q.ver),
    shift = header % 8,
    tail = note(
      `ビット列を 8 ビットずつ区切ると、符号語になります。${shift ? `見出しが ${header} ビットなので、文字は語の境目から ${shift} ビットずれます。` : ''}`,
    );
  if (c < 0 || q.src[c].ec) return h3(`データの符号語 ${q.bk.data} 語`, false) + tail;
  return h3(cwTitle(q, c)) + bitBoxA(q.cw[c], bitGroups(q, dataIndex(q, c))) + tail;
}

function stEc(q: Encoded, c: number): string {
  const s = c >= 0 ? q.src[c] : { b: 0, i: 0, ec: false },
    nb = q.bk.sizes.length,
    size = q.bk.sizes[s.b],
    ec = q.bk.ec,
    MAXC = 160,
    /* 選んだブロックのデータ語と誤り訂正語のます目（多いときは間引かず先頭から） */
    total = size + ec,
    step = Math.max(1, Math.ceil(total / MAXC));
  let cells = '',
    k = 0;
  for (let i = 0; i < total; i += step, k++) {
    const isEc = i >= size,
      on = c >= 0 && q.src[c].b === s.b && q.src[c].i === i;
    cells += `<i class="${isEc ? 'e' : 'd'}${on ? ' on' : ''} a"${ai(isEc ? 3 + (k - size / step) * 0.35 : 0)}></i>`;
  }
  const title =
    c >= 0 && s.ec
      ? cwTitle(q, c)
      : `ブロック ${s.b + 1}${nb > 1 ? ` / ${nb}` : ''} · データ ${size} 語 + 誤り訂正 ${ec} 語`;
  return (
    h3(title) +
    `<div class="q-blk">${cells}</div>` +
    `<p class="q-eq a"${ai(2)}>g(<i>x</i>) = (<i>x</i> − α⁰)(<i>x</i> − α¹) ⋯ (<i>x</i> − α${sup(ec - 1)})</p>` +
    note(
      `誤り訂正には<b>リード・ソロモン符号</b>を使います。データを g(<i>x</i>) で割った余りが誤り訂正語で、${ec} 語あれば ${ec / 2} 語まで訂正できます。${nb > 1 ? `${nb} ブロックに分け、1 語ずつ交互に並べます。` : ''}`,
    )
  );
}

function stPlace(q: Encoded, c: number): string {
  const ALL = '全体は右下から始め、2 列ずつ上へ、下へと折り返して置きます。';
  if (c < 0) return h3(`符号語 ${q.cw.length} 語を置く`, false) + note(ALL);
  const ms = cwModules(q, c),
    xs = ms.map((m) => m[0]),
    ys = ms.map((m) => m[1]),
    x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  /* ビット 7 から 0 への行の進み方で、この符号語を置いた向きを決める */
  const up = ys.every((y, i) => i === 0 || y <= ys[i - 1]),
    down = ys.every((y, i) => i === 0 || y >= ys[i - 1]),
    tail = note(
      up
        ? '2 列の右・左の順に、下から上へ置きます。数字はビットの番号です。'
        : down
          ? '2 列の右・左の順に、上から下へ置きます。数字はビットの番号です。'
          : '列の端で折り返し、隣の 2 列へ移りながら置きます。数字はビットの番号です。',
    );
  let g = '';
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const k = ms.findIndex(([mx, my]) => mx === x && my === y);
      g +=
        k < 0
          ? '<span class="z"></span>'
          : `<span class="${catOf(q, c)} a"${ai(k * 0.7)} title="(${x}, ${y})"><small>${7 - k}</small>${(q.cw[c] >>> (7 - k)) & 1}</span>`;
    }
  return (
    h3(cwTitle(q, c)) +
    `<div class="q-place"><div class="q-mods" style="grid-template-columns:repeat(${x1 - x0 + 1}, 34px)">${g}</div><p class="q-eq a"${ai(5)}>(${x0}, ${y0})〜(${x1}, ${y1})</p></div>` +
    tail
  );
}

function stMask(q: Encoded, c: number): string {
  const head = h3(`マスク ${q.mask}`) + `<p class="q-eq a"${ai(0)}>${MASK_TEXT[q.mask]}</p>`,
    tail = note(
      '同じ色の長い並びやファインダーに似た模様は読み取りにくいため、データの明暗を模様で散らします。8 種のうちペナルティがいちばん小さいマスクを選びます。',
    );
  if (c < 0) return head + tail;
  const f = MASKS[q.mask];
  let m = 0;
  cwModules(q, c).forEach(([x, y], i) => {
    if (f(x, y)) m |= 1 << (7 - i);
  });
  return (
    head +
    `<div class="q-mrow"><span class="a"${ai(0)}>符号語 ${c}</span>${bitRowA(q.cw[c], 'd', 0)}</div>` +
    `<div class="q-mrow"><span class="a"${ai(3)}>マスク</span>${bitRowA(m, 'p', 3)}</div>` +
    `<div class="q-mrow"><span class="a"${ai(6)}>XOR</span>${bitRowA(q.cw[c] ^ m, 'r', 6)}</div>` +
    tail
  );
}

function stDone(q: Encoded): string {
  const raw = q.fmt ^ 0x5412,
    row = (lab: string, v: number, cls: (i: number) => string, i0: number) =>
      `<span class="lb a"${ai(i0)}>${lab}</span>${Array.from({ length: 15 }, (_, i) => `<span class="${cls(i)} a"${ai(i0 + i * 0.15)}>${(v >>> (14 - i)) & 1}</span>`).join('')}`;
  let h = `<div class="q-fmt">${row(`${q.ecc}・${q.mask}`, raw, (i) => (i < 2 ? 'e' : i < 5 ? 'mk' : 'r'), 0)}${row('XOR', 0x5412, () => 's', 3)}${row('=', q.fmt, () => 'b', 6)}</div>`;
  h += `<div class="q-caplab a"${ai(8)}><span><i class="e"></i>レベル</span><span><i class="mk"></i>マスク</span><span><i class="r"></i>検査ビット</span></div>`;
  if (q.ver >= 7) {
    const v = versionBits(q.ver).toString(2).padStart(18, '0');
    h += `<p class="q-eq a"${ai(9)}>バージョン情報: <b>${v.slice(0, 6)}</b> ${v.slice(6)}</p>`;
  }
  return (
    h3(`形式情報 · ${q.ecc}・マスク ${q.mask}`) +
    h +
    note(
      `レベルとマスクの番号に検査ビットを足して XOR し、2 か所に置きます。3 ビットまでの誤りなら訂正できます。${q.ver >= 7 ? 'バージョン 7 以上は、バージョン情報も置きます。' : ''}`,
    )
  );
}

/** 調べるときの説明（段と選んだ符号語） */
export function inspect(q: Encoded, stage: number, c: number, o: InspectOpts): string {
  switch (stage) {
    case STAGE.text:
      return stText(q, o);
    case STAGE.bits:
      return stBits(q);
    case STAGE.data:
      return stData(q, c);
    case STAGE.ec:
      return stEc(q, c);
    case STAGE.place:
      return stPlace(q, c);
    case STAGE.mask:
      return stMask(q, c);
    default:
      return stDone(q);
  }
}

/** 誤り訂正実験のときの説明（選んだ符号語の、読み取った値と正解値） */
export function inspectSoil(q: Encoded, d: Decoded | null, c: number): string {
  if (!d)
    return (
      h3('形式情報を読めません', false) +
      note('形式情報が 2 か所とも 4 ビット以上ずれたので、レベルとマスクが分かりません。')
    );
  if (c < 0) return h3('符号語を選ぶ', false) + note('図か表の符号語を押すと、読み取った値と正解値を出します。');
  const got = d.recv[c],
    fix = d.fixed[c],
    s = d.src[c],
    r = d.rs[s.b],
    title =
      got === fix
        ? got === q.cw[c]
          ? `符号語 ${c} · 0x${hex2(got)} · 誤りなし`
          : `符号語 ${c} · 0x${hex2(got)} · 訂正できなかった`
        : `符号語 ${c} · 0x${hex2(got)} → 0x${hex2(fix)} に訂正`;
  return (
    h3(title) +
    `<div class="q-mrow"><span class="a"${ai(0)}>読み取った値</span>${bitRowDiff(got, q.cw[c], 0)}</div>` +
    `<div class="q-mrow"><span class="a"${ai(3)}>正解値</span>${bitRowA(q.cw[c], 'd', 3)}</div>` +
    (r.ok ? '' : note(`ブロック ${s.b + 1} は誤りが訂正できる上限を超えました。`))
  );
}

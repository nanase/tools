/**
 * 符号の地図の右側（符号語の表の下）に出す説明の HTML。段ごとに、選んだ符号語のビットの中身・置いた場所・
 * マスク・形式情報を組む。値の計算は encode.ts・decode.ts、ここは見せ方だけ
 */
import { esc } from '../../lib/dom';
import type { Decoded } from './decode';
import { type Cat, catOf, STAGE } from './draw';
import { ccBits, type Encoded, MODE_NAME, type Span } from './encode';
import { generator } from './rs';
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

/** 8 ビットの箱と、その下の持ち主の名前 */
function bitBox(v: number, groups: BitGroup[]): string {
  let i = 0,
    cells = '',
    labs = '';
  groups.forEach((g, k) => {
    for (let j = 0; j < g.n; j++, i++)
      cells += `<span class="${g.cls}${k % 2 ? ' alt' : ''}">${(v >>> (7 - i)) & 1}</span>`;
    labs += `<span style="grid-column: span ${g.n}">${esc(g.label)}</span>`;
  });
  return `<div class="q-bitbox">${cells}</div><div class="q-bitbox-l">${labs}</div>`;
}
const bitRow = (v: number, cls: string) =>
  `<div class="q-bitbox">${Array.from({ length: 8 }, (_, i) => `<span class="${cls}">${(v >>> (7 - i)) & 1}</span>`).join('')}</div>`;

/** 符号語 c の 8 つのモジュール（ビット 7 から） */
export function cwModules(q: Encoded, c: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < q.n * q.n; i++) if (q.cwAt[i] === c) out[7 - q.bitAt[i]] = [i % q.n, Math.floor(i / q.n)];
  return out;
}

/* ---------- 段ごとの説明 ---------- */
const note = (s: string) => `<p class="q-note">${s}</p>`;
const h3 = (s: string) => `<h3>${s}</h3>`;
const MAX_UNITS = 36;

function stText(q: Encoded): string {
  const us = q.units,
    shown = us.slice(0, MAX_UNITS),
    unit =
      q.mode === 'num'
        ? '3 文字ずつ'
        : q.mode === 'alnum'
          ? '2 文字ずつ'
          : q.mode === 'kanji'
            ? '1 文字ずつ'
            : '1 バイトずつ';
  const chips = shown
    .map((u) => {
      const ch = vis(q.chars.slice(u.c0, u.c1).join('')),
        val = q.mode === 'byte' ? hex2(u.v) : q.mode === 'kanji' ? u.v.toString(16).toUpperCase() : String(u.v);
      return `<span class="d">${esc(ch)}<small>${val}</small></span>`;
    })
    .join('');
  const more = us.length > MAX_UNITS ? `<span class="q-more">…あと ${us.length - MAX_UNITS}</span>` : '';
  const why: Record<string, string> = {
    num: '0〜9 だけなので<b>数字</b>モード。3 文字を 0〜999 の数にして 10 ビットで書く。',
    alnum: '英大文字・数字・9 つの記号だけなので<b>英数字</b>モード。2 文字を 45 進の 2 桁の数にして 11 ビットで書く。',
    kanji: 'Shift_JIS の 2 バイト文字だけなので<b>漢字</b>モード。1 文字を 13 ビットで書く。',
    byte: '数字・英数字・漢字のモードで書けない文字を含むので<b>8 ビットバイト</b>モード。文字を UTF-8 のバイトにする。',
  };
  return (
    h3(`文字列 · ${q.chars.length} 文字 → ${MODE_NAME[q.mode]}`) +
    `<div class="q-bits">${chips}${more}</div>` +
    note(`${why[q.mode]}${unit}、小さい字は書く値。`)
  );
}

function stBits(q: Encoded): string {
  const used = q.spans
      .filter((s) => s.k === 'mode' || s.k === 'count' || s.k === 'data')
      .reduce((a, s) => a + s.to - s.from, 0),
    data = q.spans.filter((s) => s.k === 'data'),
    pads = q.spans.filter((s) => s.k === 'pad'),
    bits = (s: Span) => Array.from(q.bits.slice(s.from, s.to)).join('');
  const sp = (s: Span, cls: string, lab: string) => `<span class="${cls}">${bits(s)}<small>${esc(lab)}</small></span>`;
  let h = '';
  for (const s of q.spans.filter((x) => x.k === 'mode' || x.k === 'count'))
    h += sp(s, 'h', s.k === 'mode' ? MODE_NAME[q.mode] : `${s.v}`);
  const head = data.slice(0, 10);
  for (const s of head) h += sp(s, 'd', vis(q.chars.slice(s.c0, s.c1).join('')));
  if (data.length > head.length) {
    h += `<span class="q-more">…${data.length - head.length - 1} 単位…</span>`;
    const s = data[data.length - 1];
    h += sp(s, 'd', vis(q.chars.slice(s.c0, s.c1).join('')));
  }
  for (const s of q.spans.filter((x) => x.k === 'term' || x.k === 'fill'))
    h += sp(s, 'p', s.k === 'term' ? '終端' : '端数');
  for (const s of pads.slice(0, 2)) h += sp(s, 'p', hex2(s.v));
  if (pads.length > 2) h += `<span class="q-more">… 計 ${pads.length} 語</span>`;
  const dataBits = data.reduce((a, s) => a + s.to - s.from, 0);
  return (
    h3(`ビット列 · ${used} ビット（容量 ${q.bits.length}）`) +
    `<div class="q-bits">${h}</div>` +
    `<p class="q-eq">4 + ${ccBits(q.mode, q.ver)} + ${dataBits} = <b>${used} ビット</b></p>` +
    note(
      `モード指示子 4 ビット、文字数 ${ccBits(q.mode, q.ver)} ビット（型番 ${q.ver <= 9 ? '1〜9' : q.ver <= 26 ? '10〜26' : '27〜40'}）、データの順に並べる。後ろに終端の 0000 と、8 の倍数までの 0 を足し、残りは埋め草の 11101100 と 00010001 を交互に埋める。`,
    )
  );
}

function cwHead(q: Encoded, c: number, extra = ''): string {
  const s = q.src[c],
    cat = catOf(q, c),
    pos = s.ec
      ? `ブロック ${s.b + 1} の誤り訂正語 ${s.i - q.bk.sizes[s.b] + 1} 語目`
      : q.bk.sizes.length > 1
        ? `ブロック ${s.b + 1} の ${s.i + 1} 語目`
        : '';
  return h3(`符号語 ${c} · ${CAT_NAME[cat]} · 0x${hex2(q.cw[c])}${pos ? ` · ${pos}` : ''}${extra}`);
}

function stData(q: Encoded, c: number): string {
  const header = 4 + ccBits(q.mode, q.ver),
    shift = header % 8;
  const tail = note(
    `ビット列を 8 ビットずつ区切ったものが符号語。見出し（モードと文字数）が ${header} ビットなので、${shift ? `文字は語の境目から ${shift} ビットずれる。` : '文字は語の境目にそろう。'}`,
  );
  if (c < 0 || q.src[c].ec) return h3(`データの符号語 ${q.bk.data} 語`) + tail;
  return cwHead(q, c) + bitBox(q.cw[c], bitGroups(q, dataIndex(q, c))) + tail;
}

function stEc(q: Encoded, c: number): string {
  const s = c >= 0 ? q.src[c] : { b: 0, i: 0, ec: false },
    nb = q.bk.sizes.length,
    size = q.bk.sizes[s.b],
    ec = q.bk.ec,
    g = generator(ec);
  const shortN = q.bk.sizes.filter((x) => x === q.bk.sizes[0]).length,
    blocks =
      nb === 1
        ? '1 ブロック'
        : shortN === nb
          ? `${nb} ブロック（どれもデータ ${q.bk.sizes[0]} 語）`
          : `${nb} ブロック（データ ${q.bk.sizes[0]} 語が ${shortN} つ、${q.bk.sizes[0] + 1} 語が ${nb - shortN} つ）`;
  const gHead = g
    .slice(1, 4)
    .map((v, i) => `0x${hex2(v)}<i>x</i>${sup(ec - 1 - i)}`)
    .join(' + ');
  return (
    (c >= 0 ? cwHead(q, c) : h3(`誤り訂正語 ${ec} 語 × ${nb}`)) +
    `<p class="q-eq">g(<i>x</i>) = (<i>x</i> − α⁰)(<i>x</i> − α¹) ⋯ (<i>x</i> − α${sup(ec - 1)}) = <i>x</i>${sup(ec)} + ${gHead} + ⋯</p>` +
    `<p class="q-eq">誤り訂正語 = <i>D</i>(<i>x</i>) <i>x</i>${sup(ec)} mod g(<i>x</i>)　（ブロック ${s.b + 1}: データ ${size} 語 + 誤り訂正 ${ec} 語）</p>` +
    note(
      `データの符号語を GF(2⁸) の多項式の係数とみて、生成多項式で割った余りが誤り訂正語。どこが壊れたか分からない誤りを、ブロックごとに ${ec / 2} 語まで直せる。この型番とレベルでは ${blocks}${nb > 1 ? '。置くときは 1 語ずつブロックを交互に並べ、汚れが 1 つのブロックに集まりにくくする' : ''}。`,
    )
  );
}

function stPlace(q: Encoded, c: number): string {
  const tail = note(
    '右下の角から 2 列ずつ、上・下に折り返しながら、機能パターンと形式情報の所を避けて 1 ビットずつ置く。縦のタイミングの列は飛ばす。符号語はたいてい 2 列 × 4 段だが、模様の脇や折り返しでは形が崩れる。',
  );
  if (c < 0) return h3(`符号語 ${q.cw.length} 語を置く`) + tail;
  const ms = cwModules(q, c),
    rows = [0, 4].map((o) =>
      ms
        .slice(o, o + 4)
        .map(([x, y], i) => `ビット ${7 - o - i} → (${x}, ${y})`)
        .join('　'),
    );
  const groups: BitGroup[] = q.src[c].ec ? [{ n: 8, cls: 'p', label: '誤り訂正語' }] : bitGroups(q, dataIndex(q, c));
  return cwHead(q, c) + bitBox(q.cw[c], groups) + `<p class="q-eq">${rows.join('<br>')}</p>` + tail;
}

function stMask(q: Encoded, c: number): string {
  const head = h3(`マスク ${q.mask} · ${MASK_TEXT[q.mask]} の所を反転`),
    tail = note(
      `8 種の模様でデータの領域を反転し、読み取りにくい並び（同じ色の長い並び・2×2 の塊・ファインダーに似た並び・明暗の偏り）の失点がいちばん小さいものを使う（下の「マスクの比較」）。機能パターンと形式情報にはかけない。${q.n}×${q.n} の格子の左上が (0, 0)。`,
    );
  if (c < 0) return head + tail;
  const ms = cwModules(q, c),
    f = MASKS[q.mask];
  let m = 0;
  ms.forEach(([x, y], i) => {
    if (f(x, y)) m |= 1 << (7 - i);
  });
  return (
    head +
    `<div class="q-mrow"><span>置いた値</span>${bitRow(q.cw[c], 'd')}</div>` +
    `<div class="q-mrow"><span>マスク</span>${bitRow(m, 'p')}</div>` +
    `<div class="q-mrow"><span>XOR</span>${bitRow(q.cw[c] ^ m, 'r')}</div>` +
    tail
  );
}

function fmtRows(q: Encoded): string {
  const raw = q.fmt ^ 0x5412,
    cell = (v: number, i: number, cls: (i: number) => string) =>
      `<span class="${cls(i)}">${(v >>> (14 - i)) & 1}</span>`,
    row = (lab: string, v: number, cls: (i: number) => string) =>
      `<span class="lb">${lab}</span>${Array.from({ length: 15 }, (_, i) => cell(v, i, cls)).join('')}`;
  let h = `<div class="q-fmt">${row(`${q.ecc}・${q.mask}`, raw, (i) => (i < 2 ? 'e' : i < 5 ? 'm' : 'r'))}${row('XOR', 0x5412, () => 's')}${row('=', q.fmt, () => 'b')}</div>`;
  if (q.ver >= 7) {
    const v = versionBits(q.ver);
    h += `<p class="q-eq">型番情報（18 ビット）: <b>${v.toString(2).padStart(18, '0').slice(0, 6)}</b> ${v.toString(2).padStart(18, '0').slice(6)}</p>`;
  }
  return h;
}

function stDone(q: Encoded): string {
  return (
    h3(`形式情報 · 誤り訂正 ${q.ecc}・マスク ${q.mask}`) +
    fmtRows(q) +
    note(
      `誤り訂正のレベル 2 ビットとマスクの番号 3 ビットに、BCH(15, 5) 符号の 10 ビットを足し、すべて 0 にならないよう 101010000010010 と XOR する。左上と、右上・左下に分けて 2 か所に置き、3 ビットまでの誤りを直せる。${q.ver >= 7 ? '型番 7 以上は、型番 6 ビットに BCH(18, 6) の 12 ビットを足した型番情報も 2 か所に置く。' : ''}`,
    )
  );
}

/** 調べるときの説明（段と選んだ符号語） */
export function inspect(q: Encoded, stage: number, c: number): string {
  switch (stage) {
    case STAGE.text:
      return stText(q);
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

/** 汚すときの説明（選んだ符号語の、読んだ値と直した値） */
export function inspectSoil(q: Encoded, d: Decoded | null, c: number): string {
  if (!d)
    return (
      h3('形式情報を読めません') +
      note(
        '形式情報の 2 か所が、どちらも正しい符号から 4 ビット以上ずれました。誤り訂正のレベルとマスクが分からないので、ここで読むのをやめます。',
      )
    );
  if (c < 0) return h3('符号語を選ぶ') + note('図か表の符号語を押すと、読んだ値と直した値を出します。');
  const got = d.recv[c],
    fix = d.fixed[c],
    s = d.src[c],
    r = d.rs[s.b];
  const st = got === fix ? (got === q.cw[c] ? '誤りなし' : '直せなかった') : `誤り 0x${hex2(got ^ fix)} を直した`;
  return (
    h3(`符号語 ${c} · 読んだ 0x${hex2(got)} → ${got === fix ? '' : `直した 0x${hex2(fix)} · `}${st}`) +
    `<div class="q-mrow"><span>読んだ値</span>${bitRow(got, got === q.cw[c] ? 'd' : 'x')}</div>` +
    `<div class="q-mrow"><span>元の値</span>${bitRow(q.cw[c], 'd')}</div>` +
    note(
      `ブロック ${s.b + 1}: 誤り ${r.ok ? r.fixes.length : '？'} 語 / 直せる上限 ${d.rs.length ? blocksEc(d) / 2 : 0} 語。${r.ok ? '' : r.why === 'many' ? '誤り位置多項式の次数が上限を超えた。' : '誤り位置多項式の根の数が次数と合わない。'}`,
    )
  );
}
const blocksEc = (d: Decoded) => {
  const s0 = d.src.filter((x) => x.b === 0);
  return s0.filter((x) => x.ec).length;
};

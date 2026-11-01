/** ファイルの項目: 区画の帯・16 進ダンプ・LZW のバイトの中の符号の境 */
import { $ } from '../../lib/dom';
import { byteCells } from '../../lib/imgfmt/bits';
import { HexView } from '../../lib/imgfmt/hexdump';
import { BLOCK_NAME, BLOCK_SHORT, blockAt, blockInfo, dataIndex, fileRanges, frameView, type Model } from './model';

const cnt = (v: number): string => v.toLocaleString('en');
/** 符号の境を見せるバイトの数 */
const BIT_BYTES = 6;

let hex: HexView | null = null;
let M: Model | null = null;

function ownerOf(bit: Uint32Array, n: number, p: number): number {
  let lo = 0,
    hi = n - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (bit[m] <= p) lo = m;
    else hi = m - 1;
  }
  return lo;
}

/** LZW の di バイト目からの符号の境 */
function drawBits(m: Model, fi: number, di: number): string {
  const v = frameView(m, fi),
    t = v.tr,
    d = v.f.data,
    e = Math.min(d.length, di + BIT_BYTES),
    head = ownerOf(t.bit, t.n, di * 8);
  let h = '';
  for (const row of byteCells(d, di * 8, e * 8, 'lsb')) {
    let cell = '';
    for (const c of row) {
      const o = ownerOf(t.bit, t.n, c.p);
      cell += `<span class="${o === head ? 'on' : o % 2 ? 'a' : 'b'}">${c.v}</span>`;
    }
    const by = row[0].p >> 3;
    h += `<div class="gf-by">${cell}<small>${d[by].toString(16).toUpperCase().padStart(2, '0')}</small></div>`;
  }
  $('#bitv').innerHTML = h;
  return `符号 ${t.code[head]} · ${t.width[head]} ビット`;
}

function pick(off: number, scroll: boolean): void {
  const m = M;
  if (!m) return;
  const i = blockAt(m, off);
  if (i < 0) return;
  const b = m.file.blocks[i],
    info = blockInfo(m, i);
  hex?.mark(b.kind === 'data' ? off : b.start, b.kind === 'data' ? off + 1 : b.end, scroll);
  document.querySelectorAll('#strip button').forEach((x) => {
    x.classList.toggle('on', Number((x as HTMLElement).dataset.i) === i);
  });
  let tail = '';
  const bv = $('#bitv');
  bv.innerHTML = '';
  if (b.kind === 'data' && b.frame < m.n) {
    const di = dataIndex(m, m.file.frames[b.frame], off);
    if (di < 0) tail = `サブブロックの長さ ${m.bytes[off]}`;
    else tail = drawBits(m, b.frame, di);
  }
  $('#fi-rd').textContent = [
    BLOCK_NAME[b.kind],
    `位置 ${cnt(b.kind === 'data' ? off : b.start)}`,
    `${cnt(b.end - b.start)} バイト`,
    info,
    tail,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 項目を描く */
export function drawFile(m: Model): void {
  if (M === m) return;
  M = m;
  const B = m.file.blocks,
    n = m.bytes.length;
  $('#strip').innerHTML = B.map((b, i) => {
    const fr = (b.end - b.start) / n;
    return `<button type="button" class="k-${b.kind}" data-i="${i}" title="${BLOCK_NAME[b.kind]}"${B.length > 40 ? ' tabindex="-1"' : ''} style="flex:${Math.max(0.004, fr) * 100} 1 0">${fr > 0.09 ? BLOCK_SHORT[b.kind] : ''}</button>`;
  }).join('');
  hex ??= new HexView($('#hx'), { rows: 12, onPick: (off) => pick(off, false) });
  hex.set(m.bytes, fileRanges(m));
  const d = B.find((b) => b.kind === 'data');
  pick(d ? d.start + 1 : 0, true);
}

$('#strip').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-i]');
  if (!b || !M) return;
  const s = M.file.blocks[Number(b.dataset.i)];
  /* LZW の区画は、長さのバイトの次からのデータを見せる */
  pick(s.kind === 'data' ? s.start + 1 : s.start, true);
});

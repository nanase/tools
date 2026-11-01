/**
 * ファイルの構成: チャンクの帯と表、16 進ダンプ。IDAT の中は Deflate の記号ごとに塗る。
 * バイトに指を乗せると、そのバイトの意味と、記号ならビット（下位ビットから詰める）を右に出す。押すとその行を選ぶ
 */
import { bitStr, byteCells } from '../../lib/imgfmt/bits';
import { type HexRange, HexView } from '../../lib/imgfmt/hexdump';
import { distLabel } from './ladder';
import { filterName, type Model, posRow, rowPixelXY } from './model';
import type { ChunkInfo } from './png';
import { TK_END, TK_LIT, TK_MATCH, TK_STORED, tokenAtBit } from './trace';

const h2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');
const h8 = (v: number): string => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
const cnt = (v: number): string => v.toLocaleString('en');
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const u32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** バイトの種類（16 進ダンプの色。番号は CLS の位置） */
const CLS = ['', 'sig', 'len', 'typ', 'dat', 'crc', 'zh', 'bh', 'lit', 'mat', 'raw', 'ad'] as const;
const C = Object.fromEntries(CLS.map((c, i) => [c, i])) as Record<(typeof CLS)[number], number>;

const CT_NAME: Record<number, string> = { 0: 'グレー', 2: 'RGB', 3: 'パレット', 4: 'グレー＋α', 6: 'RGBA' };
const AUX: Record<string, string> = {
  tEXt: 'テキスト',
  zTXt: '圧縮したテキスト',
  iTXt: '国際化テキスト',
  pHYs: '画素の大きさ',
  gAMA: 'ガンマ',
  cHRM: '色度',
  sRGB: 'sRGB の描き方',
  iCCP: 'ICC プロファイル',
  cICP: '色空間の符号',
  bKGD: '背景色',
  tIME: '更新の時刻',
  sBIT: '有効なビット数',
  hIST: 'パレットの使われ方',
  sPLT: '推奨パレット',
  eXIf: 'Exif',
  acTL: 'APNG のフレーム数',
  fcTL: 'APNG のフレーム',
  fdAT: 'APNG のフレームのデータ',
};

/** チャンクの内容の 1 行 */
function chunkDesc(m: Model, c: ChunkInfo, k: number, nIdat: number): string {
  const b = m.bytes,
    o = c.offset + 8;
  switch (c.type) {
    case 'IHDR':
      return `${u32(b, o)}×${u32(b, o + 4)} · 深度 ${b[o + 8]} · 色の型 ${b[o + 9]}（${CT_NAME[b[o + 9]] ?? '?'}）· インターレース ${b[o + 12] ? 'Adam7' : 'なし'}`;
    case 'PLTE': {
      let sw = '';
      for (let i = 0; i < Math.min(c.length / 3, 32); i++)
        sw += `<i style="background:rgb(${b[o + 3 * i]},${b[o + 3 * i + 1]},${b[o + 3 * i + 2]})"></i>`;
      return `${c.length / 3} 色 <span class="pal">${sw}</span>`;
    }
    case 'tRNS':
      return m.layout.colorType === 3 ? `パレットの先頭 ${c.length} 色の不透明度` : '透明にする 1 色';
    case 'IDAT':
      return k === 0
        ? `zlib の頭 ${h2(m.zlib[0])} ${h2(m.zlib[1])}${nIdat > 1 ? ` · ${nIdat} 個に分けた 1 個目` : ''}`
        : `続き（${k + 1} / ${nIdat}）`;
    case 'IEND':
      return '画像の終わり';
    default:
      return `${AUX[c.type] ?? '知らない補助チャンク'}${c.critical ? '（必須）' : ''}`;
  }
}

export class FileMap {
  private m: Model | null = null;
  private hex: HexView;
  /** IDAT の中のバイトの、つないだ zlib での位置（ほかは −1） */
  private zpos = new Int32Array(0);
  private sel = -1;

  constructor(
    private readonly el: { strip: HTMLElement; table: HTMLElement; hex: HTMLElement; sym: HTMLElement },
    /** 記号を押した（その行を選ぶ） */
    private readonly onPick: (tok: number) => void,
  ) {
    this.hex = new HexView(el.hex, {
      rows: 18,
      onHover: (o) => {
        if (o !== null) this.show(o);
      },
      onPick: (o) => {
        this.show(o);
        const t = this.tokenAt(o);
        if (t >= 0) this.onPick(t);
      },
    });
  }

  set(m: Model): void {
    this.m = m;
    this.sel = -1;
    const b = m.bytes,
      n = b.length,
      cls = new Uint8Array(n),
      zpos = new Int32Array(n).fill(-1);
    cls.fill(C.sig, 0, Math.min(8, n));
    /* IDAT の中の zlib のバイトの種類（ブロックの頭は bh のまま、記号が始まるバイトで塗る） */
    const z = m.zlib,
      zc = new Uint8Array(z.length).fill(C.bh),
      T = m.trace.tokens;
    zc.fill(C.zh, 0, Math.min(2, z.length));
    for (let i = 0; i < T.count; i++) {
      const k = T.kind[i];
      if (k === TK_END) continue;
      const a = 2 + (T.bit[i] >> 3),
        e = 2 + ((T.bit[i] + T.nbits[i] - 1) >> 3),
        c = k === TK_LIT ? C.lit : k === TK_MATCH ? C.mat : C.raw;
      for (let q = a; q <= e && q < z.length; q++) if (zc[q] === C.bh) zc[q] = c;
    }
    zc.fill(C.ad, Math.max(2, z.length - 4));
    let zo = 0;
    for (const c of m.chunks) {
      const o = c.offset,
        d = o + 8,
        e = Math.min(n, d + c.length);
      cls.fill(C.len, o, Math.min(n, o + 4));
      cls.fill(C.typ, o + 4, Math.min(n, o + 8));
      if (c.type === 'IDAT') {
        for (let q = d; q < e; q++, zo++) {
          cls[q] = zc[zo] ?? C.dat;
          zpos[q] = zo;
        }
      } else cls.fill(C.dat, d, e);
      cls.fill(C.crc, e, Math.min(n, e + 4));
    }
    this.zpos = zpos;
    const R: HexRange[] = [];
    for (let i = 0; i < n; ) {
      let j = i + 1;
      while (j < n && cls[j] === cls[i]) j++;
      if (cls[i]) R.push({ start: i, end: j, cls: CLS[cls[i]] });
      i = j;
    }
    this.hex.set(b, R);
    /* 帯と表 */
    const nIdat = m.chunks.filter((c) => c.type === 'IDAT').length,
      col: Record<string, string> = {
        IHDR: 'var(--f4)',
        PLTE: 'var(--f3)',
        tRNS: 'var(--f3)',
        IDAT: 'var(--f2)',
        IEND: 'var(--f4)',
      };
    /* 続く IDAT は帯で 1 つ、表で「最初の 1 個」と「残り」の 2 行にまとめる */
    const groups: ChunkInfo[][] = [];
    for (const c of m.chunks) {
      const g = groups.at(-1);
      if (g && c.type === 'IDAT' && g[0].type === 'IDAT') g.push(c);
      else groups.push([c]);
    }
    const row = (o: number, t: string, pos: string, len: number, desc: string, crc: string): string =>
      `<tr data-o="${o}"><td>${t}</td><td>${pos}</td><td>${cnt(len)}</td><td>${desc}</td><td>${crc}</td></tr>`;
    const crcOf = (c: ChunkInfo): string =>
      `${h8(c.crc)} <span class="${c.crcOk ? 'ok' : 'ng'}">${c.crcOk ? '✓' : `✗ 計算 ${h8(c.crcCalc)}`}</span>`;
    let st = '<span style="flex:8 0 0;background:var(--f0)" title="署名 8 バイト">sig</span>',
      tb = row(0, '（署名）', '0', 8, '89 50 4E 47 0D 0A 1A 0A', '');
    for (const g of groups) {
      const c = g[0],
        t = esc(c.type),
        tot = g.reduce((a, q) => a + q.length + 12, 0);
      st += `<span style="flex:${tot} 0 0;background:${col[c.type] ?? 'var(--f1)'}" title="${t}">${t}</span>`;
      tb += row(c.offset, t, String(c.offset), c.length, chunkDesc(m, c, 0, nIdat), crcOf(c));
      if (g.length > 1) {
        const r = g.slice(1),
          bad = r.filter((q) => !q.crcOk).length,
          last = r[r.length - 1];
        tb += row(
          r[0].offset,
          `IDAT ×${r.length}`,
          `${r[0].offset}–${last.offset}`,
          r.reduce((a, q) => a + q.length, 0),
          r.length > 1 ? `続き（2〜${g.length} / ${g.length}）` : `続き（2 / 2）`,
          bad ? `<span class="ng">✗ ${bad} 個</span>` : `<span class="ok">✓ ${r.length} 個</span>`,
        );
      }
    }
    this.el.strip.innerHTML = st;
    this.el.table.innerHTML = tb;
    this.show(m.chunks.find((c) => c.type === 'IDAT')?.offset ?? 0);
  }

  /** ファイルの位置 o を含む記号の番号（IDAT の中の記号でなければ −1） */
  private tokenAt(o: number): number {
    const m = this.m,
      z = this.zpos[o];
    if (!m || z === undefined || z < 2 || z >= m.zlib.length - 4) return -1;
    const T = m.trace.tokens,
      i = tokenAtBit(T, (z - 2) * 8);
    return i >= 0 && T.kind[i] !== TK_END ? i : -1;
  }

  /** 選んだ記号の印（行の符号化から） */
  markToken(tok: number): void {
    const m = this.m;
    if (!m || tok < 0) return;
    const T = m.trace.tokens,
      a = 2 + (T.bit[tok] >> 3),
      e = 2 + ((T.bit[tok] + T.nbits[tok] - 1) >> 3);
    let fa = -1,
      fe = -1;
    for (let q = 0; q < this.zpos.length; q++) {
      if (this.zpos[q] === a) fa = q;
      if (this.zpos[q] === e) {
        fe = q;
        break;
      }
    }
    /* stored の記号は長いので、先頭の 32 バイトだけに印を付ける */
    if (fa >= 0) this.hex.mark(fa, Math.min(fe + 1, fa + 32), false);
  }

  /** ファイルの位置 o の説明 */
  private show(o: number): void {
    const m = this.m;
    if (!m || o === this.sel) return;
    this.sel = o;
    const b = m.bytes;
    const ci = m.chunks.findIndex((c) => o >= c.offset && o < c.offset + c.length + 12);
    /* 表の行は、チャンクの位置以下で最も後ろの行（まとめた IDAT の行を含む） */
    let hv: Element | null = null;
    for (const tr of this.el.table.querySelectorAll<HTMLElement>('tr')) {
      tr.classList.remove('hv');
      if (Number(tr.dataset.o) <= (ci >= 0 ? m.chunks[ci].offset : 0)) hv = tr;
    }
    hv?.classList.add('hv');
    let h = `<h3>${o} バイト目 · ${h2(b[o])}</h3><dl class="kv">`;
    if (ci < 0) h += `<dt>部分</dt><dd>署名（${o + 1} / 8）</dd>`;
    else {
      const c = m.chunks[ci],
        r = o - c.offset;
      const part =
        r < 4
          ? `長さ ${cnt(c.length)}`
          : r < 8
            ? `種類 ${esc(c.type)}`
            : r < 8 + c.length
              ? 'データ'
              : `CRC-32 ${h8(c.crc)}`;
      h += `<dt>チャンク</dt><dd>${esc(c.type)} · ${part}</dd>`;
    }
    const tok = this.tokenAt(o),
      z = this.zpos[o];
    let tail = '';
    if (z >= 0 && z < 2)
      h += `<dt>zlib の頭</dt><dd>${h2(m.zlib[0])} ${h2(m.zlib[1])} · 窓 ${1 << ((m.zlib[0] >> 4) + 8)} バイト</dd>`;
    else if (z >= m.zlib.length - 4) h += '<dt>Adler-32</dt><dd>戻したデータの検査</dd>';
    else if (tok < 0 && z >= 0) h += '<dt>Deflate</dt><dd>ブロックの頭・符号長の表</dd>';
    if (tok >= 0) {
      const T = m.trace.tokens,
        k = T.kind[tok],
        len = k === TK_LIT ? 1 : T.len[tok],
        [row, j] = posRow(m.layout, T.pos[tok]),
        [x, y] = rowPixelXY(m.layout, row, Math.max(0, Math.floor((Math.max(0, j) * 8) / m.layout.bitsPerPixel)));
      h += `<dt>記号</dt><dd>${k === TK_LIT ? `文字 ${h2(T.sym[tok])}` : k === TK_MATCH ? `一致 長さ ${len} · ${distLabel(m, row, T.dist[tok])}` : `そのまま ${len} バイト`}</dd>`;
      h += `<dt>元の場所</dt><dd>行 ${row} · ${j < 0 ? `フィルタの種類（${filterName(m.filtered[T.pos[tok]])}）` : `画素 (${x}, ${y})`}</dd>`;
      h += `<dt>ビット</dt><dd>${cnt(T.bit[tok])} から ${T.nbits[tok]} ビット</dd>`;
      if (k !== TK_STORED) {
        const s = T.bit[tok],
          seg = [T.codeLen[tok], k === TK_MATCH ? T.lenExtraBits[tok] : 0, k === TK_MATCH ? T.dcodeLen[tok] : 0],
          cd = (p: number): string => {
            const q = p - s;
            if (q < 0 || q >= T.nbits[tok]) return '';
            return q < seg[0] || (q >= seg[0] + seg[1] && q < seg[0] + seg[1] + seg[2]) ? 'cd' : 'ex';
          },
          zb = m.zlib.subarray(2);
        let by = '';
        for (const row8 of byteCells(zb, s, s + T.nbits[tok], 'lsb'))
          by += `<div><div class="by">${row8.map((c) => `<span class="${cd(c.p)}">${c.v}</span>`).join('')}</div><small>${h2(zb[row8[0].p >> 3])}</small></div>`;
        tail = `<div class="bitrow">${by}</div><p class="leg"><i style="background:var(--ink)"></i>ハフマン符号 ${bitStr(T.code[tok], T.codeLen[tok])}<i style="background:var(--inset);box-shadow:inset 0 -2px 0 var(--mat)"></i>付加ビット · 右端が先</p>`;
      }
    }
    this.el.sym.innerHTML = `${h}</dl>${tail}`;
  }
}

/**
 * 値の流れの図: ROM・命令・PC・入力・出力・レジスタ A と B・ALU・C（桁上げ）を 1 本のバスでつなぐ。
 * ROM は 16 行 × 8 ビットのスイッチで、行の右に命令の札を出す。広い画面（wide）は ROM を左に、
 * 狭い画面（narrow）はバスを縦にして ROM を図の下に幅いっぱいで置く。
 * 図はビルド時に両方を HTML に出し（figSvg）、見えている方をブラウザで動かす（bindFig）
 */
import { b4, chip, dec, type Port } from './model';

export type Kind = 'wide' | 'narrow';
type Rect = [number, number, number, number];
type Pt = [number, number];
interface Layout {
  vb: [number, number, number, number];
  /** バス: 向き（h 横・v 縦）、位置、両端 */
  bus: { d: 'h' | 'v'; at: number; a: number; b: number };
  blk: Record<string, Rect>;
  /** ブロックの縁の点（バスへ垂直に結ぶ） */
  stub: Record<string, Pt>;
  /** バスを通らない線: 命令の読み出し（fetch・ir）と ALU への線 */
  wire: Record<string, Pt[]>;
}

/* 位置は [x, y, 幅, 高さ] */
const LAYOUTS: Record<Kind, Layout> = {
  wide: {
    vb: [0, 0, 1164, 452],
    bus: { d: 'h', at: 232, a: 524, b: 1150 },
    blk: {
      rom: [12, 12, 420, 440],
      ir: [460, 12, 214, 150],
      pc: [460, 330, 150, 66],
      in: [698, 40, 182, 110],
      out: [904, 40, 246, 110],
      A: [654, 290, 124, 80],
      B: [804, 290, 124, 80],
      alu: [964, 290, 92, 100],
      c: [1076, 300, 74, 70],
    },
    stub: {
      n: [0, 162],
      in: [789, 150],
      out: [1027, 150],
      pc: [535, 330],
      Ai: [682, 290],
      Ao: [750, 290],
      Bi: [832, 290],
      Bo: [900, 290],
      alu: [1010, 290],
    },
    wire: {
      fetch: [
        [460, 363],
        [432, 363],
      ],
      ir: [
        [432, 70],
        [460, 70],
      ],
      Aalu: [
        [716, 370],
        [716, 428],
        [946, 428],
        [946, 362],
        [964, 362],
      ],
      Balu: [
        [866, 370],
        [866, 410],
        [936, 410],
        [936, 318],
        [964, 318],
      ],
      aluc: [
        [1056, 335],
        [1076, 335],
      ],
    },
  },
  narrow: {
    vb: [0, 0, 400, 996],
    bus: { d: 'v', at: 202, a: 30, b: 352 },
    blk: {
      ir: [16, 8, 170, 122],
      in: [16, 144, 170, 80],
      pc: [16, 238, 170, 56],
      rom: [8, 488, 384, 500],
      out: [218, 8, 174, 80],
      A: [218, 102, 160, 74],
      B: [218, 192, 160, 74],
      alu: [218, 284, 120, 100],
      c: [218, 402, 120, 62],
    },
    stub: {
      n: [186, 56],
      in: [186, 184],
      pc: [186, 266],
      out: [218, 48],
      Ai: [218, 124],
      Ao: [218, 154],
      Bi: [218, 214],
      Bo: [218, 244],
      alu: [218, 334],
    },
    wire: {
      fetch: [
        [60, 294],
        [60, 488],
      ],
      ir: [
        [8, 530],
        [3, 530],
        [3, 70],
        [16, 70],
      ],
      Aalu: [
        [378, 139],
        [393, 139],
        [393, 364],
        [338, 364],
      ],
      Balu: [
        [378, 229],
        [385, 229],
        [385, 314],
        [338, 314],
      ],
      aluc: [
        [278, 384],
        [278, 402],
      ],
    },
  },
};
/** バスへの線: [名前, 出どころか] */
const STUBS: readonly [string, boolean][] = [
  ['n', true],
  ['in', true],
  ['alu', true],
  ['Ao', true],
  ['Bo', true],
  ['out', false],
  ['pc', false],
  ['Ai', false],
  ['Bi', false],
];
const SRC_STUB: Partial<Record<Port, string>> = { n: 'n', in: 'in', alu: 'alu', A: 'Ao', B: 'Bo' };
const DST_STUB: Partial<Record<Port, string>> = { A: 'Ai', B: 'Bi', out: 'out', pc: 'pc' };
/** 値の出どころ・行き先のブロック（数は命令のブロック） */
const BLK_OF: Record<Port, string> = { n: 'ir', alu: 'alu', in: 'in', A: 'A', B: 'B', out: 'out', pc: 'pc' };

const f1 = (v: number): string => (Math.round(v * 10) / 10).toString();
const ptsD = (p: readonly Pt[]): string => `M${p.map((q) => `${f1(q[0])} ${f1(q[1])}`).join('L')}`;
/** 線の終わりの矢じり */
function head(p: readonly Pt[], cls: string, k: string, s = 6): string {
  const [x1, y1] = p[p.length - 1],
    [x0, y0] = p[p.length - 2];
  const a = Math.atan2(y1 - y0, x1 - x0),
    c = Math.cos(a),
    sn = Math.sin(a);
  const q = (u: number, v: number) => `${f1(x1 + u * c - v * sn)} ${f1(y1 + u * sn + v * c)}`;
  return `<path class="cp-ah ${cls}" data-k="${k}" d="M${q(0, 0)}L${q(-s * 1.7, -s)}L${q(-s * 1.7, s)}Z"/>`;
}
/** 線を矢じりの手前で止める */
function trim(p: readonly Pt[], s = 9): Pt[] {
  const q = p.map((v) => [v[0], v[1]] as Pt),
    n = q.length,
    [x1, y1] = q[n - 1],
    [x0, y0] = q[n - 2];
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  q[n - 1] = [x1 - ((x1 - x0) / L) * s, y1 - ((y1 - y0) / L) * s];
  return q;
}
function stubPts(L: Layout, key: string, isSrc: boolean): Pt[] {
  const [x, y] = L.stub[key],
    b = L.bus;
  const bp: Pt = b.d === 'h' ? [x, b.at] : [b.at, y];
  return isSrc ? [[x, y], bp] : [bp, [x, y]];
}
const busPos = (L: Layout, key: string): number => (L.bus.d === 'h' ? L.stub[key][0] : L.stub[key][1]);

const T = (x: number, y: number, s: string | number, cls: string, a = 'start', ex = ''): string =>
  `<text class="${cls}" x="${f1(x)}" y="${f1(y)}" text-anchor="${a}"${ex}>${s}</text>`;
function cells(x: number, y: number, n: number, s: number, gap: number, data: string, idx0 = 0): string {
  let h = '';
  for (let i = 0; i < n; i++)
    h += `<rect class="cp-bit" data-b="${data}" data-i="${idx0 + i}" x="${f1(x + i * (s + gap))}" y="${f1(y)}" width="${f1(s)}" height="${f1(s)}" rx="2"/>`;
  return h;
}

/** ブロック 1 つ（枠・題・中身） */
function blkSvg(key: string, r: Rect, L: Layout): string {
  const [x, y, w, h] = r;
  let s = '',
    title = '';
  if (key === 'A' || key === 'B' || key === 'pc') {
    title = { A: 'レジスタ A', B: 'レジスタ B', pc: 'PC' }[key];
    if (w < 130) title = { A: 'A', B: 'B', pc: 'PC' }[key];
    const sz = Math.min(20, (w - 22) / 4 - 3, h - 40),
      g = 3,
      bw = 4 * sz + 3 * g;
    s += cells(x + (w - bw) / 2, y + h - sz - 10, 4, sz, g, key);
    s += T(x + w - 9, y + 20, '0', 'cp-dv', 'end', ` data-v="${key}"`);
  } else if (key === 'in') {
    title = '入力';
    const sw = Math.min(30, (w - 24) / 4 - 4),
      sh = Math.min(30, h - 38),
      g = 5,
      bw = 4 * sw + 3 * g,
      x0 = x + (w - bw) / 2;
    for (let i = 0; i < 4; i++)
      s += `<g class="cp-sw" data-inb="${i}" role="switch" tabindex="0" aria-checked="false" aria-label="入力のビット ${3 - i}"><rect class="cp-swb" x="${f1(x0 + i * (sw + g))}" y="${f1(y + h - sh - 8)}" width="${f1(sw)}" height="${f1(sh)}" rx="4"/><text class="cp-swv" x="${f1(x0 + i * (sw + g) + sw / 2)}" y="${f1(y + h - 8 - sh / 2 + 5)}" text-anchor="middle">0</text></g>`;
    s += T(x + w - 9, y + 20, '0', 'cp-dv', 'end', ' data-v="in"');
  } else if (key === 'out') {
    title = '出力';
    const rr = Math.min(12, (w - 30) / 8 - 3, (h - 40) / 2),
      g = rr * 2 + Math.min(14, (w - 8 * rr) / 5),
      bw = 3 * g;
    for (let i = 0; i < 4; i++)
      s += `<circle class="cp-lamp" data-b="out" data-i="${i}" cx="${f1(x + (w - bw) / 2 + i * g)}" cy="${f1(y + h - rr - 10)}" r="${f1(rr)}"/>`;
    s += T(x + w - 9, y + 20, '0', 'cp-dv', 'end', ' data-v="out"');
  } else if (key === 'alu') {
    title = 'ALU';
    s += T(x + w / 2, y + h / 2 + 14, '+', 'cp-plus', 'middle');
    s += T(x + w / 2, y + h - 8, 'A+B', 'cp-sub', 'middle');
  } else if (key === 'c') {
    title = 'C 桁上げ';
    s += `<circle class="cp-lamp" data-b="c" data-i="0" cx="${x + 22}" cy="${y + h - 22}" r="10"/>${T(x + w - 12, y + h - 16, '0', 'cp-dv', 'end', ' data-v="c"')}`;
  } else if (key === 'ir') {
    title = '命令';
    const sz = Math.min(19, (w - 28 - 16) / 8 - 3),
      g = 3,
      st = sz + g;
    const x0 = x + 12,
      gx = [x0, x0 + 3 * st + 6, x0 + 4 * st + 12],
      by = y + 32;
    s +=
      cells(gx[0], by, 3, sz, g, 'ir', 0) + cells(gx[1], by, 1, sz, g, 'ir', 3) + cells(gx[2], by, 4, sz, g, 'ir', 4);
    s +=
      T(gx[0] + (3 * st - g) / 2, by + sz + 15, '種類', 'cp-grp', 'middle') +
      T(gx[1] + sz / 2, by + sz + 15, 'A・B', 'cp-grp', 'middle') +
      T(gx[2] + (4 * st - g) / 2, by + sz + 15, '数', 'cp-grp', 'middle');
    /* 名前と札は 2 段に分ける（「条件ジャンプ」と札を 1 段に並べると重なる） */
    s += `<rect class="cp-irk" x="${x + 8}" y="${y + h - 52}" width="${w - 16}" height="44" rx="4"/>`;
    s +=
      T(x + 16, y + h - 35, '', 'cp-irn', 'start', ' data-v="opn"') +
      T(x + 16, y + h - 15, '', 'cp-irc', 'start', ' data-v="opc"');
    /* 命令の数からバスへの線は、数のビットの中央から出す */
    if (L.bus.d === 'h') L.stub.n[0] = gx[2] + (4 * st - g) / 2;
    else L.stub.n[1] = by + sz / 2;
  } else if (key === 'rom') {
    title = 'ROM';
    const v = L.bus.d === 'v',
      top = y + 30,
      rh = (h - 36) / 16,
      sz = Math.min(v ? 20 : 18, rh - 6),
      g = 3,
      st = sz + g,
      x0 = x + 34,
      fs = v ? 12 : 13;
    const cx = (j: number) => x0 + j * st + (j >= 3 ? 6 : 0) + (j >= 4 ? 6 : 0),
      tx = cx(7) + sz + 10;
    s +=
      T(cx(0) + (3 * st - g) / 2, y + 20, '種類', 'cp-grp', 'middle') +
      T(cx(3) + sz / 2, y + 20, 'A・B', 'cp-grp', 'middle') +
      T(cx(4) + (4 * st - g) / 2, y + 20, '数', 'cp-grp', 'middle');
    s += '<g class="cp-romg" role="grid" aria-label="ROM のビット">';
    for (let i = 0; i < 16; i++) {
      const ry = top + i * rh,
        my = ry + rh / 2;
      s += `<g role="row" data-rowg="${i}"><rect class="cp-row" data-row="${i}" x="${x + 4}" y="${f1(ry)}" width="${w - 8}" height="${f1(rh)}" rx="3"/>`;
      s += `<circle class="cp-edm" data-em="${i}" cx="${x + 9}" cy="${f1(my)}" r="3.5"/>`;
      s += T(x + 28, my + 4.5, i, 'cp-ra', 'end');
      const cy = ry + (rh - sz) / 2;
      for (let j = 0; j < 8; j++)
        s += `<g class="cp-rbx" data-r="${i}" data-j="${j}" role="gridcell" tabindex="${i || j ? -1 : 0}" aria-pressed="false" aria-label="${i} 行目のビット ${7 - j}"><rect class="cp-rbit" x="${f1(cx(j))}" y="${f1(cy)}" width="${f1(sz)}" height="${f1(sz)}" rx="2.5"/><text class="cp-rbv" x="${f1(cx(j) + sz / 2)}" y="${f1(cy + sz / 2 + 4.5)}" text-anchor="middle">0</text></g>`;
      s += `<text class="cp-rcn" data-rc="${i}" x="${f1(tx)}" y="${f1(my + 4.5)}" font-size="${fs}"></text><text class="cp-rcc" data-rcc="${i}" x="${f1(v ? tx : x + w - 10)}" y="${f1(my + 4.5)}" text-anchor="${v ? 'start' : 'end'}" font-size="${fs}"></text></g>`;
    }
    s += '</g>';
  }
  return `<g class="cp-blk" data-blk="${key}"><rect class="cp-bx" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/>${T(x + 9, y + 20, title, 'cp-bt')}${s}</g>`;
}

/** 図の SVG（ビルド時に出す。値は空のまま） */
export function figSvg(kind: Kind): string {
  const L: Layout = structuredClone(LAYOUTS[kind]);
  let blocks = '';
  for (const [k, r] of Object.entries(L.blk)) blocks += blkSvg(k, r, L);
  const b = L.bus;
  const busD = b.d === 'h' ? `M${b.a} ${b.at}H${b.b}` : `M${b.at} ${b.a}V${b.b}`;
  let w = `<path class="cp-bus" d="${busD}"/><path class="cp-busl" d="${busD}"/>`;
  w += T(
    b.d === 'h' ? b.b - 4 : b.at,
    b.d === 'h' ? b.at - 10 : b.b + 20,
    'バス',
    'cp-busn',
    b.d === 'h' ? 'end' : 'middle',
  );
  for (const [k, src] of STUBS) {
    const p = stubPts(L, k, src);
    w += `<path class="cp-wr" data-k="${k}" d="${ptsD(trim(p))}"/>${head(p, 'cp-wr', k)}`;
  }
  for (const [k, p] of Object.entries(L.wire)) {
    const cls = k === 'fetch' || k === 'ir' ? 'cp-wr cp-fw' : 'cp-wr';
    w += `<path class="${cls}" data-k="${k}" d="${ptsD(trim(p))}"/>${head(p, cls, k)}`;
  }
  /* PC の +1（横の図だけ） */
  let inc = '';
  if (b.d === 'h') {
    const [x, y, ww, h] = L.blk.pc;
    inc = `<text class="cp-inc" x="${x + ww + 8}" y="${y + h / 2 + 5}">+1</text>`;
  }
  const tag =
    '<g class="cp-tag" visibility="hidden"><rect x="-34" y="-14" width="68" height="28" rx="14"/><text class="cp-tgb" x="-6" y="5.5" text-anchor="middle">0000</text><text class="cp-tgd" x="25" y="5" text-anchor="middle">0</text></g>';
  const [x0, y0, vw, vh] = L.vb;
  return `<svg class="cp-dp cp-${kind}" data-kind="${kind}" viewBox="${x0} ${y0} ${vw} ${vh}" role="group" aria-label="CPU の値の流れ">${w}${blocks}${inc}${tag}</svg>`;
}

/** 図に出す値 */
export interface FigVals {
  pc: number;
  A: number;
  B: number;
  C: number;
  out: number;
  inp: number;
  /** 命令のブロックに出す命令 */
  ir: number;
  rom: readonly number[];
  /** 今の行（青で塗る） */
  row: number;
  /** 書き換えた行と、書き換えた時刻（performance.now） */
  edited: ReadonlyMap<number, number>;
  /** 押して選んだ行（狭い図だけ黒の枠。下の大きなスイッチで書く行） */
  sel: number;
}
/** 光る所: 命令の読み出し・値の出どころと行き先・札の進み（0〜1、null は出さない）・運ぶ値・ALU・PC の +1 */
export interface Lit {
  fetch?: boolean;
  src?: Port | null;
  dst?: Port | null;
  tag?: number | null;
  val?: number;
  alu?: boolean;
  inc?: boolean;
}

export interface Fig {
  svg: SVGSVGElement;
  update(v: FigVals, lit: Lit): void;
}

/** 書き換えた直後の黄の枠を出す時間 [ms] */
const FLASH_MS = 1400;

/** ビルド時に出した図を動かせるようにする */
export function bindFig(svg: SVGSVGElement): Fig {
  const kind = svg.dataset.kind as Kind;
  const L: Layout = structuredClone(LAYOUTS[kind]);
  /* 命令のブロックが数の線の出どころを決める（figSvg と同じ計算） */
  blkSvg('ir', L.blk.ir, L);
  const q = <E extends Element>(s: string) => [...svg.querySelectorAll<E>(s)];
  const el = {
    bits: q<SVGElement>('[data-b]'),
    vals: q<SVGTextElement>('[data-v]'),
    blks: Object.fromEntries(q<SVGGElement>('[data-blk]').map((g) => [g.dataset.blk ?? '', g])),
    wires: q<SVGElement>('[data-k]'),
    rows: q<SVGRectElement>('.cp-row'),
    rbx: q<SVGGElement>('.cp-rbx'),
    rbv: q<SVGTextElement>('.cp-rbv'),
    rcn: q<SVGTextElement>('[data-rc]'),
    rcc: q<SVGTextElement>('[data-rcc]'),
    edm: q<SVGCircleElement>('.cp-edm'),
    sw: q<SVGGElement>('.cp-sw'),
    tag: svg.querySelector('.cp-tag') as SVGGElement,
    tgb: svg.querySelector('.cp-tgb') as SVGTextElement,
    tgd: svg.querySelector('.cp-tgd') as SVGTextElement,
    busl: svg.querySelector('.cp-busl') as SVGPathElement,
  };
  const setText = (t: Element, s: string) => {
    if (t.textContent !== s) t.textContent = s;
  };
  /** 値の札の通り道（ブロック → バス → ブロック） */
  function path(src: Port, dst: Port): Pt[] {
    const a = stubPts(L, SRC_STUB[src] ?? '', true),
      z = stubPts(L, DST_STUB[dst] ?? '', false);
    return [a[0], a[1], z[0], z[1]];
  }
  function along(p: Pt[], f: number): Pt {
    const seg: number[] = [];
    let tot = 0;
    for (let i = 1; i < p.length; i++) {
      const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      seg.push(l);
      tot += l;
    }
    let d = f * tot;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const t = seg[i] ? Math.min(1, d / seg[i]) : 0;
        return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t];
      }
      d -= seg[i];
    }
    return p[p.length - 1];
  }
  function update(v: FigVals, lit: Lit): void {
    const val: Record<string, number> = { A: v.A, B: v.B, pc: v.pc, out: v.out, in: v.inp, c: v.C };
    for (const r of el.bits) {
      const k = r.dataset.b ?? '',
        i = Number(r.dataset.i);
      const on = k === 'ir' ? (v.ir >> (7 - i)) & 1 : k === 'c' ? v.C : (val[k] >> (3 - i)) & 1;
      r.classList.toggle('on', !!on);
    }
    const d = dec(v.ir);
    for (const t of el.vals) {
      const k = t.dataset.v ?? '';
      setText(t, k === 'opn' ? d.nm : k === 'opc' ? chip(d) : String(val[k]));
    }
    el.sw.forEach((g, i) => {
      const on = (v.inp >> (3 - i)) & 1;
      g.classList.toggle('on', !!on);
      g.setAttribute('aria-checked', String(!!on));
      setText(g.querySelector('.cp-swv') as Element, String(on));
    });
    const now = performance.now();
    el.rows.forEach((r, i) => {
      r.classList.toggle('cur', i === v.row);
      r.classList.toggle('sel', kind === 'narrow' && i === v.sel);
      r.classList.toggle('flash', now - (v.edited.get(i) ?? -1e9) < FLASH_MS);
    });
    el.edm.forEach((c, i) => {
      c.classList.toggle('on', v.edited.has(i));
    });
    el.rbx.forEach((g, k) => {
      const on = (v.rom[k >> 3] >> (7 - (k & 7))) & 1;
      g.classList.toggle('on', !!on);
      g.setAttribute('aria-pressed', String(!!on));
      setText(el.rbv[k], String(on));
    });
    el.rcn.forEach((t, i) => {
      const di = dec(v.rom[i]);
      /* 狭い図は札だけ（停止は札がないので名前） */
      setText(t, kind === 'narrow' && di.k !== 'hlt' ? '' : di.nm);
      setText(el.rcc[i], chip(di));
    });
    /* 光る所 */
    const on = new Set<string>();
    if (lit.fetch) on.add('fetch').add('ir');
    if (lit.alu) on.add('Aalu').add('Balu').add('aluc');
    if (lit.src) on.add(SRC_STUB[lit.src] ?? '');
    if (lit.dst && lit.tag != null && lit.tag > 0.5) on.add(DST_STUB[lit.dst] ?? '');
    for (const w of el.wires) w.classList.toggle('on', on.has(w.dataset.k ?? ''));
    for (const [k, g] of Object.entries(el.blks)) {
      g.classList.toggle(
        'src',
        !!lit.src && (k === BLK_OF[lit.src] || (lit.src === 'alu' && (k === 'A' || k === 'B'))),
      );
      g.classList.toggle('dst', !!lit.dst && k === BLK_OF[lit.dst] && lit.tag != null && lit.tag >= 1);
    }
    el.blks.ir?.classList.toggle('fet', !!lit.fetch);
    el.blks.rom?.classList.toggle('fet', !!lit.fetch);
    svg.querySelector('.cp-inc')?.classList.toggle('on', !!lit.inc);
    /* バスの光る区間と札 */
    if (lit.src && lit.dst && lit.tag != null) {
      const p = path(lit.src, lit.dst),
        b0 = busPos(L, SRC_STUB[lit.src] ?? ''),
        b1 = busPos(L, DST_STUB[lit.dst] ?? '');
      const f = Math.min(1, lit.tag),
        e = b0 + (b1 - b0) * Math.min(1, Math.max(0, (f - 0.15) / 0.7));
      el.busl.setAttribute('d', L.bus.d === 'h' ? `M${b0} ${L.bus.at}H${f1(e)}` : `M${L.bus.at} ${b0}V${f1(e)}`);
      el.busl.classList.add('on');
      const [tx, ty] = along(p, f);
      el.tag.setAttribute('transform', `translate(${f1(tx)} ${f1(ty)})`);
      el.tag.setAttribute('visibility', f < 1 ? 'visible' : 'hidden');
      setText(el.tgb, b4(lit.val ?? 0));
      setText(el.tgd, String(lit.val ?? 0));
    } else {
      el.busl.classList.remove('on');
      el.tag.setAttribute('visibility', 'hidden');
    }
  }
  return { svg, update };
}

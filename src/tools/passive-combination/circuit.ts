/** 組み合わせの回路図（SVG の文字列。DOM に依存しない）。抵抗器・インダクタはカラーコード付きの本体で描く */
import { esc } from '../../lib/dom';
import { fmt } from '../../lib/format';
import { type Cand, codeOf, conn, leaves, type Node } from './model';
import { TY, type Ty } from './params';

/* 素子 1 本の幅・高さ・端子の高さ、直列の間隔、並列の母線の長さ・段の間隔、端子の余白 */
const LW = 76,
  LY = 24,
  LH = 42,
  GAP = 10,
  BUS = 14,
  VG = 4,
  TW = 16;
/** 本体の色: 抵抗器は肌色、インダクタは緑 */
const BODY = { R: '#fbddc9', L: '#68b697' };
/** 帯の x 位置（本体の左端から）: 4 本帯・5 本帯 */
const BX4 = [8, 14, 20, 33],
  BX5 = [6, 11, 16, 21, 34];

/** 描画の蓄積: 配線の path、素子、接続点、値のラベル */
interface G {
  w: string[];
  b: string[];
  j: [number, number][];
  t: string[];
}
interface Lay {
  w: number;
  h: number;
  /** 端子の高さ（上端から） */
  y: number;
  d: (g: G, px: number, py: number) => void;
}

function leaf(g: G, v: number, ty: Ty, px: number, py: number): void {
  const cy = py + LY,
    cx = px + LW / 2,
    u = TY[ty].u;
  if (ty === 'C') {
    g.w.push(`M${px} ${cy}H${cx - 4}M${cx + 4} ${cy}H${px + LW}`);
    g.b.push(`<path class="s-pl" d="M${cx - 4} ${cy - 11}V${cy + 11}M${cx + 4} ${cy - 11}V${cy + 11}"/>`);
  } else {
    const col = BODY[ty],
      bx = cx - 22,
      by = cy - 8,
      bd = codeOf(v, ty);
    g.w.push(`M${px} ${cy}H${bx}M${bx + 44} ${cy}H${px + LW}`);
    g.b.push(
      `<rect class="s-bd" x="${bx}" y="${by}" width="44" height="16" rx="6" fill="${col}" style="stroke:color-mix(in srgb,${col},#000 45%)"/>` +
        (bd
          ? bd
              .map(
                ([, c], i) =>
                  `<rect x="${bx + (bd.length === 4 ? BX4 : BX5)[i]}" y="${by + 0.5}" width="4" height="15" fill="${c}"/>`,
              )
              .join('')
          : '') +
        `<rect class="s-sh" x="${bx}" y="${by}" width="44" height="16" rx="6"/>`,
    );
  }
  g.t.push(
    `<text class="s-v" x="${cx}" y="${cy - (ty === 'C' ? 15 : 12)}" text-anchor="middle">${esc(fmt(v, u, 3))}</text>`,
  );
}

function lay(x: Node, ty: Ty): Lay {
  if (typeof x === 'number') return { w: LW, h: LH, y: LY, d: (g, px, py) => leaf(g, x, ty, px, py) };
  const cs = x.c.map((c) => lay(c, ty));
  if (conn(x.o, ty) === 'ser') {
    const up = Math.max(...cs.map((c) => c.y)),
      dn = Math.max(...cs.map((c) => c.h - c.y));
    const w = cs.reduce((s, c) => s + c.w, 0) + GAP * (cs.length - 1);
    return {
      w,
      h: up + dn,
      y: up,
      d: (g, px, py) => {
        let cx = px;
        cs.forEach((c, i) => {
          if (i) g.w.push(`M${cx - GAP} ${py + up}H${cx}`);
          c.d(g, cx, py + up - c.y);
          cx += c.w + GAP;
        });
      },
    };
  }
  const iw = Math.max(...cs.map((c) => c.w)),
    w = iw + 2 * BUS;
  let h = 0;
  const tops = cs.map((c) => {
    const t = h;
    h += c.h + VG;
    return t;
  });
  h -= VG;
  const ys = cs.map((c, i) => tops[i] + c.y),
    y0 = ys[0],
    y1 = ys[ys.length - 1],
    my = (y0 + y1) / 2;
  return {
    w,
    h,
    y: my,
    d: (g, px, py) => {
      g.w.push(`M${px} ${py + y0}V${py + y1}M${px + w} ${py + y0}V${py + y1}`);
      cs.forEach((c, i) => {
        const cx = px + BUS + (iw - c.w) / 2,
          yy = py + ys[i];
        g.w.push(`M${px} ${yy}H${cx}M${cx + c.w} ${yy}H${px + w}`);
        c.d(g, cx, py + tops[i]);
        if (i && i < cs.length - 1) g.j.push([px, yy], [px + w, yy]);
      });
      g.j.push([px, py + my], [px + w, py + my]);
    },
  };
}

const DEFS =
  '<defs><linearGradient id="lu-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#cc9a34"/><stop offset=".66" stop-color="#f5ebd6"/><stop offset="1" stop-color="#cc9a34"/></linearGradient>' +
  '<linearGradient id="lu-s" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#cccecc"/><stop offset=".66" stop-color="#f5f5f5"/><stop offset="1" stop-color="#cccecc"/></linearGradient>' +
  '<linearGradient id="bdsh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>';

/** 候補 c の回路図。両端に端子を置き、幅に合わせて縮める（最大で 2 倍まで拡大） */
export function circuitSvg(c: Cand, ty: Ty): string {
  const T = TY[ty],
    L = lay(c.tr, ty),
    g: G = { w: [], b: [], j: [], t: [] },
    ox = TW + 5,
    oy = 4;
  L.d(g, ox, oy);
  const vw = L.w + 2 * ox,
    vh = L.h + oy * 2,
    py = oy + L.y;
  g.w.push(`M5 ${py}H${ox}M${ox + L.w} ${py}H${vw - 5}`);
  const cc =
    ty === 'C'
      ? ''
      : `。カラーコード: ${[...new Set(leaves(c.tr))]
          .map(
            (v) =>
              `${fmt(v, T.u, 3)} ${
                codeOf(v, ty)
                  ?.map((b) => b[0])
                  .join('') ?? '表せない値'
              }`,
          )
          .join('、')}`;
  const label = `${c.n} 本の${T.nm}の回路: ${c.x}（+ は直列、∥ は並列）。合成値 ${fmt(c.v, T.u, 6)}${cc}`;
  return (
    `<svg class="sch" viewBox="0 0 ${vw} ${vh}" style="max-width:${Math.round(vw * 2)}px" role="img" aria-label="${esc(label)}">` +
    DEFS +
    `<path class="s-w" d="${g.w.join('')}"/>` +
    g.b.join('') +
    g.j.map(([x, y]) => `<circle class="s-j" cx="${x}" cy="${y}" r="2.6"/>`).join('') +
    `<circle class="s-o" cx="5" cy="${py}" r="3.5"/><circle class="s-o" cx="${vw - 5}" cy="${py}" r="3.5"/>` +
    g.t.join('') +
    '</svg>'
  );
}

/** 組み合わせの回路図（SVG の文字列。DOM に依存しない）。抵抗器・インダクタはカラーコード付きの本体で描く */
import { BAND_GRADIENTS, RESISTOR_BODY } from '../../lib/colorcode';
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
const BODY = { R: RESISTOR_BODY, L: '#68b697' };
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

const DEFS = `<defs>${BAND_GRADIENTS}</defs>`;

/* 図の枠（縦横比を固定する）の幅・高さと、拡大の上限。幅は 5 本の直列が等倍で収まる大きさ */
const BOX_W = 5 * LW + 4 * GAP + 2 * (TW + 5),
  BOX_H = 200,
  MAX_S = 1.6;

/**
 * 候補 c の回路図。枠の縦横比は本数・つなぎ方によらず同じで、図は枠に収まるように拡大・縮小して中央に置く。
 * 両端の端子は枠の左右に置く
 */
export function circuitSvg(c: Cand, ty: Ty): string {
  const T = TY[ty],
    L = lay(c.tr, ty),
    g: G = { w: [], b: [], j: [], t: [] },
    ox = TW + 5,
    oy = 4,
    s = Math.min(BOX_W / (L.w + 2 * ox), BOX_H / (L.h + 2 * oy), MAX_S),
    r1 = (x: number) => Math.round(x * 10) / 10,
    vw = r1(BOX_W / s),
    vh = r1(BOX_H / s),
    lx = r1((vw - L.w) / 2),
    ly = r1((vh - L.h) / 2);
  L.d(g, lx, ly);
  const py = ly + L.y;
  g.w.push(`M5 ${py}H${lx}M${r1(lx + L.w)} ${py}H${r1(vw - 5)}`);
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
    `<svg class="sch" viewBox="0 0 ${vw} ${vh}" role="img" aria-label="${esc(label)}">` +
    DEFS +
    `<path class="s-w" d="${g.w.join('')}"/>` +
    g.b.join('') +
    g.j.map(([x, y]) => `<circle class="s-j" cx="${x}" cy="${y}" r="2.6"/>`).join('') +
    `<circle class="s-o" cx="5" cy="${py}" r="3.5"/><circle class="s-o" cx="${r1(vw - 5)}" cy="${py}" r="3.5"/>` +
    g.t.join('') +
    '</svg>'
  );
}

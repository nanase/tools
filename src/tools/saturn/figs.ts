/**
 * 土星のページの図の SVG（DOM に依存しない）: 北から見た軌道（半径は対数）と環の傾きのグラフ。
 * 衛星の色は CSS の pn-k1〜pn-k8・pn-f1〜pn-f8（lib/planet/planet.css）
 */
const f1 = (v: number): string => v.toFixed(1);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ---------- 北から見た軌道 ---------- */

/** 図の外周の半径に当てる土星の半径の数（フェーベの軌道） */
const R_MAX = 215;
/** 土星の半径 r の点の図の上の半径。フェーベまで 1 枚に入れるため対数にする */
export const logR = (r: number): number => 10 + (Math.log(Math.max(1, r)) / Math.log(R_MAX)) * 106;

export interface OrbitSatOpt {
  /** 衛星の位置（土星の半径。x は右、y は下が地球の向き）と名前。names が空文字の衛星は名前を出さない */
  moons: [number, number][];
  names: string[];
  /** 軌道の半径（土星の半径） */
  orbits: number[];
  /** 軌道が大きく傾く衛星の番号（破線で描く） */
  dashed: number[];
  /** 太陽への向き（同じ座標の単位ベクトル） */
  sun: [number, number];
  /** 環の内縁と外縁（土星の半径） */
  ring: [number, number];
}

export function orbitSat(o: OrbitSatOpt): string {
  const c = 150;
  const h: string[] = [];
  const [ux, uy] = o.sun;
  /* 土星の影: 幅が土星の直径の帯。対数の図では外へ行くほど細い */
  const ang = Math.atan2(-uy, -ux);
  const side = (sgn: number) => {
    const pts: string[] = [];
    for (let k = 0; k <= 40; k++) {
      const r = R_MAX ** (k / 40);
      const a = ang + sgn * Math.asin(Math.min(1, 1 / r));
      pts.push(`${f1(c + logR(r) * Math.cos(a))},${f1(c + logR(r) * Math.sin(a))}`);
    }
    return pts;
  };
  h.push(`<polygon class="pn-shd" points="${side(1).join(' ')} ${side(-1).reverse().join(' ')}"></polygon>`);
  o.orbits.forEach((r, k) => {
    h.push(
      `<circle class="${o.dashed.includes(k) ? 'pn-orbx' : 'pn-orb'}" cx="${c}" cy="${c}" r="${f1(logR(r))}"></circle>`,
    );
  });
  const r0 = logR(o.ring[0]),
    r1 = logR(o.ring[1]);
  h.push(
    `<circle class="pn-rg" cx="${c}" cy="${c}" r="${f1((r0 + r1) / 2)}" style="stroke-width:${f1(r1 - r0)}"></circle>`,
    `<circle class="pn-pl" cx="${c}" cy="${c}" r="${f1(logR(1))}"></circle>`,
  );
  /* 名前は衛星の外側に置き、重ならないよう少しずらす */
  const used: [number, number][] = [];
  o.moons.forEach(([x, y], k) => {
    const rr = Math.hypot(x, y);
    const R = logR(rr);
    const px = c + (x / rr) * R,
      py = c + (y / rr) * R;
    h.push(`<circle class="${k < 8 ? `pn-f${k + 1}` : 'pn-fx'}" cx="${f1(px)}" cy="${f1(py)}" r="3.4"></circle>`);
    if (!o.names[k]) return;
    const a = Math.atan2(py - c, px - c);
    let lx = px + Math.cos(a) * 9,
      ly = py + Math.sin(a) * 9 + 4;
    while (used.some(([p, q]) => Math.abs(p - lx) < 44 && Math.abs(q - ly) < 12)) ly += 12;
    used.push([lx, ly]);
    const anchor = Math.cos(a) < -0.3 ? 'end' : Math.cos(a) > 0.3 ? 'start' : 'middle';
    if (anchor === 'middle') lx = px;
    h.push(`<text class="pn-tn" x="${f1(lx)}" y="${f1(ly)}" text-anchor="${anchor}">${esc(o.names[k])}</text>`);
  });
  /* 地球へ（真下）・太陽へ・公転の向き */
  h.push(
    '<path class="pn-eyar" d="M178 272V296M173 290L178 296L183 290"></path><text class="pn-ts" x="186" y="294">地球へ</text>',
  );
  const sx = 120,
    sy = 284;
  const ex = sx + ux * 13,
    ey = sy + uy * 13,
    bx = sx - ux * 13,
    by = sy - uy * 13;
  const ah = (a: number) =>
    `${f1(ex - 6 * Math.cos(Math.atan2(uy, ux) + a))} ${f1(ey - 6 * Math.sin(Math.atan2(uy, ux) + a))}`;
  h.push(
    `<path class="pn-sunar" d="M${f1(bx)} ${f1(by)}L${f1(ex)} ${f1(ey)}M${ah(0.5)}L${f1(ex)} ${f1(ey)}L${ah(-0.5)}"></path><text class="pn-ts" x="${sx - 18}" y="${sy + 10}" text-anchor="end">太陽へ</text>`,
    '<path class="pn-ax" d="M274 96A134 134 0 0 0 226 40"></path><path class="pn-ax" d="M231 38L225 40L228 46"></path><text class="pn-ts" x="268" y="34" text-anchor="end">公転</text>',
    '<text class="pn-ts" x="2" y="12">半径は対数</text>',
  );
  return h.join('');
}

/* ---------- 環の傾き ---------- */

/** グラフの描く範囲（viewBox は -40 -18 680 226、中は 0〜600 × 0〜180）。縦は ±30° */
export const TILT = { w: 600, h: 180 };
const tiltY = (b: number): number => TILT.h / 2 - (b / 30) * (TILT.h / 2);

export interface TiltOpt {
  /** 横の範囲（年） */
  y0: number;
  y1: number;
  /** [年, 地球から見た傾き B, 太陽から見た傾き B′]（°） */
  pts: [number, number, number][];
  /** 目盛りの年の間隔 */
  every: number;
  /** 印（地球が環の面を横切る時） */
  marks: number[];
}

export function tiltChart(o: TiltOpt): string {
  const X = (y: number) => ((y - o.y0) / (o.y1 - o.y0)) * TILT.w;
  const h: string[] = [];
  let gr = `M0 ${tiltY(30)}H${TILT.w}M0 ${tiltY(-30)}H${TILT.w}`;
  for (let y = Math.ceil(o.y0 / o.every) * o.every; y <= o.y1; y += o.every) gr += `M${f1(X(y))} 0V${TILT.h}`;
  h.push(`<path class="pn-gr" d="${gr}"></path><path class="pn-tl0" d="M0 ${tiltY(0)}H${TILT.w}"></path>`);
  for (let y = Math.ceil(o.y0 / o.every) * o.every; y <= o.y1; y += o.every)
    h.push(`<text x="${f1(X(y))}" y="${TILT.h + 16}" text-anchor="middle">${y}</text>`);
  for (const b of [30, 0, -30])
    h.push(
      `<text x="-6" y="${f1(tiltY(b) + 4)}" text-anchor="end">${b === 0 ? '0°' : `${b > 0 ? '+' : '−'}30°`}</text>`,
    );
  h.push(
    `<text class="pn-ts" x="4" y="${f1(tiltY(30) + 13)}">北面が見える</text>`,
    `<text class="pn-ts" x="4" y="${f1(tiltY(-30) - 5)}">南面が見える</text>`,
  );
  const line = (i: 1 | 2) => {
    let d = '';
    let pen = false;
    for (const p of o.pts) {
      if (p[0] < o.y0 || p[0] > o.y1) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${f1(X(p[0]))} ${f1(tiltY(p[i]))}`;
      pen = true;
    }
    return d;
  };
  h.push(`<path class="pn-tle" d="${line(1)}"></path><path class="pn-tls" d="${line(2)}"></path>`);
  for (const y of o.marks)
    if (y >= o.y0 && y <= o.y1) h.push(`<circle class="pn-pk" cx="${f1(X(y))}" cy="${f1(tiltY(0))}" r="3"></circle>`);
  h.push(
    `<path class="pn-now" id="tnow" d=""></path><text class="pn-nowt" id="tnowt" y="-6" text-anchor="middle"></text>`,
  );
  return h.join('');
}

/** グラフの横の位置から年へ */
export const tiltYear = (o: { y0: number; y1: number }, x: number): number => o.y0 + (x / TILT.w) * (o.y1 - o.y0);

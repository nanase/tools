/** リレーで作る論理回路の図（展開接続図・入力の行・タイミングチャート・しくみの小さな図） */
import { esc } from '../../lib/dom';
import { type Def, lbOf } from './circuits';
import { type Circuit, IN_COL, IN_ROW, type Pt } from './net';

const rd = (v: number): number => Math.round(v * 10) / 10;

/** 折れ線の配線と、いちばん長い区間の中ほどの矢じり（電流の向き。電流が流れるときだけ見せる） */
export function wirePath(pts: readonly Pt[], id: string): string {
  const d = `M${pts.map((p) => p.join(' ')).join('L')}`;
  let best = 0,
    bi = 1;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (L > best) {
      best = L;
      bi = i;
    }
  }
  const [x0, y0] = pts[bi - 1],
    [x1, y1] = pts[bi];
  const an = rd((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI);
  const arr =
    best >= 36
      ? `<path class="arw" d="M-5 -4.5L4 0L-5 4.5Z" transform="translate(${rd((x0 + x1) / 2)} ${rd((y0 + y1) / 2)}) rotate(${an})"/>`
      : '';
  return `<g class="wg" data-w="${id}"><path class="w" d="${d}"/>${arr}</g>`;
}

/** ランプ（丸に ×） */
export const lamp = (x: number, y: number, r = 12): string =>
  `<g class="lamp"><circle cx="${x}" cy="${y}" r="${r}" class="lc"/><path d="M${rd(x - r * 0.7)} ${rd(y - r * 0.7)}L${rd(x + r * 0.7)} ${rd(y + r * 0.7)}M${rd(x + r * 0.7)} ${rd(y - r * 0.7)}L${rd(x - r * 0.7)} ${rd(y + r * 0.7)}" class="lx"/></g>`;

/** 小さなリレー（コイルと鉄心と接極子）。原点は左上、幅 56・高さ 44 */
export function miniRelay(x: number, y: number, id: string): string {
  let st = '';
  for (let k = 0; k < 4; k++) st += `<line x1="7" y1="${20 + k * 5}" x2="31" y2="${20 + k * 5}" class="mw"/>`;
  return `<g class="mr" data-mr="${id}" transform="translate(${x} ${y})"><path class="iron" d="M3 40H53V13H48V36H3Z"/><rect x="6" y="17" width="26" height="20" rx="2" class="mcoil"/>${st}<rect x="15" y="12" width="8" height="5" class="iron"/><g class="marm" transform="rotate(13 50 9)"><rect x="9" y="6.5" width="43" height="5" rx="1" class="arm"/><circle cx="50" cy="9" r="2" class="piv"/></g></g>`;
}
/** 接極子の角度（x は 0 復帰・1 動作） */
export const armAngle = (x: number): string => `rotate(${rd((1 - x) * 13)} 50 9)`;

/** 入力の行（スイッチ・押しボタン、リレーの入力はスイッチから小さなリレーへの線） */
function inputs(def: Def, cols: number): string {
  let s = '';
  def.ins.forEach((q, i) => {
    const x = 18 + (i % cols) * IN_COL,
      yo = Math.floor(i / cols) * IN_ROW;
    s += `<g transform="translate(${x} ${yo})">`;
    if (q.kind === 'push') {
      s += `<g class="pkey k-${q.col ?? 'g'}" data-key="${q.id}" tabindex="0" role="button" aria-pressed="false" aria-label="${esc(q.lb)}（押している間だけ閉じる）"><circle cx="34" cy="38" r="30" class="hitc"/><circle cx="34" cy="38" r="25" class="pring"/><circle cx="34" cy="38" r="19" class="pcap"/></g><text x="34" y="86" class="kn2" text-anchor="middle">${esc(q.lb)}</text>`;
    } else {
      s += `<g class="skey" data-key="${q.id}" tabindex="0" role="switch" aria-checked="false" aria-label="${esc(q.lb)}"><rect x="6" y="14" width="56" height="50" rx="6" class="keyb"/><text x="34" y="36" class="kn" text-anchor="middle">${esc(q.lb)}</text><text x="34" y="55" class="kvv" text-anchor="middle" data-kv="${q.id}">0</text></g>`;
      if (q.kind === 'rel')
        s += `<path d="M62 39H84" class="w kw" data-kw="${q.id}"/>${miniRelay(86, 18, q.id)}<text x="114" y="86" class="mlb" text-anchor="middle">リレー ${esc(q.lb)}</text>`;
    }
    s += '</g>';
  });
  return s;
}

/** 回路の図。入力の行・電池・配線・接点・負荷 */
export function circuitSvg(def: Def, G: Circuit): string {
  let s = `<svg viewBox="0 0 ${G.W} ${G.H}" class="ry-ckt" role="group" aria-label="${esc(def.name)}の回路" style="max-width:${Math.round(G.W * 1.08)}px">`;
  s += inputs(def, G.cols);
  /* 電池（長い板が +） */
  const [xb, yB] = G.bat;
  s += `<g class="bat"><line x1="${xb}" y1="${yB - 15}" x2="${xb}" y2="${yB + 15}" class="bp"/><line x1="${xb + 10}" y1="${yB - 8}" x2="${xb + 10}" y2="${yB + 8}" class="bp bs"/><text x="${xb - 5}" y="${yB + 30}" class="pm" text-anchor="middle">+</text></g>`;
  for (const d of G.D) {
    if (d.k === 'w') s += wirePath(d.pts, String(d.e));
    else if (d.k === 'end') s += `<circle cx="${d.x}" cy="${d.y}" r="3" class="dot"/>`;
    else if (d.k === 'txt') s += `<text x="${d.x}" y="${d.y}" class="mlb" text-anchor="middle">${esc(d.t)}</text>`;
  }
  for (const d of G.D) {
    if (d.k === 'c') {
      const { x, y, r, t } = d;
      s += `<g class="cnt" data-e="${d.e}"><path class="w" d="M${x} ${y}H${x + 8}M${x + 48} ${y}H${x + 56}"/><circle cx="${x + 8}" cy="${y}" r="3" class="dot"/><circle cx="${x + 48}" cy="${y}" r="3" class="dot"/><line x1="${x + 8}" y1="${y}" x2="${x + 49}" y2="${y}" class="blade"/><text x="${x + 28}" y="${y - 19}" class="cref" text-anchor="middle">${esc(lbOf(def, r))}</text><text x="${x + 28}" y="${y + 21}" class="ctp" text-anchor="middle">${t}</text></g>`;
    } else if (d.k === 'cc') {
      const { com, st, cr } = d;
      const lx = (com[0] + st[0]) / 2,
        ly = d.below ? com[1] + 24 : com[1] - 14;
      s += `<g class="ccn" data-cc="${d.eb}"><circle cx="${com[0]}" cy="${com[1]}" r="3" class="dot"/><circle cx="${st[0]}" cy="${st[1]}" r="3" class="dot"/><circle cx="${cr[0]}" cy="${cr[1]}" r="3" class="dot"/><line x1="${com[0]}" y1="${com[1]}" x2="${st[0]}" y2="${st[1]}" class="blade"/><text x="${lx}" y="${ly}" class="cref" text-anchor="middle">${esc(lbOf(def, d.r))}</text></g>`;
    } else if (d.k === 'load') {
      const { x, y, ld } = d;
      if (ld.kind === 'lamp')
        s += `<g class="ldg" data-ld="${d.e}"><path class="w" d="M${x} ${y}H${x + 16}M${x + 40} ${y}H${x + 56}"/>${lamp(x + 28, y)}<text x="${x + 28}" y="${y - 18}" class="lref" text-anchor="middle">${esc(ld.lb)}</text></g>`;
      else {
        s += `<g class="ldg" data-ld="${d.e}"><path class="w" d="M${x} ${y}H${x + 56}"/>`;
        if (ld.kind === 'coilC')
          s += `<g class="capg" data-capr="${ld.id}"><path class="w" d="M${x + 2} ${y}V${y + 50}H${x + 25}M${x + 31} ${y + 50}H${x + 54}V${y}"/><path d="M${x + 25} ${y + 40}V${y + 60}M${x + 31} ${y + 40}V${y + 60}" class="bp"/><text x="${x + 28}" y="${y + 76}" class="nm" text-anchor="middle">C</text></g>`;
        s += `${miniRelay(x, y - 27, ld.id)}<text x="${x + 72}" y="${y - 9}" class="lref" text-anchor="middle">${ld.id}</text></g>`;
      }
    }
  }
  return `${s}</svg>`;
}

/** 刃の先（c 接点）。u は 0 で復帰の端子、1 で動作の端子。どちらにも触れない間は少し手前で止める */
export function ccTip(d: { com: Pt; st: Pt; cr: Pt }, a: boolean, b: boolean, x: number): Pt {
  const u = a ? 1 : b ? 0 : Math.min(0.85, Math.max(0.15, x));
  const tx = d.st[0] + (d.cr[0] - d.st[0]) * u,
    ty = d.st[1] + (d.cr[1] - d.st[1]) * u;
  const sh = a || b ? 1 : 0.8;
  return [rd(d.com[0] + (tx - d.com[0]) * sh), rd(d.com[1] + (ty - d.com[1]) * sh)];
}
/** a・b 接点の刃の角度。閉じていれば 0、開いていれば跳ね上がる */
export function bladeAngle(t: 'a' | 'b', closed: boolean, x: number): number {
  if (closed) return 0;
  const ang = t === 'a' ? -18 * (1 - x) : -18 * x;
  return rd(Math.min(ang, -5));
}

/** タイミングチャートの行: 名前・値の列・色の種類 */
export interface ChartRow {
  lb: string;
  k: 'in' | 'rel' | 'out';
  /** [時刻 ms, 値] の変化の並び（古い順） */
  ev: readonly (readonly [number, number])[];
}
/** 直近 win ms のタイミングチャート。now が右端 */
export function chartSvg(rows: readonly ChartRow[], now: number, win: number, w: number): string {
  const RV = 30,
    lw = 56,
    rh = 24,
    H0 = rows.length * rh + 6,
    H = H0 + 18;
  const W = Math.max(240, w),
    xe = W - RV - 6,
    X = (t: number) => rd(lw + ((t - (now - win)) / win) * (xe - lw));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`;
  for (let k = 0; k <= win / 1000; k += 2) {
    const x = X(now - win + k * 1000);
    const sec = k - win / 1000;
    s += `<path class="cg" d="M${x} 0V${H0}"/><text class="ca" x="${x}" y="${H - 4}" text-anchor="middle">${sec ? `−${-sec}` : '今'}</text>`;
  }
  s += `<text class="ca" x="${lw - 7}" y="${H - 4}" text-anchor="end">秒</text>`;
  rows.forEach((r, j) => {
    const y0 = j * rh + 4,
      yh = y0 + 3,
      yl = y0 + rh - 5;
    s += `<text class="cl ${r.k}" x="${lw - 7}" y="${y0 + rh / 2 + 4}" text-anchor="end">${esc(r.lb)}</text>`;
    /* 窓の左端より前の最後の値から始める */
    let v = 0,
      i = 0;
    while (i < r.ev.length && r.ev[i][0] <= now - win) v = r.ev[i++][1];
    let d = `M${lw} ${v ? yh : yl}`;
    for (; i < r.ev.length; i++) {
      const [t, nv] = r.ev[i];
      if (nv === v) continue;
      d += `H${X(t)}V${nv ? yh : yl}`;
      v = nv;
    }
    d += `H${xe}`;
    s += `<path class="cw ${r.k}" d="${d}"/>`;
    s += `<text class="cv ${r.k}" x="${rd(xe + 3 + RV / 2)}" y="${y0 + rh / 2 + 4}" text-anchor="middle">${v}</text>`;
  });
  s += `<path class="cs" d="M${xe} 0V${H0}"/>`;
  return `${s}</svg>`;
}

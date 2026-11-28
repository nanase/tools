/** リレーで作る論理回路の図（展開接続図・入力の行・タイミングチャート・しくみの小さな図） */
import { esc } from '../../lib/dom';
import { type Def, lbOf } from './circuits';
import { type Circuit, type Contacts, IN_COL, IN_ROW, type Pt, RELAY_BOX } from './net';

const rd = (v: number): number => Math.round(v * 10) / 10;

/** 折れ線の配線 */
const wirePath = (pts: readonly Pt[], id: string): string =>
  `<path class="w" data-w="${id}" d="M${pts.map((p) => p.join(' ')).join('L')}"/>`;

/** 接点の名前。動作で開く側（b）は上線を付ける */
const cname = (t: string, x: number, y: number, cls: string, ov: boolean, anchor = 'middle'): string =>
  `<text x="${x}" y="${y}" class="${cls}${ov ? ' ov' : ''}" text-anchor="${anchor}">${esc(t)}</text>`;

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
        s += `<path d="M62 39H84" class="w kw" data-kw="${q.id}"/>${miniRelay(86, 18, q.id)}<text x="114" y="86" class="mlb" text-anchor="middle">リレー ${esc(q.rn ?? q.lb)}</text>`;
    }
    s += '</g>';
  });
  return s;
}

/** 回路の図。入力の行・配線・電流の粒の層・接点・負荷・つながる点・電池。粒は接点の刃と端子を隠さないよう、その下に流す */
export function circuitSvg(def: Def, G: Circuit): string {
  let s = `<svg viewBox="0 0 ${G.W} ${G.H}" class="ry-ckt" role="group" aria-label="${esc(def.name)}の回路" style="max-width:${Math.round(G.W * 1.08)}px">`;
  s += inputs(def, G.cols);
  for (const d of G.D) {
    if (d.k === 'w') s += wirePath(d.pts, String(d.e));
    else if (d.k === 'txt') s += `<text x="${d.x}" y="${d.y}" class="mlb" text-anchor="middle">${esc(d.t)}</text>`;
  }
  s += '<g class="pts"></g>';
  for (const d of G.D) {
    if (d.k === 'c') {
      const { x, y, r, t } = d;
      s += `<g class="cnt" data-e="${d.e}"><path class="w" d="M${x} ${y}H${x + 8}M${x + 48} ${y}H${x + 56}"/><circle cx="${x + 8}" cy="${y}" r="3" class="dot"/><circle cx="${x + 48}" cy="${y}" r="3" class="dot"/><line x1="${x + 8}" y1="${y}" x2="${x + 49}" y2="${y}" class="blade"/>${cname(lbOf(def, r), x + 28, y - 19, 'cref', t === 'b')}</g>`;
    } else if (d.k === 'cc') {
      const { com, st, cr } = d,
        nm = lbOf(def, d.r);
      /* 端子の名前は共通の端子と反対の側に。復帰でつながる側（b）は上線 */
      const sd = com[0] < st[0] ? 1 : -1,
        an = sd > 0 ? 'start' : 'end';
      s += `<g class="ccn" data-cc="${d.eb}"><circle cx="${com[0]}" cy="${com[1]}" r="3" class="dot"/><circle cx="${st[0]}" cy="${st[1]}" r="3" class="dot"/><circle cx="${cr[0]}" cy="${cr[1]}" r="3" class="dot"/><line x1="${com[0]}" y1="${com[1]}" x2="${st[0]}" y2="${st[1]}" class="blade"/>${cname(nm, st[0] + 4 * sd, st[1] - 5, 'cref2', true, an)}${cname(nm, cr[0] + 4 * sd, cr[1] - 5, 'cref2', false, an)}</g>`;
    } else if (d.k === 'load') {
      const { x, y, ld } = d;
      if (ld.kind === 'lamp')
        s += `<g class="ldg" data-ld="${d.e}"><path class="w" d="M${x} ${y}H${x + 16}M${x + 40} ${y}H${x + 56}"/>${lamp(x + 28, y)}<text x="${x + 28}" y="${y - 18}" class="lref" text-anchor="middle">${esc(ld.lb)}</text></g>`;
      else {
        /* 線の上にコイルの記号、その真上にリレーの絵 */
        s += `<g class="ldg" data-ld="${d.e}"><path class="w" d="M${x} ${y}H${x + 13}M${x + 43} ${y}H${x + 56}"/>`;
        if (ld.kind === 'coilC')
          s += `<g class="capg" data-capr="${ld.id}"><path class="w" d="M${x + 2} ${y}V${y + 50}H${x + 25}M${x + 31} ${y + 50}H${x + 54}V${y}"/><path d="M${x + 25} ${y + 40}V${y + 60}M${x + 31} ${y + 40}V${y + 60}" class="bp"/><text x="${x + 28}" y="${y + 76}" class="nm" text-anchor="middle">C</text></g><circle cx="${x + 2}" cy="${y}" r="3.5" class="jn"/><circle cx="${x + 54}" cy="${y}" r="3.5" class="jn"/>`;
        s += `<rect x="${x + 13}" y="${y - 10}" width="30" height="20" rx="2" class="coil"/><text x="${x + 28}" y="${y + 4.5}" class="cname" text-anchor="middle">${esc(ld.id)}</text>${miniRelay(x + RELAY_BOX[0], y + RELAY_BOX[1], ld.id)}</g>`;
      }
    }
  }
  for (const [x, y] of G.J) s += `<circle cx="${x}" cy="${y}" r="3.5" class="jn"/>`;
  for (const [x, y] of G.O) s += `<circle cx="${x}" cy="${y}" r="4" class="op"/>`;
  G.L.forEach(([i, j], k) => {
    const [a, b] = linkEnds(G.D[i], G.D[j], REST);
    s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="lk" data-lk="${k}"/>`;
  });
  /* 電池（長い板が +）。線の端を隠すように線より上に描く */
  const [xb, yB] = G.bat;
  s += `<g class="bat"><line x1="${xb}" y1="${yB - 15}" x2="${xb}" y2="${yB + 15}" class="bp"/><line x1="${xb + 10}" y1="${yB - 8}" x2="${xb + 10}" y2="${yB + 8}" class="bp bs"/><text x="${xb - 5}" y="${yB + 30}" class="pm" text-anchor="middle">+</text></g>`;
  return `${s}</svg>`;
}

/** 動いていないリレーの接点 */
const REST: Contacts = () => ({ a: false, b: true, x: 0 });

/** 同じリレーの接点をつなぐ点線の両端。上は刃の中ほど。下の接点の上に名前があれば、名前に重ねずその上で止める */
export function linkEnds(a: Circuit['D'][number], b: Circuit['D'][number], cs: Contacts): [Pt, Pt] {
  const p = bladeMid(a, cs);
  return [p, b.k === 'c' ? [p[0], b.y - 35] : bladeMid(b, cs)];
}

/** 刃の中ほど */
function bladeMid(d: Circuit['D'][number], cs: Contacts): Pt {
  if (d.k === 'c') {
    const r = cs(d.r),
      an = (bladeAngle(d.t, d.t === 'a' ? r.a : r.b, r.x) * Math.PI) / 180;
    return [rd(d.x + 8 + 20.5 * Math.cos(an)), rd(d.y + 20.5 * Math.sin(an))];
  }
  if (d.k === 'cc') {
    const r = cs(d.r),
      [tx, ty] = ccTip(d, r.a, r.b, r.x);
    return [rd((d.com[0] + tx) / 2), rd((d.com[1] + ty) / 2)];
  }
  return [0, 0];
}

/**
 * 電流の粒の通り道: 辺の添字と、u から v への折れ線。負荷は部品の中を通さず、左右の線だけ。
 * コンデンサ付きのコイルは、コンデンサの枝（cap、充電の向き）と、放電でも電流が通るコイルの左右の線（coil）を足す
 */
export interface FlowRun {
  e: number;
  pts: readonly Pt[];
  cap?: string;
  coil?: string;
}
export function flowRuns(G: Circuit): FlowRun[] {
  const out: FlowRun[] = [];
  const seg = (e: number, x0: number, x1: number, y: number) =>
    out.push({
      e,
      pts: [
        [x0, y],
        [x1, y],
      ],
    });
  for (const d of G.D) {
    if (d.k === 'w') out.push({ e: d.e, pts: d.pts });
    else if (d.k === 'c') seg(d.e, d.x, d.x + 56, d.y);
    else if (d.k === 'cc') {
      out.push({ e: d.eb, pts: [d.com, d.st] });
      out.push({ e: d.ea, pts: [d.com, d.cr] });
    } else if (d.k === 'load') {
      const { x, y, ld } = d;
      if (ld.kind === 'coilC') {
        /* コンデンサの枝が分かれる点（x + 2 と x + 54）の内側だけ。放電の電流はこの内側を回る */
        out.push({
          e: d.e,
          coil: ld.id,
          pts: [
            [x + 2, y],
            [x + 13, y],
          ],
        });
        out.push({
          e: d.e,
          coil: ld.id,
          pts: [
            [x + 43, y],
            [x + 54, y],
          ],
        });
        out.push({
          e: -1,
          cap: ld.id,
          pts: [
            [x + 2, y],
            [x + 2, y + 50],
            [x + 25, y + 50],
          ],
        });
        out.push({
          e: -1,
          cap: ld.id,
          pts: [
            [x + 31, y + 50],
            [x + 54, y + 50],
            [x + 54, y],
          ],
        });
        continue;
      }
      const [l, r] = ld.kind === 'lamp' ? [16, 40] : [13, 43];
      seg(d.e, x, x + l, y);
      seg(d.e, x + r, x + 56, y);
    }
  }
  return out;
}

/** 凡例: その回路にある接点の種類と、点線・つながらない端・電流 */
export function legendHtml(def: Def, G: Circuit): string {
  const name = (t: 'a' | 'b'): string | null => {
    const d = G.D.find((x) => (x.k === 'c' && x.t === t) || x.k === 'cc');
    return d && (d.k === 'c' || d.k === 'cc') ? lbOf(def, d.r) : null;
  };
  const a = name('a'),
    b = name('b');
  let s = '';
  if (a) s += `<span class="stag"><b>${esc(a)}</b>動作で閉じる接点</span>`;
  if (b) s += `<span class="stag"><b class="ov">${esc(b)}</b>動作で開く接点</span>`;
  if (G.L.length) s += '<span class="stag"><i class="sw ry-lk"></i>一緒に動く接点</span>';
  if (G.O.length) s += '<span class="stag"><i class="ry-op"></i>どこにもつながらない端</span>';
  return `${s}<span class="stag"><i class="sw ry-sw"></i>電流</span>`;
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

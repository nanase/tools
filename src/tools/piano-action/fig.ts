/**
 * アクションを横から見た図（SVG、単位は mm）。部品の外形は Hirschkorn (2004) の図 A.1 の線。
 * 地面の座標は y が上向きなので、部品は scale(1,−1) の群の中に描く。
 * 主の図は要素を一度だけ作り、コマごとに transform と位置だけを変える。段階のコマの絵は文字列で作る
 */
import type { Body } from './geom';
import { CONTACTS, PG2, PG3 } from './geom';
import { gp, pose, type Rig, touch } from './model';
import { OUTLINE } from './outline';

const MM = 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const deg = (a: number) => r2((a * 180) / Math.PI);
export const PARTS: readonly Body[] = ['key', 'whippen', 'rep', 'jack', 'hammer'];

/* ---------- バックチェック: 鍵の外形から、頭（4〜6）と針金（0・1）を分ける ---------- */
const KEY_SUB = OUTLINE.key
  .split('M')
  .filter((s) => s.trim())
  .map((s) => `M${s}`);
const HEAD_I = [4, 5, 6],
  WIRE_I = [0, 1];
const KEY_BASE = KEY_SUB.filter((_, i) => !HEAD_I.includes(i) && !WIRE_I.includes(i)).join('');
/** 点の組を写す */
const mapPath = (d: string, f: (x: number, y: number) => [number, number]) =>
  d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => {
    const [a, b] = f(Number(x), Number(y));
    return `${r2(a)} ${r2(b)}`;
  });
/** バックチェックの頭を、鍵の座標で (dx, dy) [mm] 動かした外形。針金は根元（y 29.5）を残して傾ける */
function checkPath(dx: number, dy: number): { head: string; wire: string } {
  const head = HEAD_I.map((i) => mapPath(KEY_SUB[i], (x, y) => [x + dx, y + dy])).join('');
  const wire = WIRE_I.map((i) =>
    mapPath(KEY_SUB[i], (x, y) => {
      const s = Math.max(0, Math.min(1, (y - 29.5) / 30.5));
      return [x + dx * s, y + dy * s];
    }),
  ).join('');
  return { head, wire };
}
/** 表のバックチェックの点 [m]（鍵の座標） */
const CHECK0 = [-0.2192, 0.0817] as const;

/* ---------- ダンパー（論文の模型にない。仮の形） ---------- */
/** 鍵の後ろの端（ダンパーのてこのフェルトが載る点）[m]、てこの軸の x・針金の x [mm]、てこが鍵に触れるまでの隙間 [mm] */
const KEY_TAIL = [-0.233, 0.0167] as const;
/** ダンパーのてこのフェルトが鍵に載っている接触の番号（模型の 13 か所のあと） */
export const DAMPER_N = 14;
const DMP_PX = -300,
  DMP_WX = -262,
  DMP_GAP = 3.9;
/** ダンパーの持ち上がり [mm]。鍵の後ろが 3.9 mm 上がってから、その 0.56 倍で上がる */
export function damperLift(q: ArrayLike<number>, q0: ArrayLike<number>): number {
  const y = gp(pose(q), 'key', KEY_TAIL)[1],
    y0 = gp(pose(q0), 'key', KEY_TAIL)[1];
  return Math.max(0, 0.56 * (y - y0) * MM - 2.2);
}

/* ---------- 要素の文字列 ---------- */
const VB_FULL = [-322, -200, 578, 232] as const,
  /** 狭い画面: 鍵の前の長い部分を切る */
  VB_NARROW = [-312, -200, 380, 232] as const,
  VB_THUMB = [-298, -192, 270, 212] as const;
/** 動かない部分（キーベッド・バランスピン・バックレール・ハンマーレール・フレンジ） */
const FIXED = `<line class="fx-l" x1="-320" x2="255" y1="-15.5" y2="-15.5"/><path class="fx" d="M-4 -15.5L0 -1.6L4 -15.5Z"/><circle class="ft" cx="-203.7" cy="-10.5" r="5"/><circle class="ft" cx="-192.1" cy="76.6" r="5"/><rect class="fx" x="-196" y="34" width="22" height="12"/><rect class="fx" x="-100" y="119" width="30" height="10"/>`;
const PIVOTS = `<circle class="pv" cx="0" cy="0" r="1.6"/><circle class="pv" cx="${PG2[0] * MM}" cy="${PG2[1] * MM}" r="1.6"/><circle class="pv" cx="${PG3[0] * MM}" cy="${PG3[1] * MM}" r="1.6"/>`;
/** 整調で動く部分（弦・フロントレールの山・レットオフボタン・ドロップねじ） */
function rigged(rig: Rig, str = true): string {
  const s = r2(rig.str * MM),
    f = r2(rig.front * MM),
    b = r2(rig.button * MM),
    d = r2(rig.dropY * MM),
    dx = -84.3;
  return `${str ? `<line class="str" x1="-322" x2="-138" y1="${s}" y2="${s}"/>` : ''}<circle class="ft" cx="217.2" cy="${f}" r="5"/><rect class="fx" x="-63" y="${b}" width="10" height="5"/><line class="mt" x1="-58" x2="-58" y1="${r2(b + 5)}" y2="${r2(b + 30)}"/><line class="mt" x1="${dx}" x2="${dx}" y1="${d}" y2="128"/><circle class="ft" cx="${dx}" cy="${d}" r="3.3"/>`;
}
const tf = (o: readonly number[], a: number) => `translate(${r2(o[0] * MM)},${r2(o[1] * MM)}) rotate(${deg(a)})`;
function bodies(q: ArrayLike<number>, rig: Rig, cls: (b: Body) => string): string {
  const P = pose(q),
    c = checkPath((rig.check[0] - CHECK0[0]) * MM, (rig.check[1] - CHECK0[1]) * MM);
  let s = '';
  for (const b of PARTS) {
    const d = b === 'key' ? KEY_BASE + c.head + c.wire : OUTLINE[b];
    s += `<g transform="${tf(P.o[b], P.a[b])}"><path class="bd ${b} ${cls(b)}" d="${d}"/></g>`;
  }
  return s;
}
/**
 * ダンパー: 頭は自分の重さで弦に載り、てこは針金で頭から下がる。てこの先のフェルトは、静止のとき
 * 鍵の後ろの端から DMP_GAP だけ上にあり、鍵がそれだけ上がると触れて持ち上がり始める（鍵の深さの途中から上がる）
 */
function damper(q: ArrayLike<number>, q0: ArrayLike<number>, rig: Rig, cls: string): string {
  const k0 = gp(pose(q0), 'key', KEY_TAIL),
    tx = k0[0] * MM,
    /* フェルトの下面・てこの下面・軸の高さ（静止のとき） */
    pad = k0[1] * MM + DMP_GAP,
    py = pad + 2 + 2.5,
    dl = damperLift(q, q0),
    a = Math.atan2(dl, DMP_WX - DMP_PX),
    L = tx - DMP_PX + 8,
    hy = rig.str * MM + 0.6;
  return `<g transform="translate(${DMP_PX},${r2(py)}) rotate(${deg(a)})"><rect class="bd damper ${cls}" x="0" y="-2.5" width="${r2(L)}" height="5" rx="1"/><rect class="ft" x="${r2(tx - DMP_PX - 4)}" y="-4.5" width="8" height="2"/><circle class="pv" cx="0" cy="0" r="1.6"/></g><g transform="translate(0,${r2(dl)})"><line class="bd damper ${cls}" x1="${DMP_WX}" x2="${DMP_WX}" y1="${r2(py + 2.5)}" y2="${r2(hy + 1)}"/><rect class="bd damper ${cls}" x="-272" y="${r2(hy)}" width="20" height="13" rx="1.5"/><rect class="ft" x="-271" y="${r2(hy)}" width="18" height="4"/></g>`;
}

/** 段階のコマの絵（強調する部品のほかは薄く） */
export function thumbSvg(q: ArrayLike<number>, q0: ArrayLike<number>, rig: Rig, focus: readonly string[]): string {
  const cls = (b: string) => (focus.length ? (focus.includes(b) ? 'em' : 'dim') : '');
  return `<svg viewBox="${VB_THUMB.join(' ')}" aria-hidden="true"><g transform="scale(1,-1)">${FIXED}${rigged(rig)}${damper(q, q0, rig, cls('damper'))}${bodies(q, rig, cls)}${PIVOTS}</g></svg>`;
}

/* ---------- 主の図 ---------- */
export interface Draw {
  q: ArrayLike<number>;
  /** 強調する部品（空なら全部ふつう） */
  focus: readonly string[];
  /** 力を伝えている接触の番号・図の上に輪を付ける接触の番号 */
  on: readonly number[];
  hl: number;
  /** 鍵の前を押している・ハンマーの頭の速さ [m/s]（null なら出さない） */
  push: boolean;
  vel: number | null;
  /** 打弦の波紋（打った点 [mm]・打ってからの実時間 [s]・弦の振れの大きさ [mm]・減衰の時定数 [s]） */
  ripples: readonly Ripple[];
}
export interface Ripple {
  x: number;
  age: number;
  a: number;
  tau: number;
}
/** 波紋の速さ（見やすい速さ）[mm/s]: 弦を伝わる山・まわりへ広がる輪 */
const C_STR = 90,
  C_RING = 45;
/** 弦の線（打った点から左右へ山が伝わる）と、打った点から広がる輪。y は下向き */
function stringSvg(str: number, rs: readonly Ripple[]): string {
  const y0 = -str * MM;
  if (!rs.length) return `<line class="str" x1="-322" x2="-138" y1="${r2(y0)}" y2="${r2(y0)}"/>`;
  let d = '';
  for (let x = -322; x <= -138; x += 1) {
    let u = 0;
    for (const r of rs) {
      const A = r.a * Math.exp(-r.age / r.tau),
        s = r.age * C_STR,
        g = (z: number) => Math.exp(-(z * z) / 50);
      u += (A / 2) * (g(x - r.x - s) + g(x - r.x + s));
    }
    d += `${d ? 'L' : 'M'}${x} ${r2(y0 - u)}`;
  }
  let rings = '';
  for (const r of rs)
    for (let k = 0; k < 3; k++) {
      const a = r.age - 0.35 * k,
        o = (1 - r.age / 2.4) * Math.min(1, r.a / 3);
      if (a > 0 && o > 0)
        rings += `<circle class="rip" cx="${r2(r.x)}" cy="${r2(y0)}" r="${r2(a * C_RING)}" style="opacity:${r2(o)}"/>`;
    }
  return `${rings}<path class="str" d="${d}"/>`;
}
/** 名前と役割を出す部品 */
export type PartTip = 'button' | 'drop' | 'check';
export const PART_TIP: Record<PartTip, { name: string; role: string }> = {
  button: {
    name: 'レットオフボタン',
    role: 'ジャックのつま先が当たる止め。鍵を押していき、ハンマーが弦からレットオフの距離まで近づいたところでつま先が当たる。ジャックは回ってナックルの下から抜け、ハンマーは押し付けられずに自分の勢いで弦を打って跳ね返れる',
  },
  drop: {
    name: 'ドロップねじ',
    role: 'レペティションレバーの先が上がりすぎないよう止めるねじ。ウィッペンが上がる途中でレバーを止める。ジャックが抜けたあとハンマーが落ちてレバーに載る高さ（ドロップ）は、これで決まる',
  },
  check: {
    name: 'バックチェック',
    role: '鍵の後ろに立つ受け。弦から跳ね返って落ちてきたハンマーの尾を受け止め、鍵を押している間ハンマーを途中の高さで止めておく。ハンマーが弦をもう一度打つのを防ぎ、連打に備えさせる',
  },
};
/** 図の上で名前を出せる所（SVG の座標、y は下向き） */
export type Spot =
  | { kind: 'contact'; n: number; x: number; y: number; r: number }
  | { kind: 'part'; id: PartTip; x: number; y: number; r: number; y2?: number };

export class ActionFig {
  /** 直前に描いた、名前を出せる所 */
  spots: Spot[] = [];
  private rig: Rig | null = null;
  private q0: ArrayLike<number> = [0, 0, 0, 0, 0];
  private readonly g: SVGGElement;
  private readonly top: SVGGElement;
  private readonly lab: HTMLElement;
  private vb: readonly number[] = VB_FULL;
  private readonly svg: SVGSVGElement;
  constructor(svg: SVGSVGElement, lab: HTMLElement) {
    svg.setAttribute('viewBox', VB_FULL.join(' '));
    this.svg = svg;
    svg.innerHTML = `<g transform="scale(1,-1)"></g><g></g>`;
    this.g = svg.firstElementChild as SVGGElement;
    this.top = svg.lastElementChild as SVGGElement;
    this.lab = lab;
  }
  /** 整調と静止の姿勢（弦・ボタン・ドロップねじ・フロントレール・バックチェックの位置）を変える */
  setRig(rig: Rig, q0: ArrayLike<number>): void {
    this.rig = rig;
    this.q0 = q0;
  }
  /** 画面の点（client 座標）に近い、名前を出せる所（tol は許す距離 [px]） */
  hit(cx: number, cy: number, tol: number): Spot | null {
    const r = this.svg.getBoundingClientRect(),
      k = this.vb[2] / Math.max(1, r.width),
      x = this.vb[0] + (cx - r.left) * k,
      y = this.vb[1] + (cy - r.top) * k;
    let best: Spot | null = null,
      bd = Infinity;
    for (const s of this.spots) {
      /* ドロップねじは、ねじの棒も含める */
      const yy = s.kind === 'part' && s.y2 !== undefined ? Math.min(s.y, Math.max(s.y2, y)) : s.y;
      const d = Math.hypot(x - s.x, y - yy) - s.r;
      /* 接触の点を部品より先に選ぶ */
      const w = s.kind === 'contact' ? d - 2 * k : d;
      if (d < tol * k && w < bd) {
        bd = w;
        best = s;
      }
    }
    return best;
  }
  /** SVG の座標を、図の枠の中の位置 [px] に */
  px(x: number, y: number): [number, number] {
    const r = this.svg.getBoundingClientRect(),
      k = r.width / this.vb[2];
    return [(x - this.vb[0]) * k, (y - this.vb[1]) * k];
  }
  /** 狭い画面では鍵の前を切って、機構を大きく見せる */
  setNarrow(on: boolean): void {
    this.vb = on ? VB_NARROW : VB_FULL;
    this.svg.setAttribute('viewBox', this.vb.join(' '));
  }
  /** SVG の座標（y は下向き）を、図に重ねる HTML の位置（%）にする */
  private pc(x: number, y: number): string {
    const v = this.vb;
    return `left:${r2(((x - v[0]) / v[2]) * 100)}%;top:${r2(((y - v[1]) / v[3]) * 100)}%`;
  }
  draw(o: Draw): void {
    const rig = this.rig;
    if (!rig) return;
    const cls = (b: string) => (o.focus.length ? (o.focus.includes(b) ? 'em' : 'dim') : '');
    this.g.innerHTML = `${FIXED}${rigged(rig, false)}${damper(o.q, this.q0, rig, cls('damper'))}${bodies(o.q, rig, cls)}${PIVOTS}`;
    /* 上に重ねるもの（y は下向き） */
    const P = pose(o.q);
    let s = stringSvg(rig.str, o.ripples);
    if (o.push) {
      const k = gp(P, 'key', [0.2278, 0.0261]),
        x = r2(k[0] * MM),
        y = r2(-k[1] * MM - 3);
      s += `<line class="push" x1="${x}" x2="${x}" y1="${y - 22}" y2="${y - 4}"/><path class="pushh" d="M${x - 3} ${y - 5}L${x} ${y}L${x + 3} ${y - 5}Z"/>`;
    }
    let velLab = '';
    if (o.vel !== null) {
      const h = gp(P, 'hammer', [-0.1321, 0.0356]),
        x = r2(h[0] * MM + 16),
        y0 = r2(-h[1] * MM),
        y1 = r2(y0 - Math.min(30, o.vel * 9));
      s += `<line class="vel" x1="${x}" x2="${x}" y1="${y0}" y2="${y1}"/><path class="velh" d="M${x - 2.5} ${y1 + 4}L${x} ${y1}L${x + 2.5} ${y1 + 4}Z"/>`;
      velLab = `<span class="a-vel" style="${this.pc(x + 4, y1 + 4)}">${o.vel.toFixed(2)} m/s</span>`;
    }
    const spots: Spot[] = [];
    for (const n of o.on) {
      const T = touch(P, CONTACTS[n - 1], rig),
        x = r2(T.x[0] * MM),
        y = r2(-T.x[1] * MM);
      s += `<circle class="cdot" cx="${x}" cy="${y}" r="2.2"/>`;
      spots.push({ kind: 'contact', n, x, y, r: 2.2 });
    }
    /* ダンパーのてこのフェルトが鍵の後ろの端に載っている間 */
    if (damperLift(o.q, this.q0) > 0) {
      const k = gp(P, 'key', KEY_TAIL),
        x = r2(k[0] * MM),
        y = r2(-k[1] * MM);
      s += `<circle class="cdot" cx="${x}" cy="${y}" r="2.2"/>`;
      spots.push({ kind: 'contact', n: DAMPER_N, x, y, r: 2.2 });
    }
    const h = spots.find((x) => x.kind === 'contact' && x.n === o.hl);
    if (h) s += `<circle class="chl" cx="${h.x}" cy="${h.y}" r="7"/>`;
    this.top.innerHTML = s;
    /* 色のない小さな部品の名前（引き出し線なしで、すぐ横に） */
    const b = rig.button * MM,
      d = rig.dropY * MM,
      ck = gp(P, 'key', rig.check),
      ckc = gp(P, 'key', [rig.check[0] - 0.006, rig.check[1] - 0.004]);
    spots.push(
      { kind: 'part', id: 'button', x: -58, y: -(b + 2.5), r: 6 },
      { kind: 'part', id: 'drop', x: -84.3, y: -d, r: 4, y2: -128 },
      { kind: 'part', id: 'check', x: ckc[0] * MM, y: -ckc[1] * MM, r: 11 },
    );
    this.spots = spots;
    this.lab.innerHTML =
      `<span class="a-lab" style="${this.pc(-160, -rig.str * MM - 7)}">弦</span>` +
      `<span class="a-lab hv" data-p="button" style="${this.pc(-50, -(b + 2.5))}">レットオフボタン</span>` +
      `<span class="a-lab hv" data-p="drop" style="${this.pc(-79.3, -(d + 9))}">ドロップねじ</span>` +
      `<span class="a-lab hv r" data-p="check" style="${this.pc(ck[0] * MM - 15, -ck[1] * MM)}">バックチェック</span>` +
      velLab;
  }
}

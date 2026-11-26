/**
 * 固有運動のページ: 星図（ステレオ図法）を動かしながら、年のバーで星の位置を進める。
 * 星の表と星座は public/proper-motion/ から読む（scripts/proper-motion.ts が作る）
 */
import type { Vec3 } from '../../lib/astro/vec';
import { $, $$, esc } from '../../lib/dom';
import { initFullscreen } from '../../lib/fullscreen';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { GAL, MW_H, MW_STEP, MW_W, type SkyJson } from './format';
import { mountHow } from './how';
import { angDeg, decode, dirAt, fillAt, LY, NOW, poleAt, posAt, type Stars, YMAX, YMIN } from './model';
import { FOV_HOME, type Look, type Proj, panned, project, raDecOf, vecOf, zoomed } from './view';

initToolPage();
mountHow($('#pm-how'));

const BASE = import.meta.env.BASE_URL;
const stage = $('#pm-stage'),
  cv = $<HTMLCanvasElement>('#pm-cv'),
  tip = $('#pm-tip'),
  tipIn = $('#pm-tipi'),
  trk = $<HTMLButtonElement>('#pm-trk'),
  sel = $<HTMLSelectElement>('#pm-con'),
  yearIn = $<HTMLInputElement>('#pm-year'),
  runBtn = $<HTMLButtonElement>('#pm-run'),
  spdSel = $<HTMLSelectElement>('#pm-spd');
const NARROW = matchMedia('(max-width:720px)');
const D = Math.PI / 180;
const GREEK: Record<string, string> = {
  Alp: 'α',
  Bet: 'β',
  Gam: 'γ',
  Del: 'δ',
  Eps: 'ε',
  Zet: 'ζ',
  Eta: 'η',
  The: 'θ',
  Iot: 'ι',
  Kap: 'κ',
  Lam: 'λ',
  Mu: 'μ',
  Nu: 'ν',
  Xi: 'ξ',
  Omi: 'ο',
  Pi: 'π',
  Rho: 'ρ',
  Sig: 'σ',
  Tau: 'τ',
  Ups: 'υ',
  Phi: 'φ',
  Chi: 'χ',
  Psi: 'ψ',
  Ome: 'ω',
};
/** 星の並び（sky.json の aster のキー）と名前 */
const ASTER = [
  ['dip', '北斗七星'],
  ['sum', '夏の大三角'],
  ['win', '冬の大三角'],
] as const;
type Opt = 'lines' | 'ghost' | 'names' | 'trail' | 'mw' | 'pole';

/* ---------- 状態 ---------- */
const st = {
  look: { ra: 180, dec: 55, fov: 70 } as Look,
  year: NOW,
  run: false,
  spd: 5000,
  sel: 'dip',
  opt: { lines: true, ghost: true, names: true, trail: true, mw: true, pole: false } as Record<Opt, boolean>,
  hover: -1,
  pin: -1,
  track: -1,
};
let S: Stars | null = null;
let SKY: SkyJson | null = null;
interface Group {
  n: string;
  lines: number[][];
  mem: number[];
}
let GROUPS: Record<string, Group> = {};
/** 今の向き（年 NOW）と、表示している年の向き・等級 */
let V0 = new Float64Array(0),
  VY = new Float64Array(0),
  MY = new Float32Array(0);
let shownYear = Number.NaN;

/* ---------- 表記 ---------- */
function fmtRel(y: number): string {
  const n = Math.round((y - NOW) / 100) * 100;
  if (n === 0) return '現在';
  const a = Math.abs(n),
    man = Math.floor(a / 10000),
    rest = a % 10000;
  return `${man ? `${man} 万${rest ? ` ${rest} ` : ''}` : `${rest} `}年${n > 0 ? '後' : '前'}`;
}
const fmtYear = (y: number): string => {
  const r = Math.round(y);
  return r <= 0 ? `紀元前 ${1 - r} 年` : `西暦 ${r} 年`;
};
const fmtDeg = (a: number): string => `${a < 1 ? a.toFixed(2) : a < 10 ? a.toFixed(1) : Math.round(a)}°`;
const fmtLy = (pc: number): string => {
  const ly = pc * LY;
  return ly < 100 ? ly.toFixed(1) : Math.round(ly).toLocaleString('ja-JP');
};
function starName(i: number): string {
  if (!SKY || !S) return '';
  const nm = SKY.names[i];
  if (nm) return nm;
  const con = SKY.cons[S.con[i] as number]?.[1] ?? '';
  const b = SKY.bay[i];
  if (b) {
    const g = b.slice(0, 3),
      num = b.slice(3);
    return `${con}${GREEK[g] ?? g}${num}`;
  }
  return con ? `${con}の星` : '';
}
const setT = (el: HTMLElement, t: string): void => {
  if (el.textContent !== t) el.textContent = t;
};

/* ---------- 描く ---------- */
let W = 0,
  H = 0,
  PJ: Proj = project(st.look, 1, 1),
  dirty = true;
/** 描いた星 [x, y, 番号, 半径]（押した星を探す） */
let DRAWN: [number, number, number, number][] = [];
/** 描いた星座名の箱 [左, 上, 右, 下, 略符]（押した星座名を探す） */
let CONHIT: [number, number, number, number, string][] = [];
const LINEC = 'rgba(130,160,215,.38)',
  SELC = 'rgba(190,215,255,.95)',
  GHOSTC = 'rgba(160,190,240,.55)',
  NAMEC = 'rgba(165,190,235,.82)',
  STARN = 'rgba(255,236,200,.95)',
  PATHC = '#ffb347',
  SKYC = '#050914';
let sans = 'sans-serif';

function fitCanvas(): CanvasRenderingContext2D {
  const r = Math.min(2, devicePixelRatio || 1);
  W = cv.clientWidth;
  H = cv.clientHeight;
  const w = Math.round(W * r),
    h = Math.round(H * r);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  c.setTransform(r, 0, 0, r, 0, 0);
  return c;
}
const starR = (m: number, k: number): number => Math.max(0.7, 3.1 - 0.48 * m) * k;
function starCol(bv: number, a: number): string {
  const t = Math.max(-0.3, Math.min(1.8, bv)),
    r = t < 0.4 ? 205 + (t + 0.3) * 70 : 255,
    g = t < 0.4 ? 222 + (t + 0.3) * 40 : 250 - (t - 0.4) * 45,
    b = t < 0.4 ? 255 : 245 - (t - 0.4) * 105;
  return `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(2)})`;
}
function arrowHead(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, s = 7): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45));
  c.lineTo(x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45));
  c.closePath();
  c.fill();
}
const inView = (p: [number, number] | null, m = 30): p is [number, number] =>
  !!p && p[0] > -m && p[0] < W + m && p[1] > -m && p[1] < H + m;
const vAt = (a: Float64Array, i: number): Vec3 => [a[i * 3] as number, a[i * 3 + 1] as number, a[i * 3 + 2] as number];
function seg(c: CanvasRenderingContext2D, a: [number, number] | null, b: [number, number] | null): void {
  if (!a || !b || Math.abs(a[0] - b[0]) > W || Math.abs(a[1] - b[1]) > W) return;
  c.moveTo(a[0], a[1]);
  c.lineTo(b[0], b[1]);
}

/* 天の川: 格子の点ごとに柔らかい円を描いてぼかす。見る向きが変わったときだけ描き直す */
const MWP: [Vec3, number][] = [];
const mwA = document.createElement('canvas'),
  mwB = document.createElement('canvas');
let mwKey = '';
function buildMw(sky: SkyJson): void {
  const b = Uint8Array.from(atob(sky.mw), (ch) => ch.charCodeAt(0));
  for (let y = 0; y < MW_H; y++)
    for (let x = 0; x < MW_W; x++) {
      const v = b[y * MW_W + x] as number;
      if (v < 24) continue;
      const g = vecOf((x + 0.5) * MW_STEP, -90 + (y + 0.5) * MW_STEP);
      /* 銀河座標から赤道へ（GAL の転置） */
      const e: Vec3 = [0, 1, 2].map((k) => GAL[0][k] * g[0] + GAL[1][k] * g[1] + GAL[2][k] * g[2]) as Vec3;
      MWP.push([e, v / 255]);
    }
}
function drawMw(c: CanvasRenderingContext2D): void {
  const key = `${st.look.ra.toFixed(3)},${st.look.dec.toFixed(3)},${st.look.fov.toFixed(3)},${W},${H}`;
  if (key !== mwKey) {
    mwKey = key;
    const q = 0.5,
      w = Math.max(1, Math.ceil(W * q)),
      h = Math.max(1, Math.ceil(H * q));
    for (const x of [mwA, mwB]) {
      x.width = w;
      x.height = h;
    }
    const a = mwA.getContext('2d') as CanvasRenderingContext2D;
    let rad = 0;
    for (const [v, lv] of MWP) {
      const p = PJ.P(v);
      if (!inView(p, 160)) continue;
      const z = v[0] * PJ.c[0] + v[1] * PJ.c[1] + v[2] * PJ.c[2],
        r = 1.3 * MW_STEP * D * (2 / (1 + z)) * PJ.S * q;
      rad = Math.max(rad, r);
      a.fillStyle = `rgba(175,195,255,${(0.008 + 0.032 * lv).toFixed(3)})`;
      a.beginPath();
      a.arc(p[0] * q, p[1] * q, r, 0, 2 * Math.PI);
      a.fill();
    }
    const b = mwB.getContext('2d') as CanvasRenderingContext2D;
    b.filter = `blur(${Math.max(1.5, Math.min(30, rad * 0.9)).toFixed(1)}px)`;
    b.drawImage(mwA, 0, 0);
    b.filter = 'none';
  }
  c.drawImage(mwB, 0, 0, W, H);
}

/* 道すじ: 今から表示している年まで。矢じりは時間の進む向き */
function track(c: CanvasRenderingContext2D, i: number): void {
  if (!S) return;
  const y0 = Math.min(st.year, NOW),
    y1 = Math.max(st.year, NOW),
    pts: [number, number][] = [];
  for (let k = 0; k <= 14; k++) {
    const p = PJ.P(dirAt(S, i, y0 + ((y1 - y0) * k) / 14));
    if (p) pts.push(p);
  }
  if (pts.length < 2) return;
  c.beginPath();
  for (const [k, p] of pts.entries()) {
    if (k) c.lineTo(p[0], p[1]);
    else c.moveTo(p[0], p[1]);
  }
  c.stroke();
  const q = pts[pts.length - 1] as [number, number],
    p = pts[pts.length - 2] as [number, number];
  arrowHead(c, p[0], p[1], q[0], q[1]);
}

function draw(): void {
  const c = fitCanvas();
  PJ = project(st.look, W, H);
  c.fillStyle = SKYC;
  c.fillRect(0, 0, W, H);
  if (!S || !SKY) return;
  if (st.year !== shownYear) {
    fillAt(S, st.year, VY, MY);
    shownYear = st.year;
  }
  const { P } = PJ,
    g = GROUPS[st.sel],
    moved = Math.round(st.year) !== NOW;
  if (st.opt.mw) drawMw(c);
  if (st.opt.pole) {
    c.strokeStyle = 'rgba(255,179,71,.35)';
    c.setLineDash([3, 5]);
    c.lineWidth = 1.2;
    c.beginPath();
    let prev: [number, number] | null = null;
    for (let y = NOW - 26000; y <= NOW; y += 200) {
      const p = P(poleAt(y));
      seg(c, prev, p);
      prev = p;
    }
    c.stroke();
    c.setLineDash([]);
  }
  if (st.opt.lines) {
    c.strokeStyle = LINEC;
    c.lineWidth = 1;
    c.beginPath();
    for (const [k, pls] of Object.entries(SKY.lines)) {
      if (k === st.sel) continue;
      for (const pl of pls)
        for (let j = 1; j < pl.length; j++) seg(c, P(vAt(VY, pl[j - 1] as number)), P(vAt(VY, pl[j] as number)));
    }
    c.stroke();
  }
  if (g) {
    if (moved && st.opt.ghost) {
      c.strokeStyle = GHOSTC;
      c.lineWidth = 1.2;
      c.setLineDash([4, 4]);
      c.beginPath();
      for (const pl of g.lines)
        for (let j = 1; j < pl.length; j++) seg(c, P(vAt(V0, pl[j - 1] as number)), P(vAt(V0, pl[j] as number)));
      c.stroke();
      c.setLineDash([]);
    }
    c.strokeStyle = SELC;
    c.lineWidth = 1.8;
    c.beginPath();
    for (const pl of g.lines)
      for (let j = 1; j < pl.length; j++) seg(c, P(vAt(VY, pl[j - 1] as number)), P(vAt(VY, pl[j] as number)));
    c.stroke();
  }
  /* 道すじ: 選んだ星座の星と、画面の上で大きく動いた明るい星 10 個 */
  if (st.opt.trail && moved) {
    const list = new Set(g ? g.mem : []),
      cand: [number, number][] = [];
    for (let i = 0; i < S.n && (S.mag[i] as number) <= 4.5; i++) {
      if (list.has(i)) continue;
      const a = P(vAt(V0, i)),
        b = P(vAt(VY, i));
      if (!a || !b || !(inView(a, 0) || inView(b, 0))) continue;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d > 40) cand.push([d, i]);
    }
    cand.sort((x, y) => y[0] - x[0]);
    for (const [, i] of cand.slice(0, 10)) list.add(i);
    c.strokeStyle = PATHC;
    c.fillStyle = PATHC;
    c.lineWidth = 1.3;
    for (const i of list) {
      const a = P(vAt(V0, i)),
        b = P(vAt(VY, i));
      if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 3) track(c, i);
    }
  }
  /* 星: 視野が狭いほど暗い星まで、大きく描く */
  const f = st.look.fov,
    lim = f > 100 ? 5 : f > 50 ? 5.8 : f > 22 ? 6.6 : f > 10 ? 7.3 : 8,
    k = Math.max(0.95, Math.min(2.1, 2.1 - Math.log2(f / 12) * 0.28));
  DRAWN = [];
  CONHIT = [];
  for (let i = S.n - 1; i >= 0; i--) {
    const m = MY[i] as number;
    if (m > lim) continue;
    const p = P(vAt(VY, i));
    if (!inView(p, 4)) continue;
    const r = starR(m, k);
    c.fillStyle = starCol(S.bv[i] as number, Math.min(1, 0.45 + (lim - m) * 0.35));
    c.beginPath();
    c.arc(p[0], p[1], r, 0, 2 * Math.PI);
    c.fill();
    DRAWN.push([p[0], p[1], i, r]);
  }
  /* 名前: 重なるものは出さない */
  const boxes: number[][] = [];
  const put = (x: number, y: number, t: string, font: string, col: string, center = false): number[] | null => {
    c.font = font;
    const w = c.measureText(t).width,
      bx = center ? [x - w / 2, y - 9, x + w / 2, y + 9] : [x, y - 9, x + w, y + 9];
    if ((bx[0] as number) < 2 || (bx[2] as number) > W - 2) return null;
    if (
      boxes.some(
        (b) =>
          (bx[0] as number) < (b[2] as number) &&
          (b[0] as number) < (bx[2] as number) &&
          (bx[1] as number) < (b[3] as number) &&
          (b[1] as number) < (bx[3] as number),
      )
    )
      return null;
    boxes.push(bx);
    c.fillStyle = col;
    c.textAlign = center ? 'center' : 'left';
    c.textBaseline = 'middle';
    c.fillText(t, x, y);
    return bx;
  };
  const nlim = f > 100 ? 1 : f > 50 ? 2 : 3.6,
    named = [...(g ? g.mem : []), ...Object.keys(SKY.names).map(Number)];
  for (const i of new Set(named)) {
    const own = g?.mem.includes(i) && (SKY.names[i] || (S.mag[i] as number) < 2.5);
    if (!own && (S.mag[i] as number) > nlim) continue;
    const nm = starName(i),
      p = P(vAt(VY, i));
    if (!nm || !inView(p, 0)) continue;
    put(p[0] + starR(MY[i] as number, k) + 4, p[1] - 9, nm, `500 13px ${sans}`, STARN);
  }
  if (st.opt.names) {
    const rk = f > 120 ? 1 : f > 60 ? 2 : 3;
    for (const [code, ja, rank] of SKY.cons) {
      const gg = GROUPS[code];
      if (!gg?.mem.length || (rank > rk && code !== st.sel)) continue;
      const cen = gg.mem.reduce<Vec3>(
          (a, i) => [a[0] + (VY[i * 3] as number), a[1] + (VY[i * 3 + 1] as number), a[2] + (VY[i * 3 + 2] as number)],
          [0, 0, 0],
        ),
        l = Math.hypot(cen[0], cen[1], cen[2]),
        p = P([cen[0] / l, cen[1] / l, cen[2] / l]);
      if (!inView(p, 0)) continue;
      const bx = put(
        p[0],
        p[1] + 16,
        ja,
        `${code === st.sel ? 700 : 500} 13px ${sans}`,
        code === st.sel ? '#e8eefc' : NAMEC,
        true,
      );
      /* 押すとその星座を選ぶ。押せる所は文字の上下左右に 4 px 広げる */
      if (bx)
        CONHIT.push([(bx[0] as number) - 4, (bx[1] as number) - 4, (bx[2] as number) + 4, (bx[3] as number) + 4, code]);
    }
  }
  if (st.opt.pole) {
    const p = P(poleAt(st.year));
    if (inView(p, 0)) {
      c.strokeStyle = PATHC;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(p[0], p[1], 7, 0, 2 * Math.PI);
      c.moveTo(p[0] - 11, p[1]);
      c.lineTo(p[0] + 11, p[1]);
      c.moveTo(p[0], p[1] - 11);
      c.lineTo(p[0], p[1] + 11);
      c.stroke();
      put(p[0] + 13, p[1] + 14, '天の北極', `600 13px ${sans}`, PATHC);
    }
  }
  /* 選んだ星 */
  const s = st.pin >= 0 ? st.pin : st.hover;
  if (s >= 0) {
    const p = P(vAt(VY, s)),
      vis = inView(p, 0);
    if (vis) {
      c.strokeStyle = '#fff';
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(p[0], p[1], starR(MY[s] as number, k) + 5, 0, 2 * Math.PI);
      c.stroke();
    }
    if (vis || s === st.pin) showTip(s, p);
    else tip.hidden = true;
  } else tip.hidden = true;
}

/* 星の札: ホバーは星のそば、押した星は図の左上（狭い幅では切り替えの下） */
function showTip(i: number, p: [number, number] | null): void {
  if (!S) return;
  const nm = starName(i) || '星',
    dist = S.known[i]
      ? `<span>距離 <i>${fmtLy(Math.hypot(...posAt(S, i, st.year)))} 光年</i></span>`
      : '<span>距離 <i>—</i></span>',
    mv =
      Math.round(st.year) !== NOW ? `<span>今の位置から <i>${fmtDeg(angDeg(vAt(V0, i), vAt(VY, i)))}</i></span>` : '';
  const html = `<b>${esc(nm)}</b>${dist}<span>明るさ <i>${(MY[i] as number).toFixed(1)} 等</i></span>${mv}`;
  if (tipIn.innerHTML !== html) tipIn.innerHTML = html;
  const pinned = i === st.pin;
  tip.classList.toggle('pin', pinned);
  trk.hidden = !pinned;
  trk.setAttribute('aria-pressed', String(st.track === i));
  setT(trk.lastElementChild as HTMLElement, st.track === i ? '追尾中' : '追尾');
  tip.hidden = false;
  if (pinned) {
    const hud = $(NARROW.matches ? '#pm-tr' : '.pm-tl');
    tip.style.left = '8px';
    tip.style.top = `${hud.offsetTop + hud.offsetHeight + 8}px`;
    return;
  }
  if (!p) return;
  const tw = tip.offsetWidth,
    th = tip.offsetHeight;
  let x = p[0] + 14,
    y = p[1] + 14;
  if (x + tw > W - 6) x = p[0] - 14 - tw;
  if (y + th > H - 6) y = p[1] - 14 - th;
  tip.style.left = `${Math.max(6, x)}px`;
  tip.style.top = `${Math.max(6, y)}px`;
}

function syncTexts(): void {
  setT($('#pm-fov'), `${Math.round(st.look.fov)}°`);
  setT($('#pm-yv'), fmtRel(st.year));
  setT($('#pm-ya'), fmtYear(st.year));
  if (document.activeElement !== yearIn) yearIn.value = String(Math.round(st.year - NOW));
}

/* ---------- 見る向き ---------- */
let fly: { t0: number; a: Look; b: Look } | null = null;
function flyTo(b: Look): void {
  const d = ((((b.ra - st.look.ra) % 360) + 540) % 360) - 180;
  fly = { t0: performance.now(), a: { ...st.look }, b: { ...b, ra: st.look.ra + d } };
  dirty = true;
}
function groupLook(key: string): Look | null {
  const g = GROUPS[key];
  if (!g?.mem.length) return null;
  const vs = g.mem.map((i) => vAt(VY, i)),
    s = vs.reduce<Vec3>((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]),
    l = Math.hypot(s[0], s[1], s[2]),
    c: Vec3 = [s[0] / l, s[1] / l, s[2] / l],
    r = Math.max(...vs.map((v) => angDeg(c, v))),
    [ra, dec] = raDecOf(c);
  return { ra, dec, fov: Math.max(14, Math.min(150, r * 2.6 * Math.max(1, W / Math.max(1, H)))) };
}
const starLook = (i: number): Look => {
  const [ra, dec] = raDecOf(vAt(VY, i));
  return { ra, dec, fov: Math.min(st.look.fov, 60) };
};
let saveTimer = 0;
function saveLook(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(
    () =>
      store(
        'pm:v',
        [st.look.ra, st.look.dec, st.look.fov].map((x) => Math.round(x * 100) / 100),
      ),
    400,
  );
}
function setLook(l: Look): void {
  st.look = l;
  dirty = true;
  saveLook();
}
function zoomAt(f: number, x: number, y: number): void {
  fly = null;
  if (st.track >= 0) {
    x = W / 2;
    y = H / 2;
  }
  setLook(zoomed(st.look, f, x, y, W, H));
}

/* ---------- 操作 ---------- */
function setRun(v: boolean): void {
  st.run = v;
  runBtn.setAttribute('aria-pressed', String(v));
  setT(runBtn.lastElementChild as HTMLElement, v ? '再生中' : '停止中');
  dirty = true;
}
function unpin(): void {
  st.pin = -1;
  st.track = -1;
  dirty = true;
}
runBtn.addEventListener('click', () => setRun(!st.run));
yearIn.addEventListener('input', () => {
  st.year = NOW + Number(yearIn.value);
  setRun(false);
});
for (const b of $$('[data-jump]'))
  b.addEventListener('click', () => {
    st.year = NOW + Number(b.dataset.jump);
    setRun(false);
  });
spdSel.addEventListener('change', () => {
  st.spd = Number(spdSel.value);
  store('pm:spd', st.spd);
});
for (const b of $$('[data-opt]')) {
  const k = b.dataset.opt as Opt;
  b.addEventListener('click', () => {
    st.opt[k] = !st.opt[k];
    b.setAttribute('aria-pressed', String(st.opt[k]));
    store('pm:o', st.opt);
    dirty = true;
  });
}
for (const b of $$('[data-z]')) b.addEventListener('click', () => zoomAt(Number(b.dataset.z), W / 2, H / 2));
$('#pm-home').addEventListener('click', () => flyTo({ ...st.look, fov: FOV_HOME }));
/** 星座を選び、その星座へ移る（セレクトボックスと、図の中の星座名から） */
function selectGroup(code: string): void {
  st.sel = code;
  sel.value = code;
  store('pm:sel', st.sel);
  unpin();
  st.hover = -1;
  const l = groupLook(st.sel);
  if (l) flyTo(l);
}
sel.addEventListener('change', () => selectGroup(sel.value));
trk.addEventListener('click', () => {
  if (st.pin < 0) return;
  if (st.track === st.pin) st.track = -1;
  else {
    st.track = st.pin;
    flyTo(starLook(st.track));
  }
  dirty = true;
});
cv.addEventListener('keydown', (e) => {
  const step = 40;
  const k: Record<string, [number, number]> = {
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  };
  const m = k[e.key];
  if (m) {
    e.preventDefault();
    st.track = -1;
    setLook(panned(st.look, m[0], m[1], PJ.S));
  } else if (e.key === '+' || e.key === '=') zoomAt(0.8, W / 2, H / 2);
  else if (e.key === '-') zoomAt(1.25, W / 2, H / 2);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && st.pin >= 0) unpin();
});

/* 指とマウス: ドラッグで移動、2 本指で拡大・縮小、押した星の札 */
const ptrs = new Map<number, [number, number]>();
let drag: { x: number; y: number; moved: number; pinch?: number } | null = null;
const local = (e: PointerEvent | MouseEvent): [number, number] => {
  const r = cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
const conHit = (x: number, y: number): string | null =>
  CONHIT.find((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])?.[4] ?? null;
function hit(x: number, y: number): number {
  let best = -1,
    bd = 14;
  for (const [px, py, i, r] of DRAWN) {
    const d = Math.hypot(px - x, py - y) - r;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
cv.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    zoomAt(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), x, y);
  },
  { passive: false },
);
cv.addEventListener('dblclick', (e) => {
  const [x, y] = local(e);
  zoomAt(e.shiftKey ? 2 : 0.5, x, y);
});
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, local(e));
  fly = null;
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
  else {
    const [a, b] = [...ptrs.values()] as [[number, number], [number, number]];
    drag = { x: 0, y: 0, moved: 99, pinch: Math.hypot(a[0] - b[0], a[1] - b[1]) };
  }
});
cv.addEventListener('pointermove', (e) => {
  const p = local(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
  if (drag && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()] as [[number, number], [number, number]],
      d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (drag.pinch && d > 0) zoomAt(drag.pinch / d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    drag.pinch = d;
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 3) {
      cv.classList.add('drag');
      st.hover = -1;
      st.track = -1;
      setLook(panned(st.look, dx, dy, PJ.S));
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    return;
  }
  if (e.pointerType === 'mouse') {
    const onName = conHit(p[0], p[1]) !== null,
      h = onName ? -1 : hit(p[0], p[1]);
    if (h !== st.hover) {
      st.hover = h;
      dirty = true;
    }
    cv.classList.toggle('on-star', onName || h >= 0);
  }
});
const up = (e: PointerEvent): void => {
  if (drag && drag.moved <= 3 && ptrs.size === 1) {
    const [x, y] = local(e),
      code = conHit(x, y),
      i = code ? -1 : hit(x, y);
    if (code) selectGroup(code);
    else if (i < 0 || i === st.pin) unpin();
    else {
      if (st.track >= 0) st.track = i;
      st.pin = i;
      dirty = true;
    }
  }
  ptrs.delete(e.pointerId);
  if (!ptrs.size) {
    drag = null;
    cv.classList.remove('drag');
  }
};
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);
cv.addEventListener('pointerleave', () => {
  if (st.hover >= 0) {
    st.hover = -1;
    dirty = true;
  }
});

/* ---------- 毎コマ ---------- */
let last = performance.now();
function frame(t: number): void {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (st.run && S && !document.hidden) {
    st.year += st.spd * dt;
    if (st.year > YMAX) st.year = YMIN;
    dirty = true;
  }
  if (fly) {
    const f = Math.min(1, (t - fly.t0) / 600),
      e = f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);
    st.look = {
      ra: (((fly.a.ra + (fly.b.ra - fly.a.ra) * e) % 360) + 360) % 360,
      dec: fly.a.dec + (fly.b.dec - fly.a.dec) * e,
      fov: fly.a.fov * (fly.b.fov / fly.a.fov) ** e,
    };
    if (f >= 1) {
      fly = null;
      saveLook();
    }
    dirty = true;
  }
  if (st.track >= 0 && S) {
    if (st.year !== shownYear) {
      fillAt(S, st.year, VY, MY);
      shownYear = st.year;
    }
    const [ra, dec] = raDecOf(vAt(VY, st.track));
    if (fly) {
      fly.b.ra = fly.a.ra + (((((ra - fly.a.ra) % 360) + 540) % 360) - 180);
      fly.b.dec = dec;
    } else if (ra !== st.look.ra || dec !== st.look.dec) st.look = { ...st.look, ra, dec };
  }
  if (dirty) {
    dirty = false;
    draw();
    syncTexts();
  }
  requestAnimationFrame(frame);
}
new ResizeObserver(() => {
  mwKey = '';
  dirty = true;
}).observe(cv);

/* ---------- 保存した設定 ---------- */
{
  const o = stored('pm:o') as Partial<Record<Opt, boolean>> | undefined;
  if (o && typeof o === 'object')
    for (const k of Object.keys(st.opt) as Opt[])
      if (typeof o[k] === 'boolean') {
        st.opt[k] = o[k] as boolean;
        $(`#pm-o-${k}`).setAttribute('aria-pressed', String(st.opt[k]));
      }
  const sp = stored('pm:spd');
  if (sp === 100 || sp === 500 || sp === 2000 || sp === 5000 || sp === 20000) {
    st.spd = sp;
    spdSel.value = String(sp);
  }
}
setRun(st.run);
sans = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || sans;

/* ---------- 読み込み ---------- */
const busy = $('#pm-busy');
Promise.all([
  fetch(`${BASE}proper-motion/stars.bin`).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.arrayBuffer();
  }),
  fetch(`${BASE}proper-motion/sky.json`).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<SkyJson>;
  }),
])
  .then(([bin, sky]) => {
    S = decode(bin);
    SKY = sky;
    V0 = new Float64Array(S.n * 3);
    VY = new Float64Array(S.n * 3);
    MY = new Float32Array(S.n);
    const m0 = new Float32Array(S.n);
    fillAt(S, NOW, V0, m0);
    buildMw(sky);
    const mk = (n: string, lines: number[][]): Group => ({ n, lines, mem: [...new Set(lines.flat())] });
    GROUPS = Object.fromEntries([
      ...ASTER.map(([k, n]) => [k, mk(n, sky.aster[k] ?? [])] as const),
      ...sky.cons.map(([k, n]) => [k, mk(n, sky.lines[k] ?? [])] as const),
    ]);
    const cons = [...sky.cons].sort((a, b) => a[1].localeCompare(b[1], 'ja'));
    sel.innerHTML = `<optgroup label="星の並び">${ASTER.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</optgroup><optgroup label="星座">${cons.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</optgroup>`;
    const s = stored('pm:sel');
    if (typeof s === 'string' && GROUPS[s]) st.sel = s;
    sel.value = st.sel;
    fillAt(S, st.year, VY, MY);
    shownYear = st.year;
    fitCanvas();
    const v = stored('pm:v');
    if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)))
      st.look = { ra: v[0], dec: Math.max(-89.5, Math.min(89.5, v[1])), fov: Math.max(4, Math.min(200, v[2])) };
    else st.look = groupLook(st.sel) ?? st.look;
    dirty = true;
  })
  .catch(() => {
    const m = $('#pm-msg');
    m.hidden = false;
    m.textContent = '星の表を読み込めませんでした';
  })
  .finally(() => {
    busy.hidden = true;
  });

initFullscreen({
  root: stage,
  btn: $<HTMLButtonElement>('#pm-fs'),
  focus: cv,
  esc: () => st.pin < 0,
  change: () => {
    mwKey = '';
    dirty = true;
  },
});
requestAnimationFrame(frame);

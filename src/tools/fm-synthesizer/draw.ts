/**
 * パートの一覧とサイドバーの小さな図: アルゴリズムの結線図（SVG）、鍵盤・パッド・エンベロープ（キャンバス）。
 * 色は呼ぶ側が CSS の変数から読んで渡す
 */
import { ALGS, envAt, keyScale, type Op, type Tone } from './engine';
import { PADS } from './gm';
import { PAD_ICONS } from './icons';

/* ---------- アルゴリズムの結線図（2026-11-19 の案 D: 働きが見える図） ---------- */
/**
 * 段を列にして左から右へ並べる。キャリアは右端の列で、出力の縦の線にまとめて右へ出す。変調の線と帰還には矢じり。
 * 箱の中を下から塗る量がそのときのエンベロープ、変調の線の太さが変調指数 × エンベロープ（liveAlg で書き換える）
 */
interface AlgLayout {
  /** オペレータの箱の左上 */
  x: number[];
  y: number[];
  box: number;
}
function algLayout(alg: number, W: number, H: number, box: number): AlgLayout {
  const A = ALGS[alg],
    d = [0, 0, 0, 0];
  /* 段: キャリアは 0、モジュレータはつなぐ先の段 + 1 */
  for (let pass = 0; pass < 4; pass++)
    for (let k = 3; k >= 0; k--) {
      if (A.c.includes(k)) continue;
      d[k] = Math.max(1, ...A.e.filter(([s]) => s === k).map(([, t]) => d[t] + 1));
    }
  const depth = Math.max(...d),
    pos = [0, 0, 0, 0];
  const rows: number[][] = Array.from({ length: depth + 1 }, () => []);
  for (let k = 0; k < 4; k++) rows[d[k]].push(k);
  rows[0].forEach((k, i) => {
    pos[k] = (i + 0.5) / rows[0].length;
  });
  /* モジュレータは、つなぐ先の高さの平均に寄せ、重なったらずらす */
  for (let r = 1; r <= depth; r++) {
    rows[r].forEach((k, i) => {
      const t = A.e.filter(([s]) => s === k).map(([, x]) => pos[x]);
      pos[k] = t.length ? t.reduce((a, b) => a + b, 0) / t.length : (i + 0.5) / rows[r].length;
    });
    const ks = [...rows[r]].sort((a, b) => pos[a] - pos[b]);
    for (let i = 1; i < ks.length; i++) if (pos[ks[i]] - pos[ks[i - 1]] < 0.3) pos[ks[i]] = pos[ks[i - 1]] + 0.3;
  }
  const flat = depth === 0,
    x = [0, 1, 2, 3].map((k) => (flat ? 6 + k * ((W - box - 26) / 3) : 6 + (depth - d[k]) * ((W - box - 26) / depth))),
    y = [0, 1, 2, 3].map((k) => (flat ? (H - box) / 2 : 4 + pos[k] * (H - 8) - box / 2));
  return { x, y, box };
}
const f1 = (v: number) => v.toFixed(1);
function arrow(x2: number, y2: number, x1: number, y1: number, s: number): string {
  const a = Math.atan2(y2 - y1, x2 - x1),
    p = (t: number) => `${f1(x2 - s * Math.cos(a + t))},${f1(y2 - s * Math.sin(a + t))}`;
  return `<path d="M${f1(x2)},${f1(y2)}L${p(0.45)}L${p(-0.45)}Z" fill="var(--ink-3)"/>`;
}

/**
 * 結線図の SVG の中身（幅 W・高さ H）。big なら箱を大きくして番号を書く。キャリアの枠と中の塗りは色 col。
 * 塗り（class="af"、data-k）と変調の線（class="ae"、data-s）は liveAlg で書き換える
 */
export function algSvg(alg: number, col: string, W: number, H: number, big = false): string {
  const box = big ? 16 : 9,
    { x, y } = algLayout(alg, W, H, box),
    hs = big ? 4.5 : 3,
    w = big ? 1.3 : 1,
    car = ALGS[alg].c,
    bus = W - 8;
  let s = '';
  for (const [j, k] of ALGS[alg].e) {
    const x1 = x[j] + box,
      y1 = y[j] + box / 2,
      x2 = x[k] - 0.5,
      y2 = y[k] + box / 2;
    s += `<line class="ae" data-s="${j}" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="var(--ink-3)" stroke-width="${w}"/>${arrow(x2, y2, x1, y1, hs)}`;
  }
  const cy = car.map((k) => y[k] + box / 2),
    top = Math.min(...cy),
    bot = Math.max(...cy),
    mid = (top + bot) / 2,
    line = (x1: number, y1: number, x2: number, y2: number) =>
      `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="var(--ink-3)" stroke-width="${w}"/>`;
  for (const k of car) s += line(x[k] + box, y[k] + box / 2, bus, y[k] + box / 2);
  if (bot > top) s += line(bus, top, bus, bot);
  s += line(bus, mid, W - 1, mid) + arrow(W - 0.5, mid, bus, mid, hs);
  for (let k = 0; k < 4; k++) {
    const c = car.includes(k);
    s += `<rect x="${f1(x[k])}" y="${f1(y[k])}" width="${box}" height="${box}" rx="2" fill="var(--surface)" stroke="${c ? col : 'var(--ink-2)'}" stroke-width="${w}"/>`;
    /* 塗りの下の端（data-b）は箱の内側の下の端で、書き換えても動かさない */
    s += `<rect class="af" data-k="${k}" data-b="${f1(y[k] + box - 1)}" x="${f1(x[k] + 1)}" y="${f1(y[k] + box - 1)}" width="${box - 2}" height="0" fill="${c ? col : 'var(--ink-3)'}"/>`;
    if (big)
      s += `<text x="${f1(x[k] + box / 2)}" y="${f1(y[k] + box / 2 + 1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" font-family="var(--mono)" fill="var(--ink)" stroke="var(--surface)" stroke-width="2.5" paint-order="stroke">${k + 1}</text>`;
  }
  /* OP1 の帰還: 箱の上の弧と矢じり */
  const fx = x[0],
    fy = y[0],
    r = big ? 5 : 3;
  s += `<path d="M${f1(fx + box * 0.75)},${f1(fy)}C${f1(fx + box * 0.75)},${f1(fy - r * 1.6)} ${f1(fx + box * 0.25)},${f1(fy - r * 1.6)} ${f1(fx + box * 0.25)},${f1(fy - 0.5)}" fill="none" stroke="var(--ink-3)" stroke-width="${w}"/>${arrow(fx + box * 0.25, fy - 0.5, fx + box * 0.22, fy - r, hs * 0.8)}`;
  return s;
}

/** 動かす部品（塗りと変調の線）。図を描き直したら取り直す */
export interface AlgLive {
  fills: SVGRectElement[];
  edges: { el: SVGLineElement; src: number }[];
  box: number;
  big: boolean;
  last: string;
}
export function bindAlg(svg: SVGSVGElement, big: boolean): AlgLive {
  const fills: SVGRectElement[] = [];
  for (const el of svg.querySelectorAll<SVGRectElement>('rect.af')) fills[Number(el.dataset.k)] = el;
  return {
    fills,
    edges: [...svg.querySelectorAll<SVGLineElement>('line.ae')].map((el) => ({ el, src: Number(el.dataset.s) })),
    box: big ? 16 : 9,
    big,
    last: '',
  };
}
/**
 * 働きを書き換える。lv はオペレータごとのエンベロープの大きさ（0〜1）、mod はモジュレータの変調指数の目安（0〜1）。
 * 前と同じ値なら書き換えない
 */
export function liveAlg(l: AlgLive, lv: readonly number[], mod: readonly number[]): void {
  const q = lv.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 20)),
    m = mod.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 10)),
    key = `${q.join()}|${m.join()}`;
  if (key === l.last) return;
  l.last = key;
  const inner = l.box - 2;
  for (let k = 0; k < 4; k++) {
    const el = l.fills[k];
    if (!el) continue;
    /* 下の端は描いたときの値から求める（前の値から求めると、丸めの誤差が積もってずれていく） */
    const h = (inner * q[k]) / 20,
      bottom = Number(el.dataset.b);
    el.setAttribute('y', f1(bottom - h));
    el.setAttribute('height', f1(h));
  }
  const base = l.big ? 1.3 : 1,
    span = l.big ? 3.2 : 1.8;
  for (const e of l.edges) e.el.setAttribute('stroke-width', f1(base + (span * m[e.src] * q[e.src]) / 200));
}

/* ---------- エンベロープ ---------- */
/** 形を描くときに、サステインを保つ長さ（平方根の時間の単位） */
const HOLD_W = 0.55;
/** 時間を平方根で縮めた横軸での、エンベロープの角の点（0〜1 の座標） */
export function envShape(op: Op): { pts: [number, number][]; at: (t: number, hold: number) => number } {
  const k = Math.sqrt,
    a = k(op.ar),
    d = k(op.dr),
    r = k(op.rr),
    tot = a + d + HOLD_W + r;
  const pts: [number, number][] = [
    [0, 0],
    [a / tot, 1],
  ];
  /* ディケイは曲線なので点を増やす */
  for (let i = 1; i <= 12; i++) {
    const u = (i / 12) ** 2;
    pts.push([(a + d * Math.sqrt(u)) / tot, envAt(op, op.ar + op.dr * u)]);
  }
  pts.push([(a + d + HOLD_W) / tot, op.sl + (1 - op.sl) * 1e-3]);
  for (let i = 1; i <= 8; i++) {
    const u = (i / 8) ** 2;
    pts.push([(a + d + HOLD_W + r * Math.sqrt(u)) / tot, (op.sl + (1 - op.sl) * 1e-3) * 1e-3 ** u]);
  }
  /** 鳴り始めから t [s]、離した時刻 hold での横の位置（0〜1） */
  const at = (t: number, hold: number): number => {
    if (t < hold) {
      if (t < op.ar) return k(t) / tot;
      return (a + Math.min(d, k(t - op.ar)) + Math.min(HOLD_W, Math.max(0, k(t - op.ar) - d))) / tot;
    }
    const h = t < op.ar ? k(hold) : a + Math.min(d, k(hold - op.ar));
    return Math.min(1, (Math.max(h, a + d + HOLD_W * 0.5) + k(t - hold)) / tot);
  };
  return { pts, at };
}

/**
 * エンベロープを描く。線の形は音色だけで決まり、鳴らしていないときも鳴っているときも同じ。
 * t（鳴り始めからの時間）を渡すと今の位置に点を打つ。hold は離した時刻（押している間は Infinity）。
 * others はほかのオペレータで、同じ時間の目盛りで薄く描く（色 faint）
 */
export function drawEnv(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  op: Op,
  col: string,
  lw: number,
  t: number | null = null,
  hold = Number.POSITIVE_INFINITY,
  note = 60,
  others: readonly Op[] = [],
  faint = '',
): void {
  const pad = 4,
    X = (u: number) => pad + u * (w - 2 * pad),
    Y = (v: number) => pad + (h - 2 * pad) * (1 - v),
    line = (pts: [number, number][], c: string, width: number) => {
      g.strokeStyle = c;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.beginPath();
      for (const [i, [u, v]] of pts.entries()) {
        if (i) g.lineTo(X(u), Y(v));
        else g.moveTo(X(u), Y(v));
      }
      g.stroke();
    };
  /*
   * 横軸は鳴り始めからの時間の平方根。リリースを描き始める位置 h0 は音色だけで決め（アタックとディケイの後）、
   * 線は押したり離したりしても動かさない。点はこの線の上を進む: 押している間は h0 まで進んで止まり、
   * 離したら h0 からリリースを進む（ディケイの途中で離したときも、線の上に乗せる。実際の大きさは音量のメーターに出る）
   */
  const all = [op, ...others],
    rel = Math.max(...all.map((o) => o.rr * keyScale(o, note))),
    h0 = Math.max(...all.map((o) => o.ar + o.dr * keyScale(o, note))) + 0.15,
    T = h0 + rel,
    N = 48,
    u = (tau: number) => Math.sqrt(Math.min(T, Math.max(0, tau)) / T),
    released = t !== null && Number.isFinite(hold) && t >= hold,
    rrOf = (o: Op) => Math.max(1e-4, o.rr * keyScale(o, note)),
    path = (o: Op): [number, number][] => {
      const pts: [number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const tau = h0 * (i / N) ** 2;
        pts.push([u(tau), envAt(o, tau, Number.POSITIVE_INFINITY, note)]);
      }
      /* リリース: h0 の大きさから 60 dB 下がる */
      const top = envAt(o, h0, Number.POSITIVE_INFINITY, note),
        rr = rrOf(o);
      for (let i = 0; i <= N; i++) {
        const tau = h0 + (T - h0) * (i / N) ** 2;
        pts.push([u(tau), top * 1e-3 ** ((tau - h0) / rr)]);
      }
      return pts;
    };
  for (const o of others) line(path(o), faint, 1);
  line(path(op), col, lw);
  if (t === null) return;
  /* 点は線の上: 押している間は h0 まで、離したら h0 からリリースを進む */
  const tr = released ? Math.min(T - h0, t - hold) : 0,
    x = released ? u(h0 + tr) : u(Math.min(t, h0)),
    y = released
      ? envAt(op, h0, Number.POSITIVE_INFINITY, note) * 1e-3 ** (tr / rrOf(op))
      : envAt(op, Math.min(t, h0), Number.POSITIVE_INFINITY, note);
  g.fillStyle = col;
  g.beginPath();
  g.arc(X(x), Y(y), 3.5, 0, 2 * Math.PI);
  g.fill();
}

/** 音量の目安に使うキャリア（出力レベルが最も大きいもの） */
export function mainCarrier(t: Tone): number {
  let best = ALGS[t.alg].c[0];
  for (const c of ALGS[t.alg].c) if (t.ops[c].l > t.ops[best].l) best = c;
  return best;
}

/** 小さな ADSR の SVG（閉じたオペレータのグループの要約） */
export function envMini(op: Op, col: string): string {
  const s = envShape(op),
    d = s.pts.map(([u, v], i) => `${i ? 'L' : 'M'}${(2 + u * 26).toFixed(1)} ${(16 - v * 14).toFixed(1)}`).join('');
  return `<svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true"><rect x=".5" y=".5" width="29" height="17" rx="2" fill="var(--screen)" stroke="var(--line)"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.4"/></svg>`;
}

/* ---------- 鍵盤とパッド ---------- */
/** 一覧の鍵盤の範囲（C2〜C7） */
export const K_LO = 36,
  K_HI = 96;
const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);
const WHITES: number[] = [];
for (let n = K_LO; n <= K_HI; n++) if (!isBlack(n)) WHITES.push(n);

export interface KeyColors {
  white: string;
  black: string;
  /** 押している鍵 */
  down: string;
  /** 離したがダンパーペダルで延ばしている鍵 */
  sus: string;
}

/** 鍵盤を描く。down は押している音、sus は延ばしている音（範囲の外の音は端の鍵に印を付ける） */
export function drawKeys(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  down: Iterable<number>,
  sus: Iterable<number>,
  c: KeyColors,
): void {
  const col = new Map<number, string>(),
    kw = w / WHITES.length;
  let lo = '',
    hi = '';
  const put = (n: number, k: string) => {
    if (n < K_LO) lo ||= k;
    else if (n > K_HI) hi ||= k;
    else col.set(n, k);
  };
  for (const n of sus) put(n, c.sus);
  for (const n of down) put(n, c.down);
  for (const [i, n] of WHITES.entries()) {
    g.fillStyle = col.get(n) ?? c.white;
    g.fillRect(i * kw, 0, kw - 0.6, h);
  }
  for (let n = K_LO; n <= K_HI; n++)
    if (isBlack(n)) {
      const i = WHITES.indexOf(n - 1);
      g.fillStyle = col.get(n) ?? c.black;
      g.fillRect((i + 1) * kw - kw * 0.32, 0, kw * 0.64, h * 0.6);
    }
  /* 範囲の外の音は、鍵盤の左端か右端を高さいっぱいに光らせる */
  const edge = 1.5;
  if (lo) {
    g.fillStyle = lo;
    g.fillRect(0, 0, edge, h);
  }
  if (hi) {
    g.fillStyle = hi;
    g.fillRect(w - edge, 0, edge, h);
  }
}

/** 鍵盤の x 座標のノート番号 */
export function keyAt(x: number, y: number, w: number, h: number): number {
  const kw = w / WHITES.length,
    i = Math.max(0, Math.min(WHITES.length - 1, Math.floor(x / kw))),
    n = WHITES[i];
  if (y < h * 0.6) {
    const r = x - i * kw;
    if (r > kw * 0.68 && isBlack(n + 1) && n + 1 <= K_HI) return n + 1;
    if (r < kw * 0.32 && isBlack(n - 1) && n - 1 >= K_LO) return n - 1;
  }
  return n;
}

export interface PadColors {
  face: string;
  edge: string;
  ink: string;
  on: string;
  onInk: string;
}

/** パッドの 8 つを横 1 列に並べたときの置き場所 */
function padRect(i: number, w: number, h: number): [number, number, number, number] {
  const cw = (w - 14) / 8;
  return [i * (cw + 2), 0, cw, h];
}
const ICONS = PAD_ICONS.map((d) => (typeof Path2D === 'undefined' ? null : new Path2D(d)));

/** パッド 8 つを描く（アイコン）。lit はパッドごとに塗るか */
export function drawPads(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  lit: readonly boolean[],
  c: PadColors,
): void {
  for (let i = 0; i < PADS.length; i++) {
    const [x, y, cw, ch] = padRect(i, w, h),
      icon = ICONS[i];
    g.fillStyle = lit[i] ? c.on : c.face;
    g.fillRect(x, y, cw, ch);
    g.strokeStyle = c.edge;
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    if (!icon) continue;
    /* 幅 24・高さ 16 のアイコンを枠に収める */
    const k = Math.min((cw - 4) / 24, (ch - 4) / 16);
    g.save();
    g.translate(x + (cw - 24 * k) / 2, y + (ch - 16 * k) / 2);
    g.scale(k, k);
    g.strokeStyle = lit[i] ? c.onInk : c.ink;
    g.lineWidth = 1.5 / k;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke(icon);
    g.restore();
  }
}

/** パッドの置き場所の番号（外れなら -1） */
export function padAt(x: number, _y: number, w: number, h: number): number {
  for (let i = 0; i < PADS.length; i++) {
    const [px, , cw] = padRect(i, w, h);
    if (x >= px && x < px + cw + 2) return i;
  }
  return -1;
}

/** キャンバスを表示の大きさに合わせ、描画の文脈を返す（幅・高さは CSS の px） */
export function fitCanvas(c: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const d = devicePixelRatio || 1,
    w = c.clientWidth,
    h = c.clientHeight,
    W = Math.round(w * d),
    H = Math.round(h * d);
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return [g, w, h];
}

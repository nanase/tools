/**
 * コード進行のページの和音の地図（トネッツ）: 三角形 1 つが 1 つの三和音で、辺を共有する隣どうしは 2 音を共有する。
 * 調の中の和音を機能の色で塗り、曲の和音の並び（コード進行）を番号の点と矢印で引く。
 * 番号の点は三角形の頂点の側に小さく置いて和音の名前を隠さず、名前は矢印の上に描く。
 * 選んだ和音（なければ最後の和音）から行きやすい和音を、隣（縁の細い光）と進み方の強さ（太い光）で示す。
 * 演奏中は鳴っている和音と次の和音の点とその間の矢印だけを描き、2 つの三角形を縁取る。曲で使わない三角形は遠いほど薄くする。
 * 点のドラッグ中は、動かす和音とその前後の和音だけを描く
 */
import {
  ALL_PLACES,
  adjacent,
  centroidOf,
  cornersOf,
  degreeChord,
  type Entry,
  keyAt,
  LAT,
  type Place,
  type Song,
  samePlace,
  triadOf,
} from './song';
import { chordName, func, inKey, type Key, keyTonic, roman, trans } from './theory';

export interface MapState {
  song: Song;
  entries: Entry[];
  sel: number | null;
  /** 鳴っている和音（なければ −1） */
  play: number;
  /** 演奏中に次に鳴る和音（なければ −1） */
  next: number;
  /** ドラッグ中の道の点と、その下の三角形 */
  drag: { k: number; at: Place | null } | null;
  /** 鳴っている和音が鳴り始めてからの秒（波紋に使う） */
  age: number;
  hover: Place | null;
}
const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** 色（#rgb・#rrggbb）に透明度を付ける。読めなければそのまま */
export function alpha(c: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return `rgba(${Number.parseInt(h.slice(0, 2), 16)}, ${Number.parseInt(h.slice(2, 4), 16)}, ${Number.parseInt(h.slice(4, 6), 16)}, ${a})`;
}
/** 色 a の上に色 b を透明度 t で重ねた色。どちらかが読めなければ a */
export function over(a: string, b: string, t: number): string {
  const rgb = (c: string): number[] | null => {
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
      if (!m) return null;
      const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
      return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    },
    x = rgb(a),
    y = rgb(b);
  if (!x || !y) return a;
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i] - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
/** 候補を光らせる範囲（格子の単位） */
const NEAR = 2.3;
/** 三角形の 1 辺の最小 [px] */
const MIN_S = 50;
/** 波紋が消えるまで [s] */
const RIPPLE = 0.8;
/** 演奏中に三角形を薄くする度合い: 使う和音から格子 1 つ離れるごとに FADE_K ずつ、FADE_MIN まで */
const FADE_K = 0.3,
  FADE_MIN = 0.25;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');
interface Colors {
  lv: string;
  sel: string;
  ink: string;
  surf: string;
  mono: string;
  sans: string;
}

export class MapView {
  private W = 600;
  private H = 360;
  private s = 50;
  private ox = 0;
  private oy = 0;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  }
  /** 大きさを決める（枠の幅に合わせる） */
  layout(): void {
    const xs: number[] = [],
      ys: number[] = [];
    for (const p of ALL_PLACES)
      for (const c of cornersOf(p)) {
        xs.push(c[0]);
        ys.push(c[1]);
      }
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    /* 狭い画面では三角形が押せる大きさ（1 辺 MIN_S）まで広げ、枠の中で横にスクロールする */
    const cw = this.cv.parentElement?.clientWidth || 600,
      wide = (x1 - x0) * MIN_S + 16 > cw,
      W = wide ? Math.round((x1 - x0) * MIN_S + 16) : cw,
      H = wide ? Math.round((y1 - y0) * MIN_S + 16) : Math.round(Math.max(280, Math.min(480, W * 0.5))),
      dpr = Math.min(2, devicePixelRatio || 1);
    this.W = W;
    this.H = H;
    this.cv.width = Math.round(W * dpr);
    this.cv.height = Math.round(H * dpr);
    this.cv.style.width = wide ? `${W}px` : '';
    this.cv.style.height = `${H}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.s = Math.min((W - 16) / (x1 - x0), (H - 16) / (y1 - y0));
    this.ox = W / 2 - (this.s * (x0 + x1)) / 2;
    this.oy = H / 2 + (this.s * (y0 + y1)) / 2;
  }
  private px(p: [number, number]): [number, number] {
    return [this.ox + p[0] * this.s, this.oy - p[1] * this.s];
  }
  /** 地図の上の三角形（なければ null） */
  hit(x: number, y: number): Place | null {
    for (const p of ALL_PLACES) {
      const [a, b, c] = cornersOf(p).map((q) => this.px(q)),
        sg = (u: number[], v: number[], w: number[]) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]),
        d1 = sg([x, y], a, b),
        d2 = sg([x, y], b, c),
        d3 = sg([x, y], c, a);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return p;
    }
    return null;
  }
  /** 番号の点の半径 */
  private get r0(): number {
    return Math.max(8, Math.min(10, this.s * 0.1));
  }
  /** 三角形の中で番号の点を置く所: 和音の名前を避けて頂点の側（上向きは上、下向きは下） */
  private anchor(p: Place): [number, number] {
    const { s, r0, fs, fr } = this,
      [x, y] = this.px(centroidOf(p));
    /* 上向きは名前（音名）の上端の上、下向きは度数の下端の下に、点の縁を 1 px 離して置く（鳴っている点は 2 px 大きいので、その分も空ける） */
    return p.up
      ? [x, y + s * 0.06 - fr * 0.45 - fs * 0.45 - r0 - 3]
      : [x, y - s * 0.05 + fs * 0.65 + fr * 0.5 + r0 + 3];
  }
  /** 和音の名前（音名）と度数の文字の大きさ */
  private get fs(): number {
    return Math.max(11, Math.min(16, this.s / 4.4));
  }
  private get fr(): number {
    return Math.max(9, Math.min(13, this.s / 6));
  }
  /** k 番目の点の位置。同じ三角形に何度も来たら、2 つずつ横に並べ、頂点の側へ段を重ねる */
  nodePos(st: MapState, k: number): [number, number] {
    if (st.drag?.k === k && st.drag.at) return this.anchor(st.drag.at);
    const at = st.song.chords[k].at,
      same = this.visible(st).filter((j) => samePlace(st.song.chords[j].at, at)),
      n = Math.max(0, same.indexOf(k)),
      [x, y] = this.anchor(at),
      d = this.r0 * 2 + 2,
      row = Math.floor(n / 2),
      pair = same.length - row * 2 > 1;
    return [x + (pair ? ((n % 2) - 0.5) * d : 0), y + (at.up ? -1 : 1) * row * d * 0.92];
  }
  /** 番号の点に当たれば、その番号 */
  nodeAt(st: MapState, x: number, y: number): number {
    const vis = this.visible(st);
    for (let j = vis.length - 1; j >= 0; j--) {
      const [nx, ny] = this.nodePos(st, vis[j]);
      if (Math.hypot(nx - x, ny - y) < this.r0 + 4) return vis[j];
    }
    return -1;
  }
  /** 描く点: 演奏中は鳴っている和音と次の和音だけ、ドラッグ中は動かす和音と前後の和音だけ */
  private visible(st: MapState): number[] {
    if (st.play >= 0) return st.next >= 0 && st.next !== st.play ? [st.play, st.next] : [st.play];
    const n = st.song.chords.length;
    if (st.drag) return [st.drag.k - 1, st.drag.k, st.drag.k + 1].filter((k) => k >= 0 && k < n);
    return st.song.chords.map((_, k) => k);
  }
  /** 調と候補の基準: 演奏中は鳴っている和音、ドラッグ中は動かす和音の前、ほかは選んだ和音（なければ最後） */
  private base(st: MapState): number {
    if (st.play >= 0) return st.play;
    if (st.drag) return Math.max(0, st.drag.k - 1);
    return st.sel ?? st.song.chords.length - 1;
  }
  draw(st: MapState): void {
    const { ctx, W, H, s } = this,
      col = { T: css('--cp-t'), S: css('--cp-s'), D: css('--cp-d') },
      lv = css('--cp-lv'),
      cand = css('--cp-cand'),
      sel = css('--cp-sel'),
      ink = css('--ink'),
      ink3 = css('--ink-3'),
      line = css('--line'),
      surf = css('--surface'),
      bg = css('--cp-map'),
      mono = css('--mono'),
      sans = css('--sans');
    ctx.clearRect(0, 0, W, H);
    const bk = this.base(st),
      key: Key = bk >= 0 ? keyAt(st.song, bk) : st.song.key,
      bc = bk >= 0 ? st.song.chords[bk] : null,
      bch = bc ? degreeChord(bc, key) : null;
    const { fs, fr } = this,
      /* 名前は矢印の上に描くので、三角形を塗ったあとにまとめて描く */
      labels: (() => void)[] = [],
      halo = (t: string, x: number, y: number, under: string) => {
        ctx.strokeStyle = under;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.strokeText(t, x, y);
        ctx.fillText(t, x, y);
      },
      /* 演奏中は、曲で使う和音の三角形から遠いほど薄く描く（消しはしない） */
      used = st.play >= 0 ? st.song.chords.map((c) => centroidOf(c.at)) : [],
      fade = (p: Place): number => {
        if (!used.length) return 1;
        const [x, y] = centroidOf(p),
          d = Math.min(...used.map(([ux, uy]) => Math.hypot(ux - x, uy - y)));
        return Math.max(FADE_MIN, 1 - d * FADE_K);
      };
    for (const p of ALL_PLACES) {
      const t = triadOf(p),
        ch = degreeChord(t, key),
        pts = cornersOf(p).map((q) => this.px(q)),
        [cx, cy] = this.px(centroidOf(p)),
        dia = inKey(ch, key),
        f = func(ch, key),
        a = fade(p);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      ctx.lineTo(...pts[1]);
      ctx.lineTo(...pts[2]);
      ctx.closePath();
      if (dia) {
        ctx.fillStyle = alpha(col[f], 0.22);
        ctx.fill();
      }
      if (st.hover && samePlace(st.hover, p)) {
        ctx.fillStyle = alpha(col[f], 0.4);
        ctx.fill();
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      /* 候補: 隣は細い縁、進み方の強さ 2・3 は太い縁。演奏中は描かない */
      if (bc && bch && st.play < 0 && !samePlace(bc.at, p)) {
        const c0 = centroidOf(bc.at),
          c1 = centroidOf(p),
          near = Math.hypot(c0[0] - c1[0], c0[1] - c1[1]) < NEAR,
          l = trans(bch, key, ch, key).lv,
          nb = adjacent(bc.at, p);
        if (near && (nb || l >= 2)) {
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = cand;
          ctx.lineWidth = l >= 3 ? 7 : l >= 2 ? 4.5 : 2.5;
          ctx.globalAlpha = l >= 2 ? 0.95 : 0.6;
          ctx.stroke();
          ctx.restore();
        }
      }
      /* 名前の縁取りは三角形の塗りと同じ色にして、矢印の上でも読めるようにする */
      let under = dia ? over(bg, col[f], 0.22) : bg;
      if (st.hover && samePlace(st.hover, p)) under = over(under, col[f], 0.4);
      labels.push(() => {
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = dia ? ink : ink3;
        ctx.font = `${t.q === 'M' ? 700 : 500} ${fs}px ${mono}`;
        const dy = p.up ? s * 0.06 : -s * 0.05;
        halo(chordName({ d: ch.d, q: t.q, inv: 0 }, key), cx, cy + dy - (dia ? fr * 0.45 : 0), under);
        if (dia) {
          ctx.font = `700 ${fr}px ${sans}`;
          ctx.fillStyle = col[f];
          halo(roman(ch, key), cx, cy + dy + fs * 0.65, under);
        }
        ctx.globalAlpha = 1;
      });
    }
    /* 演奏中は鳴っている三角形を太く、次の三角形を破線で縁取る。矢印（黄土色）と分けるため文字の色で描き、強すぎないように半透明にする */
    if (st.play >= 0) {
      const ring = (k: number, w: number, dash: number[]) => {
        const pts = cornersOf(st.song.chords[k].at).map((q) => this.px(q));
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(...pts[0]);
        ctx.lineTo(...pts[1]);
        ctx.lineTo(...pts[2]);
        ctx.closePath();
        ctx.clip();
        ctx.setLineDash(dash);
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = w;
        ctx.stroke();
        ctx.restore();
      };
      if (st.next >= 0 && st.next !== st.play) ring(st.next, 4, [6, 5]);
      ring(st.play, 8, []);
    }
    const c: Colors = { lv, sel, ink, surf, mono, sans };
    this.lines(st, c);
    for (const f of labels) f();
    this.nodes(st, c);
  }
  /**
   * 右下の三角形のない所に収まる箱（緊張のレールを重ねる）。幅が minW に足りなければ null。
   * 格子の右の縁は高さ j の所で x = 5 + j / 2（格子の単位）なので、箱の上の辺の高さで縁より右に置く
   */
  freeBox(h: number, minW: number): { x: number; y: number; w: number; h: number } | null {
    const { W, H, s, ox, oy } = this,
      bottom = H - 8,
      top = bottom - h,
      j = (oy - top) / (s * (Math.sqrt(3) / 2)),
      edge = LAT.i1 + 1 + j / 2,
      left = ox + (edge + 0.05) * s,
      w = W - 8 - left;
    return w >= minW ? { x: left, y: top, w, h } : null;
  }
  /** 点から次の点への矢印 */
  private lines(st: MapState, c: Colors): void {
    const { ctx } = this,
      n = st.song.chords.length;
    if (!n) return;
    const vis = this.visible(st),
      focus = st.sel ?? n - 1,
      /* 演奏中は鳴っている和音から次の和音への 1 本だけ。ほかは描く点のうち続く 2 つの間 */
      segs: [number, number][] =
        st.play >= 0
          ? vis.length > 1
            ? [[st.play, st.next]]
            : []
          : vis.slice(1).flatMap((k, j): [number, number][] => (vis[j] === k - 1 ? [[k - 1, k]] : [])),
      pos = (k: number) => this.nodePos(st, k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [k0, k] of segs) {
      const [x0, y0] = pos(k0),
        [x1, y1] = pos(k),
        on = st.play >= 0 || st.drag !== null || k === focus,
        a = Math.atan2(y1 - y0, x1 - x0),
        L = Math.hypot(x1 - x0, y1 - y0),
        h = on ? 13 : 9,
        /* 矢じりの先は次の点の縁の手前 */
        tip = L - this.r0 - 2,
        tx = x0 + Math.cos(a) * tip,
        ty = y0 + Math.sin(a) * tip,
        head = tip > this.r0 + h;
      ctx.globalAlpha = on ? 1 : 0.4;
      ctx.strokeStyle = c.lv;
      ctx.lineWidth = on ? 4 : 2.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(head ? tx - Math.cos(a) * h * 0.7 : x1, head ? ty - Math.sin(a) * h * 0.7 : y1);
      ctx.stroke();
      /* 向きのある線なので矢じり */
      if (head) {
        ctx.fillStyle = c.lv;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(a + 2.65) * h, ty + Math.sin(a + 2.65) * h);
        ctx.lineTo(tx + Math.cos(a - 2.65) * h, ty + Math.sin(a - 2.65) * h);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  /** 番号の点。鳴り始めた和音の点からは波紋 */
  private nodes(st: MapState, c: Colors): void {
    const { ctx } = this,
      r0 = this.r0,
      tags: { x: number; y: number; to: Key }[] = [];
    for (const k of this.visible(st)) {
      const ch = st.song.chords[k],
        [x, y] = this.nodePos(st, k),
        on = k === st.play,
        r = on ? r0 + 2 : r0;
      /* 鳴り始めた和音の点から波紋が広がる */
      if (on && !REDUCE.matches)
        for (const d of [0, 0.22]) {
          const t = st.age - d;
          if (t < 0 || t > RIPPLE) continue;
          const u = t / RIPPLE;
          ctx.globalAlpha = (1 - u) * 0.85;
          ctx.strokeStyle = c.lv;
          ctx.lineWidth = 1 + 3 * (1 - u);
          ctx.beginPath();
          ctx.arc(x, y, r + u * r0 * 3.2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = on ? c.lv : c.surf;
      ctx.fill();
      ctx.lineWidth = k === st.sel ? 3.5 : 2;
      ctx.strokeStyle = k === st.sel ? c.sel : c.lv;
      ctx.stroke();
      ctx.fillStyle = on ? c.surf : c.ink;
      ctx.font = `700 ${Math.round(r0 * 1.15)}px ${c.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(k + 1), x, y + 0.5);
      if (ch.mod) tags.push({ x: x + r, y, to: ch.mod });
    }
    /* 転調する和音には、点の右に新しい調の札を付ける（緊張の図の札と同じ形）。ほかの点に隠れないように最後に描く */
    for (const g of tags) {
      const lb = `転調 ${keyTonic(g.to)}${g.to.m === 'min' ? 'm' : ''}`;
      ctx.font = `700 13px ${c.sans}`;
      const w = ctx.measureText(lb).width + 10,
        h = 20,
        x = Math.min(g.x + 3, this.W - w - 2);
      ctx.fillStyle = c.sel;
      ctx.beginPath();
      ctx.roundRect(x, g.y - h / 2, w, h, 4);
      ctx.fill();
      ctx.fillStyle = c.surf;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(lb, x + 5, g.y + 0.5);
    }
  }
}

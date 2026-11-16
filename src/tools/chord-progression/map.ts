/**
 * コード進行のページの和音の地図（トネッツ）: 三角形 1 つが 1 つの三和音で、辺を共有する隣どうしは 2 音を共有する。
 * 調の中の和音を機能の色で塗り、曲の和音の並びを番号付きの道として引く。
 * 選んだ和音（なければ最後の和音）から行きやすい和音を、隣（縁の細い光）と進み方の強さ（太い光）で示す。
 * 演奏中は道を描かず、鳴っている和音と次の和音とその間の矢印だけを描く
 */
import {
  ALL_PLACES,
  adjacent,
  centroidOf,
  cornersOf,
  degreeChord,
  type Entry,
  keyAt,
  type Place,
  type Song,
  samePlace,
  triadOf,
} from './song';
import { chordName, func, inKey, type Key, keyName, keyTonic, roman, trans } from './theory';

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
  /** 鳴っている和音の中の進み（0〜1） */
  frac: number;
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
/** 候補を光らせる範囲（格子の単位） */
const NEAR = 2.3;
/** 三角形の 1 辺の最小 [px] */
const MIN_S = 50;

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
  /** 道の点の半径 */
  private get r0(): number {
    return Math.max(10, Math.min(13, this.s * 0.17));
  }
  /** 道の k 番目の点の位置（同じ三角形に何度も来たら、重ならないように輪に並べる） */
  nodePos(st: MapState, k: number): [number, number] {
    if (st.drag?.k === k && st.drag.at) return this.px(centroidOf(st.drag.at));
    const at = st.song.chords[k].at,
      same = st.song.chords.filter((c) => samePlace(c.at, at)),
      m = same.length,
      n = same.indexOf(st.song.chords[k]),
      [x, y] = this.px(centroidOf(at));
    if (m < 2) return [x, y];
    const a = -Math.PI / 2 + (2 * Math.PI * n) / m,
      r = Math.min((this.r0 * 1.08) / Math.sin(Math.PI / m), this.s * 0.34);
    return [x + Math.cos(a) * r, y + Math.sin(a) * r];
  }
  /** 道の点（番号）に当たれば、その番号 */
  nodeAt(st: MapState, x: number, y: number): number {
    const vis = this.visible(st);
    for (let j = vis.length - 1; j >= 0; j--) {
      const [nx, ny] = this.nodePos(st, vis[j]);
      if (Math.hypot(nx - x, ny - y) < Math.max(11, this.s * 0.17)) return vis[j];
    }
    return -1;
  }
  /** 描く道の点: 演奏中は鳴っている和音と次の和音だけ */
  private visible(st: MapState): number[] {
    if (st.play < 0) return st.song.chords.map((_, k) => k);
    return st.next >= 0 && st.next !== st.play ? [st.play, st.next] : [st.play];
  }
  /** 選んだ和音（なければ最後）: 調と候補の基準 */
  private base(st: MapState): number {
    if (st.play >= 0) return st.play;
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
      mono = css('--mono'),
      sans = css('--sans');
    ctx.clearRect(0, 0, W, H);
    const bk = this.base(st),
      key: Key = bk >= 0 ? keyAt(st.song, bk) : st.song.key,
      bc = bk >= 0 ? st.song.chords[bk] : null,
      bch = bc ? degreeChord(bc, key) : null;
    const fs = Math.max(11, Math.min(16, s / 4.4)),
      fr = Math.max(9, Math.min(13, s / 6));
    for (const p of ALL_PLACES) {
      const t = triadOf(p),
        ch = degreeChord(t, key),
        pts = cornersOf(p).map((q) => this.px(q)),
        [cx, cy] = this.px(centroidOf(p)),
        dia = inKey(ch, key),
        f = func(ch, key);
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
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dia ? ink : ink3;
      ctx.font = `${t.q === 'M' ? 700 : 500} ${fs}px ${mono}`;
      const dy = p.up ? s * 0.06 : -s * 0.05;
      ctx.fillText(chordName({ d: ch.d, q: t.q, inv: 0 }, key), cx, cy + dy - (dia ? fr * 0.45 : 0));
      if (dia) {
        ctx.font = `700 ${fr}px ${sans}`;
        ctx.fillStyle = col[f];
        ctx.fillText(roman(ch, key), cx, cy + dy + fs * 0.65);
      }
    }
    this.route(st, { lv, sel, ink, surf, mono });
    /* 調の名前は道の邪魔にならない右下へ */
    ctx.font = `700 12px ${sans}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ink3;
    ctx.fillText(keyName(key), W - 10, H - 10);
  }
  private route(st: MapState, c: { lv: string; sel: string; ink: string; surf: string; mono: string }): void {
    const { ctx } = this,
      n = st.song.chords.length;
    if (!n) return;
    const pos = st.song.chords.map((_, k) => this.nodePos(st, k)),
      vis = this.visible(st),
      focus = st.sel ?? n - 1,
      /* 演奏中は鳴っている和音から次の和音への 1 本だけ */
      segs: [number, number][] =
        st.play >= 0 ? (vis.length > 1 ? [[st.play, st.next]] : []) : st.song.chords.slice(1).map((_, j) => [j, j + 1]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [k0, k] of segs) {
      const [x0, y0] = pos[k0],
        [x1, y1] = pos[k],
        on = st.play >= 0 || k === focus,
        a = Math.atan2(y1 - y0, x1 - x0),
        mx = (x0 + x1) / 2,
        my = (y0 + y1) / 2,
        h = on ? 8 : 6;
      ctx.globalAlpha = on ? 1 : 0.4;
      ctx.strokeStyle = c.lv;
      ctx.lineWidth = on ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      /* 向きのある線なので矢じり */
      ctx.fillStyle = c.lv;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(a) * h, my + Math.sin(a) * h);
      ctx.lineTo(mx + Math.cos(a + 2.5) * h, my + Math.sin(a + 2.5) * h);
      ctx.lineTo(mx + Math.cos(a - 2.5) * h, my + Math.sin(a - 2.5) * h);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const r0 = this.r0;
    for (const k of vis) {
      const ch = st.song.chords[k],
        [x, y] = pos[k],
        on = k === st.play,
        r = on ? r0 + 3 + 2 * Math.sin(st.frac * Math.PI * 2) : r0;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = on ? c.lv : c.surf;
      ctx.fill();
      ctx.lineWidth = k === st.sel ? 3.5 : 2;
      ctx.strokeStyle = k === st.sel ? c.sel : c.lv;
      ctx.stroke();
      ctx.fillStyle = on ? c.surf : c.ink;
      ctx.font = `700 ${Math.round(r0 * 0.95)}px ${c.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(k + 1), x, y + 0.5);
      /* 転調する和音には、新しい調の主音を添える */
      if (ch.mod) {
        ctx.font = `700 11px ${c.mono}`;
        ctx.fillStyle = c.sel;
        ctx.textAlign = 'left';
        ctx.fillText(`→${keyTonic(ch.mod)}${ch.mod.m === 'min' ? 'm' : ''}`, x + r + 3, y - r);
      }
    }
  }
}

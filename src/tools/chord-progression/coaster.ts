/**
 * コード進行のページの緊張のレール: 和音を駅（幅は拍の数）として並べ、緊張の高さのレールの上をトロッコが走る。
 * ドミナントからトニックへ進む所で落ち、旗を立てる。駅は押して選び、横へドラッグして並べ替える。
 * 長い進行は一部だけを見せ、選んだ和音や鳴っている和音が端へ寄ったらめくる。
 * くり返すときは最後の和音の次に最初の和音を続けて描き、最後から最初へ戻る所の解決も見せる
 */
import { alpha } from './map';
import type { Entry } from './song';
import { roman } from './theory';

const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const mod = (a: number, n: number): number => ((a % n) + n) % n;
export interface CoasterState {
  entries: Entry[];
  beats: number;
  meter: number;
  sel: number | null;
  play: number;
  /** トロッコの位置（曲の頭からの拍） */
  cart: number;
  /** 見せる位置の基準（曲の頭からの拍） */
  focus: number;
  /** くり返すか（最後の次に最初を続けて描く） */
  loop: boolean;
  /** ドラッグで入れる位置の線（なければ null） */
  caret: number | null;
}
/** 描く駅。b は見せている範囲の左端からの拍、ghost はくり返しで頭へ戻った先の駅 */
interface Item {
  k: number;
  e: Entry;
  b: number;
  ghost: boolean;
}
const PAD = 12,
  BASE = 46,
  /** 1 拍の最小の幅 [px] */
  PXB = 16;

export class Coaster {
  private W = 600;
  private readonly H = 210;
  private readonly ctx: CanvasRenderingContext2D;
  /** 長い進行で見せている範囲の左端（曲の頭からの拍） */
  private s0 = 0;
  constructor(private readonly cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  }
  layout(): void {
    const W = this.cv.clientWidth || 600,
      dpr = Math.min(2, devicePixelRatio || 1);
    this.W = W;
    this.cv.width = Math.round(W * dpr);
    this.cv.height = Math.round(this.H * dpr);
    this.cv.style.height = `${this.H}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /** 見せる駅と、見せる範囲の拍の数 */
  private view(st: CoasterState): { items: Item[]; V: number; wrap: boolean } {
    const { entries: es, beats: tot } = st,
      n = es.length;
    if (!n) return { items: [], V: 1, wrap: false };
    const maxB = Math.max(st.meter * 2, Math.floor((this.W - PAD * 2) / PXB / st.meter) * st.meter),
      ghostB = st.loop && n > 1 ? es[0].beats : 0;
    if (tot + ghostB <= maxB) {
      this.s0 = 0;
      const items: Item[] = es.map((e, k) => ({ k, e, b: e.start, ghost: false }));
      if (ghostB) items.push({ k: 0, e: es[0], b: tot, ghost: true });
      return { items, V: tot + ghostB, wrap: false };
    }
    /* 長い進行: 基準が見せている範囲の端へ寄ったら、基準が左から 3 分の 1 に来るようにめくる */
    const V = maxB,
      rel = st.loop ? mod(st.focus - this.s0, tot) : st.focus - this.s0;
    if (rel < V * 0.08 || rel > V * 0.8) this.s0 = st.focus - V / 3;
    if (!st.loop) this.s0 = Math.max(0, Math.min(tot - V, this.s0));
    else this.s0 = mod(this.s0, tot);
    const items: Item[] = [];
    es.forEach((e, k) => {
      const b = st.loop ? mod(e.start - this.s0, tot) : e.start - this.s0;
      for (const x of st.loop ? [b, b - tot] : [b])
        if (x < V - 0.5 && x + e.beats > 0.5) items.push({ k, e, b: x, ghost: false });
    });
    items.sort((a, b) => a.b - b.b);
    return { items, V, wrap: st.loop };
  }
  private xOf(b: number, V: number): number {
    return PAD + (b / V) * (this.W - PAD * 2);
  }
  /** x にある駅の番号（なければ −1） */
  stationAt(st: CoasterState, x: number): number {
    const { items, V } = this.view(st);
    return items.find((it) => x >= this.xOf(it.b, V) && x < this.xOf(it.b + it.e.beats, V))?.k ?? -1;
  }
  /** x の前に入れるときの位置（0〜駅の数）と、その線の x */
  slotAt(st: CoasterState, x: number): [number, number] {
    const { items, V } = this.view(st),
      g = items.findIndex((it) => x < this.xOf(it.b + it.e.beats / 2, V));
    if (g < 0) {
      const last = items.at(-1);
      return last ? [last.ghost ? st.entries.length : last.k + 1, this.xOf(last.b + last.e.beats, V)] : [0, PAD];
    }
    const it = items[g];
    return [it.ghost ? st.entries.length : it.k, this.xOf(it.b, V)];
  }
  /** 次の和音（くり返さないなら最後の次はない） */
  private nextOf(st: CoasterState, k: number): Entry | undefined {
    const n = st.entries.length;
    return k + 1 < n ? st.entries[k + 1] : st.loop ? st.entries[0] : undefined;
  }
  /** レールの高さ: 駅の 6 割までは平ら、残りで次の駅の高さへなめらかに移る */
  private yAt(st: CoasterState, items: Item[], V: number, x: number): number {
    const top = 26,
      span = this.H - BASE - top - 12,
      h = (t: number) => this.H - BASE - 10 - t * span;
    if (!items.length) return h(0.2);
    const j = items.findIndex((it) => x < this.xOf(it.b + it.e.beats, V)),
      it = j < 0 ? (items.at(-1) as Item) : items[j];
    if (j < 0) return h(it.e.tension);
    const x0 = this.xOf(it.b, V),
      f = Math.max(0, (x - x0) / (this.xOf(it.b + it.e.beats, V) - x0)),
      a = it.e.tension,
      b = it.ghost ? a : (this.nextOf(st, it.k)?.tension ?? a),
      e = f < 0.6 ? 0 : (f - 0.6) / 0.4,
      sm = e * e * (3 - 2 * e);
    return h(a + (b - a) * sm);
  }
  draw(st: CoasterState): void {
    const { ctx, W, H } = this,
      ink = css('--ink'),
      ink3 = css('--ink-3'),
      line = css('--line'),
      surf = css('--surface'),
      lv = css('--cp-lv'),
      sel = css('--cp-sel'),
      mono = css('--mono'),
      sans = css('--sans'),
      col = { T: css('--cp-t'), S: css('--cp-s'), D: css('--cp-d') },
      { items, V, wrap } = this.view(st),
      n = st.entries.length;
    ctx.clearRect(0, 0, W, H);
    if (!items.length) {
      ctx.fillStyle = ink3;
      ctx.font = `13px ${sans}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('地図の三角形を押すと、ここに駅が並ぶ', PAD + 4, H / 2);
      return;
    }
    const x1 = Math.min(W - PAD, this.xOf((items.at(-1) as Item).b + (items.at(-1) as Item).e.beats, V));
    /* 支柱とレール */
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let x = PAD; x < x1; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, this.yAt(st, items, V, x) + 4);
      ctx.lineTo(x, H - BASE + 6);
      ctx.stroke();
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = PAD; x <= x1; x += 3) {
      const y = this.yAt(st, items, V, x);
      x === PAD ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    /* 名前のある進行の括弧（続いている駅の間だけ） */
    ctx.font = `700 11.5px ${sans}`;
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < items.length; i++) {
      const g = items[i].e.grp;
      if (!g || items[i].ghost) continue;
      let j = i;
      while (
        !items[j].e.grp?.last &&
        j + 1 < items.length &&
        !items[j + 1].ghost &&
        items[j + 1].k === items[j].k + 1 &&
        items[j + 1].e.grp
      )
        j++;
      const xa = Math.max(PAD, this.xOf(items[i].b, V) + 2),
        xb = Math.min(W - PAD, this.xOf(items[j].b + items[j].e.beats, V) - 2);
      ctx.strokeStyle = ink3;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xa, 16);
      ctx.lineTo(xa, 10);
      ctx.lineTo(xb, 10);
      ctx.lineTo(xb, 16);
      ctx.stroke();
      ctx.fillStyle = ink3;
      ctx.textAlign = 'left';
      ctx.fillText(g.n, xa + 4, 22);
      i = j;
    }
    /* 駅 */
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD - 2, 0, W - PAD * 2 + 4, H);
    ctx.clip();
    for (const it of items) {
      const { e, k } = it,
        xa = this.xOf(it.b, V),
        w = this.xOf(it.b + e.beats, V) - xa,
        c = col[e.fn],
        on = k === st.play && !it.ghost,
        isSel = k === st.sel && !it.ghost;
      ctx.globalAlpha = it.ghost ? 0.5 : 1;
      ctx.fillStyle = on ? c : alpha(c, 0.16);
      ctx.strokeStyle = isSel ? sel : c;
      ctx.lineWidth = isSel ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.roundRect(xa + 1.5, H - BASE + 8, w - 3, 30, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = on ? surf : ink;
      ctx.font = `700 13px ${mono}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = w > 54 ? `${k + 1} ${roman(e.ch, e.key)}` : roman(e.ch, e.key);
      ctx.save();
      ctx.beginPath();
      ctx.rect(xa + 3, H - BASE + 8, w - 6, 30);
      ctx.clip();
      ctx.fillText(label, xa + 7, H - BASE + 23);
      ctx.restore();
      /* くり返しで曲の頭へ戻る所 */
      if (k === 0 && (it.ghost || (wrap && it.b > 0))) {
        ctx.strokeStyle = ink3;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xa, 30);
        ctx.lineTo(xa, H - BASE + 6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ink3;
        ctx.font = `700 13px ${sans}`;
        ctx.textAlign = 'center';
        ctx.fillText('↺', xa, 24);
      }
      ctx.globalAlpha = 1;
      /* 解決: ドミナントからトニックへ（最後から最初へ戻る所も） */
      const p = k > 0 ? st.entries[k - 1] : st.loop && n > 1 ? st.entries[n - 1] : undefined;
      if (p && p.fn === 'D' && e.fn === 'T') {
        const y = this.yAt(st, items, V, xa + 4);
        ctx.strokeStyle = lv;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xa + 4, y - 4);
        ctx.lineTo(xa + 4, y - 30);
        ctx.stroke();
        ctx.fillStyle = lv;
        ctx.fillRect(xa + 4, y - 30, 34, 15);
        ctx.fillStyle = surf;
        ctx.font = `700 11px ${sans}`;
        ctx.textAlign = 'left';
        ctx.fillText('解決', xa + 8, y - 22.5);
      }
    }
    ctx.restore();
    if (st.caret !== null) {
      ctx.fillStyle = sel;
      ctx.fillRect(st.caret - 1.5, H - BASE + 2, 3, 42);
    }
    /* トロッコ */
    const rb = wrap ? mod(st.cart - this.s0, st.beats) : st.cart - this.s0;
    if (rb < 0 || rb > V) return;
    const x = this.xOf(rb, V) + 6,
      y = this.yAt(st, items, V, x),
      a = Math.atan2(this.yAt(st, items, V, x + 6) - y, 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = lv;
    ctx.beginPath();
    ctx.roundRect(-14, -16, 28, 12, 4);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(-8, -3, 3.5, 0, Math.PI * 2);
    ctx.arc(8, -3, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

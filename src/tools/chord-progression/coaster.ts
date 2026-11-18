/**
 * コード進行のページの緊張のレール: 和音を駅（幅は拍の数）として並べ、緊張の高さのレールの上をトロッコが走る。
 * 地図の右下に小さく重ね、トロッコの周りだけを見せてトロッコに合わせて流す。トロッコのいる名前のある進行の名前を、転調の札より上の段に出す。
 * ドミナントからトニックへ進む所で落ち、旗を立てる。急に高くなる所ではトロッコから「緊張！」の吹き出しを出す。
 * くり返すときは最後の和音の次に最初の和音を続けて描き、最後から最初へ戻る所の解決も見せる。
 * 駅は押して選び、横へドラッグして並べ替える
 */
import { alpha } from './map';
import type { Entry } from './song';
import { keyTonic, roman } from './theory';

const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export interface CoasterState {
  entries: Entry[];
  beats: number;
  sel: number | null;
  play: number;
  /** トロッコの位置（曲の頭からの拍）。見せる範囲もこれに合わせる */
  cart: number;
  /** 演奏中か（吹き出しは演奏中だけ） */
  playing: boolean;
  /** くり返すか（最後の次に最初を続けて描く） */
  loop: boolean;
  /** ドラッグで入れる位置の線（なければ null） */
  caret: number | null;
}
/** 描く駅。b は見せている範囲の左端からの拍 */
interface Item {
  k: number;
  e: Entry;
  b: number;
}
const PAD = 6,
  /** 駅の帯の高さ */
  STRIP = 22,
  /** 1 拍の幅 [px] */
  PXB = 20,
  /** トロッコを置く位置（左からの割合） */
  AT = 0.35,
  /** 「緊張！」を出す高さの上がり方（ドミナントへ上がるときは RISE_D から） */
  JUMP = 0.45,
  RISE_D = 0.25,
  /** 上の端に空ける、進行の名前の段の高さ（転調の札と重ならないように、札より上に置く） */
  TITLE = 16;

export class Coaster {
  private W = 240;
  private H = 110;
  private readonly ctx: CanvasRenderingContext2D;
  constructor(private readonly cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  }
  /** 右の端を地図に溶かす幅（文字をその手前に置く） */
  private fadeR = PAD;
  layout(w: number, h: number, fadeR = PAD): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.fadeR = fadeR;
    this.W = w;
    this.H = h - TITLE;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = `${w}px`;
    this.cv.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /** 見せる駅と、見せる範囲の拍の数・左端 */
  private view(st: CoasterState): { items: Item[]; V: number; s0: number } {
    const V = Math.max(4, (this.W - PAD * 2) / PXB),
      s0 = st.cart - V * AT,
      { entries: es, beats: tot } = st,
      items: Item[] = [];
    es.forEach((e, k) => {
      /* くり返すなら前後の周も描く */
      for (const n of st.loop ? [-1, 0, 1, 2] : [0]) {
        const b = e.start - s0 + n * tot;
        if (b < V && b + e.beats > 0) items.push({ k, e, b });
      }
    });
    items.sort((a, b) => a.b - b.b);
    return { items, V, s0 };
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
      return last ? [last.k + 1, this.xOf(last.b + last.e.beats, V)] : [0, PAD];
    }
    return [items[g].k, this.xOf(items[g].b, V)];
  }
  /** 次の和音（くり返さないなら最後の次はない） */
  private nextOf(st: CoasterState, k: number): Entry | undefined {
    const n = st.entries.length;
    return k + 1 < n ? st.entries[k + 1] : st.loop ? st.entries[0] : undefined;
  }
  /** 前の和音（くり返すなら最初の前は最後） */
  private prevOf(st: CoasterState, k: number): Entry | undefined {
    const n = st.entries.length;
    return k > 0 ? st.entries[k - 1] : st.loop && n > 1 ? st.entries[n - 1] : undefined;
  }
  /** 緊張の高さ t（0〜1）の y */
  private hy(t: number): number {
    const top = 36,
      bot = this.H - STRIP - 10;
    return bot - t * (bot - top);
  }
  /** レールの高さ: 駅の 6 割までは平ら、残りで次の駅の高さへなめらかに移る */
  private yAt(st: CoasterState, items: Item[], V: number, x: number): number {
    const it = items.find((q) => x < this.xOf(q.b + q.e.beats, V));
    if (!it) return this.hy(items.at(-1)?.e.tension ?? 0.2);
    const x0 = this.xOf(it.b, V),
      f = Math.max(0, (x - x0) / (this.xOf(it.b + it.e.beats, V) - x0)),
      a = it.e.tension,
      b = this.nextOf(st, it.k)?.tension ?? a,
      e = f < 0.6 ? 0 : (f - 0.6) / 0.4,
      sm = e * e * (3 - 2 * e);
    return this.hy(a + (b - a) * sm);
  }
  /** 上の段にトロッコのいる進行の名前（名前のある進行の中だけ）、その下にレールと駅 */
  draw(st: CoasterState): void {
    const { ctx, W, H } = this,
      { items, s0 } = this.view(st),
      here = items.find((q) => st.cart - s0 >= q.b && st.cart - s0 < q.b + q.e.beats)?.e.grp;
    ctx.clearRect(0, 0, W, H + TITLE);
    if (here) {
      ctx.fillStyle = css('--ink-2');
      ctx.font = `700 12px ${css('--sans')}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(here.n, W - this.fadeR, 12);
    }
    ctx.save();
    ctx.translate(0, TITLE);
    this.scene(st);
    ctx.restore();
  }
  private scene(st: CoasterState): void {
    const { ctx, W, H } = this,
      ink = css('--ink'),
      ink3 = css('--ink-3'),
      line = css('--line'),
      surf = css('--surface'),
      lv = css('--cp-lv'),
      dcol = css('--cp-d'),
      sel = css('--cp-sel'),
      mono = css('--mono'),
      sans = css('--sans'),
      col = { T: css('--cp-t'), S: css('--cp-s'), D: dcol },
      { items, V, s0 } = this.view(st),
      sy = H - STRIP - 2;
    if (!items.length) return;
    const last = items.at(-1) as Item,
      xa0 = Math.max(PAD, this.xOf(items[0].b, V)),
      xa1 = Math.min(W - PAD, this.xOf(last.b + last.e.beats, V));
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD, 0, W - PAD * 2, H);
    ctx.clip();
    /* 支柱（1 拍ごと）とレール */
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let b = Math.ceil(s0); b < s0 + V; b++) {
      const x = this.xOf(b - s0, V);
      if (x < xa0 || x > xa1) continue;
      ctx.beginPath();
      ctx.moveTo(x, this.yAt(st, items, V, x) + 3);
      ctx.lineTo(x, sy);
      ctx.stroke();
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = xa0; x <= xa1; x += 2) {
      const y = this.yAt(st, items, V, x);
      x === xa0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    /* 駅 */
    for (const it of items) {
      const { e, k } = it,
        xa = this.xOf(it.b, V),
        w = this.xOf(it.b + e.beats, V) - xa,
        c = col[e.fn],
        on = k === st.play,
        isSel = k === st.sel;
      ctx.fillStyle = on ? c : alpha(c, 0.16);
      ctx.strokeStyle = isSel ? sel : c;
      ctx.lineWidth = isSel ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.roundRect(xa + 1, sy, w - 2, STRIP - 2, 4);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.rect(xa + 2, sy, w - 4, STRIP);
      ctx.clip();
      ctx.fillStyle = on ? surf : ink;
      ctx.font = `700 11px ${mono}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(roman(e.ch, e.key), xa + 5, sy + STRIP / 2);
      ctx.restore();
      /* 転調する所: 上の端に新しい調の札を立て、駅まで点線で下ろす。くり返して頭へ戻る所も、調が変わるなら転調とみる */
      const last = st.entries[st.entries.length - 1],
        to =
          k > 0
            ? e.c.mod
            : st.loop && st.entries.length > 1 && (last.key.t !== e.key.t || last.key.m !== e.key.m)
              ? e.key
              : null;
      if (to) {
        const lb = `転調 ${keyTonic(to)}${to.m === 'min' ? 'm' : ''}`;
        ctx.font = `700 10px ${sans}`;
        const tw = ctx.measureText(lb).width + 8;
        ctx.strokeStyle = sel;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(xa + 1, 17);
        ctx.lineTo(xa + 1, sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = sel;
        ctx.fillRect(xa, sy - 1, 3, STRIP - 1);
        ctx.beginPath();
        ctx.roundRect(xa, 3, tw, 14, 3);
        ctx.fill();
        ctx.fillStyle = surf;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(lb, xa + 4, 10.5);
      }
      /* くり返しで曲の頭へ戻る所（転調の札を立てた所は、その点線と重なるので引かない） */
      if (k === 0 && st.loop && st.entries.length > 1 && !to) {
        ctx.strokeStyle = ink3;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xa, 18);
        ctx.lineTo(xa, sy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      /* 解決: ドミナントからトニックへ（最後から最初へ戻る所も） */
      const p = this.prevOf(st, k);
      if (p && p.fn === 'D' && e.fn === 'T') {
        const y = this.yAt(st, items, V, xa + 3);
        ctx.strokeStyle = lv;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xa + 3, y - 3);
        ctx.lineTo(xa + 3, y - 22);
        ctx.stroke();
        ctx.fillStyle = lv;
        ctx.fillRect(xa + 3, y - 22, 28, 13);
        ctx.fillStyle = surf;
        ctx.font = `700 10px ${sans}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('解決', xa + 6, y - 15.5);
      }
    }
    ctx.restore();
    if (st.caret !== null) {
      ctx.fillStyle = sel;
      ctx.fillRect(st.caret - 1.5, sy - 4, 3, STRIP + 4);
    }
    /* トロッコ */
    const x = this.xOf(st.cart - s0, V),
      y = this.yAt(st, items, V, x),
      a = Math.atan2(this.yAt(st, items, V, x + 4) - y, 4);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = lv;
    ctx.beginPath();
    ctx.roundRect(-10, -12, 20, 9, 3);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(-6, -2.5, 2.6, 0, Math.PI * 2);
    ctx.arc(6, -2.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    /* 急に高くなる所: 上りの手前から上り切った少しあとまで「緊張！」 */
    if (!st.playing) return;
    const cur = items.find((q) => x >= this.xOf(q.b, V) && x < this.xOf(q.b + q.e.beats, V));
    if (!cur) return;
    const f = (st.cart - s0 - cur.b) / cur.e.beats,
      nx = this.nextOf(st, cur.k),
      pv = this.prevOf(st, cur.k),
      tense = (a: Entry, b: Entry) => b.tension - a.tension >= (b.fn === 'D' ? RISE_D : JUMP),
      rising = nx && f >= 0.5 && tense(cur.e, nx),
      risen = pv && f < 0.25 && tense(pv, cur.e);
    if (!rising && !risen) return;
    const bw = 46,
      bh = 18,
      bx = Math.min(W - PAD - bw, Math.max(PAD, x - 10)),
      by = Math.max(2, y - 12 - bh - 20);
    ctx.fillStyle = surf;
    ctx.strokeStyle = dcol;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 5);
    ctx.fill();
    ctx.stroke();
    /* 吹き出しの口（トロッコへ向ける） */
    ctx.beginPath();
    ctx.moveTo(x - 3, by + bh - 0.5);
    ctx.lineTo(x, Math.min(y - 13, by + bh + 16));
    ctx.lineTo(x + 4, by + bh - 0.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(x - 2, by + bh - 2, 5, 2.5);
    ctx.fillStyle = dcol;
    ctx.font = `700 11px ${sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('緊張！', bx + 5, by + bh / 2 + 0.5);
  }
}

/**
 * コード進行のページの緊張のレール: 和音を駅（幅は拍の数）として並べ、緊張の高さのレールの上をトロッコが走る。
 * ドミナントからトニックへ進む所で落ち、旗を立てる。駅は押して選び、横へドラッグして並べ替える
 */
import { alpha } from './map';
import type { Entry } from './song';
import { roman } from './theory';

const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export interface Station {
  x: number;
  w: number;
}
export interface CoasterState {
  entries: Entry[];
  beats: number;
  sel: number | null;
  play: number;
  /** トロッコの位置（曲の頭からの拍。止まっていれば null） */
  cart: number | null;
  /** ドラッグで入れる位置の線（なければ null） */
  caret: number | null;
}
const PAD = 12,
  BASE = 46;

export class Coaster {
  private W = 600;
  private readonly H = 210;
  private readonly ctx: CanvasRenderingContext2D;
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
  stations(st: Pick<CoasterState, 'entries' | 'beats'>): Station[] {
    const w = this.W - PAD * 2,
      tot = st.beats || 1;
    return st.entries.map((e) => ({ x: PAD + (e.start / tot) * w, w: (e.beats / tot) * w }));
  }
  /** x にある駅の番号（なければ −1） */
  stationAt(st: Pick<CoasterState, 'entries' | 'beats'>, x: number): number {
    return this.stations(st).findIndex((q) => x >= q.x && x < q.x + q.w);
  }
  /** x の前に入れるときの位置（0〜駅の数）と、その線の x */
  slotAt(st: Pick<CoasterState, 'entries' | 'beats'>, x: number): [number, number] {
    const ss = this.stations(st);
    let g = ss.findIndex((q) => x < q.x + q.w / 2);
    if (g < 0) g = ss.length;
    const last = ss.at(-1);
    return [g, g < ss.length ? ss[g].x : last ? last.x + last.w : PAD];
  }
  /** レールの高さ: 駅の 6 割までは平ら、残りで次の駅の高さへなめらかに移る */
  private yAt(st: CoasterState, ss: Station[], x: number): number {
    const top = 26,
      span = this.H - BASE - top - 12,
      h = (t: number) => this.H - BASE - 10 - t * span;
    const k = ss.findIndex((q) => x < q.x + q.w);
    if (!ss.length) return h(0.2);
    if (k < 0) return h(st.entries.at(-1)?.tension ?? 0.2);
    const q = ss[k],
      f = (x - q.x) / q.w,
      a = st.entries[k].tension,
      b = st.entries[k + 1]?.tension ?? a,
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
      ss = this.stations(st);
    ctx.clearRect(0, 0, W, H);
    if (!ss.length) {
      ctx.fillStyle = ink3;
      ctx.font = `13px ${sans}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('地図の三角形を押すと、ここに駅が並ぶ', PAD + 4, H / 2);
      return;
    }
    /* 支柱とレール */
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let x = PAD; x < W - PAD; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, this.yAt(st, ss, x) + 4);
      ctx.lineTo(x, H - BASE + 6);
      ctx.stroke();
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = PAD; x <= W - PAD; x += 3) {
      const y = this.yAt(st, ss, x);
      x === PAD ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    /* 名前のある進行の括弧 */
    ctx.font = `700 11.5px ${sans}`;
    ctx.textBaseline = 'alphabetic';
    for (let k = 0; k < st.entries.length; k++) {
      const g = st.entries[k].grp;
      if (!g?.first) continue;
      let j = k;
      while (j < st.entries.length && !st.entries[j].grp?.last) j++;
      const x0 = ss[k].x + 2,
        x1 = ss[Math.min(j, ss.length - 1)].x + ss[Math.min(j, ss.length - 1)].w - 2;
      ctx.strokeStyle = ink3;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, 16);
      ctx.lineTo(x0, 10);
      ctx.lineTo(x1, 10);
      ctx.lineTo(x1, 16);
      ctx.stroke();
      ctx.fillStyle = ink3;
      ctx.textAlign = 'left';
      ctx.fillText(g.n, x0 + 4, 22);
    }
    /* 駅 */
    st.entries.forEach((e, k) => {
      const q = ss[k],
        c = col[e.fn],
        on = k === st.play,
        isSel = k === st.sel;
      ctx.fillStyle = on ? c : alpha(c, 0.16);
      ctx.strokeStyle = isSel ? sel : c;
      ctx.lineWidth = isSel ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.roundRect(q.x + 1.5, H - BASE + 8, q.w - 3, 30, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = on ? surf : ink;
      ctx.font = `700 13px ${mono}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = q.w > 54 ? `${k + 1} ${roman(e.ch, e.key)}` : roman(e.ch, e.key);
      ctx.save();
      ctx.beginPath();
      ctx.rect(q.x + 3, H - BASE + 8, q.w - 6, 30);
      ctx.clip();
      ctx.fillText(label, q.x + 7, H - BASE + 23);
      ctx.restore();
      /* 解決: ドミナントからトニックへ */
      const p = st.entries[k - 1];
      if (p && p.fn === 'D' && e.fn === 'T' && (e.tr?.lv ?? 0) >= 0) {
        const y = this.yAt(st, ss, q.x + 4);
        ctx.strokeStyle = lv;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(q.x + 4, y - 4);
        ctx.lineTo(q.x + 4, y - 30);
        ctx.stroke();
        ctx.fillStyle = lv;
        ctx.fillRect(q.x + 4, y - 30, 34, 15);
        ctx.fillStyle = surf;
        ctx.font = `700 11px ${sans}`;
        ctx.fillText('解決', q.x + 8, y - 22.5);
      }
    });
    if (st.caret !== null) {
      ctx.fillStyle = sel;
      ctx.fillRect(st.caret - 1.5, H - BASE + 2, 3, 42);
    }
    /* トロッコ */
    const x = st.cart === null ? ss[0].x + 6 : PAD + (st.cart / (st.beats || 1)) * (W - PAD * 2),
      y = this.yAt(st, ss, x),
      a = Math.atan2(this.yAt(st, ss, x + 6) - y, 6);
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

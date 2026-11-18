/**
 * 555 の回路を時間で進める計算（理想素子）。
 * C1 の電圧は充電・放電の指数関数のまま進め、しきい値に届く時刻を解いてその瞬間に出力を切り替える
 */

/** 動き方。osc: C1 の電圧で切り替わる発振、mono: ボタンで始まる単安定、latch: ボタンで切り替わる双安定、schmitt: 入力の電圧で切り替わる */
export type Kind = 'osc' | 'mono' | 'latch' | 'schmitt';

/** 1 回分の条件（回路と入力の値から決まる） */
export interface Env {
  kind: Kind;
  /** 電源電圧 */
  vcc: number;
  /** 上のしきい値（THR）。下のしきい値（TRIG）はその半分 */
  U: number;
  /** 出力 H の間の C1 の向かう先 [電圧, 時定数]、L の間、電源を切った間の時定数 */
  hi: [number, number];
  lo: [number, number];
  off: number;
  power: boolean;
  /** RST が L（出力を L にし、放電を続ける） */
  reset: boolean;
  /** TRIG を押している（mono・latch） */
  trig: boolean;
  /** THR・TRIG に入れる電圧（schmitt） */
  vin: number;
}

/** 記録の 1 点 [時刻, CH2 の電圧, 出力の電圧] */
export type Sample = [number, number, number];

export class Sim {
  t = 0;
  vc = 0;
  q = 0;
  hist: Sample[] = [];
  /** 出力の切り替わり [時刻, 新しい出力] */
  edges: [number, number][] = [];
  /** 電源を入れた時刻 */
  onT = 0;
  /** 電源を入れて最初の H の長さ */
  first: number | null = null;
  private fu: number | null = null;

  /** 電源を入れ直す（記録の起点を今にする） */
  powerOn(): void {
    this.onT = this.t;
    this.edges = [];
    this.fu = null;
    this.first = null;
  }

  private ch2(e: Env): number {
    if (e.kind === 'latch') return e.trig || !e.power ? 0 : e.vcc;
    if (e.kind === 'schmitt') return e.power ? Math.min(e.vin, e.vcc) : 0;
    return this.vc;
  }

  private push(e: Env): void {
    this.hist.push([this.t, this.ch2(e), this.q && e.power ? e.vcc : 0]);
  }

  /** dt だけ進める。途中の切り替わりは記録に縦の線として残す */
  advance(dt: number, e: Env): void {
    const L = e.U / 2;
    let rem = dt,
      guard = 0;
    while (rem > 0 && guard++ < 100) {
      if (!e.power) {
        this.vc *= Math.exp(-rem / e.off);
        if (this.q) this.flip(0, e);
        this.t += rem;
        return;
      }
      const lowIn = e.kind === 'osc' ? this.vc < L : e.kind === 'schmitt' ? e.vin < L : e.trig;
      const highIn = e.kind === 'schmitt' ? e.vin >= e.U : e.kind === 'latch' ? false : this.vc >= e.U * (1 - 1e-9);
      let q = this.q;
      if (e.reset) q = 0;
      else if (lowIn) q = 1;
      else if (highIn) q = 0;
      if (q !== this.q) this.flip(q, e);
      if (e.kind === 'latch' || e.kind === 'schmitt') {
        this.t += rem;
        return;
      }
      const [vi, tau] = this.q ? e.hi : e.lo;
      let te = Infinity;
      if (!e.reset) {
        if (this.q && vi > e.U && this.vc < e.U) te = tau * Math.log((vi - this.vc) / (vi - e.U));
        else if (!this.q && e.kind === 'osc' && this.vc > L) te = tau * Math.log(this.vc / L);
      }
      const h = Math.min(rem, te);
      this.vc = vi + (this.vc - vi) * Math.exp(-h / tau);
      if (h === te) this.vc = this.q ? e.U : L * (1 - 1e-9);
      this.t += h;
      rem -= h;
    }
  }

  private flip(q: number, e: Env): void {
    this.push(e);
    this.q = q;
    this.push(e);
    this.edges.push([this.t, q]);
    if (this.edges.length > 60) this.edges.shift();
    if (q && this.fu == null) this.fu = this.t;
    else if (!q && this.fu != null && this.first == null) this.first = this.t - this.fu;
  }

  /** 1 フレーム分を表示の幅 span に合わせて刻みながら進め、span より古い記録を捨てる */
  run(simDt: number, span: number, e: Env): void {
    const n = Math.min(1500, Math.max(1, Math.ceil(simDt / (span / 700))));
    for (let i = 0; i < n; i++) {
      this.advance(simDt / n, e);
      this.push(e);
    }
    const cut = this.t - span * 1.05;
    let k = 0;
    while (k < this.hist.length - 2 && (this.hist[k + 1] as Sample)[0] < cut) k++;
    if (k) this.hist.splice(0, k);
  }

  /** 波形から測った値（電源を入れて最初の H は長いので tH から除く） */
  measure(): { tH?: number; tL?: number; tp?: number; f?: number; D?: number; first?: number } {
    const e = this.edges.filter((x) => x[0] >= this.onT),
      m: { tH?: number; tL?: number; tp?: number; f?: number; D?: number; first?: number } = {};
    for (let i = e.length - 1; i > 0; i--) {
      const [t1, q1] = e[i] as [number, number],
        d = t1 - (e[i - 1] as [number, number])[0];
      if (q1 === 0 && m.tp == null) m.tp = d;
      if (q1 === 0 && m.tH == null && i > 1) m.tH = d;
      if (q1 === 1 && m.tL == null) m.tL = d;
    }
    if (m.tH != null && m.tL != null) {
      m.f = 1 / (m.tH + m.tL);
      m.D = m.tH / (m.tH + m.tL);
    }
    if (this.first != null) m.first = this.first;
    return m;
  }
}

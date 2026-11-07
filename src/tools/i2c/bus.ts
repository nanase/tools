/**
 * I2C バスの模擬。2 本の線（SDA・SCL）の電圧を時間刻みで追い、各機器は自分が感じた High・Low（シュミットトリガ）に反応する。
 * 線を下げているのが 1 台でもあれば Low へ（オープンドレインのワイヤード AND）、誰もいなければプルアップ抵抗で VDD へ戻る。
 * マスタはジェネレータで手順を進め、スレーブは SCL の立ち上がり・立ち下がりと開始・終了の合図で動く
 */

/** 速度のモード（UM10204 の表 10・表 11） */
export const MODES = {
  sm: { name: '標準', f: 100e3, tr: 1000e-9, iol: 3e-3, cmax: 400e-12 },
  fm: { name: 'ファスト', f: 400e3, tr: 300e-9, iol: 3e-3, cmax: 400e-12 },
  fp: { name: 'ファストプラス', f: 1e6, tr: 120e-9, iol: 20e-3, cmax: 550e-12 },
} as const;
export type ModeId = keyof typeof MODES;
export type Mode = (typeof MODES)[ModeId];

/** スレーブの機器。mem は読み出しで返す 2 バイト（書き込むと置き換わる） */
export const DEVS = [
  { k: 'tmp', name: '温度センサ', a: 0x48, mem: [0x19, 0x80] },
  { k: 'mem', name: 'EEPROM', a: 0x50, mem: [0xa5, 0x3c] },
  { k: 'rtc', name: '時計', a: 0x68, mem: [0x30, 0x12] },
] as const;
export type DevKey = (typeof DEVS)[number]['k'];
/** どの機器も持たないアドレス */
export const ABSENT = 0x3c;
/** Low の出力電圧の上限 [V]。IOL はこの電圧で流せる電流 */
const VOL_MAX = 0.4;
/** 立ち上がり時間（0.3 VDD から 0.7 VDD まで）と時定数の比 ln(0.7/0.3) */
export const RISE_K = Math.log(0.7 / 0.3);

export const hex = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;
export const bin = (v: number, n = 8): string => v.toString(2).padStart(n, '0');

export interface Config {
  mode: ModeId;
  /** プルアップ抵抗 [Ω] */
  rp: number;
  /** 配線の容量 [F] */
  cb: number;
  vdd: number;
  op: 'w' | 'r';
  /** 宛先の 7 ビットのアドレス */
  addr: number;
  /** 書き込む 2 バイト */
  data: readonly [number, number];
  /** 宛先がアドレスの ACK のあと SCL を Low のまま保持する */
  stretch: boolean;
  /** 2 台目のマスタが同時に送り始める */
  multi: boolean;
  /** マスタが SCL を放したあと High になるまで待つ（クロックの同期） */
  sync: boolean;
}

export interface Electrical {
  mode: Mode;
  /** 出力の Low の抵抗 [Ω]（VOL_MAX で IOL を流す） */
  ron: number;
  /** Low の電圧 [V] */
  vol: number;
  vih: number;
  vil: number;
  /** 立ち上がり時間 [s] */
  tr: number;
  /** プルアップ抵抗の下限と上限 [Ω] */
  rpMin: number;
  rpMax: number;
}

/** 式で求まる電気の値 */
export function electrical(c: Pick<Config, 'mode' | 'rp' | 'cb' | 'vdd'>): Electrical {
  const mode = MODES[c.mode],
    ron = VOL_MAX / mode.iol;
  return {
    mode,
    ron,
    vol: (c.vdd * ron) / (ron + c.rp),
    vih: 0.7 * c.vdd,
    vil: 0.3 * c.vdd,
    tr: RISE_K * c.rp * c.cb,
    rpMin: (c.vdd - VOL_MAX) / mode.iol,
    rpMax: mode.tr / (RISE_K * c.cb),
  };
}

/** 解読した区切り。S 開始・Sr 再開始・P 終了・addr アドレス・data データ・A ACK・N NACK・junk 8 ビットに満たない残り */
export type FrameKind = 'S' | 'Sr' | 'P' | 'addr' | 'data' | 'A' | 'N' | 'junk';
/** 送り手。m マスタ（1 台目、または 2 台とも）・m2 2 台目のマスタ・s スレーブ・null 誰も下げていない */
export type Role = 'm' | 'm2' | 's' | null;
export interface Bit {
  /** SCL の立ち上がりの時刻 [s] */
  t: number;
  v: 0 | 1;
  /** その時 SDA を下げていた機器（ビット i が機器 i） */
  by: number;
}
export interface Frame {
  k: FrameKind;
  t0: number;
  t1: number;
  /** addr・data の 8 ビットの値 */
  v?: number;
  bits?: Bit[];
  by?: number;
  /** A・N が返事をした区切り */
  of?: FrameKind;
  role?: Role;
}
/** 出来事。i は機器（-1 はバス） */
export type NoteKind = 'start' | 'retry' | 'lost' | 'match' | 'skip' | 'stretch' | 'unstretch' | 'stop';
export interface Note {
  t: number;
  i: number;
  kind: NoteKind;
}
export type Result = 'ok' | 'nack' | 'nack-data' | 'lost' | 'timeout';

export interface MasterInfo {
  i: number;
  addr: number;
  op: 'w' | 'r';
  data: readonly number[];
  got: number[];
  res: Result | null;
}

export interface Sim {
  c: Config;
  E: Electrical;
  /** 設定のクロックの周期 [s] */
  T: number;
  /** 時間刻み [s] */
  dt: number;
  len: number;
  /** 記録の長さ [s] */
  dur: number;
  vSda: Float32Array;
  vScl: Float32Array;
  dSda: Uint8Array;
  dScl: Uint8Array;
  frames: Frame[];
  notes: Note[];
  masters: MasterInfo[];
  res: Result;
  /** 読み出した 2 バイト */
  got: number[];
  /** 宛先に届いた・宛先から読んだ値が正しいか */
  okData: boolean;
  /** 実際のクロックの周期 [s]（立ち上がりの間隔の中央値） */
  period: number;
  /** 宛先のスレーブが通信の後に持つ 2 バイト */
  mem: Record<number, number[]>;
}

/** 機器の番号: 0 マスタ、1 2 台目のマスタ、2〜 スレーブ（DEVS の順） */
export const SLAVE0 = 2;
/** 記録の上限（1 クロック 200 刻みで 400 クロック） */
const STEPS_PER_T = 200;
const NMAX = STEPS_PER_T * 400;

type Wait = { until: number } | { cond: () => boolean };
interface Agent {
  i: number;
  sda: boolean;
  scl: boolean;
}
interface Master extends Agent, MasterInfo {
  gen: Generator<Wait, void, void> | null;
  wait: Wait;
  rival: boolean;
  lostAt: number;
}
interface Slave extends Agent {
  a: number;
  st: 'idle' | 'addr' | 'ack' | 'rx' | 'tx' | 'mack' | 'skip';
  n: number;
  v: number;
  rw: number;
  after: 'rx' | 'tx';
  byte: number;
  k: number;
  mack: number;
  mem: number[];
  rx: number[];
  stretchNext: boolean;
  q: { at: number; f: () => void }[];
}

/**
 * 1 回の通信を模擬する。mem はスレーブが初めに持つ 2 バイト（アドレスごと。省略すると DEVS の値）
 */
export function simulate(c: Config, mem: Record<number, readonly number[]> = {}): Sim {
  const E = electrical(c),
    T = 1 / E.mode.f;
  /* マスタの Low と High の長さ、データを変えるまでの間（SCL の立ち下がりから）、スレーブの反応の遅れ */
  const tLow = 0.53 * T,
    tHigh = T - tLow,
    tHd = 0.12 * T,
    tSl = 0.1 * T;
  const dt = T / STEPS_PER_T,
    tauR = c.rp * c.cb,
    tauF = ((E.ron * c.rp) / (E.ron + c.rp)) * c.cb;
  const kR = Math.exp(-dt / tauR),
    kF = Math.exp(-dt / tauF);
  const vSda = new Float32Array(NMAX),
    vScl = new Float32Array(NMAX),
    dSda = new Uint8Array(NMAX),
    dScl = new Uint8Array(NMAX),
    sScl = new Uint8Array(NMAX);
  let t = 0,
    n = 0,
    va = c.vdd,
    vc = c.vdd,
    /* 感じている値（全機器で同じしきい値） */
    sa: 0 | 1 = 1,
    sc: 0 | 1 = 1;
  const notes: Note[] = [];
  const note = (i: number, kind: NoteKind) => notes.push({ t, i, kind });
  const bus = { stopAt: -1, busy: false };

  /* ---------- マスタ ---------- */
  const d = (s: number): Wait => ({ until: t + s });
  const sclHigh = (): Wait => ({ cond: () => sc === 1 });
  /** 1 ビット送る（SCL は Low で始まり Low で終わる）。調停に負けたら -1 */
  function* sendBit(m: Master, b: number, arb: boolean): Generator<Wait, number, void> {
    yield d(tHd);
    m.sda = !b;
    yield d(tLow - tHd);
    m.scl = false;
    if (c.sync) yield sclHigh();
    yield d(tHigh / 2);
    const seen = sa;
    if (arb && b === 1 && seen === 0 && m.rival) {
      m.sda = false;
      m.scl = false;
      m.lostAt = t;
      note(m.i, 'lost');
      return -1;
    }
    yield d(tHigh / 2);
    m.scl = true;
    return seen;
  }
  function* recvBit(m: Master): Generator<Wait, number, void> {
    yield d(tHd);
    m.sda = false;
    yield d(tLow - tHd);
    m.scl = false;
    if (c.sync) yield sclHigh();
    yield d(tHigh / 2);
    const seen = sa;
    yield d(tHigh / 2);
    m.scl = true;
    return seen;
  }
  function* stop(m: Master): Generator<Wait, void, void> {
    yield d(tHd);
    m.sda = true;
    yield d(tLow - tHd);
    m.scl = false;
    if (c.sync) yield sclHigh();
    yield d(tHigh);
    m.sda = false;
  }
  function* transfer(m: Master): Generator<Wait, Result, void> {
    m.sda = true;
    note(m.i, 'start');
    yield d(tHigh);
    m.scl = true;
    const ab = (m.addr << 1) | (m.op === 'r' ? 1 : 0);
    for (let k = 7; k >= 0; k--) if ((yield* sendBit(m, (ab >> k) & 1, true)) < 0) return 'lost';
    if ((yield* recvBit(m)) === 1) {
      yield* stop(m);
      return 'nack';
    }
    if (m.op === 'w') {
      for (const byte of m.data) {
        for (let k = 7; k >= 0; k--) if ((yield* sendBit(m, (byte >> k) & 1, true)) < 0) return 'lost';
        if ((yield* recvBit(m)) === 1) {
          yield* stop(m);
          return 'nack-data';
        }
      }
    } else {
      for (let j = 0; j < 2; j++) {
        let v = 0;
        for (let k = 0; k < 8; k++) v = (v << 1) | (yield* recvBit(m));
        m.got.push(v);
        /* 最後のバイトには NACK を返して読み出しを終える */
        yield* sendBit(m, j === 1 ? 1 : 0, false);
      }
    }
    yield* stop(m);
    return 'ok';
  }
  /** 調停に負けたら終了の合図を待って送り直す（3 回まで） */
  function* run(m: Master): Generator<Wait, void, void> {
    for (let a = 0; a < 3; a++) {
      if (a > 0) {
        m.got = [];
        yield { cond: () => bus.stopAt > m.lostAt && !bus.busy };
        yield d(tLow);
        note(m.i, 'retry');
      }
      const r = yield* transfer(m);
      if (r !== 'lost') {
        m.res = r;
        return;
      }
    }
    m.res = 'lost';
  }
  const agents: Agent[] = [];
  const mkMaster = (i: number, addr: number, op: 'w' | 'r', data: readonly number[]): Master => {
    const m: Master = {
      i,
      addr,
      op,
      data,
      got: [],
      res: null,
      sda: false,
      scl: false,
      gen: null,
      wait: { until: 0.6 * T },
      rival: c.multi,
      lostAt: 0,
    };
    m.gen = run(m);
    agents.push(m);
    return m;
  };
  const m1 = mkMaster(0, c.addr, c.op, c.data);
  /* 2 台目は 1 台目と違う宛先へ書き込む */
  const m2 = c.multi ? mkMaster(1, c.addr === 0x50 ? 0x68 : 0x50, 'w', [0x00, 0x07]) : null;
  const masters = [m1, m2].filter((m): m is Master => m !== null);

  /* ---------- スレーブ ---------- */
  const slaves: Slave[] = DEVS.map((x, j) => {
    const s: Slave = {
      i: SLAVE0 + j,
      a: x.a,
      sda: false,
      scl: false,
      st: 'idle',
      n: 0,
      v: 0,
      rw: 0,
      after: 'rx',
      byte: 0,
      k: 0,
      mack: 1,
      mem: [...(mem[x.a] ?? x.mem)],
      rx: [],
      stretchNext: false,
      q: [],
    };
    agents.push(s);
    return s;
  });
  const later = (s: Slave, f: () => void, dly = tSl) => s.q.push({ at: t + dly, f });
  const drive = (s: Slave, bit: number) =>
    later(s, () => {
      s.sda = !bit;
    });
  const release = (s: Slave) =>
    later(s, () => {
      s.sda = false;
    });
  const pull = (s: Slave) =>
    later(s, () => {
      s.sda = true;
    });
  const sStart = (s: Slave) => {
    s.st = 'addr';
    s.n = 0;
    s.v = 0;
    s.sda = false;
    s.q = [];
    s.k = 0;
  };
  const sStop = (s: Slave) => {
    s.st = 'idle';
    s.sda = false;
    s.q = [];
  };
  const sRise = (s: Slave) => {
    if (s.st === 'addr' || s.st === 'rx') {
      s.v = ((s.v << 1) | sa) & 0xff;
      s.n++;
    } else if (s.st === 'mack') s.mack = sa;
  };
  const nextByte = (s: Slave) => {
    s.st = 'tx';
    s.byte = s.mem[s.k++ % 2];
    drive(s, (s.byte >> 7) & 1);
    s.n = 1;
  };
  const sFall = (s: Slave) => {
    switch (s.st) {
      case 'addr':
        if (s.n < 8) break;
        if (s.v >> 1 === s.a) {
          s.rw = s.v & 1;
          s.st = 'ack';
          s.after = s.rw ? 'tx' : 'rx';
          pull(s);
          s.stretchNext = c.stretch && s.a === c.addr;
          note(s.i, 'match');
        } else {
          s.st = 'skip';
          note(s.i, 'skip');
        }
        break;
      case 'rx':
        if (s.n < 8) break;
        s.rx.push(s.v);
        s.mem[s.k++ % 2] = s.v;
        s.st = 'ack';
        s.after = 'rx';
        pull(s);
        break;
      case 'ack':
        release(s);
        if (s.stretchNext) {
          s.stretchNext = false;
          s.scl = true;
          note(s.i, 'stretch');
          later(
            s,
            () => {
              s.scl = false;
              note(s.i, 'unstretch');
            },
            3.2 * T,
          );
        }
        if (s.after === 'rx') {
          s.st = 'rx';
          s.n = 0;
          s.v = 0;
        } else nextByte(s);
        break;
      case 'tx':
        if (s.n < 8) {
          drive(s, (s.byte >> (7 - s.n)) & 1);
          s.n++;
        } else {
          release(s);
          s.st = 'mack';
        }
        break;
      case 'mack':
        if (s.mack === 0) nextByte(s);
        else {
          s.st = 'skip';
          release(s);
        }
        break;
    }
  };

  /* ---------- 解読（ロジックアナライザと同じく、線の High・Low だけを見る） ---------- */
  const frames: Frame[] = [];
  let fr: { k: 'addr' | 'data'; bits: Bit[]; t0: number; t1: number; v: number; done8: boolean } | null = null,
    lastFall = 0,
    inTx = false;
  const newFrame = (k: 'addr' | 'data') => ({ k, bits: [] as Bit[], t0: t, t1: t, v: 0, done8: false });
  const dStart = () => {
    frames.push({ k: inTx ? 'Sr' : 'S', t0: t, t1: t });
    inTx = true;
    fr = newFrame('addr');
  };
  const flushJunk = () => {
    /* 終了の直前の立ち上がり 1 回は終了の合図の一部 */
    if (fr && fr.bits.length > 1) frames.push({ k: 'junk', t0: fr.t0, t1: t, bits: fr.bits });
  };
  const dStop = () => {
    flushJunk();
    frames.push({ k: 'P', t0: t, t1: t });
    inTx = false;
    fr = null;
  };
  const dRise = () => {
    if (!fr) return;
    if (fr.bits.length === 0 && fr.t0 < lastFall) fr.t0 = lastFall;
    fr.bits.push({ t, v: sa, by: dSda[n] });
  };
  const dFall = () => {
    lastFall = t;
    if (!fr) return;
    if (fr.bits.length === 8 && !fr.done8) {
      fr.done8 = true;
      fr.t1 = t;
      fr.v = fr.bits.reduce((a, b) => (a << 1) | b.v, 0);
    } else if (fr.bits.length === 9) {
      const ack = fr.bits[8],
        bits = fr.bits.slice(0, 8);
      frames.push({ k: fr.k, t0: fr.t0, t1: fr.t1, v: fr.v, bits, by: bits.reduce((a, b) => a | b.by, 0) });
      frames.push({ k: ack.v ? 'N' : 'A', t0: fr.t1, t1: t, by: ack.by, of: fr.k });
      fr = newFrame('data');
    }
  };

  /* ---------- 時間を進める ---------- */
  const step = (m: Master) => {
    for (let g = 0; g < 50 && m.gen && m.res === null; g++) {
      const w = m.wait;
      if ('until' in w ? t + 1e-15 < w.until : !w.cond()) return;
      const r = m.gen.next();
      if (r.done) {
        m.gen = null;
        return;
      }
      m.wait = r.value;
    }
  };
  let endAt = Infinity;
  for (; n < NMAX; n++) {
    for (const m of masters) step(m);
    for (const s of slaves) {
      if (!s.q.length) continue;
      const due = s.q.filter((x) => x.at <= t + 1e-15);
      if (!due.length) continue;
      s.q = s.q.filter((x) => x.at > t + 1e-15);
      for (const x of due) x.f();
    }
    let mA = 0,
      mC = 0;
    for (const a of agents) {
      if (a.sda) mA |= 1 << a.i;
      if (a.scl) mC |= 1 << a.i;
    }
    va = mA ? E.vol + (va - E.vol) * kF : c.vdd + (va - c.vdd) * kR;
    vc = mC ? E.vol + (vc - E.vol) * kF : c.vdd + (vc - c.vdd) * kR;
    vSda[n] = va;
    vScl[n] = vc;
    dSda[n] = mA;
    dScl[n] = mC;
    const pa: 0 | 1 = sa,
      pc: 0 | 1 = sc;
    sa = va > E.vih ? 1 : va < E.vil ? 0 : sa;
    sc = vc > E.vih ? 1 : vc < E.vil ? 0 : sc;
    sScl[n] = sc;
    if (pc === 1 && sc === 1 && pa !== sa) {
      if (sa === 0) {
        bus.busy = true;
        dStart();
        for (const s of slaves) sStart(s);
      } else {
        bus.busy = false;
        bus.stopAt = t;
        dStop();
        for (const s of slaves) sStop(s);
        note(-1, 'stop');
      }
    }
    if (pc !== sc) {
      if (sc === 1) {
        dRise();
        for (const s of slaves) sRise(s);
      } else {
        dFall();
        for (const s of slaves) sFall(s);
      }
    }
    if (endAt === Infinity && masters.every((m) => m.res !== null)) endAt = t + Math.max(1.2 * T, 3 * tauR);
    if (t >= endAt) {
      n++;
      break;
    }
    t += dt;
  }
  flushJunk();
  const len = n;
  let period = T;
  const rises: number[] = [];
  for (let i = 1; i < len; i++) if (sScl[i] === 1 && sScl[i - 1] === 0) rises.push(i * dt);
  if (rises.length > 3) {
    const g = rises
      .slice(1)
      .map((x, i) => x - rises[i])
      .sort((a, b) => a - b);
    period = g[g.length >> 1];
  }
  const res: Result = m1.res ?? 'timeout';
  const tgt = slaves.find((s) => s.a === c.addr);
  const okData =
    res === 'ok' &&
    !!tgt &&
    (c.op === 'w' ? tgt.rx.slice(-2).join() === c.data.join() : m1.got.join() === tgt.mem.join());
  decorate(frames);
  return {
    c,
    E,
    T,
    dt,
    len,
    dur: len * dt,
    vSda,
    vScl,
    dSda,
    dScl,
    frames,
    notes,
    masters: masters.map(({ i, addr, op, data, got, res }) => ({ i, addr, op, data, got, res })),
    res,
    got: m1.got,
    okData,
    period,
    mem: Object.fromEntries(slaves.map((s) => [s.a, s.mem])),
  };
}

/** 機器の集合（ビット i が機器 i）から送り手 */
export const roleOf = (mask: number): Role => (mask & 3 ? (mask & 2 && !(mask & 1) ? 'm2' : 'm') : mask ? 's' : null);

/** 区切りに送り手を付ける。全部 1 のビット（誰も下げない）は読み書きのビットから決める */
function decorate(frames: Frame[]): void {
  let rw = 0;
  for (const f of frames) {
    if (f.k === 'addr') {
      rw = (f.v ?? 0) & 1;
      f.role = roleOf(f.by ?? 0) ?? 'm';
    } else if (f.k === 'data') f.role = roleOf(f.by ?? 0) ?? (rw ? 's' : 'm');
    else if (f.k === 'A' || f.k === 'N') f.role = roleOf(f.by ?? 0);
  }
}

/** 時刻 t の記録の番号 */
export const idxAt = (s: Sim, t: number): number => Math.max(0, Math.min(s.len - 1, Math.round(t / s.dt)));

/** 機器の状態。idle 待機・match 宛先・skip 宛先でない・hold SCL を保持中・busy 通信中・done 完了・lost 調停に負け */
export type DevState = 'idle' | 'match' | 'skip' | 'hold' | 'busy' | 'done' | 'lost';
export function devState(s: Sim, i: number, t: number): DevState {
  let st: DevState = 'idle';
  for (const e of s.notes) {
    if (e.t > t) break;
    if (i < SLAVE0) {
      if (e.i === i && (e.kind === 'start' || e.kind === 'retry')) st = 'busy';
      if (e.i === i && e.kind === 'lost') st = 'lost';
      if (e.kind === 'stop' && st === 'busy') st = 'done';
      continue;
    }
    if (e.kind === 'start' || e.kind === 'retry' || e.kind === 'stop') st = 'idle';
    if (e.i !== i) continue;
    if (e.kind === 'match' || e.kind === 'unstretch') st = 'match';
    else if (e.kind === 'skip') st = 'skip';
    else if (e.kind === 'stretch') st = 'hold';
  }
  return st;
}

/** 時刻 t に続いている区切りの直前までで最後に始まった区切り */
export function frameAt(s: Sim, t: number): Frame | null {
  let f: Frame | null = null;
  for (const x of s.frames) {
    if (x.t0 <= t) f = x;
    else break;
  }
  return f;
}

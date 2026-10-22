/**
 * 計算した動きを段階に分ける: 接触が付いた・離れた時刻から、静止・加速・レットオフ・打弦・チェック・
 * 鍵を戻す・連打・戻りを決める。整調が悪いと、ブロッキング・2 度打ち・空振り・連打できない、が現れる
 */
import { FRAME, fnAt, gapAt, type Run } from './sim';

export type StageId =
  | 'rest'
  | 'acc'
  | 'let'
  | 'hit'
  | 'hit2'
  | 'block'
  | 'miss'
  | 'chk'
  | 'half'
  | 'rep'
  | 'fail'
  | 'ret'
  | 'rest2';
export interface Stage {
  id: StageId;
  name: string;
  /** 区間 [s] */
  t0: number;
  t1: number;
  desc: string;
}
export interface Strike {
  /** 弦に触れた時刻 [s]・そのときのハンマーの頭の速さ [m/s]・ジャックがナックルを押したままか */
  t: number;
  v: number;
  blocked: boolean;
}
export interface Events {
  move: number;
  letoff: number | null;
  strikes: Strike[];
  check: number | null;
  release: number;
  repress: number | null;
  reset: number | null;
  /** 弦に触れていた時間の合計 [s] */
  onString: number;
}

/** 接触 c の力が付いている（0.005 N より大きい）か */
const on = (R: Run, i: number, c: number) => fnAt(R, i, c) > 0.005;
const dip = (R: Run, i: number) => (R.q0[0] - R.q[i * 5]) * 0.2278;

export function events(R: Run): Events {
  const T = (i: number) => i * FRAME;
  let move = 0;
  for (let i = 0; i < R.n; i++)
    if (dip(R, i) > 2e-4) {
      move = T(i);
      break;
    }
  /* 力の山と、離した（山の 20 % を下回った）時刻 */
  let pk = 0,
    ipk = 0;
  for (let i = 0; i < R.n; i++)
    if (R.force[i] > pk) {
      pk = R.force[i];
      ipk = i;
    }
  let irel = R.n - 1;
  for (let i = ipk; i < R.n; i++)
    if (R.force[i] < pk * 0.2) {
      irel = i;
      break;
    }
  /* 押し直し: いったん山の 5 % を下回ってから、また上回った時刻 */
  let irep: number | null = null,
    low = false;
  for (let i = irel; i < R.n; i++) {
    if (R.force[i] < pk * 0.05) low = true;
    else if (low) {
      irep = i;
      break;
    }
  }
  const strikes: Strike[] = [];
  let onString = 0;
  for (let i = 1; i < R.n; i++) {
    const s = on(R, i, 12);
    if (s) onString += FRAME;
    if (s && !on(R, i - 1, 12)) {
      const a = Math.max(0, i - 3);
      strikes.push({ t: T(i), v: (gapAt(R, a) - gapAt(R, i)) / ((i - a) * FRAME), blocked: on(R, i, 7) });
    }
  }
  const first = (c: number, from: number, to = R.n) => {
    for (let i = from; i < to; i++) if (on(R, i, c)) return T(i);
    return null;
  };
  const im = Math.round(move / FRAME);
  const s0 = strikes.length ? Math.round(strikes[0].t / FRAME) : irel;
  let reset: number | null = null;
  if (irep === null)
    for (let i = irel; i < R.n; i++)
      if (dip(R, i) < 2e-4) {
        reset = T(i);
        break;
      }
  return {
    move,
    letoff: first(8, im, s0 + 1),
    strikes,
    check: first(4, s0),
    release: T(irel),
    repress: irep === null ? null : T(irep),
    reset,
    onString,
  };
}

const D: Record<StageId, string> = {
  rest: '鍵の前はフェルトから浮き、後ろはバックレールに載っている。ハンマーは、ナックルの下のジャックと、ハンマーレールに支えられている',
  acc: 'キャプスタンがウィッペンを押し上げ、ウィッペンの上のジャックがナックルを押してハンマーを回す。てこで、ハンマーの頭は鍵の前の約 5 倍の距離を動く',
  let: 'ジャックのつま先がレットオフボタンに当たり、ジャックが回ってナックルの下から抜ける。ハンマーはここから自分の勢いで弦まで飛ぶ',
  hit: 'ハンマーのフェルトが弦を打ち、弦から跳ね返る',
  hit2: '跳ね返ったハンマーがバックチェックに受け止められず、レペティションレバーの上で跳ねて、もう一度弦を打つ',
  block:
    'ジャックがナックルの下から抜ける前に、ハンマーが弦に着く。ジャックが押し続けるので、ハンマーは弦に押し付けられ、弦の振動を止めてしまう',
  miss: 'ジャックが抜けたあと、ハンマーの勢いが足りず、弦に届かないまま落ちる',
  chk: '落ちてきたハンマーの尾を、鍵の後ろのバックチェックが受け止める。ナックルはレペティションレバーに載り、ジャックはナックルの外にある',
  half: '鍵を半分ほど戻すと、バックチェックがハンマーを放し、レペティションレバーのばねがハンマーを持ち上げる。ジャックはナックルの下へ戻る',
  rep: '鍵が上がりきる前に押し直す。ジャックがナックルを押して、もう一度弦を打つ（ダブルエスケープメント）',
  fail: '押し直しても、ジャックがナックルの下へ戻っていないので、ハンマーは打てない',
  ret: '鍵が上がると、レペティションレバーがハンマーを持ち上げ、ジャックがナックルの下へ戻る。ハンマーはハンマーレールに下りる',
  rest2: '元の姿勢に戻る',
};
const NAME: Record<StageId, string> = {
  rest: '静止',
  acc: '加速',
  let: 'レットオフ',
  hit: '打弦',
  hit2: '2 度打ち',
  block: 'ブロッキング',
  miss: '空振り',
  chk: 'チェック',
  half: '鍵を戻す',
  rep: '連打',
  fail: '連打できない',
  ret: '戻り',
  rest2: '静止',
};

/** 段階の区間。どの段階も 0.3 ms 以上にする */
export function stages(R: Run, E: Events = events(R)): Stage[] {
  const end = (R.n - 1) * FRAME;
  const L: Stage[] = [];
  const push = (id: StageId, t0: number, t1: number) => {
    const a = Math.max(t0, L.length ? L[L.length - 1].t1 : 0);
    if (t1 - a < 3e-4) return;
    L.push({ id, name: NAME[id], t0: a, t1, desc: D[id] });
  };
  const s1 = E.strikes[0] ?? null;
  /* 1 回目の打鍵（連打なら、押し直すまで） */
  const cut = E.repress ?? end;
  push('rest', 0, E.move);
  if (!s1 || s1.t > cut) {
    /* 弦に届かない */
    const lo = E.letoff ?? E.release;
    push('acc', E.move, lo);
    if (E.letoff !== null) push('miss', lo, E.release);
  } else if (s1.blocked) {
    push('acc', E.move, s1.t);
    push('block', s1.t, E.release);
  } else {
    push('acc', E.move, E.letoff ?? s1.t);
    push('let', E.letoff ?? s1.t, s1.t);
    const again = E.strikes.find((s, k) => k > 0 && s.t < (E.check ?? E.release) + 0.03 && s.t < cut);
    const chk = E.check ?? E.release;
    if (again) {
      push('hit', s1.t, again.t);
      push('hit2', again.t, Math.max(chk, again.t + 0.003));
    } else push('hit', s1.t, chk);
    push('chk', chk, E.release);
  }
  if (E.repress !== null) {
    push('half', E.release, E.repress);
    const s2 = E.strikes.find((s) => s.t > (E.repress ?? end));
    push(s2 ? 'rep' : 'fail', E.repress, end);
  } else {
    push('ret', E.release, E.reset ?? end);
    if (E.reset !== null) push('rest2', E.reset, end);
  }
  return L;
}
export function stageAt(L: readonly Stage[], t: number): number {
  for (let i = 0; i < L.length; i++) if (t < L[i].t1) return i;
  return L.length - 1;
}

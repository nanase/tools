/**
 * カウンタと分周のページの計算。時刻 t は水晶の周期（1/32768 秒）を単位に数え、0 時 0 分 0 秒を 0 とする。
 * T フリップフロップは立ち上がりで反転し、反転出力を次の段のクロックへつなぐ。k 段目の出力は t の 2 進の k − 1 桁目になる
 */

/** 水晶の周波数 [Hz] */
export const F32 = 32768;
/** T フリップフロップの段の数 */
export const STAGES = 15;
/** 1 日の長さ（水晶の周期の数） */
export const DAY = 86400 * F32;
/** 波形を出す段の数 */
export const ROWS = 6;
/** 点滅を目で追える速さの上限 [回/秒]。これ以下の最も速い段から下の 6 段に波形を出す */
export const SEE_HZ = 16;

/** 速さの指数の範囲（速さは 2 の累乗） */
export const SP_MIN = -15;
export const SP_MAX = 12;

/** 段 k の周波数 [Hz]（k = 0 は水晶） */
export const stF = (k: number): number => F32 / 2 ** k;
/** 段 k の出力が反転する間隔（水晶の周期の数） */
export const halfT = (k: number): number => (k === 0 ? 0.5 : 2 ** (k - 1));

/** 段 k の時刻 t の出力。水晶は周期の前半を 1 とする */
export function qv(k: number, t: number): 0 | 1 {
  if (k === 0) return t - Math.floor(t) < 0.5 ? 1 : 0;
  const n = Math.floor(t / 2 ** (k - 1));
  return ((n % 2) + 2) % 2 === 1 ? 1 : 0;
}

/** (t0, t1] の間に段 k の出力が変わった回数 */
export const edges = (k: number, t0: number, t1: number): number =>
  Math.max(0, Math.floor(t1 / halfT(k)) - Math.floor(t0 / halfT(k)));

/** 波形を出す 6 段の先頭。点滅が 1 秒に 16 回以下の最も速い段で、15 段目が最後に入るよう 10 段目までにする */
export function winTop(sp: number): number {
  let k = 0;
  while (k < STAGES && stF(k) * sp > SEE_HZ) k++;
  return Math.min(k, STAGES + 1 - ROWS);
}

/** 時刻 t の 6 桁（時の 10 の位・1 の位・分・秒） */
export function digits(t: number): [number, number, number, number, number, number] {
  const sec = Math.floor(t / F32),
    hh = Math.floor(sec / 3600) % 24,
    mm = Math.floor(sec / 60) % 60,
    ss = sec % 60;
  return [Math.floor(hh / 10), hh % 10, Math.floor(mm / 10), mm % 10, Math.floor(ss / 10), ss % 10];
}

/** この 1 秒の中で何回目の水晶の振動か（1〜32768） */
export const inSecond = (t: number): number => Math.floor(t % F32) + 1;

/** 実際の時刻（ミリ秒を含む）を t にする */
export const fromDate = (d: Date): number =>
  ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds() + d.getMilliseconds() / 1000) * F32;

/** 23:59:59 の直前。今の速さで、あと sec 秒（実際の時間）で日付が変わる位置 */
export const beforeMidnight = (sp: number, sec = 3): number => Math.max(0, DAY - sec * F32 * sp);

/** 時刻を 1 日の中へ戻す */
export const wrapDay = (t: number): number => ((t % DAY) + DAY) % DAY;

/** 速さの表記（1/1024・×1・×8） */
export function fmtSpeed(sp: number): string {
  const e = Math.round(Math.log2(sp));
  return e < 0 ? `1/${2 ** -e}` : `×${2 ** e}`;
}

/** 周波数 [Hz] の表記。整数はそのまま、1 未満は有効数字 3 桁 */
export const fmtHz = (f: number): string =>
  Number.isInteger(f) ? String(f) : f >= 10 ? String(+f.toFixed(1)) : String(+f.toPrecision(3));

/** 時間の長さの表記（4 s・500 ms・250 µs） */
export function fmtDur(s: number): string {
  if (s >= 1) return `${+s.toPrecision(2)} s`;
  if (s >= 1e-3) return `${+(s * 1e3).toPrecision(2)} ms`;
  return `${+(s * 1e6).toPrecision(2)} µs`;
}

/** 波形の 1 周期に要る幅 [px]。これより細かい段は斜線の帯にする */
export const MIN_CYCLE_PX = 5;
/** 波形に見せる長さの候補 [実際の秒] */
const WINS = [4, 2, 1, 0.5] as const;
/**
 * 波形に見せる長さ [実際の秒]。先頭の段の 1 周期が MIN_CYCLE_PX 以上になる最も長い候補にする。
 * 波形は実際の時間で流れるので、見せる長さは時計の速さによらない
 */
export function winSec(sp: number, top: number, ww: number): number {
  const f = stF(top) * sp;
  for (const w of WINS) if (ww / (w * f) >= MIN_CYCLE_PX) return w;
  return WINS[WINS.length - 1];
}

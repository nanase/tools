/**
 * 計算（worklet.ts）が主スレッドへ送る値の大きさ（DOM に依存しない）。
 * worklet.ts は AudioWorklet の中でだけ動くので、主スレッドが使う定数はここに置く
 */

/** 1 周期を分ける数 */
export const PHASES = 24;
/** 音の波形に送る長さ [標本] */
export const SCOPE_N = 8192;

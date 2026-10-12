/**
 * 音の波形の切り出し（AudioWorklet と主スレッドで共有する値）: 燃焼の上死点をトリガにして、クランク角で
 * WAVE_DEG [°]（2 サイクル）を WAVE_NB 個に分け、区間ごとの音圧の最小と最大をとる
 */
export const WAVE_DEG = 1440;
export const WAVE_NB = 480;

/** 日の出と日の入りのページの選択肢 */

/** 時刻の表示: 地点の現地・日本時間・世界時 */
export const ZONES = [
  ['local', '現地'],
  ['jst', '日本時間'],
  ['ut', '世界時'],
] as const;
export type Disp = (typeof ZONES)[number][0];

/** 夏時間: 使わないと、現地の時刻をその年の標準時で数える */
export const DSTS = [
  ['on', '使う'],
  ['off', '使わない'],
] as const;
export type Dst = (typeof DSTS)[number][0];

/** 再生の速さ。day は時刻を保って 1 日ずつ進める */
export const SPEEDS = [
  ['real', '実時間'],
  ['hour', '1 時間/秒'],
  ['day', '10 日/秒'],
] as const;
export type Speed = (typeof SPEEDS)[number][0];

/** 時刻の操作の幅 [s]。日の倍数は現地の時刻を保ってずらす */
export const STEPS = [
  [600, '10 分'],
  [3600, '1 時間'],
  [86400, '1 日'],
  [259200, '3 日'],
] as const;

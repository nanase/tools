/** 画像の破損のページの入力の選択肢 [値, 表示, title] */

/** ファイルの画像の長い辺の上限（3 形式に符号化し直すので小さめに） */
export const MAX_SIDE = 640;

export const SAMPLE_CHOICES = [
  ['photo', '写真風', 'なめらかな面の多い絵'],
  ['illust', 'イラスト', '16 色の絵'],
  ['screen', '画面', '文字と平らな面'],
  ['chart', 'PNG 試験図', 'フィルタごとの段の図'],
  ['jpeg', 'JPEG 試験図', '階調と細かい模様の図'],
] as const;

export const PLACE_CHOICES = [
  ['data', 'データ', '画素のデータの中'],
  ['width', '幅', '幅の値の書き換え'],
  ['height', '高さ', '高さの値の書き換え'],
  ['color', '色の情報', 'PNG: IHDR の色の型、JPEG: DQT、GIF: 色表'],
  ['table', '符号の表', 'PNG: Deflate の先頭、JPEG: DHT、GIF: 最小符号長'],
] as const;

export const OP_CHOICES = [
  ['flip', 'ビット反転', '1 ビットの反転'],
  ['set', '書き換え', '1 バイトを乱数へ書き換え'],
  ['del', '削除', '1 バイトの削除'],
  ['ins', '挿入', '1 バイトの挿入'],
  ['cut', '切断', 'その位置から後ろの切り捨て'],
] as const;

export const COUNT_CHOICES = [
  [1, '1 か所'],
  [8, '8 か所'],
  [64, '64 か所'],
] as const;

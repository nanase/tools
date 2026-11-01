/** GIF のページの入力の選択肢 [値, 表示, title] */

/** 減色して符号化する画像の長い辺の上限 */
export const MAX_SIDE = 512;

export const SAMPLE_CHOICES = [
  ['sprite', 'ドット絵', '16×16・5 色と透過色。1 符号ずつ追える大きさ'],
  ['stripes', '縞', '同じ模様の繰り返し。辞書の列が長く育つ'],
  ['soft', '写真風', '色が多い。減色と誤差拡散の差が出る'],
] as const;

export const COLOR_CHOICES = [
  [2, '2'],
  [4, '4'],
  [16, '16'],
  [64, '64'],
  [256, '256'],
] as const;

export const DITHER_CHOICES = [
  ['0', 'なし', '最も近い色に置き換える'],
  ['1', '誤差拡散', 'Floyd–Steinberg。階調は滑らかになるが、同じ並びが減る'],
] as const;

/** 工程の帯の項目（処理の順） */
export const CHAPTERS = [
  ['pal', 'パレット'],
  ['il', 'インターレース'],
  ['lzw', 'LZW'],
  ['file', 'ファイル'],
] as const;

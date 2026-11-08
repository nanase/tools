/** 正規表現のページの入力の定義（再生の速さ）。破滅的バックトラックを最後まで見られるよう 1000 回/秒まで */
import type { ParamDef } from '../../lib/param-def';

export type Key = 'sp';

const plain = { input: String, view: String, step: String, text: String };

export const SPEED: ParamDef & { k: Key } = {
  k: 'sp',
  nm: '速さ',
  sym: '',
  name: '速さ',
  sub: '',
  unit: '回/秒',
  min: 1,
  max: 1000,
  v: 5,
  ph: '例 5',
  list: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
  log: true,
  snap: true,
  notation: 'plain',
  format: plain,
  pre: [
    [5, '5'],
    [100, '100'],
    [1000, '1000'],
  ],
};

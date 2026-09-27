import type { ParamDef } from '../../lib/param-def';

/** 手動のときの搬送波の周波数（JJY シミュレータの可聴音の周波数と同じ範囲・プリセット） */
export const F_PARAM: ParamDef & { k: 'f' } = {
  k: 'f',
  nm: '搬送波の',
  sym: '',
  name: '周波数',
  sub: '手動のときの搬送波',
  unit: 'Hz',
  min: 20,
  max: 24000,
  v: 440,
  series: 12,
  ph: '例 1k',
  bad: '読めない値です（例 440・1k・1k5・1e3）',
  pre: [
    [100, '100'],
    [440, '440'],
    [1e3, '1k'],
    [2e3, '2k'],
    [4e3, '4k'],
    [1e4, '10k'],
  ],
  tk: [
    [20, '20'],
    [100, '100'],
    [1e3, '1k'],
    [1e4, '10k'],
  ],
};

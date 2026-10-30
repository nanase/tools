/**
 * ウェーブレット変換のページの入口: 時間と周波数の平面（STFT と DWT の箱）・分解を段ごとに・多重解像度の成分・
 * 係数を捨てて戻す・スカログラム・音のスカログラム。枠ごとに入力を持ち、ほかの枠とは値を共有しない
 */
import { initToolPage } from '../../lib/tool-page';
import { initAudio } from './audio';
import { txt } from './fig';
import { initPlane } from './plane-view';
import { initMra, initScalo, initShrink, initSteps } from './views';

initToolPage();
initPlane((s) => txt('#m-box', s));
initSteps((s) => txt('#m-lev', s));
initMra();
initShrink((s) => txt('#m-snr', s));
initScalo();
initAudio();

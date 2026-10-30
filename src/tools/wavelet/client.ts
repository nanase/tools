/**
 * ウェーブレット変換のページの入口: 1 フーリエ変換では「いつ」が消える・2 短い波を重ねて掛けて足す・
 * 3 時間と周波数の平面（STFT と DWT の箱）・4 隣り合う 2 つの平均と差・5 分解を段ごとに。枠ごとに入力を持ち、ほかの枠とは値を共有しない
 */
import { initToolPage } from '../../lib/tool-page';
import { initPlane } from './plane-view';
import { initHaar8, initOrder, initSlide } from './principle-view';
import { initSteps } from './views';

initToolPage();
initOrder();
initSlide();
initPlane();
initHaar8();
initSteps();

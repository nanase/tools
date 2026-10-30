/**
 * ウェーブレット変換のページの入口: 1 フーリエでは「いつ」が消える・2 短い波を当てて掛けて足す・
 * 3 時間と周波数の平面（STFT と DWT の箱）・4 2 つずつ平均と差・5 分解を段ごとに。枠ごとに入力を持ち、ほかの枠とは値を共有しない
 */
import { initToolPage } from '../../lib/tool-page';
import { txt } from './fig';
import { initPlane } from './plane-view';
import { initHaar8, initOrder, initSlide } from './principle-view';
import { initSteps } from './views';

initToolPage();
initOrder();
initSlide((s) => txt('#m-pr', s));
initPlane((s) => txt('#m-box', s));
initHaar8();
initSteps((s) => txt('#m-lev', s));

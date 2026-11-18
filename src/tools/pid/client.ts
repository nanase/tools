/** PID 制御のページの入口: 入力 → 川の枠（live.ts）・ブロック図・代入式 */
import { $ } from '../../lib/dom';
import { fmt, plain } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { Live } from './live';
import { DT, type In, TUNE_OS, TUNE_VMAX, tune } from './model';
import { type Key, PARAMS } from './params';

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
/** MathML の量。計算した値（keep）は末尾の 0 を残す */
const qty = (v: number, u = '', keep = false) =>
  `<mn>${plain(v, 4, keep)}</mn>${u ? `<mspace width="0.17em"/><mi mathvariant="normal">${u}</mi>` : ''}`;
const msub = (a: string, b: string) => `<msub><mi>${a}</mi><mi mathvariant="normal">${b}</mi></msub>`;
const DOT = '<mo>&#x22C5;</mo>';
const DTM = '<mi mathvariant="normal">Δ</mi><mi>t</mi>';
const E0 = '<msub><mi>e</mi><mn>0</mn></msub>';

initToolPage();

/** ブロック図の値と、動作原理と式の代入した最初のステップ */
function render(v: In): void {
  const { kp, ki, kd, x0, r, w, al } = v;
  txt('#bd-r', fmt(r, 'm', 4));
  txt('#bd-w', fmt(w, 'm/s', 4));
  txt('#bd-a', `α ${plain(al, 3)}`);
  txt('#bd-c', `${plain(v.c ?? 0, 3)} 1/s`);

  /* 最初のステップ（e₋₁ = 0、積分は e₀Δt） */
  const e0 = r - x0,
    u0 = kp * e0 + ki * e0 * DT + (kd * e0) / DT;
  html(
    '#subst',
    `<math display="block">${E0}<mo>=</mo><mi>r</mi><mo>−</mo><msub><mi>x</mi><mn>0</mn></msub><mo>=</mo>${qty(r, 'm')}<mo>−</mo><mrow><mo>(</mo>${qty(x0, 'm')}<mo>)</mo></mrow><mo>=</mo>${qty(e0, 'm', true)}</math>` +
      `<math display="block"><msub><mi>u</mi><mn>0</mn></msub><mo>=</mo>${msub('K', 'P')}${E0}<mo>+</mo>${msub('K', 'I')}${E0}${DTM}<mo>+</mo>${msub('K', 'D')}<mfrac>${E0}<mrow>${DTM}</mrow></mfrac></math>` +
      `<math display="block"><mphantom><msub><mi>u</mi><mn>0</mn></msub></mphantom><mo>=</mo>${qty(kp)}${DOT}${qty(e0, '', true)}<mo>+</mo>${qty(ki)}${DOT}${qty(e0, '', true)}${DOT}<mn>0.1</mn><mo>+</mo>${qty(kd)}${DOT}<mfrac>${qty(e0, '', true)}<mn>0.1</mn></mfrac><mo>&#x2248;</mo>${qty(u0, '', true)}</math>`,
  );
}

let live: Live | null = null;
const P = new ParamGroup<Key>(PARAMS, (v, k) => {
  render(v);
  if (live) live.update(v, k);
  else {
    live = new Live(v);
    /* ブイを動かしたら目標位置の入力へ戻す */
    live.onTarget = (r) => P.set('r', r);
    live.onMeas = (ts, os, e) => {
      txt('#mts', ts);
      txt('#mos', os);
      txt('#mee', e);
    };
  }
});
/* 自動調整: 今の制御対象と初期・目標位置で、条件の中で ITAE が最小のゲインにする */
const tuneBtn = $<HTMLButtonElement>('#autoTune');
tuneBtn.addEventListener('click', () => {
  const v = P.values();
  if (v.x0 === v.r) {
    P.note('kp', '初期位置と目標位置が同じため、調整できません。', 'er');
    return;
  }
  tuneBtn.disabled = true;
  txt('#autoTune', '調整中…');
  /* 文言を描いてから計算する（0.1〜0.5 秒ほど） */
  setTimeout(() => {
    const g = tune(v);
    tuneBtn.disabled = false;
    txt('#autoTune', '自動調整');
    if (!g) {
      P.note('kp', '100 s 以内に整定するゲインが見つかりませんでした。', 'er');
      return;
    }
    P.set('kp', g.kp);
    P.set('ki', g.ki);
    P.set('kd', g.kd);
    if (!g.ok)
      P.note(
        'kp',
        `行き過ぎ ${TUNE_OS} % 以下・速さ ${TUNE_VMAX} m/s 以下にできる値がないため、超える分が最も小さい値にしました。`,
      );
  }, 30);
});
/* 保存した値を戻したあと（マイクロタスク）に動かし始める */
queueMicrotask(() => live?.start());

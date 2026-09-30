/** PID 制御のページの入口: 入力 → シミュレーション → 結果・応答・ブロック図・代入式 */
import { $ } from '../../lib/dom';
import { fmt, plain, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { DV, SW } from '../../lib/scope';
import { initToolPage } from '../../lib/tool-page';
import { DT, type In, metrics, ROWS, simulate, trace } from './model';
import { type Key, PARAMS } from './params';

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
/** 発散したときの大きな値は指数表記にする */
const big = (v: number, u: string, sig?: number): string =>
  Math.abs(v) >= 1e12 ? `${v < 0 ? '−' : ''}${Math.abs(v).toExponential(2).replace('e+', 'e')} ${u}` : fmt(v, u, sig);
const tsub = (s: string) => `<tspan dy="2" font-size="0.75em">${s}</tspan>`;
const qty = (v: number, u = '') =>
  `<mn>${plain(v, 4)}</mn>${u ? `<mspace width="0.17em"/><mi mathvariant="normal">${u}</mi>` : ''}`;
const msub = (a: string, b: string) => `<msub><mi>${a}</mi><mi mathvariant="normal">${b}</mi></msub>`;
const DOT = '<mo>&#x22C5;</mo>';
const DTM = '<mi mathvariant="normal">Δ</mi><mi>t</mi>';
const E0 = '<msub><mi>e</mi><mn>0</mn></msub>';
const DASH = '—';

initToolPage();
/** 応答の表示窓の高さ */
const PH = ROWS * DV;

/** 応答の表示窓に描く。ref は基準線（目標など） */
function scope(id: string, data: ArrayLike<number>, ref: number, unit: string, ch: 1 | 2, refLabel: string) {
  const t = trace(data, ref, ROWS);
  $(`#${id}-tr`).setAttribute('d', t.d);
  const yr = +t.Y(ref);
  $(`#${id}-rl`).setAttribute('d', `M0 ${yr}H${SW}`);
  const rt = $(`#${id}-rt`);
  rt.setAttribute('y', String(yr < 22 ? yr + 15 : yr - 6));
  rt.innerHTML = refLabel;
  let a = '';
  for (let i = 0; i <= 10; i += 2)
    a += `<text x="${i * DV}" y="${PH + 17}" text-anchor="middle">${i ? `${i * 10} s` : '0'}</text>`;
  for (let j = 0; j <= ROWS; j++) {
    const v = (j - t.k) * t.vd;
    a += `<text x="-10" y="${PH - j * DV + 4}" text-anchor="end">${v ? big(v, unit, 3) : '0'}</text>`;
  }
  a += `<path class="mk${ch}" d="M-8 ${t.y0 - 5}L-1 ${t.y0}L-8 ${t.y0 + 5}Z"/><path class="mk${ch}" d="M-5 -12L5 -12L0 -5Z"/>`;
  $(`#${id}-ax`).innerHTML = a;
  txt(`#${id}-vd`, big(t.vd, unit, 3));
  return t;
}

function render(v: In): void {
  const { kp, ki, kd, x0, r, w, al } = v;
  const S = simulate(v),
    M = metrics(S, x0, r);

  html('#o-ts', M.ts == null ? DASH : ro(M.ts, 's'));
  txt(
    '#o-tsn',
    M.div
      ? '発散しました（|x| か |v| が 10⁶ を超えました）'
      : M.flat
        ? '目標位置が初期位置と同じです'
        : M.ts == null
          ? '100 s 以内に ±2 % の範囲へ収まりません'
          : '',
  );
  html('#o-tr', M.tr == null ? DASH : ro(M.tr, 's'));
  const os = M.os == null ? '' : M.os >= 1e5 ? M.os.toExponential(2).replace('e+', 'e') : M.os.toFixed(1);
  html('#o-os', M.os == null ? DASH : `${os}<span class="u">%</span>`);
  html('#o-tp', M.tp == null ? DASH : ro(M.tp, 's'));
  html('#o-ee', ro(M.ee, 'm'));
  html('#o-iae', `${plain(M.iae, 4)}<span class="u">m·s</span>`);
  html('#o-vm', ro(M.vm, 'm/s'));
  txt('#mts', M.ts == null ? DASH : fmt(M.ts, 's'));
  txt('#mos', M.os == null ? DASH : `${M.os.toFixed(1)} %`);
  txt('#mee', fmt(M.ee, 'm'));

  const sp = scope('sp', S.X, r, 'm', 1, 'r');
  const tl = $('#sp-tl'),
    tt = $('#sp-tt');
  if (M.ts != null && M.ts > 0) {
    const xs = +sp.X(M.ts);
    tl.setAttribute('d', `M${xs} 0V${PH}`);
    tt.setAttribute('x', String(xs > 340 ? xs - 5 : xs + 5));
    tt.setAttribute('text-anchor', xs > 340 ? 'end' : 'start');
    tt.innerHTML = `t${tsub('s')}`;
    tl.removeAttribute('hidden');
    tt.removeAttribute('hidden');
  } else {
    tl.setAttribute('hidden', '');
    tt.setAttribute('hidden', '');
  }
  const sv = scope('sv', S.V, -w, 'm/s', 2, '−w');
  txt('#sp-ref', fmt(r, 'm', 4));
  txt('#sv-ref', fmt(-w, 'm/s', 4));
  $('#sp-dv').hidden = $('#sv-dv').hidden = !M.div;
  $('#sp-svg').setAttribute(
    'aria-label',
    `位置の応答。${fmt(x0, 'm')} から目標 ${fmt(r, 'm')} へ。縦軸 ${big(sp.vd, 'm', 3)}/div、横軸 10 s/div。${M.ts != null ? `整定時間 ${fmt(M.ts, 's')}。` : ''}`,
  );
  $('#sv-svg').setAttribute(
    'aria-label',
    `速度の応答。最大 ${fmt(M.vm, 'm/s')}。縦軸 ${big(sv.vd, 'm/s', 3)}/div、横軸 10 s/div。`,
  );

  txt('#bd-r', fmt(r, 'm', 4));
  txt('#bd-w', fmt(w, 'm/s', 4));
  txt('#bd-a', `α ${plain(al, 3)}`);

  /* 最初のステップ（e₋₁ = 0、積分は e₀Δt） */
  const e0 = r - x0,
    u0 = kp * e0 + ki * e0 * DT + (kd * e0) / DT;
  html(
    '#subst',
    `<math display="block">${E0}<mo>=</mo><mi>r</mi><mo>−</mo><msub><mi>x</mi><mn>0</mn></msub><mo>=</mo>${qty(r, 'm')}<mo>−</mo><mrow><mo>(</mo>${qty(x0, 'm')}<mo>)</mo></mrow><mo>=</mo>${qty(e0, 'm')}</math>` +
      `<math display="block"><msub><mi>u</mi><mn>0</mn></msub><mo>=</mo>${msub('K', 'P')}${E0}<mo>+</mo>${msub('K', 'I')}${E0}${DTM}<mo>+</mo>${msub('K', 'D')}<mfrac>${E0}<mrow>${DTM}</mrow></mfrac></math>` +
      `<math display="block"><mphantom><msub><mi>u</mi><mn>0</mn></msub></mphantom><mo>=</mo>${qty(kp)}${DOT}${qty(e0)}<mo>+</mo>${qty(ki)}${DOT}${qty(e0)}${DOT}<mn>0.1</mn><mo>+</mo>${qty(kd)}${DOT}<mfrac>${qty(e0)}<mn>0.1</mn></mfrac><mo>&#x2248;</mo>${qty(u0)}</math>`,
  );
}

new ParamGroup<Key>(PARAMS, render);

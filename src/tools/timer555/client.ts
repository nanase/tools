/** 555 ページの入口: 入力 → 計算 → 結果・波形・回路図・代入式 */
import { $ } from '../../lib/dom';
import { fmt, mqty, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { ScopeView, SW } from '../../lib/scope';
import { initToolPage } from '../../lib/tool-page';
import { type In, solve, wave } from './model';
import { type Key, PARAMS } from './params';

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
const MDOT = '<mo>&#x22C5;</mo>';
initToolPage();

const scope = new ScopeView($('#wave'));

function render(v: In): void {
  const { r1, r2, c1, vcc } = v,
    o = solve(v);
  html('#o-f', ro(o.f, 'Hz'));
  html('#o-tH', ro(o.tH, 's'));
  html('#o-tL', ro(o.tL, 's'));
  html('#o-T', ro(o.T, 's'));
  html('#o-D', `${o.D.toFixed(2)}<span class="u">%</span>`);
  html('#o-I', ro(o.I, 'A'));
  html('#o-P', ro(o.P, 'W'));
  txt('#o-Pn', o.P > 0.25 ? '1/4 W 抵抗の定格を超えます' : '');
  txt('#mf', fmt(o.f, 'Hz'));
  txt('#md', `${o.D.toFixed(1)} %`);
  txt('#mT', fmt(o.T, 's'));
  txt('#s-vcc', fmt(vcc, 'V', 3));
  txt('#s-r1', fmt(r1, 'Ω', 3));
  txt('#s-r2', fmt(r2, 'Ω', 3));
  txt('#s-c1', fmt(c1, 'F', 3));

  const R1 = mqty(r1, 'Ω'),
    R2 = mqty(r2, 'Ω');
  html(
    '#subst',
    `<math display="block"><mi>f</mi><mo>=</mo><mfrac><mn>1</mn><mrow><mi>ln</mi><mo>&#x2061;</mo><mn>2</mn>${MDOT}<mrow><mo>(</mo>${R1}<mo>+</mo><mn>2</mn>${MDOT}${R2}<mo>)</mo></mrow>${MDOT}${mqty(c1, 'F')}</mrow></mfrac></math>` +
      `<math display="block"><mphantom><mi>f</mi></mphantom><mo>&#x2248;</mo>${mqty(o.f, 'Hz')}</math>` +
      `<math display="block"><mi>D</mi><mo>=</mo><mfrac><mrow>${R1}<mo>+</mo>${R2}</mrow><mrow>${R1}<mo>+</mo><mn>2</mn>${MDOT}${R2}</mrow></mfrac><mo>&#xD7;</mo><mn>100</mn><mspace width="0.2em"/><mi mathvariant="normal">%</mi></math>` +
      `<math display="block"><mphantom><mi>D</mi></mphantom><mo>&#x2248;</mo><mn>${o.D.toFixed(2)}</mn><mspace width="0.2em"/><mi mathvariant="normal">%</mi></math>`,
  );

  const w = wave(v, o);
  $('#thr-l').setAttribute('d', `M0 ${w.y1}H${SW}M0 ${w.y2}H${SW}`);
  const t1 = $('#thr-t1'),
    t2 = $('#thr-t2'),
    cc = '<tspan dy="2" font-size="0.75em">CC</tspan>';
  t1.setAttribute('y', String(w.y1 + 15));
  t1.innerHTML = `1/3 V${cc}`;
  t2.setAttribute('y', String(w.y2 - 6));
  t2.innerHTML = `2/3 V${cc}`;
  scope.draw({
    td: w.td,
    vd: w.vd,
    trig: vcc / 2,
    ch1: w.ch1,
    ch2: w.ch2,
    label: `出力波形。周期 ${fmt(o.T, 's')}、H ${fmt(o.tH, 's')}、L ${fmt(o.tL, 's')}、振幅 ${fmt(vcc, 'V')}。横軸 ${fmt(w.td, 's', 3)}/div、縦軸 ${fmt(w.vd, 'V', 3)}/div。`,
  });
}

new ParamGroup<Key>(PARAMS, render, $('#eser'));

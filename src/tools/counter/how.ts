/** カウンタと分周のしくみの札: [見出し, 小さな図（SVG）, 一言] */
const rd = (v: number): number => Math.round(v * 10) / 10;
const fig = (s: string): string => `<svg class="ct-mini" viewBox="0 0 120 64" aria-hidden="true">${s}</svg>`;

/** 小さな矩形波。x0〜x1、上 yh・下 yl、周期 p [px]、位相 ph [px] */
function sq(x0: number, x1: number, yh: number, yl: number, p: number, ph = 0, cls = 'hw on'): string {
  const half = p / 2;
  let d = `M${x0} ${yh}`,
    v = 1,
    nx = x0 + (half - (ph % half));
  while (nx < x1) {
    d += `H${rd(nx)}V${v ? yl : yh}`;
    v ^= 1;
    nx += half;
  }
  return `<path class="${cls}" d="${d}H${x1}"/>`;
}
/** 矢じり（先端 x, y・向き a） */
function ah(x: number, y: number, a: number, cls: string, s = 6): string {
  const c = Math.cos(a),
    n = Math.sin(a),
    bx = x - c * s,
    by = y - n * s;
  return `<path class="${cls}" d="M${rd(x)} ${rd(y)}L${rd(bx - n * s * 0.5)} ${rd(by + c * s * 0.5)}L${rd(bx + n * s * 0.5)} ${rd(by - c * s * 0.5)}Z"/>`;
}

export const HOW: readonly (readonly [string, string, string])[] = [
  [
    '水晶の 32768 Hz',
    fig(
      '<path class="hw" d="M44 10V44M76 10V44"/><rect class="hx" x="52" y="14" width="16" height="26"/><text class="ht" x="60" y="60" text-anchor="middle">32768 = 2<tspan dy="-5" font-size="8">15</tspan></text>',
    ),
    '2 を 15 回掛けた数',
  ],
  [
    'T フリップフロップ',
    fig(
      `${sq(8, 112, 10, 24, 16, 8, 'hw in')}${sq(8, 112, 38, 52, 32, 16)}<path class="hg" d="M16 6V58M32 6V58M48 6V58M64 6V58M80 6V58M96 6V58"/>`,
    ),
    '入力の立ち上がりのたびに出力が反転',
  ],
  [
    '15 段で 1 Hz',
    fig(
      `${sq(8, 112, 6, 14, 4, 0, 'hw in')}${sq(8, 112, 24, 32, 16, 4)}${sq(8, 82, 42, 50, 64, 16)}<text class="ht" x="112" y="50" text-anchor="end">1 Hz</text>`,
    ),
    '1 段ごとに周波数が半分',
  ],
  [
    '10 進と 6 進',
    fig(
      `<text class="ht" x="14" y="30">0 1 2 … 9</text><path class="hw on" d="M96 34Q104 50 60 50Q16 50 20 40"/>${ah(20, 37, -Math.PI / 2, 'ha on')}<text class="ht" x="106" y="30" text-anchor="end">→ 0</text>`,
    ),
    '0〜9 と 0〜5 をくり返して桁上げ',
  ],
  [
    '24 で 0 に戻す',
    fig(
      `<text class="ht" x="60" y="24" text-anchor="middle">23:59:59</text><path class="hw" d="M60 30V38"/>${ah(60, 43, Math.PI / 2, 'ha')}<text class="ht on" x="60" y="58" text-anchor="middle">00:00:00</text>`,
    ),
    '23:59:59 の次は 00:00:00',
  ],
];

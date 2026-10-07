/** 動作原理と式の MathML（固定の式はビルド時に、代入した式はブラウザで組み立てる） */

export const mi = (x: string, up?: boolean): string => `<mi${up ? ' mathvariant="normal"' : ''}>${x}</mi>`;
export const mn = (x: string | number): string => `<mn>${String(x).replace(/^-/, '−')}</mn>`;
export const mo = (x: string): string => `<mo>${x}</mo>`;
export const sub = (b: string, x: string): string => `<msub>${b}${x}</msub>`;
export const sup = (b: string, x: string): string => `<msup>${b}${x}</msup>`;
export const frac = (a: string, b: string): string => `<mfrac>${a}${b}</mfrac>`;
export const row = (...a: string[]): string => `<mrow>${a.join('')}</mrow>`;
export const par = (x: string): string => `<mrow><mo>(</mo>${x}<mo>)</mo></mrow>`;
export const blk = (x: string): string => `<math display="block">${x}</math>`;
export const inl = (x: string): string => `<math>${x}</math>`;
const floor = (x: string): string => `<mrow><mo>⌊</mo>${x}<mo>⌋</mo></mrow>`;
const sum = (i: string, a: string, b: string): string =>
  `<munderover><mo>∑</mo><mrow>${i}<mo>=</mo>${a}</mrow>${b}</munderover>`;

const EQ = mo('='),
  PL = mo('+'),
  MI = mo('−'),
  DOT = '<mo>&#x22C5;</mo>',
  CM = '<mo>,</mo><mspace width="1em"/>',
  F = mi('F'),
  u = mi('u'),
  v = mi('v'),
  x = mi('x'),
  y = mi('y'),
  Q = mi('Q'),
  q = mi('q'),
  s = mi('s'),
  pi = mi('π');
const uv = par(row(u, mo(','), v)),
  xy = par(row(x, mo(','), y)),
  Fuv = row(F, uv),
  fxy = row(mi('f'), xy),
  Quv = row(Q, uv),
  Cu = row(mi('C'), par(u)),
  Cv = row(mi('C'), par(v)),
  Sq = row(sub(mi('S'), mi('q')), uv),
  QK = row(sub(Q, mi('K', true)), uv);
const cosT = (a: string, b: string) =>
  row('<mi>cos</mi><mo>&#x2061;</mo>', frac(row(par(row(mn(2), a, PL, mn(1))), b, pi), mn(16)));

/** 固定の式 */
export const EQS =
  blk(row(mi('Y'), EQ, mn('0.299'), mi('R'), PL, mn('0.587'), mi('G'), PL, mn('0.114'), mi('B'))) +
  blk(
    row(
      sub(mi('C'), mi('b')),
      EQ,
      MI,
      mn('0.1687'),
      mi('R'),
      MI,
      mn('0.3313'),
      mi('G'),
      PL,
      mn('0.5'),
      mi('B'),
      PL,
      mn(128),
      CM,
      sub(mi('C'), mi('r')),
      EQ,
      mn('0.5'),
      mi('R'),
      MI,
      mn('0.4187'),
      mi('G'),
      MI,
      mn('0.0813'),
      mi('B'),
      PL,
      mn(128),
    ),
  ) +
  blk(
    row(
      Fuv,
      EQ,
      frac(mn(1), mn(4)),
      Cu,
      Cv,
      sum(x, mn(0), mn(7)),
      sum(y, mn(0), mn(7)),
      par(row(fxy, MI, mn(128))),
      cosT(x, u),
      cosT(y, v),
    ),
  ) +
  blk(
    row(
      Cu,
      EQ,
      frac(mn(1), `<msqrt>${mn(2)}</msqrt>`),
      mspace(),
      par(row(u, EQ, mn(0))),
      CM,
      Cu,
      EQ,
      mn(1),
      mspace(),
      par(row(u, mo('&gt;'), mn(0))),
    ),
  ) +
  blk(
    row(
      fxy,
      EQ,
      frac(mn(1), mn(4)),
      sum(u, mn(0), mn(7)),
      sum(v, mn(0), mn(7)),
      Cu,
      Cv,
      Fuv,
      cosT(x, u),
      cosT(y, v),
      PL,
      mn(128),
    ),
  ) +
  blk(
    row(Sq, EQ, row('<mi>round</mi><mo>&#x2061;</mo>', par(frac(Fuv, Quv))), CM, row(mi('R'), uv), EQ, Sq, DOT, Quv),
  ) +
  blk(
    row(
      s,
      EQ,
      `<mrow><mo>{</mo><mtable columnalign="left"><mtr><mtd>${row(frac(mn(5000), q))}</mtd><mtd>${row(par(row(q, mo('&lt;'), mn(50))))}</mtd></mtr><mtr><mtd>${row(mn(200), MI, mn(2), q)}</mtd><mtd>${row(par(row(q, mo('≥'), mn(50))))}</mtd></mtr></mtable></mrow>`,
      CM,
      Quv,
      EQ,
      row(
        '<mi>min</mi><mo>&#x2061;</mo>',
        par(
          row(
            mn(255),
            mo(','),
            '<mi>max</mi><mo>&#x2061;</mo>',
            par(row(mn(1), mo(','), floor(frac(row(QK, DOT, s, PL, mn(50)), mn(100))))),
          ),
        ),
      ),
    ),
  ) +
  blk(
    row(
      sub(mi('DIFF', true), mi('i')),
      EQ,
      sub(mi('DC', true), mi('i')),
      MI,
      sub(mi('DC', true), row(mi('i'), MI, mn(1))),
      CM,
      mi('SSSS', true),
      EQ,
      row(
        '<mo>⌈</mo>',
        sub('<mi>log</mi>', mn(2)),
        '<mo>&#x2061;</mo>',
        par(row(row(mo('|'), mi('DIFF', true), mo('|')), PL, mn(1))),
        '<mo>⌉</mo>',
      ),
    ),
  ) +
  blk(
    row(
      mi('PSNR', true),
      EQ,
      mn(10),
      sub('<mi>log</mi>', mn(10)),
      '<mo>&#x2061;</mo>',
      frac(sup(mn(255), mn(2)), mi('MSE', true)),
      mspace(),
      mi('dB', true),
    ),
  );

function mspace(): string {
  return '<mspace width="0.5em"/>';
}

/** 代入した式: 品質から倍率と、量子化テーブルの左上の値（base は基準の表の値、out は 1〜255 に収めた値） */
export function substHtml(qv: number, sv: number, base: number, out: number): string {
  const sRow =
    qv < 50 ? row(s, EQ, frac(mn(5000), mn(qv)), EQ, mn(sv)) : row(s, EQ, mn(200), MI, mn(2), DOT, mn(qv), EQ, mn(sv));
  const raw = Math.floor((base * sv + 50) / 100);
  return (
    blk(sRow) +
    blk(
      row(
        row(Q, par(row(mn(0), mo(','), mn(0)))),
        EQ,
        floor(frac(row(mn(base), DOT, mn(sv), PL, mn(50)), mn(100))),
        EQ,
        mn(raw),
        ...(raw !== out ? [mo('→'), mn(out)] : []),
      ),
    )
  );
}

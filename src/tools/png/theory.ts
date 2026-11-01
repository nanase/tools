/** 動作原理と式の MathML（ビルド時に組み立てる） */
import { blk, mi, mn, mo, par, row, sub } from '../jpeg/theory';

const EQ = mo('='),
  PL = mo('+'),
  MI = mo('−'),
  CM = '<mo>,</mo><mspace width="1em"/>',
  x = mi('x'),
  a = mi('a'),
  b = mi('b'),
  c = mi('c'),
  r = mi('r'),
  p = mi('p'),
  abs = (v: string): string => row(mo('|'), v, mo('|')),
  floor = (v: string): string => row(mo('⌊'), v, mo('⌋')),
  mod = (v: string, m: string): string => row(v, '<mo lspace="0.5em" rspace="0.5em">mod</mo>', m),
  sum = (i: string, e: string): string => row(`<munder><mo>∑</mo>${i}</munder>`, e);

export const EQS = {
  filter: [
    blk(row(sub(r, mi('Sub', true)), EQ, mod(par(row(x, MI, a)), mn(256)))),
    blk(row(sub(r, mi('Up', true)), EQ, mod(par(row(x, MI, b)), mn(256)))),
    blk(
      row(
        sub(r, mi('Average', true)),
        EQ,
        mod(par(row(x, MI, floor(row(par(row(a, PL, b)), mo('/'), mn(2))))), mn(256)),
      ),
    ),
  ].join(''),
  paeth: [
    blk(
      row(
        p,
        EQ,
        a,
        PL,
        b,
        MI,
        c,
        CM,
        sub(p, a),
        EQ,
        abs(row(p, MI, a)),
        CM,
        sub(p, b),
        EQ,
        abs(row(p, MI, b)),
        CM,
        sub(p, c),
        EQ,
        abs(row(p, MI, c)),
      ),
    ),
    blk(
      row(
        sub(r, mi('Paeth', true)),
        EQ,
        mod(
          par(
            row(
              x,
              MI,
              row(
                mo('{'),
                `<mtable columnalign="left"><mtr><mtd>${row(a, CM, mi('if', true), '<mspace width="0.4em"/>', sub(p, a), mo('≤'), sub(p, b), mo('∧'), sub(p, a), mo('≤'), sub(p, c))}</mtd></mtr><mtr><mtd>${row(b, CM, mi('if', true), '<mspace width="0.4em"/>', sub(p, b), mo('≤'), sub(p, c))}</mtd></mtr><mtr><mtd>${row(c, CM, mi('otherwise', true))}</mtd></mtr></mtable>`,
              ),
            ),
          ),
          mn(256),
        ),
      ),
    ),
  ].join(''),
  adaptive: blk(
    row(
      mi('t'),
      EQ,
      row('<munder><mi mathvariant="normal">arg min</mi><mi>t</mi></munder>'),
      sum(mi('i'), abs(sub(mi('s'), row(mi('t'), mo(','), mi('i'))))),
      CM,
      sub(mi('s'), row(mi('t'), mo(','), mi('i'))),
      mo('∈'),
      row(mo('['), MI, mn(128), mo(','), mn(127), mo(']')),
    ),
  ),
  adler: [
    blk(
      row(
        mi('A'),
        EQ,
        mod(par(row(mn(1), PL, sum(mi('i'), sub(mi('D'), mi('i'))))), mn(65521)),
        CM,
        mi('B'),
        EQ,
        mod(par(sum(mi('i'), sub(mi('A'), mi('i')))), mn(65521)),
      ),
    ),
    blk(row(mi('Adler-32', true), EQ, mi('B'), mo('×'), mn(65536), PL, mi('A'))),
  ].join(''),
  crc: blk(
    row(
      mi('G'),
      par(mi('x')),
      EQ,
      row(
        '<msup><mi>x</mi><mn>32</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>26</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>23</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>22</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>16</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>12</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>11</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>10</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>8</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>7</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>5</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>4</mn></msup>',
        PL,
        '<msup><mi>x</mi><mn>2</mn></msup>',
        PL,
        x,
        PL,
        mn(1),
      ),
    ),
  ),
};

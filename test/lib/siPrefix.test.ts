import { SIValue } from '../../src/lib/siPrefix';

describe('successor', () => {
  test('k', () => {
    expect(SIValue.successor('k')).toBe('M');
  });

  test('m', () => {
    expect(SIValue.successor('m')).toBe('');
  });

  test('n', () => {
    expect(SIValue.successor('n')).toBe('μ');
  });

  test('Q', () => {
    expect(SIValue.successor('Q')).toBe('Q');
  });

  test('q', () => {
    expect(SIValue.successor('q')).toBe('r');
  });

  test('no prefix', () => {
    expect(SIValue.successor('')).toBe('k');
  });
});

describe('successor all prefix', () => {
  test('k', () => {
    expect(SIValue.successor('k', true)).toBe('M');
  });

  test('m', () => {
    expect(SIValue.successor('m', true)).toBe('c');
  });

  test('n', () => {
    expect(SIValue.successor('n', true)).toBe('μ');
  });

  test('Q', () => {
    expect(SIValue.successor('Q', true)).toBe('Q');
  });

  test('q', () => {
    expect(SIValue.successor('q', true)).toBe('r');
  });

  test('no prefix', () => {
    expect(SIValue.successor('', true)).toBe('da');
  });
});

describe('predecessor', () => {
  test('k', () => {
    expect(SIValue.predecessor('k')).toBe('');
  });

  test('m', () => {
    expect(SIValue.predecessor('m')).toBe('μ');
  });

  test('n', () => {
    expect(SIValue.predecessor('n')).toBe('p');
  });

  test('Q', () => {
    expect(SIValue.predecessor('Q')).toBe('R');
  });

  test('q', () => {
    expect(SIValue.predecessor('q')).toBe('q');
  });

  test('no prefix', () => {
    expect(SIValue.predecessor('')).toBe('m');
  });
});

describe('predecessor all prefix', () => {
  test('k', () => {
    expect(SIValue.predecessor('k', true)).toBe('h');
  });

  test('m', () => {
    expect(SIValue.predecessor('m', true)).toBe('μ');
  });

  test('n', () => {
    expect(SIValue.predecessor('n', true)).toBe('p');
  });

  test('Q', () => {
    expect(SIValue.predecessor('Q', true)).toBe('R');
  });

  test('q', () => {
    expect(SIValue.predecessor('q', true)).toBe('q');
  });

  test('no prefix', () => {
    expect(SIValue.predecessor('', true)).toBe('d');
  });
});

describe('fit', () => {
  test('Fit a large SI prefix', () => {
    expect(SIValue.fit(1e6, ['k', ''])).toStrictEqual(new SIValue(1e3, SIValue.getPrefix('k')));
    expect(SIValue.fit(1e6, ['M', 'k', ''])).toStrictEqual(new SIValue(1, SIValue.getPrefix('M')));
    expect(SIValue.fit(1e6, ['G', 'M', 'k', ''])).toStrictEqual(new SIValue(1, SIValue.getPrefix('M')));

    expect(SIValue.fit(5e6, ['k', ''])).toStrictEqual(new SIValue(5e3, SIValue.getPrefix('k')));
    expect(SIValue.fit(5e6, ['M', 'k', ''])).toStrictEqual(new SIValue(5, SIValue.getPrefix('M')));
    expect(SIValue.fit(5e6, ['G', 'M', 'k', ''])).toStrictEqual(new SIValue(5, SIValue.getPrefix('M')));
  });

  test('Fit a small SI prefix', () => {
    expect(SIValue.fit(1e-9, ['', 'm', 'μ'])).toStrictEqual(new SIValue(1e-3, SIValue.getPrefix('μ')));
    expect(SIValue.fit(1e-9, ['', 'm', 'μ', 'n'])).toStrictEqual(new SIValue(1, SIValue.getPrefix('n')));
    expect(SIValue.fit(1e-9, ['', 'm', 'μ', 'n', 'p'])).toStrictEqual(new SIValue(1, SIValue.getPrefix('n')));

    expect(SIValue.fit(5e-9, ['', 'm', 'μ'])).toStrictEqual(new SIValue(5e-3, SIValue.getPrefix('μ')));
    expect(SIValue.fit(5e-9, ['', 'm', 'μ', 'n'])).toStrictEqual(new SIValue(5, SIValue.getPrefix('n')));
    expect(SIValue.fit(5e-9, ['', 'm', 'μ', 'n', 'p'])).toStrictEqual(new SIValue(5, SIValue.getPrefix('n')));
  });

  test('Fit a base SI prefix', () => {
    expect(SIValue.fit(0, ['G', 'M', 'k', ''])).toStrictEqual(new SIValue(0, SIValue.getPrefix('')));
    expect(SIValue.fit(0, ['G', 'M', 'k'])).toStrictEqual(new SIValue(0, SIValue.getPrefix('')));

    expect(SIValue.fit(0, ['', 'm', 'μ', 'n', 'p'])).toStrictEqual(new SIValue(0, SIValue.getPrefix('')));
    expect(SIValue.fit(0, ['m', 'μ', 'n', 'p'])).toStrictEqual(new SIValue(0, SIValue.getPrefix('')));
  });

  test('Fit with a negative value', () => {
    expect(SIValue.fit(-1e6, ['k', ''])).toStrictEqual(new SIValue(-1e3, SIValue.getPrefix('k')));
    expect(SIValue.fit(-1e6, ['M', 'k', ''])).toStrictEqual(new SIValue(-1, SIValue.getPrefix('M')));
    expect(SIValue.fit(-1e6, ['G', 'M', 'k', ''])).toStrictEqual(new SIValue(-1, SIValue.getPrefix('M')));
  });
});

describe('fitBy', () => {
  test('Fit a large SI prefix', () => {
    expect(SIValue.fitBy(1e6, 'k')).toStrictEqual(new SIValue(1e3, SIValue.getPrefix('k')));
    expect(SIValue.fitBy(1e6, 'M')).toStrictEqual(new SIValue(1, SIValue.getPrefix('M')));
    expect(SIValue.fitBy(1e6, 'G')).toStrictEqual(new SIValue(1e-3, SIValue.getPrefix('G')));

    expect(SIValue.fitBy(5e6, 'k')).toStrictEqual(new SIValue(5e3, SIValue.getPrefix('k')));
    expect(SIValue.fitBy(5e6, 'M')).toStrictEqual(new SIValue(5, SIValue.getPrefix('M')));
    expect(SIValue.fitBy(5e6, 'G')).toStrictEqual(new SIValue(5e-3, SIValue.getPrefix('G')));
  });

  test('Fit a small SI prefix', () => {
    expect(SIValue.fitBy(1e-9, 'μ')).toStrictEqual(new SIValue(1e-3, SIValue.getPrefix('μ')));
    expect(SIValue.fitBy(1e-9, 'n')).toStrictEqual(new SIValue(1, SIValue.getPrefix('n')));
    expect(SIValue.fitBy(1e-9, 'p')).toEqual({ fraction: expect.closeTo(1e3), prefix: SIValue.getPrefix('p') });

    expect(SIValue.fitBy(5e-9, 'μ')).toStrictEqual(new SIValue(5e-3, SIValue.getPrefix('μ')));
    expect(SIValue.fitBy(5e-9, 'n')).toStrictEqual(new SIValue(5, SIValue.getPrefix('n')));
    expect(SIValue.fitBy(5e-9, 'p')).toStrictEqual(new SIValue(5e3, SIValue.getPrefix('p')));
  });

  test('Fit a base SI prefix', () => {
    expect(SIValue.fitBy(0, 'm')).toStrictEqual(new SIValue(0, SIValue.getPrefix('m')));
    expect(SIValue.fitBy(0, '')).toStrictEqual(new SIValue(0, SIValue.getPrefix('')));
    expect(SIValue.fitBy(0, 'k')).toStrictEqual(new SIValue(0, SIValue.getPrefix('k')));
  });

  test('Fit with a negative value', () => {
    expect(SIValue.fitBy(-1e6, 'k')).toStrictEqual(new SIValue(-1e3, SIValue.getPrefix('k')));
    expect(SIValue.fitBy(-1e6, 'M')).toStrictEqual(new SIValue(-1, SIValue.getPrefix('M')));
    expect(SIValue.fitBy(-1e6, 'G')).toStrictEqual(new SIValue(-1e-3, SIValue.getPrefix('G')));
  });
});

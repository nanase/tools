export type SIPrefixSymbol =
  | 'Q'
  | 'R'
  | 'Y'
  | 'Z'
  | 'E'
  | 'P'
  | 'T'
  | 'G'
  | 'M'
  | 'k'
  | 'h'
  | 'da'
  | ''
  | 'd'
  | 'c'
  | 'm'
  | 'u'
  | 'μ'
  | 'n'
  | 'p'
  | 'f'
  | 'a'
  | 'z'
  | 'y'
  | 'r'
  | 'q';
export type SIPrefix = { symbol: SIPrefixSymbol; exponent: number };
export const BaseSIPrefix: SIPrefix = { symbol: '', exponent: 0 };
const prefixes: readonly SIPrefix[] = [
  { symbol: 'Q', exponent: 30 },
  { symbol: 'R', exponent: 27 },
  { symbol: 'Y', exponent: 24 },
  { symbol: 'Z', exponent: 21 },
  { symbol: 'E', exponent: 18 },
  { symbol: 'P', exponent: 15 },
  { symbol: 'T', exponent: 12 },
  { symbol: 'G', exponent: 9 },
  { symbol: 'M', exponent: 6 },
  { symbol: 'k', exponent: 3 },
  { symbol: 'h', exponent: 2 },
  { symbol: 'da', exponent: 1 },
  BaseSIPrefix,
  { symbol: 'd', exponent: -1 },
  { symbol: 'c', exponent: -2 },
  { symbol: 'm', exponent: -3 },
  { symbol: 'μ', exponent: -6 }, // formal
  { symbol: 'u', exponent: -6 },
  { symbol: 'n', exponent: -9 },
  { symbol: 'p', exponent: -12 },
  { symbol: 'f', exponent: -15 },
  { symbol: 'a', exponent: -18 },
  { symbol: 'z', exponent: -21 },
  { symbol: 'y', exponent: -24 },
  { symbol: 'r', exponent: -27 },
  { symbol: 'q', exponent: -30 },
];

export class SIValue {
  private static siValuePattern = /^([+-]?(?:[0-9]*\.)?[0-9]+)([QRYZEPTGMkmuμnpfazyrq]?)$/;

  constructor(
    public readonly fraction: number,
    public readonly prefix: SIPrefix,
  ) {}

  get actualValue(): number {
    return this.fraction * 10 ** this.prefix.exponent;
  }

  static getPrefixSymbols(allPrefix?: boolean): SIPrefixSymbol[] {
    return prefixes.filter((p) => p.exponent % (allPrefix ? 1 : 3) === 0).map((p) => p.symbol);
  }

  static test(text: string | undefined): boolean {
    return SIValue.siValuePattern.test(text ?? '');
  }

  static parse(text: string | undefined): SIValue {
    const matches = SIValue.siValuePattern.exec(text ?? '');

    if (matches == null) {
      return new SIValue(Number.NaN, BaseSIPrefix);
    }

    const fraction = Number.parseFloat(matches[1]);
    const prefix = prefixes.find((p) => p.symbol === matches[2]);

    if (prefix) {
      return new SIValue(fraction, prefix);
    } else {
      return new SIValue(fraction, BaseSIPrefix);
    }
  }

  static fit(value: number, symbols: readonly SIPrefixSymbol[]): SIValue {
    if (!Number.isFinite(value) && symbols.length === 0) {
      return new SIValue(value, BaseSIPrefix);
    }

    if (value !== 0.0) {
      const sign = Math.sign(value);
      value = Math.abs(value);

      const prefixes = symbols
        .map((s) => {
          const prefix = SIValue.getPrefix(s);
          const practicalValue = value * 10 ** -prefix.exponent;
          const rank = Math.abs(practicalValue - 500);
          return { prefix, practicalValue, rank };
        })
        .sort((a, b) => a.rank - b.rank);

      return new SIValue(prefixes[0].practicalValue * sign, prefixes[0].prefix);
    } else {
      return new SIValue(0, BaseSIPrefix);
    }
  }

  static fitBy(value: number, symbol: SIPrefixSymbol): SIValue {
    if (!Number.isFinite(value)) {
      return new SIValue(value, BaseSIPrefix);
    }

    const sign = Math.sign(value);
    value = Math.abs(value);
    const prefix = SIValue.getPrefix(symbol);
    const practicalValue = value * 10 ** -prefix.exponent;

    return new SIValue(practicalValue * sign, prefix);
  }

  static getPrefix(symbol: SIPrefixSymbol): SIPrefix {
    const prefix = prefixes.find((p) => p.symbol === symbol);

    if (!prefix) {
      throw new Error(`Prefix symbol '${symbol}' is not defined.`);
    }

    return prefix;
  }

  static successor(symbol: SIPrefixSymbol, allPrefix?: boolean): SIPrefixSymbol {
    const prefix = SIValue.getPrefix(symbol);
    const prefixCandidates = prefixes.filter(
      (p) => p.exponent > prefix.exponent && p.exponent % (allPrefix ? 1 : 3) === 0,
    );

    if (prefixCandidates.length === 0) {
      return symbol;
    }

    const prefixCandidate = prefixCandidates.slice(-1)[0];

    return prefixCandidates.filter((p) => p.exponent === prefixCandidate.exponent)[0].symbol;
  }

  static predecessor(symbol: SIPrefixSymbol, allPrefix?: boolean): SIPrefixSymbol {
    const prefix = SIValue.getPrefix(symbol);
    const prefixCandidates = prefixes.filter(
      (p) => p.exponent < prefix.exponent && p.exponent % (allPrefix ? 1 : 3) === 0,
    );

    if (prefixCandidates.length === 0) {
      return symbol;
    }

    return prefixCandidates[0].symbol;
  }
}

export const Rules = {
  required: (value: string) => !!value || '値を入力してください',
  value: (value: string) => Number.isFinite(SIValue.parse(value).fraction) || '不正な値です',
  notZero: (value: string) => Number(value) !== 0 || '値を 0 にはできません',
  notNegative: (value: string) => {
    const siValue = SIValue.parse(value);
    return (Number.isFinite(siValue.fraction) && siValue.fraction >= 0) || '負値にはできません';
  },
};

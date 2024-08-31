import { generateForDepth, SIValue, type SIPrefixSymbol } from '@nanase/alnilam';

export const ESeries = {
  E1: [100],
  E3: [100, 220, 470],
  E6: [100, 150, 220, 330, 470, 680],
  E12: [100, 120, 150, 180, 220, 270, 330, 390, 470, 560, 680, 820],
  E24: [
    100, 110, 120, 130, 150, 160, 180, 200, 220, 240, 270, 300, 330, 360, 390, 430, 470, 510, 560, 620, 680, 750, 820,
    910,
  ],
  E48: [
    100, 105, 110, 115, 121, 127, 133, 140, 147, 154, 162, 169, 178, 187, 196, 205, 215, 226, 237, 249, 261, 274, 287,
    301, 316, 332, 348, 365, 383, 402, 422, 442, 464, 487, 511, 536, 562, 590, 619, 649, 681, 715, 750, 787, 825, 866,
    909, 953,
  ],
  E96: [
    100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169,
    174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 261, 267, 274, 280, 287, 294, 301,
    309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475, 487, 499, 511, 523,
    536, 549, 562, 576, 590, 604, 619, 634, 649, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931,
    953, 976,
  ],
  E192: [
    100, 101, 102, 104, 105, 106, 107, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 123, 124, 126, 127, 129, 130,
    132, 133, 135, 137, 138, 140, 142, 143, 145, 147, 149, 150, 152, 154, 156, 158, 160, 162, 164, 165, 167, 169, 172,
    174, 176, 178, 180, 182, 184, 187, 189, 191, 193, 196, 198, 200, 203, 205, 208, 210, 213, 215, 218, 221, 223, 226,
    229, 232, 234, 237, 240, 243, 246, 249, 252, 255, 258, 261, 264, 267, 271, 274, 277, 280, 284, 287, 291, 294, 298,
    301, 305, 309, 312, 316, 320, 324, 328, 332, 336, 340, 344, 348, 352, 357, 361, 365, 370, 374, 379, 383, 388, 392,
    397, 402, 407, 412, 417, 422, 427, 432, 437, 442, 448, 453, 459, 464, 470, 475, 481, 487, 493, 499, 505, 511, 517,
    523, 530, 536, 542, 549, 556, 562, 569, 576, 583, 590, 597, 604, 612, 619, 626, 634, 642, 649, 657, 665, 673, 681,
    690, 698, 706, 715, 723, 732, 741, 750, 759, 768, 777, 787, 796, 806, 816, 825, 835, 845, 856, 866, 876, 887, 898,
    909, 920, 931, 942, 953, 965, 976, 988,
  ],
};

export interface ColorCode {
  figure: string | null;
  name: string;
  code: string | null;
  color: {
    hex: string;
    luster: boolean;
  };
  multiplier: number | null;
  tolerance: {
    percent: number;
    letter: string;
  } | null;
}

export const ColorCodes: ColorCode[] = [
  {
    figure: null,
    name: 'None',
    code: null,
    color: {
      hex: '#00000000',
      luster: false,
    },
    multiplier: null,
    tolerance: {
      percent: 20,
      letter: 'M',
    },
  },
  {
    figure: null,
    name: 'Pink',
    code: 'PK',
    color: {
      hex: '#ccceccff',
      luster: false,
    },
    multiplier: 1e-3,
    tolerance: null,
  },
  {
    figure: null,
    name: 'Silver',
    code: 'SR',
    color: {
      hex: '#ccceccff',
      luster: true,
    },
    multiplier: 1e-2,
    tolerance: {
      percent: 10,
      letter: 'K',
    },
  },
  {
    figure: null,
    name: 'Gold',
    code: 'GD',
    color: {
      hex: '#cc9a34ff',
      luster: true,
    },
    multiplier: 1e-1,
    tolerance: {
      percent: 5,
      letter: 'J',
    },
  },
  {
    figure: '0',
    name: 'Black',
    code: 'BK',
    color: {
      hex: '#0b0000ff',
      luster: false,
    },
    multiplier: 1,
    tolerance: null,
  },
  {
    figure: '1',
    name: 'Brown',
    code: 'BN',
    color: {
      hex: '#643234ff',
      luster: false,
    },
    multiplier: 1e1,
    tolerance: {
      percent: 1,
      letter: 'F',
    },
  },
  {
    figure: '2',
    name: 'Red',
    code: 'RD',
    color: {
      hex: '#ff0000ff',
      luster: false,
    },
    multiplier: 1e2,
    tolerance: {
      percent: 2,
      letter: 'G',
    },
  },
  {
    figure: '3',
    name: 'Orange',
    code: 'OG',
    color: {
      hex: '#fc6604ff',
      luster: false,
    },
    multiplier: 1e3,
    tolerance: {
      percent: 0.05,
      letter: 'W',
    },
  },
  {
    figure: '4',
    name: 'Yellow',
    code: 'YE',
    color: {
      hex: '#fcfe04ff',
      luster: false,
    },
    multiplier: 1e4,
    tolerance: {
      percent: 0.02,
      letter: 'P',
    },
  },
  {
    figure: '5',
    name: 'Green',
    code: 'GN',
    color: {
      hex: '#34ce34ff',
      luster: false,
    },
    multiplier: 1e5,
    tolerance: {
      percent: 0.5,
      letter: 'D',
    },
  },
  {
    figure: '6',
    name: 'Blue',
    code: 'BU',
    color: {
      hex: '#6466fcff',
      luster: false,
    },
    multiplier: 1e6,
    tolerance: {
      percent: 0.25,
      letter: 'C',
    },
  },
  {
    figure: '7',
    name: 'Violet',
    code: 'VT',
    color: {
      hex: '#cc66fcff',
      luster: false,
    },
    multiplier: 1e7,
    tolerance: {
      percent: 0.1,
      letter: 'B',
    },
  },
  {
    figure: '8',
    name: 'Gray',
    code: 'GY',
    color: {
      hex: '#949294ff',
      luster: false,
    },
    multiplier: 1e8,
    tolerance: {
      percent: 0.01,
      letter: 'L(A)',
    },
  },
  {
    figure: '9',
    name: 'White',
    code: 'WH',
    color: {
      hex: '#ffffffff',
      luster: false,
    },
    multiplier: 1e9,
    tolerance: null,
  },
];

export function getColorCodes(value: number, tolerancePercent: number, type: '4-band' | '5-band'): ColorCode[] {
  const exponentRange = type === '4-band' ? 1 : 2;
  const exponent = Math.floor(Math.log10(value)) - exponentRange;
  const referenceValue = Math.round(value / 10 ** exponent);
  const values =
    type === '4-band'
      ? [Math.floor(referenceValue / 10), referenceValue % 10]
      : [Math.floor(referenceValue / 100), (referenceValue / 10) % 10, referenceValue % 10];

  return [
    ...values.map((v) => ColorCodes[v + 4]),
    ColorCodes.find((code) => code.multiplier === 10 ** exponent) ?? ColorCodes[0],
    ColorCodes.find((code) => code.tolerance?.percent === tolerancePercent) ?? ColorCodes[0],
  ];
}

export interface PassiveComponent {
  value: number;
}

export type ComponentType = 'resistor' | 'capacitor' | 'inductor';
export type ComponentNode = '+' | '|' | PassiveComponent;

export function* generateCombinations(components: PassiveComponent[]): Generator<ComponentNode[]> {
  if (components.length === 1) {
    yield [components[0]];
  }

  for (let i = 1; i < components.length; i++) {
    const left = components.slice(0, i);
    const right = components.slice(i);

    for (const leftNode of generateCombinations(left)) {
      for (const rightNode of generateCombinations(right)) {
        yield ['+', ...leftNode, ...rightNode];
      }
    }

    for (const rightNode of generateCombinations(right)) {
      for (const leftNode of generateCombinations(left)) {
        yield ['|', ...leftNode, ...rightNode];
      }
    }
  }
}

export function* generateComponentValueBySeries(
  series: number[],
  minValue: number,
  maxValue: number,
): Generator<number> {
  for (let exponent = minValue; exponent <= maxValue; exponent *= 10) {
    for (const value of series) {
      const realValue = (value * exponent) / 100;

      if (minValue <= realValue && realValue <= maxValue) {
        yield realValue;
      }
    }
  }
}

export interface ApproximateResult {
  combination?: Combination;
  total: number;
  current: number;
}

export function* approximate(
  value: number,
  componentType: ComponentType,
  componentNumber: number,
  series: number[],
  minValue: number,
  maxValue: number,
  excludedValues?: number[],
  progressBeacon?: number,
): Generator<ApproximateResult, void> {
  excludedValues = excludedValues ?? [];
  const componentValues = [...generateComponentValueBySeries(series, minValue, maxValue)]
    .filter((v) => v !== value && !excludedValues.includes(v))
    .sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
  const components = Array.from({ length: componentNumber }, () => ({ value: 0 }));
  const combinations = [...generateCombinations(components)];
  const totalCombinationNumber = componentValues.length ** componentNumber * combinations.length;
  let bestValue = 0;
  let currentCombinationNumber = 0;

  for (const valuePair of generateForDepth(componentValues, componentNumber)) {
    valuePair.forEach((value, index) => {
      components[index].value = value;
    });

    for (const combination of combinations) {
      const calculatedValue = Combination.calcValue(combination, componentType);
      currentCombinationNumber++;

      if (Math.abs(bestValue - value) >= Math.abs(calculatedValue - value)) {
        bestValue = calculatedValue;

        yield {
          combination: new Combination(combination),
          total: totalCombinationNumber,
          current: currentCombinationNumber,
        };
      }

      if (progressBeacon && currentCombinationNumber % progressBeacon === 0) {
        yield {
          total: totalCombinationNumber,
          current: currentCombinationNumber,
        };
      }
    }
  }
}

export interface TermNode {
  type: 'term';
  children: number;
}
export interface OperationNode {
  type: 'parallel' | 'series';
  children: (OperationNode | TermNode)[];
}

export type CombinationNode = OperationNode | TermNode;

export class Combination {
  componentNodes: readonly ComponentNode[];
  nodes: OperationNode;

  constructor(componentNodes: ComponentNode[]) {
    this.componentNodes = structuredClone(componentNodes);
    this.nodes = Combination.generateSyntaxTree(componentNodes);
  }

  get numberOfTypes(): number {
    return this.componentNodes
      .filter((node) => typeof node === 'object')
      .map((node) => node.value)
      .filter((value, index, array) => array.indexOf(value) === index).length;
  }

  equals(other: Combination): boolean {
    return Combination.equalsInternal(this.nodes, other.nodes);
  }

  toString(
    siSymbols: SIPrefixSymbol[] = ['T', 'G', 'M', 'k', '', 'm', 'μ', 'n', 'p', 'f'],
    fractionDigits: number = 3,
  ): string {
    return Combination.toStringInternal(this.nodes, siSymbols, fractionDigits);
  }

  calcValue(componentType: ComponentType): number {
    return componentType === 'capacitor'
      ? Combination.calcValueForCapacitorInternal(this.componentNodes)
      : Combination.calcValueInternal(this.componentNodes);
  }

  static calcValue(componentNodes: ComponentNode[], componentType: ComponentType): number {
    return componentType === 'capacitor'
      ? Combination.calcValueForCapacitorInternal(componentNodes)
      : Combination.calcValueInternal(componentNodes);
  }

  private static equalsInternal(a: OperationNode, b: OperationNode): boolean {
    if (a.type !== b.type) {
      return false;
    }

    if (a.children.length !== b.children.length) {
      return false;
    }

    const sortedChildrenA = [...a.children].sort(Combination.compareNodes);
    const sortedChildrenB = [...b.children].sort(Combination.compareNodes);

    return sortedChildrenA.every((child, index) => Combination.deepCompare(child, sortedChildrenB[index]));
  }

  private static compareNodes(a: OperationNode | TermNode, b: OperationNode | TermNode): number {
    if (a.type === 'term' && b.type === 'term') {
      return a.children - b.children;
    } else if (a.type === 'term') {
      return -1;
    } else if (b.type === 'term') {
      return 1;
    } else {
      return a.type.localeCompare(b.type);
    }
  }

  private static deepCompare(a: OperationNode | TermNode, b: OperationNode | TermNode): boolean {
    if (a.type !== b.type) {
      return false;
    }

    if (a.type === 'term' && b.type === 'term') {
      return a.children === b.children;
    }

    if (a.type !== 'term' && b.type !== 'term') {
      return Combination.equalsInternal(a, b);
    }

    return false;
  }

  private static generateSyntaxTree(componentNodes: ComponentNode[]): OperationNode {
    const stack: (OperationNode | TermNode)[] = [];

    for (let i = componentNodes.length - 1; i >= 0; i--) {
      const command = componentNodes[i];
      const children: (OperationNode | TermNode)[] = [];

      if (command === '+') {
        const a = stack.pop()!;
        const b = stack.pop()!;

        if (a.type === 'series') {
          children.push(...a.children);
        } else {
          children.push(a);
        }

        if (b.type === 'series') {
          children.push(...b.children);
        } else {
          children.push(b);
        }

        stack.push({ type: 'series', children });
      } else if (command === '|') {
        const a = stack.pop()!;
        const b = stack.pop()!;

        if (a.type === 'parallel') {
          children.push(...a.children);
        } else {
          children.push(a);
        }

        if (b.type === 'parallel') {
          children.push(...b.children);
        } else {
          children.push(b);
        }

        stack.push({ type: 'parallel', children });
      } else {
        stack.push({ type: 'term', children: command.value });
      }
    }

    if (stack[0].type !== 'term') {
      return stack[0];
    } else {
      throw new Error('invalid nodes');
    }
  }

  private static toStringInternal(node: OperationNode, siSymbols: SIPrefixSymbol[], fractionDigits: number): string {
    return node.children
      .map((child) =>
        child.type === 'term'
          ? SIValue.fit(child.children, siSymbols).toSimpleString(fractionDigits)
          : `(${Combination.toStringInternal(child, siSymbols, fractionDigits)})`,
      )
      .join(node.type === 'series' ? ' + ' : ' | ');
  }

  private static calcValueInternal(componentNodes: readonly ComponentNode[]): number {
    const stack: number[] = [];

    for (let i = componentNodes.length - 1; i >= 0; i--) {
      const command = componentNodes[i];

      if (command === '+') {
        const a = stack.pop()!;
        const b = stack.pop()!;
        stack.push(a + b);
      } else if (command === '|') {
        const a = stack.pop()!;
        const b = stack.pop()!;
        stack.push((a * b) / (a + b));
      } else {
        stack.push(command.value);
      }
    }

    return stack[0];
  }

  private static calcValueForCapacitorInternal(componentNodes: readonly ComponentNode[]): number {
    const stack: number[] = [];

    for (let i = componentNodes.length - 1; i >= 0; i--) {
      const command = componentNodes[i];

      if (command === '+') {
        const a = stack.pop()!;
        const b = stack.pop()!;
        stack.push((a * b) / (a + b));
      } else if (command === '|') {
        const a = stack.pop()!;
        const b = stack.pop()!;
        stack.push(a + b);
      } else {
        stack.push(command.value);
      }
    }

    return stack[0];
  }
}

export class Coefficients extends Float64Array {
  constructor(...items: number[]) {
    super(items);
    Object.setPrototypeOf(this, Coefficients.prototype);
  }

  normalizeToFiveParameters(buffer?: Float64Array): Float64Array {
    const array = buffer ?? new Float64Array(5);

    array[0] = this[0] / this[3];
    array[1] = this[1] / this[3];
    array[2] = this[2] / this[3];
    array[3] = -this[4] / this[3];
    array[4] = -this[5] / this[3];

    return array;
  }

  get a0(): number {
    return this[0];
  }

  get a1(): number {
    return this[1];
  }

  get a2(): number {
    return this[2];
  }

  get b0(): number {
    return this[3];
  }

  get b1(): number {
    return this[4];
  }

  get b2(): number {
    return this[5];
  }
}

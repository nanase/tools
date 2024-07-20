export class Coefficients extends Array<number> {
  constructor(...items: number[]) {
    super(...items);
    Object.setPrototypeOf(this, Coefficients.prototype);
  }

  normalizeToFiveParameters(): number[] {
    return [this[0] / this[3], this[1] / this[3], this[2] / this[3], -this[4] / this[3], -this[5] / this[3]];
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

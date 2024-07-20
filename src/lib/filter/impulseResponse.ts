import type { Coefficients } from './coefficients';

export class ImpulseResponse {
  static getImpulseResponse(coefficients: Coefficients, length: number) {
    let normalizedCoefficients: Float64Array = new Float64Array(5);

    if (coefficients.length === 6) {
      coefficients.normalizeToFiveParameters(normalizedCoefficients);
    } else if (coefficients.length === 5) {
      normalizedCoefficients = coefficients;
    } else {
      throw new Error('Invalid coefficients');
    }

    const impulses = new Float64Array(length);
    ImpulseResponse.calcImpulseResponse(impulses, normalizedCoefficients);

    return impulses;
  }

  static calcImpulseResponse(buffer: Float64Array, coefficients: Float64Array): void {
    if (coefficients.length !== 5) {
      throw new Error('Coefficients must to be normalized.');
    }

    let [o1, o2, i0, i1, i2] = [0.0, 0.0, 1.0, 0.0, 0.0];

    for (let i = 0; i < buffer.length; i++) {
      buffer[i] =
        coefficients[0] * i0 +
        coefficients[1] * i1 +
        coefficients[2] * i2 +
        coefficients[3] * o1 +
        coefficients[4] * o2;
      i2 = i1;
      i1 = i0;
      o2 = o1;
      o1 = buffer[i];
      i0 = 0.0;
    }
  }
}

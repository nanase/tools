import type { Coefficients } from './coefficients';

export class ImpulseResponse {
  static getImpulseResponse(coefficients: Coefficients, size: number) {
    let fiveParamsCoefficients: number[] = [];

    if (coefficients.length === 6) {
      fiveParamsCoefficients = coefficients.normalizeToFiveParameters();
    } else if (coefficients.length === 5) {
      fiveParamsCoefficients = coefficients;
    } else {
      throw new Error('Invalid coefficients');
    }

    const impulses = new Float64Array(size);
    let [o1, o2, i0, i1, i2] = [0.0, 0.0, 1.0, 0.0, 0.0];

    for (let i = 0; i < size; i++) {
      impulses[i] =
        fiveParamsCoefficients[0] * i0 +
        fiveParamsCoefficients[1] * i1 +
        fiveParamsCoefficients[2] * i2 +
        fiveParamsCoefficients[3] * o1 +
        fiveParamsCoefficients[4] * o2;
      i2 = i1;
      i1 = i0;
      o2 = o1;
      o1 = impulses[i];
      i0 = 0.0;
    }

    return impulses;
  }
}

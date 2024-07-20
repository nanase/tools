export class Coefficients {
  static normalizeToFiveParameters(coefficients: Float64Array, buffer?: Float64Array): Float64Array {
    const array = buffer ?? new Float64Array(5);

    array[0] = coefficients[0] / coefficients[3];
    array[1] = coefficients[1] / coefficients[3];
    array[2] = coefficients[2] / coefficients[3];
    array[3] = -coefficients[4] / coefficients[3];
    array[4] = -coefficients[5] / coefficients[3];

    return array;
  }
}

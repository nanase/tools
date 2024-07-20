export interface BiquadFilterParameter {
  q?: number;
  bandwidth?: number;
  gain?: number;
}

export class BiquadFilterCoefficients {
  static calcOmega(samplingRate: number, cutoff: number): number {
    return (2.0 * Math.PI * cutoff) / samplingRate;
  }

  static lowpass(
    coefficients: Float64Array,
    samplingRate: number,
    cutoff: number,
    parameter?: BiquadFilterParameter,
  ): Float64Array {
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);

    coefficients[0] = (1.0 - Math.cos(omega)) / 2.0;
    coefficients[1] = 1.0 - Math.cos(omega);
    coefficients[2] = (1.0 - Math.cos(omega)) / 2.0;
    coefficients[3] = 1.0 + alpha;
    coefficients[4] = -2.0 * Math.cos(omega);
    coefficients[5] = 1.0 - alpha;

    return coefficients;
  }

  static highpass(
    coefficients: Float64Array,
    samplingRate: number,
    cutoff: number,
    parameter?: BiquadFilterParameter,
  ): Float64Array {
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);

    coefficients[0] = (1.0 + Math.cos(omega)) / 2.0;
    coefficients[1] = -(1.0 + Math.cos(omega));
    coefficients[2] = (1.0 + Math.cos(omega)) / 2.0;
    coefficients[3] = 1.0 + alpha;
    coefficients[4] = -2.0 * Math.cos(omega);
    coefficients[5] = 1.0 - alpha;

    return coefficients;
  }

  static bandpass(
    coefficients: Float64Array,
    samplingRate: number,
    cutoff: number,
    parameter?: BiquadFilterParameter,
  ): Float64Array {
    const q = parameter?.q ?? Math.SQRT1_2;
    const bandwidth = parameter?.bandwidth ?? 1.0;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) * Math.sinh(((Math.log(2.0) / 2.0) * bandwidth * omega) / Math.sin(omega));

    coefficients[0] = alpha * q;
    coefficients[1] = 0.0;
    coefficients[2] = -alpha * q;
    coefficients[3] = 1.0 + alpha;
    coefficients[4] = -2.0 * Math.cos(omega);
    coefficients[5] = 1.0 - alpha;

    return coefficients;
  }

  static bandstop(
    coefficients: Float64Array,
    samplingRate: number,
    cutoff: number,
    parameter?: BiquadFilterParameter,
  ): Float64Array {
    const bandwidth = parameter?.bandwidth ?? 1.0;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) * Math.sinh(((Math.log(2.0) / 2.0) * bandwidth * omega) / Math.sin(omega));

    coefficients[0] = 1.0;
    coefficients[1] = -2.0 * Math.cos(omega);
    coefficients[2] = 1.0;
    coefficients[3] = 1.0 + alpha;
    coefficients[4] = -2.0 * Math.cos(omega);
    coefficients[5] = 1.0 - alpha;

    return coefficients;
  }

  static lowshelf(
    coefficients: Float64Array,
    samplingRate: number,
    cutoff: number,
    parameter?: BiquadFilterParameter,
  ): Float64Array {
    const gain = parameter?.gain ?? 0.0;
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const a = Math.pow(10.0, gain / 40.0);
    const beta = Math.sqrt(a) / q;

    coefficients[0] = a * (a + 1.0 - (a - 1.0) * Math.cos(omega) + beta * Math.sin(omega));
    coefficients[1] = 2.0 * a * (a - 1.0 - (a + 1.0) * Math.cos(omega));
    coefficients[2] = a * (a + 1.0 - (a - 1.0) * Math.cos(omega) - beta * Math.sin(omega));
    coefficients[3] = a + 1.0 + (a - 1.0) * Math.cos(omega) + beta * Math.sin(omega);
    coefficients[4] = -2.0 * (a - 1.0 + (a + 1.0) * Math.cos(omega));
    coefficients[5] = a + 1.0 + (a - 1.0) * Math.cos(omega) - beta * Math.sin(omega);

    return coefficients;
  }

  static highshelf(
    coefficients: Float64Array,
    samplingRate: number,
    cutoff: number,
    parameter?: BiquadFilterParameter,
  ): Float64Array {
    const gain = parameter?.gain ?? 0.0;
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const a = Math.pow(10.0, gain / 40.0);
    const beta = Math.sqrt(a) / q;

    coefficients[0] = a * (a + 1.0 + (a - 1.0) * Math.cos(omega) + beta * Math.sin(omega));
    coefficients[1] = -2.0 * a * (a - 1.0 + (a + 1.0) * Math.cos(omega));
    coefficients[2] = a * (a + 1.0 + (a - 1.0) * Math.cos(omega) - beta * Math.sin(omega));
    coefficients[3] = a + 1.0 - (a - 1.0) * Math.cos(omega) + beta * Math.sin(omega);
    coefficients[4] = 2.0 * (a - 1.0 - (a + 1.0) * Math.cos(omega));
    coefficients[5] = a + 1.0 - (a - 1.0) * Math.cos(omega) - beta * Math.sin(omega);

    return coefficients;
  }

  static peaking(
    coefficients: Float64Array,
    samplingRate: number,
    cutoff: number,
    parameter?: BiquadFilterParameter,
  ): Float64Array {
    const gain = parameter?.gain ?? 0.0;
    const bandwidth = parameter?.bandwidth ?? 1.0;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) * Math.sinh(((Math.log(2.0) / 2.0) * bandwidth * omega) / Math.sin(omega));
    const a = Math.pow(10.0, gain / 40.0);

    coefficients[0] = 1.0 + alpha * a;
    coefficients[1] = -2.0 * Math.cos(omega);
    coefficients[2] = 1.0 - alpha * a;
    coefficients[3] = 1.0 + alpha / a;
    coefficients[4] = -2.0 * Math.cos(omega);
    coefficients[5] = 1.0 - alpha / a;

    return coefficients;
  }

  static allpass(
    coefficients: Float64Array,
    samplingRate: number,
    cutoff: number,
    parameter?: BiquadFilterParameter,
  ): Float64Array {
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);

    coefficients[0] = 1.0 - alpha;
    coefficients[1] = -2.0 * Math.cos(omega);
    coefficients[2] = 1.0 + alpha;
    coefficients[3] = 1.0 + alpha;
    coefficients[4] = -2.0 * Math.cos(omega);
    coefficients[5] = 1.0 - alpha;

    return coefficients;
  }
}

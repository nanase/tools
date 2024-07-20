import { Coefficients } from './coefficients';

export interface BiquadFilterParameter {
  q?: number;
  bandwidth?: number;
  gain?: number;
}

export class BiquadFilterCoefficients {
  static calcOmega(samplingRate: number, cutoff: number): number {
    return (2.0 * Math.PI * cutoff) / samplingRate;
  }

  static lowpass(samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): Coefficients {
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);

    return new Coefficients(
      (1.0 - Math.cos(omega)) / 2.0,
      1.0 - Math.cos(omega),
      (1.0 - Math.cos(omega)) / 2.0,
      1.0 + alpha,
      -2.0 * Math.cos(omega),
      1.0 - alpha,
    );
  }

  static highpass(samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): Coefficients {
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);

    return new Coefficients(
      (1.0 + Math.cos(omega)) / 2.0,
      -(1.0 + Math.cos(omega)),
      (1.0 + Math.cos(omega)) / 2.0,
      1.0 + alpha,
      -2.0 * Math.cos(omega),
      1.0 - alpha,
    );
  }

  static bandpass(samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): Coefficients {
    const q = parameter?.q ?? Math.SQRT1_2;
    const bandwidth = parameter?.bandwidth ?? 1.0;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) * Math.sinh(((Math.log(2.0) / 2.0) * bandwidth * omega) / Math.sin(omega));

    return new Coefficients(alpha * q, 0.0, -alpha * q, 1.0 + alpha, -2.0 * Math.cos(omega), 1.0 - alpha);
  }

  static bandstop(samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): Coefficients {
    const bandwidth = parameter?.bandwidth ?? 1.0;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) * Math.sinh(((Math.log(2.0) / 2.0) * bandwidth * omega) / Math.sin(omega));

    return new Coefficients(1.0, -2.0 * Math.cos(omega), 1.0, 1.0 + alpha, -2.0 * Math.cos(omega), 1.0 - alpha);
  }

  static lowshelf(samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): Coefficients {
    const gain = parameter?.gain ?? 0.0;
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const a = Math.pow(10.0, gain / 40.0);
    const beta = Math.sqrt(a) / q;

    return new Coefficients(
      a * (a + 1.0 - (a - 1.0) * Math.cos(omega) + beta * Math.sin(omega)),
      2.0 * a * (a - 1.0 - (a + 1.0) * Math.cos(omega)),
      a * (a + 1.0 - (a - 1.0) * Math.cos(omega) - beta * Math.sin(omega)),
      a + 1.0 + (a - 1.0) * Math.cos(omega) + beta * Math.sin(omega),
      -2.0 * (a - 1.0 + (a + 1.0) * Math.cos(omega)),
      a + 1.0 + (a - 1.0) * Math.cos(omega) - beta * Math.sin(omega),
    );
  }

  static highshelf(samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): Coefficients {
    const gain = parameter?.gain ?? 0.0;
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const a = Math.pow(10.0, gain / 40.0);
    const beta = Math.sqrt(a) / q;

    return new Coefficients(
      a * (a + 1.0 + (a - 1.0) * Math.cos(omega) + beta * Math.sin(omega)),
      -2.0 * a * (a - 1.0 + (a + 1.0) * Math.cos(omega)),
      a * (a + 1.0 + (a - 1.0) * Math.cos(omega) - beta * Math.sin(omega)),
      a + 1.0 - (a - 1.0) * Math.cos(omega) + beta * Math.sin(omega),
      2.0 * (a - 1.0 - (a + 1.0) * Math.cos(omega)),
      a + 1.0 - (a - 1.0) * Math.cos(omega) - beta * Math.sin(omega),
    );
  }

  static peaking(samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): Coefficients {
    const gain = parameter?.gain ?? 0.0;
    const bandwidth = parameter?.bandwidth ?? 1.0;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) * Math.sinh(((Math.log(2.0) / 2.0) * bandwidth * omega) / Math.sin(omega));
    const a = Math.pow(10.0, gain / 40.0);

    return new Coefficients(
      1.0 + alpha * a,
      -2.0 * Math.cos(omega),
      1.0 - alpha * a,
      1.0 + alpha / a,
      -2.0 * Math.cos(omega),
      1.0 - alpha / a,
    );
  }

  static allpass(samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): Coefficients {
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilterCoefficients.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);

    return new Coefficients(
      1.0 - alpha,
      -2.0 * Math.cos(omega),
      1.0 + alpha,
      1.0 + alpha,
      -2.0 * Math.cos(omega),
      1.0 - alpha,
    );
  }
}

import { transform } from '../fft';

export type BiquadFilterType =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'bandstop'
  | 'lowshelf'
  | 'highshelf'
  | 'peaking'
  | 'allpass';

export interface BiquadFilterParameter {
  q?: number;
  gain?: number;
}

export class BiquadFilter {
  private _coefficients: Float64Array = new Float64Array(6);
  private _normalizedCoefficients: Float64Array = new Float64Array(5);
  private _impluseResponse: Float64Array;
  private _real: Float64Array;
  private _imag: Float64Array;
  private _phaseResponse: Float64Array;
  private _frequencyResponse: Float64Array;

  constructor(readonly impulseLength: number) {
    this._impluseResponse = new Float64Array(this.impulseLength);
    this._real = new Float64Array(this.impulseLength);
    this._imag = new Float64Array(this.impulseLength);
    this._phaseResponse = new Float64Array(this.impulseLength / 2);
    this._frequencyResponse = new Float64Array(this.impulseLength / 2);
  }

  setFilter(type: BiquadFilterType, samplingRate: number, cutoff: number, parameter?: BiquadFilterParameter): void {
    BiquadFilter[type](this._coefficients, samplingRate, cutoff, parameter);
    BiquadFilter.normalizeCoefficients(this._coefficients, this._normalizedCoefficients);
    BiquadFilter.calcImpulseResponse(this._impluseResponse, this._normalizedCoefficients);

    for (let i = 0; i < this.impulseLength; i++) {
      this._real[i] = this._impluseResponse[i];
      this._imag[i] = 0.0;
    }

    transform(this._real, this._imag);

    for (let i = 0; i < this.impulseLength / 2; i++) {
      this._phaseResponse[i] = (Math.atan2(this._imag[i], this._real[i]) * 180.0) / Math.PI;
      this._frequencyResponse[i] =
        Math.log10(Math.sqrt(this._real[i] * this._real[i] + this._imag[i] * this._imag[i])) * 20;
    }
  }

  get coefficients() {
    return this._coefficients;
  }

  get normalizedCoefficients() {
    return this._normalizedCoefficients;
  }

  get impluseResponse() {
    return this._impluseResponse;
  }

  get phaseResponse() {
    return this._phaseResponse;
  }

  get frequencyResponse() {
    return this._frequencyResponse;
  }

  static normalizeCoefficients(coefficients: Float64Array, buffer?: Float64Array): Float64Array {
    const array = buffer ?? new Float64Array(5);

    array[0] = coefficients[0] / coefficients[3];
    array[1] = coefficients[1] / coefficients[3];
    array[2] = coefficients[2] / coefficients[3];
    array[3] = -coefficients[4] / coefficients[3];
    array[4] = -coefficients[5] / coefficients[3];

    return array;
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
    const omega = BiquadFilter.calcOmega(samplingRate, cutoff);
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
    const omega = BiquadFilter.calcOmega(samplingRate, cutoff);
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
    const omega = BiquadFilter.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);

    coefficients[0] = alpha;
    coefficients[1] = 0.0;
    coefficients[2] = -alpha;
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
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilter.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);

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
    const omega = BiquadFilter.calcOmega(samplingRate, cutoff);
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
    const omega = BiquadFilter.calcOmega(samplingRate, cutoff);
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
    const q = parameter?.q ?? Math.SQRT1_2;
    const omega = BiquadFilter.calcOmega(samplingRate, cutoff);
    const alpha = Math.sin(omega) / (2.0 * q);
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
    const omega = BiquadFilter.calcOmega(samplingRate, cutoff);
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

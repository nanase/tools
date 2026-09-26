export class PIDController {
  kp: number;
  ki: number;
  kd: number;
  previousError: number;
  integral: number;

  constructor(kp: number, ki: number, kd: number) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.previousError = 0;
    this.integral = 0;
  }

  calculate(setpoint: number, current: number, dt: number): number {
    const error = setpoint - current;
    this.integral += error * dt;
    const derivative = (error - this.previousError) / dt;
    const output = this.kp * error + this.ki * this.integral + this.kd * derivative;
    this.previousError = error;
    return output;
  }
}

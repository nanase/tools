/**
 * WebGL2 の描画: 題材の絵（背景・車体・車輪など）を初めて使うときにテクスチャにし、シェーダで 1 枚を描く
 */
import { programReady, startProgram } from '../../lib/gl-program';
import {
  BIKE_MID,
  CAR_MID,
  CAR_VIEW,
  GOLF,
  GOLF_V0,
  GOLF_VIEW,
  HELI_VIEW,
  type Inputs,
  MOTO_VIEW,
  type Subject,
  TRAIN_MID,
  TRAIN_VIEW,
  type View,
} from './motion';
import { heliBg, heliBody, motoBg, motoBody, motoWheel } from './scenes/air';
import {
  bikeBody,
  bikeWheel,
  blank,
  carBg,
  carBody,
  carWheel,
  trainBg,
  trainBody,
  trainFg,
  trainWheel,
} from './scenes/road';
import { golfBg, golfBody } from './scenes/swing';
import { FRAG, SUBJECT_ID, VERT } from './shader';

const VIEWS: Record<Subject, View> = {
  prop: [0, 0, 1, 1],
  train: TRAIN_VIEW,
  car: CAR_VIEW,
  golf: GOLF_VIEW,
  moto: MOTO_VIEW,
  heli: HELI_VIEW,
};
/** 題材ごとのテクスチャ 0〜5（背景・絵 1・絵 2・手前・絵 3・絵 4） */
const PAINT: Record<Subject, () => HTMLCanvasElement[]> = {
  prop: () => [],
  train: () => [trainBg(), trainBody(), trainWheel(), trainFg()],
  car: () => [carBg(), carBody(), carWheel(), blank(), bikeBody(), bikeWheel()],
  golf: () => [golfBg(), golfBody()],
  moto: () => [motoBg(), motoBody(), motoWheel()],
  heli: () => [heliBg(), heliBody()],
};

export interface Frame {
  subject: Subject;
  p: Inputs;
  /** 羽の数・逆回転（プロペラ） */
  nb: number;
  rev: boolean;
  /** 最初の行の露光の始まりの時刻 */
  t0: number;
  /** 0: 上から下、1: 左から右 */
  dir: 0 | 1;
  /** 読み出した行の割合（1 で全部）と、まだ読み出していない行に描く今の時刻 */
  cut: number;
  now: number;
  /** 露光の間に平均する時刻の数 */
  k: number;
}

export class RsRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly u = new Map<string, WebGLUniformLocation | null>();
  private readonly tex = new Map<Subject, WebGLTexture[]>();
  private readonly empty: WebGLTexture;
  /** シェーダーの準備が終わると解決する。それまで draw を呼ばない */
  readonly ready: Promise<void>;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.prog = startProgram(gl, VERT, FRAG, 'aPos');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.empty = this.upload(blank());
    this.ready = programReady(gl, this.prog).then(() => {
      gl.useProgram(this.prog);
      for (let i = 0; i < 6; i++) gl.uniform1i(this.loc(`uTex${i}`), i);
    });
  }

  private loc(n: string): WebGLUniformLocation | null {
    if (!this.u.has(n)) this.u.set(n, this.gl.getUniformLocation(this.prog, n));
    return this.u.get(n) ?? null;
  }

  private upload(c: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new Error('texture');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** 題材の絵を用意する（初めて使うときだけ描く） */
  private textures(s: Subject): WebGLTexture[] {
    let t = this.tex.get(s);
    if (!t) {
      t = PAINT[s]().map((c) => this.upload(c));
      this.tex.set(s, t);
    }
    return t;
  }

  /** 題材ごとの入力 uP */
  private params(f: Frame): [number, number, number, number] {
    const { p } = f;
    const tm = f.t0 + p.tr / 2 + p.te / 2;
    switch (f.subject) {
      case 'prop':
        return [(f.rev ? -1 : 1) * p.rps, f.nb, 0, 0];
      case 'train': {
        const v = p.kmh / 3.6;
        return [v, TRAIN_MID - 10.25 - v * tm, 0, 0];
      }
      case 'car': {
        const v = p.kmh / 3.6;
        const vb = p.bike / 3.6;
        return [v, CAR_MID - v * tm, vb, BIKE_MID - vb * tm];
      }
      case 'golf': {
        const k = p.vs / GOLF_V0;
        return [k, GOLF.smash * p.vs, 0, 0];
      }
      case 'moto':
        return [0, 0, 0, 0];
      case 'heli':
        return [p.rotor, 0, 0, 0];
    }
  }

  draw(f: Frame): void {
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this.loc('uR'), w, h);
    gl.uniform1i(this.loc('uS'), SUBJECT_ID[f.subject]);
    gl.uniform1i(this.loc('uDir'), f.dir);
    gl.uniform1i(this.loc('uLive'), 0);
    gl.uniform1i(this.loc('uK'), Math.max(1, Math.min(48, Math.round(f.k))));
    gl.uniform1f(this.loc('uT0'), f.t0);
    gl.uniform1f(this.loc('uTr'), f.p.tr);
    gl.uniform1f(this.loc('uTe'), f.p.te);
    gl.uniform1f(this.loc('uCut'), f.cut);
    gl.uniform1f(this.loc('uNow'), f.now);
    gl.uniform4f(this.loc('uView'), ...VIEWS[f.subject]);
    gl.uniform4f(this.loc('uP'), ...this.params(f));
    const t = this.textures(f.subject);
    for (let i = 0; i < 6; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t[i] ?? this.empty);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/**
 * 描画（WebGL2）。隠したキャンバスに区画を並べて描き、呼び出し側が 2D のキャンバスへ写す。
 * 計算は入力が変わったときだけで、毎フレームは描かない
 */
import type { Vec3 } from '../../lib/brdf';
import { type Camera, STRIDE } from './mesh';
import { LUT_N, type LutSet } from './models';
import { FRAG, VERT } from './shader';

/** 区画の位置（左上が原点。キャンバスの上の座標） */
export interface Tile {
  x: number;
  y: number;
  s: number;
}

export interface Draw {
  mesh: Mesh;
  cam: Camera;
  model: number;
  mode: number;
  interp: number;
  /** 光の種類: 0 平行光（uLight は向き）・1 点光源（uLight は位置） */
  kind: number;
  light: Vec3;
  /** 色 × 明るさ */
  li: Vec3;
  amb: number;
  diff: Vec3;
  f0: Vec3;
  ks: Vec3;
  a: number;
  rough: number;
  nP: number;
  nB: number;
  norm: boolean;
  ms: boolean;
  /** なだらかに白へ寄せるか（項の値とファーネステストはそのまま） */
  tone: boolean;
  /** 背景（sRGB、0 か 1） */
  clear: number;
}

export interface Mesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  count: number;
}

export class ShadeRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2');
    this.gl = gl;
    this.prog = this.build(VERT, FRAG);
    gl.useProgram(this.prog);
    for (const n of [
      'uModel',
      'uMode',
      'uInterp',
      'uKind',
      'uDiff',
      'uF0',
      'uKs',
      'uLight',
      'uLi',
      'uEye',
      'uA',
      'uRough',
      'uNP',
      'uNB',
      'uAmb',
      'uNorm',
      'uMs',
      'uLut',
      'uT',
      'uK',
      'uTone',
    ])
      this.u[n] = gl.getUniformLocation(this.prog, n);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, LUT_N, LUT_N, 3);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.uLut, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.SCISSOR_TEST);
  }

  private build(vs: string, fs: string): WebGLProgram {
    const { gl } = this,
      p = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(type);
      if (!s) throw new Error('shader');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  setLuts(l: LutSet): void {
    const { gl } = this;
    [l.phong, l.blinn, l.ggx].forEach((t, i) => {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, LUT_N, LUT_N, 1, gl.RGBA, gl.FLOAT, t);
    });
  }

  mesh(data: Float32Array, old?: Mesh): Mesh {
    const { gl } = this;
    if (old) {
      gl.deleteVertexArray(old.vao);
      gl.deleteBuffer(old.vbo);
    }
    const vao = gl.createVertexArray(),
      vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    ['aP', 'aN', 'aFP', 'aFN'].forEach((n, i) => {
      const loc = gl.getAttribLocation(this.prog, n);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, STRIDE * 4, i * 12);
    });
    return { vao, vbo, count: data.length / STRIDE };
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  draw(t: Tile, d: Draw): void {
    const { gl, u } = this,
      y = this.canvas.height - t.y - t.s;
    gl.viewport(t.x, y, t.s, t.s);
    gl.scissor(t.x, y, t.s, t.s);
    gl.clearColor(d.clear, d.clear, d.clear, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1i(u.uModel, d.model);
    gl.uniform1i(u.uMode, d.mode);
    gl.uniform1i(u.uInterp, d.interp);
    gl.uniform1i(u.uKind, d.kind);
    gl.uniform3fv(u.uDiff, d.diff);
    gl.uniform3fv(u.uF0, d.f0);
    gl.uniform3fv(u.uKs, d.ks);
    gl.uniform3fv(u.uLight, d.light);
    gl.uniform3fv(u.uLi, d.li);
    gl.uniform3fv(u.uEye, d.cam.eye);
    gl.uniform1f(u.uA, d.a);
    gl.uniform1f(u.uRough, d.rough);
    gl.uniform1f(u.uNP, d.nP);
    gl.uniform1f(u.uNB, d.nB);
    gl.uniform1f(u.uAmb, d.amb);
    gl.uniform1i(u.uNorm, d.norm ? 1 : 0);
    gl.uniform1i(u.uMs, d.ms ? 1 : 0);
    gl.uniform1f(u.uT, d.cam.t);
    gl.uniform1f(u.uK, d.cam.k);
    gl.uniform1i(u.uTone, d.tone ? 1 : 0);
    gl.bindVertexArray(d.mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
  }

  /** 区画の画素を 2D のキャンバスへ写す */
  blit(c: CanvasRenderingContext2D, t: Tile): void {
    c.drawImage(this.canvas, t.x, t.y, t.s, t.s, 0, 0, t.s, t.s);
  }
}

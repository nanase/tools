/**
 * WebGL2 の描画。反復のテクスチャ（R32F）を 2 枚持ち、表示中の 1 枚に粗い絵を一度に描くか、
 * もう 1 枚へ細かい絵を横の帯に分けて描き、できたら差し替える。1 回の描画で全部を作ると、
 * 深い所では GPU の監視に止められることがある
 */
import { programReady, startProgram } from '../../lib/gl-program';
import type { Formula } from './formula';
import { BAIL, isInt } from './formula';
import type { Orbit } from './orbit';
import { palOf } from './palette';
import { COLOR_FRAG, ITER_FRAG, VERT } from './shader';

export interface IterParams {
  max: number;
  f: Formula;
  /** 図の高さの半分に入る長さ */
  span: number;
  /** 0 摂動法、1 そのまま（単精度）、2 ジュリア集合 */
  mode: 0 | 1 | 2;
  /** 図の中心の、基準の点からのずれ（摂動法） */
  off: readonly [number, number];
  /** 図の中心（そのまま・ジュリア集合） */
  cen: readonly [number, number];
  /** ジュリア集合の c */
  jc: readonly [number, number];
}

export interface ColorParams {
  pal: string;
  den: number;
  ofs: number;
  shade: number;
}

interface Prog {
  p: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}
interface Tex {
  t: WebGLTexture;
  f: WebGLFramebuffer;
}

/** 基準の軌道のテクスチャの幅（シェーダの Zat と同じ） */
const REF_W = 4096;

export class Renderer {
  W = 0;
  H = 0;
  private its: Tex[] = [];
  private co: Tex | null = null;
  private cur = 0;
  /** 表示中の絵の大きさ（粗い絵では W・H より小さい） */
  private w = 1;
  private h = 1;
  private refTex: WebGLTexture;
  private refLen = 1;

  private constructor(
    readonly gl: WebGL2RenderingContext,
    private pi: Prog,
    private pc: Prog,
  ) {
    this.refTex = gl.createTexture();
  }

  /** WebGL2 か浮動小数点のテクスチャへの描画がなければ null */
  static async create(cv: HTMLCanvasElement): Promise<Renderer | null> {
    const gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
    if (!gl?.getExtension('EXT_color_buffer_float')) return null;
    const vao = gl.createVertexArray(),
      buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const mk = async (frag: string): Promise<Prog> => {
      const p = startProgram(gl, VERT, frag, 'aPos');
      await programReady(gl, p);
      const u = new Map<string, WebGLUniformLocation | null>();
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(p, i)?.name;
        if (name) u.set(name.replace(/\[0\]$/, ''), gl.getUniformLocation(p, name));
      }
      return { p, u };
    };
    try {
      const [pi, pc] = await Promise.all([mk(ITER_FRAG), mk(COLOR_FRAG)]);
      return new Renderer(gl, pi, pc);
    } catch {
      return null;
    }
  }

  private tex(ifmt: number, fmt: number, type: number): Tex {
    const gl = this.gl,
      t = gl.createTexture(),
      f = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, this.W, this.H, 0, fmt, type, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f };
  }

  /** 描く画素の大きさ。変わったらテクスチャを作り直す */
  size(W: number, H: number): void {
    if (W === this.W && H === this.H) return;
    const gl = this.gl;
    for (const x of [...this.its, ...(this.co ? [this.co] : [])]) {
      gl.deleteTexture(x.t);
      gl.deleteFramebuffer(x.f);
    }
    this.W = gl.canvas.width = W;
    this.H = gl.canvas.height = H;
    this.its = [0, 1].map(() => this.tex(gl.R32F, gl.RED, gl.FLOAT));
    this.co = this.tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.cur = 0;
    this.w = W;
    this.h = H;
  }

  setRef(o: Orbit): void {
    const gl = this.gl,
      rows = Math.max(1, Math.ceil(o.len / REF_W)),
      d = new Float32Array(REF_W * rows * 2);
    d.set(o.data.subarray(0, Math.min(o.data.length, 2 * o.len)));
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, REF_W, rows, 0, gl.RG, gl.FLOAT, d);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    this.refLen = o.len;
  }

  private iter(P: IterParams, tg: Tex, w: number, h: number, y0 = 0, y1 = h): void {
    const gl = this.gl,
      { p, u } = this.pi,
      U = (n: string) => u.get(n) ?? null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg.f);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, y0, w, y1 - y0);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.uniform1i(U('uRef'), 0);
    gl.uniform1i(U('uRefLen'), this.refLen);
    gl.uniform1i(U('uMax'), P.max);
    gl.uniform1i(U('uP'), Math.round(P.f.p));
    gl.uniform1i(U('uMode'), P.mode);
    gl.uniform1i(U('uInt'), isInt(P.f.p) ? 1 : 0);
    gl.uniform1f(U('uPf'), P.f.p);
    gl.uniform1f(U('uPre'), P.f.pre);
    gl.uniform1f(U('uPost'), P.f.post);
    gl.uniform1f(U('uConj'), P.f.conj ? -1 : 1);
    gl.uniform1f(U('uSpan'), P.span);
    gl.uniform1f(U('uBail'), BAIL);
    gl.uniform2f(U('uRes'), w, h);
    gl.uniform2f(U('uOff'), P.off[0], P.off[1]);
    gl.uniform2f(U('uCen'), P.cen[0], P.cen[1]);
    gl.uniform2f(U('uJc'), P.jc[0], P.jc[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** 表示中の絵を、全体の s 倍の解像度で一度に描く */
  frame(P: IterParams, s: number): void {
    this.w = Math.max(1, Math.round(this.W * s));
    this.h = Math.max(1, Math.round(this.H * s));
    this.iter(P, this.its[this.cur], this.w, this.h);
  }

  /** 作成中の絵の y0〜y1 行を全解像度で描く */
  strip(P: IterParams, y0: number, y1: number): void {
    this.iter(P, this.its[1 - this.cur], this.W, this.H, y0, y1);
  }

  /** 作成中の絵を表示中にする */
  swap(): void {
    this.cur = 1 - this.cur;
    this.w = this.W;
    this.h = this.H;
  }

  /** 表示中の絵に色を付けて、キャンバスへ広げて写す */
  color(C: ColorParams): void {
    const gl = this.gl,
      co = this.co;
    if (!co) return;
    const { p, u } = this.pc,
      U = (n: string) => u.get(n) ?? null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, co.f);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.its[this.cur].t);
    gl.uniform1i(U('uIt'), 0);
    const st = palOf(C.pal).s,
      a = new Float32Array(24);
    for (const [i, c] of st.entries()) a.set([c[0] / 255, c[1] / 255, c[2] / 255], i * 3);
    gl.uniform3fv(U('uSt'), a);
    gl.uniform1i(U('uN'), st.length);
    gl.uniform1f(U('uDen'), C.den);
    gl.uniform1f(U('uOfs'), C.ofs);
    gl.uniform1f(U('uShade'), C.shade);
    gl.uniform2f(U('uRes'), this.w, this.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, co.f);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      this.w,
      this.h,
      0,
      0,
      this.W,
      this.H,
      gl.COLOR_BUFFER_BIT,
      this.w === this.W ? gl.NEAREST : gl.LINEAR,
    );
  }

  /** GPU の仕事の終わりを待つ（帯の高さを合わせるために時間を測る） */
  finish(): void {
    this.gl.finish();
  }
}

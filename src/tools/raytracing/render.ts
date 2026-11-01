/**
 * WebGL2 の描画: 浮動小数点のテクスチャを 2 組交互に使ってサンプルの和をため、平均を画面に出す。
 * 画面（表には出さないキャンバス）を区画に分け、区画ごとに別の設定でためる
 */
import { type Camera, cross, norm, type PackedScene, sub } from './scene';
import { DIFF_FRAG, DISPLAY_FRAG, TRACE_FRAG, VERT } from './shader';

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 数える反射の回数の範囲 */
  minB: number;
  maxB: number;
  seed: number;
  samples: number;
}

interface Target {
  a: WebGLTexture;
  b: WebGLTexture;
  fb: WebGLFramebuffer;
}

type Prog = { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };

/** 誤差を見るときの間引き */
const DIFF_STEP = 4;

export class PathRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly trace: Prog;
  private readonly disp: Prog;
  private readonly diff: Prog;
  private readonly vao: WebGLVertexArrayObject;
  private readonly diffTex: WebGLTexture;
  private readonly diffFb: WebGLFramebuffer;
  private tg: Target[] = [];
  private cur = 0;
  private w = 0;
  private h = 0;
  private pack: PackedScene | null = null;
  private cam: Camera | null = null;
  /** 積分のやり方とロシアンルーレット */
  integ = 2;
  rr = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('webgl2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('float');
    this.gl = gl;
    const vao = gl.createVertexArray(),
      buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    this.trace = this.program(TRACE_FRAG);
    this.disp = this.program(DISPLAY_FRAG);
    this.diff = this.program(DIFF_FRAG);
    this.diffTex = gl.createTexture();
    this.diffFb = gl.createFramebuffer();
  }

  private program(frag: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error('shader');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile');
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u = new Map<string, WebGLUniformLocation | null>();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i)?.name.replace(/\[0\]$/, '');
      if (name) u.set(name, gl.getUniformLocation(p, name));
    }
    return { p, u };
  }

  /** 全体の大きさを決めて、ためるテクスチャを作り直す */
  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.canvas.width = w;
    this.canvas.height = h;
    for (const t of this.tg) {
      gl.deleteTexture(t.a);
      gl.deleteTexture(t.b);
      gl.deleteFramebuffer(t.fb);
    }
    const tex = () => {
      const x = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, x);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
      return x;
    };
    this.tg = [0, 1].map(() => {
      const a = tex(),
        b = tex(),
        fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      return { a, b, fb };
    });
    this.w = w;
    this.h = h;
  }

  setScene(p: PackedScene, c: Camera): void {
    this.pack = p;
    this.cam = c;
  }

  /**
   * 区画ごとにサンプルを足す。[区画, 本数] の本数が 0 なら、今の和を次のテクスチャへ写すだけにする。
   * 並べなかった区画の中身は古くなる（次に使う前にためなおす）
   */
  step(jobs: readonly (readonly [Tile, number])[]): void {
    const gl = this.gl,
      P = this.pack,
      c = this.cam;
    if (!P || !c) return;
    const { p, u } = this.trace,
      U = (k: string) => u.get(k) ?? null;
    const src = this.tg[this.cur],
      dst = this.tg[1 - this.cur];
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.a);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.b);
    gl.uniform1i(U('uPrevA'), 0);
    gl.uniform1i(U('uPrevB'), 1);
    const fwd = norm(sub(c.at, c.eye)),
      right = norm(cross(fwd, [0, 1, 0])),
      up = cross(right, fwd);
    gl.uniform3f(U('uEye'), c.eye[0], c.eye[1], c.eye[2]);
    gl.uniform3f(U('uFwd'), fwd[0], fwd[1], fwd[2]);
    gl.uniform3f(U('uUp'), up[0] * c.fov, up[1] * c.fov, up[2] * c.fov);
    gl.uniform2f(U('uLens'), c.lens, c.focus);
    gl.uniform1i(U('uInteg'), this.integ);
    gl.uniform1i(U('uRR'), this.rr ? 1 : 0);
    gl.uniform4fv(U('uQuad'), P.quad);
    gl.uniform4fv(U('uSph'), P.sph);
    gl.uniform4fv(U('uMat'), P.mat);
    gl.uniform4fv(U('uLit'), P.lit);
    gl.uniform3fv(U('uLitE'), P.litE);
    gl.uniform1i(U('uLitK'), P.litK);
    gl.uniform1i(U('uNQ'), P.nq);
    gl.uniform1i(U('uNS'), P.ns);
    gl.bindVertexArray(this.vao);
    for (const [t, n] of jobs) {
      const ar = (t.w / t.h) * c.fov;
      gl.scissor(t.x, t.y, t.w, t.h);
      gl.uniform3f(U('uRight'), right[0] * ar, right[1] * ar, right[2] * ar);
      gl.uniform1i(U('uReset'), t.samples === 0 ? 1 : 0);
      gl.uniform4f(U('uTile'), t.x, t.y, t.w, t.h);
      gl.uniform1ui(U('uBase'), t.samples);
      gl.uniform1i(U('uSpp'), n);
      gl.uniform1i(U('uSeed'), t.seed);
      gl.uniform1i(U('uMinB'), t.minB);
      gl.uniform1i(U('uMaxB'), t.maxB);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      t.samples += n;
    }
    gl.disable(gl.SCISSOR_TEST);
    this.cur = 1 - this.cur;
  }

  /** ためた平均をキャンバスへ出す */
  show(): void {
    const gl = this.gl,
      { p, u } = this.disp;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tg[this.cur].a);
    gl.uniform1i(u.get('uAcc') ?? null, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** 偶数番と奇数番のサンプルの差から平均の画像の RMSE を見積もる。あわせて輝度の平均も返す */
  measure(t: Tile): { rmse: number; mean: number } {
    const gl = this.gl,
      { p, u } = this.diff,
      W = Math.max(1, Math.floor(t.w / DIFF_STEP)),
      H = Math.max(1, Math.floor(t.h / DIFF_STEP));
    gl.bindTexture(gl.TEXTURE_2D, this.diffTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.diffFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.diffTex, 0);
    gl.useProgram(p);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tg[this.cur].a);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tg[this.cur].b);
    gl.uniform1i(u.get('uA') ?? null, 0);
    gl.uniform1i(u.get('uB') ?? null, 1);
    gl.uniform4f(u.get('uTile') ?? null, t.x, t.y, t.w, t.h);
    gl.uniform1i(u.get('uStep') ?? null, DIFF_STEP);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Float32Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
    let s = 0,
      m = 0;
    for (let i = 0; i < W * H; i++) {
      s += out[i * 4];
      m += out[i * 4 + 1];
    }
    /* 2 つの半分の差の分散は、全体の平均の分散の 4 倍 */
    return { rmse: Math.sqrt(s / (W * H)) / 2, mean: m / (W * H) };
  }
}

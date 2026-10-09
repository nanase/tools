/**
 * WebGL2 の描画: 浮動小数点のテクスチャ 2 枚を交互に使って光線の和をためていき、表示の画面に平均を出す。
 * 設定が変わったらやり直す。操作している間は解像度を下げ、止まったら全解像度で目標の本数までためる
 */
import { DISPLAY_FRAG, traceFrag, VERT } from './shader';

/** レンズとピントで決まる値（変わったらやり直す） */
export interface LensU {
  ns: number;
  S: Float32Array;
  B: Float32Array;
  C: Float32Array;
  P: Float32Array;
  hmax: number;
  /** センサーの z、射出瞳の面の z、正規化 1/(π r²)、回折の実効 F 値（0 は入れない） */
  opt: [number, number, number, number];
  /** 外接円の半径・羽根の枚数・cos(π/n) */
  stop: [number, number, number];
  mode: 0 | 1;
  ideal: [number, number, number, number];
  chrom: boolean;
}

/** 向きと描く範囲 */
export interface ViewU {
  view: [number, number, number, number];
  right: number[];
  up: number[];
  fwd: number[];
  eye: number[];
  /** 時間帯（0 昼・1 夕暮れ・2 夜） */
  tod: number;
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
}

/** 全解像度でためる本数の目標と、操作中に下げる解像度の倍率 */
const GOAL = 1024,
  LOW = 0.5,
  IDLE_MS = 280;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private progs = new Map<number, { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }>();
  private disp: { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };
  private vao: WebGLVertexArrayObject;
  private tg: Target[] = [];
  private w = 0;
  private h = 0;
  private cur = 0;
  private lens: LensU | null = null;
  private vw: ViewU | null = null;
  private samples = 0;
  private spp = 1;
  private scale = 1;
  private lastChange = -1e9;
  private raf = 0;
  private lastT = 0;
  private visible = true;
  /** ためた本数を知らせる */
  onProgress?: (spp: number, w: number, h: number, done: boolean) => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, premultipliedAlpha: false });
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
    this.disp = this.program(DISPLAY_FRAG, ['uAcc', 'uSrc', 'uDst', 'uExp']);
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible) this.kick();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => this.kick());
  }

  private program(frag: string, names: string[]) {
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
    return { p, u: new Map(names.map((n) => [n, gl.getUniformLocation(p, n)])) };
  }

  private traceProg(ns: number) {
    let pr = this.progs.get(ns);
    if (!pr) {
      pr = this.program(traceFrag(ns), [
        'uPrev',
        'uReset',
        'uS',
        'uB',
        'uC',
        'uP',
        'uHmax',
        'uOpt',
        'uStop',
        'uView',
        'uRes',
        'uBase',
        'uSpp',
        'uRight',
        'uUp',
        'uFwd',
        'uEye',
        'uMode',
        'uIdeal',
        'uChrom',
        'uTod',
      ]);
      this.progs.set(ns, pr);
    }
    return pr;
  }

  /** 描く大きさ（ためるテクスチャ）を合わせる */
  private alloc(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    for (const t of this.tg) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }
    this.tg = [0, 1].map(() => {
      const tex = gl.createTexture(),
        fb = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    });
    this.w = w;
    this.h = h;
  }

  /** レンズ・向きを変える。やり直し、しばらくは解像度を下げて描く */
  set(lens: LensU, vw: ViewU): void {
    this.lens = lens;
    this.vw = vw;
    this.samples = 0;
    this.lastChange = performance.now();
    this.kick();
  }

  /** ためたものを捨てて描き直す（キャンバスの大きさが変わったときなど） */
  redraw(): void {
    this.samples = 0;
    this.kick();
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (t: number): void => {
    this.raf = 0;
    if (!this.lens || !this.vw || !this.visible || document.hidden) return;
    const busy = performance.now() - this.lastChange < IDLE_MS;
    const sc = busy ? LOW : 1;
    if (sc !== this.scale) {
      /* 画素の数が変わるぶん、1 回の本数も変える */
      this.spp = Math.max(1, Math.round((this.spp * (this.scale * this.scale)) / (sc * sc)));
      this.scale = sc;
      this.samples = 0;
    }
    const goal = busy ? 64 : GOAL;
    if (this.samples >= goal) {
      if (busy) this.raf = requestAnimationFrame(this.tick);
      return;
    }
    /* 前の回からの間隔で、1 回に追跡する本数を調整する（20〜34 ms に収める） */
    const dt = t - this.lastT;
    this.lastT = t;
    if (this.samples > 0 && dt > 0) {
      if (dt < 22) this.spp = Math.min(32, Math.ceil(this.spp * 1.3));
      else if (dt > 36) this.spp = Math.max(1, Math.floor(this.spp * 0.7));
    }
    if (this.samples === 0 && busy) this.spp = Math.min(this.spp, 4);
    const W = Math.max(1, Math.round(this.canvas.width * sc)),
      H = Math.max(1, Math.round(this.canvas.height * sc));
    this.alloc(W, H);
    this.trace(Math.min(this.spp, goal - this.samples));
    this.show();
    this.onProgress?.(this.samples, W, H, this.samples >= goal && !busy);
    this.raf = requestAnimationFrame(this.tick);
  };

  private trace(spp: number): void {
    const gl = this.gl,
      L = this.lens,
      V = this.vw;
    if (!L || !V) return;
    const pr = this.traceProg(L.ns),
      u = (n: string) => pr.u.get(n) ?? null;
    const src = this.tg[this.cur],
      dst = this.tg[1 - this.cur];
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(u('uPrev'), 0);
    gl.uniform1i(u('uReset'), this.samples === 0 ? 1 : 0);
    gl.uniform4fv(u('uS'), L.S);
    gl.uniform4fv(u('uB'), L.B);
    gl.uniform4fv(u('uC'), L.C);
    gl.uniform4fv(u('uP'), L.P);
    gl.uniform1f(u('uHmax'), L.hmax);
    gl.uniform4fv(u('uOpt'), L.opt);
    gl.uniform3fv(u('uStop'), L.stop);
    gl.uniform4fv(u('uView'), V.view);
    gl.uniform2f(u('uRes'), this.w, this.h);
    gl.uniform1ui(u('uBase'), this.samples);
    gl.uniform1i(u('uSpp'), spp);
    gl.uniform3fv(u('uRight'), V.right);
    gl.uniform3fv(u('uUp'), V.up);
    gl.uniform3fv(u('uFwd'), V.fwd);
    gl.uniform3fv(u('uEye'), V.eye);
    gl.uniform1i(u('uMode'), L.mode);
    gl.uniform4fv(u('uIdeal'), L.ideal);
    gl.uniform1f(u('uChrom'), L.chrom ? 1 : 0);
    gl.uniform1i(u('uTod'), V.tod);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
    this.samples += spp;
  }

  private show(): void {
    const gl = this.gl,
      { p, u } = this.disp;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tg[this.cur].tex);
    gl.uniform1i(u.get('uAcc') ?? null, 0);
    gl.uniform2f(u.get('uSrc') ?? null, this.w, this.h);
    gl.uniform2f(u.get('uDst') ?? null, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.get('uExp') ?? null, 1.25);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

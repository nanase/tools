/**
 * WebGL2 で月を描く。読み込んだ標高から、傾きと東西の地平線の高度角を一度だけ前処理してテクスチャに持ち、
 * 毎回の描画は全画面の三角形 1 枚で済ませる。小さな月（暦の欄）は別の枠に描いて読み出す
 */
import { MOON_FRAG, PREP_FRAG, TH, TW, VERT } from './shader';

export type Vec3 = [number, number, number];

/** Mallama (2022) 表 B.1: 影の位置（0 = 半影の外縁、1 = 中心）と B・V・R の減光 [等] */
const MAL = [
  [0, 0, 0, 0],
  [0.02, 0.02, 0.02, 0.03],
  [0.041, 0.06, 0.06, 0.07],
  [0.061, 0.11, 0.11, 0.12],
  [0.082, 0.17, 0.17, 0.18],
  [0.102, 0.24, 0.24, 0.24],
  [0.122, 0.32, 0.32, 0.32],
  [0.143, 0.41, 0.41, 0.41],
  [0.163, 0.51, 0.51, 0.51],
  [0.184, 0.63, 0.63, 0.63],
  [0.204, 0.76, 0.76, 0.75],
  [0.224, 0.92, 0.91, 0.9],
  [0.245, 1.09, 1.08, 1.06],
  [0.265, 1.3, 1.28, 1.26],
  [0.286, 1.54, 1.51, 1.49],
  [0.306, 1.83, 1.8, 1.77],
  [0.327, 2.19, 2.14, 2.1],
  [0.347, 2.64, 2.58, 2.53],
  [0.367, 3.24, 3.15, 3.08],
  [0.388, 4.15, 4.02, 3.91],
  [0.408, 6.04, 5.76, 5.5],
  [0.429, 7.32, 6.76, 6.28],
  [0.449, 8.07, 7.31, 6.68],
  [0.469, 8.74, 7.78, 7.01],
  [0.49, 9.39, 8.22, 7.3],
  [0.51, 10.04, 8.65, 7.57],
  [0.531, 10.71, 9.07, 7.83],
  [0.551, 11.35, 9.47, 8.08],
  [0.571, 11.97, 9.86, 8.31],
  [0.592, 12.58, 10.23, 8.52],
  [0.612, 13.17, 10.59, 8.74],
  [0.632, 13.76, 10.94, 8.94],
  [0.653, 14.33, 11.29, 9.13],
  [0.673, 14.9, 11.63, 9.32],
  [0.694, 15.46, 11.96, 9.5],
  [0.714, 16.02, 12.28, 9.68],
  [0.734, 16.57, 12.6, 9.85],
  [0.755, 17.11, 12.91, 10],
  [0.775, 17.65, 13.22, 10.15],
  [0.796, 18.19, 13.52, 10.29],
  [0.816, 18.72, 13.8, 10.42],
  [0.837, 19.24, 14.08, 10.53],
  [0.857, 19.74, 14.34, 10.64],
  [0.878, 20.23, 14.58, 10.73],
  [0.898, 20.68, 14.8, 10.81],
  [0.918, 21.12, 15, 10.88],
  [0.939, 21.52, 15.17, 10.94],
  [0.959, 21.86, 15.3, 10.98],
  [0.98, 22.11, 15.39, 11.01],
  [1, 22.24, 15.44, 11.02],
];
/** 表で本影の縁にあたる位置 */
export const POS_U = 0.429;

/** 影の位置（POS_U で区切った区分線形）から V の減光 [等] を引く。露出の目安に使う */
export function malV(th: number, Ru: number, Rp: number): number {
  const pos = Math.min(
    1,
    Math.max(0, th > Ru ? (POS_U * (Rp - th)) / (Rp - Ru) : POS_U + ((1 - POS_U) * (Ru - th)) / Ru),
  );
  for (let i = 1; i < MAL.length; i++) {
    const [x1, , v1] = MAL[i];
    if (pos <= x1) {
      const [x0, , v0] = MAL[i - 1];
      return v0 + ((v1 - v0) * (pos - x0)) / (x1 - x0);
    }
  }
  return MAL[MAL.length - 1][2];
}

/** 1 枚の月を描くのに要る値（ベクトルは月固定の座標） */
export interface MoonU {
  /** 画面の右・上・奥（観測者から月へ） */
  r: Vec3;
  u: Vec3;
  f: Vec3;
  /** 月から太陽・観測者への向き */
  s: Vec3;
  o: Vec3;
  /** 位相角 [rad] と測光の赤道の極（Akimov の関数）、明るさの倍率、地球照（直射に対する比）、彩度 */
  A: number;
  np: Vec3;
  gain: number;
  es: number;
  sat: number;
  /** 月食: 月の中心（地心、km）、月固定 → 地心の座標の行列（列が月の x・y・z 軸）、影の軸、本影・半影の半径 [°] */
  ecl?: { mc: Vec3; b2f: number[]; ax: Vec3; Ru: number; Rp: number };
}

/** 描く場所（キャンバスの画素、左下が原点）と円盤 */
export interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 円盤の中心（場所の左下から）と半径 [px] */
  cx: number;
  cy: number;
  rad: number;
}

type Prog = { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };

export class MoonRenderer {
  readonly gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private moon: Prog;
  private color: WebGLTexture | null = null;
  private terr: WebGLTexture | null = null;
  private iconFb: { fb: WebGLFramebuffer; tex: WebGLTexture; n: number } | null = null;
  ready = false;

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
    this.moon = this.program(MOON_FRAG, [
      'uC',
      'uT',
      'uR',
      'uU',
      'uF',
      'uS',
      'uO',
      'uDisk',
      'uA',
      'uNp',
      'uGain',
      'uEs',
      'uSat',
      'uEcl',
      'uMc',
      'uAx',
      'uB2F',
      'uSh',
      'uMal',
    ]);
    gl.useProgram(this.moon.p);
    gl.uniform4fv(this.moon.u.get('uMal') ?? null, new Float32Array(MAL.flat()));
  }

  private program(frag: string, names: string[]): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram() as WebGLProgram;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return { p, u: new Map(names.map((n) => [n, gl.getUniformLocation(p, n)])) };
  }

  /** 色（JPEG）と標高（PNG）を読み、地形のテクスチャを作る */
  async load(colorUrl: string, heightUrl: string): Promise<void> {
    const gl = this.gl;
    const bmp = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    };
    const [cb, hb] = await Promise.all([bmp(colorUrl), bmp(heightUrl)]);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    /* 色は sRGB として読み、線形の値で混ぜる */
    this.color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, cb);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.filter(true);
    /* 標高は値そのまま（2 バイト）で読む */
    const ht = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, ht);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, hb);
    this.filter(false);
    cb.close();
    hb.close();
    /* 前処理: 傾きと地平線 */
    this.terr = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.terr);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(TW, TH))) + 1, gl.RGBA16F, TW, TH);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.terr, 0);
    const prep = this.program(PREP_FRAG, ['uH']);
    gl.useProgram(prep.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ht);
    gl.uniform1i(prep.u.get('uH') ?? null, 0);
    gl.viewport(0, 0, TW, TH);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(ht);
    gl.deleteProgram(prep.p);
    gl.bindTexture(gl.TEXTURE_2D, this.terr);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.filter(true);
    this.ready = true;
  }

  private filter(mip: boolean): void {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mip ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** キャンバスの大きさを表示の大きさに合わせる（装置の画素） */
  fit(): boolean {
    const c = this.canvas,
      d = Math.min(devicePixelRatio || 1, 2),
      w = Math.round(c.clientWidth * d),
      h = Math.round(c.clientHeight * d);
    if (c.width === w && c.height === h) return false;
    c.width = w;
    c.height = h;
    return true;
  }

  /** 画面を黒で消す */
  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** 1 枚の月を、場所の中だけに描く */
  draw(m: MoonU, at: Place): void {
    if (!this.ready) return;
    const gl = this.gl,
      u = this.moon.u,
      g = (n: string) => u.get(n) ?? null;
    gl.useProgram(this.moon.p);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.uniform1i(g('uC'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.terr);
    gl.uniform1i(g('uT'), 1);
    gl.uniform3fv(g('uR'), m.r);
    gl.uniform3fv(g('uU'), m.u);
    gl.uniform3fv(g('uF'), m.f);
    gl.uniform3fv(g('uS'), m.s);
    gl.uniform3fv(g('uO'), m.o);
    gl.uniform3f(g('uDisk'), at.x + at.cx, at.y + at.cy, at.rad);
    gl.uniform1f(g('uA'), m.A);
    gl.uniform3fv(g('uNp'), m.np);
    gl.uniform1f(g('uGain'), m.gain);
    gl.uniform1f(g('uEs'), m.es);
    gl.uniform1f(g('uSat'), m.sat);
    gl.uniform1i(g('uEcl'), m.ecl ? 1 : 0);
    if (m.ecl) {
      gl.uniform3fv(g('uMc'), m.ecl.mc);
      gl.uniform3fv(g('uAx'), m.ecl.ax);
      gl.uniformMatrix3fv(g('uB2F'), false, m.ecl.b2f);
      gl.uniform2f(g('uSh'), m.ecl.Ru, m.ecl.Rp);
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(at.x, at.y, at.w, at.h);
    gl.viewport(at.x, at.y, at.w, at.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** 小さな月を描いて、2D のキャンバスに写す（暦の欄） */
  icon(m: MoonU, out: HTMLCanvasElement): void {
    if (!this.ready) return;
    const gl = this.gl,
      n = out.width;
    if (!this.iconFb || this.iconFb.n !== n) {
      if (this.iconFb) {
        gl.deleteFramebuffer(this.iconFb.fb);
        gl.deleteTexture(this.iconFb.tex);
      }
      const tex = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, n, n);
      const fb = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.iconFb = { fb, tex, n };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.iconFb.fb);
    this.draw(m, { x: 0, y: 0, w: n, h: n, cx: n / 2, cy: n / 2, rad: n / 2 - 0.5 });
    const px = new Uint8Array(n * n * 4);
    gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    /* 読み出しは下の行から。円の外は透明にする */
    const img = new ImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const s = ((n - 1 - y) * n + x) * 4,
          d = (y * n + x) * 4,
          r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2 - 0.5),
          a = Math.min(1, Math.max(0, (1 - r) * (n / 2) + 0.5));
        img.data[d] = px[s];
        img.data[d + 1] = px[s + 1];
        img.data[d + 2] = px[s + 2];
        img.data[d + 3] = Math.round(a * 255);
      }
    }
    out.getContext('2d')?.putImageData(img, 0, 0);
  }
}

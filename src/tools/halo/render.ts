/**
 * WebGL2 の描画: 光線を全天図（等立体角の円盤 2 枚、浮動小数のテクスチャ）に加算でためる。空と雲の照らされ方は
 * 光源の高度・雲の高さが変わったときだけ表に計算し直し、表示のたびに全天図と表を引いて合成する
 */
import { cmf, toRgb } from '../lens/light';
import { AOD, apparent, groundT, MAX_POP, moonRatio } from './scene';
import { FULL_VERT, MS_FRAG, MS_H, MS_W, SHOW_FRAG, SKY_FRAG, TRACE_FRAG, TRACE_VERT } from './shader';
import { dims, type Orient, type Population } from './trace';

const ORIENT: Record<Orient, number> = { random: 0, plate: 1, column: 2, parry: 3, lowitz: 4 };
const D2R = Math.PI / 180;
/** 空の表の大きさ（方位 × 高度） */
const SKY_W = 256,
  SKY_H = 160;
/** 光源の視半径 [rad]（太陽 0.2679°、月 0.259°） */
const srcR = (moon: boolean) => (moon ? 0.259 : 0.2679) * D2R;

/** 波長の色の正規化: 380〜780 nm を一様に平均すると (1, 1, 1) */
const NORM = (() => {
  const s = [0, 0, 0];
  for (let nm = 380; nm <= 780; nm++) {
    const v = toRgb(cmf(nm));
    for (let k = 0; k < 3; k++) s[k] += v[k] / 401;
  }
  return s.map((v) => 1 / v);
})();

export interface Source {
  /** 真の高度 [°] */
  elev: number;
  moon: boolean;
  /** 月齢 [日] */
  age: number;
}
export interface Cloud {
  /** 雲の光学的厚さ（鉛直） */
  tau: number;
  /** 粗い結晶の割合（0〜1） */
  rough: number;
  /** 雲の層の高さ [km] */
  hc: number;
}
export interface View {
  /** 0 魚眼、1 全天、2 カメラ */
  proj: 0 | 1 | 2;
  /** 画角 [°]（魚眼・カメラの横） */
  fov: number;
  /** 視線の方位 [°]（光源が 0、右が正）と高度 [°] */
  az: number;
  alt: number;
  /** 露出の補正 [EV] */
  ev: number;
  only: boolean;
}

interface Prog {
  p: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}

export class HaloRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly N: number;
  /** RGBA32F に加算できる（EXT_float_blend）。できなければ RGBA16F で、ためる本数に上限を設ける */
  readonly float32: boolean;
  readonly maxRays: number;
  private trace: Prog;
  private sky: Prog;
  private show: Prog;
  private map: WebGLTexture;
  private mapFb: WebGLFramebuffer;
  private skyTex: WebGLTexture;
  private illTex: WebGLTexture;
  private skyFb: WebGLFramebuffer;
  private msTex: WebGLTexture;
  private quad: WebGLVertexArrayObject;
  private empty: WebGLVertexArrayObject;
  private seed = 1;
  private src: Source = { elev: 23, moon: false, age: 14.8 };
  private cloud: Cloud = { tau: 0.3, rough: 0.63, hc: 8 };
  private skyKey = '';
  private expo = 1;
  private expoOnly = 1;
  /** 回折の広がりの代表（母集団の径の平均）[rad] */
  private sd = 0.02;
  /** ためた光線の数 */
  rays = 0;
  private px = new Float32Array(4);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    N = 1024,
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('webgl2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('float');
    this.float32 = !!gl.getExtension('EXT_float_blend');
    this.maxRays = this.float32 ? 6e8 : 2.5e7;
    this.gl = gl;
    this.N = N;
    this.trace = this.program(TRACE_VERT, TRACE_FRAG);
    gl.useProgram(this.trace.p);
    gl.uniform1i(this.loc(this.trace, 'uNB'), 17);
    this.sky = this.program(FULL_VERT, SKY_FRAG);
    this.show = this.program(FULL_VERT, SHOW_FRAG);
    const tex = (w: number, h: number, fmt: number, filt: number) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.map = tex(2 * N, N, this.float32 ? gl.RGBA32F : gl.RGBA16F, gl.NEAREST);
    this.mapFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mapFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.map, 0);
    this.skyTex = tex(SKY_W, SKY_H, gl.RGBA16F, gl.LINEAR);
    this.illTex = tex(SKY_W, SKY_H, gl.RGBA16F, gl.LINEAR);
    this.skyFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.skyFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.skyTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.illTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.msTex = tex(MS_W, MS_H, gl.RGBA16F, gl.LINEAR);
    const vao = gl.createVertexArray(),
      buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.quad = vao;
    this.empty = gl.createVertexArray();
    this.multiScatter();
    this.clear();
  }

  private program(vs: string, fs: string): Prog {
    const gl = this.gl,
      p = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(type);
      if (!s) throw new Error('shader');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return { p, u: new Map() };
  }
  private loc(pr: Prog, name: string): WebGLUniformLocation | null {
    if (!pr.u.has(name)) pr.u.set(name, this.gl.getUniformLocation(pr.p, name));
    return pr.u.get(name) ?? null;
  }

  /** 多重散乱の表（大気が変わらないので最初に 1 回だけ） */
  private multiScatter(): void {
    const gl = this.gl,
      pr = this.program(FULL_VERT, MS_FRAG),
      fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.msTex, 0);
    gl.viewport(0, 0, MS_W, MS_H);
    gl.useProgram(pr.p);
    gl.uniform1f(this.loc(pr, 'uAod'), AOD);
    gl.uniform1i(this.loc(pr, 'uND'), 64);
    gl.uniform1i(this.loc(pr, 'uNS'), 24);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteProgram(pr.p);
  }

  /** ためた光線を捨てる */
  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mapFb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.rays = 0;
  }

  /** 結晶の母集団と、2 個目の結晶に当たる確率（積算はやり直す） */
  setCrystals(pops: Population[], p2: number): void {
    const gl = this.gl,
      act = pops.filter((p) => p.w > 0).slice(0, MAX_POP),
      A = new Float32Array(4 * MAX_POP),
      B = new Float32Array(4 * MAX_POP),
      C = new Float32Array(4 * MAX_POP);
    let tot = 0,
      dsum = 0,
      wsum = 0;
    const cum: number[] = [];
    for (const p of act) {
      const d = dims(p.ca, p.pyr ?? 0),
        s = 1 / Math.sqrt(d.area);
      tot += p.w * Math.PI * (d.rb * s) ** 2;
      cum.push(tot);
    }
    act.forEach((p, i) => {
      const d = dims(p.ca, p.pyr ?? 0),
        s = 1 / Math.sqrt(d.area);
      A.set([ORIENT[p.orient], p.tilt * D2R, p.orient === 'lowitz' && p.rot >= 90 ? 9 : p.rot * D2R, p.d], 4 * i);
      B.set([cum[i] / tot, d.rb * s, d.db * s, d.ap * s], 4 * i);
      C.set([d.dp * s, (p.pyr ?? 0) > 0 ? 1 : 0, 0, 0], 4 * i);
      if (p.d > 0) {
        dsum += p.w * p.d;
        wsum += p.w;
      }
    });
    /* 雲の回折の明るい輪（太陽のまわり）の広がりは、径の平均で決める（このツールで決めた近似） */
    const dm = wsum ? dsum / wsum : 100;
    this.sd = Math.min(0.05, Math.max(0.006, (1.2 * 0.55) / dm));
    const pr = this.trace;
    gl.useProgram(pr.p);
    gl.uniform1i(this.loc(pr, 'uNPop'), act.length);
    gl.uniform4fv(this.loc(pr, 'uPopA'), A);
    gl.uniform4fv(this.loc(pr, 'uPopB'), B);
    gl.uniform4fv(this.loc(pr, 'uPopC'), C);
    gl.uniform1f(this.loc(pr, 'uP2'), p2);
    gl.uniform3fv(this.loc(pr, 'uNorm'), NORM);
    gl.uniform1f(this.loc(pr, 'uSrcR'), srcR(this.src.moon));
    gl.uniform1f(this.loc(pr, 'uElev'), this.src.elev * D2R);
    this.clear();
  }

  /** 光源（積算はやり直す） */
  setSource(s: Source): void {
    this.src = { ...s };
    const pr = this.trace;
    this.gl.useProgram(pr.p);
    this.gl.uniform1f(this.loc(pr, 'uElev'), s.elev * D2R);
    /* 月の視半径は太陽とほぼ同じ */
    this.gl.uniform1f(this.loc(pr, 'uSrcR'), srcR(s.moon));
    this.clear();
  }

  setCloud(c: Cloud): void {
    this.cloud = { ...c };
  }

  /** 光線を n 本足す */
  traceRays(n: number): void {
    const gl = this.gl;
    if (this.rays >= this.maxRays) return;
    gl.useProgram(this.trace.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mapFb);
    gl.viewport(0, 0, 2 * this.N, this.N);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.empty);
    gl.uniform1ui(this.loc(this.trace, 'uSeed'), this.seed++);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
    this.rays += n;
  }

  /** 描き終わるまで待つ（1 画素を読み出す。WebGL の同期オブジェクトは同じタスクの中では状態が変わらない） */
  finish(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mapFb);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this.px);
  }

  /** 空の表を計算し、読み出して露出を決める */
  private skyLut(elev: number): Float32Array[] {
    const gl = this.gl,
      pr = this.sky;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.skyFb);
    gl.viewport(0, 0, SKY_W, SKY_H);
    gl.useProgram(pr.p);
    gl.uniform1f(this.loc(pr, 'uElev'), elev * D2R);
    gl.uniform1f(this.loc(pr, 'uHc'), this.cloud.hc);
    gl.uniform1f(this.loc(pr, 'uTau'), this.cloud.tau);
    gl.uniform1f(this.loc(pr, 'uAod'), AOD);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.msTex);
    gl.uniform1i(this.loc(pr, 'uMs'), 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const a = new Float32Array(SKY_W * SKY_H * 4),
      b = new Float32Array(SKY_W * SKY_H * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, SKY_W, SKY_H, gl.RGBA, gl.FLOAT, a);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, SKY_W, SKY_H, gl.RGBA, gl.FLOAT, b);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    return [a, b];
  }

  /**
   * 写真風の露出: 光源から 15〜50° の空（雲の白い光を含み、ハロは除く）の輝度の中央値を 0.45 に合わせる。
   * 光源が 4° より低いときは 4° のときの露出に留め、薄明の暗さを残す（このツールで決めたこと）
   */
  private exposure(sky: Float32Array, ill: Float32Array, elev: number): void {
    const fs = 1 - this.cloud.rough,
      L = [Math.cos(elev * D2R), 0, Math.sin(elev * D2R)],
      v: number[] = [],
      hg = (c: number, g: number) => (1 - g * g) / (4 * Math.PI * (1 + g * g - 2 * g * c) ** 1.5);
    let zen = 0;
    for (let j = 0; j < SKY_H; j++) {
      const x = (((j + 0.5) / SKY_H) * 4) / 3 - 1 / 3,
        alt = Math.sign(x) * x * x * 0.5 * Math.PI;
      if (alt < 3 * D2R) continue;
      for (let i = 0; i < SKY_W; i++) {
        const az = ((i + 0.5) / SKY_W) * Math.PI,
          d = [Math.cos(alt) * Math.cos(az), Math.cos(alt) * Math.sin(az), Math.sin(alt)],
          c = d[0] * L[0] + d[2] * L[2],
          th = Math.acos(Math.max(-1, Math.min(1, c))) / D2R,
          o = 4 * (j * SKY_W + i),
          y = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b,
          cl = ill[o + 3] * 0.5 * (1 - fs) * hg(c, 0.62),
          lum = y(sky[o], sky[o + 1], sky[o + 2]) + y(ill[o], ill[o + 1], ill[o + 2]) * cl;
        if (th > 15 && th < 50) v.push(lum);
        if (j === SKY_H - 1 && i === 0) zen = y(ill[o], ill[o + 1], ill[o + 2]) * ill[o + 3];
      }
    }
    v.sort((a, b) => a - b);
    const med = v[Math.floor(v.length / 2)] || 1e-6;
    this.expo = 0.45 / Math.max(med, 1e-9);
    /* ハロだけ: 雲の層まで届く光で割り、位相関数 1/sr を露出の目安にする */
    this.expoOnly = 0.5 / Math.max(zen * 0.5, 1e-6);
  }

  /** 画面に描く */
  draw(v: View): void {
    const gl = this.gl,
      s = this.src,
      key = `${s.elev}|${this.cloud.hc}|${this.cloud.tau}|${this.cloud.rough}`;
    if (key !== this.skyKey) {
      this.skyKey = key;
      /* 光源が 4° より低いときは、4° の露出から実際の露出へ途中（対数で 6 割）まで寄せ、薄明の暗さを残す */
      let ref: [number, number] | null = null;
      if (s.elev < 4) {
        const [a, b] = this.skyLut(4);
        this.exposure(a, b, 4);
        ref = [this.expo, this.expoOnly];
      }
      const [a, b] = this.skyLut(s.elev);
      this.exposure(a, b, s.elev);
      if (ref) {
        this.expo = ref[0] * (this.expo / ref[0]) ** 0.6;
        this.expoOnly = ref[1] * (this.expoOnly / ref[1]) ** 0.6;
      }
    }
    const W = this.canvas.width,
      H = this.canvas.height,
      pr = this.show;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.map);
    gl.uniform1i(this.loc(pr, 'uMap'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTex);
    gl.uniform1i(this.loc(pr, 'uSky'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.illTex);
    gl.uniform1i(this.loc(pr, 'uIll'), 2);
    gl.uniform1i(this.loc(pr, 'uN'), this.N);
    gl.uniform4f(this.loc(pr, 'uView'), v.proj, v.fov * D2R, v.az * D2R, v.alt * D2R);
    gl.uniform1f(this.loc(pr, 'uAspect'), H / W);
    gl.uniform1f(this.loc(pr, 'uElev'), s.elev * D2R);
    gl.uniform1f(this.loc(pr, 'uElevApp'), apparent(s.elev) * D2R);
    const E = s.moon ? moonRatio(s.age) : 1;
    gl.uniform4f(this.loc(pr, 'uSrc'), srcR(s.moon), E, 0, s.moon ? 1 : 0);
    /* 月の光は太陽の光より赤い（月面の反射率が長い波長ほど高い。680・550・440 nm で 1.20 : 1 : 0.83、Jensen ほか 2001） */
    gl.uniform3fv(this.loc(pr, 'uSrcCol'), s.moon ? [1.2, 1, 0.83] : [1, 1, 1]);
    gl.uniform3fv(this.loc(pr, 'uSrcT'), groundT(s.elev));
    /* 露出は光源の放射照度 1 で決めたので、光源の明るさで割る（月夜は長い露出の写真のように写る） */
    const expo = v.only ? this.expoOnly : this.expo;
    gl.uniform4f(this.loc(pr, 'uMode'), 1 - this.cloud.rough, v.only ? 1 : 0, (expo * 2 ** v.ev) / E, this.sd);
    /* 夜空の明るさ（大気光と星の光の目安。満月の空の約 1/13） */
    gl.uniform1f(this.loc(pr, 'uNight'), s.moon ? 2.5e-6 * 4e-4 : 0);
    gl.uniform1f(this.loc(pr, 'uScale'), 1 / (Math.max(1, this.rays * 0.6) * 2 * (2 / this.N) ** 2));
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

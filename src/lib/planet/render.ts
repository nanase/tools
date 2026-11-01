/**
 * WebGL2 で惑星を描く: 経緯度の地図を自転楕円体に貼り、Minnaert 則の周縁減光・欠け・衛星の影（本影と半影）・
 * 衛星の円盤を画素ごとに計算する。全画面の三角形 1 枚で、2×2 の点を平均して縁をなめらかにする。
 * ベクトルはすべて惑星固定の座標で、長さは惑星の赤道半径を 1 とする。
 * 土星の環は、球との交点の前後で環の面との交点を足せばよい（今は持たない）
 */
import type { Vec3 } from '../astro/vec';

/** 1 回に描ける衛星の数（土星の 8 衛星まで） */
export const MAX_MOONS = 8;

const VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uMap;
uniform bool uHasMap;
uniform vec3 uR, uU, uF, uS;
uniform float uK;
uniform vec3 uDisk;
uniform float uShift;
uniform vec3 uMinn;
uniform float uGain;
uniform float uSunR;
uniform int uN;
uniform bool uShadows;
uniform vec4 uMoonP[${MAX_MOONS}];
uniform vec4 uMoonC[${MAX_MOONS}];
out vec4 o;
const float PI = 3.14159265358979;

/* 半径 a・b の円の中心が d 離れているときの重なりの面積 */
float overlap(float a, float b, float d) {
  if (d >= a + b) return 0.0;
  if (d <= abs(a - b)) return PI * min(a, b) * min(a, b);
  float c1 = acos(clamp((d * d + a * a - b * b) / (2.0 * d * a), -1.0, 1.0));
  float c2 = acos(clamp((d * d + b * b - a * a) / (2.0 * d * b), -1.0, 1.0));
  return a * a * (c1 - 0.5 * sin(2.0 * c1)) + b * b * (c2 - 0.5 * sin(2.0 * c2));
}

/* 惑星の面の点 p から見た太陽のうち、衛星に隠れずに届く割合 */
float sunlit(vec3 p) {
  float lit = 1.0;
  if (!uShadows) return lit;
  for (int i = 0; i < ${MAX_MOONS}; i++) {
    if (i >= uN) break;
    vec3 v = uMoonP[i].xyz - p;
    float L = dot(v, uS);
    if (L <= 0.0) continue;
    float d = length(v - L * uS);
    float h = overlap(uSunR, uMoonP[i].w / L, d / L) / (PI * uSunR * uSunR);
    lit *= 1.0 - h;
  }
  return lit;
}

/* 画面の点（赤道半径が単位）の色（線形）と、何かに当たったか */
vec4 shade(vec2 q) {
  vec3 p0 = q.x * uR + q.y * uU;
  vec3 sc = vec3(1.0, 1.0, uK);
  vec3 a3 = p0 * sc, f3 = uF * sc;
  float a = dot(f3, f3), b = 2.0 * dot(a3, f3), c = dot(a3, a3) - 1.0;
  float disc = b * b - 4.0 * a * c;
  float tp = 1e9;
  vec3 col = vec3(0.0);
  float hit = 0.0;
  if (disc >= 0.0) {
    tp = (-b - sqrt(disc)) / (2.0 * a);
    vec3 p = p0 + tp * uF;
    vec3 n = normalize(p * sc * sc);
    float mu0 = dot(n, uS), mu = max(dot(n, -uF), 1e-3);
    hit = 1.0;
    if (mu0 > 0.0) {
      vec3 alb = vec3(0.55, 0.5, 0.42);
      if (uHasMap) {
        float lonE = atan(p.y, p.x);
        float latg = atan(uK * uK * p.z, length(p.xy));
        vec2 uv = vec2(fract((lonE + uShift) / (2.0 * PI)), 0.5 - latg / PI);
        alb = texture(uMap, uv).rgb;
      }
      vec3 m = pow(vec3(mu0), uMinn) * pow(vec3(mu), uMinn - 1.0);
      col = alb * m * sunlit(p);
    }
  }
  /* 衛星: 手前にあるものを描く（惑星より奥のものは隠れる） */
  float best = tp;
  for (int i = 0; i < ${MAX_MOONS}; i++) {
    if (i >= uN) break;
    vec3 c0 = uMoonP[i].xyz;
    float r = uMoonP[i].w;
    vec2 d = q - vec2(dot(c0, uR), dot(c0, uU));
    float d2 = dot(d, d);
    if (d2 >= r * r) continue;
    float z = sqrt(r * r - d2);
    float t = dot(c0, uF) - z;
    if (t >= best) continue;
    best = t;
    vec3 nm = (d.x * uR + d.y * uU - z * uF) / r;
    col = uMoonC[i].rgb * max(dot(nm, uS), 0.0) * uMoonC[i].a;
    hit = 1.0;
  }
  return vec4(col, hit);
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 off = vec2(float(k & 1), float(k >> 1)) - 0.25;
    vec2 q = (gl_FragCoord.xy + off * 0.5 - uDisk.xy) / uDisk.z;
    acc += shade(q).rgb;
  }
  o = vec4(toSrgb(acc * 0.25 * uGain), 1.0);
}
`;

/** 1 枚の絵に要る値（ベクトルは惑星固定の座標、長さは赤道半径が単位） */
export interface PlanetU {
  /** 画面の右・上・奥（観測者から惑星へ） */
  r: Vec3;
  u: Vec3;
  f: Vec3;
  /** 惑星から太陽への向き */
  s: Vec3;
  /** 赤道半径 / 極半径 */
  k: number;
  /** 地図を経度の向きに回す角 [rad]（東経が増える向き） */
  shift: number;
  /** Minnaert の k（赤・緑・青） */
  minn: Vec3;
  /** 明るさの倍率 */
  gain: number;
  /** 惑星から見た太陽の視半径 [rad] */
  sunR: number;
  /** 衛星の中心と半径、色（線形）と照らされている割合 */
  moons: { p: Vec3; r: number; rgb: Vec3; lit: number }[];
  /** 衛星の影を描くか */
  shadows: boolean;
}

/** 描く場所（キャンバスの画素、左下が原点）と、惑星の中心と赤道半径 [px] */
export interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  rad: number;
}

export class PlanetRenderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u = new Map<string, WebGLUniformLocation | null>();
  private vao: WebGLVertexArrayObject;
  private tex: WebGLTexture | null = null;
  private iconFb: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram() as WebGLProgram;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const n of [
      'uMap',
      'uHasMap',
      'uR',
      'uU',
      'uF',
      'uS',
      'uK',
      'uDisk',
      'uShift',
      'uMinn',
      'uGain',
      'uSunR',
      'uN',
      'uShadows',
      'uMoonP',
      'uMoonC',
    ])
      this.u.set(n, gl.getUniformLocation(p, n));
    const vao = gl.createVertexArray(),
      buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
  }

  /** 地図（正距円筒、左端が経度 0 で西経が右へ減る、上が北）を読む */
  async load(url: string): Promise<void> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const an = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    bmp.close();
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = t;
  }

  get ready(): boolean {
    return !!this.tex;
  }

  /** キャンバスの大きさを表示の大きさに合わせる（装置の画素） */
  fit(): void {
    const c = this.canvas,
      d = Math.min(devicePixelRatio || 1, 2),
      w = Math.max(1, Math.round(c.clientWidth * d)),
      h = Math.max(1, Math.round(c.clientHeight * d));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  draw(m: PlanetU, at: Place): void {
    const gl = this.gl,
      g = (n: string) => this.u.get(n) ?? null;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(g('uMap'), 0);
    gl.uniform1i(g('uHasMap'), this.tex ? 1 : 0);
    gl.uniform3fv(g('uR'), m.r);
    gl.uniform3fv(g('uU'), m.u);
    gl.uniform3fv(g('uF'), m.f);
    gl.uniform3fv(g('uS'), m.s);
    gl.uniform1f(g('uK'), m.k);
    gl.uniform3f(g('uDisk'), at.x + at.cx, at.y + at.cy, at.rad);
    gl.uniform1f(g('uShift'), m.shift);
    gl.uniform3fv(g('uMinn'), m.minn);
    gl.uniform1f(g('uGain'), m.gain);
    gl.uniform1f(g('uSunR'), m.sunR);
    const n = Math.min(MAX_MOONS, m.moons.length);
    gl.uniform1i(g('uN'), n);
    gl.uniform1i(g('uShadows'), m.shadows ? 1 : 0);
    const P = new Float32Array(MAX_MOONS * 4),
      C = new Float32Array(MAX_MOONS * 4);
    m.moons.slice(0, n).forEach((o, i) => {
      P.set([o.p[0], o.p[1], o.p[2], o.r], i * 4);
      C.set([o.rgb[0], o.rgb[1], o.rgb[2], o.lit], i * 4);
    });
    gl.uniform4fv(g('uMoonP'), P);
    gl.uniform4fv(g('uMoonC'), C);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(at.x, at.y, at.w, at.h);
    gl.viewport(at.x, at.y, at.w, at.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** 小さな絵を描いて 2D のキャンバスに写す（衛星の並びの惑星など）。円盤の外は透明にしない */
  icon(m: PlanetU, out: HTMLCanvasElement, rad: number): void {
    const gl = this.gl,
      w = out.width,
      h = out.height;
    if (!this.iconFb || this.iconFb.w !== w || this.iconFb.h !== h) {
      if (this.iconFb) {
        gl.deleteFramebuffer(this.iconFb.fb);
        gl.deleteTexture(this.iconFb.tex);
      }
      const tex = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      const fb = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.iconFb = { fb, tex, w, h };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.iconFb.fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.draw(m, { x: 0, y: 0, w, h, cx: w / 2, cy: h / 2, rad });
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    out.getContext('2d')?.putImageData(img, 0, 0);
  }
}

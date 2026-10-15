/**
 * WebGL2 の光線追跡: 1 つの点が太陽からの光線 1 本。頂点シェーダの中で結晶を通し、出ていく向きを全天図
 * （等立体角の円盤 2 枚、幅 2N × 高さ N の浮動小数のテクスチャ）の画素に置いて、加算で足す。
 * 手順は trace.ts（CPU の参照）と同じ
 */
import { cmf, toRgb } from '../lens/light';
import type { Orient, Population } from './trace';

/** 母集団の数の上限 */
export const MAX_POP = 6;
const ORIENT: Record<Orient, number> = { random: 0, plate: 1, column: 2, parry: 3, lowitz: 4 };

const TRACE_VERT = `#version 300 es
precision highp float;
precision highp int;
uniform uint uSeed;
uniform int uNPop;
/* 姿勢・c/a・傾き [rad]・回転 [rad] */
uniform vec4 uPopA[${MAX_POP}];
/* 選ぶ確率の累積・径 D [µm]・外接球の半径・底面までの距離 */
uniform vec4 uPopB[${MAX_POP}];
/* 側面までの距離 */
uniform float uPopC[${MAX_POP}];
uniform float uElev;
uniform vec3 uNorm;
flat out vec3 vCol;

const float PI = 3.14159265358979;
const vec3 NRM[8] = vec3[8](vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, -1.0), vec3(1.0, 0.0, 0.0), vec3(0.5, 0.8660254, 0.0),
  vec3(-0.5, 0.8660254, 0.0), vec3(-1.0, 0.0, 0.0), vec3(-0.5, -0.8660254, 0.0), vec3(0.5, -0.8660254, 0.0));

uint st;
uint pcg() {
  st = st * 747796405u + 2891336453u;
  uint w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd() { return float(pcg() >> 8u) * (1.0 / 16777216.0); }
float gauss() { return sqrt(-2.0 * log(1.0 - rnd())) * cos(2.0 * PI * rnd()); }

mat3 rz(float t) { float c = cos(t), s = sin(t); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 ry(float t) { float c = cos(t), s = sin(t); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rx(float t) { float c = cos(t), s = sin(t); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

/* 姿勢（結晶 → 世界） */
mat3 orient(vec4 a) {
  int o = int(a.x + 0.5);
  float tw = 2.0 * PI;
  if (o == 0) {
    float u1 = rnd(), u2 = tw * rnd(), u3 = tw * rnd(), p = sqrt(1.0 - u1), q = sqrt(u1);
    float x = p * sin(u2), y = p * cos(u2), z = q * sin(u3), w = q * cos(u3);
    return transpose(mat3(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w),
      2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w),
      2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y)));
  }
  if (o == 1) {
    float th = min(a.z * sqrt(-2.0 * log(1.0 - rnd())), 0.5 * PI);
    return rz(tw * rnd()) * rx(th) * rz(tw * rnd());
  }
  if (o == 2 || o == 3) {
    float el = a.z * gauss(), psi = o == 3 ? a.w * gauss() : tw * rnd();
    return rz(tw * rnd()) * ry(-el) * ry(0.5 * PI) * rz(psi);
  }
  float al = a.w * gauss(), th = a.z * sqrt(-2.0 * log(1.0 - rnd())), ph = tw * rnd();
  return rz(tw * rnd()) * (rz(ph) * rx(th) * rz(-ph)) * ry(al);
}

float fresnel(float ci, float eta) {
  float s2 = eta * eta * (1.0 - ci * ci);
  if (s2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - s2), rs = (eta * ci - ct) / (eta * ci + ct), rp = (eta * ct - ci) / (eta * ct + ci);
  return 0.5 * (rs * rs + rp * rp);
}

/* CIE 1931 の等色関数（Wyman ほか 2013 の近似）→ 線形 sRGB */
float g1(float x, float m, float s1, float s2) { float t = (x - m) / (x < m ? s1 : s2); return exp(-0.5 * t * t); }
vec3 wlRgb(float nm) {
  vec3 c = vec3(1.056 * g1(nm, 599.8, 37.9, 31.0) + 0.362 * g1(nm, 442.0, 16.0, 26.7) - 0.065 * g1(nm, 501.1, 20.4, 26.2),
    0.821 * g1(nm, 568.8, 46.9, 40.5) + 0.286 * g1(nm, 530.9, 16.3, 31.1),
    1.217 * g1(nm, 437.0, 11.8, 36.0) + 0.681 * g1(nm, 459.0, 26.0, 13.8));
  return mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.204, -0.4986, 0.0415, 1.057) * c;
}

void main() {
  st = uint(gl_VertexID) * 2654435761u + uSeed * 2246822519u;
  pcg();
  pcg();
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vCol = vec3(0.0);
  /* 母集団 */
  float q = rnd();
  int k = 0;
  for (int i = 0; i < ${MAX_POP} - 1; i++) if (i < uNPop - 1 && uPopB[i].x < q) k = i + 1;
  vec4 A = uPopA[k], B = uPopB[k];
  float H[8];
  H[0] = B.w;
  H[1] = B.w;
  for (int i = 2; i < 8; i++) H[i] = uPopC[k];
  mat3 M = orient(A);
  /* 波長と太陽の円盤の中の点 */
  float nm = 380.0 + 400.0 * rnd(), l2 = nm * nm * 1e-6, n = 1.299589 + 0.0037589 / l2 - 0.00009708 / (l2 * l2);
  float r = 0.5 * 0.53 * PI / 180.0 * sqrt(rnd()), ph = 2.0 * PI * rnd();
  vec3 sun = vec3(cos(uElev), 0.0, sin(uElev)), tu = vec3(-sin(uElev), 0.0, cos(uElev));
  vec3 d = -normalize(sun + r * cos(ph) * tu + r * sin(ph) * vec3(0.0, 1.0, 0.0));
  d = transpose(M) * d;
  /* 外接球の断面の一様な点から入れる */
  float rb = B.z;
  vec3 ax = abs(d.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(ax, d)), v = cross(d, u);
  float rr = rb * sqrt(rnd()), pp = 2.0 * PI * rnd();
  vec3 p = rr * cos(pp) * u + rr * sin(pp) * v - 2.0 * rb * d;
  float t0 = -1e30, t1 = 1e30;
  int f0 = -1;
  bool miss = false;
  for (int i = 0; i < 8; i++) {
    float dn = dot(NRM[i], d), num = H[i] - dot(NRM[i], p);
    if (dn < 0.0) {
      float t = num / dn;
      if (t > t0) { t0 = t; f0 = i; }
    } else if (dn > 0.0) t1 = min(t1, num / dn);
    else if (num < 0.0) miss = true;
  }
  if (miss || f0 < 0 || t0 >= t1) return;
  p += t0 * d;
  vec3 N = NRM[f0];
  float ci = -dot(N, d), eta = 1.0 / n;
  bool ok = false;
  vec3 dout = vec3(0.0);
  if (rnd() < fresnel(ci, eta)) {
    dout = d + 2.0 * ci * N;
    ok = true;
  } else {
    float ct = sqrt(1.0 - eta * eta * (1.0 - ci * ci));
    d = eta * d + (eta * ci - ct) * N;
    int cur = f0;
    bool done = false;
    for (int b = 0; b < 17; b++) {
      if (done) break;
      float tm = 1e30;
      int fm = -1;
      for (int i = 0; i < 8; i++) {
        float dn = dot(NRM[i], d);
        if (i != cur && dn > 0.0) {
          float t = (H[i] - dot(NRM[i], p)) / dn;
          if (t < tm) { tm = t; fm = i; }
        }
      }
      if (fm < 0) {
        done = true;
      } else {
        p += tm * d;
        cur = fm;
        N = NRM[fm];
        ci = dot(N, d);
        if (rnd() >= fresnel(ci, n)) {
          float ct2 = sqrt(1.0 - n * n * (1.0 - ci * ci));
          dout = n * d + (ct2 - n * ci) * N;
          ok = true;
          done = true;
        } else d -= 2.0 * ci * N;
      }
    }
  }
  if (!ok) return;
  /* 空の向き（光が来る向き）と回折のぼかし */
  vec3 s = -(M * dout);
  if (B.y > 0.0) {
    float sg = 3.2 * nm * 1e-3 / B.y / 2.3548;
    vec3 a2 = abs(s.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 e1 = normalize(cross(a2, s)), e2 = cross(s, e1);
    s = normalize(s + sg * gauss() * e1 + sg * gauss() * e2);
  }
  float kk = inversesqrt(1.0 + abs(s.z));
  vec2 uv = s.xy * kk;
  gl_Position = vec4((uv.x * 0.5 + 0.5) * 0.5 + (s.z >= 0.0 ? 0.0 : 0.5), uv.y * 0.5 + 0.5, 0.0, 1.0) * vec4(2.0, 2.0, 1.0, 1.0) - vec4(1.0, 1.0, 0.0, 0.0);
  vCol = wlRgb(nm) * uNorm;
}`;

const TRACE_FRAG = `#version 300 es
precision highp float;
flat in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 1.0); }`;

const FULL_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** 表示: 全天図を投影し直し、空と雲を合成して階調をつける */
const SHOW_FRAG = `#version 300 es
precision highp float;
uniform highp sampler2D uMap;
uniform int uN;
/* 投影（0 魚眼、1 全天、2 パノラマ）・画角 [rad]・視線の高度 [rad]・縦横比 */
uniform vec4 uView;
uniform float uElev;
/* 雲の光学的厚さ・滑らかな結晶の割合・空を描くか・露出 */
uniform vec4 uScene;
/* 正規化: 1 / (光線の数 × 画素の立体角) */
uniform float uScale;
in vec2 vUv;
out vec4 o;
const float PI = 3.14159265358979;

vec4 tex(ivec2 p) { return texelFetch(uMap, clamp(p, ivec2(0), ivec2(2 * uN - 1, uN - 1)), 0); }
vec3 lookup(vec3 s) {
  float k = inversesqrt(1.0 + abs(s.z));
  vec2 uv = s.xy * k;
  vec2 f = vec2((uv.x * 0.5 + 0.5) * float(uN), (uv.y * 0.5 + 0.5) * float(uN)) - 0.5;
  ivec2 i = ivec2(floor(f));
  vec2 a = f - vec2(i);
  int off = s.z >= 0.0 ? 0 : uN;
  i.x = clamp(i.x, 0, uN - 2);
  i.y = clamp(i.y, 0, uN - 2);
  ivec2 b = ivec2(i.x + off, i.y);
  vec3 c = mix(mix(tex(b).rgb, tex(b + ivec2(1, 0)).rgb, a.x), mix(tex(b + ivec2(0, 1)).rgb, tex(b + ivec2(1, 1)).rgb, a.x), a.y);
  return c * uScale;
}
float hg(float c, float g) { return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }

void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(1.0, uView.w);
  vec3 s;
  bool inside = true;
  if (uView.x < 0.5) {
    float al = uView.z;
    vec3 f = vec3(cos(al), 0.0, sin(al)), r = vec3(0.0, -1.0, 0.0), u = cross(r, f);
    float R = length(q), th = 2.0 * asin(clamp(R * sin(uView.y / 4.0), 0.0, 1.0)), ph = atan(q.y, q.x);
    s = cos(th) * f + sin(th) * (cos(ph) * r + sin(ph) * u);
  } else if (uView.x < 1.5) {
    float R = length(q);
    inside = R <= 1.0;
    float th = 2.0 * asin(min(R, 1.0) / sqrt(2.0)), a = atan(-q.x, -q.y);
    s = vec3(sin(th) * cos(a), sin(th) * sin(a), cos(th));
  } else {
    float az = (vUv.x * 2.0 - 1.0) * PI, alt = mix(-10.0, 90.0, vUv.y) * PI / 180.0;
    s = vec3(cos(alt) * cos(az), -cos(alt) * sin(az), sin(alt));
  }
  if (!inside) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 sun = vec3(cos(uElev), 0.0, sin(uElev));
  float cosT = clamp(dot(s, sun), -1.0, 1.0), th = acos(cosT);
  vec3 L;
  if (s.z < 0.0) {
    float hz = exp(s.z / 0.02);
    L = vec3(0.0015, 0.0017, 0.002) + hz * vec3(0.02, 0.024, 0.03);
  } else {
    float tau = uScene.x, fs = uScene.y, mu = max(s.z, 0.035);
    float ray = 0.75 * (1.0 + cosT * cosT), hzw = pow(1.0 - mu, 6.0);
    float kb = uScene.z > 0.5 ? 0.08 * ray * (0.5 + 1.2 * (1.0 - exp(-0.25 / mu))) * exp(-0.6 * tau / mu) : 0.0;
    vec3 blue = vec3(0.1 + 0.55 * hzw, 0.24 + 0.5 * hzw, 0.75 + 0.2 * hzw);
    float c = 0.5 * (1.0 - exp(-tau / mu)), sd = 1.2 * PI / 180.0;
    float rough = uScene.z > 0.5 ? (1.0 - fs) * hg(cosT, 0.62) : 0.0;
    float diff = uScene.z > 0.5 ? 0.5 * exp(-th * th / (2.0 * sd * sd)) / (2.0 * PI * sd * sd) : 0.0;
    float ms = uScene.z > 0.5 ? 0.015 * (1.0 - exp(-tau / mu)) : 0.0;
    L = kb * blue + c * (rough + diff + fs * lookup(s)) + ms;
    if (th < 0.265 * PI / 180.0) L += exp(-tau / max(sin(uElev), 0.035)) / (PI * pow(0.265 * PI / 180.0, 2.0));
  }
  L *= uScene.w;
  float m = min(L.r, min(L.g, L.b));
  if (m < 0.0) {
    float y = max(0.0, dot(L, vec3(0.2126, 0.7152, 0.0722)));
    L = y + (y / (y - m)) * (L - y);
  }
  vec3 v = 1.0 - exp(-max(L, 0.0));
  o = vec4(mix(12.92 * v, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v)), 1.0);
}`;

/** 母集団の結晶の寸法（trace.ts の prism と同じ: 頂点の半径 1、表面積 1 にそろえる） */
function dims(ca: number): { rb: number; hz: number; ap: number } {
  const hz = ca,
    area = 3 * Math.sqrt(3) + 12 * hz,
    s = 1 / Math.sqrt(area);
  return { rb: Math.hypot(1, hz) * s, hz: hz * s, ap: (Math.sqrt(3) / 2) * s };
}

/** 波長の色の正規化: 380〜780 nm を一様に平均すると (1, 1, 1) */
const NORM = (() => {
  const s = [0, 0, 0];
  for (let nm = 380; nm <= 780; nm++) {
    const v = toRgb(cmf(nm));
    for (let k = 0; k < 3; k++) s[k] += v[k] / 401;
  }
  return s.map((v) => 1 / v);
})();

export interface ViewParams {
  /** 0 魚眼、1 全天、2 パノラマ */
  kind: 0 | 1 | 2;
  /** 魚眼の画角 [°] */
  fov: number;
  /** 魚眼の視線の高度 [°] */
  alt: number;
  /** 雲の光学的厚さ・滑らかな結晶の割合・空を描くか・露出の倍率 */
  tau: number;
  fs: number;
  sky: boolean;
  exposure: number;
}

export class HaloGpu {
  readonly gl: WebGL2RenderingContext;
  readonly N: number;
  /** 加算ブレンドを RGBA32F でできるか（EXT_float_blend） */
  readonly float32: boolean;
  private trace: WebGLProgram;
  private show: WebGLProgram;
  private tex: WebGLTexture;
  private fb: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private empty: WebGLVertexArrayObject;
  private seed = 1;
  private elev = 0;
  rays = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    N = 1024,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('webgl2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('float');
    this.float32 = !!gl.getExtension('EXT_float_blend');
    this.gl = gl;
    this.N = N;
    this.trace = this.program(TRACE_VERT, TRACE_FRAG);
    this.show = this.program(FULL_VERT, SHOW_FRAG);
    const tex = gl.createTexture(),
      fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.float32 ? gl.RGBA32F : gl.RGBA16F, 2 * N, N, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.tex = tex;
    this.fb = fb;
    const vao = gl.createVertexArray(),
      buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    this.empty = gl.createVertexArray();
    this.clear();
  }

  private program(vs: string, fs: string): WebGLProgram {
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
    return p;
  }

  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.rays = 0;
  }

  /** 結晶の母集団と太陽高度 [°] を決める（積算はやり直す） */
  setScene(pops: Population[], elev: number): void {
    const gl = this.gl,
      act = pops.filter((p) => p.w > 0).slice(0, MAX_POP);
    const A = new Float32Array(4 * MAX_POP),
      B = new Float32Array(4 * MAX_POP),
      C = new Float32Array(MAX_POP);
    let tot = 0;
    const cum: number[] = [];
    act.forEach((p) => {
      const d = dims(p.ca);
      tot += p.w * Math.PI * d.rb * d.rb;
      cum.push(tot);
    });
    act.forEach((p, i) => {
      const d = dims(p.ca),
        D2R = Math.PI / 180;
      A.set([ORIENT[p.orient], p.ca, p.tilt * D2R, p.orient === 'lowitz' && p.rot >= 90 ? 1e3 : p.rot * D2R], 4 * i);
      B.set([cum[i] / tot, p.d, d.rb, d.hz], 4 * i);
      C[i] = d.ap;
    });
    gl.useProgram(this.trace);
    gl.uniform1i(gl.getUniformLocation(this.trace, 'uNPop'), act.length);
    gl.uniform4fv(gl.getUniformLocation(this.trace, 'uPopA'), A);
    gl.uniform4fv(gl.getUniformLocation(this.trace, 'uPopB'), B);
    gl.uniform1fv(gl.getUniformLocation(this.trace, 'uPopC'), C);
    gl.uniform1f(gl.getUniformLocation(this.trace, 'uElev'), (elev * Math.PI) / 180);
    gl.uniform3fv(gl.getUniformLocation(this.trace, 'uNorm'), NORM);
    this.elev = elev;
    this.clear();
  }

  /** 光線を n 本足す */
  traceRays(n: number): void {
    const gl = this.gl;
    gl.useProgram(this.trace);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, 2 * this.N, this.N);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.empty);
    gl.uniform1ui(gl.getUniformLocation(this.trace, 'uSeed'), this.seed++);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
    this.rays += n;
  }

  private px = new Float32Array(4);
  /** 描き終わるまで待つ（1 画素を読み出す。WebGL の同期オブジェクトは同じタスクの中では状態が変わらない） */
  finish(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this.px);
  }

  /** 画面に描く */
  draw(v: ViewParams): void {
    const gl = this.gl,
      p = this.show,
      W = this.canvas.width,
      H = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(gl.getUniformLocation(p, 'uMap'), 0);
    gl.uniform1i(gl.getUniformLocation(p, 'uN'), this.N);
    gl.uniform4f(gl.getUniformLocation(p, 'uView'), v.kind, (v.fov * Math.PI) / 180, (v.alt * Math.PI) / 180, H / W);
    gl.uniform1f(gl.getUniformLocation(p, 'uElev'), (this.elev * Math.PI) / 180);
    gl.uniform4f(gl.getUniformLocation(p, 'uScene'), v.tau, v.fs, v.sky ? 1 : 0, v.exposure);
    /* 画素の立体角 2 × (2/N)² と、当たった割合を 0.6 と見た正規化（試作） */
    gl.uniform1f(gl.getUniformLocation(p, 'uScale'), 1 / (Math.max(1, this.rays * 0.6) * 2 * (2 / this.N) ** 2));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

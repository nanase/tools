/**
 * 板の描画（WebGL2）。キャンバスごとに 1 つ作る。
 * 模様は高さ（R16F）と法線マップ（RGBA8）の 2 枚のテクスチャで渡し、模様を変えたときだけ送り直す
 */
import { programReady, startProgram } from '../../lib/gl-program';
import { HR } from './heights';
import { FRAG, VERT } from './shader';

export type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.sqrt(dot(a, a)) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export interface Camera {
  /** 位置・右・上・前 */
  cp: Vec3;
  cr: Vec3;
  cu: Vec3;
  cf: Vec3;
  /** 画角の半分の正接 */
  th: number;
  /** 画面の中心のずれ（板を真ん中に置くため。縦の端が ±1 の座標） */
  ox: number;
  oy: number;
}

/** 板を見る方位 [°]（真正面から少し右へ回す） */
export const AZ = 20;
/** 画角の半分 [°] */
const HALF_FOV = 22;
/** 光の高さ（板の幅が 2） */
export const LIGHT_Y = 0.42;

/** 原点を向くカメラ。el は見る角度（板の面からの仰角） */
export function camera(el: number, dist: number, az = AZ): Camera {
  const e = (Math.min(el, 89.3) * Math.PI) / 180,
    a = (az * Math.PI) / 180,
    cp: Vec3 = [dist * Math.cos(e) * Math.sin(a), dist * Math.sin(e), dist * Math.cos(e) * Math.cos(a)],
    cf = norm([-cp[0], -cp[1], -cp[2]]),
    cr = norm(cross(cf, [0, 1, 0])),
    cu = cross(cr, cf);
  return { cp, cr, cu, cf, th: Math.tan((HALF_FOV * Math.PI) / 180), ox: 0, oy: 0 };
}

/** 点を画面へ写す（縦の端が ±1、横は縦横比を掛けた座標） */
export function project(c: Camera, p: Vec3): [number, number] {
  const d = sub(p, c.cp),
    z = dot(d, c.cf);
  return [dot(d, c.cr) / (z * c.th), dot(d, c.cu) / (z * c.th)];
}

/**
 * 板（上面の四隅と下面の四隅）が縦横比 asp の画面に余白 m を残して収まる距離。
 * 板の写る範囲の中心を画面の中心へずらし、上下左右の余白をそろえる
 */
export function fitCamera(el: number, asp: number, az = AZ, m = 0.9): Camera {
  const pts: Vec3[] = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [-0.06, 0.08]) pts.push([x, y, z]);
  const box = (c: Camera) => {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const p of pts) {
      const [x, y] = project(c, p);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return { x0, x1, y0, y1 };
  };
  let lo = 1.5,
    hi = 12;
  for (let k = 0; k < 30; k++) {
    const d = (lo + hi) / 2,
      b = box(camera(el, d, az));
    if ((b.x1 - b.x0) / 2 <= asp * m && (b.y1 - b.y0) / 2 <= m) hi = d;
    else lo = d;
  }
  const c = camera(el, hi, az),
    b = box(c);
  return { ...c, ox: (b.x0 + b.x1) / 2, oy: (b.y0 + b.y1) / 2 };
}

/** 画面の点 (x, y) を通る光線の向き。x は縦横比を掛けない座標（−1〜1） */
function ray(c: Camera, x: number, y: number, asp: number): Vec3 {
  const u = x * asp + c.ox,
    v = y + c.oy;
  return norm([
    c.cf[0] + (c.cr[0] * u + c.cu[0] * v) * c.th,
    c.cf[1] + (c.cr[1] * u + c.cu[1] * v) * c.th,
    c.cf[2] + (c.cr[2] * u + c.cu[2] * v) * c.th,
  ]);
}

/** 画面の点（−1〜1、上が +1）から光線を飛ばし、光の高さの面と交わる所。交わらなければ null */
export function pickLight(c: Camera, x: number, y: number, asp: number): Vec3 | null {
  const rd = ray(c, x, y, asp);
  if (Math.abs(rd[1]) < 1e-6) return null;
  const t = (LIGHT_Y - c.cp[1]) / rd[1];
  if (t <= 0) return null;
  const q: Vec3 = [c.cp[0] + rd[0] * t, LIGHT_Y, c.cp[2] + rd[2] * t];
  const cl = (v: number) => Math.max(-1.6, Math.min(1.6, v));
  return [cl(q[0]), LIGHT_Y, cl(q[2])];
}

export interface Frame {
  cam: Camera;
  light: Vec3;
  mode: number;
  /** 凹凸の高さの倍率 */
  hs: number;
  /** 色とつやの画像を使うか */
  col: boolean;
  rgh: boolean;
  /** 背景（線形でなく画面の値） */
  bg: Vec3;
}

export class PlateRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private readonly ht: WebGLTexture;
  private readonly nm: WebGLTexture;
  private readonly col: WebGLTexture;
  /** シェーダの用意ができたら解決する */
  readonly ready: Promise<void>;
  /** 今送ってある模様 */
  pat = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false });
    if (!gl) throw new Error('WebGL2');
    this.gl = gl;
    this.prog = startProgram(gl, VERT, FRAG, 'aP');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = (unit: number): WebGLTexture => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.ht = tex(0);
    this.nm = tex(1);
    this.col = tex(2);
    this.ready = programReady(gl, this.prog).then(() => {
      gl.useProgram(this.prog);
      for (const n of [
        'uRes',
        'uCp',
        'uCr',
        'uCu',
        'uCf',
        'uTh',
        'uOff',
        'uLp',
        'uMode',
        'uHs',
        'uHt',
        'uNm',
        'uCol',
        'uUseCol',
        'uUseRgh',
        'uBg',
        'uDx',
      ])
        this.u[n] = gl.getUniformLocation(this.prog, n);
      gl.uniform1i(this.u.uHt, 0);
      gl.uniform1i(this.u.uNm, 1);
      gl.uniform1i(this.u.uCol, 2);
      gl.uniform1f(this.u.uDx, 2 / HR);
    });
  }

  /** 模様の高さ・法線マップ・色とつやを送る */
  setPattern(id: string, h: Float32Array, nm: Uint8Array, col: Uint8Array): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.ht);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, HR, HR, 0, gl.RED, gl.FLOAT, h);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.nm);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, HR, HR, 0, gl.RGBA, gl.UNSIGNED_BYTE, nm);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.col);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, HR, HR, 0, gl.RGBA, gl.UNSIGNED_BYTE, col);
    this.pat = id;
  }

  /** キャンバスの画素数を表示の大きさ × 倍率に合わせる */
  resize(scale: number): void {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * scale)),
      h = Math.max(1, Math.round(this.canvas.clientHeight * scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  draw(f: Frame): void {
    const { gl, u } = this,
      c = f.cam;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform3fv(u.uCp, c.cp);
    gl.uniform3fv(u.uCr, c.cr);
    gl.uniform3fv(u.uCu, c.cu);
    gl.uniform3fv(u.uCf, c.cf);
    gl.uniform1f(u.uTh, c.th);
    gl.uniform2f(u.uOff, c.ox, c.oy);
    gl.uniform3fv(u.uLp, f.light);
    gl.uniform1i(u.uMode, f.mode);
    gl.uniform1f(u.uHs, f.hs);
    gl.uniform1i(u.uUseCol, f.col ? 1 : 0);
    gl.uniform1i(u.uUseRgh, f.rgh ? 1 : 0);
    gl.uniform3fv(u.uBg, f.bg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

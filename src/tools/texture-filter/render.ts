/** 映像の描画（WebGL2）。道路を画面いっぱいに描き、その上に木を遠い順に重ねる */
import { programReady, startProgram } from '../../lib/gl-program';
import { CAM, LANE_X, ROAD_L, ROAD_W, treesAhead } from './drive';
import type { Filter } from './filter';
import { GROUND, TREE_FRAG, TREE_VERT, VERT } from './shader';
import { roadLevels, TREE_PX, treeLevels } from './textures';

/** 1 回の描画の設定。split は GL の画素座標の x（それより右を B で描く） */
export interface DriveState {
  /** 見下ろす角度 [°] */
  pitch: number;
  /** 進んだ距離 [m]・いまの道の曲率 [1/m]・道の向きの変化 [rad] */
  z: number;
  curv: number;
  head: number;
  trees: boolean;
  A: Filter;
  B?: Filter;
  split?: number;
  tint?: boolean;
  hi?: number;
}

type Prog = { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };
const UNI = ['tex', 'maxL', 'wrap', 'res', 'split', 'fA', 'fB', 'tint', 'hi'];

const vec = (f: Filter): [number, number, number] => [f.b, f.m, f.a];

export class DriveView {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private ground: Prog | null = null;
  private tree: Prog | null = null;
  private roadTex: WebGLTexture;
  private treeTex: WebGLTexture[];
  /** 道路の段の数 */
  readonly roadLevels: Uint8ClampedArray[];
  /** シェーダの用意ができたら解決する。WebGL2 がなければ断る */
  readonly ready: Promise<void>;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    const pg = startProgram(gl, VERT, GROUND, 'a'),
      pt = startProgram(gl, TREE_VERT, TREE_FRAG, 'a');
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.roadLevels = roadLevels();
    this.roadTex = this.upload(this.roadLevels, 256, gl.CLAMP_TO_EDGE, gl.REPEAT);
    this.treeTex = ([0, 1] as const).map((k) =>
      this.upload(treeLevels(k), TREE_PX, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE),
    );
    const uni = (p: WebGLProgram, names: string[]): Prog => ({
      p,
      u: new Map(names.map((n) => [n, gl.getUniformLocation(p, n)])),
    });
    this.ready = Promise.all([programReady(gl, pg), programReady(gl, pt)]).then(() => {
      this.ground = uni(pg, [...UNI, 'pitch', 'camY', 'th', 'roadW', 'roadL', 'z', 'curv', 'laneX', 'head']);
      this.tree = uni(pt, [...UNI, 'rect']);
    });
  }

  private upload(levels: readonly Uint8ClampedArray[], size: number, ws: number, wt: number): WebGLTexture {
    const gl = this.gl,
      t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    levels.forEach((d, l) => {
      gl.texImage2D(gl.TEXTURE_2D, l, gl.RGBA8, size >> l, size >> l, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    });
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels.length - 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, ws);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wt);
    return t;
  }

  /** 2 つのプログラムに共通の uniform */
  private common(pr: Prog, s: DriveState, tex: WebGLTexture, maxL: number, wrap: number): void {
    const gl = this.gl,
      u = (n: string) => pr.u.get(n) ?? null;
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u('tex'), 0);
    gl.uniform1i(u('maxL'), maxL);
    gl.uniform1i(u('wrap'), wrap);
    gl.uniform2f(u('res'), this.canvas.width, this.canvas.height);
    gl.uniform1f(u('split'), s.split ?? 1e6);
    gl.uniform3i(u('fA'), ...vec(s.A));
    gl.uniform3i(u('fB'), ...vec(s.B ?? s.A));
    gl.uniform1i(u('tint'), s.tint ? 1 : 0);
    gl.uniform1i(u('hi'), s.hi ?? -1);
  }

  draw(s: DriveState): void {
    const gl = this.gl,
      g = this.ground,
      tr = this.tree,
      W = this.canvas.width,
      H = this.canvas.height;
    if (!g || !tr) return;
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(this.vao);
    const pitch = (s.pitch * Math.PI) / 180;
    this.common(g, s, this.roadTex, this.roadLevels.length - 1, 1);
    const u = (n: string) => g.u.get(n) ?? null;
    gl.uniform1f(u('pitch'), pitch);
    gl.uniform1f(u('camY'), CAM.y);
    gl.uniform1f(u('th'), CAM.th);
    gl.uniform1f(u('roadW'), ROAD_W);
    gl.uniform1f(u('roadL'), ROAD_L);
    gl.uniform1f(u('z'), s.z);
    gl.uniform1f(u('curv'), s.curv);
    gl.uniform1f(u('laneX'), LANE_X);
    gl.uniform1f(u('head'), s.head);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!s.trees) return;
    /* 木: 根元と梢を画面へ写し、絵は正方形のまま立てる */
    const sp = Math.sin(pitch),
      cp = Math.cos(pitch),
      asp = W / H;
    const ndc = (x: number, y: number, d: number): [number, number] => {
      const Y = y - CAM.y,
        zc = -Y * sp + d * cp,
        yc = Y * cp + d * sp;
      return [x / (zc * CAM.th * asp), yc / (zc * CAM.th)];
    };
    let cur = -1;
    for (const t of treesAhead(s.z, s.curv)) {
      const b = ndc(t.x, 0, t.d),
        top = ndc(t.x, t.h, t.d),
        hh = top[1] - b[1],
        hw = (hh * H) / W;
      if (hh * H < 1 || Math.abs(b[0]) > 1 + hw) continue;
      if (cur !== t.k) {
        this.common(tr, s, this.treeTex[t.k], 6, 2);
        cur = t.k;
      }
      gl.uniform4f(tr.u.get('rect') ?? null, b[0] - hw / 2, b[1], b[0] + hw / 2, top[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
}

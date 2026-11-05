/**
 * シェーダーをメインスレッドを止めずに用意する。
 * 初めて訪れたときはコンパイルに数秒かかることがあり、結果を同期で聞くとその間ページ全体が固まる
 */

/** リンクの終わりを確かめる間隔 [ms] */
const POLL_MS = 20;
/** 拡張がない環境で、固まる前に輪を描く時間を空ける [ms] */
const PAINT_MS = 150;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** コンパイルとリンクを始める。結果は programReady で確かめる（聞くとそこで待たされる） */
export function startProgram(gl: WebGL2RenderingContext, vert: string, frag: string, attrib?: string): WebGLProgram {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vert],
    [gl.FRAGMENT_SHADER, frag],
  ] as const) {
    const s = gl.createShader(type);
    if (!s) throw new Error('shader');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  if (attrib) gl.bindAttribLocation(p, 0, attrib);
  gl.linkProgram(p);
  return p;
}

/** リンクの終わりを待つ。失敗したら記録を添えて断る。これが終わるまで uniform の場所なども聞かない */
export async function programReady(gl: WebGL2RenderingContext, p: WebGLProgram): Promise<void> {
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  if (ext) while (!gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR)) await wait(POLL_MS);
  else await wait(PAINT_MS);
  if (gl.getProgramParameter(p, gl.LINK_STATUS)) return;
  const logs = [gl.getProgramInfoLog(p), ...(gl.getAttachedShaders(p) ?? []).map((s) => gl.getShaderInfoLog(s))];
  throw new Error(logs.find(Boolean) ?? 'link');
}

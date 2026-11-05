import { describe, expect, it } from 'vitest';
import { programReady, startProgram } from '../src/lib/gl-program';

const COMPLETION = 0x91b1;
const LINK = 0x8b82;
const P = {} as WebGLProgram;

/** getProgramParameter に聞かれた順と、リンクの結果を持つ偽物 */
function fake(opts: { parallel: boolean; polls?: number; linked?: boolean; log?: string; shaderLog?: string }) {
  const asked: number[] = [];
  let left = opts.polls ?? 0;
  const gl = {
    LINK_STATUS: LINK,
    getExtension: (n: string) =>
      opts.parallel && n === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR: COMPLETION } : null,
    getProgramParameter: (_p: WebGLProgram, k: number) => {
      asked.push(k);
      if (k === COMPLETION) return left-- <= 0;
      return opts.linked ?? true;
    },
    getProgramInfoLog: () => opts.log ?? '',
    getAttachedShaders: () => [{}],
    getShaderInfoLog: () => opts.shaderLog ?? '',
  };
  return { gl: gl as unknown as WebGL2RenderingContext, asked };
}

describe('programReady', () => {
  it('リンクが終わるまで LINK_STATUS を聞かない', async () => {
    const { gl, asked } = fake({ parallel: true, polls: 3 });
    await programReady(gl, P);
    expect(asked).toEqual([COMPLETION, COMPLETION, COMPLETION, COMPLETION, LINK]);
  });

  it('待っている間はほかの処理へ順番を譲る', async () => {
    const { gl } = fake({ parallel: true, polls: 2 });
    let other = false;
    setTimeout(() => {
      other = true;
    }, 0);
    await programReady(gl, P);
    expect(other).toBe(true);
  });

  it('拡張がない環境でも結果を確かめる', async () => {
    const { gl, asked } = fake({ parallel: false });
    await programReady(gl, P);
    expect(asked).toEqual([LINK]);
  });

  it('リンクに失敗したら記録を添えて断る', async () => {
    const { gl } = fake({ parallel: true, linked: false, log: 'link log' });
    await expect(programReady(gl, P)).rejects.toThrow('link log');
  });

  it('リンクの記録が空ならシェーダーの記録を使う', async () => {
    const { gl } = fake({ parallel: false, linked: false, shaderLog: 'compile log' });
    await expect(programReady(gl, P)).rejects.toThrow('compile log');
  });
});

describe('startProgram', () => {
  it('結果を聞かずにリンクまで進める', () => {
    const calls: string[] = [];
    const gl = {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      createProgram: () => P,
      createShader: (t: number) => ({ t }),
      shaderSource: () => calls.push('source'),
      compileShader: () => calls.push('compile'),
      attachShader: () => calls.push('attach'),
      bindAttribLocation: (_p: WebGLProgram, i: number, n: string) => calls.push(`bind ${i} ${n}`),
      linkProgram: () => calls.push('link'),
    } as unknown as WebGL2RenderingContext;
    expect(startProgram(gl, 'v', 'f', 'aPos')).toBe(P);
    expect(calls).toEqual(['source', 'compile', 'attach', 'source', 'compile', 'attach', 'bind 0 aPos', 'link']);
  });
});

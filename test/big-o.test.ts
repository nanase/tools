import { describe, expect, it } from 'vitest';
import { bigO } from '../src/lib/big-o';

describe('bigO', () => {
  it('変数を斜体にし、log と O( は立体で残す', () => {
    expect(bigO('O(log n)')).toBe('<span class="bo">O(log 𝑛)</span>');
    expect(bigO('n log²n')).toBe('<span class="bo">𝑛 log²𝑛</span>');
    expect(bigO('o(log n)')).toBe('<span class="bo">o(log 𝑛)</span>');
  });

  it('変数の積は 1 文字ずつ斜体にする', () => {
    expect(bigO('nKi')).toBe('<span class="bo">𝑛𝐾𝑖</span>');
    expect(bigO('h')).toBe('<span class="bo">ℎ</span>');
  });

  it('タグは書き換えない', () => {
    expect(bigO('O(log<sub>m</sub> n + k/m)')).toBe('<span class="bo">O(log<sub>𝑚</sub> 𝑛 + 𝑘/𝑚)</span>');
    expect(bigO('n<sup>log n</sup>')).toBe('<span class="bo">𝑛<sup>log 𝑛</sup></span>');
  });

  it('和文と末尾の * は本文の書体で残す', () => {
    expect(bigO('償却 O(1)')).toBe('償却 <span class="bo">O(1)</span>');
    expect(bigO('O(log n)*')).toBe('<span class="bo">O(log 𝑛)</span>*');
    expect(bigO('nM·エポック')).toBe('<span class="bo">𝑛𝑀·</span>エポック');
    expect(bigO('不明')).toBe('不明');
  });
});

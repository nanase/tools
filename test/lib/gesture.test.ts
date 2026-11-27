import { describe, expect, it } from 'vitest';
import { activates } from '../../src/lib/gesture';

const ev = (type: string, more: { pointerType?: string; key?: string; isTrusted?: boolean } = {}) => ({
  isTrusted: true,
  type,
  ...more,
});

describe('音を鳴らし始めてよい操作', () => {
  it('マウスは押したとき、指とペンは離したとき', () => {
    expect(activates(ev('pointerdown', { pointerType: 'mouse' }))).toBe(true);
    expect(activates(ev('pointerup', { pointerType: 'mouse' }))).toBe(false);
    for (const p of ['touch', 'pen']) {
      expect(activates(ev('pointerdown', { pointerType: p }))).toBe(false);
      expect(activates(ev('pointerup', { pointerType: p }))).toBe(true);
    }
  });
  it('キーは Esc 以外', () => {
    expect(activates(ev('keydown', { key: ' ' }))).toBe(true);
    expect(activates(ev('keydown', { key: 'ArrowUp' }))).toBe(true);
    expect(activates(ev('keydown', { key: 'Escape' }))).toBe(false);
    expect(activates(ev('keyup', { key: ' ' }))).toBe(false);
  });
  it('クリックは当たり、ポインタの移動は当たらない', () => {
    expect(activates(ev('click'))).toBe(true);
    expect(activates(ev('pointermove', { pointerType: 'mouse' }))).toBe(false);
  });
  it('スクリプトから送ったイベントは当たらない', () => {
    expect(activates(ev('click', { isTrusted: false }))).toBe(false);
    expect(activates(ev('pointerdown', { pointerType: 'mouse', isTrusted: false }))).toBe(false);
    expect(activates(ev('keydown', { key: ' ', isTrusted: false }))).toBe(false);
  });
});

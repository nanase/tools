import { describe, expect, it } from 'vitest';
import { figSvg } from '../src/tools/cpu/fig';
import { chip, dec, enc, HLT, makeCpu, outputs, PROG, PROGS, romOf, step } from '../src/tools/cpu/model';

describe('命令の語', () => {
  it('種類 3 ビット・A か B 1 ビット・数 4 ビットに分かれる', () => {
    const d = dec(enc('ldi', 'B', 9));
    expect(d.b).toBe(0b000_1_1001);
    expect([d.k, d.R, d.n, d.src, d.dst]).toEqual(['ldi', 'B', 9, 'n', 'B']);
  });

  it('8 種すべてを読み解いて組み直せる', () => {
    for (let b = 0; b < 256; b++) {
      const d = dec(b);
      expect(enc(d.k, d.R, d.n)).toBe(b);
    }
  });

  it('札はどこから → どこへ', () => {
    expect(chip(dec(enc('ldi', 'A', 3)))).toBe('3 → A');
    expect(chip(dec(enc('mov', 'B')))).toBe('A → B');
    expect(chip(dec(enc('add', 'A')))).toBe('A+B → A');
    expect(chip(dec(enc('out', 'B')))).toBe('B → 出力');
    expect(chip(dec(enc('jnc', 0, 6)))).toBe('C=0 で 6 → PC');
    expect(chip(dec(HLT))).toBe('');
  });
});

describe('実行', () => {
  it('加算はあふれた分を C に入れ、下の 4 ビットを残す', () => {
    const m = makeCpu([enc('ldi', 'A', 9), enc('ldi', 'B', 8), enc('add', 'A'), HLT]);
    step(m);
    step(m);
    const e = step(m);
    expect([m.A, m.C, e.sum, e.val]).toEqual([1, 1, 17, 1]);
  });

  it('条件ジャンプは C=1 なら次の行へ進む', () => {
    const m = makeCpu([enc('jnc', 0, 5)]);
    m.C = 1;
    const e = step(m);
    expect([e.taken, m.pc, e.src]).toEqual([false, 1, null]);
    m.pc = 0;
    m.C = 0;
    expect([step(m).taken, m.pc]).toEqual([true, 5]);
  });

  it('停止は PC をそのままにして止まる', () => {
    const m = makeCpu([HLT]);
    step(m);
    expect([m.pc, m.halt, m.clk]).toEqual([0, true, 1]);
  });

  it('使わない行は停止で埋める', () => {
    for (const p of PROGS) {
      const r = romOf(p);
      expect(r).toHaveLength(16);
      for (let i = p.code.length; i < 16; i++) expect(r[i]).toBe(HLT);
    }
  });
});

describe('プログラム', () => {
  const out = (id: string, n: number, inp = PROG[id].inp) => outputs(romOf(PROG[id]), inp, n);

  it('LED を流すは 1・2・4・8 をくり返す', () => {
    expect(out('flow', 40).slice(0, 8)).toEqual([1, 2, 4, 8, 1, 2, 4, 8]);
  });

  it('数えるは 0 から 15 まで数えて 0 へ戻る', () => {
    expect(out('count', 80).slice(0, 17)).toEqual([...Array.from({ length: 16 }, (_, i) => i), 0]);
  });

  it('タイマは入力から 0 まで数え下げ、LED を全部点けて止まる', () => {
    expect(out('timer', 200)).toEqual([6, 5, 4, 3, 2, 1, 0, 15]);
  });

  it('足し算は入力 + 3', () => {
    expect(out('add', 8)[0]).toBe(8);
    expect(out('add', 8, 12)[0]).toBe(15);
  });

  it('かけ算は入力 × 4（途中の 2 倍・3 倍も出す）', () => {
    expect(out('mul', 40)).toEqual([3, 6, 9, 12]);
  });

  it('フィボナッチ数は 1・1・2・3・5・8・13', () => {
    expect(out('fib', 60).slice(0, 7)).toEqual([1, 1, 2, 3, 5, 8, 13]);
  });
});

describe('図', () => {
  it('ROM のビット 128 個と行 16 本を描く', () => {
    for (const k of ['wide', 'narrow'] as const) {
      const s = figSvg(k);
      expect(s.match(/class="cp-rbx"/g)).toHaveLength(128);
      expect(s.match(/class="cp-row"/g)).toHaveLength(16);
    }
  });

  it('Tab で入れるビットは 1 つだけ', () => {
    expect(figSvg('wide').match(/class="cp-rbx"[^>]*tabindex="0"/g)).toHaveLength(1);
  });
});

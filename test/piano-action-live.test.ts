import { describe, expect, it } from 'vitest';
import { LiveAction } from '../src/tools/piano-action/live';
import { REG0 } from '../src/tools/piano-action/model';
import { dipAt, simulate } from '../src/tools/piano-action/sim';
import { events, stages } from '../src/tools/piano-action/stages';

/** 既定の整調の静止の姿勢と、それから作った打鍵 */
const base = simulate('forte', REG0);
const live = (kind: 'forte' | 'piano' = 'forte') => new LiveAction(base, kind);
/** t [s] だけ進める。止まっている間は進まないので、呼んだ分だけ時間が経ったことにする */
const go = (a: LiveAction, t: number) => a.advance(t);
/** 離して静止に戻るまで進める */
function toRest(a: LiveAction): void {
  for (let i = 0; i < 300 && !a.done; i++) a.advance(0.01);
}

describe('押して離す', () => {
  it('強く: 押してから約 60 ms で 1 回打ち、速さは計算済みの強い打鍵と同じくらい', () => {
    const a = live();
    a.down();
    go(a, 0.3);
    a.up();
    toRest(a);
    expect(a.done).toBe(true);
    const E = events(a.toRun());
    expect(E.strikes).toHaveLength(1);
    expect(E.strikes[0].t).toBeGreaterThan(0.04);
    expect(E.strikes[0].t).toBeLessThan(0.09);
    expect(E.strikes[0].v).toBeGreaterThan(2.5);
    expect(E.strikes[0].v).toBeLessThan(3.5);
  });
  it('強く: 段階は計算済みの打鍵と同じ並びになる', () => {
    const a = live();
    a.down();
    go(a, 0.3);
    a.up();
    toRest(a);
    expect(stages(a.toRun()).map((s) => s.id)).toEqual(['rest', 'acc', 'let', 'hit', 'chk', 'ret', 'rest2']);
  });
  it('弱く: 計算済みの弱い打鍵と同じ 1 m/s 前後で打つ', () => {
    const a = live('piano');
    a.down();
    go(a, 0.5);
    a.up();
    toRest(a);
    const E = events(a.toRun());
    expect(E.strikes).toHaveLength(1);
    expect(E.strikes[0].v).toBeGreaterThan(0.6);
    expect(E.strikes[0].v).toBeLessThan(1.5);
  });
  it('静止に戻ると姿勢は押す前とほぼ同じ', () => {
    const a = live();
    a.down();
    go(a, 0.3);
    a.up();
    toRest(a);
    for (let i = 0; i < 5; i++) expect(Math.abs(a.action.q[i] - base.q0[i])).toBeLessThan(0.01);
  });
});

describe('短いクリック', () => {
  it('すぐ離しても打弦までは押した扱いにして、1 回打って戻る', () => {
    for (const kind of ['forte', 'piano'] as const) {
      const a = live(kind);
      a.down();
      go(a, 0.02);
      a.up();
      toRest(a);
      expect(a.done).toBe(true);
      expect(events(a.toRun()).strikes).toHaveLength(1);
    }
  });
});

describe('押し続ける', () => {
  it('ハンマーはチェックで止まり、落ち着いたら計算を止める', () => {
    const a = live();
    a.down();
    go(a, 1);
    expect(a.held).toBe(true);
    const n = a.run.n;
    go(a, 5);
    expect(a.run.n).toBe(n);
    /* バックチェックがハンマーを受けている */
    expect(a.action.fn[3]).toBeGreaterThan(0.005);
    expect(a.done).toBe(false);
  });
  it('長く押してから離しても戻る', () => {
    const a = live();
    a.down();
    go(a, 5);
    a.up();
    toRest(a);
    expect(a.done).toBe(true);
  });
});

describe('戻る途中で押し直す', () => {
  /** 離してから after [s] 後に押し直す */
  function again(after: number) {
    const a = live();
    a.down();
    go(a, 0.3);
    a.up();
    go(a, after);
    a.down();
    go(a, 0.3);
    a.up();
    toRest(a);
    return a.toRun();
  }
  it('鍵が半分戻ったところで押し直すと、もう一度打てる', () => {
    const R = again(0.14);
    expect(events(R).strikes.length).toBe(2);
    expect(stages(R).map((s) => s.id)).toContain('rep');
  });
  it('押し直しで打てたら、押し直す時機によらず段階に連打が出る', () => {
    /* 記録は 5 刻みごとなので、刻み単位でずらして力の山の拾い方を変える */
    for (const ms of [130, 140, 150])
      for (let j = 1; j < 5; j++) {
        const R = again(ms / 1000 + j * 2e-5);
        expect(events(R).strikes).toHaveLength(2);
        expect(stages(R).map((s) => s.id)).toContain('rep');
      }
  });
  it('離してすぐ押し直すと、ジャックが戻っていないので打てない', () => {
    expect(events(again(0.005)).strikes.length).toBe(1);
  });
});

describe('離したらすぐ戻る', () => {
  const dipNow = (a: LiveAction) => dipAt(a.run, a.run.n - 1);
  it('押し続けたあと離すと、30 ms で鍵が 1 mm 以上上がる', () => {
    const a = live();
    a.down();
    go(a, 0.3);
    const d0 = dipNow(a);
    a.up();
    go(a, 0.03);
    expect(d0 - dipNow(a)).toBeGreaterThan(0.001);
  });
  it('ジャックが抜けたあとなら、短く押して離しても待たずに力を抜く', () => {
    const a = live();
    a.down();
    go(a, 0.08);
    a.up();
    expect(a.pressing).toBe(false);
    go(a, 0.001);
    expect(a.action.force).toBe(0);
  });
  it('ジャックが抜ける前に離すと、抜けるまで押した扱いにして打つ', () => {
    const a = live();
    a.down();
    go(a, 0.02);
    a.up();
    expect(a.pressing).toBe(true);
    toRest(a);
    expect(events(a.toRun()).strikes).toHaveLength(1);
  });
  it('100 ms 押して 100 ms 離すのをくり返すと、毎回打てる', () => {
    let n = 0;
    const a = live();
    a.onStrike = () => n++;
    for (let i = 0; i < 4; i++) {
      a.down();
      go(a, 0.1);
      a.up();
      go(a, 0.1);
    }
    expect(n).toBe(4);
  });
  it('静止まで戻ってから押し直すと、最初の打鍵と同じ速さで打つ', () => {
    const v: number[] = [];
    const a = live();
    a.onStrike = (s) => v.push(s.v);
    for (let i = 0; i < 3; i++) {
      a.down();
      go(a, 0.2);
      a.up();
      go(a, 0.2);
    }
    expect(v).toHaveLength(3);
    for (const x of v) expect(Math.abs(x - v[0])).toBeLessThan(0.15);
  });
});

describe('何度も押し直す', () => {
  it('記録は直近の 2 回ぶんだけ残し、段階に分けられる', () => {
    const a = live();
    for (let i = 0; i < 5; i++) {
      a.down();
      go(a, 0.3);
      a.up();
      go(a, 0.14);
    }
    toRest(a);
    const R = a.toRun();
    expect(events(R).strikes.length).toBeLessThanOrEqual(2);
    expect(stages(R).length).toBeGreaterThan(2);
  });
});

describe('打弦の知らせ', () => {
  it('弦に当たるたびに 1 回、速さとともに知らせる', () => {
    const got: number[] = [];
    const a = live();
    a.onStrike = (s) => got.push(s.v);
    a.down();
    go(a, 0.3);
    a.up();
    toRest(a);
    expect(got).toHaveLength(1);
    expect(got[0]).toBeGreaterThan(2.5);
  });
});

describe('いまの段階', () => {
  it('押している間に 加速 → レットオフ → 打弦 → チェック と変わり、離すと 戻り → 静止', () => {
    const seen: string[] = [];
    const a = live();
    a.down();
    for (let i = 0; i < 300; i++) {
      a.advance(0.001);
      if (seen[seen.length - 1] !== a.stage) seen.push(a.stage);
    }
    a.up();
    for (let i = 0; i < 2000 && !a.done; i++) {
      a.advance(0.001);
      if (seen[seen.length - 1] !== a.stage) seen.push(a.stage);
    }
    expect(seen).toEqual(['rest', 'acc', 'let', 'hit', 'chk', 'ret', 'rest2']);
  });
});

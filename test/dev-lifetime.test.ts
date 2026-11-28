import { describe, expect, it } from 'vitest';
import { alive, ancestors, idleMinutes, idleOver, msysOwners, parseMsys } from '../scripts/dev-lifetime';

describe('親をたどる', () => {
  const table = new Map([
    [500, 400],
    [400, 300],
    [300, 200],
    [200, 4],
    [4, 0],
  ]);

  it('自分を含めず、根（System）の手前まで並べる', () => {
    expect(ancestors(table, 500)).toEqual([400, 300, 200]);
  });

  it('表にない親で止める（もう終わっていたプロセス）', () => {
    const t = new Map([
      [500, 400],
      [400, 999],
    ]);
    expect(ancestors(t, 500)).toEqual([400]);
  });

  it('輪になっていても止まる', () => {
    const t = new Map([
      [500, 400],
      [400, 500],
    ]);
    expect(ancestors(t, 500)).toEqual([400]);
  });

  it('Git Bash の ps -l を読み、最も上の MSYS のプロセスから MSYS の親をたどる', () => {
    const out = [
      '      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND',
      '    43819   43815   43815      57800  ?         197609 18:39:46 /c/mise/bin/mise',
      '    43815   43810   43815      32740  ?         197609 18:39:46 /usr/bin/bash',
      '    43810       1   43810      37192  ?         197609 18:39:45 /usr/bin/bash',
      '',
    ].join('\r\n');
    const t = parseMsys(out);
    expect(t?.get(43815)).toEqual({ ppid: 43810, winpid: 32740 });
    /* Windows の親は bun（57801）→ mise（57800）→ bash（32740）で、その先は切れている */
    expect(msysOwners(t as Map<number, { ppid: number; winpid: number }>, [57801, 57800, 32740])).toEqual([
      43815, 43810,
    ]);
  });

  it('MSYS の ps でなければ読まない', () => {
    expect(parseMsys('  PID TTY TIME CMD\n  1 ? 00:00 init')).toBeNull();
  });

  it('自分のプロセスは生きている', () => {
    expect(alive(process.pid)).toBe(true);
  });
});

describe('使われていない時間', () => {
  const MIN = 60_000;

  it('接続がなく、上限の分を過ぎたら終わる', () => {
    expect(idleOver(0, 60 * MIN, 0, 60)).toBe(true);
    expect(idleOver(0, 59 * MIN, 0, 60)).toBe(false);
  });

  it('HMR の接続があれば終わらない', () => {
    expect(idleOver(0, 600 * MIN, 1, 60)).toBe(false);
  });

  it('0 分なら見ない', () => {
    expect(idleOver(0, 600 * MIN, 0, 0)).toBe(false);
  });

  it('環境変数の分。読めなければ 60', () => {
    expect(idleMinutes(undefined)).toBe(60);
    expect(idleMinutes('')).toBe(60);
    expect(idleMinutes('abc')).toBe(60);
    expect(idleMinutes('-1')).toBe(60);
    expect(idleMinutes('0')).toBe(0);
    expect(idleMinutes('15')).toBe(15);
  });
});

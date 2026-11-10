import { describe, expect, it } from 'vitest';
import { type Config, DEVS, hex, LEDS, resultOf, sampleRising, simulate, stateAt, TSU, VP } from '../src/tools/spi/bus';
import { say } from '../src/tools/spi/story';

const base: Config = {
  mode: 0,
  order: 'msb',
  f: 1e6,
  len: 0.1,
  conn: 'cs',
  dest: 0,
  both: false,
  data: [0x2a, 0x07, 0x5a],
};
const run = (c: Partial<Config> = {}) => simulate({ ...base, ...c });
const hx = (a: readonly number[]) => a.map(hex).join(' ');
/** 機器の番号（DEVS） */
const MEM = DEVS.findIndex((d) => d.mode === 0),
  M3 = DEVS.findIndex((d) => d.mode === 3),
  M1 = DEVS.findIndex((d) => d.mode === 1);

describe('モード', () => {
  it('モード 0・3 は立ち上がり、1・2 は立ち下がりで読む', () => {
    expect([0, 1, 2, 3].map((m) => sampleRising(m as 0 | 1 | 2 | 3))).toEqual([true, false, false, true]);
  });
  it('SCK の待機の向きは CPOL', () => {
    expect(run({ mode: 0 }).lines.sck[0].v).toBe(0);
    expect(run({ mode: 2 }).lines.sck[0].v).toBe(1);
    expect(run({ mode: 3 }).lines.sck[0].v).toBe(1);
  });
  it('2 バイトで SCK のエッジは 32 個、読み取りは 16 回', () => {
    const s = run();
    expect(s.edges).toHaveLength(32);
    expect(s.samples.filter((x) => x.i === 0)).toHaveLength(16);
  });
});

describe('交換', () => {
  it('モードがそろえば、マスタとスレーブのバイトが入れ替わる', () => {
    for (const k of [0, 1, 2]) {
      const s = run({ dest: k, mode: DEVS[k].mode });
      expect(resultOf(s)).toBe('ok');
      expect(hx(s.devs[0].got)).toBe(hx(DEVS[k].rep));
      expect(hx(s.devs[k + 1].got)).toBe('0x2A 0x07');
    }
  });
  it('8 クロック後、マスタのレジスタはすべてスレーブから届いたビット', () => {
    const s = run(),
      t = s.samples.filter((x) => x.i === 0)[7].t;
    /* 8 回目の読み取りの直前は 1 個だけマスタのビットが残る */
    expect(stateAt(s.devs[0], t - 1e-12).reg.filter((b) => b.src === 0)).toHaveLength(1);
    /* 読み取ると次のバイトを積むので、受け取った 8 ビットは gotBits に残る */
    expect(s.devs[0].gotBits[0].every((b) => b.src === MEM + 1)).toBe(true);
    expect(s.devs[MEM + 1].gotBits[0].every((b) => b.src === 0)).toBe(true);
  });
  it('モード 3 のマスタはモード 0 の機器とも交換できる（どちらも立ち上がりで読む）', () => {
    expect(resultOf(run({ mode: 3, dest: MEM }))).toBe('ok');
  });
  it('読むエッジが逆なら同じエッジで変わり、値は不定', () => {
    const s = run({ mode: 0, dest: M1 });
    expect(resultOf(s)).toBe('mode');
    expect(s.samples.some((x) => x.b.why === 'race')).toBe(true);
  });
  it('CPHA 1 の機器をモード 0 で読むと、最初のビットはまだ出ていない', () => {
    const s = run({ mode: 0, dest: M3 });
    expect(s.samples.find((x) => x.i === 0)?.b.why).toBe('idle');
  });
  it('LSB からにすると、ビットが逆の順に届く', () => {
    const s = run({ order: 'lsb' });
    expect(resultOf(s)).toBe('order');
    expect(hx(s.devs[MEM + 1].got)).toBe('0x54 0xE0');
  });
  it('2 台を同時に選ぶと MISO が衝突する', () => {
    const s = run({ both: true });
    expect(resultOf(s)).toBe('both');
    expect(s.lines.miso.some((x) => x.v === 'x')).toBe(true);
  });
});

describe('MISO の遅れ', () => {
  it('余裕は半周期から往復の遅れとセットアップ時間を引いた値', () => {
    const s = run({ f: 20e6, len: 1 });
    expect(s.rt).toBeCloseTo(2 * VP + DEVS[MEM].tv, 15);
    expect(s.margin).toBeCloseTo(25e-9 - s.rt - TSU, 15);
  });
  it('遅れが半周期を超えるとマスタは読み違え、MOSI は届く', () => {
    const s = run({ f: 20e6, len: 2 });
    expect(s.margin).toBeLessThan(0);
    expect(resultOf(s)).toBe('late');
    expect(s.errS).toBe(false);
  });
});

describe('デイジーチェーン', () => {
  it('最初に送ったバイトが最後の LED に、LED の値はマスタへ押し出される', () => {
    const s = run({ conn: 'chain' });
    expect(resultOf(s)).toBe('ok');
    expect([1, 2, 3].map((i) => hex(s.devs[i].got.at(-1) ?? 0))).toEqual(['0x5A', '0x07', '0x2A']);
    expect(hx(s.devs[0].got)).toBe(hx([LEDS[2].init, LEDS[1].init, LEDS[0].init]));
  });
});

describe('語り', () => {
  it('待機・選択・終了', () => {
    const s = run();
    expect(say(s, 0).t).toMatch(/^待機/);
    expect(say(s, s.tCs + s.h * 0.5).t).toBe(`CS1 ↓ ― ${DEVS[MEM].name}を選択`);
    expect(say(s, s.tUp + 1e-9).t).toMatch(/^CS1 ↑ 終了/);
  });
  it('8 回目の読み取りで 1 バイト目の交換', () => {
    const s = run(),
      t = s.samples.filter((x) => x.i === 0)[7].t;
    expect(say(s, t + 1e-9).t).toBe(`1 バイト目の交換 ― マスタ 0xEF・${DEVS[MEM].name} 0x2A`);
  });
});

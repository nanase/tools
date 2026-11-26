import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ART, LOOP } from '../src/lib/card-art';
import { prepareClip } from '../src/tools/spatial-audio/clip';
import { CREDITS } from '../src/tools/spatial-audio/credits';
import {
  buildPlace,
  CS,
  EAR_H,
  earModel,
  firstReflection,
  HEAD_A,
  images,
  KINDS,
  kindOf,
  MAX_SOURCES,
  occlusion,
  paths,
  SCENES,
  SOUNDS,
  sceneSpace,
  shadowGain,
  toHead,
  VOICE_GAP,
} from '../src/tools/spatial-audio/model';
import { Binaural, type Mode } from '../src/tools/spatial-audio/render';

const FS = 48000;
const pl = (id: string) => buildPlace(kindOf(id), kindOf(id).def);

describe('頭のモデル', () => {
  it('真横の音: 遠い耳への遅れは Woodworth の式の最大（約 0.66 ms）', () => {
    const L = earModel([1, 0, 0], -1),
      R = earModel([1, 0, 0], 1);
    expect(R.delay).toBe(0);
    expect((L.delay - R.delay) * 1000).toBeCloseTo(((1 + Math.PI / 2) * HEAD_A * 1000) / CS, 6);
    expect((L.delay - R.delay) * 1000).toBeCloseTo(0.656, 2);
  });

  it('正面の音は両耳に同時に同じ強さで届く', () => {
    const L = earModel([0, 1, 0], -1),
      R = earModel([0, 1, 0], 1);
    expect(L.delay).toBeCloseTo(R.delay, 12);
    expect(L.alpha).toBeCloseTo(R.alpha, 12);
  });

  it('頭の陰: 音の来る側は高い音が 6 dB 強まり、150° で最も弱まる', () => {
    expect(earModel([1, 0, 0], 1).alpha).toBeCloseTo(2, 9);
    const th = (150 * Math.PI) / 180;
    expect(earModel([Math.cos(Math.PI - th), Math.sin(Math.PI - th), 0], -1).alpha).toBeCloseTo(0.1, 9);
    expect(20 * Math.log10(shadowGain(2, 20000))).toBeGreaterThan(5.5);
    expect(shadowGain(0.1, 50)).toBeGreaterThan(0.95);
  });

  it('耳介の反射の遅れは仰角で変わり、手がかりを切ると消える', () => {
    const lo = earModel([0, 1, 0], 1).taps as number[],
      up = earModel([0, Math.SQRT1_2, Math.SQRT1_2], 1).taps as number[];
    expect(lo[1]).toBeGreaterThan(up[1]);
    expect(earModel([0, 1, 0], 1, { itd: true, ild: true, pinna: false }).taps).toBeNull();
    expect(earModel([0, -1, 0], 1).rear).toBeCloseTo(0.75, 9);
  });
});

describe('場所と鏡像', () => {
  it('部屋は直接音と 6 面の 1 回反射、路地は向かい合う壁の 2 回反射も足す', () => {
    expect(images([1, 1, 0], pl('room'))).toHaveLength(7);
    expect(images([1, 1, 0], pl('alley'))).toHaveLength(6);
    expect(images([1, 1, 0], pl('none'))).toHaveLength(1);
  });

  it('草原の最初の反射は地面で跳ね返った道のりの差', () => {
    const t = firstReflection([2, 0, 0], [0, 0, 0], pl('field')) as number;
    expect(t * CS).toBeCloseTo(Math.hypot(2, 2 * EAR_H) - 2, 9);
    expect(firstReflection([2, 0, 0], [0, 0, 0], pl('none'))).toBeNull();
  });

  it('聞き手が右を向くと、右にあった音は正面になる', () => {
    const p = toHead([3, 0, 0], { x: 0, y: 0, yaw: Math.PI / 2 });
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(3, 9);
  });

  it('場面: 音源はある録音で、数は上限まで、場所の範囲の中', () => {
    for (const sc of SCENES) {
      const [x0, x1, y0, y1] = buildPlace(kindOf(sc.place), sceneSpace(sc)).box;
      expect(sc.srcs.length).toBeLessThanOrEqual(MAX_SOURCES);
      for (const s of [...sc.srcs, sc.lis]) {
        expect(s.x).toBeGreaterThanOrEqual(x0);
        expect(s.x).toBeLessThanOrEqual(x1);
        expect(s.y).toBeGreaterThanOrEqual(y0);
        expect(s.y).toBeLessThanOrEqual(y1);
      }
      for (const s of sc.srcs) expect(SOUNDS.some((u) => u.id === s.sound)).toBe(true);
    }
    for (const k of KINDS) {
      const p = buildPlace(k, k.def);
      expect(p.box[0]).toBeGreaterThanOrEqual(p.view[0]);
    }
  });

  it('録音のファイルがそろっている', () => {
    for (const s of SOUNDS) expect(existsSync(`public/spatial-audio/${s.id}.mp3`), s.id).toBe(true);
  });

  it('どの録音にも出典がある', () => {
    expect(CREDITS.map((c) => c.id).sort()).toEqual(SOUNDS.map((s) => s.id).sort());
  });
});

describe('空間の値', () => {
  it('部屋の壁は幅と奥行きの半分、天井は床から高さの所', () => {
    const p = buildPlace(kindOf('room'), { w: 8, d: 6, h: 3, refl: 0.7, t60: 0.5, wet: 0.2 });
    expect(p.planes.filter((q) => q.ax === 0).map((q) => q.v)).toEqual([-4, 4]);
    expect(p.planes.find((q) => q.ax === 2 && q.v > 0)?.v).toBeCloseTo(3 - 1.2, 9);
    expect(p.late?.t60).toBe(0.5);
  });
  it('残響の量が 0 なら残響はなく、反射なしは面もない', () => {
    expect(buildPlace(kindOf('field'), { ...kindOf('field').def, wet: 0 }).late).toBeNull();
    expect(buildPlace(kindOf('none'), kindOf('none').def).planes).toHaveLength(0);
  });
});

describe('障害物', () => {
  const room = pl('room'),
    shelf = { name: '本棚', x: 0, y: 1, w: 2, d: 0.4, h: 2 },
    sofa = { name: 'ソファ', x: 0, y: 1, w: 2, d: 0.9, h: 0.8 };
  it('耳より高い箱は直接音を遮り、低い箱は遮らない', () => {
    const hi = occlusion(
        [
          [
            [0, 2.5, 0],
            [0, 0, 0],
          ],
        ],
        [shelf],
        room.floor,
      ),
      lo = occlusion(
        [
          [
            [0, 2.5, 0],
            [0, 0, 0],
          ],
        ],
        [sofa],
        room.floor,
      );
    expect(hi.g).toBeLessThan(1);
    expect(hi.fc).toBeGreaterThan(0);
    expect(lo).toEqual({ g: 1, fc: 0 });
  });
  it('回り込む道のりが長いほど、高い音を落とす周波数は低い', () => {
    const wide = occlusion(
        [
          [
            [0, 2.5, 0],
            [0, 0, 0],
          ],
        ],
        [{ ...shelf, w: 6 }],
        room.floor,
      ),
      narrow = occlusion(
        [
          [
            [0, 2.5, 0],
            [0, 0, 0],
          ],
        ],
        [{ ...shelf, w: 0.6 }],
        room.floor,
      );
    expect(wide.fc).toBeLessThan(narrow.fc);
  });
  it('箱の側面で跳ね返る道ができ、反射点は面の上にある', () => {
    const ps = paths([-1, -1, 0], [1, -1, 0], room, [shelf]),
      o = ps.find((q) => q.key.startsWith('o0-'));
    expect(o?.hit?.[1]).toBeCloseTo(0.8, 9);
    expect(ps[0].occ.g).toBe(1);
  });
  it('場面の障害物は場所の範囲の中', () => {
    for (const sc of SCENES)
      for (const o of sc.obs ?? []) {
        const [x0, x1, y0, y1] = buildPlace(kindOf(sc.place), sceneSpace(sc)).box;
        expect(o.x).toBeGreaterThanOrEqual(x0);
        expect(o.x).toBeLessThanOrEqual(x1);
        expect(o.y).toBeGreaterThanOrEqual(y0);
        expect(o.y).toBeLessThanOrEqual(y1);
      }
  });
});

describe('録音の下ごしらえ', () => {
  const noise = (n: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) * 0.3);
  it('声は終わりに無音を足し、自然の音は重ねた分だけ短くなる', () => {
    const v = prepareClip(noise(FS * 2), FS, true),
      n = prepareClip(noise(FS * 4), FS, false);
    expect(v.data.length).toBe(FS * 2 + Math.round(VOICE_GAP * FS));
    expect(v.data.slice(FS * 2).every((x) => x === 0)).toBe(true);
    expect(n.data.length).toBe(FS * 4 - Math.round(0.6 * FS));
    expect(v.gain).toBeGreaterThan(0);
  });
});

describe('両耳の音', () => {
  function energy(x: number, y: number, mode: Mode, id = 'none') {
    const b = new Binaural(FS);
    b.setClip(
      't',
      prepareClip(
        Float32Array.from({ length: FS }, () => Math.random() * 2 - 1),
        FS,
        false,
      ),
    );
    b.setScene({
      srcs: [{ key: 1, sound: 't', x, y, gain: 1 }],
      lis: { x: 0, y: 0, yaw: 0 },
      place: pl(id),
      obs: [],
      mode,
      cues: { itd: true, ild: true, pinna: true },
    });
    const L = new Float32Array(128),
      R = new Float32Array(128);
    let eL = 0,
      eR = 0;
    for (let k = 0; k < 300; k++) {
      b.render(L, R, 128);
      if (k < 50) continue;
      for (let i = 0; i < 128; i++) {
        eL += L[i] * L[i];
        eR += R[i] * R[i];
      }
    }
    return { eL, eR };
  }
  it('右の音は右の耳で大きく、モノラルでは両耳が同じ', () => {
    const h = energy(2, 0, 'hrtf');
    expect(h.eR).toBeGreaterThan(h.eL * 2);
    const m = energy(2, 0, 'mono');
    expect(m.eR / m.eL).toBeCloseTo(1, 6);
    const p = energy(-2, 0, 'pan');
    expect(p.eL).toBeGreaterThan(p.eR * 100);
  });
  it('遠い音は距離に反比例して小さい（空気の吸収も加わる）', () => {
    const n = energy(0, 5, 'mono'),
      f = energy(0, 50, 'mono');
    expect(10 * Math.log10(n.eL / f.eL)).toBeGreaterThan(20);
  });
  it('正面の音は左右がほぼ同じ', () => {
    const h = energy(0, 2, 'hrtf');
    expect(h.eR / h.eL).toBeCloseTo(1, 1);
  });
});

describe('カードの図柄', () => {
  it('両耳の波形を描き、1 周で同じ絵に戻る', () => {
    expect(ART.sa(0)).toContain('<circle');
    expect(ART.sa(LOOP.sa)).toBe(ART.sa(0));
  });
});

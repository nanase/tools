/**
 * 振り子時計の音の入口。刻む音は sfx-tick.ts（計算した当たりの力を源にする案）、時打ち・こはぜ・止めの音は
 * sfx-strike.ts（当たりの力学と部品の振動の型で作る案）から取る。2026-11-13 の聴き比べで、刻む音と時打ちを
 * 別の案から選んだ（design/pages/pendulum-clock.md）
 */
import type { EscType } from './esc';
import type { ClockEvent } from './model';
import * as S from './sfx-strike';
import * as T from './sfx-tick';

export { gongModes } from './sfx-strike';
export { type Mode, PLATE, plateModes } from './sfx-tick';

export type SfxKind = T.SfxKind | S.SfxKind;
/** 刻む音の側（sfx-tick.ts）が作る音 */
const isTick = (k: string) => /^(h-|r-|tick[LR]$|bank$)/.test(k);
/** 開いたときに作っておく音（時打ちの音は初めて鳴らすときに作る） */
export const SFX_PRELOAD: readonly SfxKind[] = [...T.SFX_PRELOAD.filter(isTick), ...S.SFX_PRELOAD];
/** 出来事 1 つで鳴らす音。dt は出来事の時刻からのずれ [s] */
export interface Cue {
  kind: SfxKind;
  gain: number;
  dt?: number;
}
/*
 * 大きさ: TICK は刻む音全体、TRIM は割れを防ぐための型ごとの下げ、STRIKE は時打ちの側の音全体。
 * リコイル式の刻む音でページを −26 LUFS（bun run loudness）にし、時打ちはそれより約 6 LU 大きく、ピークは 0.9 未満
 */
const TICK = 0.59,
  TRIM: Record<EscType, number> = { recoil: 1, graham: 1, brocot: 1 },
  STRIKE = 0.66;
export function cue(e: ClockEvent, type: EscType, live: boolean): Cue[] {
  switch (e.k) {
    case 'hit':
    case 'free':
      return T.cue(e, type, live).map((c) => ({ ...c, gain: c.gain * TICK * TRIM[type] }));
    case 'bank':
      return T.cue(e, type, live).map((c) => ({ ...c, gain: c.gain * TICK }));
    case 'tick':
      return [];
    default:
      return S.cue(e, live).map((c) => ({ ...c, gain: c.gain * STRIKE }));
  }
}
export const whirOf = S.whirOf;
export function makeSfx(kind: SfxKind, fs: number): Float32Array {
  return isTick(kind) ? T.makeSfx(kind as T.SfxKind, fs) : S.makeSfx(kind as S.SfxKind, fs);
}

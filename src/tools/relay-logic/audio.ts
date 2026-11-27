/**
 * リレーの音を鳴らす。音は sfx.ts で前もって作り、出来事の時刻に合わせて予約する。
 * AudioContext は初めて押したときに作る（ブラウザは押すまで音を出させない）
 */
import { handheld } from '../../lib/pause';
import type { RelayEvent } from './relay';
import { click, GAIN } from './sfx';

type Ctor = typeof AudioContext;
const ACtor: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 出口の大きさ（sfx.ts の GAIN と合わせて −26 LUFS） */
const OUT = 1;
/** リレーごとの音の種類の数（番号の余りで選ぶ） */
const VARIANTS = 6;

let ac: AudioContext | null = null,
  out: GainNode | null = null;
const bufs = new Map<string, AudioBuffer>();
let on = true;

export function soundOn(): boolean {
  return on;
}
export function setSound(v: boolean): void {
  on = v;
  if (v) ensure();
  else void ac?.suspend();
}
/** 押したときに呼ぶ。AudioContext を作るか動かし直す */
export function ensure(): void {
  if (!on || !ACtor) return;
  if (!ac) {
    ac = new ACtor();
    out = ac.createGain();
    out.gain.value = OUT * GAIN;
    /* 重なって大きくなったときだけ抑える */
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -6;
    lim.knee.value = 0;
    lim.ratio.value = 12;
    out.connect(lim).connect(ac.destination);
  }
  if (ac.state === 'suspended') void ac.resume();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && handheld()) void ac?.suspend();
});

function buf(kind: RelayEvent['k'], seed: number): AudioBuffer | null {
  if (!ac) return null;
  const v = seed % VARIANTS,
    key = `${kind}${v}`;
  let b = bufs.get(key);
  if (!b) {
    const y = click(kind, v, ac.sampleRate);
    b = ac.createBuffer(1, y.length, ac.sampleRate);
    b.getChannelData(0).set(y);
    bufs.set(key, b);
  }
  return b;
}

/** 直近に鳴らした on の音の時刻（AudioContext の時刻）。込み合うほど小さくする */
const recent: number[] = [];
/** 1 秒に何回までなら小さくしないか */
const RATE = 10;

/** 出来事を鳴らす。dt は今から鳴らすまでの秒（遅くした再生でずらす） */
export function play(ev: readonly { e: RelayEvent; dt: number }[]): void {
  if (!on || !ac || !out || ac.state !== 'running' || !ev.length) return;
  /* 等倍のブザーは 1 秒に 80 回ほど鳴り、そのままでは 15 LU ほど大きい。込み合う分だけ下げる */
  const now = ac.currentTime;
  for (const { e, dt } of ev) if (e.k === 'on') recent.push(now + dt);
  while (recent.length && recent[0] < now - 0.5) recent.shift();
  const g = Math.min(1, Math.sqrt(RATE / Math.max(1, recent.length * 2)));
  out.gain.setTargetAtTime(OUT * GAIN * g, now, 0.05);
  /* 等倍のブザーでは 1 秒に 100 回を超えるので、同じ 1 ms に重なる音はまとめる */
  let last = -1;
  const t0 = ac.currentTime + 0.03;
  for (const { e, dt } of ev) {
    const at = t0 + Math.max(0, dt);
    if (at - last < 0.001 && e.k !== 'on' && e.k !== 'off') continue;
    last = at;
    const b = buf(e.k, e.r.seed);
    if (!b) continue;
    const s = ac.createBufferSource();
    s.buffer = b;
    s.connect(out);
    s.start(at);
  }
}

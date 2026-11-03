/**
 * 音の計算をメインスレッドの外で行う。エンコードしたバイト列はメインスレッドへ返してブラウザに復号してもらい
 * （decodeAudioData はワーカーで使えない）、復号した音を受け取って原音と比べる
 */
import { encode, type Stats } from './encoder';
import { type Evaluation, evaluate, findDelay, type Spectrogram, shifted, spectrogram } from './evaluate';
import { makeSource, type SrcName } from './sources';

export type Job =
  | { kind: 'gen'; name: SrcName }
  | { kind: 'src'; ch: Float32Array[] }
  | { kind: 'enc'; id: number; kbps: number; lp: number; capture: number }
  | { kind: 'an'; id: number; lp: number; dec: Float32Array[] };

export type Out =
  | { kind: 'src'; ch: Float32Array[]; so: Spectrogram }
  | { kind: 'prog'; id: number; p: number }
  | { kind: 'enc'; id: number; bytes: Uint8Array; stats: Stats }
  | { kind: 'an'; id: number; al: Float32Array[]; diff: Float32Array[]; ev: Evaluation; sd: Spectrogram };

const post = (m: Out, tr: Transferable[] = []) => (self as unknown as Worker).postMessage(m, tr);

let src: Float32Array[] = [],
  /** 復号の遅れ（ブラウザごとに決まるので 1 度だけ探す） */
  delay: number | null = null;

function setSrc(ch: Float32Array[]): void {
  src = ch;
  post({ kind: 'src', ch: ch.map((c) => c.slice()), so: spectrogram(ch[0]) });
}

const hasSound = (x: Float32Array) => x.some((v) => Math.abs(v) > 1e-3);

self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data;
  if (j.kind === 'gen') setSrc(makeSource(j.name));
  else if (j.kind === 'src') setSrc(j.ch);
  else if (j.kind === 'enc') {
    const { id } = j,
      r = encode(src, {
        kbps: j.kbps,
        lowpass: j.lp,
        capture: j.capture,
        onProgress: (p) => post({ kind: 'prog', id, p }),
      });
    post({ kind: 'enc', id, bytes: r.bytes, stats: r.stats }, [r.bytes.buffer as ArrayBuffer]);
  } else {
    const n = src[0].length;
    let d = delay ?? 0;
    if (delay === null) {
      d = findDelay(src[0], j.dec[0]);
      /* 無音では遅れが決まらないので覚えない */
      if (hasSound(src[0])) delay = d;
    }
    const al = src.map((_, c) => shifted(j.dec[Math.min(c, j.dec.length - 1)], d, n)),
      diff = src.map((x, c) => Float32Array.from(x, (v, i) => v - al[c][i])),
      ev = evaluate(src[0], al[0], j.lp),
      sd = spectrogram(al[0]);
    post({ kind: 'an', id: j.id, al, diff, ev, sd }, [
      ...al.map((a) => a.buffer as ArrayBuffer),
      ...diff.map((a) => a.buffer as ArrayBuffer),
      ev.ratio.buffer as ArrayBuffer,
      sd.d.buffer as ArrayBuffer,
    ]);
  }
};

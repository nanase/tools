/**
 * 管を作って調律する Worker。既定の整音のストップは tuned.ts の表の値を当てはめ（調律法と A4 の違いは伸び縮みで
 * 合わせる）、整音を変えたストップは管を鳴らして調律し直す。往復の損失も先に求めて付け、ストップごとに結果を返す
 */
import type { OrganSpec, Tuned } from './model';
import { pipeId } from './model';
import { FluePipe, type FlueSpec, ReedPipe, type ReedSpec } from './pipes';
import { divOf, OPT0, type PipeOpt, pipesOf, stopOf } from './stops';
import { deviations, pitchHz, temperamentOf } from './tuning';
import { applyRow, type TunedRow, type Voiced, voice, windOf } from './voice';

export interface TuneIn {
  spec: OrganSpec;
  fs: number;
  /** 調律する順のストップ */
  stops: string[];
}
export interface TuneOut {
  stop: string;
  /** 鍵（鍵盤の下端から）ごとの列 */
  pipes: Tuned[][];
  done: number;
  total: number;
}

/** 表の 1 本ぶんを読む */
const row = (a: number[]): TunedRow => ({
  k: a[0],
  res: a[1],
  fr: a[2],
  rise: a[3],
  rms: a[4],
  db: a.slice(5, 13),
  ph: a.slice(13, 21),
});

/** 往復の損失を先に求めて設定に付ける（AudioWorklet で管を作るときに求めずに済む） */
function withFit(v: Voiced, fs: number): Voiced {
  const p = v.kind === 'flue' ? new FluePipe(v.spec as FlueSpec, fs) : new ReedPipe(v.spec as ReedSpec, fs);
  return { ...v, spec: { ...v.spec, fit: p.fit } };
}

/** ストップ 1 つを作る */
export function tuneStop(
  id: string,
  spec: OrganSpec,
  fs: number,
  table: Record<string, number[][][]> | null,
): Tuned[][] {
  const s = stopOf(id),
    d = divOf(s.div),
    dev = deviations(temperamentOf(spec.temp)),
    v = spec.voicing[id] ?? {},
    o: PipeOpt = { ...OPT0, hz: (m) => pitchHz(m, spec.a4, dev), scale: v.scale, cut: v.cut },
    useTable = !!table?.[id] && v.scale === undefined && v.cut === undefined,
    out: Tuned[][] = [];
  for (let k = d.lo; k <= d.hi; k++) {
    const defs = pipesOf(s, k, o),
      rows = table?.[id]?.[k - d.lo];
    out.push(
      defs.map((p, r) => {
        const vo = withFit(useTable && rows?.[r] ? applyRow(p, row(rows[r])) : voice(p, fs, windOf(s, o)), fs);
        return { ...vo, id: pipeId(id, k, r), stop: id, key: k, rank: r };
      }),
    );
  }
  return out;
}

/* Worker の中でだけ受け付ける（テストで tuneStop を使うときは何もしない） */
if (typeof document === 'undefined' && typeof self !== 'undefined')
  self.onmessage = async (e: MessageEvent<TuneIn>) => {
    const { spec, fs, stops } = e.data,
      table = await import('./tuned').then((m) => m.TUNED).catch(() => null);
    let done = 0;
    for (const id of stops) {
      const pipes = tuneStop(id, spec, fs, table);
      done++;
      postMessage({ stop: id, pipes, done, total: stops.length } satisfies TuneOut);
    }
  };

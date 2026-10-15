/**
 * ヴァイオリンの音を作る Worker。player.ts で 512 標本ずつ音を作り、AudioWorklet（worklet.ts）へ MessagePort で直接送る。
 * AudioWorklet が受け取った量と残っている量を知らせてくるので、先に作っておく量を一定に保つ（足りなくなったら増やす）。
 * 表示用の状態（弓速・弓圧・弦の振れなど）は、作った音の標本の番号を付けて主スレッドへ送る
 */
import type { BodySpec } from './body';
import { type Frame, type Manual, type Vib, ViolinPlayer } from './player';
import { type Expr, type PieceData, performPiece, pieceOf } from './score';
import type { VnMsg } from './worklet';

/** 主スレッドから送るもの */
export type SynthIn =
  | { type: 'port'; port: MessagePort }
  | { type: 'init'; fs: number; body: BodySpec; vib: Vib }
  | { type: 'body'; body: BodySpec }
  | { type: 'vib'; vib: Vib }
  | { type: 'manual'; m: Manual }
  /* 曲を始める（beat は始める拍。null なら頭から） */
  | { type: 'piece'; v: string; data: PieceData; expr: Expr; tempo: number; beat: number | null }
  /* 演奏中の曲の表情とテンポを変える（いまの拍から続ける） */
  | { type: 'retempo'; expr: Expr; tempo: number }
  | { type: 'stopPiece' }
  | { type: 'mute' }
  /* 作っておいた音を捨てて、すぐ鳴らす（曲の開始・停止のとき） */
  | { type: 'flush' }
  /* 揺らぎの倍率・松脂のむら・曲の弓圧の倍率 */
  | { type: 'feel'; fluct: number; rough: number; press: number }
  /* 音の波形の表示に、直前の音を送るか */
  | { type: 'scope'; on: boolean };

/** 音の波形の表示に送る長さ [標本] */
export const SCOPE_N = 8192;

/** 主スレッドへ送るもの */
export type SynthOut =
  | { type: 'frames'; frames: Frame[] }
  /* 直前の音（1 m 先の音圧 [Pa]、残響なし。左右の平均） */
  | { type: 'wave'; y: Float32Array; fs: number }
  /* 曲を始めた: 長さ [s]、最初と最後の拍 */
  | { type: 'piece'; v: string; dur: number; b0: number; b1: number }
  | { type: 'done' }
  | { type: 'error'; msg: string };

/** AudioWorklet から送るもの: 区切りの番号、受け取った標本の数、残っている標本の数、足りなかった回数 */
export interface UsedMsg {
  type: 'used';
  epoch: number;
  got: number;
  queued: number;
  under: number;
}

const BLOCK = 512;
let port: MessagePort | null = null,
  pl: ViolinPlayer | null = null,
  /** 区切りの番号（作っておいた音を捨てるたびに増やす）と、その区切りで送った標本の数 */
  epoch = 0,
  made = 0,
  /** AudioWorklet が最後に知らせた、受け取った量と残っている量 */
  got = 0,
  queued = 0,
  under = 0,
  /** 先に作っておく量 [s] */
  lead = 0.15,
  frames: Frame[] = [],
  busy = false,
  /** 演奏中の曲（表情・テンポを変えるときに使う） */
  cur: { v: string; data: PieceData; perf: ReturnType<typeof performPiece>; seed: number } | null = null,
  /** 音の波形の表示: 送るか、直前の音の輪、書く位置、前に送ってからの標本の数 */
  scopeOn = false,
  ringPos = 0,
  sinceWave = 0,
  feel = { fluct: 1, rough: 0.03, press: 1 };
const ring = new Float32Array(SCOPE_N);

const post = (m: SynthOut) => postMessage(m);

/** 足りない分の音を作って送る */
function pump(): void {
  if (!pl || !port || busy) return;
  busy = true;
  const fs = pl.fs;
  /* まだ届いていない分と、AudioWorklet に残っている分 */
  while (made - got + queued < lead * fs) {
    const L = new Float32Array(BLOCK),
      R = new Float32Array(BLOCK),
      at = pl.count;
    const fr = pl.render(L, R, 0, BLOCK);
    if (scopeOn) {
      for (let i = 0; i < BLOCK; i++) {
        ring[ringPos] = 0.5 * (L[i] + R[i]);
        ringPos = (ringPos + 1) % SCOPE_N;
      }
      sinceWave += BLOCK;
      /* 約 0.2 s ごとに送る */
      if (sinceWave >= 0.2 * fs) {
        sinceWave = 0;
        const y = new Float32Array(SCOPE_N);
        y.set(ring.subarray(ringPos), 0);
        y.set(ring.subarray(0, ringPos), SCOPE_N - ringPos);
        postMessage({ type: 'wave', y, fs } satisfies SynthOut, { transfer: [y.buffer] });
      }
    }
    port.postMessage({ type: 'audio', epoch, at, L, R } satisfies VnMsg, [L.buffer, R.buffer]);
    made += BLOCK;
    frames.push(fr);
    if (fr.done) {
      cur = null;
      post({ type: 'done' });
    }
    /* 先の量を見積もり直すまで、一度に作るのは 0.1 s まで */
    if (made - got > 0.1 * fs + lead * fs) break;
  }
  if (frames.length) {
    post({ type: 'frames', frames });
    frames = [];
  }
  busy = false;
}

function flush(): void {
  epoch++;
  made = 0;
  got = 0;
  queued = 0;
  port?.postMessage({ type: 'flush', epoch } satisfies VnMsg);
}

self.onmessage = (e: MessageEvent<SynthIn>) => {
  const m = e.data;
  try {
    if (m.type === 'port') {
      port = m.port;
      port.onmessage = (ev: MessageEvent<UsedMsg>) => {
        const u = ev.data;
        if (u.type !== 'used' || u.epoch !== epoch) return;
        got = u.got;
        queued = u.queued;
        /* 足りなくなったら、先に作っておく量を増やす（0.6 s まで） */
        if (u.under > under) lead = Math.min(0.6, lead + 0.05);
        under = u.under;
        pump();
      };
    } else if (m.type === 'feel') {
      feel = { fluct: m.fluct, rough: m.rough, press: m.press };
      pl?.setFeel(m.fluct, m.rough, m.press);
    } else if (m.type === 'scope') {
      scopeOn = m.on;
      sinceWave = 1e9;
    } else if (m.type === 'init') {
      pl = new ViolinPlayer(m.fs, m.body);
      pl.setVib(m.vib);
      pl.setFeel(feel.fluct, feel.rough, feel.press);
      pump();
    } else if (!pl) {
      /* 初期化の前は何もしない */
    } else if (m.type === 'body') pl.setBody(m.body);
    else if (m.type === 'vib') pl.setVib(m.vib);
    else if (m.type === 'manual') {
      if (m.m.strings.length) cur = null;
      pl.setManual(m.m);
    } else if (m.type === 'piece') {
      const p = pieceOf(m.v),
        perf = performPiece(p, m.data, m.expr, m.tempo),
        seed = 5;
      cur = { v: p.v, data: m.data, perf, seed };
      flush();
      pl.play(perf, seed, m.beat === null ? 0 : perf.sec(m.beat));
      post({ type: 'piece', v: p.v, dur: perf.end, b0: perf.beat(0), b1: perf.beat(perf.end) });
    } else if (m.type === 'retempo') {
      const t = pl.pieceTime();
      if (!cur || t === null) return;
      const p = pieceOf(cur.v),
        b = cur.perf.beat(t),
        perf = performPiece(p, cur.data, m.expr, m.tempo);
      cur = { ...cur, perf, seed: cur.seed + 1 };
      pl.play(perf, cur.seed, perf.sec(b));
      post({ type: 'piece', v: p.v, dur: perf.end, b0: perf.beat(0), b1: perf.beat(perf.end) });
    } else if (m.type === 'stopPiece') {
      cur = null;
      pl.stopPiece();
    } else if (m.type === 'mute') {
      cur = null;
      pl.muteAll();
    } else if (m.type === 'flush') flush();
    pump();
  } catch (err) {
    post({ type: 'error', msg: String(err) });
  }
};

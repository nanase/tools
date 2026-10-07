/**
 * 打鍵の模型を計算する Worker。ピアノの模型（model.ts）を持ち、打鍵ごとにハンマーの衝突と結合したモードを求めて、
 * AudioWorklet へ MessagePort で直接送る。弦の振動の表示に使う成分は主スレッドへ返す。
 * ハンマーの衝突は、鍵と速さとソフトペダルごとに覚えておく
 */
import type { Contact } from './hammer';
import { makePiano, type Piano, type PianoSpec, type StringView, strikeKey } from './model';
import { KEY_LO } from './strings';
import type { PnMsg } from './worklet';

/** 主スレッドから送るもの */
export type SynthIn =
  | { type: 'port'; port: MessagePort }
  | { type: 'spec'; spec: PianoSpec; fs: number }
  | {
      type: 'strike';
      id: number;
      key: number;
      /** ハンマーの速さ [m/s] */
      v: number;
      soft: boolean;
      /** 鍵盤の音の大きさ */
      thump: number;
      /** 鍵ごとにダンパーが上がっているか（1 なら共鳴できる） */
      free: Uint8Array;
      at: number;
      /** 止めるたびに増やす番号（止めたあとに届いた古い打鍵を鳴らさない） */
      gen: number;
    };
/** 主スレッドへ返すもの */
export type SynthOut = { type: 'view'; id: number; view: StringView };

/** 覚えておく衝突の数 */
const CACHE = 600;

let P: Piano | null = null,
  fs = 48000,
  port: MessagePort | null = null;
const cache = new Map<string, Contact>();

if (typeof document === 'undefined')
  self.onmessage = (e: MessageEvent<SynthIn>) => {
    const m = e.data;
    if (m.type === 'port') port = m.port;
    else if (m.type === 'spec') {
      P = makePiano(m.spec, m.fs);
      fs = m.fs;
      cache.clear();
    } else if (P) {
      const ck = `${m.key}|${m.v}|${+m.soft}`,
        hit = cache.get(ck),
        s = strikeKey(
          P,
          { key: m.key, v: m.v, soft: m.soft, free: (k) => m.free[k - KEY_LO] === 1, thump: m.thump },
          fs,
          hit,
        );
      if (!hit) {
        if (cache.size >= CACHE) cache.delete(cache.keys().next().value as string);
        cache.set(ck, s.contact);
      }
      const p = s.msg;
      port?.postMessage({ type: 'strike', at: m.at, p, gen: m.gen } satisfies PnMsg, [
        p.w.buffer,
        p.s.buffer,
        p.fr.buffer,
        p.fi.buffer,
        p.own.buffer,
        p.sd.buffer,
        p.att.buffer,
      ]);
      postMessage({ type: 'view', id: m.id, view: s.view } satisfies SynthOut);
    }
  };

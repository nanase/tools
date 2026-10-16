/**
 * ブラウザでの日食のデータの読み込み: 100 年ごと・サロス系列ごとの目録と要素、陸地
 *
 * どれも初めて要るときに読み、読んだものは覚えておく
 */
import type { Entry } from './catalog';
import type { Elements } from './elements';
import type { Rings } from './land';
import { centuryOf, type Packed, unpack } from './pack';

export interface Eclipse {
  entry: Entry;
  el: Elements;
  /** 1 件を指す鍵（年-月-日） */
  id: string;
}

const BASE = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${BASE}solar-eclipse/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    cache.set(path, p);
    // 失敗したら次はやり直す
    p.catch(() => cache.delete(path));
  }
  return p;
}

export const idOf = (e: Entry) => `${e.year}-${e.month}-${e.day}`;

const toEclipses = (rows: Packed[]): Eclipse[] =>
  rows.map((r) => {
    const { entry, el } = unpack(r);
    return { entry, el, id: idOf(entry) };
  });

/** 100 年ぶん（c = 年 ÷ 100 の切り捨て）。正典の範囲の外は空 */
export async function century(c: number): Promise<Eclipse[]> {
  if (c < -20 || c > 30) return [];
  return toEclipses(await get<Packed[]>(`c/${c}.json`));
}

/** 年の範囲 [y0, y1] の日食（日付の順） */
export async function range(y0: number, y1: number): Promise<Eclipse[]> {
  const cs: number[] = [];
  for (let c = centuryOf(y0); c <= centuryOf(y1); c++) cs.push(c);
  const all = (await Promise.all(cs.map(century))).flat();
  return all.filter((e) => e.entry.year >= y0 && e.entry.year <= y1);
}

/** サロス系列の全員（系列の番号の順） */
export async function saros(n: number): Promise<Eclipse[]> {
  return toEclipses(await get<Packed[]>(`s/${n}.json`)).sort((a, b) => a.entry.sarosPos - b.entry.sarosPos);
}

/** 年-月-日で 1 件を探す */
export async function find(id: string): Promise<Eclipse | null> {
  // 紀元前（天文学的な年の数え方で負）の年は先頭に − が付く
  const m = /^(-?\d+)-\d+-\d+$/.exec(id);
  if (!m) return null;
  const y = Number(m[1]);
  return (await century(centuryOf(y))).find((e) => e.id === id) ?? null;
}

/** 陸地（Natural Earth）。detail = '110' は全球の図、'50' は観測地のまわりの拡大図 */
export const land = (detail: '110' | '50') => get<Rings>(`land${detail}.json`);

/**
 * ページを開いて操作し、操作や再生のたびに枠の高さが変わる所（画面が上下する所）を探す。決まりは design/page.md の
 * 「動いても場所を変えない」、使い方は DEVELOPMENT.md の「画面の揺れ」
 *
 *   bun run dev                              # 別の端末で開発サーバを起動しておく
 *   bun run layout-shift guitar              # ページ名を並べる。省けば全ページ（1 時間ほどかかる）
 *   bun run layout-shift --width 360 guitar  # 幅を 1 つにする（既定は 360 と 1280）
 *   bun run layout-shift --base http://127.0.0.1:4330 guitar
 *
 * ヘッドレスの Edge（なければ環境変数 BROWSER のブラウザ）を CDP で動かす。開いて待つ・再生する・数値の欄を端から端まで
 * 動かす・選択肢とボタンを順に押す。そのたびに枠（.pnl）の高さが変わったら、原因の要素と前後の文字を出す。
 * 数えないもの
 * - ボタンや選択で行・枠が出る・消える（表示の切り替え）。文字が変わって折り返すものは、どの操作でも数える
 * - 図（canvas・svg・img・video）の大きさ、動作原理と式の枠、「その他」の開閉
 * - data-shift="ok" を付けた要素の中（入力した文字の長さで決まる欄など。付けるときは理由をコメントに書く）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Trig = 'idle' | 'play' | 'num' | 'sel' | 'btn';
interface Rec {
  a: string;
  trig: Trig;
  sel: string;
  pt: string;
  h0: number;
  h1: number;
  t0: string | null;
  t1: string | null;
  show: boolean;
}

/** ページの中で動く。window.__ls に操作と計測の関数を置く */
function probe(): void {
  /** 高さが変わると下が動く枠 */
  const ANCH = '.pnl, main > *, .tp';
  /** 数えない所 */
  const SKIP = '[data-shift="ok"], details.a-thy, .more-b';
  /** 押さないボタン（外へ出る・許可を求める・ファイルを選ぶ） */
  const NOPUSH =
    /全画面|マイク|ファイル|保存|ダウンロード|書き出|コピー|共有|MIDI|接続|開く|読み込|印刷|カメラ|画像を選|貼り付|現在地/;
  /** 再生のボタン（名前がこの語だけのもの。「演奏者の目線」のような表示の切り替えは除く） */
  const PLAY = /^(▶\s*)?(演奏|再生|開始|スタート|動かす|始める|鳴らす|受信: 開始|play)$/i;
  const ids = new WeakMap<Element, number>();
  let next = 1;
  const idOf = (el: Element) => {
    let v = ids.get(el);
    if (!v) {
      v = next++;
      ids.set(el, v);
    }
    return v;
  };
  const desc = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el, i = 0; e && i < 4; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += `#${e.id}`;
      const cl = [...e.classList].filter((c) => c.length < 24).slice(0, 2);
      if (cl.length) s += `.${cl.join('.')}`;
      parts.unshift(s);
      if (e.id) break;
    }
    return parts.join(' > ');
  };
  const els = () => {
    const m = document.querySelector('main') ?? document.body;
    return [m, ...m.querySelectorAll('*')].filter((e) => !(e.closest('svg') && e.tagName !== 'svg'));
  };
  const txt = (el: Element) => {
    if (el.childElementCount > 40) return null;
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    return t.length > 80 ? `${t.slice(0, 80)}…` : t;
  };
  const outOfFlow = (el: Element, stop: Element | null) => {
    for (let e: Element | null = el; e && e !== stop; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'absolute' || p === 'fixed') return true;
    }
    return false;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  type Snap = Map<number, { el: Element; h: number; t: string | null }>;
  const snap = (): Snap => {
    const s: Snap = new Map();
    for (const el of els()) s.set(idOf(el), { el, h: el.getBoundingClientRect().height, t: txt(el) });
    return s;
  };
  let prev: Snap | null = null;
  const diff = (a: string, trig: Trig) => {
    const cur = snap(),
      out: Rec[] = [];
    if (prev) {
      const ch: { el: Element; h0: number; h1: number; t0: string | null; t1: string | null }[] = [];
      for (const [id, c] of cur) {
        const p = prev.get(id);
        if (p && Math.abs(c.h - p.h) >= 1) ch.push({ el: c.el, h0: p.h, h1: c.h, t0: p.t, t1: c.t });
      }
      const anchors = new Set(ch.filter((c) => c.el.matches(ANCH)).map((c) => c.el));
      if (anchors.size) {
        const Z = new Set(ch.filter((c) => c.h0 < 1 || c.h1 < 1).map((c) => c.el)),
          R = new Set(ch.filter((c) => !Z.has(c.el)).map((c) => c.el));
        for (const c of ch) {
          const show = Z.has(c.el);
          if (show && c.el.parentElement && Z.has(c.el.parentElement)) continue;
          if (!show && [...R, ...Z].some((o) => o !== c.el && c.el.contains(o))) continue;
          let inA = false;
          for (let e: Element | null = c.el; e; e = e.parentElement) if (anchors.has(e)) inA = true;
          if (!inA || c.el.closest(SKIP) || c.el.matches('canvas, svg, img, video')) continue;
          if (outOfFlow(c.el, c.el.closest(ANCH))) continue;
          const pt = (c.el.closest('.pnl')?.querySelector('h2')?.textContent ?? '').trim().slice(0, 20);
          out.push({
            a,
            trig,
            sel: desc(c.el),
            pt,
            h0: Math.round(c.h0),
            h1: Math.round(c.h1),
            t0: c.t0,
            t1: c.t1,
            show,
          });
        }
      }
    }
    prev = cur;
    return out;
  };
  const byId = (id: number) => els().find((e) => ids.get(e) === id) ?? null;
  const label = (el: Element) => {
    const row = el.closest<HTMLElement>('.prow');
    const nm = row ? (row.dataset.nm ?? row.querySelector('.pn')?.textContent ?? '').trim() : '';
    const t = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return (nm ? `${nm}: ` : '') + t;
  };
  const pushable = (b: HTMLButtonElement) =>
    !b.disabled &&
    visible(b) &&
    !b.matches('.fold, .prst, .rrst, .sc-a, .sc-df, summary *') &&
    !b.closest('.sc-pop, .tp-trk') &&
    !NOPUSH.test(`${b.getAttribute('aria-label') ?? ''} ${b.title} ${b.textContent}`) &&
    (b.textContent ?? '').trim() !== '?';
  Object.assign(window, {
    __ls: {
      diff,
      openAll() {
        for (const d of document.querySelectorAll('main details')) (d as HTMLDetailsElement).open = true;
        for (const b of document.querySelectorAll<HTMLElement>('main .fold[aria-expanded="false"]')) b.click();
      },
      plays: () =>
        [...document.querySelectorAll<HTMLButtonElement>('main button')]
          .filter(
            (b) =>
              pushable(b) &&
              (b.id === 'tp-pp' ||
                [b.getAttribute('aria-label'), b.textContent].some((t) => PLAY.test((t ?? '').trim()))),
          )
          .slice(0, 3)
          .map(idOf),
      sliders: () => [...document.querySelectorAll('main .sc[role=slider]')].filter(visible).map(idOf),
      selects: () => [...document.querySelectorAll('main select')].filter(visible).map(idOf),
      buttons: () =>
        [...document.querySelectorAll<HTMLButtonElement>('main button')].filter(pushable).slice(0, 200).map(idOf),
      key(id: number, k: string) {
        const el = byId(id);
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        return el ? label(el) : null;
      },
      reset: (id: number) => byId(id)?.closest('.prow')?.querySelector<HTMLElement>('.rrst')?.click(),
      click(id: number) {
        const el = byId(id) as HTMLButtonElement | null;
        if (!el || el.disabled || !visible(el)) return null;
        const l = label(el);
        el.click();
        return l;
      },
      nopt: (id: number) => (byId(id) as HTMLSelectElement | null)?.options.length ?? 0,
      pick(id: number, i: number) {
        const el = byId(id) as HTMLSelectElement | null;
        if (!el) return null;
        el.selectedIndex = i;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return `${el.id}: ${el.options[i]?.text ?? ''}`;
      },
    },
  });
}

/** 数える揺れか。表示の切り替え（ボタン・選択で出る・消える）は数えない */
const counts = (r: Rec) => !r.show || r.trig === 'idle' || r.trig === 'play' || r.trig === 'num';

/* ---------- 引数 ---------- */
const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const base = (opt('--base') ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const widths = (opt('--width') ?? '360,1280').split(',').map(Number);
const all = readdirSync(new URL('../src/pages/', import.meta.url))
  .filter((f) => f.endsWith('.astro') && f !== 'index.astro')
  .map((f) => f.slice(0, -6));
const pages = args.length ? args : all;
for (const p of pages) if (!all.includes(p)) throw new Error(`${p} というページはありません`);
if (!(await fetch(`${base}/tools/`).catch(() => null))?.ok)
  throw new Error(`${base}/tools/ が開けません。bun run dev で開発サーバを起動してください`);

/* ---------- ブラウザ ---------- */
const bin = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter((p): p is string => !!p)
  .find((p) => existsSync(p));
if (!bin) throw new Error('ブラウザが見つかりません。環境変数 BROWSER で Edge か Chrome を指してください');
const prof = mkdtempSync(join(tmpdir(), 'nanase-tools-shift-')),
  port = 9300 + Math.floor(Math.random() * 600);
const browser = spawn(
  bin,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${prof}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function cdp(): Promise<{ webSocketDebuggerUrl: string }> {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    if (r?.ok) return r.json();
    await sleep(200);
  }
  throw new Error('ブラウザに CDP でつながりません');
}

async function openTab(width: number) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok) => {
    ws.onopen = ok;
  });
  let id = 0;
  const wait = new Map<number, (m: { result?: { result?: { value?: unknown } } }) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: false });
    wait.get(m.id)?.(m);
    wait.delete(m.id);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<{ result?: { result?: { value?: unknown } } }>((ok) => {
      wait.set(++id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const run = async <T>(expr: string): Promise<T> =>
    (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result
      ?.value as T;
  const mobile = width < 700;
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: mobile ? 3 : 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${probe.toString()})()` });
  return { ws, send, run };
}

/** 1 ページを操作して、揺れを集める */
async function audit(tab: Awaited<ReturnType<typeof openTab>>, page: string): Promise<Rec[]> {
  const recs: Rec[] = [];
  const step = async (a: string, trig: Trig, ms = 260) => {
    await sleep(ms);
    recs.push(...((await tab.run<Rec[]>(`__ls.diff(${JSON.stringify(a)}, '${trig}')`)) ?? []));
  };
  await tab.send('Page.navigate', { url: `${base}/tools/${page}/` });
  await sleep(4000);
  await tab.run('__ls.openAll()');
  await sleep(1500);
  await tab.run('__ls.diff("", "idle")');
  for (let i = 0; i < 12; i++) await step('開いて待つ', 'idle', 330);
  for (const b of (await tab.run<number[]>('__ls.plays()')) ?? []) {
    const l = await tab.run<string | null>(`__ls.click(${b})`);
    if (!l) continue;
    for (let i = 0; i < 45; i++) await step(`再生「${l}」`, 'play', 300);
    await tab.run(`__ls.click(${b})`);
    await step(`再生の停止「${l}」`, 'play', 400);
  }
  for (const s of (await tab.run<number[]>('__ls.sliders()')) ?? []) {
    for (const k of ['Home', 'PageUp', 'PageUp', 'PageUp', 'End', 'PageDown']) {
      const l = await tab.run<string | null>(`__ls.key(${s}, '${k}')`);
      if (!l) break;
      await step(`数値 ${l}`, 'num');
    }
    await tab.run(`__ls.reset(${s})`);
    await step('数値を戻す', 'num');
  }
  for (const s of (await tab.run<number[]>('__ls.selects()')) ?? []) {
    const n = Math.min((await tab.run<number>(`__ls.nopt(${s})`)) ?? 0, 12);
    for (let i = 0; i < n; i++) await step(`選択 ${await tab.run<string>(`__ls.pick(${s}, ${i})`)}`, 'sel');
  }
  for (const b of (await tab.run<number[]>('__ls.buttons()')) ?? []) {
    const l = await tab.run<string | null>(`__ls.click(${b})`);
    if (l) await step(`ボタン ${l}`, 'btn');
  }
  for (let i = 0; i < 6; i++) await step('最後に待つ', 'idle', 330);
  return recs.filter(counts);
}

/* ---------- 調べる ---------- */
await cdp();
const PAR = Math.min(4, pages.length * widths.length);
const queue = widths.flatMap((w) => pages.map((p) => [p, w] as const));
let bad = 0;
await Promise.all(
  Array.from({ length: PAR }, async () => {
    const tabs = new Map<number, Awaited<ReturnType<typeof openTab>>>();
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [p, w] = job;
      let tab = tabs.get(w);
      if (!tab) {
        tab = await openTab(w);
        tabs.set(w, tab);
      }
      const recs = await audit(tab, p).catch((e) => {
        console.log(`${p} ${w}px  調べられません: ${String(e).slice(0, 200)}`);
        return null;
      });
      if (!recs) continue;
      /* 同じ要素はまとめる */
      const g = new Map<string, Rec & { n: number; hs: Set<number> }>();
      for (const r of recs) {
        const o = g.get(r.sel) ?? { ...r, n: 0, hs: new Set<number>() };
        o.n++;
        o.hs.add(r.h0).add(r.h1);
        g.set(r.sel, o);
      }
      if (!g.size) {
        console.log(`${p} ${w}px  揺れなし`);
        continue;
      }
      bad += g.size;
      const lines = [...g.values()].map(
        (o) =>
          `  [${o.pt}] ${o.sel.replace(/^main\.wrap > /, '')}  高さ ${[...o.hs].sort((a, b) => a - b).join('/')} px  ${o.n} 回\n` +
          `    ${o.a}${o.show ? '（出る・消える）' : ''}: ${o.t0 ?? ''} → ${o.t1 ?? ''}`,
      );
      console.log(`${p} ${w}px  揺れ ${g.size} か所\n${lines.join('\n')}`);
    }
    for (const t of tabs.values()) t.ws.close();
  }),
);
browser.kill();
await sleep(500);
rmSync(prof, { recursive: true, force: true });
process.exit(bad ? 1 : 0);

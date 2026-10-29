/**
 * 共有の画像（public/og.png）と README の冒頭の画像（.github/banner.svg）を、カードの図柄から作る。
 *
 *   bun scripts/og-image.ts
 *
 * 絵は 1200×630 で、上下に 2 段ずつカードの図柄を 5 枚並べ、中央の帯にサイト名と副題を置く。
 * banner.svg は図柄が数枚ずつ順に動く（SMIL）。GitHub は README の SVG を <img> で表示し、スクリプトも
 * 外部のフォントも読まないので、図柄は時刻ごとのコマを書き出して表示を切り替え、文字は使う字だけの
 * フォントを Google Fonts から取って埋め込む（Fira Mono・Noto Sans JP、どちらも SIL OFL 1.1）。
 * og.png は動かない版の SVG を Edge（なければ環境変数 BROWSER のブラウザ）のヘッドレスで撮る
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ART, LOOP } from '../src/lib/card-art';

const W = 1200,
  H = 630,
  PAD = 10,
  GAP = 8,
  BAND = 192;
const TITLE = 'Tools + Simulators',
  SUB = '電子から音響・光学・天文まで';
/** 並べる図柄（lib/card-art.ts の ART のキー）。上の 2 段、下の 2 段の順 */
const TILES = 'sq pid ip kf bq jjy qr os sp nz gt pn tp og en hl fk se mn tu'.split(' ');
/** 動かす順（隣り合う図柄が続けて動かないように混ぜる） */
const ORDER = [0, 12, 6, 18, 3, 15, 9, 1, 13, 7, 19, 4, 16, 10, 2, 14, 8, 17, 5, 11];
/** 動きの 1 巡の長さ [s]・1 秒のコマ数・1 枚が進む最長の時間 [s]・戻す時間 [s] */
const CYCLE = 20,
  FPS = 12,
  RUN = 3,
  BACK = 0.6;

const TW = (W - 2 * PAD - 4 * GAP) / 5,
  TH = ((H - 2 * PAD - BAND - 2 * GAP) / 2 - GAP) / 2;
const SCREEN = '#08090a';

const f = (v: number): string => String(Math.round(v * 100) / 100);
const kt = (v: number): string => String(Math.round(v * 1e5) / 1e5);

/** 図柄の 1 コマ。clipPath の id をコマごとに分け、CSS 変数を色に置き換える */
function frame(key: string, t: number, tag: string): string {
  return ART[key](t)
    .replace(/id="([^"]+)"/g, `id="$1-${tag}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-${tag})`)
    .replace(/var\(--screen\)/g, SCREEN);
}

/** 表示を切り替える SMIL。[s, e) の間だけ visible（on = false なら逆） */
function vis(s: number, e: number, on: boolean): string {
  const [a, b] = on ? ['hidden', 'visible'] : ['visible', 'hidden'];
  return `<animate attributeName="visibility" dur="${CYCLE}s" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${kt(s / CYCLE)};${kt(e / CYCLE)}" values="${a};${b};${a}"/>`;
}

/** 1 枚の図柄のコマ。動かさない版は t = 0 の絵だけ */
function tileArt(i: number, animate: boolean): string {
  const key = TILES[i];
  if (!animate) return `<g>${frame(key, 0, `${i}`)}</g>`;
  const loop = LOOP[key] ?? RUN,
    run = Math.min(loop, RUN);
  /* 1 周より短く止めるときは、止めた時刻から 0 へなめらかに戻す（scripts/card-motion.ts と同じ） */
  const full = run >= loop - 1e-9;
  const ts: number[] = [];
  for (let k = 1; k < Math.round(run * FPS); k++) ts.push(k / FPS);
  if (!full) {
    const n = Math.round(BACK * FPS);
    for (let j = 0; j < n; j++) {
      const p = j / n;
      ts.push(run * (1 - p * p * (3 - 2 * p)));
    }
  }
  const step = (CYCLE - RUN - BACK - 1) / (TILES.length - 1);
  const s0 = 0.5 + ORDER.indexOf(i) * step,
    e0 = s0 + ts.length / FPS;
  const out = [`<g class="f0">${vis(s0, e0, false)}${frame(key, 0, `${i}-0`)}</g>`];
  ts.forEach((t, k) => {
    const s = s0 + k / FPS;
    out.push(`<g class="fr" visibility="hidden">${vis(s, s + 1 / FPS, true)}${frame(key, t, `${i}-${k + 1}`)}</g>`);
  });
  return out.join('');
}

function tile(i: number, x: number, y: number, animate: boolean): string {
  return (
    `<svg x="${f(x)}" y="${f(y)}" width="${f(TW)}" height="${f(TH)}">` +
    `<rect width="${f(TW)}" height="${f(TH)}" rx="6" fill="${SCREEN}"/>` +
    `<rect width="${f(TW)}" height="${f(TH)}" fill="url(#grid)"/>` +
    `<rect x=".75" y=".75" width="${f(TW - 1.5)}" height="${f(TH - 1.5)}" rx="5.25" fill="none" stroke="#2b3237" stroke-width="1.5"/>` +
    `<svg class="ic" viewBox="0 0 120 48" width="${f(TW)}" height="${f(TH)}">${tileArt(i, animate)}</svg></svg>`
  );
}

/** Google Fonts から、text の字だけを含む woff2 を取る */
async function subset(family: string, weight: number, text: string): Promise<string> {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`;
  /* woff2 を返させるため、今のブラウザの User-Agent を名乗る */
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  const css = await (await fetch(url, { headers: { 'user-agent': ua } })).text();
  const m = css.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/);
  if (!m) throw new Error(`${family} の woff2 が見つかりません`);
  const buf = Buffer.from(await (await fetch(m[1])).arrayBuffer());
  return buf.toString('base64');
}

function svg(animate: boolean, mono: string, jp: string): string {
  const rows = [PAD, PAD + TH + GAP, H - PAD - 2 * TH - GAP, H - PAD - TH];
  const tiles: string[] = [];
  TILES.forEach((_, i) => {
    tiles.push(tile(i, PAD + (i % 5) * (TW + GAP), rows[Math.floor(i / 5)], animate));
  });
  /* 中央の帯: ロゴとサイト名を 1 行に並べ、その下に副題。Fira Mono の字幅は 0.6 em */
  const cy = H / 2,
    fs = 70,
    logo = 56,
    gap = 18,
    tw = TITLE.length * 0.6 * fs,
    x0 = (W - (logo + gap + tw)) / 2;
  const css = [
    `@font-face{font-family:M;font-weight:700;src:url(data:font/woff2;base64,${mono}) format("woff2")}`,
    `@font-face{font-family:J;font-weight:700;src:url(data:font/woff2;base64,${jp}) format("woff2")}`,
    '.ic *{fill:none;stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}',
    '.ic .a{stroke:#f2c230}.ic .b{stroke:#52c4dd}.ic .c{stroke:#aab3b8}.ic .d{stroke-dasharray:4 4;opacity:.7}',
    '.ic .t{stroke-width:1.2}.ic .w{stroke-width:4;stroke-linecap:butt}.ic .g{opacity:.45}',
    '.ic .fa{fill:#f2c230;stroke:none}.ic .fb{fill:#52c4dd;stroke:none}.ic .fc{fill:#aab3b8;stroke:none;opacity:.75}',
    /* 動きを減らす設定では、止まっている絵だけを見せる */
    '@media (prefers-reduced-motion:reduce){.fr{visibility:hidden!important}.f0{visibility:visible!important}}',
  ].join('');
  const gx = (TW / 2) % 20,
    gy = (TH / 2) % 20;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${TITLE}: ${SUB}">`,
    `<title>${TITLE}: ${SUB}</title>`,
    `<style>${css}</style>`,
    `<defs><pattern id="grid" x="${f(gx)}" y="${f(gy)}" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M0 .5H20M.5 0V20" fill="none" stroke="#1c2428"/></pattern></defs>`,
    `<rect width="${W}" height="${H}" fill="#121517"/>`,
    ...tiles,
    `<svg x="${f(x0)}" y="${f(cy - 25 - logo / 2)}" width="${logo}" height="${logo}" viewBox="0 0 30 30"><rect x="1" y="1" width="28" height="28" rx="3" fill="none" stroke="#e6e8e4" stroke-width="1.5"/><path d="M5 20H10V9H16V20H22V9H25" fill="none" stroke="#f2c230" stroke-width="2" stroke-linejoin="round"/></svg>`,
    `<text x="${f(x0 + logo + gap)}" y="${f(cy - 25)}" dominant-baseline="central" font-family="M" font-weight="700" font-size="${fs}" fill="#e6e8e4">${TITLE}</text>`,
    `<text x="${W / 2}" y="${f(cy + 46)}" dominant-baseline="central" text-anchor="middle" font-family="J" font-weight="700" font-size="30" fill="#a7afb5">${SUB}</text>`,
    '</svg>',
  ].join('\n');
}

/**
 * ヘッドレスのブラウザで撮る。Windows の Edge のほか、環境変数 BROWSER で Chrome などを指せる。
 * Windows の Edge は書き終える前に戻るので、ファイルの大きさが落ち着くまで待つ
 */
async function shoot(src: string, out: string): Promise<void> {
  const cands = [
    process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter((p): p is string => !!p);
  const bin = cands.find((p) => existsSync(p));
  if (!bin) throw new Error('ブラウザが見つかりません。環境変数 BROWSER で Edge か Chrome を指してください');
  const prof = join(tmpdir(), 'nanase-tools-og-profile');
  const r = spawnSync(
    bin,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${prof}`,
      `--window-size=${W},${H}`,
      `--screenshot=${out}`,
      pathToFileURL(src).href,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`撮れませんでした: ${r.stderr}`);
  let last = -1;
  for (let i = 0; i < 300; i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    const size = existsSync(out) ? statSync(out).size : -1;
    if (size > 0 && size === last) return;
    last = size;
  }
  throw new Error('撮れませんでした: 30 秒待っても画像ができません');
}

const [mono, jp] = await Promise.all([subset('Fira Mono', 700, TITLE), subset('Noto Sans JP', 700, SUB)]);

const banner = svg(true, mono, jp);
const gh = new URL('../.github/', import.meta.url);
mkdirSync(gh, { recursive: true });
writeFileSync(new URL('banner.svg', gh), banner);
console.log(`wrote .github/banner.svg (${Math.round(banner.length / 1024)} KB)`);

const still = join(tmpdir(), 'nanase-tools-og.svg');
writeFileSync(still, svg(false, mono, jp));
const png = fileURLToPath(new URL('../public/og.png', import.meta.url));
rmSync(png, { force: true });
await shoot(still, png);
console.log('wrote public/og.png');

/**
 * node_modules の CLI（astro・vitest）を、.mise.toml で決めた版の Node で動かす。
 * package.json のスクリプトから bun scripts/node.ts <パッケージ> [引数…] で呼ぶ。
 *
 * bun run はスクリプトの node を PATH から探すため、ほかの Node（OS に入れた古い版など）が
 * PATH の先にあると、それで動いてしまう。ここでは mise が入れた Node を直接使い、
 * 版が違えば止める
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url),
  cwd = fileURLToPath(root);

/** .mise.toml の node の版の先頭（メジャー版） */
function wantMajor(): number {
  const m = readFileSync(new URL('.mise.toml', root), 'utf8').match(/^node\s*=\s*"(\d+)/m);
  if (!m) throw new Error('.mise.toml に node の版がありません');
  return Number(m[1]);
}

/** mise が入れた Node の実行ファイル。mise がなければ PATH の node */
function nodeBin(): string {
  const r = spawnSync('mise', ['which', 'node'], { cwd, encoding: 'utf8' });
  const p = r.status === 0 ? r.stdout.trim() : '';
  return p || 'node';
}

/** パッケージの CLI の入口（package.json の bin） */
function cliOf(pkg: string): string {
  const pj = join(cwd, 'node_modules', pkg, 'package.json');
  const { bin } = JSON.parse(readFileSync(pj, 'utf8')) as { bin: string | Record<string, string> };
  const rel = typeof bin === 'string' ? bin : (bin[pkg] ?? Object.values(bin)[0]);
  return join(dirname(pj), rel);
}

const [pkg, ...args] = process.argv.slice(2);
if (!pkg) {
  console.error('使い方: bun scripts/node.ts <パッケージ> [引数…]');
  process.exit(2);
}
const major = wantMajor(),
  node = nodeBin(),
  v = spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? '';
if (Number(v.replace(/^v/, '').split('.')[0]) !== major) {
  console.error(`Node v${major} が要ります（見つかったのは ${v || 'なし'}: ${node}）。mise install を実行してください`);
  process.exit(1);
}
const r = spawnSync(node, [cliOf(pkg), ...args], { cwd, stdio: 'inherit' });
process.exit(r.status ?? 1);

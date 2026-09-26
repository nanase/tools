/** redirects/cloudflare.csv を src/data/redirects.ts から作る。bun run redirects で実行する */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cloudflareCsv } from '../src/data/redirects';

const out = new URL('../redirects/cloudflare.csv', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
writeFileSync(out, cloudflareCsv());
console.log('wrote redirects/cloudflare.csv');

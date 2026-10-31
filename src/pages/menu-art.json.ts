/** メニューの図柄（カードの止まっているときの絵）。全ページの HTML に入れると重いので、メニューを初めて開くときに読む（lib/site.ts） */
import type { APIRoute } from 'astro';
import { TOOLS } from '../data/tools';
import { artAt } from '../lib/card-art';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(Object.fromEntries(TOOLS.map((t) => [t.ic, artAt(t.ic)]))), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

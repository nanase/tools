/** 日食の目録と要素（100 年ごと）。ビルドのときに NASA の CSV から作る */
import type { APIRoute, GetStaticPaths } from 'astro';
import { byCentury, centuries } from '../../../tools/solar-eclipse/source';

export const getStaticPaths = (() => centuries().map((c) => ({ params: { c: String(c) } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(byCentury(Number(params.c))), { headers: { 'content-type': 'application/json' } });

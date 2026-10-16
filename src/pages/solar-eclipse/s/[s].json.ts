/** 日食の目録と要素（サロス系列ごと）。ビルドのときに NASA の CSV から作る */
import type { APIRoute, GetStaticPaths } from 'astro';
import { bySaros, sarosList } from '../../../tools/solar-eclipse/source';

export const getStaticPaths = (() => sarosList().map((s) => ({ params: { s: String(s) } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(bySaros(Number(params.s))), { headers: { 'content-type': 'application/json' } });

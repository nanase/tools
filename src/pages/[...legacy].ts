/** 旧 URL（/tools/electric/timer555.html など）に転送ページを置く */
import type { APIRoute, GetStaticPaths } from 'astro';
import { REDIRECTS, type Redirect, redirectPage } from '../data/redirects';

export const getStaticPaths = (() =>
  REDIRECTS.map((r) => ({ params: { legacy: `${r.from}.html` }, props: r }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(redirectPage(props as Redirect), { headers: { 'content-type': 'text/html; charset=utf-8' } });

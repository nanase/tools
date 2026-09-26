/**
 * 旧 URL から新 URL への対応表。ここから次の 2 つを作る
 * - 旧パスに置く転送ページ（src/pages/[...legacy].ts、GitHub Pages 用の予備）
 * - Cloudflare Bulk Redirects 用の CSV（scripts/redirects-csv.ts → redirects/cloudflare.csv）
 * パスはどちらもサイトの base（/tools/）からの相対
 */
export const ORIGIN = 'https://nanase.cc';
export const BASE = '/tools/';

export type Redirect = {
  /** 旧パス（拡張子なし）。GitHub Pages では <from>.html と <from> の両方で届く */
  from: string;
  /** 新パス */
  to: string;
};

export const REDIRECTS: Redirect[] = [
  { from: 'electric/timer555', to: 'timer555/' },
  { from: 'control/pid', to: 'pid/' },
  { from: 'electric/combination', to: 'passive-combination/' },
  { from: 'filter/biquad', to: 'biquad/' },
  { from: 'jjy/simulator', to: 'jjy/' },
  { from: 'svg/theme-checker', to: 'svg-theme-checker/' },
];

/** 旧パスに置く転送ページ */
export function redirectPage({ to }: Redirect): string {
  const path = BASE + to;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>移転しました</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${ORIGIN}${path}">
<meta http-equiv="refresh" content="0; url=${path}">
</head>
<body>
<p><a href="${path}">${ORIGIN}${path}</a> へ移転しました。</p>
</body>
</html>
`;
}

/** Cloudflare Bulk Redirects の CSV（見出し行なし。スキームを省くと http と https の両方に効く） */
export function cloudflareCsv(): string {
  return REDIRECTS.flatMap(({ from, to }) =>
    [`${from}.html`, from].map(
      (src) => `${new URL(ORIGIN).host}${BASE}${src},${ORIGIN}${BASE}${to},301,TRUE,FALSE,FALSE,FALSE`,
    ),
  )
    .map((l) => `${l}\n`)
    .join('');
}

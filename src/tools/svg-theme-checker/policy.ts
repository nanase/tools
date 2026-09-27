/**
 * SVG の無害化の方針（DOM に依存しない部分）: 許可する要素・属性、CSS と参照の検査、取り除いたものの報告。
 * 木をたどって組み立て直すのは sanitize.ts
 */
export const SVGNS = 'http://www.w3.org/2000/svg';
export const XLNS = 'http://www.w3.org/1999/xlink';
export const XMLNS = 'http://www.w3.org/XML/1998/namespace';
export const NSNS = 'http://www.w3.org/2000/xmlns/';
export const XHTML = 'http://www.w3.org/1999/xhtml';

const FE =
  'Blend ColorMatrix ComponentTransfer Composite ConvolveMatrix DiffuseLighting DisplacementMap DistantLight DropShadow Flood FuncA FuncB FuncG FuncR GaussianBlur Image Merge MergeNode Morphology Offset PointLight SpecularLighting SpotLight Tile Turbulence'
    .split(' ')
    .map((s) => `fe${s}`);
export const SMIL = new Set(['animate', 'animateTransform', 'animateMotion', 'set']);
/** 描画に使う要素だけ。a は g に置き換える */
export const EL = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'style',
  'switch',
  'view',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'image',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'filter',
  'mpath',
  ...SMIL,
  ...FE,
]);
/** 実行・外部読み込みにつながる要素。取り除いたことを目立たせる */
export const DANGER = new Set([
  'script',
  'foreignObject',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'canvas',
  'handler',
  'listener',
]);
/** 属性（名前空間なし）。on* は含めない */
export const AT = new Set(
  (
    'id class style lang tabindex transform viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry fx fy fr width height ' +
    'd points pathLength dx dy rotate textLength lengthAdjust startOffset method spacing side path offset href ' +
    'gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits ' +
    'markerUnits markerWidth markerHeight refX refY orient filterUnits primitiveUnits in in2 result mode type values tableValues slope intercept ' +
    'amplitude exponent operator k1 k2 k3 k4 order kernelMatrix divisor bias targetX targetY edgeMode kernelUnitLength preserveAlpha surfaceScale ' +
    'diffuseConstant specularConstant specularExponent azimuth elevation z pointsAtX pointsAtY pointsAtZ limitingConeAngle scale xChannelSelector ' +
    'yChannelSelector stdDeviation radius baseFrequency numOctaves seed stitchTiles media version requiredExtensions systemLanguage ' +
    'attributeName attributeType begin dur end min max restart repeatCount repeatDur fill calcMode keyTimes keySplines from to by additive accumulate keyPoints ' +
    'alignment-baseline baseline-shift clip clip-path clip-rule color color-interpolation color-interpolation-filters direction display dominant-baseline ' +
    'fill-opacity fill-rule filter flood-color flood-opacity font font-family font-size font-size-adjust font-stretch font-style font-variant font-weight ' +
    'image-rendering isolation letter-spacing lighting-color marker marker-start marker-mid marker-end mask mask-type mix-blend-mode opacity overflow ' +
    'paint-order pointer-events shape-rendering stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin ' +
    'stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering transform-origin unicode-bidi vector-effect visibility ' +
    'word-spacing writing-mode'
  ).split(' '),
);

/** 取り除いたもの。d は危険なもの（スクリプト・外部参照）、o はそれ以外の許可リスト外 */
export interface Report {
  d: Map<string, number>;
  o: Map<string, number>;
}
export const newReport = (): Report => ({ d: new Map(), o: new Map() });
export const bump = (m: Map<string, number>, k: string): void => {
  m.set(k, (m.get(k) ?? 0) + 1);
};

/** URL の判定の前に、空白と制御文字（ブラウザが読み飛ばすもの）を除く */
export function squash(v: string): string {
  let s = '';
  for (const c of v) {
    const n = c.charCodeAt(0);
    if (n > 32 && n !== 127) s += c;
  }
  return s;
}

/**
 * CSS: エスケープとコメントを解いてから、外部を読むものを無効な名前に変える。
 * 問題がなければ元の文字列をそのまま返す
 */
export function cssScan(css: string): { css: string; iss: string[] } {
  const iss: string[] = [];
  let s = css
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])/g, (_m, h?: string, c?: string) => {
      if (!h) return c ?? '';
      const cp = Number.parseInt(h, 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
        ? String.fromCodePoint(cp)
        : String.fromCharCode(0xfffd);
    });
  s = s.replace(/@import\b/gi, () => {
    iss.push('@import');
    return '@blocked-import';
  });
  /* 空白を読み進める前に先読みする（後戻りで url( "#a") を外部参照と取り違えない） */
  s = s.replace(/(^|[^\w-])url\((?!\s*['"]?\s*#)\s*([^)]{0,24})/gi, (_m, p: string, u: string) => {
    iss.push(/^['"]?javascript:/i.test(squash(u)) ? 'javascript: URL' : '外部参照');
    return `${p}blocked-url(${u}`;
  });
  s = s.replace(
    /(^|[^\w-])((?:-webkit-)?image-set|cross-fade|element|src|expression)\s*\(/gi,
    (_m, p: string, f: string) => {
      iss.push('外部参照');
      return `${p}blocked-${f}(`;
    },
  );
  s = s.replace(/javascript\s*:|-moz-binding|behavior\s*:/gi, () => {
    iss.push('javascript: URL');
    return 'blocked';
  });
  return { css: iss.length ? s : css, iss };
}

/** href: 同じファイル内（#…）だけ。image・feImage には埋め込みのラスタ画像も許す。問題があれば理由を返す */
export function refIssue(v: string, ln: string): string {
  const t = squash(v);
  if (t.startsWith('#')) return '';
  if ((ln === 'image' || ln === 'feImage') && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]*$/i.test(t))
    return '';
  if (/^javascript:/i.test(t)) return 'javascript: URL';
  if (/^data:/i.test(t)) return 'data: URL';
  return '外部参照';
}

export interface AttrIn {
  ns: string | null;
  local: string;
  /** 接頭辞つきの名前（報告用） */
  name: string;
  value: string;
}

/**
 * 属性 1 つを検める。写すものは書き込む名前（xlink:href・xml:* は接頭辞つき）と値を返す。
 * 捨てるものは理由を rep に数えて null を返す（名前空間の宣言は数えずに捨てる）
 */
export function checkAttr(a: AttrIn, ln: string, rep: Report): { key: string; val: string } | null {
  const { ns, local: n, value: v } = a;
  if (ns === NSNS || (!ns && n === 'xmlns')) return null;
  if (/^on/i.test(n)) {
    bump(rep.d, `${n} 属性`);
    return null;
  }
  let key: string;
  if (ns === XLNS && n === 'href') key = 'xlink:href';
  else if (ns === XMLNS && (n === 'space' || n === 'lang')) key = `xml:${n}`;
  else if (!ns && AT.has(n)) key = n;
  else {
    bump(rep.o, `${a.name} 属性`);
    return null;
  }
  if (key === 'href' || key === 'xlink:href') {
    const k = refIssue(v, ln);
    if (k) {
      bump(rep.d, k);
      return null;
    }
    return { key, val: v };
  }
  if (/javascript:/i.test(squash(v))) {
    bump(rep.d, 'javascript: URL');
    return null;
  }
  const r = cssScan(v);
  for (const k of r.iss) bump(rep.d, k);
  /* style 属性だけは外部参照を無効にして残す。ほかの属性は丸ごと捨てる */
  if (r.iss.length && key !== 'style') return null;
  return { key, val: r.css };
}

/**
 * 要素 1 つを検める。写すなら true。捨てるなら理由を rep に数えて false（子も写さない）。
 * attributeName は SMIL の要素が書き換える属性の名前
 */
export function checkEl(
  ns: string | null,
  ln: string,
  nodeName: string,
  attributeName: string | null,
  rep: Report,
): boolean {
  if (ns !== SVGNS) {
    bump(ns === XHTML ? rep.d : rep.o, `<${nodeName}>`);
    return false;
  }
  if (DANGER.has(ln)) {
    bump(rep.d, `<${ln}>`);
    return false;
  }
  if (ln !== 'a' && !EL.has(ln)) {
    bump(rep.o, `<${ln}>`);
    return false;
  }
  /* href を書き換えるもの（接頭辞は問わない）とイベント属性を書き換えるもの */
  if (SMIL.has(ln) && /(?:^|:)href$|^on/i.test((attributeName ?? '').trim())) {
    bump(rep.d, `<${ln}> で href・イベントを書き換えるもの`);
    return false;
  }
  return true;
}

/** <style type="…"> は CSS 以外を捨てる */
export const cssType = (t: string | null): boolean => !t || /^\s*text\/css\s*$/i.test(t);

const listRep = (m: Map<string, number>): string[] => [...m].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));

/** 取り除いたものの一文。危険なものがあれば強調（'pv'）する */
export function reportText(rep: Report): { text: string; kind: '' | 'pv' } {
  const d = listRep(rep.d),
    o = listRep(rep.o);
  let s = d.length ? `取り除いたもの: ${d.join('、')}` : '';
  if (o.length)
    s += `${s ? '　' : ''}許可リスト外: ${o.slice(0, 4).join('、')}${o.length > 4 ? ` ほか ${o.length - 4} 種` : ''}`;
  return { text: s, kind: d.length ? 'pv' : '' };
}

/** DOMParser の parsererror の文から行・列・理由を取り出す（Chromium・Firefox の書式） */
export function parseErr(t: string): { line?: number; col?: number; msg: string } {
  let m = /line (\d+) at column (\d+):\s*([^\n]*)/i.exec(t);
  if (m) return { line: +(m[1] ?? 0), col: +(m[2] ?? 0), msg: (m[3] ?? '').trim() };
  m = /Line Number (\d+), Column (\d+)/i.exec(t);
  if (m)
    return {
      line: +(m[1] ?? 0),
      col: +(m[2] ?? 0),
      msg: (t.split('\n')[0] ?? '').replace(/^XML Parsing Error:\s*/i, ''),
    };
  return { msg: (t.split('\n')[0] ?? '').trim() };
}

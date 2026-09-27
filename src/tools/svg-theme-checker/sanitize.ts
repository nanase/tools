/**
 * SVG を許可リストで組み立て直す（ブラウザの DOM を使う）。方針は policy.ts。
 * 元の文書は DOMParser で読むだけで、描かない（スクリプトも読み込みも動かない）
 */
import {
  bump,
  checkAttr,
  checkEl,
  cssScan,
  cssType,
  NSNS,
  newReport,
  parseErr,
  type Report,
  SVGNS,
  XLNS,
  XMLNS,
} from './policy';
import { type Theme, themeCss, themeMq } from './view';

function copyAttrs(from: Element, to: Element, ln: string, rep: Report): void {
  for (const a of from.attributes) {
    const r = checkAttr({ ns: a.namespaceURI, local: a.localName, name: a.name, value: a.value }, ln, rep);
    if (!r) continue;
    if (r.key === 'xlink:href') to.setAttributeNS(XLNS, r.key, r.val);
    else if (r.key.startsWith('xml:')) to.setAttributeNS(XMLNS, r.key, r.val);
    else to.setAttribute(r.key, r.val);
  }
}
function cleanEl(n: Element, doc: XMLDocument, rep: Report, depth: number): Element | null {
  const ln = n.localName;
  if (depth > 400) {
    bump(rep.o, '深すぎる入れ子');
    return null;
  }
  if (!checkEl(n.namespaceURI, ln, n.nodeName, n.getAttribute('attributeName'), rep)) return null;
  const el = doc.createElementNS(SVGNS, ln === 'a' ? 'g' : ln);
  copyAttrs(n, el, ln, rep);
  if (ln === 'style') {
    const t = el.getAttribute('type');
    if (!cssType(t)) {
      bump(rep.o, `<style type="${t}">`);
      return null;
    }
    const r = cssScan(n.textContent ?? '');
    for (const k of r.iss) bump(rep.d, k);
    el.textContent = r.css;
    return el;
  }
  copyKids(n, el, rep, depth + 1);
  return el;
}
function copyKids(from: Node, to: Element, rep: Report, depth: number): void {
  const doc = to.ownerDocument as XMLDocument;
  for (const c of from.childNodes) {
    if (c.nodeType === Node.TEXT_NODE || c.nodeType === Node.CDATA_SECTION_NODE)
      to.appendChild(doc.createTextNode((c as CharacterData).data));
    else if (c.nodeType === Node.ELEMENT_NODE) {
      const el = cleanEl(c as Element, doc, rep, depth);
      if (el) to.appendChild(el);
    }
    /* コメント・処理命令（xml-stylesheet など）は写さない */
  }
}

export type Sanitized =
  | { doc: XMLDocument; rep: Report; err?: undefined }
  | { err: { line?: number; col?: number; msg: string }; doc?: undefined };

/** SVG のコードを読み、許可したものだけで新しい文書を作る。読めなければ err */
export function sanitize(text: string): Sanitized {
  const src = new DOMParser().parseFromString(text, 'image/svg+xml');
  const pe = [...src.getElementsByTagName('parsererror')].find((e) => e.namespaceURI !== SVGNS);
  if (pe) return { err: parseErr(pe.textContent ?? '') };
  const r = src.documentElement;
  if (!r || r.namespaceURI !== SVGNS || r.localName !== 'svg')
    return { err: { msg: 'いちばん外側の要素が SVG の <svg> ではありません' } };
  const rep = newReport();
  const doc = document.implementation.createDocument(SVGNS, 'svg', null);
  const root = doc.documentElement;
  root.setAttributeNS(NSNS, 'xmlns:xlink', XLNS);
  copyAttrs(r, root, 'svg', rep);
  copyKids(r, root, rep, 1);
  return { doc, rep };
}

/** th のテーマで描いたときと同じになるよう、prefers-color-scheme と color-scheme を固定した写しを作る */
export function themed(doc: XMLDocument, th: Theme): XMLDocument {
  const d = doc.cloneNode(true) as XMLDocument,
    r = d.documentElement;
  for (const st of r.getElementsByTagNameNS(SVGNS, 'style')) {
    st.textContent = themeCss(st.textContent ?? '', th);
    const m = st.getAttribute('media');
    if (m) st.setAttribute('media', themeMq(m, th));
  }
  const cs = d.createElementNS(SVGNS, 'style');
  cs.textContent = `:root{color-scheme:${th}}`;
  r.insertBefore(cs, r.firstChild);
  return d;
}

// @ts-check
/**
 * A minimal XML reader for the output of `apkanalyzer manifest print` and `apkanalyzer resources xml` (EVM-009 AC6): elements with
 * double-quoted attributes, self-closing tags, comments, the XML declaration. No entities beyond the five predefined ones, no CDATA,
 * no namespaces handling (attribute names stay as printed, e.g. `android:name`). Unbalanced or unreadable input throws.
 *
 * @typedef {{ name: string, attributes: Record<string, string>, children: XmlElement[] }} XmlElement
 */

const ENTITIES = /** @type {const} */ ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" });

/** @param {string} value */
const decode = (value) => value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (entity)]);

/** @param {string} source @returns {XmlElement} the root element */
export function parseXml(source) {
  const text = source
    .replace(/\r\n?/g, '\n')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<(\/)?([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/)?>/g;
  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {XmlElement | null} */
  let root = null;
  let position = 0;
  for (const match of text.matchAll(tag)) {
    if (text.slice(position, match.index).trim() !== '' && stack.length === 0) throw new Error('XML: text outside the root element');
    position = match.index + match[0].length;
    const [, closing, name = '', rawAttributes = '', selfClosing] = match;
    if (closing !== undefined) {
      const open = stack.pop();
      if (open?.name !== name) throw new Error(`XML: unbalanced closing tag ${name}`);
      continue;
    }
    /** @type {Record<string, string>} */
    const attributes = {};
    for (const attribute of rawAttributes.matchAll(/([\w.:-]+)\s*=\s*"([^"]*)"/g))
      attributes[attribute[1] ?? ''] = decode(attribute[2] ?? '');
    /** @type {XmlElement} */
    const element = { name, attributes, children: [] };
    const parent = stack.at(-1);
    if (parent === undefined) {
      if (root !== null) throw new Error('XML: more than one root element');
      root = element;
    } else {
      parent.children.push(element);
    }
    if (selfClosing === undefined) stack.push(element);
  }
  if (root === null || stack.length > 0) throw new Error('XML: no complete root element');
  return root;
}

/**
 * @param {XmlElement} element
 * @param {string} name
 * @returns {XmlElement[]}
 */
export const childrenNamed = (element, name) => element.children.filter((child) => child.name === name);

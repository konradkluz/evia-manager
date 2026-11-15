// @ts-check
/**
 * Converter of the Kover XML report (JaCoCo format) to lcov (EVM-109 AC5). Kover has no lcov output; `coverage:diff` reads lcov.
 * No XML dependency: the report has a fixed, flat structure (package → sourcefile → line), parsed token by token. Anything unexpected
 * is an error (fail closed): a report that cannot be read must never turn into an empty, green one. DOCTYPE and entity declarations are
 * refused (no XXE), only the five predefined entities are decoded.
 */

export class KoverReportError extends Error {}

const TOKEN = /<(\/?)(package|sourcefile|line)\b([^>]*?)(\/?)>/g;
const ATTRIBUTE = /([A-Za-z]+)="([^"]*)"/g;
const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
// eslint-disable-next-line no-control-regex -- control characters in a path make it untrustworthy
const UNSAFE_NAME = /[\u0000-\u001f\u007f\\]/;

/**
 * @param {string} xml
 * @param {string} sourceRoot repository path of the Kotlin source root (`SF:` = sourceRoot/package/file)
 * @returns {string} lcov text
 */
export function koverToLcov(xml, sourceRoot) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new KoverReportError('raport Kover zawiera DOCTYPE albo ENTITY — odrzucony (XXE)');
  if (!/<report\b/.test(xml)) throw new KoverReportError('to nie jest raport Kover XML (brak elementu <report>)');
  const root = sourceRoot.replace(/\/+$/, '');
  /** @type {Array<{ path: string, lines: Array<{ nr: number, hits: number, covered: number, missed: number }> }>} */
  const files = [];
  /** @type {string | null} */
  let pkg = null;
  /** @type {{ path: string, lines: Array<{ nr: number, hits: number, covered: number, missed: number }> } | null} */
  let source = null;
  for (const match of xml.matchAll(TOKEN)) {
    const [, closing, element, rawAttributes, selfClosing] = /** @type {[string, string, string, string, string]} */ (
      /** @type {unknown} */ (match)
    );
    const attributes = readAttributes(rawAttributes);
    if (element === 'package') {
      if (closing) {
        if (source) throw new KoverReportError('niezamknięty element <sourcefile> przed końcem pakietu');
        pkg = null;
      } else {
        if (pkg !== null || source) throw new KoverReportError('zagnieżdżony element <package>');
        pkg = safeName(attributes.get('name'), true);
      }
    } else if (element === 'sourcefile') {
      if (closing) {
        if (!source) throw new KoverReportError('zbędny </sourcefile>');
        if (source.lines.length === 0) throw new KoverReportError(`plik ${source.path} nie ma żadnej linii w raporcie`);
        files.push(source);
        source = null;
      } else {
        if (pkg === null || source || selfClosing) throw new KoverReportError('<sourcefile> poza pakietem albo zagnieżdżony');
        const name = safeName(attributes.get('name'), false);
        source = { path: [root, pkg, name].filter(Boolean).join('/'), lines: [] };
      }
    } else {
      if (!source || closing) throw new KoverReportError('<line> poza elementem <sourcefile>');
      const nr = number(attributes.get('nr'), 'nr');
      number(attributes.get('mi'), 'mi');
      source.lines.push({
        nr,
        hits: number(attributes.get('ci'), 'ci'),
        missed: number(attributes.get('mb'), 'mb'),
        covered: number(attributes.get('cb'), 'cb'),
      });
    }
  }
  if (source || pkg !== null) throw new KoverReportError('raport Kover jest ucięty (niezamknięty element)');
  if (files.length === 0) throw new KoverReportError('raport Kover nie zawiera żadnego pliku źródłowego');
  return files
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(render)
    .join('');
}

/** @param {{ path: string, lines: Array<{ nr: number, hits: number, covered: number, missed: number }> }} file */
function render(file) {
  const out = ['TN:', `SF:${file.path}`];
  let branchesFound = 0;
  let branchesHit = 0;
  let linesHit = 0;
  for (const line of file.lines) {
    out.push(`DA:${line.nr},${line.hits}`);
    if (line.hits > 0) linesHit += 1;
    for (let index = 0; index < line.covered + line.missed; index++) {
      const taken = index < line.covered ? 1 : 0;
      out.push(`BRDA:${line.nr},0,${index},${taken === 1 ? 1 : '-'}`);
      branchesFound += 1;
      branchesHit += taken;
    }
  }
  out.push(`LF:${file.lines.length}`, `LH:${linesHit}`, `BRF:${branchesFound}`, `BRH:${branchesHit}`, 'end_of_record', '');
  return out.join('\n');
}

/** @param {string} raw */
function readAttributes(raw) {
  /** @type {Map<string, string>} */
  const attributes = new Map();
  for (const match of raw.matchAll(ATTRIBUTE)) attributes.set(/** @type {string} */ (match[1]), decode(/** @type {string} */ (match[2])));
  return attributes;
}

/** @param {string} text */
function decode(text) {
  return text.replace(/&([A-Za-z]+);/g, (/** @type {string} */ whole, /** @type {string} */ name) => {
    const decoded = ENTITIES[name];
    if (decoded === undefined) throw new KoverReportError(`nieznana encja ${whole}`);
    return decoded;
  });
}

/**
 * @param {string | undefined} value
 * @param {string} name
 */
function number(value, name) {
  if (value === undefined || !/^[0-9]{1,9}$/.test(value)) throw new KoverReportError(`atrybut ${name} elementu <line> nie jest liczbą`);
  return Number(value);
}

/**
 * Package and file names become a path: no `..`, no backslash, no control characters, no empty segment (the package may be empty).
 * @param {string | undefined} name
 * @param {boolean} allowEmpty
 */
function safeName(name, allowEmpty) {
  if (name === undefined) throw new KoverReportError('element bez atrybutu name');
  const segments = name.split('/');
  const bad =
    name.startsWith('/') ||
    UNSAFE_NAME.test(name) ||
    segments.some((part) => part === '..' || part === '.' || (part === '' && name !== ''));
  if (bad || (name === '' && !allowEmpty))
    throw new KoverReportError(`niedozwolona nazwa w raporcie: ${JSON.stringify(name.slice(0, 80))}`);
  return name;
}

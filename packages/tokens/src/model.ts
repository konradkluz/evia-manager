/**
 * Token model and validation (EVM-006 AC6; design/tokens/README.md → "Walidacja w CI"):
 * valid JSON, every token has a $type (inherited from groups), aliases resolve, no cycles, no literals in semantic/,
 * semantic tokens alias base tokens only, alias types match, $deprecated is true, false or text.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Layer = 'base' | 'semantic';
const LAYERS: readonly Layer[] = ['base', 'semantic'];

export interface TokenFile {
  /** path relative to the token directory, with `/` (e.g. `semantic/size.tokens.json`) */
  readonly name: string;
  readonly layer: Layer;
  readonly data?: unknown;
  readonly error?: string;
}

export interface TokenInfo {
  readonly path: string;
  readonly type: string;
  readonly value: unknown;
  readonly deprecated: boolean;
  readonly layer: Layer;
  readonly file: string;
  readonly extensions: Readonly<Record<string, unknown>> | undefined;
}

type Node = Readonly<Record<string, unknown>>;

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && !Array.isArray(value);
const ALIAS = /^\{([^{}]+)\}$/;

/** Reads `base/**` and `semantic/**` `*.tokens.json` files (regular files only), sorted by name. */
export function loadTokenFiles(dir: string): TokenFile[] {
  const files: TokenFile[] = [];
  for (const layer of LAYERS) {
    for (const name of listFiles(join(dir, layer), layer)) {
      const text = readFileSync(join(dir, name), 'utf8');
      try {
        files.push({ name, layer, data: JSON.parse(text) as unknown });
      } catch (error) {
        files.push({ name, layer, error: `invalid JSON (${(error as Error).message})` });
      }
    }
  }
  return files.sort((a, b) => (a.name < b.name ? -1 : 1));
}

function listFiles(dir: string, prefix: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return listFiles(join(dir, entry.name), name);
    return entry.name.endsWith('.tokens.json') && lstatSync(join(dir, entry.name)).isFile() ? [name] : [];
  });
}

const deprecatedValid = (value: unknown): boolean => value === undefined || typeof value === 'boolean' || typeof value === 'string';
const deprecatedSet = (value: unknown): boolean => value === true || typeof value === 'string';

/** Builds the flat token map (path → token) and reports structural errors. */
export function collectTokens(files: readonly TokenFile[]): { tokens: Map<string, TokenInfo>; errors: string[] } {
  const tokens = new Map<string, TokenInfo>();
  const errors: string[] = [];
  const walk = (node: Node, segments: string[], file: TokenFile, inheritedType: string | undefined, inheritedDeprecated: boolean): void => {
    const path = segments.join('.');
    if (!deprecatedValid(node['$deprecated'])) errors.push(`${file.name}: ${path} — $deprecated must be true, false or text`);
    const type = typeof node['$type'] === 'string' ? node['$type'] : inheritedType;
    const deprecated = inheritedDeprecated || deprecatedSet(node['$deprecated']);
    if ('$value' in node) {
      const first = tokens.get(path);
      if (type === undefined) errors.push(`${file.name}: ${path} — missing $type (on the token or a parent group)`);
      else if (first) errors.push(`${file.name}: ${path} — defined again (first in ${first.file})`);
      else {
        const extensions = isNode(node['$extensions']) ? node['$extensions'] : undefined;
        tokens.set(path, { path, type, value: node['$value'], deprecated, layer: file.layer, file: file.name, extensions });
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!key.startsWith('$') && isNode(child)) walk(child, [...segments, key], file, type, deprecated);
    }
  };
  for (const file of files) {
    if (file.error !== undefined) errors.push(`${file.name}: ${file.error}`);
    else if (isNode(file.data)) walk(file.data, [], file, undefined, false);
    else errors.push(`${file.name}: the file must contain a JSON object`);
  }
  return { tokens, errors };
}

/** Expected types of the parts of composite values (W3C DTCG). */
const PARTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  typography: {
    fontFamily: 'fontFamily',
    fontSize: 'dimension',
    fontWeight: 'fontWeight',
    letterSpacing: 'dimension',
    lineHeight: 'number',
  },
  shadow: { color: 'color', offsetX: 'dimension', offsetY: 'dimension', blur: 'dimension', spread: 'dimension' },
  transition: { duration: 'duration', delay: 'duration', timingFunction: 'cubicBezier' },
};

interface Reference {
  readonly target: string;
  readonly expected: string | undefined;
  readonly part: string | undefined;
}

function references(token: TokenInfo): Reference[] {
  const alias = (value: unknown): string | undefined => (typeof value === 'string' ? ALIAS.exec(value)?.[1] : undefined);
  const whole = alias(token.value);
  if (whole !== undefined) return [{ target: whole, expected: token.type, part: undefined }];
  const parts = PARTS[token.type];
  const layers = Array.isArray(token.value) ? (token.value as unknown[]) : [token.value];
  const found: Reference[] = [];
  for (const layer of layers) {
    if (!isNode(layer)) continue;
    for (const [part, value] of Object.entries(layer)) {
      const target = alias(value);
      if (target !== undefined) found.push({ target, expected: parts?.[part], part });
    }
  }
  return found;
}

/** A value is literal-free when every leaf is an alias string (semantic/ rule 1). */
function onlyAliases(value: unknown): boolean {
  if (typeof value === 'string') return ALIAS.test(value);
  if (Array.isArray(value)) return value.every(onlyAliases);
  if (isNode(value)) return Object.values(value).every(onlyAliases);
  return false;
}

/** Validates aliases, layers, types and cycles; returns error messages in a stable order. */
export function validateTokens(tokens: ReadonlyMap<string, TokenInfo>): string[] {
  const errors: string[] = [];
  const graph = new Map<string, string[]>();
  for (const token of tokens.values()) {
    const where = `${token.file}: ${token.path}`;
    if (token.layer === 'semantic' && !onlyAliases(token.value))
      errors.push(`${where} — literal value in semantic/ (use an alias to a base token)`);
    const edges: string[] = [];
    for (const { target, expected, part } of references(token)) {
      const referenced = tokens.get(target);
      const suffix = part === undefined ? '' : ` (${part})`;
      if (!referenced) errors.push(`${where} — alias {${target}} does not resolve`);
      else {
        edges.push(target);
        if (token.layer === 'semantic' && referenced.layer === 'semantic') {
          errors.push(`${where} — alias {${target}} points to a semantic token (only base/ allowed)`);
        } else if (expected !== undefined && referenced.type !== expected) {
          errors.push(`${where} — alias {${target}} has type ${referenced.type}, expected ${expected}${suffix}`);
        }
      }
    }
    graph.set(token.path, edges);
  }
  return [...errors, ...cycles(graph, tokens)];
}

function cycles(graph: ReadonlyMap<string, readonly string[]>, tokens: ReadonlyMap<string, TokenInfo>): string[] {
  const errors: string[] = [];
  const done = new Set<string>();
  const visit = (node: string, stack: string[]): void => {
    if (done.has(node)) return;
    const at = stack.indexOf(node);
    if (at >= 0) {
      const loop = [...stack.slice(at), node];
      const start = loop[0] ?? node;
      errors.push(`${tokens.get(start)?.file ?? ''}: ${start} — alias cycle ${loop.join(' → ')}`);
      for (const member of loop) done.add(member);
      return;
    }
    for (const next of graph.get(node) ?? []) visit(next, [...stack, node]);
    done.add(node);
  };
  for (const node of graph.keys()) visit(node, []);
  return errors;
}

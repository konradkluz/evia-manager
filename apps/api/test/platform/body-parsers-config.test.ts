/**
 * EVM-119 AC3 (RR-39): no body parser of the API decodes a compressed request. The source of `src/` is scanned, so a
 * parser added later (another `express.json`, `urlencoded`, `text`, `raw`, a per-route parser, a stream decoder) is caught.
 * An exception needs a justification in a comment and an ADR/story - it is not a silent allow-list.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
  );

const files = sources(SRC).map((path) => ({ name: relative(SRC, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));

/** The text of the argument list that starts at the `(` after `index`, balanced. */
const callArguments = (text: string, open: number): string => {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '(') depth += 1;
    if (text[at] === ')' && --depth === 0) return text.slice(open, at + 1);
  }
  return text.slice(open);
};

const PARSER_CALL = /\b(?:express|bodyParser)\s*\.\s*(json|urlencoded|text|raw)\s*(?=\()|\b(json|urlencoded|text|raw)\s*(?=\()/g;

describe('body parsers do not decode compressed requests (EVM-119 AC3; RR-39)', () => {
  it('EVM-119 AC3 every express body parser in src is created with inflate: false', () => {
    const found: string[] = [];
    for (const { name, text } of files) {
      if (!/from\s+['"]express['"]|body-parser/.test(text)) continue;
      for (const match of text.matchAll(PARSER_CALL)) {
        const method = match[1] ?? match[2];
        const isExpress = match[1] !== undefined;
        if (!isExpress && !new RegExp(`import[^;]*\\b${method}\\b[^;]*from\\s+['"](?:express|body-parser)['"]`).test(text)) continue;
        found.push(name);
        const args = callArguments(text, match.index + match[0].length);
        expect(args, `${name}: ${method}() must set inflate: false`).toMatch(/\binflate\s*:\s*false\b/);
      }
    }
    expect(found, 'the JSON body parser of the API is found').toContain('platform/http/json-body.ts');
  });

  it('EVM-119 AC3 Nest does not install its default body parsers (they would inflate)', () => {
    const creations = files.filter(({ text }) => /NestFactory\.create\b(?!ApplicationContext)/.test(text));
    expect(creations.map(({ name }) => name)).toContain('app.ts');
    for (const { name, text } of creations) {
      const start = text.search(/NestFactory\.create\b(?!ApplicationContext)/);
      expect(callArguments(text, text.indexOf('(', start)), name).toMatch(/bodyParser\s*:\s*false/);
    }
    for (const { name, text } of files) {
      expect(text, name).not.toMatch(/\.useBodyParser\(|bodyParser\s*:\s*true/);
    }
  });

  it('EVM-119 AC3 there is no other way to read a request body: no parser packages, per-route parsers or stream decoders', () => {
    const forbidden =
      /body-parser|raw-body|multer|busboy|formidable|fastify|addContentTypeParser|createGunzip|createInflate|createInflateRaw|createUnzip|createBrotliDecompress|createZstdDecompress|inflate\s*:\s*true/;
    for (const { name, text } of files) expect(text, name).not.toMatch(forbidden);
  });
});

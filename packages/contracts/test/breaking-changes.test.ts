import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, BUNDLE, canonicalJson, findBreakingChanges, runBaselineCommand, type BaselineIo } from '../src/breaking-changes.ts';

type Dict = Record<string, unknown>;

const json = (schema: unknown) => ({ content: { 'application/json': { schema } } });
/** A one-operation document: a request body schema and the schema of the 200 response. */
function spec(parts: { request?: unknown; response?: unknown; operation?: Dict; extra?: Dict; components?: Dict; root?: Dict }): Dict {
  return {
    openapi: '3.1.0',
    ...parts.root,
    paths: {
      '/x': {
        post: {
          operationId: 'postX',
          ...(parts.request === undefined ? {} : { requestBody: { required: true, ...json(parts.request) } }),
          responses: { '200': { description: 'OK', ...(parts.response === undefined ? {} : json(parts.response)) } },
          ...parts.operation,
        },
        ...parts.extra,
      },
    },
    components: { schemas: {}, ...parts.components },
  };
}

const rules = (before: Dict, after: Dict): string[] => findBreakingChanges(before, after).map((change) => change.rule);
const request = (before: unknown, after: unknown): string[] => rules(spec({ request: before }), spec({ request: after }));
const response = (before: unknown, after: unknown): string[] => rules(spec({ response: before }), spec({ response: after }));

describe('breaking-change detection (EVM-090 AC7)', () => {
  it('EVM-090 AC7 an identical contract and purely additive changes are not breaking', () => {
    const before = spec({
      request: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
      response: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
    });
    expect(rules(before, before)).toEqual([]);
    const after = spec({
      request: { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } } },
      response: { type: 'object', required: ['a', 'c'], properties: { a: { type: 'string' }, c: { type: 'integer' } } },
      extra: { get: { operationId: 'getX', responses: { '200': { description: 'OK' } } } },
      operation: { description: 'changed prose is not a contract change' },
    });
    expect(rules(before, after)).toEqual([]);
  });

  it('EVM-090 AC7 a removed operation, method or path, a changed operationId and a removed success response are breaking', () => {
    const before = spec({
      extra: { get: { operationId: 'getX', responses: { '200': { description: 'OK' }, '404': { description: 'no' } } } },
    });
    const withoutGet = spec({});
    expect(rules(before, withoutGet)).toEqual(['operation-removed']);
    expect(rules(before, { ...withoutGet, paths: {} })).toEqual(['operation-removed', 'operation-removed']);
    const renamed = spec({ extra: { get: { operationId: 'readX', responses: { '200': { description: 'OK' } } } } });
    expect(rules(before, renamed)).toEqual(['operation-id-changed']);
    const noSuccess = spec({ extra: { get: { operationId: 'getX', responses: { '404': { description: 'no' } } } } });
    expect(rules(before, noSuccess)).toEqual(['response-success-removed']);
  });

  it('EVM-090 AC7 a change of security or x-evia-authz, at the operation or the document level, is breaking', () => {
    const before = spec({ operation: { 'x-evia-authz': { roles: ['editor'] }, security: [{ a: [] }] }, root: { security: [] } });
    const after = spec({
      operation: { 'x-evia-authz': { roles: ['administrator'] }, security: [{ b: [] }] },
      root: { security: [{ a: [] }] },
    });
    expect(rules(before, after).sort()).toEqual(['authz-changed', 'security-changed', 'security-changed']);
    const schemes = (value: unknown) => spec({ components: { securitySchemes: { a: value } } });
    expect(rules(schemes({ type: 'http' }), schemes({ type: 'apiKey' }))).toEqual(['security-scheme-changed']);
    expect(rules(schemes({ type: 'http' }), spec({}))).toEqual(['security-scheme-changed']);
    expect(rules(schemes({ type: 'http' }), schemes({ type: 'http' }))).toEqual([]);
  });

  it('EVM-090 AC7 request parameters: removed, newly required and tightened are breaking, a new optional one is not', () => {
    const parameter = (name: string, extra: Dict = {}, where = 'query') => ({ name, in: where, schema: { type: 'string' }, ...extra });
    const operation = (parameters: unknown[]) => spec({ operation: { parameters } });
    expect(rules(operation([parameter('a')]), operation([]))).toEqual(['request-parameter-removed']);
    expect(rules(operation([parameter('a')]), operation([parameter('a', { required: true })]))).toEqual([
      'request-parameter-became-required',
    ]);
    expect(rules(operation([]), operation([parameter('a', { required: true })]))).toEqual(['request-parameter-added-required']);
    expect(rules(operation([]), operation([parameter('a')]))).toEqual([]);
    expect(rules(operation([parameter('a', { required: true })]), operation([parameter('a', { required: true })]))).toEqual([]);
    expect(rules(operation([parameter('a')]), operation([parameter('a', { schema: { type: 'string', maxLength: 3 } })]))).toEqual([
      'request-limit-tightened',
    ]);
    // header names are case-insensitive; a parameter is also taken from the path item and by reference
    expect(rules(operation([parameter('X-A', {}, 'header')]), operation([parameter('x-a', {}, 'header')]))).toEqual([]);
    const referenced = (extra: Dict) => ({
      ...spec({ extra: { parameters: [{ $ref: '#/components/parameters/P' }] }, components: { parameters: { P: parameter('p', extra) } } }),
    });
    expect(rules(referenced({}), referenced({ required: true }))).toEqual(['request-parameter-became-required']);
  });

  it('EVM-090 AC7 a request body: newly required and a required flag turned on are breaking', () => {
    expect(rules(spec({}), spec({ request: { type: 'object' } }))).toEqual(['request-body-added-required']);
    const optional = { ...spec({ request: { type: 'object' } }) };
    const optionalOperation = (optional['paths'] as Dict)['/x'] as Dict;
    (optionalOperation['post'] as Dict)['requestBody'] = { required: false, ...json({ type: 'object' }) };
    expect(rules(optional, spec({ request: { type: 'object' } }))).toEqual(['request-body-became-required']);
    expect(rules(spec({ request: { type: 'object' } }), spec({}))).toEqual([]);
    const lenient = spec({});
    ((lenient['paths'] as Dict)['/x'] as Dict)['post'] = {
      operationId: 'postX',
      requestBody: { ...json({ type: 'object' }) },
      responses: { '200': { description: 'OK' } },
    };
    expect(rules(spec({}), lenient)).toEqual([]);
  });

  it('EVM-090 AC7 response enums: ADDING a value to a plain enum is breaking, x-extensible-enum is free, removing one from it is breaking', () => {
    expect(response({ type: 'string', enum: ['a'] }, { type: 'string', enum: ['a', 'b'] })).toEqual(['response-property-enum-value-added']);
    expect(response({ type: 'string', enum: ['a', 'b'] }, { type: 'string', enum: ['a'] })).toEqual([]);
    expect(response({ type: 'string', enum: ['a'] }, { type: 'string' })).toEqual(['response-enum-removed']);
    expect(response({ type: 'string' }, { type: 'string', enum: ['a'] })).toEqual([]);
    expect(response({ type: 'string', 'x-extensible-enum': ['a'] }, { type: 'string', 'x-extensible-enum': ['a', 'b'] })).toEqual([]);
    expect(response({ type: 'string', 'x-extensible-enum': ['a', 'b'] }, { type: 'string', 'x-extensible-enum': ['a'] })).toEqual([
      'extensible-enum-value-removed',
    ]);
  });

  it('EVM-090 AC7 request enums: removing or narrowing is breaking, adding a value is free', () => {
    expect(request({ type: 'string', enum: ['a', 'b'] }, { type: 'string', enum: ['a'] })).toEqual(['request-enum-value-removed']);
    expect(request({ type: 'string' }, { type: 'string', enum: ['a'] })).toEqual(['request-enum-added']);
    expect(request({ type: 'string', enum: ['a'] }, { type: 'string', enum: ['a', 'b'] })).toEqual([]);
    expect(request({ type: 'string', enum: ['a'] }, { type: 'string' })).toEqual([]);
  });

  it('EVM-090 AC7 request limits: maxLength/maxItems/maximum down, minimum up and a new pattern are breaking, loosening is not', () => {
    expect(request({ type: 'string', maxLength: 10 }, { type: 'string', maxLength: 5 })).toEqual(['request-limit-tightened']);
    expect(request({ type: 'string' }, { type: 'string', maxLength: 5 })).toEqual(['request-limit-tightened']);
    expect(request({ type: 'array', maxItems: 5, items: {} }, { type: 'array', maxItems: 4, items: {} })).toEqual([
      'request-limit-tightened',
    ]);
    expect(request({ type: 'number', maximum: 5 }, { type: 'number', maximum: 4 })).toEqual(['request-limit-tightened']);
    expect(request({ type: 'number', minimum: 1 }, { type: 'number', minimum: 2 })).toEqual(['request-limit-tightened']);
    expect(request({ type: 'number' }, { type: 'number', minimum: 2 })).toEqual(['request-limit-tightened']);
    expect(request({ type: 'string', pattern: '^a$' }, { type: 'string', pattern: '^b$' })).toEqual(['request-pattern-added']);
    expect(request({ type: 'string' }, { type: 'string', pattern: '^b$' })).toEqual(['request-pattern-added']);
    expect(request({ type: 'string', pattern: '^a$' }, { type: 'string', pattern: '^a$' })).toEqual([]);
    expect(request({ type: 'string', maxLength: 5, minLength: 2 }, { type: 'string', maxLength: 9, minLength: 1 })).toEqual([]);
    expect(response({ type: 'string', maxLength: 10 }, { type: 'string', maxLength: 5 })).toEqual([]);
  });

  it('EVM-090 AC7 request objects: a removed property of a closed object, a newly required property and an opened object are breaking', () => {
    const closed = { type: 'object', additionalProperties: false, properties: { a: { type: 'string' }, b: { type: 'string' } } };
    expect(request(closed, { ...closed, properties: { a: { type: 'string' } } })).toEqual(['request-property-removed']);
    const open = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } };
    expect(request(open, { ...open, properties: { a: { type: 'string' } } })).toEqual([]);
    expect(request(open, { ...open, required: ['a'] })).toEqual(['request-property-became-required']);
    expect(request({ ...open, required: ['a'] }, { ...open, required: ['a'] })).toEqual([]);
    expect(request(closed, open)).toEqual(['additional-properties-opened']);
    expect(response(closed, open)).toEqual(['additional-properties-opened']);
  });

  it('EVM-090 AC7 response objects: a removed property, required → optional, a changed type and a removed header or media type are breaking', () => {
    const object = { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } } };
    expect(response(object, { ...object, properties: { a: { type: 'string' } } })).toEqual(['response-property-removed']);
    expect(response(object, { ...object, required: [] })).toEqual(['response-property-became-optional']);
    expect(response(object, { ...object, properties: { a: { type: 'integer' }, b: { type: 'string' } } })).toEqual(['type-changed']);
    expect(response({ type: ['string', 'null'] }, { type: 'string' })).toEqual(['type-changed']);
    expect(response({ type: 'string', format: 'uuid' }, { type: 'string' })).toEqual(['response-format-changed']);
    expect(response({ type: 'string' }, { type: 'string', format: 'uuid' })).toEqual([]);
    expect(request({ type: 'string' }, { type: 'string', format: 'uuid' })).toEqual(['request-format-changed']);
    expect(request({ type: 'string', format: 'uuid' }, { type: 'string', format: 'uuid' })).toEqual([]);
    expect(response({ const: 'a' }, { const: 'b' })).toEqual(['const-changed']);

    const withHeader = spec({ response: object });
    const headerOperation = ((withHeader['paths'] as Dict)['/x'] as Dict)['post'] as Dict;
    ((headerOperation['responses'] as Dict)['200'] as Dict)['headers'] = { 'Retry-After': { schema: { type: 'integer' } } };
    expect(rules(withHeader, spec({ response: object }))).toEqual(['response-header-removed']);
    expect(rules(spec({ response: object }), withHeader)).toEqual([]);
    const otherType = spec({});
    (((otherType['paths'] as Dict)['/x'] as Dict)['post'] as Dict)['responses'] = {
      '200': { description: 'OK', content: { 'text/plain': {} } },
    };
    expect(rules(spec({ response: object }), otherType)).toEqual(['response-media-type-removed']);
  });

  it('EVM-090 AC7 items and additionalProperties schemas are compared recursively', () => {
    expect(response({ type: 'array', items: { type: 'string' } }, { type: 'array', items: { type: 'integer' } })).toEqual(['type-changed']);
    expect(request({ type: 'array', items: { type: 'string' } }, { type: 'array', items: { type: 'string', maxLength: 3 } })).toEqual([
      'request-limit-tightened',
    ]);
    const map = (value: unknown) => ({ type: 'object', additionalProperties: value });
    expect(response(map({ type: 'string' }), map({ type: 'integer' }))).toEqual(['type-changed']);
    expect(response(map(true), map({ type: 'integer' }))).toEqual([]);
  });

  it('EVM-090 AC7 references are resolved: a change behind a $ref is found, a cycle terminates', () => {
    const components = (a: unknown) => ({
      schemas: { A: a, Tree: { type: 'object', properties: { child: { $ref: '#/components/schemas/Tree' } } } },
    });
    const ref = { $ref: '#/components/schemas/A' };
    const before = spec({ response: ref, components: components({ type: 'string' }) });
    const after = spec({ response: ref, components: components({ type: 'integer' }) });
    expect(rules(before, after)).toEqual(['type-changed']);
    const tree = { $ref: '#/components/schemas/Tree' };
    expect(rules(spec({ response: tree, components: components({}) }), spec({ response: tree, components: components({}) }))).toEqual([]);
    const treeAfter = components({});
    ((treeAfter.schemas['Tree'] as Dict)['properties'] as Dict)['extra'] = { type: 'string' };
    expect(rules(spec({ response: tree, components: components({}) }), spec({ response: tree, components: treeAfter }))).toEqual([]);
    const missing = spec({ response: { $ref: '#/components/schemas/Missing' } });
    expect(() => rules(missing, missing)).toThrow(/unresolved reference/);
    const loop = { A: { $ref: '#/A' } };
    const looping = spec({ response: { $ref: '#/A' }, root: loop });
    expect(() => rules(looping, looping)).toThrow(/too long/);
  });

  it('EVM-090 AC7 nullable pairs are unwrapped; nullability that hurts the client is breaking', () => {
    const pair = (schema: unknown) => ({ oneOf: [schema, { type: 'null' }], description: 'prose' });
    expect(response(pair({ type: 'string' }), pair({ type: 'string', description: 'x' }))).toEqual([]);
    expect(response(pair({ type: 'string' }), pair({ type: 'integer' }))).toEqual(['type-changed']);
    expect(response({ type: 'string' }, pair({ type: 'string' }))).toEqual(['response-became-nullable']);
    expect(response(pair({ type: 'string' }), { type: 'string' })).toEqual([]);
    expect(request(pair({ type: 'string' }), { type: 'string' })).toEqual(['request-no-longer-nullable']);
    expect(request({ type: 'string' }, pair({ type: 'string' }))).toEqual([]);
    expect(response({ oneOf: [{ type: 'null' }, { type: 'string' }] }, { oneOf: [{ type: 'string' }, { type: 'null' }] })).toEqual([]);
  });

  it('EVM-090 AC7 oneOf/anyOf/allOf/discriminator that changed in any way is breaking (fail-closed); annotations are ignored', () => {
    const union = (extra: Dict = {}, second: Dict = { type: 'integer' }) => ({
      oneOf: [{ type: 'string' }, second],
      discriminator: { propertyName: 'kind' },
      ...extra,
    });
    expect(response(union(), union())).toEqual([]);
    expect(response(union(), union({ description: 'only prose' }))).toEqual([]);
    expect(response(union(), union({}, { type: 'boolean' }))).toEqual(['composition-changed']);
    expect(request(union(), { type: 'string' })).toEqual(['composition-changed']);
    expect(response({ allOf: [{ type: 'string' }] }, { allOf: [{ type: 'string' }, { maxLength: 3 }] })).toEqual(['composition-changed']);
    expect(
      response({ oneOf: [{ type: 'string' }, { type: 'null' }, { type: 'integer' }] }, { oneOf: [{ type: 'string' }, { type: 'null' }] }),
    ).toEqual(['composition-changed']);
    const ref = { oneOf: [{ $ref: '#/components/schemas/A' }, { type: 'integer' }] };
    const cyclic = (extra: Dict) => ({
      schemas: { A: { type: 'object', properties: { next: { $ref: '#/components/schemas/A' }, ...extra } } },
    });
    expect(rules(spec({ response: ref, components: cyclic({}) }), spec({ response: ref, components: cyclic({}) }))).toEqual([]);
    expect(
      rules(spec({ response: ref, components: cyclic({}) }), spec({ response: ref, components: cyclic({ more: { type: 'string' } }) })),
    ).toEqual(['composition-changed']);
  });
});

describe('baseline commands (EVM-090 AC7)', () => {
  const baseline = spec({ response: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } });
  const additive = spec({
    response: { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string' } } },
  });
  const breaking = spec({ response: { type: 'object', required: [], properties: { a: { type: 'string' } } } });

  function io(bundle: unknown, stored: unknown) {
    const lines: string[] = [];
    let written: string | undefined;
    const adapter: BaselineIo = {
      readBundle: () => bundle,
      readBaseline: () => stored,
      writeBaseline: (text) => {
        written = text;
      },
      print: (line) => lines.push(line),
    };
    return { adapter, lines, written: () => written };
  }

  it('EVM-090 AC7 canonical JSON has sorted keys, two spaces, LF and one trailing newline', () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }], a: null })).toBe(
      '{\n  "a": null,\n  "b": [\n    {\n      "a": 2,\n      "z": 1\n    }\n  ]\n}\n',
    );
  });

  it('EVM-090 AC7 check passes only when the bundle equals the baseline; additive changes make the baseline stale, breaking ones fail', () => {
    const same = io(baseline, baseline);
    expect(runBaselineCommand(['check'], same.adapter)).toBe(0);
    const stale = io(additive, baseline);
    expect(runBaselineCommand(['check'], stale.adapter)).toBe(1);
    expect(stale.lines.join('\n')).toContain('stale');
    const broken = io(breaking, baseline);
    expect(runBaselineCommand(['check'], broken.adapter)).toBe(1);
    expect(broken.lines[0]).toContain('BREAKING response-property-became-optional');
  });

  it('EVM-090 AC7 update writes the canonical bundle when nothing breaks, and refuses a breaking diff without --allow-breaking ADR-####', () => {
    const fine = io(additive, baseline);
    expect(runBaselineCommand(['update'], fine.adapter)).toBe(0);
    expect(fine.written()).toBe(canonicalJson(additive));
    const refused = io(breaking, baseline);
    expect(runBaselineCommand(['update'], refused.adapter)).toBe(1);
    expect(refused.written()).toBeUndefined();
    expect(refused.lines.join('\n')).toContain('Refused');
    const allowed = io(breaking, baseline);
    expect(runBaselineCommand(['update', '--allow-breaking', 'ADR-0021'], allowed.adapter)).toBe(0);
    expect(allowed.written()).toBe(canonicalJson(breaking));
    expect(allowed.lines.at(-1)).toContain('ADR-0021');
    for (const args of [
      ['update', '--allow-breaking'],
      ['update', '--allow-breaking', 'because'],
    ]) {
      const wrong = io(breaking, baseline);
      expect(runBaselineCommand(args, wrong.adapter)).toBe(2);
      expect(wrong.written()).toBeUndefined();
    }
  });

  it('EVM-090 AC7 an unknown command prints the usage', () => {
    const unknown = io(baseline, baseline);
    expect(runBaselineCommand(['oops'], unknown.adapter)).toBe(2);
    expect(unknown.lines.at(-1)).toContain('Usage');
  });

  it('EVM-090 AC7 the committed baseline is the accepted contract: no breaking change against it, and it is up to date with the bundle', () => {
    const stored: unknown = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const bundle: unknown = JSON.parse(readFileSync(BUNDLE, 'utf8'));
    expect(findBreakingChanges(stored, bundle)).toEqual([]);
    expect(readFileSync(BASELINE, 'utf8')).toBe(canonicalJson(bundle));
  });
});

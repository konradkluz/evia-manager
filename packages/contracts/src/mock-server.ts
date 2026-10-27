/**
 * Mock server of the contract (EVM-090 AC7): answers every operation of the bundled specification (dist/openapi.json) with the examples
 * of the contract, so that the mobile app (the `AuthClient` port of EVM-100, the integration of EVM-107) can be developed and tested before
 * the routes exist. It is a development and test tool: it is NOT exported from the main entry point of the package, only through the
 * subpath `@evia/contracts/mock-server`, so it cannot reach the bundle of an application by accident.
 *
 * - listens on 127.0.0.1 only, on an ephemeral port (nothing outside the machine can reach it);
 * - the status comes from `Prefer: code=<status>` (RFC 7240 style; default: the lowest 2xx of the operation);
 * - an unknown path or method answers 404 problem+json; a status the operation does not define answers 500 with a readable message;
 * - never echoes the request (no body, no query, no header value except the validated status code).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const asRecord = (value: unknown): Json => (isRecord(value) ? value : {});
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

export interface MockResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

function problem(status: number, code: string, title: string, detail?: string): MockResponse {
  const body = { type: `/problems/${code}`, title, status, code, traceId: TRACE_ID, ...(detail === undefined ? {} : { detail }) };
  return { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
}

/** The reference `#/components/...` of the bundle resolved. */
function resolve(spec: Json, node: unknown): Json {
  if (isRecord(node) && typeof node['$ref'] === 'string') {
    const target = node['$ref']
      .replace(/^#\//, '')
      .split('/')
      .reduce<unknown>((current, key) => asRecord(current)[key], spec);
    return resolve(spec, target);
  }
  return asRecord(node);
}

/** `Prefer: return=minimal, code=429` → 429; `undefined` when there is no `code` token; `NaN` for a malformed one. */
export function requestedStatus(prefer: string | undefined): number | undefined {
  for (const token of (prefer ?? '').split(/[,;]/)) {
    const match = /^\s*code\s*=(.*)$/i.exec(token);
    if (match !== null) {
      const value = (match[1] ?? '').trim().replace(/^"(.*)"$/, '$1');
      return /^[1-5]\d\d$/.test(value) ? Number(value) : Number.NaN;
    }
  }
  return undefined;
}

function findOperation(spec: Json, method: string, path: string): { id: string; operation: Json } | undefined {
  const paths = asRecord(spec['paths']);
  const candidates = Object.keys(paths)
    .map((template) => ({ template, parameters: (template.match(/{[^}]+}/g) ?? []).length }))
    .sort((a, b) => a.parameters - b.parameters);
  for (const { template } of candidates) {
    const pattern = new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/{[^}]+}/g, '[^/]+')}$`);
    const operation = asRecord(asRecord(paths[template])[method]);
    if (pattern.test(path) && METHODS.includes(method) && typeof operation['operationId'] === 'string') {
      return { id: operation['operationId'], operation };
    }
  }
  return undefined;
}

function headerValue(header: Json): string | undefined {
  const schema = asRecord(header['schema']);
  const enumerated: unknown = Array.isArray(schema['enum']) ? (schema['enum'] as unknown[])[0] : undefined;
  const value: unknown = header['example'] ?? enumerated ?? schema['default'] ?? schema['minimum'];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

/** The answer of the mock for a request: pure, so it is testable without a socket. */
export function mockResponse(spec: unknown, method: string, path: string, prefer?: string): MockResponse {
  const document = asRecord(spec);
  const found = findOperation(document, method.toLowerCase(), path);
  if (found === undefined) return problem(404, 'not_found', 'Not found');
  const responses = asRecord(found.operation['responses']);
  const defined = Object.keys(responses).sort();
  const requested = requestedStatus(prefer);
  let status = String(requested);
  if (requested === undefined) {
    const success = defined.find((code) => /^2\d\d$/.test(code));
    if (success === undefined) return problem(500, 'mock_no_success_response', 'The operation defines no success response', found.id);
    status = success;
  } else if (Number.isNaN(requested)) {
    return problem(500, 'mock_unknown_prefer', 'Unrecognised Prefer: code', 'Use "Prefer: code=<HTTP status>".');
  }
  if (!defined.includes(status)) {
    return problem(
      500,
      'mock_unknown_prefer',
      `Operation ${found.id} has no ${status} response`,
      `Defined responses: ${defined.join(', ')}.`,
    );
  }
  const response = resolve(document, responses[status]);
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(asRecord(response['headers']))) {
    const value = headerValue(resolve(document, header));
    if (value !== undefined) headers[name.toLowerCase()] = value;
  }
  const content = asRecord(response['content']);
  const type = ['application/json', 'application/problem+json'].find((name) => name in content) ?? Object.keys(content)[0];
  if (type === undefined) return { status: Number(status), headers };
  const media = asRecord(content[type]);
  const first = Object.values(asRecord(media['examples']))[0];
  const example = media['example'] ?? asRecord(first)['value'];
  if (example === undefined) return problem(500, 'mock_no_example', `Operation ${found.id} has no example for ${status}`);
  return { status: Number(status), headers: { ...headers, 'content-type': type }, body: JSON.stringify(example) };
}

export interface MockServer {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  readonly close: () => Promise<void>;
}

function handle(spec: unknown, request: IncomingMessage, response: ServerResponse): void {
  request.resume();
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const prefer = request.headers['prefer'];
  const answer = mockResponse(spec, request.method ?? 'GET', path, Array.isArray(prefer) ? prefer.join(',') : prefer);
  response.writeHead(answer.status, answer.headers);
  response.end(answer.body);
}

/** Starts the mock on 127.0.0.1 and an ephemeral port. */
export async function startMockServer(spec: unknown): Promise<MockServer> {
  const server: Server = createServer((request, response) => {
    handle(spec, request, response);
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the mock server has no TCP address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => {
          if (error === undefined) done();
          else fail(error);
        });
        server.closeAllConnections();
      }),
  };
}

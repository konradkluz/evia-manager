// @ts-check
/**
 * Scenario server for the smoke test (EVM-009 AC2, AC3): answers `GET /api/health` like the API of EVM-008
 * ({ status: 'ok', minSupportedAppVersion: { android, ios } }; 503 problem+json when "the database is down"), in the mode the
 * scenario needs. It listens on the loopback only (the emulator reaches it as 10.0.2.2) — never on all interfaces. It records only
 * the compatibility headers of the requests (api-guidelines → "Minimalna wersja aplikacji"), no addresses and no bodies.
 */
import { createServer } from 'node:http';

/** @typedef {'ok' | 'update' | 'down'} StubMode */
/** @typedef {Awaited<ReturnType<typeof startStubApi>>} StubApi */
/** @typedef {{ platform: string | undefined, version: string | undefined }} RecordedRequest */

export const OK_MINIMUM = '0.1.0';
export const UPDATE_MINIMUM = '99.0.0';

/**
 * @param {StubMode} mode
 * @returns {{ status: number, type: string, body: unknown }}
 */
export function healthAnswer(mode) {
  if (mode === 'down') {
    return {
      status: 503,
      type: 'application/problem+json',
      body: { type: 'about:blank', title: 'Service Unavailable', status: 503, code: 'service_unavailable' },
    };
  }
  const minimum = mode === 'update' ? UPDATE_MINIMUM : OK_MINIMUM;
  return { status: 200, type: 'application/json', body: { status: 'ok', minSupportedAppVersion: { android: minimum, ios: minimum } } };
}

/**
 * @param {{ port?: number }} [options] 0 = a free port
 * @returns {Promise<{ port: number, setMode: (mode: StubMode) => void, requests: () => RecordedRequest[], close: () => Promise<void> }>}
 */
export async function startStubApi({ port = 0 } = {}) {
  /** @type {StubMode} */
  let mode = 'ok';
  /** @type {RecordedRequest[]} */
  const recorded = [];
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/api/health') {
      response.writeHead(404, { 'Content-Type': 'application/problem+json' }).end('{"code":"not_found"}');
      return;
    }
    const header = (/** @type {string} */ name) => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    recorded.push({ platform: header('x-client-platform'), version: header('x-client-version') });
    const answer = healthAnswer(mode);
    response.writeHead(answer.status, { 'Content-Type': answer.type, 'Cache-Control': 'no-store' }).end(JSON.stringify(answer.body));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(undefined);
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the scenario server has no TCP address');
  return {
    port: address.port,
    setMode: (next) => {
      mode = next;
    },
    requests: () => [...recorded],
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

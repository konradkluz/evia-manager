// @ts-check
/**
 * Scenario server for the smoke test (EVM-009 AC2, AC3; EVM-100): answers `GET /api/health` like the API of EVM-008
 * ({ status: 'ok', minSupportedAppVersion: { android, ios } }; 503 problem+json when "the database is down"), in the mode the
 * scenario needs ('hang' never answers, for the loading state), and the four operations of the mobile sign-in of the contract EVM-090
 * (login, login/totp, token, logout) for ONE synthetic account, in the sign-in mode of the scenario. It listens on the loopback only
 * (the emulator reaches it as 10.0.2.2) — never on all interfaces. It records only the compatibility headers of the requests
 * (api-guidelines → "Minimalna wersja aplikacji"), no addresses and no bodies; the tokens it hands out are fixed test words (gitleaks).
 */
import { createServer } from 'node:http';
import { authAnswer, E2E_ACCOUNT, healthAnswer, OK_MINIMUM, problem, sessionBody, UPDATE_MINIMUM } from './stub-answers.mjs';
import { createMediaGlue } from './media-replica.mjs';
import { createSyncStub } from './sync-stub.mjs';
import { closeServers, createControlServer, createUploadStub, listenOnLoopback, portOf } from './upload-stub.mjs';

/** @typedef {import('./stub-answers.mjs').StubMode} StubMode */
/** @typedef {import('./stub-answers.mjs').AuthMode} AuthMode */
/** @typedef {Awaited<ReturnType<typeof startStubApi>>} StubApi */
/** @typedef {{ platform: string | undefined, version: string | undefined }} RecordedRequest */

const MAX_BODY = 8192;
/** The part size of the upload part of the run: small, so that a file of 40 MiB has ten parts and there is room to interrupt it (the real server uses 16 MiB). */
export const E2E_PART_SIZE = 4 * 1024 * 1024;
/** A batch of 50 mutations of the contract is up to 1 MB. */
const MAX_SYNC_BODY = 1_048_576;

/** Re-exported so that the existing importers keep working. */
export { authAnswer, E2E_ACCOUNT, healthAnswer, OK_MINIMUM, sessionBody, UPDATE_MINIMUM };

const AUTH_PATHS = [
  '/api/v1/auth/mobile/login',
  '/api/v1/auth/mobile/login/totp',
  '/api/v1/auth/mobile/token',
  '/api/v1/auth/mobile/logout',
];

/**
 * @param {{ port?: number, uploadControlPort?: number, onRequest?: (request: RecordedRequest) => void, onSync?: (report: import('./sync-stub.mjs').SyncReport) => void }} [options] port 0 = a free port; uploadControlPort 0 = a free port of the control listener of the upload part; onRequest sees every recorded request
 * @returns {Promise<{ port: number, uploadControlPort?: number, setMode: (mode: StubMode, auth?: AuthMode) => void, setSyncModes: (modes: Partial<import('./sync-stub.mjs').SyncModes>) => void, requests: () => RecordedRequest[], syncReport: () => import('./sync-stub.mjs').SyncReport, syncReset: () => void, close: () => Promise<void> }>}
 */
export async function startStubApi({ port = 0, uploadControlPort = 0, onRequest, onSync } = {}) {
  // EVM-130: the upload part (the five operations of the session, the parts, the sign-in while the host has it on) is served on the same port,
  // because the app knows one address; the host steers it through its own control port (loopback only). The glue lets `applied` of the command
  // `CreateMediaAsset` register the asset there and every change of its file state reach the replica of the phone.
  /** @type {ReturnType<typeof createMediaGlue> | undefined} */
  let media;
  const upload = createUploadStub({
    partSize: E2E_PART_SIZE,
    onAssetState: (assetId, state, reason) => {
      media?.fileStateChanged(assetId, state, reason);
    },
  });
  /** @type {StubMode} */
  let mode = 'ok';
  /** @type {AuthMode} */
  let auth = 'ok';
  let issued = 0;
  const sync = createSyncStub();
  media = createMediaGlue(upload, sync);
  /** @type {RecordedRequest[]} */
  const recorded = [];
  const server = createServer((request, response) => {
    if (upload.claims(request.method, new URL(request.url ?? '/', 'http://stub.local').pathname)) {
      upload.handleApp(request, response);
      return;
    }
    const isHealth = request.method === 'GET' && request.url === '/api/health';
    const isAuth = request.method === 'POST' && AUTH_PATHS.includes(request.url ?? '');
    const target = new URL(request.url ?? '/', 'http://stub.local');
    const isSync =
      target.pathname.startsWith('/api/v1/sync/') ||
      target.pathname === '/api/v1/meta/client-config' ||
      target.pathname === '/api/v1/catalog/work-order-templates';
    if (isSync) {
      /** @type {Buffer[]} */
      const parts = [];
      let bytes = 0;
      request.on('data', (/** @type {Buffer} */ chunk) => {
        bytes += chunk.length;
        if (bytes <= MAX_SYNC_BODY) parts.push(chunk);
      });
      request.on('end', () => {
        /** @type {unknown} */
        let parsed;
        try {
          parsed = parts.length === 0 ? null : JSON.parse(Buffer.concat(parts).toString('utf8'));
        } catch {
          parsed = null;
        }
        const bearer = /^Bearer e2e-access-/.test(request.headers['authorization'] ?? '');
        const answer =
          mode === 'down' || mode === 'hang'
            ? problem(503, 'service_unavailable')
            : bytes > MAX_SYNC_BODY
              ? problem(413, 'payload_too_large')
              : (sync.handle(request.method ?? 'GET', target.pathname, target.searchParams, parsed, bearer) ?? problem(404, 'not_found'));
        if (target.pathname === '/api/v1/sync/mutations') media.mutationsAnswered(parsed, answer.body);
        response.writeHead(answer.status, { 'Content-Type': answer.type, 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(answer.body));
        onSync?.(sync.report());
      });
      return;
    }
    if (!isHealth && !isAuth) {
      response.writeHead(404, { 'Content-Type': 'application/problem+json' }).end('{"code":"not_found"}');
      return;
    }
    const header = (/** @type {string} */ name) => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const request_ = { platform: header('x-client-platform'), version: header('x-client-version') };
    recorded.push(request_);
    onRequest?.(request_);
    // 'hang': the request is held without an answer (the app keeps its loading state until its own timeout); close() ends it
    if (mode === 'hang' && isHealth) return;
    if (isHealth || mode === 'down') {
      const answer = healthAnswer(mode);
      response.writeHead(answer.status, { 'Content-Type': answer.type, 'Cache-Control': 'no-store' }).end(JSON.stringify(answer.body));
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    request.on('end', () => {
      /** @type {unknown} */
      let body;
      try {
        body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = null;
      }
      issued += 1;
      const answer = size > MAX_BODY ? problem(413, 'payload_too_large') : authAnswer(request.url ?? '', body, auth, issued);
      response.writeHead(answer.status, { 'Content-Type': answer.type, 'Cache-Control': 'no-store', ...(answer.headers ?? {}) });
      response.end(answer.status === 204 ? undefined : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(undefined);
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the scenario server has no TCP address');
  upload.setPort(address.port);
  const controlServer = createControlServer(upload);
  await listenOnLoopback(controlServer, uploadControlPort);
  return {
    port: address.port,
    uploadControlPort: portOf(controlServer),
    setMode: (next, nextAuth = 'ok') => {
      mode = next;
      auth = nextAuth;
    },
    /** The answers of the catalogue and of a quick work order for the scenario (EVM-106). */
    setSyncModes: (next) => {
      sync.setModes(next);
    },
    requests: () => [...recorded],
    /** Counters of the synchronization part: unique mutations, duplicates, everything received (EVM-107 AC6). */
    syncReport: () => sync.report(),
    syncReset: () => {
      sync.reset();
    },
    close: async () => {
      await closeServers([controlServer]);
      await new Promise((resolve) => {
        server.close(() => {
          resolve(undefined);
        });
        server.closeAllConnections();
      });
    },
  };
}

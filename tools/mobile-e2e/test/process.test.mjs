import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, mock } from 'node:test';
import { httpJson, parseAppVersion, parseLongPathsEnabled, realHost, startStubInWorker } from '../src/process.mjs';

describe('wiring of the smoke test to the machine (EVM-009 AC4)', () => {
  it('EVM-009 AC4: the registry answer of LongPathsEnabled is read exactly (0x1 only)', () => {
    assert.equal(parseLongPathsEnabled('    LongPathsEnabled    REG_DWORD    0x1\r\n'), true);
    assert.equal(parseLongPathsEnabled('    LongPathsEnabled    REG_DWORD    0x0\r\n'), false);
    assert.equal(parseLongPathsEnabled('    LongPathsEnabled    REG_DWORD    0x10\r\n'), false);
    assert.equal(parseLongPathsEnabled(''), false);
  });

  it('EVM-009 AC4: the application version is read from the single source in the Expo configuration', () => {
    assert.equal(parseAppVersion("export const APP_VERSION = '0.1.0';"), '0.1.0');
    assert.equal(parseAppVersion('nothing here'), 'unknown');
  });

  it('EVM-009 AC4: files, directories, processes and time work on the real machine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-e2e-'));
    try {
      const host = realHost(root);
      assert.equal(host.repoRoot, root);
      host.makeDirectory(join(root, 'a', 'b'));
      host.writeText(join(root, 'a', 'b', 'f.txt'), 'x');
      assert.equal(host.exists(join(root, 'a', 'b', 'f.txt')), true);
      assert.equal(host.exists(join(root, 'missing')), false);
      // EVM-093 AC4: the release package is copied into .scratch, build-tools are listed, build.gradle is read
      host.copyFile(join(root, 'a', 'b', 'f.txt'), join(root, 'a', 'copy.txt'));
      assert.equal(host.readText(join(root, 'a', 'copy.txt')), 'x');
      assert.equal(host.readText(join(root, 'missing')), null);
      assert.deepEqual(host.listDirectory(join(root, 'a')).sort(), ['b', 'copy.txt']);
      assert.deepEqual(host.listDirectory(join(root, 'missing')), []);
      const out = host.run(process.execPath, ['-e', 'process.stdout.write("hi")'], { cwd: root, env: { PATH: process.env['PATH'] ?? '' } });
      assert.deepEqual(out, { status: 0, stdout: 'hi', stderr: '' });
      const streamed = host.run(process.execPath, ['-e', ''], { stream: true });
      assert.equal(streamed.status, 0);
      host.startDetached(process.execPath, ['-e', ''], { env: { PATH: process.env['PATH'] ?? '' } });
      host.startDetached(process.execPath, ['-e', '']);
      const before = host.now();
      await host.sleep(5);
      assert.ok(host.now() >= before);
      assert.match(host.today(), /^\d{4}-\d{2}-\d{2}$/);
      const longPaths = host.longPathsEnabled();
      assert.ok(longPaths === null || typeof longPaths === 'boolean');
      assert.equal(host.platform, process.platform);
      assert.ok(host.homedir.length > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('EVM-009 AC4: the Expo CLI and the version are found in the app directory, and the log goes to the standard output', () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-e2e-'));
    try {
      const app = join(root, 'apps', 'mobile');
      mkdirSync(join(app, 'node_modules', 'expo', 'bin'), { recursive: true });
      mkdirSync(join(app, 'plugins'), { recursive: true });
      writeFileSync(join(app, 'package.json'), '{}');
      writeFileSync(join(app, 'node_modules', 'expo', 'package.json'), '{"name":"expo","version":"0.0.0"}');
      writeFileSync(join(app, 'node_modules', 'expo', 'bin', 'cli'), '');
      writeFileSync(join(app, 'plugins', 'expo-config.ts'), "export const APP_VERSION = '9.8.7';\n");
      const host = realHost(root);
      assert.equal(host.resolveExpoCli(app), join(app, 'node_modules', 'expo', 'bin', 'cli'));
      assert.equal(host.readAppVersion(app), '9.8.7');
      const write = mock.method(process.stdout, 'write', () => true);
      try {
        host.log('hello');
      } finally {
        write.mock.restore();
      }
      assert.deepEqual(
        write.mock.calls.map((call) => call.arguments[0]),
        ['hello\n'],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('EVM-009 AC4: screenshots of Maestro are collected flat into every target, the later run of a flow wins, other files are left', () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-e2e-'));
    try {
      const host = realHost(root);
      const source = join(root, 'out');
      /** @param {string[]} parts @param {string} text */
      const put = (parts, text) => {
        mkdirSync(join(source, ...parts.slice(0, -1)), { recursive: true });
        writeFileSync(join(source, ...parts), text);
      };
      put(['2026-10-21_040000', '01-online', 'takeScreenshot', 's01-online.png'], 'old');
      put(['2026-10-21_050000', '01-online', 'takeScreenshot', 's01-online.png'], 'new');
      put(['2026-10-21_050000', '01-online', 'takeScreenshot', 'kolejka-empty.png'], 'queue');
      put(['2026-10-21_050000', '01-online', 'takeScreenshot', 'notes.txt'], 'not an image');
      put(['2026-10-21_050000', '01-online', 'logs', 'trace.png'], 'not a screenshot');
      const first = join(root, 'a');
      const second = join(root, 'b', 'c');
      assert.deepEqual(host.collectScreenshots(source, [first, second]), ['kolejka-empty.png', 's01-online.png']);
      for (const target of [first, second]) {
        assert.deepEqual(readdirSync(target).sort(), ['kolejka-empty.png', 's01-online.png']);
        assert.equal(readFileSync(join(target, 's01-online.png'), 'utf8'), 'new');
      }
      assert.deepEqual(host.collectScreenshots(join(root, 'missing'), [first]), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('EVM-009 AC4: resetDirectory leaves an empty directory, also where there was none', () => {
    const root = mkdtempSync(join(tmpdir(), 'evia-e2e-'));
    try {
      const host = realHost(root);
      const directory = join(root, 'shots');
      host.resetDirectory(directory);
      assert.deepEqual(readdirSync(directory), []);
      writeFileSync(join(directory, 'stale.png'), 'x');
      host.resetDirectory(directory);
      assert.deepEqual(readdirSync(directory), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('EVM-009 AC4: the scenario server of the host answers on the loopback', async () => {
    const host = realHost(process.cwd());
    const stub = await host.startStub(0);
    try {
      const response = await fetch(`http://127.0.0.1:${String(stub.port)}/api/health`);
      assert.equal(response.status, 200);
    } finally {
      await stub.close();
    }
  });

  it('EVM-009 AC4: requests recorded before close() are still returned after it', async () => {
    const stub = await realHost(process.cwd()).startStub(0);
    await fetch(`http://127.0.0.1:${String(stub.port)}/api/health`, {
      headers: { 'X-Client-Platform': 'android', 'X-Client-Version': '0.1.0' },
    });
    await stub.close();
    assert.deepEqual(stub.requests(), [{ platform: 'android', version: '0.1.0' }]);
  });

  it('EVM-009 AC4: a worker that ends before it reports a port is a rejection, not a wait', async () => {
    await assert.rejects(startStubInWorker(0, new URL('./fixtures/exit-before-port.mjs', import.meta.url)), /stub worker exited/);
  });

  it('EVM-130 AC8: a worker that dies on an exception after the port is reported is named in the log with the reason', async () => {
    /** @type {string[]} */
    const lines = [];
    const stub = await startStubInWorker(0, new URL('./fixtures/throw-after-port.mjs', import.meta.url), (line) => {
      lines.push(line);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(
      lines.some((line) => line.includes('thread failed') && line.includes('synthetic worker failure')),
      lines.join('|'),
    );
    assert.ok(
      lines.some((line) => line.includes('thread ended (exit code 1)')),
      lines.join('|'),
    );
    await stub.close();
  });

  it('EVM-009 AC4: close() of a server whose worker is already gone resolves at once', async () => {
    const stub = await startStubInWorker(0, new URL('./fixtures/exit-after-port.mjs', import.meta.url));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const timeout = new Promise((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('close() hangs'));
      }, 3000).unref();
    });
    await Promise.race([stub.close(), timeout]);
    assert.deepEqual(stub.requests(), []);
  });

  it('EVM-106 AC1: the modes of the catalogue reach the worker - the list of templates is answered, empty, or 403 channel_not_allowed', async () => {
    const host = realHost(process.cwd());
    const stub = await host.startStub(0);
    const fetchTemplates = `fetch('http://127.0.0.1:${String(stub.port)}/api/v1/catalog/work-order-templates', { headers: { Authorization: 'Bearer e2e-access-1-------------------------------' } }).then(async (r) => { const b = await r.json(); process.exit(r.status === 200 ? (b.items.length === 0 ? 5 : 0) : r.status === 403 ? 6 : 3); }, () => process.exit(4))`;
    /** @param {number} expected */
    const waitFor = (expected) => {
      // the mode reaches the worker asynchronously: poll until the answer changes, with a limit
      let status = host.run(process.execPath, ['-e', fetchTemplates]).status;
      for (const deadline = Date.now() + 10_000; status !== expected && Date.now() < deadline;) {
        status = host.run(process.execPath, ['-e', fetchTemplates]).status;
      }
      return status;
    };
    try {
      assert.equal(waitFor(0), 0);
      stub.setSyncModes({ templates: 'none' });
      assert.equal(waitFor(5), 5);
      stub.setSyncModes({ templates: 'channel_not_allowed' });
      assert.equal(waitFor(6), 6);
      stub.setSyncModes({ templates: 'ok' });
      assert.equal(waitFor(0), 0);
    } finally {
      await stub.close();
    }
  });

  it('EVM-009 AC4: the scenario server answers while the runner is blocked in a synchronous child process (Maestro)', async () => {
    const host = realHost(process.cwd());
    const stub = await host.startStub(0);
    const fetchStatus = `fetch('http://127.0.0.1:${String(stub.port)}/api/health', { headers: { 'X-Client-Platform': 'android', 'X-Client-Version': '0.1.0' } }).then((r) => process.exit(r.status === 200 ? 0 : 3), () => process.exit(4))`;
    try {
      assert.equal(host.run(process.execPath, ['-e', fetchStatus]).status, 0);
      stub.setMode('down');
      // the mode reaches the worker asynchronously: poll until the answer changes, with a limit
      let calls = 1;
      let status = host.run(process.execPath, ['-e', fetchStatus]).status;
      for (const deadline = Date.now() + 10_000; status !== 3 && Date.now() < deadline; calls += 1) {
        status = host.run(process.execPath, ['-e', fetchStatus]).status;
      }
      assert.equal(status, 3);
      assert.equal(stub.requests().length, calls + 1);
    } finally {
      await stub.close();
    }
  });
});

describe('control port of the upload part through the worker (EVM-130 AC8)', () => {
  it('EVM-130 AC8: the worker reports the control port of the upload part, the host reads the checkpoint over HTTP while the runner thread is free', async () => {
    const stub = await startStubInWorker(0);
    try {
      assert.ok((stub.uploadControlPort ?? 0) > 0);
      const answer = await fetch(`http://127.0.0.1:${String(stub.uploadControlPort)}/control/checkpoint`);
      assert.equal(answer.status, 200);
      assert.deepEqual(Object.keys(/** @type {object} */ (await answer.json())).sort(), [
        'assets',
        'counters',
        'openMultiparts',
        'orphanedMultiparts',
        'settings',
      ]);
    } finally {
      await stub.close();
    }
  });

  it('EVM-130 AC8: a worker that reports only a port (older fixture) has no control port', async () => {
    const stub = await startStubInWorker(0, new URL('./fixtures/exit-after-port.mjs', import.meta.url));
    assert.equal(stub.uploadControlPort, undefined);
    await stub.close();
  });
});

describe('control requests of the host (EVM-130 AC8)', () => {
  it('EVM-130 AC8: a control call whose connection is reset is repeated and answered (the first call after a long synchronous Maestro run)', async () => {
    const { createServer } = await import('node:http');
    let calls = 0;
    const server = createServer((request, response) => {
      calls += 1;
      if (calls === 1) request.socket.destroy();
      else response.writeHead(200).end('{"ok":true}');
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(undefined);
      });
    });
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    try {
      assert.deepEqual(await httpJson('GET', `http://127.0.0.1:${String(address.port)}/x`), { status: 200, body: { ok: true } });
      assert.equal(calls, 2);
    } finally {
      server.close();
    }
  });

  it('EVM-130 AC8: httpJson sends a JSON body and reads JSON, an empty body and a text that is not JSON; a closed port is null; any other host is refused', async () => {
    const { createServer } = await import('node:http');
    /** @type {string[]} */
    const seen = [];
    const server = createServer((request, response) => {
      /** @type {Buffer[]} */
      const chunks = [];
      request.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
      request.on('end', () => {
        seen.push(`${request.method ?? ''} ${request.url ?? ''} ${Buffer.concat(chunks).toString('utf8')}`);
        if (request.url === '/json') response.writeHead(200).end('{"ok":true}');
        else if (request.url === '/empty') response.writeHead(204).end();
        else response.writeHead(500).end('not json');
      });
    });
    await new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        resolve(undefined);
      }),
    );
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      assert.deepEqual(await httpJson('POST', `http://127.0.0.1:${String(port)}/json`, { a: 1 }), { status: 200, body: { ok: true } });
      assert.deepEqual(await httpJson('GET', `http://127.0.0.1:${String(port)}/empty`), { status: 204, body: null });
      assert.deepEqual(await httpJson('GET', `http://127.0.0.1:${String(port)}/text`), { status: 500, body: null });
      assert.deepEqual(seen, ['POST /json {"a":1}', 'GET /empty ', 'GET /text ']);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) =>
        server.close(() => {
          resolve(undefined);
        }),
      );
    }
    assert.equal(await httpJson('GET', `http://127.0.0.1:${String(port)}/json`), null);
    await assert.rejects(httpJson('GET', 'http://example.com/control/checkpoint'), /loopback only/);
    await assert.rejects(httpJson('GET', 'http://localhost:1/x'), /loopback only/);
    assert.equal(realHost(process.cwd()).httpJson, httpJson);
  });
});

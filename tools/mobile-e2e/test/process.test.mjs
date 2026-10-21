import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, mock } from 'node:test';
import { parseAppVersion, parseLongPathsEnabled, realHost, startStubInWorker } from '../src/process.mjs';

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

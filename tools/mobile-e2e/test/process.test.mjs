import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, mock } from 'node:test';
import { parseAppVersion, parseLongPathsEnabled, realHost } from '../src/process.mjs';

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

  it('EVM-009 AC4: the scenario server answers while the runner is blocked in a synchronous child process (Maestro)', async () => {
    const host = realHost(process.cwd());
    const stub = await host.startStub(0);
    const fetchStatus = `fetch('http://127.0.0.1:${String(stub.port)}/api/health', { headers: { 'X-Client-Platform': 'android', 'X-Client-Version': '0.1.0' } }).then((r) => process.exit(r.status === 200 ? 0 : 3), () => process.exit(4))`;
    try {
      assert.equal(host.run(process.execPath, ['-e', fetchStatus]).status, 0);
      stub.setMode('down');
      await host.sleep(200);
      assert.equal(host.run(process.execPath, ['-e', fetchStatus]).status, 3);
      assert.deepEqual(stub.requests(), [
        { platform: 'android', version: '0.1.0' },
        { platform: 'android', version: '0.1.0' },
      ]);
    } finally {
      await stub.close();
    }
  });
});

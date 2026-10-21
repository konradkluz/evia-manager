/**
 * The HTTP client (EVM-007 AC3; security-engineer A3, B "Limit API") and the entry point of the container (AC3, AC4;
 * architect 12, 13): timeouts, foreign links, the size limit, the unsafe environment, the backoff after a rate limit,
 * the result, the state and the metrics written for deploy.sh and Alloy.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTAINER_PATHS, logLine, metrics, readRollback, run, writeAtomic, type Paths } from '../src/cli.ts';
import { Rejection } from '../src/errors.ts';
import { GitHub, nextLink, readCapped } from '../src/github.ts';
import { buildScenario, OWNER, REPO, startStub, TOKEN, wireArtifacts, type Stub } from './support/github-stub.ts';
import { COMPOSE, configText } from './support/fixtures.ts';

let stub: Stub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const rejection = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Rejection) return error.code;
    throw error;
  }
  return 'accepted';
};

const client = (base: string, options: Partial<ConstructorParameters<typeof GitHub>[0]> = {}): GitHub =>
  new GitHub({ baseUrl: base, token: TOKEN, owner: OWNER, repo: REPO, budget: 50, artifactHosts: ['127.0.0.1'], ...options });

describe('EVM-007 AC3: the GitHub client', () => {
  it('EVM-007 AC3: a timeout, a foreign path, a foreign next link and a response over the limit are rejected', async () => {
    const server = createServer((request, response) => {
      if (request.url?.startsWith(`/repos/${OWNER}/${REPO}/slow`)) return void setTimeout(() => response.end('{}'), 500);
      if (request.url?.startsWith(`/repos/${OWNER}/${REPO}/foreign-link`)) {
        response.writeHead(200, { link: '<https://evil.example/repos/evia-test/manager/x?page=2>; rel="next"' });
        return void response.end('[]');
      }
      response.writeHead(200);
      return void response.end(JSON.stringify({ data: 'x'.repeat(2048) }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        resolve();
      }),
    );
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    try {
      expect(await rejection(client(base, { timeoutMs: 50 }).json(`/repos/${OWNER}/${REPO}/slow`))).toBe('api-timeout');
      expect(await rejection(client(base).json('/repos/other/repo/x'))).toBe('api-path');
      expect(await rejection(client(base).json('https://evil.example/repos/evia-test/manager/x'))).toBe('api-path');
      expect(await rejection(client(base).json(`/repos/${OWNER}/${REPO}/foreign-link`))).toBe('api-path');
      expect(await rejection(client(base, { maxJsonBytes: 100 }).json(`/repos/${OWNER}/${REPO}/big`))).toBe('api-size');
      expect(await rejection(client(base).all(`/repos/${OWNER}/${REPO}/big`))).toBe('api-parse');
      const budget = client(base, { budget: 1 });
      await budget.json(`/repos/${OWNER}/${REPO}/big`);
      expect(await rejection(budget.json(`/repos/${OWNER}/${REPO}/big`))).toBe('api-budget');
      expect(budget.requests).toBe(2);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
    expect(await rejection(client('http://127.0.0.1:1').json(`/repos/${OWNER}/${REPO}/x`))).toBe('api-network');
  });

  it('EVM-007 AC3: the base URL is a bare origin; Link headers give only rel="next"; an empty body reads as empty', async () => {
    expect(() => client('https://api.github.com/proxy')).toThrow(Rejection);
    expect(nextLink(null)).toBeNull();
    expect(nextLink('<https://a/x?page=1>; rel="prev", <https://a/x?page=3>; rel="next"')).toBe('https://a/x?page=3');
    expect(nextLink('<https://a/x>; rel="last"')).toBeNull();
    expect((await readCapped(new Response(null), 10)).byteLength).toBe(0);
  });

  it('EVM-007 AC3 (A3): the artifact redirect must be https in production and the second request may not redirect again', async () => {
    const built = buildScenario(1, COMPOSE);
    stub = await startStub(built.scenario);
    wireArtifacts(stub);
    const archive = `${stub.base}/repos/${OWNER}/${REPO}/actions/artifacts/3001/zip`;
    expect(await rejection(client(stub.base).artifactZip(3001, archive))).toBe('v3-artifact-host');
    built.scenario.redirect = '{blob}/missing';
    expect(await rejection(client(stub.base, { allowHttpArtifactHost: true }).artifactZip(3001, archive))).toBe('v3-artifact-download');
    built.scenario.redirect = 'not a url';
    expect(await rejection(client(stub.base, { allowHttpArtifactHost: true }).artifactZip(3001, archive))).toBe('v3-artifact-redirect');
  });
});

describe('EVM-007 AC3, AC4: the entry point of the verifier container', () => {
  const paths = (): Paths => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-agent-'));
    return {
      config: join(dir, 'config.json'),
      registry: join(dir, 'registry.json'),
      token: join(dir, 'token'),
      rollback: join(dir, 'rollback'),
      result: join(dir, 'out', 'result.json'),
      state: join(dir, 'state'),
    };
  };
  const now = new Date('2026-10-21T10:00:00.000Z');

  it('EVM-007 AC3, AC4: a cycle writes the result for deploy.sh, the state and the metrics; the log line has identifiers only', async () => {
    const built = buildScenario(1, COMPOSE);
    stub = await startStub(built.scenario);
    wireArtifacts(stub);
    const files = paths();
    writeFileSync(files.config, configText(built.baseline));
    writeFileSync(files.token, `${TOKEN}\n`);
    const result = await run({ paths: files, env: {}, now, apiBase: stub.base, allowHttpArtifactHost: true });
    expect(result.exitCode).toBe(0);
    expect(result.decision.decision).toBe('deploy');
    const written = JSON.parse(readFileSync(files.result, 'utf8')) as Record<string, unknown>;
    expect(written).toMatchObject({ schemaVersion: 1, checkedAt: now.toISOString(), decision: 'deploy', commit: built.commits[0] });
    expect(JSON.parse(readFileSync(join(files.state, 'state.json'), 'utf8'))).toMatchObject({ lastDecision: 'deploy', notBefore: null });
    expect(readFileSync(join(files.state, 'metrics.prom'), 'utf8')).toContain('deploy_agent_last_decision{decision="deploy"} 1');
    const line = logLine(result);
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain('konrad');
    expect(JSON.parse(line)).toMatchObject({ decision: 'deploy', commit: built.commits[0] });
  });

  it('EVM-007 AC3 (n3): a rate limit rejects with exit code 3 and the next cycle makes no request until the backoff ends', async () => {
    const built = buildScenario(1, COMPOSE);
    built.scenario.overrides.push({
      prefix: '/repos/evia-test/manager/git/',
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      times: 1,
    });
    stub = await startStub(built.scenario);
    wireArtifacts(stub);
    const files = paths();
    writeFileSync(files.config, configText(built.baseline));
    writeFileSync(files.token, TOKEN);
    const first = await run({ paths: files, env: {}, now, apiBase: stub.base, allowHttpArtifactHost: true });
    expect(first.exitCode).toBe(3);
    expect(first.decision.reasons.join()).toContain('api-rate-limit');
    const requests = stub.requests.length;
    const second = await run({ paths: files, env: {}, now: new Date(now.getTime() + 60_000), apiBase: stub.base });
    expect(second.decision.reasons).toEqual(['rate limit backoff — no request this cycle']);
    expect(stub.requests.length).toBe(requests);
    const third = await run({
      paths: files,
      env: {},
      now: new Date(now.getTime() + 16 * 60_000),
      apiBase: stub.base,
      allowHttpArtifactHost: true,
    });
    expect(third.decision.decision).toBe('deploy');
  });

  it('EVM-007 AC3 (A3): an unsafe environment (TLS checks off, a proxy) refuses to run with exit code 2', async () => {
    const files = paths();
    for (const env of [
      { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      { HTTPS_PROXY: 'http://203.0.113.1:3128' },
      { NODE_OPTIONS: '--require x' },
    ]) {
      const result = await run({ paths: files, env, now });
      expect(result.exitCode).toBe(2);
      expect(result.decision.reasons.join()).toContain('unsafe-environment');
    }
  });

  it('EVM-007 AC3: a missing configuration, a malformed token or rollback command rejects the cycle with exit code 3', async () => {
    const files = paths();
    expect((await run({ paths: files, env: {}, now })).exitCode).toBe(3);
    writeFileSync(files.config, configText('a'.repeat(40)));
    writeFileSync(files.token, 'not a token!');
    expect((await run({ paths: files, env: {}, now })).decision.reasons.join()).toContain('token');
    writeFileSync(files.token, TOKEN);
    writeFileSync(files.rollback, 'main');
    expect((await run({ paths: files, env: {}, now, apiBase: 'http://127.0.0.1:1' })).decision.reasons.join()).toContain(
      'rollback-command',
    );
    expect(readRollback(null)).toBeNull();
    expect(readRollback(` ${'a'.repeat(40)}\n`)).toBe('a'.repeat(40));
    writeFileSync(join(files.state, 'state.json'), '{');
    expect((await run({ paths: files, env: {}, now })).exitCode).toBe(3);
  });

  it('EVM-007 AC4: metrics show the deployed commit and manifest; the container paths are fixed; writes are atomic', () => {
    const text = metrics(
      { decision: 'none', head: null, reasons: [] },
      new Date(0),
      null,
      {
        commit: 'a'.repeat(40),
        manifestSha256: 'b'.repeat(64),
        manifest: '{}',
        composeSha256: 'c'.repeat(64),
        activityEventId: 1,
        baseline: 'd'.repeat(40),
        deployedAt: '2026-10-21T00:00:00.000Z',
      },
      3,
    );
    expect(text).toContain(`deployed_commit_info{commit="${'a'.repeat(40)}",manifest_sha256="${'b'.repeat(64)}"} 1`);
    expect(text).toContain('deploy_agent_last_success_timestamp_seconds 0');
    expect(CONTAINER_PATHS.token).toBe('/run/secrets/github-pat');
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'));
    writeAtomic(join(dir, 'a', 'b.json'), 'x');
    expect(readFileSync(join(dir, 'a', 'b.json'), 'utf8')).toBe('x');
  });
});

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
import { readActivity } from '../src/activity.ts';
import { readRange } from '../src/history.ts';
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
      expect(await rejection(client(base).all(`/repos/${OWNER}/${REPO}/foreign-link`))).toBe('api-path');
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

  it('EVM-007 AC3 (RR-34): Link headers by repository id (/repositories/<id>/...) are followed; the request is rebuilt from the repository path', async () => {
    const built = buildScenario(3, COMPOSE);
    built.scenario.comparePageSize = 1;
    built.scenario.linkStyle = 'repositories';
    stub = await startStub(built.scenario);
    const github = client(stub.base);
    const commits = await readRange(github, built.baseline, built.scenario.head, 10);
    expect(commits.map((commit) => commit.sha)).toEqual(built.commits);
    const compare = stub.requests.filter((request) => request.includes('/compare/'));
    expect(compare).toHaveLength(3);
    expect(compare.every((request) => request.startsWith(`/repos/${OWNER}/${REPO}/compare/`))).toBe(true);
    expect(compare[1]).toContain('per_page=100&page=2');
  });

  describe('EVM-007 AC3 (RR-34): the next link is accepted only for the same operation of this repository', () => {
    const SUFFIX = `compare/${'a'.repeat(40)}...${'b'.repeat(40)}`;
    const PATH = `/repos/${OWNER}/${REPO}/${SUFFIX}?per_page=100`;
    const ACTIVITY = `/repos/${OWNER}/${REPO}/activity?ref=refs%2Fheads%2Fmain&direction=desc&per_page=100`;
    let link = '';
    let server: ReturnType<typeof createServer> | undefined;
    let base = '';
    const start = async (host = '127.0.0.1'): Promise<void> => {
      const created = createServer((_request, response) => {
        response.writeHead(200, link === '' ? {} : { link: `<${link}>; rel="next", <${link}>; rel="last"` });
        response.end('[]');
      });
      server = created;
      await new Promise<void>((resolve) =>
        created.listen(0, '127.0.0.1', () => {
          resolve();
        }),
      );
      base = `http://${host}:${String((created.address() as AddressInfo).port)}`;
    };
    afterEach(async () => {
      const closing = server;
      server = undefined;
      if (closing !== undefined)
        await new Promise<void>((resolve) =>
          closing.close(() => {
            resolve();
          }),
        );
    });
    /** Reads a page and then asks for its next one: the rejection of an unacceptable link comes with that second call. */
    const follow = async (target: string, path = PATH, github?: GitHub): Promise<string> => {
      if (server === undefined) await start();
      link = target.replaceAll('{base}', base);
      const client_ = github ?? client(base);
      const page = await client_.json(path);
      if (page.next === null) return 'no-next';
      return rejection(client_.json(page.next));
    };

    it('accepts /repos/<owner>/<name>/ and /repositories/<id>/ with the same suffix and returns a normalized path', async () => {
      await start();
      const github = client(base);
      link = `${base}/repositories/1403122150/${SUFFIX}?per_page=100&page=2`;
      expect((await github.json(PATH)).next).toBe(`/repos/${OWNER}/${REPO}/${SUFFIX}?per_page=100&page=2`);
      link = `${base}/repos/${OWNER}/${REPO}/${SUFFIX}?page=2&per_page=100`;
      expect((await github.json(PATH)).next).toBe(`/repos/${OWNER}/${REPO}/${SUFFIX}?per_page=100&page=2`);
      // the page advances from the current one; an encoded key is decoded and normalized (current behaviour, kept)
      link = `${base}/repositories/1403122150/${SUFFIX}?per_page=100&pag%65=3`;
      expect((await github.json(`${PATH}&page=2`)).next).toBe(`/repos/${OWNER}/${REPO}/${SUFFIX}?per_page=100&page=3`);
    });

    it('accepts an upper-case host (normalized) and a request without per_page', async () => {
      await start('localhost');
      link = `http://LOCALHOST:${base.split(':')[2] ?? ''}/repositories/5/${SUFFIX}?page=2`;
      expect((await client(base).json(`/repos/${OWNER}/${REPO}/${SUFFIX}`)).next).toBe(`/repos/${OWNER}/${REPO}/${SUFFIX}?page=2`);
    });

    it('keeps the other parameters of the request and rejects a changed, missing, differently cased or new one', async () => {
      await start();
      const github = client(base);
      const path = `/repos/${OWNER}/${REPO}/${SUFFIX}?head_sha=abc&per_page=100`;
      link = `${base}/repositories/7/${SUFFIX}?head_sha=abc&per_page=100&page=2`;
      expect((await github.json(path)).next).toBe(`/repos/${OWNER}/${REPO}/${SUFFIX}?head_sha=abc&per_page=100&page=2`);
      for (const bad of [
        'head_sha=zzz&per_page=100&page=2',
        'per_page=100&page=2',
        'head_sha=abc&per_page=100&page=2&after=x',
        'HEAD_SHA=abc&per_page=100&page=2',
      ]) {
        expect(await follow(`{base}/repositories/7/${SUFFIX}?${bad}`, path, github)).toBe('api-path');
      }
    });

    it.each([
      ['another host', 'https://evil.example/repositories/1/{s}?per_page=100&page=2'],
      ['another host (repos)', 'https://evil.example/repos/evia-test/manager/{s}?per_page=100&page=2'],
      ['a scheme-relative address', '//evil.example/repositories/1/{s}?per_page=100&page=2'],
      ['a relative link', '/repositories/1/{s}?per_page=100&page=2'],
      ['a scheme without slashes', 'https:evil.example/repositories/1/{s}?per_page=100&page=2'],
      ['another scheme', 'https://127.0.0.1/repositories/1/{s}?per_page=100&page=2'],
      ['another port', 'http://127.0.0.1:1/repositories/1/{s}?per_page=100&page=2'],
      ['a trailing dot after the host', 'http://127.0.0.1.:{port}/repositories/1/{s}?per_page=100&page=2'],
      ['credentials', 'http://u:p@127.0.0.1/repositories/1/{s}?per_page=100&page=2'],
      ['a space', '{base}/repositories/1/{s}?per_page=100&page=2 x'],
      ['an IDN host', 'http://exämple.test/repositories/1/{s}?per_page=100&page=2'],
      ['a backslash', '{base}/repositories/1/{s}\\x?per_page=100&page=2'],
      ['percent in the repos variant', '{base}/repos/evia-test/manager/{s}%41?per_page=100&page=2'],
      ['a single dot segment', '{base}/repositories/1/./{s}?per_page=100&page=2'],
      ['a doubled slash', '{base}/repositories/1//{s}?per_page=100&page=2'],
      ['a semicolon in the path', '{base}/repositories/1/{s};x?per_page=100&page=2'],
      ['another operation', '{base}/repositories/1/compare/x...y?per_page=100&page=2'],
      ['another suffix', '{base}/repositories/1/git/ref/heads/main?per_page=100&page=2'],
      ['another repository path', '{base}/repos/other/repo/{s}?per_page=100&page=2'],
      ['a non-numeric id', '{base}/repositories/abc/{s}?per_page=100&page=2'],
      ['an empty id', '{base}/repositories//{s}?per_page=100&page=2'],
      ['a zero-led id', '{base}/repositories/012/{s}?per_page=100&page=2'],
      ['a huge id', '{base}/repositories/12345678901234567890/{s}?per_page=100&page=2'],
      ['dot segments', '{base}/repositories/1/../../repos/evia-test/manager/{s}?per_page=100&page=2'],
      ['encoded dot segments', '{base}/repositories/1/%2e%2e/{s}?per_page=100&page=2'],
      ['an encoded slash', '{base}/repositories/1%2f2/{s}?per_page=100&page=2'],
      ['a fragment', '{base}/repositories/1/{s}?per_page=100&page=2#x'],
      ['no page', '{base}/repositories/1/{s}?per_page=100'],
      ['an unknown parameter', '{base}/repositories/1/{s}?per_page=100&page=2&access_token=x'],
      ['a cursor outside /activity', '{base}/repositories/1/{s}?per_page=100&page=2&after=abc'],
      ['a repeated page', '{base}/repositories/1/{s}?per_page=100&page=2&page=2'],
      ['a repeated per_page', '{base}/repositories/1/{s}?per_page=100&per_page=100&page=2'],
      ['another per_page', '{base}/repositories/1/{s}?per_page=50&page=2'],
      ['a missing per_page', '{base}/repositories/1/{s}?page=2'],
      ['per_page zero', '{base}/repositories/1/{s}?per_page=0&page=2'],
      ['a page that does not advance', '{base}/repositories/1/{s}?per_page=100&page=1'],
      ['a page that skips', '{base}/repositories/1/{s}?per_page=100&page=3'],
      ['a negative page', '{base}/repositories/1/{s}?per_page=100&page=-1'],
      ['page zero', '{base}/repositories/1/{s}?per_page=100&page=0'],
      ['a huge page', '{base}/repositories/1/{s}?per_page=100&page=99999999999'],
      ['a fractional page', '{base}/repositories/1/{s}?per_page=100&page=2.5'],
      ['an empty page', '{base}/repositories/1/{s}?per_page=100&page='],
      ['a signed page', '{base}/repositories/1/{s}?per_page=100&page=+2'],
      ['a zero-led page', '{base}/repositories/1/{s}?per_page=100&page=02'],
      ['a hexadecimal page', '{base}/repositories/1/{s}?per_page=100&page=0x2'],
      ['a non-numeric page', '{base}/repositories/1/{s}?per_page=100&page=x'],
    ])('rejects %s (when the next page is asked for, not when the current one is read)', async (_name, target) => {
      await start();
      expect(
        await follow(
          target
            .replace('{s}', SUFFIX)
            .replace('{port}', base.split(':')[2] ?? '')
            .replace('{base}', base),
        ),
      ).toBe('api-path');
    });

    it('rejects a repository id that changes between pages of one client', async () => {
      await start();
      const github = client(base);
      link = `${base}/repositories/111/${SUFFIX}?per_page=100&page=2`;
      await github.json(PATH);
      link = `${base}/repositories/222/${SUFFIX}?per_page=100&page=2`;
      expect(await follow(link, PATH, github)).toBe('api-path');
      link = `${base}/repositories/111/${SUFFIX}?per_page=100&page=2`;
      expect((await github.json(PATH)).next).not.toBeNull();
    });

    it('does not pin the id of a link that is rejected for another reason', async () => {
      await start();
      const github = client(base);
      expect(await follow(`{base}/repositories/111/${SUFFIX}?per_page=100&page=9`, PATH, github)).toBe('api-path');
      link = `${base}/repositories/222/${SUFFIX}?per_page=100&page=2`;
      expect((await github.json(PATH)).next).not.toBeNull();
    });

    it('rejects a full URL passed to json()', async () => {
      await start();
      expect(await rejection(client(base).json(`${base}/repos/${OWNER}/${REPO}/x`))).toBe('api-path');
    });

    describe('Activity paginates by cursor (after | before), not by page', () => {
      it('accepts one cursor, keeps ref, direction and per_page, and builds the request itself', async () => {
        await start();
        const github = client(base);
        const expected = (cursor: string): string =>
          `/repos/${OWNER}/${REPO}/activity?ref=refs%2Fheads%2Fmain&direction=desc&per_page=100&${cursor}`;
        link = `${base}/repositories/9/activity?ref=refs%2Fheads%2Fmain&direction=desc&per_page=100&after=Y3Vyc29y_-%3D`.replace(
          '%3D',
          '=',
        );
        expect((await github.json(ACTIVITY)).next).toBe(expected('after=Y3Vyc29y_-%3D'));
        link = `${base}/repos/${OWNER}/${REPO}/activity?ref=refs%2Fheads%2Fmain&direction=desc&per_page=100&before=abc`;
        expect((await github.json(`${ACTIVITY}&after=old`)).next).toBe(expected('before=abc'));
      });

      it.each([
        ['both cursors', 'per_page=100&after=a&before=b'],
        ['a repeated cursor', 'per_page=100&after=a&after=b'],
        ['no cursor', 'per_page=100'],
        ['an empty cursor', 'per_page=100&after='],
        ['a cursor with a forbidden character', 'per_page=100&after=a!b'],
        ['a cursor with a slash', 'per_page=100&after=a%2Fb'],
        ['a cursor of 257 characters', `per_page=100&after=${'a'.repeat(257)}`],
        ['a page next to the cursor', 'per_page=100&after=a&page=2'],
        ['another per_page', 'per_page=30&after=a'],
        ['an unknown parameter', 'per_page=100&after=a&x=1'],
      ])('rejects %s', async (_name, query) => {
        await start();
        expect(await follow(`{base}/repositories/9/activity?ref=refs%2Fheads%2Fmain&direction=desc&${query}`, ACTIVITY)).toBe('api-path');
      });

      it('rejects other parameters changed from the request and a cursor of 256 characters is accepted', async () => {
        await start();
        expect(await follow(`{base}/repositories/9/activity?ref=refs%2Fheads%2Fdev&direction=desc&per_page=100&after=a`, ACTIVITY)).toBe(
          'api-path',
        );
        expect(
          await follow(
            `{base}/repositories/9/activity?ref=refs%2Fheads%2Fmain&direction=desc&per_page=100&after=${'a'.repeat(256)}`,
            ACTIVITY,
          ),
        ).toBe('accepted');
      });
    });
  });

  describe('EVM-007 AC3 (RR-34): Activity and jobs behind /repositories/<id>/ links', () => {
    it('reads Activity across cursor pages (anchor on the second page) and jobs across pages', async () => {
      const built = buildScenario(5, COMPOSE);
      built.scenario.activityPageSize = 2;
      built.scenario.linkStyle = 'repositories';
      stub = await startStub(built.scenario);
      const github = client(stub.base);
      const anchor = { activityEventId: 102, commit: built.commits[1] ?? '' };
      const events = await readActivity(github, anchor);
      expect(events.map((event) => event.id)).toEqual([103, 104, 105]);
      const activity = stub.requests.filter((request) => request.includes('/activity'));
      expect(activity).toHaveLength(2);
      expect(activity[1]).toMatch(/&after=c2$/);
      expect(activity.some((request) => request.includes('&page='))).toBe(false);
      built.scenario.jobsPageSize = 1;
      const jobs = await github.all(`${github.repoPath}/actions/runs/2001/attempts/1/jobs?per_page=100`, 'jobs');
      expect(jobs).toHaveLength(2);
      expect(stub.requests.filter((request) => request.includes('/jobs'))).toHaveLength(2);
    });

    it('finds an anchor on the first page even when the next link is unacceptable; a deeper anchor then rejects', async () => {
      const built = buildScenario(5, COMPOSE);
      stub = await startStub(built.scenario);
      const first = built.scenario.events.slice(0, 2);
      built.scenario.overrides.push({
        prefix: `/repos/${OWNER}/${REPO}/activity`,
        status: 200,
        headers: { link: '<https://evil.example/repositories/1/activity?per_page=100&after=x>; rel="next"' },
        body: JSON.stringify(first),
        times: 3,
      });
      const github = client(stub.base);
      const events = await readActivity(github, { activityEventId: 104, commit: built.commits[3] ?? '' });
      expect(events.map((event) => event.id)).toEqual([105]);
      expect(await rejection(readActivity(github, { activityEventId: 100, commit: built.baseline }))).toBe('api-path');
    });
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
    const missing = await run({ paths: files, env: {}, now });
    expect(missing.exitCode).toBe(3);
    expect(missing.decision.reasons).toEqual(['config: file not mounted']);
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
        kind: 'deploy',
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

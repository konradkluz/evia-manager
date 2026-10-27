/**
 * A stub of the GitHub REST API on node:http (EVM-007 AC3; architect 11): only the endpoints the verifier reads,
 * answered from a synthetic scenario (no real logins, IDs or commits). A second server stands for the blob storage of
 * artifacts and records the headers it receives (the token must never reach it).
 */
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { makeZip } from './zip.ts';

export const OWNER = 'evia-test';
export const REPO = 'manager';
export const OWNER_ID = 4242;
export const OTHER_ID = 9999;
export const WORKFLOW_ID = 777;
export const COMPOSE_PATH = 'infra/runtime/compose.staging.yaml';
export const API_REPO = 'ghcr.io/evia-test/evia-api';
export const WEB_REPO = 'ghcr.io/evia-test/evia-web';

/** A deterministic synthetic SHA. */
export const fakeSha = (label: string): string => createHash('sha1').update(label).digest('hex');
export const digest = (label: string): string => `sha256:${createHash('sha256').update(label).digest('hex')}`;

export interface Run {
  id: number;
  workflow_id: number;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  run_attempt: number;
}

export interface Scenario {
  head: string;
  /** Activity events, NEWEST FIRST, exactly as the API returns them. */
  events: Array<Record<string, unknown>>;
  activityPageSize: number;
  /** History of main, oldest first (baseline first). */
  history: Array<{ sha: string; parents: string[] }>;
  comparePageSize: number;
  /** Pull request per merge commit. */
  pulls: Map<string, Record<string, unknown>>;
  runs: Run[];
  /** `${runId}/${attempt}` → attempt status and conclusion (defaults to the run's). */
  attempts: Map<string, { status: string; conclusion: string | null }>;
  jobsPageSize: number;
  /** `${runId}/${attempt}` → jobs. */
  jobs: Map<string, Array<{ name: string; status: string; conclusion: string | null }>>;
  artifacts: Map<number, Array<Record<string, unknown>>>;
  zips: Map<number, Uint8Array>;
  /** `${path}@${sha}` → file text. */
  contents: Map<string, string>;
  /** Answers that replace a route (matched on the start of the path): status and headers or a custom body. */
  overrides: Array<{ prefix: string; status: number; headers?: Record<string, string>; body?: string; times?: number }>;
  /** Redirect target of artifact downloads; `{blob}` is replaced by the blob server origin. */
  redirect: string;
  /** `repositories`: Link headers point to /repositories/<repositoryId>/… like the live GitHub API (RR-34). */
  linkStyle?: 'repos' | 'repositories';
  repositoryId?: number;
}

export interface Stub {
  readonly base: string;
  readonly blob: string;
  readonly scenario: Scenario;
  readonly blobHeaders: IncomingHttpHeaders[];
  readonly requests: string[];
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const listen = (server: Server): Promise<string> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
    });
  });

/** Pagination with a `page` parameter and a Link header to the next page. */
function paged<T>(
  url: URL,
  base: string,
  items: T[],
  size: number,
  linkPath: (pathname: string) => string = (pathname) => pathname,
): { items: T[]; link: Record<string, string> } {
  const page = Number(url.searchParams.get('page') ?? '1');
  const slice = items.slice((page - 1) * size, page * size);
  if (page * size >= items.length) return { items: slice, link: {} };
  const next = new URL(linkPath(url.pathname) + url.search, base);
  next.searchParams.set('page', String(page + 1));
  return { items: slice, link: { link: `<${next.href}>; rel="next"` } };
}

export async function startStub(scenario: Scenario): Promise<Stub> {
  const requests: string[] = [];
  const blobHeaders: IncomingHttpHeaders[] = [];
  const blobServer = createServer((request, response) => {
    blobHeaders.push(request.headers);
    const id = Number(/^\/blob\/(\d+)$/.exec(request.url ?? '')?.[1]);
    const zip = scenario.zips.get(id);
    if (zip === undefined) {
      send(response, 404, {});
      return;
    }
    response.writeHead(200, { 'content-type': 'application/zip' });
    response.end(Buffer.from(zip));
    return undefined;
  });
  const blob = await listen(blobServer);
  let base = '';
  const apiServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', base);
    requests.push(url.pathname + url.search);
    const override = scenario.overrides.find((item) => url.pathname.startsWith(item.prefix) && (item.times ?? 1) > 0);
    if (override !== undefined) {
      if (override.times !== undefined) override.times -= 1;
      send(response, override.status, override.body ?? { message: 'stub override' }, override.headers);
      return;
    }
    if (request.headers.authorization !== 'Bearer ghs_testtokentesttokentesttoken') {
      send(response, 401, { message: 'no token' });
      return;
    }
    const prefix = `/repos/${OWNER}/${REPO}`;
    const linkPath = (pathname: string): string =>
      scenario.linkStyle === 'repositories'
        ? pathname.replace(prefix, `/repositories/${String(scenario.repositoryId ?? 1403122150)}`)
        : pathname;
    if (!url.pathname.startsWith(`${prefix}/`)) {
      send(response, 404, {});
      return;
    }
    const path = url.pathname.slice(prefix.length);
    let match: RegExpExecArray | null;
    if (path === '/git/ref/heads/main') {
      send(response, 200, { ref: 'refs/heads/main', object: { type: 'commit', sha: scenario.head } });
      return;
    }
    if (path === '/activity') {
      const { items, link } = paged(url, base, scenario.events, scenario.activityPageSize, linkPath);
      send(response, 200, items, link);
      return;
    }
    if ((match = /^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(path)) !== null) {
      const from = scenario.history.findIndex((commit) => commit.sha === match?.[1]);
      const to = scenario.history.findIndex((commit) => commit.sha === match?.[2]);
      if (from < 0 || to < 0) {
        send(response, 404, {});
        return;
      }
      const ahead = Math.max(0, to - from);
      const commits = scenario.history
        .slice(from + 1, to + 1)
        .map((commit) => ({ sha: commit.sha, parents: commit.parents.map((sha) => ({ sha })) }));
      const { items, link } = paged(url, base, commits, scenario.comparePageSize, linkPath);
      const status = to > from ? 'ahead' : to === from ? 'identical' : 'behind';
      send(response, 200, { status, ahead_by: ahead, behind_by: to < from ? from - to : 0, total_commits: ahead, commits: items }, link);
      return;
    }
    if ((match = /^\/commits\/([0-9a-f]{40})\/pulls$/.exec(path)) !== null) {
      const pull = scenario.pulls.get(match[1] ?? '');
      send(response, 200, pull === undefined ? [] : [{ number: pull['number'], merge_commit_sha: pull['merge_commit_sha'] }]);
      return;
    }
    if ((match = /^\/pulls\/(\d+)$/.exec(path)) !== null) {
      const pull = [...scenario.pulls.values()].find((item) => String(item['number']) === match?.[1]);
      if (pull === undefined) send(response, 404, {});
      else send(response, 200, pull);
      return;
    }
    if ((match = /^\/actions\/workflows\/(\d+)\/runs$/.exec(path)) !== null) {
      const runs = scenario.runs.filter(
        (run) =>
          String(run.workflow_id) === match?.[1] &&
          run.head_sha === url.searchParams.get('head_sha') &&
          (url.searchParams.get('event') === null || run.event === url.searchParams.get('event')),
      );
      send(response, 200, { total_count: runs.length, workflow_runs: runs });
      return;
    }
    if ((match = /^\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/.exec(path)) !== null) {
      const { items, link } = paged(
        url,
        base,
        scenario.jobs.get(`${match[1] ?? ''}/${match[2] ?? ''}`) ?? [],
        scenario.jobsPageSize,
        linkPath,
      );
      send(response, 200, { jobs: items }, link);
      return;
    }
    if ((match = /^\/actions\/runs\/(\d+)\/attempts\/(\d+)$/.exec(path)) !== null) {
      const run = scenario.runs.find((item) => String(item.id) === match?.[1]);
      const attempt = scenario.attempts.get(`${match[1] ?? ''}/${match[2] ?? ''}`) ?? { status: run?.status, conclusion: run?.conclusion };
      send(response, 200, { id: run?.id, run_attempt: Number(match[2]), ...attempt });
      return;
    }
    if ((match = /^\/actions\/runs\/(\d+)\/artifacts$/.exec(path)) !== null) {
      send(response, 200, { artifacts: scenario.artifacts.get(Number(match[1])) ?? [] });
      return;
    }
    if ((match = /^\/actions\/artifacts\/(\d+)\/zip$/.exec(path)) !== null) {
      response.writeHead(302, { location: scenario.redirect.replace('{blob}', blob).replace('{id}', match[1] ?? '') });
      response.end();
      return undefined;
    }
    if ((match = /^\/contents\/(.+)$/.exec(path)) !== null) {
      const text = scenario.contents.get(`${decodeURIComponent(match[1] ?? '')}@${url.searchParams.get('ref') ?? ''}`);
      if (text === undefined) {
        send(response, 404, {});
        return;
      }
      const bytes = Buffer.from(text, 'utf8');
      send(response, 200, {
        type: 'file',
        encoding: 'base64',
        path: decodeURIComponent(match[1] ?? ''),
        size: bytes.byteLength,
        content: bytes.toString('base64'),
      });
      return;
    }
    send(response, 404, { message: `stub: no route ${path}` });
  });
  base = await listen(apiServer);
  return {
    base,
    blob,
    scenario,
    blobHeaders,
    requests,
    close: async () => {
      await new Promise<void>((resolve) =>
        apiServer.close(() => {
          resolve();
        }),
      );
      await new Promise<void>((resolve) =>
        blobServer.close(() => {
          resolve();
        }),
      );
    },
  };
}

export const TOKEN = 'ghs_testtokentesttokentesttoken';

export interface Built {
  scenario: Scenario;
  baseline: string;
  /** Merge commits, oldest first. */
  commits: string[];
  manifests: Map<string, string>;
}

/** The manifest text of `publish` for a commit. */
export function manifestText(commit: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    commit,
    images: { api: `${API_REPO}@${digest(`api-${commit}`)}`, web: `${WEB_REPO}@${digest(`web-${commit}`)}` },
    compose: COMPOSE_PATH,
    ...overrides,
  });
}

/**
 * A healthy history: the baseline (Activity event 100) followed by `count` squash merges by Konrad, each with a green
 * pull_request run of ci.yml and a push run with a green publish and its release-manifest artifact. `unpublished`: no
 * push run yet; `skippedPublish`: a green push run that skipped publish (documentation only, EVM-083).
 */
export function buildScenario(
  count: number,
  composeText: string,
  options: { unpublished?: number[]; skippedPublish?: number[] } = {},
): Built {
  const baseline = fakeSha('baseline');
  const history = [{ sha: baseline, parents: [fakeSha('root')] }];
  const events: Array<Record<string, unknown>> = [
    {
      id: 100,
      activity_type: 'pr_merge',
      before: fakeSha('root'),
      after: baseline,
      ref: 'refs/heads/main',
      actor: { id: OWNER_ID, login: 'konrad-test' },
    },
  ];
  const scenario: Scenario = {
    head: baseline,
    events,
    activityPageSize: 100,
    history,
    comparePageSize: 100,
    pulls: new Map(),
    runs: [],
    attempts: new Map(),
    jobsPageSize: 100,
    jobs: new Map(),
    artifacts: new Map(),
    zips: new Map(),
    contents: new Map([[`${COMPOSE_PATH}@${baseline}`, composeText]]),
    overrides: [],
    redirect: '{blob}/blob/{id}',
  };
  const commits: string[] = [];
  const manifests = new Map<string, string>();
  let previous = baseline;
  for (let index = 1; index <= count; index += 1) {
    const commit = fakeSha(`merge-${String(index)}`);
    const head = fakeSha(`pr-head-${String(index)}`);
    history.push({ sha: commit, parents: [previous] });
    events.unshift({
      id: 100 + index,
      activity_type: 'pr_merge',
      before: previous,
      after: commit,
      ref: 'refs/heads/main',
      actor: { id: OWNER_ID, login: 'konrad-test' },
    });
    scenario.pulls.set(commit, {
      number: index,
      merged: true,
      merge_commit_sha: commit,
      base: { ref: 'main' },
      head: { sha: head },
      merged_by: { id: OWNER_ID, login: 'konrad-test' },
    });
    const prRun = 1000 + index;
    scenario.runs.push({
      id: prRun,
      workflow_id: WORKFLOW_ID,
      head_sha: head,
      head_branch: `feature/x-${String(index)}`,
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success',
      run_attempt: 1,
    });
    scenario.jobs.set(`${String(prRun)}/1`, [{ name: 'ci-gate', status: 'completed', conclusion: 'success' }]);
    scenario.contents.set(`${COMPOSE_PATH}@${commit}`, composeText);
    if (!(options.unpublished ?? []).includes(index)) {
      const pushRun = 2000 + index;
      scenario.runs.push({
        id: pushRun,
        workflow_id: WORKFLOW_ID,
        head_sha: commit,
        head_branch: 'main',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        run_attempt: 1,
      });
      const skipped = (options.skippedPublish ?? []).includes(index);
      scenario.jobs.set(`${String(pushRun)}/1`, [
        { name: 'ci-gate', status: 'completed', conclusion: 'success' },
        { name: 'publish', status: 'completed', conclusion: skipped ? 'skipped' : 'success' },
      ]);
      if (skipped) {
        commits.push(commit);
        previous = commit;
        continue;
      }
      const artifact = 3000 + index;
      const text = manifestText(commit);
      manifests.set(commit, text);
      scenario.artifacts.set(pushRun, [
        {
          id: artifact,
          name: 'release-manifest',
          expired: false,
          archive_download_url: '',
          workflow_run: { id: pushRun, head_sha: commit },
        },
      ]);
      scenario.zips.set(artifact, makeZip([{ name: 'release-manifest.json', data: Buffer.from(text, 'utf8') }]));
    }
    commits.push(commit);
    previous = commit;
  }
  scenario.head = previous;
  return { scenario, baseline, commits, manifests };
}

/** Sets archive_download_url of every artifact to the stub base (known after start). */
export function wireArtifacts(stub: Stub): void {
  for (const list of stub.scenario.artifacts.values())
    for (const artifact of list)
      artifact['archive_download_url'] = `${stub.base}/repos/${OWNER}/${REPO}/actions/artifacts/${String(artifact['id'])}/zip`;
}

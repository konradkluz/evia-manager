import { readdirSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { isDeclarable, UploadEngine } from '../src/upload/index.ts';
import {
  UploadFailure,
  type Checkpoint,
  type CompleteResult,
  type FileDeclaration,
  type JobSnapshot,
  type JobStore,
  type Outcome,
  type PartRequest,
  type PartUrl,
  type RemotePart,
  type SessionInfo,
} from '../src/upload/index.ts';

/**
 * Loader of the shared vectors `conformance/upload/*.json` (EVM-109 AC4) and the scenario runner with a deterministic fake server.
 * The Kotlin engine runs the same files with the same fake (apps/mobile/modules/evia-upload/engine, `VectorsTest`).
 */
const DIRECTORY = new URL('./upload/', import.meta.url);

/** Reads a vector file; the caller states the expected shape (the files are data of this repository, not external input). */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the type argument documents the shape of the data file
export function readVector<T>(name: string): T {
  const data: unknown = JSON.parse(readFileSync(new URL(name, DIRECTORY), 'utf8'));
  return data as T;
}

/** Files listed in `index.json`. */
export function indexedFiles(): string[] {
  return readVector<{ files: string[] }>('index.json').files;
}

/** `*.json` files that exist in the directory (besides `index.json`). */
export function filesOnDisk(): string[] {
  return readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .sort();
}

interface FaultSpec {
  op: string;
  part?: number;
  effect: string;
  times: number;
}
interface SessionSpec {
  id: string;
  key?: string;
  state: 'active' | 'expired' | 'aborted' | 'completed';
  parts: RemotePart[];
}
interface ServerSpec {
  partSize: number;
  fileState: string;
  partUrlHost: string;
  sessions: SessionSpec[];
  partCount?: number;
  partUrlContentLength?: number;
  listOverride?: RemotePart[];
  createId?: string;
  putEtag?: string;
  omitEtag?: boolean;
  completeResult?: CompleteResult;
}
interface RunSpec {
  crashAt?: { checkpoint: Checkpoint; nth: number };
  /** The explicit resume after a full sign-in of the same owner (`engine.run(..., { resume: true })`). */
  resume?: boolean;
  /** The stop signal (wipe marker) is raised once this many calls of the run have been made; 0 = from the start. */
  stopAfterCalls?: number;
  expect: { outcome: Outcome | 'crashed'; calls: string[]; sleeps: number[]; store?: string | null };
}
export interface Scenario {
  id: string;
  ac: string;
  size?: number;
  ids?: string[];
  rng?: number[];
  server?: Partial<ServerSpec>;
  initialStore?: JobSnapshot;
  faults?: FaultSpec[];
  runs: RunSpec[];
  final: { objects: number; sessionsCreated: number; open: number; puts: Record<string, number>; store: string | null };
}
export interface ResumeFile {
  defaults: {
    assetId: string;
    size: number;
    file: Omit<FileDeclaration, 'declaredSize'>;
    allowedHosts: string[];
    ids: string[];
    rng: number[];
    server: ServerSpec;
  };
  scenarios: Scenario[];
}

class Crash extends Error {}

/** Deterministic fake of the API and the storage; counts what the vectors assert. */
class FakeServer {
  readonly calls: string[] = [];
  readonly puts = new Map<number, number>();
  objects = 0;
  sessionsCreated = 0;
  private readonly sessions: SessionSpec[];
  private readonly faults: FaultSpec[];
  private counter = 0;
  private dropAfterList: number | undefined;

  private readonly spec: ServerSpec;
  private readonly size: number;

  constructor(spec: ServerSpec, size: number, faults: FaultSpec[]) {
    this.spec = spec;
    this.size = size;
    this.sessions = structuredClone(spec.sessions);
    this.faults = structuredClone(faults);
  }

  get open(): number {
    return this.sessions.filter((session) => session.state === 'active').length;
  }

  private partCount(): number {
    return this.spec.partCount ?? Math.ceil(this.size / this.spec.partSize);
  }

  private length(part: number): number {
    return Math.min(this.spec.partSize, this.size - (part - 1) * this.spec.partSize);
  }

  /** Records the call and applies the next matching fault: throws, or returns `lost` when the answer must be dropped after executing. */
  private enter(op: string, part?: number): boolean {
    this.calls.push(part === undefined ? op : `${op}:${part}`);
    const fault = this.faults.find((item) => item.op === op && item.times > 0 && (item.part === undefined || item.part === part));
    if (fault === undefined) return false;
    fault.times -= 1;
    if (fault.effect === 'lost_response') return true;
    if (fault.effect.startsWith('drop_after_list:')) {
      this.dropAfterList = Number(fault.effect.split(':')[1]);
      return false;
    }
    if (fault.effect === 'network') throw new UploadFailure({ kind: 'network' });
    const [, status, code, retryAfter] = fault.effect.split(':');
    throw new UploadFailure({
      kind: 'http',
      status: Number(status),
      ...(code === undefined ? {} : { code }),
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: Number(retryAfter) }),
    });
  }

  private conflict(): never {
    throw new UploadFailure({ kind: 'http', status: 409, code: 'invalid_state_transition' });
  }

  /** Every declaration of a file that `createSession` received, in order (the vectors assert it is present, valid and never changes, EVM-131). */
  readonly declarations: FileDeclaration[] = [];

  createSession(_assetId: string, id: string, key: string, file: FileDeclaration): SessionInfo {
    this.declarations.push(file);
    const lost = this.enter('createSession');
    const byKey = this.sessions.find((session) => session.key === key);
    let session = byKey ?? this.sessions.find((item) => item.state === 'active');
    if (byKey !== undefined && byKey.state !== 'active') this.conflict();
    if (session === undefined) {
      if (this.spec.fileState !== 'pending_upload') this.conflict();
      session = { id, key, state: 'active', parts: [] };
      this.sessions.push(session);
      this.sessionsCreated += 1;
    }
    if (lost) throw new UploadFailure({ kind: 'network' });
    return { id: this.spec.createId ?? session.id, partSize: this.spec.partSize, partCount: this.partCount() };
  }

  listParts(id: string): readonly RemotePart[] {
    const lost = this.enter('listParts');
    const session = this.sessions.find((item) => item.id === id);
    if (session === undefined) throw new UploadFailure({ kind: 'http', status: 404, code: 'not_found' });
    if (session.state !== 'active') this.conflict();
    if (lost) throw new UploadFailure({ kind: 'network' });
    const answer = this.spec.listOverride ?? [...session.parts];
    // The part vanishes from the storage right after the answer (cleanup of the multipart, rollback).
    const dropped = this.dropAfterList;
    this.dropAfterList = undefined;
    if (dropped !== undefined) session.parts = session.parts.filter((item) => item.partNumber !== dropped);
    return answer;
  }

  partUrl(id: string, part: number): PartUrl {
    const lost = this.enter('partUrl', part);
    const session = this.sessions.find((item) => item.id === id);
    if (session?.state !== 'active') this.conflict();
    if (lost) throw new UploadFailure({ kind: 'network' });
    this.counter += 1;
    return {
      url: `https://${this.spec.partUrlHost}/${id}/${part}?X-Amz-Signature=sig${this.counter}`,
      contentLength: this.spec.partUrlContentLength ?? this.length(part),
    };
  }

  put(request: PartRequest): string | null {
    const [, id, part] = new URL(request.url).pathname.split('/');
    const number = Number(part);
    const lost = this.enter('put', number);
    const session = this.sessions.find((item) => item.id === id);
    if (session === undefined || request.length !== this.length(number)) throw new UploadFailure({ kind: 'http', status: 400 });
    session.parts = [...session.parts.filter((item) => item.partNumber !== number), { partNumber: number, size: request.length }];
    this.puts.set(number, (this.puts.get(number) ?? 0) + 1);
    if (lost) throw new UploadFailure({ kind: 'network' });
    return this.spec.omitEtag === true ? null : (this.spec.putEtag ?? `"etag-${number}"`);
  }

  complete(id: string): CompleteResult {
    const lost = this.enter('complete');
    const session = this.sessions.find((item) => item.id === id);
    const result = this.spec.completeResult ?? { state: 'uploaded' };
    if (session === undefined) throw new UploadFailure({ kind: 'http', status: 404, code: 'not_found' });
    if (session.state !== 'completed') {
      if (session.state !== 'active') this.conflict();
      const complete = Array.from({ length: this.partCount() }, (_, index) => index + 1).every(
        (number) => session.parts.find((item) => item.partNumber === number)?.size === this.length(number),
      );
      if (!complete) throw new UploadFailure({ kind: 'http', status: 422, code: 'parts_missing' });
      session.state = 'completed';
      this.objects += 1;
    }
    if (lost) throw new UploadFailure({ kind: 'network' });
    return result;
  }
}

class MemoryStore implements JobStore {
  snapshot: JobSnapshot | null;
  constructor(initial: JobSnapshot | undefined) {
    this.snapshot = initial === undefined ? null : structuredClone(initial);
  }
  load(): Promise<JobSnapshot | null> {
    return Promise.resolve(this.snapshot === null ? null : structuredClone(this.snapshot));
  }
  save(snapshot: JobSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.snapshot = null;
    return Promise.resolve();
  }
}

/** Runs one scenario and returns the list of mismatches (empty = the engine agrees with the vector). */
export async function runScenario(scenario: Scenario, defaults: ResumeFile['defaults']): Promise<string[]> {
  const size = scenario.size ?? defaults.size;
  const file: FileDeclaration = { ...defaults.file, declaredSize: size };
  const server = new FakeServer({ ...defaults.server, ...scenario.server }, size, scenario.faults ?? []);
  const store = new MemoryStore(scenario.initialStore);
  const ids = [...(scenario.ids ?? defaults.ids)];
  const rngValues = scenario.rng ?? defaults.rng;
  let rngIndex = 0;
  let sleeps: number[] = [];
  let crashAt: RunSpec['crashAt'];
  let stopAfterCalls: number | undefined;
  let runStart = 0;
  let seen = 0;
  const newEngine = (): UploadEngine =>
    new UploadEngine({
      api: {
        createSession: (assetId, id, key, file) => Promise.resolve().then(() => server.createSession(assetId, id, key, file)),
        listParts: (id) => Promise.resolve().then(() => server.listParts(id)),
        partUrl: (id, part) => Promise.resolve().then(() => server.partUrl(id, part)),
        complete: (id) => Promise.resolve().then(() => server.complete(id)),
      },
      transport: { put: (request) => Promise.resolve().then(() => server.put(request)) },
      store,
      allowedHosts: defaults.allowedHosts,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      rng: () => rngValues[rngIndex++ % rngValues.length] ?? 0,
      newId: () => ids.shift() ?? 'exhausted-ids',
      isStopped: () => stopAfterCalls !== undefined && server.calls.length - runStart >= stopAfterCalls,
      checkpoint: (name) => {
        if (name === crashAt?.checkpoint && ++seen === crashAt.nth) throw new Crash();
      },
    });
  const problems: string[] = [];
  // A crash means a restart: a new engine instance on the same store. Without a crash the same instance continues.
  let engine = newEngine();
  for (const [index, run] of scenario.runs.entries()) {
    sleeps = [];
    seen = 0;
    crashAt = run.crashAt;
    stopAfterCalls = run.stopAfterCalls;
    const before = server.calls.length;
    runStart = before;
    let outcome: Outcome | 'crashed';
    try {
      outcome = await engine.run(defaults.assetId, file, { resume: run.resume === true });
    } catch (error) {
      if (!(error instanceof Crash)) throw error;
      outcome = 'crashed';
      engine = newEngine();
    }
    const actual = {
      outcome,
      calls: server.calls.slice(before),
      sleeps,
      ...(run.expect.store === undefined ? {} : { store: store.snapshot?.state ?? null }),
    };
    if (!isDeepStrictEqual(actual, run.expect)) {
      problems.push(`${scenario.id} run ${index + 1}: ${JSON.stringify(actual)} != ${JSON.stringify(run.expect)}`);
    }
  }
  // the declaration of the file: present on every createSession, valid for the contract, and the SAME one every time (a repeat is identical)
  for (const [index, sent] of server.declarations.entries()) {
    if (!isDeepStrictEqual(sent, file))
      problems.push(`${scenario.id} createSession ${index + 1}: declaration ${JSON.stringify(sent)} != ${JSON.stringify(file)}`);
    if (!isDeclarable(sent)) problems.push(`${scenario.id} createSession ${index + 1}: declaration is not declarable`);
  }
  if (server.declarations.length !== server.calls.filter((call) => call === 'createSession').length)
    problems.push(`${scenario.id}: a createSession without a declaration`);
  const final = {
    objects: server.objects,
    sessionsCreated: server.sessionsCreated,
    open: server.open,
    puts: Object.fromEntries([...server.puts.entries()].map(([part, count]) => [String(part), count])),
    store: store.snapshot?.state ?? null,
  };
  if (!isDeepStrictEqual(final, scenario.final))
    problems.push(`${scenario.id} final: ${JSON.stringify(final)} != ${JSON.stringify(scenario.final)}`);
  return problems;
}

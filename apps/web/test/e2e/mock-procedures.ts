import type { Answer } from './mock-locations.ts';

/**
 * The part of the synthetic API that serves the processes and the stages of an order (EVM-031): the list (`GET .../procedures`) and the
 * change of a stage (`PATCH .../procedure-stages/{id}`) with the rules of the real answers that the browser can feel — `If-Match` (428,
 * 412), the role, a closed order (`409 work_order_closed`), an unavailable person (`400 assignee_unavailable`), a stage of another order
 * (404). An order made from the nine-item template has nine processes with their stages, all "Do zrobienia". Synthetic data only; the full stack
 * (the database, the policies, the audit) is covered by the API integration tests and the role matrix.
 */
/** What this part of the synthetic API reads of the server of the orders (a structural subset of `OrderServer`: no import cycle). */
export interface OrderServer {
  readonly created: ReadonlyArray<{ readonly id: string; readonly templateId: string | null }>;
  readonly gone: ReadonlySet<string>;
  readonly templates: ReadonlyArray<{ readonly id: string; readonly items: readonly string[] }>;
  readonly assignable: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  readonly states: ReadonlyMap<string, { readonly status: string }>;
  readonly stages: Map<string, StageState>;
}

export interface StageState {
  responsibleUserId: string | null;
  dueDate: string | null;
  version: number;
}

export const PROCESSES: ReadonlyArray<{ code: string; name: string; stages: readonly string[] }> = [
  { code: 'osd', name: 'Uzgodnienia z OSD', stages: ['Pełnomocnictwo od klienta', 'Wniosek do OSD', 'Warunki przyłączenia'] },
  { code: 'admin', name: 'Zgody administracji', stages: ['Wniosek do administracji', 'Zgoda administracji'] },
  { code: 'expertise', name: 'Ekspertyza techniczna', stages: ['Oględziny', 'Opinia eksperta'] },
  { code: 'ppoz', name: 'Opinia ppoż', stages: ['Opinia rzeczoznawcy'] },
  { code: 'design', name: 'Projekt instalacji', stages: ['Projekt', 'Uzgodnienie projektu'] },
  { code: 'supply', name: 'Instalacja zasilająca', stages: ['Montaż linii zasilającej'] },
  { code: 'charger', name: 'Montaż ładowarki', stages: ['Montaż', 'Uruchomienie'] },
  { code: 'tests', name: 'Pomiary i odbiór', stages: ['Pomiary', 'Protokół odbioru'] },
  { code: 'meter', name: 'Wymiana licznika', stages: ['Zgłoszenie gotowości', 'Wymiana licznika'] },
];

/** How many of the processes a template brings: all nine for the template with nine items, one per two items otherwise. */
export const processCountOf = (itemCount: number): number => (itemCount >= 9 ? 9 : Math.max(1, Math.floor(itemCount / 2)));

const stageId = (orderId: string, process: number, stage: number): string =>
  `${orderId.slice(0, -6)}${String(process)}0${String(stage)}000`;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Answer =>
  json(status, { type: `/problems/${code}`, title: code, status, code, traceId: 'abcdef0123456789abcdef0123456789', ...extra });

const warsawFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });

function stateOf(server: OrderServer, id: string): StageState {
  return server.stages.get(id) ?? { responsibleUserId: null, dueDate: null, version: 1 };
}

function stageBody(server: OrderServer, orderId: string, process: number, stage: number, name: string, position: number) {
  const id = stageId(orderId, process, stage);
  const state = stateOf(server, id);
  const person = server.assignable.find((entry) => entry.id === state.responsibleUserId);
  return {
    id,
    code: `stage_${String(process)}_${String(stage)}`,
    name,
    position,
    status: 'todo',
    dueDate: state.dueDate,
    overdue: state.dueDate !== null && state.dueDate < warsawFormat.format(new Date()),
    responsibleUser: person === undefined ? null : { id: person.id, displayName: person.displayName },
    version: state.version,
  };
}

const NOT_FOUND = problem(404, 'not_found');

export function answerProcedures(server: OrderServer, orderId: string): Answer {
  const created = server.created.find((entry) => entry.id === orderId);
  if (created === undefined || server.gone.has(orderId)) return NOT_FOUND;
  if (created.templateId === null) return json(200, { items: [], openStageCount: 0 });
  const brought = processCountOf(server.templates.find((entry) => entry.id === created.templateId)?.items.length ?? 0);
  const items = PROCESSES.slice(0, brought).map((process, processIndex) => ({
    id: `${orderId.slice(0, -6)}${String(processIndex + 1)}00000`,
    code: process.code,
    name: process.name,
    position: processIndex + 1,
    progress: { done: 0, total: process.stages.length },
    stages: process.stages.map((name, stageIndex) => stageBody(server, orderId, processIndex + 1, stageIndex + 1, name, stageIndex + 1)),
  }));
  return json(200, { items, openStageCount: items.reduce((sum, item) => sum + item.stages.length, 0) });
}

interface StagePatchInput {
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly ifMatch: string | undefined;
  readonly raw: string;
}

/** `PATCH /work-orders/{id}/procedure-stages/{stageId}`: role, 404, 409 for a closed order, 428/412, the person (400), the change. */
export function answerStagePatch(server: OrderServer, orderId: string, id: string, input: StagePatchInput): Answer {
  if (input.role === 'read_only') return problem(403, 'forbidden');
  const created = server.created.find((entry) => entry.id === orderId);
  if (created === undefined || server.gone.has(orderId) || created.templateId === null) return NOT_FOUND;
  const located = PROCESSES.flatMap((process, processIndex) =>
    process.stages.map((name, stageIndex) => ({ process: processIndex + 1, stage: stageIndex + 1, name })),
  ).find((entry) => stageId(orderId, entry.process, entry.stage) === id);
  if (located === undefined) return NOT_FOUND;
  const status = server.states.get(orderId)?.status ?? 'new';
  if (status === 'settled' || status === 'cancelled') return problem(409, 'work_order_closed');
  if (input.ifMatch === undefined) return problem(428, 'precondition_required');
  const match = /^"(\d{1,9})"$/.exec(input.ifMatch);
  if (match === null) return problem(400, 'validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] });
  const state = stateOf(server, id);
  if (Number(match[1]) !== state.version) return problem(412, 'version_conflict');
  const body = JSON.parse(input.raw) as { responsibleUserId?: string | null; dueDate?: string | null };
  if (body.responsibleUserId !== undefined && body.responsibleUserId !== null) {
    if (!server.assignable.some((entry) => entry.id === body.responsibleUserId)) {
      return problem(400, 'validation_failed', { errors: [{ pointer: '/responsibleUserId', code: 'assignee_unavailable' }] });
    }
  }
  const next: StageState = {
    responsibleUserId: body.responsibleUserId === undefined ? state.responsibleUserId : body.responsibleUserId,
    dueDate: body.dueDate === undefined ? state.dueDate : body.dueDate,
    version: state.version + 1,
  };
  server.stages.set(id, next);
  return json(200, stageBody(server, orderId, located.process, located.stage, located.name, located.stage), {
    ETag: `"${String(next.version)}"`,
  });
}

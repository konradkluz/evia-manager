import type { Answer } from './mock-locations.ts';
import { PROCESSES, answerProcedures, type OrderServer } from './mock-procedures.ts';

/**
 * The part of the synthetic API that adds, removes and restores processes and stages by hand (EVM-042): the seven operations with the
 * rules of the real answers that the browser can feel — the role (403 before 404), a closed order (409), `If-Match` (428, 412), the
 * limits of 30 (422), an active code (409), a deleted parent (409), an unavailable person (400), the positions (a list renumbered 1…n).
 * The structure of one order (which processes, in which order, which stages) is a model built from the list of the template when the
 * first operation or read needs it; the data of the stages (status, person, date) still comes from the base answer, so a change of a
 * status (EVM-032) shows on a stage that was moved. Synthetic data only; the database, the policies, the audit and the journal are
 * covered by the API integration tests.
 */

interface Body {
  readonly id: string;
  readonly [key: string]: unknown;
}
interface StageBody extends Body {
  readonly status: string;
  readonly position: number;
  readonly version: number;
}
interface ProcedureBody extends Body {
  readonly stages: StageBody[];
  readonly position: number;
}

interface Removed {
  readonly position: number;
  readonly version: number;
  readonly deletedAt: string;
}

export interface OrderModel {
  /** Active processes in order, and for each its active stages in order. */
  procedures: string[];
  stages: Map<string, string[]>;
  /** Objects added by hand (a process: code, name; a stage: name, due date, person), by id. */
  addedProcedures: Map<string, { code: string; name: string }>;
  addedStages: Map<string, { name: string; dueDate: string | null; responsibleUserId: string | null }>;
  /** The process of every stage (also of the deleted ones). */
  parentOf: Map<string, string>;
  removedProcedures: Map<string, Removed>;
  removedStages: Map<string, Removed>;
  /** Versions of the objects the model changed (a process: its composition; a stage added by hand: 1). */
  versions: Map<string, number>;
  /** Stage versions the base answer does not hold (a removed stage keeps the version it was removed with). */
  clock: number;
}

export type EditingState = Map<string, OrderModel>;

export const LIMIT = 30;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  body: JSON.stringify(body),
});
const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Answer =>
  json(status, { type: `/problems/${code}`, title: code, status, code, traceId: 'abcdef0123456789abcdef0123456789', ...extra });
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const etag = (version: number): Record<string, string> => ({ ETag: `"${String(version)}"` });

const OPEN = new Set(['todo', 'in_progress', 'waiting', 'blocked']);

function baseList(server: OrderServer, orderId: string): { items: ProcedureBody[] } | undefined {
  const answer = answerProcedures(server, orderId);
  return answer.status === 200 ? (JSON.parse(answer.body) as { items: ProcedureBody[] }) : undefined;
}

function modelOf(server: OrderServer, state: EditingState, orderId: string): OrderModel | undefined {
  const existing = state.get(orderId);
  if (existing !== undefined) return existing;
  const base = baseList(server, orderId);
  if (base === undefined) return undefined;
  const model: OrderModel = {
    procedures: base.items.map((item) => item.id),
    stages: new Map(base.items.map((item) => [item.id, item.stages.map((stage) => stage.id)])),
    addedProcedures: new Map(),
    addedStages: new Map(),
    parentOf: new Map(base.items.flatMap((item) => item.stages.map((stage) => [stage.id, item.id] as const))),
    removedProcedures: new Map(),
    removedStages: new Map(),
    versions: new Map(),
    clock: 0,
  };
  state.set(orderId, model);
  return model;
}

const idAt = (id: string, n: number): string => `${id.slice(0, -4)}${String(n).padStart(4, '0')}`;
const timestamp = (model: OrderModel): string => `2026-10-14T10:${String(Math.min(59, ++model.clock)).padStart(2, '0')}:00.000Z`;
const versionOf = (model: OrderModel, id: string): number => model.versions.get(id) ?? 1;
const bump = (model: OrderModel, id: string): void => {
  model.versions.set(id, versionOf(model, id) + 1);
};

interface View {
  readonly procedures: Map<string, ProcedureBody>;
  readonly stages: Map<string, StageBody>;
}

/** Every object the model knows (base data where the base has it), positions as the model orders them. */
function viewOf(server: OrderServer, model: OrderModel, orderId: string): View {
  const base = baseList(server, orderId);
  const procedures = new Map<string, ProcedureBody>();
  const stages = new Map<string, StageBody>();
  for (const item of base?.items ?? []) {
    procedures.set(item.id, item);
    for (const stage of item.stages) stages.set(stage.id, stage);
  }
  for (const [id, added] of model.addedProcedures) {
    procedures.set(id, { id, code: added.code, name: added.name, position: 0, stages: [] });
  }
  for (const [id, added] of model.addedStages) {
    stages.set(id, {
      id,
      code: `custom_${id.slice(-12)}`,
      name: added.name,
      position: 0,
      status: 'todo',
      dueDate: added.dueDate,
      overdue: false,
      responsibleUser:
        added.responsibleUserId === null ? null : (server.assignable.find((entry) => entry.id === added.responsibleUserId) ?? null),
      waitingOn: null,
      waitingParty: null,
      waitingSince: null,
      waitingDays: null,
      blockedReason: null,
      startedAt: null,
      completedOn: null,
      version: 1,
    });
  }
  return { procedures, stages };
}

export function answerEditedProcedures(server: OrderServer, state: EditingState, orderId: string): Answer {
  const model = modelOf(server, state, orderId);
  if (model === undefined) return answerProcedures(server, orderId);
  const view = viewOf(server, model, orderId);
  const items = model.procedures.flatMap((id, index) => {
    const procedure = view.procedures.get(id);
    if (procedure === undefined) return [];
    const stages = (model.stages.get(id) ?? []).flatMap((stageId, stageIndex) => {
      const stage = view.stages.get(stageId);
      return stage === undefined ? [] : [{ ...stage, position: stageIndex + 1 }];
    });
    const counted = stages.filter((stage) => stage.status !== 'not_applicable');
    const current = stages.find((stage) => stage.status !== 'done' && stage.status !== 'not_applicable');
    return [
      {
        ...procedure,
        position: index + 1,
        version: versionOf(model, id),
        progress: { done: counted.filter((stage) => stage.status === 'done').length, total: counted.length },
        currentStageId: current?.id ?? null,
        stages,
      },
    ];
  });
  const open = items.flatMap((item) => item.stages).filter((stage) => OPEN.has(stage.status));
  return json(200, { items, openStageCount: open.length });
}

interface Input {
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly ifMatch: string | undefined;
  readonly raw: string;
}

const closed = (server: OrderServer, orderId: string): boolean => {
  const status = server.states.get(orderId)?.status ?? 'new';
  return status === 'settled' || status === 'cancelled';
};

/** The `If-Match` check of a delete and a restore: 428 without it, 400 for a bad form, 412 for a stale version. */
function checkVersion(ifMatch: string | undefined, current: number): Answer | undefined {
  if (ifMatch === undefined) return problem(428, 'precondition_required');
  const match = /^"(\d{1,9})"$/.exec(ifMatch);
  if (match === null) return problem(400, 'validation_failed', { errors: [{ pointer: '/headers/If-Match', code: 'invalid_format' }] });
  return Number(match[1]) === current ? undefined : problem(412, 'version_conflict');
}

const clamp = (position: unknown, length: number): number =>
  typeof position === 'number' && Number.isInteger(position) ? Math.max(1, Math.min(position, length + 1)) : length + 1;

function parse(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** `POST /work-orders/{id}/procedures`. */
export function answerCreateProcedure(server: OrderServer, state: EditingState, orderId: string, input: Input): Answer {
  if (input.role === 'read_only') return problem(403, 'forbidden');
  const model = modelOf(server, state, orderId);
  if (model === undefined) return problem(404, 'not_found');
  const body = parse(input.raw);
  const id = body?.['id'];
  const code = body?.['procedureTemplateCode'];
  if (typeof id !== 'string' || typeof code !== 'string') return problem(400, 'validation_failed');
  if (closed(server, orderId)) return problem(409, 'work_order_closed');
  const view = viewOf(server, model, orderId);
  if (view.procedures.has(id) || model.removedProcedures.has(id)) return problem(409, 'id_conflict');
  const template = PROCESSES.find((entry) => entry.code === code);
  if (template === undefined) return problem(422, 'template_unavailable');
  if (model.procedures.some((existing) => view.procedures.get(existing)?.code === code)) return problem(409, 'procedure_already_active');
  if (model.procedures.length >= LIMIT) return problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_procedures' }] });
  const position = clamp(body?.['position'], model.procedures.length);
  model.procedures.splice(position - 1, 0, id);
  model.addedProcedures.set(id, { code: template.code, name: template.name });
  const stageIds = template.stages.map((_name, index) => idAt(id, index + 1));
  model.stages.set(id, stageIds);
  template.stages.forEach((name, index) => {
    const stageId = stageIds[index] ?? '';
    model.parentOf.set(stageId, id);
    model.addedStages.set(stageId, { name, dueDate: null, responsibleUserId: null });
  });
  const created = JSON.parse(answerEditedProcedures(server, state, orderId).body) as { items: Array<{ id: string }> };
  return json(
    201,
    created.items.find((item) => item.id === id),
    etag(1),
  );
}

/** `POST /work-orders/{id}/procedures/{procedureId}/stages`. */
export function answerCreateStage(server: OrderServer, state: EditingState, orderId: string, procedureId: string, input: Input): Answer {
  if (input.role === 'read_only') return problem(403, 'forbidden');
  const model = modelOf(server, state, orderId);
  if (model === undefined || !model.procedures.includes(procedureId)) return problem(404, 'not_found');
  const body = parse(input.raw);
  const id = body?.['id'];
  const name = typeof body?.['name'] === 'string' ? body['name'].normalize('NFC').trim() : '';
  if (typeof id !== 'string') return problem(400, 'validation_failed');
  if (name === '' || name.length > 120)
    return problem(400, 'validation_failed', { errors: [{ pointer: '/name', code: name === '' ? 'required' : 'too_long' }] });
  if (closed(server, orderId)) return problem(409, 'work_order_closed');
  const view = viewOf(server, model, orderId);
  if (view.stages.has(id) || model.removedStages.has(id)) return problem(409, 'id_conflict');
  const dueDate = typeof body?.['dueDate'] === 'string' ? body['dueDate'] : null;
  if (dueDate !== null && (dueDate < '2000-01-01' || dueDate > '2100-12-31')) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/dueDate', code: 'out_of_range' }] });
  }
  const responsibleUserId = typeof body?.['responsibleUserId'] === 'string' ? body['responsibleUserId'] : null;
  if (responsibleUserId !== null && !server.assignable.some((entry) => entry.id === responsibleUserId)) {
    return problem(400, 'validation_failed', { errors: [{ pointer: '/responsibleUserId', code: 'assignee_unavailable' }] });
  }
  const stages = model.stages.get(procedureId) ?? [];
  if (stages.length >= LIMIT) return problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_stages' }] });
  stages.splice(clamp(body?.['position'], stages.length) - 1, 0, id);
  model.stages.set(procedureId, stages);
  model.parentOf.set(id, procedureId);
  model.addedStages.set(id, { name, dueDate, responsibleUserId });
  bump(model, procedureId);
  const created = JSON.parse(answerEditedProcedures(server, state, orderId).body) as { items: Array<{ stages: Array<{ id: string }> }> };
  return json(
    201,
    created.items.flatMap((item) => item.stages).find((stage) => stage.id === id),
    etag(1),
  );
}

/** `DELETE /work-orders/{id}/procedures/{procedureId}` and `…/procedure-stages/{stageId}`. */
export function answerDelete(
  server: OrderServer,
  state: EditingState,
  orderId: string,
  kind: 'procedure' | 'stage',
  id: string,
  input: Input,
): Answer {
  if (input.role === 'read_only') return problem(403, 'forbidden');
  const model = modelOf(server, state, orderId);
  if (model === undefined) return problem(404, 'not_found');
  const view = viewOf(server, model, orderId);
  const parent = kind === 'stage' ? model.parentOf.get(id) : undefined;
  const active =
    kind === 'procedure' ? model.procedures.includes(id) : parent !== undefined && (model.stages.get(parent) ?? []).includes(id);
  if (!active) return problem(404, 'not_found');
  const wrong = checkVersion(input.ifMatch, kind === 'procedure' ? versionOf(model, id) : (view.stages.get(id)?.version ?? 1));
  if (wrong !== undefined) return wrong;
  if (closed(server, orderId)) return problem(409, 'work_order_closed');
  if (kind === 'procedure') {
    const position = model.procedures.indexOf(id) + 1;
    model.procedures.splice(position - 1, 1);
    model.removedProcedures.set(id, { position, version: versionOf(model, id) + 1, deletedAt: timestamp(model) });
    bump(model, id);
  } else if (parent !== undefined) {
    const stages = model.stages.get(parent) ?? [];
    const position = stages.indexOf(id) + 1;
    stages.splice(position - 1, 1);
    model.removedStages.set(id, { position, version: (view.stages.get(id)?.version ?? 1) + 1, deletedAt: timestamp(model) });
    bump(model, parent);
  }
  return { status: 204, headers: {}, body: '' };
}

/** `POST …/restore` of a process or a stage (the Administrator only, no step-up). */
export function answerRestore(
  server: OrderServer,
  state: EditingState,
  orderId: string,
  kind: 'procedure' | 'stage',
  id: string,
  input: Input,
): Answer {
  if (input.role !== 'administrator') return problem(403, 'forbidden');
  const model = modelOf(server, state, orderId);
  const removed = kind === 'procedure' ? model?.removedProcedures.get(id) : model?.removedStages.get(id);
  if (model === undefined || removed === undefined) return problem(404, 'not_found');
  const wrong = checkVersion(input.ifMatch, removed.version);
  if (wrong !== undefined) return wrong;
  if (closed(server, orderId)) return problem(409, 'work_order_closed');
  const view = viewOf(server, model, orderId);
  if (kind === 'procedure') {
    const code = view.procedures.get(id)?.code;
    if (model.procedures.some((existing) => view.procedures.get(existing)?.code === code)) return problem(409, 'procedure_already_active');
    if (model.procedures.length >= LIMIT) return problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_procedures' }] });
    model.procedures.splice(clamp(removed.position, model.procedures.length) - 1, 0, id);
    model.removedProcedures.delete(id);
    model.versions.set(id, removed.version + 1);
  } else {
    const parent = model.parentOf.get(id) ?? '';
    if (!model.procedures.includes(parent)) return problem(409, 'parent_deleted');
    const stages = model.stages.get(parent) ?? [];
    if (stages.length >= LIMIT) return problem(422, 'limit_exceeded', { errors: [{ pointer: '', code: 'too_many_stages' }] });
    stages.splice(clamp(removed.position, stages.length) - 1, 0, id);
    model.removedStages.delete(id);
    bump(model, parent);
  }
  const list = JSON.parse(answerEditedProcedures(server, state, orderId).body) as {
    items: Array<{ id: string; stages: Array<{ id: string }> }>;
  };
  const restored =
    kind === 'procedure'
      ? list.items.find((item) => item.id === id)
      : list.items.flatMap((item) => item.stages).find((stage) => stage.id === id);
  return json(200, restored, etag(removed.version + 1));
}

/** `GET /work-orders/{id}/deleted-procedures` (the Administrator only): newest first, at most 100 of each kind. */
export function answerDeleted(server: OrderServer, state: EditingState, orderId: string, role: Input['role']): Answer {
  if (role !== 'administrator') return problem(403, 'forbidden');
  const model = modelOf(server, state, orderId);
  if (model === undefined) return problem(404, 'not_found');
  const view = viewOf(server, model, orderId);
  const newest = <T extends { deletedAt: string }>(items: T[]): T[] => [...items].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const procedures = newest(
    [...model.removedProcedures].map(([id, removed]) => ({
      id,
      code: text(view.procedures.get(id)?.code),
      name: text(view.procedures.get(id)?.name),
      position: removed.position,
      stageCount: (model.stages.get(id) ?? []).length,
      version: removed.version,
      deletedAt: removed.deletedAt,
    })),
  );
  const stages = newest(
    [...model.removedStages].map(([id, removed]) => {
      const parent = model.parentOf.get(id) ?? '';
      return {
        id,
        procedureId: parent,
        procedureName: text(view.procedures.get(parent)?.name),
        name: text(view.stages.get(id)?.name),
        position: removed.position,
        procedureDeleted: model.removedProcedures.has(parent),
        version: removed.version,
        deletedAt: removed.deletedAt,
      };
    }),
  );
  return json(200, {
    procedures: procedures.slice(0, 100),
    stages: stages.slice(0, 100),
    truncated: procedures.length > 100 || stages.length > 100,
  });
}

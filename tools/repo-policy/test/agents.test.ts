/**
 * Agent models and reasoning effort (EVM-074): every agent pins `model` and `effort` in its frontmatter (no `inherit`,
 * so the session's model and effort never leak into subagents), docs/process/workflow.md documents the same values,
 * and the deliver-story workflow applies a story's `model` to the implementers only.
 * EVM-075 adds the story `path` (lekka | pelna): the workflow, the skills and the process documents follow it.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT, filesBelow, list, read, record, text } from '../src/files.ts';

const MODELS = ['sonnet', 'opus'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const AGENTS = readdirSync(join(ROOT, '.claude/agents'))
  .filter((file) => file.endsWith('.md'))
  .map((file) => file.slice(0, -'.md'.length));

function frontmatter(markdown: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  return record(parse(match?.[1] ?? '') as unknown);
}

/** Text of a `## ` section: from the heading to the next `## ` heading. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`${heading}\n`);
  if (start < 0) return '';
  const rest = markdown.slice(start + heading.length + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Model pinned in each agent definition. */
const AGENT_MODELS = new Map(AGENTS.map((agent) => [agent, text(frontmatter(read(`.claude/agents/${agent}.md`))['model'])]));

/**
 * Problems of a story's `model` field: only sonnet or opus, and `sonnet` must not downgrade an owner or contributor
 * whose definition pins opus (solution-architect, security-engineer).
 */
function storyModelProblems(fields: Record<string, unknown>, agentModels: Map<string, string>): string[] {
  if (!('model' in fields)) return [];
  const model = text(fields['model']);
  if (!MODELS.includes(model)) return [`model "${model}" spoza ${MODELS.join(', ')}`];
  const implementers = [text(fields['owner']), ...list(fields['contributors']).map(text)];
  return model === 'sonnet'
    ? implementers.filter((agent) => agentModels.get(agent) === 'opus').map((agent) => `model sonnet obniża ${agent} (opus)`)
    : [];
}

/** Rows of the "Modele i effort agentów" table: agent name → model and effort (a row may list several agents). */
function documentedModels(): Map<string, { model: string; effort: string }> {
  const rows = new Map<string, { model: string; effort: string }>();
  for (const line of section(read('docs/process/workflow.md'), '## Modele i effort agentów').split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const model = (cells[2] ?? '').replaceAll('`', '');
    const effort = (cells[3] ?? '').replaceAll('`', '');
    for (const match of (cells[1] ?? '').matchAll(/`([a-z-]+)`/g)) rows.set(match[1] ?? '', { model, effort });
  }
  return rows;
}

describe('agent models and effort (EVM-074 AC1)', () => {
  it('EVM-074 AC1: every agent pins a model and an effort level — no inherit, no max', () => {
    expect(AGENTS.length).toBeGreaterThan(0);
    for (const agent of AGENTS) {
      const fields = frontmatter(read(`.claude/agents/${agent}.md`));
      expect(MODELS, `${agent}: model`).toContain(text(fields['model']));
      expect(EFFORTS, `${agent}: effort`).toContain(text(fields['effort']));
    }
  });

  it('EVM-074 AC1: the table in workflow.md matches every agent definition', () => {
    const documented = documentedModels();
    expect([...documented.keys()].sort()).toEqual([...AGENTS].sort());
    for (const agent of AGENTS) {
      const fields = frontmatter(read(`.claude/agents/${agent}.md`));
      expect(documented.get(agent), agent).toEqual({ model: text(fields['model']), effort: text(fields['effort']) });
    }
  });
});

interface Call {
  label: string;
  model: string | undefined;
  effort: unknown;
}
type Run = (
  args: unknown,
  agent: (prompt: string, opts: Record<string, unknown>) => Promise<unknown>,
  parallel: (thunks: (() => Promise<unknown>)[]) => Promise<unknown[]>,
  phase: (title: string) => void,
  log: (message: string) => void,
) => Promise<unknown>;

const temp = mkdtempSync(join(tmpdir(), 'evm-074-'));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** The saved workflow as an ES module: its `meta` literal plus the body wrapped in a function of the workflow globals. */
async function loadDeliverStory(): Promise<Run> {
  const source = read('.claude/workflows/deliver-story.js');
  const end = source.indexOf('\n}\n');
  if (end < 0) throw new Error('deliver-story.js: nie znaleziono końca literału meta (linia "}")');
  const metaEnd = end + '\n}\n'.length;
  const file = join(temp, 'deliver-story.mjs');
  writeFileSync(
    file,
    `${source.slice(0, metaEnd)}export default async function run(args, agent, parallel, phase, log) {\n${source.slice(metaEnd)}\n}\n`,
  );
  const loaded = (await import(pathToFileURL(file).href)) as { default: Run };
  return loaded.default;
}

const DONE = { status: 'done', summary: 'done', filesChanged: [], checks: 'green', questions: [] };
const QA = (pass: boolean): Record<string, unknown> => ({
  verdict: pass ? 'pass' : 'fail',
  acceptanceCriteria: [{ id: 'AC1', status: pass ? 'pass' : 'fail', evidence: 'synthetic' }],
  gatesPassed: true,
  gatesSummary: 'green',
  findings: [],
  howToVerify: '-',
});

/** Runs the workflow with stub agents: a plan that needs both consultations, one failed QA round (→ fixes), then a pass. */
async function deliver(extraArgs: Record<string, unknown>, calls: Call[]): Promise<Record<string, unknown>> {
  const run = await loadDeliverStory();
  let qaRounds = 0;
  const agent = (_prompt: string, opts: Record<string, unknown>): Promise<unknown> => {
    const label = text(opts['label']);
    calls.push({ label, model: typeof opts['model'] === 'string' ? opts['model'] : undefined, effort: opts['effort'] });
    if (label.startsWith('plan:')) {
      return Promise.resolve({
        status: 'ready',
        summary: 'plan',
        needsArchitectReview: true,
        needsUiSpec: false,
        securityRelevant: true,
        questions: [],
      });
    }
    if (label.startsWith('consult:')) return Promise.resolve({ verdict: 'approve', notes: '-', questions: [] });
    if (label.startsWith('impl:') || label.startsWith('fix:')) return Promise.resolve(DONE);
    if (label.startsWith('qa:')) {
      qaRounds += 1;
      return Promise.resolve(QA(qaRounds > 1));
    }
    return Promise.resolve({ verdict: 'approve', summary: '-', findings: [] });
  };
  const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> => Promise.all(thunks.map((thunk) => thunk()));
  const args = {
    storyId: 'EVM-999',
    storyPath: 'docs/backlog/M0/EVM-999-synthetic.md',
    branch: 'feature/EVM-999-synthetic',
    owner: 'devops-engineer',
    reviewers: ['code-reviewer', 'security-engineer'],
    ...extraArgs,
  };
  return record(
    await run(
      args,
      agent,
      parallel,
      () => undefined,
      () => undefined,
    ),
  );
}

const IMPLEMENTERS = /^(plan|impl|fix):/;
const REVIEWS = /^(code-reviewer|security-engineer):r\d+$/;

describe('model of a story delivery (EVM-074 AC2)', () => {
  it('EVM-074 AC2: model opus — implementers (plan, implementation, fixes) and reviews get it, QA and consultations do not', async () => {
    const calls: Call[] = [];
    const result = await deliver({ model: 'opus' }, calls);
    expect(result['status']).toBe('passed');
    expect(result['model']).toBe('opus');
    expect(calls.map((call) => call.label.split(':')[0])).toEqual(
      expect.arrayContaining(['plan', 'consult', 'impl', 'qa', 'code-reviewer', 'security-engineer', 'fix']),
    );
    for (const call of calls) {
      expect(call.model, call.label).toBe(IMPLEMENTERS.test(call.label) || REVIEWS.test(call.label) ? 'opus' : undefined);
      expect(call.effort, call.label).toBeUndefined();
    }
  });

  it('EVM-074 AC2: model sonnet — only the implementers get it; reviews are never downgraded', async () => {
    const calls: Call[] = [];
    const result = await deliver({ model: 'sonnet' }, calls);
    expect(result['status']).toBe('passed');
    for (const call of calls) {
      expect(call.model, call.label).toBe(IMPLEMENTERS.test(call.label) ? 'sonnet' : undefined);
      expect(call.effort, call.label).toBeUndefined();
    }
  });

  it('EVM-074 AC2: no model in the story — every agent keeps the model of its definition', async () => {
    const calls: Call[] = [];
    const result = await deliver({}, calls);
    expect(result['status']).toBe('passed');
    expect(result['model']).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.model, call.label).toBeUndefined();
      expect(call.effort, call.label).toBeUndefined();
    }
  });

  it('EVM-074 AC2: an unsupported model stops the workflow before any agent starts', async () => {
    const calls: Call[] = [];
    await expect(deliver({ model: 'gpt-4o' }, calls)).rejects.toThrow('nieobsługiwany model "gpt-4o" (dozwolone: sonnet, opus)');
    expect(calls).toEqual([]);
  });
});

describe('model field in the story process (EVM-074 AC3)', () => {
  it('EVM-074 AC3: the story template offers the model field with the default sonnet', () => {
    expect(frontmatter(read('docs/backlog/_template.md'))['model']).toBe('sonnet');
  });

  it('EVM-074 AC3: /deliver checks and passes the story model, /refine and DoR point to the opus criteria', () => {
    const deliver = read('.claude/skills/deliver/SKILL.md');
    expect(deliver).toContain('appUrl?, userNotes?, model?, path? }');
    expect(deliver).toContain('`model` (jeśli jest) ∈ {`sonnet`, `opus`}');
    expect(deliver).toContain('parametrem `model` narzędzia Agent');
    for (const path of ['.claude/skills/refine/SKILL.md', 'docs/process/definition-of-ready.md', 'docs/backlog/README.md']) {
      const content = read(path);
      for (const phrase of ['`model`', '`opus`', 'Modele i effort agentów']) expect(content, `${path}: ${phrase}`).toContain(phrase);
    }
    const rules = section(read('docs/process/workflow.md'), '## Modele i effort agentów');
    for (const phrase of ['uwierzytelniania', 'synchronizacji offline', 'migracji danych', 'nie zmienia effortu', 'obniżyłby']) {
      expect(rules, phrase).toContain(phrase);
    }
  });

  it('EVM-074 AC3: no story downgrades an opus agent — model only sonnet or opus, and sonnet never with an opus owner or contributor', () => {
    const stories = filesBelow('docs/backlog', (path) => /\/EVM-\d{3,}-[^/]+\.md$/.test(path));
    expect(stories.length).toBeGreaterThan(0);
    for (const story of stories) expect(storyModelProblems(frontmatter(read(story)), AGENT_MODELS), story).toEqual([]);
  });

  it('EVM-074 AC3: the story rule detects a downgrade and an unknown model (synthetic stories)', () => {
    const models = new Map([
      ['security-engineer', 'opus'],
      ['backend-developer', 'sonnet'],
    ]);
    expect(storyModelProblems({ owner: 'security-engineer', model: 'sonnet' }, models)).toEqual([
      'model sonnet obniża security-engineer (opus)',
    ]);
    expect(storyModelProblems({ owner: 'backend-developer', contributors: ['security-engineer'], model: 'sonnet' }, models)).toHaveLength(
      1,
    );
    expect(storyModelProblems({ owner: 'backend-developer', model: 'haiku' }, models)).toEqual(['model "haiku" spoza sonnet, opus']);
    expect(storyModelProblems({ owner: 'security-engineer', model: 'opus' }, models)).toEqual([]);
    expect(storyModelProblems({ owner: 'security-engineer' }, models)).toEqual([]);
  });
});

/** Stub agents for the path tests: `reviews` per label returns findings; QA always passes. */
interface Behaviour {
  reviews?: Record<string, Record<string, unknown>[]>;
}
async function deliverWith(
  extraArgs: Record<string, unknown>,
  labels: string[],
  behaviour: Behaviour = {},
): Promise<Record<string, unknown>> {
  const run = await loadDeliverStory();
  const agent = (_prompt: string, opts: Record<string, unknown>): Promise<unknown> => {
    const label = text(opts['label']);
    labels.push(label);
    if (label.startsWith('plan:')) {
      return Promise.resolve({
        status: 'ready',
        summary: 'plan',
        needsArchitectReview: true,
        needsUiSpec: false,
        securityRelevant: true,
        questions: [],
      });
    }
    if (label.startsWith('consult:')) return Promise.resolve({ verdict: 'approve', notes: '-', questions: [] });
    if (label.startsWith('impl:') || label.startsWith('fix:')) return Promise.resolve(DONE);
    if (label.startsWith('qa:')) return Promise.resolve(QA(true));
    const findings = behaviour.reviews?.[label] ?? [];
    const blocking = findings.some((finding) => finding['severity'] === 'major' || finding['severity'] === 'blocker');
    return Promise.resolve({ verdict: blocking ? 'changes_required' : 'approve', summary: '-', findings });
  };
  const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> => Promise.all(thunks.map((thunk) => thunk()));
  const args = {
    storyId: 'EVM-999',
    storyPath: 'docs/backlog/M0/EVM-999-synthetic.md',
    branch: 'feature/EVM-999-synthetic',
    owner: 'devops-engineer',
    reviewers: ['code-reviewer'],
    ...extraArgs,
  };
  return record(
    await run(
      args,
      agent,
      parallel,
      () => undefined,
      () => undefined,
    ),
  );
}

const MAJOR = { severity: 'major', area: 'infra', location: 'a.ts:1', issue: 'synthetic', fix: 'synthetic' };
const MINOR = { severity: 'minor', area: 'infra', location: 'a.ts:2', issue: 'synthetic', fix: 'synthetic' };

describe('story path in the workflow (EVM-075 AC2)', () => {
  it('EVM-075 AC2: lekka — one implementer and one review; no plan, consultations or QA; minor does not trigger anything', async () => {
    const labels: string[] = [];
    const result = await deliverWith({ path: 'lekka' }, labels, { reviews: { 'code-reviewer:r1': [MINOR] } });
    expect(labels).toEqual(['impl:devops-engineer', 'code-reviewer:r1']);
    expect(result['status']).toBe('passed');
    expect(result['path']).toBe('lekka');
    expect(result['rounds']).toBe(1);
    expect(result['qa']).toBeNull();
    expect(result['nonBlocking']).toHaveLength(1);
  });

  it('EVM-075 AC2: lekka — a major finding gets one round of fixes without re-review and ends as fixed', async () => {
    const labels: string[] = [];
    const result = await deliverWith({ path: 'lekka' }, labels, { reviews: { 'code-reviewer:r1': [MAJOR] } });
    expect(labels).toEqual(['impl:devops-engineer', 'code-reviewer:r1', 'fix:devops-engineer:r1']);
    expect(result['status']).toBe('fixed');
    expect(result['openBlocking']).toEqual([]);
    expect(list(result['unverifiedFixes'])).toHaveLength(1);
  });

  it('EVM-075 AC2: lekka needs exactly one reviewer and an unknown path stops the workflow before any agent starts', async () => {
    const labels: string[] = [];
    await expect(deliverWith({ path: 'lekka', reviewers: ['code-reviewer', 'security-engineer'] }, labels)).rejects.toThrow(
      'ścieżka lekka wymaga dokładnie jednego recenzenta',
    );
    await expect(deliverWith({ path: 'ekspresowa' }, labels)).rejects.toThrow(
      'nieobsługiwana ścieżka "ekspresowa" (dozwolone: lekka, pelna)',
    );
    expect(labels).toEqual([]);
  });

  it('EVM-075 AC2: pelna and a missing path run the full flow (plan, consultations, QA, all reviewers)', async () => {
    for (const extra of [{ path: 'pelna' }, {}]) {
      const labels: string[] = [];
      const result = await deliverWith({ ...extra, reviewers: ['code-reviewer', 'security-engineer'] }, labels);
      expect(result['status']).toBe('passed');
      expect(result['path']).toBe('pelna');
      expect(labels).toEqual(
        expect.arrayContaining([
          'plan:devops-engineer',
          'consult:solution-architect',
          'consult:security-engineer',
          'impl:devops-engineer',
          'qa:r1',
          'code-reviewer:r1',
          'security-engineer:r1',
        ]),
      );
    }
  });

  it('EVM-075 AC2: pelna — in the next round only the reviewers who reported blocker/major review again', async () => {
    const labels: string[] = [];
    const result = await deliverWith({ reviewers: ['code-reviewer', 'security-engineer'] }, labels, {
      reviews: { 'security-engineer:r1': [MAJOR] },
    });
    expect(result['status']).toBe('passed');
    expect(result['rounds']).toBe(2);
    expect(labels).toContain('security-engineer:r2');
    expect(labels).not.toContain('code-reviewer:r2');
    expect(labels).toContain('qa:r2');
    expect(
      list(result['reviews'])
        .map((review) => text(record(review)['reviewer']))
        .sort(),
    ).toEqual(['code-reviewer', 'security-engineer']);
  });
});

describe('lighter process in documents (EVM-075 AC1, AC3, AC4, AC6)', () => {
  it('EVM-075 AC1: workflow.md describes both paths, their criteria and the escalation', () => {
    const paths = section(read('docs/process/workflow.md'), '## Ścieżki realizacji');
    for (const phrase of [
      'LEKKA',
      'PEŁNA',
      '`path`',
      'Brak pola = `pelna`',
      'uwierzytelnianie',
      'synchronizacja offline',
      'migracje danych',
      'infrastruktura produkcyjna',
      'płatności',
      'dane osobowe',
      'uprawnienia',
      'Eskalacja ścieżki',
    ]) {
      expect(paths, phrase).toContain(phrase);
    }
  });

  it('EVM-075 AC1: /refine proposes the path, /deliver proposes it for stories without one and passes it to the workflow', () => {
    expect(read('.claude/skills/refine/SKILL.md')).toContain('`path`');
    const deliver = read('.claude/skills/deliver/SKILL.md');
    for (const phrase of ['`path` ∈ {`lekka`, `pelna`}', 'Brak pola → zaproponuj ścieżkę', '`fixed`', 'wpis „Koszt”'])
      expect(deliver, phrase).toContain(phrase);
    for (const path of ['docs/process/definition-of-ready.md', 'docs/backlog/README.md']) expect(read(path), path).toContain('`path`');
  });

  it('EVM-075 AC1: every story with a path field uses lekka or pelna', () => {
    for (const story of filesBelow('docs/backlog', (path) => /\/EVM-\d{3,}-[^/]+\.md$/.test(path))) {
      const fields = frontmatter(read(story));
      if ('path' in fields) expect(['lekka', 'pelna'], story).toContain(text(fields['path']));
    }
    expect(['lekka', 'pelna']).toContain(text(frontmatter(read('docs/backlog/_template.md'))['path']));
  });

  it('EVM-075 AC3: the story template is short and keeps plans and consultations out of the story file', () => {
    const template = read('docs/backlog/_template.md');
    expect(Buffer.byteLength(template)).toBeLessThanOrEqual(6144);
    for (const heading of [
      '## Cel',
      '## Kryteria akceptacji',
      '## Poza zakresem',
      '## Decyzje i ograniczenia',
      '## Notatki',
      '## Dziennik',
    ]) {
      expect(template, heading).toContain(`${heading}\n`);
    }
    for (const gone of ['## Plan techniczny', '## Definition of Done', '## Uwagi do rozważenia'])
      expect(template, gone).not.toContain(gone);
    const paths = section(read('docs/process/workflow.md'), '## Ścieżki realizacji');
    for (const phrase of [
      'Konsultacje proporcjonalne do ryzyka',
      'Low w narzędziach wewnętrznych',
      '„Notatek”',
      'Co zostaje poza plikiem historyjki',
    ]) {
      expect(paths, phrase).toContain(phrase);
    }
  });

  it('EVM-075 AC4: CLAUDE.md stays small and every agent reads selectively', () => {
    expect(Buffer.byteLength(read('CLAUDE.md'))).toBeLessThanOrEqual(10240);
    for (const agent of AGENTS) expect(read(`.claude/agents/${agent}.md`), agent).toContain('Czytaj wybiórczo');
    expect(section(read('docs/process/workflow.md'), '## Zespół agentów')).toContain('`code-reviewer`');
  });

  it('EVM-075 AC6: workflow.md holds the cost baseline and targets', () => {
    const cost = section(read('docs/process/workflow.md'), '## Pomiar kosztu');
    for (const phrase of ['EVM-013', '$59', 'lekka ≤ $12', 'pełna ≤ $30', 'Koszt']) expect(cost, phrase).toContain(phrase);
  });
});

/**
 * Agent models and reasoning effort (EVM-074): every agent pins `model` and `effort` in its frontmatter (no `inherit`,
 * so the session's model and effort never leak into subagents), docs/process/workflow.md documents the same values,
 * and the deliver-story workflow applies a story's `model` to the implementers only.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT, read, record, text } from '../src/files.ts';

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
  const metaEnd = source.indexOf('\n}\n') + '\n}\n'.length;
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
    calls.push({ label, model: typeof opts['model'] === 'string' ? opts['model'] : undefined });
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

const IMPLEMENTERS = /^(plan|impl|fix):/;

describe('model of a story delivery (EVM-074 AC2)', () => {
  it('EVM-074 AC2: model from the story — implementers (plan, implementation, fixes) get it, QA, reviews and consultations do not', async () => {
    const calls: Call[] = [];
    const result = await deliver({ model: 'opus' }, calls);
    expect(result['status']).toBe('passed');
    expect(result['model']).toBe('opus');
    expect(calls.map((call) => call.label.split(':')[0])).toEqual(
      expect.arrayContaining(['plan', 'consult', 'impl', 'qa', 'code-reviewer', 'fix']),
    );
    for (const call of calls) {
      expect(call.model, call.label).toBe(IMPLEMENTERS.test(call.label) ? 'opus' : undefined);
    }
  });

  it('EVM-074 AC2: no model in the story — every agent keeps the model of its definition', async () => {
    const calls: Call[] = [];
    const result = await deliver({}, calls);
    expect(result['status']).toBe('passed');
    expect(result['model']).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.model, call.label).toBeUndefined();
  });

  it('EVM-074 AC2: an unsupported model stops the workflow before any agent starts', async () => {
    const calls: Call[] = [];
    await expect(deliver({ model: 'gpt-4o' }, calls)).rejects.toThrow('nieobsługiwany model "gpt-4o" (dozwolone: sonnet, opus)');
    expect(calls).toEqual([]);
  });
});

describe('model field in the story workflow (EVM-074 AC3)', () => {
  it('EVM-074 AC3: the story template offers the model field with the default sonnet', () => {
    expect(frontmatter(read('docs/backlog/_template.md'))['model']).toBe('sonnet');
  });

  it('EVM-074 AC3: /deliver passes the story model to the workflow and /refine proposes it', () => {
    expect(read('.claude/skills/deliver/SKILL.md')).toContain('appUrl?, userNotes?, model? }');
    expect(read('.claude/skills/refine/SKILL.md')).toContain('`model`');
    expect(read('docs/process/definition-of-ready.md')).toContain('`model`');
  });
});

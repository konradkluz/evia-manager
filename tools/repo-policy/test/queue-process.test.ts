/**
 * Queue process and the Linux E2E service (EVM-087 AC1–AC6): the process documents, the skill, the workflow and
 * compose.yaml say what the story requires.
 */
import { describe, expect, it } from 'vitest';
import { composeProblems } from '../src/compose.ts';
import { exists, json, list, read, record, text, yaml } from '../src/files.ts';
import { agentPermissionProblems } from '../src/workflows.ts';

const workflow = read('docs/process/workflow.md');
const queues = workflow.slice(workflow.indexOf('## Kolejki historyjek'), workflow.indexOf('## Cykl realizacji historyjki'));
const compose = record(yaml('compose.yaml'));
const e2e = record(record(compose['services'])['web-e2e-linux']);

describe('queues of stories (EVM-087)', () => {
  it('EVM-087 AC1: dependent stories share one branch, one PR and one CI run; stacked branches are forbidden everywhere', () => {
    expect(queues).toContain('jednej gałęzi od `main`, w jednym PR i jednym przebiegu CI z E2E');
    expect(queues).toContain('Gałęzie stacked');
    expect(queues).toContain('feature/EVM-042-043-opis');
    expect(queues).toContain('feature/queue-YYYY-MM-DD-opis');
    expect(queues).toContain('rebase merge');
    for (const path of ['docs/process/conventions.md', '.claude/skills/deliver/SKILL.md']) {
      const content = read(path);
      expect(content, path).toContain('stacked');
      expect(content, path).toContain('feature/EVM-042-043-opis');
    }
    expect(read('docs/process/conventions.md')).toContain('Rebase and merge');
    expect(read('docs/ops/github-i-ci.md')).toContain('Allow rebase merging');
  });

  it('EVM-087 AC2: independent stories get own branches in separate clones; overlapping files make them dependent', () => {
    expect(queues).toContain('własną gałąź od `main`, własny PR i pełne CI');
    expect(queues).toContain('git clone --no-local');
    expect(queues).toContain('nie w `git worktree`');
    expect(queues).toContain('Nakładające się zakresy plików = zależne');
    expect(workflow).not.toContain('albo w osobnych worktree');
  });

  it('EVM-087 AC3: the path comes from the risk table with one question per queue; a silent pelna is forbidden', () => {
    expect(queues).toContain('tylko z powodu liczby recenzentów');
    expect(queues).toContain('jedno pytanie dla całej kolejki');
    const skill = read('.claude/skills/deliver/SKILL.md');
    expect(skill).toContain('Cichy zapis `pelna` bez pytania jest zabroniony');
    expect(skill).toContain('jedno pytanie dla całej kolejki');
    expect(read('.claude/workflows/deliver-story.js')).toContain('bez cichego zapisu pelna');
  });

  it('EVM-087 AC5: diff-coverage covers the whole branch (merge-base), described in the tool and the testing strategy', () => {
    expect(read('tools/diff-coverage/README.md')).toContain('obejmuje **całą gałąź**');
    expect(read('tools/diff-coverage/README.md')).toContain('`git merge-base HEAD origin/main`');
    expect(read('docs/process/testing-strategy.md')).toContain('dotyczy całej gałęzi');
  });

  it('EVM-087 AC6: sonnet by default, consultations only on risk, one session per queue, queue cost in the Journal', () => {
    expect(queues).toContain('Wykonawcy domyślnie `sonnet`');
    expect(queues).toContain('konsultacje przed implementacją tylko gdy plan lub tabela ryzyka wskazuje ryzyko');
    expect(queues).toContain('jedna sesja obsługuje jedną kolejkę');
    expect(queues).toContain('Koszt całej kolejki');
    expect(workflow).toContain('całej kolejki');
  });
});

describe('web-e2e-linux service (EVM-087 AC4)', () => {
  const dockerfile = (context: string, name: string): string | null => (exists(`${context}/${name}`) ? read(`${context}/${name}`) : null);

  it('EVM-087 AC4: the service passes the compose.yaml hardening rules (digest, read-only, no caps, no ports, non-root)', () => {
    expect(composeProblems(compose, read('compose.yaml'), dockerfile)).toEqual([]);
    expect(e2e['read_only']).toBe(true);
    expect(e2e['cap_drop']).toEqual(['ALL']);
    expect(e2e['network_mode']).toBeUndefined();
    expect(e2e['networks']).toEqual(['web-e2e']);
    expect(record(record(compose['networks'])['web-e2e'])['internal']).toBe(true);
    expect(e2e['ports']).toBeUndefined();
    expect(e2e['env_file']).toBeUndefined();
    expect(e2e['ipc']).toBeUndefined();
    expect(e2e['shm_size']).toBe('1gb');
    expect(text(e2e['user'])).toBe('1000:1000');
    expect(read('compose.yaml')).not.toMatch(/docker\.sock/);
  });

  it('EVM-087 AC4: the image pins the Playwright base by digest and its tag equals @playwright/test; source mounts are read-only', () => {
    const image = read('infra/docker/web-e2e/Dockerfile');
    const version = text(record(record(json('apps/web/package.json'))['devDependencies'])['@playwright/test']);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(image).toContain(`FROM mcr.microsoft.com/playwright:v${version}-noble@sha256:`);
    expect(image).toMatch(/^FROM mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}$/m);
    expect(
      image
        .split('\n')
        .filter((line) => line.startsWith('FROM '))
        .every((line) => /@sha256:[0-9a-f]{64}/.test(line)),
    ).toBe(true);
    expect(image).not.toMatch(/\b(apt-get|curl|wget)\b/);
    expect(image).toMatch(/^USER 1000:1000$/m);
    for (const volume of list(e2e['volumes'])
      .map(String)
      .filter((entry) => entry.startsWith('./')))
      expect(volume, volume).toMatch(/:ro$/);
  });

  it('EVM-087 AC4: workflow, CI runbook and CLAUDE.md name the step before a push and the differences from CI', () => {
    const command = 'docker compose -f compose.yaml run --rm web-e2e-linux';
    for (const path of ['docs/process/workflow.md', 'docs/ops/github-i-ci.md', 'CLAUDE.md']) expect(read(path), path).toContain(command);
    const runbook = read('docs/ops/github-i-ci.md');
    expect(runbook).toContain('Różnice względem CI');
    expect(runbook).toContain('dowodem lokalnym wg ADR-0015');
    expect(runbook).toContain('nie dla samej dokumentacji ani `apps/api`');
    expect(json('package.json')).toHaveProperty('scripts.e2e:linux');
  });

  it('EVM-087 AC4: agent permissions list no unknown Docker service (the new service is a compose.yaml service)', () => {
    const services = Object.keys(record(compose['services']));
    expect(services).toContain('web-e2e-linux');
    expect(agentPermissionProblems(json('.claude/settings.json'), services)).toEqual([]);
  });
});

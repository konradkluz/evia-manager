/**
 * Instructions for people and agents (EVM-006 AC1, AC7; W5): README quick start, CLAUDE.md "Stack i komendy",
 * testing-strategy.md "Narzędzia" and the merge procedure for GitHub Free (D2).
 */
import { describe, expect, it } from 'vitest';
import { json, read, record } from '../src/files.ts';

const scripts = record(record(json('package.json'))['scripts']);

/** Text of a Markdown section: from the heading to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 2;
  const start = markdown.indexOf(`${heading}\n`);
  if (start < 0) return '';
  const rest = markdown.slice(start + heading.length + 1);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next < 0 ? rest : rest.slice(0, next);
}

/** Every `pnpm run <script>` mentioned in the text exists in the root package.json (a name ending with `:` is a family of future scripts). */
function missingScripts(markdown: string): string[] {
  return [...markdown.matchAll(/pnpm run ([\w:-]+)/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => !name.endsWith(':') && !(name in scripts));
}

describe('README quick start (EVM-006 AC1)', () => {
  const readme = section(read('README.md'), '## Szybki start');

  it('EVM-006 AC1: from a clean clone — requirements, install, backend-install, gate, build and scans', () => {
    for (const command of [
      'git clone',
      'pnpm install',
      'docker compose -f compose.yaml run --rm backend-install',
      'pnpm run gate',
      'pnpm run build',
      'pnpm run scan',
    ]) {
      expect(readme, command).toContain(command);
    }
    for (const requirement of ['Node.js 26', 'pnpm 12', 'Docker Desktop', 'Git']) expect(readme, requirement).toContain(requirement);
    expect(missingScripts(readme)).toEqual([]);
    expect(read('README.md')).not.toContain('Instrukcja uruchomienia pojawi się po EVM-006');
  });
});

describe('CLAUDE.md → Stack i komendy (EVM-006 AC7)', () => {
  const stack = section(read('CLAUDE.md'), '## Stack i komendy');

  it('EVM-006 AC7: install, run, tests, lint, types, coverage, E2E, scans and the gate are listed', () => {
    for (const label of ['Instalacja', 'Uruchomienie', 'Testy', 'Lint', 'Typy', 'Pokrycie', 'E2E', 'Skany', 'Bramka']) {
      expect(stack, label).toContain(`${label}:`);
    }
    expect(missingScripts(stack)).toEqual([]);
    expect(stack).not.toContain('_TBD_');
  });

  it('EVM-006 AC7: backend commands use the container form; npm install is forbidden; documentation commands stay', () => {
    expect(stack).toContain('docker compose -f compose.yaml run --rm backend-tests pnpm run gate:backend');
    expect(stack).toContain('docker compose -f compose.yaml run --rm backend-install');
    expect(stack).toContain('npm install');
    for (const command of ['npm run docs:check', 'npm run test:tools', 'npm run docs:cleanup']) expect(stack, command).toContain(command);
  });
});

describe('testing strategy and process (EVM-006 AC3, AC7; D2, W5)', () => {
  it('EVM-006 AC7: testing-strategy.md → Narzędzia names the tools, commands and the threshold for shared packages and tools', () => {
    const strategy = read('docs/process/testing-strategy.md');
    const tools = section(strategy, '## Narzędzia');
    for (const name of [
      'Vitest',
      'node:test',
      'evia-node-test',
      'diff-coverage',
      'backend-tests',
      'Playwright',
      'Maestro',
      'pnpm run gate',
      'pnpm run coverage:diff',
    ]) {
      expect(tools, name).toContain(name);
    }
    expect(tools).not.toContain('Do uzupełnienia');
    expect(section(strategy, '## Progi (bramki CI — spadek blokuje merge)')).toMatch(/Pakiety współdzielone i `tools\/`\s*\|\s*≥ 90%/);
  });

  it('EVM-006 AC4 (D2, W5): conventions — every change reaches main through a PR; allowed IDs in the squash title', () => {
    const git = section(read('docs/process/conventions.md'), '## Git');
    for (const fragment of [
      'Squash and merge',
      '[EVM-###]',
      '[renovate]',
      '[M#]',
      'git merge --ff-only origin/main',
      'docs/ops/github-i-ci.md',
    ]) {
      expect(git, fragment).toContain(fragment);
    }
  });

  it('EVM-006 AC4 (D2): /deliver and /milestone close merge through a PR clicked by Konrad', () => {
    expect(read('.claude/skills/deliver/SKILL.md')).toContain('git merge --ff-only origin/main');
    expect(section(read('.claude/skills/milestone/SKILL.md'), '## Tryb `close`')).toContain('[M#]');
  });
});

describe('README „Uruchomienie lokalne” (EVM-077 AC8)', () => {
  const readme = section(read('README.md'), '## Uruchomienie lokalne');

  it('EVM-077 AC8: requirements, dev:init, dev, activation, addresses, dev:stop, dev:reset with the warning, and typical problems', () => {
    expect(readme.length).toBeGreaterThan(500);
    for (const fragment of [
      'Docker Desktop',
      'terminal interaktywny',
      'pnpm run dev:init',
      'pnpm run dev',
      'http://localhost:5173',
      '127.0.0.1',
      'pnpm run dev:stop',
      'pnpm run dev:reset',
      'nieodwracalna',
      'dev:seed',
      'Typowe problemy',
      'compose.yaml',
    ])
      expect(readme.toLowerCase(), fragment).toContain(fragment.toLowerCase());
    expect(missingScripts(readme)).toEqual([]);
  });

  it('EVM-077 AC8: the first steps keep working — init before dev, activation before the demo data, stop before reset', () => {
    const order = ['pnpm run dev:init', 'pnpm run dev`', '**Aktywacja:**', '**Dane demo', 'pnpm run dev:stop', 'pnpm run dev:reset'].map(
      (marker) => readme.indexOf(marker),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('EVM-077 AC8: CLAUDE.md points to the local commands and says that an agent does not run them (the file stays small)', () => {
    const claude = read('CLAUDE.md');
    for (const fragment of ['pnpm run dev:init', 'pnpm run dev', 'Uruchomienie lokalne', 'agent ich nie uruchamia'])
      expect(claude, fragment).toContain(fragment);
  });
});

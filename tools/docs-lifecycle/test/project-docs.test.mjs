// @ts-check
/**
 * Tests on the real repository (finding J): read-only, no fixed numbers of files or warnings.
 * Numbers per class belong to the delivery report and the story log, not to assertions.
 * Permanent invariants only: the milestone list may grow and EVM-006 takes over the root package.json.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyze } from '../lib/analyze.mjs';
import { loadConfig } from '../lib/config.mjs';
import { todayInZone } from '../lib/dates.mjs';
import { loadRepository } from '../lib/repository.mjs';
import { parsePolicyRules, section } from './helpers/markdown.mjs';

const config = loadConfig();
const repository = loadRepository({ cwd: fileURLToPath(new URL('.', import.meta.url)), env: process.env, config });
const analysis = analyze(repository, { config, today: todayInZone(new Date()) });

/** @param {string} path */
const read = (path) => {
  const text = repository.read(path);
  assert.ok(text !== null, `brak pliku ${path}`);
  return text;
};

const POLICY = 'docs/process/document-lifecycle.md';

describe('prawdziwe repozytorium — klasyfikacja (EVM-012 AC2)', () => {
  it('EVM-012 AC2: walidator na repozytorium kończy się wynikiem „0 błędów”', () => {
    const errors = analysis.findings.filter((finding) => finding.severity === 'error');
    assert.deepEqual(
      errors.map((finding) => `${finding.code} ${finding.path}: ${finding.reason}`),
      [],
    );
  });

  it('EVM-012 AC2: każdy plik .md ma określoną klasę', () => {
    assert.ok(analysis.files.length > 0);
    assert.deepEqual(
      analysis.files.filter((file) => file.class === null).map((file) => file.path),
      [],
    );
  });

  it('EVM-012 AC2: lista kamieni milowych z roadmapy i katalogów backlogu zawiera M0–M7 (ustalenie E)', () => {
    // Containment, not equality: a new milestone in the roadmap must not break this test.
    for (const milestone of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']) {
      assert.ok(analysis.milestones.includes(milestone), milestone);
    }
  });
});

describe('polityka cyklu życia (EVM-012 AC1)', () => {
  const policy = read(POLICY);

  it('EVM-012 AC1: polityka zawiera klasy, oznaczanie, lokalizacje, pliki robocze, archiwizację, decyzje i walidator', () => {
    for (const heading of [
      '## Klasy cyklu życia',
      '## Oznaczanie klasy',
      '## Dozwolone lokalizacje',
      '## Pliki robocze',
      '## Archiwizacja a usunięcie',
      '## Kto i kiedy decyduje',
      '## Walidator i raport sprzątania',
      '## Zmiana polityki',
    ]) {
      assert.ok(section(policy, heading), `brak sekcji ${heading}`);
    }
    const classes = String(section(policy, '## Klasy cyklu życia'));
    for (const value of ['permanent', 'living', 'milestone', 'ephemeral']) assert.ok(classes.includes(`\`${value}\``), value);
    const decisions = String(section(policy, '## Kto i kiedy decyduje'));
    for (const role of ['| Konrad |', '| Orkiestrator |', '| Agenci |', '| Walidator i raport |'])
      assert.ok(decisions.includes(role), role);
  });

  it('EVM-012 AC1: polityka podlinkowana z docs/README.md i z docs/process/conventions.md → „Dokumentacja”', () => {
    assert.ok(read('docs/README.md').includes('process/document-lifecycle.md'));
    assert.ok(String(section(read('docs/process/conventions.md'), '## Dokumentacja')).includes('document-lifecycle.md'));
  });

  it('EVM-012 AC1: tabela reguł w polityce = konfiguracja walidatora (wzorce, klasa, osierocony, kolejność)', () => {
    const fromConfig = [...config.rules, config.defaultRule].map((rule) => ({
      id: rule.id,
      patterns: rule.patterns.map((pattern) => pattern.source),
      class: rule.class,
      orphanCheck: rule.orphanCheck,
    }));
    assert.deepEqual(parsePolicyRules(policy), fromConfig);
  });

  it('EVM-012 AC1: polityka podaje polecenia walidatora w formie bezpiecznej dla PowerShell', () => {
    const commands = String(section(policy, '## Walidator i raport sprzątania'));
    for (const command of [
      'npm run docs:check',
      'npm run docs:cleanup -- M#',
      'npm run test:tools',
      'node tools/docs-lifecycle/cli.mjs check --list',
      "'--'",
    ]) {
      assert.ok(commands.includes(command), command);
    }
  });
});

describe('polecenia npm (EVM-012 AC3, AC8)', () => {
  const manifest = JSON.parse(read('package.json'));

  it('EVM-012 AC3: jedno polecenie walidatora, raportu i testów; progi pokrycia 90% linii i gałęzi', () => {
    assert.equal(manifest.scripts['docs:check'], 'node tools/docs-lifecycle/cli.mjs check');
    assert.equal(manifest.scripts['docs:cleanup'], 'node tools/docs-lifecycle/cli.mjs cleanup-report');
    const test = manifest.scripts['test:tools'];
    for (const part of [
      '--experimental-test-coverage',
      '--test-coverage-lines=90',
      '--test-coverage-branches=90',
      '"tools/**/*.test.mjs"',
    ]) {
      assert.ok(test.includes(part), part);
    }
  });

  // Permanent invariants only. The temporary state until EVM-006 (no dependencies, `type`, `packageManager`,
  // `.npmrc` or pnpm lockfile; `engines.node` >=22.15.0) is checked in review, not here: EVM-006 changes it
  // (pnpm + Turborepo, ADR-0012; Node 26, ADR-0002) without touching this test.
  it('EVM-012 AC3: package.json prywatny; bez package-lock.json i yarn.lock w repozytorium (pnpm wg ADR-0012)', () => {
    assert.equal(manifest.private, true);
    for (const path of ['package-lock.json', 'yarn.lock']) {
      assert.ok(!repository.paths.includes(path), path);
    }
  });
});

describe('sprzątanie w /milestone close i zasady dla agentów (EVM-012 AC7, AC8)', () => {
  it('EVM-012 AC7: tryb close w SKILL.md ma krok „Sprzątanie dokumentacji” z raportem i zapisem w retrospektywie', () => {
    const close = String(section(read('.claude/skills/milestone/SKILL.md'), '## Tryb `close`'));
    for (const anchor of [
      'Sprzątanie dokumentacji',
      'npm run docs:cleanup',
      'docs/process/retros/<M#>.md',
      'expires',
      'npm run docs:check',
    ]) {
      assert.ok(close.includes(anchor), anchor);
    }
  });

  it('EVM-012 AC7: CLAUDE.md — bez decyzji Konrada dokumenty nie są usuwane ani przenoszone', () => {
    const safety = String(section(read('CLAUDE.md'), '## Bezpieczeństwo pracy agentów'));
    assert.ok(safety.includes('bez decyzji Konrada'));
    assert.ok(safety.includes('/milestone close'));
    assert.ok(safety.includes('.scratch/'));
  });

  it('EVM-012 AC8: CLAUDE.md wskazuje politykę i polecenia walidatora', () => {
    const claude = read('CLAUDE.md');
    for (const anchor of [POLICY, '.scratch/', '/milestone close', 'npm run docs:check', 'npm run docs:cleanup', 'npm run test:tools']) {
      assert.ok(claude.includes(anchor), anchor);
    }
  });

  it('EVM-012 AC8: każda definicja agenta ma akapit „Dokumenty i pliki robocze” przed „Granice”', () => {
    const agents = analysis.files.map((file) => file.path).filter((path) => /^\.claude\/agents\/[^/]+\.md$/.test(path));
    assert.ok(agents.length > 0);
    for (const path of agents) {
      const text = read(path);
      const documents = section(text, '# Dokumenty i pliki robocze');
      assert.ok(documents, `${path}: brak sekcji`);
      assert.ok(text.indexOf('# Dokumenty i pliki robocze') < text.indexOf('# Granice'), `${path}: kolejność sekcji`);
      for (const anchor of [POLICY, '.scratch/', 'npm run docs:check']) assert.ok(documents.includes(anchor), `${path}: ${anchor}`);
    }
  });

  it('EVM-012 AC8: .scratch/ jest ignorowany przez git; DoD wymaga npm run docs:check', () => {
    assert.equal(repository.scratchIgnored, true);
    assert.ok(read('.gitignore').split(/\r?\n/).includes('.scratch/'));
    assert.ok(read('docs/process/definition-of-done.md').includes('npm run docs:check'));
  });
});

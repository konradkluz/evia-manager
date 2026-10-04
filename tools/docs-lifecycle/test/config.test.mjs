// @ts-check
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CONFIG_FILE, loadConfig, matchRule, parseConfig } from '../lib/config.mjs';
import { ToolError } from '../lib/errors.mjs';

/** Minimal valid raw configuration (synthetic) used to test validation. */
function rawConfig() {
  return {
    policy: 'docs/process/document-lifecycle.md',
    scratchDir: '.scratch',
    roadmap: { path: 'docs/product/roadmap.md', section: 'Przegląd' },
    milestoneDirPattern: 'docs/backlog/<M#>/**',
    storyPattern: 'docs/backlog/<M#>/<EVM-ID>-*.md',
    spikesDir: 'spikes',
    rules: [
      { id: 1, patterns: ['README.md'], class: 'living', orphanCheck: false },
      { id: 2, patterns: ['docs/qa/<EVM-ID>/**/*.md'], class: 'milestone', milestoneFrom: 'story', orphanCheck: false },
      { id: 3, patterns: ['spikes/<nazwa>/**/*.md'], class: 'milestone', milestoneFrom: 'spike', orphanCheck: false },
      { id: 4, patterns: ['docs/notes/**/*.md'], class: 'lifecycle', milestoneFrom: 'field', orphanCheck: true },
    ],
    defaultRule: { class: 'forbidden' },
  };
}

/**
 * @param {(raw: any) => void} mutate
 * @param {RegExp} message
 */
function assertInvalid(mutate, message) {
  const raw = rawConfig();
  mutate(raw);
  assert.throws(
    () => parseConfig(raw),
    (error) => error instanceof ToolError && message.test(error.message),
  );
}

describe('konfiguracja reguł lokalizacji (EVM-012)', () => {
  const config = loadConfig();

  it('EVM-012 AC1: konfiguracja zawiera 17 reguł w kolejności z polityki i regułę domyślną „niedozwolone”', () => {
    assert.deepEqual(
      config.rules.map((rule) => rule.id),
      Array.from({ length: 17 }, (_, index) => index + 1),
    );
    assert.equal(config.defaultRule.class, 'forbidden');
    assert.equal(config.defaultRule.id, null);
    assert.equal(config.policy, 'docs/process/document-lifecycle.md');
    assert.equal(config.scratchDir, '.scratch');
    assert.equal(config.spikesDir, 'spikes');
  });

  it('EVM-012 AC2: każdy rodzaj istniejącego dokumentu dostaje klasę z reguły lokalizacji', () => {
    /** @type {Array<[string, number | null, string]>} */
    const cases = [
      ['README.md', 1, 'living'],
      ['CHANGELOG.md', 1, 'living'],
      ['.claude/agents/devops-engineer.md', 2, 'living'],
      ['.claude/skills/milestone/SKILL.md', 2, 'living'],
      ['.scratch/notatka.md', 3, 'ephemeral'],
      ['docs/README.md', 4, 'living'],
      ['docs/backlog/_template.md', 5, 'living'],
      ['docs/backlog/M1/README.md', 5, 'living'],
      ['docs/backlog/M0/EVM-012-cykl-zycia-dokumentacji.md', 6, 'permanent'],
      ['docs/architecture/adr/0000-template.md', 7, 'living'],
      ['docs/architecture/adr/0014-narzedzia-testowe.md', 8, 'permanent'],
      ['docs/process/retros/M0.md', 9, 'permanent'],
      ['docs/spikes/EVM-011-kolejka-offline.md', 10, 'permanent'],
      ['docs/qa/EVM-012/raport.md', 11, 'milestone'],
      ['docs/ux/reviews/EVM-004/runda-1/raport.md', 12, 'milestone'],
      ['spikes/upload-w-tle/README.md', 13, 'milestone'],
      ['docs/notes/plan-m1.md', 14, 'lifecycle'],
      ['docs/backlog/M0/notatka.md', 15, 'forbidden'],
      ['docs/process/retros/notatki.md', 15, 'forbidden'],
      ['spikes/notatka.md', 15, 'forbidden'],
      ['docs/product/vision.md', 16, 'living'],
      ['docs/process/document-lifecycle.md', 16, 'living'],
      ['docs/ux/styleguide.md', 16, 'living'],
      ['design/tokens/README.md', 16, 'living'],
      ['tools/docs-lifecycle/README.md', 17, 'living'],
      ['.github/pull_request_template.md', 17, 'living'],
      ['notatka.md', null, 'forbidden'],
      ['docs/notatka-łódź.md', null, 'forbidden'],
      ['Docs/README.md', null, 'forbidden'],
      ['apps/api/docs/opis.md', null, 'forbidden'],
    ];
    for (const [path, id, cls] of cases) {
      const { rule } = matchRule(config, path);
      assert.equal(rule.id, id, `reguła dla ${path}`);
      assert.equal(rule.class, cls, `klasa dla ${path}`);
    }
  });

  it('EVM-012 AC2: dopasowanie reguły zwraca przechwycone wartości (M#, EVM-ID, nazwa spike’a)', () => {
    assert.deepEqual(matchRule(config, 'docs/qa/EVM-012/raport.md').captures, { evmId: 'EVM-012' });
    assert.deepEqual(matchRule(config, 'spikes/upload/notatki/a.md').captures, { name: 'upload' });
    assert.deepEqual(matchRule(config, 'notatka.md').captures, {});
  });

  it('EVM-012 AC1: reguły kamienia milowego i reguła docs/notes/ wskazują źródło M#', () => {
    const byId = new Map(config.rules.map((rule) => [rule.id, rule]));
    assert.equal(byId.get(11)?.milestoneFrom, 'story');
    assert.equal(byId.get(12)?.milestoneFrom, 'story');
    assert.equal(byId.get(13)?.milestoneFrom, 'spike');
    assert.equal(byId.get(14)?.milestoneFrom, 'field');
    assert.equal(byId.get(6)?.milestoneFrom, null);
    assert.deepEqual(
      config.rules.filter((rule) => rule.orphanCheck).map((rule) => rule.id),
      [14, 16],
    );
  });

  it('EVM-012 AC2: poprawna konfiguracja syntetyczna jest akceptowana', () => {
    const parsed = parseConfig(rawConfig());
    assert.equal(parsed.rules.length, 4);
    assert.equal(parsed.roadmap.section, 'Przegląd');
    assert.deepEqual(parsed.storyPattern.groups, ['milestone', 'evmId']);
  });

  it('EVM-012 AC2: niepoprawna konfiguracja kończy się błędem narzędzia z opisem', () => {
    assertInvalid((raw) => {
      raw.rules = [];
    }, /rules/);
    assertInvalid((raw) => {
      raw.rules[0] = 'x';
    }, /reguła 1/);
    assertInvalid((raw) => {
      raw.rules[1].id = 7;
    }, /id/);
    assertInvalid((raw) => {
      raw.rules[0].patterns = [];
    }, /patterns/);
    assertInvalid((raw) => {
      raw.rules[0].class = 'archive';
    }, /klasa/);
    assertInvalid((raw) => {
      raw.rules[0].orphanCheck = 'nie';
    }, /orphanCheck/);
    assertInvalid((raw) => {
      raw.rules[0].milestoneFrom = 'story';
    }, /milestoneFrom/);
    assertInvalid((raw) => {
      delete raw.rules[1].milestoneFrom;
    }, /milestoneFrom/);
    assertInvalid((raw) => {
      raw.rules[1].patterns = ['docs/qa/**/*.md'];
    }, /<EVM-ID>/);
    assertInvalid((raw) => {
      raw.rules[2].patterns = ['spikes/**/*.md'];
    }, /<nazwa>/);
    assertInvalid((raw) => {
      raw.rules[2].patterns = ['eksperymenty/<nazwa>/**/*.md'];
    }, /spikesDir/);
    assertInvalid((raw) => {
      raw.defaultRule = { class: 'living' };
    }, /defaultRule/);
    assertInvalid((raw) => {
      raw.scratchDir = '.scratch/';
    }, /scratchDir/);
    assertInvalid((raw) => {
      raw.roadmap = { path: 'docs/product/roadmap.md' };
    }, /roadmap/);
    assertInvalid((raw) => {
      raw.policy = 42;
    }, /policy/);
    assertInvalid((raw) => {
      raw.storyPattern = 'docs/backlog/<M#>/*.md';
    }, /storyPattern/);
    assertInvalid((raw) => {
      raw.milestoneDirPattern = 'docs/backlog/**';
    }, /milestoneDirPattern/);
    assertInvalid((raw) => {
      raw.spikesDir = 'spikes/x';
    }, /spikesDir/);
    assertInvalid((raw) => {
      raw.rules[0].patterns = ['docs/<foo>.md'];
    }, /wzorzec/);
    assert.throws(() => parseConfig(null), ToolError);
  });

  it('EVM-012 AC2: brak pliku konfiguracji lub niepoprawny JSON to błąd narzędzia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evm-012-config-'));
    try {
      const broken = join(dir, 'lifecycle.config.json');
      writeFileSync(broken, '{ "rules": [');
      assert.throws(
        () => loadConfig(broken),
        (error) => error instanceof ToolError && /konfiguracj/.test(error.message),
      );
      assert.throws(() => loadConfig(join(dir, 'brak.json')), ToolError);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
    assert.match(CONFIG_FILE, /lifecycle\.config\.json$/);
  });
});

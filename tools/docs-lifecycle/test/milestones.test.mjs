// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectMilestones, compareMilestones, isMilestoneId, parseRoadmapMilestones } from '../lib/milestones.mjs';
import { config, ROADMAP } from './helpers/fixtures.mjs';

describe('lista kamieni milowych (EVM-012, ustalenie E)', () => {
  it('EVM-012 AC3: kamienie z tabeli „Przegląd” w roadmapie — odporne na pogrubienie **M0**', () => {
    assert.deepEqual(parseRoadmapMilestones(ROADMAP, 'Przegląd'), ['M0', 'M1', 'M2']);
  });

  it('EVM-012 AC3: wiersze spoza sekcji „Przegląd” i roadmapa bez sekcji nie dodają kamieni', () => {
    assert.deepEqual(parseRoadmapMilestones('# R\n| M5 | x |\n', 'Przegląd'), []);
    assert.deepEqual(parseRoadmapMilestones('## Przegląd\n### Szczegóły\n| M5 | x |\n', 'Przegląd'), []);
    assert.deepEqual(parseRoadmapMilestones('', 'Przegląd'), []);
  });

  it('EVM-012 AC3: lista = roadmapa ∪ katalogi docs/backlog/<M#>/ z listy gita, posortowana numerycznie', () => {
    const paths = ['docs/backlog/M10/README.md', 'docs/backlog/M3/x.txt', 'docs/backlog/README.md', 'docs/product/roadmap.md'];
    assert.deepEqual(collectMilestones(paths, ROADMAP, config), ['M0', 'M1', 'M2', 'M3', 'M10']);
  });

  it('EVM-012 AC3: format M# = M + cyfry; porównanie numeryczne', () => {
    assert.equal(isMilestoneId('M0'), true);
    assert.equal(isMilestoneId('M12'), true);
    assert.equal(isMilestoneId('m1'), false);
    assert.equal(isMilestoneId('M'), false);
    assert.equal(isMilestoneId('M1a'), false);
    assert.deepEqual(['M10', 'M2', 'M01', 'M1'].sort(compareMilestones), ['M01', 'M1', 'M2', 'M10']);
    assert.equal(compareMilestones('M1', 'M1'), 0);
    assert.ok(compareMilestones('M1', 'M01') > 0);
  });
});

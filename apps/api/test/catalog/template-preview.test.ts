import { describe, expect, it } from 'vitest';
import { distinctProcedures } from '../../src/modules/catalog/domain/template-preview.ts';

describe('preview of the processes of a template (EVM-019 AC4)', () => {
  it('EVM-019 AC4 a process brought by several items appears once, in the order of its first appearance', () => {
    const dso = { code: 'dso_connection', name: 'Uzgodnienia z OSD', stageCount: 7 };
    const electrical = { code: 'electrical_installation', name: 'Instalacja zasilająca', stageCount: 3 };
    const measurements = { code: 'measurements_acceptance', name: 'Pomiary i odbiór', stageCount: 2 };
    expect(distinctProcedures([dso, electrical, { ...dso }, measurements, electrical])).toEqual([dso, electrical, measurements]);
    expect(distinctProcedures([])).toEqual([]);
  });
});

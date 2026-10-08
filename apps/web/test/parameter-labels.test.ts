import { describe, expect, it } from 'vitest';
import { describeParameters, type ParameterPart } from '../src/i18n/parameter-labels.ts';

const line = (parts: readonly ParameterPart[]): string => parts.map((part) => (part.kind === 'text' ? part.text : '<nieznane>')).join(', ');

describe('labels of the technical parameters (EVM-018 AC2; P-12)', () => {
  it('EVM-018 AC2 a charger of alternating current reads "AC, 11 kW, 3 fazy"', () => {
    expect(line(describeParameters('charger_spec', { currentType: 'ac', powerKw: 11, phases: 3 }))).toBe('AC, 11 kW, 3 fazy');
    expect(line(describeParameters('charger_spec', { phases: 1, powerKw: 7.4, currentType: 'ac' }))).toBe('AC, 7,4 kW, 1 faza');
    expect(line(describeParameters('charger_spec', { currentType: 'dc', powerKw: 50, outlet: 'tethered_cable' }))).toBe(
      'DC, 50 kW, kabel na stałe',
    );
  });

  it('EVM-018 AC2 every set the catalogue has is read out in its own order', () => {
    expect(
      line(describeParameters('charger_installation', { networkConnection: 'wifi', mountingType: 'wall', loadBalancing: false })),
    ).toBe('montaż na ścianie, bez równoważenia obciążenia, Wi-Fi');
    expect(
      line(
        describeParameters('supply_circuit', {
          dedicatedCircuit: true,
          internalSupplyLine: true,
          cableLengthM: 25,
          cableCrossSectionMm2: 6,
          residualCurrentDeviceType: 'a_ev',
          overcurrentProtectionA: 32,
        }),
      ),
    ).toBe('obwód dedykowany, z WLZ, kabel 25 m, 6 mm², wyłącznik różnicowoprądowy typu A EV, zabezpieczenie 32 A');
    expect(line(describeParameters('connection_power', { requestedConnectionPowerKw: 40, phasesAfter: 3 }))).toBe(
      'wnioskowana moc 40 kW, po zmianie: 3 fazy',
    );
    expect(line(describeParameters('dso_request', { requestType: 'power_increase', requestedConnectionPowerKw: 40 }))).toBe(
      'zwiększenie mocy, wnioskowana moc 40 kW',
    );
    expect(line(describeParameters('dso_request', { requestType: 'new_connection' }))).toBe('nowe przyłącze');
  });

  it('EVM-018 AC2 the producer and the model are shown as text, cut to 100 characters', () => {
    const parts = describeParameters('charger_spec', {
      currentType: 'ac',
      powerKw: 11,
      phases: 3,
      manufacturer: 'M'.repeat(150),
      model: 'X-1',
    });
    expect(parts.at(-2)).toEqual({ kind: 'text', text: `producent: ${'M'.repeat(100)}` });
    expect(parts.at(-1)).toEqual({ kind: 'text', text: 'model: X-1' });
  });

  it('EVM-018 AC2 a set, a key or a value the panel does not know is ONE unknown part — never the raw value', () => {
    expect(describeParameters('future_set', { a: 1 })).toEqual([{ kind: 'unknown' }]);
    expect(describeParameters('future_set', {})).toEqual([{ kind: 'unknown' }]);
    expect(describeParameters(null, { a: 1 })).toEqual([{ kind: 'unknown' }]);
    expect(describeParameters('__proto__', {})).toEqual([{ kind: 'unknown' }]);
    expect(describeParameters('constructor', {})).toEqual([{ kind: 'unknown' }]);
    expect(describeParameters('charger_spec', { currentType: 'ac', powerKw: 11, phases: 3, newField: 'x' })).toEqual([
      { kind: 'text', text: 'AC' },
      { kind: 'text', text: '11 kW' },
      { kind: 'text', text: '3 fazy' },
      { kind: 'unknown' },
    ]);
    const odd = describeParameters('charger_spec', { currentType: 'hydrogen', powerKw: 'dużo', phases: 3, outlet: 7 });
    expect(odd).toEqual([{ kind: 'text', text: '3 fazy' }, { kind: 'unknown' }]);
    expect(JSON.stringify(odd)).not.toContain('hydrogen');
    expect(describeParameters('charger_spec', { currentType: 'constructor' })).toEqual([{ kind: 'unknown' }]);
  });

  it('EVM-018 AC2 no parameters and no set — no parts; other numbers of phases are read plainly', () => {
    expect(describeParameters(null, {})).toEqual([]);
    expect(describeParameters('charger_spec', {})).toEqual([]);
    expect(line(describeParameters('charger_spec', { phases: 2 }))).toBe('2 fazy');
    expect(line(describeParameters('connection_power', { phasesAfter: 1 }))).toBe('po zmianie: 1 faza');
    expect(line(describeParameters('connection_power', { phasesAfter: 2 }))).toBe('po zmianie: 2 fazy');
    expect(describeParameters('charger_spec', { manufacturer: '' })).toEqual([{ kind: 'unknown' }]);
    expect(describeParameters('charger_spec', { powerKw: Number.POSITIVE_INFINITY })).toEqual([{ kind: 'unknown' }]);
  });
});

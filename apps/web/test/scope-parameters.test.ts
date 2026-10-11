import { describe, expect, it } from 'vitest';
import { PARAMETER_FIELDS } from '../src/i18n/parameter-fields.ts';
import { buildParameters, fieldsOf, hasParameterSet, sameParameters, valuesOf } from '../src/work-orders/scope-parameters.ts';

describe('the form model of technical parameters (EVM-035 AC4)', () => {
  it('EVM-035 AC4 only the keys of the sets are fields: nothing for PPE, a meter number or a surname', () => {
    const keys = Object.values(PARAMETER_FIELDS).flatMap((fields) => fields.map((field) => field.key));
    for (const forbidden of ['ppe', 'meteringPointId', 'meterNumber', 'name', 'lastName', 'firstName', 'address', 'notes']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(hasParameterSet('supply_circuit')).toBe(true);
    expect(hasParameterSet('__proto__')).toBe(false);
    expect(hasParameterSet('constructor')).toBe(false);
    expect(hasParameterSet(null)).toBe(false);
    expect(fieldsOf('unknown_set')).toEqual([]);
  });

  it('EVM-035 AC4 nothing given is an empty map; given fields demand the required ones', () => {
    expect(buildParameters('supply_circuit', {})).toEqual({ ok: true, parameters: {} });
    expect(buildParameters('supply_circuit', { cableLengthM: '12' })).toEqual({ ok: false, errors: { dedicatedCircuit: 'required' } });
    expect(buildParameters('supply_circuit', { dedicatedCircuit: 'yes', cableLengthM: '12,5', residualCurrentDeviceType: 'a_ev' })).toEqual(
      {
        ok: true,
        parameters: { dedicatedCircuit: true, cableLengthM: 12.5, residualCurrentDeviceType: 'a_ev' },
      },
    );
  });

  it('EVM-035 AC4 numbers: a comma and a dot, above zero, within the bound; text is not a number', () => {
    const result = (value: string) => buildParameters('connection_power', { requestedConnectionPowerKw: value });
    expect(result('7.4')).toEqual({ ok: true, parameters: { requestedConnectionPowerKw: 7.4 } });
    expect(result('0')).toEqual({ ok: false, errors: { requestedConnectionPowerKw: 'range' } });
    expect(result('1001')).toEqual({ ok: false, errors: { requestedConnectionPowerKw: 'range' } });
    expect(result('-3')).toEqual({ ok: false, errors: { requestedConnectionPowerKw: 'number' } });
    expect(result('1e3')).toEqual({ ok: false, errors: { requestedConnectionPowerKw: 'number' } });
  });

  it('EVM-035 AC4 the phases follow the current: required for AC, absent for DC', () => {
    expect(buildParameters('charger_spec', { currentType: 'ac', powerKw: '11' })).toEqual({ ok: false, errors: { phases: 'phasesForAc' } });
    expect(buildParameters('charger_spec', { currentType: 'dc', powerKw: '50', phases: '3' })).toEqual({
      ok: false,
      errors: { phases: 'phasesForDc' },
    });
    expect(buildParameters('charger_spec', { currentType: 'ac', powerKw: '11', phases: '3', manufacturer: '  Firma  ' })).toEqual({
      ok: true,
      parameters: { currentType: 'ac', powerKw: 11, phases: 3, manufacturer: 'Firma' },
    });
  });

  it('EVM-035 AC4 stored values fill the form and an unexpected type is left empty', () => {
    expect(valuesOf('supply_circuit', { dedicatedCircuit: true, cableLengthM: 7.5, residualCurrentDeviceType: 7, unknown: 'x' })).toEqual({
      dedicatedCircuit: 'yes',
      internalSupplyLine: '',
      cableLengthM: '7,5',
      cableCrossSectionMm2: '',
      residualCurrentDeviceType: '',
      overcurrentProtectionA: '',
    });
    expect(valuesOf(null, { a: 1 })).toEqual({});
  });

  it('EVM-035 AC4 equal parameters are recognised whatever the order of the keys', () => {
    expect(sameParameters({ a: 1, b: true }, { b: true, a: 1 })).toBe(true);
    expect(sameParameters({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameParameters({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameParameters({}, {})).toBe(true);
  });
});

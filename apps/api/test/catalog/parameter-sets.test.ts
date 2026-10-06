import { describe, expect, it } from 'vitest';
import { CATALOG_SEED_2026_10 } from '../../src/migrations/data/catalog-seed-2026-10.ts';
import {
  MAX_PARAMETERS_BYTES,
  PARAMETER_SET_CODES,
  isParameterSetCode,
  parseParameters,
  type ParameterSetCode,
} from '../../src/modules/catalog/domain/parameter-sets.ts';

/** One valid, complete value per set (synthetic technical values). */
const VALID: Readonly<Record<ParameterSetCode, Record<string, unknown>>> = {
  charger_spec: { currentType: 'ac', powerKw: 11, phases: 3, outlet: 'tethered_cable', manufacturer: 'Synthetic Maker', model: 'SM-11' },
  charger_installation: { mountingType: 'wall', loadBalancing: true, networkConnection: 'wifi' },
  supply_circuit: {
    dedicatedCircuit: true,
    internalSupplyLine: false,
    cableLengthM: 18.5,
    cableCrossSectionMm2: 6,
    residualCurrentDeviceType: 'a_ev',
    overcurrentProtectionA: 16,
  },
  connection_power: { requestedConnectionPowerKw: 22, phasesAfter: 3 },
  dso_request: { requestType: 'power_increase', requestedConnectionPowerKw: 22 },
};

describe('technical parameter sets (EVM-019 AC2; SR-INPUT-02, SR-DATA-01)', () => {
  it('EVM-019 AC2 there is a schema for every set of the catalogue and the five codes of the specification are the whole list', () => {
    expect([...PARAMETER_SET_CODES]).toEqual(['charger_spec', 'charger_installation', 'supply_circuit', 'connection_power', 'dso_request']);
    expect(PARAMETER_SET_CODES.every(isParameterSetCode)).toBe(true);
    expect(isParameterSetCode('charger_spec_v2')).toBe(false);
    expect(isParameterSetCode(undefined)).toBe(false);
  });

  it.each(PARAMETER_SET_CODES)('EVM-019 AC2 a complete valid value of %s passes both views', (code) => {
    expect(parseParameters(code, VALID[code])).toEqual({ ok: true, value: VALID[code] });
    expect(parseParameters(code, VALID[code], 'defaults')).toEqual({ ok: true, value: VALID[code] });
  });

  it('EVM-019 AC2 every default value of the starting data passes the validation of its parameter set', () => {
    const sets = new Map(CATALOG_SEED_2026_10.serviceItems.map((service) => [service.code, service.parameterSetCode]));
    const withDefaults = CATALOG_SEED_2026_10.workOrderTemplates.flatMap((template) =>
      template.items.filter((item) => Object.keys(item.defaultParameters).length > 0).map((item) => ({ template: template.code, item })),
    );
    expect(withDefaults.map(({ item }) => item.serviceItemCode)).toContain('supply_installation');
    for (const { template, item } of withDefaults) {
      const set = sets.get(item.serviceItemCode);
      expect(set, `${template}.${item.serviceItemCode}`).toBeTypeOf('string');
      expect(parseParameters(set as string, item.defaultParameters, 'defaults'), `${template}.${item.serviceItemCode}`).toMatchObject({
        ok: true,
      });
    }
  });

  it.each(PARAMETER_SET_CODES)('EVM-019 AC2 %s rejects an extra field, including __proto__ and constructor', (code) => {
    expect(parseParameters(code, { ...VALID[code], extra: 1 })).toEqual({ ok: false, issues: [{ path: 'extra', code: 'unknown_field' }] });
    const proto = JSON.parse(`${JSON.stringify(VALID[code]).slice(0, -1)},"__proto__":{"polluted":true}}`) as unknown;
    expect(parseParameters(code, proto)).toEqual({ ok: false, issues: [{ path: '__proto__', code: 'unknown_field' }] });
    expect(parseParameters(code, { ...VALID[code], constructor: { prototype: {} } }, 'defaults')).toEqual({
      ok: false,
      issues: [{ path: 'constructor', code: 'unknown_field' }],
    });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it.each([
    ['ppe', 'PL0000000000000001'],
    ['meterNumber', '123456'],
    ['address', 'ul. Syntetyczna 1'],
    ['parkingPlace', 'A-12'],
    ['customerName', 'Jan Syntetyczny'],
    ['phone', '+48000000000'],
  ])('EVM-019 AC2 a personal-data-like field "%s" is not part of any parameter set', (field, value) => {
    for (const code of PARAMETER_SET_CODES) {
      for (const view of ['full', 'defaults'] as const) {
        expect(parseParameters(code, { ...VALID[code], [field]: value }, view), `${code}/${view}`).toEqual({
          ok: false,
          issues: [{ path: field, code: 'unknown_field' }],
        });
      }
    }
  });

  it('EVM-019 AC2 more than 16 KB of serialized JSON is rejected before the schema runs, and the bound is in UTF-8 bytes', () => {
    expect(MAX_PARAMETERS_BYTES).toBe(16_384);
    const big = { ...VALID.charger_installation, filler: 'x'.repeat(MAX_PARAMETERS_BYTES) };
    expect(parseParameters('charger_installation', big)).toEqual({ ok: false, issues: [{ path: '', code: 'too_large' }] });
    // 3 bytes per character: 6000 characters are under the limit as text but over it as UTF-8 (18 000 bytes)
    const wide = { manufacturer: '€'.repeat(6000) };
    expect(wide.manufacturer.length).toBeLessThan(MAX_PARAMETERS_BYTES);
    expect(parseParameters('charger_spec', wide, 'defaults')).toEqual({ ok: false, issues: [{ path: '', code: 'too_large' }] });
  });

  it('EVM-019 AC2 an unknown set, a value that cannot be serialized and a non-object are errors, never "anything goes"', () => {
    expect(parseParameters('charger_spec_v2', {})).toEqual({
      ok: false,
      issues: [{ path: 'parameterSetCode', code: 'unknown_parameter_set' }],
    });
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(parseParameters('charger_installation', cycle)).toEqual({ ok: false, issues: [{ path: '', code: 'not_serializable' }] });
    expect(parseParameters('charger_installation', undefined)).toEqual({ ok: false, issues: [{ path: '', code: 'not_serializable' }] });
    expect(parseParameters('charger_installation', BigInt(1))).toEqual({ ok: false, issues: [{ path: '', code: 'not_serializable' }] });
    for (const value of [null, [], 'text', 7]) expect(parseParameters('charger_installation', value).ok, JSON.stringify(value)).toBe(false);
  });

  it('EVM-019 AC2 numbers have ranges and values come from closed lists', () => {
    const bad = (code: ParameterSetCode, value: Record<string, unknown>, view: 'full' | 'defaults' = 'defaults') =>
      parseParameters(code, value, view);
    expect(bad('charger_spec', { powerKw: 0 }).ok).toBe(false);
    expect(bad('charger_spec', { powerKw: -3 }).ok).toBe(false);
    expect(bad('charger_spec', { powerKw: 1001 }).ok).toBe(false);
    expect(bad('charger_spec', { powerKw: 22.5 }).ok).toBe(true);
    expect(bad('charger_spec', { phases: 2 }).ok).toBe(false);
    expect(bad('charger_spec', { currentType: 'ac_dc' }).ok).toBe(false);
    expect(bad('supply_circuit', { cableLengthM: 501 }).ok).toBe(false);
    expect(bad('supply_circuit', { overcurrentProtectionA: 0 }).ok).toBe(false);
    expect(bad('supply_circuit', { dedicatedCircuit: 'yes' }).ok).toBe(false);
    expect(bad('supply_circuit', { residualCurrentDeviceType: 'c' }).ok).toBe(false);
    expect(bad('connection_power', { phasesAfter: 4 }).ok).toBe(false);
    expect(bad('dso_request', { requestType: 'surprise' }).ok).toBe(false);
    expect(bad('charger_installation', { networkConnection: 'bluetooth' }).ok).toBe(false);
  });

  it('EVM-019 AC2 the full view requires the required fields; the defaults view allows them to be missing', () => {
    expect(parseParameters('supply_circuit', {})).toEqual({ ok: false, issues: [{ path: 'dedicatedCircuit', code: 'invalid_type' }] });
    expect(parseParameters('supply_circuit', {}, 'defaults')).toEqual({ ok: true, value: {} });
    expect(parseParameters('connection_power', {}).ok).toBe(false);
    expect(parseParameters('dso_request', {}).ok).toBe(false);
    expect(parseParameters('charger_spec', { currentType: 'dc', powerKw: 50 })).toMatchObject({ ok: true });
  });

  it('EVM-019 AC2 phases are required for AC and absent for DC in the full view', () => {
    expect(parseParameters('charger_spec', { currentType: 'ac', powerKw: 11 })).toEqual({
      ok: false,
      issues: [{ path: 'phases', code: 'required_for_ac' }],
    });
    expect(parseParameters('charger_spec', { currentType: 'dc', powerKw: 50, phases: 3 })).toEqual({
      ok: false,
      issues: [{ path: 'phases', code: 'not_for_dc' }],
    });
    expect(parseParameters('charger_spec', { currentType: 'dc', powerKw: 50, phases: 3 }, 'defaults')).toMatchObject({ ok: true });
  });

  it('EVM-019 AC2 text is NFC, trimmed, bounded and free of control characters', () => {
    const text = (manufacturer: string) => parseParameters('charger_spec', { manufacturer }, 'defaults');
    expect(text('  Zażółć  ')).toEqual({ ok: true, value: { manufacturer: 'Zażółć' } });
    expect(text('Zażołć'.normalize('NFD'))).toEqual({ ok: true, value: { manufacturer: 'Zażołć'.normalize('NFC') } });
    for (const bad of ['', '   ', 'a'.repeat(101), 'line\nbreak', 'tab\there', 'null\u0000byte', 'zero​width', 'bidi‮flip', 'sep arator']) {
      expect(text(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(text('a'.repeat(100)).ok).toBe(true);
    expect(parseParameters('charger_spec', { model: 7 }, 'defaults').ok).toBe(false);
  });
});

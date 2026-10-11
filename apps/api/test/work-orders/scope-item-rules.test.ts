import { describe, expect, it } from 'vitest';
import { parseParameters } from '../../src/modules/catalog/index.ts';
import {
  changedScopeFields,
  CUSTOM_SERVICE_CODE,
  MAX_SCOPE_ITEMS,
  nextPosition,
  normalizeNotes,
  validateParameters,
  validateProcedureCodes,
} from '../../src/modules/work-orders/domain/scope-item-rules.ts';

describe('the parameters of an item against its set (EVM-035 AC4; SR-INPUT-01, SR-INPUT-02, SR-DATA-02)', () => {
  it('EVM-035 AC4 {} is "no parameters" and passes for an item with a set and without one', () => {
    expect(validateParameters(parseParameters, 'supply_circuit', {})).toEqual({ ok: true, value: {} });
    expect(validateParameters(parseParameters, null, {})).toEqual({ ok: true, value: {} });
  });

  it('EVM-035 AC4 values of the set pass; a field the set does not know — also one meant for a PPE, a meter number or a surname — is unknown_field with a pointer, never the value', () => {
    expect(validateParameters(parseParameters, 'supply_circuit', { dedicatedCircuit: true, cableLengthM: 18 })).toEqual({
      ok: true,
      value: { dedicatedCircuit: true, cableLengthM: 18 },
    });
    for (const field of ['meteringPointId', 'meterNumber', 'lastName', 'ppe']) {
      const result = validateParameters(parseParameters, 'supply_circuit', { dedicatedCircuit: true, [field]: 'PL0000000000000000' });
      expect(result, field).toEqual({ ok: false, errors: [{ pointer: `/parameters/${field}`, code: 'unknown_field' }] });
    }
  });

  it('EVM-035 AC4 a value out of range, of a wrong type or outside the list is refused by pointer and code', () => {
    expect(validateParameters(parseParameters, 'supply_circuit', { dedicatedCircuit: true, cableLengthM: 5000 })).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters/cableLengthM', code: 'out_of_range' }],
    });
    expect(validateParameters(parseParameters, 'supply_circuit', { dedicatedCircuit: 'tak' })).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters/dedicatedCircuit', code: 'invalid_type' }],
    });
    expect(validateParameters(parseParameters, 'supply_circuit', { dedicatedCircuit: true, residualCurrentDeviceType: 'z' })).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters/residualCurrentDeviceType', code: 'invalid_value' }],
    });
  });

  it('EVM-035 AC4 SR-INPUT-06 a map of more than 16 KB is refused whole, before it is walked', () => {
    const big = {
      dedicatedCircuit: true,
      ...Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`k${index}`, 'x'.repeat(100)])),
    };
    expect(validateParameters(parseParameters, 'supply_circuit', big)).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters', code: 'too_large' }],
    });
  });

  it('EVM-035 AC4 an item without a set takes no parameters (not_allowed); a set the code does not know is refused (never "anything goes")', () => {
    expect(validateParameters(parseParameters, null, { cableLengthM: 5 })).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters', code: 'not_allowed' }],
    });
    expect(validateParameters(parseParameters, 'no_such_set', { a: 1 })).toMatchObject({ ok: false });
  });

  it('EVM-035 AC4 SR-INPUT-02 prototype pollution: __proto__ and constructor are refused as unknown fields', () => {
    const polluted = JSON.parse('{"dedicatedCircuit":true,"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(validateParameters(parseParameters, 'supply_circuit', polluted)).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters/__proto__', code: 'unknown_field' }],
    });
    expect(validateParameters(parseParameters, 'supply_circuit', { dedicatedCircuit: true, constructor: 'x' })).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters/constructor', code: 'unknown_field' }],
    });
  });

  it('EVM-035 AC4 a very long name of a field cannot become a long pointer: the pointer names the map', () => {
    const result = validateParameters(parseParameters, 'supply_circuit', { dedicatedCircuit: true, ['x'.repeat(500)]: 1 });
    expect(result).toEqual({ ok: false, errors: [{ pointer: '/parameters', code: 'unknown_field' }] });
  });

  it('EVM-035 AC4 a code of the set that is not of the form of a code of the API becomes "invalid"; a map that is refused for its root has the pointer of the map', () => {
    const odd = () => ({ ok: false as const, issues: [{ path: 'a', code: 'Weird Code' }] });
    expect(validateParameters(odd, 'supply_circuit', { a: 1 })).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters/a', code: 'invalid' }],
    });
    const root = () => ({ ok: false as const, issues: [{ path: '', code: 'invalid_union' }] });
    expect(validateParameters(root, 'supply_circuit', { a: 1 })).toEqual({
      ok: false,
      errors: [{ pointer: '/parameters', code: 'invalid_union' }],
    });
  });
});

describe('the notes of an item (EVM-035 AC4; SR-INPUT-05, SR-DATA-02)', () => {
  it('EVM-035 AC4 the notes are plain text, multi-line, NFC, trimmed; empty or absent is null', () => {
    expect(normalizeNotes('  Trasa przez garaż\r\nszacht B  ', { required: false })).toEqual({
      ok: true,
      value: 'Trasa przez garaż\nszacht B',
    });
    expect(normalizeNotes('   ', { required: false })).toEqual({ ok: true, value: null });
    expect(normalizeNotes(undefined, { required: false })).toEqual({ ok: true, value: null });
    expect(normalizeNotes(null, { required: false })).toEqual({ ok: true, value: null });
  });

  it('EVM-035 AC4 the description of a "Inna usługa" is REQUIRED; control characters and more than 1000 characters are refused', () => {
    expect(CUSTOM_SERVICE_CODE).toBe('custom_service');
    expect(normalizeNotes(undefined, { required: true })).toEqual({ ok: false, errors: [{ pointer: '/notes', code: 'required' }] });
    expect(normalizeNotes('  ', { required: true })).toEqual({ ok: false, errors: [{ pointer: '/notes', code: 'required' }] });
    expect(normalizeNotes('a\u0000b', { required: false })).toEqual({
      ok: false,
      errors: [{ pointer: '/notes', code: 'invalid_characters' }],
    });
    expect(normalizeNotes('a'.repeat(1001), { required: false })).toEqual({ ok: false, errors: [{ pointer: '/notes', code: 'too_long' }] });
    expect(normalizeNotes('a'.repeat(1000), { required: true })).toMatchObject({ ok: true });
  });
});

describe('the codes of the processes and the position of an item (EVM-035 AC2, AC5)', () => {
  it('EVM-035 AC2 the codes are a subset of those the item brings, each once; a stranger is not_brought_by_item, a repeat is duplicate', () => {
    const brought = ['electrical_installation', 'dso_connection'];
    expect(validateProcedureCodes([], brought)).toEqual({ ok: true });
    expect(validateProcedureCodes(['dso_connection'], brought)).toEqual({ ok: true });
    expect(validateProcedureCodes(['electrical_installation', 'technical_assessment'], brought)).toEqual({
      ok: false,
      errors: [{ pointer: '/procedureCodes/1', code: 'not_brought_by_item' }],
    });
    expect(validateProcedureCodes(['dso_connection', 'dso_connection'], brought)).toEqual({
      ok: false,
      errors: [{ pointer: '/procedureCodes/1', code: 'duplicate' }],
    });
  });

  it('EVM-035 AC5 a new item goes to the end: n + 1; with gaps the highest + 1; past the limit the lowest free place', () => {
    expect(MAX_SCOPE_ITEMS).toBe(50);
    expect(nextPosition([])).toBe(1);
    expect(nextPosition([1, 2, 3])).toBe(4);
    expect(nextPosition([1, 3, 7])).toBe(8);
    const withGap = Array.from({ length: 50 }, (_, index) => index + 1).filter((position) => position !== 3);
    expect(nextPosition(withGap)).toBe(3);
  });

  it('EVM-035 AC7 the names of the fields that really change: the same parameters in another key order and the same notes are no change', () => {
    const current = { parameters: { a: 1, b: 'x' }, notes: 'Uwaga' };
    expect(changedScopeFields({ parameters: { b: 'x', a: 1 }, notes: 'Uwaga' }, current)).toEqual([]);
    expect(changedScopeFields({ parameters: { a: 2, b: 'x' } }, current)).toEqual(['parameters']);
    expect(changedScopeFields({ notes: null }, current)).toEqual(['notes']);
    expect(changedScopeFields({ parameters: {}, notes: 'Inne' }, current)).toEqual(['parameters', 'notes']);
    expect(changedScopeFields({}, current)).toEqual([]);
  });
});

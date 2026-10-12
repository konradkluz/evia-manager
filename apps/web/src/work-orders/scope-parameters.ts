import { PARAMETER_FIELDS, type ParameterField } from '../i18n/parameter-fields.ts';

/**
 * The form model of the technical parameters of a scope item (EVM-035 AC4; SR-INPUT-01, SR-INPUT-02). Every control holds a
 * string; `''` is "not given". The set comes from the item (a copy of the catalogue, stored in the scope item), never from a value
 * the person typed. The server validates again against the strict schema of the set.
 */
export type ParameterValues = Readonly<Record<string, string>>;

/** A reason, never a value: the screen turns it into a sentence. */
export type ParameterErrorCode = 'required' | 'number' | 'range' | 'phasesForAc' | 'phasesForDc';
export type ParameterErrors = Readonly<Record<string, ParameterErrorCode>>;

export type ParameterPayload = Record<string, string | number | boolean>;

export const hasParameterSet = (setCode: string | null): setCode is string => setCode !== null && Object.hasOwn(PARAMETER_FIELDS, setCode);

export const fieldsOf = (setCode: string | null): readonly ParameterField[] =>
  hasParameterSet(setCode) ? (PARAMETER_FIELDS[setCode] ?? []) : [];

export const BOOLEAN_YES = 'yes';
export const BOOLEAN_NO = 'no';

/** The form values of stored parameters; a value of an unexpected type is left empty (the panel does not show it raw). */
export function valuesOf(setCode: string | null, parameters: Readonly<Record<string, unknown>>): ParameterValues {
  const values: Record<string, string> = {};
  for (const field of fieldsOf(setCode)) {
    const value = Object.hasOwn(parameters, field.key) ? parameters[field.key] : undefined;
    if (field.kind === 'boolean') values[field.key] = typeof value === 'boolean' ? (value ? BOOLEAN_YES : BOOLEAN_NO) : '';
    else if (field.kind === 'number' || field.kind === 'phases')
      values[field.key] = typeof value === 'number' ? String(value).replace('.', ',') : '';
    else values[field.key] = typeof value === 'string' ? value : '';
  }
  return values;
}

const NUMBER = /^\d+(?:[.,]\d+)?$/;

export type ParameterBuild =
  { readonly ok: true; readonly parameters: ParameterPayload } | { readonly ok: false; readonly errors: ParameterErrors };

/**
 * The parameters to send, or what is wrong. Nothing given is `{}` ("bez parametrów"); as soon as one field is given the
 * required fields of the set are demanded. Numbers accept a comma or a dot, must be above zero and within the bound.
 */
export function buildParameters(setCode: string | null, values: ParameterValues): ParameterBuild {
  const fields = fieldsOf(setCode);
  const raw = (key: string): string => (values[key] ?? '').trim();
  if (fields.every((field) => raw(field.key) === '')) return { ok: true, parameters: {} };
  const parameters: ParameterPayload = {};
  const errors: Record<string, ParameterErrorCode> = {};
  for (const field of fields) {
    const text = raw(field.key);
    if (text === '') {
      if (field.required) errors[field.key] = 'required';
      continue;
    }
    switch (field.kind) {
      case 'boolean':
        parameters[field.key] = text === BOOLEAN_YES;
        break;
      case 'choice':
      case 'text':
        parameters[field.key] = text;
        break;
      case 'phases':
        parameters[field.key] = Number(text);
        break;
      case 'number': {
        if (!NUMBER.test(text)) {
          errors[field.key] = 'number';
          break;
        }
        const value = Number(text.replace(',', '.'));
        if (!(value > 0) || value > field.max) errors[field.key] = 'range';
        else parameters[field.key] = value;
        break;
      }
    }
  }
  // `phases` belongs to alternating current: required for AC, absent for DC (service-catalog.md § 3).
  if (setCode === 'charger_spec') {
    if (raw('currentType') === 'ac' && raw('phases') === '') errors['phases'] = 'phasesForAc';
    if (raw('currentType') === 'dc' && raw('phases') !== '') errors['phases'] = 'phasesForDc';
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, parameters };
}

/** The same parameters as the stored ones — "nothing changed" (a number typed with a comma is the same number). */
export function sameParameters(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key]);
}

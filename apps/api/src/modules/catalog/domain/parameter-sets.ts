/**
 * Technical parameter sets (service-catalog.md § 3; domain-model.md decision D2 and → JSONB; SR-INPUT-02, SR-DATA-01).
 * One strict Zod schema per `parameterSetCode`, in code: no extra fields (also not `__proto__` or `constructor`), numbers
 * with a range, text trimmed, NFC and free of control characters, at most 16 KB of serialized JSON (UTF-8 bytes).
 * Only technical values belong here — personal data and identifiers (PPE, meter numbers, addresses, parking places)
 * live in the typed columns of the customer and the site, so the schemas have no field that could carry them.
 *
 * Two views of one schema: `full` — what a scope item of a work order must satisfy (EVM-022), and `defaults` — what a
 * template item may hold (every field optional, but every present field still checked). The set changes only additively.
 */
import { z } from 'zod';

export const PARAMETER_SET_CODES = ['charger_spec', 'charger_installation', 'supply_circuit', 'connection_power', 'dso_request'] as const;
export type ParameterSetCode = (typeof PARAMETER_SET_CODES)[number];

/** Limit of the serialized parameters (domain-model.md → JSONB): 16 KB of UTF-8 bytes — the same bound as the CHECK of the column. */
export const MAX_PARAMETERS_BYTES = 16_384;

export const isParameterSetCode = (value: unknown): value is ParameterSetCode =>
  typeof value === 'string' && (PARAMETER_SET_CODES as readonly string[]).includes(value);

/** Letters, digits, punctuation and spaces: no control, format (zero-width, bidi), or line and paragraph separator characters. */
const NO_CONTROL_CHARACTERS = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u;

const technicalText = z.string().normalize('NFC').trim().min(1).max(100).regex(NO_CONTROL_CHARACTERS);
const powerKw = z.number().positive().max(1000);
const phases = z.union([z.literal(1), z.literal(3)]);

const chargerSpec = z.strictObject({
  currentType: z.enum(['ac', 'dc']),
  powerKw,
  phases: phases.optional(),
  outlet: z.enum(['socket', 'tethered_cable']).optional(),
  manufacturer: technicalText.optional(),
  model: technicalText.optional(),
});

const chargerInstallation = z.strictObject({
  mountingType: z.enum(['wall', 'pedestal']).optional(),
  loadBalancing: z.boolean().optional(),
  networkConnection: z.enum(['none', 'wifi', 'lan', 'lte']).optional(),
});

const supplyCircuit = z.strictObject({
  dedicatedCircuit: z.boolean(),
  internalSupplyLine: z.boolean().optional(),
  cableLengthM: z.number().positive().max(500).optional(),
  cableCrossSectionMm2: z.number().positive().max(240).optional(),
  residualCurrentDeviceType: z.enum(['a', 'a_ev', 'b']).optional(),
  overcurrentProtectionA: z.number().positive().max(630).optional(),
});

const connectionPower = z.strictObject({
  requestedConnectionPowerKw: powerKw,
  phasesAfter: phases.optional(),
});

const dsoRequest = z.strictObject({
  requestType: z.enum(['power_increase', 'new_connection', 'separate_meter', 'other']),
  requestedConnectionPowerKw: powerKw.optional(),
});

/** `phases` belongs to alternating current: required for AC, absent for DC (service-catalog.md § 3). */
const chargerSpecFull = chargerSpec.superRefine((value, ctx) => {
  if (value.currentType === 'ac' && value.phases === undefined)
    ctx.addIssue({ code: 'custom', path: ['phases'], message: 'required_for_ac' });
  if (value.currentType === 'dc' && value.phases !== undefined) ctx.addIssue({ code: 'custom', path: ['phases'], message: 'not_for_dc' });
});

interface ParameterSet {
  readonly full: z.ZodType;
  readonly defaults: z.ZodType;
}

const PARAMETER_SETS: Readonly<Record<ParameterSetCode, ParameterSet>> = {
  charger_spec: { full: chargerSpecFull, defaults: chargerSpec.partial() },
  charger_installation: { full: chargerInstallation, defaults: chargerInstallation },
  supply_circuit: { full: supplyCircuit, defaults: supplyCircuit.partial() },
  connection_power: { full: connectionPower, defaults: connectionPower.partial() },
  dso_request: { full: dsoRequest, defaults: dsoRequest.partial() },
};

export type ParameterView = keyof ParameterSet;

/** What is wrong, never the value (SR-ERR-02): a dotted path and a stable code. */
export interface ParameterIssue {
  readonly path: string;
  readonly code: string;
}

export type ParameterResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly issues: readonly ParameterIssue[] };

const failure = (path: string, code: string): ParameterResult => ({ ok: false, issues: [{ path, code }] });

/** `JSON.stringify` answers `undefined` for a value with no JSON form (undefined, a function), which its type does not say. */
const stringify = (value: unknown): string | undefined => JSON.stringify(value);

/** Size in UTF-8 bytes of the serialized JSON; `undefined` when the value cannot be serialized (cycle, BigInt, nothing). */
function serializedBytes(value: unknown): number | undefined {
  try {
    const json = stringify(value);
    return json === undefined ? undefined : new TextEncoder().encode(json).length;
  } catch {
    return undefined;
  }
}

const issuePath = (path: readonly PropertyKey[]): string => path.map(String).join('.');

function issuesOf(error: z.ZodError): ParameterIssue[] {
  return error.issues.flatMap((issue): ParameterIssue[] =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ path: issuePath([...issue.path, key]), code: 'unknown_field' }))
      : [{ path: issuePath(issue.path), code: issue.code === 'custom' ? issue.message : issue.code }],
  );
}

/**
 * Validates parameters against the set `code`. The size is checked before the schema, so an oversized value is never walked.
 * An unknown set is an error (the answer to a code that was never defined is never "anything goes").
 */
export function parseParameters(code: string, input: unknown, view: ParameterView = 'full'): ParameterResult {
  if (!isParameterSetCode(code)) return failure('parameterSetCode', 'unknown_parameter_set');
  const bytes = serializedBytes(input);
  if (bytes === undefined) return failure('', 'not_serializable');
  if (bytes > MAX_PARAMETERS_BYTES) return failure('', 'too_large');
  const result = PARAMETER_SETS[code][view].safeParse(input);
  return result.success
    ? { ok: true, value: result.data as Readonly<Record<string, unknown>> }
    : { ok: false, issues: issuesOf(result.error) };
}

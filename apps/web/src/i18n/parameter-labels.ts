/**
 * Polish labels of the technical parameters of a scope item (docs/product/service-catalog.md § 3; EVM-018 AC2). The API sends
 * a `parameterSetCode` and a flat map of scalars; this is where the panel turns them into the words of a line such as
 * "AC, 11 kW, 3 fazy". Anything this panel does not know — a set code, a key of a set, a value outside the list, a value of
 * another type — is NOT shown raw: it becomes an `unknown` part, which the screen renders as the badge of an unknown value
 * (P-12, styleguide § 3.9.1; SR-ERR-01, SR-WEB-03). Only the two free technical texts (producer, model) are shown as they are,
 * cut to 100 characters. It sits next to the i18n catalogue, like `catalog-labels.ts`.
 */
export type ParameterPart = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'unknown' };

type Describe = (value: unknown) => string | undefined;

const MAX_TEXT = 100;

const number = (format: (value: number) => string): Describe => {
  return (value) => (typeof value === 'number' && Number.isFinite(value) ? format(value) : undefined);
};
const choice =
  (labels: Readonly<Record<string, string>>): Describe =>
  (value) =>
    typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : undefined;
const yesNo =
  (yes: string, no: string): Describe =>
  (value) =>
    typeof value === 'boolean' ? (value ? yes : no) : undefined;
const text =
  (format: (value: string) => string): Describe =>
  (value) =>
    typeof value === 'string' && value.length > 0 ? format(value.slice(0, MAX_TEXT)) : undefined;

/** Digits only, in Polish number format ("11", "7,4"). */
const plain = (value: number): string => String(value).replace('.', ',');
const phases = number((value) => (value === 1 ? '1 faza' : value === 3 ? '3 fazy' : `${plain(value)} fazy`));

/** The fields of every known set, in the order they are read out. */
const SETS: Readonly<Record<string, ReadonlyArray<readonly [string, Describe]>>> = {
  charger_spec: [
    ['currentType', choice({ ac: 'AC', dc: 'DC' })],
    ['powerKw', number((value) => `${plain(value)} kW`)],
    ['phases', phases],
    ['outlet', choice({ socket: 'gniazdo', tethered_cable: 'kabel na stałe' })],
    ['manufacturer', text((value) => `producent: ${value}`)],
    ['model', text((value) => `model: ${value}`)],
  ],
  charger_installation: [
    ['mountingType', choice({ wall: 'montaż na ścianie', pedestal: 'montaż na słupku' })],
    ['loadBalancing', yesNo('z równoważeniem obciążenia', 'bez równoważenia obciążenia')],
    ['networkConnection', choice({ none: 'bez łączności', wifi: 'Wi-Fi', lan: 'LAN', lte: 'LTE' })],
  ],
  supply_circuit: [
    ['dedicatedCircuit', yesNo('obwód dedykowany', 'obwód niededykowany')],
    ['internalSupplyLine', yesNo('z WLZ', 'bez WLZ')],
    ['cableLengthM', number((value) => `kabel ${plain(value)} m`)],
    ['cableCrossSectionMm2', number((value) => `${plain(value)} mm²`)],
    [
      'residualCurrentDeviceType',
      choice({
        a: 'wyłącznik różnicowoprądowy typu A',
        a_ev: 'wyłącznik różnicowoprądowy typu A EV',
        b: 'wyłącznik różnicowoprądowy typu B',
      }),
    ],
    ['overcurrentProtectionA', number((value) => `zabezpieczenie ${plain(value)} A`)],
  ],
  connection_power: [
    ['requestedConnectionPowerKw', number((value) => `wnioskowana moc ${plain(value)} kW`)],
    [
      'phasesAfter',
      number((value) => (value === 1 ? 'po zmianie: 1 faza' : value === 3 ? 'po zmianie: 3 fazy' : `po zmianie: ${plain(value)} fazy`)),
    ],
  ],
  dso_request: [
    [
      'requestType',
      choice({
        power_increase: 'zwiększenie mocy',
        new_connection: 'nowe przyłącze',
        separate_meter: 'oddzielny licznik',
        other: 'inny wniosek',
      }),
    ],
    ['requestedConnectionPowerKw', number((value) => `wnioskowana moc ${plain(value)} kW`)],
  ],
};

/**
 * The parts of the line of parameters of one scope item. No parameters and no set — no parts. An unknown set, or a key or a
 * value the set does not know, adds ONE `unknown` part (a badge): the panel says it does not understand, it does not guess.
 */
export function describeParameters(setCode: string | null, parameters: Readonly<Record<string, unknown>>): ParameterPart[] {
  const keys = Object.keys(parameters);
  if (setCode === null) return keys.length === 0 ? [] : [{ kind: 'unknown' }];
  const fields = Object.hasOwn(SETS, setCode) ? SETS[setCode] : undefined;
  if (fields === undefined) return [{ kind: 'unknown' }];
  const parts: ParameterPart[] = [];
  let unrecognised = false;
  for (const [key, describe] of fields) {
    if (!Object.hasOwn(parameters, key)) continue;
    const described = describe(parameters[key]);
    if (described === undefined) unrecognised = true;
    else parts.push({ kind: 'text', text: described });
  }
  if (unrecognised || keys.some((key) => !fields.some(([known]) => known === key))) parts.push({ kind: 'unknown' });
  return parts;
}

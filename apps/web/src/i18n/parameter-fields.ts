/**
 * The fields of the technical parameter sets for the forms "Dodaj pozycję" and "Edytuj parametry" (EVM-035 AC4;
 * docs/product/service-catalog.md § 3; ustalenie B2: typed controls). The server validates against the strict Zod schemas
 * (`apps/api/.../parameter-sets.ts`); this table only draws the controls and rejects what is plainly wrong before sending.
 * A key, a bound or a choice that the schema does not have is never offered, so nothing that could carry personal data
 * (PPE, a meter number, a surname) has a field. Labels are Polish words next to the i18n catalogue (like `parameter-labels.ts`).
 */
export type ParameterFieldKind =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'number'; readonly unit: string; readonly unitLabel: string; readonly max: number }
  | { readonly kind: 'choice'; readonly options: ReadonlyArray<readonly [string, string]> }
  | { readonly kind: 'phases' }
  | { readonly kind: 'text'; readonly max: number };

export type ParameterField = ParameterFieldKind & {
  readonly key: string;
  readonly label: string;
  /** Required by the schema itself (a field required for AC only — `phases` — is decided by the form). */
  readonly required: boolean;
};

export const PARAMETER_TEXT_MAX = 100;

export const PARAMETER_FIELDS: Readonly<Record<string, readonly ParameterField[]>> = {
  charger_spec: [
    {
      key: 'currentType',
      label: 'Prąd',
      required: true,
      kind: 'choice',
      options: [
        ['ac', 'AC (prąd przemienny)'],
        ['dc', 'DC (prąd stały)'],
      ],
    },
    { key: 'powerKw', label: 'Moc ładowarki', required: true, kind: 'number', unit: 'kW', unitLabel: 'kilowaty', max: 1000 },
    { key: 'phases', label: 'Liczba faz', required: false, kind: 'phases' },
    {
      key: 'outlet',
      label: 'Wyjście',
      required: false,
      kind: 'choice',
      options: [
        ['socket', 'gniazdo'],
        ['tethered_cable', 'kabel na stałe'],
      ],
    },
    { key: 'manufacturer', label: 'Producent', required: false, kind: 'text', max: PARAMETER_TEXT_MAX },
    { key: 'model', label: 'Model', required: false, kind: 'text', max: PARAMETER_TEXT_MAX },
  ],
  charger_installation: [
    {
      key: 'mountingType',
      label: 'Sposób montażu',
      required: false,
      kind: 'choice',
      options: [
        ['wall', 'na ścianie'],
        ['pedestal', 'na słupku'],
      ],
    },
    { key: 'loadBalancing', label: 'Równoważenie obciążenia', required: false, kind: 'boolean' },
    {
      key: 'networkConnection',
      label: 'Łączność',
      required: false,
      kind: 'choice',
      options: [
        ['none', 'brak'],
        ['wifi', 'Wi-Fi'],
        ['lan', 'LAN'],
        ['lte', 'LTE'],
      ],
    },
  ],
  supply_circuit: [
    { key: 'dedicatedCircuit', label: 'Obwód dedykowany', required: true, kind: 'boolean' },
    { key: 'internalSupplyLine', label: 'Zasilanie z WLZ budynku', required: false, kind: 'boolean' },
    { key: 'cableLengthM', label: 'Długość kabla', required: false, kind: 'number', unit: 'm', unitLabel: 'metry', max: 500 },
    {
      key: 'cableCrossSectionMm2',
      label: 'Przekrój kabla',
      required: false,
      kind: 'number',
      unit: 'mm²',
      unitLabel: 'milimetry kwadratowe',
      max: 240,
    },
    {
      key: 'residualCurrentDeviceType',
      label: 'Wyłącznik różnicowoprądowy',
      required: false,
      kind: 'choice',
      options: [
        ['a', 'Typ A'],
        ['a_ev', 'Typ A EV'],
        ['b', 'Typ B'],
      ],
    },
    {
      key: 'overcurrentProtectionA',
      label: 'Zabezpieczenie nadprądowe',
      required: false,
      kind: 'number',
      unit: 'A',
      unitLabel: 'ampery',
      max: 630,
    },
  ],
  connection_power: [
    {
      key: 'requestedConnectionPowerKw',
      label: 'Wnioskowana moc przyłączeniowa',
      required: true,
      kind: 'number',
      unit: 'kW',
      unitLabel: 'kilowaty',
      max: 1000,
    },
    { key: 'phasesAfter', label: 'Liczba faz po zmianie', required: false, kind: 'phases' },
  ],
  dso_request: [
    {
      key: 'requestType',
      label: 'Rodzaj wniosku',
      required: true,
      kind: 'choice',
      options: [
        ['power_increase', 'zwiększenie mocy'],
        ['new_connection', 'nowe przyłącze'],
        ['separate_meter', 'oddzielny licznik'],
        ['other', 'inny wniosek'],
      ],
    },
    {
      key: 'requestedConnectionPowerKw',
      label: 'Wnioskowana moc przyłączeniowa',
      required: false,
      kind: 'number',
      unit: 'kW',
      unitLabel: 'kilowaty',
      max: 1000,
    },
  ],
};

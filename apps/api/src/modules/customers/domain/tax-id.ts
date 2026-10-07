/** NIP, the Polish tax number (EVM-020 AC2): 10 digits with the control sum; `PL`, spaces and hyphens are accepted on input. */
const WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

/** @returns the 10 digits, or `undefined` when the text is not a valid NIP */
export function normalizeTaxId(raw: string): string | undefined {
  const compact = raw.normalize('NFC').replace(/[\s-]/g, '').replace(/^pl/i, '');
  if (!/^\d{10}$/.test(compact)) return undefined;
  const digits = Array.from(compact, (digit) => Number(digit));
  const sum = WEIGHTS.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0);
  return sum % 11 === digits[9] ? compact : undefined;
}

/** Polish plural class of a count (1 = one, 2–4 except 12–14 = few, the rest = many); returns the matching key of the caller. */
export function pluralKey<K extends string>(count: number, keys: { readonly one: K; readonly few: K; readonly many: K }): K {
  if (count === 1) return keys.one;
  const tens = count % 100;
  const units = count % 10;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? keys.few : keys.many;
}

/**
 * The block of the summary of a dialog of an instalment (styleguide § 4.11; EVM-054 → "UX / UI"): what the action will write, as a
 * description list, updated while typing — without `aria-live` (a screen reader is not flooded; the toast announces the result).
 * Every value is text (SR-WEB-03); kwoty and dates come formatted (§ 6.3).
 */
export function MilestoneSummary({ id, rows }: { readonly id?: string; readonly rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl id={id} className="flex flex-col gap-stack-xs text-body-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap gap-x-inline-sm">
          <dt className="text-text-secondary">{label}</dt>
          <dd className="min-w-0 break-words tabular-nums text-text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

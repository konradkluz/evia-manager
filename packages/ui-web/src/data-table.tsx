import type { ReactNode } from 'react';
import { classNames } from './class-names.ts';
import { PlainLink, type LinkComponent } from './navigation.tsx';

export interface DataTableColumn {
  readonly id: string;
  readonly header: string;
  /** Times and numbers use tabular figures (`text.numeric`) so that they line up. */
  readonly numeric?: boolean;
  /** The column the rows are sorted by (`aria-sort`, § 3.6); the other columns carry no attribute. */
  readonly sort?: 'ascending' | 'descending';
}

export interface DataTableRow {
  readonly id: string;
  /** One cell per column, in the order of the columns. */
  readonly cells: readonly ReactNode[];
  /** Accessible name of the row (e.g. the full time and the outcome in words) — § 3.6. */
  readonly label?: string;
  /**
   * The whole row leads to the details (§ 3.6): the first cell holds the link (named by `label`) and its target covers
   * the row; the focus ring is drawn around the row.
   */
  readonly href?: string;
}

export interface DataTableProps {
  /** Caption of the table (visually hidden): its name for assistive technology. */
  readonly caption: string;
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly DataTableRow[];
  /** Router link for the rows with `href` (the library has no router); a plain anchor by default. */
  readonly link?: LinkComponent;
}

/**
 * DataTable (styleguide § 3.6), read-only variant: a semantic `<table>` with a caption, column headers with `scope`,
 * the header on `color.bg.surface-subtle` + `text.label`, rows separated by `color.border.subtle`, hover
 * `color.bg.surface-hover`, `text.body-sm`. Below `breakpoint.medium` the table scrolls inside its frame (the card list
 * of § 3.6 is not built yet).
 */
export function DataTable({ caption, columns, rows, link: Link = PlainLink }: DataTableProps) {
  // The scrollable frame must be reachable by keyboard (WCAG 2.1.1): it is a focusable region named after the table.
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-card border-w-default border-border-default bg-bg-surface focus-visible:focus-ring"
    >
      <table className="w-full text-body-sm text-text-primary">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-bg-surface-subtle text-label text-text-primary">
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" aria-sort={column.sort} className="px-inset-md py-inset-sm text-start font-semibold">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              aria-label={row.href === undefined ? row.label : undefined}
              className={classNames(
                'border-t-default hover:bg-bg-surface-hover',
                row.href !== undefined && 'relative has-focus-visible:focus-ring-inner',
              )}
            >
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index]?.id ?? index}
                  className={classNames('px-inset-md py-inset-sm align-top', columns[index]?.numeric === true && 'tabular-nums')}
                >
                  {index === 0 && row.href !== undefined ? (
                    <Link href={row.href} aria-label={row.label} className="after:absolute after:inset-0 focus-visible:outline-none">
                      {cell}
                    </Link>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

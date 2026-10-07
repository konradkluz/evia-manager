import type { ReactNode } from 'react';
import { classNames } from './class-names.ts';

export interface DataTableColumn {
  readonly id: string;
  readonly header: string;
  /** Times and numbers use tabular figures (`text.numeric`) so that they line up. */
  readonly numeric?: boolean;
}

export interface DataTableRow {
  readonly id: string;
  /** One cell per column, in the order of the columns. */
  readonly cells: readonly ReactNode[];
  /** Accessible name of the row (e.g. the full time and the outcome in words) — § 3.6. */
  readonly label?: string;
}

export interface DataTableProps {
  /** Caption of the table (visually hidden): its name for assistive technology. */
  readonly caption: string;
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly DataTableRow[];
}

/**
 * DataTable (styleguide § 3.6), read-only variant: a semantic `<table>` with a caption, column headers with `scope`,
 * the header on `color.bg.surface-subtle` + `text.label`, rows separated by `color.border.subtle`, hover
 * `color.bg.surface-hover`, `text.body-sm`. Below `breakpoint.medium` the table scrolls inside its frame (the card list
 * of § 3.6 is not built yet).
 */
export function DataTable({ caption, columns, rows }: DataTableProps) {
  return (
    <div className="overflow-x-auto rounded-card border-w-default border-border-default bg-bg-surface">
      <table className="w-full text-body-sm text-text-primary">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-bg-surface-subtle text-label text-text-primary">
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className="px-inset-md py-inset-sm text-start font-semibold">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} aria-label={row.label} className="border-t-default hover:bg-bg-surface-hover">
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index]?.id ?? index}
                  className={classNames('px-inset-md py-inset-sm align-top', columns[index]?.numeric === true && 'tabular-nums')}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

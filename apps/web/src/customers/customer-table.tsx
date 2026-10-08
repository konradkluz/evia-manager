import type { CustomerSearchItem } from '@evia/contracts';
import { DataTable, type DataTableColumn, type DataTableRow } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { customerPath } from '../paths.ts';
import { RouterLink } from '../shell/router-link.tsx';
import { formatPhone } from './format.ts';

/**
 * The table of W-14 (EVM-039 AC1): "Klient" (`sortName`, the order of the list), "Rodzaj", "Telefon" and "E-mail". The whole row
 * is one link to the details; its name starts with the visible name of the customer and goes on in the order of the columns
 * (WCAG 2.5.3). Everything is shown as React text, the address of the row carries only the identifier.
 */
export function CustomerTable({ items }: { readonly items: readonly CustomerSearchItem[] }) {
  const { t } = useTranslation();
  const columns: DataTableColumn[] = [
    { id: 'customer', card: 'primary', header: t('customerList.table.customer'), sort: 'ascending' },
    { id: 'kind', card: 'meta', header: t('customerList.table.kind') },
    { id: 'phone', card: 'meta', header: t('customerList.table.phone'), numeric: true },
    { id: 'email', card: 'meta', header: t('customerList.table.email') },
  ];
  const rows: DataTableRow[] = items.map((item) => {
    const kind = item.kind === 'company' ? t('customerList.table.company') : t('customerList.table.person');
    const phone = formatPhone(item.phone);
    return {
      id: item.id,
      href: customerPath(item.id),
      label:
        item.email === null
          ? t('customerList.table.row', { name: item.sortName, kind: kind.toLocaleLowerCase('pl'), phone })
          : t('customerList.table.rowEmail', { name: item.sortName, kind: kind.toLocaleLowerCase('pl'), phone, email: item.email }),
      cells: [
        <span key="customer" className="break-words font-semibold">
          {item.sortName}
        </span>,
        <span key="kind">{kind}</span>,
        <span key="phone" className="whitespace-nowrap">
          {phone}
        </span>,
        <span key="email" className={item.email === null ? 'text-text-secondary' : 'break-all'}>
          {item.email ?? t('customerList.table.noEmail')}
        </span>,
      ],
    };
  });
  return <DataTable caption={t('customerList.table.caption')} columns={columns} rows={rows} link={RouterLink} />;
}

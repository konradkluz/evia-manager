import type { User } from '@evia/contracts';
import {
  ActionMenu,
  type ActionMenuItem,
  Ban,
  Button,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock,
  DataTable,
  EllipsisVertical,
  IconButton,
  Mail,
  Send,
  TextLink,
  TimerOff,
  type DataTableColumn,
  type DataTableRow,
  type Icon,
} from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ACCOUNT_PATH } from '../paths.ts';
import { RouterLink } from '../shell/router-link.tsx';
import { formatClock, formatDate } from '../work-orders/format.ts';
import { operationsOf, type AccountOperation } from './account-operations.ts';
import { roleLabel, statusLabel } from './labels.ts';

/** Icon and colour role of the status of an account (flows/12 → "Status konta, stan zaproszenia…"): never the colour alone. */
const STATUS_MARKERS: Readonly<Record<string, { readonly icon: Icon; readonly tone: string }>> = {
  active: { icon: CircleCheck, tone: 'text-icon-success' },
  invited: { icon: Clock, tone: 'text-icon-info' },
  deactivated: { icon: Ban, tone: 'text-icon-secondary' },
};
const UNKNOWN_MARKER = { icon: CircleHelp, tone: 'text-icon-secondary' } as const;

/** What the cell "Zaproszenie" shows: the label, the icon and whether "Wyślij ponownie" stands under it. */
interface InvitationView {
  readonly text: string;
  readonly icon: Icon;
  readonly tone: string;
  readonly resend: boolean;
}

function invitationView(t: TFunction, user: User, now: number): InvitationView | null {
  const invitation = user.invitation;
  if (user.status !== 'invited' || invitation === null) return null;
  const sent = invitation.sentAt;
  const until = invitation.expiresAt;
  switch (invitation.state) {
    case 'sending':
      return { text: t('users.invitation.sending'), icon: Send, tone: 'text-icon-info', resend: false };
    case 'sent':
      // A link that ran out before the list was read again is shown as expired (the server confirms it on the next read).
      if (until !== null && Date.parse(until) <= now) {
        return {
          text: t('users.invitation.expired', { date: formatDate(until) }),
          icon: TimerOff,
          tone: 'text-icon-secondary',
          resend: true,
        };
      }
      return {
        text:
          sent === null || until === null
            ? t('users.invitation.sentNoDate')
            : t('users.invitation.sent', { sent: formatDate(sent), until: `${formatDate(until)}, ${formatClock(Date.parse(until))}` }),
        icon: Mail,
        tone: 'text-icon-secondary',
        resend: false,
      };
    case 'failed':
      return { text: t('users.invitation.failed'), icon: CircleAlert, tone: 'text-icon-error', resend: true };
    case 'expired':
      return {
        text: until === null ? t('users.invitation.expiredNoDate') : t('users.invitation.expired', { date: formatDate(until) }),
        icon: TimerOff,
        tone: 'text-icon-secondary',
        resend: true,
      };
    default:
      return null;
  }
}

export interface UsersTableProps {
  readonly users: readonly User[];
  /** The identifier of the account of this session: its row is "(Ty)" and has no menu (flows/12 → "Własny wiersz"). */
  readonly selfId: string;
  readonly online: boolean;
  /** The time of the server now. */
  readonly now: number;
  /** "Wyślij ponownie" and the item of the menu of a row. */
  readonly onResend: (user: User) => void;
  /** The other items of the menu of a row: role, sessions, reset, deactivation, reactivation (EVM-027). */
  readonly onOperation: (operation: AccountOperation, user: User) => void;
  /** A ref for the name of a row, so that "Pokaż konto" can bring the focus to it. */
  readonly nameRef: (id: string, element: HTMLElement | null) => void;
}

/**
 * The table of W-16 (EVM-024 AC5, AC7; flows/12 → W-16): name (with the e-mail under it on narrow screens), role, status as icon +
 * word, the state of the invitation and the menu of the row. The Administrator never sees a link or a token — only the state.
 * The menu of a row (flows/12 → "Menu wiersza"): resend for an account that waits, then the operations of its status
 * (EVM-027); the destructive ones (reset, deactivation) stand last in their own group. The own row has no menu.
 */
export function UsersTable({ users, selfId, online, now, onResend, onOperation, nameRef }: UsersTableProps) {
  const { t } = useTranslation();
  const columns: DataTableColumn[] = [
    { id: 'name', header: t('users.table.name'), card: 'primary', sort: 'ascending' },
    { id: 'email', header: t('users.table.email'), wideOnly: true },
    { id: 'role', header: t('users.table.role'), card: 'meta' },
    { id: 'status', header: t('users.table.status'), card: 'badge' },
    { id: 'invitation', header: t('users.table.invitation'), card: 'detail' },
    { id: 'actions', header: t('users.table.actions'), card: 'action' },
  ];
  const rows: DataTableRow[] = users.map((user) => {
    const self = user.id === selfId;
    const role = roleLabel(t, user.role);
    const status = statusLabel(t, user.status);
    const marker = Object.hasOwn(STATUS_MARKERS, user.status) ? (STATUS_MARKERS[user.status] ?? UNKNOWN_MARKER) : UNKNOWN_MARKER;
    const StatusIcon = marker.icon;
    const invitation = invitationView(t, user, now);
    const InvitationIcon = invitation?.icon;
    const resendLabel = t('users.invitation.resendLabel', { name: user.displayName, email: user.email });
    const hint = online ? undefined : t('users.offlineHint');
    const items = self ? [] : menuItems(t, user, onResend, onOperation);
    return {
      id: user.id,
      label: self
        ? t('users.table.rowYou', { name: user.displayName, role, status })
        : t('users.table.row', { name: user.displayName, role, status }),
      cells: [
        <span key="name" className="flex flex-col">
          <span
            ref={(element) => {
              nameRef(user.id, element);
            }}
            tabIndex={-1}
            className="focus-visible:focus-ring"
          >
            {self ? `${user.displayName} ${t('users.table.you')}` : user.displayName}
          </span>
          <span className="wide:hidden text-text-secondary wrap-anywhere">{user.email}</span>
          {/* The own row has no menu: what an Administrator may look for in it is in the account (flows/12 → "Własny wiersz"). */}
          {self ? (
            <span>
              <TextLink href={ACCOUNT_PATH} link={RouterLink}>
                {t('users.table.toAccount')}
              </TextLink>
            </span>
          ) : null}
        </span>,
        <span key="email" className="wrap-anywhere">
          {user.email}
        </span>,
        role,
        <span key="status" className="inline-flex items-center gap-inline-sm">
          <StatusIcon aria-hidden="true" className={`size-icon-sm shrink-0 ${marker.tone}`} />
          {status}
        </span>,
        invitation === null || InvitationIcon === undefined ? (
          t('users.table.none')
        ) : (
          <span key="invitation" className="flex flex-wrap items-center gap-x-inline-md gap-y-stack-xs">
            <span className="inline-flex items-center gap-inline-sm">
              <InvitationIcon aria-hidden="true" className={`size-icon-sm shrink-0 ${invitation.tone}`} />
              {invitation.text}
            </span>
            {invitation.resend ? (
              <Button
                variant="tertiary"
                disabled={!online}
                aria-label={resendLabel}
                {...(hint === undefined ? {} : { title: hint })}
                onClick={() => {
                  onResend(user);
                }}
              >
                {t('users.invitation.resend')}
              </Button>
            ) : null}
          </span>
        ),
        // The own account has no operation (its role and sessions are in "Konto").
        items.length > 0 ? (
          <ActionMenu
            key="actions"
            align="end"
            label={t('users.menu.label', { name: user.displayName, email: user.email })}
            items={items}
            trigger={(props) => (
              <IconButton
                {...props}
                {...(online ? {} : { onClick: () => undefined, 'aria-disabled': true, 'aria-expanded': false, title: hint })}
                icon={EllipsisVertical}
                label={t('users.menu.label', { name: user.displayName, email: user.email })}
              />
            )}
          />
        ) : null,
      ],
    };
  });
  return <DataTable caption={t('users.table.caption')} columns={columns} rows={rows} />;
}

function operationLabel(t: TFunction, operation: AccountOperation): string {
  switch (operation) {
    case 'role':
      return t('users.menu.role');
    case 'sessions':
      return t('users.menu.sessions');
    case 'reset':
      return t('users.menu.reset');
    case 'deactivate':
      return t('users.menu.deactivate');
    case 'reactivate':
      return t('users.menu.reactivate');
  }
}
/** The destructive items go last, after a separator (§ 3.20). */
const DANGEROUS: readonly AccountOperation[] = ['reset', 'deactivate'];

function menuItems(
  t: TFunction,
  user: User,
  onResend: (user: User) => void,
  onOperation: (operation: AccountOperation, user: User) => void,
): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  if (user.status === 'invited') {
    items.push({
      id: 'resend',
      label: t('users.menu.resend'),
      onSelect: () => {
        onResend(user);
      },
    });
  }
  let firstDangerous = true;
  for (const operation of operationsOf(user)) {
    const dangerous = DANGEROUS.includes(operation);
    items.push({
      id: operation,
      label: operationLabel(t, operation),
      onSelect: () => {
        onOperation(operation, user);
      },
      ...(dangerous ? { tone: 'danger' as const, startsGroup: firstDangerous } : {}),
    });
    if (dangerous) firstDangerous = false;
  }
  return items;
}

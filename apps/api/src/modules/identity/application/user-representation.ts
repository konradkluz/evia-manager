/**
 * The representation of an account in the list of users (EVM-024 AC5; W-16): the account and, for one that waits for activation, the state of
 * its invitation — `sending` (the message waits in the outbox or is being retried), `sent` (the link is valid), `failed` ("Nie wysłano":
 * the attempts are used up — the Administrator can send again), `expired` (the last link ran out). Computed from the outbox status (a
 * platform query, one per page) and the latest link of the account (one lateral join per page); the clock decides expiry — a state is
 * never stored for it. `version` (the value of `If-Match`), `activatedAt` and the KINDS of the active second steps (`secondStepMethods`, EVM-027) complete
 * the account for the Administrator's dialogs. Never an address of anyone else, a token, a hash or an identifier of a credential: the contract schema is
 * the filter (the answer is parsed with it).
 */
import type { User } from '@evia/contracts';
import type { EmailStatus } from '../../../platform/email/email-outbox.ts';
import type { SecondStepKind } from '../infrastructure/access-queries.ts';
import type { UserRow } from '../infrastructure/queries.ts';

export interface LinkSummary {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly supersededAt: Date | null;
}

type Invitation = NonNullable<User['invitation']>;

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function invitationOf(link: LinkSummary | null, status: EmailStatus | undefined, now: Date): Invitation {
  if (status?.state === 'pending') return { state: 'sending', sentAt: null, expiresAt: null };
  if (status?.state === 'failed') return { state: 'failed', sentAt: null, expiresAt: null };
  const usable = link !== null && link.usedAt === null && link.supersededAt === null;
  if (usable && link.expiresAt > now) {
    return { state: 'sent', sentAt: iso(status?.sentAt ?? link.issuedAt), expiresAt: iso(link.expiresAt) };
  }
  // The link ran out, was used up or replaced without a newer message (a link of the command of the first Administrator, a message that was never made)
  return { state: 'expired', sentAt: iso(status?.sentAt ?? link?.issuedAt ?? null), expiresAt: iso(link?.expiresAt ?? null) };
}

export function toUser(
  row: Pick<UserRow, 'id' | 'email' | 'displayName' | 'role' | 'status' | 'version' | 'activatedAt'>,
  link: LinkSummary | null,
  status: EmailStatus | undefined,
  now: Date,
  secondStepMethods: readonly SecondStepKind[],
): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    invitation: row.status === 'invited' ? invitationOf(link, status, now) : null,
    version: row.version,
    activatedAt: iso(row.activatedAt),
    secondStepMethods: [...secondStepMethods],
  };
}

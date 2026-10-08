/** Public API of the `identity` module (other modules reach it only through this file — ADR-0001). */
export { IdentityModule } from './identity.module.ts';
export { SessionService } from './application/session.service.ts';
export { UserDirectory, DISPLAY_NAMES_BATCH_LIMIT, type UserSummary } from './application/user-directory.ts';
export { AdministratorBootstrap, type BootstrapRequest, type BootstrapResult } from './application/administrator-bootstrap.service.ts';
export { channelAllowedForRole } from './domain/channel-rules.ts';
export { csrfMatches } from './domain/tokens.ts';
export { stepUpFresh } from './domain/session-policy.ts';
export { normalizeEmail } from './domain/text.ts';
export { SESSION_COOKIE_NAME } from './domain/constants.ts';
export {
  EMERGENCY_REASONS,
  IDENTITY_EVENT_TYPES,
  REASON_CODES,
  type EmergencyReason,
  type IdentityEvent,
  type IdentityEventType,
  type ReasonCode,
} from './events.ts';

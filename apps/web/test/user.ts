// Shared user-interaction helper for component tests (EVM-081 AC1): userEvent without the per-keystroke delay,
// so tests are fast and need no timers. Import from here; do not call `userEvent.setup` in test files.
import { userEvent as userEventLibrary } from '@testing-library/user-event';

export function setupUser() {
  return userEventLibrary.setup({ delay: null });
}

// Ready-to-use instance for tests that do not need their own (clipboard, pointer state).
export const userEvent = setupUser();

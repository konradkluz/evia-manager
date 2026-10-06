import { Component, type ReactNode } from 'react';

/**
 * Last-resort boundary around the whole panel: an unhandled rendering error shows the error state instead of a blank
 * page. Nothing is logged here — React reports the error to the console in development; error details (which may hold
 * personal data) are never shown (SR-ERR-01; Sentry with scrubbing arrives in EVM-076).
 */
export class ErrorBoundary extends Component<{ readonly fallback: ReactNode; readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

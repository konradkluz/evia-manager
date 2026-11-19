import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * "Wszystko wysłane" for a screen reader, once (EVM-111 AC2): when the number of the files still to be sent drops to zero BECAUSE THE SERVER CONFIRMED the last
 * of them (`confirmed` rose) - a list that empties after "Usuń z telefonu" is not "sent". A screen reader does not see a list change, so the sentence is
 * the only way it learns. While `enabled` is `false` (hidden data, lock, ended session) nothing is announced - a live region is a channel of disclosure too
 * (AC6) - and the state is only remembered, so the return does not announce what happened meanwhile.
 */
export function useAllSentAnnouncement(count: number, confirmed: number, enabled: boolean, message: string): void {
  const before = useRef({ count, confirmed });
  useEffect(() => {
    const last = before.current;
    before.current = { count, confirmed };
    if (enabled && last.count > 0 && count === 0 && confirmed > last.confirmed) AccessibilityInfo.announceForAccessibility(message);
  }, [count, confirmed, enabled, message]);
}

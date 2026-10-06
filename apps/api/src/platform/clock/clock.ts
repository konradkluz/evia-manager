/**
 * Injectable clock (EVM-016; ADR-0014 "kontrolowany czas"): all business time comes from here, never from `new Date()`
 * or SQL `now()`, so TTL boundaries can be tested without sleeping. Times are instants (UTC); presentation in
 * Europe/Warsaw is the client's concern.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

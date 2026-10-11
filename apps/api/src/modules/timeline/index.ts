/** Public API of the `timeline` module (other modules reach it only through this file — ADR-0001). */
export { TimelineModule } from './timeline.module.ts';
export { TIMELINE_EVENT_TYPES, type TimelineEntryEvent } from './events.ts';

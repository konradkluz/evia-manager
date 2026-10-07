/** Injection tokens of the platform module (explicit tokens instead of decorator metadata). */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const LOGGER = Symbol('LOGGER');
export const DATABASE = Symbol('DATABASE');
export const DATABASE_PROBE = Symbol('DATABASE_PROBE');
export const CLOCK = Symbol('CLOCK');
export const EVENT_BUS = Symbol('EVENT_BUS');
export const METRICS = Symbol('METRICS');
export const SECURITY_ALERT_EMITTER = Symbol('SECURITY_ALERT_EMITTER');
export const CURSOR_CODEC = Symbol('CURSOR_CODEC');
export const BULK_READ_METER = Symbol('BULK_READ_METER');
export const BULK_READ_CONTROL = Symbol('BULK_READ_CONTROL');

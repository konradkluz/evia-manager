/**
 * The only door to the design tokens (styleguide § 7.2): components take colours, sizes, spacing and type from @evia/tokens, never
 * literals. Texts come in as props (the i18n catalogue lives in the application layer), so the library stays free of app concerns.
 */
export { borderWidth, color, elevation, motion, radius, size, space, text } from '@evia/tokens/mobile';

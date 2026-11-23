import { useWindowDimensions } from 'react-native';

/** The system font scale above which a bar does not fit in one row any more (EVM-151; styleguide § 3.18): normal <= 1.0, medium 1.0-1.3, large > 1.3. */
export const FONT_SCALE_MEDIUM = 1;
export const FONT_SCALE_LARGE = 1.3;
/** A window not wider than this is "narrow" (360 dp phones): the large tier starts already above 100% of the font. */
export const NARROW_WIDTH_DP = 400;

export type FontScaleTier = 'normal' | 'medium' | 'large';

export function fontScaleTier(fontScale: number, windowWidth: number): FontScaleTier {
  if (fontScale > FONT_SCALE_LARGE) return 'large';
  if (fontScale > FONT_SCALE_MEDIUM) return windowWidth <= NARROW_WIDTH_DP ? 'large' : 'medium';
  return 'normal';
}

/** One hook for the app bar and the bottom navigation, so that both switch their layout at the same scale. */
export function useFontScaleTier(): FontScaleTier {
  const { fontScale, width } = useWindowDimensions();
  return fontScaleTier(fontScale, width);
}

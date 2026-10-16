import { encodeQR } from 'qr';
import { useMemo } from 'react';

export interface QrCodeProps {
  /** The text to encode (e.g. an `otpauth://` address). It is encoded in the browser only — never sent anywhere. */
  readonly value: string;
  /** The accessible name of the picture; the text alternative of the content is given by the page next to it. */
  readonly label: string;
}

/**
 * QR code (styleguide § 3.2.1 / W-03 step 2): a vector picture drawn from the module matrix with `fill: currentColor` on
 * `color.bg.surface` with a quiet zone — no external service, no `dangerouslySetInnerHTML`, no inline script (CSP). The
 * value of the code never reaches the DOM as text: the page offers "Pokaż klucz do wpisania" as the alternative.
 */
export function QrCode({ value, label }: QrCodeProps) {
  const path = useMemo(() => {
    const matrix = encodeQR(value, 'raw', { ecc: 'medium' });
    const parts: string[] = [];
    matrix.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
      });
    });
    return { d: parts.join(''), size: matrix.length };
  }, [value]);
  // The quiet zone (4 modules) is part of the view box, so the picture is readable on a dark page too.
  const margin = 4;
  const full = path.size + margin * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-margin} ${-margin} ${full} ${full}`}
      shapeRendering="crispEdges"
      className="w-full max-w-dialog-width-sm bg-bg-surface text-text-primary rounded-control"
    >
      <path d={path.d} fill="currentColor" />
    </svg>
  );
}

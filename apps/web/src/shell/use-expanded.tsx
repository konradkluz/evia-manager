import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Is the window at `breakpoint.expanded` or wider (styleguide § 2.4)? The answer comes from the stylesheet itself — a probe
 * element that the `expanded:` variant hides — so no pixel value is repeated in the code. Without styles (a test in jsdom)
 * the probe stays visible and the answer is "narrower". Put `probe` on an element that is always rendered.
 */
export function useExpanded(): { readonly probe: RefObject<HTMLSpanElement | null>; readonly expanded: boolean } {
  const probe = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const read = useCallback(() => {
    if (probe.current !== null) setExpanded(globalThis.getComputedStyle(probe.current).display === 'none');
  }, []);
  useEffect(() => {
    read();
    globalThis.addEventListener('resize', read);
    return () => {
      globalThis.removeEventListener('resize', read);
    };
  }, [read]);
  return { probe, expanded };
}

/** The probe element: hidden from assistive technologies and from view whenever the window is at `expanded` or wider. */
export function ExpandedProbe({ probeRef }: { readonly probeRef: RefObject<HTMLSpanElement | null> }) {
  return <span ref={probeRef} aria-hidden="true" className="expanded:hidden" />;
}

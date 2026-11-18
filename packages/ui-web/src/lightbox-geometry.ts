// The geometry of the Lightbox zoom, pure so that it is tested without a layout engine (EVM-045 AC1).

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The size of a picture fitted whole into the area: never larger than its natural size, proportions kept. */
export function fitSize(natural: Size, area: Size): Size {
  const scale = Math.min(area.width / natural.width, area.height / natural.height, 1);
  return { width: natural.width * scale, height: natural.height * scale };
}

/** The fitted size times the zoom factor (1.5, 2, 3): the scrolling content is exactly this picture. */
export function zoomedSize(natural: Size, area: Size, factor: number): Size {
  const fit = fitSize(natural, area);
  return { width: fit.width * factor, height: fit.height * factor };
}

/**
 * The scroll position (one axis) after the content changed from `before` to `after` that keeps the same point of the picture in the middle
 * of the view; kept inside the content (a content smaller than the view does not scroll).
 */
export function scrollAfterZoom(input: { scroll: number; client: number; before: number; after: number }): number {
  const { scroll, client, before, after } = input;
  const max = Math.max(0, after - client);
  if (before <= 0) return 0;
  const centre = ((scroll + client / 2) / before) * after - client / 2;
  return Math.min(max, Math.max(0, centre));
}

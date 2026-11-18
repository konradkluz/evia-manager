import { describe, expect, it } from 'vitest';
import { fitSize, scrollAfterZoom, zoomedSize } from '../src/lightbox-geometry.ts';

describe('Lightbox zoom geometry (EVM-045 AC1)', () => {
  it('EVM-045 AC1 a wide photo is fitted by the width, a tall one by the height, proportions kept', () => {
    expect(fitSize({ width: 1600, height: 1200 }, { width: 800, height: 800 })).toEqual({ width: 800, height: 600 });
    expect(fitSize({ width: 1200, height: 1600 }, { width: 800, height: 400 })).toEqual({ width: 300, height: 400 });
  });

  it('EVM-045 AC1 a photo smaller than the area is not enlarged', () => {
    expect(fitSize({ width: 600, height: 400 }, { width: 1400, height: 800 })).toEqual({ width: 600, height: 400 });
  });

  it('EVM-045 AC1 the zoomed size is the fitted size times the factor', () => {
    const natural = { width: 1600, height: 1200 };
    const area = { width: 800, height: 800 };
    expect(zoomedSize(natural, area, 1)).toEqual({ width: 800, height: 600 });
    expect(zoomedSize(natural, area, 1.5)).toEqual({ width: 1200, height: 900 });
    expect(zoomedSize(natural, area, 3)).toEqual({ width: 2400, height: 1800 });
    expect(zoomedSize({ width: 600, height: 400 }, { width: 1400, height: 800 }, 2)).toEqual({ width: 1200, height: 800 });
  });

  it('EVM-045 AC1 the first zoom from the fit shows the middle of the picture', () => {
    expect(scrollAfterZoom({ scroll: 0, client: 800, before: 800, after: 1200 })).toBe(200);
    expect(scrollAfterZoom({ scroll: 0, client: 800, before: 800, after: 2400 })).toBe(800);
  });

  it('EVM-045 AC1 a later step keeps the same point in the middle of the view, both ways', () => {
    // the middle was at 700 of 1200 (58.3%): in 2400 it is at 1400
    expect(scrollAfterZoom({ scroll: 300, client: 800, before: 1200, after: 2400 })).toBe(1000);
    expect(scrollAfterZoom({ scroll: 1000, client: 800, before: 2400, after: 1200 })).toBe(300);
  });

  it('EVM-045 AC1 the position stays inside the content; a content that fits does not scroll', () => {
    expect(scrollAfterZoom({ scroll: 1600, client: 800, before: 2400, after: 1200 })).toBe(400);
    expect(scrollAfterZoom({ scroll: 400, client: 800, before: 1200, after: 800 })).toBe(0);
    expect(scrollAfterZoom({ scroll: 0, client: 800, before: 0, after: 1200 })).toBe(0);
    expect(scrollAfterZoom({ scroll: 0, client: 800, before: 600, after: 700 })).toBe(0);
  });
});

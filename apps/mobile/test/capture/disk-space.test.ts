import { BLOCK_BELOW_BYTES, WARN_BELOW_BYTES, diskLevel, expoDiskSpace } from '../../src/capture/disk-space';

const mockAvailable = jest.fn<number, []>();
jest.mock('expo-file-system', () => ({
  Paths: {
    get availableDiskSpace(): number {
      return mockAvailable();
    },
  },
}));

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('free space on the phone (EVM-108 AC4)', () => {
  it('EVM-108 AC4: the thresholds are one constant - a warning below 2 GB, a block below 100 MB', () => {
    expect(WARN_BELOW_BYTES).toBe(2 * GB);
    expect(BLOCK_BELOW_BYTES).toBe(100 * MB);
  });

  it('EVM-108 AC4: the level is ok from 2 GB, low from 100 MB up to 2 GB, blocked below 100 MB (the edges belong to the safer side of the lower level)', () => {
    expect(diskLevel(2 * GB)).toBe('ok');
    expect(diskLevel(2 * GB - 1)).toBe('low');
    expect(diskLevel(100 * MB)).toBe('low');
    expect(diskLevel(100 * MB - 1)).toBe('blocked');
    expect(diskLevel(0)).toBe('blocked');
    expect(diskLevel(50 * GB)).toBe('ok');
  });

  it('EVM-108 AC4: an unknown value (null, NaN, negative, infinite) never blocks the technician - the native import checks the space again', () => {
    for (const unknown of [null, Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(diskLevel(unknown)).toBe('ok');
  });

  it('EVM-108 AC4: the adapter reads the available space of the app and answers null when the system cannot tell', () => {
    mockAvailable.mockReturnValueOnce(1.2 * GB);
    expect(expoDiskSpace.freeBytes()).toBe(1.2 * GB);
    mockAvailable.mockImplementationOnce(() => {
      throw new Error('synthetic');
    });
    expect(expoDiskSpace.freeBytes()).toBeNull();
  });
});

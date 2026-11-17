// The real scheduler behind the cover's automatic unlock request (EVM-101 AC3); the setup mocks the module for the screen tests.
const { afterFirstFrames } = jest.requireActual<typeof import('../src/screens/after-frames')>('../src/screens/after-frames');

describe('afterFirstFrames (EVM-101 AC3)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('EVM-101 AC3: runs the task only after two frames, never synchronously', async () => {
    const task = jest.fn();
    afterFirstFrames(task);
    expect(task).not.toHaveBeenCalled();
    await jest.advanceTimersToNextTimerAsync(); // the first frame
    expect(task).not.toHaveBeenCalled();
    await jest.advanceTimersToNextTimerAsync(); // the second frame
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('EVM-101 AC3: cancelling before the first and before the second frame runs nothing', async () => {
    const early = jest.fn();
    afterFirstFrames(early).cancel();
    const late = jest.fn();
    const handle = afterFirstFrames(late);
    await jest.advanceTimersToNextTimerAsync();
    handle.cancel();
    await jest.advanceTimersByTimeAsync(100);
    expect(early).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
  });
});

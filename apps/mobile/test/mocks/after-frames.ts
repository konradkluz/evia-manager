// Test seam of the cover's "ask after the first frames" (EVM-101 AC3): by default the task runs at once (the screen tests need no
// frame loop); a test that checks the timing sets `frames.manual` and runs the queued tasks itself.
export const frames: { manual: boolean; queue: (() => void)[] } = { manual: false, queue: [] };

export function afterFirstFrames(task: () => void): { cancel: () => void } {
  if (!frames.manual) {
    task();
    return { cancel: () => undefined };
  }
  frames.queue.push(task);
  return {
    cancel: () => {
      frames.queue = frames.queue.filter((queued) => queued !== task);
    },
  };
}

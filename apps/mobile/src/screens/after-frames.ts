/**
 * Runs `task` after the next two frames (`InteractionManager` is gone from React Native 0.88): the cover is drawn and the start
 * animation has handed over the frame loop. The native side waits for a resumed, focused activity on top of that.
 */
export function afterFirstFrames(task: () => void): { cancel: () => void } {
  let second: number | undefined;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(task);
  });
  return {
    cancel: () => {
      cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
    },
  };
}

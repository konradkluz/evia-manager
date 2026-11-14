import { UPLOAD_LIMITS } from './types.ts';

export interface PartRange {
  readonly partNumber: number;
  readonly offset: number;
  readonly length: number;
}

export class PlanMismatchError extends Error {
  constructor() {
    super('plan_mismatch');
  }
}

/**
 * Byte ranges of the parts. The server decides the split; the client only computes the ranges and checks the answer:
 * `partCount = ceil(size / partSize)` and `1 <= partCount <= 1000`, otherwise `PlanMismatchError`.
 */
export function planParts(size: number, partSize: number, partCount: number): readonly PartRange[] {
  const valid =
    Number.isSafeInteger(size) && Number.isSafeInteger(partSize) && Number.isSafeInteger(partCount) && size >= 1 && partSize >= 1;
  if (!valid || partCount < 1 || partCount > UPLOAD_LIMITS.maxParts || partCount !== Math.ceil(size / partSize)) {
    throw new PlanMismatchError();
  }
  const parts: PartRange[] = [];
  for (let index = 0; index < partCount; index++) {
    const offset = index * partSize;
    parts.push({ partNumber: index + 1, offset, length: Math.min(partSize, size - offset) });
  }
  return parts;
}

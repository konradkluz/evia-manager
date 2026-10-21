// Part planner for S3 multipart uploads (ADR-0009, ADR-0007 "strategia części"). Pure, no I/O.
// Provider limits are parameters: Scaleway = 1..1000 parts, each 5 MiB..5 GiB (except the last); AWS = 10000 parts.
export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;

export interface PlannerLimits {
  /** Provider minimum for every part except the last. */
  minPartBytes: number;
  /** Provider maximum number of parts per multipart upload. */
  maxParts: number;
  /** Default part size. */
  preferredBytes: number;
  /** ADR range for the part size chosen by the client (8-64 MiB). */
  minChoiceBytes: number;
  maxChoiceBytes: number;
  /** Largest accepted file (ADR-0009: video <= 4 GiB). */
  maxFileBytes: number;
}

export const DEFAULT_LIMITS: PlannerLimits = {
  minPartBytes: 5 * MiB,
  maxParts: 1000,
  preferredBytes: 16 * MiB,
  minChoiceBytes: 8 * MiB,
  maxChoiceBytes: 64 * MiB,
  maxFileBytes: 4 * GiB,
};

export interface Part {
  /** 1-based, as in S3. */
  number: number;
  offset: number;
  length: number;
}

export interface PartPlan {
  partSize: number;
  parts: Part[];
}

export function planParts(size: number, overrides: Partial<PlannerLimits> = {}, requestedPartSize?: number): PartPlan {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  if (!Number.isInteger(size) || size <= 0) throw new Error('invalid size: must be a positive integer');
  if (size > limits.maxFileBytes) throw new Error(`size exceeds the file limit of ${limits.maxFileBytes} bytes`);

  let partSize = requestedPartSize ?? limits.preferredBytes;
  if (requestedPartSize !== undefined) {
    const ok =
      Number.isInteger(partSize) &&
      partSize % MiB === 0 &&
      partSize >= Math.max(limits.minChoiceBytes, limits.minPartBytes) &&
      partSize <= limits.maxChoiceBytes;
    if (!ok) throw new Error('invalid part size: must be a whole number of MiB within the allowed range');
  }
  if (Math.ceil(size / partSize) > limits.maxParts) {
    partSize = Math.ceil(size / limits.maxParts / MiB) * MiB;
    if (partSize > limits.maxChoiceBytes) throw new Error('file too large for the provider part limit');
  }
  const parts: Part[] = [];
  for (let offset = 0, n = 1; offset < size; offset += partSize, n++) {
    parts.push({ number: n, offset, length: Math.min(partSize, size - offset) });
  }
  return { partSize, parts };
}
